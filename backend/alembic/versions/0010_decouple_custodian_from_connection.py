"""Decouple custodian management from connections.

- Drop custodian_link_id FK from connections (custodian links now managed at
  org level via /custodians endpoints).
- Remove 'accepted' from connection_status_enum (accept now transitions
  directly pending → active, activated_at set at accept time).
- Any existing 'accepted' rows are promoted to 'active'.

Revision ID: 0010
Revises: 0009
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Promote any lingering 'accepted' connections to 'active'.
    op.execute(
        "UPDATE connections SET status = 'active', activated_at = NOW() "
        "WHERE status = 'accepted'"
    )

    # 2. Build a new enum without 'accepted'.
    op.execute(
        "CREATE TYPE connection_status_enum_new "
        "AS ENUM ('pending', 'active', 'suspended', 'terminated')"
    )
    # The partial index references the enum type — drop it before altering.
    op.execute("DROP INDEX IF EXISTS uq_connections_supplier_agent_active")
    # Drop the server_default before altering the type (Postgres cannot cast it).
    op.execute("ALTER TABLE connections ALTER COLUMN status DROP DEFAULT")
    op.execute(
        "ALTER TABLE connections "
        "ALTER COLUMN status TYPE connection_status_enum_new "
        "USING status::text::connection_status_enum_new"
    )
    # Restore default using the new type name.
    op.execute(
        "ALTER TABLE connections ALTER COLUMN status "
        "SET DEFAULT 'pending'::connection_status_enum_new"
    )
    op.execute("DROP TYPE connection_status_enum")
    op.execute(
        "ALTER TYPE connection_status_enum_new RENAME TO connection_status_enum"
    )
    # Recreate the partial unique index with the new enum.
    op.execute(
        "CREATE UNIQUE INDEX uq_connections_supplier_agent_active "
        "ON connections (supplier_id, agent_id) "
        "WHERE status != 'terminated'"
    )

    # 3. Drop the custodian_link_id FK + column.
    op.drop_constraint(
        "fk_connections_custodian_link_id_custodian_links",
        "connections",
        type_="foreignkey",
    )
    op.drop_column("connections", "custodian_link_id")


def downgrade() -> None:
    # Restore custodian_link_id (nullable — no data migration; re-key manually).
    op.add_column(
        "connections",
        sa.Column(
            "custodian_link_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_connections_custodian_link_id_custodian_links",
        "connections",
        "custodian_links",
        ["custodian_link_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Restore 'accepted' in the enum.
    op.execute(
        "CREATE TYPE connection_status_enum_old "
        "AS ENUM ('pending', 'accepted', 'active', 'suspended', 'terminated')"
    )
    op.execute(
        "ALTER TABLE connections "
        "ALTER COLUMN status TYPE connection_status_enum_old "
        "USING status::text::connection_status_enum_old"
    )
    op.execute("DROP TYPE connection_status_enum")
    op.execute(
        "ALTER TYPE connection_status_enum_old RENAME TO connection_status_enum"
    )
