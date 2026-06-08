from uuid import UUID

from sqlalchemy import or_, select

from app.db.repository import BaseRepository
from app.models.connection import Connection


class ConnectionRepository(BaseRepository[Connection]):
    model = Connection

    async def get_by_supplier_and_agent_non_terminated(
        self, supplier_id: UUID, agent_id: UUID
    ) -> Connection | None:
        """Return the existing non-terminated connection between a supplier and agent, or None.

        Terminated connections are excluded — a supplier may re-invite an agent
        after their prior connection was terminated (new row is created).
        """
        rows = await self.list_where(
            Connection.supplier_id == supplier_id,
            Connection.agent_id == agent_id,
            Connection.status != "terminated",
        )
        return rows[0] if rows else None

    async def list_for_org(self, org_id: UUID) -> list[Connection]:
        """Return all connections where the org is either supplier or agent."""
        result = await self.session.execute(
            select(Connection).where(
                or_(
                    Connection.supplier_id == org_id,
                    Connection.agent_id == org_id,
                )
            )
        )
        return list(result.scalars().all())

    async def list_all(self) -> list[Connection]:
        """Admin: return all connections across all orgs."""
        result = await self.session.execute(select(Connection))
        return list(result.scalars().all())

    async def list_active_loans_by_connection(self, connection_id: UUID) -> list[UUID]:
        """Stub: return active loans for a connection.

        The loans table does not exist in M2. This method returns an empty list
        as a deliberate no-op stub. M4 will replace this with a real query
        against the loans table once it exists (F-033).
        """
        return []  # M4 gate: wire real loan query
