"""Custodian management service — supplier org-level custodian links."""
import logging
import uuid
from dataclasses import dataclass

from app.adapters.interfaces import CustodianAdapter
from app.core.errors import Forbidden, ValidationError
from app.repositories.custodian_link_repository import CustodianLinkRepository
from app.schemas.auth import AuthUser
from app.secrets.interface import SecretStore

log = logging.getLogger("lendrail.services.custodian")


@dataclass
class RegisterCustodianInput:
    custodian_id: str
    account_ref: str
    plaintext_key: str


@dataclass
class CustodianResult:
    custodian_link_id: uuid.UUID
    org_id: uuid.UUID
    custodian_id: str
    account_ref: str
    status: str
    created_at: str


def _to_result(link) -> CustodianResult:
    return CustodianResult(
        custodian_link_id=link.id,
        org_id=link.org_id,
        custodian_id=link.custodian_id,
        account_ref=link.account_ref,
        status=link.status,
        created_at=link.created_at.isoformat(),
    )


class CustodianService:
    def __init__(
        self,
        custodian_links: CustodianLinkRepository,
        secret_store: SecretStore,
        custodian_adapter: CustodianAdapter,
    ) -> None:
        self.custodian_links = custodian_links
        self.secret_store = secret_store
        self.custodian_adapter = custodian_adapter

    async def register(
        self, caller: AuthUser, data: RegisterCustodianInput
    ) -> CustodianResult:
        if caller.role != "supplier":
            raise Forbidden("Only suppliers can register custodians")
        if caller.org_id is None:
            raise Forbidden("Caller has no associated organization")

        ref = self.secret_store.store(data.plaintext_key)
        log.info(
            "custodian_key_stored org_id=%s ref=%s custodian_id=%s",
            caller.org_id, ref, data.custodian_id,
        )

        try:
            is_valid = await self.custodian_adapter.validate_key()
        except Exception as exc:
            self.secret_store.delete(ref)
            log.error(
                "custodian_key_validation_error org_id=%s custodian_id=%s error=%s",
                caller.org_id, data.custodian_id, str(exc),
            )
            raise ValidationError(
                "Custodian adapter raised an error during key validation",
                code="custodian_key_invalid",
            ) from exc

        if not is_valid:
            self.secret_store.delete(ref)
            raise ValidationError(
                "The provided API key was rejected by the custodian",
                code="custodian_key_invalid",
            )

        link = await self.custodian_links.create(
            id=uuid.uuid4(),
            org_id=caller.org_id,
            custodian_id=data.custodian_id,
            account_ref=data.account_ref,
            encrypted_api_key_ref=ref,
            scope={},
            status="active",
        )
        log.info(
            "custodian_link_created link_id=%s org_id=%s custodian_id=%s",
            link.id, caller.org_id, data.custodian_id,
        )
        return _to_result(link)

    async def list_for_org(self, caller: AuthUser) -> list[CustodianResult]:
        if caller.role != "supplier":
            raise Forbidden("Only suppliers can list custodians")
        if caller.org_id is None:
            raise Forbidden("Caller has no associated organization")
        links = await self.custodian_links.list_by_org(caller.org_id)
        return [_to_result(link) for link in links]
