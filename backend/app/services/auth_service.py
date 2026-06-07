"""AuthService — domain service. No FastAPI imports.

Raises typed DomainError subclasses that the API layer maps to HTTP responses.
"""
from app.core.errors import AuthError
from app.core.security import create_access_token, verify_password_safe
from app.repositories.user_repository import UserRepository  # moved in M1 (Decision 6)


class AuthService:
    def __init__(self, users: UserRepository) -> None:
        self.users = users

    async def login(self, email: str, password: str) -> str:
        """Validate credentials and return a signed JWT access token.

        Uses constant-time password verification even when the user is not found
        to prevent user-enumeration timing attacks.
        """
        user = await self.users.get_by_email(email)
        # verify_password_safe runs bcrypt even if user is None (against a dummy hash)
        if not verify_password_safe(password, user.hashed_password if user else None):
            raise AuthError("invalid_credentials")  # → 401 via handler
        # user is guaranteed non-None here (verify_password_safe returns False for None user)
        assert user is not None  # noqa: S101 — proved above
        return create_access_token(
            user_id=str(user.id),
            org_id=str(user.org_id) if user.org_id else None,
            role=user.role,
        )
