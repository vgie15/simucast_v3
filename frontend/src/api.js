// Centralized API client — swap VITE_API_URL via .env for prod
const BASE = import.meta.env.VITE_API_URL || ''

async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  })
  if (!res.ok) {
    const msg = await res.text()
    throw new Error(msg || `${res.status} ${res.statusText}`)
  }
  return res.json()
}

async function _submitDataset(fd) {
  const r = await fetch(`${BASE}/api/datasets/upload`, { method: 'POST', body: fd })
  const ct = r.headers.get('content-type') || ''
  if (!r.ok) {
    if (ct.includes('application/json')) {
      const j = await r.json().catch(() => null)
      throw new Error(j?.error || `Request failed (${r.status})`)
    }
    throw new Error(`Request failed (${r.status})`)
  }
  if (!ct.includes('application/json')) {
    throw new Error(
      'Server returned a non-JSON response. The frontend may be pointing at the wrong API URL — check VITE_API_URL.',
    )
  }
  return r.json()
}

export const api = {
  // datasets
  listDatasets: () => request('/api/datasets'),
  getDataset: (id) => request(`/api/datasets/${id}`),
  deleteDataset: (id) =>
    request(`/api/datasets/${id}`, {
      method: 'DELETE',
    }),
  getRows: (id, page = 1, pageSize = 100, stageId) => {
    const qs = `page=${page}&page_size=${pageSize}` + (stageId ? `&stage_id=${encodeURIComponent(stageId)}` : '')
    return request(`/api/datasets/${id}/rows?${qs}`)
  },
  updateCell: (id, body) =>
    request(`/api/datasets/${id}/cell`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  updateCells: (id, edits) =>
    request(`/api/datasets/${id}/cells`, {
      method: 'PATCH',
      body: JSON.stringify({ edits }),
    }),
  categorySuggestions: (id) => request(`/api/datasets/${id}/categories/suggestions`),
  applyCategoryStandardization: (id, body) =>
    request(`/api/datasets/${id}/categories/apply`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listStages: (id) => request(`/api/datasets/${id}/stages`),
  restoreStage: (id, stageId) =>
    request(`/api/datasets/${id}/stages/${encodeURIComponent(stageId)}/restore`, { method: 'POST' }),
  listActivity: (id, order = 'desc') => request(`/api/datasets/${id}/activity?order=${order}`),
  createActivityNote: (id, body) =>
    request(`/api/datasets/${id}/activity`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteActivity: (id, activityId, reverse = false) =>
    request(`/api/datasets/${id}/activity/${encodeURIComponent(activityId)}?reverse=${reverse ? 'true' : 'false'}`, {
      method: 'DELETE',
    }),
  exportCsvUrl: (id, stageId) =>
    `${BASE}/api/datasets/${id}/export.csv` + (stageId ? `?stage_id=${encodeURIComponent(stageId)}` : ''),
  aiRecommend: (id, context) =>
    request(`/api/datasets/${id}/ai/recommend`, {
      method: 'POST',
      body: JSON.stringify({ context }),
    }),
  aiExplain: (id, step, params, question) =>
    request(`/api/datasets/${id}/ai/explain`, {
      method: 'POST',
      body: JSON.stringify({ step, params, question }),
    }),
  uploadDataset: async (file, name, description) => {
    const fd = new FormData()
    fd.append('file', file)
    if (name) fd.append('name', name)
    if (description) fd.append('description', description)
    return _submitDataset(fd)
  },
  createFromDataset: async (sourceId, name, description) => {
    const fd = new FormData()
    fd.append('from_dataset_id', sourceId)
    if (name) fd.append('name', name)
    if (description) fd.append('description', description)
    return _submitDataset(fd)
  },
  updateVariable: (dsId, varName, body) =>
    request(`/api/datasets/${dsId}/variables/${varName}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  columnStats: (dsId, colName) =>
    request(`/api/datasets/${dsId}/columns/${encodeURIComponent(colName)}/stats`),
  columnValues: (dsId, colName, page = 1, pageSize = 200) =>
    request(
      `/api/datasets/${dsId}/columns/${encodeURIComponent(colName)}/values?page=${page}&page_size=${pageSize}`,
    ),

  // cleaning
  cleanSuggestions: (id) => request(`/api/datasets/${id}/clean/suggestions`),
  cleanApply: (id, body) =>
    request(`/api/datasets/${id}/clean/apply`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  transform: (id, op, params, preview = false) =>
    request(`/api/datasets/${id}/transform${preview ? '?preview=true' : ''}`, {
      method: 'POST',
      body: JSON.stringify({ op, params }),
    }),
  expand: (id, body, preview = false) =>
    request(`/api/datasets/${id}/expand${preview ? '?preview=true' : ''}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // describe
  describe: (id, body) =>
    request(`/api/datasets/${id}/describe`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // tests
  runTest: (id, body) =>
    request(`/api/datasets/${id}/test`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // advanced
  cluster: (id, body) =>
    request(`/api/datasets/${id}/advanced/cluster`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  pca: (id, body) =>
    request(`/api/datasets/${id}/advanced/pca`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // models
  trainModel: (id, body) =>
    request(`/api/datasets/${id}/models/train`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  trainManyModels: (id, body) =>
    request(`/api/datasets/${id}/models/train_many`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  preprocessingPlan: (id, body) =>
    request(`/api/datasets/${id}/models/preprocessing_plan`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listModels: (id) => request(`/api/datasets/${id}/models`),
  getModel: (mid) => request(`/api/models/${mid}`),
  deleteModel: (mid) =>
    request(`/api/models/${mid}`, {
      method: 'DELETE',
    }),
  prepareModelForWhatIf: (mid) =>
    request(`/api/models/${mid}/prepare_whatif`, {
      method: 'POST',
    }),
  predict: (mid, inputs) =>
    request(`/api/models/${mid}/predict`, {
      method: 'POST',
      body: JSON.stringify({ inputs }),
    }),
  saveScenario: (mid, body) =>
    request(`/api/models/${mid}/scenarios`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ai
  aiSuggest: (id, prompt) =>
    request(`/api/datasets/${id}/ai/suggest`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),

  // report
  buildReport: (id, sections) =>
    request(`/api/datasets/${id}/report`, {
      method: 'POST',
      body: JSON.stringify({ sections }),
    }),
}
