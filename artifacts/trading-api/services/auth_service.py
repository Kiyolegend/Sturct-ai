"""
Authentication + end-to-end payload encryption for STRUCT.ai remote access.

Two independent layers:
  1. Login — password + TOTP (6-digit rotating code, like Google Authenticator)
     → short-lived signed session token.
  2. Payload encryption — every request/response body (except /auth/login and
     /health) is AES-256-GCM encrypted using a key derived from a shared
     passphrase that is NEVER transmitted over the network. Any relay/tunnel
     provider (e.g. Cloudflare) only ever sees ciphertext at their edge, even
     though they terminate TLS there.

Configure via environment variables (see generate_secrets.py to create these):
  STRUCT_PASSWORD_HASH   — bcrypt hash of your login password
  STRUCT_TOTP_SECRET     — base32 TOTP secret (scan into an authenticator app)
  STRUCT_JWT_SECRET      — random string used to sign session tokens
  STRUCT_ENC_PASSPHRASE  — shared passphrase used to derive the AES key
                            (entered identically on the phone/browser side)
"""

import os
import time

import bcrypt
import pyotp
import jwt as pyjwt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

PASSWORD_HASH = os.environ.get("STRUCT_PASSWORD_HASH", "")
TOTP_SECRET = os.environ.get("STRUCT_TOTP_SECRET", "")
JWT_SECRET = os.environ.get("STRUCT_JWT_SECRET", "")
ENC_PASSPHRASE = os.environ.get("STRUCT_ENC_PASSPHRASE", "")

SESSION_TTL_SECONDS = 24 * 60 * 60  # 24h

KDF_SALT = b"struct.ai-e2e-v1-salt"
KDF_ITERATIONS = 100_000

_EPOCH_FILE = os.path.join(os.path.dirname(__file__), "..", ".session_epoch")


def _read_epoch() -> int:
    try:
        with open(_EPOCH_FILE, "r") as f:
            return int(f.read().strip() or "0")
    except (FileNotFoundError, ValueError):
        return 0


def revoke_all_sessions() -> int:
    new_epoch = _read_epoch() + 1
    with open(_EPOCH_FILE, "w") as f:
        f.write(str(new_epoch))
    return new_epoch


def is_configured() -> bool:
    return bool(PASSWORD_HASH and TOTP_SECRET and JWT_SECRET and ENC_PASSPHRASE)


def verify_password(password: str) -> bool:
    if not PASSWORD_HASH:
        return False
    return bcrypt.checkpw(password.encode(), PASSWORD_HASH.encode())


def verify_totp(code: str) -> bool:
    if not TOTP_SECRET:
        return False
    return pyotp.TOTP(TOTP_SECRET).verify(code, valid_window=1)


def issue_session_token() -> str:
    payload = {
        "iat": int(time.time()),
        "exp": int(time.time()) + SESSION_TTL_SECONDS,
        "epoch": _read_epoch(),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm="HS256")


def verify_session_token(token: str) -> bool:
    try:
        decoded = pyjwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return decoded.get("epoch") == _read_epoch()
    except Exception:
        return False


_AES_KEY: bytes | None = None


def _key() -> bytes:
    global _AES_KEY
    if _AES_KEY is None:
        kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=KDF_SALT, iterations=KDF_ITERATIONS)
        _AES_KEY = kdf.derive(ENC_PASSPHRASE.encode())
    return _AES_KEY


def encrypt_bytes(plaintext: bytes) -> dict:
    aesgcm = AESGCM(_key())
    iv = os.urandom(12)
    ct = aesgcm.encrypt(iv, plaintext, None)
    import base64
    return {"iv": base64.b64encode(iv).decode(), "data": base64.b64encode(ct).decode()}


def decrypt_payload(payload: dict) -> bytes:
    import base64
    aesgcm = AESGCM(_key())
    iv = base64.b64decode(payload["iv"])
    ct = base64.b64decode(payload["data"])
    return aesgcm.decrypt(iv, ct, None)