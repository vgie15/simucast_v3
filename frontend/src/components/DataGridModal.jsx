import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'

/**
 * DataGridModal
 * Excel/SPSS-style viewer with two tabs:
 *   - Data View: paginated grid of actual rows (frozen row numbers, column headers show dtype)
 *   - Variable View: metadata about each column (name, type, missing, unique)
 *
 * `stageId` is optional — when set, the grid renders that specific stage
 * (e.g. the original upload before any cleaning) instead of the active one.
 * Columns are derived from row keys in that case so they reflect the stage.
 */
export default function DataGridModal({ datasetId, variables, stageId, stageLabel, onClose }) {
  const [tab, setTab] = useState('data')
  const [rows, setRows] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize] = useState(100)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

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
  }, [datasetId, page, pageSize, tab, stageId])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  // When viewing an arbitrary stage, columns may differ from the active
  // dataset's variables — derive from the first row in that case.
  const stageColumns = stageId && rows[0] ? Object.keys(rows[0]) : null
  const columns = stageColumns || variables.map((v) => v.name)
  const headerVars = stageColumns
    ? stageColumns.map((name) => ({ name, dtype: 'text' }))
    : variables

  return (
    <div className="ax-modal-bg" onClick={onClose}>
      <div className="ax-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ax-modal-header">
          <div>
            <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>
              Dataset viewer{stageLabel ? ` — ${stageLabel}` : ''}
            </p>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>
              {total.toLocaleString()} rows · {headerVars.length} columns
            </p>
          </div>
          <button className="ax-btn" onClick={onClose}>
            Close
          </button>
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
              <div className="ax-grid-wrap">
                {loading ? (
                  <p style={{ padding: 20, color: 'var(--color-text-secondary)' }}>Loading rows…</p>
                ) : (
                  <table className="ax-grid">
                    <thead>
                      <tr>
                        <th className="ax-grid-row-num-head">#</th>
                        {headerVars.map((v) => (
                          stageId ? (
                            <th key={v.name}>
                              {v.name}
                              <span className="ax-grid-type">{v.dtype}</span>
                            </th>
                          ) : (
                            <ColumnHeader key={v.name} datasetId={datasetId} variable={v} />
                          )
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          <td className="ax-grid-row-num">{(page - 1) * pageSize + i + 1}</td>
                          {columns.map((c) => {
                            const v = r[c]
                            const missing = v === null || v === undefined || v === ''
                            return (
                              <td key={c} className={missing ? 'missing' : ''}>
                                {missing ? '—' : formatCell(v)}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* pagination */}
              <div
                style={{
                  padding: '10px 18px',
                  borderTop: '0.5px solid var(--color-border-tertiary)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  Page {page} of {totalPages} · showing rows {(page - 1) * pageSize + 1}–
                  {Math.min(page * pageSize, total)}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="ax-btn" disabled={page === 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </button>
                  <button
                    className="ax-btn"
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                  >
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
                    <tr key={v.name}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v.name}</td>
                      <td>
                        <span
                          className="ax-chip"
                          style={{
                            background: dtypeColor(v.dtype).bg,
                            color: dtypeColor(v.dtype).fg,
                          }}
                        >
                          {v.dtype}
                        </span>
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
    </div>
  )
}

function ColumnHeader({ datasetId, variable }) {
  const [open, setOpen] = useState(false)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [pos, setPos] = useState(null) // { top, left }
  const ref = useRef(null)
  const popRef = useRef(null)

  // Position the fixed popover relative to the header, flipping left if it
  // would overflow the viewport. Re-measure on scroll/resize while open.
  useEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const POP_WIDTH = 320
    const MARGIN = 8
    const measure = () => {
      const th = ref.current
      if (!th) return
      const rect = th.getBoundingClientRect()
      let left = rect.left
      if (left + POP_WIDTH > window.innerWidth - MARGIN) {
        left = Math.max(MARGIN, rect.right - POP_WIDTH)
      }
      setPos({ top: rect.bottom + 4, left })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true) // capture nested scrolls
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (
        ref.current &&
        !ref.current.contains(e.target) &&
        popRef.current &&
        !popRef.current.contains(e.target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !stats && !loading) {
      setLoading(true)
      setError(null)
      api
        .columnStats(datasetId, variable.name)
        .then(setStats)
        .catch((err) => setError(err.message || 'Failed to load stats'))
        .finally(() => setLoading(false))
    }
  }

  return (
    <th ref={ref}>
      <button
        type="button"
        onClick={toggle}
        className="ax-grid-head-btn"
        aria-expanded={open}
        aria-label={`Show stats for ${variable.name}`}
      >
        <span className="ax-grid-head-name">{variable.name}</span>
        <span className="ax-grid-head-caret" aria-hidden>▾</span>
      </button>
      <span className="ax-grid-type">{variable.dtype}</span>
      {open && pos && (
        <div
          ref={popRef}
          className="ax-col-popover"
          onClick={(e) => e.stopPropagation()}
          style={{ top: pos.top, left: pos.left }}
        >
          {loading && <p className="ax-col-pop-msg">Loading…</p>}
          {error && <p className="ax-col-pop-msg" style={{ color: 'var(--color-text-danger)' }}>{error}</p>}
          {stats && <ColumnStatsBody stats={stats} />}
        </div>
      )}
    </th>
  )
}

function ColumnStatsBody({ stats }) {
  const fmtNum = (n) => {
    if (n === null || n === undefined) return '—'
    if (Number.isInteger(n)) return n.toLocaleString()
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 })
  }

  return (
    <>
      <div className="ax-col-pop-head">
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500 }}>{stats.name}</span>
        <span
          className="ax-chip"
          style={{
            background: dtypeColor(stats.dtype).bg,
            color: dtypeColor(stats.dtype).fg,
          }}
        >
          {stats.dtype}
        </span>
      </div>

      <dl className="ax-col-pop-list">
        <Row label="Rows" value={stats.total_rows.toLocaleString()} />
        <Row label="Present" value={stats.present.toLocaleString()} />
        <Row label="Missing" value={`${stats.missing.toLocaleString()} (${stats.missing_pct}%)`} warn={stats.missing > 0} />
        <Row label="Errors" value={stats.type_errors.toLocaleString()} warn={stats.type_errors > 0} hint="values not matching the data type" />
        <Row label="Unique" value={stats.unique.toLocaleString()} />
        {'zero_count' in stats && (
          <Row label="Zeros" value={`${stats.zero_count.toLocaleString()} (${stats.zero_pct}%)`} />
        )}
        {'negative_count' in stats && stats.negative_count > 0 && (
          <Row label="Negatives" value={stats.negative_count.toLocaleString()} />
        )}
        {'empty_string_count' in stats && stats.empty_string_count > 0 && (
          <Row label="Empty strings" value={stats.empty_string_count.toLocaleString()} warn />
        )}
        {'min' in stats && <Row label="Min" value={typeof stats.min === 'string' ? stats.min : fmtNum(stats.min)} />}
        {'max' in stats && <Row label="Max" value={typeof stats.max === 'string' ? stats.max : fmtNum(stats.max)} />}
        {'mean' in stats && <Row label="Mean" value={fmtNum(stats.mean)} />}
        {'median' in stats && <Row label="Median" value={fmtNum(stats.median)} />}
        {'std' in stats && <Row label="Std dev" value={fmtNum(stats.std)} />}
        {'min_length' in stats && (
          <Row label="Length" value={`${stats.min_length}–${stats.max_length} (avg ${stats.avg_length})`} />
        )}
      </dl>

      {stats.value_counts && stats.value_counts.length > 0 && (
        <div className="ax-col-pop-section">
          <p className="ax-col-pop-section-title">
            {stats.dtype === 'category' || stats.dtype === 'binary' ? 'Categories' : 'Top values'}
          </p>
          <div className="ax-col-pop-bars">
            {stats.value_counts.map((row, i) => (
              <div key={i} className="ax-col-pop-bar">
                <span className="ax-col-pop-bar-label" title={String(row.value ?? '—')}>
                  {row.value === null || row.value === '' ? '—' : String(row.value)}
                </span>
                <span className="ax-col-pop-bar-track">
                  <span className="ax-col-pop-bar-fill" style={{ width: `${Math.min(100, row.pct)}%` }} />
                </span>
                <span className="ax-col-pop-bar-count">
                  {row.count.toLocaleString()} <span style={{ color: 'var(--color-text-tertiary)' }}>({row.pct}%)</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function Row({ label, value, warn, hint }) {
  return (
    <div className="ax-col-pop-row">
      <dt title={hint || undefined}>{label}</dt>
      <dd className={warn ? 'warn' : ''}>{value}</dd>
    </div>
  )
}

function formatCell(v) {
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v.toString()
    return v.toFixed(3)
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

function dtypeColor(t) {
  const map = {
    numeric: { bg: '#E6F1FB', fg: '#185FA5' },
    binary: { bg: '#FBEAF0', fg: '#993556' },
    category: { bg: '#E1F5EE', fg: '#0F6E56' },
    datetime: { bg: '#FAEEDA', fg: '#854F0B' },
    text: { bg: '#F1EFE8', fg: '#5F5E5A' },
  }
  return map[t] || map.text
}
