import os
import sys

# Ensure services/ and routers/ are on the path when running from project root
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv()  # must run before services.auth_service reads env vars at import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
import asyncio
import json
from ws_manager import active_connections, broadcast

from routers.data import router as data_router
from routers.structure import router as structure_router
from routers.mt5 import router as mt5_router
from routers.trading import router as trading_router
from routers.news import router as news_router
from routers.narrative import router as narrative_router
from routers.daily_pnl import router as daily_pnl_router
from routers.auth import router as auth_router
from services import auth_service

app = FastAPI(
    title="Trading Market Structure API",
    description="Rule-based market structure analysis — ZigZag, BOS, CHOCH, S/R Zones",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PREFIX = "/trading-api"

# Paths that are never gated behind login or encryption (login itself, health
# checks, and the websocket handshake which uses its own upgrade protocol).
_EXEMPT_PATHS = {f"{PREFIX}/auth/login", f"{PREFIX}/auth/revoke-all", f"{PREFIX}/health", f"{PREFIX}/ws"}


class AuthMiddleware(BaseHTTPMiddleware):
    """Requires a valid Bearer session token on every /trading-api/* request,
    once auth has been configured via generate_secrets.py. Runs BEFORE
    EncryptionMiddleware so unauthorized requests never reach it."""

    async def dispatch(self, request, call_next):
        path = request.url.path
        if not path.startswith(PREFIX) or path in _EXEMPT_PATHS or not auth_service.is_configured():
            return await call_next(request)
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if not auth_service.verify_session_token(token):
            return Response(json.dumps({"detail": "Unauthorized"}), status_code=401, media_type="application/json")
        return await call_next(request)


class EncryptionMiddleware(BaseHTTPMiddleware):
    """AES-256-GCM encrypts every request/response body under /trading-api/*
    (once configured) using a key derived from STRUCT_ENC_PASSPHRASE that
    never travels over the network. A relay/tunnel provider terminating TLS
    only ever sees the {"iv": ..., "data": ...} ciphertext envelope."""

    async def dispatch(self, request, call_next):
        path = request.url.path
        if not path.startswith(PREFIX) or path in _EXEMPT_PATHS or not auth_service.is_configured():
            return await call_next(request)

        raw = await request.body()
        if raw:
            try:
                envelope = json.loads(raw)
                plaintext = auth_service.decrypt_payload(envelope)
                request._body = plaintext
            except Exception:
                return Response(json.dumps({"detail": "Malformed encrypted payload"}), status_code=400, media_type="application/json")

        response = await call_next(request)
        body_chunks = [chunk async for chunk in response.body_iterator]
        body = b"".join(body_chunks)
        encrypted = auth_service.encrypt_bytes(body)
        headers = dict(response.headers)
        headers.pop("content-length", None)
        return Response(content=json.dumps(encrypted), status_code=response.status_code, headers=headers, media_type="application/json")


# Order matters: last added = outermost. Auth must reject BEFORE decryption
# is attempted, so add Encryption first, then Auth.
app.add_middleware(EncryptionMiddleware)
app.add_middleware(AuthMiddleware)

app.include_router(auth_router, prefix=PREFIX)
app.include_router(data_router, prefix=PREFIX)
app.include_router(structure_router, prefix=PREFIX)
app.include_router(trading_router, prefix=PREFIX)
app.include_router(mt5_router, prefix=PREFIX)
app.include_router(news_router, prefix=PREFIX)
app.include_router(narrative_router, prefix=PREFIX)
app.include_router(daily_pnl_router, prefix=PREFIX)


@app.get(f"{PREFIX}/health")
async def health():
    return {"status": "ok", "service": "trading-market-structure-api"}


@app.websocket(f"{PREFIX}/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            # Keep the connection alive; actual pushes happen via broadcast()
            await asyncio.sleep(1)
    except Exception:
        pass
    finally:
        if websocket in active_connections:
            active_connections.remove(websocket)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("TRADING_API_PORT", 8001))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)