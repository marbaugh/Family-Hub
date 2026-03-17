from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os

from database import init_db
from routers import calendar, chores, members, auth, settings, photos, lunch, weather, homeassistant, stocks, security

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

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

# Serve frontend static files
app.mount("/", StaticFiles(directory="/app/frontend", html=True), name="frontend")
