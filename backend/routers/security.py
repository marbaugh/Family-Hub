from fastapi import APIRouter
import httpx
import json
import sys, os; sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from database import get_db

router = APIRouter()

GO2RTC_URL = os.environ.get("GO2RTC_URL", "http://go2rtc:1984")


async def sync_cameras_to_go2rtc(cameras: list):
    """Push camera RTSP streams to go2rtc via its API."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            for cam in cameras:
                rtsp = (cam.get("rtsp_url") or "").strip()
                name = (cam.get("name") or "").strip().replace(" ", "_")
                if rtsp and name:
                    await client.put(
                        f"{GO2RTC_URL}/api/streams",
                        params={"name": name},
                        content=rtsp,
                        headers={"Content-Type": "text/plain"},
                    )
    except Exception as e:
        print(f"go2rtc sync error: {e}")


@router.get("/cameras")
async def get_cameras():
    conn = get_db()
    row = conn.execute("SELECT value FROM settings WHERE key='cameras'").fetchone()
    conn.close()
    cameras = json.loads(row["value"]) if row and row["value"] else []
    if cameras:
        await sync_cameras_to_go2rtc(cameras)
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
    if cameras:
        await sync_cameras_to_go2rtc(cameras)
    return {"ok": True}
