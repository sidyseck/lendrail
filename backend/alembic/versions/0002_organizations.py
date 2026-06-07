"""organizations table — includes ops_contact_email and regulatory_status_attested
(Decision 3: these are org-level fields, not user-level fields).

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-07 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, ENUM as PgEnum
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Enum objects used for explicit create/drop (create_type=True for DDL operations)
org_role_enum = sa.Enum(
    "supplier", "agent", "admin",
    name="org_role_enum",
    create_type=True,
)
entity_type_enum = sa.Enum(
    "fund", "corporate_treasury", "foundation", "agent",
    name="entity_type_enum",
    create_type=True,
)
org_status_enum = sa.Enum(
    "pending_review", "approved", "rejected",
    name="org_status_enum",
    create_type=True,
)


def upgrade() -> None:
    # op.get_bind() is safe here: runs inside run_sync in the async Alembic env.py.
    # Note: deprecated in Alembic 1.14+; requires update for Alembic 2.x.
    org_role_enum.create(op.get_bind(), checkfirst=True)
    entity_type_enum.create(op.get_bind(), checkfirst=True)
    org_status_enum.create(op.get_bind(), checkfirst=True)
    # Use PgEnum with create_type=False for columns so SQLAlchemy doesn't fire
    # before_create events to re-create the types we just explicitly created above.
    op.create_table(
        "organizations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("jurisdiction", sa.Text(), nullable=False),
        sa.Column(
            "entity_type",
            PgEnum("fund", "corporate_treasury", "foundation", "agent",
                   name="entity_type_enum", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "role",
            PgEnum("supplier", "agent", "admin",
                   name="org_role_enum", create_type=False),
            nullable=False,
        ),
        sa.Column("contact_email", sa.String(320), nullable=False),
        sa.Column("ops_contact_email", sa.String(320), nullable=True),
        sa.Column(
            "regulatory_status_attested",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "status",
            PgEnum("pending_review", "approved", "rejected",
                   name="org_status_enum", create_type=False),
            nullable=False,
            server_default="pending_review",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_organizations"),
        sa.UniqueConstraint("contact_email", name="uq_organizations_contact_email"),
    )
    op.create_index("ix_organizations_contact_email", "organizations", ["contact_email"])
    op.create_index("ix_organizations_role", "organizations", ["role"])


def downgrade() -> None:
    op.drop_index("ix_organizations_role", table_name="organizations")
    op.drop_index("ix_organizations_contact_email", table_name="organizations")
    op.drop_table("organizations")
    # Drop in exact reverse creation order:
    org_status_enum.drop(op.get_bind(), checkfirst=True)
    entity_type_enum.drop(op.get_bind(), checkfirst=True)
    org_role_enum.drop(op.get_bind(), checkfirst=True)
