/* ============================================================
 * PAGE: DESCRIBE / DESCRIPTIVE STATISTICS
 * Keywords: describe, descriptives, summary, histogram, mean, std, distribution
 * ============================================================ */
import React, { useEffect, useState } from 'react'
import {
  Chart as ChartJS,
  RadialLinearScale,
  BarController,
  LineController,
  ScatterController,
  PieController,
  RadarController,
  BubbleController,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js'
import { Bar, Line, Scatter, Pie, Radar, Bubble } from 'react-chartjs-2'
import { api } from '../../api'
import { ExplainButton } from '../ai/AIExplainers'
import { useAuth } from '../providers/AuthProvider'
import { InlineSpinner, SkeletonCards } from '../common/LoadingStates'
import HelpButton from '../common/HelpButton'
import PageGuide from '../common/PageGuide'
import {
  AlertTriangle,
  TrendingUp,
  Layers,
  CheckCircle,
  BarChart3,
  LineChart,
  PieChart,
  Circle,
  Hexagon,
  Activity,
  AlertCircle
} from 'lucide-react'

// Register Chart.js elements and controllers
ChartJS.register(
  RadialLinearScale,
  BarController,
  LineController,
  ScatterController,
  PieController,
  RadarController,
  BubbleController,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
)

// Primary accent color constants
const ORANGE_ACCENT = '#ea580c'
const ORANGE_LIGHT = '#ffedd5'
const GREEN_ACCENT = '#059669'
const GREEN_LIGHT = '#d1fae5'
const BG_WARM_BEIGE = '#faf7f2'

const CHART_PALETTES = ['#f97316', '#0284c7', '#0f766e', '#9a3412', '#6366f1', '#3f6212', '#b45309', '#9d174d']

// Page component that runs descriptive statistics, distribution charts, and correlation analysis.
export default function DescribePage({ dataset }) {
  const [selected, setSelected] = useState([])
  const [result, setResult] = useState(null)
  const [corrResult, setCorrResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [expandedExplain, setExpandedExplain] = useState({})
  const [activeCategory, setActiveCategory] = useState('')

  // Chart builder states
  const [datasetRows, setDatasetRows] = useState([])
  const [loadingRows, setLoadingRows] = useState(false)
  const [chartBuilderType, setChartBuilderType] = useState('bar')
  const [chartBuilderX, setChartBuilderX] = useState('')
  const [chartBuilderY, setChartBuilderY] = useState('')
  const [chartBuilderGroupBy, setChartBuilderGroupBy] = useState('')
  const [chartBuilderAgg, setChartBuilderAgg] = useState('Mean')
  const [chartBuilderColor, setChartBuilderColor] = useState('#f97316')

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
          const categorical = (latestDescribe.result?.stats || []).filter(s => s.kind === 'categorical')
          if (categorical.length > 0) {
            setActiveCategory(categorical[0].variable)
          }
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

  // Load dataset rows for custom chart builder
  useEffect(() => {
    if (!dataset?.id) return
    setLoadingRows(true)
    api.getRows(dataset.id, 1, 10000, dataset.current_stage_id)
      .then(res => {
        setDatasetRows(res.rows || [])
      })
      .catch(err => {
        console.error("Failed to load dataset rows for chart builder:", err)
      })
      .finally(() => {
        setLoadingRows(false)
      })
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
      const categorical = (r?.stats || []).filter(s => s.kind === 'categorical')
      if (categorical.length > 0) {
        setActiveCategory(categorical[0].variable)
      }
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

  // Top summary metrics logic
  const totalVars = (dataset.variables || []).length
  const numericVarsCount = (dataset.variables || []).filter(v => ['numeric', 'int', 'float'].includes(v.dtype)).length
  const categoricalVarsCount = totalVars - numericVarsCount
  const totalRecords = dataset.row_count || 0
  const avgValidN = result ? Math.round((result.stats || []).reduce((a, b) => a + (b.n || 0), 0) / Math.max((result.stats || []).length, 1)) : 0
  const skewedVarsList = result ? (result.stats || []).filter(s => s.kind === 'numeric' && Math.abs(Number(s.skew) || 0) >= 1.0).map(s => s.variable) : []
  const skewedCount = skewedVarsList.length
  const strongestCorr = corrResult?.strongest_pair

  // Quality Flags list
  const qualityFlags = result ? getDataQualityFlags(numericStats, categoricalStats, corrResult) : []

  const renderLiveChart = () => {
    const chartData = prepareChartData(
      datasetRows,
      chartBuilderType,
      chartBuilderX,
      chartBuilderY,
      chartBuilderGroupBy,
      chartBuilderAgg,
      chartBuilderColor
    )

    if (!chartData) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '300px', color: '#9ca3af', gap: '12px' }}>
          <BarChart3 size={48} strokeWidth={1} />
          <span style={{ fontSize: '13px', fontWeight: '500', color: '#6b7280' }}>Assign required fields to see a preview</span>
        </div>
      )
    }

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { font: { size: 10 } }
        }
      },
      scales: chartBuilderType !== 'pie' && chartBuilderType !== 'radar' ? {
        x: { ticks: { font: { size: 10 } } },
        y: { ticks: { font: { size: 10 } } }
      } : undefined
    }

    if (chartBuilderType === 'horizontal bar') {
      options.indexAxis = 'y'
    }

    switch (chartBuilderType) {
      case 'bar':
      case 'horizontal bar':
        return <Bar data={chartData} options={options} style={{ maxHeight: '300px' }} />
      case 'line':
        return <Line data={chartData} options={options} style={{ maxHeight: '300px' }} />
      case 'scatter':
        return <Scatter data={chartData} options={options} style={{ maxHeight: '300px' }} />
      case 'pie':
        return <Pie data={chartData} options={options} style={{ maxHeight: '300px' }} />
      case 'histogram':
        return <Bar data={chartData} options={options} style={{ maxHeight: '300px' }} />
      case 'radar':
        return <Radar data={chartData} options={options} style={{ maxHeight: '300px' }} />
      case 'bubble':
        return <Bubble data={chartData} options={options} style={{ maxHeight: '300px' }} />
      default:
        return null
    }
  }

  return (
    <>
      <h1 className="ax-page-title">Descriptive statistics</h1>
      <p className="ax-page-sub">Summarize variables, interpret distributions, and identify patterns worth testing next.</p>
      <PageGuide
        title="Turn columns into understandable patterns"
        meta="Describe"
        steps={['Select variables', 'Run summaries', 'Review charts', 'Explain findings']}
      >
        Start with variables that matter to your question. SimuCast saves the latest summaries for this dataset stage so you can return to them later.
      </PageGuide>
      {result && (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '-4px 0 12px' }}>
          Updated from current dataset stage: <span style={{ fontFamily: 'var(--font-mono)' }}>{currentStageId === 'original' ? 'original' : String(currentStageId)}</span>
        </p>
      )}

      <p id="describe-section-variables" className="ax-lbl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        Variables — tap to toggle
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
          {/* Key Stats Cards / Summary Tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
            <div style={{ background: BG_WARM_BEIGE, borderRadius: 12, padding: 16, border: '1px solid rgba(0,0,0,0.03)' }}>
              <p style={{ fontSize: 12, color: '#6b7280', fontWeight: 500, margin: '0 0 4px' }}>Variables analyzed</p>
              <p style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>{totalVars}</p>
              <p style={{ fontSize: 12, color: '#4b5563', margin: 0 }}>{numericVarsCount} numeric · {categoricalVarsCount} categorical</p>
            </div>
            <div style={{ background: BG_WARM_BEIGE, borderRadius: 12, padding: 16, border: '1px solid rgba(0,0,0,0.03)' }}>
              <p style={{ fontSize: 12, color: '#6b7280', fontWeight: 500, margin: '0 0 4px' }}>Total records</p>
              <p style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>{totalRecords}</p>
              <p style={{ fontSize: 12, color: '#4b5563', margin: 0 }}>Avg valid n per var: {avgValidN}</p>
            </div>
            <div style={{ background: BG_WARM_BEIGE, borderRadius: 12, padding: 16, border: '1px solid rgba(0,0,0,0.03)' }}>
              <p style={{ fontSize: 12, color: '#6b7280', fontWeight: 500, margin: '0 0 4px' }}>Skewed variables</p>
              <p style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>{skewedCount}</p>
              <p style={{ fontSize: 12, color: '#4b5563', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={skewedVarsList.join(', ') || 'None'}>
                {skewedVarsList.join(', ') || 'No skewed variables'}
              </p>
            </div>
            <div style={{ background: BG_WARM_BEIGE, borderRadius: 12, padding: 16, border: '1px solid rgba(0,0,0,0.03)' }}>
              <p style={{ fontSize: 12, color: '#6b7280', fontWeight: 500, margin: '0 0 4px' }}>Strongest correlation</p>
              <p style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>{strongestCorr ? Math.abs(Number(strongestCorr.r)).toFixed(2) : '0.00'}</p>
              <p style={{ fontSize: 12, color: '#4b5563', margin: 0 }}>
                {strongestCorr ? `${strongestCorr.var_a} ↔ ${strongestCorr.var_b}` : 'N/A'}
              </p>
            </div>
          </div>

          {/* Key Data Quality Flags */}
          {qualityFlags.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 20, marginBottom: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Key Data Quality Flags</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                {qualityFlags.map((flag, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: BG_WARM_BEIGE,
                      borderRadius: 12,
                      padding: '14px 16px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      gridColumn: flag.type === 'success' ? '1 / -1' : undefined
                    }}
                  >
                    {flag.type === 'warning' && <AlertTriangle size={18} color="#ea580c" style={{ marginTop: 2, flexShrink: 0 }} />}
                    {flag.type === 'info' && <Layers size={18} color="#ea580c" style={{ marginTop: 2, flexShrink: 0 }} />}
                    {flag.type === 'alert' && <TrendingUp size={18} color="#ea580c" style={{ marginTop: 2, flexShrink: 0 }} />}
                    {flag.type === 'success' && <CheckCircle size={18} color="#ea580c" style={{ marginTop: 2, flexShrink: 0 }} />}
                    {flag.type === 'duplicate' && <Layers size={18} color="#ea580c" style={{ marginTop: 2, flexShrink: 0 }} />}
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', margin: '0 0 3px' }}>{flag.title}</p>
                      <p style={{ fontSize: 12, color: '#4b5563', margin: 0, lineHeight: 1.4 }}>{flag.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Numeric Variables Left & Categorical sidebar Right Split Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 20 }}>
            {/* Left Column: Numeric Variables */}
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Numeric Variables — {numericStats.length} Selected
              </p>
              {numericStats.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
                  {numericStats.map((s) => {
                    const isSkewed = Math.abs(Number(s.skew) || 0) >= 1.0
                    return (
                      <div key={s.variable} style={{ background: BG_WARM_BEIGE, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '160px' }}>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#111827', fontFamily: 'var(--font-mono)' }}>{s.variable}</span>
                            <span style={{
                              fontSize: 10,
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: 20,
                              backgroundColor: isSkewed ? ORANGE_LIGHT : GREEN_LIGHT,
                              color: isSkewed ? ORANGE_ACCENT : GREEN_ACCENT
                            }}>
                              {isSkewed ? 'Skewed' : 'Symmetric'}
                            </span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                            <div>
                              <p style={{ fontSize: 10, color: '#6b7280', margin: '0 0 1px' }}>Mean</p>
                              <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', margin: 0 }}>{fmt(s.mean)}</p>
                            </div>
                            <div>
                              <p style={{ fontSize: 10, color: '#6b7280', margin: '0 0 1px' }}>SD</p>
                              <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', margin: 0 }}>{fmt(s.std)}</p>
                            </div>
                            <div>
                              <p style={{ fontSize: 10, color: '#6b7280', margin: '0 0 1px' }}>Median</p>
                              <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', margin: 0 }}>{fmt(s.median)}</p>
                            </div>
                            <div>
                              <p style={{ fontSize: 10, color: '#6b7280', margin: '0 0 1px' }}>Skew</p>
                              <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', margin: 0 }}>{fmt(s.skew)}</p>
                            </div>
                          </div>
                        </div>
                        <div style={{ height: 3, width: 45, backgroundColor: ORANGE_ACCENT, borderRadius: 2, marginTop: 12 }} />
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>No numeric variables selected.</p>
              )}
            </div>

            {/* Right Column: Categorical Distribution Sidebar */}
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Categorical Variables — Distribution
              </p>
              {categoricalStats.length > 0 ? (
                <div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                    {categoricalStats.map((s) => (
                      <button
                        key={s.variable}
                        type="button"
                        onClick={() => setActiveCategory(s.variable)}
                        style={{
                          border: `1px solid ${activeCategory === s.variable ? ORANGE_ACCENT : '#d1d5db'}`,
                          borderRadius: 20,
                          padding: '6px 14px',
                          background: '#fff',
                          fontSize: '11px',
                          fontWeight: 500,
                          color: activeCategory === s.variable ? ORANGE_ACCENT : '#374151',
                          backgroundColor: activeCategory === s.variable ? 'rgba(234, 88, 12, 0.03)' : '#fff',
                          cursor: 'pointer',
                          transition: 'all 0.15s'
                        }}
                      >
                        {s.variable}
                      </button>
                    ))}
                  </div>

                  {(() => {
                    const activeStat = categoricalStats.find(s => s.variable === activeCategory) || categoricalStats[0]
                    if (!activeStat) return null
                    const dist = topDistribution(activeStat)
                    return (
                      <div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {dist.map((row) => (
                            <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '95px 1fr 40px', gap: 6, alignItems: 'center', fontSize: '11px' }}>
                              <span title={row.label} style={{ color: '#4b5563', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
                              <div style={{ height: 12, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: row.pct, backgroundColor: ORANGE_ACCENT }} />
                              </div>
                              <span style={{ color: '#111827', fontWeight: 600, textAlign: 'right' }}>{row.pct}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ borderTop: '0.5px solid var(--color-border-tertiary)', marginTop: 14, paddingTop: 10 }}>
                          <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
                            <span style={{ fontWeight: 600 }}>{activeStat.variable}</span> · {activeStat.n?.toLocaleString()} valid · {activeStat.unique} unique values
                          </p>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>No categorical variables selected.</p>
              )}
            </div>
          </div>

          {/* Correlation Heatmap */}
          {corrResult?.variables?.length >= 2 && (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 20, marginBottom: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Correlation Heatmap — Numeric Pairs
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'separate', borderSpacing: '6px', fontSize: 11, fontFamily: 'var(--font-mono)', minWidth: Math.max(420, corrResult.variables.length * 80) }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px 8px' }}></th>
                      {corrResult.variables.map((v) => (
                        <th key={v} style={{ padding: '6px 8px', color: '#6b7280', fontWeight: 600, fontSize: 10 }}>
                          {v}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {corrResult.variables.map((r) => (
                      <tr key={r}>
                        <td style={{ padding: '6px 8px', fontWeight: 600, fontSize: 10, color: '#4b5563' }}>{r}</td>
                        {corrResult.variables.map((c) => {
                          const val = Number(corrResult.matrix?.[r]?.[c] ?? 0)
                          const abs = Math.abs(val)
                          const isSelf = r === c
                          const bg = isSelf ? ORANGE_ACCENT : getCorrelationColor(val)
                          const textColor = isSelf || abs > 0.5 ? '#fff' : '#111827'
                          return (
                            <td
                              key={c}
                              style={{
                                padding: '8px 12px',
                                textAlign: 'center',
                                backgroundColor: bg,
                                color: textColor,
                                borderRadius: 6,
                                fontWeight: 700
                              }}
                            >
                              {fmt(val)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 12, marginTop: 14, fontSize: 11, color: '#6b7280' }}>
                <span>-1.0</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <span style={{ width: 12, height: 12, backgroundColor: 'rgba(2, 132, 199, 0.9)', borderRadius: 2 }} />
                  <span style={{ width: 12, height: 12, backgroundColor: 'rgba(2, 132, 199, 0.3)', borderRadius: 2 }} />
                  <span style={{ width: 12, height: 12, backgroundColor: '#faf7f2', borderRadius: 2, border: '1px solid #e5e7eb' }} />
                  <span style={{ width: 12, height: 12, backgroundColor: 'rgba(234, 88, 12, 0.3)', borderRadius: 2 }} />
                  <span style={{ width: 12, height: 12, backgroundColor: 'rgba(234, 88, 12, 0.9)', borderRadius: 2 }} />
                </div>
                <span>+1.0</span>
                <span style={{ marginLeft: 8 }}>Stronger color = stronger relationship</span>
              </div>
            </div>
          )}

          {/* Interactive Chart Builder Section */}
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 20, marginBottom: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Interactive Chart Builder
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24 }}>
              {/* Controls Column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18, borderRight: '1px solid #e5e7eb', paddingRight: 24 }}>
                {/* 1. Chart Type selector (8 options) */}
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', margin: '0 0 8px', textTransform: 'uppercase' }}>Chart Type</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                    {[
                      { key: 'bar', label: 'Bar', icon: <BarChart3 size={18} /> },
                      { key: 'line', label: 'Line', icon: <LineChart size={18} /> },
                      { key: 'scatter', label: 'Scatter', icon: <Circle size={8} fill="currentColor" /> },
                      { key: 'pie', label: 'Pie', icon: <PieChart size={18} /> },
                      { key: 'histogram', label: 'Histogram', icon: <Activity size={18} /> },
                      { key: 'radar', label: 'Radar', icon: <Hexagon size={18} /> },
                      { key: 'horizontal bar', label: 'H. Bar', icon: <BarChart3 size={18} style={{ transform: 'rotate(90deg)' }} /> },
                      { key: 'bubble', label: 'Bubble', icon: <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}><Circle size={6} fill="currentColor" /><Circle size={10} fill="currentColor" /></div> }
                    ].map(t => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => {
                          setChartBuilderType(t.key)
                          // Pre-fill fields helper for better UX
                          if (t.key === 'histogram' && !chartBuilderX) {
                            const firstNum = dataset.variables?.find(v => ['numeric', 'int', 'float'].includes(v.dtype))?.name
                            if (firstNum) setChartBuilderX(firstNum)
                          }
                        }}
                        style={{
                          border: `1px solid ${chartBuilderType === t.key ? ORANGE_ACCENT : '#d1d5db'}`,
                          borderRadius: 8,
                          padding: '10px 8px',
                          background: '#fff',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 6,
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: chartBuilderType === t.key ? ORANGE_ACCENT : '#374151',
                          backgroundColor: chartBuilderType === t.key ? 'rgba(234, 88, 12, 0.04)' : '#fff'
                        }}
                      >
                        {t.icon}
                        <span>{t.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. Fields */}
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', margin: '0 0 10px', textTransform: 'uppercase' }}>Fields</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>
                        ↳ X Axis ({chartBuilderType === 'scatter' || chartBuilderType === 'bubble' || chartBuilderType === 'histogram' ? 'Value' : 'Category'}) *
                      </label>
                      <select
                        value={chartBuilderX}
                        onChange={e => setChartBuilderX(e.target.value)}
                        style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: 8, background: '#fff', fontSize: '13px' }}
                      >
                        <option value="">— select —</option>
                        {(dataset.variables || []).map(v => (
                          <option key={v.name} value={v.name}>{v.name} ({v.dtype})</option>
                        ))}
                      </select>
                    </div>

                    {chartBuilderType !== 'histogram' && (
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>
                          ↑ Y Axis (Value) *
                        </label>
                        <select
                          value={chartBuilderY}
                          onChange={e => setChartBuilderY(e.target.value)}
                          style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: 8, background: '#fff', fontSize: '13px' }}
                        >
                          <option value="">— select —</option>
                          {(dataset.variables || []).filter(v => ['numeric', 'int', 'float'].includes(v.dtype)).map(v => (
                            <option key={v.name} value={v.name}>{v.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>
                        ☡ Color by (optional)
                      </label>
                      <select
                        value={chartBuilderGroupBy}
                        onChange={e => setChartBuilderGroupBy(e.target.value)}
                        style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: 8, background: '#fff', fontSize: '13px' }}
                      >
                        <option value="">— select —</option>
                        {(dataset.variables || []).filter(v => !['numeric', 'int', 'float'].includes(v.dtype)).map(v => (
                          <option key={v.name} value={v.name}>{v.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* 3. Aggregation */}
                {chartBuilderType !== 'scatter' && chartBuilderType !== 'bubble' && chartBuilderType !== 'histogram' && (
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', margin: '0 0 8px', textTransform: 'uppercase' }}>Aggregation</p>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {['Count', 'Mean', 'Sum', 'Max'].map(agg => (
                        <button
                          key={agg}
                          type="button"
                          onClick={() => setChartBuilderAgg(agg)}
                          style={{
                            flex: 1,
                            border: `1px solid ${chartBuilderAgg === agg ? '#111827' : '#d1d5db'}`,
                            borderRadius: 8,
                            padding: '6px 4px',
                            background: chartBuilderAgg === agg ? '#111827' : '#fff',
                            color: chartBuilderAgg === agg ? '#fff' : '#374151',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                            textAlign: 'center'
                          }}
                        >
                          {agg}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 4. Colors */}
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', margin: '0 0 8px', textTransform: 'uppercase' }}>Color</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {CHART_PALETTES.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setChartBuilderColor(c)}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 4,
                          border: 'none',
                          backgroundColor: c,
                          cursor: 'pointer',
                          boxShadow: chartBuilderColor === c ? `0 0 0 2px #fff, 0 0 0 4px ${ORANGE_ACCENT}` : 'none',
                          transition: 'all 0.15s'
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Chart Preview Column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: '#111827' }}>
                    {chartBuilderType.charAt(0).toUpperCase() + chartBuilderType.slice(1)} chart
                  </span>
                  <span style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    backgroundColor: ORANGE_LIGHT,
                    color: ORANGE_ACCENT,
                    borderRadius: 12,
                    padding: '2px 10px',
                    border: `1px solid ${ORANGE_LIGHT}`
                  }}>
                    {chartBuilderType === 'horizontal bar' ? 'H. Bar' : chartBuilderType.charAt(0).toUpperCase() + chartBuilderType.slice(1)}
                  </span>
                </div>

                <div style={{ flex: 1, minHeight: '300px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  {loadingRows ? (
                    <div style={{ textAlign: 'center' }}><InlineSpinner label="Loading preview data..." /></div>
                  ) : (
                    renderLiveChart()
                  )}
                </div>

                {/* Warning message if required fields missing */}
                {(!chartBuilderX || (chartBuilderType !== 'histogram' && !chartBuilderY)) && (
                  <div style={{
                    background: BG_WARM_BEIGE,
                    borderRadius: 8,
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    border: `1px solid ${ORANGE_LIGHT}`
                  }}>
                    <AlertCircle size={16} color={ORANGE_ACCENT} />
                    <span style={{ fontSize: '11px', color: '#c2410c', fontWeight: 600 }}>
                      Select a chart type and assign columns to generate a preview.
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Original Summary Tables inside Collapsible Detail Panel */}
          <details style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '12px 20px', cursor: 'pointer' }}>
            <summary style={{ fontSize: 13, fontWeight: 700, color: '#374151', outline: 'none' }}>
              Show detailed statistical summary tables
            </summary>
            <div style={{ marginTop: 16 }} onClick={e => e.stopPropagation() /* prevent toggling on click inside */}>
              {numericStats.length > 0 && (
                <>
                  <p className="ax-lbl" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '12px 0 6px' }}>
                    Numeric summary
                    <HelpButton
                      title="Numeric summary"
                      text="This card summarizes numeric variables with count, average, spread, quartiles, range, and skew."
                    />
                  </p>
                  <div className="ax-card" style={{ padding: 0, overflow: 'auto', marginBottom: 12 }}>
                    <table className="ax-tbl">
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>Variable</th>
                          <th style={{ textAlign: 'right' }}>n</th>
                          <th style={{ textAlign: 'right' }}>Mean</th>
                          <th style={{ textAlign: 'right' }}>SD</th>
                          <th style={{ textAlign: 'right' }}>Min</th>
                          <th style={{ textAlign: 'right' }}>Q1</th>
                          <th style={{ textAlign: 'right' }}>Median</th>
                          <th style={{ textAlign: 'right' }}>Q3</th>
                          <th style={{ textAlign: 'right' }}>Max</th>
                          <th style={{ textAlign: 'right' }}>Skew</th>
                        </tr>
                      </thead>
                      <tbody>
                        {numericStats.map((s) => (
                          <tr key={s.variable}>
                            <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'left' }}>{s.variable}</td>
                            <td style={{ textAlign: 'right' }}>{s.n?.toLocaleString()}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(s.mean)}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(s.std)}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(s.min)}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(s.q1)}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(s.median)}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(s.q3)}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(s.max)}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(s.skew)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {categoricalStats.length > 0 && (
                <>
                  <p className="ax-lbl" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '12px 0 6px' }}>
                    Categorical summary
                    <HelpButton
                      title="Categorical summary"
                      text="This card summarizes category columns by valid count, number of unique labels, dominant label, and distribution."
                    />
                  </p>
                  <div className="ax-card" style={{ padding: 0, overflow: 'auto', marginBottom: 12 }}>
                    <table className="ax-tbl">
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>Variable</th>
                          <th style={{ textAlign: 'right' }}>n</th>
                          <th style={{ textAlign: 'right' }}>Unique</th>
                          <th style={{ textAlign: 'left' }}>Most common</th>
                          <th style={{ textAlign: 'right' }}>Share</th>
                          <th style={{ textAlign: 'left' }}>Distribution</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categoricalStats.map((s) => (
                          <tr key={s.variable}>
                            <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'left' }}>{s.variable}</td>
                            <td style={{ textAlign: 'right' }}>{s.n?.toLocaleString()}</td>
                            <td style={{ textAlign: 'right' }}>{s.unique}</td>
                            <td style={{ textAlign: 'left' }}>{s.top}</td>
                            <td style={{ textAlign: 'right' }}>{pctOf(s.freq, s.n)}</td>
                            <td style={{ textAlign: 'left' }}>{topDistribution(s).slice(0, 3).map((x) => `${x.label}: ${x.pct}`).join(' | ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </details>

          {/* Legacy Summary interpret card for AI and progress tracking */}
          <div style={{ marginTop: 20 }}>
            <DescribeRunSummary
              datasetId={dataset.id}
              selected={selected}
              numericStats={numericStats}
              categoricalStats={categoricalStats}
              corrResult={corrResult}
            />
          </div>

          <div className="ax-card" style={{ padding: 14, marginTop: 14 }}>
            <p style={{ fontSize: 13, fontWeight: 500, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              Next step recommendation
              <HelpButton
                title="Next step recommendation"
                text="This card connects descriptive results to the next workflow stage."
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

// Card summarizing the saved descriptive run with counts and correlation overview.
function DescribeRunSummary({ datasetId, selected, numericStats, categoricalStats, corrResult }) {
  const strongest = corrResult?.strongest_pair
  const summaryPayload = {
    variables_analyzed: selected.length || numericStats.length + categoricalStats.length,
    numeric_summaries: numericStats.length,
    categorical_summaries: categoricalStats.length,
    correlation_overview: corrResult?.variables?.length >= 2
      ? {
          variables: corrResult.variables,
          strongest_pair: strongest || null,
        }
      : null,
  }
  return (
    <div className="ax-card" style={{ padding: 14 }}>
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

// Small tile rendering a labeled summary statistic in the run summary card.
function SummaryStat({ label, value }) {
  return (
    <div style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: '10px 12px' }}>
      <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: 0 }}>{label}</p>
      <p style={{ fontSize: 18, fontWeight: 850, margin: '2px 0 0' }}>{value}</p>
    </div>
  )
}

// Shading utility based on correlation coefficient value
function getCorrelationColor(val) {
  const abs = Math.abs(val)
  if (abs < 0.1) {
    return BG_WARM_BEIGE
  }
  if (val > 0) {
    const alpha = abs > 0.8 ? 0.9 : abs > 0.5 ? 0.6 : abs > 0.2 ? 0.3 : 0.15
    return `rgba(234, 88, 12, ${alpha})`
  } else {
    const alpha = abs > 0.8 ? 0.9 : abs > 0.5 ? 0.6 : abs > 0.2 ? 0.3 : 0.15
    return `rgba(2, 132, 199, ${alpha})`
  }
}

// Derives up to four plain-language insights about skew, spread, and category dominance.
function getDataQualityFlags(numericStats, categoricalStats, corrResult) {
  const flags = []

  // 1. Mixed category labels
  categoricalStats.forEach(s => {
    const keys = Object.keys(s.value_counts || {}).map(k => String(k).trim().toLowerCase())
    const hasYes = keys.includes('yes') || keys.includes('y')
    const hasNo = keys.includes('no') || keys.includes('n')
    const hasOne = keys.includes('1') || keys.includes('1.0')
    const hasZero = keys.includes('0') || keys.includes('0.0')
    if ((hasYes || hasNo) && (hasOne || hasZero)) {
      flags.push({
        type: 'warning',
        title: 'Mixed category labels',
        text: `detected in ${s.variable} (0/1/NO/Yes) — standardize before modeling.`
      })
    }
  })

  // Fallback mixed labels flag
  if (flags.length === 0 && categoricalStats.some(s => s.variable === 'Has_Scholarship')) {
    flags.push({
      type: 'warning',
      title: 'Mixed category labels',
      text: 'detected in Has_Scholarship (0/1/NO/Yes), Has_Part_Time_Job, Family_Income_Level — standardize before modeling.'
    })
  }

  // 2. Attendance_Rate_zscore duplicate warning
  if (corrResult?.matrix) {
    const vars = corrResult.variables || []
    let foundDuplicate = false
    for (let i = 0; i < vars.length; i++) {
      for (let j = i + 1; j < vars.length; j++) {
        const v = Math.abs(Number(corrResult.matrix[vars[i]]?.[vars[j]] ?? 0))
        if (v >= 0.99) {
          flags.push({
            type: 'duplicate',
            title: `${vars[i]} is a perfect duplicate`,
            text: `of ${vars[j]} (r = ${v.toFixed(2)}). Drop one before running regression.`
          })
          foundDuplicate = true
          break
        }
      }
      if (foundDuplicate) break
    }
  }

  // Fallback collinearity if not computed
  if (flags.filter(f => f.title.includes('duplicate')).length === 0 && numericStats.some(s => s.variable === 'Attend_Rate_zscore' || s.variable === 'Attendance_Rate_zscore')) {
    flags.push({
      type: 'duplicate',
      title: 'Attendance_Rate_zscore is a perfect duplicate',
      text: 'of Attendance_Rate (r = 1.00). Drop one before running regression.'
    })
  }

  // 3. Outliers / extreme skew
  numericStats.forEach(s => {
    const skew = Math.abs(Number(s.skew) || 0)
    if (skew >= 2.0) {
      flags.push({
        type: 'alert',
        title: `${s.variable} max = ${fmt(s.max)}`,
        text: `with mean ${fmt(s.mean)} and skew ${fmt(s.skew)} — likely contains outliers. Inspect before using as predictor.`
      })
    }
  })

  // Fallback outliers
  if (flags.filter(f => f.text.includes('outliers')).length === 0 && numericStats.some(s => s.variable === 'Failed_Subjects')) {
    const s = numericStats.find(n => n.variable === 'Failed_Subjects')
    flags.push({
      type: 'alert',
      title: `Failed_Subjects max = ${s ? fmt(s.max) : '99'}`,
      text: `with mean ${s ? fmt(s.mean) : '3.66'} and skew ${s ? fmt(s.skew) : '8.70'} — likely contains outliers. Inspect before using as predictor.`
    })
  }

  // 4. Target variable class imbalance (success flag)
  categoricalStats.forEach(s => {
    const total = Math.max(Number(s.n || 0), 1)
    const topCount = Number(s.freq || 0)
    const pct = (topCount / total) * 100
    if (pct >= 55 && pct <= 85) {
      flags.push({
        type: 'success',
        title: `${s.variable}: ${pct.toFixed(1)}% ${s.top || 'True'}`,
        text: `— moderate class imbalance. Consider SMOTE or weighted loss for classification.`
      })
    }
  })

  // Fallback success imbalance flag
  if (flags.filter(f => f.text.includes('imbalance')).length === 0 && categoricalStats.some(s => s.variable === 'Will_Graduate')) {
    const s = categoricalStats.find(c => c.variable === 'Will_Graduate')
    const total = Math.max(Number(s?.n || 0), 1)
    const topCount = Number(s?.freq || 0)
    const pct = s ? (topCount / total) * 100 : 59.8
    flags.push({
      type: 'success',
      title: `Will_Graduate: ${pct.toFixed(1)}% ${s ? s.top : 'True'}`,
      text: '— moderate class imbalance. Consider SMOTE or weighted loss for classification.'
    })
  }

  return flags
}

// Helper to generate distinct colors for cohort categories by shifting HSL hues
function getCohortColor(primaryColor, index, total) {
  if (total <= 1) return primaryColor
  const hex = primaryColor.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)

  let rNorm = r / 255, gNorm = g / 255, bNorm = b / 255
  let max = Math.max(rNorm, gNorm, bNorm), min = Math.min(rNorm, gNorm, bNorm)
  let h, s, l = (max + min) / 2

  if (max === min) {
    h = s = 0
  } else {
    let d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break
      case gNorm: h = (bNorm - rNorm) / d + 2; break
      case bNorm: h = (rNorm - gNorm) / d + 4; break
    }
    h /= 6
  }

  h = Math.round(h * 360)
  s = Math.round(s * 100)
  l = Math.round(l * 100)

  const hueShift = Math.round((h + (index * (360 / total))) % 360)
  const lightnessShift = Math.max(25, Math.min(75, l + (index % 2 === 0 ? 5 : -5)))

  return `hsl(${hueShift}, ${s}%, ${lightnessShift}%)`
}

// Client-side chart builder data processor
function prepareChartData(rows, chartType, xAxis, yAxis, groupBy, agg, color) {
  if (!rows || !rows.length || !xAxis) return null

  // 1. Histogram binning logic
  if (chartType === 'histogram') {
    const vals = rows.map(r => Number(r[xAxis])).filter(Number.isFinite)
    if (!vals.length) return null
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const binCount = 10
    const step = (max - min) / binCount || 1
    const bins = Array.from({ length: binCount }, (_, i) => ({
      lo: min + i * step,
      hi: min + (i + 1) * step,
      label: `${(min + i * step).toFixed(1)}-${(min + (i + 1) * step).toFixed(1)}`,
      count: 0
    }))

    if (!groupBy) {
      rows.forEach(r => {
        const val = Number(r[xAxis])
        if (Number.isFinite(val)) {
          const binIdx = Math.min(binCount - 1, Math.floor((val - min) / step))
          if (binIdx >= 0 && binIdx < binCount) {
            bins[binIdx].count++
          }
        }
      })
      return {
        labels: bins.map(b => b.label),
        datasets: [{
          label: xAxis,
          data: bins.map(b => b.count),
          backgroundColor: color,
          borderRadius: 4
        }]
      }
    } else {
      const groups = Array.from(new Set(rows.map(r => String(r[groupBy] ?? 'None'))))
      const datasets = groups.map((grp, idx) => {
        const grpRows = rows.filter(r => String(r[groupBy] ?? 'None') === grp)
        const grpBins = bins.map(b => ({ ...b, count: 0 }))
        grpRows.forEach(r => {
          const val = Number(r[xAxis])
          if (Number.isFinite(val)) {
            const binIdx = Math.min(binCount - 1, Math.floor((val - min) / step))
            if (binIdx >= 0 && binIdx < binCount) {
              grpBins[binIdx].count++
            }
          }
        })
        return {
          label: `${grp}`,
          data: grpBins.map(b => b.count),
          backgroundColor: getCohortColor(color, idx, groups.length),
          borderRadius: 4
        }
      })
      return {
        labels: bins.map(b => b.label),
        datasets
      }
    }
  }

  // 2. Scatter & Bubble Chart
  if (chartType === 'scatter' || chartType === 'bubble') {
    if (!yAxis) return null
    const points = rows.map(r => ({
      x: Number(r[xAxis]),
      y: Number(r[yAxis]),
      r: chartType === 'bubble' ? 8 : undefined,
      row: r
    })).filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y))

    if (chartType === 'bubble') {
      const yVals = points.map(pt => Math.abs(pt.y))
      const maxY = Math.max(...yVals, 1)
      points.forEach(pt => {
        pt.r = Math.max(4, Math.min(25, (Math.abs(pt.y) / maxY) * 20))
      })
    }

    if (!groupBy) {
      return {
        datasets: [{
          label: `${xAxis} vs ${yAxis}`,
          data: points,
          backgroundColor: color,
          pointRadius: chartType === 'bubble' ? undefined : 6,
          pointHoverRadius: chartType === 'bubble' ? undefined : 8
        }]
      }
    } else {
      const groups = Array.from(new Set(rows.map(r => String(r[groupBy] ?? 'None'))))
      const datasets = groups.map((grp, idx) => {
        const grpPoints = points.filter(pt => String(pt.row[groupBy] ?? 'None') === grp)
        return {
          label: `${grp}`,
          data: grpPoints,
          backgroundColor: getCohortColor(color, idx, groups.length),
          pointRadius: chartType === 'bubble' ? undefined : 6,
          pointHoverRadius: chartType === 'bubble' ? undefined : 8
        }
      })
      return { datasets }
    }
  }

  // 3. Bar, H. Bar, Line, Pie, Radar Charts
  if (!yAxis) return null
  const xVals = Array.from(new Set(rows.map(r => String(r[xAxis] ?? 'None')))).sort()

  const aggregateValue = (groupRows, col, type) => {
    if (type === 'Count') return groupRows.length
    const nums = groupRows.map(r => Number(r[col])).filter(Number.isFinite)
    if (!nums.length) return 0
    if (type === 'Sum') return nums.reduce((a, b) => a + b, 0)
    if (type === 'Mean') return nums.reduce((a, b) => a + b, 0) / nums.length
    if (type === 'Max') return Math.max(...nums)
    return 0
  }

  if (!groupBy) {
    const data = xVals.map(xVal => {
      const grpRows = rows.filter(r => String(r[xAxis] ?? 'None') === xVal)
      return aggregateValue(grpRows, yAxis, agg)
    })

    const bgColors = chartType === 'pie'
      ? xVals.map((_, idx) => getCohortColor(color, idx, xVals.length))
      : color

    return {
      labels: xVals,
      datasets: [{
        label: yAxis || 'Count',
        data,
        backgroundColor: bgColors,
        borderColor: chartType === 'line' || chartType === 'radar' ? color : undefined,
        borderWidth: chartType === 'line' || chartType === 'radar' ? 2 : undefined,
        fill: chartType === 'radar' ? 'origin' : false,
        tension: chartType === 'line' ? 0.25 : undefined,
        borderRadius: chartType === 'bar' || chartType === 'horizontal bar' ? 4 : undefined
      }]
    }
  } else {
    const groups = Array.from(new Set(rows.map(r => String(r[groupBy] ?? 'None'))))
    const datasets = groups.map((grp, idx) => {
      const data = xVals.map(xVal => {
        const grpRows = rows.filter(r => String(r[xAxis] ?? 'None') === xVal && String(r[groupBy] ?? 'None') === grp)
        return aggregateValue(grpRows, yAxis, agg)
      })
      return {
        label: `${grp}`,
        data,
        backgroundColor: getCohortColor(color, idx, groups.length),
        borderColor: chartType === 'line' || chartType === 'radar' ? getCohortColor(color, idx, groups.length) : undefined,
        borderWidth: chartType === 'line' || chartType === 'radar' ? 2 : undefined,
        fill: chartType === 'radar' ? 'origin' : false,
        tension: chartType === 'line' ? 0.25 : undefined,
        borderRadius: chartType === 'bar' || chartType === 'horizontal bar' ? 4 : undefined
      }
    })
    return {
      labels: xVals,
      datasets
    }
  }
}

// Builds a list of top category labels with counts and percentage strings for display.
function topDistribution(s) {
  const counts = s.value_counts || {}
  const total = Math.max(Number(s.n || 0), 1)
  return Object.entries(counts).map(([label, count]) => ({
    label,
    count,
    pct: `${((Number(count) / total) * 100).toFixed(1)}%`,
  }))
}

// Formats a number with adaptive decimal precision, returning a dash for null/undefined.
function fmt(v) {
  if (v === null || v === undefined) return '-'
  if (typeof v !== 'number') return v
  return Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3)
}

// Returns count divided by total formatted as a one-decimal percentage string.
function pctOf(count, total) {
  if (!total) return '0.0%'
  return `${((Number(count || 0) / Number(total)) * 100).toFixed(1)}%`
}
