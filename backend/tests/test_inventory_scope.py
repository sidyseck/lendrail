"""F-061 inventory scope tests."""
import asyncio
import inspect as pyinspect
import uuid
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import inspect as sa_inspect, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.adapters.mock_custodian import MockCustodianAdapter
from app.api.deps import get_custodian_adapter
from app.services.loan_service import LoanService


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
async def inventory_client(app) -> AsyncClient:
    app.dependency_overrides[get_custodian_adapter] = lambda: MockCustodianAdapter(
        inventory={"BTC": 500.0, "ETH": 200.0},
        collateral={},
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _connection_setup(
    client: AsyncClient,
    *,
    assets_in_scope: list[str] | None = None,
    approve_borrower: bool = True,
) -> dict:
    supplier = await _register_supplier(client)
    agent = await _register_agent(client)

    resp = await client.post(
        "/connections/invite",
        json={"agent_org_id": agent["org_id"]},
        headers=supplier["headers"],
    )
    assert resp.status_code == 201, resp.text
    connection_id = resp.json()["connection_id"]

    resp = await client.post(f"/connections/{connection_id}/accept", headers=agent["headers"])
    assert resp.status_code == 200, resp.text

    resp = await client.post(
        "/custodians",
        json={"custodian_id": "mock", "account_ref": "acct-001", "plaintext_key": "test-key"},
        headers=supplier["headers"],
    )
    assert resp.status_code == 201, resp.text

    resp = await client.post(
        f"/connections/{connection_id}/agreement",
        json={
            "assets_in_scope": assets_in_scope or ["BTC"],
            "eligible_collateral": ["CASH_USD"],
            "initial_ltv_pct": "70.0000",
            "margin_call_ltv_pct": "80.0000",
            "recall_notice_days": 3,
            "max_loan_days": 30,
            "day_count_basis": "actual_360",
            "agent_fee_bps": 50,
        },
        headers=agent["headers"],
    )
    assert resp.status_code == 201, resp.text
    agreement_id = resp.json()["agreement_id"]

    resp = await client.post(f"/agreements/{agreement_id}/confirm", headers=supplier["headers"])
    assert resp.status_code == 200, resp.text
    resp = await client.post(f"/agreements/{agreement_id}/confirm", headers=agent["headers"])
    assert resp.status_code == 200, resp.text

    resp = await client.post(
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

    if approve_borrower:
        resp = await client.post(
            f"/connections/{connection_id}/approved-borrowers",
            json={"borrower_id": borrower_id},
            headers=agent["headers"],
        )
        assert resp.status_code == 201, resp.text

    return {
        "supplier": supplier,
        "agent": agent,
        "connection_id": connection_id,
        "borrower_id": borrower_id,
    }


async def _publish(client: AsyncClient, setup: dict, scope: dict[str, str]) -> None:
    resp = await client.put(
        f"/connections/{setup['connection_id']}/inventory-scope",
        json={"scope": scope},
        headers=setup["supplier"]["headers"],
    )
    assert resp.status_code == 200, resp.text


def _booking(setup: dict, quantity: str = "10.0", asset_type: str = "BTC") -> dict:
    qty = Decimal(quantity)
    collateral_value = qty * Decimal("30000")
    return {
        "connection_id": setup["connection_id"],
        "borrower_id": setup["borrower_id"],
        "asset_type": asset_type,
        "quantity": quantity,
        "rate_bps": 500,
        "term_type": "open",
        "maturity_date": None,
        "collateral_type": "CASH_USD",
        "collateral_quantity": str(collateral_value),
        "collateral_value_usd": str(collateral_value),
    }


def _entry(body: dict, asset_type: str) -> dict:
    return next(row for row in body["entries"] if row["asset_type"] == asset_type)


@pytest.mark.asyncio
async def test_0012_migration_adds_inventory_scope(test_engine: AsyncEngine) -> None:
    async with test_engine.connect() as conn:
        columns = await conn.run_sync(
            lambda c: sa_inspect(c).get_columns("connections")
        )
        column = next(col for col in columns if col["name"] == "inventory_scope")
        assert column["nullable"] is False


@pytest.mark.asyncio
async def test_set_inventory_scope_supplier_success_and_agent_redaction(inventory_client: AsyncClient) -> None:
    setup = await _connection_setup(inventory_client)
    await _publish(inventory_client, setup, {"BTC": "100.0"})

    supplier_resp = await inventory_client.get(
        f"/connections/{setup['connection_id']}/inventory",
        headers=setup["supplier"]["headers"],
    )
    assert supplier_resp.status_code == 200, supplier_resp.text
    btc = _entry(supplier_resp.json(), "BTC")
    assert btc["custodian_balance"] == "500.0"
    assert btc["published_quantity"] == "100.0"
    assert btc["already_booked"] == "0"
    assert btc["effective_available"] == "100.0"

    agent_resp = await inventory_client.get(
        f"/connections/{setup['connection_id']}/inventory",
        headers=setup["agent"]["headers"],
    )
    assert agent_resp.status_code == 200, agent_resp.text
    agent_btc = _entry(agent_resp.json(), "BTC")
    assert agent_btc == {"asset_type": "BTC", "effective_available": "100.0"}


@pytest.mark.asyncio
async def test_set_inventory_scope_forbidden_and_invalid_quantity(
    inventory_client: AsyncClient,
) -> None:
    setup = await _connection_setup(inventory_client)
    resp = await inventory_client.put(
        f"/connections/{setup['connection_id']}/inventory-scope",
        json={"scope": {"BTC": "100.0"}},
        headers=setup["agent"]["headers"],
    )
    assert resp.status_code == 403

    resp = await inventory_client.put(
        f"/connections/{setup['connection_id']}/inventory-scope",
        json={"scope": {"BTC": "-1.0"}},
        headers=setup["supplier"]["headers"],
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "invalid_quantity"


@pytest.mark.asyncio
async def test_set_inventory_scope_pending_connection_rejected(
    inventory_client: AsyncClient,
) -> None:
    supplier = await _register_supplier(inventory_client)
    agent = await _register_agent(inventory_client)
    resp = await inventory_client.post(
        "/connections/invite",
        json={"agent_org_id": agent["org_id"]},
        headers=supplier["headers"],
    )
    assert resp.status_code == 201, resp.text

    resp = await inventory_client.put(
        f"/connections/{resp.json()['connection_id']}/inventory-scope",
        json={"scope": {"BTC": "100.0"}},
        headers=supplier["headers"],
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "invalid_connection_status"


@pytest.mark.asyncio
async def test_get_inventory_scope_custodian_cap_and_unpublished_visibility(
    inventory_client: AsyncClient,
) -> None:
    setup = await _connection_setup(inventory_client)
    await _publish(inventory_client, setup, {"BTC": "600.0"})

    supplier_resp = await inventory_client.get(
        f"/connections/{setup['connection_id']}/inventory",
        headers=setup["supplier"]["headers"],
    )
    assert supplier_resp.status_code == 200, supplier_resp.text
    body = supplier_resp.json()
    assert _entry(body, "BTC")["effective_available"] == "500.0"
    eth = _entry(body, "ETH")
    assert eth["published_quantity"] == "0"
    assert eth["effective_available"] == "0"

    agent_resp = await inventory_client.get(
        f"/connections/{setup['connection_id']}/inventory",
        headers=setup["agent"]["headers"],
    )
    assert agent_resp.status_code == 200, agent_resp.text
    assert [row["asset_type"] for row in agent_resp.json()["entries"]] == ["BTC"]


@pytest.mark.asyncio
async def test_book_loan_inventory_scope_guards(inventory_client: AsyncClient) -> None:
    setup = await _connection_setup(inventory_client, assets_in_scope=["BTC", "ETH"])
    resp = await inventory_client.post(
        "/loans",
        json=_booking(setup, quantity="10.0", asset_type="BTC"),
        headers=setup["agent"]["headers"],
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "no_inventory_published"

    await _publish(inventory_client, setup, {"BTC": "100.0"})
    resp = await inventory_client.post(
        "/loans",
        json=_booking(setup, quantity="10.0", asset_type="ETH"),
        headers=setup["agent"]["headers"],
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "no_inventory_published"

    resp = await inventory_client.post(
        "/loans",
        json=_booking(setup, quantity="150.0", asset_type="BTC"),
        headers=setup["agent"]["headers"],
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "exceeds_published_inventory"


@pytest.mark.asyncio
async def test_booked_quantity_subtracts_from_inventory_scope(
    inventory_client: AsyncClient,
) -> None:
    setup = await _connection_setup(inventory_client)
    await _publish(inventory_client, setup, {"BTC": "100.0"})

    resp = await inventory_client.post(
        "/loans",
        json=_booking(setup, quantity="70.0"),
        headers=setup["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text

    supplier_resp = await inventory_client.get(
        f"/connections/{setup['connection_id']}/inventory",
        headers=setup["supplier"]["headers"],
    )
    btc = _entry(supplier_resp.json(), "BTC")
    assert btc["already_booked"] == "70.000000000000"
    assert btc["effective_available"] == "30.000000000000"

    resp = await inventory_client.post(
        "/loans",
        json=_booking(setup, quantity="40.0"),
        headers=setup["agent"]["headers"],
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "exceeds_published_inventory"


def test_book_loan_uses_connection_row_lock() -> None:
    source = pyinspect.getsource(LoanService.book_loan)
    assert "self.connections.get_for_update(data.connection_id)" in source


@pytest.mark.asyncio
async def test_set_inventory_scope_wrong_supplier_forbidden(inventory_client: AsyncClient) -> None:
    setup = await _connection_setup(inventory_client)
    other_supplier = await _register_supplier(inventory_client)
    resp = await inventory_client.put(
        f"/connections/{setup['connection_id']}/inventory-scope",
        json={"scope": {"BTC": "50.0"}},
        headers=other_supplier["headers"],
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_set_inventory_scope_empty_dict_accepted(inventory_client: AsyncClient) -> None:
    setup = await _connection_setup(inventory_client)
    resp = await inventory_client.put(
        f"/connections/{setup['connection_id']}/inventory-scope",
        json={"scope": {}},
        headers=setup["supplier"]["headers"],
    )
    assert resp.status_code == 200

    resp = await inventory_client.get(
        f"/connections/{setup['connection_id']}/inventory",
        headers=setup["supplier"]["headers"],
    )
    assert resp.status_code == 200
    # Custodian assets still appear but all show published_quantity=0 and effective_available=0
    for entry in resp.json()["entries"]:
        assert entry["published_quantity"] == "0"
        assert entry["effective_available"] == "0"


@pytest.mark.asyncio
async def test_set_inventory_scope_any_asset_type_accepted(inventory_client: AsyncClient) -> None:
    setup = await _connection_setup(inventory_client)
    resp = await inventory_client.put(
        f"/connections/{setup['connection_id']}/inventory-scope",
        json={"scope": {"ETH": "50.0", "USDC": "1000000.0", "SOL": "2500.5"}},
        headers=setup["supplier"]["headers"],
    )
    assert resp.status_code == 200

    resp = await inventory_client.get(
        f"/connections/{setup['connection_id']}/inventory",
        headers=setup["supplier"]["headers"],
    )
    assert resp.status_code == 200
    asset_types = {e["asset_type"] for e in resp.json()["entries"]}
    assert "ETH" in asset_types
    assert "USDC" in asset_types
    assert "SOL" in asset_types


@pytest.mark.asyncio
async def test_set_inventory_scope_suspended_connection_allowed(inventory_client: AsyncClient) -> None:
    setup = await _connection_setup(inventory_client)
    resp = await inventory_client.post(
        f"/connections/{setup['connection_id']}/suspend",
        headers=setup["supplier"]["headers"],
    )
    assert resp.status_code == 200

    resp = await inventory_client.put(
        f"/connections/{setup['connection_id']}/inventory-scope",
        json={"scope": {"BTC": "75.0"}},
        headers=setup["supplier"]["headers"],
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_book_loan_exact_boundary_succeeds(inventory_client: AsyncClient) -> None:
    setup = await _connection_setup(inventory_client)
    await _publish(inventory_client, setup, {"BTC": "100.0"})

    resp = await inventory_client.post(
        "/loans",
        json=_booking(setup, quantity="100.0"),
        headers=setup["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["state"] == "pending"


@pytest.mark.asyncio
async def test_book_loan_settled_loans_not_counted(
    inventory_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    setup = await _connection_setup(inventory_client)
    await _publish(inventory_client, setup, {"BTC": "100.0"})

    resp = await inventory_client.post(
        "/loans",
        json=_booking(setup, quantity="70.0"),
        headers=setup["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    loan_id = resp.json()["loan_id"]

    # Advance to settled directly — avoids threading through the full recall/return flow
    await db_session.execute(
        text("UPDATE loans SET state = 'settled' WHERE id = :id"),
        {"id": loan_id},
    )
    await db_session.commit()

    # The settled loan should not count; 100 BTC should now be fully available again
    resp = await inventory_client.post(
        "/loans",
        json=_booking(setup, quantity="100.0"),
        headers=setup["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_book_loan_defaulted_loans_not_counted(
    inventory_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    setup = await _connection_setup(inventory_client)
    await _publish(inventory_client, setup, {"BTC": "100.0"})

    resp = await inventory_client.post(
        "/loans",
        json=_booking(setup, quantity="60.0"),
        headers=setup["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    loan_id = resp.json()["loan_id"]

    await db_session.execute(
        text("UPDATE loans SET state = 'defaulted' WHERE id = :id"),
        {"id": loan_id},
    )
    await db_session.commit()

    resp = await inventory_client.post(
        "/loans",
        json=_booking(setup, quantity="100.0"),
        headers=setup["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_book_loan_concurrent_requests_do_not_oversubscribe(
    inventory_client: AsyncClient,
) -> None:
    setup = await _connection_setup(inventory_client)
    await _publish(inventory_client, setup, {"BTC": "100.0"})

    payload = _booking(setup, quantity="70.0")
    headers = setup["agent"]["headers"]

    results = await asyncio.gather(
        inventory_client.post("/loans", json=payload, headers=headers),
        inventory_client.post("/loans", json=payload, headers=headers),
        return_exceptions=True,
    )

    responses = [r for r in results if not isinstance(r, Exception)]
    statuses = [r.status_code for r in responses]

    assert statuses.count(201) == 1, f"Expected exactly 1 success; got statuses {statuses}"
    assert statuses.count(422) == 1

    failed = next(r for r in responses if r.status_code == 422)
    assert failed.json()["error"]["code"] == "exceeds_published_inventory"
