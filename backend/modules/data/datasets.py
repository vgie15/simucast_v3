"""
Dataset CRUD: list, upload (CSV/Excel), get/delete, sheet selection,
paginated rows, single + bulk cell edits, column stats, variable updates,
CSV export, and category-grouping helpers used by both this blueprint and
the cleaning blueprint.
"""
import re
from difflib import SequenceMatcher

import numpy as np
import pandas as pd
from flask import Blueprint, jsonify, request

from backend.core.cache import _df_cache_invalidate
from backend.config import MAX_UPLOAD_BYTES, MAX_UPLOAD_ROWS
from backend.database import (
    db, ActivityLog, AIResponse, Analysis, Dataset, DatasetStage, Model,
)
from backend.shared.utils import _json_safe, _parse_num, clean_json, jdump, jload
from backend.core.activity import log_activity
from backend.core.auth_helpers import (
    _attach_owner, _auth_from_request, _client_guest_slot_used, _dataset_scope,
)
from backend.shared.dataframe import (
    _current_rows, create_stage, df_from_dataset, infer_variables,
    _rows_for_stage, _sheet_list, _sheet_payload_from_df,
)


bp = Blueprint("datasets", __name__)


_GUIDANCE_GOALS = {
    "prepare_data",
    "train_model",
    "compare_models",
    "what_if",
    "report",
    "full_workflow",
}


def _guidance_intent_for_question(question):
    """Map user-language questions onto the supported SimuCast intent set."""
    text = str(question or "").strip().lower()
    if not text:
        return None
    if re.search(r"(clean|prepare|missing|outlier|duplicate|standardi[sz]e|format)", text):
        return "prepare_data"
    if re.search(r"(what[- ]?if|scenario|change .*prediction|if .* change|simulate)", text):
        return "what_if"
    if re.search(r"(compare .*model|best model|which model|model performance)", text):
        return "compare_models"
    if re.search(r"(report|summary for|export findings|document)", text):
        return "report"
    if re.search(r"(predict|prediction|will .* pass|can .* pass|forecast|likely to|probability)", text):
        return "train_model"
    if re.search(r"(factor|affect|relationship|related|difference|compare|trend|pattern|explain|explore)", text):
        return "full_workflow"
    return None


def _guidance_closest_intents(question):
    """Return safe fallback paths when a typed question is still vague."""
    inferred = _guidance_intent_for_question(question)
    options = [item for item in (inferred, "full_workflow", "train_model", "prepare_data") if item]
    return list(dict.fromkeys(options))[:3]


def _default_guidance(status="pending"):
    """Initial goal-selection state for newly-created projects."""
    return {
        "goal": None,
        "intent": None,
        "question_text": None,
        "question_source": None,
        "setup_status": status,
        "guided_mode": False,
        "walkthrough_step": None,
        "dismissed_tips": [],
        "completed_tips": [],
    }


def _guidance_payload(ds):
    """Return normalized project guidance state for API responses."""
    raw = getattr(ds, "guidance", None)
    payload = jload(raw) or {}
    default_status = "pending" if raw else "dismissed"
    normalized = _default_guidance(payload.get("setup_status") or default_status)
    goal = payload.get("goal") or payload.get("intent")
    if goal in _GUIDANCE_GOALS:
        normalized["goal"] = goal
        normalized["intent"] = goal
    question = str(payload.get("question_text") or "").strip()
    normalized["question_text"] = question[:500] or None
    source = str(payload.get("question_source") or "").strip().lower()
    if source in {"ai", "system", "user"}:
        normalized["question_source"] = source
    normalized["guided_mode"] = bool(payload.get("guided_mode"))
    step = payload.get("walkthrough_step")
    normalized["walkthrough_step"] = str(step) if step else None
    dismissed = payload.get("dismissed_tips") or []
    if isinstance(dismissed, list):
        normalized["dismissed_tips"] = [str(item) for item in dismissed if item]
    completed = payload.get("completed_tips") or []
    if isinstance(completed, list):
        normalized["completed_tips"] = [str(item) for item in completed if item]
    if normalized["setup_status"] not in {"pending", "completed", "dismissed"}:
        normalized["setup_status"] = "pending"
    return normalized


def _guidance_update(current, body):
    """Merge a safe guidance PATCH payload into existing project state."""
    next_payload = {**current}
    if "goal" in body:
        goal = body.get("goal")
        if goal not in _GUIDANCE_GOALS and goal is not None:
            return None, "unsupported project goal"
        next_payload["goal"] = goal
        next_payload["intent"] = goal
    if "intent" in body:
        intent = body.get("intent")
        if intent not in _GUIDANCE_GOALS and intent is not None:
            return None, "unsupported project intent"
        next_payload["goal"] = intent
        next_payload["intent"] = intent
    if "question_text" in body:
        question = str(body.get("question_text") or "").strip()
        next_payload["question_text"] = question[:500] or None
    if "question_source" in body:
        source = str(body.get("question_source") or "").strip().lower()
        if source not in {"ai", "system", "user"} and source:
            return None, "unsupported question source"
        next_payload["question_source"] = source or None
    if "setup_status" in body:
        status = str(body.get("setup_status") or "").strip().lower()
        if status not in {"pending", "completed", "dismissed"}:
            return None, "unsupported setup status"
        next_payload["setup_status"] = status
    if "guided_mode" in body:
        next_payload["guided_mode"] = bool(body.get("guided_mode"))
    if "walkthrough_step" in body:
        step = body.get("walkthrough_step")
        next_payload["walkthrough_step"] = str(step) if step else None
    if "dismissed_tips" in body:
        tips = body.get("dismissed_tips")
        if not isinstance(tips, list):
            return None, "dismissed_tips must be a list"
        next_payload["dismissed_tips"] = [str(item) for item in tips if item]
    if "completed_tips" in body:
        tips = body.get("completed_tips")
        if not isinstance(tips, list):
            return None, "completed_tips must be a list"
        next_payload["completed_tips"] = [str(item) for item in tips if item]
    return next_payload, None


@bp.route("/api/datasets/<ds_id>/guidance/question_path", methods=["POST"])
def map_dataset_guidance_question(ds_id):
    """Resolve a typed project question to one of SimuCast's supported paths."""
    body = request.get_json() or {}
    question = str(body.get("question_text") or body.get("question") or "").strip()
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return jsonify({"error": "not found"}), 404
        intent = _guidance_intent_for_question(question)
        return jsonify({
            "question_text": question[:500],
            "intent": intent,
            "supported": bool(intent),
            "closest_intents": _guidance_closest_intents(question),
        })
    finally:
        s.close()


# ===========================================================================
# SECTION: DATASETS - LIST & UPLOAD
# Keywords: dataset, project, list, upload, csv, excel, file, create
# ===========================================================================
# ANCHOR: Dataset: List Projects
@bp.route("/api/datasets", methods=["GET"])
def list_datasets():
    """Return all datasets visible to the caller's session/user."""
    s = db()
    try:
        rows = _dataset_scope(s.query(Dataset), s).order_by(Dataset.created_at.desc()).all()
        return jsonify([{
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "filename": r.filename,
            "row_count": r.row_count,
            "col_count": r.col_count,
            "sheets": _sheet_list(r),
            "active_sheet": r.active_sheet,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows])
    finally:
        s.close()


def _validate_upload_file(f):
    """Run safety checks on an uploaded file before pandas parses it.

    Returns (ok: bool, error_message: str|None, kind: str|None) where kind is
    "csv" or "excel". Centralising these checks keeps upload_dataset readable.

    Checks performed:
      1. Filename has an allowed extension.
      2. Size is under MAX_UPLOAD_BYTES (this is also enforced by Flask via
         MAX_CONTENT_LENGTH, but we re-check here so we can return a clear
         JSON error instead of Flask's default HTML 413 page).
      3. Magic bytes match the extension. Catches the "renamed .exe to .csv"
         case where the extension lies about the contents.
    """
    name = (f.filename or "").lower()
    if name.endswith(".csv"):
        kind = "csv"
    elif name.endswith((".xlsx", ".xls")):
        kind = "excel"
    else:
        return False, "Unsupported file type. Please upload a .csv, .xlsx, or .xls file.", None

    # Measure size by seeking the underlying stream. We rewind so the parser
    # downstream still sees the file from byte 0.
    f.stream.seek(0, 2)             # 2 = seek from end
    size = f.stream.tell()
    f.stream.seek(0)
    if size > MAX_UPLOAD_BYTES:
        mb_limit = MAX_UPLOAD_BYTES // (1024 * 1024)
        mb_actual = round(size / (1024 * 1024), 1)
        return False, f"File is too large ({mb_actual} MB). Maximum allowed is {mb_limit} MB.", None
    if size == 0:
        return False, "File is empty.", None

    # Magic-byte sniff — read a few bytes, then rewind.
    head = f.stream.read(8)
    f.stream.seek(0)
    if kind == "excel":
        # XLSX is a zip archive — starts with PK\x03\x04. XLS is an OLE
        # compound document — starts with D0 CF 11 E0 A1 B1 1A E1.
        is_xlsx = head[:4] == b"PK\x03\x04"
        is_xls = head[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
        if not (is_xlsx or is_xls):
            return False, "File looks like it was renamed — the contents don't match an Excel file.", None
    else:
        # CSV has no magic number, but it should be valid UTF-8/ASCII text.
        # Reject anything with a NUL byte in the first chunk — clear sign of
        # a binary file pretending to be CSV.
        if b"\x00" in head:
            return False, "File looks like it was renamed — CSV files should be plain text.", None

    return True, None, kind


# ANCHOR: Dataset: Upload File (CSV/Excel)
@bp.route("/api/datasets/upload", methods=["POST"])
def upload_dataset():
    """Create a Dataset from either an uploaded file or an existing Dataset.

    Accepts multipart form data with one of:
      - file:           uploaded CSV/Excel file
      - from_dataset_id: id of an existing Dataset to clone the data from
    Optional fields: name, description.
    """
    name = request.form.get("name")
    description = (request.form.get("description") or "").strip() or None
    from_id = request.form.get("from_dataset_id")

    s = db()
    try:
        sess, _ = _auth_from_request(s)
        if sess and sess.is_guest:
            existing_count = _dataset_scope(s.query(Dataset), s).count()
            usage = int(sess.guest_usage_count or 0)
            if _client_guest_slot_used() and usage < 1:
                sess.guest_usage_count = 1
                usage = 1
            # Retroactively sync for sessions created before the usage counter existed
            if existing_count > usage:
                sess.guest_usage_count = existing_count
                usage = existing_count
            if usage >= 1 or existing_count >= 1:
                return {
                    "error": "Guest accounts can only upload 1 dataset. Sign up or log in to upload more.",
                    "auth_required": True,
                    "guest_limit": True,
                }, 403

        if from_id:
            src = _dataset_scope(s.query(Dataset), s).filter_by(id=from_id).first()
            if not src:
                return {"error": "source dataset not found"}, 404
            variables = jload(src.variables) or []
            records = jload(src.data) or []
            row_count = src.row_count
            col_count = src.col_count
            filename = src.filename
            final_name = name or src.name
            sheets = jload(getattr(src, "sheets", None))
            active_sheet = src.active_sheet
        else:
            if "file" not in request.files:
                return {"error": "no file"}, 400
            f = request.files["file"]

            # Pre-parse safety checks (size, type, magic bytes).
            ok, err, kind = _validate_upload_file(f)
            if not ok:
                return {"error": err}, 400

            sheets = None
            active_sheet = None
            try:
                if kind == "csv":
                    df = pd.read_csv(f)
                else:  # kind == "excel"
                    xls = pd.ExcelFile(f)
                    sheet_payload = {}
                    for sheet_name in xls.sheet_names:
                        sheet_df = pd.read_excel(xls, sheet_name=sheet_name)
                        sheet_payload[str(sheet_name)] = _sheet_payload_from_df(sheet_df)
                    if not sheet_payload:
                        return {"error": "workbook has no sheets"}, 400
                    active_sheet = str(xls.sheet_names[0])
                    sheets = sheet_payload
                    df = pd.DataFrame(sheet_payload[active_sheet]["data"])
            except Exception as e:
                # Don't leak the raw pandas exception to the client — it's noisy
                # and can expose internals. Log it and return a friendly message.
                print(f"upload parse failed: {e}", flush=True)
                return {"error": "Could not read the file. Please check it isn't corrupted."}, 400

            # Post-parse safety check: refuse pathologically large datasets.
            if len(df) > MAX_UPLOAD_ROWS:
                return {
                    "error": f"Dataset has {len(df):,} rows — maximum is {MAX_UPLOAD_ROWS:,}.",
                }, 400

            variables = infer_variables(df)
            records = clean_json(df.where(pd.notnull(df), None).to_dict(orient="records"))
            row_count = len(df)
            col_count = len(df.columns)
            filename = f.filename
            final_name = name or f.filename

        ds = Dataset(
            name=final_name,
            description=description,
            filename=filename,
            row_count=row_count,
            col_count=col_count,
            variables=jdump(variables),
            data=jdump(records),
            sheets=jdump(sheets) if sheets else None,
            active_sheet=active_sheet,
            guidance=jdump(_default_guidance()),
        )
        _attach_owner(ds, s)
        s.add(ds)
        s.flush()  # populate ds.id for activity log refs
        ds_id = ds.id
        log_activity(
            s,
            ds_id,
            "upload" if not from_id else "clone",
            f"Created project '{final_name}' with {row_count} rows and {col_count} columns",
            detail={"category": "data_prep", "action_type": "upload" if not from_id else "clone", "filename": filename, "source_dataset_id": from_id, "sheet": active_sheet, "sheets": list((sheets or {}).keys())},
            ref_type="dataset",
            ref_id=ds_id,
            commit=False,
        )
        if active_sheet:
            log_activity(
                s,
                ds_id,
                "stage",
                f"Selected sheet '{active_sheet}'",
                detail={"category": "data_prep", "action_type": "select_sheet", "sheet": active_sheet},
                ref_type="dataset",
                ref_id=ds_id,
                commit=False,
                dedupe_key=f"sheet:{ds_id}:{active_sheet}",
            )
        # Consume one guest slot (persists even if project is later deleted)
        if sess and sess.is_guest:
            sess.guest_usage_count = int(sess.guest_usage_count or 0) + 1
        s.commit()
        return {
            "id": ds_id,
            "name": final_name,
            "description": description,
            "row_count": row_count,
            "col_count": col_count,
            "variables": variables,
            "sheets": _sheet_list(ds),
            "active_sheet": active_sheet,
            "guidance": _guidance_payload(ds),
            "usage_count": int(sess.guest_usage_count) if sess and sess.is_guest else None,
        }
    finally:
        s.close()


# ===========================================================================
# SECTION: DATASETS - DETAIL
# Keywords: dataset, get, detail, sheet, delete
# ===========================================================================
# ANCHOR: Dataset: Get Detail
@bp.route("/api/datasets/<ds_id>", methods=["GET"])
def get_dataset(ds_id):
    """Returns dataset metadata + variables for the active stage."""
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        live_vars = infer_variables(pd.DataFrame(_current_rows(ds, s)))
        return {
            "id": ds.id,
            "name": ds.name,
            "description": ds.description,
            "filename": ds.filename,
            "row_count": ds.row_count,
            "col_count": ds.col_count,
            "variables": live_vars,
            "current_stage_id": ds.current_stage_id,
            "sheets": _sheet_list(ds),
            "active_sheet": ds.active_sheet,
            "guidance": _guidance_payload(ds),
            "created_at": ds.created_at.isoformat() if ds.created_at else None,
        }
    finally:
        s.close()

# ANCHOR: Dataset: Select Excel Sheet
@bp.route("/api/datasets/<ds_id>/sheet", methods=["POST"])
def select_dataset_sheet(ds_id):
    """Switch the active Excel sheet and re-baseline the dataset payload."""
    body = request.get_json() or {}
    sheet_name = str(body.get("sheet") or "").strip()
    if not sheet_name:
        return {"error": "sheet is required"}, 400
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        sheets = jload(ds.sheets) or {}
        if not sheets:
            return {"error": "this dataset has no alternate sheets"}, 400
        if sheet_name not in sheets:
            return {"error": f"sheet '{sheet_name}' not found"}, 404
        payload = sheets[sheet_name] or {}
        records = payload.get("data") or []
        variables = payload.get("variables") or infer_variables(pd.DataFrame(records))
        ds.active_sheet = sheet_name
        ds.data = jdump(records)
        ds.variables = jdump(variables)
        ds.row_count = int(payload.get("row_count") or len(records))
        ds.col_count = int(payload.get("col_count") or (len(pd.DataFrame(records).columns) if records else 0))
        ds.current_stage_id = None
        _df_cache_invalidate(ds_id)  # data swapped — invalidate cache
        log_activity(
            s,
            ds_id,
            "stage",
            f"Selected sheet '{sheet_name}'",
            detail={
                "category": "data_prep",
                "action_type": "select_sheet",
                "sheet": sheet_name,
                "row_count": ds.row_count,
                "col_count": ds.col_count,
                "empty": bool(payload.get("empty")),
            },
            ref_type="dataset",
            ref_id=ds_id,
            commit=False,
            dedupe_key=f"sheet:{ds_id}:{sheet_name}",
        )
        s.commit()
        return jsonify(clean_json({
            "ok": True,
            "id": ds.id,
            "name": ds.name,
            "description": ds.description,
            "filename": ds.filename,
            "row_count": ds.row_count,
            "col_count": ds.col_count,
            "variables": variables,
            "current_stage_id": ds.current_stage_id,
            "sheets": _sheet_list(ds),
            "active_sheet": ds.active_sheet,
            "guidance": _guidance_payload(ds),
        }))
    finally:
        s.close()


# ANCHOR: Dataset: Update Project Guidance
@bp.route("/api/datasets/<ds_id>/guidance", methods=["PATCH"])
def update_dataset_guidance(ds_id):
    """Persist a project's goal choice and guided walkthrough state."""
    body = request.get_json() or {}
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        next_payload, error = _guidance_update(_guidance_payload(ds), body)
        if error:
            return {"error": error}, 400
        ds.guidance = jdump(next_payload)
        s.commit()
        return jsonify({"ok": True, "guidance": next_payload})
    finally:
        s.close()


# ANCHOR: Dataset: Delete Project
@bp.route("/api/datasets/<ds_id>", methods=["DELETE"])
def delete_dataset(ds_id):
    """Cascade-delete a dataset along with stages, analyses, models, etc."""
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        deleted = {
            "stages": s.query(DatasetStage).filter_by(dataset_id=ds_id).delete(synchronize_session=False),
            "analyses": s.query(Analysis).filter_by(dataset_id=ds_id).delete(synchronize_session=False),
            "models": s.query(Model).filter_by(dataset_id=ds_id).delete(synchronize_session=False),
            "activity": s.query(ActivityLog).filter_by(dataset_id=ds_id).delete(synchronize_session=False),
            "ai_responses": s.query(AIResponse).filter_by(dataset_id=ds_id).delete(synchronize_session=False),
        }
        name = ds.name
        filename = ds.filename
        s.delete(ds)
        s.commit()
        _df_cache_invalidate(ds_id)  # dataset gone — free cached DataFrames
        return jsonify({"ok": True, "id": ds_id, "name": name, "filename": filename, "deleted": deleted})
    finally:
        s.close()


# ===========================================================================
# SECTION: DATA VIEW - ROWS & CELL EDITING
# Keywords: rows, paginated, cell, edit, bulk, data view, grid
# ===========================================================================
# ANCHOR: Dataset: Get Paginated Rows (Data View)
@bp.route("/api/datasets/<ds_id>/rows", methods=["GET"])
def get_rows(ds_id):
    """Paginated row data for the Excel-like grid.

    Optional ?stage_id=original|<int> selects a specific stage.
    """
    page = max(_parse_num(request.args.get("page"), 1, int), 1)
    page_size = min(max(_parse_num(request.args.get("page_size"), 100, int), 1), 1000)
    stage_id = request.args.get("stage_id")
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        rows = _rows_for_stage(ds, stage_id, s)
        start = (page - 1) * page_size
        end = start + page_size
        page_rows = []
        for idx, row in enumerate(rows[start:end], start=start):
            out = dict(row)
            out["__row_index"] = idx
            page_rows.append(out)
        return {
            "rows": page_rows,
            "page": page,
            "page_size": page_size,
            "total": len(rows),
            "stage_id": stage_id or ds.current_stage_id or "original",
        }
    finally:
        s.close()

# ANCHOR: Dataset: Edit Single Cell
@bp.route("/api/datasets/<ds_id>/cell", methods=["PATCH"])
def update_cell(ds_id):
    """Apply a single-cell edit and persist a new stage."""
    body = request.get_json() or {}
    row_index = body.get("row_index")
    column = body.get("column")
    value = body.get("value")
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        rows = _current_rows(ds, s)
        try:
            row_index = int(row_index)
        except (TypeError, ValueError):
            return {"error": "row_index must be an integer"}, 400
        if row_index < 0 or row_index >= len(rows):
            return {"error": "row_index out of range"}, 400
        if not column or column not in (rows[row_index] or {}):
            return {"error": "bad column"}, 400

        df = df_from_dataset(ds, s)
        old_value, new_value, error = _apply_cell_edit(df, row_index, column, value)
        if error:
            return {"error": error}, 400

        summary = f"Edited row {row_index + 1}, '{column}' from {old_value!r} to {new_value!r}"
        stage = create_stage(
            s,
            ds,
            df,
            op_type="cell_edit",
            op_params={"row_index": row_index, "column": column, "old_value": clean_json(old_value), "value": clean_json(new_value)},
            summary=summary,
        )
        return jsonify({"ok": True, "stage_id": stage.id, "summary": summary})
    finally:
        s.close()

# ANCHOR: Dataset: Edit Multiple Cells (Bulk Edit)
@bp.route("/api/datasets/<ds_id>/cells", methods=["PATCH"])
def update_cells(ds_id):
    """Apply a batch of cell edits as a single new stage."""
    body = request.get_json() or {}
    edits = body.get("edits") or []
    if not isinstance(edits, list) or not edits:
        return {"error": "edits must be a non-empty list"}, 400

    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        rows = _current_rows(ds, s)
        df = df_from_dataset(ds, s)
        applied = []

        for edit in edits:
            row_index = edit.get("row_index")
            column = edit.get("column")
            value = edit.get("value")
            try:
                row_index = int(row_index)
            except (TypeError, ValueError):
                return {"error": "row_index must be an integer"}, 400
            if row_index < 0 or row_index >= len(rows):
                return {"error": "row_index out of range"}, 400
            if not column or column not in (rows[row_index] or {}):
                return {"error": "bad column"}, 400

            old_value, new_value, error = _apply_cell_edit(df, row_index, column, value)
            if error:
                return {"error": error}, 400
            if clean_json(old_value) != clean_json(new_value):
                applied.append({
                    "row_index": row_index,
                    "column": column,
                    "old_value": clean_json(old_value),
                    "value": clean_json(new_value),
                })

        if not applied:
            return jsonify({"ok": True, "stage_id": ds.current_stage_id, "summary": "No cell changes to save"})

        summary = f"Edited {len(applied)} cell{'s' if len(applied) != 1 else ''}"
        stage = create_stage(
            s,
            ds,
            df,
            op_type="cell_edit",
            op_params={"edits": applied},
            summary=summary,
        )
        return jsonify({"ok": True, "stage_id": stage.id, "summary": summary, "edits": applied})
    finally:
        s.close()

def _apply_cell_edit(df, row_index, column, value):
    """Coerce ``value`` to the column's dtype, mutate ``df`` in place, and return change info."""
    if column not in df.columns:
        return None, None, "bad column"
    old_value = df.at[row_index, column] if row_index in df.index else None
    new_value = None if value == "" else value
    if new_value is not None:
        series = df[column]
        if pd.api.types.is_numeric_dtype(series):
            try:
                number = float(new_value)
                new_value = int(number) if number.is_integer() else number
            except (TypeError, ValueError):
                return old_value, None, f"'{column}' expects a numeric value"
        elif pd.api.types.is_bool_dtype(series):
            new_value = str(new_value).strip().lower() in ("1", "true", "yes", "y")
    df.at[row_index, column] = new_value
    return old_value, new_value, None

_CATEGORY_ABBREVIATIONS = {
    "hs": "high school",
    "h.s.": "high school",
    "grad": "graduate",
    "post grad": "postgrad",
    "post graduate": "postgrad",
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
    """Detect mixed yes/no encodings (e.g. '1'/'true'/'pass') in a column."""
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
        if not norm:
            continue
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
        originals = sorted({raw for n in group_norms for raw in normalized[n]})
        if len(originals) > 1 or any(raw != _title_category_label(norm) for raw in originals):
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


# ===========================================================================
# SECTION: EXPORT
# Keywords: export, download, csv
# ===========================================================================
# ANCHOR: Dataset: Export CSV (Download)
@bp.route("/api/datasets/<ds_id>/export.csv", methods=["GET"])
def export_csv(ds_id):
    """Stream the active stage (or any stage selected via ?stage_id=) as CSV."""
    from flask import Response
    stage_id = request.args.get("stage_id")
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        rows = _rows_for_stage(ds, stage_id, s)
        if not rows:
            df = pd.DataFrame()
        else:
            df = pd.DataFrame(rows)
        buf = df.to_csv(index=False)
        suffix = stage_id or ds.current_stage_id or "original"
        suffix_label = "original" if suffix == "original" else f"stage-{suffix[:8]}"
        safe_name = "".join(c if c.isalnum() or c in "-_." else "_" for c in (ds.name or "dataset"))
        fname = f"{safe_name}__{suffix_label}.csv"
        return Response(
            buf,
            mimetype="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )
    finally:
        s.close()



# ===========================================================================
# SECTION: COLUMNS & VARIABLES
# Keywords: column, variable, distinct values, dtype, type, label, variable view
# ===========================================================================
# ANCHOR: Column: List Distinct Values
@bp.route("/api/datasets/<ds_id>/columns/<col_name>/values", methods=["GET"])
def get_column_values(ds_id, col_name):
    """Paginated single-column entries with their row index."""
    page = max(_parse_num(request.args.get("page"), 1, int), 1)
    page_size = min(max(_parse_num(request.args.get("page_size"), 200, int), 1), 1000)
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        rows = _current_rows(ds, s)
        if rows and col_name not in rows[0]:
            return {"error": "column not found"}, 404
        start = (page - 1) * page_size
        end = start + page_size
        slice_ = rows[start:end]
        values = [
            {"row": start + i + 1, "value": r.get(col_name)}
            for i, r in enumerate(slice_)
        ]
        return {
            "column": col_name,
            "values": values,
            "page": page,
            "page_size": page_size,
            "total": len(rows),
        }
    finally:
        s.close()

# ANCHOR: Variable: Update Type/Label (Variable View)
@bp.route("/api/datasets/<ds_id>/variables/<var_name>", methods=["PATCH"])
def update_variable(ds_id, var_name):
    """Update variable dtype."""
    body = request.get_json() or {}
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        variables = jload(ds.variables) or []
        for v in variables:
            if v["name"] == var_name:
                if "dtype" in body:
                    v["dtype"] = body["dtype"]
                break
        ds.variables = jdump(variables)
        s.commit()
        return {"ok": True, "variables": variables}
    finally:
        s.close()

# ANCHOR: Column: Get Stats (Mean/Min/Max)
@bp.route("/api/datasets/<ds_id>/columns/<col_name>/stats", methods=["GET"])
def column_stats(ds_id, col_name):
    """Per-column profiling stats: dtype, missing, errors, zeros, value counts, etc."""
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds)
        if col_name not in df.columns:
            return {"error": "column not found"}, 404

        variables = jload(ds.variables) or []
        var = next((v for v in variables if v["name"] == col_name), None)
        dtype = var["dtype"] if var else "text"

        series = df[col_name]
        total = int(len(series))
        missing = int(series.isna().sum())
        present = series.dropna()
        unique = int(present.nunique())

        out = {
            "name": col_name,
            "dtype": dtype,
            "total_rows": total,
            "missing": missing,
            "missing_pct": round(missing / total * 100, 2) if total else 0,
            "present": int(len(present)),
            "unique": unique,
        }

        # type-error count: values that don't match the declared dtype
        type_errors = 0
        if dtype in ("numeric", "int", "float", "binary"):
            coerced = pd.to_numeric(present, errors="coerce")
            type_errors = int(coerced.isna().sum())
        elif dtype == "datetime":
            coerced = pd.to_datetime(present, errors="coerce")
            type_errors = int(coerced.isna().sum())
        out["type_errors"] = type_errors

        if dtype in ("numeric", "int", "float", "binary"):
            num = pd.to_numeric(present, errors="coerce").dropna()
            zeros = int((num == 0).sum())
            out["zero_count"] = zeros
            out["zero_pct"] = round(zeros / total * 100, 2) if total else 0
            out["negative_count"] = int((num < 0).sum())
            if len(num):
                out["min"] = float(num.min())
                out["max"] = float(num.max())
                out["mean"] = float(num.mean())
                out["median"] = float(num.median())
                out["std"] = float(num.std()) if len(num) > 1 else 0.0
            if dtype == "binary" or unique <= 10:
                vc = num.value_counts().head(10)
                out["value_counts"] = [
                    {"value": _json_safe(k), "count": int(v), "pct": round(int(v) / total * 100, 2)}
                    for k, v in vc.items()
                ]

        elif dtype in ("category", "text"):
            empty_strings = int((present.astype(str).str.strip() == "").sum())
            out["empty_string_count"] = empty_strings
            vc = present.value_counts().head(20)
            out["value_counts"] = [
                {"value": _json_safe(k), "count": int(v), "pct": round(int(v) / total * 100, 2)}
                for k, v in vc.items()
            ]
            lens = present.astype(str).str.len()
            if len(lens):
                out["min_length"] = int(lens.min())
                out["max_length"] = int(lens.max())
                out["avg_length"] = round(float(lens.mean()), 1)

        elif dtype == "datetime":
            parsed = pd.to_datetime(present, errors="coerce").dropna()
            if len(parsed):
                out["min"] = parsed.min().isoformat()
                out["max"] = parsed.max().isoformat()

        return out
    finally:
        s.close()
