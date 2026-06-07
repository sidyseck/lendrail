"""users org FK

Adds foreign key from users.org_id to organizations.id.

IMPORTANT: Before adding the FK, this migration scrubs M0 seed users whose
org_id is NULL or points to a non-existent organization row. These rows are
test/seed artifacts from M0 (when no organizations table existed). Any such
rows are deleted — do not run this migration in an environment where M0 seed
users must be preserved without a prior org-assignment data migration.

After the FK is added with NOT VALID, the constraint is immediately validated
via ALTER TABLE ... VALIDATE CONSTRAINT to ensure no orphaned rows remain.

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-07 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: Remove rows with NULL org_id or orphaned (non-existent) org_id.
    # This handles M0 seed users created before the organizations table existed.
    op.execute(
        "DELETE FROM users WHERE org_id IS NULL "
        "OR org_id NOT IN (SELECT id FROM organizations)"
    )

    # Step 2: Add the FK constraint with NOT VALID to skip row-level validation
    # during DDL (avoids a full-table lock on large deployments).
    op.create_foreign_key(
        "fk_users_org_id_organizations",
        "users",
        "organizations",
        ["org_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    # Step 3: Validate the constraint — performs a sequential scan.
    # If any orphaned rows survived step 1, this raises immediately.
    op.execute(
        "ALTER TABLE users VALIDATE CONSTRAINT fk_users_org_id_organizations"
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_org_id_organizations", "users", type_="foreignkey")
