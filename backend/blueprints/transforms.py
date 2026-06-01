"""
Transform / expand / feature-engineer routes.

Three flat operations: schema-level transforms (rename/drop/cast/merge),
row-count expansion (bootstrap or KDE-based synthesis), and the
feature-engineering shortcuts (binning, ratio, log, z-score, etc.).
"""
import numpy as np
import pandas as pd
from flask import Blueprint, jsonify, request

from backend.database import db, Dataset
from backend.utils import clean_json, friendly_error_message
from backend.dataframe_utils import create_stage, df_from_dataset


bp = Blueprint("transforms", __name__)


# ===========================================================================
# SECTION: TRANSFORM & EXPAND - FEATURE ENGINEERING
# Keywords: transform, expand, derived, feature engineering, manual transform
# ===========================================================================
# ANCHOR: Transform: Manual Column Transformation
@bp.route("/api/datasets/<ds_id>/transform", methods=["POST"])
def transform(ds_id):
    """Apply a manual schema transform — merge columns, rename, drop, cast.

    Body: {op, params}. Set ?preview=true to return a sample of the result
    without persisting; otherwise a new stage is created.

    Supported ops:
      - merge_columns: {columns, new_name, separator, drop_originals}
      - rename_column: {column, new_name}
      - drop_columns:  {columns}
      - drop_rows:     {column, predicate=missing|equals|gt|lt|in,
                         value?}
      - cast_column:   {column, to: int|float|datetime|category|text|binary}
      - split_column:  {column, separator, into}
    """
    body = request.get_json() or {}
    op = (body.get("op") or "").strip()
    params = body.get("params") or {}
    preview = request.args.get("preview", "").lower() in ("1", "true", "yes")

    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)

        try:
            df_new, summary = _apply_transform(df, op, params)
        except ValueError as e:
            return {"error": str(e)}, 400

        if preview:
            sample = df_new.head(20)
            sample_records = clean_json(
                sample.where(pd.notnull(sample), None).to_dict(orient="records")
            )
            return jsonify({
                "preview": True,
                "summary": summary,
                "row_count": int(len(df_new)),
                "col_count": int(len(df_new.columns)),
                "columns": list(df_new.columns),
                "sample": sample_records,
            })

        stage = create_stage(s, ds, df_new, op_type=op, op_params=params, summary=summary)
        return jsonify({
            "ok": True,
            "stage_id": stage.id,
            "summary": summary,
            "row_count": ds.row_count,
            "col_count": ds.col_count,
        })
    finally:
        s.close()


def _apply_transform(df, op, params):
    """Pure transform — returns (new_df, summary) or raises ValueError."""
    if op == "merge_columns":
        cols = params.get("columns") or []
        new_name = (params.get("new_name") or "").strip()
        sep = params.get("separator", " ")
        drop_originals = bool(params.get("drop_originals", True))
        if len(cols) < 2:
            raise ValueError("merge_columns: pick at least two columns")
        if not new_name:
            raise ValueError("merge_columns: new_name is required")
        for c in cols:
            if c not in df.columns:
                raise ValueError(f"merge_columns: '{c}' not in columns")
        out = df.copy()
        merged = out[cols].astype(str).agg(sep.join, axis=1)
        # if every source value was NaN/empty, treat the merged value as NaN too
        all_blank = out[cols].isna().all(axis=1)
        merged = merged.where(~all_blank, other=None)
        out[new_name] = merged
        if drop_originals:
            out = out.drop(columns=[c for c in cols if c != new_name])
        summary = (
            f"Merged {len(cols)} columns ({', '.join(cols)}) into '{new_name}' "
            f"with separator {sep!r}" + (" and dropped originals" if drop_originals else "")
        )
        return out, summary

    if op == "rename_column":
        col = params.get("column")
        new_name = (params.get("new_name") or "").strip()
        if col not in df.columns:
            raise ValueError(f"rename_column: '{col}' not in columns")
        if not new_name:
            raise ValueError("rename_column: new_name is required")
        if new_name in df.columns and new_name != col:
            raise ValueError(f"rename_column: '{new_name}' already exists")
        out = df.rename(columns={col: new_name})
        return out, f"Renamed '{col}' → '{new_name}'"

    if op == "drop_columns":
        cols = params.get("columns") or []
        missing = [c for c in cols if c not in df.columns]
        if missing:
            raise ValueError(f"drop_columns: not in dataset: {missing}")
        if not cols:
            raise ValueError("drop_columns: pick at least one column")
        out = df.drop(columns=cols)
        return out, f"Dropped {len(cols)} column{'s' if len(cols) != 1 else ''}: {', '.join(cols)}"

    if op == "drop_rows":
        col = params.get("column")
        pred = (params.get("predicate") or "missing").lower()
        value = params.get("value")
        if col not in df.columns:
            raise ValueError(f"drop_rows: '{col}' not in columns")
        before = len(df)
        if pred == "missing":
            out = df.dropna(subset=[col])
        elif pred == "equals":
            out = df[df[col] != value]
        elif pred == "gt":
            out = df[~(df[col] > _coerce_num(value))]
        elif pred == "lt":
            out = df[~(df[col] < _coerce_num(value))]
        elif pred == "in":
            vals = value if isinstance(value, list) else [value]
            out = df[~df[col].isin(vals)]
        else:
            raise ValueError(f"drop_rows: unknown predicate '{pred}'")
        return out, f"Dropped {before - len(out)} rows where {col} {pred} {value!r}".rstrip("'\"")

    if op == "cast_column":
        col = params.get("column")
        to = (params.get("to") or "").lower()
        if col not in df.columns:
            raise ValueError(f"cast_column: '{col}' not in columns")
        out = df.copy()
        if to in ("numeric", "float"):
            coerced = pd.to_numeric(out[col], errors="coerce")
            errors = int(coerced.isna().sum() - out[col].isna().sum())
            out[col] = coerced.astype(float) if to == "float" else coerced
            label = "float" if to == "float" else "numeric"
            return out, f"Cast '{col}' to {label} ({errors} value{'s' if errors != 1 else ''} became NaN)"
        if to == "int":
            coerced = pd.to_numeric(out[col], errors="coerce")
            errors = int(coerced.isna().sum() - out[col].isna().sum())
            out[col] = coerced.round().astype("Int64")
            return out, f"Cast '{col}' to int ({errors} value{'s' if errors != 1 else ''} became NaN)"
        if to == "binary":
            present = out[col].dropna().astype(str).str.strip().str.lower()
            truthy = {"1", "true", "yes", "y"}
            falsy = {"0", "false", "no", "n"}
            allowed = truthy | falsy
            errors = int((~present.isin(allowed)).sum())
            mapped = out[col].astype(str).str.strip().str.lower().map(
                lambda value: True if value in truthy else (False if value in falsy else None)
            )
            out[col] = mapped.where(out[col].notna(), None)
            return out, f"Cast '{col}' to binary ({errors} value{'s' if errors != 1 else ''} became NaN)"
        if to == "datetime":
            coerced = pd.to_datetime(out[col], errors="coerce")
            errors = int(coerced.isna().sum() - out[col].isna().sum())
            out[col] = coerced.astype(str).where(coerced.notna(), None)
            return out, f"Cast '{col}' to datetime ({errors} value{'s' if errors != 1 else ''} became NaN)"
        if to == "category" or to == "text":
            out[col] = out[col].astype(str).where(out[col].notna(), None)
            return out, f"Cast '{col}' to {to}"
        raise ValueError(f"cast_column: unsupported target '{to}'")

    if op == "split_column":
        col = params.get("column")
        sep = params.get("separator", " ")
        into = params.get("into") or []
        if col not in df.columns:
            raise ValueError(f"split_column: '{col}' not in columns")
        if not into:
            raise ValueError("split_column: 'into' must be a list of new column names")
        parts = df[col].astype(str).str.split(sep, n=len(into) - 1, expand=True)
        out = df.copy()
        for i, name in enumerate(into):
            out[name] = parts[i] if i < parts.shape[1] else None
        return out, f"Split '{col}' by {sep!r} into {len(into)} columns: {', '.join(into)}"

    raise ValueError(f"unknown op '{op}'")


def _coerce_num(v):
    """Best-effort float coercion that returns the input untouched on failure."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return v


# ANCHOR: Expand: Add Derived Features (Feature Engineering)
@bp.route("/api/datasets/<ds_id>/expand", methods=["POST"])
def expand_dataset(ds_id):
    """Grow a small dataset by bootstrap resample or synthetic generation.

    Body: {method: 'bootstrap'|'synthetic', target_rows: int, options: {...}}
    Set ?preview=true to return a 10-row sample + per-numeric-column drift
    stats without persisting. Apply creates a new stage.
    """
    body = request.get_json() or {}
    method = (body.get("method") or "bootstrap").lower()
    target_rows = int(body.get("target_rows") or 0)
    options = body.get("options") or {}
    preview = request.args.get("preview", "").lower() in ("1", "true", "yes")

    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)
        if len(df) == 0:
            return {"error": "dataset is empty"}, 400
        if target_rows <= len(df):
            return {"error": f"target_rows ({target_rows}) must exceed current row count ({len(df)})"}, 400

        try:
            df_new, summary, drift = _expand(df, method, target_rows, options)
        except ValueError as e:
            return {"error": str(e)}, 400

        if preview:
            sample = df_new.tail(10)  # show some of the new rows
            sample_records = clean_json(
                sample.where(pd.notnull(sample), None).to_dict(orient="records")
            )
            return jsonify({
                "preview": True,
                "method": method,
                "summary": summary,
                "row_count": int(len(df_new)),
                "col_count": int(len(df_new.columns)),
                "added_rows": int(len(df_new) - len(df)),
                "columns": list(df_new.columns),
                "sample": sample_records,
                "drift": drift,
            })

        stage = create_stage(s, ds, df_new, op_type=f"expand_{method}",
                             op_params={"method": method, "target_rows": target_rows, "options": options},
                             summary=summary)
        return jsonify({
            "ok": True,
            "stage_id": stage.id,
            "summary": summary,
            "row_count": ds.row_count,
            "col_count": ds.col_count,
        })
    finally:
        s.close()


def _expand(df, method, target_rows, options):
    """Return (new_df, summary, drift_stats)."""
    n_extra = target_rows - len(df)
    seed = int(options.get("seed", 42))
    rng = np.random.default_rng(seed)

    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]

    before_stats = {c: _col_stats(df[c]) for c in numeric_cols}

    if method == "bootstrap":
        noise_pct = float(options.get("noise_pct", 0))  # percent of std dev
        extra = df.sample(n=n_extra, replace=True, random_state=seed).reset_index(drop=True)
        if noise_pct > 0 and numeric_cols:
            for col in numeric_cols:
                std = df[col].std()
                if pd.isna(std) or std == 0:
                    continue
                extra[col] = extra[col] + rng.normal(0, std * (noise_pct / 100), size=len(extra))
        out = pd.concat([df, extra], ignore_index=True)
        noise_note = f" with {noise_pct:g}% Gaussian noise on numeric columns" if noise_pct else ""
        summary = f"Bootstrap-resampled {n_extra} new rows{noise_note} (now {len(out)} total)"
    elif method == "synthetic":
        # per-column independent sampling: numeric via KDE, categorical/text via frequency
        new_data = {c: [] for c in df.columns}
        for col in df.columns:
            series = df[col]
            present = series.dropna()
            if len(present) == 0:
                new_data[col] = [None] * n_extra
                continue
            if pd.api.types.is_numeric_dtype(series) and len(present) >= 2 and present.nunique() >= 3:
                try:
                    from scipy.stats import gaussian_kde
                    kde = gaussian_kde(present.astype(float).values)
                    sampled = kde.resample(n_extra, seed=seed)[0]
                    # round to int if original was integer-like
                    if pd.api.types.is_integer_dtype(series.dropna()) or all(float(v).is_integer() for v in present.head(20)):
                        sampled = np.round(sampled).astype(int)
                    new_data[col] = sampled.tolist()
                except Exception:
                    new_data[col] = rng.choice(present.values, size=n_extra, replace=True).tolist()
            else:
                # categorical / text — sample from observed frequencies
                vc = present.value_counts(normalize=True)
                new_data[col] = rng.choice(vc.index.values, size=n_extra, replace=True, p=vc.values).tolist()
        extra = pd.DataFrame(new_data)
        out = pd.concat([df, extra], ignore_index=True)
        summary = (
            f"Synthesized {n_extra} new rows by per-column sampling "
            f"(numeric: KDE; categorical: observed frequencies). Cross-column correlations "
            f"are NOT preserved — use bootstrap if you need the joint distribution."
        )
    else:
        raise ValueError(f"unknown expand method '{method}'")

    after_stats = {c: _col_stats(out[c]) for c in numeric_cols}
    drift = []
    for c in numeric_cols:
        b, a = before_stats[c], after_stats[c]
        drift.append({
            "column": c,
            "before_mean": b["mean"], "after_mean": a["mean"],
            "before_std": b["std"], "after_std": a["std"],
            "mean_pct_change": _pct_change(b["mean"], a["mean"]),
            "std_pct_change": _pct_change(b["std"], a["std"]),
        })

    return out, summary, drift


def _col_stats(series):
    """Mean/std summary used for before/after expansion drift comparisons."""
    s = series.dropna()
    if len(s) == 0:
        return {"mean": None, "std": None}
    try:
        return {"mean": float(s.mean()), "std": float(s.std()) if len(s) > 1 else 0.0}
    except Exception:
        return {"mean": None, "std": None}


def _pct_change(a, b):
    """Percent change from a to b, or None when undefined (a is 0 / missing)."""
    if a is None or b is None:
        return None
    if abs(a) < 1e-4:
        return None
    return round((b - a) / abs(a) * 100, 2)


# ANCHOR: Expand: AI Feature Engineering Suggestions
@bp.route("/api/datasets/<ds_id>/feature_engineer", methods=["POST"])
def feature_engineer(ds_id):
    """Apply a feature engineering operation to the active dataset."""
    body = request.get_json() or {}
    operation = body.get("operation")
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)

        if operation == "bin":
            col = body.get("column")
            bins = int(body.get("bins", 3))
            labels = body.get("labels") or None
            new_name = body.get("new_name") or f"{col}_bin"
            if col not in df.columns:
                return {"error": f"Column '{col}' not found"}, 400
            if labels and len(labels) != bins:
                labels = None
            df[new_name] = pd.cut(df[col], bins=bins, labels=labels)
            summary = f"Created '{new_name}' by binning '{col}' into {bins} bins."

        elif operation == "average":
            cols = body.get("columns", [])
            new_name = body.get("new_name") or ("_".join(cols[:3]) + "_avg")
            missing = [c for c in cols if c not in df.columns]
            if missing:
                return {"error": f"Columns not found: {missing}"}, 400
            df[new_name] = df[cols].mean(axis=1)
            summary = f"Created '{new_name}' as the row-wise average of {cols}."

        elif operation == "ratio":
            num = body.get("numerator")
            den = body.get("denominator")
            new_name = body.get("new_name") or f"{num}_per_{den}"
            if num not in df.columns or den not in df.columns:
                return {"error": "Numerator or denominator column not found"}, 400
            df[new_name] = df[num] / df[den].replace(0, float("nan"))
            summary = f"Created '{new_name}' as {num} / {den}."

        elif operation == "round":
            col = body.get("column")
            decimals = int(body.get("param", 2))
            new_name = body.get("new_name") or col
            if col not in df.columns:
                return {"error": f"Column '{col}' not found"}, 400
            df[new_name] = df[col].round(decimals)
            summary = f"Rounded '{col}' to {decimals} decimal places → '{new_name}'."

        elif operation == "abs":
            col = body.get("column")
            new_name = body.get("new_name") or col
            if col not in df.columns:
                return {"error": f"Column '{col}' not found"}, 400
            df[new_name] = df[col].abs()
            summary = f"Applied absolute value to '{col}' → '{new_name}'."

        elif operation == "log1p":
            col = body.get("column")
            new_name = body.get("new_name") or f"{col}_log"
            if col not in df.columns:
                return {"error": f"Column '{col}' not found"}, 400
            import numpy as np
            df[new_name] = np.log1p(df[col].clip(lower=0))
            summary = f"Applied log1p transform to '{col}' → '{new_name}'."

        elif operation == "zscore":
            col = body.get("column")
            new_name = body.get("new_name") or f"{col}_z"
            if col not in df.columns:
                return {"error": f"Column '{col}' not found"}, 400
            mu, sigma = df[col].mean(), df[col].std()
            df[new_name] = (df[col] - mu) / (sigma if sigma > 0 else 1)
            summary = f"Z-scored '{col}' (mean={mu:.2f}, sd={sigma:.2f}) → '{new_name}'."

        elif operation == "minmax":
            col = body.get("column")
            new_name = body.get("new_name") or f"{col}_scaled"
            if col not in df.columns:
                return {"error": f"Column '{col}' not found"}, 400
            mn, mx = df[col].min(), df[col].max()
            df[new_name] = (df[col] - mn) / ((mx - mn) if mx != mn else 1)
            summary = f"Min-max scaled '{col}' → '{new_name}'."

        elif operation == "encode":
            col = body.get("column")
            method = body.get("method") or "one_hot"
            prefix = body.get("prefix") or col
            if col not in df.columns:
                return {"error": f"Column '{col}' not found"}, 400
            values = [v for v in df[col].dropna().unique().tolist()]
            if not values:
                return {"error": f"Column '{col}' has no values to encode"}, 400
            if len(values) > 30:
                return {"error": "Encoding is limited to columns with 30 or fewer unique values."}, 400
            if method == "ordinal":
                mapping = {value: idx for idx, value in enumerate(sorted(values, key=lambda v: str(v)))}
                new_name = body.get("new_name") or f"{prefix}_encoded"
                df[new_name] = df[col].map(mapping)
                summary = f"Ordinal encoded '{col}' into '{new_name}'."
            elif method == "one_hot":
                created = []
                for value in sorted(values, key=lambda v: str(v)):
                    safe = str(value).strip().replace(" ", "_").replace("/", "_").replace("\\", "_")
                    safe = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in safe)[:36] or "value"
                    new_col = f"{prefix}_{safe}"
                    suffix = 2
                    while new_col in df.columns:
                        new_col = f"{prefix}_{safe}_{suffix}"
                        suffix += 1
                    df[new_col] = (df[col] == value).astype(int)
                    created.append(new_col)
                summary = f"One-hot encoded '{col}' into {len(created)} columns."
            else:
                return {"error": f"Unsupported encoding method: {method}"}, 400

        elif operation == "pct_of_max":
            col = body.get("column")
            new_name = body.get("new_name") or f"{col}_pct"
            if col not in df.columns:
                return {"error": f"Column '{col}' not found"}, 400
            mx = df[col].max()
            df[new_name] = (df[col] / mx * 100) if mx != 0 else 0
            summary = f"Converted '{col}' to % of max → '{new_name}'."

        else:
            return {"error": f"Unknown operation: {operation}"}, 400

        create_stage(s, ds, df, op_type=f"feature_engineer_{operation}", op_params=body, summary=summary)
        s.commit()
        return jsonify({"ok": True, "summary": summary})
    except Exception as e:
        return {"error": friendly_error_message(e, "Feature engineering could not be applied. Check the selected columns and options.")}, 400
    finally:
        s.close()
