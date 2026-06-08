from uuid import UUID

from sqlalchemy import or_, select

from app.db.repository import BaseRepository
from app.models.connection import Connection
from app.models.loan import Loan


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

    async def get_for_update(self, connection_id: UUID) -> Connection:
        result = await self.session.execute(
            select(Connection)
            .where(Connection.id == connection_id)
            .with_for_update()
        )
        connection = result.scalar_one_or_none()
        if connection is None:
            from app.core.errors import NotFoundError

            raise NotFoundError(f"Connection {connection_id} not found")
        return connection

    async def list_active_loans_by_connection(self, connection_id: UUID) -> list[UUID]:
        """Return non-terminal loans that should be flagged when a connection ends."""
        result = await self.session.execute(
            select(Loan.id).where(
                Loan.connection_id == connection_id,
                Loan.state.in_(["pending", "active", "margin_call", "recall_initiated"]),
            )
        )
        return list(result.scalars().all())
