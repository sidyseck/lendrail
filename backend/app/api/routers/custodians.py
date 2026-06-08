"""Custodian management endpoints — supplier org-level custodian links."""
import uuid

from fastapi import APIRouter, Depends, status

from app.api.deps import get_custodian_service
from app.api.rbac import require_role
from app.schemas.auth import AuthUser
from app.schemas.custodians import (
    CustodianInventoryPosition,
    CustodianInventoryResponse,
    CustodianListResponse,
    CustodianResponse,
    RegisterCustodianRequest,
)
from app.services.custodian_service import CustodianService, RegisterCustodianInput

router = APIRouter(prefix="/custodians", tags=["custodians"])


def _to_response(result) -> CustodianResponse:
    return CustodianResponse(
        custodian_link_id=result.custodian_link_id,
        org_id=result.org_id,
        custodian_id=result.custodian_id,
        account_ref=result.account_ref,
        status=result.status,
        created_at=result.created_at,
    )


@router.post(
    "",
    response_model=CustodianResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Supplier registers a custodian for their organization",
)
async def register_custodian(
    body: RegisterCustodianRequest,
    caller: AuthUser = Depends(require_role("supplier")),
    svc: CustodianService = Depends(get_custodian_service),
) -> CustodianResponse:
    result = await svc.register(
        caller=caller,
        data=RegisterCustodianInput(
            custodian_id=body.custodian_id,
            account_ref=body.account_ref,
            plaintext_key=body.plaintext_key,
        ),
    )
    return _to_response(result)


@router.get(
    "",
    response_model=CustodianListResponse,
    status_code=status.HTTP_200_OK,
    summary="List custodians registered for the calling supplier's organization",
)
async def list_custodians(
    caller: AuthUser = Depends(require_role("supplier")),
    svc: CustodianService = Depends(get_custodian_service),
) -> CustodianListResponse:
    results = await svc.list_for_org(caller=caller)
    return CustodianListResponse(custodians=[_to_response(r) for r in results])


@router.get(
    "/{custodian_link_id}/inventory",
    response_model=CustodianInventoryResponse,
    status_code=status.HTTP_200_OK,
    summary="Get live inventory positions for a custodian link (supplier only)",
)
async def get_custodian_inventory(
    custodian_link_id: uuid.UUID,
    caller: AuthUser = Depends(require_role("supplier")),
    svc: CustodianService = Depends(get_custodian_service),
) -> CustodianInventoryResponse:
    result = await svc.get_inventory(caller=caller, custodian_link_id=custodian_link_id)
    return CustodianInventoryResponse(
        custodian_link_id=result.custodian_link_id,
        account_ref=result.account_ref,
        positions=[
            CustodianInventoryPosition(
                asset_type=p.asset_type,
                quantity=str(p.quantity),
                as_of=p.as_of,
            )
            for p in result.positions
        ],
    )
