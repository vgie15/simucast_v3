import React, { useEffect, useState } from 'react'
import { api } from '../api'

export default function ProjectHistoryRail({ dataset, onViewStage, onRestored }) {
  const datasetId = dataset?.id
  const collapseKey = datasetId ? `simucast.historyRail.collapsed.${datasetId}` : ''
  const [stages, setStages] = useState([])
  const [currentStageId, setCurrentStageId] = useState('original')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [restoring, setRestoring] = useState(null)

  useEffect(() => {
    if (!collapseKey) return
    setCollapsed(window.localStorage.getItem(collapseKey) === '1')
  }, [collapseKey])

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
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, dataset?.current_stage_id])

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c
      if (collapseKey) window.localStorage.setItem(collapseKey, next ? '1' : '0')
      return next
    })
  }

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

  if (!datasetId) return null

  return (
    <aside className={`ax-history-rail ${collapsed ? 'collapsed' : ''}`}>
      <div className="ax-rail-header">
        {!collapsed && <span className="ax-rail-title">History</span>}
        <button
          type="button"
          className="ax-rail-collapse"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand history' : 'Collapse history'}
          title={collapsed ? 'Expand history' : 'Collapse history'}
        >
          <RailChevron open={!collapsed} side="left" />
        </button>
      </div>

      {!collapsed && (
        <div className="ax-rail-body">
          {loading && <p className="ax-rail-meta">Loading…</p>}
          {error && <p className="ax-rail-meta ax-rail-error">{error}</p>}
          {!loading && !error && stages.length === 0 && (
            <p className="ax-rail-meta">
              No transforms yet — clean or expand the dataset to start the timeline.
            </p>
          )}
          <ol className="ax-history-list">
            <li className={`ax-history-item ${currentStageId === 'original' || !currentStageId ? 'current' : ''}`}>
              <button type="button" onClick={() => onViewStage && onViewStage('original')}>
                <span className="ax-history-step">0</span>
                <span className="ax-history-label">
                  <strong>Original upload</strong>
                  <small>
                    {dataset?.row_count?.toLocaleString?.() || dataset?.row_count} rows · {dataset?.col_count} cols
                  </small>
                </span>
              </button>
            </li>
            {stages.map((stage) => {
              const isCurrent = stage.id === currentStageId
              return (
                <li key={stage.id} className={`ax-history-item ${isCurrent ? 'current' : ''}`}>
                  <button type="button" onClick={() => onViewStage && onViewStage(stage.id)}>
                    <span className="ax-history-step">{stage.step_index}</span>
                    <span className="ax-history-label">
                      <strong>{stage.op_type || 'Transform'}</strong>
                      {stage.summary && <small>{stage.summary}</small>}
                      <small>
                        {stage.row_count?.toLocaleString?.() || stage.row_count} rows · {stage.col_count} cols
                      </small>
                    </span>
                  </button>
                  {!isCurrent && (
                    <button
                      type="button"
                      className="ax-btn mini"
                      onClick={() => handleRestore(stage.id)}
                      disabled={restoring === stage.id}
                    >
                      {restoring === stage.id ? '…' : 'Restore'}
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </aside>
  )
}

function RailChevron({ open, side }) {
  const rotate = open ? (side === 'left' ? 180 : 0) : (side === 'left' ? 0 : 180)
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 12 12"
      fill="none"
      style={{ transform: `rotate(${rotate}deg)`, transition: 'transform 0.15s' }}
    >
      <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  )
}
