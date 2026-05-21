# Backend Structure

SimuCast backend code is organized by product area, while old import paths are
kept as small compatibility wrappers.

## Entry Points

- `app.py` assembles Flask, registers blueprints, and preserves legacy re-exports.
- `database.py` owns ORM models and schema setup.
- `config.py` owns environment and deployment configuration.

## Product Modules

- `modules/data/` - upload, sheets, grid rows, cleaning, category standardization, manual transforms, expansion, feature engineering, exports.
- `modules/analysis/` - descriptive summaries, statistical tests, PCA, K-means, saved analysis artifacts.
- `modules/models/` - model setup, training routes, saved model APIs.
- `modules/whatif/` - what-if prediction and scenario routes.
- `modules/report/` - report generation and report text sections.
- `modules/ai/` - AI routes, AI client, guided-plan capabilities.
- `modules/auth/` - login, signup, guest sessions, account management.
- `modules/history/` - activity/history timeline and stage restore routes.
- `modules/health/` - health/home endpoints.

## Shared Layers

- `core/` - cross-cutting backend services such as cache, auth/session helpers, and activity logging.
- `shared/` - generic utilities and DataFrame/stage helpers.
- `modules/models/ml/` - ML internals split by responsibility:
  - `catalog.py` algorithms and defaults
  - `preprocessing.py` model readiness/preprocessing plan
  - `training.py` estimator construction, training, validation metrics
  - `health.py` model health and overfitting diagnostics
  - `artifacts.py` serialization and feature influence helpers
  - `whatif.py` what-if matrix and extrapolation risk helpers

## Compatibility Wrappers

The root files `activity.py`, `cache.py`, `utils.py`, `dataframe_utils.py`,
`ai_client.py`, `auth_helpers.py`, and `capabilities.py` re-export the new
locations. `blueprints/` also re-exports route modules from `modules/`.

This lets existing imports keep working while new code can use the clearer
module locations directly.
