import React, { useState } from 'react'
import { Bar } from 'react-chartjs-2'
import { api } from '../api'
import { AIInsightCard } from './AIExplainers'

export default function DescribePage({ dataset }) {
  const [selected, setSelected] = useState([])
  const [result, setResult] = useState(null)
  const [corrResult, setCorrResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expandedExplain, setExpandedExplain] = useState({})

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
  const insights = result ? buildKeyInsights(numericStats, categoricalStats) : []
  const histogramInsight = result?.histogram ? describeHistogram(result.histogram, numericStats) : null

  return (
    <>
      <h1 className="ax-page-title">Descriptive statistics</h1>
      <p className="ax-page-sub">Summarize variables, interpret distributions, and identify patterns worth testing next.</p>

      <p id="describe-section-variables" className="ax-lbl">Variables - tap to toggle</p>
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
        {loading ? 'Running...' : `Run descriptives for ${selected.length} variable${selected.length === 1 ? '' : 's'}`}
      </button>

      {result && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(280px, 0.8fr)', gap: 12, marginBottom: 14 }}>
            <div className="ax-card" style={{ padding: 14 }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 8px' }}>Key insights</p>
              {insights.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {insights.map((item, idx) => (
                    <InsightLine key={idx} tone={item.tone} text={item.text} />
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>Select variables and run descriptives to generate insights.</p>
              )}
            </div>

            <AIInsightCard
              datasetId={dataset.id}
              step="describe-summary"
              params={{ variables: selected.length ? selected : 'all' }}
              result={{ numeric: numericStats, categorical: categoricalStats, histogram: result?.histogram }}
              title="AI narrative"
              question="Write a short narrative summary of these descriptive statistics for a non-statistician: what the data looks like, the most notable distributions or skews, and any data-quality concerns worth following up on."
              refreshKey={result?.run_id || JSON.stringify(numericStats.map((s) => s.variable))}
            />
          </div>

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

          {result.histogram && (
            <>
              <p className="ax-lbl">Distribution - {result.histogram.variable}</p>
              <div className="ax-card" style={{ marginBottom: 14 }}>
                <div style={{ height: 220 }}>
                  <Bar
                    data={{
                      labels: result.histogram.bins.slice(0, -1).map((b, i) => `${fmt(b)}-${fmt(result.histogram.bins[i + 1])}`),
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
              <p className="ax-lbl">Correlation overview</p>
              <div className="ax-card" style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 6px' }}>
                  Numeric relationship preview
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

          <div className="ax-card" style={{ padding: 14 }}>
            <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Next step recommendation</p>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
              Use Tests next to check whether these patterns are statistically meaningful. Correlation is useful for numeric relationships; group tests are useful when comparing outcomes across categories.
            </p>
          </div>
        </>
      )}
    </>
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
                const bg = r === c ? `rgba(127,119,221,${alpha})` : v >= 0 ? `rgba(15,110,86,${alpha})` : `rgba(163,45,45,${alpha})`
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

function InsightLine({ tone, text }) {
  const styles = {
    good: { bg: '#F0FAF6', fg: '#18765B', mark: 'OK' },
    warn: { bg: '#FFF8EA', fg: '#7A4B00', mark: '!' },
    info: { bg: '#EEF4FF', fg: '#255CA8', mark: 'i' },
  }
  const s = styles[tone] || styles.info
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
      <span style={{ flexShrink: 0, minWidth: 22, textAlign: 'center', borderRadius: 4, padding: '1px 4px', background: s.bg, color: s.fg, fontSize: 10, fontWeight: 600 }}>
        {s.mark}
      </span>
      <span style={{ color: 'var(--color-text-secondary)' }}>{text}</span>
    </div>
  )
}

function VariableCard({ title, type, tags, metrics, insight, distribution, expanded, onExplain }) {
  return (
    <div className="ax-card" style={{ padding: 12 }}>
      <div className="ax-row" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 500, margin: 0, fontFamily: 'var(--font-mono)' }}>{title}</p>
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
      <button className="ax-btn" onClick={onExplain} style={{ marginTop: 10 }}>
        {expanded ? 'Hide explanation' : 'Explain this'}
      </button>
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
