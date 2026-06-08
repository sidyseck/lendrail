"""M1 org tests — F-011, F-012, F-013, F-015, F-019."""
import os
import subprocess
import sys
import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.security import create_access_token, hash_password, verify_password

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

SUPPLIER_PAYLOAD = {
    "name": "Test Supplier",
    "jurisdiction": "Delaware, USA",
    "entity_type": "fund",
    "contact_email": "supplier@example.com",
    "password": "Str0ngP@ssword!1",
}

AGENT_PAYLOAD = {
    "name": "Test Agent",
    "jurisdiction": "Delaware, USA",
    "entity_type": "fund",
    "contact_email": "agent@example.com",
    "password": "Str0ngP@ssword!2",
    "ops_contact_email": "ops@example.com",
    "regulatory_status_attested": True,
}


def _unique_supplier(**overrides: str) -> dict:
    uid = uuid.uuid4().hex[:8]
    p = SUPPLIER_PAYLOAD.copy()
    p["contact_email"] = f"supplier-{uid}@example.com"
    p.update(overrides)
    return p


def _unique_agent(**overrides) -> dict:
    uid = uuid.uuid4().hex[:8]
    p = AGENT_PAYLOAD.copy()
    p["contact_email"] = f"agent-{uid}@example.com"
    p["ops_contact_email"] = f"ops-{uid}@example.com"
    p.update(overrides)
    return p


# ── F-011: Migration 0002 tests ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_0002_migration_applies(test_engine: AsyncEngine) -> None:
    """organizations table and enums exist after upgrade head."""
    async with test_engine.connect() as conn:
        tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
        assert "organizations" in tables

        # Check columns exist
        cols = await conn.run_sync(
            lambda c: [col["name"] for col in inspect(c).get_columns("organizations")]
        )
        assert "ops_contact_email" in cols
        assert "regulatory_status_attested" in cols

        # Check enums exist
        result = await conn.execute(
            text("SELECT typname FROM pg_type WHERE typname IN ('org_role_enum', 'entity_type_enum', 'org_status_enum') ORDER BY typname")
        )
        found = {row[0] for row in result}
        assert "org_role_enum" in found
        assert "entity_type_enum" in found
        assert "org_status_enum" in found


@pytest.mark.asyncio
async def test_org_role_enum_constraint(db_session: AsyncSession) -> None:
    """Insert org with invalid role raises DB error."""
    with pytest.raises(Exception):  # IntegrityError or DataError
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
                "VALUES (:id, 'Bad', 'UK', 'fund', 'invalid_role', 'bad@example.com', 'approved')"
            ),
            {"id": str(uuid.uuid4())},
        )
        await db_session.flush()


@pytest.mark.asyncio
async def test_entity_type_enum_constraint(db_session: AsyncSession) -> None:
    """Insert org with invalid entity_type raises DB error."""
    with pytest.raises(Exception):
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
                "VALUES (:id, 'Bad', 'UK', 'banana', 'supplier', 'bad2@example.com', 'approved')"
            ),
            {"id": str(uuid.uuid4())},
        )
        await db_session.flush()


@pytest.mark.asyncio
async def test_contact_email_unique(db_session: AsyncSession) -> None:
    """Two orgs with same contact_email raise IntegrityError."""
    email = f"dup-{uuid.uuid4().hex}@example.com"
    oid1 = str(uuid.uuid4())
    oid2 = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
            "VALUES (:id, 'Org1', 'DE', 'fund', 'supplier', :email, 'approved')"
        ),
        {"id": oid1, "email": email},
    )
    await db_session.flush()
    with pytest.raises(Exception):
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
                "VALUES (:id, 'Org2', 'DE', 'fund', 'supplier', :email, 'approved')"
            ),
            {"id": oid2, "email": email},
        )
        await db_session.flush()


# ── F-012: Migration 0003 tests ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_0003_migration_applies(test_engine: AsyncEngine) -> None:
    """FK fk_users_org_id_organizations exists after upgrade head."""
    async with test_engine.connect() as conn:
        fks = await conn.run_sync(
            lambda c: inspect(c).get_foreign_keys("users")
        )
        fk_names = [fk.get("name") for fk in fks]
        assert "fk_users_org_id_organizations" in fk_names


@pytest.mark.asyncio
async def test_0003_downgrade(test_engine: AsyncEngine) -> None:
    """Downgrade from 0003 drops FK; upgrade restores it."""
    _alembic("downgrade", "0002")
    async with test_engine.connect() as conn:
        fks = await conn.run_sync(lambda c: inspect(c).get_foreign_keys("users"))
        fk_names = [fk.get("name") for fk in fks]
        assert "fk_users_org_id_organizations" not in fk_names
    _alembic("upgrade", "head")


@pytest.mark.asyncio
async def test_hash_password_returns_bcrypt() -> None:
    h = hash_password("strongPassword1!")
    assert h.startswith("$2b$")


@pytest.mark.asyncio
async def test_verify_password_true() -> None:
    h = hash_password("strongPassword1!")
    assert verify_password("strongPassword1!", h) is True


@pytest.mark.asyncio
async def test_verify_password_false() -> None:
    h = hash_password("strongPassword1!")
    assert verify_password("wrong", h) is False


@pytest.mark.asyncio
async def test_password_not_in_logs(caplog: pytest.LogCaptureFixture) -> None:
    import logging
    with caplog.at_level(logging.DEBUG):
        hash_password("strongPassword1!")
    for record in caplog.records:
        assert "strongPassword1!" not in record.getMessage()


@pytest.mark.asyncio
async def test_user_org_fk_enforced(db_session: AsyncSession) -> None:
    """Insert user with non-existent org_id raises IntegrityError."""
    with pytest.raises(Exception):
        await db_session.execute(
            text(
                "INSERT INTO users (id, org_id, email, hashed_password, role) "
                "VALUES (:id, :org_id, :email, 'hash', 'supplier')"
            ),
            {"id": str(uuid.uuid4()), "org_id": str(uuid.uuid4()), "email": f"u-{uuid.uuid4().hex}@example.com"},
        )
        await db_session.flush()


@pytest.mark.asyncio
async def test_user_null_org_id_allowed(db_session: AsyncSession) -> None:
    """After M2 migration 0005, inserting user with null org_id raises IntegrityError (NOT NULL)."""
    import pytest
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                "INSERT INTO users (id, org_id, email, hashed_password, role) "
                "VALUES (:id, NULL, :email, 'hash', 'supplier')"
            ),
            {"id": str(uuid.uuid4()), "email": f"u-null-{uuid.uuid4().hex}@example.com"},
        )
        await db_session.flush()


# ── F-013: Supplier registration tests ────────────────────────────────────────

@pytest.mark.asyncio
async def test_supplier_register_201(client: AsyncClient) -> None:
    resp = await client.post("/orgs/register/supplier", json=_unique_supplier())
    assert resp.status_code == 201
    data = resp.json()
    assert "org_id" in data
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    uuid.UUID(data["org_id"])  # must be valid UUID


@pytest.mark.asyncio
async def test_supplier_jwt_claims(client: AsyncClient) -> None:
    import jwt as pyjwt
    payload = _unique_supplier()
    resp = await client.post("/orgs/register/supplier", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    token = data["access_token"]
    claims = pyjwt.decode(token, options={"verify_signature": False})
    assert claims["role"] == "supplier"
    assert claims["org_id"] == data["org_id"]
    uuid.UUID(claims["sub"])


@pytest.mark.asyncio
async def test_supplier_register_no_password_in_response(client: AsyncClient) -> None:
    resp = await client.post("/orgs/register/supplier", json=_unique_supplier())
    assert resp.status_code == 201
    body = resp.json()
    assert "password" not in body
    assert "hashed_password" not in body


@pytest.mark.asyncio
async def test_supplier_duplicate_email_409(client: AsyncClient) -> None:
    payload = _unique_supplier()
    r1 = await client.post("/orgs/register/supplier", json=payload)
    assert r1.status_code == 201
    r2 = await client.post("/orgs/register/supplier", json=payload)
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "duplicate_email"


@pytest.mark.asyncio
async def test_supplier_invalid_entity_type_422(client: AsyncClient) -> None:
    payload = _unique_supplier()
    payload["entity_type"] = "banana"
    resp = await client.post("/orgs/register/supplier", json=payload)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_supplier_entity_type_agent_rejected_422(client: AsyncClient) -> None:
    """entity_type='agent' is not in public EntityType schema → 422."""
    payload = _unique_supplier()
    payload["entity_type"] = "agent"
    resp = await client.post("/orgs/register/supplier", json=payload)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_supplier_short_password_422(client: AsyncClient) -> None:
    payload = _unique_supplier()
    payload["password"] = "short12"  # < 12 chars
    resp = await client.post("/orgs/register/supplier", json=payload)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_supplier_missing_name_422(client: AsyncClient) -> None:
    payload = _unique_supplier()
    del payload["name"]
    resp = await client.post("/orgs/register/supplier", json=payload)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_supplier_then_get_me(client: AsyncClient) -> None:
    payload = _unique_supplier()
    reg = await client.post("/orgs/register/supplier", json=payload)
    assert reg.status_code == 201
    token = reg.json()["access_token"]
    org_id = reg.json()["org_id"]

    me = await client.get("/orgs/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    me_data = me.json()
    assert me_data["role"] == "supplier"
    assert me_data["id"] == org_id


@pytest.mark.asyncio
async def test_supplier_org_row_created(client: AsyncClient, db_session: AsyncSession) -> None:
    payload = _unique_supplier()
    reg = await client.post("/orgs/register/supplier", json=payload)
    assert reg.status_code == 201
    org_id = reg.json()["org_id"]

    result = await db_session.execute(
        text("SELECT name, role, status FROM organizations WHERE id = :id"),
        {"id": org_id},
    )
    row = result.fetchone()
    assert row is not None
    assert row.role == "supplier"
    assert row.status == "approved"


@pytest.mark.asyncio
async def test_supplier_user_row_created(client: AsyncClient, db_session: AsyncSession) -> None:
    payload = _unique_supplier()
    reg = await client.post("/orgs/register/supplier", json=payload)
    assert reg.status_code == 201
    org_id = reg.json()["org_id"]

    result = await db_session.execute(
        text("SELECT org_id, hashed_password, role FROM users WHERE org_id = :org_id"),
        {"org_id": org_id},
    )
    row = result.fetchone()
    assert row is not None
    assert str(row.org_id) == org_id
    assert row.hashed_password and len(row.hashed_password) > 0
    assert row.role == "supplier"


# ── F-015: Agent registration tests ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_agent_register_201(client: AsyncClient) -> None:
    resp = await client.post("/orgs/register/agent", json=_unique_agent())
    assert resp.status_code == 201
    data = resp.json()
    assert "org_id" in data
    assert "access_token" in data


@pytest.mark.asyncio
async def test_agent_jwt_role(client: AsyncClient) -> None:
    import jwt as pyjwt
    resp = await client.post("/orgs/register/agent", json=_unique_agent())
    assert resp.status_code == 201
    token = resp.json()["access_token"]
    claims = pyjwt.decode(token, options={"verify_signature": False})
    assert claims["role"] == "agent"


@pytest.mark.asyncio
async def test_agent_register_missing_ops_contact_422(client: AsyncClient) -> None:
    payload = _unique_agent()
    del payload["ops_contact_email"]
    resp = await client.post("/orgs/register/agent", json=payload)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_agent_register_attestation_false_422(client: AsyncClient) -> None:
    payload = _unique_agent()
    payload["regulatory_status_attested"] = False
    resp = await client.post("/orgs/register/agent", json=payload)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "attestation_required"


@pytest.mark.asyncio
async def test_agent_ops_email_same_as_contact_422(client: AsyncClient) -> None:
    payload = _unique_agent()
    payload["ops_contact_email"] = payload["contact_email"]
    resp = await client.post("/orgs/register/agent", json=payload)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "invalid_ops_email"


@pytest.mark.asyncio
async def test_agent_duplicate_email_409(client: AsyncClient) -> None:
    payload = _unique_agent()
    r1 = await client.post("/orgs/register/agent", json=payload)
    assert r1.status_code == 201
    r2 = await client.post("/orgs/register/agent", json=payload)
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "duplicate_email"


@pytest.mark.asyncio
async def test_agent_then_get_me(client: AsyncClient) -> None:
    payload = _unique_agent()
    reg = await client.post("/orgs/register/agent", json=payload)
    assert reg.status_code == 201
    token = reg.json()["access_token"]

    me = await client.get("/orgs/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["role"] == "agent"


@pytest.mark.asyncio
async def test_agent_ops_contact_stored(client: AsyncClient, db_session: AsyncSession) -> None:
    payload = _unique_agent()
    reg = await client.post("/orgs/register/agent", json=payload)
    assert reg.status_code == 201
    org_id = reg.json()["org_id"]

    result = await db_session.execute(
        text("SELECT ops_contact_email, regulatory_status_attested FROM organizations WHERE id = :id"),
        {"id": org_id},
    )
    row = result.fetchone()
    assert row is not None
    assert row.ops_contact_email == payload["ops_contact_email"]
    assert row.regulatory_status_attested is True


@pytest.mark.asyncio
async def test_agent_short_password_422(client: AsyncClient) -> None:
    payload = _unique_agent()
    payload["password"] = "shortpw1"  # < 12 chars
    resp = await client.post("/orgs/register/agent", json=payload)
    assert resp.status_code == 422


# ── F-019: GET /orgs/me tests ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_me_200_supplier(client: AsyncClient) -> None:
    reg = await client.post("/orgs/register/supplier", json=_unique_supplier())
    assert reg.status_code == 201
    token = reg.json()["access_token"]

    me = await client.get("/orgs/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    data = me.json()
    assert data["role"] == "supplier"
    uuid.UUID(data["id"])
    assert "hashed_password" not in data
    assert "password" not in data


@pytest.mark.asyncio
async def test_get_me_200_agent(client: AsyncClient) -> None:
    reg = await client.post("/orgs/register/agent", json=_unique_agent())
    assert reg.status_code == 201
    token = reg.json()["access_token"]

    me = await client.get("/orgs/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["role"] == "agent"


@pytest.mark.asyncio
async def test_get_me_no_token_401(client: AsyncClient) -> None:
    resp = await client.get("/orgs/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_me_invalid_token_401(client: AsyncClient) -> None:
    resp = await client.get("/orgs/me", headers={"Authorization": "Bearer tampered.token.here"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_me_no_org_id_403(client: AsyncClient) -> None:
    """M2 gate: token with null org_id (pre-M1 token) → 401 token_missing_org_id."""
    token = create_access_token(
        user_id=str(uuid.uuid4()),
        org_id=None,
        role="supplier",
    )
    resp = await client.get("/orgs/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "token_missing_org_id"


@pytest.mark.asyncio
async def test_get_me_no_password_in_response(client: AsyncClient) -> None:
    reg = await client.post("/orgs/register/supplier", json=_unique_supplier())
    token = reg.json()["access_token"]
    me = await client.get("/orgs/me", headers={"Authorization": f"Bearer {token}"})
    body = me.json()
    assert "hashed_password" not in body
    assert "password" not in body


@pytest.mark.asyncio
async def test_get_me_fields_complete(client: AsyncClient) -> None:
    reg = await client.post("/orgs/register/supplier", json=_unique_supplier())
    token = reg.json()["access_token"]
    me = await client.get("/orgs/me", headers={"Authorization": f"Bearer {token}"})
    data = me.json()
    for field in ("id", "name", "jurisdiction", "entity_type", "role", "contact_email", "status", "created_at"):
        assert field in data, f"Missing field: {field}"


# ── Integration flow: F-013 + F-019 ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_supplier_full_flow(client: AsyncClient) -> None:
    """Register supplier → JWT → GET /orgs/me → verify round-trip."""
    uid = uuid.uuid4().hex[:8]
    reg = await client.post("/orgs/register/supplier", json={
        "name": "Acme Fund",
        "jurisdiction": "Delaware, USA",
        "entity_type": "fund",
        "contact_email": f"acme-{uid}@example.com",
        "password": "Acme@Str0ng!2026",
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
