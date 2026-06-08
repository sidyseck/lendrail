"""custodian_links table (F-020)

One row per org-custodian relationship. Stores an opaque SecretStore ref (never the
plaintext API key). See SecretStore interface — the ciphertext lives in the store,
only the ref UUID is persisted here.

Revision ID: 0007
Revises: 0006
"""
from typing import Sequence, Union
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB, ENUM as PgEnum
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

custodian_link_status_enum = sa.Enum(
    "active", "suspended", "revoked",
    name="custodian_link_status_enum",
    create_type=True,
)


def upgrade() -> None:
    custodian_link_status_enum.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "custodian_links",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "org_id", UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", name="fk_custodian_links_org_id_organizations",
                          ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("custodian_id", sa.Text(), nullable=False),
        sa.Column("account_ref", sa.Text(), nullable=False),
        # encrypted_api_key_ref: opaque UUID ref into SecretStore.
        # The plaintext key is NEVER stored in this column or any DB column.
        sa.Column("encrypted_api_key_ref", sa.Text(), nullable=False),
        # scope: e.g. {"assets": ["BTC"], "permissions": ["read", "instruct"]}
        sa.Column("scope", JSONB(), nullable=False, server_default="{}"),
        sa.Column(
            "status",
            PgEnum("active", "suspended", "revoked",
                   name="custodian_link_status_enum", create_type=False),
            nullable=False,
            server_default="active",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_custodian_links"),
    )
    op.create_index("ix_custodian_links_org_id", "custodian_links", ["org_id"])


def downgrade() -> None:
    op.drop_index("ix_custodian_links_org_id", table_name="custodian_links")
    op.drop_table("custodian_links")
    custodian_link_status_enum.drop(op.get_bind(), checkfirst=True)
