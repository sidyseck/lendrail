"""OrgService — domain service for org registration and lookup. No FastAPI imports."""
import uuid
import logging
from dataclasses import dataclass

from app.core.errors import ConflictError, Forbidden, NotFoundError, ValidationError
from app.core.security import hash_password, create_access_token
from app.models.organization import Organization
from app.repositories.org_repository import OrgRepository
from app.repositories.user_repository import UserRepository
from app.schemas.auth import AuthUser

log = logging.getLogger("lendrail.services.org")

# ── Input DTOs (plain dataclasses — no FastAPI types) ─────────────────────────


@dataclass
class SupplierRegistrationInput:
    name: str
    jurisdiction: str
    entity_type: str          # validated against Pydantic Literal before reaching service
    contact_email: str
    password: str             # plaintext — hashed inside service, never stored raw


@dataclass
class AgentRegistrationInput:
    name: str
    jurisdiction: str
    entity_type: str
    contact_email: str
    password: str
    ops_contact_email: str
    regulatory_status_attested: bool

# ── Output DTOs ────────────────────────────────────────────────────────────────


@dataclass
class RegistrationResult:
    org_id: uuid.UUID
    access_token: str


@dataclass
class OrgProfile:
    id: uuid.UUID
    name: str
    jurisdiction: str
    entity_type: str
    role: str
    contact_email: str
    status: str
    created_at: str           # ISO-8601 string; serialization handled by Pydantic schema layer

# ── Service ───────────────────────────────────────────────────────────────────


class OrgService:
    def __init__(self, orgs: OrgRepository, users: UserRepository) -> None:
        self.orgs = orgs
        self.users = users

    async def register_supplier(self, data: SupplierRegistrationInput) -> RegistrationResult:
        """Create an Organization with role=supplier and its first User. Returns JWT."""
        await self._assert_email_unique(data.contact_email)

        org = await self.orgs.create(
            id=uuid.uuid4(),
            name=data.name,
            jurisdiction=data.jurisdiction,
            entity_type=data.entity_type,
            role="supplier",
            contact_email=data.contact_email,
            status="approved",   # auto-approved in MVP; F-058 provides manual override
        )
        log.info("org_created org_id=%s role=supplier", org.id)

        user = await self.users.create_user(
            org_id=org.id,
            email=data.contact_email,
            hashed_password=hash_password(data.password),
            role="supplier",
        )
        log.info("user_created user_id=%s org_id=%s", user.id, org.id)
        # data.password is NEVER passed to log — only IDs are logged.

        token = create_access_token(
            user_id=str(user.id),
            org_id=str(org.id),
            role="supplier",
        )
        return RegistrationResult(org_id=org.id, access_token=token)

    async def register_agent(self, data: AgentRegistrationInput) -> RegistrationResult:
        """Create an Organization with role=agent and its first User."""
        # BLOCKER #3 fix: attestation check is here in the service (not model_validator).
        # Raises ValidationError → existing handler → {"error": {"code": "attestation_required", ...}}
        if not data.regulatory_status_attested:
            raise ValidationError(
                "regulatory_status_attested must be true to register as an agent",
                code="attestation_required",
            )

        # BLOCKER #4 fix: ops_contact_email must differ from primary contact_email.
        if data.ops_contact_email == data.contact_email:
            raise ValidationError(
                "Ops contact email must differ from primary contact email",
                code="invalid_ops_email",
            )

        await self._assert_email_unique(data.contact_email)

        org = await self.orgs.create(
            id=uuid.uuid4(),
            name=data.name,
            jurisdiction=data.jurisdiction,
            entity_type=data.entity_type,
            role="agent",
            contact_email=data.contact_email,
            ops_contact_email=data.ops_contact_email,
            regulatory_status_attested=True,
            status="approved",
        )
        log.info("org_created org_id=%s role=agent", org.id)

        user = await self.users.create_user(
            org_id=org.id,
            email=data.contact_email,
            hashed_password=hash_password(data.password),
            role="agent",
        )
        log.info("user_created user_id=%s org_id=%s", user.id, org.id)

        token = create_access_token(
            user_id=str(user.id),
            org_id=str(org.id),
            role="agent",
        )
        return RegistrationResult(org_id=org.id, access_token=token)

    async def get_my_org(self, caller: AuthUser) -> OrgProfile:
        """Return the authenticated user's organization record."""
        if caller.org_id is None:
            raise Forbidden("User is not associated with any organization")
        org = await self.orgs.get(caller.org_id)   # BaseRepository.get — raises NotFoundError if missing
        return OrgProfile(
            id=org.id,
            name=org.name,
            jurisdiction=org.jurisdiction,
            entity_type=org.entity_type,
            role=org.role,
            contact_email=org.contact_email,
            status=org.status,
            created_at=org.created_at.isoformat(),
        )

    # ── Private helpers ────────────────────────────────────────────────────────

    async def _assert_email_unique(self, email: str) -> None:
        existing = await self.orgs.get_by_contact_email(email)
        if existing is not None:
            raise ConflictError(
                f"An organization with email '{email}' already exists",
                code="duplicate_email",
            )
        # Also check users table — an email may exist as a user without an org (M0 seed edge case)
        existing_user = await self.users.get_by_email(email)
        if existing_user is not None:
            raise ConflictError(
                f"A user with email '{email}' already exists",
                code="duplicate_email",
            )
