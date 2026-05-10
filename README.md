# SimuCast — AI-powered data analysis

SPSS-style analysis tool with AI assistance, modeling, and what-if simulation.

## Stack

- **Backend**: Flask + SQLAlchemy + pandas + scipy + scikit-learn
- **Frontend**: React + Vite + Chart.js (via react-chartjs-2)
- **Database**: PostgreSQL (JSONB for dataset storage, integer auto-increment IDs)
- **AI**: Anthropic Claude (Sonnet for chat, Opus for deeper reasoning)
- **Deployment**: Render.com (blueprint included)

## Project layout

```
simucast_v3/
├── backend/
│   ├── app.py                 # Flask app factory + dev server entry point
│   ├── config.py              # env loader, upload limits, CORS, DATABASE_URL
│   ├── database.py            # SQLAlchemy models for all 8 tables
│   ├── auth_helpers.py        # session/token resolution + guest-limit responses
│   ├── activity.py            # append-only activity-log helpers
│   ├── ai_client.py           # Anthropic SDK wrapper
│   ├── cache.py               # in-process caches + AIResponse persistence
│   ├── dataframe_utils.py     # stage versioning + DataFrame loaders
│   ├── ml.py                  # preprocessing plan + model training
│   ├── utils.py               # JSON helpers, token generation
│   └── blueprints/            # one Flask blueprint per feature area
│       ├── auth_routes.py     #   guest, signup, login, account
│       ├── datasets.py        #   upload, list, detail, rows, edits
│       ├── stages_routes.py   #   stage timeline / revert
│       ├── cleaning.py        #   cleaning suggestions + apply
│       ├── transforms.py      #   rename / drop / merge / expand / feature engineer
│       ├── analysis.py        #   describe, t-test, ANOVA, chi-square, correlation, k-means, PCA
│       ├── models_routes.py   #   train one / many, list, delete
│       ├── whatif.py          #   what-if predictions
│       ├── ai_routes.py       #   project plan, recommend, explain, chat, suggest
│       ├── report.py          #   report assembly
│       ├── activity_routes.py #   project activity timeline
│       └── health.py          #   /api/health
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── api.js             # fetch wrapper + auth header injection
│   │   ├── styles.css
│   │   └── components/        # one .jsx per page or panel
│   ├── package.json
│   ├── vite.config.js
│   └── index.html
├── render.yaml                # Render blueprint
└── README.md
```

## Local development

You need **two `.env` files** — one for the backend, one for the frontend. Both are gitignored.

### 1. Backend env (`backend/.env`)

Create the file at `backend/.env`. Minimum required:

```bash
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

Optional but useful:

```bash
ANTHROPIC_API_KEY=sk-ant-...   # enables AI chat / recommend / explain (falls back to rule-based stubs without it)
CORS_ORIGINS=http://localhost:5173
PORT=5000
FLASK_DEBUG=1
```

`DATABASE_URL` is mandatory — the backend refuses to start without it. Three options:

- **Render Postgres (easiest)** — copy the **External Database URL** from the Render dashboard → your DB → Connect.
- **Local Postgres** — `brew install postgresql` (mac) / `apt install postgresql` (linux), then create a DB and use `postgresql://localhost:5432/yourdb`.
- **Docker** — `docker run -e POSTGRES_PASSWORD=pw -p 5432:5432 -d postgres:18`, then `postgresql://postgres:pw@localhost:5432/postgres`.

### 2. Frontend env (`frontend/.env`)

Only needed if you're running the backend on a different port than what the Vite dev proxy expects. Otherwise skip this file.

```bash
VITE_API_URL=http://localhost:5000
```

### 3. Run the backend

```bash
cd backend
python -m venv venv && source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Runs on `http://localhost:5000`. Tables are created automatically on the first request.

### 4. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:5173` and proxies `/api/*` to the backend.

### Inspecting the database

Render's database has no in-browser shell. To query it:

```bash
psql "$DATABASE_URL"
```

Useful psql commands once connected: `\dt` (list tables), `\d <table>` (describe a table), `\x` (toggle expanded display), `\q` (quit). Always end SQL statements with `;`.

## Deploy to Render

1. Push this repo to GitHub.
2. In the Render dashboard, click **New → Blueprint** and select the repo.
3. Render reads `render.yaml` and provisions:
   - `simu-cast-db` — PostgreSQL
   - `simu-cast-api` — Python web service (the Flask backend)
   - `simucast-front` — static site (the React build)
4. After the API deploys, copy its URL (e.g. `https://simu-cast-api.onrender.com`) and set `VITE_API_URL` on the `simucast-front` service → Environment. Redeploy the static site.
5. Set `ANTHROPIC_API_KEY` on the API service so AI features work.
6. Lock down `CORS_ORIGINS` on the API to your web URL for production.

## API overview

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/guest` | Create a temporary guest session |
| POST | `/api/auth/signup` | Create account + initial session |
| POST | `/api/auth/login` | Verify credentials, return new session |
| GET | `/api/auth/me` | Current session payload for the bearer token |
| POST | `/api/auth/logout` | Invalidate current session |
| PATCH | `/api/account` | Update email / full name |
| POST | `/api/account/password` | Rotate password |
| DELETE | `/api/account` | Delete account + all owned data |
| POST | `/api/datasets/upload` | Upload CSV or Excel |
| GET | `/api/datasets` | List datasets owned by the caller |
| GET | `/api/datasets/<id>` | Dataset metadata + variables |
| GET | `/api/datasets/<id>/rows` | Paginated rows |
| PATCH | `/api/datasets/<id>/cell` | Single-cell edit |
| GET | `/api/datasets/<id>/clean/suggestions` | Cleaning suggestions |
| POST | `/api/datasets/<id>/clean/apply` | Apply a fix (creates a new stage) |
| POST | `/api/datasets/<id>/transform` | Rename / drop / merge / expand columns |
| POST | `/api/datasets/<id>/describe` | Descriptives + histograms |
| POST | `/api/datasets/<id>/test` | t-test / ANOVA / chi-square / correlation |
| POST | `/api/datasets/<id>/advanced/cluster` | K-means with PCA projection |
| POST | `/api/datasets/<id>/models/train` | Train one model |
| POST | `/api/datasets/<id>/models/train_many` | Train multiple algorithms for comparison |
| GET | `/api/datasets/<id>/models` | List trained models |
| GET | `/api/models/<mid>` | Model detail + what-if feature metadata |
| POST | `/api/models/<mid>/predict` | What-if live prediction |
| POST | `/api/datasets/<id>/ai/recommend` | AI next-step recommendations |
| POST | `/api/datasets/<id>/ai/explain` | AI explanation for a result |
| POST | `/api/datasets/<id>/ai/chat` | Project chat (multi-turn, persisted) |
| POST | `/api/datasets/<id>/report` | Assemble a report artifact |
| GET | `/api/datasets/<id>/activity` | Project activity timeline |

All non-auth endpoints require a session token via `Authorization: Bearer <token>` or the `X-SimuCast-Session` header. Guest tokens work for most routes; AI and report endpoints require a signed-in account.

## Database schema

Eight tables, all with integer auto-increment primary keys. See `backend/database.py` for the full annotated schema.

| Table | Role |
|---|---|
| `users` | Signed-up accounts |
| `sessions` | Login tokens (guest + signed-in) |
| `datasets` | Uploaded files; original rows stored in `data` JSONB column |
| `dataset_stages` | One snapshot per cleaning / transform step (linked back to parent stage) |
| `analyses` | Saved analyses: describe, t-test, AI explanation, report, … |
| `models` | Trained ML models with metrics + feature importance |
| `activity_logs` | Append-only audit timeline |
| `ai_responses` | Persistent AI cache + chat transcripts |

Datasets are never mutated in place — every cleaning / transform step creates a new `dataset_stages` row pointing back at its parent, giving the UI a full undo timeline for free.

## Where the Excel/SPSS UI lives

Three places carry the Excel/SPSS feel:

1. **Data grid** (`DataDetailView.jsx`) — sticky row numbers, sticky header with dtype badges, monospace cells, missing values highlighted, inline cell editing.
2. **Descriptive stats output** (`DescribePage.jsx`) — numeric and categorical summaries rendered as SPSS-style output tables.
3. **Correlation matrix** (`TestsPage.jsx`) — heatmap-styled matrix with stronger correlations shaded.

## Things to extend in production

- **Password hashing** — passwords are currently stored in plaintext per project requirement. Swap in `werkzeug.security.generate_password_hash` before any non-dev use.
- **Dataset storage** — rows live in a JSONB column, fine up to ~100k rows. For larger datasets, move to Parquet on S3 / Render Disk.
- **Report export** — current export is JSON + browser Print-to-PDF. For polished PDFs, use WeasyPrint (Python) or puppeteer.
- **What-if for tree models** — only linear/logistic models expose coefficients for client-side prediction. Adding `/models/<id>/predict` server-side would extend What-if to RF / GBM.
- **Rate limiting** — the AI endpoints have no per-user throttle. Add Flask-Limiter before opening to the public.
