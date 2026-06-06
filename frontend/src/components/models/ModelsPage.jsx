/* ============================================================
 * PAGE: ML MODELS (TRAIN, COMPARE)
 * Keywords: models, train, machine learning, regression, classification, linear, logistic, tree, random forest, feature importance
 * ============================================================ */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Bar } from 'react-chartjs-2'
import {
  Activity,
  BarChart3,
  Brain,
  Check,
  ChevronDown,
  Gauge,
  History,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  ArrowUpRight,
  AlertTriangle
} from 'lucide-react'
import { api } from '../../api'
import { AIInsightCard, ExplainButton } from '../ai/AIExplainers'
import { ResultsSummary, FallbackLabel, r2FallbackLabel, rmseFallbackLabel, gapFallbackLabel } from '../ai/AIExplainPanel'
import { useDialog } from '../common/DialogProvider'
import { useAuth } from '../providers/AuthProvider'
import { BusyOverlay, InlineSpinner, SkeletonCards } from '../common/LoadingStates'
import HelpButton from '../common/HelpButton'
import PageGuide from '../common/PageGuide'

const modelsPageCache = new Map()

const ALGOS = [
  { key: 'logistic', label: 'Logistic Regression', task: 'classification', interpretable: true,
    desc: 'Linear, fast, interpretable. Good baseline for classification.' },
  { key: 'rf',       label: 'Random Forest',       task: 'both',           interpretable: false,
    desc: 'Ensemble of trees. Handles non-linearity, less tuning needed.' },
  { key: 'tree',     label: 'Decision Tree',       task: 'both',           interpretable: false,
    desc: 'Single tree model. Easy to inspect, but can overfit without depth limits.' },
  { key: 'linear',   label: 'Linear Regression',   task: 'regression',     interpretable: true,
    desc: 'Linear baseline for regression. Coefficients directly interpretable.' },
]

const SETUP_ALGO_DETAILS = {
  rf: {
    name: 'Random Forest',
    description: 'Builds many decision trees and averages their predictions.',
    bestFor: 'non-linear patterns, robust to outliers',
    color: '#f97316',
  },
  tree: {
    name: 'Decision Tree',
    description: 'Splits data into branches based on feature thresholds.',
    bestFor: 'interpretable models, smaller datasets',
    color: '#2563eb',
  },
  linear: {
    name: 'Linear Regression',
    description: 'Fits a straight line through the data to predict numeric outcomes.',
    bestFor: 'linear relationships, fast training',
    color: '#7c3aed',
  },
  logistic: {
    name: 'Logistic Regression',
    description: 'Predicts probability of class membership.',
    bestFor: 'binary classification problems',
    color: '#16a34a',
  },
}

const GUEST_MODEL_LIMIT = 5

const PARAM_DEFS = {
  logistic: [
    { key: 'C', label: 'Regularization C', type: 'number', min: 0.001, max: 100, step: 0.1, defaultValue: 1 },
    { key: 'max_iter', label: 'Max iterations', type: 'number', min: 100, max: 5000, step: 100, defaultValue: 1000 },
    { key: 'random_state', label: 'Random seed', type: 'number', min: 0, max: 999, step: 1, defaultValue: 42 },
  ],
  rf: [
    { key: 'n_estimators', label: 'Number of trees', type: 'number', min: 10, max: 500, step: 10, defaultValue: 100 },
    { key: 'max_depth', label: 'Max depth', type: 'numberOrBlank', min: 1, max: 50, step: 1, defaultValue: '' },
    { key: 'min_samples_leaf', label: 'Min samples / leaf', type: 'number', min: 1, max: 50, step: 1, defaultValue: 1 },
    { key: 'random_state', label: 'Random seed', type: 'number', min: 0, max: 999, step: 1, defaultValue: 42 },
  ],
  tree: [
    { key: 'max_depth', label: 'Max depth', type: 'numberOrBlank', min: 1, max: 50, step: 1, defaultValue: '' },
    { key: 'min_samples_leaf', label: 'Min samples / leaf', type: 'number', min: 1, max: 50, step: 1, defaultValue: 1 },
    { key: 'random_state', label: 'Random seed', type: 'number', min: 0, max: 999, step: 1, defaultValue: 42 },
  ],
  linear: [
    { key: 'fit_intercept', label: 'Fit intercept', type: 'checkbox', defaultValue: true },
  ],
}

// Page that configures targets, features, validation, algorithms, and trains predictive models.
export default function ModelsPage({ dataset, setActiveModel, onGo, initialData }) {
  const dialog = useDialog()
  const auth = useAuth()
  const navigate = useNavigate()
  const [target, setTarget] = useState('')
  const [targetMode, setTargetMode] = useState('auto')
  const [positiveClass, setPositiveClass] = useState('')
  const [testSize, setTestSize] = useState(0.2)
  const [validationMethod, setValidationMethod] = useState('standard_split')
  const [cvFolds, setCvFolds] = useState(5)
  const [stratify, setStratify] = useState(true)
  const [classBalanceStrategy, setClassBalanceStrategy] = useState('none') // 'none' | 'balanced' | 'smote'
  const [numericPreprocessing, setNumericPreprocessing] = useState({
    scaling: 'auto',
    outlier_treatment: 'none',
    log_columns: [],
    integer_columns: [],
  })
  const [modelParams, setModelParams] = useState(defaultModelParams())
  const [features, setFeatures] = useState([])
  const [chosenAlgos, setChosenAlgos] = useState(['logistic', 'rf'])
  const [plan, setPlan] = useState(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState(null)
  const [training, setTraining] = useState(false)
  const [results, setResults] = useState(null)
  const [activeResultIdx, setActiveResultIdx] = useState(0)
  const [models, setModels] = useState(initialData?.tab === 'models' && initialData?.datasetId === dataset?.id ? (initialData.models || []) : [])
  const [draftReady, setDraftReady] = useState(false)
  const [dismissedChecks, setDismissedChecks] = useState([])
  const [isIssueBarExpanded, setIsIssueBarExpanded] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [standardizedCols, setStandardizedCols] = useState(new Set())
  const [categoricalEncoding, setCategoricalEncoding] = useState({})
  const [categoricalOrders, setCategoricalOrders] = useState({})
  const [aiExplainActive, setAiExplainActive] = useState(false)
  const [explainPopup, setExplainPopup] = useState(null)
  const [toastMsg, setToastMsg] = useState(null)

  useEffect(() => {
    if (toastMsg) {
      const t = setTimeout(() => setToastMsg(null), 3000)
      return () => clearTimeout(t)
    }
  }, [toastMsg])

  const onExplain = useCallback((element, event) => {
    if (!aiExplainActive) return
    event?.preventDefault?.()
    event?.stopPropagation?.()
    const sourceEl = event?.currentTarget || event?.target
    const rect = sourceEl?.getBoundingClientRect?.()
    setExplainPopup(rect ? { ...element, sourceEl, sourceRect: rect } : element)
  }, [aiExplainActive])

  const handleToggleExplain = useCallback(() => {
    setAiExplainActive((prev) => {
      const next = !prev
      if (next) {
        setToastMsg('Click any metric or card to explain it')
      } else {
        setExplainPopup(null)
      }
      return next
    })
  }, [])

  useEffect(() => {
    document.body.classList.toggle('ax-explain-mode-on', aiExplainActive)
    return () => document.body.classList.remove('ax-explain-mode-on')
  }, [aiExplainActive])

  const explainAttrs = useCallback((element, className = '', capture = false) => {
    const attrs = {
      className: `${className} ${aiExplainActive ? 'ax-explain-selectable' : ''}`.trim(),
      [capture ? 'onClickCapture' : 'onClick']: (event) => onExplain(element, event),
      title: aiExplainActive ? `Explain ${element.title || element.label || element.section || 'this area'}` : undefined,
    }
    if (capture) attrs.onPointerDownCapture = (event) => onExplain(element, event)
    return attrs
  }, [aiExplainActive, onExplain])

  const handleFixAction = (fix) => {
    if (!fix?.route) return
    const target = fixTargetFromBackendFix(fix)
    if (!target) return
    if (target.page === 'models') {
      const sectionId = target.section
      const el = document.getElementById(sectionId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
        el.classList.add('ax-fix-highlight')
        setTimeout(() => el.classList.remove('ax-fix-highlight'), 2600)
      }
    } else if (dataset?.id) {
      if (target.section) {
        window.sessionStorage.setItem('simucast.fixTarget', JSON.stringify({ page: target.page, section: target.section, ts: Date.now() }))
      }
      navigate(`/projects/${dataset.id}/${target.page}`)
    }
  }

  const variables = dataset?.variables || []
  const candidateFeatures = variables.filter((v) => v.name !== target)
  const allFeatureNames = useMemo(() => candidateFeatures.map((v) => v.name), [target, variables])
  const targetRecommendations = recommendTargets(variables)
  const featureRecommendations = recommendFeatures(candidateFeatures)

  useEffect(() => {
    if (!dataset) return
    if (initialData?.tab === 'models' && initialData?.datasetId === dataset.id && initialData.models) {
      setModels(initialData.models || [])
      return
    }
    const ck = `${dataset.id}|models`
    const cached = modelsPageCache.get(ck)
    if (cached) { setModels(cached); return }
    api.listModels(dataset.id).then((r) => { modelsPageCache.set(ck, r); setModels(r) }).catch(console.error)
  }, [dataset?.id, initialData?.datasetId])

  useEffect(() => {
    if (!dataset?.id) return
    if (initialData?.tab === 'models' && initialData?.datasetId === dataset.id && initialData.activity) {
      const list = initialData.activity.activity || []
      const cols = new Set()
      list.forEach((item) => {
        const detail = item.detail || {}
        const action = detail.action_type || item.action_type || item.kind
        if (action === 'category_standardization') {
          const c = detail.column ? [detail.column] : detail.columns || []
          c.forEach(col => cols.add(col))
        }
      })
      setStandardizedCols(cols)
      return
    }
    const ck = `${dataset.id}|${dataset.current_stage_id}|activity`
    const cached = modelsPageCache.get(ck)
    if (cached) { setStandardizedCols(cached); return }
    api.listActivity(dataset.id)
      .then((res) => {
        const list = res.activity || []
        const cols = new Set()
        list.forEach((item) => {
          const detail = item.detail || {}
          const action = detail.action_type || item.action_type || item.kind
          if (action === 'category_standardization') {
            const c = detail.column ? [detail.column] : detail.columns || []
            c.forEach(col => cols.add(col))
          }
        })
        modelsPageCache.set(ck, cols)
        setStandardizedCols(cols)
      })
      .catch(console.error)
  }, [dataset?.id, dataset?.current_stage_id])

  useEffect(() => {
    if (!dataset?.id) return
    setDraftReady(false)
    const raw = window.localStorage.getItem(`simucast.models.${dataset.id}`)
    if (!raw) {
      setResults(null)
      setActiveResultIdx(0)
      setDraftReady(true)
      return
    }
    try {
      const saved = JSON.parse(raw)
      setTarget(saved.target || '')
      setTargetMode(saved.targetMode || 'auto')
      setPositiveClass(saved.positiveClass || '')
      setTestSize(saved.testSize ?? 0.2)
      setValidationMethod(saved.validationMethod || 'standard_split')
      setCvFolds(saved.cvFolds || 5)
      setStratify(saved.stratify ?? true)
      setClassBalanceStrategy(saved.classBalanceStrategy || (saved.smote ? 'smote' : saved.classWeight ? 'balanced' : 'none'))
      setFeatures(saved.features || [])
      setChosenAlgos(saved.chosenAlgos || ['logistic', 'rf'])
      setModelParams(saved.modelParams || defaultModelParams())
      setNumericPreprocessing(saved.numericPreprocessing || { scaling: 'auto', log_columns: [], integer_columns: [] })
      setCategoricalEncoding(saved.categoricalEncoding || {})
      setCategoricalOrders(saved.categoricalOrders || {})
      setResults(saved.results || null)
      setActiveResultIdx(saved.activeResultIdx ?? 0)
    } catch (err) {
      console.warn('Could not restore model draft', err)
    } finally {
      setDraftReady(true)
    }
  }, [dataset?.id])

  useEffect(() => {
    if (!dataset?.id || !draftReady) return
    window.localStorage.setItem(`simucast.models.${dataset.id}`, JSON.stringify({
      target,
      targetMode,
      positiveClass,
      testSize,
      validationMethod,
      cvFolds,
      stratify,
      classBalanceStrategy,
      features,
      chosenAlgos,
      modelParams,
      numericPreprocessing,
      categoricalEncoding,
      categoricalOrders,
      results,
      activeResultIdx,
    }))
  }, [dataset?.id, draftReady, target, targetMode, positiveClass, testSize, validationMethod, cvFolds, stratify, classBalanceStrategy, features.join(','), chosenAlgos.join(','), JSON.stringify(modelParams), JSON.stringify(numericPreprocessing), JSON.stringify(categoricalEncoding), JSON.stringify(categoricalOrders), JSON.stringify(results), activeResultIdx])

  const sectionForModelsTarget = (section) => {
    if (!section) return 'setup'
    if (section === 'models-results') return 'results'
    if (section === 'models-tuning') return 'tune'
    if (section === 'models-feature-influence') return 'features'
    return 'setup'
  }

  useEffect(() => {
    const raw = window.sessionStorage.getItem('simucast.fixTarget')
    if (!raw) return
    let fixTarget = null
    try {
      fixTarget = JSON.parse(raw)
    } catch {
      return
    }
    if (fixTarget?.page !== 'models') return
    window.sessionStorage.removeItem('simucast.fixTarget')
    const nextSection = sectionForModelsTarget(fixTarget.section)
    setActiveModelsSection(nextSection)
    try { window.localStorage.setItem(`simucast.modelsSection.${dataset?.id}`, nextSection) } catch {}
    setTimeout(() => highlightSection(fixTarget.section), 220)
  }, [dataset?.id])

  useEffect(() => {
    const handleRouteTarget = (event) => {
      const target = event?.detail
      if (target?.page !== 'models' || !target.section) return
      const nextSection = sectionForModelsTarget(target.section)
      setActiveModelsSection(nextSection)
      try { window.localStorage.setItem(`simucast.modelsSection.${dataset?.id}`, nextSection) } catch {}
      window.setTimeout(() => highlightSection(target.section), 220)
    }
    window.addEventListener('simucast:route-target', handleRouteTarget)
    return () => window.removeEventListener('simucast:route-target', handleRouteTarget)
  }, [dataset?.id])

  // Refresh plan whenever target/features/algos change.
  useEffect(() => {
    if (!dataset || !target || features.length === 0) {
      setPlan(null)
      setPlanError(null)
      return
    }
    let cancelled = false
    setPlanLoading(true)
    setPlanError(null)
    const t = setTimeout(async () => {
      try {
        const r = await api.preprocessingPlan(dataset.id, {
          target,
          features,
          algorithms: chosenAlgos,
          target_options: targetOptions(targetMode, positiveClass, testSize, validationMethod, cvFolds, stratify, classBalanceStrategy, numericPreprocessing, categoricalEncoding, categoricalOrders),
        })
        if (!cancelled) {
          setPlan(r)
          if ((!positiveClass || !(r.target_classes || []).includes(positiveClass)) && r.positive_class) {
            setPositiveClass(r.positive_class)
          }
        }
      } catch (err) {
        if (!cancelled) {
          setPlanError(err.message || 'Plan failed')
          setPlan(null)
        }
      } finally {
        if (!cancelled) setPlanLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [dataset?.id, dataset?.current_stage_id, target, features.join(','), chosenAlgos.join(','), targetMode, positiveClass, testSize, validationMethod, cvFolds, stratify, classBalanceStrategy, JSON.stringify(numericPreprocessing), JSON.stringify(categoricalEncoding), JSON.stringify(categoricalOrders)])

  // Auto-select Balanced class weights as the default when class imbalance is detected on first plan load.
  const classBalanceAutoApplied = useRef(null)
  useEffect(() => {
    if (!plan) return
    const key = `${dataset?.id}:${target}`
    if (classBalanceAutoApplied.current === key) return
    classBalanceAutoApplied.current = key
    const hasWarning = (plan.validation_checks || []).some(c => c.key === 'class_balance' && c.status === 'warning')
    if (hasWarning && classBalanceStrategy === 'none') {
      setClassBalanceStrategy('balanced')
    }
  }, [plan]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!dataset) {
    return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>
  }

  const toggleFeature = (name) => {
    setFeatures(features.includes(name) ? features.filter((x) => x !== name) : [...features, name])
  }
  const selectAll = () => setFeatures(allFeatureNames)
  const selectNone = () => setFeatures([])
  const toggleAlgo = (key) => {
    if (chosenAlgos.includes(key)) {
      setChosenAlgos(chosenAlgos.filter((a) => a !== key))
      return
    }
    if (auth.isGuest && chosenAlgos.filter((a) => visibleAlgoKeys.includes(a)).length >= guestModelsRemaining) return
    setChosenAlgos([...chosenAlgos, key])
  }

  // Filter the algorithm list based on the inferred task.
  const visibleAlgos = ALGOS.filter((a) => {
    if (!plan) return true
    return a.task === 'both' || a.task === plan.task
  })
  const visibleAlgoKeys = visibleAlgos.map((a) => a.key)
  const selectedAlgos = chosenAlgos.filter((a) => visibleAlgoKeys.includes(a))
  const guestTrainingUsed = auth.session?.model_usage_count ?? 0
  const guestModelsRemaining = auth.isGuest ? Math.max(GUEST_MODEL_LIMIT - guestTrainingUsed, 0) : Infinity
  const guestModelLimitReached = auth.isGuest && guestModelsRemaining <= 0
  const guestSelectionOverLimit = auth.isGuest && selectedAlgos.length > guestModelsRemaining

  const train = async () => {
    if (!target || features.length === 0 || selectedAlgos.length === 0) return
    if (guestModelLimitReached || guestSelectionOverLimit) {
      await dialog.alert({
        title: 'Guest Model Limit Reached',
        message: guestModelLimitReached
          ? `Guest mode includes up to ${GUEST_MODEL_LIMIT} total model training attempts for this temporary session. Deleting models will not reset the limit. Create an account to remove guest training restrictions.`
          : `You have ${guestModelsRemaining} training attempt${guestModelsRemaining === 1 ? '' : 's'} remaining. Select fewer algorithms or create an account to train more.`,
        variant: 'danger',
      })
      return
    }
    setTraining(true)
    setResults(null)
    try {
      const r = await api.trainManyModels(dataset.id, {
        target,
        features,
        algorithms: selectedAlgos,
        target_options: targetOptions(targetMode, positiveClass, testSize, validationMethod, cvFolds, stratify, classBalanceStrategy, numericPreprocessing, categoricalEncoding, categoricalOrders),
        model_params: modelParams,
      })
      if (r.session) auth.updateSession(r.session)
      setResults(r)
      setActiveResultIdx(0)
      setActiveModelsSection('results')
      window.requestAnimationFrame(() => {
        document.querySelector('.ax-models-main')?.scrollTo?.({ top: 0, behavior: 'smooth' })
      })
      const list = await api.listModels(dataset.id)
      setModels(list)
      window.dispatchEvent(new CustomEvent('simucast:guided-progress', { detail: { type: 'models', datasetId: dataset.id } }))
    } catch (err) {
      if (err.guest_model_limit) {
        auth.showAuthModal('signup')
        await dialog.alert({
          title: 'Guest Training Limit Reached',
          message: err.message || `Guest mode includes up to ${GUEST_MODEL_LIMIT} total model trainings for this temporary session. Deleting models will not reset the limit.`,
          variant: 'danger',
        })
        return
      }
      if (err.guest_limit) {
        auth.showAuthModal('signup')
        await dialog.alert({
          title: 'Guest Limit Reached',
          message: err.message || 'Guest mode is limited to one temporary project. You can keep working inside your existing project, but creating another project requires an account.',
          variant: 'danger',
        })
        return
      }
      if (err.auth_required) {
        auth.showAuthModal('signup')
        await dialog.alert({ title: 'Account Required', message: err.message || 'Create an account or log in to continue.', variant: 'danger' })
        return
      }
      await dialog.alert({ title: 'Training Failed', message: err.message, variant: 'danger' })
    } finally {
      setTraining(false)
    }
  }

  const useInWhatIf = (model) => {
    setActiveModel(model)
    onGo('whatif')
  }

  const canPrepareWhatIf = (model) => ['linear', 'logistic', 'tree', 'rf'].includes(model.algorithm)
  const prepareAndUseInWhatIf = async (model) => {
    if (model.has_whatif) {
      useInWhatIf(model)
      return
    }
    try {
      await api.prepareModelForWhatIf(model.id)
      const ready = { ...model, has_whatif: true }
      setActiveModel(ready)
      const list = await api.listModels(dataset.id)
      setModels(list)
      onGo('whatif')
    } catch (err) {
      await dialog.alert({ title: 'Could Not Prepare Model', message: err.message, variant: 'danger' })
    }
  }

  const navigateToFix = (page, section) => {
    const target = { page, section, ts: Date.now() }
    window.sessionStorage.setItem('simucast.fixTarget', JSON.stringify(target))
    window.dispatchEvent(new CustomEvent('simucast:route-target', { detail: target }))
    if (page === 'models') {
      const nextSection = sectionForModelsTarget(section)
      setActiveModelsSection(nextSection)
      try { window.localStorage.setItem(`simucast.modelsSection.${dataset?.id}`, nextSection) } catch {}
      setTimeout(() => highlightSection(section), 140)
    } else {
      onGo(page)
    }
  }

  const executeFixAction = (action) => {
    const target = routeToFixTarget(action?.route)
    if (!target) return
    navigateToFix(target.page, target.section)
  }

  const resolveChecklistIssue = (check) => {
    const firstAction = (check?.actions || [])[0]
    if (firstAction) {
      executeFixAction(firstAction)
      return
    }
    const label = String(check?.label || '').toLowerCase()
    const detail = String(check?.detail || '').toLowerCase()
    if (label.includes('missing')) {
      navigateToFix('data', 'fix-cleaning-missing')
    } else if (label.includes('categor')) {
      navigateToFix('data', 'data-section-category_standardization')
    } else if (label.includes('class balance')) {
      navigateToFix('models', 'models-setup-target')
    } else if (label.includes('multicollinearity')) {
      navigateToFix('tests', 'fix-correlation-test')
    } else if (label.includes('split') || detail.includes('split')) {
      navigateToFix('models', 'models-setup-validation')
    } else {
      navigateToFix('models', 'fix-numeric-preprocessing')
    }
  }

  const deleteSavedModel = async (model) => {
    const label = `${algoLabelForTask(model.algorithm, model.metrics?.task)} - ${model.target}`
    const ok = await dialog.confirm({
      title: 'Delete Model',
      message: `Delete saved model "${label}"?`,
      details: 'This removes it from Previous models and removes linked documentation logs.',
      affectedItems: ['Saved model', 'Model settings snapshot', 'Linked documentation entries'],
      cancelLabel: 'Cancel',
      confirmLabel: 'Delete Model',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await api.deleteModel(model.id)
      const list = await api.listModels(dataset.id)
      setModels(list)
    } catch (err) {
      await dialog.alert({ title: 'Could Not Delete Model', message: err.message, variant: 'danger' })
    }
  }

  const restoreModelSettings = (model) => {
    const metrics = model.metrics || {}
    setTarget(model.target || '')
    setFeatures(model.features || [])
    setChosenAlgos([model.algorithm].filter(Boolean))
    setTestSize(metrics.split?.test_size ?? 0.2)
    setValidationMethod(metrics.validation_method || metrics.split?.validation_method || 'standard_split')
    setStratify(metrics.split?.stratified ?? true)
    setClassBalanceStrategy(metrics.class_weight === 'balanced' ? 'balanced' : 'none')
    setNumericPreprocessing(model.preprocessing_pipeline?.numeric_preprocessing || { scaling: 'auto', log_columns: [], integer_columns: [] })
    setCategoricalEncoding(model.preprocessing_pipeline?.encoding?.reduce((acc, item) => {
      acc[item.column] = item.method
      return acc
    }, {}) || {})
    setModelParams({
      ...defaultModelParams(),
      [model.algorithm]: metrics.model_params || defaultModelParams()[model.algorithm] || {},
    })
    setResults({
      models: [{
        id: model.id,
        algorithm: model.algorithm,
        label: algoLabelForTask(model.algorithm, metrics.task),
        target: model.target,
        features: model.features,
        metrics: metrics,
        feature_importance: model.feature_importance,
        feature_influence: model.feature_importance,
        model_params: metrics.model_params || {},
        has_whatif: model.has_whatif,
      }],
      skipped: [],
      preprocessing_plan: model.preprocessing_pipeline ? {
        task: metrics.task || 'classification',
        target: model.target,
        features: model.features,
        rows_used: metrics.split_rows?.train ? (metrics.split_rows.train + (metrics.split_rows.test || 0)) : 0,
        rows_dropped: 0,
        encoding: model.preprocessing_pipeline.encoding || [],
        scaling: model.preprocessing_pipeline.scaling || [],
        split: metrics.split || {},
        missing_report: [],
        numeric_preprocessing: model.preprocessing_pipeline.numeric_preprocessing || { scaling: 'auto', log_columns: [], integer_columns: [] },
      } : null,
    })
    setActiveResultIdx(0)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const [showHistory, _setShowHistory] = useState(() => {
    try { return sessionStorage.getItem('simucast.showHistory') === 'true' } catch { return false }
  })
  const setShowHistory = (val) => {
    try { sessionStorage.setItem('simucast.showHistory', String(val)) } catch {}
    _setShowHistory(val)
  }
  const [showChecksDetail, setShowChecksDetail] = useState(false)
  const [activeModelsSection, setActiveModelsSection] = useState(() => {
    try {
      const saved = window.localStorage.getItem(`simucast.modelsSection.${dataset?.id}`)
      return saved || 'setup'
    } catch { return 'setup' }
  })


  const planBlocked = plan && (plan.validation_checks || []).some((c) => c.status === 'block')
  const blockedCount = plan ? (plan.validation_checks || []).filter((c) => c.status === 'block').length : 0

  const checks = useMemo(() => {
    const baseChecks = plan?.validation_checks ? [...plan.validation_checks] : []
    if (!plan) return baseChecks

    // Add custom scaling check
    const hasScalingNeeds = selectedAlgos.some(a => a === 'logistic' || a === 'linear')
    const hasNonScalingNeeds = selectedAlgos.some(a => a === 'tree' || a === 'rf')

    let detail = ''
    if (hasScalingNeeds && hasNonScalingNeeds) {
      detail = 'Feature scaling (StandardScaler) will be applied for Logistic/Linear models and skipped for tree-based models.'
    } else if (hasScalingNeeds) {
      detail = 'Feature scaling (StandardScaler) will be applied to numeric features for Logistic/Linear models.'
    } else {
      detail = 'Feature scaling is skipped as it is not needed for tree-based models.'
    }

    baseChecks.push({
      key: 'feature_scaling_check',
      label: 'Feature scaling',
      status: 'ok',
      detail: detail,
      type: 'modeling',
      causes: [],
      fixes: []
    })

    // Add custom encoding check
    let encodingDetail = ''
    if (plan.encoding && plan.encoding.length > 0) {
      encodingDetail = `${plan.encoding.length} categorical feature(s) will be automatically one-hot encoded.`
    } else {
      encodingDetail = 'No categorical features selected; encoding is not required.'
    }

    baseChecks.push({
      key: 'categorical_encoding_check',
      label: 'Categorical encoding',
      status: 'ok',
      detail: encodingDetail,
      type: 'modeling',
      causes: [],
      fixes: []
    })

    return baseChecks
  }, [plan, selectedAlgos])

  const activeIssues = useMemo(() => {
    return checks.filter((c) => {
      const dismissed = (dismissedChecks || []).includes(c.key)
      const effective = dismissed && c.status === 'warning' ? 'ok' : c.status
      return effective === 'block' || effective === 'warning'
    })
  }, [checks, dismissedChecks])

  const issueCount = activeIssues.length
  const activeIssue = activeIssues[0]

  const highlightActiveIssue = () => {
    const bar = document.querySelector('.models-issue-bar')
    if (bar) {
      bar.scrollIntoView({ behavior: 'smooth', block: 'center' })
      bar.classList.add('ax-fix-highlight')
      setTimeout(() => bar.classList.remove('ax-fix-highlight'), 2600)
    }
  }

  const getCategoryOrder = (column, samples = []) => {
    const saved = categoricalOrders[column] || []
    const merged = [...saved, ...samples].map(v => String(v))
    return Array.from(new Set(merged)).filter(Boolean)
  }

  const moveCategoryOrderValue = (column, samples, fromIndex, toIndex) => {
    const order = getCategoryOrder(column, samples)
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= order.length || toIndex >= order.length || fromIndex === toIndex) return
    const next = [...order]
    const [item] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, item)
    setCategoricalOrders(prev => ({ ...prev, [column]: next }))
  }

  const resetCategoryOrder = (column) => {
    setCategoricalOrders(prev => {
      const next = { ...prev }
      delete next[column]
      return next
    })
  }

  const inferredTask = plan?.task || 'regression'
  const setupTotalRows = Math.max(0, Number(plan?.rows_used || dataset?.n_rows || dataset?.rows_count || dataset?.row_count || 0))
  const setupTestRows = validationMethod === 'standard_split' ? Math.round(setupTotalRows * testSize) : 0
  const setupTrainRows = validationMethod === 'standard_split' ? Math.max(0, setupTotalRows - setupTestRows) : 0
  const setupTrainPct = Math.round((1 - testSize) * 100)
  const setupTestPct = Math.round(testSize * 100)
  const [activeFold, setActiveFold] = useState(0)

  useEffect(() => {
    if (validationMethod !== 'cross_validation') return
    const id = setInterval(() => setActiveFold(f => (f + 1) % cvFolds), 2200)
    return () => clearInterval(id)
  }, [validationMethod, cvFolds])

  const jumpToModelsSection = (section) => {
    setActiveModelsSection(section)
    try { window.localStorage.setItem(`simucast.modelsSection.${dataset?.id}`, section) } catch {}
    if (section === 'history') setShowHistory(true)
    requestAnimationFrame(() => {
      document.querySelector('.ax-models-main')?.scrollTo({ top: 0, behavior: 'auto' })
      window.scrollTo({ top: 0, behavior: 'auto' })
    })
  }

  useEffect(() => {
    const onOpenSection = (event) => {
      const section = event.detail?.section
      if (!section) return
      jumpToModelsSection(section)
    }
    window.addEventListener('simucast:models-section-open', onOpenSection)
    return () => window.removeEventListener('simucast:models-section-open', onOpenSection)
  }, [dataset?.id, models.length, results?.models?.length, features.length])

  const modelsNavItems = [
    { id: 'setup', label: 'Setup', icon: SlidersHorizontal, badge: `${selectedAlgos.length} algos` },
    { id: 'results', label: 'Results', icon: BarChart3, badge: `${models.length || results?.models?.length || 0} model${(models.length || results?.models?.length || 0) === 1 ? '' : 's'}` },
    { id: 'features', label: 'Feature influence', icon: Activity, badge: `${features.length} features` },
    { id: 'tune', label: 'Tune hyperparameters', icon: Brain, badge: 'Smart defaults' },
    { id: 'history', label: 'History', icon: History, badge: `${models.length} run${models.length === 1 ? '' : 's'}` },
  ]

  useEffect(() => {
    if (!aiExplainActive) return undefined
    const onPersistentControl = (event) => {
      const tab = event.target?.closest?.('.ax-edge-tab')
      const floating = event.target?.closest?.('.ax-floating-pill-action, .ax-floating-pill-dismiss')
      if (!tab && !floating) return
      event.preventDefault()
      event.stopPropagation()
      if (floating) {
        const isDataset = floating.classList.contains('dataset')
        const isDismiss = floating.classList.contains('ax-floating-pill-dismiss')
        onExplain({
          type: 'persistent-control',
          metricKey: 'persistent-control',
          section: 'Models',
          title: isDismiss ? 'Floating tools close button' : isDataset ? 'Dataset button' : 'Ask AI button',
          label: isDismiss ? 'Close/minimize' : isDataset ? 'Dataset' : 'Ask AI',
          simple: isDismiss
            ? 'This hides the floating utility pill.'
            : isDataset
              ? 'This opens the active dataset preview without leaving the Models page.'
              : 'This opens the conversational assistant. It is different from Explain Mode.',
          datasetExplanation: isDataset
            ? `Use this to inspect ${dataset?.filename || dataset?.name || 'the dataset'} before or after training.`
            : isDismiss
              ? 'It only hides the floating utility controls; it does not change model settings.'
              : 'Ask AI can answer broader questions, while Explain Mode explains the exact UI element you click.',
          whyItMatters: 'These controls are persistent across the workspace and support the modeling workflow without changing the current page.',
          verdict: isDataset ? 'Use it to verify the data behind model training.' : isDismiss ? 'Safe to use when the pill is in the way.' : 'Use Ask AI for broader follow-up questions.',
          verdictTone: 'good',
        }, event)
        return
      }
      const isHistory = tab.classList.contains('history')
      onExplain({
        type: 'side-tab',
        metricKey: 'side-tab',
        section: 'Models',
        title: isHistory ? 'History tab' : 'Guide tab',
        label: isHistory ? 'History' : 'Guide',
        simple: isHistory ? 'This opens the activity/history panel.' : 'This opens contextual guidance for the current workflow.',
        datasetExplanation: isHistory ? 'History helps review earlier modeling runs and app actions.' : 'Guide explains the recommended path through setup, results, feature influence, tuning, and history.',
        whyItMatters: 'Side tabs keep support available without taking you away from the Models page.',
        verdict: isHistory ? 'Use it to audit previous decisions.' : 'Use it when you need workflow guidance.',
        verdictTone: 'good',
      }, event)
    }
    document.addEventListener('pointerdown', onPersistentControl, true)
    document.addEventListener('click', onPersistentControl, true)
    return () => {
      document.removeEventListener('pointerdown', onPersistentControl, true)
      document.removeEventListener('click', onPersistentControl, true)
    }
  }, [aiExplainActive, dataset?.filename, dataset?.name, onExplain])

  return (
    <div className={`ax-models-layout ax-busy-host ax-operation-busy ${training ? 'is-busy' : ''}`}>
      <BusyOverlay
        active={training}
        title={`Training ${selectedAlgos.length} model${selectedAlgos.length === 1 ? '' : 's'}...`}
        detail="Applying preprocessing, splitting the data, fitting models, and calculating evaluation metrics."
        steps={['Preparing model inputs', 'Training selected algorithms', 'Saving results for What-if and reports']}
      />

      <aside className="ax-models-left">
        <div {...explainAttrs({
          type: 'sidebar',
          metricKey: 'models-sidebar-header',
          section: 'Models sidebar',
          title: 'Build a model header',
          simple: 'This sidebar organizes the modeling workflow from setup through history.',
          datasetExplanation: `You are configuring predictive models for ${dataset?.filename || dataset?.name || 'the active dataset'}.`,
          whyItMatters: 'Modeling has multiple steps, and this keeps setup, results, feature influence, tuning, and history separated.',
          verdict: 'Use the sidebar to move through the model-building workflow.',
          verdictTone: 'good',
        }, 'ax-models-left-head')}>
          <h1 className="ax-models-title">Build a model</h1>
          <p className="ax-models-sub">Configure, train, and evaluate predictive models</p>
        </div>
        <nav className="ax-models-nav" aria-label="Model sections" style={{ padding: '14px 18px 14px 24px' }}>
          {modelsNavItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                id={`models-nav-${item.id === 'features' ? 'feature-influence' : item.id}`}
                key={item.id}
                type="button"
                className={`ax-models-nav-item ${activeModelsSection === item.id ? 'active' : ''} ${aiExplainActive ? 'ax-explain-selectable' : ''}`}
                onClick={(event) => {
                  if (aiExplainActive) {
                    return onExplain({
                      type: 'models-nav',
                      metricKey: `models-nav-${item.id}`,
                      section: 'Models sidebar',
                      title: `${item.label} navigation item`,
                      label: item.label,
                      value: item.badge,
                      simple: `This navigation item opens the Models ${item.label} view.`,
                      datasetExplanation: `${item.badge} is the current count or status for ${item.label}.`,
                      whyItMatters: 'Each Models subpage answers a different part of the modeling workflow.',
                      verdict: item.id === activeModelsSection ? 'You are currently viewing this section.' : 'Turn off Explain Mode to navigate here.',
                      verdictTone: item.id === activeModelsSection ? 'good' : 'warning',
                    }, event)
                  }
                  jumpToModelsSection(item.id)
                }}
              >
                <span className="ax-models-nav-icon"><Icon size={14} /></span>
                <span>{item.label}</span>
                <span className="ax-models-nav-badge">{item.badge}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      <main className="ax-models-main">

      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-accent, #f97316)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Models · {modelsNavItems.find(i => i.id === activeModelsSection)?.label || activeModelsSection}
        </span>
        <button
          type="button"
          className={`ax-explain-mode-toggle ${aiExplainActive ? 'active' : ''}`}
          onClick={handleToggleExplain}
          title={aiExplainActive ? 'Turn off Explain Mode' : 'Turn on Explain Mode'}
        >
          ✨ Explain Mode <span />
        </button>
      </div>

      {activeModelsSection === 'setup' && (
        <>
      <div className="ax-models-setup-grid">
        <section id="models-setup-configuration" {...explainAttrs({
          type: 'setup-card',
          metricKey: 'models-setup-configuration-card',
          section: 'Models setup',
          title: 'Configuration card',
          simple: 'This card defines what the model predicts, which columns it can use, which algorithms to train, and how validation will work.',
          datasetExplanation: `Target: ${target || 'not selected'}. Features: ${features.length} of ${allFeatureNames.length}. Algorithms: ${selectedAlgos.length}. Validation: ${validationMethod === 'standard_split' ? `${setupTrainPct}/${setupTestPct} split` : `${cvFolds}-fold CV`}.`,
          whyItMatters: 'These choices determine the exact training dataset, model family, and evaluation method.',
          verdict: target && features.length && selectedAlgos.length ? 'Configuration is ready for training.' : 'Choose a target, at least one feature, and at least one algorithm before training.',
          verdictTone: target && features.length && selectedAlgos.length ? 'good' : 'warning',
        }, 'ax-models-setup-section ax-models-setup-config')}>
          <div className="ax-models-setup-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <h2>Configuration</h2>
              <p>Choose the model target and training setup before running algorithms.</p>
            </div>
            <button
              type="button"
              {...explainAttrs({
                type: 'setup-action',
                metricKey: 'models-setup-reset',
                section: 'Models setup',
                title: 'Reset setup button',
                simple: 'This resets the current model setup back to defaults.',
                datasetExplanation: 'It clears the target, features, class options, and results for this page draft.',
                whyItMatters: 'Reset is useful when you want to restart configuration without manually clearing every control.',
                verdict: 'Turn off Explain Mode to reset settings.',
                verdictTone: 'warning',
              })}
              onClick={(event) => {
                if (aiExplainActive) return onExplain({
                  type: 'setup-action',
                  metricKey: 'models-setup-reset',
                  section: 'Models setup',
                  title: 'Reset setup button',
                  simple: 'This resets the current model setup back to defaults.',
                  datasetExplanation: 'It clears the target, features, class options, and results for this page draft.',
                  whyItMatters: 'Reset is useful when you want to restart configuration without manually clearing every control.',
                  verdict: 'Turn off Explain Mode to reset settings.',
                  verdictTone: 'warning',
                }, event)
                setTarget('')
                setTargetMode('auto')
                setPositiveClass('')
                setFeatures([])
                setChosenAlgos(['logistic', 'rf'])
                setResults(null)
              }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--color-text-tertiary, #9ca3af)', fontFamily: 'inherit', padding: '2px 0', whiteSpace: 'nowrap' }}
            >
              ↺ Reset
            </button>
          </div>
          <div className="ax-models-config-grid">
            <div id="models-setup-target" {...explainAttrs({
              type: 'setup-control',
              metricKey: 'models-setup-target-variable',
              section: 'Models setup',
              title: 'Target variable dropdown',
              simple: 'The target variable is the column the model learns to predict.',
              datasetExplanation: target ? `${target} is the current prediction target.` : 'No target variable is selected yet.',
              whyItMatters: 'The target decides whether the task is classification or regression and which metrics are meaningful.',
              verdict: target ? 'Target is selected.' : 'Select a target before training.',
              verdictTone: target ? 'good' : 'warning',
            }, 'ax-models-config-control', true)}>
            <ConfigDropdown label="Target variable" value={target || 'Select target'}>
              {(close) => (
                <div className="ax-models-config-menu">
                  {variables.map((v) => (
                    <button
                      key={v.name}
                      type="button"
                      className={`ax-models-config-menu-item ${target === v.name ? 'is-active' : ''}`}
                      onClick={() => {
                        setTarget(v.name)
                        setTargetMode('auto')
                        setPositiveClass('')
                        setFeatures(features.filter((f) => f !== v.name))
                        setResults(null)
                        close()
                      }}
                    >
                      <span>{v.name}</span>
                      <em>{v.dtype}</em>
                    </button>
                  ))}
                </div>
              )}
            </ConfigDropdown>
            </div>
            <div id="models-setup-features" {...explainAttrs({
              type: 'setup-control',
              metricKey: 'models-setup-features',
              section: 'Models setup',
              title: 'Features dropdown',
              simple: 'Features are the input columns the model can use to make predictions.',
              datasetExplanation: `${features.length} of ${allFeatureNames.length} available features are selected.`,
              whyItMatters: 'Too few features can underfit, while noisy or leaking features can create misleading performance.',
              verdict: features.length ? 'Feature selection is available for training.' : 'Select at least one feature.',
              verdictTone: features.length ? 'good' : 'warning',
            }, 'ax-models-config-control', true)}>
            <ConfigDropdown label="Features" value={`${features.length} of ${allFeatureNames.length} selected`}>
              {() => (
                <div className="ax-models-config-menu">
                  <div className="ax-models-config-menu-actions">
                    <button type="button" onClick={selectAll}>Select all</button>
                    <button type="button" onClick={selectNone}>Clear</button>
                  </div>
                  <div className="ax-models-config-check-list">
                    {candidateFeatures.map((feature) => (
                      <label key={feature.name} className={features.includes(feature.name) ? 'is-active' : ''}>
                        <input type="checkbox" checked={features.includes(feature.name)} onChange={() => toggleFeature(feature.name)} />
                        <span>{feature.name}</span>
                        <em>{feature.dtype || feature.type || 'field'}</em>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </ConfigDropdown>
            </div>
            <div id="models-setup-algorithms" {...explainAttrs({
              type: 'setup-control',
              metricKey: 'models-setup-algorithms',
              section: 'Models setup',
              title: 'Algorithms dropdown',
              simple: 'Algorithms are the model types SimuCast will train and compare.',
              datasetExplanation: `${selectedAlgos.length} compatible algorithm${selectedAlgos.length === 1 ? '' : 's'} are selected for ${inferredTask}.`,
              whyItMatters: 'Training multiple algorithms helps compare accuracy, robustness, and overfitting risk.',
              verdict: selectedAlgos.length ? 'At least one algorithm is selected.' : 'Select at least one algorithm.',
              verdictTone: selectedAlgos.length ? 'good' : 'warning',
            }, 'ax-models-config-control', true)}>
            <ConfigDropdown label="Algorithms" value={`${selectedAlgos.length} selected`}>
              {() => (
                <div className="ax-models-config-menu">
                  <div className="ax-models-config-check-list">
                    {ALGOS.map((algo) => {
                      const detail = SETUP_ALGO_DETAILS[algo.key]
                      const compatible = !plan || algo.task === 'both' || algo.task === inferredTask
                      const included = compatible && chosenAlgos.includes(algo.key)
                      return (
                        <label key={algo.key} className={included ? 'is-active' : ''} title={!compatible ? `Not compatible with ${inferredTask} target` : undefined}>
                          <input
                            type="checkbox"
                            checked={included}
                            disabled={!compatible || (auth.isGuest && !chosenAlgos.includes(algo.key) && guestModelsRemaining <= selectedAlgos.length)}
                            onChange={() => toggleAlgo(algo.key)}
                          />
                          <span>{detail.name}</span>
                          <em>{compatible ? 'available' : 'disabled'}</em>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </ConfigDropdown>
            </div>
            <div id="models-setup-validation" {...explainAttrs({
              type: 'setup-control',
              metricKey: 'models-setup-validation',
              section: 'Models setup',
              title: 'Validation dropdown',
              simple: 'Validation controls how SimuCast separates training data from evaluation data.',
              datasetExplanation: validationMethod === 'standard_split'
                ? `Using a ${setupTrainPct}/${setupTestPct} train/test split with about ${setupTrainRows} train rows and ${setupTestRows} test rows.`
                : `Using ${cvFolds}-fold cross-validation.`,
              whyItMatters: 'Validation estimates how the model performs on rows it did not learn from.',
              verdict: 'Use validation to detect overfitting and compare models fairly.',
              verdictTone: 'good',
            }, 'ax-models-config-control', true)}>
            <ValidationDropdown
              validationMethod={validationMethod}
              setValidationMethod={setValidationMethod}
              testSize={testSize}
              setTestSize={setTestSize}
              cvFolds={cvFolds}
              setCvFolds={setCvFolds}
              plan={plan}
              stratify={stratify}
              setStratify={setStratify}
              classBalanceStrategy={classBalanceStrategy}
              setClassBalanceStrategy={setClassBalanceStrategy}
              checks={checks}
              onNavigateToCategorical={() => {
                onGo('describe', null)
                setTimeout(() => window.dispatchEvent(new CustomEvent('simucast:describe-section-open', { detail: { section: 'categorical' } })), 200)
              }}
            />
            </div>
          </div>
          <button
            type="button"
            className={`ax-models-dataset-preview-link ${aiExplainActive ? 'ax-explain-selectable' : ''}`}
            onClick={(event) => {
              if (aiExplainActive) return onExplain({
                type: 'setup-action',
                metricKey: 'models-setup-preview-dataset',
                section: 'Models setup',
                title: 'Preview modeling dataset link',
                simple: 'This opens the dataset preview directly on the modeling dataset view.',
                datasetExplanation: 'The modeling view shows the cleaned data that will be used for training before scaling and encoding are applied inside the pipeline.',
                whyItMatters: 'It lets you verify what rows and columns are being fed into model training.',
                verdict: 'Use this before training if you want to audit the modeling data.',
                verdictTone: 'good',
              }, event)
              window.dispatchEvent(new CustomEvent('simucast:open-dataset-preview', {
                detail: { viewMode: 'modeling' },
              }))
            }}
          >
            Preview modeling dataset →
          </button>
          <div className="ax-models-config-actions">
            <p>{planBlocked ? 'Resolve the active data issue before training.' : 'Ready when target, features, and at least one algorithm are selected.'}</p>
            <button
              id="models-run-training-btn"
              className={`ax-models-train-btn ${aiExplainActive ? 'ax-explain-selectable' : ''}`}
              disabled={!aiExplainActive && (!planBlocked && (training || !target || features.length === 0 || selectedAlgos.length === 0 || guestModelLimitReached || guestSelectionOverLimit))}
              onClick={(event) => {
                if (aiExplainActive) return onExplain({
                  type: 'setup-action',
                  metricKey: 'models-setup-train-models-button',
                  section: 'Models setup',
                  title: 'Train models button',
                  simple: 'This starts model training using the selected target, features, algorithms, validation method, preprocessing, and tuning hyperparameters.',
                  datasetExplanation: target && features.length && selectedAlgos.length
                    ? `Ready to train ${selectedAlgos.length} algorithm${selectedAlgos.length === 1 ? '' : 's'} to predict ${target} with ${features.length} feature${features.length === 1 ? '' : 's'}.`
                    : 'Training requires a target, at least one feature, and at least one algorithm.',
                  whyItMatters: 'Training creates the saved models, metrics, feature influence, and What-if model options.',
                  verdict: target && features.length && selectedAlgos.length && !planBlocked ? 'Ready to train.' : planBlocked ? 'Resolve the active issue before training.' : 'Complete the setup before training.',
                  verdictTone: target && features.length && selectedAlgos.length && !planBlocked ? 'good' : 'warning',
                }, event)
                return planBlocked ? highlightActiveIssue() : train()
              }}
              type="button"
            >
              {training ? <InlineSpinner label="Training..." /> : <><Sparkles size={14} /> Train models</>}
            </button>
          </div>
        </section>

        {false && <>
        <section className="ax-models-setup-section">
          <div className="ax-models-setup-head">
            <div>
              <h2>Features</h2>
              <p>{features.length} of {allFeatureNames.length} selected</p>
            </div>
            <div className="ax-models-setup-links">
              <button type="button" onClick={selectAll}>Select all</button>
              <span>·</span>
              <button type="button" onClick={selectNone}>Clear</button>
            </div>
          </div>
          <div className="ax-models-feature-grid">
            {candidateFeatures.map((feature) => {
              const selected = features.includes(feature.name)
              const dtype = feature.dtype || feature.type || 'field'
              const skew = Number(feature.skew ?? feature.stats?.skew ?? 0)
              const isNumeric = ['numeric', 'int', 'float', 'number'].includes(dtype)
              const isSkewed = isNumeric && Math.abs(skew) >= 1
              return (
                <label key={feature.name} className={`ax-models-feature-chip ${selected ? 'is-selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleFeature(feature.name)}
                  />
                  <span className="ax-models-feature-name">{feature.name}</span>
                  {isSkewed && <span className="ax-models-skew-dot" title="Skewed numeric feature" />}
                  <span className="ax-models-feature-type">{dtype}</span>
                </label>
              )
            })}
          </div>
        </section>

        <section className="ax-models-setup-section">
          <div className="ax-models-setup-head">
            <div>
              <h2>Algorithms</h2>
              <p>{selectedAlgos.length} selected for {inferredTask}</p>
            </div>
          </div>
          <div className="ax-models-algo-grid">
            {ALGOS.map((algo) => {
              const detail = SETUP_ALGO_DETAILS[algo.key]
              const compatible = !plan || algo.task === 'both' || algo.task === inferredTask
              const included = compatible && chosenAlgos.includes(algo.key)
              const typeLabel = algo.task === 'classification'
                ? 'Classification only'
                : algo.task === 'regression'
                  ? 'Regression'
                  : inferredTask === 'classification'
                    ? 'Classification'
                    : 'Regression'
              return (
                <article
                  key={algo.key}
                  className={`ax-models-algo-card ${!compatible ? 'is-disabled' : ''}`}
                  style={{ '--algo-color': detail.color }}
                  title={!compatible ? `Not compatible with ${inferredTask} target` : undefined}
                >
                  <div className="ax-models-algo-card-top">
                    <h3>{detail.name}</h3>
                    <button
                      type="button"
                      className={`ax-models-toggle ${included ? 'is-on' : ''}`}
                      disabled={!compatible || (auth.isGuest && !chosenAlgos.includes(algo.key) && guestModelsRemaining <= selectedAlgos.length)}
                      onClick={() => toggleAlgo(algo.key)}
                      aria-label={`${included ? 'Exclude' : 'Include'} ${detail.name}`}
                    >
                      <span />
                    </button>
                  </div>
                  <div className="ax-models-algo-meta">
                    <span>{typeLabel}</span>
                    <strong>{included ? 'included' : compatible ? 'excluded' : 'disabled'}</strong>
                  </div>
                  <p>{detail.description}</p>
                  <div className="ax-models-algo-best"><span>Best for:</span> {detail.bestFor}</div>
                </article>
              )
            })}
          </div>
        </section>
        </>}

      </div>

      {/* ── Preprocessing plan ─────────────────────────────────── */}
      <div style={{ marginTop: 16 }} {...explainAttrs({
        type: 'preplan-card',
        metricKey: 'models-preplan-card',
        section: 'Preprocessing plan',
        title: 'Preprocessing plan card',
        simple: 'This section details and lets you customize how the system handles numeric scaling and categorical encoding before model training.',
        datasetExplanation: 'It automatically runs checks for missing values, category sizes, class balance, and collinearity.',
        whyItMatters: 'Preprocessing choices (like scaling features or ordering category ranks) directly impact algorithm performance and convergence.',
        verdict: 'Review the scaling and encoding configuration before kicking off training.',
        verdictTone: 'good',
      }, 'ax-preplan-card')} id="models-preplan">
        <div className="ax-preplan-head">
          <div>
            <span className="ax-preplan-title">Preprocessing plan</span>
            <span className="ax-preplan-sub">How your data will be cleaned and prepared for training</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {planLoading && <InlineSpinner label="" />}
            {!planLoading && plan && issueCount === 0 && (
              <span className="ax-preplan-badge ax-preplan-badge--ok"><Check size={10} /> Ready</span>
            )}
            {!planLoading && plan && issueCount > 0 && (
              <span className="ax-preplan-badge ax-preplan-badge--warn"><AlertTriangle size={10} /> {issueCount} issue{issueCount !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>

        {(!target || features.length === 0) && (
          <p className="ax-preplan-empty">Select a target variable and at least one feature to see the preprocessing plan.</p>
        )}

        {target && features.length > 0 && planLoading && !plan && (
          <p className="ax-preplan-empty">Analyzing data…</p>
        )}

        {target && features.length > 0 && !planLoading && planError && !plan && (
          <p className="ax-preplan-empty ax-preplan-empty--error">{planError}</p>
        )}

        {plan && (
          <>
            {/* ── Data readiness checks ── */}
            <div {...explainAttrs({
              type: 'preplan-data-readiness',
              metricKey: 'models-preplan-data-readiness',
              section: 'Preprocessing plan',
              title: 'Data readiness section',
              simple: 'This section checks your dataset for common issues before model training.',
              datasetExplanation: `Currently showing ${checks.length} readiness check${checks.length === 1 ? '' : 's'}.`,
              whyItMatters: 'Verifying data health ensures that model assumptions are not violated.',
              verdict: issueCount > 0 ? `Please review the ${issueCount} warning/blocker.` : 'All checklist items are in a healthy state.',
              verdictTone: issueCount > 0 ? 'warning' : 'good',
            }, 'ax-preplan-section')}>
              <h4 className="ax-preplan-section-title">Data readiness</h4>
              <div className="ax-preplan-checks">
                {checks.map((check, idx) => {
                  const dismissed = dismissedChecks.includes(check.key)
                  const effective = dismissed && check.status === 'warning' ? 'ok' : check.status
                  return (
                    <div
                      key={check.key || idx}
                      {...explainAttrs({
                        type: 'preplan-readiness-check',
                        metricKey: `preplan-readiness-check-${check.key || idx}`,
                        section: 'Preprocessing plan',
                        title: `${check.label} check`,
                        label: check.label,
                        simple: check.detail || 'Data readiness validation check.',
                        datasetExplanation: `Check status: ${effective.toUpperCase()}.`,
                        whyItMatters: 'Failing checks or unresolved warnings can lead to unstable model training or poor predictions.',
                        verdict: dismissed ? 'This warning has been dismissed.' : check.status === 'ok' ? 'Check passed.' : 'Use the Fix Options dropdown to address this issue.',
                        verdictTone: effective === 'ok' ? 'good' : effective === 'warning' ? 'warning' : 'risk',
                      }, `ax-preplan-check ax-preplan-check--${effective}`)}
                    >
                      <span className="ax-preplan-check-dot" />
                      <div className="ax-preplan-check-body">
                        <span className="ax-preplan-check-label">{check.label}</span>
                        {check.detail && <span className="ax-preplan-check-detail">{check.detail}</span>}
                      </div>
                      {!dismissed && (check.fixes || []).length > 0 && (
                        <FixOptionsDropdown
                          fixes={check.fixes.map(f => f.category ? { ...f, label: `${f.label} · ${f.category === 'recommended' ? 'Recommended' : f.category === 'alternative' ? 'Alternative' : 'Advanced'}` } : f)}
                          onAction={handleFixAction}
                          canDismiss={check.status === 'warning'}
                          onDismiss={() => setDismissedChecks(d => [...d, check.key])}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ── Numeric scaling ── */}
            <div className="ax-preplan-section">
              <h4
                {...explainAttrs({
                  type: 'preplan-numeric-scaling',
                  metricKey: 'models-preplan-numeric-scaling',
                  section: 'Preprocessing plan',
                  title: 'Numeric scaling section',
                  simple: 'Numeric scaling standardizes features so they have similar ranges, ensuring distance-based or linear models treat them equally.',
                  datasetExplanation: `Current choice: ${numericPreprocessing.scaling.toUpperCase()}.`,
                  whyItMatters: 'Without scaling, features with large absolute ranges dominate features with small ranges in linear/logistic models.',
                  verdict: 'Choose Auto or StandardScaler if training linear models, or None for tree-based models.',
                  verdictTone: 'good',
                }, 'ax-preplan-section-title')}
              >
                Numeric scaling
              </h4>
              <div className="ax-preplan-scale-cards">
                {[
                  { value: 'auto',     label: 'Auto',           tag: 'Recommended', desc: 'StandardScaler for linear models; skipped for tree-based' },
                  { value: 'standard', label: 'StandardScaler', tag: null,          desc: 'Centers to mean 0, unit variance' },
                  { value: 'minmax',   label: 'MinMaxScaler',   tag: null,          desc: 'Rescales all values to [0, 1]' },
                  { value: 'none',     label: 'None',           tag: null,          desc: 'No scaling applied to features' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    {...explainAttrs({
                      type: 'preplan-scale-option',
                      metricKey: `preplan-scale-option-${opt.value}`,
                      section: 'Preprocessing plan',
                      title: `${opt.label} scaling option`,
                      label: opt.label,
                      simple: opt.desc,
                      datasetExplanation: numericPreprocessing.scaling === opt.value ? 'This option is currently selected.' : 'This option is not selected.',
                      whyItMatters: opt.value === 'auto'
                        ? 'Auto standardizes features only for models that need it (logistic/linear) and skips it for trees.'
                        : opt.value === 'none'
                          ? 'Tree-based models do not require scaled features.'
                          : `Applies ${opt.label} to all features.`,
                      verdict: numericPreprocessing.scaling === opt.value ? 'Currently active.' : 'Turn off Explain Mode to select this option.',
                      verdictTone: 'good',
                    }, `ax-preplan-scale-card ${numericPreprocessing.scaling === opt.value ? 'is-active' : ''}`, true)}
                    onClick={() => {
                      if (!aiExplainActive) {
                        setNumericPreprocessing(prev => ({ ...prev, scaling: opt.value }))
                      }
                    }}
                  >
                    <span className="ax-preplan-scale-name">{opt.label}</span>
                    {opt.tag && <span className="ax-preplan-scale-tag">{opt.tag}</span>}
                    <span className="ax-preplan-scale-desc">{opt.desc}</span>
                  </button>
                ))}
              </div>
              <p className="ax-preplan-section-sub" style={{ marginTop: 8, fontStyle: 'italic' }}>
                Your choice will be applied during training. Auto is recommended for most cases.
              </p>
            </div>

            {/* ── Outlier treatment ── */}
            <div className="ax-preplan-section" id="fix-outlier-treatment">
              {plan.outlier_capped_in_data_tab && (
                <div className="ax-preplan-notice ax-preplan-notice--warn">
                  <strong>Outlier capping was already applied in the Data tab.</strong>{' '}
                  That capping was fitted on the full dataset (including test rows), which can cause data leakage.
                  Selecting IQR Cap or Z-score Cap here will cap again on top of those values.
                  To avoid double-capping, use only one approach — either the Data tab <em>or</em> the option below.
                </div>
              )}
              <h4
                {...explainAttrs({
                  type: 'preplan-outlier-treatment',
                  metricKey: 'models-preplan-outlier-treatment',
                  section: 'Preprocessing plan',
                  title: 'Outlier treatment section',
                  simple: 'Caps extreme values in numeric features using bounds computed from training data only, preventing data leakage from the test set.',
                  datasetExplanation: `Current choice: ${(numericPreprocessing.outlier_treatment || 'none').toUpperCase()}.`,
                  whyItMatters: 'Applying outlier bounds to the full dataset before splitting leaks test-set information into the model. This option caps after the split, fitted on training rows only.',
                  verdict: 'Use IQR Cap if you applied outlier capping in the Outliers toolbar — this re-applies it correctly inside the training pipeline.',
                  verdictTone: 'good',
                }, 'ax-preplan-section-title')}
              >
                Outlier treatment
              </h4>
              <div className="ax-preplan-scale-cards">
                {[
                  { value: 'none',   label: 'None',        tag: 'Default', desc: 'No outlier treatment during training' },
                  { value: 'iqr',    label: 'IQR Cap',     tag: null,      desc: 'Cap to Q1−1.5×IQR / Q3+1.5×IQR fitted on training rows' },
                  { value: 'zscore', label: 'Z-score Cap', tag: null,      desc: 'Cap to μ ± 3σ fitted on training rows' },
                  { value: 'remove', label: 'Remove Rows', tag: null,      desc: 'Drop training rows outside IQR bounds (test rows are kept)' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    {...explainAttrs({
                      type: 'preplan-outlier-option',
                      metricKey: `preplan-outlier-option-${opt.value}`,
                      section: 'Preprocessing plan',
                      title: `${opt.label} outlier option`,
                      label: opt.label,
                      simple: opt.desc,
                      datasetExplanation: (numericPreprocessing.outlier_treatment || 'none') === opt.value ? 'This option is currently selected.' : 'This option is not selected.',
                      whyItMatters: opt.value === 'none'
                        ? 'Use None if your dataset has meaningful extreme values or you want no automatic outlier handling.'
                        : opt.value === 'iqr'
                          ? 'IQR Cap matches what the Outliers toolbar applies, but fitted correctly on training data only.'
                          : opt.value === 'zscore'
                            ? 'Z-score Cap trims values beyond 3 standard deviations from the training mean.'
                            : 'Remove Rows drops training rows where any feature exceeds IQR bounds. Test rows are always kept for evaluation.',
                      verdict: (numericPreprocessing.outlier_treatment || 'none') === opt.value ? 'Currently active.' : 'Turn off Explain Mode to select this option.',
                      verdictTone: 'good',
                    }, `ax-preplan-scale-card ${(numericPreprocessing.outlier_treatment || 'none') === opt.value ? 'is-active' : ''}`, true)}
                    onClick={() => {
                      if (!aiExplainActive) {
                        setNumericPreprocessing(prev => ({ ...prev, outlier_treatment: opt.value }))
                      }
                    }}
                  >
                    <span className="ax-preplan-scale-name">{opt.label}</span>
                    {opt.tag && <span className="ax-preplan-scale-tag">{opt.tag}</span>}
                    <span className="ax-preplan-scale-desc">{opt.desc}</span>
                  </button>
                ))}
              </div>
              <p className="ax-preplan-section-sub" style={{ marginTop: 8, fontStyle: 'italic' }}>
                Bounds are computed from training rows only — the test set never influences the caps.
              </p>
            </div>

            {/* ── Categorical encoding ── */}
            {(() => {
              const categoricalColumns = variables.filter(v =>
                features.includes(v.name) && ['category', 'text', 'binary', 'boolean'].includes(v.dtype)
              )
              if (!categoricalColumns.length) return null
              return (
                <div className="ax-preplan-section">
                  <h4
                    {...explainAttrs({
                      type: 'preplan-encoding-section',
                      metricKey: 'models-preplan-encoding-section',
                      section: 'Preprocessing plan',
                      title: 'Encoding per column section',
                      simple: 'Categorical variables must be converted to numeric values before models can learn from them.',
                      datasetExplanation: `Currently encoding ${categoricalColumns.length} categorical feature${categoricalColumns.length === 1 ? '' : 's'}.`,
                      whyItMatters: 'One-hot encoding is best for unordered categories, whereas Ordinal encoding is best when categories have a natural rank.',
                      verdict: 'Configure the encoding method and category order per column.',
                      verdictTone: 'good',
                    }, 'ax-preplan-section-title')}
                  >
                    Encoding per column
                  </h4>
                  <p className="ax-preplan-section-sub">Select how categorical variables are converted to numeric values before model training.</p>
                  <table className="ax-preplan-enc-table">
                    <thead>
                      <tr>
                        <th>COLUMN</th>
                        <th>VALUES / ORDER</th>
                        <th>ENCODING METHOD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoricalColumns.map(col => {
                        const isStandardized = standardizedCols.has(col.name)
                        const currentVal = isStandardized ? 'standardized' : (categoricalEncoding[col.name] || 'auto')
                        const encItem = plan?.encoding?.find(e => e.column === col.name)
                        const recLabel = encItem?.method === 'binary' ? 'Binary' : encItem?.method === 'ordinal' ? 'Ordinal' : 'One-Hot'
                        const sampleCategories = encItem?.sample_categories || []
                        const orderedCategories = getCategoryOrder(col.name, sampleCategories)
                        const usesOrder = currentVal === 'ordinal' || currentVal === 'binary' || (!categoricalEncoding[col.name] && encItem?.method === 'ordinal')
                        return (
                          <tr key={col.name} style={{ opacity: isStandardized ? 0.72 : 1 }}>
                            <td
                              {...explainAttrs({
                                type: 'preplan-column-encoding',
                                metricKey: `preplan-column-encoding-${col.name}`,
                                section: 'Preprocessing plan',
                                title: `Encoding for column ${col.name}`,
                                label: col.name,
                                simple: `Preprocessing configuration for the "${col.name}" categorical column.`,
                                datasetExplanation: `It has data type ${col.dtype} and is ${isStandardized ? 'standardized' : 'raw'}.`,
                                whyItMatters: 'Different columns have different categorical semantics (e.g. nominal vs ordinal).',
                                verdict: `Method: ${currentVal.toUpperCase()}.`,
                                verdictTone: 'good',
                              }, 'ax-preplan-enc-col')}
                            >
                              {col.name}
                            </td>
                            <td
                              {...explainAttrs({
                                type: 'preplan-column-categories',
                                metricKey: `preplan-column-categories-${col.name}`,
                                section: 'Preprocessing plan',
                                title: `Categories for column ${col.name}`,
                                label: `${col.name} categories`,
                                simple: `Displays categories in the "${col.name}" column. If Ordinal is selected, you can drag to define their ranks.`,
                                datasetExplanation: `Categories: ${orderedCategories.join(', ')}.`,
                                whyItMatters: 'Ordinal encoding maps ranks to numbers (0, 1, 2...). Correct ordering is vital for the model to capture directionality.',
                                verdict: usesOrder ? 'Drag chips to change order. Turn off Explain Mode to reorder.' : 'Select Ordinal encoding to drag and reorder.',
                                verdictTone: 'good',
                              }, 'ax-preplan-enc-vals', true)}
                            >
                              {orderedCategories.length ? (
                                <div className={`ax-models-order-chips ${usesOrder ? 'is-reorderable' : ''}`}>
                                  {orderedCategories.map((value, chipIdx) => (
                                    <span
                                      key={`${col.name}-${value}`}
                                      className="ax-models-order-chip"
                                      draggable={usesOrder}
                                      onDragStart={e => { if (!usesOrder) return; e.dataTransfer.setData('text/plain', String(chipIdx)); e.dataTransfer.effectAllowed = 'move' }}
                                      onDragOver={e => { if (!usesOrder) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                                      onDrop={e => { if (!usesOrder) return; e.preventDefault(); moveCategoryOrderValue(col.name, sampleCategories, Number(e.dataTransfer.getData('text/plain')), chipIdx) }}
                                    >
                                      {usesOrder && <span className="ax-models-order-handle">::</span>}
                                      {value}
                                    </span>
                                  ))}
                                  {usesOrder && categoricalOrders[col.name]?.length > 0 && (
                                    <button type="button" className="ax-models-order-reset" onClick={() => resetCategoryOrder(col.name)}>Reset</button>
                                  )}
                                </div>
                              ) : (
                                <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>No samples</span>
                              )}
                            </td>
                            <td
                              {...explainAttrs({
                                type: 'preplan-column-method',
                                metricKey: `preplan-column-method-${col.name}`,
                                section: 'Preprocessing plan',
                                title: `Encoding method for column ${col.name}`,
                                label: `${col.name} encoding method`,
                                simple: 'Choose how categorical strings/booleans are converted to numerical values.',
                                datasetExplanation: `Current selection: ${currentVal.toUpperCase()}. Recommendation: Auto (${recLabel}).`,
                                whyItMatters: 'One-Hot splits a column into multiple binary flags. Ordinal encodes ranks into a single integer. Binary uses base-2 conversion to save dimensionality.',
                                verdict: 'Turn off Explain Mode to change encoding method.',
                                verdictTone: 'good',
                              }, 'ax-preplan-enc-method', true)}
                            >
                              {isStandardized ? (
                                <select disabled style={{ fontSize: '11.5px', padding: '2px 6px', background: 'var(--color-background-secondary)' }}>
                                  <option>Standardized ✓</option>
                                </select>
                              ) : (
                                <select
                                  value={currentVal}
                                  onChange={e => {
                                    if (!aiExplainActive) setCategoricalEncoding(prev => ({ ...prev, [col.name]: e.target.value }))
                                  }}
                                  style={{ fontSize: '11.5px', padding: '2px 6px' }}
                                >
                                  <option value="auto">Auto ({recLabel})</option>
                                  <option value="one_hot">One-Hot</option>
                                  <option value="ordinal">Ordinal</option>
                                  <option value="binary">Binary</option>
                                </select>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </>
        )}
      </div>

      {false && <>
      <PageGuide
        title="Modeling works best after a clean question"
        meta="Models"
        steps={['Pick target', 'Choose features', 'Set validation', 'Train and check health']}
      >
        SimuCast helps choose sensible targets and features, then compares train and test performance so overfitting is visible.
      </PageGuide>

      <section className="ax-models-ready-card" aria-label="Training summary">
        <div className="ax-models-ready-icon"><Sparkles size={22} /></div>
        <h2>Ready to train</h2>
        <p>Configure your target, features, and algorithms on the left, then train the selected models.</p>
        <div className="ax-models-ready-rows">
          <div><span>Target</span><strong>{target || 'Not selected'}</strong></div>
          <div><span>Features</span><strong>{features.length} of {allFeatureNames.length}</strong></div>
          <div><span>Validation</span><strong>{validationMethod === 'standard_split' ? `${Math.round((1 - testSize) * 100)}/${Math.round(testSize * 100)} Split` : `${cvFolds}-fold CV`}</strong></div>
          <div><span>Algorithms</span><strong>{selectedAlgos.length} selected</strong></div>
        </div>
      </section>

      {/* Inline Configuration Card */}
      <div
        id="fix-target-handling"
        className="ax-card"
        style={{
          padding: '12px 16px',
          background: 'var(--color-background-primary)',
          border: '1.5px solid var(--color-border-tertiary)',
          borderRadius: '12px',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          alignItems: 'stretch',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16
        }}
      >
        {/* TARGET Dropdown */}
        <div id="models-step-1" style={{ display: 'flex', alignItems: 'stretch', flex: 1, minWidth: 140 }}>
          <ConfigDropdown label="Target" value={target || 'Select Target'}>
            {(close) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 4px', fontWeight: 600, textTransform: 'uppercase' }}>Select target variable</p>
                {variables.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    onClick={() => {
                      setTarget(v.name)
                      setTargetMode('auto')
                      setPositiveClass('')
                      setFeatures(features.filter((f) => f !== v.name))
                      setResults(null)
                      close()
                      window.dispatchEvent(new CustomEvent('simucast:target-selected'))
                    }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 12,
                      background: target === v.name ? 'var(--color-accent-light)' : 'none',
                      border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: target === v.name ? 700 : 400,
                      color: target === v.name ? 'var(--color-accent-dark)' : 'var(--color-text-primary)'
                    }}
                    onMouseEnter={(e) => { if (target !== v.name) e.currentTarget.style.background = 'var(--color-background-secondary)' }}
                    onMouseLeave={(e) => { if (target !== v.name) e.currentTarget.style.background = 'none' }}
                  >
                    {v.name} <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 4, fontWeight: 400 }}>({v.dtype})</span>
                  </button>
                ))}
              </div>
            )}
          </ConfigDropdown>
        </div>

        {/* FEATURES Dropdown */}
        <div id="fix-feature-selection" style={{ display: 'flex', alignItems: 'stretch', flex: 1, minWidth: 140 }}>
          <ConfigDropdown label="Features" value={`${features.length} of ${allFeatureNames.length}`}>
            {() => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Select features</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="ax-btn mini" onClick={selectAll} type="button">All</button>
                    <button className="ax-btn mini" onClick={selectNone} type="button" disabled={features.length === 0}>None</button>
                  </div>
                </div>
                {candidateFeatures.map((v) => (
                  <label
                    key={v.name}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                      background: features.includes(v.name) ? 'var(--color-accent-light)' : 'none'
                    }}
                    onMouseEnter={(e) => { if (!features.includes(v.name)) e.currentTarget.style.background = 'var(--color-background-secondary)' }}
                    onMouseLeave={(e) => { if (!features.includes(v.name)) e.currentTarget.style.background = 'none' }}
                  >
                    <input
                      type="checkbox"
                      checked={features.includes(v.name)}
                      onChange={() => toggleFeature(v.name)}
                      style={{ margin: 0 }}
                    />
                    <span style={{ fontWeight: features.includes(v.name) ? 600 : 400, color: 'var(--color-text-primary)' }}>
                      {v.name} <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10, fontWeight: 400 }}>({v.dtype})</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </ConfigDropdown>
        </div>



        {/* VALIDATION Dropdown */}
        <div id="models-step-4" style={{ display: 'flex', alignItems: 'stretch', flex: 1, minWidth: 140 }}>
          <ConfigDropdown
            label="Validation"
            value={
              validationMethod === 'standard_split'
                ? `${Math.round((1 - testSize) * 100)}/${Math.round(testSize * 100)} Split`
                : `${cvFolds}-fold CV`
            }
          >
            {() => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 280 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>Method</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                      <input
                        type="radio"
                        name="validation-method-bar"
                        value="standard_split"
                        checked={validationMethod === 'standard_split'}
                        onChange={() => setValidationMethod('standard_split')}
                      />
                      Train/test split
                    </label>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                      <input
                        type="radio"
                        name="validation-method-bar"
                        value="cross_validation"
                        checked={validationMethod === 'cross_validation'}
                        onChange={() => setValidationMethod('cross_validation')}
                      />
                      Cross-validation
                    </label>
                  </div>
                </div>
                {validationMethod === 'standard_split' ? (
                  <div>
                    <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>
                      Test Split: {Math.round(testSize * 100)}%
                    </label>
                    <input
                      type="range"
                      min="0.05"
                      max="0.5"
                      step="0.05"
                      value={testSize}
                      onChange={(e) => setTestSize(Number(e.target.value))}
                      style={{ width: '100%', height: 16 }}
                    />
                  </div>
                ) : (
                  <div>
                    <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>Folds</label>
                    <select
                      value={cvFolds}
                      onChange={(e) => setCvFolds(Number(e.target.value))}
                      style={{ width: '100%', fontSize: 12, height: 32, minHeight: 32 }}
                    >
                      <option value={3}>3 folds</option>
                      <option value={5}>5 folds (recommended)</option>
                      <option value={10}>10 folds</option>
                    </select>
                  </div>
                )}
                {plan?.task === 'classification' && (
                  <div style={{ borderTop: '0.5px solid var(--color-border-tertiary)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Class Balance</span>
                    {[
                      { value: 'none', label: 'Keep class proportions' },
                      { value: 'balanced', label: 'Balanced class weights' },
                      { value: 'smote', label: 'SMOTE oversampling' },
                    ].map(({ value, label }) => (
                      <label key={value} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                        <input
                          type="radio"
                          name="class-balance-strategy-bar"
                          checked={classBalanceStrategy === value}
                          onChange={() => setClassBalanceStrategy(value)}
                          style={{ accentColor: 'var(--color-accent, #f97316)' }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </ConfigDropdown>
        </div>

        {/* ALGORITHMS Dropdown */}
        <div id="models-step-5" style={{ display: 'flex', alignItems: 'stretch', flex: 1, minWidth: 140 }}>
          <ConfigDropdown label="Algorithms" value={`${selectedAlgos.length} selected`}>
          {() => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 240 }}>
              <label style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 650, textTransform: 'uppercase', marginBottom: 4 }}>Select algorithms</label>
              {visibleAlgos.map((a) => (
                <label
                  key={a.key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                    background: chosenAlgos.includes(a.key) ? 'var(--color-accent-light)' : 'none',
                    opacity: auth.isGuest && !chosenAlgos.includes(a.key) && guestModelsRemaining <= selectedAlgos.length ? 0.5 : 1
                  }}
                  onMouseEnter={(e) => { if (!chosenAlgos.includes(a.key)) e.currentTarget.style.background = 'var(--color-background-secondary)' }}
                  onMouseLeave={(e) => { if (!chosenAlgos.includes(a.key)) e.currentTarget.style.background = 'none' }}
                >
                  <input
                    type="checkbox"
                    checked={chosenAlgos.includes(a.key)}
                    disabled={auth.isGuest && !chosenAlgos.includes(a.key) && guestModelsRemaining <= selectedAlgos.length}
                    onChange={() => toggleAlgo(a.key)}
                    style={{ margin: 0 }}
                  />
                  <span style={{ fontWeight: chosenAlgos.includes(a.key) ? 650 : 400, color: 'var(--color-text-primary)' }}>
                    {algoLabelForTask(a.key, plan?.task)}
                  </span>
                </label>
              ))}
            </div>
          )}
        </ConfigDropdown>
      </div>


        {/* Action Button */}
        <div style={{ display: 'flex', alignItems: 'center', minWidth: '180px', flex: '0 0 200px' }}>
          <button
            id="models-train-action"
            className="ax-btn prim"
            style={{
              width: '100%',
              height: '42px',
              borderRadius: '999px',
              fontSize: '13px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: planBlocked ? '#FEF2F2' : 'var(--color-accent)',
              color: planBlocked ? 'var(--color-text-danger)' : '#fff',
              border: planBlocked ? '1.5px solid var(--color-text-danger)' : 'none',
              boxShadow: planBlocked ? 'none' : '0 8px 16px rgba(249, 115, 22, 0.25)',
              cursor: (training || !target || features.length === 0 || selectedAlgos.length === 0 || guestModelLimitReached || guestSelectionOverLimit) && !planBlocked ? 'not-allowed' : 'pointer'
            }}
            disabled={(!planBlocked && (training || !target || features.length === 0 || selectedAlgos.length === 0 || guestModelLimitReached || guestSelectionOverLimit))}
            onClick={planBlocked ? highlightActiveIssue : train}
            type="button"
          >
            {training ? (
              <InlineSpinner label="" />
            ) : planBlocked ? (
              `Resolve ${blockedCount} block${blockedCount > 1 ? 's' : ''} to train`
            ) : (
              `Train models`
            )}
          </button>
        </div>
      </div>

      {/* Collapsible Advanced Settings (Preprocessing & Encoding) */}
      <div
        id="models-step-6"
        className="ax-card"
        style={{
          padding: '14px 16px',
          background: 'var(--color-background-primary)',
          border: '1.5px solid var(--color-border-tertiary)',
          borderRadius: '12px',
          boxShadow: 'var(--shadow-card)',
          marginBottom: 16
        }}
      >
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setAdvancedOpen(!advancedOpen)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
              Advanced settings
            </span>
            <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
              {advancedOpen ? '' : '• Smart defaults applied'}
            </span>
          </div>
          <span style={{ fontSize: '11px', fontWeight: 650, color: 'var(--color-accent)' }}>
            {advancedOpen ? 'Hide settings ▲' : 'Show settings ▼'}
          </span>
        </div>

        {advancedOpen && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--color-border-tertiary)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 1. Numeric Scaling */}
            <div>
              <h4 style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--color-text-primary)', margin: '0 0 8px' }}>
                Numeric Scaling (Global)
              </h4>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {['auto', 'standard', 'minmax', 'none'].map((val) => (
                  <label key={val} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '12px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="scaling-option"
                      value={val}
                      checked={numericPreprocessing.scaling === val}
                      onChange={() => setNumericPreprocessing(prev => ({ ...prev, scaling: val }))}
                    />
                    <span style={{ textTransform: 'capitalize', fontWeight: numericPreprocessing.scaling === val ? 600 : 400 }}>
                      {val === 'auto' ? 'Auto (Recommended)' : val === 'standard' ? 'StandardScaler' : val === 'minmax' ? 'MinMaxScaler' : 'None'}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* 2. Categorical Encoding (Per Column) */}
            <div>
              <h4 style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--color-text-primary)', margin: '0 0 4px' }}>
                Encoding per column
              </h4>
              <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', margin: '0 0 10px' }}>
                Select how categorical variables are converted to numeric values before model training.
              </p>
              
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1.5px solid var(--color-border-tertiary)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>COLUMN</th>
                    <th style={{ padding: '6px 8px', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>VALUES / ORDER</th>
                    <th style={{ padding: '6px 8px', color: 'var(--color-text-tertiary)', fontWeight: 600, width: 220 }}>ENCODING METHOD</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const categoricalColumns = variables.filter((v) => features.includes(v.name) && ['category', 'text', 'binary', 'boolean'].includes(v.dtype));
                    if (categoricalColumns.length === 0) {
                      return (
                        <tr>
                          <td colSpan={3} style={{ padding: '12px 8px', color: 'var(--color-text-tertiary)', fontStyle: 'italic', textAlign: 'center' }}>
                            No categorical features selected.
                          </td>
                        </tr>
                      );
                    }
                    return categoricalColumns.map((col) => {
                      const isStandardized = standardizedCols.has(col.name);
                      const currentVal = isStandardized ? 'standardized' : (categoricalEncoding[col.name] || 'auto');
                      
                      // Auto-detected suggestions from plan.encoding
                      const encItem = plan?.encoding?.find(e => e.column === col.name);
                      const recLabel = encItem?.method === 'binary' ? 'Binary' : encItem?.method === 'ordinal' ? 'Ordinal' : 'One-Hot';
                      const sampleCategories = encItem?.sample_categories || [];
                      const orderedCategories = getCategoryOrder(col.name, sampleCategories);
                      const usesOrder = currentVal === 'ordinal' || currentVal === 'binary' || (!categoricalEncoding[col.name] && encItem?.method === 'ordinal');
                      
                      const renderSamples = () => {
                        if (!encItem || !encItem.sample_categories) return '';
                        const samples = encItem.sample_categories;
                        if (encItem.method === 'ordinal') {
                          return samples.join(' → ');
                        }
                        return samples.join(' / ');
                      };

                      return (
                        <tr key={col.name} style={{ borderBottom: '1px solid var(--color-border-tertiary)', opacity: isStandardized ? 0.72 : 1 }}>
                          <td style={{ padding: '10px 8px', fontWeight: 600 }}>{col.name}</td>
                          <td style={{ padding: '10px 8px', color: 'var(--color-text-secondary)', fontSize: '11px' }}>
                            {orderedCategories.length ? (
                              <div className={`ax-models-order-chips ${usesOrder ? 'is-reorderable' : ''}`} aria-label={`${col.name} category order`}>
                                {orderedCategories.map((value, idx) => (
                                  <span
                                    key={`${col.name}-${value}`}
                                    className="ax-models-order-chip"
                                    draggable={usesOrder}
                                    title={usesOrder ? 'Drag to reorder this category' : 'Order is not used for this encoding method'}
                                    onDragStart={(e) => {
                                      if (!usesOrder) return
                                      e.dataTransfer.setData('text/plain', String(idx))
                                      e.dataTransfer.effectAllowed = 'move'
                                    }}
                                    onDragOver={(e) => {
                                      if (!usesOrder) return
                                      e.preventDefault()
                                      e.dataTransfer.dropEffect = 'move'
                                    }}
                                    onDrop={(e) => {
                                      if (!usesOrder) return
                                      e.preventDefault()
                                      const fromIndex = Number(e.dataTransfer.getData('text/plain'))
                                      moveCategoryOrderValue(col.name, sampleCategories, fromIndex, idx)
                                    }}
                                  >
                                    {usesOrder && <span className="ax-models-order-handle">::</span>}
                                    {value}
                                  </span>
                                ))}
                                {usesOrder && categoricalOrders[col.name]?.length > 0 && (
                                  <button type="button" className="ax-models-order-reset" onClick={() => resetCategoryOrder(col.name)}>
                                    Reset
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: 'var(--color-text-tertiary)' }}>No category samples</span>
                            )}
                          </td>
                          <td style={{ padding: '10px 8px' }}>
                            {isStandardized ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <select disabled style={{ fontSize: '11.5px', padding: '2px 6px', background: 'var(--color-background-secondary)' }}>
                                  <option>Standardized ✓</option>
                                </select>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <select
                                  value={currentVal}
                                  onChange={(e) => {
                                    setCategoricalEncoding(prev => ({
                                      ...prev,
                                      [col.name]: e.target.value
                                    }))
                                  }}
                                  style={{ fontSize: '11.5px', padding: '2px 6px' }}
                                >
                                  <option value="auto">Auto ({recLabel})</option>
                                  <option value="one_hot">One-Hot</option>
                                  <option value="ordinal">Ordinal</option>
                                  <option value="binary">Binary</option>
                                </select>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Preprocessing plan issue alert */}
      {plan && activeIssues.length > 0 && (
        <div
          className="models-issue-bar"
          style={{
            margin: '12px 0 12px',
            padding: isIssueBarExpanded ? '12px 16px' : '8px 12px',
            background: activeIssues.some((c) => c.status === 'block') ? 'var(--color-background-danger)' : 'var(--color-background-warning)',
            border: `1.5px solid ${activeIssues.some((c) => c.status === 'block') ? 'var(--color-text-danger)' : 'var(--color-border-info)'}`,
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            transition: 'all 0.3s ease-in-out'
          }}
        >
          {isIssueBarExpanded ? (
            <>
              {/* Header Row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,0.08)', paddingBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                    Preprocessing Plan Issues
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', background: activeIssues.some((c) => c.status === 'block') ? '#FEE2E2' : '#FEF3C7', color: activeIssues.some((c) => c.status === 'block') ? '#EF4444' : '#D97706', borderRadius: '4px' }}>
                    {issueCount} issue{issueCount === 1 ? '' : 's'} detected
                  </span>
                </div>
                <button
                  type="button"
                  className="ax-btn"
                  style={{ fontSize: 11, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => setIsIssueBarExpanded(false)}
                >
                  Collapse ▲
                </button>
              </div>

              {/* List of active issues */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {activeIssues.map((issue, idx) => (
                  <div
                    key={issue.key || idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      paddingBottom: idx < activeIssues.length - 1 ? 12 : 0,
                      borderBottom: idx < activeIssues.length - 1 ? '1px dashed var(--color-border-tertiary)' : 'none'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 850,
                          background: issue.status === 'block' ? 'var(--color-text-danger)' : 'var(--color-accent)',
                          color: '#fff',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          letterSpacing: '0.05em'
                        }}
                      >
                        {issue.status.toUpperCase()}
                      </span>
                      <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>
                        {issue.status === 'block' ? 'BLOCK' : 'WARNING'}
                      </span>
                      <span style={{ color: 'var(--color-text-secondary)' }}>
                        {issue.label} on <strong>{target}</strong>
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {issue.fixes && issue.fixes.length > 0 && (
                        <FixOptionsDropdown
                          fixes={issue.fixes.map(f => {
                            if (!f.category) return f
                            const tag = f.category === 'recommended' ? 'Recommended' : f.category === 'alternative' ? 'Alternative' : 'Advanced'
                            return { ...f, label: `${f.label} · ${tag}` }
                          })}
                          onAction={handleFixAction}
                          canDismiss={issue.status === 'warning'}
                          onDismiss={() => setDismissedChecks((d) => [...d, issue.key])}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* Collapsed view (the default alert bar) */
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 850,
                    background: activeIssue.status === 'block' ? 'var(--color-text-danger)' : 'var(--color-accent)',
                    color: '#fff',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    letterSpacing: '0.05em'
                  }}
                >
                  {activeIssue.status.toUpperCase()}
                </span>
                <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {activeIssue.status === 'block' ? 'BLOCK' : 'WARNING'}
                </span>
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  {activeIssue.label} on <strong>{target}</strong>
                </span>
                {issueCount > 1 && (
                  <button
                    type="button"
                    onClick={() => setIsIssueBarExpanded(true)}
                    style={{
                      background: 'rgba(0, 0, 0, 0.05)',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '2px 8px',
                      fontSize: '11px',
                      color: 'var(--color-text-secondary)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontWeight: 600,
                      transition: 'background 0.2s',
                      marginLeft: 4,
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)'}
                  >
                    (+ {issueCount - 1} more issue{issueCount - 1 > 1 ? 's' : ''})
                    <span style={{ fontSize: '8px' }}>▼</span>
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {activeIssue.fixes && activeIssue.fixes.length > 0 && (
                  <FixOptionsDropdown
                    fixes={activeIssue.fixes.map(f => {
                      if (!f.category) return f
                      const tag = f.category === 'recommended' ? 'Recommended' : f.category === 'alternative' ? 'Alternative' : 'Advanced'
                      return { ...f, label: `${f.label} · ${tag}` }
                    })}
                    onAction={handleFixAction}
                    canDismiss={activeIssue.status === 'warning'}
                    onDismiss={() => setDismissedChecks((d) => [...d, activeIssue.key])}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Collapsible Readiness & Preprocessing Checklist */}
      {plan && (
        <div
          className="ax-card"
          style={{
            padding: '12px 16px',
            marginBottom: 16,
            background: 'var(--color-background-primary)',
            border: '1.5px solid var(--color-border-tertiary)',
            borderRadius: '12px',
            boxShadow: 'var(--shadow-card)',
            transition: 'all 0.2s'
          }}
        >
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setShowChecksDetail(!showChecksDetail)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                Readiness & Preprocessing Checklist
              </span>
              {issueCount > 0 ? (
                <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', background: '#FEF3C7', color: '#D97706', borderRadius: '4px' }}>
                  {issueCount} issue{issueCount === 1 ? '' : 's'} to review
                </span>
              ) : (
                <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', background: '#DCFCE7', color: '#16A34A', borderRadius: '4px' }}>
                  Ready to train
                </span>
              )}
            </div>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-accent)' }}>
              {showChecksDetail ? 'Hide details ▲' : 'Show details ▼'}
            </span>
          </div>
          {showChecksDetail && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border-tertiary)' }}>
              <PreprocessingPlan
                plan={plan}
                checks={checks}
                onFixAction={handleFixAction}
                dismissedChecks={dismissedChecks}
                onDismissCheck={(key) => setDismissedChecks((d) => [...d, key])}
              />
            </div>
          )}
        </div>
      )}
      </>}
        </>
      )}

      {/* Results panel container */}
      <div id="models-results" />
      {activeModelsSection === 'history' && (
        models.length > 0 ? (
          <PreviousModelsTable
            models={models}
            restoreModelSettings={restoreModelSettings}
            prepareAndUseInWhatIf={prepareAndUseInWhatIf}
            deleteSavedModel={deleteSavedModel}
            setShowHistory={setShowHistory}
            aiExplainActive={aiExplainActive}
            onExplain={onExplain}
          />
        ) : (
          <div className="ax-models-ready-card" style={{ minHeight: 260 }}>
            <div className="ax-models-ready-icon"><History size={22} /></div>
            <h2>No model history yet</h2>
            <p>Train a model first, then previous runs and restore actions will appear here.</p>
          </div>
        )
      )}
      {results && ['results', 'features'].includes(activeModelsSection) && (
        <>
          <ResultsPanel
            results={results}
            activeIdx={activeResultIdx}
            setActiveIdx={setActiveResultIdx}
            onUseInWhatIf={useInWhatIf}
            datasetId={dataset.id}
            onFixAction={handleFixAction}
            section={activeModelsSection}
            aiExplainActive={aiExplainActive}
            onExplain={onExplain}
            onToggleExplain={handleToggleExplain}
            toastMsg={toastMsg}
          />
        </>
      )}
      {!results && activeModelsSection === 'results' && (
        <div className="ax-models-ready-card" style={{ minHeight: 260 }}>
          <div className="ax-models-ready-icon"><BarChart3 size={22} /></div>
          <h2>No results yet</h2>
          <p>Train at least one model in Setup, then results and comparison will appear here.</p>
        </div>
      )}
      {!results && activeModelsSection === 'features' && (
        <div className="ax-models-ready-card" style={{ minHeight: 260 }}>
          <div className="ax-models-ready-icon"><Activity size={22} /></div>
          <h2>No feature influence yet</h2>
          <p>Train a model first, then feature importance and directional effects will appear here.</p>
        </div>
      )}
      {activeModelsSection === 'tune' && (
        <>
          {results && (results.models || []).length > 0 ? (
            <div id="models-tuning" className="ax-card ax-module-card ax-card-model" style={{ padding: 18, marginTop: 16 }}>
              {/* Header */}
              <div className="ax-tune-head">
                <div className="ax-tune-head-left">
                  <h3>
                    Tune hyperparameters
                    <HelpButton
                      title="Tune hyperparameters"
                      text="Adjust algorithm settings after training. Tuning is optional and most useful when model health warns about overfitting."
                    />
                  </h3>
                  <p>Defaults were used for the first run. Adjust complexity and convergence settings below to improve generalization.</p>
                </div>
                <button
                  className="ax-tune-reset"
                  type="button"
                  onClick={() => setModelParams(defaultModelParams())}
                >
                  <RotateCcw size={12} /> Reset to defaults
                </button>
              </div>

              <ParameterSettings
                selectedAlgos={selectedAlgos}
                modelParams={modelParams}
                setModelParams={setModelParams}
                results={results}
                aiExplainActive={aiExplainActive}
                onExplain={onExplain}
              />

              <div className="ax-tune-train-row">
                <button
                  className="ax-btn prim"
                  disabled={training || selectedAlgos.length === 0 || guestModelLimitReached || guestSelectionOverLimit}
                  onClick={train}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {training ? <InlineSpinner label="Training tuned model..." /> : <><span>Train again with tuned settings</span> <ArrowUpRight size={14} /></>}
                </button>
              </div>
            </div>
          ) : (
            <div className="ax-models-ready-card" style={{ minHeight: 260 }}>
              <div className="ax-models-ready-icon"><Brain size={22} /></div>
              <h2>Tune hyperparameters</h2>
              <p>Train at least one model first, then algorithm hyperparameters will appear here for fine-tuning.</p>
            </div>
          )}
        </>
      )}
      </main>

      {explainPopup && (
        <ModelsExplainPopup
          element={explainPopup}
          onClose={() => setExplainPopup(null)}
          datasetId={dataset?.id}
        />
      )}
    </div>
  )
}

function ModelsExplainPopup({ datasetId, element, onClose }) {
  const [aiText, setAiText] = useState(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('normal')
  const [followUpInput, setFollowUpInput] = useState('')
  const [followUpLoading, setFollowUpLoading] = useState(false)
  const [position, setPosition] = useState(() => getModelsExplainPosition(getLiveModelsExplainRect(element)))

  const title = element?.title || element?.label || element?.section || 'Models'
  const context = buildModelsExplainContext(element)
  const fallbackDatasetExplanation = cleanModelsExplainText(element?.datasetExplanation || buildModelsDatasetExplanation(element, context), 'This is part of the Models workflow.')
  const simple = element?.simple || buildModelsSimpleExplanation(element)
  const whyItMatters = element?.whyItMatters || buildModelsWhyItMatters(element)
  const verdict = element?.verdict || buildModelsVerdict(element)
  const verdictTone = element?.verdictTone || buildModelsVerdictTone(element)

  useEffect(() => {
    const updatePosition = () => setPosition(getModelsExplainPosition(getLiveModelsExplainRect(element)))
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [element?.sourceEl, element?.sourceRect, element?.metricKey, element?.type, element?.title])

  const fetchAI = async (variant = 'normal') => {
    if (!datasetId || !element) return
    setLoading(true)
    try {
      const question = variant === 'simple'
        ? `Explain this Models page element in very simple terms, one or two sentences: ${title}.`
        : variant === 'technical'
          ? `Give concise technical details for this Models page element: ${title}. Include relevant metrics, parameters, or model implications.`
          : `Explain this Models page element in plain language for a student using SimuCast: ${title}. Include what it means, how it applies to the current dataset/model, why it matters, and a recommendation.`
      const payload = {
        title,
        type: element.type,
        metricKey: element.metricKey,
        context,
        fallbackDatasetExplanation,
        fallbackVerdict: verdict,
      }
      const response = await api.aiExplain(datasetId, `models-${element.metricKey || element.type || element.title}-${variant}`, payload, question, { element: payload })
      setAiText(cleanModelsExplainText(response?.explanation, fallbackDatasetExplanation))
    } catch {
      setAiText(fallbackDatasetExplanation)
    } finally {
      setLoading(false)
    }
  }

  const askFollowUp = async () => {
    if (!datasetId || !followUpInput.trim()) return
    setFollowUpLoading(true)
    try {
      const payload = {
        title,
        type: element.type,
        metricKey: element.metricKey,
        context,
        previousExplanation: aiText || fallbackDatasetExplanation,
      }
      const response = await api.aiExplain(datasetId, `models-${element.metricKey || element.type || element.title}-followup`, payload, followUpInput, { element: payload })
      setAiText(cleanModelsExplainText(response?.explanation, fallbackDatasetExplanation))
      setFollowUpInput('')
      setMode('normal')
    } catch {
      setAiText(fallbackDatasetExplanation)
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
  }, [element?.metricKey, element?.type, element?.title, datasetId])

  return createPortal(
    <div
      className={`ax-expand-explain-popup ax-explain-placement-${position.placement}`}
      style={{ top: position.top, left: position.left, '--explain-popup-max-height': `${position.maxHeight}px` }}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} explanation`}
    >
      <span
        className="ax-expand-explain-arrow"
        style={{ top: position.arrowTop, left: position.arrowLeft }}
        aria-hidden="true"
      />
      <div className="ax-expand-explain-popup-head">
        <div>
          <p>AI Explain &middot; {title}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close explanation">&times;</button>
      </div>
      <div className="ax-expand-explain-popup-body">
        <section>
          <span>What this means</span>
          <p>{simple}</p>
        </section>
        <section>
          <span>In your dataset</span>
          {loading ? (
            <div className="ax-expand-explain-loading">
              <InlineSpinner label="" />
              <strong>Generating explanation...</strong>
            </div>
          ) : (
            <p>{aiText || fallbackDatasetExplanation}</p>
          )}
        </section>
        <section>
          <span>Why it matters</span>
          <p>{whyItMatters}</p>
        </section>
        <section>
          <span>Verdict / recommendation</span>
          <p className={`ax-expand-explain-verdict ${verdictTone}`}>{verdict}</p>
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

function buildModelsExplainContext(element) {
  const context = { page: 'Models', clickedElement: element?.title || element?.label || element?.section || element?.metricKey || element?.type }
  if (element?.model) {
    const model = element.model
    context.selectedModel = algoLabelForTask(model.algorithm, model.metrics?.task)
    context.targetVariable = model.target
    context.task = model.metrics?.task
    context.metrics = model.metrics
    context.features = model.features
  }
  if (element?.value != null) context.metricValue = element.value
  if (element?.featureName) {
    context.featureName = element.featureName
    context.importancePercent = element.value
    context.rank = element.rank
    context.totalFeatures = element.totalFeatures
  }
  if (element?.paramKey) {
    context.parameter = element.paramKey
    context.parameterValue = element.paramValue
    context.parameterLabel = element.paramLabel
    context.algorithm = element.algoName
  }
  return context
}

function buildModelsSimpleExplanation(element) {
  if (element?.simple) return element.simple
  if (element?.type === 'preplan-card') return 'The Preprocessing plan shows how raw data is cleaned, scaled, and encoded before model training.'
  if (element?.type === 'preplan-data-readiness') return 'Data readiness verifies whether your chosen variables have missing values, clean categories, or collinearity.'
  if (element?.type === 'preplan-readiness-check') return 'This check reviews your dataset for compatibility issues with the chosen algorithms.'
  if (element?.type === 'preplan-numeric-scaling') return 'Numeric scaling standardizes different feature ranges (like income vs. age) so models treat them fairly.'
  if (element?.type === 'preplan-scale-option') return 'This option defines the scaler function applied to numeric features.'
  if (element?.type === 'preplan-encoding-section') return 'Encoding converts categorical labels into numbers so the mathematical model can process them.'
  if (element?.type === 'preplan-column-encoding') return 'This row displays the active encoding options and ranks for a single categorical column.'
  if (element?.type === 'preplan-column-categories') return 'This list displays the categories found in the column, allowing drag-and-drop ordinal sorting.'
  if (element?.type === 'preplan-column-method') return 'This setting determines how string or boolean values are mapped to numeric values.'
  if (element?.type === 'parameter') return 'This hyperparameter changes how the selected algorithm learns from data.'
  if (element?.type === 'featureInfluence') return 'This row shows how much one feature contributes to the selected model prediction.'
  if (element?.type === 'comparisonRow') return 'This row compares one trained model against the others.'
  if (element?.type === 'modelHealth') return 'This card compares train and test behavior to show whether the model generalizes.'
  if (element?.metricKey === 'accuracy') return 'Accuracy is the share of predictions the model got right.'
  if (element?.metricKey === 'f1') return 'F1-score is the harmonic mean of precision and recall, balancing both.'
  if (element?.metricKey === 'gap') return 'The train-test gap shows whether the model may be overfitting.'
  if (element?.metricKey === 'r2') return 'R squared measures how much target variation a regression model explains.'
  if (element?.metricKey === 'rmse') return 'RMSE is the typical prediction error size in the target units.'
  return 'This control or section is part of the model-building workflow.'
}

function buildModelsDatasetExplanation(element, context) {
  if (element?.model) {
    const modelName = context.selectedModel || 'this model'
    const targetName = context.targetVariable || 'the target'
    const metrics = context.metrics || {}
    if (metrics.task === 'classification') {
      return `${modelName} predicts ${targetName}. Accuracy is ${pct(metrics.accuracy)}, F1 is ${metrics.f1 != null ? num(metrics.f1) : 'not available'}, and the train-test gap is ${metrics.generalization_gap != null ? num(metrics.generalization_gap) : 'not available'}.`
    }
    return `${modelName} predicts ${targetName}. R squared is ${metrics.r2 != null ? num(metrics.r2) : 'not available'}, RMSE is ${metrics.rmse != null ? num(metrics.rmse) : 'not available'}, and the train-test gap is ${metrics.generalization_gap != null ? num(metrics.generalization_gap) : 'not available'}.`
  }
  if (element?.featureName) return `${element.featureName} is ranked ${element.rank || '?'} of ${element.totalFeatures || '?'} with ${element.value ?? 0}% relative influence.`
  if (element?.paramKey) return `${element.paramLabel || element.paramKey} is currently set to ${element.paramValue ?? 'default'} for ${element.algoName || 'the selected algorithm'}.`
  return 'This page uses the current dataset, selected target, features, algorithms, preprocessing plan, and saved model results.'
}

function buildModelsWhyItMatters(element) {
  if (element?.whyItMatters) return element.whyItMatters
  if (element?.type === 'parameter') return 'Hyperparameter changes can improve accuracy, reduce overfitting, or make training more stable, but they can also make a model too complex.'
  if (element?.type === 'featureInfluence') return 'Feature influence helps explain what the model relies on, but it should not be treated as causation.'
  if (element?.type === 'comparisonRow') return 'Comparing rows helps choose a model using multiple metrics instead of one score.'
  if (element?.type === 'modelHealth') return 'A model that performs well on test data is more trustworthy than one that only performs well on training data.'
  return 'Understanding this element helps keep the modeling workflow explainable and defensible.'
}

function buildModelsVerdict(element) {
  if (element?.verdict) return element.verdict
  if (element?.type?.startsWith('preplan-')) {
    if (element?.type === 'preplan-readiness-check') return 'Ensure warnings are resolved or dismissed before starting training.'
    if (element?.type === 'preplan-column-categories') return 'Define a natural hierarchy for Ordinal columns to improve model performance.'
    return 'Confirm configuration is correct before training the model.'
  }
  if (element?.type === 'parameter') return 'Tune hyperparameters carefully and compare the next run against the previous result.'
  if (element?.type === 'featureInfluence') return Number(element?.value || 0) >= 15 ? 'Treat this as a key predictor to explain in the report.' : 'This is a supporting predictor; review before removing it.'
  if (element?.metricKey === 'gap') return Math.abs(Number(element?.value || 0)) < 0.05 ? 'Low overfitting risk.' : 'Review model health before relying on this result.'
  return 'Use this as supporting context for model setup and interpretation.'
}

function buildModelsVerdictTone(element) {
  if (element?.verdictTone) return element.verdictTone
  if (element?.type?.startsWith('preplan-')) return 'good'
  if (element?.metricKey === 'gap' && Math.abs(Number(element?.value || 0)) >= 0.2) return 'risk'
  if (element?.type === 'parameter') return 'warning'
  return 'good'
}

function cleanModelsExplainText(text, fallback) {
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

function getModelsExplainPosition(sourceRect) {
  const popupW = 374
  const gap = 8
  const padding = 12
  const viewportW = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportH = typeof window === 'undefined' ? 720 : window.innerHeight
  const popupH = Math.max(280, Math.min(560, viewportH - (padding * 2)))
  const anchor = normalizeModelsExplainRect(sourceRect)
  if (!anchor) return { top: 84, left: padding, placement: 'right-start', arrowTop: 24, arrowLeft: -6, maxHeight: popupH }
  const placements = anchor.bottom > viewportH * 0.68
    ? ['top-start', 'right-start', 'left-start', 'bottom-start']
    : ['right-start', 'left-start', 'bottom-start', 'top-start']
  for (const placement of placements) {
    const candidate = buildModelsExplainCandidate(placement, anchor, popupW, popupH, gap, padding, viewportW, viewportH)
    if (!modelsRectsOverlap(candidate.rect, anchor)) return candidate
  }
  const rightSpace = viewportW - anchor.right - gap - padding
  const leftSpace = anchor.left - gap - padding
  return buildModelsExplainCandidate(rightSpace >= leftSpace ? 'right-start' : 'left-start', anchor, popupW, popupH, gap, padding, viewportW, viewportH)
}

function buildModelsExplainCandidate(placement, anchor, popupW, popupH, gap, padding, viewportW, viewportH) {
  let left = anchor.right + gap
  let top = anchor.top
  if (placement === 'left-start') {
    left = anchor.left - popupW - gap
  } else if (placement === 'bottom-start') {
    left = anchor.left
    top = anchor.bottom + gap
  } else if (placement === 'top-start') {
    left = anchor.left
    top = anchor.top - popupH - gap
  }
  left = modelsClamp(left, padding, Math.max(padding, viewportW - popupW - padding))
  top = modelsClamp(top, padding, Math.max(padding, viewportH - popupH - padding))
  const rect = { left, top, right: left + popupW, bottom: top + popupH }
  const arrow = getModelsExplainArrowPosition(placement, anchor, rect, popupW, popupH)
  return { top, left, placement, rect, maxHeight: popupH, ...arrow }
}

function getLiveModelsExplainRect(element) {
  if (element?.sourceEl?.isConnected && typeof element.sourceEl.getBoundingClientRect === 'function') {
    return element.sourceEl.getBoundingClientRect()
  }
  return element?.sourceRect || null
}

function getModelsExplainArrowPosition(placement, anchor, popup, popupW, popupH) {
  if (placement === 'right-start' || placement === 'left-start') {
    return {
      arrowLeft: placement === 'right-start' ? -6 : popupW - 6,
      arrowTop: modelsClamp(anchor.top + Math.min(anchor.height / 2, 20) - popup.top, 18, popupH - 18),
    }
  }
  return {
    arrowLeft: modelsClamp(anchor.left + Math.min(anchor.width / 2, 30) - popup.left, 18, popupW - 18),
    arrowTop: placement === 'bottom-start' ? -6 : popupH - 6,
  }
}

function normalizeModelsExplainRect(rect) {
  if (!rect) return null
  const left = Number(rect.left)
  const top = Number(rect.top)
  const width = Number(rect.width || rect.right - rect.left)
  const height = Number(rect.height || rect.bottom - rect.top)
  if (![left, top, width, height].every(Number.isFinite)) return null
  return { left, top, width, height, right: left + width, bottom: top + height }
}

function modelsRectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function modelsClamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

// Dropdown menu that houses config selectors for the model build page.
// Standalone Previous Models history table with filter pills, health badges, and icon actions.
function PreviousModelsTable({ models, restoreModelSettings, prepareAndUseInWhatIf, deleteSavedModel, setShowHistory, aiExplainActive, onExplain }) {
  const [filterTarget, setFilterTarget] = useState('all')
  const [checkedIds, setCheckedIds] = useState(new Set())
  const explainAttrs = (element, className = '') => ({
    className: `${className} ${aiExplainActive ? 'ax-explain-selectable' : ''}`.trim(),
    onClick: (event) => onExplain?.(element, event),
    title: aiExplainActive ? `Explain ${element.title || element.label || 'this history area'}` : undefined,
  })

  const targets = [...new Set(models.map((m) => m.target).filter(Boolean))]
  const filtered = filterTarget === 'all' ? models : models.filter((m) => m.target === filterTarget)
  const metricColumns = getHistoryMetricColumns(filtered.length ? filtered : models)

  const settingsSummary = (m) => {
    const defs = defaultModelParams()
    const params = m.metrics?.model_params || {}
    const defParams = defs[m.algorithm] || {}
    const parts = []
    Object.entries(params).forEach(([k, v]) => {
      const d = defParams[k]
      if (v !== undefined && String(v) !== String(d) && !(v === '' && d === '')) {
        if (k === 'n_estimators') parts.push(`trees +${v}`)
        else if (k === 'max_depth') parts.push(`depth =${v === '' ? '∞' : v}`)
        else if (k === 'C') parts.push(`C =${v}`)
        else if (k === 'min_samples_leaf') parts.push(`leaf =${v}`)
        else if (k === 'max_iter') parts.push(`iter =${v}`)
      }
    })
    return parts.length ? parts.join(' · ') : 'defaults'
  }

  const relTime = (ts) => {
    if (!ts) return ''
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`
    return `${Math.floor(diff / 86400)} days ago`
  }

  const exportCSV = () => {
    const rows = [['Algorithm', 'Target', ...metricColumns.map((metric) => metric.label), 'Settings', 'Trained']]
    models.forEach((m) => {
      rows.push([
        algoLabelForTask(m.algorithm, m.metrics?.task),
        m.target,
        ...metricColumns.map((metric) => formatHistoryMetricValue(m.metrics?.[metric.key], metric.key, true)),
        settingsSummary(m),
        m.trained_at || '',
      ])
    })
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'previous_models.csv'
    a.click()
  }

  const toggleCheck = (id) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div style={{
      background: 'var(--color-background-primary)',
      border: '1.5px solid var(--color-border-tertiary)',
      borderRadius: 14, marginBottom: 18, overflow: 'hidden',
    }}>
      {/* Header */}
      <div {...explainAttrs({
        type: 'history-card',
        metricKey: 'models-history-previous-models-card',
        section: 'Models history',
        title: 'Previous models card',
        simple: 'This card lists saved model runs for the current project.',
        datasetExplanation: `${models.length} model run${models.length === 1 ? '' : 's'} are available and can be filtered by target.`,
        whyItMatters: 'History lets you compare defaults, tuned runs, and algorithms without retraining from scratch.',
        verdict: 'Use this table to audit and restore previous model configurations.',
        verdictTone: 'good',
      })} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 12px' }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 2px', color: 'var(--color-text-primary)' }}>Previous models</h2>
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>
            {models.length} run{models.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          className={`ax-btn mini ${aiExplainActive ? 'ax-explain-selectable' : ''}`}
          type="button"
          onClick={(event) => {
            if (aiExplainActive) return onExplain?.({
              type: 'history-action',
              metricKey: 'models-history-export-csv',
              section: 'Models history',
              title: 'Export CSV button',
              simple: 'This exports the model history table as a CSV file.',
              datasetExplanation: `${models.length} saved run${models.length === 1 ? '' : 's'} would be included.`,
              whyItMatters: 'CSV export is useful for documentation, reporting, or offline comparison.',
              verdict: 'Turn off Explain Mode to export.',
              verdictTone: 'good',
            }, event)
            exportCSV()
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 }}
        >
          ↓ Export CSV
        </button>
      </div>

      {/* Target filter pills */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 20px 12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginRight: 4 }}>FILTER TARGET</span>
        {['all', ...targets].map((t) => {
          const active = filterTarget === t
          return (
            <button
              key={t}
              type="button"
              className={aiExplainActive ? 'ax-explain-selectable' : ''}
              onClick={(event) => {
                if (aiExplainActive) {
                  return onExplain?.({
                    type: 'history-filter',
                    metricKey: `models-history-filter-${String(t).replace(/\W+/g, '-').toLowerCase()}`,
                    section: 'Models history',
                    title: `${t === 'all' ? 'All' : t} target filter`,
                    label: t === 'all' ? 'All targets' : t,
                    simple: 'This filter narrows the history table to model runs for one target variable.',
                    datasetExplanation: t === 'all'
                      ? `${filtered.length} visible run${filtered.length === 1 ? '' : 's'} are currently shown across all targets.`
                      : `${filtered.length} visible run${filtered.length === 1 ? '' : 's'} are currently shown for ${t}.`,
                    whyItMatters: 'Classification and regression targets use different metrics, so filtering keeps comparisons cleaner.',
                    verdict: 'Turn off Explain Mode to apply this filter.',
                    verdictTone: 'good',
                  }, event)
                }
                setFilterTarget(t)
              }}
              style={{
                padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer',
                border: active ? 'none' : '1.5px solid var(--color-border-tertiary)',
                background: active ? 'var(--color-accent)' : 'var(--color-background-primary)',
                color: active ? '#fff' : 'var(--color-text-secondary)',
                transition: 'all 0.15s',
              }}
            >
              {t === 'all' ? 'All' : t}
            </button>
          )
        })}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
          Tip — tick rows to compare side-by-side
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderTop: '1.5px solid var(--color-border-tertiary)', borderBottom: '1.5px solid var(--color-border-tertiary)' }}>
              <th style={{ width: 40, padding: '8px 0 8px 20px' }}></th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)' }}>
                ALGORITHM · TARGET
              </th>
              {metricColumns.map((metric) => (
                <th
                  key={metric.key}
                  style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}
                  title={metric.label}
                >
                  {metric.label}
                </th>
              ))}
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)' }}>
                SETTINGS
              </th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)' }}>
                WHEN
              </th>
              <th style={{ width: 100, padding: '8px 20px 8px 0' }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m, idx) => {
              const h = assessModelHealth(m)
              const t = h ? healthTone(h.color) : null
              const isChecked = checkedIds.has(m.id)
              const summary = settingsSummary(m)
              const isDefaultSettings = summary === 'defaults'

              return (
                <tr
                  key={m.id}
                  style={{
                    borderBottom: idx < filtered.length - 1 ? '1px solid var(--color-border-tertiary)' : 'none',
                    background: isChecked ? 'var(--color-accent-light)' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => { if (!isChecked) e.currentTarget.style.background = 'var(--color-background-secondary)' }}
                  onMouseLeave={(e) => { if (!isChecked) e.currentTarget.style.background = 'transparent' }}
                >
                  <td style={{ padding: '14px 0 14px 20px' }}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onClick={(event) => {
                        if (aiExplainActive) {
                          return onExplain?.({
                            type: 'history-checkbox',
                            metricKey: `models-history-checkbox-${m.id}`,
                            section: 'Models history',
                            title: 'Compare row checkbox',
                            simple: 'This checkbox selects a saved model run for side-by-side comparison.',
                            datasetExplanation: `${algoLabelForTask(m.algorithm, m.metrics?.task)} predicts ${m.target || 'the selected target'}.`,
                            whyItMatters: 'Selecting rows helps compare tuned versus default runs or different algorithms.',
                            verdict: 'Turn off Explain Mode to select this row.',
                            verdictTone: 'good',
                          }, event)
                        }
                      }}
                      onChange={() => {
                        if (!aiExplainActive) toggleCheck(m.id)
                      }}
                      style={{ accentColor: 'var(--color-accent)', width: 14, height: 14, cursor: 'pointer' }}
                    />
                  </td>
                  <td style={{ padding: '14px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>
                        {algoLabelForTask(m.algorithm, m.metrics?.task)}
                      </span>
                      {h && h.color === 'red' && t && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: t.text, display: 'flex', alignItems: 'center', gap: 3 }}>
                          <AlertTriangle size={11} /> {h.label.toLowerCase()}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                      target: {m.target}
                    </div>
                  </td>
                  {metricColumns.map((metric) => (
                    <td
                      key={metric.key}
                      style={{ padding: '14px 10px', textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}
                      title={`${metric.label}: ${formatHistoryMetricValue(m.metrics?.[metric.key], metric.key)}`}
                    >
                      {formatHistoryMetricValue(m.metrics?.[metric.key], metric.key)}
                    </td>
                  ))}
                  <td style={{ padding: '14px 12px' }}>
                    <span style={{
                      fontSize: 11, fontFamily: 'var(--font-mono)',
                      color: isDefaultSettings ? 'var(--color-text-tertiary)' : 'var(--color-accent-dark)',
                      fontWeight: isDefaultSettings ? 400 : 600,
                    }}>
                      {summary}
                    </span>
                  </td>
                  <td style={{ padding: '14px 12px', fontSize: 12, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                    {relTime(m.trained_at)}
                  </td>
                  <td style={{ padding: '14px 20px 14px 0' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button title="Restore settings" type="button"
                        className={aiExplainActive ? 'ax-explain-selectable' : ''}
                        onClick={(event) => {
                          if (aiExplainActive) return onExplain?.({
                            type: 'history-action',
                            metricKey: `models-history-action-restore-${m.id}`,
                            section: 'Models history',
                            title: 'Restore settings action',
                            simple: 'This restores the setup choices from a previous model run.',
                            datasetExplanation: `${algoLabelForTask(m.algorithm, m.metrics?.task)} used ${settingsSummary(m)} settings for target ${m.target || 'unknown'}.`,
                            whyItMatters: 'Restoring settings lets you rerun or adjust a known configuration without rebuilding it manually.',
                            verdict: 'Turn off Explain Mode to restore this run.',
                            verdictTone: 'good',
                          }, event)
                          restoreModelSettings(m)
                        }}
                        style={{ width: 30, height: 30, borderRadius: 8, border: '1.5px solid var(--color-border-secondary)', background: 'var(--color-background-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: 14 }}
                      >↺</button>
                      <button title="Use in What-if" type="button"
                        className={aiExplainActive ? 'ax-explain-selectable' : ''}
                        onClick={(event) => {
                          if (aiExplainActive) return onExplain?.({
                            type: 'history-action',
                            metricKey: `models-history-action-what-if-${m.id}`,
                            section: 'Models history',
                            title: 'Use in What-if action',
                            simple: 'This sends the saved model to the What-if page for scenario testing.',
                            datasetExplanation: `${algoLabelForTask(m.algorithm, m.metrics?.task)} can be used to simulate predictions for ${m.target || 'the target'}.`,
                            whyItMatters: 'What-if analysis turns model results into interactive scenario exploration.',
                            verdict: 'Turn off Explain Mode to use this model in What-if.',
                            verdictTone: 'good',
                          }, event)
                          prepareAndUseInWhatIf(m)
                        }}
                        style={{ width: 30, height: 30, borderRadius: 8, border: '1.5px solid var(--color-border-secondary)', background: 'var(--color-background-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: 14 }}
                      >→</button>
                      <button title="Delete" type="button"
                        className={aiExplainActive ? 'ax-explain-selectable' : ''}
                        onClick={(event) => {
                          if (aiExplainActive) return onExplain?.({
                            type: 'history-action',
                            metricKey: `models-history-action-delete-${m.id}`,
                            section: 'Models history',
                            title: 'Delete history row action',
                            simple: 'This deletes a saved model run from history.',
                            datasetExplanation: `${algoLabelForTask(m.algorithm, m.metrics?.task)} for ${m.target || 'the target'} would be removed.`,
                            whyItMatters: 'Deleting removes clutter, but it also removes the ability to restore or compare that run.',
                            verdict: 'Turn off Explain Mode to delete. Review carefully before deleting saved runs.',
                            verdictTone: 'warning',
                          }, event)
                          deleteSavedModel(m)
                        }}
                        style={{ width: 30, height: 30, borderRadius: 8, border: '1.5px solid #FECACA', background: 'var(--color-background-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#EF4444', fontSize: 14 }}
                      >✕</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const HISTORY_METRIC_EXCLUDE = new Set([
  'task',
  'model_params',
  'params',
  'confusion_matrix',
  'classification_report',
  'feature_importance',
  'feature_importances',
  'per_class',
  'target',
  'algorithm',
])

const HISTORY_METRIC_ORDER = [
  'accuracy',
  'f1',
  'precision',
  'recall',
  'roc_auc',
  'r2',
  'rmse',
  'mae',
  'mse',
  'train_score',
  'test_score',
  'train_r2',
  'test_r2',
  'train_rmse',
  'test_rmse',
  'generalization_gap',
  'train_test_gap',
  'cv_score',
]

function getHistoryMetricColumns(models = []) {
  const keys = new Set()
  models.forEach((model) => {
    Object.entries(model.metrics || {}).forEach(([key, value]) => {
      if (HISTORY_METRIC_EXCLUDE.has(key)) return
      if (value == null) return
      if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
        keys.add(key)
      }
    })
  })
  return [...keys]
    .sort((a, b) => {
      const ai = HISTORY_METRIC_ORDER.indexOf(a)
      const bi = HISTORY_METRIC_ORDER.indexOf(b)
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
      return a.localeCompare(b)
    })
    .map((key) => ({ key, label: historyMetricLabel(key) }))
}

function historyMetricLabel(key) {
  const labels = {
    accuracy: 'Accuracy',
    f1: 'F1',
    precision: 'Precision',
    recall: 'Recall',
    roc_auc: 'ROC AUC',
    r2: 'R²',
    rmse: 'RMSE',
    mae: 'MAE',
    mse: 'MSE',
    train_score: 'Train',
    test_score: 'Test',
    train_r2: 'Train R²',
    test_r2: 'Test R²',
    train_rmse: 'Train RMSE',
    test_rmse: 'Test RMSE',
    generalization_gap: 'Gap',
    train_test_gap: 'Gap',
    cv_score: 'CV',
  }
  return labels[key] || String(key).replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatHistoryMetricValue(value, key, plain = false) {
  if (value == null || value === '') return plain ? '' : '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'string') return value
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return plain ? '' : '—'
  if (['accuracy', 'precision', 'recall'].includes(key)) return `${(numeric * 100).toFixed(1)}%`
  if (Math.abs(numeric) >= 100) return numeric.toFixed(1)
  if (Math.abs(numeric) >= 10) return numeric.toFixed(2)
  return numeric.toFixed(3)
}

// Standalone validation dropdown used in the Setup section.
function ValidationDropdown({ validationMethod, setValidationMethod, testSize, setTestSize, cvFolds, setCvFolds, plan, stratify, setStratify, classBalanceStrategy, setClassBalanceStrategy, checks, onNavigateToCategorical }) {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef()

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const value = validationMethod === 'standard_split'
    ? `${Math.round((1 - testSize) * 100)}/${Math.round(testSize * 100)} Split`
    : `${cvFolds}-fold CV`

  return (
    <div ref={ref} className="models-config-dropdown-container" style={{ position: 'relative', flex: 1, minWidth: 140 }}>
      <div
        className="models-config-box"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '8px 12px',
          background: 'var(--color-background-primary)',
          border: isOpen ? '1.5px solid var(--color-accent)' : '1.5px solid var(--color-border-tertiary)',
          borderRadius: '8px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          height: '100%',
          userSelect: 'none',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          boxShadow: isOpen ? '0 0 0 2px var(--color-accent-light)' : 'none'
        }}
      >
        <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
          Validation
        </span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
          <span style={{ fontSize: '13px', fontWeight: 650, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {value}
          </span>
          <ChevronDown size={14} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        </div>
      </div>
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 2005,
            background: 'var(--color-background-primary)',
            border: '1px solid var(--color-border-secondary, #e5e7eb)',
            borderRadius: '10px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
            padding: '14px',
            width: '260px'
          }}
        >
          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
            METHOD
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, cursor: 'pointer' }}>
              <input
                type="radio"
                name="validation-method-popover"
                checked={validationMethod === 'standard_split'}
                onChange={() => setValidationMethod('standard_split')}
                style={{ accentColor: 'var(--color-accent, #f97316)' }}
              />
              Train / test split
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, cursor: 'pointer', marginBottom: 4 }}>
              <input
                type="radio"
                name="validation-method-popover"
                checked={validationMethod === 'cross_validation'}
                onChange={() => setValidationMethod('cross_validation')}
                style={{ accentColor: 'var(--color-accent, #f97316)' }}
              />
              Cross-validation
            </label>
          </div>

          {validationMethod === 'standard_split' ? (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--color-border-tertiary, #e5e7eb)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>TEST SPLIT</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-accent, #f97316)' }}>{Math.round(testSize * 100)}%</span>
              </div>
              <div style={{ position: 'relative', height: 28, display: 'flex', alignItems: 'center' }}>
                <input
                  type="range"
                  className="ax-validation-slider"
                  min="10"
                  max="50"
                  step="5"
                  value={Math.round(testSize * 100)}
                  onChange={(e) => setTestSize(Number(e.target.value) / 100)}
                  style={{
                    width: '100%', height: 6, margin: 0,
                    WebkitAppearance: 'none', appearance: 'none',
                    background: `linear-gradient(to right, var(--color-accent, #f97316) ${Math.round(testSize * 100)}%, #e5e7eb ${Math.round(testSize * 100)}%)`,
                    borderRadius: 3, outline: 'none', cursor: 'pointer'
                  }}
                />
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--color-border-tertiary, #e5e7eb)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>K FOLDS</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[3, 5, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCvFolds(n)}
                    style={{
                      padding: '6px 16px',
                      borderRadius: 20,
                      border: `1.5px solid ${cvFolds === n ? 'var(--color-accent, #f97316)' : '#e5e7eb'}`,
                      background: cvFolds === n ? 'var(--color-accent, #f97316)' : 'var(--color-background-primary)',
                      color: cvFolds === n ? '#fff' : 'var(--color-text-secondary, #64748b)',
                      fontSize: 12,
                      fontWeight: 700,
                      fontFamily: 'inherit',
                      cursor: 'pointer'
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {plan?.task === 'classification' && setClassBalanceStrategy && (() => {
            const hasClassBalanceWarning = (checks || []).some(c => c.key === 'class_balance' && c.status === 'warning')
            const hasCategoryConsistencyError = (checks || []).some(c => c.key === 'category_consistency' && c.status === 'block')
            const options = [
              {
                value: 'none',
                label: 'Keep class proportions',
                desc: 'Train on the data as-is. Best when classes are roughly balanced.',
              },
              {
                value: 'balanced',
                label: 'Balanced class weights',
                desc: 'Automatically penalizes the model more for misclassifying minority classes. No data modification.',
              },
              {
                value: 'smote',
                label: 'SMOTE oversampling',
                desc: 'Generates synthetic minority class samples before training. Only use when class imbalance is severe (>5:1 ratio).',
                disabled: hasCategoryConsistencyError,
                disabledReason: 'Resolve category consistency errors before enabling SMOTE.',
              },
            ]
            return (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--color-border-tertiary, #e5e7eb)', display: 'flex', flexDirection: 'column', gap: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Class Balance</div>
                  {hasClassBalanceWarning && classBalanceStrategy === 'none' && (
                    <span style={{ fontSize: 10, color: '#b45309', background: '#fef3c7', borderRadius: 4, padding: '2px 6px', lineHeight: 1.4 }}>
                      ℹ️ Imbalance detected
                    </span>
                  )}
                </div>
                {hasClassBalanceWarning && classBalanceStrategy !== 'balanced' && classBalanceStrategy !== 'smote' && (
                  <div style={{ fontSize: 10, color: '#92400e', background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 5, padding: '5px 8px', marginBottom: 8, lineHeight: 1.5 }}>
                    ℹ️ Class imbalance detected — Balanced class weights pre-selected. You can change this.
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {options.map(({ value, label, desc, disabled, disabledReason }) => (
                    <label
                      key={value}
                      title={disabled ? disabledReason : undefined}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1 }}
                    >
                      <input
                        type="radio"
                        name="class-balance-strategy-popover"
                        checked={classBalanceStrategy === value}
                        disabled={disabled}
                        onChange={() => !disabled && setClassBalanceStrategy(value)}
                        style={{ accentColor: 'var(--color-accent, #f97316)', marginTop: 2, flexShrink: 0 }}
                      />
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontWeight: 600 }}>{label}</span>
                        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary, #9ca3af)', lineHeight: 1.4 }}>{desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {classBalanceStrategy === 'smote' && (
                  <div style={{ marginTop: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7, padding: '9px 11px', fontSize: 11, color: '#78350f', lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠️ SMOTE generates synthetic samples and should only be used when your minority class is severely underrepresented. It is applied only to the training set — never the test set — to prevent data leakage. Verify your class distribution in Describe → Categorical Variables before enabling this.</div>
                    {onNavigateToCategorical && (
                      <button
                        type="button"
                        onClick={onNavigateToCategorical}
                        style={{ background: 'none', border: 'none', color: '#b45309', fontWeight: 600, fontSize: 11, cursor: 'pointer', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' }}
                      >
                        View class distribution →
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

// Dropdown menu that houses config selectors for the model build page.
function ConfigDropdown({ label, value, children }) {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef()

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div ref={ref} className="models-config-dropdown-container" style={{ position: 'relative', flex: 1, minWidth: 140 }}>
      <div
        className="models-config-box"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '8px 12px',
          background: 'var(--color-background-primary)',
          border: isOpen ? '1.5px solid var(--color-accent)' : '1.5px solid var(--color-border-tertiary)',
          borderRadius: '8px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          height: '100%',
          userSelect: 'none',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          boxShadow: isOpen ? '0 0 0 2px var(--color-accent-light)' : 'none'
        }}
      >
        <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
          <span style={{ fontSize: '13px', fontWeight: 650, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {value}
          </span>
          <ChevronDown size={14} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        </div>
      </div>
      {isOpen && (
        <div
          className="models-config-dropdown-content"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 2005,
            background: 'var(--color-background-primary)',
            border: '1.5px solid var(--color-border-secondary)',
            borderRadius: '12px',
            boxShadow: 'var(--shadow-card-hover)',
            padding: '12px',
            minWidth: '240px',
            maxWidth: '360px'
          }}
        >
          {children(() => setIsOpen(false))}
        </div>
      )}
    </div>
  )
}


// Returns the title text with HTML ampersand entities decoded back to regular ampersands.
function plainTitle(value) {
  return String(value || '').replace(/&amp;/g, '&')
}

// Returns the contextual help text shown beside each step title based on its keyword.
function modelStepHelp(title) {
  const text = plainTitle(title).toLowerCase()
  if (text.includes('target')) {
    return 'Use this card to choose the outcome column the model should predict. SimuCast detects whether the target is numeric for regression or categorical for classification.'
  }
  if (text.includes('features')) {
    return 'Use this card to choose the input columns used to predict the target. Avoid IDs and leakage columns that directly reveal the answer.'
  }
  if (text.includes('preprocessing')) {
    return 'Use this card to review encoding, scaling, readiness checks, warnings, and blocks before training. It helps prevent invalid model setups.'
  }
  if (text.includes('validation')) {
    return 'Use this card to decide how much data is held out for testing. Classification options help keep class proportions and handle imbalance.'
  }
  if (text.includes('algorithms')) {
    return 'Use this card to select only task-appropriate algorithms. Compare an interpretable baseline with tree-based models, then inspect metrics and model health.'
  }
  return ''
}

// Card that surfaces a system-suggested choice with a title, source chip, and content.
function RecommendationPanel({ title, source, children }) {
  return (
    <div className="ax-card" style={{ padding: '9px 10px', marginTop: 10, background: 'var(--color-background-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12 }}>{title}</strong>
        <HelpButton
          title={title}
          text="This recommendation card explains the system's suggested choice for this part of the modeling workflow. You can still change the setup manually."
          size={16}
        />
        <span className="ax-chip" style={{ color: 'var(--color-primary)', fontSize: 10 }}>{source}</span>
      </div>
      {children}
    </div>
  )
}

// Scores variables and returns up to four likely target columns based on dtype and uniqueness.
function recommendTargets(variables = []) {
  const scored = variables
    .filter((v) => !isIdLike(v.name))
    .map((v) => {
      const name = String(v.name || '').toLowerCase()
      let score = 0
      if (['category', 'binary', 'int', 'float', 'numeric'].includes(v.dtype)) score += 1
      if (Number(v.unique || 0) > 1) score += 2
      return { ...v, score, why: 'This column looks like a meaningful prediction outcome.' }
    })
    .sort((a, b) => b.score - a.score)
  return scored.filter((v) => v.score >= 2).slice(0, 4)
}

// Returns up to twelve recommended feature columns by filtering ID-like names and supported dtypes.
function recommendFeatures(variables = []) {
  return variables
    .filter((v) => !isIdLike(v.name))
    .filter((v) => ['category', 'binary', 'int', 'float', 'numeric', 'text'].includes(v.dtype))
    .slice(0, 12)
}

// Returns true if a column name looks like an identifier and should be excluded from modeling.
function isIdLike(name) {
  const n = String(name || '').toLowerCase()
  return n === 'id' || n.endsWith('_id') || n.includes('student_id') || n.includes('uuid')
}

// Dropdown menu that lists available fix options for a preprocessing check and dispatches actions.
function FixOptionsDropdown({ fixes, onAction, canDismiss, onDismiss }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const allOptions = [...(fixes || [])]
  if (canDismiss) {
    allOptions.push({
      label: 'Dismiss warning',
      description: 'Temporarily hide this warning from the preprocessing checklist.',
      action: 'dismiss'
    })
  }
  if (!allOptions.length) return null

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        className="ax-btn"
        style={{ fontSize: 11, padding: '2px 8px', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        Fix options <span style={{ fontSize: 8 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'fixed',
          background: '#fff',
          border: '1px solid #d1d5db',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          zIndex: 9999,
          minWidth: 280,
          maxWidth: 360,
          overflow: 'hidden',
          right: 'auto',
          top: 'auto',
        }} ref={(el) => {
          if (!el) return
          const btn = ref.current?.querySelector('button')
          if (!btn) return
          const r = btn.getBoundingClientRect()
          el.style.top = `${r.bottom + 4}px`
          el.style.left = `${Math.max(8, r.right - 280)}px`
        }}>
          {allOptions.map((fix, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setOpen(false); fix.action === 'dismiss' ? onDismiss?.() : onAction(fix) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '9px 14px', fontSize: 12, background: 'none', border: 'none',
                borderBottom: i < allOptions.length - 1 ? '1px solid #e5e7eb' : 'none',
                cursor: 'pointer',
                color: fix.action === 'dismiss' ? '#9ca3af' : '#111827',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
            >
              <div style={{ fontWeight: fix.action === 'dismiss' ? 400 : 500 }}>{fix.label}</div>
              {fix.description && (
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3, lineHeight: 1.4 }}>{fix.description}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ParameterSettings({ selectedAlgos, modelParams, setModelParams, results, aiExplainActive, onExplain }) {
  const [activeTab, setActiveTab] = useState(selectedAlgos.length > 1 ? 'all' : (selectedAlgos[0] ?? 'all'))

  // Keep activeTab in sync when selectedAlgos changes
  const validTab = (activeTab === 'all' && selectedAlgos.length > 1) || selectedAlgos.includes(activeTab)
    ? activeTab
    : (selectedAlgos[0] ?? 'all')

  if (!selectedAlgos.length) {
    return (
      <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '10px 0 0' }}>
        Select at least one compatible model to view its default settings.
      </p>
    )
  }

  const update = (algo, key, value) => {
    setModelParams((prev) => ({
      ...prev,
      [algo]: {
        ...(prev[algo] || {}),
        [key]: value,
      },
    }))
  }

  const ALGO_SHORT = { logistic: 'LR', rf: 'RF', tree: 'DT', linear: 'LIN' }
  const ALGO_BADGE_CLASS = { logistic: 'lr', rf: 'rf', tree: 'dt', linear: 'lin' }

  const COMPLEXITY_KEYS = ['max_depth', 'min_samples_leaf', 'C']
  const CONVERGENCE_KEYS = ['max_iter', 'n_estimators', 'random_state', 'fit_intercept']

  const getParamsForAlgo = (algo) => (PARAM_DEFS[algo] || []).map((def) => ({ ...def, algo }))

  // Show params for the active algo tab(s)
  const visibleAlgos = validTab === 'all' ? selectedAlgos : [validTab]
  const allParams = visibleAlgos.flatMap(getParamsForAlgo)

  // Merge by key
  const mergedMap = new Map()
  allParams.forEach((p) => {
    if (!mergedMap.has(p.key)) {
      mergedMap.set(p.key, { ...p, algos: [p.algo] })
    } else {
      const entry = mergedMap.get(p.key)
      if (!entry.algos.includes(p.algo)) entry.algos.push(p.algo)
    }
  })

  // Pull same-key params from other selected algos if not active tab
  selectedAlgos.forEach((algo) => {
    if (visibleAlgos.includes(algo)) return
    ;(PARAM_DEFS[algo] || []).forEach((def) => {
      if (mergedMap.has(def.key)) {
        const entry = mergedMap.get(def.key)
        if (!entry.algos.includes(algo)) entry.algos.push(algo)
      }
    })
  })

  const mergedParams = Array.from(mergedMap.values())
  const complexityParams = mergedParams.filter((p) => COMPLEXITY_KEYS.includes(p.key))
  const convergenceParams = mergedParams.filter((p) => CONVERGENCE_KEYS.includes(p.key))

  const getAlgoHealth = (algo) => {
    const model = results?.models?.find((m) => m.algorithm === algo)
    return model ? assessModelHealth(model) : null
  }

  const paramHint = (key, value) => {
    if (key === 'max_depth') {
      if (value === '' || value == null) return 'unlimited depth'
      const v = Number(value)
      if (v <= 5) return 'shallow, less overfitting'
      if (v <= 15) return 'balanced'
      return 'deep, may overfit'
    }
    if (key === 'n_estimators') {
      const v = Number(value)
      if (v <= 50) return 'fast, less stable'
      if (v <= 200) return 'stable'
      return 'very stable, slower'
    }
    if (key === 'min_samples_leaf') {
      const v = Number(value)
      if (v <= 2) return 'fine-grained'
      if (v <= 10) return 'balanced'
      return 'coarse'
    }
    if (key === 'C') {
      const v = Number(value)
      if (v <= 0.1) return 'strong regularization'
      if (v <= 10) return 'balanced'
      return 'weak regularization'
    }
    if (key === 'max_iter') {
      const v = Number(value)
      if (v <= 500) return 'may not converge'
      if (v <= 2000) return 'fine'
      return 'thorough'
    }
    if (key === 'random_state') return 'reproducibility'
    return null
  }

  // Detect changes from defaults for effect banner
  const defaults = defaultModelParams()
  const changedParams = []
  selectedAlgos.forEach((algo) => {
    ;(PARAM_DEFS[algo] || []).forEach((def) => {
      const cur = modelParams[algo]?.[def.key]
      const dflt = defaults[algo]?.[def.key]
      if (cur !== undefined && String(cur) !== String(dflt) && !(cur === '' && dflt === '')) {
        changedParams.push({ algo, ...def, current: cur, dflt })
      }
    })
  })

  // Health for current active tab
  const activeHealth = validTab !== 'all' ? getAlgoHealth(validTab) : null
  const activeTone = activeHealth ? healthTone(activeHealth.color) : null

  const renderParamCard = (merged) => {
    const primaryAlgo = merged.algos[0]
    const value = modelParams[primaryAlgo]?.[merged.key] ?? merged.defaultValue
    const hint = paramHint(merged.key, value)
    const isBlank = value === '' || value == null

    return (
      <div
        key={merged.key}
        className="ax-tune-param"
        onClick={(e) => aiExplainActive && onExplain?.({ type: 'parameter', metricKey: 'parameter', section: 'Tune Hyperparameters', paramKey: merged.key, paramValue: value, paramLabel: merged.label, algoName: algoLabelForTask(primaryAlgo, results?.models?.[0]?.metrics?.task) }, e)}
        style={{ cursor: aiExplainActive ? 'help' : 'default', outline: aiExplainActive ? '1.5px dashed rgba(249,115,22,.5)' : 'none', position: 'relative', transition: 'all .15s ease' }}
      >
        {aiExplainActive && <span style={{ position: 'absolute', top: 4, right: 4, fontSize: 9, fontWeight: 700, color: '#f97316', background: '#FFF7ED', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>?</span>}
        {/* Top row: name + code key + badges */}
        <div className="ax-tune-param-top">
          <div>
            <span className="ax-tune-param-name">{merged.label}</span>
            <span className="ax-tune-param-key">{merged.key}</span>
          </div>
          <div className="ax-tune-algo-badges">
            {merged.algos.map((a) => (
              <span key={a} className={`ax-tune-algo-badge ${ALGO_BADGE_CLASS[a] || ''}`}>
                {ALGO_SHORT[a] || a}
              </span>
            ))}
          </div>
        </div>

        {/* Slider or checkbox */}
        {merged.type === 'checkbox' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              id={`tune-${merged.key}-${primaryAlgo}`}
              checked={!!value}
              onChange={(e) => merged.algos.forEach((a) => update(a, merged.key, e.target.checked))}
              style={{ width: 16, height: 16, accentColor: 'var(--color-accent)', cursor: 'pointer' }}
            />
            <label htmlFor={`tune-${merged.key}-${primaryAlgo}`} style={{ fontSize: 12, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
              {value ? 'Enabled' : 'Disabled'}
            </label>
          </div>
        ) : (
          <>
            <div className="ax-tune-slider-row">
              <span className="ax-tune-slider-min">{merged.min}</span>
              <input
                className="ax-tune-slider"
                type="range"
                min={merged.min}
                max={merged.max}
                step={merged.step}
                value={isBlank ? (merged.defaultValue !== '' ? merged.defaultValue : merged.min) : value}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  merged.algos.forEach((a) => update(a, merged.key, v))
                }}
              />
              <span className="ax-tune-slider-max">{merged.max}</span>
              <span className="ax-tune-slider-val">
                {isBlank ? 'None' : (merged.key === 'C' ? Number(value).toFixed(2) : value)}
              </span>
            </div>
            {merged.type === 'numberOrBlank' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <input
                  type="checkbox"
                  id={`tune-none-${merged.key}-${primaryAlgo}`}
                  checked={isBlank}
                  onChange={(e) => {
                    const newVal = e.target.checked ? '' : (merged.defaultValue !== '' ? merged.defaultValue : merged.min)
                    merged.algos.forEach((a) => update(a, merged.key, newVal))
                  }}
                  style={{ accentColor: 'var(--color-accent)' }}
                />
                <label htmlFor={`tune-none-${merged.key}-${primaryAlgo}`} style={{ fontSize: 11, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>No limit</label>
              </div>
            )}
          </>
        )}

        {/* Hint */}
        {hint && (
          <div className="ax-tune-param-hint">→ {hint}</div>
        )}
      </div>
    )
  }

  const buildEffectMessage = () => {
    if (!changedParams.length) return null
    const pairs = changedParams.slice(0, 3).map((p) => {
      const from = p.dflt === '' ? '∞' : p.dflt
      const to = p.current === '' ? '∞' : p.current
      return `${p.key} from ${from} → ${to}`
    })
    const gap = activeHealth?.metrics?.find((m) => m.label.toLowerCase().includes('gap'))
    const gapNote = gap ? ` to shrink the train/test gap from ${gap.value} toward ~5%.` : '.'
    return `Changing ${pairs.join(' and ')} ${changedParams.some((p) => ['max_depth','min_samples_leaf'].includes(p.key)) ? 'should reduce overfitting' : 'may affect convergence'}${gapNote}`
  }
  const effectMessage = buildEffectMessage()

  // Build the list of tabs: prepend 'All Parameters' if selectedAlgos.length > 1
  const tabs = selectedAlgos.length > 1 ? ['all', ...selectedAlgos] : selectedAlgos

  return (
    <div style={{ marginTop: 8 }}>
      {/* Tab bar: TUNING label + algo pills */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 4 }}>TUNING</span>
        {tabs.map((tabKey) => {
          const isActive = tabKey === validTab
          const health = tabKey !== 'all' ? getAlgoHealth(tabKey) : null
          const tone = health ? healthTone(health.color) : null
          return (
            <button
              key={tabKey}
              type="button"
              onClick={() => setActiveTab(tabKey)}
              style={{
                padding: '5px 14px',
                borderRadius: 999,
                border: isActive ? 'none' : '1.5px solid var(--color-border-tertiary)',
                background: isActive ? 'var(--color-accent)' : 'var(--color-background-primary)',
                color: isActive ? '#fff' : 'var(--color-text-secondary)',
                fontSize: 12, fontWeight: isActive ? 700 : 500,
                cursor: 'pointer', transition: 'all 0.15s',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <span>{tabKey === 'all' ? 'All Hyperparameters' : algoLabel(tabKey)}</span>
              {health && tone && (
                <span style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: isActive ? 'rgba(255,255,255,0.2)' : tone.bg,
                  color: isActive ? '#fff' : tone.text,
                  fontWeight: 700
                }}>
                  {health.color === 'red' || health.color === 'orange' ? '⚠ overfit' : '✓ healthy'}
                </span>
              )}
            </button>
          )
        })}
        {/* Health badge on the right */}
        {activeHealth && activeTone && (
          <span style={{
            marginLeft: 'auto', fontSize: 11, color: activeTone.text,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            Last health: <strong style={{ color: activeTone.text }}>{activeHealth.label.toLowerCase()}</strong>
          </span>
        )}
      </div>

      {/* Two-column grid: COMPLEXITY | CONVERGENCE & SCALE */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        {/* COMPLEXITY column */}
        {complexityParams.length > 0 && (
          <div style={{
            background: 'var(--color-background-secondary)',
            border: '1.5px solid var(--color-border-tertiary)',
            borderRadius: 12, padding: '14px 14px 6px',
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>COMPLEXITY</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 14 }}>Lower → simpler model, less overfitting risk.</div>
            {complexityParams.map(renderParamCard)}
          </div>
        )}

        {/* CONVERGENCE & SCALE column */}
        {convergenceParams.length > 0 && (
          <div style={{
            background: 'var(--color-background-secondary)',
            border: '1.5px solid var(--color-border-tertiary)',
            borderRadius: 12, padding: '14px 14px 6px',
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>CONVERGENCE &amp; SCALE</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 14 }}>Higher → fits more carefully, slower to train.</div>
            {convergenceParams.map(renderParamCard)}
          </div>
        )}
      </div>

      {/* Effect prediction banner */}
      {effectMessage && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          marginTop: 16, padding: '14px 16px',
          background: '#FFFBEB', border: '1.5px solid #FDE68A', borderRadius: 12,
          fontSize: 12, color: '#92400E', lineHeight: 1.6,
        }}>
          <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>💡</span>
          <div>
            <strong style={{ fontWeight: 700 }}>Likely effect on this run</strong><br />
            {effectMessage}
          </div>
        </div>
      )}
    </div>
  )
}

// Panel that summarizes the training preprocessing plan and lists detected validation issues.

function PreprocessingPlan({ plan, checks: propChecks, onFixAction, dismissedChecks, onDismissCheck }) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  const checks = propChecks || plan.validation_checks || []
  const correlatedPairs = plan.correlated_pairs || plan.multicollinearity || []
  const issueCount = checks.filter((c) => {
    const dismissed = (dismissedChecks || []).includes(c.key)
    const effective = dismissed && c.status === 'warning' ? 'ok' : c.status
    return effective === 'block' || effective === 'warning'
  }).length

  const summaryRows = [
    { label: 'Task', value: `${plan.task.charAt(0).toUpperCase() + plan.task.slice(1)} · ${plan.target}` },
    {
      label: 'Rows',
      value: plan.rows_dropped > 0
        ? `${plan.rows_used.toLocaleString()} used · ${plan.rows_dropped} dropped`
        : `${plan.rows_used.toLocaleString()} rows`,
      danger: plan.rows_dropped > 0,
    },
    plan.encoding.length > 0 && {
      label: 'Encoding',
      value: (() => {
        const counts = {}
        plan.encoding.forEach((e) => {
          const methodLabel = e.method === 'one_hot' ? 'One-Hot' : e.method === 'ordinal' ? 'Ordinal' : e.method === 'binary' ? 'Binary' : e.method
          counts[methodLabel] = (counts[methodLabel] || 0) + 1
        })
        return Object.entries(counts)
          .map(([method, count]) => `${count} ${method}`)
          .join(', ')
      })(),
    },
    {
      label: 'Scaling',
      value: (() => {
        const method = (plan.numeric_preprocessing?.effective_scaling || (plan.scaling?.[0]?.method === 'MinMaxScaler' ? 'minmax' : plan.scaling?.[0]?.method === 'StandardScaler' ? 'standard' : 'none')).toLowerCase()
        if (method === 'minmax') return 'MinMaxScaler on numeric features'
        if (method === 'standard') return 'StandardScaler on numeric features'
        return 'None'
      })()
    },
    plan.split && {
      label: 'Split',
      value: `${Math.round((plan.split.train_size || 0.8) * 100)}% train / ${Math.round((plan.split.test_size || 0.2) * 100)}% test${plan.split.stratified ? ' (stratified)' : ''}`,
    },
  ].filter(Boolean)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Preprocessing summary */}
      <div style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: 8, padding: '12px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <p style={{ fontSize: 12, fontWeight: 600, margin: 0, color: 'var(--color-text-primary)' }}>Preprocessing summary</p>
          <button
            className="ax-btn"
            style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={() => setDetailsOpen((v) => !v)}
            type="button"
          >
            {detailsOpen ? 'Hide details' : 'View details ▾'}
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {summaryRows.map((row, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12 }}>
              <span style={{ width: 68, flexShrink: 0, fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', paddingTop: 2 }}>
                {row.label}
              </span>
              <span style={{ color: row.danger ? 'var(--color-text-danger)' : undefined }}>{row.value}</span>
            </div>
          ))}
        </div>
        {detailsOpen && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '0.5px solid var(--color-border-tertiary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {plan.encoding.length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
                <strong>Encoded columns:</strong> {plan.encoding.map((e) => `${e.column} (${e.n_categories})`).join(', ')}
              </p>
            )}
            {plan.scaling.length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
                <strong>Scaling applies to:</strong> {plan.scaling[0].applies_to.join(', ')}
              </p>
            )}
            {plan.missing_report.length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
                <strong>Missing values:</strong> {plan.missing_report.map((m) => `${m.column} (${m.missing})`).join(' · ')}
              </p>
            )}
            {(plan.multicollinearity || []).length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
                <strong>Collinearity:</strong> {plan.multicollinearity.slice(0, 4).map((p) => `${p.feature_a} + ${p.feature_b} (r=${Number(p.correlation).toFixed(2)})`).join(' · ')}
                {plan.multicollinearity.length > 4 ? ` · +${plan.multicollinearity.length - 4} more` : ''}
              </p>
            )}
            {(plan.excluded_features || []).length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
                <strong>Excluded:</strong> {plan.excluded_features.map((x) => x.feature).join(', ')}
              </p>
            )}
            {plan.class_weight && (
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
                <strong>Class weights:</strong> Balanced for supported classifiers
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Renders a labeled row used inside the preprocessing plan summary layout.
function PlanLine({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
      <span style={{ width: 80, flexShrink: 0, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.06em', paddingTop: 2 }}>
        {label}
      </span>
      <span style={{ flex: 1 }}>{children}</span>
    </div>
  )
}

// Renders the fix-options menu for a validation issue with single or multiple route choices.
function IssueActionMenu({ check, onResolveIssue, onExecuteAction }) {
  const [open, setOpen] = useState(false)
  const actions = check.actions || []
  if (!actions.length) {
    return (
      <button className="ax-btn mini" type="button" onClick={() => onResolveIssue?.(check)}>
        Fix this
      </button>
    )
  }
  return (
    <div className="ax-issue-actions">
      <button className="ax-btn mini" type="button" onClick={() => setOpen((value) => !value)}>
        Fix options ▾
      </button>
      {open && (
        <div className="ax-issue-menu">
          {actions.map((action, idx) => (
            <button
              key={`${action.route}-${idx}`}
              type="button"
              onClick={() => {
                setOpen(false)
                onExecuteAction?.(action)
              }}
            >
              <span>{action.label}</span>
              <small>{routeLabel(action.route)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Panel that displays trained model comparison, health card, and detailed inspection of the active model.
function ResultsPanel({ results, activeIdx, setActiveIdx, onUseInWhatIf, datasetId, onFixAction, section = 'results', aiExplainActive, onExplain, onToggleExplain, toastMsg }) {
  const dialog = useDialog()
  const { models, skipped } = results
  if (!models || models.length === 0) {
    return (
      <p style={{ fontSize: 12, color: 'var(--color-text-danger)' }}>
        No models trained. {skipped?.[0]?.reason}
      </p>
    )
  }
  const active = models[activeIdx] || models[0]
  const compareSummary = models.map((m) => ({
    algorithm: m.algorithm,
    target: m.target,
    metrics: m.metrics,
  }))

  const isClassification = active.metrics?.task === 'classification'
  const activeHealth = assessModelHealth(active)
  const activeTone = healthTone(activeHealth?.color)

  const [featureModelIdx, setFeatureModelIdx] = useState(activeIdx)

  useEffect(() => {
    setFeatureModelIdx(activeIdx)
  }, [activeIdx])
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    if (!showModelDropdown) return
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowModelDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModelDropdown])
  const featureModel = models[featureModelIdx] || active
  const featureInfluence = useMemo(() => {
    return normalizeInfluence(featureModel.feature_influence || featureModel.feature_importance)
  }, [featureModel])
  const bestIdx = useMemo(() => {
    let idx = 0
    let bestVal = -Infinity
    models.forEach((m, i) => {
      const val = m.metrics?.task === 'classification' ? (m.metrics?.accuracy ?? 0) : (m.metrics?.r2 ?? -Infinity)
      if (val > bestVal) { bestVal = val; idx = i }
    })
    return idx
  }, [models])

  const targetName = featureModel?.target || 'target'
  const keyInsights = useMemo(() => {
    if (!featureInfluence.length) return []
    const sorted = [...featureInfluence].sort((a, b) => (b.relative_strength ?? b.strength ?? 0) - (a.relative_strength ?? a.strength ?? 0))
    const top = sorted[0]
    const topPct = Math.round((top?.relative_strength ?? top?.strength ?? 0) * 100)
    const insights = []
    if (top && topPct > 25) {
      insights.push(`The model relies mostly on ${top.feature} when predicting ${targetName}.`)
    }
    const strong = sorted.find((f) => {
      const pct = Math.round((f.relative_strength ?? f.strength ?? 0) * 100)
      return pct >= 10 && pct <= 50 && (f.direction === 'positive' || f.direction === 'negative')
    })
    if (strong) {
      const dir = strong.direction === 'positive' ? 'higher' : 'lower'
      insights.push(`${strong.feature} with ${dir} values tends to predict ${dir} ${targetName}.`)
    }
    const weak = sorted.find((f) => {
      const pct = Math.round((f.relative_strength ?? f.strength ?? 0) * 100)
      return pct <= 5 && pct >= 0
    })
    if (weak) {
      insights.push(`${weak.feature} has very little influence on the prediction.`)
    }
    return insights.slice(0, 3)
  }, [featureInfluence, targetName])

  const businessTakeaways = useMemo(() => {
    if (!featureInfluence.length) return []
    const sorted = [...featureInfluence].sort((a, b) => (b.relative_strength ?? b.strength ?? 0) - (a.relative_strength ?? a.strength ?? 0))
    const takeaways = []
    if (sorted[0]) {
      takeaways.push(`${sorted[0].feature} is the strongest predictor of ${targetName}.`)
    }
    if (sorted[1]) {
      takeaways.push(`${sorted[1].feature} is the most important measurement.`)
    }
    const weakFeature = sorted.find((f) => {
      const pct = Math.round((f.relative_strength ?? f.strength ?? 0) * 100)
      return pct <= 2
    })
    if (weakFeature) {
      takeaways.push(`${weakFeature.feature} has little predictive value.`)
    }
    if (sorted.length > 2) {
      const types = sorted.slice(0, 3).map((f) => f.feature)
      takeaways.push(`Most prediction power comes from ${types.join(', ')}.`)
    }
    return takeaways.slice(0, 4)
  }, [featureInfluence, targetName])

  const leaderboard = useMemo(() => {
    const isClassification = models[0].metrics?.task === 'classification'

    // Best Accuracy / R2
    let bestAccModel = models[0]
    let bestAccVal = -Infinity
    for (const m of models) {
      const val = isClassification ? (m.metrics?.accuracy ?? 0) : (m.metrics?.r2 ?? -Infinity)
      if (val > bestAccVal) {
        bestAccVal = val
        bestAccModel = m
      }
    }

    // Best F1 / RMSE
    let bestAucModel = models[0]
    let bestAucVal = isClassification ? -Infinity : Infinity
    for (const m of models) {
      if (isClassification) {
        const val = m.metrics?.f1 ?? 0
        if (val > bestAucVal) {
          bestAucVal = val
          bestAucModel = m
        }
      } else {
        const val = m.metrics?.rmse ?? Infinity
        if (val < bestAucVal) {
          bestAucVal = val
          bestAucModel = m
        }
      }
    }

    // Smallest train-test gap
    let smallestGapModel = models[0]
    let smallestGapVal = Infinity
    for (const m of models) {
      const val = Math.abs(Number(m.metrics?.generalization_gap ?? 0))
      if (val < smallestGapVal) {
        smallestGapVal = val
        smallestGapModel = m
      }
    }

    // Watch Out (Severe/Moderate overfitting risk or highest generalization gap)
    let worstModel = models[0]
    let worstGapVal = -Infinity
    for (const m of models) {
      const val = Math.abs(Number(m.metrics?.generalization_gap ?? 0))
      if (val > worstGapVal) {
        worstGapVal = val
        worstModel = m
      }
    }

    return {
      bestAccuracy: {
        label: isClassification ? 'BEST ON ACCURACY' : 'BEST ON R²',
        value: isClassification ? pct(bestAccModel.metrics?.accuracy) : num(bestAccModel.metrics?.r2),
        rawValue: isClassification ? bestAccModel.metrics?.accuracy : bestAccModel.metrics?.r2,
        modelName: algoLabelForTask(bestAccModel.algorithm, bestAccModel.metrics?.task),
        model: bestAccModel
      },
      bestAuc: {
        label: isClassification ? 'BEST ON F1-SCORE' : 'SMALLEST RMSE',
        value: isClassification ? (bestAucModel.metrics?.f1 == null ? 'n/a' : num(bestAucModel.metrics?.f1)) : num(bestAucModel.metrics?.rmse),
        rawValue: isClassification ? bestAucModel.metrics?.f1 : bestAucModel.metrics?.rmse,
        modelName: algoLabelForTask(bestAucModel.algorithm, bestAucModel.metrics?.task),
        model: bestAucModel
      },
      smallestGap: {
        label: 'SMALLEST TRAIN-TEST GAP',
        value: isClassification ? pct(smallestGapModel.metrics?.generalization_gap) : num(smallestGapModel.metrics?.generalization_gap),
        rawValue: smallestGapModel.metrics?.generalization_gap,
        modelName: algoLabelForTask(smallestGapModel.algorithm, smallestGapModel.metrics?.task),
        model: smallestGapModel
      },
      watchOut: {
        label: 'WATCH OUT',
        value: worstModel.metrics?.generalization_gap >= 0.15 ? 'Severe risk' : worstModel.metrics?.generalization_gap >= 0.08 ? 'Moderate risk' : 'Healthy',
        rawValue: worstModel.metrics?.generalization_gap,
        modelName: algoLabelForTask(worstModel.algorithm, worstModel.metrics?.task),
        isRisk: worstModel.metrics?.generalization_gap >= 0.08,
        model: worstModel
      }
    }
  }, [models])

  return (
    <>
      {section === 'results' && (
        <>
      {toastMsg && (
        <div style={{ padding: '10px 16px', background: '#FFF7ED', borderRadius: 8, marginBottom: 16, fontSize: 12, color: '#C2410C', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={14} /> {toastMsg}
        </div>
      )}

      <ResultsSummary models={models} activeIdx={activeIdx} isClassification={isClassification} />

      {/* Leaderboard Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        {/* Card 1: Best Accuracy */}
        <div
          onClick={(e) => aiExplainActive && onExplain?.({
            type: 'metric', metricKey: isClassification ? 'accuracy' : 'r2',
            value: leaderboard.bestAccuracy.rawValue, section: 'Leaderboard',
            label: leaderboard.bestAccuracy.label,
            model: leaderboard.bestAccuracy.model
          }, e)}
          style={{
            padding: '16px',
            background: 'var(--color-background-primary)',
            border: '1.5px solid var(--color-accent)',
            borderRadius: '12px',
            boxShadow: 'var(--shadow-card)',
            cursor: aiExplainActive ? 'help' : 'default',
            outline: aiExplainActive ? '1.5px dashed rgba(249,115,22,.5)' : 'none',
            position: 'relative',
            transition: 'all .15s ease'
          }}
        >
          {aiExplainActive && <span style={{ position: 'absolute', top: 6, right: 6, fontSize: 10, fontWeight: 700, color: '#f97316', background: '#FFF7ED', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>?</span>}
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {leaderboard.bestAccuracy.label}
          </span>
          <p style={{ fontSize: '28px', fontWeight: 800, margin: '8px 0 4px', color: 'var(--color-accent)' }}>
            {leaderboard.bestAccuracy.value}
          </p>
          <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            {leaderboard.bestAccuracy.modelName}
          </span>
          <FallbackLabel text={isClassification ? null : r2FallbackLabel(leaderboard.bestAccuracy.rawValue)} />
        </div>

        {/* Card 2: Best F1 / RMSE */}
        <div
          onClick={(e) => aiExplainActive && onExplain?.({
            type: 'metric', metricKey: isClassification ? 'f1' : 'rmse',
            value: leaderboard.bestAuc.rawValue, section: 'Leaderboard',
            label: leaderboard.bestAuc.label,
            model: leaderboard.bestAuc.model
          }, e)}
          style={{
            padding: '16px',
            background: 'var(--color-background-primary)',
            border: '1.5px solid var(--color-border-tertiary)',
            borderRadius: '12px',
            boxShadow: 'var(--shadow-card)',
            cursor: aiExplainActive ? 'help' : 'default',
            outline: aiExplainActive ? '1.5px dashed rgba(249,115,22,.5)' : 'none',
            position: 'relative',
            transition: 'all .15s ease'
          }}
        >
          {aiExplainActive && <span style={{ position: 'absolute', top: 6, right: 6, fontSize: 10, fontWeight: 700, color: '#f97316', background: '#FFF7ED', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>?</span>}
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {leaderboard.bestAuc.label}
          </span>
          <p style={{ fontSize: '28px', fontWeight: 800, margin: '8px 0 4px', color: 'var(--color-text-primary)' }}>
            {leaderboard.bestAuc.value}
          </p>
          <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            {leaderboard.bestAuc.modelName}
          </span>
          {!isClassification && <FallbackLabel text={rmseFallbackLabel(leaderboard.bestAuc.rawValue, active.metrics?.target_mean)} />}
        </div>

        {/* Card 3: Smallest Gap */}
        <div
          onClick={(e) => aiExplainActive && onExplain?.({
            type: 'metric', metricKey: 'gap',
            value: leaderboard.smallestGap.rawValue, section: 'Leaderboard',
            label: leaderboard.smallestGap.label,
            model: leaderboard.smallestGap.model
          }, e)}
          style={{
            padding: '16px',
            background: 'var(--color-background-primary)',
            border: '1.5px solid var(--color-border-tertiary)',
            borderRadius: '12px',
            boxShadow: 'var(--shadow-card)',
            cursor: aiExplainActive ? 'help' : 'default',
            outline: aiExplainActive ? '1.5px dashed rgba(249,115,22,.5)' : 'none',
            position: 'relative',
            transition: 'all .15s ease'
          }}
        >
          {aiExplainActive && <span style={{ position: 'absolute', top: 6, right: 6, fontSize: 10, fontWeight: 700, color: '#f97316', background: '#FFF7ED', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>?</span>}
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {leaderboard.smallestGap.label}
          </span>
          <p style={{ fontSize: '28px', fontWeight: 800, margin: '8px 0 4px', color: 'var(--color-text-primary)' }}>
            {leaderboard.smallestGap.value}
          </p>
          <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            {leaderboard.smallestGap.modelName}
          </span>
          <FallbackLabel text={gapFallbackLabel(leaderboard.smallestGap.rawValue)} />
        </div>

        {/* Card 4: Watch Out */}
        <div
          onClick={(e) => aiExplainActive && onExplain?.({
            type: 'metric', metricKey: 'risk',
            value: leaderboard.watchOut.rawValue, section: 'Leaderboard',
            label: leaderboard.watchOut.label,
            model: leaderboard.watchOut.model
          }, e)}
          style={{
            padding: '16px',
            background: leaderboard.watchOut.isRisk ? '#FEF2F2' : 'var(--color-background-primary)',
            border: `1.5px solid ${leaderboard.watchOut.isRisk ? '#FEE2E2' : 'var(--color-border-tertiary)'}`,
            borderRadius: '12px',
            boxShadow: 'var(--shadow-card)',
            cursor: aiExplainActive ? 'help' : 'default',
            outline: aiExplainActive ? '1.5px dashed rgba(249,115,22,.5)' : 'none',
            position: 'relative',
            transition: 'all .15s ease'
          }}
        >
          {aiExplainActive && <span style={{ position: 'absolute', top: 6, right: 6, fontSize: 10, fontWeight: 700, color: '#f97316', background: '#FFF7ED', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>?</span>}
          <span style={{ fontSize: '10px', fontWeight: 700, color: leaderboard.watchOut.isRisk ? 'var(--color-text-danger)' : 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {leaderboard.watchOut.label}
          </span>
          <p style={{ fontSize: '28px', fontWeight: 800, margin: '8px 0 4px', color: leaderboard.watchOut.isRisk ? 'var(--color-text-danger)' : 'var(--color-text-primary)' }}>
            {leaderboard.watchOut.value}
          </p>
          <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            {leaderboard.watchOut.modelName}
          </span>
        </div>
      </div>

      {/* AI Explain Toggle + Comparison table block */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '20px 2px 10px' }}>
        <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 650 }}>
          COMPARISON · {models.length} MODELS
        </span>
        <ExplainButton
          datasetId={datasetId}
          step="models-comparison"
          params={{ task: models[0]?.metrics?.task, target: models[0]?.target }}
          result={{ models: compareSummary, skipped }}
          question="Which of these trained models looks most promising and why? Translate the metrics into plain English (good/mediocre/poor) and call out any red flags like overfitting or class imbalance."
          label="AI explain results"
        />
      </div>

      <ComparisonTable models={models} activeIdx={activeIdx} onPick={setActiveIdx} aiExplainActive={aiExplainActive} onExplain={onExplain} />

      {skipped?.length > 0 && (
        <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '6px 0 12px' }}>
          Skipped: {skipped.map((s) => `${s.algorithm} (${s.reason})`).join(' · ')}
        </p>
      )}

        </>
      )}

      {/* Model Health and Feature Influence Split Panel */}
      {(section === 'results' || section === 'features') && (
      <div id="models-health" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20, marginTop: 20 }}>
        {/* Left Card: Model Health */}
        {section === 'results' && <div className="ax-card" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                MODEL HEALTH
              </span>
              <h3 style={{ fontSize: '18px', fontWeight: 800, margin: '4px 0 0', color: 'var(--color-text-primary)' }}>
                {algoLabelForTask(active.algorithm, active.metrics?.task)}
              </h3>
            </div>
            {activeHealth && (
              <span
                className="ax-chip"
                style={{
                  background: activeTone.chipBg,
                  color: activeTone.text,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 999
                }}
              >
                {activeHealth.label}
              </span>
            )}
          </div>

          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 16px', flex: '0 0 auto' }}>
            {activeHealth?.summary || 'Generalization stats computed on standard split.'}
          </p>

          {/* Metrics Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18, flex: 1 }}>
            {/* Metric 1: Train */}
            <div
              onClick={(e) => aiExplainActive && onExplain?.({ type: 'modelHealth', metricKey: 'train', value: isClassification ? active.metrics?.train_accuracy : active.metrics?.train_r2, section: 'Model Health', label: 'TRAIN', model: active }, e)}
              style={{ background: 'var(--color-background-tertiary)', border: '1px solid var(--color-border-tertiary)', borderRadius: 8, padding: '12px 14px', cursor: aiExplainActive ? 'help' : 'default', outline: aiExplainActive ? '1.5px dashed rgba(249,115,22,.5)' : 'none', position: 'relative', transition: 'all .15s ease' }}
            >
              {aiExplainActive && <span style={{ position: 'absolute', top: 4, right: 4, fontSize: 9, fontWeight: 700, color: '#f97316', background: '#FFF7ED', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>?</span>}
              <span style={{ fontSize: '9px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                TRAIN
              </span>
              <p style={{ fontSize: '24px', fontWeight: 800, margin: '4px 0 0', color: 'var(--color-text-primary)' }}>
                {isClassification ? pct(active.metrics?.train_accuracy) : num(active.metrics?.train_r2)}
              </p>
            </div>

            {/* Metric 2: Test */}
            <div
              onClick={(e) => aiExplainActive && onExplain?.({ type: 'modelHealth', metricKey: isClassification ? 'accuracy' : 'r2', value: isClassification ? active.metrics?.accuracy : active.metrics?.r2, section: 'Model Health', label: 'TEST', model: active }, e)}
              style={{ background: 'var(--color-background-tertiary)', border: '1px solid var(--color-border-tertiary)', borderRadius: 8, padding: '12px 14px', cursor: aiExplainActive ? 'help' : 'default', outline: aiExplainActive ? '1.5px dashed rgba(249,115,22,.5)' : 'none', position: 'relative', transition: 'all .15s ease' }}
            >
              {aiExplainActive && <span style={{ position: 'absolute', top: 4, right: 4, fontSize: 9, fontWeight: 700, color: '#f97316', background: '#FFF7ED', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>?</span>}
              <span style={{ fontSize: '9px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                TEST
              </span>
              <p style={{ fontSize: '24px', fontWeight: 800, margin: '4px 0 0', color: 'var(--color-text-primary)' }}>
                {isClassification ? pct(active.metrics?.accuracy) : num(active.metrics?.r2)}
              </p>
            </div>

            {/* Metric 3: Gap */}
            <div
              onClick={(e) => aiExplainActive && onExplain?.({ type: 'modelHealth', metricKey: 'gap', value: active.metrics?.generalization_gap, section: 'Model Health', label: 'GAP', model: active }, e)}
              style={{ background: 'var(--color-background-tertiary)', border: '1px solid var(--color-border-tertiary)', borderRadius: 8, padding: '12px 14px', cursor: aiExplainActive ? 'help' : 'default', outline: aiExplainActive ? '1.5px dashed rgba(249,115,22,.5)' : 'none', position: 'relative', transition: 'all .15s ease' }}
            >
              {aiExplainActive && <span style={{ position: 'absolute', top: 4, right: 4, fontSize: 9, fontWeight: 700, color: '#f97316', background: '#FFF7ED', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>?</span>}
              <span style={{ fontSize: '9px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                GAP
              </span>
              <p style={{ fontSize: '24px', fontWeight: 800, margin: '4px 0 0', color: Math.abs(active.metrics?.generalization_gap) >= 0.08 ? 'var(--color-text-warning)' : 'var(--color-text-primary)' }}>
                {isClassification ? pct(Math.abs(active.metrics?.generalization_gap)) : num(Math.abs(active.metrics?.generalization_gap))}
              </p>
              <FallbackLabel text={gapFallbackLabel(active.metrics?.generalization_gap)} />
            </div>

            {/* Metric 4: Test Rows */}
            <div style={{ background: 'var(--color-background-tertiary)', border: '1px solid var(--color-border-tertiary)', borderRadius: 8, padding: '12px 14px' }}>
              <span style={{ fontSize: '9px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                TEST ROWS
              </span>
              <p style={{ fontSize: '24px', fontWeight: 800, margin: '4px 0 0', color: 'var(--color-text-primary)' }}>
                {active.metrics?.split_rows?.test?.toLocaleString() || active.metrics?.split_rows?.total?.toLocaleString() || 'n/a'}
              </p>
            </div>
          </div>

          {/* Quick Actions Buttons */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '0.5px solid var(--color-border-tertiary)', paddingTop: 14 }}>
            <button className="ax-btn mini" onClick={() => onFixAction?.({ route: 'models.features' })} type="button">
              Review features
            </button>
            <button
              className="ax-btn mini"
              onClick={() => {
                const tuningEl = document.getElementById('models-tuning')
                if (tuningEl) {
                  tuningEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              }}
              type="button"
            >
              Simpler model
            </button>
            <button
              className="ax-btn mini"
              onClick={() => {
                const tuningEl = document.getElementById('models-tuning')
                if (tuningEl) {
                  tuningEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              }}
              type="button"
            >
              Tune complexity
            </button>
            <button className="ax-btn mini" onClick={() => onFixAction?.({ route: 'tests.correlation' })} type="button">
              Check correlations
            </button>
          </div>
        </div>}

        {/* Right Card: Feature Influence */}
        {section === 'features' && <div id="models-features" className="ax-card" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                FEATURE INFLUENCE
              </span>
              <h3 style={{ fontSize: '18px', fontWeight: 800, margin: '4px 0 0', color: 'var(--color-text-primary)' }}>
                {algoLabelForTask(featureModel.algorithm, featureModel.metrics?.task)}
              </h3>
            </div>
            <button
              className="ax-btn mini prim"
              onClick={async () => {
                if (featureModel.has_whatif) {
                  onUseInWhatIf(featureModel)
                  return
                }
                try {
                  await api.prepareModelForWhatIf(featureModel.id)
                  onUseInWhatIf({ ...featureModel, has_whatif: true })
                } catch (err) {
                  await dialog.alert({ title: 'Could Not Prepare Model', message: err.message, variant: 'danger' })
                }
              }}
              type="button"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 32 }}
            >
              Use in What If <ArrowUpRight size={14} />
            </button>
          </div>

          {/* 1. Model Selector Strip */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'thin' }}>
              {models.slice(0, 3).map((m, i) => {
                const isActive = i === featureModelIdx
                const isBest = i === bestIdx
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setFeatureModelIdx(i)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '6px 12px', borderRadius: 999, whiteSpace: 'nowrap',
                      fontSize: 11, fontWeight: isActive ? 700 : 500,
                      border: isActive ? '1.5px solid #f97316' : '1.5px solid var(--color-border-secondary)',
                      background: isActive ? '#f97316' : 'var(--color-background-primary)',
                      color: isActive ? '#fff' : 'var(--color-text-secondary)',
                      cursor: 'pointer', transition: 'all .15s ease', flexShrink: 0
                    }}
                  >
                    {algoLabelForTask(m.algorithm, m.metrics?.task)}
                    {isBest && <span style={{ fontSize: 10 }}>★</span>}
                  </button>
                )
              })}
              {models.length > 3 && (
                <div ref={dropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => setShowModelDropdown((v) => !v)}
                    style={{
                      padding: '6px 12px', borderRadius: 999,
                      fontSize: 11, fontWeight: 500,
                      border: '1.5px solid var(--color-border-secondary)',
                      background: 'var(--color-background-primary)',
                      color: 'var(--color-text-secondary)',
                      cursor: 'pointer', whiteSpace: 'nowrap'
                    }}
                  >
                    + {models.length - 3} more ▾
                  </button>
                  {showModelDropdown && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, marginTop: 4,
                      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
                      boxShadow: '0 4px 12px rgba(0,0,0,.1)', zIndex: 100, minWidth: 180, padding: 4
                    }}>
                      {models.slice(3).map((m, i) => {
                        const realIdx = i + 3
                        const isActive = realIdx === featureModelIdx
                        const isBest = realIdx === bestIdx
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => { setFeatureModelIdx(realIdx); setShowModelDropdown(false) }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 6,
                              width: '100%', padding: '6px 10px', borderRadius: 6,
                              fontSize: 11, fontWeight: isActive ? 700 : 500,
                              border: 'none', background: isActive ? '#FFF7ED' : 'transparent',
                              color: isActive ? '#C2410C' : 'var(--color-text-secondary)',
                              cursor: 'pointer', textAlign: 'left'
                            }}
                          >
                            {algoLabelForTask(m.algorithm, m.metrics?.task)}
                            {isBest && <span style={{ fontSize: 10, color: '#f97316' }}>★</span>}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            {featureModelIdx !== bestIdx && (
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>
                Viewing {algoLabelForTask(featureModel.algorithm, featureModel.metrics?.task)} — {algoLabelForTask(models[bestIdx].algorithm, models[bestIdx].metrics?.task)} has better accuracy (R² {models[bestIdx].metrics?.r2 != null ? models[bestIdx].metrics.r2.toFixed(3) : 'n/a'} vs {featureModel.metrics?.r2 != null ? featureModel.metrics.r2.toFixed(3) : 'n/a'})
                <button
                  type="button"
                  onClick={() => setFeatureModelIdx(bestIdx)}
                  style={{ background: 'none', border: 'none', color: '#f97316', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginLeft: 4, padding: 0 }}
                >
                  Switch to best →
                </button>
              </p>
            )}
          </div>

          {/* 2. Key Insights Card */}
          {keyInsights.length > 0 && (
            <div style={{ padding: '12px 16px', background: '#FFF7ED', borderLeft: '4px solid #f97316', borderRadius: 10, marginBottom: 16 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#C2410C', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>
                What SimuCast learned
              </p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {keyInsights.map((insight, i) => (
                  <li key={i} style={{ fontSize: 12, color: '#7c2d12', lineHeight: 1.5, marginBottom: i < keyInsights.length - 1 ? 4 : 0 }}>
                    • {insight}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 3. Feature Rows */}
          <style>{`.ax-feature-row:hover .ax-feature-try-btn { opacity: 1; pointer-events: auto; }`}</style>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, justifyContent: 'center' }}>
            {featureInfluence.length > 0 ? (
              featureInfluence.map((item, idx) => {
                const isPositive = item.direction === 'positive'
                const isNegative = item.direction === 'negative'
                const strengthPercent = Math.round((item.relative_strength ?? item.strength ?? 0) * 100)
                const barColor = isPositive ? 'var(--color-accent)' : isNegative ? '#334155' : 'var(--color-border-primary)'
                const strengthLabel = strengthPercent >= 30 ? 'Very Strong' : strengthPercent >= 15 ? 'Strong' : strengthPercent >= 5 ? 'Moderate' : strengthPercent >= 1 ? 'Weak' : 'No influence'
                const strengthColor = strengthPercent >= 30 ? '#C2410C' : strengthPercent >= 15 ? '#f97316' : strengthPercent >= 5 ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)'
                const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null

                return (
                  <div
                    key={item.feature}
                    className="ax-feature-row"
                    onClick={(e) => aiExplainActive && onExplain?.({ type: 'featureInfluence', metricKey: 'featureInfluence', section: 'Feature Influence', featureName: item.feature, value: strengthPercent, rank: idx + 1, totalFeatures: featureInfluence.length, model: featureModel }, e)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, cursor: aiExplainActive ? 'help' : 'default', position: 'relative', borderRadius: 8, padding: '8px 10px', transition: 'all .15s ease', background: 'transparent' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-background-secondary)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* Rank */}
                    <span style={{ width: 24, textAlign: 'center', fontSize: medal ? 14 : 11, fontWeight: 600, color: medal ? undefined : 'var(--color-text-tertiary)', flexShrink: 0 }}>
                      {medal || `${idx + 1}`}
                    </span>

                    {/* Feature Name */}
                    <span style={{ width: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--color-text-primary)', flexShrink: 0 }}>
                      {item.feature}
                    </span>

                    {/* Bar */}
                    <div style={{ flex: 1, height: 8, background: 'var(--color-background-secondary)', borderRadius: 4, overflow: 'hidden', minWidth: 60 }}>
                      <div style={{ width: `${strengthPercent}%`, height: '100%', background: `linear-gradient(90deg, #f97316, #fb923c)`, borderRadius: 4, transition: 'width 400ms ease' }} />
                    </div>

                    {/* Percentage */}
                    <span style={{ width: 36, textAlign: 'right', fontWeight: 700, color: 'var(--color-text-primary)', flexShrink: 0 }}>
                      {strengthPercent}%
                    </span>

                    {/* Strength Label */}
                    <span style={{ width: 80, fontSize: 10, fontWeight: 600, color: strengthColor, textAlign: 'left', flexShrink: 0 }}>
                      {strengthLabel}
                    </span>

                    {/* Direction indicator */}
                    <span style={{ width: 20, textAlign: 'center', fontSize: 10, color: isPositive ? 'var(--color-text-success)' : isNegative ? 'var(--color-text-danger)' : 'var(--color-text-tertiary)', flexShrink: 0 }} title={isPositive ? 'Raises prediction' : isNegative ? 'Lowers prediction' : 'Model-derived'}>
                      {isPositive ? '↑' : isNegative ? '↓' : '—'}
                    </span>

                    {/* Hover action button */}
                    <button
                      className="ax-feature-try-btn"
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onUseInWhatIf(featureModel) }}
                      style={{ opacity: 0, position: 'absolute', right: 8, background: 'none', border: '1px solid #f97316', borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 600, color: '#C2410C', cursor: 'pointer', transition: 'opacity .15s ease', whiteSpace: 'nowrap', pointerEvents: 'none' }}
                    >
                      Try in What-if →
                    </button>
                  </div>
                )
              })
            ) : (
              <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '20px 0', textAlign: 'center' }}>
                No feature influence values calculated for this model.
              </p>
            )}
          </div>

          {/* 5. Business Takeaways Card */}
          {businessTakeaways.length > 0 && (
            <div style={{ marginTop: 20, padding: '16px 18px', background: '#fffaf4', border: '1px solid #fdba74', borderLeft: '4px solid #f97316', borderRadius: 12, position: 'relative' }}>
              <p style={{ fontSize: 10, fontWeight: 800, color: '#c2410c', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 10px' }}>
                Key Takeaways
              </p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {businessTakeaways.map((t, i) => (
                  <li key={i} style={{ fontSize: 12, color: '#1f2937', lineHeight: 1.6, display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: i < businessTakeaways.length - 1 ? 4 : 0 }}>
                    <span style={{ color: '#16a34a', flexShrink: 0 }}>✓</span>
                    {t}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="ax-btn mini"
                style={{ marginTop: 12, background: '#fff', border: '1px solid #fdba74', color: '#c2410c', fontSize: 10, fontWeight: 700 }}
                onClick={() => {
                  if (dataset?.id) {
                    window.sessionStorage.setItem('simucast.reportTakeaways', JSON.stringify({ model: algoLabelForTask(featureModel.algorithm, featureModel.metrics?.task), takeaways: businessTakeaways, ts: Date.now() }))
                    onGo?.('report')
                  }
                }}
              >
                Save to Report
              </button>
            </div>
          )}
        </div>}
      </div>
      )}

      {section === 'results' && active.metrics?.confusion_matrix && (
        <div className="ax-card" style={{ padding: 20, marginTop: 20 }}>
          {/* Header */}
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px', color: 'var(--color-text-primary)' }}>
              Confusion matrix
            </h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>
              {algoLabelForTask(active.algorithm, active.metrics?.task)} · {active.metrics?.y_proba ? 'interactive threshold' : `test set · ${active.metrics.confusion_matrix.flat().reduce((a,b)=>a+b,0)} rows`}
            </p>
          </div>

          <ConfusionMatrix cm={active.metrics.confusion_matrix} metrics={active.metrics} />

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <ExplainButton
              datasetId={datasetId}
              step="confusion-matrix"
              params={{ task: active.metrics?.task, target: active.target }}
              result={{ confusion_matrix: active.metrics.confusion_matrix, accuracy: active.metrics.accuracy, precision: active.metrics.precision, recall: active.metrics.recall }}
              question="Explain this confusion matrix in plain English. What do the numbers mean? Are there any class imbalance issues?"
              label="Explain"
            />
            <button className="ax-btn mini" type="button" disabled style={{ cursor: 'default', opacity: 0.5 }}>
              Change threshold
            </button>
            <button
              className="ax-btn mini"
              type="button"
              onClick={() => {
                const cm = active.metrics.confusion_matrix
                const lines = [',' + cm[0].map((_, j) => `Pred ${j}`).join(',')]
                cm.forEach((row, i) => lines.push(`Actual ${i},${row.join(',')}`))
                const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
                const a = document.createElement('a')
                a.href = URL.createObjectURL(blob)
                a.download = 'confusion_matrix.csv'
                a.click()
              }}
            >
              Export
            </button>
          </div>
        </div>
      )}

    </>
  )
}

// Table that compares trained models side by side and marks the best performer per task.
function ComparisonTable({ models, activeIdx, onPick, aiExplainActive, onExplain }) {
  const task = models[0].metrics.task
  return (
    <div className="ax-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 6 }}>
      <table className="ax-tbl" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th>Algorithm</th>
            <th>Health</th>
            {task === 'classification' ? (
              <>
                <th>Accuracy</th>
                <th>Precision</th>
                <th>Recall</th>
                <th>F1</th>
              </>
            ) : (
              <>
                <th>R²</th>
                <th>RMSE</th>
                <th>MAE</th>
              </>
            )}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {models.map((m, i) => {
            const mt = m.metrics
            const health = assessModelHealth(m)
            const healthStyle = healthTone(health?.color)
            const isBest = (() => {
              if (task === 'classification') {
                const best = Math.max(...models.map((x) => x.metrics.accuracy ?? 0))
                return Math.abs(mt.accuracy - best) < 1e-9
              }
              const best = Math.max(...models.map((x) => x.metrics.r2 ?? -Infinity))
              return Math.abs((mt.r2 ?? -Infinity) - best) < 1e-9
            })()
            return (
              <tr
                key={m.id}
                onClick={(e) => {
                  if (aiExplainActive) {
                    onExplain?.({ type: 'comparisonRow', metricKey: 'comparisonRow', section: 'Comparison Table', model: m, label: m.label, index: i }, e)
                  }
                }}
                style={{
                  cursor: aiExplainActive ? 'help' : 'default',
                  background: i === activeIdx ? 'var(--color-accent-light)' : undefined,
                }}
              >
                <td>
                  <strong style={{ color: 'var(--color-text-primary)' }}>{m.label}</strong>
                  {isBest && (
                    <span
                      className="ax-chip"
                      style={{ marginLeft: 6, background: 'var(--color-accent)', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 4 }}
                    >
                      BEST
                    </span>
                  )}
                </td>
                <td>
                  {health ? (
                    <span className="ax-chip" style={{ background: healthStyle.chipBg, color: healthStyle.text, fontSize: 11, padding: '2px 8px', borderRadius: 999 }}>
                      {health.label}
                    </span>
                  ) : (
                    'n/a'
                  )}
                </td>
                {task === 'classification' ? (
                  <>
                    <td>{pct(mt.accuracy)}</td>
                    <td>{num(mt.precision)}</td>
                    <td>{num(mt.recall)}</td>
                    <td>{num(mt.f1)}</td>
                  </>
                ) : (
                  <>
                    <td>{num(mt.r2)}</td>
                    <td>{num(mt.rmse)}</td>
                    <td>{num(mt.mae)}</td>
                  </>
                )}
                <td>
                  <button
                    className="ax-btn mini"
                    style={{ background: 'var(--color-background-primary)', border: '1.5px solid var(--color-border-secondary)' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onPick(i)
                    }}
                    type="button"
                  >
                    Inspect
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Map model health color names to specific backgrounds, chip colors, and text colors.
function healthTone(color) {
  const tones = {
    green: { bg: '#F0FDF4', chipBg: '#DCFCE7', text: '#15803D', border: '#22C55E' },
    yellow: { bg: '#FEFCE8', chipBg: '#FEF3C7', text: '#A16207', border: '#EAB308' },
    orange: { bg: '#FFF7ED', chipBg: '#FFEDD5', text: '#C2410C', border: '#F97316' },
    red: { bg: '#FEF2F2', chipBg: '#FEE2E2', text: '#B91C1C', border: '#EF4444' },
    blue: { bg: '#EFF6FF', chipBg: '#DBEAFE', text: '#1D4ED8', border: '#3B82F6' },
    gray: { bg: 'var(--color-background-primary)', chipBg: 'var(--color-background-secondary)', text: 'var(--color-text-secondary)', border: 'var(--color-border-tertiary)' },
  }
  return tones[color] || tones.gray
}

// Builds a model-health assessment object combining stored diagnostics with computed metric rows.
function assessModelHealth(model) {
  const m = model?.metrics
  if (!m) return null
  const stored = m.health_diagnostics || {}
  const gap = Number(m.generalization_gap)
  const rows = m.split_rows || {}
  const task = m.task
  const isClassification = task === 'classification'
  const metricRows = []
  if (isClassification) {
    metricRows.push(
      { label: 'Train accuracy', value: pct(m.train_accuracy), help: 'How often the model was correct on rows it learned from.' },
      { label: 'Test accuracy', value: pct(m.accuracy), help: 'How often the model was correct on held-out rows it did not learn from.' },
      { label: 'Train-test gap', value: Number.isFinite(gap) ? pct(Math.abs(gap)) : 'n/a', help: 'A large gap means the model may perform much better on familiar rows than new rows.' }
    )
  } else {
    metricRows.push(
      { label: 'Train R2', value: num(m.train_r2), help: 'How much target variation the model explains on rows it learned from.' },
      { label: 'Test R2', value: num(m.r2), help: 'How much target variation the model explains on held-out rows.' },
      { label: 'Train-test gap', value: Number.isFinite(gap) ? num(Math.abs(gap)) : 'n/a', help: 'A large R2 gap means the model may not generalize well.' }
    )
  }
  if (rows.test) {
    metricRows.push({ label: 'Test rows', value: rows.test.toLocaleString(), help: 'Number of rows used to estimate unseen-data performance.' })
  }
  const cv = m.cross_validation
  if (cv?.enabled) {
    const mean = cv.available ? (cv.metric === 'accuracy' ? pct(cv.mean) : num(cv.mean)) : 'Unavailable'
    const std = cv.available ? (cv.metric === 'accuracy' ? pct(cv.std) : num(cv.std)) : cv.reason
    metricRows.push({
      label: cv.metric === 'accuracy' ? 'CV accuracy' : 'CV R2',
      value: cv.available ? `${mean} +/- ${std}` : mean,
      help: cv.available
        ? 'Cross-validation averages performance across several train/test splits.'
        : (cv.reason || 'Cross-validation could not be computed for this setup.'),
    })
  }
  const fallbackActions = [
    { label: 'Review feature selection', why: 'Cleaner features can improve generalization.', route: 'models.features' },
    { label: 'Use cross-validation', why: 'Multiple splits give a steadier health estimate.', route: 'models.validation_split' },
  ]
  if (stored.status) {
    return {
      status: stored.status,
      color: stored.color || 'gray',
      label: stored.label || 'Model health',
      summary: stored.summary || 'SimuCast checked train and test performance for this model.',
      metrics: metricRows,
      causes: Array.isArray(stored.causes) ? stored.causes : [],
      actions: Array.isArray(stored.recommended_fixes) ? stored.recommended_fixes : fallbackActions,
      confidence: stored.confidence || 'normal',
    }
  }
  if (m.task === 'classification') {
    const train = Number(m.train_accuracy)
    const test = Number(m.accuracy)
    if (!Number.isFinite(train) || !Number.isFinite(test)) {
      return {
        status: 'insufficient_data',
        color: 'gray',
        label: 'Diagnostics unavailable',
        summary: 'Health metrics are unavailable for this saved model. New training runs include train/test diagnostics automatically.',
        metrics: metricRows.filter((item) => item.value !== 'n/a'),
        causes: ['This looks like an older saved model or an incomplete training artifact.'],
        actions: [{ label: 'Train a fresh comparison', why: 'New model runs automatically store train/test health metrics.', route: 'models.algorithms' }],
      }
    }
    const overfit = Number.isFinite(gap) && (gap >= 0.15 || (train >= 0.95 && test < 0.85))
    return {
      status: overfit ? 'moderate_overfitting' : 'healthy',
      color: overfit ? 'orange' : 'green',
      label: overfit ? 'Possible overfitting' : 'No major overfitting signal',
      summary: overfit
        ? 'The model performs much better on training rows than test rows, so it may be memorizing patterns that do not generalize.'
        : 'Training and test performance are close enough that there is no obvious overfitting signal from this split.',
      metrics: metricRows,
      causes: overfit ? ['Training performance is noticeably higher than test performance.'] : [],
      actions: overfit
        ? fallbackActions
        : [{ label: 'Validate before reporting', why: 'A second split or cross-validation makes the result more trustworthy.', route: 'models.validation_split' }],
    }
  }
  const train = Number(m.train_r2)
  const test = Number(m.r2)
  if (!Number.isFinite(train) || !Number.isFinite(test)) {
    return {
      status: 'insufficient_data',
      color: 'gray',
      label: 'Diagnostics unavailable',
      summary: 'Health metrics are unavailable for this saved model. New training runs include train/test diagnostics automatically.',
      metrics: metricRows.filter((item) => item.value !== 'n/a'),
      causes: ['This looks like an older saved model or an incomplete training artifact.'],
      actions: [{ label: 'Train a fresh comparison', why: 'New model runs automatically store train/test health metrics.', route: 'models.algorithms' }],
    }
  }
  const overfit = Number.isFinite(gap) && (gap >= 0.15 || (train >= 0.9 && test < 0.65))
  return {
    status: overfit ? 'moderate_overfitting' : 'healthy',
    color: overfit ? 'orange' : 'green',
    label: overfit ? 'Possible overfitting' : 'No major overfitting signal',
    summary: overfit
      ? 'The model explains training rows much better than test rows, which suggests weak generalization.'
      : 'Training and test R2 are close enough that this split does not show a strong overfitting warning.',
    metrics: metricRows,
    causes: overfit ? ['Training R2 is noticeably higher than test R2.'] : [],
    actions: overfit
      ? fallbackActions
      : [{ label: 'Validate before reporting', why: 'A second split or cross-validation makes the result more trustworthy.', route: 'models.validation_split' }],
  }
}

// Renders a classification confusion matrix with cells shaded by intensity and diagonal emphasis.
function ConfusionMatrix({ cm, metrics, active, datasetId }) {
  const [threshold, setThreshold] = useState(metrics?.threshold ?? 0.5)

  // Sync threshold when model changes
  useEffect(() => {
    setThreshold(metrics?.threshold ?? 0.5)
  }, [metrics])

  const hasProbas = Boolean(metrics?.y_test && metrics?.y_proba)

  // Recalculate Confusion Matrix if we have y_test and y_proba
  const computedCm = useMemo(() => {
    if (!hasProbas) {
      return cm
    }
    const nextCm = [[0, 0], [0, 0]]
    for (let i = 0; i < metrics.y_test.length; i++) {
      const actual = metrics.y_test[i] // 0 or 1
      const prob = metrics.y_proba[i] // float [0, 1]
      const pred = prob >= threshold ? 1 : 0
      if (actual === 0 || actual === 1) {
        nextCm[actual][pred]++
      }
    }
    return nextCm
  }, [cm, metrics?.y_test, metrics?.y_proba, threshold, hasProbas])

  const n = computedCm.length
  const is2x2 = n === 2
  const total = computedCm.flat().reduce((a, b) => a + b, 0)
  const correctTotal = computedCm.reduce((acc, row, i) => acc + row[i], 0)
  const accuracy = total > 0 ? correctTotal / total : 0

  const rowSums = computedCm.map((row) => row.reduce((a, b) => a + b, 0))
  const colSums = computedCm[0].map((_, j) => computedCm.reduce((a, row) => a + row[j], 0))

  const className0 = metrics?.class_names?.[0] ?? 'Class 0'
  const className1 = metrics?.class_names?.[1] ?? 'Class 1'

  // If binary (2x2), render exactly like the 2nd image
  if (is2x2) {
    const tn = computedCm[0][0]
    const fp = computedCm[0][1]
    const fn = computedCm[1][0]
    const tp = computedCm[1][1]

    const tpPct = total > 0 ? Math.round((tp / total) * 100) : 0
    const tnPct = total > 0 ? Math.round((tn / total) * 100) : 0
    const fpPct = total > 0 ? Math.round((fp / total) * 100) : 0
    const fnPct = total > 0 ? Math.round((fn / total) * 100) : 0

    // Style dynamically depending on which count is higher
    const tnStyle = tn >= tp
      ? { bg: 'var(--color-accent)', text: '#FFFFFF', label: 'rgba(255, 255, 255, 0.85)' }
      : { bg: '#FFD9C0', text: '#C2410C', label: '#C2410C' }
    const tpStyle = tp >= tn
      ? { bg: 'var(--color-accent)', text: '#FFFFFF', label: 'rgba(255, 255, 255, 0.85)' }
      : { bg: '#FFD9C0', text: '#C2410C', label: '#C2410C' }

    const fpStyle = fp >= fn && fp > 0
      ? { bg: '#B3B3B3', text: '#1F2937', label: '#4B5563' }
      : { bg: '#F3F4F6', text: '#1F2937', label: '#4B5563' }
    const fnStyle = fn >= fp && fn > 0
      ? { bg: '#B3B3B3', text: '#1F2937', label: '#4B5563' }
      : { bg: '#F3F4F6', text: '#1F2937', label: '#4B5563' }

    return (
      <div>
        <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* LEFT SECTION: Matrix + Slider */}
          <div style={{ display: 'flex', flexDirection: 'column', width: 440, flexShrink: 0 }}>
          {/* Columns header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '80px 170px 170px', gap: 10, marginBottom: 8 }}>
            <div />
            <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>PRED 0</div>
            <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>PRED 1</div>
          </div>

          {/* Row 0 (ACTUAL 0) */}
          <div style={{ display: 'grid', gridTemplateColumns: '80px 170px 170px', gap: 10, marginBottom: 10, alignItems: 'center' }}>
            <div style={{ textAlign: 'right', paddingRight: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>ACTUAL</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>{className0}</span>
            </div>
            {/* TN Cell */}
            <div
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                borderRadius: 14, minHeight: 120,
                background: tnStyle.bg,
                border: 'none',
              }}
            >
              <span style={{ fontSize: 36, fontWeight: 800, color: tnStyle.text, fontFamily: 'var(--font-mono)', lineHeight: 1.1 }}>
                {tn}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: tnStyle.label, textTransform: 'uppercase', marginTop: 4 }}>
                TN
              </span>
            </div>
            {/* FP Cell */}
            <div
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                borderRadius: 14, minHeight: 120,
                background: fpStyle.bg,
                border: 'none',
              }}
            >
              <span style={{ fontSize: 36, fontWeight: 800, color: fpStyle.text, fontFamily: 'var(--font-mono)', lineHeight: 1.1 }}>
                {fp}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: fpStyle.label, textTransform: 'uppercase', marginTop: 4 }}>
                FP
              </span>
            </div>
          </div>

          {/* Row 1 (ACTUAL 1) */}
          <div style={{ display: 'grid', gridTemplateColumns: '80px 170px 170px', gap: 10, marginBottom: 10, alignItems: 'center' }}>
            <div style={{ textAlign: 'right', paddingRight: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>ACTUAL</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>{className1}</span>
            </div>
            {/* FN Cell */}
            <div
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                borderRadius: 14, minHeight: 120,
                background: fnStyle.bg,
                border: 'none',
              }}
            >
              <span style={{ fontSize: 36, fontWeight: 800, color: fnStyle.text, fontFamily: 'var(--font-mono)', lineHeight: 1.1 }}>
                {fn}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: fnStyle.label, textTransform: 'uppercase', marginTop: 4 }}>
                FN
              </span>
            </div>
            {/* TP Cell */}
            <div
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                borderRadius: 14, minHeight: 120,
                background: tpStyle.bg,
                border: 'none',
              }}
            >
              <span style={{ fontSize: 36, fontWeight: 800, color: tpStyle.text, fontFamily: 'var(--font-mono)', lineHeight: 1.1 }}>
                {tp}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: tpStyle.label, textTransform: 'uppercase', marginTop: 4 }}>
                TP
              </span>
            </div>
          </div>

          {/* Slider Card (Decision Threshold) */}
          {hasProbas && (
            <div
              style={{
                marginTop: 12,
                padding: '14px 18px',
                background: '#F9FAFB',
                border: '1px solid var(--color-border-secondary)',
                borderRadius: 12,
                width: '100%',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  DECISION THRESHOLD
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
                  p ≥ {threshold.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0.00"
                max="1.00"
                step="0.01"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                style={{
                  width: '100%',
                  height: '6px',
                  borderRadius: '3px',
                  outline: 'none',
                  cursor: 'pointer',
                  accentColor: 'var(--color-accent)',
                  margin: '10px 0',
                }}
              />
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                Slide to trade precision for recall on Class 1.
              </div>
            </div>
          )}

          {/* Simple Overall Accuracy display for binary classifier */}
          <div style={{ marginTop: 12, padding: '10px 14px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-accent)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>OVERALL</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-primary)' }}>{(accuracy * 100).toFixed(1)}% accuracy</span>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>{correctTotal} correct of {total}</span>
          </div>
        </div>

        {/* RIGHT SECTION: Breakdown Cards */}
        <div style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { label: 'True positives', count: tp, pct: tpPct, desc: `Predicted ${className1} · actually ${className1}`, orange: true },
            { label: 'True negatives', count: tn, pct: tnPct, desc: `Predicted ${className0} · actually ${className0}`, orange: true },
            { label: 'False positives', count: fp, pct: fpPct, desc: `Predicted ${className1} · actually ${className0}`, orange: false },
            { label: 'False negatives', count: fn, pct: fnPct, desc: `Predicted ${className0} · actually ${className1}`, orange: false },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                border: '1px solid var(--color-border-secondary)',
                borderRadius: 12,
                padding: '12px 18px',
                background: '#FFFFFF',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: item.orange ? 'var(--color-accent)' : '#9CA3AF',
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                    {item.label}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {item.count}
                  </span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {item.pct}%
                </span>
              </div>

              {/* Progress bar */}
              <div style={{ height: 6, background: '#F3F4F6', borderRadius: 3, overflow: 'hidden', margin: '8px 0' }}>
                <div
                  style={{
                    width: `${item.pct}%`,
                    height: '100%',
                    background: item.orange ? 'var(--color-accent)' : '#9CA3AF',
                    borderRadius: 3,
                  }}
                />
              </div>

              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {item.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Multiclass Fallback (same as original clean table with totals)
const diagValues = computedCm.map((row, idx) => row[idx])
const maxDiag = Math.max(...diagValues)
const offDiagValues = computedCm.flatMap((row, rIdx) => row.filter((_, cIdx) => rIdx !== cIdx))
const maxOffDiag = Math.max(...offDiagValues)

return (
  <div>
    <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      
      {/* LEFT SECTION: Matrix Grid */}
      <div style={{ flexShrink: 0 }}>
        {/* Column headers row */}
        <div style={{ display: 'grid', gridTemplateColumns: `80px repeat(${n}, 100px) 60px`, gap: 10, marginBottom: 8 }}>
          <div />
          {computedCm[0].map((_, j) => (
            <div key={j} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>PRED {j}</div>
          ))}
          <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>TOTAL</div>
        </div>

        {/* Data rows */}
        {computedCm.map((row, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: `80px repeat(${n}, 100px) 60px`, gap: 10, marginBottom: 10, alignItems: 'center' }}>
            {/* Row label */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', paddingRight: 12, gap: 2 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>ACTUAL</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                {metrics?.class_names?.[i] ?? i}
              </span>
            </div>
            {/* Cells */}
            {row.map((v, j) => {
              const isDiag = i === j
              // Styling logic: diagonal cells styled orange, off-diagonal gray
              let bg = '#F3F4F6'
              let color = '#1F2937'
              let fontWeight = 500

              if (isDiag) {
                fontWeight = 800
                if (v === maxDiag && maxDiag > 0) {
                  bg = 'var(--color-accent)'
                  color = '#FFFFFF'
                } else {
                  bg = '#FFD9C0'
                  color = '#C2410C'
                }
              } else {
                if (v === maxOffDiag && maxOffDiag > 0) {
                  bg = '#B3B3B3'
                  color = '#1F2937'
                  fontWeight = 700
                } else {
                  bg = '#F3F4F6'
                  color = '#4B5563'
                }
              }

              return (
                <div
                  key={j}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 12, minHeight: 74,
                    background: bg,
                    border: 'none',
                  }}
                >
                  <span style={{ fontSize: 22, fontWeight: fontWeight, color: color, fontFamily: 'var(--font-mono)', lineHeight: 1.1 }}>
                    {v}
                  </span>
                </div>
              )
            })}
            {/* Row total */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {rowSums[i]}
            </div>
          </div>
        ))}

        {/* Column totals row */}
        <div style={{ display: 'grid', gridTemplateColumns: `80px repeat(${n}, 100px) 60px`, gap: 10, marginTop: 4, alignItems: 'center' }}>
          <div />
          {colSums.map((s, j) => (
            <div key={j} style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>{s}</div>
          ))}
          <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{total}</div>
        </div>

        {/* Overall accuracy bar */}
        <div style={{ marginTop: 16, padding: '10px 14px', background: '#FFF7ED', border: '1.5px solid #FED7AA', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-accent)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>OVERALL</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-primary)' }}>{(accuracy * 100).toFixed(1)}% accuracy</span>
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>{correctTotal} correct of {total}</span>
        </div>
      </div>

      {/* RIGHT SECTION: Stacked cards for each class */}
      <div style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {computedCm.map((_, i) => {
          const className = metrics?.class_names?.[i] ?? `Class ${i}`
          const correct = computedCm[i][i]
          const totalRows = rowSums[i]
          const recallPct = totalRows > 0 ? Math.round((correct / totalRows) * 100) : 0
          const precisionPct = colSums[i] > 0 ? Math.round((correct / colSums[i]) * 100) : 0
          const correctPctOfTotal = total > 0 ? Math.round((correct / total) * 100) : 0

          return (
            <div
              key={i}
              style={{
                border: '1px solid var(--color-border-secondary)',
                borderRadius: 12,
                padding: '12px 18px',
                background: '#FFFFFF',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: 'var(--color-accent)',
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                    {className}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 650, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {correct}/{totalRows} correct
                  </span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {recallPct}% recall
                </span>
              </div>

              {/* Progress bar representing recall */}
              <div style={{ height: 6, background: '#F3F4F6', borderRadius: 3, overflow: 'hidden', margin: '8px 0' }}>
                <div
                  style={{
                    width: `${recallPct}%`,
                    height: '100%',
                    background: 'var(--color-accent)',
                    borderRadius: 3,
                  }}
                />
              </div>

              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {precisionPct}% precision · accounts for {correctPctOfTotal}% of all dataset samples
              </div>
            </div>
          )
        })}
      </div>

    </div>
  </div>
)
}


// Returns a short formatted string of the headline metrics for a trained model.
function formatMetrics(m) {
  if (!m) return ''
  if (m.task === 'classification') {
    const parts = [`accuracy ${pct(m.accuracy)}`]
    if (m.f1 != null) parts.push(`F1 ${num(m.f1)}`)
    return parts.join(' · ')
  }
  return `R² ${num(m.r2)} · RMSE ${num(m.rmse)}`
}

// Normalizes a feature-influence value into an array of entries with relative strength scaled to one.
function normalizeInfluence(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  const entries = Object.entries(value)
  const total = entries.reduce((acc, [, v]) => acc + (Number(v) || 0), 0) || 1
  return entries.map(([feature, strength]) => ({
    feature,
    strength: Number(strength) || 0,
    relative_strength: (Number(strength) || 0) / total,
    direction: null,
  }))
}

// Maps a feature-influence direction code to a human-readable label like Increases or Decreases.
function directionLabel(direction) {
  if (direction === 'positive') return 'Increases'
  if (direction === 'negative') return 'Decreases'
  if (direction === 'mixed') return 'Mixed'
  return 'Model-derived'
}

// Returns the CSS color variable used to style positive, negative, or neutral influence directions.
function directionColor(direction) {
  if (direction === 'positive') return 'var(--color-text-success)'
  if (direction === 'negative') return 'var(--color-text-danger)'
  return 'var(--color-text-secondary)'
}

// Formats a fractional value as a one-decimal percentage string, or em dash when null.
function pct(v) {
  if (v == null) return '—'
  return `${(v * 100).toFixed(1)}%`
}
// Formats a numeric value to three decimals, returning an em dash for null or undefined.
function num(v) {
  if (v == null) return '—'
  return Number(v).toFixed(3)
}

// Returns an object holding the default parameter values for every supported algorithm.
function defaultModelParams() {
  return Object.fromEntries(
    Object.entries(PARAM_DEFS).map(([algo, defs]) => [
      algo,
      Object.fromEntries(defs.map((def) => [def.key, def.defaultValue])),
    ]),
  )
}

// Returns the user-facing display label for an algorithm key, falling back to the key itself.
function algoLabel(algo) {
  return ALGOS.find((a) => a.key === algo)?.label || algo
}

// Returns a task-aware algorithm label that distinguishes classifier and regressor variants.
function algoLabelForTask(algo, task) {
  if (algo === 'rf') return task === 'classification' ? 'Random Forest Classifier' : task === 'regression' ? 'Random Forest Regressor' : 'Random Forest'
  if (algo === 'tree') return task === 'classification' ? 'Decision Tree Classifier' : task === 'regression' ? 'Decision Tree Regressor' : 'Decision Tree'
  return algoLabel(algo)
}

// Builds the training target options payload from the user's validation and class-weight choices.
function targetOptions(mode, positiveClass, testSize, validationMethod, cvFolds, stratify, classBalanceStrategy, numericPreprocessing, categoricalEncoding, categoricalOrders) {
  const options = {}
  if (mode && mode !== 'auto') options.mode = mode
  if (positiveClass) options.positive_class = positiveClass
  options.test_size = testSize
  options.validation_method = validationMethod || 'standard_split'
  if (options.validation_method === 'cross_validation') options.cv_folds = cvFolds || 5
  options.stratify = stratify
  if (classBalanceStrategy === 'balanced') options.class_weight = 'balanced'
  if (classBalanceStrategy === 'smote') options.smote = true
  options.numeric_preprocessing = numericPreprocessing || { scaling: 'auto', log_columns: [], integer_columns: [] }
  options.categorical_encoding = categoricalEncoding || {}
  options.categorical_order = categoricalOrders || {}
  return options
}

// Maps a fix-action route key to the destination page and section id used for navigation.
function routeToFixTarget(route) {
  const map = {
    'data.missing_values': { page: 'data', section: 'fix-cleaning-missing' },
    'data.cleaning_suggestions': { page: 'data', section: 'fix-cleaning-missing' },
    'data.category_standardization': { page: 'data', section: 'data-section-category_standardization' },
    'data.outliers': { page: 'data', section: 'fix-cleaning-outliers' },
    'data.duplicates': { page: 'data', section: 'fix-cleaning-duplicates' },
    'data.manual_transforms': { page: 'data', section: 'data-section-manual_transforms' },
    'models.target_handling': { page: 'models', section: 'models-setup-target' },
    'models.validation_split': { page: 'models', section: 'models-setup-validation' },
    'models.class_weight': { page: 'models', section: 'models-setup-validation' },
    'models.algorithms': { page: 'models', section: 'models-setup-algorithms' },
    'models.tuning': { page: 'models', section: 'models-tuning' },
    'models.scaling': { page: 'models', section: 'fix-numeric-preprocessing' },
    'models.numeric_preprocessing': { page: 'models', section: 'fix-numeric-preprocessing' },
    'models.outlier_treatment': { page: 'models', section: 'fix-outlier-treatment' },
    'models.features': { page: 'models', section: 'models-setup-features' },
    'tests.correlation': { page: 'tests', section: 'fix-correlation-test' },
    'expand.recommendation': { page: 'expand', section: 'expand-section-controls' },
  }
  return map[route]
}

// Resolves a backend-provided fix payload into a page and section navigation target.
function fixTargetFromBackendFix(fix) {
  if (!fix) return null
  if (String(fix.route || '').includes('.')) {
    return routeToFixTarget(fix.route)
  }
  const page = fix.route
  const sectionMap = {
    manual_transforms: { page: 'data', section: 'data-section-manual_transforms' },
    cleaning_suggestions: { page: 'data', section: 'fix-cleaning-missing' },
    missing_values: { page: 'data', section: 'fix-cleaning-missing' },
    outliers: { page: 'data', section: 'fix-cleaning-outliers' },
    duplicates: { page: 'data', section: 'fix-cleaning-duplicates' },
    category_standardization: { page: 'data', section: 'data-section-category_standardization' },
    target_options: { page: 'models', section: 'models-setup-target' },
    target_handling: { page: 'models', section: 'models-setup-target' },
    features: { page: 'models', section: 'models-setup-features' },
    feature_selection: { page: 'models', section: 'models-setup-features' },
    numeric_preprocessing: { page: 'models', section: 'fix-numeric-preprocessing' },
    scaling: { page: 'models', section: 'fix-numeric-preprocessing' },
    validation_split: { page: 'models', section: 'models-setup-validation' },
    class_weight: { page: 'models', section: 'models-setup-validation' },
    algorithms: { page: 'models', section: 'models-setup-algorithms' },
    tuning: { page: 'models', section: 'models-tuning' },
    correlation: { page: 'tests', section: 'fix-correlation-test' },
  }
  const mapped = sectionMap[fix.section]
  if (mapped) return mapped
  if (page === 'models') return { page: 'models', section: 'models-setup-target' }
  if (page === 'data') return { page: 'data', section: 'fix-cleaning-missing' }
  if (page === 'tests') return { page: 'tests', section: 'fix-correlation-test' }
  return null
}

// Returns a friendly label like "Models page" describing where a fix route would navigate.
function routeLabel(route) {
  const target = routeToFixTarget(route)
  if (!target) return route || 'Open'
  const page = target.page === 'whatif' ? 'What-if' : target.page.charAt(0).toUpperCase() + target.page.slice(1)
  return `${page} page`
}

// Scrolls to a section by id and briefly applies a highlight class for emphasis.
function highlightSection(section) {
  const el = document.getElementById(section)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ax-fix-highlight')
  window.setTimeout(() => el.classList.remove('ax-fix-highlight'), 2600)
}

