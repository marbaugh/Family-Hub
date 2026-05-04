import sys, os; sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from database import get_db
import httpx
import json
import os as _os
from datetime import datetime, timezone, timedelta
from urllib.parse import quote

router = APIRouter()

def get_app_tz(conn=None) -> str:
    close = False
    if conn is None:
        conn = get_db(); close = True
    try:
        row = conn.execute("SELECT value FROM settings WHERE key = 'timezone'").fetchone()
        return (row["value"] if row and row["value"] else None) or "America/New_York"
    finally:
        if close:
            conn.close()

GOOGLE_CLIENT_ID = _os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = _os.environ.get("GOOGLE_CLIENT_SECRET", "")
APP_BASE_URL = _os.environ.get("APP_BASE_URL", "http://localhost:3000")

class EventCreate(BaseModel):
    title: str
    description: str = ""
    location: str = ""
    start_datetime: str
    end_datetime: str
    all_day: bool = False
    member_id: Optional[int] = None
    is_family: bool = False
    color: Optional[str] = None
    recurrence: Optional[str] = None
    target_calendar_id: Optional[str] = None

class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start_datetime: Optional[str] = None
    end_datetime: Optional[str] = None
    all_day: Optional[bool] = None
    member_id: Optional[int] = None
    is_family: Optional[bool] = None
    color: Optional[str] = None

@router.get("/events")
def get_events(
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    member_id: Optional[int] = Query(None)
):
    conn = get_db()
    query = """
        SELECT e.*, m.name as member_name, m.color as member_color
        FROM events e
        LEFT JOIN members m ON e.member_id = m.id
        WHERE 1=1
    """
    params = []
    if start:
        query += " AND e.end_datetime >= ?"
        params.append(start)
    if end:
        query += " AND e.start_datetime <= ?"
        params.append(end)
    if member_id:
        query += " AND e.member_id = ?"
        params.append(member_id)
    query += " ORDER BY e.start_datetime"
    events = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(e) for e in events]

def _pad_datetime(dt: str) -> str:
    """Ensure datetime is full RFC3339 (needs seconds for Google API)."""
    if dt and len(dt) == 16:  # YYYY-MM-DDTHH:MM
        dt = dt + ":00"
    return dt

def _build_google_body(event_row: dict, tz: str = "America/New_York") -> dict:
    body = {
        "summary": event_row["title"],
        "description": event_row.get("description") or "",
        "location": event_row.get("location") or "",
    }
    if event_row.get("all_day"):
        body["start"] = {"date": str(event_row["start_datetime"])[:10]}
        body["end"]   = {"date": str(event_row["end_datetime"])[:10]}
    else:
        body["start"] = {"dateTime": _pad_datetime(event_row["start_datetime"]), "timeZone": tz}
        body["end"]   = {"dateTime": _pad_datetime(event_row["end_datetime"]),   "timeZone": tz}
    return body


async def _push_to_google(event_row: dict, conn, target_calendar_id: str = None) -> tuple:
    """Push a local event to Google Calendar. Returns (google_event_id, calendar_id) or (None, None) on failure."""
    is_family = bool(event_row.get("is_family"))
    member_id = event_row.get("member_id")
    body = _build_google_body(event_row, tz=get_app_tz(conn))

    try:
        if target_calendar_id:
            # Push to a specific calendar using the family account
            cal_row = conn.execute("SELECT * FROM family_google_calendar LIMIT 1").fetchone()
            if not cal_row:
                return None, None
            access_token = await refresh_token_if_needed(dict(cal_row), is_family=True)
            calendar_id = target_calendar_id
        elif is_family:
            cal_row = conn.execute("SELECT * FROM family_google_calendar LIMIT 1").fetchone()
            if not cal_row:
                return None, None
            access_token = await refresh_token_if_needed(dict(cal_row), is_family=True)
            write_cal = (conn.execute("SELECT value FROM settings WHERE key='family_write_calendar_id'").fetchone() or {}).get("value") or "primary"
            calendar_id = write_cal
        elif member_id:
            member = conn.execute("SELECT * FROM members WHERE id=?", (member_id,)).fetchone()
            if not member or not member["google_access_token"]:
                return None, None
            access_token = await refresh_token_if_needed(dict(member), is_family=False, member_id=member_id)
            calendar_id = "primary"
        else:
            return None, None

        existing_gid = event_row.get("google_event_id")
        async with httpx.AsyncClient() as client:
            if existing_gid:
                resp = await client.put(
                    f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events/{existing_gid}",
                    headers={"Authorization": f"Bearer {access_token}"}, json=body)
            else:
                resp = await client.post(
                    f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events",
                    headers={"Authorization": f"Bearer {access_token}"}, json=body)
        if resp.status_code in (200, 201):
            return resp.json()["id"], calendar_id
        else:
            print(f"Google Calendar push failed ({calendar_id}): {resp.status_code} {resp.text[:300]}")
    except Exception as e:
        print(f"Google Calendar push error: {e}")
    return None, None


async def _delete_from_google(event_row: dict, conn):
    """Delete an event from Google Calendar if it has a google_event_id."""
    gid = event_row.get("google_event_id")
    if not gid:
        return
    is_family = bool(event_row.get("is_family"))
    member_id = event_row.get("member_id")
    stored_cal_id = event_row.get("google_calendar_id")
    try:
        if stored_cal_id or is_family:
            cal_row = conn.execute("SELECT * FROM family_google_calendar LIMIT 1").fetchone()
            if not cal_row:
                return
            access_token = await refresh_token_if_needed(dict(cal_row), is_family=True)
            if stored_cal_id:
                calendar_id = stored_cal_id
            else:
                try:
                    cal_ids = json.loads(cal_row["calendar_id"] or '["primary"]')
                    calendar_id = cal_ids[0] if isinstance(cal_ids, list) else cal_ids
                except Exception:
                    calendar_id = "primary"
        elif member_id:
            member = conn.execute("SELECT * FROM members WHERE id=?", (member_id,)).fetchone()
            if not member or not member["google_access_token"]:
                return
            access_token = await refresh_token_if_needed(dict(member), is_family=False, member_id=member_id)
            try:
                cal_ids = json.loads(member["google_calendar_ids"] or '["primary"]')
                calendar_id = cal_ids[0] if isinstance(cal_ids, list) else cal_ids
            except Exception:
                calendar_id = "primary"
        else:
            return
        async with httpx.AsyncClient() as client:
            await client.delete(
                f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events/{gid}",
                headers={"Authorization": f"Bearer {access_token}"})
    except Exception as e:
        print(f"Google Calendar delete error: {e}")


@router.post("/events")
async def create_event(event: EventCreate):
    conn = get_db()
    cur = conn.execute("""
        INSERT INTO events (title, description, location, start_datetime, end_datetime, all_day, member_id, is_family, color, recurrence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (event.title, event.description, event.location, event.start_datetime, event.end_datetime,
          1 if event.all_day else 0, event.member_id, 1 if event.is_family else 0,
          event.color, event.recurrence))
    conn.commit()
    new_id = cur.lastrowid
    row = dict(conn.execute("SELECT * FROM events WHERE id=?", (new_id,)).fetchone())

    target_cal = event.target_calendar_id
    if target_cal != "none":
        gid, cal_id = await _push_to_google(row, conn, target_calendar_id=target_cal)
        if gid:
            conn.execute("UPDATE events SET google_event_id=?, google_calendar_id=? WHERE id=?", (gid, cal_id, new_id))
            conn.commit()
            row["google_event_id"] = gid
            row["google_calendar_id"] = cal_id

    conn.close()
    return row

@router.put("/events/{event_id}")
async def update_event(event_id: int, event: EventUpdate):
    conn = get_db()
    existing = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail="Event not found")
    updates = {k: v for k, v in event.dict().items() if v is not None}
    if "all_day" in updates: updates["all_day"] = 1 if updates["all_day"] else 0
    if "is_family" in updates: updates["is_family"] = 1 if updates["is_family"] else 0
    if updates:
        set_clause = ", ".join(f"{k}=?" for k in updates)
        conn.execute(f"UPDATE events SET {set_clause} WHERE id=?", (*updates.values(), event_id))
        conn.commit()
    row = dict(conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone())

    gid, cal_id = await _push_to_google(row, conn)
    if gid and not row.get("google_event_id"):
        conn.execute("UPDATE events SET google_event_id=?, google_calendar_id=? WHERE id=?", (gid, cal_id, event_id))
        conn.commit()
        row["google_event_id"] = gid
        row["google_calendar_id"] = cal_id

    conn.close()
    return row

@router.delete("/events/{event_id}")
async def delete_event(event_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    if row:
        await _delete_from_google(dict(row), conn)
    conn.execute("DELETE FROM events WHERE id=?", (event_id,))
    conn.commit()
    conn.close()
    return {"ok": True}

# ── Token Refresh ─────────────────────────────────────────────────────────────

async def refresh_token_if_needed(token_row: dict, is_family: bool = False, member_id: int = None) -> str:
    expiry = token_row.get("google_token_expiry")
    access_token = token_row.get("google_access_token")
    refresh_token = token_row.get("google_refresh_token")
    needs_refresh = True
    if expiry:
        try:
            exp_dt = datetime.fromisoformat(expiry)
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
            needs_refresh = datetime.now(timezone.utc) >= exp_dt
        except Exception:
            needs_refresh = True
    if needs_refresh and refresh_token:
        async with httpx.AsyncClient() as client:
            resp = await client.post("https://oauth2.googleapis.com/token", data={
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            })
            if resp.status_code == 200:
                data = resp.json()
                new_token = data["access_token"]
                new_expiry = (datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 3600))).isoformat()
                conn = get_db()
                if is_family:
                    conn.execute("UPDATE family_google_calendar SET google_access_token=?, google_token_expiry=?",
                                 (new_token, new_expiry))
                else:
                    conn.execute("UPDATE members SET google_access_token=?, google_token_expiry=? WHERE id=?",
                                 (new_token, new_expiry, member_id))
                conn.commit()
                conn.close()
                return new_token
    return access_token

# ── List Available Calendars ──────────────────────────────────────────────────

@router.get("/google-calendars/family")
async def list_family_google_calendars():
    """List all calendars on the connected family Google account."""
    conn = get_db()
    family_cal = conn.execute("SELECT * FROM family_google_calendar LIMIT 1").fetchone()
    conn.close()
    if not family_cal:
        raise HTTPException(status_code=400, detail="Family Google Calendar not connected")
    access_token = await refresh_token_if_needed(dict(family_cal), is_family=True)
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://www.googleapis.com/calendar/v3/users/me/calendarList",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Google API error: {resp.text}")
        items = resp.json().get("items", [])
    try:
        selected = json.loads(dict(family_cal).get("calendar_id") or '["primary"]')
        if not isinstance(selected, list):
            selected = [selected]
    except Exception:
        selected = ["primary"]
    return {
        "calendars": [{"id": c["id"], "summary": c.get("summary", ""), "primary": c.get("primary", False), "backgroundColor": c.get("backgroundColor", "#4F6EF7")} for c in items],
        "selected": selected
    }

@router.get("/google-calendars/member/{member_id}")
async def list_member_google_calendars(member_id: int):
    """List all calendars on a member's connected Google account."""
    conn = get_db()
    member = conn.execute("SELECT * FROM members WHERE id=?", (member_id,)).fetchone()
    conn.close()
    if not member or not member["google_access_token"]:
        raise HTTPException(status_code=400, detail="Member Google Calendar not connected")
    access_token = await refresh_token_if_needed(dict(member), is_family=False, member_id=member_id)
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://www.googleapis.com/calendar/v3/users/me/calendarList",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Google API error: {resp.text}")
        items = resp.json().get("items", [])
    try:
        selected = json.loads(dict(member).get("google_calendar_ids") or '["primary"]')
        if not isinstance(selected, list):
            selected = [selected]
    except Exception:
        selected = ["primary"]
    return {
        "calendars": [{"id": c["id"], "summary": c.get("summary", ""), "primary": c.get("primary", False), "backgroundColor": c.get("backgroundColor", "#4F6EF7")} for c in items],
        "selected": selected
    }

# ── Save Calendar Selections ──────────────────────────────────────────────────

@router.post("/google-calendars/family/select")
async def select_family_calendars(payload: dict):
    calendar_ids = payload.get("calendar_ids", ["primary"])
    conn = get_db()
    conn.execute("UPDATE family_google_calendar SET calendar_id=?", (json.dumps(calendar_ids),))
    conn.commit()
    conn.close()
    return {"ok": True, "selected": calendar_ids}

@router.post("/google-calendars/member/{member_id}/select")
async def select_member_calendars(member_id: int, payload: dict):
    calendar_ids = payload.get("calendar_ids", ["primary"])
    conn = get_db()
    conn.execute("UPDATE members SET google_calendar_ids=? WHERE id=?", (json.dumps(calendar_ids), member_id))
    conn.commit()
    conn.close()
    return {"ok": True, "selected": calendar_ids}

# ── Sync ──────────────────────────────────────────────────────────────────────

GOOGLE_COLOR_MAP = {
    "1": "#ac725e", "2": "#d06b64", "3": "#f83a22", "4": "#fa573c",
    "5": "#ff7537", "6": "#ffad46", "7": "#42d692", "8": "#16a765",
    "9": "#7bd148", "10": "#b3dc6c", "11": "#fbe983", "12": "#fad165",
    "13": "#92e1c0", "14": "#9fe1e7", "15": "#9fc6e7", "16": "#4986e7",
    "17": "#9a9cff", "18": "#b99aff", "19": "#c2c2c2", "20": "#cabdbf",
    "21": "#cca6ac", "22": "#f691b2", "23": "#cd74e6", "24": "#a47ae2",
}

async def _sync_calendars(access_token: str, calendar_ids: list, conn, is_family: bool, member_id: int = None) -> int:
    synced = 0
    # Fetch all calendar colors from calendarList (this has the user's custom colors)
    cal_color_map = {}
    async with httpx.AsyncClient() as client:
        cl_resp = await client.get(
            "https://www.googleapis.com/calendar/v3/users/me/calendarList",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"maxResults": "250"}
        )
        if cl_resp.status_code == 200:
            for item in cl_resp.json().get("items", []):
                # backgroundColor is the user's chosen color for this calendar
                color = item.get("backgroundColor")
                if color:
                    cal_color_map[item["id"]] = color

    for cal_id in calendar_ids:
        cal_color = cal_color_map.get(cal_id)

        # URL-encode the calendar ID — required for special IDs like holiday calendars
        # which contain # characters (e.g. en.usa#holiday@group.v.calendar.google.com)
        encoded_cal_id = quote(cal_id, safe='')

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://www.googleapis.com/calendar/v3/calendars/{encoded_cal_id}/events",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"timeMin": "2025-01-01T00:00:00Z", "singleEvents": "true", "orderBy": "startTime", "maxResults": "2500", "timeZone": get_app_tz()}
            )
            if resp.status_code != 200:
                print(f"Calendar fetch failed for {cal_id}: {resp.status_code} {resp.text[:200]}")
                continue
            google_events = resp.json().get("items", [])
        for ge in google_events:
            if ge.get("status") == "cancelled":
                continue
            gid = ge["id"]
            title = ge.get("summary", "(No title)")
            desc = ge.get("description", "")
            location = ge.get("location", "")
            start = ge["start"].get("dateTime") or ge["start"].get("date")
            end = ge["end"].get("dateTime") or ge["end"].get("date")
            all_day = 1 if "date" in ge["start"] and "dateTime" not in ge["start"] else 0
            # Use event-level colorId first, fall back to calendar color
            color_id = ge.get("colorId")
            event_color = GOOGLE_COLOR_MAP.get(color_id) if color_id else cal_color
            if is_family:
                existing = conn.execute("SELECT id FROM events WHERE google_event_id=? AND is_family=1", (gid,)).fetchone()
                if existing:
                    conn.execute("UPDATE events SET title=?, description=?, location=?, start_datetime=?, end_datetime=?, all_day=?, color=? WHERE google_event_id=? AND is_family=1",
                                 (title, desc, location, start, end, all_day, event_color, gid))
                else:
                    conn.execute("INSERT INTO events (title, description, location, start_datetime, end_datetime, all_day, is_family, google_event_id, color) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
                                 (title, desc, location, start, end, all_day, gid, event_color))
            else:
                existing = conn.execute("SELECT id FROM events WHERE google_event_id=? AND member_id=?", (gid, member_id)).fetchone()
                if existing:
                    conn.execute("UPDATE events SET title=?, description=?, location=?, start_datetime=?, end_datetime=?, all_day=?, color=? WHERE google_event_id=? AND member_id=?",
                                 (title, desc, location, start, end, all_day, event_color, gid, member_id))
                else:
                    conn.execute("INSERT INTO events (title, description, location, start_datetime, end_datetime, all_day, member_id, is_family, google_event_id, color) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
                                 (title, desc, location, start, end, all_day, member_id, gid, event_color))
            synced += 1
    return synced

@router.get("/sync/status")
async def get_sync_status():
    conn = get_db()
    last = conn.execute("SELECT value FROM settings WHERE key='google_last_synced'").fetchone()
    interval = conn.execute("SELECT value FROM settings WHERE key='google_sync_interval'").fetchone()
    conn.close()
    return {
        "last_synced": last["value"] if last else None,
        "interval_minutes": int(interval["value"]) if interval else 0,
    }

async def run_full_sync():
    """Auto-sync all connected Google Calendars. Called by background loop."""
    conn = get_db()
    family_cal = conn.execute("SELECT * FROM family_google_calendar LIMIT 1").fetchone()
    members_list = conn.execute("SELECT id FROM members WHERE google_access_token IS NOT NULL").fetchall()
    conn.close()
    if family_cal:
        try:
            await sync_family_google_calendar()
        except Exception:
            pass
    for m in members_list:
        try:
            await sync_member_google_calendar(m["id"])
        except Exception:
            pass
    conn = get_db()
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_last_synced', ?)",
                 (datetime.utcnow().isoformat(),))
    conn.commit()
    conn.close()

@router.post("/sync/family")
async def sync_family_google_calendar():
    conn = get_db()
    family_cal = conn.execute("SELECT * FROM family_google_calendar LIMIT 1").fetchone()
    conn.close()
    if not family_cal:
        raise HTTPException(status_code=400, detail="Family Google Calendar not connected")
    access_token = await refresh_token_if_needed(dict(family_cal), is_family=True)
    try:
        cal_ids = json.loads(family_cal["calendar_id"] or '["primary"]')
        if not isinstance(cal_ids, list):
            cal_ids = [cal_ids]
    except Exception:
        cal_ids = ["primary"]
    conn = get_db()
    # Clear events pulled from Google sync, but preserve locally-created events
    # (those have google_calendar_id set, meaning user explicitly pushed them)
    conn.execute("DELETE FROM events WHERE is_family=1 AND google_event_id IS NOT NULL AND google_calendar_id IS NULL")
    conn.commit()
    synced = await _sync_calendars(access_token, cal_ids, conn, is_family=True)
    conn.commit()
    conn.close()
    return {"synced": synced}

@router.post("/sync/member/{member_id}")
async def sync_member_google_calendar(member_id: int):
    conn = get_db()
    member = conn.execute("SELECT * FROM members WHERE id=?", (member_id,)).fetchone()
    conn.close()
    if not member or not member["google_access_token"]:
        raise HTTPException(status_code=400, detail="Member Google Calendar not connected")
    access_token = await refresh_token_if_needed(dict(member), is_family=False, member_id=member_id)
    try:
        cal_ids = json.loads(member["google_calendar_ids"] or '["primary"]')
        if not isinstance(cal_ids, list):
            cal_ids = [cal_ids]
    except Exception:
        cal_ids = ["primary"]
    conn = get_db()
    # Clear events pulled from Google sync, but preserve locally-created events
    conn.execute("DELETE FROM events WHERE member_id=? AND google_event_id IS NOT NULL AND google_calendar_id IS NULL", (member_id,))
    conn.commit()
    synced = await _sync_calendars(access_token, cal_ids, conn, is_family=False, member_id=member_id)
    conn.commit()
    conn.close()
    return {"synced": synced}

@router.post("/push/family")
async def push_event_to_family_calendar(event_id: int):
    conn = get_db()
    event = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    family_cal = conn.execute("SELECT * FROM family_google_calendar LIMIT 1").fetchone()
    conn.close()
    if not event: raise HTTPException(status_code=404, detail="Event not found")
    if not family_cal: raise HTTPException(status_code=400, detail="Family Google Calendar not connected")
    access_token = await refresh_token_if_needed(dict(family_cal), is_family=True)
    try:
        cal_ids = json.loads(family_cal["calendar_id"] or '["primary"]')
        calendar_id = cal_ids[0] if isinstance(cal_ids, list) else cal_ids
    except Exception:
        calendar_id = "primary"
    body = {
        "summary": event["title"],
        "description": event["description"],
        "start": {"dateTime": event["start_datetime"], "timeZone": "UTC"},
        "end": {"dateTime": event["end_datetime"], "timeZone": "UTC"},
    }
    if event["all_day"]:
        body["start"] = {"date": event["start_datetime"][:10]}
        body["end"] = {"date": event["end_datetime"][:10]}
    async with httpx.AsyncClient() as client:
        if event["google_event_id"]:
            resp = await client.put(
                f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events/{event['google_event_id']}",
                headers={"Authorization": f"Bearer {access_token}"}, json=body)
        else:
            resp = await client.post(
                f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events",
                headers={"Authorization": f"Bearer {access_token}"}, json=body)
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"Google API error: {resp.text}")
    gid = resp.json()["id"]
    conn = get_db()
    conn.execute("UPDATE events SET google_event_id=?, is_family=1 WHERE id=?", (gid, event_id))
    conn.commit()
    conn.close()
    return {"ok": True, "google_event_id": gid}
