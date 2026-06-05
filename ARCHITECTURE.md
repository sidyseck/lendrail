# LendRail — High-Level Architecture

| Field | Value |
|---|---|
| Version | v0.2 |
| Date | June 2026 |
| Status | Reference architecture for MVP build |
| Author | Technical lead |
| Based on | MASTER_PRD.md v0.1 |

---

## 1. System Overview

LendRail is a post-trade data rail for agency lending. A Supplier (BTC holder) connects to an Agent Lender on the platform, agrees lending program terms, and the Agent books individual loans against the Supplier's custodied inventory. The platform pulls read-only data feeds from custodians (inventory and collateral) via mock adapters in the MVP, runs daily accrual jobs, and streams risk alerts to both parties when LTV thresholds are approached or breached. A thin React frontend talks to a single FastAPI backend over REST. The backend enforces role-based access (Supplier / Agent / Admin), owns all domain logic, persists state in PostgreSQL, and dispatches notifications and background jobs through a task queue. All custodian and market-data I/O is channelled through a narrow adapter interface that is mocked in the MVP and replaceable with real provider clients in later phases without touching domain logic.

---

## 2. Tech Stack Recommendation

The stack is chosen to run entirely on `docker compose up` locally, with each component swappable to a managed cloud equivalent when the time comes to productionalize. No accounts, no cloud spend, no external dependencies to run locally.

| Layer | Local (now) | Production path | Justification |
|---|---|---|---|
| **Frontend** | React + TypeScript + Vite (`localhost:5173`) | Vercel / Cloudflare Pages | De-facto standard; strong typing catches data-model mismatches early; Vite for fast dev loop. No Next.js — SSR adds ops complexity not needed for a logged-in B2B app. |
| **UI components** | shadcn/ui (Tailwind-based) | Same | Unstyled-but-polished primitives; easy to theme; no vendor lock-in. |
| **Backend** | Python 3.12 + FastAPI (`localhost:8000`) | Railway / Fly.io / any container host | Async-first, auto-generated OpenAPI docs, strong Pydantic validation. Python is the right fit for accrual math and LTV calculations. |
| **ORM** | SQLAlchemy 2.x (async) + Alembic | Same | Battle-tested; Alembic migrations run identically local and prod. |
| **Database** | PostgreSQL 16 in Docker | Neon / Supabase managed Postgres | Same Postgres — only the connection string changes. Alembic migrations are the promotion artifact. |
| **Auth** | Custom JWT (python-jose) with local user table | Swap to Supabase Auth or Auth0 — same JWT shape | Avoids any external service dependency for local dev. JWT carries `role` and `org_id` claims. Auth layer is isolated behind a `get_current_user` dependency — swapping the issuer is a one-file change. |
| **Background jobs** | ARQ + Redis in Docker | Same ARQ, managed Redis (Upstash / Redis Cloud) | Lightweight async runner; fits the FastAPI event loop; no Celery overhead. |
| **Notifications** | Log-to-console + in-app DB rows locally | Resend for transactional email in prod | Notification service has an interface; local implementation just logs. Swap to Resend adapter before first real user. |
| **Secret storage** | `.env` file + AES-256 encrypted column in Postgres locally | HashiCorp Vault / AWS Secrets Manager / Supabase Vault | `SecretStore` interface is injected. Local impl reads from env. Prod impl reads from vault. Custodian keys never appear in logs in either case. |
| **Local orchestration** | Docker Compose (postgres, redis, api, worker, frontend) | — | Single `docker compose up` starts the full stack. |

---

## 3. Service / Layer Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│              React SPA  (local: localhost:5173)                  │
│  Supplier UI │ Agent UI │ Admin UI │ Shared components          │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP / REST + JWT
┌───────────────────────────▼─────────────────────────────────────┐
│            FastAPI Application  (local: localhost:8000)          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  API Layer  (routers, request/response models, auth deps) │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │                                        │
│  ┌──────────────────────▼───────────────────────────────────┐   │
│  │  Domain Services                                          │   │
│  │  OnboardingService │ ConnectionService │ AgreementService │   │
│  │  LoanService │ RiskService │ AccrualService               │   │
│  └──────┬────────────────────────────────┬──────────────────┘   │
│         │                                │                        │
│  ┌──────▼──────────┐          ┌──────────▼───────────────────┐  │
│  │  Data Layer     │          │  Adapter Layer               │  │
│  │  SQLAlchemy     │          │  CustodianAdapter (interface)│  │
│  │  repositories   │          │  ├─ MockCustodianAdapter     │  │
│  │  + Alembic      │          │  └─ (AnchorageCustodian TBD) │  │
│  └──────┬──────────┘          │  MarketDataAdapter (iface)   │  │
│         │                     │  ├─ MockMarketDataAdapter    │  │
│  ┌──────▼──────────┐          │  └─ (real feed TBD)          │  │
│  │  PostgreSQL 16  │          └──────────────────────────────┘  │
│  │  (Docker local) │                                             │
│  └─────────────────┘                                             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Background Workers (ARQ + Redis in Docker)                │  │
│  │  DailyAccrualWorker │ LTVRefreshWorker │ AlertWorker       │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Notification Layer                                        │  │
│  │  NotificationService → console log (local) / email (prod) │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Layer responsibilities in brief:**

- **API Layer** — HTTP routing, input validation (Pydantic), auth middleware, no business logic.
- **Domain Services** — all business rules live here. Services call repositories for data and adapters for external I/O. Never import FastAPI types.
- **Data Layer** — SQLAlchemy async repository classes, one per aggregate root. No raw SQL in services.
- **Adapter Layer** — thin wrappers around external providers. Domain services call the interface only; the concrete class is injected at startup via dependency injection.
- **Background Workers** — scheduled and queued tasks. Call the same Domain Services as the API layer.
- **Notification Layer** — single `NotificationService` called by Domain Services. Decides channel (email, in-app) based on user preferences.

---

## 4. Data Model Sketch

Relationships: Supplier and AgentLender are both `Organization` subtypes. A `Connection` links one Supplier to one AgentLender. A `LendingAgreement` is attached to a Connection. `Loan` records belong to a Connection and reference a `Borrower`. `Accrual` rows are children of `Loan`. `Statement` is a locked month-end snapshot per Connection.

```
Organization
  id          UUID PK
  name        TEXT
  jurisdiction TEXT
  entity_type ENUM(fund, corporate_treasury, foundation, agent)
  role        ENUM(supplier, agent, admin)
  contact_email TEXT
  created_at  TIMESTAMPTZ

CustodianLink                          -- one row per org-custodian relationship
  id          UUID PK
  org_id      UUID FK → Organization
  custodian_id TEXT                    -- e.g. "anchorage", "mock"
  account_ref TEXT                     -- custodian-side account identifier
  encrypted_api_key_ref TEXT           -- pointer into Supabase Vault, never the key itself
  scope       JSONB                    -- {"assets":["BTC"], "permissions":["read","instruct"]}
  status      ENUM(active, suspended, revoked)
  created_at  TIMESTAMPTZ

Connection
  id          UUID PK
  supplier_id UUID FK → Organization
  agent_id    UUID FK → Organization
  status      ENUM(pending, active, suspended, terminated)
  custodian_link_id UUID FK → CustodianLink  -- the per-relationship key
  created_at  TIMESTAMPTZ
  activated_at TIMESTAMPTZ

LendingAgreement
  id               UUID PK
  connection_id    UUID FK → Connection
  version          INT                 -- incremented on each re-confirmation
  assets_in_scope  TEXT[]              -- ["BTC"]
  eligible_collateral TEXT[]
  initial_ltv_pct  NUMERIC
  margin_call_ltv_pct NUMERIC
  recall_notice_days INT
  max_loan_days    INT
  day_count_basis  ENUM(actual_360, actual_365)
  agent_fee_bps    INT
  confirmed_by_supplier_at TIMESTAMPTZ
  confirmed_by_agent_at    TIMESTAMPTZ
  created_at       TIMESTAMPTZ

Borrower
  id           UUID PK
  invited_by   UUID FK → Organization   -- the agent who invited them
  name         TEXT
  jurisdiction TEXT
  contact_email TEXT
  status       ENUM(invited, active)
  created_at   TIMESTAMPTZ

Loan
  id                UUID PK
  connection_id     UUID FK → Connection
  agreement_id      UUID FK → LendingAgreement
  borrower_id       UUID FK → Borrower
  asset_type        TEXT                -- "BTC"
  quantity          NUMERIC
  rate_bps          INT                 -- annual rate in basis points
  term_type         ENUM(open, fixed)
  maturity_date     DATE                -- NULL if open
  day_count_basis   ENUM(actual_360, actual_365)  -- copied from agreement at booking
  collateral_type   TEXT
  collateral_quantity NUMERIC
  collateral_value_usd NUMERIC          -- at booking
  current_ltv_pct   NUMERIC             -- updated by LTVRefreshWorker
  ltv_as_of         TIMESTAMPTZ
  state             ENUM(pending, active, margin_call, recall_initiated, settled, defaulted)
  booked_at         TIMESTAMPTZ
  settled_at        TIMESTAMPTZ

Accrual
  id           UUID PK
  loan_id      UUID FK → Loan
  accrual_date DATE
  quantity_outstanding NUMERIC         -- from custodian feed as-of end of day
  daily_interest NUMERIC
  agent_fee    NUMERIC
  net_to_supplier NUMERIC
  source_feed_id TEXT
  feed_as_of   TIMESTAMPTZ
  created_at   TIMESTAMPTZ

Statement
  id              UUID PK
  connection_id   UUID FK → Connection
  period_start    DATE
  period_end      DATE
  gross_interest  NUMERIC
  agent_fee_total NUMERIC
  net_to_supplier NUMERIC
  locked_at       TIMESTAMPTZ          -- NULL until end-of-month job runs
  amendment_of    UUID FK → Statement  -- NULL for original; set on revised statements
  created_at      TIMESTAMPTZ
```

**Key joins to keep in mind:**

- Risk cockpit query: `Loan JOIN Connection JOIN LendingAgreement` filtered by `supplier_id`.
- Accrual sweep: `Loan WHERE state = 'active'` for a given `accrual_date`.
- Statement build: `SUM(Accrual) WHERE loan.connection_id = X AND accrual_date BETWEEN period_start AND period_end`.

---

## 5. Mock Adapter Pattern

Every external I/O point is expressed as a Python Protocol (structural interface). Domain services are typed against the protocol. The concrete class is injected at FastAPI startup via the dependency-injection container. Swapping mock → real means changing one line in the DI setup — no domain logic changes.

### Interface contracts

```python
# adapters/interfaces.py

from typing import Protocol
from dataclasses import dataclass
from datetime import datetime

@dataclass
class InventoryPosition:
    account_ref: str
    asset_type: str          # "BTC"
    quantity: float
    as_of: datetime
    feed_id: str

@dataclass
class CollateralPosition:
    loan_ref: str            # custodian-side loan or account identifier
    collateral_type: str
    quantity: float
    value_usd: float
    as_of: datetime
    feed_id: str

@dataclass
class InstructionResult:
    success: bool
    custodian_ref: str       # custodian-side confirmation ID
    executed_at: datetime
    error_msg: str | None

class CustodianAdapter(Protocol):
    """Read inventory and collateral; transmit agent-initiated settlement instructions."""

    def get_inventory(self, account_ref: str) -> list[InventoryPosition]: ...

    def get_collateral(self, loan_ref: str) -> CollateralPosition | None: ...

    def validate_key(self) -> bool:
        """Test-call to verify the API key is still valid. Called during connection setup."""
        ...

    def transmit_instruction(
        self,
        instruction_type: str,   # "delivery" | "return"
        asset_type: str,
        quantity: float,
        from_account: str,
        to_account: str,
        agent_ref: str,          # agent-side reference for audit
    ) -> InstructionResult: ...


@dataclass
class AssetPrice:
    asset_type: str
    price_usd: float
    as_of: datetime
    source: str

class MarketDataAdapter(Protocol):
    """Collateral pricing. Separate from custodian feed per PRD open question #2."""

    def get_price(self, asset_type: str) -> AssetPrice: ...
```

### Mock implementations

```python
# adapters/mock_custodian.py

from datetime import datetime, timezone
from .interfaces import CustodianAdapter, InventoryPosition, CollateralPosition, InstructionResult

class MockCustodianAdapter:
    """Deterministic mock. State can be seeded per test via constructor kwargs."""

    def __init__(self, inventory: dict | None = None, collateral: dict | None = None):
        self._inventory = inventory or {"BTC": 100.0}
        self._collateral = collateral or {}

    def get_inventory(self, account_ref: str) -> list[InventoryPosition]:
        return [
            InventoryPosition(
                account_ref=account_ref,
                asset_type=k,
                quantity=v,
                as_of=datetime.now(timezone.utc),
                feed_id="mock-feed-001",
            )
            for k, v in self._inventory.items()
        ]

    def get_collateral(self, loan_ref: str) -> CollateralPosition | None:
        data = self._collateral.get(loan_ref)
        if not data:
            return None
        return CollateralPosition(loan_ref=loan_ref, **data,
                                   as_of=datetime.now(timezone.utc),
                                   feed_id="mock-feed-002")

    def validate_key(self) -> bool:
        return True

    def transmit_instruction(self, instruction_type, asset_type, quantity,
                              from_account, to_account, agent_ref) -> InstructionResult:
        return InstructionResult(
            success=True,
            custodian_ref=f"mock-conf-{agent_ref}",
            executed_at=datetime.now(timezone.utc),
            error_msg=None,
        )
```

### DI wiring (startup)

```python
# main.py (simplified)

import os
from adapters.mock_custodian import MockCustodianAdapter
from adapters.mock_market_data import MockMarketDataAdapter

def get_custodian_adapter() -> CustodianAdapter:
    if os.getenv("CUSTODIAN_ADAPTER", "mock") == "mock":
        return MockCustodianAdapter()
    # Production: uncomment and wire the real adapter
    # from adapters.anchorage import AnchorageCustodianAdapter
    # return AnchorageCustodianAdapter(api_key=secret_store.get("anchorage_key"))
    raise NotImplementedError("Real custodian adapter not wired yet")

app.dependency_overrides[CustodianAdapter] = get_custodian_adapter
```

---

## 5b. Local Development Setup

### Docker Compose stack

All services run locally via a single `docker compose up`. No cloud accounts required.

```yaml
# docker-compose.yml (top-level layout)
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: lendrail
      POSTGRES_USER: lendrail
      POSTGRES_PASSWORD: lendrail
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  api:
    build: ./backend
    command: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
    env_file: .env.local
    ports: ["8000:8000"]
    depends_on: [postgres, redis]

  worker:
    build: ./backend
    command: python -m arq app.workers.WorkerSettings
    env_file: .env.local
    depends_on: [postgres, redis]

  frontend:
    build: ./frontend
    command: npm run dev -- --host
    ports: ["5173:5173"]
    depends_on: [api]

volumes:
  pgdata:
```

### Environment variables (`.env.local`)

```bash
# Database
DATABASE_URL=postgresql+asyncpg://lendrail:lendrail@postgres:5432/lendrail

# Redis
REDIS_URL=redis://redis:6379

# Auth — local JWT signing key (any random string for local dev)
JWT_SECRET=local-dev-secret-change-in-prod
JWT_ALGORITHM=HS256

# Adapter selection — "mock" for local, real provider name for prod
CUSTODIAN_ADAPTER=mock
MARKET_DATA_ADAPTER=mock

# Notifications — "console" locally, "resend" in prod
NOTIFICATION_ADAPTER=console
RESEND_API_KEY=        # blank locally

# Secret store — "env" locally, "vault" in prod
SECRET_STORE=env
```

### Production promotion checklist

When ready to deploy, the only things that change are environment variables and the infra wiring. The codebase ships unchanged.

| Local | Production swap |
|---|---|
| Postgres in Docker | Neon / Supabase managed Postgres — update `DATABASE_URL` |
| Redis in Docker | Upstash or Redis Cloud — update `REDIS_URL` |
| Local JWT signing | Rotate `JWT_SECRET` to a strong secret; or swap to Supabase Auth by implementing an alternate `get_current_user` dependency |
| `NOTIFICATION_ADAPTER=console` | Set `NOTIFICATION_ADAPTER=resend` + add `RESEND_API_KEY` |
| `SECRET_STORE=env` | Set `SECRET_STORE=vault` + wire `VaultSecretStore` implementation |
| `CUSTODIAN_ADAPTER=mock` | Set `CUSTODIAN_ADAPTER=anchorage` + implement `AnchorageCustodianAdapter` |
| `docker compose up` | Deploy containers to Railway / Fly.io; frontend to Vercel |

No domain logic changes. No data model changes. The only code changes for productionalization are adding concrete adapter implementations (one class per external provider).

**Rules for adapter implementors (when wiring real providers):**
1. Match the Protocol exactly — no extra required params.
2. All exceptions from the provider must be caught and translated to a typed `AdapterError`; domain services never see raw HTTP errors.
3. Return `as_of` timestamps from the provider's response, not `datetime.now()`.
4. Log all outbound calls at DEBUG; log errors at ERROR with the provider reference.

---

## 6. Auth and Access Control Model

### Authentication

Locally: FastAPI issues JWTs directly using `python-jose` with a signing key from `.env.local`. The `/auth/login` endpoint takes email + password, validates against the local `users` table, and returns a signed JWT. No external service required.

In production: swap the `get_current_user` dependency to validate tokens issued by Supabase Auth or Auth0. The JWT shape (`role`, `org_id` claims) stays identical — no other code changes.

Every request must include `Authorization: Bearer <token>`. A FastAPI dependency (`get_current_user`) validates the token signature and extracts:

```python
@dataclass
class AuthUser:
    user_id: UUID
    org_id: UUID
    role: Literal["supplier", "agent", "admin"]
```

### Role definitions

| Role | Can do | Cannot do |
|---|---|---|
| **supplier** | View own org data, view loans on their connections, confirm agreements, issue recall instructions, view statements | Book loans, invite borrowers, access another supplier's data |
| **agent** | Book loans, invite borrowers, enter agreement terms, view own connection data | View another agent's loans or connections, see raw custodian API keys |
| **admin** | Read all data, manage org registrations, trigger manual jobs | Book loans on behalf of users (audit integrity) |

### Enforcement pattern

Authorization is a two-step check applied in every domain service method:

1. **Role check** — is the caller's role permitted to invoke this operation at all?
2. **Ownership check** — does the caller's `org_id` have access to the specific resource being accessed?

```python
# services/loan_service.py (illustrative)

def book_loan(self, caller: AuthUser, payload: LoanBookingRequest) -> Loan:
    # 1. Role check
    if caller.role != "agent":
        raise Forbidden("Only agent lenders can book loans")

    # 2. Ownership check — connection must belong to caller's org
    connection = self.connection_repo.get(payload.connection_id)
    if connection.agent_id != caller.org_id:
        raise Forbidden("Connection does not belong to your organization")

    # ... domain logic
```

Ownership checks use pre-loaded org membership from the JWT — no extra DB round-trip per request.

### Custodian API key access

Custodian API keys are stored in Supabase Vault. The application retrieves them by reference ID only when constructing an adapter call. The raw key never appears in:
- API responses
- Application logs (`logging.DEBUG` or higher)
- Database columns (only the Vault reference ID is stored in `CustodianLink.encrypted_api_key_ref`)

---

## 7. Key Flows Mapped to Architecture

### Flow A — Supplier onboarding + custodian linkage

```
Supplier → POST /orgs/register (role=supplier)
  API Layer: validate payload, no auth required (public endpoint)
  → OnboardingService.register_org()
    → OrgRepository.create()                [Data Layer]
    → Supabase Auth: create user account
  ← 201 org_id + JWT

Supplier → POST /custodian-links (auth=supplier JWT)
  API Layer: extract org_id from JWT
  → OnboardingService.link_custodian(org_id, custodian_id, api_key_plaintext, account_ref)
    → VaultClient.store(api_key_plaintext)  [returns vault_ref]
    → CustodianAdapter.validate_key()       [Adapter Layer — mock in MVP]
      if False: raise CustodianKeyInvalid
    → CustodianLinkRepository.create(org_id, custodian_id, vault_ref, account_ref)
                                            [Data Layer]
  ← 201 custodian_link_id
```

The raw API key touches only `OnboardingService` and the Vault client. It is never returned in any response.

---

### Flow B — Agent books a loan

```
Agent → POST /loans (auth=agent JWT)
  API Layer: extract org_id from JWT, validate LoanBookingRequest schema
  → LoanService.book_loan(caller, payload)

    1. Role + ownership check (see §6)

    2. AgreementService.get_active(connection_id)
       → AgreementRepository.get_confirmed(connection_id)  [Data Layer]

    3. Validate payload against agreement terms:
       - borrower on approved list
       - asset_type in agreement.assets_in_scope
       - collateral_type in agreement.eligible_collateral
       - initial LTV = collateral_value / (quantity × current_btc_price) ≤ agreement.initial_ltv_pct

    4. CustodianAdapter.get_inventory(connection.custodian_link.account_ref)
       [Adapter Layer — mock returns seeded inventory]
       → verify quantity available

    5. CustodianAdapter.get_collateral(payload.borrower_collateral_ref)
       → verify collateral posted

    6. LoanRepository.create(state=pending)   [Data Layer]

    7. NotificationService.send(
         recipients=[supplier, agent],
         event="loan_booked",
         loan_id=loan.id
       )
       → Resend email + in-app notification row  [Notification Layer]

  ← 201 loan_id, state="pending"
```

State transitions from `pending` → `active` are driven by the `LTVRefreshWorker` once both inventory and collateral feeds confirm the loan.

---

### Flow C — Risk monitoring LTV refresh cycle

```
[Scheduler: every N minutes, configurable]

ARQ enqueues: ltv_refresh_job(loan_ids=[all active loan IDs])

LTVRefreshWorker.run(loan_ids):
  for each loan_id:
    1. LoanRepository.get(loan_id)                       [Data Layer]
    2. CustodianAdapter.get_collateral(loan.collateral_ref)
       [Adapter Layer — mock returns position with as_of timestamp]
       if None or as_of stale (> threshold):
         NotificationService.send(event="feed_stale", ...)
         LoanRepository.mark_ltv_stale(loan_id)
         continue

    3. current_ltv = collateral.value_usd / (loan.quantity × btc_price_usd)
       btc_price_usd from MarketDataAdapter.get_price("BTC")
       [open question #2 — mock returns fixed price in MVP]

    4. LoanRepository.update_ltv(loan_id, current_ltv, as_of=collateral.as_of)
                                                         [Data Layer]

    5. RiskService.evaluate_thresholds(loan, current_ltv, agreement):
       if current_ltv >= agreement.margin_call_ltv_pct:
         LoanRepository.transition_state(loan_id, "margin_call")
         NotificationService.send(event="margin_call", recipients=[supplier, agent])
       elif current_ltv >= (agreement.margin_call_ltv_pct * 0.90):
         NotificationService.send(event="ltv_warning", recipients=[supplier, agent])
```

The LTV refresh cycle is the only path that can transition a loan to `margin_call` state autonomously. All other state transitions require an authenticated agent or supplier action.

---

## 8. What Is Intentionally NOT Built

This list mirrors the PRD's out-of-scope items. Engineers should treat these as explicit boundaries — do not design hooks for them unless noted.

| Not built | Note |
|---|---|
| Matching / execution layer | Platform does not arrange transactions. Loan booking is a record of an already-agreed deal. |
| Borrower-facing portal | Borrower entity exists in DB for data model integrity; no UI, no borrower-auth flows. |
| Autonomous custodian instructions | Every custodian write must be triggered by an authenticated agent action. No scheduled or rule-triggered asset movements. |
| PDF upload / NLP extraction of agreement terms | Manual entry only. Storage infrastructure for documents is not needed. |
| Multi-asset support | BTC only. `asset_type` field exists for extensibility but no validation, pricing, or UI built for other assets. |
| Market data / live collateral pricing | Price source is mocked (fixed value). Real exchange or oracle feed wired in a later phase (PRD open question #2). |
| Fee distribution and programmatic settlement | Statement is a reporting artifact only. No payment rails, no cash tracking. |
| RWA asset support | Out of scope entirely. |
| Phase 1 matching layer | Out of scope entirely. |
| E-signature / legal doc management | Agreement terms are manually entered and confirmed by both parties via platform UI. |
| Platform fee billing | Platform fee line item on statements deferred; billing handled out-of-band. |

---

## 9. Open Architecture Questions

These directly map to the PRD's open questions. Each blocks or shapes a specific layer.

| # | Question | Architecture impact | PRD ref |
|---|---|---|---|
| 1 | **Which custodian is v1 target?** Anchorage is assumed. | Determines the real `CustodianAdapter` implementation: API base URL, auth header format, field mapping for `InventoryPosition` and `CollateralPosition`. Mock adapter is intentionally schema-agnostic. Until resolved, the `AnchorageCustodianAdapter` class stub exists but is not wired. | OQ-1 |
| 2 | **Collateral pricing source for LTV?** Oracle, exchange feed, or custodian-provided valuation? | Determines whether `MarketDataAdapter.get_price()` calls an external feed or reads from the custodian's collateral response. If the custodian provides valuations, `MarketDataAdapter` may be a thin wrapper around `CustodianAdapter.get_collateral()`. Affects data integrity obligations and staleness handling. | OQ-2 |
| 3 | **Who initiates the supplier-agent connection — supplier, agent, or either?** | The connection invitation flow in `ConnectionService` changes. If either party can initiate, the invite object needs a `direction` flag and both parties need a pending-invite inbox. Moderate UI impact; low backend impact. | OQ-3 |
| 4 | **KYB/KYC scope at onboarding** | Determines whether `OnboardingService.register_org()` must call an identity verification provider (e.g. Persona, Stripe Identity) before activating an org, or whether self-attestation is sufficient. If a provider is needed, it becomes a third adapter interface. Legal sign-off required before external launch regardless. | OQ-4 |
| 6 | **First supplier archetype** | Drives field-level requirements for the `Organization` entity and onboarding form (e.g. fund → NAV, corporate treasury → ticker). Low code impact but affects v1 onboarding UX priority. | OQ-6 |
| — | **LTV refresh frequency** | Not in PRD. Needs a product decision: how often does the LTV refresh job run? Affects Redis job throughput sizing and staleness alert thresholds. Recommend starting at 15-minute intervals and making it configurable per connection. | — |
| — | **Statement locking trigger** | Not specified: is month-end statement generation triggered automatically by the scheduler at 00:00 UTC on the 1st, or manually by Admin? Automatic is safer but needs a re-run / correction path for failed runs. | — |
