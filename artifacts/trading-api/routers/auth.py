from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from services import auth_service

router = APIRouter()


class LoginRequest(BaseModel):
    password: str
    totp_code: str = ""
    device_key: str = ""


def _is_localhost(request: Request) -> bool:
    host = request.client.host if request.client else ""
    return host in ("127.0.0.1", "::1", "localhost")


@router.post("/auth/login")
async def login(body: LoginRequest, request: Request):
    if not auth_service.is_configured():
        raise HTTPException(status_code=503, detail="Auth not configured")

    locked, seconds_remaining = auth_service.is_locked_out()
    if locked:
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Try again in {max(1, seconds_remaining // 60)} minute(s).",
        )

    if _is_localhost(request):
        # Laptop — passphrase only
        if not auth_service.verify_passphrase(body.password):
            auth_service.record_failed_attempt()
            raise HTTPException(status_code=401, detail="Invalid passphrase")
    else:
        # Phone/remote — full security
        if not auth_service.verify_device_key(body.device_key):
            auth_service.record_failed_attempt()
            raise HTTPException(status_code=403, detail="Device not recognized")
        if not auth_service.verify_password(body.password):
            auth_service.record_failed_attempt()
            raise HTTPException(status_code=401, detail="Invalid password")
        if not auth_service.verify_totp(body.totp_code):
            auth_service.record_failed_attempt()
            raise HTTPException(status_code=401, detail="Invalid or expired 2FA code")

    auth_service.record_successful_login()
    token = auth_service.issue_session_token()
    return {"token": token}