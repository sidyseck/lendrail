from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class BorrowerInviteRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    jurisdiction: str = Field(..., min_length=1, max_length=255)
    contact_email: EmailStr


class BorrowerInviteResponse(BaseModel):
    borrower_id: UUID


class BorrowerDetailResponse(BaseModel):
    id: UUID
    invited_by: UUID
    name: str
    jurisdiction: str
    contact_email: str
    status: str
    created_at: str
