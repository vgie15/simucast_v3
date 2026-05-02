import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'data_prep', label: 'Data prep' },
  { key: 'analysis', label: 'Analysis' },
  { key: 'model', label: 'Model' },
  { key: 'whatif', label: 'Scenario' },
  { key: 'report', label: 'Report' },
]

export default function ActivityPanel({ datasetId, onViewStage, onRestored }) {
  const [activity, setActivity] = useState([])
  const [stages, setStages] = useState([])
  const [currentStageId, setCurrentStageId] = useState('original')
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [order, setOrder] = useState('desc')
  const [noteFor, setNoteFor] = useState(null)
  const [note, setNote] = useState('')
  const [openDetails, setOpenDetails] = useState({})
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

  const timeline = useMemo(() => {
    const stageById = Object.fromEntries(stages.map((stage) => [stage.id, stage]))
    return activity
      .map((item, index) => {
        const relatedStage = item.related_stage_id ? stageById[item.related_stage_id] : null
        return {
          ...item,
          stepNumber: index + 1,
          stage: relatedStage,
          sortDate: item.created_at || relatedStage?.created_at || '',
        }
      })
      .sort((a, b) => {
        const av = new Date(a.sortDate || 0).getTime()
        const bv = new Date(b.sortDate || 0).getTime()
        return order === 'asc' ? av - bv : bv - av
      })
  }, [activity, stages, order])

  const filteredTimeline = timeline.filter((item) => {
    const kind = item.category || item.kind
    return filter === 'all' || kind === filter || item.kind === filter
  })

  const addNote = async (item) => {
    const summary = note.trim()
    if (!summary || busy) return
    setBusy(true)
    try {
      await api.createActivityNote(datasetId, {
        activity_id: item.id,
        summary,
        replace: (item.detail?.notes || []).length > 0,
      })
      setNote('')
      setNoteFor(null)
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

      <div className="ax-activity-filters">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <select value={order} onChange={(e) => setOrder(e.target.value)}>
          <option value="desc">Latest first</option>
          <option value="asc">Oldest first</option>
        </select>
      </div>

      {loading && activity.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Loading activity...</p>
      ) : filteredTimeline.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>No matching activity.</p>
      ) : (
        <div className="ax-activity-list">
          {filteredTimeline.map((item) => {
            const isActive = item.related_stage_id && (currentStageId || 'original') === item.related_stage_id
            const notes = item.detail?.notes || []
            const detailsOpen = !!openDetails[item.id]
            return (
              <div
                key={item.id}
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
                    #{item.stepNumber}
                  </span>
                  <span className="ax-chip">{labelFor(item.action_type || item.category || item.kind)}</span>
                  {item.stage?.op_type && <span className="ax-chip">{item.stage.op_type}</span>}
                  {isActive && <span className="ax-chip" style={{ background: 'var(--color-accent)', color: 'white' }}>active</span>}
                  <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                    {item.created_at ? new Date(item.created_at).toLocaleString() : ''}
                  </span>
                </div>
                <p style={{ fontSize: 12, margin: '4px 0 0' }}>{item.summary}</p>
                {item.stage && (
                  <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>
                    Stage {item.stage.step_index} - {item.stage.row_count?.toLocaleString()} rows - {item.stage.col_count} cols
                  </p>
                )}
                <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                  <button
                    className="ax-btn"
                    onClick={() => setOpenDetails((current) => ({ ...current, [item.id]: !current[item.id] }))}
                  >
                    {detailsOpen ? 'Hide details' : 'Details'}
                  </button>
                  {item.related_stage_id && (
                    <>
                      <button className="ax-btn" onClick={() => onViewStage?.(item.related_stage_id)}>View stage</button>
                      <a
                        className="ax-btn"
                        href={api.exportCsvUrl(datasetId, item.related_stage_id)}
                        download
                        style={{ textDecoration: 'none' }}
                      >
                        Export CSV
                      </a>
                      {!isActive && (
                        <button className="ax-btn" onClick={() => restore(item.related_stage_id)} disabled={busy}>
                          Restore
                        </button>
                      )}
                    </>
                  )}
                  <button
                    className="ax-btn"
                    onClick={() => {
                      const isOpen = noteFor === item.id
                      setNoteFor(isOpen ? null : item.id)
                      setNote(isOpen ? '' : (notes[notes.length - 1]?.text || ''))
                    }}
                    disabled={busy}
                  >
                    {notes.length ? 'Edit note' : 'Add note'}
                  </button>
                </div>
                {detailsOpen && (
                  <div className="ax-activity-details">
                    {item.detail?.column && <p><strong>Column:</strong> {item.detail.column}</p>}
                    {item.detail?.mapping && (
                      <div>
                        <strong>Mapping:</strong>
                        <ul>
                          {Object.entries(item.detail.mapping).slice(0, 20).map(([from, to]) => (
                            <li key={from}><code>{from}</code> to <code>{String(to)}</code></li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {item.detail?.inputs && <p><strong>Inputs:</strong> {JSON.stringify(item.detail.inputs)}</p>}
                    {item.detail?.prediction && <p><strong>Prediction:</strong> {JSON.stringify(item.detail.prediction)}</p>}
                  </div>
                )}
                {notes.length > 0 && (
                  <div className="ax-activity-note">
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 500 }}>Note</p>
                    {notes.map((n) => (
                      <p key={n.id} style={{ margin: '2px 0 0', fontSize: 12 }}>{n.text}</p>
                    ))}
                  </div>
                )}
                {noteFor === item.id && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addNote(item)
                      }}
                      placeholder="Note for this step..."
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <button className="ax-btn prim" onClick={() => addNote(item)} disabled={busy || !note.trim()}>
                      Save
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function labelFor(kind) {
  const labels = {
    data_prep: 'Data Prep',
    category_standardization: 'Data Prep',
    cell_edit: 'Data Prep',
    impute_mean: 'Data Prep',
    impute_median: 'Data Prep',
    impute_mode: 'Data Prep',
    drop_rows: 'Data Prep',
    winsorize: 'Data Prep',
    analysis: 'Analysis',
    test_t: 'Evaluation',
    test_anova: 'Evaluation',
    test_chi: 'Evaluation',
    test_corr: 'Evaluation',
    cluster: 'Evaluation',
    pca: 'Evaluation',
    model: 'Modeling',
    train_model: 'Modeling',
    save_whatif_scenario: 'Scenario',
    whatif: 'Scenario',
    report: 'Report',
    stage: 'Data Prep',
    restore: 'Restore',
    upload: 'Upload',
    clone: 'Clone',
  }
  return labels[kind] || kind
}
