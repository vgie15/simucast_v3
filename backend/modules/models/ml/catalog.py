"""Model catalog, parameter defaults, and lightweight modeling helpers."""

import pandas as pd

from backend.shared.utils import _parse_num

ALGORITHM_CATALOG = {
    "logistic": {"label": "Logistic regression", "task": "classification", "needs_scaling": True,  "interpretable": True},
    "rf":       {"label": "Random forest",       "task": "both",          "needs_scaling": False, "interpretable": False},
    "tree":     {"label": "Decision tree",       "task": "both",          "needs_scaling": False, "interpretable": False},
    "linear":   {"label": "Linear regression",   "task": "regression",    "needs_scaling": True,  "interpretable": True},
}

AVAILABLE_ALGOS_BY_TASK = {
    "classification": [k for k, v in ALGORITHM_CATALOG.items() if v["task"] in ("classification", "both")],
    "regression": [k for k, v in ALGORITHM_CATALOG.items() if v["task"] in ("regression", "both")],
}

MODEL_PARAM_DEFAULTS = {
    "logistic": {"C": 1.0, "max_iter": 1000},
    "rf": {"n_estimators": 100, "max_depth": None, "min_samples_leaf": 1, "random_state": 42},
    "tree": {"max_depth": None, "min_samples_leaf": 1, "random_state": 42},
    "linear": {"fit_intercept": True},
}


def _model_default_params(algo):
    """Return a fresh copy of the default hyperparameters for an algorithm."""
    return dict(MODEL_PARAM_DEFAULTS.get(algo, {}))


def _algo_label_for_task(algo, task=None):
    """Pretty label for an algorithm, specialized by classification/regression."""
    if algo == "rf":
        return "Random Forest Classifier" if task == "classification" else "Random Forest Regressor" if task == "regression" else "Random Forest"
    if algo == "tree":
        return "Decision Tree Classifier" if task == "classification" else "Decision Tree Regressor" if task == "regression" else "Decision Tree"
    return ALGORITHM_CATALOG.get(algo, {}).get("label", algo)


def _sanitize_model_params(algo, params=None):
    """Clamp user-supplied hyperparameters to safe ranges before training."""
    clean = _model_default_params(algo)
    params = params or {}
    if algo == "logistic":
        clean["C"] = min(max(_parse_num(params.get("C"), clean["C"], float), 0.001), 100.0)
        clean["max_iter"] = min(max(_parse_num(params.get("max_iter"), clean["max_iter"], int), 100), 5000)
    elif algo == "rf":
        clean["n_estimators"] = min(max(_parse_num(params.get("n_estimators"), clean["n_estimators"], int), 10), 500)
        depth = params.get("max_depth", clean["max_depth"])
        clean["max_depth"] = None if depth in (None, "", "none", "None") else min(max(_parse_num(depth, 10, int), 1), 50)
        clean["min_samples_leaf"] = min(max(_parse_num(params.get("min_samples_leaf"), clean["min_samples_leaf"], int), 1), 50)
        clean["random_state"] = min(max(_parse_num(params.get("random_state"), clean["random_state"], int), 0), 999)
    elif algo == "tree":
        depth = params.get("max_depth", clean["max_depth"])
        clean["max_depth"] = None if depth in (None, "", "none", "None") else min(max(_parse_num(depth, 10, int), 1), 50)
        clean["min_samples_leaf"] = min(max(_parse_num(params.get("min_samples_leaf"), clean["min_samples_leaf"], int), 1), 50)
        clean["random_state"] = min(max(_parse_num(params.get("random_state"), clean["random_state"], int), 0), 999)
    elif algo == "linear":
        clean["fit_intercept"] = bool(params.get("fit_intercept", clean["fit_intercept"]))
    return clean


def _is_identifier_feature(series, row_count):
    """Return 'constant' / 'identifier' if the column has no signal for modeling."""
    nunique = series.nunique(dropna=True)
    if nunique <= 1:
        return "constant"
    if row_count > 0 and nunique == row_count:
        return "identifier"
    return None


def _issue_check(label, issue, issue_type, severity, message, causes=None, actions=None):
    """Structured checklist issue used by the UI's generic fix-action menu.

    Keeps the older label/status/detail fields so existing rendering remains
    backward-compatible while newer surfaces can use issue/actions directly.
    """
    return {
        "label": label,
        "status": severity,
        "detail": message,
        "issue": issue,
        "issue_type": issue_type,
        "severity": severity,
        "message": message,
        "causes": causes or [],
        "actions": actions or [],
    }


def _detect_task(y):
    """Heuristic: small distinct count + non-continuous → classification."""
    if (
        pd.api.types.is_object_dtype(y)
        or pd.api.types.is_categorical_dtype(y)
        or pd.api.types.is_bool_dtype(y)
    ):
        return True
    if pd.api.types.is_integer_dtype(y):
        try:
            return y.dropna().nunique() <= 10
        except Exception:
            return False
    return False

