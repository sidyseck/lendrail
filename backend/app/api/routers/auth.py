from fastapi import APIRouter, Depends

from app.api.deps import get_auth_service, get_current_user
from app.schemas.auth import AuthUser, LoginRequest, TokenResponse
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest, svc: AuthService = Depends(get_auth_service)
) -> TokenResponse:
    token = await svc.login(body.email, body.password)
    return TokenResponse(access_token=token)


@router.post("/logout", status_code=200)
async def logout() -> dict:  # type: ignore[type-arg]
    """Stateless JWT — no server-side token revocation in M0. Returns 200."""
    return {"detail": "logged out"}


@router.get("/me")
async def me(user: AuthUser = Depends(get_current_user)) -> dict:  # type: ignore[type-arg]
    """Protected smoke endpoint for F-004/F-005 tests."""
    return {
        "user_id": str(user.user_id),
        "org_id": str(user.org_id) if user.org_id else None,
        "role": user.role,
    }
