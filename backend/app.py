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
from difflib import SequenceMatcher
from datetime import datetime

import numpy as np
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS
from sqlalchemy import create_engine, Column, String, Integer, DateTime, Text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.dialects.postgresql import JSONB

from scipy import stats
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
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
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB upload cap

@app.route("/")
def home():
    return "API is running 🚀"

_cors_raw = os.environ.get("CORS_ORIGINS", "*")
_cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()] or ["*"]
CORS(app, origins=_cors_origins)

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "sqlite:///axion.db"  # fallback for local dev
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
    if "datasets" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("datasets")}
    with engine.begin() as conn:
        if "description" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN description TEXT"))
        if "current_stage_id" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN current_stage_id VARCHAR"))

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

def df_from_dataset(ds, session=None):
    """Rehydrate a pandas DataFrame from the dataset's *current* stage.

    Falls back to the original data when no stage is active. Pass a session
    when caller already has one to avoid opening a second connection.
    """
    rows = _current_rows(ds, session)
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows)

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

_AI_MODEL_FAST = "claude-sonnet-4-20250514"
_AI_MODEL_DEEP = "claude-opus-4-1-20250805"

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
        try:
            return json.loads(text)
        except Exception:
            # tolerate stray fences
            cleaned = text.strip().strip("`")
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()
            return json.loads(cleaned)
    return text


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

# --- Datasets ---

@app.route("/api/datasets", methods=["GET"])
def list_datasets():
    s = db()
    try:
        rows = s.query(Dataset).order_by(Dataset.created_at.desc()).all()
        return jsonify([{
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "filename": r.filename,
            "row_count": r.row_count,
            "col_count": r.col_count,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows])
    finally:
        s.close()

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
        if from_id:
            src = s.query(Dataset).filter_by(id=from_id).first()
            if not src:
                return {"error": "source dataset not found"}, 404
            variables = jload(src.variables) or []
            records = jload(src.data) or []
            row_count = src.row_count
            col_count = src.col_count
            filename = src.filename
            final_name = name or src.name
        else:
            if "file" not in request.files:
                return {"error": "no file"}, 400
            f = request.files["file"]
            try:
                if f.filename.lower().endswith(".csv"):
                    df = pd.read_csv(f)
                elif f.filename.lower().endswith((".xlsx", ".xls")):
                    df = pd.read_excel(f)
                else:
                    return {"error": "unsupported file type"}, 400
            except Exception as e:
                return {"error": f"failed to parse: {e}"}, 400
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
        )
        s.add(ds)
        log_activity(
            s,
            ds_id,
            "upload" if not from_id else "clone",
            f"Created project '{final_name}' with {row_count} rows and {col_count} columns",
            detail={"category": "data_prep", "action_type": "upload" if not from_id else "clone", "filename": filename, "source_dataset_id": from_id},
            ref_type="dataset",
            ref_id=ds_id,
            commit=False,
        )
        s.commit()
        return {
            "id": ds_id,
            "name": final_name,
            "description": description,
            "row_count": row_count,
            "col_count": col_count,
            "variables": variables,
        }
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>", methods=["GET"])
def get_dataset(ds_id):
    """Returns dataset metadata + variables for the active stage."""
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
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
            "created_at": ds.created_at.isoformat() if ds.created_at else None,
        }
    finally:
        s.close()

@app.route("/api/datasets/<ds_id>", methods=["DELETE"])
def delete_dataset(ds_id):
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
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
        ds = s.query(Dataset).filter_by(id=ds_id).first()
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
        ds = s.query(Dataset).filter_by(id=ds_id).first()
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
        ds = s.query(Dataset).filter_by(id=ds_id).first()
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
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        if stage_id == "original":
            ds.current_stage_id = None
            rows = jload(ds.data) or []
            ds.row_count = len(rows)
            ds.col_count = len(rows[0]) if rows else 0
        else:
            stage = s.query(DatasetStage).filter_by(id=stage_id, dataset_id=ds_id).first()
            if not stage:
                return {"error": "stage not found"}, 404
            ds.current_stage_id = stage.id
            ds.row_count = stage.row_count
            ds.col_count = stage.col_count
        log_activity(
            s,
            ds_id,
            "restore",
            f"Restored {'original upload' if stage_id == 'original' else 'stage ' + stage_id[:8]}",
            detail={"category": "data_prep", "action_type": "restore", "stage_id": stage_id},
            ref_type="stage",
            ref_id=stage_id,
            commit=False,
        )
        s.commit()
        return {"ok": True, "current_stage_id": ds.current_stage_id or "original"}
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
        if dtype in ("numeric", "binary"):
            coerced = pd.to_numeric(present, errors="coerce")
            type_errors = int(coerced.isna().sum())
        elif dtype == "datetime":
            coerced = pd.to_datetime(present, errors="coerce")
            type_errors = int(coerced.isna().sum())
        out["type_errors"] = type_errors

        if dtype in ("numeric", "binary"):
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
                    "action": options[0]["action"],
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

        return jsonify({"suggestions": clean_json(suggestions)})
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
      - cast_column:   {column, to: numeric|datetime|category|text}
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
        if to == "numeric":
            coerced = pd.to_numeric(out[col], errors="coerce")
            errors = int(coerced.isna().sum() - out[col].isna().sum())
            out[col] = coerced
            return out, f"Cast '{col}' to numeric ({errors} value{'s' if errors != 1 else ''} became NaN)"
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

        # histogram data for the first numeric column, for charting
        histogram = None
        num_cols = [c for c in cols if c in df.columns and pd.api.types.is_numeric_dtype(df[c])]
        if num_cols:
            first = num_cols[0]
            s_clean = df[first].dropna()
            counts, bin_edges = np.histogram(s_clean, bins=12)
            histogram = {
                "variable": first,
                "counts": counts.tolist(),
                "bins": bin_edges.tolist(),
            }

        result = {"stats": out, "histogram": histogram}
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
        if len(X) == 0:
            return {"error": "no numeric data"}, 400
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
        if X.shape[1] == 0:
            return {"error": "no numeric data"}, 400
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

    numeric_features = [c for c in features if pd.api.types.is_numeric_dtype(sub_clean[c])]
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

    imbalanced = bool(task == "classification" and n_per_class and max(n_per_class.values()) / sum(n_per_class.values()) >= 0.75)
    validation_checks = [
        {"label": "Missing values handled", "status": "warning" if missing_report else "ok", "detail": f"{len(missing_report)} column(s) contain missing values; modeling will drop incomplete rows." if missing_report else "No missing values in selected modeling columns."},
        {"label": "Categories standardized", "status": "block" if hard_blocks else "ok", "detail": "Fix similar target labels before training." if hard_blocks else "No target category conflicts detected."},
        {"label": "Class balance checked", "status": "warning" if imbalanced else "ok", "detail": "Class imbalance detected; use balanced class weights." if imbalanced else "No severe class imbalance detected."},
        {"label": "Multicollinearity checked", "status": "warning" if multicollinearity else "ok", "detail": f"{len(multicollinearity)} highly correlated feature pair(s)." if multicollinearity else "No high numeric feature correlations detected."},
        {"label": "Train/test split configured", "status": "ok", "detail": f"Train {int((1 - test_size) * 100)}% / test {int(test_size * 100)}%" + (" with stratification." if task == "classification" and stratify_split else ".")},
    ]

    return {
        "task": task,
        "target": target,
        "features": features,
        "excluded_features": excluded_features,
        "rows_used": rows_after,
        "rows_dropped": dropped,
        "encoding": encoding,
        "scaling": scaling,
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
    X = pd.get_dummies(X_raw, drop_first=True, prefix_sep=sep)
    encoded_features = bundle.get("features") or bundle.get("encoded_features") or X.columns.tolist()
    X = X.reindex(columns=encoded_features, fill_value=0)

    if bundle.get("scaled"):
        means = bundle.get("feature_means") or {}
        stds = bundle.get("feature_stds") or {}
        for col in X.columns:
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
    X = X_raw.copy()
    y = data[target]

    X = pd.get_dummies(X, drop_first=True, prefix_sep="=")

    is_classification = plan["task"] == "classification"
    class_labels = None
    if is_classification:
        if plan.get("target_mode") == "binary":
            positive = str(plan.get("positive_class"))
            y = y.astype(str).eq(positive).astype(int)
            class_labels = [f"not {positive}", positive]
        elif not pd.api.types.is_numeric_dtype(y):
            labels = sorted(y.dropna().astype(str).unique().tolist())
            class_labels = labels
            y = LabelEncoder().fit_transform(y.astype(str))

    needs_scaling = ALGORITHM_CATALOG.get(algo, {}).get("needs_scaling", False)
    scaler = None
    if needs_scaling:
        scaler = StandardScaler()
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
        metrics = {
            "task": "classification",
            "accuracy": float(accuracy_score(y_test, y_pred)),
            "precision": float(precision_score(y_test, y_pred, average="weighted", zero_division=0)),
            "recall": float(recall_score(y_test, y_pred, average="weighted", zero_division=0)),
            "f1": float(f1_score(y_test, y_pred, average="weighted", zero_division=0)),
            "split": plan.get("split"),
            "class_weight": plan.get("class_weight"),
            "model_params": params,
        }
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
        metrics = {
            "task": "regression",
            "r2": float(r2_score(y_test, y_pred)),
            "rmse": float(np.sqrt(mean_squared_error(y_test, y_pred))),
            "mae": float(np.mean(np.abs(y_test - y_pred))),
            "split": plan.get("split"),
            "model_params": params,
        }

    influence = _feature_influence_from_model(clf, X.columns.tolist(), features, algo)

    feature_means = {c: float(scaler.mean_[i]) if scaler is not None else float(X[c].mean())
                     for i, c in enumerate(X.columns)}
    feature_stds = {c: float(scaler.scale_[i]) if scaler is not None else float(X[c].std() or 1)
                    for i, c in enumerate(X.columns)}
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
        "raw_features": _whatif_raw_features(X_raw),
        "dummy_sep": "=",
        "scaled": scaler is not None,
        "model_behavior": "stepwise" if algo in ("tree", "rf") else "smooth",
        "preprocessing_pipeline": {
            "encoding": plan.get("encoding"),
            "scaling": plan.get("scaling"),
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
        ds = s.query(Dataset).filter_by(id=ds_id).first()
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
        ds = s.query(Dataset).filter_by(id=ds_id).first()
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
        ds = s.query(Dataset).filter_by(id=ds_id).first()
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
                skipped.append({"algorithm": algo, "reason": str(e)})

        return jsonify(clean_json({
            "preprocessing_plan": plan,
            "models": results,
            "skipped": skipped,
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
            "recommend an action, explain WHY in one short sentence."
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
        }
        prompt = prompts.get(context, prompts["data"])
        try:
            payload = ai_call(profile, prompt, system=system, json_mode=True, max_tokens=1500)
            return jsonify({"context": context, "ai": True, **payload})
        except Exception as e:
            print(f"AI recommend failed: {e}", flush=True)
            fallback = _rule_based_recommend(context, df, variables)
            fallback["error"] = f"AI call failed: {e.__class__.__name__}"
            return jsonify(fallback)
    finally:
        s.close()


@app.route("/api/datasets/<ds_id>/ai/explain", methods=["POST"])
def ai_explain(ds_id):
    """Free-form 'explain this' for a step the UI is showing the user.

    Body: {step: str, params: dict, question: str?}
    """
    body = request.get_json() or {}
    step = body.get("step") or "step"
    params = body.get("params") or {}
    question = body.get("question") or "Explain what this step does and what to look out for."
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
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
            "You are SimuCast's data-analysis assistant. Explain steps in plain "
            "English to a non-statistician, in 2–4 short sentences. Reference "
            "specific columns from the dataset profile when relevant. Be honest "
            "about caveats but don't hedge excessively."
        )
        prompt = (
            f"User is on step '{step}' with params {json.dumps(params, default=str)}.\n"
            f"Question: {question}"
        )
        try:
            text = ai_call(profile, prompt, system=system, max_tokens=600)
            return jsonify({"ai": True, "explanation": text})
        except Exception as e:
            print(f"AI explain failed: {e}", flush=True)
            return jsonify({"ai": False, "explanation": f"AI call failed: {e}"})
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
                    "title": "Hypothesis test interpretation",
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
        bits.append(f"{len(sig_tests)} hypothesis test(s) found statistically significant evidence at p < 0.05.")
    elif any(a.kind.startswith("test_") for a in analyses):
        bits.append("The recorded hypothesis tests did not find strong statistical evidence at p < 0.05.")
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
    return "\n".join(f"- {line}" for line in lines) if lines else "No hypothesis tests have been recorded yet."


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
        bits.append(f"{len(sig_tests)} hypothesis tests returned significant results (p < 0.05).")
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



# ========================================================================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
