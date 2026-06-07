"""Org registration and profile endpoints."""
from fastapi import APIRouter, Depends, status

from app.api.deps import get_current_user, get_org_service
from app.schemas.auth import AuthUser
from app.schemas.orgs import (
    AgentRegisterRequest,
    OrgMeResponse,
    OrgRegisterResponse,
    SupplierRegisterRequest,
)
from app.services.org_service import AgentRegistrationInput, OrgService, SupplierRegistrationInput

router = APIRouter(prefix="/orgs", tags=["orgs"])


@router.post(
    "/register/supplier",
    response_model=OrgRegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new supplier organization",
)
async def register_supplier(
    body: SupplierRegisterRequest,
    svc: OrgService = Depends(get_org_service),
) -> OrgRegisterResponse:
    """
    Public endpoint. No authentication required.

    On success returns HTTP 201 with `org_id` and `access_token` (JWT bearer token).

    Error responses:
    - 409: duplicate email → `{"error": {"code": "duplicate_email", "message": "..."}}`
    - 422: validation failure (invalid entity_type, missing fields, password < 12 chars)
           → `{"error": {"code": "validation_error", "message": "..."}}`
    """
    result = await svc.register_supplier(
        SupplierRegistrationInput(
            name=body.name,
            jurisdiction=body.jurisdiction,
            entity_type=body.entity_type,
            contact_email=body.contact_email,
            password=body.password,
        )
    )
    return OrgRegisterResponse(
        org_id=result.org_id,
        access_token=result.access_token,
    )


@router.post(
    "/register/agent",
    response_model=OrgRegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new agent organization",
)
async def register_agent(
    body: AgentRegisterRequest,
    svc: OrgService = Depends(get_org_service),
) -> OrgRegisterResponse:
    """
    Public endpoint. No authentication required.

    `regulatory_status_attested` must be `true` — enforced in domain service.
    `ops_contact_email` must differ from `contact_email` — enforced in domain service.

    On success returns HTTP 201 with `org_id` and `access_token` (JWT bearer token).

    Error responses:
    - 409: duplicate email → `{"error": {"code": "duplicate_email", "message": "..."}}`
    - 422: attestation false → `{"error": {"code": "attestation_required", "message": "..."}}`
    - 422: ops/contact email collision → `{"error": {"code": "invalid_ops_email", "message": "..."}}`
    - 422: other validation failure → `{"error": {"code": "validation_error", "message": "..."}}`
    """
    result = await svc.register_agent(
        AgentRegistrationInput(
            name=body.name,
            jurisdiction=body.jurisdiction,
            entity_type=body.entity_type,
            contact_email=body.contact_email,
            password=body.password,
            ops_contact_email=body.ops_contact_email,
            regulatory_status_attested=body.regulatory_status_attested,
        )
    )
    return OrgRegisterResponse(
        org_id=result.org_id,
        access_token=result.access_token,
    )


@router.get(
    "/me",
    response_model=OrgMeResponse,
    status_code=status.HTTP_200_OK,
    summary="Return the authenticated user's organization",
)
async def get_my_org(
    caller: AuthUser = Depends(get_current_user),
    svc: OrgService = Depends(get_org_service),
) -> OrgMeResponse:
    """
    Requires valid JWT. Returns the organization the caller belongs to.

    Error responses:
    - 401: missing or invalid token
    - 403: JWT carries no org_id (e.g. M0 seed user with null org_id)
    - 404: org_id in JWT does not match any organization row (should not happen post-M1)
    """
    profile = await svc.get_my_org(caller)
    return OrgMeResponse(
        id=profile.id,
        name=profile.name,
        jurisdiction=profile.jurisdiction,
        entity_type=profile.entity_type,
        role=profile.role,
        contact_email=profile.contact_email,
        status=profile.status,
        created_at=profile.created_at,
    )
