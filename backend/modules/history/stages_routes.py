"""
Stage / dataset-version routes: list snapshots, restore, full reset.
"""
from flask import Blueprint, request

from backend.core.cache import _df_cache_invalidate
from backend.database import (
    db, ActivityLog, Analysis, Dataset, DatasetStage, Model,
)
from backend.shared.utils import jload
from backend.core.activity import log_activity
from backend.core.auth_helpers import _dataset_scope


bp = Blueprint("stages_routes", __name__)


# ===========================================================================
# SECTION: STAGES - SNAPSHOTS & VERSIONING
# Keywords: stage, snapshot, version, restore, revert, reset, history
# ===========================================================================
# ANCHOR: Stages: List Snapshots / Versions
@bp.route("/api/datasets/<ds_id>/stages", methods=["GET"])
def list_stages(ds_id):
    """Return all stages plus the implicit 'original' so the UI can render
    a timeline. The frontend marks the current stage by id."""
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        stages = (
            s.query(DatasetStage)
            .filter_by(dataset_id=ds_id)
            .order_by(DatasetStage.step_index)
            .all()
        )
        original = {
            "id": "original",
            "step_index": 0,
            "op_type": "upload",
            "summary": f"Original upload — {ds.row_count} rows · {ds.col_count} columns",
            "row_count": ds.row_count if not stages else jload(ds.data).__len__() if ds.data else 0,
            "col_count": ds.col_count if not stages else (len(jload(ds.variables) or []) if ds.variables else 0),
            "created_at": ds.created_at.isoformat() if ds.created_at else None,
        }
        # the row_count/col_count for original should reflect the upload, not current
        if stages:
            orig_rows = jload(ds.data) or []
            original["row_count"] = len(orig_rows)
            original["col_count"] = len(orig_rows[0]) if orig_rows else 0
        return {
            "current_stage_id": ds.current_stage_id or "original",
            "stages": [original] + [
                {
                    "id": st.id,
                    "step_index": st.step_index,
                    "op_type": st.op_type,
                    "op_params": jload(st.op_params),
                    "summary": st.summary,
                    "row_count": st.row_count,
                    "col_count": st.col_count,
                    "created_at": st.created_at.isoformat() if st.created_at else None,
                }
                for st in stages
            ],
        }
    finally:
        s.close()

# ANCHOR: Stages: Restore Snapshot / Revert
@bp.route("/api/datasets/<ds_id>/stages/<stage_id>/restore", methods=["POST"])
def restore_stage(ds_id, stage_id):
    """Set a previous stage as the current one (revert)."""
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        removed_stage_ids = []
        if stage_id == "original":
            ds.current_stage_id = None
            rows = jload(ds.data) or []
            ds.row_count = len(rows)
            ds.col_count = len(rows[0]) if rows else 0
            removed_stage_ids = [
                st.id for st in s.query(DatasetStage).filter_by(dataset_id=ds_id).all()
            ]
        else:
            stage = s.query(DatasetStage).filter_by(id=stage_id, dataset_id=ds_id).first()
            if not stage:
                return {"error": "stage not found"}, 404
            ds.current_stage_id = stage.id
            ds.row_count = stage.row_count
            ds.col_count = stage.col_count
            removed_stage_ids = [
                st.id for st in s.query(DatasetStage)
                .filter(DatasetStage.dataset_id == ds_id, DatasetStage.step_index > stage.step_index)
                .all()
            ]
        _df_cache_invalidate(ds_id)  # stage reverted — drop cached DataFrames
        if removed_stage_ids:
            s.query(DatasetStage).filter(DatasetStage.id.in_(removed_stage_ids)).delete(synchronize_session=False)
            s.query(ActivityLog).filter(
                ActivityLog.dataset_id == ds_id,
                ActivityLog.ref_type == "stage",
                ActivityLog.ref_id.in_(removed_stage_ids),
            ).delete(synchronize_session=False)
        log_activity(
            s,
            ds_id,
            "restore",
            f"Restored {'original upload' if stage_id == 'original' else 'stage ' + stage_id[:8]}",
            detail={
                "category": "data_prep",
                "action_type": "restore",
                "stage_id": stage_id,
                "removed_future_steps": len(removed_stage_ids),
            },
            ref_type="stage",
            ref_id=stage_id,
            commit=False,
        )
        s.commit()
        return {"ok": True, "current_stage_id": ds.current_stage_id or "original"}
    finally:
        s.close()

# ANCHOR: Stages: Reset Project to Original
@bp.route("/api/datasets/<ds_id>/reset", methods=["POST"])
def reset_project(ds_id):
    """Reset a project to its original uploaded state, removing all derived data."""
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404

        # Delete all stages
        s.query(DatasetStage).filter_by(dataset_id=ds_id).delete()
        # Delete all models
        s.query(Model).filter_by(dataset_id=ds_id).delete()
        # Delete all analyses
        s.query(Analysis).filter_by(dataset_id=ds_id).delete()
        # Delete all activity logs
        s.query(ActivityLog).filter_by(dataset_id=ds_id).delete()

        # Revert dataset to original upload state
        ds.current_stage_id = None
        rows = jload(ds.data) or []
        ds.row_count = len(rows)
        ds.col_count = len(rows[0]) if rows else 0

        # Reset guidance
        from backend.shared.utils import jdump
        ds.guidance = jdump({
            "goal": None,
            "intent": None,
            "question_text": None,
            "question_source": None,
            "setup_status": "pending",
            "guided_mode": False,
            "walkthrough_step": None,
            "dismissed_tips": [],
            "completed_tips": [],
        })

        _df_cache_invalidate(ds_id)  # project reset — drop cached DataFrames

        # Single log entry recording the reset
        log_activity(
            s,
            ds_id,
            "restore",
            "Project reset to initial state",
            detail={"category": "data_prep", "action_type": "reset"},
            commit=False,
        )
        s.commit()
        return {"ok": True}
    finally:
        s.close()
