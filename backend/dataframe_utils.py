"""
DataFrame load/cache helpers and stage management.

Resolves a Dataset row into a pandas DataFrame for the active stage, persists
new stages with ``create_stage``, and exposes the variable-inference helpers
the routes use to keep dtype metadata in sync.
"""
import uuid

import numpy as np
import pandas as pd

from backend.cache import _DF_CACHE, _df_cache_invalidate, _cache_put, _df_cache_key
from backend.database import db, DatasetStage
from backend.utils import jload, jdump, clean_json
from backend.activity import log_activity


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
    variables = infer_variables(df)
    records = clean_json(df.where(pd.notnull(df), None).to_dict(orient="records"))
    parent_id = ds.current_stage_id  # may be None (original)
    stage = DatasetStage(
        id=str(uuid.uuid4()),
        dataset_id=ds.id,
        parent_stage_id=parent_id,
        step_index=_stage_count(ds.id, session) + 1,
        op_type=op_type,
        op_params=jdump(op_params),
        summary=summary,
        row_count=len(df),
        col_count=len(df.columns),
        variables=jdump(variables),
        data=jdump(records),
    )
    session.add(stage)
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
