import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

export default function AIProjectPlanPanel({ dataset, activeTab }) {
  const navigate = useNavigate()
  const datasetId = dataset?.id
  const stageKey = dataset?.current_stage_id || 'original'
  const doneKey = datasetId ? `simucast.aiPlan.done.${datasetId}.${stageKey}` : ''
  const collapseKey = datasetId ? `simucast.aiPlan.collapsed.${datasetId}` : ''
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState([])
  const [collapsed, setCollapsed] = useState(false)

  const load = async (force = false) => {
    if (!datasetId) return
    const cacheKey = `simucast.aiPlan.${datasetId}.${stageKey}.auto`
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
      const r = await api.aiProjectPlan(datasetId, 'auto')
      setPlan(r)
      window.localStorage.setItem(cacheKey, JSON.stringify(r))
    } catch (err) {
      setError(err.message || 'Could not generate plan')
    } finally {
      setLoading(false)
    }
  }

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
  }, [datasetId, stageKey])

  const steps = plan?.steps || []
  const doneSet = useMemo(() => new Set(done), [done])
  const nextStep = steps.find((step) => !doneSet.has(step.id))

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
          <span style={{ fontSize: 16, fontWeight: 800 }}>AI Guided Plan</span>
        </button>
      </div>

      {!collapsed && plan?.error && (
        <div className="ax-plan-fallback">
          <strong>AI call failed</strong>
          <span>{plan.error}</span>
        </div>
      )}

      {!collapsed && loading && !plan && (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>
          Planning the workflow...
        </p>
      )}
      {!collapsed && error && <p style={{ fontSize: 12, color: 'var(--color-text-danger)', margin: 0 }}>{error}</p>}
      {!collapsed && plan?.summary && (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 10px' }}>
          {plan.summary}
        </p>
      )}

      {!collapsed && plan && (
        <div className="ax-plan-list">
          {steps.map((step, index) => {
            const isDone = doneSet.has(step.id)
            const isNext = nextStep?.id === step.id
            const isHere = step.page === activeTab
            const target = targetForStep(step)
            return (
              <article
                key={`${step.id}-${index}`}
                className={`ax-plan-step ${isDone ? 'done' : ''} ${isNext ? 'next' : ''}`}
              >
                <button
                  className="ax-plan-check"
                  onClick={() => toggleDone(step.id)}
                  type="button"
                  aria-label={isDone ? 'Mark step incomplete' : 'Mark step complete'}
                >
                  {isDone ? '✓' : index + 1}
                </button>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <p style={{ fontSize: 13, fontWeight: 750, margin: 0 }}>{step.title}</p>
                    {isNext && <span className="ax-chip ax-plan-chip">next</span>}
                    {isHere && <span className="ax-chip">here</span>}
                  </div>
                  {step.rationale && (
                    <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '3px 0 0' }}>
                      {step.rationale}
                    </p>
                  )}
                  {step.columns?.length > 0 && (
                    <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', margin: '4px 0 0' }}>
                      {step.columns.slice(0, 4).join(', ')}
                    </p>
                  )}
                  <div className="ax-plan-target">
                    <span>Use</span>
                    <strong>{target.label}</strong>
                    <small>{target.hint}</small>
                  </div>
                  <button className="ax-btn mini" onClick={() => goToStep(step)} type="button" style={{ marginTop: 6 }}>
                    Open {target.shortLabel}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
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
