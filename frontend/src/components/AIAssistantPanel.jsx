import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { BusyOverlay, InlineSpinner, SkeletonCards } from './LoadingStates'

/**
 * AIAssistantPanel
 * Drop-in panel that loads context-aware recommendations from the backend
 * (`/ai/recommend?context=<context>`) on mount and lets the user expand any
 * card for a deeper "explain" call (`/ai/explain`). Falls back gracefully
 * to rule-based heuristics when the Anthropic key isn't configured.
 *
 * Props:
 *   datasetId: string
 *   context:   'data' | 'tests' | 'models' | 'expand'
 *   title:     optional override for the section title
 */
export default function AIAssistantPanel({ datasetId, context = 'data', title }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [collapsed, setCollapsed] = useState(false)

  const [followQ, setFollowQ] = useState('')
  const [followAnswer, setFollowAnswer] = useState(null)
  const [followLoading, setFollowLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.aiRecommend(datasetId, context)
      setData(r)
    } catch (err) {
      setError(err.message || 'Failed to load recommendations')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [datasetId, context])

  const askFollowup = async () => {
    const q = followQ.trim()
    if (!q) return
    setFollowLoading(true)
    setFollowAnswer(null)
    try {
      const r = await api.aiExplain(datasetId, `${context}-followup`, { context }, q)
      setFollowAnswer(r)
    } catch (err) {
      setFollowAnswer({ ai: false, explanation: 'The assistant could not answer right now. You can continue with the built-in recommendations and try again later.' })
    } finally {
      setFollowLoading(false)
    }
  }

  const recommendations = (data?.recommendations || []).filter(hasRecommendationContent)
  const sectionTitle = title || titleForContext(context)

  return (
    <div className={`ax-card ax-busy-host ${loading && data ? 'is-busy' : ''}`} style={{ marginBottom: 16 }}>
      <BusyOverlay
        active={loading && !!data}
        title="Refreshing recommendations..."
        detail="Reading the latest dataset state and preparing updated guidance."
        steps={['Building context', 'Checking recommended actions', 'Refreshing the panel']}
      />
      <div className="ax-row" style={{ marginBottom: collapsed ? 0 : 8 }}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
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
          <SparkleIcon />
          <span style={{ fontSize: 13, fontWeight: 500 }}>{sectionTitle}</span>
        </button>
        {!collapsed && (
          <button className="ax-btn" onClick={load} disabled={loading} type="button">
            {loading ? <InlineSpinner label="Thinking..." /> : 'Re-analyze'}
          </button>
        )}
      </div>

      {collapsed ? null : <>

      {loading && !data && <SkeletonCards count={2} />}
      {error && (
        <p style={{ fontSize: 12, color: 'var(--color-text-danger)', margin: 0 }}>{error}</p>
      )}

      {data?.summary && (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 10px' }}>
          {data.summary}
        </p>
      )}
      {data?.error && (
        <p style={{ fontSize: 11, color: 'var(--color-text-danger)', margin: '0 0 10px' }}>
          {data.error} — showing heuristic recommendations.
        </p>
      )}

      {recommendations.length === 0 && data && !loading && (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>
          No recommendations to show.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {recommendations.map((r, i) => (
          <RecommendationCard
            key={i}
            rec={r}
            datasetId={datasetId}
            context={context}
          />
        ))}
      </div>

      <div
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: '0.5px solid var(--color-border-tertiary)',
        }}
      >
        <p className="ax-lbl" style={{ margin: '0 0 6px' }}>Ask a follow-up</p>
        <div className="ax-prompt-row">
          <input
            type="text"
            value={followQ}
            onChange={(e) => setFollowQ(e.target.value)}
            placeholder={followupPlaceholder(context)}
            style={{ flex: 1, minWidth: 0 }}
            disabled={followLoading}
            onKeyDown={(e) => e.key === 'Enter' && askFollowup()}
          />
          <button
            className="ax-btn prim"
            onClick={askFollowup}
            disabled={followLoading || !followQ.trim()}
            type="button"
          >
            {followLoading ? <InlineSpinner label="Asking..." /> : 'Ask'}
          </button>
        </div>
        {followAnswer && (
          <div
            style={{
              marginTop: 8,
              padding: '8px 10px',
              background: 'var(--color-background-secondary)',
              borderRadius: 6,
              fontSize: 12,
              whiteSpace: 'pre-wrap',
            }}
          >
            {followAnswer.explanation}
          </div>
        )}
      </div>
      </>}
    </div>
  )
}

function RecommendationCard({ rec, datasetId, context }) {
  const [expanded, setExpanded] = useState(false)
  const [explanation, setExplanation] = useState(null)
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    const next = !expanded
    setExpanded(next)
    if (next && !explanation && !loading) {
      setLoading(true)
      try {
        const r = await api.aiExplain(
          datasetId,
          'recommendation',
          { context, recommendation: rec },
          'Explain this recommendation in 2 short sentences (why it matters here, what to watch out for), then a plain numbered list of 2–4 short steps to act on it.',
        )
        setExplanation(r)
      } catch (err) {
        setExplanation({ ai: false, explanation: 'The assistant could not generate details right now. You can continue with the built-in recommendation.' })
      } finally {
        setLoading(false)
      }
    }
  }

  // Adapt to the different recommendation shapes returned per context.
  const headline =
    rec.title ||
    (rec.test ? `${rec.test}` : null) ||
    (rec.target ? `Predict ${rec.target} (${rec.task})` : null) ||
    (rec.method ? `${rec.method} expansion` : 'Recommendation')

  const rationale = rec.rationale
  const meta = []
  if (rec.category) meta.push({ label: rec.category })
  if (rec.task) meta.push({ label: rec.task })
  if (rec.variables?.length) meta.push({ label: `vars: ${rec.variables.join(', ')}` })
  if (rec.algorithms?.length) meta.push({ label: `algos: ${rec.algorithms.join(', ')}` })
  if (rec.target_rows) meta.push({ label: `target rows: ${rec.target_rows}` })

  return (
    <div
      className="ax-card"
      style={{
        padding: '10px 12px',
        background: 'var(--color-background-secondary)',
        borderColor: 'transparent',
      }}
    >
      <div className="ax-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{headline}</p>
          {rationale && (
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '3px 0 0' }}>
              {rationale}
            </p>
          )}
          {meta.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
              {meta.map((m, i) => (
                <span
                  key={i}
                  className="ax-chip"
                  style={{
                    background: 'var(--color-background-primary)',
                    color: 'var(--color-text-secondary)',
                    fontSize: 10,
                  }}
                >
                  {m.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <button className="ax-btn" onClick={toggle} type="button">
          {expanded ? 'Hide' : 'Explain'}
        </button>
      </div>

      {expanded && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: 6,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
          {loading ? <InlineSpinner label="Generating explanation..." /> : explanation?.explanation || 'No detail available.'}
        </div>
      )}

      {(rec.preprocessing?.length > 0 || rec.leakage_risks?.length > 0) && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rec.preprocessing?.length > 0 && (
            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: 0 }}>
              <strong>Preprocessing:</strong> {rec.preprocessing.join(' · ')}
            </p>
          )}
          {rec.leakage_risks?.length > 0 && (
            <p style={{ fontSize: 11, color: 'var(--color-text-danger)', margin: 0 }}>
              <strong>Leakage risk:</strong> {rec.leakage_risks.join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function hasRecommendationContent(rec) {
  if (!rec || typeof rec !== 'object') return false
  return Boolean(
    rec.title ||
    rec.test ||
    rec.target ||
    rec.method ||
    rec.rationale ||
    rec.variables?.length ||
    rec.algorithms?.length ||
    rec.preprocessing?.length ||
    rec.leakage_risks?.length,
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

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 1L8.3 5.1L12.5 6L8.3 8.2L7 13L5.7 8.2L1.5 6L5.7 5.1L7 1Z"
        fill="var(--color-accent)"
      />
    </svg>
  )
}

function titleForContext(context) {
  switch (context) {
    case 'tests':
      return 'AI test recommendations'
    case 'models':
      return 'AI modeling recommendations'
    case 'expand':
      return 'AI expansion plan'
    default:
      return 'AI analyst'
  }
}

function followupPlaceholder(context) {
  switch (context) {
    case 'tests':
      return 'Which test should I run for…?'
    case 'models':
      return 'Which target column would be the best predictor?'
    case 'expand':
      return 'Is bootstrap or synthetic better for my dataset?'
    default:
      return 'Ask anything about your dataset…'
  }
}
