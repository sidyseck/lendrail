# app/schemas/orgs.py
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

# ── Shared ENUM literals ──────────────────────────────────────────────────────

# "agent" is intentionally excluded from the public EntityType.
# The DB entity_type_enum retains "agent" for future internal/admin use.
# See §11 Resolution log — Decision 8.
EntityType = Literal["fund", "corporate_treasury", "foundation"]
OrgRole = Literal["supplier", "agent"]    # admin cannot self-register

# ── Request models ────────────────────────────────────────────────────────────


class SupplierRegisterRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    jurisdiction: str = Field(..., min_length=1, max_length=255)
    entity_type: EntityType
    contact_email: EmailStr
    password: str = Field(..., min_length=12, max_length=128)


class AgentRegisterRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    jurisdiction: str = Field(..., min_length=1, max_length=255)
    entity_type: EntityType
    contact_email: EmailStr
    password: str = Field(..., min_length=12, max_length=128)
    ops_contact_email: EmailStr
    regulatory_status_attested: bool
    # NOTE: No model_validator for regulatory_status_attested.
    # The attestation check (and the ops_contact_email != contact_email check)
    # is performed in OrgService.register_agent, which raises ValidationError
    # with the correct code. This ensures the {"error": {...}} envelope is used
    # for all 422s (the global RequestValidationError handler covers Pydantic 422s).

# ── Response models ───────────────────────────────────────────────────────────


class OrgRegisterResponse(BaseModel):
    org_id: UUID
    access_token: str
    token_type: Literal["bearer"] = "bearer"


class OrgMeResponse(BaseModel):
    id: UUID
    name: str
    jurisdiction: str
    entity_type: str
    role: str
    contact_email: str
    status: str
    created_at: str   # ISO-8601; keep as str to avoid TZ serialization ambiguity in JSON
