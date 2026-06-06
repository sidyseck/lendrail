"""AES-256-GCM encryption primitives for the secret store.

Key = 32 bytes derived from SECRET_STORE_KEY (or JWT_SECRET as local fallback)
using SHA-256. In production, SECRET_STORE_KEY must be a dedicated, high-entropy
random value — never a human-chosen password.

NOTE: If SECRET_STORE_KEY is unset and the key derives from JWT_SECRET, rotating
JWT_SECRET also invalidates every stored ciphertext. Rotation runbooks must decouple
the two by setting an explicit SECRET_STORE_KEY. The real prod path is a managed vault.
"""
import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _derive_key(secret: str) -> bytes:
    """SHA-256 of the secret string → 32 bytes (AES-256 key).

    Acceptable for high-entropy machine secrets. For human-chosen passwords,
    use a proper PBKDF (HKDF/scrypt/Argon2) instead.
    """
    return hashlib.sha256(secret.encode()).digest()


def encrypt(plaintext: str, secret: str) -> str:
    """Encrypt plaintext with AES-256-GCM. Returns base64(nonce || ciphertext+tag)."""
    key = _derive_key(secret)
    nonce = os.urandom(12)  # 96-bit nonce for GCM
    ct = AESGCM(key).encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ct).decode()


def decrypt(token_b64: str, secret: str) -> str:
    """Decrypt a token produced by encrypt(). Raises on tampered data."""
    raw = base64.b64decode(token_b64)
    nonce, ct = raw[:12], raw[12:]
    return AESGCM(_derive_key(secret)).decrypt(nonce, ct, None).decode()
