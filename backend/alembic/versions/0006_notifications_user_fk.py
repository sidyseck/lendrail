"""notifications.user_id FK to users

Adds the FK from notifications.user_id → users.id (NOT VALID + VALIDATE pattern).
Scrubs any notification rows whose user_id has no matching users row first.

Revision ID: 0006
Revises: 0005
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: Remove orphaned notification rows (M0/M1 test seed artifact).
    op.execute(
        sa.text(
            "DELETE FROM notifications "
            "WHERE user_id IS NULL "
            "OR user_id NOT IN (SELECT id FROM users)"
        )
    )
    # Step 2: Add FK with NOT VALID to avoid table lock on large tables.
    op.create_foreign_key(
        "fk_notifications_user_id_users",
        "notifications", "users",
        ["user_id"], ["id"],
        ondelete="CASCADE",
    )
    # Step 3: Validate — sequential scan confirms all remaining rows satisfy FK.
    op.execute(
        sa.text("ALTER TABLE notifications VALIDATE CONSTRAINT fk_notifications_user_id_users")
    )


def downgrade() -> None:
    op.drop_constraint("fk_notifications_user_id_users", "notifications", type_="foreignkey")
