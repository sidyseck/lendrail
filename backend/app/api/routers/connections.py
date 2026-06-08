"""Connection management endpoints — F-022 through F-026."""
import uuid

from fastapi import APIRouter, Depends, status

from app.api.deps import get_agreement_service, get_connection_service, get_current_user
from app.api.rbac import require_role
from app.schemas.auth import AuthUser
from app.schemas.connections import (
    ConnectionListResponse,
    ConnectionResponse,
    InviteConnectionRequest,
    InviteUnknownAgentResponse,
    TerminateResponse,
)
from app.services.agreement_service import AgreementService
from app.services.connection_service import (
    ConnectionService,
    InviteConnectionInput,
)

router = APIRouter(prefix="/connections", tags=["connections"])


def _to_response(result) -> ConnectionResponse:
    return ConnectionResponse(
        connection_id=result.id,
        supplier_id=result.supplier_id,
        agent_id=result.agent_id,
        status=result.status,
        created_at=result.created_at,
        activated_at=result.activated_at,
        pending_agreement=result.pending_agreement,
    )


async def _with_pending_agreement(
    result,
    agreement_svc: AgreementService,
) -> ConnectionResponse:
    """Populate pending_agreement by querying the agreements repository."""
    latest = await agreement_svc.agreements.get_latest_for_connection(result.id)
    pending = latest is not None and not latest.is_active
    result.pending_agreement = pending
    return _to_response(result)


# ── F-022 ─────────────────────────────────────────────────────────────────────

@router.post(
    "/invite",
    status_code=status.HTTP_201_CREATED,
    summary="Supplier sends connection invitation to an agent",
)
async def invite(
    body: InviteConnectionRequest,
    caller: AuthUser = Depends(require_role("supplier")),
    svc: ConnectionService = Depends(get_connection_service),
):
    result, known = await svc.invite(
        caller=caller,
        data=InviteConnectionInput(
            agent_org_id=body.agent_org_id,
            agent_email=str(body.agent_email) if body.agent_email else None,
        ),
    )
    if not known:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content=InviteUnknownAgentResponse(
                agent_email=str(body.agent_email),
            ).model_dump(),
        )
    return _to_response(result)


# ── F-023 ─────────────────────────────────────────────────────────────────────

@router.post(
    "/{connection_id}/accept",
    response_model=ConnectionResponse,
    status_code=status.HTTP_200_OK,
    summary="Agent accepts a pending connection invitation — connection becomes active",
)
async def accept(
    connection_id: uuid.UUID,
    caller: AuthUser = Depends(require_role("agent")),
    svc: ConnectionService = Depends(get_connection_service),
) -> ConnectionResponse:
    result = await svc.accept(caller=caller, connection_id=connection_id)
    return _to_response(result)


# ── F-025 — suspend ────────────────────────────────────────────────────────────

@router.post(
    "/{connection_id}/suspend",
    response_model=ConnectionResponse,
    status_code=status.HTTP_200_OK,
    summary="Suspend a connection (supplier or agent)",
)
async def suspend(
    connection_id: uuid.UUID,
    caller: AuthUser = Depends(get_current_user),
    svc: ConnectionService = Depends(get_connection_service),
) -> ConnectionResponse:
    result = await svc.suspend(caller=caller, connection_id=connection_id)
    return _to_response(result)


@router.post(
    "/{connection_id}/reactivate",
    response_model=ConnectionResponse,
    status_code=status.HTTP_200_OK,
    summary="Reactivate a suspended connection (supplier or agent)",
)
async def reactivate(
    connection_id: uuid.UUID,
    caller: AuthUser = Depends(get_current_user),
    svc: ConnectionService = Depends(get_connection_service),
) -> ConnectionResponse:
    result = await svc.reactivate(caller=caller, connection_id=connection_id)
    return _to_response(result)


# ── F-025 — terminate ─────────────────────────────────────────────────────────

@router.post(
    "/{connection_id}/terminate",
    response_model=TerminateResponse,
    status_code=status.HTTP_200_OK,
    summary="Terminate a connection (supplier or agent)",
)
async def terminate(
    connection_id: uuid.UUID,
    caller: AuthUser = Depends(get_current_user),
    svc: ConnectionService = Depends(get_connection_service),
) -> TerminateResponse:
    result = await svc.terminate(caller=caller, connection_id=connection_id)
    return TerminateResponse(
        connection_id=result.connection_id,
        status="terminated",
        flagged_loan_ids=[str(lid) for lid in result.flagged_loan_ids],
    )


# ── F-026 — list ──────────────────────────────────────────────────────────────

@router.get(
    "",
    response_model=ConnectionListResponse,
    status_code=status.HTTP_200_OK,
    summary="List connections for the calling org (admin sees all)",
)
async def list_connections(
    caller: AuthUser = Depends(get_current_user),
    svc: ConnectionService = Depends(get_connection_service),
    agreement_svc: AgreementService = Depends(get_agreement_service),
) -> ConnectionListResponse:
    result = await svc.list_for_org(caller=caller)
    responses = [
        await _with_pending_agreement(r, agreement_svc)
        for r in result.connections
    ]
    return ConnectionListResponse(connections=responses)


# ── F-026 — detail ────────────────────────────────────────────────────────────

@router.get(
    "/{connection_id}",
    response_model=ConnectionResponse,
    status_code=status.HTTP_200_OK,
    summary="Get connection detail",
)
async def get_connection(
    connection_id: uuid.UUID,
    caller: AuthUser = Depends(get_current_user),
    svc: ConnectionService = Depends(get_connection_service),
    agreement_svc: AgreementService = Depends(get_agreement_service),
) -> ConnectionResponse:
    result = await svc.get_detail(caller=caller, connection_id=connection_id)
    return await _with_pending_agreement(result, agreement_svc)
