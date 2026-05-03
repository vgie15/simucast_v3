import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useDialog } from './DialogProvider'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'data_prep', label: 'Data prep' },
  { key: 'analysis', label: 'Analysis' },
  { key: 'model', label: 'Model' },
  { key: 'whatif', label: 'Scenario' },
  { key: 'report', label: 'Report' },
]

export default function ActivityPanel({ datasetId, onViewStage, onRestored }) {
  const dialog = useDialog()
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
      await dialog.alert({ title: 'Could Not Add Note', message: err.message, variant: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const revertToStep = async (stageId) => {
    if (!stageId || busy) return
    const ok = await dialog.confirm({
      title: 'Revert to This Step',
      message: 'Revert the dataset to this step?',
      details: 'The dataset will be set back to the state at this step. You can revert forward again at any time.',
      affectedItems: ['Dataset state'],
      cancelLabel: 'Cancel',
      confirmLabel: 'Revert',
      variant: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try {
      await api.restoreStage(datasetId, stageId)
      await load()
      onRestored?.(stageId)
    } catch (err) {
      await dialog.alert({ title: 'Revert Failed', message: err.message, variant: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const resetProject = async () => {
    if (busy) return
    const ok = await dialog.confirm({
      title: 'Reset Project',
      message: 'This will permanently remove all data transformations, trained models, what-if scenarios, and documentation steps.',
      details: 'The dataset will revert to the original uploaded state. A single log entry will be kept to record the reset.',
      affectedItems: [
        'All data cleaning and transformations',
        'All trained models',
        'All what-if scenarios',
        'All documentation steps',
      ],
      requireText: 'RESET',
      confirmLabel: 'Reset Project',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try {
      await api.resetProject(datasetId)
      await load()
      onRestored?.()
    } catch (err) {
      await dialog.alert({ title: 'Reset Failed', message: err.message, variant: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const undoStep = async (item) => {
    if (busy) return
    const ok = await dialog.confirm({
      title: 'Undo Step',
      message: 'Undo this step and remove its documentation entry?',
      details: 'Data steps will revert the dataset. Model and analysis steps will delete the saved artifact.',
      affectedItems: ['Linked data stage, model, analysis, report, or scenario', 'Documentation entry'],
      cancelLabel: 'Cancel',
      confirmLabel: 'Undo Step',
      variant: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try {
      await api.deleteActivity(datasetId, item.id, true)
      await load()
      onRestored?.()
    } catch (err) {
      await dialog.alert({ title: 'Undo Failed', message: err.message, variant: 'danger' })
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
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="ax-btn" onClick={load} disabled={loading}>Refresh</button>
          <button
            className="ax-btn"
            style={{ background: 'rgba(220, 38, 38, 0.08)', borderColor: 'rgba(220, 38, 38, 0.35)', color: '#DC2626' }}
            onClick={resetProject}
            disabled={busy}
          >
            Reset project
          </button>
        </div>
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
          {(() => {
            const latestStepNumber = timeline.length > 0 ? Math.max(...timeline.map((t) => t.stepNumber)) : 0
            return filteredTimeline.map((item) => {
            const isActive = item.related_stage_id && (currentStageId || 'original') === item.related_stage_id
            const isLatestStep = item.stepNumber === latestStepNumber
            const notes = item.detail?.notes || []
            const detailsOpen = !!openDetails[item.id]
            const detailRows = detailsForItem(item)
            const canUndo = isLatestStep && (
              (item.related_stage_id && item.related_stage_id !== 'original' && isActive) ||
              (!item.related_stage_id && (item.related_model_id || item.related_analysis_id || item.kind === 'report' || item.kind === 'whatif'))
            )
            const canRevert = !isLatestStep && item.related_stage_id && !isActive
            return (
              <div
                key={item.id}
                className={`ax-activity-item ${isActive ? 'active' : ''}`}
                style={{
                  borderColor: isActive ? 'var(--color-accent)' : undefined,
                  background: isActive ? 'var(--color-accent-light)' : undefined,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>
                    #{item.stepNumber}
                  </span>
                  <span className={`ax-chip ${badgeClassFor(item.action_type || item.category || item.kind)}`}>
                    {labelFor(item.action_type || item.category || item.kind)}
                  </span>
                  {item.stage?.op_type && <span className="ax-chip ax-badge-data">{item.stage.op_type}</span>}
                  {isActive && <span className="ax-chip ax-badge-active">active</span>}
                  <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                    {item.created_at ? new Date(item.created_at).toLocaleString() : ''}
                  </span>
                </div>
                <p style={{ fontSize: 12, margin: '4px 0 0', fontWeight: 650 }}>{item.summary}</p>
                {detailRows.slice(0, 2).map((row) => (
                  <p key={row.label} style={{ fontSize: 10.5, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>
                    <strong>{row.label}:</strong> {row.value}
                  </p>
                ))}
                {item.stage && (
                  <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>
                    Stage {item.stage.step_index} - {item.stage.row_count?.toLocaleString()} rows - {item.stage.col_count} cols
                  </p>
                )}
                <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                  {detailRows.length > 0 && (
                    <button
                      className="ax-btn"
                      onClick={() => setOpenDetails((current) => ({ ...current, [item.id]: !current[item.id] }))}
                    >
                      {detailsOpen ? 'Hide details' : 'Details'}
                    </button>
                  )}
                  {item.related_stage_id && (
                    <button className="ax-btn" onClick={() => onViewStage?.(item.related_stage_id)}>View stage</button>
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
                  {canUndo && (
                    <button
                      className="ax-btn"
                      style={{
                        background: 'rgba(251, 146, 60, 0.12)',
                        borderColor: 'rgba(251, 146, 60, 0.45)',
                      }}
                      onClick={() => undoStep(item)}
                      disabled={busy}
                    >
                      ↩ Undo step
                    </button>
                  )}
                  {canRevert && (
                    <button className="ax-btn" onClick={() => revertToStep(item.related_stage_id)} disabled={busy}>
                      ↺ Revert to this step
                    </button>
                  )}
                </div>
                {detailsOpen && (
                  <div className="ax-activity-details">
                    {detailRows.map((row) => <p key={row.label}><strong>{row.label}:</strong> {row.value}</p>)}
                    {item.detail?.mapping && <MappingList mapping={item.detail.mapping} />}
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
            })
          })()}
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

function MappingList({ mapping }) {
  const entries = Object.entries(mapping || {})
  if (!entries.length) return null
  return (
    <div>
      <strong>Before vs after:</strong>
      <ul>
        {entries.slice(0, 20).map(([from, to]) => (
          <li key={from}><code>{from}</code> to <code>{String(to)}</code></li>
        ))}
      </ul>
    </div>
  )
}

function detailsForItem(item) {
  const detail = item.detail || {}
  const rows = []
  const action = detail.action_type || item.action_type || item.kind
  if (action) rows.push({ label: 'Action', value: humanize(action) })
  const columns = detail.column ? [detail.column] : detail.features || detail.columns || []
  if (Array.isArray(columns) && columns.length) rows.push({ label: 'Affected columns', value: columns.join(', ') })
  if (detail.target) rows.push({ label: 'Target', value: detail.target })
  if (detail.algorithm) rows.push({ label: 'Model', value: humanize(detail.algorithm) })
  if (detail.mapping) {
    const beforeCount = new Set(Object.keys(detail.mapping)).size
    const afterCount = new Set(Object.values(detail.mapping).map(String)).size
    rows.push({ label: 'Summary of changes', value: `Merged ${beforeCount} categories into ${afterCount}` })
  } else if (item.stage) {
    rows.push({ label: 'Summary of changes', value: `${item.stage.row_count?.toLocaleString?.() || item.stage.row_count} rows, ${item.stage.col_count} columns after this step` })
  } else if (detail.parameters) {
    rows.push({ label: 'Parameters', value: compactJson(detail.parameters) })
  } else if (detail.config) {
    rows.push({ label: 'Configuration', value: compactJson(detail.config) })
  }
  if (detail.inputs) rows.push({ label: 'Scenario inputs', value: compactJson(detail.inputs) })
  if (detail.prediction) rows.push({ label: 'Prediction', value: compactJson(detail.prediction) })
  return rows.filter((row) => row.value !== undefined && row.value !== null && String(row.value).trim() !== '')
}

function humanize(value) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function compactJson(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function badgeClassFor(kind) {
  const label = labelFor(kind).toLowerCase()
  if (label.includes('data') || label.includes('restore')) return 'ax-badge-data'
  if (label.includes('evaluation')) return 'ax-badge-evaluation'
  if (label.includes('analysis')) return 'ax-badge-analysis'
  if (label.includes('model')) return 'ax-badge-model'
  if (label.includes('scenario')) return 'ax-badge-scenario'
  if (label.includes('report')) return 'ax-badge-report'
  if (label.includes('upload')) return 'ax-badge-upload'
  if (label.includes('note')) return 'ax-badge-note'
  return 'ax-badge-default'
}
