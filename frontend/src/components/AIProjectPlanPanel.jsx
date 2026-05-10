/* ============================================================
 * COMPONENT: AI PROJECT PLAN PANEL
 * Keywords: ai, project plan, suggested workflow, recommend
 * ============================================================ */
import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { SkeletonCards } from './LoadingStates'
import HelpButton from './HelpButton'
import { useAuth } from './AuthProvider'

const PAGE_ORDER = { data: 0, expand: 1, describe: 2, tests: 3, models: 4, whatif: 5, report: 6 }
const PLAN_CACHE_VERSION = 'v4'
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

// Sidebar panel that renders the AI or system guided project plan and tracks progress.
export default function AIProjectPlanPanel({ dataset, activeTab, planH, onCollapsedChange }) {
  const navigate = useNavigate()
  const auth = useAuth()
  const datasetId = dataset?.id
  const stageKey = dataset?.current_stage_id || 'original'
  const doneKey = datasetId ? `simucast.aiPlan.done.${datasetId}.${stageKey}` : ''
  const skipKey = datasetId ? `simucast.aiPlan.skipped.${datasetId}.${stageKey}` : ''
  const collapseKey = datasetId ? `simucast.aiPlan.collapsed.${datasetId}` : ''
  const modeKey = datasetId ? `simucast.aiPlan.mode.${datasetId}` : ''
  const [mode, setMode] = useState(() => {
    if (window.localStorage.getItem('simucast.sessionToken') && window.localStorage.getItem('simucast.guestSlot.used') === '1') return 'system'
    if (!modeKey) return 'system'
    const saved = window.localStorage.getItem(modeKey)
    if (!saved || saved === 'off') return 'system'
    return saved
  })
  const [plan, setPlan] = useState(null)
  const [planDatasetId, setPlanDatasetId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState([])
  const [skipped, setSkipped] = useState([])
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

  const cacheKeyFor = (targetMode = mode, targetStage = stageKey) => {
    const scope = targetMode === 'auto' ? 'latest' : targetStage
    return `simucast.aiPlan.${PLAN_CACHE_VERSION}.${datasetId}.${scope}.${targetMode}`
  }

  const load = async (force = false) => {
    if (!datasetId) return
    const cacheKey = cacheKeyFor(mode, stageKey)
    if (!force) {
      const cached = window.localStorage.getItem(cacheKey)
      if (cached) {
        try {
          const cachedPlan = JSON.parse(cached)
          setPlan(cachedPlan)
          setPlanDatasetId(datasetId)
          loadActivity()
          return
        } catch {
          window.localStorage.removeItem(cacheKey)
        }
      }
    }
    setLoading(true)
    setError('')
    if (force || !plan) setPlan(null)
    try {
      const r = await api.aiProjectPlan(datasetId, mode)
      setPlan(r)
      setPlanDatasetId(datasetId)
      window.localStorage.setItem(cacheKey, JSON.stringify(r))
    } catch {
      setError('AI plan unavailable. Using built-in guided workflow.')
      try {
        const fallback = await api.aiProjectPlan(datasetId, 'system')
        setPlan({ ...fallback, error: 'AI plan unavailable. Using built-in guided workflow.' })
        setPlanDatasetId(datasetId)
      } catch {
        setPlan(null)
        setPlanDatasetId(null)
      }
    } finally {
      setLoading(false)
      loadActivity()
    }
  }

  useEffect(() => {
    if (!modeKey) return
    if (auth.isGuest) {
      setMode('system')
      window.localStorage.setItem(modeKey, 'system')
      return
    }
    const saved = window.localStorage.getItem(modeKey)
    setMode(!saved || saved === 'off' ? 'system' : saved)
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
    if (!skipKey) return
    try {
      setSkipped(JSON.parse(window.localStorage.getItem(skipKey) || '[]'))
    } catch {
      setSkipped([])
    }
  }, [skipKey])

  useEffect(() => {
    if (!collapseKey) return
    setCollapsed(window.localStorage.getItem(collapseKey) === '1')
  }, [collapseKey])

  useEffect(() => {
    if (mode === 'system') return
    if (mode === 'auto' && plan && planDatasetId === datasetId) {
      loadActivity()
      return
    }
    load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, mode])

  useEffect(() => {
    if (mode !== 'system') return
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
  const skippedSet = useMemo(() => new Set(skipped), [skipped])
  const progress = useMemo(() => deriveProgress(activity), [activity])
  const latestDataChange = progress.latestDataChangeAt || null
  const stepStates = useMemo(
    () => steps.map((step) => getStepState(step, progress, latestDataChange, doneSet, skippedSet)),
    [steps, progress, latestDataChange, doneSet, skippedSet],
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

  const toggleSkip = (stepId) => {
    const next = skippedSet.has(stepId) ? skipped.filter((id) => id !== stepId) : [...skipped, stepId]
    setSkipped(next)
    if (skipKey) window.localStorage.setItem(skipKey, JSON.stringify(next))
  }

  const handleModeChange = (nextMode) => {
    if (nextMode === mode) return
    if (nextMode === 'auto' && auth.isGuest) {
      auth.requireAccountForAI()
      return
    }
    if (modeKey) window.localStorage.setItem(modeKey, nextMode)
    const nextCacheKey = cacheKeyFor(nextMode, stageKey)
    const cached = window.localStorage.getItem(nextCacheKey)
    if (cached) {
      try {
        setPlan(JSON.parse(cached))
        setPlanDatasetId(datasetId)
      } catch {
        window.localStorage.removeItem(nextCacheKey)
        setPlan(null)
        setPlanDatasetId(null)
      }
    } else {
      setPlan(null)
      setPlanDatasetId(null)
    }
    setError('')
    setMode(nextMode)
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
      className={`ax-card ax-plan-panel${collapsed ? ' ax-plan-collapsed' : ''}`}
      style={!collapsed && planH ? { height: planH, maxHeight: 'none' } : undefined}
    >
      <div className="ax-panel-sticky-header">
        <div className="ax-plan-panel-head" style={{ marginBottom: collapsed ? 0 : 8 }}>
          <div className="ax-plan-title-wrap">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              className="ax-plan-title-button"
            >
              <Chevron open={!collapsed} />
              <span>{isAI ? 'AI Guided Plan' : 'System Guided Plan'}</span>
            </button>
            <HelpButton
              title="Guided Plan"
              text="This card orders the recommended workflow for the current project. The orange card is the current step; completed, stale, optional, and skipped steps are kept calmer so you can focus on what to do next."
            />
          </div>
          {!collapsed && (
            <div className="ax-plan-head-actions">
              <button className="ax-btn mini" type="button" onClick={() => setExpanded(true)} disabled={!plan}>
                Expand plan
              </button>
              {mode === 'auto' && (
                <button className="ax-btn mini" type="button" onClick={() => load(true)} disabled={loading}>
                  {loading ? 'Generating...' : 'Retry AI'}
                </button>
              )}
            </div>
          )}
        </div>

        {!collapsed && (
          <div className="ax-plan-mode" aria-label="Guidance mode" style={{ marginBottom: 0 }}>
            <button type="button" className={mode === 'auto' ? 'active' : ''} onClick={() => handleModeChange('auto')}>
              AI guided{auth.isGuest ? ' 🔒' : ''}
            </button>
            <button type="button" className={mode === 'system' ? 'active' : ''} onClick={() => handleModeChange('system')}>
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

          {loading && plan && (
            <div className="ax-plan-loading-note">
              {mode === 'auto' ? 'Updating AI guided plan...' : 'Updating built-in workflow...'}
            </div>
          )}

          {plan?.summary && (
            <p className="ax-plan-summary">
              {plan.summary}
            </p>
          )}

          {mode === 'system' && plan && (
            <p className="ax-plan-helper">
              {auth.isGuest
                ? 'AI Guided Plan is available after signing up. System Guided Plan still works normally.'
                : 'Built-in workflow updates automatically with project changes.'}
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
                  const requirement = requirementForStep(step)
                  const canSkip = requirement !== 'required' && !isCompleted
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
                            <span className={`ax-plan-requirement ${requirement}`}>{requirement}</span>
                          </div>
                          {state.status === 'stale' && (
                            <p style={{ fontSize: 11, color: 'var(--color-text-warning)', margin: '3px 0 0' }}>
                              Re-run recommended because the dataset changed after this step.
                            </p>
                          )}
                          {step.columns?.length > 0 && (
                            <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', margin: '4px 0 0' }}>
                              {step.columns.slice(0, 4).join(', ')}
                            </p>
                          )}
                          <p style={{ fontSize: 10, color: 'var(--color-primary)', fontWeight: 750, margin: '5px 0 0' }}>
                            {isAI ? 'AI recommended' : 'System recommended'}
                          </p>
                          <div className="ax-plan-target">
                            <span>Use</span>
                            <strong>{target.label}</strong>
                            <small>{target.hint}</small>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                            {state.status !== 'skipped' && (
                              <button className="ax-btn mini" onClick={() => goToStep(step)} type="button">
                                {state.status === 'stale' ? 'Re-run ' : 'Open '}{target.shortLabel}
                              </button>
                            )}
                            {canSkip && state.status !== 'skipped' && (
                              <button className="ax-btn mini" onClick={() => toggleSkip(step.id)} type="button">
                                Skip
                              </button>
                            )}
                            {state.status === 'skipped' && (
                              <button className="ax-btn mini" onClick={() => toggleSkip(step.id)} type="button">
                                Undo skip
                              </button>
                            )}
                          </div>
                          {step.rationale && <WhyThisMatters text={step.rationale} />}
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

// Aggregates activity events into per-step completion and invalidation timestamps for plan progress.
function deriveProgress(activity) {
  const progress = {
    completedAt: {},
    invalidatedAt: {},
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
    const reversal = isReversalAction(action, kind, summary)
    if (isDataChangingAction(action) || item.related_stage_id || item.ref_type === 'stage') {
      progress.latestDataChangeAt = Math.max(progress.latestDataChangeAt || 0, createdAt)
    }
    if (reversal) {
      const invalidatedKey = dataKeyFromText(action, summary)
      if (invalidatedKey) {
        invalidate(progress, invalidatedKey, createdAt)
      } else if (`${action} ${kind} ${summary}`.includes('reset') || `${action} ${kind} ${summary}`.includes('restore')) {
        for (const key of ['data:manual', 'data:missing', 'data:outliers', 'data:duplicates', 'data:category', 'data:feature']) {
          invalidate(progress, key, createdAt)
        }
      }
      continue
    }
    if (kind === 'analysis' || category === 'analysis') {
      if (action === 'describe' || summary.includes('describe')) mark(progress, 'describe', createdAt)
      if (action.startsWith('test_') || summary.includes('test') || action === 'cluster' || action === 'pca') mark(progress, 'tests', createdAt)
    }
    if (action === 'train_model' || kind === 'model' || category === 'model') mark(progress, 'models', createdAt)
    if (action === 'save_whatif_scenario' || kind === 'whatif' || category === 'whatif') mark(progress, 'whatif', createdAt)
    if (action === 'generate_report' || kind === 'report' || category === 'report') mark(progress, 'report', createdAt)
    const dataKey = dataCompletionKey(action, summary)
    if (dataKey) mark(progress, dataKey, createdAt)
    if (action === 'expand') mark(progress, 'expand', createdAt)
  }
  return progress
}

// Records the latest completion timestamp for a given progress page key.
function mark(progress, page, at) {
  progress.completedAt[page] = Math.max(progress.completedAt[page] || 0, at)
}

// Records the latest invalidation timestamp for a given progress key.
function invalidate(progress, key, at) {
  progress.invalidatedAt[key] = Math.max(progress.invalidatedAt[key] || 0, at)
}

// Returns true if the action mutates dataset content and should refresh latestDataChange.
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

// Returns true if the activity entry represents an undo, restore, or reset action.
function isReversalAction(action, kind, summary) {
  const text = `${action || ''} ${kind || ''} ${summary || ''}`.toLowerCase()
  return text.includes('undo')
    || text.includes('undid')
    || text.includes('restore')
    || text.includes('reset project')
    || text.includes('reset dataset')
}

// Returns a data progress key for non-reversal activity entries, or empty string otherwise.
function dataCompletionKey(action, summary) {
  if (isReversalAction(action, '', summary)) return ''
  return dataKeyFromText(action, summary)
}

// Maps activity action and summary text to a specific data:* progress key.
function dataKeyFromText(action, summary) {
  const text = `${action || ''} ${summary || ''}`.toLowerCase()
  const actionText = String(action || '').toLowerCase()
  if (actionText.includes('missing') || actionText === 'impute') return 'data:missing'
  if (actionText.includes('outlier') || actionText.includes('winsor')) return 'data:outliers'
  if (actionText.includes('duplicate')) return 'data:duplicates'
  if (actionText.includes('category_standardization')) return 'data:category'
  if (actionText.includes('feature_engineer')) return 'data:feature'
  if (actionText.includes('rename') || actionText.includes('drop') || actionText.includes('cast') || actionText.includes('split') || actionText.includes('merge') || actionText.includes('type_conversion') || actionText === 'cell_edit' || actionText === 'batch_cell_edit') return 'data:manual'
  if (actionText.startsWith('group_')) {
    if (text.includes('missing')) return 'data:missing'
    if (text.includes('outlier')) return 'data:outliers'
  }
  return ''
}

// Returns the progress key used to determine whether a plan step is complete.
function completionKeyForStep(step) {
  const page = step?.page || 'data'
  if (page !== 'data') return page
  const text = `${step?.section || ''} ${step?.id || ''} ${step?.title || ''}`.toLowerCase()
  if (text.includes('missing')) return 'data:missing'
  if (text.includes('outlier')) return 'data:outliers'
  if (text.includes('duplicate')) return 'data:duplicates'
  if (text.includes('categor') || text.includes('standard')) return 'data:category'
  if (text.includes('feature') || text.includes('engineer') || text.includes('bin') || text.includes('format')) return 'data:feature'
  if (text.includes('manual') || text.includes('transform') || text.includes('rename') || text.includes('drop') || text.includes('type')) return 'data:manual'
  return page
}

// Computes the display status of a plan step based on progress, data changes, and overrides.
function getStepState(step, progress, latestDataChange, doneSet, skippedSet) {
  const page = step.page || 'data'
  if (skippedSet.has(step.id)) return { step, status: 'skipped' }
  const completionKey = completionKeyForStep(step)
  const completedAt = progress.completedAt[completionKey] || progress.completedAt[page]
  const invalidatedAt = progress.invalidatedAt?.[completionKey] || 0
  const manuallyDone = doneSet.has(step.id)
  const downstream = (PAGE_ORDER[page] ?? 0) > PAGE_ORDER.data
  if (completedAt && invalidatedAt > completedAt) {
    return { step, status: 'stale', completedAt }
  }
  if ((completedAt || manuallyDone) && downstream && latestDataChange && completedAt && latestDataChange > completedAt) {
    return { step, status: 'stale', completedAt }
  }
  if (completedAt || manuallyDone) return { step, status: 'completed', completedAt }
  if (['blocked', 'warning'].includes(step.status)) return { step, status: step.status }
  if (step.priority === 'high') return { step, status: 'warning' }
  return { step, status: 'pending' }
}

// Classifies a step as required, recommended, or optional based on its id and priority text.
function requirementForStep(step) {
  const text = `${step?.id || ''} ${step?.title || ''} ${step?.priority || ''}`.toLowerCase()
  if (text.includes('optional') || step?.priority === 'low') return 'optional'
  if (text.includes('missing') || text.includes('target') || text.includes('train candidate') || text.includes('report')) return 'required'
  return 'recommended'
}

// Computes a sort weight that orders steps by page, section rank, and original index.
function workflowSort(step, originalIndex = 0) {
  const pageScore = PAGE_ORDER[step?.page || 'data'] ?? 99
  const sectionScore = sectionRank(step)
  return pageScore * 1000 + sectionScore * 10 + originalIndex / 100
}

// Returns a numeric rank used to order steps within a page by typical workflow sequence.
function sectionRank(step) {
  const text = `${step?.section || ''} ${step?.id || ''} ${step?.title || ''}`.toLowerCase()
  if (text.includes('raw') || text.includes('review dataset') || text.includes('export')) return 0
  if (text.includes('manual') || text.includes('transform') || text.includes('rename') || text.includes('drop') || text.includes('type')) return 1
  if (text.includes('missing')) return 2
  if (text.includes('outlier')) return 3
  if (text.includes('duplicate')) return 4
  if (text.includes('clean') || text.includes('suggest')) return 5
  if (text.includes('categor') || text.includes('standard')) return 6
  if (text.includes('feature') || text.includes('engineer') || text.includes('bin') || text.includes('format')) return 7
  return 5
}

// Maps an internal step status code to a user-facing label string.
function statusLabel(status) {
  const labels = {
    pending: 'pending',
    active: 'current',
    completed: 'completed',
    stale: 'stale',
    warning: 'recommended',
    blocked: 'blocked',
    skipped: 'skipped',
  }
  return labels[status] || status
}

// Component with a toggle button that reveals expanded explanation text for a step.
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

// Modal dialog that displays the full guided plan with all steps and their statuses.
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
          <HelpButton
            title="Full Guided Plan"
            text="This expanded view shows every workflow step, its status, why it matters, and the exact SimuCast feature to open. Actions here use the same routing and card highlight as the sidebar plan."
          />
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
                    <span style={{ fontSize: 11, color: 'var(--color-primary)', fontWeight: 750 }}>
                      {isAI ? 'AI recommended' : 'System recommended'}
                    </span>
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

// Small SVG chevron icon that rotates between pointing right and down based on open state.
function Chevron({ open }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
      <path d="M3 1L7 5L3 9" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  )
}

// Returns the user-facing display label for a workflow page identifier.
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

// Returns just the DOM section id that a given plan step should scroll to.
function sectionForStep(step) {
  return targetForStep(step).section
}

// Returns routing info (section id, label, hint) describing where a plan step should open.
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
    if (text.includes('feature') || text.includes('engineer') || text.includes('bin') || text.includes('format')) {
      return {
        section: 'data-section-feature_engineering',
        label: 'Data > Optional feature tools and numeric formatting',
        shortLabel: 'optional feature tools',
        hint: 'Create optional binned features or format numeric precision when useful.',
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

// Scrolls to a section by id and briefly applies a highlight class for emphasis.
function highlightSection(section) {
  if (!section) return
  const el = document.getElementById(section)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ax-fix-highlight')
  window.setTimeout(() => el.classList.remove('ax-fix-highlight'), 2600)
}
