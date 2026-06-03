"""
AI assistant routes: project plan, recommendations, explanations, chat, suggest.

Each endpoint goes through the cache layer first, falls back to a rule-based
heuristic when no API key is configured, and persists every successful AI
response so we can replay across restarts.
"""
import json
import re
from datetime import datetime

import pandas as pd
from flask import Blueprint, jsonify, request

from backend.core.cache import (
    _AI_CACHE, _ai_cache_key, _ai_db_get, _ai_db_put, _cache_put,
)
from backend.config import _AI_MODEL_FAST
from backend.database import db, AIResponse, Analysis, Dataset
from backend.shared.utils import clean_json, jdump, jload
from backend.core.activity import log_activity
from backend.modules.ai.client import _ai_client, _dataset_profile, ai_call
from backend.core.auth_helpers import (
    _ai_account_required_response, _auth_from_request, _dataset_scope,
)
from backend.shared.dataframe import (
    _current_variables, df_from_dataset,
)
from backend.ml import _capability_text


bp = Blueprint("ai_routes", __name__)


_CHAT_HISTORY_LIMIT = 20


def _plan_prompt_profile(ds, df, variables, session):
    """Augment the dataset profile with extra context the project planner needs."""
    profile = _dataset_profile(ds, df, variables)
    guidance = jload(getattr(ds, "guidance", None)) or {}
    profile["project_goal"] = guidance.get("goal") or guidance.get("intent")
    profile["project_question"] = guidance.get("question_text")
    profile["column_names"] = list(df.columns)
    profile["detected_types"] = {v.get("name"): v.get("dtype") for v in variables or []}
    profile["missing_values"] = {v.get("name"): int(v.get("missing") or 0) for v in variables or []}
    profile["unique_counts"] = {v.get("name"): int(v.get("unique") or 0) for v in variables or []}
    profile["numeric_ranges"] = {}
    for v in variables or []:
        name = v.get("name")
        if name in df.columns and v.get("dtype") in ("numeric", "int", "float", "binary"):
            num = pd.to_numeric(df[name], errors="coerce").dropna()
            if len(num):
                profile["numeric_ranges"][name] = {
                    "min": float(num.min()),
                    "max": float(num.max()),
                    "mean": round(float(num.mean()), 4),
                }
    nums = list(profile["numeric_ranges"].keys())
    profile["correlations"] = []
    if len(nums) >= 2:
        try:
            corr = df[nums].corr(numeric_only=True).abs()
            pairs = []
            for i, a in enumerate(nums):
                for b in nums[i + 1:]:
                    val = corr.loc[a, b]
                    if pd.notna(val):
                        pairs.append({"columns": [a, b], "abs_r": round(float(val), 4)})
            profile["correlations"] = sorted(pairs, key=lambda x: x["abs_r"], reverse=True)[:8]
        except Exception:
            profile["correlations"] = []
    profile["target_candidates"] = [
        v.get("name") for v in variables or []
        if v.get("dtype") in ("binary", "category", "numeric", "int", "float")
        and int(v.get("unique") or 0) > 1
    ][:10]
    try:
        from backend.database import ActivityLog
        logs = (
            session.query(ActivityLog)
            .filter_by(dataset_id=ds.id)
            .order_by(ActivityLog.created_at.desc())
            .limit(12)
            .all()
        )
        profile["previous_completed_actions"] = [
            {
                "kind": log.kind,
                "summary": log.summary,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ]
    except Exception:
        profile["previous_completed_actions"] = []
    from backend.ml import _SIMUCAST_CAPABILITIES
    profile["simucast_supported_capabilities"] = [
        {"category": category, "features": items}
        for category, items in _SIMUCAST_CAPABILITIES
    ]
    return profile


def _parse_ai_plan_text(text):
    """Parse the plain-text guided-plan format Claude returns into step dicts."""
    text = (text or "").strip()
    if not text:
        return []
    blocks = []
    current = []
    for line in text.splitlines():
        if re.match(r"^\s*\d+\.\s+", line) and current:
            blocks.append(current)
            current = [line]
        else:
            current.append(line)
    if current:
        blocks.append(current)

    category_pages = {
        "data preparation": "data",
        "feature engineering": "data",
        "expand": "expand",
        "data expansion": "expand",
        "describe": "describe",
        "analysis": "tests",
        "statistical analysis": "tests",
        "models": "models",
        "model": "models",
        "what-if": "whatif",
        "what if": "whatif",
        "report": "report",
    }
    feature_routes = [
        ("standardize categorical labels", "data", "data-section-category_standardization"),
        ("category standardization", "data", "data-section-category_standardization"),
        ("handle missing values", "data", "fix-cleaning-suggestions"),
        ("handle outliers", "data", "fix-cleaning-suggestions"),
        ("remove duplicates", "data", "fix-cleaning-suggestions"),
        ("drop rows/columns", "data", "data-section-manual_transforms"),
        ("change column type", "data", "data-section-manual_transforms"),
        ("rename columns", "data", "data-section-manual_transforms"),
        ("export cleaned data", "data", "data-section-raw_data"),
        ("create bins", "data", "data-section-feature_engineering"),
        ("numeric formatting", "data", "data-section-feature_engineering"),
        ("decide whether expansion is needed", "expand", "expand-section-controls"),
        ("recommend bootstrap vs synthetic", "expand", "expand-section-controls"),
        ("configure target rows", "expand", "expand-section-controls"),
        ("preview generated rows/stat changes", "expand", "expand-section-controls"),
        ("apply expansion", "expand", "expand-section-controls"),
        ("run descriptive statistics", "describe", "describe-section-variables"),
        ("inspect variable cards", "describe", "describe-section-variables"),
        ("view histogram/distribution", "describe", "describe-section-variables"),
        ("view categorical distribution", "describe", "describe-section-variables"),
        ("view correlation overview", "describe", "describe-section-variables"),
        ("run correlation", "tests", "fix-correlation-test"),
        ("run t-test", "tests", "fix-correlation-test"),
        ("run anova", "tests", "fix-correlation-test"),
        ("run chi-square", "tests", "fix-correlation-test"),
        ("run pca", "tests", "fix-correlation-test"),
        ("run k-means clustering", "tests", "fix-correlation-test"),
        ("select target", "models", "fix-target-handling"),
        ("choose regression/classification algorithms", "models", "fix-target-handling"),
        ("configure validation split", "models", "fix-target-handling"),
        ("review preprocessing plan", "models", "fix-target-handling"),
        ("check multicollinearity", "models", "fix-feature-selection"),
        ("check class balance", "models", "fix-target-handling"),
        ("train models", "models", "fix-target-handling"),
        ("compare metrics", "models", "fix-target-handling"),
        ("inspect feature importance", "models", "fix-feature-selection"),
        ("check model health/overfitting", "models", "fix-target-handling"),
        ("use trained model", "whatif", "whatif-section-controls"),
        ("adjust feature values", "whatif", "whatif-section-controls"),
        ("compare baseline vs current prediction", "whatif", "whatif-section-controls"),
        ("save scenario", "whatif", "whatif-section-controls"),
        ("review extrapolation risk", "whatif", "whatif-section-controls"),
        ("include documentation logs", "report", "ax-report-preview"),
        ("include analysis results", "report", "ax-report-preview"),
        ("include model results", "report", "ax-report-preview"),
        ("include what-if scenarios", "report", "ax-report-preview"),
        ("include selected visualizations", "report", "ax-report-preview"),
        ("generate/export report", "report", "ax-report-preview"),
    ]

    parsed = []
    for idx, block in enumerate(blocks, start=1):
        raw_title = re.sub(r"^\s*\d+\.\s*", "", block[0]).strip()
        fields = {}
        for line in block[1:]:
            match = re.match(r"^\s*([A-Za-z -]+):\s*(.*)$", line.strip())
            if match:
                fields[match.group(1).strip().lower()] = match.group(2).strip()
        title = raw_title or fields.get("title") or f"Step {idx}"
        category = fields.get("category", "").lower()
        use = fields.get("use", "")
        columns = [
            c.strip() for c in re.split(r",|;", fields.get("columns", ""))
            if c.strip() and c.strip().lower() not in {"none", "n/a", "all"}
        ]

        use_text = use.lower()
        page = category_pages.get(category)
        section = ""
        matched_feature = None
        for feature, route_page, route_section in feature_routes:
            if feature in use_text:
                page = route_page
                section = route_section
                matched_feature = feature
                break
        if not matched_feature:
            title_text = title.lower()
            for feature, route_page, route_section in feature_routes:
                if any(part in title_text for part in feature.split("/")[:1]):
                    page = route_page
                    section = route_section
                    matched_feature = feature
                    break
        if not page or not matched_feature:
            continue
        parsed.append({
            "id": f"{page}-{re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-') or idx}",
            "page": page,
            "section": section,
            "title": title,
            "rationale": fields.get("why", ""),
            "priority": "medium",
            "columns": columns,
        })
    return parsed


_GUIDANCE_QUESTION_INTENTS = {
    "prepare_data",
    "analyze_relationships",
    "train_model",
    "compare_models",
    "what_if",
    "report",
    "full_workflow",
}


def _rule_based_guidance_questions(df, variables):
    """Return deterministic starter questions anchored to supported SimuCast paths."""
    variables = variables or []
    names = [v.get("name") for v in variables if v.get("name")]
    numeric = [
        v.get("name") for v in variables
        if v.get("name") and v.get("dtype") in ("numeric", "int", "float")
    ]
    targets = [
        v.get("name") for v in variables
        if v.get("name")
        and v.get("dtype") in ("binary", "category", "numeric", "int", "float")
        and int(v.get("unique") or 0) > 1
    ]
    outcome = targets[-1] if targets else (names[-1] if names else "an outcome")
    measure = numeric[0] if numeric else outcome
    compare = numeric[1] if len(numeric) > 1 else measure
    questions = [
        {
            "question": f"Can I predict {outcome} from the other variables in this dataset?",
            "intent": "train_model",
            "why": "Build a prediction path around a supported target and candidate features.",
        },
        {
            "question": f"Which variables seem most related to {measure}?",
            "intent": "analyze_relationships",
            "why": "Start with summaries and analysis before deciding whether modeling helps.",
        },
        {
            "question": f"How does {measure} compare with {compare} and the category groups in this dataset?",
            "intent": "analyze_relationships",
            "why": "Use descriptive and statistical analysis to check patterns and group differences.",
        },
        {
            "question": f"What could change a prediction for {outcome} in a what-if scenario?",
            "intent": "what_if",
            "why": "Prepare a model first, then test changed feature values.",
        },
    ]
    return {
        "ai": False,
        "summary": f"Starter questions for {len(df)} rows and {len(names)} variables.",
        "suggestions": questions,
    }


def _normalize_guidance_questions(payload, fallback):
    """Keep AI onboarding questions inside supported intent and text bounds."""
    suggestions = []
    for item in (payload or {}).get("suggestions") or []:
        question = str(item.get("question") or "").strip()
        intent = str(item.get("intent") or "").strip()
        why = str(item.get("why") or item.get("rationale") or "").strip()
        if not question or intent not in _GUIDANCE_QUESTION_INTENTS:
            continue
        suggestions.append({
            "question": question[:240],
            "intent": intent,
            "why": why[:260],
        })
        if len(suggestions) == 4:
            break
    if not suggestions:
        return fallback
    return {
        "ai": True,
        "summary": str((payload or {}).get("summary") or "Dataset-specific questions SimuCast can guide.").strip()[:220],
        "suggestions": suggestions,
    }


def _goal_assistant_fallback(columns=None, user_message=""):
    """Return a deterministic project-goal chat response when AI is unavailable."""
    columns = [str(col).strip() for col in (columns or []) if str(col).strip()]
    text = str(user_message or "").lower()
    target = columns[-1] if columns else "your main outcome"
    first = columns[0] if columns else "one variable"
    second = columns[1] if len(columns) > 1 else target
    if "compare" in text or "group" in text:
        question = f"How does {first} compare across groups in this dataset?"
        why = "This helps you see whether groups behave differently before deciding on prediction."
        workflow = ["Describe", "Analysis", "Report"]
    elif "pattern" in text or "related" in text or "relationship" in text:
        question = f"Which variables seem most related to {target}?"
        why = "This is a practical first goal because SimuCast can summarize columns and check relationships."
        workflow = ["Describe", "Analysis", "Report"]
    elif "not sure" in text or "decide" in text:
        question = f"Can SimuCast find useful patterns around {target}?"
        why = "This keeps the goal broad while still using summaries, analysis, modeling, what-if scenarios, and reports."
        workflow = ["Describe", "Analysis", "Models", "What-if", "Report"]
    else:
        question = f"Can I predict {target} from the other variables in this dataset?"
        why = "This turns the dataset into a clear prediction goal and can lead into what-if testing."
        workflow = ["Describe", "Models", "What-if", "Report"]
    return {
        "message": "Here is a clear goal SimuCast can guide without needing technical setup.",
        "suggestions": [{
            "question": question[:240],
            "why": why[:260],
            "workflow": workflow,
        }],
    }


def _normalize_goal_assistant_response(payload, fallback):
    """Sanitize AI goal assistant JSON before sending it to the UI."""
    message = str((payload or {}).get("message") or fallback.get("message") or "").strip()
    suggestions = []
    allowed = {"Describe", "Analysis", "Models", "What-if", "Report"}
    for item in (payload or {}).get("suggestions") or []:
        question = str(item.get("question") or "").strip()
        why = str(item.get("why") or item.get("rationale") or "").strip()
        workflow = [
            str(step).strip()
            for step in (item.get("workflow") or [])
            if str(step).strip() in allowed
        ]
        if not question:
            continue
        suggestions.append({
            "question": question[:240],
            "why": (why or "This gives SimuCast a concrete goal to guide.").strip()[:260],
            "workflow": workflow or ["Describe", "Analysis", "Report"],
        })
        if len(suggestions) == 2:
            break
    if not suggestions:
        suggestions = fallback.get("suggestions") or []
    return {
        "message": (message or "Here is a goal SimuCast can help with.")[:360],
        "suggestions": suggestions,
    }


# ===========================================================================
# SECTION: AI FEATURES - PLAN, RECOMMEND, EXPLAIN, CHAT, SUGGEST
# Keywords: ai, claude, anthropic, project plan, recommend, explain, chat, suggest, llm
# ===========================================================================
# ANCHOR: AI: Goal Assistant Chat
@bp.route("/api/describe/ai_goal_suggest", methods=["POST"])
def ai_goal_suggest():
    """Mini project-goal consultant for the Project Start modal."""
    body = request.get_json() or {}
    user_message = str(body.get("user_message") or "").strip()
    columns = body.get("columns") or []
    history = body.get("conversation_history") or []
    fallback = _goal_assistant_fallback(columns, user_message)
    client = _ai_client()
    if client is None:
        return jsonify(fallback)
    safe_history = []
    for item in history[-10:]:
        role = "assistant" if item.get("role") == "assistant" else "user"
        content = str(item.get("content") or "").strip()
        if content:
            safe_history.append({"role": role, "content": content[:500]})
    profile = {
        "columns": [str(col)[:120] for col in columns[:80]],
        "conversation_history": safe_history,
        "simucast_capabilities": [
            "regression modeling",
            "classification modeling",
            "descriptive statistics",
            "correlation and relationship analysis",
            "group comparison",
            "what-if scenario testing",
            "report generation",
        ],
    }
    system = (
        "You are an AI goal assistant inside SimuCast, a machine learning platform "
        "for non-technical users. Help the user choose a clear project goal from "
        "their dataset columns. Keep responses short, friendly, and plain English. "
        "Avoid technical jargon. Mention SimuCast capabilities naturally when useful: "
        "descriptive statistics, relationship analysis, modeling, what-if scenarios, "
        "and report generation."
    )
    prompt = (
        "The user has uploaded a dataset with these columns: "
        f"{', '.join([str(col) for col in columns[:80]]) or 'unknown columns'}.\n"
        f"User message: {user_message or 'Suggest a useful goal.'}\n"
        "Suggest 1-2 specific questions they could answer with this dataset. "
        "For each suggestion include the question, why it is useful in plain English, "
        "and the recommended SimuCast workflow using only this subset: "
        "Describe, Analysis, Models, What-if, Report. "
        'Respond as JSON: {"message": str, "suggestions": [{"question": str, "why": str, "workflow": [str]}]}'
    )
    try:
        payload = ai_call(profile, prompt, system=system, json_mode=True, max_tokens=700)
        return jsonify(clean_json(_normalize_goal_assistant_response(payload, fallback)))
    except Exception as exc:
        print(f"AI goal assistant failed: {exc}", flush=True)
        return jsonify(fallback)


# ANCHOR: AI: Suggest Guidance Questions
@bp.route("/api/datasets/<ds_id>/ai/guidance_questions", methods=["POST"])
def ai_guidance_questions(ds_id):
    """Suggest dataset-specific questions for the post-upload guided start."""
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)
        variables = _current_variables(ds, s)
        fallback = _rule_based_guidance_questions(df, variables)
        blocked = _ai_account_required_response(s)
        if blocked:
            return blocked

        cache_key = _ai_cache_key(ds_id, ds.current_stage_id, "guidance_questions", {"version": 1})
        cached = _AI_CACHE.get(cache_key) or _ai_db_get(s, cache_key)
        if cached is not None:
            return jsonify(cached)
        if _ai_client() is None:
            return jsonify(fallback)

        profile = _plan_prompt_profile(ds, df, variables, s)
        system = (
            "You suggest starter analytics questions for SimuCast users. "
            "Use only supported SimuCast paths. Do not invent analysis features, "
            "targets, or actions. Prefer plain user language over statistics jargon."
        )
        prompt = (
            "Suggest exactly 4 concise questions this user could reasonably ask "
            "about the dataset. Each question must map to one supported intent: "
            "prepare_data, train_model, compare_models, what_if, report, or full_workflow. "
            "Use train_model only for prediction questions, what_if only when a model "
            "prerequisite path makes sense, and prepare_data only for cleanup intent. "
            'Respond as JSON: {"summary": str, "suggestions": [{"question": str, '
            '"intent": "prepare_data|train_model|compare_models|what_if|report|full_workflow", "why": str}]}'
        )
        try:
            payload = ai_call(profile, prompt, system=system, json_mode=True, max_tokens=900)
            response = _normalize_guidance_questions(payload, fallback)
            _cache_put(_AI_CACHE, cache_key, response)
            _, user = _auth_from_request(s)
            _ai_db_put(
                s,
                dataset_id=ds_id,
                stage_id=ds.current_stage_id,
                user_id=user.id if user else None,
                kind="guidance_questions",
                context="project_start",
                cache_key=cache_key,
                request={"version": 1},
                response=response,
                model=_AI_MODEL_FAST,
            )
            return jsonify(clean_json(response))
        except Exception as exc:
            print(f"AI guidance question suggestion failed: {exc}", flush=True)
            return jsonify(fallback)
    finally:
        s.close()


# ANCHOR: AI: Generate Project Plan
@bp.route("/api/datasets/<ds_id>/ai/project_plan", methods=["POST"])
def ai_project_plan(ds_id):
    """Generate an end-to-end guided workflow plan for the current dataset stage."""
    body = request.get_json() or {}
    mode = (body.get("mode") or "auto").lower()
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds, s)
        variables = _current_variables(ds, s)
        guidance = jload(getattr(ds, "guidance", None)) or {}
        project_goal = guidance.get("goal") or guidance.get("intent")
        project_question = guidance.get("question_text")
        profile = _plan_prompt_profile(ds, df, variables, s)
        if mode == "system":
            return jsonify(_rule_based_project_plan(df, variables, project_goal, project_question))
        blocked = _ai_account_required_response(s)
        if blocked:
            return blocked

        cache_key = _ai_cache_key(ds_id, ds.current_stage_id, "project_plan", {
            "mode": mode,
            "goal": project_goal,
            "question": project_question,
            "plan_version": 5,
        })
        cached = _AI_CACHE.get(cache_key) or _ai_db_get(s, cache_key)
        if cached is not None:
            return jsonify(cached)

        client = _ai_client()
        if client is None:
            return jsonify(_rule_based_project_plan(df, variables, project_goal, project_question))

        system = (
            "You are SimuCast's project guide. Create an ordered analytics plan "
            "for a non-expert user. The plan must be actionable inside SimuCast, "
            "use exact column names, and avoid vague steps. Keep each action "
            "short. All string fields must be plain text — no markdown "
            "headings, tables, code fences, or bold/italic."
        )
        system += (
            " SimuCast capabilities and route targets: "
            "Data page can use section fix-cleaning-suggestions for grouped missing-value, "
            "outlier, duplicate, and suggested data fixes; section data-section-category_standardization "
            "for categorical label review and standardization; section data-section-manual_transforms "
            "for manual transforms and lightweight feature engineering. "
            "Expand page can use section expand-section-controls for row expansion. "
            "Describe page can use section describe-section-variables for descriptive statistics, "
            "distributions, charts, and variable summaries. "
            "Analysis page uses backend page value tests and section fix-correlation-test for "
            "correlation, group comparison, chi-square, and advanced analysis setup. "
            "Models page can use section fix-target-handling for target setup and section "
            "fix-feature-selection for feature selection/model preparation. "
            "What-if page can use section whatif-section-controls for saved model scenarios. "
            "Report page can use section ax-report-preview for report generation and preview. "
            "Only recommend actions this system can actually perform."
        )
        prompt = (
            "Analyze the dataset profile and create a guided project plan across "
            "the SimuCast workflow: data preparation, optional expansion, description, "
            "statistical analysis, modeling, what-if analysis, and report. Include only steps that make "
            "sense for this dataset. Sort the steps in workflow order only: "
            "data, expand if needed, describe, tests, models, whatif, report. "
            "Do not sort by priority. Each step must include: id, page "
            "(data|expand|describe|tests|models|whatif|report), title, rationale, "
            "priority (high|medium|low), optional columns, and optional section id when obvious. "
            "Use exact section ids from the capability list when possible. "
            'Respond as JSON: {"summary": str, "steps": [{"id": str, "page": str, "section": str, "title": str, "rationale": str, "priority": "high|medium|low", "columns": [str]}]}'
        )
        system = (
            "You are SimuCast's project guide. Recommend a concise, ordered workflow "
            "for a non-expert user. Only recommend features SimuCast supports. "
            "Do not invent pages, buttons, tools, algorithms, reports, or actions. "
            "Keep the Guided Plan high-level; method choices such as mean vs median, "
            "cap vs remove, and exact bin labels belong inside the relevant SimuCast card, "
            "not in this plan. Use exact column names from the dataset profile."
        )
        prompt = (
            "Create a SimuCast Guided Plan using only this capability list:\n\n"
            f"{_capability_text()}\n\n"
            "Use this exact plain text format. Do not use JSON, markdown tables, or code fences.\n"
            "1. Step title\n"
            "Category: Data preparation / Feature engineering / Describe / Analysis / Models / What-if / Report\n"
            "Why: one short reason\n"
            "Use: exact SimuCast feature from the capability list\n"
            "Columns: comma-separated relevant columns, or None\n\n"
            "Rules:\n"
            "- Sort steps in workflow order: Data preparation, optional Feature engineering, optional Expand, Describe, Analysis, Models, What-if, Report.\n"
            "- Inside Data preparation, follow the UI order: manual transforms, missing values, outliers, duplicates, category standardization, optional feature tools.\n"
            "- Inside Expand, follow: decide if expansion is needed, choose Bootstrap or Synthetic, configure target rows, preview, apply.\n"
            "- Inside Describe, follow: select variables, generate summaries, review visualizations, review correlations, explain findings.\n"
            "- Inside Analysis, follow: choose/recommend test, choose valid column pair, configure test, run test, explain results.\n"
            "- Inside Models, follow: select target, select features, configure preprocessing, select algorithm, train, review metrics/model health, optional tuning.\n"
            "- Inside What-if, follow: use trained model, adjust feature values, generate prediction, explain prediction, save/compare scenarios.\n"
            "- Recommend high-level workflow steps only.\n"
            "- Do not include method-level choices such as mean, median, mode, IQR cap, remove rows, or bin labels.\n"
            "- Prefer 5 to 8 steps.\n"
            f"- Prioritize the user's selected project intent: {project_goal or 'not selected yet'}.\n"
            f"- If a project question is present in the profile, shape the high-level workflow toward that question without inventing tools.\n"
            "- If previous completed actions already cover a step, recommend the next useful step instead."
        )
        try:
            text = ai_call(profile, prompt, system=system, json_mode=False, max_tokens=1400)
            steps = _parse_ai_plan_text(text)
            steps = _filter_project_steps_for_dataset(steps, df, variables)
            steps = _filter_project_steps_for_goal(steps, _effective_project_goal(project_goal, project_question))
            response = {
                "ai": True,
                "summary": f"AI suggested workflow for {len(df)} rows and {len(variables)} variables.",
                "steps": _normalize_project_steps(steps),
            }
            if not response["steps"]:
                print("AI project plan raw response:", (text or "")[:4000], flush=True)
                raise ValueError("AI project plan returned no usable steps")
            _cache_put(_AI_CACHE, cache_key, response)
            _, user = _auth_from_request(s)
            _ai_db_put(s, dataset_id=ds_id, stage_id=ds.current_stage_id,
                       user_id=user.id if user else None, kind="project_plan",
                       context=mode, cache_key=cache_key,
                       request={"mode": mode}, response=response, model=_AI_MODEL_FAST)
            return jsonify(clean_json(response))
        except Exception as e:
            print(f"AI project plan failed: {e}", flush=True)
            raw = getattr(e, "raw_response", None)
            if raw:
                print("AI project plan raw response:", raw[:4000], flush=True)
            fallback = _rule_based_project_plan(df, variables, project_goal, project_question)
            fallback["error"] = "AI plan unavailable. Using built-in guided workflow."
            return jsonify(fallback)
    finally:
        s.close()


# ANCHOR: AI: Recommend Next Step
@bp.route("/api/datasets/<ds_id>/ai/recommend", methods=["POST"])
def ai_recommend(ds_id):
    """Context-aware AI recommendations for a page (data / tests / models / expand).

    Returns a structured object the UI can render directly. Falls back to a
    rule-based stub when the Anthropic key isn't configured so the panel
    still shows something useful.
    """
    body = request.get_json() or {}
    context = (body.get("context") or "data").lower()
    s = db()
    try:
        blocked = _ai_account_required_response(s)
        if blocked:
            return blocked
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404

        # Cache lookup: same dataset stage + same context = same answer.
        # Skips a paid AI call when the user revisits the same page.
        cache_key = _ai_cache_key(ds_id, ds.current_stage_id, "recommend", {"context": context})
        cached = _AI_CACHE.get(cache_key) or _ai_db_get(s, cache_key)
        if cached is not None:
            return jsonify(cached)

        df = df_from_dataset(ds, s)
        variables = _current_variables(ds, s)
        profile = _dataset_profile(ds, df, variables)

        client = _ai_client()
        if client is None:
            return jsonify(_rule_based_recommend(context, df, variables))

        system = (
            "You are SimuCast's data-analysis assistant. You help non-experts "
            "understand their dataset and decide the next step. Be concise, "
            "concrete, and reference column names exactly as given. When you "
            "recommend an action, explain WHY in one short sentence. All "
            "string fields must be plain text — no markdown headings, tables, "
            "code fences, or bold/italic."
        )
        prompts = {
            "data": (
                "Look at the dataset profile and produce up to 6 recommendations "
                "covering: (a) cleaning fixes that would matter most, (b) useful "
                "column merges or feature engineering, (c) interesting questions "
                "the user could answer with this data. "
                'Respond as JSON: {"summary": str, "recommendations": [{"title": str, "rationale": str, "category": "clean|merge|expand|analyze|model"}]}'
            ),
            "tests": (
                "Recommend up to 4 statistical tests appropriate for this dataset. "
                "For each: name the test, the variables it would use (by exact column name), and a one-sentence rationale. "
                'Respond as JSON: {"recommendations": [{"test": str, "variables": [str], "rationale": str}]}'
            ),
            "models": (
                "Recommend up to 4 candidate target variables and the modeling "
                "task type (classification / regression) for each. For each "
                "target, list the algorithms you would try and any preprocessing "
                "the user must understand (scaling, encoding, leakage risks). "
                'Respond as JSON: {"recommendations": [{"target": str, "task": "classification|regression", "algorithms": [str], "preprocessing": [str], "leakage_risks": [str], "rationale": str}]}'
            ),
            "expand": (
                "The dataset is small. Recommend a row-synthesis approach "
                "(bootstrap vs synthetic) and a target row count, with the "
                "trade-offs spelled out. "
                'Respond as JSON: {"method": "bootstrap|synthetic", "target_rows": int, "rationale": str, "warnings": [str]}'
            ),
            "describe": (
                "Describe this dataset in plain text. Write one sentence about "
                "the apparent subject/domain (what the data is about). Then list "
                "3–6 short bullets naming the notable feature groups present (use "
                "exact column-name groupings or topical clusters). Then one short "
                "data-quality note (imbalance, missing %, suspicious values). "
                "Total 50–80 words across all fields. No markdown, headings, "
                "tables, code fences, bold or italic. "
                'Respond as JSON: {"subject": str, "feature_groups": [str], "quality_note": str}'
            ),
            "clean": (
                "Recommend up to 5 cleaning actions, ordered by impact. For each: "
                "the action (impute, drop, recode, standardize, clip), the column "
                "it applies to, and a one-sentence rationale referencing the "
                "actual numbers (missing %, cardinality, etc). "
                'Respond as JSON: {"recommendations": [{"title": str, "action": "impute|drop|recode|standardize|clip", "column": str, "rationale": str, "category": "clean"}]}'
            ),
            "whatif": (
                "The user is exploring scenarios on a trained model. Suggest up "
                "to 4 scenarios worth running given the columns available — each "
                "should change one or two inputs in a way that would meaningfully "
                "test the model. "
                'Respond as JSON: {"recommendations": [{"title": str, "rationale": str, "category": "whatif", "changes": [{"column": str, "direction": "increase|decrease|set", "amount": str}]}]}'
            ),
            "report": (
                "Write an executive summary of the analysis pipeline so far for "
                "a non-technical stakeholder. Cover: what the data is, what was "
                "done to it, the headline finding, and the main caveats. Then "
                "list up to 4 next steps. "
                'Respond as JSON: {"summary": str, "recommendations": [{"title": str, "rationale": str, "category": "next-step"}]}'
            ),
        }
        prompt = prompts.get(context, prompts["data"])
        try:
            payload = ai_call(profile, prompt, system=system, json_mode=True, max_tokens=1500)
            response = {"context": context, "ai": True, **payload}
            _cache_put(_AI_CACHE, cache_key, response)  # only cache successful AI calls
            _, user = _auth_from_request(s)
            _ai_db_put(s, dataset_id=ds_id, stage_id=ds.current_stage_id,
                       user_id=user.id if user else None, kind="recommend",
                       context=context, cache_key=cache_key,
                       request={"context": context}, response=response, model=_AI_MODEL_FAST)
            return jsonify(response)
        except Exception as e:
            print(f"AI recommend failed: {e}", flush=True)
            fallback = _rule_based_recommend(context, df, variables)
            fallback["error"] = "AI recommendations unavailable. Using built-in guidance."
            return jsonify(fallback)
    finally:
        s.close()


def _saved_ai_explanation(session, ds_id, cache_key):
    """Look up a previously-stored AI explanation for this cache key."""
    rows = (
        session.query(Analysis)
        .filter_by(dataset_id=ds_id, kind="ai_explanation")
        .order_by(Analysis.created_at.desc())
        .limit(80)
        .all()
    )
    for row in rows:
        cfg = jload(row.config) or {}
        if cfg.get("cache_key") == cache_key:
            result = jload(row.result) or {}
            return {
                "analysis_id": row.id,
                "ai": result.get("ai", True),
                "explanation": result.get("explanation") or "",
                "incomplete": bool(result.get("incomplete")),
                "include_in_report": bool(result.get("include_in_report")),
            }
    return None


def _ai_text_looks_incomplete(text):
    """Best-effort guard for AI text that stopped mid-sentence."""
    value = str(text or "").strip()
    if len(value) < 40:
        return False
    last = value[-1]
    if last in ".!?)]}\"'":
        return False
    if last in ",;:-":
        return True
    tail = re.sub(r"[^A-Za-z ]+", " ", value[-120:]).strip().lower().split()
    if not tail:
        return False
    dangling = {
        "a", "an", "and", "are", "as", "at", "because", "but", "by", "for",
        "from", "if", "in", "into", "is", "like", "look", "of", "on", "or",
        "since", "that", "the", "then", "to", "when", "where", "while", "with",
    }
    if tail[-1] in dangling:
        return True
    starters = ("first", "second", "third", "next", "finally")
    return len(tail) <= 8 and tail[0].rstrip(",") in starters


def _store_ai_explanation(session, ds_id, cache_key, step, params, question, source_result, explanation, is_ai, stage_id, include_in_report=False, incomplete=False):
    """Persist an AI explanation as an Analysis row keyed by cache_key."""
    existing = _saved_ai_explanation(session, ds_id, cache_key)
    if existing:
        if include_in_report and not existing.get("include_in_report"):
            row = session.query(Analysis).filter_by(id=existing.get("analysis_id"), dataset_id=ds_id, kind="ai_explanation").first()
            if row:
                result = jload(row.result) or {}
                result["include_in_report"] = True
                row.result = jdump(clean_json(result))
                session.commit()
        return existing.get("analysis_id")
    a = Analysis(
        dataset_id=ds_id,
        kind="ai_explanation",
        config=jdump({
            "cache_key": cache_key,
            "stage_id": stage_id,
            "step": step,
            "params": params,
            "question": question,
        }),
        result=jdump({
            "ai": bool(is_ai),
            "explanation": explanation,
            "source_result": source_result,
            "incomplete": bool(incomplete),
            "include_in_report": bool(include_in_report),
        }),
    )
    session.add(a)
    session.commit()
    return a.id


# ANCHOR: AI: Explain Result
@bp.route("/api/datasets/<ds_id>/ai/explain", methods=["POST"])
def ai_explain(ds_id):
    """Free-form 'explain this' for a step the UI is showing the user.

    Body: {step: str, params: dict, result: dict?, question: str?}
    `result` carries the computed payload the UI is displaying (test stats,
    model metrics, scenario prediction, …) so the model can interpret the
    actual numbers, not just the inputs.
    """
    body = request.get_json() or {}
    step = body.get("step") or "step"
    params = body.get("params") or {}
    result = body.get("result")
    include_in_report = bool(body.get("include_in_report"))
    question = body.get("question") or "Explain what this step does and what to look out for."
    s = db()
    try:
        blocked = _ai_account_required_response(s)
        if blocked:
            return blocked
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404

        # Cache lookup: same dataset stage + same step + same inputs = same answer.
        # The step (e.g. "test-t"), params (which columns), and result (the actual
        # numbers) all matter — change any one of them and we re-ask the API.
        cache_key = _ai_cache_key(
            ds_id, ds.current_stage_id, "explain",
            {"step": step, "params": params, "result": result, "question": question},
        )
        cached = _AI_CACHE.get(cache_key)
        if cached is not None:
            cached["incomplete"] = bool(cached.get("incomplete")) or _ai_text_looks_incomplete(cached.get("explanation"))
            return jsonify(cached)

        saved = _saved_ai_explanation(s, ds_id, cache_key)
        if saved is not None:
            if include_in_report and not saved.get("include_in_report"):
                row = s.query(Analysis).filter_by(id=saved.get("analysis_id"), dataset_id=ds_id, kind="ai_explanation").first()
                if row:
                    saved_result = jload(row.result) or {}
                    saved_result["include_in_report"] = True
                    row.result = jdump(clean_json(saved_result))
                    s.commit()
                    saved["include_in_report"] = True
            response = {
                "ai": bool(saved.get("ai", True)),
                "explanation": saved.get("explanation") or "",
                "saved": True,
                "analysis_id": saved.get("analysis_id"),
                "incomplete": bool(saved.get("incomplete")) or _ai_text_looks_incomplete(saved.get("explanation")),
                "include_in_report": bool(saved.get("include_in_report")),
            }
            _cache_put(_AI_CACHE, cache_key, response)
            return jsonify(response)

        df = df_from_dataset(ds, s)
        variables = _current_variables(ds, s)
        profile = _dataset_profile(ds, df, variables)

        client = _ai_client()
        if client is None:
            return jsonify({
                "ai": False,
                "explanation": (
                    f"AI explanations require an ANTHROPIC_API_KEY on the server. "
                    f"Step: {step}. Params: {json.dumps(params, default=str)}."
                ),
                "incomplete": False,
            })

        system = (
            "You are SimuCast's data-analysis assistant. Reply in plain text "
            "only — no markdown headings, tables, code fences, or bold/italic. "
            "Be concise. Reference exact column names from the dataset profile. "
            "When a result is provided, interpret the actual numbers — say what "
            "the values mean and what the user should do next. Keep the answer "
            "concise and complete. Do not exceed 4 short paragraphs. Prefer this "
            "plain structure: What it means, Why it matters, What to do next. "
            "Finish every sentence; do not start a point you cannot complete."
        )
        parts = [f"User is on step '{step}' with params {json.dumps(params, default=str)}."]
        if result is not None:
            parts.append(f"Computed result the UI is showing: {json.dumps(result, default=str)}")
        parts.append(f"Question: {question}")
        parts.append("Keep the explanation under 180 words, complete, and easy for a beginner to read.")
        prompt = "\n".join(parts)
        try:
            text = ai_call(profile, prompt, system=system, max_tokens=450)
            incomplete = _ai_text_looks_incomplete(text)
            if incomplete:
                print(
                    f"AI explain may be incomplete: ds={ds_id} stage={ds.current_stage_id} "
                    f"step={step} chars={len(str(text or ''))} tail={str(text or '')[-120:]!r}",
                    flush=True,
                )
            analysis_id = _store_ai_explanation(
                s,
                ds_id,
                cache_key,
                step,
                params,
                question,
                result,
                text,
                True,
                ds.current_stage_id,
                include_in_report,
                incomplete,
            )
            response = {
                "ai": True,
                "explanation": text,
                "saved": True,
                "analysis_id": analysis_id,
                "incomplete": bool(incomplete),
                "include_in_report": bool(include_in_report),
            }
            _cache_put(_AI_CACHE, cache_key, response)  # only cache successful AI calls
            return jsonify(response)
        except Exception as e:
            print(f"AI explain failed: {e}", flush=True)
            return jsonify({"ai": False, "explanation": "AI explanation unavailable right now. You can continue with the built-in interpretation and try again later.", "incomplete": False})
    finally:
        s.close()


# ANCHOR: AI: Toggle 'Include in Report'
@bp.route("/api/datasets/<ds_id>/ai/explanations/<analysis_id>/report", methods=["PATCH"])
def set_ai_explanation_report(ds_id, analysis_id):
    """Toggle whether a saved AI explanation should be included in the report."""
    body = request.get_json() or {}
    include = bool(body.get("include", True))
    s = db()
    try:
        blocked = _ai_account_required_response(s)
        if blocked:
            return blocked
        row = s.query(Analysis).filter_by(id=analysis_id, dataset_id=ds_id, kind="ai_explanation").first()
        if not row:
            return {"error": "AI explanation not found"}, 404
        result = jload(row.result) or {}
        result["include_in_report"] = include
        row.result = jdump(clean_json(result))
        s.commit()
        return jsonify({"analysis_id": analysis_id, "include_in_report": include})
    finally:
        s.close()


# ANCHOR: AI: Get Chat History
@bp.route("/api/datasets/<ds_id>/ai/chat", methods=["GET"])
def ai_chat_history(ds_id):
    """Return the full project-chat transcript for the dataset."""
    s = db()
    try:
        blocked = _ai_account_required_response(s)
        if blocked:
            return blocked
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        rows = (
            s.query(AIResponse)
            .filter_by(dataset_id=ds_id, kind="chat")
            .order_by(AIResponse.created_at.asc())
            .all()
        )
        messages = []
        for r in rows:
            payload = jload(r.response) if isinstance(r.response, str) else r.response
            req = jload(r.request) if isinstance(r.request, str) else r.request
            content = (payload or {}).get("content") if r.role == "assistant" else (req or {}).get("content")
            messages.append({
                "id": r.id,
                "role": r.role,
                "content": content or "",
                "created_at": r.created_at.isoformat() if r.created_at else None,
            })
        return jsonify({"messages": messages})
    finally:
        s.close()

# ANCHOR: AI: Send Chat Message
@bp.route("/api/datasets/<ds_id>/ai/chat", methods=["POST"])
def ai_chat_send(ds_id):
    """Send one chat turn. Persists the user message, calls Claude with the
    last N turns + dataset profile, persists the assistant reply, returns it."""
    body = request.get_json() or {}
    message = (body.get("message") or "").strip()
    active_tab = (body.get("context") or "data").lower()
    if not message:
        return {"error": "empty message"}, 400
    s = db()
    try:
        blocked = _ai_account_required_response(s)
        if blocked:
            return blocked
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404

        _, user = _auth_from_request(s)
        user_id = user.id if user else None

        user_row = _chat_response_row(
            ds,
            user_id=user_id,
            role="user",
            context=active_tab,
            content=message,
        )
        user_created_at = datetime.utcnow()
        user_row.created_at = user_created_at

        assistant_text = "I could not reach the project assistant service right now. Your message was received, but the server could not finish the AI turn. Please try again in a moment."
        assistant_is_persisted = False

        try:
            s.add(user_row)
            s.commit()
        except Exception as e:
            s.rollback()
            print(f"AI chat user-message persist failed: {e}", flush=True)

        try:
            client = _ai_client()
            if client is None:
                assistant_text = "AI chat needs ANTHROPIC_API_KEY set on the server."
            else:
                history = (
                    s.query(AIResponse)
                    .filter_by(dataset_id=ds_id, kind="chat")
                    .order_by(AIResponse.created_at.asc())
                    .all()
                )
                history = history[-(_CHAT_HISTORY_LIMIT + 1):]
                messages = []
                for r in history:
                    if r.role not in ("user", "assistant"):
                        continue
                    payload = jload(r.response) if isinstance(r.response, str) else r.response
                    req = jload(r.request) if isinstance(r.request, str) else r.request
                    content = (payload or {}).get("content") if r.role == "assistant" else (req or {}).get("content")
                    if content:
                        messages.append({"role": r.role, "content": content})
                if not messages or messages[-1].get("role") != "user":
                    messages.append({"role": "user", "content": message})

                df = df_from_dataset(ds, s)
                variables = _current_variables(ds, s)
                profile = _dataset_profile(ds, df, variables)
                chat_system = (
                    "You are SimuCast's data-analysis chat assistant. Reply in plain "
                    "text only - no markdown headings, tables, code fences, or "
                    "bold/italic. Be concise. Reference exact column names from the "
                    "dataset profile. If past messages referenced columns that no "
                    "longer exist in the current profile, update your guidance "
                    f"accordingly. The user is currently on the '{active_tab}' tab."
                )
                assistant_text = _ai_chat_call(client, messages, system=chat_system, profile=profile)
        except Exception as e:
            s.rollback()
            print(f"AI chat turn failed: {e}", flush=True)
            assistant_text = f"The assistant could not finish this turn ({e.__class__.__name__}). Please try again, or continue using the project tools while I recover."

        assistant_row = _chat_response_row(
            ds,
            user_id=user_id,
            role="assistant",
            context=active_tab,
            content=assistant_text,
        )
        try:
            s.add(assistant_row)
            s.commit()
            assistant_is_persisted = True
        except Exception as e:
            s.rollback()
            print(f"AI chat assistant persist failed: {e}", flush=True)

        return jsonify({
            "user": {
                "id": user_row.id,
                "role": "user",
                "content": message,
                "created_at": user_row.created_at.isoformat() if user_row.created_at else user_created_at.isoformat(),
            },
            "assistant": {
                "id": assistant_row.id,
                "role": "assistant",
                "content": assistant_text,
                "created_at": assistant_row.created_at.isoformat() if assistant_row.created_at else datetime.utcnow().isoformat(),
            },
            "persisted": assistant_is_persisted,
        })
    except Exception as e:
        s.rollback()
        print(f"AI chat request failed: {e}", flush=True)
        return jsonify({"error": "The assistant could not process this project chat request.", "detail": e.__class__.__name__}), 500
    finally:
        s.close()

def _chat_response_row(ds, *, user_id, role, context, content):
    """Build a (not-yet-persisted) AIResponse row for one chat turn."""
    return AIResponse(
        dataset_id=ds.id,
        stage_id=ds.current_stage_id,
        user_id=user_id,
        kind="chat",
        role=role,
        context=context,
        request=clean_json({"content": content}) if role == "user" else None,
        response=clean_json({"content": content}) if role == "assistant" else None,
        model=_AI_MODEL_FAST if role == "assistant" else None,
    )


# ANCHOR: AI: Clear Chat History
@bp.route("/api/datasets/<ds_id>/ai/chat", methods=["DELETE"])
def ai_chat_clear(ds_id):
    """Wipe every chat turn for this dataset."""
    s = db()
    try:
        blocked = _ai_account_required_response(s)
        if blocked:
            return blocked
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        s.query(AIResponse).filter_by(dataset_id=ds_id, kind="chat").delete(synchronize_session=False)
        s.commit()
        return jsonify({"ok": True})
    finally:
        s.close()


def _ai_chat_call(client, messages, *, system, profile, model=None, max_tokens=400):
    """Multi-turn chat call. messages = [{role, content}, ...] ending with a user turn."""
    sys_blocks = [
        {"type": "text", "text": system},
        {
            "type": "text",
            "text": "Dataset profile (use as the source of truth):\n" + json.dumps(profile, default=str),
            "cache_control": {"type": "ephemeral"},
        },
    ]
    msg = client.messages.create(
        model=model or _AI_MODEL_FAST,
        max_tokens=max_tokens,
        system=sys_blocks,
        messages=messages or [{"role": "user", "content": "(empty)"}],
    )
    return "".join(b.text for b in msg.content if getattr(b, "type", None) == "text")


def _rule_based_recommend(context, df, variables):
    """Heuristic fallback when no Anthropic key is configured."""
    var_by_name = {v["name"]: v for v in variables}
    nums = [v["name"] for v in variables if v.get("dtype") in ("numeric", "int", "float", "binary")]
    cats = [v["name"] for v in variables if v.get("dtype") == "category"]
    bins = [v["name"] for v in variables if v.get("dtype") == "binary"]
    missing_cols = [v["name"] for v in variables if v.get("missing", 0) > 0]
    if context == "tests":
        recs = []
        if bins and nums:
            recs.append({"test": "Independent t-test", "variables": [bins[0], nums[0]],
                         "rationale": f"Compare mean {nums[0]} between {bins[0]} groups."})
        if len(cats) >= 2:
            recs.append({"test": "Chi-square", "variables": cats[:2],
                         "rationale": "Test independence of two categorical variables."})
        if len(nums) >= 2:
            recs.append({"test": "Pearson correlation", "variables": nums[:2],
                         "rationale": "Check linear association between two numeric variables."})
        return {"context": "tests", "ai": False, "recommendations": recs}
    if context == "models":
        recs = []
        if bins:
            recs.append({"target": bins[0], "task": "classification",
                         "algorithms": ["logistic", "random_forest", "gradient_boosting"],
                         "preprocessing": ["scale numeric features", "one-hot encode categoricals"],
                         "leakage_risks": [], "rationale": f"{bins[0]} is binary — natural classification target."})
        if nums:
            recs.append({"target": nums[-1], "task": "regression",
                         "algorithms": ["linear", "random_forest"],
                         "preprocessing": ["scale numeric features"],
                         "leakage_risks": [], "rationale": f"{nums[-1]} is continuous."})
        return {"context": "models", "ai": False, "recommendations": recs}
    if context == "expand":
        return {"context": "expand", "ai": False, "method": "bootstrap",
                "target_rows": max(500, 2 * len(df)), "rationale": "Bootstrap is fast and assumption-free.",
                "warnings": ["Bootstrap rows are duplicates of originals — don't use for held-out evaluation."]}
    if context == "describe":
        groups = []
        if nums:
            groups.append(f"Numeric measures ({len(nums)} columns)")
        if cats:
            groups.append(f"Categorical attributes ({len(cats)} columns)")
        if bins:
            groups.append(f"Binary flags ({len(bins)} columns)")
        if missing_cols:
            quality = f"{len(missing_cols)} of {len(variables)} columns have missing values."
        else:
            quality = "No missing values detected."
        return {"context": "describe", "ai": False,
                "subject": f"Dataset with {len(df)} rows and {len(variables)} columns.",
                "feature_groups": groups,
                "quality_note": quality}
    if context == "clean":
        recs = []
        for col in missing_cols[:3]:
            recs.append({"title": f"Impute or drop missing '{col}'",
                         "action": "impute", "column": col,
                         "rationale": f"{var_by_name[col]['missing']} rows are blank.",
                         "category": "clean"})
        return {"context": "clean", "ai": False, "recommendations": recs}
    if context == "whatif":
        recs = []
        for col in nums[:3]:
            recs.append({"title": f"Increase '{col}' by 10%",
                         "rationale": "Test sensitivity to a moderate positive shift.",
                         "category": "whatif",
                         "changes": [{"column": col, "direction": "increase", "amount": "10%"}]})
        return {"context": "whatif", "ai": False, "recommendations": recs}
    if context == "report":
        return {"context": "report", "ai": False,
                "summary": f"Dataset has {len(df)} rows and {len(variables)} columns. Configure ANTHROPIC_API_KEY for a full narrative summary.",
                "recommendations": [
                    {"title": "Review missing-value handling", "rationale": "Confirm imputation choices are documented.", "category": "next-step"},
                    {"title": "Validate model on held-out data", "rationale": "Bootstrapped/synthetic rows shouldn't be used for evaluation.", "category": "next-step"},
                ]}
    # default = data
    recs = []
    for col in missing_cols[:3]:
        recs.append({"title": f"Handle missing values in '{col}'",
                     "rationale": f"{var_by_name[col]['missing']} rows are blank.",
                     "category": "clean"})
    if bins and nums:
        recs.append({"title": f"Compare {nums[0]} across {bins[0]} groups",
                     "rationale": "Useful baseline analysis.", "category": "analyze"})
    if bins:
        recs.append({"title": f"Predict {bins[0]} from the other columns",
                     "rationale": "Binary target — good classification candidate.", "category": "model"})
    return {"context": "data", "ai": False,
            "summary": "Heuristic recommendations (no AI key configured).",
            "recommendations": recs}

def _normalize_project_steps(steps):
    """Normalize raw step dicts into the schema the UI expects, sorted by page."""
    valid_pages = {"data", "expand", "describe", "tests", "models", "whatif", "report"}
    page_order = {"data": 0, "expand": 1, "describe": 2, "tests": 3, "models": 4, "whatif": 5, "report": 6}
    page_aliases = {
        "analysis": "tests",
        "test": "tests",
        "statistical_analysis": "tests",
        "what-if": "whatif",
        "what_if": "whatif",
        "scenario": "whatif",
        "scenarios": "whatif",
        "model": "models",
    }
    section_ids = {
        "data": {
            "missing": "fix-cleaning-suggestions",
            "clean": "fix-cleaning-suggestions",
            "suggest": "fix-cleaning-suggestions",
            "outlier": "fix-cleaning-suggestions",
            "duplicate": "fix-cleaning-suggestions",
            "categor": "data-section-category_standardization",
            "standard": "data-section-category_standardization",
            "feature": "data-section-feature_engineering",
            "engineer": "data-section-feature_engineering",
            "bin": "data-section-feature_engineering",
            "format": "data-section-feature_engineering",
            "transform": "data-section-manual_transforms",
            "review": "data-section-raw_data",
            "export": "data-section-raw_data",
        },
        "expand": {"": "expand-section-controls"},
        "describe": {"": "describe-section-variables"},
        "tests": {"": "fix-correlation-test"},
        "models": {
            "feature": "fix-feature-selection",
            "target": "fix-target-handling",
            "": "fix-target-handling",
        },
        "whatif": {"": "whatif-section-controls"},
        "report": {"": "ax-report-preview"},
    }
    def normalize_section(page, raw, step):
        """Map a step's free-form section hint to a known anchor id used by the UI."""
        section = str(raw or "").strip()
        valid = {
            "fix-cleaning-suggestions", "data-section-category_standardization",
            "data-section-manual_transforms", "data-section-feature_engineering",
            "data-section-raw_data", "expand-section-controls",
            "describe-section-variables", "fix-correlation-test",
            "fix-target-handling", "fix-feature-selection",
            "whatif-section-controls", "ax-report-preview",
        }
        if section in valid:
            return section
        text = f"{section} {step.get('id', '')} {step.get('title', '')}".lower()
        for needle, fallback in section_ids.get(page, {}).items():
            if needle == "" or needle in text:
                return fallback
        return section
    def sub_order(step):
        """Sort key that groups related plan steps within a page in a sensible order."""
        text = f"{step.get('section', '')} {step.get('id', '')} {step.get('title', '')}".lower()
        if "raw" in text or "review dataset" in text or "export" in text:
            return 0
        if "manual" in text or "transform" in text or "rename" in text or "drop" in text or "type" in text:
            return 1
        if "missing" in text:
            return 2
        if "outlier" in text:
            return 3
        if "duplicate" in text:
            return 4
        if "clean" in text or "suggest" in text:
            return 5
        if "categor" in text or "standard" in text:
            return 6
        if "feature" in text or "engineer" in text or "bin" in text or "format" in text:
            return 7
        return 8
    out = []
    for idx, raw in enumerate(steps or [], start=1):
        if not isinstance(raw, dict):
            continue
        page = str(raw.get("page") or "data").lower().replace(" ", "_")
        page = page_aliases.get(page, page)
        if page not in valid_pages:
            page = "data"
        title = str(raw.get("title") or raw.get("action") or f"Step {idx}").strip()
        if not title:
            continue
        priority = str(raw.get("priority") or "medium").lower()
        if priority not in {"high", "medium", "low"}:
            priority = "medium"
        out.append({
            "id": str(raw.get("id") or f"{page}-{idx}"),
            "page": page,
            "section": normalize_section(page, raw.get("section"), raw),
            "title": title,
            "rationale": str(raw.get("rationale") or raw.get("summary") or "").strip(),
            "priority": priority,
            "status": str(raw.get("status") or "pending").lower(),
            "columns": [str(c) for c in (raw.get("columns") or []) if c is not None],
            "relatedActivityIds": [str(c) for c in (raw.get("relatedActivityIds") or []) if c is not None],
        })
    return sorted(out, key=lambda step: (page_order.get(step.get("page"), 99), sub_order(step), step.get("id", "")))[:10]

def _category_standardization_columns(df, variables):
    """Return category columns with actual multi-label groups to merge."""
    cols = []
    for var in variables or []:
        col = var.get("name")
        if var.get("dtype") != "category" or col not in df.columns:
            continue
        groups = {}
        for raw in df[col].dropna().astype(str):
            stripped = raw.strip()
            if not stripped:
                continue
            key = re.sub(r"[\s_\-]+", " ", stripped).strip().lower()
            groups.setdefault(key, set()).add(stripped)
        if any(len(values) > 1 for values in groups.values()):
            cols.append(col)
    return cols


def _filter_project_steps_for_dataset(steps, df, variables):
    """Validate AI recommendations against factual dataset state before rendering."""
    variables = variables or []
    missing_cols = {v["name"] for v in variables if int(v.get("missing", 0) or 0) > 0}
    duplicate_count = int(df.duplicated().sum()) if len(df) else 0
    category_cols = set(_category_standardization_columns(df, variables))
    numeric_cols = [v["name"] for v in variables if v.get("dtype") in ("numeric", "int", "float", "binary")]
    outlier_cols = set()
    for col in numeric_cols:
        if col not in df.columns:
            continue
        series = pd.to_numeric(df[col], errors="coerce").dropna()
        if len(series) < 10:
            continue
        q1, q3 = series.quantile([0.25, 0.75])
        iqr = q3 - q1
        if iqr and int(((series < q1 - 1.5 * iqr) | (series > q3 + 1.5 * iqr)).sum()) > 0:
            outlier_cols.add(col)

    filtered = []
    for step in steps or []:
        text = f"{step.get('id', '')} {step.get('title', '')} {step.get('section', '')}".lower()
        if "duplicate" in text and duplicate_count <= 0:
            continue
        if "missing" in text and not missing_cols:
            continue
        if "outlier" in text and not outlier_cols:
            continue
        if ("categor" in text or "standard" in text) and not category_cols:
            continue
        if step.get("page") == "expand" and len(df) >= 500:
            continue
        if "missing" in text:
            step["columns"] = [c for c in (step.get("columns") or []) if c in missing_cols] or list(missing_cols)[:5]
        if "outlier" in text:
            step["columns"] = [c for c in (step.get("columns") or []) if c in outlier_cols] or list(outlier_cols)[:5]
        if "categor" in text or "standard" in text:
            step["columns"] = [c for c in (step.get("columns") or []) if c in category_cols] or list(category_cols)[:5]
        filtered.append(step)
    return filtered

def _effective_project_goal(project_goal=None, project_question=None):
    """Use the user's actual question to narrow broad starter goals."""
    text = str(project_question or "").strip().lower()
    if not text:
        return project_goal
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
    if re.search(r"(factor|affect|relationship|related|correlat|association|associated|difference|compare|trend|pattern|explain|explore)", text):
        return "analyze_relationships"
    return project_goal


def _question_columns(project_question, variables):
    """Return exact dataset columns mentioned in a natural-language question."""
    text = re.sub(r"[^a-z0-9]+", " ", str(project_question or "").lower())
    matches = []
    for variable in variables or []:
        name = variable.get("name")
        if not name:
            continue
        normalized = re.sub(r"[^a-z0-9]+", " ", str(name).lower()).strip()
        compact = re.sub(r"[^a-z0-9]+", "", str(name).lower())
        if normalized and (normalized in text or compact in re.sub(r"[^a-z0-9]+", "", text)):
            matches.append(name)
    return matches


def _rule_based_project_plan(df, variables, project_goal=None, project_question=None):
    """Heuristic project plan used when the AI key is unset or the call fails."""
    effective_goal = _effective_project_goal(project_goal, project_question)
    nums = [v["name"] for v in variables if v.get("dtype") in ("numeric", "int", "float", "binary")]
    cats = _category_standardization_columns(df, variables)
    bins = [v["name"] for v in variables if v.get("dtype") == "binary"]
    mentioned_cols = _question_columns(project_question, variables)
    target_col = mentioned_cols[0] if mentioned_cols else (nums[0] if nums else ((variables[0] or {}).get("name") if variables else None))
    missing_cols = [v["name"] for v in variables if int(v.get("missing", 0) or 0) > 0]
    outlier_cols = []
    for col in nums:
        if col not in df.columns:
            continue
        series = pd.to_numeric(df[col], errors="coerce").dropna()
        if len(series) < 10:
            continue
        q1, q3 = series.quantile([0.25, 0.75])
        iqr = q3 - q1
        if iqr and int(((series < q1 - 1.5 * iqr) | (series > q3 + 1.5 * iqr)).sum()) > 0:
            outlier_cols.append(col)
    duplicate_count = int(df.duplicated().sum()) if len(df) else 0
    steps = []
    if missing_cols:
        steps.append({
            "id": "data-missing-values",
            "page": "data",
            "section": "fix-cleaning-suggestions",
            "title": f"Fix missing values in {', '.join(missing_cols[:3])}",
            "rationale": "Missing values can distort summaries, tests, and model training.",
            "priority": "high",
            "columns": missing_cols[:5],
        })
    if outlier_cols:
        steps.append({
            "id": "data-outliers",
            "page": "data",
            "section": "fix-cleaning-suggestions",
            "title": "Review outliers in numeric columns",
            "rationale": "Extreme values can pull averages and model coefficients away from the typical pattern.",
            "priority": "medium",
            "columns": outlier_cols[:5],
        })
    if duplicate_count:
        steps.append({
            "id": "data-duplicates",
            "page": "data",
            "section": "fix-cleaning-suggestions",
            "title": "Remove exact duplicate rows",
            "rationale": f"{duplicate_count} duplicate row{'s' if duplicate_count != 1 else ''} may overweight repeated records.",
            "priority": "medium",
            "columns": [],
        })
    if cats:
        steps.append({
            "id": "data-category-standardization",
            "page": "data",
            "section": "data-section-category_standardization",
            "title": "Review categorical labels for standardization",
            "rationale": "Consistent labels keep categories from being split incorrectly during tests and modeling.",
            "priority": "high" if len(cats) else "medium",
            "columns": cats[:5],
        })
    if nums and effective_goal != "analyze_relationships":
        steps.append({
            "id": "data-optional-feature-tools",
            "page": "data",
            "section": "data-section-feature_engineering",
            "title": "Optional: review feature tools and numeric formatting",
            "rationale": "Create bins or format numeric precision only when it improves interpretation.",
            "priority": "low",
            "columns": nums[:5],
        })
    if 0 < len(df) < 200 and effective_goal not in {"analyze_relationships", "prepare_data"}:
        steps.append({
            "id": "expand-optional",
            "page": "expand",
            "section": "expand-section-controls",
            "title": "Optional: decide whether to expand the dataset",
            "rationale": "Small datasets can benefit from careful expansion, but preview distribution drift before applying.",
            "priority": "low",
            "columns": [],
        })
    steps.append({
        "id": "describe-overview",
        "page": "describe",
        "title": f"Summarize variables related to {target_col}" if effective_goal == "analyze_relationships" and target_col else "Run descriptive statistics for key variables",
        "rationale": "Check distributions and category balance before interpreting relationships." if effective_goal == "analyze_relationships" else "Start with distributions, averages, and category balance before formal testing.",
        "priority": "medium",
        "columns": (mentioned_cols + nums[:3] + cats[:2])[:5],
    })
    if len(nums) >= 2:
        relationship_cols = (mentioned_cols + [c for c in nums if c not in mentioned_cols])[:5]
        pair = relationship_cols[:2] if len(relationship_cols) >= 2 else nums[:2]
        steps.append({
            "id": "tests-correlation",
            "page": "tests",
            "title": f"Check which variables are most related to {target_col}" if effective_goal == "analyze_relationships" and target_col else f"Check relationships between {nums[0]} and {nums[1]}",
            "rationale": "Use correlation and supported relationship tests to rank likely associations before modeling." if effective_goal == "analyze_relationships" else "Correlation or relationship tests help identify promising predictors.",
            "priority": "high" if effective_goal == "analyze_relationships" else "medium",
            "columns": pair,
        })
    if effective_goal == "analyze_relationships":
        steps.append({
            "id": "report-final",
            "page": "report",
            "title": "Document the strongest relationships",
            "rationale": "Summarize the strongest relationship evidence and any data-quality caveats.",
            "priority": "medium",
            "columns": [target_col] if target_col else [],
        })
    elif bins or nums:
        target = (bins[0] if bins else nums[-1])
        steps.append({
            "id": "models-train",
            "page": "models",
            "title": f"Train candidate models for {target}",
            "rationale": "Compare strict task-appropriate models before using what-if analysis.",
            "priority": "high",
            "columns": [target],
        })
        steps.append({
            "id": "whatif-scenario",
            "page": "whatif",
            "title": "Run a what-if scenario with the best saved model",
            "rationale": "Scenario testing turns model output into a decision-oriented explanation.",
            "priority": "medium",
            "columns": nums[:3],
        })
        steps.append({
            "id": "report-final",
            "page": "report",
            "title": "Generate a report with documentation and insights",
            "rationale": "The report should summarize data prep, tests, models, scenarios, and notes.",
            "priority": "medium",
            "columns": [],
        })
    else:
        steps.append({
            "id": "report-final",
            "page": "report",
            "title": "Generate a report with documentation and insights",
            "rationale": "The report should summarize the useful findings and notes.",
            "priority": "medium",
            "columns": [],
        })
    steps = _filter_project_steps_for_goal(steps, effective_goal)
    goal_summaries = {
        "prepare_data": "Preparation path",
        "analyze_relationships": "Relationship analysis path",
        "train_model": "Prediction path",
        "compare_models": "Model comparison path",
        "what_if": "What-if path",
        "report": "Report path",
        "full_workflow": "Full workflow",
    }
    prefix = goal_summaries.get(effective_goal, "Suggested workflow")
    return {
        "ai": False,
        "summary": f"{prefix} for {len(df)} rows and {len(variables)} variables.",
        "steps": _normalize_project_steps(steps),
    }


def _filter_project_steps_for_goal(steps, goal):
    """Keep deterministic and AI plans focused on the goal selected by the user."""
    allowed_pages = {
        "prepare_data": {"data", "expand", "describe"},
        "analyze_relationships": {"data", "describe", "tests", "report"},
        "train_model": {"data", "expand", "describe", "models"},
        "compare_models": {"data", "expand", "describe", "models"},
        "what_if": {"data", "expand", "models", "whatif"},
        "report": {"data", "describe", "tests", "models", "whatif", "report"},
        "full_workflow": {"data", "expand", "describe", "tests", "models", "whatif", "report"},
    }.get(goal)
    if not allowed_pages:
        return steps
    focused = [step for step in (steps or []) if (step.get("page") or "data") in allowed_pages]
    if goal == "prepare_data":
        return focused[:7]
    if goal == "analyze_relationships":
        return focused[:8]
    if goal == "what_if":
        return focused[:7]
    return focused


# ANCHOR: AI: Suggest Action
@bp.route("/api/datasets/<ds_id>/ai/suggest", methods=["POST"])
def ai_suggest(ds_id):
    """Trivial intent-router that maps a freeform prompt to a SimuCast action."""
    body = request.get_json() or {}
    prompt = (body.get("prompt") or "").lower()
    s = db()
    try:
        blocked = _ai_account_required_response(s)
        if blocked:
            return blocked
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        variables = jload(ds.variables) or []

        # trivial intent router — replace with a real LLM call in prod
        suggestions = []
        if "churn" in prompt or "predict" in prompt or "model" in prompt:
            target = next((v["name"] for v in variables if v["dtype"] == "binary"), None)
            if target:
                suggestions.append({
                    "action": "train_model",
                    "params": {"target": target, "algorithm": "logistic"},
                    "label": f"Train a logistic regression to predict {target}",
                })
        if "compare" in prompt or "group" in prompt or "difference" in prompt:
            suggestions.append({
                "action": "t_test",
                "label": "Run an independent t-test to compare groups",
            })
        if "cluster" in prompt or "segment" in prompt:
            suggestions.append({
                "action": "cluster",
                "params": {"k": 4},
                "label": "Cluster rows into 4 segments via k-means",
            })
        if "describe" in prompt or "summary" in prompt or "overview" in prompt or not suggestions:
            suggestions.append({
                "action": "describe",
                "label": "Generate descriptive statistics for all numeric variables",
            })
        return jsonify({"suggestions": suggestions})
    finally:
        s.close()
