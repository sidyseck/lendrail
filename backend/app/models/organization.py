import uuid
from datetime import datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy import Boolean, String, Text, DateTime, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(Text(), nullable=False)
    jurisdiction: Mapped[str] = mapped_column(Text(), nullable=False)
    entity_type: Mapped[str] = mapped_column(
        sa.Enum(
            "fund", "corporate_treasury", "foundation", "agent",
            name="entity_type_enum", create_type=False
        ),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(
        sa.Enum(
            "supplier", "agent", "admin",
            name="org_role_enum", create_type=False
        ),
        nullable=False,
    )
    contact_email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    # ops_contact_email: agent orgs only; NULL for supplier orgs.
    # Must differ from contact_email — enforced in OrgService.register_agent, not DB.
    ops_contact_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    # regulatory_status_attested: agent orgs must set True on registration.
    # Enforced in OrgService.register_agent (domain layer), not Pydantic model_validator.
    regulatory_status_attested: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=sa.text("false")
    )
    status: Mapped[str] = mapped_column(
        sa.Enum(
            "pending_review", "approved", "rejected",
            name="org_status_enum", create_type=False
        ),
        nullable=False,
        server_default="pending_review",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationship: one org → many users (back-populated in User model)
    # lazy="noload" prevents accidental N+1 lazy-loads in async context.
    # Load explicitly via selectinload(Organization.users) when needed.
    users: Mapped[list["User"]] = relationship("User", back_populates="org", lazy="noload")
