from sqlalchemy import select

from app.db.repository import BaseRepository
from app.models.organization import Organization


class OrgRepository(BaseRepository[Organization]):
    model = Organization

    async def get_by_contact_email(self, email: str) -> Organization | None:
        """Return the org whose contact_email matches, or None."""
        rows = await self.list_where(Organization.contact_email == email)
        return rows[0] if rows else None

    async def list_all(self) -> list[Organization]:
        """Return all orgs. Used by F-058 admin endpoint."""
        result = await self.session.execute(select(Organization))
        return list(result.scalars().all())
