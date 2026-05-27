import asyncio
import json
from fastapi import WebSocket

active_connections: list[WebSocket] = []

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