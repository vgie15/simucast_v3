import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

export default function AIProjectPlanPanel({ dataset, activeTab }) {
  const navigate = useNavigate()
  const datasetId = dataset?.id
  const stageKey = dataset?.current_stage_id || 'original'
  const doneKey = datasetId ? `simucast.aiPlan.done.${datasetId}.${stageKey}` : ''
  const collapseKey = datasetId ? `simucast.aiPlan.collapsed.${datasetId}` : ''
  const modeKey = datasetId ? `simucast.aiPlan.mode.${datasetId}` : ''
  const [mode, setMode] = useState(() => (modeKey ? window.localStorage.getItem(modeKey) || 'auto' : 'auto'))
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState([])
  const [collapsed, setCollapsed] = useState(false)

  const load = async (force = false) => {
    if (!datasetId || mode === 'off') return
    const cacheKey = `simucast.aiPlan.${datasetId}.${stageKey}.${mode}`
    if (!force) {
      const cached = window.localStorage.getItem(cacheKey)
      if (cached) {
        try {
          setPlan(JSON.parse(cached))
          return
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
    } catch (err) {
      setError(err.message || 'Could not generate plan')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!modeKey) return
    const saved = window.localStorage.getItem(modeKey) || 'auto'
    setMode(saved)
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

  const PAGE_ORDER = { data: 0, expand: 1, describe: 2, tests: 3, models: 4, whatif: 5, report: 6 }
  const currentPageOrder = PAGE_ORDER[activeTab] ?? -1

  const steps = plan?.steps || []
  const doneSet = useMemo(() => new Set(done), [done])

  const isEffectiveDone = (step) =>
    doneSet.has(step.id) || (PAGE_ORDER[step.page] ?? 99) < currentPageOrder

  const nextStep = steps.find((step) => !isEffectiveDone(step))
  const isAI = plan?.ai === true
  const isAutoFallback = mode === 'auto' && plan && plan.ai !== true

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c
      if (collapseKey) window.localStorage.setItem(collapseKey, next ? '1' : '0')
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
    <section className="ax-card ax-plan-panel">
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
        </div>

        {!collapsed && (
          <div className="ax-plan-mode" aria-label="Guidance mode" style={{ marginBottom: 0 }}>
            <button
              type="button"
              className={mode === 'auto' ? 'active' : ''}
              onClick={() => setGuidanceMode('auto', modeKey, setMode, setPlan)}
            >
              AI guided
            </button>
            <button
              type="button"
              className={mode === 'system' ? 'active' : ''}
              onClick={() => setGuidanceMode('system', modeKey, setMode, setPlan)}
            >
              System only
            </button>
            <button
              type="button"
              className={mode === 'off' ? 'active' : ''}
              onClick={() => setGuidanceMode('off', modeKey, setMode, setPlan)}
            >
              Hide
            </button>
          </div>
        )}
      </div>{/* end sticky header */}

      {!collapsed && (
        <>
          {mode === 'off' && (
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
              Guided planning is off for this project.
            </p>
          )}

          {mode !== 'off' && plan?.error && (
            <div className="ax-plan-fallback">
              <strong>AI call failed</strong>
              <span>{plan.error}</span>
            </div>
          )}

          {mode !== 'off' && loading && !plan && (
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>
              Planning the workflow...
            </p>
          )}
          {mode !== 'off' && error && (
            <p style={{ fontSize: 12, color: 'var(--color-text-danger)', margin: 0 }}>{error}</p>
          )}
          {mode !== 'off' && isAutoFallback && (
            <div className="ax-plan-fallback">
              <strong>AI unavailable</strong>
              <span>
                Could not generate an AI plan. Switch to <strong>System only</strong> to use the built-in workflow guide.
              </span>
            </div>
          )}
          {mode !== 'off' && !isAutoFallback && plan?.summary && (
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 10px' }}>
              {plan.summary}
            </p>
          )}

          {mode !== 'off' && !isAutoFallback && plan && (
            <div className="ax-plan-list">
              {steps
                .map((step, index) => ({ step, index }))
                .sort((a, b) => {
                  const aDone = isEffectiveDone(a.step) ? 1 : 0
                  const bDone = isEffectiveDone(b.step) ? 1 : 0
                  return aDone - bDone || a.index - b.index
                })
                .map(({ step, index }, position) => {
                  const isDone = isEffectiveDone(step)
                  const isNext = nextStep?.id === step.id
                  const target = targetForStep(step)
                  const pendingCount = steps.filter((s) => !isEffectiveDone(s)).length
                  const showDoneDivider = isDone && position === pendingCount && pendingCount < steps.length
                  return (
                    <React.Fragment key={`${step.id}-${index}`}>
                      {showDoneDivider && (
                        <div className="ax-plan-done-divider">
                          <span>Completed</span>
                        </div>
                      )}
                      <article className={`ax-plan-step ${isDone ? 'done' : ''} ${isNext ? 'next' : ''}`}>
                        <button
                          className="ax-plan-check"
                          onClick={() => toggleDone(step.id)}
                          type="button"
                          aria-label={isDone ? 'Mark step incomplete' : 'Mark step complete'}
                        >
                          {isDone ? '✓' : index + 1}
                        </button>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 750, margin: 0 }}>{step.title}</p>
                          {!isDone && step.rationale && (
                            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '3px 0 0' }}>
                              {step.rationale}
                            </p>
                          )}
                          {!isDone && step.columns?.length > 0 && (
                            <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', margin: '4px 0 0' }}>
                              {step.columns.slice(0, 4).join(', ')}
                            </p>
                          )}
                          {!isDone && (
                            <>
                              <div className="ax-plan-target">
                                <span>Use</span>
                                <strong>{target.label}</strong>
                                <small>{target.hint}</small>
                              </div>
                              <button
                                className="ax-btn mini"
                                onClick={() => goToStep(step)}
                                type="button"
                                style={{ marginTop: 6 }}
                              >
                                Open {target.shortLabel}
                              </button>
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
    </section>
  )
}

function setGuidanceMode(nextMode, modeKey, setMode, setPlan) {
  if (modeKey) window.localStorage.setItem(modeKey, nextMode)
  setMode(nextMode)
  setPlan(null)
}

function Chevron({ open }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
    >
      <path d="M3 1L7 5L3 9" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  )
}

function labelForPage(page) {
  const labels = {
    data: 'Data',
    expand: 'Expand',
    describe: 'Describe',
    tests: 'Tests',
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
      label: 'Tests > Test setup',
      shortLabel: 'test setup',
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
