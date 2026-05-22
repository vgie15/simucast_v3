/* ============================================================
 * COMPONENT: GUIDED COACH
 * Keywords: guided mode, walkthrough, spotlight, onboarding
 * ============================================================ */
import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { currentCoachStep, firstCoachStep, nextCoachStep } from './ProjectGuidanceSetup'

// Spotlight walkthrough that routes users to exact workflow controls.
export default function GuidedCoach({ dataset, activeTab, onGuidanceUpdated }) {
  const navigate = useNavigate()
  const guidance = dataset?.guidance || {}
  const current = currentCoachStep(guidance, dataset) || firstCoachStep(guidance.goal, dataset)
  const [busy, setBusy] = useState(false)
  const [completion, setCompletion] = useState({ checked: false, complete: false })
  const [microIndex, setMicroIndex] = useState(0)
  const [spotlight, setSpotlight] = useState(null)
  const [coachStyle, setCoachStyle] = useState(null)

  const focusSteps = useMemo(() => spotlightStepsForStep(current, dataset, completion.complete), [current, dataset, completion.complete])
  const focusStep = focusSteps[microIndex] || focusSteps[0] || fallbackSpotlightStep(current)
  const focusTarget = focusStep?.section || current?.section
  const onCurrentPage = Boolean(current?.page && current.page === activeTab)

  useEffect(() => {
    setMicroIndex(0)
  }, [current?.id, dataset?.current_stage_id])

  useEffect(() => {
    let cancelled = false
    if (!dataset?.id || !current) return undefined
    setCompletion({ checked: false, complete: false })
    checkCoachCompletion(dataset, current)
      .then((complete) => {
        if (!cancelled) setCompletion({ checked: true, complete })
      })
      .catch(() => {
        if (!cancelled) setCompletion({ checked: true, complete: false })
      })
    return () => {
      cancelled = true
    }
  }, [current?.id, dataset, dataset?.current_stage_id])

  useEffect(() => {
    if (!guidance.guided_mode || !focusTarget || !onCurrentPage) {
      setSpotlight(null)
      setCoachStyle(null)
      return undefined
    }

    const place = () => {
      const el = document.getElementById(focusTarget)
      if (!el) {
        setSpotlight(null)
        setCoachStyle(null)
        return
      }
      const rect = el.getBoundingClientRect()
      const viewportPad = 12
      const width = Math.min(390, window.innerWidth - viewportPad * 2)
      const rectCenter = rect.left + rect.width / 2
      const preferRight = rectCenter < window.innerWidth * 0.52
      const sideLeft = preferRight ? rect.right + 18 : rect.left - width - 18
      const left = clamp(sideLeft, viewportPad, window.innerWidth - width - viewportPad)
      const topCandidate = rect.top < window.innerHeight * 0.56 ? rect.bottom + 14 : rect.top - 350
      const top = clamp(topCandidate, viewportPad, Math.max(viewportPad, window.innerHeight - 370))
      setSpotlight(toSpotlightRect(rect))
      setCoachStyle({ left, top, width, right: 'auto', bottom: 'auto' })
    }

    const timer = window.setTimeout(() => {
      highlightSection(focusTarget)
      focusSection(focusTarget)
      place()
    }, 180)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      clearFocusSection(focusTarget)
    }
  }, [activeTab, focusTarget, guidance.guided_mode, onCurrentPage])

  if (!dataset?.id || !guidance.guided_mode || !guidance.goal || !current) return null

  const persist = async (body) => {
    setBusy(true)
    try {
      const response = await api.updateGuidance(dataset.id, body)
      onGuidanceUpdated?.(response.guidance)
    } finally {
      setBusy(false)
    }
  }

  const routeCurrent = () => routeTarget(dataset.id, { ...current, section: focusTarget }, activeTab, navigate)

  const advanceWorkflow = async (skip = false) => {
    const verifiedComplete = skip ? false : await checkCoachCompletion(dataset, current)
    if (!skip && current.requirement === 'required' && !verifiedComplete) {
      setCompletion({ checked: true, complete: false })
      routeCurrent()
      return
    }
    const dismissed = skip ? [...new Set([...(guidance.dismissed_tips || []), current.id])] : (guidance.dismissed_tips || [])
    const completed = skip ? (guidance.completed_tips || []) : [...new Set([...(guidance.completed_tips || []), current.id])]
    const next = nextCoachStep(guidance.goal, dataset, current.id, dismissed)
    await persist({
      dismissed_tips: dismissed,
      completed_tips: completed,
      walkthrough_step: next?.id || null,
      guided_mode: Boolean(next),
    })
    if (next) routeTarget(dataset.id, next, activeTab, navigate)
  }

  const nextMicroStep = () => {
    if (microIndex < focusSteps.length - 1) {
      setMicroIndex((value) => Math.min(value + 1, focusSteps.length - 1))
      return
    }
    advanceWorkflow(false)
  }

  const previousMicroStep = () => setMicroIndex((value) => Math.max(value - 1, 0))
  const canFinishRequired = current.requirement !== 'required' || completion.complete
  const microAtEnd = microIndex >= focusSteps.length - 1
  const coach = (
    <aside
      className={`ax-guided-coach ax-guided-spotlight-coach ${coachStyle ? 'anchored' : ''}`}
      style={coachStyle || undefined}
      aria-live="polite"
    >
      <div className="ax-guided-coach-step-row">
        <p className="ax-kicker">Guided focus</p>
        {focusSteps.length > 1 && <span>{Math.min(microIndex + 1, focusSteps.length)} of {focusSteps.length}</span>}
      </div>
      <strong>{focusStep.title || current.title}</strong>
      {focusStep.detected && <p><b>What SimuCast sees:</b> {focusStep.detected}</p>}
      <p><b>Do this now:</b> {focusStep.action || current.action}</p>
      {focusStep.why && <p className="ax-guided-coach-unlocks"><b>Why:</b> {focusStep.why}</p>}
      {microAtEnd && current.requirement === 'required' && completion.checked && !completion.complete && (
        <p className="ax-guided-coach-lock">Apply the required fix first. The next guided step stays locked until the dataset state confirms it.</p>
      )}
      <div className="ax-guided-coach-actions">
        {!onCurrentPage && (
          <button className="ax-btn mini prim" type="button" onClick={routeCurrent}>
            Open required section
          </button>
        )}
        {onCurrentPage && microIndex > 0 && (
          <button className="ax-btn mini ghost" type="button" onClick={previousMicroStep}>
            Back
          </button>
        )}
        {onCurrentPage && (
          <button
            className="ax-btn mini prim"
            type="button"
            disabled={busy || (microAtEnd && !canFinishRequired)}
            onClick={nextMicroStep}
          >
            {focusStep.nextLabel || (microAtEnd ? (current.requirement === 'required' ? 'Continue when done' : 'Next step') : 'Continue')}
          </button>
        )}
        {current.requirement !== 'required' && (
          <button className="ax-btn mini ghost" type="button" disabled={busy} onClick={() => advanceWorkflow(true)}>
            Skip guidance
          </button>
        )}
        <button className="ax-link-btn" type="button" disabled={busy} onClick={() => persist({ guided_mode: false })}>
          Explore freely
        </button>
      </div>
    </aside>
  )

  return (
    <>
      {onCurrentPage && spotlight && <SpotlightMask rect={spotlight} />}
      {coach}
    </>
  )
}

function SpotlightMask({ rect }) {
  const top = Math.max(0, rect.top)
  const left = Math.max(0, rect.left)
  const right = Math.max(0, window.innerWidth - rect.right)
  const bottom = Math.max(0, window.innerHeight - rect.bottom)

  return (
    <div className="ax-guided-spotlight" aria-hidden="true">
      <span className="top" style={{ height: top }} />
      <span className="left" style={{ top, width: left, height: rect.height }} />
      <span className="right" style={{ top, right: 0, width: right, height: rect.height }} />
      <span className="bottom" style={{ top: rect.bottom, height: bottom }} />
      <span className="ring" style={{ top, left, width: rect.width, height: rect.height }} />
    </div>
  )
}

export function routeTarget(datasetId, target, activeTab, navigate) {
  if (!datasetId || !target?.page || !target?.section) return
  window.sessionStorage.setItem('simucast.fixTarget', JSON.stringify({
    page: target.page,
    section: target.section,
    ts: Date.now(),
  }))
  if (target.page === activeTab) {
    window.setTimeout(() => highlightSection(target.section), 60)
    return
  }
  navigate(`/projects/${datasetId}/${target.page}`)
}

function highlightSection(section) {
  const el = document.getElementById(section)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ax-fix-highlight')
  window.setTimeout(() => el.classList.remove('ax-fix-highlight'), 2200)
}

function focusSection(section) {
  const el = document.getElementById(section)
  if (el) el.classList.add('ax-guided-focus-target')
}

function clearFocusSection(section) {
  const el = document.getElementById(section)
  if (el) el.classList.remove('ax-guided-focus-target')
}

export async function checkCoachCompletion(dataset, step) {
  if (!dataset?.id || !step) return false
  if (step.completion === 'missing') {
    return !(dataset.variables || []).some((variable) => Number(variable.missing || 0) > 0)
  }
  if (step.completion === 'models') {
    const response = await api.listModels(dataset.id)
    return Boolean((response || []).length)
  }
  if (step.completion === 'describe') {
    const response = await api.listAnalyses(dataset.id, 'describe', 1)
    return Boolean(response?.analyses?.length)
  }
  if (step.completion === 'tests') {
    const response = await api.listAnalyses(dataset.id, '', 20)
    return Boolean((response?.analyses || []).some((analysis) => String(analysis.kind || '').startsWith('test_')))
  }
  return false
}

function spotlightStepsForStep(step, dataset, complete) {
  if (!step) return []
  if (step.id === 'data.suggested_fixes') {
    const affected = missingVariableNames(dataset)
    if (complete) {
      return [{
        section: 'data-section-raw_data',
        title: 'Review the cleaned dataset stage',
        detected: 'The missing-value requirement is resolved in the current dataset stage.',
        action: 'Inspect the preview and History before the guide opens the next workflow step.',
        why: 'A quick review confirms the transformation changed the data you expected.',
        nextLabel: 'Continue',
      }]
    }
    return [
      {
        section: 'data-section-raw_data',
        title: 'Review the affected columns first',
        detected: affected.length ? `Missing values were detected in ${readableList(affected)}.` : 'The dataset has missing values that need review.',
        action: 'Look at the dataset preview so the blanks and affected columns make sense before you apply a fix.',
        why: 'Reviewing first helps you avoid applying a cleanup method to a column you did not inspect.',
        nextLabel: 'I am done reviewing',
      },
      {
        section: 'fix-cleaning-missing',
        title: 'Use the Missing values card',
        detected: 'SimuCast grouped this issue separately from outliers and duplicates.',
        action: 'Stay on this card for missing-value handling. The card already separates grouped fixes from advanced overrides.',
        why: 'Each issue type changes data differently, so the guide focuses on one card at a time.',
        nextLabel: 'Show recommendations',
      },
      {
        section: 'fix-cleaning-missing-recommendations',
        title: 'Check the recommended methods',
        detected: 'Numeric and categorical columns can need different missing-value methods.',
        action: 'Read the recommendation groups and the reason for each method. Use overrides only if one column needs different handling.',
        why: 'The selected method should match the affected column type and current distribution risk.',
        nextLabel: 'Show apply button',
      },
      {
        section: 'fix-cleaning-missing-apply',
        title: 'Apply the selected missing-value fixes',
        detected: 'The selected columns and grouped methods are ready to create a cleaned dataset stage.',
        action: 'Click Apply group when the recommendation groups and selected columns look correct.',
        why: 'Applying the fix updates the active stage and unlocks downstream summaries and models.',
        nextLabel: 'Continue when done',
      },
    ]
  }
  return [fallbackSpotlightStep(step)]
}

function fallbackSpotlightStep(step) {
  if (!step) return null
  return {
    section: step.section,
    title: step.title,
    detected: step.detected,
    action: step.action,
    why: step.unlocks,
  }
}

function missingVariableNames(dataset) {
  return (dataset?.variables || [])
    .filter((variable) => Number(variable.missing || 0) > 0)
    .map((variable) => variable.name)
}

function readableList(items) {
  const names = items.slice(0, 5)
  if (items.length <= 1) return names.join('')
  if (items.length > 5) return `${names.join(', ')}, and more`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function toSpotlightRect(rect) {
  const pad = 8
  const top = clamp(rect.top - pad, 8, window.innerHeight - 24)
  const left = clamp(rect.left - pad, 8, window.innerWidth - 24)
  const right = clamp(rect.right + pad, 24, window.innerWidth - 8)
  const bottom = clamp(rect.bottom + pad, 24, window.innerHeight - 8)
  return { top, left, right, bottom, width: Math.max(16, right - left), height: Math.max(16, bottom - top) }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
