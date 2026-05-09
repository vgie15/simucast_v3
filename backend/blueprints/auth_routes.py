"""
Authentication routes: guest sessions, signup, login, logout, account edits.

These endpoints only touch the User / UserSession tables and the Dataset
ownership cleanup helper; they don't reach into any other domain modules.
"""
import re
import uuid
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from backend.database import (
    db, ActivityLog, AIResponse, Analysis, Dataset, DatasetStage,
    Model, User, UserSession,
)
from backend.utils import _new_token
from backend.auth_helpers import (
    _auth_from_request, _client_guest_slot_used, _session_payload,
)


bp = Blueprint("auth_routes", __name__)


# ===========================================================================
# SECTION: AUTHENTICATION
# Keywords: auth, login, signup, logout, account, password, guest, session, user
# ===========================================================================
# ANCHOR: Auth: Guest Session (Temporary Account)
@bp.route("/api/auth/guest", methods=["POST"])
def create_guest_session():
    """Create or refresh a temporary guest session token."""
    s = db()
    try:
        client_used = _client_guest_slot_used()
        sess, user = _auth_from_request(s)
        if sess:
            if sess.is_guest and client_used and int(sess.guest_usage_count or 0) < 1:
                sess.guest_usage_count = 1
                s.commit()
            return jsonify({"session": _session_payload(sess, user)})
        sess = UserSession(
            id=str(uuid.uuid4()),
            token=_new_token(),
            is_guest=1,
            guest_usage_count=1 if client_used else 0,
            expires_at=datetime.utcnow() + timedelta(days=14),
        )
        s.add(sess)
        s.commit()
        return jsonify({"session": _session_payload(sess)})
    finally:
        s.close()

# ANCHOR: Auth: Signup / Create Account
@bp.route("/api/auth/signup", methods=["POST"])
def signup():
    """Create a new User + initial logged-in session."""
    body = request.get_json() or {}
    full_name = (body.get("full_name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        return {"error": "enter a valid email address"}, 400
    if len(password) < 8:
        return {"error": "password must be at least 8 characters"}, 400
    s = db()
    try:
        existing = s.query(User).filter_by(email=email).first()
        if existing:
            return {"error": "email already registered"}, 409
        user = User(
            id=str(uuid.uuid4()),
            email=email,
            full_name=full_name or None,
            password_hash=generate_password_hash(password),
        )
        sess = UserSession(
            id=str(uuid.uuid4()),
            user_id=user.id,
            token=_new_token(),
            is_guest=0,
            guest_usage_count=0,
            expires_at=datetime.utcnow() + timedelta(days=30),
        )
        s.add(user)
        s.add(sess)
        s.commit()
        return jsonify({"session": _session_payload(sess, user)})
    finally:
        s.close()

# ANCHOR: Auth: Login
@bp.route("/api/auth/login", methods=["POST"])
def login():
    """Verify credentials and create a new session token."""
    body = request.get_json() or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    s = db()
    try:
        user = s.query(User).filter_by(email=email).first()
        if not user or not check_password_hash(user.password_hash, password):
            return {"error": "invalid email or password"}, 401
        sess = UserSession(
            id=str(uuid.uuid4()),
            user_id=user.id,
            token=_new_token(),
            is_guest=0,
            guest_usage_count=0,
            expires_at=datetime.utcnow() + timedelta(days=30),
        )
        s.add(sess)
        s.commit()
        return jsonify({"session": _session_payload(sess, user)})
    finally:
        s.close()

# ANCHOR: Auth: Current User Info
@bp.route("/api/auth/me", methods=["GET"])
def auth_me():
    """Return the session payload for the bearer token, or 401."""
    s = db()
    try:
        sess, user = _auth_from_request(s)
        if not sess:
            return {"session": None}, 401
        return jsonify({"session": _session_payload(sess, user)})
    finally:
        s.close()

# ANCHOR: Auth: Logout
@bp.route("/api/auth/logout", methods=["POST"])
def logout():
    """Drop the current session row so the bearer token is invalidated."""
    s = db()
    try:
        sess, _ = _auth_from_request(s)
        if sess:
            s.delete(sess)
            s.commit()
        return {"ok": True}
    finally:
        s.close()

# ANCHOR: Auth: Update Account Details
@bp.route("/api/account", methods=["PATCH"])
def update_account():
    """Update the current user's email / full name."""
    body = request.get_json() or {}
    full_name = (body.get("full_name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        return {"error": "enter a valid email address"}, 400
    s = db()
    try:
        sess, user = _auth_from_request(s)
        if not sess or sess.is_guest or not user:
            return {"error": "account required", "auth_required": True}, 403
        existing = s.query(User).filter(User.email == email, User.id != user.id).first()
        if existing:
            return {"error": "email already registered"}, 409
        user.email = email
        user.full_name = full_name or None
        s.commit()
        return jsonify({"session": _session_payload(sess, user)})
    finally:
        s.close()

# ANCHOR: Auth: Change Password
@bp.route("/api/account/password", methods=["POST"])
def change_account_password():
    """Verify the current password and rotate the user's password hash."""
    body = request.get_json() or {}
    current_password = body.get("current_password") or ""
    new_password = body.get("new_password") or ""
    if len(new_password) < 8:
        return {"error": "new password must be at least 8 characters"}, 400
    s = db()
    try:
        sess, user = _auth_from_request(s)
        if not sess or sess.is_guest or not user:
            return {"error": "account required", "auth_required": True}, 403
        if not check_password_hash(user.password_hash, current_password):
            return {"error": "current password is incorrect"}, 400
        user.password_hash = generate_password_hash(new_password)
        # Invalidate other sessions after a password change.
        s.query(UserSession).filter(UserSession.user_id == user.id, UserSession.id != sess.id).delete(synchronize_session=False)
        s.commit()
        return jsonify({"ok": True, "session": _session_payload(sess, user)})
    finally:
        s.close()

# ANCHOR: Auth: Delete Account
@bp.route("/api/account", methods=["DELETE"])
def delete_account():
    """Wipe the user, their datasets, and every derived artifact."""
    body = request.get_json() or {}
    password = body.get("password") or ""
    s = db()
    try:
        sess, user = _auth_from_request(s)
        if not sess or sess.is_guest or not user:
            return {"error": "account required", "auth_required": True}, 403
        if not check_password_hash(user.password_hash, password):
            return {"error": "password is incorrect"}, 400
        dataset_ids = [row.id for row in s.query(Dataset.id).filter_by(user_id=user.id).all()]
        _delete_account_artifacts(s, user.id, dataset_ids)
        s.delete(user)
        s.commit()
        return jsonify({"ok": True})
    finally:
        s.close()

def _delete_account_artifacts(session, user_id, dataset_ids):
    """Cascade-delete every row owned by this user's datasets and sessions."""
    if dataset_ids:
        session.query(DatasetStage).filter(DatasetStage.dataset_id.in_(dataset_ids)).delete(synchronize_session=False)
        session.query(Analysis).filter(Analysis.dataset_id.in_(dataset_ids)).delete(synchronize_session=False)
        session.query(Model).filter(Model.dataset_id.in_(dataset_ids)).delete(synchronize_session=False)
        session.query(ActivityLog).filter(ActivityLog.dataset_id.in_(dataset_ids)).delete(synchronize_session=False)
        session.query(AIResponse).filter(AIResponse.dataset_id.in_(dataset_ids)).delete(synchronize_session=False)
        session.query(Dataset).filter(Dataset.id.in_(dataset_ids)).delete(synchronize_session=False)
    session.query(AIResponse).filter_by(user_id=user_id).delete(synchronize_session=False)
    session.query(UserSession).filter_by(user_id=user_id).delete(synchronize_session=False)
