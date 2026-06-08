"""connections.inventory_scope - F-061

Adds an inventory_scope JSONB column to connections.
Stores the supplier's per-asset published quantity cap for each connection.
Example: {"BTC": "100.0", "ETH": "50.0"}

An empty map ({}) means no inventory is published and loan booking is blocked
for all asset types on this connection.

Revision ID: 0012
Revises: 0011
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "connections",
        sa.Column(
            "inventory_scope",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("connections", "inventory_scope")
