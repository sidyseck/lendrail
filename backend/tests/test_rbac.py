"""F-005: RBAC enforcement tests."""
import pytest
from fastapi import APIRouter, Depends
from httpx import ASGITransport, AsyncClient

from app.api.rbac import require_agent, require_admin, require_supplier
from app.models.user import User
from app.schemas.auth import AuthUser

from tests.conftest import make_auth_headers


def _add_test_routes(app):  # type: ignore[no-untyped-def]
    router = APIRouter(prefix="/test-rbac", tags=["test"])

    @router.get("/supplier-only")
    async def supplier_route(user: AuthUser = Depends(require_supplier)) -> dict:  # type: ignore[type-arg]
        return {"role": user.role}

    @router.get("/agent-only")
    async def agent_route(user: AuthUser = Depends(require_agent)) -> dict:  # type: ignore[type-arg]
        return {"role": user.role}

    @router.get("/admin-only")
    async def admin_route(user: AuthUser = Depends(require_admin)) -> dict:  # type: ignore[type-arg]
        return {"role": user.role}

    app.include_router(router)
    return app


@pytest.fixture
def rbac_app(app):  # type: ignore[no-untyped-def]
    return _add_test_routes(app)


@pytest.mark.asyncio
async def test_supplier_can_access_supplier_route(rbac_app, seed_user: User) -> None:
    headers = make_auth_headers(seed_user)
    async with AsyncClient(transport=ASGITransport(app=rbac_app), base_url="http://test") as c:
        resp = await c.get("/test-rbac/supplier-only", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["role"] == "supplier"


@pytest.mark.asyncio
async def test_agent_blocked_from_supplier_route(rbac_app, seed_agent: User) -> None:
    headers = make_auth_headers(seed_agent)
    async with AsyncClient(transport=ASGITransport(app=rbac_app), base_url="http://test") as c:
        resp = await c.get("/test-rbac/supplier-only", headers=headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_supplier_blocked_from_agent_route(rbac_app, seed_user: User) -> None:
    headers = make_auth_headers(seed_user)
    async with AsyncClient(transport=ASGITransport(app=rbac_app), base_url="http://test") as c:
        resp = await c.get("/test-rbac/agent-only", headers=headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_agent_can_access_agent_route(rbac_app, seed_agent: User) -> None:
    headers = make_auth_headers(seed_agent)
    async with AsyncClient(transport=ASGITransport(app=rbac_app), base_url="http://test") as c:
        resp = await c.get("/test-rbac/agent-only", headers=headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_admin_can_access_admin_route(rbac_app, seed_admin: User) -> None:
    headers = make_auth_headers(seed_admin)
    async with AsyncClient(transport=ASGITransport(app=rbac_app), base_url="http://test") as c:
        resp = await c.get("/test-rbac/admin-only", headers=headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_supplier_blocked_from_admin_route(rbac_app, seed_user: User) -> None:
    headers = make_auth_headers(seed_user)
    async with AsyncClient(transport=ASGITransport(app=rbac_app), base_url="http://test") as c:
        resp = await c.get("/test-rbac/admin-only", headers=headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_agent_blocked_from_admin_route(rbac_app, seed_agent: User) -> None:
    headers = make_auth_headers(seed_agent)
    async with AsyncClient(transport=ASGITransport(app=rbac_app), base_url="http://test") as c:
        resp = await c.get("/test-rbac/admin-only", headers=headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_no_token_on_protected_route(rbac_app) -> None:
    async with AsyncClient(transport=ASGITransport(app=rbac_app), base_url="http://test") as c:
        resp = await c.get("/test-rbac/supplier-only")
    assert resp.status_code == 401
