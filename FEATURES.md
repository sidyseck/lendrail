# LendRail — Feature Decomposition

| Field | Value |
|---|---|
| Based on | MASTER_PRD.md v0.1, ARCHITECTURE.md v0.2 |
| Date | June 2026 |
| Status | Working draft |

---

## Milestones

| Milestone | Goal |
|---|---|
| **M0 — Foundation** | Project scaffolding, Docker Compose, DB migrations, auth skeleton. Nothing domain-specific. |
| **M1 — Onboarding** | Supplier, Agent, and Borrower can register and be recognized by the system; org workspaces can manage legal-entity accounts, users, roles, and MVP read/write permissions. |
| **M2 — Connection** | Supplier and Agent can connect; custodian API key provisioned and validated against mock. |
| **M3 — Agreement** | Lending agreement terms entered and dual-confirmed. |
| **M4 — Loan lifecycle** | Agent books loans; loans move through states; mock custodian confirms. |
| **M5 — Risk monitoring** | LTV calculated and displayed; alerts fire; feed staleness flagged. |
| **M6 — Accrual & Reporting** | Daily accruals run; monthly statement generated and locked. |

---

## M0 — Foundation

---

### F-001 — Monorepo layout and Docker Compose stack
**Milestone:** M0
**Depends on:** none
**Actor(s):** System (developer)

**What it does:** Creates the top-level repository layout (`backend/`, `frontend/`, `docker-compose.yml`, `.env.local.example`) and wires five Docker services — postgres, redis, api, worker, frontend — so the full stack starts with `docker compose up`.

**Acceptance criteria:**
- [ ] `docker compose up` starts without errors on a clean checkout (no pre-existing volumes).
- [ ] `curl http://localhost:8000/healthz` returns `{"status": "ok"}` with HTTP 200.
- [ ] `curl http://localhost:5173` returns an HTML response (Vite dev server is live).
- [ ] `docker compose down -v` tears down cleanly; re-running `up` rebuilds successfully.
- [ ] `.env.local.example` lists every required environment variable with placeholder values and a comment.

**Out of scope for this feature:** Any domain endpoints, database tables, authentication, real business logic.

---

### F-002 — PostgreSQL database and Alembic migration runner
**Milestone:** M0
**Depends on:** F-001
**Actor(s):** System

**What it does:** Initializes Alembic in the `backend/` directory with a working `alembic.ini` and `env.py` that connects to the Dockerized Postgres instance, and runs the initial empty migration to prove the pipeline works.

**Acceptance criteria:**
- [ ] `alembic upgrade head` runs against the Docker Postgres instance with zero errors.
- [ ] `alembic history` shows at least one applied revision.
- [ ] `alembic downgrade base` reverts cleanly and `alembic upgrade head` re-applies with no errors.
- [ ] The `DATABASE_URL` is read from the environment variable, not hardcoded.

**Out of scope for this feature:** Any application tables; those are created in subsequent F-IDs.

---

### F-003 — SQLAlchemy async session factory and repository base
**Milestone:** M0
**Depends on:** F-002
**Actor(s):** System

**What it does:** Provides the shared async SQLAlchemy engine, session factory, and a `BaseRepository` class with `get`, `create`, `update`, and `delete` helpers that all future repositories will extend.

**Acceptance criteria:**
- [ ] A unit test opens an async session against the test database, creates a minimal row via a test repository, and reads it back — all assertions pass.
- [ ] The session is properly closed after each request (no connection leaks detectable via `pg_stat_activity`).
- [ ] `BaseRepository` methods raise a typed `NotFoundError` (not a raw SQLAlchemy exception) when a record is missing.

**Out of scope for this feature:** Any domain models or tables.

---

### F-004 — JWT authentication: login endpoint and `get_current_user` dependency
**Milestone:** M0
**Depends on:** F-003
**Actor(s):** System / all roles

**What it does:** Implements `POST /auth/login` (email + password against a local `users` table), issues a signed JWT containing `user_id`, `org_id`, and `role` claims, and provides a reusable FastAPI dependency `get_current_user` that validates the token on every protected request.

**Acceptance criteria:**
- [ ] `POST /auth/login` with valid credentials returns HTTP 200 with a `{ "access_token": "...", "token_type": "bearer" }` response.
- [ ] `POST /auth/login` with wrong password returns HTTP 401.
- [ ] A protected endpoint decorated with `Depends(get_current_user)` returns HTTP 401 when no token is provided.
- [ ] A protected endpoint returns HTTP 401 when the token is tampered with (signature invalid).
- [ ] The decoded token contains `user_id`, `org_id`, and `role` fields with correct types.
- [ ] JWT signing key is read from the `JWT_SECRET` environment variable.

**Out of scope for this feature:** Role-based authorization beyond token validation; user registration (covered in onboarding features); password reset.

---

### F-005 — Role-based access control (RBAC) enforcement helpers
**Milestone:** M0
**Depends on:** F-004
**Actor(s):** System

**What it does:** Provides reusable FastAPI dependencies (`require_role("supplier")`, `require_role("agent")`, `require_role("admin")`) and a two-step enforcement pattern (role check + ownership check) used by all domain services.

**Acceptance criteria:**
- [ ] A route guarded by `require_role("agent")` returns HTTP 403 when called with a supplier JWT.
- [ ] A route guarded by `require_role("supplier")` returns HTTP 403 when called with an agent JWT.
- [ ] An admin JWT passes `require_role("admin")` checks.
- [ ] Unit tests cover all three role combinations against each guard.
- [ ] The `AuthUser` dataclass (`user_id`, `org_id`, `role`) is the only type passed from the auth layer into domain services.

**Out of scope for this feature:** Per-resource ownership checks (those live in each domain service).

---

### F-006 — Notification service interface and console adapter
**Milestone:** M0
**Depends on:** F-003
**Actor(s):** System

**What it does:** Defines the `NotificationService` interface and a `ConsoleNotificationAdapter` that logs events to stdout. Creates an in-app `notifications` DB table for storing notification rows. Wires adapter selection via the `NOTIFICATION_ADAPTER` environment variable.

**Acceptance criteria:**
- [ ] Calling `NotificationService.send(event="test", recipients=[...])` with `NOTIFICATION_ADAPTER=console` prints a structured log line to stdout containing the event name and recipient IDs.
- [ ] A `notifications` table exists in Postgres after migration with columns: `id`, `user_id`, `event`, `payload` (JSONB), `created_at`, `read_at`.
- [ ] A unit test verifies the console adapter logs correctly without calling any external service.
- [ ] Swapping to a different adapter does not require changes outside `main.py` DI wiring.

**Out of scope for this feature:** Email delivery (Resend adapter); in-app notification read/unread API endpoints.

---

### F-007 — Background job scheduler: ARQ worker setup
**Milestone:** M0
**Depends on:** F-001
**Actor(s):** System

**What it does:** Wires ARQ with the Dockerized Redis instance, defines a `WorkerSettings` class, and adds a no-op `health_check_job` that runs every minute as a smoke test.

**Acceptance criteria:**
- [ ] `docker compose up worker` starts without errors.
- [ ] The health check job runs every 60 seconds and logs a line confirming execution.
- [ ] A failed job (raises an exception) is logged at ERROR level with the traceback; the worker does not crash.
- [ ] `REDIS_URL` is read from the environment variable.

**Out of scope for this feature:** Any domain-specific jobs; job scheduling intervals for LTV refresh or accruals.

---

### F-008 — Mock custodian adapter and mock market data adapter
**Milestone:** M0
**Depends on:** F-001
**Actor(s):** System

**What it does:** Implements `MockCustodianAdapter` and `MockMarketDataAdapter` as concrete Python classes matching the `CustodianAdapter` and `MarketDataAdapter` Protocol interfaces defined in `adapters/interfaces.py`. Wires them as the default adapters when `CUSTODIAN_ADAPTER=mock` and `MARKET_DATA_ADAPTER=mock`.

**Acceptance criteria:**
- [ ] `MockCustodianAdapter.get_inventory("any-ref")` returns at least one `InventoryPosition` with `asset_type="BTC"` and a non-null `as_of` timestamp.
- [ ] `MockCustodianAdapter.get_collateral("any-ref")` returns a `CollateralPosition` or `None` based on seeded state.
- [ ] `MockCustodianAdapter.validate_key()` returns `True`.
- [ ] `MockCustodianAdapter.transmit_instruction(...)` returns an `InstructionResult` with `success=True` and a non-empty `custodian_ref`.
- [ ] `MockMarketDataAdapter.get_price("BTC")` returns an `AssetPrice` with a fixed positive `price_usd`.
- [ ] Swapping `CUSTODIAN_ADAPTER=mock` to a different value raises `NotImplementedError` (no real adapter wired yet).
- [ ] Unit tests cover all four `CustodianAdapter` methods on the mock.

**Out of scope for this feature:** Real custodian adapters (Anchorage); market data from a live feed.

---

### F-009 — Secret store interface and local env-based implementation
**Milestone:** M0
**Depends on:** F-001
**Actor(s):** System

**What it does:** Defines a `SecretStore` interface with `store(key, value) -> ref` and `retrieve(ref) -> value` methods. Implements `EnvSecretStore` that encrypts values with AES-256 and stores them as base64 strings keyed by a UUID reference. Wires it when `SECRET_STORE=env`.

**Acceptance criteria:**
- [ ] `EnvSecretStore.store("my-key")` returns a UUID reference string.
- [ ] `EnvSecretStore.retrieve(ref)` returns the original plaintext value.
- [ ] The plaintext value never appears in any log line (verified by log capture in a unit test).
- [ ] An invalid reference raises a typed `SecretNotFoundError`.
- [ ] The encryption key is derived from `JWT_SECRET` (or a dedicated `SECRET_STORE_KEY` env var).

**Out of scope for this feature:** Vault or cloud secret manager adapters; key rotation.

---

### F-010 — React + Vite frontend scaffold with auth shell
**Milestone:** M0
**Depends on:** F-004
**Actor(s):** System (developer)

**What it does:** Scaffolds the React + TypeScript + Vite frontend with shadcn/ui, Tailwind CSS, React Router, and an auth context that stores and forwards the JWT. Provides a login page that calls `POST /auth/login` and redirects on success, and a `ProtectedRoute` wrapper that redirects unauthenticated users to `/login`.

**Acceptance criteria:**
- [ ] Visiting `http://localhost:5173/login` renders a login form with email and password fields and a submit button.
- [ ] Submitting valid credentials redirects the user to `/dashboard` and stores the token in memory (not `localStorage`).
- [ ] Submitting invalid credentials displays an error message below the form without a full page reload.
- [ ] Visiting a protected route without a token redirects to `/login`.
- [ ] After login, the JWT is attached as a `Bearer` token to all API calls (verified by browser network tab).
- [ ] TypeScript compilation passes with zero type errors (`tsc --noEmit`).

**Out of scope for this feature:** Any domain-specific pages beyond login and an empty dashboard shell; role-specific navigation.

---

## M1 — Onboarding

---

### F-011 — Organization DB table and migration
**Milestone:** M1
**Depends on:** F-002
**Actor(s):** System

**What it does:** Adds the `organizations` Alembic migration creating the `Organization` table with columns: `id` (UUID PK), `name`, `jurisdiction`, `entity_type` (ENUM), `role` (ENUM: supplier, agent, admin), `contact_email`, `created_at`. In M1, this table remains the compatibility record used by downstream connection workflows while the onboarding UI presents it as a workspace created with one initial legal-entity account.

**Acceptance criteria:**
- [ ] `alembic upgrade head` applies the migration without errors.
- [ ] `alembic downgrade -1` drops the table cleanly.
- [ ] The `role` column accepts only `supplier`, `agent`, `admin`; inserting any other value raises a DB-level error.
- [ ] `entity_type` accepts only `fund`, `corporate_treasury`, `foundation`, `agent`.

**Out of scope for this feature:** User table (covered in F-012); CustodianLink table (F-016).

---

### F-012 — Users DB table, password hashing, and migration
**Milestone:** M1
**Depends on:** F-011
**Actor(s):** System

**What it does:** Adds the `users` Alembic migration creating a `users` table with `id`, `org_id` (FK → organizations), `email`, `hashed_password`, `created_at`. Provides a `hash_password` / `verify_password` utility using bcrypt.

**Acceptance criteria:**
- [ ] `alembic upgrade head` applies cleanly; downgrade removes the table.
- [ ] `hash_password("secret")` returns a bcrypt hash string.
- [ ] `verify_password("secret", hash)` returns `True`; `verify_password("wrong", hash)` returns `False`.
- [ ] The raw password never appears in any log line (verified by log capture test).
- [ ] A user row cannot be inserted without a valid `org_id` FK reference (DB enforces the constraint).

**Out of scope for this feature:** Password reset, email verification, session management.

---

### F-013 — Supplier registration API endpoint
**Milestone:** M1
**Depends on:** F-011, F-012, F-005
**Actor(s):** Supplier

**What it does:** Implements supplier signup as the first onboarding action: create one organization workspace with one initial supplier legal-entity account. The public endpoint accepts `name` (the initial legal entity name, also used as the default organization name), `jurisdiction`, `entity_type`, `contact_email`, and `password`. The platform generates a unique `org_id`, creates the initial admin user from `contact_email`, hashes and stores the user's password, and returns a JWT so the user is immediately logged in.

**Acceptance criteria:**
- [ ] `POST /orgs/register` with valid supplier fields returns HTTP 201 with `{ "org_id": "...", "access_token": "..." }`.
- [ ] The created organization name defaults to the submitted legal entity name.
- [ ] The returned `org_id` is unique and stable for downstream M1/M2/M3 records.
- [ ] The first user created from `contact_email` is treated as the initial organization admin for organization-name edits and future user/account management.
- [ ] The returned JWT contains `role=supplier` and the correct `org_id`.
- [ ] Attempting to register with an already-used email returns HTTP 409 with an error body.
- [ ] `entity_type` values outside the allowed ENUM return HTTP 422.
- [ ] The `password` field is never returned in any response body.
- [ ] Integration test: register, then call `GET /orgs/me` with the returned token and receive the org record.

**Out of scope for this feature:** Custodian linkage; notification preferences; custodian invitation flow.

---

### F-014 — Supplier registration UI
**Milestone:** M1
**Depends on:** F-010, F-013
**Actor(s):** Supplier

**What it does:** React page at `/register/supplier` that makes "create your organization" the first action. The form creates one supplier organization workspace with one initial legal-entity account using legal entity name, jurisdiction, entity type (dropdown), primary contact email, and password. The organization name defaults to the legal entity name. On success, stores the token and redirects to `/dashboard`.

**Acceptance criteria:**
- [ ] All required fields display inline validation errors when submitted empty.
- [ ] Page headline says the user is creating an organization, not only registering an account.
- [ ] Helper copy explains the initial account rule: first signup creates one organization with one supplier legal-entity account, and the organization name can be edited later by the admin user.
- [ ] `entity_type` dropdown offers exactly: Fund, Corporate Treasury, Foundation.
- [ ] Successful submission stores the JWT and navigates to `/dashboard`.
- [ ] A duplicate email submission shows a user-readable error message ("Email already registered").
- [ ] TypeScript compilation passes with zero errors.

**Out of scope for this feature:** Custodian linkage form; notification preferences form.

---

### F-015 — Agent registration API endpoint
**Milestone:** M1
**Depends on:** F-011, F-012, F-005
**Actor(s):** Agent

**What it does:** Implements agent signup as the first onboarding action: create one organization workspace with one initial agent lender legal-entity account. The endpoint accepts `name` (the initial legal entity name, also used as the default organization name), `jurisdiction`, `entity_type`, primary contact, ops/settlement contact email, and self-attested regulatory status checkbox. The platform generates a unique `org_id`, creates the initial admin user from the primary contact, and returns a JWT.

**Acceptance criteria:**
- [ ] `POST /orgs/register` with `role=agent` and all required fields returns HTTP 201 with `{ "org_id": "...", "access_token": "..." }`.
- [ ] The created organization name defaults to the submitted legal entity name.
- [ ] The returned `org_id` is unique and stable for downstream M1/M2/M3 records.
- [ ] The first user created from the primary contact is treated as the initial organization admin for organization-name edits and future user/account management.
- [ ] The returned JWT contains `role=agent`.
- [ ] Missing `ops_contact_email` returns HTTP 422.
- [ ] `regulatory_status_attested=false` returns HTTP 422 with a message indicating attestation is required.
- [ ] Duplicate email returns HTTP 409.
- [ ] Integration test: register agent, then call `GET /orgs/me` and verify `role=agent`.

**Out of scope for this feature:** Custodian linkage; agent-side billing; market data access.

---

### F-016 — Agent registration UI
**Milestone:** M1
**Depends on:** F-010, F-015
**Actor(s):** Agent

**What it does:** React page at `/register/agent` that makes "create your organization" the first action. The form creates one agent lender organization workspace with one initial legal-entity account using legal entity details, ops/settlement contact, and a required regulatory status attestation checkbox. The organization name defaults to the legal entity name.

**Acceptance criteria:**
- [ ] Page headline says the user is creating an organization, not only registering an account.
- [ ] Helper copy explains the initial account rule: first signup creates one organization with one agent lender legal-entity account, and the organization name can be edited later by the admin user.
- [ ] Form shows an error when the attestation checkbox is unchecked and the user tries to submit.
- [ ] Ops/settlement contact email field is present and required.
- [ ] Successful submission stores the JWT and navigates to `/dashboard`.
- [ ] TypeScript compiles with zero errors.

**Out of scope for this feature:** Custodian linkage UI.

---

### F-017 — Borrower DB table and migration
**Milestone:** M1
**Depends on:** F-011
**Actor(s):** System

**What it does:** Adds the `borrowers` Alembic migration with columns: `id` (UUID PK), `invited_by` (FK → organizations), `name`, `jurisdiction`, `contact_email`, `status` (ENUM: invited, active), `created_at`.

**Acceptance criteria:**
- [ ] `alembic upgrade head` applies cleanly; `downgrade -1` removes the table.
- [ ] `status` accepts only `invited` or `active` at the DB level.
- [ ] `invited_by` FK references a valid organization; inserting an unknown `org_id` raises a constraint error.

**Out of scope for this feature:** Borrower-facing auth; borrower portal.

---

### F-018 — Borrower invite and account creation API endpoint
**Milestone:** M1
**Depends on:** F-017, F-005, F-006
**Actor(s):** Agent

**What it does:** Implements `POST /borrowers/invite` (requires agent JWT). The agent provides `email`, `name`, `jurisdiction`. The platform creates a `Borrower` row with `status=invited`, linked to the calling agent's org, and fires a notification (console log in MVP) that would carry the invite link.

**Acceptance criteria:**
- [ ] `POST /borrowers/invite` with a valid agent JWT and required fields returns HTTP 201 with `{ "borrower_id": "..." }`.
- [ ] Calling with a supplier JWT returns HTTP 403.
- [ ] The new borrower row has `invited_by` = the calling agent's `org_id`.
- [ ] A notification event `"borrower_invited"` is logged by the console adapter containing the borrower email.
- [ ] Inviting the same email twice returns HTTP 409.
- [ ] `GET /borrowers/{id}` (agent JWT) returns the borrower record.

**Out of scope for this feature:** Borrower self-registration UI; borrower email links that actually work; borrower-facing portal.

---

### F-019 — `GET /orgs/me` endpoint
**Milestone:** M1
**Depends on:** F-013, F-015, F-004
**Actor(s):** Supplier, Agent

**What it does:** Returns the authenticated user's organization record.

**Acceptance criteria:**
- [ ] `GET /orgs/me` with a valid JWT returns HTTP 200 with the organization fields (no password hash).
- [ ] Without a token returns HTTP 401.
- [ ] The response never includes `hashed_password`.

**Out of scope for this feature:** Org update/edit endpoints.

---

### F-019A — Organization management placeholder UI
**Milestone:** M1
**Depends on:** F-010, F-011, F-012, F-005
**Actor(s):** Supplier, Agent, Admin

**What it does:** Adds a protected dashboard page at `/dashboard/organization` that models organization management before the full backend workflow is implemented. The page treats an organization as a workspace, shows the unique organization ID from onboarding, shows that the initial creator is the admin user, treats accounts as actual legal entities, allows placeholder account and user creation, and demonstrates role assignment with read/write permissions. Write permission descriptions differ by account type: supplier write covers inventory scope, borrower approval, program-term confirmation, and supplier-side instructions; agent lender write covers borrower onboarding, loan booking, collateral reconciliation, and settlement instruction initiation.

**Acceptance criteria:**
- [ ] Dashboard navigation includes an "Organization" link for authenticated users.
- [ ] The organization page shows the generated organization ID.
- [ ] The organization page shows the initial creator as the admin user.
- [ ] The organization page allows the admin user to edit the workspace name in local placeholder state.
- [ ] A user can create a legal-entity account with legal name, jurisdiction, and account type (`supplier` or `agent lender`) in local placeholder state.
- [ ] A user can create a user record and attach it to an account.
- [ ] A user can assign one of the MVP roles to the user: supplier read, supplier write, agent lender read, or agent lender write.
- [ ] The page displays an account directory, a role model summary, and user assignments.
- [ ] The role model clearly distinguishes read from write and explains how write differs for supplier vs agent lender accounts.
- [ ] TypeScript compilation passes with zero errors.
- [ ] Frontend tests cover rendering the placeholder and creating an account/user assignment.

**Out of scope for this feature:** Persisting organizations/accounts/users through API endpoints; custom role creation; fine-grained permission matrix; SSO/SCIM; multi-account user membership policy; invite/approval workflow for user provisioning.

---

## M2 — Connection

---

### F-020 — CustodianLink DB table and migration
**Milestone:** M2
**Depends on:** F-011
**Actor(s):** System

**What it does:** Adds the `custodian_links` Alembic migration with columns: `id`, `org_id` (FK), `custodian_id`, `account_ref`, `encrypted_api_key_ref` (vault reference string, not the key), `scope` (JSONB), `status` (ENUM: active, suspended, revoked), `created_at`.

**Acceptance criteria:**
- [ ] `alembic upgrade head` applies cleanly; downgrade reverses cleanly.
- [ ] `status` column enforces the ENUM at DB level.
- [ ] `encrypted_api_key_ref` column is `TEXT NOT NULL`; the plaintext key is never stored here.

**Out of scope for this feature:** Connection table (F-021); key rotation logic.

---

### F-021 — Connection DB table and migration
**Milestone:** M2
**Depends on:** F-020
**Actor(s):** System

**What it does:** Adds the `connections` Alembic migration (0008) and the M2-redesign migration (0010) with columns: `id`, `supplier_id` (FK → organizations), `agent_id` (FK → organizations), `status` (ENUM: `pending`, `active`, `suspended`, `terminated`), `created_at`, `activated_at`. `custodian_link_id` was initially added in 0008 and removed in 0010 — custodian management is org-level (see F-024). The `status` ENUM does not include `accepted`; `accept` transitions directly `pending → active`.

**Acceptance criteria:**
- [x] `alembic upgrade head` and `downgrade -1` work cleanly.
- [x] `supplier_id` and `agent_id` must each reference an existing organization row.
- [x] `status` enforces the ENUM at DB level.
- [x] A partial UNIQUE index prevents two active `connections` rows for the same `(supplier_id, agent_id)` pair (`WHERE status != 'terminated'`).
- [x] `activated_at` is set at the time of accept (when connection becomes active).
- [x] `pending_agreement` boolean is included in `ConnectionResponse` (derived from agreement table, not stored on connection).

**Out of scope for this feature:** Agreement table; loan table.

---

### F-022 — Supplier sends connection invitation API
**Milestone:** M2
**Depends on:** F-021, F-005, F-006
**Actor(s):** Supplier

**What it does:** `POST /connections/invite` (supplier JWT). The supplier provides an agent email or `agent_org_id`. If the agent exists, a `Connection` row is created with `status=pending` and a notification event is sent. If the agent does not exist, an email invite is logged (no account created).

**Acceptance criteria:**
- [ ] `POST /connections/invite` with a valid supplier JWT and a known `agent_org_id` returns HTTP 201 with `{ "connection_id": "...", "status": "pending" }`.
- [ ] Calling with an agent JWT returns HTTP 403.
- [ ] Inviting an unknown agent by email logs a `"connection_invite_to_unknown"` notification event and returns HTTP 202.
- [ ] Inviting the same agent twice returns HTTP 409.
- [ ] The connection `status` is `pending` in the DB.

**Out of scope for this feature:** Agent-initiated invitation (direction is supplier → agent per MVP assumption); marketplace discovery.

---

### F-023 — Agent accepts connection invitation API
**Milestone:** M2
**Depends on:** F-022, F-005, F-006
**Actor(s):** Agent

**What it does:** `POST /connections/{id}/accept` (agent JWT). Validates the connection belongs to the calling agent, transitions `status` directly `pending → active`, sets `activated_at`, and sends a notification to the supplier.

**Acceptance criteria:**
- [x] `POST /connections/{id}/accept` with the correct agent JWT returns HTTP 200 with `{ "connection_id": "...", "status": "active", "activated_at": "<timestamp>" }`.
- [x] Calling with a supplier JWT returns HTTP 403.
- [x] Calling with an agent whose `org_id` does not match the connection's `agent_id` returns HTTP 403.
- [x] Accepting a connection that is not in `pending` state returns HTTP 409.
- [x] A `"connection_accepted"` notification event is logged.

**Implementation note:** The original spec described a two-step `pending → accepted → active` flow with an `accepted` intermediate state (see SD-001 in SPEC_DELTAS.md). This was simplified: `accept` now transitions directly to `active`. No intermediate `accepted` status exists.

**Out of scope for this feature:** Custodian API key entry (see F-024).

---

### F-024 — Supplier manages custodian API keys (org-level)
**Milestone:** M2
**Depends on:** F-020, F-008, F-009, F-005
**Actor(s):** Supplier

**What it does:** `POST /custodians` and `GET /custodians` (supplier JWT). Custodian API keys are managed at the organization level, not per-connection. The supplier registers a custodian by providing `custodian_id`, `account_ref`, and `plaintext_key`. The platform stores the key via `SecretStore` (encrypted, vault ref only stored in DB), calls `CustodianAdapter.validate_key()`, and creates a `CustodianLink` row. Supplier can list all their org's custodian links via `GET /custodians`.

**Acceptance criteria:**
- [x] `POST /custodians` with a valid supplier JWT, `custodian_id`, `account_ref`, and `plaintext_key` returns HTTP 201 with `{ "custodian_link_id": "...", "status": "active" }`.
- [x] The plaintext API key is not present in the HTTP response body.
- [x] `CustodianLink.encrypted_api_key_ref` contains a vault reference string, not the plaintext key.
- [x] If `validate_key()` returns `False`, the endpoint returns HTTP 422 with `"custodian_key_invalid"` error code.
- [x] Calling with an agent JWT returns HTTP 403.
- [x] `GET /custodians` with a supplier JWT returns all custodian links for the caller's org.
- [x] Supplier UI at `/dashboard/custodians` lists registered custodians and provides a registration form with a password-type field for the API key.

**Implementation note:** The original F-024 attached a custodian key to an individual connection and used it to transition `accepted → active`. This was redesigned (migration 0010): the connection has no `custodian_link_id` FK, and custodian management is entirely org-level. See TECH_SPEC_M3.md §SD-002.

**Out of scope for this feature:** Key rotation; per-connection custodian assignment; real Anchorage API validation.

---

### F-025 — Connection management: suspension, reactivation, and termination API
**Milestone:** M2
**Depends on:** F-024, F-005, F-006
**Actor(s):** Supplier, Agent

**What it does:** Lifecycle management endpoints for active connections:
- `POST /connections/{id}/suspend` — transitions `active → suspended` (either party)
- `POST /connections/{id}/reactivate` — transitions `suspended → active` (either party)
- `POST /connections/{id}/terminate` — transitions any non-terminated status → `terminated` (either party)

On termination, flags all active loans on the connection and returns their IDs in the response.

**Acceptance criteria:**
- [x] Either party (supplier or agent JWT) can call `suspend`, `reactivate`, and `terminate`.
- [x] `suspend` transitions `status` to `suspended`.
- [x] `reactivate` transitions `status` from `suspended` back to `active`.
- [x] `terminate` transitions `status` to `terminated`; returns `flagged_loan_ids` list in response body.
- [x] A `"connection_terminated_rotate_key"` notification event is logged for the supplier.
- [x] Calling `terminate` on an already-terminated connection returns HTTP 409.
- [x] Calling `suspend` on a non-active connection returns HTTP 409.
- [x] Calling `reactivate` on a non-suspended connection returns HTTP 409.

**Out of scope for this feature:** Automatic custodian key revocation; loan resolution after termination.

---

### F-026 — Connection list and detail API endpoints
**Milestone:** M2
**Depends on:** F-024, F-005
**Actor(s):** Supplier, Agent

**What it does:** `GET /connections` (returns connections for the calling org). Access-controlled so each org sees only its own connections.

**Acceptance criteria:**
- [x] `GET /connections` with a supplier JWT returns only connections where `supplier_id = caller.org_id`.
- [x] `GET /connections` with an agent JWT returns only connections where `agent_id = caller.org_id`.
- [x] Response includes `connection_id`, `supplier_id`, `agent_id`, `status`, `created_at`, `activated_at`, `pending_agreement`.
- [x] `pending_agreement: true` when the connection has a `lending_agreement` in `pending_confirmation` status.

**Out of scope for this feature:** Connection UI pages (F-027); `GET /connections/{id}` detail endpoint (not yet implemented).

---

### F-027 — Connection management UI
**Milestone:** M2
**Depends on:** F-026, F-010
**Actor(s):** Supplier, Agent

**What it does:** React pages for: (a) Supplier: send invitation (`/dashboard/connections`), view connections, suspend/reactivate/terminate; (b) Agent: view pending invitations, accept invitation; (c) Both: navigate to agreement page from active connections.

**Acceptance criteria:**
- [x] Supplier dashboard lists all connections with their current `status` badge.
- [x] Supplier can click "Invite Agent" → enter agent email or org ID → submit → sees new connection in "Pending" state.
- [x] Supplier sees "Manage Agreement" button on active connections, linking to the agreement page.
- [x] Supplier sees `AgreementStatusBadge` ("Pending Confirmation") on connections where `pending_agreement = true`.
- [x] Supplier can suspend an active connection (confirm dialog → `suspended` status).
- [x] Supplier can reactivate a suspended connection (`suspended → active`).
- [x] Supplier can terminate any non-terminated connection (confirm dialog → `terminated` status).
- [x] Agent dashboard shows all connections with status badges and an "Accept" button on pending connections.
- [x] Agent accepting a connection transitions it directly to `active` status.
- [x] Agent sees "Manage Agreement" button on active connections.
- [x] TypeScript compiles with zero errors.
- [x] Custodian management moved to dedicated `/dashboard/custodians` page (see F-024).

**Out of scope for this feature:** Connection scope configuration UI; key rotation UI.

---

## M3 — Agreement

---

### F-028 — LendingAgreement DB table and migration
**Milestone:** M3
**Depends on:** F-021
**Actor(s):** System

**What it does:** Adds the `lending_agreements` Alembic migration (0009) with all columns: `id`, `connection_id` (FK → connections ON DELETE RESTRICT), `version`, `assets_in_scope` (TEXT[]), `eligible_collateral` (TEXT[]), `initial_ltv_pct` (NUMERIC 10,4), `margin_call_ltv_pct` (NUMERIC 10,4), `recall_notice_days`, `max_loan_days`, `day_count_basis` (ENUM: actual_360, actual_365), `agent_fee_bps`, `confirmed_by_supplier_at`, `confirmed_by_agent_at`, `created_at`.

`status` (`pending_confirmation` | `active`) is a derived field computed at read time: `active` when both confirmation timestamps are non-null.

**Acceptance criteria:**
- [x] `alembic upgrade head` applies cleanly; `downgrade -1` reverses cleanly.
- [x] `day_count_basis` enforces the ENUM at DB level (`day_count_basis_enum`).
- [x] `connection_id` FK enforces referential integrity (ON DELETE RESTRICT).
- [x] `version` starts at 1 for a new agreement; increments at the application layer on each amendment.
- [x] Index on `connection_id` for efficient latest-version lookup.

**Out of scope for this feature:** Agreement API endpoints; confirmation flow.

---

### F-029 — Agreement terms entry API (agent)
**Milestone:** M3
**Depends on:** F-028, F-005, F-006
**Actor(s):** Agent

**What it does:** `POST /connections/{id}/agreement` (agent JWT). Creates a new `LendingAgreement` row with all required terms, `version=1` (or `latest.version + 1` if a prior active agreement exists), both confirmation timestamps as `NULL`. Sends a notification to both parties.

**Acceptance criteria:**
- [x] `POST /connections/{id}/agreement` with all required fields and an agent JWT returns HTTP 201 with the full `AgreementResponse` including `version` and `status: "pending_confirmation"`.
- [x] Calling with a supplier JWT returns HTTP 403.
- [x] Missing any required term returns HTTP 422 with field-level error messages.
- [x] `margin_call_ltv_pct` must be greater than `initial_ltv_pct`; violation returns HTTP 422.
- [x] `initial_ltv_pct` must be between 0 and 100 (exclusive); violation returns HTTP 422.
- [x] `agent_fee_bps` must be between 0 and 10000 (inclusive); violation returns HTTP 422.
- [x] `recall_notice_days` and `max_loan_days` must be ≥ 1; violation returns HTTP 422.
- [x] A `"agreement_pending_supplier_confirmation"` notification event is logged, with recipients including both agent caller and supplier org's users.
- [x] The connection must have `status=active`; submitting on a non-active connection returns HTTP 409 with code `connection_not_active`.
- [x] A pending (unconfirmed) agreement already exists → HTTP 409 with code `pending_agreement_exists`.
- [x] `initial_ltv_pct` and `margin_call_ltv_pct` are stored as `NUMERIC(10,4)` and serialized as strings in the response to avoid float precision loss.

**Out of scope for this feature:** Supplier-initiated agreement terms; PDF extraction.

---

### F-030 — Agreement confirmation API (supplier and agent)
**Milestone:** M3
**Depends on:** F-029, F-005, F-006
**Actor(s):** Supplier, Agent

**What it does:** `POST /agreements/{id}/confirm` (supplier or agent JWT). Sets `confirmed_by_supplier_at` or `confirmed_by_agent_at` respectively. When both timestamps are set, `status` becomes `active`. Notifies the other party on each confirmation. Only the latest version of an agreement may be confirmed.

**Acceptance criteria:**
- [x] Supplier calling `confirm` sets `confirmed_by_supplier_at` to the current timestamp; returns the updated `AgreementResponse`.
- [x] Agent calling `confirm` sets `confirmed_by_agent_at` to the current timestamp; returns the updated `AgreementResponse`.
- [x] After both parties confirm, response includes `status: "active"` (both timestamps non-null).
- [x] Calling `confirm` on an agreement where the caller has already confirmed returns HTTP 409 with code `already_confirmed`.
- [x] Calling `confirm` on a superseded (not latest) version returns HTTP 409 with code `agreement_superseded`.
- [x] A `"agreement_confirmed_by_supplier"` or `"agreement_confirmed_by_agent"` notification event is logged.
- [x] Calling with a JWT from an org not in the connection returns HTTP 403.

**Out of scope for this feature:** E-signature; simultaneous confirmation race handling.

---

### F-031 — Agreement term change and re-confirmation flow API
**Milestone:** M3
**Depends on:** F-030, F-005, F-006
**Actor(s):** Agent

**What it does:** `PUT /agreements/{id}` (agent JWT). Creates a new `LendingAgreement` row with `version = previous_version + 1` and both confirmation timestamps as `NULL`. Previous version row is NOT modified. Notifies both parties that re-confirmation is required.

**Acceptance criteria:**
- [x] `PUT /agreements/{id}` with an agent JWT returns HTTP 201 with a new `agreement_id` and incremented `version`.
- [x] The previous agreement version row is not deleted or modified.
- [x] Both `confirmed_by_supplier_at` and `confirmed_by_agent_at` on the new version are `NULL`.
- [x] Calling `PUT` on a non-current (superseded) version returns HTTP 409 with code `agreement_not_current_version`.
- [x] A `"agreement_requires_reconfirmation"` notification event is logged for both parties.
- [x] All historical versions returned by `GET /connections/{id}/agreement/history`, ordered by `version ASC`.
- [x] Calling with a supplier JWT returns HTTP 403.

**Implementation note:** The original spec listed "Supplier, Agent" as actors. Only agent JWT is accepted (supplier role is to confirm, not draft). See TECH_SPEC_M3.md §SD-003.

**Out of scope for this feature:** Automatic blocking of new loan bookings during re-confirmation (deferred to F-038).

---

### F-032 — Agreement UI: entry and confirmation flow
**Milestone:** M3
**Depends on:** F-027, F-029, F-030, F-031
**Actor(s):** Supplier, Agent

**What it does:** React pages for: (a) Agent: form to enter or amend all agreement terms for an active connection; (b) Supplier: review terms and confirm; (c) Both: read-only view of current agreement and full version history.

**Routes:**
- `/dashboard/connections/:id/agreement` — `AgreementPage` dispatcher → `SupplierAgreementView` or `AgentAgreementView`
- `/dashboard/connections/:id/agreement/new` — `AgentAgreementFormPage` (create or amend)
- `/dashboard/connections/:id/agreement/history` — `AgreementHistoryPage`

**Acceptance criteria:**
- [x] Agent can navigate to an active connection, click "Enter Agreement Terms", fill the form, and submit → redirects to agreement view.
- [x] All form fields show inline validation: LTV 0–100, margin call must exceed initial LTV, integer fields ≥ 1, bps 0–10000.
- [x] Amend path: agent opens form pre-populated with current terms, edits, submits → new version created.
- [x] Supplier view shows "Confirm" button when agreement is `pending_confirmation` and supplier hasn't yet confirmed.
- [x] Supplier view shows "Awaiting agent confirmation" when supplier has confirmed but agent hasn't.
- [x] Supplier dashboard connection row shows `AgreementStatusBadge` ("Pending Confirmation") when `pending_agreement = true`.
- [x] Both parties see the current agreement in a read-only card after dual confirmation.
- [x] Agreement history page lists all versions with `version` number, `status`, and `created_at` timestamp.
- [x] TypeScript compiles with zero errors.

**Open item:** Supplier cannot currently initiate agreement terms — only agents can (see TECH_SPEC_M3.md §4 Open issue).

**Out of scope for this feature:** PDF upload; e-signature widget; supplier-proposed terms.

---

### F-061 — Connection inventory scope: supplier publishes lendable quantity
**Milestone:** M2
**Depends on:** F-021, F-024, F-008
**Actor(s):** Supplier

**What it does:** The supplier's custodian holds their total asset balance across one or more asset types. Before loans can be booked against a connection, the supplier must explicitly declare how much of that balance is available to lend through that specific agent relationship. This is called the **published inventory allocation**.

For each active connection, the supplier sets a per-asset quantity cap stored in `connections.inventory_scope` as a JSONB map of asset type → quantity (e.g., `{"BTC": 100.0, "ETH": 50.0}`). Any asset type is valid. The platform computes the **effective available quantity** for each asset as `min(custodian_balance_for_asset, published_quantity_for_connection)`. The agent sees only the effective available quantity, never the supplier's total custodian balance.

The supplier can update the allocation at any time. If the custodian balance drops below the published quantity, the effective available quantity follows the custodian balance downward; the platform does not automatically raise it back.

**Endpoints:**
- `PUT /connections/{id}/inventory-scope` (supplier JWT) — set or update the per-asset published quantities for this connection
- `GET /connections/{id}/inventory` (supplier or agent JWT):
  - Supplier: `{ "asset_type": { "custodian_balance": 500.0, "published_quantity": 100.0, "effective_available": 100.0 }, ... }`
  - Agent: `{ "asset_type": { "effective_available": 100.0 }, ... }` (custodian balance hidden)

**Database change:** Add `inventory_scope JSONB NOT NULL DEFAULT '{}'` to the `connections` table in a new migration.

**Loan booking integration (F-035 extension):**
- If `inventory_scope` has no entry for the booked asset type → HTTP 422, code `"no_inventory_published"`
- If `loan.quantity > (published_quantity − already_booked_quantity)` for that asset → HTTP 422, code `"exceeds_published_inventory"`
- Already-booked active and pending loans count against published quantity; only remaining published quantity is available.

**Acceptance criteria:**
- [ ] `PUT /connections/{id}/inventory-scope` with a supplier JWT and any valid asset-type/quantity map returns HTTP 200 with the updated scope.
- [ ] Calling `PUT` with an agent JWT returns HTTP 403.
- [ ] `GET /connections/{id}/inventory` with a supplier JWT returns both `custodian_balance` and `published_quantity` per asset.
- [ ] `GET /connections/{id}/inventory` with an agent JWT returns only `effective_available` per asset; `custodian_balance` is absent from the response.
- [ ] If `inventory_scope` has no entry for an asset type, booking a loan for that asset returns HTTP 422 with code `"no_inventory_published"`.
- [ ] Booking where `quantity > effective_available − already_booked` returns HTTP 422 with code `"exceeds_published_inventory"`.
- [ ] Booking within the remaining published allocation succeeds.
- [ ] Setting an asset's published quantity to 0 blocks new bookings for that asset but does not affect active loans.
- [ ] TypeScript compiles with zero errors.

**Impact on related features:**
- F-026 connection list: include `inventory_scope` in `ConnectionResponse` for supplier callers.
- F-027 connection UI: supplier connection detail shows published quantities per asset with an "Edit" control; agent connection detail shows only effective available per asset.
- F-035 loan booking: add the two new validation checks described above.
- F-044 portfolio risk metrics: denominate `concentration_by_borrower` percentage against published quantity, not custodian total.

**Out of scope for this feature:** Real-time inventory broadcast to the agent; automatic rebalancing of published quantity when custodian balance changes; per-loan earmarking at the custodian.

---

### F-062 — Supplier inventory management screen
**Milestone:** M2 (extension)
**Depends on:** F-061, F-024, F-026, F-046
**Actor(s):** Supplier

**What it does:** React page at `/dashboard/inventory`. The supplier sees their full asset estate in one place: which custodian holds what (pulled from the custodian inventory feed), how much has been published to each active agent connection, and how much of what was published is currently on loan. The supplier can edit published quantities inline — per asset, per connection — without leaving the screen.

**Three sections:**
- **Section A — Custodian positions (read-only):** One row per custodian × asset type. Columns: custodian name, account ref, asset type, total balance, as-of timestamp. Reuses the staleness flag pattern from F-046 when the feed is beyond the staleness threshold.
- **Section B — Per-agent allocation panels:** One panel per active or suspended connection. Per row (asset type): total at custodian, published quantity, on-loan quantity, remaining available (`published − on_loan`).
- **Section C — Inline allocation controls:** Increase quantity (takes effect immediately), reduce quantity (warning if below on-loan amount, not blocked), set to zero (confirmation prompt: "This will block new bookings for [asset] on this connection").

**Acceptance criteria:**
- [ ] `/dashboard/inventory` is accessible from the main nav (supplier only).
- [ ] Section A shows one row per `(custodian, asset_type)` from the custodian inventory feed; rows with stale feeds show a staleness indicator.
- [ ] Section B shows one panel per active or suspended connection; pending and terminated connections are not shown.
- [ ] Each panel row shows published quantity, on-loan quantity, and remaining available per asset.
- [ ] Editing published quantity and saving calls `PUT /connections/{id}/inventory-scope` and reflects the change immediately (optimistic update or refetch).
- [ ] Reducing below on-loan quantity shows an inline warning but does not block the save.
- [ ] Setting to zero shows a confirmation prompt before saving.
- [ ] A connection with no published inventory shows "No inventory published. Click + to publish."
- [ ] TypeScript compiles with zero errors.

**Out of scope for this feature:** Loan-level detail (Risk Cockpit, F-046); fee accrual (F-057); aggregating balances across custodian accounts for the same asset.

---

### F-063 — Agent available inventory screen
**Milestone:** M2 (extension)
**Depends on:** F-061, F-048, F-026
**Actor(s):** Agent

**What it does:** React page at `/dashboard/available-inventory`. The agent sees how much lending capacity they have access to — total per asset type aggregated across all active supplier connections, then broken down by supplier. When a supplier changes their allocation for a connection this agent is on, the affected row is highlighted and a nav badge appears.

**Two sections:**
- **Section A — Aggregated totals:** One row per asset type. Columns: asset type, total available (sum of `effective_available` across all active connections), on loan, net remaining.
- **Section B — Breakdown by supplier:** One row per active connection × asset type where `effective_available > 0`. Columns: supplier name, asset type, available from this supplier, on loan via this supplier. The agent does **not** see custodian balance or raw published quantity — only `effective_available`.

**In-screen allocation change notifications:**
- When `ConnectionService.set_inventory_scope()` fires the `supplier_allocation_changed` in-app notification (F-048), the affected supplier row in Section B is highlighted with an "Updated X min ago" chip.
- A badge count on the `/dashboard/available-inventory` nav link reflects unacknowledged allocation changes.
- Visiting the screen (or clicking the affected row) clears the badge and removes the highlight.
- The in-app notification payload: `{ supplier_org_id, connection_id, asset_type, new_effective_available }`.

**Acceptance criteria:**
- [ ] `/dashboard/available-inventory` is accessible from the main nav (agent only).
- [ ] Section A shows one row per asset type with correct aggregated totals.
- [ ] Section B shows one row per active connection × asset type where `effective_available > 0`; connections with no published inventory are omitted.
- [ ] Supplier's total custodian balance is **not** shown anywhere on this screen.
- [ ] Supplier's raw published quantity is **not** shown (only `effective_available`).
- [ ] When a supplier changes their allocation, the affected Section B row is highlighted with a relative timestamp chip.
- [ ] The nav badge count reflects the number of unacknowledged allocation changes.
- [ ] Visiting the screen clears the badge and removes highlights.
- [ ] TypeScript compiles with zero errors.

**Out of scope for this feature:** Real-time WebSocket updates; historical allocation change audit log; cross-program aggregation for the same asset across multiple custodian accounts.

---

## M4 — Loan Lifecycle

---

### F-033 — Loan DB table and migration
**Milestone:** M4
**Depends on:** F-028, F-017
**Actor(s):** System

**What it does:** Adds the `loans` Alembic migration with all columns per the data model: `id`, `connection_id` (FK), `agreement_id` (FK), `borrower_id` (FK), `asset_type`, `quantity`, `rate_bps`, `term_type` (ENUM: open, fixed), `maturity_date`, `day_count_basis` (ENUM), `collateral_type`, `collateral_quantity`, `collateral_value_usd`, `current_ltv_pct`, `ltv_as_of`, `state` (ENUM: pending, active, margin_call, recall_initiated, settled, defaulted), `booked_at`, `settled_at`.

**Acceptance criteria:**
- [ ] `alembic upgrade head` applies; `downgrade -1` reverses cleanly.
- [ ] `state` ENUM enforces only the six allowed values at DB level.
- [ ] `term_type = fixed` with `maturity_date = NULL` is rejected at application layer (not necessarily DB constraint).
- [ ] All FK constraints are enforced by the DB.

**Out of scope for this feature:** Accrual table (F-050); statement table (F-053).

---

### F-034 — Approved borrower list on connection (agent + supplier)
**Milestone:** M4
**Depends on:** F-021, F-017, F-005
**Actor(s):** Agent, Supplier

**What it does:** `POST /connections/{id}/approved-borrowers` (agent JWT) to add a borrower to the supplier's approved list for this connection. `GET /connections/{id}/approved-borrowers` for both parties to view the list. Supplier can remove a borrower via `DELETE /connections/{id}/approved-borrowers/{borrower_id}`.

**Acceptance criteria:**
- [ ] Agent can add a borrower they manage to the approved list; returns HTTP 201.
- [ ] Adding a borrower not managed by the calling agent returns HTTP 403.
- [ ] Supplier can view the approved borrower list.
- [ ] Supplier can remove a borrower from the list; returns HTTP 200.
- [ ] `GET /connections/{id}/approved-borrowers` with a JWT from an org not in the connection returns HTTP 403.

**Out of scope for this feature:** Borrower-initiated join request; multi-agent borrower visibility.

---

### F-035 — Loan booking API endpoint
**Milestone:** M4
**Depends on:** F-033, F-034, F-008, F-005, F-006
**Actor(s):** Agent

**What it does:** `POST /loans` (agent JWT). Accepts all loan booking fields, runs the five-point validation against agreement terms, checks inventory and collateral via `CustodianAdapter`, creates a `Loan` row with `state=pending`, and sends notifications to both parties.

**Acceptance criteria:**
- [ ] Valid booking returns HTTP 201 with `{ "loan_id": "...", "state": "pending" }`.
- [ ] Booking with a borrower not on the approved list returns HTTP 422 with code `"borrower_not_approved"`.
- [ ] Booking with `asset_type` not in `agreement.assets_in_scope` returns HTTP 422 with code `"asset_not_in_scope"`.
- [ ] Booking with `collateral_type` not in `agreement.eligible_collateral` returns HTTP 422 with code `"collateral_not_eligible"`.
- [ ] Booking where `collateral_value / (quantity × btc_price)` exceeds `agreement.initial_ltv_pct` returns HTTP 422 with code `"ltv_exceeded"`.
- [ ] Booking with `quantity` below the agreement minimum returns HTTP 422 with code `"below_minimum_size"`.
- [ ] Mock inventory check: if `MockCustodianAdapter` is seeded with insufficient BTC, returns HTTP 422 with code `"insufficient_inventory"`.
- [ ] A `"loan_booked"` notification event is logged for both supplier and agent.
- [ ] Calling with a supplier JWT returns HTTP 403.

**Out of scope for this feature:** State transition to `active` (F-036); collateral substitution (F-040).

---

### F-036 — Loan state: pending → active transition (LTV refresh worker)
**Milestone:** M4
**Depends on:** F-035, F-007, F-008
**Actor(s):** System

**What it does:** An ARQ job `ltv_refresh_job` checks all `pending` loans, calls `CustodianAdapter.get_inventory` and `get_collateral`, and transitions loans to `active` when both confirm. Timestamps the `activated_at` equivalent on the loan.

**Acceptance criteria:**
- [ ] After the job runs against a pending loan with the mock adapter returning valid inventory + collateral, the loan `state` transitions to `active`.
- [ ] If the mock adapter returns `None` for collateral, the loan remains `pending` and no error is raised.
- [ ] A `"loan_activated"` notification event is logged when a loan transitions to `active`.
- [ ] The job processes all pending loans in a single run, not just one.
- [ ] Job run is idempotent: running it twice on an already-active loan does not change state or log duplicate notifications.

**Out of scope for this feature:** Margin call logic (F-043); LTV staleness alerts (F-045).

---

### F-037 — Loan list and detail API endpoints
**Milestone:** M4
**Depends on:** F-035, F-005
**Actor(s):** Supplier, Agent

**What it does:** `GET /loans` and `GET /loans/{id}`. Suppliers see only loans on their connections; agents see only loans on connections where they are the agent. Both see the same fields except: agent sees all fields; supplier sees borrower name only (not further borrower detail).

**Acceptance criteria:**
- [ ] `GET /loans` with supplier JWT returns only loans on connections where `supplier_id = caller.org_id`.
- [ ] `GET /loans` with agent JWT returns only loans on connections where `agent_id = caller.org_id`.
- [ ] `GET /loans/{id}` with a JWT from an unrelated org returns HTTP 403.
- [ ] Supplier response includes `borrower_name` but not `borrower.contact_email`.
- [ ] Response includes `state`, `current_ltv_pct`, `ltv_as_of`, and all booking fields.
- [ ] Filtering by `?state=active` returns only active loans.

**Out of scope for this feature:** Portfolio-level aggregates (F-044); risk cockpit UI (F-046).

---

### F-038 — Loan booking validation: agreement must be dual-confirmed
**Milestone:** M4
**Depends on:** F-035, F-030
**Actor(s):** System

**What it does:** Adds a guard in `LoanService.book_loan` that rejects bookings if the active agreement for the connection is not dual-confirmed (both `confirmed_by_supplier_at` and `confirmed_by_agent_at` are non-null).

**Acceptance criteria:**
- [ ] Booking a loan against a connection with no confirmed agreement returns HTTP 409 with code `"no_active_agreement"`.
- [ ] Booking a loan against a connection with a partially-confirmed agreement (one party only) returns HTTP 409 with code `"agreement_not_fully_confirmed"`.
- [ ] After both parties confirm, booking proceeds normally.

**Out of scope for this feature:** Blocking during re-confirmation (same guard applies to new un-confirmed versions).

---

### F-039 — Recall instruction flow API
**Milestone:** M4
**Depends on:** F-036, F-005, F-006, F-008
**Actor(s):** Supplier, Agent

**What it does:** `POST /loans/{id}/recall` (supplier JWT): transitions loan to `recall_initiated`, timestamps the instruction, notifies the agent with a notice period countdown. `POST /loans/{id}/return` (agent JWT): agent initiates asset return; platform calls `CustodianAdapter.transmit_instruction("return", ...)` and transitions loan to `settled` on success.

**Acceptance criteria:**
- [ ] Supplier calling `recall` on an `active` loan transitions it to `recall_initiated` and returns HTTP 200.
- [ ] Agent calling `recall` on an `active` loan also transitions it to `recall_initiated` and returns HTTP 200.
- [ ] A `"recall_initiated"` notification event is logged for both parties including the notice deadline (current time + `agreement.recall_notice_days`).
- [ ] Agent calling `return` on a `recall_initiated` loan calls `MockCustodianAdapter.transmit_instruction` and transitions to `settled`.
- [ ] The `InstructionResult.custodian_ref` is stored on the loan record.
- [ ] If `transmit_instruction` returns `success=False`, the endpoint returns HTTP 502 and the loan remains `recall_initiated`.
- [ ] Calling `recall` on a `settled` or `defaulted` loan returns HTTP 409.

**Out of scope for this feature:** Partial recall; automated recall at maturity.

---

### F-040 — Collateral substitution API
**Milestone:** M4
**Depends on:** F-036, F-005, F-006
**Actor(s):** Agent

**What it does:** `POST /loans/{id}/collateral-substitution` (agent JWT). Agent provides new `collateral_type`, `collateral_quantity`, and `collateral_value_usd`. Platform validates the new collateral type is eligible per the agreement and that the resulting LTV meets the initial threshold. Updates the loan's collateral fields and sends a notification.

**Acceptance criteria:**
- [ ] Submitting an eligible collateral type with valid LTV returns HTTP 200 and updates the loan's collateral fields.
- [ ] Submitting an ineligible collateral type returns HTTP 422 with code `"collateral_not_eligible"`.
- [ ] Submitting collateral that would push LTV over `initial_ltv_pct` returns HTTP 422 with code `"ltv_exceeded"`.
- [ ] Only callable on loans in `active` or `margin_call` state; any other state returns HTTP 409.
- [ ] A `"collateral_substituted"` notification event is logged.

**Out of scope for this feature:** Custodian confirmation of the new collateral (mock only in MVP).

---

### F-041 — Loan defaulted state transition API
**Milestone:** M4
**Depends on:** F-036, F-005, F-006
**Actor(s):** Agent, Admin

**What it does:** `POST /loans/{id}/default` (agent or admin JWT). Manually marks a loan as `defaulted`. Platform logs the transition and sends notifications to both parties.

**Acceptance criteria:**
- [ ] Agent calling `default` on a `recall_initiated` loan transitions it to `defaulted` and returns HTTP 200.
- [ ] Admin can also call `default`.
- [ ] Supplier calling `default` returns HTTP 403.
- [ ] A `"loan_defaulted"` notification event is logged for both parties.
- [ ] All state transitions are stored with a `transitioned_at` timestamp (either on the loan row or in an audit log).

**Out of scope for this feature:** Automated default detection; off-platform resolution support.

---

### F-042 — Loan lifecycle UI
**Milestone:** M4
**Depends on:** F-037, F-039, F-040, F-041, F-010
**Actor(s):** Supplier, Agent

**What it does:** React pages for: (a) loan list with state badges and filtering; (b) loan detail showing all fields; (c) agent actions: initiate return; (d) supplier actions: initiate recall; (e) collateral substitution form.

**Acceptance criteria:**
- [ ] Loan list shows each loan's state with a color-coded badge (pending, active, margin_call, etc.).
- [ ] Supplier sees "Recall" button on active loans; clicking it calls the recall endpoint and updates the UI.
- [ ] Agent sees "Return Assets" button on `recall_initiated` loans; clicking it calls the return endpoint.
- [ ] Agent sees "Substitute Collateral" button on active and margin-call loans.
- [ ] Loan detail page shows all fields from `GET /loans/{id}`, including `ltv_as_of` timestamp.
- [ ] TypeScript compiles with zero errors.

**Out of scope for this feature:** Real-time updates (polling or websocket); partial recall UI.

---

## M5 — Risk Monitoring

---

### F-043 — LTV calculation and margin call state transition (worker)
**Milestone:** M5
**Depends on:** F-036, F-007, F-008
**Actor(s):** System

**What it does:** Extends the `ltv_refresh_job` (F-036) to calculate `current_ltv_pct` for all active loans using `collateral.value_usd / (loan.quantity × btc_price)`, store it with `ltv_as_of` timestamp, and transition loans to `margin_call` state when `current_ltv >= agreement.margin_call_ltv_pct`. Calls `NotificationService` on threshold breach.

**Acceptance criteria:**
- [ ] After the job runs, `loan.current_ltv_pct` is updated and `loan.ltv_as_of` reflects the collateral feed's `as_of` timestamp.
- [ ] A loan whose mock collateral value yields LTV >= `margin_call_ltv_pct` transitions to `margin_call` and a `"margin_call"` notification is logged.
- [ ] A loan whose LTV is within 10% of `margin_call_ltv_pct` (i.e., `current_ltv >= margin_call_ltv_pct * 0.90`) triggers a `"ltv_warning"` notification without changing state.
- [ ] A loan already in `margin_call` state does not trigger a duplicate notification on re-run.
- [ ] Job is idempotent for loans whose LTV has not changed.

**Out of scope for this feature:** Portfolio-level metrics (F-044); UI display (F-046).

---

### F-044 — Portfolio-level risk metrics API
**Milestone:** M5
**Depends on:** F-043, F-005
**Actor(s):** Supplier

**What it does:** `GET /suppliers/{org_id}/risk-summary` (supplier JWT, must be own org). Returns: total BTC on loan, total collateral value USD, loan count by state, concentration per borrower (% of inventory on loan).

**Acceptance criteria:**
- [ ] Returns HTTP 200 with `total_btc_on_loan`, `total_collateral_usd`, `loans_by_state` (dict), `concentration_by_borrower` (list of {borrower_name, pct}).
- [ ] Calling with a different supplier's `org_id` returns HTTP 403.
- [ ] Agent calling this endpoint returns HTTP 403.
- [ ] All numeric values reflect only active and margin-call loans (not settled/defaulted).

**Out of scope for this feature:** Cross-program aggregation; scenario modeling.

---

### F-045 — Feed staleness detection and alerting (worker)
**Milestone:** M5
**Depends on:** F-043, F-006
**Actor(s):** System

**What it does:** Within the `ltv_refresh_job`, if `collateral.as_of` is older than a configurable staleness threshold (default: 1 hour), the job skips the LTV update, marks the loan's `ltv_as_of` with a staleness flag (or leaves it unchanged), and sends a `"feed_stale"` notification to supplier and agent.

**Acceptance criteria:**
- [ ] When mock adapter returns a `CollateralPosition` with `as_of` older than the staleness threshold, a `"feed_stale"` notification event is logged containing the `loan_id` and `feed_id`.
- [ ] The loan's `current_ltv_pct` is not updated when the feed is stale.
- [ ] The staleness threshold is configurable via an environment variable (e.g. `FEED_STALENESS_THRESHOLD_SECONDS`).
- [ ] A fresh feed (as_of within threshold) does not trigger the stale notification.

**Out of scope for this feature:** UI staleness badge (F-046); automated feed retry.

---

### F-046 — Risk cockpit UI
**Milestone:** M5
**Depends on:** F-044, F-045, F-037, F-010
**Actor(s):** Supplier, Agent

**What it does:** React dashboard page showing per-loan risk metrics (LTV, distance to margin call as a progress bar, state, collateral type, days to maturity, as-of timestamp) and portfolio-level summary (total on loan, total collateral, concentration).

**Acceptance criteria:**
- [ ] Supplier's risk cockpit shows a row per active loan with LTV, distance to margin call (%), state badge, and collateral type.
- [ ] Distance to margin call is displayed as a progress bar with color coding: green (>20% buffer), amber (10–20%), red (<10%).
- [ ] Each metric row shows `ltv_as_of` timestamp.
- [ ] Loans with stale data show a "Data may be stale" warning indicator.
- [ ] Portfolio summary section shows total BTC on loan, total collateral USD, and count by state.
- [ ] TypeScript compiles with zero errors.

**Out of scope for this feature:** Real-time websocket updates; stress test / scenario modeling panel; market data chart.

---

### F-047 — Alert notification events: recall deadline and loan maturity warnings
**Milestone:** M5
**Depends on:** F-007, F-039, F-006
**Actor(s):** System

**What it does:** A scheduled ARQ job `deadline_alert_job` runs daily and checks: (a) `recall_initiated` loans where the notice period expires within 24 hours → logs `"recall_deadline_24h"` notification for the agent; (b) `active` fixed-term loans maturing within 3 days → logs `"loan_maturity_3d"` notification for the agent.

**Acceptance criteria:**
- [ ] A `recall_initiated` loan with recall initiated 23 hours ago (recall notice = 1 day) triggers `"recall_deadline_24h"` notification.
- [ ] A `recall_initiated` loan with 48+ hours remaining does not trigger the notification.
- [ ] An `active` fixed-term loan with `maturity_date = today + 2 days` triggers `"loan_maturity_3d"` notification.
- [ ] An `active` fixed-term loan with `maturity_date = today + 5 days` does not trigger the notification.
- [ ] Open-term loans (`term_type = open`) do not trigger the maturity warning.
- [ ] Job is idempotent: running twice in the same day does not send duplicate notifications.

**Out of scope for this feature:** In-app notification bell UI; email delivery.

---

### F-048 — In-app notification list API and UI
**Milestone:** M5
**Depends on:** F-006, F-010
**Actor(s):** Supplier, Agent

**What it does:** `GET /notifications` returns the calling user's notifications ordered by `created_at` desc. `POST /notifications/{id}/read` marks a notification as read. UI shows a notification bell with unread count and a dropdown list.

**Acceptance criteria:**
- [ ] `GET /notifications` returns only notifications belonging to the calling user's `user_id`.
- [ ] Response includes `event`, `payload` (JSONB), `created_at`, `read_at` (null if unread).
- [ ] `POST /notifications/{id}/read` sets `read_at` to the current timestamp and returns HTTP 200.
- [ ] UI notification bell shows the count of unread notifications.
- [ ] Clicking a notification in the dropdown marks it as read.
- [ ] TypeScript compiles with zero errors.

**Out of scope for this feature:** Email delivery; push notifications; bulk mark-all-read.

---

## M6 — Accrual & Reporting

---

### F-049 — Accrual formula: unit tests for day count math
**Milestone:** M6
**Depends on:** F-033
**Actor(s):** System

**What it does:** Implements and unit-tests the `calculate_daily_accrual(rate_bps, quantity, day_count_basis)` pure function using both Actual/360 and Actual/365 conventions.

**Acceptance criteria:**
- [ ] `calculate_daily_accrual(rate_bps=500, quantity=10.0, basis="actual_360")` returns `10.0 × (500/10000) / 360` (= 0.001388...) to at least 8 decimal places.
- [ ] `calculate_daily_accrual(rate_bps=500, quantity=10.0, basis="actual_365")` returns `10.0 × (500/10000) / 365` to at least 8 decimal places.
- [ ] The function raises a `ValueError` for an unrecognized `day_count_basis`.
- [ ] All tests pass with no floating-point precision failures (use `Decimal` arithmetic internally).

**Out of scope for this feature:** Accrual job; DB storage; statement generation.

---

### F-050 — Accrual DB table and migration
**Milestone:** M6
**Depends on:** F-033
**Actor(s):** System

**What it does:** Adds the `accruals` Alembic migration with columns: `id`, `loan_id` (FK → loans), `accrual_date` (DATE), `quantity_outstanding`, `daily_interest`, `agent_fee`, `net_to_supplier`, `source_feed_id`, `feed_as_of`, `created_at`. Adds a UNIQUE constraint on `(loan_id, accrual_date)` to prevent duplicate accruals.

**Acceptance criteria:**
- [ ] `alembic upgrade head` applies; `downgrade -1` reverses cleanly.
- [ ] Inserting two rows with the same `(loan_id, accrual_date)` raises a DB UNIQUE constraint violation.
- [ ] `loan_id` FK enforces referential integrity.

**Out of scope for this feature:** Statement table; accrual job.

---

### F-051 — Daily accrual background job
**Milestone:** M6
**Depends on:** F-049, F-050, F-007, F-008
**Actor(s):** System

**What it does:** ARQ job `daily_accrual_job` runs once per day (e.g., midnight UTC). For each `active` loan, pulls `quantity_outstanding` from `CustodianAdapter.get_inventory`, applies the day count formula, computes `agent_fee = daily_interest × (agent_fee_bps / 10000)`, `net_to_supplier = daily_interest - agent_fee`, and inserts an `Accrual` row for the current date.

**Acceptance criteria:**
- [ ] Running the job for a given date against one active loan creates exactly one `Accrual` row with correct `daily_interest`, `agent_fee`, and `net_to_supplier` values (verified against expected output of the formula from F-049).
- [ ] Running the job again for the same date does not insert a duplicate row (idempotent due to UNIQUE constraint; error handled gracefully, no crash).
- [ ] Loans in `pending`, `settled`, or `defaulted` state are skipped.
- [ ] The `source_feed_id` and `feed_as_of` on each accrual row match the values returned by the mock inventory feed.
- [ ] Job logs a summary: N loans processed, N accruals written.

**Out of scope for this feature:** Statement generation; platform fee line item.

---

### F-052 — Accrual audit API endpoint
**Milestone:** M6
**Depends on:** F-051, F-005
**Actor(s):** Supplier, Agent

**What it does:** `GET /loans/{id}/accruals` returns all `Accrual` rows for a loan, ordered by `accrual_date` ascending. Access-controlled to orgs on the loan's connection.

**Acceptance criteria:**
- [ ] Returns HTTP 200 with a list of accrual records including `accrual_date`, `quantity_outstanding`, `daily_interest`, `agent_fee`, `net_to_supplier`, `source_feed_id`, `feed_as_of`.
- [ ] Calling with a JWT from an unrelated org returns HTTP 403.
- [ ] Filtering by `?from=YYYY-MM-DD&to=YYYY-MM-DD` returns only accruals within that range.

**Out of scope for this feature:** Statement generation; CSV export.

---

### F-053 — Statement DB table and migration
**Milestone:** M6
**Depends on:** F-050
**Actor(s):** System

**What it does:** Adds the `statements` Alembic migration with columns: `id`, `connection_id` (FK), `period_start` (DATE), `period_end` (DATE), `gross_interest`, `agent_fee_total`, `net_to_supplier`, `locked_at`, `amendment_of` (FK → statements, nullable), `created_at`.

**Acceptance criteria:**
- [ ] `alembic upgrade head` applies; `downgrade -1` reverses cleanly.
- [ ] `amendment_of` FK is self-referential and nullable.
- [ ] `locked_at` defaults to `NULL` and is set only by the statement locking job.

**Out of scope for this feature:** Statement generation job; download API.

---

### F-054 — Month-end statement generation and locking job
**Milestone:** M6
**Depends on:** F-051, F-053, F-007
**Actor(s):** System

**What it does:** ARQ job `monthly_statement_job` runs on the 1st of each month (or triggered by Admin). For each `Connection` with at least one accrual in the closed month, aggregates `SUM(daily_interest)`, `SUM(agent_fee)`, `SUM(net_to_supplier)` from `Accrual` rows for the period, creates a `Statement` row, and sets `locked_at` to the current timestamp.

**Acceptance criteria:**
- [ ] Running the job for a closed month with two active loans produces one `Statement` per connection containing the correct `gross_interest` (sum of all daily accruals), `agent_fee_total`, and `net_to_supplier`.
- [ ] The generated statement has `locked_at` set to a non-null timestamp.
- [ ] Running the job again for the same period does not create a duplicate statement (idempotent; detects existing locked statement for the period and skips).
- [ ] A connection with no accruals in the period does not get a statement row.
- [ ] The `period_start` and `period_end` values span the full closed calendar month (e.g., 2026-05-01 to 2026-05-31).

**Out of scope for this feature:** Statement amendment flow; platform fee line item; payment tracking.

---

### F-055 — Statement amendment API
**Milestone:** M6
**Depends on:** F-054, F-005
**Actor(s):** Admin

**What it does:** `POST /statements/{id}/amend` (admin JWT). Creates a new `Statement` row with the corrected figures, sets `amendment_of = original_statement_id`, and locks it immediately. The original statement row is not modified.

**Acceptance criteria:**
- [ ] Admin calling `amend` on a locked statement creates a new `Statement` row with `amendment_of` pointing to the original.
- [ ] The new statement has `locked_at` set immediately on creation.
- [ ] The original statement row's `locked_at` and figures are unchanged.
- [ ] Calling with a supplier or agent JWT returns HTTP 403.
- [ ] `GET /connections/{id}/statements` lists both the original and the amendment, with the amendment clearly linked to the original via `amendment_of`.

**Out of scope for this feature:** Amendment notification email; auto-detecting what changed.

---

### F-056 — Statement download and list API endpoints
**Milestone:** M6
**Depends on:** F-054, F-005
**Actor(s):** Supplier, Agent

**What it does:** `GET /connections/{id}/statements` lists all statements (locked and any amendments) for the connection. `GET /statements/{id}` returns full detail. Both are access-controlled. A `GET /statements/{id}/download` endpoint returns a JSON payload (or CSV) suitable for export.

**Acceptance criteria:**
- [ ] `GET /connections/{id}/statements` returns all statements for the connection, ordered by `period_start` desc.
- [ ] Calling with a JWT from an unrelated org returns HTTP 403.
- [ ] `GET /statements/{id}/download` returns a downloadable file (Content-Disposition header present) with all line items: gross interest, agent fee, net to supplier, per-loan breakdown, and period.
- [ ] Amended statements appear in the list with an `amendment_of` field linking to the original.

**Out of scope for this feature:** PDF rendering; tax document formatting; payment date tracking.

---

### F-057 — Reporting UI: accrual detail and monthly statement views
**Milestone:** M6
**Depends on:** F-052, F-056, F-010
**Actor(s):** Supplier, Agent

**What it does:** React pages for: (a) per-loan accrual table (date, quantity, daily interest, agent fee, net); (b) connection-level statements list; (c) statement detail with line-item breakdown and download button.

**Acceptance criteria:**
- [ ] Supplier can navigate to a connection and view the statements list with period, gross interest, agent fee, and net to supplier per row.
- [ ] Clicking a statement opens a detail view with per-loan breakdown.
- [ ] "Download" button triggers a file download of the statement data.
- [ ] Amended statements are visually distinguished (e.g., "Amended" badge) and link to the original.
- [ ] Per-loan accrual table accessible from the loan detail page, showing one row per accrual date.
- [ ] TypeScript compiles with zero errors.

**Out of scope for this feature:** Chart/graph views of earnings over time; tax document generation.

---

## Cross-cutting features

---

### F-058 — Admin: organization list and manual org approval API
**Milestone:** M1
**Depends on:** F-011, F-005
**Actor(s):** Admin

**What it does:** `GET /admin/orgs` (admin JWT) returns all organizations. `POST /admin/orgs/{id}/approve` and `POST /admin/orgs/{id}/reject` allow an admin to manage org registrations. (In MVP, orgs self-register and are auto-approved; this endpoint provides manual override capability.)

**Acceptance criteria:**
- [ ] `GET /admin/orgs` with admin JWT returns all org rows with `role`, `status`, `created_at`.
- [ ] Calling with a non-admin JWT returns HTTP 403.
- [ ] `POST /admin/orgs/{id}/approve` sets a status field on the org to `approved` and returns HTTP 200.
- [ ] `POST /admin/orgs/{id}/reject` sets status to `rejected`.

**Out of scope for this feature:** KYB/KYC verification provider integration; org suspension; billing management.

---

### F-059 — Admin: manual job trigger API
**Milestone:** M6
**Depends on:** F-051, F-054, F-005
**Actor(s):** Admin

**What it does:** `POST /admin/jobs/daily-accrual` and `POST /admin/jobs/monthly-statement` (admin JWT) enqueue the respective ARQ jobs immediately, bypassing the schedule. Returns the job ID.

**Acceptance criteria:**
- [ ] `POST /admin/jobs/daily-accrual` with admin JWT enqueues the job and returns HTTP 202 with `{ "job_id": "..." }`.
- [ ] `POST /admin/jobs/monthly-statement` does the same for the statement job.
- [ ] Calling with a non-admin JWT returns HTTP 403.
- [ ] The enqueued job actually runs and produces results observable via the accrual or statement endpoints.

**Out of scope for this feature:** Job history UI; job cancellation; retry controls.

---

### F-060 — OpenAPI spec and type-safe frontend API client
**Milestone:** M0
**Depends on:** F-001
**Actor(s):** System (developer)

**What it does:** Configures FastAPI to expose an OpenAPI schema at `/openapi.json`. Adds a `generate-client` script in the frontend that runs `openapi-typescript` to generate TypeScript types from the live schema, ensuring the frontend and backend share a single source of truth for request/response shapes.

**Acceptance criteria:**
- [ ] `GET http://localhost:8000/openapi.json` returns a valid OpenAPI 3.x JSON document.
- [ ] Running `npm run generate-client` in the frontend directory produces a `src/api/types.ts` file with no TypeScript errors.
- [ ] A sample API call in the frontend that uses the generated type compiles without casting to `any`.

**Out of scope for this feature:** API versioning (`/v1/`); SDK publishing.

---

## Feature index by milestone

| Milestone | Feature IDs |
|---|---|
| M0 — Foundation | F-001, F-002, F-003, F-004, F-005, F-006, F-007, F-008, F-009, F-010, F-060 |
| M1 — Onboarding | F-011, F-012, F-013, F-014, F-015, F-016, F-017, F-018, F-019, F-058 |
| M2 — Connection | F-020, F-021, F-022, F-023, F-024, F-025, F-026, F-027, F-061, F-062, F-063 |
| M3 — Agreement | F-028, F-029, F-030, F-031, F-032 |
| M4 — Loan lifecycle | F-033, F-034, F-035, F-036, F-037, F-038, F-039, F-040, F-041, F-042 |
| M5 — Risk monitoring | F-043, F-044, F-045, F-046, F-047, F-048 |
| M6 — Accrual & Reporting | F-049, F-050, F-051, F-052, F-053, F-054, F-055, F-056, F-057, F-059 |
