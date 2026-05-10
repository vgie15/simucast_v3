"""
Report builder route + every text-generation helper used by the report.

Assembles dataset, tests, models, AI explanations, and activity documentation
into a structured report payload the React frontend renders or exports.
"""
import uuid
from datetime import datetime

from flask import Blueprint, jsonify, request

from backend.database import db, ActivityLog, Analysis, Dataset, Model
from backend.utils import clean_json, jdump, jload
from backend.activity import activity_payload, log_activity
from backend.auth_helpers import _auth_from_request, _report_account_required_response


bp = Blueprint("report", __name__)


# ===========================================================================
# SECTION: REPORT GENERATION
# Keywords: report, build report, generate report, export, pdf, html, summary, sections
# ===========================================================================
# ANCHOR: Report: Generate Report (Build Report)
@bp.route("/api/datasets/<ds_id>/report", methods=["POST"])
def build_report(ds_id):
    """Assemble analyses into a report JSON the frontend can render/export."""
    body = request.get_json() or {}
    sections = body.get("sections") or ["summary", "descriptives", "tests", "models"]
    s = db()
    try:
        sess, user = _auth_from_request(s)
        limited = _report_account_required_response(s)
        if limited:
            return limited
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        current_stage_id = ds.current_stage_id or "original"
        analyses = [
            a for a in s.query(Analysis).filter_by(dataset_id=ds_id).order_by(Analysis.created_at).all()
            if (jload(a.config) or {}).get("stage_id") == current_stage_id
        ]
        models = s.query(Model).filter_by(dataset_id=ds_id).order_by(Model.created_at).all()
        activity = [
            a for a in s.query(ActivityLog).filter_by(dataset_id=ds_id).order_by(ActivityLog.created_at).all()
            if a.kind not in {"ai", "note"} and (jload(a.detail) or {}).get("category") != "ai"
        ]

        report = {
            "title": ds.name,
            "generated_at": datetime.utcnow().isoformat(),
            "dataset": {
                "name": ds.name,
                "rows": ds.row_count,
                "columns": ds.col_count,
            },
            "sections": [],
        }
        latest_describe = next((a for a in reversed(analyses) if a.kind == "describe"), None)
        tests_ = [a for a in analyses if a.kind.startswith("test_")]
        ai_explanations = [a for a in analyses if a.kind == "ai_explanation"]

        if "summary" in sections:
            report["sections"].append({
                "title": "Executive summary",
                "body": _auto_summary(ds, analyses, models),
            })
        if "descriptives" in sections:
            if latest_describe:
                descriptive_result = jload(latest_describe.result)
                report["sections"].append({
                    "title": "Descriptive insights",
                    "body": _describe_report_text(descriptive_result),
                    "data": descriptive_result,
                })
        if "tests" in sections:
            if tests_:
                report["sections"].append({
                    "title": "Statistical analysis interpretation",
                    "body": _tests_report_text(tests_),
                    "items": [{"kind": a.kind, "config": jload(a.config), "result": jload(a.result), "summary": _test_report_line(a)} for a in tests_],
                })
                report["sections"].append({
                    "title": "Simple predictive insights",
                    "body": _predictive_insights_text(tests_),
                })
        if "models" in sections and models:
            report["sections"].append({
                "title": "Model performance",
                "body": _models_report_text(models),
                "items": [{
                    "name": m.name,
                    "algorithm": m.algorithm,
                    "target": m.target,
                    "metrics": jload(m.metrics),
                    "feature_influence": jload(m.feature_importance),
                    "summary": _model_report_line(m),
                } for m in models],
            })
            report["sections"].append({
                "title": "Key influencing factors",
                "body": _feature_influence_report_text(models),
            })
        if "ai_interpretation" in sections:
            report["sections"].append(_ai_explanations_report_section(ai_explanations))
        if "documentation" in sections:
            report["sections"].append({
                "title": "Appendix: Project actions",
                "body": _documentation_summary_text(activity),
                "items": [activity_payload(a) for a in activity],
            })
        report_artifact_id = None
        if user:
            report_artifact_id = str(uuid.uuid4())
            report["artifact_id"] = report_artifact_id
            s.add(Analysis(
                id=report_artifact_id,
                dataset_id=ds_id,
                kind="report",
                config=jdump(clean_json({"sections": sections})),
                result=jdump(clean_json(report)),
            ))
        log_activity(
            s,
            ds_id,
            "report",
            "Generated report",
            detail={
                "category": "report",
                "action_type": "generate_report",
                "sections": sections,
                "persisted": bool(user),
            },
            ref_type="analysis" if report_artifact_id else None,
            ref_id=report_artifact_id,
        )
        return jsonify(clean_json(report))
    finally:
        s.close()


def _auto_summary(ds, analyses, models):
    """Compose the executive-summary paragraph for the report."""
    bits = [f"This report summarizes the analysis of {ds.name}, a dataset with {ds.row_count} rows and {ds.col_count} variables."]
    des = next((a for a in reversed(analyses) if a.kind == "describe"), None)
    if des:
        stats_rows = (jload(des.result) or {}).get("stats") or []
        nums = [r for r in stats_rows if r.get("kind") == "numeric"]
        cats = [r for r in stats_rows if r.get("kind") == "categorical"]
        if nums or cats:
            bits.append(f"The descriptive review includes {len(nums)} numeric and {len(cats)} categorical variable summaries.")
    if models:
        best = _best_model(models)
        metrics = jload(best.metrics) or {}
        if metrics.get("auc") is not None:
            bits.append(f"The strongest saved model is {best.algorithm} for {best.target}, with AUC={metrics['auc']:.3f}.")
        elif metrics.get("accuracy") is not None:
            bits.append(f"The strongest saved model is {best.algorithm} for {best.target}, with accuracy={metrics['accuracy']:.1%}.")
        elif metrics.get("r2") is not None:
            bits.append(f"The strongest saved model is {best.algorithm} for {best.target}, explaining about {metrics['r2']:.1%} of observed variation.")
    sig_tests = [a for a in analyses if a.kind.startswith("test_") and (jload(a.result) or {}).get("significant")]
    if sig_tests:
        bits.append(f"{len(sig_tests)} statistical analysis result(s) found statistically significant evidence at p < 0.05.")
    elif any(a.kind.startswith("test_") for a in analyses):
        bits.append("The recorded statistical analyses did not find strong statistical evidence at p < 0.05.")
    bits.append("Detailed project actions are placed in the appendix so the main report stays focused on findings and interpretation.")
    return " ".join(bits)


def _ai_explanations_report_section(explanations):
    """Build the 'AI interpretation' section from saved Analysis rows."""
    saved = []
    for item in explanations[-8:]:
        cfg = jload(item.config) or {}
        result = jload(item.result) or {}
        text = (result.get("explanation") or "").strip()
        if not text or not result.get("include_in_report"):
            continue
        saved.append({
            "kind": cfg.get("step") or "AI explanation",
            "summary": text,
            "result": {"interpretation": text},
            "created_at": item.created_at.isoformat() if item.created_at else None,
        })
    if not saved:
        return {
            "title": "AI interpretation",
            "body": "No saved AI explanations are available yet. Use AI explain on result cards to include those explanations in future reports.",
            "items": [],
        }
    body = "Saved AI explanations from result cards are included below so the report can reuse the interpretations already generated during analysis."
    return {
        "title": "AI interpretation",
        "body": body,
        "items": saved,
    }


def _shorten(text, limit=240):
    """Collapse whitespace and truncate text to ``limit`` characters with an ellipsis."""
    text = " ".join(str(text or "").split())
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def _describe_report_text(result):
    """Render the descriptive-statistics result into a bullet-list narrative."""
    rows = (result or {}).get("stats") or []
    nums = [r for r in rows if r.get("kind") == "numeric"]
    cats = [r for r in rows if r.get("kind") == "categorical"]
    lines = []
    if nums:
        skewed = sorted(nums, key=lambda r: abs(float(r.get("skew") or 0)), reverse=True)
        variable = sorted(nums, key=lambda r: _spread_score(r), reverse=True)
        symmetric = [r for r in nums if abs(float(r.get("skew") or 0)) < 0.5]
        lines.append(f"Numeric variables summarized: {', '.join(str(r.get('variable')) for r in nums[:6])}.")
        if symmetric:
            lines.append(f"{symmetric[0]['variable']} is approximately symmetric (skew={_fmt(symmetric[0].get('skew'))}).")
        if skewed and abs(float(skewed[0].get("skew") or 0)) >= 1:
            lines.append(f"{skewed[0]['variable']} is the most skewed numeric variable, so median and quartiles should be considered alongside the mean.")
        if variable:
            lines.append(f"{variable[0]['variable']} shows the highest relative variability among the summarized numeric variables.")
    if cats:
        dominant = sorted(cats, key=lambda r: (r.get("freq") or 0) / max(r.get("n") or 1, 1), reverse=True)
        top = dominant[0]
        lines.append(f"{top['variable']} is led by {top.get('top')} ({_pct(top.get('freq'), top.get('n'))} of valid rows).")
    if not lines:
        lines.append("No descriptive analysis has enough result detail for interpretation yet.")
    return "\n".join(f"- {line}" for line in lines)


def _tests_report_text(tests):
    """Bullet list summarizing the most recent tests."""
    lines = [_test_report_line(a) for a in tests[-5:]]
    lines = [line for line in lines if line]
    return "\n".join(f"- {line}" for line in lines) if lines else "No statistical analyses have been recorded yet."


def _test_report_line(analysis):
    """One-line natural-language summary of an Analysis row."""
    kind = analysis.kind.replace("test_", "")
    cfg = jload(analysis.config) or {}
    r = jload(analysis.result) or {}
    sig = r.get("significant")
    decision = "reject the null hypothesis" if sig else "fail to reject the null hypothesis" if sig is not None else "review the relationship"
    if kind == "corr":
        pair = r.get("strongest_pair") or {}
        if pair:
            direction = "positive" if pair.get("r", 0) >= 0 else "negative"
            return f"Correlation: {pair.get('var_a')} and {pair.get('var_b')} show the strongest {direction} relationship (r={_fmt(pair.get('r'))}, p={_fmt(pair.get('p'))})."
        return "Correlation: no pairwise relationship could be summarized."
    if kind == "chi":
        return f"Chi-square: {cfg.get('var_a')} and {cfg.get('var_b')} lead to the decision to {decision} (p={_fmt(r.get('p'))}, Cramer's V={_fmt(r.get('cramers_v'))})."
    if kind == "t":
        return f"t-test: {cfg.get('measure')} differs by {cfg.get('group')} with decision to {decision} (p={_fmt(r.get('p'))}, Cohen's d={_fmt(r.get('cohens_d'))})."
    if kind == "anova":
        return f"ANOVA: {cfg.get('measure')} across {cfg.get('group')} groups leads to the decision to {decision} (p={_fmt(r.get('p'))}, eta squared={_fmt(r.get('eta_squared'))})."
    return r.get("interpretation") or f"{analysis.kind} was run."


def _predictive_insights_text(tests):
    """Translate test results into qualitative directional insights."""
    lines = []
    for a in tests[-6:]:
        kind = a.kind.replace("test_", "")
        cfg = jload(a.config) or {}
        r = jload(a.result) or {}
        if kind == "corr":
            pair = r.get("strongest_pair") or {}
            if pair:
                tendency = "increase" if pair.get("r", 0) >= 0 else "decrease"
                lines.append(f"As {pair.get('var_a')} increases, {pair.get('var_b')} tends to {tendency} in the observed data.")
        elif kind == "t":
            labels = r.get("group_labels") or ["Group 1", "Group 2"]
            higher = labels[0] if (r.get("mean_group_1") or 0) >= (r.get("mean_group_2") or 0) else labels[1]
            lines.append(f"{higher} has the higher observed average {cfg.get('measure')}; this is a group-based pattern, not a full predictive model.")
        elif kind == "anova":
            means = r.get("group_means") or {}
            if means:
                higher = max(means, key=means.get)
                lines.append(f"{higher} has the highest observed average {cfg.get('measure')} among {cfg.get('group')} categories.")
        elif kind == "chi":
            lines.append(f"The contingency table for {cfg.get('var_a')} and {cfg.get('var_b')} supports probability-style comparisons by category.")
    if not lines:
        lines.append("Run correlation, group-comparison, or chi-square tests to generate non-model predictive insights.")
    return "\n".join(f"- {line}" for line in lines[:5])


def _models_report_text(models):
    """Summarize trained models including health diagnostics + CV metrics."""
    best = _best_model(models)
    metrics = jload(best.metrics) or {}
    health = metrics.get("health_diagnostics") or {}
    lines = [f"{len(models)} model run(s) are included in this report."]
    if metrics.get("task") == "classification":
        auc = f" and AUC={_fmt(metrics.get('auc'))}" if metrics.get("auc") is not None else ""
        lines.append(f"Best recorded model: {best.algorithm} predicting {best.target}, with accuracy={_pct_float(metrics.get('accuracy'))}{auc}.")
        if metrics.get("train_accuracy") is not None:
            lines.append(
                f"Train/test comparison: train accuracy={_pct_float(metrics.get('train_accuracy'))}, "
                f"test accuracy={_pct_float(metrics.get('accuracy'))}, gap={_pct_float(abs(float(metrics.get('generalization_gap') or 0)))}."
            )
    elif metrics.get("task") == "regression":
        lines.append(f"Best recorded model: {best.algorithm} predicting {best.target}, with R2={_fmt(metrics.get('r2'))} and RMSE={_fmt(metrics.get('rmse'))}.")
        if metrics.get("train_r2") is not None:
            lines.append(
                f"Train/test comparison: train R2={_fmt(metrics.get('train_r2'))}, "
                f"test R2={_fmt(metrics.get('r2'))}, gap={_fmt(abs(float(metrics.get('generalization_gap') or 0)))}."
            )
    if health:
        lines.append(f"Model health: {health.get('label', 'Reviewed')} - {health.get('summary', 'Train/test health was evaluated.')}")
        fixes = [f.get("label") for f in (health.get("recommended_fixes") or []) if isinstance(f, dict) and f.get("label")]
        if fixes:
            lines.append("Recommended follow-up actions: " + ", ".join(fixes[:4]) + ".")
    cv = metrics.get("cross_validation") or {}
    if cv.get("enabled"):
        if cv.get("available"):
            label = "accuracy" if cv.get("metric") == "accuracy" else "R2"
            score = _pct_float(cv.get("mean")) if cv.get("metric") == "accuracy" else _fmt(cv.get("mean"))
            spread = _pct_float(cv.get("std")) if cv.get("metric") == "accuracy" else _fmt(cv.get("std"))
            lines.append(f"Cross-validation: mean {label}={score} with fold variation of {spread}.")
        else:
            lines.append(f"Cross-validation was requested but unavailable: {cv.get('reason', 'not enough data for stable folds')}.")
    lines.append("Model metrics should be interpreted together with data preparation, target cleanliness, and test-set size.")
    return "\n".join(f"- {line}" for line in lines)


def _model_report_line(model):
    """One-line summary of a single saved model."""
    metrics = jload(model.metrics) or {}
    health = metrics.get("health_diagnostics") or {}
    health_text = f" Model health: {health.get('label')}." if health.get("label") else ""
    if metrics.get("task") == "classification":
        auc = f" and AUC={_fmt(metrics.get('auc'))}" if metrics.get("auc") is not None else ""
        return f"{model.algorithm} predicted {model.target} with accuracy={_pct_float(metrics.get('accuracy'))}{auc}.{health_text}"
    if metrics.get("task") == "regression":
        return f"{model.algorithm} predicted {model.target} with R2={_fmt(metrics.get('r2'))} and RMSE={_fmt(metrics.get('rmse'))}.{health_text}"
    return f"{model.algorithm} model for {model.target}.{health_text}"


def _feature_influence_report_text(models):
    """Pull the top influencing features from the best model for the report."""
    best = _best_model(models)
    influence = jload(best.feature_importance) or []
    if isinstance(influence, dict):
        influence = [{"feature": k, "strength": v} for k, v in influence.items()]
    influence = sorted(influence, key=lambda x: float(x.get("strength") or x.get("relative_strength") or 0), reverse=True)
    if not influence:
        return "Feature influence is not available for the saved models."
    top = [item for item in influence[:5] if item.get("feature")]
    if not top:
        return "Feature influence is not available for the saved models."
    lines = [f"For the strongest saved model ({best.algorithm}), the leading influencing factor is {top[0].get('feature')}."]
    lines.append("Top factors: " + ", ".join(item.get("feature") for item in top) + ".")
    lines.append("These values are model-derived influence summaries, not proof of causation.")
    return "\n".join(f"- {line}" for line in lines)


def _documentation_summary_text(activity):
    """Stage/test/model action counts for the documentation appendix."""
    if not activity:
        return "No project actions were recorded."
    counts = {}
    for entry in activity:
        detail = jload(entry.detail) or {}
        key = detail.get("step_type") or detail.get("category") or entry.kind
        counts[key] = counts.get(key, 0) + 1
    summary = ", ".join(f"{k}: {v}" for k, v in counts.items())
    return f"The appendix contains the project action trail for reproducibility. Summary by type: {summary}."


def _best_model(models):
    """Return the highest-scoring model from a list (auc → accuracy → r2)."""
    def score(model):
        """Pick the primary metric (auc / accuracy / r2) used to rank a model."""
        m = jload(model.metrics) or {}
        if m.get("task") == "classification":
            return m.get("auc") if m.get("auc") is not None else m.get("accuracy") or 0
        if m.get("task") == "regression":
            return m.get("r2") if m.get("r2") is not None else -1e9
        return -1e9
    return max(models, key=score)


def _spread_score(row):
    """Coefficient of variation-like score used to rank descriptive numeric rows."""
    span = abs(float(row.get("max") or 0) - float(row.get("min") or 0)) or 1
    return abs(float(row.get("std") or 0)) / span


def _fmt(value):
    """Format a float to 3 decimals, or 'n/a' when the value is None."""
    if value is None:
        return "n/a"
    try:
        return f"{float(value):.3f}"
    except Exception:
        return str(value)


def _pct(count, total):
    """Render count/total as a percentage with one decimal."""
    if not total:
        return "0.0%"
    return f"{float(count or 0) / float(total) * 100:.1f}%"


def _pct_float(value):
    """Format a 0..1 metric as a percentage with one decimal."""
    if value is None:
        return "n/a"
    return f"{float(value):.1%}"


def _old_auto_summary(ds, analyses, models):
    """Legacy summary text generator kept for reference / fallback callers."""
    bits = [f"Analysis of {ds.name} ({ds.row_count} rows, {ds.col_count} variables)."]
    if models:
        latest = models[-1]
        metrics = jload(latest.metrics) or {}
        if metrics.get("auc"):
            bits.append(f"Best model ({latest.algorithm}) achieves AUC={metrics['auc']:.3f} predicting {latest.target}.")
        elif metrics.get("r2") is not None:
            bits.append(f"Best model ({latest.algorithm}) achieves R²={metrics['r2']:.3f} predicting {latest.target}.")
    sig_tests = [a for a in analyses if a.kind.startswith("test_") and (jload(a.result) or {}).get("significant")]
    if sig_tests:
        bits.append(f"{len(sig_tests)} statistical analyses returned significant results (p < 0.05).")
    return " ".join(bits)
