"""SecretStore Protocol.

Implementations:
- EnvSecretStore (M0): in-process AES-256 dict (single-process only).
- (M2 gate): Postgres-backed encrypted_secrets table, required before F-024.
- (Prod): HashiCorp Vault / AWS Secrets Manager / Supabase Vault.
"""
from typing import Protocol


class SecretStore(Protocol):
    def store(self, value: str) -> str:
        """Encrypt and store value. Returns an opaque UUID ref."""
        ...

    def retrieve(self, ref: str) -> str:
        """Decrypt and return the stored value. Raises SecretNotFoundError on bad ref."""
        ...

    def delete(self, ref: str) -> None:
        """Remove the stored value. No-op if ref not found."""
        ...
