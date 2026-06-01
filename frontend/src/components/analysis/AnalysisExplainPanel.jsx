import React, { useEffect, useState, useCallback } from 'react'
import { Sparkles } from 'lucide-react'
import { api } from '../../api'
import { InlineSpinner } from '../common/LoadingStates'
import { useAuth } from '../providers/AuthProvider'

function fmt(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '-'
  if (typeof v !== 'number') return v
  if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(2)
  return v.toFixed(3)
}

function effectSizeLabel(kind, value) {
  if (kind === 't') {
    const abs = Math.abs(value)
    if (abs >= 0.8) return 'large'
    if (abs >= 0.5) return 'moderate'
    if (abs >= 0.2) return 'small'
    return 'very small'
  }
  if (kind === 'anova') {
    if (value >= 0.14) return 'large'
    if (value >= 0.06) return 'moderate'
    if (value >= 0.01) return 'small'
    return 'very small'
  }
  if (kind === 'chi') {
    if (value >= 0.5) return 'large'
    if (value >= 0.3) return 'moderate'
    if (value >= 0.1) return 'small'
    return 'very small'
  }
  if (kind === 'corr') {
    const abs = Math.abs(value)
    if (abs >= 0.7) return 'strong'
    if (abs >= 0.4) return 'moderate'
    if (abs >= 0.2) return 'weak'
    return 'very weak'
  }
  return 'unknown'
}

function corrStrengthLabel(r) {
  const abs = Math.abs(r)
  if (abs >= 0.7) return 'Very Strong'
  if (abs >= 0.4) return 'Strong'
  if (abs >= 0.2) return 'Moderate'
  return 'Weak'
}

function predictionUsefulness(kind, result) {
  const sig = result.significant
  if (kind === 'corr') {
    const pair = result.strongest_pair
    const r = Math.abs(pair?.r ?? 0)
    if (r >= 0.5) return { label: 'YES', color: '#22c55e', strength: 'HIGH', strengthColor: '#22c55e' }
    if (r >= 0.3) return { label: 'MAYBE', color: '#eab308', strength: 'MODERATE', strengthColor: '#eab308' }
    return { label: 'NO', color: '#ef4444', strength: 'LOW', strengthColor: '#ef4444' }
  }
  if (sig) {
    let effectVal = 0
    if (kind === 't') effectVal = Math.abs(result.cohens_d ?? 0)
    else if (kind === 'anova') effectVal = result.eta_squared ?? 0
    else if (kind === 'chi') effectVal = result.cramers_v ?? 0
    const large = kind === 't' ? effectVal >= 0.5 : kind === 'anova' ? effectVal >= 0.06 : effectVal >= 0.3
    if (large) return { label: 'YES', color: '#22c55e', strength: 'HIGH', strengthColor: '#22c55e' }
    return { label: 'MAYBE', color: '#eab308', strength: 'MODERATE', strengthColor: '#eab308' }
  }
  return { label: 'NO', color: '#ef4444', strength: 'VERY LOW', strengthColor: '#ef4444' }
}

function buildWhatThisMeans(kind, result, setup) {
  if (kind === 't') {
    const diff = Number(result.mean_group_1) - Number(result.mean_group_2)
    const gA = result.group_labels?.[0] || 'Group A'
    const gB = result.group_labels?.[1] || 'Group B'
    const target = setup.measure || 'the measure'
    const sig = result.significant
    const accent = sig ? '#22c55e' : '#94a3b8'
    const icon = sig ? '🟢' : '⚪'
    const verdict = sig
      ? `${gA} tends to have higher ${target} than ${gB}.`
      : `${gA} and ${gB} show similar average ${target}.`
    const higher = diff >= 0 ? gA : gB
    const diffAbs = Math.abs(diff)
    return {
      accent,
      verdict: `${icon} ${verdict}`,
      table: [
        { label: gA, value: fmt(result.mean_group_1) },
        { label: gB, value: fmt(result.mean_group_2) },
        { label: 'Difference', value: `${diff >= 0 ? '+' : ''}${fmt(diff)} (${((diffAbs / Math.max(Number(result.mean_group_1), Number(result.mean_group_2), 1)) * 100).toFixed(0)}% higher)` },
      ],
      canUse: sig
        ? { icon: '✅', text: `Yes. ${setup.group} is likely useful for predicting ${target}.` }
        : { icon: '❌', text: 'Not strongly. The groups are too similar to be useful.' },
    }
  }
  if (kind === 'anova') {
    const means = Object.entries(result.group_means || {}).sort((a, b) => Number(b[1]) - Number(a[1]))
    const target = setup.measure || 'the measure'
    const variable = setup.group || 'the variable'
    const sig = result.significant
    const accent = sig ? '#22c55e' : '#94a3b8'
    const icon = sig ? '🟢' : '⚪'
    const verdict = sig
      ? `${target} differs significantly by ${variable}.`
      : `${target} is similar across all ${variable} groups.`
    const medals = ['🥇', '🥈', '🥉']
    return {
      accent,
      verdict: `${icon} ${verdict}`,
      rankedGroups: means.slice(0, 5).map(([label, value], i) => ({
        medal: medals[i] || `${i + 1}.`,
        label,
        value: fmt(value),
      })),
      rangeText: means.length >= 2 ? `Difference between highest and lowest: ${fmt(Number(means[0][1]) - Number(means[means.length - 1][1]))}` : null,
      canUse: sig
        ? { icon: '✅', text: `Yes. ${variable} is likely useful for predicting ${target}.` }
        : { icon: '❌', text: 'Not strongly. The groups are too similar to be useful.' },
    }
  }
  if (kind === 'chi') {
    const v1 = setup.varA || 'Variable 1'
    const v2 = setup.varB || 'Variable 2'
    const sig = result.significant
    const accent = sig ? '#22c55e' : '#94a3b8'
    const icon = sig ? '🟢' : '⚪'
    const verdict = sig
      ? `${v1} and ${v2} are associated.`
      : `${v1} and ${v2} appear unrelated.`
    const rows = Object.keys(result.contingency || {})
    const cols = rows.length ? Object.keys(result.contingency[rows[0]] || {}) : []
    return {
      accent,
      verdict: `${icon} ${verdict}`,
      distTable: !sig ? { rows, cols, data: result.contingency || {}, percentages: result.row_percentages || {} } : null,
      plainInterp: sig
        ? `The distribution of ${v2} varies depending on ${v1}.`
        : `Knowing a ${v1.toLowerCase().replace(/s$/, '')} does not help predict ${v2.toLowerCase()}.`,
      canUse: sig
        ? { icon: '✅', text: `Yes. ${v1} is associated with ${v2} and may be useful in analysis.` }
        : { icon: '❌', text: `Not strongly. ${v1} and ${v2} appear independent.` },
    }
  }
  if (kind === 'corr') {
    const pair = result.strongest_pair
    const r = pair?.r ?? 0
    const abs = Math.abs(r)
    const varA = pair?.var_a || 'Variable A'
    const varB = pair?.var_b || 'Variable B'
    const accent = abs >= 0.5 ? '#22c55e' : abs >= 0.3 ? '#eab308' : '#94a3b8'
    let verdict
    if (r > 0.5) verdict = `Strong positive relationship — as ${varA} increases, ${varB} tends to increase.`
    else if (r < -0.5) verdict = `Strong negative relationship — as ${varA} increases, ${varB} tends to decrease.`
    else if (abs >= 0.3) verdict = `Moderate relationship — ${varA} and ${varB} show a noticeable tendency to move together.`
    else verdict = `Weak relationship — ${varA} and ${varB} don't move together strongly.`
    const strength = corrStrengthLabel(r)
    const usefulness = abs >= 0.5 ? 'High' : abs >= 0.3 ? 'Medium' : 'Low'
    return {
      accent,
      verdict,
      stats: [
        { label: 'Strength', value: strength },
        { label: 'Prediction usefulness', value: usefulness },
      ],
      canUse: abs >= 0.3
        ? { icon: '✅', text: `Yes. ${varA} and ${varB} have a ${strength.toLowerCase()} relationship.` }
        : { icon: '⚠️', text: `Weak relationship — limited predictive value.` },
    }
  }
  return { accent: '#94a3b8', verdict: 'No result available.', canUse: { icon: '❓', text: '' } }
}

function buildDecisionTakeaway(kind, result) {
  return predictionUsefulness(kind, result)
}

function buildAIContext(kind, result, setup, dataset) {
  const ctx = { datasetName: dataset?.name || dataset?.file_name || '' }
  if (kind === 't') {
    ctx.testType = 'independent_ttest'
    ctx.variable = setup.group
    ctx.target = setup.measure
    ctx.groupA = { label: result.group_labels?.[0], mean: result.mean_group_1 }
    ctx.groupB = { label: result.group_labels?.[1], mean: result.mean_group_2 }
    ctx.difference = Number(result.mean_group_1) - Number(result.mean_group_2)
    ctx.pValue = result.p
    ctx.significant = result.significant
  } else if (kind === 'anova') {
    ctx.testType = 'anova'
    ctx.variable = setup.group
    ctx.target = setup.measure
    ctx.groups = Object.entries(result.group_means || {}).map(([label, mean]) => ({ label, mean }))
    ctx.pValue = result.p
    ctx.significant = result.significant
  } else if (kind === 'chi') {
    ctx.testType = 'chi_square'
    ctx.var1 = setup.varA
    ctx.var2 = setup.varB
    ctx.pValue = result.p
    ctx.significant = result.significant
    ctx.distributionTable = result.row_percentages || result.contingency || {}
  } else if (kind === 'corr') {
    const pair = result.strongest_pair
    ctx.testType = 'correlation'
    ctx.varA = pair?.var_a
    ctx.varB = pair?.var_b
    ctx.r = pair?.r
    ctx.pValue = pair?.p
    ctx.significant = pair?.p < 0.05
    ctx.targetVariable = setup.measure || pair?.var_b
  }
  return ctx
}

export function WhatThisMeans({ kind, result, setup }) {
  const data = buildWhatThisMeans(kind, result, setup)
  return (
    <div style={{ padding: '14px 16px', background: '#FAFAF9', borderLeft: `4px solid ${data.accent}`, borderRadius: 10, marginBottom: 16 }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: '#78716c', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>
        What this means
      </p>
      <p style={{ fontSize: 13, fontWeight: 600, color: '#1c1917', margin: '0 0 10px', lineHeight: 1.5 }}>
        {data.verdict}
      </p>

      {data.table && (
        <div style={{ marginBottom: 10 }}>
          {data.table.map((row) => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, borderBottom: '1px solid #f5f5f4' }}>
              <span style={{ color: '#57534e' }}>{row.label}</span>
              <span style={{ fontWeight: 600, color: '#1c1917', fontFamily: 'var(--font-mono)' }}>{row.value}</span>
            </div>
          ))}
        </div>
      )}

      {data.rankedGroups && (
        <div style={{ marginBottom: 10 }}>
          {data.rankedGroups.map((g) => (
            <div key={g.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12 }}>
              <span style={{ width: 24, textAlign: 'center' }}>{g.medal}</span>
              <span style={{ flex: 1, fontWeight: 500, color: '#1c1917' }}>{g.label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: '#57534e' }}>{g.value}</span>
            </div>
          ))}
          {data.rangeText && (
            <p style={{ fontSize: 11, color: '#78716c', margin: '6px 0 0', fontStyle: 'italic' }}>{data.rangeText}</p>
          )}
        </div>
      )}

      {data.distTable && (
        <div style={{ marginBottom: 10, overflow: 'auto' }}>
          <table style={{ fontSize: 11, borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid #e7e5e4' }}></th>
                {data.distTable.cols.map((c) => (
                  <th key={c} style={{ padding: '4px 8px', textAlign: 'center', borderBottom: '1px solid #e7e5e4', fontWeight: 600, color: '#57534e' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.distTable.rows.map((r) => (
                <tr key={r}>
                  <td style={{ padding: '4px 8px', fontWeight: 500, color: '#1c1917' }}>{r}</td>
                  {data.distTable.cols.map((c) => (
                    <td key={c} style={{ padding: '4px 8px', textAlign: 'center', color: '#57534e' }}>
                      {fmt(data.distTable.data[r]?.[c])}
                      <span style={{ color: '#a8a29e', marginLeft: 2 }}>({fmt(data.distTable.percentages?.[r]?.[c])}%)</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.plainInterp && (
        <p style={{ fontSize: 12, color: '#57534e', margin: '8px 0 0', fontStyle: 'italic' }}>{data.plainInterp}</p>
      )}

      {data.stats && (
        <div style={{ marginTop: 8 }}>
          {data.stats.map((s) => (
            <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
              <span style={{ color: '#78716c' }}>{s.label}</span>
              <span style={{ fontWeight: 600, color: '#1c1917' }}>{s.value}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 10, padding: '8px 10px', background: '#fff', borderRadius: 8, border: '1px solid #e7e5e4' }}>
        <span style={{ fontSize: 12 }}>{data.canUse.icon}</span>
        <span style={{ fontSize: 12, color: '#44403c', marginLeft: 6 }}>{data.canUse.text}</span>
      </div>
    </div>
  )
}

export function DecisionTakeaway({ kind, result }) {
  const d = buildDecisionTakeaway(kind, result)
  return (
    <div style={{ padding: '14px 18px', background: 'linear-gradient(135deg, #1e1e2e, #2d2d44)', borderRadius: 10, marginBottom: 16 }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 10px' }}>
        Decision Takeaway
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#a8a29e' }}>Can help prediction?</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: d.color }}>{d.label}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#a8a29e' }}>Strength:</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: d.strengthColor }}>{d.strength}</span>
        </div>
      </div>
    </div>
  )
}

export function AnalysisAIExplain({ kind, result, setup, datasetId, dataset }) {
  const auth = useAuth()
  const [text, setText] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [show, setShow] = useState(false)

  const generate = useCallback(async () => {
    if (!datasetId || !show) return
    if (auth.isGuest) { auth.requireAccountForAI(); return }
    setLoading(true)
    setError(null)
    try {
      const context = buildAIContext(kind, result, setup, dataset)
      const question = `Explain this statistical result to a non-technical user in 2-3 sentences. Use the actual variable names and values. Be concrete and avoid jargon.`
      const r = await api.aiExplain(datasetId, `test-${kind}-explain`, context, question, result)
      setText(r?.explanation || 'No explanation returned.')
    } catch (err) {
      setError('Could not generate AI explanation.')
    } finally {
      setLoading(false)
    }
  }, [datasetId, kind, result, setup, dataset, show, auth])

  useEffect(() => {
    if (show && !text && !loading && !error) generate()
  }, [show, text, loading, error, generate])

  return (
    <div style={{ marginBottom: 16 }}>
      {!show ? (
        <button
          type="button"
          onClick={() => { if (auth.isGuest) { auth.requireAccountForAI(); return } setShow(true) }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8,
            border: '1.5px solid var(--color-border-secondary)',
            background: 'transparent', color: 'var(--color-text-secondary)',
            fontSize: 11, fontWeight: 600, cursor: 'pointer'
          }}
        >
          <Sparkles size={13} /> AI explain
        </button>
      ) : (
        <div style={{ padding: '14px 16px', background: '#FFF7ED', borderLeft: '4px solid #f97316', borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#C2410C', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
              AI Explanation
            </p>
            <button type="button" onClick={() => { setShow(false); setText(null); setError(null) }} style={{ background: 'none', border: 'none', color: '#a8a29e', cursor: 'pointer', fontSize: 11 }}>
              Close
            </button>
          </div>
          {loading ? (
            <div style={{ display: 'flex', gap: 6, padding: '4px 0' }}>
              <InlineSpinner label="Generating..." />
            </div>
          ) : error ? (
            <p style={{ margin: 0, color: '#b91c1c', fontSize: 12 }}>{error}</p>
          ) : (
            <p style={{ margin: 0, fontSize: 12, fontStyle: 'italic', lineHeight: 1.6, color: '#7c2d12' }}>
              <Sparkles size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              {text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function CorrelationHeatmap({ result, datasetId, dataset }) {
  const [selectedPair, setSelectedPair] = useState(null)
  const vars = result.variables || []
  const matrix = result.matrix || {}
  const pairs = result.pairs || []
  const topPairs = [...pairs].sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 5)

  const getColor = (val) => {
    const abs = Math.abs(val ?? 0)
    if (val >= 0) {
      const alpha = Math.min(1, abs * 1.2)
      return `rgba(249,115,22,${(alpha * 0.85).toFixed(2)})`
    }
    const alpha = Math.min(1, abs * 1.2)
    return `rgba(59,130,246,${(alpha * 0.85).toFixed(2)})`
  }

  const getTextColor = (val) => {
    const abs = Math.abs(val ?? 0)
    return abs > 0.5 ? '#fff' : '#1c1917'
  }

  const selected = selectedPair ? pairs.find((p) => (p.var_a === selectedPair[0] && p.var_b === selectedPair[1]) || (p.var_a === selectedPair[1] && p.var_b === selectedPair[0])) : null

  return (
    <div>
      <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px' }}>Correlation matrix</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 16 }}>
        <div style={{ overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ padding: '4px 6px', textAlign: 'left' }}></th>
                {vars.map((v) => (
                  <th key={v} style={{ padding: '4px 6px', textAlign: 'center', fontWeight: 600, color: '#57534e', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vars.map((r) => (
                <tr key={r}>
                  <td style={{ padding: '4px 6px', fontWeight: 500, color: '#1c1917', whiteSpace: 'nowrap' }}>{r}</td>
                  {vars.map((c) => {
                    const v = matrix[r]?.[c]
                    const bg = r === c ? '#f97316' : getColor(v)
                    const fg = r === c ? '#fff' : getTextColor(v)
                    const isSelected = selectedPair && ((selectedPair[0] === r && selectedPair[1] === c) || (selectedPair[0] === c && selectedPair[1] === r))
                    return (
                      <td
                        key={c}
                        onClick={() => { if (r !== c) setSelectedPair([r, c]) }}
                        style={{
                          padding: '4px 6px', textAlign: 'center', background: bg, color: fg,
                          borderRadius: isSelected ? 4 : 0,
                          outline: isSelected ? '2px solid #1c1917' : 'none',
                          cursor: r === c ? 'default' : 'pointer',
                          fontWeight: r === c ? 700 : 500,
                          transition: 'all .1s ease'
                        }}
                      >
                        {fmt(v)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 10, color: '#78716c' }}>
            <span>-1.0</span>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'linear-gradient(90deg, rgba(59,130,246,.85), #f5f5f4 50%, rgba(249,115,22,.85))' }} />
            <span>+1.0</span>
          </div>
          <p style={{ fontSize: 10, color: '#a8a29e', margin: '4px 0 0', textAlign: 'center' }}>Stronger color = stronger relationship</p>
        </div>

        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#57534e', margin: '0 0 8px' }}>Strongest relationships</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {topPairs.map((p) => {
              const r = p.r
              const isNeg = r < 0
              const pct = Math.min(100, Math.abs(r) * 100)
              return (
                <div
                  key={`${p.var_a}-${p.var_b}`}
                  onClick={() => setSelectedPair([p.var_a, p.var_b])}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, cursor: 'pointer', background: selectedPair?.[0] === p.var_a && selectedPair?.[1] === p.var_b ? '#FFF7ED' : 'transparent' }}
                >
                  <span style={{ fontSize: 10, color: '#78716c', width: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.var_a} ↔ {p.var_b}</span>
                  <div style={{ flex: 1, height: 5, background: '#f5f5f4', borderRadius: 3, overflow: 'hidden', minWidth: 30 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: isNeg ? '#3b82f6' : '#f97316', borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono)', color: isNeg ? '#3b82f6' : '#f97316', width: 36, textAlign: 'right' }}>{fmt(r)}</span>
                </div>
              )
            })}
          </div>

          {selected && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: '#FAFAF9', borderRadius: 8, border: '1px solid #e7e5e4' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#1c1917', margin: '0 0 4px' }}>
                {selected.var_a} ↔ {selected.var_b}
              </p>
              <p style={{ fontSize: 11, color: '#57534e', margin: '0 0 4px' }}>
                r = {fmt(selected.r)} ({corrStrengthLabel(selected.r)})
              </p>
              <p style={{ fontSize: 10, color: '#78716c', margin: 0 }}>
                p = {fmt(selected.p)} · n = {selected.n}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export { buildAIContext }
