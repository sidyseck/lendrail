# LendRail — F-061 Inventory Scope Technical Specification

| Field | Value |
|---|---|
| Feature | F-061 — Connection inventory scope: supplier publishes lendable quantity |
| Milestone | M2 (extension) |
| Scope | Backend: migration, model, service, router, loan booking guard. Frontend: inventory UI on connection detail. |
| Based on | FEATURES.md F-061, MASTER_PRD.md v0.1, M2-backend-techspec.md (rev 2), M4-loan-lifecycle-techspec.md |
| Audience | Engineer implementing F-061 against the M4 codebase |
| Status | Implementation-ready spec |

---

## 0. Purpose and guiding principles

F-061 adds the concept of a **published inventory allocation** to each supplier-agent connection. A supplier's custodian holds their total asset balance across any number of asset types. Before a loan can be booked, the supplier must explicitly declare how much of that balance is available to lend through each connection. The agent sees effective availability for published assets — never the raw custodian balance or the raw published cap.

**The three quantities that matter:**

| Quantity | Source | Who sees it |
|---|---|---|
| `custodian_balance` | Live call to `CustodianAdapter.get_inventory()` | Supplier only |
| `published_quantity` | `connections.inventory_scope[asset_type]` | Supplier only in API responses; used internally to compute agent-visible availability |
| `effective_available` | `min(custodian_balance, published_quantity) − already_booked` | Supplier + Agent |

**"Already booked"** = sum of `quantity` across all loans on this connection for this asset type where `state IN ('pending', 'active', 'margin_call', 'recall_initiated')`. Settled and defaulted loans do not count.

**Non-negotiable conventions (identical to M0–M4):**

- Layer boundaries: `API (routers) → domain services → data (repositories) + adapters`. Services never import FastAPI types.
- Error envelope: all errors `{"error": {"code": "...", "message": "..."}}`.
- Async all the way: SQLAlchemy 2.x async sessions.
- No comments explaining what the code does — only non-obvious WHYs.

---

## §1. Overview

| Component | Change | Notes |
|---|---|---|
| **Migration 0012** | ADD `inventory_scope JSONB NOT NULL DEFAULT '{}'` to `connections` | No data migration needed; `{}` means "nothing published" |
| **`Connection` ORM** | Add `inventory_scope: dict` mapped column | |
| **`ConnectionRepository`** | Add `get_for_update(connection_id)` | Used by loan booking to serialize published-inventory checks |
| **`LoanRepository`** | Add `sum_booked_quantity(connection_id, asset_type)` | Counts non-terminal loans |
| **`ConnectionService`** | Add `set_inventory_scope()` and `get_inventory_scope()` | Supplier-only write; role-aware read |
| **Schemas** | `SetInventoryScopeRequest`, `InventoryScopeResponse` (role-aware shape) | Agent response omits custodian balance |
| **Router** | `PUT /connections/{id}/inventory-scope`, `GET /connections/{id}/inventory` | |
| **`LoanService.book_loan`** | Two new guard checks before custodian inventory call | `no_inventory_published`, `exceeds_published_inventory` |
| **`ConnectionResponse`** | No change | Published quantities remain on the role-aware inventory endpoint, not generic connection list/detail |
| **Frontend** | Supplier inventory scope editor; agent effective-available display | Extends existing `ConnectionsPage` |

---

## §2. Database change

### Migration 0012 — `connections.inventory_scope`

**File:** `backend/alembic/versions/0012_connection_inventory_scope.py`

**Revision:** `0012`
**Down-revision:** `0011`

```python
"""connections.inventory_scope — F-061

Adds an inventory_scope JSONB column to connections.
Stores the supplier's per-asset published quantity cap for each connection.
Example: {"BTC": "100.0", "ETH": "50.0"}

An empty map ({}) means no inventory is published and loan booking is blocked
for all asset types on this connection.

Revision ID: 0012
Revises: 0011
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "connections",
        sa.Column(
            "inventory_scope",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("connections", "inventory_scope")
```

**Column definition:**

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `inventory_scope` | `JSONB` | NOT NULL DEFAULT `{}` | Keys are asset type strings (any value). Values are decimal quantity strings, e.g. `"100.000000000000"`. `{}` = nothing published. |

No index is needed — reads are always by connection PK; the JSONB is read as a whole.

---

## §3. ORM model update

**File:** `backend/app/models/connection.py`

Add one field to the existing `Connection` class:

```python
# After activated_at:
inventory_scope: Mapped[dict] = mapped_column(
    JSONB(), nullable=False, default=dict, server_default=sa.text("'{}'::jsonb")
)
```

Full updated model:

```python
import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Connection(Base):
    __tablename__ = "connections"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("organizations.id",
                   name="fk_connections_supplier_id_organizations",
                   ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    agent_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("organizations.id",
                   name="fk_connections_agent_id_organizations",
                   ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        sa.Enum("pending", "active", "suspended", "terminated",
                name="connection_status_enum", create_type=False),
        nullable=False,
        server_default="pending",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    activated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    inventory_scope: Mapped[dict] = mapped_column(
        JSONB(), nullable=False, default=dict, server_default=sa.text("'{}'::jsonb")
    )
```

---

## §4. Repository change

### 4.1 `ConnectionRepository.get_for_update`

**File:** `backend/app/repositories/connection_repository.py`

Add a lock-aware fetch for loan booking. This prevents two concurrent booking
requests on the same connection from both observing the same remaining published
inventory and oversubscribing the supplier's allocation.

```python
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
```

`LoanService.book_loan()` must use `self.connections.get_for_update()` instead
of `self.connections.get()` for the booking path only. Other connection reads do
not need the lock.

### 4.2 `LoanRepository.sum_booked_quantity`

**File:** `backend/app/repositories/loan_repository.py`

Add the following method to `LoanRepository`. It sums the loan `quantity` for all non-terminal loans on a connection for a given asset type. This is what counts against the published allocation.

```python
from decimal import Decimal
from sqlalchemy import func as sqlfunc

async def sum_booked_quantity(
    self, connection_id: UUID, asset_type: str
) -> Decimal:
    """Return the total quantity of non-terminal loans for an asset on a connection.

    Non-terminal states: pending, active, margin_call, recall_initiated.
    Settled and defaulted loans no longer consume the published allocation.
    """
    result = await self.session.execute(
        select(sqlfunc.coalesce(sqlfunc.sum(Loan.quantity), 0))
        .where(
            Loan.connection_id == connection_id,
            Loan.asset_type == asset_type,
            Loan.state.in_(["pending", "active", "margin_call", "recall_initiated"]),
        )
    )
    return Decimal(str(result.scalar()))
```

---

## §5. Service layer

### 5.1 New DTOs

Add these dataclasses to `backend/app/services/connection_service.py` alongside the existing DTOs:

```python
from decimal import Decimal


@dataclass
class AssetInventoryEntry:
    asset_type: str
    published_quantity: Decimal
    custodian_balance: Decimal | None   # None when caller is agent
    already_booked: Decimal
    effective_available: Decimal


@dataclass
class InventoryScopeResult:
    connection_id: uuid.UUID
    entries: list[AssetInventoryEntry]
```

### 5.2 `ConnectionService.set_inventory_scope`

Add to `ConnectionService`:

```python
async def set_inventory_scope(
    self,
    caller: AuthUser,
    connection_id: uuid.UUID,
    scope: dict[str, Decimal],
) -> ConnectionResult:
    """Supplier sets the per-asset published quantity for a connection.

    Any asset type key is accepted. Quantity must be >= 0.
    Replaces the entire inventory_scope — partial updates are not supported.
    Setting a quantity to 0.0 blocks new bookings for that asset.
    Callable on active or suspended connections.
    """
    if caller.role != "supplier":
        raise Forbidden("Only suppliers can set inventory scope")

    connection = await self.connections.get(connection_id)
    if connection.supplier_id != caller.org_id:
        raise Forbidden("This connection does not belong to your organization")
    if connection.status not in ("active", "suspended"):
        raise ConflictError(
            f"Cannot set inventory scope on a connection with status '{connection.status}'",
            code="invalid_connection_status",
        )

    serialized_scope: dict[str, str] = {}
    for asset_type, qty in scope.items():
        asset = asset_type.strip()
        if not asset:
            raise ValidationError("Asset type must be non-empty", code="invalid_asset_type")
        if qty < 0:
            raise ValidationError(
                f"Published quantity for {asset_type} must be >= 0",
                code="invalid_quantity",
            )
        serialized_scope[asset] = str(qty)

    connection = await self.connections.update(connection, inventory_scope=serialized_scope)
    log.info(
        "inventory_scope_updated connection_id=%s supplier_id=%s assets=%s",
        connection_id, caller.org_id, list(serialized_scope.keys()),
    )
    return _to_result(connection)
```

### 5.3 `ConnectionService.get_inventory_scope`

```python
async def get_inventory_scope(
    self,
    caller: AuthUser,
    connection_id: uuid.UUID,
    loan_repo,   # LoanRepository — injected by the router via DI
) -> InventoryScopeResult:
    """Return inventory scope for a connection.

    Supplier response: custodian_balance, published_quantity, already_booked, effective_available per asset.
    Agent response: effective_available per asset only (custodian_balance is None).

    The union of all asset types in inventory_scope AND in the live custodian inventory
    is returned. Assets in the custodian but not in inventory_scope have published_quantity=0
    and effective_available=0 (for the supplier's benefit — shows what they haven't published).
    """
    if caller.role not in ("supplier", "agent"):
        raise Forbidden("Only suppliers and agents can view inventory scope")

    connection = await self.connections.get(connection_id)
    if caller.org_id not in (connection.supplier_id, connection.agent_id):
        raise Forbidden("Your organization is not a party to this connection")

    # Pull custodian inventory for both roles so effective_available is truthful.
    # The router redacts custodian_balance for agents.
    custodian_data: dict[str, Decimal] = {}
    account_ref = await self._supplier_account_ref(connection.supplier_id)
    positions = await self.custodian_adapter.get_inventory(account_ref)
    custodian_data = {p.asset_type: Decimal(str(p.quantity)) for p in positions}

    # Union of all asset types: supplier sees published scope + custodian inventory;
    # agent sees published assets only.
    scope: dict[str, str] = connection.inventory_scope or {}
    all_assets: set[str] = set(scope.keys())
    if caller.role == "supplier":
        all_assets |= set(custodian_data.keys())

    entries: list[AssetInventoryEntry] = []
    for asset_type in sorted(all_assets):
        published = Decimal(str(scope.get(asset_type, "0")))
        raw_custodian_bal = custodian_data.get(asset_type, Decimal("0"))
        custodian_bal = raw_custodian_bal if caller.role == "supplier" else None
        already_booked = await loan_repo.sum_booked_quantity(connection_id, asset_type)
        effective = max(
            Decimal("0"),
            min(raw_custodian_bal, published) - already_booked,
        )

        entries.append(AssetInventoryEntry(
            asset_type=asset_type,
            published_quantity=published,
            custodian_balance=custodian_bal,
            already_booked=already_booked,
            effective_available=effective,
        ))

    return InventoryScopeResult(connection_id=connection_id, entries=entries)
```

**Required service wiring:** `ConnectionService` must now receive
`CustodianLinkRepository` and `CustodianAdapter` in addition to its existing
repositories/services, and must add the same `_supplier_account_ref()` helper
shape used by `LoanService`. Update `get_connection_service()` in `deps.py` and
tests that construct `ConnectionService` directly. `LoanRepository` is still
passed to `get_inventory_scope()` from the router to avoid adding a permanent
loan dependency to all connection-service call sites.

### 5.4 `_to_result`

The existing `_to_result` helper remains unchanged:

```python
def _to_result(c) -> ConnectionResult:
    return ConnectionResult(
        id=c.id,
        supplier_id=c.supplier_id,
        agent_id=c.agent_id,
        status=c.status,
        created_at=c.created_at.isoformat(),
        activated_at=c.activated_at.isoformat() if c.activated_at else None,
        pending_agreement=getattr(c, "pending_agreement", False),
    )
```

No `inventory_scope` field is added to `ConnectionResult`; inventory scope is
returned only by the dedicated role-aware inventory endpoint.

---

## §6. Loan booking guard (F-035 extension)

**File:** `backend/app/services/loan_service.py`

Insert two new checks in `LoanService.book_loan`, immediately **before** the existing custodian inventory call (currently at line ~261). The service already has `ConnectionRepository` and `LoanRepository`.

At the start of the booking path, fetch the connection with
`self.connections.get_for_update(data.connection_id)` instead of
`self.connections.get(data.connection_id)`. The row lock must be acquired before
`sum_booked_quantity()` and held through loan creation by the request
transaction.

The checks run after agreement validation passes (asset scope, collateral, LTV) and before the custodian network call, to fail fast on business rules without hitting the custodian.

```python
# ── F-061: published inventory scope checks ──────────────────────────────────

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
        f"{remaining} ({published_qty} published − {already_booked} already booked)",
        code="exceeds_published_inventory",
    )

# ── existing custodian inventory check (unchanged) ────────────────────────────
account_ref = await self._supplier_account_ref(connection.supplier_id)
inventory = await self.custodian.get_inventory(account_ref)
...
```

**Ordering rationale:** The published scope check is a business rule enforced by the platform. The custodian check is a custody fact. Business rules fail first to give clear, actionable errors without incurring a network round-trip.

**Note:** The custodian inventory check (`available >= data.quantity`) is **not removed**. It remains as an independent guard against the case where the custodian balance dropped below the published quantity. Both checks can independently fail; the platform enforces both.

---

## §7. Schemas

**File:** `backend/app/schemas/connections.py`

### 7.1 `SetInventoryScopeRequest`

```python
from decimal import Decimal

class SetInventoryScopeRequest(BaseModel):
    # Keys are asset type strings (any value accepted — no whitelist).
    # Values are published quantities. Must be >= 0.
    # An empty dict ({}) means no inventory is published.
    scope: dict[str, Decimal] = Field(
        default_factory=dict,
        description="Map of asset type → published quantity. Empty map blocks all bookings.",
    )
```

Do not reject negative quantities in the Pydantic model if the implementation
must return `code="invalid_quantity"`. Let `ConnectionService.set_inventory_scope()`
perform that validation and raise the domain `ValidationError`; otherwise the
global request-validation handler will return `code="validation_error"`.

### 7.2 `InventoryScopeEntryResponse` (supplier view)

```python
class InventoryScopeEntrySupplierResponse(BaseModel):
    asset_type: str
    custodian_balance: str       # Decimal serialized as string
    published_quantity: str      # Decimal serialized as string
    already_booked: str          # Decimal serialized as string
    effective_available: str     # Decimal serialized as string


class InventoryScopeEntryAgentResponse(BaseModel):
    asset_type: str
    effective_available: str     # Decimal serialized as string


class InventoryScopeSupplierResponse(BaseModel):
    connection_id: UUID
    entries: list[InventoryScopeEntrySupplierResponse]


class InventoryScopeAgentResponse(BaseModel):
    connection_id: UUID
    entries: list[InventoryScopeEntryAgentResponse]
```

Decimals are serialized as strings throughout to match the pattern established in M3 for `initial_ltv_pct` and `margin_call_ltv_pct`.

### 7.3 `ConnectionResponse`

Do not add `inventory_scope` to `ConnectionResponse`. The current router uses one
mapper for supplier, agent, and admin list/detail responses; adding the raw map
there would leak published quantities outside the role-aware inventory endpoint.

---

## §8. API layer

**File:** `backend/app/api/routers/connections.py`

### 8.1 `PUT /connections/{id}/inventory-scope`

```python
@router.put(
    "/{connection_id}/inventory-scope",
    response_model=ConnectionResponse,
    status_code=status.HTTP_200_OK,
    summary="Supplier sets the published inventory allocation for a connection",
)
async def set_inventory_scope(
    connection_id: uuid.UUID,
    body: SetInventoryScopeRequest,
    caller: AuthUser = Depends(require_role("supplier")),
    svc: ConnectionService = Depends(get_connection_service),
) -> ConnectionResponse:
    """
    Requires supplier JWT. Supplier must own the connection.

    Replaces the entire inventory_scope for the connection.
    Accepts any asset type string. Quantity must be >= 0.
    An empty scope ({}) blocks all loan bookings on this connection.

    Callable on active or suspended connections only.

    Error responses:
    - 403: caller is not a supplier, or is not the supplier on this connection
    - 404: connection_id not found
    - 409: connection is pending or terminated → code="invalid_connection_status"
    - 422: any quantity < 0 → code="invalid_quantity"
    """
    result = await svc.set_inventory_scope(
        caller=caller,
        connection_id=connection_id,
        scope=body.scope,
    )
    return _to_response(result)
```

### 8.2 `GET /connections/{id}/inventory`

```python
from fastapi.responses import JSONResponse as _JSONResponse

@router.get(
    "/{connection_id}/inventory",
    status_code=status.HTTP_200_OK,
    summary="Get inventory scope and availability for a connection",
)
async def get_inventory_scope(
    connection_id: uuid.UUID,
    caller: AuthUser = Depends(get_current_user),
    svc: ConnectionService = Depends(get_connection_service),
    loan_repo: LoanRepository = Depends(get_loan_repository),
):
    """
    Supplier: returns custodian_balance, published_quantity, already_booked,
              effective_available per asset. Includes assets visible in
              custodian inventory but not yet published (to help the supplier
              know what they could publish).
    Agent: returns effective_available per asset only.
           custodian_balance is NOT included in the agent response.

    Error responses:
    - 401: missing/invalid token
    - 403: caller's org is not a party to this connection
    - 404: connection_id not found
    """
    result = await svc.get_inventory_scope(
        caller=caller,
        connection_id=connection_id,
        loan_repo=loan_repo,
    )
    if caller.role == "supplier":
        return InventoryScopeSupplierResponse(
            connection_id=result.connection_id,
            entries=[
                InventoryScopeEntrySupplierResponse(
                    asset_type=e.asset_type,
                    custodian_balance=str(e.custodian_balance),
                    published_quantity=str(e.published_quantity),
                    already_booked=str(e.already_booked),
                    effective_available=str(e.effective_available),
                )
                for e in result.entries
            ],
        )
    return InventoryScopeAgentResponse(
        connection_id=result.connection_id,
        entries=[
            InventoryScopeEntryAgentResponse(
                asset_type=e.asset_type,
                effective_available=str(e.effective_available),
            )
            for e in result.entries
        ],
    )
```

### 8.3 DI additions to `deps.py`

```python
from app.repositories.loan_repository import LoanRepository

def get_loan_repository(session: SessionDep) -> LoanRepository:
    return LoanRepository(session)
```

Update `get_connection_service()` to pass the newly required
`CustodianLinkRepository(session)` and `custodian_adapter` into
`ConnectionService`:

```python
def get_connection_service(
    session: SessionDep,
    custodian_adapter: CustodianAdapter = Depends(get_custodian_adapter),
) -> ConnectionService:
    notifier = ConsoleNotificationAdapter(NotificationRepository(session))
    return ConnectionService(
        connections=ConnectionRepository(session),
        orgs=OrgRepository(session),
        custodian_links=CustodianLinkRepository(session),
        custodian_adapter=custodian_adapter,
        notifier=notifier,
    )
```

`loan_repo` is passed directly from the route handler.

---

## §9. Tests

**File:** `backend/tests/test_connections.py` (extend existing file) or a new `backend/tests/test_inventory_scope.py`.

### 9.1 Inventory scope endpoint tests

```
# PUT /connections/{id}/inventory-scope
test_set_inventory_scope_supplier_success
    - POST /connections/invite → POST /connections/{id}/accept → active connection
    - PUT /connections/{id}/inventory-scope {"scope": {"BTC": "100.0"}} → 200
    - GET /connections/{id}/inventory as supplier → BTC published_quantity == "100.0"

test_set_inventory_scope_agent_forbidden
    - PUT with agent JWT → 403

test_set_inventory_scope_wrong_supplier_forbidden
    - PUT with a different supplier's JWT → 403

test_set_inventory_scope_pending_connection_rejected
    - PUT {"scope": {"BTC": "100.0"}} on pending connection → 409, code="invalid_connection_status"

test_set_inventory_scope_negative_quantity_rejected
    - PUT {"scope": {"BTC": "-1.0"}} → 422, code="invalid_quantity"

test_set_inventory_scope_empty_dict_accepted
    - PUT {"scope": {}} → 200; subsequent GET /inventory has no published assets

test_set_inventory_scope_any_asset_type_accepted
    - PUT {"scope": {"ETH": "50.0", "USDC": "1000000.0"}} → 200

# GET /connections/{id}/inventory
test_get_inventory_scope_supplier_sees_custodian_balance
    - Seed mock custodian with {"BTC": 500.0}
    - SET inventory_scope to {"BTC": "100.0"}
    - GET /connections/{id}/inventory (supplier JWT)
    - Response.entries[0].custodian_balance == "500.0"
    - Response.entries[0].published_quantity == "100.0"
    - Response.entries[0].effective_available == "100.0"  (no booked loans yet)

test_get_inventory_scope_agent_sees_only_effective_available
    - Same setup as above
    - GET with agent JWT
    - Response.entries[0] has only asset_type and effective_available
    - Response.entries[0] has NO custodian_balance key

test_get_inventory_scope_already_booked_subtracted
    - SET inventory_scope {"BTC": "100.0"}
    - Book a loan for 30 BTC → state=pending
    - GET /connections/{id}/inventory (supplier JWT)
    - already_booked == "30.0", effective_available == "70.0"

test_get_inventory_scope_custodian_balance_cap_applied
    - Seed mock custodian with {"BTC": 40.0} (less than published)
    - SET inventory_scope {"BTC": "100.0"}
    - GET → effective_available == "40.0"  (capped by custodian balance)

test_get_inventory_scope_unpublished_asset_visible_to_supplier
    - Seed mock custodian with {"BTC": 500.0, "ETH": 200.0}
    - SET inventory_scope {"BTC": "100.0"}  (ETH not in scope)
    - Supplier GET → two entries: BTC (published=100), ETH (published=0, effective=0)

test_get_inventory_scope_unpublished_asset_hidden_from_agent
    - Same setup
    - Agent GET → only BTC appears in entries (ETH published=0, effective=0 is excluded from agent view)
    # Note: agent response omits assets with effective_available=0 — no point showing them
```

### 9.2 Loan booking guard tests

```
# Extend test_loans.py or test_connections.py

test_book_loan_no_inventory_published
    - Active connection with inventory_scope = {}
    - POST /loans → 422, code="no_inventory_published"

test_book_loan_asset_not_in_scope
    - inventory_scope = {"BTC": "100.0"}
    - Book loan for "ETH" → 422, code="no_inventory_published"

test_book_loan_exceeds_published_inventory
    - inventory_scope = {"BTC": "100.0"}
    - Book loan for 150 BTC → 422, code="exceeds_published_inventory"

test_book_loan_already_booked_counted
    - inventory_scope = {"BTC": "100.0"}
    - Book a 70 BTC loan (succeeds, state=pending)
    - Book a second 40 BTC loan → 422, code="exceeds_published_inventory"
      (100 - 70 = 30 remaining; 40 > 30)

test_book_loan_settled_loans_not_counted
    - inventory_scope = {"BTC": "100.0"}
    - Book a 70 BTC loan, advance to settled state via recall + return
    - Book a new 100 BTC loan → succeeds (settled loan no longer counted)

test_book_loan_within_scope_succeeds
    - inventory_scope = {"BTC": "100.0"}
    - Seed custodian with {"BTC": 500.0}
    - Book 100 BTC → 201 (on boundary, allowed)

test_book_loan_concurrent_requests_do_not_oversubscribe_scope
    - inventory_scope = {"BTC": "100.0"}
    - Seed custodian with {"BTC": 500.0}
    - Launch two booking attempts for 70 BTC against the same active connection
    - Exactly one request succeeds; the other fails with code="exceeds_published_inventory"

Existing M4 booking-success tests must publish inventory before booking. Any test
that previously expected a successful loan booking now needs a setup call to
`PUT /connections/{id}/inventory-scope` with sufficient scope, unless the test is
specifically asserting `no_inventory_published`.
```

---

## §10. Frontend

### 10.1 New and changed files

| File | Change |
|---|---|
| `src/types/connection.ts` | Add `InventoryScopeEntry*` types |
| `src/hooks/useInventoryScope.ts` | New: fetches `GET /connections/{id}/inventory` |
| `src/pages/connections/SupplierConnectionsPage.tsx` | Add "Manage Inventory" panel per connection row |
| `src/pages/connections/AgentConnectionsPage.tsx` | Add effective-available display per connection row |
| `src/mocks/handlers/connections.ts` | Add handlers for `PUT/GET inventory-scope` |

### 10.2 Updated TypeScript types (`src/types/connection.ts`)

```ts
// New types for GET /connections/{id}/inventory
export interface InventoryScopeEntrySupplier {
  asset_type: string;
  custodian_balance: string;     // Decimal string
  published_quantity: string;    // Decimal string
  already_booked: string;        // Decimal string
  effective_available: string;   // Decimal string
}

export interface InventoryScopeEntryAgent {
  asset_type: string;
  effective_available: string;   // Decimal string
}

export interface InventoryScopeSupplierResponse {
  connection_id: string;
  entries: InventoryScopeEntrySupplier[];
}

export interface InventoryScopeAgentResponse {
  connection_id: string;
  entries: InventoryScopeEntryAgent[];
}
```

### 10.3 `useInventoryScope` hook (`src/hooks/useInventoryScope.ts`)

```ts
import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import type { InventoryScopeSupplierResponse, InventoryScopeAgentResponse } from '@/types/connection';

type InventoryScopeResult = InventoryScopeSupplierResponse | InventoryScopeAgentResponse | null;

export function useInventoryScope(connectionId: string) {
  const [data, setData] = useState<InventoryScopeResult>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.GET(
        '/connections/{connection_id}/inventory' as never,
        { params: { path: { connection_id: connectionId } } },
      );
      if (!response.response.ok || !response.data) {
        const errBody = response.error as { error?: { message?: string } } | undefined;
        setError(errBody?.error?.message ?? 'Failed to load inventory scope.');
        return;
      }
      setData(response.data as InventoryScopeResult);
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  }, [connectionId]);

  useEffect(() => { void fetch(); }, [fetch]);

  return { data, isLoading, error, refetch: fetch };
}
```

### 10.4 Supplier inventory scope panel

**Location:** `SupplierConnectionsPage.tsx` — per-row expandable panel, or a modal opened by "Manage Inventory" button.

**Trigger:** "Manage Inventory" button visible on connections with `status === 'active' || status === 'suspended'`.

**Supplier panel layout:**

```
InventoryScopePanel (for a specific connection_id)
├── <h3>Published Inventory</h3>
├── {isLoading} → skeleton
├── {error} → <p role="alert">{error}</p>
├── Table of current entries (from GET /connections/{id}/inventory):
│   ├── columns: Asset | Custodian Balance | Published | Already Booked | Effective Available
│   └── one row per asset type
├── ─── Edit section ───────────────────────────────────────
├── "Add Asset" row: asset_type input + quantity input + "Add" button
├── Editable rows: each asset in current scope with quantity input + remove button
├── "Save" button → PUT /connections/{id}/inventory-scope
│   └── On success: close panel / show success banner, refetch connection list
└── "Cancel" button
```

**State model for the edit form:**

```ts
// Local form state (controlled):
const [editScope, setEditScope] = useState<Record<string, string>>({});
// editScope keys are asset type strings; values are decimal string inputs
```

**Submit handler:**

```ts
async function handleSaveScope() {
  const scope: Record<string, string> = {};
  for (const [asset, qty] of Object.entries(editScope)) {
    const parsed = Number(qty);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setFormError(`Invalid quantity for ${asset}`);
      return;
    }
    scope[asset] = qty;
  }
  await execute(async () => {
    const { response, error: apiError } = await apiClient.PUT(
      '/connections/{connection_id}/inventory-scope' as never,
      {
        params: { path: { connection_id: connectionId } },
        body: { scope },
      },
    );
    if (!response.ok) {
      const body = apiError as { error?: { message?: string } } | undefined;
      throw new Error(body?.error?.message ?? 'Failed to save inventory scope.');
    }
  });
  refetchConnections();
  refetchInventory();
}
```

**Validation:**
- Asset type must be non-empty string.
- Quantity must parse to a valid non-negative number.
- Inline error displayed below the form on failure.

### 10.5 Agent effective-available display

**Location:** `AgentConnectionsPage.tsx` — add a compact availability summary beneath each active connection row.

```
AgentConnectionRow
├── supplier_id | status badge | created_at | [Accept button if pending]
└── {status === 'active'} →
    └── <EffectiveAvailableRow connectionId={connection.connection_id} />
```

`EffectiveAvailableRow` uses `useInventoryScope(connectionId)` and renders:

```
Available: BTC 85.0  ETH 30.0
```

(Compact inline display. Only shows assets with `effective_available > 0`.)

If `entries` is empty (nothing published), renders:

```
Available: —  (no inventory published)
```

### 10.6 MSW handlers

Add to `src/mocks/handlers/connections.ts`:

```ts
// Mutable scope store per connection
const mockScopes: Record<string, Record<string, string>> = {};

// PUT /api/connections/:connection_id/inventory-scope
http.put('/api/connections/:connection_id/inventory-scope', async ({ params, request }) => {
  await delay(20);
  const id = params.connection_id as string;
  const conn = mockConnections.find((c) => c.connection_id === id);
  if (!conn) return mockError('not_found', 'Connection not found', 404);
  if (!['active', 'suspended'].includes(conn.status)) {
    return mockError('invalid_connection_status', `Cannot set inventory scope on '${conn.status}' connection`, 409);
  }
  const body = (await request.json()) as { scope: Record<string, string> };
  for (const [asset, qty] of Object.entries(body.scope)) {
    const parsed = Number(qty);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return mockError('invalid_quantity', `Quantity for ${asset} must be >= 0`, 422);
    }
  }
  mockScopes[id] = body.scope;
  return HttpResponse.json(conn, { status: 200 });
}),

// GET /api/connections/:connection_id/inventory  (supplier view — mock always returns supplier shape)
http.get('/api/connections/:connection_id/inventory', async ({ params }) => {
  await delay(20);
  const id = params.connection_id as string;
  const scope = mockScopes[id] ?? {};
  const entries = Object.entries(scope).map(([asset_type, published]) => ({
    asset_type,
    custodian_balance: '500.0',    // fixed mock custodian balance
    published_quantity: String(published),
    already_booked: '0.0',
    effective_available: String(Math.min(500, Number(published))),
  }));
  return HttpResponse.json({ connection_id: id, entries }, { status: 200 });
}),
```

---

## §11. Open decisions

| # | Decision | Status | Notes |
|---|---|---|---|
| **D-1** | **Agent inventory endpoint visibility** | Accepted | Agent responses include published asset types and `effective_available` only. They do not include `published_quantity` or `custodian_balance`. The frontend may hide entries with `effective_available = 0` for display compactness. |
| **D-2** | **No `inventory_scope` in `ConnectionResponse`** | Accepted | Generic connection list/detail responses stay unchanged. Published quantities are available only to supplier callers through `GET /connections/{id}/inventory`. |
| **D-3** | **What happens to loans when inventory_scope is reduced below already-booked** | Open | If a supplier sets `{"BTC": "10.0"}` when 50 BTC is already booked, `effective_available` goes negative internally but is clamped to 0 in the response. **Active loans are not affected** — only new bookings are blocked. The platform does not auto-recall or flag existing loans. If product wants an alert (e.g., supplier reduced below booked level), a notification event `"inventory_scope_below_booked"` should be added to `set_inventory_scope`. Not in this spec. |
| **D-4** | **`PUT /connections/{id}/inventory-scope` allowed on `suspended` connections** | Recommended | Allowing edits while suspended means the supplier can pre-configure scope before reactivating. Disallowing it would force a two-step flow (reactivate → edit). Confirm with product. |
| **D-5** | **`sum_booked_quantity` N+1 in `get_inventory_scope`** | Accepted for MVP | `get_inventory_scope` calls `sum_booked_quantity` once per asset type. For 1–5 assets in MVP this is acceptable. If asset count grows, replace with a single GROUP BY query: `SELECT asset_type, SUM(quantity) FROM loans WHERE connection_id = $1 AND state IN (...) GROUP BY asset_type`. |
