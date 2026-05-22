import time
from datetime import datetime

# Standard-library imports
import time                       # used for retry-with-delay during DB startup
from datetime import datetime     # used as the default value for created_at columns

# SQLAlchemy: the toolkit that lets us talk to Postgres in Python
from sqlalchemy import create_engine, Column, String, Integer, DateTime, Text
from sqlalchemy.exc import OperationalError                # raised when Postgres isn't reachable yet
from sqlalchemy.orm import declarative_base, sessionmaker  # ORM building blocks
from sqlalchemy.dialects.postgresql import JSONB           # Postgres-specific JSON column type

# Our own config — DATABASE_URL is loaded from the environment
from backend.config import DATABASE_URL


# ---------------------------------------------------------------------------
# CONNECTION SETUP
# ---------------------------------------------------------------------------

# `engine` is the connection pool to Postgres.
# pool_pre_ping=True tells SQLAlchemy to test each connection before reusing
engine = create_engine(DATABASE_URL, pool_pre_ping=True)

# `SessionLocal` is a factory: every request calls SessionLocal() to get a
# fresh database session, runs its queries, then closes it.
SessionLocal = sessionmaker(bind=engine)

# `Base` is the parent class that every table model below inherits from.
# SQLAlchemy reads our class definitions through Base to know what tables and columns exist.
Base = declarative_base()


# ---------------------------------------------------------------------------
# SHARED HELPER
# ---------------------------------------------------------------------------

def _json_col():
    """Shorthand for a nullable JSONB column.

    JSONB is Postgres's native JSON type — it lets a single column hold a
    whole nested dict or list (e.g. model metrics, dataset variables) so we
    don't need a separate table for every flexible-shape payload.

    We use this helper 11+ times below, so wrapping it keeps the table
    definitions short and lets us change the default in one place later.
    """
    return Column(JSONB, nullable=True)


# ===========================================================================
# TABLE MODELS
# Each class below = one table in Postgres.
# `id` is always an auto-incrementing integer primary key.
# Columns ending in `_id` are foreign keys (pointers to another table's id).
# ===========================================================================

class Dataset(Base):
    """A project / uploaded data file. The root row that everything else hangs off."""
    __tablename__ = "datasets"

    id = Column(Integer, primary_key=True, autoincrement=True)   # auto-assigned: 1, 2, 3, ...
    name = Column(String, nullable=False)                        # display name
    description = Column(Text, nullable=True)                    # optional long text
    filename = Column(String)                                    # original upload filename
    created_at = Column(DateTime, default=datetime.utcnow)       # set automatically on insert
    row_count = Column(Integer, default=0)                       # cached size for fast listing
    col_count = Column(Integer, default=0)

    # Schema of the CURRENT stage: list of {name, dtype, missing, unique}
    variables = _json_col()
    # Original uploaded rows. NEVER modified — every transform creates a new
    # DatasetStage instead. This is the "stage 0" snapshot.
    data = _json_col()
    # Pointer to the active DatasetStage. NULL means we're viewing the original.
    current_stage_id = Column(Integer, nullable=True)
    # For Excel uploads: dict of {sheet_name: rows}. NULL for CSV.
    sheets = _json_col()
    active_sheet = Column(String, nullable=True)                 # which sheet is currently shown
    guidance = _json_col()                                       # project goal + guided-mode state

    # Ownership: which user/session this project belongs to.
    user_id = Column(Integer, nullable=True, index=True)         # NULL for guest-only datasets
    session_id = Column(Integer, nullable=True, index=True)      # `index=True` makes lookups fast


class User(Base):
    """A signed-up account (not a guest)."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String, unique=True, nullable=False, index=True)   # unique=True → DB rejects duplicates
    full_name = Column(String, nullable=True)
    password = Column(Text, nullable=False)  # PLAINTEXT — project requirement; would be bcrypt in production
    created_at = Column(DateTime, default=datetime.utcnow)


class UserSession(Base):
    """A login session — both for guests and signed-in users.

    The `token` is what the frontend sends in the Authorization header to
    prove who they are. Guest sessions also track usage counters so we can
    enforce the "1 project, N model trainings" guest limits.
    """
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=True, index=True)         # NULL means "guest, no account"
    token = Column(String, unique=True, nullable=False, index=True)  # the bearer token

    is_guest = Column(Integer, default=1)                        # 1 = guest, 0 = signed-in user
    guest_usage_count = Column(Integer, default=0)               # # of projects a guest has created
    guest_model_usage_count = Column(Integer, default=0)         # # of models a guest has trained
    expires_at = Column(DateTime, nullable=True)                 # when this token stops working
    created_at = Column(DateTime, default=datetime.utcnow)


class DatasetStage(Base):
    """One snapshot of a dataset after a cleaning / transform step.

    Every time the user runs a clean / merge / rename / drop / expand, we
    save a new DatasetStage row instead of modifying the original. This
    gives us a full undo timeline — the UI can render every step and let
    the user revert to any point.
    """
    __tablename__ = "dataset_stages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dataset_id = Column(Integer, nullable=False, index=True)     # which dataset this stage belongs to
    parent_stage_id = Column(Integer, nullable=True)             # the stage this one was derived from
    step_index = Column(Integer, default=0)                      # ordering: 1, 2, 3, ...

    op_type = Column(String)         # what kind of operation: 'clean', 'merge', 'rename', 'drop', 'expand', ...
    op_params = _json_col()          # the parameters that produced this stage (e.g. {"column": "age", "fill": "mean"})
    summary = Column(Text)           # one-line human / AI explanation, shown on the timeline

    # Resulting shape and data after the transform was applied
    row_count = Column(Integer, default=0)
    col_count = Column(Integer, default=0)
    variables = _json_col()
    data = _json_col()
    created_at = Column(DateTime, default=datetime.utcnow)


class Analysis(Base):
    """A saved analysis result: descriptive stats, t-test, AI explanation, generated report, etc."""
    __tablename__ = "analyses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dataset_id = Column(Integer, nullable=False)                 # which dataset this analysis was run on
    kind = Column(String)                                        # 'describe' | 't_test' | 'anova' | 'ai_explanation' | 'report' | ...
    config = _json_col()                                         # the inputs (which columns, options, etc.)
    result = _json_col()                                         # the outputs (stats, p-values, narrative text, ...)
    created_at = Column(DateTime, default=datetime.utcnow)


class Model(Base):
    """A trained ML model with its metrics and feature info."""
    __tablename__ = "models"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dataset_id = Column(Integer, nullable=False)                 # which dataset it was trained on
    name = Column(String)                                        # auto-generated label, e.g. "logistic_y"
    algorithm = Column(String)                                   # 'logistic', 'rf', 'xgboost', ...
    target = Column(String)                                      # the column being predicted

    features = _json_col()                                       # list of feature column names
    metrics = _json_col()                                        # accuracy / F1 / R² / etc.
    feature_importance = _json_col()                             # which features mattered most
    coefficients = _json_col()                                   # for linear models — used by What-if predictions
    created_at = Column(DateTime, default=datetime.utcnow)


class ActivityLog(Base):
    """An append-only timeline of everything users do in a project.

    We never update or delete these rows — they're a permanent audit trail
    that powers the project history view and the Documentation report section.
    """
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dataset_id = Column(Integer, nullable=True, index=True)      # the project this event belongs to
    kind = Column(String, nullable=False)                        # 'upload' | 'clean' | 'model' | 'analysis' | ...
    summary = Column(Text, nullable=False)                       # human-readable one-liner

    detail = _json_col()                                         # structured payload (parameters, before/after, ...)

    # `ref_type` + `ref_id` together point at whichever artifact this entry
    # is *about* — e.g. ('model', 17) or ('analysis', 42). It's polymorphic:
    # we don't enforce a single FK because the target table varies.
    ref_type = Column(String, nullable=True)
    ref_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class AIResponse(Base):
    """Every call we make to the AI (Claude) is saved here.

    Two jobs in one table:
      - CACHE: when kind in {'recommend', 'explain', 'project_plan'}, we look
        up by `cache_key` to avoid re-calling the API for identical requests.
      - CHAT TRANSCRIPT: when kind = 'chat', each turn is one row with
        role = 'user' or 'assistant' (cache_key is NULL for these).
    """
    __tablename__ = "ai_responses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dataset_id = Column(Integer, nullable=False, index=True)
    stage_id = Column(Integer, nullable=True)                    # which dataset stage was active
    user_id = Column(Integer, nullable=True, index=True)         # who triggered the call

    kind = Column(String, nullable=False)        # 'recommend' | 'explain' | 'project_plan' | 'chat'
    role = Column(String, nullable=True)         # 'user' | 'assistant' — only used when kind='chat'
    context = Column(String, nullable=True)      # which page/tab the user was on
    cache_key = Column(String, nullable=True, index=True)        # hash of the request, for cache lookup

    request = _json_col()                        # what we sent to the AI
    response = _json_col()                       # what the AI returned
    model = Column(String, nullable=True)        # which Claude model answered
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


# ===========================================================================
# SCHEMA INITIALIZATION
# ===========================================================================
# We don't create the tables when this module is imported — instead we wait
# until either the app's startup hook or the first incoming request runs
# `_ensure_schema()`. This lets gunicorn bind its port immediately, even when
# Render's free-tier Postgres takes a couple minutes to wake up.

# Tracks whether create_all has already run this process, so we only do it once.
_db_ready = False


def _ensure_schema():
    """Make sure every table exists. Safe to call as many times as you want."""
    global _db_ready 
    if _db_ready:
        return # already done, no need to check again
    Base.metadata.create_all(engine)   # creates any table that doesn't exist yet
    _migrate_add_columns()             # adds any newly introduced columns to old tables
    _db_ready = True


def _migrate_add_columns():
    
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    tables = insp.get_table_names()  # list of table names that actually exist in the DB

    # ----- users: maybe add full_name -----
    if "users" in tables:
        user_cols = {c["name"] for c in insp.get_columns("users")}
        with engine.begin() as conn:  # `begin()` opens a transaction that auto-commits on exit
            if "full_name" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN full_name VARCHAR"))

  
    if "sessions" in tables:
        session_cols = {c["name"] for c in insp.get_columns("sessions")}
        with engine.begin() as conn:
            if "guest_model_usage_count" not in session_cols:
                conn.execute(text("ALTER TABLE sessions ADD COLUMN guest_model_usage_count INTEGER DEFAULT 0"))

    if "ai_responses" in tables:
        ai_cols = {c["name"] for c in insp.get_columns("ai_responses")}
        # Map of column-name → SQL type for every column added after the
        # original schema. We loop through and only add the missing ones.
        ai_column_defs = {
            "stage_id": "INTEGER",
            "user_id": "INTEGER",
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

    # ----- datasets: a bunch of columns added across multiple releases -----
    if "datasets" not in tables:
        return  # brand-new install — create_all already built it with everything
    cols = {c["name"] for c in insp.get_columns("datasets")}
    with engine.begin() as conn:
        if "description" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN description TEXT"))
        if "current_stage_id" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN current_stage_id INTEGER"))
        if "sheets" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN sheets TEXT"))
        if "active_sheet" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN active_sheet VARCHAR"))
        if "guidance" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN guidance JSONB"))
        if "user_id" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN user_id INTEGER"))
        if "session_id" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN session_id INTEGER"))


def _try_init_at_startup(retries=6, delay=5):
    """Try to set up the schema when the app boots.

    On free-tier Render, Postgres can take a minute or two to wake up. Rather
    than crashing the web service, we retry a few times with a delay. If
    everything still fails, we just log it and continue — the next request
    that reaches `_ensure_schema()` will try again.
    """
    for i in range(retries):
        try:
            _ensure_schema()
            return  # success — exit the retry loop
        except OperationalError as e:
            # OperationalError = "couldn't reach the DB". Other errors we let bubble up.
            print(f"DB not ready ({e.__class__.__name__}), retry {i+1}/{retries} in {delay}s", flush=True)
            time.sleep(delay)
    print("DB not ready after startup retries; will init on first request", flush=True)


def db():
    
    return SessionLocal()
