import React, { useEffect, useState } from 'react'
import { api } from '../api'

export default function DataGridViewer({
  datasetId,
  variables,
  stageId,
  stageLabel,
  currentStageId,
  refreshKey,
  onVariableClick,
  onDataChanged,
}) {
  const [tab, setTab] = useState('data')
  const [rows, setRows] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize] = useState(100)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null)
  const [pendingEdits, setPendingEdits] = useState({})
  const [savingEdits, setSavingEdits] = useState(false)
  const [cellError, setCellError] = useState(null)

  useEffect(() => {
    setPage(1)
    setEditing(null)
    setPendingEdits({})
    setCellError(null)
  }, [datasetId, stageId, refreshKey])

  useEffect(() => {
    if (tab !== 'data') return
    setLoading(true)
    api
      .getRows(datasetId, page, pageSize, stageId)
      .then((r) => {
        setRows(r.rows)
        setTotal(r.total)
      })
      .finally(() => setLoading(false))
  }, [datasetId, page, pageSize, tab, stageId, refreshKey])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const readOnly = !!stageId && stageId !== currentStageId
  const stageColumns = stageId && rows[0] ? Object.keys(rows[0]).filter((c) => c !== '__row_index') : null
  const columns = stageColumns || variables.map((v) => v.name)
  const headerVars = stageColumns
    ? stageColumns.map((name) => ({ name, dtype: 'text' }))
    : variables

  const editKey = (rowIndex, column) => `${rowIndex}::${column}`
  const editingKey = editing ? editKey(editing.rowIndex, editing.column) : null
  const editingDirty = !!editing && editing.value !== editing.original
  const pendingCount = Object.keys(pendingEdits).length + (editingDirty && !pendingEdits[editingKey] ? 1 : 0)

  const applyEditToPending = (current, edit) => {
    if (!edit) return current
    const key = editKey(edit.rowIndex, edit.column)
    const next = { ...current }
    if (edit.value === edit.original) {
      delete next[key]
    } else {
      next[key] = {
        row_index: edit.rowIndex,
        column: edit.column,
        value: edit.value,
        original: edit.original,
      }
    }
    return next
  }

  const commitEditingLocally = () => {
    if (!editing) return pendingEdits
    const next = applyEditToPending(pendingEdits, editing)
    setPendingEdits(next)
    setEditing(null)
    setCellError(null)
    return next
  }

  const startEdit = (row, column, value) => {
    if (readOnly) return
    let nextPendingEdits = pendingEdits
    if (editing) {
      nextPendingEdits = applyEditToPending(pendingEdits, editing)
      setPendingEdits(nextPendingEdits)
    }
    const key = editKey(row.__row_index, column)
    const original = value === null || value === undefined ? '' : String(value)
    const pending = nextPendingEdits[key]
    setCellError(null)
    setEditing({
      rowIndex: row.__row_index,
      column,
      value: pending ? pending.value : original,
      original,
    })
  }

  const cancelEdit = () => {
    setEditing(null)
    setCellError(null)
  }

  const discardAllEdits = () => {
    setEditing(null)
    setPendingEdits({})
    setCellError(null)
  }

  const saveAllEdits = async () => {
    if (savingEdits) return
    const nextPendingEdits = commitEditingLocally()
    const edits = Object.values(nextPendingEdits).map(({ row_index, column, value }) => ({
      row_index,
      column,
      value,
    }))
    if (edits.length === 0) return
    setSavingEdits(true)
    setCellError(null)
    try {
      await api.updateCells(datasetId, edits)
      setPendingEdits({})
      await onDataChanged?.()
    } catch (err) {
      setCellError(err.message || 'Cell updates failed')
    } finally {
      setSavingEdits(false)
    }
  }

  return (
    <div className="ax-card ax-data-grid-panel">
      <div className="ax-modal-header">
        <div>
          <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>
            Data grid{stageLabel ? ` - ${stageLabel}` : ''}
          </p>
          <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>
            {total.toLocaleString()} rows - {headerVars.length} columns
            {pendingCount > 0 ? ` - ${pendingCount} unsaved edit${pendingCount === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        {!readOnly && tab === 'data' && (
          <div className="ax-grid-save-bar">
            <button
              type="button"
              className="ax-btn prim"
              disabled={savingEdits || pendingCount === 0}
              onClick={saveAllEdits}
            >
              {savingEdits ? 'Saving changes' : 'Save changes'}
            </button>
            <button
              type="button"
              className="ax-btn"
              disabled={savingEdits || pendingCount === 0}
              onClick={discardAllEdits}
            >
              Cancel changes
            </button>
          </div>
        )}
      </div>

      <div className="ax-tabs">
        <button className={`ax-tab ${tab === 'data' ? 'active' : ''}`} onClick={() => setTab('data')}>
          Data View
        </button>
        <button className={`ax-tab ${tab === 'var' ? 'active' : ''}`} onClick={() => setTab('var')}>
          Variable View
        </button>
      </div>

      <div className="ax-modal-body">
        {tab === 'data' && (
          <>
            <div className="ax-grid-wrap ax-grid-wrap-inline">
              {loading ? (
                <p style={{ padding: 20, color: 'var(--color-text-secondary)' }}>Loading rows...</p>
              ) : (
                <table className="ax-grid">
                  <thead>
                    <tr>
                      <th className="ax-grid-row-num-head">#</th>
                      {headerVars.map((v) => (
                        <th key={v.name}>
                          {v.name}
                          <span className="ax-grid-type">{v.dtype}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i}>
                        <td className="ax-grid-row-num">{(page - 1) * pageSize + i + 1}</td>
                        {columns.map((column) => {
                          const value = row[column]
                          const key = editKey(row.__row_index, column)
                          const pending = pendingEdits[key]
                          const displayValue = pending ? pending.value : value
                          const missing = displayValue === null || displayValue === undefined || displayValue === ''
                          const isEditing = editing?.rowIndex === row.__row_index && editing?.column === column
                          return (
                            <td
                              key={column}
                              className={`${missing ? 'missing' : ''} ${isEditing ? 'editing' : ''} ${pending ? 'pending' : ''}`.trim()}
                              onClick={() => startEdit(row, column, value)}
                              title={readOnly ? 'Historical stages are read-only' : 'Click to edit'}
                              style={{ cursor: readOnly ? 'default' : 'text' }}
                            >
                              {isEditing ? (
                                <div className="ax-grid-cell-editor" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    className="ax-grid-cell-input"
                                    value={editing.value}
                                    autoFocus
                                    disabled={savingEdits}
                                    onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                    onBlur={commitEditingLocally}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault()
                                        commitEditingLocally()
                                      }
                                      if (e.key === 'Escape') {
                                        e.preventDefault()
                                        cancelEdit()
                                      }
                                    }}
                                  />
                                </div>
                              ) : (
                                missing ? '-' : formatCell(displayValue)
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="ax-grid-pagination">
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                Page {page} of {totalPages} - showing rows {(page - 1) * pageSize + 1}-
                {Math.min(page * pageSize, total)}
              </span>
              {cellError && <span style={{ fontSize: 11, color: 'var(--color-text-danger)' }}>{cellError}</span>}
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="ax-btn" disabled={page === 1} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                <button className="ax-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  Next
                </button>
              </div>
            </div>
          </>
        )}

        {tab === 'var' && (
          <div style={{ padding: 18 }}>
            <table className="ax-tbl" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Missing</th>
                  <th>Unique</th>
                </tr>
              </thead>
              <tbody>
                {variables.map((v) => (
                  <tr
                    key={v.name}
                    style={{ cursor: onVariableClick ? 'pointer' : undefined }}
                    onClick={() => onVariableClick?.(v)}
                  >
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v.name}</td>
                    <td>
                      <span className="ax-chip">{v.dtype}</span>
                    </td>
                    <td>{v.missing}</td>
                    <td>{v.unique}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function formatCell(value) {
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toString()
    return value.toFixed(3)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}
