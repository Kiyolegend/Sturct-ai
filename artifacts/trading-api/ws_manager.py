import asyncio   
import json
from fastapi import WebSocket

active_connections: list[WebSocket] = []

async def broadcast(message: dict):
    """Push a message to all connected WebSocket clients."""
    try:
        dead = []
        for ws in list(active_connections):
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                dead.append(ws)
        for ws in dead:
            if ws in active_connections:
                active_connections.remove(ws)
    except asyncio.CancelledError:
        pass