from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
import httpx
import json
import sys, os; sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from database import get_db

router = APIRouter()


def get_ha_config():
    conn = get_db()
    rows = conn.execute(
        "SELECT key, value FROM settings WHERE key IN ('ha_url','ha_token')"
    ).fetchall()
    conn.close()
    s = {r["key"]: r["value"] for r in rows}
    return s.get("ha_url", "").rstrip("/"), s.get("ha_token", "")


@router.get("/camera/{entity_id}/stream")
async def proxy_camera_stream(entity_id: str):
    """Proxy HA MJPEG camera stream so the browser never needs the HA token."""
    ha_url, ha_token = get_ha_config()
    if not ha_url or not ha_token:
        raise HTTPException(status_code=503, detail="Home Assistant not configured")

    stream_url = f"{ha_url}/api/camera_proxy_stream/{entity_id}"

    async def generate():
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "GET",
                stream_url,
                headers={"Authorization": f"Bearer {ha_token}"},
            ) as resp:
                async for chunk in resp.aiter_bytes(4096):
                    yield chunk

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=--frameboundary",
    )


@router.get("/camera/{entity_id}/snapshot")
async def proxy_camera_snapshot(entity_id: str):
    """Return a single JPEG snapshot from HA."""
    ha_url, ha_token = get_ha_config()
    if not ha_url or not ha_token:
        raise HTTPException(status_code=503, detail="Home Assistant not configured")
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            f"{ha_url}/api/camera_proxy/{entity_id}",
            headers={"Authorization": f"Bearer {ha_token}"},
        )
    return StreamingResponse(
        iter([resp.content]),
        media_type=resp.headers.get("content-type", "image/jpeg"),
    )


@router.get("/cameras")
async def get_cameras():
    conn = get_db()
    row = conn.execute("SELECT value FROM settings WHERE key='cameras'").fetchone()
    conn.close()
    cameras = json.loads(row["value"]) if row and row["value"] else []
    return {"cameras": cameras}


@router.post("/cameras")
async def save_cameras(data: dict):
    cameras = data.get("cameras", [])
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('cameras', ?)",
        (json.dumps(cameras),),
    )
    conn.commit()
    conn.close()
    return {"ok": True}
