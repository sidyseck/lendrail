from uuid import UUID
from pydantic import BaseModel, Field


class RegisterCustodianRequest(BaseModel):
    custodian_id: str = Field(..., min_length=1, max_length=64)
    account_ref: str = Field(..., min_length=1, max_length=255)
    plaintext_key: str = Field(..., min_length=1, max_length=1024)


class CustodianResponse(BaseModel):
    custodian_link_id: UUID
    org_id: UUID
    custodian_id: str
    account_ref: str
    status: str
    created_at: str


class CustodianListResponse(BaseModel):
    custodians: list[CustodianResponse]
