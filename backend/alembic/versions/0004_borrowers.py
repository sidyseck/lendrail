"""borrowers table

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-07 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, ENUM as PgEnum
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

borrower_status_enum = sa.Enum(
    "invited", "active",
    name="borrower_status_enum",
    create_type=True,
)


def upgrade() -> None:
    borrower_status_enum.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "borrowers",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("invited_by", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("jurisdiction", sa.Text(), nullable=False),
        sa.Column("contact_email", sa.String(320), nullable=False),
        sa.Column(
            "status",
            PgEnum("invited", "active",
                   name="borrower_status_enum", create_type=False),
            nullable=False,
            server_default="invited",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_borrowers"),
        sa.ForeignKeyConstraint(
            ["invited_by"],
            ["organizations.id"],
            name="fk_borrowers_invited_by_organizations",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("contact_email", name="uq_borrowers_contact_email"),
    )
    op.create_index("ix_borrowers_contact_email", "borrowers", ["contact_email"])
    op.create_index("ix_borrowers_invited_by", "borrowers", ["invited_by"])


def downgrade() -> None:
    op.drop_index("ix_borrowers_invited_by", table_name="borrowers")
    op.drop_index("ix_borrowers_contact_email", table_name="borrowers")
    op.drop_table("borrowers")
    borrower_status_enum.drop(op.get_bind(), checkfirst=True)
