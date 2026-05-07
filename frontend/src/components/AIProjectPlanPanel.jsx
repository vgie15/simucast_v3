import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { BusyOverlay, SkeletonCards } from './LoadingStates'

const PAGE_ORDER = { data: 0, expand: 1, describe: 2, tests: 3, models: 4, whatif: 5, report: 6 }
const DATA_CHANGE_ACTIONS = new Set([
  'cell_edit',
  'batch_cell_edit',
  'clean',
  'clean_group',
  'impute',
  'winsorize',
  'convert',
  'drop',
  'drop_rows',
  'drop_duplicates',
  'remove_duplicates',
  'category_standardization',
  'rename',
  'type_conversion',
  'feature_engineer',
  'feature_engineer_bin',
  'feature_engineer_average',
  'feature_engineer_ratio',
  'feature_engineer_round',
  'feature_engineer_log',
  'feature_engineer_zscore',
  'feature_engineer_minmax',
  'expand',
  'restore',
  'reset',
  'undo_step',
])

export default function AIProjectPlanPanel({ dataset, activeTab, planH, onCollapsedChange }) {
  const navigate = useNavigate()
  const datasetId = dataset?.id
  const stageKey = dataset?.current_stage_id || 'original'
  const doneKey = datasetId ? `simucast.aiPlan.done.${datasetId}.${stageKey}` : ''
  const collapseKey = datasetId ? `simucast.aiPlan.collapsed.${datasetId}` : ''
  const modeKey = datasetId ? `simucast.aiPlan.mode.${datasetId}` : ''
  const [mode, setMode] = useState(() => {
    if (!modeKey) return 'auto'
    const saved = window.localStorage.getItem(modeKey) || 'auto'
    return saved === 'off' ? 'auto' : saved
  })
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState([])
  const [activity, setActivity] = useState([])
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const loadActivity = async () => {
    if (!datasetId) return
    try {
      const r = await api.listActivity(datasetId, 'asc')
      setActivity(r.activity || [])
    } catch {
      setActivity([])
    }
  }

  const load = async (force = false) => {
    if (!datasetId) return
    const cacheKey = `simucast.aiPlan.${datasetId}.${stageKey}.${mode}`
    if (!force) {
      const cached = window.localStorage.getItem(cacheKey)
      if (cached) {
        try {
          const cachedPlan = JSON.parse(cached)
          if (mode === 'auto' && cachedPlan?.ai !== true) {
            window.localStorage.removeItem(cacheKey)
          } else {
            setPlan(cachedPlan)
            loadActivity()
            return
          }
        } catch {
          window.localStorage.removeItem(cacheKey)
        }
      }
    }
    setLoading(true)
    setError('')
    try {
      const r = await api.aiProjectPlan(datasetId, mode)
      setPlan(r)
      window.localStorage.setItem(cacheKey, JSON.stringify(r))
    } catch {
      setError('AI plan unavailable. Using built-in guided workflow.')
      try {
        const fallback = await api.aiProjectPlan(datasetId, 'system')
        setPlan({ ...fallback, error: 'AI plan unavailable. Using built-in guided workflow.' })
      } catch {
        setPlan(null)
      }
    } finally {
      setLoading(false)
      loadActivity()
    }
  }

  useEffect(() => {
    if (!modeKey) return
    const saved = window.localStorage.getItem(modeKey) || 'auto'
    setMode(saved === 'off' ? 'auto' : saved)
  }, [modeKey])

  useEffect(() => {
    if (!doneKey) return
    try {
      setDone(JSON.parse(window.localStorage.getItem(doneKey) || '[]'))
    } catch {
      setDone([])
    }
  }, [doneKey])

  useEffect(() => {
    if (!collapseKey) return
    setCollapsed(window.localStorage.getItem(collapseKey) === '1')
  }, [collapseKey])

  useEffect(() => {
    load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, stageKey, mode])

  useEffect(() => {
    loadActivity()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, stageKey])

  useEffect(() => {
    if (!collapseKey) return
    const initial = window.localStorage.getItem(collapseKey) === '1'
    onCollapsedChange?.(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseKey])

  const steps = plan?.steps || []
  const doneSet = useMemo(() => new Set(done), [done])
  const progress = useMemo(() => deriveProgress(activity), [activity])
  const latestDataChange = progress.latestDataChangeAt || null
  const stepStates = useMemo(
    () => steps.map((step) => getStepState(step, progress, latestDataChange, doneSet)),
    [steps, progress, latestDataChange, doneSet],
  )
  const planItems = useMemo(
    () => steps
      .map((step, index) => ({ step, index, state: stepStates[index] || { status: 'pending', step } }))
      .sort((a, b) => workflowSort(a.step, a.index) - workflowSort(b.step, b.index)),
    [steps, stepStates],
  )
  const nextStepState = planItems.find((item) => ['blocked', 'warning', 'stale', 'pending'].includes(item.state.status))?.state
  const isAI = plan?.ai === true
  const isAutoFallback = mode === 'auto' && plan && plan.ai !== true
  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current
      if (collapseKey) window.localStorage.setItem(collapseKey, next ? '1' : '0')
      onCollapsedChange?.(next)
      return next
    })
  }

  const toggleDone = (stepId) => {
    const next = doneSet.has(stepId) ? done.filter((id) => id !== stepId) : [...done, stepId]
    setDone(next)
    if (doneKey) window.localStorage.setItem(doneKey, JSON.stringify(next))
  }

  const goToStep = (step) => {
    if (!datasetId || !step?.page) return
    const section = sectionForStep(step)
    window.sessionStorage.setItem('simucast.fixTarget', JSON.stringify({
      page: step.page,
      section,
      ts: Date.now(),
    }))
    if (step.page === activeTab) {
      window.setTimeout(() => highlightSection(section), 40)
      return
    }
    navigate(`/projects/${datasetId}/${step.page}`)
  }

  return (
    <section
      className={`ax-card ax-plan-panel ax-busy-host${collapsed ? ' ax-plan-collapsed' : ''} ${loading ? 'is-busy' : ''}`}
      style={!collapsed && planH ? { height: planH, maxHeight: 'none' } : undefined}
    >
      <BusyOverlay
        active={loading && !!plan}
        title={mode === 'auto' ? 'Generating guided plan...' : 'Preparing system workflow...'}
        detail={mode === 'auto'
          ? 'Building a dataset profile and preparing workflow recommendations.'
          : 'Reviewing dataset issues and ordering the recommended steps.'}
        steps={mode === 'auto'
          ? ['Building dataset profile', 'Generating recommendations', 'Preparing guided plan']
          : ['Checking data quality', 'Mapping fixes to pages', 'Preparing guided plan']}
      />

      <div className="ax-panel-sticky-header">
        <div className="ax-row" style={{ marginBottom: collapsed ? 0 : 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              font: 'inherit',
              color: 'inherit',
              textAlign: 'left',
            }}
          >
            <Chevron open={!collapsed} />
            <span style={{ fontSize: 16, fontWeight: 800 }}>
              {isAI ? 'AI Guided Plan' : 'System Guided Plan'}
            </span>
          </button>
          {!collapsed && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="ax-btn mini" type="button" onClick={() => setExpanded(true)} disabled={!plan}>
                Expand plan
              </button>
              <button className="ax-btn mini" type="button" onClick={() => load(true)} disabled={loading}>
                Refresh
              </button>
            </div>
          )}
        </div>

        {!collapsed && (
          <div className="ax-plan-mode" aria-label="Guidance mode" style={{ marginBottom: 0 }}>
            <button type="button" className={mode === 'auto' ? 'active' : ''} onClick={() => setGuidanceMode('auto', modeKey, setMode, setPlan)}>
              AI guided
            </button>
            <button type="button" className={mode === 'system' ? 'active' : ''} onClick={() => setGuidanceMode('system', modeKey, setMode, setPlan)}>
              System only
            </button>
          </div>
        )}
      </div>

      {!collapsed && (
        <>
          {(plan?.error || error || isAutoFallback) && (
            <div className="ax-plan-fallback">
              <strong>AI plan unavailable.</strong>
              <span>Using built-in guided workflow.</span>
            </div>
          )}

          {loading && !plan && <SkeletonCards count={3} />}

          {plan?.summary && (
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 10px' }}>
              {plan.summary}
            </p>
          )}

          {plan && (
            <div className="ax-plan-list">
              {planItems
                .map(({ step, state }, position) => {
                  const isCompleted = state.status === 'completed'
                  const isNext = nextStepState?.step?.id === step.id
                  const displayStatus = isNext && !isCompleted ? 'active' : state.status
                  const target = targetForStep(step)
                  return (
                    <React.Fragment key={`${step.id}-${position}`}>
                      <article className={`ax-plan-step ${displayStatus} ${isNext ? 'next' : ''}`}>
                        <button
                          className="ax-plan-check"
                          onClick={() => toggleDone(step.id)}
                          type="button"
                          aria-label={isCompleted ? 'Mark step incomplete' : 'Mark step complete'}
                        >
                          {position + 1}
                        </button>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <p style={{ fontSize: 13, fontWeight: 750, margin: 0 }}>{step.title}</p>
                            <span className={`ax-plan-status ${displayStatus}`}>{statusLabel(displayStatus)}</span>
                          </div>
                          {state.status === 'stale' && (
                            <p style={{ fontSize: 11, color: 'var(--color-text-warning)', margin: '3px 0 0' }}>
                              Re-run recommended because the dataset changed after this step.
                            </p>
                          )}
                          {!isCompleted && step.rationale && (
                            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '3px 0 0' }}>
                              {step.rationale}
                            </p>
                          )}
                          {!isCompleted && step.columns?.length > 0 && (
                            <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', margin: '4px 0 0' }}>
                              {step.columns.slice(0, 4).join(', ')}
                            </p>
                          )}
                          {!isCompleted && (
                            <>
                              <div className="ax-plan-target">
                                <span>Use</span>
                                <strong>{target.label}</strong>
                                <small>{target.hint}</small>
                              </div>
                              <button className="ax-btn mini" onClick={() => goToStep(step)} type="button" style={{ marginTop: 6 }}>
                                {state.status === 'stale' ? 'Re-run ' : 'Open '}{target.shortLabel}
                              </button>
                              {step.rationale && <WhyThisMatters text={step.rationale} />}
                            </>
                          )}
                        </div>
                      </article>
                    </React.Fragment>
                  )
                })}
            </div>
          )}
        </>
      )}
      {expanded && plan && createPortal(
        <GuidedPlanModal
            isAI={isAI}
            mode={mode}
            error={plan?.error || error || isAutoFallback}
            summary={plan.summary}
            items={planItems}
            nextStepId={nextStepState?.step?.id}
            onClose={() => setExpanded(false)}
            onGo={(step) => {
              setExpanded(false)
              goToStep(step)
            }}
          />,
        document.body,
      )}
    </section>
  )
}

function setGuidanceMode(nextMode, modeKey, setMode, setPlan) {
  if (modeKey) window.localStorage.setItem(modeKey, nextMode)
  setMode(nextMode)
  setPlan(null)
}

function deriveProgress(activity) {
  const progress = {
    completedAt: {},
    latestDataChangeAt: null,
    warnings: {},
  }
  for (const item of activity || []) {
    const createdAt = Date.parse(item.created_at || '')
    if (!Number.isFinite(createdAt)) continue
    const action = String(item.action_type || item.kind || '').toLowerCase()
    const kind = String(item.kind || '').toLowerCase()
    const summary = String(item.summary || '').toLowerCase()
    const category = String(item.category || item.detail?.category || '').toLowerCase()
    if (isDataChangingAction(action) || item.related_stage_id || item.ref_type === 'stage') {
      progress.latestDataChangeAt = Math.max(progress.latestDataChangeAt || 0, createdAt)
    }
    if (kind === 'analysis' || category === 'analysis') {
      if (action === 'describe' || summary.includes('describe')) mark(progress, 'describe', createdAt)
      if (action.startsWith('test_') || summary.includes('test') || action === 'cluster' || action === 'pca') mark(progress, 'tests', createdAt)
    }
    if (action === 'train_model' || kind === 'model' || category === 'model') mark(progress, 'models', createdAt)
    if (action === 'save_whatif_scenario' || kind === 'whatif' || category === 'whatif') mark(progress, 'whatif', createdAt)
    if (action === 'generate_report' || kind === 'report' || category === 'report') mark(progress, 'report', createdAt)
    if (isDataChangingAction(action) || item.related_stage_id || item.ref_type === 'stage') mark(progress, 'data', createdAt)
    if (action === 'expand') mark(progress, 'expand', createdAt)
  }
  return progress
}

function mark(progress, page, at) {
  progress.completedAt[page] = Math.max(progress.completedAt[page] || 0, at)
}

function isDataChangingAction(action) {
  if (DATA_CHANGE_ACTIONS.has(action)) return true
  return action.startsWith('clean')
    || action.startsWith('group_')
    || action.startsWith('feature_engineer')
    || action.startsWith('merge')
    || action.startsWith('drop')
    || action.startsWith('cast')
    || action.startsWith('split')
}

function getStepState(step, progress, latestDataChange, doneSet) {
  const page = step.page || 'data'
  const completedAt = progress.completedAt[page]
  const manuallyDone = doneSet.has(step.id)
  const downstream = (PAGE_ORDER[page] ?? 0) > PAGE_ORDER.data
  if ((completedAt || manuallyDone) && downstream && latestDataChange && completedAt && latestDataChange > completedAt) {
    return { step, status: 'stale', completedAt }
  }
  if (completedAt || manuallyDone) return { step, status: 'completed', completedAt }
  if (['blocked', 'warning'].includes(step.status)) return { step, status: step.status }
  if (step.priority === 'high') return { step, status: 'warning' }
  return { step, status: 'pending' }
}

function workflowSort(step, originalIndex = 0) {
  const pageScore = PAGE_ORDER[step?.page || 'data'] ?? 99
  const sectionScore = sectionRank(step)
  return pageScore * 1000 + sectionScore * 10 + originalIndex / 100
}

function sectionRank(step) {
  const text = `${step?.section || ''} ${step?.id || ''} ${step?.title || ''}`.toLowerCase()
  if (text.includes('missing')) return 0
  if (text.includes('clean') || text.includes('suggest')) return 1
  if (text.includes('categor')) return 2
  if (text.includes('feature') || text.includes('engineer') || text.includes('transform')) return 3
  return 5
}

function statusLabel(status) {
  const labels = {
    pending: 'pending',
    active: 'current',
    completed: 'completed',
    stale: 'stale',
    warning: 'recommended',
    blocked: 'blocked',
  }
  return labels[status] || status
}

function WhyThisMatters({ text }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginTop: 6 }}>
      <button className="ax-link-btn" type="button" onClick={() => setOpen((current) => !current)}>
        Why this matters
      </button>
      {open && (
        <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
          {text}
        </p>
      )}
    </div>
  )
}

function GuidedPlanModal({ isAI, mode, error, summary, items, nextStepId, onClose, onGo }) {
  return (
    <div className="ax-plan-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="ax-plan-modal" role="dialog" aria-modal="true" aria-label="Full guided plan" onMouseDown={(event) => event.stopPropagation()}>
        <div className="ax-plan-modal-header">
          <div>
            <p style={{ fontSize: 18, fontWeight: 850, margin: 0 }}>{isAI ? 'AI Guided Plan' : 'System Guided Plan'}</p>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '3px 0 0' }}>
              {mode === 'auto' && isAI ? 'AI generated' : 'Built-in workflow'} - {items.length} ordered steps
            </p>
          </div>
          <button className="ax-btn" type="button" onClick={onClose}>Close</button>
        </div>
        {error && (
          <div className="ax-plan-fallback" style={{ margin: '0 0 12px' }}>
            <strong>AI plan unavailable.</strong>
            <span>Using built-in guided workflow.</span>
          </div>
        )}
        {summary && <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 12px' }}>{summary}</p>}
        <div className="ax-plan-modal-list">
          {items.map(({ step, state }, position) => {
            const isCompleted = state.status === 'completed'
            const isNext = nextStepId === step.id && !isCompleted
            const displayStatus = isNext ? 'active' : state.status
            const target = targetForStep(step)
            return (
              <article key={`${step.id}-${position}`} className={`ax-plan-step ax-plan-step-full ${displayStatus} ${isNext ? 'next' : ''}`}>
                <span className="ax-plan-check">{position + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <p style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{step.title}</p>
                    <span className={`ax-plan-status ${displayStatus}`}>{statusLabel(displayStatus)}</span>
                  </div>
                  {state.status === 'stale' && (
                    <p style={{ fontSize: 12, color: 'var(--color-text-warning)', margin: '4px 0 0' }}>
                      Re-run recommended because the dataset changed after this step.
                    </p>
                  )}
                  {step.rationale && <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '6px 0 0' }}>{step.rationale}</p>}
                  {step.columns?.length > 0 && (
                    <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '6px 0 0' }}>
                      Columns: {step.columns.join(', ')}
                    </p>
                  )}
                  <div className="ax-plan-target">
                    <span>Use</span>
                    <strong>{target.label}</strong>
                    <small>{target.hint}</small>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                    <button className="ax-btn mini prim" type="button" onClick={() => onGo(step)}>
                      {state.status === 'stale' ? 'Re-run ' : 'Open '}{target.shortLabel}
                    </button>
                    {step.rationale && <WhyThisMatters text={step.rationale} />}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Chevron({ open }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
      <path d="M3 1L7 5L3 9" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  )
}

function labelForPage(page) {
  const labels = {
    data: 'Data',
    expand: 'Expand',
    describe: 'Describe',
    tests: 'Analysis',
    models: 'Models',
    whatif: 'What-if',
    report: 'Report',
  }
  return labels[page] || page
}

function sectionForStep(step) {
  return targetForStep(step).section
}

function targetForStep(step) {
  if (step.section) {
    return {
      section: step.section,
      label: `${labelForPage(step.page)} > Recommended section`,
      shortLabel: labelForPage(step.page),
      hint: 'Open the exact section recommended for this step.',
    }
  }
  const text = `${step.id || ''} ${step.title || ''}`.toLowerCase()
  if (step.page === 'data') {
    if (text.includes('categor')) {
      return {
        section: 'data-section-category_standardization',
        label: 'Data > Category standardization',
        shortLabel: 'category standardization',
        hint: 'Review grouped labels, rename labels, then apply the mapping.',
      }
    }
    if (text.includes('missing') || text.includes('outlier') || text.includes('duplicate')) {
      return {
        section: 'fix-cleaning-suggestions',
        label: 'Data > Suggested fixes by issue type',
        shortLabel: 'suggested fixes',
        hint: 'Choose the issue group, select the method, then apply the grouped fix.',
      }
    }
    return {
      section: 'data-section-manual_transforms',
      label: 'Data > Manual transforms',
      shortLabel: 'manual transforms',
      hint: 'Use rename, drop, type, and transform controls for direct preparation.',
    }
  }
  if (step.page === 'expand') {
    return {
      section: 'expand-section-controls',
      label: 'Expand > Row expansion controls',
      shortLabel: 'expansion controls',
      hint: 'Choose bootstrap or synthetic expansion and set the target row count.',
    }
  }
  if (step.page === 'describe') {
    return {
      section: 'describe-section-variables',
      label: 'Describe > Variable summaries',
      shortLabel: 'descriptive summaries',
      hint: 'Select variables and generate statistics, charts, and interpretation.',
    }
  }
  if (step.page === 'models') {
    if (text.includes('feature')) {
      return {
        section: 'fix-feature-selection',
        label: 'Models > Feature selection',
        shortLabel: 'feature selection',
        hint: 'Choose the input columns to use for model training.',
      }
    }
    return {
      section: 'fix-target-handling',
      label: 'Models > Target setup',
      shortLabel: 'target setup',
      hint: 'Pick the target, validate task type, then configure split and algorithms.',
    }
  }
  if (step.page === 'tests') {
    return {
      section: 'fix-correlation-test',
      label: 'Analysis > Test setup',
      shortLabel: 'analysis setup',
      hint: 'Choose the test type and variables for relationship or group analysis.',
    }
  }
  if (step.page === 'whatif') {
    return {
      section: 'whatif-section-controls',
      label: 'What-if > Scenario controls',
      shortLabel: 'scenario controls',
      hint: 'Load a saved model, adjust feature values, and save scenarios.',
    }
  }
  if (step.page === 'report') {
    return {
      section: 'ax-report-preview',
      label: 'Report > Report preview',
      shortLabel: 'report preview',
      hint: 'Select sections, generate the report, then print or export.',
    }
  }
  return {
    section: '',
    label: labelForPage(step.page),
    shortLabel: labelForPage(step.page),
    hint: 'Open the recommended page and continue the workflow there.',
  }
}

function highlightSection(section) {
  if (!section) return
  const el = document.getElementById(section)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ax-fix-highlight')
  window.setTimeout(() => el.classList.remove('ax-fix-highlight'), 2600)
}
