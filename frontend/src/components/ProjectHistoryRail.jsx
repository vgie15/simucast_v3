import React, { useEffect, useState } from 'react'
import { api } from '../api'

export default function ProjectHistoryRail({ dataset, onViewStage, onRestored, collapsed, onStartResize }) {
  const datasetId = dataset?.id
  const [stages, setStages] = useState([])
  const [currentStageId, setCurrentStageId] = useState('original')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState(null)

  const load = async () => {
    if (!datasetId) return
    setLoading(true)
    setError('')
    try {
      const r = await api.listStages(datasetId)
      setStages(r.stages || [])
      setCurrentStageId(r.current_stage_id || 'original')
    } catch (err) {
      setError(err.message || 'Could not load history')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (collapsed) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, dataset?.current_stage_id, collapsed])

  const handleRestore = async (stageId) => {
    if (!window.confirm('Restore this stage? Stages after it will be removed.')) return
    setRestoring(stageId)
    try {
      await api.restoreStage(datasetId, stageId)
      await load()
      if (onRestored) await onRestored()
    } catch (err) {
      setError(err.message || 'Restore failed')
    } finally {
      setRestoring(null)
    }
  }

  if (!datasetId || collapsed) return null

  const originalIsCurrent = currentStageId === 'original' || !currentStageId
  const rowCount = dataset?.row_count?.toLocaleString?.() || dataset?.row_count
  const colCount = dataset?.col_count

  return (
    <aside className="ax-history-rail">
      <div className="ax-rail-header">
        <span className="ax-rail-title">History</span>
      </div>

      <div className="ax-rail-body">
        {loading && <p className="ax-rail-meta">Loading…</p>}
        {error && <p className="ax-rail-meta ax-rail-error">{error}</p>}
        {!loading && !error && stages.length === 0 && !originalIsCurrent && null}
        {!loading && !error && stages.length === 0 && originalIsCurrent && (
          <p className="ax-rail-meta">
            No transforms yet — clean or expand the dataset to start the timeline.
          </p>
        )}
        <ol className="ax-history-list">
          <HistoryCard
            isCurrent={originalIsCurrent}
            title="Original upload"
            summary={null}
            meta={`${rowCount} rows · ${colCount} cols`}
            onView={() => onViewStage && onViewStage('original')}
            onRestore={originalIsCurrent ? null : () => handleRestore('original')}
            restoring={restoring === 'original'}
          />
          {stages.map((stage) => {
            const isCurrent = stage.id === currentStageId
            return (
              <HistoryCard
                key={stage.id}
                isCurrent={isCurrent}
                title={stage.op_type || 'Transform'}
                summary={stage.summary || null}
                meta={`${stage.row_count?.toLocaleString?.() || stage.row_count} rows · ${stage.col_count} cols`}
                onView={() => onViewStage && onViewStage(stage.id)}
                onRestore={isCurrent ? null : () => handleRestore(stage.id)}
                restoring={restoring === stage.id}
              />
            )
          })}
        </ol>
      </div>
      {onStartResize && (
        <div
          className="ax-rail-resize-handle right"
          onMouseDown={(e) => {
            e.preventDefault()
            onStartResize()
          }}
          aria-hidden
        />
      )}
    </aside>
  )
}

function HistoryCard({ isCurrent, title, summary, meta, onView, onRestore, restoring }) {
  return (
    <li
      className={`ax-history-item ${isCurrent ? 'current' : ''}`}
      onClick={onView}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onView && onView()
        }
      }}
    >
      <strong className="ax-history-card-title">{title}</strong>
      {summary && <p className="ax-history-card-summary">{summary}</p>}
      <small className="ax-history-card-meta">{meta}</small>
      {onRestore && (
        <div className="ax-history-card-actions">
          <button
            type="button"
            className="ax-history-restore"
            onClick={(e) => {
              e.stopPropagation()
              onRestore()
            }}
            disabled={restoring}
          >
            {restoring ? 'Restoring…' : 'Restore'}
          </button>
        </div>
      )}
    </li>
  )
}
