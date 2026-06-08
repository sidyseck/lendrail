"""users.org_id NOT NULL — M2 gate from M1

All users created by M1 registration always have org_id set.
Before altering the column, this migration verifies no NULL rows exist.
If any are found, it raises an error with instructions to clean up.

Revision ID: 0005
Revises: 0004
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    # Verify no orphaned or NULL org_id rows remain (guard from M1 spec §10 item 1).
    result = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM users "
            "WHERE org_id IS NULL "
            "OR org_id NOT IN (SELECT id FROM organizations)"
        )
    )
    bad_count = result.scalar()
    if bad_count > 0:
        raise RuntimeError(
            f"Migration 0005 aborted: {bad_count} user row(s) have NULL or orphaned org_id. "
            "Reassign or delete these rows before re-running this migration."
        )
    op.alter_column("users", "org_id", nullable=False)


def downgrade() -> None:
    op.alter_column("users", "org_id", nullable=True)
