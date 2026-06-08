"""Agreement domain service — F-028 through F-031.

No FastAPI imports. All inputs are typed dataclasses; all outputs are typed result
dataclasses. All exceptions are DomainError subclasses from app/core/errors.py.
"""
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal

from app.core.errors import ConflictError, Forbidden, NotFoundError
from app.models.user import User
from app.notifications.interface import NotificationEvent, NotificationService
from app.repositories.agreement_repository import AgreementRepository
from app.repositories.connection_repository import ConnectionRepository
from app.repositories.user_repository import UserRepository
from app.schemas.auth import AuthUser

log = logging.getLogger("lendrail.services.agreement")


# ── Input DTOs ─────────────────────────────────────────────────────────────────

@dataclass
class AgreementTermsInput:
    assets_in_scope: list[str]
    eligible_collateral: list[str]
    initial_ltv_pct: Decimal
    margin_call_ltv_pct: Decimal
    recall_notice_days: int
    max_loan_days: int
    day_count_basis: str
    agent_fee_bps: int


# ── Output DTO ─────────────────────────────────────────────────────────────────

@dataclass
class AgreementResult:
    id: uuid.UUID
    connection_id: uuid.UUID
    version: int
    assets_in_scope: list[str]
    eligible_collateral: list[str]
    initial_ltv_pct: Decimal
    margin_call_ltv_pct: Decimal
    recall_notice_days: int
    max_loan_days: int
    day_count_basis: str
    agent_fee_bps: int
    confirmed_by_supplier_at: datetime | None
    confirmed_by_agent_at: datetime | None
    status: Literal["pending_confirmation", "active"]
    created_at: datetime


# ── Private helpers ────────────────────────────────────────────────────────────

def _to_result(a) -> AgreementResult:
    status: Literal["pending_confirmation", "active"] = (
        "active" if a.is_active else "pending_confirmation"
    )
    return AgreementResult(
        id=a.id,
        connection_id=a.connection_id,
        version=a.version,
        assets_in_scope=list(a.assets_in_scope),
        eligible_collateral=list(a.eligible_collateral),
        initial_ltv_pct=Decimal(str(a.initial_ltv_pct)),
        margin_call_ltv_pct=Decimal(str(a.margin_call_ltv_pct)),
        recall_notice_days=a.recall_notice_days,
        max_loan_days=a.max_loan_days,
        day_count_basis=a.day_count_basis,
        agent_fee_bps=a.agent_fee_bps,
        confirmed_by_supplier_at=a.confirmed_by_supplier_at,
        confirmed_by_agent_at=a.confirmed_by_agent_at,
        status=status,
        created_at=a.created_at,
    )


# ── Service ────────────────────────────────────────────────────────────────────

class AgreementService:
    def __init__(
        self,
        agreements: AgreementRepository,
        connections: ConnectionRepository,
        users: UserRepository,
        notifier: NotificationService,
    ) -> None:
        self.agreements = agreements
        self.connections = connections
        self.users = users
        self.notifier = notifier

    async def _users_for_org(self, org_id: uuid.UUID) -> list[uuid.UUID]:
        """Return list of user_ids belonging to the given org."""
        org_users = await self.users.list_where(User.org_id == org_id)
        return [u.id for u in org_users]

    # ── F-029 — create ────────────────────────────────────────────────────────

    async def create_agreement(
        self,
        caller: AuthUser,
        connection_id: uuid.UUID,
        data: AgreementTermsInput,
    ) -> AgreementResult:
        """Agent creates the first (or a replacement) agreement for a connection."""
        # 1. Role check
        if caller.role != "agent":
            raise Forbidden("Only agents can create lending agreements")

        # 2. Fetch connection
        connection = await self.connections.get(connection_id)

        # 3. Ownership check
        if connection.agent_id != caller.org_id:
            raise Forbidden("This connection does not belong to your organization")

        # 4. State check
        if connection.status != "active":
            raise ConflictError(
                "Connection is not active",
                code="connection_not_active",
            )

        # 5. Pending agreement guard + version calculation
        latest = await self.agreements.get_latest_for_connection(connection_id)
        if latest is not None and not latest.is_active:
            raise ConflictError(
                "A pending (unconfirmed) agreement already exists for this connection",
                code="pending_agreement_exists",
            )
        version = (latest.version + 1) if latest is not None else 1

        # 6. Create agreement row
        agreement = await self.agreements.create(
            id=uuid.uuid4(),
            connection_id=connection_id,
            version=version,
            assets_in_scope=data.assets_in_scope,
            eligible_collateral=data.eligible_collateral,
            initial_ltv_pct=data.initial_ltv_pct,
            margin_call_ltv_pct=data.margin_call_ltv_pct,
            recall_notice_days=data.recall_notice_days,
            max_loan_days=data.max_loan_days,
            day_count_basis=data.day_count_basis,
            agent_fee_bps=data.agent_fee_bps,
            confirmed_by_supplier_at=None,
            confirmed_by_agent_at=None,
        )
        log.info(
            "agreement_created agreement_id=%s connection_id=%s version=%d",
            agreement.id,
            connection_id,
            version,
        )

        # 7. Notify: agent caller + supplier org's users
        supplier_user_ids = await self._users_for_org(connection.supplier_id)
        recipients = list({caller.user_id} | set(supplier_user_ids))
        await self.notifier.send(
            NotificationEvent(
                event="agreement_pending_supplier_confirmation",
                recipients=recipients,
                payload={
                    "agreement_id": str(agreement.id),
                    "connection_id": str(connection_id),
                    "supplier_id": str(connection.supplier_id),
                    "version": version,
                },
            )
        )
        return _to_result(agreement)

    # ── F-030 — confirm ───────────────────────────────────────────────────────

    async def confirm_agreement(
        self, caller: AuthUser, agreement_id: uuid.UUID
    ) -> AgreementResult:
        """Either party confirms the current agreement version."""
        # 1. Role check
        if caller.role not in ("supplier", "agent"):
            raise Forbidden("Only suppliers and agents can confirm agreements")

        # 2. Fetch agreement
        agreement = await self.agreements.get(agreement_id)

        # 3. Fetch connection
        connection = await self.connections.get(agreement.connection_id)

        # 4. Ownership check
        if caller.org_id not in (connection.supplier_id, connection.agent_id):
            raise Forbidden("Your organization is not a party to this connection")

        # 5. Version check — can only confirm the latest version
        latest = await self.agreements.get_latest_for_connection(
            agreement.connection_id
        )
        if latest is None or agreement.version != latest.version:
            raise ConflictError(
                "A newer version of this agreement exists; only the latest version may be confirmed",
                code="agreement_superseded",
            )

        now = datetime.now(timezone.utc)

        # 6/7. Apply confirmation by role
        if caller.role == "supplier":
            if agreement.confirmed_by_supplier_at is not None:
                raise ConflictError(
                    "You have already confirmed this agreement",
                    code="already_confirmed",
                )
            agreement = await self.agreements.update(
                agreement, confirmed_by_supplier_at=now
            )
            log.info(
                "agreement_confirmed_by_supplier agreement_id=%s connection_id=%s",
                agreement_id,
                agreement.connection_id,
            )
            agent_user_ids = await self._users_for_org(connection.agent_id)
            await self.notifier.send(
                NotificationEvent(
                    event="agreement_confirmed_by_supplier",
                    recipients=agent_user_ids,
                    payload={
                        "agreement_id": str(agreement_id),
                        "connection_id": str(agreement.connection_id),
                        "agent_id": str(connection.agent_id),
                        "version": agreement.version,
                    },
                )
            )
        else:  # agent
            if agreement.confirmed_by_agent_at is not None:
                raise ConflictError(
                    "You have already confirmed this agreement",
                    code="already_confirmed",
                )
            agreement = await self.agreements.update(
                agreement, confirmed_by_agent_at=now
            )
            log.info(
                "agreement_confirmed_by_agent agreement_id=%s connection_id=%s",
                agreement_id,
                agreement.connection_id,
            )
            supplier_user_ids = await self._users_for_org(connection.supplier_id)
            await self.notifier.send(
                NotificationEvent(
                    event="agreement_confirmed_by_agent",
                    recipients=supplier_user_ids,
                    payload={
                        "agreement_id": str(agreement_id),
                        "connection_id": str(agreement.connection_id),
                        "supplier_id": str(connection.supplier_id),
                        "version": agreement.version,
                    },
                )
            )

        return _to_result(agreement)

    # ── F-031 — amend ─────────────────────────────────────────────────────────

    async def amend_agreement(
        self,
        caller: AuthUser,
        agreement_id: uuid.UUID,
        data: AgreementTermsInput,
    ) -> AgreementResult:
        """Agent amends an agreement — creates a new version row."""
        # 1. Role check
        if caller.role != "agent":
            raise Forbidden("Only agents can amend lending agreements")

        # 2. Fetch agreement
        old_agreement = await self.agreements.get(agreement_id)

        # 3. Fetch connection
        connection = await self.connections.get(old_agreement.connection_id)

        # 4. Ownership check
        if connection.agent_id != caller.org_id:
            raise Forbidden("This connection does not belong to your organization")

        # 5. Version check — can only amend the current (latest) version
        latest = await self.agreements.get_latest_for_connection(
            old_agreement.connection_id
        )
        if latest is None or old_agreement.version != latest.version:
            raise ConflictError(
                "Only the latest agreement version can be amended",
                code="agreement_not_current_version",
            )

        new_version = latest.version + 1

        # 6. Create new version row (old row is NOT modified)
        new_agreement = await self.agreements.create(
            id=uuid.uuid4(),
            connection_id=old_agreement.connection_id,
            version=new_version,
            assets_in_scope=data.assets_in_scope,
            eligible_collateral=data.eligible_collateral,
            initial_ltv_pct=data.initial_ltv_pct,
            margin_call_ltv_pct=data.margin_call_ltv_pct,
            recall_notice_days=data.recall_notice_days,
            max_loan_days=data.max_loan_days,
            day_count_basis=data.day_count_basis,
            agent_fee_bps=data.agent_fee_bps,
            confirmed_by_supplier_at=None,
            confirmed_by_agent_at=None,
        )
        log.info(
            "agreement_amended old_agreement_id=%s new_agreement_id=%s connection_id=%s new_version=%d",
            agreement_id,
            new_agreement.id,
            old_agreement.connection_id,
            new_version,
        )

        # 7. Notify both agent caller and supplier org's users
        supplier_user_ids = await self._users_for_org(connection.supplier_id)
        recipients = list({caller.user_id} | set(supplier_user_ids))
        await self.notifier.send(
            NotificationEvent(
                event="agreement_requires_reconfirmation",
                recipients=recipients,
                payload={
                    "old_agreement_id": str(agreement_id),
                    "new_agreement_id": str(new_agreement.id),
                    "connection_id": str(old_agreement.connection_id),
                    "new_version": new_version,
                },
            )
        )
        return _to_result(new_agreement)

    # ── Read: single agreement ────────────────────────────────────────────────

    async def get_agreement(
        self, caller: AuthUser, agreement_id: uuid.UUID
    ) -> AgreementResult:
        """Fetch a single agreement; caller must be a party to the connection."""
        agreement = await self.agreements.get(agreement_id)
        connection = await self.connections.get(agreement.connection_id)

        if caller.org_id not in (connection.supplier_id, connection.agent_id):
            raise Forbidden("Your organization is not a party to this connection")

        return _to_result(agreement)

    # ── Read: latest for connection ───────────────────────────────────────────

    async def get_latest_for_connection(
        self, caller: AuthUser, connection_id: uuid.UUID
    ) -> AgreementResult:
        """Return the latest agreement version for a connection."""
        connection = await self.connections.get(connection_id)

        if caller.org_id not in (connection.supplier_id, connection.agent_id):
            raise Forbidden("Your organization is not a party to this connection")

        latest = await self.agreements.get_latest_for_connection(connection_id)
        if latest is None:
            raise NotFoundError(
                f"No agreement found for connection {connection_id}",
                code="not_found",
            )
        return _to_result(latest)

    # ── Read: history ─────────────────────────────────────────────────────────

    async def list_history(
        self, caller: AuthUser, connection_id: uuid.UUID
    ) -> list[AgreementResult]:
        """Return all agreement versions for a connection ordered by version ASC."""
        connection = await self.connections.get(connection_id)

        if caller.org_id not in (connection.supplier_id, connection.agent_id):
            raise Forbidden("Your organization is not a party to this connection")

        agreements = await self.agreements.list_for_connection(connection_id)
        return [_to_result(a) for a in agreements]
