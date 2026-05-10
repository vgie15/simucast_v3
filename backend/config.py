"""
Configuration module for the Axion / SimuCast backend.

Loads environment variables, defines upload/cache limits, configures the
database URL (with the Render postgres:// fix), and computes the CORS
origin list. Has no internal dependencies and is safe to import from any
other module in the package.
"""
import os


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
GUEST_MODEL_LIMIT = 5

# AI model identifiers
_AI_MODEL_FAST = "claude-sonnet-4-6"
_AI_MODEL_DEEP = "claude-opus-4-7"

# In-memory cache size cap (FIFO eviction)
_CACHE_MAX = 32

_cors_raw = os.environ.get("CORS_ORIGINS", "*")
_cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()] or ["*"]

_DATABASE_URL = os.environ.get("DATABASE_URL")
if not _DATABASE_URL:
    raise RuntimeError("DATABASE_URL is required. Set it to a PostgreSQL connection string (postgresql://user:pass@host/db).")
# Render gives postgres:// but SQLAlchemy needs postgresql://
if _DATABASE_URL.startswith("postgres://"):
    _DATABASE_URL = _DATABASE_URL.replace("postgres://", "postgresql://", 1)
DATABASE_URL = _DATABASE_URL
