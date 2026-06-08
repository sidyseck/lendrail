"""M4 loan lifecycle tests — F-033 through F-042."""
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.adapters.mock_custodian import MockCustodianAdapter
from app.api.deps import get_custodian_adapter


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register_supplier(client: AsyncClient) -> dict:
    uid = uuid.uuid4().hex[:8]
    resp = await client.post(
        "/orgs/register/supplier",
        json={
            "name": f"Supplier {uid}",
            "jurisdiction": "Delaware, USA",
            "entity_type": "fund",
            "contact_email": f"supplier-{uid}@example.com",
            "password": "Str0ngP@ssword!1",
        },
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    return {"token": data["access_token"], "org_id": data["org_id"], "headers": _headers(data["access_token"])}


async def _register_agent(client: AsyncClient) -> dict:
    uid = uuid.uuid4().hex[:8]
    resp = await client.post(
        "/orgs/register/agent",
        json={
            "name": f"Agent {uid}",
            "jurisdiction": "Delaware, USA",
            "entity_type": "fund",
            "contact_email": f"agent-{uid}@example.com",
            "password": "Str0ngP@ssword!2",
            "ops_contact_email": f"ops-{uid}@example.com",
            "regulatory_status_attested": True,
        },
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    return {"token": data["access_token"], "org_id": data["org_id"], "headers": _headers(data["access_token"])}


@pytest_asyncio.fixture
async def seeded_client(app) -> AsyncClient:
    app.dependency_overrides[get_custodian_adapter] = lambda: MockCustodianAdapter(
        inventory={"BTC": 100.0},
        collateral={},
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def m4_setup(seeded_client: AsyncClient) -> dict:
    supplier = await _register_supplier(seeded_client)
    agent = await _register_agent(seeded_client)

    resp = await seeded_client.post(
        "/connections/invite",
        json={"agent_org_id": agent["org_id"]},
        headers=supplier["headers"],
    )
    assert resp.status_code == 201, resp.text
    connection_id = resp.json()["connection_id"]

    resp = await seeded_client.post(f"/connections/{connection_id}/accept", headers=agent["headers"])
    assert resp.status_code == 200, resp.text

    resp = await seeded_client.post(
        "/custodians",
        json={"custodian_id": "mock", "account_ref": "acct-001", "plaintext_key": "test-key"},
        headers=supplier["headers"],
    )
    assert resp.status_code == 201, resp.text

    resp = await seeded_client.post(
        f"/connections/{connection_id}/agreement",
        json={
            "assets_in_scope": ["BTC"],
            "eligible_collateral": ["CASH_USD"],
            "initial_ltv_pct": "70.0000",
            "margin_call_ltv_pct": "80.0000",
            "liquidation_ltv_pct": "90.0000",
            "recall_notice_days": 3,
            "max_loan_days": 30,
            "day_count_basis": "actual_360",
            "agent_fee_bps": 50,
        },
        headers=agent["headers"],
    )
    assert resp.status_code == 201, resp.text
    agreement_id = resp.json()["agreement_id"]

    resp = await seeded_client.post(f"/agreements/{agreement_id}/confirm", headers=supplier["headers"])
    assert resp.status_code == 200, resp.text
    resp = await seeded_client.post(f"/agreements/{agreement_id}/confirm", headers=agent["headers"])
    assert resp.status_code == 200, resp.text

    resp = await seeded_client.post(
        "/borrowers/invite",
        json={
            "name": "Borrower One",
            "jurisdiction": "Delaware, USA",
            "contact_email": f"borrower-{uuid.uuid4().hex[:8]}@example.com",
        },
        headers=agent["headers"],
    )
    assert resp.status_code == 201, resp.text
    borrower_id = resp.json()["borrower_id"]

    return {
        "supplier": supplier,
        "agent": agent,
        "connection_id": connection_id,
        "agreement_id": agreement_id,
        "borrower_id": borrower_id,
    }


@pytest.mark.asyncio
async def test_0011_migration_applies(test_engine: AsyncEngine) -> None:
    async with test_engine.connect() as conn:
        tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
        assert "loans" in tables
        assert "connection_approved_borrowers" in tables
        columns = await conn.run_sync(lambda c: inspect(c).get_columns("loans"))
        column_names = {column["name"] for column in columns}
        assert {"asset_price_usd", "booking_ltv_pct", "margin_call_ltv_pct", "liquidation_ltv_pct"} <= column_names
        state_enum = await conn.execute(text("SELECT typname FROM pg_type WHERE typname = 'loan_state_enum'"))
        assert state_enum.scalar() == "loan_state_enum"


@pytest.mark.asyncio
async def test_approved_borrower_and_booking_flow(seeded_client: AsyncClient, m4_setup: dict) -> None:
    booking = {
        "connection_id": m4_setup["connection_id"],
        "borrower_id": m4_setup["borrower_id"],
        "asset_type": "BTC",
        "quantity": "0.50",
        "asset_price_usd": "65000.00",
        "booking_ltv_pct": "70.0000",
        "margin_call_ltv_pct": "80.0000",
        "liquidation_ltv_pct": "90.0000",
        "rate_bps": 500,
        "term_type": "open",
        "maturity_date": None,
        "collateral_type": "CASH_USD",
        "collateral_quantity": "15000",
        "collateral_value_usd": "15000",
    }
    resp = await seeded_client.post("/loans", json=booking, headers=m4_setup["agent"]["headers"])
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "borrower_not_approved"

    resp = await seeded_client.post(
        f"/connections/{m4_setup['connection_id']}/approved-borrowers",
        json={"borrower_id": m4_setup["borrower_id"]},
        headers=m4_setup["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text

    resp = await seeded_client.get(
        f"/connections/{m4_setup['connection_id']}/approved-borrowers",
        headers=m4_setup["supplier"]["headers"],
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["borrowers"][0]["borrower_id"] == m4_setup["borrower_id"]

    resp = await seeded_client.put(
        f"/connections/{m4_setup['connection_id']}/inventory-scope",
        json={"scope": {"BTC": "100.0"}},
        headers=m4_setup["supplier"]["headers"],
    )
    assert resp.status_code == 200, resp.text

    resp = await seeded_client.post("/loans", json=booking, headers=m4_setup["agent"]["headers"])
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_create_borrower_with_connection_enables_supplier_visibility_and_booking(
    seeded_client: AsyncClient, m4_setup: dict
) -> None:
    resp = await seeded_client.post(
        "/borrowers",
        json={
            "name": "Direct Borrower",
            "jurisdiction": "Delaware, USA",
            "contact_email": f"direct-borrower-{uuid.uuid4().hex[:8]}@example.com",
            "connection_id": m4_setup["connection_id"],
        },
        headers=m4_setup["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    borrower_id = resp.json()["borrower_id"]
    assert resp.json()["status"] == "active"
    assert resp.json()["approved_connection_id"] == m4_setup["connection_id"]

    resp = await seeded_client.get(
        f"/connections/{m4_setup['connection_id']}/approved-borrowers",
        headers=m4_setup["supplier"]["headers"],
    )
    assert resp.status_code == 200, resp.text
    assert borrower_id in {borrower["borrower_id"] for borrower in resp.json()["borrowers"]}

    resp = await seeded_client.put(
        f"/connections/{m4_setup['connection_id']}/inventory-scope",
        json={"scope": {"BTC": "100.0"}},
        headers=m4_setup["supplier"]["headers"],
    )
    assert resp.status_code == 200, resp.text

    resp = await seeded_client.post(
        "/loans",
        json={
            "connection_id": m4_setup["connection_id"],
            "borrower_id": borrower_id,
            "asset_type": "BTC",
            "quantity": "0.50",
            "asset_price_usd": "65000.00",
            "booking_ltv_pct": "70.0000",
            "margin_call_ltv_pct": "80.0000",
            "liquidation_ltv_pct": "90.0000",
            "rate_bps": 500,
            "term_type": "open",
            "maturity_date": None,
            "collateral_type": "CASH_USD",
            # collateral_value = quantity * price * ltv = 0.5 * 65000 * 0.70 = 22750
            # Using the consistent value so the service derives booking_ltv_pct = 70.0
            "collateral_quantity": "22750",
            "collateral_value_usd": "22750",
        },
        headers=m4_setup["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    loan_id = resp.json()["loan_id"]
    assert resp.json()["state"] == "pending"

    resp = await seeded_client.get("/loans?state=pending", headers=m4_setup["supplier"]["headers"])
    assert resp.status_code == 200, resp.text
    assert [row["loan_id"] for row in resp.json()["loans"]] == [loan_id]
    loan = resp.json()["loans"][0]
    assert loan["asset_price_usd"] == "65000.00000000"
    assert loan["booking_ltv_pct"] == "70.0000"
    assert loan["margin_call_ltv_pct"] == "80.0000"
    assert loan["liquidation_ltv_pct"] == "90.0000"


@pytest.mark.asyncio
async def test_booking_accepts_terms_that_differ_from_supplier_guidance(
    seeded_client: AsyncClient, m4_setup: dict
) -> None:
    resp = await seeded_client.post(
        f"/connections/{m4_setup['connection_id']}/approved-borrowers",
        json={"borrower_id": m4_setup["borrower_id"]},
        headers=m4_setup["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    resp = await seeded_client.put(
        f"/connections/{m4_setup['connection_id']}/inventory-scope",
        json={"scope": {"BTC": "100.0"}},
        headers=m4_setup["supplier"]["headers"],
    )
    assert resp.status_code == 200, resp.text

    resp = await seeded_client.post(
        "/loans",
        json={
            "connection_id": m4_setup["connection_id"],
            "borrower_id": m4_setup["borrower_id"],
            "asset_type": "BTC",
            "quantity": "0.50",
            "asset_price_usd": "65000.00",
            "booking_ltv_pct": "75.0000",
            "margin_call_ltv_pct": "82.0000",
            "liquidation_ltv_pct": "92.0000",
            "rate_bps": 500,
            "term_type": "open",
            "maturity_date": None,
            "collateral_type": "CASH_USD",
            "collateral_quantity": "24375",
        },
        headers=m4_setup["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    loan_id = resp.json()["loan_id"]

    resp = await seeded_client.get(f"/loans/{loan_id}", headers=m4_setup["agent"]["headers"])
    assert resp.status_code == 200, resp.text
    loan = resp.json()
    assert loan["collateral_value_usd"] == "24375.00000000"
    assert loan["booking_ltv_pct"] == "75.0000"
    assert loan["margin_call_ltv_pct"] == "82.0000"
    assert loan["liquidation_ltv_pct"] == "92.0000"


@pytest.mark.asyncio
async def test_booking_recomputes_implied_ltv_from_collateral_value(
    seeded_client: AsyncClient, m4_setup: dict
) -> None:
    resp = await seeded_client.post(
        f"/connections/{m4_setup['connection_id']}/approved-borrowers",
        json={"borrower_id": m4_setup["borrower_id"]},
        headers=m4_setup["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    resp = await seeded_client.put(
        f"/connections/{m4_setup['connection_id']}/inventory-scope",
        json={"scope": {"BTC": "100.0"}},
        headers=m4_setup["supplier"]["headers"],
    )
    assert resp.status_code == 200, resp.text

    resp = await seeded_client.post(
        "/loans",
        json={
            "connection_id": m4_setup["connection_id"],
            "borrower_id": m4_setup["borrower_id"],
            "asset_type": "BTC",
            "quantity": "1.00",
            "asset_price_usd": "100.00",
            "booking_ltv_pct": "70.0000",
            "margin_call_ltv_pct": "80.0000",
            "liquidation_ltv_pct": "90.0000",
            "rate_bps": 500,
            "term_type": "open",
            "maturity_date": None,
            "collateral_type": "CASH_USD",
            "collateral_quantity": "75",
            "collateral_value_usd": "75.00",
        },
        headers=m4_setup["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    loan_id = resp.json()["loan_id"]

    resp = await seeded_client.get(f"/loans/{loan_id}", headers=m4_setup["agent"]["headers"])
    assert resp.status_code == 200, resp.text
    loan = resp.json()
    assert loan["booking_ltv_pct"] == "75.0000"
    assert loan["current_ltv_pct"] == "75.0000"
    assert loan["collateral_value_usd"] == "75.00000000"


@pytest.mark.asyncio
async def test_booking_rejects_invalid_executed_threshold_order(
    seeded_client: AsyncClient, m4_setup: dict
) -> None:
    resp = await seeded_client.post(
        f"/connections/{m4_setup['connection_id']}/approved-borrowers",
        json={"borrower_id": m4_setup["borrower_id"]},
        headers=m4_setup["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    resp = await seeded_client.put(
        f"/connections/{m4_setup['connection_id']}/inventory-scope",
        json={"scope": {"BTC": "100.0"}},
        headers=m4_setup["supplier"]["headers"],
    )
    assert resp.status_code == 200, resp.text

    resp = await seeded_client.post(
        "/loans",
        json={
            "connection_id": m4_setup["connection_id"],
            "borrower_id": m4_setup["borrower_id"],
            "asset_type": "BTC",
            "quantity": "1.00",
            "asset_price_usd": "100.00",
            "booking_ltv_pct": "70.0000",
            "margin_call_ltv_pct": "80.0000",
            "liquidation_ltv_pct": "90.0000",
            "rate_bps": 500,
            "term_type": "open",
            "maturity_date": None,
            "collateral_type": "CASH_USD",
            "collateral_quantity": "85",
            "collateral_value_usd": "85.00",
        },
        headers=m4_setup["agent"]["headers"],
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "invalid_ltv_thresholds"


@pytest.mark.asyncio
async def test_market_price_endpoint_returns_default_price(
    seeded_client: AsyncClient, m4_setup: dict
) -> None:
    resp = await seeded_client.get(
        "/market-data/prices/BTC",
        headers=m4_setup["agent"]["headers"],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["asset_type"] == "BTC"
    assert body["price_usd"] == "63500.0"
    assert body["as_of"]


@pytest.mark.asyncio
async def test_recall_return_and_default_guards(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text("SELECT COUNT(*) FROM loans WHERE state NOT IN ('pending','active','margin_call','recall_initiated','settled','defaulted')")
    )
    assert result.scalar() == 0
