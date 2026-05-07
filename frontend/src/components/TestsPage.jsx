import React, { useEffect, useState } from 'react'
import { Scatter } from 'react-chartjs-2'
import { api } from '../api'
import { AIInsightCard, ExplainButton } from './AIExplainers'
import { useDialog } from './DialogProvider'
import { BusyOverlay, InlineSpinner, SkeletonCards } from './LoadingStates'

const TESTS = [
  {
    key: 't',
    label: 'Independent t-test',
    summary: 'Compare the average of one numeric measure across exactly two groups.',
    use: 'Use when the group variable has two categories and the measure is numeric.',
    avoid: 'Avoid when there are more than two groups; use ANOVA instead.',
  },
  {
    key: 'anova',
    label: 'ANOVA',
    summary: 'Compare the average of one numeric measure across three or more groups.',
    use: 'Use when the group variable has multiple categories and the measure is numeric.',
    avoid: 'Avoid when you only have two groups; a t-test is simpler.',
  },
  {
    key: 'chi',
    label: 'Chi-square',
    summary: 'Test whether two categorical variables are associated.',
    use: 'Use when both variables are categorical.',
    avoid: 'Avoid when expected table counts are very low.',
  },
  {
    key: 'corr',
    label: 'Correlation',
    summary: 'Measure direction and strength of numeric relationships.',
    use: 'Use when selected variables are numeric.',
    avoid: 'Avoid interpreting correlation as causation.',
  },
]

export default function TestsPage({ dataset }) {
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
    setRestoring(true)
    api.listAnalyses(dataset.id, '', 20)
      .then((r) => {
        if (!alive) return
        const latest = (r.analyses || []).find((a) => String(a.kind || '').startsWith('test_'))
        if (!latest) {
          setResult(null)
          return
        }
        const restoredKind = String(latest.kind || '').replace(/^test_/, '')
        const config = latest.config || {}
        setKind(restoredKind || 't')
        setResult(latest.result || null)
        setGroup(config.group || '')
        setMeasure(config.measure || '')
        setVarA(config.var_a || '')
        setVarB(config.var_b || '')
        setCorrVars(config.variables || [])
      })
      .finally(() => {
        if (alive) setRestoring(false)
      })
    return () => {
      alive = false
    }
  }, [dataset?.id])

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
      if (kind === 'corr') body = { kind, variables: corrVars }
      const r = await api.runTest(dataset.id, body)
      setResult(r)
    } catch (err) {
      await dialog.alert({ title: 'Test Failed', message: err.message, variant: 'danger' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <h1 className="ax-page-title">Statistical Analysis</h1>
      <p className="ax-page-sub">Evaluate relationships, compare groups, and turn statistical results into decisions.</p>

      <p className="ax-lbl">Test type</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8, marginBottom: 14 }}>
        {TESTS.map((t) => (
          <button
            key={t.key}
            className={`ax-card ${kind === t.key ? 'active' : ''}`}
            onClick={() => { setKind(t.key); setResult(null) }}
            style={{
              textAlign: 'left',
              border: kind === t.key ? '1px solid var(--color-accent)' : '0.5px solid var(--color-border-tertiary)',
              background: kind === t.key ? 'var(--color-accent-light)' : undefined,
            }}
          >
            <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{t.label}</span>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 3 }}>{t.summary}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(280px, 0.85fr)', gap: 12, marginBottom: 12 }}>
        <div id="fix-correlation-test" className={`ax-card ax-busy-host ${loading ? 'is-busy' : ''}`}>
          <BusyOverlay
            active={loading}
            title="Running statistical test..."
            detail="Preparing variables, computing the result, and building interpretation-ready output."
          />
          <p className="ax-lbl" style={{ marginTop: 0 }}>Setup</p>
          {(kind === 't' || kind === 'anova') && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 170px) minmax(0, 1fr)', gap: '10px 12px', alignItems: 'center', fontSize: 12 }}>
              <label style={{ color: 'var(--color-text-secondary)' }}>Group variable (categorical)</label>
              <select value={group} onChange={(e) => setGroup(e.target.value)} style={{ minWidth: 0, width: '100%' }}>
                <option value="">- select -</option>
                {categoricalVars.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.dtype})</option>)}
              </select>
              <label style={{ color: 'var(--color-text-secondary)' }}>Measure variable (numeric)</label>
              <select value={measure} onChange={(e) => setMeasure(e.target.value)} style={{ minWidth: 0, width: '100%' }}>
                <option value="">- select -</option>
                {numericVars.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.dtype})</option>)}
              </select>
            </div>
          )}
          {kind === 'chi' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 170px) minmax(0, 1fr)', gap: '10px 12px', alignItems: 'center', fontSize: 12 }}>
              <label style={{ color: 'var(--color-text-secondary)' }}>Category variable A</label>
              <select value={varA} onChange={(e) => setVarA(e.target.value)} style={{ minWidth: 0, width: '100%' }}>
                <option value="">- select -</option>
                {categoricalVars.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.dtype})</option>)}
              </select>
              <label style={{ color: 'var(--color-text-secondary)' }}>Category variable B</label>
              <select value={varB} onChange={(e) => setVarB(e.target.value)} style={{ minWidth: 0, width: '100%' }}>
                <option value="">- select -</option>
                {categoricalVars.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.dtype})</option>)}
              </select>
            </div>
          )}
          {kind === 'corr' && (
            <>
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 6px' }}>Pick at least two numeric variables</p>
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
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', margin: '0 0 6px' }}>
                Recommended pairs <span style={{ color: 'var(--color-primary)' }}>System recommended</span>
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pairRecs.map((rec, idx) => (
                  <button
                    key={`${rec.label}-${idx}`}
                    type="button"
                    className="ax-card"
                    style={{ padding: '7px 9px', textAlign: 'left', cursor: 'pointer' }}
                    onClick={() => {
                      if (kind === 'corr') setCorrVars(rec.variables)
                      if (kind === 'chi') { setVarA(rec.varA); setVarB(rec.varB) }
                      if (kind === 't' || kind === 'anova') { setGroup(rec.group); setMeasure(rec.measure) }
                    }}
                  >
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 600 }}>{rec.label}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>{rec.why}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <button className="ax-btn prim" disabled={loading || !canRun} onClick={run}>
              {loading ? <InlineSpinner label="Running test..." /> : 'Run test'}
            </button>
          </div>
        </div>

        <div className="ax-card">
          <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 8px' }}>Recommended use</p>
          <InfoRow label="Why this test" text={selectedTest.summary} />
          <InfoRow label="Use when" text={selectedTest.use} />
          <InfoRow label="Avoid when" text={selectedTest.avoid} />
          <InfoRow label="What it tells you" text={recommendationMeaning(kind, group, measure, varA, varB, corrVars)} />
        </div>
      </div>

      {(loading || restoring) && !result && <SkeletonCards count={2} />}

      {result && (
        <TestResult
          kind={kind}
          result={result}
          setup={{ group, measure, varA, varB, corrVars }}
          datasetId={dataset.id}
        />
      )}

    </>
  )
}

function highlightSection(section) {
  const el = document.getElementById(section)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ax-fix-highlight')
  window.setTimeout(() => el.classList.remove('ax-fix-highlight'), 2600)
}

function InfoRow({ label, text }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', margin: 0 }}>{label}</p>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>{text}</p>
    </div>
  )
}

function recommendedTestPairs(kind, numericVars = [], categoricalVars = []) {
  const nums = numericVars.map((v) => v.name)
  const cats = categoricalVars.map((v) => v.name)
  if (kind === 'corr') {
    const preferred = nums.filter((name) => /score|gpa|rate|hours|income|age/i.test(name)).slice(0, 4)
    const variables = preferred.length >= 2 ? preferred : nums.slice(0, 4)
    return variables.length >= 2 ? [{
      label: variables.slice(0, 3).join(' + '),
      variables,
      why: 'Numeric variables can be compared with correlation to see whether they move together.',
    }] : []
  }
  if (kind === 'chi') {
    const pairs = []
    for (let i = 0; i < cats.length; i += 1) {
      for (let j = i + 1; j < cats.length; j += 1) {
        pairs.push({
          label: `${cats[i]} vs ${cats[j]}`,
          varA: cats[i],
          varB: cats[j],
          why: 'Both variables are categorical, so chi-square can test whether their distributions are associated.',
        })
      }
    }
    return pairs.slice(0, 3)
  }
  const groups = categoricalVars
    .filter((v) => kind === 't' ? Number(v.unique || 0) === 2 || v.dtype === 'binary' : Number(v.unique || 0) !== 2)
    .map((v) => v.name)
  const groupList = groups.length ? groups : cats
  return groupList.slice(0, 2).flatMap((group) => nums.slice(0, 2).map((measure) => ({
    label: `${measure} by ${group}`,
    group,
    measure,
    why: kind === 't'
      ? 'A two-group category and a numeric measure are a valid t-test setup.'
      : 'A multi-group category and a numeric measure are a valid ANOVA setup.',
  }))).slice(0, 3)
}

function TestResult({ kind, result, setup, datasetId }) {
  const summary = summarizeResult(kind, result, setup)
  const stepName = `test-${kind}`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <AIInsightCard
        datasetId={datasetId}
        step={stepName}
        params={setup}
        result={result}
        title={`AI interpretation of this ${kind === 'corr' ? 'correlation' : kind} result`}
        question="Interpret these test results in plain English: what do the numbers mean here, is the effect practically meaningful, and what should the user do next?"
        refreshKey={JSON.stringify({ kind, result })}
        suggestedNextStep={{ page: 'models', section: 'fix-target-handling', relatedPlanStepId: 'models-train', label: 'Open Models setup' }}
      />
      <div className="ax-card" style={{ borderLeft: `3px solid ${summary.significant ? '#1D9E75' : '#888'}` }}>
        <div className="ax-row" style={{ marginBottom: 10, alignItems: 'flex-start' }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Test result summary</p>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>{summary.subtitle}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontSize: 10,
              padding: '2px 8px',
              background: summary.significant ? 'var(--color-background-success)' : 'var(--color-background-secondary)',
              color: summary.significant ? 'var(--color-text-success)' : 'var(--color-text-secondary)',
              borderRadius: 4,
            }}>
              {summary.significant ? 'Significant' : 'Not significant'}
            </span>
            <ExplainButton
              datasetId={datasetId}
              step={stepName}
              params={setup}
              result={result}
              question="Explain this specific number — what does it mean for the dataset and how should the user act on it?"
            />
          </div>
        </div>
        <Metrics items={summary.metrics} />
        <Decision significant={summary.significant} />
        <Interpretation title="Conclusion" text={summary.conclusion} />
      </div>

      <div className="ax-card">
        <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 8px' }}>Simple predictive insight</p>
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>{summary.predictive}</p>
      </div>

      {kind === 't' && <GroupMeanBars means={[
        { label: result.group_labels?.[0] || 'Group 1', value: result.mean_group_1 },
        { label: result.group_labels?.[1] || 'Group 2', value: result.mean_group_2 },
      ]} measure={setup.measure} />}
      {kind === 'anova' && <GroupMeanBars means={Object.entries(result.group_means || {}).map(([label, value]) => ({ label, value }))} measure={setup.measure} />}
      {kind === 'chi' && <ContingencyTable result={result} />}
      {kind === 'corr' && (
        <>
          <CorrelationScatter result={result} />
          <CorrelationMatrix result={result} />
        </>
      )}

      <div className="ax-card" style={{ padding: 14 }}>
        <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Next step guidance</p>
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>{summary.next}</p>
      </div>
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
    <div className="ax-card">
      <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 6px' }}>Relationship scatter plot</p>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 10px' }}>
        Visual check for {vars[0]} and {vars[1]}. The line shows the overall trend behind the correlation result.
      </p>
      <div style={{ height: 260 }}>
        <Scatter
          data={{
            datasets: [
              {
                label: 'Rows',
                data: chartPoints,
                backgroundColor: 'rgba(249,115,22,0.45)',
                pointRadius: 3,
              },
              {
                label: 'Trend',
                data: trend,
                type: 'line',
                borderColor: '#111827',
                borderWidth: 2,
                pointRadius: 0,
                showLine: true,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { title: { display: true, text: vars[0] }, ticks: { font: { size: 10 } } },
              y: { title: { display: true, text: vars[1] }, ticks: { font: { size: 10 } } },
            },
          }}
        />
      </div>
    </div>
  )
}

function Metrics({ items }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(100px, 1fr))`, gap: 6, marginBottom: 10 }}>
      {items.map((m) => (
        <div key={m.label} style={{ background: 'var(--color-background-secondary)', borderRadius: 6, padding: '8px 10px' }}>
          <p style={{ fontSize: 10, color: 'var(--color-text-secondary)', margin: 0 }}>{m.label}</p>
          <p style={{ fontSize: 14, fontWeight: 500, margin: '2px 0 0' }}>{m.value}</p>
        </div>
      ))}
    </div>
  )
}

function Decision({ significant }) {
  return (
    <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 6, background: significant ? '#F0FAF6' : 'var(--color-background-secondary)', color: significant ? '#18765B' : 'var(--color-text-secondary)', fontSize: 12 }}>
      <strong>Decision:</strong> {significant ? 'Reject the null hypothesis' : 'Fail to reject the null hypothesis'}
    </div>
  )
}

function Interpretation({ title, text }) {
  return (
    <div style={{ background: 'var(--color-accent-light)', borderRadius: 6, padding: '8px 10px' }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-accent-dark)', margin: '0 0 3px' }}>{title}</p>
      <p style={{ fontSize: 11, color: 'var(--color-accent-dark)', margin: 0, lineHeight: 1.5 }}>{text}</p>
    </div>
  )
}

function GroupMeanBars({ means, measure }) {
  const max = Math.max(...means.map((m) => Math.abs(Number(m.value) || 0)), 1)
  return (
    <div className="ax-card">
      <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 8px' }}>Group mean comparison</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {means.map((m) => (
          <div key={m.label} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 70px', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span title={m.label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
            <span style={{ height: 8, background: 'var(--color-background-secondary)', borderRadius: 4, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${Math.min(100, Math.abs(Number(m.value) || 0) / max * 100)}%`, background: '#7F77DD' }} />
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{fmt(m.value)}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>Higher bars indicate higher average {measure} for that group.</p>
    </div>
  )
}

function ContingencyTable({ result }) {
  const rows = Object.keys(result.contingency || {})
  const cols = rows.length ? Object.keys(result.contingency[rows[0]] || {}) : []
  return (
    <div className="ax-card" style={{ padding: 0, overflow: 'auto' }}>
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
                  <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 4 }}>
                    ({fmt(result.row_percentages?.[r]?.[c])}%)
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CorrelationMatrix({ result }) {
  const vars = result.variables || []
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
                const v = result.matrix?.[r]?.[c]
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

function summarizeResult(kind, result, setup) {
  if (kind === 't') {
    const diff = Number(result.mean_group_1) - Number(result.mean_group_2)
    const effect = effectLabel(Math.abs(result.cohens_d), [0.2, 0.5, 0.8])
    const higher = diff >= 0 ? result.group_labels?.[0] : result.group_labels?.[1]
    return {
      significant: !!result.significant,
      subtitle: `${setup.measure} compared across ${setup.group}`,
      metrics: [
        { label: 't statistic', value: fmt(result.t) },
        { label: 'p value', value: fmt(result.p) },
        { label: "Cohen's d", value: `${fmt(result.cohens_d)} (${effect})` },
        { label: 'mean difference', value: fmt(diff) },
      ],
      conclusion: result.significant
        ? `There is evidence that average ${setup.measure} differs by ${setup.group}. ${higher} has the higher observed mean.`
        : `The observed mean difference in ${setup.measure} by ${setup.group} was not statistically strong enough at p < 0.05.`,
      predictive: `${setup.group} can be used as a simple, non-model indicator of expected ${setup.measure}: the observed group mean difference is ${fmt(diff)}.`,
      next: 'If this difference is meaningful, use Models to test whether the group variable still matters alongside other features.',
    }
  }
  if (kind === 'anova') {
    const means = Object.entries(result.group_means || {}).sort((a, b) => Number(b[1]) - Number(a[1]))
    const effect = effectLabel(Number(result.eta_squared), [0.01, 0.06, 0.14])
    return {
      significant: !!result.significant,
      subtitle: `${setup.measure} compared across groups of ${setup.group}`,
      metrics: [
        { label: 'F statistic', value: fmt(result.f) },
        { label: 'p value', value: fmt(result.p) },
        { label: 'eta squared', value: `${fmt(result.eta_squared)} (${effect})` },
        { label: 'groups', value: result.groups },
      ],
      conclusion: result.significant
        ? `At least one ${setup.group} category has a different average ${setup.measure}. The highest observed mean is ${means[0]?.[0] || 'the leading group'}.`
        : `The average ${setup.measure} does not show a statistically significant difference across ${setup.group} groups.`,
      predictive: `${setup.group} gives a simple expectation signal for ${setup.measure}; compare group means to see which categories tend to be higher or lower.`,
      next: 'Use post-hoc comparisons or modeling if you need to identify which variables explain the group differences together.',
    }
  }
  if (kind === 'chi') {
    const effect = effectLabel(Number(result.cramers_v), [0.1, 0.3, 0.5])
    return {
      significant: !!result.significant,
      subtitle: `${setup.varA} tested against ${setup.varB}`,
      metrics: [
        { label: 'chi-square', value: fmt(result.chi2) },
        { label: 'p value', value: fmt(result.p) },
        { label: "Cramer's V", value: `${fmt(result.cramers_v)} (${effect})` },
        { label: 'df', value: result.df },
      ],
      conclusion: result.significant
        ? `There is evidence that ${setup.varA} and ${setup.varB} are associated. Category percentages differ more than expected by chance.`
        : `There is not enough evidence to say ${setup.varA} and ${setup.varB} are associated at p < 0.05.`,
      predictive: `Use the contingency percentages as a simple probability-style guide: each row shows how ${setup.varB} tends to distribute within ${setup.varA}.`,
      next: 'If this association matters, use classification models to predict the outcome while controlling for other features.',
    }
  }
  const pair = result.strongest_pair
  const r = pair?.r ?? 0
  const strength = corrStrength(Math.abs(r))
  return {
    significant: pair ? pair.p < 0.05 : false,
    subtitle: 'Numeric relationship scan',
    metrics: [
      { label: 'strongest pair', value: pair ? `${pair.var_a} / ${pair.var_b}` : '-' },
      { label: 'r', value: fmt(r) },
      { label: 'p value', value: pair ? fmt(pair.p) : '-' },
      { label: 'strength', value: strength },
    ],
    conclusion: pair
      ? `${pair.var_a} and ${pair.var_b} show the strongest relationship among selected variables. The direction is ${r >= 0 ? 'positive' : 'negative'} and the strength is ${strength}.`
      : 'No pairwise correlation could be computed.',
    predictive: pair ? `As ${pair.var_a} ${r >= 0 ? 'increases' : 'increases'}, ${pair.var_b} tends to ${r >= 0 ? 'increase' : 'decrease'} in the observed data. This is association, not a full model prediction.` : 'Select at least two numeric variables to produce trend-style insight.',
    next: 'Use Models if you want to test whether this relationship remains useful when multiple features are considered together.',
  }
}

function recommendationMeaning(kind, group, measure, varA, varB, corrVars) {
  if (kind === 't' || kind === 'anova') {
    return group && measure ? `Whether ${measure} differs across ${group}.` : 'Whether a numeric measure differs across categories.'
  }
  if (kind === 'chi') {
    return varA && varB ? `Whether ${varA} is associated with ${varB}.` : 'Whether two categorical variables are related.'
  }
  return corrVars.length >= 2 ? `How strongly ${corrVars.join(', ')} move together.` : 'Which numeric variables move together and in what direction.'
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
