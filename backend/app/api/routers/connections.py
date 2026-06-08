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
    RegisterCustodianKeyRequest,
    TerminateResponse,
)
from app.services.agreement_service import AgreementService
from app.services.connection_service import (
    ConnectionService,
    InviteConnectionInput,
    RegisterCustodianKeyInput,
)

router = APIRouter(prefix="/connections", tags=["connections"])


def _to_response(result) -> ConnectionResponse:
    return ConnectionResponse(
        connection_id=result.id,
        supplier_id=result.supplier_id,
        agent_id=result.agent_id,
        status=result.status,
        custodian_link_present=result.custodian_link_id is not None,
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
    """
    Requires supplier JWT.

    If agent_org_id is provided and the agent is known:
    - Returns HTTP 201 with ConnectionResponse, status="pending".

    If agent_email is provided and the agent is not yet registered:
    - Returns HTTP 202 with InviteUnknownAgentResponse.
    - A 'connection_invite_to_unknown' notification event is logged.
    """
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
    summary="Agent accepts a pending connection invitation",
)
async def accept(
    connection_id: uuid.UUID,
    caller: AuthUser = Depends(require_role("agent")),
    svc: ConnectionService = Depends(get_connection_service),
) -> ConnectionResponse:
    """
    Requires agent JWT. Agent must be the named agent on the connection.

    Transitions status: pending → accepted.
    """
    result = await svc.accept(caller=caller, connection_id=connection_id)
    return _to_response(result)


# ── F-024 ─────────────────────────────────────────────────────────────────────

@router.post(
    "/{connection_id}/custodian-key",
    response_model=ConnectionResponse,
    status_code=status.HTTP_200_OK,
    summary="Supplier registers custodian API key for a connection",
)
async def register_custodian_key(
    connection_id: uuid.UUID,
    body: RegisterCustodianKeyRequest,
    caller: AuthUser = Depends(require_role("supplier")),
    svc: ConnectionService = Depends(get_connection_service),
) -> ConnectionResponse:
    """
    Requires supplier JWT. Supplier must own the connection (supplier_id match).

    The plaintext_key is passed to SecretStore and then to CustodianAdapter.validate_key().
    It is NEVER returned in the response body. It is NEVER written to any log line.
    """
    result = await svc.register_custodian_key(
        caller=caller,
        connection_id=connection_id,
        data=RegisterCustodianKeyInput(
            custodian_id=body.custodian_id,
            account_ref=body.account_ref,
            plaintext_key=body.plaintext_key,
        ),
    )
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
    """
    Requires supplier or agent JWT. Either party may suspend.
    """
    result = await svc.suspend(caller=caller, connection_id=connection_id)
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
    """
    Requires supplier or agent JWT. Either party may terminate.

    On termination, all active loans associated with this connection are flagged
    (no-op in M2 — loans table added in M4). The supplier is alerted to rotate
    the custodian API key at the custodian; the platform cannot revoke it.
    """
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
    """
    Supplier: returns connections where supplier_id = caller.org_id.
    Agent: returns connections where agent_id = caller.org_id.
    Admin: returns all connections.
    """
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
    """
    Caller must be a party to the connection (supplier_id or agent_id match),
    or be an admin.
    """
    result = await svc.get_detail(caller=caller, connection_id=connection_id)
    return await _with_pending_agreement(result, agreement_svc)
