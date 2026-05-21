"""
Activity-log helpers shared by every blueprint.

``log_activity`` writes (with optional dedupe) and ``activity_payload`` formats
a row for JSON output. Routes call these directly to keep the timeline shape
consistent.
"""
from datetime import datetime

from backend.database import ActivityLog
from backend.shared.utils import clean_json, jload, jdump


def log_activity(session, dataset_id, kind, summary, detail=None, ref_type=None, ref_id=None, commit=True, dedupe_key=None):
    """Append an activity entry, optionally folding into an existing row by dedupe_key."""
    detail = clean_json(detail or {})
    if dedupe_key:
        existing = session.query(ActivityLog).filter_by(dataset_id=dataset_id).all()
        for entry in reversed(existing):
            entry_detail = jload(entry.detail) or {}
            if entry_detail.get("dedupe_key") == dedupe_key:
                entry.summary = summary
                entry.detail = jdump({**entry_detail, **detail, "dedupe_key": dedupe_key, "repeat_count": int(entry_detail.get("repeat_count", 1)) + 1})
                entry.created_at = datetime.utcnow()
                if commit:
                    session.commit()
                return entry
        detail["dedupe_key"] = dedupe_key
    entry = ActivityLog(
        dataset_id=dataset_id,
        kind=kind,
        summary=summary,
        detail=jdump(detail),
        ref_type=ref_type,
        ref_id=ref_id,
    )
    session.add(entry)
    if commit:
        session.commit()
    return entry


def activity_payload(entry):
    """Serialize an ActivityLog row into the dict shape returned by the API."""
    detail = jload(entry.detail) or {}
    return {
        "id": entry.id,
        "dataset_id": entry.dataset_id,
        "kind": entry.kind,
        "category": detail.get("category") or entry.kind,
        "action_type": detail.get("action_type") or entry.kind,
        "summary": entry.summary,
        "detail": detail,
        "ref_type": entry.ref_type,
        "ref_id": entry.ref_id,
        "related_stage_id": entry.ref_id if entry.ref_type == "stage" else detail.get("related_stage_id"),
        "related_analysis_id": entry.ref_id if entry.ref_type == "analysis" else detail.get("related_analysis_id"),
        "related_model_id": entry.ref_id if entry.ref_type == "model" else detail.get("related_model_id"),
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
    }
