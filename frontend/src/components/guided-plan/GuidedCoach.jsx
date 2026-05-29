/* ============================================================
 * COMPONENT: GUIDED COACH
 * Keywords: guided mode, walkthrough, spotlight, onboarding
 * ============================================================ */
import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { coachStepsForGoal, currentCoachStep, firstCoachStep, nextCoachStep } from './ProjectGuidanceSetup'

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
  const [progressTick, setProgressTick] = useState(0)

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
  }, [current?.id, dataset, dataset?.current_stage_id, progressTick])

  useEffect(() => {
    const refreshCompletion = () => setProgressTick((value) => value + 1)
    window.addEventListener('simucast:guided-progress', refreshCompletion)
    return () => window.removeEventListener('simucast:guided-progress', refreshCompletion)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!dataset?.id || !guidance.guided_mode || !guidance.goal || !current) return undefined
    api.cleanSuggestions(dataset.id)
      .then(async (response) => {
        if (cancelled) return
        const steps = coachStepsForGoal(guidance.goal, dataset)
        const pending = firstPendingDataStep(steps, response)
        const currentIndex = steps.findIndex((step) => step.id === current.id)
        const pendingIndex = steps.findIndex((step) => step.id === pending?.id)
        if (!pending || pending.id === current.id || pendingIndex < 0) return
        if (currentIndex >= 0 && pendingIndex > currentIndex) return
        const updated = await api.updateGuidance(dataset.id, { walkthrough_step: pending.id, guided_mode: true })
        if (!cancelled) {
          onGuidanceUpdated?.(updated.guidance)
          routeTarget(dataset.id, pending, activeTab, navigate)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeTab, current?.id, dataset, dataset?.current_stage_id, guidance.goal, guidance.guided_mode, navigate, onGuidanceUpdated])

  useEffect(() => {
    if (!guidance.guided_mode || !focusTarget || !onCurrentPage) {
      setSpotlight(null)
      setCoachStyle(null)
      return undefined
    }
    setSpotlight(null)
    setCoachStyle(null)

    let lastRectString = ''
    const place = () => {
      let el = document.getElementById(focusTarget)
      if (!el) {
        if (focusTarget.startsWith('fix-cleaning-')) {
          const suffix = focusTarget.replace('fix-cleaning-', '').split('-')[0]
          el = document.getElementById(`tb-${suffix}`)
        } else if (focusTarget === 'data-section-category_standardization') {
          el = document.getElementById('tb-labels')
        }
      }
      if (!el) {
        if (lastRectString !== 'null') {
          setSpotlight(null)
          setCoachStyle(null)
          lastRectString = 'null'
        }
        return
      }
      const rect = el.getBoundingClientRect()
      const rectKey = `${rect.top},${rect.left},${rect.width},${rect.height}`
      if (rectKey === lastRectString) return
      lastRectString = rectKey

      setSpotlight(toSpotlightRect(rect))

      const cardW = 300
      const cardEl = document.querySelector('.guided-focus-card')
      const cardH = cardEl && cardEl.offsetHeight > 0 ? cardEl.offsetHeight : 180
      const margin = 12
      const viewW = window.innerWidth
      const viewH = window.innerHeight

      let top = 0
      let left = 0
      let arrowSide = 'top'

      const spaceBelow = viewH - rect.bottom
      const spaceAbove = rect.top

      if (spaceBelow > cardH + 24) {
        top = rect.bottom + margin
        left = rect.left + rect.width / 2 - cardW / 2
        arrowSide = 'top'
      } else if (spaceAbove > cardH + 24) {
        top = rect.top - cardH - margin
        left = rect.left + rect.width / 2 - cardW / 2
        arrowSide = 'bottom'
      } else {
        const spaceRight = viewW - rect.right
        if (spaceRight > cardW + 24) {
          left = rect.right + margin
          top = rect.top + rect.height / 2 - cardH / 2
          arrowSide = 'left'
        } else {
          left = rect.left - cardW - margin
          top = rect.top + rect.height / 2 - cardH / 2
          arrowSide = 'right'
        }
      }

      left = Math.max(12, Math.min(viewW - cardW - 12, left))
      top = Math.max(12, Math.min(viewH - cardH - 12, top))

      let arrowLeft = (rect.left + rect.width / 2) - left
      arrowLeft = Math.max(16, Math.min(cardW - 16, arrowLeft))

      let arrowTop = (rect.top + rect.height / 2) - top
      arrowTop = Math.max(16, Math.min(cardH - 16, arrowTop))

      setCoachStyle({
        top,
        left,
        width: cardW,
        arrowSide,
        arrowLeft,
        arrowTop
      })
    }

    let placementTimer = null
    let listening = false
    let intervalId = null
    const startPlacement = () => {
      place()
      window.addEventListener('resize', place)
      window.addEventListener('scroll', place, true)
      intervalId = window.setInterval(place, 250)
      listening = true
    }
    const timer = window.setTimeout(() => {
      highlightSection(focusTarget)
      focusSection(focusTarget)
      placementTimer = window.setTimeout(startPlacement, spotlightSettleDelay())
    }, 180)
    return () => {
      window.clearTimeout(timer)
      if (placementTimer) window.clearTimeout(placementTimer)
      if (listening) {
        window.removeEventListener('resize', place)
        window.removeEventListener('scroll', place, true)
        if (intervalId) window.clearInterval(intervalId)
      }
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
    if (!skip) setCompletion({ checked: true, complete: verifiedComplete })
    if (!skip && current.requirement === 'required' && !verifiedComplete) {
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
      className={`guided-focus-card guided-focus ${coachStyle ? '' : 'wrong-page'}`}
      data-arrow-side={coachStyle?.arrowSide || 'none'}
      style={coachStyle ? {
        top: `${coachStyle.top}px`,
        left: `${coachStyle.left}px`,
        '--arrow-left': `${coachStyle.arrowLeft}px`,
        '--arrow-top': `${coachStyle.arrowTop}px`,
        width: `${coachStyle.width}px`
      } : {
        position: 'fixed',
        bottom: '18px',
        right: 'max(18px, calc(var(--ai-w, 360px) + 18px))',
        width: '300px',
        zIndex: 101
      }}
      aria-live="polite"
    >
      <div className="gf-content" style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
        <div className="ax-guided-coach-step-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
          <p className="ax-kicker" style={{ margin: 0, textTransform: 'uppercase', fontSize: '9.5px', fontWeight: 800, letterSpacing: '0.08em', color: '#f97316' }}>
            Guided Focus {focusSteps.length > 1 ? `· ${Math.min(microIndex + 1, focusSteps.length)} of ${focusSteps.length}` : ''}
          </p>
          <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>{current.page ? current.page.toUpperCase() : 'PLAN'}</span>
        </div>

        <strong style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-text-primary)', display: 'block', margin: '2px 0 2px' }}>
          {focusStep.title || current.title}
        </strong>

        <div style={{ fontSize: '12.5px', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: '8px', lineHeight: 1.45 }}>
          {focusStep.detected && (
            <p style={{ margin: 0 }}>
              <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>What SimuCast sees:</span><br />
              {focusStep.detected}
            </p>
          )}
          
          <p className="do-this-now" style={{ margin: 0 }}>
            <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>Do this now:</span><br />
            {focusStep.action || current.action}
          </p>

          {focusStep.why && (
            <p style={{ margin: 0, fontSize: '11.5px', opacity: 0.85, borderLeft: '2px solid #fdba74', paddingLeft: '8px' }}>
              <span style={{ fontWeight: 600 }}>Why:</span> {focusStep.why}
            </p>
          )}

          {microAtEnd && current.requirement === 'required' && completion.checked && !completion.complete && (
            <p className="ax-guided-coach-lock" style={{ margin: 0, fontSize: '11.5px', color: 'var(--color-accent-dark)', fontWeight: 600 }}>
              Apply the required fix first. The next guided step stays locked until the dataset state confirms it.
            </p>
          )}
        </div>
      </div>

      <div className="ax-guided-coach-actions" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '12px', paddingTop: '10px', borderTop: '0.5px solid var(--color-border-tertiary)' }}>
        {!onCurrentPage && (
          <button className="ax-btn mini prim" type="button" onClick={routeCurrent} style={{ background: '#f97316', borderColor: '#f97316', color: '#ffffff' }}>
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
            disabled={busy}
            onClick={nextMicroStep}
            style={{ background: '#f97316', borderColor: '#f97316', color: '#ffffff' }}
          >
            {focusStep.nextLabel || (microAtEnd ? (current.requirement === 'required' && !canFinishRequired ? 'Check and continue' : 'Next step') : 'Continue')}
          </button>
        )}
        {current.requirement !== 'required' && (
          <button className="ax-btn mini ghost" type="button" disabled={busy} onClick={() => advanceWorkflow(true)}>
            Skip guidance
          </button>
        )}
        <button className="ax-link-btn" type="button" disabled={busy} onClick={() => persist({ guided_mode: false })} style={{ marginLeft: 'auto', fontSize: '11.5px', color: 'var(--color-text-secondary)' }}>
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
  return (
    <svg
      className="spotlight-overlay show"
      width="100%"
      height="100%"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        pointerEvents: 'none'
      }}
    >
      <defs>
        <mask id="spotlight-mask-coach">
          <rect width="100%" height="100%" fill="white" />
          <rect
            id="spotlight-hole-coach"
            style={{
              transition: 'x 150ms ease, y 150ms ease, width 150ms ease, height 150ms ease'
            }}
            x={rect ? rect.left : 0}
            y={rect ? rect.top : 0}
            width={rect ? rect.width : 0}
            height={rect ? rect.height : 0}
            rx="8"
            fill="black"
          />
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill="rgba(0,0,0,0.6)"
        mask="url(#spotlight-mask-coach)"
      />
    </svg>
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
  el.scrollIntoView({ behavior: spotlightScrollBehavior(), block: 'center', inline: 'nearest' })
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

function spotlightScrollBehavior() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

function spotlightSettleDelay() {
  return spotlightScrollBehavior() === 'auto' ? 40 : 420
}

export async function checkCoachCompletion(dataset, step) {
  if (!dataset?.id || !step) return false
  if (step.completion === 'missing') {
    return !(dataset.variables || []).some((variable) => Number(variable.missing || 0) > 0)
  }
  if (step.completion === 'outliers' || step.completion === 'duplicates') {
    const response = await api.cleanSuggestions(dataset.id)
    return !cleanIssuePending(response, step.completion)
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
  if (step.id === 'data.outliers') {
    if (complete) return [cleanedDataReviewStep('outlier')]
    return [
      {
        section: 'fix-cleaning-outliers',
        title: 'Review the Outliers card',
        detected: 'SimuCast found numeric values that sit outside the current IQR bounds.',
        action: 'Stay on the Outliers card so this issue is handled separately from missing values and duplicates.',
        why: 'Extreme values can pull summaries and model fit away from the typical pattern.',
        nextLabel: 'Show recommendation',
      },
      {
        section: 'fix-cleaning-outliers-recommendations',
        title: 'Check the outlier recommendation',
        detected: 'The card shows affected numeric columns and the current recommended handling.',
        action: 'Review why capping or another method is selected before applying it.',
        why: 'Outlier handling changes values, so the recommended method should make sense before the stage updates.',
        nextLabel: 'Show apply button',
      },
      {
        section: 'fix-cleaning-outliers-apply',
        title: 'Apply the selected outlier handling',
        detected: 'The selected outlier method is ready to create a new cleaned dataset stage.',
        action: 'Click Apply group when the affected columns and method look correct.',
        why: 'The next guided Data task stays locked until current outlier suggestions are resolved.',
        nextLabel: 'Check and continue',
      },
    ]
  }
  if (step.id === 'data.duplicates') {
    if (complete) return [cleanedDataReviewStep('duplicate')]
    return [
      {
        section: 'fix-cleaning-duplicates',
        title: 'Review duplicate rows',
        detected: 'SimuCast detected exact repeated rows in the current dataset stage.',
        action: 'Use the Duplicates card to confirm what will be removed and which occurrence is kept.',
        why: 'Repeated rows can count the same record more than once.',
        nextLabel: 'Show remove button',
      },
      {
        section: 'fix-cleaning-duplicates-apply',
        title: 'Remove exact duplicates',
        detected: 'The Duplicates card is ready to remove repeated rows from the active stage.',
        action: 'Click Remove duplicates when the keep rule looks right.',
        why: 'The guide leaves Data cleanup after exact duplicates no longer remain.',
        nextLabel: 'Check and continue',
      },
    ]
  }
  if (step.id === 'models.target') {
    return [
      {
        section: 'models-step-1',
        title: 'Choose what the model should predict',
        detected: 'The prediction path needs one target column before features and model health can be evaluated.',
        action: 'Pick the target that matches your question.',
        why: 'A target tells SimuCast what outcome the model should learn.',
        nextLabel: 'Show features',
      },
      {
        section: 'fix-feature-selection',
        title: 'Choose the input features',
        detected: 'Features are the columns the model can use to predict the target.',
        action: 'Review the recommended features and remove anything that directly reveals the answer.',
        why: 'Good feature choices reduce leakage and make the model easier to trust.',
        nextLabel: 'Show validation',
      },
      {
        section: 'models-step-4',
        title: 'Set the validation method',
        detected: 'Validation compares learned patterns with unseen rows.',
        action: 'Review the train/test or cross-validation choice before training.',
        why: 'Validation is how SimuCast checks generalization and possible overfitting.',
        nextLabel: 'Show training',
      },
      {
        section: 'models-train-action',
        title: 'Train and save the model result',
        detected: 'The current guided question needs at least one saved model artifact.',
        action: 'Choose algorithms if needed, then click Train models.',
        why: 'A saved model unlocks model health, What-if analysis, and report-ready predictions.',
        nextLabel: 'Check and continue',
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

function cleanedDataReviewStep(kind) {
  return {
    section: 'data-section-raw_data',
    title: `Review the ${kind} cleanup result`,
    detected: `No current ${kind} suggestions remain in this dataset stage.`,
    action: 'Inspect the dataset preview and History before the guide continues.',
    why: 'A quick review keeps the guided path tied to the transformed data you are actually using.',
    nextLabel: 'Continue',
  }
}

function firstPendingDataStep(steps, response) {
  return steps.find((step) => (
    step.page === 'data' &&
    step.requirement === 'required' &&
    cleanIssuePending(response, step.completion)
  )) || null
}

function cleanIssuePending(response, completion) {
  if (completion === 'missing') return Boolean((response?.groups?.missing?.columns || []).length)
  if (completion === 'outliers') return Boolean((response?.groups?.outliers?.columns || []).length)
  if (completion === 'duplicates') return Number(response?.groups?.duplicates?.count || 0) > 0
  return false
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
