"""Compatibility facade for machine-learning helpers.

The ML implementation is split by SimuCast responsibility:
- ``modules.models.ml.catalog``: algorithms, defaults, parameter sanitization
- ``modules.models.ml.preprocessing``: preprocessing/readiness plan
- ``modules.models.ml.training``: estimator construction, training, CV, metrics
- ``modules.models.ml.artifacts``: model serialization + feature influence
- ``modules.models.ml.whatif``: prediction input matrix + extrapolation risk
- ``modules.models.ml.health``: overfitting/model health diagnostics
- ``capabilities``: supported feature list for AI planning

Routes still import from ``backend.ml`` so this facade preserves existing
contracts while keeping the implementation modular.
"""

from backend.modules.ai.capabilities import _SIMUCAST_CAPABILITIES, _capability_text
from backend.modules.models.ml.artifacts import (
    _apply_numeric_preprocessing_frame,
    _deserialize_estimator,
    _feature_influence_from_model,
    _original_feature_name,
    _serialize_estimator,
    _whatif_raw_features,
)
from backend.modules.models.ml.catalog import (
    ALGORITHM_CATALOG,
    AVAILABLE_ALGOS_BY_TASK,
    MODEL_PARAM_DEFAULTS,
    _algo_label_for_task,
    _detect_task,
    _is_identifier_feature,
    _issue_check,
    _model_default_params,
    _sanitize_model_params,
)
from backend.modules.models.ml.health import _model_health_diagnostics
from backend.modules.models.ml.preprocessing import _build_preprocessing_plan
from backend.modules.models.ml.training import _build_model_estimator, _cross_validation_metrics, _train_one
from backend.modules.models.ml.whatif import _whatif_extrapolation_risk, _whatif_input_matrix

__all__ = [
    "ALGORITHM_CATALOG",
    "AVAILABLE_ALGOS_BY_TASK",
    "MODEL_PARAM_DEFAULTS",
    "_SIMUCAST_CAPABILITIES",
    "_algo_label_for_task",
    "_apply_numeric_preprocessing_frame",
    "_build_model_estimator",
    "_build_preprocessing_plan",
    "_capability_text",
    "_cross_validation_metrics",
    "_deserialize_estimator",
    "_detect_task",
    "_feature_influence_from_model",
    "_is_identifier_feature",
    "_issue_check",
    "_model_default_params",
    "_model_health_diagnostics",
    "_original_feature_name",
    "_sanitize_model_params",
    "_serialize_estimator",
    "_train_one",
    "_whatif_extrapolation_risk",
    "_whatif_input_matrix",
    "_whatif_raw_features",
]
