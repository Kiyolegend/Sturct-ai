import os
import sys

# Ensure services/ and routers/ are on the path when running from project root
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import json

from routers.data import router as data_router
from routers.structure import router as structure_router
from routers.mt5 import router as mt5_router

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

app.include_router(data_router, prefix=PREFIX)
app.include_router(structure_router, prefix=PREFIX)
app.include_router(mt5_router, prefix=PREFIX)


@app.get(f"{PREFIX}/health")
async def health():
    return {"status": "ok", "service": "trading-market-structure-api"}


# ── WebSocket — live price streaming ──────────────────────────────────────────
active_connections: list[WebSocket] = []


@app.websocket(f"{PREFIX}/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            # Keep the connection alive; actual pushes happen via broadcast()
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        active_connections.remove(websocket)


async def broadcast(message: dict):
    """Push a message to all connected WebSocket clients."""
    dead = []
    for ws in active_connections:
        try:
            await ws.send_text(json.dumps(message))
        except Exception:
            dead.append(ws)
    for ws in dead:
        active_connections.remove(ws)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("TRADING_API_PORT", 8001))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
