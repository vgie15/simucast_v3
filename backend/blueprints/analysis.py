"""
Statistical-analysis routes: describe, t-test / ANOVA / chi-square /
correlation, K-means + PCA, plus a helper to persist Analysis rows.
"""
import numpy as np
import pandas as pd
from flask import Blueprint, jsonify, request

from scipy import stats
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

from backend.database import db, Analysis, Dataset
from backend.utils import _parse_num, clean_json, jdump, jload
from backend.activity import log_activity
from backend.auth_helpers import _dataset_scope
from backend.dataframe_utils import df_from_dataset, numeric_df


bp = Blueprint("analysis", __name__)


# ===========================================================================
# SECTION: DESCRIPTIVE STATISTICS & STATISTICAL TESTS
# Keywords: describe, descriptives, summary, histogram, mean, t-test, anova, chi-square, correlation, pearson
# ===========================================================================
# ANCHOR: Describe: Run Descriptive Statistics
@bp.route("/api/datasets/<ds_id>/describe", methods=["POST"])
def describe(ds_id):
    """Compute descriptive statistics + histogram bins for selected variables."""
    body = request.get_json() or {}
    cols = body.get("variables") or []
    group_by = body.get("group_by")
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds)
        if not cols:
            cols = df.select_dtypes(include=[np.number]).columns.tolist()

        out = []
        for col in cols:
            if col not in df.columns:
                continue
            series = df[col]
            if pd.api.types.is_numeric_dtype(series):
                s_clean = series.dropna()
                out.append({
                    "variable": col,
                    "kind": "numeric",
                    "n": int(s_clean.count()),
                    "mean": float(s_clean.mean()) if len(s_clean) else None,
                    "std": float(s_clean.std()) if len(s_clean) > 1 else None,
                    "min": float(s_clean.min()) if len(s_clean) else None,
                    "q1": float(s_clean.quantile(0.25)) if len(s_clean) else None,
                    "median": float(s_clean.median()) if len(s_clean) else None,
                    "q3": float(s_clean.quantile(0.75)) if len(s_clean) else None,
                    "max": float(s_clean.max()) if len(s_clean) else None,
                    "skew": float(s_clean.skew()) if len(s_clean) > 2 else None,
                    "kurtosis": float(s_clean.kurtosis()) if len(s_clean) > 3 else None,
                })
            else:
                vc = series.value_counts(dropna=True).head(20)
                out.append({
                    "variable": col,
                    "kind": "categorical",
                    "n": int(series.count()),
                    "unique": int(series.nunique()),
                    "top": str(vc.index[0]) if len(vc) else None,
                    "freq": int(vc.iloc[0]) if len(vc) else None,
                    "value_counts": {str(k): int(v) for k, v in vc.items()},
                })

        # histogram data for numeric columns, for charting
        histogram = None
        histograms = {}
        num_cols = [c for c in cols if c in df.columns and pd.api.types.is_numeric_dtype(df[c])]
        for num_col in num_cols:
            s_clean = df[num_col].dropna()
            if len(s_clean):
                counts, bin_edges = np.histogram(s_clean, bins=12)
                histograms[num_col] = {
                    "variable": num_col,
                    "counts": counts.tolist(),
                    "bins": bin_edges.tolist(),
                }
        if histograms:
            first = num_cols[0]
            histogram = histograms.get(first)

        result = {"stats": out, "histogram": histogram, "histograms": histograms}
        _save_analysis(s, ds_id, "describe", body, result)
        return jsonify(clean_json(result))
    finally:
        s.close()

# ANCHOR: Test: Run Statistical Test (t-test/ANOVA/Chi-square/Correlation)
@bp.route("/api/datasets/<ds_id>/test", methods=["POST"])
def run_test(ds_id):
    """Run one of t-test / ANOVA / chi-square / correlation."""
    body = request.get_json() or {}
    kind = body.get("kind", "").replace("analysis_", "")  # 't', 'anova', 'chi', 'corr'
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds)
        result = {}

        if kind == "t":
            group = body["group"]
            measure = body["measure"]
            groups = df[group].dropna().unique()
            if len(groups) != 2:
                return {"error": "t-test needs exactly 2 groups"}, 400
            g1 = df[df[group] == groups[0]][measure].dropna()
            g2 = df[df[group] == groups[1]][measure].dropna()
            t, p = stats.ttest_ind(g1, g2, equal_var=False)
            pooled_std = np.sqrt((g1.var() + g2.var()) / 2)
            d = (g1.mean() - g2.mean()) / pooled_std if pooled_std else 0
            result = {
                "t": float(t), "p": float(p),
                "df": int(len(g1) + len(g2) - 2),
                "cohens_d": float(d),
                "mean_group_1": float(g1.mean()),
                "mean_group_2": float(g2.mean()),
                "group_labels": [str(groups[0]), str(groups[1])],
                "significant": bool(p < 0.05),
                "interpretation": _t_interpret(t, p, g1.mean(), g2.mean(), d, group, measure),
            }
        elif kind == "anova":
            group = body["group"]
            measure = body["measure"]
            labels = df[group].dropna().unique()
            samples = [df[df[group] == g][measure].dropna() for g in labels]
            f, p = stats.f_oneway(*samples)
            grand = df[[group, measure]].dropna()[measure]
            ss_between = sum(len(sample) * (sample.mean() - grand.mean()) ** 2 for sample in samples if len(sample))
            ss_total = sum((grand - grand.mean()) ** 2) if len(grand) else 0
            eta_sq = float(ss_between / ss_total) if ss_total else 0.0
            result = {
                "f": float(f), "p": float(p),
                "groups": len(samples),
                "eta_squared": eta_sq,
                "group_means": {str(label): float(sample.mean()) for label, sample in zip(labels, samples) if len(sample)},
                "significant": bool(p < 0.05),
                "interpretation": _anova_interpret(f, p, len(samples), measure, group),
            }
        elif kind == "chi":
            var_a = body["var_a"]
            var_b = body["var_b"]
            ct = pd.crosstab(df[var_a], df[var_b])
            chi2, p, dof, _ = stats.chi2_contingency(ct)
            n = int(ct.to_numpy().sum())
            min_dim = max(min(ct.shape) - 1, 1)
            cramer_v = float(np.sqrt(chi2 / (n * min_dim))) if n and min_dim else 0.0
            row_pct = ct.div(ct.sum(axis=1).replace(0, np.nan), axis=0).fillna(0) * 100
            result = {
                "chi2": float(chi2), "p": float(p), "df": int(dof),
                "contingency": {str(i): {str(c): int(ct.loc[i, c]) for c in ct.columns} for i in ct.index},
                "row_percentages": {str(i): {str(c): round(float(row_pct.loc[i, c]), 1) for c in row_pct.columns} for i in row_pct.index},
                "cramers_v": cramer_v,
                "significant": bool(p < 0.05),
                "interpretation": _chi_interpret(chi2, p, var_a, var_b),
            }
        elif kind == "corr":
            cols = body.get("variables") or df.select_dtypes(include=[np.number]).columns.tolist()
            corr = df[cols].corr().round(3)
            pairs = []
            for i, a in enumerate(cols):
                for b in cols[i + 1:]:
                    data = df[[a, b]].dropna()
                    if len(data) < 3:
                        continue
                    r_val, p_val = stats.pearsonr(data[a], data[b])
                    pairs.append({
                        "var_a": a,
                        "var_b": b,
                        "r": float(r_val),
                        "p": float(p_val),
                        "n": int(len(data)),
                    })
            pairs.sort(key=lambda row: abs(row["r"]), reverse=True)
            result = {
                "variables": cols,
                "matrix": corr.where(pd.notnull(corr), None).to_dict(),
                "pairs": pairs[:10],
                "strongest_pair": pairs[0] if pairs else None,
            }
            if len(cols) == 2:
                clean_pair = df[[cols[0], cols[1]]].dropna()
                if len(clean_pair):
                    sample = clean_pair.sample(min(200, len(clean_pair)), random_state=42)
                    result["scatter_points"] = sample.values.tolist()
        elif kind == "cramers_matrix":
            cat_cols = body.get("variables") or [
                c for c in df.columns
                if not pd.api.types.is_numeric_dtype(df[c])
                and df[c].nunique(dropna=True) <= 20
            ]
            if len(cat_cols) < 2:
                return {"error": "Need at least 2 categorical columns."}, 400
            matrix = {}
            pairs = []
            for a in cat_cols:
                matrix[a] = {}
                for b in cat_cols:
                    if a == b:
                        matrix[a][b] = 1.0
                        continue
                    if b in matrix and a in matrix[b]:
                        matrix[a][b] = matrix[b][a]
                        continue
                    ct = pd.crosstab(df[a], df[b])
                    chi2, _, _, _ = stats.chi2_contingency(ct)
                    n = int(ct.to_numpy().sum())
                    min_dim = max(min(ct.shape) - 1, 1)
                    v = float(np.sqrt(chi2 / (n * min_dim))) if n and min_dim else 0.0
                    matrix[a][b] = round(v, 3)
                    pairs.append({"var_a": a, "var_b": b, "v": round(v, 3), "n": n})
            pairs.sort(key=lambda r: abs(r["v"]), reverse=True)
            result = {
                "variables": cat_cols,
                "matrix": matrix,
                "pairs": pairs,
                "strongest_pair": pairs[0] if pairs else None,
            }
        else:
            return {"error": "unknown test kind"}, 400

        _save_analysis(s, ds_id, f"test_{kind}", body, result)
        return jsonify(clean_json(result))
    finally:
        s.close()

def _t_interpret(t, p, m1, m2, d, group, measure):
    """One-sentence plain-English summary of a t-test result."""
    sig = "significantly" if p < 0.05 else "not significantly"
    effect = "large" if abs(d) >= 0.8 else "medium" if abs(d) >= 0.5 else "small"
    return f"The two {group} groups {sig} differ on {measure} (t={t:.2f}, p={p:.4f}). Means: {m1:.2f} vs {m2:.2f}. Effect size is {effect} (Cohen's d={d:.2f})."

def _anova_interpret(f, p, k, measure, group):
    """One-sentence plain-English summary of an ANOVA result."""
    sig = "significantly" if p < 0.05 else "not significantly"
    return f"Across {k} groups of {group}, {measure} {sig} differs (F={f:.2f}, p={p:.4f})."

def _chi_interpret(chi2, p, a, b):
    """One-sentence plain-English summary of a chi-square result."""
    sig = "significant" if p < 0.05 else "no significant"
    return f"There is {sig} association between {a} and {b} (χ²={chi2:.2f}, p={p:.4f})."


# ===========================================================================
# SECTION: ADVANCED ANALYSIS - CLUSTERING & PCA
# Keywords: advanced, cluster, k-means, kmeans, pca, principal component, dimensionality
# ===========================================================================
# ANCHOR: Advanced: K-Means Clustering
@bp.route("/api/datasets/<ds_id>/advanced/cluster", methods=["POST"])
def do_cluster(ds_id):
    """Run K-means clustering on selected numeric variables (with PCA-2D plot)."""
    body = request.get_json() or {}
    cols = body.get("variables") or []
    k = min(max(_parse_num(body.get("k"), 4, int), 2), 20)
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds)
        X = numeric_df(df, cols).dropna()
        if X.shape[1] < 2:
            return {"error": "K-means clustering requires at least 2 numeric variables."}, 400
        if len(X) < k:
            return {"error": f"K-means clustering requires at least {k} complete rows for k={k}. Choose fewer clusters or select variables with fewer missing values."}, 400
        Xs = StandardScaler().fit_transform(X)
        km = KMeans(n_clusters=k, n_init=10, random_state=42).fit(Xs)
        # pca to 2d for plotting
        pca = PCA(n_components=2).fit_transform(Xs)
        result = {
            "k": k,
            "labels": km.labels_.tolist(),
            "inertia": float(km.inertia_),
            "cluster_sizes": {str(i): int((km.labels_ == i).sum()) for i in range(k)},
            "pca_points": [{"x": float(p[0]), "y": float(p[1]), "cluster": int(c)}
                           for p, c in zip(pca, km.labels_)][:500],  # cap plot points
            "variables": cols or X.columns.tolist(),
        }
        _save_analysis(s, ds_id, "cluster", body, result)
        return jsonify(clean_json(result))
    finally:
        s.close()

# ANCHOR: Advanced: PCA (Principal Component Analysis)
@bp.route("/api/datasets/<ds_id>/advanced/pca", methods=["POST"])
def do_pca(ds_id):
    """Run PCA and return explained variance + loadings for the top components."""
    body = request.get_json() or {}
    cols = body.get("variables") or []
    s = db()
    try:
        ds = s.query(Dataset).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        df = df_from_dataset(ds)
        X = numeric_df(df, cols).dropna()
        if X.shape[1] < 2:
            return {"error": "PCA requires at least 2 numeric variables."}, 400
        if len(X) < 2:
            return {"error": "PCA requires at least 2 complete rows after removing missing values."}, 400
        Xs = StandardScaler().fit_transform(X)
        n_comp = min(5, X.shape[1])
        pca = PCA(n_components=n_comp).fit(Xs)
        result = {
            "explained_variance": pca.explained_variance_ratio_.tolist(),
            "cumulative": np.cumsum(pca.explained_variance_ratio_).tolist(),
            "loadings": {
                col: pca.components_[:, i].tolist()
                for i, col in enumerate(X.columns)
            },
            "components": [f"PC{i+1}" for i in range(n_comp)],
        }
        _save_analysis(s, ds_id, "pca", body, result)
        return jsonify(clean_json(result))
    finally:
        s.close()


# ===========================================================================
# SECTION: ANALYSES LISTING
# Keywords: analyses, list saved, analysis history
# ===========================================================================
# ANCHOR: Analyses: List Saved Analyses
@bp.route("/api/datasets/<ds_id>/analyses", methods=["GET"])
def list_analyses(ds_id):
    """Return saved analysis artifacts so workflow pages can restore prior output."""
    kind = (request.args.get("kind") or "").strip()
    limit = min(max(_parse_num(request.args.get("limit"), 20, int), 1), 100)
    all_stages = str(request.args.get("all_stages") or "").lower() in {"1", "true", "yes"}
    s = db()
    try:
        ds = _dataset_scope(s.query(Dataset), s).filter_by(id=ds_id).first()
        if not ds:
            return {"error": "not found"}, 404
        current_stage_id = ds.current_stage_id or "original"
        q = s.query(Analysis).filter_by(dataset_id=ds_id)
        if kind:
            q = q.filter_by(kind=kind)
        rows = q.order_by(Analysis.created_at.desc()).limit(max(limit * 4, limit)).all()
        analyses = []
        for row in rows:
            cfg = jload(row.config) or {}
            if all_stages or cfg.get("stage_id") == current_stage_id:
                analyses.append(row)
            if len(analyses) >= limit:
                break
        return jsonify({
            "current_stage_id": current_stage_id,
            "analyses": [
                {
                    "id": a.id,
                    "kind": a.kind,
                    "config": jload(a.config) or {},
                    "result": jload(a.result) or {},
                    "stage_id": (jload(a.config) or {}).get("stage_id"),
                    "current_stage": ((jload(a.config) or {}).get("stage_id") == current_stage_id),
                    "created_at": a.created_at.isoformat() if a.created_at else None,
                }
                for a in analyses
            ]
        })
    finally:
        s.close()


def _save_analysis(session, ds_id, kind, config, result):
    """Persist an Analysis row tagged with the current stage id."""
    ds = session.query(Dataset).filter_by(id=ds_id).first()
    stage_id = (ds.current_stage_id if ds else None) or "original"
    config_payload = {**clean_json(config or {}), "stage_id": stage_id}
    result_payload = {**clean_json(result or {}), "stage_id": stage_id}
    a = Analysis(
        dataset_id=ds_id,
        kind=kind,
        config=jdump(config_payload),
        result=jdump(result_payload),
    )
    session.add(a)
    session.flush()  # populate a.id before log_activity references it
    log_activity(
        session,
        ds_id,
        "analysis",
        f"Ran {kind.replace('_', ' ')}",
        detail={"category": "analysis", "action_type": kind, "config": config_payload, "stage_id": stage_id},
        ref_type="analysis",
        ref_id=a.id,
        commit=False,
    )
    session.commit()
    return a
