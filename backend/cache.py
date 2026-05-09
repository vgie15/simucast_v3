"""
Process-local caches for parsed DataFrames and AI responses.

Two FIFO-bounded dicts keyed by ``(dataset_id, ...)`` so an upload, sheet swap,
or stage transition can drop only that dataset's entries. Also wraps the
``AIResponse`` table so AI calls survive process restarts.
"""
import hashlib
import json
import uuid

from backend.utils import clean_json, jload
from backend.database import AIResponse
from backend.config import _CACHE_MAX


# --- Simple in-memory caches -------------------------------------------------
# We keep two caches:
#   _DF_CACHE   : parsed DataFrames keyed by (dataset_id, stage_id)
#   _AI_CACHE   : AI responses keyed by a hash of the prompt inputs
#
# Why a plain dict and not Redis/Memcached?
# - This is a single-process Flask app on Render. A dict is enough.
# - One less moving part to deploy and explain.
#
# Why cap the size?
# - A long-running server would otherwise hold every dataset ever uploaded
#   in memory. We cap each cache at _CACHE_MAX entries and drop the oldest
#   one (FIFO) when full. Python 3.7+ dicts keep insertion order, so
#   `next(iter(cache))` gives us the oldest key in O(1).
_DF_CACHE = {}     # {(ds_id, stage_id_or_None): pandas.DataFrame}
_AI_CACHE = {}     # {sha1_hex: response_payload}


def _cache_put(cache, key, value):
    """FIFO insert into a bounded dict cache (refresh order on rewrite)."""
    if key in cache:
        # Refresh insertion order so it isn't evicted as "oldest" yet.
        cache.pop(key)
    cache[key] = value
    while len(cache) > _CACHE_MAX:
        cache.pop(next(iter(cache)))


def _df_cache_key(ds):
    """Cache key for a dataset's currently active stage."""
    return (ds.id, ds.current_stage_id)


def _df_cache_invalidate(ds_id):
    """Drop every cached DataFrame *and* AI response for this dataset.

    Called on any change that affects what we'd send to the AI:
    stage transforms, sheet swaps, restores, resets, deletes.

    Both caches use (ds_id, ...) as the key so we can drop only this
    dataset's entries without disturbing anyone else's cache.
    """
    for key in [k for k in _DF_CACHE if k[0] == ds_id]:
        _DF_CACHE.pop(key, None)
    for key in [k for k in _AI_CACHE if k[0] == ds_id]:
        _AI_CACHE.pop(key, None)


def _ai_cache_hex(cache_key):
    """_ai_cache_key returns a (ds_id, sha1_hex) tuple; the DB column stores
    just the hex. Accept either form."""
    if isinstance(cache_key, tuple):
        return cache_key[1]
    return cache_key


def _ai_db_get(session, cache_key):
    """Look up a previously persisted AI response by cache_key. Returns the
    response payload (dict) or None. Also warms _AI_CACHE on hit so subsequent
    requests in this process skip the DB roundtrip."""
    hex_key = _ai_cache_hex(cache_key)
    if not hex_key:
        return None
    row = (
        session.query(AIResponse)
        .filter_by(cache_key=hex_key)
        .order_by(AIResponse.created_at.desc())
        .first()
    )
    if not row:
        return None
    payload = jload(row.response) if isinstance(row.response, str) else row.response
    if payload is not None:
        _AI_CACHE[cache_key] = payload
    return payload


def _ai_db_put(session, *, dataset_id, stage_id, user_id, kind, context, cache_key, request, response, model):
    """Persist an AI response. Safe to call inside a request handler."""
    try:
        session.add(AIResponse(
            id=str(uuid.uuid4()),
            dataset_id=dataset_id,
            stage_id=stage_id,
            user_id=user_id,
            kind=kind,
            context=context,
            cache_key=_ai_cache_hex(cache_key) if cache_key else None,
            request=clean_json(request) if request is not None else None,
            response=clean_json(response) if response is not None else None,
            model=model,
        ))
        session.commit()
    except Exception as e:
        session.rollback()
        print(f"AI persist failed ({kind}): {e}", flush=True)


def _ai_cache_key(ds_id, stage_id, kind, payload):
    """Build a stable cache key for an AI request.

    Returns a (ds_id, sha1_hex) tuple. Why both?
    - The hash captures stage_id + kind + payload in a fixed-length string,
      so we don't store the raw payload (which can be large) as the key.
    - Keeping ds_id as a separate tuple element lets us filter the cache
      by dataset for invalidation.
    """
    raw = json.dumps(
        {"stage": stage_id, "kind": kind, "payload": payload},
        sort_keys=True,
        default=str,
    )
    return (ds_id, hashlib.sha1(raw.encode("utf-8")).hexdigest())
