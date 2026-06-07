"""RBAC enforcement helpers.

`require_role(*roles)` is a FastAPI dependency factory. Non-matching role → Forbidden → 403.
Returns AuthUser so handlers can use one Depends for both auth and the user object.

Two-step pattern (architecture §6):
  Step 1 (role check) — lives here, in the API layer.
  Step 2 (ownership check on org_id) — lives in each domain service (M1+).
"""
from fastapi import Depends

from app.api.deps import get_current_user
from app.core.errors import Forbidden
from app.schemas.auth import AuthUser, Role


def require_role(*allowed: Role):  # type: ignore[no-untyped-def]
    async def _guard(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        if user.role not in allowed:
            raise Forbidden(
                f"role '{user.role}' not permitted; requires one of {allowed}"
            )
        return user

    return _guard


# Convenience guards
require_supplier = require_role("supplier")
require_agent = require_role("agent")
require_admin = require_role("admin")
