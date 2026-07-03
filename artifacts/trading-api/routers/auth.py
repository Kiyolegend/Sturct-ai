from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services import auth_service

router = APIRouter()


class LoginRequest(BaseModel):
    password: str
    totp_code: str


@router.post("/auth/login")
async def login(body: LoginRequest):
    if not auth_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail="Auth not configured on server — run generate_secrets.py in artifacts/trading-api first",
        )
    if not auth_service.verify_password(body.password):
        raise HTTPException(status_code=401, detail="Invalid password")
    if not auth_service.verify_totp(body.totp_code):
        raise HTTPException(status_code=401, detail="Invalid or expired 2FA code")
    token = auth_service.issue_session_token()
    return {"token": token}