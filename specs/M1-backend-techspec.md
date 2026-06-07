# LendRail — M1 (Onboarding) Backend Technical Specification

| Field | Value |
|---|---|
| Milestone | M1 — Onboarding (backend only) |
| Scope | F-011, F-012, F-013, F-015, F-017, F-018, F-019 (F-014, F-016 are frontend — excluded) |
| Based on | MASTER_PRD.md v0.1, ARCHITECTURE.md v0.2, FEATURES.md, M0-backend-techspec.md |
| Audience | Backend engineer implementing M1, extending the M0 codebase |
| M0 spec ref | `specs/M0-backend-techspec.md` |

---

## 0. Purpose and guiding principles

M1 adds the onboarding layer: organizations (Supplier and Agent), the full user–org relationship, and Borrower management. At the end of M1, a Supplier or Agent can register via a single public endpoint, receive a JWT, and immediately call `GET /orgs/me`. An Agent can invite Borrowers. The system becomes a multi-tenant application for the first time.

Non-negotiable conventions (identical to M0 — repeated for reference):

- **Layer boundaries.** `API (routers) → domain services → data (repositories)`. Domain services **never** import FastAPI types (`Depends`, `HTTPException`, `Request`, status codes). They take `AuthUser` and typed inputs; they raise typed domain exceptions from `app/core/errors.py`.
- **Error envelope.** All error responses: `{"error": {"code": "...", "message": "..."}}`.
- **Secrets.** Password never returned in any API response or logged. The secret-redaction log filter (`app/core/logging.py`) is the backstop; do not rely on it as the primary guard.
- **PyJWT only.** `python-jose` is not used anywhere.
- **Async all the way.** SQLAlchemy 2.x async sessions; all adapter Protocols remain `async def`.
- **Pydantic Settings.** All env vars go through `app/core/config.py` `Settings`.
- **structlog.** Use `get_logger` from `app/core/logging.py` everywhere — never bare `logging.getLogger`.

### M0 baseline audit (what already exists)

Before speccing new things, here is what M0 actually shipped:

| What | File | State |
|---|---|---|
| `users` table | `alembic/versions/0001_users_and_notifications.py` | Exists. Has `id`, `org_id` (nullable, no FK), `email`, `hashed_password`, `role`, `created_at`. No FK to `organizations` yet. |
| `notifications` table | same migration | Exists. |
| `User` ORM model | `app/models/user.py` | Exists. `org_id` is `nullable=True`, no FK relationship. |
| `hash_password` / `verify_password` | `app/core/security.py` | Exists (`passlib` + `bcrypt`). |
| `verify_password_safe` (constant-time) | `app/core/security.py` | Exists. |
| `AuthUser` dataclass | `app/schemas/auth.py` | Exists. `org_id: UUID | None`. |
| `BaseRepository` | `app/db/repository.py` | Exists with `get`, `get_or_none`, `create`, `update`, `delete`, `list_where`. |
| `DomainError` hierarchy | `app/core/errors.py` | Exists: `NotFoundError`, `AuthError`, `Forbidden`, `ValidationError`, `ConflictError`, `SecretNotFoundError`, `AdapterError`. |
| `require_role` / RBAC guards | `app/api/rbac.py` | Exists. |
| `NotificationService` Protocol | `app/notifications/interface.py` | Exists. |
| `ConsoleNotificationAdapter` | `app/notifications/console_adapter.py` | Exists. |

**M1 obligations against the M0 baseline:**

1. `organizations` table must be created (F-011) before the users FK can be added.
2. A new migration (F-012 delta) must `ALTER TABLE users ADD CONSTRAINT fk_users_org_id_organizations FOREIGN KEY (org_id) REFERENCES organizations(id)` and add `ops_contact_email` column to `users` for agents.
3. `User.role` remains on the `User` model (denormalized from `Organization.role`) — this was the M0 decision. It stays in M1 for JWT issuance simplicity; tech-lead flagged for review in §10.

---

## §1. Overview and scope

M1 delivers the following backend-only features:

| Feature | What | Public? |
|---|---|---|
| **F-011** | `organizations` DB table + Alembic migration | — |
| **F-012** | `users` FK migration + `ops_contact_email` column + password utility audit | — |
| **F-013** | `POST /orgs/register` with `role=supplier` | Yes (unauthenticated) |
| **F-015** | `POST /orgs/register` with `role=agent` | Yes (unauthenticated) |
| **F-017** | `borrowers` DB table + Alembic migration | — |
| **F-018** | `POST /borrowers/invite` (agent-only) + `GET /borrowers/{id}` | Agent JWT |
| **F-019** | `GET /orgs/me` | Any valid JWT |

F-013 and F-015 share a single endpoint (`POST /orgs/register`). Role is determined by the `role` field in the request body. The endpoint is role-dispatched inside `OrgService`.

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
│       ├── 0003_users_org_fk_and_agent_fields.py [NEW] F-012 delta
│       └── 0004_borrowers.py                     [NEW] F-017
├── app/
│   ├── main.py                                   [CHANGED] include orgs + borrowers routers
│   ├── core/
│   │   └── config.py                             [CHANGED] no new env vars needed for M1
│   ├── models/
│   │   ├── user.py                               [CHANGED] add FK relationship, ops_contact_email
│   │   ├── organization.py                       [NEW] F-011
│   │   └── borrower.py                           [NEW] F-017
│   ├── schemas/
│   │   ├── auth.py                               [CHANGED] org_id now non-nullable post-registration
│   │   ├── orgs.py                               [NEW] request/response models for F-013, F-015, F-019
│   │   └── borrowers.py                          [NEW] request/response models for F-018
│   ├── services/
│   │   ├── auth_service.py                       [CHANGED] UserRepository moved here gains create_user
│   │   ├── org_service.py                        [NEW] F-013, F-015, F-019
│   │   └── borrower_service.py                   [NEW] F-018
│   ├── repositories/
│   │   ├── __init__.py                           [NEW] package
│   │   ├── org_repository.py                     [NEW] F-011/F-013/F-015/F-019
│   │   └── borrower_repository.py                [NEW] F-017/F-018
│   └── api/
│       ├── deps.py                               [CHANGED] add get_org_service, get_borrower_service
│       └── routers/
│           ├── orgs.py                           [NEW] POST /orgs/register, GET /orgs/me
│           └── borrowers.py                      [NEW] POST /borrowers/invite, GET /borrowers/{id}
└── tests/
    ├── test_orgs.py                              [NEW] F-011, F-013, F-015, F-019
    └── test_borrowers.py                         [NEW] F-017, F-018
```

> **Repository package note:** M0 put `UserRepository` inside `app/services/auth_service.py` as a co-located class. For M1, new repositories (`OrgRepository`, `BorrowerRepository`) go into a dedicated `app/repositories/` package. `UserRepository` stays in `auth_service.py` for M0 backwards-compat but gains a `create_user` method. A future cleanup can consolidate all repositories — flag in §10.

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

**`borrower_status_enum`** (created in migration `0004`):
```sql
CREATE TYPE borrower_status_enum AS ENUM ('invited', 'active');
```

> ENUMs are created with `sa.Enum(..., name="...", create_type=True)` in `op.create_table` calls, which emits `CREATE TYPE` before the table DDL. Downgrade drops the table first, then the type.

### 3.2 Migration 0002 — `organizations` (F-011)

**Revision:** `0002`
**Down-revision:** `0001`
**Depends on:** `0001` (users + notifications must exist first, even though organizations does not reference users — because the FK in 0003 runs after both)

```python
# alembic/versions/0002_organizations.py

"""organizations table

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
| `entity_type` | `entity_type_enum` | NOT NULL | DB-level ENUM enforcement |
| `role` | `org_role_enum` | NOT NULL | DB-level ENUM enforcement |
| `contact_email` | `VARCHAR(320)` | NOT NULL UNIQUE | Primary contact email; also the login email for the first user |
| `status` | `org_status_enum` | NOT NULL DEFAULT `pending_review` | For F-058 admin approval flow |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT `now()` | |

> **`status` column justification:** F-058 (admin org approval, also M1 per the feature index) requires `approved` / `rejected` states. Adding `status` here in the same migration avoids a 5th migration just for F-058 DDL. The enum has three values: `pending_review` (default on creation), `approved`, `rejected`. In MVP orgs are auto-approved (OrgService sets `status=approved` immediately on registration); the field exists for F-058's manual override.

> **`ops_contact_email` on `Organization` vs `User`:** The F-015 feature requires an `ops_contact_email` for agents. After review this belongs on the `User` model (as the second user of the org) rather than on `Organization`, because it represents a person, not the org entity. See §4 and migration 0003 for the column placement decision. Flag in §10 if tech lead prefers it on the org.

### 3.3 Migration 0003 — users FK + agent fields (F-012 delta)

**What already exists in M0:** The `users` table with `id`, `org_id` (nullable UUID, no FK), `email`, `hashed_password`, `role`, `created_at`.

**What M1 adds:**

1. FK constraint from `users.org_id → organizations.id`.
2. `ops_contact_email` column on `users` (nullable — only populated for agent users).

```python
# alembic/versions/0003_users_org_fk_and_agent_fields.py

"""users org FK and agent fields

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
    # Add ops_contact_email to users (agent-only; nullable for supplier users)
    op.add_column(
        "users",
        sa.Column("ops_contact_email", sa.String(320), nullable=True),
    )
    # Add regulatory_status_attested to users (agent registration requirement)
    op.add_column(
        "users",
        sa.Column(
            "regulatory_status_attested",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    # Add FK from users.org_id → organizations.id
    # Existing rows have org_id=NULL (M0 seed users); FK allows NULL so they remain valid.
    op.create_foreign_key(
        "fk_users_org_id_organizations",
        "users",
        "organizations",
        ["org_id"],
        ["id"],
        ondelete="RESTRICT",
    )

def downgrade() -> None:
    op.drop_constraint("fk_users_org_id_organizations", "users", type_="foreignkey")
    op.drop_column("users", "regulatory_status_attested")
    op.drop_column("users", "ops_contact_email")
```

**Full `users` column set after 0001 + 0003:**

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `UUID` | PK NOT NULL | |
| `org_id` | `UUID` | NULLABLE FK → `organizations.id` ON DELETE RESTRICT | Null for M0 seed users; always set post-M1 registration |
| `email` | `VARCHAR(320)` | NOT NULL UNIQUE INDEX | Login email |
| `hashed_password` | `VARCHAR(255)` | NOT NULL | bcrypt hash; never returned in API |
| `role` | `VARCHAR(16)` | NOT NULL DEFAULT `supplier` | Denormalized from org role for JWT issuance |
| `ops_contact_email` | `VARCHAR(320)` | NULLABLE | Set for agent users only |
| `regulatory_status_attested` | `BOOLEAN` | NOT NULL DEFAULT `false` | Set `true` on agent registration |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT `now()` | |

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

```python
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy import String, Text, DateTime, func
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
    users: Mapped[list["User"]] = relationship("User", back_populates="org", lazy="noload")
```

> `lazy="noload"` prevents accidental N+1 lazy-loads in async context. Relationships must be explicitly loaded via `selectinload` or `joinedload` when needed.

### 4.2 Updated `User` (`app/models/user.py`)

Changes from M0: add `ops_contact_email`, `regulatory_status_attested`, FK relationship to `Organization`.

```python
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
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
        nullable=True,  # Nullable for M0 seed users; always set post-M1 registration
    )
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, server_default="supplier")
    ops_contact_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    regulatory_status_attested: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationship
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

## §5. New repositories

Repository classes extend `BaseRepository[T]` from `app/db/repository.py`. All methods are `async`. No raw SQL — only SQLAlchemy ORM expressions.

### 5.1 `OrgRepository` (`app/repositories/org_repository.py`)

```python
from uuid import UUID

from sqlalchemy import select

from app.db.repository import BaseRepository
from app.models.organization import Organization


class OrgRepository(BaseRepository[Organization]):
    model = Organization

    async def get_by_contact_email(self, email: str) -> Organization | None:
        """Return the org whose contact_email matches, or None."""
        rows = await self.list_where(Organization.contact_email == email)
        return rows[0] if rows else None

    async def get_by_id(self, org_id: UUID) -> Organization:
        """Alias for BaseRepository.get with typed return. Raises NotFoundError."""
        return await self.get(org_id)

    async def list_all(self) -> list[Organization]:
        """Return all orgs. Used by F-058 admin endpoint."""
        result = await self.session.execute(select(Organization))
        return list(result.scalars().all())
```

### 5.2 `BorrowerRepository` (`app/repositories/borrower_repository.py`)

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

### 5.3 `UserRepository` update (`app/services/auth_service.py`)

`UserRepository` gains a `create_user` method needed by `OrgService` during registration:

```python
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
        ops_contact_email: str | None = None,
        regulatory_status_attested: bool = False,
    ) -> User:
        return await self.create(
            org_id=org_id,
            email=email,
            hashed_password=hashed_password,
            role=role,
            ops_contact_email=ops_contact_email,
            regulatory_status_attested=regulatory_status_attested,
        )
```

---

## §6. Domain services

**Hard constraint:** domain services never import from `fastapi`. They raise `DomainError` subclasses from `app/core/errors.py`. They receive `AuthUser` from the API layer and typed DTO inputs.

### 6.1 `OrgService` (`app/services/org_service.py`)

```python
"""OrgService — domain service for org registration and lookup. No FastAPI imports."""
import uuid
from dataclasses import dataclass
from typing import Literal

from app.core.errors import ConflictError, Forbidden, NotFoundError, ValidationError
from app.core.logging import get_logger
from app.core.security import hash_password
from app.core.security import create_access_token
from app.models.organization import Organization
from app.repositories.org_repository import OrgRepository
from app.schemas.auth import AuthUser
from app.services.auth_service import UserRepository

log = get_logger("lendrail.services.org")

# ── Input DTOs (plain dataclasses — no FastAPI types) ─────────────────────────

@dataclass
class SupplierRegistrationInput:
    name: str
    jurisdiction: str
    entity_type: str          # validated against ENUM before reaching service
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
        log.info("org_created", org_id=str(org.id), role="supplier")

        user = await self.users.create_user(
            org_id=org.id,
            email=data.contact_email,
            hashed_password=hash_password(data.password),
            role="supplier",
        )
        log.info("user_created", user_id=str(user.id), org_id=str(org.id))
        # password is NOT logged — hash_password result is not a secret but raw password
        # must never be passed to log. This is guaranteed by only logging IDs here.

        token = create_access_token(
            user_id=str(user.id),
            org_id=str(org.id),
            role="supplier",
        )
        return RegistrationResult(org_id=org.id, access_token=token)

    async def register_agent(self, data: AgentRegistrationInput) -> RegistrationResult:
        """Create an Organization with role=agent and its first User."""
        if not data.regulatory_status_attested:
            raise ValidationError(
                "Regulatory status attestation is required for agent registration",
                code="attestation_required",
            )

        await self._assert_email_unique(data.contact_email)

        org = await self.orgs.create(
            id=uuid.uuid4(),
            name=data.name,
            jurisdiction=data.jurisdiction,
            entity_type=data.entity_type,
            role="agent",
            contact_email=data.contact_email,
            status="approved",
        )
        log.info("org_created", org_id=str(org.id), role="agent")

        user = await self.users.create_user(
            org_id=org.id,
            email=data.contact_email,
            hashed_password=hash_password(data.password),
            role="agent",
            ops_contact_email=data.ops_contact_email,
            regulatory_status_attested=True,
        )
        log.info("user_created", user_id=str(user.id), org_id=str(org.id))

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
        org = await self.orgs.get_by_id(caller.org_id)   # raises NotFoundError if missing
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
        # Also check users table — an email may exist as a user without an org (M0 seed)
        existing_user = await self.users.get_by_email(email)
        if existing_user is not None:
            raise ConflictError(
                f"A user with email '{email}' already exists",
                code="duplicate_email",
            )
```

> **Password never logged:** `hash_password(data.password)` is called inline as an argument to `create_user`. The plaintext `data.password` is never passed to any log statement. The secret-redaction filter is a backstop only.

### 6.2 `BorrowerService` (`app/services/borrower_service.py`)

```python
"""BorrowerService — domain service for borrower management. No FastAPI imports."""
import uuid
from dataclasses import dataclass

from app.core.errors import ConflictError, Forbidden, NotFoundError
from app.core.logging import get_logger
from app.models.borrower import Borrower
from app.notifications.interface import NotificationEvent, NotificationService
from app.repositories.borrower_repository import BorrowerRepository
from app.schemas.auth import AuthUser

log = get_logger("lendrail.services.borrower")

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
            "borrower_invited",
            borrower_id=str(borrower.id),
            invited_by=str(caller.org_id),
        )

        await self.notifier.send(
            NotificationEvent(
                event="borrower_invited",
                recipients=[caller.user_id],
                payload={
                    "borrower_id": str(borrower.id),
                    "borrower_email": data.contact_email,   # email in payload, not a secret
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

```python
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, model_validator

# ── Shared ENUM literals ──────────────────────────────────────────────────────

EntityType = Literal["fund", "corporate_treasury", "foundation", "agent"]
OrgRole = Literal["supplier", "agent"]    # admin cannot self-register

# ── Request models ────────────────────────────────────────────────────────────

class SupplierRegisterRequest(BaseModel):
    role: Literal["supplier"]
    name: str = Field(..., min_length=1, max_length=255)
    jurisdiction: str = Field(..., min_length=1, max_length=255)
    entity_type: EntityType
    contact_email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)

class AgentRegisterRequest(BaseModel):
    role: Literal["agent"]
    name: str = Field(..., min_length=1, max_length=255)
    jurisdiction: str = Field(..., min_length=1, max_length=255)
    entity_type: EntityType
    contact_email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    ops_contact_email: EmailStr
    regulatory_status_attested: bool

    @model_validator(mode="after")
    def attestation_must_be_true(self) -> "AgentRegisterRequest":
        if not self.regulatory_status_attested:
            raise ValueError("regulatory_status_attested must be true to register as an agent")
        return self

# ── Discriminated union for the shared endpoint ───────────────────────────────
# FastAPI resolves this by reading `role` first (Pydantic discriminated union).

from typing import Annotated, Union
from pydantic import Discriminator, Tag

OrgRegisterRequest = Annotated[
    Union[
        Annotated[SupplierRegisterRequest, Tag("supplier")],
        Annotated[AgentRegisterRequest, Tag("agent")],
    ],
    Discriminator("role"),
]

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

### 7.3 `POST /orgs/register` router (`app/api/routers/orgs.py`)

```python
"""Org registration and profile endpoints."""
from fastapi import APIRouter, Depends, status

from app.api.deps import get_current_user, get_org_service
from app.schemas.auth import AuthUser
from app.schemas.orgs import (
    AgentRegisterRequest,
    OrgMeResponse,
    OrgRegisterRequest,
    OrgRegisterResponse,
    SupplierRegisterRequest,
)
from app.services.org_service import AgentRegistrationInput, OrgService, SupplierRegistrationInput

router = APIRouter(prefix="/orgs", tags=["orgs"])


@router.post(
    "/register",
    response_model=OrgRegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new organization (supplier or agent)",
)
async def register_org(
    body: OrgRegisterRequest,       # discriminated union resolved by Pydantic on 'role'
    svc: OrgService = Depends(get_org_service),
) -> OrgRegisterResponse:
    """
    Public endpoint. No authentication required.

    `role` field in the request body determines supplier vs agent registration path.
    On success returns HTTP 201 with `org_id` and `access_token` (JWT).

    Error responses:
    - 409: duplicate email → `{"error": {"code": "duplicate_email", "message": "..."}}`
    - 422: validation failure (invalid entity_type, missing fields, attestation=false)
           → standard Pydantic 422 for schema errors; domain ValidationError for attestation
    """
    if isinstance(body, SupplierRegisterRequest):
        result = await svc.register_supplier(
            SupplierRegistrationInput(
                name=body.name,
                jurisdiction=body.jurisdiction,
                entity_type=body.entity_type,
                contact_email=body.contact_email,
                password=body.password,
            )
        )
    else:
        # AgentRegisterRequest — attestation already validated by model_validator
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

### 7.4 `POST /borrowers/invite` + `GET /borrowers/{id}` router (`app/api/routers/borrowers.py`)

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
    - 422: missing required fields
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

All domain errors are mapped by the existing handler in `app/core/errors.py`. M1 adds no new handler registrations — the existing map covers all needed codes.

| Scenario | Exception raised | HTTP | Envelope |
|---|---|---|---|
| Duplicate `contact_email` on `/orgs/register` | `ConflictError("...", code="duplicate_email")` | 409 | `{"error": {"code": "duplicate_email", "message": "..."}}` |
| Invalid `entity_type` (caught by Pydantic) | Pydantic `ValidationError` | 422 | FastAPI default 422 body |
| `regulatory_status_attested=false` (domain) | `ValidationError("...", code="attestation_required")` | 422 | `{"error": {"code": "attestation_required", "message": "..."}}` |
| `POST /borrowers/invite` with supplier JWT | `Forbidden(...)` | 403 | `{"error": {"code": "forbidden", "message": "..."}}` |
| `GET /orgs/me` without token | `AuthError(...)` | 401 | `{"error": {"code": "unauthorized", "message": "..."}}` |
| `GET /orgs/me` with no org_id in JWT | `Forbidden(...)` | 403 | `{"error": {"code": "forbidden", "message": "..."}}` |
| Duplicate borrower email | `ConflictError("...", code="duplicate_email")` | 409 | `{"error": {"code": "duplicate_email", "message": "..."}}` |
| `GET /borrowers/{id}` wrong org | `Forbidden(...)` | 403 | `{"error": {"code": "forbidden", "message": "..."}}` |
| `GET /borrowers/{id}` not found | `NotFoundError(...)` | 404 | `{"error": {"code": "not_found", "message": "..."}}` |

> **Pydantic 422 vs domain 422:** Pydantic `RequestValidationError` (from FastAPI's built-in handler) produces a different body format than our domain `ValidationError`. For `entity_type` out-of-range, Pydantic catches it before the handler runs, so the 422 body is FastAPI's standard format with `{"detail": [...]}`. For `attestation_required`, the `model_validator` raises `ValueError` which Pydantic wraps the same way. The domain `ValidationError` path (`code="attestation_required"`) is a belt-and-suspenders fallback in the service for callers that bypass the Pydantic model (e.g. internal service calls from tests). Implementation engineers should decide whether to standardize the 422 body format — this is flagged in §10.

### 7.6 Updated `app/api/deps.py`

Add providers for `OrgService` and `BorrowerService`:

```python
# Add to existing app/api/deps.py:

from app.repositories.org_repository import OrgRepository
from app.repositories.borrower_repository import BorrowerRepository
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

### 7.7 Updated `app/main.py`

Register the new routers:

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

**M1 obligation (not fully resolved, flagged in §10):** a future migration may make `users.org_id NOT NULL` after all M0 seed users are migrated. Until then, `org_id` remains nullable in the DB and in `AuthUser`.

**No changes to `create_access_token` or `decode_access_token` signatures in M1.** The function already handles `org_id: str | None`. No migration of existing tokens is needed.

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
- New fixtures needed:

```python
@pytest.fixture
async def seed_org(db_session) -> Organization:
    """Insert a minimal Organization row for FK tests."""
    org = Organization(
        id=uuid.uuid4(), name="Test Org", jurisdiction="Delaware",
        entity_type="fund", role="supplier", contact_email=f"org-{uuid.uuid4()}@example.com",
        status="approved",
    )
    db_session.add(org)
    await db_session.flush()
    return org

@pytest.fixture
def supplier_headers(client, seed_org) -> dict:
    """Register a supplier and return Authorization headers."""
    # Call POST /orgs/register synchronously in fixture setup via anyio.
    ...

@pytest.fixture
def agent_headers(client, seed_org) -> dict:
    """Register an agent and return Authorization headers."""
    ...
```

### F-011 test cases (`tests/test_orgs.py` — migration section)

| Test | Description | Asserts |
|---|---|---|
| `test_0002_migration_applies` | Run alembic up through 0002 | `organizations` table exists; `org_role_enum`, `entity_type_enum`, `org_status_enum` types exist |
| `test_0002_downgrade` | `downgrade -1` from 0002 | `organizations` table dropped; ENUMs dropped |
| `test_org_role_enum_constraint` | Insert org with `role="invalid"` | DB raises `DataError` / `IntegrityError` |
| `test_entity_type_enum_constraint` | Insert org with `entity_type="banana"` | DB raises `DataError` |
| `test_contact_email_unique` | Insert two orgs with same `contact_email` | DB raises `IntegrityError` with unique constraint name |

### F-012 test cases (`tests/test_orgs.py` — user delta section)

| Test | Description | Asserts |
|---|---|---|
| `test_0003_migration_applies` | Run up through 0003 | `users.ops_contact_email` column exists; `fk_users_org_id_organizations` FK exists |
| `test_0003_downgrade` | `downgrade -1` from 0003 | FK dropped; `ops_contact_email` and `regulatory_status_attested` columns dropped |
| `test_hash_password_returns_bcrypt` | `hash_password("secret")` | Returns string starting with `$2b$` |
| `test_verify_password_true` | `verify_password("secret", hash_password("secret"))` | Returns `True` |
| `test_verify_password_false` | `verify_password("wrong", hash_password("secret"))` | Returns `False` |
| `test_password_not_in_logs` | `hash_password("mysecret")` with log capture | `"mysecret"` never appears in any `LogRecord` |
| `test_user_org_fk_enforced` | Insert user with non-existent `org_id` | DB raises `IntegrityError` (`fk_users_org_id_organizations`) |
| `test_user_null_org_id_ok` | Insert user with `org_id=None` | Row inserted without error (M0 seed users still valid) |

### F-013 test cases (`tests/test_orgs.py`)

| Test | Description | Asserts |
|---|---|---|
| `test_supplier_register_201` | `POST /orgs/register` valid supplier payload | HTTP 201; body has `org_id` (UUID) and `access_token` (non-empty string); `token_type="bearer"` |
| `test_supplier_jwt_claims` | Decode token from registration | JWT `role="supplier"`, `org_id` matches returned `org_id`, `sub` is valid UUID |
| `test_supplier_register_no_password_in_response` | Register and inspect full response body | `"password"` key absent; `"hashed_password"` absent |
| `test_supplier_duplicate_email_409` | Register same email twice | Second call → HTTP 409; body `{"error": {"code": "duplicate_email", "message": "..."}}` |
| `test_supplier_invalid_entity_type_422` | `entity_type="banana"` | HTTP 422 |
| `test_supplier_short_password_422` | `password="abc"` (< 8 chars) | HTTP 422 |
| `test_supplier_missing_name_422` | Omit `name` field | HTTP 422 |
| `test_supplier_then_get_me` | Register supplier; call `GET /orgs/me` with returned token | HTTP 200; response `role="supplier"`, `id` matches `org_id` from registration |
| `test_supplier_org_row_created` | Register supplier; query `organizations` table directly | Row exists with correct `name`, `role="supplier"`, `status="approved"` |
| `test_supplier_user_row_created` | Register supplier; query `users` table | Row exists with `org_id` set, `hashed_password` present and non-empty, `role="supplier"` |

### F-015 test cases (`tests/test_orgs.py`)

| Test | Description | Asserts |
|---|---|---|
| `test_agent_register_201` | `POST /orgs/register` valid agent payload | HTTP 201; `org_id` + `access_token` present |
| `test_agent_jwt_role` | Decode returned token | `role="agent"` |
| `test_agent_register_missing_ops_contact_422` | Omit `ops_contact_email` | HTTP 422 |
| `test_agent_register_attestation_false_422` | `regulatory_status_attested=false` | HTTP 422 |
| `test_agent_duplicate_email_409` | Same email twice | HTTP 409, `code="duplicate_email"` |
| `test_agent_then_get_me` | Register agent; `GET /orgs/me` | HTTP 200; `role="agent"` |
| `test_agent_ops_contact_stored` | Register agent; query `users` table | `ops_contact_email` matches request value; `regulatory_status_attested=true` |

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
| `test_invite_notification_logged` | Call invite; capture logs | `caplog` contains log entry with `event="borrower_invited"` and `borrower_email=<the email>` |
| `test_get_borrower_200` | Agent JWT; `GET /borrowers/{id}` (own borrower) | HTTP 200; response fields match created borrower |
| `test_get_borrower_wrong_agent_403` | Different agent org's JWT; `GET /borrowers/{id}` | HTTP 403; `code="forbidden"` |
| `test_get_borrower_not_found_404` | Valid agent JWT; random UUID | HTTP 404; `code="not_found"` |
| `test_get_borrower_supplier_jwt_403` | Supplier JWT on `GET /borrowers/{id}` | HTTP 403 |
| `test_get_borrower_no_password_in_response` | Call `GET /borrowers/{id}` | `"hashed_password"` and `"password"` absent from response (borrowers have no password, but assert defensively) |

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
    reg = await client.post("/orgs/register", json={
        "role": "supplier",
        "name": "Acme Fund",
        "jurisdiction": "Delaware, USA",
        "entity_type": "fund",
        "contact_email": "acme@example.com",
        "password": "password123",
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

## §10. Open decisions — flag for tech-lead review

1. **`org_id` non-nullable timeline.** `users.org_id` remains nullable in M1 to preserve M0 seed user compatibility. Tech lead should decide: (a) at what milestone `org_id` becomes `NOT NULL` in the DB, and (b) whether M0 seed users need a data migration to associate them with a seed org. Until resolved, `AuthUser.org_id` stays `UUID | None`.

2. **`User.role` denormalization.** `role` lives on both `User` and `Organization` (and in the JWT). This simplifies JWT issuance but creates a potential sync issue if an admin changes an org's role. A cleaner model would derive the role from the org at login time. Recommend tech-lead decision before M2: keep denormalized (simpler, sufficient for MVP) or join to org at login (normalized, safe).

3. **`ops_contact_email` placement.** Currently specced as a column on `users` (the first user of the org). An alternative is to put it on `organizations` directly as a separate non-login contact email. The `organizations` table in F-015 refers to "ops/settlement contact email" as a field for the org entity, not a person. If the org may have multiple users in future, storing it on the org is cleaner. The current placement on `user` is a simplification for MVP.

4. **Pydantic 422 body format inconsistency.** Pydantic schema errors return `{"detail": [...]}` (FastAPI default), while domain `ValidationError` returns `{"error": {"code": "...", "message": "..."}}`. This means two different 422 response shapes. Options: (a) add a custom `RequestValidationError` handler that reformats to the envelope, (b) accept two formats (simpler), (c) move all validation into domain services and return strings from Pydantic only. Recommend standardizing to envelope for API consistency — this requires one additional exception handler.

5. **`status` column on `Organization` (F-058 pre-inclusion).** `org_status_enum` and `status` column are added in migration 0002 ahead of F-058, which is also an M1 feature per the feature index. This is intentional to avoid a separate migration. If F-058 is deferred to a later milestone, the column can remain and the admin endpoints can be added later without a new migration.

6. **`UserRepository` location.** Currently in `app/services/auth_service.py` (M0 decision). M1 adds a `repositories/` package for new repos. A follow-up cleanup should move `UserRepository` to `app/repositories/user_repository.py` for consistency. Not blocking M1.

7. **Password minimum length.** The spec uses 8 characters (`min_length=8`). NIST SP 800-63B recommends a minimum of 8 characters. Tech lead should confirm this is acceptable or raise to a higher minimum (12+ is common for B2B SaaS).

8. **Agent `entity_type` allowed values.** The `entity_type_enum` includes `"agent"` as a value (from ARCHITECTURE.md data model). For agent orgs registering via `POST /orgs/register?role=agent`, is `entity_type="agent"` a valid value, or is it reserved for internal use? Currently the Pydantic schema allows it. Clarification needed.

9. **Auto-approval on registration.** `OrgService.register_supplier` and `register_agent` set `status="approved"` immediately. F-058 provides manual override. If the product team wants all registrations to start as `pending_review` and require admin approval before the JWT is useful, the registration flow must change (e.g. return a JWT but block protected endpoints for `pending_review` orgs). This is a product decision — flagged for review.

---

Status: Draft — awaiting tech-lead review
