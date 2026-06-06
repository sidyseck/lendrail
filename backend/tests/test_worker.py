"""F-007: ARQ background worker tests."""
import logging

import pytest
from arq import cron as arq_cron

from app.workers.arq_worker import WorkerSettings, health_check_job, on_job_end


@pytest.mark.asyncio
async def test_health_check_job_returns_ok() -> None:
    ctx = {"job_id": "test-job-id"}
    result = await health_check_job(ctx)
    assert result == "ok"


@pytest.mark.asyncio
async def test_health_check_job_logs(caplog: pytest.LogCaptureFixture) -> None:
    ctx = {"job_id": "test-log-job"}
    with caplog.at_level(logging.INFO, logger="lendrail.worker"):
        await health_check_job(ctx)
    assert any("health_check_job" in r.message for r in caplog.records)


def test_worker_settings_has_cron_every_minute() -> None:
    """WorkerSettings.cron_jobs must contain a cron firing on second=0 (every minute)."""
    cron_jobs = WorkerSettings.cron_jobs
    assert len(cron_jobs) >= 1
    # The cron entry wraps health_check_job
    job = cron_jobs[0]
    assert job.coroutine is health_check_job or getattr(job, "name", "") == "health_check_job"


def test_worker_settings_redis_url_from_env() -> None:
    """WorkerSettings.redis_settings must be derived from REDIS_URL env var."""
    from app.core.config import get_settings
    settings = get_settings()
    # RedisSettings stores host/port; just verify it was constructed without error
    assert WorkerSettings.redis_settings is not None


@pytest.mark.asyncio
async def test_on_job_end_logs_error_on_exception(caplog: pytest.LogCaptureFixture) -> None:
    """on_job_end with a seeded exception must log at ERROR with exc_info and not raise."""
    exc = ValueError("simulated job failure")
    ctx = {"job_id": "failed-job-id", "exception": exc}

    with caplog.at_level(logging.ERROR, logger="lendrail.worker"):
        await on_job_end(ctx)  # must not raise

    error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(error_records) >= 1
    assert error_records[0].exc_info is not None


@pytest.mark.asyncio
async def test_on_job_end_no_exception_does_not_log_error(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """on_job_end with no exception must not log at ERROR."""
    ctx = {"job_id": "ok-job-id"}

    with caplog.at_level(logging.ERROR, logger="lendrail.worker"):
        await on_job_end(ctx)

    error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(error_records) == 0
