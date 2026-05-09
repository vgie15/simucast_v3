"""
Data-cleaning routes: AI-style suggestion generation, single-fix apply,
group-fix apply, and category-standardization endpoints.
"""
import uuid

import numpy as np
import pandas as pd
from flask import Blueprint, jsonify, request

from backend.database import db, ActivityLog, Dataset
from backend.utils import clean_json, jdump, jload
from backend.auth_helpers import _dataset_scope
from backend.dataframe_utils import (
    create_stage, df_from_dataset, infer_variables,
)
from backend.blueprints.datasets import _category_groups


bp = Blueprint("cleaning", __name__)


# ===========================================================================
# SECTION: CATEGORY STANDARDIZATION
# Keywords: category, standardize, suggestions, similar, fuzzy
# ===========================================================================
# ANCHOR: Cleaning: Category Standardization Suggestions
@bp.route("/api/datasets/<ds_id>/categories/suggestions", methods=["GET"])
def category_suggestions(ds_id):
    """Find columns whose distinct values look like the same label written different ways."""
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)
        variables = infer_variables(df)
        suggestions = []
        for var in variables:
            if var.get("dtype") not in ("category", "binary"):
                continue
            col = var["name"]
            counts = df[col].dropna().astype(str).value_counts()
            uniques = counts.index.tolist()
            if len(uniques) < 2 or len(uniques) > 120:
                continue
            groups = _category_groups(uniques, col)
            if groups:
                suggestions.append({
                    "column": col,
                    "unique_count": len(uniques),
                    "unique_values": [
                        {"value": str(value), "count": int(count)}
                        for value, count in counts.items()
                    ],
                    "groups": groups,
                })
        return jsonify({"suggestions": suggestions})
    finally:
        s.close()

# ANCHOR: Cleaning: Apply Category Standardization
@bp.route("/api/datasets/<ds_id>/categories/apply", methods=["POST"])
def apply_category_standardization(ds_id):
    """Map old category labels to new ones in a column and persist as a stage."""
    body = request.get_json() or {}
    column = body.get("column")
    mapping = body.get("mapping") or {}
    if not column or not isinstance(mapping, dict) or not mapping:
        return {"error": "column and mapping are required"}, 400
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)
        if column not in df.columns:
            return {"error": "column not found"}, 404
        before_unique = int(df[column].nunique(dropna=True))
        df[column] = df[column].map(lambda value: mapping.get(str(value), value) if not pd.isna(value) else value)
        after_unique = int(df[column].nunique(dropna=True))
        changed = int(sum(1 for old, new in mapping.items() if str(old) != str(new)))
        summary = f"Standardized categories in '{column}' ({before_unique} to {after_unique} unique labels)"
        stage = create_stage(
            s,
            ds,
            df,
            op_type="category_standardization",
            op_params={"column": column, "mapping": mapping},
            summary=summary,
        )
        # create_stage already logs the stage; enrich the same entry with report-ready mapping.
        entry = s.query(ActivityLog).filter_by(ref_type="stage", ref_id=stage.id).first()
        if entry:
            detail = jload(entry.detail) or {}
            detail.update({
                "category": "data_prep",
                "action_type": "category_standardization",
                "step_type": "Data Prep",
                "column": column,
                "mapping": mapping,
                "changed_labels": changed,
                "before_unique": before_unique,
                "after_unique": after_unique,
            })
            entry.detail = jdump(clean_json(detail))
            s.commit()
        return jsonify({"ok": True, "stage_id": stage.id, "summary": summary})
    finally:
        s.close()


# ===========================================================================
# SECTION: DATA CLEANING
# Keywords: clean, fix, suggestion, missing, outlier, duplicate, invalid, AI cleaning
# ===========================================================================
# ANCHOR: Cleaning: AI-Suggested Fixes
@bp.route("/api/datasets/<ds_id>/clean/suggestions", methods=["GET"])
def clean_suggestions(ds_id):
    """AI-style suggestions: missing, outliers, type issues, engineering."""
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds)
        suggestions = []

        # missing values
        for col in df.columns:
            miss = int(df[col].isna().sum())
            if miss > 0:
                is_numeric = pd.api.types.is_numeric_dtype(df[col])
                recommended_action = "impute_mode"
                recommended_reason = "Categorical blanks should use the most common label, not a numeric average."
                skew = None
                outlier_count = 0
                if is_numeric:
                    recommended_action = "impute_mean"
                    recommended_reason = "Numeric blanks can use the mean when the distribution is not strongly skewed."
                    numeric = pd.to_numeric(df[col], errors="coerce").dropna()
                    if len(numeric) > 2:
                        skew = float(numeric.skew())
                    if len(numeric) >= 10:
                        q1, q3 = numeric.quantile([0.25, 0.75])
                        iqr = q3 - q1
                        if iqr:
                            outlier_count = int(((numeric < q1 - 1.5 * iqr) | (numeric > q3 + 1.5 * iqr)).sum())
                    if (skew is not None and abs(skew) >= 1) or outlier_count > 0:
                        recommended_action = "impute_median"
                        recommended_reason = "Median is safer because the column is skewed or has outliers."
                if miss / max(len(df), 1) >= 0.25:
                    recommended_reason += " Missingness is high, so review before applying."
                options = [
                    {
                        "action": "impute_mean",
                        "label": "Fill with mean",
                        "description": "Replace blanks with the column average.",
                    },
                    {
                        "action": "impute_median",
                        "label": "Fill with median",
                        "description": "Replace blanks with the middle value; more robust to outliers.",
                    },
                ] if is_numeric else [
                    {
                        "action": "impute_mode",
                        "label": "Fill with most common",
                        "description": "Replace blanks with the most frequent value.",
                    },
                ]
                options.append({
                    "action": "drop_rows",
                    "label": "Drop missing rows",
                    "description": "Remove rows where this variable is blank.",
                })
                suggestions.append({
                    "id": str(uuid.uuid4()),
                    "kind": "missing",
                    "variable": col,
                    "count": miss,
                    "action": recommended_action,
                    "recommended_action": recommended_action,
                    "recommended_reason": recommended_reason,
                    "skew": skew,
                    "outlier_count": outlier_count,
                    "options": options,
                    "description": f"{miss} rows blank · impute with {'mean' if pd.api.types.is_numeric_dtype(df[col]) else 'mode'} or drop?",
                })

        # outliers (numeric columns, IQR rule)
        for col in df.select_dtypes(include=[np.number]).columns:
            series = df[col].dropna()
            if len(series) < 10:
                continue
            q1, q3 = series.quantile([0.25, 0.75])
            iqr = q3 - q1
            lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            outliers = int(((series < lo) | (series > hi)).sum())
            if outliers > 0:
                suggestions.append({
                    "id": str(uuid.uuid4()),
                    "kind": "outliers",
                    "variable": col,
                    "count": outliers,
                    "action": "winsorize",
                    "recommended_action": "winsorize",
                    "recommended_reason": "Cap to IQR bounds by default so rows stay available while extreme values are limited.",
                    "lower_bound": float(lo),
                    "upper_bound": float(hi),
                    "options": [
                        {
                            "action": "winsorize",
                            "label": "Cap to IQR bounds",
                            "description": "Clamp extreme values to the lower/upper IQR thresholds.",
                        },
                        {
                            "action": "drop_outliers",
                            "label": "Remove outlier rows",
                            "description": "Drop rows outside the lower/upper IQR thresholds.",
                        },
                    ],
                    "description": f"{outliers} rows outside IQR bounds · winsorize?",
                })

        # type issues: strings that look like dates
        for col in df.select_dtypes(include=["object"]).columns:
            try:
                pd.to_datetime(df[col].dropna().head(20), errors="raise")
                suggestions.append({
                    "id": str(uuid.uuid4()),
                    "kind": "type",
                    "variable": col,
                    "action": "convert_date",
                    "options": [
                        {
                            "action": "convert_date",
                            "label": "Convert to date",
                            "description": "Parse text values as dates and mark failures as missing.",
                        },
                    ],
                    "description": f"Stored as text · convert to date?",
                })
            except Exception:
                pass

        groups = {
            "missing": {
                "kind": "missing",
                "title": "Missing values",
                "stage_id": ds.current_stage_id,
                "columns": [x for x in suggestions if x.get("kind") == "missing"],
                "default_action": "impute_mean",
            },
            "outliers": {
                "kind": "outliers",
                "title": "Outliers",
                "stage_id": ds.current_stage_id,
                "columns": [x for x in suggestions if x.get("kind") == "outliers"],
                "default_action": "winsorize",
            },
            "type": {
                "kind": "type",
                "title": "Type issues",
                "stage_id": ds.current_stage_id,
                "columns": [x for x in suggestions if x.get("kind") == "type"],
                "default_action": "convert_date",
            },
        }
        duplicate_count = int(df.duplicated().sum()) if len(df) else 0
        groups["duplicates"] = {
            "kind": "duplicates",
            "title": "Duplicates",
            "stage_id": ds.current_stage_id,
            "count": duplicate_count,
            "columns": list(df.columns),
            "options": [
                {"action": "drop_duplicates", "label": "Remove duplicates, keep first occurrence", "keep": "first"},
                {"action": "drop_duplicates", "label": "Remove duplicates, keep last occurrence", "keep": "last"},
            ],
            "default_action": "drop_duplicates",
            "default_keep": "first",
        }

        return jsonify({"suggestions": clean_json(suggestions), "groups": clean_json(groups)})
    finally:
        s.close()

# ANCHOR: Cleaning: Apply Group of Fixes
@bp.route("/api/datasets/<ds_id>/clean/apply_group", methods=["POST"])
def clean_apply_group(ds_id):
    """Apply a batch of cleaning operations of one kind (missing, outliers, etc.)."""
    body = request.get_json() or {}
    kind = body.get("kind")
    action = body.get("action")
    columns = body.get("columns") or []
    overrides = body.get("overrides") or {}
    options = body.get("options") or {}
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)
        before_rows = len(df)
        before_cols = list(df.columns)
        details = {
            "category": "data_prep",
            "action_type": f"group_{kind}",
            "kind": kind,
            "columns": columns,
            "default_action": action,
            "overrides": overrides,
            "before": {"rows": before_rows, "columns": len(before_cols)},
            "changes": [],
        }

        if kind == "missing":
            selected = [c for c in columns if c in df.columns and int(df[c].isna().sum()) > 0]
            if not selected:
                return {"error": "no selected columns contain missing values"}, 400
            drop_cols = [c for c in selected if (overrides.get(c) or action) == "drop_rows"]
            if drop_cols:
                before_missing = {c: int(df[c].isna().sum()) for c in drop_cols}
                df = df.dropna(subset=drop_cols)
                details["changes"].append({
                    "action": "drop_rows",
                    "columns": drop_cols,
                    "before_missing": before_missing,
                    "rows_removed": int(before_rows - len(df)),
                })
            for col in [c for c in selected if c not in drop_cols]:
                method = overrides.get(col) or action
                missing_before = int(df[col].isna().sum())
                if missing_before <= 0:
                    continue
                if method in ("impute", "impute_mean"):
                    if pd.api.types.is_numeric_dtype(df[col]):
                        fill = df[col].mean()
                        label = "mean"
                    else:
                        mode = df[col].mode()
                        fill = mode[0] if len(mode) else ""
                        label = "mode"
                elif method == "impute_median":
                    if not pd.api.types.is_numeric_dtype(df[col]):
                        mode = df[col].mode()
                        fill = mode[0] if len(mode) else ""
                        label = "mode"
                    else:
                        fill = df[col].median()
                        label = "median"
                elif method in ("mode", "impute_mode"):
                    mode = df[col].mode()
                    fill = mode[0] if len(mode) else ""
                    label = "mode"
                else:
                    return {"error": f"unsupported missing-value method '{method}' for {col}"}, 400
                df[col] = df[col].fillna(fill)
                details["changes"].append({
                    "action": method,
                    "column": col,
                    "before_missing": missing_before,
                    "after_missing": int(df[col].isna().sum()),
                    "fill_value": clean_json(fill),
                    "method": label,
                })
            total_filled = sum(max(0, int(x.get("before_missing", 0)) - int(x.get("after_missing", 0))) for x in details["changes"] if "after_missing" in x)
            removed = before_rows - len(df)
            summary_parts = []
            if total_filled:
                summary_parts.append(f"filled {total_filled} missing value{'s' if total_filled != 1 else ''}")
            if removed:
                summary_parts.append(f"removed {removed} row{'s' if removed != 1 else ''}")
            summary = f"Handled missing values in {len(selected)} column{'s' if len(selected) != 1 else ''}"
            if summary_parts:
                summary += f" ({', '.join(summary_parts)})"
            op_type = "group_missing"

        elif kind == "outliers":
            selected = [c for c in columns if c in df.columns and pd.api.types.is_numeric_dtype(df[c])]
            if not selected:
                return {"error": "select at least one numeric outlier column"}, 400
            keep_mask = pd.Series(True, index=df.index)
            clipped_total = 0
            for col in selected:
                method = overrides.get(col) or action or "winsorize"
                series = df[col].dropna()
                if len(series) < 4:
                    continue
                q1, q3 = series.quantile([0.25, 0.75])
                iqr = q3 - q1
                lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
                outlier_mask = df[col].notna() & ((df[col] < lo) | (df[col] > hi))
                count = int(outlier_mask.sum())
                if method == "winsorize":
                    df[col] = df[col].clip(lower=lo, upper=hi)
                    clipped_total += count
                    details["changes"].append({"action": method, "column": col, "outliers": count, "lower": float(lo), "upper": float(hi)})
                elif method == "drop_outliers":
                    keep_mask &= ~outlier_mask
                    details["changes"].append({"action": method, "column": col, "outliers": count, "lower": float(lo), "upper": float(hi)})
                else:
                    return {"error": f"unsupported outlier method '{method}' for {col}"}, 400
            if any((x.get("action") == "drop_outliers") for x in details["changes"]):
                df = df[keep_mask]
            removed = before_rows - len(df)
            summary = f"Handled outliers in {len(selected)} numeric column{'s' if len(selected) != 1 else ''}"
            if clipped_total or removed:
                summary += f" ({clipped_total} clipped, {removed} rows removed)"
            op_type = "group_outliers"

        elif kind == "duplicates":
            keep = options.get("keep") or body.get("keep") or "first"
            if keep not in ("first", "last"):
                return {"error": "duplicate removal keep option must be first or last"}, 400
            duplicate_count = int(df.duplicated().sum())
            if duplicate_count <= 0:
                return {"error": "no duplicate rows found"}, 400
            df = df.drop_duplicates(keep=keep)
            details["columns"] = list(df.columns)
            details["changes"].append({
                "action": "drop_duplicates",
                "duplicate_rows_before": duplicate_count,
                "rows_removed": int(before_rows - len(df)),
                "keep": keep,
            })
            summary = f"Removed {before_rows - len(df)} duplicate row{'s' if before_rows - len(df) != 1 else ''} (kept {keep} occurrence)"
            op_type = "drop_duplicates"

        elif kind == "type":
            selected = [c for c in columns if c in df.columns]
            if not selected:
                return {"error": "select at least one column to convert"}, 400
            for col in selected:
                method = overrides.get(col) or action or "convert_date"
                if method != "convert_date":
                    return {"error": f"unsupported type method '{method}' for {col}"}, 400
                before_missing = int(df[col].isna().sum())
                df[col] = pd.to_datetime(df[col], errors="coerce").astype(str)
                details["changes"].append({
                    "action": method,
                    "column": col,
                    "before_missing": before_missing,
                    "after_missing": int(df[col].isna().sum()),
                })
            summary = f"Converted {len(selected)} column{'s' if len(selected) != 1 else ''} to date values"
            op_type = "group_type"
        else:
            return {"error": "unknown cleaning group"}, 400

        details["after"] = {"rows": int(len(df)), "columns": int(len(df.columns))}
        validation = {}
        if kind == "missing":
            validation["remaining_missing"] = {c: int(df[c].isna().sum()) for c in columns if c in df.columns}
            validation["missing_resolved"] = all(v == 0 for v in validation["remaining_missing"].values())
        elif kind == "duplicates":
            validation["duplicate_rows_after"] = int(df.duplicated().sum()) if len(df) else 0
            validation["duplicates_resolved"] = validation["duplicate_rows_after"] == 0
        elif kind == "outliers":
            remaining = {}
            for col in columns:
                if col not in df.columns or not pd.api.types.is_numeric_dtype(df[col]):
                    continue
                series = df[col].dropna()
                if len(series) < 4:
                    remaining[col] = 0
                    continue
                q1, q3 = series.quantile([0.25, 0.75])
                iqr = q3 - q1
                lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
                remaining[col] = int((df[col].notna() & ((df[col] < lo) | (df[col] > hi))).sum())
            validation["remaining_outliers"] = remaining
        elif kind == "type":
            validation["inferred_types"] = {v["name"]: v["dtype"] for v in infer_variables(df) if v["name"] in columns}
        details["validation"] = validation
        stage = create_stage(s, ds, df, op_type=op_type, op_params=details, summary=summary)
        return jsonify(clean_json({
            "ok": True,
            "row_count": ds.row_count,
            "col_count": ds.col_count,
            "stage_id": stage.id,
            "summary": summary,
            "details": details,
        }))
    finally:
        s.close()

# ANCHOR: Cleaning: Apply Single Fix
@bp.route("/api/datasets/<ds_id>/clean/apply", methods=["POST"])
def clean_apply(ds_id):
    """Apply a cleaning operation: impute, winsorize, convert, drop.

    Each successful op produces a new DatasetStage so the original data is
    preserved and the user can revert or export any prior stage.
    """
    body = request.get_json() or {}
    action = body.get("action")
    variable = body.get("variable")
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)
        before_rows = len(df)
        summary = ""

        if action in ("impute", "impute_mean") and variable in df.columns:
            missing_before = int(df[variable].isna().sum())
            if pd.api.types.is_numeric_dtype(df[variable]):
                fill = df[variable].mean()
                df[variable] = df[variable].fillna(fill)
                summary = f"Imputed {missing_before} missing values in '{variable}' with mean ({fill:.4g})"
            else:
                mode = df[variable].mode()
                fill = mode[0] if len(mode) else ""
                df[variable] = df[variable].fillna(fill)
                summary = f"Imputed {missing_before} missing values in '{variable}' with mode ({fill!r})"
        elif action == "impute_median" and variable in df.columns:
            if not pd.api.types.is_numeric_dtype(df[variable]):
                return {"error": "median imputation requires a numeric variable"}, 400
            missing_before = int(df[variable].isna().sum())
            fill = df[variable].median()
            df[variable] = df[variable].fillna(fill)
            summary = f"Imputed {missing_before} missing values in '{variable}' with median ({fill:.4g})"
        elif action in ("mode", "impute_mode") and variable in df.columns:
            missing_before = int(df[variable].isna().sum())
            mode = df[variable].mode()
            fill = mode[0] if len(mode) else ""
            df[variable] = df[variable].fillna(fill)
            summary = f"Imputed {missing_before} missing values in '{variable}' with mode ({fill!r})"
        elif action == "winsorize" and variable in df.columns:
            q1, q3 = df[variable].quantile([0.25, 0.75])
            iqr = q3 - q1
            lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            clipped = int(((df[variable] < lo) | (df[variable] > hi)).sum())
            df[variable] = df[variable].clip(lower=lo, upper=hi)
            summary = f"Winsorized '{variable}' to [{lo:.4g}, {hi:.4g}] (clipped {clipped} outlier rows)"
        elif action == "drop_outliers" and variable in df.columns:
            if not pd.api.types.is_numeric_dtype(df[variable]):
                return {"error": "outlier removal requires a numeric variable"}, 400
            q1, q3 = df[variable].quantile([0.25, 0.75])
            iqr = q3 - q1
            lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            keep = df[variable].isna() | ((df[variable] >= lo) & (df[variable] <= hi))
            removed = int((~keep).sum())
            df = df[keep]
            summary = f"Removed {removed} outlier rows in '{variable}' outside [{lo:.4g}, {hi:.4g}]"
        elif action == "convert_date" and variable in df.columns:
            df[variable] = pd.to_datetime(df[variable], errors="coerce").astype(str)
            summary = f"Converted '{variable}' to datetime"
        elif action == "drop_rows" and variable in df.columns:
            df = df.dropna(subset=[variable])
            summary = f"Dropped {before_rows - len(df)} rows with missing '{variable}'"
        elif action == "expand":
            num = body.get("numerator")
            den = body.get("denominator")
            new_name = body.get("new_name") or f"{num}_per_{den}"
            if num in df.columns and den in df.columns:
                df[new_name] = df[num] / df[den].replace(0, np.nan)
                summary = f"Created '{new_name}' = {num} / {den}"
            else:
                return {"error": "expand: missing columns"}, 400
        else:
            return {"error": "unknown action or bad variable"}, 400

        stage = create_stage(s, ds, df, op_type=action, op_params=body, summary=summary)
        return {
            "ok": True,
            "row_count": ds.row_count,
            "col_count": ds.col_count,
            "stage_id": stage.id,
            "summary": summary,
        }
    finally:
        s.close()
