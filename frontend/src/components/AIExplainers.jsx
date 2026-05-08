import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { InlineSpinner, SkeletonCards } from './LoadingStates'
import HelpButton from './HelpButton'

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

export function SparkleIcon({ size = 12 }) {
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
  const [isSaved, setIsSaved] = useState(false)
  const [isAI, setIsAI] = useState(true)

  const fetchExplanation = async ({ force = false } = {}) => {
    if (!datasetId || loading) return
    const requestParams = force ? { ...params, _retry_at: Date.now() } : params
    const k = keyOf(datasetId, step, requestParams, result, question)
    const cached = !force ? cacheGet(k) : null
    if (cached) {
      setText(cached.explanation || cached)
      setIsSaved(cached.saved !== false)
      setIsAI(cached.ai !== false)
      return
    }
    setLoading(true)
    try {
      const r = await api.aiExplain(datasetId, step, requestParams, question, result, true)
      const explanation = r?.explanation || 'No explanation returned.'
      cacheSet(k, { explanation, saved: r?.saved !== false, ai: r?.ai !== false, include_in_report: true })
      setText(explanation)
      setIsSaved(r?.saved !== false)
      setIsAI(r?.ai !== false)
    } catch (err) {
      setText('The explanation could not be generated right now. You can continue using the built-in system guidance.')
      setIsSaved(false)
      setIsAI(false)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next || text || loading) return
    fetchExplanation()
  }

  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)

  return (
    <span className="ax-ai-explain-wrap">
      <button
        type="button"
        className={`ax-btn ax-ai-explain-btn${size === 'mini' ? ' mini' : ''}`}
        onClick={toggle}
      >
        <SparkleIcon size={11} />
        {label}
      </button>
      {open && (
        <div className="ax-ai-explain-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <div
            className="ax-ai-explain-modal"
            role="dialog"
            aria-modal="true"
            aria-label="AI explanation"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="ax-ai-explain-head">
              <div>
                <p className="ax-ai-explain-title"><SparkleIcon size={13} /> AI explanation</p>
                <p className="ax-ai-explain-meta">
                  {loading
                    ? 'Generating and saving this explanation...'
                    : isSaved
                      ? 'Saved for this project and available for reports.'
                      : isAI
                        ? 'Generated explanation.'
                        : 'Built-in fallback explanation.'}
                </p>
                <p className="ax-ai-explain-meta">Generated from current dataset state.</p>
              </div>
            </div>
            <div className="ax-ai-explain-scroll">
              <div className="ax-ai-explain-body">
                {loading ? (
                  <InlineSpinner label="Generating explanation..." />
                ) : (
                  paragraphs.map((paragraph, index) => (
                    <p key={`${paragraph.slice(0, 24)}-${index}`}>{paragraph}</p>
                  ))
                )}
              </div>
            </div>
            <div className="ax-ai-explain-foot">
              <button
                type="button"
                className="ax-btn mini"
                onClick={() => fetchExplanation({ force: true })}
                disabled={loading}
              >
                {loading ? 'Retrying...' : 'Retry AI'}
              </button>
              <button type="button" className="ax-btn mini" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
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
 *   autoLoad    — fetch on mount (default false)
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
  autoLoad = false,
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
      setText(cached.explanation || cached)
      setLoading(false)
      return
    }
    try {
      const r = await api.aiExplain(datasetId, step, params, question, result, true)
      const explanation = r?.explanation || 'No explanation returned.'
      cacheSet(k, {
        explanation,
        saved: r?.saved !== false,
        ai: r?.ai !== false,
        include_in_report: true,
      })
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
          <HelpButton
            title={title}
            text="Click AI explain to generate a plain-language interpretation for the result beside it. Generated explanations are saved with the project so they can be reused later, including in reports."
          />
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
          className="ax-btn ax-ai-explain-btn mini"
          onClick={load}
          disabled={loading}
        >
          {loading ? <InlineSpinner label="Generating..." /> : <><SparkleIcon size={11} /> {text ? 'Refresh' : 'AI explain'}</>}
        </button>
      </div>
      {loading && !text && <SkeletonCards count={1} />}
      {error && (
        <p style={{ fontSize: 12, color: 'var(--color-text-danger)', margin: 0 }}>
          {error}
        </p>
      )}
      {text && (
        <div className="ax-ai-insight-scroll">
          <div className="ax-ai-insight-body">
            {String(text)
              .split(/\n{2,}/)
              .map((part) => part.trim())
              .filter(Boolean)
              .map((paragraph, index) => (
                <p key={`${paragraph.slice(0, 24)}-${index}`}>{paragraph}</p>
              ))}
          </div>
        </div>
      )}
      {suggestedNextStep?.page && suggestedNextStep?.section && (
        <button className="ax-btn mini" type="button" onClick={goToSuggestedStep} style={{ marginTop: 8 }}>
          {suggestedNextStep.label || 'Open suggested next step'}
        </button>
      )}
    </div>
  )
}
