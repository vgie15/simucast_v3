/* ============================================================
 * PAGE: PROJECT WORKSPACE (TAB SHELL)
 * Keywords: workspace, tabs, data, describe, tests, models, whatif, report, expand
 * ============================================================ */
import React, { useEffect, useRef, useState } from 'react'
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

const EDGE_TAB_HEIGHT = 96
const EDGE_TAB_GAP = 8
const EDGE_TAB_STORAGE = 'simucast.edgeTabs'

const GUIDE_FOCUS_TARGETS = {
  structure: { page: 'data', target: 'tb-first_row_headers', open: { type: 'data-tool', tool: 'first_row_headers' } },
  headers: { page: 'data', target: 'tb-first_row_headers', open: { type: 'data-tool', tool: 'first_row_headers' } },
  missing: { page: 'data', target: 'fix-cleaning-missing', fallback: 'tb-missing', open: { type: 'data-tool', tool: 'missing' } },
  outliers: { page: 'data', target: 'fix-cleaning-outliers', fallback: 'tb-outliers', open: { type: 'data-tool', tool: 'outliers' } },
  duplicates: { page: 'data', target: 'fix-cleaning-duplicates', fallback: 'tb-duplicates', open: { type: 'data-tool', tool: 'duplicates' } },
  labels: { page: 'data', target: 'data-tool-popover-labels', fallback: 'tb-labels', open: { type: 'data-tool', tool: 'labels' } },
  format: { page: 'data', target: 'data-tool-popover-format', fallback: 'tb-format', open: { type: 'data-tool', tool: 'format' } },
  column_type: { page: 'data', target: 'data-tool-popover-format', fallback: 'tb-format', open: { type: 'data-tool', tool: 'format' } },
  numeric_format: { page: 'data', target: 'data-tool-popover-format', fallback: 'tb-format', open: { type: 'data-tool', tool: 'format' } },
  rename: { page: 'data', target: 'data-tool-popover-rename', fallback: 'tb-rename', open: { type: 'data-tool', tool: 'rename' } },
  drop: { page: 'data', target: 'data-tool-popover-drop_cols', fallback: 'tb-drop_cols', open: { type: 'data-tool', tool: 'drop_cols' } },
  drop_col: { page: 'data', target: 'data-tool-popover-drop_cols', fallback: 'tb-drop_cols', open: { type: 'data-tool', tool: 'drop_cols' } },
  export: { page: 'data', target: 'data-download-btn' },
  bin: { page: 'data', target: 'data-tool-popover-bin', fallback: 'tb-bin', open: { type: 'data-tool', tool: 'bin' } },
  scale: { page: 'data', target: 'data-tool-popover-scale', fallback: 'tb-scale', open: { type: 'data-tool', tool: 'scale' } },
  encode: { page: 'data', target: 'data-tool-popover-encode', fallback: 'tb-encode', open: { type: 'data-tool', tool: 'encode' } },
  expand: { page: 'expand', target: 'expand-section-controls' },
  expand_config: { page: 'expand', target: 'expand-section-controls' },
  expand_preview: { page: 'expand', target: 'expand-preview-panel', fallback: 'expand-section-controls' },
  describe: { page: 'describe', target: 'describe-nav-overview', open: { type: 'describe-section', section: 'overview' } },
  describe_overview: { page: 'describe', target: 'describe-nav-overview', open: { type: 'describe-section', section: 'overview' } },
  describe_numeric: { page: 'describe', target: 'describe-nav-numeric', open: { type: 'describe-section', section: 'numeric' } },
  describe_categorical: { page: 'describe', target: 'describe-nav-categorical', open: { type: 'describe-section', section: 'categorical' } },
  describe_correlations: { page: 'describe', target: 'describe-nav-correlations', open: { type: 'describe-section', section: 'correlations' } },
  describe_chartbuilder: { page: 'describe', target: 'describe-nav-chart-builder', open: { type: 'describe-section', section: 'chart-builder' } },
  analysis_choose: { page: 'tests', target: 'test-type-section' },
  correlation: { page: 'tests', target: 'test-button-corr', fallback: 'test-type-section' },
  ttest: { page: 'tests', target: 'test-button-t', fallback: 'test-type-section' },
  anova: { page: 'tests', target: 'test-button-anova', fallback: 'test-type-section' },
  chisquare: { page: 'tests', target: 'test-button-chi', fallback: 'test-type-section' },
  pca: { page: 'tests', target: 'test-button-pca', fallback: 'test-type-section' },
  kmeans: { page: 'tests', target: 'test-button-kmeans', fallback: 'test-type-section' },
  model: { page: 'models', target: 'models-nav-setup', open: { type: 'models-section', section: 'setup' } },
  model_setup: { page: 'models', target: 'models-nav-setup', open: { type: 'models-section', section: 'setup' } },
  model_target: { page: 'models', target: 'models-setup-target', open: { type: 'models-section', section: 'setup' } },
  model_features: { page: 'models', target: 'models-setup-features', open: { type: 'models-section', section: 'setup' } },
  model_algorithms: { page: 'models', target: 'models-setup-algorithms', open: { type: 'models-section', section: 'setup' } },
  model_validation: { page: 'models', target: 'models-setup-validation', open: { type: 'models-section', section: 'setup' } },
  model_preprocessing: { page: 'models', target: 'models-preplan', open: { type: 'models-section', section: 'setup' } },
  model_train: { page: 'models', target: 'models-run-training-btn', fallback: 'models-train-action-setup', open: { type: 'models-section', section: 'setup' } },
  model_results: { page: 'models', target: 'models-nav-results', open: { type: 'models-section', section: 'results' } },
  model_compare: { page: 'models', target: 'models-results-comparison', fallback: 'models-nav-results', open: { type: 'models-section', section: 'results' } },
  model_importance: { page: 'models', target: 'models-nav-feature-influence', open: { type: 'models-section', section: 'features' } },
  model_health: { page: 'models', target: 'models-results-health', fallback: 'models-nav-results', open: { type: 'models-section', section: 'results' } },
  whatif_scenario: { page: 'whatif', target: 'whatif-inputs-panel', fallback: 'whatif-model-card' },
  whatif_baseline: { page: 'whatif', target: 'whatif-baseline-panel', fallback: 'whatif-prediction-card' },
  whatif_compare: { page: 'whatif', target: 'whatif-scenario-compare-card' },
  whatif_save: { page: 'whatif', target: 'whatif-save-scenario' },
  whatif_risk: { page: 'whatif', target: 'whatif-scenario-risk' },
  report_build: { page: 'report', target: 'report-builder-panel', fallback: 'ax-report-preview' },
  report_export: { page: 'report', target: 'report-export-btn' },
  report_visualizations: { page: 'report', target: 'report-viz-section', fallback: 'ax-report-preview' },
  report_models: { page: 'report', target: 'report-models-section', fallback: 'ax-report-preview' },
  report_whatif: { page: 'report', target: 'report-whatif-section', fallback: 'ax-report-preview' },
  report: { page: 'report', target: 'ax-report-preview' },
}

function normalizeGuideFocusKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function guideFocusTargetForStep(step) {
  if (!step) return null
  if (typeof step === 'string') {
    const key = normalizeGuideFocusKey(step)
    return GUIDE_FOCUS_TARGETS[key] || legacyGuideFocusTarget(key)
  }
  const explicit = normalizeGuideFocusKey(step.tool_target || step.task_type || step.focus_target || step.kind)
  if (GUIDE_FOCUS_TARGETS[explicit]) return GUIDE_FOCUS_TARGETS[explicit]

  const text = `${step.id || ''} ${step.title || ''} ${step.section || ''} ${step.action || ''}`.toLowerCase()
  const page = step.page === 'analysis' ? 'tests' : step.page
  const checks = [
    ['missing', /missing|blank|impute/],
    ['outliers', /outlier/],
    ['duplicates', /duplicate/],
    ['labels', /label|categorical|standard/i],
    ['format', /format|type|decimal|integer|float|column type/],
    ['scale', /scale|scaling/],
    ['encode', /encode|encoding/],
    ['bin', /\bbin\b|bucket/],
    ['describe_correlations', /correlation|related|relationship/],
    ['describe_numeric', /numeric|summar/i],
    ['model_setup', /model|train|predict/],
    ['whatif_scenario', /what.?if|scenario/],
    ['report_build', /report|document|export/],
  ]
  const match = checks.find(([, pattern]) => pattern.test(text))
  if (match) return { ...GUIDE_FOCUS_TARGETS[match[0]], page: page || GUIDE_FOCUS_TARGETS[match[0]].page }
  if (page && GUIDE_FOCUS_TARGETS[page]) return GUIDE_FOCUS_TARGETS[page]
  if (page) return { page, target: step.section || `${page}-section-controls` }
  return null
}

function legacyGuideFocusTarget(key) {
  const legacy = {
    'data_suggested_fixes': 'missing',
    'data_outliers': 'outliers',
    'data_duplicates': 'duplicates',
    'data_categories': 'labels',
    'describe_summaries': 'describe_overview',
    'tests_setup': 'analysis_choose',
    'models_target': 'model_target',
    'whatif_controls': 'whatif_scenario',
    'report_preview': 'report',
  }
  return GUIDE_FOCUS_TARGETS[legacy[key]]
}

function findGuideFocusElement(target) {
  if (!target) return null
  const byId = (id) => (id ? document.getElementById(id) : null)
  return byId(target.target) || byId(target.fallback) || (target.selector ? document.querySelector(target.selector) : null)
}

function findGuideFocusScrollAnchor(target) {
  if (!target) return null
  if (target.open?.type === 'data-tool') {
    return document.getElementById(target.fallback) || document.getElementById(`tb-${target.open.tool}`) || findGuideFocusElement(target)
  }
  return findGuideFocusElement(target)
}

function rectForElement(el) {
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  const padding = 6
  return {
    top: Math.max(8, rect.top - padding),
    left: Math.max(8, rect.left - padding),
    right: Math.min(window.innerWidth - 8, rect.right + padding),
    bottom: Math.min(window.innerHeight - 8, rect.bottom + padding),
  }
}

function defaultEdgeTabPositions() {
  const viewportHeight = typeof window === 'undefined' ? 760 : window.innerHeight
  const center = Math.max(16, Math.round((viewportHeight - (EDGE_TAB_HEIGHT * 2 + EDGE_TAB_GAP)) / 2))
  return {
    guide: center,
    history: center + EDGE_TAB_HEIGHT + EDGE_TAB_GAP,
  }
}

function clampEdgeTabPositions(next) {
  const viewportHeight = typeof window === 'undefined' ? 760 : window.innerHeight
  const maxTop = Math.max(16, viewportHeight - EDGE_TAB_HEIGHT - 16)
  let guide = Math.min(maxTop, Math.max(16, Number(next.guide ?? 16)))
  let history = Math.min(maxTop, Math.max(16, Number(next.history ?? guide + EDGE_TAB_HEIGHT + EDGE_TAB_GAP)))

  if (Math.abs(guide - history) < EDGE_TAB_HEIGHT + EDGE_TAB_GAP) {
    if (guide <= history) {
      history = Math.min(maxTop, guide + EDGE_TAB_HEIGHT + EDGE_TAB_GAP)
      if (history >= maxTop) guide = Math.max(16, history - EDGE_TAB_HEIGHT - EDGE_TAB_GAP)
    } else {
      guide = Math.min(maxTop, history + EDGE_TAB_HEIGHT + EDGE_TAB_GAP)
      if (guide >= maxTop) history = Math.max(16, guide - EDGE_TAB_HEIGHT - EDGE_TAB_GAP)
    }
  }

  return { guide, history }
}

function loadEdgeTabPositions() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(EDGE_TAB_STORAGE) || 'null')
    return clampEdgeTabPositions(saved || defaultEdgeTabPositions())
  } catch {
    return defaultEdgeTabPositions()
  }
}

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
  const [guidanceSetupOpen, setGuidanceSetupOpen] = useState(false)
  const [showGuideOnboarding, setShowGuideOnboarding] = useState(false)
  const [activeSidePanel, setActiveSidePanel] = useState(() => {
    try {
      return window.sessionStorage.getItem('simucast.guidePanelOpen') === 'true' ? 'guide' : null
    } catch { return null }
  })
  const [edgeTabPositions, setEdgeTabPositions] = useState(loadEdgeTabPositions)
  const [draggingTab, setDraggingTab] = useState(null)
  const [pendingGuideFocus, setPendingGuideFocus] = useState(null)
  const [guideSpotlight, setGuideSpotlight] = useState(null)
  const dragStateRef = useRef(null)
  const spotlightTargetRef = useRef(null)

  const activeTab = tab === 'clean' ? 'data' : tab === 'advanced' ? 'tests' : tab

  const setSidePanel = (panel) => {
    setActiveSidePanel(panel)
    try { window.sessionStorage.setItem('simucast.guidePanelOpen', panel === 'guide' ? 'true' : 'false') } catch {}
  }

  const toggleSidePanel = (panel) => {
    setSidePanel(activeSidePanel === panel ? null : panel)
  }

  const openGuidePanel = () => {
    setSidePanel('guide')
  }

  const guidePanelOpen = activeSidePanel === 'guide'
  const historyOpen = activeSidePanel === 'history'

  useEffect(() => {
    const onResize = () => {
      setEdgeTabPositions((current) => {
        const next = clampEdgeTabPositions(current)
        try { window.localStorage.setItem(EDGE_TAB_STORAGE, JSON.stringify(next)) } catch {}
        return next
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const persistEdgeTabPositions = (next) => {
    setEdgeTabPositions(next)
    try { window.localStorage.setItem(EDGE_TAB_STORAGE, JSON.stringify(next)) } catch {}
  }

  const startEdgeTabDrag = (event, tabKey) => {
    if (event.button !== 0) return
    event.preventDefault()
    dragStateRef.current = {
      tabKey,
      pointerId: event.pointerId,
      startY: event.clientY,
      startTop: edgeTabPositions[tabKey],
      moved: false,
    }
    setDraggingTab(tabKey)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const moveEdgeTabDrag = (event) => {
    const drag = dragStateRef.current
    if (!drag) return
    const delta = event.clientY - drag.startY
    if (Math.abs(delta) > 4) drag.moved = true
    const next = clampEdgeTabPositions({
      ...edgeTabPositions,
      [drag.tabKey]: drag.startTop + delta,
    })
    setEdgeTabPositions(next)
  }

  const endEdgeTabDrag = (event, tabKey) => {
    const drag = dragStateRef.current
    if (!drag || drag.tabKey !== tabKey) return
    event.currentTarget.releasePointerCapture?.(drag.pointerId)
    const wasDrag = drag.moved
    const finalPositions = clampEdgeTabPositions({
      ...edgeTabPositions,
      [drag.tabKey]: drag.startTop + (event.clientY - drag.startY),
    })
    dragStateRef.current = null
    setDraggingTab(null)
    persistEdgeTabPositions(finalPositions)
    if (!wasDrag) toggleSidePanel(tabKey)
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

  // Auto-open the goal setup modal when navigating here right after project creation
  useEffect(() => {
    if (!id) return
    try {
      const newProjectId = window.sessionStorage.getItem('simucast.newProject')
      if (newProjectId !== id) return
      window.sessionStorage.removeItem('simucast.newProject')
    } catch { return }
    const t = setTimeout(() => setGuidanceSetupOpen(true), 800)
    return () => clearTimeout(t)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (next) => navigate(`/projects/${id}/${next}`)
  const refreshDataset = async () => {
    const fresh = await api.getDataset(id)
    setDataset(fresh)
    setRefreshKey((k) => k + 1)
  }

  const clearGuideSpotlight = () => {
    spotlightTargetRef.current?.classList?.remove('ax-simple-guide-target')
    spotlightTargetRef.current = null
    setGuideSpotlight(null)
  }

  const openGuideFocusTarget = (target) => {
    if (!target) return
    clearGuideSpotlight()
    const isDataTool = target.open?.type === 'data-tool'
    if (target.open?.type === 'data-tool') {
      window.dispatchEvent(new CustomEvent('simucast:data-tool-open', { detail: { tool: target.open.tool } }))
    } else if (target.open?.type === 'describe-section') {
      window.dispatchEvent(new CustomEvent('simucast:describe-section-open', { detail: { section: target.open.section } }))
    } else if (target.open?.type === 'models-section') {
      window.dispatchEvent(new CustomEvent('simucast:models-section-open', { detail: { section: target.open.section } }))
    }

    window.setTimeout(() => {
      const el = findGuideFocusScrollAnchor(target)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: isDataTool ? 'nearest' : 'center', inline: 'nearest' })
      window.setTimeout(() => {
        const liveEl = findGuideFocusElement(target) || el
        const rect = rectForElement(liveEl)
        if (!rect) return
        liveEl.classList.add('ax-simple-guide-target')
        spotlightTargetRef.current = liveEl
        setGuideSpotlight({ target, rect })
      }, isDataTool ? 420 : 240)
    }, isDataTool ? 220 : target.open ? 180 : 40)
  }

  useEffect(() => {
    if (!pendingGuideFocus || pendingGuideFocus.page !== activeTab) return
    const target = pendingGuideFocus
    setPendingGuideFocus(null)
    window.setTimeout(() => openGuideFocusTarget(target), 120)
  }, [activeTab, pendingGuideFocus])

  useEffect(() => {
    if (!guideSpotlight?.target) return undefined
    const update = () => {
      const el = findGuideFocusElement(guideSpotlight.target)
      const rect = rectForElement(el)
      if (!el || !rect) {
        clearGuideSpotlight()
        return
      }
      if (spotlightTargetRef.current !== el) {
        spotlightTargetRef.current?.classList?.remove('ax-simple-guide-target')
        el.classList.add('ax-simple-guide-target')
        spotlightTargetRef.current = el
      }
      setGuideSpotlight((current) => current ? { ...current, rect } : current)
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const onKey = (event) => {
      if (event.key === 'Escape') clearGuideSpotlight()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [guideSpotlight?.target])

  useEffect(() => () => clearGuideSpotlight(), [])

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

  const page = renderTab(activeTab, { dataset, setDataset, activeModel, setActiveModel, go, viewStageRequest, refreshKey, initialData: tabPreload })

  const startGuideFocus = async (step) => {
    if (!dataset?.id || !dataset?.guidance) return
    setSidePanel(null)
    const target = guideFocusTargetForStep(step)
    if (!target) return
    const normalized = { ...target, page: target.page === 'analysis' ? 'tests' : target.page }
    window.sessionStorage.setItem('simucast.fixTarget', JSON.stringify({
      page: normalized.page,
      section: normalized.target,
      ts: Date.now(),
    }))
    if (normalized.page !== activeTab) {
      setPendingGuideFocus(normalized)
      navigate(`/projects/${dataset.id}/${normalized.page}`)
      return
    }
    openGuideFocusTarget(normalized)
  }

  return (
    <div className="ax-workspace-grid history-closed">
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
          </div>
        </div>
        <div className={`ax-workspace-content ax-workspace-tab-${activeTab}`}>
          {page}
        </div>
      </div>

      <EdgeSideTab
        id={activeTab === 'whatif' ? 'whatif-guide-tab' : undefined}
        kind="guide"
        label="Guide"
        top={edgeTabPositions.guide}
        active={guidePanelOpen}
        dragging={draggingTab === 'guide'}
        onPointerDown={(event) => startEdgeTabDrag(event, 'guide')}
        onPointerMove={moveEdgeTabDrag}
        onPointerUp={(event) => endEdgeTabDrag(event, 'guide')}
        onPointerCancel={(event) => endEdgeTabDrag(event, 'guide')}
      />
      <EdgeSideTab
        id={activeTab === 'whatif' ? 'whatif-history-tab' : undefined}
        kind="history"
        label="History"
        top={edgeTabPositions.history}
        active={historyOpen}
        dragging={draggingTab === 'history'}
        onPointerDown={(event) => startEdgeTabDrag(event, 'history')}
        onPointerMove={moveEdgeTabDrag}
        onPointerUp={(event) => endEdgeTabDrag(event, 'history')}
        onPointerCancel={(event) => endEdgeTabDrag(event, 'history')}
      />

      {/* Backdrop overlay when panel is open */}
      <div className={`ax-guide-panel-overlay ${activeSidePanel ? 'open' : ''}`} onClick={() => setSidePanel(null)} />

      {/* Slide-in panel */}
      <aside className={`ax-guide-panel ${guidePanelOpen ? 'open' : ''}`}>
        <button className="ax-guide-panel-close" type="button" onClick={() => setSidePanel(null)} aria-label="Close guide panel">&times;</button>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ProjectAIRail
            dataset={dataset}
            activeTab={activeTab}
            panelOpen={guidePanelOpen}
            showOnboarding={showGuideOnboarding}
            onOpenGuidanceSetup={() => setGuidanceSetupOpen(true)}
            onGuidanceUpdated={(guidance) => setDataset((current) => ({ ...current, guidance }))}
            onStartGuideFocus={startGuideFocus}
            onDismissOnboarding={() => setShowGuideOnboarding(false)}
          />
        </div>
      </aside>
      <aside className={`ax-guide-panel ax-history-side-panel ${historyOpen ? 'open' : ''}`}>
        <ActivityPanel
          dataset={dataset}
          datasetId={dataset.id}
          onClose={() => setSidePanel(null)}
          onViewStage={(stageId) => {
            setViewStageRequest({ stageId, nonce: Date.now() })
            setSidePanel(null)
            navigate(`/projects/${id}/data`)
          }}
          onRestored={refreshDataset}
        />
      </aside>

      {guideSpotlight && (
        <GuideSpotlightOverlay spotlight={guideSpotlight} onClose={clearGuideSpotlight} />
      )}
      <FloatingDatasetPreview dataset={dataset} activeTab={activeTab} />
      <ProjectGuidanceSetup
        dataset={dataset}
        open={guidanceSetupOpen}
        onSaved={(guidance) => {
          setDataset((current) => ({ ...current, guidance }))
          setGuidanceSetupOpen(false)
          // Auto-open guide panel and show the onboarding card
          setSidePanel('guide')
          setShowGuideOnboarding(true)
        }}
        onClose={() => setGuidanceSetupOpen(false)}
      />
    </div>
  )
}

function EdgeSideTab({ id, kind, label, top, active, dragging, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }) {
  return (
    <button
      id={id}
      className={`ax-edge-tab ${kind} ${active ? 'active' : ''} ${dragging ? 'dragging' : ''}`}
      type="button"
      style={{ top }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      title={`${active ? 'Close' : 'Open'} ${label.toLowerCase()}`}
      aria-pressed={active}
    >
      <span className="ax-edge-tab-chevron">‹</span>
      <span className="ax-edge-tab-label">{label}</span>
    </button>
  )
}

function GuideSpotlightOverlay({ spotlight, onClose }) {
  const rect = spotlight?.rect
  if (!rect) return null
  const width = Math.max(0, rect.right - rect.left)
  const height = Math.max(0, rect.bottom - rect.top)
  const buttonTop = rect.bottom + 10 < window.innerHeight - 52 ? rect.bottom + 10 : Math.max(16, rect.top - 46)
  const buttonLeft = Math.min(window.innerWidth - 170, Math.max(16, rect.left))

  return (
    <div className="ax-simple-guide-spotlight" aria-label="Guide focus spotlight">
      <button className="ax-simple-guide-shade top" type="button" onClick={onClose} style={{ height: rect.top }} aria-label="Dismiss guide focus" />
      <button className="ax-simple-guide-shade left" type="button" onClick={onClose} style={{ top: rect.top, width: rect.left, height }} aria-label="Dismiss guide focus" />
      <button className="ax-simple-guide-shade right" type="button" onClick={onClose} style={{ top: rect.top, left: rect.right, height, width: Math.max(0, window.innerWidth - rect.right) }} aria-label="Dismiss guide focus" />
      <button className="ax-simple-guide-shade bottom" type="button" onClick={onClose} style={{ top: rect.bottom, height: Math.max(0, window.innerHeight - rect.bottom) }} aria-label="Dismiss guide focus" />
      <div className="ax-simple-guide-ring" style={{ top: rect.top, left: rect.left, width, height }} />
      <button className="ax-simple-guide-dismiss" type="button" onClick={onClose} style={{ top: buttonTop, left: buttonLeft }}>
        Done focusing
      </button>
    </div>
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
          const newEl = document.getElementById(section) || document.querySelector('.ax-data-toolbar-popover') || btn
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
          onGo={props.go}
        />
      )
    case 'report':
      return <ReportPage key={k} dataset={props.dataset} initialData={props.initialData} />
    default:
      return <p>Unknown tab.</p>
  }
}
