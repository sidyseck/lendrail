"""connections table (F-021)

One row per supplier-agent pair.

The uniqueness constraint is implemented as a PARTIAL UNIQUE INDEX scoped to
non-terminated connections. This allows terminated pairs to re-invite, creating
a new connection row.

custodian_link_id is nullable until the supplier registers the API key (F-024).
Once a valid key is registered, custodian_link_id is set and status → active.

Status machine: pending → accepted → active → suspended / terminated
                                             ↑ (re-key allowed from suspended)

Revision ID: 0008
Revises: 0007
"""
from typing import Sequence, Union
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, ENUM as PgEnum
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

connection_status_enum = sa.Enum(
    "pending", "accepted", "active", "suspended", "terminated",
    name="connection_status_enum",
    create_type=True,
)


def upgrade() -> None:
    connection_status_enum.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "connections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "supplier_id", UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", name="fk_connections_supplier_id_organizations",
                          ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "agent_id", UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", name="fk_connections_agent_id_organizations",
                          ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "status",
            PgEnum("pending", "accepted", "active", "suspended", "terminated",
                   name="connection_status_enum", create_type=False),
            nullable=False,
            server_default="pending",
        ),
        # custodian_link_id: NULL until supplier registers API key (F-024).
        sa.Column(
            "custodian_link_id", UUID(as_uuid=True),
            sa.ForeignKey("custodian_links.id",
                          name="fk_connections_custodian_link_id_custodian_links",
                          ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_connections"),
        # NOTE: no UniqueConstraint here — uniqueness is enforced via partial index below.
    )
    op.create_index("ix_connections_supplier_id", "connections", ["supplier_id"])
    op.create_index("ix_connections_agent_id", "connections", ["agent_id"])
    # Partial unique index: only one non-terminated connection per supplier-agent pair.
    # Terminated pairs CAN re-invite (a new row is created).
    op.create_index(
        "uq_connections_supplier_agent_active",
        "connections",
        ["supplier_id", "agent_id"],
        unique=True,
        postgresql_where=sa.text("status != 'terminated'"),
    )


def downgrade() -> None:
    op.drop_index("uq_connections_supplier_agent_active", table_name="connections")
    op.drop_index("ix_connections_agent_id", table_name="connections")
    op.drop_index("ix_connections_supplier_id", table_name="connections")
    op.drop_table("connections")
    connection_status_enum.drop(op.get_bind(), checkfirst=True)
