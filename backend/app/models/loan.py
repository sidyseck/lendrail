import uuid
from datetime import date, datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ApprovedBorrower(Base):
    __tablename__ = "connection_approved_borrowers"

    connection_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(
            "connections.id",
            name="fk_approved_borrowers_connection_id_connections",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )
    borrower_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(
            "borrowers.id",
            name="fk_approved_borrowers_borrower_id_borrowers",
            ondelete="RESTRICT",
        ),
        primary_key=True,
    )
    approved_by: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(
            "organizations.id",
            name="fk_approved_borrowers_approved_by_organizations",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    approved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Loan(Base):
    __tablename__ = "loans"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    connection_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("connections.id", name="fk_loans_connection_id_connections", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    agreement_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("lending_agreements.id", name="fk_loans_agreement_id_lending_agreements", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    borrower_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("borrowers.id", name="fk_loans_borrower_id_borrowers", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    asset_type: Mapped[str] = mapped_column(Text(), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(28, 12), nullable=False)
    rate_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    term_type: Mapped[str] = mapped_column(
        sa.Enum("open", "fixed", name="loan_term_type_enum", create_type=False),
        nullable=False,
    )
    maturity_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    day_count_basis: Mapped[str] = mapped_column(
        sa.Enum("actual_360", "actual_365", name="day_count_basis_enum", create_type=False),
        nullable=False,
    )
    collateral_type: Mapped[str] = mapped_column(Text(), nullable=False)
    collateral_quantity: Mapped[Decimal] = mapped_column(Numeric(28, 12), nullable=False)
    collateral_value_usd: Mapped[Decimal] = mapped_column(Numeric(28, 8), nullable=False)
    current_ltv_pct: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    ltv_as_of: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    state: Mapped[str] = mapped_column(
        sa.Enum(
            "pending",
            "active",
            "margin_call",
            "recall_initiated",
            "settled",
            "defaulted",
            name="loan_state_enum",
            create_type=False,
        ),
        nullable=False,
        server_default="pending",
        index=True,
    )
    booked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recall_initiated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recall_notice_deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    return_custodian_ref: Mapped[str | None] = mapped_column(Text(), nullable=True)
    return_instruction_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    defaulted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LoanStateTransition(Base):
    __tablename__ = "loan_state_transitions"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    loan_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("loans.id", name="fk_loan_transitions_loan_id_loans", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    from_state: Mapped[str | None] = mapped_column(
        sa.Enum(
            "pending",
            "active",
            "margin_call",
            "recall_initiated",
            "settled",
            "defaulted",
            name="loan_state_enum",
            create_type=False,
        ),
        nullable=True,
    )
    to_state: Mapped[str] = mapped_column(
        sa.Enum(
            "pending",
            "active",
            "margin_call",
            "recall_initiated",
            "settled",
            "defaulted",
            name="loan_state_enum",
            create_type=False,
        ),
        nullable=False,
    )
    actor_org_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(
            "organizations.id",
            name="fk_loan_transitions_actor_org_id_organizations",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(
            "users.id",
            name="fk_loan_transitions_actor_user_id_users",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )
    reason: Mapped[str] = mapped_column(Text(), nullable=False)
    transition_metadata: Mapped[dict] = mapped_column("metadata", JSONB(), nullable=False, default=dict)
    transitioned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
