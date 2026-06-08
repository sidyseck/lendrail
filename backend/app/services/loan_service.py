"""Loan domain service — M4 loan lifecycle."""
import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal

from app.adapters.interfaces import CustodianAdapter, MarketDataAdapter
from app.core.errors import AdapterError, ConflictError, Forbidden, NotFoundError, ValidationError
from app.models.user import User
from app.notifications.interface import NotificationEvent, NotificationService
from app.repositories.agreement_repository import AgreementRepository
from app.repositories.borrower_repository import BorrowerRepository
from app.repositories.connection_repository import ConnectionRepository
from app.repositories.custodian_link_repository import CustodianLinkRepository
from app.repositories.loan_repository import (
    ApprovedBorrowerRepository,
    LoanRepository,
    LoanTransitionRepository,
)
from app.repositories.user_repository import UserRepository
from app.schemas.auth import AuthUser

log = logging.getLogger("lendrail.services.loan")

LoanState = Literal["pending", "active", "margin_call", "recall_initiated", "settled", "defaulted"]
TermType = Literal["open", "fixed"]


@dataclass
class LoanBookingInput:
    connection_id: uuid.UUID
    borrower_id: uuid.UUID
    asset_type: str
    quantity: Decimal
    rate_bps: int
    term_type: TermType
    maturity_date: date | None
    collateral_type: str
    collateral_quantity: Decimal
    collateral_value_usd: Decimal


@dataclass
class CollateralSubstitutionInput:
    collateral_type: str
    collateral_quantity: Decimal
    collateral_value_usd: Decimal


@dataclass
class ApprovedBorrowerResult:
    borrower_id: uuid.UUID
    name: str
    jurisdiction: str
    status: str
    approved_at: datetime


@dataclass
class LoanResult:
    id: uuid.UUID
    connection_id: uuid.UUID
    agreement_id: uuid.UUID
    borrower_id: uuid.UUID
    borrower_name: str
    asset_type: str
    quantity: Decimal
    rate_bps: int
    term_type: str
    maturity_date: date | None
    day_count_basis: str
    collateral_type: str
    collateral_quantity: Decimal
    collateral_value_usd: Decimal
    current_ltv_pct: Decimal | None
    ltv_as_of: datetime | None
    state: str
    booked_at: datetime
    activated_at: datetime | None
    recall_initiated_at: datetime | None
    recall_notice_deadline_at: datetime | None
    return_custodian_ref: str | None
    return_instruction_at: datetime | None
    settled_at: datetime | None
    defaulted_at: datetime | None


def _decimal(value: object) -> Decimal:
    return Decimal(str(value))


def _to_result(loan, borrower_name: str) -> LoanResult:
    return LoanResult(
        id=loan.id,
        connection_id=loan.connection_id,
        agreement_id=loan.agreement_id,
        borrower_id=loan.borrower_id,
        borrower_name=borrower_name,
        asset_type=loan.asset_type,
        quantity=_decimal(loan.quantity),
        rate_bps=loan.rate_bps,
        term_type=loan.term_type,
        maturity_date=loan.maturity_date,
        day_count_basis=loan.day_count_basis,
        collateral_type=loan.collateral_type,
        collateral_quantity=_decimal(loan.collateral_quantity),
        collateral_value_usd=_decimal(loan.collateral_value_usd),
        current_ltv_pct=_decimal(loan.current_ltv_pct) if loan.current_ltv_pct is not None else None,
        ltv_as_of=loan.ltv_as_of,
        state=loan.state,
        booked_at=loan.booked_at,
        activated_at=loan.activated_at,
        recall_initiated_at=loan.recall_initiated_at,
        recall_notice_deadline_at=loan.recall_notice_deadline_at,
        return_custodian_ref=loan.return_custodian_ref,
        return_instruction_at=loan.return_instruction_at,
        settled_at=loan.settled_at,
        defaulted_at=loan.defaulted_at,
    )


class LoanService:
    def __init__(
        self,
        loans: LoanRepository,
        approved_borrowers: ApprovedBorrowerRepository,
        transitions: LoanTransitionRepository,
        borrowers: BorrowerRepository,
        connections: ConnectionRepository,
        agreements: AgreementRepository,
        custodian_links: CustodianLinkRepository,
        users: UserRepository,
        custodian: CustodianAdapter,
        market_data: MarketDataAdapter,
        notifier: NotificationService,
    ) -> None:
        self.loans = loans
        self.approved_borrowers = approved_borrowers
        self.transitions = transitions
        self.borrowers = borrowers
        self.connections = connections
        self.agreements = agreements
        self.custodian_links = custodian_links
        self.users = users
        self.custodian = custodian
        self.market_data = market_data
        self.notifier = notifier

    async def _users_for_connection(self, supplier_id: uuid.UUID, agent_id: uuid.UUID) -> list[uuid.UUID]:
        rows = await self.users.list_where(User.org_id.in_([supplier_id, agent_id]))
        return [u.id for u in rows]

    async def _connection_for_member(self, caller: AuthUser, connection_id: uuid.UUID):
        connection = await self.connections.get(connection_id)
        if caller.role != "admin" and caller.org_id not in (connection.supplier_id, connection.agent_id):
            raise Forbidden("Your organization is not a party to this connection")
        return connection

    async def _supplier_account_ref(self, supplier_id: uuid.UUID) -> str:
        links = await self.custodian_links.list_by_org(supplier_id)
        active = next((link for link in links if link.status == "active"), None)
        if active is None:
            raise ConflictError("Supplier has no active custodian link", code="no_active_custodian_link")
        return active.account_ref

    async def _notify_connection(self, event: str, supplier_id: uuid.UUID, agent_id: uuid.UUID, payload: dict) -> None:
        recipients = await self._users_for_connection(supplier_id, agent_id)
        await self.notifier.send(NotificationEvent(event=event, recipients=recipients, payload=payload))

    async def add_approved_borrower(
        self, caller: AuthUser, connection_id: uuid.UUID, borrower_id: uuid.UUID
    ) -> ApprovedBorrowerResult:
        if caller.role != "agent":
            raise Forbidden("Only agents can approve borrowers for a connection")
        connection = await self.connections.get(connection_id)
        if connection.agent_id != caller.org_id:
            raise Forbidden("This connection does not belong to your organization")
        if connection.status != "active":
            raise ConflictError("Connection is not active", code="connection_not_active")
        borrower = await self.borrowers.get(borrower_id)
        if borrower.invited_by != caller.org_id:
            raise Forbidden("Borrower is not managed by your organization")
        approval = await self.approved_borrowers.add(
            connection_id, borrower_id, approved_by=caller.org_id
        )
        return ApprovedBorrowerResult(
            borrower_id=borrower.id,
            name=borrower.name,
            jurisdiction=borrower.jurisdiction,
            status=borrower.status,
            approved_at=approval.approved_at,
        )

    async def list_approved_borrowers(
        self, caller: AuthUser, connection_id: uuid.UUID
    ) -> list[ApprovedBorrowerResult]:
        await self._connection_for_member(caller, connection_id)
        rows = await self.approved_borrowers.list_for_connection(connection_id)
        return [
            ApprovedBorrowerResult(
                borrower_id=b.id,
                name=b.name,
                jurisdiction=b.jurisdiction,
                status=b.status,
                approved_at=a.approved_at,
            )
            for b, a in rows
        ]

    async def remove_approved_borrower(
        self, caller: AuthUser, connection_id: uuid.UUID, borrower_id: uuid.UUID
    ) -> None:
        connection = await self.connections.get(connection_id)
        if caller.role != "supplier" or connection.supplier_id != caller.org_id:
            raise Forbidden("Only the supplier on this connection can remove approved borrowers")
        await self.approved_borrowers.remove(connection_id, borrower_id)

    async def book_loan(self, caller: AuthUser, data: LoanBookingInput) -> LoanResult:
        if caller.role != "agent":
            raise Forbidden("Only agents can book loans")
        if data.term_type == "fixed" and data.maturity_date is None:
            raise ValidationError("Fixed-term loans require a maturity date", code="maturity_date_required")
        if data.term_type == "open" and data.maturity_date is not None:
            raise ValidationError("Open-term loans must not include a maturity date", code="maturity_date_not_allowed")
        connection = await self.connections.get_for_update(data.connection_id)
        if connection.agent_id != caller.org_id:
            raise Forbidden("This connection does not belong to your organization")
        if connection.status != "active":
            raise ConflictError("Connection is not active", code="connection_not_active")

        latest = await self.agreements.get_latest_for_connection(data.connection_id)
        if latest is None:
            raise ConflictError("No active agreement exists for this connection", code="no_active_agreement")
        if not latest.is_active:
            raise ConflictError("Agreement is not fully confirmed", code="agreement_not_fully_confirmed")
        agreement = latest

        borrower = await self.borrowers.get(data.borrower_id)
        if borrower.invited_by != caller.org_id:
            raise Forbidden("Borrower is not managed by your organization")
        if not await self.approved_borrowers.exists(data.connection_id, data.borrower_id):
            raise ValidationError("Borrower is not approved for this connection", code="borrower_not_approved")
        if data.asset_type not in agreement.assets_in_scope:
            raise ValidationError("Asset is not in scope for this agreement", code="asset_not_in_scope")
        if data.collateral_type not in agreement.eligible_collateral:
            raise ValidationError("Collateral is not eligible for this agreement", code="collateral_not_eligible")
        if data.term_type == "fixed" and data.maturity_date is not None:
            max_maturity = date.today() + timedelta(days=agreement.max_loan_days)
            if data.maturity_date > max_maturity:
                raise ValidationError("Loan maturity exceeds agreement max loan days", code="max_loan_days_exceeded")

        price = await self.market_data.get_price(data.asset_type)
        loan_value = data.quantity * _decimal(price.price_usd)
        ltv = (data.collateral_value_usd / loan_value) * Decimal("100")
        if ltv > _decimal(agreement.initial_ltv_pct):
            raise ValidationError("Initial LTV exceeds agreement threshold", code="ltv_exceeded")

        scope: dict[str, str] = connection.inventory_scope or {}
        published_raw = scope.get(data.asset_type)
        if published_raw is None:
            raise ValidationError(
                f"No inventory published for {data.asset_type} on this connection",
                code="no_inventory_published",
            )

        published_qty = _decimal(published_raw)
        already_booked = await self.loans.sum_booked_quantity(data.connection_id, data.asset_type)
        remaining = published_qty - already_booked
        if data.quantity > remaining:
            raise ValidationError(
                f"Quantity {data.quantity} exceeds remaining published inventory "
                f"{remaining} ({published_qty} published - {already_booked} already booked)",
                code="exceeds_published_inventory",
            )

        account_ref = await self._supplier_account_ref(connection.supplier_id)
        inventory = await self.custodian.get_inventory(account_ref)
        available = sum(
            _decimal(position.quantity)
            for position in inventory
            if position.asset_type == data.asset_type
        )
        if available < data.quantity:
            raise ValidationError("Insufficient supplier inventory", code="insufficient_inventory")

        collateral_ref = str(data.borrower_id)
        collateral = await self.custodian.get_collateral(collateral_ref)
        if collateral is not None and _decimal(collateral.value_usd) < data.collateral_value_usd:
            raise ValidationError("Insufficient collateral at custodian", code="insufficient_collateral")

        loan = await self.loans.create(
            id=uuid.uuid4(),
            connection_id=data.connection_id,
            agreement_id=agreement.id,
            borrower_id=data.borrower_id,
            asset_type=data.asset_type,
            quantity=data.quantity,
            rate_bps=data.rate_bps,
            term_type=data.term_type,
            maturity_date=data.maturity_date,
            day_count_basis=agreement.day_count_basis,
            collateral_type=data.collateral_type,
            collateral_quantity=data.collateral_quantity,
            collateral_value_usd=data.collateral_value_usd,
            current_ltv_pct=ltv,
            state="pending",
        )
        await self.transitions.record(
            loan_id=loan.id,
            from_state=None,
            to_state="pending",
            reason="loan_booked",
            actor_org_id=caller.org_id,
            actor_user_id=caller.user_id,
        )
        await self._notify_connection(
            "loan_booked",
            connection.supplier_id,
            connection.agent_id,
            {"loan_id": str(loan.id), "connection_id": str(connection.id), "state": "pending"},
        )
        return _to_result(loan, borrower.name)

    async def list_loans(self, caller: AuthUser, state: str | None = None) -> list[LoanResult]:
        if caller.role not in ("supplier", "agent"):
            raise Forbidden("Only suppliers and agents can list loans")
        rows = await self.loans.list_visible_for_org(caller.org_id, caller.role, state)
        return [_to_result(loan, borrower_name) for loan, borrower_name in rows]

    async def get_loan(self, caller: AuthUser, loan_id: uuid.UUID) -> LoanResult:
        loan, borrower_name, _connection = await self.loans.get_visible_for_org(loan_id, caller.org_id, caller.role)
        return _to_result(loan, borrower_name)

    async def recall(self, caller: AuthUser, loan_id: uuid.UUID) -> LoanResult:
        if caller.role not in ("supplier", "agent"):
            raise Forbidden("Only suppliers and agents can recall loans")
        loan, borrower_name, connection = await self.loans.get_visible_for_org(loan_id, caller.org_id, caller.role)
        if loan.state != "active":
            raise ConflictError("Only active loans can be recalled", code="invalid_loan_state")
        agreement = await self.agreements.get(loan.agreement_id)
        now = datetime.now(timezone.utc)
        deadline = now + timedelta(days=agreement.recall_notice_days)
        loan = await self.loans.update(
            loan,
            state="recall_initiated",
            recall_initiated_at=now,
            recall_notice_deadline_at=deadline,
        )
        await self.transitions.record(
            loan_id=loan.id,
            from_state="active",
            to_state="recall_initiated",
            reason="recall_initiated",
            actor_org_id=caller.org_id,
            actor_user_id=caller.user_id,
        )
        await self._notify_connection(
            "recall_initiated",
            connection.supplier_id,
            connection.agent_id,
            {"loan_id": str(loan.id), "notice_deadline": deadline.isoformat()},
        )
        return _to_result(loan, borrower_name)

    async def return_assets(self, caller: AuthUser, loan_id: uuid.UUID) -> LoanResult:
        if caller.role != "agent":
            raise Forbidden("Only agents can return loan assets")
        loan, borrower_name, connection = await self.loans.get_visible_for_org(loan_id, caller.org_id, caller.role)
        if connection.agent_id != caller.org_id:
            raise Forbidden("This loan does not belong to your organization")
        if loan.state != "recall_initiated":
            raise ConflictError("Only recalled loans can be returned", code="invalid_loan_state")
        account_ref = await self._supplier_account_ref(connection.supplier_id)
        result = await self.custodian.transmit_instruction(
            instruction_type="return",
            asset_type=loan.asset_type,
            quantity=float(loan.quantity),
            from_account=str(loan.borrower_id),
            to_account=account_ref,
            agent_ref=str(loan.id),
        )
        if not result.success:
            raise AdapterError(
                result.error_msg or "Custodian return instruction failed",
                code="custodian_instruction_failed",
            )
        loan = await self.loans.update(
            loan,
            state="settled",
            return_custodian_ref=result.custodian_ref,
            return_instruction_at=result.executed_at,
            settled_at=result.executed_at,
        )
        await self.transitions.record(
            loan_id=loan.id,
            from_state="recall_initiated",
            to_state="settled",
            reason="return_confirmed",
            actor_org_id=caller.org_id,
            actor_user_id=caller.user_id,
            metadata={"custodian_ref": result.custodian_ref},
        )
        await self._notify_connection(
            "loan_settled",
            connection.supplier_id,
            connection.agent_id,
            {"loan_id": str(loan.id), "custodian_ref": result.custodian_ref},
        )
        return _to_result(loan, borrower_name)

    async def substitute_collateral(
        self, caller: AuthUser, loan_id: uuid.UUID, data: CollateralSubstitutionInput
    ) -> LoanResult:
        if caller.role != "agent":
            raise Forbidden("Only agents can substitute collateral")
        loan, borrower_name, connection = await self.loans.get_visible_for_org(loan_id, caller.org_id, caller.role)
        if loan.state not in ("active", "margin_call"):
            raise ConflictError("Collateral can only be substituted on active or margin-call loans", code="invalid_loan_state")
        agreement = await self.agreements.get(loan.agreement_id)
        if data.collateral_type not in agreement.eligible_collateral:
            raise ValidationError("Collateral is not eligible for this agreement", code="collateral_not_eligible")
        price = await self.market_data.get_price(loan.asset_type)
        ltv = (data.collateral_value_usd / (_decimal(loan.quantity) * _decimal(price.price_usd))) * Decimal("100")
        if ltv > _decimal(agreement.initial_ltv_pct):
            raise ValidationError("Initial LTV exceeds agreement threshold", code="ltv_exceeded")
        loan = await self.loans.update(
            loan,
            collateral_type=data.collateral_type,
            collateral_quantity=data.collateral_quantity,
            collateral_value_usd=data.collateral_value_usd,
            current_ltv_pct=ltv,
            ltv_as_of=price.as_of,
        )
        await self.transitions.record(
            loan_id=loan.id,
            from_state=loan.state,
            to_state=loan.state,
            reason="collateral_substituted",
            actor_org_id=caller.org_id,
            actor_user_id=caller.user_id,
        )
        await self._notify_connection(
            "collateral_substituted",
            connection.supplier_id,
            connection.agent_id,
            {"loan_id": str(loan.id), "collateral_type": data.collateral_type},
        )
        return _to_result(loan, borrower_name)

    async def mark_defaulted(self, caller: AuthUser, loan_id: uuid.UUID) -> LoanResult:
        if caller.role not in ("agent", "admin"):
            raise Forbidden("Only agents and admins can default loans")
        loan, borrower_name, connection = await self.loans.get_visible_for_org(loan_id, caller.org_id, caller.role)
        if caller.role == "agent" and connection.agent_id != caller.org_id:
            raise Forbidden("This loan does not belong to your organization")
        if loan.state != "recall_initiated":
            raise ConflictError("Only recalled loans can be defaulted", code="invalid_loan_state")
        now = datetime.now(timezone.utc)
        loan = await self.loans.update(loan, state="defaulted", defaulted_at=now)
        await self.transitions.record(
            loan_id=loan.id,
            from_state="recall_initiated",
            to_state="defaulted",
            reason="loan_defaulted",
            actor_org_id=caller.org_id,
            actor_user_id=caller.user_id,
        )
        await self._notify_connection(
            "loan_defaulted",
            connection.supplier_id,
            connection.agent_id,
            {"loan_id": str(loan.id), "defaulted_at": now.isoformat()},
        )
        return _to_result(loan, borrower_name)

    async def activate_pending_loans(self) -> int:
        loans = await self.loans.list_by_state("pending")
        activated = 0
        for loan in loans:
            connection = await self.connections.get(loan.connection_id)
            account_ref = await self._supplier_account_ref(connection.supplier_id)
            inventory = await self.custodian.get_inventory(account_ref)
            available = sum(
                _decimal(position.quantity)
                for position in inventory
                if position.asset_type == loan.asset_type
            )
            collateral = await self.custodian.get_collateral(str(loan.id))
            if available < _decimal(loan.quantity) or collateral is None:
                continue
            now = datetime.now(timezone.utc)
            await self.loans.update(
                loan,
                state="active",
                activated_at=now,
                current_ltv_pct=(
                    _decimal(collateral.value_usd)
                    / (_decimal(loan.quantity) * _decimal((await self.market_data.get_price(loan.asset_type)).price_usd))
                    * Decimal("100")
                ),
                ltv_as_of=collateral.as_of,
            )
            await self.transitions.record(
                loan_id=loan.id,
                from_state="pending",
                to_state="active",
                reason="custodian_confirmed",
            )
            await self._notify_connection(
                "loan_activated",
                connection.supplier_id,
                connection.agent_id,
                {"loan_id": str(loan.id), "activated_at": now.isoformat()},
            )
            activated += 1
        return activated
