import React, { useEffect, useState } from 'react'
import { api } from '../api'
import AIAssistantPanel from './AIAssistantPanel'

/**
 * ExpandPage
 * Grow small datasets by bootstrap or synthetic generation. Live-previews
 * the resulting sample + per-numeric-column drift; Apply commits a stage.
 */
export default function ExpandPage({ dataset, setDataset }) {
  const [method, setMethod] = useState('bootstrap')
  const [targetRows, setTargetRows] = useState(() => Math.max(500, (dataset?.row_count || 100) * 2))
  const [noisePct, setNoisePct] = useState(0)
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // re-target when project changes
  useEffect(() => {
    setTargetRows(Math.max(500, (dataset?.row_count || 100) * 2))
    setPreview(null)
    setError(null)
  }, [dataset?.id])

  // live preview
  useEffect(() => {
    if (!dataset) return
    if (!Number.isFinite(targetRows) || targetRows <= dataset.row_count) {
      setPreview(null)
      setError(null)
      return
    }
    let cancelled = false
    setPreviewing(true)
    setError(null)
    const t = setTimeout(async () => {
      try {
        const body = { method, target_rows: targetRows, options: method === 'bootstrap' ? { noise_pct: noisePct } : {} }
        const r = await api.expand(dataset.id, body, true)
        if (!cancelled) setPreview(r)
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Preview failed')
          setPreview(null)
        }
      } finally {
        if (!cancelled) setPreviewing(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [dataset?.id, method, targetRows, noisePct])

  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      const body = { method, target_rows: targetRows, options: method === 'bootstrap' ? { noise_pct: noisePct } : {} }
      await api.expand(dataset.id, body, false)
      const fresh = await api.getDataset(dataset.id)
      setDataset(fresh)
      alert(`Expanded — dataset now has ${fresh.row_count.toLocaleString()} rows.`)
    } catch (err) {
      setError(err.message || 'Apply failed')
    } finally {
      setBusy(false)
    }
  }

  if (!dataset) {
    return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>
  }

  const isSmall = dataset.row_count < 500
  const targetTooLow = !Number.isFinite(targetRows) || targetRows <= dataset.row_count

  return (
    <>
      <h1 className="ax-page-title">Expand data</h1>
      <p className="ax-page-sub">
        Grow a small dataset by resampling (preserves correlations) or synthesis (per-column independent).
      </p>

      {!isSmall && (
        <div
          className="ax-card"
          style={{
            padding: '8px 12px',
            marginBottom: 12,
            borderColor: 'var(--color-text-warning, #B07000)',
          }}
        >
          <p style={{ fontSize: 12, margin: 0 }}>
            Heads up — this dataset already has {dataset.row_count.toLocaleString()} rows. Expansion is
            mainly useful for datasets under ~500 rows. You can still use it for what-if exploration,
            but don't use synthetic rows for held-out evaluation.
          </p>
        </div>
      )}

      <AIAssistantPanel datasetId={dataset.id} context="expand" />

      <div className="ax-card" style={{ marginBottom: 16 }}>
        <p className="ax-lbl" style={{ margin: '0 0 6px' }}>Method</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <MethodCard
            active={method === 'bootstrap'}
            onClick={() => setMethod('bootstrap')}
            title="Bootstrap"
            desc="Sample with replacement from the existing rows. Preserves cross-column correlations exactly. New rows are duplicates unless you add noise."
          />
          <MethodCard
            active={method === 'synthetic'}
            onClick={() => setMethod('synthetic')}
            title="Synthetic"
            desc="Numeric columns sampled from a kernel-density fit; categoricals from observed frequencies. Diverse rows, but column correlations are NOT preserved."
          />
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <label style={{ flex: 1 }}>
            <span className="ax-lbl" style={{ display: 'block', marginBottom: 4 }}>Target row count</span>
            <input
              type="number"
              min={dataset.row_count + 1}
              value={targetRows}
              onChange={(e) => setTargetRows(parseInt(e.target.value, 10) || 0)}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              currently {dataset.row_count.toLocaleString()} rows · adding {Math.max(0, targetRows - dataset.row_count).toLocaleString()}
            </span>
          </label>
          {method === 'bootstrap' && (
            <label style={{ flex: 1 }}>
              <span className="ax-lbl" style={{ display: 'block', marginBottom: 4 }}>
                Noise on numeric columns: {noisePct}% of std dev
              </span>
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={noisePct}
                onChange={(e) => setNoisePct(parseInt(e.target.value, 10))}
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {noisePct === 0 ? 'no noise — bootstrap rows will be exact duplicates' : 'jitter prevents exact duplicates'}
              </span>
            </label>
          )}
        </div>
        {targetTooLow && (
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
            Target rows must exceed {dataset.row_count.toLocaleString()}.
          </p>
        )}
        {error && (
          <p style={{ fontSize: 12, color: 'var(--color-text-danger)', margin: '4px 0 0' }}>{error}</p>
        )}
      </div>

      {preview && (
        <>
          <p className="ax-lbl">
            Preview {previewing && <span style={{ color: 'var(--color-text-tertiary)' }}>· refreshing…</span>}
          </p>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>
            {preview.summary}
          </p>

          {preview.drift?.length > 0 && (
            <div className="ax-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
              <table className="ax-tbl" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Numeric column</th>
                    <th>Mean before</th>
                    <th>Mean after</th>
                    <th>Δ mean</th>
                    <th>Std before</th>
                    <th>Std after</th>
                    <th>Δ std</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.drift.map((d) => (
                    <tr key={d.column}>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{d.column}</td>
                      <td>{fmt(d.before_mean)}</td>
                      <td>{fmt(d.after_mean)}</td>
                      <td style={{ color: pctColor(d.mean_pct_change) }}>{fmtPct(d.mean_pct_change)}</td>
                      <td>{fmt(d.before_std)}</td>
                      <td>{fmt(d.after_std)}</td>
                      <td style={{ color: pctColor(d.std_pct_change) }}>{fmtPct(d.std_pct_change)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="ax-lbl">Sample of new rows ({preview.added_rows} added)</p>
          <div
            className="ax-card"
            style={{ padding: 0, overflow: 'auto', maxHeight: 300, marginBottom: 12 }}
          >
            <table className="ax-grid" style={{ minWidth: '100%' }}>
              <thead>
                <tr>
                  {preview.columns.map((c) => <th key={c}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((row, i) => (
                  <tr key={i}>
                    {preview.columns.map((c) => {
                      const v = row[c]
                      const missing = v === null || v === undefined || v === ''
                      return (
                        <td key={c} className={missing ? 'missing' : ''}>
                          {missing ? '—' : String(v)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="ax-row" style={{ justifyContent: 'flex-end' }}>
        <button
          className="ax-btn prim"
          disabled={busy || previewing || targetTooLow || !preview}
          onClick={apply}
          type="button"
        >
          {busy ? 'Expanding…' : `Apply — add ${Math.max(0, targetRows - dataset.row_count).toLocaleString()} rows`}
        </button>
      </div>
    </>
  )
}

function MethodCard({ active, onClick, title, desc }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ax-card"
      style={{
        flex: 1,
        textAlign: 'left',
        background: active ? 'var(--color-accent-light)' : 'var(--color-background-primary)',
        borderColor: active ? 'var(--color-accent)' : undefined,
        cursor: 'pointer',
        padding: 12,
      }}
    >
      <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{title}</p>
      <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>{desc}</p>
    </button>
  )
}

function fmt(v) {
  if (v === null || v === undefined) return '—'
  if (Number.isInteger(v)) return v.toLocaleString()
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 })
}
function fmtPct(v) {
  if (v === null || v === undefined) return '—'
  return `${v > 0 ? '+' : ''}${v}%`
}
function pctColor(v) {
  if (v === null || v === undefined) return 'inherit'
  const abs = Math.abs(v)
  if (abs < 1) return 'var(--color-text-tertiary)'
  if (abs < 5) return 'var(--color-text-secondary)'
  return 'var(--color-text-danger)'
}
