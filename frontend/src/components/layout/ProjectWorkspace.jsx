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
import FloatingDatasetPreview from '../data/FloatingDatasetPreview'
import ActivityPanel from '../history/ActivityPanel'
import ProjectAIRail from '../guided-plan/ProjectAIRail'
import ProjectGuidanceSetup from '../guided-plan/ProjectGuidanceSetup'
import GuidedCoach, { routeTarget } from '../guided-plan/GuidedCoach'
import { currentCoachStep } from '../guided-plan/ProjectGuidanceSetup'
import { useAuth } from '../providers/AuthProvider'
import { SimuCastLoader } from '../common/LoadingStates'

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

  useEffect(() => {
    if (!id) return
    try {
      const saved = window.localStorage.getItem(`simucast.activeModel.${id}`)
      setActiveModel(saved ? JSON.parse(saved) : null)
    } catch {
      setActiveModel(null)
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    try {
      if (activeModel) {
        window.localStorage.setItem(`simucast.activeModel.${id}`, JSON.stringify(activeModel))
      } else {
        window.localStorage.removeItem(`simucast.activeModel.${id}`)
      }
    } catch (err) {
      console.warn('Could not save active model to localStorage', err)
    }
  }, [id, activeModel])
  const [viewStageRequest, setViewStageRequest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tabPreload, setTabPreload] = useState(null)
  const [error, setError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [aiCollapsed, setAiCollapsed] = useState(false)
  const [guidanceSetupOpen, setGuidanceSetupOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(360)
  const [resizing, setResizing] = useState(null) // 'ai' | null
  const [guidedLockNotice, setGuidedLockNotice] = useState('')

  const activeTab = tab === 'clean' ? 'data' : tab === 'advanced' ? 'tests' : tab

  const aiKey = id ? `simucast.aiRail.collapsed.${id}` : ''
  const aiWidthKey = id ? `simucast.aiRail.width.${id}` : ''

  useEffect(() => {
    if (!aiKey) return
    const saved = window.localStorage.getItem(aiKey)
    setAiCollapsed(saved === null ? false : saved === '1')
  }, [aiKey])

  useEffect(() => {
    if (!aiWidthKey) return
    const saved = Number(window.localStorage.getItem(aiWidthKey))
    if (Number.isFinite(saved) && saved > 0) setAiWidth(saved)
  }, [aiWidthKey])

  useEffect(() => {
    if (!resizing) return
    const onMove = (e) => {
      e.preventDefault()
      if (resizing === 'ai') {
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
    if (resizing || !aiWidthKey) return
    window.localStorage.setItem(aiWidthKey, String(Math.round(aiWidth)))
  }, [aiWidth, resizing, aiWidthKey])

  const toggleAI = () => {
    setAiCollapsed((c) => {
      const next = !c
      if (aiKey) window.localStorage.setItem(aiKey, next ? '1' : '0')
      return next
    })
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api
      .getDataset(id)
      .then(async (d) => {
        if (!alive) return
        const preloaded = await preloadWorkspaceTab(d, activeTab)
        if (!alive) return
        setDataset(d)
        setTabPreload(preloaded)
        setGuidanceSetupOpen(d.guidance?.setup_status === 'pending')
      })
      .catch((err) => {
        if (alive) setError(err.message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
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
    return <SimuCastLoader label="Loading project..." />
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

  const guidedStep = dataset.guidance?.guided_mode ? currentCoachStep(dataset.guidance, dataset) : null
  const guidedTabIndex = guidedStep ? TABS.findIndex((item) => item.key === guidedStep.page) : -1
  const guidedLocksFuture = Boolean(guidedStep?.requirement === 'required' && guidedTabIndex >= 0)
  const page = renderTab(activeTab, { dataset, setDataset, activeModel, setActiveModel, go, viewStageRequest, refreshKey, initialData: tabPreload })

  return (
    <div
      className={`ax-workspace-grid history-closed ${aiCollapsed ? 'ai-closed' : ''} ${guidedStep ? 'guided-focus-enabled' : ''}`}
      style={{ '--ai-w': `${aiWidth}px` }}
    >
      <div className="ax-workspace-main">
        <div className="ax-workflow-header">
          <Link to="/projects" className="ax-project-brand" title={dataset.name}>
            <span className="ax-project-mark"><img src="/simucast-logo.png" alt="SimuCast logo" /></span>
            <span>SimuCast</span>
          </Link>
          <div className="ax-subnav">
            {TABS.map((t, index) => {
              const activeIndex = TABS.findIndex((tabItem) => tabItem.key === activeTab)
              const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending'
              const locked = guidedLocksFuture && index > guidedTabIndex
              if (locked) {
                return (
                  <button
                    key={t.key}
                    type="button"
                    className={`ax-subnav-item ${state} locked`}
                    title="Complete the current required guided step first."
                    aria-disabled="true"
                    onClick={() => {
                      setGuidedLockNotice('Complete the current guided task first.')
                      window.setTimeout(() => setGuidedLockNotice(''), 2600)
                    }}
                  >
                    {t.label}
                  </button>
                )
              }
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
            <div className="ax-project-actions">
              <button
                type="button"
                className="ax-history-button"
                onClick={() => setHistoryOpen(true)}
                aria-haspopup="dialog"
              >
                <HistoryClockIcon />
                History
              </button>
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
          </div>
          {guidedLockNotice && <strong className="ax-guided-lock-toast">{guidedLockNotice}</strong>}
        </div>
        <div className={`ax-workspace-content ax-workspace-tab-${activeTab} ${guidedStep?.page === activeTab ? 'ax-guided-focus-mode' : ''}`}>
          {page}
        </div>
      </div>

      <ProjectAIRail
        dataset={dataset}
        activeTab={activeTab}
        collapsed={aiCollapsed}
        onStartResize={() => setResizing('ai')}
        onOpenGuidanceSetup={() => setGuidanceSetupOpen(true)}
        onGuidanceUpdated={(guidance) => setDataset((current) => ({ ...current, guidance }))}
      />
      <GuidedCoach
        dataset={dataset}
        activeTab={activeTab}
        onGuidanceUpdated={(guidance) => setDataset((current) => ({ ...current, guidance }))}
      />
      <FloatingDatasetPreview dataset={dataset} activeTab={activeTab} />
      <ProjectGuidanceSetup
        dataset={dataset}
        open={guidanceSetupOpen}
        onSaved={(guidance, firstTarget) => {
          setDataset((current) => ({ ...current, guidance }))
          setGuidanceSetupOpen(false)
          if (firstTarget) routeTarget(id, firstTarget, activeTab, navigate)
        }}
        onClose={() => setGuidanceSetupOpen(false)}
      />
      {historyOpen && (
        <div className="ax-history-modal-backdrop" role="dialog" aria-modal="true" aria-label="Project history">
          <div className="ax-history-modal">
            <ActivityPanel
              dataset={dataset}
              datasetId={dataset.id}
              onClose={() => setHistoryOpen(false)}
              onViewStage={(stageId) => {
                setViewStageRequest({ stageId, nonce: Date.now() })
                setHistoryOpen(false)
                navigate(`/projects/${id}/data`)
              }}
              onRestored={refreshDataset}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function HistoryClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 4v4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
  if (!section) return
  let el = document.getElementById(section)
  if (!el) {
    if (section.startsWith('fix-cleaning-')) {
      const suffix = section.replace('fix-cleaning-', '').split('-')[0]
      const btn = document.getElementById(`tb-${suffix}`)
      if (btn) {
        btn.click()
        setTimeout(() => {
          const newEl = document.getElementById(section)
          if (newEl) {
            newEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
            newEl.classList.add('ax-fix-highlight')
            setTimeout(() => newEl.classList.remove('ax-fix-highlight'), 2600)
          }
        }, 120)
        return
      }
    } else if (section === 'data-section-category_standardization') {
      const btn = document.getElementById('tb-labels')
      if (btn) {
        btn.click()
        setTimeout(() => {
          const newEl = document.getElementById(section)
          if (newEl) {
            newEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
            newEl.classList.add('ax-fix-highlight')
            setTimeout(() => newEl.classList.remove('ax-fix-highlight'), 2600)
          }
        }, 120)
        return
      }
    }
    return
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ax-fix-highlight')
  window.setTimeout(() => el.classList.remove('ax-fix-highlight'), 2600)
}

async function preloadWorkspaceTab(dataset, tab) {
  if (!dataset?.id) return null
  const id = dataset.id
  try {
    if (tab === 'data') {
      const suggestions = await api.cleanSuggestions(id)
      return { tab, datasetId: id, suggestions }
    }
    if (tab === 'describe') {
      const [corr, rows, describe] = await Promise.all([
        api.listAnalyses(id, 'test_corr', 1).catch(() => ({ analyses: [] })),
        api.getRows(id, 1, 10000, dataset.current_stage_id).catch(() => ({ rows: [] })),
        api.listAnalyses(id, 'describe', 1).catch(() => ({ analyses: [] })),
      ])
      return { tab, datasetId: id, corr, rows, describe }
    }
    if (tab === 'tests') {
      const analyses = await api.listAnalyses(id, '', 20).catch(() => ({ analyses: [] }))
      return { tab, datasetId: id, analyses }
    }
    if (tab === 'models') {
      const [models, activity] = await Promise.all([
        api.listModels(id).catch(() => []),
        api.listActivity(id).catch(() => ({ activity: [] })),
      ])
      return { tab, datasetId: id, models, activity }
    }
    if (tab === 'whatif') {
      const models = await api.listModels(id).catch(() => [])
      return { tab, datasetId: id, models }
    }
    if (tab === 'report') {
      const savedRaw = window.localStorage.getItem(`simucast.savedCharts.${id}`)
      const savedCharts = savedRaw ? JSON.parse(savedRaw) : []
      const [activity, models, corr, rows] = await Promise.all([
        api.listActivity(id, 'asc').catch(() => ({ activity: [] })),
        api.listModels(id).catch(() => []),
        api.listAnalyses(id, 'test_corr', 1).catch(() => ({ analyses: [] })),
        api.getRows(id, 1, 10000, dataset.current_stage_id).catch(() => ({ rows: [] })),
      ])
      return { tab, datasetId: id, savedCharts, activity, models, corr, rows }
    }
  } catch (err) {
    console.warn('Tab preload failed', err)
  }
  return { tab, datasetId: id }
}



// Switch helper that selects and renders the page component for the active tab.
function renderTab(tab, props) {
  const k = props.refreshKey
  switch (tab) {
    case 'data':
      return <DataPage key={k} dataset={props.dataset} setDataset={props.setDataset} viewStageRequest={props.viewStageRequest} initialData={props.initialData} />
    case 'expand':
      return <ExpandPage key={k} dataset={props.dataset} setDataset={props.setDataset} />
    case 'describe':
      return <DescribePage key={k} dataset={props.dataset} initialData={props.initialData} />
    case 'tests':
      return <TestsPage key={k} dataset={props.dataset} initialData={props.initialData} />
    case 'models':
      return (
        <ModelsPage
          key={k}
          dataset={props.dataset}
          setActiveModel={props.setActiveModel}
          onGo={props.go}
          initialData={props.initialData}
        />
      )
    case 'whatif':
      return (
        <WhatIfPage
          key={k}
          dataset={props.dataset}
          activeModel={props.activeModel}
          setActiveModel={props.setActiveModel}
          initialData={props.initialData}
        />
      )
    case 'report':
      return <ReportPage key={k} dataset={props.dataset} initialData={props.initialData} />
    default:
      return <p>Unknown tab.</p>
  }
}
