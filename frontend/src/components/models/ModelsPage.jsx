/* ============================================================
 * PAGE: ML MODELS (TRAIN, COMPARE)
 * Keywords: models, train, machine learning, regression, classification, linear, logistic, tree, random forest, feature importance
 * ============================================================ */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar } from 'react-chartjs-2'
import { ChevronDown, Check, RotateCcw, History, ArrowUpRight, AlertTriangle } from 'lucide-react'
import { api } from '../../api'
import { AIInsightCard, ExplainButton } from '../ai/AIExplainers'
import { useDialog } from '../common/DialogProvider'
import { useAuth } from '../providers/AuthProvider'
import { BusyOverlay, InlineSpinner, SkeletonCards } from '../common/LoadingStates'
import HelpButton from '../common/HelpButton'
import PageGuide from '../common/PageGuide'

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
export default function ModelsPage({ dataset, setActiveModel, onGo }) {
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
  const [classWeight, setClassWeight] = useState(false)
  const [numericPreprocessing, setNumericPreprocessing] = useState({
    scaling: 'auto',
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
  const [models, setModels] = useState([])
  const [draftReady, setDraftReady] = useState(false)
  const [dismissedChecks, setDismissedChecks] = useState([])
  const [isIssueBarExpanded, setIsIssueBarExpanded] = useState(false)

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
    api.listModels(dataset.id).then(setModels).catch(console.error)
  }, [dataset?.id])

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
      setClassWeight(saved.classWeight ?? false)
      setFeatures(saved.features || [])
      setChosenAlgos(saved.chosenAlgos || ['logistic', 'rf'])
      setModelParams(saved.modelParams || defaultModelParams())
      setNumericPreprocessing(saved.numericPreprocessing || { scaling: 'auto', log_columns: [], integer_columns: [] })
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
      classWeight,
      features,
      chosenAlgos,
      modelParams,
      numericPreprocessing,
      results,
      activeResultIdx,
    }))
  }, [dataset?.id, draftReady, target, targetMode, positiveClass, testSize, validationMethod, cvFolds, stratify, classWeight, features.join(','), chosenAlgos.join(','), JSON.stringify(modelParams), JSON.stringify(numericPreprocessing), JSON.stringify(results), activeResultIdx])

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
    setTimeout(() => highlightSection(fixTarget.section), 180)
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
          target_options: targetOptions(targetMode, positiveClass, testSize, validationMethod, cvFolds, stratify, classWeight, numericPreprocessing),
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
  }, [dataset?.id, dataset?.current_stage_id, target, features.join(','), chosenAlgos.join(','), targetMode, positiveClass, testSize, validationMethod, cvFolds, stratify, classWeight, JSON.stringify(numericPreprocessing)])

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
        target_options: targetOptions(targetMode, positiveClass, testSize, validationMethod, cvFolds, stratify, classWeight, numericPreprocessing),
        model_params: modelParams,
      })
      if (r.session) auth.updateSession(r.session)
      setResults(r)
      setActiveResultIdx(0)
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
    window.sessionStorage.setItem('simucast.fixTarget', JSON.stringify({ page, section, ts: Date.now() }))
    if (page === 'models') {
      setTimeout(() => highlightSection(section), 80)
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
      navigateToFix('data', 'fix-cleaning-suggestions')
    } else if (label.includes('categor')) {
      navigateToFix('data', 'fix-category-standardization')
    } else if (label.includes('class balance')) {
      navigateToFix('models', 'fix-target-handling')
    } else if (label.includes('multicollinearity')) {
      navigateToFix('tests', 'fix-correlation-test')
    } else if (label.includes('split') || detail.includes('split')) {
      navigateToFix('models', 'fix-model-split')
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
    setClassWeight(metrics.class_weight === 'balanced')
    setNumericPreprocessing(model.preprocessing_pipeline?.numeric_preprocessing || { scaling: 'auto', log_columns: [], integer_columns: [] })
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

  return (
    <div className={`ax-busy-host ax-operation-busy ${training ? 'is-busy' : ''}`} style={{ paddingBottom: 60 }}>
      <BusyOverlay
        active={training}
        title={`Training ${selectedAlgos.length} model${selectedAlgos.length === 1 ? '' : 's'}...`}
        detail="Applying preprocessing, splitting the data, fitting models, and calculating evaluation metrics."
        steps={['Preparing model inputs', 'Training selected algorithms', 'Saving results for What-if and reports']}
      />

      {/* Title block with Reset and History toggles */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--color-accent)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {plan?.task ? `MODELS · ${plan.task.toUpperCase()}` : 'MODELS'}
          </span>
          <h1 className="ax-page-title" style={{ margin: '4px 0 0', fontSize: '26px', fontWeight: 800 }}>Build a model</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="ax-btn mini"
            onClick={() => {
              setTarget('')
              setTargetMode('auto')
              setPositiveClass('')
              setFeatures([])
              setChosenAlgos(['logistic', 'rf'])
              setResults(null)
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 4, height: 32 }}
            type="button"
          >
            <RotateCcw size={13} /> Reset
          </button>
          {models.length > 0 && (
            <button
              className="ax-btn mini"
              onClick={() => setShowHistory(!showHistory)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                height: 32,
                background: showHistory ? 'var(--color-accent-light)' : 'var(--color-background-primary)',
                borderColor: showHistory ? 'var(--color-accent)' : 'var(--color-border-secondary)',
                color: showHistory ? 'var(--color-accent-dark)' : 'var(--color-text-primary)'
              }}
              type="button"
            >
              <History size={13} /> History · {models.length}
            </button>
          )}
        </div>
      </div>

      <PageGuide
        title="Modeling works best after a clean question"
        meta="Models"
        steps={['Pick target', 'Choose features', 'Set validation', 'Train and check health']}
      >
        SimuCast helps choose sensible targets and features, then compares train and test performance so overfitting is visible.
      </PageGuide>

      {/* Previous Models Table */}
      {showHistory && models.length > 0 && (
        <PreviousModelsTable
          models={models}
          restoreModelSettings={restoreModelSettings}
          prepareAndUseInWhatIf={prepareAndUseInWhatIf}
          deleteSavedModel={deleteSavedModel}
          setShowHistory={setShowHistory}
        />
      )}



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
        <div id="models-step-1" style={{ display: 'flex', alignItems: 'stretch' }}>
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
        <div id="fix-feature-selection" style={{ display: 'flex', alignItems: 'stretch' }}>
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
        <div id="models-step-4" style={{ display: 'flex', alignItems: 'stretch' }}>
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
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                      <input type="checkbox" checked={stratify} onChange={(e) => setStratify(e.target.checked)} />
                      Keep class proportions
                    </label>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                      <input type="checkbox" checked={classWeight} onChange={(e) => setClassWeight(e.target.checked)} />
                      Balanced class weights
                    </label>
                  </div>
                )}
              </div>
            )}
          </ConfigDropdown>
        </div>

        {/* ALGORITHMS Dropdown */}
        <div id="models-step-5" style={{ display: 'flex', alignItems: 'stretch' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', minWidth: '180px', flex: 1 }}>
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

      {/* Results panel container */}
      {results && (
        <>
          <ResultsPanel
            results={results}
            activeIdx={activeResultIdx}
            setActiveIdx={setActiveResultIdx}
            onUseInWhatIf={useInWhatIf}
            datasetId={dataset.id}
            onFixAction={handleFixAction}
          />
          {(results.models || []).length > 0 && (
            <div id="models-tuning" className="ax-card ax-module-card ax-card-model" style={{ padding: 18, marginTop: 16 }}>
              {/* Header */}
              <div className="ax-tune-head">
                <div className="ax-tune-head-left">
                  <h3>
                    Tune parameters
                    <HelpButton
                      title="Tune parameters"
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
          )}
        </>
      )}
    </div>
  )
}

// Dropdown menu that houses config selectors for the model build page.
// Standalone Previous Models history table with filter pills, BEST AUC badge, health badges, and icon actions.
function PreviousModelsTable({ models, restoreModelSettings, prepareAndUseInWhatIf, deleteSavedModel, setShowHistory }) {
  const [filterTarget, setFilterTarget] = useState('all')
  const [checkedIds, setCheckedIds] = useState(new Set())

  const targets = [...new Set(models.map((m) => m.target).filter(Boolean))]
  const filtered = filterTarget === 'all' ? models : models.filter((m) => m.target === filterTarget)

  // Find best AUC model id
  let bestAucId = null, bestAucVal = -Infinity
  models.forEach((m) => {
    const v = m.metrics?.auc ?? -Infinity
    if (v > bestAucVal) { bestAucVal = v; bestAucId = m.id }
  })

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
    const rows = [['Algorithm', 'Target', 'Accuracy', 'AUC', 'F1', 'Settings', 'Trained']]
    models.forEach((m) => {
      rows.push([
        algoLabelForTask(m.algorithm, m.metrics?.task),
        m.target,
        m.metrics?.accuracy != null ? (m.metrics.accuracy * 100).toFixed(1) + '%' : '',
        m.metrics?.auc != null ? Number(m.metrics.auc).toFixed(3) : '',
        m.metrics?.f1 != null ? Number(m.metrics.f1).toFixed(3) : '',
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 12px' }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 2px', color: 'var(--color-text-primary)' }}>Previous models</h2>
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>
            {models.length} run{models.length !== 1 ? 's' : ''} · sorted by AUC
          </p>
        </div>
        <button
          className="ax-btn mini"
          type="button"
          onClick={exportCSV}
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
              onClick={() => setFilterTarget(t)}
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
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                ALGORITHM · TARGET
              </th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                ACCURACY ↕
              </th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-accent)', whiteSpace: 'nowrap' }}>
                AUC ↓
              </th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                F1 ↕
              </th>
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
              const isBestAuc = m.id === bestAucId && m.metrics?.auc != null
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
                      onChange={() => toggleCheck(m.id)}
                      style={{ accentColor: 'var(--color-accent)', width: 14, height: 14, cursor: 'pointer' }}
                    />
                  </td>
                  <td style={{ padding: '14px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>
                        {algoLabelForTask(m.algorithm, m.metrics?.task)}
                      </span>
                      {isBestAuc && (
                        <span style={{
                          fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
                          background: 'var(--color-accent)', color: '#fff', padding: '2px 7px', borderRadius: 999,
                        }}>BEST AUC</span>
                      )}
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
                  <td style={{ padding: '14px 12px', textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>
                    {m.metrics?.accuracy != null ? (m.metrics.accuracy * 100).toFixed(1) + '%' : (m.metrics?.r2 != null ? `R²\u00a0${Number(m.metrics.r2).toFixed(3)}` : '—')}
                  </td>
                  <td style={{ padding: '14px 12px', textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>
                    {m.metrics?.auc != null ? Number(m.metrics.auc).toFixed(3) : '—'}
                  </td>
                  <td style={{ padding: '14px 12px', textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>
                    {m.metrics?.f1 != null ? Number(m.metrics.f1).toFixed(3) : '—'}
                  </td>
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
                        onClick={() => { restoreModelSettings(m) }}
                        style={{ width: 30, height: 30, borderRadius: 8, border: '1.5px solid var(--color-border-secondary)', background: 'var(--color-background-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: 14 }}
                      >↺</button>
                      <button title="Use in What-if" type="button"
                        onClick={() => prepareAndUseInWhatIf(m)}
                        style={{ width: 30, height: 30, borderRadius: 8, border: '1.5px solid var(--color-border-secondary)', background: 'var(--color-background-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: 14 }}
                      >→</button>
                      <button title="Delete" type="button"
                        onClick={() => deleteSavedModel(m)}
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
            zIndex: 1000,
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

function ParameterSettings({ selectedAlgos, modelParams, setModelParams, results }) {
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
      <div key={merged.key} className="ax-tune-param">
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
              <span>{tabKey === 'all' ? 'All Parameters' : algoLabel(tabKey)}</span>
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
      value: `${plan.encoding.length} categorical column${plan.encoding.length !== 1 ? 's' : ''} one-hot encoded`,
    },
    plan.scaling.length > 0 && { label: 'Scaling', value: 'StandardScaler on numeric features' },
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
function ResultsPanel({ results, activeIdx, setActiveIdx, onUseInWhatIf, datasetId, onFixAction }) {
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

  const influenceList = useMemo(() => {
    return normalizeInfluence(active.feature_influence || active.feature_importance)
  }, [active])

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

    // Best AUC / RMSE
    let bestAucModel = models[0]
    let bestAucVal = isClassification ? -Infinity : Infinity
    for (const m of models) {
      if (isClassification) {
        const val = m.metrics?.auc ?? 0
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
        modelName: algoLabelForTask(bestAccModel.algorithm, bestAccModel.metrics?.task)
      },
      bestAuc: {
        label: isClassification ? 'BEST ON AUC' : 'SMALLEST RMSE',
        value: isClassification ? (bestAucModel.metrics?.auc == null ? 'n/a' : num(bestAucModel.metrics?.auc)) : num(bestAucModel.metrics?.rmse),
        modelName: algoLabelForTask(bestAucModel.algorithm, bestAucModel.metrics?.task)
      },
      smallestGap: {
        label: 'SMALLEST TRAIN-TEST GAP',
        value: isClassification ? pct(smallestGapModel.metrics?.generalization_gap) : num(smallestGapModel.metrics?.generalization_gap),
        modelName: algoLabelForTask(smallestGapModel.algorithm, smallestGapModel.metrics?.task)
      },
      watchOut: {
        label: 'WATCH OUT',
        value: worstModel.metrics?.generalization_gap >= 0.15 ? 'Severe risk' : worstModel.metrics?.generalization_gap >= 0.08 ? 'Moderate risk' : 'Healthy',
        modelName: algoLabelForTask(worstModel.algorithm, worstModel.metrics?.task),
        isRisk: worstModel.metrics?.generalization_gap >= 0.08
      }
    }
  }, [models])

  return (
    <>
      {/* Leaderboard Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        {/* Card 1: Best Accuracy */}
        <div
          style={{
            padding: '16px',
            background: 'var(--color-background-primary)',
            border: '1.5px solid var(--color-accent)',
            borderRadius: '12px',
            boxShadow: 'var(--shadow-card)'
          }}
        >
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {leaderboard.bestAccuracy.label}
          </span>
          <p style={{ fontSize: '28px', fontWeight: 800, margin: '8px 0 4px', color: 'var(--color-accent)' }}>
            {leaderboard.bestAccuracy.value}
          </p>
          <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            {leaderboard.bestAccuracy.modelName}
          </span>
        </div>

        {/* Card 2: Best AUC / RMSE */}
        <div
          style={{
            padding: '16px',
            background: 'var(--color-background-primary)',
            border: '1.5px solid var(--color-border-tertiary)',
            borderRadius: '12px',
            boxShadow: 'var(--shadow-card)'
          }}
        >
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {leaderboard.bestAuc.label}
          </span>
          <p style={{ fontSize: '28px', fontWeight: 800, margin: '8px 0 4px', color: 'var(--color-text-primary)' }}>
            {leaderboard.bestAuc.value}
          </p>
          <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            {leaderboard.bestAuc.modelName}
          </span>
        </div>

        {/* Card 3: Smallest Gap */}
        <div
          style={{
            padding: '16px',
            background: 'var(--color-background-primary)',
            border: '1.5px solid var(--color-border-tertiary)',
            borderRadius: '12px',
            boxShadow: 'var(--shadow-card)'
          }}
        >
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {leaderboard.smallestGap.label}
          </span>
          <p style={{ fontSize: '28px', fontWeight: 800, margin: '8px 0 4px', color: 'var(--color-text-primary)' }}>
            {leaderboard.smallestGap.value}
          </p>
          <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            {leaderboard.smallestGap.modelName}
          </span>
        </div>

        {/* Card 4: Watch Out */}
        <div
          style={{
            padding: '16px',
            background: leaderboard.watchOut.isRisk ? '#FEF2F2' : 'var(--color-background-primary)',
            border: `1.5px solid ${leaderboard.watchOut.isRisk ? '#FEE2E2' : 'var(--color-border-tertiary)'}`,
            borderRadius: '12px',
            boxShadow: 'var(--shadow-card)'
          }}
        >
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

      {/* Comparison table block */}
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

      <ComparisonTable models={models} activeIdx={activeIdx} onPick={setActiveIdx} />

      {skipped?.length > 0 && (
        <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '6px 0 12px' }}>
          Skipped: {skipped.map((s) => `${s.algorithm} (${s.reason})`).join(' · ')}
        </p>
      )}

      {/* Model Health and Feature Influence Split Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20, marginTop: 20 }}>
        {/* Left Card: Model Health */}
        <div className="ax-card" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
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
            <div style={{ background: 'var(--color-background-tertiary)', border: '1px solid var(--color-border-tertiary)', borderRadius: 8, padding: '12px 14px' }}>
              <span style={{ fontSize: '9px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                TRAIN
              </span>
              <p style={{ fontSize: '24px', fontWeight: 800, margin: '4px 0 0', color: 'var(--color-text-primary)' }}>
                {isClassification ? pct(active.metrics?.train_accuracy) : num(active.metrics?.train_r2)}
              </p>
            </div>

            {/* Metric 2: Test */}
            <div style={{ background: 'var(--color-background-tertiary)', border: '1px solid var(--color-border-tertiary)', borderRadius: 8, padding: '12px 14px' }}>
              <span style={{ fontSize: '9px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                TEST
              </span>
              <p style={{ fontSize: '24px', fontWeight: 800, margin: '4px 0 0', color: 'var(--color-text-primary)' }}>
                {isClassification ? pct(active.metrics?.accuracy) : num(active.metrics?.r2)}
              </p>
            </div>

            {/* Metric 3: Gap */}
            <div style={{ background: 'var(--color-background-tertiary)', border: '1px solid var(--color-border-tertiary)', borderRadius: 8, padding: '12px 14px' }}>
              <span style={{ fontSize: '9px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                GAP
              </span>
              <p style={{ fontSize: '24px', fontWeight: 800, margin: '4px 0 0', color: Math.abs(active.metrics?.generalization_gap) >= 0.08 ? 'var(--color-text-warning)' : 'var(--color-text-primary)' }}>
                {isClassification ? pct(Math.abs(active.metrics?.generalization_gap)) : num(Math.abs(active.metrics?.generalization_gap))}
              </p>
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
        </div>

        {/* Right Card: Feature Influence */}
        <div className="ax-card" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                FEATURE INFLUENCE
              </span>
              <h3 style={{ fontSize: '18px', fontWeight: 800, margin: '4px 0 0', color: 'var(--color-text-primary)' }}>
                {algoLabelForTask(active.algorithm, active.metrics?.task)}
              </h3>
            </div>
            <button
              className="ax-btn mini prim"
              onClick={async () => {
                if (active.has_whatif) {
                  onUseInWhatIf(active)
                  return
                }
                try {
                  await api.prepareModelForWhatIf(active.id)
                  onUseInWhatIf({ ...active, has_whatif: true })
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

          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 16px', flex: '0 0 auto' }}>
            Direction is shown when available: increases raise the prediction/probability, decreases lower it.
          </p>

          {/* Features directional bar list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, justifyContent: 'center' }}>
            {influenceList.length > 0 ? (
              influenceList.map((item) => {
                const isPositive = item.direction === 'positive'
                const isNegative = item.direction === 'negative'
                const strengthPercent = Math.round((item.relative_strength ?? item.strength ?? 0) * 100)
                
                // Bar colors matching screenshot: raises gets orange, lowers gets dark slate/grey, default gets light grey/accent
                const barColor = isPositive ? 'var(--color-accent)' : isNegative ? '#334155' : 'var(--color-border-primary)'
                
                return (
                  <div key={item.feature} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
                    <strong style={{ width: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-primary)' }}>
                      {item.feature}
                    </strong>
                    <div style={{ flex: 1, height: '8px', background: 'var(--color-background-secondary)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ width: `${strengthPercent}%`, height: '100%', background: barColor, borderRadius: '4px' }} />
                    </div>
                    <span style={{ width: '38px', textAlign: 'right', fontWeight: 650, color: 'var(--color-text-primary)' }}>
                      {strengthPercent}%
                    </span>
                    <span
                      style={{
                        width: '78px',
                        textAlign: 'left',
                        fontWeight: 700,
                        color: isPositive ? 'var(--color-text-success)' : isNegative ? 'var(--color-text-danger)' : 'var(--color-text-secondary)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 2
                      }}
                    >
                      {isPositive ? '↑ raises' : isNegative ? '↓ lowers' : 'Model-derived'}
                    </span>
                  </div>
                )
              })
            ) : (
              <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '20px 0', textAlign: 'center' }}>
                No feature influence values calculated for this model.
              </p>
            )}
          </div>
        </div>
      </div>

      {active.metrics?.confusion_matrix && (
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
function ComparisonTable({ models, activeIdx, onPick }) {
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
                <th>AUC</th>
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
                onClick={() => onPick(i)}
                style={{
                  cursor: 'pointer',
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
                    <td>{mt.auc == null ? 'n/a' : num(mt.auc)}</td>
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
    if (m.auc != null) parts.push(`AUC ${num(m.auc)}`)
    return parts.join(' · ')
  }
  return `R² ${num(m.r2)} · RMSE ${num(m.rmse)}`
}

// Normalizes a feature-influence value into an array of entries with relative strength scaled to one.
function normalizeInfluence(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  const entries = Object.entries(value)
  const max = Math.max(...entries.map(([, v]) => Number(v) || 0), 1)
  return entries.map(([feature, strength]) => ({
    feature,
    strength: Number(strength) || 0,
    relative_strength: (Number(strength) || 0) / max,
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
function targetOptions(mode, positiveClass, testSize, validationMethod, cvFolds, stratify, classWeight, numericPreprocessing) {
  const options = {}
  if (mode && mode !== 'auto') options.mode = mode
  if (positiveClass) options.positive_class = positiveClass
  options.test_size = testSize
  options.validation_method = validationMethod || 'standard_split'
  if (options.validation_method === 'cross_validation') options.cv_folds = cvFolds || 5
  options.stratify = stratify
  if (classWeight) options.class_weight = 'balanced'
  options.numeric_preprocessing = numericPreprocessing || { scaling: 'auto', log_columns: [], integer_columns: [] }
  return options
}

// Maps a fix-action route key to the destination page and section id used for navigation.
function routeToFixTarget(route) {
  const map = {
    'data.missing_values': { page: 'data', section: 'fix-cleaning-suggestions' },
    'data.cleaning_suggestions': { page: 'data', section: 'fix-cleaning-suggestions' },
    'data.category_standardization': { page: 'data', section: 'data-section-category_standardization' },
    'data.outliers': { page: 'data', section: 'fix-cleaning-suggestions' },
    'data.duplicates': { page: 'data', section: 'fix-cleaning-suggestions' },
    'data.manual_transforms': { page: 'data', section: 'data-section-manual_transforms' },
    'models.target_handling': { page: 'models', section: 'models-step-1' },
    'models.validation_split': { page: 'models', section: 'models-step-4' },
    'models.class_weight': { page: 'models', section: 'models-step-4' },
    'models.algorithms': { page: 'models', section: 'models-step-5' },
    'models.tuning': { page: 'models', section: 'models-tuning' },
    'models.scaling': { page: 'models', section: 'fix-numeric-preprocessing' },
    'models.numeric_preprocessing': { page: 'models', section: 'fix-numeric-preprocessing' },
    'models.features': { page: 'models', section: 'fix-feature-selection' },
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
    cleaning_suggestions: { page: 'data', section: 'fix-cleaning-suggestions' },
    missing_values: { page: 'data', section: 'fix-cleaning-suggestions' },
    outliers: { page: 'data', section: 'fix-cleaning-suggestions' },
    duplicates: { page: 'data', section: 'fix-cleaning-suggestions' },
    category_standardization: { page: 'data', section: 'data-section-category_standardization' },
    target_options: { page: 'models', section: 'models-step-1' },
    target_handling: { page: 'models', section: 'models-step-1' },
    features: { page: 'models', section: 'fix-feature-selection' },
    feature_selection: { page: 'models', section: 'fix-feature-selection' },
    numeric_preprocessing: { page: 'models', section: 'fix-numeric-preprocessing' },
    scaling: { page: 'models', section: 'fix-numeric-preprocessing' },
    validation_split: { page: 'models', section: 'models-step-4' },
    class_weight: { page: 'models', section: 'models-step-4' },
    algorithms: { page: 'models', section: 'models-step-5' },
    tuning: { page: 'models', section: 'models-tuning' },
    correlation: { page: 'tests', section: 'fix-correlation-test' },
  }
  const mapped = sectionMap[fix.section]
  if (mapped) return mapped
  if (page === 'models') return { page: 'models', section: 'models-step-1' }
  if (page === 'data') return { page: 'data', section: 'fix-cleaning-suggestions' }
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

