"""
Run this ONCE to create your device key (an extra secret that only your
phone and PC will know). After this, only devices that have this key typed
into their browser will be allowed to even attempt logging in.

    cd artifacts/trading-api
    python generate_device_key.py

It appends STRUCT_DEVICE_KEY to your existing .env file (the same file
generate_secrets.py created). Run generate_secrets.py FIRST if you haven't
already — this script expects .env to already exist.
"""
import os
import secrets

ENV_PATH = ".env"

if not os.path.exists(ENV_PATH):
    print("ERROR: .env not found in this folder.")
    print("Run generate_secrets.py first, then run this script.")
    raise SystemExit(1)

with open(ENV_PATH, "r") as f:
    existing = f.read()

if "STRUCT_DEVICE_KEY=" in existing:
    print("A device key already exists in .env — nothing changed.")
    print("If you want a brand new one (this will log out all devices except")
    print("ones you re-enter the new key into), remove the STRUCT_DEVICE_KEY")
    print("line from .env by hand, then run this script again.")
    raise SystemExit(0)

device_key = secrets.token_urlsafe(32)

with open(ENV_PATH, "a") as f:
    f.write(f"STRUCT_DEVICE_KEY={device_key}\n")

print("=" * 50)
print("  STRUCT.ai — Device Key Created")
print("=" * 50)
print("\nYour device key (write this down — you'll type it into the login")
print("screen ONCE on your phone and ONCE on your PC; after that each device")
print("remembers it automatically):\n")
print(f"  {device_key}\n")
print("Restart the API (start-windows.bat) for this to take effect.")
print("\nIMPORTANT: never share this key with anyone. Anyone who has it can")
print("attempt to log in from their own device.")