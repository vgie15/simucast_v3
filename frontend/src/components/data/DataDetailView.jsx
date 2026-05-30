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
import { Download, Maximize2, Minimize2, X, Undo, Redo, Database, Sparkles, Highlighter, FileSpreadsheet } from 'lucide-react'

const PAGE_SIZE = 100

// Module-level cache for table data (survives component unmount/remount)
const tablePageCache = new Map()

// Module-level tool undo/redo stacks (survives component remount on stage change)
const toolUndoByDataset = new Map()
const toolRedoByDataset = new Map()

export function pushToolUndoSnapshot(datasetId, label, beforeStageId) {
  if (!datasetId) return
  const stack = toolUndoByDataset.get(datasetId) || []
  stack.push({ label, beforeStageId })
  if (stack.length > 20) stack.shift()
  toolUndoByDataset.set(datasetId, stack)
  toolRedoByDataset.delete(datasetId)
}

export function pushViewUndoSnapshot(datasetId, label, beforeViewState) {
  if (!datasetId) return
  const stack = toolUndoByDataset.get(datasetId) || []
  stack.push({ type: 'view', label, beforeViewState })
  if (stack.length > 20) stack.shift()
  toolUndoByDataset.set(datasetId, stack)
  toolRedoByDataset.delete(datasetId)
}

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
  renderToolbar,
  onToolUndo,
  onToolRedo,
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
  const [aboutOpen, setAboutOpen] = useState(false)

  const [visibleColumns, setVisibleColumns] = useState([])
  const [viewSort, setViewSort] = useState({ column: '', order: 'asc' })
  const [viewFilter, setViewFilter] = useState({ column: '', condition: 'contains', value: '' })

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
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])

  const modifiedRows = useMemo(() => {
    if (undoStack.length === 0) return rows
    return rows.map((row) => {
      let updatedRow = { ...row }
      let hasChange = false
      undoStack.forEach((edit) => {
        if (edit.rowIndex === row.__row_index) {
          updatedRow[edit.column] = edit.newValue === '' ? null : edit.newValue
          hasChange = true
        }
      })
      return hasChange ? updatedRow : row
    })
  }, [rows, undoStack])

  const [headerEdit, setHeaderEdit] = useState(null)
  const [savingHeader, setSavingHeader] = useState(false)

  useEffect(() => {
    if (!headerEdit) return
    const handler = (e) => { if (e.key === 'Escape') setHeaderEdit(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [headerEdit])
  const auth = useAuth()

  const [expanded, setExpanded] = useState(false)

  const effectiveVisibleColumns = visibleColumns.length ? visibleColumns : allColumns
  const visibleVariables = useMemo(
    () => effectiveVisibleColumns.map((name) => tableVariables.find((v) => v.name === name)).filter(Boolean),
    [effectiveVisibleColumns, tableVariables],
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
    setUndoStack([])
    setRedoStack([])
  }, [datasetId, effectiveStageId, refreshKey, viewMode])

  // Restore persisted table state on mount (runs after reset, so it overrides)
  useEffect(() => {
    if (!datasetId) return
    try {
      const saved = window.localStorage.getItem(`simucast.dataTable.${datasetId}`)
      if (saved) {
        const s = JSON.parse(saved)
        if (s.page > 0) setPage(s.page)
        if (s.visibleColumns?.length) setVisibleColumns(s.visibleColumns)
        if (s.viewSort) setViewSort(s.viewSort)
        if (s.viewFilter) setViewFilter(s.viewFilter)
      }
    } catch {}
  }, [datasetId])

  // Persist table state to localStorage
  useEffect(() => {
    if (!datasetId) return
    window.localStorage.setItem(`simucast.dataTable.${datasetId}`, JSON.stringify({
      page, visibleColumns, viewSort, viewFilter
    }))
  }, [datasetId, page, visibleColumns, viewSort, viewFilter])

  // load rows page (checks module-level cache first)
  useEffect(() => {
    if (!datasetId) return
    const ck = `${datasetId}|${effectiveStageId}|${refreshKey}|${viewMode}|${page}`
    const cached = tablePageCache.get(ck)
    if (cached) {
      setRows(cached.rows)
      if (cached.columns) setRowColumns(cached.columns)
      setTotal(cached.total)
      setHasMore(cached.hasMore)
      setRowError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setRowError(null)
    api
      .getRows(datasetId, page, PAGE_SIZE, effectiveStageId)
      .then((r) => {
        if (cancelled) return
        const columns = r.rows?.[0] ? Object.keys(r.rows[0]).filter((key) => key !== '__row_index') : []
        tablePageCache.set(ck, { rows: r.rows, columns, total: r.total || 0, hasMore: page * PAGE_SIZE < (r.total || 0) })
        setRows(r.rows)
        if (columns.length) setRowColumns(columns)
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
        if (!cancelled) {
          setLoading(false)
          const event = new CustomEvent('simucast:table-loaded')
          window.dispatchEvent(event)
        }
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
    if (!effectiveVisibleColumns.includes(active.column)) {
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
  }, [activeChangeIndex, page, rows, viewMode, visibleChanges, effectiveVisibleColumns])

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

  const saveEditing = (edit) => {
    if (!edit) return
    if (cancelBlurRef.current) {
      cancelBlurRef.current = false
      return
    }
    if (edit.value === edit.original) {
      setEditing(null)
      setCellError(null)
      return
    }

    const newEdit = {
      rowIndex: edit.rowIndex,
      column: edit.column,
      oldValue: edit.original,
      newValue: edit.value
    }

    setUndoStack((prev) => [...prev, newEdit])
    setRedoStack([])
    setEditing(null)
    setCellError(null)
  }

  const handleUndo = () => {
    if (undoStack.length > 0) {
      const lastEdit = undoStack[undoStack.length - 1]
      setUndoStack((prev) => prev.slice(0, -1))
      setRedoStack((prev) => [...prev, lastEdit])
      return
    }
    const stack = toolUndoByDataset.get(datasetId)
    if (!stack || stack.length === 0) return
    const entry = stack.pop()
    const redoStack = toolRedoByDataset.get(datasetId) || []
    if (entry.type === 'view') {
      redoStack.push({ type: 'view', label: entry.label, beforeViewState: entry.beforeViewState, afterViewState: { viewSort, viewFilter } })
      toolRedoByDataset.set(datasetId, redoStack)
      setViewSort(entry.beforeViewState.viewSort || { column: '', order: 'asc' })
      setViewFilter(entry.beforeViewState.viewFilter || { column: '', condition: 'contains', value: '' })
    } else {
      redoStack.push({ label: entry.label, beforeStageId: entry.beforeStageId, afterStageId: currentStageId })
      toolRedoByDataset.set(datasetId, redoStack)
      onToolUndo?.(entry.beforeStageId)
    }
    if (stack.length === 0) toolUndoByDataset.delete(datasetId)
    else toolUndoByDataset.set(datasetId, stack)
  }

  const handleRedo = () => {
    if (redoStack.length > 0) {
      const nextEdit = redoStack[redoStack.length - 1]
      setRedoStack((prev) => prev.slice(0, -1))
      setUndoStack((prev) => [...prev, nextEdit])
      return
    }
    const stack = toolRedoByDataset.get(datasetId)
    if (!stack || stack.length === 0) return
    const entry = stack.pop()
    const undoStack = toolUndoByDataset.get(datasetId) || []
    if (entry.type === 'view') {
      undoStack.push({ type: 'view', label: entry.label, beforeViewState: { viewSort, viewFilter } })
      toolUndoByDataset.set(datasetId, undoStack)
      setViewSort(entry.afterViewState.viewSort || { column: '', order: 'asc' })
      setViewFilter(entry.afterViewState.viewFilter || { column: '', condition: 'contains', value: '' })
    } else {
      undoStack.push({ label: entry.label, beforeStageId: currentStageId })
      toolUndoByDataset.set(datasetId, undoStack)
      onToolRedo?.(entry.afterStageId)
    }
    if (stack.length === 0) toolRedoByDataset.delete(datasetId)
    else toolRedoByDataset.set(datasetId, stack)
  }

  const handleDiscard = () => {
    setUndoStack([])
    setRedoStack([])
  }

  const handleSaveEdits = async () => {
    if (undoStack.length === 0 || savingEdits) return
    setSavingEdits(true)
    setCellError(null)

    const netEditsMap = {}
    undoStack.forEach((edit) => {
      netEditsMap[`${edit.rowIndex}:${edit.column}`] = edit
    })

    const editsToSave = Object.values(netEditsMap).map((edit) => ({
      row_index: edit.rowIndex,
      column: edit.column,
      value: edit.newValue,
    }))

    try {
      await api.updateCells(datasetId, editsToSave)
      setUndoStack([])
      setRedoStack([])
      await onDataChanged?.()
    } catch (err) {
      setCellError(err.message || 'Saving edits failed')
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

  const containerCls = `ax-data-detail ax-module-card ax-card-data ax-busy-host ${expanded ? 'expanded' : ''} ${savingEdits || savingHeader ? 'is-busy' : ''}`
  const latestStage = scopedChangeStages[scopedChangeStages.length - 1] || null
  const highlightedRows = useMemo(() => {
    if (viewMode !== 'highlight' || changeScope === 'all_rows') return modifiedRows
    const affectedIndices = new Set(
      visibleChanges.map((change) => normalizeRowIndex(change.row_index))
    )
    return modifiedRows.filter((row) => affectedIndices.has(normalizeRowIndex(row.__row_index)))
  }, [modifiedRows, viewMode, changeScope, visibleChanges])
  const hasBaseRows = highlightedRows.length > 0
  const displayRows = applyViewTools(
    mergeRemovedRows(highlightedRows, hasBaseRows ? removedRows : [], viewMode),
    viewSort,
    viewFilter,
  )

  if (!dataset) return null

  const node = (
    <div className={containerCls}>
      <BusyOverlay
        active={savingEdits || savingHeader}
        title={savingHeader ? 'Updating column metadata...' : 'Saving data edits...'}
        detail="Creating a reversible dataset stage and refreshing the grid."
      />

      <header className="ax-dd-header">
        <div className="ax-dd-header-left">
          <FileSpreadsheet className="ax-dd-file-icon" size={16} />
          <h2 className="ax-dd-filename">{dataset.filename || dataset.name}</h2>
          <span className="ax-dd-rowcols">
            {total ? total.toLocaleString() : (dataset.row_count || 0).toLocaleString()} rows · {allColumns.length} cols
            {stageLabel ? ` · ${stageLabel}` : ''}
          </span>
        </div>
        <div className="ax-dd-actions" style={{ alignItems: 'center' }}>
          {/* Segmented view modes switcher */}
          <div className="ax-segmented-control" role="tablist" aria-label="Dataset view" style={{ marginRight: 8 }}>
            <button
              type="button"
              className={`ax-segmented-item ${viewMode === 'original' ? 'active' : ''}`}
              onClick={() => setViewMode('original')}
              title="Original dataset"
            >
              <Database size={14} className="ax-segmented-icon" />
              {viewMode === 'original' && <span className="ax-segmented-label">Original</span>}
            </button>
            <button
              type="button"
              className={`ax-segmented-item ${viewMode === 'cleaned' ? 'active' : ''}`}
              onClick={() => setViewMode('cleaned')}
              title="Cleaned dataset"
            >
              <Sparkles size={14} className="ax-segmented-icon" />
              {viewMode === 'cleaned' && <span className="ax-segmented-label">Cleaned</span>}
            </button>
            <button
              type="button"
              className={`ax-segmented-item ${viewMode === 'highlight' ? 'active' : ''}`}
              onClick={() => setViewMode('highlight')}
              disabled={!changeStages.length && !changeLoading}
              title="Highlight changes"
            >
              <Highlighter size={14} className="ax-segmented-icon" />
              {viewMode === 'highlight' && <span className="ax-segmented-label">Highlighted</span>}
            </button>
          </div>
          <button
            type="button"
            className="ax-dd-about-btn"
            onClick={() => setAboutOpen((value) => !value)}
            aria-expanded={aboutOpen}
          >
            About
          </button>
          {aboutOpen && (
            <>
              <button className="ax-dd-about-overlay" type="button" aria-label="Close about file" onClick={() => setAboutOpen(false)} />
              <section className="ax-dd-about-popover">
                <div className="ax-dd-about-popover-head">
                  <strong>About this file</strong>
                  <button type="button" className="ax-popover-close" onClick={() => setAboutOpen(false)} aria-label="Close about file">
                    <X size={16} />
                  </button>
                </div>
                <div className="ax-dd-about-popover-body">
                  {aboutLoading && !aboutData && (
                    <p className="ax-dd-about-loading">Generating description...</p>
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
                  {!aboutLoading && !aboutData && (
                    <p>No generated description is available for this file.</p>
                  )}
                </div>
              </section>
            </>
          )}
          {/* Local edits controls: Undo, Redo, Discard, Save */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 8 }}>
            <button
              type="button"
              className="ax-dd-icon-btn"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              title={
                undoStack.length > 0
                  ? 'Undo edit'
                  : (toolUndoByDataset.get(datasetId) || []).length > 0
                    ? `Undo: ${toolUndoByDataset.get(datasetId).at(-1).label}`
                    : 'Nothing to undo'
              }
              aria-label="Undo"
              style={{ opacity: undoStack.length === 0 && (toolUndoByDataset.get(datasetId) || []).length === 0 ? 0.4 : 1, cursor: undoStack.length === 0 && (toolUndoByDataset.get(datasetId) || []).length === 0 ? 'not-allowed' : 'pointer' }}
            >
              <Undo size={15} />
            </button>
            <button
              type="button"
              className="ax-dd-icon-btn"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              title={
                redoStack.length > 0
                  ? 'Redo edit'
                  : (toolRedoByDataset.get(datasetId) || []).length > 0
                    ? `Redo: ${toolRedoByDataset.get(datasetId).at(-1).label}`
                    : 'Nothing to redo'
              }
              aria-label="Redo"
              style={{ opacity: redoStack.length === 0 && (toolRedoByDataset.get(datasetId) || []).length === 0 ? 0.4 : 1, cursor: redoStack.length === 0 && (toolRedoByDataset.get(datasetId) || []).length === 0 ? 'not-allowed' : 'pointer' }}
            >
              <Redo size={15} />
            </button>
            {undoStack.length > 0 && (
              <>
                <button
                  type="button"
                  className="ax-btn mini"
                  onClick={handleDiscard}
                  style={{
                    fontSize: 11,
                    padding: '3px 8px',
                    color: 'var(--color-text-danger)',
                    border: '1px solid var(--color-border-tertiary)',
                    borderRadius: 4,
                    height: 24,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  disabled={savingEdits}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className="ax-btn mini prim"
                  onClick={handleSaveEdits}
                  style={{
                    fontSize: 11,
                    padding: '3px 8px',
                    background: 'var(--color-accent)',
                    color: '#fff',
                    borderRadius: 4,
                    height: 24,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: 'none',
                  }}
                  disabled={savingEdits}
                >
                  {savingEdits ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
          </div>

          <a
            href={api.exportCsvUrl(datasetId, effectiveStageId)}
            download={(dataset.filename || dataset.name || 'dataset').replace(/\.[^.]+$/, '') + '.csv'}
            className="ax-dd-icon-btn"
            title="Download CSV"
            aria-label="Download CSV"
          >
            <Download size={16} />
          </a>
          <button
            type="button"
            className="ax-dd-icon-btn"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Exit fullscreen' : 'Expand to fullscreen'}
            aria-label={expanded ? 'Exit fullscreen' : 'Expand to fullscreen'}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </header>

      {renderToolbar?.({
        allColumns,
        visibleColumns: effectiveVisibleColumns,
        setVisibleColumns,
        viewSort,
        setViewSort,
        viewFilter,
        setViewFilter,
      })}

      {!renderToolbar && (
        <nav className="ax-dd-tabs">
          <div className="ax-dd-tabs-right">
            <ColumnVisibilityMenu
              allColumns={allColumns}
              selected={effectiveVisibleColumns}
              onApply={setVisibleColumns}
            />
          </div>
        </nav>
      )}

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
                <option value="all_rows">All rows</option>
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
                <th key={v.name} className={viewMode === 'highlight' && changedColumns.has(v.name) && (changeType === 'all' || changeType === 'generated') ? 'ax-dd-new-column' : ''}>
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
                <td colSpan={(effectiveVisibleColumns.length || 1) + 1}>Loading the current dataset rows...</td>
              </tr>
            )}
            {rowError && !hasBaseRows && (
              <tr className="ax-dd-state-row error">
                <td colSpan={(effectiveVisibleColumns.length || 1) + 1}>{rowError}</td>
              </tr>
            )}
            {!loading && !rowError && !hasBaseRows && (
              <tr className="ax-dd-state-row">
                <td colSpan={(effectiveVisibleColumns.length || 1) + 1}>No rows are available for this dataset stage.</td>
              </tr>
            )}
            {displayRows.map((row) => {
              const rowIndex = normalizeRowIndex(row.__row_index)
              const removedRow = row.__removed_row ? row.__removed_change : null
              return (
              <tr key={row.__removed_key || row.__row_index} className={removedRow ? 'ax-dd-removed-row' : ''}>
                <th scope="row" className="ax-dd-rownum">{removedRow ? `${rowIndex + 1} removed` : rowIndex + 1}</th>
                {effectiveVisibleColumns.map((col) => {
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
                        viewMode === 'highlight' && changedColumns.has(col) && (changeType === 'all' || changeType === 'generated') ? 'ax-dd-new-column-cell' : '',
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
              <td colSpan={(effectiveVisibleColumns.length || 1) + 1}>
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
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
            padding: 20,
          }}
          onClick={() => setHeaderEdit(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 400,
              maxWidth: '100%',
              background: '#fff',
              borderRadius: 12,
              boxShadow: '0 8px 32px rgba(0,0,0,.15)',
              padding: 24,
            }}
          >
            <p style={{ margin: '0 0 20px', fontSize: 14, fontWeight: 600 }}>Edit column</p>

            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 4 }}>Name</span>
              <input
                value={headerEdit.newName}
                onChange={(e) => setHeaderEdit({ ...headerEdit, newName: e.target.value })}
                disabled={savingHeader}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  fontSize: 13,
                  border: '1px solid var(--color-border-primary)',
                  borderRadius: 6,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                onFocus={(e) => e.target.style.borderColor = '#e36522'}
                onBlur={(e) => e.target.style.borderColor = 'var(--color-border-primary)'}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 24 }}>
              <span style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 4 }}>Type</span>
              <select
                value={headerEdit.dtype}
                onChange={(e) => setHeaderEdit({ ...headerEdit, dtype: e.target.value })}
                disabled={savingHeader}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  fontSize: 13,
                  border: '1px solid var(--color-border-primary)',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                }}
              >
                <option value="float">Float</option>
                <option value="int">Int</option>
                <option value="category">Category</option>
                <option value="text">Text</option>
              </select>
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="ax-btn" onClick={() => setHeaderEdit(null)} disabled={savingHeader}>Cancel</button>
              <button type="button" className="ax-btn prim" onClick={applyHeaderEdit} disabled={savingHeader}>
                {savingHeader ? 'Saving…' : 'Apply'}
              </button>
            </div>

            {cellError && <p style={{ fontSize: 11, color: 'var(--color-text-danger)', margin: '10px 0 0' }}>{cellError}</p>}
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

  if (type === 'missing') {
    return kind === 'missing_fill' || text.includes('missing') || text.includes('fill')
  }
  if (type === 'outlier') {
    return kind === 'outlier' || text.includes('outlier') || text.includes('cap') || text.includes('clip')
  }
  if (type === 'scaled') {
    return kind === 'scaled' || (
      (text.includes('scale') || text.includes('normalize') || text.includes('zscore') || text.includes('minmax') || text.includes('standardize_numeric')) &&
      !text.includes('category') && !text.includes('standardized')
    )
  }
  if (type === 'converted') {
    if (kind === 'missing_fill' || kind === 'outlier' || kind === 'scaled') return false
    if (kind === 'converted' || kind === 'standardized') return true
    return (
      (text.includes('convert') || text.includes('encode') || text.includes('standardize') || text.includes('category') || text.includes('type') || text.includes('cast')) &&
      !(text.includes('missing') || text.includes('fill') || text.includes('outlier') || text.includes('scale') || text.includes('zscore') || text.includes('minmax'))
    )
  }
  if (type === 'generated') {
    return kind === 'new_column' || changedColumns.has(change.column) || text.includes('generated') || text.includes('new_column')
  }
  if (type === 'removed') {
    return false
  }
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

function applyViewTools(rows, sort, filter) {
  let next = rows
  if (filter?.column && filter.condition) {
    const needle = String(filter.value ?? '').toLowerCase()
    
    // Pre-calculate outliers if the condition is 'outlier'
    let outlierLo = -Infinity
    let outlierHi = Infinity
    let hasOutliersCalculated = false
    if (filter.condition === 'outlier') {
      const values = rows
        .map((r) => {
          const val = r[filter.column]
          return (val !== null && val !== undefined && val !== '') ? Number(val) : NaN
        })
        .filter((v) => !Number.isNaN(v))
        .sort((a, b) => a - b)
      if (values.length >= 4) {
        const q1Idx = Math.floor(values.length * 0.25)
        const q3Idx = Math.floor(values.length * 0.75)
        const q1 = values[q1Idx]
        const q3 = values[q3Idx]
        const iqr = q3 - q1
        outlierLo = q1 - 1.5 * iqr
        outlierHi = q3 + 1.5 * iqr
        hasOutliersCalculated = true
      }
    }

    // Pre-calculate duplicates (value seen more than once in the column) if condition is 'duplicate'
    let duplicateValues = new Set()
    if (filter.condition === 'duplicate') {
      const seenValues = new Set()
      rows.forEach((row) => {
        if (row.__removed_row) return
        const val = row[filter.column]
        const valStr = val === null || val === undefined ? '' : String(val).trim()
        if (seenValues.has(valStr)) {
          duplicateValues.add(valStr)
        } else {
          seenValues.add(valStr)
        }
      })
    }

    next = next.filter((row) => {
      if (row.__removed_row) return true
      const value = row[filter.column]
      const text = String(value ?? '').toLowerCase()
      if (filter.condition === 'missing') return value === null || value === undefined || value === ''
      if (filter.condition === 'equals') return text === needle
      if (filter.condition === 'contains') return text.includes(needle)
      if (filter.condition === 'gt') return Number(value) > Number(filter.value)
      if (filter.condition === 'lt') return Number(value) < Number(filter.value)
      if (filter.condition === 'outlier') {
        if (!hasOutliersCalculated) return false
        const numVal = Number(value)
        return !Number.isNaN(numVal) && (numVal < outlierLo || numVal > outlierHi)
      }
      if (filter.condition === 'duplicate') {
        const valStr = value === null || value === undefined ? '' : String(value).trim()
        return duplicateValues.has(valStr)
      }
      return true
    })
  }
  if (sort?.column) {
    const direction = sort.order === 'desc' ? -1 : 1
    next = [...next].sort((a, b) => {
      if (a.__removed_row || b.__removed_row) return 0
      const av = a[sort.column]
      const bv = b[sort.column]
      const an = Number(av)
      const bn = Number(bv)
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * direction
      return String(av ?? '').localeCompare(String(bv ?? '')) * direction
    })
  }
  return next
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
