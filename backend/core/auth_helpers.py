"""
Auth/session helpers shared by routes.

Resolves the bearer token / X-SimuCast-Session header, scopes dataset queries
to the caller, and produces the standard 403 responses for guest / report /
AI-account limits.
"""
from datetime import datetime

from flask import request
from sqlalchemy import func

from backend.database import Dataset, Model, User, UserSession
from backend.config import GUEST_MODEL_LIMIT


def _session_payload(sess, user=None):
    """Public-facing description of a session for the frontend auth panel."""
    return {
        "token": sess.token,
        "user_id": sess.user_id,
        "email": user.email if user else None,
        "full_name": user.full_name if user else None,
        "is_guest": bool(sess.is_guest),
        "usage_count": int(sess.guest_usage_count or 0),
        "limit": 1 if sess.is_guest else None,
        "model_usage_count": int(getattr(sess, "guest_model_usage_count", 0) or 0),
        "model_limit": GUEST_MODEL_LIMIT if sess.is_guest else None,
        "expires_at": sess.expires_at.isoformat() if sess.expires_at else None,
    }


def _auth_from_request(session):
    """Resolve (UserSession, User) for the current request, or (None, None)."""
    auth = request.headers.get("Authorization") or ""
    token = None
    if auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()
    token = token or request.headers.get("X-SimuCast-Session")
    if not token:
        return None, None
    sess = session.query(UserSession).filter_by(token=token).first()
    if not sess:
        return None, None
    if sess.expires_at and sess.expires_at < datetime.utcnow():
        return None, None
    user = session.query(User).filter_by(id=sess.user_id).first() if sess.user_id else None
    return sess, user


def _dataset_scope(query, session):
    """Restrict a Dataset query to rows the caller is allowed to see."""
    sess, user = _auth_from_request(session)
    if not sess:
        return query.filter(False)
    if user:
        return query.filter(Dataset.user_id == user.id)
    return query.filter(Dataset.session_id == sess.id)


def _attach_owner(ds, session):
    """Stamp owning user/session ids on a freshly-created Dataset."""
    sess, user = _auth_from_request(session)
    if not sess:
        return
    ds.session_id = sess.id
    ds.user_id = user.id if user else None


def _client_guest_slot_used():
    """True when the client signals it has already consumed its 1 guest slot."""
    header = (request.headers.get("X-SimuCast-Guest-Used") or "").strip().lower()
    if header in {"1", "true", "yes"}:
        return True
    body = request.get_json(silent=True) or {}
    return bool(body.get("guest_slot_used"))


def _guest_limit_response(sess):
    """Return a 403 payload when a guest has consumed their one project slot."""
    if sess and sess.is_guest and int(sess.guest_usage_count or 0) >= 1:
        return {
            "error": "Guest mode is limited to one temporary project. Sign up or log in to create saved projects.",
            "auth_required": True,
            "guest_limit": True,
            "session": _session_payload(sess),
        }, 403
    return None


def _ai_account_required_response(session):
    """Return a 403 payload when a non-account caller hits an AI route."""
    sess, user = _auth_from_request(session)
    if not sess or sess.is_guest or not user:
        return {
            "error": "AI features require an account.",
            "auth_required": True,
            "ai_account_required": True,
        }, 403
    return None


def _report_account_required_response(session):
    """Return a 403 payload when a non-account caller asks to build a report."""
    sess, user = _auth_from_request(session)
    if not sess or sess.is_guest or not user:
        return {
            "error": "Create an account to generate and save reports.",
            "auth_required": True,
            "report_account_required": True,
        }, 403
    return None


def _guest_model_limit_response(session, sess, ds_id, requested_count=1):
    """Enforce the cumulative model-training cap for guest sessions."""
    if not sess or not sess.is_guest:
        return None
    used = int(getattr(sess, "guest_model_usage_count", 0) or 0)
    synced = False
    if used < GUEST_MODEL_LIMIT:
        total_models = session.query(func.count(Model.id)).join(Dataset, Model.dataset_id == Dataset.id).filter(Dataset.session_id == sess.id).scalar() or 0
        if total_models > used:
            used = total_models
            sess.guest_model_usage_count = used
            synced = True
    remaining = max(GUEST_MODEL_LIMIT - used, 0)
    if remaining <= 0:
        if synced:
            session.commit()
        return {
            "error": f"Guest mode includes up to {GUEST_MODEL_LIMIT} total model trainings for this temporary session. Deleting models will not reset the limit. Sign up or log in to train more models.",
            "auth_required": True,
            "guest_model_limit": True,
            "model_limit": GUEST_MODEL_LIMIT,
            "models_used": used,
            "models_remaining": 0,
        }, 403
    if requested_count > remaining:
        if synced:
            session.commit()
        return {
            "error": f"Guest mode has {remaining} training attempt{'s' if remaining != 1 else ''} remaining. Select {remaining} or fewer algorithm{'s' if remaining != 1 else ''}, or create an account to train more.",
            "auth_required": True,
            "guest_model_limit": True,
            "model_limit": GUEST_MODEL_LIMIT,
            "models_used": used,
            "models_remaining": remaining,
        }, 403
    if synced:
        session.commit()
    return None
