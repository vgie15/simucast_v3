/* ============================================================
 * COMPONENT: DATA DETAIL VIEW
 * Keywords: data detail, inspect
 * ============================================================ */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api'
import ColumnVisibilityMenu from './ColumnVisibilityMenu'
import { BusyOverlay } from '../common/LoadingStates'
import { useAuth } from '../providers/AuthProvider'
import { useDatasetTableState } from './useDatasetTableState'

const PAGE_SIZE = 100
const TYPE_ICON = {
  numeric: '#',
  int: '#',
  float: '#',
  binary: '0/1',
  category: 'A',
  text: 'A',
  datetime: '⌚',
}
const TYPE_LABEL = {
  numeric: 'NUMERIC',
  int: 'INT',
  float: 'FLOAT',
  binary: 'BINARY',
  category: 'CATEGORY',
  text: 'TEXT',
  datetime: 'DATETIME',
}
const CHANGE_TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'missing', label: 'Missing value fixes' },
  { value: 'outlier', label: 'Outlier changes' },
  { value: 'removed', label: 'Removed rows' },
  { value: 'converted', label: 'Encoded/converted values' },
  { value: 'scaled', label: 'Scaled values' },
  { value: 'generated', label: 'Generated columns' },
]

// Detail view that paginates dataset rows with column visibility controls and the about panel.
export default function DataDetailView({
  dataset,
  variables,
  stageId,
  currentStageId,
  stageLabel,
  refreshKey,
  preferredViewMode = 'cleaned',
  onDataChanged,
}) {
  const datasetId = dataset?.id
  const [rowColumns, setRowColumns] = useState([])
  const {
    viewMode,
    changeScope,
    changeType,
    activeChangeIndex,
    changeStages,
    changeLoading,
    setViewMode,
    setChangeScope,
    setChangeType,
    setActiveChangeIndex,
    setChangeStages,
    setChangeLoading,
  } = useDatasetTableState(datasetId, preferredViewMode)
  const variableColumns = useMemo(() => (variables || []).map((v) => v.name), [variables])
  const allColumns = useMemo(
    () => (rowColumns.length ? rowColumns : variableColumns),
    [rowColumns, variableColumns],
  )
  const tableVariables = useMemo(
    () => allColumns.map((name) => (variables || []).find((v) => v.name === name) || { name, dtype: 'text' }),
    [allColumns, variables],
  )

  const [rows, setRows] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [rowError, setRowError] = useState(null)

  const [aboutData, setAboutData] = useState(null)
  const [aboutLoading, setAboutLoading] = useState(false)

  const [visibleColumns, setVisibleColumns] = useState([])

  useEffect(() => {
    setVisibleColumns((prev) => {
      const filtered = prev.filter((name) => allColumns.includes(name))
      if (filtered.length === 0 && allColumns.length > 0) {
        return allColumns
      }
      return allColumns.filter((name) => filtered.includes(name))
    })
  }, [allColumns])

  const [editing, setEditing] = useState(null)
  const [savingEdits, setSavingEdits] = useState(false)
  const [cellError, setCellError] = useState(null)
  const cancelBlurRef = useRef(false)

  const [headerEdit, setHeaderEdit] = useState(null)
  const [savingHeader, setSavingHeader] = useState(false)
  const auth = useAuth()

  const [expanded, setExpanded] = useState(false)

  const visibleVariables = useMemo(
    () => visibleColumns.map((name) => tableVariables.find((v) => v.name === name)).filter(Boolean),
    [visibleColumns, tableVariables],
  )

  const effectiveStageId = viewMode === 'original' ? 'original' : stageId
  const readOnly = viewMode === 'original' || (!!stageId && stageId !== currentStageId)

  // load AI describe
  useEffect(() => {
    if (!datasetId) return
    if (auth.isGuest) {
      setAboutData(null)
      setAboutLoading(false)
      return
    }
    let cancelled = false
    setAboutLoading(true)
    api
      .aiRecommend(datasetId, 'describe')
      .then((r) => {
        if (!cancelled) setAboutData(r)
      })
      .catch(() => {
        if (!cancelled) setAboutData(null)
      })
      .finally(() => {
        if (!cancelled) setAboutLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [datasetId, dataset?.current_stage_id, auth.isGuest])

  // reset on stage / refresh
  useEffect(() => {
    setRows([])
    setRowColumns([])
    setVisibleColumns([])
    setPage(1)
    setHasMore(true)
    setEditing(null)
    setHeaderEdit(null)
    setCellError(null)
    setRowError(null)
  }, [datasetId, effectiveStageId, refreshKey, viewMode])

  // load rows page
  useEffect(() => {
    if (!datasetId) return
    let cancelled = false
    setLoading(true)
    setRowError(null)
    api
      .getRows(datasetId, page, PAGE_SIZE, effectiveStageId)
      .then((r) => {
        if (cancelled) return
        setRows((prev) => (page === 1 ? r.rows : [...prev, ...r.rows]))
        if (page === 1 && r.rows?.[0]) {
          setRowColumns(Object.keys(r.rows[0]).filter((key) => key !== '__row_index'))
        }
        setTotal(r.total || 0)
        setHasMore(page * PAGE_SIZE < (r.total || 0))
      })
      .catch((err) => {
        if (!cancelled) {
          setRows((prev) => (page === 1 ? [] : prev))
          setHasMore(false)
          setRowError(err.message || 'Dataset rows could not load.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [datasetId, effectiveStageId, page, refreshKey, viewMode])

  useEffect(() => {
    if (!datasetId) {
      setChangeStages([])
      return
    }
    let cancelled = false
    setChangeLoading(true)
    api
      .getTableChanges(datasetId, stageId || 'current')
      .then((response) => {
        if (!cancelled) setChangeStages(response.stages || [])
      })
      .catch(() => {
        if (!cancelled) setChangeStages([])
      })
      .finally(() => {
        if (!cancelled) setChangeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [datasetId, stageId, currentStageId, refreshKey, setChangeLoading, setChangeStages, viewMode])

  const scopedChangeStages = useMemo(() => {
    if (!changeStages.length) return []
    return changeScope === 'last' ? [changeStages[changeStages.length - 1]] : changeStages
  }, [changeScope, changeStages])
  const allVisibleChanges = useMemo(
    () => scopedChangeStages.flatMap((stage) => stage.changes || []),
    [scopedChangeStages],
  )
  const allRemovedRows = useMemo(
    () => scopedChangeStages.flatMap((stage) => stage.removed_rows || []),
    [scopedChangeStages],
  )
  const changedColumns = useMemo(
    () => new Set(scopedChangeStages.flatMap((stage) => stage.new_columns || [])),
    [scopedChangeStages],
  )
  const visibleChanges = useMemo(
    () => allVisibleChanges.filter((change) => changeType === 'all' || changeMatchesType(change, changeType, changedColumns)),
    [allVisibleChanges, changeType, changedColumns],
  )
  const removedRows = useMemo(
    () => (changeType === 'all' || changeType === 'removed' ? allRemovedRows : []),
    [allRemovedRows, changeType],
  )
  const changedCellMap = useMemo(() => {
    const cells = new Map()
    for (const change of visibleChanges) {
      cells.set(`${normalizeRowIndex(change.row_index)}:${change.column}`, change)
    }
    return cells
  }, [visibleChanges])
  useEffect(() => {
    setActiveChangeIndex((current) => Math.min(current, Math.max(visibleChanges.length - 1, 0)))
  }, [visibleChanges.length])

  useEffect(() => {
    if (viewMode !== 'highlight' || !visibleChanges.length) return
    const active = visibleChanges[activeChangeIndex]
    if (!active) return
    const activeRowIndex = normalizeRowIndex(active.row_index)
    if (!visibleColumns.includes(active.column)) {
      setVisibleColumns((current) => [...current, active.column].filter((name, index, list) => list.indexOf(name) === index))
    }
    const targetPage = Math.floor(activeRowIndex / PAGE_SIZE) + 1
    if (!rows.some((row) => normalizeRowIndex(row.__row_index) === activeRowIndex)) {
      if (page !== targetPage) {
        setRows([])
        setPage(targetPage)
      }
      return
    }
    const timer = window.setTimeout(() => {
      const cell = scrollRef.current?.querySelector(`[data-change-cell="${activeRowIndex}:${cssEscape(active.column)}"]`)
      cell?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
      cell?.classList.add('ax-dd-change-focus')
      window.setTimeout(() => cell?.classList.remove('ax-dd-change-focus'), 1300)
    }, 40)
    return () => window.clearTimeout(timer)
  }, [activeChangeIndex, page, rows, viewMode, visibleChanges, visibleColumns])

  // infinite scroll
  const sentinelRef = useRef(null)
  const scrollRef = useRef(null)
  useEffect(() => {
    if (!hasMore || loading) return
    const sentinel = sentinelRef.current
    const root = scrollRef.current
    if (!sentinel || !root) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          setPage((p) => p + 1)
        }
      },
      { root, threshold: 0.1, rootMargin: '300px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loading, rows.length])

  // cell edit helpers
  const startEdit = (row, column, value) => {
    if (readOnly || savingEdits) return
    const original = value === null || value === undefined ? '' : String(value)
    setCellError(null)
    setEditing({
      rowIndex: row.__row_index,
      column,
      value: original,
      original,
    })
  }

  const cancelEdit = () => {
    setEditing(null)
    setCellError(null)
  }

  const saveEditing = async (edit) => {
    if (!edit || savingEdits) return
    if (cancelBlurRef.current) {
      cancelBlurRef.current = false
      return
    }
    if (edit.value === edit.original) {
      setEditing(null)
      setCellError(null)
      return
    }
    setSavingEdits(true)
    setCellError(null)
    try {
      await api.updateCell(datasetId, {
        row_index: edit.rowIndex,
        column: edit.column,
        value: edit.value,
      })
      setRows((current) =>
        current.map((row) =>
          row.__row_index === edit.rowIndex ? { ...row, [edit.column]: edit.value === '' ? null : edit.value } : row,
        ),
      )
      setEditing(null)
      await onDataChanged?.()
    } catch (err) {
      setCellError(err.message || 'Cell update failed')
    } finally {
      setSavingEdits(false)
    }
  }

  const renderCellValue = useCallback(
    (row, column) => {
      const isEditing = editing && editing.rowIndex === row.__row_index && editing.column === column
      if (isEditing) {
        return (
          <input
            autoFocus
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                cancelBlurRef.current = true
                cancelEdit()
              }
            }}
            onBlur={() => saveEditing(editing)}
            className="ax-dd-cell-input"
            disabled={savingEdits}
          />
        )
      }
      return (
        <span className="ax-dd-cell-value">
          {row[column] === null || row[column] === undefined || row[column] === '' ? <em className="ax-dd-cell-empty">—</em> : String(row[column])}
        </span>
      )
    },
    [editing, savingEdits],
  )

  // header edit
  const openHeaderEdit = (variable) => {
    if (readOnly || savingHeader) return
    const normalized = ['int', 'float', 'category', 'text', 'datetime', 'binary'].includes(variable.dtype)
      ? variable.dtype
      : variable.dtype === 'numeric'
      ? 'float'
      : 'category'
    setHeaderEdit({ column: variable.name, newName: variable.name, dtype: normalized })
  }

  const applyHeaderEdit = async () => {
    if (!headerEdit || savingHeader) return
    const oldName = headerEdit.column
    const newName = String(headerEdit.newName || '').trim()
    const needsRename = newName && newName !== oldName
    const currentVar = variables.find((v) => v.name === oldName)
    const currentType = currentVar?.dtype === 'numeric' ? 'float' : currentVar?.dtype
    const needsType = headerEdit.dtype && headerEdit.dtype !== currentType
    if (!needsRename && !needsType) {
      setHeaderEdit(null)
      return
    }
    setSavingHeader(true)
    setCellError(null)
    try {
      let activeName = oldName
      if (needsRename) {
        await api.transform(datasetId, 'rename_column', { column: oldName, new_name: newName })
        activeName = newName
      }
      if (needsType) {
        await api.transform(datasetId, 'cast_column', { column: activeName, to: headerEdit.dtype })
      }
      setHeaderEdit(null)
      await onDataChanged?.()
    } catch (err) {
      setCellError(err.message || 'Column update failed')
    } finally {
      setSavingHeader(false)
    }
  }

  if (!dataset) return null

  const containerCls = `ax-data-detail ax-module-card ax-card-data ax-busy-host ${expanded ? 'expanded' : ''} ${savingEdits || savingHeader ? 'is-busy' : ''}`
  const latestStage = scopedChangeStages[scopedChangeStages.length - 1] || null
  const hasBaseRows = rows.length > 0
  const displayRows = mergeRemovedRows(rows, hasBaseRows ? removedRows : [], viewMode)

  const node = (
    <div className={containerCls}>
      <BusyOverlay
        active={savingEdits || savingHeader}
        title={savingHeader ? 'Updating column metadata...' : 'Saving data edits...'}
        detail="Creating a reversible dataset stage and refreshing the grid."
      />

      <header className="ax-dd-header">
        <div className="ax-module-head-main">
          <span className="ax-module-icon" aria-hidden>D</span>
          <div className="ax-module-copy">
            <p className="ax-module-title">{dataset.filename || dataset.name}</p>
            <span className="ax-module-subtitle">
            ({total ? total.toLocaleString() : (dataset.row_count || 0).toLocaleString()} rows · {allColumns.length} cols
            {stageLabel ? ` · ${stageLabel}` : ''})
            </span>
          </div>
        </div>
        <div className="ax-dd-actions">
          <a
            href={api.exportCsvUrl(datasetId, effectiveStageId)}
            download={(dataset.filename || dataset.name || 'dataset').replace(/\.[^.]+$/, '') + '.csv'}
            className="ax-dd-icon-btn"
            title="Download CSV"
            aria-label="Download CSV"
          >
            ⬇
          </a>
          <button
            type="button"
            className="ax-dd-icon-btn"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Exit fullscreen' : 'Expand to fullscreen'}
            aria-label={expanded ? 'Exit fullscreen' : 'Expand to fullscreen'}
          >
            {expanded ? '×' : '⛶'}
          </button>
        </div>
      </header>

      <nav className="ax-dd-tabs">
        <div className="ax-dd-viewmodes" role="tablist" aria-label="Dataset view">
          <button
            type="button"
            className={viewMode === 'original' ? 'active' : ''}
            onClick={() => setViewMode('original')}
          >
            Original
          </button>
          <button
            type="button"
            className={viewMode === 'cleaned' ? 'active' : ''}
            onClick={() => setViewMode('cleaned')}
          >
            Cleaned
          </button>
          <button
            type="button"
            className={viewMode === 'highlight' ? 'active' : ''}
            onClick={() => setViewMode('highlight')}
            disabled={!changeStages.length && !changeLoading}
          >
            Highlight Changes
          </button>
        </div>
        <div className="ax-dd-tabs-right">
          <ColumnVisibilityMenu
            allColumns={allColumns}
            selected={visibleColumns}
            onApply={setVisibleColumns}
          />
        </div>
      </nav>

      {viewMode === 'highlight' && (
        <section className="ax-dd-changebar" aria-live="polite">
          <div className="ax-dd-changebar-copy">
            <strong>{changeLoading ? 'Loading changes...' : formatVisibleChangeCount(visibleChanges.length, removedRows.length)}</strong>
            <span>
              {formatChangeSummary({ latestStage, changeScope, changeType, visibleChanges, removedRows })}
            </span>
          </div>
          <div className="ax-dd-changebar-controls">
            <label className="ax-dd-filter-chip">
              <span>Filter</span>
              <select value={changeScope} onChange={(event) => setChangeScope(event.target.value)}>
                <option value="all">All changes</option>
                <option value="last">Last change only</option>
              </select>
            </label>
            <label className="ax-dd-filter-chip">
              <span>Type</span>
              <select value={changeType} onChange={(event) => setChangeType(event.target.value)}>
                {CHANGE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <button type="button" className="ax-btn mini" onClick={() => setViewMode('cleaned')}>
              Clear highlights
            </button>
            <button
              type="button"
              className="ax-dd-nav-btn prev"
              onClick={() => setActiveChangeIndex((value) => (visibleChanges.length ? (value - 1 + visibleChanges.length) % visibleChanges.length : 0))}
              aria-label="Previous changed cell"
              title="Previous changed cell"
              disabled={!visibleChanges.length}
            >
              ‹
            </button>
            <button
              type="button"
              className="ax-dd-nav-btn next"
              onClick={() => setActiveChangeIndex((value) => (visibleChanges.length ? (value + 1) % visibleChanges.length : 0))}
              aria-label="Next changed cell"
              title="Next changed cell"
              disabled={!visibleChanges.length}
            >
              ›
            </button>
          </div>
        </section>
      )}

      {(savingEdits || cellError) && (
        <div className="ax-dd-pending">
          {savingEdits && <span>Saving cell edit...</span>}
          {cellError && <span className="ax-dd-error">{cellError}</span>}
        </div>
      )}

      <div className="ax-dd-table-wrap" ref={scrollRef}>
        <section className="ax-dd-about">
          <h4>About this file</h4>
          {aboutLoading && !aboutData && (
            <p className="ax-dd-about-loading">Generating description…</p>
          )}
          {aboutData?.subject && <p>{aboutData.subject}</p>}
          {aboutData?.feature_groups?.length > 0 && (
            <ul>
              {aboutData.feature_groups.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          )}
          {aboutData?.quality_note && <p className="ax-dd-quality">{aboutData.quality_note}</p>}
          {aboutData?.error && (
            <p className="ax-dd-quality">{aboutData.error}</p>
          )}
        </section>

        <table className="ax-dd-table">
          <thead>
            <tr className="ax-dd-colhead">
              <th className="ax-dd-rowhead">Row</th>
              {visibleVariables.map((v) => (
                <th key={v.name} className={viewMode === 'highlight' && changedColumns.has(v.name) ? 'ax-dd-new-column' : ''}>
                  <button
                    type="button"
                    className="ax-dd-col-button"
                    onClick={() => openHeaderEdit(v)}
                    disabled={readOnly}
                    title={readOnly ? 'Read-only stage' : 'Rename column or change type'}
                  >
                    <span className="ax-dd-typeicon" data-type={v.dtype}>{TYPE_ICON[v.dtype] || '?'}</span>
                    <span className="ax-dd-colname">{v.name}</span>
                    <small className="ax-dd-coltype">{TYPE_LABEL[v.dtype] || v.dtype}</small>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !hasBaseRows && (
              <tr className="ax-dd-state-row">
                <td colSpan={(visibleColumns.length || 1) + 1}>Loading the current dataset rows...</td>
              </tr>
            )}
            {rowError && !hasBaseRows && (
              <tr className="ax-dd-state-row error">
                <td colSpan={(visibleColumns.length || 1) + 1}>{rowError}</td>
              </tr>
            )}
            {!loading && !rowError && !hasBaseRows && (
              <tr className="ax-dd-state-row">
                <td colSpan={(visibleColumns.length || 1) + 1}>No rows are available for this dataset stage.</td>
              </tr>
            )}
            {displayRows.map((row) => {
              const rowIndex = normalizeRowIndex(row.__row_index)
              const removedRow = row.__removed_row ? row.__removed_change : null
              return (
              <tr key={row.__removed_key || row.__row_index} className={removedRow ? 'ax-dd-removed-row' : ''}>
                <th scope="row" className="ax-dd-rownum">{removedRow ? `${rowIndex + 1} removed` : rowIndex + 1}</th>
                {visibleColumns.map((col) => {
                  const change = !removedRow && viewMode === 'highlight' ? changedCellMap.get(`${rowIndex}:${col}`) : null
                  return (
                    <td
                      key={col}
                      data-change-cell={`${rowIndex}:${col}`}
                      onClick={() => !removedRow && !readOnly && startEdit(row, col, row[col])}
                      className={[
                        readOnly || removedRow ? 'readonly' : '',
                        removedRow ? 'ax-dd-removed-cell' : '',
                        change ? `ax-dd-changed-cell ax-dd-change-${change.change_kind || 'converted'}` : '',
                        viewMode === 'highlight' && changedColumns.has(col) ? 'ax-dd-new-column-cell' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {renderCellValue(row, col)}
                      {change && <ChangeTooltip change={change} />}
                      {removedRow && <RemovedRowTooltip row={removedRow} column={col} />}
                    </td>
                  )
                })}
              </tr>
              )
            })}
            <tr ref={sentinelRef} className="ax-dd-sentinel">
              <td colSpan={(visibleColumns.length || 1) + 1}>
                {loading
                  ? 'Loading…'
                  : hasMore
                  ? ' '
                  : hasBaseRows
                  ? `End of ${total.toLocaleString()} rows`
                  : ''}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {headerEdit && (
        <div className="ax-dd-modal-backdrop" onClick={() => !savingHeader && setHeaderEdit(null)}>
          <div className="ax-dd-modal" onClick={(e) => e.stopPropagation()}>
            <h4>Edit column</h4>
            <label className="ax-lbl">
              Name
              <input
                value={headerEdit.newName}
                onChange={(e) => setHeaderEdit({ ...headerEdit, newName: e.target.value })}
                disabled={savingHeader}
              />
            </label>
            <label className="ax-lbl">
              Type
              <select
                value={headerEdit.dtype}
                onChange={(e) => setHeaderEdit({ ...headerEdit, dtype: e.target.value })}
                disabled={savingHeader}
              >
                <option value="int">Integer</option>
                <option value="float">Float</option>
                <option value="category">Category</option>
                <option value="binary">Binary</option>
                <option value="text">Text</option>
                <option value="datetime">Datetime</option>
              </select>
            </label>
            <div className="ax-dd-modal-actions">
              <button type="button" className="ax-btn" onClick={() => setHeaderEdit(null)} disabled={savingHeader}>
                Cancel
              </button>
              <button type="button" className="ax-btn prim" onClick={applyHeaderEdit} disabled={savingHeader}>
                {savingHeader ? 'Saving…' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return node
}

function RemovedRowsPreview({ rows, visibleColumns }) {
  const [open, setOpen] = useState(true)
  const previewColumns = visibleColumns.slice(0, 5)
  return (
    <section className="ax-dd-removed-preview">
      <button type="button" onClick={() => setOpen((value) => !value)}>
        <strong>Recently Removed Rows</strong>
        <span>{rows.length} row{rows.length === 1 ? '' : 's'} removed in the visible change set</span>
        <em>{open ? 'Hide' : 'Show'}</em>
      </button>
      {open && (
        <div className="ax-dd-removed-list">
          {rows.slice(0, 5).map((row) => (
            <article key={`${row.stage_id || 'stage'}-${row.row_index}`}>
              <p>Original row {Number(row.row_index || 0) + 1}: {row.reason}</p>
              <div>
                {previewColumns.map((column) => (
                  <span key={column}>
                    <b>{column}</b>
                    {formatChangeValue(row.values?.[column])}
                  </span>
                ))}
              </div>
            </article>
          ))}
          {rows.length > 5 && <small>{rows.length - 5} more removed rows are tracked in this dataset stage.</small>}
        </div>
      )}
    </section>
  )
}

function ChangeTooltip({ change }) {
  return (
    <span className="ax-dd-change-tooltip" role="tooltip">
      <b>{change.action_type || 'Changed value'}</b>
      <span><em>Original</em>{formatChangeValue(change.original_value)}</span>
      <span><em>Cleaned</em>{formatChangeValue(change.new_value)}</span>
      <span><em>Method</em>{change.method || 'dataset transform'}</span>
      <span><em>Reason</em>{change.reason || 'Updated in the current stage.'}</span>
    </span>
  )
}

function RemovedRowTooltip({ row, column }) {
  const duplicateRow = formatDuplicateRow(row)
  return (
    <span className="ax-dd-change-tooltip" role="tooltip">
      <b>{row.action_type || 'Removed row'}</b>
      <span><em>Original</em>{formatChangeValue(row.values?.[column])}</span>
      <span><em>Cleaned</em>Removed from this stage</span>
      <span><em>Method</em>{row.method || 'row removal'}</span>
      {duplicateRow && <span><em>Duplicate</em>{duplicateRow}</span>}
      <span><em>Reason</em>{row.reason || 'This row was removed by the latest transformation.'}</span>
    </span>
  )
}

function formatChangeValue(value) {
  if (value === null || value === undefined || value === '') return 'Blank'
  return String(value)
}

function formatVisibleChangeCount(cellCount, rowCount) {
  const parts = []
  if (cellCount > 0) parts.push(`${cellCount} changed cell${cellCount === 1 ? '' : 's'}`)
  if (rowCount > 0) parts.push(`${rowCount} removed row${rowCount === 1 ? '' : 's'}`)
  return parts.length ? parts.join(', ') : '0 changes'
}

function formatChangeSummary({ latestStage, changeScope, changeType, visibleChanges, removedRows }) {
  if (changeType !== 'all' && !visibleChanges.length && !removedRows.length) {
    return 'No changes match the current filter.'
  }
  const base = latestStage?.summary || (changeScope === 'last' ? 'Showing the latest data change.' : 'Showing all stored data changes for this stage.')
  if (!removedRows.length) return base
  return `${base} ${removedRows.length} removed row${removedRows.length === 1 ? '' : 's'} tracked.`
}

function changeMatchesType(change, type, changedColumns = new Set()) {
  const kind = String(change.change_kind || '').toLowerCase()
  const action = String(change.action_type || '').toLowerCase()
  const method = String(change.method || '').toLowerCase()
  const text = `${kind} ${action} ${method}`
  if (type === 'missing') return text.includes('missing') || text.includes('fill')
  if (type === 'outlier') return text.includes('outlier') || text.includes('cap') || text.includes('clip')
  if (type === 'converted') return text.includes('convert') || text.includes('encode') || text.includes('standardize') || text.includes('category')
  if (type === 'scaled') return text.includes('scale') || text.includes('standardize_numeric') || text.includes('normalize')
  if (type === 'generated') return changedColumns.has(change.column) || text.includes('generated') || text.includes('new_column')
  return true
}

function mergeRemovedRows(rows, removedRows, viewMode) {
  if (viewMode !== 'highlight' || !removedRows.length) return rows
  const removed = removedRows.map((row, index) => ({
    ...(row.values || {}),
    __row_index: normalizeRowIndex(row.row_index),
    __removed_row: true,
    __removed_change: withDuplicateMatch(row, rows),
    __removed_key: `removed-${row.stage_id || 'stage'}-${row.row_index}-${index}`,
  }))
  return [...rows, ...removed].sort((a, b) => {
    const diff = normalizeRowIndex(a.__row_index) - normalizeRowIndex(b.__row_index)
    if (diff !== 0) return diff
    if (a.__removed_row && !b.__removed_row) return -1
    if (!a.__removed_row && b.__removed_row) return 1
    return 0
  })
}

function withDuplicateMatch(removedRow, currentRows) {
  if (!isDuplicateRemoval(removedRow) || removedRow.duplicate_of_row_index !== undefined) {
    return removedRow
  }
  const columns = Object.keys(removedRow.values || {})
  const match = currentRows.find((row) =>
    columns.every((column) => sameDuplicateValue(row[column], removedRow.values?.[column])),
  )
  if (!match) return removedRow
  return {
    ...removedRow,
    duplicate_of_row_index: normalizeRowIndex(match.__row_index),
  }
}

function isDuplicateRemoval(row) {
  const text = `${row.action_type || ''} ${row.method || ''} ${row.reason || ''}`.toLowerCase()
  return text.includes('duplicate')
}

function sameDuplicateValue(left, right) {
  if ((left === null || left === undefined || left === '') && (right === null || right === undefined || right === '')) return true
  return String(left) === String(right)
}

function formatDuplicateRow(row) {
  const value = row.duplicate_of_row_index ?? row.duplicate_of_source_row_index ?? row.kept_row_index
  if (value === null || value === undefined || value === '') return ''
  return `Matches kept row ${normalizeRowIndex(value) + 1}`
}

function normalizeRowIndex(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(value))
  return String(value).replace(/["\\]/g, '\\$&')
}
