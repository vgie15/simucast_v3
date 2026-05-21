"""Beginner-friendly model health / overfitting diagnostics."""

def _model_health_diagnostics(metrics, plan=None, algo=None):
    """Persist a beginner-friendly train/test health summary with every new model run."""
    plan = plan or {}
    task = metrics.get("task")
    gap = abs(float(metrics.get("generalization_gap") or 0))
    rows = metrics.get("split_rows") or {}
    rows_total = int((rows.get("train") or 0) + (rows.get("test") or 0))
    feature_count = len(plan.get("features") or [])
    complexity = "complex" if algo in ("rf",) else "moderate" if algo == "tree" else "simple"
    small_data = rows_total and rows_total < 100
    feature_heavy = rows_total and feature_count >= max(10, rows_total // 4)
    cv = metrics.get("cross_validation") or {}
    cv_unstable = cv.get("std") is not None and float(cv.get("std") or 0) >= 0.12

    def base_causes():
        """Collect generic reasons that explain unstable train/test behavior."""
        causes = []
        if small_data:
            causes.append(f"Only {rows_total} usable rows were available, so validation can be unstable.")
        if feature_heavy:
            causes.append(f"{feature_count} selected features is high for this sample size.")
        if complexity == "complex":
            causes.append("Random Forest is more flexible and can memorize small or noisy datasets.")
        elif complexity == "moderate":
            causes.append("Decision trees can overfit when depth is not constrained.")
        if plan.get("multicollinearity"):
            causes.append("Highly correlated features may make model behavior less stable.")
        if cv_unstable:
            causes.append("Cross-validation scores vary across folds, suggesting unstable performance.")
        return causes

    def fixes(overfit=False, underfit=False):
        """Suggest actionable fixes tailored to overfit / underfit / small-data cases."""
        actions = []
        if overfit:
            actions.extend([
                {"label": "Review feature selection", "why": "Fewer, cleaner features can reduce memorization.", "route": "models.features"},
                {"label": "Try a simpler model", "why": "A simpler baseline is less likely to memorize small datasets.", "route": "models.algorithms"},
                {"label": "Tune complexity", "why": "Lower max depth or increase minimum samples per leaf for tree models.", "route": "models.tuning"},
            ])
            if plan.get("multicollinearity"):
                actions.append({"label": "Check correlations", "why": "Removing redundant features can stabilize the model.", "route": "tests.correlation"})
        if underfit:
            actions.extend([
                {"label": "Review selected features", "why": "The model may not have enough useful predictors.", "route": "models.features"},
                {"label": "Try a stronger model", "why": "A more flexible model may capture patterns a simple model misses.", "route": "models.algorithms"},
            ])
        if small_data:
            actions.append({"label": "Consider expansion", "why": "More rows can make validation more reliable for small datasets.", "route": "expand.recommendation"})
        actions.append({"label": "Use cross-validation", "why": "Multiple validation splits give a steadier generalization estimate.", "route": "models.validation_split"})
        return actions[:5]

    def build(status, label, color, summary, causes=None, actions=None, confidence="normal"):
        """Assemble the diagnostics dict returned for a single model evaluation."""
        return {
            "status": status,
            "label": label,
            "color": color,
            "summary": summary,
            "confidence": "low" if small_data else confidence,
            "causes": causes or [],
            "recommended_fixes": actions or [],
            "validation_method": metrics.get("validation_method", "standard_split"),
        }

    if task == "classification":
        train = metrics.get("train_accuracy")
        test = metrics.get("accuracy")
        if train is None or test is None:
            return build("insufficient_data", "Diagnostics unavailable", "gray", "Train/test health metrics are unavailable for this saved model.")
        if train < 0.65 and test < 0.65:
            return build("underfitting", "Possible underfitting", "blue", "Both training and test accuracy are low, so the model may be too simple or the selected features are not predictive.", base_causes(), fixes(underfit=True))
        if gap > 0.20:
            return build("severe_overfitting", "Severe overfitting risk", "red", "Training accuracy is far higher than test accuracy, which suggests the model may be memorizing training rows.", base_causes(), fixes(overfit=True))
        if gap > 0.10:
            return build("moderate_overfitting", "Moderate overfitting risk", "orange", "The train/test gap is large enough to review model complexity and selected features.", base_causes(), fixes(overfit=True))
        if gap > 0.05:
            return build("mild_overfitting", "Mild overfitting signal", "yellow", "The model performs slightly better on training data than test data. This is common, but worth monitoring.", base_causes(), fixes(overfit=True)[:3])
        return build("healthy", "Healthy", "green", "Training and test performance are close, so there is no major overfitting signal from this split.", base_causes(), [{"label": "Validate before reporting", "why": "Use another split or fresh data before treating results as final.", "route": "models.validation_split"}])
    if task == "regression":
        train = metrics.get("train_r2")
        test = metrics.get("r2")
        if train is None or test is None:
            return build("insufficient_data", "Diagnostics unavailable", "gray", "Train/test health metrics are unavailable for this saved model.")
        if train < 0.3 and test < 0.2:
            return build("underfitting", "Possible underfitting", "blue", "Both training and test R2 are low, so the model explains little of the target variation.", base_causes(), fixes(underfit=True))
        if gap > 0.20:
            return build("severe_overfitting", "Severe overfitting risk", "red", "Training R2 is far higher than test R2, which suggests weak generalization.", base_causes(), fixes(overfit=True))
        if gap > 0.10:
            return build("moderate_overfitting", "Moderate overfitting risk", "orange", "The train/test R2 gap is large enough to review model complexity and selected features.", base_causes(), fixes(overfit=True))
        if gap > 0.05:
            return build("mild_overfitting", "Mild overfitting signal", "yellow", "The model explains training rows somewhat better than test rows. This is worth monitoring.", base_causes(), fixes(overfit=True)[:3])
        return build("healthy", "Healthy", "green", "Training and test R2 are close, so there is no major overfitting signal from this split.", base_causes(), [{"label": "Validate before reporting", "why": "Use another split or fresh data before treating results as final.", "route": "models.validation_split"}])
    return build("insufficient_data", "Diagnostics unavailable", "gray", "Model health could not be classified for this saved model.")
