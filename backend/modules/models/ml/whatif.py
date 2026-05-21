"""What-if input matrix and extrapolation-risk helpers."""

import pandas as pd

from backend.modules.models.ml.artifacts import _apply_numeric_preprocessing_frame

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
    X_raw, _ = _apply_numeric_preprocessing_frame(X_raw, bundle.get("numeric_preprocessing"))
    X = pd.get_dummies(X_raw, drop_first=True, prefix_sep=sep)
    encoded_features = bundle.get("features") or bundle.get("encoded_features") or X.columns.tolist()
    X = X.reindex(columns=encoded_features, fill_value=0)

    if bundle.get("scaled"):
        scaler_kind = bundle.get("scaler_kind") or "standard"
        means = bundle.get("feature_means") or {}
        stds = bundle.get("feature_stds") or {}
        mins = bundle.get("feature_mins") or {}
        ranges = bundle.get("feature_ranges") or {}
        for col in X.columns:
            if scaler_kind == "minmax":
                scale = ranges.get(col, 1) or 1
                X[col] = (X[col].astype(float) - mins.get(col, 0)) / scale
            else:
                scale = stds.get(col, 1) or 1
                X[col] = (X[col].astype(float) - means.get(col, 0)) / scale
    return X

def _whatif_extrapolation_risk(inputs, raw_features):
    """Flag inputs that fall outside the training-time feature ranges."""
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
