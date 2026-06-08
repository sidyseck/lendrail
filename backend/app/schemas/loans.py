import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator


LoanState = Literal["pending", "active", "margin_call", "recall_initiated", "settled", "defaulted"]


class ApprovedBorrowerRequest(BaseModel):
    borrower_id: uuid.UUID


class ApprovedBorrowerResponse(BaseModel):
    borrower_id: uuid.UUID
    name: str
    jurisdiction: str
    status: str
    approved_at: datetime


class ApprovedBorrowerListResponse(BaseModel):
    borrowers: list[ApprovedBorrowerResponse]


class LoanBookingRequest(BaseModel):
    connection_id: uuid.UUID
    borrower_id: uuid.UUID
    asset_type: str = Field(min_length=1)
    quantity: Decimal = Field(gt=0)
    rate_bps: int = Field(ge=0)
    term_type: Literal["open", "fixed"]
    maturity_date: date | None = None
    collateral_type: str = Field(min_length=1)
    collateral_quantity: Decimal = Field(gt=0)
    collateral_value_usd: Decimal = Field(gt=0)

    @model_validator(mode="after")
    def fixed_term_requires_maturity(self) -> "LoanBookingRequest":
        if self.term_type == "fixed" and self.maturity_date is None:
            raise ValueError("fixed-term loans require maturity_date")
        if self.term_type == "open" and self.maturity_date is not None:
            raise ValueError("open-term loans must not include maturity_date")
        return self


class LoanCreateResponse(BaseModel):
    loan_id: uuid.UUID
    state: LoanState


class LoanResponse(BaseModel):
    loan_id: uuid.UUID
    connection_id: uuid.UUID
    agreement_id: uuid.UUID
    borrower_id: uuid.UUID
    borrower_name: str
    asset_type: str
    quantity: str
    rate_bps: int
    term_type: str
    maturity_date: date | None
    day_count_basis: str
    collateral_type: str
    collateral_quantity: str
    collateral_value_usd: str
    current_ltv_pct: str | None
    ltv_as_of: datetime | None
    state: LoanState
    booked_at: datetime
    activated_at: datetime | None
    recall_initiated_at: datetime | None
    recall_notice_deadline_at: datetime | None
    return_custodian_ref: str | None
    return_instruction_at: datetime | None
    settled_at: datetime | None
    defaulted_at: datetime | None


class LoanListResponse(BaseModel):
    loans: list[LoanResponse]


class CollateralSubstitutionRequest(BaseModel):
    collateral_type: str = Field(min_length=1)
    collateral_quantity: Decimal = Field(gt=0)
    collateral_value_usd: Decimal = Field(gt=0)
