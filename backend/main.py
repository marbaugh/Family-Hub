from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
import os

from database import init_db, get_db
from routers import calendar, chores, members, auth, settings, photos, lunch, weather, homeassistant, stocks, security, messages

async def _auto_sync_loop():
    await asyncio.sleep(30)  # let the app fully start first
    while True:
        try:
            conn = get_db()
            row = conn.execute("SELECT value FROM settings WHERE key='google_sync_interval'").fetchone()
            conn.close()
            interval = int(row["value"]) if row and row["value"] else 0
            if interval > 0:
                await calendar.run_full_sync()
                await asyncio.sleep(interval * 60)
            else:
                await asyncio.sleep(60)  # check again in 1 min
        except asyncio.CancelledError:
            break
        except Exception:
            await asyncio.sleep(300)  # back off 5 min on error

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    task = asyncio.create_task(_auto_sync_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

app = FastAPI(title="Family Hub", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(calendar.router, prefix="/api/calendar", tags=["calendar"])
app.include_router(chores.router, prefix="/api/chores", tags=["chores"])
app.include_router(members.router, prefix="/api/members", tags=["members"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])
app.include_router(photos.router, prefix="/api/photos", tags=["photos"])
app.include_router(lunch.router, prefix="/api/lunch", tags=["lunch"])
app.include_router(weather.router, prefix="/api/weather", tags=["weather"])
app.include_router(homeassistant.router, prefix="/api/homeassistant", tags=["homeassistant"])
app.include_router(stocks.router, prefix="/api/stocks", tags=["stocks"])
app.include_router(security.router, prefix="/api/security", tags=["security"])
app.include_router(messages.router, prefix="/api/messages", tags=["messages"])

# Serve frontend static files
app.mount("/", StaticFiles(directory="/app/frontend", html=True), name="frontend")
