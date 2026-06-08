"""Loan lifecycle tables (M4 F-033/F-034).

Revision ID: 0011
Revises: 0010
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM as PgEnum, JSONB, UUID

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

loan_term_type_enum = sa.Enum("open", "fixed", name="loan_term_type_enum")
loan_state_enum = sa.Enum(
    "pending",
    "active",
    "margin_call",
    "recall_initiated",
    "settled",
    "defaulted",
    name="loan_state_enum",
)


def upgrade() -> None:
    loan_term_type_enum.create(op.get_bind(), checkfirst=True)
    loan_state_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "connection_approved_borrowers",
        sa.Column("connection_id", UUID(as_uuid=True), nullable=False),
        sa.Column("borrower_id", UUID(as_uuid=True), nullable=False),
        sa.Column("approved_by", UUID(as_uuid=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["connection_id"],
            ["connections.id"],
            name="fk_approved_borrowers_connection_id_connections",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["borrower_id"],
            ["borrowers.id"],
            name="fk_approved_borrowers_borrower_id_borrowers",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["approved_by"],
            ["organizations.id"],
            name="fk_approved_borrowers_approved_by_organizations",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("connection_id", "borrower_id", name="pk_connection_approved_borrowers"),
    )
    op.create_index(
        "ix_approved_borrowers_borrower_id",
        "connection_approved_borrowers",
        ["borrower_id"],
    )

    op.create_table(
        "loans",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("connection_id", UUID(as_uuid=True), nullable=False),
        sa.Column("agreement_id", UUID(as_uuid=True), nullable=False),
        sa.Column("borrower_id", UUID(as_uuid=True), nullable=False),
        sa.Column("asset_type", sa.Text(), nullable=False),
        sa.Column("quantity", sa.Numeric(28, 12), nullable=False),
        sa.Column("rate_bps", sa.Integer(), nullable=False),
        sa.Column(
            "term_type",
            PgEnum("open", "fixed", name="loan_term_type_enum", create_type=False),
            nullable=False,
        ),
        sa.Column("maturity_date", sa.Date(), nullable=True),
        sa.Column(
            "day_count_basis",
            PgEnum("actual_360", "actual_365", name="day_count_basis_enum", create_type=False),
            nullable=False,
        ),
        sa.Column("collateral_type", sa.Text(), nullable=False),
        sa.Column("collateral_quantity", sa.Numeric(28, 12), nullable=False),
        sa.Column("collateral_value_usd", sa.Numeric(28, 8), nullable=False),
        sa.Column("current_ltv_pct", sa.Numeric(10, 4), nullable=True),
        sa.Column("ltv_as_of", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "state",
            PgEnum(
                "pending",
                "active",
                "margin_call",
                "recall_initiated",
                "settled",
                "defaulted",
                name="loan_state_enum",
                create_type=False,
            ),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("booked_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recall_initiated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recall_notice_deadline_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("return_custodian_ref", sa.Text(), nullable=True),
        sa.Column("return_instruction_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("defaulted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["connection_id"],
            ["connections.id"],
            name="fk_loans_connection_id_connections",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["agreement_id"],
            ["lending_agreements.id"],
            name="fk_loans_agreement_id_lending_agreements",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["borrower_id"],
            ["borrowers.id"],
            name="fk_loans_borrower_id_borrowers",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("quantity > 0", name="ck_loans_quantity_positive"),
        sa.CheckConstraint("rate_bps >= 0", name="ck_loans_rate_bps_non_negative"),
        sa.CheckConstraint("collateral_quantity > 0", name="ck_loans_collateral_quantity_positive"),
        sa.CheckConstraint("collateral_value_usd > 0", name="ck_loans_collateral_value_positive"),
        sa.PrimaryKeyConstraint("id", name="pk_loans"),
    )
    op.create_index("ix_loans_connection_id", "loans", ["connection_id"])
    op.create_index("ix_loans_agreement_id", "loans", ["agreement_id"])
    op.create_index("ix_loans_borrower_id", "loans", ["borrower_id"])
    op.create_index("ix_loans_state", "loans", ["state"])
    op.create_index("ix_loans_connection_state", "loans", ["connection_id", "state"])

    op.create_table(
        "loan_state_transitions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("loan_id", UUID(as_uuid=True), nullable=False),
        sa.Column(
            "from_state",
            PgEnum(
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
        ),
        sa.Column(
            "to_state",
            PgEnum(
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
        ),
        sa.Column("actor_org_id", UUID(as_uuid=True), nullable=True),
        sa.Column("actor_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("metadata", JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("transitioned_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["loan_id"],
            ["loans.id"],
            name="fk_loan_transitions_loan_id_loans",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["actor_org_id"],
            ["organizations.id"],
            name="fk_loan_transitions_actor_org_id_organizations",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name="fk_loan_transitions_actor_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_loan_state_transitions"),
    )
    op.create_index("ix_loan_state_transitions_loan_id", "loan_state_transitions", ["loan_id"])


def downgrade() -> None:
    op.drop_index("ix_loan_state_transitions_loan_id", table_name="loan_state_transitions")
    op.drop_table("loan_state_transitions")
    op.drop_index("ix_loans_connection_state", table_name="loans")
    op.drop_index("ix_loans_state", table_name="loans")
    op.drop_index("ix_loans_borrower_id", table_name="loans")
    op.drop_index("ix_loans_agreement_id", table_name="loans")
    op.drop_index("ix_loans_connection_id", table_name="loans")
    op.drop_table("loans")
    op.drop_index("ix_approved_borrowers_borrower_id", table_name="connection_approved_borrowers")
    op.drop_table("connection_approved_borrowers")
    loan_state_enum.drop(op.get_bind(), checkfirst=True)
    loan_term_type_enum.drop(op.get_bind(), checkfirst=True)
