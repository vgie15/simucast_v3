"""Preprocessing-plan builder for model setup and readiness checks."""

import re
from difflib import SequenceMatcher

import pandas as pd

from backend.shared.utils import _parse_num, clean_json
from backend.modules.models.ml.catalog import (
    ALGORITHM_CATALOG,
    AVAILABLE_ALGOS_BY_TASK,
    _algo_label_for_task,
    _detect_task,
    _is_identifier_feature,
    _model_default_params,
)

_CATEGORY_ABBREVIATIONS = {
    "post graduate": "postgrad",
    "post-graduate": "postgrad",
    "postgraduate": "postgrad",
    "coll": "college",
    "uni": "university",
    "lo": "low",
    "hi": "high",
    "mid": "middle",
    "med": "middle",
    "y": "yes",
    "n": "no",
}

_YES_VALUES = {"1", "1.0", "yes", "y", "true", "t", "graduated", "passed", "pass"}
_NO_VALUES = {"0", "0.0", "no", "n", "false", "f"}

ORDERED_GROUPS = [
    ["strongly disagree", "disagree", "neutral", "agree", "strongly agree"],
    ["disagree", "neutral", "agree"],
    ["strongly disagree", "disagree", "agree", "strongly agree"],
    ["disagree", "agree"],
    ["low", "medium", "high"],
    ["low", "middle", "high"],
    ["low", "mid", "high"],
    ["poor", "fair", "good", "excellent"],
    ["poor", "good", "excellent"],
    ["no college", "college", "postgrad"],
    ["no college", "college", "post graduate"],
    ["no college", "grad"],
    ["high school", "college", "university"],
    ["small", "medium", "large"],
    ["none", "low", "medium", "high"],
]

def _normalize_encoding_value(val):
    if val is None or pd.isna(val):
        return ""
    text = str(val).strip().lower()
    # Map common abbreviations
    for old, new in _CATEGORY_ABBREVIATIONS.items():
        text = re.sub(rf"\b{re.escape(old)}\b", new, text)
    return text

def _get_binary_mapping(unique_values):
    norm_to_raw = {_normalize_encoding_value(v): v for v in unique_values}
    norms = list(norm_to_raw.keys())
    
    no_norm = None
    for n in norms:
        if n in _NO_VALUES or n in {"no", "false", "n", "0", "not"}:
            no_norm = n
            break
            
    if no_norm is not None:
        other_norms = [n for n in norms if n != no_norm]
        if other_norms:
            sorted_norms = [no_norm, other_norms[0]]
        else:
            sorted_norms = sorted(norms)
    else:
        sorted_norms = sorted(norms)
        
    mapping = {}
    for rank, norm in enumerate(sorted_norms):
        raw_val = norm_to_raw[norm]
        mapping[raw_val] = rank
    return mapping

def _get_ordinal_mapping(unique_values):
    norm_to_raw = {_normalize_encoding_value(v): v for v in unique_values}
    norms = list(norm_to_raw.keys())
    
    best_group = None
    for group in ORDERED_GROUPS:
        if all(n in group for n in norms):
            best_group = group
            break
            
    if best_group:
        sorted_norms = sorted(norms, key=lambda n: best_group.index(n))
    else:
        sorted_norms = sorted(norms)
        
    mapping = {}
    for rank, norm in enumerate(sorted_norms):
        raw_val = norm_to_raw[norm]
        mapping[raw_val] = rank
    return mapping

def _get_ordered_mapping(unique_values, preferred_order):
    norm_to_raw = {_normalize_encoding_value(v): v for v in unique_values}
    preferred_norms = [_normalize_encoding_value(v) for v in preferred_order or []]
    sorted_norms = []
    for norm in preferred_norms:
        if norm in norm_to_raw and norm not in sorted_norms:
            sorted_norms.append(norm)
    sorted_norms.extend(sorted(n for n in norm_to_raw.keys() if n not in sorted_norms))

    mapping = {}
    for rank, norm in enumerate(sorted_norms):
        raw_val = norm_to_raw[norm]
        mapping[raw_val] = rank
    return mapping

def _detect_encoding_suggestion(series):
    unique_vals = [str(x) for x in series.dropna().unique()]
    if len(unique_vals) <= 1:
        return "one_hot"
    if len(unique_vals) == 2:
        return "binary"
        
    norms = [_normalize_encoding_value(v) for v in unique_vals]
    for group in ORDERED_GROUPS:
        if all(n in group for n in norms):
            return "ordinal"
            
    return "one_hot"

def _apply_categorical_encoding(df, plan_encoding, categorical_mappings=None):
    df_out = df.copy()
    mappings_to_save = {}
    
    for item in plan_encoding:
        col = item["column"]
        method = item["method"]
        
        if col not in df_out.columns:
            continue
            
        if method == "one_hot":
            continue
            
        series_str = df_out[col].astype(str)
        unique_vals = [str(x) for x in df_out[col].dropna().unique()]
        
        if categorical_mappings and col in categorical_mappings:
            mapping = categorical_mappings[col]
        else:
            preferred_order = item.get("order") or []
            if preferred_order:
                mapping = _get_ordered_mapping(unique_vals, preferred_order)
            elif method == "binary":
                mapping = _get_binary_mapping(unique_vals)
            else:
                mapping = _get_ordinal_mapping(unique_vals)
            mappings_to_save[col] = mapping
            
        df_out[col] = series_str.map(lambda val: mapping.get(str(val), 0)).astype(float)
        
    return df_out, mappings_to_save


def _build_preprocessing_plan(df, target, features, algorithms, target_options=None):
    """Inspect the data and produce a transparent preprocessing plan.

    Returned shape is also stored on each trained model so the user can see
    after the fact exactly what was done.
    """
    target_options = target_options or {}
    features, excluded_features = _validate_model_inputs(df, target, features)
    sub, sub_clean, rows_before, rows_after, dropped = _complete_modeling_frame(df, target, features)

    y = sub_clean[target]
    task = "classification" if _detect_task(y) else "regression"
    algorithms = _valid_algorithms_for_task(algorithms, task)
    available_algorithms = AVAILABLE_ALGOS_BY_TASK.get(task, [])
    validation_config = _validation_config(target_options, task)
    target_info = _target_info(y, task, target_options)

    encoding = _encoding_plan(sub_clean, features, target_options)
    numeric_plan = _numeric_preprocessing_plan(sub_clean, features, algorithms, target_options)
    missing_report = _missing_report(sub, features, target)

    class_context = _class_balance_context(
        y=y,
        target=target,
        task=task,
        target_mode=target_info["target_mode"],
        positive_class=target_info["positive_class"],
    )
    multicollinearity = _multicollinearity_pairs(sub_clean, features)
    warnings = _basic_warnings(
        df=df,
        sub_clean=sub_clean,
        y=y,
        target=target,
        features=features,
        task=task,
        rows_before=rows_before,
        rows_after=rows_after,
        excluded_features=excluded_features,
        class_context=class_context,
        multicollinearity=multicollinearity,
    )
    validation_checks = _validation_checks(
        target=target,
        task=task,
        algorithms=algorithms,
        available_algorithms=available_algorithms,
        missing_report=missing_report,
        hard_blocks=class_context["hard_blocks"],
        n_per_class=class_context["n_per_class"],
        multicollinearity=multicollinearity,
        target_mode=target_info["target_mode"],
        positive_class=target_info["positive_class"],
        test_size=validation_config["test_size"],
        stratify_split=validation_config["stratify_split"],
        validation_method=validation_config["validation_method"],
        cv_folds=validation_config["cv_folds"],
    )

    return {
        "task": task,
        "target": target,
        "features": features,
        "excluded_features": excluded_features,
        "rows_used": rows_after,
        "rows_dropped": dropped,
        "encoding": encoding,
        "scaling": numeric_plan["scaling"],
        "numeric_preprocessing": numeric_plan["numeric_preprocessing"],
        "missing_report": missing_report,
        "class_balance": {str(k): int(v) for k, v in (class_context["n_per_class"] or {}).items()} if task == "classification" else None,
        "target_classes": target_info["target_classes"],
        "target_mode": target_info["target_mode"] if task == "classification" else None,
        "positive_class": target_info["positive_class"] if task == "classification" else None,
        "target_context": target_info["target_context"],
        "split": {
            "train_size": 1 - validation_config["test_size"],
            "test_size": validation_config["test_size"],
            "stratified": bool(task == "classification" and validation_config["stratify_split"]),
            "validation_method": validation_config["validation_method"],
            "cv_folds": validation_config["cv_folds"] if validation_config["validation_method"] == "cross_validation" else None,
        },
        "validation_method": validation_config["validation_method"],
        "cv_folds": validation_config["cv_folds"] if validation_config["validation_method"] == "cross_validation" else None,
        "class_weight": validation_config["class_weight"] if task == "classification" else None,
        "model_params": {a: _model_default_params(a) for a in algorithms or [] if a in ALGORITHM_CATALOG},
        "multicollinearity": multicollinearity,
        "available_algorithms": available_algorithms,
        "validation_checks": validation_checks,
        "hard_blocks": class_context["hard_blocks"],
        "warnings": warnings,
    }


def _validate_model_inputs(df, target, features):
    if target not in df.columns:
        raise ValueError(f"target '{target}' not in dataset")

    features = [f for f in features if f in df.columns and f != target]
    if not features:
        raise ValueError("pick at least one feature")

    excluded_features = []
    kept_features = []
    for feature in features:
        reason = _is_identifier_feature(df[feature], len(df))
        if reason:
            excluded_features.append({"feature": feature, "reason": reason})
        else:
            kept_features.append(feature)

    if not kept_features:
        raise ValueError("all selected features were identifiers or constant columns")
    return kept_features, excluded_features


def _complete_modeling_frame(df, target, features):
    sub = df[features + [target]]
    rows_before = len(sub)
    sub_clean = sub.dropna()
    rows_after = len(sub_clean)
    return sub, sub_clean, rows_before, rows_after, rows_before - rows_after


def _valid_algorithms_for_task(algorithms, task):
    return [
        algo for algo in algorithms or []
        if ALGORITHM_CATALOG.get(algo)
        and (ALGORITHM_CATALOG[algo]["task"] == "both" or ALGORITHM_CATALOG[algo]["task"] == task)
    ]


def _validation_config(target_options, task):
    validation_method = target_options.get("validation_method")
    if validation_method not in ("standard_split", "cross_validation"):
        validation_method = "standard_split"
    return {
        "test_size": min(max(_parse_num(target_options.get("test_size"), 0.2, float), 0.05), 0.5),
        "validation_method": validation_method,
        "cv_folds": int(min(max(_parse_num(target_options.get("cv_folds"), 5, int), 3), 10)),
        "stratify_split": bool(target_options.get("stratify", True)),
        "class_weight": target_options.get("class_weight") if target_options.get("class_weight") in ("balanced", None) else None,
    }


def _target_info(y, task, target_options):
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

    return {
        "target_classes": target_classes,
        "target_mode": target_mode,
        "positive_class": positive_class,
        "target_context": target_context,
    }


def _encoding_plan(sub_clean, features, target_options=None):
    target_options = target_options or {}
    categorical_encoding = target_options.get("categorical_encoding") or {}
    categorical_order = target_options.get("categorical_order") or {}
    
    encoding = []
    for column in features:
        col = sub_clean[column]
        if pd.api.types.is_numeric_dtype(col):
            continue
        categories = col.astype(str).unique().tolist()
        
        # Check overrides
        method = categorical_encoding.get(column)
        if not method or method not in ("one_hot", "binary", "ordinal"):
            method = _detect_encoding_suggestion(col)
            
        encoding.append({
            "column": column,
            "method": method,
            "n_categories": len(categories),
            "sample_categories": categories[:6],
            "order": categorical_order.get(column) or [],
        })
    return encoding



def _numeric_preprocessing_plan(sub_clean, features, algorithms, target_options):
    numeric_features = [c for c in features if pd.api.types.is_numeric_dtype(sub_clean[c])]
    numeric_options = target_options.get("numeric_preprocessing") or {}
    scaling_method = (numeric_options.get("scaling") or "auto").lower()
    if scaling_method not in ("auto", "none", "standard", "minmax"):
        scaling_method = "auto"

    needs_scaling = any(ALGORITHM_CATALOG.get(a, {}).get("needs_scaling") for a in algorithms or [])
    effective_scaling = "standard" if scaling_method == "auto" and needs_scaling else scaling_method
    if scaling_method == "auto" and not needs_scaling:
        effective_scaling = "none"

    scaling = _scaling_plan(algorithms, numeric_features, scaling_method, effective_scaling)
    log_columns = [c for c in numeric_options.get("log_columns") or [] if c in numeric_features]
    integer_columns = [c for c in numeric_options.get("integer_columns") or [] if c in numeric_features]

    return {
        "scaling": scaling,
        "numeric_preprocessing": {
            "scaling": scaling_method,
            "effective_scaling": effective_scaling,
            "log_columns": log_columns,
            "integer_columns": integer_columns,
            "numeric_features": numeric_features,
            "skewed_columns": _skewed_columns(sub_clean, numeric_features),
        },
    }


def _scaling_plan(algorithms, numeric_features, scaling_method, effective_scaling):
    if not numeric_features or effective_scaling == "none":
        return []
    if effective_scaling == "minmax":
        return [{
            "method": "MinMaxScaler",
            "columns": "numeric/encoded modeling features",
            "applies_to": algorithms or [],
            "selected_by": "user",
        }]
    if effective_scaling == "standard":
        return [{
            "method": "StandardScaler",
            "columns": "numeric/encoded modeling features",
            "applies_to": [
                a for a in algorithms or []
                if scaling_method != "auto" or ALGORITHM_CATALOG.get(a, {}).get("needs_scaling")
            ],
            "selected_by": "user" if scaling_method != "auto" else "auto",
        }]
    return []


def _skewed_columns(sub_clean, numeric_features):
    skewed = []
    for column in numeric_features:
        try:
            skew = float(pd.to_numeric(sub_clean[column], errors="coerce").dropna().skew())
            if abs(skew) >= 1:
                skewed.append({"column": column, "skew": skew})
        except Exception:
            pass
    return skewed


def _missing_report(sub, features, target):
    return [
        {"column": column, "missing": int(sub[column].isna().sum())}
        for column in features + [target]
        if sub[column].isna().sum() > 0
    ]


def _class_balance_context(y, target, task, target_mode, positive_class):
    if task != "classification":
        return {"n_per_class": None, "hard_blocks": [], "target_groups_detected": []}

    hard_blocks = []
    n_per_class = y.value_counts().to_dict()
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

    target_groups_detected = _target_category_groups(y, target, hard_blocks)
    if len([count for count in effective_classes.values() if count > 0]) < 2:
        hard_blocks.append({
            "code": "target_single_effective_class",
            "message": f"Target '{target}' has fewer than two usable classes for the selected setup.",
            "column": target,
            "class_counts": clean_json(effective_classes),
        })

    return {
        "n_per_class": n_per_class,
        "hard_blocks": hard_blocks,
        "target_groups_detected": target_groups_detected,
    }


def _target_category_groups(y, target, hard_blocks):
    if pd.api.types.is_numeric_dtype(y):
        return []

    groups = [
        g for g in _category_groups(y.dropna().astype(str).unique().tolist(), target, threshold=0.88)
        if len(g.get("values", [])) > 1
    ]
    if groups:
        hard_blocks.append({
            "code": "target_categories_dirty",
            "message": f"Target '{target}' has similar category labels. Fix categories first in Data standardization before modeling.",
            "column": target,
            "groups": groups[:5],
        })
    return groups


def _normalize_category_value(value):
    """Lower-case, expand abbreviations, and squash whitespace for fuzzy compare."""
    if value is None or pd.isna(value):
        return None
    text = str(value).strip().lower()
    text = re.sub(r"\s+", " ", text)
    for old, new in _CATEGORY_ABBREVIATIONS.items():
        text = re.sub(rf"\b{re.escape(old)}\b", new, text)
    return re.sub(r"\s+", " ", text).strip()


def _binary_category_groups(values, column_name=""):
    """Detect mixed yes/no encodings without importing the datasets blueprint."""
    yes_values = []
    no_values = []
    unknown = []
    has_numeric_token = False
    has_text_token = False
    for value in values:
        text = str(value).strip()
        norm = _normalize_category_value(value)
        if norm in _YES_VALUES:
            yes_values.append(text)
            has_numeric_token = has_numeric_token or norm in {"1", "1.0"}
            has_text_token = has_text_token or norm not in {"1", "1.0"}
        elif norm in _NO_VALUES:
            no_values.append(text)
            has_numeric_token = has_numeric_token or norm in {"0", "0.0"}
            has_text_token = has_text_token or norm not in {"0", "0.0"}
        else:
            unknown.append(text)

    if not yes_values or not no_values:
        return []
    booleanish_name = bool(re.search(r"(^has_|^is_|^can_|^will_|_flag$|_status$)", str(column_name).lower()))
    mixed_binary = has_numeric_token and has_text_token
    if unknown and not (mixed_binary or booleanish_name):
        return []

    groups = []
    if len(set(yes_values)) > 1 or any(v != "Yes" for v in yes_values):
        groups.append({
            "values": sorted(set(yes_values)),
            "normalized_values": ["yes"],
            "suggested_label": "Yes",
            "reason": "Detected mixed binary values that represent Yes.",
            "kind": "binary",
        })
    if len(set(no_values)) > 1 or any(v != "No" for v in no_values):
        groups.append({
            "values": sorted(set(no_values)),
            "normalized_values": ["no"],
            "suggested_label": "No",
            "reason": "Detected mixed binary values that represent No.",
            "kind": "binary",
        })
    return groups


def _title_category_label(text):
    """Title-case a category label while preserving small connector words."""
    if not text:
        return ""
    small = {"of", "and", "or", "the"}
    return " ".join(part if part in small else part[:1].upper() + part[1:] for part in str(text).split())


def _category_groups(values, column_name="", threshold=0.88):
    """Group near-duplicate category labels via fuzzy ratio + binary detection."""
    binary_groups = _binary_category_groups(values, column_name)
    normalized = {}
    for value in values:
        norm = _normalize_category_value(value)
        if norm:
            normalized.setdefault(norm, set()).add(str(value))

    groups = []
    used = set()
    norms = list(normalized.keys())
    for norm in norms:
        if norm in used:
            continue
        group_norms = [norm]
        used.add(norm)
        for other in norms:
            if other in used:
                continue
            if SequenceMatcher(None, norm, other).ratio() >= threshold:
                group_norms.append(other)
                used.add(other)
        originals = sorted({raw for item in group_norms for raw in normalized[item]})
        # A single clean value such as "MALE" or "FEMALE" should not create a
        # standardization task by itself. The guidance should only surface this
        # card when there are multiple source labels that can actually be merged.
        if len(originals) > 1:
            label_source = min(group_norms, key=len) if len(group_norms) > 1 else group_norms[0]
            groups.append({
                "values": originals,
                "normalized_values": group_norms,
                "suggested_label": _title_category_label(label_source),
                "reason": "Rule-based normalization and fuzzy matching found similar category labels.",
            })

    merged = []
    seen = set()
    for group in binary_groups + groups:
        key = tuple(sorted(group.get("values") or []))
        if key in seen:
            continue
        seen.add(key)
        merged.append(group)
    return merged


def _basic_warnings(df, sub_clean, y, target, features, task, rows_before, rows_after, excluded_features, class_context, multicollinearity):
    warnings = []
    n_per_class = class_context["n_per_class"]

    if task == "classification" and n_per_class:
        _add_class_warnings(warnings, n_per_class)
    if rows_after < 50:
        warnings.append(f"Only {rows_after} complete rows after dropping missing - consider Expand or imputation.")
    if excluded_features:
        warnings.append("Identifier or constant columns were excluded from modeling: " + ", ".join(x["feature"] for x in excluded_features))

    _add_feature_warnings(warnings, df, sub_clean, y, features, rows_before)
    if multicollinearity:
        warnings.append(f"Detected {len(multicollinearity)} highly correlated feature pair(s). Linear-style models may be unstable.")
    return warnings


def _add_class_warnings(warnings, n_per_class):
    smallest = min(n_per_class.values()) if n_per_class else 0
    total = sum(n_per_class.values()) if n_per_class else 0
    largest = max(n_per_class.values()) if n_per_class else 0
    imbalance_ratio = (largest / total) if total else 0

    if smallest < 10:
        warnings.append(f"Smallest class has only {smallest} examples - model quality will be unreliable.")
    if imbalance_ratio >= 0.75 and len(n_per_class) > 1:
        warnings.append(f"Class imbalance detected - largest class is {imbalance_ratio:.0%} of usable rows.")
    if len(n_per_class) > 10:
        warnings.append(f"{len(n_per_class)} distinct target values - high cardinality may hurt accuracy.")


def _add_feature_warnings(warnings, df, sub_clean, y, features, rows_before):
    for column in features:
        nunique = df[column].nunique(dropna=True)
        if nunique <= 1:
            warnings.append(f"'{column}' is constant or nearly empty - it cannot help the model.")
        if nunique == rows_before:
            warnings.append(f"'{column}' appears to be an ID - every row has a unique value, so it'll memorize the target.")
        if pd.api.types.is_numeric_dtype(sub_clean[column]) and pd.api.types.is_numeric_dtype(y):
            try:
                corr = sub_clean[column].corr(y)
                if corr is not None and abs(corr) > 0.99:
                    warnings.append(f"'{column}' is almost perfectly correlated with target ({corr:+.2f}) - possible leakage.")
            except Exception:
                pass


def _multicollinearity_pairs(sub_clean, features):
    numeric_features = [c for c in features if pd.api.types.is_numeric_dtype(sub_clean[c])]
    if len(numeric_features) < 2:
        return []

    pairs = []
    corr = sub_clean[numeric_features].corr(numeric_only=True).abs()
    for i, a in enumerate(numeric_features):
        for b in numeric_features[i + 1:]:
            val = corr.loc[a, b]
            if pd.notna(val) and val >= 0.85:
                pairs.append({
                    "feature_a": a,
                    "feature_b": b,
                    "correlation": float(val),
                    "severity": "high" if val >= 0.95 else "medium",
                })
    return pairs


def _validation_checks(
    target,
    task,
    algorithms,
    available_algorithms,
    missing_report,
    hard_blocks,
    n_per_class,
    multicollinearity,
    target_mode,
    positive_class,
    test_size,
    stratify_split,
    validation_method,
    cv_folds,
):
    return [
        _missing_values_check(missing_report),
        _category_consistency_check(target, hard_blocks),
        _class_balance_check(target, task, n_per_class, hard_blocks, target_mode, positive_class),
        _multicollinearity_check(task, algorithms, available_algorithms, multicollinearity),
        _split_check(task, test_size, stratify_split, validation_method, cv_folds),
    ]


def _missing_values_check(missing_report):
    return {
        "key": "missing_values",
        "label": "Missing values",
        "status": "warning" if missing_report else "ok",
        "detail": f"{len(missing_report)} column(s) have missing values - incomplete rows will be dropped for modeling." if missing_report else "No missing values in selected modeling columns.",
        "type": "data",
        "causes": ["incomplete records", "import errors"] if missing_report else [],
        "fixes": [{
            "label": "Impute or drop missing values",
            "description": "Data -> Manual Transforms - fill or drop rows with missing values",
            "route": "data",
            "section": "manual_transforms",
        }] if missing_report else [],
    }


def _category_consistency_check(target, hard_blocks):
    dirty_block = next((block for block in hard_blocks if block["code"] == "target_categories_dirty"), None)
    return {
        "key": "category_consistency",
        "label": "Category consistency",
        "status": "block" if dirty_block else "ok",
        "detail": f"Target '{target}' has similar category labels that must be merged before training." if dirty_block else "No target category conflicts detected.",
        "type": "data",
        "causes": ["typos", "inconsistent label formatting"] if dirty_block else [],
        "fixes": [{
            "label": "Standardize categories",
            "description": "Data -> Category Standardization - merge similar labels in the target column",
            "route": "data",
            "section": "category_standardization",
        }] if dirty_block else [],
    }


def _class_balance_check(target, task, n_per_class, hard_blocks, target_mode, positive_class):
    if task != "classification" or not n_per_class:
        return {
            "key": "class_balance",
            "label": "Class balance",
            "status": "ok",
            "detail": "Not applicable for regression.",
            "type": "modeling",
            "causes": [],
            "fixes": [],
        }

    binary_block = next((block for block in hard_blocks if block["code"] == "binary_target_single_class"), None)
    effective_block = next((block for block in hard_blocks if block["code"] == "target_single_effective_class"), None)
    if binary_block or effective_block:
        return _class_balance_blocked(target)

    smallest = min(n_per_class.values())
    total = sum(n_per_class.values())
    largest = max(n_per_class.values())
    ratio = largest / total if total else 0
    is_multi = len(n_per_class) > 2

    if smallest < 5:
        label = "example" if smallest == 1 else "examples"
        detail = f"Smallest class has only {smallest} {label}."
        if is_multi:
            detail += " Multiclass target detected; use binary mode if the analysis needs one selected category versus the rest."
        return _class_balance_warning(detail, include_binary=True)
    if ratio >= 0.75:
        return _class_balance_warning(f"Class imbalance detected - largest class is {ratio:.0%} of usable rows.")

    detail = "No severe class imbalance detected."
    if len(n_per_class) > 2 and target_mode == "binary":
        detail = f"Binary mode will reduce {len(n_per_class)} target categories into '{positive_class}' vs all others."
    elif len(n_per_class) > 2:
        detail = "Multiclass target detected. Use binary mode if the analysis needs one selected category versus the rest."
    return {
        "key": "class_balance",
        "label": "Class balance",
        "status": "ok",
        "detail": detail,
        "type": "modeling",
        "causes": [],
        "fixes": [],
    }


def _class_balance_blocked(target):
    return {
        "key": "class_balance",
        "label": "Class balance",
        "status": "block",
        "detail": "Target has only one effective class for the current setup - cannot train.",
        "type": "modeling",
        "causes": ["class count collapsed to one due to binary mode or missing categories"],
        "fixes": [
            {
                "label": "Standardize categories",
                "description": "Data -> Category Standardization - merge similar labels to restore valid classes",
                "route": "data",
                "section": "category_standardization",
            },
            {
                "label": "Change positive class",
                "description": "Models -> Target handling - select a different positive class",
                "route": "models",
                "section": "target_options",
            },
        ],
    }


def _class_balance_warning(detail, include_binary=False):
    fixes = [
        {
            "label": "Standardize categories",
            "description": "Data -> Category Standardization - merge similar labels to consolidate small classes",
            "route": "data",
            "section": "category_standardization",
        },
        {
            "label": "Use balanced class weights",
            "description": "Models -> Imbalance handling - compensate for unequal class sizes",
            "route": "models",
            "section": "class_weight",
        },
    ]
    if include_binary:
        fixes.insert(1, {
            "label": "Use binary mode",
            "description": "Models -> Target handling - treat one class vs. rest",
            "route": "models",
            "section": "target_options",
        })
    return {
        "key": "class_balance",
        "label": "Class balance",
        "status": "warning",
        "detail": detail,
        "type": "modeling",
        "causes": ["messy or split category labels", "real class imbalance", "very small dataset"],
        "fixes": fixes,
    }


def _multicollinearity_check(task, algorithms, available_algorithms, multicollinearity):
    if not multicollinearity:
        return {
            "key": "multicollinearity",
            "label": "Highly overlapping features",
            "status": "ok",
            "detail": "No highly correlated numeric feature pairs detected.",
            "type": "data",
            "causes": [],
            "fixes": [],
            "severity": None,
            "severity_message": None,
            "correlated_pairs": [],
            "selected_algorithms": [_algo_label_for_task(a, task) for a in algorithms],
            "available_algorithms": available_algorithms,
        }

    severity_level, severity_message = _multicollinearity_severity(multicollinearity)
    return {
        "key": "multicollinearity",
        "label": "Highly overlapping features",
        "status": "warning",
        "detail": _multicollinearity_detail(task, algorithms, available_algorithms, multicollinearity),
        "type": "data",
        "causes": [
            "Multiple columns were derived from the same source",
            "Variables capture nearly the same measurement",
        ],
        "fixes": _multicollinearity_fixes(task, algorithms, available_algorithms),
        "severity": severity_level,
        "severity_message": severity_message,
        "correlated_pairs": [
            {
                "feature_a": pair["feature_a"],
                "feature_b": pair["feature_b"],
                "correlation": float(pair.get("correlation", 0.0)),
                "severity": pair.get("severity", "medium"),
            }
            for pair in multicollinearity
        ],
        "selected_algorithms": [_algo_label_for_task(a, task) for a in algorithms],
        "available_algorithms": available_algorithms,
    }


def _multicollinearity_severity(multicollinearity):
    severity_counts = {"low": 0, "medium": 0, "high": 0}
    for pair in multicollinearity:
        severity_counts[pair.get("severity") or "medium"] += 1

    if severity_counts["high"]:
        return "high", "High severity - recommended to address before training."
    if severity_counts["medium"]:
        return "medium", "Medium severity - monitor linear models carefully."
    return "low", "Low severity - usually safe to ignore."


def _multicollinearity_detail(task, algorithms, available_algorithms, multicollinearity):
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

    lines = [f"Detected {len(multicollinearity)} pair(s) of features sharing very similar information."]
    if is_regression:
        lines.append("Linear Regression can become unstable when features overlap this much.")
    else:
        linear_note_names = ", ".join(linear_labels or ([logistic_label] if logistic_label and not linear_labels else []))
        if linear_note_names:
            lines.append(f"Linear classifiers like {linear_note_names} can become harder to interpret when features overlap too much.")
    if tree_selected:
        lines.append(f"Tree-based models such as {', '.join(tree_labels)} are naturally resilient to this overlap.")
    elif tree_option_labels:
        lines.append(f"Tree-based models like {', '.join(tree_option_labels)} are resilient to this overlap.")
    return " ".join(lines)


def _multicollinearity_fixes(task, algorithms, available_algorithms):
    is_regression = task == "regression"
    is_classification = task == "classification"
    available_set = set(available_algorithms)
    tree_options = [a for a in available_set if a in ("rf", "tree")]
    tree_selected = [a for a in algorithms if a in ("rf", "tree")]
    logistic_available = is_classification and "logistic" in available_set
    fixes = [{
        "label": "Remove overlapping features",
        "description": "Recommended - drop one column from each highly correlated pair before training.",
        "route": "data",
        "section": "manual_transforms",
        "category": "recommended",
    }]
    if tree_selected or tree_options:
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
    return fixes


def _split_check(task, test_size, stratify_split, validation_method, cv_folds):
    return {
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
