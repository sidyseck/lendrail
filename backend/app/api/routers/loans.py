"""Loan lifecycle endpoints — M4."""
import asyncio
import json
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse

from app.adapters.interfaces import MarketDataAdapter
from app.adapters.price_simulator import PriceCache
from app.api.deps import get_current_user, get_current_user_sse, get_loan_service, get_market_data_adapter, get_price_cache_dep
from app.api.rbac import require_role
from app.schemas.auth import AuthUser
from app.schemas.loans import (
    ApprovedBorrowerListResponse,
    ApprovedBorrowerRequest,
    ApprovedBorrowerResponse,
    CollateralSubstitutionRequest,
    LoanBookingRequest,
    LoanCreateResponse,
    LoanListResponse,
    LoanResponse,
    LoanState,
    MarketPriceResponse,
)
from app.services.loan_service import (
    CollateralSubstitutionInput,
    LoanBookingInput,
    LoanService,
)

router = APIRouter(tags=["loans"])


def _loan_response(result) -> LoanResponse:
    return LoanResponse(
        loan_id=result.id,
        connection_id=result.connection_id,
        agreement_id=result.agreement_id,
        borrower_id=result.borrower_id,
        borrower_name=result.borrower_name,
        asset_type=result.asset_type,
        quantity=str(result.quantity),
        asset_price_usd=str(result.asset_price_usd),
        booking_ltv_pct=str(result.booking_ltv_pct),
        margin_call_ltv_pct=str(result.margin_call_ltv_pct),
        liquidation_ltv_pct=str(result.liquidation_ltv_pct),
        rate_bps=result.rate_bps,
        term_type=result.term_type,
        maturity_date=result.maturity_date,
        day_count_basis=result.day_count_basis,
        collateral_type=result.collateral_type,
        collateral_quantity=str(result.collateral_quantity),
        collateral_value_usd=str(result.collateral_value_usd),
        current_ltv_pct=str(result.current_ltv_pct) if result.current_ltv_pct is not None else None,
        ltv_as_of=result.ltv_as_of,
        state=result.state,
        booked_at=result.booked_at,
        activated_at=result.activated_at,
        recall_initiated_at=result.recall_initiated_at,
        recall_notice_deadline_at=result.recall_notice_deadline_at,
        return_custodian_ref=result.return_custodian_ref,
        return_instruction_at=result.return_instruction_at,
        settled_at=result.settled_at,
        defaulted_at=result.defaulted_at,
    )


def _approval_response(result) -> ApprovedBorrowerResponse:
    return ApprovedBorrowerResponse(
        borrower_id=result.borrower_id,
        name=result.name,
        jurisdiction=result.jurisdiction,
        status=result.status,
        approved_at=result.approved_at,
    )


@router.post(
    "/connections/{connection_id}/approved-borrowers",
    response_model=ApprovedBorrowerResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_approved_borrower(
    connection_id: uuid.UUID,
    body: ApprovedBorrowerRequest,
    caller: AuthUser = Depends(require_role("agent")),
    svc: LoanService = Depends(get_loan_service),
) -> ApprovedBorrowerResponse:
    result = await svc.add_approved_borrower(caller, connection_id, body.borrower_id)
    return _approval_response(result)


@router.get(
    "/connections/{connection_id}/approved-borrowers",
    response_model=ApprovedBorrowerListResponse,
)
async def list_approved_borrowers(
    connection_id: uuid.UUID,
    caller: AuthUser = Depends(get_current_user),
    svc: LoanService = Depends(get_loan_service),
) -> ApprovedBorrowerListResponse:
    results = await svc.list_approved_borrowers(caller, connection_id)
    return ApprovedBorrowerListResponse(borrowers=[_approval_response(r) for r in results])


@router.delete(
    "/connections/{connection_id}/approved-borrowers/{borrower_id}",
    status_code=status.HTTP_200_OK,
)
async def remove_approved_borrower(
    connection_id: uuid.UUID,
    borrower_id: uuid.UUID,
    caller: AuthUser = Depends(require_role("supplier")),
    svc: LoanService = Depends(get_loan_service),
) -> dict[str, str]:
    await svc.remove_approved_borrower(caller, connection_id, borrower_id)
    return {"status": "removed"}


@router.post(
    "/loans",
    response_model=LoanCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def book_loan(
    body: LoanBookingRequest,
    caller: AuthUser = Depends(require_role("agent")),
    svc: LoanService = Depends(get_loan_service),
) -> LoanCreateResponse:
    result = await svc.book_loan(
        caller,
        LoanBookingInput(
            connection_id=body.connection_id,
            borrower_id=body.borrower_id,
            asset_type=body.asset_type,
            quantity=Decimal(str(body.quantity)),
            asset_price_usd=Decimal(str(body.asset_price_usd)),
            booking_ltv_pct=Decimal(str(body.booking_ltv_pct)),
            margin_call_ltv_pct=Decimal(str(body.margin_call_ltv_pct)),
            liquidation_ltv_pct=Decimal(str(body.liquidation_ltv_pct)),
            rate_bps=body.rate_bps,
            term_type=body.term_type,
            maturity_date=body.maturity_date,
            collateral_type=body.collateral_type,
            collateral_quantity=Decimal(str(body.collateral_quantity)),
            collateral_value_usd=(
                Decimal(str(body.collateral_value_usd))
                if body.collateral_value_usd is not None
                else None
            ),
        ),
    )
    return LoanCreateResponse(loan_id=result.id, state=result.state)


@router.get("/market-data/prices/stream")
async def stream_prices(
    caller: AuthUser = Depends(get_current_user_sse),
    price_cache: PriceCache = Depends(get_price_cache_dep),
    max_events: int | None = Query(default=None, include_in_schema=False),
) -> StreamingResponse:
    """SSE — emits a JSON price snapshot every second. EventSource passes token via ?token=.

    Must be registered BEFORE the /{asset_type} route so FastAPI does not absorb
    the literal path segment 'stream' as a path parameter.

    max_events: test-only escape hatch; httpx ASGITransport buffers the entire body
    before returning so an infinite generator hangs the test. Pass max_events=1 to
    produce a finite stream that ASGI transport can collect.
    """
    if caller.role not in ("supplier", "agent"):
        from app.core.errors import Forbidden
        raise Forbidden("Only suppliers and agents can stream market prices")

    async def event_generator():
        count = 0
        while max_events is None or count < max_events:
            data = json.dumps(price_cache.all())
            yield f"data: {data}\n\n"
            count += 1
            if max_events is None or count < max_events:
                await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/market-data/prices/{asset_type}", response_model=MarketPriceResponse)
async def get_market_price(
    asset_type: str,
    caller: AuthUser = Depends(get_current_user),
    market_data: MarketDataAdapter = Depends(get_market_data_adapter),
) -> MarketPriceResponse:
    if caller.role not in ("supplier", "agent"):
        from app.core.errors import Forbidden

        raise Forbidden("Only suppliers and agents can view market prices")
    price = await market_data.get_price(asset_type)
    return MarketPriceResponse(
        asset_type=price.asset_type,
        price_usd=str(Decimal(str(price.price_usd))),
        as_of=price.as_of,
    )


@router.get("/loans", response_model=LoanListResponse)
async def list_loans(
    state: LoanState | None = Query(default=None),
    caller: AuthUser = Depends(get_current_user),
    svc: LoanService = Depends(get_loan_service),
) -> LoanListResponse:
    results = await svc.list_loans(caller, state)
    return LoanListResponse(loans=[_loan_response(r) for r in results])


@router.get("/loans/{loan_id}", response_model=LoanResponse)
async def get_loan(
    loan_id: uuid.UUID,
    caller: AuthUser = Depends(get_current_user),
    svc: LoanService = Depends(get_loan_service),
) -> LoanResponse:
    return _loan_response(await svc.get_loan(caller, loan_id))


@router.post("/loans/{loan_id}/recall", response_model=LoanResponse)
async def recall_loan(
    loan_id: uuid.UUID,
    caller: AuthUser = Depends(get_current_user),
    svc: LoanService = Depends(get_loan_service),
) -> LoanResponse:
    return _loan_response(await svc.recall(caller, loan_id))


@router.post("/loans/{loan_id}/return", response_model=LoanResponse)
async def return_loan(
    loan_id: uuid.UUID,
    caller: AuthUser = Depends(require_role("agent")),
    svc: LoanService = Depends(get_loan_service),
) -> LoanResponse:
    return _loan_response(await svc.return_assets(caller, loan_id))


@router.post("/loans/{loan_id}/collateral-substitution", response_model=LoanResponse)
async def substitute_collateral(
    loan_id: uuid.UUID,
    body: CollateralSubstitutionRequest,
    caller: AuthUser = Depends(require_role("agent")),
    svc: LoanService = Depends(get_loan_service),
) -> LoanResponse:
    result = await svc.substitute_collateral(
        caller,
        loan_id,
        CollateralSubstitutionInput(
            collateral_type=body.collateral_type,
            collateral_quantity=Decimal(str(body.collateral_quantity)),
            collateral_value_usd=Decimal(str(body.collateral_value_usd)),
        ),
    )
    return _loan_response(result)


@router.post("/loans/{loan_id}/default", response_model=LoanResponse)
async def default_loan(
    loan_id: uuid.UUID,
    caller: AuthUser = Depends(get_current_user),
    svc: LoanService = Depends(get_loan_service),
) -> LoanResponse:
    return _loan_response(await svc.mark_defaulted(caller, loan_id))
