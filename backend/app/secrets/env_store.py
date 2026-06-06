"""In-process AES-256-GCM secret store.

IMPORTANT LIMITATIONS (M0 only):
- Ciphertext is kept in a module-level dict — it is per-process and not persisted.
- The `api` and `worker` run as separate containers; refs stored by one are not visible to the
  other, and uvicorn --reload spawns a fresh process, losing all stored refs.
- M0 has zero consumers of stored secrets, so this is safe FOR M0 ONLY.

HARD M2 GATE (precondition of F-024):
Before implementing F-024 (custodian API key registration), the secret store MUST be
replaced with a Postgres-backed implementation (e.g. an `encrypted_secrets` table with
ciphertext column, or the ciphertext stored alongside custodian_links.encrypted_api_key_ref).
F-024 stores a key in one request (api process) and the worker later retrieves it — the
in-memory store would silently lose it. This is a blocking dependency for M2.
"""
import uuid

from app.core.config import get_settings
from app.core.crypto import decrypt, encrypt
from app.core.errors import SecretNotFoundError


class EnvSecretStore:
    """In-process AES-256-GCM store. See module docstring for M0 limitations."""

    def __init__(self) -> None:
        # Key is SECRET_STORE_KEY or JWT_SECRET as local fallback.
        # WARNING: if key derives from JWT_SECRET, rotating JWT_SECRET invalidates all ciphertext.
        # See spec §11 for the rotation caveat.
        self._secret = get_settings().secret_store_key or get_settings().jwt_secret
        self._data: dict[str, str] = {}

    def store(self, value: str) -> str:
        """Encrypt value and return an opaque UUID ref. Plaintext is never logged."""
        ref = str(uuid.uuid4())
        self._data[ref] = encrypt(value, self._secret)
        return ref

    def retrieve(self, ref: str) -> str:
        """Decrypt and return stored value. Raises SecretNotFoundError on bad ref."""
        token = self._data.get(ref)
        if token is None:
            raise SecretNotFoundError(f"secret ref {ref} not found")
        return decrypt(token, self._secret)

    def delete(self, ref: str) -> None:
        """Remove stored value. No-op if ref not found."""
        self._data.pop(ref, None)
