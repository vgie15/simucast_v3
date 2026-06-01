/* ============================================================
 * PAGE: DESCRIBE / DESCRIPTIVE STATISTICS
 * Keywords: describe, descriptives, summary, histogram, mean, std, distribution
 * ============================================================ */
import React, { useEffect, useState, useRef } from 'react'
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
import { Bar, Line, Scatter, Pie, Radar, Bubble, Chart } from 'react-chartjs-2'
import { api } from '../../api'
import { InlineSpinner } from '../common/LoadingStates'
import {
  BarChart3,
  Bookmark,
  ChevronDown,
  Copy,
  Download,
  Hash,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  Lightbulb,
  Pencil,
  Play,
  Sigma,
  Tags,
  X,
  LayoutGrid
} from 'lucide-react'
import { prepareChartData, getCohortColor } from '../../utils/chartData'

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

const ORANGE_ACCENT = '#ea580c'
const ORANGE_LIGHT = '#ffedd5'
const BG_WARM_BEIGE = '#faf7f2'

const CB_PALETTES = {
  standard:   ['#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#f59e0b', '#6366f1', '#14b8a6'],
  colorblind: ['#0077BB', '#EE7733', '#009988', '#CC3311', '#33BBEE', '#EE3377', '#BBBBBB', '#888888'],
  mono:       ['#111827', '#374151', '#6b7280', '#9ca3af', '#d1d5db', '#4b5563', '#1f2937', '#ea580c'],
}
const CB_COLORS = CB_PALETTES.standard
const CB_CHART_TYPES = [
  { key: 'bar', label: 'Bar' },
  { key: 'line', label: 'Line' },
  { key: 'scatter', label: 'Scatter' },
  { key: 'pie', label: 'Pie' },
  { key: 'histogram', label: 'Histogram' },
  { key: 'radar', label: 'Radar' },
  { key: 'horizontal bar', label: 'H. Bar' },
  { key: 'bubble', label: 'Bubble' },
]

const describePageCache = new Map()

export default function DescribePage({ dataset, initialData }) {
  // Correlation heatmap
  const [corrResult, setCorrResult] = useState(null)
  const [corrLoading, setCorrLoading] = useState(false)
  const [selectedCorrCell, setSelectedCorrCell] = useState(null)

  // Chart builder
  const [datasetRows, setDatasetRows] = useState([])
  const [loadingRows, setLoadingRows] = useState(false)
  const [chartBuilderType, setChartBuilderType] = useState('bar')
  const [chartBuilderX, setChartBuilderX] = useState('')
  const [chartBuilderY, setChartBuilderY] = useState('')
  const [chartBuilderGroupBy, setChartBuilderGroupBy] = useState('')
  const [chartBuilderAgg, setChartBuilderAgg] = useState('Mean')
  const [chartBuilderColor, setChartBuilderColor] = useState('#f97316')
  const [chartTitle, setChartTitle] = useState('Bar chart')
  const [savedCharts, setSavedCharts] = useState([])
  const [savedChartsDatasetId, setSavedChartsDatasetId] = useState(null)
  const [activeChartId, setActiveChartId] = useState(null)
  const [compareMode, setCompareMode] = useState(false)
  const [compareSelected, setCompareSelected] = useState([])
  const [expandChart, setExpandChart] = useState(false)
  const [cbToast, setCbToast] = useState(null)
  const [cbShowLabels, setCbShowLabels] = useState(false)
  const [cbSortOrder, setCbSortOrder] = useState('default')
  const [cbPalette, setCbPalette] = useState('standard')
  const [cbShowLegend, setCbShowLegend] = useState(false)
  const [chartNote, setChartNote] = useState('')
  const [titleHovered, setTitleHovered] = useState(false)
  const chartRef = useRef(null)
  const cbToastRef = useRef(null)

  // Descriptives
  const [selectedVars, setSelectedVars] = useState([])
  const [descResult, setDescResult] = useState(null)
  const [descLoading, setDescLoading] = useState(false)
  const [expandedVarRows, setExpandedVarRows] = useState(new Set())
  const [activeCatVar, setActiveCatVar] = useState(null)
  const [activeDescribeSection, setActiveDescribeSection] = useState(() => {
    try {
      const saved = window.localStorage.getItem(`simucast.descSection.${dataset?.id}`)
      return saved || 'overview'
    } catch { return 'overview' }
  })

  // Restore saved charts from localStorage per dataset
  useEffect(() => {
    if (!dataset?.id) {
      setSavedCharts([])
      setSavedChartsDatasetId(null)
      return
    }
    try {
      const saved = window.localStorage.getItem(`simucast.savedCharts.${dataset.id}`)
      setSavedCharts(saved ? JSON.parse(saved) : [])
    } catch {
      setSavedCharts([])
    } finally {
      setSavedChartsDatasetId(dataset.id)
    }
  }, [dataset?.id])

  // Restore chart builder state from localStorage per dataset
  useEffect(() => {
    if (!dataset?.id) return
    try {
      const saved = window.localStorage.getItem(`simucast.chartBuilder.${dataset.id}`)
      if (saved) {
        const s = JSON.parse(saved)
        if (s.chartBuilderType) setChartBuilderType(s.chartBuilderType)
        if (s.chartBuilderX !== undefined) setChartBuilderX(s.chartBuilderX)
        if (s.chartBuilderY !== undefined) setChartBuilderY(s.chartBuilderY)
        if (s.chartBuilderGroupBy !== undefined) setChartBuilderGroupBy(s.chartBuilderGroupBy)
        if (s.chartBuilderAgg) setChartBuilderAgg(s.chartBuilderAgg)
        if (s.chartBuilderColor) setChartBuilderColor(s.chartBuilderColor)
        if (s.chartTitle) setChartTitle(s.chartTitle)
        if (s.chartNote !== undefined) setChartNote(s.chartNote)
        if (s.cbShowLabels !== undefined) setCbShowLabels(s.cbShowLabels)
        if (s.cbShowLegend !== undefined) setCbShowLegend(s.cbShowLegend)
        if (s.cbSortOrder) setCbSortOrder(s.cbSortOrder)
      }
    } catch {}
  }, [dataset?.id])

  useEffect(() => {
    if (!dataset?.id || savedChartsDatasetId !== dataset.id) return
    window.localStorage.setItem(`simucast.savedCharts.${dataset.id}`, JSON.stringify(savedCharts))
  }, [savedCharts, savedChartsDatasetId, dataset?.id])

  // Persist chart builder state to localStorage
  useEffect(() => {
    if (!dataset?.id) return
    window.localStorage.setItem(`simucast.chartBuilder.${dataset.id}`, JSON.stringify({
      chartBuilderType, chartBuilderX, chartBuilderY,
      chartBuilderGroupBy, chartBuilderAgg, chartBuilderColor,
      chartTitle, chartNote, cbShowLabels, cbShowLegend, cbSortOrder
    }))
  }, [dataset?.id, chartBuilderType, chartBuilderX, chartBuilderY, chartBuilderGroupBy, chartBuilderAgg, chartBuilderColor, chartTitle, chartNote, cbShowLabels, cbShowLegend, cbSortOrder])

  // Restore latest correlation result; auto-run if none saved yet
  useEffect(() => {
    if (!dataset?.id) { setCorrResult(null); return }
    if (initialData?.tab === 'describe' && initialData?.datasetId === dataset.id && initialData.corr) {
      const latest = initialData.corr.analyses?.[0]
      if (latest) setCorrResult(latest.result)
      return
    }
    const ck = `${dataset.id}|${dataset.current_stage_id}|corr`
    const cached = describePageCache.get(ck)
    if (cached) { setCorrResult(cached); return }
    api.listAnalyses(dataset.id, 'test_corr', 1)
      .then(({ analyses }) => {
        if (analyses?.[0]) {
          const r = analyses[0].result
          describePageCache.set(ck, r)
          setCorrResult(r)
        } else {
          const numericVars = (dataset.variables || [])
            .filter(v => ['numeric', 'int', 'float'].includes(v.dtype))
            .map(v => v.name)
          if (numericVars.length >= 2) {
            api.runTest(dataset.id, { kind: 'corr', variables: numericVars })
              .then(corr => { describePageCache.set(ck, corr); setCorrResult(corr) })
              .catch(() => {})
          }
        }
      })
      .catch(() => {})
  }, [dataset?.id, dataset?.current_stage_id])

  // Load dataset rows for chart builder
  useEffect(() => {
    if (!dataset?.id) return
    if (initialData?.tab === 'describe' && initialData?.datasetId === dataset.id && initialData.rows) {
      setDatasetRows(initialData.rows.rows || [])
      setLoadingRows(false)
      return
    }
    const ck = `${dataset.id}|${dataset.current_stage_id}|rows`
    const cached = describePageCache.get(ck)
    if (cached) { setDatasetRows(cached); setLoadingRows(false); return }
    setLoadingRows(true)
    api.getRows(dataset.id, 1, 10000, dataset.current_stage_id)
      .then(res => { describePageCache.set(ck, res.rows || []); setDatasetRows(res.rows || []) })
      .catch(err => console.error('Failed to load dataset rows:', err))
      .finally(() => setLoadingRows(false))
  }, [dataset?.id, dataset?.current_stage_id, initialData?.datasetId])

  // Auto-update chart title, legend default, and sort when type changes
  useEffect(() => {
    if (!activeChartId) {
      const label = chartBuilderType === 'horizontal bar' ? 'H. Bar chart' : chartBuilderType.charAt(0).toUpperCase() + chartBuilderType.slice(1) + ' chart'
      setChartTitle(label)
      setCbShowLegend(['pie', 'radar'].includes(chartBuilderType))
      setCbSortOrder('default')
    }
  }, [chartBuilderType])

  useEffect(() => {
    if (!dataset?.variables) { setSelectedVars([]); return }
    setSelectedVars(dataset.variables.map(v => v.name))
  }, [dataset?.id])

  useEffect(() => {
    if (!dataset?.id) { setDescResult(null); return }
    if (initialData?.tab === 'describe' && initialData?.datasetId === dataset.id && initialData.describe) {
      const r = initialData.describe.analyses?.[0]?.result
      if (r) {
        setDescResult(r)
        const firstCat = (r.stats || []).find(s => s.kind === 'categorical')
        if (firstCat) setActiveCatVar(prev => prev || firstCat.variable)
        return
      }
    }
    const ck = `${dataset.id}|${dataset.current_stage_id}|desc`
    const cached = describePageCache.get(ck)
    if (cached) {
      setDescResult(cached.result)
      if (cached.firstCat) setActiveCatVar(cached.firstCat)
      return
    }
    api.listAnalyses(dataset.id, 'describe', 1)
      .then(({ analyses }) => {
        if (analyses?.[0]) {
          const r = analyses[0].result
          const firstCat = (r.stats || []).find(s => s.kind === 'categorical')
          describePageCache.set(ck, { result: r, firstCat: firstCat?.variable })
          setDescResult(r)
          if (firstCat) setActiveCatVar(prev => prev || firstCat.variable)
        } else {
          // No saved result yet — auto-run for all variables
          const allVars = (dataset.variables || []).map(v => v.name)
          if (!allVars.length) return
          setDescLoading(true)
          api.describe(dataset.id, { variables: allVars })
            .then(result => {
              const firstCat = (result.stats || []).find(s => s.kind === 'categorical')
              describePageCache.set(ck, { result, firstCat: firstCat?.variable })
              setDescResult(result)
              if (firstCat) setActiveCatVar(prev => prev || firstCat.variable)
            })
            .catch(() => {})
            .finally(() => setDescLoading(false))
        }
      })
      .catch(() => {})
  }, [dataset?.id, dataset?.current_stage_id])

  if (!dataset) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>

  const runCorrelation = async () => {
    const numericVars = (dataset.variables || [])
      .filter(v => ['numeric', 'int', 'float'].includes(v.dtype))
      .map(v => v.name)
    if (numericVars.length < 2) return
    setCorrLoading(true)
    try {
      const corr = await api.runTest(dataset.id, { kind: 'corr', variables: numericVars })
      setCorrResult(corr)
    } finally {
      setCorrLoading(false)
    }
  }

  const runDescriptives = async () => {
    if (!selectedVars.length || descLoading) return
    setDescLoading(true)
    try {
      const result = await api.describe(dataset.id, { variables: selectedVars })
      setDescResult(result)
      const firstCat = (result.stats || []).find(s => s.kind === 'categorical')
      if (firstCat) setActiveCatVar(prev => prev || firstCat.variable)
    } catch (e) {
      console.error('Describe failed:', e)
    } finally {
      setDescLoading(false)
    }
  }

  const renderLiveChart = () => {
    let chartData = prepareChartData(
      datasetRows, chartBuilderType, chartBuilderX, chartBuilderY,
      chartBuilderGroupBy, chartBuilderAgg, chartBuilderColor
    )
    if (!chartData) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '300px', color: '#9ca3af', gap: '12px' }}>
          <BarChart3 size={48} strokeWidth={1} />
          <span style={{ fontSize: '13px', fontWeight: '500', color: '#6b7280' }}>Assign required fields to see a preview</span>
        </div>
      )
    }

    // Apply sort order for bar charts
    if ((chartBuilderType === 'bar' || chartBuilderType === 'horizontal bar') && cbSortOrder !== 'default' && chartData.labels) {
      const pairs = chartData.labels.map((label, i) => ({ label, vals: chartData.datasets.map(d => d.data[i]) }))
      const sorted = [...pairs].sort((a, b) => {
        const av = Number(a.vals[0] ?? 0), bv = Number(b.vals[0] ?? 0)
        return cbSortOrder === 'asc' ? av - bv : bv - av
      })
      chartData = {
        ...chartData,
        labels: sorted.map(p => p.label),
        datasets: chartData.datasets.map((d, di) => ({ ...d, data: sorted.map(p => p.vals[di]) }))
      }
    }

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: cbShowLegend, position: 'bottom', labels: { font: { size: 10 } } } },
      scales: chartBuilderType !== 'pie' && chartBuilderType !== 'radar' ? {
        x: { ticks: { font: { size: 10 } } },
        y: { ticks: { font: { size: 10 } } }
      } : undefined
    }
    if (chartBuilderType === 'horizontal bar') options.indexAxis = 'y'

    const labelPlugin = cbShowLabels ? {
      id: 'cbdatalabels',
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx
        const ctype = chart.config.type
        chart.data.datasets.forEach((dataset, di) => {
          const meta = chart.getDatasetMeta(di)
          if (meta.hidden) return
          if (ctype === 'pie' || ctype === 'doughnut') {
            const total = dataset.data.reduce((s, v) => s + (Number(v) || 0), 0)
            meta.data.forEach((arc, j) => {
              const val = Number(dataset.data[j])
              if (!val || !total) return
              const pct = ((val / total) * 100).toFixed(1) + '%'
              const pos = arc.tooltipPosition()
              ctx.save()
              ctx.fillStyle = '#fff'
              ctx.font = 'bold 11px sans-serif'
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillText(pct, pos.x, pos.y)
              ctx.restore()
            })
          } else {
            meta.data.forEach((element, j) => {
              const raw = dataset.data[j]
              const val = typeof raw === 'object' && raw !== null ? raw.y : raw
              if (val == null || isNaN(Number(val))) return
              const label = Number.isInteger(Number(val)) ? String(Math.round(Number(val))) : Number(val).toFixed(2)
              const pos = element.tooltipPosition()
              ctx.save()
              ctx.fillStyle = '#374151'
              ctx.font = 'bold 11px sans-serif'
              ctx.textAlign = 'center'
              ctx.textBaseline = 'bottom'
              ctx.fillText(label, pos.x, pos.y - 4)
              ctx.restore()
            })
          }
        })
      }
    } : null
    const plugins = labelPlugin ? [labelPlugin] : []
    const labelKey = cbShowLabels ? 'labels-on' : 'labels-off'

    switch (chartBuilderType) {
      case 'bar': case 'horizontal bar': return <Bar key={labelKey} ref={chartRef} data={chartData} options={options} plugins={plugins} />
      case 'line': return <Line key={labelKey} ref={chartRef} data={chartData} options={options} plugins={plugins} />
      case 'scatter': return <Scatter key={labelKey} ref={chartRef} data={chartData} options={options} plugins={plugins} />
      case 'pie': return <Pie key={labelKey} ref={chartRef} data={chartData} options={options} plugins={plugins} />
      case 'histogram': return <Bar key={labelKey} ref={chartRef} data={chartData} options={options} plugins={plugins} />
      case 'radar': return <Radar key={labelKey} ref={chartRef} data={chartData} options={options} plugins={plugins} />
      case 'bubble': return <Bubble key={labelKey} ref={chartRef} data={chartData} options={options} plugins={plugins} />
      default: return null
    }
  }

  const renderCompareChart = (sc) => {
    const cd = prepareChartData(datasetRows, sc.type, sc.xAxis, sc.yAxis, sc.colorBy, sc.aggregation, sc.color)
    if (!cd) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', fontSize: 11 }}>No data</div>
    const opts = {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: sc.type !== 'pie' && sc.type !== 'radar' ? { x: { ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 9 } } } } : undefined
    }
    if (sc.type === 'horizontal bar') opts.indexAxis = 'y'
    switch (sc.type) {
      case 'bar': case 'horizontal bar': return <Bar data={cd} options={opts} />
      case 'line': return <Line data={cd} options={opts} />
      case 'scatter': return <Scatter data={cd} options={opts} />
      case 'pie': return <Pie data={cd} options={opts} />
      case 'histogram': return <Bar data={cd} options={opts} />
      case 'radar': return <Radar data={cd} options={opts} />
      case 'bubble': return <Bubble data={cd} options={opts} />
      default: return null
    }
  }

  const showCbToast = (msg) => {
    if (cbToastRef.current) clearTimeout(cbToastRef.current)
    setCbToast(msg)
    cbToastRef.current = setTimeout(() => setCbToast(null), 2200)
  }

  const handleChartTitleChange = (value) => {
    setChartTitle(value)
    if (activeChartId) {
      setSavedCharts(prev => prev.map(sc => sc.id === activeChartId ? { ...sc, title: value } : sc))
    }
  }

  const handleSaveChart = () => {
    const newChart = {
      id: Date.now(), title: chartTitle, type: chartBuilderType,
      xAxis: chartBuilderX, yAxis: chartBuilderY, colorBy: chartBuilderGroupBy,
      aggregation: chartBuilderAgg, color: chartBuilderColor,
      note: chartNote, showLabels: cbShowLabels, showLegend: cbShowLegend, sortOrder: cbSortOrder
    }
    const willTruncate = savedCharts.length >= 8
    setSavedCharts(prev => { const u = [...prev, newChart]; return u.length > 8 ? u.slice(1) : u })
    setActiveChartId(newChart.id)
    showCbToast(willTruncate ? 'Max 8 charts saved — oldest removed' : `Chart saved — ${newChart.title}`)
  }

  const handleLoadChart = (sc) => {
    setChartBuilderType(sc.type); setChartBuilderX(sc.xAxis); setChartBuilderY(sc.yAxis)
    setChartBuilderGroupBy(sc.colorBy); setChartBuilderAgg(sc.aggregation); setChartBuilderColor(sc.color)
    setChartTitle(sc.title); setActiveChartId(sc.id)
    setChartNote(sc.note || '')
    setCbShowLabels(sc.showLabels ?? false)
    setCbShowLegend(sc.showLegend ?? ['pie', 'radar'].includes(sc.type))
    setCbSortOrder(sc.sortOrder || 'default')
  }

  const handleDeleteChart = (id) => {
    setSavedCharts(prev => prev.filter(s => s.id !== id))
    if (activeChartId === id) setActiveChartId(null)
    setCompareSelected(prev => prev.filter(x => x !== id))
    showCbToast('Chart removed')
  }

  const handleDuplicateChart = () => {
    const newChart = {
      id: Date.now(), title: `Copy of ${chartTitle}`, type: chartBuilderType,
      xAxis: chartBuilderX, yAxis: chartBuilderY, colorBy: chartBuilderGroupBy,
      aggregation: chartBuilderAgg, color: chartBuilderColor,
      note: chartNote, showLabels: cbShowLabels, showLegend: cbShowLegend, sortOrder: cbSortOrder
    }
    setSavedCharts(prev => { const u = [...prev, newChart]; return u.length > 8 ? u.slice(1) : u })
    setActiveChartId(newChart.id)
    setChartTitle(newChart.title)
    showCbToast('Chart duplicated')
  }

  const handleDownloadChart = () => {
    if (!chartRef.current) { showCbToast('Render a chart first'); return }
    try {
      const url = chartRef.current.toBase64Image('image/png', 1)
      const link = document.createElement('a')
      link.href = url
      link.download = `${chartTitle.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.png`
      link.click()
      showCbToast('Chart downloaded as PNG')
    } catch { showCbToast('Download failed') }
  }

  const cbTypeLabel = chartBuilderType === 'horizontal bar' ? 'H. Bar' : chartBuilderType.charAt(0).toUpperCase() + chartBuilderType.slice(1)

  const cbInsight = (() => {
    if (!chartBuilderX || !datasetRows.length) return null
    if (chartBuilderType === 'histogram') {
      const vals = datasetRows.map(r => Number(r[chartBuilderX])).filter(Number.isFinite)
      if (vals.length < 2) return null
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      return `${chartBuilderX} ranges from ${Math.min(...vals).toFixed(1)} to ${Math.max(...vals).toFixed(1)} with a mean of ${mean.toFixed(2)}.`
    }
    if (!chartBuilderY) return null
    const groups = {}
    datasetRows.forEach(r => {
      const k = String(r[chartBuilderX] ?? ''); const v = Number(r[chartBuilderY])
      if (k && Number.isFinite(v)) { if (!groups[k]) groups[k] = []; groups[k].push(v) }
    })
    const keys = Object.keys(groups)
    if (keys.length < 2) return null
    const aggVal = (vals) => {
      if (chartBuilderAgg === 'Count') return vals.length
      if (chartBuilderAgg === 'Mean') return vals.reduce((a, b) => a + b, 0) / vals.length
      if (chartBuilderAgg === 'Sum') return vals.reduce((a, b) => a + b, 0)
      if (chartBuilderAgg === 'Max') return Math.max(...vals)
      return 0
    }
    const ranked = keys.map(k => ({ k, v: aggVal(groups[k]) })).sort((a, b) => b.v - a.v)
    const top = ranked[0], bot = ranked[ranked.length - 1]
    return `${top.k} has the highest ${chartBuilderAgg.toLowerCase()} ${chartBuilderY} (${top.v.toFixed(2)})${bot.k !== top.k ? ` — ${bot.k} has the lowest (${bot.v.toFixed(2)}).` : '.'}`
  })()

  const numericStats = (descResult?.stats || []).filter(s => s.kind === 'numeric')
  const catStats = (descResult?.stats || []).filter(s => s.kind === 'categorical')
  const skewedVars = numericStats.filter(s => Math.abs(s.skew ?? 0) >= 1)
  const avgValidN = numericStats.length ? Math.round(numericStats.reduce((a, s) => a + (s.n ?? 0), 0) / numericStats.length) : null
  const strongestCorrPair = getTopCorrelations(corrResult, 1)[0] || null
  const totalRows = numericStats[0]?.n ?? catStats[0]?.n ?? null

  const qualityFlags = (() => {
    const flags = []
    ;(descResult?.stats || []).forEach(s => {
      if (s.kind === 'numeric' && s.skew != null && Math.abs(s.skew) >= 2) {
        flags.push({ type: 'outlier', variable: s.variable, skew: Math.abs(s.skew), title: `${s.variable} max = ${s.max != null ? Math.round(s.max) : '?'}, skew = ${Math.abs(s.skew).toFixed(2)}`, desc: 'Likely contains outliers — inspect before using as predictor', action: 'Fix in Outliers →' })
      }
      if (s.kind === 'categorical') {
        const vcKeys = Object.keys(s.value_counts || {})
        const lower = vcKeys.map(v => v.toLowerCase())
        const truthy = ['true', 'yes', '1', 'y', 'graduated', 'pass']
        const falsy = ['false', 'no', '0', 'n', 'fail', 'not graduated']
        const hitT = lower.filter(v => truthy.includes(v))
        const hitF = lower.filter(v => falsy.includes(v))
        if (hitT.length > 1 || hitF.length > 1 || (hitT.length >= 1 && hitF.length >= 1 && vcKeys.length > 2)) {
          flags.push({ type: 'mixed_labels', variable: s.variable, title: `${s.variable} — mixed labels detected`, desc: `Values ${vcKeys.slice(0, 4).join('/')} represent the same binary — standardize before modeling`, action: 'Fix in Labels →' })
        }
        if (s.n && s.freq && s.freq / s.n > 0.55) {
          const pct = ((s.freq / s.n) * 100).toFixed(1)
          flags.push({ type: 'imbalance', variable: s.variable, title: `${s.variable} — ${pct}% ${s.top}`, desc: 'Moderate class imbalance — consider SMOTE or weighted loss for classification', action: 'Learn more →' })
        }
      }
    })
    return flags
  })()

  const groupedQualityFlags = (() => {
    const mixedLabels = qualityFlags.filter(flag => flag.type === 'mixed_labels')
    const outliers = qualityFlags.filter(flag => flag.type === 'outlier')
    const imbalances = qualityFlags.filter(flag => flag.type === 'imbalance')
    const otherFlags = qualityFlags.filter(flag => !['mixed_labels', 'outlier', 'imbalance'].includes(flag.type))
    const grouped = []

    if (mixedLabels.length) {
      grouped.push({
        type: 'mixed_labels',
        variable: '',
        title: `Mixed labels in ${mixedLabels.length} column${mixedLabels.length === 1 ? '' : 's'}`,
        desc: mixedLabels.map(flag => flag.variable).join(', '),
        action: 'Fix in Labels →',
      })
    }

    if (outliers.length) {
      grouped.push({
        type: 'outlier',
        variable: '',
        title: `Outliers detected in ${outliers.length} column${outliers.length === 1 ? '' : 's'}`,
        desc: outliers.map(flag => `${flag.variable} skew=${Number(flag.skew || 0).toFixed(2)}`).join(', '),
        action: 'Fix in Outliers →',
      })
    }

    return [...grouped, ...imbalances, ...otherFlags]
  })()

  const activeCatStat = catStats.find(s => s.variable === activeCatVar)
  const jumpToDescribeSection = (section) => {
    setActiveDescribeSection(section)
    try { window.localStorage.setItem(`simucast.descSection.${dataset?.id}`, section) } catch {}
    requestAnimationFrame(() => {
      document.querySelector('.ax-desc-right-scroll')?.scrollTo({ top: 0, behavior: 'auto' })
      window.scrollTo({ top: 0, behavior: 'auto' })
    })
  }
  const describeNavItems = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, badge: `${qualityFlags.length} flags` },
    { id: 'numeric', label: 'Numeric variables', icon: Hash, badge: numericStats.length },
    { id: 'categorical', label: 'Categorical variables', icon: Tags, badge: catStats.length },
    { id: 'correlations', label: 'Correlations', icon: Sigma, badge: strongestCorrPair ? `r=${Math.abs(strongestCorrPair.val).toFixed(2)}` : 'run' },
    { id: 'chart-builder', label: 'Chart builder', icon: BarChart3, badge: `${savedCharts.length} saved` },
  ]

  return (
    <div className="ax-desc-layout ax-desc-redesign">
      <aside className="ax-desc-left">
        {/* Header: title + subtitle only — separator line sits right below */}
        <div className="ax-desc-left-sticky">
          <h1 className="ax-desc-title">Descriptive statistics</h1>
          <p className="ax-desc-sub">Summarize variables and spot patterns before modeling</p>
        </div>
        <div className="ax-desc-left-vars">
          {/* Section navigation */}
          <nav className="ax-desc-nav" aria-label="Describe sections">
            {describeNavItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`ax-desc-nav-item ${activeDescribeSection === item.id ? 'active' : ''}`}
                  onClick={() => jumpToDescribeSection(item.id)}
                >
                  <span className="ax-desc-nav-icon"><Icon size={14} /></span>
                  <span>{item.label}</span>
                  <span className="ax-desc-nav-badge">{item.badge}</span>
                </button>
              )
            })}
          </nav>
          <div className="ax-desc-section-label" style={{ marginTop: 16 }}>Variables</div>
          <div className="ax-desc-var-tools">
            <button type="button" onClick={() => setSelectedVars((dataset.variables || []).map(v => v.name))}>All</button>
            <span>·</span>
            <button type="button" onClick={() => setSelectedVars([])}>Clear</button>
          </div>
          <div className="ax-desc-var-chips">
            {(dataset.variables || []).map(v => {
              const isSel = selectedVars.includes(v.name)
              return (
                <button
                  key={v.name}
                  type="button"
                  onClick={() => setSelectedVars(prev => prev.includes(v.name) ? prev.filter(n => n !== v.name) : [...prev, v.name])}
                  className={`ax-desc-var-chip ${isSel ? 'active' : ''}`}
                >
                  <span className="ax-desc-var-chip-name">{v.name}</span>
                  <span className="ax-desc-var-chip-type">{v.dtype}</span>
                </button>
              )
            })}
          </div>
        </div>
        <div className="ax-desc-run-area">
          <span className="ax-desc-stage-note">Updated from dataset stage {dataset.current_stage_id}</span>
          <button
            type="button"
            onClick={runDescriptives}
            disabled={descLoading || !selectedVars.length}
            className="ax-desc-run-btn"
          >
            {descLoading ? <InlineSpinner label="Running..." /> : <><Play size={14} /> Run descriptives</>}
          </button>
        </div>
      </aside>
      <main className="ax-desc-right">
        <div className={`ax-desc-right-scroll ${activeDescribeSection === 'chart-builder' ? 'no-scroll' : ''}`}>
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-accent, #f97316)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Describe · {describeNavItems.find(i => i.id === activeDescribeSection)?.label || activeDescribeSection}
        </span>
      </div>
      {activeDescribeSection === 'overview' && (
        <>
      <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 16 }}>Updated from dataset stage {dataset.current_stage_id}</p>

      {/* ──── SUMMARY STAT CARDS ──── */}
      {descResult && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          {[
            { big: numericStats.length + catStats.length, label: 'Variables analyzed', sub: `${numericStats.length} numeric · ${catStats.length} categorical`, orange: false },
            { big: totalRows ?? '—', label: 'Total records', sub: avgValidN != null ? `Avg valid n per var: ${avgValidN}` : '', orange: false },
            { big: skewedVars.length, label: 'Skewed variables', sub: skewedVars.slice(0, 3).map(s => s.variable).join(', ') + (skewedVars.length > 3 ? '…' : ''), orange: skewedVars.length > 0 },
            { big: strongestCorrPair ? Math.abs(strongestCorrPair.val).toFixed(2) : '—', label: 'Strongest correlation', sub: strongestCorrPair ? `${strongestCorrPair.a} ↔ ${strongestCorrPair.b}` : 'Run correlation first', orange: false }
          ].map((card, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '16px 20px' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: card.orange ? ORANGE_ACCENT : '#111827', letterSpacing: '-0.5px', marginBottom: 4, lineHeight: 1 }}>{card.big}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 3 }}>{card.label}</div>
              <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.4 }}>{card.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* ──── SECTION 1: DATASET HEALTH ──── */}
      {descResult && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '16px 20px', marginBottom: 16, borderLeft: `4px solid ${qualityFlags.length === 0 ? '#16a34a' : '#f97316'}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: qualityFlags.length === 0 ? '#16a34a' : '#f97316', marginBottom: 8 }}>
            {qualityFlags.length === 0 ? '✓ Dataset looks clean' : `⚠ ${qualityFlags.length} issue${qualityFlags.length !== 1 ? 's' : ''} detected`}
          </div>
          {qualityFlags.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                (descResult.stats || []).some(s => s.missing === 0 || s.missing == null) && '✓ No missing values',
                skewedVars.length === 0 && '✓ No outliers detected',
                !groupedQualityFlags.some(f => f.type === 'mixed_labels') && '✓ No label inconsistencies',
                (descResult.stats || []).every(s => !s.duplicates || s.duplicates === 0) && '✓ No duplicates found',
              ].filter(Boolean).map((item, i) => (
                <span key={i} style={{ fontSize: 11, color: '#6b7280' }}>{item}</span>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Object.entries(qualityFlags.reduce((acc, f) => { acc[f.type] = (acc[f.type] || 0) + 1; return acc }, {})).map(([type, count]) => (
                <span key={type} style={{ fontSize: 11, color: '#6b7280' }}>
                  • {type === 'mixed_labels' ? 'Mixed labels' : type === 'outlier' ? 'Outliers' : type === 'imbalance' ? 'Class imbalance' : type}: {count} column{count !== 1 ? 's' : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ──── SECTION 2: COLUMN QUICK-SCAN ──── */}
      {descResult && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, marginBottom: 16, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px 10px', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Column quick-scan</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '6px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 600 }}>Variable</th>
                <th style={{ padding: '6px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 600 }}>Type</th>
                <th style={{ padding: '6px 12px', textAlign: 'right', color: '#6b7280', fontWeight: 600 }}>Unique</th>
                <th style={{ padding: '6px 12px', textAlign: 'right', color: '#6b7280', fontWeight: 600 }}>Missing</th>
                <th style={{ padding: '6px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 600 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {(descResult.stats || []).map((s, i) => {
                const typeBadge = s.kind === 'numeric' ? { bg: '#eff6ff', color: '#2563eb' } : s.kind === 'categorical' ? { bg: '#fff7ed', color: '#ea580c' } : { bg: '#f3f4f6', color: '#6b7280' }
                const typeLabel = s.kind === 'numeric' ? 'numeric' : s.kind === 'categorical' ? 'category' : 'text'
                const missing = s.missing ?? 0
                const hasIssue = qualityFlags.some(f => f.variable === s.variable)
                const issueFlag = qualityFlags.find(f => f.variable === s.variable)
                return (
                  <tr key={s.variable} style={{ background: i % 2 === 0 ? 'transparent' : '#fafafa', borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '6px 12px', fontWeight: 600, color: '#111827', fontFamily: 'var(--font-mono, monospace)' }}>{s.variable}</td>
                    <td style={{ padding: '6px 12px' }}>
                      <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: typeBadge.bg, color: typeBadge.color }}>{typeLabel}</span>
                    </td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', color: '#374151', fontFamily: 'var(--font-mono, monospace)' }}>{s.unique ?? '—'}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', color: missing > 0 ? '#f97316' : '#16a34a', fontFamily: 'var(--font-mono, monospace)', fontWeight: missing > 0 ? 600 : 400 }}>{missing}</td>
                    <td style={{ padding: '6px 12px' }}>
                      {hasIssue ? (
                        <span style={{ color: '#f97316', fontSize: 11 }}>⚠ {issueFlag?.type === 'outlier' ? 'outliers' : issueFlag?.type === 'mixed_labels' ? 'mixed labels' : 'imbalance'}</span>
                      ) : (
                        <span style={{ color: '#16a34a', fontSize: 11 }}>✓ Clean</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ──── SECTION 3: NOTABLE FINDINGS ──── */}
      {descResult && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Notable findings</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {strongestCorrPair && Math.abs(strongestCorrPair.val) > 0.5 && (
              <div>
                <div style={{ fontSize: 12, color: '#111827' }}>
                  <span style={{ color: '#f97316', marginRight: 6 }}>●</span>
                  Strong correlation: {strongestCorrPair.a} ↔ {strongestCorrPair.b} (r = {strongestCorrPair.val.toFixed(2)})
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, paddingLeft: 18 }}>→ May be redundant as features</div>
              </div>
            )}
            {catStats.map(s => {
              const nClasses = Object.keys(s.value_counts || {}).length
              const maxPct = s.n ? Math.max(...Object.values(s.value_counts || {}).map(v => v / s.n)) : 0
              const isImbalanced = maxPct > 0.7
              return (
                <div key={s.variable}>
                  <div style={{ fontSize: 12, color: '#111827' }}>
                    <span style={{ color: '#f97316', marginRight: 6 }}>●</span>
                    {s.variable} has {nClasses} {isImbalanced ? 'imbalanced' : 'balanced'} classes
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, paddingLeft: 18 }}>
                    → {isImbalanced ? 'Consider balancing before classification' : 'Good class distribution'}
                  </div>
                </div>
              )
            })}
            {skewedVars.map(s => (
              <div key={s.variable}>
                <div style={{ fontSize: 12, color: '#111827' }}>
                  <span style={{ color: '#f97316', marginRight: 6 }}>●</span>
                  {s.variable} is {s.skew > 0 ? 'right' : 'left'}-skewed (skew = {s.skew.toFixed(1)})
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, paddingLeft: 18 }}>→ Consider log transform or outlier check</div>
              </div>
            ))}
            {qualityFlags.length === 0 && skewedVars.length === 0 && !strongestCorrPair && (
              <div style={{ fontSize: 12, color: '#111827' }}>
                <span style={{ color: '#16a34a', marginRight: 6 }}>●</span>
                No issues found — ready for analysis
              </div>
            )}
          </div>
        </div>
      )}

      {/* ──── SECTION 4: NEXT STEPS ──── */}
      {descResult && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {strongestCorrPair && Math.abs(strongestCorrPair.val) > 0.5 && (
            <button
              type="button"
              onClick={() => jumpToDescribeSection('correlations')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 999, border: '1.5px solid #d1d5db', background: '#fff', fontSize: 12, fontWeight: 500, color: '#374151', cursor: 'pointer', fontFamily: 'inherit' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#fff7ed'; e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.color = '#f97316' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#374151' }}
            >
              → Explore in Correlations
            </button>
          )}
          <button
            type="button"
            onClick={() => jumpToDescribeSection('chart-builder')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 999, border: '1.5px solid #d1d5db', background: '#fff', fontSize: 12, fontWeight: 500, color: '#374151', cursor: 'pointer', fontFamily: 'inherit' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#fff7ed'; e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.color = '#f97316' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#374151' }}
          >
            → Visualize in Chart builder
          </button>
          {qualityFlags.length === 0 && (
            <button
              type="button"
              onClick={() => jumpToDescribeSection('numeric')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 999, border: '1.5px solid #d1d5db', background: '#fff', fontSize: 12, fontWeight: 500, color: '#374151', cursor: 'pointer', fontFamily: 'inherit' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#fff7ed'; e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.color = '#f97316' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#374151' }}
            >
              → Ready for Analysis
            </button>
          )}
        </div>
      )}

      {/* ──── DATA QUALITY FLAGS ──── */}
      {qualityFlags.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '14px 20px', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 14, height: 14, border: '1.5px solid #9ca3af', borderRadius: 3, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Data Quality Flags</span>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#374151', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 20, padding: '2px 9px' }}>{qualityFlags.length} issue{qualityFlags.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {groupedQualityFlags.map((flag, i) => (
              <div key={`${flag.type}-${flag.variable || i}`} title={flag.type === 'imbalance' ? flag.desc : undefined} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: i < groupedQualityFlags.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 1, minWidth: 0 }}>
                  <div style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, background: flag.type === 'mixed_labels' ? 'transparent' : ORANGE_ACCENT, border: flag.type === 'mixed_labels' ? '1.5px solid #d1d5db' : 'none' }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: flag.type === 'imbalance' ? 0 : 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {flag.variable ? (
                        <>
                          <span style={{ color: ORANGE_ACCENT }}>{flag.variable}</span>
                          <span style={{ color: '#374151', fontWeight: 500 }}>{flag.title.replace(flag.variable, '')}</span>
                        </>
                      ) : (
                        <span style={{ color: '#374151' }}>{flag.title}</span>
                      )}
                    </div>
                    {flag.type !== 'imbalance' && (
                      <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{flag.desc}</div>
                    )}
                  </div>
                </div>
                <a href="#" onClick={e => e.preventDefault()} style={{ fontSize: 12, color: ORANGE_ACCENT, fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0, textDecoration: 'none' }}>{flag.action}</a>
              </div>
            ))}
          </div>
        </div>
      )}
        </>
      )}

      {/* ---- VARIABLE SUMMARY PANELS ---- */}
      {((activeDescribeSection === 'numeric' && numericStats.length > 0) || (activeDescribeSection === 'categorical' && catStats.length > 0)) && (
        <>
        <div id="describe-numeric" />
        <div id="describe-categorical" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24, marginBottom: 20, alignItems: 'start' }}>
          {activeDescribeSection === 'numeric' && numericStats.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '24px 24px 24px', height: 560, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#5b6573', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 20 }}>
                Numeric Variables — {numericStats.length} Selected
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gridAutoRows: 244, gap: 16, overflowY: 'auto', paddingRight: 4, minHeight: 0 }}>
                {numericStats.map(s => {
                  const isSkewed = Math.abs(s.skew ?? 0) >= 1
                  const shapeLabel = isSkewed ? 'Skewed' : 'Symmetric'
                  return (
                    <article key={s.variable} style={{ background: '#faf7f2', borderRadius: 12, padding: '22px 20px 20px', height: 244, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 22 }}>
                        <h3 style={{ margin: 0, fontSize: 16, lineHeight: 1.2, color: '#020617', fontWeight: 800, fontFamily: 'var(--font-mono, monospace)', overflowWrap: 'anywhere' }}>{s.variable}</h3>
                        <span style={{ flexShrink: 0, borderRadius: 999, padding: '4px 10px', background: isSkewed ? '#fff7ed' : '#d1fae5', color: isSkewed ? '#c2410c' : '#059669', fontSize: 12, fontWeight: 700 }}>{shapeLabel}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 26, rowGap: 14 }}>
                        <div>
                          <div style={{ color: '#667085', fontSize: 12, marginBottom: 6 }}>Mean</div>
                          <strong style={{ color: '#020617', fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono, monospace)' }}>{s.mean != null ? s.mean.toFixed(3).replace(/\.000$/, '.0') : '?'}</strong>
                        </div>
                        <div>
                          <div style={{ color: '#667085', fontSize: 12, marginBottom: 6 }}>SD</div>
                          <strong style={{ color: '#020617', fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono, monospace)' }}>{s.std != null ? s.std.toFixed(3).replace(/\.000$/, '.0') : '?'}</strong>
                        </div>
                        <div>
                          <div style={{ color: '#667085', fontSize: 12, marginBottom: 6 }}>Median</div>
                          <strong style={{ color: '#020617', fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono, monospace)' }}>{s.median != null ? s.median.toFixed(3).replace(/\.000$/, '.0') : '?'}</strong>
                        </div>
                        <div>
                          <div style={{ color: '#667085', fontSize: 12, marginBottom: 6 }}>Skew</div>
                          <strong style={{ color: '#020617', fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono, monospace)' }}>{s.skew != null ? s.skew.toFixed(3) : '?'}</strong>
                        </div>
                      </div>
                      <div style={{ width: 56, height: 4, borderRadius: 999, background: ORANGE_ACCENT, marginTop: 20 }} />
                    </article>
                  )
                })}
              </div>
            </div>
          )}

          {activeDescribeSection === 'categorical' && catStats.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '24px 24px 24px', height: 560, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <p style={{ fontSize: 11, fontWeight: 800, color: '#5b6573', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 20px' }}>Categorical Variables — Distribution</p>
              {activeCatStat && (() => {
                const vc = activeCatStat.value_counts || {}
                const entries = Object.entries(vc).sort(([, a], [, b]) => b - a)
                const total = activeCatStat.n || 1
                const maxCount = entries[0]?.[1] || 1
                return (
                  <div style={{ overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                      {catStats.map(s => (
                        <button key={s.variable} type="button" onClick={() => setActiveCatVar(s.variable)}
                          style={{ padding: '7px 16px', borderRadius: 20, border: `1px solid ${activeCatVar === s.variable ? ORANGE_ACCENT : '#d1d5db'}`, background: '#fff', color: activeCatVar === s.variable ? ORANGE_ACCENT : '#1f2a44', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {s.variable.replace(/_/g, ' ')}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {entries.map(([label, count]) => {
                        const pct = (count / total * 100).toFixed(1)
                        return (
                          <div key={label} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 48px', alignItems: 'center', gap: 14 }}>
                            <span style={{ fontSize: 13, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                            <div style={{ height: 14, background: '#f1f2f4', borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{ width: `${(count / maxCount) * 100}%`, height: '100%', background: ORANGE_ACCENT }} />
                            </div>
                            <strong style={{ fontSize: 13, color: '#020617', textAlign: 'right' }}>{pct}%</strong>
                          </div>
                        )
                      })}
                    </div>
                    <p style={{ fontSize: 12, color: '#667085', margin: '18px 0 0', borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
                      <strong style={{ color: '#475467' }}>{activeCatStat.variable}</strong> · {activeCatStat.n} valid · {activeCatStat.unique} unique value{activeCatStat.unique !== 1 ? 's' : ''}
                    </p>
                  </div>
                )
              })()}
            </div>
          )}
        </div>
        </>
      )}

      {/* ──── CORRELATION HEATMAP ──── */}
      {activeDescribeSection === 'correlations' && descResult && (corrResult?.variables?.length >= 2 ? (
        <div
          id="describe-correlations"
          style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 20, marginBottom: 20 }}
          onClick={() => setSelectedCorrCell(null)}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '16px 24px', alignItems: 'start' }}>

            {/* Row 1 left: title */}
            <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Correlation Heatmap — Numeric Pairs
            </p>

            {/* Row 1 right: detail panel title */}
            <div onClick={e => e.stopPropagation()}>
              {!selectedCorrCell ? (
                <>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#111827', marginTop: 0, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Strongest relationships</p>
                  <p style={{ fontSize: 11, color: '#6b7280', marginTop: 0, marginBottom: 0 }}>Click any cell to explore a pair</p>
                </>
              ) : selectedCorrCell.row === selectedCorrCell.col ? (
                <p style={{ fontSize: 11, fontWeight: 700, color: '#111827', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Distribution of {selectedCorrCell.row}</p>
              ) : (
                <>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#111827', marginTop: 0, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedCorrCell.row} <span style={{ color: '#9ca3af' }}>←→</span> {selectedCorrCell.col}
                  </p>
                  <p style={{ fontSize: 11, color: '#6b7280', marginTop: 0, marginBottom: 0 }}>
                    Correlation: <strong style={{ color: Number(corrResult.matrix?.[selectedCorrCell.row]?.[selectedCorrCell.col] ?? 0) > 0 ? ORANGE_ACCENT : '#0284c7' }}>
                      {Number(corrResult.matrix?.[selectedCorrCell.row]?.[selectedCorrCell.col] ?? 0) >= 0 ? '+' : ''}
                      {Number(corrResult.matrix?.[selectedCorrCell.row]?.[selectedCorrCell.col] ?? 0).toFixed(3)}
                    </strong>
                    <span style={{ marginLeft: 6, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontWeight: 500 }}>
                      {getCorrelationLabel(Number(corrResult.matrix?.[selectedCorrCell.row]?.[selectedCorrCell.col] ?? 0))}
                    </span>
                  </p>
                </>
              )}
            </div>

            {/* Row 2 left: heatmap table */}
            <div onClick={e => e.stopPropagation()}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'separate', borderSpacing: '6px', fontSize: 11, fontFamily: 'var(--font-mono)', minWidth: Math.max(420, corrResult.variables.length * 80) }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px 8px' }}></th>
                      {corrResult.variables.map((v) => (
                        <th key={v} style={{ padding: '6px 8px', color: '#6b7280', fontWeight: 600, fontSize: 10 }}>{v}</th>
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
                          const isSelected = selectedCorrCell?.row === r && selectedCorrCell?.col === c
                          const bg = isSelf ? ORANGE_ACCENT : getCorrelationColor(val)
                          const textColor = isSelf || abs > 0.5 ? '#fff' : '#111827'
                          return (
                            <td
                              key={c}
                              onClick={() => setSelectedCorrCell(isSelected ? null : { row: r, col: c })}
                              style={{
                                padding: '8px 12px',
                                textAlign: 'center',
                                backgroundColor: bg,
                                color: textColor,
                                borderRadius: 6,
                                fontWeight: 700,
                                cursor: 'pointer',
                                boxShadow: isSelected ? '0 0 0 2px #fff, 0 0 0 4px #374151' : 'none',
                                transition: 'box-shadow 0.15s'
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
            </div>

            {/* Row 2 right: detail panel body */}
            <div style={{ paddingTop: 12 }} onClick={e => e.stopPropagation()}>
              {!selectedCorrCell ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {getTopCorrelations(corrResult, 5).map(({ a, b, val }) => {
                    const abs = Math.abs(val)
                    const barColor = val > 0 ? ORANGE_ACCENT : '#0284c7'
                    return (
                      <div
                        key={`${a}-${b}`}
                        style={{ background: '#fafafa', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', border: '1px solid #f3f4f6' }}
                        onClick={() => setSelectedCorrCell({ row: a, col: b })}
                        onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6' }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#fafafa' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                          <span style={{ fontSize: 11, color: '#374151', fontWeight: 600, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {a} <span style={{ color: '#9ca3af' }}>←→</span> {b}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: val > 0 ? ORANGE_ACCENT : '#0284c7', whiteSpace: 'nowrap' }}>
                            {val >= 0 ? '+' : ''}{val.toFixed(3)}
                          </span>
                        </div>
                        <div style={{ background: '#e5e7eb', borderRadius: 99, height: 5, overflow: 'hidden' }}>
                          <div style={{ width: `${abs * 100}%`, height: '100%', backgroundColor: barColor, borderRadius: 99 }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (() => {
                const { row, col } = selectedCorrCell
                const isSelf = row === col
                const val = Number(corrResult.matrix?.[row]?.[col] ?? 0)

                if (isSelf) {
                  const values = datasetRows.map(r => Number(r[row])).filter(v => !isNaN(v))
                  if (values.length === 0) return <p style={{ fontSize: 11, color: '#6b7280' }}>No data available.</p>
                  const minV = Math.min(...values)
                  const maxV = Math.max(...values)
                  const binCount = Math.min(20, Math.max(8, Math.ceil(Math.sqrt(values.length))))
                  const binWidth = (maxV - minV) / binCount || 1
                  const bins = Array.from({ length: binCount }, (_, i) => ({ label: (minV + i * binWidth).toFixed(1), count: 0 }))
                  values.forEach(v => {
                    const idx = Math.min(Math.floor((v - minV) / binWidth), binCount - 1)
                    if (bins[idx]) bins[idx].count++
                  })
                  const histData = {
                    labels: bins.map(b => b.label),
                    datasets: [{ label: row, data: bins.map(b => b.count), backgroundColor: 'rgba(234, 88, 12, 0.6)', borderColor: ORANGE_ACCENT, borderWidth: 1 }]
                  }
                  const histOptions = {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                      x: { ticks: { font: { size: 9 }, maxRotation: 45 } },
                      y: { ticks: { font: { size: 9 } }, title: { display: true, text: 'Count', font: { size: 9 } } }
                    }
                  }
                  return (
                    <div style={{ height: 220 }}>
                      <Bar data={histData} options={histOptions} />
                    </div>
                  )
                }

                const label = getCorrelationLabel(val)
                const catVar = (dataset.variables || [])
                  .filter(v => !['numeric', 'int', 'float'].includes(v.dtype))
                  .map(v => {
                    const values = new Set(datasetRows.map(row => String(row[v.name] ?? '')).filter(Boolean))
                    return { name: v.name, uniqueCount: values.size }
                  })
                  .find(v => v.uniqueCount > 1 && v.uniqueCount <= 8 && !/id$/i.test(v.name))?.name
                const SCATTER_PALETTE = ['#f97316', '#0284c7', '#0f766e', '#9a3412', '#6366f1', '#b45309', '#9d174d', '#374151']
                const groups = {}
                datasetRows.forEach(dr => {
                  const x = Number(dr[col])
                  const y = Number(dr[row])
                  if (isNaN(x) || isNaN(y)) return
                  const group = catVar ? String(dr[catVar] ?? 'Other') : 'Data'
                  if (!groups[group]) groups[group] = []
                  groups[group].push({ x, y })
                })
                const allPoints = datasetRows
                  .map(dr => ({ x: Number(dr[col]), y: Number(dr[row]) }))
                  .filter(p => !isNaN(p.x) && !isNaN(p.y))
                const reg = simpleLinearRegression(allPoints)
                const trendDataset = reg && allPoints.length >= 2 ? (() => {
                  const xs = allPoints.map(p => p.x)
                  const xMin = Math.min(...xs)
                  const xMax = Math.max(...xs)
                  return {
                    type: 'line',
                    label: 'Trend',
                    data: [{ x: xMin, y: reg.slope * xMin + reg.intercept }, { x: xMax, y: reg.slope * xMax + reg.intercept }],
                    borderColor: '#374151',
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: false,
                    tension: 0
                  }
                })() : null
                const scatterDatasets = Object.entries(groups).map(([grp, pts], idx) => ({
                  type: 'scatter',
                  label: grp,
                  data: pts,
                  backgroundColor: SCATTER_PALETTE[idx % SCATTER_PALETTE.length] + 'aa',
                  borderColor: SCATTER_PALETTE[idx % SCATTER_PALETTE.length],
                  pointRadius: 3,
                  borderWidth: 1
                }))
                if (trendDataset) scatterDatasets.push(trendDataset)
                const scatterOptions = {
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: Boolean(catVar) && Object.keys(groups).length > 1, position: 'bottom', labels: { font: { size: 9 }, boxWidth: 10, padding: 6 } }
                  },
                  scales: {
                    x: { title: { display: true, text: col, font: { size: 9 } }, ticks: { font: { size: 9 } } },
                    y: { title: { display: true, text: row, font: { size: 9 } }, ticks: { font: { size: 9 } } }
                  }
                }
                const insightText = Math.abs(val) >= 0.7
                  ? 'These two variables move together strongly. Including both in your model may be redundant.'
                  : Math.abs(val) >= 0.4
                  ? 'These variables have a moderate relationship. Worth exploring further before modeling.'
                  : 'These variables have a weak relationship. Both can likely be included independently.'
                return (
                  <div>
                    <div style={{ height: 200 }}>
                      <Chart type='scatter' data={{ datasets: scatterDatasets }} options={scatterOptions} />
                    </div>
                    <div style={{ background: '#fff7ed', borderRadius: 8, padding: '8px 10px', marginTop: 10 }}>
                      <p style={{ fontSize: 11, color: '#92400e', margin: 0, lineHeight: 1.5 }}>{insightText}</p>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      ) : (
        /* No correlation data yet */
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '28px 24px', marginBottom: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Correlation Heatmap — Numeric Pairs</p>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>No correlation data yet.</p>
          <button
            type="button"
            onClick={runCorrelation}
            disabled={corrLoading}
            style={{ padding: '8px 18px', background: ORANGE_ACCENT, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: corrLoading ? 'default' : 'pointer', opacity: corrLoading ? 0.7 : 1 }}
          >
            {corrLoading ? <InlineSpinner label="Computing…" /> : 'Compute correlations'}
          </button>
        </div>
      ))}

      {/* Interactive Chart Builder */}
      {activeDescribeSection === 'chart-builder' && descResult && <div id="describe-chart-builder" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, overflow: 'hidden', marginBottom: 20, height: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column' }}>

        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}
            onMouseEnter={() => setTitleHovered(true)}
            onMouseLeave={() => setTitleHovered(false)}>
            <input
              type="text"
              value={chartTitle}
              onChange={e => handleChartTitleChange(e.target.value)}
              onFocus={e => { e.target.style.borderBottomColor = ORANGE_ACCENT }}
              onBlur={e => { e.target.style.borderBottomColor = 'transparent' }}
              style={{ border: 'none', outline: 'none', fontSize: 14, fontWeight: 700, color: '#111827', background: 'transparent', padding: '2px 0', borderBottom: '2px solid transparent', transition: 'border-color 0.15s', minWidth: 0, flex: 1 }}
            />
            <Pencil size={11} color="#9ca3af" style={{ flexShrink: 0, opacity: titleHovered ? 1 : 0, transition: 'opacity 0.15s', pointerEvents: 'none' }} />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 16, flexShrink: 0 }}>
            <button type="button" onClick={handleSaveChart}
              onMouseEnter={e => { e.currentTarget.style.background = ORANGE_LIGHT; e.currentTarget.style.borderColor = ORANGE_ACCENT; e.currentTarget.style.color = ORANGE_ACCENT }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#374151' }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 12px', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#374151' }}>
              <Bookmark size={13} /> Save chart
            </button>
            <button type="button" onClick={handleDuplicateChart} title="Duplicate chart"
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#9ca3af'; e.currentTarget.style.color = '#374151' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#6b7280' }}
              style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 8px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#6b7280' }}>
              <Copy size={15} />
            </button>
            <button type="button" onClick={handleDownloadChart} title="Download as PNG"
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#9ca3af'; e.currentTarget.style.color = '#374151' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#6b7280' }}
              style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 8px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#6b7280' }}>
              <Download size={15} />
            </button>
            <button type="button" onClick={() => setExpandChart(true)} title="Fullscreen"
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#9ca3af'; e.currentTarget.style.color = '#374151' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#6b7280' }}
              style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 8px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#6b7280' }}>
              <Maximize2 size={15} />
            </button>
          </div>
        </div>

        {/* Saved charts strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px', height: 44, borderBottom: '1px solid #e5e7eb', background: 'var(--color-background-tertiary)', overflowX: 'auto' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>Saved</span>
          <div style={{ display: 'flex', gap: 6, flex: 1, alignItems: 'center', minWidth: 0 }}>
            {savedCharts.length === 0 ? (
              <span style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic', whiteSpace: 'nowrap' }}>No saved charts yet — configure a chart and click Save</span>
            ) : (
              savedCharts.map(sc => (
                <button key={sc.id} type="button" onClick={() => handleLoadChart(sc)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', border: `1px solid ${activeChartId === sc.id ? '#fed7aa' : '#d1d5db'}`, borderRadius: 20, padding: '3px 8px 3px 9px', background: activeChartId === sc.id ? '#fff7ed' : '#fff', color: activeChartId === sc.id ? '#c2410c' : '#374151', cursor: 'pointer', fontSize: 11, fontWeight: 500, flexShrink: 0 }}>
                  <span>{sc.title}</span>
                  <span onClick={e => { e.stopPropagation(); handleDeleteChart(sc.id) }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#ef4444' }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af' }}
                    style={{ marginLeft: 2, color: '#9ca3af', lineHeight: 1, fontSize: 14, display: 'flex', alignItems: 'center' }}>
                    <X size={11} />
                  </span>
                </button>
              ))
            )}
          </div>
          {savedCharts.length > 0 && (
            <button type="button"
              onClick={() => { setCompareMode(!compareMode); if (!compareMode) { setCompareSelected(savedCharts.slice(0, 2).map(s => s.id)); showCbToast(`Comparing ${Math.min(2, savedCharts.length)} charts`) } }}
              style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, border: `1px solid ${compareMode ? ORANGE_ACCENT : '#d1d5db'}`, borderRadius: 8, padding: '4px 10px', background: compareMode ? ORANGE_LIGHT : '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: compareMode ? ORANGE_ACCENT : '#374151' }}>
              <LayoutGrid size={12} /> {compareMode ? 'Exit compare' : 'Compare'}
            </button>
          )}
        </div>

        {/* Main body */}
        {compareMode ? (
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {savedCharts.map(sc => (
                <button key={sc.id} type="button"
                  onClick={() => setCompareSelected(prev => prev.includes(sc.id) ? prev.filter(x => x !== sc.id) : prev.length < 4 ? [...prev, sc.id] : prev)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, border: `1px solid ${compareSelected.includes(sc.id) ? ORANGE_ACCENT : '#d1d5db'}`, borderRadius: 20, padding: '3px 10px', background: compareSelected.includes(sc.id) ? ORANGE_LIGHT : '#fff', color: compareSelected.includes(sc.id) ? ORANGE_ACCENT : '#374151', cursor: 'pointer', fontSize: 11, fontWeight: 500 }}>
                  {sc.title}
                </button>
              ))}
              <span style={{ fontSize: 11, color: '#9ca3af', alignSelf: 'center', marginLeft: 4 }}>Select up to 4</span>
            </div>
            {compareSelected.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 12 }}>Select charts above to compare</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: compareSelected.length === 1 ? '1fr' : compareSelected.length === 3 ? '1fr 1fr 1fr' : '1fr 1fr', gap: 16 }}>
                {compareSelected.map(id => {
                  const sc = savedCharts.find(s => s.id === id)
                  if (!sc) return null
                  return (
                    <div key={id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #f3f4f6', background: '#fafafa' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{sc.title}</span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: 10, background: ORANGE_LIGHT, color: ORANGE_ACCENT, borderRadius: 10, padding: '1px 7px', fontWeight: 700 }}>{sc.type === 'horizontal bar' ? 'H. Bar' : sc.type.charAt(0).toUpperCase() + sc.type.slice(1)}</span>
                          <button type="button" onClick={() => setCompareSelected(prev => prev.filter(x => x !== id))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', padding: 0 }}><X size={13} /></button>
                        </div>
                      </div>
                      <div style={{ height: 240, padding: 10 }}>{renderCompareChart(sc)}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {/* Controls panel */}
            <div style={{ borderRight: '1px solid #e5e7eb', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', overflowX: 'hidden' }}>
              {/* Chart type pills */}
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Chart Type</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {CB_CHART_TYPES.map(t => (
                    <button key={t.key} type="button"
                      onClick={() => { setChartBuilderType(t.key); setActiveChartId(null); if (t.key === 'histogram' && !chartBuilderX) { const f = dataset.variables?.find(v => ['numeric', 'int', 'float'].includes(v.dtype))?.name; if (f) setChartBuilderX(f) } }}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 7, border: `1px solid ${chartBuilderType === t.key ? ORANGE_ACCENT : '#d1d5db'}`, background: chartBuilderType === t.key ? ORANGE_LIGHT : '#fff', color: chartBuilderType === t.key ? ORANGE_ACCENT : '#374151', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fields */}
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fields</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>X Axis *</label>
                    <select value={chartBuilderX} onChange={e => setChartBuilderX(e.target.value)}
                      style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '6px 8px', background: '#fff', fontSize: 12, outline: 'none' }}>
                      <option value="">— select —</option>
                      {(dataset.variables || []).map(v => <option key={v.name} value={v.name}>{v.name} ({v.dtype})</option>)}
                    </select>
                  </div>
                  {chartBuilderType !== 'histogram' && (
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>Y Axis *</label>
                      <select value={chartBuilderY} onChange={e => setChartBuilderY(e.target.value)}
                        style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '6px 8px', background: '#fff', fontSize: 12, outline: 'none' }}>
                        <option value="">— select —</option>
                        {(dataset.variables || []).filter(v => ['numeric', 'int', 'float'].includes(v.dtype)).map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>Color by (optional)</label>
                    <select value={chartBuilderGroupBy} onChange={e => setChartBuilderGroupBy(e.target.value)}
                      style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '6px 8px', background: '#fff', fontSize: 12, outline: 'none' }}>
                      <option value="">— none —</option>
                      {(dataset.variables || []).filter(v => !['numeric', 'int', 'float'].includes(v.dtype)).map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Aggregation */}
              {chartBuilderType !== 'scatter' && chartBuilderType !== 'bubble' && chartBuilderType !== 'histogram' && (
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Aggregation</p>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {['Count', 'Mean', 'Sum', 'Max'].map(agg => (
                      <button key={agg} type="button" onClick={() => setChartBuilderAgg(agg)}
                        style={{ flex: 1, border: `1px solid ${chartBuilderAgg === agg ? '#111827' : '#d1d5db'}`, borderRadius: 7, padding: '5px 4px', background: chartBuilderAgg === agg ? '#111827' : '#fff', color: chartBuilderAgg === agg ? '#fff' : '#374151', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                        {agg}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Sort order — bar/h-bar only */}
              {(chartBuilderType === 'bar' || chartBuilderType === 'horizontal bar') && (
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sort</p>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[{ key: 'default', label: 'Default' }, { key: 'asc', label: '↑ Asc' }, { key: 'desc', label: '↓ Desc' }].map(s => (
                      <button key={s.key} type="button" onClick={() => setCbSortOrder(s.key)}
                        style={{ flex: 1, border: `1px solid ${cbSortOrder === s.key ? ORANGE_ACCENT : '#d1d5db'}`, borderRadius: 7, padding: '5px 4px', background: cbSortOrder === s.key ? ORANGE_LIGHT : '#fff', color: cbSortOrder === s.key ? ORANGE_ACCENT : '#374151', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Color palette presets + swatch override */}
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Color</p>
                <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                  {[{ key: 'standard', label: 'Standard' }, { key: 'colorblind', label: 'CB-safe' }, { key: 'mono', label: 'Mono' }].map(p => (
                    <button key={p.key} type="button"
                      onClick={() => { setCbPalette(p.key); setChartBuilderColor(CB_PALETTES[p.key][0]) }}
                      style={{ flex: 1, border: `1px solid ${cbPalette === p.key ? '#111827' : '#d1d5db'}`, borderRadius: 7, padding: '5px 4px', background: cbPalette === p.key ? '#111827' : '#fff', color: cbPalette === p.key ? '#fff' : '#374151', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {CB_PALETTES[cbPalette].map(c => (
                    <button key={c} type="button" onClick={() => setChartBuilderColor(c)}
                      style={{ width: 22, height: 22, borderRadius: '50%', border: 'none', backgroundColor: c, cursor: 'pointer', outline: 'none', boxShadow: chartBuilderColor === c ? `0 0 0 2px #fff, 0 0 0 3.5px #111827` : 'none', transform: chartBuilderColor === c ? 'scale(1.15)' : 'scale(1)', transition: 'all 0.12s' }} />
                  ))}
                </div>
              </div>

              {/* Data labels toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Data labels</span>
                <button type="button" onClick={() => setCbShowLabels(v => !v)}
                  style={{ width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', background: cbShowLabels ? ORANGE_ACCENT : '#d1d5db', position: 'relative', transition: 'background 0.15s', flexShrink: 0, padding: 0 }}>
                  <span style={{ position: 'absolute', top: 2, left: cbShowLabels ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', display: 'block' }} />
                </button>
              </div>

              {/* Show legend toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Show legend</span>
                <button type="button" onClick={() => setCbShowLegend(v => !v)}
                  style={{ width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', background: cbShowLegend ? ORANGE_ACCENT : '#d1d5db', position: 'relative', transition: 'background 0.15s', flexShrink: 0, padding: 0 }}>
                  <span style={{ position: 'absolute', top: 2, left: cbShowLegend ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', display: 'block' }} />
                </button>
              </div>
            </div>

            {/* Chart preview */}
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <input
                    type="text"
                    value={chartTitle}
                    onChange={e => handleChartTitleChange(e.target.value)}
                    placeholder="Name this chart"
                    aria-label="Chart name"
                    style={{ width: '100%', maxWidth: 420, border: '1px solid transparent', borderRadius: 6, outline: 'none', fontSize: 14, fontWeight: 800, color: '#111827', background: 'transparent', padding: '4px 6px', marginLeft: -6, transition: 'border-color 0.15s, background 0.15s' }}
                    onFocus={e => { e.target.style.borderColor = '#fed7aa'; e.target.style.background = '#fff7ed' }}
                    onBlur={e => { e.target.style.borderColor = 'transparent'; e.target.style.background = 'transparent' }}
                  />
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    {chartBuilderX && (chartBuilderType === 'histogram' || chartBuilderY) ? `${chartBuilderX}${chartBuilderY ? ` vs ${chartBuilderY}` : ''} - ${chartBuilderAgg}` : 'Configure fields to preview'}
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: ORANGE_LIGHT, color: ORANGE_ACCENT, borderRadius: 12, padding: '2px 10px', border: `1px solid #fed7aa`, flexShrink: 0 }}>
                  {cbTypeLabel}
                </span>
              </div>
              <div style={{ display: 'none' }}>
                <span style={{ fontSize: 12, color: '#6b7280' }}>
                  {chartBuilderX && (chartBuilderType === 'histogram' || chartBuilderY) ? `${chartBuilderX}${chartBuilderY ? ` vs ${chartBuilderY}` : ''} — ${chartBuilderAgg}` : 'Configure fields to preview'}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: ORANGE_LIGHT, color: ORANGE_ACCENT, borderRadius: 12, padding: '2px 10px', border: `1px solid #fed7aa`, flexShrink: 0 }}>
                  {cbTypeLabel}
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {loadingRows ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><InlineSpinner label="Loading data..." /></div>
                ) : renderLiveChart()}
              </div>
              {cbInsight && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fff7ed', borderRadius: 8, padding: '10px 12px', marginTop: 12 }}>
                  <Lightbulb size={14} color={ORANGE_ACCENT} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 11, color: '#92400e', lineHeight: 1.55 }}>{cbInsight}</span>
                </div>
              )}
              <textarea
                rows={2}
                value={chartNote}
                onChange={e => setChartNote(e.target.value)}
                placeholder="Add a note about this chart (optional)…"
                style={{ marginTop: 10, width: '100%', resize: 'vertical', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', fontSize: 12, fontFamily: 'inherit', fontStyle: chartNote ? 'italic' : 'normal', color: '#374151', background: '#fafafa', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s' }}
                onFocus={e => { e.target.style.borderColor = ORANGE_ACCENT; e.target.style.background = '#fff' }}
                onBlur={e => { e.target.style.borderColor = '#e5e7eb'; e.target.style.background = '#fafafa' }}
              />
            </div>
          </div>
        )}

        {/* Toast */}
        {cbToast && (
          <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', color: '#fff', borderRadius: 20, padding: '8px 18px', fontSize: 12, fontWeight: 500, zIndex: 9999, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            {cbToast}
          </div>
        )}

        {/* Expand/fullscreen modal */}
        {expandChart && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setExpandChart(false)}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '90vw', height: '82vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{chartTitle}</span>
                <button type="button" onClick={() => setExpandChart(false)} style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '5px 8px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#6b7280' }}><Minimize2 size={15} /></button>
              </div>
              <div style={{ flex: 1 }}>{renderLiveChart()}</div>
            </div>
          </div>
        )}
      </div>}
        </div>
      </main>
    </div>
  )
}

function getCorrelationColor(val) {
  const abs = Math.abs(val)
  if (abs < 0.1) return BG_WARM_BEIGE
  if (val > 0) {
    const alpha = abs > 0.8 ? 0.9 : abs > 0.5 ? 0.6 : abs > 0.2 ? 0.3 : 0.15
    return `rgba(234, 88, 12, ${alpha})`
  } else {
    const alpha = abs > 0.8 ? 0.9 : abs > 0.5 ? 0.6 : abs > 0.2 ? 0.3 : 0.15
    return `rgba(2, 132, 199, ${alpha})`
  }
}

function getTopCorrelations(corrResult, n = 5) {
  if (!corrResult?.variables || !corrResult?.matrix) return []
  const pairs = []
  const vars = corrResult.variables
  for (let i = 0; i < vars.length; i++) {
    for (let j = i + 1; j < vars.length; j++) {
      const val = Number(corrResult.matrix[vars[i]]?.[vars[j]] ?? 0)
      pairs.push({ a: vars[i], b: vars[j], val })
    }
  }
  return pairs.sort((x, y) => Math.abs(y.val) - Math.abs(x.val)).slice(0, n)
}

function getCorrelationLabel(val) {
  const abs = Math.abs(val)
  const dir = val > 0 ? 'positive' : 'negative'
  if (abs >= 0.8) return `Strong ${dir}`
  if (abs >= 0.5) return `Moderate ${dir}`
  if (abs >= 0.2) return `Weak ${dir}`
  return 'No meaningful correlation'
}

function simpleLinearRegression(points) {
  const n = points.length
  if (n < 2) return null
  const sumX = points.reduce((s, p) => s + p.x, 0)
  const sumY = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return null
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

function fmt(v) {
  if (v === null || v === undefined) return '-'
  if (typeof v !== 'number') return v
  return Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3)
}
