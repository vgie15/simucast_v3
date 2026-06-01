/* ============================================================
 * PAGE: EXPAND / FEATURE ENGINEERING
 * Keywords: expand, feature engineering, derived features, transform
 * ============================================================ */
import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { useDialog } from '../common/DialogProvider'

/**
 * ExpandPage
 * Grow small datasets by bootstrap or synthetic generation. Live-previews
 * the resulting sample + per-numeric-column drift; Apply commits a stage.
 */
export default function ExpandPage({ dataset, setDataset }) {
  const dialog = useDialog()
  const [method, setMethod] = useState('bootstrap')
  const [targetRows, setTargetRows] = useState(() => Math.max(500, (dataset?.row_count || 100) * 2))
  const [noisePct, setNoisePct] = useState(5) // default to 5% noise as in mockup
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [expandedApplied, setExpandedApplied] = useState(false)

  // re-target when project changes
  useEffect(() => {
    setTargetRows(Math.max(500, (dataset?.row_count || 100) * 2))
    setPreview(null)
    setError(null)
    setExpandedApplied(false)
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
      setExpandedApplied(true)
      await dialog.alert({
        title: 'Expansion Complete',
        message: `Dataset now has ${fresh.row_count.toLocaleString()} rows.`,
        details: 'The expanded dataset is available as the current data stage and can be exported as CSV.',
      })
    } catch (err) {
      setError(err.message || 'Apply failed')
    } finally {
      setBusy(false)
    }
  }

  const avgDrift = useMemo(() => {
    if (!preview?.drift?.length) return 0
    const valid = preview.drift.filter((d) => d.mean_pct_change != null)
    if (!valid.length) return 0
    const sum = valid.reduce((acc, curr) => acc + Math.abs(curr.mean_pct_change), 0)
    return sum / valid.length
  }, [preview])

  const distinctRows = useMemo(() => {
    if (!dataset) return 0
    if (method === 'synthetic' || noisePct > 0) {
      return targetRows
    }
    return dataset.row_count
  }, [method, noisePct, targetRows, dataset?.row_count])

  if (!dataset) {
    return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>
  }

  const targetTooLow = !Number.isFinite(targetRows) || targetRows <= dataset.row_count

  return (
    <div className="ax-expand-layout">
      {/* Inline styles for method cards and multiplier pills */}
      <style dangerouslySetInnerHTML={{ __html: `
        .ax-expand-method-card {
          text-align: left;
          border-radius: 12px;
          padding: 16px;
          cursor: pointer;
          transition: all 0.15s ease-in-out;
          display: flex;
          flex-direction: column;
          gap: 6px;
          width: 100%;
        }
        .ax-expand-multiplier-pill {
          padding: 5px 12px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.12s ease-in-out;
        }
      `}} />

      {/* ── LEFT PANEL ── */}
      <div className="ax-expand-left">
        {/* Header */}
        <div className="ax-expand-left-head">
          <h1 className="ax-expand-title">Expand data</h1>
          <p className="ax-expand-sub">Grow your dataset by resampling or synthesis.</p>
        </div>

        {/* Scrollable controls */}
        <div className="ax-expand-left-scroll">

          {/* 1 - Method */}
          <div style={{ marginBottom: 24 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 10 }}>
              1 - METHOD
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Bootstrap button */}
              <button
                type="button"
                onClick={() => setMethod('bootstrap')}
                className="ax-expand-method-card"
                style={{
                  background: method === 'bootstrap' ? '#FFF8F2' : '#FFFFFF',
                  border: method === 'bootstrap' ? '1.5px solid #F97316' : '1.5px solid #E5E7EB',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-text-primary)' }}>
                    Bootstrap <span style={{ fontWeight: 400, color: 'var(--color-text-tertiary)', marginLeft: 4, fontSize: 11 }}>Sample with replacement</span>
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4, background: '#FFEDD5', color: '#EA580C' }}>
                    Safer
                  </span>
                </div>
                <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.4 }}>
                  Preserves cross-column correlations exactly. Add noise to avoid exact duplicates.
                </p>
              </button>

              {/* Synthetic button */}
              <button
                type="button"
                onClick={() => setMethod('synthetic')}
                className="ax-expand-method-card"
                style={{
                  background: method === 'synthetic' ? '#FFF8F2' : '#FFFFFF',
                  border: method === 'synthetic' ? '1.5px solid #F97316' : '1.5px solid #E5E7EB',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-text-primary)' }}>
                    Synthetic <span style={{ fontWeight: 400, color: 'var(--color-text-tertiary)', marginLeft: 4, fontSize: 11 }}>KDE / frequency sampling</span>
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4, background: '#F3F4F6', color: '#4B5563' }}>
                    More varied
                  </span>
                </div>
                <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.4 }}>
                  Diverse rows from each column's distribution. Correlations between columns are NOT preserved.
                </p>
              </button>
            </div>
          </div>

          {/* 2 - Target Rows */}
          <div style={{ marginBottom: 24 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 10 }}>
              2 - TARGET ROWS
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <input
                type="range"
                min={dataset.row_count + 1}
                max={Math.max(2000, dataset.row_count * 10)}
                step={10}
                value={targetRows}
                onChange={(e) => setTargetRows(parseInt(e.target.value, 10) || 0)}
                style={{ flex: 1, accentColor: '#F97316', cursor: 'pointer' }}
              />
              <input
                type="number"
                min={dataset.row_count + 1}
                value={targetRows}
                onChange={(e) => setTargetRows(parseInt(e.target.value, 10) || 0)}
                style={{
                  width: 80,
                  height: 38,
                  borderRadius: 8,
                  border: '1.5px solid #E5E7EB',
                  textAlign: 'center',
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  outline: 'none',
                  background: '#FFFFFF'
                }}
              />
            </div>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 12px' }}>
              Current {dataset.row_count.toLocaleString()} · adding <span style={{ color: '#EA580C', fontWeight: 700 }}>+{Math.max(0, targetRows - dataset.row_count).toLocaleString()}</span> · total {Math.max(targetRows, dataset.row_count).toLocaleString()}
            </p>
            {/* Multipliers */}
            <div style={{ display: 'flex', gap: 8 }}>
              {[2, 4, 8, 16].map((mult) => {
                const val = dataset.row_count * mult
                const isSelected = targetRows === val
                return (
                  <button
                    key={mult}
                    type="button"
                    onClick={() => setTargetRows(val)}
                    className="ax-expand-multiplier-pill"
                    style={{
                      border: isSelected ? '1.5px solid #F97316' : '1.5px solid #E5E7EB',
                      background: isSelected ? '#FFF8F2' : '#FFFFFF',
                      color: isSelected ? '#C2410C' : '#4B5563',
                      fontWeight: isSelected ? 700 : 500,
                    }}
                  >
                    x{mult}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 3 - Noise on numerics (bootstrap only) */}
          {method === 'bootstrap' && (
            <div>
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 10 }}>
                3 - NOISE ON NUMERICS
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <input
                  type="range"
                  min={0}
                  max={20}
                  step={1}
                  value={noisePct}
                  onChange={(e) => setNoisePct(parseInt(e.target.value, 10))}
                  style={{ flex: 1, accentColor: '#F97316', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', minWidth: 45, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {noisePct}% σ
                </span>
              </div>
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
                {noisePct === 0 ? 'No noise — bootstrap rows will be exact duplicates.' : `Numeric values jittered up to ${noisePct}% of column std-dev.`}
              </p>
            </div>
          )}
        </div>

        {/* Footer: error + Apply + Export */}
        <div className="ax-expand-left-foot">
          {error && (
            <p style={{ fontSize: 11, color: 'var(--color-text-danger)', margin: 0 }}>{error}</p>
          )}
          <button
            className="ax-btn prim"
            disabled={busy || previewing || targetTooLow || !preview}
            onClick={apply}
            style={{
              width: '100%',
              height: 42,
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: (busy || previewing || targetTooLow || !preview) ? 'var(--color-background-tertiary)' : '#F97316',
              color: '#fff',
              border: 'none',
              boxShadow: (busy || previewing || targetTooLow || !preview) ? 'none' : '0 4px 10px rgba(249, 115, 22, 0.15)',
              cursor: (busy || previewing || targetTooLow || !preview) ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s'
            }}
            type="button"
          >
            {busy ? 'Expanding…' : `Apply — add ${Math.max(0, targetRows - dataset.row_count).toLocaleString()} rows`}
          </button>

          {expandedApplied && (
            <a
              className="ax-btn"
              href={api.exportCsvUrl(dataset.id)}
              download
              style={{
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 38,
                fontSize: 12,
                borderRadius: 8
              }}
            >
              Export expanded CSV
            </a>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="ax-expand-right">
        <div className="ax-expand-right-scroll">
          {preview ? (
            <>
              {/* Section label */}
              <span className="ax-expand-section-label">EXPANSION PREVIEW</span>

              {/* Summary stats cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 20 }}>
                {/* Rows Card */}
                <div style={{ padding: '14px 16px', background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    ROWS
                  </span>
                  <p style={{ fontSize: 18, fontWeight: 800, margin: '6px 0 0', color: 'var(--color-text-primary)' }}>
                    {dataset.row_count} <span style={{ color: '#F97316', fontWeight: 800 }}>→ {targetRows}</span>
                  </p>
                </div>

                {/* Avg Drift Card */}
                <div style={{ padding: '14px 16px', background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    AVG DRIFT
                  </span>
                  <p style={{ fontSize: 18, fontWeight: 800, margin: '6px 0 2px', color: avgDrift === 0 ? 'var(--color-text-secondary)' : (avgDrift < 5 ? '#10B981' : '#F59E0B') }}>
                    ±{avgDrift.toFixed(1)}%
                  </p>
                  <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', display: 'block' }}>
                    across {preview.drift?.length || 0} columns
                  </span>
                </div>

                {/* Distinct Rows Card */}
                <div style={{ padding: '14px 16px', background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    DISTINCT ROWS
                  </span>
                  <p style={{ fontSize: 18, fontWeight: 800, margin: '6px 0 2px', color: 'var(--color-text-primary)' }}>
                    {distinctRows.toLocaleString()}
                  </p>
                  <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', display: 'block' }}>
                    unique generated rows
                  </span>
                </div>
              </div>

              {/* Drift Table */}
              {preview.drift?.length > 0 && (
                <div style={{ padding: 16, background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      DISTRIBUTION DRIFT · NUMERIC COLUMNS
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                      {previewing ? 'refreshing…' : 'refreshing on change'}
                    </span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="ax-tbl" style={{ fontSize: 12, minWidth: '100%' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                          <th style={{ textAlign: 'left', padding: '8px 0', color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>COLUMN</th>
                          <th style={{ textAlign: 'right', padding: '8px 0', color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>MEAN BEFORE</th>
                          <th style={{ textAlign: 'right', padding: '8px 0', color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>MEAN AFTER</th>
                          <th style={{ textAlign: 'right', padding: '8px 0', color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>DRIFT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.drift.map((d) => (
                          <tr key={d.column} style={{ borderBottom: '1px solid #F3F4F6' }}>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 650, textAlign: 'left', padding: '10px 0', color: 'var(--color-text-primary)' }}>{d.column}</td>
                            <td style={{ textAlign: 'right', padding: '10px 0' }}>{fmt(d.before_mean)}</td>
                            <td style={{ textAlign: 'right', padding: '10px 0' }}>{fmt(d.after_mean)}</td>
                            <td style={{ textAlign: 'right', padding: '10px 0' }}>
                              <DriftSparkline value={d.mean_pct_change} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Sample Table */}
              <div style={{ padding: 16, background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    SAMPLE OF NEW ROWS · {preview.sample?.length || 0} OF {preview.added_rows}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 800, background: '#FFEDD5', color: '#EA580C', padding: '2px 8px', borderRadius: 4 }}>
                    NEW
                  </span>
                </div>
                <div style={{ overflowX: 'auto', maxHeight: 240 }}>
                  <table className="ax-grid" style={{ minWidth: '100%', fontSize: 11 }}>
                    <thead style={{ background: '#FAF6F0' }}>
                      <tr>
                        <th style={{ width: 45, padding: '8px 10px', background: '#FAF6F0' }}>#</th>
                        {preview.columns.map((c) => <th key={c} style={{ padding: '8px 10px', background: '#FAF6F0' }}>{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map((row, i) => {
                        const rowNum = dataset.row_count + i + 1
                        return (
                          <tr key={i}>
                            <td style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', padding: '8px 10px' }}>{rowNum}</td>
                            {preview.columns.map((c) => {
                              const v = row[c]
                              const missing = v === null || v === undefined || v === ''
                              return (
                                <td key={c} className={missing ? 'missing' : ''} style={{ fontFamily: 'var(--font-mono)', padding: '8px 10px' }}>
                                  {missing ? '—' : String(v)}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            /* Empty state */
            <div
              style={{
                padding: '40px 20px',
                background: 'var(--color-background-secondary)',
                border: '1.5px dashed var(--color-border-tertiary)',
                borderRadius: 12,
                textAlign: 'center',
                color: 'var(--color-text-tertiary)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                minHeight: 280
              }}
            >
              <span style={{ fontSize: 24 }}>📈</span>
              <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>No expansion preview active</p>
              <p style={{ fontSize: 11, maxWidth: 260, margin: 0 }}>Adjust the target row count above to generate and inspect drift statistics.</p>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

// Selectable card button used to pick an expansion method with title and description.
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

// Zero-centered Drift sparkline representation component
function DriftSparkline({ value }) {
  if (value === null || value === undefined) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
  const numVal = Number(value)
  if (!Number.isFinite(numVal)) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>

  // Cap drift at +/- 5% for visualization scaling
  const capped = Math.max(-5, Math.min(5, numVal))
  const isPositive = capped >= 0
  const widthPct = Math.abs(capped) * 10 // 5% maps to 50% width

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
      <div style={{ position: 'relative', width: 60, height: 6, background: '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
        {/* Zero center marker line */}
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1.5, background: '#9CA3AF' }} />
        {/* Bar */}
        <div
          style={{
            position: 'absolute',
            left: isPositive ? '50%' : `calc(50% - ${widthPct}%)`,
            width: `${widthPct}%`,
            top: 0,
            bottom: 0,
            background: isPositive ? '#10B981' : '#EF4444',
          }}
        />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: numVal === 0 ? 'inherit' : (isPositive ? '#10B981' : '#EF4444'), minWidth: 45, textAlign: 'right' }}>
        {numVal > 0 ? '+' : ''}{numVal.toFixed(1)}%
      </span>
    </div>
  )
}

// Formats a numeric value for display, using locale and fallback dash for null.
function fmt(v) {
  if (v === null || v === undefined) return '—'
  if (Number.isInteger(v)) return v.toLocaleString()
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 })
}
// Formats a percent change with explicit sign and dash placeholder for null.
function fmtPct(v) {
  if (v === null || v === undefined) return '—'
  return `${v > 0 ? '+' : ''}${v}%`
}
// Returns a CSS color token for a percent delta based on absolute magnitude.
function pctColor(v) {
  if (v === null || v === undefined) return 'inherit'
  const abs = Math.abs(v)
  if (abs < 1) return 'var(--color-text-tertiary)'
  if (abs < 5) return 'var(--color-text-secondary)'
  return 'var(--color-text-danger)'
}
