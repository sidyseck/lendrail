from datetime import datetime, timedelta, timezone

import jwt  # PyJWT
from jwt import PyJWTError  # noqa: F401 — re-exported for callers
from passlib.context import CryptContext

from app.core.config import get_settings

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Dummy hash used for constant-time comparison when user email is not found
# to prevent user enumeration via timing differences.
_DUMMY_HASH = _pwd.hash("dummy-password-for-timing-safety")


def hash_password(plain: str) -> str:
    return _pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd.verify(plain, hashed)


def verify_password_safe(plain: str, hashed: str | None) -> bool:
    """Constant-time verify. If hashed is None (user not found), compare against
    a dummy hash to avoid timing-based user enumeration."""
    if hashed is None:
        _pwd.verify(plain, _DUMMY_HASH)
        return False
    return _pwd.verify(plain, hashed)


def create_access_token(*, user_id: str, org_id: str | None, role: str) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    claims = {
        "sub": user_id,
        "org_id": org_id,
        "role": role,
        "exp": now + timedelta(minutes=s.jwt_expires_minutes),
        "iat": now,
    }
    return jwt.encode(claims, s.jwt_secret, algorithm=s.jwt_algorithm)


def decode_access_token(token: str) -> dict:  # type: ignore[type-arg]
    s = get_settings()
    # PyJWT verifies signature + exp; raises PyJWTError subclasses on failure.
    return jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])


__all__ = [
    "hash_password",
    "verify_password",
    "verify_password_safe",
    "create_access_token",
    "decode_access_token",
    "PyJWTError",
]
