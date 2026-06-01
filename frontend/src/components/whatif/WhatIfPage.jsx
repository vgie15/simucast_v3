/* ============================================================
 * PAGE: WHAT-IF / PREDICTION — 2-column side panel layout
 * Keywords: whatif, what-if, predict, prediction, scenario, simulation
 * ============================================================ */
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { api } from '../../api'
import { useDialog } from '../common/DialogProvider'
import { ExplainButton } from '../ai/AIExplainers'

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

export default function WhatIfPage({ dataset, activeModel, setActiveModel, initialData }) {
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
  const selectedModel = fallbackModel || activeModel

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
        init[f.name] = f.kind === 'categorical' ? (f.default || f.values?.[0] || '') : f.mean
      }
      setInputs(init)
      setPred(null)
      setBaseline(null)
      setBaselineInputs(null)
      setScenarios([])
    })
  }, [selectedModel?.id, dataset?.current_stage_id])

  useEffect(() => {
    if (!modelFull || !Object.keys(inputs).length) return
    // Skip prediction if we already have one for these exact inputs (restored from draft)
    if (pred && JSON.stringify(pred.inputs) === JSON.stringify(inputs)) return
    api.predict(modelFull.id, inputs).then((p) => {
      setPred(p)
      setBaseline((current) => {
        if (!current) setBaselineInputs({ ...inputs })
        return current || p
      })
    }).catch(console.error)
  }, [inputs, modelFull?.id])

  if (!dataset) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>
  if (!selectedModel) return <NoModelView availableModels={availableModels} setFallbackModel={setFallbackModel} dialog={dialog} />
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
    for (const f of features) init[f.name] = f.kind === 'categorical' ? (f.default || f.values?.[0] || '') : f.mean
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
  const activeModelName = modelFull.name || selectedModel?.name || modelFull.algorithm || 'Selected model'
  const activeModelAlgorithm = modelFull.algorithm || selectedModel?.algorithm || activeModelName
  const activeModelMetric = modelFull.metrics?.accuracy != null
    ? `${Math.round(modelFull.metrics.accuracy * 100)}% accuracy`
    : modelFull.metrics?.r2 != null
      ? `R² ${Number(modelFull.metrics.r2).toFixed(3)}`
      : modelFull.metrics?.rmse != null
        ? `RMSE ${Number(modelFull.metrics.rmse).toFixed(3)}`
        : null

  return (
    <div className="ax-whatif-layout">
      {/* ─── LEFT COLUMN ─── */}
      <div className="ax-whatif-left">
        {/* Header (pinned) */}
        <div className="ax-whatif-left-head">
          <h2 className="ax-whatif-left-title">What-if scenario</h2>
          <p className="ax-whatif-left-sub">
            Adjust feature values to see how they affect the prediction
          </p>
        </div>

        {/* Scrollable body */}
        <div className="ax-whatif-left-scroll">
          <div className="ax-whatif-model-card">
            <span>Model in use</span>
            <label className="ax-whatif-model-select-label" htmlFor="whatif-model-select">
              <select
                id="whatif-model-select"
                className="ax-whatif-model-select"
                value={selectedModel?.id || ''}
                onChange={(event) => switchModel(event.target.value)}
              >
                {availableModels.some((model) => String(model.id) === String(selectedModel?.id)) ? null : (
                  <option value={selectedModel?.id || ''}>{activeModelName}</option>
                )}
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {(model.name || model.algorithm || 'Model')} · {model.target || 'target'}
                  </option>
                ))}
              </select>
            </label>
            <dl>
              <div>
                <dt>Target</dt>
                <dd>{modelFull.target}</dd>
              </div>
              <div>
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
            <FeatureGroup label="Categorical features">
              {categoricalFeatures.map((f) => (
                <CategoricalPill key={f.name} feature={f} value={inputs[f.name]} onChange={(v) => setInputs({ ...inputs, [f.name]: v })} />
              ))}
            </FeatureGroup>
          )}
          {numericFeatures.length > 0 && (
            <FeatureGroup label="Numeric features">
              {numericFeatures.map((f) => (
                <NumericSlider key={f.name} feature={f} value={inputs[f.name]} onChange={(v) => setInputs({ ...inputs, [f.name]: v })} />
              ))}
            </FeatureGroup>
          )}
        </div>

        {/* Footer (pinned) */}
        <div className="ax-whatif-left-foot">
          <button className="ax-btn" onClick={resetToMean} style={{ fontSize: 11, whiteSpace: 'nowrap' }}>Reset to mean</button>
          <input
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            placeholder="Scenario name..."
            style={{ flex: 1, fontSize: 11, minWidth: 0 }}
          />
          <button className="ax-btn prim" onClick={saveScenario} disabled={!pred} style={{ fontSize: 11, whiteSpace: 'nowrap' }}>Save</button>
        </div>
      </div>

      {/* ─── RIGHT COLUMN ─── */}
      <div className="ax-whatif-main">
        {/* Prediction Result Card */}
        <div className="ax-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Prediction result — {modelFull.target}
              </span>
            </div>
            {pred && (
              <ExplainButton
                datasetId={dataset.id}
                step="whatif-prediction"
                params={{ target: modelFull.target, inputs, baseline_inputs: baselineInputs }}
                result={{ prediction: pred, baseline, delta, extrapolation }}
                question="Explain this scenario prediction in plain English: what changed from the baseline, why the prediction shifted, and how confident the user should be."
                label="Explain"
              />
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, marginBottom: 16 }}>
            {/* Current scenario */}
            <div>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Current scenario</span>
              <p style={{ fontSize: 40, fontWeight: 700, margin: '4px 0 2px', color: 'var(--color-text-primary)', lineHeight: 1.1 }}>
                {isProb ? `${Math.round(currentPred * 100)}%` : fmt(currentPred)}
              </p>
              {baseline && (
                <p style={{ fontSize: 12, margin: '4px 0 0', color: delta > 0 ? 'var(--color-text-success, #16a34a)' : delta < 0 ? 'var(--color-text-danger, #dc2626)' : 'var(--color-text-tertiary)' }}>
                  {formatDelta(delta, isProb)} vs baseline
                </p>
              )}
              <div style={{
                marginTop: 10, padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                background: riskTone.bg, color: riskTone.fg, border: `1px solid ${riskTone.border}`,
                display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%', boxSizing: 'border-box'
              }}>
                Scenario risk: {extrapolation.overall_risk.toUpperCase()}
                {extrapolation.out_of_range_features?.length > 0 ? ' — extrapolated inputs' : ' — all inputs within dataset range'}
              </div>
            </div>
            {/* Baseline */}
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Baseline</span>
              <p style={{ fontSize: 22, fontWeight: 500, margin: '4px 0 0', color: 'var(--color-text-secondary)' }}>
                {isProb ? `${Math.round(baselinePred * 100)}%` : fmt(baselinePred)}
              </p>
              <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>mean prediction</p>
            </div>
          </div>

          {/* Range gauge */}
          {targetContext && !isProb && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 6 }}>
                <span>Dataset range: {fmt(rangeMin)} – {fmt(rangeMax)}</span>
                <span style={{ color: 'var(--color-accent, #f97316)', fontWeight: 600 }}>{Math.round(pctPosition)}%</span>
              </div>
              <div style={{ position: 'relative', height: 28 }}>
                {/* Track */}
                <div style={{ position: 'absolute', top: 10, left: 0, right: 0, height: 8, background: 'var(--color-background-secondary, #f3f4f6)', borderRadius: 4 }}>
                  {/* Fill */}
                  <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${pctPosition}%`, background: 'linear-gradient(90deg, var(--color-accent, #f97316), #fb923c)', borderRadius: 4, transition: 'width 0.3s ease' }} />
                </div>
                {/* Baseline marker */}
                <div style={{ position: 'absolute', top: 6, left: `${baselinePct}%`, width: 2, height: 16, background: 'var(--color-text-secondary)', borderRadius: 1, transform: 'translateX(-1px)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                <span>{fmt(rangeMin)}</span>
                <span>↑ baseline</span>
                <span>{fmt(rangeMax)}</span>
              </div>
            </div>
          )}

          {/* Note box */}
          {pred?.note && (
            <div style={{ marginTop: 12, padding: '8px 10px', background: 'var(--color-background-secondary, #f9fafb)', borderRadius: 6, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              {pred.note}
            </div>
          )}
        </div>

        {/* Scenario Compare Card */}
        {(baseline || scenarios.length > 0) && (
          <div className="ax-card" style={{ padding: 20 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Scenario compare</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
              {/* Baseline */}
              <div style={{ borderTop: '3px solid var(--color-border-tertiary)', paddingTop: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>Baseline</span>
                <p style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 8px', color: 'var(--color-text-secondary)' }}>
                  {formatPrediction(baseline)}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {baselineInputs && Object.entries(baselineInputs).slice(0, 8).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                      <span style={{ color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Current inputs */}
              <div style={{ borderTop: '3px solid var(--color-accent, #f97316)', paddingTop: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>Current inputs</span>
                <p style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 2px', color: 'var(--color-accent, #f97316)' }}>
                  {formatPrediction(pred)}
                </p>
                {baseline && (
                  <p style={{ fontSize: 11, margin: '0 0 8px', color: delta > 0 ? 'var(--color-text-success, #16a34a)' : delta < 0 ? 'var(--color-text-danger, #dc2626)' : 'var(--color-text-tertiary)' }}>
                    {formatDelta(delta, isProb)} vs baseline
                  </p>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {Object.entries(inputs).slice(0, 8).map(([k, v]) => {
                    const changed = baselineInputs && String(baselineInputs[k]) !== String(v)
                    return (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', color: changed ? 'var(--color-accent, #f97316)' : 'var(--color-text-secondary)', fontWeight: changed ? 700 : 400 }}>{String(v)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Saved Scenarios Card */}
        <div className="ax-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Saved scenarios</span>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{scenarios.length} saved</span>
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
                    onClick={() => loadScenario(s)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12, background: selectedScenarioName === s.name ? 'var(--color-accent-light, #fff7ed)' : 'transparent' }}
                    onMouseEnter={(e) => { if (selectedScenarioName !== s.name) e.currentTarget.style.background = 'var(--color-background-secondary)' }}
                    onMouseLeave={(e) => { if (selectedScenarioName !== s.name) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-text-primary)' }}>{formatPrediction(s.prediction)}</span>
                    {sDelta !== null && (
                      <span style={{ fontSize: 11, color: sDelta > 0 ? 'var(--color-text-success, #16a34a)' : sDelta < 0 ? 'var(--color-text-danger, #dc2626)' : 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                        {formatDelta(sDelta, isProb)}
                      </span>
                    )}
                    <button
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

function CategoricalPill({ feature, value, onChange }) {
  return (
    <div>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', display: 'block', marginBottom: 4 }}>{feature.name}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {(feature.values || []).map((v) => {
          const active = String(value) === String(v)
          return (
            <button
              key={v}
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

function NumericSlider({ feature, value, onChange }) {
  const numericVal = Number(value ?? feature.mean)
  const min = Number(feature.min)
  const max = Number(feature.max)
  const mean = Number(feature.mean)
  const step = Math.max((max - min) / 200, 0.01)
  const deltaFromMean = numericVal - mean

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{feature.name}</span>
        <input
          type="number"
          value={Number.isFinite(numericVal) ? numericVal : ''}
          step={step}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') { onChange(''); return }
            const next = Number(raw)
            if (Number.isFinite(next)) onChange(next)
          }}
          style={{ width: 64, fontSize: 11, fontFamily: 'var(--font-mono)', textAlign: 'right', padding: '2px 4px', border: '1px solid var(--color-border-tertiary)', borderRadius: 4 }}
        />
      </div>
      {/* Slider track with mean marker */}
      <div style={{ position: 'relative', height: 24, marginTop: 2 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={clamp(numericVal, min, max)}
          onChange={(e) => onChange(+e.target.value)}
          style={{ width: '100%', height: 24, cursor: 'pointer', accentColor: 'var(--color-accent, #f97316)' }}
        />
        {/* Mean tick marker */}
        {max > min && (
          <div style={{ position: 'absolute', top: 0, left: `${((mean - min) / (max - min)) * 100}%`, width: 1, height: 24, background: 'var(--color-text-tertiary)', pointerEvents: 'none', opacity: 0.5 }} />
        )}
      </div>
      {/* Min / Max labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: -2 }}>
        <span>{fmt(min)}</span>
        <span>{fmt(max)}</span>
      </div>
      {/* Change from mean indicator */}
      <div style={{ fontSize: 11, marginTop: 2 }}>
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

function NoModelView({ availableModels, setFallbackModel, dialog }) {
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-accent, #f97316)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>What-if</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Train or choose a model on the Models page to enable what-if.</p>
      {availableModels.length > 0 && (
        <div className="ax-card" style={{ padding: 14, marginTop: 12 }}>
          <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Choose a model for What-if</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {availableModels.slice(0, 5).map((model) => (
              <div key={model.id} className="ax-card" style={{ padding: '8px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12 }}>{model.algorithm} - {model.target}</span>
                  <button className="ax-btn" onClick={async () => {
                    try {
                      if (!model.has_whatif) await api.prepareModelForWhatIf(model.id)
                      setFallbackModel({ ...model, has_whatif: true })
                    } catch (err) {
                      await dialog.alert({ title: 'Could Not Prepare Model', message: err.message, variant: 'danger' })
                    }
                  }}>Use in What-if</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
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
