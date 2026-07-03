"""
Run this ONCE on your laptop to set up secure remote access:

    cd artifacts/trading-api
    python generate_secrets.py

It creates a .env file with your login password, 2FA secret, and encryption
passphrase, plus a QR code image (totp_qr.png) to scan into an authenticator
app (Google Authenticator, Authy, etc.) on your phone.
"""
import bcrypt
import pyotp
import secrets
import qrcode
import getpass

print("=" * 50)
print("  STRUCT.ai — Secure Remote Access Setup")
print("=" * 50)

password = getpass.getpass("Choose a login password: ").strip()
passphrase = getpass.getpass(
    "Choose an encryption passphrase (different from password,\n"
    "  you will also enter this on your phone): "
).strip()

pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
totp_secret = pyotp.random_base32()
jwt_secret = secrets.token_hex(32)

with open(".env", "w") as f:
    f.write(f"STRUCT_PASSWORD_HASH={pw_hash}\n")
    f.write(f"STRUCT_TOTP_SECRET={totp_secret}\n")
    f.write(f"STRUCT_JWT_SECRET={jwt_secret}\n")
    f.write(f"STRUCT_ENC_PASSPHRASE={passphrase}\n")

uri = pyotp.TOTP(totp_secret).provisioning_uri(name="you", issuer_name="STRUCT.ai")
qrcode.make(uri).save("totp_qr.png")

print("\nDone. Created .env in this folder.")
print("Open totp_qr.png and scan it with Google Authenticator or Authy on your phone.")
print(f"\nYour encryption passphrase (write this down, you'll type it on your phone too):\n  {passphrase}")
print("\nRestart the API (start-windows.bat) for the new settings to take effect.")