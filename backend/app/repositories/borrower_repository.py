from uuid import UUID

from app.db.repository import BaseRepository
from app.models.borrower import Borrower


class BorrowerRepository(BaseRepository[Borrower]):
    model = Borrower

    async def get_by_contact_email(self, email: str) -> Borrower | None:
        rows = await self.list_where(Borrower.contact_email == email)
        return rows[0] if rows else None

    async def list_by_inviting_org(self, org_id: UUID) -> list[Borrower]:
        """Return all borrowers invited by a given agent org."""
        return await self.list_where(Borrower.invited_by == org_id)
