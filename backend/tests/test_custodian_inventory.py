"""Chunk 2 tests — GET /custodians/{id}/inventory endpoint."""
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

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
async def custodian_client(app) -> AsyncClient:
    app.dependency_overrides[get_custodian_adapter] = lambda: MockCustodianAdapter(
        inventory={"BTC": 500.0, "ETH": 200.0},
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def empty_custodian_client(app) -> AsyncClient:
    app.dependency_overrides[get_custodian_adapter] = lambda: MockCustodianAdapter(inventory={})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _register_custodian(client: AsyncClient, supplier_headers: dict) -> str:
    resp = await client.post(
        "/custodians",
        json={"custodian_id": "mock", "account_ref": "acct-001", "plaintext_key": "test-key"},
        headers=supplier_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["custodian_link_id"]


@pytest.mark.asyncio
async def test_get_custodian_inventory_returns_positions(custodian_client: AsyncClient) -> None:
    supplier = await _register_supplier(custodian_client)
    link_id = await _register_custodian(custodian_client, supplier["headers"])

    resp = await custodian_client.get(
        f"/custodians/{link_id}/inventory",
        headers=supplier["headers"],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["custodian_link_id"] == link_id
    assert body["account_ref"] == "acct-001"

    positions = {p["asset_type"]: p for p in body["positions"]}
    assert "BTC" in positions
    assert "ETH" in positions
    assert float(positions["BTC"]["quantity"]) == 500.0
    assert float(positions["ETH"]["quantity"]) == 200.0
    # as_of is a non-empty ISO-8601 string
    assert positions["BTC"]["as_of"]
    assert "T" in positions["BTC"]["as_of"]


@pytest.mark.asyncio
async def test_get_custodian_inventory_quantity_serialized_as_string(
    custodian_client: AsyncClient,
) -> None:
    supplier = await _register_supplier(custodian_client)
    link_id = await _register_custodian(custodian_client, supplier["headers"])

    resp = await custodian_client.get(f"/custodians/{link_id}/inventory", headers=supplier["headers"])
    assert resp.status_code == 200
    for pos in resp.json()["positions"]:
        assert isinstance(pos["quantity"], str), "quantity must be a string (Decimal serialization)"


@pytest.mark.asyncio
async def test_get_custodian_inventory_wrong_org_forbidden(custodian_client: AsyncClient) -> None:
    supplier_a = await _register_supplier(custodian_client)
    supplier_b = await _register_supplier(custodian_client)
    link_id = await _register_custodian(custodian_client, supplier_a["headers"])

    resp = await custodian_client.get(
        f"/custodians/{link_id}/inventory",
        headers=supplier_b["headers"],
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_custodian_inventory_agent_forbidden(custodian_client: AsyncClient) -> None:
    supplier = await _register_supplier(custodian_client)
    link_id = await _register_custodian(custodian_client, supplier["headers"])
    agent = await _register_agent(custodian_client)

    resp = await custodian_client.get(
        f"/custodians/{link_id}/inventory",
        headers=agent["headers"],
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_custodian_inventory_not_found(custodian_client: AsyncClient) -> None:
    supplier = await _register_supplier(custodian_client)
    random_id = str(uuid.uuid4())

    resp = await custodian_client.get(
        f"/custodians/{random_id}/inventory",
        headers=supplier["headers"],
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_custodian_inventory_empty_positions(empty_custodian_client: AsyncClient) -> None:
    supplier = await _register_supplier(empty_custodian_client)
    link_id = await _register_custodian(empty_custodian_client, supplier["headers"])

    resp = await empty_custodian_client.get(
        f"/custodians/{link_id}/inventory",
        headers=supplier["headers"],
    )
    assert resp.status_code == 200
    assert resp.json()["positions"] == []
