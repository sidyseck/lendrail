"""UserRepository — moved from app/services/auth_service.py in M1 (Decision 6)."""
from uuid import UUID

from app.db.repository import BaseRepository
from app.models.user import User


class UserRepository(BaseRepository[User]):
    model = User

    async def get_by_email(self, email: str) -> User | None:
        rows = await self.list_where(User.email == email)
        return rows[0] if rows else None

    async def create_user(
        self,
        *,
        org_id: UUID,
        email: str,
        hashed_password: str,
        role: str,
    ) -> User:
        return await self.create(
            org_id=org_id,
            email=email,
            hashed_password=hashed_password,
            role=role,
        )
