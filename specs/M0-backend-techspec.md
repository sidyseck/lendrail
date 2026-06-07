# LendRail — M0 (Foundation) Backend Technical Specification

| Field | Value |
|---|---|
| Milestone | M0 — Foundation (backend only) |
| Scope | F-001 … F-009 + F-060 (F-010 React scaffold is frontend, excluded) |
| Based on | MASTER_PRD.md v0.1, ARCHITECTURE.md v0.2, FEATURES.md |
| Status | Implementation-ready spec (rev 2 — tech-lead blocker/major fixes applied) |
| Audience | Backend engineer implementing M0 |

---

## 0. Purpose and guiding principles

M0 builds the foundation only: scaffolding, Docker Compose, DB + migrations, async session/repository base, JWT auth, RBAC helpers, notification interface + console adapter, ARQ worker, mock custodian/market-data adapters, secret store, and a correct `/openapi.json`. **No domain logic** (orgs, connections, loans, accruals) is built in M0. The only DB tables created are `users` and `notifications` (and the bcrypt-hashable user row that auth needs).

Non-negotiable conventions carried from the architecture:

- **Layer boundaries.** `API (routers) → domain services → data (repositories) + adapters`. Domain services **never** import FastAPI types (`Depends`, `HTTPException`, `Request`, status). They take an `AuthUser` dataclass and typed inputs, raise typed domain exceptions.
- **Everything local.** No cloud, no external service calls. `docker compose up` is the only thing needed to run the stack.
- **Adapters behind Protocols.** Real implementations drop in by env-var switch; no domain change.
- **Secrets are AES-256 encrypted** in a local env-keyed store. Custodian keys never hit logs.
- **Async all the way.** SQLAlchemy 2.x async engine + asyncpg; ARQ for background jobs.

> **Opinionated choice (justified inline where non-obvious):** we keep M0 deliberately thin and prove each seam with a test rather than building toward later milestones. The `users` table is introduced in M0 (not deferred to M1's F-012) because F-004 login cannot exist without it; M1 extends it with the `org_id` FK once `organizations` exists. See §6.3 for the forward-compat handling of `org_id`.

---

## 1. Complete proposed `backend/` tree

```
backend/
├── pyproject.toml                  # deps + tool config (ruff, pytest, mypy)
├── README.md
├── Dockerfile
├── alembic.ini
├── .dockerignore
├── alembic/
│   ├── env.py                      # async engine wiring for migrations
│   ├── script.py.mako
│   └── versions/
│       └── 0001_users_and_notifications.py
├── app/
│   ├── __init__.py
│   ├── main.py                     # FastAPI app factory, router include, exception handlers, DI overrides
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py               # Pydantic Settings (env loading)
│   │   ├── security.py             # password hash/verify, JWT encode/decode
│   │   ├── crypto.py               # AES-256-GCM encrypt/decrypt primitives
│   │   ├── logging.py              # structured logging config + secret-redaction filter
│   │   └── errors.py               # typed exception hierarchy
│   ├── db/
│   │   ├── __init__.py
│   │   ├── base.py                 # DeclarativeBase + metadata naming convention
│   │   ├── session.py              # async engine + async_sessionmaker + get_session dep
│   │   └── repository.py           # BaseRepository[T]
│   ├── models/
│   │   ├── __init__.py
│   │   ├── user.py                 # User ORM model
│   │   └── notification.py         # Notification ORM model
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── auth.py                 # LoginRequest, TokenResponse, TokenPayload, AuthUser
│   │   └── common.py               # HealthResponse, ErrorResponse
│   ├── adapters/
│   │   ├── __init__.py
│   │   ├── interfaces.py           # Protocols + DTOs (Custodian, MarketData)
│   │   ├── mock_custodian.py       # MockCustodianAdapter
│   │   ├── mock_market_data.py     # MockMarketDataAdapter
│   │   └── providers.py            # adapter factory functions (env-switched)
│   ├── secrets/
│   │   ├── __init__.py
│   │   ├── interface.py            # SecretStore Protocol
│   │   └── env_store.py            # EnvSecretStore (AES-256-GCM)
│   ├── notifications/
│   │   ├── __init__.py
│   │   ├── interface.py            # NotificationService Protocol + NotificationEvent DTO
│   │   ├── console_adapter.py      # ConsoleNotificationAdapter (+ DB row write)
│   │   └── repository.py           # NotificationRepository
│   ├── services/
│   │   ├── __init__.py
│   │   └── auth_service.py         # AuthService (login, no FastAPI imports)
│   ├── api/
│   │   ├── __init__.py
│   │   ├── deps.py                 # FastAPI Depends providers (session, current_user, adapters, secret store, notifier)
│   │   ├── rbac.py                 # require_role(...) dependency factory
│   │   └── routers/
│   │       ├── __init__.py
│   │       ├── health.py           # GET /healthz
│   │       └── auth.py             # POST /auth/login, GET /auth/me (protected smoke)
│   └── workers/
│       ├── __init__.py
│       └── arq_worker.py           # WorkerSettings, health_check_job
└── tests/
    ├── __init__.py
    ├── conftest.py                 # event loop, test engine, session rollback fixture, app/client fixtures
    ├── test_health.py             # F-001
    ├── test_migrations.py         # F-002
    ├── test_repository.py         # F-003
    ├── test_auth.py               # F-004
    ├── test_rbac.py               # F-005
    ├── test_notifications.py      # F-006
    ├── test_worker.py             # F-007
    ├── test_adapters.py           # F-008
    ├── test_secret_store.py       # F-009
    └── test_openapi.py            # F-060
```

Top-level repo files owned partly by M0 backend (F-001):

```
/docker-compose.yml          # postgres, redis, api, worker, frontend services
/.env.local.example          # every env var with placeholder + comment
/backend/Dockerfile          # python:3.12-slim image for api + worker
```

---

## 2. Configuration management (F-001, all features)

Single source of truth: `app/core/config.py` using **pydantic-settings** (`BaseSettings`). Loaded once into a cached `get_settings()` singleton.

> **Choice:** `pydantic-settings` over raw `os.getenv` so every var is typed, validated at boot, and documented in one place. A bad/missing var fails fast at startup, not at first use.

```python
# app/core/config.py
from functools import lru_cache
from typing import Literal
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env.local", extra="ignore")

    # --- Database ---
    database_url: str = Field(...)                      # postgresql+asyncpg://...
    db_echo: bool = False

    # --- Redis / ARQ ---
    redis_url: str = Field(...)                         # redis://redis:6379

    # --- Auth / JWT ---
    jwt_secret: str = Field(...)
    jwt_algorithm: str = "HS256"
    jwt_expires_minutes: int = 60

    # --- Secret store ---
    secret_store: Literal["env"] = "env"
    secret_store_key: str | None = None                 # falls back to jwt_secret-derived key

    # --- Adapter selection ---
    custodian_adapter: str = "mock"
    market_data_adapter: str = "mock"
    mock_btc_price_usd: float = 65000.0                 # fixed price for MockMarketDataAdapter

    # --- Notifications ---
    notification_adapter: Literal["console"] = "console"

    # --- Worker ---
    health_check_interval_seconds: int = 60

    # --- App ---
    environment: Literal["local", "test", "prod"] = "local"
    log_level: str = "INFO"

@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
```

### Env var table (every var M0 needs)

| Var | Type | Default | Used by |
|---|---|---|---|
| `DATABASE_URL` | str (required) | — | F-002, F-003 |
| `DB_ECHO` | bool | `false` | F-003 debug |
| `REDIS_URL` | str (required) | — | F-007 |
| `JWT_SECRET` | str (required) | — | F-004, F-009 |
| `JWT_ALGORITHM` | str | `HS256` | F-004 |
| `JWT_EXPIRES_MINUTES` | int | `60` | F-004 |
| `SECRET_STORE` | enum(`env`) | `env` | F-009 |
| `SECRET_STORE_KEY` | str (optional) | `None` (derived from `JWT_SECRET`) | F-009 |
| `CUSTODIAN_ADAPTER` | str | `mock` | F-008 |
| `MARKET_DATA_ADAPTER` | str | `mock` | F-008 |
| `MOCK_BTC_PRICE_USD` | float | `65000.0` | F-008 |
| `NOTIFICATION_ADAPTER` | enum(`console`) | `console` | F-006 |
| `HEALTH_CHECK_INTERVAL_SECONDS` | int | `60` | F-007 |
| `ENVIRONMENT` | enum(`local`,`test`,`prod`) | `local` | all |
| `LOG_LEVEL` | str | `INFO` | logging |

`.env.local.example` lists all of the above with placeholder values and one-line comments (F-001 acceptance criterion).

---

## 3. F-001 — Monorepo layout + Docker Compose (backend portions)

### Files
- `/docker-compose.yml` — postgres, redis, api, worker, frontend (frontend service points at `./frontend`, built by F-010; not implemented here but the service entry exists).
- `/.env.local.example`
- `backend/Dockerfile`

### `backend/Dockerfile`
```dockerfile
FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml ./
RUN uv pip install --system -e .
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```
> **Choice:** `uv` for fast, reproducible installs from `pyproject.toml`. Same image serves both `api` and `worker` (command overridden in compose).

### docker-compose service contracts (backend-relevant)
- `api`: `command: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`, `env_file: .env.local`, `ports: ["8000:8000"]`, `depends_on: [postgres, redis]`. A **local-only** entrypoint script **waits for postgres** (e.g. `pg_isready` loop) then runs `alembic upgrade head` before uvicorn, so a clean checkout boots with schema present (satisfies "starts without errors on clean checkout"). **Prod does NOT auto-migrate on start** — migrations run as a separate gated job to avoid races across replicas (decision 5, §17).
- `worker`: `command: python -m app.workers.arq_worker` (or `arq app.workers.arq_worker.WorkerSettings`), same `env_file`, `depends_on: [postgres, redis]`.
- `postgres`: `postgres:16`, db/user/pass `lendrail`, named volume `pgdata`.
- `redis`: `redis:7-alpine`.

### Health endpoint
```python
# app/api/routers/health.py
from fastapi import APIRouter
from app.schemas.common import HealthResponse

router = APIRouter(tags=["health"])

@router.get("/healthz", response_model=HealthResponse)
async def healthz() -> HealthResponse:
    return HealthResponse(status="ok")
```
`HealthResponse` is `{ "status": "ok" }`. (ARCHITECTURE.md does not specify a health path; `/healthz` is canonical here, matching the F-001 acceptance criteria verbatim.)

---

## 4. F-002 — PostgreSQL + Alembic migration runner

### Files
- `backend/alembic.ini` — `sqlalchemy.url` left blank; resolved in `env.py` from `Settings`.
- `backend/alembic/env.py` — async engine handling.
- `backend/alembic/versions/0001_users_and_notifications.py` — creates `users` + `notifications` (the only M0 tables).

### `env.py` async handling
Alembic is sync by default; we run migrations against the async engine via `connection.run_sync`.

```python
# alembic/env.py (key excerpt)
import asyncio
from sqlalchemy.ext.asyncio import async_engine_from_config
from alembic import context
from app.core.config import get_settings
from app.db.base import Base
import app.models  # noqa: F401  ensure all models imported so metadata is populated

config = context.config
config.set_main_option("sqlalchemy.url", get_settings().database_url)
target_metadata = Base.metadata

def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata,
                      compare_type=True, compare_server_default=True)
    with context.begin_transaction():
        context.run_migrations()

async def run_async_migrations():
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.", future=True)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()

def run_migrations_online():
    asyncio.run(run_async_migrations())

run_migrations_online()
```

### Naming convention (set on metadata so Alembic autogenerate is deterministic)
```python
# app/db/base.py
from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
```

### Conventions
- Revision filenames: `NNNN_short_slug.py` (zero-padded sequence, not random hashes) for readable history.
- Every migration implements both `upgrade()` and `downgrade()` (acceptance criterion: `downgrade base` then `upgrade head` re-applies cleanly).
- `DATABASE_URL` always from env (never hardcoded).

> **Choice:** `compare_type=True` so future column-type changes are caught by autogenerate. Migrations are hand-reviewed, never auto-applied blindly.

---

## 5. F-003 — Async session factory + repository base

### `app/db/session.py`
```python
from collections.abc import AsyncGenerator
from sqlalchemy.ext.asyncio import (
    AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine)
from app.core.config import get_settings

_settings = get_settings()
engine: AsyncEngine = create_async_engine(
    _settings.database_url, echo=_settings.db_echo, pool_pre_ping=True)
SessionFactory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionFactory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
```
> **Choice:** `expire_on_commit=False` so ORM objects remain usable after commit (avoids lazy-load-after-commit on the async session). The `get_session` dependency commits on success and rolls back on exception — services do not manage transactions themselves. `pool_pre_ping=True` avoids stale-connection errors against Dockerized Postgres.

### `app/db/repository.py`
```python
from typing import Generic, TypeVar
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.base import Base
from app.core.errors import NotFoundError

ModelT = TypeVar("ModelT", bound=Base)

class BaseRepository(Generic[ModelT]):
    model: type[ModelT]

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, id_: UUID) -> ModelT:
        obj = await self.session.get(self.model, id_)
        if obj is None:
            raise NotFoundError(f"{self.model.__name__} {id_} not found")
        return obj

    async def get_or_none(self, id_: UUID) -> ModelT | None:
        return await self.session.get(self.model, id_)

    async def create(self, **kwargs) -> ModelT:
        obj = self.model(**kwargs)
        self.session.add(obj)
        await self.session.flush()       # populate PK without committing
        return obj

    async def update(self, obj: ModelT, **changes) -> ModelT:
        for k, v in changes.items():
            setattr(obj, k, v)
        await self.session.flush()
        return obj

    async def delete(self, obj: ModelT) -> None:
        await self.session.delete(obj)
        await self.session.flush()

    async def list_where(self, *conditions) -> list[ModelT]:
        result = await self.session.execute(select(self.model).where(*conditions))
        return list(result.scalars().all())
```
- `get()` raises typed `NotFoundError` (acceptance criterion: never a raw SQLAlchemy exception).
- `flush()` not `commit()` inside repo methods — commit is owned by the session dependency / job boundary. This keeps a request atomic.

---

## 6. F-004 — JWT authentication

### 6.1 Contracts (`app/schemas/auth.py`)
```python
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, EmailStr

Role = Literal["supplier", "agent", "admin"]

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"

class TokenPayload(BaseModel):
    """Decoded JWT claims. `sub` = user_id (string)."""
    sub: str
    org_id: str | None          # nullable in M0; populated once orgs exist (M1)
    role: Role
    exp: datetime

@dataclass(frozen=True)
class AuthUser:
    user_id: UUID
    org_id: UUID | None
    role: Role
```
> `AuthUser` is the **only** type the auth layer hands to domain services (architecture §6). It is a frozen dataclass, not a Pydantic model, so services never depend on web types.

### 6.2 Security primitives (`app/core/security.py`)
```python
from datetime import datetime, timedelta, timezone
from passlib.context import CryptContext
import jwt                                   # PyJWT
from jwt import PyJWTError
from app.core.config import get_settings

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(plain: str) -> str: return _pwd.hash(plain)
def verify_password(plain: str, hashed: str) -> bool: return _pwd.verify(plain, hashed)

def create_access_token(*, user_id: str, org_id: str | None, role: str) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    claims = {"sub": user_id, "org_id": org_id, "role": role,
              "exp": now + timedelta(minutes=s.jwt_expires_minutes), "iat": now}
    return jwt.encode(claims, s.jwt_secret, algorithm=s.jwt_algorithm)

def decode_access_token(token: str) -> dict:
    s = get_settings()
    # PyJWT verifies signature + exp; raises PyJWTError subclasses on failure.
    return jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])
```
> **Library choice:** **PyJWT** (not `python-jose`, which is effectively unmaintained — no substantive release since 2021). Near drop-in: `jwt.encode`/`jwt.decode` have the same shape; the failure type is `jwt.PyJWTError` (and subclasses like `ExpiredSignatureError`, `InvalidSignatureError`).

### 6.3 User model (`app/models/user.py`)
```python
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True)  # FK added in M1
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="supplier")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```
> **Forward-compat note:** `org_id` is a plain nullable UUID in M0 (no `organizations` table yet). M1's F-011/F-012 add the FK constraint via a migration once `organizations` exists. `role` lives on the user in M0 so JWT issuance has a source; in M1 it may be denormalized from the org. This is the one deliberate concession to let auth exist before onboarding. Flag for tech-lead review.

### 6.4 AuthService (`app/services/auth_service.py`) — no FastAPI imports
```python
from app.db.repository import BaseRepository
from app.models.user import User
from app.core.security import verify_password, create_access_token
from app.core.errors import AuthError

class UserRepository(BaseRepository[User]):
    model = User
    async def get_by_email(self, email: str) -> User | None:
        rows = await self.list_where(User.email == email)
        return rows[0] if rows else None

class AuthService:
    def __init__(self, users: UserRepository) -> None:
        self.users = users

    async def login(self, email: str, password: str) -> str:
        user = await self.users.get_by_email(email)
        if user is None or not verify_password(password, user.hashed_password):
            raise AuthError("invalid_credentials")     # → 401 via handler
        return create_access_token(
            user_id=str(user.id),
            org_id=str(user.org_id) if user.org_id else None,
            role=user.role)
```
Constant-time note: `verify_password` runs even on unknown email (compare against a dummy hash) to avoid user-enumeration timing leaks.

### 6.5 Router + `get_current_user` dependency
```python
# app/api/routers/auth.py
from fastapi import APIRouter, Depends
from app.schemas.auth import LoginRequest, TokenResponse, AuthUser
from app.api.deps import get_auth_service, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, svc=Depends(get_auth_service)) -> TokenResponse:
    token = await svc.login(body.email, body.password)
    return TokenResponse(access_token=token)

@router.get("/me")                # protected smoke endpoint for F-004/F-005 tests
async def me(user: AuthUser = Depends(get_current_user)) -> dict:
    return {"user_id": str(user.user_id), "org_id": str(user.org_id) if user.org_id else None,
            "role": user.role}
```
`get_current_user` lives in `app/api/deps.py` (§9). It validates signature/expiry and maps failure to 401.

---

## 7. F-005 — RBAC enforcement helpers

### `app/api/rbac.py`
```python
from fastapi import Depends
from app.schemas.auth import AuthUser, Role
from app.api.deps import get_current_user
from app.core.errors import Forbidden

def require_role(*allowed: Role):
    async def _guard(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        if user.role not in allowed:
            raise Forbidden(f"role '{user.role}' not permitted; requires one of {allowed}")
        return user
    return _guard

# convenience guards
require_supplier = require_role("supplier")
require_agent = require_role("agent")
require_admin = require_role("admin")
```
- A route uses `Depends(require_role("agent"))`; non-matching role → `Forbidden` → HTTP 403 (handler in §10).
- **Two-step pattern** (architecture §6): `require_role` is step 1 (role check) and lives in the API layer. Step 2 (ownership check on `org_id`) lives inside each domain service in later milestones — out of M0 scope, but `AuthUser.org_id` is the contract that enables it. M0 ships only the role-check helper plus the `AuthUser`-only boundary rule.

> **Choice:** `require_role` returns the `AuthUser` so a handler can use one dependency for both auth and the user object (no double `Depends`).

---

## 8. F-006 — Notification service interface + console adapter

### Contract (`app/notifications/interface.py`)
```python
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol
from uuid import UUID

@dataclass
class NotificationEvent:
    event: str                         # e.g. "test", "loan_booked"
    recipients: list[UUID]             # user_ids
    payload: dict = field(default_factory=dict)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

class NotificationService(Protocol):
    async def send(self, event: NotificationEvent) -> None: ...
```

### Notification model (`app/models/notification.py`)
Columns per F-006 acceptance: `id`, `user_id`, `event`, `payload` (JSONB), `created_at`, `read_at` (nullable).
```python
class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False, index=True)
    event: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

### Console adapter (`app/notifications/console_adapter.py`)
```python
import logging
from app.notifications.interface import NotificationEvent
from app.notifications.repository import NotificationRepository

log = logging.getLogger("lendrail.notifications")

class ConsoleNotificationAdapter:
    """Logs a structured line to stdout AND writes one in-app row per recipient."""
    def __init__(self, repo: NotificationRepository | None = None) -> None:
        self._repo = repo                # None in pure unit tests; injected in app

    async def send(self, event: NotificationEvent) -> None:
        log.info("notification", extra={"event": event.event,
                 "recipients": [str(r) for r in event.recipients], "payload": event.payload})
        if self._repo is not None:
            for uid in event.recipients:
                await self._repo.create(user_id=uid, event=event.event, payload=event.payload)
```
- Structured log line contains event name + recipient IDs (acceptance criterion).
- Adapter selection is by `NOTIFICATION_ADAPTER` in `providers`/`deps`; swapping adapters touches only DI wiring (acceptance criterion).
- `payload` must never contain secret material; the redaction log filter (§13) is a backstop.

---

## 9. F-007 — ARQ background worker

### `app/workers/arq_worker.py`
```python
import logging
from arq import cron
from arq.connections import RedisSettings
from app.core.config import get_settings
from app.core.logging import configure_logging

log = logging.getLogger("lendrail.worker")

async def health_check_job(ctx) -> str:
    log.info("health_check_job ran", extra={"job_id": ctx.get("job_id")})
    return "ok"

async def on_job_end(ctx) -> None:
    """ARQ after-job hook. Logs any job exception at ERROR with full traceback,
    guaranteeing the F-007 'failed job logged at ERROR with traceback' criterion
    rather than relying on ARQ's default formatting. Worker keeps running."""
    exc = ctx.get("exception")
    if exc is not None:
        log.error("job %s failed", ctx.get("job_id"), exc_info=exc)

async def startup(ctx) -> None:
    configure_logging()
    log.info("worker startup")

async def shutdown(ctx) -> None:
    log.info("worker shutdown")

def _redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(get_settings().redis_url)

class WorkerSettings:
    functions = [health_check_job]
    on_startup = startup
    on_shutdown = shutdown
    after_job_end = on_job_end
    redis_settings = _redis_settings()
    cron_jobs = [
        cron(health_check_job, second=0),   # fires every minute on the :00 second (F-007 smoke)
    ]
    max_tries = 3
    job_timeout = 30
```
- `REDIS_URL` from env (acceptance criterion).
- **Cron is shipped, not commented** — `cron(health_check_job, second=0)` fires every minute, satisfying F-007's "runs every 60 seconds" criterion. Run via `arq app.workers.arq_worker.WorkerSettings`.
- **Failed-job ERROR logging is explicit**, not assumed: the `after_job_end` hook (`on_job_end`) inspects `ctx["exception"]` and logs at ERROR with `exc_info` (full traceback); the worker process keeps running. A dedicated `failing_job` is registered only in the test build to drive `test_worker.py`.

> **Choice:** ARQ over Celery — single async runtime shared with FastAPI, Redis-only, no result-backend ceremony.

---

## 10. F-008 — Mock custodian + mock market data adapters

### Interfaces (`app/adapters/interfaces.py`) — verbatim from ARCHITECTURE §5
DTOs (dataclasses): `InventoryPosition`, `CollateralPosition`, `InstructionResult`, `AssetPrice`. Protocols: `CustodianAdapter`, `MarketDataAdapter`.

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

@dataclass
class InventoryPosition:
    account_ref: str
    asset_type: str          # "BTC"
    quantity: float
    as_of: datetime
    feed_id: str

@dataclass
class CollateralPosition:
    loan_ref: str
    collateral_type: str
    quantity: float
    value_usd: float
    as_of: datetime
    feed_id: str

@dataclass
class InstructionResult:
    success: bool
    custodian_ref: str
    executed_at: datetime
    error_msg: str | None

@dataclass
class AssetPrice:
    asset_type: str
    price_usd: float
    as_of: datetime
    source: str

class CustodianAdapter(Protocol):
    async def get_inventory(self, account_ref: str) -> list[InventoryPosition]: ...
    async def get_collateral(self, loan_ref: str) -> CollateralPosition | None: ...
    async def validate_key(self) -> bool: ...
    async def transmit_instruction(self, instruction_type: str, asset_type: str, quantity: float,
                                   from_account: str, to_account: str, agent_ref: str) -> InstructionResult: ...

class MarketDataAdapter(Protocol):
    async def get_price(self, asset_type: str) -> AssetPrice: ...
```
> **Decision (async Protocols — resolved):** adapter methods are **`async def`**. Although the reference architecture sketched them as sync, the real custodian/market-data clients (Anchorage, price feeds) are network-bound and belong on the event loop. With **zero real call sites in M0**, making them async now is near-free and avoids a breaking signature change across every service/worker/test later. Mock implementations are `async def` accordingly and callers `await` them. ARCHITECTURE.md §5 should be updated to match (tracked separately).

### Mock implementations
- `MockCustodianAdapter` — verbatim from ARCHITECTURE §5 (`app/adapters/mock_custodian.py`). Seedable inventory/collateral via constructor for tests. `validate_key()` returns `True` by default; a `validate_key_result` constructor kwarg lets tests seed a `False` for F-024 later.
- `MockMarketDataAdapter` (`app/adapters/mock_market_data.py`):
```python
class MockMarketDataAdapter:
    def __init__(self, price_usd: float | None = None) -> None:
        self._price = price_usd if price_usd is not None else get_settings().mock_btc_price_usd
    async def get_price(self, asset_type: str) -> AssetPrice:
        return AssetPrice(asset_type=asset_type, price_usd=self._price,
                          as_of=datetime.now(timezone.utc), source="mock")
```
> `MockCustodianAdapter` methods are likewise `async def` (the architecture's body is otherwise unchanged — it does no real I/O, so each method simply becomes a coroutine). Tests `await` all adapter calls.

### Provider factory (`app/adapters/providers.py`)
```python
from app.core.config import get_settings
from app.adapters.interfaces import CustodianAdapter, MarketDataAdapter
from app.adapters.mock_custodian import MockCustodianAdapter
from app.adapters.mock_market_data import MockMarketDataAdapter

def build_custodian_adapter() -> CustodianAdapter:
    name = get_settings().custodian_adapter
    if name == "mock":
        return MockCustodianAdapter()
    raise NotImplementedError(f"custodian adapter '{name}' not wired yet")

def build_market_data_adapter() -> MarketDataAdapter:
    name = get_settings().market_data_adapter
    if name == "mock":
        return MockMarketDataAdapter()
    raise NotImplementedError(f"market data adapter '{name}' not wired yet")
```
- Non-`mock` value → `NotImplementedError` (acceptance criterion).

---

## 11. F-009 — Secret store interface + local env-based AES-256 impl

### Interface (`app/secrets/interface.py`)
```python
from typing import Protocol

class SecretStore(Protocol):
    def store(self, value: str) -> str: ...     # returns an opaque ref (UUID)
    def retrieve(self, ref: str) -> str: ...     # raises SecretNotFoundError on bad ref
```

### Crypto primitive (`app/core/crypto.py`)
AES-256-GCM (authenticated encryption) via `cryptography`. Key = 32 bytes derived from `SECRET_STORE_KEY` or `JWT_SECRET` using SHA-256.
```python
import hashlib, os, base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def _derive_key(secret: str) -> bytes:
    return hashlib.sha256(secret.encode()).digest()   # 32 bytes → AES-256

def encrypt(plaintext: str, secret: str) -> str:
    key = _derive_key(secret); nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ct).decode()

def decrypt(token_b64: str, secret: str) -> str:
    raw = base64.b64decode(token_b64); nonce, ct = raw[:12], raw[12:]
    return AESGCM(_derive_key(secret)).decrypt(nonce, ct, None).decode()
```
> **Choice:** AES-256-**GCM** (not CBC) for authenticated encryption — tamper-detection for free, prefixed 12-byte nonce. The key is the SHA-256 of `SECRET_STORE_KEY` (or `JWT_SECRET` as a local fallback).
>
> **Production constraints (mandatory outside `local`):**
> 1. **A dedicated, high-entropy random `SECRET_STORE_KEY` is required** in `test`/`prod` — never fall back to `JWT_SECRET`. Bare `SHA-256` is acceptable for a high-entropy machine secret but is **not** a password-based KDF; a low-entropy human value would be weak. (Optionally switch derivation to HKDF for hygiene.) `.env.local.example` documents this and the prod path.
> 2. **Key coupling caveat:** if `SECRET_STORE_KEY` is unset and the key derives from `JWT_SECRET`, then **rotating `JWT_SECRET` also invalidates every stored ciphertext** (it can no longer be decrypted). Rotation runbooks must decouple the two by setting an explicit `SECRET_STORE_KEY`. The real prod path is a managed vault, not this primitive.

### EnvSecretStore (`app/secrets/env_store.py`)
```python
import uuid
from app.core.config import get_settings
from app.core.crypto import encrypt, decrypt
from app.core.errors import SecretNotFoundError

class EnvSecretStore:
    """In-process AES-256 store. Ciphertext kept in a module dict keyed by UUID ref.
    NOTE: M0 store is in-memory/process-local (no persistence) — sufficient for M0 and
    tests; M2 (F-024) persists the ref in custodian_links and the ciphertext alongside.
    """
    def __init__(self) -> None:
        self._secret = get_settings().secret_store_key or get_settings().jwt_secret
        self._data: dict[str, str] = {}

    def store(self, value: str) -> str:
        ref = str(uuid.uuid4())
        self._data[ref] = encrypt(value, self._secret)
        return ref

    def retrieve(self, ref: str) -> str:
        token = self._data.get(ref)
        if token is None:
            raise SecretNotFoundError(f"secret ref {ref} not found")
        return decrypt(token, self._secret)
```
- `store()` returns a UUID ref; `retrieve()` returns plaintext; bad ref → `SecretNotFoundError` (acceptance criteria).
- Plaintext never logged — guaranteed by (a) never passing secrets to `log`, and (b) the redaction filter (§13). A unit test captures logs to prove it.

> **M0 limitation (documented, not a bug):** the `EnvSecretStore` dict is **per-process**. The `api` and `worker` run as **separate containers**, and uvicorn `--reload` spawns fresh processes — so refs stored in one process are **not visible** to another and **do not survive a reload**. M0 has zero consumers of stored secrets, so this is safe *for M0 only*. **Do not build anything against this store that requires cross-process or durable retrieval.**
>
> **Hard M2 gate (precondition of F-024, not a footnote):** before F-024 (custodian API key registration) is implemented, the secret store **must** persist ciphertext to Postgres (e.g. an `encrypted_secrets` table, or the ciphertext stored alongside the `custodian_links.encrypted_api_key_ref`). F-024 stores a key in one request (api process) that the worker/another request later retrieves — the in-memory store would silently lose it. This is a blocking dependency for M2 and is tracked in §16 / decision 3.

---

## 12. Dependency injection approach (`app/api/deps.py`)

All wiring lives in one provider module. Routes get session, current user, adapters, secret store, and notifier via `Depends`. Domain services are constructed in providers from their repository deps — services themselves never call `Depends`.

```python
# app/api/deps.py
from typing import Annotated
from uuid import UUID
from fastapi import Depends, Header
from jwt import PyJWTError
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_session
from app.schemas.auth import AuthUser
from app.core.security import decode_access_token
from app.core.errors import AuthError
from app.services.auth_service import AuthService, UserRepository
from app.adapters.interfaces import CustodianAdapter, MarketDataAdapter
from app.adapters.providers import build_custodian_adapter, build_market_data_adapter
from app.secrets.interface import SecretStore
from app.secrets.env_store import EnvSecretStore
from app.notifications.interface import NotificationService
from app.notifications.console_adapter import ConsoleNotificationAdapter
from app.notifications.repository import NotificationRepository

SessionDep = Annotated[AsyncSession, Depends(get_session)]

# ---- auth ----
async def get_current_user(authorization: str = Header(default="")) -> AuthUser:
    if not authorization.lower().startswith("bearer "):
        raise AuthError("missing_bearer_token")
    token = authorization.split(" ", 1)[1]
    try:
        claims = decode_access_token(token)
    except PyJWTError:
        raise AuthError("invalid_token")
    return AuthUser(user_id=UUID(claims["sub"]),
                    org_id=UUID(claims["org_id"]) if claims.get("org_id") else None,
                    role=claims["role"])

def get_auth_service(session: SessionDep) -> AuthService:
    return AuthService(UserRepository(session))

# ---- adapters: singletons via app.state, see main.py; here we expose simple builders ----
def get_custodian_adapter() -> CustodianAdapter: return build_custodian_adapter()
def get_market_data_adapter() -> MarketDataAdapter: return build_market_data_adapter()

# ---- secret store (process singleton) ----
_secret_store_singleton: SecretStore = EnvSecretStore()
def get_secret_store() -> SecretStore: return _secret_store_singleton

# ---- notifications ----
def get_notification_service(session: SessionDep) -> NotificationService:
    return ConsoleNotificationAdapter(NotificationRepository(session))
```

`main.py` wires everything and lets tests override:
```python
# app/main.py (excerpt)
from fastapi import FastAPI
from app.core.logging import configure_logging
from app.core.errors import register_exception_handlers
from app.api.routers import health, auth

def create_app() -> FastAPI:
    configure_logging()
    app = FastAPI(title="LendRail API", version="0.1.0")
    register_exception_handlers(app)
    app.include_router(health.router)
    app.include_router(auth.router)
    return app

app = create_app()
```
> **Choice:** FastAPI's native `Depends` graph is the DI container — no third-party DI lib. Adapter/secret/notifier providers are swappable by overriding the provider function or the env var. Tests use `app.dependency_overrides[...]` to inject seeded mocks (e.g. a `MockCustodianAdapter` with low inventory) without touching app code.

---

## 13. F-060 — OpenAPI exposure

- FastAPI auto-generates `/openapi.json` and `/docs`. M0 work is to ensure it's **valid and complete**:
  - Every route declares `response_model` and tags (done in routers above).
  - App `title`/`version` set in `create_app()`.
  - `operation_id`s kept stable/clean (set `generate_unique_id_function` to `f"{tag}_{name}"` so the generated TS client has readable method names).
- Acceptance: `GET /openapi.json` returns valid OpenAPI 3.x; a test asserts `info.title`, presence of `/auth/login` path, and that `LoginRequest`/`TokenResponse` components exist. The `npm run generate-client` step is frontend (F-010) and out of backend scope, but the backend guarantees the schema is correct.

```python
# in create_app()
app = FastAPI(title="LendRail API", version="0.1.0",
              generate_unique_id_function=lambda r: f"{r.tags[0]}_{r.name}" if r.tags else r.name)
```

---

## 14. Error handling — typed hierarchy + HTTP mapping

### `app/core/errors.py`
```python
class DomainError(Exception):
    """Base for all typed domain errors. Carries a machine code + message."""
    code: str = "domain_error"
    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code: self.code = code

class NotFoundError(DomainError):        code = "not_found"          # → 404
class AuthError(DomainError):            code = "unauthorized"       # → 401
class Forbidden(DomainError):            code = "forbidden"          # → 403
class ValidationError(DomainError):      code = "validation_error"   # → 422
class ConflictError(DomainError):        code = "conflict"           # → 409
class SecretNotFoundError(DomainError):  code = "secret_not_found"   # → 404 (internal; not user-triggerable in M0)
class AdapterError(DomainError):         code = "adapter_error"      # → 502
```

### Mapping (registered in `main.py`)
```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from app.core.errors import (DomainError, NotFoundError, AuthError, Forbidden,
                             ValidationError, ConflictError, SecretNotFoundError, AdapterError)

_STATUS = {AuthError: 401, Forbidden: 403, NotFoundError: 404, SecretNotFoundError: 404,
           ConflictError: 409, ValidationError: 422, AdapterError: 502}

def register_exception_handlers(app: FastAPI) -> None:
    async def handler(request: Request, exc: DomainError) -> JSONResponse:
        status = next((s for t, s in _STATUS.items() if isinstance(exc, t)), 500)
        return JSONResponse(status_code=status,
                            content={"error": {"code": exc.code, "message": exc.message}})
    app.add_exception_handler(DomainError, handler)
```
| Exception | HTTP | Notes |
|---|---|---|
| `AuthError` | 401 | missing/invalid/expired token, bad credentials |
| `Forbidden` | 403 | RBAC role mismatch / ownership |
| `NotFoundError` | 404 | `BaseRepository.get` miss |
| `SecretNotFoundError` | 404 | bad secret ref |
| `ConflictError` | 409 | duplicate (used in M1+) |
| `ValidationError` | 422 | domain validation beyond Pydantic |
| `AdapterError` | 502 | wrapped external/mock adapter failure |

> Adapter rule (architecture §5b): real adapters catch provider exceptions and re-raise `AdapterError`; domain services never see raw HTTP errors. Mocks don't raise, but the handler + type exist now so M0 ships the full contract.

### Secret redaction log filter (`app/core/logging.py`)
A logging `Filter` that scrubs known secret keys (`password`, `api_key`, `hashed_password`, `token`) from any `LogRecord.args`/`extra` before emission — backstop so F-009/F-012 "no plaintext in logs" holds even if a caller is careless.

---

## 15. Testing approach

### Layout
`backend/tests/` (one file per F-ID, see §1 tree). Framework: **pytest + pytest-asyncio `>=0.24`** (`asyncio_mode=auto`, `asyncio_default_fixture_loop_scope="session"`), HTTP via **httpx.AsyncClient + ASGITransport**.

### Test database strategy
> **Choice: transactional rollback per test against a dedicated test DB.** A session-scoped fixture creates a `lendrail_test` database (or uses `DATABASE_URL` with `?...` swap) and runs `alembic upgrade head` once. Each test opens a connection, begins an outer transaction, binds the session to it, and **rolls back** at teardown. This is fast (no re-migration per test) and fully isolated. We do not use create_all/drop_all per test — migrations are the schema source of truth, exercising F-002.
>
> **Event-loop requirement (mandatory, not optional):** the session-scoped `test_engine` fixture and the function-scoped per-test fixtures must run on **one shared event loop**. This requires `pytest-asyncio>=0.24` and `asyncio_default_fixture_loop_scope = "session"` in `pyproject.toml` (set in §16). Under the previously-pinned 0.23 this exact pattern (session async fixture + function tests) breaks with cross-loop errors. If a future engineer prefers to avoid session-scoped async fixtures entirely, the sanctioned alternative is a **function-scoped engine** — but the session-scoped form is preferred for speed and is what conftest below assumes.

### `conftest.py` fixtures (signatures)
```python
@pytest.fixture(scope="session")
async def test_engine() -> AsyncEngine: ...           # creates DB, runs alembic upgrade head

@pytest.fixture
async def db_session(test_engine) -> AsyncSession:     # outer-transaction + rollback per test
    ...

@pytest.fixture
async def app(db_session) -> FastAPI:                  # create_app() + dependency_overrides
    # override get_session → db_session; override adapters → seeded mocks
    ...

@pytest.fixture
async def client(app) -> AsyncClient:                  # httpx AsyncClient(ASGITransport(app))
    ...

@pytest.fixture
def seed_user(db_session): ...                         # inserts a User with known password/role

@pytest.fixture
def auth_headers(seed_user): ...                       # returns {"Authorization": f"Bearer {token}"}
```
Mock adapters in tests: injected via `app.dependency_overrides[get_custodian_adapter] = lambda: MockCustodianAdapter(inventory={"BTC": 0.0})` to exercise seeded states without env changes.

### F-ID → concrete test mapping
| F-ID | Test(s) | Asserts |
|---|---|---|
| F-001 | `test_health.py::test_healthz_ok` | `GET /healthz` → 200, body `{"status":"ok"}`. (compose-up criteria validated manually / CI smoke) |
| F-002 | `test_migrations.py::test_upgrade_downgrade_roundtrip` | `alembic upgrade head` → `downgrade base` → `upgrade head` no error; `users`+`notifications` exist; history ≥1 |
| F-003 | `test_repository.py::test_create_and_read_back` / `::test_get_missing_raises_notfound` | round-trip via repo; missing id raises `NotFoundError` not SQLAlchemy error; session closes (no leaked conns) |
| F-004 | `test_auth.py` | login valid→200+token; wrong pw→401; no token→401 on `/auth/me`; tampered token→401; decoded claims have `user_id/org_id/role` types; key from `JWT_SECRET` |
| F-005 | `test_rbac.py` | agent-guarded route + supplier token→403; supplier-guarded + agent→403; admin passes admin guard; all 3×3 combos; only `AuthUser` crosses into services |
| F-006 | `test_notifications.py` | `send(NotificationEvent("test",[uid]))` logs structured line w/ event+recipients (caplog); writes `notifications` row; no external call |
| F-007 | `test_worker.py` | `health_check_job(ctx)` returns "ok"/logs; `WorkerSettings.cron_jobs` contains a cron firing every minute (assert the entry exists); `on_job_end` with a seeded `ctx["exception"]` logs at ERROR with `exc_info` (caplog asserts level + traceback) and does not raise; `REDIS_URL` read from env |
| F-008 | `test_adapters.py` | all 4 custodian methods on mock; `get_inventory` → ≥1 BTC position w/ non-null as_of; `validate_key` True; `transmit_instruction` success+non-empty ref; market `get_price` positive; non-mock env → `NotImplementedError` |
| F-009 | `test_secret_store.py` | `store` returns UUID; `retrieve` round-trips plaintext; plaintext absent from caplog; bad ref → `SecretNotFoundError`; key derived from `JWT_SECRET` |
| F-060 | `test_openapi.py` | `GET /openapi.json` → 200 valid OpenAPI 3.x; `info.title=="LendRail API"`; `/auth/login` path present; `LoginRequest`/`TokenResponse` schemas present |

CI runs `ruff check`, `mypy app`, then `pytest` inside the api image against a Dockerized test Postgres + Redis.

---

## 16. Pinned dependencies — proposed `backend/pyproject.toml`

```toml
[project]
name = "lendrail-backend"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = [
    "fastapi>=0.111,<0.116",
    "uvicorn[standard]>=0.30,<0.35",
    "sqlalchemy[asyncio]>=2.0.30,<2.1",
    "asyncpg>=0.29,<0.31",
    "alembic>=1.13,<1.15",
    "pydantic>=2.7,<3.0",
    "pydantic-settings>=2.3,<3.0",
    "email-validator>=2.1,<3.0",          # EmailStr support
    "pyjwt>=2.8,<3.0",                     # JWT encode/decode (python-jose is unmaintained)
    "passlib[bcrypt]>=1.7.4,<2.0",
    "bcrypt>=4.1,<5.0",                    # pin: passlib+bcrypt 4.x compat
    "cryptography>=42.0,<44.0",           # AES-256-GCM
    "arq>=0.26,<0.27",
    "redis>=5.0,<6.0",
    "python-multipart>=0.0.9,<0.1",       # form parsing (login if form-encoded)
]

[project.optional-dependencies]
dev = [
    "pytest>=8.2,<9.0",
    "pytest-asyncio>=0.24,<0.26",         # >=0.24 for stable cross-scope event loops (see test-DB strategy)
    "httpx>=0.27,<0.28",
    "ruff>=0.5,<0.7",
    "mypy>=1.10,<2.0",
    "asgi-lifespan>=2.1,<3.0",            # lifespan in tests if needed
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "session"   # required: session-scoped engine shares one loop with function-scoped tests
testpaths = ["tests"]

[tool.ruff]
target-version = "py312"
line-length = 100

[tool.mypy]
python_version = "3.12"
strict = true
plugins = ["pydantic.mypy"]
```
> **Pin notes:** `bcrypt` pinned `<5` because passlib 1.7.4 reads `bcrypt.__about__` which 5.x removed — a common breakage (M1/F-012 should retire passlib in favor of `bcrypt` directly or `pwdlib`). **`pyjwt` replaces `python-jose`** (the latter is unmaintained with an unpatched advisory surface). `pytest-asyncio` pinned `>=0.24` and `asyncio_default_fixture_loop_scope="session"` is mandatory — the session-scoped migrated engine + per-test rollback fixture must share one event loop; 0.23 broke this. `pydantic>=2.7` for stable v2 settings behavior.

---

## 17. Decisions — tech-lead review outcomes

The tech-lead review (`M0-backend-techspec-review.md`) resolved all seven flagged items. Resolutions are now folded into the spec above.

1. **`users.org_id` nullable + `role` on user in M0** — **APPROVED as-is.** Auth needs a user table before `organizations` exists (M1). M0 ships `users` with a nullable `org_id` (FK added in M1) and `role` on the user. **M1 obligation:** F-011/F-012 migration must add the FK and backfill/validate `org_id` before making it non-null.
2. **Adapter Protocols** — **RESOLVED → async.** Protocols and mock methods are now `async def` (§10) to avoid a later breaking change across all call sites; ARCHITECTURE.md §5 to be updated to match.
3. **Secret store process-local in M0** — **APPROVED with change (applied).** §11 now documents the single-process limitation and adds a **hard M2 gate** making ciphertext-in-Postgres a precondition of F-024.
4. **Test DB strategy = transactional rollback against a real migrated DB** — **APPROVED with change (applied).** Kept the strategy; bumped `pytest-asyncio>=0.24` and pinned `asyncio_default_fixture_loop_scope="session"` (§15/§16) so the session-scoped engine and function-scoped tests share one event loop.
5. **Migrations auto-applied on `api` container start** — **APPROVED with change.** Entrypoint `alembic upgrade head` is **local-only**; it must wait-for-postgres first, and prod uses a separate gated migration job (never auto-migrate across replicas). See §3.
6. **`/healthz` canonical** — **APPROVED as-is.** ARCHITECTURE.md is silent on a health path; `/healthz` (matching F-001 verbatim) is canonical. Self-referential note in §3 cleaned.
7. **AES key derivation** — **APPROVED with change (applied).** §11 now mandates a high-entropy random `SECRET_STORE_KEY` outside `local` (no `JWT_SECRET` fallback) and documents that coupling the key to `JWT_SECRET` means a JWT rotation invalidates stored ciphertext. Prod path is a managed vault.

### Library/dependency changes from review (applied)
- **`python-jose` → `pyjwt`** (Blocker): the former is unmaintained. §6.2/§12/§16 updated.
- **`pytest-asyncio` `>=0.24`** + explicit session loop scope (Blocker): §16.
- **`passlib` retirement** flagged for M1/F-012 (Minor): prefer `bcrypt` directly or `pwdlib` before a bcrypt-5 upgrade.

### Remaining minor items (deferred, non-blocking)
These review minors are intentionally left for implementation time, not blockers: constant-time login dummy-hash in code (§6.4 prose already specifies it — implement in code), worker per-job session/commit boundary (define at M4), drop unused `python-multipart`, and noting the two F-001 criteria (`localhost:5173` HTML, full `compose down -v`/`up`) are jointly owned with F-010 at integration.
```
