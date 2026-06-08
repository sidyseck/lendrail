"""M1 borrower tests — F-017, F-018."""
import os
import subprocess
import sys
import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

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


# ── Fixtures ───────────────────────────────────────────────────────────────────

def _unique_agent(**overrides) -> dict:
    uid = uuid.uuid4().hex[:8]
    p = {
        "name": "Test Agent",
        "jurisdiction": "Delaware, USA",
        "entity_type": "fund",
        "contact_email": f"agent-{uid}@example.com",
        "password": "Str0ngP@ssword!2",
        "ops_contact_email": f"ops-{uid}@example.com",
        "regulatory_status_attested": True,
    }
    p.update(overrides)
    return p


def _unique_supplier(**overrides) -> dict:
    uid = uuid.uuid4().hex[:8]
    p = {
        "name": "Test Supplier",
        "jurisdiction": "Delaware, USA",
        "entity_type": "fund",
        "contact_email": f"supplier-{uid}@example.com",
        "password": "Str0ngP@ssword!1",
    }
    p.update(overrides)
    return p


@pytest_asyncio.fixture
async def agent_headers(client: AsyncClient) -> dict:
    """Register an agent and return Authorization headers."""
    resp = await client.post("/orgs/register/agent", json=_unique_agent())
    assert resp.status_code == 201
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}", "_org_id": resp.json()["org_id"]}


@pytest_asyncio.fixture
async def supplier_headers(client: AsyncClient) -> dict:
    """Register a supplier and return Authorization headers."""
    resp = await client.post("/orgs/register/supplier", json=_unique_supplier())
    assert resp.status_code == 201
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _invite_payload(**overrides) -> dict:
    uid = uuid.uuid4().hex[:8]
    p = {
        "name": "Test Borrower",
        "jurisdiction": "New York, USA",
        "contact_email": f"borrower-{uid}@example.com",
    }
    p.update(overrides)
    return p


# ── F-017: Migration 0004 tests ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_0004_migration_applies(test_engine: AsyncEngine) -> None:
    """borrowers table and borrower_status_enum exist after upgrade head."""
    async with test_engine.connect() as conn:
        tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
        assert "borrowers" in tables

        result = await conn.execute(
            text("SELECT typname FROM pg_type WHERE typname = 'borrower_status_enum'")
        )
        found = {row[0] for row in result}
        assert "borrower_status_enum" in found


@pytest.mark.asyncio
async def test_0004_downgrade(test_engine: AsyncEngine) -> None:
    """Downgrade from 0004 drops borrowers table and enum."""
    _alembic("downgrade", "0003")
    async with test_engine.connect() as conn:
        tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
        assert "borrowers" not in tables
    _alembic("upgrade", "head")


@pytest.mark.asyncio
async def test_borrower_status_enum_constraint(db_session: AsyncSession) -> None:
    """Insert borrower with invalid status raises DB error."""
    # First need a valid org
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
            "VALUES (:id, 'Org', 'DE', 'fund', 'agent', :email, 'approved')"
        ),
        {"id": org_id, "email": f"org-{uuid.uuid4().hex}@example.com"},
    )
    await db_session.flush()

    with pytest.raises(Exception):
        await db_session.execute(
            text(
                "INSERT INTO borrowers (id, invited_by, name, jurisdiction, contact_email, status) "
                "VALUES (:id, :invited_by, 'B', 'DE', :email, 'invalid')"
            ),
            {"id": str(uuid.uuid4()), "invited_by": org_id, "email": f"b-{uuid.uuid4().hex}@example.com"},
        )
        await db_session.flush()


@pytest.mark.asyncio
async def test_borrower_invited_by_fk(db_session: AsyncSession) -> None:
    """Insert borrower with non-existent invited_by raises IntegrityError."""
    with pytest.raises(Exception):
        await db_session.execute(
            text(
                "INSERT INTO borrowers (id, invited_by, name, jurisdiction, contact_email, status) "
                "VALUES (:id, :invited_by, 'B', 'DE', :email, 'invited')"
            ),
            {"id": str(uuid.uuid4()), "invited_by": str(uuid.uuid4()), "email": f"b-{uuid.uuid4().hex}@example.com"},
        )
        await db_session.flush()


@pytest.mark.asyncio
async def test_borrower_contact_email_unique(db_session: AsyncSession) -> None:
    """Two borrowers with same email raise IntegrityError."""
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
            "VALUES (:id, 'Org', 'DE', 'fund', 'agent', :email, 'approved')"
        ),
        {"id": org_id, "email": f"org-{uuid.uuid4().hex}@example.com"},
    )
    await db_session.flush()

    shared_email = f"dup-{uuid.uuid4().hex}@example.com"
    await db_session.execute(
        text(
            "INSERT INTO borrowers (id, invited_by, name, jurisdiction, contact_email, status) "
            "VALUES (:id, :invited_by, 'B1', 'DE', :email, 'invited')"
        ),
        {"id": str(uuid.uuid4()), "invited_by": org_id, "email": shared_email},
    )
    await db_session.flush()

    with pytest.raises(Exception):
        await db_session.execute(
            text(
                "INSERT INTO borrowers (id, invited_by, name, jurisdiction, contact_email, status) "
                "VALUES (:id, :invited_by, 'B2', 'DE', :email, 'invited')"
            ),
            {"id": str(uuid.uuid4()), "invited_by": org_id, "email": shared_email},
        )
        await db_session.flush()


@pytest.mark.asyncio
async def test_borrower_default_status_invited(db_session: AsyncSession) -> None:
    """Insert borrower without status gets default 'invited'."""
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
            "VALUES (:id, 'Org', 'DE', 'fund', 'agent', :email, 'approved')"
        ),
        {"id": org_id, "email": f"org-{uuid.uuid4().hex}@example.com"},
    )
    await db_session.flush()

    b_id = str(uuid.uuid4())
    email = f"b-{uuid.uuid4().hex}@example.com"
    await db_session.execute(
        text(
            "INSERT INTO borrowers (id, invited_by, name, jurisdiction, contact_email) "
            "VALUES (:id, :invited_by, 'B', 'DE', :email)"
        ),
        {"id": b_id, "invited_by": org_id, "email": email},
    )
    await db_session.flush()

    result = await db_session.execute(
        text("SELECT status FROM borrowers WHERE id = :id"),
        {"id": b_id},
    )
    row = result.fetchone()
    assert row.status == "invited"


# ── F-018: Borrower invite/get tests ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_borrower_201(client: AsyncClient, agent_headers: dict) -> None:
    headers = {"Authorization": agent_headers["Authorization"]}
    resp = await client.post("/borrowers", json=_invite_payload(), headers=headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "active"
    assert data["approved_connection_id"] is None
    uuid.UUID(data["borrower_id"])


@pytest.mark.asyncio
async def test_create_borrower_sets_active_status(
    client: AsyncClient, agent_headers: dict, db_session: AsyncSession
) -> None:
    headers = {"Authorization": agent_headers["Authorization"]}
    resp = await client.post("/borrowers", json=_invite_payload(), headers=headers)
    assert resp.status_code == 201
    borrower_id = resp.json()["borrower_id"]

    result = await db_session.execute(
        text("SELECT status FROM borrowers WHERE id = :id"),
        {"id": borrower_id},
    )
    assert result.fetchone().status == "active"


@pytest.mark.asyncio
async def test_list_borrowers_for_agent(client: AsyncClient, agent_headers: dict) -> None:
    headers = {"Authorization": agent_headers["Authorization"]}
    resp = await client.post("/borrowers", json=_invite_payload(name="Managed Borrower"), headers=headers)
    assert resp.status_code == 201

    resp = await client.get("/borrowers", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert [b["name"] for b in data["borrowers"]] == ["Managed Borrower"]


@pytest.mark.asyncio
async def test_create_borrower_with_supplier_jwt_403(client: AsyncClient, supplier_headers: dict) -> None:
    resp = await client.post("/borrowers", json=_invite_payload(), headers=supplier_headers)
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_invite_borrower_201(client: AsyncClient, agent_headers: dict) -> None:
    headers = {"Authorization": agent_headers["Authorization"]}
    resp = await client.post("/borrowers/invite", json=_invite_payload(), headers=headers)
    assert resp.status_code == 201
    data = resp.json()
    assert "borrower_id" in data
    uuid.UUID(data["borrower_id"])


@pytest.mark.asyncio
async def test_invite_sets_invited_by(
    client: AsyncClient, agent_headers: dict, db_session: AsyncSession
) -> None:
    headers = {"Authorization": agent_headers["Authorization"]}
    agent_org_id = agent_headers["_org_id"]
    payload = _invite_payload()
    resp = await client.post("/borrowers/invite", json=payload, headers=headers)
    assert resp.status_code == 201
    borrower_id = resp.json()["borrower_id"]

    result = await db_session.execute(
        text("SELECT invited_by FROM borrowers WHERE id = :id"),
        {"id": borrower_id},
    )
    row = result.fetchone()
    assert str(row.invited_by) == agent_org_id


@pytest.mark.asyncio
async def test_invite_default_status_invited(
    client: AsyncClient, agent_headers: dict, db_session: AsyncSession
) -> None:
    headers = {"Authorization": agent_headers["Authorization"]}
    resp = await client.post("/borrowers/invite", json=_invite_payload(), headers=headers)
    assert resp.status_code == 201
    borrower_id = resp.json()["borrower_id"]

    result = await db_session.execute(
        text("SELECT status FROM borrowers WHERE id = :id"),
        {"id": borrower_id},
    )
    assert result.fetchone().status == "invited"


@pytest.mark.asyncio
async def test_invite_with_supplier_jwt_403(client: AsyncClient, supplier_headers: dict) -> None:
    resp = await client.post("/borrowers/invite", json=_invite_payload(), headers=supplier_headers)
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_invite_with_no_token_401(client: AsyncClient) -> None:
    resp = await client.post("/borrowers/invite", json=_invite_payload())
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_invite_duplicate_email_409(client: AsyncClient, agent_headers: dict) -> None:
    headers = {"Authorization": agent_headers["Authorization"]}
    payload = _invite_payload()
    r1 = await client.post("/borrowers/invite", json=payload, headers=headers)
    assert r1.status_code == 201
    r2 = await client.post("/borrowers/invite", json=payload, headers=headers)
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "duplicate_email"


@pytest.mark.asyncio
async def test_invite_notification_logged(
    client: AsyncClient, agent_headers: dict, caplog: pytest.LogCaptureFixture
) -> None:
    import logging
    headers = {"Authorization": agent_headers["Authorization"]}
    payload = _invite_payload()
    with caplog.at_level(logging.INFO):
        resp = await client.post("/borrowers/invite", json=payload, headers=headers)
    assert resp.status_code == 201
    # Check that some log message mentions borrower_invited
    messages = " ".join(r.getMessage() for r in caplog.records)
    assert "borrower_invited" in messages


@pytest.mark.asyncio
async def test_get_borrower_200(client: AsyncClient, agent_headers: dict) -> None:
    headers = {"Authorization": agent_headers["Authorization"]}
    payload = _invite_payload()
    inv = await client.post("/borrowers/invite", json=payload, headers=headers)
    assert inv.status_code == 201
    borrower_id = inv.json()["borrower_id"]

    resp = await client.get(f"/borrowers/{borrower_id}", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["contact_email"] == payload["contact_email"]
    assert data["status"] == "invited"
    uuid.UUID(data["id"])


@pytest.mark.asyncio
async def test_get_borrower_wrong_agent_403(client: AsyncClient, agent_headers: dict) -> None:
    """Different agent org's JWT → 403."""
    headers = {"Authorization": agent_headers["Authorization"]}
    payload = _invite_payload()
    inv = await client.post("/borrowers/invite", json=payload, headers=headers)
    assert inv.status_code == 201
    borrower_id = inv.json()["borrower_id"]

    # Register a second agent
    reg2 = await client.post("/orgs/register/agent", json=_unique_agent())
    assert reg2.status_code == 201
    token2 = reg2.json()["access_token"]
    headers2 = {"Authorization": f"Bearer {token2}"}

    resp = await client.get(f"/borrowers/{borrower_id}", headers=headers2)
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_get_borrower_not_found_404(client: AsyncClient, agent_headers: dict) -> None:
    headers = {"Authorization": agent_headers["Authorization"]}
    resp = await client.get(f"/borrowers/{uuid.uuid4()}", headers=headers)
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_get_borrower_supplier_jwt_403(
    client: AsyncClient, supplier_headers: dict
) -> None:
    resp = await client.get(f"/borrowers/{uuid.uuid4()}", headers=supplier_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_borrower_no_password_in_response(
    client: AsyncClient, agent_headers: dict
) -> None:
    headers = {"Authorization": agent_headers["Authorization"]}
    inv = await client.post("/borrowers/invite", json=_invite_payload(), headers=headers)
    borrower_id = inv.json()["borrower_id"]
    resp = await client.get(f"/borrowers/{borrower_id}", headers=headers)
    body = resp.json()
    assert "hashed_password" not in body
    assert "password" not in body
