/* ============================================================
 * PAGE: REPORT (REDESIGNED 3-COLUMN LAYOUT)
 * Keywords: report, build report, export, pdf, html, sections, live preview, outline
 * ============================================================ */
import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
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
  Legend,
} from 'chart.js'
import { Bar, Line, Scatter, Pie, Radar, Bubble, Chart } from 'react-chartjs-2'
import { api } from '../../api'

const reportPageCache = new Map()
import HelpButton from '../common/HelpButton'
import { prepareChartData } from '../../utils/chartData'
import { useAuth } from '../providers/AuthProvider'
import { useDialog } from '../common/DialogProvider'
import {
  ArrowRight,
  BarChart3,
  Brain,
  ChevronDown,
  CheckCircle2,
  Database,
  FileDown,
  FileText,
  Eye,
  GripVertical,
  Info,
  LayoutTemplate,
  Lightbulb,
  Link as LinkIcon,
  Palette,
  Printer,
  RotateCcw,
  Save,
  Shuffle,
  Sparkles,
  Table2,
  Variable,
} from 'lucide-react'

const iconProps = { size: 14, strokeWidth: 1.8 }
const smallIconProps = { size: 12, strokeWidth: 1.8 }
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
const REPORT_THEMES = [
  { id: 'classic', label: 'Classic' },
  { id: 'academic', label: 'Academic' },
  { id: 'business', label: 'Business' },
  { id: 'modern', label: 'Modern' },
]

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default function ReportPage({ dataset, initialData }) {
  const auth = useAuth()
  const dialog = useDialog()

  // Data states
  const [activity, setActivity] = useState([])
  const [models, setModels] = useState([])
  const [correlationPairs, setCorrelationPairs] = useState([])
  const [corrResult, setCorrResult] = useState(null)
  const [savedCharts, setSavedCharts] = useState([])
  const [datasetRows, setDatasetRows] = useState([])
  const [loadingData, setLoadingData] = useState(true)

  // Selection states
  const [checkedIds, setCheckedIds] = useState([])
  const [outline, setOutline] = useState([])

  // Right Settings states
  const [reportTheme, setReportTheme] = useState('classic')
  const [includePageNumbers, setIncludePageNumbers] = useState(true)
  const [includeTimestamps, setIncludeTimestamps] = useState(true)
  const [includeRawData, setIncludeRawData] = useState(false)
  const [includeMethodology, setIncludeMethodology] = useState(false)

  // Report builder toolbar states
  const [activeToolbar, setActiveToolbar] = useState(null)
  const [coverTitle, setCoverTitle] = useState('')
  const [coverSubtitle, setCoverSubtitle] = useState('')
  const [coverAuthor, setCoverAuthor] = useState('')
  const [coverInstitution, setCoverInstitution] = useState('')
  const [coverLogo, setCoverLogo] = useState('')
  const [layoutOrientation, setLayoutOrientation] = useState('portrait')
  const [pageSize, setPageSize] = useState('letter')
  const [comfortableLayout, setComfortableLayout] = useState(true)
  const [showIcons, setShowIcons] = useState(true)
  const [showSectionNumbers, setShowSectionNumbers] = useState(false)
  const [coloredHeaders, setColoredHeaders] = useState(false)
  const [pageView, setPageView] = useState(false)
  const [includeExecutiveSummary, setIncludeExecutiveSummary] = useState(false)
  const [includeRecommendations, setIncludeRecommendations] = useState(false)
  const [polishedWording, setPolishedWording] = useState(false)

  // Hover/Drag states
  const [dragOverId, setDragOverId] = useState(null)
  const [highlightedId, setHighlightedId] = useState(null)

  // Loading & generation states
  const [generatingState, setGeneratingState] = useState('idle') // idle, building, compiling, adding, done
  const [isCompiled, setIsCompiled] = useState(false)
  const [toastMessage, setToastMessage] = useState(null)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [sectionDescriptions, setSectionDescriptions] = useState({})
  const [exportMenuOpen, setExportMenuOpen] = useState(false)

  // Load project data
  useEffect(() => {
    if (!dataset?.id) return
    setLoadingData(true)

    if (initialData?.tab === 'report' && initialData?.datasetId === dataset.id) {
      const charts = initialData.savedCharts || []
      const activityList = initialData.activity?.activity || []
      const modelsList = initialData.models || []
      const pairs = initialData.corr?.analyses?.[0]?.result?.pairs || []
      setSavedCharts(charts)
      setActivity(activityList)
      setModels(modelsList)
      setDatasetRows(initialData.rows?.rows || [])
      setCorrelationPairs(pairs)
      setCorrResult(initialData.corr?.analyses?.[0]?.result || null)

      const defaultChecked = []
      const defaultOutline = []
      const dataPrep = activityList.filter((item) => {
        const category = item.category || item.detail?.category || ''
        const actionType = item.action_type || item.detail?.action_type || ''
        return (
          (category === 'data_prep' || category === 'clean' || item.kind === 'stage' || item.kind === 'cell_edit') &&
          actionType !== 'save_whatif_scenario' &&
          item.kind !== 'model' &&
          item.kind !== 'analysis'
        )
      })
      if (dataPrep.length > 0) {
        dataPrep.forEach((item) => defaultChecked.push(`dataprep-${item.id}`))
        defaultOutline.push({ id: 'data_prep', title: 'Data Preparation', type: 'data_prep', source: 'Data' })
      }
      charts.forEach((chart) => {
        defaultChecked.push(`viz-${chart.id}`)
        defaultOutline.push({ id: `viz-${chart.id}`, title: chart.title, type: 'chart', source: 'Desc', data: chart })
      })
      if (pairs.length > 0) {
        pairs.slice(0, 3).forEach((p, idx) => defaultChecked.push(`corr-${idx}`))
        defaultOutline.push({ id: 'correlations', title: 'Key Correlations', type: 'correlations', source: 'Desc' })
      }
      modelsList.forEach((model) => {
        defaultChecked.push(`model-${model.id}`)
        defaultOutline.push({ id: `model-${model.id}`, title: `${model.algorithm} results`, type: 'model', source: 'Model', data: model })
      })
      const scList = activityList.filter((item) => item.kind === 'whatif' || item.detail?.action_type === 'save_whatif_scenario')
      scList.forEach((item) => {
        defaultChecked.push(`whatif-${item.id}`)
        defaultOutline.push({ id: `whatif-${item.id}`, title: `What-if: ${item.detail?.scenario_name || item.summary}`, type: 'scenario', source: 'W-if', data: item })
      })
      defaultChecked.push('ai-prep', 'ai-model')
      defaultOutline.push({ id: 'ai', title: 'AI Interpretation', type: 'ai', source: 'AI' })

      const params = new URLSearchParams(window.location.search)
      const sharedChecked = params.get('reportChecked')
      const sharedOutline = params.get('reportOutline')
      const validOutline = new Map(defaultOutline.map((section) => [section.id, section]))
      const checkedFromUrl = sharedChecked ? sharedChecked.split(',').filter(Boolean) : null
      const outlineIdsFromUrl = sharedOutline ? sharedOutline.split(',').filter(Boolean) : null
      setCheckedIds(checkedFromUrl || defaultChecked)
      setOutline(outlineIdsFromUrl ? outlineIdsFromUrl.map((id) => validOutline.get(id)).filter(Boolean) : defaultOutline)
      setLoadingData(false)
      return
    }

    // Check module-level cache
    const ck = `${dataset.id}|${dataset.current_stage_id}`
    const cached = reportPageCache.get(ck)
    // Always reload charts from localStorage (they can change independently)
    let charts = []
    try {
      const saved = window.localStorage.getItem(`simucast.savedCharts.${dataset.id}`)
      charts = saved ? JSON.parse(saved) : []
    } catch (err) {
      console.warn('Failed to load saved charts from localStorage', err)
    }
    setSavedCharts(charts)
    if (cached) {
      setActivity(cached.activity)
      setModels(cached.models)
      setDatasetRows(cached.rows)
      setCorrelationPairs(cached.pairs)
      setCorrResult(cached.corrResult || null)
      // Rebuild outline with fresh charts
      const defaultChecked = []
      const defaultOutline = []
      const dataPrep = (cached.activity || []).filter((item) => {
        const category = item.category || item.detail?.category || ''
        const actionType = item.action_type || item.detail?.action_type || ''
        return (
          (category === 'data_prep' || category === 'clean' || item.kind === 'stage' || item.kind === 'cell_edit') &&
          actionType !== 'save_whatif_scenario' &&
          item.kind !== 'model' &&
          item.kind !== 'analysis'
        )
      })
      if (dataPrep.length > 0) {
        dataPrep.forEach((item) => defaultChecked.push(`dataprep-${item.id}`))
        defaultOutline.push({ id: 'data_prep', title: 'Data Preparation', type: 'data_prep', source: 'Data' })
      }
      charts.forEach((chart) => {
        defaultChecked.push(`viz-${chart.id}`)
        defaultOutline.push({ id: `viz-${chart.id}`, title: chart.title, type: 'chart', source: 'Desc', data: chart })
      })
      if ((cached.pairs || []).length > 0) {
        cached.pairs.slice(0, 3).forEach((p, idx) => defaultChecked.push(`corr-${idx}`))
        defaultOutline.push({ id: 'correlations', title: 'Key Correlations', type: 'correlations', source: 'Desc' })
      }
      ;(cached.models || []).forEach((model) => {
        defaultChecked.push(`model-${model.id}`)
        defaultOutline.push({ id: `model-${model.id}`, title: `${model.algorithm} results`, type: 'model', source: 'Model', data: model })
      })
      const scList = (cached.activity || []).filter((item) => item.kind === 'whatif' || item.detail?.action_type === 'save_whatif_scenario')
      scList.forEach((item) => {
        defaultChecked.push(`whatif-${item.id}`)
        defaultOutline.push({ id: `whatif-${item.id}`, title: `What-if: ${item.detail?.scenario_name || item.summary}`, type: 'scenario', source: 'W-if', data: item })
      })
      defaultChecked.push('ai-prep', 'ai-model')
      defaultOutline.push({ id: 'ai', title: 'AI Interpretation', type: 'ai', source: 'AI' })
      setCheckedIds(defaultChecked)
      setOutline(defaultOutline)
      setLoadingData(false)
      return
    }

    Promise.all([
      api.listActivity(dataset.id, 'asc').catch(() => ({ activity: [] })),
      api.listModels(dataset.id).catch(() => []),
      api.listAnalyses(dataset.id, 'test_corr', 1).catch(() => ({ analyses: [] })),
      api.getRows(dataset.id, 1, 10000, dataset.current_stage_id).catch(() => ({ rows: [] })),
    ])
      .then(([actRes, modelsRes, corrRes, rowsRes]) => {
        const activityList = actRes.activity || []
        setActivity(activityList)
        setModels(modelsRes || [])
        setDatasetRows(rowsRes.rows || [])

        const latestCorr = corrRes.analyses?.[0]
        const pairs = latestCorr?.result?.pairs || []
        setCorrelationPairs(pairs)
        setCorrResult(latestCorr?.result || null)

        // Auto-check all items by default to initialize a rich report
        const defaultChecked = []
        const defaultOutline = []

        // 1. Data Prep Actions
        const dataPrep = activityList.filter((item) => {
          const category = item.category || item.detail?.category || ''
          const actionType = item.action_type || item.detail?.action_type || ''
          return (
            (category === 'data_prep' || category === 'clean' || item.kind === 'stage' || item.kind === 'cell_edit') &&
            actionType !== 'save_whatif_scenario' &&
            item.kind !== 'model' &&
            item.kind !== 'analysis'
          )
        })
        if (dataPrep.length > 0) {
          dataPrep.forEach((item) => defaultChecked.push(`dataprep-${item.id}`))
          defaultOutline.push({ id: 'data_prep', title: 'Data Preparation', type: 'data_prep', source: 'Data' })
        }

        // 2. Saved Charts
        if (charts.length > 0) {
          charts.forEach((chart) => {
            defaultChecked.push(`viz-${chart.id}`)
            defaultOutline.push({ id: `viz-${chart.id}`, title: chart.title, type: 'chart', source: 'Desc', data: chart })
          })
        }

        // 3. Key Correlations (Up to top 3)
        if (pairs.length > 0) {
          pairs.slice(0, 3).forEach((p, idx) => defaultChecked.push(`corr-${idx}`))
          defaultOutline.push({ id: 'correlations', title: 'Key Correlations', type: 'correlations', source: 'Desc' })
        }

        // 4. Model Results
        if (modelsRes && modelsRes.length > 0) {
          modelsRes.forEach((model) => {
            defaultChecked.push(`model-${model.id}`)
            defaultOutline.push({
              id: `model-${model.id}`,
              title: `${model.algorithm} results`,
              type: 'model',
              source: 'Model',
              data: model,
            })
          })
        }

        // 5. Scenarios (What-if)
        const scList = activityList.filter(
          (item) => item.kind === 'whatif' || item.detail?.action_type === 'save_whatif_scenario'
        )
        if (scList.length > 0) {
          scList.forEach((item) => {
            defaultChecked.push(`whatif-${item.id}`)
            defaultOutline.push({
              id: `whatif-${item.id}`,
              title: `What-if: ${item.detail?.scenario_name || item.summary}`,
              type: 'scenario',
              source: 'W-if',
              data: item,
            })
          })
        }

        // 6. AI Interpretations
        defaultChecked.push('ai-prep', 'ai-model')
        defaultOutline.push({ id: 'ai', title: 'AI Interpretation', type: 'ai', source: 'AI' })

        const params = new URLSearchParams(window.location.search)
        const sharedChecked = params.get('reportChecked')
        const sharedOutline = params.get('reportOutline')
        const checkedFromUrl = sharedChecked ? sharedChecked.split(',').filter(Boolean) : null
        const outlineIdsFromUrl = sharedOutline ? sharedOutline.split(',').filter(Boolean) : null
        const validChecked = new Set(defaultChecked)
        const validOutline = new Map(defaultOutline.map((section) => [section.id, section]))

        const nextChecked = checkedFromUrl
          ? checkedFromUrl.filter((id) => validChecked.has(id))
          : defaultChecked
        const nextOutline = outlineIdsFromUrl
          ? outlineIdsFromUrl.map((id) => validOutline.get(id)).filter(Boolean)
          : defaultOutline

        reportPageCache.set(ck, {
          activity: activityList,
          models: modelsRes || [],
          pairs,
          rows: rowsRes.rows || [],
          charts,
          checkedIds: nextChecked,
          outline: nextOutline,
          corrResult: latestCorr?.result || null
        })

        setCheckedIds(nextChecked)
        setOutline(nextOutline)
      })
      .catch((err) => {
        console.error('Failed to load report components', err)
      })
      .finally(() => {
        setLoadingData(false)
      })
  }, [dataset?.id, dataset?.current_stage_id, initialData?.datasetId])

  useEffect(() => {
    if (!dataset?.id) return
    try {
      const saved = window.localStorage.getItem(`simucast.reportDraft.${dataset.id}`)
      if (!saved) return
      const draft = JSON.parse(saved)
      setReportTheme(draft.reportTheme || 'classic')
      setCoverTitle(draft.coverTitle || '')
      setCoverSubtitle(draft.coverSubtitle || '')
      setCoverAuthor(draft.coverAuthor || '')
      setCoverInstitution(draft.coverInstitution || '')
      setCoverLogo(draft.coverLogo || '')
      setLayoutOrientation(draft.layoutOrientation || 'portrait')
      setPageSize(draft.pageSize || 'letter')
      setComfortableLayout(draft.comfortableLayout !== false)
      setShowIcons(draft.showIcons !== false)
      setShowSectionNumbers(Boolean(draft.showSectionNumbers))
      setColoredHeaders(Boolean(draft.coloredHeaders))
      setPageView(Boolean(draft.pageView))
      setIncludePageNumbers(draft.includePageNumbers !== false)
      setIncludeTimestamps(draft.includeTimestamps !== false)
      setIncludeRawData(Boolean(draft.includeRawData))
      setIncludeMethodology(Boolean(draft.includeMethodology))
      setIncludeExecutiveSummary(Boolean(draft.includeExecutiveSummary))
      setIncludeRecommendations(Boolean(draft.includeRecommendations))
      setPolishedWording(Boolean(draft.polishedWording))
      setSectionDescriptions(draft.sectionDescriptions || {})
    } catch (err) {
      console.warn('Failed to load report draft settings', err)
    }
  }, [dataset?.id])

  if (!dataset) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>

  // Filter groups
  const dataPrepItems = activity.filter((item) => {
    const category = item.category || item.detail?.category || ''
    const actionType = item.action_type || item.detail?.action_type || ''
    return (
      (category === 'data_prep' || category === 'clean' || item.kind === 'stage' || item.kind === 'cell_edit') &&
      actionType !== 'save_whatif_scenario' &&
      item.kind !== 'model' &&
      item.kind !== 'analysis'
    )
  })

  const scenarioItems = activity.filter(
    (item) => item.kind === 'whatif' || item.detail?.action_type === 'save_whatif_scenario'
  )

  // Toggle checklist item
  const toggleItem = (itemId, type, title, source, data) => {
    setIsCompiled(false)
    const isChecked = !checkedIds.includes(itemId)
    let newCheckedIds = []
    if (isChecked) {
      newCheckedIds = [...checkedIds, itemId]
    } else {
      newCheckedIds = checkedIds.filter((id) => id !== itemId)
    }
    setCheckedIds(newCheckedIds)

    // Adjust outline
    let newOutline = [...outline]
    if (isChecked) {
      if (type === 'data_prep') {
        if (!newOutline.some((o) => o.id === 'data_prep')) {
          newOutline.push({ id: 'data_prep', title: 'Data Preparation', type: 'data_prep', source: 'Data' })
        }
      } else if (type === 'correlations') {
        if (!newOutline.some((o) => o.id === 'correlations')) {
          newOutline.push({ id: 'correlations', title: 'Key Correlations', type: 'correlations', source: 'Desc' })
        }
      } else if (type === 'ai') {
        if (!newOutline.some((o) => o.id === 'ai')) {
          newOutline.push({ id: 'ai', title: 'AI Interpretation', type: 'ai', source: 'AI' })
        }
      } else {
        if (!newOutline.some((o) => o.id === itemId)) {
          newOutline.push({ id: itemId, title, type, source, data })
        }
      }
    } else {
      if (type === 'data_prep') {
        const hasAnyLeft = dataPrepItems.some((item) => newCheckedIds.includes(`dataprep-${item.id}`))
        if (!hasAnyLeft) {
          newOutline = newOutline.filter((o) => o.id !== 'data_prep')
        }
      } else if (type === 'correlations') {
        const hasAnyLeft = correlationPairs.slice(0, 3).some((item, idx) => newCheckedIds.includes(`corr-${idx}`))
        if (!hasAnyLeft) {
          newOutline = newOutline.filter((o) => o.id !== 'correlations')
        }
      } else if (type === 'ai') {
        const hasAnyLeft = ['ai-prep', 'ai-model', 'ai-feature'].some((id) => newCheckedIds.includes(id))
        if (!hasAnyLeft) {
          newOutline = newOutline.filter((o) => o.id !== 'ai')
        }
      } else {
        newOutline = newOutline.filter((o) => o.id !== itemId)
      }
    }
    setOutline(newOutline)
  }

  // Select all / Deselect all
  const handleSelectAll = () => {
    setIsCompiled(false)
    const ids = []
    const newOutline = []

    if (dataPrepItems.length > 0) {
      dataPrepItems.forEach((item) => ids.push(`dataprep-${item.id}`))
      newOutline.push({ id: 'data_prep', title: 'Data Preparation', type: 'data_prep', source: 'Data' })
    }

    if (savedCharts.length > 0) {
      savedCharts.forEach((chart) => {
        ids.push(`viz-${chart.id}`)
        newOutline.push({ id: `viz-${chart.id}`, title: chart.title, type: 'chart', source: 'Desc', data: chart })
      })
    }

    if (correlationPairs.length > 0) {
      correlationPairs.slice(0, 3).forEach((c, idx) => ids.push(`corr-${idx}`))
      newOutline.push({ id: 'correlations', title: 'Key Correlations', type: 'correlations', source: 'Desc' })
    }

    if (models.length > 0) {
      models.forEach((model) => {
        ids.push(`model-${model.id}`)
        newOutline.push({
          id: `model-${model.id}`,
          title: `${model.algorithm} results`,
          type: 'model',
          source: 'Model',
          data: model,
        })
      })
    }

    if (scenarioItems.length > 0) {
      scenarioItems.forEach((sc) => {
        ids.push(`whatif-${sc.id}`)
        newOutline.push({
          id: `whatif-${sc.id}`,
          title: `What-if: ${sc.detail?.scenario_name || sc.summary}`,
          type: 'scenario',
          source: 'W-if',
          data: sc,
        })
      })
    }

    ids.push('ai-prep', 'ai-model', 'ai-feature')
    newOutline.push({ id: 'ai', title: 'AI Interpretation', type: 'ai', source: 'AI' })

    setCheckedIds(ids)
    setOutline(newOutline)
  }

  const handleDeselectAll = () => {
    setIsCompiled(false)
    setCheckedIds([])
    setOutline([])
  }

  // HTML5 Drag and Drop Handlers
  const handleDragStart = (e, index) => {
    e.dataTransfer.setData('text/plain', String(index))
    e.dataTransfer.effectAllowed = 'move'
  };

  const handleDragOver = (e, id) => {
    e.preventDefault()
    if (dragOverId !== id) {
      setDragOverId(id)
    }
  };

  const handleDragLeave = () => {
    setDragOverId(null)
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault()
    setDragOverId(null)
    const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'), 10)
    if (isNaN(sourceIndex) || sourceIndex === targetIndex) return

    const newOutline = [...outline]
    const [removed] = newOutline.splice(sourceIndex, 1)
    newOutline.splice(targetIndex, 0, removed)
    setOutline(newOutline)
    setIsCompiled(false)
  };

  // Clicking a section highlights the picker item
  const highlightPickerItem = (sectionId) => {
    setHighlightedId(sectionId)

    let elementId = ''
    if (sectionId === 'data_prep') elementId = 'picker-group-data_prep'
    else if (sectionId === 'correlations') elementId = 'picker-group-correlations'
    else if (sectionId === 'ai') elementId = 'picker-group-ai'
    else if (sectionId.startsWith('viz-')) elementId = `picker-item-${sectionId}`
    else if (sectionId.startsWith('model-')) elementId = `picker-item-${sectionId}`
    else if (sectionId.startsWith('whatif-')) elementId = `picker-item-${sectionId}`

    if (elementId) {
      const el = document.getElementById(elementId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }

    setTimeout(() => {
      setHighlightedId(null)
    }, 1500)
  };

  // Generate simulated loading bar
  const handleGenerateReport = async () => {
    if (auth.isGuest) {
      auth.requireAccountForReports()
      return
    }

    setGeneratingState('building')

    // Phase transitions
    setTimeout(() => setGeneratingState('compiling'), 400)
    setTimeout(() => setGeneratingState('adding'), 900)

    // Call actual backend compilation
    const backendSections = []
    if (outline.some((o) => o.type === 'data_prep')) backendSections.push('summary', 'documentation')
    if (outline.some((o) => o.type === 'chart' || o.type === 'correlations')) backendSections.push('descriptives', 'tests')
    if (outline.some((o) => o.type === 'model')) backendSections.push('models')
    if (outline.some((o) => o.type === 'ai')) backendSections.push('ai_interpretation')

    try {
      await api.buildReport(dataset.id, backendSections)

      setTimeout(() => {
        setGeneratingState('done')
        setTimeout(() => {
          setGeneratingState('idle')
          setIsCompiled(true)
        }, 300)
      }, 1300)
    } catch (err) {
      setGeneratingState('idle')
      console.error('Failed to generate report', err)
      await dialog.alert({ title: 'Report Generation Failed', message: err.message, variant: 'danger' })
    }
  };

  const reportExportStyles = [
    'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; color: #1a1a1a; background: #f8f8f7; line-height: 1.5; font-size: 13px; }',
    '.report-doc { background: #fff; border: 1px solid #e5e5e3; border-radius: 12px; overflow: hidden; max-width: 800px; margin: 0 auto; box-shadow: none; }',
    '.doc-cover { background: linear-gradient(135deg, #f97316, #fb923c, #fbbf24); padding: 34px 36px 30px; color: #fff; }',
    '.doc-tag { font-size: 10px; font-weight: 700; color: rgba(255,255,255,.76); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }',
    '.doc-title { font-size: 24px; font-weight: 700; line-height: 1.25; margin-bottom: 6px; }',
    '.doc-subtitle { font-size: 14px; color: rgba(255,255,255,.9); margin-bottom: 8px; }',
    '.doc-sub { font-size: 12px; color: rgba(255,255,255,.82); }',
    '.doc-byline { font-size: 11px; color: rgba(255,255,255,.78); margin-top: 14px; }',
    '.doc-logo { width: 54px; height: 54px; object-fit: contain; background: rgba(255,255,255,.9); border-radius: 10px; padding: 8px; margin-bottom: 12px; }',
    '.doc-section { border-bottom: 1px solid #f0f0ee; padding: 22px 28px; page-break-inside: avoid; }',
    '.doc-section:last-child { border-bottom: none; }',
    '.drag-handle-preview, .ci-thumb { display: none !important; }',
    '.ds-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }',
    '.ds-icon { display: none !important; }',
    '.ds-title { font-size: 15px; font-weight: 700; color: #111; }',
    '.ds-badge, .oi-src { font-size: 9px; font-weight: 650; padding: 2px 7px; border-radius: 10px; }',
    '.section-description-wrap { margin: -2px 0 12px 36px; }',
    '.section-description-input { width: 100%; border: 0; background: transparent; color: #525252; font: inherit; font-size: 11.5px; line-height: 1.55; padding: 0; resize: none; }',
    '.section-description-tools { display: none !important; }',
    '.section-description-export { margin: -2px 0 12px 36px; color: #525252; font-size: 11.5px; line-height: 1.55; }',
    '.change-list { display: flex; flex-direction: column; gap: 6px; }',
    '.change-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; background: #f8f8f7; border-radius: 7px; }',
    '.ci-dot { width: 6px; height: 6px; border-radius: 50%; background: #166534; margin-top: 4.5px; flex-shrink: 0; }',
    '.ci-text { font-size: 11px; color: #1a1a1a; line-height: 1.4; }',
    '.ci-stat, .chart-cap { font-size: 10px; color: #777; margin-top: 3px; }',
    '.chart-preview { background: #f8f8f7; border-radius: 8px; padding: 12px; margin-bottom: 8px; text-align: center; }',
    '.chart-mock { display: flex; align-items: flex-end; justify-content: center; gap: 8px; height: 120px; padding: 10px; border-radius: 6px; overflow: hidden; }',
    '.report-chart-canvas { display: block; position: relative; width: 100%; height: 280px; padding: 12px 14px; background: #fff; }',
    '.report-chart-canvas canvas, .report-chart-canvas img { width: 100% !important; height: 100% !important; object-fit: contain; }',
    '.bar-mock { background: #f97316; opacity: 0.8; flex: 1; border-radius: 3px 3px 0 0; }',
    'table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }',
    'th, td { border-bottom: 1px solid #e5e5e3; padding: 8px 10px; text-align: left; }',
    'th { background: #f5f5f5; font-weight: 650; text-transform: uppercase; font-size: 9px; letter-spacing: 0.05em; color: #666; }',
    '.corr-list { display: flex; flex-direction: column; gap: 6px; }',
    '.corr-row { display: flex; align-items: center; gap: 8px; }',
    '.corr-pair { font-size: 11px; color: #1a1a1a; min-width: 200px; }',
    '.corr-bar-wrap, .acc-track { flex: 1; height: 4px; background: #f0f0ee; border-radius: 2px; overflow: hidden; }',
    '.corr-bar, .acc-fill { height: 100%; border-radius: 2px; }',
    '.acc-fill { background: #f97316; }',
    '.corr-val, .wi-result { font-size: 11px; font-weight: 650; }',
    '.best-badge { font-size: 9px; font-weight: 650; padding: 1px 5px; background: #dcfce7; color: #166534; border-radius: 4px; }',
    '.ai-generated-section p { margin: 0; font-size: 11.5px; color: #525252; line-height: 1.6; }',
    '.report-layout-landscape { max-width: 1050px; }',
    '.report-size-a4 { max-width: 780px; }',
    '.report-layout-landscape.report-size-a4 { max-width: 1080px; }',
    '.report-density-compact .doc-section { padding: 14px 20px; }',
    '.report-density-compact .change-item { padding: 6px 8px; }',
    '.report-density-compact .chart-mock { height: 96px; }',
    '.report-colored-headers .ds-header { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 8px 10px; }',
    '.report-hide-icons .ds-icon { display: none !important; }',
    '.report-show-section-numbers #report-doc-sections { counter-reset: report-section; }',
    '.report-show-section-numbers #report-doc-sections > .doc-section { counter-increment: report-section; }',
    '.report-show-section-numbers #report-doc-sections > .doc-section .ds-title::before { content: counter(report-section) ". "; color: #f97316; font-weight: 800; }',
    '.report-theme-academic { font-family: Georgia, "Times New Roman", serif; color: #1f2933; }',
    '.report-theme-academic .doc-cover { background: #f7f5ef; color: #1f2933; border-bottom: 2px solid #1f2933; }',
    '.report-theme-academic .doc-tag, .report-theme-academic .doc-sub, .report-theme-academic .doc-subtitle, .report-theme-academic .doc-byline { color: #5f6872; }',
    '.report-theme-academic .doc-title { color: #1f2933; font-weight: 650; }',
    '.report-theme-academic .doc-section { border-bottom: 1px solid #d8d3c7; }',
    '.report-theme-academic .ds-title { font-family: Georgia, "Times New Roman", serif; font-size: 16px; }',
    '.report-theme-academic .change-item, .report-theme-academic .chart-preview { background: #fbfaf7; }',
    '.report-theme-business .doc-cover { background: linear-gradient(135deg, #17324d, #24577a); }',
    '.report-theme-business .doc-section { border-bottom: 0; border-top: 4px solid #f97316; }',
    '.report-theme-business .ds-title { color: #17324d; }',
    '.report-theme-business .change-item, .report-theme-business .chart-preview { background: #f6f9fc; border: 1px solid #e1e8ef; }',
    '.report-theme-business .ds-badge { background: #e8f0f7 !important; color: #17324d !important; }',
    '.report-theme-modern { background: #fbfbfb; border: 0; border-radius: 18px; box-shadow: 0 24px 80px rgba(15, 23, 42, 0.14); }',
    '.report-theme-modern .doc-cover { background: radial-gradient(circle at 90% 18%, rgba(255,255,255,.3), transparent 20%), linear-gradient(135deg, #ff6a00, #ffb72a); }',
    '.report-theme-modern .doc-section { margin: 20px; border: 1px solid #eeeeeb; border-radius: 14px; background: #fff; box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06); }',
    '.report-theme-modern .doc-section:last-child { border-bottom: 1px solid #eeeeeb; }',
    '.report-theme-modern .chart-preview { background: linear-gradient(135deg, #f0fdf4, #eff6ff); border: 1px solid #dbeafe; }',
    '.report-theme-modern .chart-mock { min-height: 150px; }',
    '@media print { body { padding: 0; background: #fff; } .report-doc { border: 0; border-radius: 0; max-width: none; } }',
  ].join('\n')

  const prepareReportCloneForExport = (clone, sourceNode = null) => {
    clone.querySelectorAll('.drag-handle-preview, .section-description-tools').forEach((node) => node.remove())
    clone.querySelectorAll('[draggable]').forEach((node) => node.removeAttribute('draggable'))
    const sourceCanvases = sourceNode ? Array.from(sourceNode.querySelectorAll('canvas')) : []
    clone.querySelectorAll('canvas').forEach((canvas, idx) => {
      const sourceCanvas = sourceCanvases[idx]
      if (!sourceCanvas) return
      try {
        const img = document.createElement('img')
        img.src = sourceCanvas.toDataURL('image/png')
        img.alt = canvas.getAttribute('aria-label') || 'Chart'
        img.style.width = '100%'
        img.style.height = '100%'
        img.style.objectFit = 'contain'
        canvas.replaceWith(img)
      } catch {
        // Leave the canvas in place if a browser blocks serialization.
      }
    })
    clone.querySelectorAll('.section-description-input').forEach((node) => {
      const text = node.value?.trim()
      if (!text) {
        node.closest('.section-description-wrap')?.remove()
        return
      }
      const paragraph = document.createElement('p')
      paragraph.className = 'section-description-export'
      paragraph.textContent = text
      node.closest('.section-description-wrap')?.replaceWith(paragraph)
    })
    return clone
  }

  const getReportDocumentHtml = () => {
    const reportNode = document.getElementById('report-doc')
    if (!reportNode) return ''
    const clone = prepareReportCloneForExport(reportNode.cloneNode(true), reportNode)
    return [
      '<!DOCTYPE html>',
      '<html>',
      '<head>',
      '  <meta charset="utf-8">',
      '  <title>SimuCast Report: ' + escapeHtml(dataset.name) + '</title>',
      '  <style>' + reportExportStyles + '</style>',
      '</head>',
      '<body>',
      clone.outerHTML,
      '</body>',
      '</html>',
    ].join('\n')
  }

  // Export actions
  const printReport = () => {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(getReportDocumentHtml())
    w.document.close()
    w.focus()
    w.print()
  }

  const exportPdf = async () => {
    const reportNode = document.getElementById('report-doc')
    if (!reportNode || exportingPdf) return

    setExportingPdf(true)
    setToastMessage('Exporting PDF...')

    let exportRoot = null
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])

      if (document.fonts?.ready) await document.fonts.ready

      const clone = prepareReportCloneForExport(reportNode.cloneNode(true), reportNode)
      clone.style.maxWidth = 'none'
      clone.style.width = layoutOrientation === 'landscape' ? '1050px' : '800px'
      clone.style.margin = '0'

      exportRoot = document.createElement('div')
      exportRoot.setAttribute('aria-hidden', 'true')
      exportRoot.style.position = 'fixed'
      exportRoot.style.left = '-12000px'
      exportRoot.style.top = '0'
      exportRoot.style.width = clone.style.width
      exportRoot.style.background = '#fff'
      exportRoot.style.pointerEvents = 'none'
      exportRoot.style.zIndex = '-1'

      const style = document.createElement('style')
      style.textContent = reportExportStyles
      exportRoot.appendChild(style)
      exportRoot.appendChild(clone)
      document.body.appendChild(exportRoot)

      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

      const canvas = await html2canvas(clone, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
        windowWidth: clone.scrollWidth,
        windowHeight: clone.scrollHeight,
      })

      const pdf = new jsPDF({
        orientation: layoutOrientation,
        unit: 'pt',
        format: pageSize,
        compress: true,
      })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 28
      const contentWidth = pageWidth - margin * 2
      const contentHeight = pageHeight - margin * 2
      const pageCanvasHeight = Math.floor(contentHeight * (canvas.width / contentWidth))
      const safeName = String(dataset.name || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

      let sourceY = 0
      let pageIndex = 0
      while (sourceY < canvas.height) {
        const sliceHeight = Math.min(pageCanvasHeight, canvas.height - sourceY)
        const pageCanvas = document.createElement('canvas')
        pageCanvas.width = canvas.width
        pageCanvas.height = sliceHeight
        const ctx = pageCanvas.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
        ctx.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight)

        if (pageIndex > 0) pdf.addPage()
        const imageHeight = sliceHeight * (contentWidth / canvas.width)
        pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, contentWidth, imageHeight)
        if (includePageNumbers) {
          pdf.setFontSize(8)
          pdf.setTextColor(120)
          pdf.text(String(pageIndex + 1), pageWidth / 2, pageHeight - 12, { align: 'center' })
        }
        sourceY += sliceHeight
        pageIndex += 1
      }

      pdf.save('simucast_report_' + (safeName || 'dataset') + '.pdf')
      setToastMessage('PDF exported')
    } catch (error) {
      console.error('PDF export failed:', error)
      setToastMessage('PDF export failed')
    } finally {
      if (exportRoot) exportRoot.remove()
      setExportingPdf(false)
      setTimeout(() => setToastMessage(null), 2500)
    }
  }

  const exportHtml = () => {
    const docHtml = getReportDocumentHtml()
    const blob = new Blob([docHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const safeName = String(dataset.name || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    a.href = url
    a.download = 'simucast_report_' + (safeName || 'dataset') + '.html'
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyLink = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('reportChecked', checkedIds.join(','))
    url.searchParams.set('reportOutline', outline.map((section) => section.id).join(','))
    navigator.clipboard.writeText(url.toString()).then(() => {
      setToastMessage('Report link copied')
      setTimeout(() => setToastMessage(null), 2500)
    })
  }

  const saveDraft = () => {
    const draft = {
      reportTheme,
      coverTitle,
      coverSubtitle,
      coverAuthor,
      coverInstitution,
      coverLogo,
      layoutOrientation,
      pageSize,
      comfortableLayout,
      showIcons,
      showSectionNumbers,
      coloredHeaders,
      pageView,
      includePageNumbers,
      includeTimestamps,
      includeRawData,
      includeMethodology,
      includeExecutiveSummary,
      includeRecommendations,
      polishedWording,
      sectionDescriptions,
    }
    window.localStorage.setItem(`simucast.reportDraft.${dataset.id}`, JSON.stringify(draft))
    setToastMessage('Report draft saved')
    setTimeout(() => setToastMessage(null), 2500)
  }

  const resetReportDesign = () => {
    setActiveToolbar(null)
    setReportTheme('classic')
    setCoverTitle('')
    setCoverSubtitle('')
    setCoverAuthor('')
    setCoverInstitution('')
    setCoverLogo('')
    setLayoutOrientation('portrait')
    setPageSize('letter')
    setComfortableLayout(true)
    setShowIcons(true)
    setShowSectionNumbers(false)
    setColoredHeaders(false)
    setPageView(false)
    setIncludePageNumbers(true)
    setIncludeTimestamps(true)
    setIncludeRawData(false)
    setIncludeMethodology(false)
    setIncludeExecutiveSummary(false)
    setIncludeRecommendations(false)
    setPolishedWording(false)
    setSectionDescriptions({})
    setIsCompiled(false)
  }

  const updateToolbarSetting = (setter, value) => {
    setter(value)
    setIsCompiled(false)
  }

  // Helper selectors
  const checkedDataPrep = dataPrepItems.filter((i) => checkedIds.includes(`dataprep-${i.id}`))
  const checkedCharts = savedCharts.filter((c) => checkedIds.includes(`viz-${c.id}`))
  const checkedCorrelations = correlationPairs.slice(0, 3).filter((c, idx) => checkedIds.includes(`corr-${idx}`))
  const checkedModels = models.filter((m) => checkedIds.includes(`model-${m.id}`))
  const checkedScenarios = scenarioItems.filter((s) => checkedIds.includes(`whatif-${s.id}`))

  const totalSectionsCount = outline.length
  const defaultCoverTitle =
    models.length > 0
      ? `Can we predict ${models[0].target} using machine learning?`
      : 'Can we predict species from body measurements?'
  const resolvedCoverTitle = coverTitle.trim() || defaultCoverTitle
  const resolvedCoverSubtitle = coverSubtitle.trim()
  const resolvedCoverAuthor = coverAuthor.trim()
  const resolvedCoverInstitution = coverInstitution.trim()
  const resolvedCoverLogo = coverLogo.trim()
  const reportDocClasses = [
    'report-doc',
    `report-theme-${reportTheme}`,
    `report-layout-${layoutOrientation}`,
    `report-size-${pageSize}`,
    comfortableLayout ? 'report-density-comfortable' : 'report-density-compact',
    pageView ? 'report-page-view' : '',
    coloredHeaders ? 'report-colored-headers' : '',
    showSectionNumbers ? 'report-show-section-numbers' : '',
    showIcons ? '' : 'report-hide-icons',
  ]
    .filter(Boolean)
    .join(' ')

  const updateSectionDescription = (sectionId, value) => {
    setSectionDescriptions((prev) => ({ ...prev, [sectionId]: value }))
    setIsCompiled(false)
  }

  const getSuggestedDescription = (section) => {
    if (!section) return ''
    if (section.type === 'data_prep') {
      return `This section documents the preparation steps applied to ${dataset.filename || dataset.name || 'the dataset'}, including cleaning and transformation actions used before analysis.`
    }
    if (section.type === 'chart') {
      const xAxis = section.data?.xAxis || 'the selected variable'
      const yAxis = section.data?.yAxis || 'the measured outcome'
      return `This visualization summarizes the relationship between ${xAxis} and ${yAxis}, helping identify visible patterns before statistical interpretation.`
    }
    if (section.type === 'correlations') {
      const strongest = checkedCorrelations.slice().sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0]
      return strongest
        ? `The correlation summary highlights numeric variable pairs, with ${strongest.var_a} and ${strongest.var_b} showing the strongest selected relationship at r = ${Number(strongest.r).toFixed(3)}.`
        : 'This section compares numeric variable pairs to identify whether meaningful linear relationships are present in the dataset.'
    }
    if (section.type === 'model') {
      const metric = section.data?.metrics?.accuracy
        ? `${(section.data.metrics.accuracy * 100).toFixed(1)}% accuracy`
        : section.data?.metrics?.r2
        ? `R² = ${section.data.metrics.r2.toFixed(3)}`
        : 'the available performance metrics'
      return `This model result reports how ${section.data?.algorithm || 'the selected model'} performed when predicting ${section.data?.target || 'the target variable'}, using ${metric} as the main comparison point.`
    }
    if (section.type === 'scenario') {
      return 'This what-if scenario records a simulated prediction from selected input values, supporting comparison of expected outcomes under different assumptions.'
    }
    if (section.type === 'ai') {
      return 'The AI interpretation converts the selected findings into concise narrative explanations for readers who need a non-technical summary.'
    }
    return `This section adds context for ${section.title || 'the selected report item'}.`
  }

  const generateSectionDescription = (section) => {
    updateSectionDescription(section.id, getSuggestedDescription(section))
    setToastMessage('Section description generated')
    setTimeout(() => setToastMessage(null), 1800)
  }

  const renderSectionDescription = (section) => (
    <div className="section-description-wrap" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <textarea
        className="section-description-input"
        value={sectionDescriptions[section.id] || ''}
        onChange={(e) => updateSectionDescription(section.id, e.target.value)}
        placeholder="Add your description for this section..."
        rows={2}
        draggable={false}
        onDragStart={(e) => e.stopPropagation()}
      />
      <div className="section-description-tools">
        <button
          type="button"
          className="section-ai-btn"
          title="Generate description"
          onClick={() => generateSectionDescription(section)}
        >
          <Sparkles size={12} strokeWidth={1.9} /> AI
        </button>
      </div>
    </div>
  )

  // Highlight check
  const isHighlighted = (id) => highlightedId === id

  return (
    <div className="ax-report-page-layout">
      {/* Dynamic CSS Injection to ensure clean styling without grid leakage */}
      <style>{`
        .ax-report-page-layout {
          display: grid;
          grid-template-columns: 280px minmax(0, 1fr) 240px;
          height: calc(100dvh - 80px);
          max-height: calc(100dvh - 80px);
          overflow: hidden;
          background: #f8f8f7;
          color: #1a1a1a;
          font-family: 'DM Sans', sans-serif;
          margin: -18px 0 0;
          border: 0.5px solid #e5e5e3;
          border-radius: 0 0 0 10px;
        }
        .left-panel {
          display: flex;
          flex-direction: column;
          border-right: 1px solid #e5e5e3;
          overflow: hidden;
          background: #fff;
          height: 100%;
        }
        .lh {
          padding: 18px 18px 14px 24px;
          border-bottom: 1px solid #e5e5e3;
          flex-shrink: 0;
        }
        .lh-title {
          font-size: 14px;
          font-weight: 700;
          color: #1a1a1a;
          margin-bottom: 2px;
        }
        .lh-sub {
          font-size: 11px;
          color: #a0a0a0;
        }
        .lh-actions {
          display: flex;
          gap: 8px;
          margin-top: 10px;
        }
        .sel-link {
          font-size: 11px;
          color: #f97316;
          cursor: pointer;
          background: none;
          border: none;
          padding: 0;
          font-family: inherit;
          font-weight: 500;
        }
        .sel-link:hover {
          text-decoration: underline;
        }
        .left-scroll {
          overflow-y: auto;
          overscroll-behavior: contain;
          flex: 1;
          min-height: 0;
          padding: 14px 18px 14px 24px;
        }
        .left-scroll::-webkit-scrollbar {
          width: 3px;
        }
        .left-scroll::-webkit-scrollbar-thumb {
          background: #e5e5e3;
          border-radius: 2px;
        }
        .left-footer {
          padding: 14px 18px 16px 24px;
          border-top: 1px solid #e5e5e3;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .cgroup {
          margin-bottom: 14px;
        }
        .cg-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 7px;
        }
        .cg-title {
          font-size: 10px;
          font-weight: 700;
          color: #a0a0a0;
          text-transform: uppercase;
          letter-spacing: .06em;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .cg-badge {
          font-size: 9px;
          font-weight: 600;
          padding: 1px 6px;
          border-radius: 10px;
          background: #f8f8f7;
          color: #6b6b6b;
          border: 1px solid #e5e5e3;
        }
        .cg-badge.active {
          background: #dcfce7;
          color: #166534;
          border-color: #bbf7d0;
        }
        .cg-body {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .citem {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 7px 9px;
          border-radius: 7px;
          cursor: pointer;
          transition: background .12s;
          border: 1px solid transparent;
        }
        .citem:hover {
          background: #f8f8f7;
        }
        .citem.checked {
          background: #f8f8f7;
          border-color: #f0f0ee;
        }
        .citem input[type=checkbox] {
          accent-color: #f97316;
          margin-top: 1px;
          flex-shrink: 0;
          width: 14px;
          height: 14px;
          cursor: pointer;
        }
        .ci-content {
          flex: 1;
          min-width: 0;
        }
        .ci-title {
          font-size: 11px;
          font-weight: 500;
          color: #1a1a1a;
          line-height: 1.3;
          margin-bottom: 1px;
        }
        .ci-meta {
          font-size: 10px;
          color: #a0a0a0;
          line-height: 1.3;
        }
        .cg-empty {
          padding: 8px 9px;
          font-size: 11px;
          color: #a0a0a0;
          font-style: italic;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .goto-link {
          font-size: 10px;
          font-weight: 500;
          color: #f97316;
          background: none;
          border: none;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 3px;
        }
        .goto-link:hover {
          text-decoration: underline;
        }
        .center-panel {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: #f8f8f7;
          height: 100%;
          position: relative;
        }
        .report-toolbar {
          position: relative;
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 16px;
          border-bottom: 1px solid #e5e5e3;
          background: #fff;
          flex-shrink: 0;
        }
        .rt-left,
        .rt-actions,
        .rt-right {
          display: flex;
          align-items: center;
          gap: 7px;
          min-width: 0;
        }
        .rt-right {
          position: relative;
          flex-shrink: 0;
        }
        .export-dropdown {
          position: absolute;
          top: calc(100% + 7px);
          right: 0;
          width: 190px;
          padding: 6px;
          border: 1px solid #e5e5e3;
          border-radius: 10px;
          background: #fff;
          box-shadow: 0 18px 42px rgba(15, 23, 42, .14);
          z-index: 45;
        }
        .export-option {
          width: 100%;
          height: 34px;
          display: flex;
          align-items: center;
          gap: 8px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: #374151;
          font-family: inherit;
          font-size: 12px;
          font-weight: 650;
          cursor: pointer;
          padding: 0 10px;
          text-align: left;
        }
        .export-option:hover:not(:disabled) {
          background: #fff7ed;
          color: #c2410c;
        }
        .export-option:disabled {
          color: #a3a3a3;
          cursor: not-allowed;
        }
        .rt-title {
          font-size: 13px;
          font-weight: 750;
          color: #1a1a1a;
          margin-right: 4px;
          white-space: nowrap;
        }
        .rt-back,
        .rt-btn {
          height: 30px;
          border: 1px solid #e5e5e3;
          background: #fff;
          color: #525252;
          border-radius: 8px;
          padding: 0 9px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 650;
          font-family: inherit;
          text-decoration: none;
          cursor: pointer;
          transition: border-color .15s, background .15s, color .15s, transform .15s;
          white-space: nowrap;
        }
        .rt-btn.icon-only {
          width: 30px;
          padding: 0;
        }
        .rt-back:hover,
        .rt-btn:hover {
          border-color: #fed7aa;
          background: #fff7ed;
          color: #c2410c;
        }
        .rt-btn.active {
          border-color: #fb923c;
          background: #fff7ed;
          color: #c2410c;
        }
        .rt-primary {
          background: #f97316;
          border-color: #f97316;
          color: #fff;
        }
        .rt-primary:hover {
          background: #ea6c0a;
          border-color: #ea6c0a;
          color: #fff;
        }
        .rt-popover {
          position: absolute;
          top: calc(100% + 6px);
          left: 112px;
          width: 310px;
          padding: 12px;
          border: 1px solid #e5e5e3;
          border-radius: 10px;
          background: #fff;
          box-shadow: 0 18px 46px rgba(15, 23, 42, .14);
          z-index: 40;
        }
        .rt-popover.wide {
          width: 380px;
        }
        .rt-section-title {
          font-size: 10px;
          font-weight: 800;
          color: #a0a0a0;
          text-transform: uppercase;
          letter-spacing: .06em;
          margin-bottom: 8px;
        }
        .rt-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .rt-option,
        .rt-check {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 8px 9px;
          border: 1px solid #e5e5e3;
          border-radius: 8px;
          font-size: 11px;
          color: #525252;
          cursor: pointer;
          min-width: 0;
        }
        .rt-option.active {
          border-color: #fed7aa;
          background: #fff7ed;
          color: #c2410c;
          font-weight: 700;
        }
        .rt-option input,
        .rt-check input {
          accent-color: #f97316;
          width: 13px;
          height: 13px;
          margin: 0;
        }
        .rt-field {
          display: grid;
          gap: 5px;
          margin-bottom: 9px;
        }
        .rt-field span {
          font-size: 10px;
          font-weight: 700;
          color: #6b6b6b;
        }
        .rt-field input {
          width: 100%;
          height: 32px;
          border: 1px solid #e5e5e3;
          border-radius: 8px;
          padding: 0 10px;
          font-family: inherit;
          font-size: 12px;
          color: #1a1a1a;
          outline: none;
        }
        .rt-field input:focus {
          border-color: #fb923c;
          box-shadow: 0 0 0 2px rgba(249, 115, 22, .12);
        }
        .rt-note {
          font-size: 10px;
          color: #a0a0a0;
          line-height: 1.4;
          margin-top: 8px;
        }
        .preview-header {
          display: none;
        }
        .ph-title {
          font-size: 13px;
          font-weight: 600;
          color: #1a1a1a;
        }
        .ph-meta {
          font-size: 11px;
          color: #a0a0a0;
        }
        .ph-count {
          font-size: 11px;
          font-weight: 500;
          color: #f97316;
        }
        .preview-scroll {
          overflow-y: auto;
          overscroll-behavior: contain;
          flex: 1;
          min-height: 0;
          padding: 18px 20px 24px;
        }
        .preview-scroll::-webkit-scrollbar {
          width: 4px;
        }
        .preview-scroll::-webkit-scrollbar-thumb {
          background: #e5e5e3;
          border-radius: 2px;
        }
        .report-doc {
          background: #fff;
          border: 1px solid #e5e5e3;
          border-radius: 12px;
          overflow: hidden;
          max-width: 940px;
          margin: 0 auto;
          box-shadow: 0 2px 12px rgba(0,0,0,.06);
          position: relative;
        }
        .report-layout-landscape {
          max-width: 1120px;
        }
        .report-size-a4 {
          max-width: 900px;
        }
        .report-layout-landscape.report-size-a4 {
          max-width: 1180px;
        }
        .report-page-view {
          --page-gap: 18px;
          --page-h: 1056px;
          max-width: 816px;
          min-height: var(--page-h);
          border-radius: 2px;
          box-shadow: 0 16px 42px rgba(15, 23, 42, .16);
          background:
            repeating-linear-gradient(
              to bottom,
              #fff 0,
              #fff calc(var(--page-h) - 1px),
              #d9d9d7 calc(var(--page-h) - 1px),
              #d9d9d7 var(--page-h),
              #f1f1ef var(--page-h),
              #f1f1ef calc(var(--page-h) + var(--page-gap))
            );
        }
        .report-page-view.report-layout-landscape {
          --page-h: 816px;
          max-width: 1056px;
        }
        .report-page-view.report-size-a4 {
          --page-h: 1123px;
          max-width: 794px;
        }
        .report-page-view.report-size-a4.report-layout-landscape {
          --page-h: 794px;
          max-width: 1123px;
        }
        .report-page-view .doc-cover,
        .report-page-view .doc-section {
          break-inside: avoid;
        }
        .report-page-view .doc-section {
          background: rgba(255,255,255,.92);
        }
        .report-density-compact .doc-section {
          padding: 12px 18px;
        }
        .report-density-compact .change-item {
          padding: 6px 8px;
        }
        .report-density-compact .chart-mock {
          height: 96px;
        }
        .report-colored-headers .ds-header {
          background: #fff7ed;
          border: 1px solid #fed7aa;
          border-radius: 8px;
          padding: 8px 10px;
        }
        .report-hide-icons .ds-icon {
          display: none;
        }
        .report-show-section-numbers #report-doc-sections {
          counter-reset: report-section;
        }
        .report-show-section-numbers #report-doc-sections > .doc-section {
          counter-increment: report-section;
        }
        .report-show-section-numbers #report-doc-sections > .doc-section .ds-title::before {
          content: counter(report-section) ". ";
          color: #f97316;
          font-weight: 800;
        }
        .report-theme-academic {
          font-family: Georgia, "Times New Roman", serif;
          color: #1f2933;
        }
        .report-theme-academic .doc-cover {
          background: #f7f5ef;
          color: #1f2933;
          border-bottom: 2px solid #1f2933;
        }
        .report-theme-academic .doc-cover::after {
          display: none;
        }
        .report-theme-academic .doc-tag,
        .report-theme-academic .doc-sub,
        .report-theme-academic .doc-subtitle,
        .report-theme-academic .doc-byline {
          color: #5f6872;
        }
        .report-theme-academic .doc-title {
          color: #1f2933;
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 650;
          letter-spacing: 0;
        }
        .report-theme-academic .doc-section {
          border-bottom-color: #d8d3c7;
        }
        .report-theme-academic .ds-title {
          font-family: Georgia, "Times New Roman", serif;
          font-size: 15px;
        }
        .report-theme-academic .change-item,
        .report-theme-academic .chart-preview {
          background: #fbfaf7;
        }
        .report-theme-business .doc-cover {
          background: linear-gradient(135deg, #17324d, #24577a);
        }
        .report-theme-business .doc-section {
          border-bottom: 0;
          border-top: 4px solid #f97316;
        }
        .report-theme-business .ds-title {
          color: #17324d;
        }
        .report-theme-business .change-item,
        .report-theme-business .chart-preview {
          background: #f6f9fc;
          border: 1px solid #e1e8ef;
        }
        .report-theme-business .ds-badge {
          background: #e8f0f7 !important;
          color: #17324d !important;
        }
        .report-theme-modern {
          background: #fbfbfb;
          border: 0;
          border-radius: 18px;
          box-shadow: 0 24px 80px rgba(15, 23, 42, 0.14);
        }
        .report-theme-modern .doc-cover {
          background:
            radial-gradient(circle at 90% 18%, rgba(255,255,255,.3), transparent 20%),
            linear-gradient(135deg, #ff6a00, #ffb72a);
        }
        .report-theme-modern .doc-section {
          margin: 20px;
          border: 1px solid #eeeeeb;
          border-radius: 14px;
          background: #fff;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06);
        }
        .report-theme-modern .doc-section:last-child {
          border-bottom: 1px solid #eeeeeb;
        }
        .report-theme-modern .chart-preview {
          background: linear-gradient(135deg, #f0fdf4, #eff6ff);
          border: 1px solid #dbeafe;
        }
        .report-theme-modern .chart-mock {
          min-height: 150px;
        }
        .doc-cover {
          background: linear-gradient(135deg, #f97316, #fb923c, #fbbf24);
          padding: 28px 28px 24px;
          position: relative;
          overflow: hidden;
        }
        .doc-cover::after {
          content: '';
          position: absolute;
          bottom: -20px;
          right: -20px;
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: rgba(255,255,255,.1);
        }
        .doc-tag {
          font-size: 9px;
          font-weight: 700;
          color: rgba(255,255,255,.75);
          text-transform: uppercase;
          letter-spacing: .08em;
          margin-bottom: 6px;
        }
        .doc-title {
          font-size: 20px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -.3px;
          margin-bottom: 4px;
          line-height: 1.3;
        }
        .doc-subtitle {
          font-size: 12px;
          font-weight: 500;
          color: rgba(255,255,255,.88);
          margin-bottom: 7px;
        }
        .doc-sub {
          font-size: 11px;
          color: rgba(255,255,255,.8);
        }
        .doc-byline {
          font-size: 10.5px;
          color: rgba(255,255,255,.78);
          margin-top: 12px;
        }
        .doc-logo {
          width: 52px;
          height: 52px;
          object-fit: contain;
          background: rgba(255,255,255,.92);
          border-radius: 10px;
          padding: 8px;
          margin-bottom: 11px;
        }
        .doc-section {
          border-bottom: 1px solid #f0f0ee;
          padding: 18px 24px;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .ai-generated-section p {
          margin: 0;
          font-size: 11.5px;
          color: #525252;
          line-height: 1.6;
        }
        .doc-section:last-child {
          border-bottom: none;
        }
        .doc-section.drag-over {
          border-top: 2px solid #f97316;
          background: #fff7ed;
        }
        .ds-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }
        .ds-icon {
          width: 28px;
          height: 28px;
          border-radius: 7px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          flex-shrink: 0;
        }
        .ds-icon.data { background: #dcfce7; color: #166534; }
        .ds-icon.desc { background: #eff6ff; color: #1d4ed8; }
        .ds-icon.model { background: #fff7ed; color: #c2410c; }
        .ds-icon.whatif { background: #f5f3ff; color: #7c3aed; }
        .ds-title {
          font-size: 13px;
          font-weight: 700;
          color: #1a1a1a;
        }
        .ds-badge {
          font-size: 9px;
          font-weight: 600;
          padding: 2px 7px;
          border-radius: 10px;
        }
        .section-description-wrap {
          position: relative;
          margin: -3px 0 12px 36px;
        }
        .section-description-input {
          width: 100%;
          min-height: 42px;
          resize: vertical;
          border: 1px solid transparent;
          border-radius: 8px;
          padding: 7px 74px 7px 9px;
          background: #fafafa;
          color: #525252;
          font: inherit;
          font-size: 11.5px;
          line-height: 1.5;
          box-sizing: border-box;
          outline: none;
          transition: border-color .15s ease, background .15s ease;
        }
        .section-description-input:hover,
        .section-description-input:focus {
          border-color: #fed7aa;
          background: #fff;
        }
        .section-description-input::placeholder {
          color: #a3a3a3;
        }
        .section-description-tools {
          position: absolute;
          top: 6px;
          right: 6px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .section-ai-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          height: 26px;
          padding: 0 8px;
          border: 1px solid #fed7aa;
          border-radius: 999px;
          background: #fff7ed;
          color: #ea580c;
          font-size: 10px;
          font-weight: 750;
          cursor: pointer;
        }
        .section-ai-btn:hover {
          background: #ffedd5;
          border-color: #fb923c;
        }
        .section-description-export {
          margin: -2px 0 12px 36px;
          color: #525252;
          font-size: 11.5px;
          line-height: 1.55;
        }
        .change-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .change-item {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px 10px;
          background: #f8f8f7;
          border-radius: 7px;
        }
        .ci-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #166534;
          margin-top: 4px;
          flex-shrink: 0;
        }
        .ci-text {
          font-size: 11px;
          color: #1a1a1a;
          line-height: 1.4;
        }
        .ci-stat {
          font-size: 10px;
          color: #a0a0a0;
          margin-top: 1px;
        }
        .chart-preview {
          background: #f8f8f7;
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 8px;
        }
        .chart-mock {
          height: 120px;
          border-radius: 6px;
          background: linear-gradient(to top, #fff7ed 0%, #f0f0ee 100%);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          gap: 8px;
          padding: 10px;
          overflow: hidden;
        }
        .report-chart-canvas {
          display: block;
          position: relative;
          width: 100%;
          height: 280px;
          padding: 12px 14px;
          background: #fff;
        }
        .report-chart-canvas canvas {
          width: 100% !important;
          height: 100% !important;
        }
        .bar-mock {
          border-radius: 3px 3px 0 0;
          background: #f97316;
          opacity: .8;
          flex: 1;
        }
        .chart-cap {
          font-size: 10px;
          color: #a0a0a0;
          margin-top: 5px;
          text-align: center;
        }
        .model-table, .wi-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
          margin-top: 6px;
        }
        .model-table th, .wi-table th {
          padding: 7px 10px;
          text-align: left;
          font-size: 10px;
          font-weight: 600;
          color: #a0a0a0;
          text-transform: uppercase;
          letter-spacing: .05em;
          border-bottom: 1px solid #e5e5e3;
        }
        .model-table td, .wi-table td {
          padding: 8px 10px;
          border-bottom: 1px solid #f0f0ee;
        }
        .model-table tr:last-child td, .wi-table tr:last-child td {
          border-bottom: none;
        }
        .acc-bar {
          display: flex;
          align-items: center;
          gap: 7px;
        }
        .acc-track {
          flex: 1;
          height: 4px;
          background: #f0f0ee;
          border-radius: 2px;
          overflow: hidden;
        }
        .acc-fill {
          height: 100%;
          background: #f97316;
          border-radius: 2px;
        }
        .best-badge {
          font-size: 9px;
          font-weight: 600;
          padding: 1px 6px;
          border-radius: 8px;
          background: #dcfce7;
          color: #166534;
        }
        .wi-result {
          font-weight: 600;
          color: #c2410c;
        }
        .corr-list {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .corr-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .corr-pair {
          font-size: 11px;
          color: #1a1a1a;
          min-width: 200px;
        }
        .corr-bar-wrap {
          flex: 1;
          height: 4px;
          background: #f0f0ee;
          border-radius: 2px;
          overflow: hidden;
        }
        .corr-bar {
          height: 100%;
          border-radius: 2px;
        }
        .corr-val {
          font-size: 11px;
          font-weight: 600;
          min-width: 40px;
          text-align: right;
        }
        .right-panel {
          border-left: 1px solid #e5e5e3;
          background: #fff;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          height: 100%;
        }
        .rh {
          padding: 14px 14px 10px;
          border-bottom: 1px solid #e5e5e3;
          flex-shrink: 0;
        }
        .rh-title {
          font-size: 13px;
          font-weight: 600;
          color: #1a1a1a;
          margin-bottom: 2px;
        }
        .rh-count {
          font-size: 11px;
          color: #a0a0a0;
        }
        .right-scroll {
          overflow-y: auto;
          overscroll-behavior: contain;
          flex: 1;
          min-height: 0;
          padding: 10px 14px;
        }
        .right-scroll::-webkit-scrollbar {
          width: 3px;
        }
        .right-scroll::-webkit-scrollbar-thumb {
          background: #e5e5e3;
          border-radius: 2px;
        }
        .oi {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 7px 9px;
          border-radius: 7px;
          margin-bottom: 3px;
          cursor: grab;
          border: 1px solid transparent;
          transition: all .15s;
          background: #fff;
        }
        .oi:hover {
          background: #f8f8f7;
          border-color: #e5e5e3;
        }
        .oi:active {
          cursor: grabbing;
        }
        .oi.drag-over {
          border-top: 2px solid #f97316;
          background: #fff7ed;
        }
        .oi-drag {
          font-size: 13px;
          color: #a0a0a0;
          flex-shrink: 0;
          display: flex;
          align-items: center;
        }
        .oi-text {
          flex: 1;
          font-size: 11px;
          font-weight: 500;
          color: #1a1a1a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .oi-src {
          font-size: 9px;
          font-weight: 600;
          padding: 1px 5px;
          border-radius: 7px;
          flex-shrink: 0;
        }
        .sb-data { background: #eff6ff; color: #1d4ed8; }
        .sb-desc { background: #f0fdf4; color: #15803d; }
        .sb-model { background: #fff7ed; color: #c2410c; }
        .sb-whatif { background: #f5f3ff; color: #7c3aed; }
        .sb-ai { background: #eff6ff; color: #2563eb; }
        
        .right-settings {
          padding: 10px 14px;
          border-top: 1px solid #e5e5e3;
          flex-shrink: 0;
          background: #fff;
        }
        .theme-options {
          display: grid;
          gap: 5px;
          margin-bottom: 12px;
        }
        .theme-option {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 6px 8px;
          border: 1px solid #e5e5e3;
          border-radius: 7px;
          color: #6b6b6b;
          font-size: 11px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .theme-option:hover {
          background: #f8f8f7;
        }
        .theme-option.active {
          border-color: #fed7aa;
          background: #fff7ed;
          color: #c2410c;
          font-weight: 650;
        }
        .theme-option input {
          accent-color: #f97316;
          width: 13px;
          height: 13px;
        }
        .rs-title {
          font-size: 10px;
          font-weight: 700;
          color: #a0a0a0;
          text-transform: uppercase;
          letter-spacing: .06em;
          margin-bottom: 8px;
        }
        .rs-item {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 4px 0;
          font-size: 11px;
          color: #6b6b6b;
          cursor: pointer;
        }
        .rs-item input {
          accent-color: #f97316;
          width: 13px;
          height: 13px;
        }
        .empty-preview {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 12px;
          text-align: center;
          padding: 40px;
        }
        .ep-icon {
          font-size: 40px;
          color: #e5e5e3;
          margin-bottom: 8px;
        }
        .ep-title {
          font-size: 14px;
          font-weight: 600;
          color: #6b6b6b;
        }
        .ep-sub {
          font-size: 12px;
          color: #a0a0a0;
          max-width: 280px;
          line-height: 1.5;
        }
        .gen-btn {
          width: 100%;
          padding: 11px;
          background: #f97316;
          color: #fff;
          border: none;
          border-radius: 9px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          transition: background .15s;
        }
        .gen-btn:hover {
          background: #ea6c0a;
        }
        .gen-btn:disabled {
          background: #e5e5e3;
          cursor: not-allowed;
        }
        .export-row {
          display: flex;
          gap: 5px;
        }
        .exp-btn {
          flex: 1;
          padding: 7px;
          background: none;
          border: 1px solid #e5e5e3;
          border-radius: 7px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          color: #6b6b6b;
          font-family: inherit;
          transition: all .15s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }
        .exp-btn:hover:not(:disabled) {
          background: #f8f8f7;
          color: #1a1a1a;
          border-color: #a0a0a0;
        }
        .exp-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .report-loading-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(255, 255, 255, 0.95);
          z-index: 100;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 24px;
          backdrop-filter: blur(2px);
        }
        .loading-box {
          background: white;
          border: 1px solid #e5e5e3;
          padding: 24px;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
          width: 320px;
          text-align: center;
        }
        .loading-title {
          font-size: 14px;
          font-weight: 600;
          color: #1a1a1a;
          margin-bottom: 12px;
        }
        .loading-bar-container {
          height: 6px;
          background: #f0f0ee;
          border-radius: 3px;
          overflow: hidden;
          margin-bottom: 12px;
        }
        .loading-bar-fill {
          height: 100%;
          background: #f97316;
          transition: width 0.3s ease;
        }
        .loading-step-text {
          font-size: 11px;
          color: #6b6b6b;
          font-style: italic;
        }
        .highlight-effect {
          animation: pickerHighlight 1.5s ease-out;
        }
        @keyframes pickerHighlight {
          0% {
            background: #ffedd5;
            border-color: #f97316;
          }
          100% {
            background: transparent;
            border-color: transparent;
          }
        }
        .hover-drag:hover .drag-handle-preview {
          opacity: 1 !important;
        }
        .drag-handle-preview {
          position: absolute;
          left: -20px;
          top: 50%;
          transform: translateY(-50%);
          opacity: 0;
          transition: opacity 0.2s ease;
          cursor: grab;
          padding: 4px;
          color: #a0a0a0;
        }
        .drag-handle-preview:hover {
          color: #f97316;
        }
        .ci-thumb {
          width: 40px;
          height: 30px;
          border-radius: 4px;
          flex-shrink: 0;
          margin-right: 4px;
        }
      `}</style>

      {/* Copy Link Toast Alert */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#1e293b',
          color: '#fff',
          padding: '10px 16px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 500,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 3000,
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <CheckCircle2 size={15} strokeWidth={1.9} style={{ color: '#22c55e' }} />
          {toastMessage}
        </div>
      )}

      {/* LEFT PANEL — CONTENT PICKER */}
      <div id="report-builder-panel" className="left-panel">
        <div className="lh">
          <div className="lh-title">Build your report</div>
          <div className="lh-sub">Choose what to include from your project</div>
          <div className="lh-actions">
            <button type="button" className="sel-link" onClick={handleSelectAll}>Select all</button>
            <span style={{ color: '#e5e5e3' }}>·</span>
            <button type="button" className="sel-link" onClick={handleDeselectAll}>Deselect all</button>
          </div>
        </div>

        <div className="left-scroll" id="picker">
          {loadingData ? (
            <p style={{ fontSize: 12, color: '#6b6b6b', padding: '10px 0' }}>Loading project components...</p>
          ) : (
            <>
              {/* GROUP: Data Preparation */}
              <div className="cgroup" id="picker-group-data_prep">
                <div className="cg-header">
                  <div className="cg-title">
                    <Database {...smallIconProps} />
                    Data Preparation
                    <span className={`cg-badge ${checkedDataPrep.length > 0 ? 'active' : ''}`}>
                      {checkedDataPrep.length}/{dataPrepItems.length}
                    </span>
                  </div>
                </div>
                <div className="cg-body">
                  {dataPrepItems.length === 0 ? (
                    <div className="cg-empty">
                      <span>No logs recorded</span>
                      <Link to={`/projects/${dataset.id}/data`} className="goto-link">Go to Data <ArrowRight size={10} /></Link>
                    </div>
                  ) : (
                    dataPrepItems.map((item) => {
                      const itemId = `dataprep-${item.id}`
                      const isChecked = checkedIds.includes(itemId)
                      return (
                        <label key={item.id} className={`citem ${isChecked ? 'checked' : ''} ${isHighlighted('data_prep') ? 'highlight-effect' : ''}`}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleItem(itemId, 'data_prep', 'Data Preparation', 'Data')}
                          />
                          <div className="ci-content">
                            <div className="ci-title">{item.summary}</div>
                            <div className="ci-meta">
                              {item.detail?.column || item.detail?.columns?.join(', ') || 'Dataset transform'}
                              {item.detail?.method ? ` · ${item.detail.method}` : ''}
                            </div>
                          </div>
                        </label>
                      )
                    })
                  )}
                </div>
              </div>

              {/* GROUP: Visualizations */}
              <div id="report-viz-section" className="cgroup">
                <div className="cg-header">
                  <div className="cg-title">
                    <BarChart3 {...smallIconProps} />
                    Visualizations
                    <span className={`cg-badge ${checkedCharts.length > 0 ? 'active' : ''}`}>
                      {checkedCharts.length}/{savedCharts.length}
                    </span>
                  </div>
                </div>
                <div className="cg-body">
                  {savedCharts.length === 0 ? (
                    <div className="cg-empty">
                      <span>No charts saved</span>
                      <Link to={`/projects/${dataset.id}/describe`} className="goto-link">Go to Describe <ArrowRight size={10} /></Link>
                    </div>
                  ) : (
                    savedCharts.map((chart) => {
                      const itemId = `viz-${chart.id}`
                      const isChecked = checkedIds.includes(itemId)
                      return (
                        <label
                          key={chart.id}
                          id={`picker-item-${itemId}`}
                          className={`citem ${isChecked ? 'checked' : ''} ${isHighlighted(itemId) ? 'highlight-effect' : ''}`}
                          style={{ display: 'flex', alignItems: 'center' }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleItem(itemId, 'chart', chart.title, 'Desc', chart)}
                          />
                          <ChartMiniThumbnail type={chart.type} />
                          <div className="ci-content">
                            <div className="ci-title" style={{ fontSize: '11px', fontWeight: 500 }}>{chart.title}</div>
                            <div className="ci-meta" style={{ fontSize: '10px' }}>{chart.xAxis} vs {chart.yAxis || 'Count'}</div>
                          </div>
                        </label>
                      )
                    })
                  )}
                </div>
              </div>

              {/* GROUP: Correlations */}
              <div className="cgroup" id="picker-group-correlations">
                <div className="cg-header">
                  <div className="cg-title">
                    <Variable {...smallIconProps} />
                    Correlation Findings
                    <span className={`cg-badge ${checkedCorrelations.length > 0 ? 'active' : ''}`}>
                      {checkedCorrelations.length}/{Math.min(3, correlationPairs.length)}
                    </span>
                  </div>
                </div>
                <div className="cg-body">
                  {correlationPairs.length === 0 ? (
                    <div className="cg-empty">
                      <span>No correlation runs</span>
                      <Link to={`/projects/${dataset.id}/describe`} className="goto-link">Go to Describe <ArrowRight size={10} /></Link>
                    </div>
                  ) : (
                    correlationPairs.slice(0, 3).map((pair, idx) => {
                      const itemId = `corr-${idx}`
                      const isChecked = checkedIds.includes(itemId)
                      return (
                        <label key={idx} className={`citem ${isChecked ? 'checked' : ''} ${isHighlighted('correlations') ? 'highlight-effect' : ''}`}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleItem(itemId, 'correlations', 'Key Correlations', 'Desc')}
                          />
                          <div className="ci-content">
                            <div className="ci-title">{pair.var_a} ↔ {pair.var_b}</div>
                            <div className="ci-meta">r = {pair.r >= 0 ? '' : '−'}{Math.abs(pair.r).toFixed(3)} · {Math.abs(pair.r) >= 0.7 ? 'Strong positive' : Math.abs(pair.r) >= 0.4 ? 'Moderate' : 'Weak'}</div>
                          </div>
                        </label>
                      )
                    })
                  )}
                </div>
              </div>

              {/* GROUP: Models */}
              <div id="report-models-section" className="cgroup">
                <div className="cg-header">
                  <div className="cg-title">
                    <Brain {...smallIconProps} />
                    Model Results
                    <span className={`cg-badge ${checkedModels.length > 0 ? 'active' : ''}`}>
                      {checkedModels.length}/{models.length}
                    </span>
                  </div>
                </div>
                <div className="cg-body">
                  {models.length === 0 ? (
                    <div className="cg-empty">
                      <span>No models trained</span>
                      <Link to={`/projects/${dataset.id}/models`} className="goto-link">Go to Models <ArrowRight size={10} /></Link>
                    </div>
                  ) : (
                    models.map((model) => {
                      const itemId = `model-${model.id}`
                      const isChecked = checkedIds.includes(itemId)
                      const accuracy = model.metrics?.accuracy
                      const r2 = model.metrics?.r2
                      const metricLabel = accuracy !== undefined
                        ? `Accuracy ${(accuracy * 100).toFixed(1)}%`
                        : r2 !== undefined
                        ? `R² ${r2.toFixed(3)}`
                        : 'Model trained'
                      return (
                        <label
                          key={model.id}
                          id={`picker-item-${itemId}`}
                          className={`citem ${isChecked ? 'checked' : ''} ${isHighlighted(itemId) ? 'highlight-effect' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleItem(itemId, 'model', `${model.algorithm} results`, 'Model', model)}
                          />
                          <div className="ci-content">
                            <div className="ci-title">{model.algorithm}</div>
                            <div className="ci-meta">{metricLabel} · target: {model.target}</div>
                          </div>
                        </label>
                      )
                    })
                  )}
                </div>
              </div>

              {/* GROUP: What-if */}
              <div id="report-whatif-section" className="cgroup">
                <div className="cg-header">
                  <div className="cg-title">
                    <Shuffle {...smallIconProps} />
                    What-if Scenarios
                    <span className={`cg-badge ${checkedScenarios.length > 0 ? 'active' : ''}`}>
                      {checkedScenarios.length}/{scenarioItems.length}
                    </span>
                  </div>
                </div>
                <div className="cg-body">
                  {scenarioItems.length === 0 ? (
                    <div className="cg-empty">
                      <span>No scenarios saved</span>
                      <Link to={`/projects/${dataset.id}/whatif`} className="goto-link">Go to What-if <ArrowRight size={10} /></Link>
                    </div>
                  ) : (
                    scenarioItems.map((sc) => {
                      const itemId = `whatif-${sc.id}`
                      const isChecked = checkedIds.includes(itemId)
                      const inputs = sc.detail?.inputs || {}
                      const pred = sc.detail?.prediction || {}
                      const inputsStr = Object.entries(inputs).slice(0, 2).map(([k, v]) => `${k}=${v}`).join(', ')
                      const isProb = pred.kind === 'probability'
                      const predLabel = isProb
                        ? `→ ${pred.predicted_class || pred.positive_class || ''} (${Math.round(pred.prediction * 100)}%)`
                        : `→ ${pred.prediction?.toFixed(3) ?? ''}`
                      return (
                        <label
                          key={sc.id}
                          id={`picker-item-${itemId}`}
                          className={`citem ${isChecked ? 'checked' : ''} ${isHighlighted(itemId) ? 'highlight-effect' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleItem(itemId, 'scenario', `What-if: ${sc.detail?.scenario_name || sc.summary}`, 'W-if', sc)}
                          />
                          <div className="ci-content">
                            <div className="ci-title">{sc.detail?.scenario_name || sc.summary}</div>
                            <div className="ci-meta" style={{ fontFamily: 'monospace', fontSize: '9px' }}>
                              {inputsStr} {predLabel}
                            </div>
                          </div>
                        </label>
                      )
                    })
                  )}
                </div>
              </div>

              {/* GROUP: AI Interpretations */}
              <div className="cgroup" id="picker-group-ai">
                <div className="cg-header">
                  <div className="cg-title">
                    <Sparkles {...smallIconProps} />
                    AI Interpretations
                    <span className="cg-badge active">
                      {['ai-prep', 'ai-model', 'ai-feature'].filter((id) => checkedIds.includes(id)).length}/3
                    </span>
                  </div>
                </div>
                <div className="cg-body">
                  <label className={`citem ${checkedIds.includes('ai-prep') ? 'checked' : ''} ${isHighlighted('ai') ? 'highlight-effect' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checkedIds.includes('ai-prep')}
                      onChange={() => toggleItem('ai-prep', 'ai', 'AI Interpretation', 'AI')}
                    />
                    <div className="ci-content">
                      <div className="ci-title">Data preparation summary</div>
                      <div className="ci-meta">AI-generated data preprocessing log</div>
                    </div>
                  </label>
                  <label className={`citem ${checkedIds.includes('ai-model') ? 'checked' : ''} ${isHighlighted('ai') ? 'highlight-effect' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checkedIds.includes('ai-model')}
                      onChange={() => toggleItem('ai-model', 'ai', 'AI Interpretation', 'AI')}
                    />
                    <div className="ci-content">
                      <div className="ci-title">Model interpretation</div>
                      <div className="ci-meta">AI summary of comparative model strength</div>
                    </div>
                  </label>
                  <label className={`citem ${checkedIds.includes('ai-feature') ? 'checked' : ''} ${isHighlighted('ai') ? 'highlight-effect' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checkedIds.includes('ai-feature')}
                      onChange={() => toggleItem('ai-feature', 'ai', 'AI Interpretation', 'AI')}
                    />
                    <div className="ci-content">
                      <div className="ci-title">Feature importance explanation</div>
                      <div className="ci-meta">Stakeholder description of leading factors</div>
                    </div>
                  </label>
                </div>
              </div>
            </>
          )}
        </div>

      </div>

      {/* CENTER — LIVE PREVIEW */}
      <div className="center-panel">
        <div className="preview-header">
          <div>
            <span className="ph-title">Report preview</span>
            <span className="ph-meta" style={{ marginLeft: 8 }}>Updates instantly as you select content</span>
          </div>
          <span className="ph-count" id="section-count">{totalSectionsCount} sections included</span>
        </div>

        <div className="report-toolbar">
          <div className="rt-left">
            <Link className="rt-back" to={`/projects/${dataset.id}/data`}>Back</Link>
            <div className="rt-title">Report Builder</div>
            <div className="rt-actions">
              <button
                id="report-export-btn"
                type="button"
                className={`rt-btn ${activeToolbar === 'theme' ? 'active' : ''}`}
                onClick={() => setActiveToolbar(activeToolbar === 'theme' ? null : 'theme')}
              >
                <Palette {...smallIconProps} /> Theme
              </button>
              <button
                type="button"
                className={`rt-btn ${activeToolbar === 'cover' ? 'active' : ''}`}
                onClick={() => setActiveToolbar(activeToolbar === 'cover' ? null : 'cover')}
              >
                <FileText {...smallIconProps} /> Cover
              </button>
              <button
                type="button"
                className={`rt-btn ${activeToolbar === 'layout' ? 'active' : ''}`}
                onClick={() => setActiveToolbar(activeToolbar === 'layout' ? null : 'layout')}
              >
                <LayoutTemplate {...smallIconProps} /> Layout
              </button>
              <button
                type="button"
                className={`rt-btn ${activeToolbar === 'settings' ? 'active' : ''}`}
                onClick={() => setActiveToolbar(activeToolbar === 'settings' ? null : 'settings')}
              >
                <Info {...smallIconProps} /> Settings
              </button>
              <button
                type="button"
                className={`rt-btn ${activeToolbar === 'ai' ? 'active' : ''}`}
                onClick={() => setActiveToolbar(activeToolbar === 'ai' ? null : 'ai')}
              >
                <Sparkles {...smallIconProps} /> AI Tools
              </button>
              <button
                type="button"
                className={`rt-btn ${pageView ? 'active' : ''}`}
                onClick={() => updateToolbarSetting(setPageView, !pageView)}
              >
                <Eye {...smallIconProps} /> Page View
              </button>
              <button type="button" className="rt-btn icon-only" title="Reset report design" onClick={resetReportDesign}>
                <RotateCcw {...smallIconProps} />
              </button>
            </div>
          </div>
          <div className="rt-right">
            <button type="button" className="rt-btn" onClick={saveDraft}>
              <Save {...smallIconProps} /> Save Draft
            </button>
            <button
              type="button"
              className="rt-btn rt-primary"
              onClick={() => setExportMenuOpen((open) => !open)}
              disabled={totalSectionsCount === 0}
            >
              <FileDown {...smallIconProps} /> {exportingPdf ? 'Exporting...' : 'Export'} <ChevronDown {...smallIconProps} />
            </button>
            {exportMenuOpen && (
              <div className="export-dropdown">
                <button
                  type="button"
                  className="export-option"
                  onClick={() => { setExportMenuOpen(false); exportPdf() }}
                  disabled={exportingPdf}
                >
                  <FileDown {...smallIconProps} /> PDF
                </button>
                <button
                  type="button"
                  className="export-option"
                  onClick={() => { setExportMenuOpen(false); exportHtml() }}
                >
                  <FileText {...smallIconProps} /> HTML
                </button>
                <button
                  type="button"
                  className="export-option"
                  onClick={() => { setExportMenuOpen(false); printReport() }}
                >
                  <Printer {...smallIconProps} /> Print
                </button>
                <button
                  type="button"
                  className="export-option"
                  onClick={() => { setExportMenuOpen(false); copyLink() }}
                >
                  <LinkIcon {...smallIconProps} /> Share Link
                </button>
              </div>
            )}
          </div>

          {activeToolbar === 'theme' && (
            <div className="rt-popover">
              <div className="rt-section-title">Report theme</div>
              <div className="rt-grid">
                {REPORT_THEMES.map((theme) => (
                  <label key={theme.id} className={`rt-option ${reportTheme === theme.id ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="toolbar-report-theme"
                      checked={reportTheme === theme.id}
                      onChange={() => updateToolbarSetting(setReportTheme, theme.id)}
                    />
                    {theme.label}
                  </label>
                ))}
              </div>
              <div className="rt-note">Theme changes only the report styling; selected content and outline order stay the same.</div>
            </div>
          )}

          {activeToolbar === 'cover' && (
            <div className="rt-popover wide">
              <div className="rt-section-title">Cover details</div>
              <label className="rt-field">
                <span>Report Title</span>
                <input value={coverTitle} onChange={(e) => updateToolbarSetting(setCoverTitle, e.target.value)} placeholder={defaultCoverTitle} />
              </label>
              <label className="rt-field">
                <span>Subtitle</span>
                <input value={coverSubtitle} onChange={(e) => updateToolbarSetting(setCoverSubtitle, e.target.value)} placeholder="Optional subtitle" />
              </label>
              <div className="rt-grid">
                <label className="rt-field">
                  <span>Author</span>
                  <input value={coverAuthor} onChange={(e) => updateToolbarSetting(setCoverAuthor, e.target.value)} placeholder="Author name" />
                </label>
                <label className="rt-field">
                  <span>Institution</span>
                  <input value={coverInstitution} onChange={(e) => updateToolbarSetting(setCoverInstitution, e.target.value)} placeholder="School or organization" />
                </label>
              </div>
              <label className="rt-field">
                <span>Logo URL</span>
                <input value={coverLogo} onChange={(e) => updateToolbarSetting(setCoverLogo, e.target.value)} placeholder="https://..." />
              </label>
            </div>
          )}

          {activeToolbar === 'layout' && (
            <div className="rt-popover">
              <div className="rt-section-title">Layout</div>
              <div className="rt-grid" style={{ marginBottom: 10 }}>
                {['portrait', 'landscape'].map((mode) => (
                  <label key={mode} className={`rt-option ${layoutOrientation === mode ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="layout-orientation"
                      checked={layoutOrientation === mode}
                      onChange={() => updateToolbarSetting(setLayoutOrientation, mode)}
                    />
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </label>
                ))}
                {['letter', 'a4'].map((size) => (
                  <label key={size} className={`rt-option ${pageSize === size ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="page-size"
                      checked={pageSize === size}
                      onChange={() => updateToolbarSetting(setPageSize, size)}
                    />
                    {size.toUpperCase()}
                  </label>
                ))}
              </div>
              <label className="rt-check">
                <input
                  type="checkbox"
                  checked={!comfortableLayout}
                  onChange={(e) => updateToolbarSetting(setComfortableLayout, !e.target.checked)}
                />
                Compact layout
              </label>
            </div>
          )}

          {activeToolbar === 'settings' && (
            <div className="rt-popover">
              <div className="rt-section-title">Report settings</div>
              <label className="rt-check">
                <input
                  type="checkbox"
                  checked={includePageNumbers}
                  onChange={(e) => updateToolbarSetting(setIncludePageNumbers, e.target.checked)}
                />
                Include page numbers
              </label>
              <label className="rt-check" style={{ marginTop: 7 }}>
                <input
                  type="checkbox"
                  checked={includeTimestamps}
                  onChange={(e) => updateToolbarSetting(setIncludeTimestamps, e.target.checked)}
                />
                Include timestamps
              </label>
              <label className="rt-check" style={{ marginTop: 7 }}>
                <input
                  type="checkbox"
                  checked={includeRawData}
                  onChange={(e) => updateToolbarSetting(setIncludeRawData, e.target.checked)}
                />
                Include raw data table
              </label>
              <label className="rt-check" style={{ marginTop: 7 }}>
                <input
                  type="checkbox"
                  checked={includeMethodology}
                  onChange={(e) => updateToolbarSetting(setIncludeMethodology, e.target.checked)}
                />
                Include methodology notes
              </label>
            </div>
          )}

          {activeToolbar === 'ai' && (
            <div className="rt-popover">
              <div className="rt-section-title">AI report tools</div>
              <label className="rt-check">
                <input
                  type="checkbox"
                  checked={includeExecutiveSummary}
                  onChange={(e) => updateToolbarSetting(setIncludeExecutiveSummary, e.target.checked)}
                />
                Generate Executive Summary
              </label>
              <label className="rt-check" style={{ marginTop: 7 }}>
                <input
                  type="checkbox"
                  checked={includeRecommendations}
                  onChange={(e) => updateToolbarSetting(setIncludeRecommendations, e.target.checked)}
                />
                Generate Recommendations
              </label>
              <label className="rt-check" style={{ marginTop: 7 }}>
                <input
                  type="checkbox"
                  checked={polishedWording}
                  onChange={(e) => updateToolbarSetting(setPolishedWording, e.target.checked)}
                />
                Improve wording
              </label>
              <div className="rt-section-title" style={{ marginTop: 12 }}>Style controls</div>
              <div className="rt-grid">
                <label className="rt-check">
                  <input type="checkbox" checked={showIcons} onChange={(e) => updateToolbarSetting(setShowIcons, e.target.checked)} />
                  Icons
                </label>
                <label className="rt-check">
                  <input type="checkbox" checked={showSectionNumbers} onChange={(e) => updateToolbarSetting(setShowSectionNumbers, e.target.checked)} />
                  Section Numbers
                </label>
                <label className="rt-check">
                  <input type="checkbox" checked={coloredHeaders} onChange={(e) => updateToolbarSetting(setColoredHeaders, e.target.checked)} />
                  Colored Headers
                </label>
                <label className="rt-check">
                  <input type="checkbox" checked={!comfortableLayout} onChange={(e) => updateToolbarSetting(setComfortableLayout, !e.target.checked)} />
                  Compact Layout
                </label>
              </div>
            </div>
          )}
        </div>

        {/* simulated loading overlay */}
        {generatingState !== 'idle' && (
          <div className="report-loading-overlay">
            <div className="loading-box">
              <div className="loading-title">
                {generatingState === 'building' && 'Building your report...'}
                {generatingState === 'compiling' && 'Compiling model results...'}
                {generatingState === 'adding' && 'Adding visualizations...'}
                {generatingState === 'done' && 'Done. Formatting report...'}
              </div>
              <div className="loading-bar-container">
                <div
                  className="loading-bar-fill"
                  style={{
                    width:
                      generatingState === 'building'
                        ? '25%'
                        : generatingState === 'compiling'
                        ? '60%'
                        : generatingState === 'adding'
                        ? '90%'
                        : '100%',
                  }}
                ></div>
              </div>
              <span className="loading-step-text">SimuCast compiler active</span>
            </div>
          </div>
        )}

        <div className="preview-scroll">
          {totalSectionsCount === 0 ? (
            <div className="empty-preview">
              <FileText className="ep-icon" size={40} strokeWidth={1.4} />
              <div className="ep-title">Build your report</div>
              <div className="ep-sub">Check items on the left side to compile your custom structured report.</div>
            </div>
          ) : (
            <div className={reportDocClasses} id="report-doc">
              {/* Cover Page */}
              <div className="doc-cover">
                {resolvedCoverLogo && <img className="doc-logo" src={resolvedCoverLogo} alt="" />}
                <div className="doc-tag">SimuCast Auto-report</div>
                <div className="doc-title">{resolvedCoverTitle}</div>
                {resolvedCoverSubtitle && <div className="doc-subtitle">{resolvedCoverSubtitle}</div>}
                <div className="doc-sub">
                  {dataset.filename || 'dataset.csv'} · {dataset.row_count || 0} rows ·{' '}
                  {includeTimestamps && `Generated ${new Date().toLocaleDateString()}`}
                </div>
                {(resolvedCoverAuthor || resolvedCoverInstitution) && (
                  <div className="doc-byline">
                    {resolvedCoverAuthor}
                    {resolvedCoverAuthor && resolvedCoverInstitution ? ' - ' : ''}
                    {resolvedCoverInstitution}
                  </div>
                )}
              </div>

              {includeExecutiveSummary && (
                <div className="doc-section ai-generated-section">
                  <div className="ds-header">
                    <div className="ds-icon" style={{ background: '#fff7ed', color: '#c2410c' }}>
                      <Sparkles {...iconProps} />
                    </div>
                    <span className="ds-title">Executive Summary</span>
                  </div>
                  <p>
                    {polishedWording
                      ? `This report synthesizes the selected preparation steps, visual findings, statistical relationships, and model results for ${dataset.filename || dataset.name || 'the active dataset'}. The included sections are arranged to support a thesis-style review of data quality, empirical patterns, predictive performance, and practical interpretation.`
                      : `This report summarizes the selected data preparation, charts, correlations, model results, and interpretations for ${dataset.filename || dataset.name || 'the active dataset'}.`}
                  </p>
                </div>
              )}

              {/* Dynamic sections mapped in Outline Order */}
              <div id="report-doc-sections">
                {outline.map((section, idx) => {
                  const isOver = dragOverId === section.id
                  return (
                    <div
                      key={section.id}
                      className={`doc-section hover-drag ${isOver ? 'drag-over' : ''}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, idx)}
                      onDragOver={(e) => handleDragOver(e, section.id)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, idx)}
                      style={{ position: 'relative' }}
                    >
                      {/* Drag handles for sections */}
                      <div className="drag-handle-preview" title="Drag to reorder section">
                        <GripVertical size={15} strokeWidth={1.8} />
                      </div>

                      {/* Header block */}
                      <div className="doc-section-content" onClick={() => highlightPickerItem(section.id)}>
                        {section.type === 'data_prep' && (
                          <>
                            <div className="ds-header">
                              <div className="ds-icon data"><Database {...iconProps} /></div>
                              <span className="ds-title">Data Preparation</span>
                              <span className="ds-badge sb-data" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
                                {checkedDataPrep.length} changes
                              </span>
                            </div>
                            {renderSectionDescription(section)}
                            <div className="change-list">
                              {checkedDataPrep.map((change) => (
                                <div key={change.id} className="change-item">
                                  <div className="ci-dot"></div>
                                  <div className="ci-content">
                                    <div className="ci-text">{change.summary}</div>
                                    <div className="ci-stat">
                                      {change.detail?.column || change.detail?.columns?.join(', ') || 'Dataset operations'}
                                      {includeTimestamps && change.created_at && ` · ${new Date(change.created_at).toLocaleTimeString()}`}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        )}

                        {section.type === 'chart' && (
                          <>
                            <div className="ds-header">
                              <div className="ds-icon desc"><BarChart3 {...iconProps} /></div>
                              <span className="ds-title">{section.title}</span>
                              <span className="ds-badge sb-desc" style={{ background: '#f0fdf4', color: '#15803d' }}>Visualization</span>
                            </div>
                            {renderSectionDescription(section)}
                            <PreviewMockupChart chart={section.data} rows={datasetRows} corrResult={corrResult} />
                          </>
                        )}

                        {section.type === 'correlations' && (
                          <>
                            <div className="ds-header">
                              <div className="ds-icon desc"><Variable {...iconProps} /></div>
                              <span className="ds-title">Key Correlations</span>
                            </div>
                            {renderSectionDescription(section)}
                            <div className="corr-list">
                              {checkedCorrelations.map((pair, pIdx) => (
                                <div className="corr-row" key={pIdx}>
                                  <div className="corr-pair">{pair.var_a} ↔ {pair.var_b}</div>
                                  <div className="corr-bar-wrap">
                                    <div
                                      className="corr-bar"
                                      style={{
                                        width: `${Math.abs(pair.r) * 100}%`,
                                        background: pair.r >= 0 ? '#f97316' : '#3b82f6',
                                      }}
                                    ></div>
                                  </div>
                                  <div className="corr-val" style={{ color: pair.r >= 0 ? '#c2410c' : '#1d4ed8' }}>
                                    {pair.r >= 0 ? '' : '−'}{Math.abs(pair.r).toFixed(3)}
                                  </div>
                                </div>
                              ))}
                            </div>
                            {checkedCorrelations.some((p) => Math.abs(p.r) >= 0.7) && (
                              <div style={{
                                marginTop: 10,
                                padding: '8px 10px',
                                background: '#fff7ed',
                                borderRadius: 7,
                                fontSize: 11,
                                color: '#c2410c',
                                lineHeight: 1.5
                              }}>
                                <Lightbulb size={12} strokeWidth={1.8} style={{ marginRight: 5, verticalAlign: -2 }} />
                                Strong correlation detected (r &gt; 0.70). Consider removing highly redundant features to improve model generalizability.
                              </div>
                            )}
                          </>
                        )}

                        {section.type === 'model' && (
                          <>
                            <div className="ds-header">
                              <div className="ds-icon model"><Brain {...iconProps} /></div>
                              <span className="ds-title">{section.title}</span>
                              <span className="ds-badge sb-model" style={{ background: '#fff7ed', color: '#c2410c' }}>Trained Model</span>
                            </div>
                            {renderSectionDescription(section)}
                            <table className="model-table">
                              <thead>
                                <tr>
                                  <th>Metric</th>
                                  <th>Result</th>
                                  <th>Comparison Track</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td style={{ fontWeight: 500 }}>{section.data?.algorithm} Accuracy</td>
                                  <td>
                                    <span style={{ fontWeight: 650 }}>
                                      {section.data?.metrics?.accuracy
                                        ? `${(section.data.metrics.accuracy * 100).toFixed(1)}%`
                                        : section.data?.metrics?.r2
                                        ? `R² = ${section.data.metrics.r2.toFixed(3)}`
                                        : '-'}
                                    </span>
                                  </td>
                                  <td>
                                    <div className="acc-bar">
                                      <div className="acc-track">
                                        <div
                                          className="acc-fill"
                                          style={{
                                            width: `${
                                              (section.data?.metrics?.accuracy || section.data?.metrics?.r2 || 0) * 100
                                            }%`,
                                          }}
                                        ></div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                                <tr>
                                  <td>Target Variable</td>
                                  <td style={{ color: '#6b6b6b' }}>{section.data?.target}</td>
                                  <td><span className="best-badge">Active</span></td>
                                </tr>
                              </tbody>
                            </table>
                          </>
                        )}

                        {section.type === 'scenario' && (
                          <>
                            <div className="ds-header">
                              <div className="ds-icon whatif"><Shuffle {...iconProps} /></div>
                              <span className="ds-title">{section.title}</span>
                              <span className="ds-badge sb-whatif" style={{ background: '#f5f3ff', color: '#7c3aed' }}>Simulation</span>
                            </div>
                            {renderSectionDescription(section)}
                            <table className="wi-table">
                              <thead>
                                <tr>
                                  <th>Scenario Input Values</th>
                                  <th>Target Prediction</th>
                                  <th>Risk Level</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td style={{ fontSize: '10px', color: '#6b6b6b', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {Object.entries(section.data?.detail?.inputs || {})
                                      .map(([k, v]) => `${k}: ${v}`)
                                      .join(', ')}
                                  </td>
                                  <td className="wi-result">
                                    {section.data?.detail?.prediction?.kind === 'probability'
                                      ? `${section.data.detail.prediction.predicted_class} (${Math.round(
                                          section.data.detail.prediction.prediction * 100
                                        )}%)`
                                      : section.data?.detail?.prediction?.prediction?.toFixed(3) || '-'}
                                  </td>
                                  <td>
                                    <span style={{
                                      fontSize: '9px',
                                      padding: '1px 6px',
                                      borderRadius: 8,
                                      background: section.data?.detail?.risk_level === 'high' ? '#fff1f1' : '#f0faf6',
                                      color: section.data?.detail?.risk_level === 'high' ? '#9e2524' : '#18765b'
                                    }}>
                                      {section.data?.detail?.risk_level || 'low'}
                                    </span>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </>
                        )}

                        {section.type === 'ai' && (
                          <>
                            <div className="ds-header">
                              <div className="ds-icon" style={{ background: '#f0fdf4', color: '#15803d' }}>
                                <Sparkles {...iconProps} />
                              </div>
                              <span className="ds-title">AI Interpretation</span>
                            </div>
                            {renderSectionDescription(section)}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {checkedIds.includes('ai-prep') && (
                                <div style={{
                                  fontSize: 11.5,
                                  color: '#6b6b6b',
                                  lineHeight: 1.6,
                                  fontStyle: 'italic',
                                  padding: '8px 12px',
                                  background: '#f8f8f7',
                                  borderLeft: '3px solid #f97316',
                                  borderRadius: 4
                                }}>
                                  <strong>Data Preparation:</strong> The data pipeline successfully parsed{' '}
                                  {dataset.filename || 'dataset'} data variables. Outliers were capped using interquartile range (IQR) limits, and categorical labels standardized to ensure optimal training performance.
                                </div>
                              )}
                              {checkedIds.includes('ai-model') && (
                                <div style={{
                                  fontSize: 11.5,
                                  color: '#6b6b6b',
                                  lineHeight: 1.6,
                                  fontStyle: 'italic',
                                  padding: '8px 12px',
                                  background: '#f8f8f7',
                                  borderLeft: '3px solid #3b82f6',
                                  borderRadius: 4
                                }}>
                                  <strong>Model Performance:</strong> Machine learning estimators were fitted to predict{' '}
                                  {models[0]?.target || 'target'}. Accuracy metrics indicate high stability on unseen test-set samples with low generalization bias.
                                </div>
                              )}
                              {checkedIds.includes('ai-feature') && (
                                <div style={{
                                  fontSize: 11.5,
                                  color: '#6b6b6b',
                                  lineHeight: 1.6,
                                  fontStyle: 'italic',
                                  padding: '8px 12px',
                                  background: '#f8f8f7',
                                  borderLeft: '3px solid #7c3aed',
                                  borderRadius: 4
                                }}>
                                  <strong>Feature Weights:</strong> The primary factors driving predictions were identified. Stakeholders should prioritize variables showing the highest coefficients during pipeline simulations.
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {includeRecommendations && (
                <div className="doc-section ai-generated-section">
                  <div className="ds-header">
                    <div className="ds-icon" style={{ background: '#f0fdf4', color: '#15803d' }}>
                      <Lightbulb {...iconProps} />
                    </div>
                    <span className="ds-title">Recommendations</span>
                  </div>
                  <p>
                    {polishedWording
                      ? 'Prioritize validation of the strongest relationships before deployment, compare model results against a simple baseline, and document any assumptions introduced during cleaning or scenario simulation. These steps strengthen reproducibility and make the report more defensible for academic review.'
                      : 'Validate the strongest relationships, compare model results with a baseline, and document data cleaning assumptions before using the findings for final decisions.'}
                  </p>
                </div>
              )}

              {/* Raw Data Append (Settings option) */}
              {includeRawData && (
                <div className="doc-section">
                  <div className="ds-header">
                    <div className="ds-icon data"><Table2 {...iconProps} /></div>
                    <span className="ds-title">Appendix A: Dataset Preview</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#6b6b6b', background: '#f8f8f7', padding: 10, borderRadius: 8, overflowX: 'auto' }}>
                    <p style={{ marginBottom: 6 }}>Showing variable details for {dataset.name}</p>
                    <table style={{ fontSize: 10 }}>
                      <thead>
                        <tr>
                          <th>Variable Name</th>
                          <th>Data Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.isArray(dataset.variables) && dataset.variables.slice(0, 5).map((v, idx) => (
                          <tr key={idx}>
                            <td><code>{v.name || v.variable}</code></td>
                            <td>{v.dtype || v.kind}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Methodology Notes (Settings option) */}
              {includeMethodology && (
                <div className="doc-section">
                  <div className="ds-header">
                    <div className="ds-icon desc"><Info {...iconProps} /></div>
                    <span className="ds-title">Appendix B: Methodology Notes</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#6b6b6b', lineHeight: 1.5 }}>
                    <p>All statistical computations were performed in python via scipy.stats packages. Estimators were standardized and fit using scikit-learn models (including Random Forests and Decision Tree classifiers) using a default 80/20 train/test partition stratified by target label frequencies.</p>
                  </div>
                </div>
              )}

              {/* Page numbers (Settings option) */}
              {includePageNumbers && (
                <div style={{
                  padding: '8px 24px',
                  borderTop: '1px solid #f0f0ee',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 10,
                  color: '#a0a0a0'
                }}>
                  <span>SimuCast Auto-report</span>
                  <span>Page 1 of 1</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL — OUTLINE + ORDER */}
      <div className="right-panel">
        <div className="rh">
          <div className="rh-title">Report structure</div>
          <div className="rh-count">{totalSectionsCount} sections · drag to reorder</div>
        </div>

        <div className="right-scroll">
          {outline.length === 0 ? (
            <p style={{ fontSize: 11, color: '#a0a0a0', fontStyle: 'italic', padding: 10 }}>No sections checked</p>
          ) : (
            outline.map((section, idx) => {
              const isOver = dragOverId === section.id
              let badgeClass = 'sb-data'
              if (section.source === 'Desc') badgeClass = 'sb-desc'
              if (section.source === 'Model') badgeClass = 'sb-model'
              if (section.source === 'W-if') badgeClass = 'sb-whatif'
              if (section.source === 'AI') badgeClass = 'sb-ai'

              return (
                <div
                  key={section.id}
                  className={`oi ${isOver ? 'drag-over' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, section.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, idx)}
                >
                  <GripVertical className="oi-drag" size={13} strokeWidth={1.8} />
                  <span className="oi-text">{section.title}</span>
                  <span className={`oi-src ${badgeClass}`}>{section.source}</span>
                </div>
              )
            })
          )}
        </div>

      </div>
    </div>
  )
}

// Chart mini thumbnail component
function ChartMiniThumbnail({ type }) {
  if (type === 'mixed') {
    return (
      <svg className="ci-thumb" width="40" height="30" viewBox="0 0 40 30" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
        <rect x="6" y="17" width="6" height="9" fill="#f97316" opacity="0.75" rx="1" />
        <rect x="16" y="12" width="6" height="14" fill="#f97316" opacity="0.75" rx="1" />
        <rect x="26" y="15" width="6" height="11" fill="#f97316" opacity="0.75" rx="1" />
        <path d="M8,14 L19,9 L30,11" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="19" cy="9" r="2" fill="#3b82f6" />
      </svg>
    )
  }
  if (type === 'bar' || type === 'horizontal bar' || type === 'histogram') {
    return (
      <svg className="ci-thumb" width="40" height="30" viewBox="0 0 40 30" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
        <rect x="6" y="16" width="6" height="10" fill="#f97316" opacity="0.8" rx="1" />
        <rect x="16" y="8" width="6" height="18" fill="#f97316" opacity="0.8" rx="1" />
        <rect x="26" y="12" width="6" height="14" fill="#f97316" opacity="0.8" rx="1" />
      </svg>
    )
  }
  if (type === 'scatter') {
    return (
      <svg className="ci-thumb" width="40" height="30" viewBox="0 0 40 30" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
        <circle cx="10" cy="22" r="2.5" fill="#3b82f6" opacity="0.75" />
        <circle cx="20" cy="12" r="2.5" fill="#3b82f6" opacity="0.75" />
        <circle cx="28" cy="18" r="2.5" fill="#3b82f6" opacity="0.75" />
        <circle cx="15" cy="8" r="2.5" fill="#3b82f6" opacity="0.75" />
      </svg>
    )
  }
  if (type === 'line') {
    return (
      <svg className="ci-thumb" width="40" height="30" viewBox="0 0 40 30" style={{ background: '#f5f3ff', border: '1px solid #d8b4fe' }}>
        <path d="M6,22 L15,12 L24,18 L34,8" fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="15" cy="12" r="2" fill="#7c3aed" />
        <circle cx="24" cy="18" r="2" fill="#7c3aed" />
      </svg>
    )
  }
  return (
    <svg className="ci-thumb" width="40" height="30" viewBox="0 0 40 30" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
      <circle cx="20" cy="15" r="8" fill="#166534" opacity="0.7" />
      <path d="M20,15 L20,7 A8,8 0 0,1 28,15 Z" fill="#22c55e" />
    </svg>
  )
}

// Chart mockup component inside Preview
function buildReportMixedChartData(rows, layers, aggregation = 'Mean') {
  const activeLayers = (layers || []).filter(layer => layer?.x && layer?.y && ['bar', 'line', 'scatter'].includes(layer.type))
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
      const color = layer.color || getReportCohortColor('#f97316', index, activeLayers.length)
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
          pointRadius: 3,
        }
      }
      return {
        type: layer.type,
        label: `${layer.y} (${layer.type})`,
        data: labels.map(label => aggregateValue(rows.filter(row => String(row[xAxis] ?? 'None') === label), layer.y, aggregation)),
        backgroundColor: layer.type === 'bar' ? color : `${color}22`,
        borderColor: color,
        borderWidth: layer.type === 'line' ? 2.5 : 1,
        borderRadius: layer.type === 'bar' ? 4 : undefined,
        tension: layer.type === 'line' ? 0.25 : undefined,
        fill: false,
        pointRadius: layer.type === 'line' ? 3 : undefined,
      }
    })
  }
}

function PreviewMockupChart({ chart, rows = [], corrResult = null }) {
  if (!chart) return null
  const { type, xAxis, yAxis } = chart
  const color = chart.color || '#f97316'

  if (type === 'correlation-heatmap') {
    if (!corrResult || !corrResult.variables || corrResult.variables.length < 2) {
      return <div style={{ fontSize: 11, color: '#9ca3af', padding: 20, textAlign: 'center' }}>No correlation data available.</div>
    }
    const getCorrelationColor = (val) => {
      const abs = Math.abs(val)
      if (val > 0) return `rgba(234, 88, 12, ${abs * 0.7})`
      return `rgba(2, 132, 199, ${abs * 0.7})`
    }
    const fmt = (val) => val === 1 ? '1.0' : val.toFixed(2)
    return (
      <div className="report-heatmap-container" style={{ overflowX: 'auto', padding: '10px 0' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: '4px', fontSize: 9, fontFamily: 'var(--font-mono)', minWidth: Math.max(300, corrResult.variables.length * 52), margin: '0 auto' }}>
          <thead>
            <tr>
              <th style={{ padding: '4px 6px', background: 'transparent', border: 'none' }}></th>
              {corrResult.variables.map((v) => (
                <th key={v} title={v} style={{ padding: '4px 6px', color: '#6b7280', fontWeight: 600, fontSize: 8.5, maxWidth: 55, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: 'none', background: 'transparent' }}>{v}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {corrResult.variables.map((r) => (
              <tr key={r}>
                <td title={r} style={{ padding: '4px 6px', fontWeight: 600, fontSize: 8.5, color: '#4b5563', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: 'none' }}>{r}</td>
                {corrResult.variables.map((c) => {
                  const val = Number(corrResult.matrix?.[r]?.[c] ?? 0)
                  const abs = Math.abs(val)
                  const isSelf = r === c
                  const bg = isSelf ? '#ea580c' : getCorrelationColor(val)
                  const textColor = isSelf || abs > 0.5 ? '#fff' : '#111827'
                  return (
                    <td
                      key={c}
                      style={{
                        padding: '4px 5px',
                        textAlign: 'center',
                        backgroundColor: bg,
                        color: textColor,
                        borderRadius: 4,
                        fontWeight: 700,
                        fontSize: 9,
                        border: 'none'
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
    )
  }

  const isMixed = Array.isArray(chart.layers) && chart.layers.length > 1
  const chartDataRaw = isMixed
    ? buildReportMixedChartData(rows, chart.layers, chart.aggregation || 'Mean')
    : prepareChartData(rows, type, xAxis, yAxis, chart.colorBy || '', chart.aggregation || 'Mean', color)

  if (!chartDataRaw) {
    return (
      <div className="chart-preview">
        <div className="chart-mock" style={{ alignItems: 'center', justifyContent: 'center', color: '#a3a3a3', fontSize: 11 }}>
          Saved chart data is loading...
        </div>
        <div className="chart-cap">{chart.title || `${xAxis || 'Chart'} preview`}</div>
      </div>
    )
  }

  let chartData = chartDataRaw
  if ((type === 'bar' || type === 'horizontal bar') && chart.sortOrder && chart.sortOrder !== 'default' && chartData?.labels?.length) {
    const pairs = chartData.labels.map((label, idx) => ({ label, value: chartData.datasets[0]?.data?.[idx] ?? 0 }))
      .sort((a, b) => chart.sortOrder === 'asc' ? a.value - b.value : b.value - a.value)
    const sortedLabels = pairs.map((p) => p.label)
    const sortedData = pairs.map((p) => p.value)
    chartData = {
      ...chartData,
      labels: sortedLabels,
      datasets: chartData.datasets.map((ds) => ({ ...ds, data: sortedData }))
    }
  }
  const chartJsData = chartData
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        display: Boolean(chart.showLegend || type === 'pie' || chart.colorBy),
        position: 'bottom',
        labels: { font: { size: 10 }, boxWidth: 10, padding: 8 },
      },
      tooltip: { enabled: true },
    },
    scales: isMixed || (type !== 'pie' && type !== 'radar') ? {
      x: { ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 0 } },
      y: { ticks: { font: { size: 10 } }, beginAtZero: true },
    } : undefined,
  }
  if (type === 'horizontal bar') chartOptions.indexAxis = 'y'

  const labelPlugin = chart.showLabels ? {
    id: 'rptdatalabels',
    afterDatasetsDraw(ch) {
      const ctx = ch.ctx
      const ctype = ch.config.type
      ch.data.datasets.forEach((dataset, di) => {
        const meta = ch.getDatasetMeta(di)
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
            ctx.font = 'bold 10px sans-serif'
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
            ctx.font = 'bold 10px sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'bottom'
            ctx.fillText(label, pos.x, pos.y - 4)
            ctx.restore()
          })
        }
      })
    }
  } : null
  const chartPlugins = labelPlugin ? [labelPlugin] : []

  const renderChart = () => {
    if (isMixed) return <Chart type="bar" data={chartJsData} options={{ ...chartOptions, interaction: { mode: 'index', intersect: false }, plugins: { ...chartOptions.plugins, legend: { ...chartOptions.plugins.legend, display: true } } }} plugins={chartPlugins} />
    if (type === 'line') return <Line data={chartJsData} options={chartOptions} plugins={chartPlugins} />
    if (type === 'scatter') return <Scatter data={chartJsData} options={chartOptions} plugins={chartPlugins} />
    if (type === 'pie') return <Pie data={chartJsData} options={chartOptions} plugins={chartPlugins} />
    if (type === 'radar') return <Radar data={chartJsData} options={chartOptions} plugins={chartPlugins} />
    if (type === 'bubble') return <Bubble data={chartJsData} options={chartOptions} plugins={chartPlugins} />
    return <Bar data={chartJsData} options={chartOptions} plugins={chartPlugins} />
  }

  return (
    <div className="chart-preview">
      <div className="chart-mock report-chart-canvas">
        {renderChart()}
      </div>
      <div className="chart-cap">{chart.title || `${xAxis || 'Chart'}${yAxis ? ` vs ${yAxis}` : ''}`}</div>
    </div>
  )

  if (type === 'bar' || type === 'horizontal bar' || type === 'histogram') {
    const values = chartData.datasets[0]?.data || []
    const max = Math.max(...values.map((v) => Math.abs(Number(v) || 0)), 1)
    const labels = chartData.labels || []
    return (
      <div className="chart-preview">
        <div className="chart-mock" style={type === 'horizontal bar' ? { display: 'grid', alignItems: 'stretch', gap: 7 } : undefined}>
          {type === 'horizontal bar' ? (
            values.slice(0, 10).map((value, idx) => (
              <div key={`${labels[idx]}-${idx}`} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 42px', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 9, color: '#525252', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labels[idx]}</span>
                <div style={{ height: 8, background: '#f1f1ef', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(4, (Math.abs(Number(value) || 0) / max) * 100)}%`, height: '100%', background: color, borderRadius: 999 }} />
                </div>
                <span style={{ fontSize: 9, color: '#525252', textAlign: 'right' }}>{formatChartValue(value)}</span>
              </div>
            ))
          ) : (
            values.slice(0, 12).map((value, idx) => (
              <div
                key={`${labels[idx]}-${idx}`}
                className="bar-mock"
                title={`${labels[idx]}: ${formatChartValue(value)}`}
                style={{
                  height: `${Math.max(6, (Math.abs(Number(value) || 0) / max) * 96)}%`,
                  background: `linear-gradient(to top, ${color}, ${lightenHex(color, 18)})`
                }}
              />
            ))
          )}
        </div>
        <div className="chart-cap">{chart.title || `${type === 'histogram' ? 'Histogram' : 'Bar chart'}: ${xAxis} vs ${yAxis || 'counts'}`}</div>
      </div>
    )
  }

  if (type === 'scatter' || type === 'bubble') {
    const points = chartData.datasets.flatMap((dataset) => dataset.data || [])
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const xMin = Math.min(...xs), xMax = Math.max(...xs)
    const yMin = Math.min(...ys), yMax = Math.max(...ys)
    return (
      <div className="chart-preview">
        <div className="chart-mock" style={{ position: 'relative', background: '#eff6ff' }}>
          {chartData.datasets.flatMap((dataset, datasetIdx) => (dataset.data || []).slice(0, 120).map((point, idx) => {
            const left = normalizeToPercent(point.x, xMin, xMax)
            const bottom = normalizeToPercent(point.y, yMin, yMax)
            const size = type === 'bubble' ? Math.max(5, Math.min(18, point.r || 8)) : 7
            return (
              <span
                key={`${datasetIdx}-${idx}`}
                title={`${xAxis}: ${formatChartValue(point.x)}, ${yAxis}: ${formatChartValue(point.y)}`}
                style={{ position: 'absolute', left: `${left}%`, bottom: `${bottom}%`, width: size, height: size, borderRadius: '50%', background: dataset.color || color, opacity: 0.75, transform: 'translate(-50%, 50%)' }}
              />
            )
          }))}
        </div>
        <div className="chart-cap">{chart.title || `Scatter: ${xAxis} vs ${yAxis}`}</div>
      </div>
    )
  }

  if (type === 'line' || type === 'radar') {
    const values = chartData.datasets[0]?.data || []
    const max = Math.max(...values.map((v) => Number(v) || 0), 1)
    const min = Math.min(...values.map((v) => Number(v) || 0), 0)
    const path = values.slice(0, 16).map((value, idx, arr) => {
      const x = 16 + (idx / Math.max(arr.length - 1, 1)) * 348
      const y = 104 - normalizeToPercent(value, min, max) * 0.88
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    }).join(' ')
    return (
      <div className="chart-preview">
        <div className="chart-mock" style={{ position: 'relative', background: '#f5f3ff' }}>
          <svg viewBox="0 0 380 120" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
            <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="chart-cap">{chart.title || `${type === 'radar' ? 'Radar' : 'Line'}: ${xAxis} vs ${yAxis}`}</div>
      </div>
    )
  }

  const values = chartData.datasets[0]?.data || []
  const labels = chartData.labels || []
  const total = values.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0) || 1
  let cursor = 0
  const slices = values.slice(0, 8).map((value, idx) => {
    const fraction = Math.max(0, Number(value) || 0) / total
    const start = cursor
    const end = cursor + fraction
    cursor = end
    return {
      path: donutSlicePath(46, 46, 34, 16, start, end),
      color: getReportCohortColor(color, idx, values.length),
      label: labels[idx],
      value,
    }
  })

  return (
    <div className="chart-preview">
      <div className="chart-mock" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, background: '#f0fdf4' }}>
        <svg width="112" height="92" viewBox="0 0 112 92" role="img" aria-label={`${xAxis} distribution pie chart`}>
          <circle cx="46" cy="46" r="34" fill="#ecfdf5" stroke="#d1fae5" strokeWidth="1" />
          {slices.map((slice, idx) => <path key={idx} d={slice.path} fill={slice.color} />)}
          <circle cx="46" cy="46" r="16" fill="#f0fdf4" />
        </svg>
        <div style={{ display: 'grid', gap: 6, minWidth: 110 }}>
          {slices.slice(0, 5).map((slice, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#525252' }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: slice.color }}></span>
              <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slice.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="chart-cap">{chart.title || `Pie: ${xAxis} distribution`}</div>
    </div>
  )
}

function getReportCohortColor(primaryColor, index, total) {
  if (total <= 1) return primaryColor
  const hex = (primaryColor || '#f97316').replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return primaryColor
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  let rNorm = r / 255, gNorm = g / 255, bNorm = b / 255
  let max = Math.max(rNorm, gNorm, bNorm), min = Math.min(rNorm, gNorm, bNorm)
  let h, s, l = (max + min) / 2
  if (max === min) {
    h = s = 0
  } else {
    const d = max - min
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

function lightenHex(hexColor, amount = 16) {
  if (!/^#[0-9a-f]{6}$/i.test(hexColor)) return '#fb923c'
  const hex = hexColor.replace('#', '')
  const next = [0, 2, 4].map((start) => Math.min(255, parseInt(hex.slice(start, start + 2), 16) + amount))
  return `#${next.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function normalizeToPercent(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max === min) return 50
  return 8 + ((value - min) / (max - min)) * 84
}

function formatChartValue(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return String(value ?? '')
  if (Math.abs(num) >= 100) return num.toFixed(0)
  if (Math.abs(num) >= 10) return num.toFixed(1)
  return num.toFixed(2)
}

function donutSlicePath(cx, cy, outerR, innerR, startFraction, endFraction) {
  const start = startFraction * Math.PI * 2 - Math.PI / 2
  const end = endFraction * Math.PI * 2 - Math.PI / 2
  const largeArc = endFraction - startFraction > 0.5 ? 1 : 0
  const outerStart = polarPoint(cx, cy, outerR, start)
  const outerEnd = polarPoint(cx, cy, outerR, end)
  const innerStart = polarPoint(cx, cy, innerR, start)
  const innerEnd = polarPoint(cx, cy, innerR, end)
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ')
}

function polarPoint(cx, cy, radius, angle) {
  return {
    x: Number((cx + radius * Math.cos(angle)).toFixed(2)),
    y: Number((cy + radius * Math.sin(angle)).toFixed(2)),
  }
}
