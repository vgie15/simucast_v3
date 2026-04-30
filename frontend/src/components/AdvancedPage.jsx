import React, { useState } from 'react'
import { Scatter, Bar } from 'react-chartjs-2'
import { api } from '../api'

const CLUSTER_COLORS = ['#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#EF9F27', '#378ADD']

export default function AdvancedPage({ dataset }) {
  const [method, setMethod] = useState('cluster')
  const [vars, setVars] = useState([])
  const [k, setK] = useState(4)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  if (!dataset) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>

  const numericVars = (dataset.variables || []).filter((v) => v.dtype === 'numeric')

  const toggleVar = (name) => {
    setVars(vars.includes(name) ? vars.filter((x) => x !== name) : [...vars, name])
  }

  const run = async () => {
    setLoading(true)
    setResult(null)
    try {
      const fn = method === 'cluster' ? api.cluster : api.pca
      const body = method === 'cluster' ? { variables: vars, k } : { variables: vars }
      const r = await fn(dataset.id, body)
      setResult({ method, ...r })
    } catch (err) {
      alert('Failed: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <h1 className="ax-page-title">Advanced statistics</h1>
      <p className="ax-page-sub">K-means clustering and principal component analysis.</p>

      <p className="ax-lbl">Method</p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button className={`ax-pill ${method === 'cluster' ? 'active' : ''}`} onClick={() => { setMethod('cluster'); setResult(null) }}>
          K-means clustering
        </button>
        <button className={`ax-pill ${method === 'pca' ? 'active' : ''}`} onClick={() => { setMethod('pca'); setResult(null) }}>
          PCA
        </button>
      </div>

      <div className="ax-card" style={{ marginBottom: 12 }}>
        <p className="ax-lbl" style={{ marginTop: 0 }}>Variables (numeric)</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {numericVars.map((v) => (
            <span key={v.name} className={`ax-chip ${vars.includes(v.name) ? 'active' : ''}`} onClick={() => toggleVar(v.name)}>
              {v.name}
            </span>
          ))}
        </div>
        {method === 'cluster' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Clusters (k)</label>
            <input type="number" min="2" max="10" value={k} onChange={(e) => setK(+e.target.value)} style={{ width: 60 }} />
          </div>
        )}
        <button className="ax-btn prim" disabled={loading || vars.length === 0} onClick={run}>
          {loading ? 'Running…' : 'Run analysis'}
        </button>
      </div>

      {result?.method === 'cluster' && <ClusterResult result={result} />}
      {result?.method === 'pca' && <PCAResult result={result} />}
    </>
  )
}

function ClusterResult({ result }) {
  // group points by cluster for Chart.js
  const clusters = {}
  result.pca_points.forEach((p) => {
    if (!clusters[p.cluster]) clusters[p.cluster] = []
    clusters[p.cluster].push({ x: p.x, y: p.y })
  })
  const datasets = Object.entries(clusters).map(([c, points]) => ({
    label: `Cluster ${c}`,
    data: points,
    backgroundColor: CLUSTER_COLORS[c % CLUSTER_COLORS.length],
    pointRadius: 4,
  }))

  const sizes = Object.entries(result.cluster_sizes || {})

  return (
    <>
      <p className="ax-lbl">PCA-projected clusters (2D)</p>
      <div className="ax-card" style={{ marginBottom: 10 }}>
        <div style={{ height: 320 }}>
          <Scatter
            data={{ datasets }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
              scales: {
                x: { title: { display: true, text: 'PC1', font: { size: 10 } } },
                y: { title: { display: true, text: 'PC2', font: { size: 10 } } },
              },
            }}
          />
        </div>
      </div>

      <p className="ax-lbl">Cluster sizes</p>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sizes.length}, 1fr)`, gap: 6 }}>
        {sizes.map(([c, n]) => (
          <div key={c} style={{ background: 'var(--color-background-primary)', borderRadius: 6, padding: 10, border: '0.5px solid var(--color-border-tertiary)' }}>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, background: CLUSTER_COLORS[c % CLUSTER_COLORS.length], borderRadius: '50%', marginRight: 6 }}></span>
              Cluster {c}
            </p>
            <p style={{ fontSize: 18, fontWeight: 500, margin: '2px 0 0' }}>{n}</p>
          </div>
        ))}
      </div>
    </>
  )
}

function PCAResult({ result }) {
  return (
    <>
      <p className="ax-lbl">Explained variance</p>
      <div className="ax-card" style={{ marginBottom: 10 }}>
        <div style={{ height: 260 }}>
          <Bar
            data={{
              labels: result.components,
              datasets: [{
                label: 'Variance explained',
                data: result.explained_variance.map((v) => v * 100),
                backgroundColor: '#7F77DD',
                borderRadius: 2,
              }],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                y: { beginAtZero: true, title: { display: true, text: '% variance', font: { size: 10 } } },
              },
            }}
          />
        </div>
      </div>
      <p style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
        Cumulative: {result.cumulative.map((v) => (v * 100).toFixed(1) + '%').join(' · ')}
      </p>
    </>
  )
}
