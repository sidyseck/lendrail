"""FastAPI dependency providers.

All wiring lives here. Routes get session, current user, adapters, secret store,
and notifier via Depends. Domain services are constructed in providers from their
repository deps — services themselves never call Depends.
"""
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header
from jwt import PyJWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.interfaces import CustodianAdapter, MarketDataAdapter
from app.adapters.providers import build_custodian_adapter, build_market_data_adapter
from app.core.errors import AuthError
from app.core.security import decode_access_token
from app.db.session import get_session
from app.notifications.console_adapter import ConsoleNotificationAdapter
from app.notifications.interface import NotificationService
from app.notifications.repository import NotificationRepository
from app.schemas.auth import AuthUser
from app.secrets.env_store import EnvSecretStore
from app.secrets.interface import SecretStore
from app.repositories.user_repository import UserRepository  # moved in M1 (Decision 6)
from app.repositories.org_repository import OrgRepository
from app.repositories.borrower_repository import BorrowerRepository
from app.repositories.custodian_link_repository import CustodianLinkRepository
from app.repositories.connection_repository import ConnectionRepository
from app.repositories.agreement_repository import AgreementRepository
from app.repositories.loan_repository import ApprovedBorrowerRepository, LoanRepository, LoanTransitionRepository
from app.services.auth_service import AuthService
from app.services.org_service import OrgService
from app.services.borrower_service import BorrowerService
from app.services.connection_service import ConnectionService
from app.services.agreement_service import AgreementService
from app.services.custodian_service import CustodianService
from app.services.loan_service import LoanService

SessionDep = Annotated[AsyncSession, Depends(get_session)]

# ---- auth ----


async def get_current_user(authorization: str = Header(default="")) -> AuthUser:
    if not authorization.lower().startswith("bearer "):
        raise AuthError("missing_bearer_token")
    token = authorization.split(" ", 1)[1]
    try:
        claims = decode_access_token(token)
    except PyJWTError:
        raise AuthError("invalid_token")
    raw_org_id = claims.get("org_id")
    if not raw_org_id:
        raise AuthError("Pre-M1 token; org_id is missing", code="token_missing_org_id")   # Pre-M1 token; reject cleanly.
    return AuthUser(
        user_id=UUID(claims["sub"]),
        org_id=UUID(raw_org_id),
        role=claims["role"],
    )


def get_auth_service(session: SessionDep) -> AuthService:
    return AuthService(UserRepository(session))


# ---- adapters ----


def get_custodian_adapter() -> CustodianAdapter:
    return build_custodian_adapter()


def get_market_data_adapter() -> MarketDataAdapter:
    return build_market_data_adapter()


# ---- secret store (process singleton) ----

_secret_store_singleton: SecretStore = EnvSecretStore()


def get_secret_store() -> SecretStore:
    return _secret_store_singleton


# ---- notifications ----


def get_notification_service(session: SessionDep) -> NotificationService:
    return ConsoleNotificationAdapter(NotificationRepository(session))


# ---- org service ----


def get_org_service(session: SessionDep) -> OrgService:
    return OrgService(
        orgs=OrgRepository(session),
        users=UserRepository(session),
    )


# ---- borrower service ----


def get_borrower_service(session: SessionDep) -> BorrowerService:
    notifier = ConsoleNotificationAdapter(NotificationRepository(session))
    return BorrowerService(
        borrowers=BorrowerRepository(session),
        notifier=notifier,
    )


# ---- connection service ----


def get_connection_service(
    session: SessionDep,
    custodian_adapter: CustodianAdapter = Depends(get_custodian_adapter),
) -> ConnectionService:
    notifier = ConsoleNotificationAdapter(NotificationRepository(session))
    return ConnectionService(
        connections=ConnectionRepository(session),
        orgs=OrgRepository(session),
        custodian_links=CustodianLinkRepository(session),
        custodian_adapter=custodian_adapter,
        notifier=notifier,
    )


def get_loan_repository(session: SessionDep) -> LoanRepository:
    return LoanRepository(session)


def get_custodian_service(
    session: SessionDep,
    secret_store: SecretStore = Depends(get_secret_store),
    custodian_adapter: CustodianAdapter = Depends(get_custodian_adapter),
) -> CustodianService:
    return CustodianService(
        custodian_links=CustodianLinkRepository(session),
        secret_store=secret_store,
        custodian_adapter=custodian_adapter,
    )


# ---- agreement service ----


def get_agreement_service(session: SessionDep) -> AgreementService:
    notifier = ConsoleNotificationAdapter(NotificationRepository(session))
    return AgreementService(
        agreements=AgreementRepository(session),
        connections=ConnectionRepository(session),
        users=UserRepository(session),
        notifier=notifier,
    )


# ---- loan service ----


def get_loan_service(
    session: SessionDep,
    custodian_adapter: CustodianAdapter = Depends(get_custodian_adapter),
    market_data_adapter: MarketDataAdapter = Depends(get_market_data_adapter),
) -> LoanService:
    notifier = ConsoleNotificationAdapter(NotificationRepository(session))
    return LoanService(
        loans=LoanRepository(session),
        approved_borrowers=ApprovedBorrowerRepository(session),
        transitions=LoanTransitionRepository(session),
        borrowers=BorrowerRepository(session),
        connections=ConnectionRepository(session),
        agreements=AgreementRepository(session),
        custodian_links=CustodianLinkRepository(session),
        users=UserRepository(session),
        custodian=custodian_adapter,
        market_data=market_data_adapter,
        notifier=notifier,
    )
