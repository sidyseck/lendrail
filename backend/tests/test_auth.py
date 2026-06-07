"""F-004: JWT authentication tests."""
import uuid

import pytest
from httpx import AsyncClient

from app.models.user import User


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient, seed_user: User) -> None:
    response = await client.post(
        "/auth/login",
        json={"email": seed_user.email, "password": "correct-password"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient, seed_user: User) -> None:
    response = await client.post(
        "/auth/login",
        json={"email": seed_user.email, "password": "wrong-password"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


@pytest.mark.asyncio
async def test_login_unknown_email(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/login",
        json={"email": "nobody@example.com", "password": "any"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_protected_route_without_token(client: AsyncClient) -> None:
    response = await client.get("/auth/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_protected_route_with_tampered_token(client: AsyncClient, seed_user: User) -> None:
    response = await client.get(
        "/auth/me",
        headers={"Authorization": "Bearer this.is.not.valid"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_protected_route_with_valid_token(
    client: AsyncClient, seed_user: User, auth_headers: dict
) -> None:
    response = await client.get("/auth/me", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["user_id"] == str(seed_user.id)
    assert data["role"] == "supplier"


@pytest.mark.asyncio
async def test_token_claims_types(client: AsyncClient, seed_user: User) -> None:
    """Decoded claims must have user_id (UUID str), org_id (str|None), role (str)."""
    import jwt as pyjwt
    from app.core.config import get_settings

    resp = await client.post(
        "/auth/login",
        json={"email": seed_user.email, "password": "correct-password"},
    )
    token = resp.json()["access_token"]
    s = get_settings()
    claims = pyjwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])

    assert uuid.UUID(claims["sub"])  # must be a valid UUID string
    assert isinstance(claims["role"], str)
    assert claims["role"] in ("supplier", "agent", "admin")
    # org_id is None in M0 (no org linked yet)
    assert claims["org_id"] is None or isinstance(claims["org_id"], str)


@pytest.mark.asyncio
async def test_logout_returns_200(client: AsyncClient) -> None:
    response = await client.post("/auth/logout")
    assert response.status_code == 200
