"""Training, cross-validation, metrics, and estimator construction."""

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

from backend.shared.utils import friendly_error_message
from backend.modules.models.ml.catalog import ALGORITHM_CATALOG, _sanitize_model_params
from backend.modules.models.ml.artifacts import (
    _apply_numeric_preprocessing_frame,
    _feature_influence_from_model,
    _serialize_estimator,
    _whatif_raw_features,
)
from backend.modules.models.ml.health import _model_health_diagnostics

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
