"""Connection domain service — F-022 through F-026.

No FastAPI imports. All inputs are typed dataclasses; all outputs are typed result
dataclasses. All exceptions are DomainError subclasses from app/core/errors.py.
"""
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

from app.core.errors import ConflictError, Forbidden, NotFoundError, ValidationError
from app.notifications.interface import NotificationEvent, NotificationService
from app.repositories.connection_repository import ConnectionRepository
from app.repositories.org_repository import OrgRepository
from app.schemas.auth import AuthUser

log = logging.getLogger("lendrail.services.connection")


# ── Input DTOs ────────────────────────────────────────────────────────────────

@dataclass
class InviteConnectionInput:
    agent_org_id: uuid.UUID | None
    agent_email: str | None


# ── Output DTOs ───────────────────────────────────────────────────────────────

@dataclass
class ConnectionResult:
    id: uuid.UUID
    supplier_id: uuid.UUID
    agent_id: uuid.UUID
    status: str
    created_at: str         # ISO-8601
    activated_at: str | None
    pending_agreement: bool = False


@dataclass
class ConnectionListResult:
    connections: list[ConnectionResult]


@dataclass
class TerminateResult:
    connection_id: uuid.UUID
    status: Literal["terminated"]
    flagged_loan_ids: list[uuid.UUID] = field(default_factory=list)


# ── Private helpers ───────────────────────────────────────────────────────────

def _to_result(c, pending_agreement: bool = False) -> ConnectionResult:
    return ConnectionResult(
        id=c.id,
        supplier_id=c.supplier_id,
        agent_id=c.agent_id,
        status=c.status,
        created_at=c.created_at.isoformat(),
        activated_at=c.activated_at.isoformat() if c.activated_at else None,
        pending_agreement=pending_agreement,
    )


_NIL_UUID = uuid.UUID(int=0)


def _sentinel_result(supplier_org_id: uuid.UUID) -> ConnectionResult:
    """Returned when invite is sent to an unregistered email. Router maps to HTTP 202."""
    return ConnectionResult(
        id=_NIL_UUID,
        supplier_id=supplier_org_id,
        agent_id=_NIL_UUID,
        status="pending",
        created_at=datetime.now(timezone.utc).isoformat(),
        activated_at=None,
    )


# ── Service ───────────────────────────────────────────────────────────────────

class ConnectionService:
    def __init__(
        self,
        connections: ConnectionRepository,
        orgs: OrgRepository,
        notifier: NotificationService,
    ) -> None:
        self.connections = connections
        self.orgs = orgs
        self.notifier = notifier

    # ── F-022 ─────────────────────────────────────────────────────────────────

    async def invite(
        self, caller: AuthUser, data: InviteConnectionInput
    ) -> tuple[ConnectionResult, bool]:
        """Supplier sends connection invitation."""
        if caller.role != "supplier":
            raise Forbidden("Only suppliers can send connection invitations")
        if caller.org_id is None:
            raise Forbidden("Caller has no associated organization")

        if data.agent_org_id is None and not data.agent_email:
            raise ValidationError(
                "Provide either agent_org_id or agent_email",
                code="missing_agent_identifier",
            )
        if data.agent_org_id is not None and data.agent_email:
            raise ValidationError(
                "Provide only one of agent_org_id or agent_email",
                code="ambiguous_agent_identifier",
            )

        if data.agent_org_id is not None:
            agent_org = await self.orgs.get_or_none(data.agent_org_id)
            if agent_org is None:
                raise NotFoundError(
                    f"Agent organization {data.agent_org_id} not found",
                    code="agent_not_found",
                )
            if agent_org.role != "agent":
                raise ValidationError(
                    "The specified organization is not an agent",
                    code="not_an_agent",
                )
        else:
            agent_org = await self.orgs.get_by_contact_email(data.agent_email)
            if agent_org is None:
                log.info(
                    "connection_invite_to_unknown agent_email=%s supplier_id=%s",
                    data.agent_email, caller.org_id,
                )
                await self.notifier.send(NotificationEvent(
                    event="connection_invite_to_unknown",
                    recipients=[caller.user_id],
                    payload={"agent_email": data.agent_email,
                             "supplier_id": str(caller.org_id)},
                ))
                return _sentinel_result(caller.org_id), False
            if agent_org.role != "agent":
                raise ValidationError(
                    "The specified email does not belong to an agent organization",
                    code="not_an_agent",
                )

        existing = await self.connections.get_by_supplier_and_agent_non_terminated(
            supplier_id=caller.org_id, agent_id=agent_org.id
        )
        if existing is not None:
            raise ConflictError(
                "A connection between these organizations already exists",
                code="connection_already_exists",
            )

        connection = await self.connections.create(
            id=uuid.uuid4(),
            supplier_id=caller.org_id,
            agent_id=agent_org.id,
            status="pending",
        )
        log.info(
            "connection_invited connection_id=%s supplier_id=%s agent_id=%s",
            connection.id, caller.org_id, agent_org.id,
        )
        await self.notifier.send(NotificationEvent(
            event="connection_invited",
            recipients=[caller.user_id],
            payload={"connection_id": str(connection.id),
                     "agent_id": str(agent_org.id)},
        ))
        return _to_result(connection), True

    # ── F-023 ─────────────────────────────────────────────────────────────────

    async def accept(self, caller: AuthUser, connection_id: uuid.UUID) -> ConnectionResult:
        """Agent accepts a pending connection invitation.

        Transitions: pending → active (activated_at set here).
        """
        if caller.role != "agent":
            raise Forbidden("Only agents can accept connection invitations")
        if caller.org_id is None:
            raise Forbidden("Caller has no associated organization")

        connection = await self.connections.get(connection_id)

        if connection.agent_id != caller.org_id:
            raise Forbidden("This connection does not belong to your organization")

        if connection.status != "pending":
            raise ConflictError(
                f"Connection is in '{connection.status}' status; only pending connections can be accepted",
                code="invalid_connection_status",
            )

        now = datetime.now(timezone.utc)
        connection = await self.connections.update(
            connection, status="active", activated_at=now
        )
        log.info(
            "connection_accepted connection_id=%s agent_id=%s",
            connection_id, caller.org_id,
        )
        await self.notifier.send(NotificationEvent(
            event="connection_accepted",
            recipients=[caller.user_id],
            payload={"connection_id": str(connection_id),
                     "supplier_id": str(connection.supplier_id)},
        ))
        return _to_result(connection)

    # ── F-025 — suspend ───────────────────────────────────────────────────────

    async def suspend(
        self, caller: AuthUser, connection_id: uuid.UUID
    ) -> ConnectionResult:
        connection = await self._get_and_assert_membership(caller, connection_id)

        if connection.status != "active":
            raise ConflictError(
                f"Connection is in '{connection.status}' status; only active connections can be suspended",
                code="invalid_connection_status",
            )

        connection = await self.connections.update(connection, status="suspended")
        log.info(
            "connection_suspended connection_id=%s by_org_id=%s",
            connection_id, caller.org_id,
        )
        await self.notifier.send(NotificationEvent(
            event="connection_suspended",
            recipients=[caller.user_id],
            payload={"connection_id": str(connection_id)},
        ))
        return _to_result(connection)

    async def reactivate(
        self, caller: AuthUser, connection_id: uuid.UUID
    ) -> ConnectionResult:
        """Either party can reactivate a suspended connection."""
        connection = await self._get_and_assert_membership(caller, connection_id)

        if connection.status != "suspended":
            raise ConflictError(
                f"Connection is in '{connection.status}' status; only suspended connections can be reactivated",
                code="invalid_connection_status",
            )

        connection = await self.connections.update(connection, status="active")
        log.info(
            "connection_reactivated connection_id=%s by_org_id=%s",
            connection_id, caller.org_id,
        )
        await self.notifier.send(NotificationEvent(
            event="connection_reactivated",
            recipients=[caller.user_id],
            payload={"connection_id": str(connection_id)},
        ))
        return _to_result(connection)

    # ── F-025 — terminate ─────────────────────────────────────────────────────

    async def terminate(
        self, caller: AuthUser, connection_id: uuid.UUID
    ) -> TerminateResult:
        connection = await self._get_and_assert_membership(caller, connection_id)

        if connection.status == "terminated":
            raise ConflictError(
                "Connection is already terminated",
                code="connection_already_terminated",
            )

        flagged_loan_ids: list[uuid.UUID] = await self.connections.list_active_loans_by_connection(connection_id)

        connection = await self.connections.update(connection, status="terminated")
        log.info(
            "connection_terminated connection_id=%s by_org_id=%s flagged_loans=%d",
            connection_id, caller.org_id, len(flagged_loan_ids),
        )

        await self.notifier.send(NotificationEvent(
            event="connection_terminated",
            recipients=[caller.user_id],
            payload={
                "connection_id": str(connection_id),
                "flagged_loan_ids": [str(lid) for lid in flagged_loan_ids],
            },
        ))
        return TerminateResult(
            connection_id=connection_id,
            status="terminated",
            flagged_loan_ids=flagged_loan_ids,
        )

    # ── F-026 — list and detail ───────────────────────────────────────────────

    async def list_for_org(self, caller: AuthUser) -> ConnectionListResult:
        if caller.role not in ("supplier", "agent", "admin"):
            raise Forbidden("Invalid role for listing connections")

        if caller.role == "admin":
            connections = await self.connections.list_all()
        else:
            if caller.org_id is None:
                raise Forbidden("Caller has no associated organization")
            connections = await self.connections.list_for_org(caller.org_id)

        return ConnectionListResult(
            connections=[_to_result(c) for c in connections]
        )

    async def get_detail(
        self, caller: AuthUser, connection_id: uuid.UUID
    ) -> ConnectionResult:
        connection = await self.connections.get(connection_id)

        if caller.role != "admin":
            if caller.org_id is None:
                raise Forbidden("Caller has no associated organization")
            if caller.org_id not in (connection.supplier_id, connection.agent_id):
                raise Forbidden("Your organization is not a party to this connection")

        return _to_result(connection)

    # ── Private helpers ───────────────────────────────────────────────────────

    async def _get_and_assert_membership(
        self, caller: AuthUser, connection_id: uuid.UUID
    ) -> object:
        if caller.role not in ("supplier", "agent"):
            raise Forbidden("Only suppliers and agents can perform this action")
        if caller.org_id is None:
            raise Forbidden("Caller has no associated organization")
        connection = await self.connections.get(connection_id)
        if caller.org_id not in (connection.supplier_id, connection.agent_id):
            raise Forbidden("Your organization is not a party to this connection")
        return connection
