"""
Anthropic Claude wrappers used across the AI routes.

Holds the lazy SDK client constructor, the dataset-profile builder used as a
cacheable prompt prefix, the JSON-mode parser, and ``ai_call`` itself. Both
the AI blueprint and the project-plan helpers depend on this module.
"""
import json
import os
import re

import numpy as np
import pandas as pd

from backend.config import _AI_MODEL_FAST, _AI_MODEL_DEEP


def _ai_client():
    """Return an Anthropic client if the SDK + key are available, else None."""
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return None
    try:
        import anthropic  # local import keeps optional dep optional
    except ImportError:
        return None
    return anthropic.Anthropic(api_key=key)


def _dataset_profile(ds, df, variables, max_unique=8):
    cols = []
    for v in variables or []:
        col = {
            "name": v["name"],
            "dtype": v.get("dtype"),
            "missing": v.get("missing"),
            "unique": v.get("unique"),
        }
        if v["name"] in df.columns:
            series = df[v["name"]]
            present = series.dropna()
            if v.get("dtype") in ("category", "binary") and len(present):
                vc = present.value_counts().head(max_unique)
                col["top_values"] = [
                    {"value": _ai_safe(k), "count": int(c)} for k, c in vc.items()
                ]
            elif v.get("dtype") in ("numeric", "int", "float", "binary") and len(present):
                num = pd.to_numeric(present, errors="coerce").dropna()
                if len(num):
                    col["min"] = float(num.min())
                    col["max"] = float(num.max())
                    col["mean"] = round(float(num.mean()), 4)
        cols.append(col)
    return {
        "name": ds.name,
        "description": ds.description,
        "filename": ds.filename,
        "row_count": int(len(df)),
        "col_count": int(len(df.columns)),
        "columns": cols,
    }


def _ai_safe(v):
    """Coerce a numpy/pandas scalar into something json.dumps will accept."""
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)


def ai_call(profile, user_prompt, system=None, model=_AI_MODEL_FAST, max_tokens=1024, json_mode=False):
    """Make an AI call with the dataset profile cached as a prompt prefix.

    Returns the text response (or a dict if json_mode=True). Raises a clear
    error when the SDK / key is missing so the route can surface 503.
    """
    client = _ai_client()
    if client is None:
        raise RuntimeError("AI assistant unavailable: set ANTHROPIC_API_KEY on the API service")

    sys_blocks = []
    if system:
        sys_blocks.append({"type": "text", "text": system})
    sys_blocks.append({
        "type": "text",
        "text": "Dataset profile (use as the source of truth):\n" + json.dumps(profile, default=str),
        "cache_control": {"type": "ephemeral"},
    })
    if json_mode:
        sys_blocks.append({
            "type": "text",
            "text": "Respond with a single JSON object only — no prose, no markdown fences.",
        })

    msg = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=sys_blocks,
        messages=[{"role": "user", "content": user_prompt}],
    )
    text = "".join(block.text for block in msg.content if getattr(block, "type", None) == "text")
    if json_mode:
        return _parse_ai_json(text)
    return text


def _parse_ai_json(text):
    """Extract a JSON object from a model response that may include code fences or prose."""
    s = (text or "").strip()
    # Strip ```json ... ``` or ``` ... ``` fences if the whole reply is fenced.
    if s.startswith("```"):
        s = re.sub(r"^```(?:json|JSON)?\s*\n?", "", s)
        s = re.sub(r"\n?```\s*$", "", s).strip()
    candidates = [s]
    start = s.find("{")
    end = s.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidates.append(s[start : end + 1])
    arr_start = s.find("[")
    arr_end = s.rfind("]")
    if arr_start != -1 and arr_end != -1 and arr_end > arr_start:
        candidates.append('{"steps": ' + s[arr_start : arr_end + 1] + "}")

    last_error = None
    for candidate in candidates:
        repaired = candidate.strip()
        repaired = repaired.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
        repaired = re.sub(r",\s*([}\]])", r"\1", repaired)
        try:
            return json.loads(repaired)
        except Exception as exc:
            last_error = exc
    err = ValueError(f"AI returned invalid JSON: {last_error}")
    err.raw_response = text
    raise err
