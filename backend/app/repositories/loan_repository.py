from uuid import UUID

from sqlalchemy import and_, delete, select

from app.db.repository import BaseRepository
from app.models.borrower import Borrower
from app.models.connection import Connection
from app.models.loan import ApprovedBorrower, Loan, LoanStateTransition


class LoanRepository(BaseRepository[Loan]):
    model = Loan

    async def list_visible_for_org(
        self, org_id: UUID, role: str, state: str | None = None
    ) -> list[tuple[Loan, str]]:
        conditions = []
        if role == "supplier":
            conditions.append(Connection.supplier_id == org_id)
        elif role == "agent":
            conditions.append(Connection.agent_id == org_id)
        if state is not None:
            conditions.append(Loan.state == state)

        result = await self.session.execute(
            select(Loan, Borrower.name)
            .join(Connection, Connection.id == Loan.connection_id)
            .join(Borrower, Borrower.id == Loan.borrower_id)
            .where(*conditions)
            .order_by(Loan.booked_at.desc())
        )
        return [(loan, borrower_name) for loan, borrower_name in result.all()]

    async def get_visible_for_org(
        self, loan_id: UUID, org_id: UUID, role: str
    ) -> tuple[Loan, str, Connection]:
        result = await self.session.execute(
            select(Loan, Borrower.name, Connection)
            .join(Connection, Connection.id == Loan.connection_id)
            .join(Borrower, Borrower.id == Loan.borrower_id)
            .where(Loan.id == loan_id)
        )
        row = result.first()
        if row is None:
            from app.core.errors import NotFoundError

            raise NotFoundError(f"Loan {loan_id} not found")
        loan, borrower_name, connection = row
        if role == "admin" or connection.supplier_id == org_id or connection.agent_id == org_id:
            return loan, borrower_name, connection
        from app.core.errors import Forbidden

        raise Forbidden("Your organization is not a party to this loan")

    async def list_by_state(self, state: str) -> list[Loan]:
        return await self.list_where(Loan.state == state)

    async def list_active_by_connection(self, connection_id: UUID) -> list[UUID]:
        result = await self.session.execute(
            select(Loan.id).where(
                Loan.connection_id == connection_id,
                Loan.state.in_(["pending", "active", "margin_call", "recall_initiated"]),
            )
        )
        return list(result.scalars().all())


class ApprovedBorrowerRepository(BaseRepository[ApprovedBorrower]):
    model = ApprovedBorrower

    async def exists(self, connection_id: UUID, borrower_id: UUID) -> bool:
        row = await self.session.get(
            ApprovedBorrower,
            {"connection_id": connection_id, "borrower_id": borrower_id},
        )
        return row is not None

    async def add(
        self, connection_id: UUID, borrower_id: UUID, approved_by: UUID
    ) -> ApprovedBorrower:
        existing = await self.session.get(
            ApprovedBorrower,
            {"connection_id": connection_id, "borrower_id": borrower_id},
        )
        if existing is not None:
            from app.core.errors import ConflictError

            raise ConflictError("Borrower is already approved", code="borrower_already_approved")
        return await self.create(
            connection_id=connection_id,
            borrower_id=borrower_id,
            approved_by=approved_by,
        )

    async def remove(self, connection_id: UUID, borrower_id: UUID) -> None:
        result = await self.session.execute(
            delete(ApprovedBorrower).where(
                and_(
                    ApprovedBorrower.connection_id == connection_id,
                    ApprovedBorrower.borrower_id == borrower_id,
                )
            )
        )
        if result.rowcount == 0:
            from app.core.errors import NotFoundError

            raise NotFoundError("Approved borrower not found")
        await self.session.flush()

    async def list_for_connection(self, connection_id: UUID) -> list[tuple[Borrower, ApprovedBorrower]]:
        result = await self.session.execute(
            select(Borrower, ApprovedBorrower)
            .join(ApprovedBorrower, ApprovedBorrower.borrower_id == Borrower.id)
            .where(ApprovedBorrower.connection_id == connection_id)
            .order_by(Borrower.name.asc())
        )
        return [(borrower, approval) for borrower, approval in result.all()]


class LoanTransitionRepository(BaseRepository[LoanStateTransition]):
    model = LoanStateTransition

    async def record(
        self,
        loan_id: UUID,
        from_state: str | None,
        to_state: str,
        reason: str,
        actor_org_id: UUID | None = None,
        actor_user_id: UUID | None = None,
        metadata: dict | None = None,
    ) -> LoanStateTransition:
        return await self.create(
            loan_id=loan_id,
            from_state=from_state,
            to_state=to_state,
            reason=reason,
            actor_org_id=actor_org_id,
            actor_user_id=actor_user_id,
            transition_metadata=metadata or {},
        )
