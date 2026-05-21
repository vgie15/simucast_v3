/* ============================================================
 * COMPONENT: DATA DETAIL VIEW
 * Keywords: data detail, inspect
 * ============================================================ */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api'
import ColumnVisibilityMenu from './ColumnVisibilityMenu'
import { BusyOverlay } from '../common/LoadingStates'
import { useAuth } from '../providers/AuthProvider'

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

// Detail view that paginates dataset rows with column visibility controls and the about panel.
export default function DataDetailView({
  dataset,
  variables,
  stageId,
  currentStageId,
  stageLabel,
  refreshKey,
  onDataChanged,
}) {
  const datasetId = dataset?.id
  const allColumns = useMemo(() => (variables || []).map((v) => v.name), [variables])

  const [rows, setRows] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const [aboutData, setAboutData] = useState(null)
  const [aboutLoading, setAboutLoading] = useState(false)

  const [visibleColumns, setVisibleColumns] = useState(() => allColumns.slice(0, Math.min(10, allColumns.length)))

  useEffect(() => {
    setVisibleColumns((prev) => {
      const filtered = prev.filter((name) => allColumns.includes(name))
      if (filtered.length === 0 && allColumns.length > 0) {
        return allColumns.slice(0, Math.min(10, allColumns.length))
      }
      return filtered
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
    () => visibleColumns.map((name) => (variables || []).find((v) => v.name === name)).filter(Boolean),
    [visibleColumns, variables],
  )

  const readOnly = !!stageId && stageId !== currentStageId

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
    setPage(1)
    setHasMore(true)
    setEditing(null)
    setHeaderEdit(null)
    setCellError(null)
  }, [datasetId, stageId, refreshKey])

  // load rows page
  useEffect(() => {
    if (!datasetId) return
    let cancelled = false
    setLoading(true)
    api
      .getRows(datasetId, page, PAGE_SIZE, stageId)
      .then((r) => {
        if (cancelled) return
        setRows((prev) => (page === 1 ? r.rows : [...prev, ...r.rows]))
        setTotal(r.total || 0)
        setHasMore(page * PAGE_SIZE < (r.total || 0))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [datasetId, stageId, page, refreshKey])

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

  const containerCls = `ax-data-detail ax-busy-host ${expanded ? 'expanded' : ''} ${savingEdits || savingHeader ? 'is-busy' : ''}`

  const node = (
    <div className={containerCls}>
      <BusyOverlay
        active={savingEdits || savingHeader}
        title={savingHeader ? 'Updating column metadata...' : 'Saving data edits...'}
        detail="Creating a reversible dataset stage and refreshing the grid."
      />

      <header className="ax-dd-header">
        <div className="ax-dd-title">
          <strong>{dataset.filename || dataset.name}</strong>
          <span className="ax-dd-meta">
            ({total ? total.toLocaleString() : (dataset.row_count || 0).toLocaleString()} rows · {allColumns.length} cols
            {stageLabel ? ` · ${stageLabel}` : ''})
          </span>
        </div>
        <div className="ax-dd-actions">
          <a
            href={api.exportCsvUrl(datasetId, stageId)}
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
        <div className="ax-dd-tabs-right">
          <ColumnVisibilityMenu
            allColumns={allColumns}
            selected={visibleColumns}
            onApply={setVisibleColumns}
          />
        </div>
      </nav>

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
              {visibleVariables.map((v) => (
                <th key={v.name}>
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
            {rows.map((row) => (
              <tr key={row.__row_index}>
                {visibleColumns.map((col) => (
                  <td
                    key={col}
                    onClick={() => !readOnly && startEdit(row, col, row[col])}
                    className={readOnly ? 'readonly' : ''}
                  >
                    {renderCellValue(row, col)}
                  </td>
                ))}
              </tr>
            ))}
            <tr ref={sentinelRef} className="ax-dd-sentinel">
              <td colSpan={visibleColumns.length || 1}>
                {loading
                  ? 'Loading…'
                  : hasMore
                  ? ' '
                  : `End of ${total.toLocaleString()} rows`}
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
