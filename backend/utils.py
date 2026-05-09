"""
Generic utility helpers: JSON serialization, error message cleanup, secret
token generation, and JSON-safe scalar coercion. No Flask/SQLAlchemy
dependencies — safe to import from any other module.
"""
import json
import secrets
from datetime import datetime

import numpy as np
import pandas as pd

from backend.config import DATABASE_URL


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
    """Strip noisy tracebacks/SDK names from an exception message before showing it to a user."""
    text = str(err or "").strip()
    lower = text.lower()
    if "jsondecodeerror" in lower or "expecting value" in lower:
        return "The AI response could not be read. Using the built-in workflow instead."
    if "boolean subtract" in lower:
        return "The classification metrics could not be computed for this target. Try standardizing the target categories or choosing another target."
    if "traceback" in lower or "\n" in text or "sklearn" in lower or "numpy" in lower:
        return fallback
    return text or fallback


def _parse_num(value, default, cast):
    """Safely cast a user-supplied value; fall back to default on bad input."""
    if value is None:
        return default
    try:
        return cast(value)
    except (TypeError, ValueError):
        return default


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


def _new_token():
    """Return a URL-safe random token for session/auth identifiers."""
    return secrets.token_urlsafe(32)
