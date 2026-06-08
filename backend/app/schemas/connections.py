from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, model_validator


# ── Request models ────────────────────────────────────────────────────────────

class InviteConnectionRequest(BaseModel):
    # Exactly one of agent_org_id or agent_email must be provided.
    # The model_validator below enforces mutual exclusion at the Pydantic layer.
    # The global RequestValidationError handler wraps model_validator ValueError
    # into {"error": {"code": "validation_error", "message": "..."}} — same envelope
    # as all other 422 responses.
    agent_org_id: UUID | None = None
    agent_email: EmailStr | None = None

    @model_validator(mode="after")
    def check_exactly_one_agent_identifier(self) -> "InviteConnectionRequest":
        has_org_id = self.agent_org_id is not None
        has_email = self.agent_email is not None
        if not has_org_id and not has_email:
            raise ValueError(
                "Provide either agent_org_id or agent_email"
            )
        if has_org_id and has_email:
            raise ValueError(
                "Provide only one of agent_org_id or agent_email"
            )
        return self


# ── Response models ───────────────────────────────────────────────────────────

class ConnectionResponse(BaseModel):
    connection_id: UUID
    supplier_id: UUID
    agent_id: UUID
    status: str
    created_at: str                  # ISO-8601
    activated_at: str | None         # ISO-8601 or null
    pending_agreement: bool = False  # True if latest agreement is pending confirmation (M3)


class ConnectionListResponse(BaseModel):
    connections: list[ConnectionResponse]


class InviteUnknownAgentResponse(BaseModel):
    """Returned HTTP 202 when agent email is not registered."""
    message: str = "Invitation logged; agent email is not yet registered on the platform"
    agent_email: str


class TerminateResponse(BaseModel):
    connection_id: UUID
    status: Literal["terminated"]
    flagged_loan_ids: list[str]      # UUIDs serialized as strings for JSON transport
    message: str = (
        "Connection terminated. "
        "You must rotate the custodian API key at the custodian to revoke agent access."
    )
