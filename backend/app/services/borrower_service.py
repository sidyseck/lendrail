"""BorrowerService — domain service for borrower management. No FastAPI imports."""
import uuid
import logging
from dataclasses import dataclass

from app.core.errors import ConflictError, Forbidden
from app.models.borrower import Borrower
from app.notifications.interface import NotificationEvent, NotificationService
from app.repositories.borrower_repository import BorrowerRepository
from app.repositories.connection_repository import ConnectionRepository
from app.repositories.loan_repository import ApprovedBorrowerRepository
from app.schemas.auth import AuthUser

log = logging.getLogger("lendrail.services.borrower")

# ── Input DTOs ────────────────────────────────────────────────────────────────


@dataclass
class BorrowerInviteInput:
    name: str
    jurisdiction: str
    contact_email: str


@dataclass
class BorrowerCreateInput:
    name: str
    jurisdiction: str
    contact_email: str
    connection_id: uuid.UUID | None = None

# ── Output DTOs ───────────────────────────────────────────────────────────────


@dataclass
class BorrowerResult:
    id: uuid.UUID
    invited_by: uuid.UUID
    name: str
    jurisdiction: str
    contact_email: str
    status: str
    created_at: str           # ISO-8601


@dataclass
class BorrowerCreateResult:
    borrower: BorrowerResult
    approved_connection_id: uuid.UUID | None

# ── Service ───────────────────────────────────────────────────────────────────


class BorrowerService:
    def __init__(
        self,
        borrowers: BorrowerRepository,
        connections: ConnectionRepository,
        approved_borrowers: ApprovedBorrowerRepository,
        notifier: NotificationService,
    ) -> None:
        self.borrowers = borrowers
        self.connections = connections
        self.approved_borrowers = approved_borrowers
        self.notifier = notifier

    async def invite_borrower(
        self, caller: AuthUser, data: BorrowerInviteInput
    ) -> BorrowerResult:
        """Create a Borrower row with status=invited. Caller must be an agent."""
        if caller.role != "agent":
            raise Forbidden("Only agents can invite borrowers")
        if caller.org_id is None:
            raise Forbidden("Caller has no associated organization")

        existing = await self.borrowers.get_by_contact_email(data.contact_email)
        if existing is not None:
            raise ConflictError(
                f"A borrower with email '{data.contact_email}' already exists",
                code="duplicate_email",
            )

        borrower = await self.borrowers.create(
            id=uuid.uuid4(),
            invited_by=caller.org_id,
            name=data.name,
            jurisdiction=data.jurisdiction,
            contact_email=data.contact_email,
            status="invited",
        )
        log.info(
            "borrower_invited borrower_id=%s invited_by=%s",
            borrower.id,
            caller.org_id,
        )

        await self.notifier.send(
            NotificationEvent(
                event="borrower_invited",
                recipients=[caller.user_id],
                payload={
                    "borrower_id": str(borrower.id),
                    "borrower_email": data.contact_email,
                    "borrower_name": data.name,
                },
            )
        )

        return _to_result(borrower)

    async def create_borrower(
        self, caller: AuthUser, data: BorrowerCreateInput
    ) -> BorrowerCreateResult:
        """Create an agent-managed borrower without starting a borrower-facing invite."""
        if caller.role != "agent":
            raise Forbidden("Only agents can create borrowers")
        if caller.org_id is None:
            raise Forbidden("Caller has no associated organization")

        existing = await self.borrowers.get_by_contact_email(data.contact_email)
        if existing is not None:
            raise ConflictError(
                f"A borrower with email '{data.contact_email}' already exists",
                code="duplicate_email",
            )

        approved_connection_id: uuid.UUID | None = None
        if data.connection_id is not None:
            connection = await self.connections.get(data.connection_id)
            if connection.agent_id != caller.org_id:
                raise Forbidden("This connection does not belong to your organization")
            if connection.status != "active":
                raise ConflictError("Connection is not active", code="connection_not_active")
            approved_connection_id = connection.id

        borrower = await self.borrowers.create(
            id=uuid.uuid4(),
            invited_by=caller.org_id,
            name=data.name,
            jurisdiction=data.jurisdiction,
            contact_email=data.contact_email,
            status="active",
        )
        if approved_connection_id is not None:
            await self.approved_borrowers.add(
                approved_connection_id, borrower.id, approved_by=caller.org_id
            )

        log.info(
            "borrower_created borrower_id=%s managed_by=%s approved_connection_id=%s",
            borrower.id,
            caller.org_id,
            approved_connection_id,
        )

        await self.notifier.send(
            NotificationEvent(
                event="borrower_created",
                recipients=[caller.user_id],
                payload={
                    "borrower_id": str(borrower.id),
                    "borrower_email": data.contact_email,
                    "borrower_name": data.name,
                    "approved_connection_id": (
                        str(approved_connection_id) if approved_connection_id else None
                    ),
                },
            )
        )

        return BorrowerCreateResult(
            borrower=_to_result(borrower),
            approved_connection_id=approved_connection_id,
        )

    async def get_borrower(self, caller: AuthUser, borrower_id: uuid.UUID) -> BorrowerResult:
        """Return a borrower record. Agent must own the invite relationship."""
        if caller.role != "agent":
            raise Forbidden("Only agents can view borrower records")
        borrower = await self.borrowers.get(borrower_id)   # raises NotFoundError if missing
        if borrower.invited_by != caller.org_id:
            raise Forbidden("This borrower was not invited by your organization")
        return _to_result(borrower)

    async def list_borrowers(self, caller: AuthUser) -> list[BorrowerResult]:
        """Return all borrowers managed by the calling agent."""
        if caller.role != "agent":
            raise Forbidden("Only agents can list borrower records")
        if caller.org_id is None:
            raise Forbidden("Caller has no associated organization")
        return [_to_result(b) for b in await self.borrowers.list_by_inviting_org(caller.org_id)]


def _to_result(b: Borrower) -> BorrowerResult:
    return BorrowerResult(
        id=b.id,
        invited_by=b.invited_by,
        name=b.name,
        jurisdiction=b.jurisdiction,
        contact_email=b.contact_email,
        status=b.status,
        created_at=b.created_at.isoformat(),
    )
