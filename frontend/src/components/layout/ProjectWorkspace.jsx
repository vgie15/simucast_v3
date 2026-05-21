/* ============================================================
 * PAGE: PROJECT WORKSPACE (TAB SHELL)
 * Keywords: workspace, tabs, data, describe, tests, models, whatif, report, expand
 * ============================================================ */
import React, { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api'
import DataPage from '../data/DataPage'
import ExpandPage from '../expand/ExpandPage'
import DescribePage from '../describe/DescribePage'
import TestsPage from '../analysis/TestsPage'
import ModelsPage from '../models/ModelsPage'
import WhatIfPage from '../whatif/WhatIfPage'
import ReportPage from '../report/ReportPage'
import ProjectHistoryRail from '../history/ProjectHistoryRail'
import ProjectAIRail from '../guided-plan/ProjectAIRail'
import { useAuth } from '../providers/AuthProvider'

const TABS = [
  {
    key: 'data',
    label: 'Data',
    subtitle: 'Preparing your dataset',
    guidance: 'Inspect the data first, then clean only the issues that SimuCast detects.',
  },
  {
    key: 'expand',
    label: 'Expand',
    subtitle: 'Expanding and engineering rows',
    guidance: 'Use expansion only when the dataset is too small or needs careful scenario-ready rows.',
  },
  {
    key: 'describe',
    label: 'Describe',
    subtitle: 'Summarizing patterns and distributions',
    guidance: 'Start with summaries and charts so the numbers make sense before formal analysis.',
  },
  {
    key: 'tests',
    label: 'Analysis',
    subtitle: 'Running statistical analysis',
    guidance: 'Choose a recommended test pair, run it, then read the plain-language result.',
  },
  {
    key: 'models',
    label: 'Models',
    subtitle: 'Building predictive models',
    guidance: 'Select a target, review recommended features, train models, then check model health.',
  },
  {
    key: 'whatif',
    label: 'What-if',
    subtitle: 'Testing saved scenarios',
    guidance: 'Use a trained model to compare baseline values against a changed scenario.',
  },
  {
    key: 'report',
    label: 'Report',
    subtitle: 'Creating insights and documentation',
    guidance: 'Compile the saved outputs, explanations, history, and scenarios into a readable report.',
  },
]

// Top-level workspace shell hosting the project tabs, history rail and AI rail.
export default function ProjectWorkspace() {
  const { id, tab = 'data' } = useParams()
  const navigate = useNavigate()
  const auth = useAuth()
  const [dataset, setDataset] = useState(null)
  const [activeModel, setActiveModel] = useState(null)
  const [viewStageRequest, setViewStageRequest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [historyCollapsed, setHistoryCollapsed] = useState(true)
  const [aiCollapsed, setAiCollapsed] = useState(false)
  const [historyWidth, setHistoryWidth] = useState(320)
  const [aiWidth, setAiWidth] = useState(360)
  const [resizing, setResizing] = useState(null) // 'history' | 'ai' | null
  const activeTab = tab === 'clean' ? 'data' : tab === 'advanced' ? 'tests' : tab

  const historyKey = id ? `simucast.historyRail.collapsed.${id}` : ''
  const aiKey = id ? `simucast.aiRail.collapsed.${id}` : ''
  const historyWidthKey = id ? `simucast.historyRail.width.${id}` : ''
  const aiWidthKey = id ? `simucast.aiRail.width.${id}` : ''

  useEffect(() => {
    if (!historyKey) return
    const saved = window.localStorage.getItem(historyKey)
    setHistoryCollapsed(saved === null ? true : saved === '1')
  }, [historyKey])

  useEffect(() => {
    if (!aiKey) return
    const saved = window.localStorage.getItem(aiKey)
    setAiCollapsed(saved === null ? false : saved === '1')
  }, [aiKey])

  useEffect(() => {
    if (!historyWidthKey) return
    const saved = Number(window.localStorage.getItem(historyWidthKey))
    if (Number.isFinite(saved) && saved > 0) setHistoryWidth(Math.max(280, saved))
  }, [historyWidthKey])

  useEffect(() => {
    if (!aiWidthKey) return
    const saved = Number(window.localStorage.getItem(aiWidthKey))
    if (Number.isFinite(saved) && saved > 0) setAiWidth(saved)
  }, [aiWidthKey])

  useEffect(() => {
    if (!resizing) return
    const onMove = (e) => {
      e.preventDefault()
      if (resizing === 'history') {
        const next = Math.max(280, Math.min(520, e.clientX - 0))
        setHistoryWidth(next)
      } else if (resizing === 'ai') {
        const next = Math.max(240, Math.min(640, window.innerWidth - e.clientX))
        setAiWidth(next)
      }
    }
    const onUp = () => setResizing(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [resizing])

  useEffect(() => {
    if (resizing || !historyWidthKey) return
    window.localStorage.setItem(historyWidthKey, String(Math.round(historyWidth)))
  }, [historyWidth, resizing, historyWidthKey])

  useEffect(() => {
    if (resizing || !aiWidthKey) return
    window.localStorage.setItem(aiWidthKey, String(Math.round(aiWidth)))
  }, [aiWidth, resizing, aiWidthKey])

  const toggleHistory = () => {
    setHistoryCollapsed((c) => {
      const next = !c
      if (historyKey) window.localStorage.setItem(historyKey, next ? '1' : '0')
      return next
    })
  }

  const toggleAI = () => {
    setAiCollapsed((c) => {
      const next = !c
      if (aiKey) window.localStorage.setItem(aiKey, next ? '1' : '0')
      return next
    })
  }

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .getDataset(id)
      .then((d) => setDataset(d))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id, auth.session?.token])

  useEffect(() => {
    if (!error) return
    if (auth.isGuest || /not found|404/i.test(error)) {
      navigate('/dashboard', { replace: true, state: { message: 'That project is not available in this session.' } })
    }
  }, [auth.isGuest, error, navigate])

  const go = (next) => navigate(`/projects/${id}/${next}`)
  const refreshDataset = async () => {
    const fresh = await api.getDataset(id)
    setDataset(fresh)
    setRefreshKey((k) => k + 1)
  }

  useEffect(() => {
    const raw = window.sessionStorage.getItem('simucast.fixTarget')
    if (!raw) return
    let target = null
    try {
      target = JSON.parse(raw)
    } catch {
      return
    }
    if (target?.page !== activeTab || !target?.section) return
    window.setTimeout(() => highlightSection(target.section), 180)
    if (!['data', 'tests', 'models'].includes(activeTab)) {
      window.sessionStorage.removeItem('simucast.fixTarget')
    }
  }, [activeTab, dataset?.id])

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

  const activeTabMeta = TABS.find((t) => t.key === activeTab) || TABS[0]
  const page = renderTab(activeTab, { dataset, setDataset, activeModel, setActiveModel, go, viewStageRequest, refreshKey })

  return (
    <div
      className={`ax-workspace-grid ${historyCollapsed ? 'history-closed' : ''} ${aiCollapsed ? 'ai-closed' : ''}`}
      style={{ '--history-w': `${historyWidth}px`, '--ai-w': `${aiWidth}px` }}
    >
      <ProjectHistoryRail
        dataset={dataset}
        collapsed={historyCollapsed}
        onStartResize={() => setResizing('history')}
        onViewStage={(stageId) => {
          setViewStageRequest({ stageId, nonce: Date.now() })
          navigate(`/projects/${id}/data`)
        }}
        onRestored={refreshDataset}
      />
      <div className="ax-workspace-main">
        <div className="ax-workspace-breadcrumb">
          <Link to="/projects">← Projects</Link>
          <span className="sep">/</span>
          <span>{dataset.name}</span>
        </div>
        <div className="ax-workflow-header">
          <div className="ax-subnav">
            <button
              type="button"
              className={`ax-rail-toggle ${historyCollapsed ? '' : 'active'}`}
              onClick={toggleHistory}
              aria-pressed={!historyCollapsed}
              aria-label={historyCollapsed ? 'Open history rail' : 'Close history rail'}
              title={historyCollapsed ? 'Open history' : 'Close history'}
            >
              <ToggleChevron direction={historyCollapsed ? 'right' : 'left'} />
            </button>
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
              )
            })}
            <button
              type="button"
              className={`ax-rail-toggle ax-rail-toggle-ai ${aiCollapsed ? '' : 'active'}`}
              onClick={toggleAI}
              aria-pressed={!aiCollapsed}
              aria-label={aiCollapsed ? 'Open assistant rail' : 'Close assistant rail'}
              title={aiCollapsed ? 'Open assistant' : 'Close assistant'}
            >
              <ToggleChevron direction={aiCollapsed ? 'left' : 'right'} />
            </button>
          </div>
          <div className="ax-flow-context">
            <span>{activeTabMeta.subtitle}</span>
            <small>{activeTabMeta.guidance}</small>
          </div>
        </div>
        <div className="ax-workspace-content">
          {page}
          <NextPagePrompt activeTab={activeTab} datasetId={id} />
        </div>
      </div>
      <ProjectAIRail
        dataset={dataset}
        activeTab={activeTab}
        collapsed={aiCollapsed}
        onStartResize={() => setResizing('ai')}
      />
    </div>
  )
}

// Renders a small chevron SVG that rotates based on the given direction.
function ToggleChevron({ direction }) {
  // direction: 'left' or 'right'
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: direction === 'left' ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
    >
      <path d="M4 2L8 6L4 10" />
    </svg>
  )
}

// Scrolls to a section by id and briefly applies a highlight class for emphasis.
function highlightSection(section) {
  const el = document.getElementById(section)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ax-fix-highlight')
  window.setTimeout(() => el.classList.remove('ax-fix-highlight'), 2600)
}


// Card prompting the user to proceed to the next workflow tab with contextual copy.
function NextPagePrompt({ activeTab, datasetId }) {
  const idx = TABS.findIndex((t) => t.key === activeTab)
  const next = TABS[idx + 1]
  if (!next) return null
  const copy = {
    data: 'Move forward when the dataset has been inspected and major issues are handled.',
    expand: 'Summarize the prepared dataset before choosing tests or models.',
    describe: 'Use statistical analysis to check relationships and group differences.',
    tests: 'Train models after you understand the strongest candidate variables.',
    models: 'Try what-if scenarios using the model that best fits your goal.',
    whatif: 'Generate a report with saved outputs, explanations, history, and scenarios.',
  }
  return (
    <div className="ax-card ax-next-card">
      <div>
        <p className="ax-next-title">
          Ready for the next step?
        </p>
        <p className="ax-next-copy">
          {copy[activeTab] || 'Continue the workflow on the next page.'}
        </p>
      </div>
      <Link className="ax-btn prim" to={`/projects/${datasetId}/${next.key}`}>Go to {next.label} {'>'}</Link>
    </div>
  )
}

// Switch helper that selects and renders the page component for the active tab.
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
