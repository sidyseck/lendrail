from uuid import UUID

from sqlalchemy import select

from app.db.repository import BaseRepository
from app.models.lending_agreement import LendingAgreement


class AgreementRepository(BaseRepository[LendingAgreement]):
    model = LendingAgreement

    async def get_latest_for_connection(
        self, connection_id: UUID
    ) -> LendingAgreement | None:
        """Return the highest-version agreement for a connection, or None."""
        result = await self.session.execute(
            select(LendingAgreement)
            .where(LendingAgreement.connection_id == connection_id)
            .order_by(LendingAgreement.version.desc())
            .limit(1)
        )
        return result.scalars().first()

    async def get_active_for_connection(
        self, connection_id: UUID
    ) -> LendingAgreement | None:
        """Return the latest agreement only if both parties have confirmed it."""
        agreement = await self.get_latest_for_connection(connection_id)
        if agreement and agreement.is_active:
            return agreement
        return None

    async def list_for_connection(
        self, connection_id: UUID
    ) -> list[LendingAgreement]:
        """Return all versions for a connection ordered by version ASC."""
        result = await self.session.execute(
            select(LendingAgreement)
            .where(LendingAgreement.connection_id == connection_id)
            .order_by(LendingAgreement.version.asc())
        )
        return list(result.scalars().all())
