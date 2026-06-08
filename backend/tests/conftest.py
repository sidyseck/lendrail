"""Test fixtures.

For DB-direct tests (repository, notifications): use a fresh NullPool engine + session.
For HTTP client tests (auth, health, rbac, openapi): use httpx + ASGITransport with
  the real get_session dependency (backed by a test-scoped DB with tables truncated).

NullPool avoids asyncpg cross-loop issues in pytest-asyncio 0.25.
"""
import os
import subprocess
import sys
import uuid
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.pool import NullPool
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Set test env vars BEFORE any app imports resolve settings
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://lendrail:lendrail@localhost:5432/lendrail_test",
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "test-secret-for-pytest-only-32bytes!!")

from fastapi import FastAPI  # noqa: E402

from app.api.deps import get_custodian_adapter, get_market_data_adapter, get_session  # noqa: E402
from app.adapters.mock_custodian import MockCustodianAdapter  # noqa: E402
from app.adapters.mock_market_data import MockMarketDataAdapter  # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.user import User  # noqa: E402

TEST_DATABASE_URL = os.environ["DATABASE_URL"]
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALEMBIC_INI = os.path.join(BACKEND_DIR, "alembic.ini")

_TABLES_TO_TRUNCATE = [
    "notifications",
    "loan_state_transitions",
    "loans",
    "connection_approved_borrowers",
    "borrowers",
    "lending_agreements",
    "connections",
    "custodian_links",
    "users",
    "organizations",
]


def _run_alembic(*args: str) -> None:
    """Run alembic in a subprocess to avoid event-loop conflicts."""
    env = os.environ.copy()
    env["DATABASE_URL"] = TEST_DATABASE_URL
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", ALEMBIC_INI, *args],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"alembic {' '.join(args)} failed:\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )


def _truncate_tables_sync() -> None:
    """Truncate test tables synchronously (psycopg2) to avoid asyncpg loop issues."""
    import asyncio

    async def _do() -> None:
        engine = create_async_engine(TEST_DATABASE_URL, echo=False, poolclass=NullPool)
        async with engine.connect() as conn:
            for table in _TABLES_TO_TRUNCATE:
                await conn.execute(text(f"TRUNCATE TABLE {table} CASCADE"))
            await conn.commit()
        await engine.dispose()

    asyncio.run(_do())


@pytest.fixture(scope="session", autouse=True)
def run_migrations() -> None:
    """Run alembic upgrade head once per session before any tests."""
    _run_alembic("upgrade", "head")


@pytest.fixture(autouse=True)
def truncate_tables(run_migrations: None) -> None:
    """Truncate tables before each test (sync, via subprocess to avoid loop issues)."""
    _truncate_tables_sync()


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Direct DB session for repository/domain tests. NullPool to avoid cross-loop issues."""
    engine = create_async_engine(TEST_DATABASE_URL, echo=False, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with factory() as session:
        yield session
        try:
            await session.commit()
        except Exception:
            pass
    # Don't await engine.dispose() here — the event loop may be closed at this point
    # in pytest-asyncio 0.25+. NullPool connections are not kept alive so this is safe.


# test_engine for migration tests
@pytest_asyncio.fixture
async def test_engine() -> AsyncGenerator:  # type: ignore[type-arg]
    engine = create_async_engine(TEST_DATABASE_URL, echo=False, poolclass=NullPool)
    yield engine
    # Don't await engine.dispose() — see db_session note above


def _make_app_with_overrides() -> FastAPI:
    """Create the FastAPI app with adapter overrides only (session not overridden)."""
    _app = create_app()

    # Override get_session to use NullPool engine for test isolation
    async def test_get_session() -> AsyncGenerator[AsyncSession, None]:
        engine = create_async_engine(TEST_DATABASE_URL, echo=False, poolclass=NullPool)
        factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()
        await engine.dispose()

    _app.dependency_overrides[get_session] = test_get_session
    _app.dependency_overrides[get_custodian_adapter] = lambda: MockCustodianAdapter()
    _app.dependency_overrides[get_market_data_adapter] = lambda: MockMarketDataAdapter()
    return _app


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """httpx AsyncClient. Creates its own session per request via override."""
    _app = _make_app_with_overrides()
    async with AsyncClient(transport=ASGITransport(app=_app), base_url="http://test") as c:
        yield c


# app fixture for tests that need to inspect/override the app directly
@pytest.fixture
def app() -> FastAPI:
    return _make_app_with_overrides()


async def _insert_user(email: str, password: str, role: str) -> User:
    """Insert an org + user directly into the test DB (org_id required after M2 migration 0005)."""
    from sqlalchemy import text as sa_text
    from app.models.organization import Organization

    org_role = role if role in ("supplier", "agent") else "supplier"
    engine = create_async_engine(TEST_DATABASE_URL, echo=False, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    async with factory() as session:
        await session.execute(
            sa_text(
                "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
                "VALUES (:id, :name, 'Test Jurisdiction', 'fund', :role, :email, 'approved')"
            ),
            {"id": str(org_id), "name": f"Test Org {org_id}", "role": org_role, "email": f"org-{org_id}@example.com"},
        )
        await session.execute(
            sa_text(
                "INSERT INTO users (id, email, hashed_password, role, org_id) "
                "VALUES (:id, :email, :hashed_password, :role, :org_id)"
            ),
            {
                "id": str(user_id),
                "email": email,
                "hashed_password": hash_password(password),
                "role": role,
                "org_id": str(org_id),
            },
        )
        await session.commit()
    # Fetch the user back
    async with factory() as session:
        result = await session.execute(sa_text("SELECT * FROM users WHERE id = :id"), {"id": str(user_id)})
        row = result.mappings().one()
    await engine.dispose()
    user = User(
        id=uuid.UUID(str(row["id"])),
        email=row["email"],
        hashed_password=row["hashed_password"],
        role=row["role"],
        org_id=uuid.UUID(str(row["org_id"])),
    )
    return user


@pytest_asyncio.fixture
async def seed_user() -> User:
    return await _insert_user("test@example.com", "correct-password", "supplier")


@pytest_asyncio.fixture
async def seed_agent() -> User:
    return await _insert_user("agent@example.com", "agent-password", "agent")


@pytest_asyncio.fixture
async def seed_admin() -> User:
    return await _insert_user("admin@example.com", "admin-password", "admin")


def make_auth_headers(user: User) -> dict[str, str]:
    token = create_access_token(
        user_id=str(user.id),
        org_id=str(user.org_id) if user.org_id else None,
        role=user.role,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers(seed_user: User) -> dict[str, str]:
    return make_auth_headers(seed_user)


@pytest.fixture
def agent_auth_headers(seed_agent: User) -> dict[str, str]:
    return make_auth_headers(seed_agent)


@pytest.fixture
def admin_auth_headers(seed_admin: User) -> dict[str, str]:
    return make_auth_headers(seed_admin)
