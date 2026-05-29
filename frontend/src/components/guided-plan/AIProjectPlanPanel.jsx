/* ============================================================
 * COMPONENT: AI PROJECT PLAN PANEL
 * Keywords: ai, project plan, suggested workflow, recommend
 * ============================================================ */
import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { SkeletonCards } from '../common/LoadingStates'
import HelpButton from '../common/HelpButton'
import { useAuth } from '../providers/AuthProvider'
import { currentCoachStep, firstCoachStep, goalLabel } from './ProjectGuidanceSetup'

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
export default function AIProjectPlanPanel({
  dataset,
  activeTab,
  planH,
  onCollapsedChange,
  onOpenGuidanceSetup,
  onGuidanceUpdated,
  cleaningIssues,
}) {
  const navigate = useNavigate()
  const auth = useAuth()
  const datasetId = dataset?.id
  const stageKey = dataset?.current_stage_id || 'original'
  const guidance = dataset?.guidance || {}
  const guidanceGoal = guidance.goal || 'general'
  const guidanceQuestionKey = encodeURIComponent((guidance.question_text || '').slice(0, 80) || 'no-question')
  const doneKey = datasetId ? `simucast.aiPlan.done.${datasetId}.${stageKey}` : ''
  const skipKey = datasetId ? `simucast.aiPlan.skipped.${datasetId}.${stageKey}` : ''
  const collapseKey = datasetId ? `simucast.aiPlan.collapsed.${datasetId}` : ''
  const modeKey = datasetId ? `simucast.aiPlan.mode.${datasetId}` : ''
  const [mode, setMode] = useState(() => {
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
  const [expandedCardId, setExpandedCardId] = useState(null)

  const goToExpandPage = () => {
    if (!datasetId) return
    navigate(`/projects/${datasetId}/expand`)
  }

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
    return `simucast.aiPlan.${PLAN_CACHE_VERSION}.${datasetId}.${scope}.${guidanceGoal}.${guidanceQuestionKey}.${targetMode}`
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
    setMode(saved && saved !== 'off' ? saved : 'system')
  }, [modeKey, auth.isGuest])

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
  }, [datasetId, guidanceGoal, guidanceQuestionKey, mode])

  useEffect(() => {
    if (mode !== 'system') return
    load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, guidanceGoal, guidanceQuestionKey, stageKey, mode])

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

  const updateGuidance = async (body) => {
    if (!datasetId) return
    const response = await api.updateGuidance(datasetId, body)
    onGuidanceUpdated?.(response.guidance)
  }

  const toggleGuidedMode = async () => {
    const start = firstCoachStep(guidance.goal, dataset, cleaningIssues)
    const activeStep = currentCoachStep(guidance, dataset, cleaningIssues) || start
    const nextGuidedMode = !guidance.guided_mode
    await updateGuidance({
      guided_mode: nextGuidedMode,
      walkthrough_step: nextGuidedMode ? (activeStep?.id || start?.id || null) : null,
    })
    if (nextGuidedMode && activeStep) {
      window.setTimeout(() => goToStep(activeStep), 80)
    }
  }

  const completedCount = planItems.filter((item) => item.state.status === 'completed').length
  const totalCount = planItems.length

  const goalName = guidance.question_text || (guidance.goal ? goalLabel(guidance.goal) : 'prediction')
  const goalCleaned = goalName.toLowerCase().startsWith('predict ') ? goalName.slice(8) + ' prediction' : goalName

  const activeExpandedId = expandedCardId !== null ? expandedCardId : nextStepState?.step?.id

  return (
    <section
      className="ax-card ax-module-card ax-card-ai ax-plan-panel"
      style={planH ? { height: planH, maxHeight: 'none' } : undefined}
    >
      <div className="ax-plan-wrapper-fixed">
        {/* Pinned Top Header */}
        <div className="ax-plan-header-fixed">
          {/* 1. Goal Header */}
          <div className="ax-plan-goal-header">
            <div className="ax-plan-goal-circle-1" />
            <div className="ax-plan-goal-circle-2" />
            <div className="ax-plan-goal-header-content">
              <div className="ax-plan-goal-label">Prediction goal</div>
              <div className="ax-plan-goal-value">
                {guidance.question_text || (guidance.goal ? goalLabel(guidance.goal) : 'Choose a project question')}
              </div>
              <div className="ax-plan-goal-stats">
                {Number(dataset?.row_count || 0).toLocaleString()} rows · {dataset?.col_count || 0} variables{plan?.task ? ` · ${plan.task}` : ''}
              </div>
              <button className="ax-plan-goal-change-btn" type="button" onClick={onOpenGuidanceSetup}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4 }}>
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z" />
                </svg>
                Change goal
              </button>
              <button
                className={`ax-plan-guide-toggle-btn ${guidance.guided_mode ? 'active' : ''}`}
                type="button"
                onClick={toggleGuidedMode}
              >
                {guidance.guided_mode ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4 }}>
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                    Stop guide
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4 }}>
                      <path d="M5 12h14M13 5l7 7-7 7" />
                    </svg>
                    Start guide
                  </>
                )}
              </button>
            </div>
          </div>

            {/* 2. AI Assisted / Built-in Toggle */}
            <div style={{ padding: '0 14px' }}>
              <div className="ax-plan-mode" aria-label="Guidance mode" style={{ margin: '0 0 8px' }}>
                <button type="button" className={mode === 'auto' ? 'active' : ''} onClick={() => handleModeChange('auto')}>
                  AI assisted
                </button>
                <button type="button" className={mode === 'system' ? 'active' : ''} onClick={() => handleModeChange('system')}>
                  Built-in
                </button>
              </div>
              {mode === 'auto' && (
              <div className="ax-plan-mode-note">
                AI analyzes your dataset and suggests steps tailored to its specific patterns.
              </div>
            )}
            </div>

            {/* 3. Progress Bar */}
            <div className="ax-plan-progress-container">
              <div className="ax-plan-progress-bar-track">
                <div
                  className="ax-plan-progress-bar-fill"
                  style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
                />
              </div>
              <span className="ax-plan-progress-label">
                {completedCount} of {totalCount} done
              </span>
            </div>
          </div>

          {/* Scrollable Body Content */}
          <div className="ax-plan-body-scrollable">
            {/* Fallbacks, loading note & summary */}
            {(plan?.error || error || isAutoFallback) && (
              <div className="ax-plan-fallback" style={{ margin: '0 14px 10px' }}>
                <strong>AI plan unavailable.</strong>
                <span>Using built-in guided workflow.</span>
              </div>
            )}

            {loading && !plan && (
              <div style={{ padding: '0 14px' }}>
                <SkeletonCards count={3} />
              </div>
            )}

            {loading && plan && (
              <div className="ax-plan-loading-note" style={{ margin: '0 14px 10px' }}>
                {mode === 'auto' ? 'Updating AI guided plan...' : 'Updating built-in workflow...'}
              </div>
            )}

            {plan?.summary && (
              <p className="ax-plan-summary" style={{ padding: '0 14px 10px' }}>
                {plan.summary}
              </p>
            )}

            {/* 4. Step Cards */}
            {plan && (
              <div className="ax-plan-list" style={{ padding: '0 14px' }}>
                {planItems.map(({ step, state }, position) => {
                  const isCompleted = state.status === 'completed'
                  const isNext = nextStepState?.step?.id === step.id
                  const displayStatus = isNext && !isCompleted ? 'active' : state.status
                  const isCardExpanded = activeExpandedId === step.id
                  const target = targetForStep(step)
                  const requirement = requirementForStep(step)

                  const cardClass = `ax-plan-step-redesigned state-${isCompleted ? 'completed' : isNext ? 'active' : 'pending'}`

                  return (
                    <article key={`${step.id}-${position}`} className={cardClass}>
                      {/* Card Header (always visible) */}
                      <div className="ax-plan-step-header" onClick={() => setExpandedCardId(isCardExpanded ? 'none' : step.id)}>
                        <span className="ax-plan-check">
                          {isCompleted ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : position + 1}
                        </span>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <p className="ax-plan-step-title" style={{ fontSize: '13px', fontWeight: '750', color: 'var(--color-text-primary)', margin: 0, whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip' }}>
                            {step.title}
                          </p>
                          {isCardExpanded && (
                            <div className="ax-plan-step-badges" style={{ display: 'flex', gap: '4px' }}>
                              <span className={`ax-plan-status ${displayStatus}`}>{statusLabel(displayStatus)}</span>
                              <span className={`ax-plan-requirement ${requirement}`}>{requirement}</span>
                            </div>
                          )}
                        </div>
                        <div className={`ax-plan-step-chevron${isCardExpanded ? ' open' : ''}`}>
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M1 3.5L5 7.5L9 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
                          </svg>
                        </div>
                      </div>

                      {/* Card Body (only visible if expanded) */}
                      {isCardExpanded && (
                        <div className="ax-plan-step-body">
                          {/* Affects Section */}
                          {step.columns?.length > 0 && (
                            <div className="ax-plan-affects-container">
                              <span className="ax-plan-affects-label">Affects:</span>
                              <div className="ax-plan-column-chips">
                                {step.columns.map((col, idx) => (
                                  <span key={idx} className="ax-plan-column-chip">
                                    {col}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Stale Warning */}
                          {state.status === 'stale' && (
                            <p style={{ fontSize: 11, color: 'var(--color-text-warning)', margin: '0 0 8px', fontWeight: 500 }}>
                              Re-run recommended because the dataset changed after this step.
                            </p>
                          )}

                          {/* Toolbar Pointer Row */}
                          <div className="ax-plan-pointer-box">
                            <div className="ax-plan-pointer-icon-wrap">
                              {(() => {
                                const text = `${step.id} ${step.title}`.toLowerCase();
                                let path = null;
                                if (text.includes('missing')) {
                                  path = <><circle cx="12" cy="12" r="8" /><path d="M12 4v.01M12 20v.01M4 12h.01M20 12h.01" /></>;
                                } else if (text.includes('outlier')) {
                                  path = <><path d="M12 3l9 16H3L12 3z" /><path d="M12 9v4M12 17h.01" /></>;
                                } else if (text.includes('duplicate')) {
                                  path = <><path d="M8 8h8v8H8z" /><path d="M6 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1M4 4l16 16" /></>;
                                } else if (text.includes('categor') || text.includes('label')) {
                                  path = <><path d="M4 4h6l10 10-6 6L4 10V4z" /><circle cx="8" cy="8" r="1" /></>;
                                } else if (text.includes('bin')) {
                                  path = <><path d="M4 19h16" /><path d="M7 16V9M12 16V5M17 16v-3" /></>;
                                } else if (text.includes('format')) {
                                  path = <><path d="M5 9h14M5 15h14M9 4L7 20M17 4l-2 16" /></>;
                                } else if (step.page === 'expand') {
                                  path = <><path d="M4 15l11-11 5 5-11 11-5-5z" /><path d="M8 15l-1-1M11 12l-1-1M14 9l-1-1" /></>;
                                } else {
                                  path = <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 17V7l7 5-7 5z" /></>;
                                }
                                return (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                                    {path}
                                  </svg>
                                );
                              })()}
                            </div>
                            <div className="ax-plan-pointer-info">
                              <div className="ax-plan-pointer-tool">{target.shortLabel || step.title}</div>
                              <div className="ax-plan-pointer-path">
                                {target.label.includes(' — ') ? (
                                  <>
                                    {target.label.split(' — ')[0]} —
                                    <br />
                                    <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
                                      {target.label.split(' — ')[1]}
                                    </span>
                                  </>
                                ) : target.label.includes(' → ') ? (
                                  <>
                                    {target.label.split(' → ')[0]} →
                                    <br />
                                    {target.label.split(' → ')[1]}
                                  </>
                                ) : target.label}
                              </div>
                            </div>
                            <button
                              className="ax-plan-pointer-open-btn"
                              type="button"
                              onClick={() => goToStep(step)}
                            >
                              Open ↑
                            </button>
                          </div>

                          {/* Actions Row */}
                          <div className="ax-plan-card-actions-row">
                            {step.rationale ? (
                              <WhyThisMattersInline text={step.rationale} />
                            ) : (
                              <div />
                            )}
                            {isCompleted ? (
                              <span style={{ color: '#16a34a', fontSize: '11px', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '4px', paddingRight: '8px' }}>
                                ✓ Completed
                              </span>
                            ) : (
                              <button
                                className="ax-plan-mark-done-btn"
                                type="button"
                                onClick={() => toggleDone(step.id)}
                              >
                                ✓ Mark done
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </div>

          {/* 5. Navigation Footer */}
          <div className="ax-plan-footer">
            <button
              className="ax-plan-footer-expand-btn"
              type="button"
              disabled={completedCount < 3}
              onClick={goToExpandPage}
            >
              Go to Expand →
            </button>
          </div>
        </div>

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

function WhyThisMattersInline({ text }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      <button
        className="ax-plan-why-link"
        type="button"
        onClick={() => setOpen(!open)}
      >
        {open ? '▼' : '▶'} Why this matters
      </button>
      {open && (
        <div className="ax-plan-why-content">
          {text}
        </div>
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
  const text = `${step.id || ''} ${step.title || ''} ${step.section || ''}`.toLowerCase()
  if (step.page === 'data') {
    if (text.includes('categor') || text.includes('label')) {
      return {
        section: 'data-section-category_standardization',
        label: 'Labels — Transform group in toolbar',
        shortLabel: 'Labels',
        hint: 'Review grouped labels, rename labels, then apply the mapping.',
      }
    }
    if (text.includes('outlier')) {
      return {
        section: 'fix-cleaning-suggestions',
        label: 'Outliers — Quality group in toolbar',
        shortLabel: 'Outliers',
        hint: 'Choose the issue group, select the method, then apply the grouped fix.',
      }
    }
    if (text.includes('duplicate')) {
      return {
        section: 'fix-cleaning-suggestions',
        label: 'Duplicates — Quality group in toolbar',
        shortLabel: 'Duplicates',
        hint: 'Choose the issue group, select the method, then apply the grouped fix.',
      }
    }
    if (text.includes('missing')) {
      return {
        section: 'fix-cleaning-suggestions',
        label: 'Missing — Quality group in toolbar',
        shortLabel: 'Missing',
        hint: 'Choose the issue group, select the method, then apply the grouped fix.',
      }
    }
    if (text.includes('bin')) {
      return {
        section: 'data-section-feature_engineering',
        label: 'Bin — Transform group in toolbar',
        shortLabel: 'Bin',
        hint: 'Create optional binned features or format numeric precision when useful.',
      }
    }
    if (text.includes('format')) {
      return {
        section: 'data-section-feature_engineering',
        label: 'Format — Transform group in toolbar',
        shortLabel: 'Format',
        hint: 'Format numeric decimals or display precision when useful.',
      }
    }
    return {
      section: 'data-section-manual_transforms',
      label: 'Manual Transforms — Structure group in toolbar',
      shortLabel: 'Transforms',
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
    section: step.section || '',
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
