"""
Health-check endpoints and the lazy schema-init guard.

``_schema_guard`` runs as a global ``before_app_request`` hook so the first
non-health request triggers ``_ensure_schema`` if the boot-time init failed
(e.g. Postgres is still warming up on Render).
"""
from datetime import datetime

from flask import Blueprint, request
from sqlalchemy.exc import OperationalError

from backend import database
from backend.config import DATABASE_URL, _DATABASE_URL_FROM_ENV


bp = Blueprint("health", __name__)


# ===========================================================================
# SECTION: HEALTH CHECK
# Keywords: ping, health, status, alive
# ===========================================================================
# ANCHOR: Health Check / Ping
@bp.route("/api/ping")
def home():
    """Liveness probe — returns a static string so it bypasses DB init."""
    return "API is running 🚀"


# ANCHOR: Health Check / Status
@bp.route("/api/health")
def health():
    """Detailed health: schema readiness + database flavor."""
    return {
        "status": "ok",
        "db_ready": database._db_ready,
        "database": "postgresql" if "postgresql" in DATABASE_URL else "sqlite",
        "database_url_configured": _DATABASE_URL_FROM_ENV,
        "persistent_storage": "postgresql" in DATABASE_URL,
        "time": datetime.utcnow().isoformat(),
    }


@bp.before_app_request
def _schema_guard():
    """Lazy schema init. Skips health check so Render's probe stays fast."""
    if database._db_ready or request.path == "/api/health":
        return None
    try:
        database._ensure_schema()
    except OperationalError:
        return {"error": "database warming up, retry in a moment"}, 503
    return None
