from uuid import UUID

from app.db.repository import BaseRepository
from app.models.custodian_link import CustodianLink


class CustodianLinkRepository(BaseRepository[CustodianLink]):
    model = CustodianLink

    async def list_by_org(self, org_id: UUID) -> list[CustodianLink]:
        """Return all custodian links for an org."""
        return await self.list_where(CustodianLink.org_id == org_id)
