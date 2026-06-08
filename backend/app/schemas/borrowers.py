from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class BorrowerInviteRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    jurisdiction: str = Field(..., min_length=1, max_length=255)
    contact_email: EmailStr


class BorrowerInviteResponse(BaseModel):
    borrower_id: UUID


class BorrowerCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    jurisdiction: str = Field(..., min_length=1, max_length=255)
    contact_email: EmailStr
    connection_id: UUID | None = None


class BorrowerCreateResponse(BaseModel):
    borrower_id: UUID
    status: Literal["active"]
    approved_connection_id: UUID | None = None


class BorrowerDetailResponse(BaseModel):
    id: UUID
    invited_by: UUID
    name: str
    jurisdiction: str
    contact_email: str
    status: str
    created_at: str


class BorrowerListResponse(BaseModel):
    borrowers: list[BorrowerDetailResponse]
