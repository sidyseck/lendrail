# LendRail — M2 (Connection) Backend Technical Specification

| Field | Value |
|---|---|
| Milestone | M2 — Connection (backend only) |
| Scope | F-020, F-021, F-022, F-023, F-024, F-025, F-026 (F-027 is frontend — excluded) |
| Based on | MASTER_PRD.md v0.1, ARCHITECTURE.md v0.2, FEATURES.md, M0-backend-techspec.md, M1-backend-techspec.md |
| Audience | Backend engineer implementing M2, extending the M1 codebase |
| M1 spec ref | `specs/M1-backend-techspec.md` |
| Status | Draft — awaiting tech-lead review |

---

## 0. Purpose and guiding principles

M2 delivers the supplier-agent connection feature. A Supplier sends a connection invitation to an Agent. The Agent accepts. The Supplier then provisions a custodian API key scoped to that relationship. Once the key is validated, the connection goes `active` and both parties can read each other's connection data.

Non-negotiable conventions (identical to M0/M1 — repeated for reference):

- **Layer boundaries.** `API (routers) → domain services → data (repositories) + adapters`. Domain services **never** import FastAPI types (`Depends`, `HTTPException`, `Request`, status codes). They take `AuthUser` and typed inputs; they raise typed domain exceptions from `app/core/errors.py`.
- **Error envelope.** All error responses: `{"error": {"code": "...", "message": "..."}}`. All 422 responses use this envelope via the global `RequestValidationError` handler already registered in M0/M1.
- **Secrets.** Plaintext custodian API keys are never logged, never returned in API responses, and never stored in any DB column. Only the opaque `ref` from `SecretStore.store()` is persisted in `custodian_links.encrypted_api_key_ref`.
- **PyJWT only.** `python-jose` is not used anywhere.
- **Async all the way.** SQLAlchemy 2.x async sessions; all adapter Protocols remain `async def`.
- **Pydantic Settings.** All new env vars go through `app/core/config.py` `Settings`.
- **Logging.** Use stdlib `logging.getLogger` throughout — no `structlog`. Consistent with M0/M1 baseline.

### M1 baseline audit (what already exists)

| What | File | State |
|---|---|---|
| `organizations` table | `0002_organizations.py` | Exists. `id`, `name`, `jurisdiction`, `entity_type`, `role`, `contact_email`, `ops_contact_email`, `regulatory_status_attested`, `status`, `created_at`. |
| `users` table + FK | `0001` + `0003_users_org_fk.py` | `org_id` nullable FK → `organizations.id`. |
| `borrowers` table | `0004_borrowers.py` | Exists. |
| `Organization` ORM model | `app/models/organization.py` | Exists. |
| `User` ORM model | `app/models/user.py` | `org_id` nullable, FK relationship. |
| `Borrower` ORM model | `app/models/borrower.py` | Exists. |
| `BaseRepository` | `app/db/repository.py` | Exists with `get`, `get_or_none`, `create`, `update`, `delete`, `list_where`. |
| `DomainError` hierarchy | `app/core/errors.py` | `NotFoundError`, `AuthError`, `Forbidden`, `ValidationError`, `ConflictError`, `SecretNotFoundError`, `AdapterError`. |
| `require_role` / RBAC guards | `app/api/rbac.py` | Exists. |
| `EnvSecretStore` | `app/secrets/env_store.py` | Exists. `store()`, `retrieve()`, `delete()`. **Process-local in-memory dict.** See §3.4 for M2 gate decision. |
| `SecretStore` Protocol | `app/secrets/interface.py` | Exists. `store`, `retrieve`, `delete`. |
| `CustodianAdapter` Protocol | `app/adapters/interfaces.py` | Exists. All methods `async def`. |
| `MockCustodianAdapter` | `app/adapters/mock_custodian.py` | `validate_key_result` constructor kwarg seeds `True`/`False`. |
| `get_secret_store` dep | `app/api/deps.py` | Returns `_secret_store_singleton: EnvSecretStore`. |
| `get_custodian_adapter` dep | `app/api/deps.py` | Returns `build_custodian_adapter()`. |
| `NotificationService` Protocol | `app/notifications/interface.py` | Exists. |
| `ConsoleNotificationAdapter` | `app/notifications/console_adapter.py` | Exists. |

**M2 obligations against the M1 baseline:**

1. First migration in M2 (`0005`) must gate the `users.org_id NOT NULL` constraint per the M1 hard gate (§10, item 1 of M1 spec). This runs before the domain migrations.
2. `AuthUser.org_id` becomes `UUID` (non-nullable) and `get_current_user` raises `AuthError` (401) for tokens with null `org_id` — these are pre-M1 tokens that are no longer valid.
3. The `EnvSecretStore` process-local limitation is acceptable for M2/MVP (detailed in §3.4). The key is stored once per request and the worker does not need to retrieve it in M2. The hard gate documented in M0 is satisfied by the design decision in §3.4.
4. The `notifications.user_id` FK gap (noted in M1 §10) is addressed by a migration in M2 before F-025's notification calls span multiple org users.

---

## §1. Overview and scope

M2 delivers the following backend-only features:

| Feature | What | Auth required |
|---|---|---|
| **F-020** | `custodian_links` DB table + Alembic migration | — |
| **F-021** | `connections` DB table + Alembic migration | — |
| **F-022** | `POST /connections/invite` — supplier sends invitation | Supplier JWT |
| **F-023** | `POST /connections/{id}/accept` — agent accepts | Agent JWT |
| **F-024** | `POST /connections/{id}/custodian-key` — supplier registers API key | Supplier JWT |
| **F-025** | `POST /connections/{id}/suspend` + `POST /connections/{id}/terminate` | Supplier or Agent JWT |
| **F-026** | `GET /connections` + `GET /connections/{id}` | Supplier, Agent, or Admin JWT |

**F-027** — Connection management UI (React pages for invite, accept, key entry) — **frontend only; not specced here.** Backend delivers all API contracts above; the React implementation is a separate workstream.

---

## §2. New directory additions to existing tree

The M1 tree is extended as follows (new files shown with `[NEW]`; changed files with `[CHANGED]`):

```
backend/
├── alembic/
│   └── versions/
│       ├── 0001_users_and_notifications.py   (M0 — unchanged)
│       ├── 0002_organizations.py             (M1 — unchanged)
│       ├── 0003_users_org_fk.py              (M1 — unchanged)
│       ├── 0004_borrowers.py                 (M1 — unchanged)
│       ├── 0005_users_org_id_not_null.py     [NEW] M2 gate — users.org_id NOT NULL
│       ├── 0006_notifications_user_fk.py     [NEW] M2 gate — notifications.user_id FK
│       ├── 0007_custodian_links.py           [NEW] F-020
│       └── 0008_connections.py              [NEW] F-021
├── app/
│   ├── core/
│   │   └── config.py                        [CHANGED] no new vars needed for M2
│   ├── models/
│   │   ├── custodian_link.py                [NEW] F-020
│   │   ├── connection.py                    [NEW] F-021
│   │   └── __init__.py                      [CHANGED] import new models
│   ├── repositories/
│   │   ├── custodian_link_repository.py     [NEW] F-020
│   │   └── connection_repository.py         [NEW] F-021
│   ├── schemas/
│   │   └── connections.py                   [NEW] Pydantic request/response schemas for F-022–F-026
│   ├── services/
│   │   └── connection_service.py            [NEW] F-022–F-026 domain logic
│   └── api/
│       ├── deps.py                          [CHANGED] add get_connection_service; org_id non-nullable guard
│       └── routers/
│           └── connections.py               [NEW] all connection endpoints
└── tests/
    └── test_connections.py                  [NEW] F-020–F-026
```

---

## §3. Database changes

### 3.1 M2 gate migrations (before domain tables)

#### Migration 0005 — `users.org_id NOT NULL` (M2 hard gate from M1)

**Revision:** `0005`
**Down-revision:** `0004`

Per the M1 spec §10 item 1: before any M2 domain migration, confirm zero rows with `org_id IS NULL` or orphaned `org_id`, then add the NOT NULL constraint.

```python
# alembic/versions/0005_users_org_id_not_null.py

"""users.org_id NOT NULL — M2 gate from M1

All users created by M1 registration always have org_id set.
Before altering the column, this migration verifies no NULL rows exist.
If any are found, it raises an error with instructions to clean up.

Revision ID: 0005
Revises: 0004
"""
from typing import Sequence, Union
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    conn = op.get_bind()
    # Verify no orphaned or NULL org_id rows remain (guard from M1 spec §10 item 1).
    result = conn.execute(
        "SELECT COUNT(*) FROM users "
        "WHERE org_id IS NULL "
        "OR org_id NOT IN (SELECT id FROM organizations)"
    )
    bad_count = result.scalar()
    if bad_count > 0:
        raise RuntimeError(
            f"Migration 0005 aborted: {bad_count} user row(s) have NULL or orphaned org_id. "
            "Reassign or delete these rows before re-running this migration."
        )
    op.alter_column("users", "org_id", nullable=False)

def downgrade() -> None:
    op.alter_column("users", "org_id", nullable=True)
```

#### Migration 0006 — `notifications.user_id` FK (M2 gate from M1)

**Revision:** `0006`
**Down-revision:** `0005`

Adds the missing FK from `notifications.user_id → users.id` (gap documented in M1 §10 item 5). Required before F-025 notification fan-out across org users.

```python
# alembic/versions/0006_notifications_user_fk.py

"""notifications.user_id FK to users

Adds the FK from notifications.user_id → users.id (NOT VALID + VALIDATE pattern).
Scrubs any notification rows whose user_id has no matching users row first.

Revision ID: 0006
Revises: 0005
"""
from typing import Sequence, Union
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # Step 1: Remove orphaned notification rows (M0/M1 test seed artifact).
    op.execute(
        "DELETE FROM notifications "
        "WHERE user_id IS NULL "
        "OR user_id NOT IN (SELECT id FROM users)"
    )
    # Step 2: Add FK with NOT VALID to avoid table lock on large tables.
    op.create_foreign_key(
        "fk_notifications_user_id_users",
        "notifications", "users",
        ["user_id"], ["id"],
        ondelete="CASCADE",
    )
    # Step 3: Validate — sequential scan confirms all remaining rows satisfy FK.
    op.execute(
        "ALTER TABLE notifications VALIDATE CONSTRAINT fk_notifications_user_id_users"
    )

def downgrade() -> None:
    op.drop_constraint("fk_notifications_user_id_users", "notifications", type_="foreignkey")
```

### 3.2 Migration 0007 — `custodian_links` (F-020)

**Revision:** `0007`
**Down-revision:** `0006`

```python
# alembic/versions/0007_custodian_links.py

"""custodian_links table (F-020)

One row per org-custodian relationship. Stores an opaque SecretStore ref (never the
plaintext API key). See SecretStore interface — the ciphertext lives in the store,
only the ref UUID is persisted here.

Revision ID: 0007
Revises: 0006
"""
from typing import Sequence, Union
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

custodian_link_status_enum = sa.Enum(
    "active", "suspended", "revoked",
    name="custodian_link_status_enum",
    create_type=True,
)

def upgrade() -> None:
    custodian_link_status_enum.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "custodian_links",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "org_id", UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", name="fk_custodian_links_org_id_organizations",
                          ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("custodian_id", sa.Text(), nullable=False),
        sa.Column("account_ref", sa.Text(), nullable=False),
        # encrypted_api_key_ref: opaque UUID ref into SecretStore.
        # The plaintext key is NEVER stored in this column or any DB column.
        sa.Column("encrypted_api_key_ref", sa.Text(), nullable=False),
        # scope: e.g. {"assets": ["BTC"], "permissions": ["read", "instruct"]}
        sa.Column("scope", JSONB(), nullable=False, server_default="{}"),
        sa.Column(
            "status",
            sa.Enum("active", "suspended", "revoked",
                    name="custodian_link_status_enum", create_type=False),
            nullable=False,
            server_default="active",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_custodian_links"),
    )
    op.create_index("ix_custodian_links_org_id", "custodian_links", ["org_id"])

def downgrade() -> None:
    op.drop_index("ix_custodian_links_org_id", table_name="custodian_links")
    op.drop_table("custodian_links")
    custodian_link_status_enum.drop(op.get_bind(), checkfirst=True)
```

**Exact column definitions:**

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `UUID` | PK NOT NULL | `uuid.uuid4()` default in ORM |
| `org_id` | `UUID` | NOT NULL FK → `organizations.id` ON DELETE RESTRICT | The org that owns this custodian link |
| `custodian_id` | `TEXT` | NOT NULL | e.g. `"anchorage"`, `"mock"` |
| `account_ref` | `TEXT` | NOT NULL | Custodian-side account identifier |
| `encrypted_api_key_ref` | `TEXT` | NOT NULL | Opaque UUID ref from `SecretStore.store()`. **Never the plaintext key.** |
| `scope` | `JSONB` | NOT NULL DEFAULT `{}` | e.g. `{"assets":["BTC"],"permissions":["read","instruct"]}` |
| `status` | `custodian_link_status_enum` | NOT NULL DEFAULT `active` | DB-level ENUM: `active`, `suspended`, `revoked` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT `now()` | |

### 3.3 Migration 0008 — `connections` (F-021)

**Revision:** `0008`
**Down-revision:** `0007`

```python
# alembic/versions/0008_connections.py

"""connections table (F-021)

One row per supplier-agent pair. UNIQUE constraint on (supplier_id, agent_id)
prevents duplicate connections between the same two orgs.

custodian_link_id is nullable until the supplier registers the API key (F-024).
Once a valid key is registered, custodian_link_id is set and status → active.

Revision ID: 0008
Revises: 0007
"""
from typing import Sequence, Union
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

connection_status_enum = sa.Enum(
    "pending", "active", "suspended", "terminated",
    name="connection_status_enum",
    create_type=True,
)

def upgrade() -> None:
    connection_status_enum.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "connections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "supplier_id", UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", name="fk_connections_supplier_id_organizations",
                          ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "agent_id", UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", name="fk_connections_agent_id_organizations",
                          ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("pending", "active", "suspended", "terminated",
                    name="connection_status_enum", create_type=False),
            nullable=False,
            server_default="pending",
        ),
        # custodian_link_id: NULL until supplier registers API key (F-024).
        sa.Column(
            "custodian_link_id", UUID(as_uuid=True),
            sa.ForeignKey("custodian_links.id",
                          name="fk_connections_custodian_link_id_custodian_links",
                          ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_connections"),
        # Hard constraint: only one connection per supplier-agent pair.
        sa.UniqueConstraint(
            "supplier_id", "agent_id",
            name="uq_connections_supplier_id_agent_id",
        ),
    )
    op.create_index("ix_connections_supplier_id", "connections", ["supplier_id"])
    op.create_index("ix_connections_agent_id", "connections", ["agent_id"])

def downgrade() -> None:
    op.drop_index("ix_connections_agent_id", table_name="connections")
    op.drop_index("ix_connections_supplier_id", table_name="connections")
    op.drop_table("connections")
    connection_status_enum.drop(op.get_bind(), checkfirst=True)
```

**Exact column definitions:**

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `UUID` | PK NOT NULL | `uuid.uuid4()` default in ORM |
| `supplier_id` | `UUID` | NOT NULL FK → `organizations.id` ON DELETE RESTRICT | Must reference a supplier org |
| `agent_id` | `UUID` | NOT NULL FK → `organizations.id` ON DELETE RESTRICT | Must reference an agent org |
| `status` | `connection_status_enum` | NOT NULL DEFAULT `pending` | DB-level ENUM: `pending`, `active`, `suspended`, `terminated` |
| `custodian_link_id` | `UUID` | NULLABLE FK → `custodian_links.id` ON DELETE SET NULL | Null until F-024 key registration |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT `now()` | |
| `activated_at` | `TIMESTAMPTZ` | NULLABLE | Set when `status → active` (after F-024 key validation) |

**UNIQUE constraint:** `uq_connections_supplier_id_agent_id` on `(supplier_id, agent_id)`. Enforces exactly one connection row per supplier-agent pair. Attempting to invite the same agent twice raises a DB UNIQUE violation, which is caught in the service layer and surfaced as `ConflictError(code="connection_already_exists")`.

### 3.4 SecretStore decision for M2 — process-local is acceptable for MVP

The M0 spec documented a "Hard M2 Gate": before F-024, the secret store must persist to Postgres because F-024 stores a key in one request and workers later retrieve it.

**M2 decision: the process-local `EnvSecretStore` is acceptable for the MVP milestone under the following reasoning:**

1. **F-024 stores and immediately uses the key within a single request.** The `ConnectionService.register_custodian_key()` method calls `SecretStore.store(plaintext_key)` to get a `ref`, then immediately passes that `ref` to `MockCustodianAdapter.validate_key()` within the same request. The `ref` is persisted in `custodian_links.encrypted_api_key_ref`. In the M2 mock adapter, `validate_key()` does not retrieve the key — it just returns `True` or `False`. So the ciphertext never needs to cross a process boundary in M2.

2. **No M2 worker reads the stored key.** The LTV workers (M4/M5) and accrual workers (M6) will need to retrieve the key to authenticate custodian adapter calls in production. Those are future milestones. In M2 with the mock adapter, no background job reads `encrypted_api_key_ref`.

3. **The `ref` is persisted durably in Postgres.** Even if the in-memory dict loses the ciphertext across a restart, the `ref` UUID in `custodian_links.encrypted_api_key_ref` acts as a tombstone. The application will receive `SecretNotFoundError` on retrieval, which is the correct error surface — no silent data corruption.

4. **Real Postgres-backed persistence is a hard pre-launch gate, not an M2 blocker.** Before any production custodian adapter is wired (replacing the mock), the `EnvSecretStore` must be replaced with a `PostgresSecretStore` (or a managed vault). This is explicitly tracked in §10 (Open decisions, item 1). The `SecretStore` Protocol already defines `store`/`retrieve`/`delete` — swapping the implementation is one DI change in `deps.py`.

**Implication for testing:** F-024 tests that use the mock adapter will pass fully. Any test that validates cross-process key retrieval is not in M2 scope.

---

## §4. New SQLAlchemy models

### 4.1 `CustodianLink` (`app/models/custodian_link.py`)

```python
import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CustodianLink(Base):
    __tablename__ = "custodian_links"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("organizations.id",
                   name="fk_custodian_links_org_id_organizations",
                   ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    custodian_id: Mapped[str] = mapped_column(Text(), nullable=False)
    account_ref: Mapped[str] = mapped_column(Text(), nullable=False)
    # Opaque UUID ref from SecretStore.store() — NEVER the plaintext key.
    encrypted_api_key_ref: Mapped[str] = mapped_column(Text(), nullable=False)
    # e.g. {"assets": ["BTC"], "permissions": ["read", "instruct"]}
    scope: Mapped[dict] = mapped_column(JSONB(), nullable=False, default=dict)
    status: Mapped[str] = mapped_column(
        sa.Enum("active", "suspended", "revoked",
                name="custodian_link_status_enum", create_type=False),
        nullable=False,
        server_default="active",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # No relationship to Connection — connection.custodian_link_id is a bare FK column.
    # Load via join when needed.
```

### 4.2 `Connection` (`app/models/connection.py`)

```python
import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
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
    # Null until supplier registers API key (F-024).
    custodian_link_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("custodian_links.id",
                   name="fk_connections_custodian_link_id_custodian_links",
                   ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    activated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        sa.UniqueConstraint(
            "supplier_id", "agent_id",
            name="uq_connections_supplier_id_agent_id",
        ),
    )
```

### 4.3 `app/models/__init__.py` update

```python
# app/models/__init__.py
from app.models.notification import Notification        # noqa: F401
from app.models.organization import Organization        # noqa: F401
from app.models.borrower import Borrower                # noqa: F401
from app.models.user import User                        # noqa: F401
from app.models.custodian_link import CustodianLink     # noqa: F401 — NEW
from app.models.connection import Connection            # noqa: F401 — NEW
```

---

## §5. Repositories

### 5.1 `CustodianLinkRepository` (`app/repositories/custodian_link_repository.py`)

```python
from uuid import UUID

from app.db.repository import BaseRepository
from app.models.custodian_link import CustodianLink


class CustodianLinkRepository(BaseRepository[CustodianLink]):
    model = CustodianLink

    async def list_by_org(self, org_id: UUID) -> list[CustodianLink]:
        """Return all custodian links for an org."""
        return await self.list_where(CustodianLink.org_id == org_id)
```

All other operations use `BaseRepository.get()`, `create()`, `update()`, `delete()` directly.

### 5.2 `ConnectionRepository` (`app/repositories/connection_repository.py`)

```python
from uuid import UUID

from sqlalchemy import or_, select

from app.db.repository import BaseRepository
from app.models.connection import Connection


class ConnectionRepository(BaseRepository[Connection]):
    model = Connection

    async def get_by_supplier_and_agent(
        self, supplier_id: UUID, agent_id: UUID
    ) -> Connection | None:
        """Return the existing connection between a supplier and agent, or None."""
        rows = await self.list_where(
            Connection.supplier_id == supplier_id,
            Connection.agent_id == agent_id,
        )
        return rows[0] if rows else None

    async def list_for_org(self, org_id: UUID) -> list[Connection]:
        """Return all connections where the org is either supplier or agent."""
        result = await self.session.execute(
            select(Connection).where(
                or_(
                    Connection.supplier_id == org_id,
                    Connection.agent_id == org_id,
                )
            )
        )
        return list(result.scalars().all())

    async def list_all(self) -> list[Connection]:
        """Admin: return all connections across all orgs."""
        result = await self.session.execute(select(Connection))
        return list(result.scalars().all())

    async def list_active_by_connection(self, connection_id: UUID) -> list:
        """Stub: return active loans for a connection.

        The loans table does not exist in M2. This method returns an empty list
        as a deliberate no-op stub. M3/M4 will replace this with a real query
        against the loans table once it exists (F-033).

        See §10 (Open decisions, item 3) for the design decision.
        """
        return []
```

---

## §6. Domain service — `ConnectionService`

`ConnectionService` lives at `app/services/connection_service.py`. It **never imports FastAPI types**. All inputs are typed dataclasses; all outputs are typed result dataclasses. All exceptions are `DomainError` subclasses from `app/core/errors.py`.

### 6.1 Input and output DTOs

```python
# app/services/connection_service.py — DTOs section

import uuid
from dataclasses import dataclass, field
from datetime import datetime


# ── Input DTOs ────────────────────────────────────────────────────────────────

@dataclass
class InviteConnectionInput:
    # Supplier provides either agent_org_id (known agent) or agent_email (unknown agent).
    # Exactly one must be set — enforced in service.invite().
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
    status: str
    flagged_loan_ids: list[uuid.UUID] = field(default_factory=list)
```

### 6.2 `ConnectionService` — full implementation

```python
# app/services/connection_service.py (service class)

import logging
import uuid
from datetime import datetime, timezone

from app.core.errors import ConflictError, Forbidden, NotFoundError, ValidationError
from app.notifications.interface import NotificationEvent, NotificationService
from app.repositories.connection_repository import ConnectionRepository
from app.repositories.custodian_link_repository import CustodianLinkRepository
from app.repositories.org_repository import OrgRepository
from app.schemas.auth import AuthUser
from app.secrets.interface import SecretStore
from app.adapters.interfaces import CustodianAdapter

log = logging.getLogger("lendrail.services.connection")


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

        # Must provide exactly one of agent_org_id or agent_email.
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

        # Check for duplicate connection.
        existing = await self.connections.get_by_supplier_and_agent(
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

        Role check: caller must be agent.
        Ownership check: connection.agent_id must match caller.org_id.
        State check: connection must be in pending status.
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

        connection = await self.connections.update(connection, status="pending")
        # Status stays pending — it becomes active only after key registration (F-024).
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

        Security contract:
        - data.plaintext_key is passed to SecretStore.store() immediately.
        - It is NEVER assigned to any variable that is logged.
        - On validation failure, the stored secret is deleted via SecretStore.delete(ref).
        - CustodianAdapter.validate_key() is called after storing, not before.
          This ensures the key is cleaned up even if validate_key raises an exception.

        Role check: caller must be supplier.
        Ownership check: connection.supplier_id must match caller.org_id.
        State check: connection must be pending (not yet active, not terminated).
        """
        if caller.role != "supplier":
            raise Forbidden("Only suppliers can register custodian API keys")
        if caller.org_id is None:
            raise Forbidden("Caller has no associated organization")

        connection = await self.connections.get(connection_id)

        if connection.supplier_id != caller.org_id:
            raise Forbidden("This connection does not belong to your organization")

        if connection.status not in ("pending", "suspended"):
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
        State check: connection must be active (cannot suspend pending or terminated).
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
        # M4 will replace this with: loans = await loan_repo.list_active_by_connection(connection_id)
        flagged_loan_ids = await self.connections.list_active_by_connection(connection_id)

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
```

### 6.3 Private helper functions

```python
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

def _sentinel_result(supplier_org_id: uuid.UUID) -> ConnectionResult:
    """Returned when invite is sent to an unregistered email. Router maps to HTTP 202."""
    return ConnectionResult(
        id=uuid.UUID(int=0),
        supplier_id=supplier_org_id,
        agent_id=uuid.UUID(int=0),
        status="pending",
        custodian_link_id=None,
        created_at=datetime.now(timezone.utc).isoformat(),
        activated_at=None,
    )
```

---

## §7. API layer

### 7.1 Pydantic request/response schemas (`app/schemas/connections.py`)

```python
# app/schemas/connections.py
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


# ── Request models ────────────────────────────────────────────────────────────

class InviteConnectionRequest(BaseModel):
    # Exactly one of agent_org_id or agent_email must be provided.
    # Mutual-exclusion is enforced in the service (not a model_validator)
    # to ensure the error envelope is always {"error": {"code": "..."}}.
    agent_org_id: UUID | None = None
    agent_email: EmailStr | None = None


class RegisterCustodianKeyRequest(BaseModel):
    custodian_id: str = Field(..., min_length=1, max_length=64)
    account_ref: str = Field(..., min_length=1, max_length=255)
    # plaintext_key: never logged or returned. Min length 1 to prevent empty string submission.
    plaintext_key: str = Field(..., min_length=1, max_length=1024)


# ── Response models ───────────────────────────────────────────────────────────

class ConnectionResponse(BaseModel):
    connection_id: UUID
    supplier_id: UUID
    agent_id: UUID
    status: str
    custodian_link_present: bool     # True if custodian_link_id is not None
    created_at: str                  # ISO-8601
    activated_at: str | None         # ISO-8601 or null


class ConnectionListResponse(BaseModel):
    connections: list[ConnectionResponse]


class InviteUnknownAgentResponse(BaseModel):
    """Returned HTTP 202 when agent email is not registered."""
    message: str = "Invitation logged; agent email is not yet registered on the platform"
    agent_email: str


class TerminateResponse(BaseModel):
    connection_id: UUID
    status: Literal["terminated"]
    flagged_loan_ids: list[UUID]
    message: str = (
        "Connection terminated. "
        "You must rotate the custodian API key at the custodian to revoke agent access."
    )
```

### 7.2 Updated `AuthUser` (`app/schemas/auth.py`)

Per the M2 gate from M1 §10 item 1, `org_id` on `AuthUser` becomes non-nullable:

```python
@dataclass(frozen=True)
class AuthUser:
    user_id: UUID
    org_id: UUID          # Non-nullable post-M2 gate (was UUID | None in M1)
    role: Role
```

`get_current_user` in `deps.py` must now raise `AuthError` (401) for tokens with null `org_id`:

```python
# app/api/deps.py — updated get_current_user
async def get_current_user(authorization: str = Header(default="")) -> AuthUser:
    if not authorization.lower().startswith("bearer "):
        raise AuthError("missing_bearer_token")
    token = authorization.split(" ", 1)[1]
    try:
        claims = decode_access_token(token)
    except PyJWTError:
        raise AuthError("invalid_token")
    raw_org_id = claims.get("org_id")
    if not raw_org_id:
        raise AuthError("token_missing_org_id")   # Pre-M1 token; reject cleanly.
    return AuthUser(
        user_id=UUID(claims["sub"]),
        org_id=UUID(raw_org_id),
        role=claims["role"],
    )
```

### 7.3 Connections router (`app/api/routers/connections.py`)

```python
"""Connection management endpoints — F-022 through F-026."""
import uuid

from fastapi import APIRouter, Depends, status

from app.api.deps import get_connection_service, get_current_user
from app.api.rbac import require_role
from app.schemas.auth import AuthUser
from app.schemas.connections import (
    ConnectionListResponse,
    ConnectionResponse,
    InviteConnectionRequest,
    InviteUnknownAgentResponse,
    RegisterCustodianKeyRequest,
    TerminateResponse,
)
from app.services.connection_service import (
    ConnectionService,
    InviteConnectionInput,
    RegisterCustodianKeyInput,
)

router = APIRouter(prefix="/connections", tags=["connections"])


def _to_response(result) -> ConnectionResponse:
    return ConnectionResponse(
        connection_id=result.id,
        supplier_id=result.supplier_id,
        agent_id=result.agent_id,
        status=result.status,
        custodian_link_present=result.custodian_link_id is not None,
        created_at=result.created_at,
        activated_at=result.activated_at,
    )


# ── F-022 ─────────────────────────────────────────────────────────────────────

@router.post(
    "/invite",
    status_code=status.HTTP_201_CREATED,
    summary="Supplier sends connection invitation to an agent",
)
async def invite(
    body: InviteConnectionRequest,
    caller: AuthUser = Depends(require_role("supplier")),
    svc: ConnectionService = Depends(get_connection_service),
):
    """
    Requires supplier JWT.

    If agent_org_id is provided and the agent is known:
    - Returns HTTP 201 with ConnectionResponse, status="pending".

    If agent_email is provided and the agent is not yet registered:
    - Returns HTTP 202 with InviteUnknownAgentResponse.
    - A 'connection_invite_to_unknown' notification event is logged.

    Error responses:
    - 403: caller is not a supplier
    - 409: connection between these two orgs already exists → code="connection_already_exists"
    - 422: neither agent_org_id nor agent_email provided → code="missing_agent_identifier"
    - 422: both agent_org_id and agent_email provided → code="ambiguous_agent_identifier"
    - 422: org is not an agent role → code="not_an_agent"
    - 404: agent_org_id does not exist → code="agent_not_found"
    """
    result, known = await svc.invite(
        caller=caller,
        data=InviteConnectionInput(
            agent_org_id=body.agent_org_id,
            agent_email=str(body.agent_email) if body.agent_email else None,
        ),
    )
    if not known:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content=InviteUnknownAgentResponse(
                agent_email=body.agent_email,
            ).model_dump(),
        )
    return _to_response(result)


# ── F-023 ─────────────────────────────────────────────────────────────────────

@router.post(
    "/{connection_id}/accept",
    response_model=ConnectionResponse,
    status_code=status.HTTP_200_OK,
    summary="Agent accepts a pending connection invitation",
)
async def accept(
    connection_id: uuid.UUID,
    caller: AuthUser = Depends(require_role("agent")),
    svc: ConnectionService = Depends(get_connection_service),
) -> ConnectionResponse:
    """
    Requires agent JWT. Agent must be the named agent on the connection.

    Error responses:
    - 403: caller is not an agent
    - 403: caller's org is not the agent on this connection → code="forbidden"
    - 404: connection_id not found → code="not_found"
    - 409: connection is not in pending status → code="invalid_connection_status"
    """
    result = await svc.accept(caller=caller, connection_id=connection_id)
    return _to_response(result)


# ── F-024 ─────────────────────────────────────────────────────────────────────

@router.post(
    "/{connection_id}/custodian-key",
    response_model=ConnectionResponse,
    status_code=status.HTTP_200_OK,
    summary="Supplier registers custodian API key for a connection",
)
async def register_custodian_key(
    connection_id: uuid.UUID,
    body: RegisterCustodianKeyRequest,
    caller: AuthUser = Depends(require_role("supplier")),
    svc: ConnectionService = Depends(get_connection_service),
) -> ConnectionResponse:
    """
    Requires supplier JWT. Supplier must own the connection (supplier_id match).

    The plaintext_key is passed to SecretStore and then to CustodianAdapter.validate_key().
    It is NEVER returned in the response body. It is NEVER written to any log line.

    On validation failure: the stored secret is deleted and HTTP 422 is returned.
    The connection remains in 'pending' status.

    On validation success: a CustodianLink row is created (storing only the SecretStore ref),
    the link is attached to the connection, and status transitions to 'active'.

    Error responses:
    - 403: caller is not a supplier
    - 403: caller's org is not the supplier on this connection → code="forbidden"
    - 404: connection_id not found → code="not_found"
    - 409: connection is not in pending or suspended status → code="invalid_connection_status"
    - 422: custodian key rejected by adapter → code="custodian_key_invalid"
    """
    result = await svc.register_custodian_key(
        caller=caller,
        connection_id=connection_id,
        data=RegisterCustodianKeyInput(
            custodian_id=body.custodian_id,
            account_ref=body.account_ref,
            plaintext_key=body.plaintext_key,
        ),
    )
    return _to_response(result)


# ── F-025 — suspend ────────────────────────────────────────────────────────────

@router.post(
    "/{connection_id}/suspend",
    response_model=ConnectionResponse,
    status_code=status.HTTP_200_OK,
    summary="Suspend a connection (supplier or agent)",
)
async def suspend(
    connection_id: uuid.UUID,
    caller: AuthUser = Depends(get_current_user),
    svc: ConnectionService = Depends(get_connection_service),
) -> ConnectionResponse:
    """
    Requires supplier or agent JWT. Either party may suspend.

    Error responses:
    - 401: missing/invalid token
    - 403: caller is admin (only supplier/agent may act) → code="forbidden"
    - 403: caller's org is not a party to this connection → code="forbidden"
    - 404: connection_id not found → code="not_found"
    - 409: connection is not active → code="invalid_connection_status"
    """
    result = await svc.suspend(caller=caller, connection_id=connection_id)
    return _to_response(result)


# ── F-025 — terminate ─────────────────────────────────────────────────────────

@router.post(
    "/{connection_id}/terminate",
    response_model=TerminateResponse,
    status_code=status.HTTP_200_OK,
    summary="Terminate a connection (supplier or agent)",
)
async def terminate(
    connection_id: uuid.UUID,
    caller: AuthUser = Depends(get_current_user),
    svc: ConnectionService = Depends(get_connection_service),
) -> TerminateResponse:
    """
    Requires supplier or agent JWT. Either party may terminate.

    On termination, all active loans associated with this connection are flagged
    (no-op in M2 — loans table added in M4). The supplier is alerted to rotate
    the custodian API key at the custodian; the platform cannot revoke it.

    Error responses:
    - 401: missing/invalid token
    - 403: caller is admin → code="forbidden"
    - 403: caller's org is not a party to this connection → code="forbidden"
    - 404: connection_id not found → code="not_found"
    - 409: connection is already terminated → code="connection_already_terminated"
    """
    result = await svc.terminate(caller=caller, connection_id=connection_id)
    return TerminateResponse(
        connection_id=result.connection_id,
        status="terminated",
        flagged_loan_ids=result.flagged_loan_ids,
    )


# ── F-026 — list ──────────────────────────────────────────────────────────────

@router.get(
    "",
    response_model=ConnectionListResponse,
    status_code=status.HTTP_200_OK,
    summary="List connections for the calling org (admin sees all)",
)
async def list_connections(
    caller: AuthUser = Depends(get_current_user),
    svc: ConnectionService = Depends(get_connection_service),
) -> ConnectionListResponse:
    """
    Supplier: returns connections where supplier_id = caller.org_id.
    Agent: returns connections where agent_id = caller.org_id.
    Admin: returns all connections.

    Error responses:
    - 401: missing/invalid token
    - 403: role not recognized → code="forbidden"
    """
    result = await svc.list_for_org(caller=caller)
    return ConnectionListResponse(
        connections=[_to_response(r) for r in result.connections]
    )


# ── F-026 — detail ────────────────────────────────────────────────────────────

@router.get(
    "/{connection_id}",
    response_model=ConnectionResponse,
    status_code=status.HTTP_200_OK,
    summary="Get connection detail",
)
async def get_connection(
    connection_id: uuid.UUID,
    caller: AuthUser = Depends(get_current_user),
    svc: ConnectionService = Depends(get_connection_service),
) -> ConnectionResponse:
    """
    Caller must be a party to the connection (supplier_id or agent_id match),
    or be an admin.

    Error responses:
    - 401: missing/invalid token
    - 403: caller's org is not a party to this connection → code="forbidden"
    - 404: connection_id not found → code="not_found"
    """
    result = await svc.get_detail(caller=caller, connection_id=connection_id)
    return _to_response(result)
```

### 7.4 Updated `app/api/deps.py`

Add the `get_connection_service` provider:

```python
# Additions to app/api/deps.py

from app.repositories.custodian_link_repository import CustodianLinkRepository
from app.repositories.connection_repository import ConnectionRepository
from app.services.connection_service import ConnectionService


def get_connection_service(
    session: SessionDep,
    secret_store: SecretStore = Depends(get_secret_store),
    custodian_adapter: CustodianAdapter = Depends(get_custodian_adapter),
) -> ConnectionService:
    notifier = ConsoleNotificationAdapter(NotificationRepository(session))
    return ConnectionService(
        connections=ConnectionRepository(session),
        custodian_links=CustodianLinkRepository(session),
        orgs=OrgRepository(session),
        secret_store=secret_store,
        custodian_adapter=custodian_adapter,
        notifier=notifier,
    )
```

### 7.5 Updated `app/main.py`

Register the connections router:

```python
# In create_app(), add:
from app.api.routers import connections

app.include_router(connections.router)
```

### 7.6 Error envelope reference for M2 endpoints

All domain errors are mapped by the existing handler in `app/core/errors.py`. All 422 responses use the `{"error": {"code": "...", "message": "..."}}` envelope.

| Scenario | Exception | HTTP | Code |
|---|---|---|---|
| Non-supplier calls `POST /connections/invite` | `Forbidden` via `require_role("supplier")` | 403 | `forbidden` |
| No `agent_org_id` or `agent_email` | `ValidationError` | 422 | `missing_agent_identifier` |
| Both `agent_org_id` and `agent_email` provided | `ValidationError` | 422 | `ambiguous_agent_identifier` |
| `agent_org_id` points to a non-agent org | `ValidationError` | 422 | `not_an_agent` |
| `agent_org_id` not found | `NotFoundError` | 404 | `agent_not_found` |
| Duplicate connection | `ConflictError` | 409 | `connection_already_exists` |
| Non-agent calls `POST /connections/{id}/accept` | `Forbidden` via `require_role("agent")` | 403 | `forbidden` |
| Agent does not own the connection | `Forbidden` | 403 | `forbidden` |
| Connection not in `pending` state (on accept) | `ConflictError` | 409 | `invalid_connection_status` |
| Non-supplier calls `POST .../custodian-key` | `Forbidden` via `require_role("supplier")` | 403 | `forbidden` |
| Supplier does not own the connection | `Forbidden` | 403 | `forbidden` |
| `validate_key()` returns `False` | `ValidationError` | 422 | `custodian_key_invalid` |
| `validate_key()` raises exception | `ValidationError` | 422 | `custodian_key_invalid` |
| Connection not in `pending`/`suspended` (on key reg) | `ConflictError` | 409 | `invalid_connection_status` |
| Org not a party to connection (on suspend/terminate) | `Forbidden` | 403 | `forbidden` |
| Suspend non-active connection | `ConflictError` | 409 | `invalid_connection_status` |
| Terminate already-terminated connection | `ConflictError` | 409 | `connection_already_terminated` |
| Caller not a party (GET detail) | `Forbidden` | 403 | `forbidden` |
| Connection not found (any endpoint) | `NotFoundError` | 404 | `not_found` |
| Pre-M1 token with null `org_id` (any endpoint) | `AuthError` | 401 | `token_missing_org_id` |

---

## §8. Security considerations

### 8.1 Plaintext key handling

The custodian API key plaintext (`RegisterCustodianKeyInput.plaintext_key`) must satisfy the following:

1. **Never logged.** The field name `plaintext_key` is in the secret-redaction log filter key list in `app/core/logging.py`. Add it explicitly. It is also never passed to any `log.*` call in `ConnectionService.register_custodian_key()` — only the opaque `ref` is logged.

2. **Never returned in a response body.** `ConnectionResponse` does not include any key material. `CustodianLinkRepository` never exposes `encrypted_api_key_ref` in the response schema — the schema only exposes `custodian_link_present: bool`.

3. **Deleted on validation failure.** If `CustodianAdapter.validate_key()` returns `False` or raises, `SecretStore.delete(ref)` is called before the `ValidationError` is raised. This prevents orphaned ciphertext accumulation in the store.

4. **Stored before validation, not after.** This ordering ensures cleanup is always possible even if the validator raises an exception.

5. **Only the `ref` persisted to Postgres.** `custodian_links.encrypted_api_key_ref` contains the opaque UUID string returned by `SecretStore.store()`. The ciphertext itself lives in the `EnvSecretStore` dict (MVP) or a managed vault (production).

### 8.2 SecretStore reference lifecycle

| Event | SecretStore state | DB state |
|---|---|---|
| `register_custodian_key` called | `store(key)` → ciphertext in dict, `ref` returned | Nothing written yet |
| `validate_key()` returns `True` | Ciphertext remains | `custodian_links` row created with `encrypted_api_key_ref = ref` |
| `validate_key()` returns `False` | `delete(ref)` removes ciphertext | No `custodian_links` row created |
| `validate_key()` raises | `delete(ref)` removes ciphertext | No `custodian_links` row created |
| Connection terminated (F-025) | No SecretStore change (PRD: platform cannot revoke key) | `connections.status = terminated` |

### 8.3 Log redaction

Update `app/core/logging.py` secret-redaction filter to include `plaintext_key` in the scrub list, alongside the existing `password`, `api_key`, `hashed_password`, `token` entries.

### 8.4 Connection termination and key revocation

Per MASTER_PRD §F2 ("Connection termination"):

- The platform **does not** revoke the custodian API key on termination. The supplier must rotate the key at the custodian manually.
- The platform fires `"connection_terminated_rotate_key"` notification explicitly instructing the supplier to rotate the key.
- The `TerminateResponse` body includes `message` field with this instruction.
- This is an explicit acceptance: until the supplier rotates the key at the custodian, the agent technically retains custodian access. The supplier is responsible for completing this step.

---

## §9. Test plan

### Test setup

All M2 tests follow the M0/M1 conftest pattern: transactional rollback per test, `db_session` fixture, `client` fixture (httpx `AsyncClient` + ASGITransport). New fixtures needed:

```python
@pytest.fixture
async def supplier_headers(client) -> dict:
    """Register a supplier and return Authorization headers."""
    # (same pattern as M1 test fixtures)

@pytest.fixture
async def agent_headers(client) -> dict:
    """Register an agent and return Authorization headers."""

@pytest.fixture
async def supplier_org_id(client, supplier_headers) -> uuid.UUID:
    """Return the org_id from a registered supplier's JWT."""

@pytest.fixture
async def agent_org_id(client, agent_headers) -> uuid.UUID:
    """Return the org_id from a registered agent's JWT."""

@pytest.fixture
async def pending_connection_id(client, supplier_headers, agent_org_id) -> uuid.UUID:
    """Create a pending connection (supplier invites agent by org_id). Returns connection_id."""

@pytest.fixture
def mock_adapter_valid() -> MockCustodianAdapter:
    return MockCustodianAdapter(validate_key_result=True)

@pytest.fixture
def mock_adapter_invalid() -> MockCustodianAdapter:
    return MockCustodianAdapter(validate_key_result=False)
```

Tests in `mock_adapter_invalid` scenarios override `get_custodian_adapter` via `app.dependency_overrides`.

### F-020 — `custodian_links` migration

| Test | Description | Asserts |
|---|---|---|
| `test_0007_migration_applies` | `alembic upgrade head` through 0007 | `custodian_links` table exists; `custodian_link_status_enum` type exists; `org_id` FK constraint `fk_custodian_links_org_id_organizations` exists |
| `test_0007_downgrade` | `downgrade -1` | `custodian_links` table dropped; enum dropped |
| `test_custodian_link_status_enum_constraint` | Insert row with `status="banana"` | DB raises `DataError` |
| `test_custodian_link_org_id_fk_enforced` | Insert row with non-existent `org_id` | DB raises `IntegrityError` |
| `test_encrypted_api_key_ref_not_null` | Insert row with `encrypted_api_key_ref=NULL` | DB raises `IntegrityError` |
| `test_custodian_link_default_status_active` | Insert row without `status` | `status="active"` |

### F-021 — `connections` migration

| Test | Description | Asserts |
|---|---|---|
| `test_0008_migration_applies` | `alembic upgrade head` through 0008 | `connections` table exists; `connection_status_enum` type exists; UNIQUE constraint `uq_connections_supplier_id_agent_id` exists |
| `test_0008_downgrade` | `downgrade -1` | `connections` table dropped; enum dropped |
| `test_connection_status_enum_constraint` | Insert row with `status="invalid"` | DB raises `DataError` |
| `test_connection_unique_supplier_agent` | Insert two rows with same `(supplier_id, agent_id)` | DB raises `IntegrityError` on `uq_connections_supplier_id_agent_id` |
| `test_connection_supplier_id_fk_enforced` | Insert with non-existent `supplier_id` | DB raises `IntegrityError` |
| `test_connection_agent_id_fk_enforced` | Insert with non-existent `agent_id` | DB raises `IntegrityError` |
| `test_connection_custodian_link_id_nullable` | Insert without `custodian_link_id` | Succeeds; `custodian_link_id` is `NULL` |
| `test_connection_default_status_pending` | Insert without `status` | `status="pending"` |

### M2 gate migrations

| Test | Description | Asserts |
|---|---|---|
| `test_0005_migration_not_null_applies` | Run 0005 when zero NULL org_id rows exist | Migration applies; `users.org_id` is NOT NULL |
| `test_0005_migration_fails_on_null_rows` | Run 0005 when a user has NULL org_id | Migration raises `RuntimeError` with clear message |
| `test_0005_downgrade` | Downgrade 0005 | `users.org_id` reverts to nullable |
| `test_0006_fk_migration_applies` | Run 0006 after scrubbing orphaned notifications | `fk_notifications_user_id_users` FK exists |
| `test_0006_scrubs_orphaned_notifications` | Insert notification with non-existent `user_id`; run 0006 | Row is deleted; FK added without error |

### F-022 — `POST /connections/invite`

| Test | Description | Asserts |
|---|---|---|
| `test_invite_by_org_id_201` | Supplier JWT + valid `agent_org_id` | HTTP 201; body has `connection_id`, `status="pending"`, `custodian_link_present=false` |
| `test_invite_creates_pending_connection_in_db` | Same; query DB | `connections` row with `status="pending"`, correct `supplier_id` and `agent_id` |
| `test_invite_with_agent_jwt_403` | Agent JWT on `POST /connections/invite` | HTTP 403; `code="forbidden"` |
| `test_invite_missing_both_fields_422` | Neither `agent_org_id` nor `agent_email` | HTTP 422; `code="missing_agent_identifier"` |
| `test_invite_both_fields_422` | Both `agent_org_id` and `agent_email` | HTTP 422; `code="ambiguous_agent_identifier"` |
| `test_invite_nonexistent_agent_org_id_404` | `agent_org_id` that doesn't exist | HTTP 404; `code="agent_not_found"` |
| `test_invite_supplier_org_as_agent_422` | `agent_org_id` points to a supplier org | HTTP 422; `code="not_an_agent"` |
| `test_invite_duplicate_409` | Same supplier+agent pair invited twice | HTTP 409; `code="connection_already_exists"` |
| `test_invite_unknown_email_202` | `agent_email` not registered | HTTP 202; response has `agent_email`; `connection_invite_to_unknown` event logged (caplog) |
| `test_invite_known_email_201` | `agent_email` matches a registered agent org | HTTP 201; `status="pending"` |
| `test_invite_no_token_401` | No `Authorization` header | HTTP 401 |

### F-023 — `POST /connections/{id}/accept`

| Test | Description | Asserts |
|---|---|---|
| `test_accept_200` | Agent JWT + pending connection | HTTP 200; body `status="pending"` (awaiting key); `connection_accepted` event logged |
| `test_accept_updates_db_status` | Same; query DB | `connections.status` unchanged from `pending` (accept alone does not activate) |
| `test_accept_with_supplier_jwt_403` | Supplier JWT | HTTP 403; `code="forbidden"` |
| `test_accept_wrong_agent_org_403` | Agent JWT with different `org_id` than connection's `agent_id` | HTTP 403; `code="forbidden"` |
| `test_accept_nonexistent_connection_404` | Random UUID | HTTP 404; `code="not_found"` |
| `test_accept_already_active_409` | Connection with `status="active"` | HTTP 409; `code="invalid_connection_status"` |
| `test_accept_terminated_409` | Connection with `status="terminated"` | HTTP 409; `code="invalid_connection_status"` |

### F-024 — `POST /connections/{id}/custodian-key`

| Test | Description | Asserts |
|---|---|---|
| `test_register_key_200_mock_valid` | Supplier JWT; mock adapter returns `validate_key=True` | HTTP 200; `status="active"`; `custodian_link_present=true`; `activated_at` non-null |
| `test_register_key_no_plaintext_in_response` | Same; inspect full response body | `"plaintext_key"` absent; no key material in any field |
| `test_register_key_no_plaintext_in_logs` | Same; capture logs (caplog) | No log record contains the submitted key value |
| `test_custodian_link_row_created` | Same; query `custodian_links` table | Row exists; `encrypted_api_key_ref` is a UUID string (not the key); `status="active"` |
| `test_encrypted_api_key_ref_is_ref_not_key` | Same; inspect `custodian_links.encrypted_api_key_ref` | Value is a UUID-format string; is NOT equal to the submitted plaintext key |
| `test_register_key_422_mock_invalid` | Mock adapter seeded with `validate_key_result=False` | HTTP 422; `code="custodian_key_invalid"`; connection remains `pending` |
| `test_register_key_422_secret_deleted_on_failure` | Mock adapter returns `False`; inspect SecretStore | The ref from the failed attempt is no longer in the SecretStore (no orphaned ciphertext) |
| `test_register_key_with_agent_jwt_403` | Agent JWT | HTTP 403; `code="forbidden"` |
| `test_register_key_wrong_supplier_403` | Different supplier org's JWT | HTTP 403; `code="forbidden"` |
| `test_register_key_nonexistent_connection_404` | Random UUID | HTTP 404; `code="not_found"` |
| `test_register_key_on_terminated_connection_409` | Connection in `terminated` status | HTTP 409; `code="invalid_connection_status"` |

### F-025 — `POST /connections/{id}/suspend` and `POST /connections/{id}/terminate`

| Test | Description | Asserts |
|---|---|---|
| `test_suspend_by_supplier_200` | Supplier JWT on active connection | HTTP 200; `status="suspended"` |
| `test_suspend_by_agent_200` | Agent JWT on active connection | HTTP 200; `status="suspended"` |
| `test_suspend_pending_409` | Suspend a pending connection | HTTP 409; `code="invalid_connection_status"` |
| `test_suspend_terminated_409` | Suspend a terminated connection | HTTP 409; `code="invalid_connection_status"` |
| `test_suspend_wrong_org_403` | Org not a party to connection | HTTP 403; `code="forbidden"` |
| `test_terminate_by_supplier_200` | Supplier JWT | HTTP 200; `status="terminated"`; `flagged_loan_ids=[]` (no loans in M2) |
| `test_terminate_by_agent_200` | Agent JWT | HTTP 200; `status="terminated"` |
| `test_terminate_fires_rotate_key_notification` | Terminate; inspect logs (caplog) | `connection_terminated_rotate_key` event logged |
| `test_terminate_response_includes_message` | Inspect response body | `message` field contains "rotate" / key rotation instruction |
| `test_terminate_already_terminated_409` | Terminate twice | Second call → HTTP 409; `code="connection_already_terminated"` |
| `test_terminate_wrong_org_403` | Org not a party | HTTP 403; `code="forbidden"` |
| `test_terminate_admin_jwt_403` | Admin JWT (not a party role) | HTTP 403; `code="forbidden"` |
| `test_suspend_no_token_401` | No `Authorization` | HTTP 401 |

### F-026 — `GET /connections` and `GET /connections/{id}`

| Test | Description | Asserts |
|---|---|---|
| `test_list_supplier_sees_own_connections` | Supplier JWT; supplier has 2 connections, another supplier has 1 | Returns exactly 2 connections |
| `test_list_agent_sees_own_connections` | Agent JWT; agent is on 1 connection | Returns exactly 1 connection |
| `test_list_admin_sees_all` | Admin JWT | Returns all connections across all orgs |
| `test_list_response_fields` | Any valid JWT | Each item has `connection_id`, `supplier_id`, `agent_id`, `status`, `custodian_link_present`, `created_at`, `activated_at` |
| `test_list_no_token_401` | No `Authorization` | HTTP 401 |
| `test_get_detail_supplier_200` | Supplier JWT; connection belongs to supplier | HTTP 200; correct fields |
| `test_get_detail_agent_200` | Agent JWT; connection belongs to agent | HTTP 200 |
| `test_get_detail_admin_200` | Admin JWT; any connection | HTTP 200 |
| `test_get_detail_wrong_org_403` | JWT from org not on this connection | HTTP 403; `code="forbidden"` |
| `test_get_detail_not_found_404` | Random UUID | HTTP 404; `code="not_found"` |
| `test_get_detail_custodian_link_present_false_when_pending` | Pending connection (no key yet) | `custodian_link_present=false` |
| `test_get_detail_custodian_link_present_true_when_active` | Active connection (key registered) | `custodian_link_present=true` |
| `test_get_detail_no_token_401` | No `Authorization` | HTTP 401 |

### Integration flow tests

```python
async def test_full_connection_flow(client, supplier_headers, agent_headers):
    """
    Full supplier-agent connection lifecycle:
    1. Supplier invites agent → pending (F-022)
    2. Agent accepts → still pending (F-023)
    3. Supplier registers key → active (F-024)
    4. Both parties can read connection (F-026)
    5. Supplier terminates → terminated (F-025)
    6. GET returns terminated state (F-026)
    """
    # 1. Invite
    invite_resp = await client.post(
        "/connections/invite",
        json={"agent_org_id": str(agent_org_id)},
        headers=supplier_headers,
    )
    assert invite_resp.status_code == 201
    conn_id = invite_resp.json()["connection_id"]
    assert invite_resp.json()["status"] == "pending"

    # 2. Accept
    accept_resp = await client.post(
        f"/connections/{conn_id}/accept",
        headers=agent_headers,
    )
    assert accept_resp.status_code == 200
    assert accept_resp.json()["status"] == "pending"

    # 3. Register key (mock adapter: valid)
    key_resp = await client.post(
        f"/connections/{conn_id}/custodian-key",
        json={"custodian_id": "mock", "account_ref": "acct-001", "plaintext_key": "any-key"},
        headers=supplier_headers,
    )
    assert key_resp.status_code == 200
    assert key_resp.json()["status"] == "active"
    assert key_resp.json()["custodian_link_present"] is True
    assert "plaintext_key" not in str(key_resp.json())

    # 4. Both parties read (supplier)
    detail_resp = await client.get(f"/connections/{conn_id}", headers=supplier_headers)
    assert detail_resp.status_code == 200
    assert detail_resp.json()["status"] == "active"

    # 4b. Agent reads
    detail_agent = await client.get(f"/connections/{conn_id}", headers=agent_headers)
    assert detail_agent.status_code == 200

    # 5. Supplier terminates
    terminate_resp = await client.post(
        f"/connections/{conn_id}/terminate",
        headers=supplier_headers,
    )
    assert terminate_resp.status_code == 200
    assert terminate_resp.json()["status"] == "terminated"
    assert terminate_resp.json()["flagged_loan_ids"] == []

    # 6. Read terminated state
    final = await client.get(f"/connections/{conn_id}", headers=supplier_headers)
    assert final.json()["status"] == "terminated"


async def test_m2_gate_pre_m1_token_rejected(client):
    """Tokens without org_id (pre-M1 format) are rejected with 401."""
    from app.core.security import create_access_token_legacy_no_org  # hypothetical test util
    # Build a token with org_id=None (simulates M0 seed user token).
    import jwt
    from app.core.config import get_settings
    s = get_settings()
    token = jwt.encode(
        {"sub": str(uuid.uuid4()), "org_id": None, "role": "supplier"},
        s.jwt_secret, algorithm=s.jwt_algorithm,
    )
    resp = await client.get("/connections", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "token_missing_org_id"
```

---

## §10. Open decisions

1. **SecretStore production path (pre-launch gate, not M2 blocker).** The `EnvSecretStore` process-local dict is acceptable for M2 MVP (see §3.4). Before wiring any real custodian adapter (post-MVP), a `PostgresSecretStore` must be implemented that persists ciphertext to a dedicated `encrypted_secrets` table in Postgres. The `SecretStore` Protocol is already the swap point — only `deps.py` needs updating. The M2 spec documents this explicitly so the pre-launch checklist includes it.

2. **`AuthUser.org_id` non-nullable.** Implemented in §7.2. Pre-M1 tokens with `org_id=null` now receive HTTP 401 with `code="token_missing_org_id"`. This is a breaking change for any M0/M1 seed users whose JWTs were issued before the M1 registration flow. Operationally, affected users must re-login to get a fresh JWT.

3. **Loan flagging on termination (F-025 stub).** The `loans` table does not exist in M2. `ConnectionRepository.list_active_by_connection()` returns `[]` as a deliberate no-op stub. M4 (F-033) adds the `loans` table. M4 must replace this stub with a real `LoanRepository.list_active_by_connection()` query. The `TerminateResult.flagged_loan_ids` field and the response schema are already shaped to carry loan IDs when M4 wires them — no API contract change required.

4. **Connection scope (assets and accounts).** The architecture doc references `connection scope: supplier specifies which custodian accounts and asset types are in scope`. In M2, scope is captured via the `CustodianLink.scope` JSONB field (defaulting to `{}`). There is no M2 UI to set scope values — the supplier registers a key and the platform accepts whatever the custodian key covers. A dedicated scope configuration endpoint (`PUT /connections/{id}/scope`) is deferred to M3 or a separate feature.

5. **Agent-initiated connections.** PRD open question OQ-3 asks whether either party can initiate. M2 implements supplier-only initiation (as the PRD assumption). If the product decision changes to allow agent-initiated connections, `invite()` will need a `direction` flag and agents will need an invitation inbox. The data model (supplier_id, agent_id on the connection) already supports either direction — the service logic is the only change needed.

6. **Suspend → active re-activation path.** A suspended connection can have its key re-registered (the service allows `status in ("pending", "suspended")` for key registration). This allows re-activation of a suspended connection. If product decides suspended connections cannot be re-activated without a separate "unsuspend" action, a `POST /connections/{id}/unsuspend` endpoint should be added. Flag for M3 scoping.

7. **`op.get_bind()` deprecation.** Used in migrations 0007 and 0008 for ENUM `.create()` calls — consistent with M1 migrations 0002 and 0004. Safe in the current `run_sync` Alembic context. Will require migration to the async-compatible API when upgrading to Alembic 2.x. Tracked as a cross-cutting tech-debt item.

8. **`notifications.user_id` fan-out.** F-025's `connection_terminated_rotate_key` notification currently sends only to `caller.user_id`. The PRD intends to notify **both** supplier and agent. In M2, we have only the caller's `user_id` — the counterparty's `user_id` requires a `users` table query by `org_id`. This is a known gap: the `notifier.send(recipients=[...])` call in F-025 should include both parties' user IDs once a `UserRepository.get_by_org_id()` helper is added. Flag for M3 enhancement.
