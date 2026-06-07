# Import all models here so Alembic's metadata is fully populated when env.py imports this module.
from app.models.notification import Notification  # noqa: F401
from app.models.organization import Organization  # noqa: F401
from app.models.borrower import Borrower  # noqa: F401
from app.models.user import User  # noqa: F401

__all__ = ["Notification", "Organization", "Borrower", "User"]
