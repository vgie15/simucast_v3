/* ============================================================
 * COMPONENT: GUIDED COACH
 * Keywords: guided mode, walkthrough, highlight, onboarding
 * ============================================================ */
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { currentCoachStep, firstCoachStep, nextCoachStep } from './ProjectGuidanceSetup'

// Compact walkthrough callout that routes users to exact workflow sections.
export default function GuidedCoach({ dataset, activeTab, onGuidanceUpdated }) {
  const navigate = useNavigate()
  const guidance = dataset?.guidance || {}
  const [busy, setBusy] = useState(false)
  const [anchorStyle, setAnchorStyle] = useState(null)
  const [completion, setCompletion] = useState({ checked: false, complete: false })
  const current = currentCoachStep(guidance, dataset) || firstCoachStep(guidance.goal, dataset)

  useEffect(() => {
    if (!guidance.guided_mode || !current?.section) return
    if (current.page !== activeTab) {
      setAnchorStyle(null)
      return
    }
    const place = () => {
      const el = document.getElementById(current.section)
      if (!el) {
        setAnchorStyle(null)
        return
      }
      const rect = el.getBoundingClientRect()
      const width = Math.min(360, window.innerWidth - 32)
      const left = Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16))
      const top = rect.top > 230
        ? Math.max(16, rect.top - 184)
        : Math.min(window.innerHeight - 252, rect.bottom + 12)
      setAnchorStyle({ left, top, right: 'auto', bottom: 'auto' })
    }
      const timer = window.setTimeout(() => {
      highlightSection(current.section)
      focusSection(current.section)
      place()
    }, 220)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      clearFocusSection(current.section)
    }
  }, [activeTab, current?.id, current?.page, current?.section, guidance.guided_mode])

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

  const goCurrent = () => {
    routeTarget(dataset.id, current, activeTab, navigate)
  }

  const advance = async (skip = false) => {
    const verifiedComplete = skip ? false : await checkCoachCompletion(dataset, current)
    if (!skip && current.requirement === 'required' && !verifiedComplete) {
      setCompletion({ checked: true, complete: false })
      goCurrent()
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

  return (
    <aside className={`ax-guided-coach ${anchorStyle ? 'anchored' : ''}`} style={anchorStyle || undefined} aria-live="polite">
      <p className="ax-kicker">Step-by-step guidance</p>
      <strong>{current.title}</strong>
      {current.detected && <p><b>What SimuCast sees:</b> {current.detected}</p>}
      <p><b>Do this now:</b> {current.action}</p>
      {current.unlocks && <p className="ax-guided-coach-unlocks">{current.unlocks}</p>}
      {current.requirement === 'required' && completion.checked && !completion.complete && (
        <p className="ax-guided-coach-lock">Complete this required task before the guide opens the next module.</p>
      )}
      <div className="ax-guided-coach-actions">
        <button className="ax-btn mini prim" type="button" onClick={goCurrent}>
          {current.page === activeTab ? 'Show required section' : 'Open required section'}
        </button>
        <button className="ax-btn mini" type="button" disabled={busy || (current.requirement === 'required' && completion.checked && !completion.complete)} onClick={() => advance(false)}>
          {current.requirement === 'required' ? 'Continue when done' : 'Next'}
        </button>
        {current.requirement !== 'required' && (
          <button className="ax-btn mini ghost" type="button" disabled={busy} onClick={() => advance(true)}>
            Skip guidance
          </button>
        )}
        <button className="ax-link-btn" type="button" disabled={busy} onClick={() => persist({ guided_mode: false })}>
          Explore freely
        </button>
      </div>
    </aside>
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
  window.setTimeout(() => el.classList.remove('ax-fix-highlight'), 2600)
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
