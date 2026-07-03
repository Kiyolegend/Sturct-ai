"""
Authentication + end-to-end payload encryption for STRUCT.ai remote access.

Three independent layers:
  1. Device key — a shared secret only your own devices know, stored in the
     browser's localStorage after being typed in once. Checked BEFORE
     password/2FA, so a device without it can't even attempt a login.
  2. Login — password + TOTP (6-digit rotating code, like Google Authenticator)
     → short-lived signed session token.
  3. Payload encryption — every request/response body (except /auth/login and
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
  STRUCT_DEVICE_KEY      — optional. If set (see generate_device_key.py),
                            login requests must include this exact value or
                            they are rejected before password/2FA are checked.
"""

import os
import time
import secrets as secrets_module

import bcrypt
import httpx
import pyotp
import jwt as pyjwt
from email.utils import parsedate_to_datetime
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

PASSWORD_HASH = os.environ.get("STRUCT_PASSWORD_HASH", "")
TOTP_SECRET = os.environ.get("STRUCT_TOTP_SECRET", "")
JWT_SECRET = os.environ.get("STRUCT_JWT_SECRET", "")
ENC_PASSPHRASE = os.environ.get("STRUCT_ENC_PASSPHRASE", "")
DEVICE_KEY = os.environ.get("STRUCT_DEVICE_KEY", "")

SESSION_TTL_SECONDS = 24 * 60 * 60  # 24h

KDF_SALT = b"struct.ai-e2e-v1-salt"
KDF_ITERATIONS = 100_000

_EPOCH_FILE = os.path.join(os.path.dirname(__file__), "..", ".session_epoch")

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_SECONDS = 15 * 60  # 15 minutes

_failed_attempts = 0
_locked_until = 0.0


def is_locked_out() -> tuple[bool, int]:
    """Returns (locked, seconds_remaining). If locked is True, seconds_remaining
    tells the caller how long until they can try again."""
    global _failed_attempts, _locked_until
    now = time.time()
    if _locked_until > now:
        return True, int(_locked_until - now)
    if _locked_until != 0 and _locked_until <= now:
        _locked_until = 0.0
        _failed_attempts = 0
    return False, 0


def record_failed_attempt() -> None:
    global _failed_attempts, _locked_until
    _failed_attempts += 1
    if _failed_attempts >= MAX_FAILED_ATTEMPTS:
        _locked_until = time.time() + LOCKOUT_SECONDS
        print(f"WARNING: {MAX_FAILED_ATTEMPTS} failed login attempts in a row — "
              f"login locked for {LOCKOUT_SECONDS // 60} minutes")


def record_successful_login() -> None:
    global _failed_attempts, _locked_until
    _failed_attempts = 0
    _locked_until = 0.0


def is_device_key_required() -> bool:
    """The device key gate is opt-in: if you haven't run generate_device_key.py
    yet, STRUCT_DEVICE_KEY is empty and every device is allowed to attempt
    login (same as before this feature existed)."""
    return bool(DEVICE_KEY)


def verify_device_key(candidate: str) -> bool:
    if not DEVICE_KEY:
        return True
    if not candidate:
        return False
    return secrets_module.compare_digest(candidate, DEVICE_KEY)

def verify_passphrase(candidate: str) -> bool:
    if not ENC_PASSPHRASE:
        return False
    return secrets_module.compare_digest(candidate, ENC_PASSPHRASE)


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


_time_offset_seconds = 0.0
_time_offset_checked_at = 0.0
_TIME_OFFSET_TTL_SECONDS = 300  # re-check every 5 minutes


def _true_time() -> float:
    """Returns the real current time, corrected for a wrong/corrupted local
    (Windows) clock. 2FA codes are generated on the phone using the phone's
    own clock, so if this machine's clock is wrong, every code would be
    rejected even when typed correctly. This fetches the real time from a
    public HTTPS server's response header instead of trusting the local
    clock, and caches the correction for a few minutes so login stays fast.
    Falls back to the local clock if there's no internet access."""
    global _time_offset_seconds, _time_offset_checked_at
    local_now = time.time()
    if local_now - _time_offset_checked_at < _TIME_OFFSET_TTL_SECONDS:
        return local_now + _time_offset_seconds
    try:
        resp = httpx.head("https://www.google.com", timeout=3)
        date_header = resp.headers.get("date")
        if date_header:
            server_time = parsedate_to_datetime(date_header).timestamp()
            _time_offset_seconds = server_time - local_now
            _time_offset_checked_at = local_now
            return local_now + _time_offset_seconds
    except Exception as e:
        print(f"WARNING: time-sync check failed ({e}) — falling back to local clock; "
              f"if login codes keep being rejected, verify this machine's clock is correct")
    return local_now


def verify_totp(code: str) -> bool:
    if not TOTP_SECRET:
        return False
    return pyotp.TOTP(TOTP_SECRET).verify(code, valid_window=1, for_time=int(_true_time()))


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