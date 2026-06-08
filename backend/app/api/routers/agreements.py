"""Agreement management endpoints — F-028 through F-031."""
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, status

from app.api.deps import get_agreement_service, get_current_user
from app.api.rbac import require_role
from app.schemas.agreements import (
    AgreementHistoryResponse,
    AgreementResponse,
    AgreementTermsRequest,
)
from app.schemas.auth import AuthUser
from app.services.agreement_service import AgreementService, AgreementTermsInput

router = APIRouter(tags=["agreements"])


def _to_response(result) -> AgreementResponse:
    return AgreementResponse(
        agreement_id=result.id,
        connection_id=result.connection_id,
        version=result.version,
        assets_in_scope=result.assets_in_scope,
        eligible_collateral=result.eligible_collateral,
        initial_ltv_pct=str(result.initial_ltv_pct),
        margin_call_ltv_pct=str(result.margin_call_ltv_pct),
        recall_notice_days=result.recall_notice_days,
        max_loan_days=result.max_loan_days,
        day_count_basis=result.day_count_basis,
        agent_fee_bps=result.agent_fee_bps,
        confirmed_by_supplier_at=result.confirmed_by_supplier_at,
        confirmed_by_agent_at=result.confirmed_by_agent_at,
        status=result.status,
        created_at=result.created_at,
    )


def _terms_input(body: AgreementTermsRequest) -> AgreementTermsInput:
    return AgreementTermsInput(
        assets_in_scope=body.assets_in_scope,
        eligible_collateral=body.eligible_collateral,
        initial_ltv_pct=Decimal(str(body.initial_ltv_pct)),
        margin_call_ltv_pct=Decimal(str(body.margin_call_ltv_pct)),
        recall_notice_days=body.recall_notice_days,
        max_loan_days=body.max_loan_days,
        day_count_basis=body.day_count_basis,
        agent_fee_bps=body.agent_fee_bps,
    )


# ── F-029 — POST /connections/{connection_id}/agreement ───────────────────────

@router.post(
    "/connections/{connection_id}/agreement",
    response_model=AgreementResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Agent creates a lending agreement for a connection",
)
async def create_agreement(
    connection_id: uuid.UUID,
    body: AgreementTermsRequest,
    caller: AuthUser = Depends(require_role("agent")),
    svc: AgreementService = Depends(get_agreement_service),
) -> AgreementResponse:
    """
    Requires agent JWT. Agent must own the connection (agent_id match).
    Connection must be in active status.
    """
    result = await svc.create_agreement(
        caller=caller,
        connection_id=connection_id,
        data=_terms_input(body),
    )
    return _to_response(result)


# ── F-030 — POST /agreements/{agreement_id}/confirm ───────────────────────────

@router.post(
    "/agreements/{agreement_id}/confirm",
    response_model=AgreementResponse,
    status_code=status.HTTP_200_OK,
    summary="Supplier or agent confirms the current agreement version",
)
async def confirm_agreement(
    agreement_id: uuid.UUID,
    caller: AuthUser = Depends(get_current_user),
    svc: AgreementService = Depends(get_agreement_service),
) -> AgreementResponse:
    """
    Requires supplier or agent JWT. Caller must be a party to the connection.
    Only the latest version may be confirmed.
    """
    result = await svc.confirm_agreement(caller=caller, agreement_id=agreement_id)
    return _to_response(result)


# ── F-031a — PUT /agreements/{agreement_id} ───────────────────────────────────

@router.put(
    "/agreements/{agreement_id}",
    response_model=AgreementResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Agent amends the current agreement — creates a new version",
)
async def amend_agreement(
    agreement_id: uuid.UUID,
    body: AgreementTermsRequest,
    caller: AuthUser = Depends(require_role("agent")),
    svc: AgreementService = Depends(get_agreement_service),
) -> AgreementResponse:
    """
    Requires agent JWT. agreement_id identifies the version being amended.
    Response body contains the newly created row (new agreement_id and version).
    """
    result = await svc.amend_agreement(
        caller=caller,
        agreement_id=agreement_id,
        data=_terms_input(body),
    )
    return _to_response(result)


# ── Convenience read — GET /connections/{connection_id}/agreement ─────────────

@router.get(
    "/connections/{connection_id}/agreement",
    response_model=AgreementResponse,
    status_code=status.HTTP_200_OK,
    summary="Get the latest agreement version for a connection",
)
async def get_latest_agreement(
    connection_id: uuid.UUID,
    caller: AuthUser = Depends(get_current_user),
    svc: AgreementService = Depends(get_agreement_service),
) -> AgreementResponse:
    """
    Returns the highest-version agreement for the connection.
    404 if no agreement exists.
    """
    result = await svc.get_latest_for_connection(
        caller=caller, connection_id=connection_id
    )
    return _to_response(result)


# ── F-031b — GET /connections/{connection_id}/agreement/history ───────────────

@router.get(
    "/connections/{connection_id}/agreement/history",
    response_model=AgreementHistoryResponse,
    status_code=status.HTTP_200_OK,
    summary="List all agreement versions for a connection (ordered by version ASC)",
)
async def list_agreement_history(
    connection_id: uuid.UUID,
    caller: AuthUser = Depends(get_current_user),
    svc: AgreementService = Depends(get_agreement_service),
) -> AgreementHistoryResponse:
    """
    Requires supplier or agent JWT. Caller must be a party to the connection.
    """
    results = await svc.list_history(caller=caller, connection_id=connection_id)
    return AgreementHistoryResponse(agreements=[_to_response(r) for r in results])
