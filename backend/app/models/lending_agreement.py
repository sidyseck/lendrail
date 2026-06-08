import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, func
from sqlalchemy.dialects.postgresql import ARRAY, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LendingAgreement(Base):
    __tablename__ = "lending_agreements"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    connection_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(
            "connections.id",
            name="fk_lending_agreements_connection_id_connections",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    assets_in_scope: Mapped[list] = mapped_column(ARRAY(sa.Text), nullable=False)
    eligible_collateral: Mapped[list] = mapped_column(ARRAY(sa.Text), nullable=False)
    initial_ltv_pct: Mapped[float] = mapped_column(Numeric(10, 4), nullable=False)
    margin_call_ltv_pct: Mapped[float] = mapped_column(Numeric(10, 4), nullable=False)
    recall_notice_days: Mapped[int] = mapped_column(Integer, nullable=False)
    max_loan_days: Mapped[int] = mapped_column(Integer, nullable=False)
    day_count_basis: Mapped[str] = mapped_column(
        sa.Enum(
            "actual_360",
            "actual_365",
            name="day_count_basis_enum",
            create_type=False,
        ),
        nullable=False,
    )
    agent_fee_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    confirmed_by_supplier_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    confirmed_by_agent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    @property
    def is_active(self) -> bool:
        """Both parties have confirmed — used as derived status field in responses."""
        return (
            self.confirmed_by_supplier_at is not None
            and self.confirmed_by_agent_at is not None
        )
