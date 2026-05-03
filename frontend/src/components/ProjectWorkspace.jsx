import React, { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import DataPage from './DataPage'
import ExpandPage from './ExpandPage'
import DescribePage from './DescribePage'
import TestsPage from './TestsPage'
import ModelsPage from './ModelsPage'
import WhatIfPage from './WhatIfPage'
import ReportPage from './ReportPage'
import ActivityPanel from './ActivityPanel'

const TABS = [
  { key: 'data', label: 'Data', subtitle: 'Preparing your dataset' },
  { key: 'expand', label: 'Expand', subtitle: 'Expanding and engineering rows' },
  { key: 'describe', label: 'Describe', subtitle: 'Summarizing patterns and distributions' },
  { key: 'tests', label: 'Tests', subtitle: 'Running statistical tests' },
  { key: 'models', label: 'Models', subtitle: 'Building predictive models' },
  { key: 'whatif', label: 'What-if', subtitle: 'Testing saved scenarios' },
  { key: 'report', label: 'Report', subtitle: 'Creating insights and documentation' },
]

export default function ProjectWorkspace() {
  const { id, tab = 'data' } = useParams()
  const navigate = useNavigate()
  const [dataset, setDataset] = useState(null)
  const [activeModel, setActiveModel] = useState(null)
  const [viewStageRequest, setViewStageRequest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .getDataset(id)
      .then((d) => setDataset(d))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  const go = (next) => navigate(`/projects/${id}/${next}`)
  const refreshDataset = async () => {
    const fresh = await api.getDataset(id)
    setDataset(fresh)
    setRefreshKey((k) => k + 1)
  }

  if (loading) {
    return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Loading project…</p>
  }
  if (error || !dataset) {
    return (
      <>
        <h1 className="ax-page-title">Project not found</h1>
        <p className="ax-page-sub">{error || 'This project may have been deleted.'}</p>
        <Link to="/projects" className="ax-btn">← Back to projects</Link>
      </>
    )
  }

  const activeTab = tab === 'clean' ? 'data' : tab === 'advanced' ? 'tests' : tab
  const activeTabMeta = TABS.find((t) => t.key === activeTab) || TABS[0]
  const page = renderTab(activeTab, { dataset, setDataset, activeModel, setActiveModel, go, viewStageRequest, refreshKey })

  return (
    <>
      <div className="ax-subnav">
        {TABS.map((t, index) => {
          const activeIndex = TABS.findIndex((tabItem) => tabItem.key === activeTab)
          const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending'
          return (
          <NavLink
            key={t.key}
            to={`/projects/${id}/${t.key}`}
            className={() => `ax-subnav-item ${state}`}
            end
          >
            {t.label}
          </NavLink>
        )})}
      </div>
      <p className="ax-flow-context">{activeTabMeta.subtitle}</p>

      <div style={{ marginBottom: 12 }}>
        <Link to="/projects" style={{ fontSize: 11, color: 'var(--color-text-secondary)', textDecoration: 'none' }}>
          ← Projects
        </Link>
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 6px' }}>/</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{dataset.name}</span>
      </div>

      <div className="ax-workspace-grid">
        <div style={{ minWidth: 0 }}>
          {page}
          <NextPagePrompt activeTab={activeTab} datasetId={id} />
        </div>
        <ActivityPanel
          datasetId={dataset.id}
          onViewStage={(stageId) => {
            setViewStageRequest({ stageId, nonce: Date.now() })
            navigate(`/projects/${id}/data`)
          }}
          onRestored={refreshDataset}
        />
      </div>
    </>
  )
}

function NextPagePrompt({ activeTab, datasetId }) {
  const idx = TABS.findIndex((t) => t.key === activeTab)
  const next = TABS[idx + 1]
  if (!next) return null
  const copy = {
    data: 'After cleaning and standardizing the dataset, expand rows or engineer more data.',
    expand: 'Next, summarize the prepared dataset before formal testing.',
    describe: 'Next, run statistical tests to evaluate relationships and group differences.',
    tests: 'Next, train models using the strongest candidate targets and features.',
    models: 'Next, compare saved scenarios using trained interpretable models.',
    whatif: 'Next, generate a report with documentation, notes, results, and scenarios.',
  }
  return (
    <div className="ax-card ax-next-card">
      <div>
        <p style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Ready for the next step?</p>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
          {copy[activeTab] || 'Continue the workflow on the next page.'}
        </p>
      </div>
      <Link className="ax-btn prim" to={`/projects/${datasetId}/${next.key}`}>Go to {next.label} {'>'}</Link>
    </div>
  )
}

function renderTab(tab, props) {
  const k = props.refreshKey
  switch (tab) {
    case 'data':
      return <DataPage key={k} dataset={props.dataset} setDataset={props.setDataset} viewStageRequest={props.viewStageRequest} />
    case 'expand':
      return <ExpandPage key={k} dataset={props.dataset} setDataset={props.setDataset} />
    case 'describe':
      return <DescribePage key={k} dataset={props.dataset} />
    case 'tests':
      return <TestsPage key={k} dataset={props.dataset} />
    case 'models':
      return (
        <ModelsPage
          key={k}
          dataset={props.dataset}
          setActiveModel={props.setActiveModel}
          onGo={props.go}
        />
      )
    case 'whatif':
      return (
        <WhatIfPage
          key={k}
          dataset={props.dataset}
          activeModel={props.activeModel}
          setActiveModel={props.setActiveModel}
        />
      )
    case 'report':
      return <ReportPage key={k} dataset={props.dataset} />
    default:
      return <p>Unknown tab.</p>
  }
}
