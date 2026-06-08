from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr

Role = Literal["supplier", "agent", "admin"]


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"


class TokenPayload(BaseModel):
    """Decoded JWT claims. `sub` = user_id (string)."""

    sub: str
    org_id: str | None  # nullable in M0; populated once orgs exist (M1)
    role: Role
    exp: datetime


@dataclass(frozen=True)
class AuthUser:
    """The only type the auth layer hands to domain services.
    A frozen dataclass — not a Pydantic model — so services never depend on web types."""

    user_id: UUID
    org_id: UUID          # Non-nullable post-M2 gate (was UUID | None in M1)
    role: Role
