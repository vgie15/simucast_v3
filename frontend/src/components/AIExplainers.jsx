import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { InlineSpinner, SkeletonCards } from './LoadingStates'

// Lightweight in-memory cache so navigating back to a page that already
// rendered an explanation doesn't re-bill. Keyed by datasetId+step+payload-hash.
const _cache = new Map()
const _MAX = 50

function keyOf(datasetId, step, params, result, question) {
  try {
    return `${datasetId}::${step}::${JSON.stringify({ params, result, question })}`
  } catch {
    return `${datasetId}::${step}::${Math.random()}`
  }
}

function cacheGet(k) {
  return _cache.get(k)
}

function cacheSet(k, v) {
  if (_cache.size >= _MAX) {
    const first = _cache.keys().next().value
    if (first) _cache.delete(first)
  }
  _cache.set(k, v)
}

function SparkleIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path
        d="M7 1L8.3 5.1L12.5 6L8.3 8.2L7 13L5.7 8.2L1.5 6L5.7 5.1L7 1Z"
        fill="var(--color-accent)"
      />
    </svg>
  )
}

/**
 * Inline button that opens an AI explanation popover for the result/params
 * the UI is currently showing. Cheap by default — only fetches on click.
 */
export function ExplainButton({
  datasetId,
  step,
  params = {},
  result,
  question,
  label = 'Explain',
  size = 'mini',
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(null)
  const [loading, setLoading] = useState(false)
  const popRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next || text || loading) return
    const k = keyOf(datasetId, step, params, result, question)
    const cached = cacheGet(k)
    if (cached) {
      setText(cached)
      return
    }
    setLoading(true)
    try {
      const r = await api.aiExplain(datasetId, step, params, question, result)
      const explanation = r?.explanation || 'No explanation returned.'
      cacheSet(k, explanation)
      setText(explanation)
    } catch (err) {
      setText('The explanation could not be generated right now. You can continue using the built-in system guidance.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className={`ax-btn${size === 'mini' ? ' mini' : ''}`}
        onClick={toggle}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <SparkleIcon size={11} />
        {label}
      </button>
      {open && (
        <div
          ref={popRef}
          style={{
            position: 'fixed',
            top: 84,
            right: 24,
            zIndex: 10000,
            width: 'min(560px, calc(100vw - 48px))',
            maxHeight: 'calc(100vh - 120px)',
            overflow: 'auto',
            padding: '14px 16px',
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            color: 'var(--color-text-primary)',
            lineHeight: 1.55,
          }}
        >
          {loading ? <InlineSpinner label="Generating explanation..." /> : text}
        </div>
      )}
    </span>
  )
}

/**
 * Auto-loading card that shows a 2–4 sentence AI narrative for a step+result.
 * Suitable for placing alongside computed output (test result, model metrics).
 *
 * Props:
 *   datasetId, step, params, result, question?
 *   title?      — heading text (default: "AI insight")
 *   autoLoad    — fetch on mount (default true)
 *   compact     — slimmer layout
 *   refreshKey  — change this to force a refetch (e.g. when result changes)
 */
export function AIInsightCard({
  datasetId,
  step,
  params = {},
  result,
  question,
  title = 'AI insight',
  autoLoad = true,
  compact = false,
  refreshKey,
  suggestedNextStep,
}) {
  const navigate = useNavigate()
  const [text, setText] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [isAI, setIsAI] = useState(true)

  const load = async () => {
    if (!datasetId) return
    setLoading(true)
    setError(null)
    const k = keyOf(datasetId, step, params, result, question)
    const cached = cacheGet(k)
    if (cached) {
      setText(cached)
      setLoading(false)
      return
    }
    try {
      const r = await api.aiExplain(datasetId, step, params, question, result)
      const explanation = r?.explanation || 'No explanation returned.'
      cacheSet(k, explanation)
      setText(explanation)
      setIsAI(r?.ai !== false)
    } catch (err) {
      setError(err.message || 'Failed to load insight')
    } finally {
      setLoading(false)
    }
  }

  const goToSuggestedStep = () => {
    if (!datasetId || !suggestedNextStep?.page || !suggestedNextStep?.section) return
    window.sessionStorage.setItem('simucast.fixTarget', JSON.stringify({
      page: suggestedNextStep.page,
      section: suggestedNextStep.section,
      ts: Date.now(),
      relatedPlanStepId: suggestedNextStep.relatedPlanStepId,
    }))
    navigate(`/projects/${datasetId}/${suggestedNextStep.page}`)
  }

  useEffect(() => {
    if (autoLoad) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, step, refreshKey])

  return (
    <div
      className="ax-card"
      style={{
        padding: compact ? '8px 10px' : '10px 12px',
        marginBottom: compact ? 8 : 12,
        background: 'var(--color-background-secondary)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: text || loading || error ? 6 : 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SparkleIcon />
          <span style={{ fontSize: 12, fontWeight: 500 }}>{title}</span>
          {!isAI && text && (
            <span
              className="ax-chip"
              style={{
                background: 'var(--color-background-primary)',
                color: 'var(--color-text-tertiary)',
                fontSize: 10,
              }}
            >
              heuristic
            </span>
          )}
        </div>
        <button
          type="button"
          className="ax-btn mini"
          onClick={load}
          disabled={loading}
        >
          {loading ? <InlineSpinner label="Generating..." /> : text ? 'Refresh' : 'Generate'}
        </button>
      </div>
      {loading && !text && <SkeletonCards count={1} />}
      {error && (
        <p style={{ fontSize: 12, color: 'var(--color-text-danger)', margin: 0 }}>
          {error}
        </p>
      )}
      {text && (
        <p
          style={{
            fontSize: 12,
            color: 'var(--color-text-primary)',
            margin: 0,
            whiteSpace: 'pre-wrap',
            lineHeight: 1.5,
          }}
        >
          {text}
        </p>
      )}
      {suggestedNextStep?.page && suggestedNextStep?.section && (
        <button className="ax-btn mini" type="button" onClick={goToSuggestedStep} style={{ marginTop: 8 }}>
          {suggestedNextStep.label || 'Open suggested next step'}
        </button>
      )}
    </div>
  )
}
