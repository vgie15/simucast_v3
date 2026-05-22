/* ============================================================
 * COMPONENT: FLOATING DATASET PREVIEW
 * Keywords: dataset, preview, floating, stage, table, changes
 * ============================================================ */
import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'

const PREVIEW_ROWS = 12
const VIEW_MODES = [
  { id: 'original', label: 'Original' },
  { id: 'cleaned', label: 'Cleaned' },
  { id: 'highlight', label: 'Highlight Changes' },
]

// Compact read-only dataset table shown outside the Data page.
export default function FloatingDatasetPreview({ dataset, activeTab = 'data' }) {
  const datasetId = dataset?.id
  const hidden = !datasetId || activeTab === 'data'

  const [open, setOpen] = useState(false)
  const [viewMode, setViewMode] = useState('cleaned')
  const [rows, setRows] = useState([])
  const [totalRows, setTotalRows] = useState(0)
  const [changeStages, setChangeStages] = useState([])
  const [loadingDataset, setLoadingDataset] = useState(false)
  const [loadingRows, setLoadingRows] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setOpen(false)
    setViewMode('cleaned')
    setRows([])
    setTotalRows(0)
    setChangeStages([])
    setError('')
  }, [datasetId])

  useEffect(() => {
    if (!hidden) return
    setOpen(false)
  }, [hidden])

  useEffect(() => {
    if (!open || !datasetId) return
    let cancelled = false
    setLoadingDataset(true)
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
        if (!cancelled) setLoadingDataset(false)
      })

    return () => {
      cancelled = true
    }
  }, [dataset?.current_stage_id, datasetId, open])

  useEffect(() => {
    if (!open || !datasetId || !dataset) return
    let cancelled = false
    setLoadingRows(true)
    setRows([])
    setError('')
    const stageId = viewMode === 'original' ? 'original' : dataset.current_stage_id || undefined

    api
      .getRows(datasetId, 1, PREVIEW_ROWS, stageId)
      .then((response) => {
        if (cancelled) return
        setRows(Array.isArray(response.rows) ? response.rows : [])
        setTotalRows(Number(response.total || 0))
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
  }, [dataset, datasetId, open, viewMode])

  const columns = useMemo(() => {
    const firstRow = rows[0]
    if (firstRow) return Object.keys(firstRow).filter((key) => key !== '__row_index')
    return (dataset?.variables || []).map((variable) => variable.name)
  }, [dataset?.variables, rows])

  const latestStage = changeStages[changeStages.length - 1] || null
  const latestChanges = latestStage?.changes || []
  const latestChangedColumns = useMemo(
    () => new Set([...(latestStage?.new_columns || []), ...latestChanges.map((change) => change.column)]),
    [latestChanges, latestStage?.new_columns],
  )
  const latestChangeMap = useMemo(() => {
    const cells = new Map()
    latestChanges.forEach((change) => cells.set(`${change.row_index}:${change.column}`, change))
    return cells
  }, [latestChanges])
  const visibleHighlightedCells = useMemo(
    () => rows.reduce((count, row) => count + columns.filter((column) => latestChangeMap.has(`${row.__row_index}:${column}`)).length, 0),
    [columns, latestChangeMap, rows],
  )

  if (hidden) return null

  return (
    <div className={`ax-floating-dataset ${open ? 'open' : ''}`}>
      {open && (
        <section className="ax-floating-dataset-panel" aria-label="Dataset preview">
          <header className="ax-floating-dataset-header">
            <div className="ax-floating-dataset-title">
              <span className="ax-floating-dataset-mark" aria-hidden><TableIcon /></span>
              <div>
                <h2>Dataset preview</h2>
                <p>{dataset ? previewStatus(dataset, totalRows) : 'Loading current dataset stage'}</p>
              </div>
            </div>
            <button
              type="button"
              className="ax-floating-dataset-close"
              onClick={() => setOpen(false)}
              aria-label="Close dataset preview"
              title="Close dataset preview"
            >
              <CloseIcon />
            </button>
          </header>

          <div className="ax-floating-dataset-toolbar">
            <div className="ax-floating-dataset-modes" role="tablist" aria-label="Preview dataset view">
              {VIEW_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={viewMode === mode.id ? 'active' : ''}
                  disabled={mode.id === 'highlight' && !changeStages.length && !loadingDataset}
                  onClick={() => setViewMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <Link className="ax-btn mini" to={`/projects/${datasetId}/data`}>
              Open Data
            </Link>
          </div>

          {latestStage && viewMode !== 'original' && (
            <div className="ax-floating-dataset-change">
              <strong>{latestStage.summary || friendlyAction(latestStage.op_type)}</strong>
              <span>
                {latestChanges.length} changed cell{latestChanges.length === 1 ? '' : 's'}
                {latestStage.removed_rows?.length ? `, ${latestStage.removed_rows.length} removed row${latestStage.removed_rows.length === 1 ? '' : 's'}` : ''}
              </span>
            </div>
          )}

          <div className="ax-floating-dataset-body">
            {(loadingDataset || loadingRows) && !rows.length && (
              <div className="ax-floating-dataset-loading" aria-live="polite">
                <span />
                <span />
                <span />
                <em>Loading the current preview...</em>
              </div>
            )}

            {error && <p className="ax-floating-dataset-error">{error}</p>}

            {!loadingDataset && !loadingRows && !error && rows.length === 0 && (
              <p className="ax-floating-dataset-empty">No preview rows are available for this dataset stage.</p>
            )}

            {rows.length > 0 && (
              <div className="ax-floating-dataset-table-wrap">
                <table className="ax-dd-table ax-floating-dataset-table">
                  <thead>
                    <tr className="ax-dd-colhead">
                      <th className="ax-floating-dataset-rowhead">Row</th>
                      {columns.map((column) => (
                        <th key={column} className={viewMode === 'highlight' && latestChangedColumns.has(column) ? 'ax-dd-new-column' : ''}>
                          <span>{column}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.__row_index}>
                        <th scope="row">{Number(row.__row_index || 0) + 1}</th>
                        {columns.map((column) => {
                          const change = viewMode === 'highlight' ? latestChangeMap.get(`${row.__row_index}:${column}`) : null
                          return (
                            <td
                              key={column}
                              className={[
                                'readonly',
                                change ? `ax-dd-changed-cell ax-dd-change-${change.change_kind || 'converted'}` : '',
                                viewMode === 'highlight' && latestStage?.new_columns?.includes(column) ? 'ax-dd-new-column-cell' : '',
                              ].filter(Boolean).join(' ')}
                            >
                              {formatValue(row[column])}
                              {change && <PreviewChangeTooltip change={change} />}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <footer className="ax-floating-dataset-footer">
            <span>
              Showing first {Math.min(rows.length, PREVIEW_ROWS)} row{rows.length === 1 ? '' : 's'} from the {viewMode === 'original' ? 'uploaded' : 'current'} data.
            </span>
            {viewMode === 'highlight' && latestChanges.length > 0 && visibleHighlightedCells === 0 && (
              <strong>Recent changes are outside this preview slice.</strong>
            )}
          </footer>
        </section>
      )}

      {!open && (
        <button
          type="button"
          className="ax-floating-dataset-launcher"
          onClick={() => setOpen(true)}
          aria-label="Open dataset preview"
          title="Open dataset preview"
        >
          <TableIcon />
          <span>Dataset</span>
        </button>
      )}
    </div>
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

function previewStatus(dataset, rowCount) {
  const rows = Number(rowCount || dataset.row_count || 0).toLocaleString()
  const columns = Number(dataset.col_count || dataset.variables?.length || 0).toLocaleString()
  const stage = dataset.current_stage_id ? 'current cleaned stage' : 'original upload'
  return `${rows} rows, ${columns} columns, ${stage}`
}

function friendlyAction(action) {
  if (!action) return 'Latest data change'
  return String(action).replace(/_/g, ' ')
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return 'Blank'
  return String(value)
}

function TableIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M2 6h12M6 2.5v11M10 2.5v11" />
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
