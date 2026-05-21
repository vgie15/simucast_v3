"""Supported SimuCast capability list used to constrain AI planning prompts."""

_SIMUCAST_CAPABILITIES = [
    ("Data preparation", [
        "handle missing values", "handle outliers", "remove duplicates",
        "standardize categorical labels", "change column type", "rename columns",
        "drop rows/columns", "export cleaned data",
    ]),
    ("Feature engineering", ["create bins", "numeric formatting"]),
    ("Expand", [
        "decide whether expansion is needed", "recommend Bootstrap vs Synthetic",
        "configure target rows", "preview generated rows/stat changes", "apply expansion",
    ]),
    ("Describe", [
        "run descriptive statistics", "inspect variable cards", "view histogram/distribution",
        "view categorical distribution", "view correlation overview",
    ]),
    ("Analysis", [
        "run correlation", "run t-test", "run ANOVA", "run chi-square",
        "run PCA", "run K-means clustering",
    ]),
    ("Models", [
        "select target", "choose regression/classification algorithms", "configure validation split",
        "review preprocessing plan", "check multicollinearity", "check class balance",
        "train models", "compare metrics", "inspect feature importance", "check model health/overfitting",
    ]),
    ("What-if", [
        "use trained model", "adjust feature values", "compare baseline vs current prediction",
        "save scenario", "review extrapolation risk",
    ]),
    ("Report", [
        "include documentation logs", "include analysis results", "include model results",
        "include what-if scenarios", "include selected visualizations", "generate/export report",
    ]),
]


def _capability_text():
    """Plain-text bullet list of what SimuCast can do — used in AI prompts."""
    lines = []
    for category, items in _SIMUCAST_CAPABILITIES:
        lines.append(f"{category}:")
        lines.extend(f"- {item}" for item in items)
    return "\n".join(lines)
