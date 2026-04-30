import React, { useEffect, useState } from 'react'
import { api } from '../api'

export default function DataGridViewer({ datasetId, variables, stageId, stageLabel, refreshKey }) {
  const [tab, setTab] = useState('data')
  const [rows, setRows] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize] = useState(100)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setPage(1)
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
  const stageColumns = stageId && rows[0] ? Object.keys(rows[0]) : null
  const columns = stageColumns || variables.map((v) => v.name)
  const headerVars = stageColumns
    ? stageColumns.map((name) => ({ name, dtype: 'text' }))
    : variables

  return (
    <div className="ax-card ax-data-grid-panel">
      <div className="ax-modal-header">
        <div>
          <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>
            Data grid{stageLabel ? ` - ${stageLabel}` : ''}
          </p>
          <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>
            {total.toLocaleString()} rows · {headerVars.length} columns
          </p>
        </div>
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
                          const missing = value === null || value === undefined || value === ''
                          return (
                            <td key={column} className={missing ? 'missing' : ''}>
                              {missing ? '-' : formatCell(value)}
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
                Page {page} of {totalPages} · showing rows {(page - 1) * pageSize + 1}-
                {Math.min(page * pageSize, total)}
              </span>
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
                  <tr key={v.name}>
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
