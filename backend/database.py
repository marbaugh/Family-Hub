import sqlite3
import os

DB_PATH = os.environ.get("DB_PATH", "/data/familyhub.db")

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    conn = get_db()
    cur = conn.cursor()

    cur.executescript("""
        CREATE TABLE IF NOT EXISTS members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#4A90D9',
            avatar TEXT DEFAULT NULL,
            is_admin INTEGER DEFAULT 0,
            google_access_token TEXT DEFAULT NULL,
            google_refresh_token TEXT DEFAULT NULL,
            google_token_expiry TEXT DEFAULT NULL,
            google_email TEXT DEFAULT NULL,
            google_calendar_ids TEXT DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS family_google_calendar (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            google_access_token TEXT,
            google_refresh_token TEXT,
            google_token_expiry TEXT,
            google_email TEXT,
            calendar_id TEXT DEFAULT 'primary',
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            start_datetime TEXT NOT NULL,
            end_datetime TEXT NOT NULL,
            all_day INTEGER DEFAULT 0,
            member_id INTEGER DEFAULT NULL,
            is_family INTEGER DEFAULT 0,
            google_event_id TEXT DEFAULT NULL,
            color TEXT DEFAULT NULL,
            recurrence TEXT DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS photos_auth (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            google_access_token TEXT,
            google_refresh_token TEXT,
            google_token_expiry TEXT,
            google_email TEXT,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS photos_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_item_id TEXT UNIQUE,
            base_url TEXT NOT NULL,
            url_expiry TEXT NOT NULL,
            mime_type TEXT DEFAULT 'image/jpeg',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS chores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            assigned_to INTEGER DEFAULT NULL,
            due_date TEXT DEFAULT NULL,
            completed INTEGER DEFAULT 0,
            completed_at TEXT DEFAULT NULL,
            recurrence TEXT DEFAULT NULL,
            recurrence_days TEXT DEFAULT NULL,
            recurrence_interval INTEGER DEFAULT 1,
            points INTEGER DEFAULT 1,
            time_of_day TEXT DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (assigned_to) REFERENCES members(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            author_id INTEGER DEFAULT NULL,
            body TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (author_id) REFERENCES members(id) ON DELETE SET NULL
        );
    """)

    conn.commit()

    # Run migrations for existing databases
    try:
        conn.execute("ALTER TABLE members ADD COLUMN google_calendar_ids TEXT DEFAULT NULL")
        conn.commit()
    except Exception:
        pass

    try:
        conn.execute("ALTER TABLE chores ADD COLUMN recurrence_days TEXT DEFAULT NULL")
        conn.commit()
    except Exception:
        pass

    try:
        conn.execute("ALTER TABLE chores ADD COLUMN time_of_day TEXT DEFAULT NULL")
        conn.commit()
    except Exception:
        pass

    try:
        conn.execute("ALTER TABLE events ADD COLUMN google_calendar_id TEXT DEFAULT NULL")
        conn.commit()
    except Exception:
        pass

    try:
        conn.execute("ALTER TABLE events ADD COLUMN location TEXT DEFAULT ''")
        conn.commit()
    except Exception:
        pass

    try:
        conn.execute("""CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )""")
        conn.commit()
    except Exception:
        pass

    try:
        conn.execute("""CREATE TABLE IF NOT EXISTS photos_auth (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            google_access_token TEXT,
            google_refresh_token TEXT,
            google_token_expiry TEXT,
            google_email TEXT,
            updated_at TEXT DEFAULT (datetime('now'))
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS photos_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_item_id TEXT UNIQUE,
            base_url TEXT NOT NULL,
            url_expiry TEXT NOT NULL,
            mime_type TEXT DEFAULT 'image/jpeg',
            created_at TEXT DEFAULT (datetime('now'))
        )""")
        conn.commit()
    except Exception:
        pass

    # Seed default settings
    defaults = [
        ('slideshow_timeout', '120'),
        ('slideshow_interval', '5'),
        ('photos_album_url', ''),
        ('photos_session_id', ''),
    ]
    for key, val in defaults:
        try:
            conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, val))
        except Exception:
            pass
    conn.commit()

    conn.close()
    print("Database initialized.")
