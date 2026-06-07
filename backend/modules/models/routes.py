"""
Model training and listing routes.

Wraps ``_build_preprocessing_plan`` + ``_train_one`` from ``backend.ml`` and
persists each Model row alongside its preprocessing plan + influence summary.
"""
import numpy as np
from flask import Blueprint, jsonify, request, session

from backend.database import db, ActivityLog, Dataset, Model
from backend.shared.utils import _parse_num, clean_json, friendly_error_message, jdump, jload
from backend.core.activity import log_activity
from backend.core.auth_helpers import (
    _auth_from_request, _dataset_scope, _guest_model_limit_response,
    _model_scope, _session_payload,
)
import pandas as pd
from backend.shared.dataframe import df_from_dataset, _current_rows, infer_variables
from backend.ml import (
    ALGORITHM_CATALOG, _algo_label_for_task, _build_preprocessing_plan,
    _model_default_params, _train_one,
)


bp = Blueprint("models_routes", __name__)


def _sync_preprocessing_session(target_options):
    """Sync preprocessing choices between target_options and flask session."""
    if "numeric_preprocessing" in target_options:
        session["numeric_preprocessing"] = target_options["numeric_preprocessing"]
    elif "numeric_preprocessing" in session:
        target_options["numeric_preprocessing"] = session["numeric_preprocessing"]

    if "categorical_encoding" in target_options:
        session["categorical_encoding"] = target_options["categorical_encoding"]
    elif "categorical_encoding" in session:
        target_options["categorical_encoding"] = session["categorical_encoding"]

    if "categorical_order" in target_options:
        session["categorical_order"] = target_options["categorical_order"]
    elif "categorical_order" in session:
        target_options["categorical_order"] = session["categorical_order"]


# ===========================================================================
# SECTION: MACHINE LEARNING - MODEL TRAINING
# Keywords: model, train, training, preprocessing, plan, regression, classification, linear, logistic, tree, random forest, rf, decision tree, sklearn
# ===========================================================================
# ANCHOR: Model: Preview Preprocessing Plan
@bp.route("/api/datasets/<ds_id>/models/preprocessing_plan", methods=["POST"])
def preprocessing_plan(ds_id):
    """Return the preprocessing plan for a target+features+algos config without training."""
    body = request.get_json() or {}
    target = body.get("target")
    features = body.get("features") or []
    algorithms = body.get("algorithms") or []
    target_options = body.get("target_options") or {}
    _sync_preprocessing_session(target_options)
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


# ANCHOR: Model: Train Single Model
@bp.route("/api/datasets/<ds_id>/models/train", methods=["POST"])
def train_model(ds_id):
    """Train a single model. Kept for backward compat — train_many is preferred."""
    body = request.get_json() or {}
    target = body.get("target")
    features = body.get("features") or []
    algo = body.get("algorithm", "logistic")
    target_options = body.get("target_options") or {}
    _sync_preprocessing_session(target_options)
    model_params = body.get("model_params") or {}
    test_size = min(max(_parse_num(body.get("test_size", target_options.get("test_size")), 0.2, float), 0.05), 0.5)
    target_options["test_size"] = test_size  # keep plan and training split in sync

    s = db()
    try:
        sess, _ = _auth_from_request(s)
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        limited = _guest_model_limit_response(s, sess, ds_id, 1)
        if limited:
            return limited
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

        m = Model(
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
        s.flush()  # populate m.id for activity log + response payload
        model_id = m.id
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
            sess.guest_model_usage_count = int(getattr(sess, "guest_model_usage_count", 0) or 0) + 1
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


# ANCHOR: Model: Train Multiple Models (Compare)
@bp.route("/api/datasets/<ds_id>/models/train_many", methods=["POST"])
def train_many_models(ds_id):
    """Train multiple algorithms on the same target+features config and return
    a comparison-ready array. Each model is persisted individually so it shows
    up in the model list and can be opened in What-if."""
    body = request.get_json() or {}
    target = body.get("target")
    features = body.get("features") or []
    algorithms = body.get("algorithms") or ["logistic"]
    target_options = body.get("target_options") or {}
    _sync_preprocessing_session(target_options)
    model_params = body.get("model_params") or {}
    test_size = min(max(_parse_num(body.get("test_size", target_options.get("test_size")), 0.2, float), 0.05), 0.5)
    target_options["test_size"] = test_size  # keep plan and training split in sync

    s = db()
    try:
        sess, _ = _auth_from_request(s)
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
        limited = _guest_model_limit_response(s, sess, ds_id, len(valid))
        if limited:
            return limited

        results = []
        for algo in valid:
            try:
                r = _train_one(df, target, plan["features"], algo, test_size, plan, model_params.get(algo))
                m = Model(
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
                s.flush()  # populate m.id before activity log + response payload reference it
                model_id = m.id
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
            sess.guest_model_usage_count = int(getattr(sess, "guest_model_usage_count", 0) or 0) + len(results)
            s.commit()

        return jsonify(clean_json({
            "preprocessing_plan": plan,
            "models": results,
            "skipped": skipped,
            "guest_training_allowed": bool(sess and sess.is_guest),
            "session": _session_payload(sess) if sess else None,
        }))
    finally:
        s.close()

# ANCHOR: Model: List Saved Models
@bp.route("/api/datasets/<ds_id>/models", methods=["GET"])
def list_models(ds_id):
    """Return every persisted Model for the dataset (no estimator payload)."""
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
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

# ANCHOR: Model: Get Detail
@bp.route("/api/models/<model_id>", methods=["GET"])
def get_model(model_id):
    """Return one Model with What-if metadata derived from its coefficients."""
    s = db()
    try:
        m = _model_scope(model_id, s)
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

# ANCHOR: Model: Train/Test Split Rows
@bp.route("/api/models/<model_id>/split-rows", methods=["GET"])
def get_model_split_rows(model_id):
    """Return dataset rows that went into the train or test split for a model.

    ?split=train|test  (default: test)
    ?page=1&page_size=100
    """
    split = request.args.get("split", "test")
    page = max(_parse_num(request.args.get("page"), 1, int), 1)
    page_size = min(max(_parse_num(request.args.get("page_size"), 100, int), 1), 1000)
    s = db()
    try:
        m = _model_scope(model_id, s)
        if not m:
            return jsonify({"error": "model not found"}), 404

        metrics = jload(m.metrics) if isinstance(m.metrics, str) else (m.metrics or {})
        train_indices = metrics.get("train_row_indices")
        test_indices = set(metrics.get("test_row_indices") or [])
        split_counts = metrics.get("split_rows") or {}

        ds = s.query(Dataset).filter_by(id=m.dataset_id).first()
        if not ds:
            return jsonify({"error": "dataset not found"}), 404

        all_rows = _current_rows(ds, s)
        total = len(all_rows)

        # complete_case_row_indices tells us which original rows were kept after
        # dropna().  Rows absent from this set were excluded before training —
        # they must not appear under either split label.
        complete_case = metrics.get("complete_case_row_indices")
        if complete_case is None:
            # Legacy model: re-derive complete-case set from stored features/target.
            features_stored = jload(m.features) or []
            if features_stored and m.target:
                try:
                    df_full = df_from_dataset(ds, s)
                    cols = [c for c in features_stored + [m.target] if c in df_full.columns]
                    complete_case = df_full[cols].dropna().index.tolist()
                except Exception:
                    complete_case = list(range(total))
            else:
                complete_case = list(range(total))
        complete_case_set = set(complete_case)

        if not test_indices:
            # Legacy model: re-derive test split with the same seed and stratification.
            from sklearn.model_selection import train_test_split as _tts
            test_size = float((metrics.get("split") or {}).get("test_size") or 0.2)
            stratified = (metrics.get("split") or {}).get("stratified", False)
            cc_list = sorted(complete_case_set)
            stratify_labels = None
            if stratified and m.target:
                try:
                    df_full = df_from_dataset(ds, s)
                    stratify_labels = [df_full.iloc[i][m.target] for i in cc_list]
                    # only stratify when every label has ≥ 2 samples
                    from collections import Counter
                    if min(Counter(stratify_labels).values()) < 2:
                        stratify_labels = None
                except Exception:
                    stratify_labels = None
            _, test_idx = _tts(cc_list, test_size=test_size, random_state=42, stratify=stratify_labels)
            test_indices = set(test_idx)

        if split == "train":
            train_index_set = set(train_indices) if train_indices is not None else complete_case_set - test_indices
            filtered = [(i, r) for i, r in enumerate(all_rows) if i in train_index_set]
        else:
            filtered = [(i, r) for i, r in enumerate(all_rows) if i in test_indices]

        split_total = len(filtered)
        start = (page - 1) * page_size
        page_slice = filtered[start: start + page_size]

        variables = infer_variables(pd.DataFrame([r for _, r in page_slice])) if page_slice else []

        page_rows = []
        for orig_idx, row in page_slice:
            out = dict(row)
            out["__row_index"] = orig_idx
            page_rows.append(out)

        return jsonify({
            "rows": page_rows,
            "page": page,
            "page_size": page_size,
            "total": split_total,
            "split": split,
            "split_rows": split_counts,
            "variables": variables,
        })
    finally:
        s.close()


# ANCHOR: Model: Delete Model
@bp.route("/api/models/<model_id>", methods=["DELETE"])
def delete_model(model_id):
    """Delete a Model row plus the activity-log entries that reference it."""
    s = db()
    try:
        m = _model_scope(model_id, s)
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
