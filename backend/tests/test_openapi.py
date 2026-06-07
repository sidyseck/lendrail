"""F-060: OpenAPI schema tests."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_openapi_json_returns_200(client: AsyncClient) -> None:
    response = await client.get("/openapi.json")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_openapi_info_title(client: AsyncClient) -> None:
    data = (await client.get("/openapi.json")).json()
    assert data["info"]["title"] == "LendRail API"


@pytest.mark.asyncio
async def test_openapi_auth_login_path_present(client: AsyncClient) -> None:
    data = (await client.get("/openapi.json")).json()
    assert "/auth/login" in data["paths"]


@pytest.mark.asyncio
async def test_openapi_schemas_present(client: AsyncClient) -> None:
    data = (await client.get("/openapi.json")).json()
    components = data.get("components", {}).get("schemas", {})
    assert "LoginRequest" in components
    assert "TokenResponse" in components


@pytest.mark.asyncio
async def test_openapi_version_present(client: AsyncClient) -> None:
    data = (await client.get("/openapi.json")).json()
    assert data["info"]["version"] == "0.1.0"
