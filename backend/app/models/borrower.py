import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Borrower(Base):
    __tablename__ = "borrowers"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    invited_by: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("organizations.id", name="fk_borrowers_invited_by_organizations", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(Text(), nullable=False)
    jurisdiction: Mapped[str] = mapped_column(Text(), nullable=False)
    contact_email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        sa.Enum("invited", "active", name="borrower_status_enum", create_type=False),
        nullable=False,
        server_default="invited",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # No ORM relationship to Organization for invited_by — load explicitly via join if needed.
    # Keeping this as a bare FK column avoids accidental eager-loads in async context.
