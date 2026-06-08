"""Borrower management endpoints."""
import uuid

from fastapi import APIRouter, Depends, status

from app.api.deps import get_borrower_service
from app.api.rbac import require_role
from app.schemas.auth import AuthUser
from app.schemas.borrowers import (
    BorrowerCreateRequest,
    BorrowerCreateResponse,
    BorrowerDetailResponse,
    BorrowerInviteRequest,
    BorrowerInviteResponse,
    BorrowerListResponse,
)
from app.services.borrower_service import BorrowerCreateInput, BorrowerInviteInput, BorrowerService

router = APIRouter(prefix="/borrowers", tags=["borrowers"])


def _detail_response(result) -> BorrowerDetailResponse:
    return BorrowerDetailResponse(
        id=result.id,
        invited_by=result.invited_by,
        name=result.name,
        jurisdiction=result.jurisdiction,
        contact_email=result.contact_email,
        status=result.status,
        created_at=result.created_at,
    )


@router.post(
    "",
    response_model=BorrowerCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a borrower record (agent only)",
)
async def create_borrower(
    body: BorrowerCreateRequest,
    caller: AuthUser = Depends(require_role("agent")),
    svc: BorrowerService = Depends(get_borrower_service),
) -> BorrowerCreateResponse:
    """
    Requires agent JWT. Creates an agent-managed Borrower row with status=active.
    If connection_id is supplied, also adds the borrower to that connection's
    approved-borrower list so the supplier can see them and the agent can book
    loans against them.

    Error responses:
    - 401: missing/invalid token
    - 403: caller is not an agent, or connection is not owned by caller's org
    - 409: contact_email already exists, or connection is not active
    - 422: missing required fields
    """
    result = await svc.create_borrower(
        caller=caller,
        data=BorrowerCreateInput(
            name=body.name,
            jurisdiction=body.jurisdiction,
            contact_email=body.contact_email,
            connection_id=body.connection_id,
        ),
    )
    return BorrowerCreateResponse(
        borrower_id=result.borrower.id,
        status="active",
        approved_connection_id=result.approved_connection_id,
    )


@router.post(
    "/invite",
    response_model=BorrowerInviteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Invite a borrower (agent only)",
)
async def invite_borrower(
    body: BorrowerInviteRequest,
    caller: AuthUser = Depends(require_role("agent")),
    svc: BorrowerService = Depends(get_borrower_service),
) -> BorrowerInviteResponse:
    """
    Requires agent JWT. Creates a Borrower row with status=invited and fires
    a 'borrower_invited' notification event (console log in MVP).

    Error responses:
    - 401: missing/invalid token
    - 403: caller is not an agent → `{"error": {"code": "forbidden", "message": "..."}}`
    - 409: contact_email already exists → `{"error": {"code": "duplicate_email", "message": "..."}}`
    - 422: missing required fields → `{"error": {"code": "validation_error", "message": "..."}}`
    """
    result = await svc.invite_borrower(
        caller=caller,
        data=BorrowerInviteInput(
            name=body.name,
            jurisdiction=body.jurisdiction,
            contact_email=body.contact_email,
        ),
    )
    return BorrowerInviteResponse(borrower_id=result.id)


@router.get(
    "",
    response_model=BorrowerListResponse,
    status_code=status.HTTP_200_OK,
    summary="List borrower records managed by the calling agent",
)
async def list_borrowers(
    caller: AuthUser = Depends(require_role("agent")),
    svc: BorrowerService = Depends(get_borrower_service),
) -> BorrowerListResponse:
    results = await svc.list_borrowers(caller=caller)
    return BorrowerListResponse(borrowers=[_detail_response(result) for result in results])


@router.get(
    "/{borrower_id}",
    response_model=BorrowerDetailResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve a borrower record (agent only)",
)
async def get_borrower(
    borrower_id: uuid.UUID,
    caller: AuthUser = Depends(require_role("agent")),
    svc: BorrowerService = Depends(get_borrower_service),
) -> BorrowerDetailResponse:
    """
    Requires agent JWT. Agent must have invited this borrower.

    Error responses:
    - 401: missing/invalid token
    - 403: caller is not agent, or borrower belongs to a different agent org
    - 404: borrower_id not found
    """
    result = await svc.get_borrower(caller=caller, borrower_id=borrower_id)
    return _detail_response(result)
