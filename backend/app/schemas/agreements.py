"""Agreement schemas — F-028 through F-031."""
from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


# ── Request models ─────────────────────────────────────────────────────────────

class AgreementTermsRequest(BaseModel):
    """Used for both POST (create) and PUT (amend)."""

    assets_in_scope: list[str] = Field(..., min_length=1)
    eligible_collateral: list[str] = Field(..., min_length=1)
    initial_ltv_pct: Decimal = Field(..., gt=0, lt=100)
    margin_call_ltv_pct: Decimal = Field(..., gt=0, lt=100)
    liquidation_ltv_pct: Decimal = Field(..., gt=0, lt=100)
    recall_notice_days: int = Field(..., ge=1)
    max_loan_days: int = Field(..., ge=1)
    day_count_basis: Literal["actual_360", "actual_365"]
    agent_fee_bps: int = Field(..., ge=0, le=10000)

    @model_validator(mode="after")
    def margin_call_exceeds_initial(self) -> "AgreementTermsRequest":
        if self.margin_call_ltv_pct <= self.initial_ltv_pct:
            raise ValueError(
                "margin_call_ltv_pct must be greater than initial_ltv_pct"
            )
        if self.liquidation_ltv_pct <= self.margin_call_ltv_pct:
            raise ValueError(
                "liquidation_ltv_pct must be greater than margin_call_ltv_pct"
            )
        return self


# ── Response models ────────────────────────────────────────────────────────────

class AgreementResponse(BaseModel):
    model_config = ConfigDict(json_encoders={datetime: lambda v: v.isoformat()})

    agreement_id: UUID
    connection_id: UUID
    version: int
    assets_in_scope: list[str]
    eligible_collateral: list[str]
    initial_ltv_pct: str       # Decimal serialized as string to avoid float precision issues
    margin_call_ltv_pct: str
    liquidation_ltv_pct: str
    recall_notice_days: int
    max_loan_days: int
    day_count_basis: str
    agent_fee_bps: int
    confirmed_by_supplier_at: AwareDatetime | None
    confirmed_by_agent_at: AwareDatetime | None
    status: Literal["pending_confirmation", "active"]   # derived
    created_at: AwareDatetime


class AgreementHistoryResponse(BaseModel):
    agreements: list[AgreementResponse]
