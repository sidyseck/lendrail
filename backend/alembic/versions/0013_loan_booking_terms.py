"""loan booking executed terms - PRD-D-002

Revision ID: 0013
Revises: 0012
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "lending_agreements",
        sa.Column(
            "liquidation_ltv_pct",
            sa.Numeric(10, 4),
            nullable=False,
            server_default="90.0000",
        ),
    )
    op.alter_column("lending_agreements", "liquidation_ltv_pct", server_default=None)

    op.add_column(
        "loans",
        sa.Column(
            "asset_price_usd",
            sa.Numeric(28, 8),
            nullable=False,
            server_default="65000.00000000",
        ),
    )
    op.add_column(
        "loans",
        sa.Column(
            "booking_ltv_pct",
            sa.Numeric(10, 4),
            nullable=False,
            server_default="70.0000",
        ),
    )
    op.add_column(
        "loans",
        sa.Column(
            "margin_call_ltv_pct",
            sa.Numeric(10, 4),
            nullable=False,
            server_default="80.0000",
        ),
    )
    op.add_column(
        "loans",
        sa.Column(
            "liquidation_ltv_pct",
            sa.Numeric(10, 4),
            nullable=False,
            server_default="90.0000",
        ),
    )
    op.alter_column("loans", "asset_price_usd", server_default=None)
    op.alter_column("loans", "booking_ltv_pct", server_default=None)
    op.alter_column("loans", "margin_call_ltv_pct", server_default=None)
    op.alter_column("loans", "liquidation_ltv_pct", server_default=None)


def downgrade() -> None:
    op.drop_column("loans", "liquidation_ltv_pct")
    op.drop_column("loans", "margin_call_ltv_pct")
    op.drop_column("loans", "booking_ltv_pct")
    op.drop_column("loans", "asset_price_usd")
    op.drop_column("lending_agreements", "liquidation_ltv_pct")
