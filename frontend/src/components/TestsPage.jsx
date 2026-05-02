import React, { useState } from 'react'
import { api } from '../api'
import AIAssistantPanel from './AIAssistantPanel'
import AdvancedPage from './AdvancedPage'

const TESTS = [
  { key: 't', label: 'Independent t-test', needs: ['group', 'measure'] },
  { key: 'anova', label: 'ANOVA', needs: ['group', 'measure'] },
  { key: 'chi', label: 'Chi-square', needs: ['var_a', 'var_b'] },
  { key: 'corr', label: 'Correlation', needs: ['variables'] },
]

export default function TestsPage({ dataset }) {
  const [kind, setKind] = useState('t')
  const [group, setGroup] = useState('')
  const [measure, setMeasure] = useState('')
  const [varA, setVarA] = useState('')
  const [varB, setVarB] = useState('')
  const [corrVars, setCorrVars] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  if (!dataset) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>

  const variables = dataset.variables || []
  const numericVars = variables.filter((v) => ['numeric', 'int', 'float', 'binary'].includes(v.dtype))
  const categoricalVars = variables.filter((v) => ['category', 'binary'].includes(v.dtype))

  const run = async () => {
    setLoading(true)
    setResult(null)
    try {
      let body = { kind }
      if (kind === 't' || kind === 'anova') body = { kind, group, measure }
      if (kind === 'chi') body = { kind, var_a: varA, var_b: varB }
      if (kind === 'corr') body = { kind, variables: corrVars }
      const r = await api.runTest(dataset.id, body)
      setResult(r)
    } catch (err) {
      alert('Test failed: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <h1 className="ax-page-title">Hypothesis testing</h1>
      <p className="ax-page-sub">Pick a test type, set the variables, and the backend runs scipy.</p>

      <AIAssistantPanel datasetId={dataset.id} context="tests" />

      <p className="ax-lbl">Test type</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {TESTS.map((t) => (
          <button key={t.key} className={`ax-pill ${kind === t.key ? 'active' : ''}`} onClick={() => { setKind(t.key); setResult(null) }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="ax-card" style={{ marginBottom: 12 }}>
        <p className="ax-lbl" style={{ marginTop: 0 }}>Setup</p>
        {(kind === 't' || kind === 'anova') && (
          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '10px 12px', alignItems: 'center', fontSize: 12 }}>
            <label style={{ color: 'var(--color-text-secondary)' }}>Group by</label>
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">— select —</option>
              {categoricalVars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
            <label style={{ color: 'var(--color-text-secondary)' }}>Measure</label>
            <select value={measure} onChange={(e) => setMeasure(e.target.value)}>
              <option value="">— select —</option>
              {numericVars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </div>
        )}
        {kind === 'chi' && (
          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '10px 12px', alignItems: 'center', fontSize: 12 }}>
            <label style={{ color: 'var(--color-text-secondary)' }}>Variable A</label>
            <select value={varA} onChange={(e) => setVarA(e.target.value)}>
              <option value="">— select —</option>
              {categoricalVars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
            <label style={{ color: 'var(--color-text-secondary)' }}>Variable B</label>
            <select value={varB} onChange={(e) => setVarB(e.target.value)}>
              <option value="">— select —</option>
              {categoricalVars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </div>
        )}
        {kind === 'corr' && (
          <>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 6px' }}>Pick numeric variables</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {numericVars.map((v) => (
                <span
                  key={v.name}
                  className={`ax-chip ${corrVars.includes(v.name) ? 'active' : ''}`}
                  onClick={() => setCorrVars(corrVars.includes(v.name) ? corrVars.filter((x) => x !== v.name) : [...corrVars, v.name])}
                >
                  {v.name}
                </span>
              ))}
            </div>
          </>
        )}
        <div style={{ marginTop: 12 }}>
          <button className="ax-btn prim" disabled={loading} onClick={run}>
            {loading ? 'Running…' : 'Run test'}
          </button>
        </div>
      </div>

      {result && <TestResult kind={kind} result={result} />}

      <div style={{ marginTop: 24 }}>
        <AdvancedPage dataset={dataset} embedded />
      </div>
    </>
  )
}

function TestResult({ kind, result }) {
  if (kind === 't') {
    const sig = result.significant
    return (
      <div className="ax-card" style={{ borderLeft: `3px solid ${sig ? '#1D9E75' : '#888'}` }}>
        <div className="ax-row" style={{ marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>t-test result</span>
          <span style={{
            fontSize: 10,
            padding: '2px 8px',
            background: sig ? 'var(--color-background-success)' : 'var(--color-background-secondary)',
            color: sig ? 'var(--color-text-success)' : 'var(--color-text-secondary)',
            borderRadius: 4,
          }}>
            {sig ? 'Significant' : 'Not significant'}
          </span>
        </div>
        <Metrics items={[
          { label: 't statistic', value: fmt(result.t) },
          { label: 'p value', value: fmt(result.p) },
          { label: "Cohen's d", value: fmt(result.cohens_d) },
          { label: 'df', value: result.df },
        ]} />
        <Interpretation text={result.interpretation} />
      </div>
    )
  }
  if (kind === 'anova') {
    return (
      <div className="ax-card">
        <div className="ax-row" style={{ marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>ANOVA result</span>
          <span style={{
            fontSize: 10, padding: '2px 8px',
            background: result.significant ? 'var(--color-background-success)' : 'var(--color-background-secondary)',
            color: result.significant ? 'var(--color-text-success)' : 'var(--color-text-secondary)',
            borderRadius: 4,
          }}>
            {result.significant ? 'Significant' : 'Not significant'}
          </span>
        </div>
        <Metrics items={[
          { label: 'F statistic', value: fmt(result.f) },
          { label: 'p value', value: fmt(result.p) },
          { label: 'groups', value: result.groups },
        ]} />
        <Interpretation text={result.interpretation} />
      </div>
    )
  }
  if (kind === 'chi') {
    return (
      <div className="ax-card">
        <div className="ax-row" style={{ marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Chi-square result</span>
          <span style={{
            fontSize: 10, padding: '2px 8px',
            background: result.significant ? 'var(--color-background-success)' : 'var(--color-background-secondary)',
            color: result.significant ? 'var(--color-text-success)' : 'var(--color-text-secondary)',
            borderRadius: 4,
          }}>
            {result.significant ? 'Significant' : 'Not significant'}
          </span>
        </div>
        <Metrics items={[
          { label: 'χ² statistic', value: fmt(result.chi2) },
          { label: 'p value', value: fmt(result.p) },
          { label: 'df', value: result.df },
        ]} />
        <Interpretation text={result.interpretation} />
      </div>
    )
  }
  if (kind === 'corr') {
    const vars = result.variables
    return (
      <div className="ax-card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="ax-tbl">
          <thead>
            <tr><th></th>{vars.map((v) => <th key={v}>{v}</th>)}</tr>
          </thead>
          <tbody>
            {vars.map((r) => (
              <tr key={r}>
                <td style={{ fontWeight: 500 }}>{r}</td>
                {vars.map((c) => {
                  const v = result.matrix[r]?.[c]
                  const abs = Math.abs(v ?? 0)
                  const bg = abs > 0.7 ? '#EEEDFE' : abs > 0.4 ? '#F5F2FB' : 'transparent'
                  return <td key={c} style={{ background: bg, textAlign: 'center' }}>{fmt(v)}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return null
}

function Metrics({ items }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 6, marginBottom: 10 }}>
      {items.map((m) => (
        <div key={m.label} style={{ background: 'var(--color-background-secondary)', borderRadius: 6, padding: '8px 10px' }}>
          <p style={{ fontSize: 10, color: 'var(--color-text-secondary)', margin: 0 }}>{m.label}</p>
          <p style={{ fontSize: 14, fontWeight: 500, margin: '2px 0 0' }}>{m.value}</p>
        </div>
      ))}
    </div>
  )
}

function Interpretation({ text }) {
  return (
    <div style={{ background: 'var(--color-accent-light)', borderRadius: 6, padding: '8px 10px', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
        <path d="M7 1L8.3 5.1L12.5 6L8.3 8.2L7 13L5.7 8.2L1.5 6L5.7 5.1L7 1Z" fill="var(--color-accent-dark)" />
      </svg>
      <p style={{ fontSize: 11, color: 'var(--color-accent-dark)', margin: 0, lineHeight: 1.5 }}>{text}</p>
    </div>
  )
}

function fmt(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v !== 'number') return v
  if (Math.abs(v) < 0.001) return v.toExponential(2)
  return v.toFixed(3)
}
