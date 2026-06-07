# LendRail — M1 (Onboarding) Backend Technical Specification

| Field | Value |
|---|---|
| Milestone | M1 — Onboarding (backend only) |
| Scope | F-011, F-012, F-013, F-015, F-017, F-018, F-019 (F-014, F-016 are frontend — excluded) |
| Based on | MASTER_PRD.md v0.1, ARCHITECTURE.md v0.2, FEATURES.md, M0-backend-techspec.md |
| Audience | Backend engineer implementing M1, extending the M0 codebase |
| M0 spec ref | `specs/M0-backend-techspec.md` |
| Status | Implementation-ready spec (rev 2 — tech-lead blockers/majors applied) |

---

## 0. Purpose and guiding principles

M1 adds the onboarding layer: organizations (Supplier and Agent), the full user–org relationship, and Borrower management. At the end of M1, a Supplier or Agent can register via a typed public endpoint, receive a JWT, and immediately call `GET /orgs/me`. An Agent can invite Borrowers. The system becomes a multi-tenant application for the first time.

Non-negotiable conventions (identical to M0 — repeated for reference):

- **Layer boundaries.** `API (routers) → domain services → data (repositories)`. Domain services **never** import FastAPI types (`Depends`, `HTTPException`, `Request`, status codes). They take `AuthUser` and typed inputs; they raise typed domain exceptions from `app/core/errors.py`.
- **Error envelope.** All error responses: `{"error": {"code": "...", "message": "..."}}`. All 422 responses — whether from Pydantic validation or domain services — use this envelope (see §7.6 for the `RequestValidationError` handler that enforces this).
- **Secrets.** Password never returned in any API response or logged. The secret-redaction log filter (`app/core/logging.py`) is the backstop; do not rely on it as the primary guard.
- **PyJWT only.** `python-jose` is not used anywhere.
- **Async all the way.** SQLAlchemy 2.x async sessions; all adapter Protocols remain `async def`.
- **Pydantic Settings.** All env vars go through `app/core/config.py` `Settings`.
- **Logging.** The M0 implementation uses stdlib `logging.getLogger` throughout (see `app/notifications/console_adapter.py`). M1 **does not** introduce `structlog` — use stdlib `logging.getLogger` for all M1 new code to remain consistent with the M0 baseline. The `structlog` mandate from the draft spec is rescinded. If `structlog` is adopted in a future milestone it must be added to `pyproject.toml` and all M0 call sites updated as a dedicated task.
- **Email enumeration.** `POST /orgs/register/supplier` and `POST /orgs/register/agent` are public endpoints that return 409 on duplicate email, which is an email enumeration surface. Rate limiting is a deferred production-hardening task — flagged in §10.

### M0 baseline audit (what already exists)

Before speccing new things, here is what M0 actually shipped:

| What | File | State |
|---|---|---|
| `users` table | `alembic/versions/0001_users_and_notifications.py` | Exists. Has `id`, `org_id` (nullable, no FK), `email`, `hashed_password`, `role`, `created_at`. No FK to `organizations` yet. |
| `notifications` table | same migration | Exists. `notifications.user_id` has **no FK to `users`** — by design in M0 (no `organizations` table existed yet). This is a known gap; a migration must add `REFERENCES users(id)` before F-048 (`GET /notifications`) is built. |
| `User` ORM model | `app/models/user.py` | Exists. `org_id` is `nullable=True`, no FK relationship. M1 **fully replaces** this file — it is not patched on top of the M0 version. |
| `hash_password` / `verify_password` | `app/core/security.py` | Exists (`passlib` + `bcrypt`). |
| `verify_password_safe` (constant-time) | `app/core/security.py` | Exists. |
| `AuthUser` dataclass | `app/schemas/auth.py` | Exists. `org_id: UUID | None`. |
| `BaseRepository` | `app/db/repository.py` | Exists with `get`, `get_or_none`, `create`, `update`, `delete`, `list_where`. |
| `DomainError` hierarchy | `app/core/errors.py` | Exists: `NotFoundError`, `AuthError`, `Forbidden`, `ValidationError`, `ConflictError`, `SecretNotFoundError`, `AdapterError`. |
| `require_role` / RBAC guards | `app/api/rbac.py` | Exists. |
| `NotificationService` Protocol | `app/notifications/interface.py` | Exists. |
| `ConsoleNotificationAdapter` | `app/notifications/console_adapter.py` | Exists. Uses `logging.getLogger` — consistent with M1 convention above. |

**M1 obligations against the M0 baseline:**

1. `organizations` table must be created (F-011) before the users FK can be added.
2. A new migration (F-012 delta) must `ALTER TABLE users ADD CONSTRAINT fk_users_org_id_organizations FOREIGN KEY (org_id) REFERENCES organizations(id)` — after scrubbing orphaned `org_id` values (see §3.3 BLOCKER #2 fix).
3. `ops_contact_email` and `regulatory_status_attested` belong on the **`organizations`** table (not `users`) — per tech-lead Decision 3. See §3.2 and §4.1.
4. `User.role` remains on the `User` model (denormalized from `Organization.role`) — this was the M0 decision. It stays in M1 for JWT issuance simplicity. Invariant: `User.role` must always equal `Organization.role`; there is no automated DB enforcement. Revisit before M4.

---

## §1. Overview and scope

M1 delivers the following backend-only features:

| Feature | What | Public? |
|---|---|---|
| **F-011** | `organizations` DB table + Alembic migration | — |
| **F-012** | `users` FK migration + password utility audit | — |
| **F-013** | `POST /orgs/register/supplier` (role=supplier) | Yes (unauthenticated) |
| **F-015** | `POST /orgs/register/agent` (role=agent) | Yes (unauthenticated) |
| **F-017** | `borrowers` DB table + Alembic migration | — |
| **F-018** | `POST /borrowers/invite` (agent-only) + `GET /borrowers/{id}` | Agent JWT |
| **F-019** | `GET /orgs/me` | Any valid JWT |

F-013 and F-015 are **separate endpoints** (`POST /orgs/register/supplier` and `POST /orgs/register/agent`) — each takes its own typed Pydantic request model. There is no shared discriminated-union endpoint. This eliminates the FastAPI ≤0.115 OpenAPI schema-generation bug with top-level discriminated unions (BLOCKER #1).

F-014 and F-016 are React frontend features — **not specced here**.

---

## §2. New directory additions / changes to existing tree

The M0 tree is extended as follows (new files/dirs shown with `[NEW]`; changed files with `[CHANGED]`):

```
backend/
├── alembic/
│   └── versions/
│       ├── 0001_users_and_notifications.py       (M0 — unchanged)
│       ├── 0002_organizations.py                 [NEW] F-011
│       ├── 0003_users_org_fk.py                  [NEW] F-012 delta
│       └── 0004_borrowers.py                     [NEW] F-017
├── app/
│   ├── main.py                                   [CHANGED] include orgs + borrowers routers; add RequestValidationError handler
│   ├── core/
│   │   └── errors.py                             [CHANGED] add RequestValidationError handler (see §7.6)
│   ├── models/
│   │   ├── user.py                               [CHANGED — FULL REPLACEMENT] add FK relationship; remove ops_contact_email/regulatory_status_attested (moved to Organization)
│   │   ├── organization.py                       [NEW] F-011
│   │   └── borrower.py                           [NEW] F-017
│   ├── schemas/
│   │   ├── auth.py                               [CHANGED] org_id now non-nullable post-registration
│   │   ├── orgs.py                               [NEW] request/response models for F-013, F-015, F-019
│   │   └── borrowers.py                          [NEW] request/response models for F-018
│   ├── services/
│   │   ├── auth_service.py                       [CHANGED] UserRepository import updated
│   │   ├── org_service.py                        [NEW] F-013, F-015, F-019
│   │   └── borrower_service.py                   [NEW] F-018
│   ├── repositories/
│   │   ├── __init__.py                           [NEW] package
│   │   ├── user_repository.py                    [NEW] UserRepository moved here from auth_service.py (Decision 6)
│   │   ├── org_repository.py                     [NEW] F-011/F-013/F-015/F-019
│   │   └── borrower_repository.py                [NEW] F-017/F-018
│   └── api/
│       ├── deps.py                               [CHANGED] add get_org_service, get_borrower_service; update UserRepository import
│       └── routers/
│           ├── orgs.py                           [NEW] POST /orgs/register/supplier, POST /orgs/register/agent, GET /orgs/me
│           └── borrowers.py                      [NEW] POST /borrowers/invite, GET /borrowers/{id}
└── tests/
    ├── test_orgs.py                              [NEW] F-011, F-013, F-015, F-019
    └── test_borrowers.py                         [NEW] F-017, F-018
```

> **Repository package consolidation (Decision 6 — required M1 task, not deferred):** `UserRepository` is moved from `app/services/auth_service.py` to `app/repositories/user_repository.py`. `auth_service.py` imports it from the new location. `deps.py` also imports from the new location. This is required M1 work — leaving `UserRepository` in `auth_service.py` while all other repositories live in `repositories/` creates an inconsistency that worsens in M2.

---

## §3. Database changes

### 3.1 ENUM types

Two PostgreSQL native ENUMs are created in migration `0002`:

**`org_role_enum`**
```sql
CREATE TYPE org_role_enum AS ENUM ('supplier', 'agent', 'admin');
```

**`entity_type_enum`**
```sql
CREATE TYPE entity_type_enum AS ENUM ('fund', 'corporate_treasury', 'foundation', 'agent');
```

> **Note:** The DB ENUM retains `'agent'` as a value (it is in the ARCHITECTURE.md data model and removing it requires a migration). However, the public Pydantic schema `EntityType` does **not** expose `'agent'` as a valid value for the registration endpoints — see §7.1. The value is reserved for future internal/admin use.

**`org_status_enum`** (also in migration `0002`):
```sql
CREATE TYPE org_status_enum AS ENUM ('pending_review', 'approved', 'rejected');
```

**`borrower_status_enum`** (created in migration `0004`):
```sql
CREATE TYPE borrower_status_enum AS ENUM ('invited', 'active');
```

> ENUMs are created with `sa.Enum(..., name="...", create_type=True)` and `.create(op.get_bind(), checkfirst=True)` inside migration functions that run under `run_sync` (from the M0 async Alembic `env.py`). `op.get_bind()` is safe in this context because it runs on the synchronous connection provided by `run_sync`. Note: `op.get_bind()` is deprecated in Alembic 1.14+ and will require replacement when upgrading to Alembic 2.x — flag for future upgrade.

### 3.2 Migration 0002 — `organizations` (F-011)

**Revision:** `0002`
**Down-revision:** `0001`

> **`ops_contact_email` placement (Decision 3):** `ops_contact_email` and `regulatory_status_attested` are columns on `organizations`, not on `users`. `ops_contact_email` is an entity-level contact (the settlement/operations desk for the org), not a property of a specific user account. Placing it on `users` creates an ambiguity when the org later has multiple users. Migration 0002 adds both columns to the `organizations` table. Migration 0003 does **not** add them to `users`.

```python
# alembic/versions/0002_organizations.py

"""organizations table — includes ops_contact_email and regulatory_status_attested
(Decision 3: these are org-level fields, not user-level fields).

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-07 00:00:00.000000
"""
from typing import Sequence, Union
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

org_role_enum = sa.Enum(
    "supplier", "agent", "admin",
    name="org_role_enum",
    create_type=True,
)
entity_type_enum = sa.Enum(
    "fund", "corporate_treasury", "foundation", "agent",
    name="entity_type_enum",
    create_type=True,
)
org_status_enum = sa.Enum(
    "pending_review", "approved", "rejected",
    name="org_status_enum",
    create_type=True,
)

def upgrade() -> None:
    # op.get_bind() is safe here: runs inside run_sync in the async Alembic env.py.
    # Note: deprecated in Alembic 1.14+; requires update for Alembic 2.x.
    org_role_enum.create(op.get_bind(), checkfirst=True)
    entity_type_enum.create(op.get_bind(), checkfirst=True)
    org_status_enum.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "organizations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("jurisdiction", sa.Text(), nullable=False),
        sa.Column(
            "entity_type",
            sa.Enum("fund", "corporate_treasury", "foundation", "agent",
                    name="entity_type_enum", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "role",
            sa.Enum("supplier", "agent", "admin",
                    name="org_role_enum", create_type=False),
            nullable=False,
        ),
        sa.Column("contact_email", sa.String(320), nullable=False),
        sa.Column("ops_contact_email", sa.String(320), nullable=True),
        sa.Column(
            "regulatory_status_attested",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "status",
            sa.Enum("pending_review", "approved", "rejected",
                    name="org_status_enum", create_type=False),
            nullable=False,
            server_default="pending_review",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_organizations"),
        sa.UniqueConstraint("contact_email", name="uq_organizations_contact_email"),
    )
    op.create_index("ix_organizations_contact_email", "organizations", ["contact_email"])
    op.create_index("ix_organizations_role", "organizations", ["role"])

def downgrade() -> None:
    op.drop_index("ix_organizations_role", table_name="organizations")
    op.drop_index("ix_organizations_contact_email", table_name="organizations")
    op.drop_table("organizations")
    # Drop in exact reverse creation order:
    org_status_enum.drop(op.get_bind(), checkfirst=True)
    entity_type_enum.drop(op.get_bind(), checkfirst=True)
    org_role_enum.drop(op.get_bind(), checkfirst=True)
```

**Exact column definitions:**

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `UUID` | PK NOT NULL | `uuid.uuid4()` default in ORM |
| `name` | `TEXT` | NOT NULL | Legal entity name |
| `jurisdiction` | `TEXT` | NOT NULL | e.g. "Delaware, USA" |
| `entity_type` | `entity_type_enum` | NOT NULL | DB ENUM includes `'agent'`; public API schema excludes it (§7.1) |
| `role` | `org_role_enum` | NOT NULL | DB-level ENUM enforcement |
| `contact_email` | `VARCHAR(320)` | NOT NULL UNIQUE | Primary contact email; also the login email for the first user |
| `ops_contact_email` | `VARCHAR(320)` | NULLABLE | Settlement/operations contact for agent orgs; NULL for supplier orgs. Must differ from `contact_email` (enforced in service layer). |
| `regulatory_status_attested` | `BOOLEAN` | NOT NULL DEFAULT `false` | Set `true` on agent registration. Enforced in domain service (not Pydantic model_validator). |
| `status` | `org_status_enum` | NOT NULL DEFAULT `pending_review` | For F-058 admin approval flow |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT `now()` | |

> **`status` column justification:** F-058 (admin org approval) requires `approved` / `rejected` states. Adding `status` here avoids a fifth migration. In MVP, orgs are auto-approved (`OrgService` sets `status=approved` immediately on registration); the field exists for F-058's manual override.

### 3.3 Migration 0003 — users FK (F-012 delta)

**What already exists in M0:** The `users` table with `id`, `org_id` (nullable UUID, no FK), `email`, `hashed_password`, `role`, `created_at`.

**What M1 adds:** FK constraint from `users.org_id → organizations.id`.

> **BLOCKER #2 fix — data scrub before FK creation:** Migration 0001 stored `org_id` as a plain nullable UUID with no FK constraint. Test seeds or seed scripts may have written non-NULL UUIDs into `users.org_id` that have no corresponding row in `organizations`. If any such orphaned rows exist, `op.create_foreign_key` will fail with a FK violation. The upgrade function therefore:
> 1. Deletes rows where `org_id IS NULL OR org_id NOT IN (SELECT id FROM organizations)` — this removes M0 seed users that either have no org or have a fabricated org UUID.
> 2. Adds the FK constraint with `NOT VALID` — skips validation of existing rows during the DDL statement (faster, avoids table lock on large tables).
> 3. Immediately validates with `ALTER TABLE users VALIDATE CONSTRAINT` — performs a sequential scan to confirm all remaining rows satisfy the FK. If any orphaned rows slipped through step 1, this will fail loudly rather than silently.

```python
# alembic/versions/0003_users_org_fk.py

"""users org FK

Adds foreign key from users.org_id to organizations.id.

IMPORTANT: Before adding the FK, this migration scrubs M0 seed users whose
org_id is NULL or points to a non-existent organization row. These rows are
test/seed artifacts from M0 (when no organizations table existed). Any such
rows are deleted — do not run this migration in an environment where M0 seed
users must be preserved without a prior org-assignment data migration.

After the FK is added with NOT VALID, the constraint is immediately validated
via ALTER TABLE ... VALIDATE CONSTRAINT to ensure no orphaned rows remain.

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-07 00:00:00.000000
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # Step 1: Remove rows with NULL org_id or orphaned (non-existent) org_id.
    # This handles M0 seed users created before the organizations table existed.
    op.execute(
        "DELETE FROM users WHERE org_id IS NULL "
        "OR org_id NOT IN (SELECT id FROM organizations)"
    )

    # Step 2: Add the FK constraint with NOT VALID to skip row-level validation
    # during DDL (avoids a full-table lock on large deployments).
    op.create_foreign_key(
        "fk_users_org_id_organizations",
        "users",
        "organizations",
        ["org_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    # Step 3: Validate the constraint — performs a sequential scan.
    # If any orphaned rows survived step 1, this raises immediately.
    op.execute(
        "ALTER TABLE users VALIDATE CONSTRAINT fk_users_org_id_organizations"
    )

def downgrade() -> None:
    op.drop_constraint("fk_users_org_id_organizations", "users", type_="foreignkey")
```

> **Note:** After migration 0003, `users.org_id` is still technically nullable at the DB level. The NOT NULL constraint will be enforced in a M2 migration (`0005_users_org_id_not_null.py`) once all seed users have been assigned orgs — see §8 and §10 Decision 1.

**Full `users` column set after 0001 + 0003:**

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `UUID` | PK NOT NULL | |
| `org_id` | `UUID` | NULLABLE FK → `organizations.id` ON DELETE RESTRICT | Null rows scrubbed by 0003 upgrade; always set post-M1 registration |
| `email` | `VARCHAR(320)` | NOT NULL UNIQUE INDEX | Login email |
| `hashed_password` | `VARCHAR(255)` | NOT NULL | bcrypt hash; never returned in API |
| `role` | `VARCHAR(16)` | NOT NULL DEFAULT `supplier` | Denormalized from org role for JWT issuance |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT `now()` | |

> `ops_contact_email` and `regulatory_status_attested` are on the `organizations` table (migration 0002), not on `users`.

### 3.4 Migration 0004 — `borrowers` (F-017)

**Revision:** `0004`
**Down-revision:** `0003`

```python
# alembic/versions/0004_borrowers.py

"""borrowers table

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-07 00:00:00.000000
"""
from typing import Sequence, Union
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

borrower_status_enum = sa.Enum(
    "invited", "active",
    name="borrower_status_enum",
    create_type=True,
)

def upgrade() -> None:
    borrower_status_enum.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "borrowers",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("invited_by", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("jurisdiction", sa.Text(), nullable=False),
        sa.Column("contact_email", sa.String(320), nullable=False),
        sa.Column(
            "status",
            sa.Enum("invited", "active",
                    name="borrower_status_enum", create_type=False),
            nullable=False,
            server_default="invited",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_borrowers"),
        sa.ForeignKeyConstraint(
            ["invited_by"],
            ["organizations.id"],
            name="fk_borrowers_invited_by_organizations",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("contact_email", name="uq_borrowers_contact_email"),
    )
    op.create_index("ix_borrowers_contact_email", "borrowers", ["contact_email"])
    op.create_index("ix_borrowers_invited_by", "borrowers", ["invited_by"])

def downgrade() -> None:
    op.drop_index("ix_borrowers_invited_by", table_name="borrowers")
    op.drop_index("ix_borrowers_contact_email", table_name="borrowers")
    op.drop_table("borrowers")
    borrower_status_enum.drop(op.get_bind(), checkfirst=True)
```

**Exact column definitions:**

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `UUID` | PK NOT NULL | |
| `invited_by` | `UUID` | NOT NULL FK → `organizations.id` ON DELETE RESTRICT | Agent org that created this borrower |
| `name` | `TEXT` | NOT NULL | |
| `jurisdiction` | `TEXT` | NOT NULL | |
| `contact_email` | `VARCHAR(320)` | NOT NULL UNIQUE | Invite destination |
| `status` | `borrower_status_enum` | NOT NULL DEFAULT `invited` | DB-level ENUM |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT `now()` | |

---

## §4. New SQLAlchemy models

### 4.1 `Organization` (`app/models/organization.py`)

> Includes `ops_contact_email` and `regulatory_status_attested` (Decision 3 — these are org-level fields).

```python
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy import Boolean, String, Text, DateTime, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User

class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(Text(), nullable=False)
    jurisdiction: Mapped[str] = mapped_column(Text(), nullable=False)
    entity_type: Mapped[str] = mapped_column(
        sa.Enum(
            "fund", "corporate_treasury", "foundation", "agent",
            name="entity_type_enum", create_type=False
        ),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(
        sa.Enum(
            "supplier", "agent", "admin",
            name="org_role_enum", create_type=False
        ),
        nullable=False,
    )
    contact_email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    # ops_contact_email: agent orgs only; NULL for supplier orgs.
    # Must differ from contact_email — enforced in OrgService.register_agent, not DB.
    ops_contact_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    # regulatory_status_attested: agent orgs must set True on registration.
    # Enforced in OrgService.register_agent (domain layer), not Pydantic model_validator.
    regulatory_status_attested: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=sa.text("false")
    )
    status: Mapped[str] = mapped_column(
        sa.Enum(
            "pending_review", "approved", "rejected",
            name="org_status_enum", create_type=False
        ),
        nullable=False,
        server_default="pending_review",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationship: one org → many users (back-populated in User model)
    # lazy="noload" prevents accidental N+1 lazy-loads in async context.
    # Load explicitly via selectinload(Organization.users) when needed.
    users: Mapped[list["User"]] = relationship("User", back_populates="org", lazy="noload")
```

### 4.2 Updated `User` (`app/models/user.py`)

> **IMPORTANT: This is a full file replacement, not a patch.** The M0 `User` model has no `org` relationship attribute. M1 adds the FK relationship. The engineer must replace `backend/app/models/user.py` entirely with this version — not add lines to the existing file.
>
> `ops_contact_email` and `regulatory_status_attested` are **not** on this model — they were moved to `Organization` (Decision 3).

```python
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.organization import Organization

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("organizations.id", name="fk_users_org_id_organizations", ondelete="RESTRICT"),
        nullable=True,  # Nullable until M2 gate migration (0005_users_org_id_not_null)
    )
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, server_default="supplier")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationship — load explicitly via selectinload(User.org) when needed.
    # lazy="noload" prevents implicit async lazy-load errors.
    org: Mapped["Organization | None"] = relationship(
        "Organization", back_populates="users", lazy="noload"
    )
```

### 4.3 `Borrower` (`app/models/borrower.py`)

```python
import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

class Borrower(Base):
    __tablename__ = "borrowers"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    invited_by: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("organizations.id", name="fk_borrowers_invited_by_organizations", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(Text(), nullable=False)
    jurisdiction: Mapped[str] = mapped_column(Text(), nullable=False)
    contact_email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        sa.Enum("invited", "active", name="borrower_status_enum", create_type=False),
        nullable=False,
        server_default="invited",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # No ORM relationship to Organization for invited_by — load explicitly via join if needed.
    # Keeping this as a bare FK column avoids accidental eager-loads in async context.
```

### 4.4 `app/models/__init__.py` update

The `__init__.py` must import all models so Alembic's `env.py` metadata is fully populated:

```python
# app/models/__init__.py
from app.models.notification import Notification  # noqa: F401
from app.models.organization import Organization  # noqa: F401
from app.models.borrower import Borrower          # noqa: F401
from app.models.user import User                  # noqa: F401
```

---

## §5. Repositories

Repository classes extend `BaseRepository[T]` from `app/db/repository.py`. All methods are `async`. No raw SQL — only SQLAlchemy ORM expressions.

### 5.1 `UserRepository` (`app/repositories/user_repository.py`)

> **Decision 6 — moved from `auth_service.py` to `repositories/` in M1 (required, not deferred).** `auth_service.py` must update its import. `deps.py` must update its import.

```python
# app/repositories/user_repository.py
from uuid import UUID

from app.db.repository import BaseRepository
from app.models.user import User


class UserRepository(BaseRepository[User]):
    model = User

    async def get_by_email(self, email: str) -> User | None:
        rows = await self.list_where(User.email == email)
        return rows[0] if rows else None

    async def create_user(
        self,
        *,
        org_id: UUID,
        email: str,
        hashed_password: str,
        role: str,
    ) -> User:
        return await self.create(
            org_id=org_id,
            email=email,
            hashed_password=hashed_password,
            role=role,
        )
```

### 5.2 `OrgRepository` (`app/repositories/org_repository.py`)

```python
from sqlalchemy import select

from app.db.repository import BaseRepository
from app.models.organization import Organization


class OrgRepository(BaseRepository[Organization]):
    model = Organization

    async def get_by_contact_email(self, email: str) -> Organization | None:
        """Return the org whose contact_email matches, or None."""
        rows = await self.list_where(Organization.contact_email == email)
        return rows[0] if rows else None

    async def list_all(self) -> list[Organization]:
        """Return all orgs. Used by F-058 admin endpoint."""
        result = await self.session.execute(select(Organization))
        return list(result.scalars().all())
```

> `get_by_id` is removed — callers use `self.orgs.get(org_id)` (from `BaseRepository`) directly. A thin alias with no additional query logic adds confusion (finding #11).

### 5.3 `BorrowerRepository` (`app/repositories/borrower_repository.py`)

```python
from uuid import UUID

from app.db.repository import BaseRepository
from app.models.borrower import Borrower


class BorrowerRepository(BaseRepository[Borrower]):
    model = Borrower

    async def get_by_contact_email(self, email: str) -> Borrower | None:
        rows = await self.list_where(Borrower.contact_email == email)
        return rows[0] if rows else None

    async def list_by_inviting_org(self, org_id: UUID) -> list[Borrower]:
        """Return all borrowers invited by a given agent org."""
        return await self.list_where(Borrower.invited_by == org_id)
```

---

## §6. Domain services

**Hard constraint:** domain services never import from `fastapi`. They raise `DomainError` subclasses from `app/core/errors.py`. They receive `AuthUser` from the API layer and typed DTO inputs.

### 6.1 `OrgService` (`app/services/org_service.py`)

Key changes from draft:
- `ops_contact_email` and `regulatory_status_attested` are passed to `orgs.create(...)`, not `users.create_user(...)`.
- Attestation check is **in the service** (not in Pydantic `model_validator`) — raises `ValidationError(code="attestation_required")` which routes through the existing domain exception handler to the correct envelope.
- `ops_contact_email == contact_email` self-collision guard (BLOCKER #4).

```python
"""OrgService — domain service for org registration and lookup. No FastAPI imports."""
import uuid
import logging
from dataclasses import dataclass

from app.core.errors import ConflictError, Forbidden, NotFoundError, ValidationError
from app.core.security import hash_password, create_access_token
from app.models.organization import Organization
from app.repositories.org_repository import OrgRepository
from app.repositories.user_repository import UserRepository
from app.schemas.auth import AuthUser

log = logging.getLogger("lendrail.services.org")

# ── Input DTOs (plain dataclasses — no FastAPI types) ─────────────────────────

@dataclass
class SupplierRegistrationInput:
    name: str
    jurisdiction: str
    entity_type: str          # validated against Pydantic Literal before reaching service
    contact_email: str
    password: str             # plaintext — hashed inside service, never stored raw

@dataclass
class AgentRegistrationInput:
    name: str
    jurisdiction: str
    entity_type: str
    contact_email: str
    password: str
    ops_contact_email: str
    regulatory_status_attested: bool

# ── Output DTOs ────────────────────────────────────────────────────────────────

@dataclass
class RegistrationResult:
    org_id: uuid.UUID
    access_token: str

@dataclass
class OrgProfile:
    id: uuid.UUID
    name: str
    jurisdiction: str
    entity_type: str
    role: str
    contact_email: str
    status: str
    created_at: str           # ISO-8601 string; serialization handled by Pydantic schema layer

# ── Service ───────────────────────────────────────────────────────────────────

class OrgService:
    def __init__(self, orgs: OrgRepository, users: UserRepository) -> None:
        self.orgs = orgs
        self.users = users

    async def register_supplier(self, data: SupplierRegistrationInput) -> RegistrationResult:
        """Create an Organization with role=supplier and its first User. Returns JWT."""
        await self._assert_email_unique(data.contact_email)

        org = await self.orgs.create(
            id=uuid.uuid4(),
            name=data.name,
            jurisdiction=data.jurisdiction,
            entity_type=data.entity_type,
            role="supplier",
            contact_email=data.contact_email,
            status="approved",   # auto-approved in MVP; F-058 provides manual override
        )
        log.info("org_created org_id=%s role=supplier", org.id)

        user = await self.users.create_user(
            org_id=org.id,
            email=data.contact_email,
            hashed_password=hash_password(data.password),
            role="supplier",
        )
        log.info("user_created user_id=%s org_id=%s", user.id, org.id)
        # data.password is NEVER passed to log — only IDs are logged.

        token = create_access_token(
            user_id=str(user.id),
            org_id=str(org.id),
            role="supplier",
        )
        return RegistrationResult(org_id=org.id, access_token=token)

    async def register_agent(self, data: AgentRegistrationInput) -> RegistrationResult:
        """Create an Organization with role=agent and its first User."""
        # BLOCKER #3 fix: attestation check is here in the service (not model_validator).
        # Raises ValidationError → existing handler → {"error": {"code": "attestation_required", ...}}
        if not data.regulatory_status_attested:
            raise ValidationError(
                "regulatory_status_attested must be true to register as an agent",
                code="attestation_required",
            )

        # BLOCKER #4 fix: ops_contact_email must differ from primary contact_email.
        if data.ops_contact_email == data.contact_email:
            raise ValidationError(
                "Ops contact email must differ from primary contact email",
                code="invalid_ops_email",
            )

        await self._assert_email_unique(data.contact_email)

        org = await self.orgs.create(
            id=uuid.uuid4(),
            name=data.name,
            jurisdiction=data.jurisdiction,
            entity_type=data.entity_type,
            role="agent",
            contact_email=data.contact_email,
            ops_contact_email=data.ops_contact_email,
            regulatory_status_attested=True,
            status="approved",
        )
        log.info("org_created org_id=%s role=agent", org.id)

        user = await self.users.create_user(
            org_id=org.id,
            email=data.contact_email,
            hashed_password=hash_password(data.password),
            role="agent",
        )
        log.info("user_created user_id=%s org_id=%s", user.id, org.id)

        token = create_access_token(
            user_id=str(user.id),
            org_id=str(org.id),
            role="agent",
        )
        return RegistrationResult(org_id=org.id, access_token=token)

    async def get_my_org(self, caller: AuthUser) -> OrgProfile:
        """Return the authenticated user's organization record."""
        if caller.org_id is None:
            raise Forbidden("User is not associated with any organization")
        org = await self.orgs.get(caller.org_id)   # BaseRepository.get — raises NotFoundError if missing
        return OrgProfile(
            id=org.id,
            name=org.name,
            jurisdiction=org.jurisdiction,
            entity_type=org.entity_type,
            role=org.role,
            contact_email=org.contact_email,
            status=org.status,
            created_at=org.created_at.isoformat(),
        )

    # ── Private helpers ────────────────────────────────────────────────────────

    async def _assert_email_unique(self, email: str) -> None:
        existing = await self.orgs.get_by_contact_email(email)
        if existing is not None:
            raise ConflictError(
                f"An organization with email '{email}' already exists",
                code="duplicate_email",
            )
        # Also check users table — an email may exist as a user without an org (M0 seed edge case)
        existing_user = await self.users.get_by_email(email)
        if existing_user is not None:
            raise ConflictError(
                f"A user with email '{email}' already exists",
                code="duplicate_email",
            )
```

> **Password never logged:** `hash_password(data.password)` is called inline as an argument to `create_user`. The plaintext `data.password` is never passed to any log statement. The secret-redaction filter is a backstop only.

### 6.2 `BorrowerService` (`app/services/borrower_service.py`)

> **`notifications.user_id` gap:** The M0 `notifications` table has no FK from `user_id` to `users.id` (by design — no organizations existed in M0). The `ConsoleNotificationAdapter` writes a `notifications` DB row per recipient. For F-018 the recipient is `caller.user_id` (the agent's `user_id`), which is a valid `users.id`. The call is correct for M1. However the missing FK is a latent integrity issue: a migration must add `REFERENCES users(id)` before F-048 (`GET /notifications`) is built. Flag in M2 scope.

```python
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
```

---

## §7. API layer

### 7.1 Pydantic request/response schemas (`app/schemas/orgs.py`)

> **BLOCKER #1 fix — split endpoints, no discriminated union:** The draft used a discriminated union `OrgRegisterRequest` on a single `POST /orgs/register` endpoint. FastAPI ≤0.115 cannot emit a valid `requestBody` schema for a top-level discriminated union, breaking `/openapi.json`. M1 uses two separate endpoints (`POST /orgs/register/supplier`, `POST /orgs/register/agent`), each with its own typed Pydantic model. The discriminated union and `OrgRegisterRequest` type are removed entirely.
>
> **BLOCKER #3 fix — no `model_validator` on `AgentRegisterRequest`:** The attestation check is done in `OrgService.register_agent` (see §6.1). Placing it in a Pydantic `model_validator` produces FastAPI's default `{"detail": [...]}` 422 shape, not the required `{"error": {...}}` envelope.
>
> **MAJOR #4 — `EntityType` removes `"agent"` from public schema (Decision 8):** The public registration endpoints only accept `"fund"`, `"corporate_treasury"`, `"foundation"`. The DB ENUM retains `"agent"` for future internal/admin use.
>
> **MAJOR #3 — password minimum raised to 12 characters (Decision 7).**

```python
# app/schemas/orgs.py
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

# ── Shared ENUM literals ──────────────────────────────────────────────────────

# "agent" is intentionally excluded from the public EntityType.
# The DB entity_type_enum retains "agent" for future internal/admin use.
# See §11 Resolution log — Decision 8.
EntityType = Literal["fund", "corporate_treasury", "foundation"]
OrgRole = Literal["supplier", "agent"]    # admin cannot self-register

# ── Request models ────────────────────────────────────────────────────────────

class SupplierRegisterRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    jurisdiction: str = Field(..., min_length=1, max_length=255)
    entity_type: EntityType
    contact_email: EmailStr
    password: str = Field(..., min_length=12, max_length=128)

class AgentRegisterRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    jurisdiction: str = Field(..., min_length=1, max_length=255)
    entity_type: EntityType
    contact_email: EmailStr
    password: str = Field(..., min_length=12, max_length=128)
    ops_contact_email: EmailStr
    regulatory_status_attested: bool
    # NOTE: No model_validator for regulatory_status_attested.
    # The attestation check (and the ops_contact_email != contact_email check)
    # is performed in OrgService.register_agent, which raises ValidationError
    # with the correct code. This ensures the {"error": {...}} envelope is used
    # for all 422s (the global RequestValidationError handler covers Pydantic 422s).

# ── Response models ───────────────────────────────────────────────────────────

class OrgRegisterResponse(BaseModel):
    org_id: UUID
    access_token: str
    token_type: Literal["bearer"] = "bearer"

class OrgMeResponse(BaseModel):
    id: UUID
    name: str
    jurisdiction: str
    entity_type: str
    role: str
    contact_email: str
    status: str
    created_at: str   # ISO-8601; keep as str to avoid TZ serialization ambiguity in JSON
```

### 7.2 Pydantic request/response schemas (`app/schemas/borrowers.py`)

```python
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

class BorrowerInviteRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    jurisdiction: str = Field(..., min_length=1, max_length=255)
    contact_email: EmailStr

class BorrowerInviteResponse(BaseModel):
    borrower_id: UUID

class BorrowerDetailResponse(BaseModel):
    id: UUID
    invited_by: UUID
    name: str
    jurisdiction: str
    contact_email: str
    status: str
    created_at: str
```

### 7.3 Orgs router (`app/api/routers/orgs.py`)

> **BLOCKER #1 fix — two separate endpoints, no discriminated union dispatch.**

```python
"""Org registration and profile endpoints."""
from fastapi import APIRouter, Depends, status

from app.api.deps import get_current_user, get_org_service
from app.schemas.auth import AuthUser
from app.schemas.orgs import (
    AgentRegisterRequest,
    OrgMeResponse,
    OrgRegisterResponse,
    SupplierRegisterRequest,
)
from app.services.org_service import AgentRegistrationInput, OrgService, SupplierRegistrationInput

router = APIRouter(prefix="/orgs", tags=["orgs"])


@router.post(
    "/register/supplier",
    response_model=OrgRegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new supplier organization",
)
async def register_supplier(
    body: SupplierRegisterRequest,
    svc: OrgService = Depends(get_org_service),
) -> OrgRegisterResponse:
    """
    Public endpoint. No authentication required.

    On success returns HTTP 201 with `org_id` and `access_token` (JWT bearer token).

    Error responses:
    - 409: duplicate email → `{"error": {"code": "duplicate_email", "message": "..."}}`
    - 422: validation failure (invalid entity_type, missing fields, password < 12 chars)
           → `{"error": {"code": "validation_error", "message": "..."}}`
    """
    result = await svc.register_supplier(
        SupplierRegistrationInput(
            name=body.name,
            jurisdiction=body.jurisdiction,
            entity_type=body.entity_type,
            contact_email=body.contact_email,
            password=body.password,
        )
    )
    return OrgRegisterResponse(
        org_id=result.org_id,
        access_token=result.access_token,
    )


@router.post(
    "/register/agent",
    response_model=OrgRegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new agent organization",
)
async def register_agent(
    body: AgentRegisterRequest,
    svc: OrgService = Depends(get_org_service),
) -> OrgRegisterResponse:
    """
    Public endpoint. No authentication required.

    `regulatory_status_attested` must be `true` — enforced in domain service.
    `ops_contact_email` must differ from `contact_email` — enforced in domain service.

    On success returns HTTP 201 with `org_id` and `access_token` (JWT bearer token).

    Error responses:
    - 409: duplicate email → `{"error": {"code": "duplicate_email", "message": "..."}}`
    - 422: attestation false → `{"error": {"code": "attestation_required", "message": "..."}}`
    - 422: ops/contact email collision → `{"error": {"code": "invalid_ops_email", "message": "..."}}`
    - 422: other validation failure → `{"error": {"code": "validation_error", "message": "..."}}`
    """
    result = await svc.register_agent(
        AgentRegistrationInput(
            name=body.name,
            jurisdiction=body.jurisdiction,
            entity_type=body.entity_type,
            contact_email=body.contact_email,
            password=body.password,
            ops_contact_email=body.ops_contact_email,
            regulatory_status_attested=body.regulatory_status_attested,
        )
    )
    return OrgRegisterResponse(
        org_id=result.org_id,
        access_token=result.access_token,
    )


@router.get(
    "/me",
    response_model=OrgMeResponse,
    status_code=status.HTTP_200_OK,
    summary="Return the authenticated user's organization",
)
async def get_my_org(
    caller: AuthUser = Depends(get_current_user),
    svc: OrgService = Depends(get_org_service),
) -> OrgMeResponse:
    """
    Requires valid JWT. Returns the organization the caller belongs to.

    Error responses:
    - 401: missing or invalid token
    - 403: JWT carries no org_id (e.g. M0 seed user with null org_id)
    - 404: org_id in JWT does not match any organization row (should not happen post-M1)
    """
    profile = await svc.get_my_org(caller)
    return OrgMeResponse(
        id=profile.id,
        name=profile.name,
        jurisdiction=profile.jurisdiction,
        entity_type=profile.entity_type,
        role=profile.role,
        contact_email=profile.contact_email,
        status=profile.status,
        created_at=profile.created_at,
    )
```

### 7.4 Borrowers router (`app/api/routers/borrowers.py`)

```python
"""Borrower management endpoints."""
import uuid

from fastapi import APIRouter, Depends, status

from app.api.deps import get_borrower_service
from app.api.rbac import require_role
from app.schemas.auth import AuthUser
from app.schemas.borrowers import (
    BorrowerDetailResponse,
    BorrowerInviteRequest,
    BorrowerInviteResponse,
)
from app.services.borrower_service import BorrowerInviteInput, BorrowerService

router = APIRouter(prefix="/borrowers", tags=["borrowers"])


@router.post(
    "/invite",
    response_model=BorrowerInviteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Invite a borrower (agent only)",
)
async def invite_borrower(
    body: BorrowerInviteRequest,
    caller: AuthUser = Depends(require_role("agent")),
    svc: BorrowerService = Depends(get_borrower_service),
) -> BorrowerInviteResponse:
    """
    Requires agent JWT. Creates a Borrower row with status=invited and fires
    a 'borrower_invited' notification event (console log in MVP).

    Error responses:
    - 401: missing/invalid token
    - 403: caller is not an agent → `{"error": {"code": "forbidden", "message": "..."}}`
    - 409: contact_email already exists → `{"error": {"code": "duplicate_email", "message": "..."}}`
    - 422: missing required fields → `{"error": {"code": "validation_error", "message": "..."}}`
    """
    result = await svc.invite_borrower(
        caller=caller,
        data=BorrowerInviteInput(
            name=body.name,
            jurisdiction=body.jurisdiction,
            contact_email=body.contact_email,
        ),
    )
    return BorrowerInviteResponse(borrower_id=result.id)


@router.get(
    "/{borrower_id}",
    response_model=BorrowerDetailResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve a borrower record (agent only)",
)
async def get_borrower(
    borrower_id: uuid.UUID,
    caller: AuthUser = Depends(require_role("agent")),
    svc: BorrowerService = Depends(get_borrower_service),
) -> BorrowerDetailResponse:
    """
    Requires agent JWT. Agent must have invited this borrower.

    Error responses:
    - 401: missing/invalid token
    - 403: caller is not agent, or borrower belongs to a different agent org
    - 404: borrower_id not found
    """
    result = await svc.get_borrower(caller=caller, borrower_id=borrower_id)
    return BorrowerDetailResponse(
        id=result.id,
        invited_by=result.invited_by,
        name=result.name,
        jurisdiction=result.jurisdiction,
        contact_email=result.contact_email,
        status=result.status,
        created_at=result.created_at,
    )
```

### 7.5 Error envelope reference for M1 endpoints

All domain errors are mapped by the existing handler in `app/core/errors.py`. Pydantic validation errors are intercepted by the new `RequestValidationError` handler (§7.6) and reformatted to the same envelope. All 422 responses from M1 endpoints use `{"error": {"code": "...", "message": "..."}}`.

> **`ConflictError` code override note:** `ConflictError` has class-level `code = "conflict"`. When instantiated with `ConflictError(..., code="duplicate_email")`, the `__init__` override sets `self.code = "duplicate_email"`. The envelope will show `"duplicate_email"` not `"conflict"`. This is the intended behaviour — the custom `code` kwarg overrides the class default.

| Scenario | Exception raised | HTTP | Envelope |
|---|---|---|---|
| Duplicate `contact_email` on `/orgs/register/*` | `ConflictError("...", code="duplicate_email")` | 409 | `{"error": {"code": "duplicate_email", "message": "..."}}` |
| Invalid `entity_type` or missing field (Pydantic) | `RequestValidationError` → handler | 422 | `{"error": {"code": "validation_error", "message": "<field>: <msg>"}}` |
| `regulatory_status_attested=false` | `ValidationError("...", code="attestation_required")` | 422 | `{"error": {"code": "attestation_required", "message": "..."}}` |
| `ops_contact_email == contact_email` | `ValidationError("...", code="invalid_ops_email")` | 422 | `{"error": {"code": "invalid_ops_email", "message": "..."}}` |
| `POST /borrowers/invite` with supplier JWT | `Forbidden(...)` | 403 | `{"error": {"code": "forbidden", "message": "..."}}` |
| `GET /orgs/me` without token | `AuthError(...)` | 401 | `{"error": {"code": "unauthorized", "message": "..."}}` |
| `GET /orgs/me` with no org_id in JWT | `Forbidden(...)` | 403 | `{"error": {"code": "forbidden", "message": "..."}}` |
| Duplicate borrower email | `ConflictError("...", code="duplicate_email")` | 409 | `{"error": {"code": "duplicate_email", "message": "..."}}` |
| `GET /borrowers/{id}` wrong org | `Forbidden(...)` | 403 | `{"error": {"code": "forbidden", "message": "..."}}` |
| `GET /borrowers/{id}` not found | `NotFoundError(...)` | 404 | `{"error": {"code": "not_found", "message": "..."}}` |

### 7.6 Global `RequestValidationError` handler (BLOCKER #3 / Decision 4 fix)

Add to `app/core/errors.py` (inside `register_exception_handlers`) and register in `app/main.py`:

```python
# In app/core/errors.py — add to register_exception_handlers:

from fastapi.exceptions import RequestValidationError

def register_exception_handlers(app: FastAPI) -> None:
    async def domain_error_handler(request: Request, exc: DomainError) -> JSONResponse:
        status_code = next((s for t, s in _STATUS_MAP.items() if isinstance(exc, t)), 500)
        return JSONResponse(
            status_code=status_code,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """Convert ALL Pydantic RequestValidationError 422s to the standard error envelope.
        Uses the first error's location and message for the human-readable message.
        """
        first = exc.errors()[0]
        loc = first.get("loc", ())
        field = loc[-1] if loc else "unknown"
        msg = first.get("msg", "validation error")
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "validation_error", "message": f"{field}: {msg}"}},
        )

    app.add_exception_handler(DomainError, domain_error_handler)        # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
```

> This handler ensures all 422 responses — whether from Pydantic field validation (e.g. `entity_type="banana"`, `password` too short, missing required field) or domain services — use the `{"error": {"code": "...", "message": "..."}}` envelope. It resolves the two-format 422 problem (Decision 4) and is required for M1.

### 7.7 Updated `app/api/deps.py`

Add providers for `OrgService` and `BorrowerService`. Update `UserRepository` import to new location:

```python
# Add to existing app/api/deps.py:

from app.repositories.org_repository import OrgRepository
from app.repositories.borrower_repository import BorrowerRepository
from app.repositories.user_repository import UserRepository   # moved from auth_service.py
from app.services.org_service import OrgService
from app.services.borrower_service import BorrowerService

def get_org_service(session: SessionDep) -> OrgService:
    return OrgService(
        orgs=OrgRepository(session),
        users=UserRepository(session),
    )

def get_borrower_service(session: SessionDep) -> BorrowerService:
    notifier = ConsoleNotificationAdapter(NotificationRepository(session))
    return BorrowerService(
        borrowers=BorrowerRepository(session),
        notifier=notifier,
    )
```

### 7.8 Updated `app/main.py`

Register the new routers and the exception handler is already registered via `register_exception_handlers`:

```python
# In create_app(), add:
from app.api.routers import orgs, borrowers

app.include_router(orgs.router)
app.include_router(borrowers.router)
```

---

## §8. Updated JWT claims

### Current M0 state

In M0, `create_access_token` emits:
```python
{"sub": user_id, "org_id": org_id_or_None, "role": role, "exp": ..., "iat": ...}
```
`org_id` is `null` in the JWT for M0 seed users (no org exists in M0). `AuthUser.org_id` is `UUID | None`.

### M1 requirement

After M1 registration, **`org_id` is always set** in the JWT. The `register_supplier` and `register_agent` methods in `OrgService` create the org first, then the user, then call `create_access_token` with the org's UUID — so the returned JWT always has `org_id` set to a non-null UUID.

**`org_id` is NOT made mandatory in `AuthUser` or `create_access_token` in M1** because:
1. M0 seed users (created outside the registration flow for testing) may have `org_id=None`.
2. Making it non-nullable now would break `POST /auth/login` for M0 seed users.
3. The `GET /orgs/me` endpoint handles `org_id=None` gracefully by raising `Forbidden`.

**M2 hard gate — `users.org_id NOT NULL`:** At the start of M2, before any M2 migration is authored, a data-validation query must confirm zero rows have `org_id IS NULL` or `org_id NOT IN (SELECT id FROM organizations)`. If clean, migration `0005_users_org_id_not_null.py` sets `users.org_id NOT NULL`. At the same time, `AuthUser.org_id` becomes `UUID` (non-nullable) and `get_current_user` in `deps.py` must raise `AuthError` (401) for tokens with null `org_id` — these are pre-M1 tokens that are no longer valid. This gate and migration stub must be specced in the M2 spec.

**No changes to `create_access_token` or `decode_access_token` signatures in M1.**

### JWT claim summary (post-M1)

| Claim | Type | Notes |
|---|---|---|
| `sub` | `string` (UUID) | `user.id` |
| `org_id` | `string` (UUID) or `null` | Always set after M1 registration; `null` only for M0 seed users |
| `role` | `"supplier"` \| `"agent"` \| `"admin"` | Denormalized from `User.role` |
| `exp` | Unix timestamp | `now + JWT_EXPIRES_MINUTES` |
| `iat` | Unix timestamp | Issue time |

---

## §9. Test plan

### Test setup

All M1 tests follow the M0 conftest pattern:
- Transactional rollback per test against the `lendrail_test` database with `alembic upgrade head` applied once per session.
- `db_session` fixture passed to service constructors directly (no HTTP for service-level tests).
- `client` fixture (httpx `AsyncClient` + ASGITransport) for integration/router tests.
- New fixtures needed (all `async def` — required for `asyncio_mode=auto`):

```python
@pytest.fixture
async def seed_org(db_session) -> Organization:
    """Insert a minimal Organization row for FK tests."""
    org = Organization(
        id=uuid.uuid4(), name="Test Org", jurisdiction="Delaware",
        entity_type="fund", role="supplier",
        contact_email=f"org-{uuid.uuid4()}@example.com",
        status="approved",
    )
    db_session.add(org)
    await db_session.flush()
    return org

@pytest.fixture
async def supplier_headers(client) -> dict:
    """Register a supplier and return Authorization headers."""
    resp = await client.post("/orgs/register/supplier", json={
        "name": "Test Supplier",
        "jurisdiction": "Delaware, USA",
        "entity_type": "fund",
        "contact_email": f"supplier-{uuid.uuid4()}@example.com",
        "password": "Str0ngP@ssword!1",  # 16 chars — satisfies min_length=12
    })
    assert resp.status_code == 201
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
async def agent_headers(client) -> dict:
    """Register an agent and return Authorization headers."""
    resp = await client.post("/orgs/register/agent", json={
        "name": "Test Agent",
        "jurisdiction": "Delaware, USA",
        "entity_type": "fund",
        "contact_email": f"agent-{uuid.uuid4()}@example.com",
        "password": "Str0ngP@ssword!2",  # 16 chars — satisfies min_length=12
        "ops_contact_email": f"ops-{uuid.uuid4()}@example.com",
        "regulatory_status_attested": True,
    })
    assert resp.status_code == 201
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
```

> All fixture functions are `async def` and use `await client.post(...)`. The draft's "synchronously in fixture setup via anyio" comment was incorrect in an `asyncio_mode=auto` context — it is removed.

> **Password in test fixtures:** All test passwords use 12+ characters (e.g. `"Str0ngP@ssword!1"`). No test fixture may use 8–11 character passwords — they will fail the `min_length=12` Pydantic validation and return 422.

### F-011 test cases (`tests/test_orgs.py` — migration section)

| Test | Description | Asserts |
|---|---|---|
| `test_0002_migration_applies` | Run alembic up through 0002 | `organizations` table exists; `org_role_enum`, `entity_type_enum`, `org_status_enum` types exist; `ops_contact_email` and `regulatory_status_attested` columns exist on `organizations` |
| `test_0002_downgrade` | `downgrade -1` from 0002 | `organizations` table dropped; ENUMs dropped |
| `test_org_role_enum_constraint` | Insert org with `role="invalid"` | DB raises `DataError` / `IntegrityError` |
| `test_entity_type_enum_constraint` | Insert org with `entity_type="banana"` | DB raises `DataError` |
| `test_contact_email_unique` | Insert two orgs with same `contact_email` | DB raises `IntegrityError` with unique constraint name |

### F-012 test cases (`tests/test_orgs.py` — user delta section)

| Test | Description | Asserts |
|---|---|---|
| `test_0003_migration_applies` | Run up through 0003 | `fk_users_org_id_organizations` FK exists on `users` |
| `test_0003_data_scrub` | Before running 0003, insert user with fabricated non-null org_id; then run 0003 | User row is deleted; FK added without error |
| `test_0003_downgrade` | `downgrade -1` from 0003 | FK dropped |
| `test_hash_password_returns_bcrypt` | `hash_password("strongPassword1!")` | Returns string starting with `$2b$` |
| `test_verify_password_true` | `verify_password("strongPassword1!", hash_password("strongPassword1!"))` | Returns `True` |
| `test_verify_password_false` | `verify_password("wrong", hash_password("strongPassword1!"))` | Returns `False` |
| `test_password_not_in_logs` | `hash_password("strongPassword1!")` with log capture | `"strongPassword1!"` never appears in any `LogRecord` |
| `test_user_org_fk_enforced` | Insert user with non-existent `org_id` | DB raises `IntegrityError` (`fk_users_org_id_organizations`) |
| `test_user_null_org_id_rejected_by_fk` | After 0003, attempt to insert user with `org_id=None` | Succeeds — FK allows NULL (scrub only removed rows with non-null orphaned org_id) |

### F-013 test cases (`tests/test_orgs.py`)

| Test | Description | Asserts |
|---|---|---|
| `test_supplier_register_201` | `POST /orgs/register/supplier` valid supplier payload | HTTP 201; body has `org_id` (UUID) and `access_token` (non-empty string); `token_type="bearer"` |
| `test_supplier_jwt_claims` | Decode token from registration | JWT `role="supplier"`, `org_id` matches returned `org_id`, `sub` is valid UUID |
| `test_supplier_register_no_password_in_response` | Register and inspect full response body | `"password"` key absent; `"hashed_password"` absent |
| `test_supplier_duplicate_email_409` | Register same email twice | Second call → HTTP 409; body `{"error": {"code": "duplicate_email", "message": "..."}}` |
| `test_supplier_invalid_entity_type_422` | `entity_type="banana"` | HTTP 422; body `{"error": {"code": "validation_error", ...}}` |
| `test_supplier_entity_type_agent_rejected_422` | `entity_type="agent"` | HTTP 422 — `"agent"` is not in public `EntityType` schema |
| `test_supplier_short_password_422` | `password="short12"` (< 12 chars) | HTTP 422; body `{"error": {"code": "validation_error", ...}}` |
| `test_supplier_missing_name_422` | Omit `name` field | HTTP 422 |
| `test_supplier_then_get_me` | Register supplier; call `GET /orgs/me` with returned token | HTTP 200; response `role="supplier"`, `id` matches `org_id` from registration |
| `test_supplier_org_row_created` | Register supplier; query `organizations` table directly | Row exists with correct `name`, `role="supplier"`, `status="approved"` |
| `test_supplier_user_row_created` | Register supplier; query `users` table | Row exists with `org_id` set, `hashed_password` present and non-empty, `role="supplier"` |

### F-015 test cases (`tests/test_orgs.py`)

| Test | Description | Asserts |
|---|---|---|
| `test_agent_register_201` | `POST /orgs/register/agent` valid agent payload | HTTP 201; `org_id` + `access_token` present |
| `test_agent_jwt_role` | Decode returned token | `role="agent"` |
| `test_agent_register_missing_ops_contact_422` | Omit `ops_contact_email` | HTTP 422; `{"error": {"code": "validation_error", ...}}` |
| `test_agent_register_attestation_false_422` | `regulatory_status_attested=false` | HTTP 422; `{"error": {"code": "attestation_required", "message": "..."}}` |
| `test_agent_ops_email_same_as_contact_422` | `ops_contact_email == contact_email` | HTTP 422; `{"error": {"code": "invalid_ops_email", "message": "..."}}` |
| `test_agent_duplicate_email_409` | Same email twice | HTTP 409, `code="duplicate_email"` |
| `test_agent_then_get_me` | Register agent; `GET /orgs/me` | HTTP 200; `role="agent"` |
| `test_agent_ops_contact_stored` | Register agent; query `organizations` table | `ops_contact_email` matches request value; `regulatory_status_attested=true` on the org row |
| `test_agent_short_password_422` | `password="shortpw1"` (< 12 chars) | HTTP 422 |

### F-017 test cases (`tests/test_borrowers.py`)

| Test | Description | Asserts |
|---|---|---|
| `test_0004_migration_applies` | Run up through 0004 | `borrowers` table exists; `borrower_status_enum` type exists |
| `test_0004_downgrade` | `downgrade -1` | `borrowers` table dropped; enum dropped |
| `test_borrower_status_enum_constraint` | Insert borrower with `status="invalid"` | DB raises `DataError` |
| `test_borrower_invited_by_fk` | Insert borrower with non-existent `invited_by` | DB raises `IntegrityError` |
| `test_borrower_contact_email_unique` | Insert two borrowers with same email | DB raises `IntegrityError` |
| `test_borrower_default_status_invited` | Insert borrower without `status` | `status="invited"` |

### F-018 test cases (`tests/test_borrowers.py`)

| Test | Description | Asserts |
|---|---|---|
| `test_invite_borrower_201` | Agent JWT + `POST /borrowers/invite` valid payload | HTTP 201; body `{"borrower_id": "<uuid>"}` |
| `test_invite_sets_invited_by` | Same as above; query DB | `borrowers.invited_by == agent_org_id` |
| `test_invite_default_status_invited` | Same; query DB | `borrowers.status == "invited"` |
| `test_invite_with_supplier_jwt_403` | Supplier JWT on `POST /borrowers/invite` | HTTP 403; `code="forbidden"` |
| `test_invite_with_no_token_401` | No `Authorization` header | HTTP 401 |
| `test_invite_duplicate_email_409` | Same email invited twice | HTTP 409; `code="duplicate_email"` |
| `test_invite_notification_logged` | Call invite; capture logs | `caplog` contains log entry with `borrower_invited` and the borrower email |
| `test_get_borrower_200` | Agent JWT; `GET /borrowers/{id}` (own borrower) | HTTP 200; response fields match created borrower |
| `test_get_borrower_wrong_agent_403` | Different agent org's JWT; `GET /borrowers/{id}` | HTTP 403; `code="forbidden"` |
| `test_get_borrower_not_found_404` | Valid agent JWT; random UUID | HTTP 404; `code="not_found"` |
| `test_get_borrower_supplier_jwt_403` | Supplier JWT on `GET /borrowers/{id}` | HTTP 403 |
| `test_get_borrower_no_password_in_response` | Call `GET /borrowers/{id}` | `"hashed_password"` and `"password"` absent from response |

### F-019 test cases (`tests/test_orgs.py`)

| Test | Description | Asserts |
|---|---|---|
| `test_get_me_200_supplier` | Supplier JWT on `GET /orgs/me` | HTTP 200; `role="supplier"`, `id` is UUID, no `hashed_password` |
| `test_get_me_200_agent` | Agent JWT on `GET /orgs/me` | HTTP 200; `role="agent"` |
| `test_get_me_no_token_401` | No `Authorization` header | HTTP 401 |
| `test_get_me_invalid_token_401` | Tampered token | HTTP 401 |
| `test_get_me_no_org_id_403` | M0 seed user (null org_id in JWT) | HTTP 403; `code="forbidden"` |
| `test_get_me_no_password_in_response` | Any valid JWT | Response body does not contain `"hashed_password"` or `"password"` |
| `test_get_me_fields_complete` | Supplier JWT | Response contains `id`, `name`, `jurisdiction`, `entity_type`, `role`, `contact_email`, `status`, `created_at` |

### Integration flow test (spanning F-013 + F-019)

```python
async def test_supplier_full_flow(client):
    """Register supplier → JWT → GET /orgs/me → verify round-trip."""
    reg = await client.post("/orgs/register/supplier", json={
        "name": "Acme Fund",
        "jurisdiction": "Delaware, USA",
        "entity_type": "fund",
        "contact_email": "acme@example.com",
        "password": "Acme@Str0ng!2026",  # 16 chars — satisfies min_length=12
    })
    assert reg.status_code == 201
    data = reg.json()
    token = data["access_token"]
    org_id = data["org_id"]

    me = await client.get("/orgs/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    me_data = me.json()
    assert me_data["id"] == org_id
    assert me_data["role"] == "supplier"
    assert "hashed_password" not in me_data
    assert "password" not in me_data
```

---

## §10. Open decisions — remaining items for future milestones

1. **`org_id` non-nullable timeline.** `users.org_id` remains nullable in M1. **M2 hard gate:** before any M2 migration is authored, confirm zero rows with orphaned `org_id`. Then add migration `0005_users_org_id_not_null.py` as the first M2 migration. `AuthUser.org_id` becomes `UUID` (non-nullable) at the same time; `get_current_user` must raise `AuthError` (401) for null `org_id` tokens.

2. **`User.role` denormalization.** Keep through MVP. `User.role` must equal `Organization.role` — no automated DB enforcement. Revisit before M4 (loan booking enforces agent role). If an admin can change org roles between M3 and M4, add a `role` refresh at login.

3. **`status` column on `Organization` (F-058 pre-inclusion).** Approved as specced — added in migration 0002 to avoid a one-column migration. F-058 is M1 scope per the feature index. Admin endpoints that act on `status` are separate work.

4. **Auto-approval on registration.** Keep `status="approved"` for MVP. If the product team requires admin approval before JWT is useful, `OrgService.register_*` and an org-status middleware check must be added. Pre-launch checklist item.

5. **`notifications.user_id` FK gap.** The `notifications` table has no FK from `user_id` to `users.id` (M0 design). A migration must add `REFERENCES users(id)` before F-048 (`GET /notifications`) is built. Flag in M2 scope.

6. **Email enumeration on public registration endpoints.** `POST /orgs/register/supplier` and `POST /orgs/register/agent` return 409 on duplicate email — inherent to registration flows. Rate limiting is a pre-launch production-hardening task (not M1 scope).

7. **`op.get_bind()` deprecation.** Used in migrations for ENUM `.create()` calls. Safe in the current `run_sync` Alembic context. Will require migration to the async-compatible API when upgrading to Alembic 2.x.

8. **`agent` value in `entity_type_enum` DB ENUM.** The DB ENUM retains `"agent"`. The public Pydantic schema excludes it. If future internal tooling needs to set `entity_type="agent"` for admin-created orgs, this will be handled via an internal endpoint with a broader schema — not the public registration endpoints.

---

## §11. Resolution log

This table records every review finding and the action taken. Engineers reading this spec do not need the review document — all changes are reflected in the spec above.

| # | Severity | Finding summary | Resolution |
|---|---|---|---|
| 1 | BLOCKER | Discriminated union breaks FastAPI ≤0.115 OpenAPI schema generation | **Fixed.** Removed discriminated union and shared `POST /orgs/register` endpoint entirely. Split into `POST /orgs/register/supplier` (§7.3) and `POST /orgs/register/agent` (§7.3), each with its own typed Pydantic model. `OrgRegisterRequest` union type removed from `app/schemas/orgs.py`. All acceptance criteria references updated. |
| 2 | BLOCKER | Migration 0003 FK creation fails if seed users have non-NULL orphaned `org_id` | **Fixed.** Migration 0003 `upgrade()` now: (1) `DELETE FROM users WHERE org_id IS NULL OR org_id NOT IN (SELECT id FROM organizations)`, (2) adds FK with `NOT VALID`, (3) validates with `ALTER TABLE users VALIDATE CONSTRAINT`. Documented in migration docstring (§3.3). |
| 3 | BLOCKER | `regulatory_status_attested=false` produces wrong 422 envelope via `model_validator` | **Fixed.** Removed `model_validator` from `AgentRegisterRequest`. Attestation check moved to `OrgService.register_agent`, which raises `ValidationError(code="attestation_required")`. This routes through the domain exception handler to the correct `{"error": {...}}` envelope. Additionally, a global `RequestValidationError` handler is added to `app/core/errors.py` (§7.6) that standardizes all Pydantic 422s to the same envelope (Decision 4). |
| 4 | BLOCKER | `ops_contact_email == contact_email` self-collision not guarded | **Fixed.** `OrgService.register_agent` checks `ops_contact_email == contact_email` before any DB writes and raises `ValidationError(code="invalid_ops_email", message="Ops contact email must differ from primary contact email")`. Returns 422 with correct envelope. New test case `test_agent_ops_email_same_as_contact_422` added (§9). |
| 5 | MAJOR | `supplier_headers`/`agent_headers` fixtures declared sync but must be async | **Fixed.** Both fixtures are `async def` with `await client.post(...)`. The incorrect "synchronously via anyio" comment removed. Fixture code in §9 updated. Updated endpoint paths to `/orgs/register/supplier` and `/orgs/register/agent`. |
| 6 | MAJOR | `server_default="false"` inconsistency; `User` model must be fully replaced | **Fixed.** (a) `regulatory_status_attested` uses `server_default=sa.text("false")` in both the `Organization` model (§4.1) and migration 0002 (§3.2). (b) Explicit note added in §4.2: "IMPORTANT: This is a full file replacement, not a patch." |
| 7 | MAJOR | `notifications.user_id` has no FK to `users` — latent integrity gap | **Documented.** Note added in §0 (M0 baseline audit table) and §6.2 (`BorrowerService`): `notifications.user_id` has no FK to `users` by M0 design. Migration must add `REFERENCES users(id)` before F-048. Flagged in §10 item 5. |
| 8 | MAJOR | Email enumeration surface on public registration endpoints not documented | **Documented.** Note added to §0 guiding principles and §10 item 6. Rate limiting flagged as pre-launch hardening. |
| Decision 3 (MAJOR) | MAJOR | `ops_contact_email` belongs on `Organization`, not `User` | **Applied.** `ops_contact_email` and `regulatory_status_attested` moved to `organizations` table in migration 0002 (§3.2). Removed from migration 0003. `Organization` ORM model updated (§4.1). `User` ORM model no longer has these columns (§4.2). `OrgService.register_agent` passes both fields to `orgs.create(...)` not `users.create_user(...)` (§6.1). `UserRepository.create_user` signature simplified (§5.1). Test case updated to query `organizations` table for `ops_contact_email` and `regulatory_status_attested` (§9). |
| Decision 6 (MAJOR) | MAJOR | `UserRepository` must be in `repositories/` in M1, not deferred | **Applied.** `UserRepository` moved to `app/repositories/user_repository.py` (§5.1). `auth_service.py` and `deps.py` import from new location. Directory tree updated (§2). |
| Decision 7 (MAJOR) | MAJOR | Password minimum length raised to 12 characters | **Applied.** `min_length=12` in `SupplierRegisterRequest` and `AgentRegisterRequest` (§7.1). All test fixture passwords updated to 12+ characters (e.g. `"Str0ngP@ssword!1"`). Integration flow test updated. Test cases for short password updated to note 12-char threshold. |
| Decision 8 (MAJOR) | MAJOR | `"agent"` must be removed from `EntityType` public Pydantic schema | **Applied.** `EntityType = Literal["fund", "corporate_treasury", "foundation"]` in `app/schemas/orgs.py` (§7.1). DB `entity_type_enum` retains `"agent"` value. New test `test_supplier_entity_type_agent_rejected_422` added. Note added in §3.1 and §7.1 explaining the split. |
| Decision 13 (MAJOR) | MAJOR | `structlog` vs stdlib `logging` inconsistency | **Resolved.** M1 uses stdlib `logging.getLogger` throughout, consistent with M0 implementation. `structlog` mandate removed from §0 guiding principles. All M1 service code snippets use `logging.getLogger`. |
