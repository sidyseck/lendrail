"""M2 connection tests — F-020 through F-026."""
import os
import subprocess
import sys
import uuid

import jwt
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.adapters.mock_custodian import MockCustodianAdapter
from app.api.deps import get_custodian_adapter
from app.core.config import get_settings
from app.core.security import create_access_token

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALEMBIC_INI = os.path.join(BACKEND_DIR, "alembic.ini")
TEST_DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://lendrail:lendrail@localhost:5432/lendrail_test",
)


def _alembic(*args: str) -> None:
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
            f"alembic {' '.join(args)} failed:\nstdout: {result.stdout}\nstderr: {result.stderr}"
        )


# ── Helpers ────────────────────────────────────────────────────────────────────

def _unique_supplier(**overrides) -> dict:
    uid = uuid.uuid4().hex[:8]
    p = {
        "name": f"Test Supplier {uid}",
        "jurisdiction": "Delaware, USA",
        "entity_type": "fund",
        "contact_email": f"supplier-{uid}@example.com",
        "password": "Str0ngP@ssword!1",
    }
    p.update(overrides)
    return p


def _unique_agent(**overrides) -> dict:
    uid = uuid.uuid4().hex[:8]
    p = {
        "name": f"Test Agent {uid}",
        "jurisdiction": "Delaware, USA",
        "entity_type": "fund",
        "contact_email": f"agent-{uid}@example.com",
        "password": "Str0ngP@ssword!2",
        "ops_contact_email": f"ops-{uid}@example.com",
        "regulatory_status_attested": True,
    }
    p.update(overrides)
    return p


def _unique_admin(**overrides) -> dict:
    uid = uuid.uuid4().hex[:8]
    p = {
        "name": f"Test Admin {uid}",
        "jurisdiction": "Delaware, USA",
        "entity_type": "fund",
        "contact_email": f"admin-{uid}@example.com",
        "password": "Str0ngP@ssword!3",
    }
    p.update(overrides)
    return p


async def _register_supplier(client: AsyncClient) -> dict:
    resp = await client.post("/orgs/register/supplier", json=_unique_supplier())
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _register_agent(client: AsyncClient) -> dict:
    resp = await client.post("/orgs/register/agent", json=_unique_agent())
    assert resp.status_code == 201, resp.text
    return resp.json()


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _decode_org_id(token: str) -> str:
    s = get_settings()
    claims = jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])
    return claims["org_id"]


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def supplier_data(client: AsyncClient) -> dict:
    """Register a supplier and return {token, org_id, headers}."""
    data = await _register_supplier(client)
    token = data["access_token"]
    return {"token": token, "org_id": data["org_id"], "headers": _headers(token)}


@pytest_asyncio.fixture
async def agent_data(client: AsyncClient) -> dict:
    """Register an agent and return {token, org_id, headers}."""
    data = await _register_agent(client)
    token = data["access_token"]
    return {"token": token, "org_id": data["org_id"], "headers": _headers(token)}


@pytest_asyncio.fixture
async def admin_data(client: AsyncClient) -> dict:
    """Create an admin token directly (no org registration endpoint for admin)."""
    admin_org_id = str(uuid.uuid4())
    # Insert org + admin user directly
    engine = create_async_engine(TEST_DATABASE_URL, echo=False, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    uid = uuid.uuid4()
    async with factory() as session:
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
                "VALUES (:id, 'Admin Org', 'US', 'fund', 'supplier', :email, 'approved')"
            ),
            {"id": admin_org_id, "email": f"adminorg-{admin_org_id}@example.com"},
        )
        await session.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, role, org_id) "
                "VALUES (:id, :email, 'x', 'admin', :org_id)"
            ),
            {"id": str(uid), "email": f"admin-{uid}@example.com", "org_id": admin_org_id},
        )
        await session.commit()
    await engine.dispose()
    token = create_access_token(user_id=str(uid), org_id=admin_org_id, role="admin")
    return {"token": token, "org_id": admin_org_id, "headers": _headers(token)}


@pytest_asyncio.fixture
async def pending_connection(client: AsyncClient, supplier_data: dict, agent_data: dict) -> dict:
    """Invite agent → pending connection. Returns {connection_id, supplier, agent}."""
    resp = await client.post(
        "/connections/invite",
        json={"agent_org_id": agent_data["org_id"]},
        headers=supplier_data["headers"],
    )
    assert resp.status_code == 201, resp.text
    conn_id = resp.json()["connection_id"]
    return {"connection_id": conn_id, "supplier": supplier_data, "agent": agent_data}


@pytest_asyncio.fixture
async def accepted_connection(client: AsyncClient, pending_connection: dict) -> dict:
    """Accept the pending connection. Returns same dict with status=accepted."""
    conn_id = pending_connection["connection_id"]
    resp = await client.post(
        f"/connections/{conn_id}/accept",
        headers=pending_connection["agent"]["headers"],
    )
    assert resp.status_code == 200, resp.text
    return pending_connection


@pytest_asyncio.fixture
async def active_connection(client: AsyncClient, accepted_connection: dict) -> dict:
    """Register key to make connection active."""
    conn_id = accepted_connection["connection_id"]
    resp = await client.post(
        f"/connections/{conn_id}/custodian-key",
        json={"custodian_id": "mock", "account_ref": "acct-001", "plaintext_key": "test-key-value"},
        headers=accepted_connection["supplier"]["headers"],
    )
    assert resp.status_code == 200, resp.text
    return accepted_connection


# ── M2 gate — null org_id guard ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_no_null_org_id_users_after_m1_fixtures(db_session: AsyncSession) -> None:
    """After all conftest fixtures, no user should have NULL org_id."""
    result = await db_session.execute(
        text("SELECT COUNT(*) FROM users WHERE org_id IS NULL")
    )
    count = result.scalar()
    assert count == 0, f"Found {count} user(s) with NULL org_id — M2 gate violated"


# ── F-020 — custodian_links migration ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_0007_migration_applies(test_engine: AsyncEngine) -> None:
    """custodian_links table exists after upgrade head."""
    async with test_engine.connect() as conn:
        tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
        assert "custodian_links" in tables
        # Check enum exists
        result = await conn.execute(
            text("SELECT typname FROM pg_type WHERE typname = 'custodian_link_status_enum'")
        )
        assert result.scalar() == "custodian_link_status_enum"
        # Check FK constraint exists
        result2 = await conn.execute(
            text(
                "SELECT constraint_name FROM information_schema.table_constraints "
                "WHERE table_name = 'custodian_links' AND constraint_name = 'fk_custodian_links_org_id_organizations'"
            )
        )
        assert result2.scalar() is not None


@pytest.mark.asyncio
async def test_custodian_link_default_status_active(db_session: AsyncSession) -> None:
    """Insert custodian_link without status → default is active."""
    org_id = str(uuid.uuid4())
    link_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
            "VALUES (:id, 'TestOrg', 'US', 'fund', 'supplier', :email, 'approved')"
        ),
        {"id": org_id, "email": f"org-{org_id}@example.com"},
    )
    await db_session.execute(
        text(
            "INSERT INTO custodian_links (id, org_id, custodian_id, account_ref, encrypted_api_key_ref, scope) "
            "VALUES (:id, :org_id, 'mock', 'acct', 'ref-001', '{}'::jsonb)"
        ),
        {"id": link_id, "org_id": org_id},
    )
    await db_session.flush()
    result = await db_session.execute(
        text("SELECT status FROM custodian_links WHERE id = :id"), {"id": link_id}
    )
    assert result.scalar() == "active"


@pytest.mark.asyncio
async def test_custodian_link_status_enum_constraint(db_session: AsyncSession) -> None:
    """Insert custodian_link with invalid status → DataError."""
    org_id = str(uuid.uuid4())
    link_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
            "VALUES (:id, 'TestOrg2', 'US', 'fund', 'supplier', :email, 'approved')"
        ),
        {"id": org_id, "email": f"org2-{org_id}@example.com"},
    )
    with pytest.raises(Exception):
        await db_session.execute(
            text(
                "INSERT INTO custodian_links (id, org_id, custodian_id, account_ref, encrypted_api_key_ref, scope, status) "
                "VALUES (:id, :org_id, 'mock', 'acct', 'ref', '{}', 'banana')"
            ),
            {"id": link_id, "org_id": org_id},
        )
        await db_session.flush()


@pytest.mark.asyncio
async def test_custodian_link_org_id_fk_enforced(db_session: AsyncSession) -> None:
    """Insert custodian_link with non-existent org_id → IntegrityError."""
    with pytest.raises(Exception):
        await db_session.execute(
            text(
                "INSERT INTO custodian_links (id, org_id, custodian_id, account_ref, encrypted_api_key_ref, scope) "
                "VALUES (:id, :org_id, 'mock', 'acct', 'ref', '{}'::jsonb)"
            ),
            {"id": str(uuid.uuid4()), "org_id": str(uuid.uuid4())},
        )
        await db_session.flush()


@pytest.mark.asyncio
async def test_encrypted_api_key_ref_not_null(db_session: AsyncSession) -> None:
    """Insert custodian_link with encrypted_api_key_ref=NULL → IntegrityError."""
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
            "VALUES (:id, 'TestOrg3', 'US', 'fund', 'supplier', :email, 'approved')"
        ),
        {"id": org_id, "email": f"org3-{org_id}@example.com"},
    )
    with pytest.raises(Exception):
        await db_session.execute(
            text(
                "INSERT INTO custodian_links (id, org_id, custodian_id, account_ref, encrypted_api_key_ref, scope) "
                "VALUES (:id, :org_id, 'mock', 'acct', NULL, '{}'::jsonb)"
            ),
            {"id": str(uuid.uuid4()), "org_id": org_id},
        )
        await db_session.flush()


# ── F-021 — connections migration ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_0008_migration_applies(test_engine: AsyncEngine) -> None:
    """connections table + enum + partial index exist after upgrade head."""
    async with test_engine.connect() as conn:
        tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
        assert "connections" in tables
        # Check enum exists with accepted value
        result = await conn.execute(
            text("SELECT typname FROM pg_type WHERE typname = 'connection_status_enum'")
        )
        assert result.scalar() == "connection_status_enum"
        # Enum must include 'accepted'
        result2 = await conn.execute(
            text(
                "SELECT enumlabel FROM pg_enum e "
                "JOIN pg_type t ON e.enumtypid = t.oid "
                "WHERE t.typname = 'connection_status_enum'"
            )
        )
        labels = {row[0] for row in result2}
        assert {"pending", "accepted", "active", "suspended", "terminated"} == labels
        # Partial index must exist
        result3 = await conn.execute(
            text(
                "SELECT indexname FROM pg_indexes "
                "WHERE tablename = 'connections' AND indexname = 'uq_connections_supplier_agent_active'"
            )
        )
        assert result3.scalar() is not None


@pytest.mark.asyncio
async def test_connection_status_enum_accepted_valid(db_session: AsyncSession) -> None:
    """Insert connection with status='accepted' succeeds."""
    sup_id, agt_id, conn_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    for (oid, role) in [(sup_id, "supplier"), (agt_id, "agent")]:
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
                "VALUES (:id, :name, 'US', 'fund', :role, :email, 'approved')"
            ),
            {"id": oid, "name": f"Org{oid}", "role": role, "email": f"org-{oid}@example.com"},
        )
    await db_session.execute(
        text(
            "INSERT INTO connections (id, supplier_id, agent_id, status) "
            "VALUES (:id, :sup, :agt, 'accepted')"
        ),
        {"id": conn_id, "sup": sup_id, "agt": agt_id},
    )
    await db_session.flush()
    result = await db_session.execute(
        text("SELECT status FROM connections WHERE id = :id"), {"id": conn_id}
    )
    assert result.scalar() == "accepted"


@pytest.mark.asyncio
async def test_connection_status_enum_constraint(db_session: AsyncSession) -> None:
    """Insert connection with invalid status → DataError."""
    sup_id, agt_id = str(uuid.uuid4()), str(uuid.uuid4())
    for (oid, role) in [(sup_id, "supplier"), (agt_id, "agent")]:
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
                "VALUES (:id, :name, 'US', 'fund', :role, :email, 'approved')"
            ),
            {"id": oid, "name": f"Org{oid}", "role": role, "email": f"org-{oid}@example.com"},
        )
    with pytest.raises(Exception):
        await db_session.execute(
            text(
                "INSERT INTO connections (id, supplier_id, agent_id, status) "
                "VALUES (:id, :sup, :agt, 'invalid')"
            ),
            {"id": str(uuid.uuid4()), "sup": sup_id, "agt": agt_id},
        )
        await db_session.flush()


@pytest.mark.asyncio
async def test_connection_unique_supplier_agent_non_terminated(db_session: AsyncSession) -> None:
    """Two non-terminated connections with same supplier/agent → IntegrityError."""
    sup_id, agt_id = str(uuid.uuid4()), str(uuid.uuid4())
    for (oid, role) in [(sup_id, "supplier"), (agt_id, "agent")]:
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
                "VALUES (:id, :name, 'US', 'fund', :role, :email, 'approved')"
            ),
            {"id": oid, "name": f"Org{oid}", "role": role, "email": f"org-{oid}@example.com"},
        )
    await db_session.execute(
        text("INSERT INTO connections (id, supplier_id, agent_id, status) VALUES (:id, :sup, :agt, 'pending')"),
        {"id": str(uuid.uuid4()), "sup": sup_id, "agt": agt_id},
    )
    await db_session.flush()
    with pytest.raises(Exception):
        await db_session.execute(
            text("INSERT INTO connections (id, supplier_id, agent_id, status) VALUES (:id, :sup, :agt, 'pending')"),
            {"id": str(uuid.uuid4()), "sup": sup_id, "agt": agt_id},
        )
        await db_session.flush()


@pytest.mark.asyncio
async def test_connection_reinvite_after_termination(db_session: AsyncSession) -> None:
    """After terminated connection, same pair can have new pending row."""
    sup_id, agt_id = str(uuid.uuid4()), str(uuid.uuid4())
    for (oid, role) in [(sup_id, "supplier"), (agt_id, "agent")]:
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
                "VALUES (:id, :name, 'US', 'fund', :role, :email, 'approved')"
            ),
            {"id": oid, "name": f"Org{oid}", "role": role, "email": f"org-{oid}@example.com"},
        )
    await db_session.execute(
        text("INSERT INTO connections (id, supplier_id, agent_id, status) VALUES (:id, :sup, :agt, 'terminated')"),
        {"id": str(uuid.uuid4()), "sup": sup_id, "agt": agt_id},
    )
    await db_session.flush()
    # Now insert another pending — should succeed
    await db_session.execute(
        text("INSERT INTO connections (id, supplier_id, agent_id, status) VALUES (:id, :sup, :agt, 'pending')"),
        {"id": str(uuid.uuid4()), "sup": sup_id, "agt": agt_id},
    )
    await db_session.flush()


@pytest.mark.asyncio
async def test_connection_custodian_link_id_nullable(db_session: AsyncSession) -> None:
    """Insert connection without custodian_link_id → succeeds."""
    sup_id, agt_id = str(uuid.uuid4()), str(uuid.uuid4())
    for (oid, role) in [(sup_id, "supplier"), (agt_id, "agent")]:
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
                "VALUES (:id, :name, 'US', 'fund', :role, :email, 'approved')"
            ),
            {"id": oid, "name": f"Org{oid}", "role": role, "email": f"org-{oid}@example.com"},
        )
    conn_id = str(uuid.uuid4())
    await db_session.execute(
        text("INSERT INTO connections (id, supplier_id, agent_id, status) VALUES (:id, :sup, :agt, 'pending')"),
        {"id": conn_id, "sup": sup_id, "agt": agt_id},
    )
    await db_session.flush()
    result = await db_session.execute(
        text("SELECT custodian_link_id FROM connections WHERE id = :id"), {"id": conn_id}
    )
    assert result.scalar() is None


@pytest.mark.asyncio
async def test_connection_default_status_pending(db_session: AsyncSession) -> None:
    """Insert connection without status → default is pending."""
    sup_id, agt_id = str(uuid.uuid4()), str(uuid.uuid4())
    for (oid, role) in [(sup_id, "supplier"), (agt_id, "agent")]:
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
                "VALUES (:id, :name, 'US', 'fund', :role, :email, 'approved')"
            ),
            {"id": oid, "name": f"Org{oid}", "role": role, "email": f"org-{oid}@example.com"},
        )
    conn_id = str(uuid.uuid4())
    await db_session.execute(
        text("INSERT INTO connections (id, supplier_id, agent_id) VALUES (:id, :sup, :agt)"),
        {"id": conn_id, "sup": sup_id, "agt": agt_id},
    )
    await db_session.flush()
    result = await db_session.execute(
        text("SELECT status FROM connections WHERE id = :id"), {"id": conn_id}
    )
    assert result.scalar() == "pending"


# ── M2 gate migrations ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_0005_migration_not_null_applies(test_engine: AsyncEngine) -> None:
    """users.org_id is NOT NULL after migration 0005."""
    async with test_engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_name = 'users' AND column_name = 'org_id'"
            )
        )
        is_nullable = result.scalar()
        assert is_nullable == "NO"


@pytest.mark.asyncio
async def test_0006_fk_migration_applies(test_engine: AsyncEngine) -> None:
    """fk_notifications_user_id_users FK exists."""
    async with test_engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT constraint_name FROM information_schema.table_constraints "
                "WHERE table_name = 'notifications' AND constraint_name = 'fk_notifications_user_id_users'"
            )
        )
        assert result.scalar() is not None


@pytest.mark.asyncio
async def test_0006_scrubs_orphaned_notifications(db_session: AsyncSession) -> None:
    """Migration 0006 scrubs orphaned notifications (already applied in upgrade head)."""
    # After head upgrade, any notification with non-existent user_id was removed.
    # Insert a notification with valid user to confirm FK works now.
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
            "VALUES (:id, 'NotifOrg', 'US', 'fund', 'supplier', :email, 'approved')"
        ),
        {"id": org_id, "email": f"notiforg-{org_id}@example.com"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, email, hashed_password, role, org_id) "
            "VALUES (:id, :email, 'x', 'supplier', :org_id)"
        ),
        {"id": user_id, "email": f"notifuser-{user_id}@example.com", "org_id": org_id},
    )
    # Insert notification with valid user_id — should work
    notif_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO notifications (id, user_id, event, payload) "
            "VALUES (:id, :user_id, 'test', '{}'::jsonb)"
        ),
        {"id": notif_id, "user_id": user_id},
    )
    await db_session.flush()
    result = await db_session.execute(
        text("SELECT COUNT(*) FROM notifications WHERE id = :id"), {"id": notif_id}
    )
    assert result.scalar() == 1


# ── F-022 — POST /connections/invite ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_invite_by_org_id_201(client: AsyncClient, supplier_data: dict, agent_data: dict) -> None:
    resp = await client.post(
        "/connections/invite",
        json={"agent_org_id": agent_data["org_id"]},
        headers=supplier_data["headers"],
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert "connection_id" in body
    assert body["status"] == "pending"
    assert body["custodian_link_present"] is False


@pytest.mark.asyncio
async def test_invite_creates_pending_connection_in_db(
    client: AsyncClient, supplier_data: dict, agent_data: dict, db_session: AsyncSession
) -> None:
    resp = await client.post(
        "/connections/invite",
        json={"agent_org_id": agent_data["org_id"]},
        headers=supplier_data["headers"],
    )
    assert resp.status_code == 201, resp.text
    conn_id = resp.json()["connection_id"]
    result = await db_session.execute(
        text("SELECT status, supplier_id, agent_id FROM connections WHERE id = :id"),
        {"id": conn_id},
    )
    row = result.mappings().one()
    assert row["status"] == "pending"
    assert str(row["supplier_id"]) == supplier_data["org_id"]
    assert str(row["agent_id"]) == agent_data["org_id"]


@pytest.mark.asyncio
async def test_invite_with_agent_jwt_403(client: AsyncClient, agent_data: dict) -> None:
    resp = await client.post(
        "/connections/invite",
        json={"agent_org_id": str(uuid.uuid4())},
        headers=agent_data["headers"],
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_invite_missing_both_fields_422(client: AsyncClient, supplier_data: dict) -> None:
    resp = await client.post(
        "/connections/invite",
        json={},
        headers=supplier_data["headers"],
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_invite_both_fields_422(client: AsyncClient, supplier_data: dict, agent_data: dict) -> None:
    resp = await client.post(
        "/connections/invite",
        json={"agent_org_id": agent_data["org_id"], "agent_email": "foo@example.com"},
        headers=supplier_data["headers"],
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_invite_nonexistent_agent_org_id_404(client: AsyncClient, supplier_data: dict) -> None:
    resp = await client.post(
        "/connections/invite",
        json={"agent_org_id": str(uuid.uuid4())},
        headers=supplier_data["headers"],
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "agent_not_found"


@pytest.mark.asyncio
async def test_invite_supplier_org_as_agent_422(
    client: AsyncClient, supplier_data: dict
) -> None:
    """Inviting own (supplier) org as agent → code=not_an_agent."""
    resp = await client.post(
        "/connections/invite",
        json={"agent_org_id": supplier_data["org_id"]},
        headers=supplier_data["headers"],
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "not_an_agent"


@pytest.mark.asyncio
async def test_invite_duplicate_409(
    client: AsyncClient, supplier_data: dict, agent_data: dict
) -> None:
    await client.post(
        "/connections/invite",
        json={"agent_org_id": agent_data["org_id"]},
        headers=supplier_data["headers"],
    )
    resp = await client.post(
        "/connections/invite",
        json={"agent_org_id": agent_data["org_id"]},
        headers=supplier_data["headers"],
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "connection_already_exists"


@pytest.mark.asyncio
async def test_invite_after_termination_201(
    client: AsyncClient, active_connection: dict
) -> None:
    """Re-invite same agent after termination → new pending connection."""
    conn_id = active_connection["connection_id"]
    sup_h = active_connection["supplier"]["headers"]
    agt_org_id = active_connection["agent"]["org_id"]

    # Terminate
    resp = await client.post(f"/connections/{conn_id}/terminate", headers=sup_h)
    assert resp.status_code == 200

    # Re-invite
    resp2 = await client.post(
        "/connections/invite",
        json={"agent_org_id": agt_org_id},
        headers=sup_h,
    )
    assert resp2.status_code == 201
    new_conn_id = resp2.json()["connection_id"]
    assert new_conn_id != conn_id
    assert resp2.json()["status"] == "pending"


@pytest.mark.asyncio
async def test_invite_unknown_email_202(
    client: AsyncClient, supplier_data: dict, caplog
) -> None:
    """Unknown agent email → HTTP 202."""
    import logging
    with caplog.at_level(logging.INFO):
        resp = await client.post(
            "/connections/invite",
            json={"agent_email": "unknown-agent-xyz@notregistered.com"},
            headers=supplier_data["headers"],
        )
    assert resp.status_code == 202
    assert "agent_email" in resp.json()
    assert "connection_invite_to_unknown" in caplog.text


@pytest.mark.asyncio
async def test_invite_known_email_201(
    client: AsyncClient, supplier_data: dict, agent_data: dict
) -> None:
    """Known agent email → HTTP 201."""
    # Get the agent's contact email
    s = get_settings()
    claims = jwt.decode(agent_data["token"], s.jwt_secret, algorithms=[s.jwt_algorithm])
    # We need to look up the agent's email via the org — just invite by email via a lookup
    # Instead, fetch the agent's org contact_email from DB
    engine = create_async_engine(TEST_DATABASE_URL, echo=False, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with factory() as session:
        result = await session.execute(
            text("SELECT contact_email FROM organizations WHERE id = :id"),
            {"id": agent_data["org_id"]},
        )
        agent_email = result.scalar()
    await engine.dispose()

    resp = await client.post(
        "/connections/invite",
        json={"agent_email": agent_email},
        headers=supplier_data["headers"],
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "pending"


@pytest.mark.asyncio
async def test_invite_no_token_401(client: AsyncClient, agent_data: dict) -> None:
    resp = await client.post(
        "/connections/invite",
        json={"agent_org_id": agent_data["org_id"]},
    )
    assert resp.status_code == 401


# ── F-023 — POST /connections/{id}/accept ────────────────────────────────────

@pytest.mark.asyncio
async def test_accept_200(client: AsyncClient, pending_connection: dict) -> None:
    conn_id = pending_connection["connection_id"]
    resp = await client.post(
        f"/connections/{conn_id}/accept",
        headers=pending_connection["agent"]["headers"],
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"


@pytest.mark.asyncio
async def test_accept_updates_db_status(
    client: AsyncClient, pending_connection: dict, db_session: AsyncSession
) -> None:
    conn_id = pending_connection["connection_id"]
    await client.post(f"/connections/{conn_id}/accept", headers=pending_connection["agent"]["headers"])
    result = await db_session.execute(
        text("SELECT status FROM connections WHERE id = :id"), {"id": conn_id}
    )
    assert result.scalar() == "accepted"


@pytest.mark.asyncio
async def test_accept_with_supplier_jwt_403(client: AsyncClient, pending_connection: dict) -> None:
    conn_id = pending_connection["connection_id"]
    resp = await client.post(
        f"/connections/{conn_id}/accept",
        headers=pending_connection["supplier"]["headers"],
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_accept_wrong_agent_org_403(
    client: AsyncClient, pending_connection: dict
) -> None:
    """Another agent org cannot accept this connection."""
    other_agent = await _register_agent(client)
    other_headers = _headers(other_agent["access_token"])
    conn_id = pending_connection["connection_id"]
    resp = await client.post(f"/connections/{conn_id}/accept", headers=other_headers)
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_accept_nonexistent_connection_404(
    client: AsyncClient, agent_data: dict
) -> None:
    resp = await client.post(
        f"/connections/{uuid.uuid4()}/accept",
        headers=agent_data["headers"],
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_accept_already_accepted_409(
    client: AsyncClient, accepted_connection: dict
) -> None:
    conn_id = accepted_connection["connection_id"]
    resp = await client.post(
        f"/connections/{conn_id}/accept",
        headers=accepted_connection["agent"]["headers"],
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "invalid_connection_status"


@pytest.mark.asyncio
async def test_accept_terminated_409(
    client: AsyncClient, active_connection: dict
) -> None:
    conn_id = active_connection["connection_id"]
    # Terminate first
    await client.post(f"/connections/{conn_id}/terminate", headers=active_connection["supplier"]["headers"])
    # Try to accept
    resp = await client.post(
        f"/connections/{conn_id}/accept",
        headers=active_connection["agent"]["headers"],
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "invalid_connection_status"


# ── F-024 — POST /connections/{id}/custodian-key ─────────────────────────────

@pytest.mark.asyncio
async def test_register_key_200_mock_valid(
    client: AsyncClient, accepted_connection: dict
) -> None:
    conn_id = accepted_connection["connection_id"]
    resp = await client.post(
        f"/connections/{conn_id}/custodian-key",
        json={"custodian_id": "mock", "account_ref": "acct-001", "plaintext_key": "test-key"},
        headers=accepted_connection["supplier"]["headers"],
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "active"
    assert body["custodian_link_present"] is True
    assert body["activated_at"] is not None


@pytest.mark.asyncio
async def test_register_key_no_plaintext_in_response(
    client: AsyncClient, accepted_connection: dict
) -> None:
    conn_id = accepted_connection["connection_id"]
    resp = await client.post(
        f"/connections/{conn_id}/custodian-key",
        json={"custodian_id": "mock", "account_ref": "acct-001", "plaintext_key": "supersecret-key-value"},
        headers=accepted_connection["supplier"]["headers"],
    )
    assert resp.status_code == 200
    assert "supersecret-key-value" not in str(resp.json())
    assert "plaintext_key" not in str(resp.json())


@pytest.mark.asyncio
async def test_register_key_no_plaintext_in_logs(
    client: AsyncClient, accepted_connection: dict, caplog
) -> None:
    import logging
    conn_id = accepted_connection["connection_id"]
    with caplog.at_level(logging.DEBUG):
        await client.post(
            f"/connections/{conn_id}/custodian-key",
            json={"custodian_id": "mock", "account_ref": "acct-001", "plaintext_key": "my-secret-api-key-xyz"},
            headers=accepted_connection["supplier"]["headers"],
        )
    assert "my-secret-api-key-xyz" not in caplog.text


@pytest.mark.asyncio
async def test_custodian_link_row_created(
    client: AsyncClient, accepted_connection: dict, db_session: AsyncSession
) -> None:
    conn_id = accepted_connection["connection_id"]
    resp = await client.post(
        f"/connections/{conn_id}/custodian-key",
        json={"custodian_id": "mock", "account_ref": "acct-001", "plaintext_key": "test-key"},
        headers=accepted_connection["supplier"]["headers"],
    )
    assert resp.status_code == 200
    result = await db_session.execute(
        text(
            "SELECT cl.encrypted_api_key_ref, cl.status "
            "FROM custodian_links cl "
            "JOIN connections c ON c.custodian_link_id = cl.id "
            "WHERE c.id = :conn_id"
        ),
        {"conn_id": conn_id},
    )
    row = result.mappings().one()
    assert row["status"] == "active"
    # encrypted_api_key_ref is a ref string, not the key
    assert row["encrypted_api_key_ref"] != "test-key"


@pytest.mark.asyncio
async def test_encrypted_api_key_ref_is_ref_not_key(
    client: AsyncClient, accepted_connection: dict, db_session: AsyncSession
) -> None:
    conn_id = accepted_connection["connection_id"]
    await client.post(
        f"/connections/{conn_id}/custodian-key",
        json={"custodian_id": "mock", "account_ref": "acct-001", "plaintext_key": "actual-secret-key"},
        headers=accepted_connection["supplier"]["headers"],
    )
    result = await db_session.execute(
        text(
            "SELECT cl.encrypted_api_key_ref "
            "FROM custodian_links cl "
            "JOIN connections c ON c.custodian_link_id = cl.id "
            "WHERE c.id = :conn_id"
        ),
        {"conn_id": conn_id},
    )
    ref = result.scalar()
    assert ref != "actual-secret-key"
    assert ref is not None


@pytest.mark.asyncio
async def test_register_key_422_mock_invalid(
    client: AsyncClient, accepted_connection: dict, app
) -> None:
    """Mock adapter seeded with validate_key_result=False → 422."""
    app.dependency_overrides[get_custodian_adapter] = lambda: MockCustodianAdapter(validate_key_result=False)
    from httpx import ASGITransport, AsyncClient as AC
    async with AC(transport=ASGITransport(app=app), base_url="http://test") as c:
        conn_id = accepted_connection["connection_id"]
        resp = await c.post(
            f"/connections/{conn_id}/custodian-key",
            json={"custodian_id": "mock", "account_ref": "acct-001", "plaintext_key": "bad-key"},
            headers=accepted_connection["supplier"]["headers"],
        )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "custodian_key_invalid"
    # Connection should remain accepted
    from app.api.deps import get_session as gs
    real_client_app = app
    # Check via the real client that status is still accepted
    async with AC(transport=ASGITransport(app=real_client_app), base_url="http://test") as c2:
        detail = await c2.get(
            f"/connections/{conn_id}",
            headers=accepted_connection["supplier"]["headers"],
        )
    assert detail.json()["status"] == "accepted"


@pytest.mark.asyncio
async def test_register_key_with_agent_jwt_403(
    client: AsyncClient, accepted_connection: dict
) -> None:
    conn_id = accepted_connection["connection_id"]
    resp = await client.post(
        f"/connections/{conn_id}/custodian-key",
        json={"custodian_id": "mock", "account_ref": "acct-001", "plaintext_key": "k"},
        headers=accepted_connection["agent"]["headers"],
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_register_key_nonexistent_connection_404(
    client: AsyncClient, supplier_data: dict
) -> None:
    resp = await client.post(
        f"/connections/{uuid.uuid4()}/custodian-key",
        json={"custodian_id": "mock", "account_ref": "acct-001", "plaintext_key": "k"},
        headers=supplier_data["headers"],
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_register_key_on_pending_connection_409(
    client: AsyncClient, pending_connection: dict
) -> None:
    conn_id = pending_connection["connection_id"]
    resp = await client.post(
        f"/connections/{conn_id}/custodian-key",
        json={"custodian_id": "mock", "account_ref": "acct-001", "plaintext_key": "k"},
        headers=pending_connection["supplier"]["headers"],
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "invalid_connection_status"


# ── F-025 — suspend and terminate ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_suspend_by_supplier_200(client: AsyncClient, active_connection: dict) -> None:
    conn_id = active_connection["connection_id"]
    resp = await client.post(f"/connections/{conn_id}/suspend", headers=active_connection["supplier"]["headers"])
    assert resp.status_code == 200
    assert resp.json()["status"] == "suspended"


@pytest.mark.asyncio
async def test_suspend_by_agent_200(client: AsyncClient, active_connection: dict) -> None:
    conn_id = active_connection["connection_id"]
    resp = await client.post(f"/connections/{conn_id}/suspend", headers=active_connection["agent"]["headers"])
    assert resp.status_code == 200
    assert resp.json()["status"] == "suspended"


@pytest.mark.asyncio
async def test_suspend_pending_409(client: AsyncClient, pending_connection: dict) -> None:
    conn_id = pending_connection["connection_id"]
    resp = await client.post(f"/connections/{conn_id}/suspend", headers=pending_connection["supplier"]["headers"])
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "invalid_connection_status"


@pytest.mark.asyncio
async def test_suspend_terminated_409(client: AsyncClient, active_connection: dict) -> None:
    conn_id = active_connection["connection_id"]
    await client.post(f"/connections/{conn_id}/terminate", headers=active_connection["supplier"]["headers"])
    resp = await client.post(f"/connections/{conn_id}/suspend", headers=active_connection["supplier"]["headers"])
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "invalid_connection_status"


@pytest.mark.asyncio
async def test_suspend_wrong_org_403(client: AsyncClient, active_connection: dict) -> None:
    """Third-party org cannot suspend."""
    other = await _register_supplier(client)
    other_headers = _headers(other["access_token"])
    conn_id = active_connection["connection_id"]
    resp = await client.post(f"/connections/{conn_id}/suspend", headers=other_headers)
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_terminate_by_supplier_200(client: AsyncClient, active_connection: dict) -> None:
    conn_id = active_connection["connection_id"]
    resp = await client.post(f"/connections/{conn_id}/terminate", headers=active_connection["supplier"]["headers"])
    assert resp.status_code == 200
    assert resp.json()["status"] == "terminated"
    assert resp.json()["flagged_loan_ids"] == []


@pytest.mark.asyncio
async def test_terminate_by_agent_200(client: AsyncClient, active_connection: dict) -> None:
    conn_id = active_connection["connection_id"]
    resp = await client.post(f"/connections/{conn_id}/terminate", headers=active_connection["agent"]["headers"])
    assert resp.status_code == 200
    assert resp.json()["status"] == "terminated"


@pytest.mark.asyncio
async def test_terminate_fires_rotate_key_notification(
    client: AsyncClient, active_connection: dict, caplog, db_session: AsyncSession
) -> None:
    import logging
    conn_id = active_connection["connection_id"]
    with caplog.at_level(logging.INFO):
        await client.post(f"/connections/{conn_id}/terminate", headers=active_connection["supplier"]["headers"])
    # Service logs connection_terminated; notification event is stored in DB
    assert "connection_terminated" in caplog.text
    # Verify the rotate_key notification event was stored in the notifications table
    result = await db_session.execute(
        text("SELECT COUNT(*) FROM notifications WHERE event = 'connection_terminated_rotate_key'")
    )
    assert result.scalar() >= 1


@pytest.mark.asyncio
async def test_terminate_response_includes_message(client: AsyncClient, active_connection: dict) -> None:
    conn_id = active_connection["connection_id"]
    resp = await client.post(f"/connections/{conn_id}/terminate", headers=active_connection["supplier"]["headers"])
    assert "rotate" in resp.json()["message"].lower() or "key" in resp.json()["message"].lower()


@pytest.mark.asyncio
async def test_terminate_already_terminated_409(client: AsyncClient, active_connection: dict) -> None:
    conn_id = active_connection["connection_id"]
    await client.post(f"/connections/{conn_id}/terminate", headers=active_connection["supplier"]["headers"])
    resp = await client.post(f"/connections/{conn_id}/terminate", headers=active_connection["supplier"]["headers"])
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "connection_already_terminated"


@pytest.mark.asyncio
async def test_terminate_wrong_org_403(client: AsyncClient, active_connection: dict) -> None:
    other = await _register_agent(client)
    other_headers = _headers(other["access_token"])
    conn_id = active_connection["connection_id"]
    resp = await client.post(f"/connections/{conn_id}/terminate", headers=other_headers)
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_terminate_admin_jwt_403(client: AsyncClient, active_connection: dict, admin_data: dict) -> None:
    conn_id = active_connection["connection_id"]
    resp = await client.post(f"/connections/{conn_id}/terminate", headers=admin_data["headers"])
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_suspend_no_token_401(client: AsyncClient, active_connection: dict) -> None:
    conn_id = active_connection["connection_id"]
    resp = await client.post(f"/connections/{conn_id}/suspend")
    assert resp.status_code == 401


# ── F-026 — GET /connections and GET /connections/{id} ───────────────────────

@pytest.mark.asyncio
async def test_list_supplier_sees_own_connections(
    client: AsyncClient, supplier_data: dict, agent_data: dict
) -> None:
    # Create a connection
    await client.post(
        "/connections/invite",
        json={"agent_org_id": agent_data["org_id"]},
        headers=supplier_data["headers"],
    )
    resp = await client.get("/connections", headers=supplier_data["headers"])
    assert resp.status_code == 200
    conns = resp.json()["connections"]
    assert len(conns) == 1
    assert all(c["supplier_id"] == supplier_data["org_id"] for c in conns)


@pytest.mark.asyncio
async def test_list_agent_sees_own_connections(
    client: AsyncClient, supplier_data: dict, agent_data: dict
) -> None:
    await client.post(
        "/connections/invite",
        json={"agent_org_id": agent_data["org_id"]},
        headers=supplier_data["headers"],
    )
    resp = await client.get("/connections", headers=agent_data["headers"])
    assert resp.status_code == 200
    conns = resp.json()["connections"]
    assert len(conns) == 1
    assert conns[0]["agent_id"] == agent_data["org_id"]


@pytest.mark.asyncio
async def test_list_admin_sees_all(
    client: AsyncClient, admin_data: dict, supplier_data: dict, agent_data: dict
) -> None:
    await client.post(
        "/connections/invite",
        json={"agent_org_id": agent_data["org_id"]},
        headers=supplier_data["headers"],
    )
    resp = await client.get("/connections", headers=admin_data["headers"])
    assert resp.status_code == 200
    assert len(resp.json()["connections"]) >= 1


@pytest.mark.asyncio
async def test_list_response_fields(
    client: AsyncClient, pending_connection: dict
) -> None:
    resp = await client.get("/connections", headers=pending_connection["supplier"]["headers"])
    assert resp.status_code == 200
    item = resp.json()["connections"][0]
    for field in ["connection_id", "supplier_id", "agent_id", "status", "custodian_link_present", "created_at", "activated_at"]:
        assert field in item, f"Missing field: {field}"


@pytest.mark.asyncio
async def test_list_no_token_401(client: AsyncClient) -> None:
    resp = await client.get("/connections")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_detail_supplier_200(client: AsyncClient, pending_connection: dict) -> None:
    conn_id = pending_connection["connection_id"]
    resp = await client.get(f"/connections/{conn_id}", headers=pending_connection["supplier"]["headers"])
    assert resp.status_code == 200
    assert resp.json()["connection_id"] == conn_id


@pytest.mark.asyncio
async def test_get_detail_agent_200(client: AsyncClient, pending_connection: dict) -> None:
    conn_id = pending_connection["connection_id"]
    resp = await client.get(f"/connections/{conn_id}", headers=pending_connection["agent"]["headers"])
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_get_detail_admin_200(
    client: AsyncClient, pending_connection: dict, admin_data: dict
) -> None:
    conn_id = pending_connection["connection_id"]
    resp = await client.get(f"/connections/{conn_id}", headers=admin_data["headers"])
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_get_detail_wrong_org_403(
    client: AsyncClient, pending_connection: dict
) -> None:
    other = await _register_supplier(client)
    other_headers = _headers(other["access_token"])
    conn_id = pending_connection["connection_id"]
    resp = await client.get(f"/connections/{conn_id}", headers=other_headers)
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_get_detail_not_found_404(client: AsyncClient, supplier_data: dict) -> None:
    resp = await client.get(f"/connections/{uuid.uuid4()}", headers=supplier_data["headers"])
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_get_detail_custodian_link_present_false_when_pending(
    client: AsyncClient, pending_connection: dict
) -> None:
    conn_id = pending_connection["connection_id"]
    resp = await client.get(f"/connections/{conn_id}", headers=pending_connection["supplier"]["headers"])
    assert resp.json()["custodian_link_present"] is False


@pytest.mark.asyncio
async def test_get_detail_custodian_link_present_true_when_active(
    client: AsyncClient, active_connection: dict
) -> None:
    conn_id = active_connection["connection_id"]
    resp = await client.get(f"/connections/{conn_id}", headers=active_connection["supplier"]["headers"])
    assert resp.json()["custodian_link_present"] is True


@pytest.mark.asyncio
async def test_get_detail_no_token_401(client: AsyncClient) -> None:
    resp = await client.get(f"/connections/{uuid.uuid4()}")
    assert resp.status_code == 401


# ── Integration flow test ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_full_connection_flow(
    client: AsyncClient, supplier_data: dict, agent_data: dict
) -> None:
    """Full supplier-agent connection lifecycle (F-022 through F-025, F-026)."""
    sup_h = supplier_data["headers"]
    agt_h = agent_data["headers"]
    agt_org_id = agent_data["org_id"]

    # 1. Invite
    invite_resp = await client.post(
        "/connections/invite",
        json={"agent_org_id": agt_org_id},
        headers=sup_h,
    )
    assert invite_resp.status_code == 201
    conn_id = invite_resp.json()["connection_id"]
    assert invite_resp.json()["status"] == "pending"

    # 2. Accept
    accept_resp = await client.post(f"/connections/{conn_id}/accept", headers=agt_h)
    assert accept_resp.status_code == 200
    assert accept_resp.json()["status"] == "accepted"

    # 3. Register key (mock adapter: valid)
    key_resp = await client.post(
        f"/connections/{conn_id}/custodian-key",
        json={"custodian_id": "mock", "account_ref": "acct-001", "plaintext_key": "any-key"},
        headers=sup_h,
    )
    assert key_resp.status_code == 200
    assert key_resp.json()["status"] == "active"
    assert key_resp.json()["custodian_link_present"] is True
    assert "plaintext_key" not in str(key_resp.json())

    # 4. Both parties read (supplier)
    detail_resp = await client.get(f"/connections/{conn_id}", headers=sup_h)
    assert detail_resp.status_code == 200
    assert detail_resp.json()["status"] == "active"

    # 4b. Agent reads
    detail_agent = await client.get(f"/connections/{conn_id}", headers=agt_h)
    assert detail_agent.status_code == 200

    # 5. Supplier terminates
    terminate_resp = await client.post(f"/connections/{conn_id}/terminate", headers=sup_h)
    assert terminate_resp.status_code == 200
    assert terminate_resp.json()["status"] == "terminated"
    assert terminate_resp.json()["flagged_loan_ids"] == []

    # 6. Read terminated state
    final = await client.get(f"/connections/{conn_id}", headers=sup_h)
    assert final.json()["status"] == "terminated"

    # 7. Re-invite same agent after termination (partial index allows this)
    reinvite_resp = await client.post(
        "/connections/invite",
        json={"agent_org_id": agt_org_id},
        headers=sup_h,
    )
    assert reinvite_resp.status_code == 201
    new_conn_id = reinvite_resp.json()["connection_id"]
    assert new_conn_id != conn_id
    assert reinvite_resp.json()["status"] == "pending"


@pytest.mark.asyncio
async def test_m2_gate_pre_m1_token_rejected(client: AsyncClient) -> None:
    """Tokens without org_id (pre-M1 format) are rejected with 401."""
    s = get_settings()
    from datetime import datetime, timezone, timedelta
    token = jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "org_id": None,
            "role": "supplier",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
        },
        s.jwt_secret, algorithm=s.jwt_algorithm,
    )
    resp = await client.get("/connections", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "token_missing_org_id"
