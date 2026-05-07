"""
Axion — data analysis backend
Flask + SQLAlchemy + pandas + scipy + scikit-learn
"""
import os
import json
import time
import uuid
import re
import base64
import pickle
import secrets
import hashlib
from difflib import SequenceMatcher
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from sqlalchemy import create_engine, Column, String, Integer, DateTime, Text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.dialects.postgresql import JSONB
from werkzeug.security import generate_password_hash, check_password_hash

from scipy import stats
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder, MinMaxScaler
from sklearn.metrics import (
    accuracy_score, roc_auc_score, precision_score, recall_score,
    f1_score, confusion_matrix, mean_squared_error, r2_score
)

def _load_local_env():
    """Load simple KEY=VALUE pairs from backend/.env without overriding real env vars."""
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8-sig") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

_load_local_env()

# --- app + db setup ---
app = Flask(__name__)

# --- Upload limits -----------------------------------------------------------
# We enforce three different limits at upload time:
#   1. MAX_UPLOAD_BYTES: total file size (Flask checks this first and rejects
#      with 413 before we even see the request body).
#   2. _CSV_MAGIC_*: the actual file bytes must match the extension. A user
#      can rename "report.exe" to "report.csv" and we'd otherwise try to
#      parse it.
#   3. MAX_UPLOAD_ROWS: after parsing, refuse very large datasets. Pandas
#      will happily eat a 10M-row CSV and exhaust server RAM.
# These are deliberately tight defaults for the capstone — bump if needed.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024   # 10 MB
MAX_UPLOAD_ROWS = 100_000             # 100k rows
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES


# Flask aborts with a 413 *before* our route runs when MAX_CONTENT_LENGTH is
# exceeded. Without this handler the client gets a generic HTML page; we
# return JSON so the frontend can show a friendly message.
@app.errorhandler(413)
def _too_large(_e):
    mb_limit = MAX_UPLOAD_BYTES // (1024 * 1024)
    return jsonify({"error": f"File is too large. Maximum allowed is {mb_limit} MB."}), 413

@app.route("/api/health")
def home():
    return "API is running 🚀"

_cors_raw = os.environ.get("CORS_ORIGINS", "*")
_cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()] or ["*"]
CORS(app, origins=_cors_origins)

_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "simucast.db")
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    f"sqlite:///{_DB_PATH}"  # absolute path so db location never depends on cwd
)
# Render gives postgres:// but SQLAlchemy needs postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

# --- models ---
# Use Text instead of JSONB for SQLite compatibility; Postgres auto-handles both
def _json_col():
    if "postgresql" in DATABASE_URL:
        return Column(JSONB, nullable=True)
    return Column(Text, nullable=True)

class Dataset(Base):
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
    __tablename__ = "users"
    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False, index=True)
    full_name = Column(String, nullable=True)
    password_hash = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class UserSession(Base):
    __tablename__ = "sessions"
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=True, index=True)
    token = Column(String, unique=True, nullable=False, index=True)
    is_guest = Column(Integer, default=1)
    guest_usage_count = Column(Integer, default=0)
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
    __tablename__ = "analyses"
    id = Column(String, primary_key=True)
    dataset_id = Column(String, nullable=False)
    kind = Column(String)         # 'describe', 't_test', 'anova', etc.
    config = _json_col()
    result = _json_col()
    created_at = Column(DateTime, default=datetime.utcnow)

class Model(Base):
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
    __tablename__ = "activity_logs"
    id = Column(String, primary_key=True)
    dataset_id = Column(String, nullable=True, index=True)
    kind = Column(String, nullable=False)
    summary = Column(Text, nullable=False)
    detail = _json_col()
    ref_type = Column(String, nullable=True)
    ref_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

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

_try_init_at_startup()

# --- helpers ---
def db():
    return SessionLocal()

def _new_token():
    return secrets.token_urlsafe(32)

def _session_payload(sess, user=None):
    return {
        "token": sess.token,
        "user_id": sess.user_id,
        "email": user.email if user else None,
        "full_name": user.full_name if user else None,
        "is_guest": bool(sess.is_guest),
        "usage_count": int(sess.guest_usage_count or 0),
        "limit": 1 if sess.is_guest else None,
        "expires_at": sess.expires_at.isoformat() if sess.expires_at else None,
    }

def _auth_from_request(session):
    auth = request.headers.get("Authorization") or ""
    token = None
    if auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()
    token = token or request.headers.get("X-SimuCast-Session")
    if not token:
        return None, None
    sess = session.query(UserSession).filter_by(token=token).first()
    if not sess:
        return None, None
    if sess.expires_at and sess.expires_at < datetime.utcnow():
        return None, None
    user = session.query(User).filter_by(id=sess.user_id).first() if sess.user_id else None
    return sess, user

def _dataset_scope(query, session):
    sess, user = _auth_from_request(session)
    if not sess:
        return query.filter(False)
    if user:
        return query.filter(Dataset.user_id == user.id)
    return query.filter(Dataset.session_id == sess.id)

def _attach_owner(ds, session):
    sess, user = _auth_from_request(session)
    if not sess:
        return
    ds.session_id = sess.id
    ds.user_id = user.id if user else None

def _claim_guest_projects(session, guest_session, user_id):
    if not guest_session or not guest_session.is_guest:
        return
    for ds in session.query(Dataset).filter_by(session_id=guest_session.id).all():
        ds.user_id = user_id
        ds.session_id = None

def _client_guest_slot_used():
    header = (request.headers.get("X-SimuCast-Guest-Used") or "").strip().lower()
    if header in {"1", "true", "yes"}:
        return True
    body = request.get_json(silent=True) or {}
    return bool(body.get("guest_slot_used"))

def _guest_limit_response(sess):
    if sess and sess.is_guest and int(sess.guest_usage_count or 0) >= 1:
        return {
            "error": "Guest limit reached. Sign up or log in to continue training models and saving work.",
            "auth_required": True,
            "guest_limit": True,
            "session": _session_payload(sess),
        }, 403
    return None

def jload(v):
    """Safely load a JSON column value (dict, list, str, or None)."""
    if v is None:
        return None
    if isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v)
    except Exception:
        return None

def jdump(v):
    """Dump a value to a JSON-compatible form for storage."""
    if "postgresql" in DATABASE_URL:
        return v  # JSONB handles dicts/lists natively
    return json.dumps(v, default=str)


# --- Simple in-memory caches -------------------------------------------------
# We keep two caches:
#   _DF_CACHE   : parsed DataFrames keyed by (dataset_id, stage_id)
#   _AI_CACHE   : AI responses keyed by a hash of the prompt inputs
#
# Why a plain dict and not Redis/Memcached?
# - This is a single-process Flask app on Render. A dict is enough.
# - One less moving part to deploy and explain.
#
# Why cap the size?
# - A long-running server would otherwise hold every dataset ever uploaded
#   in memory. We cap each cache at _CACHE_MAX entries and drop the oldest
#   one (FIFO) when full. Python 3.7+ dicts keep insertion order, so
#   `next(iter(cache))` gives us the oldest key in O(1).
_CACHE_MAX = 32
_DF_CACHE = {}     # {(ds_id, stage_id_or_None): pandas.DataFrame}
_AI_CACHE = {}     # {sha1_hex: response_payload}

def _cache_put(cache, key, value):
    if key in cache:
        # Refresh insertion order so it isn't evicted as "oldest" yet.
        cache.pop(key)
    cache[key] = value
    while len(cache) > _CACHE_MAX:
        cache.pop(next(iter(cache)))

def _df_cache_key(ds):
    """Cache key for a dataset's currently active stage."""
    return (ds.id, ds.current_stage_id)

def _df_cache_invalidate(ds_id):
    """Drop every cached DataFrame *and* AI response for this dataset.

    Called on any change that affects what we'd send to the AI:
    stage transforms, sheet swaps, restores, resets, deletes.

    Both caches use (ds_id, ...) as the key so we can drop only this
    dataset's entries without disturbing anyone else's cache.
    """
    for key in [k for k in _DF_CACHE if k[0] == ds_id]:
        _DF_CACHE.pop(key, None)
    for key in [k for k in _AI_CACHE if k[0] == ds_id]:
        _AI_CACHE.pop(key, None)

def _ai_cache_key(ds_id, stage_id, kind, payload):
    """Build a stable cache key for an AI request.

    Returns a (ds_id, sha1_hex) tuple. Why both?
    - The hash captures stage_id + kind + payload in a fixed-length string,
      so we don't store the raw payload (which can be large) as the key.
    - Keeping ds_id as a separate tuple element lets us filter the cache
      by dataset for invalidation.
    """
    raw = json.dumps(
        {"stage": stage_id, "kind": kind, "payload": payload},
        sort_keys=True,
        default=str,
    )
    return (ds_id, hashlib.sha1(raw.encode("utf-8")).hexdigest())

def df_from_dataset(ds, session=None):
    """Rehydrate a pandas DataFrame from the dataset's *current* stage.

    Falls back to the original data when no stage is active. Pass a session
    when caller already has one to avoid opening a second connection.

    Cached by (dataset_id, current_stage_id) — when the stage changes
    (e.g. user cleans data) the key changes and we naturally re-parse.
    """
    key = _df_cache_key(ds)
    cached = _DF_CACHE.get(key)
    if cached is not None:
        # Return a copy so callers can mutate without poisoning the cache.
        return cached.copy()
    rows = _current_rows(ds, session)
    df = pd.DataFrame(rows) if rows else pd.DataFrame()
    _cache_put(_DF_CACHE, key, df)
    return df.copy()

def _current_rows(ds, session=None):
    """Return the row list for the active stage (or the original)."""
    if not ds.current_stage_id:
        return jload(ds.data) or []
    own = session is None
    s = session or db()
    try:
        stage = s.query(DatasetStage).filter_by(id=ds.current_stage_id).first()
        if not stage:
            return jload(ds.data) or []
        return jload(stage.data) or []
    finally:
        if own:
            s.close()

def _current_variables(ds, session=None):
    """Variables payload for the active stage (or original)."""
    if not ds.current_stage_id:
        return jload(ds.variables) or []
    own = session is None
    s = session or db()
    try:
        stage = s.query(DatasetStage).filter_by(id=ds.current_stage_id).first()
        if stage:
            return jload(stage.variables) or []
        return jload(ds.variables) or []
    finally:
        if own:
            s.close()

def _stage_count(ds_id, session):
    """How many persisted stages does this dataset have? (excludes original)"""
    return session.query(DatasetStage).filter_by(dataset_id=ds_id).count()

def _rows_for_stage(ds, stage_id, session):
    """Resolve a stage selector (None / 'current' / 'original' / uuid) to rows."""
    if not stage_id or stage_id == "current":
        return _current_rows(ds, session)
    if stage_id == "original":
        return jload(ds.data) or []
    stage = session.query(DatasetStage).filter_by(id=stage_id, dataset_id=ds.id).first()
    if not stage:
        return _current_rows(ds, session)
    return jload(stage.data) or []

def _variables_for_stage(ds, stage_id, session):
    if not stage_id or stage_id == "current":
        return _current_variables(ds, session)
    if stage_id == "original":
        return jload(ds.variables) or []
    stage = session.query(DatasetStage).filter_by(id=stage_id, dataset_id=ds.id).first()
    if stage:
        return jload(stage.variables) or []
    return _current_variables(ds, session)

def create_stage(session, ds, df, op_type, op_params, summary):
    """Persist a new stage produced by a transformation and mark it current.

    Re-infers variables from the resulting DataFrame so downstream pages
    pick up new dtypes / dropped columns automatically. Note: ds.variables
    stays at the *original* values; current variables are read via the stage.
    """
    variables = infer_variables(df)
    records = clean_json(df.where(pd.notnull(df), None).to_dict(orient="records"))
    parent_id = ds.current_stage_id  # may be None (original)
    stage = DatasetStage(
        id=str(uuid.uuid4()),
        dataset_id=ds.id,
        parent_stage_id=parent_id,
        step_index=_stage_count(ds.id, session) + 1,
        op_type=op_type,
        op_params=jdump(op_params),
        summary=summary,
        row_count=len(df),
        col_count=len(df.columns),
        variables=jdump(variables),
        data=jdump(records),
    )
    session.add(stage)
    ds.current_stage_id = stage.id
    ds.row_count = len(df)
    ds.col_count = len(df.columns)
    _df_cache_invalidate(ds.id)  # stage changed — drop cached DataFrames
    log_activity(
        session,
        ds.id,
        "stage",
        summary,
        detail={
            "category": "data_prep",
            "action_type": op_type,
            "op_type": op_type,
            "row_count": len(df),
            "col_count": len(df.columns),
            "params": clean_json(op_params),
        },
        ref_type="stage",
        ref_id=stage.id,
        commit=False,
    )
    session.commit()
    return stage

def infer_variables(df):
    """Produce variable metadata: name, dtype, missing, unique."""
    out = []
    for col in df.columns:
        series = df[col]
        missing = int(series.isna().sum())
        unique = series.nunique(dropna=True)
        # type inference
        if pd.api.types.is_numeric_dtype(series):
            if unique <= 2:
                dtype = "binary"
            elif pd.api.types.is_integer_dtype(series.dropna()):
                dtype = "int"
            else:
                non_null = series.dropna()
                dtype = "int" if len(non_null) and np.all(np.equal(np.mod(non_null, 1), 0)) else "float"
        elif pd.api.types.is_datetime64_any_dtype(series):
            dtype = "datetime"
        else:
            # try to detect dates stored as strings
            try:
                pd.to_datetime(series.dropna().head(20), errors="raise")
                dtype = "datetime"
            except Exception:
                dtype = "category" if unique <= 20 else "text"
        out.append({
            "name": col,
            "dtype": dtype,
            "missing": missing,
            "unique": int(unique),
        })
    return out

def _sheet_payload_from_df(df):
    df = df.copy()
    variables = infer_variables(df)
    records = clean_json(df.where(pd.notnull(df), None).to_dict(orient="records"))
    return {
        "row_count": int(len(df)),
        "col_count": int(len(df.columns)),
        "variables": variables,
        "data": records,
        "empty": bool(len(df) == 0 or len(df.columns) == 0),
    }

def _sheet_list(ds):
    payload = jload(getattr(ds, "sheets", None)) or {}
    if not isinstance(payload, dict) or not payload:
        return []
    return [
        {
            "name": name,
            "row_count": int((sheet or {}).get("row_count") or 0),
            "col_count": int((sheet or {}).get("col_count") or 0),
            "empty": bool((sheet or {}).get("empty")),
            "active": name == ds.active_sheet,
        }
        for name, sheet in payload.items()
    ]

def numeric_df(df, cols=None):
    """Select numeric columns (optionally filtered), drop non-numeric."""
    if cols:
        df = df[cols]
    return df.select_dtypes(include=[np.number])

def is_numeric_meta(v):
    return v.get("dtype") in ("numeric", "int", "float", "binary")

def _parse_num(value, default, cast):
    """Safely cast a user-supplied value; fall back to default on bad input."""
    if value is None:
        return default
    try:
        return cast(value)
    except (TypeError, ValueError):
        return default

def clean_json(obj):
    """Convert numpy/pandas types to JSON-safe primitives."""
    if isinstance(obj, dict):
        return {str(k): clean_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_json(x) for x in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return None if np.isnan(obj) else float(obj)
    if isinstance(obj, (np.ndarray,)):
        return clean_json(obj.tolist())
    if isinstance(obj, (pd.Timestamp, datetime)):
        return obj.isoformat()
    if pd.isna(obj) if np.isscalar(obj) else False:
        return None
    return obj

def friendly_error_message(err, fallback="The operation could not be completed. Check your inputs and try again."):
    text = str(err or "").strip()
    lower = text.lower()
    if "jsondecodeerror" in lower or "expecting value" in lower:
        return "The AI response could not be read. Using the built-in workflow instead."
    if "boolean subtract" in lower:
        return "The classification metrics could not be computed for this target. Try standardizing the target categories or choosing another target."
    if "traceback" in lower or "\n" in text or "sklearn" in lower or "numpy" in lower:
        return fallback
    return text or fallback

def log_activity(session, dataset_id, kind, summary, detail=None, ref_type=None, ref_id=None, commit=True, dedupe_key=None):
    detail = clean_json(detail or {})
    if dedupe_key:
        existing = session.query(ActivityLog).filter_by(dataset_id=dataset_id).all()
        for entry in reversed(existing):
            entry_detail = jload(entry.detail) or {}
            if entry_detail.get("dedupe_key") == dedupe_key:
                entry.summary = summary
                entry.detail = jdump({**entry_detail, **detail, "dedupe_key": dedupe_key, "repeat_count": int(entry_detail.get("repeat_count", 1)) + 1})
                entry.created_at = datetime.utcnow()
                if commit:
                    session.commit()
                return entry
        detail["dedupe_key"] = dedupe_key
    entry = ActivityLog(
        id=str(uuid.uuid4()),
        dataset_id=dataset_id,
        kind=kind,
        summary=summary,
        detail=jdump(detail),
        ref_type=ref_type,
        ref_id=ref_id,
    )
    session.add(entry)
    if commit:
        session.commit()
    return entry

def activity_payload(entry):
    detail = jload(entry.detail) or {}
    return {
        "id": entry.id,
        "dataset_id": entry.dataset_id,
        "kind": entry.kind,
        "category": detail.get("category") or entry.kind,
        "action_type": detail.get("action_type") or entry.kind,
        "summary": entry.summary,
        "detail": detail,
        "ref_type": entry.ref_type,
        "ref_id": entry.ref_id,
        "related_stage_id": entry.ref_id if entry.ref_type == "stage" else detail.get("related_stage_id"),
        "related_analysis_id": entry.ref_id if entry.ref_type == "analysis" else detail.get("related_analysis_id"),
        "related_model_id": entry.ref_id if entry.ref_type == "model" else detail.get("related_model_id"),
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
    }

# ========================================================================
#  AI assistant (Anthropic)
# ========================================================================
# We talk to Claude through the official SDK and rely on prompt caching for
# the dataset profile so repeat calls during a session are cheap. The key is
# read from ANTHROPIC_API_KEY at request time so the server still boots
# (and serves non-AI endpoints) when the key is unset.

_AI_MODEL_FAST = "claude-sonnet-4-6"
_AI_MODEL_DEEP = "claude-opus-4-7"

def _ai_client():
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return None
    try:
        import anthropic  # local import keeps optional dep optional
    except ImportError:
        return None
    return anthropic.Anthropic(api_key=key)

def _dataset_profile(ds, df, variables, max_unique=8):
    """Compact, deterministic dataset summary for AI prompts.

    Used as a cacheable prompt prefix so we're not paying for the whole row
    payload on every call. Only metadata + small samples — never the full
    dataset.
    """
    cols = []
    for v in variables or []:
        col = {
            "name": v["name"],
            "dtype": v.get("dtype"),
            "missing": v.get("missing"),
            "unique": v.get("unique"),
        }
        if v["name"] in df.columns:
            series = df[v["name"]]
            present = series.dropna()
            if v.get("dtype") in ("category", "binary") and len(present):
                vc = present.value_counts().head(max_unique)
                col["top_values"] = [
                    {"value": _ai_safe(k), "count": int(c)} for k, c in vc.items()
                ]
            elif v.get("dtype") in ("numeric", "int", "float", "binary") and len(present):
                num = pd.to_numeric(present, errors="coerce").dropna()
                if len(num):
                    col["min"] = float(num.min())
                    col["max"] = float(num.max())
                    col["mean"] = round(float(num.mean()), 4)
        cols.append(col)
    return {
        "name": ds.name,
        "description": ds.description,
        "filename": ds.filename,
        "row_count": int(len(df)),
        "col_count": int(len(df.columns)),
        "columns": cols,
    }

def _ai_safe(v):
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)

def ai_call(profile, user_prompt, system=None, model=_AI_MODEL_FAST, max_tokens=1024, json_mode=False):
    """Make an AI call with the dataset profile cached as a prompt prefix.

    Returns the text response (or a dict if json_mode=True). Raises a clear
    error when the SDK / key is missing so the route can surface 503.
    """
    client = _ai_client()
    if client is None:
        raise RuntimeError("AI assistant unavailable: set ANTHROPIC_API_KEY on the API service")

    sys_blocks = []
    if system:
        sys_blocks.append({"type": "text", "text": system})
    sys_blocks.append({
        "type": "text",
        "text": "Dataset profile (use as the source of truth):\n" + json.dumps(profile, default=str),
        "cache_control": {"type": "ephemeral"},
    })
    if json_mode:
        sys_blocks.append({
            "type": "text",
            "text": "Respond with a single JSON object only — no prose, no markdown fences.",
        })

    msg = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=sys_blocks,
        messages=[{"role": "user", "content": user_prompt}],
    )
    text = "".join(block.text for block in msg.content if getattr(block, "type", None) == "text")
    if json_mode:
        return _parse_ai_json(text)
    return text


def _parse_ai_json(text):
    """Extract a JSON object from a model response that may include code fences or prose."""
    s = (text or "").strip()
    # Strip ```json ... ``` or ``` ... ``` fences if the whole reply is fenced.
    if s.startswith("```"):
        s = re.sub(r"^```(?:json|JSON)?\s*\n?", "", s)
        s = re.sub(r"\n?```\s*$", "", s).strip()
    candidates = [s]
    start = s.find("{")
    end = s.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidates.append(s[start : end + 1])
    arr_start = s.find("[")
    arr_end = s.rfind("]")
    if arr_start != -1 and arr_end != -1 and arr_end > arr_start:
        candidates.append('{"steps": ' + s[arr_start : arr_end + 1] + "}")

    last_error = None
    for candidate in candidates:
        repaired = candidate.strip()
        repaired = repaired.replace("\u201c", '"').replace("\u201d", '"').replace("\u2018", "'").replace("\u2019", "'")
        repaired = re.sub(r",\s*([}\]])", r"\1", repaired)
        try:
            return json.loads(repaired)
        except Exception as exc:
            last_error = exc
    err = ValueError(f"AI returned invalid JSON: {last_error}")
    err.raw_response = text
    raise err


# ========================================================================
#  Routes
# ========================================================================

@app.route("/api/health")
def health():
    return {"status": "ok", "db_ready": _db_ready, "time": datetime.utcnow().isoformat()}

@app.before_request
def _schema_guard():
    """Lazy schema init. Skips health check so Render's probe stays fast."""
    if _db_ready or request.path == "/api/health":
        return None
    try:
        _ensure_schema()
    except OperationalError:
        return {"error": "database warming up, retry in a moment"}, 503
    return None

# --- Auth / sessions ---

@app.route("/api/auth/guest", methods=["POST"])
def create_guest_session():
    s = db()
    try:
        client_used = _client_guest_slot_used()
        sess, user = _auth_from_request(s)
        if sess:
            if sess.is_guest and client_used and int(sess.guest_usage_count or 0) < 1:
                sess.guest_usage_count = 1
                s.commit()
            return jsonify({"session": _session_payload(sess, user)})
        sess = UserSession(
            id=str(uuid.uuid4()),
            token=_new_token(),
            is_guest=1,
            guest_usage_count=1 if client_used else 0,
            expires_at=datetime.utcnow() + timedelta(days=14),
        )
        s.add(sess)
        s.commit()
        return jsonify({"session": _session_payload(sess)})
    finally:
        s.close()

@app.route("/api/auth/signup", methods=["POST"])
def signup():
    body = request.get_json() or {}
    full_name = (body.get("full_name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        return {"error": "enter a valid email address"}, 400
    if len(password) < 8:
        return {"error": "password must be at least 8 characters"}, 400
    s = db()
    try:
        existing = s.query(User).filter_by(email=email).first()
        if existing:
            return {"error": "email already registered"}, 409
        old_sess, _ = _auth_from_request(s)
        user = User(
            id=str(uuid.uuid4()),
            email=email,
            full_name=full_name or None,
            password_hash=generate_password_hash(password),
        )
        sess = UserSession(
            id=str(uuid.uuid4()),
            user_id=user.id,
            token=_new_token(),
            is_guest=0,
            guest_usage_count=0,
            expires_at=datetime.utcnow() + timedelta(days=30),
        )
        s.add(user)
        s.add(sess)
        # Guest work is claimed only when the user explicitly signs up from guest mode.
        _claim_guest_projects(s, old_sess, user.id)
        s.commit()
        return jsonify({"session": _session_payload(sess, user)})
    finally:
        s.close()

@app.route("/api/auth/login", methods=["POST"])
def login():
    body = request.get_json() or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    s = db()
    try:
        user = s.query(User).filter_by(email=email).first()
        if not user or not check_password_hash(user.password_hash, password):
            return {"error": "invalid email or password"}, 401
        sess = UserSession(
            id=str(uuid.uuid4()),
            user_id=user.id,
            token=_new_token(),
            is_guest=0,
            guest_usage_count=0,
            expires_at=datetime.utcnow() + timedelta(days=30),
        )
        s.add(sess)
        s.commit()
        return jsonify({"session": _session_payload(sess, user)})
    finally:
        s.close()

@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    s = db()
    try:
        sess, user = _auth_from_request(s)
        if not sess:
            return {"session": None}, 401
        return jsonify({"session": _session_payload(sess, user)})
    finally:
        s.close()

@app.route("/api/auth/logout", methods=["POST"])
def logout():
    s = db()
    try:
        sess, _ = _auth_from_request(s)
        if sess:
            s.delete(sess)
            s.commit()
        return {"ok": True}
    finally:
        s.close()

# --- Datasets ---

@app.route("/api/datasets", methods=["GET"])
def list_datasets():
    s = db()
    try:
        rows = _dataset_scope(s.query(Dataset), s).order_by(Dataset.created_at.desc()).all()
        return jsonify([{
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "filename": r.filename,
            "row_count": r.row_count,
            "col_count": r.col_count,
            "sheets": _sheet_list(r),
            "active_sheet": r.active_sheet,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows])
    finally:
        s.close()


def _validate_upload_file(f):
    """Run safety checks on an uploaded file before pandas parses it.

    Returns (ok: bool, error_message: str|None, kind: str|None) where kind is
    "csv" or "excel". Centralising these checks keeps upload_dataset readable.

    Checks performed:
      1. Filename has an allowed extension.
      2. Size is under MAX_UPLOAD_BYTES (this is also enforced by Flask via
         MAX_CONTENT_LENGTH, but we re-check here so we can return a clear
         JSON error instead of Flask's default HTML 413 page).
      3. Magic bytes match the extension. Catches the "renamed .exe to .csv"
         case where the extension lies about the contents.
    """
    name = (f.filename or "").lower()
    if name.endswith(".csv"):
        kind = "csv"
    elif name.endswith((".xlsx", ".xls")):
        kind = "excel"
    else:
        return False, "Unsupported file type. Please upload a .csv, .xlsx, or .xls file.", None

    # Measure size by seeking the underlying stream. We rewind so the parser
    # downstream still sees the file from byte 0.
    f.stream.seek(0, 2)             # 2 = seek from end
    size = f.stream.tell()
    f.stream.seek(0)
    if size > MAX_UPLOAD_BYTES:
        mb_limit = MAX_UPLOAD_BYTES // (1024 * 1024)
        mb_actual = round(size / (1024 * 1024), 1)
        return False, f"File is too large ({mb_actual} MB). Maximum allowed is {mb_limit} MB.", None
    if size == 0:
        return False, "File is empty.", None

    # Magic-byte sniff — read a few bytes, then rewind.
    head = f.stream.read(8)
    f.stream.seek(0)
    if kind == "excel":
        # XLSX is a zip archive — starts with PK\x03\x04. XLS is an OLE
        # compound document — starts with D0 CF 11 E0 A1 B1 1A E1.
        is_xlsx = head[:4] == b"PK\x03\x04"
        is_xls = head[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
        if not (is_xlsx or is_xls):
            return False, "File looks like it was renamed — the contents don't match an Excel file.", None
    else:
        # CSV has no magic number, but it should be valid UTF-8/ASCII text.
        # Reject anything with a NUL byte in the first chunk — clear sign of
        # a binary file pretending to be CSV.
        if b"\x00" in head:
            return False, "File looks like it was renamed — CSV files should be plain text.", None

    return True, None, kind


@app.route("/api/datasets/upload", methods=["POST"])
def upload_dataset():
    """Create a Dataset from either an uploaded file or an existing Dataset.

    Accepts multipart form data with one of:
      - file:           uploaded CSV/Excel file
      - from_dataset_id: id of an existing Dataset to clone the data from
    Optional fields: name, description.
    """
    name = request.form.get("name")
    description = (request.form.get("description") or "").strip() or None
    from_id = request.form.get("from_dataset_id")

    s = db()
    try:
        sess, _ = _auth_from_request(s)
        if sess and sess.is_guest:
            existing_count = _dataset_scope(s.query(Dataset), s).count()
            usage = int(sess.guest_usage_count or 0)
            if _client_guest_slot_used() and usage < 1:
                sess.guest_usage_count = 1
                usage = 1
            # Retroactively sync for sessions created before the usage counter existed
            if existing_count > usage:
                sess.guest_usage_count = existing_count
                usage = existing_count
            if usage >= 1 or existing_count >= 1:
                return {
                    "error": "Guest accounts can only upload 1 dataset. Sign up or log in to upload more.",
                    "auth_required": True,
                    "guest_limit": True,
                }, 403

        if from_id:
            src = _dataset_scope(s.query(Dataset), s).filter_by(id=from_id).first()
            if not src:
                return {"error": "source dataset not found"}, 404
            variables = jload(src.variables) or []
            records = jload(src.data) or []
            row_count = src.row_count
            col_count = src.col_count
            filename = src.filename
            final_name = name or src.name
            sheets = jload(getattr(src, "sheets", None))
            active_sheet = src.active_sheet
        else:
            if "file" not in request.files:
                return {"error": "no file"}, 400
            f = request.files["file"]

            # Pre-parse safety checks (size, type, magic bytes).
            ok, err, kind = _validate_upload_file(f)
            if not ok:
                return {"error": err}, 400

            sheets = None
            active_sheet = None
            try:
                if kind == "csv":
                    df = pd.read_csv(f)
                else:  # kind == "excel"
                    xls = pd.ExcelFile(f)
                    sheet_payload = {}
                    for sheet_name in xls.sheet_names:
                        sheet_df = pd.read_excel(xls, sheet_name=sheet_name)
                        sheet_payload[str(sheet_name)] = _sheet_payload_from_df(sheet_df)
                    if not sheet_payload:
                        return {"error": "workbook has no sheets"}, 400
                    active_sheet = str(xls.sheet_names[0])
                    sheets = sheet_payload
                    df = pd.DataFrame(sheet_payload[active_sheet]["data"])
            except Exception as e:
                # Don't leak the raw pandas exception to the client — it's noisy
                # and can expose internals. Log it and return a friendly message.
                print(f"upload parse failed: {e}", flush=True)
                return {"error": "Could not read the file. Please check it isn't corrupted."}, 400

            # Post-parse safety check: refuse pathologically large datasets.
            if len(df) > MAX_UPLOAD_ROWS:
                return {
                    "error": f"Dataset has {len(df):,} rows — maximum is {MAX_UPLOAD_ROWS:,}.",
                }, 400

            variables = infer_variables(df)
            records = clean_json(df.where(pd.notnull(df), None).to_dict(orient="records"))
            row_count = len(df)
            col_count = len(df.columns)
            filename = f.filename
            final_name = name or f.filename

        ds_id = str(uuid.uuid4())
        ds = Dataset(
            id=ds_id,
            name=final_name,
            description=description,
            filename=filename,
            row_count=row_count,
            col_count=col_count,
            variables=jdump(variables),
            data=jdump(records),
            sheets=jdump(sheets) if sheets else None,
            active_sheet=active_sheet,
        )
        _attach_owner(ds, s)
        s.add(ds)
        log_activity(
            s,
            ds_id,
            "upload" if not from_id else "clone",
            f"Created project '{final_name}' with {row_count} rows and {col_count} columns",
            detail={"category": "data_prep", "action_type": "upload" if not from_id else "clone", "filename": filename, "source_dataset_id": from_id, "sheet": active_sheet, "sheets": list((sheets or {}).keys())},
            ref_type="dataset",
            ref_id=ds_id,
            commit=False,
        )
        if active_sheet:
            log_activity(
                s,
                ds_id,
                "stage",
                f"Selected sheet '{active_sheet}'",
                detail={"category": "data_prep", "action_type": "select_sheet", "sheet": active_sheet},
                ref_type="dataset",
                ref_id=ds_id,
                commit=False,
                dedupe_key=f"sheet:{ds_id}:{active_sheet}",
            )
        # Consume one guest slot (persists even if project is later deleted)
        if sess and sess.is_guest:
            sess.guest_usage_count = int(sess.guest_usage_count or 0) + 1
        s.commit()
        return {
            "id": ds_id,
            "name": final_name,
            "description": description,
            "row_count": row_count,
            "col_count": col_count,
            "variables": variables,
            "sheets": _sheet_list(ds),
            "active_sheet": active_sheet,
            "usage_count": int(sess.guest_usage_count) if sess and sess.is_guest else None,
        }
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>", methods=["GET"])
def get_dataset(ds_id):
    """Returns dataset metadata + variables for the active stage."""
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        live_vars = infer_variables(pd.DataFrame(_current_rows(ds, s)))
        return {
            "id": ds.id,
            "name": ds.name,
            "description": ds.description,
            "filename": ds.filename,
            "row_count": ds.row_count,
            "col_count": ds.col_count,
            "variables": live_vars,
            "current_stage_id": ds.current_stage_id,
            "sheets": _sheet_list(ds),
            "active_sheet": ds.active_sheet,
            "created_at": ds.created_at.isoformat() if ds.created_at else None,
        }
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/sheet", methods=["POST"])
def select_dataset_sheet(ds_id):
    body = request.get_json() or {}
    sheet_name = str(body.get("sheet") or "").strip()
    if not sheet_name:
        return {"error": "sheet is required"}, 400
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        sheets = jload(ds.sheets) or {}
        if not sheets:
            return {"error": "this dataset has no alternate sheets"}, 400
        if sheet_name not in sheets:
            return {"error": f"sheet '{sheet_name}' not found"}, 404
        payload = sheets[sheet_name] or {}
        records = payload.get("data") or []
        variables = payload.get("variables") or infer_variables(pd.DataFrame(records))
        ds.active_sheet = sheet_name
        ds.data = jdump(records)
        ds.variables = jdump(variables)
        ds.row_count = int(payload.get("row_count") or len(records))
        ds.col_count = int(payload.get("col_count") or (len(pd.DataFrame(records).columns) if records else 0))
        ds.current_stage_id = None
        _df_cache_invalidate(ds_id)  # data swapped — invalidate cache
        log_activity(
            s,
            ds_id,
            "stage",
            f"Selected sheet '{sheet_name}'",
            detail={
                "category": "data_prep",
                "action_type": "select_sheet",
                "sheet": sheet_name,
                "row_count": ds.row_count,
                "col_count": ds.col_count,
                "empty": bool(payload.get("empty")),
            },
            ref_type="dataset",
            ref_id=ds_id,
            commit=False,
            dedupe_key=f"sheet:{ds_id}:{sheet_name}",
        )
        s.commit()
        return jsonify(clean_json({
            "ok": True,
            "id": ds.id,
            "name": ds.name,
            "description": ds.description,
            "filename": ds.filename,
            "row_count": ds.row_count,
            "col_count": ds.col_count,
            "variables": variables,
            "current_stage_id": ds.current_stage_id,
            "sheets": _sheet_list(ds),
            "active_sheet": ds.active_sheet,
        }))
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>", methods=["DELETE"])
def delete_dataset(ds_id):
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        deleted = {
            "stages": s.query(DatasetStage).filter_by(dataset_id=ds_id).delete(synchronize_session=False),
            "analyses": s.query(Analysis).filter_by(dataset_id=ds_id).delete(synchronize_session=False),
            "models": s.query(Model).filter_by(dataset_id=ds_id).delete(synchronize_session=False),
            "activity": s.query(ActivityLog).filter_by(dataset_id=ds_id).delete(synchronize_session=False),
        }
        name = ds.name
        filename = ds.filename
        s.delete(ds)
        s.commit()
        _df_cache_invalidate(ds_id)  # dataset gone — free cached DataFrames
        return jsonify({"ok": True, "id": ds_id, "name": name, "filename": filename, "deleted": deleted})
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/rows", methods=["GET"])
def get_rows(ds_id):
    """Paginated row data for the Excel-like grid.

    Optional ?stage_id=original|<uuid> selects a specific stage.
    """
    page = max(_parse_num(request.args.get("page"), 1, int), 1)
    page_size = min(max(_parse_num(request.args.get("page_size"), 100, int), 1), 1000)
    stage_id = request.args.get("stage_id")
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        rows = _rows_for_stage(ds, stage_id, s)
        start = (page - 1) * page_size
        end = start + page_size
        page_rows = []
        for idx, row in enumerate(rows[start:end], start=start):
            out = dict(row)
            out["__row_index"] = idx
            page_rows.append(out)
        return {
            "rows": page_rows,
            "page": page,
            "page_size": page_size,
            "total": len(rows),
            "stage_id": stage_id or ds.current_stage_id or "original",
        }
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/cell", methods=["PATCH"])
def update_cell(ds_id):
    body = request.get_json() or {}
    row_index = body.get("row_index")
    column = body.get("column")
    value = body.get("value")
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        rows = _current_rows(ds, s)
        try:
            row_index = int(row_index)
        except (TypeError, ValueError):
            return {"error": "row_index must be an integer"}, 400
        if row_index < 0 or row_index >= len(rows):
            return {"error": "row_index out of range"}, 400
        if not column or column not in (rows[row_index] or {}):
            return {"error": "bad column"}, 400

        df = df_from_dataset(ds, s)
        old_value, new_value, error = _apply_cell_edit(df, row_index, column, value)
        if error:
            return {"error": error}, 400

        summary = f"Edited row {row_index + 1}, '{column}' from {old_value!r} to {new_value!r}"
        stage = create_stage(
            s,
            ds,
            df,
            op_type="cell_edit",
            op_params={"row_index": row_index, "column": column, "old_value": clean_json(old_value), "value": clean_json(new_value)},
            summary=summary,
        )
        return jsonify({"ok": True, "stage_id": stage.id, "summary": summary})
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/cells", methods=["PATCH"])
def update_cells(ds_id):
    body = request.get_json() or {}
    edits = body.get("edits") or []
    if not isinstance(edits, list) or not edits:
        return {"error": "edits must be a non-empty list"}, 400

    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        rows = _current_rows(ds, s)
        df = df_from_dataset(ds, s)
        applied = []

        for edit in edits:
            row_index = edit.get("row_index")
            column = edit.get("column")
            value = edit.get("value")
            try:
                row_index = int(row_index)
            except (TypeError, ValueError):
                return {"error": "row_index must be an integer"}, 400
            if row_index < 0 or row_index >= len(rows):
                return {"error": "row_index out of range"}, 400
            if not column or column not in (rows[row_index] or {}):
                return {"error": "bad column"}, 400

            old_value, new_value, error = _apply_cell_edit(df, row_index, column, value)
            if error:
                return {"error": error}, 400
            if clean_json(old_value) != clean_json(new_value):
                applied.append({
                    "row_index": row_index,
                    "column": column,
                    "old_value": clean_json(old_value),
                    "value": clean_json(new_value),
                })

        if not applied:
            return jsonify({"ok": True, "stage_id": ds.current_stage_id, "summary": "No cell changes to save"})

        summary = f"Edited {len(applied)} cell{'s' if len(applied) != 1 else ''}"
        stage = create_stage(
            s,
            ds,
            df,
            op_type="cell_edit",
            op_params={"edits": applied},
            summary=summary,
        )
        return jsonify({"ok": True, "stage_id": stage.id, "summary": summary, "edits": applied})
    finally:
        s.close()

def _apply_cell_edit(df, row_index, column, value):
    if column not in df.columns:
        return None, None, "bad column"
    old_value = df.at[row_index, column] if row_index in df.index else None
    new_value = None if value == "" else value
    if new_value is not None:
        series = df[column]
        if pd.api.types.is_numeric_dtype(series):
            try:
                number = float(new_value)
                new_value = int(number) if number.is_integer() else number
            except (TypeError, ValueError):
                return old_value, None, f"'{column}' expects a numeric value"
        elif pd.api.types.is_bool_dtype(series):
            new_value = str(new_value).strip().lower() in ("1", "true", "yes", "y")
    df.at[row_index, column] = new_value
    return old_value, new_value, None

_CATEGORY_ABBREVIATIONS = {
    "hs": "high school",
    "h.s.": "high school",
    "grad": "graduate",
    "post grad": "postgrad",
    "post graduate": "postgrad",
    "postgraduate": "postgrad",
    "coll": "college",
    "uni": "university",
    "lo": "low",
    "hi": "high",
    "mid": "middle",
    "med": "middle",
    "y": "yes",
    "n": "no",
}

_YES_VALUES = {"1", "1.0", "yes", "y", "true", "t", "graduated", "passed", "pass"}
_NO_VALUES = {"0", "0.0", "no", "n", "false", "f"}

def _normalize_category_value(value):
    if value is None or pd.isna(value):
        return None
    text = str(value).strip().lower()
    text = re.sub(r"\s+", " ", text)
    for old, new in _CATEGORY_ABBREVIATIONS.items():
        text = re.sub(rf"\b{re.escape(old)}\b", new, text)
    return re.sub(r"\s+", " ", text).strip()

def _binary_category_groups(values, column_name=""):
    yes_values = []
    no_values = []
    unknown = []
    has_numeric_token = False
    has_text_token = False
    for value in values:
        text = str(value).strip()
        norm = _normalize_category_value(value)
        if norm in _YES_VALUES:
            yes_values.append(text)
            has_numeric_token = has_numeric_token or norm in {"1", "1.0"}
            has_text_token = has_text_token or norm not in {"1", "1.0"}
        elif norm in _NO_VALUES:
            no_values.append(text)
            has_numeric_token = has_numeric_token or norm in {"0", "0.0"}
            has_text_token = has_text_token or norm not in {"0", "0.0"}
        else:
            unknown.append(text)

    if not yes_values or not no_values:
        return []
    booleanish_name = bool(re.search(r"(^has_|^is_|^can_|^will_|_flag$|_status$)", str(column_name).lower()))
    mixed_binary = has_numeric_token and has_text_token
    if unknown and not (mixed_binary or booleanish_name):
        return []

    groups = []
    if len(set(yes_values)) > 1 or any(v != "Yes" for v in yes_values):
        groups.append({
            "values": sorted(set(yes_values)),
            "normalized_values": ["yes"],
            "suggested_label": "Yes",
            "reason": "Detected mixed binary values that represent Yes.",
            "kind": "binary",
        })
    if len(set(no_values)) > 1 or any(v != "No" for v in no_values):
        groups.append({
            "values": sorted(set(no_values)),
            "normalized_values": ["no"],
            "suggested_label": "No",
            "reason": "Detected mixed binary values that represent No.",
            "kind": "binary",
        })
    return groups

def _title_category_label(text):
    if not text:
        return ""
    small = {"of", "and", "or", "the"}
    return " ".join(part if part in small else part[:1].upper() + part[1:] for part in str(text).split())

def _category_groups(values, column_name="", threshold=0.88):
    binary_groups = _binary_category_groups(values, column_name)
    normalized = {}
    for value in values:
        norm = _normalize_category_value(value)
        if not norm:
            continue
        normalized.setdefault(norm, set()).add(str(value))

    groups = []
    used = set()
    norms = list(normalized.keys())
    for norm in norms:
        if norm in used:
            continue
        group_norms = [norm]
        used.add(norm)
        for other in norms:
            if other in used:
                continue
            if SequenceMatcher(None, norm, other).ratio() >= threshold:
                group_norms.append(other)
                used.add(other)
        originals = sorted({raw for n in group_norms for raw in normalized[n]})
        if len(originals) > 1 or any(raw != _title_category_label(norm) for raw in originals):
            label_source = min(group_norms, key=len) if len(group_norms) > 1 else group_norms[0]
            groups.append({
                "values": originals,
                "normalized_values": group_norms,
                "suggested_label": _title_category_label(label_source),
                "reason": "Rule-based normalization and fuzzy matching found similar category labels.",
            })

    merged = []
    seen = set()
    for group in binary_groups + groups:
        key = tuple(sorted(group.get("values") or []))
        if key in seen:
            continue
        seen.add(key)
        merged.append(group)
    return merged

@app.route("/api/datasets/<ds_id>/categories/suggestions", methods=["GET"])
def category_suggestions(ds_id):
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)
        variables = infer_variables(df)
        suggestions = []
        for var in variables:
            if var.get("dtype") not in ("category", "binary"):
                continue
            col = var["name"]
            counts = df[col].dropna().astype(str).value_counts()
            uniques = counts.index.tolist()
            if len(uniques) < 2 or len(uniques) > 120:
                continue
            groups = _category_groups(uniques, col)
            if groups:
                suggestions.append({
                    "column": col,
                    "unique_count": len(uniques),
                    "unique_values": [
                        {"value": str(value), "count": int(count)}
                        for value, count in counts.items()
                    ],
                    "groups": groups,
                })
        return jsonify({"suggestions": suggestions})
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/categories/apply", methods=["POST"])
def apply_category_standardization(ds_id):
    body = request.get_json() or {}
    column = body.get("column")
    mapping = body.get("mapping") or {}
    if not column or not isinstance(mapping, dict) or not mapping:
        return {"error": "column and mapping are required"}, 400
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)
        if column not in df.columns:
            return {"error": "column not found"}, 404
        before_unique = int(df[column].nunique(dropna=True))
        df[column] = df[column].map(lambda value: mapping.get(str(value), value) if not pd.isna(value) else value)
        after_unique = int(df[column].nunique(dropna=True))
        changed = int(sum(1 for old, new in mapping.items() if str(old) != str(new)))
        summary = f"Standardized categories in '{column}' ({before_unique} to {after_unique} unique labels)"
        stage = create_stage(
            s,
            ds,
            df,
            op_type="category_standardization",
            op_params={"column": column, "mapping": mapping},
            summary=summary,
        )
        # create_stage already logs the stage; enrich the same entry with report-ready mapping.
        entry = s.query(ActivityLog).filter_by(ref_type="stage", ref_id=stage.id).first()
        if entry:
            detail = jload(entry.detail) or {}
            detail.update({
                "category": "data_prep",
                "action_type": "category_standardization",
                "step_type": "Data Prep",
                "column": column,
                "mapping": mapping,
                "changed_labels": changed,
                "before_unique": before_unique,
                "after_unique": after_unique,
            })
            entry.detail = jdump(clean_json(detail))
            s.commit()
        return jsonify({"ok": True, "stage_id": stage.id, "summary": summary})
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/activity", methods=["GET"])
def list_activity(ds_id):
    order = (request.args.get("order") or "desc").lower()
    s = db()
    try:
        q = s.query(ActivityLog).filter_by(dataset_id=ds_id)
        q = q.order_by(ActivityLog.created_at.asc() if order == "asc" else ActivityLog.created_at.desc())
        hidden = {"ai", "note"}
        return jsonify({"activity": [activity_payload(a) for a in q.all() if a.kind not in hidden and (jload(a.detail) or {}).get("category") != "ai"]})
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/activity", methods=["POST"])
def create_activity_note(ds_id):
    body = request.get_json() or {}
    summary = (body.get("summary") or "").strip()
    if not summary:
        return {"error": "summary is required"}, 400
    activity_id = body.get("activity_id")
    related_stage_id = body.get("related_stage_id")
    related_analysis_id = body.get("related_analysis_id")
    related_model_id = body.get("related_model_id")
    ref_type = None
    ref_id = None
    if related_stage_id:
        ref_type, ref_id = "stage", related_stage_id
    elif related_analysis_id:
        ref_type, ref_id = "analysis", related_analysis_id
    elif related_model_id:
        ref_type, ref_id = "model", related_model_id
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        if activity_id:
            entry = s.query(ActivityLog).filter_by(id=activity_id, dataset_id=ds_id).first()
            if not entry:
                return {"error": "activity not found"}, 404
            detail = jload(entry.detail) or {}
            notes = [] if body.get("replace") else (detail.get("notes") or [])
            notes.append({"id": str(uuid.uuid4()), "text": summary, "created_at": datetime.utcnow().isoformat()})
            detail["notes"] = notes
            entry.detail = jdump(clean_json(detail))
            s.commit()
            return jsonify(activity_payload(entry))
        entry = log_activity(
            s,
            ds_id,
            "note",
            summary,
            detail={
                "category": "note",
                "action_type": "manual_note",
                "body": body.get("body") or summary,
                "related_stage_id": related_stage_id,
                "related_analysis_id": related_analysis_id,
                "related_model_id": related_model_id,
            },
            ref_type=ref_type,
            ref_id=ref_id,
        )
        return jsonify(activity_payload(entry))
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/activity/<activity_id>", methods=["DELETE"])
def delete_or_undo_activity(ds_id, activity_id):
    """Remove a documentation entry. If it is the current data-stage step, undo by restoring its parent stage first."""
    reverse = str(request.args.get("reverse", "false")).lower() == "true"
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        entry = s.query(ActivityLog).filter_by(id=activity_id, dataset_id=ds_id).first()
        if not entry:
            return {"error": "activity not found"}, 404
        detail = jload(entry.detail) or {}
        stage_id = entry.ref_id if entry.ref_type == "stage" else detail.get("related_stage_id")
        model_id = entry.ref_id if entry.ref_type == "model" else detail.get("related_model_id")
        analysis_id = entry.ref_id if entry.ref_type == "analysis" else detail.get("related_analysis_id")
        restored_to = None
        if reverse and stage_id and stage_id != "original":
            stage = s.query(DatasetStage).filter_by(id=stage_id, dataset_id=ds_id).first()
            if not stage:
                return {"error": "stage not found"}, 404
            if ds.current_stage_id != stage_id:
                return {
                    "error": "Only the current data step can be undone directly. View or restore this stage first if you want to move the dataset to that state.",
                }, 400
            parent_id = stage.parent_stage_id or "original"
            if parent_id == "original":
                rows = jload(ds.data) or []
                df = pd.DataFrame(rows)
                ds.current_stage_id = None
                ds.row_count = len(df)
                ds.col_count = len(df.columns)
            else:
                parent = s.query(DatasetStage).filter_by(id=parent_id, dataset_id=ds_id).first()
                if not parent:
                    return {"error": "parent stage not found"}, 404
                ds.current_stage_id = parent.id
                ds.variables = parent.variables
                ds.row_count = parent.row_count
                ds.col_count = parent.col_count
            _df_cache_invalidate(ds_id)  # restored to a different stage
            restored_to = parent_id
            log_activity(
                s,
                ds_id,
                "restore",
                f"Undid step: {entry.summary}",
                detail={"category": "data_prep", "action_type": "undo_step", "undone_activity_id": activity_id, "undone_stage_id": stage_id, "restored_to": restored_to},
                ref_type="stage",
                ref_id=restored_to,
                commit=False,
            )
        elif reverse and model_id:
            model = s.query(Model).filter_by(id=model_id, dataset_id=ds_id).first()
            if model:
                s.delete(model)
            restored_to = "model_deleted"
        elif reverse and analysis_id:
            analysis = s.query(Analysis).filter_by(id=analysis_id, dataset_id=ds_id).first()
            if analysis:
                s.delete(analysis)
            restored_to = "analysis_deleted"
        elif reverse and entry.kind in {"report", "whatif"}:
            restored_to = "log_only"
        s.delete(entry)
        s.commit()
        return jsonify({"ok": True, "restored_to": restored_to})
    finally:
        s.close()

# --- Stages (data versioning) ---

@app.route("/api/datasets/<ds_id>/stages", methods=["GET"])
def list_stages(ds_id):
    """Return all stages plus the implicit 'original' so the UI can render
    a timeline. The frontend marks the current stage by id."""
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        stages = (
            s.query(DatasetStage)
            .filter_by(dataset_id=ds_id)
            .order_by(DatasetStage.step_index)
            .all()
        )
        original = {
            "id": "original",
            "step_index": 0,
            "op_type": "upload",
            "summary": f"Original upload — {ds.row_count} rows · {ds.col_count} columns",
            "row_count": ds.row_count if not stages else jload(ds.data).__len__() if ds.data else 0,
            "col_count": ds.col_count if not stages else (len(jload(ds.variables) or []) if ds.variables else 0),
            "created_at": ds.created_at.isoformat() if ds.created_at else None,
        }
        # the row_count/col_count for original should reflect the upload, not current
        if stages:
            orig_rows = jload(ds.data) or []
            original["row_count"] = len(orig_rows)
            original["col_count"] = len(orig_rows[0]) if orig_rows else 0
        return {
            "current_stage_id": ds.current_stage_id or "original",
            "stages": [original] + [
                {
                    "id": st.id,
                    "step_index": st.step_index,
                    "op_type": st.op_type,
                    "op_params": jload(st.op_params),
                    "summary": st.summary,
                    "row_count": st.row_count,
                    "col_count": st.col_count,
                    "created_at": st.created_at.isoformat() if st.created_at else None,
                }
                for st in stages
            ],
        }
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/stages/<stage_id>/restore", methods=["POST"])
def restore_stage(ds_id, stage_id):
    """Set a previous stage as the current one (revert)."""
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        removed_stage_ids = []
        if stage_id == "original":
            ds.current_stage_id = None
            rows = jload(ds.data) or []
            ds.row_count = len(rows)
            ds.col_count = len(rows[0]) if rows else 0
            removed_stage_ids = [
                st.id for st in s.query(DatasetStage).filter_by(dataset_id=ds_id).all()
            ]
        else:
            stage = s.query(DatasetStage).filter_by(id=stage_id, dataset_id=ds_id).first()
            if not stage:
                return {"error": "stage not found"}, 404
            ds.current_stage_id = stage.id
            ds.row_count = stage.row_count
            ds.col_count = stage.col_count
            removed_stage_ids = [
                st.id for st in s.query(DatasetStage)
                .filter(DatasetStage.dataset_id == ds_id, DatasetStage.step_index > stage.step_index)
                .all()
            ]
        _df_cache_invalidate(ds_id)  # stage reverted — drop cached DataFrames
        if removed_stage_ids:
            s.query(DatasetStage).filter(DatasetStage.id.in_(removed_stage_ids)).delete(synchronize_session=False)
            s.query(ActivityLog).filter(
                ActivityLog.dataset_id == ds_id,
                ActivityLog.ref_type == "stage",
                ActivityLog.ref_id.in_(removed_stage_ids),
            ).delete(synchronize_session=False)
        log_activity(
            s,
            ds_id,
            "restore",
            f"Restored {'original upload' if stage_id == 'original' else 'stage ' + stage_id[:8]}",
            detail={
                "category": "data_prep",
                "action_type": "restore",
                "stage_id": stage_id,
                "removed_future_steps": len(removed_stage_ids),
            },
            ref_type="stage",
            ref_id=stage_id,
            commit=False,
        )
        s.commit()
        return {"ok": True, "current_stage_id": ds.current_stage_id or "original"}
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/reset", methods=["POST"])
def reset_project(ds_id):
    """Reset a project to its original uploaded state, removing all derived data."""
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404

        # Delete all stages
        s.query(DatasetStage).filter_by(dataset_id=ds_id).delete()
        # Delete all models
        s.query(Model).filter_by(dataset_id=ds_id).delete()
        # Delete all analyses
        s.query(Analysis).filter_by(dataset_id=ds_id).delete()
        # Delete all activity logs
        s.query(ActivityLog).filter_by(dataset_id=ds_id).delete()

        # Revert dataset to original upload state
        ds.current_stage_id = None
        rows = jload(ds.data) or []
        ds.row_count = len(rows)
        ds.col_count = len(rows[0]) if rows else 0
        _df_cache_invalidate(ds_id)  # project reset — drop cached DataFrames

        # Single log entry recording the reset
        log_activity(
            s,
            ds_id,
            "restore",
            "Project reset to initial state",
            detail={"category": "data_prep", "action_type": "reset"},
            commit=False,
        )
        s.commit()
        return {"ok": True}
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/export.csv", methods=["GET"])
def export_csv(ds_id):
    """Stream the active stage (or any stage selected via ?stage_id=) as CSV."""
    from flask import Response
    stage_id = request.args.get("stage_id")
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        rows = _rows_for_stage(ds, stage_id, s)
        if not rows:
            df = pd.DataFrame()
        else:
            df = pd.DataFrame(rows)
        buf = df.to_csv(index=False)
        suffix = stage_id or ds.current_stage_id or "original"
        suffix_label = "original" if suffix == "original" else f"stage-{suffix[:8]}"
        safe_name = "".join(c if c.isalnum() or c in "-_." else "_" for c in (ds.name or "dataset"))
        fname = f"{safe_name}__{suffix_label}.csv"
        return Response(
            buf,
            mimetype="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )
    finally:
        s.close()


@app.route("/api/datasets/<ds_id>/columns/<col_name>/values", methods=["GET"])
def get_column_values(ds_id, col_name):
    """Paginated single-column entries with their row index."""
    page = max(_parse_num(request.args.get("page"), 1, int), 1)
    page_size = min(max(_parse_num(request.args.get("page_size"), 200, int), 1), 1000)
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        rows = _current_rows(ds, s)
        if rows and col_name not in rows[0]:
            return {"error": "column not found"}, 404
        start = (page - 1) * page_size
        end = start + page_size
        slice_ = rows[start:end]
        values = [
            {"row": start + i + 1, "value": r.get(col_name)}
            for i, r in enumerate(slice_)
        ]
        return {
            "column": col_name,
            "values": values,
            "page": page,
            "page_size": page_size,
            "total": len(rows),
        }
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/variables/<var_name>", methods=["PATCH"])
def update_variable(ds_id, var_name):
    """Update variable dtype."""
    body = request.get_json() or {}
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        variables = jload(ds.variables) or []
        for v in variables:
            if v["name"] == var_name:
                if "dtype" in body:
                    v["dtype"] = body["dtype"]
                break
        ds.variables = jdump(variables)
        s.commit()
        return {"ok": True, "variables": variables}
    finally:
        s.close()

# --- Cleaning ---

@app.route("/api/datasets/<ds_id>/columns/<col_name>/stats", methods=["GET"])
def column_stats(ds_id, col_name):
    """Per-column profiling stats: dtype, missing, errors, zeros, value counts, etc."""
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds)
        if col_name not in df.columns:
            return {"error": "column not found"}, 404

        variables = jload(ds.variables) or []
        var = next((v for v in variables if v["name"] == col_name), None)
        dtype = var["dtype"] if var else "text"

        series = df[col_name]
        total = int(len(series))
        missing = int(series.isna().sum())
        present = series.dropna()
        unique = int(present.nunique())

        out = {
            "name": col_name,
            "dtype": dtype,
            "total_rows": total,
            "missing": missing,
            "missing_pct": round(missing / total * 100, 2) if total else 0,
            "present": int(len(present)),
            "unique": unique,
        }

        # type-error count: values that don't match the declared dtype
        type_errors = 0
        if dtype in ("numeric", "int", "float", "binary"):
            coerced = pd.to_numeric(present, errors="coerce")
            type_errors = int(coerced.isna().sum())
        elif dtype == "datetime":
            coerced = pd.to_datetime(present, errors="coerce")
            type_errors = int(coerced.isna().sum())
        out["type_errors"] = type_errors

        if dtype in ("numeric", "int", "float", "binary"):
            num = pd.to_numeric(present, errors="coerce").dropna()
            zeros = int((num == 0).sum())
            out["zero_count"] = zeros
            out["zero_pct"] = round(zeros / total * 100, 2) if total else 0
            out["negative_count"] = int((num < 0).sum())
            if len(num):
                out["min"] = float(num.min())
                out["max"] = float(num.max())
                out["mean"] = float(num.mean())
                out["median"] = float(num.median())
                out["std"] = float(num.std()) if len(num) > 1 else 0.0
            if dtype == "binary" or unique <= 10:
                vc = num.value_counts().head(10)
                out["value_counts"] = [
                    {"value": _json_safe(k), "count": int(v), "pct": round(int(v) / total * 100, 2)}
                    for k, v in vc.items()
                ]

        elif dtype in ("category", "text"):
            empty_strings = int((present.astype(str).str.strip() == "").sum())
            out["empty_string_count"] = empty_strings
            vc = present.value_counts().head(20)
            out["value_counts"] = [
                {"value": _json_safe(k), "count": int(v), "pct": round(int(v) / total * 100, 2)}
                for k, v in vc.items()
            ]
            lens = present.astype(str).str.len()
            if len(lens):
                out["min_length"] = int(lens.min())
                out["max_length"] = int(lens.max())
                out["avg_length"] = round(float(lens.mean()), 1)

        elif dtype == "datetime":
            parsed = pd.to_datetime(present, errors="coerce").dropna()
            if len(parsed):
                out["min"] = parsed.min().isoformat()
                out["max"] = parsed.max().isoformat()

        return out
    finally:
        s.close()


def _json_safe(v):
    """Convert a pandas/numpy scalar into a JSON-serializable value."""
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        f = float(v)
        if f.is_integer():
            return int(f)
        return round(f, 4)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)


@app.route("/api/datasets/<ds_id>/clean/suggestions", methods=["GET"])
def clean_suggestions(ds_id):
    """AI-style suggestions: missing, outliers, type issues, engineering."""
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds)
        suggestions = []

        # missing values
        for col in df.columns:
            miss = int(df[col].isna().sum())
            if miss > 0:
                is_numeric = pd.api.types.is_numeric_dtype(df[col])
                recommended_action = "impute_mode"
                recommended_reason = "Categorical blanks should use the most common label, not a numeric average."
                skew = None
                outlier_count = 0
                if is_numeric:
                    recommended_action = "impute_mean"
                    recommended_reason = "Numeric blanks can use the mean when the distribution is not strongly skewed."
                    numeric = pd.to_numeric(df[col], errors="coerce").dropna()
                    if len(numeric) > 2:
                        skew = float(numeric.skew())
                    if len(numeric) >= 10:
                        q1, q3 = numeric.quantile([0.25, 0.75])
                        iqr = q3 - q1
                        if iqr:
                            outlier_count = int(((numeric < q1 - 1.5 * iqr) | (numeric > q3 + 1.5 * iqr)).sum())
                    if (skew is not None and abs(skew) >= 1) or outlier_count > 0:
                        recommended_action = "impute_median"
                        recommended_reason = "Median is safer because the column is skewed or has outliers."
                if miss / max(len(df), 1) >= 0.25:
                    recommended_reason += " Missingness is high, so review before applying."
                options = [
                    {
                        "action": "impute_mean",
                        "label": "Fill with mean",
                        "description": "Replace blanks with the column average.",
                    },
                    {
                        "action": "impute_median",
                        "label": "Fill with median",
                        "description": "Replace blanks with the middle value; more robust to outliers.",
                    },
                ] if is_numeric else [
                    {
                        "action": "impute_mode",
                        "label": "Fill with most common",
                        "description": "Replace blanks with the most frequent value.",
                    },
                ]
                options.append({
                    "action": "drop_rows",
                    "label": "Drop missing rows",
                    "description": "Remove rows where this variable is blank.",
                })
                suggestions.append({
                    "id": str(uuid.uuid4()),
                    "kind": "missing",
                    "variable": col,
                    "count": miss,
                    "action": recommended_action,
                    "recommended_action": recommended_action,
                    "recommended_reason": recommended_reason,
                    "skew": skew,
                    "outlier_count": outlier_count,
                    "options": options,
                    "description": f"{miss} rows blank · impute with {'mean' if pd.api.types.is_numeric_dtype(df[col]) else 'mode'} or drop?",
                })

        # outliers (numeric columns, IQR rule)
        for col in df.select_dtypes(include=[np.number]).columns:
            series = df[col].dropna()
            if len(series) < 10:
                continue
            q1, q3 = series.quantile([0.25, 0.75])
            iqr = q3 - q1
            lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            outliers = int(((series < lo) | (series > hi)).sum())
            if outliers > 0:
                suggestions.append({
                    "id": str(uuid.uuid4()),
                    "kind": "outliers",
                    "variable": col,
                    "count": outliers,
                    "action": "winsorize",
                    "recommended_action": "winsorize",
                    "recommended_reason": "Cap to IQR bounds by default so rows stay available while extreme values are limited.",
                    "lower_bound": float(lo),
                    "upper_bound": float(hi),
                    "options": [
                        {
                            "action": "winsorize",
                            "label": "Cap to IQR bounds",
                            "description": "Clamp extreme values to the lower/upper IQR thresholds.",
                        },
                        {
                            "action": "drop_outliers",
                            "label": "Remove outlier rows",
                            "description": "Drop rows outside the lower/upper IQR thresholds.",
                        },
                    ],
                    "description": f"{outliers} rows outside IQR bounds · winsorize?",
                })

        # type issues: strings that look like dates
        for col in df.select_dtypes(include=["object"]).columns:
            try:
                pd.to_datetime(df[col].dropna().head(20), errors="raise")
                suggestions.append({
                    "id": str(uuid.uuid4()),
                    "kind": "type",
                    "variable": col,
                    "action": "convert_date",
                    "options": [
                        {
                            "action": "convert_date",
                            "label": "Convert to date",
                            "description": "Parse text values as dates and mark failures as missing.",
                        },
                    ],
                    "description": f"Stored as text · convert to date?",
                })
            except Exception:
                pass

        groups = {
            "missing": {
                "kind": "missing",
                "title": "Missing values",
                "columns": [x for x in suggestions if x.get("kind") == "missing"],
                "default_action": "impute_mean",
            },
            "outliers": {
                "kind": "outliers",
                "title": "Outliers",
                "columns": [x for x in suggestions if x.get("kind") == "outliers"],
                "default_action": "winsorize",
            },
            "type": {
                "kind": "type",
                "title": "Type issues",
                "columns": [x for x in suggestions if x.get("kind") == "type"],
                "default_action": "convert_date",
            },
        }
        duplicate_count = int(df.duplicated().sum()) if len(df) else 0
        groups["duplicates"] = {
            "kind": "duplicates",
            "title": "Duplicates",
            "count": duplicate_count,
            "columns": list(df.columns),
            "options": [
                {"action": "drop_duplicates", "label": "Remove duplicates, keep first occurrence", "keep": "first"},
                {"action": "drop_duplicates", "label": "Remove duplicates, keep last occurrence", "keep": "last"},
            ],
            "default_action": "drop_duplicates",
            "default_keep": "first",
        }

        return jsonify({"suggestions": clean_json(suggestions), "groups": clean_json(groups)})
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/clean/apply_group", methods=["POST"])
def clean_apply_group(ds_id):
    body = request.get_json() or {}
    kind = body.get("kind")
    action = body.get("action")
    columns = body.get("columns") or []
    overrides = body.get("overrides") or {}
    options = body.get("options") or {}
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)
        before_rows = len(df)
        before_cols = list(df.columns)
        details = {
            "category": "data_prep",
            "action_type": f"group_{kind}",
            "kind": kind,
            "columns": columns,
            "default_action": action,
            "overrides": overrides,
            "before": {"rows": before_rows, "columns": len(before_cols)},
            "changes": [],
        }

        if kind == "missing":
            selected = [c for c in columns if c in df.columns and int(df[c].isna().sum()) > 0]
            if not selected:
                return {"error": "no selected columns contain missing values"}, 400
            drop_cols = [c for c in selected if (overrides.get(c) or action) == "drop_rows"]
            if drop_cols:
                before_missing = {c: int(df[c].isna().sum()) for c in drop_cols}
                df = df.dropna(subset=drop_cols)
                details["changes"].append({
                    "action": "drop_rows",
                    "columns": drop_cols,
                    "before_missing": before_missing,
                    "rows_removed": int(before_rows - len(df)),
                })
            for col in [c for c in selected if c not in drop_cols]:
                method = overrides.get(col) or action
                missing_before = int(df[col].isna().sum())
                if missing_before <= 0:
                    continue
                if method in ("impute", "impute_mean"):
                    if pd.api.types.is_numeric_dtype(df[col]):
                        fill = df[col].mean()
                        label = "mean"
                    else:
                        mode = df[col].mode()
                        fill = mode[0] if len(mode) else ""
                        label = "mode"
                elif method == "impute_median":
                    if not pd.api.types.is_numeric_dtype(df[col]):
                        mode = df[col].mode()
                        fill = mode[0] if len(mode) else ""
                        label = "mode"
                    else:
                        fill = df[col].median()
                        label = "median"
                elif method in ("mode", "impute_mode"):
                    mode = df[col].mode()
                    fill = mode[0] if len(mode) else ""
                    label = "mode"
                else:
                    return {"error": f"unsupported missing-value method '{method}' for {col}"}, 400
                df[col] = df[col].fillna(fill)
                details["changes"].append({
                    "action": method,
                    "column": col,
                    "before_missing": missing_before,
                    "after_missing": int(df[col].isna().sum()),
                    "fill_value": clean_json(fill),
                    "method": label,
                })
            total_filled = sum(max(0, int(x.get("before_missing", 0)) - int(x.get("after_missing", 0))) for x in details["changes"] if "after_missing" in x)
            removed = before_rows - len(df)
            summary_parts = []
            if total_filled:
                summary_parts.append(f"filled {total_filled} missing value{'s' if total_filled != 1 else ''}")
            if removed:
                summary_parts.append(f"removed {removed} row{'s' if removed != 1 else ''}")
            summary = f"Handled missing values in {len(selected)} column{'s' if len(selected) != 1 else ''}"
            if summary_parts:
                summary += f" ({', '.join(summary_parts)})"
            op_type = "group_missing"

        elif kind == "outliers":
            selected = [c for c in columns if c in df.columns and pd.api.types.is_numeric_dtype(df[c])]
            if not selected:
                return {"error": "select at least one numeric outlier column"}, 400
            keep_mask = pd.Series(True, index=df.index)
            clipped_total = 0
            for col in selected:
                method = overrides.get(col) or action or "winsorize"
                series = df[col].dropna()
                if len(series) < 4:
                    continue
                q1, q3 = series.quantile([0.25, 0.75])
                iqr = q3 - q1
                lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
                outlier_mask = df[col].notna() & ((df[col] < lo) | (df[col] > hi))
                count = int(outlier_mask.sum())
                if method == "winsorize":
                    df[col] = df[col].clip(lower=lo, upper=hi)
                    clipped_total += count
                    details["changes"].append({"action": method, "column": col, "outliers": count, "lower": float(lo), "upper": float(hi)})
                elif method == "drop_outliers":
                    keep_mask &= ~outlier_mask
                    details["changes"].append({"action": method, "column": col, "outliers": count, "lower": float(lo), "upper": float(hi)})
                else:
                    return {"error": f"unsupported outlier method '{method}' for {col}"}, 400
            if any((x.get("action") == "drop_outliers") for x in details["changes"]):
                df = df[keep_mask]
            removed = before_rows - len(df)
            summary = f"Handled outliers in {len(selected)} numeric column{'s' if len(selected) != 1 else ''}"
            if clipped_total or removed:
                summary += f" ({clipped_total} clipped, {removed} rows removed)"
            op_type = "group_outliers"

        elif kind == "duplicates":
            keep = options.get("keep") or body.get("keep") or "first"
            if keep not in ("first", "last"):
                return {"error": "duplicate removal keep option must be first or last"}, 400
            duplicate_count = int(df.duplicated().sum())
            if duplicate_count <= 0:
                return {"error": "no duplicate rows found"}, 400
            df = df.drop_duplicates(keep=keep)
            details["columns"] = list(df.columns)
            details["changes"].append({
                "action": "drop_duplicates",
                "duplicate_rows_before": duplicate_count,
                "rows_removed": int(before_rows - len(df)),
                "keep": keep,
            })
            summary = f"Removed {before_rows - len(df)} duplicate row{'s' if before_rows - len(df) != 1 else ''} (kept {keep} occurrence)"
            op_type = "drop_duplicates"

        elif kind == "type":
            selected = [c for c in columns if c in df.columns]
            if not selected:
                return {"error": "select at least one column to convert"}, 400
            for col in selected:
                method = overrides.get(col) or action or "convert_date"
                if method != "convert_date":
                    return {"error": f"unsupported type method '{method}' for {col}"}, 400
                before_missing = int(df[col].isna().sum())
                df[col] = pd.to_datetime(df[col], errors="coerce").astype(str)
                details["changes"].append({
                    "action": method,
                    "column": col,
                    "before_missing": before_missing,
                    "after_missing": int(df[col].isna().sum()),
                })
            summary = f"Converted {len(selected)} column{'s' if len(selected) != 1 else ''} to date values"
            op_type = "group_type"
        else:
            return {"error": "unknown cleaning group"}, 400

        details["after"] = {"rows": int(len(df)), "columns": int(len(df.columns))}
        validation = {}
        if kind == "missing":
            validation["remaining_missing"] = {c: int(df[c].isna().sum()) for c in columns if c in df.columns}
            validation["missing_resolved"] = all(v == 0 for v in validation["remaining_missing"].values())
        elif kind == "duplicates":
            validation["duplicate_rows_after"] = int(df.duplicated().sum()) if len(df) else 0
            validation["duplicates_resolved"] = validation["duplicate_rows_after"] == 0
        elif kind == "outliers":
            remaining = {}
            for col in columns:
                if col not in df.columns or not pd.api.types.is_numeric_dtype(df[col]):
                    continue
                series = df[col].dropna()
                if len(series) < 4:
                    remaining[col] = 0
                    continue
                q1, q3 = series.quantile([0.25, 0.75])
                iqr = q3 - q1
                lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
                remaining[col] = int((df[col].notna() & ((df[col] < lo) | (df[col] > hi))).sum())
            validation["remaining_outliers"] = remaining
        elif kind == "type":
            validation["inferred_types"] = {v["name"]: v["dtype"] for v in infer_variables(df) if v["name"] in columns}
        details["validation"] = validation
        stage = create_stage(s, ds, df, op_type=op_type, op_params=details, summary=summary)
        return jsonify(clean_json({
            "ok": True,
            "row_count": ds.row_count,
            "col_count": ds.col_count,
            "stage_id": stage.id,
            "summary": summary,
            "details": details,
        }))
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/clean/apply", methods=["POST"])
def clean_apply(ds_id):
    """Apply a cleaning operation: impute, winsorize, convert, drop.

    Each successful op produces a new DatasetStage so the original data is
    preserved and the user can revert or export any prior stage.
    """
    body = request.get_json() or {}
    action = body.get("action")
    variable = body.get("variable")
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)
        before_rows = len(df)
        summary = ""

        if action in ("impute", "impute_mean") and variable in df.columns:
            missing_before = int(df[variable].isna().sum())
            if pd.api.types.is_numeric_dtype(df[variable]):
                fill = df[variable].mean()
                df[variable] = df[variable].fillna(fill)
                summary = f"Imputed {missing_before} missing values in '{variable}' with mean ({fill:.4g})"
            else:
                mode = df[variable].mode()
                fill = mode[0] if len(mode) else ""
                df[variable] = df[variable].fillna(fill)
                summary = f"Imputed {missing_before} missing values in '{variable}' with mode ({fill!r})"
        elif action == "impute_median" and variable in df.columns:
            if not pd.api.types.is_numeric_dtype(df[variable]):
                return {"error": "median imputation requires a numeric variable"}, 400
            missing_before = int(df[variable].isna().sum())
            fill = df[variable].median()
            df[variable] = df[variable].fillna(fill)
            summary = f"Imputed {missing_before} missing values in '{variable}' with median ({fill:.4g})"
        elif action in ("mode", "impute_mode") and variable in df.columns:
            missing_before = int(df[variable].isna().sum())
            mode = df[variable].mode()
            fill = mode[0] if len(mode) else ""
            df[variable] = df[variable].fillna(fill)
            summary = f"Imputed {missing_before} missing values in '{variable}' with mode ({fill!r})"
        elif action == "winsorize" and variable in df.columns:
            q1, q3 = df[variable].quantile([0.25, 0.75])
            iqr = q3 - q1
            lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            clipped = int(((df[variable] < lo) | (df[variable] > hi)).sum())
            df[variable] = df[variable].clip(lower=lo, upper=hi)
            summary = f"Winsorized '{variable}' to [{lo:.4g}, {hi:.4g}] (clipped {clipped} outlier rows)"
        elif action == "drop_outliers" and variable in df.columns:
            if not pd.api.types.is_numeric_dtype(df[variable]):
                return {"error": "outlier removal requires a numeric variable"}, 400
            q1, q3 = df[variable].quantile([0.25, 0.75])
            iqr = q3 - q1
            lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            keep = df[variable].isna() | ((df[variable] >= lo) & (df[variable] <= hi))
            removed = int((~keep).sum())
            df = df[keep]
            summary = f"Removed {removed} outlier rows in '{variable}' outside [{lo:.4g}, {hi:.4g}]"
        elif action == "convert_date" and variable in df.columns:
            df[variable] = pd.to_datetime(df[variable], errors="coerce").astype(str)
            summary = f"Converted '{variable}' to datetime"
        elif action == "drop_rows" and variable in df.columns:
            df = df.dropna(subset=[variable])
            summary = f"Dropped {before_rows - len(df)} rows with missing '{variable}'"
        elif action == "expand":
            num = body.get("numerator")
            den = body.get("denominator")
            new_name = body.get("new_name") or f"{num}_per_{den}"
            if num in df.columns and den in df.columns:
                df[new_name] = df[num] / df[den].replace(0, np.nan)
                summary = f"Created '{new_name}' = {num} / {den}"
            else:
                return {"error": "expand: missing columns"}, 400
        else:
            return {"error": "unknown action or bad variable"}, 400

        stage = create_stage(s, ds, df, op_type=action, op_params=body, summary=summary)
        return {
            "ok": True,
            "row_count": ds.row_count,
            "col_count": ds.col_count,
            "stage_id": stage.id,
            "summary": summary,
        }
    finally:
        s.close()


# --- Manual transforms (merge / rename / drop / cast) ---

@app.route("/api/datasets/<ds_id>/transform", methods=["POST"])
def transform(ds_id):
    """Apply a manual schema transform — merge columns, rename, drop, cast.

    Body: {op, params}. Set ?preview=true to return a sample of the result
    without persisting; otherwise a new stage is created.

    Supported ops:
      - merge_columns: {columns, new_name, separator, drop_originals}
      - rename_column: {column, new_name}
      - drop_columns:  {columns}
      - drop_rows:     {column, predicate=missing|equals|gt|lt|in,
                         value?}
      - cast_column:   {column, to: int|float|datetime|category|text|binary}
      - split_column:  {column, separator, into}
    """
    body = request.get_json() or {}
    op = (body.get("op") or "").strip()
    params = body.get("params") or {}
    preview = request.args.get("preview", "").lower() in ("1", "true", "yes")

    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)

        try:
            df_new, summary = _apply_transform(df, op, params)
        except ValueError as e:
            return {"error": str(e)}, 400

        if preview:
            sample = df_new.head(20)
            sample_records = clean_json(
                sample.where(pd.notnull(sample), None).to_dict(orient="records")
            )
            return jsonify({
                "preview": True,
                "summary": summary,
                "row_count": int(len(df_new)),
                "col_count": int(len(df_new.columns)),
                "columns": list(df_new.columns),
                "sample": sample_records,
            })

        stage = create_stage(s, ds, df_new, op_type=op, op_params=params, summary=summary)
        return jsonify({
            "ok": True,
            "stage_id": stage.id,
            "summary": summary,
            "row_count": ds.row_count,
            "col_count": ds.col_count,
        })
    finally:
        s.close()


def _apply_transform(df, op, params):
    """Pure transform — returns (new_df, summary) or raises ValueError."""
    if op == "merge_columns":
        cols = params.get("columns") or []
        new_name = (params.get("new_name") or "").strip()
        sep = params.get("separator", " ")
        drop_originals = bool(params.get("drop_originals", True))
        if len(cols) < 2:
            raise ValueError("merge_columns: pick at least two columns")
        if not new_name:
            raise ValueError("merge_columns: new_name is required")
        for c in cols:
            if c not in df.columns:
                raise ValueError(f"merge_columns: '{c}' not in columns")
        out = df.copy()
        merged = out[cols].astype(str).agg(sep.join, axis=1)
        # if every source value was NaN/empty, treat the merged value as NaN too
        all_blank = out[cols].isna().all(axis=1)
        merged = merged.where(~all_blank, other=None)
        out[new_name] = merged
        if drop_originals:
            out = out.drop(columns=[c for c in cols if c != new_name])
        summary = (
            f"Merged {len(cols)} columns ({', '.join(cols)}) into '{new_name}' "
            f"with separator {sep!r}" + (" and dropped originals" if drop_originals else "")
        )
        return out, summary

    if op == "rename_column":
        col = params.get("column")
        new_name = (params.get("new_name") or "").strip()
        if col not in df.columns:
            raise ValueError(f"rename_column: '{col}' not in columns")
        if not new_name:
            raise ValueError("rename_column: new_name is required")
        if new_name in df.columns and new_name != col:
            raise ValueError(f"rename_column: '{new_name}' already exists")
        out = df.rename(columns={col: new_name})
        return out, f"Renamed '{col}' → '{new_name}'"

    if op == "drop_columns":
        cols = params.get("columns") or []
        missing = [c for c in cols if c not in df.columns]
        if missing:
            raise ValueError(f"drop_columns: not in dataset: {missing}")
        if not cols:
            raise ValueError("drop_columns: pick at least one column")
        out = df.drop(columns=cols)
        return out, f"Dropped {len(cols)} column{'s' if len(cols) != 1 else ''}: {', '.join(cols)}"

    if op == "drop_rows":
        col = params.get("column")
        pred = (params.get("predicate") or "missing").lower()
        value = params.get("value")
        if col not in df.columns:
            raise ValueError(f"drop_rows: '{col}' not in columns")
        before = len(df)
        if pred == "missing":
            out = df.dropna(subset=[col])
        elif pred == "equals":
            out = df[df[col] != value]
        elif pred == "gt":
            out = df[~(df[col] > _coerce_num(value))]
        elif pred == "lt":
            out = df[~(df[col] < _coerce_num(value))]
        elif pred == "in":
            vals = value if isinstance(value, list) else [value]
            out = df[~df[col].isin(vals)]
        else:
            raise ValueError(f"drop_rows: unknown predicate '{pred}'")
        return out, f"Dropped {before - len(out)} rows where {col} {pred} {value!r}".rstrip("'\"")

    if op == "cast_column":
        col = params.get("column")
        to = (params.get("to") or "").lower()
        if col not in df.columns:
            raise ValueError(f"cast_column: '{col}' not in columns")
        out = df.copy()
        if to in ("numeric", "float"):
            coerced = pd.to_numeric(out[col], errors="coerce")
            errors = int(coerced.isna().sum() - out[col].isna().sum())
            out[col] = coerced.astype(float) if to == "float" else coerced
            label = "float" if to == "float" else "numeric"
            return out, f"Cast '{col}' to {label} ({errors} value{'s' if errors != 1 else ''} became NaN)"
        if to == "int":
            coerced = pd.to_numeric(out[col], errors="coerce")
            errors = int(coerced.isna().sum() - out[col].isna().sum())
            out[col] = coerced.round().astype("Int64")
            return out, f"Cast '{col}' to int ({errors} value{'s' if errors != 1 else ''} became NaN)"
        if to == "binary":
            present = out[col].dropna().astype(str).str.strip().str.lower()
            truthy = {"1", "true", "yes", "y"}
            falsy = {"0", "false", "no", "n"}
            allowed = truthy | falsy
            errors = int((~present.isin(allowed)).sum())
            mapped = out[col].astype(str).str.strip().str.lower().map(
                lambda value: True if value in truthy else (False if value in falsy else None)
            )
            out[col] = mapped.where(out[col].notna(), None)
            return out, f"Cast '{col}' to binary ({errors} value{'s' if errors != 1 else ''} became NaN)"
        if to == "datetime":
            coerced = pd.to_datetime(out[col], errors="coerce")
            errors = int(coerced.isna().sum() - out[col].isna().sum())
            out[col] = coerced.astype(str).where(coerced.notna(), None)
            return out, f"Cast '{col}' to datetime ({errors} value{'s' if errors != 1 else ''} became NaN)"
        if to == "category" or to == "text":
            out[col] = out[col].astype(str).where(out[col].notna(), None)
            return out, f"Cast '{col}' to {to}"
        raise ValueError(f"cast_column: unsupported target '{to}'")

    if op == "split_column":
        col = params.get("column")
        sep = params.get("separator", " ")
        into = params.get("into") or []
        if col not in df.columns:
            raise ValueError(f"split_column: '{col}' not in columns")
        if not into:
            raise ValueError("split_column: 'into' must be a list of new column names")
        parts = df[col].astype(str).str.split(sep, n=len(into) - 1, expand=True)
        out = df.copy()
        for i, name in enumerate(into):
            out[name] = parts[i] if i < parts.shape[1] else None
        return out, f"Split '{col}' by {sep!r} into {len(into)} columns: {', '.join(into)}"

    raise ValueError(f"unknown op '{op}'")


def _coerce_num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return v


# --- Expand (synthesize rows for small datasets) ---

@app.route("/api/datasets/<ds_id>/expand", methods=["POST"])
def expand_dataset(ds_id):
    """Grow a small dataset by bootstrap resample or synthetic generation.

    Body: {method: 'bootstrap'|'synthetic', target_rows: int, options: {...}}
    Set ?preview=true to return a 10-row sample + per-numeric-column drift
    stats without persisting. Apply creates a new stage.
    """
    body = request.get_json() or {}
    method = (body.get("method") or "bootstrap").lower()
    target_rows = int(body.get("target_rows") or 0)
    options = body.get("options") or {}
    preview = request.args.get("preview", "").lower() in ("1", "true", "yes")

    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)
        if len(df) == 0:
            return {"error": "dataset is empty"}, 400
        if target_rows <= len(df):
            return {"error": f"target_rows ({target_rows}) must exceed current row count ({len(df)})"}, 400

        try:
            df_new, summary, drift = _expand(df, method, target_rows, options)
        except ValueError as e:
            return {"error": str(e)}, 400

        if preview:
            sample = df_new.tail(10)  # show some of the new rows
            sample_records = clean_json(
                sample.where(pd.notnull(sample), None).to_dict(orient="records")
            )
            return jsonify({
                "preview": True,
                "method": method,
                "summary": summary,
                "row_count": int(len(df_new)),
                "col_count": int(len(df_new.columns)),
                "added_rows": int(len(df_new) - len(df)),
                "columns": list(df_new.columns),
                "sample": sample_records,
                "drift": drift,
            })

        stage = create_stage(s, ds, df_new, op_type=f"expand_{method}",
                             op_params={"method": method, "target_rows": target_rows, "options": options},
                             summary=summary)
        return jsonify({
            "ok": True,
            "stage_id": stage.id,
            "summary": summary,
            "row_count": ds.row_count,
            "col_count": ds.col_count,
        })
    finally:
        s.close()


def _expand(df, method, target_rows, options):
    """Return (new_df, summary, drift_stats)."""
    n_extra = target_rows - len(df)
    seed = int(options.get("seed", 42))
    rng = np.random.default_rng(seed)

    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]

    before_stats = {c: _col_stats(df[c]) for c in numeric_cols}

    if method == "bootstrap":
        noise_pct = float(options.get("noise_pct", 0))  # percent of std dev
        extra = df.sample(n=n_extra, replace=True, random_state=seed).reset_index(drop=True)
        if noise_pct > 0 and numeric_cols:
            for col in numeric_cols:
                std = df[col].std()
                if pd.isna(std) or std == 0:
                    continue
                extra[col] = extra[col] + rng.normal(0, std * (noise_pct / 100), size=len(extra))
        out = pd.concat([df, extra], ignore_index=True)
        noise_note = f" with {noise_pct:g}% Gaussian noise on numeric columns" if noise_pct else ""
        summary = f"Bootstrap-resampled {n_extra} new rows{noise_note} (now {len(out)} total)"
    elif method == "synthetic":
        # per-column independent sampling: numeric via KDE, categorical/text via frequency
        new_data = {c: [] for c in df.columns}
        for col in df.columns:
            series = df[col]
            present = series.dropna()
            if len(present) == 0:
                new_data[col] = [None] * n_extra
                continue
            if pd.api.types.is_numeric_dtype(series) and len(present) >= 2 and present.nunique() >= 3:
                try:
                    from scipy.stats import gaussian_kde
                    kde = gaussian_kde(present.astype(float).values)
                    sampled = kde.resample(n_extra, seed=seed)[0]
                    # round to int if original was integer-like
                    if pd.api.types.is_integer_dtype(series.dropna()) or all(float(v).is_integer() for v in present.head(20)):
                        sampled = np.round(sampled).astype(int)
                    new_data[col] = sampled.tolist()
                except Exception:
                    new_data[col] = rng.choice(present.values, size=n_extra, replace=True).tolist()
            else:
                # categorical / text — sample from observed frequencies
                vc = present.value_counts(normalize=True)
                new_data[col] = rng.choice(vc.index.values, size=n_extra, replace=True, p=vc.values).tolist()
        extra = pd.DataFrame(new_data)
        out = pd.concat([df, extra], ignore_index=True)
        summary = (
            f"Synthesized {n_extra} new rows by per-column sampling "
            f"(numeric: KDE; categorical: observed frequencies). Cross-column correlations "
            f"are NOT preserved — use bootstrap if you need the joint distribution."
        )
    else:
        raise ValueError(f"unknown expand method '{method}'")

    after_stats = {c: _col_stats(out[c]) for c in numeric_cols}
    drift = []
    for c in numeric_cols:
        b, a = before_stats[c], after_stats[c]
        drift.append({
            "column": c,
            "before_mean": b["mean"], "after_mean": a["mean"],
            "before_std": b["std"], "after_std": a["std"],
            "mean_pct_change": _pct_change(b["mean"], a["mean"]),
            "std_pct_change": _pct_change(b["std"], a["std"]),
        })

    return out, summary, drift


def _col_stats(series):
    s = series.dropna()
    if len(s) == 0:
        return {"mean": None, "std": None}
    try:
        return {"mean": float(s.mean()), "std": float(s.std()) if len(s) > 1 else 0.0}
    except Exception:
        return {"mean": None, "std": None}


def _pct_change(a, b):
    if a is None or b is None:
        return None
    if a == 0:
        return None
    return round((b - a) / abs(a) * 100, 2)


# --- Descriptive stats ---

@app.route("/api/datasets/<ds_id>/describe", methods=["POST"])
def describe(ds_id):
    body = request.get_json() or {}
    cols = body.get("variables") or []
    group_by = body.get("group_by")
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds)
        if not cols:
            cols = df.select_dtypes(include=[np.number]).columns.tolist()

        out = []
        for col in cols:
            if col not in df.columns:
                continue
            series = df[col]
            if pd.api.types.is_numeric_dtype(series):
                s_clean = series.dropna()
                out.append({
                    "variable": col,
                    "kind": "numeric",
                    "n": int(s_clean.count()),
                    "mean": float(s_clean.mean()) if len(s_clean) else None,
                    "std": float(s_clean.std()) if len(s_clean) > 1 else None,
                    "min": float(s_clean.min()) if len(s_clean) else None,
                    "q1": float(s_clean.quantile(0.25)) if len(s_clean) else None,
                    "median": float(s_clean.median()) if len(s_clean) else None,
                    "q3": float(s_clean.quantile(0.75)) if len(s_clean) else None,
                    "max": float(s_clean.max()) if len(s_clean) else None,
                    "skew": float(s_clean.skew()) if len(s_clean) > 2 else None,
                    "kurtosis": float(s_clean.kurtosis()) if len(s_clean) > 3 else None,
                })
            else:
                vc = series.value_counts(dropna=True).head(20)
                out.append({
                    "variable": col,
                    "kind": "categorical",
                    "n": int(series.count()),
                    "unique": int(series.nunique()),
                    "top": str(vc.index[0]) if len(vc) else None,
                    "freq": int(vc.iloc[0]) if len(vc) else None,
                    "value_counts": {str(k): int(v) for k, v in vc.items()},
                })

        # histogram data for numeric columns, for charting
        histogram = None
        histograms = {}
        num_cols = [c for c in cols if c in df.columns and pd.api.types.is_numeric_dtype(df[c])]
        for num_col in num_cols:
            s_clean = df[num_col].dropna()
            if len(s_clean):
                counts, bin_edges = np.histogram(s_clean, bins=12)
                histograms[num_col] = {
                    "variable": num_col,
                    "counts": counts.tolist(),
                    "bins": bin_edges.tolist(),
                }
        if histograms:
            first = num_cols[0]
            histogram = histograms.get(first)

        result = {"stats": out, "histogram": histogram, "histograms": histograms}
        _save_analysis(s, ds_id, "describe", body, result)
        return jsonify(clean_json(result))
    finally:
        s.close()

# --- Hypothesis tests ---

@app.route("/api/datasets/<ds_id>/test", methods=["POST"])
def run_test(ds_id):
    body = request.get_json() or {}
    kind = body.get("kind")  # 't', 'anova', 'chi', 'corr'
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds)
        result = {}

        if kind == "t":
            group = body["group"]
            measure = body["measure"]
            groups = df[group].dropna().unique()
            if len(groups) != 2:
                return {"error": "t-test needs exactly 2 groups"}, 400
            g1 = df[df[group] == groups[0]][measure].dropna()
            g2 = df[df[group] == groups[1]][measure].dropna()
            t, p = stats.ttest_ind(g1, g2, equal_var=False)
            pooled_std = np.sqrt((g1.var() + g2.var()) / 2)
            d = (g1.mean() - g2.mean()) / pooled_std if pooled_std else 0
            result = {
                "t": float(t), "p": float(p),
                "df": int(len(g1) + len(g2) - 2),
                "cohens_d": float(d),
                "mean_group_1": float(g1.mean()),
                "mean_group_2": float(g2.mean()),
                "group_labels": [str(groups[0]), str(groups[1])],
                "significant": bool(p < 0.05),
                "interpretation": _t_interpret(t, p, g1.mean(), g2.mean(), d, group, measure),
            }
        elif kind == "anova":
            group = body["group"]
            measure = body["measure"]
            labels = df[group].dropna().unique()
            samples = [df[df[group] == g][measure].dropna() for g in labels]
            f, p = stats.f_oneway(*samples)
            grand = df[[group, measure]].dropna()[measure]
            ss_between = sum(len(sample) * (sample.mean() - grand.mean()) ** 2 for sample in samples if len(sample))
            ss_total = sum((grand - grand.mean()) ** 2) if len(grand) else 0
            eta_sq = float(ss_between / ss_total) if ss_total else 0.0
            result = {
                "f": float(f), "p": float(p),
                "groups": len(samples),
                "eta_squared": eta_sq,
                "group_means": {str(label): float(sample.mean()) for label, sample in zip(labels, samples) if len(sample)},
                "significant": bool(p < 0.05),
                "interpretation": _anova_interpret(f, p, len(samples), measure, group),
            }
        elif kind == "chi":
            var_a = body["var_a"]
            var_b = body["var_b"]
            ct = pd.crosstab(df[var_a], df[var_b])
            chi2, p, dof, _ = stats.chi2_contingency(ct)
            n = int(ct.to_numpy().sum())
            min_dim = max(min(ct.shape) - 1, 1)
            cramer_v = float(np.sqrt(chi2 / (n * min_dim))) if n and min_dim else 0.0
            row_pct = ct.div(ct.sum(axis=1).replace(0, np.nan), axis=0).fillna(0) * 100
            result = {
                "chi2": float(chi2), "p": float(p), "df": int(dof),
                "contingency": {str(i): {str(c): int(ct.loc[i, c]) for c in ct.columns} for i in ct.index},
                "row_percentages": {str(i): {str(c): round(float(row_pct.loc[i, c]), 1) for c in row_pct.columns} for i in row_pct.index},
                "cramers_v": cramer_v,
                "significant": bool(p < 0.05),
                "interpretation": _chi_interpret(chi2, p, var_a, var_b),
            }
        elif kind == "corr":
            cols = body.get("variables") or df.select_dtypes(include=[np.number]).columns.tolist()
            corr = df[cols].corr().round(3)
            pairs = []
            for i, a in enumerate(cols):
                for b in cols[i + 1:]:
                    data = df[[a, b]].dropna()
                    if len(data) < 3:
                        continue
                    r_val, p_val = stats.pearsonr(data[a], data[b])
                    pairs.append({
                        "var_a": a,
                        "var_b": b,
                        "r": float(r_val),
                        "p": float(p_val),
                        "n": int(len(data)),
                    })
            pairs.sort(key=lambda row: abs(row["r"]), reverse=True)
            result = {
                "variables": cols,
                "matrix": corr.where(pd.notnull(corr), None).to_dict(),
                "pairs": pairs[:10],
                "strongest_pair": pairs[0] if pairs else None,
            }
            if len(cols) == 2:
                clean_pair = df[[cols[0], cols[1]]].dropna()
                if len(clean_pair):
                    sample = clean_pair.sample(min(200, len(clean_pair)), random_state=42)
                    result["scatter_points"] = sample.values.tolist()
        else:
            return {"error": "unknown test kind"}, 400

        _save_analysis(s, ds_id, f"test_{kind}", body, result)
        return jsonify(clean_json(result))
    finally:
        s.close()

def _t_interpret(t, p, m1, m2, d, group, measure):
    sig = "significantly" if p < 0.05 else "not significantly"
    effect = "large" if abs(d) >= 0.8 else "medium" if abs(d) >= 0.5 else "small"
    return f"The two {group} groups {sig} differ on {measure} (t={t:.2f}, p={p:.4f}). Means: {m1:.2f} vs {m2:.2f}. Effect size is {effect} (Cohen's d={d:.2f})."

def _anova_interpret(f, p, k, measure, group):
    sig = "significantly" if p < 0.05 else "not significantly"
    return f"Across {k} groups of {group}, {measure} {sig} differs (F={f:.2f}, p={p:.4f})."

def _chi_interpret(chi2, p, a, b):
    sig = "significant" if p < 0.05 else "no significant"
    return f"There is {sig} association between {a} and {b} (χ²={chi2:.2f}, p={p:.4f})."

# --- Advanced stats ---

@app.route("/api/datasets/<ds_id>/advanced/cluster", methods=["POST"])
def do_cluster(ds_id):
    body = request.get_json() or {}
    cols = body.get("variables") or []
    k = min(max(_parse_num(body.get("k"), 4, int), 2), 20)
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds)
        X = numeric_df(df, cols).dropna()
        if X.shape[1] < 2:
            return {"error": "K-means clustering requires at least 2 numeric variables."}, 400
        if len(X) < k:
            return {"error": f"K-means clustering requires at least {k} complete rows for k={k}. Choose fewer clusters or select variables with fewer missing values."}, 400
        Xs = StandardScaler().fit_transform(X)
        km = KMeans(n_clusters=k, n_init=10, random_state=42).fit(Xs)
        # pca to 2d for plotting
        pca = PCA(n_components=2).fit_transform(Xs)
        result = {
            "k": k,
            "labels": km.labels_.tolist(),
            "inertia": float(km.inertia_),
            "cluster_sizes": {str(i): int((km.labels_ == i).sum()) for i in range(k)},
            "pca_points": [{"x": float(p[0]), "y": float(p[1]), "cluster": int(c)}
                           for p, c in zip(pca, km.labels_)][:500],  # cap plot points
            "variables": cols or X.columns.tolist(),
        }
        _save_analysis(s, ds_id, "cluster", body, result)
        return jsonify(clean_json(result))
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/advanced/pca", methods=["POST"])
def do_pca(ds_id):
    body = request.get_json() or {}
    cols = body.get("variables") or []
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds)
        X = numeric_df(df, cols).dropna()
        if X.shape[1] < 2:
            return {"error": "PCA requires at least 2 numeric variables."}, 400
        if len(X) < 2:
            return {"error": "PCA requires at least 2 complete rows after removing missing values."}, 400
        Xs = StandardScaler().fit_transform(X)
        n_comp = min(5, X.shape[1])
        pca = PCA(n_components=n_comp).fit(Xs)
        result = {
            "explained_variance": pca.explained_variance_ratio_.tolist(),
            "cumulative": np.cumsum(pca.explained_variance_ratio_).tolist(),
            "loadings": {
                col: pca.components_[:, i].tolist()
                for i, col in enumerate(X.columns)
            },
            "components": [f"PC{i+1}" for i in range(n_comp)],
        }
        _save_analysis(s, ds_id, "pca", body, result)
        return jsonify(clean_json(result))
    finally:
        s.close()

# --- Modeling ---

ALGORITHM_CATALOG = {
    "logistic": {"label": "Logistic regression", "task": "classification", "needs_scaling": True,  "interpretable": True},
    "rf":       {"label": "Random forest",       "task": "both",          "needs_scaling": False, "interpretable": False},
    "tree":     {"label": "Decision tree",       "task": "both",          "needs_scaling": False, "interpretable": False},
    "linear":   {"label": "Linear regression",   "task": "regression",    "needs_scaling": True,  "interpretable": True},
}

MODEL_PARAM_DEFAULTS = {
    "logistic": {"C": 1.0, "max_iter": 1000},
    "rf": {"n_estimators": 100, "max_depth": None, "min_samples_leaf": 1},
    "tree": {"max_depth": None, "min_samples_leaf": 1},
    "linear": {"fit_intercept": True},
}

def _model_default_params(algo):
    return dict(MODEL_PARAM_DEFAULTS.get(algo, {}))

def _algo_label_for_task(algo, task=None):
    if algo == "rf":
        return "Random Forest Classifier" if task == "classification" else "Random Forest Regressor" if task == "regression" else "Random Forest"
    if algo == "tree":
        return "Decision Tree Classifier" if task == "classification" else "Decision Tree Regressor" if task == "regression" else "Decision Tree"
    return ALGORITHM_CATALOG.get(algo, {}).get("label", algo)

def _sanitize_model_params(algo, params=None):
    clean = _model_default_params(algo)
    params = params or {}
    if algo == "logistic":
        clean["C"] = min(max(_parse_num(params.get("C"), clean["C"], float), 0.001), 100.0)
        clean["max_iter"] = min(max(_parse_num(params.get("max_iter"), clean["max_iter"], int), 100), 5000)
    elif algo == "rf":
        clean["n_estimators"] = min(max(_parse_num(params.get("n_estimators"), clean["n_estimators"], int), 10), 500)
        depth = params.get("max_depth", clean["max_depth"])
        clean["max_depth"] = None if depth in (None, "", "none", "None") else min(max(_parse_num(depth, 10, int), 1), 50)
        clean["min_samples_leaf"] = min(max(_parse_num(params.get("min_samples_leaf"), clean["min_samples_leaf"], int), 1), 50)
    elif algo == "tree":
        depth = params.get("max_depth", clean["max_depth"])
        clean["max_depth"] = None if depth in (None, "", "none", "None") else min(max(_parse_num(depth, 10, int), 1), 50)
        clean["min_samples_leaf"] = min(max(_parse_num(params.get("min_samples_leaf"), clean["min_samples_leaf"], int), 1), 50)
    elif algo == "linear":
        clean["fit_intercept"] = bool(params.get("fit_intercept", clean["fit_intercept"]))
    return clean

def _is_identifier_feature(series, row_count):
    nunique = series.nunique(dropna=True)
    if nunique <= 1:
        return "constant"
    if row_count > 0 and nunique == row_count:
        return "identifier"
    return None

def _issue_check(label, issue, issue_type, severity, message, causes=None, actions=None):
    """Structured checklist issue used by the UI's generic fix-action menu.

    Keeps the older label/status/detail fields so existing rendering remains
    backward-compatible while newer surfaces can use issue/actions directly.
    """
    return {
        "label": label,
        "status": severity,
        "detail": message,
        "issue": issue,
        "issue_type": issue_type,
        "severity": severity,
        "message": message,
        "causes": causes or [],
        "actions": actions or [],
    }


def _detect_task(y):
    """Heuristic: small distinct count + non-continuous → classification."""
    return (
        pd.api.types.is_object_dtype(y)
        or pd.api.types.is_categorical_dtype(y)
        or pd.api.types.is_bool_dtype(y)
    )


def _build_preprocessing_plan(df, target, features, algorithms, target_options=None):
    """Inspect the data and produce a transparent preprocessing plan.

    Returned shape is also stored on each trained model so the user can see
    after the fact exactly what was done.
    """
    if target not in df.columns:
        raise ValueError(f"target '{target}' not in dataset")
    features = [f for f in features if f in df.columns and f != target]
    if not features:
        raise ValueError("pick at least one feature")
    excluded_features = []
    kept_features = []
    for f in features:
        reason = _is_identifier_feature(df[f], len(df))
        if reason:
            excluded_features.append({"feature": f, "reason": reason})
        else:
            kept_features.append(f)
    features = kept_features
    if not features:
        raise ValueError("all selected features were identifiers or constant columns")

    sub = df[features + [target]]
    rows_before = len(sub)
    sub_clean = sub.dropna()
    rows_after = len(sub_clean)
    dropped = rows_before - rows_after

    target_options = target_options or {}
    test_size = min(max(_parse_num(target_options.get("test_size"), 0.2, float), 0.05), 0.5)
    stratify_split = bool(target_options.get("stratify", True))
    class_weight = target_options.get("class_weight") if target_options.get("class_weight") in ("balanced", None) else None
    y = sub_clean[target]
    task = "classification" if _detect_task(y) else "regression"
    algorithms = [
        a for a in algorithms or []
        if ALGORITHM_CATALOG.get(a) and (ALGORITHM_CATALOG[a]["task"] == "both" or ALGORITHM_CATALOG[a]["task"] == task)
    ]
    target_classes = [str(x) for x in y.dropna().astype(str).value_counts().index.tolist()] if task == "classification" else []
    target_mode = target_options.get("mode") or ("binary" if task == "classification" and len(target_classes) == 2 else "multiclass")
    positive_class = target_options.get("positive_class") or (target_classes[0] if target_classes else None)
    target_context = None
    if task == "regression":
        y_num = pd.to_numeric(y, errors="coerce").dropna()
        if len(y_num):
            target_context = {
                "min": float(y_num.min()),
                "max": float(y_num.max()),
                "mean": float(y_num.mean()),
                "std": float(y_num.std() or 0),
            }

    # encoding
    encoding = []
    for c in features:
        col = sub_clean[c]
        if pd.api.types.is_numeric_dtype(col):
            continue
        cats = col.astype(str).unique().tolist()
        encoding.append({
            "column": c,
            "method": "one_hot",
            "n_categories": len(cats),
            "sample_categories": cats[:6],
        })

    # algos requested → does scaling apply?
    scaling = []
    needs_scaling = any(ALGORITHM_CATALOG.get(a, {}).get("needs_scaling") for a in algorithms or [])
    if needs_scaling:
        scaling = [{
            "method": "StandardScaler",
            "columns": "all numeric features (after one-hot encoding)",
            "applies_to": [a for a in algorithms or [] if ALGORITHM_CATALOG.get(a, {}).get("needs_scaling")],
        }]

    numeric_features_for_plan = [c for c in features if pd.api.types.is_numeric_dtype(sub_clean[c])]
    numeric_options = target_options.get("numeric_preprocessing") or {}
    scaling_method = (numeric_options.get("scaling") or "auto").lower()
    if scaling_method not in ("auto", "none", "standard", "minmax"):
        scaling_method = "auto"
    log_columns = [c for c in numeric_options.get("log_columns") or [] if c in numeric_features_for_plan]
    integer_columns = [c for c in numeric_options.get("integer_columns") or [] if c in numeric_features_for_plan]
    skewed_columns = []
    for c in numeric_features_for_plan:
        try:
            skew = float(pd.to_numeric(sub_clean[c], errors="coerce").dropna().skew())
            if abs(skew) >= 1:
                skewed_columns.append({"column": c, "skew": skew})
        except Exception:
            pass
    effective_scaling = scaling_method
    if scaling_method == "auto":
        effective_scaling = "standard" if needs_scaling else "none"
    if effective_scaling == "minmax" and numeric_features_for_plan:
        scaling = [{
            "method": "MinMaxScaler",
            "columns": "numeric/encoded modeling features",
            "applies_to": algorithms or [],
            "selected_by": "user",
        }]
    elif effective_scaling == "standard" and numeric_features_for_plan:
        scaling = [{
            "method": "StandardScaler",
            "columns": "numeric/encoded modeling features",
            "applies_to": [a for a in algorithms or [] if scaling_method != "auto" or ALGORITHM_CATALOG.get(a, {}).get("needs_scaling")],
            "selected_by": "user" if scaling_method != "auto" else "auto",
        }]

    # missing report
    missing_report = [
        {"column": c, "missing": int(sub[c].isna().sum())}
        for c in features + [target] if sub[c].isna().sum() > 0
    ]

    # warnings
    warnings = []
    hard_blocks = []
    multicollinearity = []
    n_per_class = None
    target_groups_detected = []
    if task == "classification":
        n_per_class = y.value_counts().to_dict()
        smallest = min(n_per_class.values()) if n_per_class else 0
        total = sum(n_per_class.values()) if n_per_class else 0
        largest = max(n_per_class.values()) if n_per_class else 0
        imbalance_ratio = (largest / total) if total else 0
        effective_classes = n_per_class
        if target_mode == "binary":
            positive_count = int(y.astype(str).eq(str(positive_class)).sum()) if positive_class is not None else 0
            negative_count = int(len(y) - positive_count)
            effective_classes = {str(positive_class): positive_count, f"not {positive_class}": negative_count}
            if positive_count == 0 or negative_count == 0:
                hard_blocks.append({
                    "code": "binary_target_single_class",
                    "message": f"Binary target setup creates only one class. Choose a positive class that exists in '{target}', or standardize the target categories first.",
                    "column": target,
                    "positive_class": positive_class,
                    "class_counts": clean_json(n_per_class),
                })
        if smallest < 10:
            warnings.append(f"Smallest class has only {smallest} examples — model quality will be unreliable.")
        if imbalance_ratio >= 0.75 and len(n_per_class) > 1:
            warnings.append(f"Class imbalance detected - largest class is {imbalance_ratio:.0%} of usable rows.")
        if len(n_per_class) > 2 and target_mode == "binary":
            warnings.append(f"Binary mode will reduce {len(n_per_class)} target categories into '{positive_class}' vs all others.")
        elif len(n_per_class) > 2:
            warnings.append("Multiclass target detected. Use binary mode if the analysis needs one selected category versus the rest.")
        if len(n_per_class) > 10:
            warnings.append(f"{len(n_per_class)} distinct target values — high cardinality may hurt accuracy.")
        if not pd.api.types.is_numeric_dtype(y):
            target_groups = [g for g in _category_groups(y.dropna().astype(str).unique().tolist(), threshold=0.88) if len(g.get("values", [])) > 1]
            target_groups_detected = target_groups
            if target_groups:
                hard_blocks.append({
                    "code": "target_categories_dirty",
                    "message": f"Target '{target}' has similar category labels. Fix categories first in Data standardization before modeling.",
                    "column": target,
                    "groups": target_groups[:5],
                })
        if len([count for count in effective_classes.values() if count > 0]) < 2:
            hard_blocks.append({
                "code": "target_single_effective_class",
                "message": f"Target '{target}' has fewer than two usable classes for the selected setup.",
                "column": target,
                "class_counts": clean_json(effective_classes),
            })
    if rows_after < 50:
        warnings.append(f"Only {rows_after} complete rows after dropping missing — consider Expand or imputation.")

    # leakage heuristics: features with same uniqueness as rows ≈ id-like
    if excluded_features:
        warnings.append("Identifier or constant columns were excluded from modeling: " + ", ".join(x["feature"] for x in excluded_features))

    for c in features:
        nunique = df[c].nunique(dropna=True)
        if nunique <= 1:
            warnings.append(f"'{c}' is constant or nearly empty - it cannot help the model.")
        if nunique == rows_before:
            warnings.append(f"'{c}' appears to be an ID — every row has a unique value, so it'll memorize the target.")
        # high correlation with target (numeric only)
        if pd.api.types.is_numeric_dtype(sub_clean[c]) and pd.api.types.is_numeric_dtype(y):
            try:
                corr = sub_clean[c].corr(y)
                if corr is not None and abs(corr) > 0.99:
                    warnings.append(f"'{c}' is almost perfectly correlated with target ({corr:+.2f}) — possible leakage.")
            except Exception:
                pass

    numeric_features = numeric_features_for_plan
    if len(numeric_features) >= 2:
        corr = sub_clean[numeric_features].corr(numeric_only=True).abs()
        for i, a in enumerate(numeric_features):
            for b in numeric_features[i + 1:]:
                val = corr.loc[a, b]
                if pd.notna(val) and val >= 0.85:
                    multicollinearity.append({
                        "feature_a": a,
                        "feature_b": b,
                        "correlation": float(val),
                        "severity": "high" if val >= 0.95 else "medium",
                    })
        if multicollinearity:
            warnings.append(f"Multicollinearity detected in {len(multicollinearity)} feature pair(s). Linear models may be unstable.")

    # ---- enriched validation checks ----

    # 1. Missing values
    vc_missing = {
        "key": "missing_values",
        "label": "Missing values",
        "status": "warning" if missing_report else "ok",
        "detail": f"{len(missing_report)} column(s) have missing values — incomplete rows will be dropped for modeling." if missing_report else "No missing values in selected modeling columns.",
        "type": "data",
        "causes": ["incomplete records", "import errors"] if missing_report else [],
        "fixes": [
            {"label": "Impute or drop missing values", "description": "Data → Manual Transforms — fill or drop rows with missing values", "route": "data", "section": "manual_transforms"},
        ] if missing_report else [],
    }

    # 2. Category consistency (dirty target labels)
    cat_dirty_block = next((b for b in hard_blocks if b["code"] == "target_categories_dirty"), None)
    vc_categories = {
        "key": "category_consistency",
        "label": "Category consistency",
        "status": "block" if cat_dirty_block else "ok",
        "detail": f"Target '{target}' has similar category labels that must be merged before training." if cat_dirty_block else "No target category conflicts detected.",
        "type": "data",
        "causes": ["typos", "inconsistent label formatting"] if cat_dirty_block else [],
        "fixes": [
            {"label": "Standardize categories", "description": "Data → Category Standardization — merge similar labels in the target column", "route": "data", "section": "category_standardization"},
        ] if cat_dirty_block else [],
    }

    # 3. Class balance
    cb_status = "ok"
    cb_detail = "Not applicable for regression." if task != "classification" else "No severe class imbalance detected."
    cb_causes = []
    cb_fixes = []
    if task == "classification" and n_per_class:
        _smallest = min(n_per_class.values())
        _total = sum(n_per_class.values())
        _largest = max(n_per_class.values())
        _ratio = _largest / _total if _total else 0
        _is_multi = len(n_per_class) > 2
        binary_block = next((b for b in hard_blocks if b["code"] == "binary_target_single_class"), None)
        eff_block = next((b for b in hard_blocks if b["code"] == "target_single_effective_class"), None)
        if binary_block or eff_block:
            cb_status = "block"
            cb_detail = "Target has only one effective class for the current setup — cannot train."
            cb_causes = ["class count collapsed to one due to binary mode or missing categories"]
            cb_fixes = [
                {"label": "Standardize categories", "description": "Data → Category Standardization — merge similar labels to restore valid classes", "route": "data", "section": "category_standardization"},
                {"label": "Change positive class", "description": "Models → Target handling — select a different positive class", "route": "models", "section": "target_options"},
            ]
        elif _smallest < 5:
            cb_status = "warning"
            _ex = "example" if _smallest == 1 else "examples"
            cb_detail = f"Smallest class has only {_smallest} {_ex}."
            if _is_multi:
                cb_detail += " Multiclass target detected; use binary mode if the analysis needs one selected category versus the rest."
            cb_causes = ["messy or split category labels", "real class imbalance", "very small dataset"]
            cb_fixes = [
                {"label": "Standardize categories", "description": "Data → Category Standardization — merge similar labels to consolidate small classes", "route": "data", "section": "category_standardization"},
                {"label": "Use binary mode", "description": "Models → Target handling — treat one class vs. rest", "route": "models", "section": "target_options"},
                {"label": "Use balanced class weights", "description": "Models → Imbalance handling — compensate for unequal class sizes", "route": "models", "section": "class_weight"},
            ]
        elif _ratio >= 0.75:
            cb_status = "warning"
            cb_detail = f"Class imbalance detected — largest class is {_ratio:.0%} of usable rows."
            cb_causes = ["real class imbalance in data"]
            cb_fixes = [
                {"label": "Use balanced class weights", "description": "Models → Imbalance handling — compensate for class size differences", "route": "models", "section": "class_weight"},
                {"label": "Standardize categories", "description": "Data → Category Standardization — check if messy labels are splitting a class", "route": "data", "section": "category_standardization"},
            ]
    vc_class_balance = {
        "key": "class_balance",
        "label": "Class balance",
        "status": cb_status,
        "detail": cb_detail,
        "type": "modeling",
        "causes": cb_causes,
        "fixes": cb_fixes,
    }

    # 4. Multicollinearity
    vc_multicollinearity = {
        "key": "multicollinearity",
        "label": "Multicollinearity",
        "status": "warning" if multicollinearity else "ok",
        "detail": f"{len(multicollinearity)} highly correlated feature pair(s) detected — linear models may be unstable." if multicollinearity else "No high numeric feature correlations detected.",
        "type": "data",
        "causes": ["redundant features", "derived columns from same source"] if multicollinearity else [],
        "fixes": [
            {"label": "Drop correlated features", "description": "Data → Manual Transforms — remove one column from each correlated pair", "route": "data", "section": "manual_transforms"},
            {"label": "Use Logistic Regression", "description": "Models → Algorithms — regularized models tolerate collinearity better", "route": "models", "section": "algorithms"},
        ] if multicollinearity else [],
    }

    # 5. Train/test split (always ok)
    vc_split = {
        "key": "train_test_split",
        "label": "Train/test split configured",
        "status": "ok",
        "detail": f"Train {int((1 - test_size) * 100)}% / test {int(test_size * 100)}%" + (" with stratification." if task == "classification" and stratify_split else "."),
        "type": "modeling",
        "causes": [],
        "fixes": [],
    }

    validation_checks = [vc_missing, vc_categories, vc_class_balance, vc_multicollinearity, vc_split]

    return {
        "task": task,
        "target": target,
        "features": features,
        "excluded_features": excluded_features,
        "rows_used": rows_after,
        "rows_dropped": dropped,
        "encoding": encoding,
        "scaling": scaling,
        "numeric_preprocessing": {
            "scaling": scaling_method,
            "effective_scaling": effective_scaling,
            "log_columns": log_columns,
            "integer_columns": integer_columns,
            "numeric_features": numeric_features_for_plan,
            "skewed_columns": skewed_columns,
        },
        "missing_report": missing_report,
        "class_balance": {str(k): int(v) for k, v in (n_per_class or {}).items()} if task == "classification" else None,
        "target_classes": target_classes,
        "target_mode": target_mode if task == "classification" else None,
        "positive_class": positive_class if task == "classification" else None,
        "target_context": target_context,
        "split": {
            "train_size": 1 - test_size,
            "test_size": test_size,
            "stratified": bool(task == "classification" and stratify_split),
        },
        "class_weight": class_weight if task == "classification" else None,
        "model_params": {a: _model_default_params(a) for a in algorithms or [] if a in ALGORITHM_CATALOG},
        "multicollinearity": multicollinearity,
        "validation_checks": validation_checks,
        "hard_blocks": hard_blocks,
        "warnings": warnings,
    }


def _original_feature_name(encoded_feature, original_features, sep="="):
    if encoded_feature in original_features:
        return encoded_feature
    if sep in encoded_feature:
        candidate = encoded_feature.split(sep, 1)[0]
        if candidate in original_features:
            return candidate
    return encoded_feature

def _feature_influence_from_model(clf, encoded_columns, original_features, algo):
    rows = {}
    if hasattr(clf, "feature_importances_"):
        for col, value in zip(encoded_columns, clf.feature_importances_):
            original = _original_feature_name(col, original_features)
            entry = rows.setdefault(original, {"feature": original, "strength": 0.0, "direction_score": 0.0})
            entry["strength"] += abs(float(value))
    elif hasattr(clf, "coef_"):
        coef_arr = np.asarray(clf.coef_)
        if coef_arr.ndim == 2 and coef_arr.shape[0] > 1:
            coef = np.mean(np.abs(coef_arr), axis=0)
            signed_coef = np.mean(coef_arr, axis=0)
        else:
            coef = coef_arr.ravel()
            signed_coef = coef
        for col, value in zip(encoded_columns, coef):
            original = _original_feature_name(col, original_features)
            entry = rows.setdefault(original, {"feature": original, "strength": 0.0, "direction_score": 0.0})
            entry["strength"] += abs(float(value))
            entry["direction_score"] += float(signed_coef[list(encoded_columns).index(col)])

    if not rows:
        return []
    max_strength = max((v["strength"] for v in rows.values()), default=1.0) or 1.0
    influence = []
    for entry in rows.values():
        strength = entry["strength"]
        direction = None
        if algo in ("linear", "logistic"):
            signed = entry.get("direction_score", 0.0)
            if abs(signed) < strength * 0.15:
                direction = "mixed"
            else:
                direction = "positive" if signed > 0 else "negative"
        influence.append({
            "feature": entry["feature"],
            "strength": float(strength),
            "relative_strength": float(strength / max_strength),
            "direction": direction,
        })
    return sorted(influence, key=lambda x: -x["strength"])[:15]


def _serialize_estimator(model):
    return base64.b64encode(pickle.dumps(model)).decode("ascii")


def _deserialize_estimator(payload):
    return pickle.loads(base64.b64decode(payload.encode("ascii")))

def _apply_numeric_preprocessing_frame(X_raw, numeric_config):
    X = X_raw.copy()
    numeric_config = numeric_config or {}
    log_columns = set(numeric_config.get("log_columns") or [])
    integer_columns = set(numeric_config.get("integer_columns") or [])
    applied = []
    for col in X.columns:
        if col not in log_columns and col not in integer_columns:
            continue
        numeric = pd.to_numeric(X[col], errors="coerce")
        if col in integer_columns:
            numeric = numeric.round()
            X[col] = numeric
            applied.append({"column": col, "transform": "integer_enforcement"})
        if col in log_columns:
            min_val = numeric.min(skipna=True)
            shift = float(abs(min_val) + 1) if pd.notna(min_val) and min_val <= -1 else 0.0
            X[col] = np.log1p(numeric + shift)
            applied.append({"column": col, "transform": "log1p", "shift": shift})
    return X, applied


def _whatif_input_matrix(bundle, inputs):
    """Apply the same encoding/scaling contract used when the model was trained."""
    sep = bundle.get("dummy_sep", "=")
    raw_features = bundle.get("raw_features") or []
    original_features = bundle.get("original_features") or [f.get("name") for f in raw_features]
    row = {}
    for feature in raw_features:
        name = feature.get("name")
        if not name:
            continue
        value = inputs.get(name, feature.get("default") if feature.get("kind") == "categorical" else feature.get("mean"))
        if feature.get("kind") == "categorical":
            row[name] = "" if value is None else str(value)
        else:
            try:
                row[name] = float(value)
            except Exception:
                row[name] = float(feature.get("mean") or 0)
    for name in original_features:
        if name not in row:
            try:
                row[name] = float(inputs.get(name, 0))
            except Exception:
                row[name] = inputs.get(name, "")

    X_raw = pd.DataFrame([row], columns=original_features)
    X_raw, _ = _apply_numeric_preprocessing_frame(X_raw, bundle.get("numeric_preprocessing"))
    X = pd.get_dummies(X_raw, drop_first=True, prefix_sep=sep)
    encoded_features = bundle.get("features") or bundle.get("encoded_features") or X.columns.tolist()
    X = X.reindex(columns=encoded_features, fill_value=0)

    if bundle.get("scaled"):
        scaler_kind = bundle.get("scaler_kind") or "standard"
        means = bundle.get("feature_means") or {}
        stds = bundle.get("feature_stds") or {}
        mins = bundle.get("feature_mins") or {}
        ranges = bundle.get("feature_ranges") or {}
        for col in X.columns:
            if scaler_kind == "minmax":
                scale = ranges.get(col, 1) or 1
                X[col] = (X[col].astype(float) - mins.get(col, 0)) / scale
            else:
                scale = stds.get(col, 1) or 1
                X[col] = (X[col].astype(float) - means.get(col, 0)) / scale
    return X


def _train_one(df, target, features, algo, test_size, plan, model_params=None):
    """Train a single model. Returns a dict with metrics + importance.

    The transparent preprocessing plan is reused so every algorithm in a
    multi-train run sees an identical pipeline.
    """
    data = df[features + [target]].dropna()
    params = _sanitize_model_params(algo, model_params)
    X_raw = data[features].copy()
    X, numeric_applied = _apply_numeric_preprocessing_frame(X_raw, plan.get("numeric_preprocessing"))
    y = data[target]

    X = pd.get_dummies(X, drop_first=True, prefix_sep="=").astype(float)

    is_classification = plan["task"] == "classification"
    class_labels = None
    if is_classification:
        if plan.get("target_mode") == "binary":
            positive = str(plan.get("positive_class"))
            y = y.astype(str).eq(positive).astype(int)
            class_labels = [f"not {positive}", positive]
        elif pd.api.types.is_bool_dtype(y):
            class_labels = ["False", "True"]
            y = y.astype(int)
        elif not pd.api.types.is_numeric_dtype(y):
            labels = sorted(y.dropna().astype(str).unique().tolist())
            class_labels = labels
            y = LabelEncoder().fit_transform(y.astype(str))

    effective_scaling = (plan.get("numeric_preprocessing") or {}).get("effective_scaling")
    needs_scaling = ALGORITHM_CATALOG.get(algo, {}).get("needs_scaling", False)
    scaler_kind = effective_scaling if effective_scaling in ("standard", "minmax") else ("standard" if needs_scaling else "none")
    scaler = None
    if scaler_kind != "none":
        scaler = MinMaxScaler() if scaler_kind == "minmax" else StandardScaler()
        X_scaled = pd.DataFrame(scaler.fit_transform(X), columns=X.columns, index=X.index)
    else:
        X_scaled = X

    stratify = None
    if is_classification and plan.get("split", {}).get("stratified"):
        counts = pd.Series(y).value_counts()
        if len(counts) > 1 and int(counts.min()) >= 2:
            stratify = y

    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=test_size, random_state=42, stratify=stratify
    )

    if is_classification:
        if algo == "rf":
            clf = RandomForestClassifier(n_estimators=params["n_estimators"], max_depth=params["max_depth"], min_samples_leaf=params["min_samples_leaf"], random_state=42, class_weight=plan.get("class_weight"))
        elif algo == "tree":
            clf = DecisionTreeClassifier(max_depth=params["max_depth"], min_samples_leaf=params["min_samples_leaf"], random_state=42, class_weight=plan.get("class_weight"))
        elif algo == "logistic":
            clf = LogisticRegression(C=params["C"], max_iter=params["max_iter"], class_weight=plan.get("class_weight"))
        else:
            raise ValueError(f"algorithm '{algo}' not supported for classification")
        clf.fit(X_train, y_train)
        y_pred = clf.predict(X_test)
        y_train_pred = clf.predict(X_train)
        metrics = {
            "task": "classification",
            "train_accuracy": float(accuracy_score(y_train, y_train_pred)),
            "train_precision": float(precision_score(y_train, y_train_pred, average="weighted", zero_division=0)),
            "train_recall": float(recall_score(y_train, y_train_pred, average="weighted", zero_division=0)),
            "train_f1": float(f1_score(y_train, y_train_pred, average="weighted", zero_division=0)),
            "accuracy": float(accuracy_score(y_test, y_pred)),
            "precision": float(precision_score(y_test, y_pred, average="weighted", zero_division=0)),
            "recall": float(recall_score(y_test, y_pred, average="weighted", zero_division=0)),
            "f1": float(f1_score(y_test, y_pred, average="weighted", zero_division=0)),
            "split": plan.get("split"),
            "split_rows": {"train": int(len(X_train)), "test": int(len(X_test))},
            "class_weight": plan.get("class_weight"),
            "model_params": params,
        }
        metrics["generalization_gap"] = float(metrics["train_accuracy"] - metrics["accuracy"])
        if len(np.unique(y)) == 2 and hasattr(clf, "predict_proba"):
            try:
                y_proba = clf.predict_proba(X_test)[:, 1]
                metrics["auc"] = float(roc_auc_score(y_test, y_proba))
            except Exception:
                pass
        metrics["confusion_matrix"] = confusion_matrix(y_test, y_pred).tolist()
    else:
        if algo == "rf":
            clf = RandomForestRegressor(n_estimators=params["n_estimators"], max_depth=params["max_depth"], min_samples_leaf=params["min_samples_leaf"], random_state=42)
        elif algo == "tree":
            clf = DecisionTreeRegressor(max_depth=params["max_depth"], min_samples_leaf=params["min_samples_leaf"], random_state=42)
        elif algo == "linear":
            clf = LinearRegression(fit_intercept=params["fit_intercept"])
        else:
            raise ValueError(f"algorithm '{algo}' not supported for regression")
        clf.fit(X_train, y_train)
        y_pred = clf.predict(X_test)
        y_train_pred = clf.predict(X_train)
        metrics = {
            "task": "regression",
            "train_r2": float(r2_score(y_train, y_train_pred)),
            "train_rmse": float(np.sqrt(mean_squared_error(y_train, y_train_pred))),
            "train_mae": float(np.mean(np.abs(y_train - y_train_pred))),
            "r2": float(r2_score(y_test, y_pred)),
            "rmse": float(np.sqrt(mean_squared_error(y_test, y_pred))),
            "mae": float(np.mean(np.abs(y_test - y_pred))),
            "split": plan.get("split"),
            "split_rows": {"train": int(len(X_train)), "test": int(len(X_test))},
            "model_params": params,
        }
        metrics["generalization_gap"] = float(metrics["train_r2"] - metrics["r2"])

    influence = _feature_influence_from_model(clf, X.columns.tolist(), features, algo)

    numeric_encoded = X.apply(pd.to_numeric, errors="coerce").fillna(0).astype(float)
    feature_means = {c: float(scaler.mean_[i]) if scaler is not None and hasattr(scaler, "mean_") else float(numeric_encoded[c].mean())
                     for i, c in enumerate(X.columns)}
    feature_stds = {c: float(scaler.scale_[i]) if scaler is not None and hasattr(scaler, "scale_") else float(numeric_encoded[c].std() or 1)
                    for i, c in enumerate(X.columns)}
    feature_mins = {c: float(scaler.data_min_[i]) if scaler is not None and hasattr(scaler, "data_min_") else float(numeric_encoded[c].min()) for i, c in enumerate(X.columns)}
    feature_ranges = {c: float(scaler.data_range_[i]) if scaler is not None and hasattr(scaler, "data_range_") else float((numeric_encoded[c].max() - numeric_encoded[c].min()) or 1) for i, c in enumerate(X.columns)}
    coefficients = {
        "prediction_kind": "fitted_model",
        "estimator_b64": _serialize_estimator(clf),
        "algorithm": algo,
        "features": X.columns.tolist(),
        "encoded_features": X.columns.tolist(),
        "original_features": features,
        "task": metrics["task"],
        "target": target,
        "target_mode": plan.get("target_mode"),
        "positive_class": plan.get("positive_class"),
        "class_labels": class_labels,
        "model_classes": np.asarray(getattr(clf, "classes_", [])).ravel().tolist() if hasattr(clf, "classes_") else None,
        "target_context": plan.get("target_context"),
        "feature_means": feature_means,
        "feature_stds": feature_stds,
        "feature_mins": feature_mins,
        "feature_ranges": feature_ranges,
        "raw_features": _whatif_raw_features(X_raw),
        "dummy_sep": "=",
        "scaled": scaler is not None,
        "scaler_kind": scaler_kind if scaler is not None else None,
        "numeric_preprocessing": plan.get("numeric_preprocessing"),
        "numeric_transforms_applied": numeric_applied,
        "model_behavior": "stepwise" if algo in ("tree", "rf") else "smooth",
        "preprocessing_pipeline": {
            "encoding": plan.get("encoding"),
            "scaling": plan.get("scaling"),
            "numeric_preprocessing": plan.get("numeric_preprocessing"),
            "features": features,
            "encoded_features": X.columns.tolist(),
        },
    }

    if algo in ("linear", "logistic") and hasattr(clf, "coef_"):
        coef_array = np.asarray(clf.coef_)
        coefficients.update({
            "coef": coef_array.ravel().tolist(),
            "coef_matrix": coef_array.tolist(),
            "intercept": float(np.asarray(clf.intercept_).ravel()[0]) if hasattr(clf, "intercept_") else 0.0,
            "intercepts": np.asarray(clf.intercept_).ravel().tolist() if hasattr(clf, "intercept_") else [0.0],
            "classes": np.asarray(getattr(clf, "classes_", [])).ravel().tolist() if hasattr(clf, "classes_") else None,
        })

    return {
        "metrics": metrics,
        "importance": influence,
        "coefficients": coefficients,
        "encoded_features": X.columns.tolist(),
        "model_params": params,
    }

def _whatif_raw_features(X_raw):
    features = []
    for col in X_raw.columns:
        s = X_raw[col]
        present = s.dropna()
        if pd.api.types.is_numeric_dtype(s):
            mean = float(present.mean()) if len(present) else 0.0
            std = float(present.std() or 1.0) if len(present) else 1.0
            features.append({
                "name": col,
                "kind": "numeric",
                "mean": mean,
                "std": std,
                "min": float(present.min()) if len(present) else mean - 2 * std,
                "max": float(present.max()) if len(present) else mean + 2 * std,
            })
        else:
            counts = present.astype(str).value_counts()
            values = counts.index.tolist()
            features.append({
                "name": col,
                "kind": "categorical",
                "values": values[:100],
                "default": values[0] if values else "",
            })
    return features


@app.route("/api/datasets/<ds_id>/models/preprocessing_plan", methods=["POST"])
def preprocessing_plan(ds_id):
    """Return the preprocessing plan for a target+features+algos config without training."""
    body = request.get_json() or {}
    target = body.get("target")
    features = body.get("features") or []
    algorithms = body.get("algorithms") or []
    target_options = body.get("target_options") or {}
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)
        try:
            plan = _build_preprocessing_plan(df, target, features, algorithms, target_options)
        except ValueError as e:
            return {"error": str(e)}, 400
        return jsonify(clean_json(plan))
    finally:
        s.close()


@app.route("/api/datasets/<ds_id>/models/train", methods=["POST"])
def train_model(ds_id):
    """Train a single model. Kept for backward compat — train_many is preferred."""
    body = request.get_json() or {}
    target = body.get("target")
    features = body.get("features") or []
    algo = body.get("algorithm", "logistic")
    target_options = body.get("target_options") or {}
    model_params = body.get("model_params") or {}
    test_size = min(max(_parse_num(body.get("test_size", target_options.get("test_size")), 0.2, float), 0.05), 0.5)

    s = db()
    try:
        sess, _ = _auth_from_request(s)
        limited = _guest_limit_response(sess)
        if limited:
            return limited
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)
        if not features:
            features = [c for c in df.select_dtypes(include=[np.number]).columns if c != target]
        try:
            plan = _build_preprocessing_plan(df, target, features, [algo], target_options)
        except ValueError as e:
            return {"error": str(e)}, 400
        if plan.get("hard_blocks"):
            return {"error": plan["hard_blocks"][0]["message"], "hard_blocks": plan["hard_blocks"], "preprocessing_plan": plan}, 400
        try:
            result = _train_one(df, target, plan["features"], algo, test_size, plan, model_params.get(algo, model_params))
        except ValueError as e:
            return {"error": str(e)}, 400

        model_id = str(uuid.uuid4())
        m = Model(
            id=model_id,
            dataset_id=ds_id,
            name=f"{algo}_{target}",
            algorithm=algo,
            target=target,
            features=jdump(plan["features"]),
            metrics=jdump(clean_json(result["metrics"])),
            feature_importance=jdump(clean_json(result["importance"])),
            coefficients=jdump(clean_json(result["coefficients"])) if result["coefficients"] else None,
        )
        s.add(m)
        log_activity(
            s,
            ds_id,
            "model",
            f"Trained {_algo_label_for_task(algo, plan['task'])} model for '{target}'",
            detail={"category": "model", "action_type": "train_model", "algorithm": algo, "target": target, "features": plan["features"], "parameters": result["model_params"], "preprocessing": plan},
            ref_type="model",
            ref_id=model_id,
            commit=False,
        )
        if sess and sess.is_guest:
            sess.guest_usage_count = int(sess.guest_usage_count or 0) + 1
        s.commit()

        return jsonify(clean_json({
            "id": model_id,
            "algorithm": algo,
            "target": target,
            "features": plan["features"],
            "metrics": result["metrics"],
            "feature_importance": result["importance"],
            "feature_influence": result["importance"],
            "preprocessing_plan": plan,
            "model_params": result["model_params"],
            "has_whatif": result["coefficients"] is not None,
            "session": _session_payload(sess) if sess else None,
        }))
    finally:
        s.close()


@app.route("/api/datasets/<ds_id>/models/train_many", methods=["POST"])
def train_many_models(ds_id):
    """Train multiple algorithms on the same target+features config and return
    a comparison-ready array. Each model is persisted individually so it shows
    up in the model list and can be opened in What-if."""
    body = request.get_json() or {}
    target = body.get("target")
    features = body.get("features") or []
    algorithms = body.get("algorithms") or ["logistic"]
    target_options = body.get("target_options") or {}
    model_params = body.get("model_params") or {}
    test_size = min(max(_parse_num(body.get("test_size", target_options.get("test_size")), 0.2, float), 0.05), 0.5)

    s = db()
    try:
        sess, _ = _auth_from_request(s)
        limited = _guest_limit_response(sess)
        if limited:
            return limited
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)
        try:
            plan = _build_preprocessing_plan(df, target, features, algorithms, target_options)
        except ValueError as e:
            return {"error": str(e)}, 400
        if plan.get("hard_blocks"):
            return {"error": plan["hard_blocks"][0]["message"], "hard_blocks": plan["hard_blocks"], "preprocessing_plan": plan}, 400

        # task→algorithm filter so we don't try regression algos on a classification target
        valid = []
        skipped = []
        for a in algorithms:
            cat = ALGORITHM_CATALOG.get(a)
            if not cat:
                skipped.append({"algorithm": a, "reason": f"unknown algorithm '{a}'"})
                continue
            if cat["task"] != "both" and cat["task"] != plan["task"]:
                skipped.append({"algorithm": a, "reason": f"{cat['label']} only supports {cat['task']}"})
                continue
            valid.append(a)
        if not valid:
            return {"error": "no compatible algorithm for this target", "skipped": skipped}, 400

        results = []
        for algo in valid:
            try:
                r = _train_one(df, target, plan["features"], algo, test_size, plan, model_params.get(algo))
                model_id = str(uuid.uuid4())
                m = Model(
                    id=model_id,
                    dataset_id=ds_id,
                    name=f"{algo}_{target}",
                    algorithm=algo,
                    target=target,
                    features=jdump(plan["features"]),
                    metrics=jdump(clean_json(r["metrics"])),
                    feature_importance=jdump(clean_json(r["importance"])),
                    coefficients=jdump(clean_json(r["coefficients"])) if r["coefficients"] else None,
                )
                s.add(m)
                log_activity(
                    s,
                    ds_id,
                    "model",
                    f"Trained {_algo_label_for_task(algo, plan['task'])} model for '{target}'",
                    detail={"category": "model", "action_type": "train_model", "algorithm": algo, "target": target, "features": plan["features"], "parameters": r["model_params"], "preprocessing": plan},
                    ref_type="model",
                    ref_id=model_id,
                    commit=False,
                )
                s.commit()
                results.append({
                    "id": model_id,
                    "algorithm": algo,
                    "label": _algo_label_for_task(algo, plan["task"]),
                    "target": target,
                    "features": plan["features"],
                    "metrics": r["metrics"],
                    "feature_importance": r["importance"],
                    "feature_influence": r["importance"],
                    "model_params": r["model_params"],
                    "has_whatif": r["coefficients"] is not None,
                })
            except Exception as e:
                skipped.append({"algorithm": algo, "reason": friendly_error_message(e, "This model could not be trained with the current target and feature setup.")})

        if results and sess and sess.is_guest:
            sess.guest_usage_count = int(sess.guest_usage_count or 0) + 1
            s.commit()

        return jsonify(clean_json({
            "preprocessing_plan": plan,
            "models": results,
            "skipped": skipped,
            "session": _session_payload(sess) if sess else None,
        }))
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/models", methods=["GET"])
def list_models(ds_id):
    s = db()
    try:
        rows = s.query(Model).filter_by(dataset_id=ds_id).order_by(Model.created_at.desc()).all()
        return jsonify([{
            "id": r.id, "name": r.name, "algorithm": r.algorithm,
            "target": r.target,
            "metrics": jload(r.metrics),
            "feature_importance": jload(r.feature_importance),
            "feature_influence": jload(r.feature_importance),
            "features": jload(r.features),
            "has_whatif": r.coefficients is not None,
            "preprocessing_pipeline": (jload(r.coefficients) or {}).get("preprocessing_pipeline") if r.coefficients else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows])
    finally:
        s.close()

@app.route("/api/models/<model_id>", methods=["DELETE"])
def delete_model(model_id):
    s = db()
    try:
        m = s.query(Model).filter_by(id=model_id).first()
        if not m:
            return {"error": "model not found"}, 404
        dataset_id = m.dataset_id
        linked_logs = s.query(ActivityLog).filter_by(ref_type="model", ref_id=model_id).all()
        deleted_logs = len(linked_logs)
        for entry in linked_logs:
            s.delete(entry)
        s.delete(m)
        s.commit()
        return jsonify({"ok": True, "id": model_id, "dataset_id": dataset_id, "deleted_logs": deleted_logs})
    finally:
        s.close()

@app.route("/api/models/<model_id>/prepare_whatif", methods=["POST"])
def prepare_model_for_whatif(model_id):
    """Backfill prediction metadata for older models so What-if can use them."""
    s = db()
    try:
        m = s.query(Model).filter_by(id=model_id).first()
        if not m:
            return {"error": "model not found"}, 404
        if m.coefficients:
            return jsonify({"ok": True, "id": m.id, "has_whatif": True})
        if m.algorithm not in ALGORITHM_CATALOG:
            return {"error": "Unsupported model algorithm."}, 400
        ds = s.query(Dataset).filter_by(id=m.dataset_id).first()
        if not ds:
            return {"error": "dataset not found"}, 404
        features = jload(m.features) or []
        metrics = jload(m.metrics) or {}
        params = metrics.get("model_params") or _model_default_params(m.algorithm)
        target_options = {
            "test_size": (metrics.get("split") or {}).get("test_size", 0.2),
            "stratify": (metrics.get("split") or {}).get("stratified", True),
        }
        if metrics.get("class_weight"):
            target_options["class_weight"] = metrics.get("class_weight")
        df = df_from_dataset(ds, s)
        plan = _build_preprocessing_plan(df, m.target, features, [m.algorithm], target_options)
        result = _train_one(df, m.target, plan["features"], m.algorithm, target_options["test_size"], plan, params)
        if not result["coefficients"]:
            return {"error": "Could not prepare this model for What-if."}, 400
        m.coefficients = jdump(clean_json(result["coefficients"]))
        m.feature_importance = jdump(clean_json(result["importance"]))
        m.metrics = jdump(clean_json(result["metrics"]))
        log_activity(
            s,
            m.dataset_id,
            "model",
            f"Prepared {m.name} for What-if analysis",
            detail={"category": "model", "action_type": "prepare_whatif", "model_id": m.id, "features": plan["features"]},
            ref_type="model",
            ref_id=m.id,
            commit=False,
        )
        s.commit()
        return jsonify({"ok": True, "id": m.id, "has_whatif": True})
    finally:
        s.close()

# --- What-if ---

def _whatif_extrapolation_risk(inputs, raw_features):
    levels = {"low": 0, "medium": 1, "high": 2}
    out_of_range = []
    overall = "low"
    for feature in raw_features or []:
        if feature.get("kind") == "categorical":
            continue
        name = feature.get("name")
        if name not in inputs:
            continue
        try:
            value = float(inputs.get(name))
            lo = float(feature.get("min"))
            hi = float(feature.get("max"))
        except Exception:
            continue
        span = hi - lo
        if span <= 0:
            span = max(abs(hi), abs(lo), 1.0)
        distance = 0.0
        direction = None
        boundary = None
        if value < lo:
            distance = lo - value
            direction = "below"
            boundary = lo
        elif value > hi:
            distance = value - hi
            direction = "above"
            boundary = hi
        if distance <= 0:
            continue
        ratio = distance / span
        risk = "medium" if ratio <= 0.1 else "high"
        if levels[risk] > levels[overall]:
            overall = risk
        out_of_range.append({
            "feature": name,
            "value": value,
            "min": lo,
            "max": hi,
            "distance": distance,
            "direction": direction,
            "boundary": boundary,
            "deviation_ratio": ratio,
            "risk": risk,
        })
    return {
        "overall_risk": overall,
        "out_of_range_features": [item["feature"] for item in out_of_range],
        "details": out_of_range,
        "message": "Some inputs exceed dataset boundaries. Predictions may be unreliable." if out_of_range else None,
    }

@app.route("/api/models/<model_id>/predict", methods=["POST"])
def whatif_predict(model_id):
    """Make a live prediction from any trained model using user-supplied values."""
    body = request.get_json() or {}
    inputs = body.get("inputs", {})  # {feature_name: value}

    s = db()
    try:
        m = s.query(Model).filter_by(id=model_id).first()
        if not m:
            return {"error": "model not found"}, 404
        coef = jload(m.coefficients)
        if not coef:
            return {"error": "what-if not supported for this model"}, 400

        extrapolation = _whatif_extrapolation_risk(inputs, coef.get("raw_features") or [])
        if coef.get("estimator_b64"):
            estimator = _deserialize_estimator(coef["estimator_b64"])
            X_input = _whatif_input_matrix(coef, inputs)
            target_context = coef.get("target_context")
            behavior = coef.get("model_behavior") or ("stepwise" if m.algorithm in ("tree", "rf") else "smooth")
            note = "Tree-based models can change in steps as inputs cross learned split thresholds." if behavior == "stepwise" else None

            if coef.get("task") == "classification":
                predicted_raw = estimator.predict(X_input)[0]
                classes = list(coef.get("model_classes") or np.asarray(getattr(estimator, "classes_", [])).ravel().tolist())
                class_labels = coef.get("class_labels") or [str(c) for c in classes]
                positive = coef.get("positive_class")
                prob = None
                if hasattr(estimator, "predict_proba"):
                    probs = estimator.predict_proba(X_input)[0]
                    if coef.get("target_mode") == "binary":
                        positive_encoded = 1 if 1 in classes else classes[-1] if classes else predicted_raw
                        idx = classes.index(positive_encoded) if positive_encoded in classes else int(np.argmax(probs))
                        prob = float(probs[idx])
                    else:
                        idx = classes.index(predicted_raw) if predicted_raw in classes else int(np.argmax(probs))
                        prob = float(probs[idx])
                if coef.get("target_mode") == "binary":
                    predicted_class = positive if str(predicted_raw) in ("1", "1.0", "True", "true") else class_labels[0] if class_labels else str(predicted_raw)
                else:
                    try:
                        predicted_class = class_labels[int(predicted_raw)]
                    except Exception:
                        predicted_class = str(predicted_raw)
                prob = 1.0 if prob is None else prob
                return jsonify(clean_json({
                    "prediction": prob,
                    "kind": "probability",
                    "risk": "high" if prob > 0.6 else "medium" if prob > 0.35 else "low",
                    "positive_class": positive if coef.get("target_mode") == "binary" else None,
                    "predicted_class": predicted_class,
                    "class_labels": class_labels,
                    "model_behavior": behavior,
                    "note": note,
                    "extrapolation": extrapolation,
                }))

            y_hat = float(estimator.predict(X_input)[0])
            warning = None
            if target_context:
                lo = target_context.get("min")
                hi = target_context.get("max")
                span = (hi - lo) if lo is not None and hi is not None else None
                pad = max(span * 0.15, 1) if span is not None else 0
                if lo is not None and hi is not None and (y_hat < lo - pad or y_hat > hi + pad):
                    warning = "Prediction seems outside the target range seen in the dataset. Check preprocessing, feature values, or model fit."
            return jsonify(clean_json({
                "prediction": y_hat,
                "kind": "value",
                "target_context": target_context,
                "warning": warning,
                "model_behavior": behavior,
                "note": note,
                "extrapolation": extrapolation,
            }))

        features = coef["features"]
        weights = coef["coef"]
        intercept = coef["intercept"]
        means = coef["feature_means"]
        stds = coef.get("feature_stds") or {}
        sep = coef.get("dummy_sep", "=")
        extrapolation = _whatif_extrapolation_risk(inputs, coef.get("raw_features") or [])

        # build vector — use provided values, fallback to means
        x = []
        for f in features:
            raw_value = means.get(f, 0)
            raw_name = f.split(sep, 1)[0] if sep in f else f
            if sep in f and raw_name in inputs:
                expected = f.split(sep, 1)[1]
                raw_value = 1.0 if str(inputs.get(raw_name)) == expected else 0.0
            elif f in inputs:
                try:
                    raw_value = float(inputs[f])
                except Exception:
                    raw_value = means.get(f, 0)
            if coef.get("scaled"):
                scale = stds.get(f, 1) or 1
                x.append((raw_value - means.get(f, 0)) / scale)
            else:
                x.append(raw_value)

        z = intercept + sum(w * v for w, v in zip(weights, x))
        target_context = coef.get("target_context")
        warning = None
        if target_context and coef["task"] != "classification":
            lo = target_context.get("min")
            hi = target_context.get("max")
            span = (hi - lo) if lo is not None and hi is not None else None
            pad = max(span * 0.15, 1) if span is not None else 0
            if lo is not None and hi is not None and (z < lo - pad or z > hi + pad):
                warning = "Prediction seems outside the target range seen in the dataset. Check preprocessing, feature values, or model fit."
        if coef["task"] == "classification":
            matrix = coef.get("coef_matrix")
            intercepts = coef.get("intercepts")
            labels = coef.get("class_labels") or coef.get("classes") or []
            positive = coef.get("positive_class")
            if matrix and len(matrix) > 1:
                scores = np.asarray(intercepts or [0] * len(matrix), dtype=float) + np.dot(np.asarray(matrix, dtype=float), np.asarray(x, dtype=float))
                scores = scores - np.max(scores)
                probs = np.exp(scores) / np.sum(np.exp(scores))
                idx = labels.index(positive) if positive in labels else int(np.argmax(probs))
                prob = float(probs[idx])
            else:
                prob = float(1 / (1 + np.exp(-z)))
            return jsonify({
                "prediction": prob,
                "kind": "probability",
                "risk": "high" if prob > 0.6 else "medium" if prob > 0.35 else "low",
                "positive_class": coef.get("positive_class"),
                "class_labels": coef.get("class_labels"),
                "extrapolation": extrapolation,
            })
        return jsonify({
            "prediction": float(z),
            "kind": "value",
            "target_context": target_context,
            "warning": warning,
            "extrapolation": extrapolation,
        })
    finally:
        s.close()

@app.route("/api/models/<model_id>/scenarios", methods=["POST"])
def save_whatif_scenario(model_id):
    body = request.get_json() or {}
    name = (body.get("name") or "What-if scenario").strip()
    inputs = body.get("inputs") or {}
    prediction = body.get("prediction") or {}
    extrapolation = body.get("extrapolation") or prediction.get("extrapolation") or {}
    s = db()
    try:
        m = s.query(Model).filter_by(id=model_id).first()
        if not m:
            return {"error": "model not found"}, 404
        entry = log_activity(
            s,
            m.dataset_id,
            "whatif",
            f"Saved what-if scenario '{name}' for {m.name}",
            detail={
                "category": "model",
                "action_type": "save_whatif_scenario",
                "scenario_name": name,
                "model_id": model_id,
                "target": m.target,
                "inputs": clean_json(inputs),
                "prediction": clean_json(prediction),
                "out_of_range_features": clean_json(extrapolation.get("out_of_range_features") or []),
                "risk_level": extrapolation.get("overall_risk") or "low",
                "extrapolation": clean_json(extrapolation),
                "note": "User explored values outside dataset range" if extrapolation.get("out_of_range_features") else None,
            },
            ref_type="model",
            ref_id=model_id,
        )
        return jsonify(activity_payload(entry))
    finally:
        s.close()

@app.route("/api/models/<model_id>", methods=["GET"])
def get_model(model_id):
    s = db()
    try:
        m = s.query(Model).filter_by(id=model_id).first()
        if not m:
            return {"error": "not found"}, 404
        coef = jload(m.coefficients)
        features_info = None
        if coef:
            # give frontend sensible slider ranges: mean ± 2*std
            features_info = coef.get("raw_features") or []
            if not features_info:
                stds = coef.get("feature_stds") or {}
                for f in coef["features"]:
                    mean = coef["feature_means"].get(f, 0)
                    std = stds.get(f, 1)
                    features_info.append({
                        "name": f,
                        "kind": "numeric",
                        "mean": mean,
                        "std": std,
                        "min": mean - 2 * std,
                        "max": mean + 2 * std,
                    })
        return jsonify({
            "id": m.id,
            "name": m.name,
            "algorithm": m.algorithm,
            "target": m.target,
            "features": jload(m.features),
            "metrics": jload(m.metrics),
            "feature_importance": jload(m.feature_importance),
            "feature_influence": jload(m.feature_importance),
            "whatif_features": features_info,
            "positive_class": coef.get("positive_class") if coef else None,
            "class_labels": coef.get("class_labels") if coef else None,
            "target_context": coef.get("target_context") if coef else None,
        })
    finally:
        s.close()

# --- AI assistant (simple rule-based; swap for Claude API later) ---

_SIMUCAST_CAPABILITIES = [
    ("Data preparation", [
        "handle missing values", "handle outliers", "remove duplicates",
        "standardize categorical labels", "change column type", "rename columns",
        "drop rows/columns", "export cleaned data",
    ]),
    ("Feature engineering", ["create bins", "numeric formatting"]),
    ("Expand", [
        "decide whether expansion is needed", "recommend Bootstrap vs Synthetic",
        "configure target rows", "preview generated rows/stat changes", "apply expansion",
    ]),
    ("Describe", [
        "run descriptive statistics", "inspect variable cards", "view histogram/distribution",
        "view categorical distribution", "view correlation overview",
    ]),
    ("Analysis", [
        "run correlation", "run t-test", "run ANOVA", "run chi-square",
        "run PCA", "run K-means clustering",
    ]),
    ("Models", [
        "select target", "choose regression/classification algorithms", "configure validation split",
        "review preprocessing plan", "check multicollinearity", "check class balance",
        "train models", "compare metrics", "inspect feature importance", "check model health/overfitting",
    ]),
    ("What-if", [
        "use trained model", "adjust feature values", "compare baseline vs current prediction",
        "save scenario", "review extrapolation risk",
    ]),
    ("Report", [
        "include documentation logs", "include analysis results", "include model results",
        "include what-if scenarios", "include selected visualizations", "generate/export report",
    ]),
]

def _capability_text():
    lines = []
    for category, items in _SIMUCAST_CAPABILITIES:
        lines.append(f"{category}:")
        lines.extend(f"- {item}" for item in items)
    return "\n".join(lines)

def _plan_prompt_profile(ds, df, variables, session):
    profile = _dataset_profile(ds, df, variables)
    profile["column_names"] = list(df.columns)
    profile["detected_types"] = {v.get("name"): v.get("dtype") for v in variables or []}
    profile["missing_values"] = {v.get("name"): int(v.get("missing") or 0) for v in variables or []}
    profile["unique_counts"] = {v.get("name"): int(v.get("unique") or 0) for v in variables or []}
    profile["numeric_ranges"] = {}
    for v in variables or []:
        name = v.get("name")
        if name in df.columns and v.get("dtype") in ("numeric", "int", "float", "binary"):
            num = pd.to_numeric(df[name], errors="coerce").dropna()
            if len(num):
                profile["numeric_ranges"][name] = {
                    "min": float(num.min()),
                    "max": float(num.max()),
                    "mean": round(float(num.mean()), 4),
                }
    nums = list(profile["numeric_ranges"].keys())
    profile["correlations"] = []
    if len(nums) >= 2:
        try:
            corr = df[nums].corr(numeric_only=True).abs()
            pairs = []
            for i, a in enumerate(nums):
                for b in nums[i + 1:]:
                    val = corr.loc[a, b]
                    if pd.notna(val):
                        pairs.append({"columns": [a, b], "abs_r": round(float(val), 4)})
            profile["correlations"] = sorted(pairs, key=lambda x: x["abs_r"], reverse=True)[:8]
        except Exception:
            profile["correlations"] = []
    profile["target_candidates"] = [
        v.get("name") for v in variables or []
        if v.get("dtype") in ("binary", "category", "numeric", "int", "float")
        and int(v.get("unique") or 0) > 1
    ][:10]
    try:
        logs = (
            session.query(ActivityLog)
            .filter_by(dataset_id=ds.id)
            .order_by(ActivityLog.created_at.desc())
            .limit(12)
            .all()
        )
        profile["previous_completed_actions"] = [
            {
                "kind": log.kind,
                "summary": log.summary,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ]
    except Exception:
        profile["previous_completed_actions"] = []
    profile["simucast_supported_capabilities"] = [
        {"category": category, "features": items}
        for category, items in _SIMUCAST_CAPABILITIES
    ]
    return profile

def _parse_ai_plan_text(text):
    text = (text or "").strip()
    if not text:
        return []
    blocks = []
    current = []
    for line in text.splitlines():
        if re.match(r"^\s*\d+\.\s+", line) and current:
            blocks.append(current)
            current = [line]
        else:
            current.append(line)
    if current:
        blocks.append(current)

    category_pages = {
        "data preparation": "data",
        "feature engineering": "data",
        "expand": "expand",
        "data expansion": "expand",
        "describe": "describe",
        "analysis": "tests",
        "statistical analysis": "tests",
        "models": "models",
        "model": "models",
        "what-if": "whatif",
        "what if": "whatif",
        "report": "report",
    }
    feature_routes = [
        ("standardize categorical labels", "data", "data-section-category_standardization"),
        ("category standardization", "data", "data-section-category_standardization"),
        ("handle missing values", "data", "fix-cleaning-suggestions"),
        ("handle outliers", "data", "fix-cleaning-suggestions"),
        ("remove duplicates", "data", "fix-cleaning-suggestions"),
        ("drop rows/columns", "data", "data-section-manual_transforms"),
        ("change column type", "data", "data-section-manual_transforms"),
        ("rename columns", "data", "data-section-manual_transforms"),
        ("export cleaned data", "data", "data-section-raw_data"),
        ("create bins", "data", "data-section-feature_engineering"),
        ("numeric formatting", "data", "data-section-feature_engineering"),
        ("decide whether expansion is needed", "expand", "expand-section-controls"),
        ("recommend bootstrap vs synthetic", "expand", "expand-section-controls"),
        ("configure target rows", "expand", "expand-section-controls"),
        ("preview generated rows/stat changes", "expand", "expand-section-controls"),
        ("apply expansion", "expand", "expand-section-controls"),
        ("run descriptive statistics", "describe", "describe-section-variables"),
        ("inspect variable cards", "describe", "describe-section-variables"),
        ("view histogram/distribution", "describe", "describe-section-variables"),
        ("view categorical distribution", "describe", "describe-section-variables"),
        ("view correlation overview", "describe", "describe-section-variables"),
        ("run correlation", "tests", "fix-correlation-test"),
        ("run t-test", "tests", "fix-correlation-test"),
        ("run anova", "tests", "fix-correlation-test"),
        ("run chi-square", "tests", "fix-correlation-test"),
        ("run pca", "tests", "fix-correlation-test"),
        ("run k-means clustering", "tests", "fix-correlation-test"),
        ("select target", "models", "fix-target-handling"),
        ("choose regression/classification algorithms", "models", "fix-target-handling"),
        ("configure validation split", "models", "fix-target-handling"),
        ("review preprocessing plan", "models", "fix-target-handling"),
        ("check multicollinearity", "models", "fix-feature-selection"),
        ("check class balance", "models", "fix-target-handling"),
        ("train models", "models", "fix-target-handling"),
        ("compare metrics", "models", "fix-target-handling"),
        ("inspect feature importance", "models", "fix-feature-selection"),
        ("check model health/overfitting", "models", "fix-target-handling"),
        ("use trained model", "whatif", "whatif-section-controls"),
        ("adjust feature values", "whatif", "whatif-section-controls"),
        ("compare baseline vs current prediction", "whatif", "whatif-section-controls"),
        ("save scenario", "whatif", "whatif-section-controls"),
        ("review extrapolation risk", "whatif", "whatif-section-controls"),
        ("include documentation logs", "report", "ax-report-preview"),
        ("include analysis results", "report", "ax-report-preview"),
        ("include model results", "report", "ax-report-preview"),
        ("include what-if scenarios", "report", "ax-report-preview"),
        ("include selected visualizations", "report", "ax-report-preview"),
        ("generate/export report", "report", "ax-report-preview"),
    ]

    parsed = []
    for idx, block in enumerate(blocks, start=1):
        raw_title = re.sub(r"^\s*\d+\.\s*", "", block[0]).strip()
        fields = {}
        for line in block[1:]:
            match = re.match(r"^\s*([A-Za-z -]+):\s*(.*)$", line.strip())
            if match:
                fields[match.group(1).strip().lower()] = match.group(2).strip()
        title = raw_title or fields.get("title") or f"Step {idx}"
        category = fields.get("category", "").lower()
        use = fields.get("use", "")
        columns = [
            c.strip() for c in re.split(r",|;", fields.get("columns", ""))
            if c.strip() and c.strip().lower() not in {"none", "n/a", "all"}
        ]

        use_text = use.lower()
        page = category_pages.get(category)
        section = ""
        matched_feature = None
        for feature, route_page, route_section in feature_routes:
            if feature in use_text:
                page = route_page
                section = route_section
                matched_feature = feature
                break
        if not matched_feature:
            title_text = title.lower()
            for feature, route_page, route_section in feature_routes:
                if any(part in title_text for part in feature.split("/")[:1]):
                    page = route_page
                    section = route_section
                    matched_feature = feature
                    break
        if not page or not matched_feature:
            continue
        parsed.append({
            "id": f"{page}-{re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-') or idx}",
            "page": page,
            "section": section,
            "title": title,
            "rationale": fields.get("why", ""),
            "priority": "medium",
            "columns": columns,
        })
    return parsed

@app.route("/api/datasets/<ds_id>/ai/project_plan", methods=["POST"])
def ai_project_plan(ds_id):
    """Generate an end-to-end guided workflow plan for the current dataset stage."""
    body = request.get_json() or {}
    mode = (body.get("mode") or "auto").lower()
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)
        variables = _current_variables(ds, s)
        profile = _plan_prompt_profile(ds, df, variables, s)
        if mode == "system":
            return jsonify(_rule_based_project_plan(df, variables))

        cache_key = _ai_cache_key(ds_id, ds.current_stage_id, "project_plan", {"mode": mode, "plan_version": 3})
        cached = _AI_CACHE.get(cache_key)
        if cached is not None:
            return jsonify(cached)

        client = _ai_client()
        if client is None:
            return jsonify(_rule_based_project_plan(df, variables))

        system = (
            "You are SimuCast's project guide. Create an ordered analytics plan "
            "for a non-expert user. The plan must be actionable inside SimuCast, "
            "use exact column names, and avoid vague steps. Keep each action "
            "short. All string fields must be plain text — no markdown "
            "headings, tables, code fences, or bold/italic."
        )
        system += (
            " SimuCast capabilities and route targets: "
            "Data page can use section fix-cleaning-suggestions for grouped missing-value, "
            "outlier, duplicate, and suggested data fixes; section data-section-category_standardization "
            "for categorical label review and standardization; section data-section-manual_transforms "
            "for manual transforms and lightweight feature engineering. "
            "Expand page can use section expand-section-controls for row expansion. "
            "Describe page can use section describe-section-variables for descriptive statistics, "
            "distributions, charts, and variable summaries. "
            "Analysis page uses backend page value tests and section fix-correlation-test for "
            "correlation, group comparison, chi-square, and advanced analysis setup. "
            "Models page can use section fix-target-handling for target setup and section "
            "fix-feature-selection for feature selection/model preparation. "
            "What-if page can use section whatif-section-controls for saved model scenarios. "
            "Report page can use section ax-report-preview for report generation and preview. "
            "Only recommend actions this system can actually perform."
        )
        prompt = (
            "Analyze the dataset profile and create a guided project plan across "
            "the SimuCast workflow: data preparation, optional expansion, description, "
            "statistical analysis, modeling, what-if analysis, and report. Include only steps that make "
            "sense for this dataset. Sort the steps in workflow order only: "
            "data, expand if needed, describe, tests, models, whatif, report. "
            "Do not sort by priority. Each step must include: id, page "
            "(data|expand|describe|tests|models|whatif|report), title, rationale, "
            "priority (high|medium|low), optional columns, and optional section id when obvious. "
            "Use exact section ids from the capability list when possible. "
            'Respond as JSON: {"summary": str, "steps": [{"id": str, "page": str, "section": str, "title": str, "rationale": str, "priority": "high|medium|low", "columns": [str]}]}'
        )
        system = (
            "You are SimuCast's project guide. Recommend a concise, ordered workflow "
            "for a non-expert user. Only recommend features SimuCast supports. "
            "Do not invent pages, buttons, tools, algorithms, reports, or actions. "
            "Keep the Guided Plan high-level; method choices such as mean vs median, "
            "cap vs remove, and exact bin labels belong inside the relevant SimuCast card, "
            "not in this plan. Use exact column names from the dataset profile."
        )
        prompt = (
            "Create a SimuCast Guided Plan using only this capability list:\n\n"
            f"{_capability_text()}\n\n"
            "Use this exact plain text format. Do not use JSON, markdown tables, or code fences.\n"
            "1. Step title\n"
            "Category: Data preparation / Feature engineering / Describe / Analysis / Models / What-if / Report\n"
            "Why: one short reason\n"
            "Use: exact SimuCast feature from the capability list\n"
            "Columns: comma-separated relevant columns, or None\n\n"
            "Rules:\n"
            "- Sort steps in workflow order: Data preparation, optional Feature engineering, optional Expand, Describe, Analysis, Models, What-if, Report.\n"
            "- Inside Data preparation, follow the UI order: manual transforms, missing values, outliers, duplicates, category standardization, optional feature tools.\n"
            "- Inside Expand, follow: decide if expansion is needed, choose Bootstrap or Synthetic, configure target rows, preview, apply.\n"
            "- Inside Describe, follow: select variables, generate summaries, review visualizations, review correlations, explain findings.\n"
            "- Inside Analysis, follow: choose/recommend test, choose valid column pair, configure test, run test, explain results.\n"
            "- Inside Models, follow: select target, select features, configure preprocessing, select algorithm, train, review metrics/model health, optional tuning.\n"
            "- Inside What-if, follow: use trained model, adjust feature values, generate prediction, explain prediction, save/compare scenarios.\n"
            "- Recommend high-level workflow steps only.\n"
            "- Do not include method-level choices such as mean, median, mode, IQR cap, remove rows, or bin labels.\n"
            "- Prefer 5 to 8 steps.\n"
            "- If previous completed actions already cover a step, recommend the next useful step instead."
        )
        try:
            text = ai_call(profile, prompt, system=system, json_mode=False, max_tokens=1400)
            steps = _parse_ai_plan_text(text)
            steps = _filter_project_steps_for_dataset(steps, df, variables)
            response = {
                "ai": True,
                "summary": f"AI suggested workflow for {len(df)} rows and {len(variables)} variables.",
                "steps": _normalize_project_steps(steps),
            }
            if not response["steps"]:
                print("AI project plan raw response:", (text or "")[:4000], flush=True)
                raise ValueError("AI project plan returned no usable steps")
            _cache_put(_AI_CACHE, cache_key, response)
            return jsonify(clean_json(response))
        except Exception as e:
            print(f"AI project plan failed: {e}", flush=True)
            raw = getattr(e, "raw_response", None)
            if raw:
                print("AI project plan raw response:", raw[:4000], flush=True)
            fallback = _rule_based_project_plan(df, variables)
            fallback["error"] = "AI plan unavailable. Using built-in guided workflow."
            return jsonify(fallback)
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>/feature_engineer", methods=["POST"])
def feature_engineer(ds_id):
    """Apply a feature engineering operation to the active dataset."""
    body = request.get_json() or {}
    operation = body.get("operation")
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)

        if operation == "bin":
            col = body.get("column")
            bins = int(body.get("bins", 3))
            labels = body.get("labels") or None
            new_name = body.get("new_name") or f"{col}_bin"
            if col not in df.columns:
                return {"error": f"Column '{col}' not found"}, 400
            if labels and len(labels) != bins:
                labels = None
            df[new_name] = pd.cut(df[col], bins=bins, labels=labels)
            summary = f"Created '{new_name}' by binning '{col}' into {bins} bins."

        elif operation == "average":
            cols = body.get("columns", [])
            new_name = body.get("new_name") or ("_".join(cols[:3]) + "_avg")
            missing = [c for c in cols if c not in df.columns]
            if missing:
                return {"error": f"Columns not found: {missing}"}, 400
            df[new_name] = df[cols].mean(axis=1)
            summary = f"Created '{new_name}' as the row-wise average of {cols}."

        elif operation == "ratio":
            num = body.get("numerator")
            den = body.get("denominator")
            new_name = body.get("new_name") or f"{num}_per_{den}"
            if num not in df.columns or den not in df.columns:
                return {"error": "Numerator or denominator column not found"}, 400
            df[new_name] = df[num] / df[den].replace(0, float("nan"))
            summary = f"Created '{new_name}' as {num} / {den}."

        elif operation == "round":
            col = body.get("column")
            decimals = int(body.get("param", 2))
            new_name = body.get("new_name") or col
            if col not in df.columns:
                return {"error": f"Column '{col}' not found"}, 400
            df[new_name] = df[col].round(decimals)
            summary = f"Rounded '{col}' to {decimals} decimal places → '{new_name}'."

        elif operation == "abs":
            col = body.get("column")
            new_name = body.get("new_name") or col
            if col not in df.columns:
                return {"error": f"Column '{col}' not found"}, 400
            df[new_name] = df[col].abs()
            summary = f"Applied absolute value to '{col}' → '{new_name}'."

        elif operation == "log1p":
            col = body.get("column")
            new_name = body.get("new_name") or f"{col}_log"
            if col not in df.columns:
                return {"error": f"Column '{col}' not found"}, 400
            import numpy as np
            df[new_name] = np.log1p(df[col].clip(lower=0))
            summary = f"Applied log1p transform to '{col}' → '{new_name}'."

        elif operation == "zscore":
            col = body.get("column")
            new_name = body.get("new_name") or f"{col}_z"
            if col not in df.columns:
                return {"error": f"Column '{col}' not found"}, 400
            mu, sigma = df[col].mean(), df[col].std()
            df[new_name] = (df[col] - mu) / (sigma if sigma > 0 else 1)
            summary = f"Z-scored '{col}' (mean={mu:.2f}, sd={sigma:.2f}) → '{new_name}'."

        elif operation == "minmax":
            col = body.get("column")
            new_name = body.get("new_name") or f"{col}_scaled"
            if col not in df.columns:
                return {"error": f"Column '{col}' not found"}, 400
            mn, mx = df[col].min(), df[col].max()
            df[new_name] = (df[col] - mn) / ((mx - mn) if mx != mn else 1)
            summary = f"Min-max scaled '{col}' → '{new_name}'."

        elif operation == "pct_of_max":
            col = body.get("column")
            new_name = body.get("new_name") or f"{col}_pct"
            if col not in df.columns:
                return {"error": f"Column '{col}' not found"}, 400
            mx = df[col].max()
            df[new_name] = (df[col] / mx * 100) if mx != 0 else 0
            summary = f"Converted '{col}' to % of max → '{new_name}'."

        else:
            return {"error": f"Unknown operation: {operation}"}, 400

        create_stage(s, ds, df, op_type=f"feature_engineer_{operation}", op_params=body, summary=summary)
        s.commit()
        return jsonify({"ok": True, "summary": summary})
    except Exception as e:
        return {"error": friendly_error_message(e, "Feature engineering could not be applied. Check the selected columns and options.")}, 400
    finally:
        s.close()


@app.route("/api/datasets/<ds_id>/ai/recommend", methods=["POST"])
def ai_recommend(ds_id):
    """Context-aware AI recommendations for a page (data / tests / models / expand).

    Returns a structured object the UI can render directly. Falls back to a
    rule-based stub when the Anthropic key isn't configured so the panel
    still shows something useful.
    """
    body = request.get_json() or {}
    context = (body.get("context") or "data").lower()
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404

        # Cache lookup: same dataset stage + same context = same answer.
        # Skips a paid AI call when the user revisits the same page.
        cache_key = _ai_cache_key(ds_id, ds.current_stage_id, "recommend", {"context": context})
        cached = _AI_CACHE.get(cache_key)
        if cached is not None:
            return jsonify(cached)

        df = df_from_dataset(ds, s)
        variables = _current_variables(ds, s)
        profile = _dataset_profile(ds, df, variables)

        client = _ai_client()
        if client is None:
            return jsonify(_rule_based_recommend(context, df, variables))

        system = (
            "You are SimuCast's data-analysis assistant. You help non-experts "
            "understand their dataset and decide the next step. Be concise, "
            "concrete, and reference column names exactly as given. When you "
            "recommend an action, explain WHY in one short sentence. All "
            "string fields must be plain text — no markdown headings, tables, "
            "code fences, or bold/italic."
        )
        prompts = {
            "data": (
                "Look at the dataset profile and produce up to 6 recommendations "
                "covering: (a) cleaning fixes that would matter most, (b) useful "
                "column merges or feature engineering, (c) interesting questions "
                "the user could answer with this data. "
                'Respond as JSON: {"summary": str, "recommendations": [{"title": str, "rationale": str, "category": "clean|merge|expand|analyze|model"}]}'
            ),
            "tests": (
                "Recommend up to 4 statistical tests appropriate for this dataset. "
                "For each: name the test, the variables it would use (by exact column name), and a one-sentence rationale. "
                'Respond as JSON: {"recommendations": [{"test": str, "variables": [str], "rationale": str}]}'
            ),
            "models": (
                "Recommend up to 4 candidate target variables and the modeling "
                "task type (classification / regression) for each. For each "
                "target, list the algorithms you would try and any preprocessing "
                "the user must understand (scaling, encoding, leakage risks). "
                'Respond as JSON: {"recommendations": [{"target": str, "task": "classification|regression", "algorithms": [str], "preprocessing": [str], "leakage_risks": [str], "rationale": str}]}'
            ),
            "expand": (
                "The dataset is small. Recommend a row-synthesis approach "
                "(bootstrap vs synthetic) and a target row count, with the "
                "trade-offs spelled out. "
                'Respond as JSON: {"method": "bootstrap|synthetic", "target_rows": int, "rationale": str, "warnings": [str]}'
            ),
            "describe": (
                "Write a 2–4 sentence narrative summary of this dataset that a "
                "non-statistician would understand: what it appears to be about, "
                "the most notable distributions or skews, and any obvious data "
                "quality concerns. Then list up to 4 specific findings worth "
                "highlighting (outliers, skewed columns, suspicious zeros, etc). "
                'Respond as JSON: {"summary": str, "recommendations": [{"title": str, "rationale": str, "category": "distribution|outlier|quality|relationship"}]}'
            ),
            "clean": (
                "Recommend up to 5 cleaning actions, ordered by impact. For each: "
                "the action (impute, drop, recode, standardize, clip), the column "
                "it applies to, and a one-sentence rationale referencing the "
                "actual numbers (missing %, cardinality, etc). "
                'Respond as JSON: {"recommendations": [{"title": str, "action": "impute|drop|recode|standardize|clip", "column": str, "rationale": str, "category": "clean"}]}'
            ),
            "whatif": (
                "The user is exploring scenarios on a trained model. Suggest up "
                "to 4 scenarios worth running given the columns available — each "
                "should change one or two inputs in a way that would meaningfully "
                "test the model. "
                'Respond as JSON: {"recommendations": [{"title": str, "rationale": str, "category": "whatif", "changes": [{"column": str, "direction": "increase|decrease|set", "amount": str}]}]}'
            ),
            "report": (
                "Write an executive summary of the analysis pipeline so far for "
                "a non-technical stakeholder. Cover: what the data is, what was "
                "done to it, the headline finding, and the main caveats. Then "
                "list up to 4 next steps. "
                'Respond as JSON: {"summary": str, "recommendations": [{"title": str, "rationale": str, "category": "next-step"}]}'
            ),
        }
        prompt = prompts.get(context, prompts["data"])
        try:
            payload = ai_call(profile, prompt, system=system, json_mode=True, max_tokens=1500)
            response = {"context": context, "ai": True, **payload}
            _cache_put(_AI_CACHE, cache_key, response)  # only cache successful AI calls
            return jsonify(response)
        except Exception as e:
            print(f"AI recommend failed: {e}", flush=True)
            fallback = _rule_based_recommend(context, df, variables)
            fallback["error"] = "AI recommendations unavailable. Using built-in guidance."
            return jsonify(fallback)
    finally:
        s.close()


@app.route("/api/datasets/<ds_id>/ai/explain", methods=["POST"])
def ai_explain(ds_id):
    """Free-form 'explain this' for a step the UI is showing the user.

    Body: {step: str, params: dict, result: dict?, question: str?}
    `result` carries the computed payload the UI is displaying (test stats,
    model metrics, scenario prediction, …) so the model can interpret the
    actual numbers, not just the inputs.
    """
    body = request.get_json() or {}
    step = body.get("step") or "step"
    params = body.get("params") or {}
    result = body.get("result")
    question = body.get("question") or "Explain what this step does and what to look out for."
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404

        # Cache lookup: same dataset stage + same step + same inputs = same answer.
        # The step (e.g. "test-t"), params (which columns), and result (the actual
        # numbers) all matter — change any one of them and we re-ask the API.
        cache_key = _ai_cache_key(
            ds_id, ds.current_stage_id, "explain",
            {"step": step, "params": params, "result": result, "question": question},
        )
        cached = _AI_CACHE.get(cache_key)
        if cached is not None:
            return jsonify(cached)

        df = df_from_dataset(ds, s)
        variables = _current_variables(ds, s)
        profile = _dataset_profile(ds, df, variables)

        client = _ai_client()
        if client is None:
            return jsonify({
                "ai": False,
                "explanation": (
                    f"AI explanations require an ANTHROPIC_API_KEY on the server. "
                    f"Step: {step}. Params: {json.dumps(params, default=str)}."
                ),
            })

        system = (
            "You are SimuCast's data-analysis assistant. Reply in plain text "
            "only — no markdown headings, tables, code fences, or bold/italic. "
            "Be concise. Reference exact column names from the dataset profile. "
            "When a result is provided, interpret the actual numbers — say what "
            "the values mean and what the user should do next."
        )
        parts = [f"User is on step '{step}' with params {json.dumps(params, default=str)}."]
        if result is not None:
            parts.append(f"Computed result the UI is showing: {json.dumps(result, default=str)}")
        parts.append(f"Question: {question}")
        prompt = "\n".join(parts)
        try:
            text = ai_call(profile, prompt, system=system, max_tokens=300)
            response = {"ai": True, "explanation": text}
            _cache_put(_AI_CACHE, cache_key, response)  # only cache successful AI calls
            return jsonify(response)
        except Exception as e:
            print(f"AI explain failed: {e}", flush=True)
            return jsonify({"ai": False, "explanation": "AI explanation unavailable right now. You can continue with the built-in interpretation and try again later."})
    finally:
        s.close()


def _rule_based_recommend(context, df, variables):
    """Heuristic fallback when no Anthropic key is configured."""
    var_by_name = {v["name"]: v for v in variables}
    nums = [v["name"] for v in variables if v.get("dtype") in ("numeric", "int", "float", "binary")]
    cats = [v["name"] for v in variables if v.get("dtype") == "category"]
    bins = [v["name"] for v in variables if v.get("dtype") == "binary"]
    missing_cols = [v["name"] for v in variables if v.get("missing", 0) > 0]
    if context == "tests":
        recs = []
        if bins and nums:
            recs.append({"test": "Independent t-test", "variables": [bins[0], nums[0]],
                         "rationale": f"Compare mean {nums[0]} between {bins[0]} groups."})
        if len(cats) >= 2:
            recs.append({"test": "Chi-square", "variables": cats[:2],
                         "rationale": "Test independence of two categorical variables."})
        if len(nums) >= 2:
            recs.append({"test": "Pearson correlation", "variables": nums[:2],
                         "rationale": "Check linear association between two numeric variables."})
        return {"context": "tests", "ai": False, "recommendations": recs}
    if context == "models":
        recs = []
        if bins:
            recs.append({"target": bins[0], "task": "classification",
                         "algorithms": ["logistic", "random_forest", "gradient_boosting"],
                         "preprocessing": ["scale numeric features", "one-hot encode categoricals"],
                         "leakage_risks": [], "rationale": f"{bins[0]} is binary — natural classification target."})
        if nums:
            recs.append({"target": nums[-1], "task": "regression",
                         "algorithms": ["linear", "random_forest"],
                         "preprocessing": ["scale numeric features"],
                         "leakage_risks": [], "rationale": f"{nums[-1]} is continuous."})
        return {"context": "models", "ai": False, "recommendations": recs}
    if context == "expand":
        return {"context": "expand", "ai": False, "method": "bootstrap",
                "target_rows": max(500, 2 * len(df)), "rationale": "Bootstrap is fast and assumption-free.",
                "warnings": ["Bootstrap rows are duplicates of originals — don't use for held-out evaluation."]}
    if context == "describe":
        recs = []
        for col in nums[:2]:
            recs.append({"title": f"Inspect distribution of '{col}'",
                         "rationale": "Numeric column — check for skew or outliers.",
                         "category": "distribution"})
        for col in cats[:1]:
            recs.append({"title": f"Check cardinality of '{col}'",
                         "rationale": "Categorical column — verify it isn't near-unique.",
                         "category": "quality"})
        return {"context": "describe", "ai": False,
                "summary": f"{len(df)} rows × {len(variables)} columns ({len(nums)} numeric, {len(cats)} categorical).",
                "recommendations": recs}
    if context == "clean":
        recs = []
        for col in missing_cols[:3]:
            recs.append({"title": f"Impute or drop missing '{col}'",
                         "action": "impute", "column": col,
                         "rationale": f"{var_by_name[col]['missing']} rows are blank.",
                         "category": "clean"})
        return {"context": "clean", "ai": False, "recommendations": recs}
    if context == "whatif":
        recs = []
        for col in nums[:3]:
            recs.append({"title": f"Increase '{col}' by 10%",
                         "rationale": "Test sensitivity to a moderate positive shift.",
                         "category": "whatif",
                         "changes": [{"column": col, "direction": "increase", "amount": "10%"}]})
        return {"context": "whatif", "ai": False, "recommendations": recs}
    if context == "report":
        return {"context": "report", "ai": False,
                "summary": f"Dataset has {len(df)} rows and {len(variables)} columns. Configure ANTHROPIC_API_KEY for a full narrative summary.",
                "recommendations": [
                    {"title": "Review missing-value handling", "rationale": "Confirm imputation choices are documented.", "category": "next-step"},
                    {"title": "Validate model on held-out data", "rationale": "Bootstrapped/synthetic rows shouldn't be used for evaluation.", "category": "next-step"},
                ]}
    # default = data
    recs = []
    for col in missing_cols[:3]:
        recs.append({"title": f"Handle missing values in '{col}'",
                     "rationale": f"{var_by_name[col]['missing']} rows are blank.",
                     "category": "clean"})
    if bins and nums:
        recs.append({"title": f"Compare {nums[0]} across {bins[0]} groups",
                     "rationale": "Useful baseline analysis.", "category": "analyze"})
    if bins:
        recs.append({"title": f"Predict {bins[0]} from the other columns",
                     "rationale": "Binary target — good classification candidate.", "category": "model"})
    return {"context": "data", "ai": False,
            "summary": "Heuristic recommendations (no AI key configured).",
            "recommendations": recs}

def _normalize_project_steps(steps):
    valid_pages = {"data", "expand", "describe", "tests", "models", "whatif", "report"}
    page_order = {"data": 0, "expand": 1, "describe": 2, "tests": 3, "models": 4, "whatif": 5, "report": 6}
    page_aliases = {
        "analysis": "tests",
        "test": "tests",
        "statistical_analysis": "tests",
        "what-if": "whatif",
        "what_if": "whatif",
        "scenario": "whatif",
        "scenarios": "whatif",
        "model": "models",
    }
    section_ids = {
        "data": {
            "missing": "fix-cleaning-suggestions",
            "clean": "fix-cleaning-suggestions",
            "suggest": "fix-cleaning-suggestions",
            "outlier": "fix-cleaning-suggestions",
            "duplicate": "fix-cleaning-suggestions",
            "categor": "data-section-category_standardization",
            "standard": "data-section-category_standardization",
            "feature": "data-section-feature_engineering",
            "engineer": "data-section-feature_engineering",
            "bin": "data-section-feature_engineering",
            "format": "data-section-feature_engineering",
            "transform": "data-section-manual_transforms",
            "review": "data-section-raw_data",
            "export": "data-section-raw_data",
        },
        "expand": {"": "expand-section-controls"},
        "describe": {"": "describe-section-variables"},
        "tests": {"": "fix-correlation-test"},
        "models": {
            "feature": "fix-feature-selection",
            "target": "fix-target-handling",
            "": "fix-target-handling",
        },
        "whatif": {"": "whatif-section-controls"},
        "report": {"": "ax-report-preview"},
    }
    def normalize_section(page, raw, step):
        section = str(raw or "").strip()
        valid = {
            "fix-cleaning-suggestions", "data-section-category_standardization",
            "data-section-manual_transforms", "data-section-feature_engineering",
            "data-section-raw_data", "expand-section-controls",
            "describe-section-variables", "fix-correlation-test",
            "fix-target-handling", "fix-feature-selection",
            "whatif-section-controls", "ax-report-preview",
        }
        if section in valid:
            return section
        text = f"{section} {step.get('id', '')} {step.get('title', '')}".lower()
        for needle, fallback in section_ids.get(page, {}).items():
            if needle == "" or needle in text:
                return fallback
        return section
    def sub_order(step):
        text = f"{step.get('section', '')} {step.get('id', '')} {step.get('title', '')}".lower()
        if "raw" in text or "review dataset" in text or "export" in text:
            return 0
        if "manual" in text or "transform" in text or "rename" in text or "drop" in text or "type" in text:
            return 1
        if "missing" in text:
            return 2
        if "outlier" in text:
            return 3
        if "duplicate" in text:
            return 4
        if "clean" in text or "suggest" in text:
            return 5
        if "categor" in text or "standard" in text:
            return 6
        if "feature" in text or "engineer" in text or "bin" in text or "format" in text:
            return 7
        return 8
    out = []
    for idx, raw in enumerate(steps or [], start=1):
        if not isinstance(raw, dict):
            continue
        page = str(raw.get("page") or "data").lower().replace(" ", "_")
        page = page_aliases.get(page, page)
        if page not in valid_pages:
            page = "data"
        title = str(raw.get("title") or raw.get("action") or f"Step {idx}").strip()
        if not title:
            continue
        priority = str(raw.get("priority") or "medium").lower()
        if priority not in {"high", "medium", "low"}:
            priority = "medium"
        out.append({
            "id": str(raw.get("id") or f"{page}-{idx}"),
            "page": page,
            "section": normalize_section(page, raw.get("section"), raw),
            "title": title,
            "rationale": str(raw.get("rationale") or raw.get("summary") or "").strip(),
            "priority": priority,
            "status": str(raw.get("status") or "pending").lower(),
            "columns": [str(c) for c in (raw.get("columns") or []) if c is not None],
            "relatedActivityIds": [str(c) for c in (raw.get("relatedActivityIds") or []) if c is not None],
        })
    return sorted(out, key=lambda step: (page_order.get(step.get("page"), 99), sub_order(step), step.get("id", "")))[:10]

def _filter_project_steps_for_dataset(steps, df, variables):
    """Validate AI recommendations against factual dataset state before rendering."""
    variables = variables or []
    missing_cols = {v["name"] for v in variables if int(v.get("missing", 0) or 0) > 0}
    duplicate_count = int(df.duplicated().sum()) if len(df) else 0
    numeric_cols = [v["name"] for v in variables if v.get("dtype") in ("numeric", "int", "float", "binary")]
    outlier_cols = set()
    for col in numeric_cols:
        if col not in df.columns:
            continue
        series = pd.to_numeric(df[col], errors="coerce").dropna()
        if len(series) < 10:
            continue
        q1, q3 = series.quantile([0.25, 0.75])
        iqr = q3 - q1
        if iqr and int(((series < q1 - 1.5 * iqr) | (series > q3 + 1.5 * iqr)).sum()) > 0:
            outlier_cols.add(col)

    filtered = []
    for step in steps or []:
        text = f"{step.get('id', '')} {step.get('title', '')} {step.get('section', '')}".lower()
        if "duplicate" in text and duplicate_count <= 0:
            continue
        if "missing" in text and not missing_cols:
            continue
        if "outlier" in text and not outlier_cols:
            continue
        if step.get("page") == "expand" and len(df) >= 500:
            continue
        if "missing" in text:
            step["columns"] = [c for c in (step.get("columns") or []) if c in missing_cols] or list(missing_cols)[:5]
        if "outlier" in text:
            step["columns"] = [c for c in (step.get("columns") or []) if c in outlier_cols] or list(outlier_cols)[:5]
        filtered.append(step)
    return filtered

def _rule_based_project_plan(df, variables):
    nums = [v["name"] for v in variables if v.get("dtype") in ("numeric", "int", "float", "binary")]
    cats = [v["name"] for v in variables if v.get("dtype") == "category"]
    bins = [v["name"] for v in variables if v.get("dtype") == "binary"]
    missing_cols = [v["name"] for v in variables if int(v.get("missing", 0) or 0) > 0]
    outlier_cols = []
    for col in nums:
        if col not in df.columns:
            continue
        series = pd.to_numeric(df[col], errors="coerce").dropna()
        if len(series) < 10:
            continue
        q1, q3 = series.quantile([0.25, 0.75])
        iqr = q3 - q1
        if iqr and int(((series < q1 - 1.5 * iqr) | (series > q3 + 1.5 * iqr)).sum()) > 0:
            outlier_cols.append(col)
    duplicate_count = int(df.duplicated().sum()) if len(df) else 0
    steps = []
    if missing_cols:
        steps.append({
            "id": "data-missing-values",
            "page": "data",
            "section": "fix-cleaning-suggestions",
            "title": f"Fix missing values in {', '.join(missing_cols[:3])}",
            "rationale": "Missing values can distort summaries, tests, and model training.",
            "priority": "high",
            "columns": missing_cols[:5],
        })
    if outlier_cols:
        steps.append({
            "id": "data-outliers",
            "page": "data",
            "section": "fix-cleaning-suggestions",
            "title": "Review outliers in numeric columns",
            "rationale": "Extreme values can pull averages and model coefficients away from the typical pattern.",
            "priority": "medium",
            "columns": outlier_cols[:5],
        })
    if duplicate_count:
        steps.append({
            "id": "data-duplicates",
            "page": "data",
            "section": "fix-cleaning-suggestions",
            "title": "Remove exact duplicate rows",
            "rationale": f"{duplicate_count} duplicate row{'s' if duplicate_count != 1 else ''} may overweight repeated records.",
            "priority": "medium",
            "columns": [],
        })
    if cats:
        steps.append({
            "id": "data-category-standardization",
            "page": "data",
            "section": "data-section-category_standardization",
            "title": "Review categorical labels for standardization",
            "rationale": "Consistent labels keep categories from being split incorrectly during tests and modeling.",
            "priority": "high" if len(cats) else "medium",
            "columns": cats[:5],
        })
    if nums:
        steps.append({
            "id": "data-optional-feature-tools",
            "page": "data",
            "section": "data-section-feature_engineering",
            "title": "Optional: review feature tools and numeric formatting",
            "rationale": "Create bins or format numeric precision only when it improves interpretation.",
            "priority": "low",
            "columns": nums[:5],
        })
    if 0 < len(df) < 200:
        steps.append({
            "id": "expand-optional",
            "page": "expand",
            "section": "expand-section-controls",
            "title": "Optional: decide whether to expand the dataset",
            "rationale": "Small datasets can benefit from careful expansion, but preview distribution drift before applying.",
            "priority": "low",
            "columns": [],
        })
    steps.append({
        "id": "describe-overview",
        "page": "describe",
        "title": "Run descriptive statistics for key variables",
        "rationale": "Start with distributions, averages, and category balance before formal testing.",
        "priority": "medium",
        "columns": (nums[:3] + cats[:2])[:5],
    })
    if len(nums) >= 2:
        steps.append({
            "id": "tests-correlation",
            "page": "tests",
            "title": f"Check relationships between {nums[0]} and {nums[1]}",
            "rationale": "Correlation or relationship tests help identify promising predictors.",
            "priority": "medium",
            "columns": nums[:2],
        })
    if bins or nums:
        target = (bins[0] if bins else nums[-1])
        steps.append({
            "id": "models-train",
            "page": "models",
            "title": f"Train candidate models for {target}",
            "rationale": "Compare strict task-appropriate models before using what-if analysis.",
            "priority": "high",
            "columns": [target],
        })
        steps.append({
            "id": "whatif-scenario",
            "page": "whatif",
            "title": "Run a what-if scenario with the best saved model",
            "rationale": "Scenario testing turns model output into a decision-oriented explanation.",
            "priority": "medium",
            "columns": nums[:3],
        })
    steps.append({
        "id": "report-final",
        "page": "report",
        "title": "Generate a report with documentation and insights",
        "rationale": "The report should summarize data prep, tests, models, scenarios, and notes.",
        "priority": "medium",
        "columns": [],
    })
    return {
        "ai": False,
        "summary": f"Suggested workflow for {len(df)} rows and {len(variables)} variables.",
        "steps": _normalize_project_steps(steps),
    }


@app.route("/api/datasets/<ds_id>/ai/suggest", methods=["POST"])
def ai_suggest(ds_id):
    body = request.get_json() or {}
    prompt = (body.get("prompt") or "").lower()
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        variables = jload(ds.variables) or []

        # trivial intent router — replace with a real LLM call in prod
        suggestions = []
        if "churn" in prompt or "predict" in prompt or "model" in prompt:
            target = next((v["name"] for v in variables if v["dtype"] == "binary"), None)
            if target:
                suggestions.append({
                    "action": "train_model",
                    "params": {"target": target, "algorithm": "logistic"},
                    "label": f"Train a logistic regression to predict {target}",
                })
        if "compare" in prompt or "group" in prompt or "difference" in prompt:
            suggestions.append({
                "action": "t_test",
                "label": "Run an independent t-test to compare groups",
            })
        if "cluster" in prompt or "segment" in prompt:
            suggestions.append({
                "action": "cluster",
                "params": {"k": 4},
                "label": "Cluster rows into 4 segments via k-means",
            })
        if "describe" in prompt or "summary" in prompt or "overview" in prompt or not suggestions:
            suggestions.append({
                "action": "describe",
                "label": "Generate descriptive statistics for all numeric variables",
            })
        return jsonify({"suggestions": suggestions})
    finally:
        s.close()

# --- Reports ---

@app.route("/api/datasets/<ds_id>/report", methods=["POST"])
def build_report(ds_id):
    """Assemble analyses into a report JSON the frontend can render/export."""
    body = request.get_json() or {}
    sections = body.get("sections") or ["summary", "descriptives", "tests", "models"]
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        analyses = s.query(Analysis).filter_by(dataset_id=ds_id).order_by(Analysis.created_at).all()
        models = s.query(Model).filter_by(dataset_id=ds_id).order_by(Model.created_at).all()
        activity = [
            a for a in s.query(ActivityLog).filter_by(dataset_id=ds_id).order_by(ActivityLog.created_at).all()
            if a.kind not in {"ai", "note"} and (jload(a.detail) or {}).get("category") != "ai"
        ]

        report = {
            "title": ds.name,
            "generated_at": datetime.utcnow().isoformat(),
            "dataset": {
                "name": ds.name,
                "rows": ds.row_count,
                "columns": ds.col_count,
            },
            "sections": [],
        }
        latest_describe = next((a for a in reversed(analyses) if a.kind == "describe"), None)
        tests_ = [a for a in analyses if a.kind.startswith("test_")]

        if "summary" in sections:
            report["sections"].append({
                "title": "Executive summary",
                "body": _auto_summary(ds, analyses, models),
            })
        if "descriptives" in sections:
            if latest_describe:
                descriptive_result = jload(latest_describe.result)
                report["sections"].append({
                    "title": "Descriptive insights",
                    "body": _describe_report_text(descriptive_result),
                    "data": descriptive_result,
                })
        if "tests" in sections:
            if tests_:
                report["sections"].append({
                    "title": "Statistical analysis interpretation",
                    "body": _tests_report_text(tests_),
                    "items": [{"kind": a.kind, "config": jload(a.config), "result": jload(a.result), "summary": _test_report_line(a)} for a in tests_],
                })
                report["sections"].append({
                    "title": "Simple predictive insights",
                    "body": _predictive_insights_text(tests_),
                })
        if "models" in sections and models:
            report["sections"].append({
                "title": "Model performance",
                "body": _models_report_text(models),
                "items": [{
                    "name": m.name,
                    "algorithm": m.algorithm,
                    "target": m.target,
                    "metrics": jload(m.metrics),
                    "feature_influence": jload(m.feature_importance),
                    "summary": _model_report_line(m),
                } for m in models],
            })
            report["sections"].append({
                "title": "Key influencing factors",
                "body": _feature_influence_report_text(models),
            })
        if "ai_interpretation" in sections:
            report["sections"].append({
                "title": "AI interpretation",
                "body": "AI interpretation is not available yet. The report currently uses rule-based explanations so it remains understandable without an AI connection.",
            })
        if "documentation" in sections:
            report["sections"].append({
                "title": "Appendix: Project actions",
                "body": _documentation_summary_text(activity),
                "items": [activity_payload(a) for a in activity],
            })
        log_activity(
            s,
            ds_id,
            "report",
            "Generated report",
            detail={"category": "report", "action_type": "generate_report", "sections": sections},
        )
        return jsonify(clean_json(report))
    finally:
        s.close()


def _auto_summary(ds, analyses, models):
    bits = [f"This report summarizes the analysis of {ds.name}, a dataset with {ds.row_count} rows and {ds.col_count} variables."]
    des = next((a for a in reversed(analyses) if a.kind == "describe"), None)
    if des:
        stats_rows = (jload(des.result) or {}).get("stats") or []
        nums = [r for r in stats_rows if r.get("kind") == "numeric"]
        cats = [r for r in stats_rows if r.get("kind") == "categorical"]
        if nums or cats:
            bits.append(f"The descriptive review includes {len(nums)} numeric and {len(cats)} categorical variable summaries.")
    if models:
        best = _best_model(models)
        metrics = jload(best.metrics) or {}
        if metrics.get("auc") is not None:
            bits.append(f"The strongest saved model is {best.algorithm} for {best.target}, with AUC={metrics['auc']:.3f}.")
        elif metrics.get("accuracy") is not None:
            bits.append(f"The strongest saved model is {best.algorithm} for {best.target}, with accuracy={metrics['accuracy']:.1%}.")
        elif metrics.get("r2") is not None:
            bits.append(f"The strongest saved model is {best.algorithm} for {best.target}, explaining about {metrics['r2']:.1%} of observed variation.")
    sig_tests = [a for a in analyses if a.kind.startswith("test_") and (jload(a.result) or {}).get("significant")]
    if sig_tests:
        bits.append(f"{len(sig_tests)} statistical analysis result(s) found statistically significant evidence at p < 0.05.")
    elif any(a.kind.startswith("test_") for a in analyses):
        bits.append("The recorded statistical analyses did not find strong statistical evidence at p < 0.05.")
    bits.append("Detailed project actions are placed in the appendix so the main report stays focused on findings and interpretation.")
    return " ".join(bits)


def _describe_report_text(result):
    rows = (result or {}).get("stats") or []
    nums = [r for r in rows if r.get("kind") == "numeric"]
    cats = [r for r in rows if r.get("kind") == "categorical"]
    lines = []
    if nums:
        skewed = sorted(nums, key=lambda r: abs(float(r.get("skew") or 0)), reverse=True)
        variable = sorted(nums, key=lambda r: _spread_score(r), reverse=True)
        symmetric = [r for r in nums if abs(float(r.get("skew") or 0)) < 0.5]
        lines.append(f"Numeric variables summarized: {', '.join(str(r.get('variable')) for r in nums[:6])}.")
        if symmetric:
            lines.append(f"{symmetric[0]['variable']} is approximately symmetric (skew={_fmt(symmetric[0].get('skew'))}).")
        if skewed and abs(float(skewed[0].get("skew") or 0)) >= 1:
            lines.append(f"{skewed[0]['variable']} is the most skewed numeric variable, so median and quartiles should be considered alongside the mean.")
        if variable:
            lines.append(f"{variable[0]['variable']} shows the highest relative variability among the summarized numeric variables.")
    if cats:
        dominant = sorted(cats, key=lambda r: (r.get("freq") or 0) / max(r.get("n") or 1, 1), reverse=True)
        top = dominant[0]
        lines.append(f"{top['variable']} is led by {top.get('top')} ({_pct(top.get('freq'), top.get('n'))} of valid rows).")
    if not lines:
        lines.append("No descriptive analysis has enough result detail for interpretation yet.")
    return "\n".join(f"- {line}" for line in lines)


def _tests_report_text(tests):
    lines = [_test_report_line(a) for a in tests[-5:]]
    lines = [line for line in lines if line]
    return "\n".join(f"- {line}" for line in lines) if lines else "No statistical analyses have been recorded yet."


def _test_report_line(analysis):
    kind = analysis.kind.replace("test_", "")
    cfg = jload(analysis.config) or {}
    r = jload(analysis.result) or {}
    sig = r.get("significant")
    decision = "reject the null hypothesis" if sig else "fail to reject the null hypothesis" if sig is not None else "review the relationship"
    if kind == "corr":
        pair = r.get("strongest_pair") or {}
        if pair:
            direction = "positive" if pair.get("r", 0) >= 0 else "negative"
            return f"Correlation: {pair.get('var_a')} and {pair.get('var_b')} show the strongest {direction} relationship (r={_fmt(pair.get('r'))}, p={_fmt(pair.get('p'))})."
        return "Correlation: no pairwise relationship could be summarized."
    if kind == "chi":
        return f"Chi-square: {cfg.get('var_a')} and {cfg.get('var_b')} lead to the decision to {decision} (p={_fmt(r.get('p'))}, Cramer's V={_fmt(r.get('cramers_v'))})."
    if kind == "t":
        return f"t-test: {cfg.get('measure')} differs by {cfg.get('group')} with decision to {decision} (p={_fmt(r.get('p'))}, Cohen's d={_fmt(r.get('cohens_d'))})."
    if kind == "anova":
        return f"ANOVA: {cfg.get('measure')} across {cfg.get('group')} groups leads to the decision to {decision} (p={_fmt(r.get('p'))}, eta squared={_fmt(r.get('eta_squared'))})."
    return r.get("interpretation") or f"{analysis.kind} was run."


def _predictive_insights_text(tests):
    lines = []
    for a in tests[-6:]:
        kind = a.kind.replace("test_", "")
        cfg = jload(a.config) or {}
        r = jload(a.result) or {}
        if kind == "corr":
            pair = r.get("strongest_pair") or {}
            if pair:
                tendency = "increase" if pair.get("r", 0) >= 0 else "decrease"
                lines.append(f"As {pair.get('var_a')} increases, {pair.get('var_b')} tends to {tendency} in the observed data.")
        elif kind == "t":
            labels = r.get("group_labels") or ["Group 1", "Group 2"]
            higher = labels[0] if (r.get("mean_group_1") or 0) >= (r.get("mean_group_2") or 0) else labels[1]
            lines.append(f"{higher} has the higher observed average {cfg.get('measure')}; this is a group-based pattern, not a full predictive model.")
        elif kind == "anova":
            means = r.get("group_means") or {}
            if means:
                higher = max(means, key=means.get)
                lines.append(f"{higher} has the highest observed average {cfg.get('measure')} among {cfg.get('group')} categories.")
        elif kind == "chi":
            lines.append(f"The contingency table for {cfg.get('var_a')} and {cfg.get('var_b')} supports probability-style comparisons by category.")
    if not lines:
        lines.append("Run correlation, group-comparison, or chi-square tests to generate non-model predictive insights.")
    return "\n".join(f"- {line}" for line in lines[:5])


def _models_report_text(models):
    best = _best_model(models)
    metrics = jload(best.metrics) or {}
    lines = [f"{len(models)} model run(s) are included in this report."]
    if metrics.get("task") == "classification":
        auc = f" and AUC={_fmt(metrics.get('auc'))}" if metrics.get("auc") is not None else ""
        lines.append(f"Best recorded model: {best.algorithm} predicting {best.target}, with accuracy={_pct_float(metrics.get('accuracy'))}{auc}.")
    elif metrics.get("task") == "regression":
        lines.append(f"Best recorded model: {best.algorithm} predicting {best.target}, with R2={_fmt(metrics.get('r2'))} and RMSE={_fmt(metrics.get('rmse'))}.")
    lines.append("Model metrics should be interpreted together with data preparation, target cleanliness, and test-set size.")
    return "\n".join(f"- {line}" for line in lines)


def _model_report_line(model):
    metrics = jload(model.metrics) or {}
    if metrics.get("task") == "classification":
        auc = f" and AUC={_fmt(metrics.get('auc'))}" if metrics.get("auc") is not None else ""
        return f"{model.algorithm} predicted {model.target} with accuracy={_pct_float(metrics.get('accuracy'))}{auc}."
    if metrics.get("task") == "regression":
        return f"{model.algorithm} predicted {model.target} with R2={_fmt(metrics.get('r2'))} and RMSE={_fmt(metrics.get('rmse'))}."
    return f"{model.algorithm} model for {model.target}."


def _feature_influence_report_text(models):
    best = _best_model(models)
    influence = jload(best.feature_importance) or []
    if isinstance(influence, dict):
        influence = [{"feature": k, "strength": v} for k, v in influence.items()]
    influence = sorted(influence, key=lambda x: float(x.get("strength") or x.get("relative_strength") or 0), reverse=True)
    if not influence:
        return "Feature influence is not available for the saved models."
    top = [item for item in influence[:5] if item.get("feature")]
    if not top:
        return "Feature influence is not available for the saved models."
    lines = [f"For the strongest saved model ({best.algorithm}), the leading influencing factor is {top[0].get('feature')}."]
    lines.append("Top factors: " + ", ".join(item.get("feature") for item in top) + ".")
    lines.append("These values are model-derived influence summaries, not proof of causation.")
    return "\n".join(f"- {line}" for line in lines)


def _documentation_summary_text(activity):
    if not activity:
        return "No project actions were recorded."
    counts = {}
    for entry in activity:
        detail = jload(entry.detail) or {}
        key = detail.get("step_type") or detail.get("category") or entry.kind
        counts[key] = counts.get(key, 0) + 1
    summary = ", ".join(f"{k}: {v}" for k, v in counts.items())
    return f"The appendix contains the project action trail for reproducibility. Summary by type: {summary}."


def _best_model(models):
    def score(model):
        m = jload(model.metrics) or {}
        if m.get("task") == "classification":
            return m.get("auc") if m.get("auc") is not None else m.get("accuracy") or 0
        if m.get("task") == "regression":
            return m.get("r2") if m.get("r2") is not None else -1e9
        return -1e9
    return max(models, key=score)


def _spread_score(row):
    span = abs(float(row.get("max") or 0) - float(row.get("min") or 0)) or 1
    return abs(float(row.get("std") or 0)) / span


def _fmt(value):
    if value is None:
        return "n/a"
    try:
        return f"{float(value):.3f}"
    except Exception:
        return str(value)


def _pct(count, total):
    if not total:
        return "0.0%"
    return f"{float(count or 0) / float(total) * 100:.1f}%"


def _pct_float(value):
    if value is None:
        return "n/a"
    return f"{float(value):.1%}"


def _old_auto_summary(ds, analyses, models):
    bits = [f"Analysis of {ds.name} ({ds.row_count} rows, {ds.col_count} variables)."]
    if models:
        latest = models[-1]
        metrics = jload(latest.metrics) or {}
        if metrics.get("auc"):
            bits.append(f"Best model ({latest.algorithm}) achieves AUC={metrics['auc']:.3f} predicting {latest.target}.")
        elif metrics.get("r2") is not None:
            bits.append(f"Best model ({latest.algorithm}) achieves R²={metrics['r2']:.3f} predicting {latest.target}.")
    sig_tests = [a for a in analyses if a.kind.startswith("test_") and (jload(a.result) or {}).get("significant")]
    if sig_tests:
        bits.append(f"{len(sig_tests)} statistical analyses returned significant results (p < 0.05).")
    return " ".join(bits)

# --- helper to save analysis rows ---
def _save_analysis(session, ds_id, kind, config, result):
    a = Analysis(
        id=str(uuid.uuid4()),
        dataset_id=ds_id,
        kind=kind,
        config=jdump(clean_json(config)),
        result=jdump(clean_json(result)),
    )
    session.add(a)
    log_activity(
        session,
        ds_id,
        "analysis",
        f"Ran {kind.replace('_', ' ')}",
        detail={"category": "analysis", "action_type": kind, "config": clean_json(config)},
        ref_type="analysis",
        ref_id=a.id,
        commit=False,
    )
    session.commit()
    return a


@app.route("/api/datasets/<ds_id>/analyses", methods=["GET"])
def list_analyses(ds_id):
    """Return saved analysis artifacts so workflow pages can restore prior output."""
    kind = (request.args.get("kind") or "").strip()
    limit = min(max(_parse_num(request.args.get("limit"), 20, int), 1), 100)
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        q = s.query(Analysis).filter_by(dataset_id=ds_id)
        if kind:
            q = q.filter_by(kind=kind)
        analyses = q.order_by(Analysis.created_at.desc()).limit(limit).all()
        return jsonify({
            "analyses": [
                {
                    "id": a.id,
                    "kind": a.kind,
                    "config": jload(a.config) or {},
                    "result": jload(a.result) or {},
                    "created_at": a.created_at.isoformat() if a.created_at else None,
                }
                for a in analyses
            ]
        })
    finally:
        s.close()


FRONTEND_DIST_PATH = os.environ.get(
    "FRONTEND_DIST_PATH",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")),
)

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react_app(path):
    """Serve the React SPA and fall back to index.html for client-side routes."""
    normalized = (path or "").lstrip("/")
    if normalized.startswith("api/"):
        return jsonify({"error": "Not found"}), 404

    if not os.path.isdir(FRONTEND_DIST_PATH):
        return "API is running. Frontend build not found.", 200

    if normalized:
        asset_path = os.path.join(FRONTEND_DIST_PATH, normalized)
        if os.path.isfile(asset_path):
            directory, filename = os.path.split(asset_path)
            return send_from_directory(directory, filename)

    return send_from_directory(FRONTEND_DIST_PATH, "index.html")


# ========================================================================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
