import React, { useState } from 'react'
import { Bar } from 'react-chartjs-2'
import { api } from '../api'

export default function DescribePage({ dataset }) {
  const [selected, setSelected] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  if (!dataset) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>

  const numericVars = (dataset.variables || []).filter((v) => ['numeric', 'binary'].includes(v.dtype))
  const categoricalVars = (dataset.variables || []).filter((v) => ['category', 'text'].includes(v.dtype))

  const toggle = (name) => {
    setSelected(selected.includes(name) ? selected.filter((x) => x !== name) : [...selected, name])
  }

  const run = async () => {
    setLoading(true)
    try {
      const r = await api.describe(dataset.id, { variables: selected.length ? selected : undefined })
      setResult(r)
    } finally {
      setLoading(false)
    }
  }

  const numericStats = (result?.stats || []).filter((s) => s.kind === 'numeric')
  const categoricalStats = (result?.stats || []).filter((s) => s.kind === 'categorical')

  return (
    <>
      <h1 className="ax-page-title">Descriptive statistics</h1>
      <p className="ax-page-sub">SPSS-style output table plus a histogram for the first numeric variable.</p>

      <p className="ax-lbl">Variables · tap to toggle</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {(dataset.variables || []).map((v) => (
          <span
            key={v.name}
            className={`ax-chip ${selected.includes(v.name) ? 'active' : ''}`}
            onClick={() => toggle(v.name)}
          >
            {v.name}
          </span>
        ))}
      </div>

      <button className="ax-btn prim" disabled={loading} onClick={run} style={{ marginBottom: 16 }}>
        {loading ? 'Running…' : 'Run descriptives'}
      </button>

      {result && (
        <>
          {numericStats.length > 0 && (
            <>
              <p className="ax-lbl">Numeric summary</p>
              <div className="ax-card" style={{ padding: 0, overflow: 'auto', marginBottom: 12 }}>
                <table className="ax-tbl">
                  <thead>
                    <tr>
                      <th>Variable</th><th>n</th><th>Mean</th><th>SD</th><th>Min</th><th>Q1</th><th>Median</th><th>Q3</th><th>Max</th><th>Skew</th>
                    </tr>
                  </thead>
                  <tbody>
                    {numericStats.map((s) => (
                      <tr key={s.variable}>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{s.variable}</td>
                        <td>{s.n?.toLocaleString()}</td>
                        <td>{fmt(s.mean)}</td>
                        <td>{fmt(s.std)}</td>
                        <td>{fmt(s.min)}</td>
                        <td>{fmt(s.q1)}</td>
                        <td>{fmt(s.median)}</td>
                        <td>{fmt(s.q3)}</td>
                        <td>{fmt(s.max)}</td>
                        <td>{fmt(s.skew)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {categoricalStats.length > 0 && (
            <>
              <p className="ax-lbl">Categorical summary</p>
              <div className="ax-card" style={{ padding: 0, overflow: 'auto', marginBottom: 12 }}>
                <table className="ax-tbl">
                  <thead>
                    <tr><th>Variable</th><th>n</th><th>Unique</th><th>Top</th><th>Freq</th></tr>
                  </thead>
                  <tbody>
                    {categoricalStats.map((s) => (
                      <tr key={s.variable}>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{s.variable}</td>
                        <td>{s.n?.toLocaleString()}</td>
                        <td>{s.unique}</td>
                        <td>{s.top}</td>
                        <td>{s.freq}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {result.histogram && (
            <>
              <p className="ax-lbl">Distribution · {result.histogram.variable}</p>
              <div className="ax-card">
                <div style={{ height: 220 }}>
                  <Bar
                    data={{
                      labels: result.histogram.bins.slice(0, -1).map((b, i) => `${fmt(b)}–${fmt(result.histogram.bins[i + 1])}`),
                      datasets: [{
                        label: result.histogram.variable,
                        data: result.histogram.counts,
                        backgroundColor: '#7F77DD',
                        borderRadius: 2,
                      }],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                      scales: {
                        y: { beginAtZero: true, ticks: { font: { size: 10 } } },
                        x: { ticks: { font: { size: 9 }, maxRotation: 45, minRotation: 45 } },
                      },
                    }}
                  />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}

function fmt(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v !== 'number') return v
  return Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3)
}
