/* ============================================================
 * COMPONENT: ACTIVITY LOG PANEL (Redesigned)
 * Keywords: activity, log, history, audit, undo
 * ============================================================ */
import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { useDialog } from '../common/DialogProvider'

export default function ActivityPanel({
  dataset,
  datasetId,
  onClose,
  onViewStage,
  onRestored
}) {
  const dialog = useDialog()
  const [activity, setActivity] = useState([])
  const [stages, setStages] = useState([])
  const [currentStageId, setCurrentStageId] = useState('original')
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [note, setNote] = useState('')
  const [noteFor, setNoteFor] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
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
        return bv - av // Latest first
      })
  }, [activity, stages])

  // Filter entries in real-time by summary title text
  const filteredTimeline = useMemo(() => {
    return timeline.filter((item) => {
      if (!searchQuery.trim()) return true
      return String(item.summary || '').toLowerCase().includes(searchQuery.toLowerCase())
    })
  }, [timeline, searchQuery])

  // Group entries by date
  const groupedEntries = useMemo(() => {
    const groups = {}
    filteredTimeline.forEach((item) => {
      const groupKey = getGroupLabel(item.sortDate)
      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push(item)
    })
    return groups
  }, [filteredTimeline])

  const addNote = async (item) => {
    const summary = note.trim()
    if (!summary || busy) return
    setBusy(true)
    try {
      const notes = item.detail?.notes || []
      await api.createActivityNote(datasetId, {
        activity_id: item.id,
        summary,
        replace: notes.length > 0,
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

  const resetProject = async () => {
    if (busy) return
    const ok = await dialog.confirm({
      title: 'Reset project to initial state?',
      message: 'This will undo ALL changes and cannot be undone.',
      confirmLabel: 'Reset',
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

  // Stats calculation
  const changesCount = activity.length
  const stepsDone = dataset?.guidance?.completed_tips?.length || 0
  const notesCount = activity.filter((item) => item.detail?.notes && item.detail.notes.length > 0).length

  return (
    <div className="ax-history-drawer">
      {/* 1. Header Section */}
      <div className="ax-history-drawer-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: 'var(--color-text-primary)' }}>History</h2>
            <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>
              Timeline of all changes made to this project
            </p>
          </div>
          <button
            type="button"
            className="ax-history-close-btn"
            onClick={onClose}
            aria-label="Close history"
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
              transition: 'background 0.2s, color 0.2s',
            }}
          >
            <TablerIcon name="x" size={16} />
          </button>
        </div>

        {/* Stats Row */}
        <div className="ax-history-stats-row">
          <div className="ax-history-stat-col">
            <strong>{changesCount}</strong>
            <span>Changes</span>
          </div>
          <div className="ax-history-stat-col">
            <strong>{stepsDone}</strong>
            <span>Steps done</span>
          </div>
          <div className="ax-history-stat-col">
            <strong>{notesCount}</strong>
            <span>Notes</span>
          </div>
        </div>
      </div>

      {/* 2. Search Bar */}
      <div className="ax-history-search-container">
        <TablerIcon name="search" size={14} className="ax-history-search-icon" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search history…"
          className="ax-history-search-input"
        />
      </div>

      {/* 3. Grouped Date Entries */}
      <div className="ax-history-list-wrapper">
        {loading && activity.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', padding: '0 16px' }}>Loading activity...</p>
        ) : filteredTimeline.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', padding: '0 16px' }}>No matching activity.</p>
        ) : (
          Object.entries(groupedEntries).map(([groupLabel, items]) => (
            <div key={groupLabel} className="ax-history-group">
              <div className="ax-history-group-header">{groupLabel}</div>
              {items.map((item) => {
                const { type, iconName, badgeLabel } = mapActivityToEntry(item)
                const isExpanded = expandedId === item.id
                const notes = item.detail?.notes || []
                const isLatestStep = item.stepNumber === timeline.length // Timeline is descending sorted, but stepNumber maps to original index
                const isActive = item.related_stage_id && (currentStageId || 'original') === item.related_stage_id
                
                const canUndo = isLatestStep && (
                  (item.related_stage_id && item.related_stage_id !== 'original' && isActive) ||
                  (!item.related_stage_id && (item.related_model_id || item.related_analysis_id || item.kind === 'report' || item.kind === 'whatif'))
                )
                const canRevert = !isLatestStep && item.related_stage_id && !isActive
                const showUndo = type !== 'reset' && (canUndo || canRevert)
                
                const timeString = item.created_at
                  ? new Date(item.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                  : ''
                const details = getExpandedDetails(item)

                return (
                  <div key={item.id} className="ax-history-card">
                    {/* Collapsed view */}
                    <div
                      className="ax-history-card-header-row"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    >
                      <div className={`ax-history-card-icon-container bg-${type}`}>
                        <TablerIcon name={iconName} size={14} />
                      </div>

                      <div className="ax-history-card-title-badge">
                        <span className="ax-history-card-title" title={item.summary}>
                          {item.summary}
                        </span>
                        <span className={`ax-history-card-badge badge-${type}`}>
                          {badgeLabel}
                        </span>
                      </div>

                      <div className="ax-history-card-right" onClick={(e) => e.stopPropagation()}>
                        <span className="ax-history-card-time">{timeString}</span>
                        <div className="ax-history-card-actions">
                          <button
                            type="button"
                            className="ax-history-action-btn"
                            title="Add note"
                            onClick={() => {
                              setExpandedId(item.id)
                              setNoteFor(item.id)
                              setNote(notes[notes.length - 1]?.text || '')
                            }}
                          >
                            <TablerIcon name="note" size={13} />
                          </button>
                          {showUndo && (
                            <button
                              type="button"
                              className="ax-history-action-btn undo"
                              title={canUndo ? 'Undo step' : 'Revert to this step'}
                              onClick={() => {
                                if (canUndo) {
                                  undoStep(item)
                                } else {
                                  revertToStep(item.related_stage_id)
                                }
                              }}
                            >
                              <TablerIcon name="arrow-back-up" size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="ax-history-card-expanded-area">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <p className="ax-history-kv-row">
                            <strong>Action: </strong>
                            <span>{details['Action']}</span>
                          </p>
                          <p className="ax-history-kv-row">
                            <strong>Affected columns: </strong>
                            <span>{details['Affected columns']}</span>
                          </p>
                          <p className="ax-history-kv-row">
                            <strong>Rows changed: </strong>
                            <span>{details['Rows changed']}</span>
                          </p>
                          <p className="ax-history-kv-row">
                            <strong>Method used: </strong>
                            <span>{details['Method used']}</span>
                          </p>
                        </div>

                        {/* Existing note */}
                        {notes.length > 0 && (
                          <div className="ax-history-existing-note">
                            <span style={{ fontSize: '9px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Note:</span>
                            <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--color-text-primary)', fontStyle: 'italic', wordBreak: 'break-word' }}>
                              {notes[notes.length - 1].text}
                            </p>
                          </div>
                        )}

                        {/* Add note interface */}
                        <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                          <textarea
                            rows={2}
                            value={noteFor === item.id ? note : ''}
                            onChange={(e) => {
                              setNoteFor(item.id)
                              setNote(e.target.value)
                            }}
                            placeholder="Add a note about this step…"
                            className="ax-history-note-textarea"
                          />
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                            <button
                              type="button"
                              className="ax-btn mini prim"
                              style={{
                                background: 'var(--color-accent)',
                                color: '#fff',
                                borderRadius: 4,
                                fontSize: 11,
                                padding: '4px 10px',
                                border: 'none',
                                cursor: 'pointer',
                              }}
                              onClick={() => addNote(item)}
                              disabled={busy || !note.trim() || noteFor !== item.id}
                            >
                              Save note
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>

      {/* 4. Footer Reset Section */}
      <div className="ax-history-drawer-footer">
        <button
          type="button"
          className="ax-history-reset-btn"
          onClick={resetProject}
          disabled={busy}
        >
          Reset project to initial state
        </button>
        <p className="ax-history-reset-warning">
          This will undo all changes. Cannot be undone.
        </p>
      </div>
    </div>
  )
}

// Maps activity data to standard categories
function mapActivityToEntry(item) {
  const kind = String(item.kind || '').toLowerCase()
  const action = String(item.action_type || '').toLowerCase()
  const summary = String(item.summary || '').toLowerCase()

  let type = 'transform'
  let iconName = 'chart-histogram'
  let badgeLabel = 'Transform'

  if (kind === 'reset' || action === 'reset' || summary.includes('reset')) {
    type = 'reset'
    iconName = 'refresh'
    badgeLabel = 'Reset'
  } else if (
    kind.includes('impute') ||
    kind.includes('winsorize') ||
    summary.includes('missing') ||
    summary.includes('outlier') ||
    action.includes('missing') ||
    action.includes('outlier')
  ) {
    type = 'fix'
    iconName = 'circle-dotted'
    badgeLabel = 'Fix'
  } else if (
    kind.includes('drop') ||
    kind.includes('remove_row') ||
    action.includes('remove_row') ||
    summary.includes('remove') ||
    summary.includes('duplicate')
  ) {
    type = 'remove'
    iconName = 'copy-off'
    badgeLabel = 'Remove'
  } else if (
    kind.includes('standard') ||
    kind.includes('category') ||
    kind.includes('label') ||
    action.includes('category') ||
    action.includes('label') ||
    summary.includes('label')
  ) {
    type = 'label'
    iconName = 'tag'
    badgeLabel = 'Labels'
  } else if (
    kind.includes('column') ||
    action.includes('column') ||
    summary.includes('column') ||
    summary.includes('gpa_bin')
  ) {
    type = 'structure'
    iconName = 'column-remove'
    badgeLabel = 'Structure'
  }

  return { type, iconName, badgeLabel }
}

// Build key-value details for expanded cards
function getExpandedDetails(item) {
  const detail = item.detail || {}

  // Action
  const action = detail.action_type || item.action_type || item.kind
  const actionVal = action ? humanize(action) : '—'

  // Affected columns
  const cols = detail.column ? [detail.column] : detail.features || detail.columns || []
  const colsVal = Array.isArray(cols) && cols.length ? cols.join(', ') : '—'

  // Rows changed
  let rowsVal = '—'
  if (detail.rows_changed !== undefined) {
    rowsVal = String(detail.rows_changed)
  } else if (item.stage?.row_count) {
    rowsVal = `${item.stage.row_count.toLocaleString()} total`
  } else if (detail.removed_rows_count !== undefined) {
    rowsVal = `-${detail.removed_rows_count} rows`
  }

  // Method used
  const methodVal = detail.method || detail.algorithm || item.kind || '—'

  return {
    Action: actionVal,
    'Affected columns': colsVal,
    'Rows changed': rowsVal,
    'Method used': humanize(methodVal),
  }
}

// Formats a date into grouped categories
function getGroupLabel(dateString) {
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return 'UNKNOWN DATE'

  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  const formatDateString = (d) => {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()
  }

  const isSameDay = (d1, d2) => {
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate()
  }

  if (isSameDay(date, today)) {
    return `TODAY — ${formatDateString(date)}`
  } else if (isSameDay(date, yesterday)) {
    return `YESTERDAY — ${formatDateString(date)}`
  } else {
    const weekday = date.toLocaleDateString('en-US', { weekday: 'long' })
    return `${weekday.toUpperCase()} — ${formatDateString(date)}`
  }
}

// Humanizes a snake_case keyword
function humanize(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Custom Tabler-like inline SVG path mapper
function TablerIcon({ name, size = 16, className = '' }) {
  const path = {
    search: (
      <>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </>
    ),
    'circle-dotted': (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4v.01M12 20v.01M4 12h.01M20 12h.01" />
      </>
    ),
    'alert-triangle': (
      <>
        <path d="M12 3l9 16H3L12 3z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
    'copy-off': (
      <>
        <path d="M8 8h8v8H8z" />
        <path d="M6 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1-1-1h10a1 1 0 0 1 1 1v1M4 4l16 16" />
      </>
    ),
    tag: (
      <>
        <path d="M4 4h6l10 10-6 6L4 10V4z" />
        <circle cx="8" cy="8" r="1" />
      </>
    ),
    'chart-histogram': (
      <>
        <path d="M4 19h16" />
        <path d="M7 16V9M12 16V5M17 16v-3" />
      </>
    ),
    'ruler-measure': (
      <>
        <path d="M4 15l11-11 5 5-11 11-5-5z" />
        <path d="M8 15l-1-1M11 12l-1-1M14 9l-1-1" />
      </>
    ),
    columns: <path d="M6 5h5v14H6zM13 5h5v14h-5z" />,
    'column-remove': (
      <>
        <path d="M5 5h14v14H5zM12 5v14M9 12h6" />
      </>
    ),
    'row-remove': (
      <>
        <path d="M5 5h14v14H5zM5 12h14M9 16h6" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
      </>
    ),
    note: (
      <>
        <path d="M9 11h6M9 15h4M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      </>
    ),
    'arrow-back-up': (
      <>
        <path d="M9 11l-4 4 4 4M5 15h11a4 4 0 0 0 4-4v-1a4 4 0 0 0-4-4H8" />
      </>
    ),
    x: (
      <>
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </>
    ),
  }[name] || <path d="M5 12h14" />

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {path}
    </svg>
  )
}
