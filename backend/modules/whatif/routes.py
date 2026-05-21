"""
What-if / prediction routes: prepare an older model for prediction, run a
prediction with user-supplied feature values, and save the resulting scenario.
"""
import numpy as np
from flask import Blueprint, jsonify, request

from backend.database import db, Dataset, Model
from backend.shared.utils import clean_json, jdump, jload
from backend.core.activity import activity_payload, log_activity
from backend.shared.dataframe import df_from_dataset
from backend.ml import (
    ALGORITHM_CATALOG, _build_preprocessing_plan, _deserialize_estimator,
    _model_default_params, _train_one, _whatif_extrapolation_risk,
    _whatif_input_matrix,
)


bp = Blueprint("whatif", __name__)


# ===========================================================================
# SECTION: WHAT-IF / PREDICTION
# Keywords: whatif, what-if, predict, prediction, scenario, simulation, extrapolation
# ===========================================================================
# ANCHOR: What-If: Prepare Model for Prediction
@bp.route("/api/models/<model_id>/prepare_whatif", methods=["POST"])
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
            "validation_method": metrics.get("validation_method") or (metrics.get("split") or {}).get("validation_method", "standard_split"),
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

# ANCHOR: What-If: Run Prediction
@bp.route("/api/models/<model_id>/predict", methods=["POST"])
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

# ANCHOR: What-If: Save Scenario
@bp.route("/api/models/<model_id>/scenarios", methods=["POST"])
def save_whatif_scenario(model_id):
    """Append a what-if scenario to the activity log for later report inclusion."""
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
