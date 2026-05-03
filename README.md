# SimuCast — AI-powered data analysis

SPSS-style analysis tool with AI assistance, modeling, and what-if simulation.

## Stack

- **Backend**: Flask + SQLAlchemy + pandas + scipy + scikit-learn
- **Frontend**: React + Vite + Chart.js (via react-chartjs-2)
- **Database**: PostgreSQL (JSONB for dataset storage)
- **Deployment**: Render.com (blueprint included)

## Project layout

```
axion/
├── backend/
│   ├── app.py            # all Flask routes + SQLAlchemy models
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── api.js        # fetch wrapper
│   │   ├── styles.css
│   │   └── components/
│   │       ├── Sidebar.jsx
│   │       ├── DataPage.jsx
│   │       ├── DataGridModal.jsx   # SPSS-style Data View / Variable View
│   │       ├── CleanPage.jsx
│   │       ├── DescribePage.jsx
│   │       ├── TestsPage.jsx
│   │       ├── AdvancedPage.jsx
│   │       ├── ModelsPage.jsx
│   │       ├── WhatIfPage.jsx
│   │       └── ReportPage.jsx
│   ├── package.json
│   ├── vite.config.js
│   └── index.html
└── render.yaml           # Render blueprint
```

## Local development

### Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
# local dev uses SQLite; set DATABASE_URL for postgres
python app.py
```
Runs on `http://localhost:5000`.

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Runs on `http://localhost:5173`, proxying `/api` to the backend.

## Deploy to Render

1. Push this repo to GitHub.
2. In Render dashboard, click **New → Blueprint**, select the repo.
3. Render reads `render.yaml` and provisions:
   - `axion-db` — PostgreSQL (free tier)
   - `axion-api` — Python web service
   - `axion-web` — static site (React build)
4. After the API deploys, copy its URL (e.g. `https://axion-api.onrender.com`) and set `VITE_API_URL` on the `axion-web` service → Environment. Redeploy the static site.
5. Lock down `CORS_ORIGINS` on the API to your web URL for production.

## API overview

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/datasets/upload` | Upload CSV or Excel |
| GET | `/api/datasets` | List datasets |
| GET | `/api/datasets/<id>` | Dataset + variables |
| GET | `/api/datasets/<id>/rows?page=&page_size=` | Paginated rows |
| PATCH | `/api/datasets/<id>/variables/<name>` | Update dtype |
| GET | `/api/datasets/<id>/clean/suggestions` | AI-flagged issues |
| POST | `/api/datasets/<id>/clean/apply` | Apply a fix |
| POST | `/api/datasets/<id>/describe` | Descriptives + histogram |
| POST | `/api/datasets/<id>/test` | t-test / ANOVA / chi-square / correlation |
| POST | `/api/datasets/<id>/advanced/cluster` | K-means with PCA projection |
| POST | `/api/datasets/<id>/advanced/pca` | PCA |
| POST | `/api/datasets/<id>/models/train` | Train model |
| GET | `/api/datasets/<id>/models` | List models |
| GET | `/api/models/<mid>` | Model + what-if feature metadata |
| POST | `/api/models/<mid>/predict` | What-if live prediction |
| POST | `/api/datasets/<id>/ai/suggest` | AI next-step suggestions |
| POST | `/api/datasets/<id>/report` | Assemble report |

## Where the Excel/SPSS UI lives

Four places benefit from the Excel/SPSS feel — it's not just a data viewer, it's a design pattern that makes the whole product feel professional:

1. **Data grid modal** (`DataGridModal.jsx`) — the "View data grid" button on the Data page opens a full-screen modal that mirrors SPSS exactly: a **Data View** tab with the paginated grid (sticky row numbers, sticky header with dtype badges, monospace cells, missing values highlighted red) and a **Variable View** tab showing column metadata.
2. **Descriptive stats output** (`DescribePage.jsx`) — numeric and categorical summaries rendered as SPSS-style output tables with every statistic as a column, identical to how SPSS's Output Viewer presents `DESCRIPTIVES` results.
3. **Correlation matrix** (`TestsPage.jsx` → correlation) — heatmap-styled matrix with stronger correlations shaded, matching SPSS's `CORRELATIONS` output.
4. **Contingency table / crosstab** (Chi-square result) — could be extended to show the full crosstab with row/column/expected counts like SPSS's `CROSSTABS`.

## Things to extend in production

- **AI analyst**: the current `ai/suggest` endpoint is rule-based. Swap in a Claude API call for real intent understanding and analysis planning.
- **Dataset storage**: rows are stored in a JSONB column, which is fine up to ~100k rows. For larger datasets, move to Parquet on S3 / Render Disk.
- **Auth**: no auth yet. Add Flask-Login or JWT before going public.
- **Report export**: the current export is JSON + browser Print-to-PDF. For polished PDFs, use WeasyPrint (Python) or puppeteer.
- **Chart.js**: already imported per-component. For perf on huge datasets, downsample server-side.
- **What-if**: only linear/logistic models expose coefficients for live prediction. Add a `/models/<id>/predict` that runs the actual model (tree-based) server-side for RF/GBM support.
