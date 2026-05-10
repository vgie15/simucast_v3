"""
Axion / SimuCast backend orchestrator.

After the heavy refactor, this module only assembles the pieces:

- ``backend.config``            — env loading, upload limits, DATABASE_URL, CORS
- ``backend.utils``             — JSON helpers, error scrubber, secrets
- ``backend.database``          — engine, SessionLocal, ORM models, schema init
- ``backend.cache``             — DataFrame + AI in-memory caches and persistence
- ``backend.ai_client``         — Anthropic wrapper + dataset profile
- ``backend.activity``          — log_activity / activity_payload
- ``backend.auth_helpers``      — session resolution and 403 builders
- ``backend.dataframe_utils``   — DataFrame stage IO + variable inference
- ``backend.ml``                — preprocessing plan, training, what-if helpers
- ``backend.blueprints.*``      — Flask blueprints, one per feature surface

This file creates the ``app`` object, registers blueprints, wires the global
error handlers, and re-exports every public/private name that lived at module
level in the original monolithic ``app.py`` so downstream callers (the test
suite included) can keep doing ``from backend import app`` and reach into
``app.<symbol>``.
"""
import os
import sys

# Render runs gunicorn with cwd=backend (rootDir: backend in render.yaml), so
# this file is loaded as the top-level module "app" and the parent directory
# is not on sys.path. Add it so the absolute "backend.xxx" imports below
# resolve in production. Locally (tests run from the repo root) this is a
# no-op because the parent is already on sys.path.
_PKG_PARENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PKG_PARENT not in sys.path:
    sys.path.insert(0, _PKG_PARENT)

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# --- Layer 0/1 imports --------------------------------------------------
from backend.config import (
    DATABASE_URL,
    GUEST_MODEL_LIMIT,
    MAX_UPLOAD_BYTES,
    MAX_UPLOAD_ROWS,
    _AI_MODEL_DEEP,
    _AI_MODEL_FAST,
    _CACHE_MAX,
    _DATABASE_URL_FROM_ENV,
    _DB_PATH,
    _cors_origins,
    _cors_raw,
    _load_local_env,
)
from backend.utils import (
    _json_safe,
    _new_token,
    _parse_num,
    clean_json,
    friendly_error_message,
    jdump,
    jload,
)
from backend.database import (
    AIResponse,
    ActivityLog,
    Analysis,
    Base,
    Dataset,
    DatasetStage,
    Model,
    SessionLocal,
    User,
    UserSession,
    _db_ready,
    _ensure_schema,
    _json_col,
    _migrate_add_columns,
    _try_init_at_startup,
    db,
    engine,
)
from backend.cache import (
    _AI_CACHE,
    _DF_CACHE,
    _ai_cache_hex,
    _ai_cache_key,
    _ai_db_get,
    _ai_db_put,
    _cache_put,
    _df_cache_invalidate,
    _df_cache_key,
)
from backend.ai_client import (
    _ai_client,
    _ai_safe,
    _dataset_profile,
    _parse_ai_json,
    ai_call,
)
from backend.activity import activity_payload, log_activity
from backend.auth_helpers import (
    _ai_account_required_response,
    _attach_owner,
    _auth_from_request,
    _client_guest_slot_used,
    _dataset_scope,
    _guest_limit_response,
    _guest_model_limit_response,
    _report_account_required_response,
    _session_payload,
)
from backend.dataframe_utils import (
    _current_rows,
    _current_variables,
    _rows_for_stage,
    _sheet_list,
    _sheet_payload_from_df,
    _stage_count,
    _variables_for_stage,
    create_stage,
    df_from_dataset,
    infer_variables,
    is_numeric_meta,
    numeric_df,
)

# --- Layer 2/3 imports --------------------------------------------------
from backend.ml import (
    ALGORITHM_CATALOG,
    AVAILABLE_ALGOS_BY_TASK,
    MODEL_PARAM_DEFAULTS,
    _SIMUCAST_CAPABILITIES,
    _algo_label_for_task,
    _apply_numeric_preprocessing_frame,
    _build_model_estimator,
    _build_preprocessing_plan,
    _capability_text,
    _cross_validation_metrics,
    _deserialize_estimator,
    _detect_task,
    _feature_influence_from_model,
    _is_identifier_feature,
    _issue_check,
    _model_default_params,
    _model_health_diagnostics,
    _original_feature_name,
    _sanitize_model_params,
    _serialize_estimator,
    _train_one,
    _whatif_extrapolation_risk,
    _whatif_input_matrix,
    _whatif_raw_features,
)

# --- Blueprints ---------------------------------------------------------
from backend.blueprints.activity_routes import bp as activity_bp
from backend.blueprints.ai_routes import bp as ai_bp
from backend.blueprints.analysis import bp as analysis_bp
from backend.blueprints.auth_routes import bp as auth_bp
from backend.blueprints.cleaning import bp as cleaning_bp
from backend.blueprints.datasets import bp as datasets_bp
from backend.blueprints.health import bp as health_bp
from backend.blueprints.models_routes import bp as models_bp
from backend.blueprints.report import bp as report_bp
from backend.blueprints.stages_routes import bp as stages_bp
from backend.blueprints.transforms import bp as transforms_bp
from backend.blueprints.whatif import bp as whatif_bp

# --- Re-exports of helpers that originally lived at module level --------
# (Some of these get explicit names below so ``app.<name>`` keeps working
# for the test suite and for any external callers.)
from backend.blueprints.auth_routes import _delete_account_artifacts
from backend.blueprints.datasets import (
    _CATEGORY_ABBREVIATIONS,
    _NO_VALUES,
    _YES_VALUES,
    _apply_cell_edit,
    _binary_category_groups,
    _category_groups,
    _normalize_category_value,
    _title_category_label,
    _validate_upload_file,
)
from backend.blueprints.analysis import (
    _anova_interpret,
    _chi_interpret,
    _save_analysis,
    _t_interpret,
)
from backend.blueprints.transforms import (
    _apply_transform,
    _coerce_num,
    _col_stats,
    _expand,
    _pct_change,
)
from backend.blueprints.ai_routes import (
    _CHAT_HISTORY_LIMIT,
    _ai_chat_call,
    _ai_text_looks_incomplete,
    _chat_response_row,
    _filter_project_steps_for_dataset,
    _normalize_project_steps,
    _parse_ai_plan_text,
    _plan_prompt_profile,
    _rule_based_project_plan,
    _rule_based_recommend,
    _saved_ai_explanation,
    _store_ai_explanation,
    _unused_ai_chat_send_old_impl,
)
from backend.blueprints.report import (
    _ai_explanations_report_section,
    _auto_summary,
    _best_model,
    _describe_report_text,
    _documentation_summary_text,
    _feature_influence_report_text,
    _fmt,
    _model_report_line,
    _models_report_text,
    _old_auto_summary,
    _pct,
    _pct_float,
    _predictive_insights_text,
    _shorten,
    _spread_score,
    _test_report_line,
    _tests_report_text,
    build_report,
)
from backend.blueprints.health import health, home
from backend.blueprints.auth_routes import (
    auth_me,
    change_account_password,
    create_guest_session,
    delete_account,
    login,
    logout,
    signup,
    update_account,
)
from backend.blueprints.datasets import (
    column_stats,
    delete_dataset,
    export_csv,
    get_column_values,
    get_dataset,
    get_rows,
    list_datasets,
    select_dataset_sheet,
    update_cell,
    update_cells,
    update_variable,
    upload_dataset,
)
from backend.blueprints.cleaning import (
    apply_category_standardization,
    category_suggestions,
    clean_apply,
    clean_apply_group,
    clean_suggestions,
)
from backend.blueprints.transforms import (
    expand_dataset,
    feature_engineer,
    transform,
)
from backend.blueprints.activity_routes import (
    create_activity_note,
    delete_or_undo_activity,
    list_activity,
)
from backend.blueprints.stages_routes import (
    list_stages,
    reset_project,
    restore_stage,
)
from backend.blueprints.analysis import (
    describe,
    do_cluster,
    do_pca,
    list_analyses,
    run_test,
)
from backend.blueprints.models_routes import (
    delete_model,
    get_model,
    list_models,
    preprocessing_plan,
    train_many_models,
    train_model,
)
from backend.blueprints.whatif import (
    prepare_model_for_whatif,
    save_whatif_scenario,
    whatif_predict,
)
from backend.blueprints.ai_routes import (
    ai_chat_clear,
    ai_chat_history,
    ai_chat_send,
    ai_explain,
    ai_project_plan,
    ai_recommend,
    ai_suggest,
    set_ai_explanation_report,
)


# --- Flask app construction ---------------------------------------------
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
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES

CORS(app, origins=_cors_origins)


# Flask aborts with a 413 *before* our route runs when MAX_CONTENT_LENGTH is
# exceeded. Without this handler the client gets a generic HTML page; we
# return JSON so the frontend can show a friendly message.
@app.errorhandler(413)
def _too_large(_e):
    """Return a JSON 413 instead of Flask's default HTML 413 page."""
    mb_limit = MAX_UPLOAD_BYTES // (1024 * 1024)
    return jsonify({"error": f"File is too large. Maximum allowed is {mb_limit} MB."}), 413


@app.errorhandler(500)
def _api_server_error(e):
    """Return a JSON 500 for ``/api/*`` paths (and pass through otherwise)."""
    if request.path.startswith("/api/"):
        original = getattr(e, "original_exception", None)
        detail = original.__class__.__name__ if original else e.__class__.__name__
        print(f"API server error on {request.path}: {detail}", flush=True)
        return jsonify({"error": "The server hit an internal error. Please try again.", "detail": detail}), 500
    return e


# --- Schema bootstrap ---------------------------------------------------
# Run the same best-effort init the original monolith did at import time so
# tests and CLI invocations don't need to wait for the first HTTP request.
_try_init_at_startup()


# --- Blueprint registration ---------------------------------------------
app.register_blueprint(health_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(datasets_bp)
app.register_blueprint(cleaning_bp)
app.register_blueprint(transforms_bp)
app.register_blueprint(activity_bp)
app.register_blueprint(stages_bp)
app.register_blueprint(analysis_bp)
app.register_blueprint(models_bp)
app.register_blueprint(whatif_bp)
app.register_blueprint(ai_bp)
app.register_blueprint(report_bp)


# --- Frontend SPA fallback ----------------------------------------------
FRONTEND_DIST_PATH = os.environ.get(
    "FRONTEND_DIST_PATH",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")),
)


# ANCHOR: GET /
@app.route("/", defaults={"path": ""})
# ANCHOR: GET /<path:path>
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
