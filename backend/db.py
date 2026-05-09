"""SQLAlchemy engine + schema management.

The schema init is deferred to the first request so gunicorn can bind to its
port immediately even when Postgres is still provisioning. Free-tier Render
Postgres can take several minutes to start accepting connections.
"""
import time
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import DATABASE_URL


engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

_db_ready = False


def db():
    """Open a new SQLAlchemy session. Caller is responsible for closing."""
    return SessionLocal()


def is_db_ready() -> bool:
    """True once tables/migrations have been applied at least once."""
    return _db_ready


def _ensure_schema():
    """Create tables if they don't exist yet. Safe to call repeatedly."""
    global _db_ready
    if _db_ready:
        return
    Base.metadata.create_all(engine)
    _migrate_add_columns()
    _db_ready = True


def _migrate_add_columns():
    """Idempotently add columns introduced after a table was first created.

    SQLAlchemy's create_all only creates tables, not new columns on existing
    tables. We bridge that gap with raw ALTER TABLE statements gated on
    inspector lookups so re-runs are safe.
    """
    insp = inspect(engine)
    tables = insp.get_table_names()
    if "users" in tables:
        user_cols = {c["name"] for c in insp.get_columns("users")}
        with engine.begin() as conn:
            if "full_name" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN full_name VARCHAR"))
    if "sessions" in tables:
        session_cols = {c["name"] for c in insp.get_columns("sessions")}
        with engine.begin() as conn:
            if "guest_model_usage_count" not in session_cols:
                conn.execute(text("ALTER TABLE sessions ADD COLUMN guest_model_usage_count INTEGER DEFAULT 0"))
    if "ai_responses" in tables:
        ai_cols = {c["name"] for c in insp.get_columns("ai_responses")}
        json_type = "JSONB" if "postgresql" in DATABASE_URL else "TEXT"
        datetime_type = "TIMESTAMP" if "postgresql" in DATABASE_URL else "DATETIME"
        ai_column_defs = {
            "stage_id": "VARCHAR",
            "user_id": "VARCHAR",
            "kind": "VARCHAR",
            "role": "VARCHAR",
            "context": "VARCHAR",
            "cache_key": "VARCHAR",
            "request": json_type,
            "response": json_type,
            "model": "VARCHAR",
            "created_at": datetime_type,
        }
        with engine.begin() as conn:
            for col, col_type in ai_column_defs.items():
                if col not in ai_cols:
                    conn.execute(text(f"ALTER TABLE ai_responses ADD COLUMN {col} {col_type}"))
    if "datasets" not in tables:
        return
    cols = {c["name"] for c in insp.get_columns("datasets")}
    with engine.begin() as conn:
        if "description" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN description TEXT"))
        if "current_stage_id" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN current_stage_id VARCHAR"))
        if "sheets" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN sheets TEXT"))
        if "active_sheet" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN active_sheet VARCHAR"))
        if "user_id" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN user_id VARCHAR"))
        if "session_id" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN session_id VARCHAR"))


def _try_init_at_startup(retries=6, delay=5):
    """Best-effort schema init at boot — swallow failures so we still start."""
    for i in range(retries):
        try:
            _ensure_schema()
            return
        except OperationalError as e:
            print(f"DB not ready ({e.__class__.__name__}), retry {i+1}/{retries} in {delay}s", flush=True)
            time.sleep(delay)
    print("DB not ready after startup retries; will init on first request", flush=True)
