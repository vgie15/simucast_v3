/* ============================================================
 * COMPONENT: COLUMN VALUES MODAL
 * Keywords: column values, distinct, list
 * ============================================================ */
import React, { useEffect, useState } from 'react'
import { api } from '../../api'

const PAGE_SIZE = 200

// Modal that shows paginated raw values for a single dataset column with a per-page filter.
export default function ColumnValuesModal({ datasetId, variable, onClose }) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    setLoading(true)
    api
      .columnValues(datasetId, variable.name, page, PAGE_SIZE)
      .then(setData)
      .finally(() => setLoading(false))
  }, [datasetId, variable.name, page])

  const total = data?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const visible = (data?.values || []).filter((v) =>
    !filter ? true : String(v.value ?? '').toLowerCase().includes(filter.toLowerCase()),
  )

  return (
    <div className="ax-modal-bg" onClick={onClose}>
      <div className="ax-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="ax-modal-header">
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 500, margin: 0, fontFamily: 'var(--font-mono)' }}>
              {variable.name}
            </p>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>
              <span
                className="ax-chip"
                style={{
                  background: dtypeColor(variable.dtype).bg,
                  color: dtypeColor(variable.dtype).fg,
                  marginRight: 8,
                }}
              >
                {variable.dtype}
              </span>
              {total.toLocaleString()} entries · {variable.missing} missing · {variable.unique} unique
            </p>
          </div>
          <button className="ax-btn" onClick={onClose}>Close</button>
        </div>

        <div style={{ padding: '10px 18px', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter values on this page…"
            style={{ width: '100%' }}
          />
        </div>

        <div className="ax-modal-body" style={{ padding: 0 }}>
          {loading ? (
            <p style={{ padding: 20, color: 'var(--color-text-secondary)', fontSize: 12 }}>Loading values…</p>
          ) : (
            <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
              <table className="ax-tbl" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>Row</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const v = row.value
                    const missing = v === null || v === undefined || v === ''
                    return (
                      <tr key={row.row}>
                        <td style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-sans)' }}>
                          {row.row}
                        </td>
                        <td
                          style={{
                            fontFamily: 'var(--font-mono)',
                            color: missing ? 'var(--color-text-danger)' : 'inherit',
                            fontStyle: missing ? 'italic' : 'normal',
                            background: missing ? 'var(--color-background-danger)' : 'transparent',
                          }}
                        >
                          {missing ? '—' : formatCell(v)}
                        </td>
                      </tr>
                    )
                  })}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={2} style={{ padding: 16, color: 'var(--color-text-secondary)', fontSize: 12 }}>
                        No values on this page match "{filter}".
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

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
            Page {page} of {totalPages} · rows {(page - 1) * PAGE_SIZE + 1}–
            {Math.min(page * PAGE_SIZE, total)}
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
      </div>
    </div>
  )
}

// Returns a display string for a cell value, formatting numbers and booleans nicely.
function formatCell(v) {
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v.toString()
    return v.toFixed(3)
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

// Returns background and foreground chip colors for a given column dtype, falling back to text.
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
