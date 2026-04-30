import React, { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import DataPage from './DataPage'
import ExpandPage from './ExpandPage'
import DescribePage from './DescribePage'
import TestsPage from './TestsPage'
import AdvancedPage from './AdvancedPage'
import ModelsPage from './ModelsPage'
import WhatIfPage from './WhatIfPage'
import ReportPage from './ReportPage'

const TABS = [
  { key: 'data', label: 'Data' },
  { key: 'expand', label: 'Expand' },
  { key: 'describe', label: 'Describe' },
  { key: 'tests', label: 'Tests' },
  { key: 'advanced', label: 'Advanced' },
  { key: 'models', label: 'Models' },
  { key: 'whatif', label: 'What-if' },
  { key: 'report', label: 'Report' },
]

export default function ProjectWorkspace() {
  const { id, tab = 'data' } = useParams()
  const navigate = useNavigate()
  const [dataset, setDataset] = useState(null)
  const [activeModel, setActiveModel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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

  const activeTab = tab === 'clean' ? 'data' : tab
  const page = renderTab(activeTab, { dataset, setDataset, activeModel, setActiveModel, go })

  return (
    <>
      <div className="ax-subnav">
        {TABS.map((t) => (
          <NavLink
            key={t.key}
            to={`/projects/${id}/${t.key}`}
            className={() => `ax-subnav-item ${t.key === activeTab ? 'active' : ''}`}
            end
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <Link to="/projects" style={{ fontSize: 11, color: 'var(--color-text-secondary)', textDecoration: 'none' }}>
          ← Projects
        </Link>
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 6px' }}>/</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{dataset.name}</span>
      </div>

      {page}
    </>
  )
}

function renderTab(tab, props) {
  switch (tab) {
    case 'data':
      return <DataPage dataset={props.dataset} setDataset={props.setDataset} />
    case 'expand':
      return <ExpandPage dataset={props.dataset} setDataset={props.setDataset} />
    case 'describe':
      return <DescribePage dataset={props.dataset} />
    case 'tests':
      return <TestsPage dataset={props.dataset} />
    case 'advanced':
      return <AdvancedPage dataset={props.dataset} />
    case 'models':
      return (
        <ModelsPage
          dataset={props.dataset}
          setActiveModel={props.setActiveModel}
          onGo={props.go}
        />
      )
    case 'whatif':
      return (
        <WhatIfPage
          dataset={props.dataset}
          activeModel={props.activeModel}
          setActiveModel={props.setActiveModel}
        />
      )
    case 'report':
      return <ReportPage dataset={props.dataset} />
    default:
      return <p>Unknown tab.</p>
  }
}
