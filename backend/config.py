"""Configuration: env loading, upload limits, database URL, CORS, AI models.

Loaded once at import time. Other modules pull constants from here.
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

# --- Upload limits ----------------------------------------------------------
# We enforce three different limits at upload time:
#   1. MAX_UPLOAD_BYTES: total file size (Flask checks this first and rejects
#      with 413 before we even see the request body).
#   2. magic-byte sniffing in the upload route: the actual file bytes must
#      match the extension. A user can rename "report.exe" to "report.csv"
#      and we'd otherwise try to parse it.
#   3. MAX_UPLOAD_ROWS: after parsing, refuse very large datasets. Pandas
#      will happily eat a 10M-row CSV and exhaust server RAM.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024   # 10 MB
MAX_UPLOAD_ROWS = 100_000             # 100k rows
GUEST_MODEL_LIMIT = 5

# --- CORS -------------------------------------------------------------------
_cors_raw = os.environ.get("CORS_ORIGINS", "*")
CORS_ORIGINS = [o.strip() for o in _cors_raw.split(",") if o.strip()] or ["*"]

# --- Database URL -----------------------------------------------------------
_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "simucast.db")
_DATABASE_URL_FROM_ENV = bool(os.environ.get("DATABASE_URL"))
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    f"sqlite:///{_DB_PATH}",  # absolute path so db location never depends on cwd
)
if os.environ.get("RENDER") and not _DATABASE_URL_FROM_ENV:
    raise RuntimeError(
        "DATABASE_URL is required on Render. SQLite files on Render are ephemeral and will lose accounts."
    )
# Render gives postgres:// but SQLAlchemy needs postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# --- AI models --------------------------------------------------------------
_AI_MODEL_FAST = "claude-sonnet-4-6"
_AI_MODEL_DEEP = "claude-opus-4-7"
