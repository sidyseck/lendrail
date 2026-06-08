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
from app.repositories.custodian_link_repository import CustodianLinkRepository
from app.repositories.org_repository import OrgRepository
from app.schemas.auth import AuthUser
from app.secrets.interface import SecretStore
from app.adapters.interfaces import CustodianAdapter

log = logging.getLogger("lendrail.services.connection")


# ── Input DTOs ────────────────────────────────────────────────────────────────

@dataclass
class InviteConnectionInput:
    # Supplier provides either agent_org_id (known agent) or agent_email (unknown agent).
    # Exactly one must be set — enforced via Pydantic model_validator on
    # InviteConnectionRequest (see §7.1). The service re-checks for belt-and-suspenders.
    agent_org_id: uuid.UUID | None
    agent_email: str | None


@dataclass
class RegisterCustodianKeyInput:
    custodian_id: str       # e.g. "anchorage", "mock"
    account_ref: str        # custodian-side account identifier
    plaintext_key: str      # NEVER logged; consumed and discarded after store+validate


# ── Output DTOs ───────────────────────────────────────────────────────────────

@dataclass
class ConnectionResult:
    id: uuid.UUID
    supplier_id: uuid.UUID
    agent_id: uuid.UUID
    status: str
    custodian_link_id: uuid.UUID | None
    created_at: str         # ISO-8601
    activated_at: str | None


@dataclass
class ConnectionListResult:
    connections: list[ConnectionResult]


@dataclass
class TerminateResult:
    connection_id: uuid.UUID
    status: Literal["terminated"]
    flagged_loan_ids: list[uuid.UUID] = field(default_factory=list)


# ── Private helpers ───────────────────────────────────────────────────────────

def _to_result(c) -> ConnectionResult:
    return ConnectionResult(
        id=c.id,
        supplier_id=c.supplier_id,
        agent_id=c.agent_id,
        status=c.status,
        custodian_link_id=c.custodian_link_id,
        created_at=c.created_at.isoformat(),
        activated_at=c.activated_at.isoformat() if c.activated_at else None,
    )


_NIL_UUID = uuid.UUID(int=0)  # Sentinel — never a real connection ID.


def _sentinel_result(supplier_org_id: uuid.UUID) -> ConnectionResult:
    """Returned when invite is sent to an unregistered email. Router maps to HTTP 202."""
    return ConnectionResult(
        id=_NIL_UUID,
        supplier_id=supplier_org_id,
        agent_id=_NIL_UUID,
        status="pending",
        custodian_link_id=None,
        created_at=datetime.now(timezone.utc).isoformat(),
        activated_at=None,
    )


# ── Service ───────────────────────────────────────────────────────────────────

class ConnectionService:
    def __init__(
        self,
        connections: ConnectionRepository,
        custodian_links: CustodianLinkRepository,
        orgs: OrgRepository,
        secret_store: SecretStore,
        custodian_adapter: CustodianAdapter,
        notifier: NotificationService,
    ) -> None:
        self.connections = connections
        self.custodian_links = custodian_links
        self.orgs = orgs
        self.secret_store = secret_store
        self.custodian_adapter = custodian_adapter
        self.notifier = notifier

    # ── F-022 ─────────────────────────────────────────────────────────────────

    async def invite(
        self, caller: AuthUser, data: InviteConnectionInput
    ) -> tuple[ConnectionResult, bool]:
        """Supplier sends connection invitation.

        Returns (result, known_agent) where known_agent=False means the agent
        email is not registered — caller should return HTTP 202 in that case.

        Role check: caller must be supplier.
        Returns (ConnectionResult, known_agent: bool).
        """
        if caller.role != "supplier":
            raise Forbidden("Only suppliers can send connection invitations")
        if caller.org_id is None:
            raise Forbidden("Caller has no associated organization")

        # Belt-and-suspenders guard (primary enforcement is in InviteConnectionRequest
        # model_validator — see §7.1).
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

        # Resolve agent org.
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
            known_agent = True
        else:
            # Email lookup — may not exist yet.
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
                # Return a sentinel — the router maps this to HTTP 202.
                return _sentinel_result(caller.org_id), False
            if agent_org.role != "agent":
                raise ValidationError(
                    "The specified email does not belong to an agent organization",
                    code="not_an_agent",
                )
            known_agent = True

        # Check for duplicate non-terminated connection.
        # Terminated pairs CAN re-invite — a new row is created.
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

        Transitions: pending → accepted.
        The connection moves to 'active' only after the supplier registers
        the custodian API key (F-024).

        Role check: caller must be agent.
        Ownership check: connection.agent_id must match caller.org_id.
        State check: connection must be in 'pending' status.
        """
        if caller.role != "agent":
            raise Forbidden("Only agents can accept connection invitations")
        if caller.org_id is None:
            raise Forbidden("Caller has no associated organization")

        connection = await self.connections.get(connection_id)  # raises NotFoundError if missing

        if connection.agent_id != caller.org_id:
            raise Forbidden("This connection does not belong to your organization")

        if connection.status != "pending":
            raise ConflictError(
                f"Connection is in '{connection.status}' status; only pending connections can be accepted",
                code="invalid_connection_status",
            )

        # Transition: pending → accepted.
        connection = await self.connections.update(connection, status="accepted")
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

    # ── F-024 ─────────────────────────────────────────────────────────────────

    async def register_custodian_key(
        self,
        caller: AuthUser,
        connection_id: uuid.UUID,
        data: RegisterCustodianKeyInput,
    ) -> ConnectionResult:
        """Supplier registers a custodian API key for a connection.

        Transitions: accepted → active (or suspended → active on re-key).

        Security contract:
        - data.plaintext_key is passed to SecretStore.store() immediately.
        - It is NEVER assigned to any variable that is logged.
        - On validation failure, the stored secret is deleted via SecretStore.delete(ref).
        - CustodianAdapter.validate_key() is called after storing, not before.
          This ensures the key is cleaned up even if validate_key raises an exception.

        Role check: caller must be supplier.
        Ownership check: connection.supplier_id must match caller.org_id.
        State check: connection must be accepted or suspended.
        """
        if caller.role != "supplier":
            raise Forbidden("Only suppliers can register custodian API keys")
        if caller.org_id is None:
            raise Forbidden("Caller has no associated organization")

        connection = await self.connections.get(connection_id)

        if connection.supplier_id != caller.org_id:
            raise Forbidden("This connection does not belong to your organization")

        if connection.status not in ("accepted", "suspended"):
            raise ConflictError(
                f"Connection is in '{connection.status}' status; cannot register a key",
                code="invalid_connection_status",
            )

        # Store the plaintext key immediately — get an opaque ref.
        # plaintext_key must not appear in any log statement.
        ref = self.secret_store.store(data.plaintext_key)
        log.info(
            "custodian_key_stored connection_id=%s ref=%s custodian_id=%s",
            connection_id, ref, data.custodian_id,
        )

        # Validate the key against the custodian adapter.
        # On failure: delete the stored secret, return error.
        try:
            is_valid = await self.custodian_adapter.validate_key()
        except Exception as exc:
            self.secret_store.delete(ref)
            log.error(
                "custodian_key_validation_error connection_id=%s custodian_id=%s error=%s",
                connection_id, data.custodian_id, str(exc),
            )
            raise ValidationError(
                "Custodian adapter raised an error during key validation",
                code="custodian_key_invalid",
            ) from exc

        if not is_valid:
            self.secret_store.delete(ref)
            log.warning(
                "custodian_key_invalid connection_id=%s custodian_id=%s",
                connection_id, data.custodian_id,
            )
            raise ValidationError(
                "The provided API key was rejected by the custodian",
                code="custodian_key_invalid",
            )

        # Create the CustodianLink row — stores only the ref, never the plaintext key.
        custodian_link = await self.custodian_links.create(
            id=uuid.uuid4(),
            org_id=caller.org_id,
            custodian_id=data.custodian_id,
            account_ref=data.account_ref,
            encrypted_api_key_ref=ref,
            scope={},
            status="active",
        )
        log.info(
            "custodian_link_created link_id=%s connection_id=%s",
            custodian_link.id, connection_id,
        )

        # Attach link and activate the connection.
        now = datetime.now(timezone.utc)
        connection = await self.connections.update(
            connection,
            custodian_link_id=custodian_link.id,
            status="active",
            activated_at=now,
        )
        log.info(
            "connection_activated connection_id=%s supplier_id=%s agent_id=%s",
            connection_id, caller.org_id, connection.agent_id,
        )
        return _to_result(connection)

    # ── F-025 — suspend ───────────────────────────────────────────────────────

    async def suspend(
        self, caller: AuthUser, connection_id: uuid.UUID
    ) -> ConnectionResult:
        """Either party can suspend an active connection.

        Role check: caller must be supplier or agent.
        Ownership check: caller's org must be either supplier_id or agent_id.
        State check: connection must be active.
        """
        connection = await self._get_and_assert_membership(caller, connection_id)

        if connection.status not in ("active",):
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

    # ── F-025 — terminate ─────────────────────────────────────────────────────

    async def terminate(
        self, caller: AuthUser, connection_id: uuid.UUID
    ) -> TerminateResult:
        """Either party can terminate a connection.

        On termination:
        - Flags all active loans (no-op stub in M2 — loans table does not exist yet).
        - Sends 'connection_terminated_rotate_key' notification to both parties.
        - The platform does NOT revoke the custodian key — supplier must do this manually.

        Role check: caller must be supplier or agent.
        Ownership check: caller's org must be either supplier_id or agent_id.
        State check: connection must not already be terminated.
        """
        connection = await self._get_and_assert_membership(caller, connection_id)

        if connection.status == "terminated":
            raise ConflictError(
                "Connection is already terminated",
                code="connection_already_terminated",
            )

        # Stub: flag active loans. Returns [] in M2 (loans table does not exist yet).
        flagged_loan_ids: list[uuid.UUID] = await self.connections.list_active_loans_by_connection(connection_id)

        connection = await self.connections.update(connection, status="terminated")
        log.info(
            "connection_terminated connection_id=%s by_org_id=%s flagged_loans=%d",
            connection_id, caller.org_id, len(flagged_loan_ids),
        )

        # Alert supplier to rotate custodian key — platform cannot revoke it.
        await self.notifier.send(NotificationEvent(
            event="connection_terminated_rotate_key",
            recipients=[caller.user_id],
            payload={
                "connection_id": str(connection_id),
                "flagged_loan_ids": [str(lid) for lid in flagged_loan_ids],
                "action_required": "Rotate the custodian API key for this connection",
            },
        ))
        return TerminateResult(
            connection_id=connection_id,
            status="terminated",
            flagged_loan_ids=flagged_loan_ids,
        )

    # ── F-026 — list and detail ───────────────────────────────────────────────

    async def list_for_org(self, caller: AuthUser) -> ConnectionListResult:
        """Return connections visible to the calling org.

        Admin sees all connections.
        Supplier sees only connections where supplier_id = caller.org_id.
        Agent sees only connections where agent_id = caller.org_id.
        """
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
        """Return detail for a single connection.

        403 if the caller's org is not either the supplier or the agent on this connection.
        Admin can access any connection.
        """
        connection = await self.connections.get(connection_id)  # 404 if not found

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
        """Fetch connection and verify caller's org is a party to it."""
        if caller.role not in ("supplier", "agent"):
            raise Forbidden("Only suppliers and agents can perform this action")
        if caller.org_id is None:
            raise Forbidden("Caller has no associated organization")
        connection = await self.connections.get(connection_id)  # 404 if missing
        if caller.org_id not in (connection.supplier_id, connection.agent_id):
            raise Forbidden("Your organization is not a party to this connection")
        return connection
