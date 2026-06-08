import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CustodianLink(Base):
    __tablename__ = "custodian_links"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("organizations.id",
                   name="fk_custodian_links_org_id_organizations",
                   ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    custodian_id: Mapped[str] = mapped_column(Text(), nullable=False)
    account_ref: Mapped[str] = mapped_column(Text(), nullable=False)
    # Opaque UUID ref from SecretStore.store() — NEVER the plaintext key.
    encrypted_api_key_ref: Mapped[str] = mapped_column(Text(), nullable=False)
    # e.g. {"assets": ["BTC"], "permissions": ["read", "instruct"]}
    scope: Mapped[dict] = mapped_column(JSONB(), nullable=False, default=dict)
    status: Mapped[str] = mapped_column(
        sa.Enum("active", "suspended", "revoked",
                name="custodian_link_status_enum", create_type=False),
        nullable=False,
        server_default="active",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # No relationship to Connection — connection.custodian_link_id is a bare FK column.
    # Load via join when needed.
