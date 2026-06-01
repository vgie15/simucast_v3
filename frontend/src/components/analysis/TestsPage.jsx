/* ============================================================
 * PAGE: STATISTICAL TESTS
 * Keywords: tests, t-test, anova, chi-square, correlation, pearson, scatter
 * ============================================================ */
import React, { useEffect, useState } from 'react'
import { Scatter } from 'react-chartjs-2'
import { api } from '../../api'
import { AIInsightCard, ExplainButton } from '../ai/AIExplainers'
import { WhatThisMeans, DecisionTakeaway, AnalysisAIExplain, CorrelationHeatmap } from './AnalysisExplainPanel'
import { useDialog } from '../common/DialogProvider'
import { BusyOverlay, InlineSpinner, SkeletonCards } from '../common/LoadingStates'
import HelpButton from '../common/HelpButton'

const testsPageCache = new Map()

const TESTS = [
  {
    key: 't',
    label: 'Independent t-test',
    summary: 'Compare the average of one numeric measure across exactly two groups.',
    use: 'Use when the group variable has two categories and the measure is numeric.',
    tells: 'How strongly variables move together',
    avoid: 'Avoid when there are more than two groups; use ANOVA instead.',
  },
  {
    key: 'anova',
    label: 'ANOVA',
    summary: 'Compare the average of one numeric measure across three or more groups.',
    use: 'Use when the group variable has multiple categories and the measure is numeric.',
    tells: 'Which group means differ and by how much',
    avoid: 'Avoid when you only have two groups; a t-test is simpler.',
  },
  {
    key: 'chi',
    label: 'Chi-square',
    summary: 'Test whether two categorical variables are associated.',
    use: 'Use when both variables are categorical.',
    tells: 'Whether category distributions differ from independence',
    avoid: 'Avoid when expected table counts are very low.',
  },
  {
    key: 'corr',
    label: 'Correlation',
    summary: 'Measure direction and strength of numeric relationships.',
    use: 'Use when selected variables are numeric.',
    tells: 'How strongly variables move together',
    avoid: 'Avoid interpreting correlation as causation.',
  },
]

export default function TestsPage({ dataset, initialData }) {
  const dialog = useDialog()
  const [kind, setKind] = useState('t')
  const [group, setGroup] = useState('')
  const [measure, setMeasure] = useState('')
  const [varA, setVarA] = useState('')
  const [varB, setVarB] = useState('')
  const [corrVars, setCorrVars] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const variables = dataset?.variables || []
  const numericVars = variables.filter((v) => ['numeric', 'int', 'float', 'binary'].includes(v.dtype))
  const categoricalVars = variables.filter((v) => ['category', 'binary'].includes(v.dtype))
  const selectedTest = TESTS.find((t) => t.key === kind) || TESTS[0]
  const canRun = kind === 'corr' ? corrVars.length >= 2 : kind === 'chi' ? varA && varB : group && measure
  const pairRecs = recommendedTestPairs(kind, numericVars, categoricalVars)

  useEffect(() => {
    if (!dataset?.id) return
    let alive = true
    if (initialData?.tab === 'tests' && initialData?.datasetId === dataset.id && initialData.analyses) {
      const latest = (initialData.analyses.analyses || []).find((a) => {
        const k = String(a.kind || '')
        return k.startsWith('test_') && k !== 'test_corr'
      })
      if (latest) {
        const restoredKind = String(latest.kind || '').replace(/^test_/, '').replace('analysis_corr', 'corr')
        const config = latest.config || {}
        setKind(restoredKind || 't')
        setResult(latest.result || null)
        setGroup(config.group || '')
        setMeasure(config.measure || '')
        setVarA(config.var_a || '')
        setVarB(config.var_b || '')
        setCorrVars(config.variables || [])
      } else {
        setResult(null)
      }
      setRestoring(false)
      return
    }
    const ck = `${dataset.id}|${dataset.current_stage_id}`
    const cached = testsPageCache.get(ck)
    if (cached) {
      setKind(cached.kind)
      setResult(cached.result)
      setGroup(cached.group)
      setMeasure(cached.measure)
      setVarA(cached.varA)
      setVarB(cached.varB)
      setCorrVars(cached.corrVars)
      setRestoring(false)
      return
    }
    setRestoring(true)
    api.listAnalyses(dataset.id, '', 20)
      .then((r) => {
        if (!alive) return
        const latest = (r.analyses || []).find((a) => {
          const k = String(a.kind || '')
          return k.startsWith('test_') && k !== 'test_corr'
        })
        if (!latest) {
          setResult(null)
          return
        }
        const restoredKind = String(latest.kind || '').replace(/^test_/, '')
        const config = latest.config || {}
        const state = {
          kind: restoredKind || 't',
          result: latest.result || null,
          group: config.group || '',
          measure: config.measure || '',
          varA: config.var_a || '',
          varB: config.var_b || '',
          corrVars: config.variables || [],
        }
        testsPageCache.set(ck, state)
        setKind(state.kind)
        setResult(state.result)
        setGroup(state.group)
        setMeasure(state.measure)
        setVarA(state.varA)
        setVarB(state.varB)
        setCorrVars(state.corrVars)
      })
      .finally(() => {
        if (alive) setRestoring(false)
      })
    return () => {
      alive = false
    }
  }, [dataset?.id, dataset?.current_stage_id])

  useEffect(() => {
    const raw = window.sessionStorage.getItem('simucast.fixTarget')
    if (!raw) return
    let target = null
    try {
      target = JSON.parse(raw)
    } catch {
      return
    }
    if (target?.page !== 'tests') return
    window.sessionStorage.removeItem('simucast.fixTarget')
    if (target.section === 'fix-correlation-test') {
      setKind('corr')
      setCorrVars((current) => current.length >= 2 ? current : numericVars.slice(0, 4).map((v) => v.name))
    }
    setTimeout(() => highlightSection(target.section), 180)
  }, [dataset?.id])

  if (!dataset) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>

  const run = async () => {
    if (!canRun) return
    setLoading(true)
    setResult(null)
    try {
      let body = { kind }
      if (kind === 't' || kind === 'anova') body = { kind, group, measure }
      if (kind === 'chi') body = { kind, var_a: varA, var_b: varB }
      if (kind === 'corr') body = { kind: 'analysis_corr', variables: corrVars }
      const r = await api.runTest(dataset.id, body)
      setResult(r)
    } catch (err) {
      await dialog.alert({ title: 'Test Failed', message: err.message, variant: 'danger' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="ax-test-layout">
      {/* LEFT COLUMN */}
      <div className="ax-test-left">
        {/* Header: title + subtitle only — separator line sits right below */}
        <div className="ax-test-left-sticky">
          <h1 className="ax-test-title">Statistical Analysis</h1>
          <p className="ax-test-sub">Evaluate relationships, compare groups, and turn results into decisions</p>
        </div>

        {/* Pinned context block: test type picker + info — always visible, never scrolls */}
        <div className="ax-test-left-context">
          <p className="ax-test-section-label">TEST TYPE</p>
          <div className="ax-test-pills">
            {TESTS.map((t) => (
              <button
                key={t.key}
                className={`ax-test-pill ${kind === t.key ? 'active' : ''}`}
                type="button"
                onClick={() => { setKind(t.key); setResult(null) }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="ax-test-info-box">
            <div className="ax-test-info-row">
              <span className="ax-test-info-key">Use when:</span>
              <span className="ax-test-info-val">{selectedTest.use}</span>
            </div>
            <div className="ax-test-info-row">
              <span className="ax-test-info-key">Tells you:</span>
              <span className="ax-test-info-val">{selectedTest.tells}</span>
            </div>
            <div className="ax-test-info-row">
              <span className="ax-test-info-key">Avoid:</span>
              <span className="ax-test-info-val">{selectedTest.avoid}</span>
            </div>
          </div>
        </div>

        <div className="ax-test-left-scroll">
          <p className="ax-test-section-label">VARIABLES</p>
          {(kind === 't' || kind === 'anova') && (
            <div className="ax-test-selects">
              <div className="ax-test-select-group">
                <label className="ax-test-select-label">Group variable (categorical)</label>
                <select className="ax-test-select" value={group} onChange={(e) => setGroup(e.target.value)}>
                  <option value="">- select -</option>
                  {categoricalVars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                </select>
              </div>
              <div className="ax-test-select-group">
                <label className="ax-test-select-label">Measure variable (numeric)</label>
                <select className="ax-test-select" value={measure} onChange={(e) => setMeasure(e.target.value)}>
                  <option value="">- select -</option>
                  {numericVars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                </select>
              </div>
            </div>
          )}
          {kind === 'chi' && (
            <div className="ax-test-selects">
              <div className="ax-test-select-group">
                <label className="ax-test-select-label">Category variable A</label>
                <select className="ax-test-select" value={varA} onChange={(e) => setVarA(e.target.value)}>
                  <option value="">- select -</option>
                  {categoricalVars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                </select>
              </div>
              <div className="ax-test-select-group">
                <label className="ax-test-select-label">Category variable B</label>
                <select className="ax-test-select" value={varB} onChange={(e) => setVarB(e.target.value)}>
                  <option value="">- select -</option>
                  {categoricalVars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                </select>
              </div>
            </div>
          )}
          {kind === 'corr' && (
            <>
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 6px' }}>Pick at least two</p>
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

          {pairRecs.length > 0 && (
            <div className="ax-test-rec-row">
              <span className="ax-test-rec-text">
                Recommended: <strong>{pairRecs[0].label}</strong>
              </span>
              <button
                className="ax-test-rec-link"
                type="button"
                onClick={() => {
                  if (kind === 'corr') setCorrVars(pairRecs[0].variables)
                  if (kind === 'chi') { setVarA(pairRecs[0].varA); setVarB(pairRecs[0].varB) }
                  if (kind === 't' || kind === 'anova') { setGroup(pairRecs[0].group); setMeasure(pairRecs[0].measure) }
                }}
              >
                Use this →
              </button>
            </div>
          )}
        </div>

        <div className="ax-test-run-area">
          {loading && <div className="ax-test-loading-bar"><div className="ax-test-loading-fill" /></div>}
          <button className="ax-test-run-btn" disabled={loading || !canRun} onClick={run}>
            {loading ? <InlineSpinner label="Running test..." /> : '▶ Run test'}
          </button>
        </div>
      </div>

      {/* RIGHT COLUMN */}
      <div className="ax-test-right">
        <div id="fix-correlation-test" className="ax-test-right-scroll">
          {(!result && !loading && !restoring) && (
            <div className="ax-test-empty">
              <div className="ax-test-empty-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              </div>
              <p className="ax-test-empty-text">Configure the test and click Run</p>
            </div>
          )}

          {(loading || restoring) && !result && (
            <div style={{ padding: '20px 0' }}>
              <SkeletonCards count={2} />
            </div>
          )}

          {result && (
            <TestResult kind={kind} result={result} setup={{ group, measure, varA, varB, corrVars }} datasetId={dataset.id} />
          )}
        </div>
      </div>
    </div>
  )
}

function highlightSection(section) {
  const el = document.getElementById(section)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ax-fix-highlight')
  window.setTimeout(() => el.classList.remove('ax-fix-highlight'), 2600)
}

function recommendedTestPairs(kind, numericVars = [], categoricalVars = []) {
  const nums = numericVars.map((v) => v.name)
  const cats = categoricalVars.map((v) => v.name)
  if (kind === 'corr') {
    const preferred = nums.filter((name) => /score|gpa|rate|hours|income|age/i.test(name)).slice(0, 4)
    const variables = preferred.length >= 2 ? preferred : nums.slice(0, 4)
    return variables.length >= 2 ? [{ label: variables.slice(0, 3).join(' + '), variables }] : []
  }
  if (kind === 'chi') {
    const pairs = []
    for (let i = 0; i < cats.length; i += 1) {
      for (let j = i + 1; j < cats.length; j += 1) {
        pairs.push({ label: `${cats[i]} + ${cats[j]}`, varA: cats[i], varB: cats[j] })
      }
    }
    return pairs.slice(0, 1)
  }
  const groups = categoricalVars
    .filter((v) => kind === 't' ? Number(v.unique || 0) === 2 || v.dtype === 'binary' : Number(v.unique || 0) !== 2)
    .map((v) => v.name)
  const groupList = groups.length ? groups : cats
  return groupList.slice(0, 1).flatMap((g) => nums.slice(0, 1).map((m) => ({
    label: `${m} + ${g}`,
    group: g,
    measure: m,
  }))).slice(0, 1)
}

function TestResult({ kind, result, setup, datasetId }) {
  const summary = summarizeResult(kind, result, setup)
  const stepName = `test-${kind}`
  const sig = summary.significant

  return (
    <div className="ax-test-results">
      {/* Section A — Metrics Row */}
      <div className="ax-test-metrics">
        <div className="ax-test-metric-card hero">
          <div className="ax-test-metric-accent hero-accent" />
          <p className="ax-test-metric-label">STRONGEST PAIR</p>
          <p className="ax-test-metric-value hero-value">{summary.metrics[0]?.value || '-'}</p>
        </div>
        <div className={`ax-test-metric-card ${sig ? 'sig' : 'not-sig'}`}>
          <div className={`ax-test-metric-accent ${sig ? 'sig-accent' : 'not-sig-accent-r'}`} />
          <p className="ax-test-metric-label">R VALUE</p>
          <p className="ax-test-metric-value">{summary.metrics[1]?.value || '-'}</p>
          <p className="ax-test-metric-sub">Pearson correlation</p>
        </div>
        <div className={`ax-test-metric-card ${sig ? 'sig' : 'not-sig'}`}>
          <div className={`ax-test-metric-accent ${sig ? 'sig-accent' : 'not-sig-accent-gray'}`} />
          <p className="ax-test-metric-label">P VALUE</p>
          <p className="ax-test-metric-value">{summary.metrics[2]?.value || '-'}</p>
          <p className="ax-test-metric-sub">α = 0.05 threshold</p>
        </div>
        <div className={`ax-test-metric-card ${sig ? 'sig' : 'not-sig'}`}>
          <div className={`ax-test-metric-accent ${sig ? 'sig-accent' : 'not-sig-accent-slate'}`} />
          <p className="ax-test-metric-label">STRENGTH</p>
          <p className="ax-test-metric-value">{summary.metrics[3]?.value || '-'}</p>
        </div>
      </div>

      {/* Section B — Verdict */}
      <div className={`ax-test-verdict ${sig ? 'verdict-sig' : 'verdict-not-sig'}`}>
        <div className={`ax-test-verdict-bar ${sig ? 'verdict-bar-sig' : 'verdict-bar-not-sig'}`} />
        <div className="ax-test-verdict-left">
          <div className={`ax-test-verdict-icon ${sig ? 'verdict-icon-sig' : 'verdict-icon-not-sig'}`}>
            {sig ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            )}
          </div>
          <div>
            <p className="ax-test-verdict-text">{summary.verdict}</p>
            <p className="ax-test-verdict-sub">{summary.decision}</p>
          </div>
        </div>
        <span className={`ax-test-verdict-badge ${sig ? 'badge-sig' : 'badge-not-sig'}`}>
          {sig ? 'Significant' : 'Not significant'}
        </span>
      </div>

      {/* Section 1 — What This Means */}
      <WhatThisMeans kind={kind} result={result} setup={setup} />

      {/* Section 2 — Decision Takeaway */}
      <DecisionTakeaway kind={kind} result={result} />

      {/* Section 3 — AI Explain */}
      <AnalysisAIExplain kind={kind} result={result} setup={setup} datasetId={datasetId} dataset={null} />

      {/* Supplementary charts for non-corr tests */}
      {kind === 't' && <GroupMeanBars means={[
        { label: result.group_labels?.[0] || 'Group 1', value: result.mean_group_1 },
        { label: result.group_labels?.[1] || 'Group 2', value: result.mean_group_2 },
      ]} measure={setup.measure} />}
      {kind === 'anova' && <GroupMeanBars means={Object.entries(result.group_means || {}).map(([label, value]) => ({ label, value }))} measure={setup.measure} />}
      {kind === 'chi' && <ContingencyTable result={result} />}
      {kind === 'corr' && (
        <>
          <CorrelationScatter result={result} />
          <CorrelationHeatmap result={result} datasetId={datasetId} />
        </>
      )}
    </div>
  )
}

function CorrelationScatter({ result }) {
  const pair = result.strongest_pair
  const vars = result.variables || []
  const points = result.scatter_points || []
  if (!pair || vars.length !== 2 || points.length === 0) return null

  const chartPoints = points.map(([x, y]) => ({ x: Number(x), y: Number(y) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  if (!chartPoints.length) return null
  const xs = chartPoints.map((p) => p.x)
  const ys = chartPoints.map((p) => p.y)
  const xMean = avg(xs)
  const yMean = avg(ys)
  const denom = xs.reduce((sum, x) => sum + ((x - xMean) ** 2), 0) || 1
  const slope = xs.reduce((sum, x, i) => sum + ((x - xMean) * (ys[i] - yMean)), 0) / denom
  const intercept = yMean - slope * xMean
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const trend = [
    { x: minX, y: intercept + slope * minX },
    { x: maxX, y: intercept + slope * maxX },
  ]

  return (
    <div className="ax-test-scatter">
      <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 4px' }}>Relationship scatter plot</p>
      <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>
        {vars[0]} and {vars[1]}. The line shows the overall trend.
      </p>
      <div style={{ height: 200 }}>
        <Scatter
          data={{
            datasets: [
              { label: 'Rows', data: chartPoints, backgroundColor: 'rgba(249,115,22,0.45)', pointRadius: 2.5 },
              { label: 'Trend', data: trend, type: 'line', borderColor: '#111827', borderWidth: 2, pointRadius: 0, showLine: true },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { title: { display: true, text: vars[0], font: { size: 10 } }, ticks: { font: { size: 9 } } },
              y: { title: { display: true, text: vars[1], font: { size: 10 } }, ticks: { font: { size: 9 } } },
            },
          }}
        />
      </div>
    </div>
  )
}

function GroupMeanBars({ means, measure }) {
  const max = Math.max(...means.map((m) => Math.abs(Number(m.value) || 0)), 1)
  return (
    <div className="ax-test-mean-bars">
      <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px' }}>Group mean comparison</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {means.map((m) => (
          <div key={m.label} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 60px', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span title={m.label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
            <span style={{ height: 7, background: 'var(--color-background-secondary)', borderRadius: 4, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${Math.min(100, Math.abs(Number(m.value) || 0) / max * 100)}%`, background: '#7F77DD' }} />
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{fmt(m.value)}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 10, color: 'var(--color-text-secondary)', margin: '6px 0 0' }}>Higher bars = higher average {measure}</p>
    </div>
  )
}

function ContingencyTable({ result }) {
  const rows = Object.keys(result.contingency || {})
  const cols = rows.length ? Object.keys(result.contingency[rows[0]] || {}) : []
  return (
    <div className="ax-test-contingency">
      <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 6px' }}>Contingency table</p>
      <div style={{ overflow: 'auto' }}>
        <table className="ax-tbl">
          <thead>
            <tr><th></th>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <td style={{ fontWeight: 500 }}>{r}</td>
                {cols.map((c) => (
                  <td key={c}>
                    {result.contingency[r]?.[c] ?? 0}
                    <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 4 }}>({fmt(result.row_percentages?.[r]?.[c])}%)</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function summarizeResult(kind, result, setup) {
  if (kind === 't') {
    const diff = Number(result.mean_group_1) - Number(result.mean_group_2)
    const effect = effectLabel(Math.abs(result.cohens_d), [0.2, 0.5, 0.8])
    const higher = diff >= 0 ? result.group_labels?.[0] : result.group_labels?.[1]
    return {
      significant: !!result.significant,
      verdict: result.significant ? 'Significant relationship found' : 'No significant relationship found',
      decision: result.significant
        ? `Reject the null hypothesis (p = ${fmt(result.p)} < 0.05)`
        : `Fail to reject the null hypothesis (p = ${fmt(result.p)} > 0.05)`,
      metrics: [
        { label: 'strongest pair', value: `${setup.group} / ${setup.measure}` },
        { label: 'r', value: fmt(result.cohens_d) },
        { label: 'p value', value: fmt(result.p) },
        { label: 'strength', value: effect },
      ],
      conclusion: result.significant
        ? `There is evidence that average ${setup.measure} differs by ${setup.group}. ${higher} has the higher observed mean.`
        : `The observed mean difference in ${setup.measure} by ${setup.group} was not statistically strong enough at p < 0.05.`,
      predictive: `${setup.group} can be used as a simple, non-model indicator of expected ${setup.measure}: the observed group mean difference is ${fmt(diff)}.`,
    }
  }
  if (kind === 'anova') {
    const means = Object.entries(result.group_means || {}).sort((a, b) => Number(b[1]) - Number(a[1]))
    const effect = effectLabel(Number(result.eta_squared), [0.01, 0.06, 0.14])
    return {
      significant: !!result.significant,
      verdict: result.significant ? 'Significant group differences' : 'No significant group differences',
      decision: result.significant
        ? `Reject the null hypothesis (p = ${fmt(result.p)} < 0.05)`
        : `Fail to reject the null hypothesis (p = ${fmt(result.p)} > 0.05)`,
      metrics: [
        { label: 'strongest pair', value: `${setup.group} / ${setup.measure}` },
        { label: 'r', value: fmt(result.eta_squared) },
        { label: 'p value', value: fmt(result.p) },
        { label: 'strength', value: effect },
      ],
      conclusion: result.significant
        ? `At least one ${setup.group} category has a different average ${setup.measure}. Highest: ${means[0]?.[0] || 'the leading group'}.`
        : `The average ${setup.measure} does not show a statistically significant difference across ${setup.group} groups.`,
      predictive: `${setup.group} gives a simple expectation signal for ${setup.measure}; compare group means to see which categories tend to be higher or lower.`,
    }
  }
  if (kind === 'chi') {
    const effect = effectLabel(Number(result.cramers_v), [0.1, 0.3, 0.5])
    return {
      significant: !!result.significant,
      verdict: result.significant ? 'Significant association found' : 'No significant association',
      decision: result.significant
        ? `Reject the null hypothesis (p = ${fmt(result.p)} < 0.05)`
        : `Fail to reject the null hypothesis (p = ${fmt(result.p)} > 0.05)`,
      metrics: [
        { label: 'strongest pair', value: `${setup.varA} / ${setup.varB}` },
        { label: 'r', value: fmt(result.cramers_v) },
        { label: 'p value', value: fmt(result.p) },
        { label: 'strength', value: effect },
      ],
      conclusion: result.significant
        ? `There is evidence that ${setup.varA} and ${setup.varB} are associated. Category percentages differ more than expected by chance.`
        : `There is not enough evidence to say ${setup.varA} and ${setup.varB} are associated at p < 0.05.`,
      predictive: `Use the contingency percentages as a simple probability-style guide: each row shows how ${setup.varB} tends to distribute within ${setup.varA}.`,
    }
  }
  const pair = result.strongest_pair
  const r = pair?.r ?? 0
  const strength = corrStrength(Math.abs(r))
  return {
    significant: pair ? pair.p < 0.05 : false,
    verdict: pair ? (pair.p < 0.05 ? 'Significant relationship found' : 'No significant relationship found') : 'No pairs computed',
    decision: pair
      ? (pair.p < 0.05
        ? `Reject the null hypothesis (p = ${fmt(pair.p)} < 0.05)`
        : `Fail to reject the null hypothesis (p = ${fmt(pair.p)} > 0.05)`)
      : 'Select at least two numeric variables.',
    metrics: [
      { label: 'strongest pair', value: pair ? `${pair.var_a} / ${pair.var_b}` : '-' },
      { label: 'r', value: fmt(r) },
      { label: 'p value', value: pair ? fmt(pair.p) : '-' },
      { label: 'strength', value: strength },
    ],
    conclusion: pair
      ? `${pair.var_a} and ${pair.var_b} show the strongest relationship among selected variables. Direction is ${r >= 0 ? 'positive' : 'negative'}, strength is ${strength}.`
      : 'No pairwise correlation could be computed.',
    predictive: pair
      ? `As ${pair.var_a} ${r >= 0 ? 'increases' : 'increases'}, ${pair.var_b} tends to ${r >= 0 ? 'increase' : 'decrease'}. This is association, not a full model prediction.`
      : 'Select at least two numeric variables to produce trend-style insight.',
  }
}

function effectLabel(value, cutoffs) {
  if (value >= cutoffs[2]) return 'large'
  if (value >= cutoffs[1]) return 'moderate'
  if (value >= cutoffs[0]) return 'small'
  return 'very small'
}

function avg(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
}

function corrStrength(value) {
  if (value >= 0.7) return 'strong'
  if (value >= 0.4) return 'moderate'
  if (value >= 0.2) return 'weak'
  return 'very weak'
}

function fmt(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '-'
  if (typeof v !== 'number') return v
  if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(2)
  return v.toFixed(3)
}
