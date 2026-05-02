import React, { useEffect, useState } from 'react'
import { api } from '../api'

export default function ActivityPanel({ datasetId, onViewStage, onRestored }) {
  const [activity, setActivity] = useState([])
  const [stages, setStages] = useState([])
  const [currentStageId, setCurrentStageId] = useState('original')
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (!datasetId) return
    setLoading(true)
    try {
      const [activityResult, stageResult] = await Promise.all([
        api.listActivity(datasetId, 'asc'),
        api.listStages(datasetId),
      ])
      setActivity(activityResult.activity || [])
      setStages([...(stageResult.stages || [])].sort((a, b) => (a.step_index || 0) - (b.step_index || 0)))
      setCurrentStageId(stageResult.current_stage_id || 'original')
    } catch (err) {
      console.error('Failed to load activity', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [datasetId])

  const addNote = async () => {
    const summary = note.trim()
    if (!summary || busy) return
    setBusy(true)
    try {
      await api.createActivityNote(datasetId, { summary })
      setNote('')
      await load()
    } catch (err) {
      alert('Could not add note: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const restore = async (stageId) => {
    if (!stageId || busy) return
    setBusy(true)
    try {
      await api.restoreStage(datasetId, stageId)
      await load()
      onRestored?.(stageId)
    } catch (err) {
      alert('Restore failed: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const normalizedQuery = query.trim().toLowerCase()
  const showStages = filter === 'all' || filter === 'stages' || filter === 'data_prep'
  const filteredStages = showStages
    ? stages.filter((stage) => {
        if (!normalizedQuery) return true
        return [stage.summary, stage.op_type, String(stage.step_index)]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery))
      })
    : []
  const filteredActivity = activity.filter((item) => {
    const kind = item.category || item.kind
    if (filter === 'stages') return false
    if (filter !== 'all' && kind !== filter && item.kind !== filter) return false
    if (!normalizedQuery) return true
    return [item.summary, kind, item.action_type, item.kind]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery))
  })

  return (
    <div className="ax-card ax-activity-panel">
      <div className="ax-row" style={{ marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Documentation</p>
          <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>
            Project actions for methods, audit trail, and reports.
          </p>
        </div>
        <button className="ax-btn" onClick={load} disabled={loading}>Refresh</button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addNote()
          }}
          placeholder="Add a note..."
          style={{ flex: 1, minWidth: 0 }}
        />
        <button className="ax-btn prim" onClick={addNote} disabled={busy || !note.trim()}>
          Add
        </button>
      </div>

      <div className="ax-activity-filters">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All</option>
          <option value="stages">Stages</option>
          <option value="data_prep">Data prep</option>
          <option value="analysis">Analysis</option>
          <option value="model">Model</option>
          <option value="ai">AI</option>
          <option value="report">Report</option>
          <option value="note">Notes</option>
        </select>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search log..."
        />
      </div>

      {filteredStages.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p className="ax-lbl" style={{ marginBottom: 6 }}>Data stages</p>
          <div className="ax-activity-list">
            {filteredStages.map((stage) => {
              const isActive = (currentStageId || 'original') === stage.id
              return (
                <div
                  key={stage.id}
                  className="ax-activity-item"
                  style={{
                    borderColor: isActive ? 'var(--color-accent)' : undefined,
                    background: isActive ? 'var(--color-accent-light)' : undefined,
                    borderRadius: 6,
                    padding: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>
                      #{stage.step_index}
                    </span>
                    <span className="ax-chip">{stage.op_type}</span>
                    {isActive && <span className="ax-chip" style={{ background: 'var(--color-accent)', color: 'white' }}>active</span>}
                  </div>
                  <p style={{ fontSize: 12, margin: '4px 0 0' }}>{stage.summary}</p>
                  <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>
                    {stage.row_count?.toLocaleString()} rows - {stage.col_count} cols
                    {stage.created_at && ` - ${new Date(stage.created_at).toLocaleString()}`}
                  </p>
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                    <button className="ax-btn" onClick={() => onViewStage?.(stage.id)}>
                      View
                    </button>
                    <a
                      className="ax-btn"
                      href={api.exportCsvUrl(datasetId, stage.id)}
                      download
                      style={{ textDecoration: 'none' }}
                    >
                      Export CSV
                    </a>
                    {!isActive && (
                      <button className="ax-btn" onClick={() => restore(stage.id)} disabled={busy}>
                        Restore
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {loading && activity.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Loading activity...</p>
      ) : activity.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>No activity yet.</p>
      ) : filteredActivity.length === 0 && filteredStages.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>No matching activity.</p>
      ) : (
        <div className="ax-activity-list">
          {filteredActivity.map((item) => (
            <div key={item.id} className="ax-activity-item">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="ax-chip">{labelFor(item.category || item.kind)}</span>
                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                  {item.created_at ? new Date(item.created_at).toLocaleString() : ''}
                </span>
              </div>
              <p style={{ fontSize: 12, margin: '4px 0 0' }}>{item.summary}</p>
              {item.related_stage_id && (
                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  <button className="ax-btn" onClick={() => onViewStage?.(item.related_stage_id)}>
                    View stage
                  </button>
                  <button className="ax-btn" onClick={() => restore(item.related_stage_id)} disabled={busy}>
                    Restore
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function labelFor(kind) {
  const labels = {
    data_prep: 'Data prep',
    analysis: 'Analysis',
    model: 'Model',
    ai: 'AI',
    report: 'Report',
    note: 'Note',
    stage: 'Data prep',
    restore: 'Restore',
    upload: 'Upload',
    clone: 'Clone',
  }
  return labels[kind] || kind
}
