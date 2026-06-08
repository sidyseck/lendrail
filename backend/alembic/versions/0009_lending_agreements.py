"""lending_agreements table (F-028)

Stores per-connection agreement terms submitted by agents. Each amendment
creates a new row with version = previous + 1; the highest version is the
"current" one. Both confirmation timestamps are nullable — both being non-null
means the agreement is active.

Revision ID: 0009
Revises: 0008
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, ENUM as PgEnum, UUID

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

day_count_basis_enum = sa.Enum(
    "actual_360",
    "actual_365",
    name="day_count_basis_enum",
    create_type=True,
)


def upgrade() -> None:
    day_count_basis_enum.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "lending_agreements",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "connection_id",
            UUID(as_uuid=True),
            sa.ForeignKey(
                "connections.id",
                name="fk_lending_agreements_connection_id_connections",
                ondelete="RESTRICT",
            ),
            nullable=False,
        ),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("assets_in_scope", ARRAY(sa.Text), nullable=False),
        sa.Column("eligible_collateral", ARRAY(sa.Text), nullable=False),
        sa.Column("initial_ltv_pct", sa.Numeric(10, 4), nullable=False),
        sa.Column("margin_call_ltv_pct", sa.Numeric(10, 4), nullable=False),
        sa.Column("recall_notice_days", sa.Integer, nullable=False),
        sa.Column("max_loan_days", sa.Integer, nullable=False),
        sa.Column(
            "day_count_basis",
            PgEnum(
                "actual_360",
                "actual_365",
                name="day_count_basis_enum",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("agent_fee_bps", sa.Integer, nullable=False),
        sa.Column(
            "confirmed_by_supplier_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "confirmed_by_agent_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_lending_agreements"),
    )
    op.create_index(
        "ix_lending_agreements_connection_id",
        "lending_agreements",
        ["connection_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_lending_agreements_connection_id", table_name="lending_agreements"
    )
    op.drop_table("lending_agreements")
    day_count_basis_enum.drop(op.get_bind(), checkfirst=True)
