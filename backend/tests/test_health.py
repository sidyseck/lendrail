"""F-001: Health endpoint tests."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_healthz_ok(client: AsyncClient) -> None:
    response = await client.get("/healthz")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
