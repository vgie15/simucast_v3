/* ============================================================
 * COMPONENT: FLOATING DATASET PREVIEW
 * Keywords: dataset, preview, floating, stage, table, changes
 * ============================================================ */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import ColumnVisibilityMenu from './ColumnVisibilityMenu'
import { useDatasetTableState } from './useDatasetTableState'

const PAGE_SIZE = 100
const VIEW_MODES = [
  { id: 'original', label: 'Original' },
  { id: 'cleaned', label: 'Cleaned' },
  { id: 'highlight', label: 'Highlight Changes' },
]
const TYPE_ICON = {
  numeric: '#',
  int: '#',
  float: '#',
  binary: '0/1',
  category: 'A',
  text: 'A',
  datetime: 'T',
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

// Compact read-only dataset table for pages without the full Data table.
export default function FloatingDatasetPreview({ dataset, activeTab = 'data' }) {
  const datasetId = dataset?.id
  const [dataTableInView, setDataTableInView] = useState(false)
  const hidden = !datasetId || (activeTab === 'data' && dataTableInView)

  const [open, setOpen] = useState(false)
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
  } = useDatasetTableState(datasetId)
  const [rows, setRows] = useState([])
  const [rowColumns, setRowColumns] = useState([])
  const [visibleColumns, setVisibleColumns] = useState([])
  const [page, setPage] = useState(1)
  const [totalRows, setTotalRows] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingRows, setLoadingRows] = useState(false)
  const [error, setError] = useState('')

  const scrollRef = useRef(null)
  const sentinelRef = useRef(null)

  useEffect(() => {
    if (activeTab !== 'data') {
      setDataTableInView(false)
      return
    }

    let observer = null
    let cancelled = false

    const watchTable = () => {
      if (cancelled) return
      const tableCard = document.querySelector('.ax-data-detail')
      if (!tableCard) {
        setDataTableInView(false)
        return
      }

      observer = new IntersectionObserver(
        ([entry]) => {
          setDataTableInView(entry.isIntersecting && entry.intersectionRatio > 0.18)
        },
        {
          root: null,
          threshold: [0, 0.18, 0.4, 0.8],
          rootMargin: '-80px 0px -80px 0px',
        },
      )
      observer.observe(tableCard)
    }

    const timer = window.setTimeout(watchTable, 150)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      observer?.disconnect()
    }
  }, [activeTab, datasetId])

  const variableColumns = useMemo(() => (dataset?.variables || []).map((variable) => variable.name), [dataset?.variables])
  const allColumns = useMemo(
    () => (rowColumns.length ? rowColumns : variableColumns),
    [rowColumns, variableColumns],
  )
  const tableVariables = useMemo(
    () => allColumns.map((name) => (dataset?.variables || []).find((variable) => variable.name === name) || { name, dtype: 'text' }),
    [allColumns, dataset?.variables],
  )
  const visibleVariables = useMemo(
    () => visibleColumns.map((name) => tableVariables.find((variable) => variable.name === name)).filter(Boolean),
    [tableVariables, visibleColumns],
  )

  useEffect(() => {
    setOpen(false)
    setRows([])
    setRowColumns([])
    setVisibleColumns([])
    setPage(1)
    setTotalRows(0)
    setHasMore(false)
    setError('')
  }, [datasetId])

  useEffect(() => {
    if (!hidden) return
    setOpen(false)
  }, [hidden])

  useEffect(() => {
    setVisibleColumns((current) => {
      const filtered = current.filter((name) => allColumns.includes(name))
      if (filtered.length) return allColumns.filter((name) => filtered.includes(name))
      return allColumns
    })
  }, [allColumns])

  useEffect(() => {
    if (!datasetId) {
      setChangeStages([])
      return
    }
    if (!open) return
    let cancelled = false
    setChangeLoading(true)
    setError('')

    api
      .getTableChanges(datasetId, 'current')
      .then((tableChanges) => {
        if (cancelled) return
        setChangeStages(Array.isArray(tableChanges.stages) ? tableChanges.stages : [])
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
  }, [dataset?.current_stage_id, datasetId, open, setChangeLoading, setChangeStages, viewMode])

  useEffect(() => {
    setRows([])
    setRowColumns([])
    setPage(1)
    setHasMore(false)
    setError('')
  }, [dataset?.current_stage_id, datasetId, open, viewMode])

  useEffect(() => {
    if (!open || !datasetId || !dataset) return
    let cancelled = false
    setLoadingRows(true)
    setError('')
    const stageId = viewMode === 'original' ? 'original' : dataset.current_stage_id || undefined

    api
      .getRows(datasetId, page, PAGE_SIZE, stageId)
      .then((response) => {
        if (cancelled) return
        const nextRows = Array.isArray(response.rows) ? response.rows : []
        setRows((current) => (page === 1 ? nextRows : [...current, ...nextRows]))
        if (page === 1 && nextRows[0]) {
          setRowColumns(Object.keys(nextRows[0]).filter((key) => key !== '__row_index'))
        }
        const total = Number(response.total || 0)
        setTotalRows(total)
        setHasMore(page * PAGE_SIZE < total)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Dataset rows could not load.')
      })
      .finally(() => {
        if (!cancelled) setLoadingRows(false)
      })

    return () => {
      cancelled = true
    }
  }, [dataset, datasetId, open, page, viewMode])

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
    visibleChanges.forEach((change) => cells.set(`${normalizeRowIndex(change.row_index)}:${change.column}`, change))
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
      setVisibleColumns((current) =>
        allColumns.filter((name) => current.includes(name) || name === active.column),
      )
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
    }, 80)
    return () => window.clearTimeout(timer)
  }, [activeChangeIndex, allColumns, page, rows, viewMode, visibleChanges, visibleColumns])

  useEffect(() => {
    if (!hasMore || loadingRows) return
    const sentinel = sentinelRef.current
    const root = scrollRef.current
    if (!sentinel || !root) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRows) {
          setPage((current) => current + 1)
        }
      },
      { root, threshold: 0.1, rootMargin: '260px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadingRows, rows.length])

  if (hidden) return null

  const latestStage = changeStages[changeStages.length - 1] || null
  const effectiveRows = totalRows || dataset?.row_count || 0
  const displayRows = mergeRemovedRows(rows, removedRows, viewMode)

  return (
    <div className={`ax-floating-dataset ${open ? 'open' : ''}`}>
      {open && (
        <section className="ax-floating-dataset-panel" aria-label="Dataset preview">
          <header className="ax-floating-dataset-header">
            <div className="ax-floating-dataset-title">
              <span className="ax-floating-dataset-mark" aria-hidden><TableIcon /></span>
              <div>
                <h2>{dataset.filename || dataset.name || 'Dataset preview'}</h2>
                <p>{previewStatus(dataset, effectiveRows, allColumns.length)}</p>
              </div>
            </div>
            <div className="ax-floating-dataset-header-actions">
              <a
                href={api.exportCsvUrl(datasetId, viewMode === 'original' ? 'original' : dataset.current_stage_id || undefined)}
                download={(dataset.filename || dataset.name || 'dataset').replace(/\.[^.]+$/, '') + '.csv'}
                className="ax-dd-icon-btn"
                title="Download CSV"
                aria-label="Download CSV"
              >
                <DownloadIcon />
              </a>
              <button
                type="button"
                className="ax-floating-dataset-close"
                onClick={() => setOpen(false)}
                aria-label="Close dataset preview"
                title="Close dataset preview"
              >
                <CloseIcon />
              </button>
            </div>
          </header>

          <div className="ax-floating-dataset-toolbar">
            <div className="ax-floating-dataset-modes" role="tablist" aria-label="Preview dataset view">
              {VIEW_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={viewMode === mode.id ? 'active' : ''}
                  disabled={mode.id === 'highlight' && !changeStages.length && !changeLoading}
                  onClick={() => setViewMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <div className="ax-floating-dataset-tools">
              <ColumnVisibilityMenu allColumns={allColumns} selected={visibleColumns} onApply={setVisibleColumns} />
              <Link className="ax-btn mini" to={`/projects/${datasetId}/data`}>
                Open Data
              </Link>
            </div>
          </div>

          {viewMode === 'highlight' && (
            <section className="ax-dd-changebar ax-floating-dataset-changebar" aria-live="polite">
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

          <div className="ax-floating-dataset-body">
            {loadingRows && !rows.length && (
              <div className="ax-floating-dataset-loading" aria-live="polite">
                <span />
                <span />
                <span />
                <em>Loading the current dataset table...</em>
              </div>
            )}

            {error && <p className="ax-floating-dataset-error">{error}</p>}

            {!loadingRows && !error && rows.length === 0 && (
              <p className="ax-floating-dataset-empty">No rows are available for this dataset stage.</p>
            )}

            {rows.length > 0 && (
              <div className="ax-floating-dataset-table-wrap" ref={scrollRef}>
                <table className="ax-dd-table ax-floating-dataset-table">
                  <thead>
                    <tr className="ax-dd-colhead">
                      <th className="ax-floating-dataset-rowhead">Row</th>
                      {visibleVariables.map((variable) => (
                        <th key={variable.name} className={viewMode === 'highlight' && changedColumns.has(variable.name) ? 'ax-dd-new-column' : ''}>
                          <span className="ax-dd-typeicon" data-type={variable.dtype}>{TYPE_ICON[variable.dtype] || '?'}</span>
                          <span className="ax-dd-colname">{variable.name}</span>
                          <small className="ax-dd-coltype">{TYPE_LABEL[variable.dtype] || variable.dtype}</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row) => {
                      const rowIndex = normalizeRowIndex(row.__row_index)
                      const removedRow = row.__removed_row ? row.__removed_change : null
                      return (
                      <tr key={row.__removed_key || row.__row_index} className={removedRow ? 'ax-dd-removed-row' : ''}>
                        <th scope="row">{removedRow ? `${rowIndex + 1} removed` : rowIndex + 1}</th>
                        {visibleColumns.map((column) => {
                          const change = !removedRow && viewMode === 'highlight' ? changedCellMap.get(`${rowIndex}:${column}`) : null
                          return (
                            <td
                              key={column}
                              data-change-cell={`${rowIndex}:${column}`}
                              className={[
                                'readonly',
                                removedRow ? 'ax-dd-removed-cell' : '',
                                change ? `ax-dd-changed-cell ax-dd-change-${change.change_kind || 'converted'}` : '',
                                viewMode === 'highlight' && changedColumns.has(column) ? 'ax-dd-new-column-cell' : '',
                              ].filter(Boolean).join(' ')}
                            >
                              {formatValue(row[column])}
                              {change && <PreviewChangeTooltip change={change} />}
                              {removedRow && <RemovedRowTooltip row={removedRow} column={column} />}
                            </td>
                          )
                        })}
                      </tr>
                      )
                    })}
                    <tr ref={sentinelRef} className="ax-dd-sentinel">
                      <td colSpan={(visibleColumns.length || 1) + 1}>
                        {loadingRows
                          ? 'Loading...'
                          : hasMore
                          ? ' '
                          : `End of ${Number(effectiveRows || rows.length).toLocaleString()} rows`}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <footer className="ax-floating-dataset-footer">
            <span>
              Showing {rows.length.toLocaleString()} of {Number(effectiveRows || rows.length).toLocaleString()} rows from the {viewMode === 'original' ? 'uploaded' : 'current'} dataset.
            </span>
            {viewMode === 'highlight' && visibleChanges.length > 0 && (
              <strong>
                Change {Math.min(activeChangeIndex + 1, visibleChanges.length)} of {visibleChanges.length}
              </strong>
            )}
          </footer>
        </section>
      )}

      {!open && (
        <button
          type="button"
          className="ax-floating-dataset-launcher"
          onClick={() => setOpen(true)}
          aria-label="Open dataset table"
          title="Open dataset table"
        >
          <TableIcon />
          <span>Dataset</span>
        </button>
      )}
    </div>
  )
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
                    {formatValue(row.values?.[column])}
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

function PreviewChangeTooltip({ change }) {
  return (
    <span className="ax-dd-change-tooltip" role="tooltip">
      <b>{change.action_type || 'Changed value'}</b>
      <span><em>Original</em>{formatValue(change.original_value)}</span>
      <span><em>Cleaned</em>{formatValue(change.new_value)}</span>
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
      <span><em>Original</em>{formatValue(row.values?.[column])}</span>
      <span><em>Cleaned</em>Removed from this stage</span>
      <span><em>Method</em>{row.method || 'row removal'}</span>
      {duplicateRow && <span><em>Duplicate</em>{duplicateRow}</span>}
      <span><em>Reason</em>{row.reason || 'This row was removed by the latest transformation.'}</span>
    </span>
  )
}

function previewStatus(dataset, rowCount, columnCount) {
  const rows = Number(rowCount || dataset.row_count || 0).toLocaleString()
  const columns = Number(columnCount || dataset.col_count || dataset.variables?.length || 0).toLocaleString()
  const stage = dataset.current_stage_id ? 'current cleaned stage' : 'original upload'
  return `${rows} rows, ${columns} columns, ${stage}`
}

function formatValue(value) {
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

function normalizeRowIndex(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
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

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(value))
  return String(value).replace(/["\\]/g, '\\$&')
}

function TableIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M2 6h12M6 2.5v11M10 2.5v11" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v8" />
      <path d="M5 7l3 3 3-3" />
      <path d="M3 13h10" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}
