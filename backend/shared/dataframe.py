"""
DataFrame load/cache helpers and stage management.

Resolves a Dataset row into a pandas DataFrame for the active stage, persists
new stages with ``create_stage``, and exposes the variable-inference helpers
the routes use to keep dtype metadata in sync.
"""

import numpy as np
import pandas as pd

from backend.core.cache import _DF_CACHE, _df_cache_invalidate, _cache_put, _df_cache_key
from backend.database import db, DatasetStage
from backend.shared.utils import jload, jdump, clean_json
from backend.core.activity import log_activity


def df_from_dataset(ds, session=None):
    """Rehydrate a pandas DataFrame from the dataset's *current* stage.

    Falls back to the original data when no stage is active. Pass a session
    when caller already has one to avoid opening a second connection.

    Cached by (dataset_id, current_stage_id) — when the stage changes
    (e.g. user cleans data) the key changes and we naturally re-parse.
    """
    key = _df_cache_key(ds)
    cached = _DF_CACHE.get(key)
    if cached is not None:
        # Return a copy so callers can mutate without poisoning the cache.
        return cached.copy()
    rows = _current_rows(ds, session)
    df = pd.DataFrame(rows) if rows else pd.DataFrame()
    _cache_put(_DF_CACHE, key, df)
    return df.copy()


def _current_rows(ds, session=None):
    """Return the row list for the active stage (or the original)."""
    if not ds.current_stage_id:
        return jload(ds.data) or []
    own = session is None
    s = session or db()
    try:
        stage = s.query(DatasetStage).filter_by(id=ds.current_stage_id).first()
        if not stage:
            return jload(ds.data) or []
        return jload(stage.data) or []
    finally:
        if own:
            s.close()


def _current_variables(ds, session=None):
    """Variables payload for the active stage (or original)."""
    if not ds.current_stage_id:
        return jload(ds.variables) or []
    own = session is None
    s = session or db()
    try:
        stage = s.query(DatasetStage).filter_by(id=ds.current_stage_id).first()
        if stage:
            return jload(stage.variables) or []
        return jload(ds.variables) or []
    finally:
        if own:
            s.close()


def _stage_count(ds_id, session):
    """How many persisted stages does this dataset have? (excludes original)"""
    return session.query(DatasetStage).filter_by(dataset_id=ds_id).count()


def _rows_for_stage(ds, stage_id, session):
    """Resolve a stage selector (None / 'current' / 'original' / uuid) to rows."""
    if not stage_id or stage_id == "current":
        return _current_rows(ds, session)
    if stage_id == "original":
        return jload(ds.data) or []
    stage = session.query(DatasetStage).filter_by(id=stage_id, dataset_id=ds.id).first()
    if not stage:
        return _current_rows(ds, session)
    return jload(stage.data) or []


def _variables_for_stage(ds, stage_id, session):
    """Resolve a stage selector to its variable metadata payload."""
    if not stage_id or stage_id == "current":
        return _current_variables(ds, session)
    if stage_id == "original":
        return jload(ds.variables) or []
    stage = session.query(DatasetStage).filter_by(id=stage_id, dataset_id=ds.id).first()
    if stage:
        return jload(stage.variables) or []
    return _current_variables(ds, session)


def create_stage(session, ds, df, op_type, op_params, summary):
    """Persist a new stage produced by a transformation and mark it current.

    Re-infers variables from the resulting DataFrame so downstream pages
    pick up new dtypes / dropped columns automatically. Note: ds.variables
    stays at the *original* values; current variables are read via the stage.
    """
    before_df = df_from_dataset(ds, session)
    variables = infer_variables(df)
    records = clean_json(df.where(pd.notnull(df), None).to_dict(orient="records"))
    parent_id = ds.current_stage_id  # may be None (original)
    stored_params = dict(op_params or {}) if isinstance(op_params, dict) else {"params": op_params}
    change_payload = _build_stage_change_payload(before_df, df, op_type, stored_params, summary)
    stage = DatasetStage(
        dataset_id=ds.id,
        parent_stage_id=parent_id,
        step_index=_stage_count(ds.id, session) + 1,
        op_type=op_type,
        op_params=jdump(stored_params),
        summary=summary,
        row_count=len(df),
        col_count=len(df.columns),
        variables=jdump(variables),
        data=jdump(records),
    )
    session.add(stage)
    session.flush()  # populate stage.id before referencing it
    if change_payload:
        stage.op_params = jdump(clean_json({
            **stored_params,
            "_table_changes": _stamp_stage_changes(change_payload, stage),
        }))
    ds.current_stage_id = stage.id
    ds.row_count = len(df)
    ds.col_count = len(df.columns)
    _df_cache_invalidate(ds.id)  # stage changed — drop cached DataFrames
    log_activity(
        session,
        ds.id,
        "stage",
        summary,
        detail={
            "category": "data_prep",
            "action_type": op_type,
            "op_type": op_type,
            "row_count": len(df),
            "col_count": len(df.columns),
            "params": clean_json(op_params),
        },
        ref_type="stage",
        ref_id=stage.id,
        commit=False,
    )
    session.commit()
    return stage


def _build_stage_change_payload(before_df, after_df, op_type, op_params, summary):
    """Capture row/cell changes that let the table explain a new stage."""
    if before_df is None:
        before_df = pd.DataFrame()
    if after_df is None:
        after_df = pd.DataFrame()

    common_columns = [col for col in after_df.columns if col in before_df.columns]
    new_columns = [col for col in after_df.columns if col not in before_df.columns]
    before_positions = {index: position for position, index in enumerate(before_df.index)}
    after_positions = {index: position for position, index in enumerate(after_df.index)}
    descriptors = _column_change_descriptors(op_type, op_params, summary)
    changes = []

    for index, after_position in after_positions.items():
        if index not in before_positions:
            continue
        before_position = before_positions[index]
        for column in common_columns:
            old_value = before_df.at[index, column]
            new_value = after_df.at[index, column]
            if _same_value(old_value, new_value):
                continue
            descriptor = descriptors.get(column) or _default_change_descriptor(op_type, op_params, summary)
            changes.append(_cell_change(
                row_index=after_position,
                source_row_index=before_position,
                column=column,
                original_value=old_value,
                new_value=new_value,
                descriptor=descriptor,
            ))

    if new_columns:
        new_descriptor = {
            "kind": "new_column",
            "action": "Generated column",
            "method": _method_label(op_type, op_params),
            "reason": summary or "This column was created by a dataset transformation.",
        }
        for index, after_position in after_positions.items():
            for column in new_columns:
                changes.append(_cell_change(
                    row_index=after_position,
                    source_row_index=before_positions.get(index),
                    column=column,
                    original_value=None,
                    new_value=after_df.at[index, column],
                    descriptor=new_descriptor,
                ))

    removed_rows = []
    for index, before_position in before_positions.items():
        if index in after_positions:
            continue
        removed_row = {
            "row_index": before_position,
            "action_type": _display_action(op_type),
            "method": _method_label(op_type, op_params),
            "reason": summary or "This row was removed by the latest transformation.",
            "values": clean_json(before_df.loc[index].to_dict()),
        }
        duplicate_match = _duplicate_kept_position(before_df, after_df, index, before_positions, after_positions, op_type)
        if duplicate_match is not None:
            removed_row["duplicate_of_row_index"] = duplicate_match
        removed_rows.append(removed_row)

    generated_rows = []
    for index, after_position in after_positions.items():
        if index in before_positions:
            continue
        generated_rows.append({
            "row_index": after_position,
            "action_type": _display_action(op_type),
            "method": _method_label(op_type, op_params),
            "reason": summary or "This row was generated by the latest transformation.",
            "values": clean_json(after_df.loc[index].to_dict()),
        })

    if not changes and not removed_rows and not generated_rows:
        return None
    return {
        "changes": changes,
        "removed_rows": removed_rows,
        "generated_rows": generated_rows,
        "new_columns": new_columns,
        "summary": summary,
    }


def _stamp_stage_changes(payload, stage):
    """Attach stage/action metadata once the stage id exists."""
    stamped = clean_json(dict(payload))
    timestamp = stage.created_at.isoformat() if stage.created_at else None
    for key in ("changes", "removed_rows", "generated_rows"):
        for item in stamped.get(key) or []:
            item["action_id"] = stage.id
            item["stage_id"] = stage.id
            item["dataset_version_id"] = stage.id
            item["timestamp"] = timestamp
    stamped["stage_id"] = stage.id
    stamped["dataset_version_id"] = stage.id
    stamped["timestamp"] = timestamp
    return stamped


def _duplicate_kept_position(before_df, after_df, removed_index, before_positions, after_positions, op_type):
    """Return the original row position of the kept duplicate for removed duplicate rows."""
    if op_type != "drop_duplicates" or removed_index not in before_df.index:
        return None
    removed_values = before_df.loc[removed_index]
    common_columns = [column for column in before_df.columns if column in after_df.columns]
    for kept_index, _after_position in after_positions.items():
        if kept_index not in before_positions:
            continue
        if _same_duplicate_row(removed_values, after_df.loc[kept_index], common_columns):
            return before_positions.get(kept_index)
    return None


def _same_duplicate_row(left, right, columns):
    for column in columns:
        if not _same_value(left.get(column), right.get(column)):
            return False
    return True


def _column_change_descriptors(op_type, op_params, summary):
    """Return per-column change metadata when a group op exposes its methods."""
    descriptors = {}
    for item in op_params.get("changes") or []:
        column = item.get("column")
        if not column:
            continue
        action = item.get("action") or op_type
        descriptors[column] = _descriptor_from_action(action, op_type, item, summary)
    column = op_params.get("column")
    if column and column not in descriptors:
        descriptors[column] = _default_change_descriptor(op_type, op_params, summary)
    return descriptors


def _descriptor_from_action(action, op_type, item, summary):
    """Classify the table color and tooltip copy for an explicit method."""
    text = f"{action} {op_type}".lower()
    if "impute" in text or "missing" in text:
        return {
            "kind": "missing_fill",
            "action": "Missing value filled",
            "method": item.get("method") or _method_label(action, item),
            "reason": summary or "The selected missing-value method filled this blank cell.",
        }
    if "winsor" in text or "outlier" in text:
        return {
            "kind": "outlier",
            "action": "Outlier capped" if "drop" not in text else "Outlier row removed",
            "method": "IQR bounds" if "winsor" in text or "outlier" in text else _method_label(action, item),
            "reason": summary or "This value was changed because it was detected as extreme.",
        }
    if "standard" in text:
        return {
            "kind": "standardized",
            "action": "Value standardized",
            "method": "Category mapping",
            "reason": summary or "Equivalent labels were mapped to the chosen category.",
        }
    if "type" in text or "convert" in text or "cast" in text or "cell_edit" in text:
        return {
            "kind": "converted",
            "action": "Value converted",
            "method": _method_label(action, item),
            "reason": summary or "This value changed during a data transformation.",
        }
    return _default_change_descriptor(op_type, item, summary)


def _default_change_descriptor(op_type, op_params, summary):
    """Fallback tooltip metadata for transforms that do not expose a method."""
    text = str(op_type or "").lower()
    if "impute" in text or "missing" in text:
        return _descriptor_from_action(op_type, op_type, op_params, summary)
    if "winsor" in text or "outlier" in text:
        return _descriptor_from_action(op_type, op_type, op_params, summary)
    if "category_standardization" in text:
        return _descriptor_from_action("standardize", op_type, op_params, summary)
    if "zscore" in text or "minmax" in text or "scaled" in text:
        return {
            "kind": "scaled",
            "action": "Value scaled",
            "method": _method_label(op_type, op_params),
            "reason": summary or "This value changed during numeric scaling.",
        }
    if "cast" in text or "convert" in text or "type" in text or "cell_edit" in text:
        return _descriptor_from_action(op_type, op_type, op_params, summary)
    return {
        "kind": "converted",
        "action": _display_action(op_type),
        "method": _method_label(op_type, op_params),
        "reason": summary or "This value changed in the current dataset stage.",
    }


def _cell_change(*, row_index, source_row_index, column, original_value, new_value, descriptor):
    """Normalize one changed cell for JSON storage and frontend tooltips."""
    return clean_json({
        "row_index": row_index,
        "source_row_index": source_row_index,
        "column": column,
        "original_value": original_value,
        "new_value": new_value,
        "action_type": descriptor["action"],
        "change_kind": descriptor["kind"],
        "method": descriptor["method"],
        "reason": descriptor["reason"],
    })


def _same_value(left, right):
    """True when two scalars should render as unchanged."""
    if pd.isna(left) and pd.isna(right):
        return True
    return clean_json(left) == clean_json(right)


def _display_action(op_type):
    """Humanize an operation id for compact change tooltips."""
    return str(op_type or "Dataset transform").replace("_", " ").strip().title()


def _method_label(op_type, params):
    """Best-effort method label kept short enough for a table tooltip."""
    params = params or {}
    if params.get("method"):
        return str(params["method"]).replace("_", " ")
    if params.get("action"):
        return str(params["action"]).replace("_", " ")
    if str(op_type or "").startswith("feature_engineer_"):
        return str(op_type).replace("feature_engineer_", "").replace("_", " ")
    return str(op_type or "transform").replace("_", " ")


def infer_variables(df):
    """Produce variable metadata: name, dtype, missing, unique."""
    out = []
    for col in df.columns:
        series = df[col]
        missing = int(series.isna().sum())
        unique = series.nunique(dropna=True)
        # type inference
        if pd.api.types.is_numeric_dtype(series):
            if unique <= 2:
                dtype = "binary"
            elif pd.api.types.is_integer_dtype(series.dropna()):
                dtype = "int"
            else:
                non_null = series.dropna()
                dtype = "int" if len(non_null) and np.all(np.equal(np.mod(non_null, 1), 0)) else "float"
        elif pd.api.types.is_datetime64_any_dtype(series):
            dtype = "datetime"
        else:
            # try to detect dates stored as strings
            try:
                pd.to_datetime(series.dropna().head(20), errors="raise")
                dtype = "datetime"
            except Exception:
                dtype = "category" if unique <= 20 else "text"
        out.append({
            "name": col,
            "dtype": dtype,
            "missing": missing,
            "unique": int(unique),
        })
    return out


def _sheet_payload_from_df(df):
    """Serialize a DataFrame into the sheet-payload shape used for Excel files."""
    df = df.copy()
    variables = infer_variables(df)
    records = clean_json(df.where(pd.notnull(df), None).to_dict(orient="records"))
    return {
        "row_count": int(len(df)),
        "col_count": int(len(df.columns)),
        "variables": variables,
        "data": records,
        "empty": bool(len(df) == 0 or len(df.columns) == 0),
    }


def _sheet_list(ds):
    """Compact list of sheet metadata for an Excel-backed Dataset."""
    payload = jload(getattr(ds, "sheets", None)) or {}
    if not isinstance(payload, dict) or not payload:
        return []
    return [
        {
            "name": name,
            "row_count": int((sheet or {}).get("row_count") or 0),
            "col_count": int((sheet or {}).get("col_count") or 0),
            "empty": bool((sheet or {}).get("empty")),
            "active": name == ds.active_sheet,
        }
        for name, sheet in payload.items()
    ]


def numeric_df(df, cols=None):
    """Select numeric columns (optionally filtered), drop non-numeric."""
    if cols:
        df = df[cols]
    return df.select_dtypes(include=[np.number])


def is_numeric_meta(v):
    """True when a variable metadata entry represents a numeric/binary column."""
    return v.get("dtype") in ("numeric", "int", "float", "binary")
