import React, { useEffect, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import { api } from '../api'
import { ExplainButton } from './AIExplainers'
import { InlineSpinner, SkeletonCards } from './LoadingStates'
import HelpButton from './HelpButton'

export default function DescribePage({ dataset }) {
  const [selected, setSelected] = useState([])
  const [result, setResult] = useState(null)
  const [corrResult, setCorrResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [expandedExplain, setExpandedExplain] = useState({})
  const [chartVariable, setChartVariable] = useState('')
  const currentStageId = dataset?.current_stage_id || 'original'

  useEffect(() => {
    if (!dataset?.id) return
    let alive = true
    setRestoring(true)
    Promise.all([
      api.listAnalyses(dataset.id, 'describe', 1).catch(() => ({ analyses: [] })),
      api.listAnalyses(dataset.id, 'test_corr', 1).catch(() => ({ analyses: [] })),
    ])
      .then(([describeRows, corrRows]) => {
        if (!alive) return
        const latestDescribe = describeRows.analyses?.[0]
        const latestCorr = corrRows.analyses?.[0]
        if (latestDescribe) {
          setResult(latestDescribe.result)
          setSelected(latestDescribe.config?.variables || [])
        } else {
          setResult(null)
          setSelected([])
        }
        setCorrResult(latestCorr?.result || null)
        setExpandedExplain({})
      })
      .finally(() => {
        if (alive) setRestoring(false)
      })
    return () => {
      alive = false
    }
  }, [dataset?.id, dataset?.current_stage_id])

  if (!dataset) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>

  const toggle = (name) => {
    setSelected(selected.includes(name) ? selected.filter((x) => x !== name) : [...selected, name])
  }

  const run = async () => {
    setLoading(true)
    try {
      const variables = selected.length ? selected : (dataset.variables || []).map((v) => v.name)
      const r = await api.describe(dataset.id, { variables })
      setResult(r)
      const selectedVars = dataset.variables || []
      const numericSelected = selectedVars
        .filter((v) => variables.includes(v.name) && ['numeric', 'int', 'float'].includes(v.dtype))
        .map((v) => v.name)
      if (numericSelected.length >= 2) {
        const corr = await api.runTest(dataset.id, { kind: 'corr', variables: numericSelected })
        setCorrResult(corr)
      } else {
        setCorrResult(null)
      }
      setExpandedExplain({})
    } finally {
      setLoading(false)
    }
  }

  const numericStats = (result?.stats || []).filter((s) => s.kind === 'numeric')
  const categoricalStats = (result?.stats || []).filter((s) => s.kind === 'categorical')
  const histograms = result?.histograms || (result?.histogram ? { [result.histogram.variable]: result.histogram } : {})
  const selectedHistogram = histograms[chartVariable] || result?.histogram
  const histogramInsight = selectedHistogram ? describeHistogram(selectedHistogram, numericStats) : null

  return (
    <>
      <h1 className="ax-page-title">Descriptive statistics</h1>
      <p className="ax-page-sub">Summarize variables, interpret distributions, and identify patterns worth testing next.</p>
      {result && (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '-4px 0 12px' }}>
          Updated from current dataset stage: <span style={{ fontFamily: 'var(--font-mono)' }}>{currentStageId === 'original' ? 'original' : currentStageId.slice(0, 8)}</span>
        </p>
      )}

      <p id="describe-section-variables" className="ax-lbl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        Variables - tap to toggle
      </p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <button className="ax-btn" type="button" onClick={() => setSelected((dataset.variables || []).map((v) => v.name))}>
          Select all
        </button>
        <button className="ax-btn" type="button" onClick={() => setSelected([])} disabled={selected.length === 0}>
          Clear
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {(dataset.variables || []).map((v) => (
          <span
            key={v.name}
            className={`ax-chip ${selected.includes(v.name) ? 'active' : ''}`}
            onClick={() => toggle(v.name)}
            title={`${v.name} (${v.dtype})`}
          >
            {v.name} <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 3 }}>({v.dtype})</span>
          </span>
        ))}
      </div>

      <button className="ax-btn prim" disabled={loading || selected.length === 0} onClick={run} style={{ marginBottom: 16 }}>
        {loading ? <InlineSpinner label="Running descriptives..." /> : `Run descriptives for ${selected.length} variable${selected.length === 1 ? '' : 's'}`}
      </button>

      {(loading || restoring) && !result && <SkeletonCards count={3} />}

      {result && (
        <>
          {(numericStats.length > 0 || categoricalStats.length > 0) && (
            <>
              <p className="ax-lbl">Variable insight cards</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, marginBottom: 14 }}>
                {numericStats.map((s) => (
                  <VariableCard
                    key={s.variable}
                    title={s.variable}
                    type="numeric"
                    tags={numericTags(s)}
                    metrics={[
                      ['Mean', fmt(s.mean)],
                      ['SD', fmt(s.std)],
                      ['Range', `${fmt(s.min)} to ${fmt(s.max)}`],
                      ['Skew', fmt(s.skew)],
                    ]}
                    insight={numericInsight(s)}
                    datasetId={dataset.id}
                    resultPayload={{ stat: s, histogram: histograms[s.variable] }}
                    expanded={!!expandedExplain[s.variable]}
                    onExplain={() => setExpandedExplain((cur) => ({ ...cur, [s.variable]: !cur[s.variable] }))}
                  />
                ))}
                {categoricalStats.map((s) => (
                  <VariableCard
                    key={s.variable}
                    title={s.variable}
                    type="categorical"
                    tags={categoricalTags(s)}
                    metrics={[
                      ['Most common', `${s.top || '-'} (${pctOf(s.freq, s.n)})`],
                      ['Unique values', s.unique],
                      ['Valid n', s.n?.toLocaleString()],
                    ]}
                    insight={categoricalInsight(s)}
                    datasetId={dataset.id}
                    resultPayload={{ stat: s }}
                    distribution={topDistribution(s)}
                    expanded={!!expandedExplain[s.variable]}
                    onExplain={() => setExpandedExplain((cur) => ({ ...cur, [s.variable]: !cur[s.variable] }))}
                  />
                ))}
              </div>
            </>
          )}

          {numericStats.length > 0 && (
            <>
              <p className="ax-lbl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Numeric summary
                <HelpButton
                  title="Numeric summary"
                  text="This card summarizes numeric variables with count, average, spread, quartiles, range, and skew. Use it to spot unusual values, wide variation, or skew before tests and modeling."
                />
              </p>
              <SummaryExplainer
                title="How to read numeric summaries"
                text="Mean is the average, SD shows spread, median is the middle value, range shows minimum to maximum, and skew describes whether values lean low or high."
              />
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
              <p className="ax-lbl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Categorical summary
                <HelpButton
                  title="Categorical summary"
                  text="This card summarizes category columns by valid count, number of unique labels, dominant label, and distribution. Use it to check imbalance and messy labels."
                />
              </p>
              <SummaryExplainer
                title="How to read categorical summaries"
                text="Unique values count the labels present. Most common and share show whether one category dominates or whether the distribution is balanced."
              />
              <div className="ax-card" style={{ padding: 0, overflow: 'auto', marginBottom: 12 }}>
                <table className="ax-tbl">
                  <thead>
                    <tr><th>Variable</th><th>n</th><th>Unique</th><th>Most common</th><th>Share</th><th>Distribution</th></tr>
                  </thead>
                  <tbody>
                    {categoricalStats.map((s) => (
                      <tr key={s.variable}>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{s.variable}</td>
                        <td>{s.n?.toLocaleString()}</td>
                        <td>{s.unique}</td>
                        <td>{s.top}</td>
                        <td>{pctOf(s.freq, s.n)}</td>
                        <td>{topDistribution(s).slice(0, 3).map((x) => `${x.label}: ${x.pct}`).join(' | ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {selectedHistogram && (
            <>
              <p className="ax-lbl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Distribution
                <HelpButton
                  title="Distribution chart"
                  text="This card visualizes one numeric variable at a time. Switch the selected variable to compare shapes, concentration, and possible unusual ranges."
                />
              </p>
              <div className="ax-card" style={{ marginBottom: 14 }}>
                <div className="ax-row" style={{ marginBottom: 10 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{selectedHistogram.variable}</p>
                  <select value={selectedHistogram.variable} onChange={(e) => setChartVariable(e.target.value)} style={{ maxWidth: 260 }}>
                    {Object.keys(histograms).map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
                <div style={{ height: 220 }}>
                  <Bar
                    data={{
                      labels: selectedHistogram.bins.slice(0, -1).map((b, i) => `${fmt(b)}-${fmt(selectedHistogram.bins[i + 1])}`),
                      datasets: [{
                        label: selectedHistogram.variable,
                        data: selectedHistogram.counts,
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
                {histogramInsight && (
                  <div style={{ borderTop: '0.5px solid var(--color-border-tertiary)', marginTop: 12, paddingTop: 10 }}>
                    <p style={{ fontSize: 12, fontWeight: 500, margin: '0 0 4px' }}>Distribution insight</p>
                    <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>{histogramInsight}</p>
                  </div>
                )}
              </div>
            </>
          )}

          {corrResult?.variables?.length >= 2 && (
            <>
              <p className="ax-lbl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Correlation overview
                <HelpButton
                  title="Correlation overview"
                  text="This card shows how numeric variables move together. Stronger colors mean stronger relationships; use it to decide which pairs are worth testing or modeling."
                />
              </p>
              <div className="ax-card" style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 6px' }}>
                  Numeric relationship preview <InfoIcon text="Green means a positive relationship, red means a negative relationship, and stronger color means a stronger correlation. Values near 0 are weak." />
                </p>
                <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 12px' }}>
                  This heatmap summarizes pairwise numeric relationships for the selected variables. Stronger colors indicate stronger positive or negative associations.
                </p>
                <CorrelationHeatmap result={corrResult} />
                {corrResult.strongest_pair && (
                  <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '10px 0 0' }}>
                    Strongest relationship: {corrResult.strongest_pair.var_a} and {corrResult.strongest_pair.var_b}
                    {' '}({fmt(corrResult.strongest_pair.r)} correlation).
                  </p>
                )}
              </div>
            </>
          )}

          <DescribeRunSummary
            datasetId={dataset.id}
            selected={selected}
            numericStats={numericStats}
            categoricalStats={categoricalStats}
            histograms={histograms}
            corrResult={corrResult}
          />

          <div className="ax-card" style={{ padding: 14 }}>
            <p style={{ fontSize: 13, fontWeight: 500, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              Next step recommendation
              <HelpButton
                title="Next step recommendation"
                text="This card connects descriptive results to the next workflow stage. It suggests whether relationship tests, group comparisons, or modeling are the natural next move."
              />
            </p>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
              Use Analysis next to check whether these patterns are statistically meaningful. Correlation is useful for numeric relationships; group tests are useful when comparing outcomes across categories.
            </p>
          </div>
        </>
      )}
    </>
  )
}

function DescribeRunSummary({ datasetId, selected, numericStats, categoricalStats, histograms, corrResult }) {
  const histogramCount = Object.keys(histograms || {}).length
  const strongest = corrResult?.strongest_pair
  const summaryPayload = {
    variables_analyzed: selected.length || numericStats.length + categoricalStats.length,
    numeric_summaries: numericStats.length,
    categorical_summaries: categoricalStats.length,
    distribution_charts: histogramCount,
    correlation_overview: corrResult?.variables?.length >= 2
      ? {
          variables: corrResult.variables,
          strongest_pair: strongest || null,
        }
      : null,
  }
  return (
    <div className="ax-card" style={{ padding: 14, marginBottom: 14 }}>
      <div className="ax-row" style={{ alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 800, margin: 0 }}>Describe run summary</p>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
            These are the descriptive outputs currently saved for this dataset stage.
          </p>
        </div>
        <ExplainButton
          datasetId={datasetId}
          step="describe-run-summary"
          params={{ section: 'describe-run-summary' }}
          result={summaryPayload}
          question="Explain what this descriptive run summary means, what was generated, and what the user should inspect next."
          label="AI explain"
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        <SummaryStat label="Variables analyzed" value={selected.length || numericStats.length + categoricalStats.length} />
        <SummaryStat label="Numeric summaries" value={numericStats.length} />
        <SummaryStat label="Categorical summaries" value={categoricalStats.length} />
        <SummaryStat label="Distribution charts" value={histogramCount} />
      </div>
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid var(--color-border-tertiary)' }}>
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>
          {corrResult?.variables?.length >= 2
            ? `Correlation overview was generated for ${corrResult.variables.length} numeric variables${strongest ? `; strongest pair is ${strongest.var_a} and ${strongest.var_b} (r = ${fmt(strongest.r)}).` : '.'}`
            : 'Correlation overview was not generated because fewer than two numeric variables were included.'}
        </p>
      </div>
    </div>
  )
}

function SummaryStat({ label, value }) {
  return (
    <div style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: '10px 12px' }}>
      <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: 0 }}>{label}</p>
      <p style={{ fontSize: 18, fontWeight: 850, margin: '2px 0 0' }}>{value}</p>
    </div>
  )
}

function CorrelationHeatmap({ result }) {
  const vars = result.variables || []
  if (!vars.length) return null
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)', minWidth: Math.max(420, vars.length * 78) }}>
        <thead>
          <tr>
            <th style={{ padding: '6px 8px' }}></th>
            {vars.map((v) => (
              <th key={v} style={{ padding: '6px 8px', color: 'var(--color-text-secondary)', fontWeight: 500, fontSize: 10 }}>
                {v}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {vars.map((r) => (
            <tr key={r}>
              <td style={{ padding: '6px 8px', fontWeight: 500, fontSize: 10, color: 'var(--color-text-secondary)' }}>{r}</td>
              {vars.map((c) => {
                const v = Number(result.matrix?.[r]?.[c] ?? 0)
                const abs = Math.abs(v)
                const alpha = abs > 0.9 ? 0.7 : abs > 0.7 ? 0.5 : abs > 0.4 ? 0.3 : abs > 0.2 ? 0.15 : 0.05
                const bg = r === c ? `rgba(249,115,22,${alpha})` : v >= 0 ? `rgba(16,185,129,${alpha})` : `rgba(239,68,68,${alpha})`
                return (
                  <td key={c} style={{ padding: '7px 10px', textAlign: 'center', background: bg, border: '0.5px solid var(--color-border-tertiary)' }}>
                    {fmt(v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SummaryExplainer({ title, text }) {
  return (
    <div className="ax-card" style={{ padding: '8px 10px', marginBottom: 8, background: 'var(--color-accent-light)' }}>
      <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 3px' }}>{title}</p>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>{text}</p>
    </div>
  )
}

function InfoIcon({ text }) {
  return <HelpButton title="How to read this" text={text} size={16} />
}

function VariableCard({ title, type, tags, metrics, insight, distribution, expanded, onExplain, datasetId, resultPayload }) {
  return (
    <div className="ax-card" style={{ padding: 12 }}>
      <div className="ax-row" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 500, margin: 0, fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 6 }}>
            {title}
          </p>
          <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>{type}</p>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {tags.map((tag) => <span key={tag} className="ax-chip">{tag}</span>)}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, marginBottom: 8 }}>
        {metrics.map(([label, value]) => (
          <div key={label} style={{ background: 'var(--color-background-secondary)', borderRadius: 6, padding: '6px 8px' }}>
            <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', margin: 0 }}>{label}</p>
            <p style={{ fontSize: 12, margin: '2px 0 0' }}>{value}</p>
          </div>
        ))}
      </div>
      {distribution?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
          {distribution.slice(0, 4).map((row) => (
            <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 46px', gap: 6, alignItems: 'center', fontSize: 11 }}>
              <span title={row.label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
              <span style={{ height: 6, background: 'var(--color-background-secondary)', borderRadius: 3, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: row.pct, background: '#7F77DD' }} />
              </span>
              <span style={{ color: 'var(--color-text-secondary)', textAlign: 'right' }}>{row.pct}</span>
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>{insight}</p>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <button className="ax-btn" onClick={onExplain}>
          {expanded ? 'Hide rule explanation' : 'Explain terms'}
        </button>
        <ExplainButton
          datasetId={datasetId}
          step={`describe-variable-${type}`}
          params={{ variable: title, type }}
          result={resultPayload}
          question={`Explain the descriptive summary for ${title} in plain language. Define the statistical terms briefly and say what the user should notice.`}
          label="AI explain"
        />
      </div>
      {expanded && (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '8px 0 0', borderTop: '0.5px solid var(--color-border-tertiary)', paddingTop: 8 }}>
          {insight} This explanation is rule-based and remains available even without an AI key.
        </p>
      )}
    </div>
  )
}

function buildKeyInsights(numericStats, categoricalStats) {
  const insights = []
  const symmetric = numericStats.filter((s) => Math.abs(Number(s.skew) || 0) < 0.5)
  const skewed = numericStats.filter((s) => Math.abs(Number(s.skew) || 0) >= 1)
  const variable = numericStats
    .filter((s) => Number.isFinite(Number(s.std)) && Number.isFinite(Number(s.mean)))
    .map((s) => ({ ...s, spread: spreadScore(s) }))
    .sort((a, b) => b.spread - a.spread)
  const dominant = categoricalStats
    .map((s) => ({ ...s, share: Number(s.freq || 0) / Math.max(Number(s.n || 0), 1) }))
    .filter((s) => s.share >= 0.6)
    .sort((a, b) => b.share - a.share)

  if (symmetric.length) insights.push({ tone: 'good', text: `${symmetric[0].variable} is approximately symmetric (skew = ${fmt(symmetric[0].skew)}).` })
  if (skewed.length) insights.push({ tone: 'warn', text: `${skewed[0].variable} is strongly skewed (skew = ${fmt(skewed[0].skew)}), so median/IQR may be more informative than mean/SD.` })
  if (variable.length) insights.push({ tone: variable[0].spread > 0.35 ? 'warn' : 'info', text: `${variable[0].variable} shows the highest relative variability among selected numeric variables.` })
  if (dominant.length) insights.push({ tone: 'info', text: `${dominant[0].variable} is dominated by ${dominant[0].top} (${pctOf(dominant[0].freq, dominant[0].n)} of valid rows).` })
  if (!skewed.length && numericStats.length) insights.push({ tone: 'good', text: 'No extreme skew was detected among the selected numeric variables.' })
  if (!insights.length) insights.push({ tone: 'info', text: 'The selected variables were summarized successfully. Use the cards below to inspect variable-level patterns.' })
  return insights.slice(0, 5)
}

function numericInsight(s) {
  const skew = Number(s.skew) || 0
  const spread = spreadScore(s)
  const shape = Math.abs(skew) < 0.5 ? 'fairly symmetric' : skew >= 1 ? 'right-skewed' : skew <= -1 ? 'left-skewed' : skew > 0 ? 'slightly right-skewed' : 'slightly left-skewed'
  const variability = spread > 0.45 ? 'high variability' : spread > 0.2 ? 'moderate variability' : 'low variability'
  return `${s.variable} is ${shape} and shows ${variability}. The typical value is around ${fmt(s.mean)}, with most middle values between ${fmt(s.q1)} and ${fmt(s.q3)}.`
}

function categoricalInsight(s) {
  const share = Number(s.freq || 0) / Math.max(Number(s.n || 0), 1)
  if (share >= 0.7) return `${s.variable} is highly concentrated: ${s.top} accounts for ${pctOf(s.freq, s.n)} of valid rows.`
  if (share >= 0.45) return `${s.variable} has a clear leading category (${s.top}), but other categories still contribute meaningfully.`
  return `${s.variable} is relatively spread across categories; no single category overwhelmingly dominates.`
}

function describeHistogram(histogram, numericStats) {
  const stat = numericStats.find((s) => s.variable === histogram.variable)
  if (!stat) return null
  const maxCount = Math.max(...(histogram.counts || []), 0)
  const peakIndex = (histogram.counts || []).indexOf(maxCount)
  const lo = histogram.bins?.[peakIndex]
  const hi = histogram.bins?.[peakIndex + 1]
  return `${histogram.variable} peaks around ${fmt(lo)} to ${fmt(hi)}. ${numericInsight(stat)}`
}

function numericTags(s) {
  const tags = []
  const skew = Number(s.skew) || 0
  const spread = spreadScore(s)
  tags.push(Math.abs(skew) < 0.5 ? 'Symmetric' : Math.abs(skew) >= 1 ? 'Skewed' : 'Mild skew')
  tags.push(spread > 0.45 ? 'High variability' : spread > 0.2 ? 'Moderate spread' : 'Stable')
  return tags
}

function categoricalTags(s) {
  const share = Number(s.freq || 0) / Math.max(Number(s.n || 0), 1)
  return [share >= 0.6 ? 'Dominant category' : 'Mixed categories', `${s.unique} unique`]
}

function topDistribution(s) {
  const counts = s.value_counts || {}
  const total = Math.max(Number(s.n || 0), 1)
  return Object.entries(counts).map(([label, count]) => ({
    label,
    count,
    pct: `${((Number(count) / total) * 100).toFixed(1)}%`,
  }))
}

function spreadScore(s) {
  const range = Math.abs(Number(s.max) - Number(s.min)) || 1
  return Math.abs(Number(s.std) || 0) / range
}

function pctOf(count, total) {
  if (!total) return '0.0%'
  return `${((Number(count || 0) / Number(total)) * 100).toFixed(1)}%`
}

function fmt(v) {
  if (v === null || v === undefined) return '-'
  if (typeof v !== 'number') return v
  return Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3)
}
