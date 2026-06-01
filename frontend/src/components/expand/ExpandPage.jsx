/* ============================================================
 * PAGE: EXPAND / FEATURE ENGINEERING
 * Keywords: expand, feature engineering, derived features, transform
 * ============================================================ */
import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../api'
import { useDialog } from '../common/DialogProvider'
import { InlineSpinner } from '../common/LoadingStates'
import { SparkleIcon } from '../ai/AIExplainers'

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
  const [explainMode, setExplainMode] = useState(false)
  const [explainPopup, setExplainPopup] = useState(null)

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

  useEffect(() => {
    document.body.classList.toggle('ax-explain-mode-on', explainMode)
    return () => document.body.classList.remove('ax-explain-mode-on')
  }, [explainMode])

  const openExplain = (meta, event) => {
    if (!explainMode) return
    event?.preventDefault?.()
    event?.stopPropagation?.()
    const target = event?.currentTarget || event?.target
    const sourceRect = target?.getBoundingClientRect ? target.getBoundingClientRect() : null
    setExplainPopup(buildExpandExplainMeta(meta, { dataset, preview, method, targetRows, noisePct, avgDrift, distinctRows, sourceRect }))
  }

  const explainAttrs = (meta, className = '', capture = false) => {
    const attrs = {
      className: `${className} ${explainMode ? 'ax-explain-selectable' : ''}`.trim(),
      [capture ? 'onClickCapture' : 'onClick']: (event) => openExplain(meta, event),
      title: explainMode ? `Explain ${meta.title}` : undefined,
    }
    if (capture) {
      attrs.onPointerDownCapture = (event) => openExplain(meta, event)
    }
    return attrs
  }

  useEffect(() => {
    if (!explainMode) return undefined
    const onEdgeTab = (event) => {
      const tab = event.target?.closest?.('.ax-edge-tab')
      if (!tab) return
      event.preventDefault()
      event.stopPropagation()
      const isHistory = tab.classList.contains('history')
      setExplainPopup(buildExpandExplainMeta({
        id: isHistory ? 'side-history-tab' : 'side-guide-tab',
        title: isHistory ? 'History tab' : 'Guide tab',
        type: 'side-tab',
      }, {
        dataset,
        preview,
        method,
        targetRows,
        noisePct,
        avgDrift,
        distinctRows,
        sourceRect: tab.getBoundingClientRect(),
      }))
    }
    document.addEventListener('pointerdown', onEdgeTab, true)
    document.addEventListener('click', onEdgeTab, true)
    return () => {
      document.removeEventListener('pointerdown', onEdgeTab, true)
      document.removeEventListener('click', onEdgeTab, true)
    }
  }, [explainMode, dataset, preview, method, targetRows, noisePct, avgDrift, distinctRows])

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
          <div {...explainAttrs({ id: 'method-section', title: 'Method section', type: 'setting' })} style={{ marginBottom: 24 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 10 }}>
              1 - METHOD
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Bootstrap button */}
              <button
                type="button"
                {...explainAttrs({ id: 'bootstrap-option', title: 'Bootstrap option', type: 'setting' }, 'ax-expand-method-card', true)}
                onClick={() => setMethod('bootstrap')}
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
                {...explainAttrs({ id: 'synthetic-option', title: 'Synthetic option', type: 'setting' }, 'ax-expand-method-card', true)}
                onClick={() => setMethod('synthetic')}
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
            <div {...explainAttrs({ id: 'target-rows-control', title: 'Target Rows slider and input', type: 'setting' }, '', true)} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
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
                    {...explainAttrs({ id: `multiplier-x${mult}`, title: `x${mult} target rows button`, type: 'setting', multiplier: mult }, 'ax-expand-multiplier-pill', true)}
                    onClick={() => setTargetRows(val)}
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
            <div {...explainAttrs({ id: 'noise-slider', title: 'Noise on Numerics slider', type: 'setting' }, '', true)}>
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
            disabled={!explainMode && (busy || previewing || targetTooLow || !preview)}
            {...explainAttrs({ id: 'apply-expansion', title: 'Apply button', type: 'setting' }, 'ax-btn prim', true)}
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
              cursor: explainMode ? 'pointer' : (busy || previewing || targetTooLow || !preview) ? 'not-allowed' : 'pointer',
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
          <div className="ax-expand-preview-head">
            <span className="ax-expand-section-label">EXPANSION PREVIEW</span>
            <button
              type="button"
              className={`ax-explain-mode-toggle ${explainMode ? 'active' : ''}`}
              onClick={() => setExplainMode((current) => !current)}
            >
              <SparkleIcon size={12} />
              Explain Mode
              <span />
            </button>
          </div>
          {preview ? (
            <>
              {/* Summary stats cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 20 }}>
                {/* Rows Card */}
                <div {...explainAttrs({ id: 'metric-rows', title: 'Rows card', type: 'metric' })} style={{ padding: '14px 16px', background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    ROWS
                  </span>
                  <p style={{ fontSize: 18, fontWeight: 800, margin: '6px 0 0', color: 'var(--color-text-primary)' }}>
                    {dataset.row_count} <span style={{ color: '#F97316', fontWeight: 800 }}>→ {targetRows}</span>
                  </p>
                </div>

                {/* Avg Drift Card */}
                <div {...explainAttrs({ id: 'metric-avg-drift', title: 'Avg Drift card', type: 'metric' })} style={{ padding: '14px 16px', background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12 }}>
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
                <div {...explainAttrs({ id: 'metric-distinct-rows', title: 'Distinct Rows card', type: 'metric' })} style={{ padding: '14px 16px', background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12 }}>
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
                <div {...explainAttrs({ id: 'drift-table', title: 'Distribution Drift table', type: 'drift-table' })} style={{ padding: 16, background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, marginBottom: 20 }}>
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
                          <th {...explainAttrs({ id: 'drift-col-before', title: 'Mean Before column', type: 'drift-column', column: 'Mean Before' })} style={{ textAlign: 'right', padding: '8px 0', color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>MEAN BEFORE</th>
                          <th {...explainAttrs({ id: 'drift-col-after', title: 'Mean After column', type: 'drift-column', column: 'Mean After' })} style={{ textAlign: 'right', padding: '8px 0', color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>MEAN AFTER</th>
                          <th {...explainAttrs({ id: 'drift-col-drift', title: 'Drift column', type: 'drift-column', column: 'Drift' })} style={{ textAlign: 'right', padding: '8px 0', color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>DRIFT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.drift.map((d) => (
                          <tr key={d.column} {...explainAttrs({ id: `drift-row-${d.column}`, title: `${d.column} drift row`, type: 'drift-row', row: d })} style={{ borderBottom: '1px solid #F3F4F6' }}>
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
              <div {...explainAttrs({ id: 'sample-table', title: 'Sample of New Rows table', type: 'sample-table' })} style={{ padding: 16, background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12 }}>
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
                        {preview.columns.map((c) => (
                          <th
                            key={c}
                            {...explainAttrs({ id: `sample-col-${c}`, title: `${c} sample column`, type: 'sample-column', column: c })}
                            style={{ padding: '8px 10px', background: '#FAF6F0' }}
                          >
                            {c}
                          </th>
                        ))}
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

      {explainPopup && (
        <ExpandExplainPopup
          datasetId={dataset.id}
          element={explainPopup}
          onClose={() => setExplainPopup(null)}
        />
      )}
    </div>
  )
}

function ExpandExplainPopup({ datasetId, element, onClose }) {
  const [aiText, setAiText] = useState(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('normal')
  const [followUpInput, setFollowUpInput] = useState('')
  const [followUpLoading, setFollowUpLoading] = useState(false)
  const [position, setPosition] = useState({ top: 84, left: 24 })

  useEffect(() => {
    if (!element?.sourceRect) return
    const popupW = 330
    const popupH = 390
    const { innerWidth, innerHeight } = window
    let top = element.sourceRect.bottom + 8
    let left = Math.max(12, Math.min(element.sourceRect.left, innerWidth - popupW - 12))
    if (top + popupH > innerHeight - 16) top = Math.max(12, element.sourceRect.top - popupH - 8)
    setPosition({ top, left })
  }, [element?.sourceRect])

  const fetchAI = async (variant = 'normal') => {
    if (!datasetId || !element) return
    setLoading(true)
    try {
      const question = variant === 'simple'
        ? `Explain this Expand page UI section in very simple terms, one or two sentences: ${element.title}.`
        : variant === 'technical'
          ? `Give a concise technical explanation for this Expand page UI section: ${element.title}. Include the current values and statistical implication.`
          : `Explain this Expand page UI section in plain language for a student using SimuCast: ${element.title}. Include what it does, what the current values imply, and whether it is safe to proceed.`
      const payload = {
        title: element.title,
        type: element.type,
        currentValues: element.values,
        fallbackDatasetExplanation: element.datasetExplanation,
        fallbackVerdict: element.verdict,
      }
      const response = await api.aiExplain(datasetId, `expand-${element.id}-${variant}`, payload, question, { element: payload })
      setAiText(response?.explanation || element.datasetExplanation)
    } catch {
      setAiText(element.datasetExplanation)
    } finally {
      setLoading(false)
    }
  }

  const askFollowUp = async () => {
    if (!datasetId || !followUpInput.trim()) return
    setFollowUpLoading(true)
    try {
      const payload = {
        title: element.title,
        type: element.type,
        currentValues: element.values,
        previousExplanation: aiText || element.datasetExplanation,
      }
      const response = await api.aiExplain(datasetId, `expand-${element.id}-followup`, payload, followUpInput, { element: payload })
      setAiText(response?.explanation || element.datasetExplanation)
      setFollowUpInput('')
      setMode('normal')
    } catch {
      setAiText(element.datasetExplanation)
    } finally {
      setFollowUpLoading(false)
    }
  }

  useEffect(() => {
    setAiText(null)
    fetchAI()
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [element?.id, datasetId])

  return createPortal(
    <div
      className="ax-expand-explain-popup"
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-modal="true"
      aria-label={`${element.title} explanation`}
    >
      <div className="ax-expand-explain-popup-head">
        <div>
          <p>AI Explain · {element.title}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close explanation">&times;</button>
      </div>
      <div className="ax-expand-explain-popup-body">
        <section>
          <span>What this means</span>
          <p>{element.simple}</p>
        </section>
        <section>
          <span>In this dataset</span>
          {loading ? (
            <InlineSpinner label="Generating explanation..." />
          ) : (
            <p>{aiText || element.datasetExplanation}</p>
          )}
        </section>
        <section>
          <span>Verdict</span>
          <p className={`ax-expand-explain-verdict ${element.verdictTone}`}>{element.verdict}</p>
        </section>
      </div>
      {mode === 'followup' && (
        <div className="ax-expand-explain-followup">
          <input
            type="text"
            value={followUpInput}
            onChange={(event) => setFollowUpInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') askFollowUp()
            }}
            placeholder="Ask a follow-up..."
          />
          <button type="button" onClick={askFollowUp} disabled={followUpLoading || !followUpInput.trim()}>
            {followUpLoading ? '...' : 'Ask'}
          </button>
        </div>
      )}
      <div className="ax-expand-explain-popup-foot">
        <button type="button" className="ax-btn mini" onClick={() => fetchAI('simple')} disabled={loading}>
          {loading ? 'Retrying...' : 'Explain simpler'}
        </button>
        <button type="button" className="ax-btn mini" onClick={() => fetchAI('technical')} disabled={loading}>Technical details</button>
        <button type="button" className="ax-btn mini" onClick={() => setMode(mode === 'followup' ? 'normal' : 'followup')}>
          {mode === 'followup' ? 'Close chat' : 'Ask follow-up'}
        </button>
      </div>
    </div>,
    document.body,
  )
}

function buildExpandExplainMeta(meta, context) {
  const { dataset, preview, method, targetRows, noisePct, avgDrift, distinctRows, sourceRect } = context
  const rowsBefore = Number(dataset?.row_count || 0)
  const addedRows = Math.max(0, Number(targetRows || 0) - rowsBefore)
  const values = {
    rowsBefore,
    targetRows,
    addedRows,
    method,
    noisePct,
    avgDrift,
    distinctRows,
    sampleRows: preview?.sample?.length || 0,
  }
  const base = {
    id: meta.id,
    title: meta.title,
    type: meta.type,
    values,
    sourceRect,
    verdictTone: 'good',
  }

  const row = meta.row
  const column = meta.column
  const drift = row?.mean_pct_change
  const absDrift = drift == null ? 0 : Math.abs(Number(drift))
  const driftTone = absDrift < 1 ? 'good' : absDrift < 5 ? 'warning' : 'risk'

  const templates = {
    'metric-rows': {
      simple: 'This card compares the current row count with the expanded row target.',
      datasetExplanation: `The dataset currently has ${rowsBefore.toLocaleString()} rows. The preview expands it to ${Number(targetRows || 0).toLocaleString()} rows, adding ${addedRows.toLocaleString()} new rows for downstream analysis and modeling.`,
      verdict: addedRows > 0 ? 'Good. The preview is increasing the dataset size without changing the original stage until Apply is clicked.' : 'Needs adjustment. The target must be higher than the current row count.',
      verdictTone: addedRows > 0 ? 'good' : 'warning',
    },
    'metric-avg-drift': {
      simple: 'Average drift estimates how much numeric column means change after expansion.',
      datasetExplanation: `The preview shows an average numeric drift of about ${avgDrift.toFixed(1)}%. Lower drift means the generated rows are staying close to the original numeric distribution.`,
      verdict: avgDrift < 1 ? 'Good. Drift is very small, so the expansion is preserving numeric averages well.' : avgDrift < 5 ? 'Acceptable. Review individual columns before applying.' : 'Risky. Drift is high enough to inspect before applying.',
      verdictTone: avgDrift < 1 ? 'good' : avgDrift < 5 ? 'warning' : 'risk',
    },
    'metric-distinct-rows': {
      simple: 'Distinct rows estimates how many unique generated rows are present in the expanded preview.',
      datasetExplanation: `${distinctRows.toLocaleString()} rows are expected to be distinct. Bootstrap without noise can repeat original rows, while synthetic generation or numeric noise tends to produce more unique rows.`,
      verdict: distinctRows >= targetRows ? 'Good. The expanded preview should add varied rows.' : 'Acceptable. Some repeated rows are expected with bootstrap sampling.',
      verdictTone: distinctRows >= targetRows ? 'good' : 'warning',
    },
    'method-section': {
      simple: 'The method section controls how SimuCast creates additional rows.',
      datasetExplanation: `The current method is ${method}. Bootstrap preserves relationships between columns more directly, while synthetic generation creates more variety but can weaken cross-column patterns.`,
      verdict: method === 'bootstrap' ? 'Good default. Bootstrap is usually safer when preserving relationships matters.' : 'Use carefully. Synthetic rows are more varied but need drift review.',
      verdictTone: method === 'bootstrap' ? 'good' : 'warning',
    },
    'bootstrap-option': {
      simple: 'Bootstrap samples existing rows with replacement, then optionally adds numeric noise.',
      datasetExplanation: `For this dataset, bootstrap will reuse the original ${rowsBefore.toLocaleString()} rows to reach ${Number(targetRows || 0).toLocaleString()} rows. With ${noisePct}% numeric noise, duplicates become less exact.`,
      verdict: 'Good for preserving relationships between columns.',
      verdictTone: 'good',
    },
    'synthetic-option': {
      simple: 'Synthetic generation samples each column distribution to create new row combinations.',
      datasetExplanation: `Synthetic mode can create varied rows for ${dataset?.name || 'this dataset'}, but it does not guarantee that relationships between columns remain the same.`,
      verdict: 'Use after checking drift and sample rows.',
      verdictTone: 'warning',
    },
    'target-rows-control': {
      simple: 'Target rows sets the final size of the expanded dataset.',
      datasetExplanation: `The target is ${Number(targetRows || 0).toLocaleString()} rows, which adds ${addedRows.toLocaleString()} rows beyond the current ${rowsBefore.toLocaleString()} rows.`,
      verdict: addedRows > 0 ? 'Good. The target is valid.' : 'Needs adjustment. Choose a target above the current row count.',
      verdictTone: addedRows > 0 ? 'good' : 'warning',
    },
    'noise-slider': {
      simple: 'Noise on numerics adds a small jitter to numeric values during bootstrap expansion.',
      datasetExplanation: noisePct === 0
        ? 'Noise is off, so bootstrap rows may be exact duplicates of original rows.'
        : `Numeric values are jittered by up to ${noisePct}% of each column standard deviation, which helps reduce exact duplicates while keeping values close to the source distribution.`,
      verdict: noisePct <= 10 ? 'Good. This is a controlled amount of variation.' : 'Review carefully. Higher noise can distort numeric distributions.',
      verdictTone: noisePct <= 10 ? 'good' : 'warning',
    },
    'apply-expansion': {
      simple: 'Apply commits the preview as a new current dataset stage.',
      datasetExplanation: `Clicking Apply would add ${addedRows.toLocaleString()} rows using ${method} and make the expanded dataset the active stage.`,
      verdict: preview ? 'Ready when the preview and drift look acceptable.' : 'Preview first. Apply should wait until a valid preview exists.',
      verdictTone: preview ? 'good' : 'warning',
    },
    'drift-table': {
      simple: 'The drift table compares numeric column averages before and after expansion.',
      datasetExplanation: `There are ${preview?.drift?.length || 0} numeric columns in the drift preview. Use this table to catch columns whose averages changed too much after expansion.`,
      verdict: avgDrift < 5 ? 'Acceptable. The overall drift is within a practical review range.' : 'Risky. Inspect rows with larger drift before applying.',
      verdictTone: avgDrift < 5 ? 'good' : 'risk',
    },
    'sample-table': {
      simple: 'The sample table shows example rows that the expansion process generated.',
      datasetExplanation: `The preview is showing ${preview?.sample?.length || 0} new rows out of ${preview?.added_rows || addedRows} added rows. Use it to check whether categories and numeric values look plausible.`,
      verdict: 'Good check. Sampling helps verify that generated rows look realistic before applying.',
      verdictTone: 'good',
    },
    'side-guide-tab': {
      simple: 'The Guide tab opens the guided workflow panel for the current project.',
      datasetExplanation: 'On the Expand page, the Guide panel helps connect expansion choices to the broader project workflow.',
      verdict: 'Useful for step-by-step workflow support.',
      verdictTone: 'good',
    },
    'side-history-tab': {
      simple: 'The History tab opens the project activity and data-stage history.',
      datasetExplanation: 'After expansion, History helps confirm what changed and lets users inspect or restore prior stages.',
      verdict: 'Important for traceability before and after applying expansion.',
      verdictTone: 'good',
    },
  }

  if (meta.id?.startsWith('multiplier-')) {
    const multiplier = meta.multiplier || 2
    return {
      ...base,
      simple: `The x${multiplier} button quickly sets the target rows to ${multiplier} times the current dataset size.`,
      datasetExplanation: `For ${rowsBefore.toLocaleString()} current rows, x${multiplier} sets the target to ${(rowsBefore * multiplier).toLocaleString()} rows.`,
      verdict: multiplier <= 4 ? 'Good for moderate expansion.' : 'Use carefully. Larger multipliers need closer drift review.',
      verdictTone: multiplier <= 4 ? 'good' : 'warning',
    }
  }

  if (meta.type === 'drift-row' && row) {
    return {
      ...base,
      simple: `This row shows how the mean of ${row.column} changes after expansion.`,
      datasetExplanation: `${row.column} changes from ${fmt(row.before_mean)} before expansion to ${fmt(row.after_mean)} after expansion, with ${drift == null ? 'no measured' : `${drift > 0 ? '+' : ''}${Number(drift).toFixed(1)}%`} drift.`,
      verdict: absDrift < 1 ? 'Good. This column stays very close to the original mean.' : absDrift < 5 ? 'Acceptable. Review if this column is important.' : 'Risky. This column changed enough to inspect.',
      verdictTone: driftTone,
    }
  }

  if (meta.type === 'drift-column') {
    return {
      ...base,
      simple: `${column} explains one measurement used to compare before and after expansion.`,
      datasetExplanation: column === 'Drift'
        ? 'Drift shows the percent change between the before and after means. It is the quickest way to spot distribution shifts.'
        : `${column} is used to compare the original numeric distribution against the expanded preview.`,
      verdict: 'Use this column with the row values to decide whether expansion is preserving numeric patterns.',
      verdictTone: 'good',
    }
  }

  if (meta.type === 'sample-column') {
    return {
      ...base,
      simple: `${column} is one of the fields shown in the generated row sample.`,
      datasetExplanation: `Use the ${column} column to check whether generated values look valid for this dataset. Categorical columns should use familiar labels, while numeric columns should stay within plausible ranges.`,
      verdict: 'Good to inspect before applying, especially if this column is used in models or reports.',
      verdictTone: 'good',
    }
  }

  return {
    ...base,
    ...(templates[meta.id] || {
      simple: 'This selected area controls or summarizes part of the expansion preview.',
      datasetExplanation: 'Use this area to understand how the expanded dataset will differ from the current dataset before applying changes.',
      verdict: 'Review this before applying expansion.',
      verdictTone: 'warning',
    }),
  }
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
