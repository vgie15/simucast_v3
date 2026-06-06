"""Model serialization, feature influence, and raw feature metadata helpers."""

import base64
import pickle

import numpy as np
import pandas as pd

def _original_feature_name(encoded_feature, original_features, sep="="):
    """Map a one-hot encoded column name back to its original feature name."""
    if encoded_feature in original_features:
        return encoded_feature
    if sep in encoded_feature:
        candidate = encoded_feature.split(sep, 1)[0]
        if candidate in original_features:
            return candidate
    return encoded_feature


def _feature_influence_from_model(clf, encoded_columns, original_features, algo):
    """Aggregate per-feature influence (importance or |coef|) from a fitted estimator."""
    rows = {}
    if hasattr(clf, "feature_importances_"):
        for col, value in zip(encoded_columns, clf.feature_importances_):
            original = _original_feature_name(col, original_features)
            entry = rows.setdefault(original, {"feature": original, "strength": 0.0, "direction_score": 0.0})
            entry["strength"] += abs(float(value))
    elif hasattr(clf, "coef_"):
        coef_arr = np.asarray(clf.coef_)
        if coef_arr.ndim == 2 and coef_arr.shape[0] > 1:
            coef = np.mean(np.abs(coef_arr), axis=0)
            signed_coef = np.mean(coef_arr, axis=0)
        else:
            coef = coef_arr.ravel()
            signed_coef = coef
        for col, value in zip(encoded_columns, coef):
            original = _original_feature_name(col, original_features)
            entry = rows.setdefault(original, {"feature": original, "strength": 0.0, "direction_score": 0.0})
            entry["strength"] += abs(float(value))
            entry["direction_score"] += float(signed_coef[list(encoded_columns).index(col)])

    if not rows:
        return []
    total_strength = sum(v["strength"] for v in rows.values()) or 1.0
    influence = []
    for entry in rows.values():
        strength = entry["strength"]
        direction = None
        if algo in ("linear", "logistic"):
            signed = entry.get("direction_score", 0.0)
            if abs(signed) < strength * 0.15:
                direction = "mixed"
            else:
                direction = "positive" if signed > 0 else "negative"
        influence.append({
            "feature": entry["feature"],
            "strength": float(strength),
            "relative_strength": float(strength / total_strength),
            "direction": direction,
        })
    return sorted(influence, key=lambda x: -x["strength"])[:15]


def _serialize_estimator(model):
    """Pickle a fitted sklearn estimator and base64-encode it for JSON storage."""
    return base64.b64encode(pickle.dumps(model)).decode("ascii")


def _deserialize_estimator(payload):
    """Inverse of ``_serialize_estimator`` — restore a sklearn estimator."""
    return pickle.loads(base64.b64decode(payload.encode("ascii")))


def _apply_numeric_preprocessing_frame(X_raw, numeric_config):
    """Apply optional log1p / integer-rounding to a feature DataFrame."""
    X = X_raw.copy()
    numeric_config = numeric_config or {}
    log_columns = set(numeric_config.get("log_columns") or [])
    integer_columns = set(numeric_config.get("integer_columns") or [])
    applied = []
    for col in X.columns:
        if col not in log_columns and col not in integer_columns:
            continue
        numeric = pd.to_numeric(X[col], errors="coerce")
        if col in integer_columns:
            numeric = numeric.round()
            X[col] = numeric
            applied.append({"column": col, "transform": "integer_enforcement"})
        if col in log_columns:
            min_val = numeric.min(skipna=True)
            shift = float(abs(min_val) + 1) if pd.notna(min_val) and min_val <= -1 else 0.0
            X[col] = np.log1p(numeric + shift)
            applied.append({"column": col, "transform": "log1p", "shift": shift})
    return X, applied

def _whatif_raw_features(X_raw):
    """Summarize each raw feature's range/categories so the UI can render sliders."""
    features = []
    for col in X_raw.columns:
        s = X_raw[col]
        present = s.dropna()
        if pd.api.types.is_numeric_dtype(s):
            mean = float(present.mean()) if len(present) else 0.0
            std = float(present.std() or 1.0) if len(present) else 1.0
            numeric_present = pd.to_numeric(present, errors="coerce").dropna()
            is_integer = bool(
                len(numeric_present)
                and np.all(np.isclose(numeric_present.to_numpy(dtype=float), np.round(numeric_present.to_numpy(dtype=float))))
            )
            default = int(round(mean)) if is_integer else mean
            features.append({
                "name": col,
                "kind": "numeric",
                "dtype": "int" if is_integer else "float",
                "step": 1 if is_integer else None,
                "default": default,
                "mean": mean,
                "std": std,
                "min": int(present.min()) if is_integer and len(present) else float(present.min()) if len(present) else mean - 2 * std,
                "max": int(present.max()) if is_integer and len(present) else float(present.max()) if len(present) else mean + 2 * std,
            })
        else:
            counts = present.astype(str).value_counts()
            values = counts.index.tolist()
            features.append({
                "name": col,
                "kind": "categorical",
                "values": values[:100],
                "default": values[0] if values else "",
            })
    return features
