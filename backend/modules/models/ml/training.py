"""Training, cross-validation, metrics, and estimator construction."""

import numpy as np
import pandas as pd

from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.model_selection import KFold, StratifiedKFold, train_test_split
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
    rs = params.get("random_state", 42)
    if is_classification:
        if algo == "rf":
            return RandomForestClassifier(n_estimators=params["n_estimators"], max_depth=params["max_depth"], min_samples_leaf=params["min_samples_leaf"], random_state=rs, class_weight=class_weight)
        if algo == "tree":
            return DecisionTreeClassifier(max_depth=params["max_depth"], min_samples_leaf=params["min_samples_leaf"], random_state=rs, class_weight=class_weight)
        if algo == "logistic":
            return LogisticRegression(C=params["C"], max_iter=params["max_iter"], random_state=rs, class_weight=class_weight)
        raise ValueError(f"algorithm '{algo}' not supported for classification")
    if algo == "rf":
        return RandomForestRegressor(n_estimators=params["n_estimators"], max_depth=params["max_depth"], min_samples_leaf=params["min_samples_leaf"], random_state=rs)
    if algo == "tree":
        return DecisionTreeRegressor(max_depth=params["max_depth"], min_samples_leaf=params["min_samples_leaf"], random_state=rs)
    if algo == "linear":
        return LinearRegression(fit_intercept=params["fit_intercept"])
    raise ValueError(f"algorithm '{algo}' not supported for regression")


def _cross_validation_metrics(algo, X_raw, y, is_classification, params, plan, scaler_kind="none"):
    """Compute k-fold CV with every learned preprocessing step fitted per fold."""
    validation_method = (plan.get("validation_method") or (plan.get("split") or {}).get("validation_method") or "standard_split")
    if validation_method != "cross_validation":
        return None
    try:
        n_rows = len(X_raw)
        if n_rows < 10:
            return {"enabled": True, "available": False, "reason": "At least 10 complete rows are needed for cross-validation."}

        if is_classification:
            counts = pd.Series(y).value_counts()
            if len(counts) < 2:
                return {"enabled": True, "available": False, "reason": "At least two classes are needed for cross-validation."}
            folds = int(min(int(plan.get("cv_folds") or 5), counts.min(), n_rows))
            if folds < 2:
                return {"enabled": True, "available": False, "reason": "Each class needs at least two examples for cross-validation."}
            cv_splitter = StratifiedKFold(n_splits=folds, shuffle=True, random_state=42)
            label = "accuracy"
        else:
            folds = int(min(int(plan.get("cv_folds") or 5), n_rows))
            if folds < 2:
                return {"enabled": True, "available": False, "reason": "At least two complete rows are needed for cross-validation."}
            cv_splitter = KFold(n_splits=folds, shuffle=True, random_state=42)
            label = "r2"

        from backend.modules.models.ml.preprocessing import _apply_categorical_encoding

        X_df = X_raw if isinstance(X_raw, pd.DataFrame) else pd.DataFrame(X_raw)
        y_arr = np.asarray(y)
        numeric_config = plan.get("numeric_preprocessing") or {}
        encoding_plan = plan.get("encoding") or []
        outlier_treatment = (numeric_config.get("outlier_treatment") or "none").lower()
        use_smote = is_classification and bool(plan.get("smote"))
        fold_scores = []

        for train_idx, val_idx in cv_splitter.split(X_df, y_arr):
            X_tr_raw = X_df.iloc[train_idx].copy()
            X_va_raw = X_df.iloc[val_idx].copy()
            y_tr = pd.Series(y_arr[train_idx]).reset_index(drop=True)
            y_va = y_arr[val_idx]

            X_tr, numeric_applied = _apply_numeric_preprocessing_frame(X_tr_raw, numeric_config)
            shifts = {
                item["column"]: item["shift"]
                for item in numeric_applied
                if item.get("transform") == "log1p" and item.get("shift") is not None
            }
            X_va, _ = _apply_numeric_preprocessing_frame(X_va_raw, numeric_config, shifts)

            X_tr, categorical_mappings = _apply_categorical_encoding(X_tr, encoding_plan)
            X_va, _ = _apply_categorical_encoding(X_va, encoding_plan, categorical_mappings)
            X_tr = pd.get_dummies(X_tr, drop_first=True, prefix_sep="=").astype(float)
            X_va = pd.get_dummies(X_va, drop_first=False, prefix_sep="=")
            X_va = X_va.reindex(columns=X_tr.columns, fill_value=0).astype(float)

            numeric_cols = [c for c in X_tr.columns if "=" not in str(c)]
            keep_mask = pd.Series(True, index=X_tr.index)
            for col in numeric_cols:
                if outlier_treatment in ("iqr", "remove"):
                    q1, q3 = float(X_tr[col].quantile(0.25)), float(X_tr[col].quantile(0.75))
                    iqr = q3 - q1
                    lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
                elif outlier_treatment == "zscore":
                    mu = float(X_tr[col].mean())
                    sigma = float(X_tr[col].std()) or 1.0
                    lo, hi = mu - 3 * sigma, mu + 3 * sigma
                else:
                    continue
                if outlier_treatment == "remove":
                    keep_mask &= X_tr[col].between(lo, hi)
                else:
                    X_tr[col] = X_tr[col].clip(lower=lo, upper=hi)
                    X_va[col] = X_va[col].clip(lower=lo, upper=hi)

            if outlier_treatment == "remove":
                keep_values = keep_mask.to_numpy()
                X_tr = X_tr.loc[keep_mask].reset_index(drop=True)
                y_tr = y_tr.loc[keep_values].reset_index(drop=True)
            else:
                X_tr = X_tr.reset_index(drop=True)

            if scaler_kind not in ("none", None):
                fold_scaler = MinMaxScaler() if scaler_kind == "minmax" else StandardScaler()
                X_tr = pd.DataFrame(fold_scaler.fit_transform(X_tr), columns=X_tr.columns)
                X_va = pd.DataFrame(fold_scaler.transform(X_va), columns=X_va.columns)

            if use_smote:
                X_tr, y_tr = _apply_smote(X_tr, y_tr, random_state=42)

            estimator = _build_model_estimator(
                algo,
                is_classification,
                params,
                plan.get("class_weight") if is_classification else None,
            )
            estimator.fit(X_tr, y_tr)
            y_pred = estimator.predict(X_va)
            score = accuracy_score(y_va, y_pred) if is_classification else r2_score(y_va, y_pred)
            fold_scores.append(float(score))

        scores = np.asarray(fold_scores, dtype=float)
        return {
            "enabled": True,
            "available": True,
            "method": f"{folds}-fold cross-validation",
            "metric": label,
            "mean": float(np.mean(scores)),
            "std": float(np.std(scores)),
            "fold_scores": [float(score) for score in scores.tolist()],
        }
    except Exception as exc:
        return {"enabled": True, "available": False, "reason": friendly_error_message(exc, "Cross-validation could not be computed for this setup.")}


def _apply_smote(X, y, k_neighbors=5, random_state=42):
    """Applies Synthetic Minority Over-sampling Technique (SMOTE) to balance classes."""
    import numpy as np
    import pandas as pd
    from scipy.spatial.distance import cdist

    np_rand = np.random.RandomState(random_state)
    X_clean = X.reset_index(drop=True)
    y_clean = pd.Series(y).reset_index(drop=True)
    
    class_counts = y_clean.value_counts()
    if len(class_counts) <= 1:
        return X, y
        
    majority_class = class_counts.idxmax()
    majority_count = class_counts.max()
    
    X_new = X_clean.copy()
    y_new = y_clean.copy()
    
    for cls, count in class_counts.items():
        if cls == majority_class:
            continue
        
        needed = majority_count - count
        if needed <= 0:
            continue
            
        cls_indices = y_clean[y_clean == cls].index
        X_cls = X_clean.loc[cls_indices].values
        
        n_samples = len(X_cls)
        if n_samples < 2:
            extra_indices = np_rand.choice(cls_indices, size=needed, replace=True)
            X_extra = X_clean.loc[extra_indices].copy()
            y_extra = pd.Series([cls] * needed)
            X_new = pd.concat([X_new, X_extra], axis=0, ignore_index=True)
            y_new = pd.concat([y_new, y_extra], axis=0, ignore_index=True)
            continue
            
        k = min(k_neighbors, n_samples - 1)
        dists = cdist(X_cls, X_cls, metric='euclidean')
        
        neighbors_idx = np.argsort(dists, axis=1)[:, 1:k+1]
        
        synthetic_samples = []
        for _ in range(needed):
            idx = np_rand.randint(0, n_samples)
            neighbor_list_idx = np_rand.randint(0, k)
            neighbor_idx = neighbors_idx[idx, neighbor_list_idx]
            
            diff = X_cls[neighbor_idx] - X_cls[idx]
            step = np_rand.rand()
            synth = X_cls[idx] + step * diff
            synthetic_samples.append(synth)
            
        X_synth = pd.DataFrame(synthetic_samples, columns=X_clean.columns)
        y_synth = pd.Series([cls] * needed)
        
        X_new = pd.concat([X_new, X_synth], axis=0, ignore_index=True)
        y_new = pd.concat([y_new, y_synth], axis=0, ignore_index=True)
        
    shuffled_indices = np_rand.permutation(len(X_new))
    X_final = X_new.iloc[shuffled_indices].reset_index(drop=True)
    y_final = y_new.iloc[shuffled_indices].reset_index(drop=True)
    
    return X_final, y_final


def _train_one(df, target, features, algo, test_size, plan, model_params=None):
    """Train a single model. Returns a dict with metrics + importance.

    The transparent preprocessing plan is reused so every algorithm in a
    multi-train run sees an identical pipeline.
    """
    data = df[features + [target]].dropna()
    complete_case_indices = data.index.tolist()   # original df row positions kept after dropna
    params = _sanitize_model_params(algo, model_params)
    X_raw = data[features].copy()
    y = data[target]

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

    numeric_preprocessing = plan.get("numeric_preprocessing") or {}
    scaling_method = (numeric_preprocessing.get("scaling") or "auto").lower()
    needs_scaling = ALGORITHM_CATALOG.get(algo, {}).get("needs_scaling", False)

    if scaling_method == "standard":
        scaler_kind = "standard"
    elif scaling_method == "minmax":
        scaler_kind = "minmax"
    elif scaling_method == "none":
        scaler_kind = "none"
    else:  # auto
        scaler_kind = "standard" if needs_scaling else "none"

    stratify = None
    if is_classification and plan.get("split", {}).get("stratified"):
        counts = pd.Series(y).value_counts()
        if len(counts) > 1 and int(counts.min()) >= 2:
            stratify = y

    X_train_raw, X_test_raw, y_train, y_test = train_test_split(
        X_raw, y, test_size=test_size, random_state=42, stratify=stratify
    )
    split_train_indices = X_train_raw.index.tolist()

    X_train, numeric_applied = _apply_numeric_preprocessing_frame(X_train_raw, numeric_preprocessing)
    training_shifts = {
        item["column"]: item["shift"]
        for item in numeric_applied
        if item.get("transform") == "log1p" and item.get("shift") is not None
    }
    X_test, _ = _apply_numeric_preprocessing_frame(X_test_raw, numeric_preprocessing, training_shifts)

    from backend.modules.models.ml.preprocessing import _apply_categorical_encoding
    encoding_plan = plan.get("encoding") or []
    X_train, categorical_mappings = _apply_categorical_encoding(X_train, encoding_plan)
    X_test, _ = _apply_categorical_encoding(X_test, encoding_plan, categorical_mappings)
    X_train = pd.get_dummies(X_train, drop_first=True, prefix_sep="=").astype(float)
    X_test = pd.get_dummies(X_test, drop_first=False, prefix_sep="=")
    X_test = X_test.reindex(columns=X_train.columns, fill_value=0).astype(float)
    model_columns = X_train.columns.tolist()

    # ── Outlier treatment fitted on training data only (prevents leakage) ──
    outlier_treatment = (numeric_preprocessing.get("outlier_treatment") or "none").lower()
    outlier_bounds = {}
    if outlier_treatment != "none":
        # Only treat original numeric columns; skip one-hot dummies (they contain "=")
        orig_num_cols = [c for c in X_train.columns if "=" not in c]
        if outlier_treatment == "remove":
            # Drop training rows outside IQR bounds; leave test set intact
            keep_mask = pd.Series(True, index=X_train.index)
            for col in orig_num_cols:
                q1, q3 = float(X_train[col].quantile(0.25)), float(X_train[col].quantile(0.75))
                iqr = q3 - q1
                lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
                outlier_bounds[col] = {"lo": lo, "hi": hi}
                keep_mask &= X_train[col].between(lo, hi)
            X_train = X_train[keep_mask]
            y_train = y_train[keep_mask] if hasattr(y_train, '__getitem__') else y_train[keep_mask.values]
        else:
            for col in orig_num_cols:
                if outlier_treatment == "iqr":
                    q1, q3 = float(X_train[col].quantile(0.25)), float(X_train[col].quantile(0.75))
                    iqr = q3 - q1
                    lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
                else:  # zscore
                    mu = float(X_train[col].mean())
                    sigma = float(X_train[col].std()) or 1.0
                    lo, hi = mu - 3 * sigma, mu + 3 * sigma
                outlier_bounds[col] = {"lo": lo, "hi": hi}
                X_train[col] = X_train[col].clip(lower=lo, upper=hi)
                X_test[col] = X_test[col].clip(lower=lo, upper=hi)

    train_row_indices = X_train.index.tolist()
    excluded_outlier_indices = sorted(set(split_train_indices) - set(train_row_indices))
    X_train_unscaled = X_train.copy()

    scaler = None
    if scaler_kind != "none":
        scaler = MinMaxScaler() if scaler_kind == "minmax" else StandardScaler()
        X_train = pd.DataFrame(scaler.fit_transform(X_train), columns=model_columns, index=X_train.index)
        X_test = pd.DataFrame(scaler.transform(X_test), columns=model_columns, index=X_test.index)

    if is_classification and plan.get("smote"):
        X_train, y_train = _apply_smote(X_train, y_train, random_state=42)

    split_rows = {
        "train": int(len(train_row_indices)),
        "test": int(len(X_test)),
        "original_train": int(len(train_row_indices)),
        "fitted_train": int(len(X_train)),
        "synthetic_train": int(max(len(X_train) - len(train_row_indices), 0)),
        "excluded_outliers": int(len(excluded_outlier_indices)),
    }

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
            "split_rows": split_rows,
            "train_row_indices": train_row_indices,
            "test_row_indices": X_test.index.tolist(),
            "complete_case_row_indices": complete_case_indices,
            "excluded_outlier_row_indices": excluded_outlier_indices,
            "class_weight": plan.get("class_weight"),
            "model_params": params,
            "validation_method": plan.get("validation_method", "standard_split"),
        }
        metrics["generalization_gap"] = float(metrics["train_accuracy"] - metrics["accuracy"])
        cv = _cross_validation_metrics(algo, X_raw, y, True, params, plan, scaler_kind)
        if cv:
            metrics["cross_validation"] = cv
        metrics["health_diagnostics"] = _model_health_diagnostics(metrics, plan, algo)
        if len(np.unique(y)) == 2 and hasattr(clf, "predict_proba"):
            try:
                y_proba = clf.predict_proba(X_test)[:, 1]
                metrics["auc"] = float(roc_auc_score(y_test, y_proba))
                metrics["y_test"] = y_test.tolist()
                metrics["y_proba"] = y_proba.tolist()
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
            "split_rows": split_rows,
            "train_row_indices": train_row_indices,
            "test_row_indices": X_test.index.tolist(),
            "complete_case_row_indices": complete_case_indices,
            "excluded_outlier_row_indices": excluded_outlier_indices,
            "model_params": params,
            "validation_method": plan.get("validation_method", "standard_split"),
        }
        metrics["generalization_gap"] = float(metrics["train_r2"] - metrics["r2"])
        cv = _cross_validation_metrics(algo, X_raw, y, False, params, plan, scaler_kind)
        if cv:
            metrics["cross_validation"] = cv
        metrics["health_diagnostics"] = _model_health_diagnostics(metrics, plan, algo)

    influence = _feature_influence_from_model(clf, model_columns, features, algo)

    numeric_encoded = X_train_unscaled.apply(pd.to_numeric, errors="coerce").fillna(0).astype(float)
    feature_means = {c: float(scaler.mean_[i]) if scaler is not None and hasattr(scaler, "mean_") else float(numeric_encoded[c].mean())
                     for i, c in enumerate(model_columns)}
    feature_stds = {c: float(scaler.scale_[i]) if scaler is not None and hasattr(scaler, "scale_") else float(numeric_encoded[c].std() or 1)
                    for i, c in enumerate(model_columns)}
    feature_mins = {c: float(scaler.data_min_[i]) if scaler is not None and hasattr(scaler, "data_min_") else float(numeric_encoded[c].min()) for i, c in enumerate(model_columns)}
    feature_ranges = {c: float(scaler.data_range_[i]) if scaler is not None and hasattr(scaler, "data_range_") else float((numeric_encoded[c].max() - numeric_encoded[c].min()) or 1) for i, c in enumerate(model_columns)}
    coefficients = {
        "prediction_kind": "fitted_model",
        "estimator_b64": _serialize_estimator(clf),
        "algorithm": algo,
        "features": model_columns,
        "encoded_features": model_columns,
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
        "raw_features": _whatif_raw_features(X_train_raw),
        "dummy_sep": "=",
        "scaled": scaler is not None,
        "scaler_kind": scaler_kind if scaler is not None else None,
        "numeric_preprocessing": plan.get("numeric_preprocessing"),
        "numeric_transforms_applied": numeric_applied,
        "outlier_bounds": outlier_bounds,
        "model_behavior": "stepwise" if algo in ("tree", "rf") else "smooth",
        "categorical_mappings": categorical_mappings,
        "preprocessing_pipeline": {
            "encoding": plan.get("encoding"),
            "scaling": plan.get("scaling"),
            "numeric_preprocessing": plan.get("numeric_preprocessing"),
            "features": features,
            "encoded_features": model_columns,
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
        "encoded_features": model_columns,
        "model_params": params,
    }
