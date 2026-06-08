"""ARQ background worker.

Run via: arq app.workers.arq_worker.WorkerSettings

health_check_job fires every minute (cron second=0) as an F-007 smoke check.
on_job_end logs any job exception at ERROR with full traceback so the worker keeps running.
"""
import logging

from arq import cron
from arq.connections import RedisSettings

from app.adapters.providers import build_custodian_adapter, build_market_data_adapter
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.session import get_factory
from app.notifications.console_adapter import ConsoleNotificationAdapter
from app.notifications.repository import NotificationRepository
from app.repositories.agreement_repository import AgreementRepository
from app.repositories.borrower_repository import BorrowerRepository
from app.repositories.connection_repository import ConnectionRepository
from app.repositories.custodian_link_repository import CustodianLinkRepository
from app.repositories.loan_repository import ApprovedBorrowerRepository, LoanRepository, LoanTransitionRepository
from app.repositories.user_repository import UserRepository
from app.services.loan_service import LoanService

log = logging.getLogger("lendrail.worker")


async def health_check_job(ctx: dict) -> str:  # type: ignore[type-arg]
    log.info("health_check_job ran", extra={"job_id": ctx.get("job_id")})
    return "ok"


async def ltv_refresh_job(ctx: dict) -> int:  # type: ignore[type-arg]
    """Activate pending loans once mock custodian feeds confirm inventory + collateral."""
    factory = get_factory()
    async with factory() as session:
        notifier = ConsoleNotificationAdapter(NotificationRepository(session))
        svc = LoanService(
            loans=LoanRepository(session),
            approved_borrowers=ApprovedBorrowerRepository(session),
            transitions=LoanTransitionRepository(session),
            borrowers=BorrowerRepository(session),
            connections=ConnectionRepository(session),
            agreements=AgreementRepository(session),
            custodian_links=CustodianLinkRepository(session),
            users=UserRepository(session),
            custodian=build_custodian_adapter(),
            market_data=build_market_data_adapter(),
            notifier=notifier,
        )
        try:
            count = await svc.activate_pending_loans()
            await session.commit()
        except Exception:
            await session.rollback()
            raise
    log.info("ltv_refresh_job activated_loans=%s", count)
    return count


async def on_job_end(ctx: dict) -> None:  # type: ignore[type-arg]
    """ARQ after-job hook. Logs any job exception at ERROR with full traceback.

    Guarantees the F-007 'failed job logged at ERROR with traceback' criterion
    rather than relying on ARQ's default formatting. Worker keeps running.
    """
    exc = ctx.get("exception")
    if exc is not None:
        log.error("job %s failed", ctx.get("job_id"), exc_info=exc)


async def startup(ctx: dict) -> None:  # type: ignore[type-arg]
    configure_logging(get_settings().log_level)
    log.info("worker startup")


async def shutdown(ctx: dict) -> None:  # type: ignore[type-arg]
    log.info("worker shutdown")


def _redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(get_settings().redis_url)


class WorkerSettings:
    functions = [health_check_job, ltv_refresh_job]
    on_startup = startup
    on_shutdown = shutdown
    after_job_end = on_job_end
    redis_settings = _redis_settings()
    cron_jobs = [
        cron(health_check_job, second=0),  # fires every minute on :00 second
        cron(ltv_refresh_job, minute={0, 15, 30, 45}, second=10),
    ]
    max_tries = 3
    job_timeout = 30
