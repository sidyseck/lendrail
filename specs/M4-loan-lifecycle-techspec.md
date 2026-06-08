# LendRail - M4 Loan Lifecycle Technical Specification

| Field | Value |
|---|---|
| Milestone | M4 - Loan lifecycle |
| Scope | F-033, F-034, F-035, F-036, F-037, F-038, F-039, F-040, F-041, F-042 |
| Based on | `FEATURES.md`, `ARCHITECTURE.md` v0.2, `TECH_SPEC_M3.md`, `specs/M2-backend-techspec.md`, M2 review carry-forwards |
| Audience | Backend engineer first, frontend engineer after backend APIs are merged |
| Status | Implementation-ready spec |

---

## 0. Purpose and guiding principles

M4 turns confirmed supplier-agent lending terms into booked loan records and moves those loans through the MVP lifecycle:

```
pending -> active -> recall_initiated -> settled
                    \-> defaulted
active | margin_call -> collateral substitution
```

M4 must preserve the existing architecture:

- **Backend first.** Implement database, repository, service, API, worker, OpenAPI, and backend tests before starting F-042 frontend work.
- **Layer boundaries.** `API routers -> domain services -> repositories + adapters`. Services must not import FastAPI types.
- **Error envelope.** All domain and validation errors continue to use `{"error": {"code": "...", "message": "..."}}`.
- **Async all the way.** Repositories, adapters, services, routers, and ARQ jobs are async.
- **Decimal money/ratio math.** Use `Decimal` in service DTOs and `NUMERIC` in Postgres. Avoid float math for quantities, collateral value, LTV, and rates.
- **Adapter isolation.** Loan services call `CustodianAdapter` and `MarketDataAdapter` Protocols only. Mock adapters stay deterministic and seedable in tests.
- **Role and ownership enforcement.** Every service method performs a role check and an ownership/resource-party check.
- **No frontend assumptions in backend.** Backend responses include everything the UI needs, but UI state is derived from API state.

### Baseline decisions from M2/M3

M4 implements against the current repo, not the original architecture sketch where it has since diverged:

- `connections` has no `custodian_link_id`; custodian management is supplier org-level (`/custodians`).
- `connections.status` is `pending | active | suspended | terminated`.
- `lending_agreements.status` is derived, not stored: an agreement is active only when both `confirmed_by_supplier_at` and `confirmed_by_agent_at` are non-null.
- The latest agreement version is the only version that may be active for new bookings. If the latest version is unconfirmed, bookings are blocked.
- `ConnectionRepository.list_active_loans_by_connection()` is a deliberate M2 stub returning `[]`; M4 replaces this with a real `LoanRepository` query and updates connection termination to use it.

---

## 1. Scope

| Feature | What | Primary actor |
|---|---|---|
| F-033 | Loan DB table, migration, ORM model | System |
| F-034 | Approved borrower list per connection | Agent, Supplier |
| F-035 | Loan booking API | Agent |
| F-036 | Pending-to-active transition in `ltv_refresh_job` | System |
| F-037 | Loan list and detail APIs | Agent, Supplier |
| F-038 | Booking guard: latest agreement must be dual-confirmed | System |
| F-039 | Recall and return instruction APIs | Supplier, Agent |
| F-040 | Collateral substitution API | Agent |
| F-041 | Manual default API and transition timestamping | Agent, Admin |
| F-042 | Loan lifecycle UI | Agent, Supplier |

Out of M4 scope:

- F-043 margin call logic beyond preserving the `margin_call` state.
- F-044 portfolio aggregates.
- F-045 LTV staleness alerts.
- F-046 risk cockpit.
- F-050 accruals and F-053 statements.
- Partial recall, partial return, maturity automation, and real-time updates.

---

## 2. New and changed files

Backend first:

```
backend/
+-- alembic/versions/
|   +-- 0011_loan_lifecycle.py                [NEW] F-033, F-034, F-039, F-041
+-- app/
|   +-- models/
|   |   +-- loan.py                           [NEW]
|   |   +-- connection_approved_borrower.py   [NEW if not colocated]
|   |   +-- loan_state_transition.py          [NEW]
|   |   +-- __init__.py                       [CHANGED]
|   +-- repositories/
|   |   +-- loan_repository.py                [NEW]
|   |   +-- approved_borrower_repository.py   [NEW if not colocated]
|   |   +-- loan_transition_repository.py     [NEW]
|   |   +-- connection_repository.py          [CHANGED] remove/stop using loan stub
|   +-- schemas/
|   |   +-- loans.py                          [NEW]
|   |   +-- connections.py                    [CHANGED] approved borrower schemas if colocated
|   +-- services/
|   |   +-- loan_service.py                   [NEW]
|   |   +-- connection_service.py             [CHANGED] termination uses LoanRepository
|   +-- api/
|   |   +-- deps.py                           [CHANGED] service/repository deps
|   |   +-- routers/
|   |       +-- loans.py                      [NEW]
|   |       +-- connections.py                [CHANGED] approved borrower endpoints
|   +-- adapters/
|   |   +-- interfaces.py                     [CHANGED] if mock needs richer refs only
|   |   +-- mock_custodian.py                 [CHANGED] seedable inventory/collateral/instruction failure
|   +-- workers/
|       +-- arq_worker.py                     [CHANGED] `ltv_refresh_job`
+-- tests/
    +-- test_loans.py                         [NEW]
    +-- test_approved_borrowers.py            [NEW]
    +-- test_worker.py                        [CHANGED]
```

Frontend after backend:

```
frontend/src/
+-- api/
|   +-- loanApi.ts                            [NEW]
+-- types/
|   +-- loan.ts                               [NEW]
+-- components/
|   +-- loans/
|       +-- LoanStatusBadge.tsx               [NEW]
|       +-- LoanListTable.tsx                 [NEW]
|       +-- LoanDetailCard.tsx                [NEW]
|       +-- CollateralSubstitutionForm.tsx    [NEW]
+-- pages/
|   +-- loans/
|       +-- LoanListPage.tsx                  [NEW]
|       +-- LoanDetailPage.tsx                [NEW]
+-- mocks/handlers/
|   +-- loans.ts                              [NEW]
+-- test/
    +-- LoanListPage.test.tsx                 [NEW]
    +-- LoanDetailPage.test.tsx               [NEW]
```

---

## 3. Database changes

### 3.1 Migration 0011 - loan lifecycle tables

Revision: `0011`
Down-revision: `0010`

M4 adds the `loans` table from `FEATURES.md` plus the minimum nullable operational columns needed by F-036, F-039, and F-041. It can also add `connection_approved_borrowers` in the same migration because F-035 depends on both the loan table and approved borrower list.

```sql
CREATE TYPE loan_term_type_enum AS ENUM ('open', 'fixed');
CREATE TYPE loan_state_enum AS ENUM (
  'pending',
  'active',
  'margin_call',
  'recall_initiated',
  'settled',
  'defaulted'
);

CREATE TABLE loans (
  id                         UUID PRIMARY KEY,
  connection_id              UUID NOT NULL REFERENCES connections(id) ON DELETE RESTRICT,
  agreement_id               UUID NOT NULL REFERENCES lending_agreements(id) ON DELETE RESTRICT,
  borrower_id                UUID NOT NULL REFERENCES borrowers(id) ON DELETE RESTRICT,
  asset_type                 TEXT NOT NULL,
  quantity                   NUMERIC(28, 12) NOT NULL,
  rate_bps                   INTEGER NOT NULL,
  term_type                  loan_term_type_enum NOT NULL,
  maturity_date              DATE,
  day_count_basis            day_count_basis_enum NOT NULL,
  collateral_type            TEXT NOT NULL,
  collateral_quantity        NUMERIC(28, 12) NOT NULL,
  collateral_value_usd       NUMERIC(28, 8) NOT NULL,
  current_ltv_pct            NUMERIC(10, 4),
  ltv_as_of                  TIMESTAMPTZ,
  state                      loan_state_enum NOT NULL DEFAULT 'pending',
  booked_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at                 TIMESTAMPTZ,

  -- Operational fields needed by M4 flows.
  activated_at               TIMESTAMPTZ,
  recall_initiated_at        TIMESTAMPTZ,
  recall_notice_deadline_at  TIMESTAMPTZ,
  return_custodian_ref       TEXT,
  return_instruction_at      TIMESTAMPTZ,

  CONSTRAINT ck_loans_positive_quantity CHECK (quantity > 0),
  CONSTRAINT ck_loans_nonnegative_rate CHECK (rate_bps >= 0),
  CONSTRAINT ck_loans_positive_collateral_quantity CHECK (collateral_quantity > 0),
  CONSTRAINT ck_loans_nonnegative_collateral_value CHECK (collateral_value_usd >= 0)
);

CREATE INDEX ix_loans_connection_id ON loans(connection_id);
CREATE INDEX ix_loans_agreement_id ON loans(agreement_id);
CREATE INDEX ix_loans_borrower_id ON loans(borrower_id);
CREATE INDEX ix_loans_state ON loans(state);
CREATE INDEX ix_loans_connection_state ON loans(connection_id, state);
```

`term_type = fixed` with `maturity_date IS NULL` is rejected in Pydantic/service validation, not a DB check, matching F-033.

The transition audit records every state transition with a timestamp. This satisfies F-041 without adding a bespoke timestamp column for every future state:

```sql
CREATE TABLE loan_state_transitions (
  id              UUID PRIMARY KEY,
  loan_id         UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  from_state      loan_state_enum,
  to_state        loan_state_enum NOT NULL,
  actor_org_id    UUID REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id   UUID REFERENCES users(id) ON DELETE RESTRICT,
  reason          TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_loan_state_transitions_loan_id ON loan_state_transitions(loan_id);
```

`actor_org_id` and `actor_user_id` are nullable for system transitions from ARQ jobs. `reason` values in M4: `loan_booked`, `custodian_confirmed`, `recall_initiated`, `return_confirmed`, `loan_defaulted`, `collateral_substituted`.

### 3.2 Approved borrowers per connection

```sql
CREATE TABLE connection_approved_borrowers (
  connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  borrower_id   UUID NOT NULL REFERENCES borrowers(id) ON DELETE RESTRICT,
  approved_by   UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  approved_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, borrower_id)
);

CREATE INDEX ix_connection_approved_borrowers_borrower_id
  ON connection_approved_borrowers(borrower_id);
```

Application invariants:

- `approved_by` must be the connection's `agent_id`.
- The borrower must have `borrowers.invited_by = connection.agent_id`.
- The connection must be `active`.
- Deleting an approved borrower removes only the approval row, never the borrower.

Full downgrade order:

1. Drop `connection_approved_borrowers`.
2. Drop `loan_state_transitions`.
3. Drop `loans`.
4. Drop `loan_state_enum`.
5. Drop `loan_term_type_enum`.

---

## 4. ORM models

### 4.1 `Loan`

`backend/app/models/loan.py`

Use SQLAlchemy 2.x typed mappings. Numeric columns should map to `Decimal`, not `float`.

```python
class Loan(Base):
    __tablename__ = "loans"

    id: Mapped[uuid.UUID]
    connection_id: Mapped[uuid.UUID]
    agreement_id: Mapped[uuid.UUID]
    borrower_id: Mapped[uuid.UUID]
    asset_type: Mapped[str]
    quantity: Mapped[Decimal]
    rate_bps: Mapped[int]
    term_type: Mapped[str]
    maturity_date: Mapped[date | None]
    day_count_basis: Mapped[str]
    collateral_type: Mapped[str]
    collateral_quantity: Mapped[Decimal]
    collateral_value_usd: Mapped[Decimal]
    current_ltv_pct: Mapped[Decimal | None]
    ltv_as_of: Mapped[datetime | None]
    state: Mapped[str]
    booked_at: Mapped[datetime]
    settled_at: Mapped[datetime | None]
    activated_at: Mapped[datetime | None]
    recall_initiated_at: Mapped[datetime | None]
    recall_notice_deadline_at: Mapped[datetime | None]
    return_custodian_ref: Mapped[str | None]
    return_instruction_at: Mapped[datetime | None]
```

Avoid eager relationships in the model. Services/repositories should load joins explicitly to keep async behavior predictable.

### 4.2 `ConnectionApprovedBorrower`

Composite primary key: `(connection_id, borrower_id)`.

### 4.3 `LoanStateTransition`

Stores audit rows for every state change and collateral substitution action.

---

## 5. Repository layer

### 5.1 `LoanRepository`

`backend/app/repositories/loan_repository.py`

Required methods:

```python
class LoanRepository(BaseRepository[Loan]):
    model = Loan

    async def list_for_supplier(
        self,
        supplier_id: UUID,
        state: str | None = None,
    ) -> list[Loan]: ...

    async def list_for_agent(
        self,
        agent_id: UUID,
        state: str | None = None,
    ) -> list[Loan]: ...

    async def get_with_connection(self, loan_id: UUID) -> tuple[Loan, Connection]: ...

    async def list_pending(self) -> list[Loan]: ...

    async def list_active_by_connection(self, connection_id: UUID) -> list[UUID]: ...
```

`list_active_by_connection()` replaces the M2 stub in `ConnectionRepository`. "Active" for termination flagging means loans in `pending`, `active`, `margin_call`, or `recall_initiated`; exclude `settled` and `defaulted`.

### 5.2 `ApprovedBorrowerRepository`

Required methods:

```python
async def add(connection_id: UUID, borrower_id: UUID, approved_by: UUID) -> ConnectionApprovedBorrower
async def remove(connection_id: UUID, borrower_id: UUID) -> bool
async def exists(connection_id: UUID, borrower_id: UUID) -> bool
async def list_for_connection(connection_id: UUID) -> list[Borrower]
```

`add()` must be idempotent from a DB integrity perspective: duplicate insertion should return 409 `borrower_already_approved`, not leak an `IntegrityError`.

### 5.3 `LoanTransitionRepository`

```python
async def record(
    loan_id: UUID,
    from_state: str | None,
    to_state: str,
    reason: str,
    actor_org_id: UUID | None = None,
    actor_user_id: UUID | None = None,
    metadata: dict | None = None,
) -> LoanStateTransition: ...
```

All service methods that mutate loan state must call this in the same DB transaction as the loan update.

---

## 6. API schemas

Create `backend/app/schemas/loans.py`.

### 6.1 Enums

```python
LoanState = Literal[
    "pending",
    "active",
    "margin_call",
    "recall_initiated",
    "settled",
    "defaulted",
]
LoanTermType = Literal["open", "fixed"]
```

### 6.2 Booking request

```python
class LoanBookingRequest(BaseModel):
    connection_id: UUID
    borrower_id: UUID
    asset_type: str
    quantity: Decimal
    rate_bps: int
    term_type: Literal["open", "fixed"]
    maturity_date: date | None = None
    collateral_type: str
    collateral_quantity: Decimal
    collateral_value_usd: Decimal
```

Pydantic validations:

- `quantity > 0`
- `rate_bps >= 0`
- `collateral_quantity > 0`
- `collateral_value_usd >= 0`
- `term_type == "fixed"` requires `maturity_date`
- `term_type == "open"` ignores/rejects `maturity_date`; choose reject with 422 `validation_error` for cleaner input contracts

`day_count_basis` is not accepted from the client; it is copied from the active agreement.

### 6.3 Responses

```python
class LoanCreatedResponse(BaseModel):
    loan_id: UUID
    state: Literal["pending"]

class LoanResponse(BaseModel):
    loan_id: UUID
    connection_id: UUID
    agreement_id: UUID
    borrower_id: UUID
    borrower_name: str
    asset_type: str
    quantity: str
    rate_bps: int
    term_type: LoanTermType
    maturity_date: date | None
    day_count_basis: Literal["actual_360", "actual_365"]
    collateral_type: str
    collateral_quantity: str
    collateral_value_usd: str
    current_ltv_pct: str | None
    ltv_as_of: AwareDatetime | None
    state: LoanState
    booked_at: AwareDatetime
    activated_at: AwareDatetime | None
    recall_initiated_at: AwareDatetime | None
    recall_notice_deadline_at: AwareDatetime | None
    return_custodian_ref: str | None
    return_instruction_at: AwareDatetime | None
    settled_at: AwareDatetime | None
```

Supplier response must include `borrower_name` but must not include `borrower.contact_email`. Agent response may include the same shape for M4; do not add borrower contact details unless the frontend needs them. Keeping one shape avoids accidental privacy divergence.

```python
class LoanListResponse(BaseModel):
    loans: list[LoanResponse]

class RecallResponse(BaseModel):
    loan_id: UUID
    state: Literal["recall_initiated"]
    notice_deadline: AwareDatetime

class ReturnResponse(BaseModel):
    loan_id: UUID
    state: Literal["settled"]
    custodian_ref: str

class CollateralSubstitutionRequest(BaseModel):
    collateral_type: str
    collateral_quantity: Decimal
    collateral_value_usd: Decimal

class DefaultResponse(BaseModel):
    loan_id: UUID
    state: Literal["defaulted"]
```

### 6.4 Approved borrower schemas

Either colocate in `schemas/connections.py` or create `schemas/approved_borrowers.py`.

```python
class ApprovedBorrowerRequest(BaseModel):
    borrower_id: UUID

class ApprovedBorrowerResponse(BaseModel):
    borrower_id: UUID
    name: str
    jurisdiction: str
    status: str
    approved_at: AwareDatetime

class ApprovedBorrowerListResponse(BaseModel):
    borrowers: list[ApprovedBorrowerResponse]
```

Do not include borrower contact email in supplier responses.

---

## 7. Backend API endpoints

### 7.1 F-034 approved borrowers

#### `POST /connections/{connection_id}/approved-borrowers`

Auth: agent JWT.

Service logic:

1. Caller role must be `agent`; otherwise 403.
2. Connection exists; caller `org_id == connection.agent_id`; otherwise 403.
3. Connection status must be `active`; otherwise 409 `connection_not_active`.
4. Borrower exists and `borrower.invited_by == caller.org_id`; otherwise 403 `borrower_not_managed_by_agent`.
5. Insert approval row. Duplicate returns 409 `borrower_already_approved`.

Response: HTTP 201 `ApprovedBorrowerResponse`.

#### `GET /connections/{connection_id}/approved-borrowers`

Auth: supplier or agent JWT.

Caller must be a party to the connection. Unrelated org returns 403.

Response: HTTP 200 `ApprovedBorrowerListResponse`.

#### `DELETE /connections/{connection_id}/approved-borrowers/{borrower_id}`

Auth: supplier JWT.

Service logic:

1. Caller role must be `supplier`; otherwise 403.
2. Caller `org_id == connection.supplier_id`; otherwise 403.
3. Delete approval row. Missing row returns 404 `approved_borrower_not_found`.

Response: HTTP 200:

```json
{ "connection_id": "...", "borrower_id": "...", "removed": true }
```

### 7.2 F-035/F-038 booking

#### `POST /loans`

Auth: agent JWT only.

Validation order matters because tests should assert specific machine codes:

1. Role check: supplier/admin returns 403.
2. Connection exists and `connection.agent_id == caller.org_id`; unrelated agent returns 403.
3. Connection status is `active`; otherwise 409 `connection_not_active`.
4. Latest agreement exists:
   - no agreement -> 409 `no_active_agreement`
   - latest agreement not dual-confirmed -> 409 `agreement_not_fully_confirmed`
5. Borrower is on `connection_approved_borrowers`; otherwise 422 `borrower_not_approved`.
6. `asset_type in agreement.assets_in_scope`; otherwise 422 `asset_not_in_scope`.
7. `collateral_type in agreement.eligible_collateral`; otherwise 422 `collateral_not_eligible`.
8. `quantity >= agreement.minimum_loan_size` if/when that field exists. The current M3 agreement model has no minimum size column, so M4 must do one of:
   - add `minimum_loan_size` to agreements before implementing this criterion, or
   - mark the `below_minimum_size` acceptance criterion blocked by missing agreement field and add a spec delta.

Implementation ruling for this checkout: add `minimum_loan_size` only if a prior M3 delta already introduced it before M4 work starts. If it is still absent, do not silently invent it in M4; document a `SPEC_DELTAS.md` entry and skip only that assertion.

9. Use `MarketDataAdapter.get_price(asset_type)` for the loan asset price.
10. Calculate agreement-defined LTV exactly as `collateral_value_usd / (quantity * asset_price_usd) * 100`.
11. If calculated LTV exceeds `agreement.initial_ltv_pct`, return 422 `ltv_exceeded`.
12. Call `CustodianAdapter.get_inventory(account_ref)` and verify available `asset_type` quantity is sufficient; otherwise 422 `insufficient_inventory`.
13. Create `Loan(state="pending")`, copy `agreement.day_count_basis`, set `current_ltv_pct` and `ltv_as_of` from market data time.
14. Record transition audit with `from_state=None`, `to_state="pending"`, `reason="loan_booked"`.
15. Notify both parties with `loan_booked`.

Response: HTTP 201:

```json
{ "loan_id": "...", "state": "pending" }
```

Notification payload:

```json
{
  "loan_id": "...",
  "connection_id": "...",
  "agreement_id": "...",
  "borrower_id": "...",
  "asset_type": "BTC",
  "quantity": "1.500000000000"
}
```

### 7.3 F-037 list/detail

#### `GET /loans?state=active`

Auth: supplier, agent, or admin.

- Supplier sees loans where `connections.supplier_id == caller.org_id`.
- Agent sees loans where `connections.agent_id == caller.org_id`.
- Admin may see all loans; optional for M4 UI but useful for tests.
- `state` filter is optional and must be one of `LoanState`; invalid state returns 422 `validation_error`.

Response: HTTP 200 `LoanListResponse`.

#### `GET /loans/{loan_id}`

Auth: supplier, agent, or admin.

Unrelated org returns 403. Missing loan returns 404.

Response: HTTP 200 `LoanResponse`.

### 7.4 F-039 recall and return

#### `POST /loans/{loan_id}/recall`

Auth: supplier or agent JWT.

FEATURES.md lists supplier and agent as accepted callers. Treat recall as "instruction to end the loan"; both connection parties may initiate it in M4.

Service logic:

1. Caller role must be `supplier` or `agent`; admin not allowed unless later product change.
2. Caller must be a party to the loan's connection.
3. Loan state must be `active` or `margin_call`. Calling on `settled` or `defaulted` returns 409 `invalid_loan_state`; calling on `pending` also returns 409.
4. Load agreement and compute `notice_deadline = now + agreement.recall_notice_days`.
5. Update loan:
   - `state = "recall_initiated"`
   - `recall_initiated_at = now`
   - `recall_notice_deadline_at = notice_deadline`
6. Record transition audit `active|margin_call -> recall_initiated`.
7. Notify both parties with `recall_initiated`, including `notice_deadline`.

Response: HTTP 200 `RecallResponse`.

Idempotency: calling recall twice on an already `recall_initiated` loan returns 409 `invalid_loan_state`. Do not move the notice deadline.

#### `POST /loans/{loan_id}/return`

Auth: agent JWT.

Service logic:

1. Caller role must be `agent`; otherwise 403.
2. Caller `org_id == connection.agent_id`; otherwise 403.
3. Loan state must be `recall_initiated`; otherwise 409 `invalid_loan_state`.
4. Call `CustodianAdapter.transmit_instruction("return", ...)`.
5. If `success=False`, return 502 `custodian_instruction_failed`; loan remains `recall_initiated`.
6. If success, update loan:
   - `state = "settled"`
   - `settled_at = result.executed_at`
   - `return_instruction_at = now`
   - `return_custodian_ref = result.custodian_ref`
7. Record transition audit `recall_initiated -> settled`.
8. Notify both parties with `loan_settled`.

Response: HTTP 200 `ReturnResponse`.

### 7.5 F-040 collateral substitution

#### `POST /loans/{loan_id}/collateral-substitution`

Auth: agent JWT.

Service logic:

1. Caller role must be `agent`; otherwise 403.
2. Caller `org_id == connection.agent_id`; otherwise 403.
3. Loan state must be `active` or `margin_call`; otherwise 409 `invalid_loan_state`.
4. New `collateral_type` must be in agreement `eligible_collateral`; otherwise 422 `collateral_not_eligible`.
5. Recalculate agreement-defined LTV using the same formula as booking and latest market price for `loan.asset_type`.
6. If calculated LTV exceeds `agreement.initial_ltv_pct`, return 422 `ltv_exceeded`.
7. Update `collateral_type`, `collateral_quantity`, `collateral_value_usd`, `current_ltv_pct`, and `ltv_as_of`.
8. Record a transition audit row with `from_state=loan.state`, `to_state=loan.state`, `reason="collateral_substituted"`.
9. Notify both parties with `collateral_substituted`.

Response: HTTP 200 `LoanResponse`.

No custodian instruction is sent in M4 for collateral substitution.

### 7.6 F-041 default

#### `POST /loans/{loan_id}/default`

Auth: agent or admin JWT.

Service logic:

1. Supplier returns 403.
2. Agent caller must own the loan connection; admin bypasses ownership for operational support.
3. Loan must be `recall_initiated`; otherwise 409 `invalid_loan_state`.
4. Update `state = "defaulted"`.
5. Record transition audit `recall_initiated -> defaulted` with `transitioned_at = now`.
6. Notify both parties with `loan_defaulted`.

Response: HTTP 200 `DefaultResponse`.

---

## 8. Domain service design

### 8.1 `LoanService`

`backend/app/services/loan_service.py`

Constructor:

```python
class LoanService:
    def __init__(
        self,
        loans: LoanRepository,
        transitions: LoanTransitionRepository,
        approved_borrowers: ApprovedBorrowerRepository,
        agreements: AgreementRepository,
        connections: ConnectionRepository,
        borrowers: BorrowerRepository,
        users: UserRepository,
        custodian: CustodianAdapter,
        market_data: MarketDataAdapter,
        notifier: NotificationService,
    ) -> None: ...
```

Public methods:

```python
async def approve_borrower(caller: AuthUser, connection_id: UUID, borrower_id: UUID) -> ApprovedBorrowerResult
async def list_approved_borrowers(caller: AuthUser, connection_id: UUID) -> list[ApprovedBorrowerResult]
async def remove_approved_borrower(caller: AuthUser, connection_id: UUID, borrower_id: UUID) -> None
async def book_loan(caller: AuthUser, data: LoanBookingInput) -> LoanCreatedResult
async def list_loans(caller: AuthUser, state: str | None = None) -> list[LoanResult]
async def get_loan(caller: AuthUser, loan_id: UUID) -> LoanResult
async def recall_loan(caller: AuthUser, loan_id: UUID) -> RecallResult
async def return_loan(caller: AuthUser, loan_id: UUID) -> ReturnResult
async def substitute_collateral(caller: AuthUser, loan_id: UUID, data: CollateralSubstitutionInput) -> LoanResult
async def default_loan(caller: AuthUser, loan_id: UUID) -> DefaultResult
async def activate_pending_loans() -> int
```

All output DTOs are dataclasses. Routers convert dataclasses to Pydantic responses.

### 8.2 Shared helpers

Implement private helpers for:

- `_require_party(caller, connection)`
- `_require_agent_owner(caller, connection)`
- `_require_supplier_owner(caller, connection)`
- `_latest_dual_confirmed_agreement(connection_id)`
- `_calculate_ltv_pct(collateral_value_usd, quantity, price_usd)`
- `_notify_connection_users(connection, event, payload)`

`_notify_connection_users()` must fan out to all users in supplier and agent orgs. Avoid only notifying `caller.user_id`; M2 review flagged single-user notification as a recurring gap.

### 8.3 Active agreement guard

Booking must use the latest agreement row:

```python
latest = await agreements.get_latest_for_connection(connection.id)
if latest is None:
    raise ConflictError("No active agreement exists", code="no_active_agreement")
if not latest.is_active:
    raise ConflictError(
        "The latest agreement is not fully confirmed",
        code="agreement_not_fully_confirmed",
    )
```

Do not call `get_active_for_connection()` alone, because it collapses "none exists" and "latest exists but is unconfirmed" into the same `None`.

---

## 9. Worker design

### 9.1 `ltv_refresh_job`

M4 defines the worker session boundary that earlier reviews deferred:

- Each ARQ job opens its own async DB session using the same session factory as API requests.
- The job constructs repositories/services inside that session.
- The job commits once after processing all loans if successful.
- The job rolls back on unhandled exception.
- Per-loan adapter misses, such as missing collateral, do not abort the job.

M4 behavior for F-036:

1. Query all `pending` loans.
2. For each pending loan:
   - Fetch connection and latest agreement.
   - Call `CustodianAdapter.get_inventory(account_ref)` and `get_collateral(loan_ref=str(loan.id))`.
   - If inventory is insufficient or collateral is missing, leave loan `pending`.
   - If both confirm, update loan:
     - `state = "active"`
     - `activated_at = now`
     - `current_ltv_pct` from collateral value and latest market price
     - `ltv_as_of` from collateral or price timestamp, whichever is later
   - Record transition audit `pending -> active`, reason `custodian_confirmed`.
   - Notify both parties with `loan_activated`.
3. Return count of activated loans.

Idempotency:

- The query only selects `pending`, so active loans are ignored.
- Notification is sent only when the update changes state in the current run.
- Running twice without new pending loans returns `0`.

F-043 will extend this same job to process active loans for margin calls. Do not implement margin call threshold transition in M4 unless F-043 is also in scope.

---

## 10. Adapter requirements

Current `CustodianAdapter` methods are already async. M4 needs deterministic test seeding:

- Inventory seeded by account ref and asset type.
- Collateral seeded by `loan_ref`.
- `transmit_instruction()` can be seeded to return success or failure.
- Mock must record transmitted instructions so tests can assert the return flow called it.

No new Protocol method is required for M4 unless implementation discovers account-ref ambiguity from org-level custodians. If needed, resolve account refs from active supplier custodian links in the service/repository layer rather than putting connection-specific state back on `connections`.

Market data:

- Use `MarketDataAdapter.get_price(asset_type)` for booking, activation, and collateral substitution LTV calculations.
- Mock market data should default BTC to a stable deterministic value and be seedable per test.

---

## 11. Backend test plan

### 11.1 Migration tests

- `test_0011_upgrade_creates_loans_and_enums`
- `test_0011_state_enum_rejects_invalid_value`
- `test_0011_foreign_keys_enforced`
- `test_0011_downgrade_reverses_cleanly`
- `test_0011_approved_borrowers_composite_pk`
- `test_0011_downgrade_reverses_cleanly`

### 11.2 Approved borrowers

- Agent can add borrower they manage -> 201.
- Agent adding borrower from another agent -> 403 `borrower_not_managed_by_agent`.
- Supplier can list approved borrowers.
- Agent can list approved borrowers.
- Unrelated org listing -> 403.
- Supplier can remove -> 200.
- Agent removing -> 403.
- Duplicate add -> 409 `borrower_already_approved`.

### 11.3 Booking

- Valid booking -> 201 `{loan_id, state: "pending"}`.
- Supplier booking -> 403.
- Unrelated agent booking on connection -> 403.
- No agreement -> 409 `no_active_agreement`.
- Partially confirmed latest agreement -> 409 `agreement_not_fully_confirmed`.
- Fully confirmed latest agreement -> proceeds.
- Borrower not approved -> 422 `borrower_not_approved`.
- Asset not in scope -> 422 `asset_not_in_scope`.
- Collateral not eligible -> 422 `collateral_not_eligible`.
- LTV exceeds initial threshold -> 422 `ltv_exceeded`.
- Insufficient inventory -> 422 `insufficient_inventory`.
- Fixed term without maturity -> 422 `validation_error`.
- Notifications include `loan_booked` for both orgs.

### 11.4 Worker activation

- Pending loan with valid inventory and collateral becomes active.
- Missing collateral leaves loan pending and raises no error.
- Job processes multiple pending loans.
- Running twice does not duplicate `loan_activated`.
- Transition audit row exists with `pending -> active`.

### 11.5 List/detail

- Supplier list only includes supplier connection loans.
- Agent list only includes agent connection loans.
- Admin list includes all loans if admin support is implemented.
- `?state=active` filters correctly.
- Unrelated org detail -> 403.
- Supplier response includes borrower name and excludes borrower contact email.
- Response includes booking fields, `state`, `current_ltv_pct`, and `ltv_as_of`.

### 11.6 Recall/return/default/substitution

- Supplier recall on active loan -> `recall_initiated`.
- Agent recall on active loan -> `recall_initiated`.
- Recall notification includes notice deadline.
- Recall on `settled` or `defaulted` -> 409.
- Agent return calls mock `transmit_instruction()` and settles loan.
- Failed transmit returns 502 and leaves loan `recall_initiated`.
- Return stores `return_custodian_ref`.
- Valid collateral substitution updates collateral fields.
- Ineligible collateral -> 422 `collateral_not_eligible`.
- Substitution LTV breach -> 422 `ltv_exceeded`.
- Substitution on invalid state -> 409.
- Agent default on `recall_initiated` -> `defaulted`.
- Admin default on `recall_initiated` -> `defaulted`.
- Supplier default -> 403.
- All state changes have transition audit timestamps.

Run commands:

```bash
cd backend
pytest
```

Also verify:

```bash
alembic upgrade head
alembic downgrade -1
alembic upgrade head
```

---

## 12. Frontend implementation - F-042

Frontend starts only after backend M4 endpoints are merged and `frontend/openapi.json` or the manual API wrappers are updated.

### 12.1 Routes

Add under the existing protected `/dashboard` route:

| Path | Component | Actor |
|---|---|---|
| `/dashboard/loans` | `LoanListPage` | Supplier, Agent |
| `/dashboard/loans/:loanId` | `LoanDetailPage` | Supplier, Agent |

Add navigation from the dashboard/connections area according to the current layout. Do not create a marketing or landing page.

### 12.2 API wrapper

`frontend/src/api/loanApi.ts` follows the same `fetch + authHeaders()` pattern as `agreementApi.ts` until generated OpenAPI types are refreshed.

Required functions:

```ts
getLoans(state?: LoanState): Promise<Loan[]>
getLoan(loanId: string): Promise<Loan>
recallLoan(loanId: string): Promise<RecallResponse>
returnLoan(loanId: string): Promise<ReturnResponse>
substituteCollateral(loanId: string, body: CollateralSubstitutionRequest): Promise<Loan>
defaultLoan(loanId: string): Promise<DefaultResponse>
```

Frontend F-042 does not need to expose `POST /loans` booking unless a booking UI is explicitly added later. F-042 is lifecycle UI for existing loans.

### 12.3 Types

`frontend/src/types/loan.ts` mirrors backend response strings for decimals:

```ts
export type LoanState =
  | 'pending'
  | 'active'
  | 'margin_call'
  | 'recall_initiated'
  | 'settled'
  | 'defaulted';

export interface Loan {
  loan_id: string;
  connection_id: string;
  agreement_id: string;
  borrower_id: string;
  borrower_name: string;
  asset_type: string;
  quantity: string;
  rate_bps: number;
  term_type: 'open' | 'fixed';
  maturity_date: string | null;
  day_count_basis: 'actual_360' | 'actual_365';
  collateral_type: string;
  collateral_quantity: string;
  collateral_value_usd: string;
  current_ltv_pct: string | null;
  ltv_as_of: string | null;
  state: LoanState;
  booked_at: string;
  activated_at: string | null;
  recall_initiated_at: string | null;
  recall_notice_deadline_at: string | null;
  return_custodian_ref: string | null;
  return_instruction_at: string | null;
  settled_at: string | null;
}
```

### 12.4 Components

#### `LoanStatusBadge`

Color mapping:

| State | Tone |
|---|---|
| pending | neutral |
| active | green |
| margin_call | amber |
| recall_initiated | blue |
| settled | gray |
| defaulted | red |

Reuse existing badge/button/card primitives and styling conventions. Keep text compact.

#### `LoanListPage`

Required UI:

- Table of loans.
- State segmented/filter control using `GET /loans?state=...`.
- State badge per row.
- Borrower name, asset/quantity, collateral value, current LTV, booked date.
- Row click or "View" button routes to detail.
- Loading, empty, and error states.

#### `LoanDetailPage`

Required UI:

- All fields from `LoanResponse`, including `ltv_as_of`.
- Supplier sees `Recall` button on `active` or `margin_call` loans.
- Agent sees `Recall` button on `active` or `margin_call` loans, matching backend F-039 acceptance criteria.
- Agent sees `Return Assets` button on `recall_initiated` loans.
- Agent sees `Substitute Collateral` on `active` or `margin_call` loans.
- Actions update local state from the response or re-fetch detail.
- Error messages use backend envelope code/message.

#### `CollateralSubstitutionForm`

Fields:

- `collateral_type`
- `collateral_quantity`
- `collateral_value_usd`

Client-side validation mirrors positive numeric checks. Backend remains authoritative for eligibility and LTV.

### 12.5 MSW and frontend tests

Add `frontend/src/mocks/handlers/loans.ts` and register it in the MSW server.

Tests:

- Loan list renders state badges and filters by state.
- Supplier active detail shows Recall, not Return Assets or Substitute Collateral.
- Agent `recall_initiated` detail shows Return Assets.
- Agent active/margin-call detail shows Substitute Collateral.
- Recall click calls API and updates state.
- Return click calls API and updates state to settled.
- Collateral substitution submit updates displayed collateral.
- `npm test` and TypeScript compile pass.

Run commands:

```bash
cd frontend
npm test
npm run build
```

---

## 13. Open decisions and spec deltas

### 13.1 Agreement minimum loan size

F-035 requires rejection with `below_minimum_size`, but the current M3 agreement schema in this repo does not include a minimum loan size field. M4 must not invent a hidden default.

Before implementation, choose one:

1. Add a formal agreement field and migration for minimum loan size, with M3/M4 spec delta.
2. Mark this acceptance criterion deferred in `SPEC_DELTAS.md` because the data model lacks the term.

### 13.2 Custodian account ref selection

The original architecture attached `custodian_link_id` to `connections`, but current M3/M2 redesign moved custodian links to supplier org-level. M4 service needs an account ref for `get_inventory()`.

Implementation options:

1. Use the supplier org's first active custodian link for MVP, returning 409 `no_active_custodian_link` if none exists.
2. Add an explicit `custodian_link_id` field to loan booking so the agent selects which supplier custodian account to book against.

Recommended for M4 MVP: option 1, because F-035 does not specify custodian selection UI or request fields. Document it as a deliberate MVP simplification.

### 13.3 LTV formula naming

`FEATURES.md` defines the M4/M5 calculation as `collateral_value_usd / (quantity * asset_price_usd) * 100` and compares it to `initial_ltv_pct` / `margin_call_ltv_pct`. That is closer to a collateralization ratio than conventional LTV. M4 should implement the formula as written for acceptance-test alignment, but code comments should call it "agreement-defined LTV" to avoid future confusion.

---

## 14. Implementation sequence

Backend:

1. Add migrations and models.
2. Add repositories and wire `LoanRepository` into connection termination.
3. Add schemas.
4. Add `LoanService` and approved borrower logic.
5. Add routers and dependency wiring.
6. Extend mock custodian and market data seeding as needed.
7. Implement `ltv_refresh_job` session boundary and activation logic.
8. Add backend tests and run migrations/test suite.
9. Refresh OpenAPI output if the repo workflow requires it.

Frontend:

1. Add loan types and API wrapper.
2. Add MSW handlers.
3. Add routes and pages.
4. Add loan components.
5. Add frontend tests.
6. Run TypeScript/build/tests.

M4 is complete when backend tests pass, frontend TypeScript compiles, the loan lifecycle UI can exercise recall/return/substitution against mocked API data, and `SPEC_DELTAS.md` captures any unresolved minimum-size or custodian-account decisions.
