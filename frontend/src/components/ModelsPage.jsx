import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar } from 'react-chartjs-2'
import { api } from '../api'
import { AIInsightCard, ExplainButton } from './AIExplainers'
import { useDialog } from './DialogProvider'
import { useAuth } from './AuthProvider'
import { BusyOverlay, InlineSpinner, SkeletonCards } from './LoadingStates'
import HelpButton from './HelpButton'

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
  ],
  rf: [
    { key: 'n_estimators', label: 'Trees', type: 'number', min: 10, max: 500, step: 10, defaultValue: 100 },
    { key: 'max_depth', label: 'Max depth', type: 'numberOrBlank', min: 1, max: 50, step: 1, defaultValue: '' },
    { key: 'min_samples_leaf', label: 'Min samples per leaf', type: 'number', min: 1, max: 50, step: 1, defaultValue: 1 },
  ],
  tree: [
    { key: 'max_depth', label: 'Max depth', type: 'numberOrBlank', min: 1, max: 50, step: 1, defaultValue: '' },
    { key: 'min_samples_leaf', label: 'Min samples per leaf', type: 'number', min: 1, max: 50, step: 1, defaultValue: 1 },
  ],
  linear: [
    { key: 'fit_intercept', label: 'Fit intercept', type: 'checkbox', defaultValue: true },
  ],
}

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

  const handleFixAction = (fix) => {
    if (!fix?.route) return
    const target = fixTargetFromBackendFix(fix)
    if (!target) return
    if (target.page === 'models') {
      const sectionId = target.section
      const el = document.getElementById(sectionId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
    }))
  }, [dataset?.id, draftReady, target, targetMode, positiveClass, testSize, validationMethod, cvFolds, stratify, classWeight, features.join(','), chosenAlgos.join(','), JSON.stringify(modelParams), JSON.stringify(numericPreprocessing)])

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
    setResults(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className={`ax-busy-host ax-operation-busy ${training ? 'is-busy' : ''}`}>
      <BusyOverlay
        active={training}
        title={`Training ${selectedAlgos.length} model${selectedAlgos.length === 1 ? '' : 's'}...`}
        detail="Applying preprocessing, splitting the data, fitting models, and calculating evaluation metrics."
        steps={['Preparing model inputs', 'Training selected algorithms', 'Saving results for What-if and reports']}
      />
      <h1 className="ax-page-title">Build a model</h1>
      <p className="ax-page-sub">
        Pick a target, select features, choose algorithms, and train them all in one click.
      </p>

      {/* Step 1 — target */}
      <Step n={1} id="models-step-1" title="Pick a target — what to predict">
        <select
          id="fix-target-handling"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value)
            setTargetMode('auto')
            setPositiveClass('')
            setFeatures(features.filter((f) => f !== e.target.value))
            setResults(null)
          }}
          style={{ width: '100%', maxWidth: 320 }}
        >
          <option value="">— select —</option>
          {variables.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name} ({v.dtype})
            </option>
          ))}
        </select>
        {targetRecommendations.length > 0 && (
          <RecommendationPanel title="Recommended targets" source="System recommended">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {targetRecommendations.map((rec) => (
                <button
                  key={rec.name}
                  className="ax-btn mini"
                  type="button"
                  onClick={() => {
                    setTarget(rec.name)
                    setTargetMode('auto')
                    setPositiveClass('')
                    setFeatures(features.filter((f) => f !== rec.name))
                  }}
                  title={rec.why}
                >
                  {rec.name}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '6px 0 0' }}>
              Recommended targets are columns that look like outcomes, scores, statuses, or meaningful prediction goals.
            </p>
          </RecommendationPanel>
        )}
        {plan && (
          <>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>
              Detected task: <strong>{plan.task}</strong>
              {plan.class_balance && ` - classes: ${Object.entries(plan.class_balance).map(([k, v]) => `${k} (${v})`).join(', ')}`}
            </p>
            {plan.task === 'classification' && (
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 10px', alignItems: 'center', fontSize: 12 }}>
                <label style={{ color: 'var(--color-text-secondary)' }}>Target handling</label>
                <select value={targetMode} onChange={(e) => setTargetMode(e.target.value)}>
                  <option value="auto">Automatic</option>
                  <option value="multiclass">Keep categories</option>
                  <option value="binary">Binary: selected vs others</option>
                </select>
                {(targetMode === 'binary' || plan.target_mode === 'binary') && (
                  <>
                    <label style={{ color: 'var(--color-text-secondary)' }}>Positive class</label>
                    <select value={positiveClass || plan.positive_class || ''} onChange={(e) => setPositiveClass(e.target.value)}>
                      {(plan.target_classes || []).map((cls) => (
                        <option key={cls} value={cls}>{cls}</option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </Step>

      {/* Step 2 — features */}
      <div id="fix-feature-selection">
      <Step n={2} title="Select features" disabled={!target}>
        <div className="ax-row" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
            {features.length} of {allFeatureNames.length} selected
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="ax-btn" onClick={selectAll} type="button" disabled={!target}>Select all</button>
            <button className="ax-btn" onClick={selectNone} type="button" disabled={!target || features.length === 0}>
              Clear
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {candidateFeatures.map((v) => (
            <span
              key={v.name}
              className={`ax-chip ${features.includes(v.name) ? 'active' : ''}`}
              onClick={() => toggleFeature(v.name)}
              style={{ cursor: 'pointer' }}
            >
              {v.name} <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 4 }}>{v.dtype}</span>
            </span>
          ))}
        </div>
        {featureRecommendations.length > 0 && (
          <RecommendationPanel title="Recommended features" source="System recommended">
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 6px' }}>
              Excludes likely IDs and the selected target. Watch for leakage: avoid columns that directly reveal the answer.
            </p>
            <button
              className="ax-btn mini"
              type="button"
              onClick={() => setFeatures(featureRecommendations.map((v) => v.name))}
              disabled={!target}
            >
              Use recommended features
            </button>
          </RecommendationPanel>
        )}
      </Step>
      </div>

      {/* Step 3 — preprocessing plan */}
      <Step n={3} id="models-step-3" title="Preprocessing plan &amp; readiness" disabled={!target || features.length === 0}>
        <div id="fix-numeric-preprocessing" className="ax-card" style={{ padding: 12, marginBottom: 12, background: 'var(--color-background-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <p style={{ fontSize: 13, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              Encoding and scaling choices
              <HelpButton
                title="Encoding and scaling choices"
                text="This card controls model preprocessing. Categorical features are encoded for model input; numeric scaling is recommended for linear/logistic models and optional for tree-based models."
              />
            </p>
            <span className="ax-chip" style={{ color: 'var(--color-primary)' }}>System recommended</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 10px' }}>
            Categorical features are encoded for modeling. Scaling helps linear/logistic models compare numeric features fairly; tree models are less sensitive.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr)', gap: 10, alignItems: 'center', fontSize: 12 }}>
            <label style={{ color: 'var(--color-text-secondary)' }}>Encoding</label>
            <select disabled value="one_hot" style={{ width: '100%' }}>
              <option value="one_hot">One-hot encoding for categorical features</option>
            </select>
            <label style={{ color: 'var(--color-text-secondary)' }}>Scaling</label>
            <select
              value={numericPreprocessing.scaling || 'auto'}
              onChange={(e) => setNumericPreprocessing((cur) => ({ ...cur, scaling: e.target.value }))}
              style={{ width: '100%' }}
            >
              <option value="auto">Auto recommended</option>
              <option value="standard">Standard scaling</option>
              <option value="minmax">Min-max scaling</option>
              <option value="none">No scaling</option>
            </select>
          </div>
        </div>
        {planLoading && (
          plan ? (
            <InlineSpinner label="Refreshing readiness checks..." />
          ) : (
            <SkeletonCards count={2} />
          )
        )}
        {planError && (
          <p style={{ fontSize: 12, color: 'var(--color-text-danger)', margin: 0 }}>{planError}</p>
        )}
        {plan && (
          <PreprocessingPlan
            plan={plan}
            onFixAction={handleFixAction}
            dismissedChecks={dismissedChecks}
            onDismissCheck={(key) => setDismissedChecks((d) => [...d, key])}
          />
        )}
      </Step>

      {/* Step 4 — algorithms */}
      <Step n={4} id="models-step-4" title="Configure validation split" disabled={!plan}>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '10px 12px', alignItems: 'center', fontSize: 12 }}>
          <label style={{ color: 'var(--color-text-secondary)' }}>Validation method</label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="radio"
                name="validation-method"
                value="standard_split"
                checked={validationMethod === 'standard_split'}
                onChange={() => setValidationMethod('standard_split')}
              />
              Standard train/test split
              <span className="ax-chip" style={{ fontSize: 10 }}>Faster</span>
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="radio"
                name="validation-method"
                value="cross_validation"
                checked={validationMethod === 'cross_validation'}
                onChange={() => setValidationMethod('cross_validation')}
              />
              {cvFolds}-fold cross-validation
              <HelpButton
                title="Cross-validation"
                text="The dataset is divided into several parts. The model trains multiple times using different combinations of training and testing data. This helps detect unstable or overfit results."
              />
              <span className="ax-chip" style={{ fontSize: 10 }}>Recommended for small datasets</span>
              <span className="ax-chip" style={{ fontSize: 10 }}>More stable evaluation</span>
            </label>
          </div>
          {validationMethod === 'standard_split' ? (
            <>
              <span />
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
                The model trains once using one train/test split. Adjust the holdout size to choose how much data is reserved for testing.
              </p>
              <label style={{ color: 'var(--color-text-secondary)' }}>Test set</label>
              <div>
                <input
                  type="range"
                  min="0.05"
                  max="0.5"
                  step="0.05"
                  value={testSize}
                  onChange={(e) => setTestSize(Number(e.target.value))}
                  style={{ width: 'min(280px, 100%)' }}
                />
                <span style={{ marginLeft: 10, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  Train {Math.round((1 - testSize) * 100)}% / Test {Math.round(testSize * 100)}%
                </span>
              </div>
            </>
          ) : (
            <>
              <label style={{ color: 'var(--color-text-secondary)' }}>Folds</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <select value={cvFolds} onChange={(e) => setCvFolds(Number(e.target.value))} style={{ width: 170 }}>
                  <option value={3}>3 folds</option>
                  <option value={5}>5 folds (recommended)</option>
                  <option value={10}>10 folds</option>
                </select>
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  5 folds works well for most datasets; 10 folds can give steadier estimates on smaller datasets.
                </span>
              </div>
              <span />
              <div className="ax-card" style={{ padding: '10px 12px', background: 'var(--color-background-info-soft)', borderColor: 'var(--color-border-info)' }}>
                <p style={{ fontSize: 12, fontWeight: 500, margin: 0 }}>Cross-validation rotates training and testing across {cvFolds} folds.</p>
                <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
                  Cross-validation automatically rotates training and testing across {cvFolds} folds to produce more stable evaluation results.
                </p>
              </div>
            </>
          )}
          {plan?.task === 'classification' && (
            <>
              <label style={{ color: 'var(--color-text-secondary)' }}>Classification split</label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={stratify} onChange={(e) => setStratify(e.target.checked)} />
                Keep class proportions in train and test sets
              </label>
              <label style={{ color: 'var(--color-text-secondary)' }}>Imbalance handling</label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={classWeight} onChange={(e) => setClassWeight(e.target.checked)} />
                Use balanced class weights where supported
              </label>
            </>
          )}
        </div>
      </Step>

      <Step n={5} id="models-step-5" title="Choose algorithms" disabled={!plan || (plan.validation_checks || []).some((c) => c.status === 'block')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <RecommendationPanel title="Algorithm guidance" source="System recommended">
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
              Use a simple interpretable baseline first, then compare with tree-based models. Random Forest can perform well but needs model-health checks for overfitting.
            </p>
          </RecommendationPanel>
          {auth.isGuest && (
            <div className="ax-card" style={{ padding: '10px 12px', borderColor: guestModelLimitReached ? '#E24B4A' : 'var(--color-border-info)', background: guestModelLimitReached ? '#FFF1F1' : 'var(--color-background-info-soft)' }}>
              <div className="ax-row">
                <strong style={{ fontSize: 12 }}>Guest training usage</strong>
                <span className="ax-chip" style={{ fontSize: 11 }}>{guestTrainingUsed}/{GUEST_MODEL_LIMIT} guest trainings used</span>
              </div>
              <p style={{ fontSize: 11, color: guestModelLimitReached ? '#9E2524' : 'var(--color-text-secondary)', margin: '6px 0 0' }}>
                Guest mode includes up to {GUEST_MODEL_LIMIT} total model trainings for this temporary session. Deleting models will not reset the limit. {guestModelLimitReached ? 'Guest training limit reached. Create an account to remove guest training restrictions.' : `${guestModelsRemaining} training attempt${guestModelsRemaining === 1 ? '' : 's'} remaining.`}
              </p>
            </div>
          )}
          {visibleAlgos.map((a) => (
            <label
              key={a.key}
              className="ax-card"
              style={{
                padding: '10px 12px',
                cursor: auth.isGuest && !chosenAlgos.includes(a.key) && guestModelsRemaining <= selectedAlgos.length ? 'not-allowed' : 'pointer',
                opacity: auth.isGuest && !chosenAlgos.includes(a.key) && guestModelsRemaining <= selectedAlgos.length ? 0.55 : 1,
                background: chosenAlgos.includes(a.key) ? 'var(--color-accent-light)' : undefined,
                borderColor: chosenAlgos.includes(a.key) ? 'var(--color-accent)' : undefined,
              }}
            >
              <div className="ax-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={chosenAlgos.includes(a.key)}
                    disabled={auth.isGuest && !chosenAlgos.includes(a.key) && guestModelsRemaining <= selectedAlgos.length}
                    onChange={() => toggleAlgo(a.key)}
                  />
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{algoLabelForTask(a.key, plan?.task)}</p>
                    <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>{a.desc}</p>
                  </div>
                </div>
                <span className="ax-chip" style={{
                  background: a.interpretable ? '#DCFCE7' : 'var(--color-background-secondary)',
                  color: a.interpretable ? '#16A34A' : 'var(--color-text-tertiary)',
                  fontSize: 10,
                }}>
                  {a.interpretable ? '✓ interpretable' : 'complex'}
                </span>
              </div>
            </label>
          ))}
        </div>
      </Step>

      {/* Step 5 — train */}
      <div className="ax-row" style={{ margin: '8px 0 16px', justifyContent: 'flex-end' }}>
        <button
          className="ax-btn prim"
          disabled={training || !plan || selectedAlgos.length === 0 || guestModelLimitReached || guestSelectionOverLimit || (plan.validation_checks || []).some((c) => c.status === 'block')}
          onClick={train}
          type="button"
        >
          {training ? <InlineSpinner label={`Training ${selectedAlgos.length} model${selectedAlgos.length === 1 ? '' : 's'}...`} /> : `Train ${selectedAlgos.length} model${selectedAlgos.length === 1 ? '' : 's'}`}
        </button>
      </div>

      {/* Results */}
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
            <div id="models-tuning" className="ax-card" style={{ padding: 14, marginTop: 12 }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                Tune parameters
                <HelpButton
                  title="Tune parameters"
                  text="This card lets you adjust meaningful algorithm settings after an initial training run. Tuning is optional and most useful when model health warns about overfitting or when candidate models perform similarly."
                />
              </p>
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 10px' }}>
                Defaults were used for the first training run. Tuning is optional; try it when model health warns about overfitting or when metrics are close between models.
              </p>
              <ParameterSettings
                selectedAlgos={selectedAlgos}
                modelParams={modelParams}
                setModelParams={setModelParams}
              />
              <div style={{ textAlign: 'right', marginTop: 10 }}>
                <button className="ax-btn prim" disabled={training || selectedAlgos.length === 0 || guestModelLimitReached || guestSelectionOverLimit} onClick={train}>
                  {training ? <InlineSpinner label="Training tuned model..." /> : 'Train again with tuned settings'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Previous models */}
      {models.length > 0 && (
        <>
          <p className="ax-lbl" style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 6 }}>
            Previous models
            <HelpButton
              title="Previous models"
              text="This card lists saved trained models. You can restore their settings, send them to What-if analysis, or delete old runs to keep the project clean."
            />
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {models.map((m) => (
              <div key={m.id} className="ax-card" style={{ padding: '10px 12px' }}>
                <div className="ax-row">
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 500, margin: 0 }}>
                      {algoLabelForTask(m.algorithm, m.metrics?.task)} - {m.target}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>
                      {formatMetrics(m.metrics)}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button className="ax-btn" onClick={() => restoreModelSettings(m)} type="button">
                      Restore settings
                    </button>
                    <button className="ax-btn" onClick={() => prepareAndUseInWhatIf(m)} type="button">
                      Use in What-if
                    </button>
                    <button className="ax-btn" onClick={() => deleteSavedModel(m)} type="button">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Step({ n, title, disabled, children, id }) {
  const help = modelStepHelp(title)
  return (
    <div
      id={id}
      className="ax-card"
      style={{ marginBottom: 12, opacity: disabled ? 0.55 : 1, padding: 14 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            borderRadius: 11,
            background: 'var(--color-text-primary)',
            color: 'var(--color-background-primary)',
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          {n}
        </span>
        <p style={{ fontSize: 13, fontWeight: 500, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          {title}
          {help && <HelpButton title={plainTitle(title)} text={help} />}
        </p>
      </div>
      <div style={{ pointerEvents: disabled ? 'none' : 'auto' }}>{children}</div>
    </div>
  )
}

function plainTitle(value) {
  return String(value || '').replace(/&amp;/g, '&')
}

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

function RecommendationPanel({ title, source, children }) {
  return (
    <div className="ax-card" style={{ padding: '9px 10px', marginTop: 10, background: 'var(--color-background-secondary)' }}>
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

function recommendTargets(variables = []) {
  const scored = variables
    .filter((v) => !isIdLike(v.name))
    .map((v) => {
      const name = String(v.name || '').toLowerCase()
      let score = 0
      if (/target|outcome|result|score|gpa|grade|graduate|pass|fail|status|risk|churn|label/.test(name)) score += 3
      if (['category', 'binary', 'int', 'float', 'numeric'].includes(v.dtype)) score += 1
      if (Number(v.unique || 0) > 1) score += 1
      return { ...v, score, why: 'This column looks like a meaningful prediction outcome.' }
    })
    .sort((a, b) => b.score - a.score)
  return scored.filter((v) => v.score >= 2).slice(0, 4)
}

function recommendFeatures(variables = []) {
  return variables
    .filter((v) => !isIdLike(v.name))
    .filter((v) => ['category', 'binary', 'int', 'float', 'numeric', 'text'].includes(v.dtype))
    .slice(0, 12)
}

function isIdLike(name) {
  const n = String(name || '').toLowerCase()
  return n === 'id' || n.endsWith('_id') || n.includes('student_id') || n.includes('uuid')
}

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

function ParameterSettings({ selectedAlgos, modelParams, setModelParams }) {
  if (!selectedAlgos.length) {
    return (
      <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '10px 0 0' }}>
        Select at least one compatible model to view its default settings.
      </p>
    )
  }
  const update = (algo, key, value) => {
    setModelParams({
      ...modelParams,
      [algo]: {
        ...(modelParams[algo] || {}),
        [key]: value,
      },
    })
  }
  return (
    <div style={{ marginTop: 12, borderTop: '0.5px solid var(--color-border-tertiary)', paddingTop: 12 }}>
      <p className="ax-lbl" style={{ marginTop: 0 }}>Current settings</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
        {selectedAlgos.map((algo) => (
          <div key={algo} className="ax-card" style={{ padding: '10px 12px' }}>
            <p style={{ fontSize: 12, fontWeight: 500, margin: '0 0 8px' }}>{algoLabel(algo)}</p>
            {(PARAM_DEFS[algo] || []).map((def) => {
              const value = modelParams[algo]?.[def.key] ?? def.defaultValue
              return (
                <label key={def.key} style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8, alignItems: 'center', fontSize: 11, marginBottom: 6 }}>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{def.label}</span>
                  {def.type === 'checkbox' ? (
                    <input type="checkbox" checked={!!value} onChange={(e) => update(algo, def.key, e.target.checked)} />
                  ) : (
                    <input
                      type="number"
                      min={def.min}
                      max={def.max}
                      step={def.step}
                      value={value}
                      placeholder={def.type === 'numberOrBlank' ? 'None' : undefined}
                      onChange={(e) => update(algo, def.key, e.target.value === '' ? '' : Number(e.target.value))}
                    />
                  )}
                </label>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function PreprocessingPlan({ plan, onFixAction, dismissedChecks, onDismissCheck }) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  const checks = plan.validation_checks || []
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

      {/* Issues */}
      {checks.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <p style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>Issues detected before training</p>
            {issueCount > 0 ? (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', background: '#FEF3C7', color: '#D97706', borderRadius: 4 }}>
                {issueCount} need{issueCount === 1 ? 's' : ''} attention
              </span>
            ) : (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', background: '#DCFCE7', color: '#16A34A', borderRadius: 4 }}>
                Ready to train
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {checks.map((check, i) => {
              const dismissed = (dismissedChecks || []).includes(check.key)
              const effectiveStatus = dismissed && check.status === 'warning' ? 'ok' : check.status
              const isBlock = effectiveStatus === 'block'
              const isWarning = effectiveStatus === 'warning'
              const isOk = effectiveStatus === 'ok'
              const bg = isBlock ? '#FEF2F2' : isWarning ? '#FFFBEB' : '#F0FDF4'
              const border = isBlock ? '#FECACA' : isWarning ? '#FDE68A' : '#BBF7D0'
              const badgeBg = isBlock ? '#FEE2E2' : isWarning ? '#FEF3C7' : '#DCFCE7'
              const badgeColor = isBlock ? '#DC2626' : isWarning ? '#D97706' : '#16A34A'
              const textColor = isBlock ? '#7F1D1D' : isWarning ? '#78350F' : 'var(--color-text-secondary)'
              return (
                <div
                  key={check.key ?? i}
                  style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: '11px 14px', display: 'flex', alignItems: isOk ? 'center' : 'flex-start', gap: 10 }}
                >
                  <span
                    title={isBlock ? 'Blocked means training should not proceed until this issue is fixed.' : isWarning ? 'Warning means training can continue, but results may be less reliable.' : 'OK means this check passed.'}
                    style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', background: badgeBg, color: badgeColor, borderRadius: 4, flexShrink: 0, letterSpacing: '0.05em', marginTop: isOk ? 0 : 1, cursor: 'help' }}
                  >
                    {isBlock ? 'BLOCK' : isWarning ? 'WARNING' : 'OK'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, margin: 0, color: isOk ? 'var(--color-text-primary)' : (isBlock ? '#991B1B' : '#92400E') }}>
                      {check.label}
                    </p>
                    {!isOk && (
                      <p style={{ fontSize: 11, color: textColor, margin: '3px 0 0', lineHeight: 1.5 }}>
                        {dismissed ? 'Warning ignored.' : check.detail}
                      </p>
                    )}
                  </div>
                  {!isOk && (check.fixes || []).length > 0 && (
                    <FixOptionsDropdown
                      fixes={check.fixes}
                      onAction={onFixAction}
                      canDismiss={isWarning}
                      onDismiss={() => onDismissCheck?.(check.key)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

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
  return (
    <>
      <AIInsightCard
        datasetId={datasetId}
        step="models-comparison"
        params={{ task: models[0]?.metrics?.task, target: models[0]?.target }}
        result={{ models: compareSummary, skipped }}
        title="AI verdict on these model results"
        question="Which of these trained models looks most promising and why? Translate the metrics into plain English (good/mediocre/poor) and call out any red flags like overfitting or class imbalance."
        refreshKey={JSON.stringify(compareSummary)}
      />
      <p className="ax-lbl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        Comparison
        <HelpButton
          title="Model comparison"
          text="This card compares trained models using task-appropriate metrics. The best marker highlights the strongest metric, but you should still inspect model health and feature influence."
        />
      </p>
      <ComparisonTable models={models} activeIdx={activeIdx} onPick={setActiveIdx} />
      {skipped?.length > 0 && (
        <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '6px 0 12px' }}>
          Skipped: {skipped.map((s) => `${s.algorithm} (${s.reason})`).join(' · ')}
        </p>
      )}
      <ModelHealthCard model={active} datasetId={datasetId} onFixAction={onFixAction} />

      <div className="ax-card" style={{ padding: 14, marginTop: 8 }}>
        <div className="ax-row" style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{active.label} — details</p>
          <div style={{ display: 'flex', gap: 6 }}>
            <ExplainButton
              datasetId={datasetId}
              step="model-detail"
              params={{ algorithm: active.algorithm, target: active.target, model_params: active.metrics?.model_params }}
              result={active.metrics}
              question="Explain this specific model's metrics and feature influence in plain English. What are its strengths, weaknesses, and what should the user try next to improve it?"
              label="Explain metrics"
            />
            <button
              className="ax-btn"
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
            >
              Use in What-if
            </button>
          </div>
        </div>
        <ModelDetail model={active} />
      </div>
    </>
  )
}

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
                  <strong>{m.label}</strong>
                  {isBest && (
                    <span
                      className="ax-chip"
                      style={{ marginLeft: 6, background: 'var(--color-accent)', color: 'var(--color-background-primary)' }}
                    >
                      best
                    </span>
                  )}
                </td>
                <td>
                  {health ? (
                    <span className="ax-chip" style={{ background: healthStyle.chipBg, color: healthStyle.text }}>
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
                    className="ax-btn"
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

function ModelHealthCard({ model, datasetId, onFixAction }) {
  const health = assessModelHealth(model)
  if (!health) return null
  const tone = healthTone(health.color)
  return (
    <div
      className="ax-card"
      style={{
        padding: 14,
        margin: '10px 0',
        borderLeft: `4px solid ${tone.border}`,
        background: tone.bg,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <p style={{ fontSize: 13, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          Model health
          <HelpButton
            title="Model health"
            text="This card checks whether a trained model looks reliable. It flags possible overfitting, underfitting, class imbalance, weak test performance, or small-sample risk and suggests next actions."
          />
        </p>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="ax-chip" style={{ background: tone.chipBg, color: tone.text }}>
            {health.label}
          </span>
          <ExplainButton
            datasetId={datasetId}
            step="model-health"
            params={{ algorithm: model.algorithm, target: model.target, health: health.status }}
            result={{ metrics: model.metrics, health }}
            question="Explain this model health result in plain English. Say whether overfitting or underfitting is likely, why it matters, and which SimuCast fixes make sense next."
            label="AI explain"
          />
        </div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>
        {health.summary}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 6, marginBottom: 8 }}>
        {health.metrics.map((item) => (
          <div key={item.label} style={{ background: 'var(--color-background-secondary)', borderRadius: 6, padding: '7px 9px' }}>
            <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
              {item.label}
              {item.help && <HelpButton title={item.label} text={item.help} />}
            </p>
            <p style={{ fontSize: 13, fontWeight: 650, margin: '2px 0 0' }}>{item.value}</p>
          </div>
        ))}
      </div>
      <div style={{ background: 'rgba(255,255,255,0.55)', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 700, margin: '0 0 3px' }}>Why this matters</p>
        <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
          Overfitting means a model memorizes training rows too closely and may struggle on new data. Underfitting means the model is too weak or missing useful predictors.
        </p>
      </div>
      {health.causes.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <p style={{ fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Possible causes</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {health.causes.map((cause) => (
              <p key={cause} style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>- {cause}</p>
            ))}
          </div>
        </div>
      )}
      {health.actions.length > 0 && (
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, margin: '0 0 6px' }}>Recommended fixes</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {health.actions.map((action) => (
              <button
                key={action.label || action}
                className="ax-btn mini"
                type="button"
                title={action.why || ''}
                onClick={() => onFixAction?.({ route: action.route, section: action.section })}
              >
                {action.label || action}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ModelDetail({ model }) {
  const influence = normalizeInfluence(model.feature_influence || model.feature_importance)
  const impLabels = influence.map((item) => item.feature)
  const impValues = influence.map((item) => item.relative_strength ?? item.strength)
  const cm = model.metrics?.confusion_matrix

  return (
    <>
      {impLabels.length > 0 && (
        <>
          <p className="ax-lbl" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            Feature influence
            <HelpButton
              title="Feature influence"
              text="This card ranks original dataset columns by how much they influenced the selected model. Direction is shown when meaningful: increases raise the prediction/probability, decreases lower it."
            />
          </p>
          <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '-4px 0 8px' }}>
            Influence is aggregated to original dataset columns. "Increases" means higher values tend to raise the predicted value/probability; "Decreases" means they tend to lower it. Tree models show model-derived influence without a simple direction. Correlated features can affect these patterns.
          </p>
          <div style={{ height: Math.max(200, impLabels.length * 22), marginBottom: 14 }}>
            <Bar
              data={{
                labels: impLabels,
                datasets: [{ label: 'Influence', data: impValues, backgroundColor: '#7F77DD', borderRadius: 2 }],
              }}
              options={{
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: { beginAtZero: true, ticks: { font: { size: 10 } } },
                  y: { ticks: { font: { size: 10 } } },
                },
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
            {influence.map((item) => (
              <div key={item.feature} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 110px', gap: 8, fontSize: 11 }}>
                <strong>{item.feature}</strong>
                <span>{Math.round((item.relative_strength ?? 0) * 100)}%</span>
                <span style={{ color: directionColor(item.direction) }}>{directionLabel(item.direction)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {cm && (
        <>
          <p className="ax-lbl">Confusion matrix</p>
          <ConfusionMatrix cm={cm} />
        </>
      )}
    </>
  )
}

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

function ConfusionMatrix({ cm }) {
  const max = cm.flat().reduce((a, b) => Math.max(a, b), 0)
  return (
    <div style={{ display: 'inline-block', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 6, padding: 4 }}>
      <table style={{ borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        <thead>
          <tr>
            <th></th>
            {cm[0].map((_, i) => (
              <th key={i} style={{ padding: '4px 10px', color: 'var(--color-text-tertiary)', fontSize: 10, fontWeight: 400 }}>
                pred {i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cm.map((row, i) => (
            <tr key={i}>
              <th style={{ padding: '4px 10px', color: 'var(--color-text-tertiary)', fontSize: 10, fontWeight: 400, textAlign: 'right' }}>
                actual {i}
              </th>
              {row.map((v, j) => {
                const intensity = max > 0 ? v / max : 0
                const onDiag = i === j
                return (
                  <td
                    key={j}
                    style={{
                      padding: '6px 14px',
                      textAlign: 'center',
                      background: onDiag
                        ? `rgba(15,110,86,${0.10 + intensity * 0.5})`
                        : `rgba(163,45,45,${0.05 + intensity * 0.4})`,
                      border: '0.5px solid var(--color-border-tertiary)',
                      minWidth: 60,
                    }}
                  >
                    {v}
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

function formatMetrics(m) {
  if (!m) return ''
  if (m.task === 'classification') {
    const parts = [`accuracy ${pct(m.accuracy)}`]
    if (m.auc != null) parts.push(`AUC ${num(m.auc)}`)
    return parts.join(' · ')
  }
  return `R² ${num(m.r2)} · RMSE ${num(m.rmse)}`
}

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

function directionLabel(direction) {
  if (direction === 'positive') return 'Increases'
  if (direction === 'negative') return 'Decreases'
  if (direction === 'mixed') return 'Mixed'
  return 'Model-derived'
}

function directionColor(direction) {
  if (direction === 'positive') return 'var(--color-text-success)'
  if (direction === 'negative') return 'var(--color-text-danger)'
  return 'var(--color-text-secondary)'
}

function pct(v) {
  if (v == null) return '—'
  return `${(v * 100).toFixed(1)}%`
}
function num(v) {
  if (v == null) return '—'
  return Number(v).toFixed(3)
}

function defaultModelParams() {
  return Object.fromEntries(
    Object.entries(PARAM_DEFS).map(([algo, defs]) => [
      algo,
      Object.fromEntries(defs.map((def) => [def.key, def.defaultValue])),
    ]),
  )
}

function algoLabel(algo) {
  return ALGOS.find((a) => a.key === algo)?.label || algo
}

function algoLabelForTask(algo, task) {
  if (algo === 'rf') return task === 'classification' ? 'Random Forest Classifier' : task === 'regression' ? 'Random Forest Regressor' : 'Random Forest'
  if (algo === 'tree') return task === 'classification' ? 'Decision Tree Classifier' : task === 'regression' ? 'Decision Tree Regressor' : 'Decision Tree'
  return algoLabel(algo)
}

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
  if (page === 'models') return { page: 'models', section: 'models-step-3' }
  if (page === 'data') return { page: 'data', section: 'fix-cleaning-suggestions' }
  if (page === 'tests') return { page: 'tests', section: 'fix-correlation-test' }
  return null
}

function routeLabel(route) {
  const target = routeToFixTarget(route)
  if (!target) return route || 'Open'
  const page = target.page === 'whatif' ? 'What-if' : target.page.charAt(0).toUpperCase() + target.page.slice(1)
  return `${page} page`
}

function highlightSection(section) {
  const el = document.getElementById(section)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ax-fix-highlight')
  window.setTimeout(() => el.classList.remove('ax-fix-highlight'), 2600)
}

