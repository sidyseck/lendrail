import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Connection(Base):
    __tablename__ = "connections"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("organizations.id",
                   name="fk_connections_supplier_id_organizations",
                   ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    agent_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("organizations.id",
                   name="fk_connections_agent_id_organizations",
                   ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        sa.Enum("pending", "accepted", "active", "suspended", "terminated",
                name="connection_status_enum", create_type=False),
        nullable=False,
        server_default="pending",
    )
    # Null until supplier registers API key (F-024).
    custodian_link_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("custodian_links.id",
                   name="fk_connections_custodian_link_id_custodian_links",
                   ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    activated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Uniqueness is enforced by the partial index uq_connections_supplier_agent_active
    # (WHERE status != 'terminated') defined in migration 0008.
    # No __table_args__ UniqueConstraint — the partial index is DDL-only.
