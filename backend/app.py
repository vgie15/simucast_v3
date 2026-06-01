"""SimuCast Flask app entrypoint.

This module should stay boring: configure Flask, register product blueprints,
install error handlers, initialize the schema, and serve the React SPA.
Legacy helper re-exports live in ``backend.compat`` so the app entrypoint does
not become a second code index.
"""

import os
import sys

# Render runs gunicorn with cwd=backend (rootDir: backend in render.yaml), so
# this file may be loaded as top-level module "app". Add the repo parent so
# absolute "backend.xxx" imports work in production and locally.
_PKG_PARENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PKG_PARENT not in sys.path:
    sys.path.insert(0, _PKG_PARENT)

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

import backend.compat as _compat
from backend.config import MAX_UPLOAD_BYTES, _cors_origins
from backend.database import _try_init_at_startup
from backend.modules.ai.routes import bp as ai_bp
from backend.modules.analysis.routes import bp as analysis_bp
from backend.modules.auth.routes import bp as auth_bp
from backend.modules.data.cleaning import bp as cleaning_bp
from backend.modules.data.datasets import bp as datasets_bp
from backend.modules.data.transforms import bp as transforms_bp
from backend.modules.health.routes import bp as health_bp
from backend.modules.history.activity_routes import bp as activity_bp
from backend.modules.history.stages_routes import bp as stages_bp
from backend.modules.models.routes import bp as models_bp
from backend.modules.report.routes import bp as report_bp
from backend.modules.whatif.routes import bp as whatif_bp

globals().update({
    name: value
    for name, value in vars(_compat).items()
    if not name.startswith("__")
})


def create_app():
    """Create and configure the Flask application."""
    flask_app = Flask(__name__)
    flask_app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
    flask_app.secret_key = os.environ.get("FLASK_SECRET_KEY", "simucast_secret_key_default")
    CORS(flask_app, origins=_cors_origins)

    _register_error_handlers(flask_app)
    _register_blueprints(flask_app)
    _register_spa_fallback(flask_app)
    return flask_app


def _register_error_handlers(flask_app):
    @flask_app.errorhandler(413)
    def _too_large(_e):
        mb_limit = MAX_UPLOAD_BYTES // (1024 * 1024)
        return jsonify({"error": f"File is too large. Maximum allowed is {mb_limit} MB."}), 413

    @flask_app.errorhandler(500)
    def _api_server_error(e):
        if request.path.startswith("/api/"):
            original = getattr(e, "original_exception", None)
            detail = original.__class__.__name__ if original else e.__class__.__name__
            print(f"API server error on {request.path}: {detail}", flush=True)
            return jsonify({"error": "The server hit an internal error. Please try again.", "detail": detail}), 500
        return e


def _register_blueprints(flask_app):
    for blueprint in (
        health_bp,
        auth_bp,
        datasets_bp,
        cleaning_bp,
        transforms_bp,
        activity_bp,
        stages_bp,
        analysis_bp,
        models_bp,
        whatif_bp,
        ai_bp,
        report_bp,
    ):
        flask_app.register_blueprint(blueprint)


def _register_spa_fallback(flask_app):
    frontend_dist_path = os.environ.get(
        "FRONTEND_DIST_PATH",
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")),
    )

    @flask_app.route("/", defaults={"path": ""})
    @flask_app.route("/<path:path>")
    def serve_react_app(path):
        normalized = (path or "").lstrip("/")
        if normalized.startswith("api/"):
            return jsonify({"error": "Not found"}), 404

        if not os.path.isdir(frontend_dist_path):
            return "API is running. Frontend build not found.", 200

        if normalized:
            asset_path = os.path.join(frontend_dist_path, normalized)
            if os.path.isfile(asset_path):
                directory, filename = os.path.split(asset_path)
                return send_from_directory(directory, filename)

        return send_from_directory(frontend_dist_path, "index.html")


_try_init_at_startup()
app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
