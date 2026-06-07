"""BorrowerService — domain service for borrower management. No FastAPI imports."""
import uuid
import logging
from dataclasses import dataclass

from app.core.errors import ConflictError, Forbidden, NotFoundError
from app.models.borrower import Borrower
from app.notifications.interface import NotificationEvent, NotificationService
from app.repositories.borrower_repository import BorrowerRepository
from app.schemas.auth import AuthUser

log = logging.getLogger("lendrail.services.borrower")

# ── Input DTOs ────────────────────────────────────────────────────────────────


@dataclass
class BorrowerInviteInput:
    name: str
    jurisdiction: str
    contact_email: str

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

# ── Service ───────────────────────────────────────────────────────────────────


class BorrowerService:
    def __init__(
        self,
        borrowers: BorrowerRepository,
        notifier: NotificationService,
    ) -> None:
        self.borrowers = borrowers
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

    async def get_borrower(self, caller: AuthUser, borrower_id: uuid.UUID) -> BorrowerResult:
        """Return a borrower record. Agent must own the invite relationship."""
        if caller.role != "agent":
            raise Forbidden("Only agents can view borrower records")
        borrower = await self.borrowers.get(borrower_id)   # raises NotFoundError if missing
        if borrower.invited_by != caller.org_id:
            raise Forbidden("This borrower was not invited by your organization")
        return _to_result(borrower)


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
