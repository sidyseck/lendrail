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
from app.services.auth_service import AuthService, UserRepository

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
    return AuthUser(
        user_id=UUID(claims["sub"]),
        org_id=UUID(claims["org_id"]) if claims.get("org_id") else None,
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
