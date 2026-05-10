"""
Database layer for the Axion / SimuCast backend.

Defines the SQLAlchemy engine, session factory, declarative ``Base``, all ORM
models, and the schema-init / migration helpers. ``_try_init_at_startup`` is
declared here but invoked from ``backend/app.py`` after the orchestrator has
imported everything else, so the engine and ``SessionLocal`` are created
exactly once and shared by the rest of the package.
"""
import time
from datetime import datetime

from sqlalchemy import create_engine, Column, String, Integer, DateTime, Text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.dialects.postgresql import JSONB

from backend.config import DATABASE_URL


engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


# --- models ---
def _json_col():
    """JSONB column for JSON-shaped data — accepts dicts/lists natively."""
    return Column(JSONB, nullable=True)


class Dataset(Base):
    """Project dataset row plus its currently-active stage pointer."""
    __tablename__ = "datasets"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    filename = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    row_count = Column(Integer, default=0)
    col_count = Column(Integer, default=0)
    variables = _json_col()      # [{name, dtype, missing, unique}] of CURRENT stage
    data = _json_col()           # original (stage-0) rows; never mutated
    current_stage_id = Column(String, nullable=True)  # null = original
    sheets = _json_col()          # Excel sheet payloads; null for CSV/single-table files
    active_sheet = Column(String, nullable=True)
    user_id = Column(String, nullable=True, index=True)
    session_id = Column(String, nullable=True, index=True)


class User(Base):
    """Registered (non-guest) account."""
    __tablename__ = "users"
    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False, index=True)
    full_name = Column(String, nullable=True)
    password_hash = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class UserSession(Base):
    """Auth/session token plus per-guest usage counters."""
    __tablename__ = "sessions"
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=True, index=True)
    token = Column(String, unique=True, nullable=False, index=True)
    is_guest = Column(Integer, default=1)
    guest_usage_count = Column(Integer, default=0)
    guest_model_usage_count = Column(Integer, default=0)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class DatasetStage(Base):
    """A versioned snapshot produced by a transformation (clean / merge / expand…).

    Each stage records what produced it so the UI can render a timeline,
    revert to it, or export it. The original upload is the implicit stage 0
    and is not persisted here — it lives in Dataset.data.
    """
    __tablename__ = "dataset_stages"
    id = Column(String, primary_key=True)
    dataset_id = Column(String, nullable=False, index=True)
    parent_stage_id = Column(String, nullable=True)
    step_index = Column(Integer, default=0)
    op_type = Column(String)                  # 'clean', 'merge', 'rename', 'drop', 'expand', ...
    op_params = _json_col()                   # the payload that produced this stage
    summary = Column(Text)                    # one-line human / AI explanation
    row_count = Column(Integer, default=0)
    col_count = Column(Integer, default=0)
    variables = _json_col()
    data = _json_col()
    created_at = Column(DateTime, default=datetime.utcnow)


class Analysis(Base):
    """Saved analysis artifact (describe, t-test, AI explanation, report, …)."""
    __tablename__ = "analyses"
    id = Column(String, primary_key=True)
    dataset_id = Column(String, nullable=False)
    kind = Column(String)         # 'describe', 't_test', 'anova', etc.
    config = _json_col()
    result = _json_col()
    created_at = Column(DateTime, default=datetime.utcnow)


class Model(Base):
    """Trained ML model artifact with metrics and serialized estimator."""
    __tablename__ = "models"
    id = Column(String, primary_key=True)
    dataset_id = Column(String, nullable=False)
    name = Column(String)
    algorithm = Column(String)
    target = Column(String)
    features = _json_col()
    metrics = _json_col()
    feature_importance = _json_col()
    coefficients = _json_col()    # for what-if predictions
    created_at = Column(DateTime, default=datetime.utcnow)


class ActivityLog(Base):
    """Append-only project activity timeline entry."""
    __tablename__ = "activity_logs"
    id = Column(String, primary_key=True)
    dataset_id = Column(String, nullable=True, index=True)
    kind = Column(String, nullable=False)
    summary = Column(Text, nullable=False)
    detail = _json_col()
    ref_type = Column(String, nullable=True)
    ref_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class AIResponse(Base):
    """Persistent store for every AI call.

    Doubles as a cross-restart cache (kind in {recommend, explain, project_plan}
    keyed by cache_key) and as the chat-history transcript (kind='chat',
    role in {user, assistant}, cache_key=NULL).
    """
    __tablename__ = "ai_responses"
    id = Column(String, primary_key=True)
    dataset_id = Column(String, nullable=False, index=True)
    stage_id = Column(String, nullable=True)
    user_id = Column(String, nullable=True, index=True)
    kind = Column(String, nullable=False)            # 'recommend'|'explain'|'project_plan'|'chat'
    role = Column(String, nullable=True)             # 'user'|'assistant' (chat only)
    context = Column(String, nullable=True)
    cache_key = Column(String, nullable=True, index=True)
    request = _json_col()
    response = _json_col()
    model = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


# DB initialization is deferred to the first request so gunicorn can bind
# to its port immediately even when Postgres is still provisioning. Free-tier
# Render Postgres can take several minutes to start accepting connections.
_db_ready = False


def _ensure_schema():
    """Create tables if they don't exist yet. Safe to call repeatedly."""
    global _db_ready
    if _db_ready:
        return
    Base.metadata.create_all(engine)
    _migrate_add_columns()
    _db_ready = True


def _migrate_add_columns():
    """Idempotently add columns that were introduced after the table was first
    created. SQLAlchemy's create_all only creates tables, not new columns."""
    from sqlalchemy import inspect, text
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
        ai_column_defs = {
            "stage_id": "VARCHAR",
            "user_id": "VARCHAR",
            "kind": "VARCHAR",
            "role": "VARCHAR",
            "context": "VARCHAR",
            "cache_key": "VARCHAR",
            "request": "JSONB",
            "response": "JSONB",
            "model": "VARCHAR",
            "created_at": "TIMESTAMP",
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


def db():
    """Open a new SQLAlchemy session bound to the shared engine."""
    return SessionLocal()
