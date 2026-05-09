"""SQLAlchemy ORM models.

`_json_col` returns either a JSONB column (Postgres) or a Text column (SQLite)
depending on the active DATABASE_URL — this keeps the same code path running
locally and on Render.
"""
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB

from .config import DATABASE_URL
from .db import Base


def _json_col():
    """JSONB on Postgres, Text on SQLite — picked by DATABASE_URL."""
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
