from fastapi import APIRouter
import httpx
from datetime import datetime
import pytz
import sys, os; sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from database import get_db

router = APIRouter()

_cache = {}

def get_lunch_config():
    """Read lunch settings from DB, falling back to BCPS defaults."""
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT key, value FROM settings WHERE key IN ('lunch_district','lunch_school_slug','lunch_menu_type')"
        ).fetchall()
        conn.close()
        s = {r["key"]: r["value"] for r in rows}
    except Exception:
        s = {}
    district = s.get("lunch_district") or "bcps"
    slug = s.get("lunch_school_slug") or "bcps-weekly-menus"
    menu_type = s.get("lunch_menu_type") or "weekly-menus"
    return district, slug, menu_type

def get_app_tz() -> str:
    try:
        conn = get_db()
        row = conn.execute("SELECT value FROM settings WHERE key = 'timezone'").fetchone()
        conn.close()
        if row and row["value"]:
            return row["value"]
    except Exception:
        pass
    return "America/New_York"

def get_today_local():
    tz = pytz.timezone(get_app_tz())
    now = datetime.now(tz)
    return now.strftime("%Y/%m/%d"), now.strftime("%Y-%m-%d")

async def fetch_items_for_date(date_key: str):
    district, slug, menu_type = get_lunch_config()
    cache_key = f"{district}:{slug}:{date_key}"
    if cache_key in _cache:
        return _cache[cache_key]
    date_path = date_key.replace("-", "/")
    url = f"https://{district}.api.nutrislice.com/menu/api/weeks/school/{slug}/menu-type/{menu_type}/{date_path}/"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers={"Accept": "application/json"})
            if resp.status_code != 200:
                return None
            data = resp.json()
    except Exception as e:
        print(f"Nutrislice fetch error: {e}")
        return None

    today_day = None
    for day in data.get("days", []):
        if day.get("date", "")[:10] == date_key:
            today_day = day
            break

    if not today_day:
        return None

    skip_names = {
        "100% fruit juice", "assorted fresh fruits", "fresh fruits",
        "1% white milk", "white milk", "chocolate milk", "skim milk",
        "fat free chocolate milk"
    }

    breakfast, lunch = [], []
    # The BCPS weekly menu image asset IDs tell us the section:
    # 277390 = BREAKFAST banner → next items are breakfast
    # 397211 / 397212 / 397213 = LUNCH banners → next items are lunch
    # We start as "unknown" and assign based on the first banner we see
    current_section = None

    for mi in today_day.get("menu_items", []):
        image = mi.get("image") or ""

        # Banner image items have no food — use them to detect section switches
        if mi.get("food") is None:
            if image:
                # Extract asset ID from URL like .../image/png/277390
                parts = image.rstrip("/").split("/")
                asset_id = parts[-1] if parts[-1].isdigit() else (parts[-2] if len(parts) > 1 else "")
                # 277390 = breakfast header banner
                if asset_id == "277390":
                    current_section = "breakfast"
                # 277391 = lunch header banner
                elif asset_id == "277391":
                    current_section = "lunch"
                # 397211/397212/397213 are sub-section headers within breakfast
                # (Elementary/Secondary/All Schools) — do NOT change section
            continue

        food = mi.get("food")
        if not food:
            continue

        # Only show featured (starred) items
        if not mi.get("featured", False):
            continue

        name = (food.get("name") or "").strip()
        if not name or name.lower() in skip_names:
            continue

        item = {"name": name, "is_entree": True}

        if current_section == "breakfast":
            breakfast.append(item)
        elif current_section == "lunch":
            lunch.append(item)
        # If section still unknown, skip — shouldn't happen with valid data

    result = {"date": date_key, "breakfast": breakfast, "lunch": lunch}
    _cache[cache_key] = result
    return result

async def fetch_todays_items():
    _, date_key = get_today_local()
    return await fetch_items_for_date(date_key)

@router.get("/today")
async def get_todays_menu(date: str = None):
    district, slug, menu_type = get_lunch_config()
    if not district:
        return {"not_configured": True, "breakfast": [], "lunch": []}
    if not date:
        _, date = get_today_local()
    result = await fetch_items_for_date(date)
    if result is None:
        return {"date": date, "breakfast": [], "lunch": [], "error": "Could not fetch menu"}
    # Include config so frontend can build the full-menu link
    result["district"] = district
    result["school_slug"] = slug
    result["menu_type"] = menu_type
    return result

@router.get("/debug")
async def debug_menu():
    """Returns raw menu items with image URLs so we can verify section detection."""
    district, slug, menu_type = get_lunch_config()
    date_path, date_key = get_today_local()
    url = f"https://{district}.api.nutrislice.com/menu/api/weeks/school/{slug}/menu-type/{menu_type}/{date_path}/"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, headers={"Accept": "application/json"})
        if resp.status_code != 200:
            return {"error": resp.status_code}
        data = resp.json()

    today_day = next((d for d in data.get("days", []) if d.get("date","")[:10] == date_key), None)
    if not today_day:
        return {"error": "no day", "date": date_key}

    # Return simplified view: just position, image asset ID, food name, featured flag
    simplified = []
    for mi in today_day.get("menu_items", []):
        image = mi.get("image") or ""
        parts = image.rstrip("/").split("/")
        asset_id = parts[-1] if parts and parts[-1].isdigit() else None
        food = mi.get("food")
        simplified.append({
            "pos": mi.get("position"),
            "asset_id": asset_id,
            "food_name": food.get("name") if food else None,
            "featured": mi.get("featured"),
            "category": (food.get("food_category") if food else None),
        })
    return {"date": date_key, "items": simplified}
