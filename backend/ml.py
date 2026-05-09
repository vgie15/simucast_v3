"""
Machine-learning helpers: preprocessing plan, training, what-if support.

This module owns the ALGORITHM_CATALOG, ``_build_preprocessing_plan`` (which
the test suite imports through ``backend.app``), the train/CV pipeline, and
the helpers that serialize a fitted estimator + scaler so What-if can replay
the same preprocessing pipeline at prediction time.
"""
import base64
import pickle

import numpy as np
import pandas as pd

from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.model_selection import KFold, StratifiedKFold, cross_val_score, train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder, MinMaxScaler
from sklearn.metrics import (
    accuracy_score, roc_auc_score, precision_score, recall_score,
    f1_score, confusion_matrix, mean_squared_error, r2_score
)

from backend.utils import _parse_num, clean_json, jdump, friendly_error_message


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
    "rf": {"n_estimators": 100, "max_depth": None, "min_samples_leaf": 1},
    "tree": {"max_depth": None, "min_samples_leaf": 1},
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
    elif algo == "tree":
        depth = params.get("max_depth", clean["max_depth"])
        clean["max_depth"] = None if depth in (None, "", "none", "None") else min(max(_parse_num(depth, 10, int), 1), 50)
        clean["min_samples_leaf"] = min(max(_parse_num(params.get("min_samples_leaf"), clean["min_samples_leaf"], int), 1), 50)
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
    return (
        pd.api.types.is_object_dtype(y)
        or pd.api.types.is_categorical_dtype(y)
        or pd.api.types.is_bool_dtype(y)
    )


def _build_preprocessing_plan(df, target, features, algorithms, target_options=None):
    """Inspect the data and produce a transparent preprocessing plan.

    Returned shape is also stored on each trained model so the user can see
    after the fact exactly what was done.
    """
    if target not in df.columns:
        raise ValueError(f"target '{target}' not in dataset")
    features = [f for f in features if f in df.columns and f != target]
    if not features:
        raise ValueError("pick at least one feature")
    excluded_features = []
    kept_features = []
    for f in features:
        reason = _is_identifier_feature(df[f], len(df))
        if reason:
            excluded_features.append({"feature": f, "reason": reason})
        else:
            kept_features.append(f)
    features = kept_features
    if not features:
        raise ValueError("all selected features were identifiers or constant columns")

    sub = df[features + [target]]
    rows_before = len(sub)
    sub_clean = sub.dropna()
    rows_after = len(sub_clean)
    dropped = rows_before - rows_after

    target_options = target_options or {}
    test_size = min(max(_parse_num(target_options.get("test_size"), 0.2, float), 0.05), 0.5)
    validation_method = target_options.get("validation_method") if target_options.get("validation_method") in ("standard_split", "cross_validation") else "standard_split"
    cv_folds = int(min(max(_parse_num(target_options.get("cv_folds"), 5, int), 3), 10))
    stratify_split = bool(target_options.get("stratify", True))
    class_weight = target_options.get("class_weight") if target_options.get("class_weight") in ("balanced", None) else None
    y = sub_clean[target]
    task = "classification" if _detect_task(y) else "regression"
    algorithms = [
        a for a in algorithms or []
        if ALGORITHM_CATALOG.get(a) and (ALGORITHM_CATALOG[a]["task"] == "both" or ALGORITHM_CATALOG[a]["task"] == task)
    ]
    available_algorithms = AVAILABLE_ALGOS_BY_TASK.get(task, [])
    target_classes = [str(x) for x in y.dropna().astype(str).value_counts().index.tolist()] if task == "classification" else []
    target_mode = target_options.get("mode") or ("binary" if task == "classification" and len(target_classes) == 2 else "multiclass")
    positive_class = target_options.get("positive_class") or (target_classes[0] if target_classes else None)
    target_context = None
    if task == "regression":
        y_num = pd.to_numeric(y, errors="coerce").dropna()
        if len(y_num):
            target_context = {
                "min": float(y_num.min()),
                "max": float(y_num.max()),
                "mean": float(y_num.mean()),
                "std": float(y_num.std() or 0),
            }

    # encoding
    encoding = []
    for c in features:
        col = sub_clean[c]
        if pd.api.types.is_numeric_dtype(col):
            continue
        cats = col.astype(str).unique().tolist()
        encoding.append({
            "column": c,
            "method": "one_hot",
            "n_categories": len(cats),
            "sample_categories": cats[:6],
        })

    # algos requested → does scaling apply?
    scaling = []
    needs_scaling = any(ALGORITHM_CATALOG.get(a, {}).get("needs_scaling") for a in algorithms or [])
    if needs_scaling:
        scaling = [{
            "method": "StandardScaler",
            "columns": "all numeric features (after one-hot encoding)",
            "applies_to": [a for a in algorithms or [] if ALGORITHM_CATALOG.get(a, {}).get("needs_scaling")],
        }]

    numeric_features_for_plan = [c for c in features if pd.api.types.is_numeric_dtype(sub_clean[c])]
    numeric_options = target_options.get("numeric_preprocessing") or {}
    scaling_method = (numeric_options.get("scaling") or "auto").lower()
    if scaling_method not in ("auto", "none", "standard", "minmax"):
        scaling_method = "auto"
    log_columns = [c for c in numeric_options.get("log_columns") or [] if c in numeric_features_for_plan]
    integer_columns = [c for c in numeric_options.get("integer_columns") or [] if c in numeric_features_for_plan]
    skewed_columns = []
    for c in numeric_features_for_plan:
        try:
            skew = float(pd.to_numeric(sub_clean[c], errors="coerce").dropna().skew())
            if abs(skew) >= 1:
                skewed_columns.append({"column": c, "skew": skew})
        except Exception:
            pass
    effective_scaling = scaling_method
    if scaling_method == "auto":
        effective_scaling = "standard" if needs_scaling else "none"
    if effective_scaling == "minmax" and numeric_features_for_plan:
        scaling = [{
            "method": "MinMaxScaler",
            "columns": "numeric/encoded modeling features",
            "applies_to": algorithms or [],
            "selected_by": "user",
        }]
    elif effective_scaling == "standard" and numeric_features_for_plan:
        scaling = [{
            "method": "StandardScaler",
            "columns": "numeric/encoded modeling features",
            "applies_to": [a for a in algorithms or [] if scaling_method != "auto" or ALGORITHM_CATALOG.get(a, {}).get("needs_scaling")],
            "selected_by": "user" if scaling_method != "auto" else "auto",
        }]

    # missing report
    missing_report = [
        {"column": c, "missing": int(sub[c].isna().sum())}
        for c in features + [target] if sub[c].isna().sum() > 0
    ]

    # warnings
    warnings = []
    hard_blocks = []
    multicollinearity = []
    n_per_class = None
    target_groups_detected = []
    if task == "classification":
        n_per_class = y.value_counts().to_dict()
        smallest = min(n_per_class.values()) if n_per_class else 0
        total = sum(n_per_class.values()) if n_per_class else 0
        largest = max(n_per_class.values()) if n_per_class else 0
        imbalance_ratio = (largest / total) if total else 0
        effective_classes = n_per_class
        if target_mode == "binary":
            positive_count = int(y.astype(str).eq(str(positive_class)).sum()) if positive_class is not None else 0
            negative_count = int(len(y) - positive_count)
            effective_classes = {str(positive_class): positive_count, f"not {positive_class}": negative_count}
            if positive_count == 0 or negative_count == 0:
                hard_blocks.append({
                    "code": "binary_target_single_class",
                    "message": f"Binary target setup creates only one class. Choose a positive class that exists in '{target}', or standardize the target categories first.",
                    "column": target,
                    "positive_class": positive_class,
                    "class_counts": clean_json(n_per_class),
                })
        if smallest < 10:
            warnings.append(f"Smallest class has only {smallest} examples — model quality will be unreliable.")
        if imbalance_ratio >= 0.75 and len(n_per_class) > 1:
            warnings.append(f"Class imbalance detected - largest class is {imbalance_ratio:.0%} of usable rows.")
        if len(n_per_class) > 2 and target_mode == "binary":
            warnings.append(f"Binary mode will reduce {len(n_per_class)} target categories into '{positive_class}' vs all others.")
        elif len(n_per_class) > 2:
            warnings.append("Multiclass target detected. Use binary mode if the analysis needs one selected category versus the rest.")
        if len(n_per_class) > 10:
            warnings.append(f"{len(n_per_class)} distinct target values — high cardinality may hurt accuracy.")
        if not pd.api.types.is_numeric_dtype(y):
            from backend.blueprints.datasets import _category_groups  # local import to avoid circular dep
            target_groups = [g for g in _category_groups(y.dropna().astype(str).unique().tolist(), threshold=0.88) if len(g.get("values", [])) > 1]
            target_groups_detected = target_groups
            if target_groups:
                hard_blocks.append({
                    "code": "target_categories_dirty",
                    "message": f"Target '{target}' has similar category labels. Fix categories first in Data standardization before modeling.",
                    "column": target,
                    "groups": target_groups[:5],
                })
        if len([count for count in effective_classes.values() if count > 0]) < 2:
            hard_blocks.append({
                "code": "target_single_effective_class",
                "message": f"Target '{target}' has fewer than two usable classes for the selected setup.",
                "column": target,
                "class_counts": clean_json(effective_classes),
            })
    if rows_after < 50:
        warnings.append(f"Only {rows_after} complete rows after dropping missing — consider Expand or imputation.")

    # leakage heuristics: features with same uniqueness as rows ≈ id-like
    if excluded_features:
        warnings.append("Identifier or constant columns were excluded from modeling: " + ", ".join(x["feature"] for x in excluded_features))

    for c in features:
        nunique = df[c].nunique(dropna=True)
        if nunique <= 1:
            warnings.append(f"'{c}' is constant or nearly empty - it cannot help the model.")
        if nunique == rows_before:
            warnings.append(f"'{c}' appears to be an ID — every row has a unique value, so it'll memorize the target.")
        # high correlation with target (numeric only)
        if pd.api.types.is_numeric_dtype(sub_clean[c]) and pd.api.types.is_numeric_dtype(y):
            try:
                corr = sub_clean[c].corr(y)
                if corr is not None and abs(corr) > 0.99:
                    warnings.append(f"'{c}' is almost perfectly correlated with target ({corr:+.2f}) — possible leakage.")
            except Exception:
                pass

    numeric_features = numeric_features_for_plan
    if len(numeric_features) >= 2:
        corr = sub_clean[numeric_features].corr(numeric_only=True).abs()
        for i, a in enumerate(numeric_features):
            for b in numeric_features[i + 1:]:
                val = corr.loc[a, b]
                if pd.notna(val) and val >= 0.85:
                    multicollinearity.append({
                        "feature_a": a,
                        "feature_b": b,
                        "correlation": float(val),
                        "severity": "high" if val >= 0.95 else "medium",
                    })
        if multicollinearity:
            warnings.append(f"Detected {len(multicollinearity)} highly correlated feature pair(s). Linear-style models may be unstable.")

    # ---- enriched validation checks ----

    # 1. Missing values
    vc_missing = {
        "key": "missing_values",
        "label": "Missing values",
        "status": "warning" if missing_report else "ok",
        "detail": f"{len(missing_report)} column(s) have missing values — incomplete rows will be dropped for modeling." if missing_report else "No missing values in selected modeling columns.",
        "type": "data",
        "causes": ["incomplete records", "import errors"] if missing_report else [],
        "fixes": [
            {"label": "Impute or drop missing values", "description": "Data → Manual Transforms — fill or drop rows with missing values", "route": "data", "section": "manual_transforms"},
        ] if missing_report else [],
    }

    # 2. Category consistency (dirty target labels)
    cat_dirty_block = next((b for b in hard_blocks if b["code"] == "target_categories_dirty"), None)
    vc_categories = {
        "key": "category_consistency",
        "label": "Category consistency",
        "status": "block" if cat_dirty_block else "ok",
        "detail": f"Target '{target}' has similar category labels that must be merged before training." if cat_dirty_block else "No target category conflicts detected.",
        "type": "data",
        "causes": ["typos", "inconsistent label formatting"] if cat_dirty_block else [],
        "fixes": [
            {"label": "Standardize categories", "description": "Data → Category Standardization — merge similar labels in the target column", "route": "data", "section": "category_standardization"},
        ] if cat_dirty_block else [],
    }

    # 3. Class balance
    cb_status = "ok"
    cb_detail = "Not applicable for regression." if task != "classification" else "No severe class imbalance detected."
    cb_causes = []
    cb_fixes = []
    if task == "classification" and n_per_class:
        _smallest = min(n_per_class.values())
        _total = sum(n_per_class.values())
        _largest = max(n_per_class.values())
        _ratio = _largest / _total if _total else 0
        _is_multi = len(n_per_class) > 2
        binary_block = next((b for b in hard_blocks if b["code"] == "binary_target_single_class"), None)
        eff_block = next((b for b in hard_blocks if b["code"] == "target_single_effective_class"), None)
        if binary_block or eff_block:
            cb_status = "block"
            cb_detail = "Target has only one effective class for the current setup — cannot train."
            cb_causes = ["class count collapsed to one due to binary mode or missing categories"]
            cb_fixes = [
                {"label": "Standardize categories", "description": "Data → Category Standardization — merge similar labels to restore valid classes", "route": "data", "section": "category_standardization"},
                {"label": "Change positive class", "description": "Models → Target handling — select a different positive class", "route": "models", "section": "target_options"},
            ]
        elif _smallest < 5:
            cb_status = "warning"
            _ex = "example" if _smallest == 1 else "examples"
            cb_detail = f"Smallest class has only {_smallest} {_ex}."
            if _is_multi:
                cb_detail += " Multiclass target detected; use binary mode if the analysis needs one selected category versus the rest."
            cb_causes = ["messy or split category labels", "real class imbalance", "very small dataset"]
            cb_fixes = [
                {"label": "Standardize categories", "description": "Data → Category Standardization — merge similar labels to consolidate small classes", "route": "data", "section": "category_standardization"},
                {"label": "Use binary mode", "description": "Models → Target handling — treat one class vs. rest", "route": "models", "section": "target_options"},
                {"label": "Use balanced class weights", "description": "Models → Imbalance handling — compensate for unequal class sizes", "route": "models", "section": "class_weight"},
            ]
        elif _ratio >= 0.75:
            cb_status = "warning"
            cb_detail = f"Class imbalance detected — largest class is {_ratio:.0%} of usable rows."
            cb_causes = ["real class imbalance in data"]
            cb_fixes = [
                {"label": "Use balanced class weights", "description": "Models → Imbalance handling — compensate for class size differences", "route": "models", "section": "class_weight"},
                {"label": "Standardize categories", "description": "Data → Category Standardization — check if messy labels are splitting a class", "route": "data", "section": "category_standardization"},
            ]
    vc_class_balance = {
        "key": "class_balance",
        "label": "Class balance",
        "status": cb_status,
        "detail": cb_detail,
        "type": "modeling",
        "causes": cb_causes,
        "fixes": cb_fixes,
    }

    # 4. Multicollinearity
    severity_level = None
    severity_message = None
    plan_feature_pairs = []
    fixes = []
    detail_text = "No highly correlated numeric feature pairs detected."
    selected_labels = [_algo_label_for_task(a, task) for a in algorithms]

    if multicollinearity:
        severity_counts = {"low": 0, "medium": 0, "high": 0}
        for pair in multicollinearity:
            severity_counts[pair.get("severity") or "medium"] += 1

        if severity_counts["high"]:
            severity_level = "high"
            severity_message = "High severity — recommended to address before training."
        elif severity_counts["medium"]:
            severity_level = "medium"
            severity_message = "Medium severity — monitor linear models carefully."
        else:
            severity_level = "low"
            severity_message = "Low severity — usually safe to ignore."

        is_regression = task == "regression"
        is_classification = task == "classification"
        available_set = set(available_algorithms)
        tree_options = [a for a in available_set if a in ("rf", "tree")]
        linear_selected = [a for a in algorithms if a in ("linear", "logistic")]
        tree_selected = [a for a in algorithms if a in ("rf", "tree")]
        logistic_available = is_classification and "logistic" in available_set

        linear_labels = [_algo_label_for_task(a, task) for a in linear_selected]
        tree_labels = [_algo_label_for_task(a, task) for a in tree_selected]
        tree_option_labels = [_algo_label_for_task(a, task) for a in tree_options]
        logistic_label = _algo_label_for_task("logistic", task) if logistic_available else None

        detail_lines = [
            f"Detected {len(multicollinearity)} pair{'s' if len(multicollinearity) == 1 else 's'} of features sharing very similar information.",
        ]
        if is_regression:
            detail_lines.append("Linear Regression can become unstable when features overlap this much.")
        else:
            linear_note_names = ", ".join(linear_labels or ([logistic_label] if logistic_label and not linear_labels else []))
            if linear_note_names:
                detail_lines.append(f"Linear classifiers like {linear_note_names} can become harder to interpret when features overlap too much.")
        if tree_selected:
            detail_lines.append(f"Tree-based models such as {', '.join(tree_labels)} are naturally resilient to this overlap.")
        elif tree_option_labels:
            detail_lines.append(f"Tree-based models like {', '.join(tree_option_labels)} are resilient to this overlap.")

        detail_text = " ".join(detail_lines)

        plan_feature_pairs = [
            {
                "feature_a": pair["feature_a"],
                "feature_b": pair["feature_b"],
                "correlation": float(pair.get("correlation", 0.0)),
                "severity": pair.get("severity", "medium"),
            }
            for pair in multicollinearity
        ]

        fixes.append({
            "label": "Remove overlapping features",
            "description": "Recommended — drop one column from each highly correlated pair before training.",
            "route": "data",
            "section": "manual_transforms",
            "category": "recommended",
        })

        if tree_selected or tree_option_labels:
            fixes.append({
                "label": "Use tree-based regressors" if is_regression else "Use tree-based classifiers",
                "description": "Decision Trees and Random Forests are less sensitive to overlapping inputs.",
                "route": "models",
                "section": "algorithms",
                "category": "alternative",
            })

        if logistic_available:
            fixes.append({
                "label": "Use Logistic Regression mindfully",
                "description": "Logistic Regression can work, but highly correlated features make coefficients harder to interpret.",
                "route": "models",
                "section": "algorithms",
                "category": "alternative",
            })

    vc_multicollinearity = {
        "key": "multicollinearity",
        "label": "Highly overlapping features",
        "status": "warning" if multicollinearity else "ok",
        "detail": detail_text,
        "type": "data",
        "causes": [
            "Multiple columns were derived from the same source",
            "Variables capture nearly the same measurement",
        ] if multicollinearity else [],
        "fixes": fixes,
        "severity": severity_level,
        "severity_message": severity_message,
        "correlated_pairs": plan_feature_pairs,
        "selected_algorithms": selected_labels,
        "available_algorithms": available_algorithms,
    }

    # 5. Train/test split (always ok)
    vc_split = {
        "key": "train_test_split",
        "label": "Validation configured",
        "status": "ok",
        "detail": (
            f"Train {int((1 - test_size) * 100)}% / test {int(test_size * 100)}"
            + (" with stratification" if task == "classification" and stratify_split else "")
            + (f" plus {cv_folds}-fold cross-validation." if validation_method == "cross_validation" else ".")
        ),
        "type": "modeling",
        "causes": [],
        "fixes": [],
    }

    validation_checks = [vc_missing, vc_categories, vc_class_balance, vc_multicollinearity, vc_split]

    return {
        "task": task,
        "target": target,
        "features": features,
        "excluded_features": excluded_features,
        "rows_used": rows_after,
        "rows_dropped": dropped,
        "encoding": encoding,
        "scaling": scaling,
        "numeric_preprocessing": {
            "scaling": scaling_method,
            "effective_scaling": effective_scaling,
            "log_columns": log_columns,
            "integer_columns": integer_columns,
            "numeric_features": numeric_features_for_plan,
            "skewed_columns": skewed_columns,
        },
        "missing_report": missing_report,
        "class_balance": {str(k): int(v) for k, v in (n_per_class or {}).items()} if task == "classification" else None,
        "target_classes": target_classes,
        "target_mode": target_mode if task == "classification" else None,
        "positive_class": positive_class if task == "classification" else None,
        "target_context": target_context,
        "split": {
            "train_size": 1 - test_size,
            "test_size": test_size,
            "stratified": bool(task == "classification" and stratify_split),
            "validation_method": validation_method,
            "cv_folds": cv_folds if validation_method == "cross_validation" else None,
        },
        "validation_method": validation_method,
        "cv_folds": cv_folds if validation_method == "cross_validation" else None,
        "class_weight": class_weight if task == "classification" else None,
        "model_params": {a: _model_default_params(a) for a in algorithms or [] if a in ALGORITHM_CATALOG},
        "multicollinearity": multicollinearity,
        "available_algorithms": available_algorithms,
        "validation_checks": validation_checks,
        "hard_blocks": hard_blocks,
        "warnings": warnings,
    }


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
    max_strength = max((v["strength"] for v in rows.values()), default=1.0) or 1.0
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
            "relative_strength": float(strength / max_strength),
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


def _build_model_estimator(algo, is_classification, params, class_weight=None):
    """Construct the appropriate sklearn estimator for the (algo, task) pair."""
    if is_classification:
        if algo == "rf":
            return RandomForestClassifier(n_estimators=params["n_estimators"], max_depth=params["max_depth"], min_samples_leaf=params["min_samples_leaf"], random_state=42, class_weight=class_weight)
        if algo == "tree":
            return DecisionTreeClassifier(max_depth=params["max_depth"], min_samples_leaf=params["min_samples_leaf"], random_state=42, class_weight=class_weight)
        if algo == "logistic":
            return LogisticRegression(C=params["C"], max_iter=params["max_iter"], class_weight=class_weight)
        raise ValueError(f"algorithm '{algo}' not supported for classification")
    if algo == "rf":
        return RandomForestRegressor(n_estimators=params["n_estimators"], max_depth=params["max_depth"], min_samples_leaf=params["min_samples_leaf"], random_state=42)
    if algo == "tree":
        return DecisionTreeRegressor(max_depth=params["max_depth"], min_samples_leaf=params["min_samples_leaf"], random_state=42)
    if algo == "linear":
        return LinearRegression(fit_intercept=params["fit_intercept"])
    raise ValueError(f"algorithm '{algo}' not supported for regression")


def _cross_validation_metrics(algo, X, y, is_classification, params, plan):
    """Compute optional k-fold CV metrics when the plan asked for them."""
    validation_method = (plan.get("validation_method") or (plan.get("split") or {}).get("validation_method") or "standard_split")
    if validation_method != "cross_validation":
        return None
    try:
        n_rows = len(X)
        if n_rows < 10:
            return {"enabled": True, "available": False, "reason": "At least 10 complete rows are needed for cross-validation."}
        estimator = _build_model_estimator(algo, is_classification, params, plan.get("class_weight") if is_classification else None)
        if is_classification:
            counts = pd.Series(y).value_counts()
            if len(counts) < 2:
                return {"enabled": True, "available": False, "reason": "At least two classes are needed for cross-validation."}
            folds = int(min(int(plan.get("cv_folds") or 5), counts.min(), n_rows))
            if folds < 2:
                return {"enabled": True, "available": False, "reason": "Each class needs at least two examples for cross-validation."}
            cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=42)
            scoring = "accuracy"
            label = "accuracy"
        else:
            folds = int(min(int(plan.get("cv_folds") or 5), n_rows))
            if folds < 2:
                return {"enabled": True, "available": False, "reason": "At least two complete rows are needed for cross-validation."}
            cv = KFold(n_splits=folds, shuffle=True, random_state=42)
            scoring = "r2"
            label = "r2"
        scores = cross_val_score(estimator, X, y, cv=cv, scoring=scoring)
        return {
            "enabled": True,
            "available": True,
            "method": f"{folds}-fold cross-validation",
            "metric": label,
            "mean": float(np.mean(scores)),
            "std": float(np.std(scores)),
            "fold_scores": [float(x) for x in scores.tolist()],
        }
    except Exception as exc:
        return {"enabled": True, "available": False, "reason": friendly_error_message(exc, "Cross-validation could not be computed for this setup.")}


def _train_one(df, target, features, algo, test_size, plan, model_params=None):
    """Train a single model. Returns a dict with metrics + importance.

    The transparent preprocessing plan is reused so every algorithm in a
    multi-train run sees an identical pipeline.
    """
    data = df[features + [target]].dropna()
    params = _sanitize_model_params(algo, model_params)
    X_raw = data[features].copy()
    X, numeric_applied = _apply_numeric_preprocessing_frame(X_raw, plan.get("numeric_preprocessing"))
    y = data[target]

    X = pd.get_dummies(X, drop_first=True, prefix_sep="=").astype(float)

    is_classification = plan["task"] == "classification"
    class_labels = None
    if is_classification:
        if plan.get("target_mode") == "binary":
            positive = str(plan.get("positive_class"))
            y = y.astype(str).eq(positive).astype(int)
            class_labels = [f"not {positive}", positive]
        elif pd.api.types.is_bool_dtype(y):
            class_labels = ["False", "True"]
            y = y.astype(int)
        elif not pd.api.types.is_numeric_dtype(y):
            labels = sorted(y.dropna().astype(str).unique().tolist())
            class_labels = labels
            y = LabelEncoder().fit_transform(y.astype(str))

    effective_scaling = (plan.get("numeric_preprocessing") or {}).get("effective_scaling")
    needs_scaling = ALGORITHM_CATALOG.get(algo, {}).get("needs_scaling", False)
    scaler_kind = effective_scaling if effective_scaling in ("standard", "minmax") else ("standard" if needs_scaling else "none")
    scaler = None
    if scaler_kind != "none":
        scaler = MinMaxScaler() if scaler_kind == "minmax" else StandardScaler()
        X_scaled = pd.DataFrame(scaler.fit_transform(X), columns=X.columns, index=X.index)
    else:
        X_scaled = X

    stratify = None
    if is_classification and plan.get("split", {}).get("stratified"):
        counts = pd.Series(y).value_counts()
        if len(counts) > 1 and int(counts.min()) >= 2:
            stratify = y

    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=test_size, random_state=42, stratify=stratify
    )

    if is_classification:
        clf = _build_model_estimator(algo, True, params, plan.get("class_weight"))
        clf.fit(X_train, y_train)
        y_pred = clf.predict(X_test)
        y_train_pred = clf.predict(X_train)
        metrics = {
            "task": "classification",
            "train_accuracy": float(accuracy_score(y_train, y_train_pred)),
            "train_precision": float(precision_score(y_train, y_train_pred, average="weighted", zero_division=0)),
            "train_recall": float(recall_score(y_train, y_train_pred, average="weighted", zero_division=0)),
            "train_f1": float(f1_score(y_train, y_train_pred, average="weighted", zero_division=0)),
            "accuracy": float(accuracy_score(y_test, y_pred)),
            "precision": float(precision_score(y_test, y_pred, average="weighted", zero_division=0)),
            "recall": float(recall_score(y_test, y_pred, average="weighted", zero_division=0)),
            "f1": float(f1_score(y_test, y_pred, average="weighted", zero_division=0)),
            "split": plan.get("split"),
            "split_rows": {"train": int(len(X_train)), "test": int(len(X_test))},
            "class_weight": plan.get("class_weight"),
            "model_params": params,
            "validation_method": plan.get("validation_method", "standard_split"),
        }
        metrics["generalization_gap"] = float(metrics["train_accuracy"] - metrics["accuracy"])
        cv = _cross_validation_metrics(algo, X_scaled, y, True, params, plan)
        if cv:
            metrics["cross_validation"] = cv
        metrics["health_diagnostics"] = _model_health_diagnostics(metrics, plan, algo)
        if len(np.unique(y)) == 2 and hasattr(clf, "predict_proba"):
            try:
                y_proba = clf.predict_proba(X_test)[:, 1]
                metrics["auc"] = float(roc_auc_score(y_test, y_proba))
            except Exception:
                pass
        metrics["confusion_matrix"] = confusion_matrix(y_test, y_pred).tolist()
    else:
        clf = _build_model_estimator(algo, False, params)
        clf.fit(X_train, y_train)
        y_pred = clf.predict(X_test)
        y_train_pred = clf.predict(X_train)
        metrics = {
            "task": "regression",
            "train_r2": float(r2_score(y_train, y_train_pred)),
            "train_rmse": float(np.sqrt(mean_squared_error(y_train, y_train_pred))),
            "train_mae": float(np.mean(np.abs(y_train - y_train_pred))),
            "r2": float(r2_score(y_test, y_pred)),
            "rmse": float(np.sqrt(mean_squared_error(y_test, y_pred))),
            "mae": float(np.mean(np.abs(y_test - y_pred))),
            "split": plan.get("split"),
            "split_rows": {"train": int(len(X_train)), "test": int(len(X_test))},
            "model_params": params,
            "validation_method": plan.get("validation_method", "standard_split"),
        }
        metrics["generalization_gap"] = float(metrics["train_r2"] - metrics["r2"])
        cv = _cross_validation_metrics(algo, X_scaled, y, False, params, plan)
        if cv:
            metrics["cross_validation"] = cv
        metrics["health_diagnostics"] = _model_health_diagnostics(metrics, plan, algo)

    influence = _feature_influence_from_model(clf, X.columns.tolist(), features, algo)

    numeric_encoded = X.apply(pd.to_numeric, errors="coerce").fillna(0).astype(float)
    feature_means = {c: float(scaler.mean_[i]) if scaler is not None and hasattr(scaler, "mean_") else float(numeric_encoded[c].mean())
                     for i, c in enumerate(X.columns)}
    feature_stds = {c: float(scaler.scale_[i]) if scaler is not None and hasattr(scaler, "scale_") else float(numeric_encoded[c].std() or 1)
                    for i, c in enumerate(X.columns)}
    feature_mins = {c: float(scaler.data_min_[i]) if scaler is not None and hasattr(scaler, "data_min_") else float(numeric_encoded[c].min()) for i, c in enumerate(X.columns)}
    feature_ranges = {c: float(scaler.data_range_[i]) if scaler is not None and hasattr(scaler, "data_range_") else float((numeric_encoded[c].max() - numeric_encoded[c].min()) or 1) for i, c in enumerate(X.columns)}
    coefficients = {
        "prediction_kind": "fitted_model",
        "estimator_b64": _serialize_estimator(clf),
        "algorithm": algo,
        "features": X.columns.tolist(),
        "encoded_features": X.columns.tolist(),
        "original_features": features,
        "task": metrics["task"],
        "target": target,
        "target_mode": plan.get("target_mode"),
        "positive_class": plan.get("positive_class"),
        "class_labels": class_labels,
        "model_classes": np.asarray(getattr(clf, "classes_", [])).ravel().tolist() if hasattr(clf, "classes_") else None,
        "target_context": plan.get("target_context"),
        "feature_means": feature_means,
        "feature_stds": feature_stds,
        "feature_mins": feature_mins,
        "feature_ranges": feature_ranges,
        "raw_features": _whatif_raw_features(X_raw),
        "dummy_sep": "=",
        "scaled": scaler is not None,
        "scaler_kind": scaler_kind if scaler is not None else None,
        "numeric_preprocessing": plan.get("numeric_preprocessing"),
        "numeric_transforms_applied": numeric_applied,
        "model_behavior": "stepwise" if algo in ("tree", "rf") else "smooth",
        "preprocessing_pipeline": {
            "encoding": plan.get("encoding"),
            "scaling": plan.get("scaling"),
            "numeric_preprocessing": plan.get("numeric_preprocessing"),
            "features": features,
            "encoded_features": X.columns.tolist(),
        },
    }

    if algo in ("linear", "logistic") and hasattr(clf, "coef_"):
        coef_array = np.asarray(clf.coef_)
        coefficients.update({
            "coef": coef_array.ravel().tolist(),
            "coef_matrix": coef_array.tolist(),
            "intercept": float(np.asarray(clf.intercept_).ravel()[0]) if hasattr(clf, "intercept_") else 0.0,
            "intercepts": np.asarray(clf.intercept_).ravel().tolist() if hasattr(clf, "intercept_") else [0.0],
            "classes": np.asarray(getattr(clf, "classes_", [])).ravel().tolist() if hasattr(clf, "classes_") else None,
        })

    return {
        "metrics": metrics,
        "importance": influence,
        "coefficients": coefficients,
        "encoded_features": X.columns.tolist(),
        "model_params": params,
    }


def _whatif_raw_features(X_raw):
    """Summarize each raw feature's range/categories so the UI can render sliders."""
    features = []
    for col in X_raw.columns:
        s = X_raw[col]
        present = s.dropna()
        if pd.api.types.is_numeric_dtype(s):
            mean = float(present.mean()) if len(present) else 0.0
            std = float(present.std() or 1.0) if len(present) else 1.0
            features.append({
                "name": col,
                "kind": "numeric",
                "mean": mean,
                "std": std,
                "min": float(present.min()) if len(present) else mean - 2 * std,
                "max": float(present.max()) if len(present) else mean + 2 * std,
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


def _model_health_diagnostics(metrics, plan=None, algo=None):
    """Persist a beginner-friendly train/test health summary with every new model run."""
    plan = plan or {}
    task = metrics.get("task")
    gap = abs(float(metrics.get("generalization_gap") or 0))
    rows = metrics.get("split_rows") or {}
    rows_total = int((rows.get("train") or 0) + (rows.get("test") or 0))
    feature_count = len(plan.get("features") or [])
    complexity = "complex" if algo in ("rf",) else "moderate" if algo == "tree" else "simple"
    small_data = rows_total and rows_total < 100
    feature_heavy = rows_total and feature_count >= max(10, rows_total // 4)
    cv = metrics.get("cross_validation") or {}
    cv_unstable = cv.get("std") is not None and float(cv.get("std") or 0) >= 0.12

    def base_causes():
        causes = []
        if small_data:
            causes.append(f"Only {rows_total} usable rows were available, so validation can be unstable.")
        if feature_heavy:
            causes.append(f"{feature_count} selected features is high for this sample size.")
        if complexity == "complex":
            causes.append("Random Forest is more flexible and can memorize small or noisy datasets.")
        elif complexity == "moderate":
            causes.append("Decision trees can overfit when depth is not constrained.")
        if plan.get("multicollinearity"):
            causes.append("Highly correlated features may make model behavior less stable.")
        if cv_unstable:
            causes.append("Cross-validation scores vary across folds, suggesting unstable performance.")
        return causes

    def fixes(overfit=False, underfit=False):
        actions = []
        if overfit:
            actions.extend([
                {"label": "Review feature selection", "why": "Fewer, cleaner features can reduce memorization.", "route": "models.features"},
                {"label": "Try a simpler model", "why": "A simpler baseline is less likely to memorize small datasets.", "route": "models.algorithms"},
                {"label": "Tune complexity", "why": "Lower max depth or increase minimum samples per leaf for tree models.", "route": "models.tuning"},
            ])
            if plan.get("multicollinearity"):
                actions.append({"label": "Check correlations", "why": "Removing redundant features can stabilize the model.", "route": "tests.correlation"})
        if underfit:
            actions.extend([
                {"label": "Review selected features", "why": "The model may not have enough useful predictors.", "route": "models.features"},
                {"label": "Try a stronger model", "why": "A more flexible model may capture patterns a simple model misses.", "route": "models.algorithms"},
            ])
        if small_data:
            actions.append({"label": "Consider expansion", "why": "More rows can make validation more reliable for small datasets.", "route": "expand.recommendation"})
        actions.append({"label": "Use cross-validation", "why": "Multiple validation splits give a steadier generalization estimate.", "route": "models.validation_split"})
        return actions[:5]

    def build(status, label, color, summary, causes=None, actions=None, confidence="normal"):
        return {
            "status": status,
            "label": label,
            "color": color,
            "summary": summary,
            "confidence": "low" if small_data else confidence,
            "causes": causes or [],
            "recommended_fixes": actions or [],
            "validation_method": metrics.get("validation_method", "standard_split"),
        }

    if task == "classification":
        train = metrics.get("train_accuracy")
        test = metrics.get("accuracy")
        if train is None or test is None:
            return build("insufficient_data", "Diagnostics unavailable", "gray", "Train/test health metrics are unavailable for this saved model.")
        if train < 0.65 and test < 0.65:
            return build("underfitting", "Possible underfitting", "blue", "Both training and test accuracy are low, so the model may be too simple or the selected features are not predictive.", base_causes(), fixes(underfit=True))
        if gap > 0.20:
            return build("severe_overfitting", "Severe overfitting risk", "red", "Training accuracy is far higher than test accuracy, which suggests the model may be memorizing training rows.", base_causes(), fixes(overfit=True))
        if gap > 0.10:
            return build("moderate_overfitting", "Moderate overfitting risk", "orange", "The train/test gap is large enough to review model complexity and selected features.", base_causes(), fixes(overfit=True))
        if gap > 0.05:
            return build("mild_overfitting", "Mild overfitting signal", "yellow", "The model performs slightly better on training data than test data. This is common, but worth monitoring.", base_causes(), fixes(overfit=True)[:3])
        return build("healthy", "Healthy", "green", "Training and test performance are close, so there is no major overfitting signal from this split.", base_causes(), [{"label": "Validate before reporting", "why": "Use another split or fresh data before treating results as final.", "route": "models.validation_split"}])
    if task == "regression":
        train = metrics.get("train_r2")
        test = metrics.get("r2")
        if train is None or test is None:
            return build("insufficient_data", "Diagnostics unavailable", "gray", "Train/test health metrics are unavailable for this saved model.")
        if train < 0.3 and test < 0.2:
            return build("underfitting", "Possible underfitting", "blue", "Both training and test R2 are low, so the model explains little of the target variation.", base_causes(), fixes(underfit=True))
        if gap > 0.20:
            return build("severe_overfitting", "Severe overfitting risk", "red", "Training R2 is far higher than test R2, which suggests weak generalization.", base_causes(), fixes(overfit=True))
        if gap > 0.10:
            return build("moderate_overfitting", "Moderate overfitting risk", "orange", "The train/test R2 gap is large enough to review model complexity and selected features.", base_causes(), fixes(overfit=True))
        if gap > 0.05:
            return build("mild_overfitting", "Mild overfitting signal", "yellow", "The model explains training rows somewhat better than test rows. This is worth monitoring.", base_causes(), fixes(overfit=True)[:3])
        return build("healthy", "Healthy", "green", "Training and test R2 are close, so there is no major overfitting signal from this split.", base_causes(), [{"label": "Validate before reporting", "why": "Use another split or fresh data before treating results as final.", "route": "models.validation_split"}])
    return build("insufficient_data", "Diagnostics unavailable", "gray", "Model health could not be classified for this saved model.")


_SIMUCAST_CAPABILITIES = [
    ("Data preparation", [
        "handle missing values", "handle outliers", "remove duplicates",
        "standardize categorical labels", "change column type", "rename columns",
        "drop rows/columns", "export cleaned data",
    ]),
    ("Feature engineering", ["create bins", "numeric formatting"]),
    ("Expand", [
        "decide whether expansion is needed", "recommend Bootstrap vs Synthetic",
        "configure target rows", "preview generated rows/stat changes", "apply expansion",
    ]),
    ("Describe", [
        "run descriptive statistics", "inspect variable cards", "view histogram/distribution",
        "view categorical distribution", "view correlation overview",
    ]),
    ("Analysis", [
        "run correlation", "run t-test", "run ANOVA", "run chi-square",
        "run PCA", "run K-means clustering",
    ]),
    ("Models", [
        "select target", "choose regression/classification algorithms", "configure validation split",
        "review preprocessing plan", "check multicollinearity", "check class balance",
        "train models", "compare metrics", "inspect feature importance", "check model health/overfitting",
    ]),
    ("What-if", [
        "use trained model", "adjust feature values", "compare baseline vs current prediction",
        "save scenario", "review extrapolation risk",
    ]),
    ("Report", [
        "include documentation logs", "include analysis results", "include model results",
        "include what-if scenarios", "include selected visualizations", "generate/export report",
    ]),
]


def _capability_text():
    """Plain-text bullet list of what SimuCast can do — used in AI prompts."""
    lines = []
    for category, items in _SIMUCAST_CAPABILITIES:
        lines.append(f"{category}:")
        lines.extend(f"- {item}" for item in items)
    return "\n".join(lines)
