"""
Activity-log routes: list entries, append a manual note, delete or undo.
"""
import uuid
from datetime import datetime

import pandas as pd
from flask import Blueprint, jsonify, request

from backend.core.cache import _df_cache_invalidate
from backend.database import db, ActivityLog, Analysis, Dataset, DatasetStage, Model
from backend.shared.utils import clean_json, jdump, jload
from backend.core.activity import activity_payload, log_activity


bp = Blueprint("activity_routes", __name__)


# ===========================================================================
# SECTION: ACTIVITY LOG
# Keywords: activity, log, history, note, audit, undo
# ===========================================================================
# ANCHOR: Activity: List Project Actions
@bp.route("/api/datasets/<ds_id>/activity", methods=["GET"])
def list_activity(ds_id):
    order = (request.args.get("order") or "desc").lower()
    s = db()
    try:
        q = s.query(ActivityLog).filter_by(dataset_id=ds_id)
        q = q.order_by(ActivityLog.created_at.asc() if order == "asc" else ActivityLog.created_at.desc())
        hidden = {"ai", "note"}
        return jsonify({"activity": [activity_payload(a) for a in q.all() if a.kind not in hidden and (jload(a.detail) or {}).get("category") != "ai"]})
    finally:
        s.close()


# ANCHOR: Activity: Add Note
@bp.route("/api/datasets/<ds_id>/activity", methods=["POST"])
def create_activity_note(ds_id):
    """Append a free-form documentation note to the project activity log."""
    body = request.get_json() or {}
    summary = (body.get("summary") or "").strip()
    if not summary:
        return {"error": "summary is required"}, 400
    activity_id = body.get("activity_id")
    related_stage_id = body.get("related_stage_id")
    related_analysis_id = body.get("related_analysis_id")
    related_model_id = body.get("related_model_id")
    ref_type = None
    ref_id = None
    if related_stage_id:
        ref_type, ref_id = "stage", related_stage_id
    elif related_analysis_id:
        ref_type, ref_id = "analysis", related_analysis_id
    elif related_model_id:
        ref_type, ref_id = "model", related_model_id
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        if activity_id:
            entry = s.query(ActivityLog).filter_by(id=activity_id, dataset_id=ds_id).first()
            if not entry:
                return {"error": "activity not found"}, 404
            detail = jload(entry.detail) or {}
            notes = [] if body.get("replace") else (detail.get("notes") or [])
            notes.append({"id": str(uuid.uuid4()), "text": summary, "created_at": datetime.utcnow().isoformat()})
            detail["notes"] = notes
            entry.detail = jdump(clean_json(detail))
            s.commit()
            return jsonify(activity_payload(entry))
        entry = log_activity(
            s,
            ds_id,
            "note",
            summary,
            detail={
                "category": "note",
                "action_type": "manual_note",
                "body": body.get("body") or summary,
                "related_stage_id": related_stage_id,
                "related_analysis_id": related_analysis_id,
                "related_model_id": related_model_id,
            },
            ref_type=ref_type,
            ref_id=ref_id,
        )
        return jsonify(activity_payload(entry))
    finally:
        s.close()

# ANCHOR: Activity: Delete or Undo Action
@bp.route("/api/datasets/<ds_id>/activity/<activity_id>", methods=["DELETE"])
def delete_or_undo_activity(ds_id, activity_id):
    """Remove a documentation entry. If it is the current data-stage step, undo by restoring its parent stage first."""
    reverse = str(request.args.get("reverse", "false")).lower() == "true"
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        entry = s.query(ActivityLog).filter_by(id=activity_id, dataset_id=ds_id).first()
        if not entry:
            return {"error": "activity not found"}, 404
        detail = jload(entry.detail) or {}
        stage_id = entry.ref_id if entry.ref_type == "stage" else detail.get("related_stage_id")
        model_id = entry.ref_id if entry.ref_type == "model" else detail.get("related_model_id")
        analysis_id = entry.ref_id if entry.ref_type == "analysis" else detail.get("related_analysis_id")
        restored_to = None
        if reverse and stage_id and stage_id != "original":
            stage = s.query(DatasetStage).filter_by(id=stage_id, dataset_id=ds_id).first()
            if not stage:
                return {"error": "stage not found"}, 404
            if ds.current_stage_id != stage_id:
                return {
                    "error": "Only the current data step can be undone directly. View or restore this stage first if you want to move the dataset to that state.",
                }, 400
            parent_id = stage.parent_stage_id or "original"
            if parent_id == "original":
                rows = jload(ds.data) or []
                df = pd.DataFrame(rows)
                ds.current_stage_id = None
                ds.row_count = len(df)
                ds.col_count = len(df.columns)
            else:
                parent = s.query(DatasetStage).filter_by(id=parent_id, dataset_id=ds_id).first()
                if not parent:
                    return {"error": "parent stage not found"}, 404
                ds.current_stage_id = parent.id
                ds.variables = parent.variables
                ds.row_count = parent.row_count
                ds.col_count = parent.col_count
            _df_cache_invalidate(ds_id)  # restored to a different stage
            restored_to = parent_id
            log_activity(
                s,
                ds_id,
                "restore",
                f"Undid step: {entry.summary}",
                detail={"category": "data_prep", "action_type": "undo_step", "undone_activity_id": activity_id, "undone_stage_id": stage_id, "restored_to": restored_to},
                ref_type="stage",
                ref_id=restored_to,
                commit=False,
            )
        elif reverse and model_id:
            model = s.query(Model).filter_by(id=model_id, dataset_id=ds_id).first()
            if model:
                s.delete(model)
            restored_to = "model_deleted"
        elif reverse and analysis_id:
            analysis = s.query(Analysis).filter_by(id=analysis_id, dataset_id=ds_id).first()
            if analysis:
                s.delete(analysis)
            restored_to = "analysis_deleted"
        elif reverse and entry.kind in {"report", "whatif"}:
            restored_to = "log_only"
        s.delete(entry)
        s.commit()
        return jsonify({"ok": True, "restored_to": restored_to})
    finally:
        s.close()
