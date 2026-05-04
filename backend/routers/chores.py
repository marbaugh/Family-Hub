from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
import sys, os; sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from database import get_db
from datetime import datetime, timedelta
import pytz

router = APIRouter()

class ChoreCreate(BaseModel):
    title: str
    description: str = ""
    assigned_to: Optional[int] = None
    assign_to_members: Optional[list] = None  # list of member IDs for multi-assign
    due_date: Optional[str] = None
    recurrence: Optional[str] = None  # daily, weekdays, weekly, monthly, None
    recurrence_days: Optional[str] = None  # comma-separated days e.g. "Mon,Tue,Wed"
    recurrence_interval: int = 1
    points: int = 1
    time_of_day: Optional[str] = None  # morning, afternoon, evening

class ChoreUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    assigned_to: Optional[int] = None
    due_date: Optional[str] = None
    completed: Optional[bool] = None
    recurrence: Optional[str] = None
    recurrence_days: Optional[str] = None
    recurrence_interval: Optional[int] = None
    points: Optional[int] = None
    time_of_day: Optional[str] = None

@router.get("/")
def get_chores(
    assigned_to: Optional[int] = Query(None),
    completed: Optional[bool] = Query(None),
    hide_future: Optional[bool] = Query(False),
    since_days: Optional[int] = Query(None)
):
    conn = get_db()
    today = datetime.now().date().isoformat()
    query = """
        SELECT c.*, m.name as member_name, m.color as member_color
        FROM chores c
        LEFT JOIN members m ON c.assigned_to = m.id
        WHERE 1=1
    """
    params = []
    if assigned_to is not None:
        query += " AND c.assigned_to = ?"
        params.append(assigned_to)
    if completed is not None:
        query += " AND c.completed = ?"
        params.append(1 if completed else 0)
    if hide_future:
        query += " AND (c.due_date IS NULL OR c.due_date <= ?)"
        params.append(today)
    if since_days is not None:
        cutoff = (datetime.now().date() - timedelta(days=since_days)).isoformat()
        query += " AND (c.due_date IS NULL OR c.due_date >= ?)"
        params.append(cutoff)
    query += " ORDER BY c.completed ASC, c.due_date ASC NULLS LAST, c.created_at DESC"
    chores = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(c) for c in chores]

@router.post("/")
def create_chore(chore: ChoreCreate):
    conn = get_db()
    results = []
    today = datetime.now().date().isoformat()
    # Recurring chores must have a due_date so recurrence engine works correctly
    due_date = chore.due_date or (today if chore.recurrence else None)
    # Determine list of members to assign to
    member_ids = chore.assign_to_members if chore.assign_to_members else [chore.assigned_to]
    for mid in member_ids:
        cur = conn.execute("""
            INSERT INTO chores (title, description, assigned_to, due_date, recurrence, recurrence_days, recurrence_interval, points, time_of_day)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (chore.title, chore.description, mid, due_date,
              chore.recurrence, chore.recurrence_days, chore.recurrence_interval, chore.points, chore.time_of_day))
        new_id = cur.lastrowid
        row = conn.execute("""
            SELECT c.*, m.name as member_name, m.color as member_color
            FROM chores c LEFT JOIN members m ON c.assigned_to = m.id WHERE c.id=?
        """, (new_id,)).fetchone()
        results.append(dict(row))
    conn.commit()
    conn.close()
    return results[0] if len(results) == 1 else results

@router.put("/{chore_id}")
def update_chore(chore_id: int, chore: ChoreUpdate):
    conn = get_db()
    existing = conn.execute("SELECT * FROM chores WHERE id=?", (chore_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail="Chore not found")

    updates = {}
    data = chore.dict()
    for k, v in data.items():
        if v is not None:
            updates[k] = v

    # Handle completion
    if "completed" in updates:
        was_completed = bool(existing["completed"])
        now_completed = updates["completed"]
        updates["completed"] = 1 if now_completed else 0
        if now_completed and not was_completed:
            updates["completed_at"] = datetime.now().isoformat()
            # Auto-create next occurrence for recurring chores
            if existing["recurrence"]:
                _create_next_recurrence(conn, dict(existing))
        elif not now_completed:
            updates["completed_at"] = None

    if updates:
        set_clause = ", ".join(f"{k}=?" for k in updates)
        conn.execute(f"UPDATE chores SET {set_clause} WHERE id=?", (*updates.values(), chore_id))
        conn.commit()

    row = conn.execute("""
        SELECT c.*, m.name as member_name, m.color as member_color
        FROM chores c LEFT JOIN members m ON c.assigned_to = m.id WHERE c.id=?
    """, (chore_id,)).fetchone()
    conn.close()
    return dict(row)

@router.delete("/{chore_id}")
def delete_chore(chore_id: int):
    conn = get_db()
    conn.execute("DELETE FROM chores WHERE id=?", (chore_id,))
    conn.commit()
    conn.close()
    return {"ok": True}

@router.get("/leaderboard")
def get_leaderboard():
    conn = get_db()
    rows = conn.execute("""
        SELECT m.id, m.name, m.color, m.avatar,
               SUM(CASE WHEN c.completed=1 THEN c.points ELSE 0 END) as points
        FROM members m
        LEFT JOIN chores c ON c.assigned_to = m.id
        GROUP BY m.id
        ORDER BY points DESC
    """).fetchall()

    # Compute streak per member: consecutive days (back from today) with >= 1 completed chore
    result = []
    tz_name = conn.execute("SELECT value FROM settings WHERE key='timezone'").fetchone()
    tz = pytz.timezone(tz_name["value"] if tz_name and tz_name["value"] else "America/New_York")
    today = datetime.now(tz).date()
    for r in rows:
        d = dict(r)
        streak = 0
        check = today
        while True:
            done = conn.execute(
                "SELECT COUNT(*) FROM chores WHERE assigned_to=? AND completed=1 AND date(due_date)=?",
                (d["id"], check.isoformat())
            ).fetchone()[0]
            if done:
                streak += 1
                check -= timedelta(days=1)
            else:
                break
        d["streak"] = streak
        result.append(d)

    conn.close()
    return result

def _create_next_recurrence(conn, chore: dict):
    """When a recurring chore is completed, create the next one."""
    if not chore["due_date"] or not chore["recurrence"]:
        return
    try:
        due = datetime.fromisoformat(chore["due_date"])
        interval = chore.get("recurrence_interval", 1) or 1
        rec = chore["recurrence"]
        if rec == "daily":
            next_due = due + timedelta(days=interval)
        elif rec == "weekdays":
            next_due = due + timedelta(days=1)
            while next_due.weekday() >= 5:
                next_due += timedelta(days=1)
        elif rec == "weekly":
            next_due = due + timedelta(weeks=interval)
        elif rec == "monthly":
            month = due.month + interval
            year = due.year + (month - 1) // 12
            month = ((month - 1) % 12) + 1
            next_due = due.replace(year=year, month=month)
        elif rec == "custom_days":
            day_map = {"Mon": 0, "Tue": 1, "Wed": 2, "Thu": 3, "Fri": 4, "Sat": 5, "Sun": 6}
            days_str = chore.get("recurrence_days") or ""
            selected = sorted([day_map[d.strip()] for d in days_str.split(",") if d.strip() in day_map])
            if not selected:
                return
            current_wd = due.weekday()
            next_wd = next((d for d in selected if d > current_wd), selected[0])
            days_ahead = (next_wd - current_wd) % 7 or 7
            next_due = due + timedelta(days=days_ahead)
        else:
            return
        next_due_str = next_due.date().isoformat()
        # Dedup: don't create if a matching incomplete occurrence already exists
        existing = conn.execute("""
            SELECT id FROM chores
            WHERE title=? AND assigned_to IS ? AND due_date=? AND completed=0
        """, (chore["title"], chore["assigned_to"], next_due_str)).fetchone()
        if existing:
            return
        conn.execute("""
            INSERT INTO chores (title, description, assigned_to, due_date, recurrence, recurrence_days, recurrence_interval, points, time_of_day)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (chore["title"], chore["description"], chore["assigned_to"],
              next_due_str, chore["recurrence"],
              chore.get("recurrence_days"), interval, chore["points"],
              chore.get("time_of_day")))
    except Exception as e:
        print(f"Error creating recurrence: {e}")
