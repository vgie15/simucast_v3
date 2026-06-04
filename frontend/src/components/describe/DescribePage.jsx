/* ============================================================
 * PAGE: DESCRIBE / DESCRIPTIVE STATISTICS
 * Keywords: describe, descriptives, summary, histogram, mean, std, distribution
 * ============================================================ */
import React, { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
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
import { SparkleIcon } from '../ai/AIExplainers'
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
  Trash2,
  X,
  LayoutGrid,
  Save
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
const CB_LAYER_TYPES = [
  { key: 'bar', label: 'Bar' },
  { key: 'line', label: 'Line' },
  { key: 'scatter', label: 'Scatter' },
]
const CB_COMBINABLE_TYPES = new Set(CB_LAYER_TYPES.map(t => t.key))

const chartTypeLabel = (type) => {
  if (type === 'horizontal bar') return 'H. Bar'
  if (!type) return 'Chart'
  return type.charAt(0).toUpperCase() + type.slice(1)
}

const normalizeHexColor = (value, fallback = '#f97316') => {
  const text = String(value || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text
  if (/^[0-9a-fA-F]{6}$/.test(text)) return `#${text}`
  return fallback
}

const makeChartLayer = (index = 0, base = {}) => ({
  id: base.id || `layer-${Date.now()}-${index}`,
  type: base.type || 'bar',
  x: base.x || '',
  y: base.y || '',
  color: normalizeHexColor(base.color, CB_COLORS[index % CB_COLORS.length]),
})

const normalizeChartLayers = (layers, fallback = {}) => {
  const source = Array.isArray(layers) && layers.length
    ? layers
    : [{ type: fallback.type, x: fallback.xAxis, y: fallback.yAxis, color: fallback.color }]
  return source.slice(0, 3).map((layer, index) => makeChartLayer(index, {
    id: layer.id,
    type: layer.type || fallback.type || 'bar',
    x: layer.x ?? fallback.xAxis ?? '',
    y: layer.y ?? fallback.yAxis ?? '',
    color: layer.color || CB_COLORS[index % CB_COLORS.length],
  }))
}

const buildMixedChartData = (rows, layers, agg = 'Mean') => {
  const activeLayers = (layers || []).filter(layer => layer?.x && layer?.y && CB_COMBINABLE_TYPES.has(layer.type))
  if (!rows?.length || activeLayers.length < 2) return null
  const xAxis = activeLayers[0].x
  if (!xAxis || activeLayers.some(layer => layer.x !== xAxis)) return null
  const labels = Array.from(new Set(rows.map(row => String(row[xAxis] ?? 'None')))).sort()
  const aggregateValue = (groupRows, col, type) => {
    if (type === 'Count') return groupRows.length
    const nums = groupRows.map(row => Number(row[col])).filter(Number.isFinite)
    if (!nums.length) return 0
    if (type === 'Sum') return nums.reduce((a, b) => a + b, 0)
    if (type === 'Mean') return nums.reduce((a, b) => a + b, 0) / nums.length
    if (type === 'Max') return Math.max(...nums)
    return 0
  }
  return {
    labels,
    datasets: activeLayers.map((layer, index) => {
      const color = layer.color || CB_COLORS[index % CB_COLORS.length]
      if (layer.type === 'scatter') {
        return {
          type: 'scatter',
          label: `${layer.y} (scatter)`,
          data: rows
            .map(row => ({ x: String(row[xAxis] ?? 'None'), y: Number(row[layer.y]) }))
            .filter(point => point.x && Number.isFinite(point.y))
            .slice(0, 500),
          backgroundColor: color,
          borderColor: color,
          pointRadius: 4,
          pointHoverRadius: 6,
        }
      }
      return {
        type: layer.type,
        label: `${layer.y} (${layer.type})`,
        data: labels.map(label => aggregateValue(rows.filter(row => String(row[xAxis] ?? 'None') === label), layer.y, agg)),
        backgroundColor: layer.type === 'bar' ? color : `${color}22`,
        borderColor: color,
        borderWidth: layer.type === 'line' ? 2.5 : 1,
        borderRadius: layer.type === 'bar' ? 4 : undefined,
        tension: layer.type === 'line' ? 0.25 : undefined,
        fill: false,
        pointRadius: layer.type === 'line' ? 4 : undefined,
        pointHoverRadius: layer.type === 'line' ? 6 : undefined,
      }
    })
  }
}

const describePageCache = new Map()

export default function DescribePage({ dataset, initialData }) {
  // Bust the module-level describePageCache when the dataset is refreshed
  // (stage changes, or ProjectWorkspace increments refreshKey which remounts us).
  // We track both the stage ID and a monotonically increasing counter so that
  // cache is always cleared on remount even if the stage ID stayed the same.
  const prevStageRef = useRef(null)
  const mountCountRef = useRef(0)
  useEffect(() => {
    if (!dataset?.id) return
    mountCountRef.current += 1
    const stageChanged = prevStageRef.current !== null && prevStageRef.current !== dataset.current_stage_id
    if (stageChanged || mountCountRef.current > 1) {
      for (const key of describePageCache.keys()) {
        if (key.startsWith(`${dataset.id}|`)) {
          describePageCache.delete(key)
        }
      }
    }
    prevStageRef.current = dataset.current_stage_id
  }, [dataset?.id, dataset?.current_stage_id])

  // Correlation heatmap
  const [corrResult, setCorrResult] = useState(null)
  const [corrLoading, setCorrLoading] = useState(false)
  const [selectedCorrCell, setSelectedCorrCell] = useState(null)
  const [explainMode, setExplainMode] = useState(false)
  const [explainPopup, setExplainPopup] = useState(null)

  // Chart builder
  const [datasetRows, setDatasetRows] = useState([])
  const [loadingRows, setLoadingRows] = useState(false)
  const [chartBuilderType, setChartBuilderType] = useState('bar')
  const [chartBuilderX, setChartBuilderX] = useState('')
  const [chartBuilderY, setChartBuilderY] = useState('')
  const [chartBuilderGroupBy, setChartBuilderGroupBy] = useState('')
  const [chartBuilderAgg, setChartBuilderAgg] = useState('Mean')
  const [chartBuilderColor, setChartBuilderColor] = useState('#f97316')
  const [chartLayersEnabled, setChartLayersEnabled] = useState(false)
  const [chartLayers, setChartLayers] = useState(() => [makeChartLayer(0, { type: 'bar', color: '#f97316' })])
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
  const [expandedFlags, setExpandedFlags] = useState(new Set())
  const [activeCatVar, setActiveCatVar] = useState(null)
  const [catFilter, setCatFilter] = useState('all')
  // Numeric detail panel & compare
  const [selectedNumericVar, setSelectedNumericVar] = useState(null)
  const [numericCompareMode, setNumericCompareMode] = useState(false)
  // Cramér's V matrix
  const [corrFilter, setCorrFilter] = useState('all')
  const [selectedCramerCell, setSelectedCramerCell] = useState(null)
  const [cramersResult, setCramersResult] = useState(null)
  const [cramersLoading, setCramersLoading] = useState(false)
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
        if (s.chartLayersEnabled !== undefined) setChartLayersEnabled(Boolean(s.chartLayersEnabled))
        if (Array.isArray(s.chartLayers)) setChartLayers(normalizeChartLayers(s.chartLayers, {
          type: s.chartBuilderType,
          xAxis: s.chartBuilderX,
          yAxis: s.chartBuilderY,
          color: s.chartBuilderColor,
        }))
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
      chartLayersEnabled, chartLayers, chartTitle, chartNote, cbShowLabels, cbShowLegend, cbSortOrder
    }))
  }, [dataset?.id, chartBuilderType, chartBuilderX, chartBuilderY, chartBuilderGroupBy, chartBuilderAgg, chartBuilderColor, chartLayersEnabled, chartLayers, chartTitle, chartNote, cbShowLabels, cbShowLegend, cbSortOrder])

  useEffect(() => {
    setChartLayers(prev => {
      const base = prev[0] || makeChartLayer(0)
      const nextBase = {
        ...base,
        type: chartBuilderType,
        x: chartBuilderX,
        y: chartBuilderY,
        color: chartBuilderColor,
      }
      const next = [nextBase, ...prev.slice(1).map(layer => ({ ...layer, x: chartBuilderX }))]
      const same = JSON.stringify(prev) === JSON.stringify(next)
      return same ? prev : next
    })
  }, [chartBuilderType, chartBuilderX, chartBuilderY, chartBuilderColor])

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

  const runCramers = async (vars) => {
    const allCat = (dataset.variables || [])
      .filter(v => !['numeric', 'int', 'float'].includes(v.dtype))
      .map(v => v.name)
    const catCols = vars ? vars.filter(n => allCat.includes(n)) : allCat
    if (catCols.length < 2) return
    setCramersLoading(true)
    try {
      const cramers = await api.runTest(dataset.id, { kind: 'cramers_matrix', variables: catCols })
      if (vars) {
        const ck = `${dataset.id}|${dataset.current_stage_id}|cramers`
        describePageCache.set(ck, cramers)
      }
      setCramersResult(cramers)
    } catch {} finally { setCramersLoading(false) }
  }

  // Restore/auto-run Cramér's V matrix
  useEffect(() => {
    if (!dataset?.id) { setCramersResult(null); return }
    const catCols = (dataset.variables || [])
      .filter(v => !['numeric', 'int', 'float'].includes(v.dtype))
      .map(v => v.name)
    if (catCols.length < 2) return
    const ck = `${dataset.id}|${dataset.current_stage_id}|cramers`
    const cached = describePageCache.get(ck)
    if (cached) { setCramersResult(cached); return }
    api.listAnalyses(dataset.id, 'test_cramers_matrix', 1)
      .then(({ analyses }) => {
        if (analyses?.[0]) {
          const r = analyses[0].result
          describePageCache.set(ck, r)
          setCramersResult(r)
        } else {
          api.runTest(dataset.id, { kind: 'cramers_matrix', variables: catCols })
            .then(cramers => { describePageCache.set(ck, cramers); setCramersResult(cramers) })
            .catch(() => {})
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

  useEffect(() => {
    document.body.classList.toggle('ax-explain-mode-on', explainMode)
    return () => document.body.classList.remove('ax-explain-mode-on')
  }, [explainMode])

  if (!dataset) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>

  const runCorrelation = async (vars) => {
    const allNumeric = (dataset.variables || [])
      .filter(v => ['numeric', 'int', 'float'].includes(v.dtype))
      .map(v => v.name)
    const numericVars = vars
      ? vars.filter(n => allNumeric.includes(n))
      : allNumeric
    if (numericVars.length < 2) return
    setCorrLoading(true)
    try {
      const corr = await api.runTest(dataset.id, { kind: 'corr', variables: numericVars })
      if (vars) {
        const ck = `${dataset.id}|${dataset.current_stage_id}|corr`
        describePageCache.set(ck, corr)
      }
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
      const ck = `${dataset.id}|${dataset.current_stage_id}|desc`
      describePageCache.set(ck, { result, firstCat: (result.stats || []).find(s => s.kind === 'categorical')?.variable })
      setDescResult(result)
      const firstCat = (result.stats || []).find(s => s.kind === 'categorical')
      if (firstCat) setActiveCatVar(prev => prev || firstCat.variable)
      // Refresh correlations and associations using only the selected variables
      runCorrelation(selectedVars)
      runCramers(selectedVars)
    } catch (e) {
      console.error('Describe failed:', e)
    } finally {
      setDescLoading(false)
    }
  }

  const effectiveLayers = normalizeChartLayers(chartLayers, {
    type: chartBuilderType,
    xAxis: chartBuilderX,
    yAxis: chartBuilderY,
    color: chartBuilderColor,
  })
  const canLayerChart = CB_COMBINABLE_TYPES.has(chartBuilderType)
  const layersAvailable = chartLayersEnabled && canLayerChart
  const activeLayerCount = layersAvailable ? effectiveLayers.filter(layer => layer.x && layer.y && CB_COMBINABLE_TYPES.has(layer.type)).length : 1
  const isMixedChart = layersAvailable && effectiveLayers.length > 1 && activeLayerCount > 1
  const mixedTypeLabel = isMixedChart
    ? `${[...new Set(effectiveLayers.slice(0, activeLayerCount).map(layer => chartTypeLabel(layer.type)))].join(' + ')} chart`
    : null
  const mixedSubtitle = isMixedChart
    ? `${effectiveLayers[0]?.x || 'X field'} vs ${effectiveLayers.slice(0, activeLayerCount).map(layer => layer.y).filter(Boolean).join(', ')} - ${chartBuilderAgg}`
    : null

  const updateChartLayer = (index, patch) => {
    setActiveChartId(null)
    if (!chartLayersEnabled) setChartLayersEnabled(true)
    setChartLayers(prev => {
      const next = normalizeChartLayers(prev, {
        type: chartBuilderType,
        xAxis: chartBuilderX,
        yAxis: chartBuilderY,
        color: chartBuilderColor,
      })
      next[index] = { ...next[index], ...patch }
      if (index === 0) {
        if (patch.type) setChartBuilderType(patch.type)
        if (patch.x !== undefined) setChartBuilderX(patch.x)
        if (patch.y !== undefined) setChartBuilderY(patch.y)
        if (patch.color) setChartBuilderColor(patch.color)
        next.forEach((layer, layerIndex) => {
          if (layerIndex > 0) layer.x = next[0].x
        })
      }
      const filled = next.filter(layer => layer.y && CB_COMBINABLE_TYPES.has(layer.type))
      if (filled.length > 1) setChartTitle(`${[...new Set(filled.map(layer => chartTypeLabel(layer.type)))].join(' + ')} chart`)
      return next
    })
  }

  const addChartLayer = () => {
    if (!canLayerChart || effectiveLayers.length >= 3) return
    setActiveChartId(null)
    setChartLayersEnabled(true)
    setChartLayers(prev => {
      const next = normalizeChartLayers(prev, {
        type: chartBuilderType,
        xAxis: chartBuilderX,
        yAxis: chartBuilderY,
        color: chartBuilderColor,
      })
      const layerIndex = next.length
      next.push(makeChartLayer(layerIndex, {
        type: chartBuilderType === 'bar' ? 'line' : 'bar',
        x: next[0]?.x || chartBuilderX,
        y: '',
        color: CB_COLORS[layerIndex % CB_COLORS.length],
      }))
      setChartTitle(`${chartTypeLabel(next[0]?.type || chartBuilderType)} + ${chartTypeLabel(next[layerIndex].type)} chart`)
      return next
    })
  }

  const removeChartLayer = (index) => {
    if (index === 0) return
    setActiveChartId(null)
    setChartLayers(prev => {
      const next = normalizeChartLayers(prev, {
      type: chartBuilderType,
      xAxis: chartBuilderX,
      yAxis: chartBuilderY,
      color: chartBuilderColor,
      }).filter((_, i) => i !== index)
      if (next.length === 1) setChartTitle(`${chartTypeLabel(next[0]?.type || chartBuilderType)} chart`)
      return next
    })
  }

  const renderLiveChart = () => {
    if (isMixedChart) {
      const mixedData = buildMixedChartData(datasetRows, effectiveLayers, chartBuilderAgg)
      if (!mixedData) {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '300px', color: '#9ca3af', gap: '12px' }}>
            <BarChart3 size={48} strokeWidth={1} />
            <span style={{ fontSize: '13px', fontWeight: '500', color: '#6b7280' }}>Complete each layer to see the mixed chart</span>
          </div>
        )
      }
      const options = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true, position: 'bottom', labels: { font: { size: 10 } } } },
        scales: {
          x: { type: 'category', ticks: { font: { size: 10 } } },
          y: { ticks: { font: { size: 10 } }, beginAtZero: true }
        }
      }
      return <Chart key={`mixed-${effectiveLayers.map(l => `${l.type}-${l.x}-${l.y}-${l.color}`).join('|')}`} ref={chartRef} type="bar" data={mixedData} options={options} />
    }

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
    if (Array.isArray(sc.layers) && sc.layers.length > 1) {
      const layers = normalizeChartLayers(sc.layers, sc)
      const cd = buildMixedChartData(datasetRows, layers, sc.aggregation || 'Mean')
      if (!cd) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', fontSize: 11 }}>No data</div>
      return (
        <Chart
          type="bar"
          data={cd}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: true, labels: { font: { size: 9 }, boxWidth: 9 } } },
            scales: { x: { type: 'category', ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 9 } }, beginAtZero: true } }
          }}
        />
      )
    }
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

  const handleSaveHeatmap = () => {
    const newChart = {
      id: Date.now(),
      title: 'Correlation Heatmap — Numeric Pairs',
      type: 'correlation-heatmap',
      note: 'Grid of Pearson correlation coefficients between numeric variables.',
      showLabels: true,
      showLegend: true
    }
    const willTruncate = savedCharts.length >= 8
    setSavedCharts(prev => { const u = [...prev, newChart]; return u.length > 8 ? u.slice(1) : u })
    setActiveChartId(newChart.id)
    showCbToast(willTruncate ? 'Max 8 charts saved — oldest removed' : 'Heatmap saved to report')
  }

  const handleSaveDetailedChart = () => {
    if (!selectedCorrCell) return
    const { row, col } = selectedCorrCell
    const isSelf = row === col
    const val = Number(corrResult?.matrix?.[row]?.[col] ?? 0)
    
    let newChart = null
    if (isSelf) {
      newChart = {
        id: Date.now(),
        title: `${row} Distribution`,
        type: 'histogram',
        xAxis: row,
        yAxis: null,
        note: `Histogram showing distribution of values for ${row}.`,
        showLabels: true,
        showLegend: false
      }
    } else {
      newChart = {
        id: Date.now(),
        title: `${row} vs ${col} Scatter Plot`,
        type: 'scatter',
        xAxis: col,
        yAxis: row,
        note: `Scatter plot of ${row} by ${col} (Pearson correlation coefficient r = ${val.toFixed(3)}).`,
        showLabels: true,
        showLegend: false
      }
    }
    const willTruncate = savedCharts.length >= 8
    setSavedCharts(prev => { const u = [...prev, newChart]; return u.length > 8 ? u.slice(1) : u })
    setActiveChartId(newChart.id)
    showCbToast(willTruncate ? 'Max 8 charts saved — oldest removed' : `Chart saved — ${newChart.title}`)
  }

  const handleSaveChart = () => {
    const savedLayers = isMixedChart ? effectiveLayers.slice(0, activeLayerCount).map(({ type, x, y, color }) => ({ type, x, y, color })) : undefined
    const savedType = isMixedChart ? 'mixed' : chartBuilderType
    const newChart = {
      id: Date.now(), title: isMixedChart ? (chartTitle || mixedTypeLabel) : chartTitle, type: savedType,
      xAxis: chartBuilderX, yAxis: chartBuilderY, colorBy: chartBuilderGroupBy,
      aggregation: chartBuilderAgg, color: chartBuilderColor, layers: savedLayers,
      layersEnabled: isMixedChart,
      note: chartNote, showLabels: cbShowLabels, showLegend: cbShowLegend, sortOrder: cbSortOrder
    }
    const willTruncate = savedCharts.length >= 8
    setSavedCharts(prev => { const u = [...prev, newChart]; return u.length > 8 ? u.slice(1) : u })
    setActiveChartId(newChart.id)
    showCbToast(willTruncate ? 'Max 8 charts saved — oldest removed' : `Chart saved — ${newChart.title}`)
  }

  const handleLoadChart = (sc) => {
    const loadedLayers = normalizeChartLayers(sc.layers, sc)
    const baseLayer = loadedLayers[0]
    setChartLayersEnabled(Array.isArray(sc.layers) && sc.layers.length > 1)
    setChartLayers(loadedLayers)
    setChartBuilderType(baseLayer?.type || sc.type); setChartBuilderX(baseLayer?.x ?? sc.xAxis); setChartBuilderY(baseLayer?.y ?? sc.yAxis)
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
    const savedLayers = isMixedChart ? effectiveLayers.slice(0, activeLayerCount).map(({ type, x, y, color }) => ({ type, x, y, color })) : undefined
    const savedType = isMixedChart ? 'mixed' : chartBuilderType
    const newChart = {
      id: Date.now(), title: `Copy of ${chartTitle}`, type: savedType,
      xAxis: chartBuilderX, yAxis: chartBuilderY, colorBy: chartBuilderGroupBy,
      aggregation: chartBuilderAgg, color: chartBuilderColor, layers: savedLayers,
      layersEnabled: isMixedChart,
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

  const cbTypeLabel = isMixedChart ? 'Mixed' : chartTypeLabel(chartBuilderType)

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

  useEffect(() => {
    const onOpenSection = (event) => {
      const section = event.detail?.section
      if (!section) return
      jumpToDescribeSection(section)
    }
    window.addEventListener('simucast:describe-section-open', onOpenSection)
    return () => window.removeEventListener('simucast:describe-section-open', onOpenSection)
  }, [dataset?.id])

  const describeNavItems = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, badge: `${qualityFlags.length} flags` },
    { id: 'numeric', label: 'Numeric variables', icon: Hash, badge: numericStats.length },
    { id: 'categorical', label: 'Categorical variables', icon: Tags, badge: catStats.length },
    { id: 'correlations', label: 'Correlations', icon: Sigma, badge: strongestCorrPair ? `r=${Math.abs(strongestCorrPair.val).toFixed(2)}` : 'run' },
    { id: 'chart-builder', label: 'Chart builder', icon: BarChart3, badge: `${savedCharts.length} saved` },
  ]
  const activeSectionLabel = describeNavItems.find(i => i.id === activeDescribeSection)?.label || activeDescribeSection

  const openExplain = (meta, event) => {
    if (!explainMode) return
    event?.preventDefault?.()
    event?.stopPropagation?.()
    const target = event?.currentTarget || event?.target
    const sourceRect = target?.getBoundingClientRect ? target.getBoundingClientRect() : null
    setExplainPopup(buildDescribeExplainMeta(meta, {
      dataset,
      descResult,
      numericStats,
      catStats,
      qualityFlags,
      groupedQualityFlags,
      strongestCorrPair,
      activeDescribeSection,
      activeSectionLabel,
      activeCatStat,
      selectedNumericVar,
      selectedCorrCell,
      selectedCramerCell,
      corrResult,
      cramersResult,
      chartBuilderType,
      chartBuilderX,
      chartBuilderY,
      chartBuilderAgg,
      chartTitle,
      sourceEl: target?.getBoundingClientRect ? target : null,
      sourceRect,
    }))
  }

  const explainAttrs = (meta, className = '', capture = true) => {
    const attrs = {
      className: `${className} ${explainMode ? 'ax-explain-selectable' : ''}`.trim(),
      title: explainMode ? `Explain ${meta.title}` : undefined,
    }
    const handler = (event) => openExplain(meta, event)
    if (capture) {
      attrs.onClickCapture = handler
      attrs.onPointerDownCapture = handler
    } else {
      attrs.onClick = handler
    }
    return attrs
  }

  return (
    <div className="ax-desc-layout ax-desc-redesign">
      <aside className="ax-desc-left">
        {/* Header: title + subtitle only — separator line sits right below */}
        <div className="ax-desc-left-sticky">
          <h1 {...explainAttrs({ id: 'sidebar-header', title: 'Descriptive statistics header', type: 'sidebar' }, 'ax-desc-title')}>Descriptive statistics</h1>
          <p className="ax-desc-sub">Summarize variables and spot patterns before modeling</p>
        </div>
        <div className="ax-desc-left-vars">
          {/* Section navigation */}
          <nav className="ax-desc-nav" aria-label="Describe sections">
            {describeNavItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  id={`describe-nav-${item.id}`}
                  key={item.id}
                  type="button"
                  {...explainAttrs({ id: `sidebar-tab-${item.id}`, title: `${item.label} tab`, type: 'sidebar-tab', section: item.id }, `ax-desc-nav-item ${activeDescribeSection === item.id ? 'active' : ''}`)}
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
                  {...explainAttrs({ id: `variable-chip-${v.name}`, title: `${v.name} variable filter chip`, type: 'variable-chip', variable: v.name }, `ax-desc-var-chip ${isSel ? 'active' : ''}`)}
                  onClick={() => setSelectedVars(prev => prev.includes(v.name) ? prev.filter(n => n !== v.name) : [...prev, v.name])}
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
            disabled={!explainMode && (descLoading || !selectedVars.length)}
            {...explainAttrs({ id: 'run-descriptives', title: 'Run descriptives button', type: 'action' }, 'ax-desc-run-btn')}
          >
            {descLoading ? <InlineSpinner label="Running..." /> : <><Play size={14} /> Run descriptives</>}
          </button>
        </div>
      </aside>
      <main className="ax-desc-right">
        <div className={`ax-desc-right-scroll ${activeDescribeSection === 'chart-builder' ? 'no-scroll' : ''}`}>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-accent, #f97316)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Describe · {activeSectionLabel}
        </span>
        <button
          type="button"
          className={`ax-explain-mode-toggle ${explainMode ? 'active' : ''}`}
          onClick={() => {
            setExplainMode(v => !v)
            setExplainPopup(null)
          }}
          title={explainMode ? 'Turn off Explain Mode' : 'Turn on Explain Mode'}
        >
          <SparkleIcon size={13} />
          Explain Mode
          <span aria-hidden="true" />
        </button>
      </div>
      {activeDescribeSection === 'overview' && (
        <>
      <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 16 }}>Updated from dataset stage {dataset.current_stage_id}</p>

      {/* ──── SUMMARY STAT CARDS ──── */}
      {descResult && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          {[
            { big: numericStats.length + catStats.length, label: 'Variables analyzed', sub: `${numericStats.length} can be measured, ${catStats.length} are categories`, orange: false },
            { big: totalRows ?? '—', label: 'Total records', sub: totalRows != null ? `All ${totalRows.toLocaleString()} rows are valid, none dropped` : '', orange: false },
            { big: skewedVars.length, label: 'Skewed variables', sub: skewedVars.length === 0 ? 'All numeric columns are evenly distributed' : skewedVars.slice(0, 3).map(s => s.variable).join(', ') + (skewedVars.length > 3 ? ' and more' : '') + ' need attention', orange: skewedVars.length > 0 },
            { big: strongestCorrPair ? Math.abs(strongestCorrPair.val).toFixed(2) : '—', label: 'Strongest correlation', sub: strongestCorrPair ? `${strongestCorrPair.a} and ${strongestCorrPair.b} move almost identically` : 'Compute correlations first', orange: false }
          ].map((card, i) => (
            <div
              key={i}
              {...explainAttrs({ id: `overview-metric-${card.label}`, title: `${card.label} metric card`, type: 'overview-metric', label: card.label, value: card.big, detail: card.sub })}
              style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '16px 20px' }}
            >
              <div style={{ fontSize: 28, fontWeight: 700, color: card.orange ? ORANGE_ACCENT : '#111827', letterSpacing: '-0.5px', marginBottom: 4, lineHeight: 1 }}>{card.big}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 3 }}>{card.label}</div>
              <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.4 }}>{card.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* ──── SECTION 1: ISSUES CARDS ──── */}
      {descResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {qualityFlags.length === 0 ? (
            <div {...explainAttrs({ id: 'issues-detected-card', title: 'Issues detected card', type: 'issues-card' })} style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 14, padding: '14px 20px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#16a34a' }}>✓ No issues detected</div>
            </div>
          ) : (
            qualityFlags.map((flag, i) => (
              <div key={i} {...explainAttrs({ id: `issue-row-${flag.variable}-${flag.type}`, title: `${flag.variable} ${flag.type} issue row`, type: 'issue-row', flag })} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ color: ORANGE_ACCENT, fontWeight: 700, fontSize: 13 }}>{flag.variable}</span>
                    <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 4 }}>{flag.desc}</span>
                  </div>
                </div>
                <button type="button" onClick={() => { setActiveCatVar(flag.variable); jumpToDescribeSection('categorical') }} style={{ background: 'none', border: 'none', color: ORANGE_ACCENT, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  View →
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* ──── SECTION 2: COLUMN QUICK-SCAN ──── */}
      {descResult && (
        <div {...explainAttrs({ id: 'column-quick-scan-table', title: 'Column Quick-Scan table', type: 'quick-scan-table' }, '', false)} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, marginBottom: 16, overflow: 'hidden' }}>
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
                  <tr key={s.variable} {...explainAttrs({ id: `quick-scan-row-${s.variable}`, title: `${s.variable} quick-scan row`, type: 'quick-scan-row', stat: s })} style={{ background: i % 2 === 0 ? 'transparent' : '#fafafa', borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '6px 12px', fontWeight: 600, color: '#111827', fontFamily: 'var(--font-mono, monospace)' }}>{s.variable}</td>
                    <td style={{ padding: '6px 12px' }}>
                      <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: typeBadge.bg, color: typeBadge.color }}>{typeLabel}</span>
                    </td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', color: '#374151', fontFamily: 'var(--font-mono, monospace)' }}>{s.unique ?? '—'}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', color: missing > 0 ? '#f97316' : '#16a34a', fontFamily: 'var(--font-mono, monospace)', fontWeight: missing > 0 ? 600 : 400 }}>{missing}</td>
                    <td style={{ padding: '6px 12px' }}>
                      {hasIssue ? (
                        <div>
                          <div style={{ color: '#f97316', fontSize: 11, fontWeight: 600 }}>⚠ {issueFlag?.type === 'outlier' ? 'outliers' : issueFlag?.type === 'mixed_labels' ? 'mixed labels' : 'imbalance'}</div>
                          <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 1 }}>
                            {issueFlag?.type === 'imbalance' ? 'One category dominates' : issueFlag?.type === 'outlier' ? 'Has extreme values' : 'Mixed label format'}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ color: '#16a34a', fontSize: 11, fontWeight: 600 }}>✓ Clean</div>
                          <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 1 }}>No issues found</div>
                        </div>
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
        <div {...explainAttrs({ id: 'notable-findings-card', title: 'Notable Findings card', type: 'notable-card' }, '', false)} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Notable findings</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {strongestCorrPair && Math.abs(strongestCorrPair.val) > 0.5 && (
              <div>
                <div style={{ fontSize: 12, color: '#111827' }}>
                  <span style={{ color: '#f97316', marginRight: 6 }}>●</span>
                  Strong correlation: {strongestCorrPair.a} ↔ {strongestCorrPair.b} (r = {strongestCorrPair.val.toFixed(2)})
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, paddingLeft: 18, lineHeight: 1.5 }}>
                  These two move so closely together that using both in your model may not add extra value — consider keeping just one.
                </div>
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
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, paddingLeft: 18, lineHeight: 1.5 }}>
                    {isImbalanced
                      ? 'When one category dominates, the model tends to favor it. You may want to address this before training.'
                      : 'This column is evenly split — no action needed.'}
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
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, paddingLeft: 18, lineHeight: 1.5 }}>
                  Skewed data can make some models less reliable. A log or square root transformation may help normalize it.
                </div>
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
              {...explainAttrs({ id: 'explore-correlations-button', title: 'Explore in Correlations button', type: 'next-step' })}
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
            {...explainAttrs({ id: 'visualize-chart-builder-button', title: 'Visualize in Chart Builder button', type: 'next-step' })}
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
        <div {...explainAttrs({ id: 'data-quality-flags-card', title: 'Data Quality Flags card', type: 'quality-flags-card' }, '', false)} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '14px 20px', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Data Quality Flags</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#374151', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 20, padding: '2px 9px' }}>{qualityFlags.length} issue{qualityFlags.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {qualityFlags.map((flag, i) => {
              const isExpanded = expandedFlags.has(flag.variable + flag.type)
              const toggleFlag = () => {
                const key = flag.variable + flag.type
                setExpandedFlags(prev => {
                  const next = new Set(prev)
                  if (next.has(key)) next.delete(key); else next.add(key)
                  return next
                })
              }
              const explainText = flag.type === 'imbalance'
                ? 'This column is dominated by a single value. When training a model, the algorithm may learn to always predict the majority class. Consider techniques like resampling or class weighting to address this.'
                : flag.type === 'outlier'
                ? 'Extreme values can pull statistical summaries and model coefficients in misleading directions. Inspect the distribution and consider winsorizing, transforming, or removing extreme points.'
                : flag.type === 'mixed_labels'
                ? 'Multiple labels appear to describe the same category. Standardizing these values will help the model treat them consistently rather than splitting their signal across redundant labels.'
                : 'This flag may indicate a data quality issue worth reviewing before modeling.'
              return (
                <div key={`${flag.variable}-${flag.type}`} {...explainAttrs({ id: `quality-flag-${flag.variable}-${flag.type}`, title: `${flag.variable} data quality flag row`, type: 'quality-flag-row', flag })} style={{ borderBottom: i < qualityFlags.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                  <div
                    onClick={toggleFlag}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', cursor: 'pointer' }}
                  >
                    <div style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0, background: ORANGE_ACCENT }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ color: ORANGE_ACCENT, fontWeight: 700, fontSize: 13 }}>{flag.variable}</span>
                      <span style={{ color: '#374151', fontSize: 12, fontWeight: 500, marginLeft: 4 }}>
                        {flag.type === 'imbalance' ? '— class imbalance' : flag.type === 'outlier' ? '— potential outliers' : flag.type === 'mixed_labels' ? '— mixed labels' : ''}
                      </span>
                    </div>
                    <button type="button" onClick={e => { e.stopPropagation(); setActiveCatVar(flag.variable); jumpToDescribeSection('categorical') }} style={{ background: 'none', border: 'none', color: ORANGE_ACCENT, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      Learn more →
                    </button>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: '0 0 10px 22px', fontSize: 11, color: '#6b7280', lineHeight: 1.6 }}>
                      {explainText}
                    </div>
                  )}
                </div>
              )
            })}
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
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: activeDescribeSection === 'numeric' && selectedNumericVar && !numericCompareMode
              ? 'minmax(0, 3fr) minmax(320px, 2fr)'
              : 'minmax(0, 1fr)',
            gap: 24,
            marginBottom: 20,
            alignItems: 'stretch',
            paddingRight: activeDescribeSection === 'numeric' && selectedNumericVar && !numericCompareMode ? 48 : 0
          }}
        >
          {activeDescribeSection === 'numeric' && numericStats.length > 0 && (
            <div {...explainAttrs({ id: 'numeric-variables-container', title: 'Numeric variables container', type: 'numeric-container' }, '', false)} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '24px 24px 24px', height: 560, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#5b6573', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Numeric Variables — {numericStats.length} Selected
                </span>
                <button
                  type="button"
                  {...explainAttrs({ id: 'numeric-compare-button', title: 'Compare button', type: 'numeric-control' })}
                  onClick={() => setNumericCompareMode(v => !v)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 11px', borderRadius: 999, border: `1.5px solid ${numericCompareMode ? '#ea580c' : '#d1d5db'}`, background: numericCompareMode ? '#fff7ed' : '#fff', fontSize: 11, fontWeight: 600, color: numericCompareMode ? '#ea580c' : '#374151', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  {numericCompareMode ? 'Exit compare' : 'Compare'}
                </button>
              </div>
              {numericCompareMode ? (() => {
                const densityVars = numericStats.slice(0, 8)
                const allCounts = {}
                let maxDensity = 0
                let globalMin = Infinity, globalMax = -Infinity
                const DENSITY_COLORS = ['#f97316','#3b82f6','#10b981','#8b5cf6','#ec4899','#f59e0b','#6366f1','#14b8a6']
                densityVars.forEach((s, idx) => {
                  const hist = descResult?.histograms?.[s.variable]
                  if (!hist?.counts?.length) return
                  const hMin = Math.min(...(hist.bins || []))
                  const hMax = Math.max(...(hist.bins || []))
                  if (hMin < globalMin) globalMin = hMin
                  if (hMax > globalMax) globalMax = hMax
                  const maxC = Math.max(...hist.counts)
                  if (maxC > maxDensity) maxDensity = maxC
                  allCounts[s.variable] = { counts: hist.counts, maxC, idx, mean: s.mean, std: s.std }
                })
                const globalRange = globalMax - globalMin || 1
                const numBins = 40
                // Build density estimate using KDE-like normalized bins
                const densityCurves = Object.entries(allCounts).map(([name, d]) => {
                  const normalized = d.counts.map((c, i) => ({
                    val: i / d.counts.length * globalRange + globalMin,
                    density: c / d.maxC
                  }))
                  return { name, normalized, idx: d.idx }
                })
                const hasData = densityCurves.length > 0
                let compareSummary = ''
                if (densityCurves.length >= 2) {
                  const names = densityCurves.map(d => d.name)
                  compareSummary = `Comparing distributions of ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}.`
                } else if (densityCurves.length === 1) {
                  compareSummary = `Distribution of ${densityCurves[0].name}.`
                }
                return (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    {compareSummary && (
                      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 10, padding: '6px 10px', background: '#f9fafb', borderRadius: 8, lineHeight: 1.4 }}>
                        {compareSummary}
                      </div>
                    )}
                    <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 0, position: 'relative', minHeight: 300 }}>
                      {hasData ? (
                        <>
                          {/* Y-axis label */}
                          <div style={{ position: 'absolute', left: -8, top: '50%', transform: 'rotate(-90deg) translateX(-50%)', transformOrigin: 'left center', fontSize: 9, color: '#9ca3af', whiteSpace: 'nowrap' }}>Normalized density</div>
                          {/* Grid lines + curves */}
                          <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
                            {/* Horizontal grid */}
                            {[0, 0.25, 0.5, 0.75, 1].map(pct => (
                              <line key={pct} x1="40" y1={300 - pct * 260} x2="100%" y2={300 - pct * 260} stroke="#f3f4f6" strokeWidth="1" />
                            ))}
                            {/* Density curves */}
                            {densityCurves.map(({ name, normalized, idx }) => {
                              const pts = normalized.map((p, i) => {
                                const x = 40 + (i / (normalized.length - 1 || 1)) * (280 - 40)
                                const y = 300 - p.density * 240 - 10
                                return `${x},${y}`
                              }).join(' ')
                              const color = DENSITY_COLORS[idx % DENSITY_COLORS.length]
                              return <polyline key={name} points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
                            })}
                            {/* X-axis */}
                            <line x1="40" y1={300 - 10} x2="100%" y2={300 - 10} stroke="#d1d5db" strokeWidth="1" />
                            <text x="40" y={300 + 12} fontSize="8" fill="#9ca3af">{globalMin.toFixed(1)}</text>
                            <text x="90%" y={300 + 12} fontSize="8" fill="#9ca3af" textAnchor="end">{globalMax.toFixed(1)}</text>
                          </svg>
                        </>
                      ) : (
                        <div style={{ width: '100%', textAlign: 'center', padding: 40, color: '#9ca3af', fontSize: 12 }}>No histogram data available for comparison.</div>
                      )}
                    </div>
                    {/* Legend */}
                    {densityCurves.length > 0 && (
                      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, justifyContent: 'center' }}>
                        {densityCurves.map(({ name, idx }) => (
                          <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#374151' }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: DENSITY_COLORS[idx % DENSITY_COLORS.length], flexShrink: 0 }} />
                            {name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })() : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: selectedNumericVar ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))',
                    gridAutoRows: 360,
                    gap: 16,
                    overflowY: 'auto',
                    paddingRight: 4,
                    minHeight: 0,
                    minWidth: 0
                  }}
                >
                  {numericStats.map(s => {
                    const isSelected = selectedNumericVar === s.variable
                    return (
                      <article key={s.variable}
                        {...explainAttrs({ id: `numeric-card-${s.variable}`, title: `${s.variable} numeric variable card`, type: 'numeric-card', stat: s })}
                        onClick={() => setSelectedNumericVar(isSelected ? null : s.variable)}
                        style={{ background: '#faf7f2', borderRadius: 12, padding: '22px 20px 16px', height: 360, overflow: 'hidden', cursor: 'pointer', border: isSelected ? `2px solid ${ORANGE_ACCENT}` : '2px solid transparent', transition: 'border-color 0.15s', minWidth: 0 }}
                      >
                        <h3 style={{ margin: '0 0 8px', fontSize: 16, lineHeight: 1.2, color: '#020617', fontWeight: 800, fontFamily: 'var(--font-mono, monospace)', overflowWrap: 'anywhere' }}>{s.variable}</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 26, rowGap: 10 }}>
                          <div>
                            <div style={{ color: '#667085', fontSize: 11, marginBottom: 2 }}>Mean</div>
                            <strong style={{ color: '#020617', fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-mono, monospace)' }}>{s.mean != null ? s.mean.toFixed(3).replace(/\.000$/, '.0') : '?'}</strong>
                          </div>
                          <div>
                            <div style={{ color: '#667085', fontSize: 11, marginBottom: 2 }}>SD</div>
                            <strong style={{ color: '#020617', fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-mono, monospace)' }}>{s.std != null ? s.std.toFixed(3).replace(/\.000$/, '.0') : '?'}</strong>
                          </div>
                          <div>
                            <div style={{ color: '#667085', fontSize: 11, marginBottom: 2 }}>Median</div>
                            <strong style={{ color: '#020617', fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-mono, monospace)' }}>{s.median != null ? s.median.toFixed(3).replace(/\.000$/, '.0') : '?'}</strong>
                          </div>
                          <div>
                            <div style={{ color: '#667085', fontSize: 11, marginBottom: 2 }}>Skew</div>
                            <strong style={{ color: '#020617', fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-mono, monospace)' }}>{s.skew != null ? s.skew.toFixed(3) : '?'}</strong>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 12, marginTop: 10, marginBottom: 8, paddingTop: 8, borderTop: '1px solid #e8e4df' }}>
                          <div>
                            <div style={{ color: '#667085', fontSize: 10 }}>Min</div>
                            <strong style={{ color: '#020617', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>{s.min != null ? s.min.toFixed(1) : '?'}</strong>
                          </div>
                          <div>
                            <div style={{ color: '#667085', fontSize: 10 }}>Max</div>
                            <strong style={{ color: '#020617', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>{s.max != null ? s.max.toFixed(1) : '?'}</strong>
                          </div>
                          <div>
                            <div style={{ color: '#667085', fontSize: 10 }}>Missing</div>
                            <strong style={{ color: (s.missing ?? 0) > 0 ? '#f97316' : '#16a34a', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>{(s.missing ?? 0)}{(s.n && s.missing) ? ` (${(s.missing / s.n * 100).toFixed(1)}%)` : ''}</strong>
                          </div>
                        </div>
                        {(() => {
                          const hist = descResult?.histograms?.[s.variable]
                          if (!hist?.counts?.length) return null
                          const maxC = Math.max(...hist.counts)
                          return (
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 40, marginTop: 4 }}>
                              {hist.counts.map((c, i) => (
                                <div key={i} style={{ flex: 1, height: `${maxC ? (c / maxC) * 100 : 0}%`, background: 'rgba(234, 88, 12, 0.5)', borderRadius: '2px 2px 0 0', minHeight: c > 0 ? 2 : 0 }} />
                              ))}
                            </div>
                          )
                        })()}
                        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6, lineHeight: 1.4 }}>
                          {s.skew != null && Math.abs(s.skew) < 0.5
                            ? '✅ Values are evenly spread — good for modeling as-is'
                            : s.skew != null && Math.abs(s.skew) < 1.0
                            ? 'ℹ️ Slightly uneven distribution — may need minor adjustment'
                            : s.skew != null
                            ? '⚠️ Heavily uneven distribution — transformation recommended before modeling'
                            : ''}
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        {/* Numeric detail panel */}
        {activeDescribeSection === 'numeric' && selectedNumericVar && (() => {
            const sv = numericStats.find(x => x.variable === selectedNumericVar)
            if (!sv) return null
            const hist = descResult?.histograms?.[selectedNumericVar]
            const bins = hist?.counts?.length ? hist.counts.map((c, i) => ({
              label: hist.bins?.[i]?.toFixed?.(1) ?? String(i),
              count: c
            })) : []
            const maxBin = Math.max(...bins.map(b => b.count), 1)
            const values = bins.flatMap((b, i) => Array.from({ length: b.count }, () => i))
            const meanVal = values.length ? values.reduce((a, v) => a + v, 0) / values.length : 0
            const sortedVals = [...values].sort((a, b) => a - b)
            const medianVal = sortedVals.length ? (() => { const m = Math.floor(sortedVals.length / 2); return sortedVals.length % 2 ? sortedVals[m] : (sortedVals[m - 1] + sortedVals[m]) / 2 })() : 0
            const meanIdx = Math.min(Math.floor(meanVal), bins.length - 1)
            const medIdx = Math.min(Math.floor(medianVal), bins.length - 1)

            const boxQ1 = sv.q1 ?? sortedVals[Math.floor(sortedVals.length * 0.25)] ?? 0
            const boxQ3 = sv.q3 ?? sortedVals[Math.floor(sortedVals.length * 0.75)] ?? 0
            const boxMedian = sv.median ?? medianVal
            const boxMin = sv.min ?? 0
            const boxMax = sv.max ?? 0
            const boxRange = boxMax - boxMin || 1

            return (
              <div {...explainAttrs({ id: `numeric-detail-${selectedNumericVar}`, title: `${selectedNumericVar} detail drawer`, type: 'numeric-detail', stat: sv }, '', false)} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '20px 18px', alignSelf: 'stretch', minWidth: 0, maxHeight: 560, overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', fontFamily: 'var(--font-mono, monospace)' }}>{selectedNumericVar}</div>
                    <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 1 }}>Distribution details</div>
                  </div>
                  <button type="button" onClick={() => setSelectedNumericVar(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9ca3af', padding: 2 }}><X size={14} /></button>
                </div>
                {/* Full histogram */}
                <div {...explainAttrs({ id: `numeric-detail-histogram-${selectedNumericVar}`, title: `${selectedNumericVar} distribution histogram`, type: 'numeric-detail-part', stat: sv })} style={{ height: 160, marginBottom: 14, position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 140, width: '100%' }}>
                    {bins.map((b, i) => (
                      <div key={i} style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                        <div style={{ width: '100%', height: `${(b.count / maxBin) * 100}%`, background: 'rgba(234, 88, 12, 0.5)', borderRadius: '2px 2px 0 0', minHeight: b.count > 0 ? 2 : 0 }} />
                        {i === meanIdx && (
                          <div style={{ position: 'absolute', bottom: `${(b.count / maxBin) * 100}%`, left: 0, right: 0, height: 0, borderTop: '2px dashed #dc2626', zIndex: 2 }} />
                        )}
                        {i === medIdx && (
                          <div style={{ position: 'absolute', bottom: `${(b.count / maxBin) * 100}%`, left: 0, right: 0, height: 0, borderTop: '2px dashed #7c3aed', zIndex: 2 }} />
                        )}
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 2, fontSize: 9, color: '#9ca3af' }}>
                    <span style={{ color: '#dc2626' }}>— Mean: {sv.mean != null ? sv.mean.toFixed(2) : meanVal.toFixed(2)}</span>
                    <span style={{ color: '#7c3aed' }}>— Median: {sv.median != null ? sv.median.toFixed(2) : medianVal.toFixed(2)}</span>
                  </div>
                </div>
                {/* Box plot */}
                <div {...explainAttrs({ id: `numeric-detail-boxplot-${selectedNumericVar}`, title: `${selectedNumericVar} box plot`, type: 'numeric-detail-part', stat: sv })} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Distribution</div>
                  <svg width="100%" height="80" viewBox="0 0 300 80" style={{ display: 'block', overflow: 'visible' }}>
                    <line x1="10" y1="55" x2="270" y2="55" stroke="#d1d5db" strokeWidth="1" />
                    <line x1={10 + ((boxMin - boxMin) / boxRange) * 260} y1="40" x2={10 + ((boxMin - boxMin) / boxRange) * 260} y2="70" stroke="#6b7280" strokeWidth="1.5" />
                    <line x1={10 + ((boxMax - boxMin) / boxRange) * 260} y1="40" x2={10 + ((boxMax - boxMin) / boxRange) * 260} y2="70" stroke="#6b7280" strokeWidth="1.5" />
                    <line x1={10 + ((boxMin - boxMin) / boxRange) * 260} y1="55" x2={10 + ((boxQ1 - boxMin) / boxRange) * 260} y2="55" stroke="#6b7280" strokeWidth="1" />
                    <line x1={10 + ((boxQ3 - boxMin) / boxRange) * 260} y1="55" x2={10 + ((boxMax - boxMin) / boxRange) * 260} y2="55" stroke="#6b7280" strokeWidth="1" />
                    <rect x={10 + ((boxQ1 - boxMin) / boxRange) * 260} y="35" width={((boxQ3 - boxQ1) / boxRange) * 260} height="40" fill="rgba(234, 88, 12, 0.15)" stroke="#ea580c" strokeWidth="1.5" rx="2" />
                    <line x1={10 + ((boxMedian - boxMin) / boxRange) * 260} y1="35" x2={10 + ((boxMedian - boxMin) / boxRange) * 260} y2="75" stroke="#ea580c" strokeWidth="2" />
                    <text x={10 + ((boxMin - boxMin) / boxRange) * 260} y="78" fontSize="8" fill="#6b7280" textAnchor="middle">Lowest</text>
                    <text x={10 + ((boxQ1 - boxMin) / boxRange) * 260} y="30" fontSize="8" fill="#6b7280" textAnchor="middle">Q1</text>
                    <text x={10 + ((boxMedian - boxMin) / boxRange) * 260} y="30" fontSize="8" fill="#ea580c" fontWeight="bold" textAnchor="middle">Median</text>
                    <text x={10 + ((boxQ3 - boxMin) / boxRange) * 260} y="30" fontSize="8" fill="#6b7280" textAnchor="middle">Q3</text>
                    <text x={10 + ((boxMax - boxMin) / boxRange) * 260} y="78" fontSize="8" fill="#6b7280" textAnchor="middle">Highest</text>
                  </svg>
                </div>
                {/* Stats table */}
                <div {...explainAttrs({ id: `numeric-detail-stats-${selectedNumericVar}`, title: `${selectedNumericVar} full statistics section`, type: 'numeric-detail-part', stat: sv })} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 16px', fontSize: 10, marginBottom: 14 }}>
                  {[
                    ['Mean', sv.mean != null ? sv.mean.toFixed(3) : '—'],
                    ['Median', sv.median != null ? sv.median.toFixed(3) : '—'],
                    ['SD', sv.std != null ? sv.std.toFixed(3) : '—'],
                    ['Min', sv.min != null ? sv.min.toFixed(2) : '—'],
                    ['Max', sv.max != null ? sv.max.toFixed(2) : '—'],
                    ['Q1', sv.q1 != null ? sv.q1.toFixed(2) : '—'],
                    ['Q3', sv.q3 != null ? sv.q3.toFixed(2) : '—'],
                    ['IQR', sv.q1 != null && sv.q3 != null ? (sv.q3 - sv.q1).toFixed(2) : '—'],
                    ['Skew', sv.skew != null ? sv.skew.toFixed(3) : '—'],
                    ['Kurtosis', sv.kurtosis != null ? sv.kurtosis.toFixed(3) : '—'],
                    ['Missing', sv.missing != null ? `${sv.missing}${sv.n ? ` (${(sv.missing / sv.n * 100).toFixed(1)}%)` : ''}` : '—'],
                  ].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px', background: '#f9fafb', borderRadius: 4 }}>
                      <span style={{ color: '#6b7280' }}>{label}</span>
                      <span style={{ fontWeight: 600, color: '#111827', fontFamily: 'var(--font-mono, monospace)' }}>{val}</span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => { setChartBuilderType('histogram'); setChartBuilderX(selectedNumericVar); jumpToDescribeSection('chart-builder') }}
                  style={{ width: '100%', padding: '7px 0', borderRadius: 8, border: `1.5px solid ${ORANGE_ACCENT}`, background: '#fff', color: ORANGE_ACCENT, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  View in Chart Builder →
                </button>
              </div>
            )
          })()}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 24, marginBottom: 20, alignItems: 'start' }}>
          {activeDescribeSection === 'categorical' && catStats.length > 0 && (
            <div {...explainAttrs({ id: 'categorical-variables-container', title: 'Categorical variables distribution container', type: 'categorical-container' }, '', false)} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '24px 24px 24px', height: 560, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <p style={{ fontSize: 11, fontWeight: 800, color: '#5b6573', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 20px' }}>Categorical Variables — Distribution</p>
              {activeCatStat && (() => {
                const vc = activeCatStat.value_counts || {}
                const entries = Object.entries(vc).sort(([, a], [, b]) => b - a)
                const total = activeCatStat.n || 1
                const maxCount = entries[0]?.[1] || 1
                const topPct = entries[0] ? (entries[0][1] / total * 100) : 0
                const nUnique = entries.length
                const topLabel = entries[0]?.[0] || ''
                const topShare = (entries[0]?.[1] || 0) / total
                return (
                  <div style={{ overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
                    {/* Tab pills */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                      {catStats.map(s => (
                        <button key={s.variable} type="button" {...explainAttrs({ id: `category-selector-${s.variable}`, title: `${s.variable} category selector chip`, type: 'category-selector', stat: s })} onClick={() => { setActiveCatVar(s.variable); setCatFilter('all') }}
                          style={{ padding: '7px 16px', borderRadius: 20, border: `1px solid ${activeCatVar === s.variable ? ORANGE_ACCENT : '#d1d5db'}`, background: '#fff', color: activeCatVar === s.variable ? ORANGE_ACCENT : '#1f2a44', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span>{s.variable.replace(/_/g, ' ')}</span>
                          {(() => {
                            const vcVals = Object.values(s.value_counts || {})
                            if (vcVals.length < 2) return null
                            const maxV = Math.max(...vcVals)
                            return (
                              <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 1, height: 14 }}>
                                {vcVals.slice(0, 8).map((v, i) => (
                                  <span key={i} style={{ width: 3, height: `${maxV ? (v / maxV) * 100 : 0}%`, background: activeCatVar === s.variable ? '#ea580c' : '#9ca3af', borderRadius: 1, minHeight: v > 0 ? 2 : 0, display: 'inline-block' }} />
                                ))}
                              </span>
                            )
                          })()}
                        </button>
                      ))}
                    </div>
                    {/* Metadata line */}
                    <p {...explainAttrs({ id: `valid-unique-summary-${activeCatStat.variable}`, title: `${activeCatStat.variable} valid and unique values summary`, type: 'valid-unique-summary', stat: activeCatStat })} style={{ fontSize: 12, color: '#667085', margin: '0 0 10px' }}>
                      <strong style={{ color: '#475467' }}>{activeCatStat.variable}</strong> · {activeCatStat.n} valid · {activeCatStat.unique} unique value{activeCatStat.unique !== 1 ? 's' : ''}
                    </p>
                    {/* Context-aware insight card */}
                    {(() => {
                      if (topShare > 0.8) {
                        const shareText = (topShare * 10).toFixed(0)
                        return (
                          <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, marginBottom: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>⚠️ HEAVILY IMBALANCED</div>
                            <p style={{ fontSize: 11, color: '#7f1d1d', margin: 0, lineHeight: 1.5, opacity: 0.85 }}>
                              Nearly {shareText} out of 10 rows are labeled '{topLabel}'. If you train a model on this, it will likely predict '{topLabel}' most of the time — even when it shouldn't.
                            </p>
                          </div>
                        )
                      } else if (topShare > 0.4 && topShare < 0.6) {
                        return (
                          <div style={{ padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, marginBottom: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#166534', marginBottom: 4 }}>✅ WELL BALANCED</div>
                            <p style={{ fontSize: 11, color: '#14532d', margin: 0, lineHeight: 1.5, opacity: 0.85 }}>
                              Classes are well balanced — no action needed for this variable.
                            </p>
                          </div>
                        )
                      } else if (nUnique > 10) {
                        return (
                          <div style={{ padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, marginBottom: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>ℹ️ HIGH CARDINALITY</div>
                            <p style={{ fontSize: 11, color: '#78350f', margin: 0, lineHeight: 1.5, opacity: 0.85 }}>
                              This variable has {nUnique} unique values — consider grouping rare categories or using embedding techniques before modeling.
                            </p>
                          </div>
                        )
                      }
                      return null
                    })()}
                    {/* Filter pills */}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                      {[{ key: 'all', label: 'All' }, { key: 'majority', label: 'Majority (>50%)' }, { key: 'minority', label: 'Minority (<20%)' }].map(f => (
                        <button key={f.key} type="button" {...explainAttrs({ id: `category-filter-${f.key}`, title: `${f.label} filter chip`, type: 'category-filter', filter: f.key })} onClick={() => setCatFilter(f.key)}
                          style={{ padding: '3px 10px', borderRadius: 999, border: `1px solid ${catFilter === f.key ? '#111827' : '#d1d5db'}`, background: catFilter === f.key ? '#111827' : '#fff', color: catFilter === f.key ? '#fff' : '#374151', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {f.label}
                        </button>
                      ))}
                    </div>
                    {/* Distribution bars with raw counts */}
                    <div {...explainAttrs({ id: `categorical-distribution-chart-${activeCatStat.variable}`, title: `${activeCatStat.variable} distribution chart`, type: 'category-chart', stat: activeCatStat }, '', false)} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                      {entries.map(([label, count], idx) => {
                        const pct = (count / total * 100).toFixed(1)
                        const matchesFilter = catFilter === 'all'
                          || (catFilter === 'majority' && pct > 50)
                          || (catFilter === 'minority' && pct < 20)
                        return (
                          <div key={label} {...explainAttrs({ id: `category-value-${activeCatStat.variable}-${label}`, title: `${label} category bar/value`, type: 'category-value', variable: activeCatStat.variable, label, count, pct })} style={{ display: 'grid', gridTemplateColumns: '16px 1fr 52px 44px 44px', alignItems: 'center', gap: 8, opacity: matchesFilter ? 1 : 0.2 }}>
                            <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textAlign: 'right' }}>#{idx + 1}</span>
                            <div style={{ overflow: 'hidden' }}>
                              <span style={{ fontSize: 12, color: '#334155', fontWeight: 600 }}>{label}</span>
                              <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 1 }}>{count.toLocaleString()} records</div>
                            </div>
                            <div style={{ height: 14, background: '#f1f2f4', borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{ width: `${(count / maxCount) * 100}%`, height: '100%', background: ORANGE_ACCENT, borderRadius: 4 }} />
                            </div>
                            <strong style={{ fontSize: 12, color: '#020617', textAlign: 'right' }}>{count.toLocaleString()}</strong>
                            <span style={{ fontSize: 11, color: '#6b7280', textAlign: 'right' }}>{pct}%</span>
                          </div>
                        )
                      })}
                    </div>
                    {/* ALL VALUES BY FREQUENCY section */}
                    <div {...explainAttrs({ id: `all-values-frequency-${activeCatStat.variable}`, title: 'All values by frequency section', type: 'frequency-section', stat: activeCatStat }, '', false)} style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>All Values by Frequency</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {entries.map(([label, count], idx) => {
                          const pct = (count / total * 100).toFixed(1)
                          return (
                            <div key={label} style={{ display: 'grid', gridTemplateColumns: '16px 1fr 52px 44px 44px', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textAlign: 'right' }}>#{idx + 1}</span>
                              <span style={{ fontSize: 11, color: '#374151', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                              <div style={{ height: 6, background: '#f1f2f4', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ width: `${(count / maxCount) * 100}%`, height: '100%', background: ORANGE_ACCENT, borderRadius: 3 }} />
                              </div>
                              <strong style={{ fontSize: 10, color: '#374151', textAlign: 'right', fontFamily: 'var(--font-mono, monospace)' }}>{count.toLocaleString()}</strong>
                              <span style={{ fontSize: 10, color: '#6b7280', textAlign: 'right' }}>{pct}%</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    {/* Cramér's V Associations */}
                    {cramersResult && activeCatStat && (() => {
                      const varName = activeCatStat.variable
                      const pairs = (cramersResult.pairs || []).filter(p => p.var_a === varName || p.var_b === varName)
                        .map(p => ({ other: p.var_a === varName ? p.var_b : p.var_a, v: p.v }))
                        .sort((a, b) => b.v - a.v)
                      if (pairs.length === 0) return null
                      return (
                        <div {...explainAttrs({ id: `categorical-associations-${varName}`, title: 'Associations with other variables section', type: 'associations-section', variable: varName }, '', false)} style={{ marginTop: 12, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Cramér's V Associations</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {pairs.map(({ other, v }) => (
                              <div key={other} {...explainAttrs({ id: `cramers-row-${varName}-${other}`, title: `${varName} and ${other} Cramer's V relationship row`, type: 'cramers-row', variable: varName, other, value: v })} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 50px 70px', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 11, color: '#374151', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono, monospace)' }}>{other}</span>
                                <div style={{ height: 6, background: '#f1f2f4', borderRadius: 3, overflow: 'hidden' }}>
                                  <div style={{ width: `${v * 100}%`, height: '100%', background: v > 0.5 ? '#ea580c' : v > 0.25 ? '#f59e0b' : '#9ca3af', borderRadius: 3 }} />
                                </div>
                                <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', textAlign: 'right', fontFamily: 'var(--font-mono, monospace)' }}>{v.toFixed(3)}</span>
                                <span style={{ fontSize: 10, color: v > 0.5 ? '#ea580c' : v > 0.25 ? '#b45309' : '#9ca3af', fontWeight: 500 }}>{v > 0.5 ? 'Strong' : v > 0.25 ? 'Moderate' : 'Weak'}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
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
          {...explainAttrs({ id: 'numeric-correlation-heatmap', title: 'Numeric correlation heatmap', type: 'correlation-heatmap' }, '', false)}
          style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 20, marginBottom: 20 }}
          onClick={() => { setSelectedCorrCell(null); setSelectedCramerCell(null) }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 55%) 1fr', gap: '16px 24px', alignItems: 'start' }}>

            {/* Row 1 left: title */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Correlation Heatmap — Numeric Pairs
                </p>
                <button
                  type="button"
                  {...explainAttrs({ id: 'save-heatmap-button', title: 'Save heatmap to report', type: 'chart-action' })}
                  onClick={handleSaveHeatmap}
                  onMouseEnter={e => { e.currentTarget.style.background = ORANGE_LIGHT; e.currentTarget.style.borderColor = ORANGE_ACCENT; e.currentTarget.style.color = ORANGE_ACCENT }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#374151' }}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid #d1d5db', borderRadius: 6, padding: '3px 8px', background: '#fff', cursor: 'pointer', fontSize: 10, fontWeight: 600, color: '#374151', transition: 'all 0.15s' }}
                >
                  <Save size={11} /> Save to report
                </button>
              </div>

              {/* Filter pills */}
              <div style={{ display: 'flex', gap: 4 }}>
                {[{ key: 'all', label: 'All' }, { key: 'strong', label: 'Strong (r > 0.7)' }, { key: 'moderate', label: 'Moderate (0.4\u20130.7)' }, { key: 'weak', label: 'Weak (< 0.4)' }].map(f => (
                  <button key={f.key} type="button" {...explainAttrs({ id: `corr-filter-${f.key}`, title: `${f.label} relationship strength filter`, type: 'correlation-filter', filter: f.key })} onClick={() => setCorrFilter(f.key)}
                    style={{ padding: '3px 8px', borderRadius: 999, border: `1px solid ${corrFilter === f.key ? '#111827' : '#d1d5db'}`, background: corrFilter === f.key ? '#111827' : '#fff', color: corrFilter === f.key ? '#fff' : '#374151', fontSize: 9, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 1 right: detail panel title */}
            <div onClick={e => e.stopPropagation()} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 }}>
              {!selectedCorrCell ? (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#111827', marginTop: 0, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Strongest relationships</p>
                  <p style={{ fontSize: 11, color: '#6b7280', marginTop: 0, marginBottom: 0 }}>Click any cell to explore a pair</p>
                </div>
              ) : (
                <>
                  <div>
                    {selectedCorrCell.row === selectedCorrCell.col ? (
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
                  <button
                    type="button"
                    {...explainAttrs({ id: 'save-detailed-chart-button', title: 'Save detailed chart to report', type: 'chart-action' })}
                    onClick={handleSaveDetailedChart}
                    onMouseEnter={e => { e.currentTarget.style.background = ORANGE_LIGHT; e.currentTarget.style.borderColor = ORANGE_ACCENT; e.currentTarget.style.color = ORANGE_ACCENT }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#374151' }}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid #d1d5db', borderRadius: 6, padding: '3px 8px', background: '#fff', cursor: 'pointer', fontSize: 10, fontWeight: 600, color: '#374151', transition: 'all 0.15s', flexShrink: 0 }}
                  >
                    <Save size={11} /> Save to report
                  </button>
                </>
              )}
            </div>

            {/* Row 2 left: heatmap table */}
            <div onClick={e => e.stopPropagation()}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'separate', borderSpacing: '4px', fontSize: 10, fontFamily: 'var(--font-mono)', minWidth: Math.max(320, corrResult.variables.length * 52) }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '4px 6px' }}></th>
                      {corrResult.variables.map((v) => (
                        <th key={v} title={v} style={{ padding: '4px 6px', color: '#6b7280', fontWeight: 600, fontSize: 9, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {corrResult.variables.map((r) => (
                      <tr key={r}>
                        <td title={r} style={{ padding: '4px 6px', fontWeight: 600, fontSize: 9, color: '#4b5563', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</td>
                        {corrResult.variables.map((c) => {
                          const val = Number(corrResult.matrix?.[r]?.[c] ?? 0)
                          const abs = Math.abs(val)
                          const isSelf = r === c
                          const isSelected = selectedCorrCell?.row === r && selectedCorrCell?.col === c
                          const matchesFilter = corrFilter === 'all'
                            || (corrFilter === 'strong' && abs > 0.7)
                            || (corrFilter === 'moderate' && abs > 0.4 && abs <= 0.7)
                            || (corrFilter === 'weak' && abs <= 0.4)
                          const bg = isSelf ? ORANGE_ACCENT : getCorrelationColor(val)
                          const textColor = isSelf || abs > 0.5 ? '#fff' : '#111827'
                          return (
                            <td
                              key={c}
                              {...explainAttrs({ id: `corr-cell-${r}-${c}`, title: `${r} and ${c} numeric correlation cell`, type: 'correlation-cell', row: r, col: c, value: val })}
                              onClick={() => setSelectedCorrCell(isSelected ? null : { row: r, col: c })}
                              style={{
                                padding: '5px 6px',
                                textAlign: 'center',
                                backgroundColor: bg,
                                color: textColor,
                                borderRadius: 6,
                                fontWeight: 700,
                                cursor: 'pointer',
                                opacity: isSelf ? 1 : (matchesFilter ? 1 : 0.2),
                                boxShadow: isSelected ? '0 0 0 2px #fff, 0 0 0 4px #374151' : 'none',
                                transition: 'opacity 0.15s, box-shadow 0.15s'
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
              {/* Ranked correlation list */}
              <div {...explainAttrs({ id: 'strongest-relationships-panel', title: 'Strongest relationships panel', type: 'relationship-panel' }, '', false)} style={{ marginTop: 12 }}>
                {getTopCorrelations(corrResult, 999)
                  .filter(({ val }) => {
                    const abs = Math.abs(val)
                    return corrFilter === 'all'
                      || (corrFilter === 'strong' && abs > 0.7)
                      || (corrFilter === 'moderate' && abs > 0.4 && abs <= 0.7)
                      || (corrFilter === 'weak' && abs <= 0.4)
                  })
                  .map(({ a, b, val }) => {
                  const absR = Math.abs(val)
                  const barColor = val > 0 ? '#ea580c' : '#0284c7'
                  const isSelected = selectedCorrCell?.row === a && selectedCorrCell?.col === b
                  return (
                    <div
                      key={`${a}-${b}`}
                      {...explainAttrs({ id: `numeric-relationship-${a}-${b}`, title: `${a} and ${b} numeric relationship row`, type: 'relationship-row', a, b, value: val })}
                      onClick={() => setSelectedCorrCell({ row: a, col: b })}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', cursor: 'pointer', borderRadius: 6, background: isSelected ? '#fff7ed' : 'transparent' }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f9fafb' }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono, monospace)', color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 1 auto' }}>{a} ↔ {b}</span>
                      <div style={{ flex: 1, height: 4, background: '#e5e7eb', borderRadius: 2, minWidth: 30, position: 'relative' }}>
                        <div style={{ width: `${absR * 100}%`, height: '100%', background: barColor, borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: barColor, whiteSpace: 'nowrap' }}>{val >= 0 ? '+' : ''}{val.toFixed(3)}</span>
                      <span style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap' }}>{getCorrelationLabel(val)}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Row 2 right: detail panel body */}
            <div style={{ paddingTop: 12, minWidth: 0 }} onClick={e => e.stopPropagation()}>
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
                  const meanVal = values.reduce((a, b) => a + b, 0) / values.length
                  const medianVal = (() => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2 })()
                  const histPlugin = {
                    id: 'meanMedianLines',
                    afterDraw(chart) {
                      const ctx = chart.ctx
                      const xScale = chart.scales.x
                      const yScale = chart.scales.y
                      const meanBinIdx = Math.min(Math.floor((meanVal - minV) / binWidth), binCount - 1)
                      const medBinIdx = Math.min(Math.floor((medianVal - minV) / binWidth), binCount - 1)
                      const meanX = xScale.getPixelForValue(meanBinIdx)
                      if (meanX >= xScale.left && meanX <= xScale.right) {
                        ctx.save(); ctx.setLineDash([6, 3]); ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 1.5
                        ctx.beginPath(); ctx.moveTo(meanX, yScale.top); ctx.lineTo(meanX, yScale.bottom); ctx.stroke()
                        ctx.fillStyle = '#dc2626'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'
                        ctx.fillText(`Mean: ${meanVal.toFixed(1)}`, meanX, yScale.top - 4); ctx.restore()
                      }
                      const medX = xScale.getPixelForValue(medBinIdx)
                      if (medX >= xScale.left && medX <= xScale.right) {
                        ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 1.5
                        ctx.beginPath(); ctx.moveTo(medX, yScale.top); ctx.lineTo(medX, yScale.bottom); ctx.stroke()
                        ctx.fillStyle = '#7c3aed'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'
                        ctx.fillText(`Median: ${medianVal.toFixed(1)}`, medX, yScale.top - 14); ctx.restore()
                      }
                    }
                  }
                  return (
                    <div>
                      <div {...explainAttrs({ id: `detailed-correlation-histogram-${row}`, title: `${row} distribution detailed histogram`, type: 'correlation-detailed-histogram' })} style={{ height: 220, position: 'relative', width: '100%' }}>
                        <Bar data={histData} options={histOptions} plugins={[histPlugin]} />
                      </div>
                      <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
                        <span style={{ fontSize: 10, color: '#dc2626' }}>--- Mean: {meanVal.toFixed(2)}</span>
                        <span style={{ fontSize: 10, color: '#7c3aed' }}>--- Median: {medianVal.toFixed(2)}</span>
                      </div>
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
                const absVal = Math.abs(val)
                const insight = absVal > 0.85
                  ? { icon: '⚠️', title: 'Multicollinearity Warning', desc: `r = ${val.toFixed(3)} — these variables are near-redundant. Consider dropping the weaker predictor to avoid inflated variance.`, bg: '#fef2f2', border: '#fecaca', color: '#991b1b' }
                  : absVal > 0.5
                  ? { icon: 'ℹ️', title: 'Moderate Correlation', desc: `r = ${val.toFixed(3)} — safe to keep both variables, but monitor VIF during regression.`, bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af' }
                  : { icon: '✅', title: 'Independent Variables', desc: `r = ${val.toFixed(3)} — these variables are largely independent. Safe to include both in your model.`, bg: '#f0fdf4', border: '#bbf7d0', color: '#166534' }
                return (
                  <div>
                    <div {...explainAttrs({ id: `detailed-correlation-scatter-${row}-${col}`, title: `${row} vs ${col} detailed correlation scatter plot`, type: 'correlation-detailed-scatter' })} style={{ height: 200, position: 'relative', width: '100%' }}>
                      <Chart type='scatter' data={{ datasets: scatterDatasets }} options={scatterOptions} />
                    </div>
                    <div style={{ background: insight.bg, border: `1px solid ${insight.border}`, borderRadius: 10, padding: '10px 12px', marginTop: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 14 }}>{insight.icon}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: insight.color }}>{insight.title}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, background: insight.color + '18', color: insight.color, borderRadius: 20, padding: '2px 8px' }}>|r| = {absVal.toFixed(3)}</span>
                      </div>
                      <p style={{ fontSize: 11, color: insight.color, margin: 0, lineHeight: 1.5, opacity: 0.85 }}>{insight.desc}</p>
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

      {/* ──── CRAMÉR'S V HEATMAP ──── */}
      {activeDescribeSection === 'correlations' && cramersResult && cramersResult.variables?.length >= 2 && (
        <div {...explainAttrs({ id: 'categorical-associations-heatmap', title: 'Categorical associations heatmap', type: 'categorical-heatmap' }, '', false)} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 55%) 1fr', gap: '16px 24px', alignItems: 'start' }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Categorical Associations — Cramér's V
              </p>
              <p style={{ fontSize: 10, color: '#9ca3af', margin: 0 }}>Strength between categorical column pairs</p>
            </div>
            <div onClick={e => e.stopPropagation()}>
              {!selectedCramerCell ? (
                <>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#111827', marginTop: 0, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Strongest associations</p>
                  <p style={{ fontSize: 11, color: '#6b7280', marginTop: 0, marginBottom: 0 }}>Click any cell to explore</p>
                </>
              ) : selectedCramerCell.row === selectedCramerCell.col ? (
                <p style={{ fontSize: 11, fontWeight: 700, color: '#111827', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{selectedCramerCell.row}</p>
              ) : (
                <p style={{ fontSize: 11, fontWeight: 700, color: '#111827', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-mono)' }}>
                  {selectedCramerCell.row} <span style={{ color: '#9ca3af' }}>←→</span> {selectedCramerCell.col}
                </p>
              )}
            </div>
            {/* Left: heatmap */}
            <div onClick={e => e.stopPropagation()}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'separate', borderSpacing: '4px', fontSize: 10, fontFamily: 'var(--font-mono)', minWidth: Math.max(300, cramersResult.variables.length * 52) }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '4px 6px' }}></th>
                      {cramersResult.variables.map((v) => (
                        <th key={v} title={v} style={{ padding: '4px 6px', color: '#6b7280', fontWeight: 600, fontSize: 9, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cramersResult.variables.map((r) => (
                      <tr key={r}>
                        <td title={r} style={{ padding: '4px 6px', fontWeight: 600, fontSize: 9, color: '#4b5563', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</td>
                        {cramersResult.variables.map((c) => {
                          const v = Number(cramersResult.matrix?.[r]?.[c] ?? 0)
                          const isSelf = r === c
                          const isSelected = selectedCramerCell?.row === r && selectedCramerCell?.col === c
                          let bg = '#faf7f2'
                          let tc = '#111827'
                          if (v > 0.5) { bg = 'rgba(234, 88, 12, 0.7)'; tc = '#fff' }
                          else if (v > 0.25) { bg = 'rgba(245, 158, 11, 0.5)'; tc = '#111827' }
                          else if (v > 0.1) { bg = 'rgba(156, 163, 175, 0.3)'; tc = '#111827' }
                          return (
                            <td key={c}
                              {...explainAttrs({ id: `cramers-cell-${r}-${c}`, title: `${r} and ${c} categorical association cell`, type: 'cramers-cell', row: r, col: c, value: v })}
                              onClick={() => setSelectedCramerCell(isSelected ? null : { row: r, col: c })}
                              style={{ padding: '5px 6px', textAlign: 'center', backgroundColor: bg, color: tc, borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 10, boxShadow: isSelected ? '0 0 0 2px #fff, 0 0 0 4px #374151' : 'none', transition: 'box-shadow 0.15s' }}
                            >{v.toFixed(3)}</td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Ranked Cramér's V list */}
              {(() => {
                const pairs = []
                const vars = cramersResult.variables
                for (let i = 0; i < vars.length; i++) {
                  for (let j = i + 1; j < vars.length; j++) {
                    const v = Number(cramersResult.matrix?.[vars[i]]?.[vars[j]] ?? 0)
                    pairs.push({ a: vars[i], b: vars[j], v })
                  }
                }
                pairs.sort((x, y) => y.v - x.v)
                return (
                  <div {...explainAttrs({ id: 'categorical-relationships-panel', title: 'Categorical relationships panel', type: 'categorical-relationships-panel' }, '', false)} style={{ maxHeight: 160, overflowY: 'auto', marginTop: 10 }}>
                    {pairs.map(p => {
                      const isSelected = selectedCramerCell?.row === p.a && selectedCramerCell?.col === p.b
                      return (
                        <div key={`${p.a}-${p.b}`}
                          {...explainAttrs({ id: `categorical-relationship-${p.a}-${p.b}`, title: `${p.a} and ${p.b} categorical relationship row`, type: 'categorical-relationship-row', a: p.a, b: p.b, value: p.v })}
                          onClick={() => setSelectedCramerCell({ row: p.a, col: p.b })}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 6px', cursor: 'pointer', borderRadius: 6, background: isSelected ? '#fff7ed' : 'transparent', fontSize: 10 }}
                          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f9fafb' }}
                          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                        >
                          <span style={{ fontWeight: 600, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{p.a} ↔ {p.b}</span>
                          <div style={{ width: 50, height: 3, background: '#e5e7eb', borderRadius: 2 }}>
                            <div style={{ width: `${p.v * 100}%`, height: '100%', background: p.v > 0.5 ? '#ea580c' : p.v > 0.25 ? '#f59e0b' : '#9ca3af', borderRadius: 2 }} />
                          </div>
                          <span style={{ fontWeight: 700, color: '#374151', fontFamily: 'var(--font-mono)' }}>{p.v.toFixed(3)}</span>
                          <span style={{ color: p.v > 0.5 ? '#ea580c' : p.v > 0.25 ? '#b45309' : '#9ca3af', fontWeight: 500 }}>{p.v > 0.5 ? 'Strong' : p.v > 0.25 ? 'Moderate' : 'Weak'}</span>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
            {/* Right: detail panel */}
            <div style={{ paddingTop: 0, minWidth: 0 }} onClick={e => e.stopPropagation()}>
              {!selectedCramerCell ? (
                <div style={{ fontSize: 11, color: '#9ca3af' }}>Click a cell to view grouped bar chart</div>
              ) : selectedCramerCell.row === selectedCramerCell.col ? (
                <div style={{ fontSize: 11, color: '#9ca3af' }}>Self-association (V = 1.000)</div>
              ) : (() => {
                const { row, col } = selectedCramerCell
                const crossTab = {}
                datasetRows.forEach(dr => {
                  const rv = String(dr[row] ?? ''); const cv = String(dr[col] ?? '')
                  if (!rv || !cv) return
                  if (!crossTab[rv]) crossTab[rv] = {}
                  crossTab[rv][cv] = (crossTab[rv][cv] || 0) + 1
                })
                // X-axis = values of `col` (the one listed second in the pair title)
                // Color split = values of `row`
                const colKeys = [...new Set(Object.values(crossTab).flatMap(Object.keys))].slice(0, 10)
                const rowKeys = Object.keys(crossTab).slice(0, 10)
                const maxCross = Math.max(...colKeys.flatMap(ck => rowKeys.map(rk => crossTab[rk]?.[ck] || 0)), 1)
                const ROW_COLORS = ['#f59e0b', '#fdba74']
                const v = Number(cramersResult.matrix?.[row]?.[col] ?? 0)
                const strengthLabel = v > 0.5 ? 'Strong association' : v > 0.25 ? 'Moderate association' : 'Weak association'
                return (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>
                      Grouped counts: {row} by {col}
                    </div>
                    <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 8 }}>
                      Cramér's V: {v.toFixed(3)} · {strengthLabel}
                    </div>
                    {/* Grouped bar chart: x-axis = col values, grouped by row values */}
                    <div {...explainAttrs({ id: `detailed-cramers-grouped-bar-${row}-${col}`, title: `${row} by ${col} grouped counts chart`, type: 'cramers-detailed-grouped-bar' })} style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 140, paddingBottom: 4, borderBottom: '1px solid #e5e7eb' }}>
                      {colKeys.map(ck => {
                        return (
                          <div key={ck} style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2, height: '100%' }}>
                            {rowKeys.map((rk, idx) => {
                              const cnt = crossTab[rk]?.[ck] || 0
                              return (
                                <div key={rk} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                                  <div style={{ position: 'relative', width: '100%', height: `${(cnt / maxCross) * 100}%`, minHeight: cnt > 0 ? 2 : 0 }}>
                                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '100%', background: ROW_COLORS[idx % ROW_COLORS.length], borderRadius: '2px 2px 0 0' }} title={`${ck} / ${rk}: ${cnt}`} />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                    {/* X-axis labels */}
                    <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                      {colKeys.map(ck => (
                        <div key={ck} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: '#374151', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ck}
                        </div>
                      ))}
                    </div>
                    {/* Legend */}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 8 }}>
                      {rowKeys.map((rk, idx) => (
                        <div key={rk} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div style={{ width: 10, height: 10, background: ROW_COLORS[idx % ROW_COLORS.length], borderRadius: 2 }} />
                          <span style={{ fontSize: 9, color: '#374151', fontWeight: 500 }}>{rk}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Interactive Chart Builder */}
      {activeDescribeSection === 'chart-builder' && descResult && <div id="describe-chart-builder" {...explainAttrs({ id: 'chart-builder-container', title: 'Chart Builder', type: 'chart-builder' }, '', false)} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, overflow: 'hidden', marginBottom: 20, height: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column' }}>

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
            <button type="button" {...explainAttrs({ id: 'save-chart-button', title: 'Save chart button', type: 'chart-action' })} onClick={handleSaveChart}
              onMouseEnter={e => { e.currentTarget.style.background = ORANGE_LIGHT; e.currentTarget.style.borderColor = ORANGE_ACCENT; e.currentTarget.style.color = ORANGE_ACCENT }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#374151' }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 12px', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#374151' }}>
              <Bookmark size={13} /> Save chart
            </button>
            <button type="button" {...explainAttrs({ id: 'copy-chart-button', title: 'Copy chart button', type: 'chart-action' })} onClick={handleDuplicateChart} title="Duplicate chart"
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#9ca3af'; e.currentTarget.style.color = '#374151' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#6b7280' }}
              style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 8px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#6b7280' }}>
              <Copy size={15} />
            </button>
            <button type="button" {...explainAttrs({ id: 'download-chart-button', title: 'Download chart button', type: 'chart-action' })} onClick={handleDownloadChart} title="Download as PNG"
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#9ca3af'; e.currentTarget.style.color = '#374151' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#6b7280' }}
              style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 8px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#6b7280' }}>
              <Download size={15} />
            </button>
            <button type="button" {...explainAttrs({ id: 'expand-chart-button', title: 'Expand chart button', type: 'chart-action' })} onClick={() => setExpandChart(true)} title="Fullscreen"
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
                          <span style={{ fontSize: 10, background: ORANGE_LIGHT, color: ORANGE_ACCENT, borderRadius: 10, padding: '1px 7px', fontWeight: 700 }}>{Array.isArray(sc.layers) && sc.layers.length > 1 ? 'Mixed' : chartTypeLabel(sc.type)}</span>
                          <button type="button" onClick={() => setCompareSelected(prev => prev.filter(x => x !== id))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', padding: 0 }}><X size={13} /></button>
                        </div>
                      </div>
                      <div style={{ height: 240, padding: 10, position: 'relative' }}>{renderCompareChart(sc)}</div>
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
                <p style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Base Chart Type</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {CB_CHART_TYPES.map(t => (
                    <button key={t.key} type="button"
                      {...explainAttrs({ id: `chart-type-${t.key}`, title: `${t.label} chart type button`, type: 'chart-type', chartType: t.key })}
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
                  <div {...explainAttrs({ id: 'field-x-axis', title: 'X Axis field dropdown', type: 'field-dropdown' }, '', false)}>
                    <label style={{ display: 'block', fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>X Axis *</label>
                    <select {...explainAttrs({ id: 'x-axis-dropdown', title: 'X Axis dropdown', type: 'field-dropdown' })} value={chartBuilderX} onChange={e => setChartBuilderX(e.target.value)}
                      style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '6px 8px', background: '#fff', fontSize: 12, outline: 'none' }}>
                      <option value="">— select —</option>
                      {(dataset.variables || []).map(v => <option key={v.name} value={v.name}>{v.name} ({v.dtype})</option>)}
                    </select>
                  </div>
                  {chartBuilderType !== 'histogram' && (
                    <div {...explainAttrs({ id: 'field-y-axis', title: 'Y Axis field dropdown', type: 'field-dropdown' }, '', false)}>
                      <label style={{ display: 'block', fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>Y Axis *</label>
                      <select {...explainAttrs({ id: 'y-axis-dropdown', title: 'Y Axis dropdown', type: 'field-dropdown' })} value={chartBuilderY} onChange={e => setChartBuilderY(e.target.value)}
                        style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '6px 8px', background: '#fff', fontSize: 12, outline: 'none' }}>
                        <option value="">— select —</option>
                        {(dataset.variables || []).filter(v => ['numeric', 'int', 'float'].includes(v.dtype)).map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div {...explainAttrs({ id: 'field-color-by', title: 'Color by field dropdown', type: 'field-dropdown' }, '', false)}>
                    <label style={{ display: 'block', fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>Color by (optional)</label>
                    <select {...explainAttrs({ id: 'color-by-dropdown', title: 'Color by dropdown', type: 'field-dropdown' })} value={chartBuilderGroupBy} onChange={e => setChartBuilderGroupBy(e.target.value)}
                      style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '6px 8px', background: '#fff', fontSize: 12, outline: 'none' }}>
                      <option value="">— none —</option>
                      {(dataset.variables || []).filter(v => !['numeric', 'int', 'float'].includes(v.dtype)).map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Layers */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Layers</p>
                  <button
                    type="button"
                    disabled={!canLayerChart}
                    onClick={() => {
                      if (!canLayerChart) return
                      setChartLayersEnabled((value) => !value)
                      setActiveChartId(null)
                    }}
                    title={canLayerChart ? 'Toggle layered chart mode' : `${chartTypeLabel(chartBuilderType)} charts cannot use layers`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      border: `1px solid ${chartLayersEnabled && canLayerChart ? ORANGE_ACCENT : '#d1d5db'}`,
                      borderRadius: 999,
                      background: chartLayersEnabled && canLayerChart ? ORANGE_LIGHT : '#fff',
                      color: chartLayersEnabled && canLayerChart ? ORANGE_ACCENT : canLayerChart ? '#6b7280' : '#b6aea5',
                      padding: '4px 9px',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: canLayerChart ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <span>Use layers</span>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: chartLayersEnabled && canLayerChart ? ORANGE_ACCENT : '#d1d5db',
                      }}
                    />
                  </button>
                </div>
                {canLayerChart && chartLayersEnabled ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {effectiveLayers.map((layer, index) => (
                      <div
                        key={layer.id || index}
                        style={{
                          border: `1px solid ${index === 0 ? '#fdba74' : '#e5e7eb'}`,
                          background: index === 0 ? '#fff7ed' : '#fafaf9',
                          borderRadius: 10,
                          padding: 10,
                          display: 'grid',
                          gap: 8
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 9, height: 9, borderRadius: 999, background: layer.color || CB_COLORS[index % CB_COLORS.length], flexShrink: 0 }} />
                          <strong style={{ fontSize: 12, color: '#1f2937', flex: 1 }}>Layer {index + 1}</strong>
                          <select
                            value={layer.type}
                            onChange={e => updateChartLayer(index, { type: e.target.value })}
                            style={{ border: '1px solid #d6c9bd', borderRadius: 8, padding: '6px 28px 6px 9px', background: '#fff', fontSize: 11, outline: 'none', color: '#1f2937', fontWeight: 600, minWidth: 86 }}
                          >
                            {CB_LAYER_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                          </select>
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => removeChartLayer(index)}
                            title={index === 0 ? 'Layer 1 cannot be deleted' : 'Remove layer'}
                            style={{ border: '1px solid #e5e7eb', borderRadius: 7, background: '#fff', color: index === 0 ? '#d1d5db' : '#6b7280', width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: index === 0 ? 'not-allowed' : 'pointer' }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 112px', gap: 8 }}>
                          <div>
                            <label style={{ display: 'block', fontSize: 10, color: '#78716c', marginBottom: 3, fontWeight: 700 }}>Y axis</label>
                            <select
                              value={layer.y}
                              onChange={e => updateChartLayer(index, { y: e.target.value })}
                              style={{ width: '100%', border: '1px solid #d6c9bd', borderRadius: 8, padding: '8px 28px 8px 10px', background: '#fff', fontSize: 12, outline: 'none', color: '#111827' }}
                            >
                              <option value="">select</option>
                              {(dataset.variables || []).filter(v => ['numeric', 'int', 'float'].includes(v.dtype)).map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                            </select>
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: 10, color: '#78716c', marginBottom: 3, fontWeight: 700 }}>Color</label>
                            <label
                              style={{
                                width: '100%',
                                height: 36,
                                border: '1px solid #d6c9bd',
                                borderRadius: 8,
                                background: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 7,
                                padding: '5px 8px',
                                cursor: 'pointer',
                                boxSizing: 'border-box',
                              }}
                            >
                              <span
                                style={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: 999,
                                  background: normalizeHexColor(layer.color, CB_COLORS[index % CB_COLORS.length]),
                                  border: '1px solid rgba(0,0,0,.12)',
                                  flexShrink: 0,
                                }}
                              />
                              <span style={{ fontSize: 11, color: '#374151', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {normalizeHexColor(layer.color, CB_COLORS[index % CB_COLORS.length])}
                              </span>
                              <input
                                aria-label={`Layer ${index + 1} color`}
                                type="color"
                                value={normalizeHexColor(layer.color, CB_COLORS[index % CB_COLORS.length])}
                                onChange={e => updateChartLayer(index, { color: e.target.value })}
                                style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }}
                              />
                            </label>
                          </div>
                        </div>
                        <div style={{ fontSize: 10, color: '#78716c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          X: {index === 0 ? (layer.x || 'select X axis above') : `${effectiveLayers[0]?.x || 'locked to Layer 1'} (locked)`}
                        </div>
                      </div>
                    ))}
                    {effectiveLayers.length < 3 && (
                      <button
                        type="button"
                        onClick={addChartLayer}
                        style={{ border: '1px dashed #fdba74', borderRadius: 10, background: '#fff', color: '#c2410c', padding: '8px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
                      >
                        + Add layer
                      </button>
                    )}
                  </div>
                ) : canLayerChart ? (
                  <div style={{ border: '1px dashed #e7d8c8', background: '#fffdfa', borderRadius: 10, padding: 10, fontSize: 11, lineHeight: 1.45, color: '#78716c' }}>
                    Turn on layers to combine Bar, Line, or Scatter on one shared X axis.
                  </div>
                ) : (
                  <div style={{ border: '1px solid #fed7aa', background: '#fff7ed', borderRadius: 10, padding: 10, fontSize: 11, lineHeight: 1.45, color: '#9a3412' }}>
                    {chartTypeLabel(chartBuilderType)} charts cannot be combined. Use Bar, Line, or Scatter to add layers.
                  </div>
                )}
              </div>

              {/* Aggregation */}
              {chartBuilderType !== 'scatter' && chartBuilderType !== 'bubble' && chartBuilderType !== 'histogram' && (
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Aggregation</p>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {['Count', 'Mean', 'Sum', 'Max'].map(agg => (
                      <button key={agg} type="button" {...explainAttrs({ id: `aggregation-${agg}`, title: `${agg} aggregation button`, type: 'aggregation', aggregation: agg })} onClick={() => setChartBuilderAgg(agg)}
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
                      <button key={s.key} type="button" {...explainAttrs({ id: `sort-${s.key}`, title: `${s.label} sort button`, type: 'sort', sort: s.key })} onClick={() => setCbSortOrder(s.key)}
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
            <div {...explainAttrs({ id: 'chart-preview-area', title: 'Chart preview area', type: 'chart-preview' }, '', false)} style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
                    {isMixedChart ? mixedSubtitle : chartBuilderX && (chartBuilderType === 'histogram' || chartBuilderY) ? `${chartBuilderX}${chartBuilderY ? ` vs ${chartBuilderY}` : ''} - ${chartBuilderAgg}` : 'Configure fields to preview'}
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: ORANGE_LIGHT, color: ORANGE_ACCENT, borderRadius: 12, padding: '2px 10px', border: `1px solid #fed7aa`, flexShrink: 0 }}>
                  {cbTypeLabel}
                </span>
              </div>
              <div style={{ display: 'none' }}>
                <span style={{ fontSize: 12, color: '#6b7280' }}>
                  {isMixedChart ? mixedSubtitle : chartBuilderX && (chartBuilderType === 'histogram' || chartBuilderY) ? `${chartBuilderX}${chartBuilderY ? ` vs ${chartBuilderY}` : ''} — ${chartBuilderAgg}` : 'Configure fields to preview'}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: ORANGE_LIGHT, color: ORANGE_ACCENT, borderRadius: 12, padding: '2px 10px', border: `1px solid #fed7aa`, flexShrink: 0 }}>
                  {cbTypeLabel}
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
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
                {...explainAttrs({ id: 'chart-note-textarea', title: 'Chart note text area', type: 'chart-note' })}
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


        {/* Expand/fullscreen modal */}
        {expandChart && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setExpandChart(false)}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '90vw', height: '82vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{chartTitle}</span>
                <button type="button" onClick={() => setExpandChart(false)} style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '5px 8px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#6b7280' }}><Minimize2 size={15} /></button>
              </div>
              <div style={{ flex: 1, position: 'relative' }}>{renderLiveChart()}</div>
            </div>
          </div>
        )}
      </div>}

      {/* Toast */}
      {cbToast && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', color: '#fff', borderRadius: 20, padding: '8px 18px', fontSize: 12, fontWeight: 500, zIndex: 9999, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {cbToast}
        </div>
      )}

      {explainPopup && (
        <DescribeExplainPopup
          datasetId={dataset.id}
          element={explainPopup}
          onClose={() => setExplainPopup(null)}
        />
      )}
        </div>
      </main>
    </div>
  )
}

function DescribeExplainPopup({ datasetId, element, onClose }) {
  const [aiText, setAiText] = useState(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('normal')
  const [followUpInput, setFollowUpInput] = useState('')
  const [followUpLoading, setFollowUpLoading] = useState(false)
  const [position, setPosition] = useState(() => getDescribeExplainPosition(getLiveExplainRect(element)))

  useEffect(() => {
    const updatePosition = () => setPosition(getDescribeExplainPosition(getLiveExplainRect(element)))
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [element?.id, element?.sourceEl, element?.sourceRect])

  const fetchAI = async (variant = 'normal') => {
    if (!datasetId || !element) return
    setLoading(true)
    try {
      const question = variant === 'simple'
        ? `Explain this Describe page section in simpler student-friendly terms: ${element.title}.`
        : variant === 'technical'
          ? `Give a concise technical explanation for this Describe page section: ${element.title}. Include why it matters for data analysis or modeling.`
          : `Explain this Describe page section in plain language for a SimuCast student: ${element.title}. Include what it means, what the current dataset suggests, why it matters, and a recommendation.`
      const payload = {
        title: element.title,
        type: element.type,
        values: element.values,
        fallback: {
          dataset: element.datasetExplanation,
          why: element.whyItMatters,
          verdict: element.verdict,
        },
      }
      const response = await api.aiExplain(datasetId, `describe-${element.id}-${variant}`, payload, question, { element: payload })
      setAiText(cleanDescribeExplainText(response?.explanation, element.datasetExplanation))
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
        values: element.values,
        previousExplanation: aiText || element.datasetExplanation,
      }
      const response = await api.aiExplain(datasetId, `describe-${element.id}-followup`, payload, followUpInput, { element: payload })
      setAiText(cleanDescribeExplainText(response?.explanation, element.datasetExplanation))
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
      className={`ax-expand-explain-popup ax-explain-placement-${position.placement}`}
      style={{ top: position.top, left: position.left, '--explain-popup-max-height': `${position.maxHeight}px` }}
      role="dialog"
      aria-modal="true"
      aria-label={`${element.title} explanation`}
    >
      <span
        className="ax-expand-explain-arrow"
        style={{ top: position.arrowTop, left: position.arrowLeft }}
        aria-hidden="true"
      />
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
          <span>In your dataset</span>
          {loading ? <InlineSpinner label="Generating explanation..." /> : <p>{aiText || element.datasetExplanation}</p>}
        </section>
        <section>
          <span>Why it matters</span>
          <p>{element.whyItMatters}</p>
        </section>
        <section>
          <span>Verdict / recommendation</span>
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

function getDescribeExplainPosition(sourceRect) {
  const popupW = 374
  const gap = 8
  const padding = 12
  const viewportW = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportH = typeof window === 'undefined' ? 720 : window.innerHeight
  const popupH = Math.max(280, Math.min(560, viewportH - (padding * 2)))
  const anchor = normalizeExplainRect(sourceRect)
  if (!anchor) {
    return { top: 84, left: padding, placement: 'right-start', arrowTop: 24, arrowLeft: -6, maxHeight: popupH }
  }

  const placements = anchor.bottom > viewportH * 0.68
    ? ['top-start', 'right-start', 'left-start', 'bottom-start']
    : ['right-start', 'left-start', 'bottom-start', 'top-start']
  for (const placement of placements) {
    const candidate = buildExplainCandidate(placement, anchor, popupW, popupH, gap, padding, viewportW, viewportH)
    if (!rectsOverlap(candidate.rect, anchor)) return candidate
  }

  const rightSpace = viewportW - anchor.right - gap - padding
  const leftSpace = anchor.left - gap - padding
  const fallbackPlacement = rightSpace >= leftSpace ? 'right-start' : 'left-start'
  return buildExplainCandidate(fallbackPlacement, anchor, popupW, popupH, gap, padding, viewportW, viewportH)
}

function buildExplainCandidate(placement, anchor, popupW, popupH, gap, padding, viewportW, viewportH) {
  let left = anchor.right + gap
  let top = anchor.top
  if (placement === 'left-start') {
    left = anchor.left - popupW - gap
    top = anchor.top
  } else if (placement === 'bottom-start') {
    left = anchor.left
    top = anchor.bottom + gap
  } else if (placement === 'top-start') {
    left = anchor.left
    top = anchor.top - popupH - gap
  }

  left = clamp(left, padding, Math.max(padding, viewportW - popupW - padding))
  top = clamp(top, padding, Math.max(padding, viewportH - popupH - padding))

  const rect = { left, top, right: left + popupW, bottom: top + popupH }
  const arrow = getExplainArrowPosition(placement, anchor, rect, popupW, popupH)
  return { top, left, placement, rect, maxHeight: popupH, ...arrow }
}

function getLiveExplainRect(element) {
  if (element?.sourceEl?.isConnected && typeof element.sourceEl.getBoundingClientRect === 'function') {
    return element.sourceEl.getBoundingClientRect()
  }
  return element?.sourceRect || null
}

function getExplainArrowPosition(placement, anchor, popup, popupW, popupH) {
  if (placement === 'right-start' || placement === 'left-start') {
    return {
      arrowLeft: placement === 'right-start' ? -6 : popupW - 6,
      arrowTop: clamp(anchor.top + Math.min(anchor.height / 2, 20) - popup.top, 18, popupH - 18),
    }
  }
  return {
    arrowLeft: clamp(anchor.left + Math.min(anchor.width / 2, 30) - popup.left, 18, popupW - 18),
    arrowTop: placement === 'bottom-start' ? -6 : popupH - 6,
  }
}

function normalizeExplainRect(rect) {
  if (!rect) return null
  const left = Number(rect.left)
  const top = Number(rect.top)
  const width = Number(rect.width || rect.right - rect.left)
  const height = Number(rect.height || rect.bottom - rect.top)
  if (![left, top, width, height].every(Number.isFinite)) return null
  return { left, top, width, height, right: left + width, bottom: top + height }
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function cleanDescribeExplainText(text, fallback) {
  const value = String(text || '').trim()
  if (!value) return fallback
  const lower = value.toLowerCase()
  const looksRaw =
    value.startsWith('{') ||
    value.startsWith('[') ||
    lower.includes('anthropic_api_key') ||
    lower.includes('api key') ||
    lower.includes('traceback') ||
    lower.includes('request payload') ||
    lower.includes('"clickedmetric"') ||
    lower.includes('"targetvariable"') ||
    lower.includes('params: {')
  return looksRaw ? fallback : value
}

function buildDescribeExplainMeta(meta, context) {
  const {
    dataset,
    descResult,
    numericStats,
    catStats,
    qualityFlags,
    groupedQualityFlags,
    strongestCorrPair,
    activeSectionLabel,
    activeCatStat,
    selectedNumericVar,
    selectedCorrCell,
    selectedCramerCell,
    corrResult,
    cramersResult,
    chartBuilderType,
    chartBuilderX,
    chartBuilderY,
    chartBuilderAgg,
    chartTitle,
    sourceEl,
    sourceRect,
  } = context
  const variableCount = (numericStats?.length || 0) + (catStats?.length || 0)
  const rows = Number(dataset?.row_count || descResult?.row_count || 0)
  const stat = meta.stat || numericStats?.find(s => meta.id?.includes?.(s.variable)) || activeCatStat
  const corrValue = meta.value ?? (selectedCorrCell && corrResult?.matrix?.[selectedCorrCell.row]?.[selectedCorrCell.col])
  const cramerValue = meta.value ?? (selectedCramerCell && cramersResult?.matrix?.[selectedCramerCell.row]?.[selectedCramerCell.col])
  const values = {
    rows,
    variables: variableCount,
    numericVariables: numericStats?.length || 0,
    categoricalVariables: catStats?.length || 0,
    issues: qualityFlags?.length || 0,
    section: activeSectionLabel,
    chartBuilderType,
    chartBuilderX,
    chartBuilderY,
    chartBuilderAgg,
    chartTitle,
    stat,
    corrValue,
    cramerValue,
  }

  let simple = 'This control or visual explains one part of the descriptive statistics workflow.'
  let datasetExplanation = `This project has ${rows ? rows.toLocaleString() : 'the current'} rows and ${variableCount} described variables.`
  let whyItMatters = 'Understanding this part helps you decide whether the dataset is ready for analysis, visualization, or model training.'
  let verdict = 'Use this as a quick check before moving to the next step.'
  let verdictTone = 'good'

  switch (meta.type) {
    case 'sidebar':
      simple = 'The Describe page summarizes your dataset before analysis.'
      datasetExplanation = `Current descriptives cover ${numericStats?.length || 0} numeric and ${catStats?.length || 0} categorical variables.`
      whyItMatters = 'This is where you spot missing values, imbalance, skew, and relationships before making charts or models.'
      verdict = qualityFlags?.length ? `${qualityFlags.length} issue(s) still need review.` : 'Dataset summary looks ready for deeper analysis.'
      verdictTone = qualityFlags?.length ? 'warning' : 'good'
      break
    case 'sidebar-tab':
      simple = `This tab opens the ${meta.section || 'selected'} Describe section.`
      datasetExplanation = `You are currently viewing ${activeSectionLabel}.`
      whyItMatters = 'The sidebar keeps the workflow separated: overview first, then variables, correlations, and chart building.'
      verdict = 'Use the tabs to inspect one kind of evidence at a time.'
      break
    case 'variable-chip':
      simple = 'Variable chips choose which columns are included in the descriptive run.'
      datasetExplanation = `${meta.variable} is one column in this dataset. Selecting it includes it in summaries and quality checks.`
      whyItMatters = 'Filtering variables lets you focus the page on columns that matter for your analysis.'
      verdict = 'Keep important target and predictor columns selected.'
      break
    case 'action':
      simple = 'Run descriptives computes summary statistics for the selected variables.'
      datasetExplanation = `${variableCount} variables are available for summary in this project.`
      whyItMatters = 'Fresh descriptives make sure the page reflects the current cleaned dataset stage.'
      verdict = 'Run this after changing selected variables or after cleaning data.'
      break
    case 'overview-metric':
      simple = `${meta.label} is a high-level summary metric.`
      datasetExplanation = `${meta.label}: ${meta.value}${meta.detail ? `. ${meta.detail}` : ''}`
      whyItMatters = 'Summary cards help you quickly decide what needs closer inspection.'
      verdict = meta.label === 'Skewed variables' && Number(meta.value) > 0 ? 'Review skewed numeric variables before modeling.' : 'Use this as a quick status signal.'
      verdictTone = meta.label === 'Skewed variables' && Number(meta.value) > 0 ? 'warning' : 'good'
      break
    case 'issues-card':
    case 'issue-row':
    case 'quality-flags-card':
    case 'quality-flag-row': {
      const flag = meta.flag
      simple = 'A data quality flag points to a possible issue in a column.'
      datasetExplanation = flag ? `${flag.variable || 'Grouped flags'}: ${flag.desc || flag.title || flag.type}` : `${qualityFlags?.length || 0} quality issue(s) were detected.`
      whyItMatters = 'Imbalance, outliers, and mixed labels can distort charts, tests, and model training if ignored.'
      verdict = flag?.type === 'imbalance' ? 'Check whether this category split needs balancing.' : 'Review this before treating the column as reliable.'
      verdictTone = 'warning'
      break
    }
    case 'quick-scan-table':
    case 'quick-scan-row':
      simple = 'The quick-scan table summarizes each column in one compact row.'
      datasetExplanation = meta.stat ? `${meta.stat.variable} has ${meta.stat.unique ?? 'unknown'} unique value(s) and ${meta.stat.missing ?? 0} missing value(s).` : 'Each row shows type, uniqueness, missing values, and status.'
      whyItMatters = 'It helps find columns that need cleaning before analysis.'
      verdict = meta.stat?.missing > 0 ? 'Handle missing values before modeling.' : 'This is a useful first pass quality check.'
      verdictTone = meta.stat?.missing > 0 ? 'warning' : 'good'
      break
    case 'notable-card':
      simple = 'Notable findings translate statistics into plain-language observations.'
      datasetExplanation = strongestCorrPair ? `The strongest numeric relationship is ${strongestCorrPair.a} and ${strongestCorrPair.b} at r = ${strongestCorrPair.val.toFixed(3)}.` : 'No dominant numeric correlation is currently highlighted.'
      whyItMatters = 'These findings suggest what to inspect next, such as redundant variables or skewed distributions.'
      verdict = 'Use these as prompts for deeper analysis, not as final conclusions.'
      break
    case 'numeric-container':
    case 'numeric-card':
    case 'numeric-detail':
    case 'numeric-detail-part':
      simple = 'Numeric summaries describe the shape, center, spread, and missingness of a measured column.'
      datasetExplanation = stat ? `${stat.variable || selectedNumericVar}: mean ${fmt(stat.mean)}, median ${fmt(stat.median)}, SD ${fmt(stat.std)}, skew ${fmt(stat.skew)}, missing ${stat.missing ?? 0}.` : `${numericStats?.length || 0} numeric variable(s) are summarized.`
      whyItMatters = 'Mean, median, spread, skew, and missing values affect chart interpretation and model reliability.'
      verdict = stat?.skew != null && Math.abs(stat.skew) > 1 ? 'Consider transformation or outlier handling before modeling.' : 'This variable looks reasonable for standard analysis.'
      verdictTone = stat?.skew != null && Math.abs(stat.skew) > 1 ? 'warning' : 'good'
      break
    case 'numeric-control':
      simple = 'Compare overlays numeric distributions so you can inspect multiple variables together.'
      datasetExplanation = `${numericStats?.length || 0} numeric variables are available for comparison.`
      whyItMatters = 'Comparing distributions helps reveal scale differences, skew, and outliers.'
      verdict = 'Use Compare when choosing variables for modeling.'
      break
    case 'categorical-container':
    case 'category-selector':
    case 'category-filter':
    case 'category-chart':
    case 'category-value':
    case 'valid-unique-summary':
    case 'frequency-section':
      simple = 'Categorical summaries show how rows are distributed across labels.'
      datasetExplanation = meta.label ? `${meta.label} appears in ${meta.count} row(s), about ${meta.pct}% of ${meta.variable}.` : activeCatStat ? `${activeCatStat.variable} has ${activeCatStat.n} valid rows and ${activeCatStat.unique} unique value(s).` : `${catStats?.length || 0} categorical variable(s) are summarized.`
      whyItMatters = 'Category imbalance can bias comparisons and classification models toward the majority label.'
      verdict = activeCatStat?.unique > 20 ? 'Consider grouping rare labels if this will be used for modeling.' : 'Check whether the label split matches your expectations.'
      verdictTone = activeCatStat?.unique > 20 ? 'warning' : 'good'
      break
    case 'associations-section':
    case 'cramers-row':
    case 'categorical-heatmap':
    case 'cramers-cell':
    case 'categorical-relationships-panel':
    case 'categorical-relationship-row': {
      const v = Number(meta.value ?? cramerValue ?? 0)
      simple = 'Cramer\'s V measures association strength between categorical variables.'
      datasetExplanation = meta.other ? `${meta.variable} and ${meta.other} have Cramer's V = ${v.toFixed(3)}.` : `The categorical association view compares pairs of category columns.`
      whyItMatters = 'Strong categorical associations may reveal duplicated information or useful grouping structure.'
      verdict = v > 0.5 ? 'Strong association, inspect before using both columns together.' : v > 0.25 ? 'Moderate association, useful but not redundant by itself.' : 'Weak association, likely safe to consider independently.'
      verdictTone = v > 0.5 ? 'warning' : 'good'
      break
    }
    case 'correlation-heatmap':
    case 'correlation-cell':
    case 'correlation-filter':
    case 'relationship-panel':
    case 'relationship-row': {
      const r = Number(meta.value ?? corrValue ?? 0)
      simple = 'Correlation measures how two numeric variables move together.'
      datasetExplanation = meta.a ? `${meta.a} and ${meta.b} have r = ${r.toFixed(3)}.` : meta.row ? `${meta.row} and ${meta.col} have r = ${r.toFixed(3)}.` : 'The heatmap compares every numeric pair.'
      whyItMatters = 'Strong correlations can indicate useful predictors or redundant variables.'
      verdict = Math.abs(r) > 0.8 ? 'Very strong relationship, check for redundancy.' : Math.abs(r) > 0.4 ? 'Moderate relationship, worth investigating.' : 'Weak relationship, likely limited linear association.'
      verdictTone = Math.abs(r) > 0.8 ? 'warning' : 'good'
      break
    }
    case 'chart-builder':
    case 'chart-type':
    case 'field-dropdown':
    case 'aggregation':
    case 'sort':
    case 'chart-preview':
    case 'chart-action':
    case 'chart-note':
      simple = 'The Chart Builder turns selected fields into a visualization.'
      datasetExplanation = `${chartTitle || 'Current chart'} uses ${chartBuilderType}${chartBuilderX ? ` with ${chartBuilderX}` : ''}${chartBuilderY ? ` and ${chartBuilderY}` : ''}${chartBuilderAgg ? ` using ${chartBuilderAgg}` : ''}.`
      whyItMatters = 'Chart choices affect what pattern becomes visible, so field, aggregation, sort, and chart type should match the question.'
      verdict = chartBuilderX && (chartBuilderType === 'histogram' || chartBuilderY) ? 'Current chart has enough fields to preview.' : 'Choose the required fields before saving or exporting.'
      verdictTone = chartBuilderX && (chartBuilderType === 'histogram' || chartBuilderY) ? 'good' : 'warning'
      break
    default:
      if (groupedQualityFlags?.length) {
        verdict = `${groupedQualityFlags.length} grouped quality flag(s) should be reviewed.`
        verdictTone = 'warning'
      }
  }

  return {
    id: meta.id || meta.title,
    title: meta.title || 'Describe section',
    type: meta.type || 'describe',
    values,
    simple,
    datasetExplanation,
    whyItMatters,
    verdict,
    verdictTone,
    sourceEl,
    sourceRect,
  }
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
