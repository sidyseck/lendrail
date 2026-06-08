# Import all models here so Alembic's metadata is fully populated when env.py imports this module.
from app.models.notification import Notification  # noqa: F401
from app.models.organization import Organization  # noqa: F401
from app.models.borrower import Borrower  # noqa: F401
from app.models.user import User  # noqa: F401
from app.models.custodian_link import CustodianLink  # noqa: F401 — NEW
from app.models.connection import Connection  # noqa: F401 — NEW
from app.models.lending_agreement import LendingAgreement  # noqa: F401 — M3
from app.models.loan import ApprovedBorrower, Loan, LoanStateTransition  # noqa: F401 — M4

__all__ = [
    "Notification",
    "Organization",
    "Borrower",
    "User",
    "CustodianLink",
    "Connection",
    "LendingAgreement",
    "ApprovedBorrower",
    "Loan",
    "LoanStateTransition",
]
