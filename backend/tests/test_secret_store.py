"""F-009: Secret store tests."""
import logging
import uuid

import pytest

from app.core.errors import SecretNotFoundError
from app.secrets.env_store import EnvSecretStore


@pytest.fixture
def store() -> EnvSecretStore:
    return EnvSecretStore()


def test_store_returns_uuid_ref(store: EnvSecretStore) -> None:
    ref = store.store("my-api-key")
    # Must be a valid UUID string
    parsed = uuid.UUID(ref)
    assert str(parsed) == ref


def test_retrieve_round_trips_plaintext(store: EnvSecretStore) -> None:
    plaintext = "super-secret-custodian-key"
    ref = store.store(plaintext)
    retrieved = store.retrieve(ref)
    assert retrieved == plaintext


def test_plaintext_not_in_logs(store: EnvSecretStore, caplog: pytest.LogCaptureFixture) -> None:
    """The plaintext value must never appear in any log output."""
    secret = "should-never-appear-in-logs"
    with caplog.at_level(logging.DEBUG):
        ref = store.store(secret)
        store.retrieve(ref)

    for record in caplog.records:
        assert secret not in record.getMessage()
        assert secret not in str(record.__dict__)


def test_bad_ref_raises_secret_not_found(store: EnvSecretStore) -> None:
    with pytest.raises(SecretNotFoundError):
        store.retrieve(str(uuid.uuid4()))


def test_delete_removes_ref(store: EnvSecretStore) -> None:
    ref = store.store("to-be-deleted")
    store.delete(ref)
    with pytest.raises(SecretNotFoundError):
        store.retrieve(ref)


def test_delete_nonexistent_ref_is_noop(store: EnvSecretStore) -> None:
    """Deleting a non-existent ref must not raise."""
    store.delete(str(uuid.uuid4()))  # must not raise


def test_key_derived_from_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    """When SECRET_STORE_KEY is unset, the store derives the key from JWT_SECRET."""
    from app.core.config import get_settings
    monkeypatch.setenv("JWT_SECRET", "specific-test-jwt-secret")
    monkeypatch.delenv("SECRET_STORE_KEY", raising=False)
    get_settings.cache_clear()

    s = EnvSecretStore()
    ref = s.store("test-value")
    assert s.retrieve(ref) == "test-value"

    get_settings.cache_clear()


def test_multiple_stores_are_independent() -> None:
    """Two EnvSecretStore instances have separate in-memory dicts."""
    s1, s2 = EnvSecretStore(), EnvSecretStore()
    ref = s1.store("in-store-1")
    with pytest.raises(SecretNotFoundError):
        s2.retrieve(ref)
