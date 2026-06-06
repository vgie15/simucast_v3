/* ============================================================
 * PAGE: WHAT-IF / PREDICTION — 2-column side panel layout
 * Keywords: whatif, what-if, predict, prediction, scenario, simulation
 * ============================================================ */
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../api'
import { useDialog } from '../common/DialogProvider'
import { SparkleIcon } from '../ai/AIExplainers'
import { InlineSpinner } from '../common/LoadingStates'
import { ArrowRight, LineChart, SlidersHorizontal, Sparkles } from 'lucide-react'

const SCENARIO_MAX = 8
const STORAGE_KEY = 'simucast.whatif'

function loadDraft() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveDraft(draft) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft)) } catch {}
}

const kebab = (str) => String(str).toLowerCase().replace(/['`’]/g, '').replace(/[^a-z0-9]+/g, '-')

function formatModelAlgorithmLabel(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (!key) return 'Selected model'
  if (key.includes('random forest') || key === 'rf') return 'Random Forest'
  if (key.includes('decision tree') || key === 'tree') return 'Decision Tree'
  if (key.includes('linear')) return 'Linear Regression'
  if (key.includes('logistic')) return 'Logistic Regression'
  return key.replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatWhatIfModelLabel(model) {
  const algorithm = formatModelAlgorithmLabel(model?.algorithm || model?.name)
  const target = model?.target || model?.target_variable || ''
  const shortTarget = target.length > 22 ? target.slice(0, 20) + '…' : target
  return target ? `${algorithm} · ${shortTarget}` : algorithm
}

export default function WhatIfPage({ dataset, activeModel, setActiveModel, initialData, onGo }) {
  const dialog = useDialog()
  const [fallbackModel, setFallbackModel] = useState(null)
  const initialModels = initialData?.tab === 'whatif' && initialData?.datasetId === dataset?.id ? (initialData.models || []) : []
  const [availableModels, setAvailableModels] = useState(initialModels)
  const [modelFull, setModelFull] = useState(null)
  const [inputs, setInputs] = useState({})
  const [pred, setPred] = useState(null)
  const [baseline, setBaseline] = useState(null)
  const [baselineInputs, setBaselineInputs] = useState(null)
  const [scenarioName, setScenarioName] = useState('')
  const [scenarios, setScenarios] = useState([])
  const [selectedScenarioName, setSelectedScenarioName] = useState('')
  const draftRestored = useRef(false)
  const predictionRequestRef = useRef(0)
  const selectedModel = fallbackModel || activeModel

  const [explainMode, setExplainMode] = useState(false)
  const [explainPopup, setExplainPopup] = useState(null)
  const [resultInsightOpen, setResultInsightOpen] = useState(false)
  const [resultInsightText, setResultInsightText] = useState('')
  const [resultInsightLoading, setResultInsightLoading] = useState(false)

  // Restore draft from localStorage
  useEffect(() => {
    if (draftRestored.current) return
    const draft = loadDraft()
    if (draft && draft.datasetId === dataset?.id) {
      if (draft.modelFull) setModelFull(draft.modelFull)
      if (draft.inputs) setInputs(draft.inputs)
      if (draft.pred) setPred(draft.pred)
      if (draft.baseline) setBaseline(draft.baseline)
      if (draft.baselineInputs) setBaselineInputs(draft.baselineInputs)
      if (draft.scenarios) setScenarios(draft.scenarios)
      if (draft.fallbackModelId) {
        setFallbackModel({ id: draft.fallbackModelId, has_whatif: true })
      }
    }
    draftRestored.current = true
  }, [dataset?.id])

  // Save draft to localStorage
  useEffect(() => {
    if (!draftRestored.current || !dataset?.id) return
    saveDraft({
      datasetId: dataset.id,
      modelFull: modelFull ? { id: modelFull.id, name: modelFull.name, target: modelFull.target, whatif_features: modelFull.whatif_features } : null,
      inputs,
      pred,
      baseline,
      baselineInputs,
      scenarios,
      fallbackModelId: selectedModel?.id || null,
    })
  }, [dataset?.id, modelFull?.id, inputs, pred, baseline, baselineInputs, scenarios, selectedModel?.id])

  useEffect(() => {
    if (!dataset?.id) return
    if (initialData?.tab === 'whatif' && initialData?.datasetId === dataset.id && initialData.models) {
      setAvailableModels(initialData.models || [])
      if (!activeModel && !fallbackModel) setFallbackModel((initialData.models || []).find((m) => m.has_whatif) || null)
      return
    }
    api.listModels(dataset.id)
      .then((models) => {
        setAvailableModels(models || [])
        if (!activeModel && !fallbackModel) setFallbackModel((models || []).find((m) => m.has_whatif) || null)
      })
      .catch(console.error)
  }, [dataset?.id, activeModel?.id, fallbackModel?.id, initialData?.datasetId])

  useEffect(() => {
    if (!selectedModel) return
    // Skip if we already have a modelFull for this model (restored from draft)
    if (modelFull && modelFull.id === selectedModel.id) return
    api.getModel(selectedModel.id).then(async (m) => {
      const currentFeatures = await hydrateCurrentCategoryValues(dataset?.id, m.whatif_features || [])
      const hydratedModel = { ...m, whatif_features: currentFeatures }
      setModelFull(hydratedModel)
      const init = {}
      for (const f of currentFeatures || []) {
        init[f.name] = f.kind === 'categorical' ? (f.default || f.values?.[0] || '') : defaultNumericFeatureValue(f)
      }
      setInputs(init)
      setPred(null)
      setBaseline(null)
      setBaselineInputs(null)
      setScenarios([])
    })
  }, [selectedModel?.id, dataset?.current_stage_id])

  useEffect(() => {
    if (!modelFull || !Object.keys(inputs).length) return undefined
    // Skip prediction if we already have one for these exact inputs (restored from draft)
    if (pred && JSON.stringify(pred.inputs) === JSON.stringify(inputs)) return undefined
    const predictionInputs = normalizeInputsForFeatures(inputs, modelFull.whatif_features || [])
    const requestId = predictionRequestRef.current + 1
    predictionRequestRef.current = requestId
    let active = true
    const timer = window.setTimeout(() => {
      api.predict(modelFull.id, predictionInputs).then((p) => {
        if (!active || predictionRequestRef.current !== requestId) return
        setPred(p)
        setBaseline((current) => {
          if (!current) setBaselineInputs({ ...predictionInputs })
          return current || p
        })
      }).catch((err) => {
        if (active && predictionRequestRef.current === requestId) console.error(err)
      })
    }, 180)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [inputs, modelFull?.id])

  useEffect(() => {
    if (!modelFull?.whatif_features?.length || !Object.keys(inputs).length) return
    let changed = false
    const normalized = { ...inputs }
    for (const feature of modelFull.whatif_features) {
      if (feature.kind === 'categorical' || !(feature.name in normalized) || normalized[feature.name] === '') continue
      const next = normalizeNumericFeatureValue(feature, normalized[feature.name])
      if (String(next) !== String(normalized[feature.name])) {
        normalized[feature.name] = next
        changed = true
      }
    }
    if (changed) setInputs(normalized)
  }, [modelFull?.id, modelFull?.whatif_features])

  useEffect(() => {
    document.body.classList.toggle('ax-explain-mode-on', explainMode)
    return () => document.body.classList.remove('ax-explain-mode-on')
  }, [explainMode])

  useEffect(() => {
    setResultInsightText('')
    setResultInsightLoading(false)
  }, [modelFull?.id])

  useEffect(() => {
    if (!resultInsightOpen || !dataset?.id || !pred || !baseline || !modelFull) return undefined
    let cancelled = false
    const currentPrediction = Number(pred.prediction)
    const baselinePrediction = Number(baseline.prediction)
    const payload = {
      target: modelFull.target,
      model: formatWhatIfModelLabel(modelFull),
      algorithm: formatModelAlgorithmLabel(modelFull.algorithm || modelFull.name),
      currentPrediction,
      baselinePrediction,
      difference: currentPrediction - baselinePrediction,
      percentDifference: Math.abs(baselinePrediction) > 1e-9 ? ((currentPrediction - baselinePrediction) / Math.abs(baselinePrediction)) * 100 : 0,
      inputs,
      baselineInputs,
      risk: computeExtrapolation(inputs, modelFull.whatif_features || []),
    }

    setResultInsightLoading(true)
    api.aiExplain(
      dataset.id,
      'whatif-result-inline-interpretation',
      payload,
      'Explain this what-if prediction in plain English. Focus on which input values likely drive the prediction, whether the result makes intuitive sense, and what the user could change to increase or decrease the prediction.',
      { prediction: pred, baseline, inputs, baselineInputs }
    )
      .then((response) => {
        if (cancelled) return
        setResultInsightText(cleanWhatIfExplainText(response?.explanation || response?.message || response?.text, makeWhatIfResultFallback(payload)))
      })
      .catch(() => {
        if (cancelled) return
        setResultInsightText(makeWhatIfResultFallback(payload))
      })
      .finally(() => {
        if (!cancelled) setResultInsightLoading(false)
      })

    return () => { cancelled = true }
  }, [resultInsightOpen, dataset?.id, modelFull?.id, pred?.prediction, baseline?.prediction, JSON.stringify(inputs), JSON.stringify(baselineInputs)])

  useEffect(() => {
    const handleGlobalEsc = (event) => {
      if (event.key === 'Escape') {
        if (explainPopup) {
          setExplainPopup(null)
        } else if (explainMode) {
          setExplainMode(false)
        }
      }
    }
    document.addEventListener('keydown', handleGlobalEsc)
    return () => document.removeEventListener('keydown', handleGlobalEsc)
  }, [explainPopup, explainMode])

  const openExplain = (meta, event) => {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    const target = event?.currentTarget || event?.target || meta.sourceEl
    const sourceRect = target?.getBoundingClientRect ? target.getBoundingClientRect() : (meta.sourceRect || null)

    const context = {
      modelFull,
      inputs,
      pred,
      baseline,
      extrapolation,
      scenarios,
      pctPosition,
      categoricalFeatures,
      numericFeatures,
      scenarioName,
    }

    const explainedMeta = buildWhatIfExplainMeta(meta, context)
    setExplainPopup({
      ...explainedMeta,
      sourceEl: target?.getBoundingClientRect ? target : (meta.sourceEl || null),
      sourceRect,
    })
  }

  const explainAttrs = (meta, className = '', capture = false) => {
    const attrs = {
      className: `${className} ${explainMode ? 'ax-explain-selectable' : ''} ${explainPopup && explainPopup.id === meta.id ? 'ax-explain-active' : ''}`.trim(),
      title: explainMode ? `Explain ${meta.title || 'this area'}` : undefined,
    }

    const handler = (event) => {
      if (!explainMode) return
      event.preventDefault()
      event.stopPropagation()
      openExplain(meta, event)
    }

    if (capture) {
      attrs.onClickCapture = handler
      attrs.onPointerDownCapture = handler
      attrs.onMouseDownCapture = handler
    } else {
      attrs.onClick = handler
    }

    return attrs
  }

  // Intercept side tabs and floating dock buttons
  useEffect(() => {
    if (!explainMode) return undefined
    const onPersistentControl = (event) => {
      const tab = event.target?.closest?.('.ax-edge-tab')
      const floating = event.target?.closest?.('.ax-floating-pill-action, .ax-floating-pill-dismiss')
      if (!tab && !floating) return
      event.preventDefault()
      event.stopPropagation()
      
      const rect = (tab || floating).getBoundingClientRect()
      
      if (floating) {
        const isDataset = floating.classList.contains('dataset')
        const isDismiss = floating.classList.contains('ax-floating-pill-dismiss')
        const titleText = isDismiss ? 'Floating tools close button' : isDataset ? 'Dataset button' : 'Ask AI button'
        openExplain({
          id: isDismiss ? 'whatif-ask-ai-close' : isDataset ? 'whatif-dataset-button' : 'whatif-ask-ai-button',
          title: titleText,
          type: 'persistent-control',
          sourceEl: floating,
          sourceRect: rect,
        }, event)
        return
      }
      
      const isHistory = tab.classList.contains('history')
      openExplain({
        id: isHistory ? 'whatif-history-tab' : 'whatif-guide-tab',
        title: isHistory ? 'History tab' : 'Guide tab',
        type: 'side-tab',
        sourceEl: tab,
        sourceRect: rect,
      }, event)
    }
    
    document.addEventListener('pointerdown', onPersistentControl, true)
    document.addEventListener('click', onPersistentControl, true)
    return () => {
      document.removeEventListener('pointerdown', onPersistentControl, true)
      document.removeEventListener('click', onPersistentControl, true)
    }
  }, [explainMode, modelFull, inputs, pred, baseline, scenarios])

  if (!dataset) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>
  if (!selectedModel) return <NoModelView availableModels={availableModels} setFallbackModel={setFallbackModel} dialog={dialog} onGo={onGo} />
  if (!modelFull) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Loading model...</p>

  const features = modelFull.whatif_features || []
  const categoricalFeatures = features.filter((f) => f.kind === 'categorical')
  const numericFeatures = features.filter((f) => f.kind !== 'categorical')
  const isProb = pred?.kind === 'probability'
  const targetContext = pred?.target_context || modelFull.target_context
  const extrapolation = computeExtrapolation(inputs, features)
  const riskTone = riskStyle(extrapolation.overall_risk)
  const delta = pred && baseline ? pred.prediction - baseline.prediction : null

  const resetToMean = () => {
    const init = {}
    for (const f of features) init[f.name] = f.kind === 'categorical' ? (f.default || f.values?.[0] || '') : defaultNumericFeatureValue(f)
    setInputs(init)
    setBaseline(null)
    setBaselineInputs(null)
  }

  const saveScenario = async () => {
    if (!pred) return
    const name = scenarioName.trim() || `Scenario ${scenarios.length + 1}`
    const scenario = { name, inputs: { ...inputs }, prediction: pred, extrapolation }
    setScenarios((prev) => [...prev.slice(0, SCENARIO_MAX - 1), scenario])
    setScenarioName('')
    try { await api.saveScenario(modelFull.id, scenario) } catch {}
  }

  const deleteScenario = (idx) => setScenarios((prev) => prev.filter((_, i) => i !== idx))

  const loadScenario = (s) => {
    setInputs(s.inputs || {})
    setSelectedScenarioName(s.name)
    setPred(null)
  }

  const switchModel = async (modelId) => {
    const next = availableModels.find((model) => String(model.id) === String(modelId))
    if (!next || String(next.id) === String(selectedModel?.id)) return
    try {
      let ready = next
      if (!next.has_whatif) {
        await api.prepareModelForWhatIf(next.id)
        ready = { ...next, has_whatif: true }
      }
      setFallbackModel(ready)
      setActiveModel?.(ready)
      setModelFull(null)
      setInputs({})
      setPred(null)
      setBaseline(null)
      setBaselineInputs(null)
      setScenarios([])
      setSelectedScenarioName('')
    } catch (err) {
      await dialog.alert({ title: 'Could Not Switch Model', message: err.message, variant: 'danger' })
    }
  }

  const rangeMin = Number(targetContext?.min ?? 0)
  const rangeMax = Number(targetContext?.max ?? 100)
  const rangeMean = Number(targetContext?.mean ?? (rangeMin + rangeMax) / 2)
  const currentPred = pred?.prediction ?? 0
  const baselinePred = baseline?.prediction ?? rangeMean
  const pctPosition = rangeMax > rangeMin ? Math.min(100, Math.max(0, ((currentPred - rangeMin) / (rangeMax - rangeMin)) * 100)) : 50
  const baselinePct = rangeMax > rangeMin ? Math.min(100, Math.max(0, ((baselinePred - rangeMin) / (rangeMax - rangeMin)) * 100)) : 50
  const activeModelName = formatWhatIfModelLabel(modelFull || selectedModel)
  const activeModelAlgorithm = formatModelAlgorithmLabel(modelFull.algorithm || selectedModel?.algorithm || activeModelName)
  const activeModelMetric = modelFull.metrics?.accuracy != null
    ? `${Math.round(modelFull.metrics.accuracy * 100)}% accuracy`
    : modelFull.metrics?.r2 != null
      ? `R² ${Number(modelFull.metrics.r2).toFixed(3)}`
      : modelFull.metrics?.rmse != null
        ? `RMSE ${Number(modelFull.metrics.rmse).toFixed(3)}`
        : null
  const resultInterpretation = buildWhatIfResultInterpretation({
    current: currentPred,
    baseline: baselinePred,
    target: modelFull.target,
    isProb,
  })
  const interpretationChips = (modelFull.whatif_features || [])
    .map((feature) => {
      const name = feature.name
      const baselineValue = baselineInputs?.[name]
      const currentValue = inputs?.[name]
      if (baselineValue === undefined || currentValue === undefined) return null
      return {
        name,
        baselineValue: formatScenarioCompareValue(baselineValue, feature),
        currentValue: formatScenarioCompareValue(currentValue, feature),
        changed: String(baselineValue) !== String(currentValue),
      }
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.changed) - Number(a.changed))
    .slice(0, 4)

  const toggleResultInsight = () => {
    setResultInsightOpen((open) => {
      const nextOpen = !open
      if (!nextOpen) setResultInsightLoading(false)
      return nextOpen
    })
  }
  const resultInsightRegenerating = resultInsightOpen && resultInsightLoading && Boolean(resultInsightText)

  return (
    <div className="ax-whatif-layout">
      {explainMode && (
        <style>{`
          .ax-explain-mode-on .ax-explain-selectable,
          .ax-explain-mode-on .ax-explain-selectable * {
            cursor: pointer !important;
          }
          .ax-explain-mode-on .ax-explain-selectable.ax-explain-active {
            outline: 2.5px solid #f97316 !important;
            outline-offset: 3px;
            z-index: 10;
          }
        `}</style>
      )}

      {/* ─── LEFT COLUMN ─── */}
      <div className="ax-whatif-left">
        {/* Header (pinned) */}
        <div className="ax-whatif-left-head">
          <h2 id="whatif-sidebar-header" {...explainAttrs({ id: 'whatif-sidebar-header', title: 'What-if scenario header', type: 'page-header' }, 'ax-whatif-left-title')}>What-if scenario</h2>
          <p id="whatif-sidebar-subtitle" {...explainAttrs({ id: 'whatif-sidebar-subtitle', title: 'What-if scenario subtitle', type: 'page-subtitle' }, 'ax-whatif-left-sub')}>
            Adjust feature values to see how they affect the prediction
          </p>
        </div>

        {/* Scrollable body */}
        <div id="whatif-inputs-panel" className="ax-whatif-left-scroll">
          <div id="whatif-model-card" {...explainAttrs({ id: 'whatif-model-card', title: 'Model in Use Card', type: 'model-card' }, 'ax-whatif-model-card')}>
            <span>Model in use</span>
            <label className="ax-whatif-model-select-label" htmlFor="whatif-model-select">
              <select
                id="whatif-model-select"
                className="ax-whatif-model-select"
                {...explainAttrs({ id: 'whatif-model-dropdown', title: 'Model Selector Dropdown', type: 'model-dropdown' }, '', true)}
                value={selectedModel?.id || ''}
                onChange={(event) => switchModel(event.target.value)}
              >
                {availableModels.some((model) => String(model.id) === String(selectedModel?.id)) ? null : (
                  <option value={selectedModel?.id || ''}>{formatWhatIfModelLabel(modelFull || selectedModel)}</option>
                )}
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {formatWhatIfModelLabel(model)}
                  </option>
                ))}
              </select>
            </label>
            <dl>
              <div id="whatif-model-target" {...explainAttrs({ id: 'whatif-model-target', title: 'Model target variable', type: 'model-target' })}>
                <dt>Target</dt>
                <dd>{modelFull.target}</dd>
              </div>
              <div id="whatif-model-algorithm" {...explainAttrs({ id: 'whatif-model-algorithm', title: 'Model training algorithm', type: 'model-algorithm' })}>
                <dt>Algorithm</dt>
                <dd>{activeModelAlgorithm}</dd>
              </div>
              {activeModelMetric && (
                <div>
                  <dt>Metric</dt>
                  <dd>{activeModelMetric}</dd>
                </div>
              )}
            </dl>
          </div>

          {categoricalFeatures.length > 0 && (
            <div id="whatif-categorical-section" {...explainAttrs({ id: 'whatif-categorical-section', title: 'Categorical features section', type: 'categorical-section' })}>
              <FeatureGroup label="Categorical features">
                {categoricalFeatures.map((f) => (
                  <CategoricalPill key={f.name} feature={f} value={inputs[f.name]} onChange={(v) => setInputs({ ...inputs, [f.name]: v })} explainAttrs={explainAttrs} />
                ))}
              </FeatureGroup>
            </div>
          )}
          {numericFeatures.length > 0 && (
            <div id="whatif-numeric-section" {...explainAttrs({ id: 'whatif-numeric-section', title: 'Numeric features section', type: 'numeric-section' })}>
              <FeatureGroup label="Numeric features">
                {numericFeatures.map((f) => (
                  <NumericSlider key={f.name} feature={f} value={inputs[f.name]} onChange={(v) => setInputs({ ...inputs, [f.name]: v })} explainAttrs={explainAttrs} />
                ))}
              </FeatureGroup>
            </div>
          )}
        </div>

        {/* Footer (pinned) */}
        <div className="ax-whatif-left-foot">
          <button
            id="whatif-reset-to-mean"
            {...explainAttrs({ id: 'whatif-reset-to-mean', title: 'Reset to Mean Button', type: 'reset-to-mean' }, 'ax-btn', true)}
            onClick={resetToMean}
            style={{ fontSize: 11, whiteSpace: 'nowrap' }}
          >
            Reset to mean
          </button>
          <input
            id="whatif-scenario-name-input"
            {...explainAttrs({ id: 'whatif-scenario-name-input', title: 'Scenario Name Input', type: 'scenario-name-input', currentText: scenarioName }, '', true)}
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            placeholder="Scenario name..."
            style={{ flex: 1, fontSize: 11, minWidth: 0 }}
          />
          <button
            id="whatif-save-scenario"
            {...explainAttrs({ id: 'whatif-save-scenario', title: 'Save Scenario Button', type: 'save-scenario' }, 'ax-btn prim', true)}
            onClick={saveScenario}
            disabled={!explainMode && !pred}
            style={{ fontSize: 11, whiteSpace: 'nowrap' }}
          >
            Save
          </button>
        </div>
      </div>

      {/* ─── RIGHT COLUMN ─── */}
      <div className="ax-whatif-main">
        {/* Prediction Result Card */}
        <div id="whatif-prediction-card" {...explainAttrs({ id: 'whatif-prediction-card', title: 'Prediction Result Card', type: 'prediction-card' }, 'ax-card')} style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <div>
              <span
                id={modelFull.target === 'math_score' ? 'whatif-prediction-header-math-score' : modelFull.target === 'pass' ? 'whatif-prediction-header-pass' : 'whatif-prediction-header'}
                {...explainAttrs({ id: modelFull.target === 'math_score' ? 'whatif-prediction-header-math-score' : 'whatif-prediction-header-pass', title: 'Prediction result target', type: 'prediction-header' })}
                style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                Prediction result — {modelFull.target}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexShrink: 0, flexWrap: 'wrap', maxWidth: '100%' }}>
              <button
                type="button"
                className={`ax-explain-mode-toggle ${explainMode ? 'active' : ''}`}
                onClick={() => {
                  setExplainMode(v => !v)
                  setExplainPopup(null)
                }}
                title={explainMode ? 'Turn off Explain Mode' : 'Turn on Explain Mode'}
                style={{ whiteSpace: 'nowrap', flexShrink: 0, minWidth: 162, justifyContent: 'center' }}
              >
                <SparkleIcon size={14} />
                Explain Mode <span aria-hidden="true" />
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, marginBottom: 16 }}>
            {/* Current scenario */}
            <div>
              <span id="whatif-current-scenario-label" {...explainAttrs({ id: 'whatif-current-scenario-label', title: 'Current Scenario label', type: 'current-scenario-label' })} style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Current scenario</span>
              <p id="whatif-current-prediction-value" {...explainAttrs({ id: 'whatif-current-prediction-value', title: 'Current prediction value', type: 'current-prediction-value' })} style={{ fontSize: 40, fontWeight: 700, margin: '4px 0 2px', color: 'var(--color-text-primary)', lineHeight: 1.1 }}>
                {isProb ? `${Math.round(currentPred * 100)}%` : fmt(currentPred)}
              </p>
              {baseline && (
                <p id="whatif-difference-from-baseline" {...explainAttrs({ id: 'whatif-difference-from-baseline', title: 'Difference from baseline', type: 'difference-from-baseline' })} style={{ fontSize: 12, margin: '4px 0 0', color: delta > 0 ? 'var(--color-text-success, #16a34a)' : delta < 0 ? 'var(--color-text-danger, #dc2626)' : 'var(--color-text-tertiary)' }}>
                  {formatDelta(delta, isProb)} vs baseline
                </p>
              )}
              <div
                id="whatif-scenario-risk"
                {...explainAttrs({ id: 'whatif-scenario-risk', title: 'Scenario Risk Banner', type: 'scenario-risk' })}
                style={{
                  marginTop: 10, padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  background: riskTone.bg, color: riskTone.fg, border: `1px solid ${riskTone.border}`,
                  display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%', boxSizing: 'border-box'
                }}
              >
                Scenario risk: {extrapolation.overall_risk.toUpperCase()}
                {extrapolation.out_of_range_features?.length > 0 ? ' — extrapolated inputs' : ' — all inputs within dataset range'}
              </div>
            </div>
            {/* Baseline */}
            <div id="whatif-baseline-panel" {...explainAttrs({ id: 'whatif-baseline-panel', title: 'Baseline Panel', type: 'baseline-panel' })} style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Baseline</span>
              <p id="whatif-baseline-value" {...explainAttrs({ id: 'whatif-baseline-value', title: 'Baseline value', type: 'baseline-panel' })} style={{ fontSize: 22, fontWeight: 500, margin: '4px 0 0', color: 'var(--color-text-secondary)' }}>
                {isProb ? `${Math.round(baselinePred * 100)}%` : fmt(baselinePred)}
              </p>
              <p id="whatif-baseline-caption" {...explainAttrs({ id: 'whatif-baseline-caption', title: 'Baseline caption', type: 'baseline-panel' })} style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>mean prediction</p>
            </div>
          </div>

          {/* Range gauge */}
          {targetContext && !isProb && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 6 }}>
                <span id="whatif-dataset-range" {...explainAttrs({ id: 'whatif-dataset-range', title: 'Dataset Range Label', type: 'dataset-range' })}>Dataset range: {fmt(rangeMin)} – {fmt(rangeMax)}</span>
                <span id="whatif-percent-location" {...explainAttrs({ id: 'whatif-percent-location', title: 'Percent Location Label', type: 'prediction-range-bar' })} style={{ color: 'var(--color-accent, #f97316)', fontWeight: 600 }}>{Math.round(pctPosition)}%</span>
              </div>
              <div id="whatif-prediction-range-bar" {...explainAttrs({ id: 'whatif-prediction-range-bar', title: 'Prediction range bar', type: 'prediction-range-bar' })} style={{ position: 'relative', height: 28 }}>
                {/* Track */}
                <div style={{ position: 'absolute', top: 10, left: 0, right: 0, height: 8, background: 'var(--color-background-secondary, #f3f4f6)', borderRadius: 4 }}>
                  {/* Fill */}
                  <div id="whatif-current-marker" {...explainAttrs({ id: 'whatif-current-marker', title: 'Current marker', type: 'prediction-range-bar' })} style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${pctPosition}%`, background: 'linear-gradient(90deg, var(--color-accent, #f97316), #fb923c)', borderRadius: 4, transition: 'width 0.3s ease' }} />
                </div>
                {/* Baseline marker */}
                <div id="whatif-baseline-marker" {...explainAttrs({ id: 'whatif-baseline-marker', title: 'Baseline Marker', type: 'prediction-range-bar' })} style={{ position: 'absolute', top: 6, left: `${baselinePct}%`, width: 2, height: 16, background: 'var(--color-text-secondary)', borderRadius: 1, transform: 'translateX(-1px)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                <span>{fmt(rangeMin)}</span>
                <span>↑ baseline</span>
                <span>{fmt(rangeMax)}</span>
              </div>
            </div>
          )}

          {pred && baseline && (
            <div
              id="whatif-result-interpretation-card"
              {...explainAttrs({ id: 'whatif-result-interpretation-card', title: 'Prediction Interpretation Card', type: 'prediction-card' }, `ax-whatif-interpretation-card ${resultInterpretation.tone}`)}
            >
              <div className="ax-whatif-interpretation-main">
                <div>
                  <span className="ax-whatif-interpretation-kicker">Auto interpretation</span>
                  <p>{resultInterpretation.summary}</p>
                </div>
                <strong className="ax-whatif-interpretation-badge">{resultInterpretation.badge}</strong>
              </div>
              {interpretationChips.length > 0 && (
                <div className="ax-whatif-interpretation-chips" aria-label="Changed scenario inputs">
                  {interpretationChips.map((chip) => (
                      <span key={chip.name} className={`ax-whatif-interpretation-chip ${chip.changed ? 'changed' : 'muted'}`}>
                        <strong>{chip.name}</strong>
                        <em>{chip.baselineValue} {'->'} {chip.currentValue}</em>
                      </span>
                  ))}
                </div>
              )}
              <div className="ax-whatif-interpretation-toggle-row">
                <button
                  type="button"
                  className={`ax-whatif-interpretation-toggle ${resultInsightOpen ? 'active' : ''}`}
                  onClick={(event) => {
                    if (explainMode) {
                      event.preventDefault()
                      event.stopPropagation()
                      openExplain({ id: 'whatif-result-interpretation-toggle', title: 'AI Insight Toggle', type: 'prediction-card' }, event)
                      return
                    }
                    toggleResultInsight()
                  }}
                  aria-pressed={resultInsightOpen}
                >
                  <SparkleIcon size={13} />
                  <span>AI insight</span>
                  <i aria-hidden="true" />
                </button>
                {resultInsightRegenerating && (
                  <span className="ax-whatif-interpretation-regen">
                    Regenerating
                    <span className="ax-whatif-ai-dots" aria-hidden="true"><b /><b /><b /></span>
                  </span>
                )}
              </div>
              <div className={`ax-whatif-interpretation-ai ${resultInsightOpen ? 'open' : ''}`}>
                {resultInsightOpen && (
                  resultInsightLoading
                    ? (
                      <div className="ax-whatif-interpretation-loading">
                        <SparkleIcon size={13} />
                        <span>{resultInsightText ? 'Regenerating insight' : 'Generating insight'}</span>
                        <span className="ax-whatif-ai-dots" aria-hidden="true"><b /><b /><b /></span>
                      </div>
                    )
                    : <p>{resultInsightText || makeWhatIfResultFallback({ target: modelFull.target, currentPrediction: currentPred, baselinePrediction: baselinePred, difference: delta, percentDifference: resultInterpretation.percent, inputs, baselineInputs })}</p>
                )}
              </div>
            </div>
          )}

          {/* Note box */}
          {pred?.note && (
            <div
              id="whatif-tree-model-note"
              {...explainAttrs({ id: 'whatif-tree-model-note', title: 'Tree-based model note', type: 'tree-model-note' })}
              style={{ marginTop: 12, padding: '8px 10px', background: 'var(--color-background-secondary, #f9fafb)', borderRadius: 6, fontSize: 11, color: 'var(--color-text-tertiary)' }}
            >
              {pred.note}
            </div>
          )}
        </div>

        {/* Scenario Compare Card */}
        {(baseline || scenarios.length > 0) && (
          <div id="whatif-scenario-compare-card" {...explainAttrs({ id: 'whatif-scenario-compare-card', title: 'Scenario Compare Card', type: 'scenario-compare-card' })} className="ax-card" style={{ padding: 20 }}>
            <span id="whatif-scenario-compare-header" {...explainAttrs({ id: 'whatif-scenario-compare-header', title: 'Scenario Compare Header', type: 'scenario-compare-card' })} style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Scenario compare</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
              {/* Baseline */}
              <div id="whatif-baseline-column" {...explainAttrs({ id: 'whatif-baseline-column', title: 'Baseline Column', type: 'scenario-compare-card' })} style={{ borderTop: '3px solid var(--color-border-tertiary)', paddingTop: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>Baseline</span>
                <p id="whatif-compare-baseline-prediction" {...explainAttrs({ id: 'whatif-compare-baseline-prediction', title: 'Compare Baseline Prediction', type: 'baseline-panel' })} style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 8px', color: 'var(--color-text-secondary)' }}>
                  {formatPrediction(baseline)}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {baselineInputs && Object.entries(baselineInputs).slice(0, 8).map(([k, v]) => (
                    <div id={`whatif-baseline-row-${kebab(k)}`} {...explainAttrs({ id: `whatif-baseline-row-${kebab(k)}`, title: `Baseline Row: ${k}`, type: 'compare-row', featureName: k, baselineValue: String(v), currentValue: String(inputs[k]), isChanged: String(inputs[k]) !== String(v) })} key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                      <span style={{ color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>{formatScenarioCompareValue(v, featureByName(features, k))}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Current inputs */}
              <div id="whatif-current-inputs-column" {...explainAttrs({ id: 'whatif-current-inputs-column', title: 'Current Inputs Column', type: 'scenario-compare-card' })} style={{ borderTop: '3px solid var(--color-accent, #f97316)', paddingTop: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>Current inputs</span>
                <p id="whatif-compare-current-prediction" {...explainAttrs({ id: 'whatif-compare-current-prediction', title: 'Compare Current Prediction', type: 'current-prediction-value' })} style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 2px', color: 'var(--color-accent, #f97316)' }}>
                  {formatPrediction(pred)}
                </p>
                {baseline && (
                  <p id="whatif-compare-difference" {...explainAttrs({ id: 'whatif-compare-difference', title: 'Compare Difference from Baseline', type: 'difference-from-baseline' })} style={{ fontSize: 11, margin: '0 0 8px', color: delta > 0 ? 'var(--color-text-success, #16a34a)' : delta < 0 ? 'var(--color-text-danger, #dc2626)' : 'var(--color-text-tertiary)' }}>
                    {formatDelta(delta, isProb)} vs baseline
                  </p>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {Object.entries(inputs).slice(0, 8).map(([k, v]) => {
                    const changed = baselineInputs && String(baselineInputs[k]) !== String(v)
                    return (
                      <div id={`whatif-current-row-${kebab(k)}`} {...explainAttrs({ id: `whatif-current-row-${kebab(k)}`, title: `Current Row: ${k}`, type: 'compare-row', featureName: k, baselineValue: String(baselineInputs?.[k]), currentValue: String(v), isChanged: changed })} key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', color: changed ? 'var(--color-accent, #f97316)' : 'var(--color-text-secondary)', fontWeight: changed ? 700 : 400 }}>{formatScenarioCompareValue(v, featureByName(features, k))}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Saved Scenarios Card */}
        <div id="whatif-saved-scenarios-card" {...explainAttrs({ id: 'whatif-saved-scenarios-card', title: 'Saved Scenarios Card', type: 'saved-scenarios-card' })} className="ax-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span id="whatif-saved-scenarios-header" {...explainAttrs({ id: 'whatif-saved-scenarios-header', title: 'Saved Scenarios Header', type: 'saved-scenarios-card' })} style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Saved scenarios</span>
            <span id="whatif-saved-scenarios-count" {...explainAttrs({ id: 'whatif-saved-scenarios-count', title: 'Saved Scenarios Count', type: 'saved-scenarios-card' })} style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{scenarios.length} saved</span>
          </div>
          {scenarios.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', fontStyle: 'italic', margin: 0, textAlign: 'center', padding: '12px 0' }}>
              No scenarios saved yet — adjust values and click Save
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {scenarios.map((s, i) => {
                const sDelta = baseline ? s.prediction.prediction - baseline.prediction : null
                return (
                  <div
                    key={i}
                    id="whatif-saved-scenario-row"
                    {...explainAttrs({ id: 'whatif-saved-scenario-row', title: `Saved Scenario Row: ${s.name}`, type: 'saved-scenario-row', scenarioName: s.name, prediction: formatPrediction(s.prediction), differenceText: formatDelta(sDelta, isProb) }, '', true)}
                    onClick={() => loadScenario(s)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12, background: selectedScenarioName === s.name ? 'var(--color-accent-light, #fff7ed)' : 'transparent' }}
                    onMouseEnter={(e) => { if (selectedScenarioName !== s.name) e.currentTarget.style.background = 'var(--color-background-secondary)' }}
                    onMouseLeave={(e) => { if (selectedScenarioName !== s.name) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span id="whatif-saved-scenario-name" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    <span id="whatif-saved-scenario-prediction" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-text-primary)' }}>{formatPrediction(s.prediction)}</span>
                    {sDelta !== null && (
                      <span id="whatif-saved-scenario-difference" style={{ fontSize: 11, color: sDelta > 0 ? 'var(--color-text-success, #16a34a)' : sDelta < 0 ? 'var(--color-text-danger, #dc2626)' : 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                        {formatDelta(sDelta, isProb)}
                      </span>
                    )}
                    <button
                      id="whatif-saved-scenario-delete"
                      {...explainAttrs({ id: 'whatif-saved-scenario-delete', title: 'Delete Saved Scenario', type: 'saved-scenario-delete', scenarioName: s.name }, '', true)}
                      onClick={(e) => { e.stopPropagation(); deleteScenario(i) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
                      title="Delete scenario"
                    >×</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {explainPopup && (
        <WhatIfExplainPopup
          datasetId={dataset.id}
          element={explainPopup}
          onClose={() => setExplainPopup(null)}
          context={{
            modelFull,
            inputs,
            pred,
            baseline,
            extrapolation,
            scenarios,
            pctPosition,
            categoricalFeatures,
            numericFeatures,
            scenarioName,
          }}
        />
      )}
    </div>
  )
}

/* ─── Sub-components ─── */

function FeatureGroup({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 8 }}>
        {label}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  )
}

function CategoricalPill({ feature, value, onChange, explainAttrs }) {
  return (
    <div>
      <span
        id={`whatif-feature-${feature.name}`}
        {...explainAttrs({ id: `whatif-feature-${feature.name}`, title: `${feature.name} label`, type: 'categorical-label', featureName: feature.name })}
        style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', display: 'block', marginBottom: 4 }}
      >
        {feature.name}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {(feature.values || []).map((v) => {
          const active = String(value) === String(v)
          const optionId = `whatif-feature-${feature.name}-option-${kebab(v)}`
          return (
            <button
              key={v}
              id={optionId}
              {...explainAttrs({ id: optionId, title: `${feature.name} option: ${v}`, type: 'categorical-chip', featureName: feature.name, optionValue: v, isActive: active }, '', true)}
              onClick={() => onChange(v)}
              style={{
                padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: active ? 700 : 500, cursor: 'pointer',
                border: active ? 'none' : '1.5px solid var(--color-border-tertiary)',
                background: active ? 'var(--color-accent, #f97316)' : 'transparent',
                color: active ? '#fff' : 'var(--color-text-secondary)',
                transition: 'all 0.15s ease'
              }}
            >{v}</button>
          )
        })}
      </div>
    </div>
  )
}

function NumericSlider({ feature, value, onChange, explainAttrs }) {
  const integerFeature = isIntegerFeature(feature)
  const numericVal = Number(value ?? defaultNumericFeatureValue(feature))
  const min = Number(feature.min)
  const max = Number(feature.max)
  const mean = Number(feature.mean)
  const step = integerFeature ? 1 : Number(feature.step) || Math.max((max - min) / 200, 0.01)
  const deltaFromMean = numericVal - mean

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span
          id={`whatif-feature-${feature.name}`}
          {...explainAttrs({ id: `whatif-feature-${feature.name}`, title: `${feature.name} label`, type: 'numeric-label', featureName: feature.name })}
          style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}
        >
          {feature.name}
        </span>
        <input
          id={`whatif-feature-${feature.name}-input`}
          {...explainAttrs({ id: `whatif-feature-${feature.name}-input`, title: `${feature.name} input`, type: 'numeric-input', featureName: feature.name, currentValue: numericVal }, '', true)}
          type="number"
          value={Number.isFinite(numericVal) ? formatFeatureValue(feature, numericVal) : ''}
          step={step}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') { onChange(''); return }
            const next = normalizeNumericFeatureValue(feature, raw)
            if (Number.isFinite(next)) onChange(next)
          }}
          style={{ width: 64, fontSize: 11, fontFamily: 'var(--font-mono)', textAlign: 'right', padding: '2px 4px', border: '1px solid var(--color-border-tertiary)', borderRadius: 4 }}
        />
      </div>
      {/* Slider track with mean marker */}
      <div style={{ position: 'relative', height: 24, marginTop: 2 }}>
        <input
          id={`whatif-feature-${feature.name}-slider`}
          {...explainAttrs({ id: `whatif-feature-${feature.name}-slider`, title: `${feature.name} slider`, type: 'numeric-slider', featureName: feature.name, currentValue: numericVal, min, max, mean }, '', true)}
          type="range"
          min={min}
          max={max}
          step={step}
          value={clamp(numericVal, min, max)}
          onChange={(e) => onChange(normalizeNumericFeatureValue(feature, e.target.value))}
          style={{ width: '100%', height: 24, cursor: 'pointer', accentColor: 'var(--color-accent, #f97316)' }}
        />
        {/* Mean tick marker */}
        {max > min && (
          <div style={{ position: 'absolute', top: 0, left: `${((mean - min) / (max - min)) * 100}%`, width: 1, height: 24, background: 'var(--color-text-tertiary)', pointerEvents: 'none', opacity: 0.5 }} />
        )}
      </div>
      {/* Min / Max labels */}
      <div
        id={`whatif-feature-${feature.name}-range`}
        {...explainAttrs({ id: `whatif-feature-${feature.name}-range`, title: `${feature.name} dataset range`, type: 'numeric-range', featureName: feature.name, currentValue: numericVal, min, max })}
        style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: -2 }}
      >
        <span>{formatFeatureValue(feature, min)}</span>
        <span>{formatFeatureValue(feature, max)}</span>
      </div>
      {/* Change from mean indicator */}
      <div
        id={`whatif-feature-${feature.name}-from-mean`}
        {...explainAttrs({ id: `whatif-feature-${feature.name}-from-mean`, title: `${feature.name} from mean`, type: 'numeric-from-mean', featureName: feature.name, fromMeanText: Math.abs(deltaFromMean) < step ? 'at mean' : `${deltaFromMean > 0 ? '+' : ''}${fmt(deltaFromMean)}`, mean, currentValue: numericVal })}
        style={{ fontSize: 11, marginTop: 2 }}
      >
        {Math.abs(deltaFromMean) < step ? (
          <span style={{ color: 'var(--color-text-tertiary)' }}>At mean</span>
        ) : (
          <span style={{ color: deltaFromMean > 0 ? 'var(--color-text-success, #16a34a)' : 'var(--color-text-danger, #dc2626)' }}>
            {deltaFromMean > 0 ? '+' : ''}{fmt(deltaFromMean)} from mean ({fmt(mean)})
          </span>
        )}
      </div>
    </div>
  )
}

function NoModelView({ availableModels, setFallbackModel, dialog, onGo }) {
  const usableModels = (availableModels || []).filter(Boolean)
  return (
    <div className="ax-whatif-empty-page">
      <div className="ax-whatif-empty-shell">
        <div className="ax-whatif-empty-card">
          <div className="ax-whatif-empty-icon">
            <SlidersHorizontal size={24} />
          </div>
          <span className="ax-whatif-empty-kicker">What-if</span>
          <h2>Train a model before running scenarios</h2>
          <p>
            What-if needs a trained model so SimuCast can calculate how changed inputs affect the prediction.
            Start in Models, then return here to test scenarios.
          </p>
          <div className="ax-whatif-empty-steps" aria-label="What-if setup steps">
            <div>
              <LineChart size={15} />
              <span>Train a prediction model</span>
            </div>
            <div>
              <Sparkles size={15} />
              <span>Choose a supported result</span>
            </div>
            <div>
              <SlidersHorizontal size={15} />
              <span>Adjust inputs and compare outcomes</span>
            </div>
          </div>
          <div className="ax-whatif-empty-actions">
            <button type="button" className="ax-btn ax-primary" onClick={() => onGo?.('models')}>
              Open Models setup <ArrowRight size={15} />
            </button>
          </div>
        </div>

        {usableModels.length > 0 && (
          <div className="ax-whatif-empty-models">
            <div className="ax-whatif-empty-models-head">
              <span>Available trained models</span>
              <em>{usableModels.length} found</em>
            </div>
            <div className="ax-whatif-empty-model-list">
              {usableModels.slice(0, 5).map((model) => (
                <div key={model.id} className="ax-whatif-empty-model-row">
                  <div>
                    <strong>{formatWhatIfModelLabel(model)}</strong>
                    <span>{formatModelAlgorithmLabel(model.algorithm || model.name)} model</span>
                  </div>
                  <button className="ax-btn" onClick={async () => {
                    try {
                      if (!model.has_whatif) await api.prepareModelForWhatIf(model.id)
                      setFallbackModel({ ...model, has_whatif: true })
                    } catch (err) {
                      await dialog.alert({ title: 'Could Not Prepare Model', message: err.message, variant: 'danger' })
                    }
                  }}>
                    Use
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Helpers ─── */

async function hydrateCurrentCategoryValues(datasetId, features) {
  if (!datasetId) return features
  return Promise.all(
    (features || []).map(async (feature) => {
      if (feature.kind !== 'categorical') return feature
      try {
        const stats = await api.columnStats(datasetId, feature.name)
        const values = (stats.value_counts || []).map((item) => String(item.value))
        if (!values.length) return feature
        return { ...feature, values, default: values.includes(feature.default) ? feature.default : values[0] }
      } catch { return feature }
    }),
  )
}

function computeExtrapolation(inputs, features) {
  const details = []
  for (const f of features || []) {
    if (f.kind === 'categorical') continue
    const value = Number(inputs[f.name])
    const lo = Number(f.min)
    const hi = Number(f.max)
    if (![value, lo, hi].every(Number.isFinite)) continue
    const span = Math.max(hi - lo, Math.abs(hi), Math.abs(lo), 1)
    let distance = 0, direction = '', boundary = null
    if (value < lo) { distance = lo - value; direction = 'below'; boundary = lo }
    else if (value > hi) { distance = value - hi; direction = 'above'; boundary = hi }
    if (!distance) continue
    details.push({ feature: f.name, value, min: lo, max: hi, distance, direction, boundary, deviation_ratio: distance / span, risk: distance / span <= 0.1 ? 'medium' : 'high' })
  }
  const overall = details.some((d) => d.risk === 'high') ? 'high' : details.length ? 'medium' : 'low'
  return { overall_risk: overall, out_of_range_features: details.map((d) => d.feature), details }
}

function featureByName(features, name) {
  return (features || []).find((feature) => feature.name === name) || null
}

function isIntegerFeature(feature) {
  if (!feature || feature.kind === 'categorical') return false
  if (feature.dtype === 'int' || feature.display_dtype === 'int' || feature.is_integer === true) return true
  const min = Number(feature.min)
  const max = Number(feature.max)
  const step = Number(feature.step)
  return Number.isInteger(min) && Number.isInteger(max) && (!Number.isFinite(step) || step >= 1)
}

function normalizeNumericFeatureValue(feature, value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return n
  return isIntegerFeature(feature) ? Math.round(n) : n
}

function defaultNumericFeatureValue(feature) {
  const fallback = feature?.default ?? feature?.mean ?? feature?.min ?? 0
  return normalizeNumericFeatureValue(feature, fallback)
}

function formatFeatureValue(feature, value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return isIntegerFeature(feature) ? String(Math.round(n)) : fmt(n)
}

function normalizeInputsForFeatures(inputs, features) {
  const next = { ...(inputs || {}) }
  for (const feature of features || []) {
    if (!feature || feature.kind === 'categorical' || !(feature.name in next) || next[feature.name] === '') continue
    next[feature.name] = normalizeNumericFeatureValue(feature, next[feature.name])
  }
  return next
}

function riskStyle(risk) {
  if (risk === 'high') return { bg: '#FEF2F2', fg: '#991B1B', border: '#FECACA' }
  if (risk === 'medium') return { bg: '#FFFBEB', fg: '#92400E', border: '#FDE68A' }
  return { bg: '#F0FDF4', fg: '#166534', border: '#BBF7D0' }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

function fmt(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(2)
}

function formatPrediction(prediction) {
  if (!prediction) return '-'
  return prediction.kind === 'probability' ? `${Math.round(prediction.prediction * 100)}%` : fmt(prediction.prediction)
}

function formatDelta(delta, isProb) {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return '-'
  const sign = delta > 0 ? '+' : ''
  return isProb ? `${sign}${Math.round(delta * 100)} pts` : `${sign}${fmt(delta)}`
}

function formatScenarioCompareValue(value, feature = null) {
  if (feature && isIntegerFeature(feature)) return formatFeatureValue(feature, value)
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : '-'
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value).toFixed(2)
  return String(value ?? '-')
}

function buildWhatIfResultInterpretation({ current, baseline, target, isProb }) {
  const currentNum = Number(current)
  const baselineNum = Number(baseline)
  const targetLabel = target || 'prediction'
  if (!Number.isFinite(currentNum) || !Number.isFinite(baselineNum)) {
    return {
      tone: 'equal',
      percent: 0,
      badge: '0.0% vs baseline',
      summary: 'The current inputs match the dataset average. No significant change from baseline.',
    }
  }

  const diff = currentNum - baselineNum
  const equal = Math.abs(diff) < 1e-9
  const denominator = Math.abs(baselineNum)
  const percent = denominator > 1e-9 ? (diff / denominator) * 100 : 0
  const absPercent = Math.abs(percent)
  const baselineText = isProb ? `${Math.round(baselineNum * 100)}%` : fmt(baselineNum)
  const direction = diff > 0 ? 'above' : diff < 0 ? 'below' : 'vs'
  const tone = equal ? 'equal' : diff > 0 ? 'above' : 'below'
  const badge = equal
    ? '0.0% vs baseline'
    : `${diff > 0 ? '+' : '-'}${absPercent.toFixed(1)}% ${direction} baseline`

  let summary = 'The prediction is close to the baseline average. The current inputs produce a typical result.'
  if (equal) {
    summary = 'The current inputs match the dataset average. No significant change from baseline.'
  } else if (absPercent > 10 && diff > 0) {
    summary = `The predicted ${targetLabel} is ${absPercent.toFixed(1)}% above the baseline average of ${baselineText}. This combination of inputs pushes the prediction higher than typical.`
  } else if (absPercent > 10 && diff < 0) {
    summary = `The predicted ${targetLabel} is ${absPercent.toFixed(1)}% below the baseline average of ${baselineText}. This combination of inputs results in a lower-than-average prediction.`
  }

  return { tone, percent, badge, summary }
}

function makeWhatIfResultFallback(payload) {
  const target = payload?.target || 'the target'
  const current = fmt(payload?.currentPrediction)
  const baseline = fmt(payload?.baselinePrediction)
  const diff = Number(payload?.difference || 0)
  const changed = Object.entries(payload?.inputs || {})
    .filter(([key, value]) => String(payload?.baselineInputs?.[key]) !== String(value))
    .slice(0, 3)
    .map(([key, value]) => `${key} = ${formatScenarioCompareValue(value)}`)
  const driverText = changed.length
    ? `The main changed inputs are ${changed.join(', ')}. These are the values most likely influencing the new prediction.`
    : 'The inputs are close to the baseline profile, so the prediction remains near the average.'
  const directionText = diff > 0
    ? `Changing these inputs can help test what lowers ${target} back toward the baseline.`
    : diff < 0
      ? `Moving the changed inputs back toward their baseline values may raise ${target} closer to the average.`
      : `To change ${target}, adjust one or more feature values away from the baseline profile.`
  return `${driverText} The current prediction is ${current} compared with a baseline of ${baseline}. ${directionText}`
}

/* ─── Explain Mode Helpers ─── */

function WhatIfExplainPopup({ datasetId, element, onClose, context }) {
  const [aiText, setAiText] = useState(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('normal')
  const [followUpInput, setFollowUpInput] = useState('')
  const [followUpLoading, setFollowUpLoading] = useState(false)
  const [position, setPosition] = useState(() => getWhatIfExplainPosition(getLiveWhatIfExplainRect(element)))

  const title = element?.title || 'What-if'
  const fallbackDatasetExplanation = cleanWhatIfExplainText(element?.datasetExplanation, 'This is part of the What-if workflow.')
  const simple = element?.simple || ''
  const whyItMatters = element?.whyItMatters || ''
  const verdict = element?.verdict || ''
  const verdictTone = element?.verdictTone || 'good'

  useEffect(() => {
    const updatePosition = () => setPosition(getWhatIfExplainPosition(getLiveWhatIfExplainRect(element)))
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [element?.sourceEl, element?.sourceRect, element?.id, element?.type, element?.title])

  const fetchAI = async (variant = 'normal') => {
    if (!datasetId || !element) return
    setLoading(true)
    try {
      const question = variant === 'simple'
        ? `Explain this What-if page element in very simple terms, one or two sentences: ${title}.`
        : variant === 'technical'
          ? `Give concise technical details for this What-if page element: ${title}.`
          : `Explain this What-if page element in plain language for a student using SimuCast: ${title}. Include what it means, how it applies to the current scenario, why it matters, and a recommendation.`
      const payload = {
        title,
        type: element.type,
        context,
        fallbackDatasetExplanation,
        fallbackVerdict: verdict,
      }
      const response = await api.aiExplain(datasetId, `whatif-${element.id}-${variant}`, payload, question, { element: payload })
      setAiText(cleanWhatIfExplainText(response?.explanation, fallbackDatasetExplanation))
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
        context,
        previousExplanation: aiText || fallbackDatasetExplanation,
      }
      const response = await api.aiExplain(datasetId, `whatif-${element.id}-followup`, payload, followUpInput, { element: payload })
      setAiText(cleanWhatIfExplainText(response?.explanation, fallbackDatasetExplanation))
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
  }, [element?.id, datasetId])

  useEffect(() => {
    const handleOutsideClick = (event) => {
      const popupEl = document.querySelector('.ax-expand-explain-popup')
      if (popupEl && !popupEl.contains(event.target)) {
        if (!event.target.closest('.ax-explain-mode-toggle') && !event.target.closest('.ax-explain-selectable')) {
          onClose()
        }
      }
    }
    document.addEventListener('mousedown', handleOutsideClick, true)
    return () => document.removeEventListener('mousedown', handleOutsideClick, true)
  }, [onClose])

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
          <span>In your scenario</span>
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
          <span>Verdict</span>
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

function getWhatIfExplainPosition(sourceRect) {
  const popupW = 374
  const gap = 8
  const padding = 12
  const viewportW = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportH = typeof window === 'undefined' ? 720 : window.innerHeight
  const popupH = Math.max(280, Math.min(560, viewportH - (padding * 2)))
  const anchor = normalizeWhatIfExplainRect(sourceRect)
  if (!anchor) {
    return { top: 84, left: padding, placement: 'right-start', arrowTop: 24, arrowLeft: -6, maxHeight: popupH }
  }

  const placements = anchor.bottom > viewportH * 0.68
    ? ['top-start', 'right-start', 'left-start', 'bottom-start']
    : ['right-start', 'left-start', 'bottom-start', 'top-start']
  for (const placement of placements) {
    const candidate = buildWhatIfExplainCandidate(placement, anchor, popupW, popupH, gap, padding, viewportW, viewportH)
    if (!whatIfRectsOverlap(candidate.rect, anchor)) return candidate
  }

  const rightSpace = viewportW - anchor.right - gap - padding
  const leftSpace = anchor.left - gap - padding
  const fallbackPlacement = rightSpace >= leftSpace ? 'right-start' : 'left-start'
  return buildWhatIfExplainCandidate(fallbackPlacement, anchor, popupW, popupH, gap, padding, viewportW, viewportH)
}

function buildWhatIfExplainCandidate(placement, anchor, popupW, popupH, gap, padding, viewportW, viewportH) {
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

  left = whatIfClamp(left, padding, Math.max(padding, viewportW - popupW - padding))
  top = whatIfClamp(top, padding, Math.max(padding, viewportH - popupH - padding))

  const rect = { left, top, right: left + popupW, bottom: top + popupH }
  const arrow = getWhatIfExplainArrowPosition(placement, anchor, rect, popupW, popupH)
  return { top, left, placement, rect, maxHeight: popupH, ...arrow }
}

function getLiveWhatIfExplainRect(element) {
  if (element?.sourceEl?.isConnected && typeof element.sourceEl.getBoundingClientRect === 'function') {
    return element.sourceEl.getBoundingClientRect()
  }
  return element?.sourceRect || null
}

function getWhatIfExplainArrowPosition(placement, anchor, popup, popupW, popupH) {
  if (placement === 'right-start' || placement === 'left-start') {
    return {
      arrowLeft: placement === 'right-start' ? -6 : popupW - 6,
      arrowTop: whatIfClamp(anchor.top + Math.min(anchor.height / 2, 20) - popup.top, 18, popupH - 18),
    }
  }
  return {
    arrowLeft: whatIfClamp(anchor.left + Math.min(anchor.width / 2, 30) - popup.left, 18, popupW - 18),
    arrowTop: placement === 'bottom-start' ? -6 : popupH - 6,
  }
}

function normalizeWhatIfExplainRect(rect) {
  if (!rect) return null
  const left = Number(rect.left)
  const top = Number(rect.top)
  const width = Number(rect.width || rect.right - rect.left)
  const height = Number(rect.height || rect.bottom - rect.top)
  if (![left, top, width, height].every(Number.isFinite)) return null
  return { left, top, width, height, right: left + width, bottom: top + height }
}

function whatIfRectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function whatIfClamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function cleanWhatIfExplainText(text, fallback) {
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

function buildWhatIfExplainMeta(meta, context) {
  const modelName = context.modelFull?.name || context.modelFull?.algorithm || 'Selected Model'
  const target = context.modelFull?.target || 'target_variable'
  const isClassification = context.pred?.kind === 'probability' || context.modelFull?.target_context?.task === 'classification' || target === 'pass'
  const algorithm = context.modelFull?.algorithm || 'Algorithm'
  const prediction = context.pred ? (isClassification ? `${Math.round(context.pred.prediction * 100)}%` : fmt(context.pred.prediction)) : '-'
  const baseline = context.baseline ? (isClassification ? `${Math.round(context.baseline.prediction * 100)}%` : fmt(context.baseline.prediction)) : '-'
  const deltaVal = context.pred && context.baseline ? context.pred.prediction - context.baseline.prediction : null
  const differenceText = formatDelta(deltaVal, isClassification)
  const riskLevel = context.extrapolation?.overall_risk || 'low'
  const extrapolationText = context.extrapolation?.out_of_range_features?.length > 0
    ? `The following inputs are outside the training range: ${context.extrapolation.out_of_range_features.join(', ')}.`
    : 'All current input values lie within the training dataset boundaries.'
  const rangeMin = fmt(context.modelFull?.target_context?.min ?? 0)
  const rangeMax = fmt(context.modelFull?.target_context?.max ?? 100)
  const pctPosition = Math.round(context.pctPosition || 50)
  const scenariosCount = context.scenarios?.length || 0

  const catFeatureNames = context.categoricalFeatures?.map(f => f.name).join(', ') || 'categorical features'
  const numFeatureNames = context.numericFeatures?.map(f => f.name).join(', ') || 'numeric features'

  let title = meta.title || 'What-if element'
  let simple = 'This is part of the What-if scenario analysis.'
  let datasetExplanation = 'Adjust parameters to simulate predictions.'
  let whyItMatters = 'Understanding model response to inputs is key to validating predictive logic.'
  let verdict = 'No recommendation available.'
  let verdictTone = 'good'

  switch (meta.type) {
    case 'page-header':
      title = 'What-if Scenario'
      simple = 'The What-if page lets you simulate alternative scenarios by adjusting input features and seeing how the trained model\'s predictions shift.'
      datasetExplanation = `You are currently simulating outcomes using the "${modelName}" model predicting the target variable "${target}".`
      whyItMatters = 'What-if analysis helps you understand how different inputs affect outcomes, allowing you to test scenarios and find optimal configurations.'
      verdict = 'Use this simulation for exploration. Remember it shows model predictions, not guaranteed causal real-world outcomes.'
      break

    case 'page-subtitle':
      title = 'What-if Instructions'
      simple = 'This guidance text explains how to interact with the sliders and chips in the left settings panel to customize the simulated scenario.'
      datasetExplanation = 'Changing feature values updates inputs in real-time, which recalculates the prediction showing what the model expects for that combination.'
      whyItMatters = 'It guides the user to adjust inputs and evaluate output changes.'
      verdict = 'Follow the sidebar to systematically change variables and observe prediction changes.'
      break

    case 'model-card':
      title = 'Model in Use'
      simple = 'This shows the active machine learning model that is calculating the predictions for your what-if scenarios.'
      datasetExplanation = `The active model is "${modelName}", trained to predict the target variable "${target}" using the "${algorithm}" algorithm.`
      whyItMatters = 'Different models make different assumptions and have different split thresholds, leading to different predictions for the same inputs.'
      verdict = 'Verify that you are using the correct model for your target variable before interpreting predictions.'
      break

    case 'model-dropdown':
      title = 'Model Selector'
      simple = 'Allows you to switch between different trained models that support What-if analysis.'
      datasetExplanation = `Currently selecting "${modelName}". Choosing a different model will reload its features, ranges, and predictions.`
      whyItMatters = 'Comparing predictions across different model architectures helps validate the robustness of your scenario insights.'
      verdict = 'Click to select a different trained model if you want to see how a different algorithm evaluates these inputs.'
      break

    case 'model-target':
      title = 'Target Variable'
      simple = 'The specific column or outcome that this model was trained to predict.'
      datasetExplanation = `The target variable is "${target}". The model predicts ${isClassification ? 'the likelihood (probability) of this category occurring' : 'the expected numeric value of this score'}.`
      whyItMatters = 'All scenario inputs are mapped to this specific prediction target.'
      verdict = 'Ensure this target matches the business or research question you want to answer.'
      break

    case 'model-algorithm':
      title = 'Model Algorithm'
      simple = 'The underlying machine learning algorithm (e.g., Tree-based, Linear, etc.) used to train the active model.'
      datasetExplanation = `This model was trained using the "${algorithm}" algorithm.`
      whyItMatters = 'Algorithms like decision trees change predictions in steps (thresholds), while linear models change continuously.'
      verdict = 'Tree models can be sensitive to small changes around learned split thresholds.'
      break

    case 'categorical-section':
      title = 'Categorical Features'
      simple = 'Features that represent distinct groups or categories rather than continuous numbers.'
      datasetExplanation = `Categories in this model include: ${catFeatureNames}.`
      whyItMatters = 'Categorical variables specify discrete attributes of your scenario profile.'
      verdict = 'Adjust category selections to represent different profiles or demographic scenarios.'
      break

    case 'categorical-chip':
      title = `Categorical Option: ${meta.featureName}`
      simple = `Specifies the value of the categorical feature "${meta.featureName}".`
      datasetExplanation = `For the feature "${meta.featureName}", the value chosen in this option chip is "${meta.optionValue}". This is ${meta.isActive ? 'currently the active value in your scenario' : 'currently inactive'}.`
      whyItMatters = 'Changing categories changes the subpopulation the model references, shifting its predicted output.'
      verdict = meta.isActive
        ? 'This option is currently active in the scenario.'
        : `Click this chip to test the alternative scenario with "${meta.optionValue}".`
      break

    case 'numeric-section':
      title = 'Numeric Features'
      simple = 'Continuous numerical inputs that can be adjusted within a range (e.g., scores, ages).'
      datasetExplanation = `Numeric features in this model include: ${numFeatureNames}.`
      whyItMatters = 'Adjusting numeric values lets you test scale effects and sensitivity thresholds.'
      verdict = 'Slide or type values to see continuous or step prediction changes.'
      break

    case 'numeric-label':
      title = `${meta.featureName} Label`
      simple = `The name of the numeric variable "${meta.featureName}".`
      datasetExplanation = `Allows adjusting the numeric input profile for "${meta.featureName}".`
      whyItMatters = 'Numeric values represent continuous dimensions of the simulated profile.'
      verdict = 'Interpret the prediction changes as you adjust this value.'
      break

    case 'numeric-slider':
      title = `${meta.featureName} Slider`
      simple = `Drag to continuously adjust the scenario value for "${meta.featureName}" between its minimum (${fmt(meta.min)}) and maximum (${fmt(meta.max)}).`
      datasetExplanation = `Currently set to ${fmt(meta.currentValue)}. The training dataset average (mean) is ${fmt(meta.mean)}.`
      whyItMatters = 'Interactive sliders provide an easy way to sweep across values and find threshold transitions.'
      verdict = `Move the slider to explore the sensitivity of the prediction to ${meta.featureName}.`
      break

    case 'numeric-input':
      title = `${meta.featureName} Input`
      simple = `Allows entering an exact numeric value for "${meta.featureName}".`
      datasetExplanation = `Current input value is ${fmt(meta.currentValue)}.`
      whyItMatters = 'Precise text entry is useful for validating specific scenario cases or inputting values outside the slider bounds.'
      verdict = 'Type a specific value to test precise scenarios.'
      break

    case 'numeric-range':
      title = `${meta.featureName} Dataset Range`
      simple = `Shows the minimum (${fmt(meta.min)}) and maximum (${fmt(meta.max)}) values observed in the training dataset for this feature.`
      datasetExplanation = `Your current scenario value is ${fmt(meta.currentValue)}.`
      whyItMatters = 'Inputs outside this range represent extrapolation, which increases model prediction risk.'
      verdict = 'Keep inputs within range for more reliable model predictions.'
      break

    case 'numeric-from-mean':
      title = `${meta.featureName} Distance from Mean`
      simple = `Shows how far the current scenario value is from the dataset average (${fmt(meta.mean)}).`
      datasetExplanation = `The current value is ${meta.fromMeanText} from the mean of ${fmt(meta.mean)}.`
      whyItMatters = 'The closer inputs are to the mean, the more training data the model had, and the lower the prediction risk.'
      verdict = 'Large deviations from the mean should be interpreted with caution.'
      break

    case 'reset-to-mean':
      title = 'Reset to Mean'
      simple = 'Resets all numeric inputs to their dataset averages and categorical features to their default classes.'
      datasetExplanation = 'A quick way to start over from a neutral, representative baseline scenario.'
      whyItMatters = 'Clears adjustments so you can build a new scenario from a clean average state.'
      verdict = 'Click to return all sliders and categorical selections to average/default values.'
      break

    case 'scenario-name-input':
      title = 'Scenario Name'
      simple = 'Input box to label your current combination of features before saving.'
      datasetExplanation = `Current typed label is "${meta.currentText || ''}".`
      whyItMatters = 'Naming scenarios helps organize comparisons in the report or saved lists.'
      verdict = 'Give your scenario a descriptive name (e.g. "High Reading / Free Lunch").'
      break

    case 'save-scenario':
      title = 'Save Scenario'
      simple = 'Saves the current scenario (name, inputs, and prediction) to your saved list.'
      datasetExplanation = `Saving stores this profile with its current prediction of ${prediction}.`
      whyItMatters = 'Saved scenarios are preserved and can be compared side-by-side or included in the final Report page.'
      verdict = 'Save your scenario to compare it with other runs.'
      break

    case 'prediction-card':
      title = 'Prediction Result Card'
      simple = 'Summarizes the active model\'s prediction for the current scenario inputs.'
      datasetExplanation = `Current prediction is ${prediction} (baseline: ${baseline}).`
      whyItMatters = 'This is the primary output card showing the simulation results.'
      verdict = 'Review how inputs shift the prediction compared to baseline.'
      break

    case 'prediction-header':
      title = `Prediction Target: ${target}`
      simple = 'The name of the variable the model is predicting.'
      datasetExplanation = `Currently predicting "${target}".`
      whyItMatters = 'Specifies what outcome metric the prediction values represent.'
      verdict = 'Ensure this aligns with your goals.'
      break

    case 'explain-button':
      title = 'Scenario AI Explainer'
      simple = 'Generates a full text explanation from the AI explaining how the input changes drove the prediction shift.'
      datasetExplanation = `Generates explanation for the active prediction of ${prediction}.`
      whyItMatters = 'Provides natural language reasoning instead of just raw numbers.'
      verdict = 'Click to get a detailed explanation of this scenario.'
      break

    case 'current-scenario-label':
      title = 'Current Scenario Label'
      simple = 'Labels the active inputs currently set on the sliders and chips.'
      datasetExplanation = 'Shows the prediction value calculated in real-time.'
      whyItMatters = 'Distinguishes the live scenario from the baseline or other saved scenarios.'
      verdict = 'This represents your active simulation.'
      break

    case 'current-prediction-value':
      title = 'Current Scenario Prediction'
      simple = 'The real-time output predicted by the model for the current inputs.'
      datasetExplanation = `Predicting ${prediction} (${isClassification ? 'probability' : 'score'}).`
      whyItMatters = 'This is the final calculated output of your what-if simulation.'
      verdict = 'Use this value to assess the hypothetical outcome.'
      break

    case 'difference-from-baseline':
      title = 'Difference from Baseline'
      simple = 'The difference between the current scenario prediction and the baseline average prediction.'
      datasetExplanation = `The current prediction is shifted by ${differenceText} compared to the baseline.`
      whyItMatters = 'Shows the net impact of your feature adjustments relative to the average starting point.'
      verdict = 'A positive or negative shift indicates the direction of impact.'
      break

    case 'baseline-panel':
      title = 'Baseline Prediction'
      simple = 'The model\'s prediction for a standard profile (usually using average/default values).'
      datasetExplanation = `Baseline value is ${baseline}.`
      whyItMatters = 'Serves as a control group or reference point to measure feature effects.'
      verdict = 'Compare your current scenario against this benchmark.'
      break

    case 'scenario-risk':
      title = 'Scenario Risk'
      simple = 'Assesses whether any input features are set outside the training data range (extrapolation).'
      datasetExplanation = `Risk level is "${riskLevel.toUpperCase()}". ${extrapolationText}`
      whyItMatters = 'High risk means the model is guessing on unfamiliar inputs, making predictions less reliable.'
      verdict = riskLevel === 'low'
        ? 'Reliable prediction — inputs are within bounds.'
        : 'Interpret with caution — inputs are outside normal bounds.'
      verdictTone = riskLevel === 'high' ? 'bad' : riskLevel === 'medium' ? 'warning' : 'good'
      break

    case 'dataset-range':
      title = 'Prediction Dataset Range'
      simple = 'The range of target values observed in the training dataset.'
      datasetExplanation = `Target values range from ${rangeMin} to ${rangeMax}.`
      whyItMatters = 'Places the predicted value in context (e.g. is 59 high or low?).'
      verdict = 'Provides a scale reference for predictions.'
      break

    case 'prediction-range-bar':
      title = 'Prediction Range Bar'
      simple = 'A visual axis showing where the baseline (gray marker) and current scenario prediction (orange bar) fall within the dataset bounds.'
      datasetExplanation = `Current prediction is at ${pctPosition}% of the range.`
      whyItMatters = 'Helps visualize the magnitude and position of prediction shifts.'
      verdict = 'View the gap between baseline and current marker to see the effect size.'
      break

    case 'tree-model-note':
      title = 'Model Splitting Note'
      simple = 'Explains that tree-based models make step-like predictions rather than smooth continuous changes.'
      datasetExplanation = `The model is a "${algorithm}" model.`
      whyItMatters = 'You might slide a feature quite a bit with no change in prediction, and then see a sudden jump as it crosses a learned threshold.'
      verdict = 'Keep this step-like behavior in mind when analyzing sensitivity.'
      break

    case 'scenario-compare-card':
      title = 'Scenario Compare Table'
      simple = 'Side-by-side comparison table of feature values and predictions for the baseline vs. the current scenario.'
      datasetExplanation = `Compares baseline (predicting ${baseline}) vs. current inputs (predicting ${prediction}).`
      whyItMatters = 'Clearly maps input changes to prediction changes.'
      verdict = 'Use this table to inspect which exact variables were modified.'
      break

    case 'compare-row':
      title = `Compare Row: ${meta.featureName}`
      simple = `Compares the value of "${meta.featureName}" between baseline and current scenario.`
      datasetExplanation = `Baseline is ${meta.baselineValue}, current is ${meta.currentValue} (${meta.isChanged ? 'changed' : 'unchanged'}).`
      whyItMatters = 'Highlighted values in orange indicate features that differ from the baseline, helping identify potential drivers of prediction shifts.'
      verdict = 'Even unchanged values are important because the model evaluates the entire profile together.'
      break

    case 'saved-scenarios-card':
      title = 'Saved Scenarios List'
      simple = 'A list of scenario profiles you have saved for side-by-side comparison.'
      datasetExplanation = `You have ${scenariosCount} saved scenario${scenariosCount === 1 ? '' : 's'}.`
      whyItMatters = 'Lets you save and contrast multiple hypothetical profiles.'
      verdict = 'Compare different what-if profiles side-by-side.'
      break

    case 'saved-scenario-row':
      title = `Saved Scenario: ${meta.scenarioName}`
      simple = 'A stored scenario profile.'
      datasetExplanation = `Named "${meta.scenarioName}", predicting ${meta.prediction} (${meta.differenceText} from baseline).`
      whyItMatters = 'Clicking a saved scenario reloads its inputs to the settings panel.'
      verdict = 'Click a row to reload this scenario\'s values for editing.'
      break

    case 'saved-scenario-delete':
      title = 'Delete Saved Scenario'
      simple = 'Removes a saved scenario from the list.'
      datasetExplanation = `Deletes "${meta.scenarioName}".`
      whyItMatters = 'Cleaning up unwanted scenarios keeps your report uncluttered.'
      verdict = 'Click to remove this scenario from memory.'
      break

    case 'side-tab':
      title = meta.title || 'Panel Tab'
      simple = `Opens side rails for ${meta.title === 'History tab' ? 'previous actions history' : 'step-by-step coach walkthroughs'}.`
      datasetExplanation = 'Provides access to guidance or history without navigating away from the current workspace.'
      whyItMatters = 'Side tabs keep support available without taking you away from the What-if page.'
      verdict = meta.title === 'History tab' ? 'Use it to audit previous decisions.' : 'Use it when you need workflow guidance.'
      break

    case 'persistent-control':
      title = meta.title || 'Floating Helper'
      simple = meta.title === 'Dataset button'
        ? 'Opens the active dataset preview without leaving the What-if page.'
        : meta.title === 'Floating tools close button'
          ? 'Hides the floating utility pill.'
          : 'Opens the conversational assistant. This is different from Explain Mode.'
      datasetExplanation = meta.title === 'Dataset button'
        ? `Use this to inspect the active dataset.`
        : meta.title === 'Floating tools close button'
          ? 'It only hides the floating utility controls; it does not change scenarios.'
          : 'Ask AI can answer broader questions, while Explain Mode explains the exact UI element you click.'
      whyItMatters = 'These controls support the user workflow without changing the current page.'
      verdict = meta.title === 'Dataset button'
        ? 'Use it to verify the data behind the model.'
        : meta.title === 'Floating tools close button'
          ? 'Safe to use when the pill is in the way.'
          : 'Use Ask AI for broader follow-up questions.'
      break
  }

  // Regression-specific explanations
  if (!isClassification && target === 'math_score') {
    if (meta.type === 'current-prediction-value') {
      datasetExplanation = `For math_score, the predicted numeric score for the current input combination is ${prediction}.`
    } else if (meta.type === 'difference-from-baseline' && deltaVal === 0) {
      datasetExplanation = `A difference of ${differenceText} means the current inputs produce the same prediction as the baseline (math_score = ${prediction}).`
    } else if (meta.type === 'dataset-range') {
      datasetExplanation = `The dataset range of ${rangeMin} to ${rangeMax} provides context for whether the predicted score of ${prediction} is low, middle, or high.`
    }
  }

  // Classification-specific explanations
  if (isClassification && target === 'pass') {
    if (meta.type === 'current-prediction-value') {
      datasetExplanation = `For the "pass" variable, ${prediction} represents the model's predicted likelihood or score for the pass outcome.`
    } else if (meta.type === 'difference-from-baseline') {
      datasetExplanation = `A difference of ${differenceText} vs baseline indicates that the current scenario outcome likelihood is significantly ${deltaVal > 0 ? 'higher' : 'lower'} than the average student baseline.`
      verdict = 'Remember this is a predicted probability, not a guaranteed certainty.'
    }
  }

  return {
    ...meta,
    title,
    simple,
    datasetExplanation,
    whyItMatters,
    verdict,
    verdictTone,
  }
}
