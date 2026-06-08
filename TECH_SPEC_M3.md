# Tech Spec — M3 Agreement + M2 Connection Redesign

| Field | Value |
|---|---|
| Milestone | M3 — Agreement |
| Status | Implemented |
| Date | June 2026 |
| Depends on | M2 (M2 redesign applied in migration 0010 before M3 work) |

---

## 1. Background: M2 Connection Flow Redesign

Before M3 work began, the connection flow was redesigned to decouple custodian management from the connection object and remove the intermediate `accepted` status. This redesign is captured in migration `0010_decouple_custodian_from_connection.py`.

### 1.1 Changes made (migration 0010)

**Connection status enum — `accepted` removed:**
The original implementation added an `accepted` intermediate state between `pending` and `active` (SD-001). This state has been removed. `POST /connections/{id}/accept` now transitions directly `pending → active` and sets `activated_at` in a single step.

```
Before: pending → accepted → active → suspended | terminated
After:  pending → active → suspended | terminated
```

**`custodian_link_id` removed from connections table:**
The original F-024 attached a custodian API key directly to a connection. A supplier may manage multiple custodians across multiple connections, and the same collateral pool can serve different agent connections. Custodian management is now an org-level concern, decoupled from individual connections.

**New endpoints added for org-level custodian management:**
- `POST /custodians` — supplier registers a custodian API key for their org
- `GET /custodians` — supplier lists their org's registered custodian links

**Reactivate endpoint added:**
`POST /connections/{id}/reactivate` transitions `suspended → active`. Previously the re-key path served as implicit reactivation; this is now an explicit endpoint.

### 1.2 Data model after 0010

```
connections
  id                UUID PK
  supplier_id       UUID FK → organizations
  agent_id          UUID FK → organizations
  status            ENUM(pending, active, suspended, terminated)
  created_at        TIMESTAMPTZ
  activated_at      TIMESTAMPTZ nullable

custodian_links  (unchanged schema, decoupled from connections)
  id                UUID PK
  org_id            UUID FK → organizations
  custodian_id      TEXT
  account_ref       TEXT
  encrypted_api_key_ref  TEXT (vault ref, never plaintext)
  scope             JSONB
  status            ENUM(active, suspended, revoked)
  created_at        TIMESTAMPTZ
```

---

## 2. M3 — Agreement

### 2.1 DB schema (migration 0009)

```sql
CREATE TYPE day_count_basis_enum AS ENUM ('actual_360', 'actual_365');

CREATE TABLE lending_agreements (
  id                      UUID PRIMARY KEY,
  connection_id           UUID NOT NULL REFERENCES connections(id) ON DELETE RESTRICT,
  version                 INTEGER NOT NULL,
  assets_in_scope         TEXT[] NOT NULL,
  eligible_collateral     TEXT[] NOT NULL,
  initial_ltv_pct         NUMERIC(10,4) NOT NULL,
  margin_call_ltv_pct     NUMERIC(10,4) NOT NULL,
  liquidation_ltv_pct     NUMERIC(10,4) NOT NULL,
  recall_notice_days      INTEGER NOT NULL,
  max_loan_days           INTEGER NOT NULL,
  day_count_basis         day_count_basis_enum NOT NULL,
  agent_fee_bps           INTEGER NOT NULL,
  confirmed_by_supplier_at  TIMESTAMPTZ,
  confirmed_by_agent_at     TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_lending_agreements_connection_id ON lending_agreements(connection_id);
```

**Derived field `status`:** Not stored in DB. Computed at read time:
- `active` — both `confirmed_by_supplier_at` and `confirmed_by_agent_at` are non-null
- `pending_confirmation` — either or both are null

**Versioning invariant:** The row with the highest `version` for a given `connection_id` is the "current" agreement. All historical rows are retained (never deleted). Enforced at the application layer, not via a DB constraint.

**Borrower-loan defaulting:** `initial_ltv_pct`, `margin_call_ltv_pct`, and `liquidation_ltv_pct` are supplier-agent agreement terms. M4 loan booking uses them as defaults/guidance for borrower loans, but the executed loan stores its own LTV thresholds.

### 2.2 API endpoints

All agreement endpoints live in `app/api/routers/agreements.py`, registered at `/` in `main.py`.

#### `POST /connections/{connection_id}/agreement` (F-029)

Creates a new agreement for an active connection.

**Auth:** Agent JWT required. Caller's `org_id` must match `connection.agent_id`.

**Request body (`AgreementTermsRequest`):**
```json
{
  "assets_in_scope": ["BTC"],
  "eligible_collateral": ["ETH", "USDC"],
  "initial_ltv_pct": 70.0,
  "margin_call_ltv_pct": 80.0,
  "liquidation_ltv_pct": 90.0,
  "recall_notice_days": 5,
  "max_loan_days": 90,
  "day_count_basis": "actual_360",
  "agent_fee_bps": 50
}
```

**Validations (Pydantic + service layer):**
- `initial_ltv_pct`: `0 < x < 100`
- `margin_call_ltv_pct`: `0 < x < 100` and must exceed `initial_ltv_pct`
- `liquidation_ltv_pct`: `0 < x < 100` and must exceed `margin_call_ltv_pct`
- `recall_notice_days`, `max_loan_days`: `>= 1`
- `agent_fee_bps`: `0–10000`
- Connection must have `status = active` → 409 `connection_not_active`
- A pending (unconfirmed) agreement must not already exist → 409 `pending_agreement_exists`
- Supplier JWT → 403

**Version logic:**
- If no prior agreement exists: `version = 1`
- If the latest agreement is `active` (dual-confirmed): `version = latest.version + 1`

**Response:** HTTP 201, full `AgreementResponse` body.

**Notification:** `agreement_pending_supplier_confirmation` sent to both parties.

---

#### `POST /agreements/{agreement_id}/confirm` (F-030)

Supplier or agent confirms the current (latest) version.

**Auth:** Supplier or agent JWT. Caller's `org_id` must be `connection.supplier_id` or `connection.agent_id`.

**Logic:**
- Fetches agreement → fetches connection → verifies caller is a party
- Verifies `agreement.version == latest.version` → 409 `agreement_superseded` if not
- Supplier path: sets `confirmed_by_supplier_at = now()`, 409 `already_confirmed` if already set
- Agent path: sets `confirmed_by_agent_at = now()`, 409 `already_confirmed` if already set

**Response:** HTTP 200, updated `AgreementResponse` (status becomes `active` when both are set).

**Notifications:**
- Supplier confirms → `agreement_confirmed_by_supplier` to agent org's users
- Agent confirms → `agreement_confirmed_by_agent` to supplier org's users

---

#### `PUT /agreements/{agreement_id}` (F-031)

Agent amends the current agreement — creates a new version row.

**Auth:** Agent JWT. Caller must own the connection.

**Logic:**
- Verifies `agreement_id` points to the current (latest) version → 409 `agreement_not_current_version` if not
- Creates a new row with `version = latest.version + 1`, both confirmation timestamps `NULL`
- Old row is NOT modified

**Response:** HTTP 201, the newly created `AgreementResponse`.

**Notification:** `agreement_requires_reconfirmation` sent to both parties.

---

#### `GET /connections/{connection_id}/agreement`

Returns the latest agreement version. HTTP 404 if none exists.

**Auth:** Supplier or agent JWT, must be party to connection.

---

#### `GET /connections/{connection_id}/agreement/history`

Returns all agreement versions for a connection, ordered by `version ASC`.

**Auth:** Supplier or agent JWT, must be party to connection.

**Response:**
```json
{
  "agreements": [
    { "version": 1, "status": "active", ... },
    { "version": 2, "status": "pending_confirmation", ... }
  ]
}
```

---

### 2.3 Service layer (`AgreementService`)

Located in `app/services/agreement_service.py`. No FastAPI imports. Dependencies injected via `__init__`:

```python
class AgreementService:
    def __init__(
        self,
        agreements: AgreementRepository,
        connections: ConnectionRepository,
        users: UserRepository,
        notifier: NotificationService,
    )
```

Methods: `create_agreement`, `confirm_agreement`, `amend_agreement`, `get_agreement`, `get_latest_for_connection`, `list_history`.

All input is via typed `@dataclass` DTOs. All output is via `AgreementResult` dataclass. All errors are `DomainError` subclasses (`ConflictError`, `Forbidden`, `NotFoundError`).

**`AgreementResult` output DTO:**
```python
@dataclass
class AgreementResult:
    id: UUID
    connection_id: UUID
    version: int
    assets_in_scope: list[str]
    eligible_collateral: list[str]
    initial_ltv_pct: Decimal
    margin_call_ltv_pct: Decimal
    liquidation_ltv_pct: Decimal
    recall_notice_days: int
    max_loan_days: int
    day_count_basis: str
    agent_fee_bps: int
    confirmed_by_supplier_at: datetime | None
    confirmed_by_agent_at: datetime | None
    status: Literal["pending_confirmation", "active"]
    created_at: datetime
```

**LTV field precision:** Stored as `NUMERIC(10,4)` in Postgres, passed as `Decimal` through service layer, serialized to `str` in `AgreementResponse` to avoid float precision loss.

---

### 2.4 Response schema

`AgreementResponse` (Pydantic):
```python
class AgreementResponse(BaseModel):
    agreement_id: UUID
    connection_id: UUID
    version: int
    assets_in_scope: list[str]
    eligible_collateral: list[str]
    initial_ltv_pct: str        # Decimal as string
    margin_call_ltv_pct: str    # Decimal as string
    liquidation_ltv_pct: str    # Decimal as string
    recall_notice_days: int
    max_loan_days: int
    day_count_basis: str
    agent_fee_bps: int
    confirmed_by_supplier_at: AwareDatetime | None
    confirmed_by_agent_at: AwareDatetime | None
    status: Literal["pending_confirmation", "active"]  # derived
    created_at: AwareDatetime
```

---

### 2.5 Frontend (F-032)

**Route tree (under `/dashboard`):**

| Path | Component | Actor |
|---|---|---|
| `/connections/:id/agreement` | `AgreementPage` → `SupplierAgreementView` or `AgentAgreementView` | Supplier / Agent |
| `/connections/:id/agreement/new` | `AgentAgreementFormPage` | Agent |
| `/connections/:id/agreement/history` | `AgreementHistoryPage` | Both |

**`SupplierAgreementView`:**
- If no agreement: shows "No agreement submitted yet." (agent must initiate)
- If `pending_confirmation` and supplier hasn't confirmed: shows `AgreementConfirmBanner` (confirm button)
- If `pending_confirmation` and supplier already confirmed: shows "Awaiting agent confirmation"
- If `active`: shows read-only `AgreementReadOnlyCard`
- Always shows "View History" link

**`AgentAgreementView`:**
- If no agreement: shows "Enter Agreement Terms" button → `/agreement/new`
- If any agreement exists: shows `AgreementReadOnlyCard` + "Amend Terms" button
- If `pending_confirmation` and agent hasn't confirmed: shows "Confirm" button (agent also confirms)
- Always shows "View History" link

**`AgentAgreementFormPage`:**
- On mount: fetches latest agreement to populate initial values (pre-fills form for amend; empty for create)
- `isAmend = agreementId !== null` determines whether to call `createAgreement` or `amendAgreement`
- On submit: navigates back to `/agreement` view

**`AgreementTermsForm` fields:**
- Assets in Scope (comma-separated text input)
- Eligible Collateral (comma-separated text input)
- Initial LTV % (number, 0–100)
- Margin Call LTV % (number, must exceed Initial LTV)
- Liquidation LTV % (number, must exceed Margin Call LTV)
- Recall Notice Days (integer, ≥1)
- Max Loan Days (integer, ≥1)
- Day Count Basis (select: actual_360 / actual_365)
- Agent Fee (bps, 0–10000)

**`pending_agreement` flag on connections:**
`ConnectionResponse` includes `pending_agreement: bool`. The supplier's connections list shows an `AgreementStatusBadge` ("Pending Confirmation") on connections where this is true, so suppliers can see at a glance which connections need agreement action without navigating to each.

---

### 2.6 Notification events

| Event | Trigger | Recipients |
|---|---|---|
| `agreement_pending_supplier_confirmation` | Agent creates agreement | Both parties |
| `agreement_confirmed_by_supplier` | Supplier confirms | Agent org users |
| `agreement_confirmed_by_agent` | Agent confirms | Supplier org users |
| `agreement_requires_reconfirmation` | Agent amends agreement | Both parties |

---

## 3. Deviations from original spec

### SD-001 (Resolved) — `accepted` intermediate status removed
F-023 and F-021 originally described an `accepted` status between `pending` and `active`. Migration 0010 removes this status: `accept` now transitions directly `pending → active`. See `SPEC_DELTAS.md` SD-001.

### SD-002 — F-024 replaced: custodian management moved to org level
The original F-024 attached a custodian key to a specific connection. The implementation replaces this with org-level custodian management:
- `POST /custodians` — supplier registers a custodian link for their org
- `GET /custodians` — supplier lists their org's custodian links
- No `custodian_link_id` on the `connections` table

**Rationale:** A supplier may lend from the same inventory to multiple agent connections simultaneously, and the same collateral can be managed by different custodians. Tying custodian keys to individual connections doesn't model this correctly.

### SD-003 — F-031 amend is agent-only (spec said "Supplier, Agent")
The original F-031 listed both supplier and agent as actors. The implementation restricts `PUT /agreements/{id}` to agent JWT only, consistent with F-029 (agent initiates agreement terms). The supplier's role is to review and confirm, not to draft.

### SD-004 — `create_agreement` allows re-creation after active agreement
The original F-029 implied `version=1` is only for the first agreement. The service also handles the case where a prior active agreement exists and the agent creates a new one (`version = latest.version + 1`). This is consistent with the amendment path but triggered via `POST` rather than `PUT`.

---

## 4. Open issue: supplier-initiated agreement terms

The current implementation requires the **agent** to draft the initial agreement terms (F-029). The supplier can only review and confirm. This matches the F-032 spec acceptance criteria but means the supplier has no way to propose initial terms.

If the product requirement changes so that **either party** can propose agreement terms, the following changes are needed:
- `POST /connections/{id}/agreement` must accept supplier JWT (remove `require_role("agent")` guard)
- `SupplierAgreementView` needs a "Propose Terms" button routing to a supplier-visible form
- The form page (`AgentAgreementFormPage` or a new `SupplierAgreementFormPage`) needs to call the correct endpoint
- Both parties can still amend/confirm — no change to F-030 or F-031
