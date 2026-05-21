/* ============================================================
 * PAGE: WHAT-IF / PREDICTION
 * Keywords: whatif, what-if, predict, prediction, scenario, simulation
 * ============================================================ */
import React, { useEffect, useState } from 'react'
import { api } from '../../api'
import { useDialog } from '../common/DialogProvider'
import { AIInsightCard, ExplainButton } from '../ai/AIExplainers'
import HelpButton from '../common/HelpButton'
import PageGuide from '../common/PageGuide'

// What-if simulation page that runs predictions on a model and saves scenarios.
export default function WhatIfPage({ dataset, activeModel }) {
  const dialog = useDialog()
  const [fallbackModel, setFallbackModel] = useState(null)
  const [availableModels, setAvailableModels] = useState([])
  const [modelFull, setModelFull] = useState(null)
  const [inputs, setInputs] = useState({})
  const [pred, setPred] = useState(null)
  const [baseline, setBaseline] = useState(null)
  const [baselineInputs, setBaselineInputs] = useState(null)
  const [scenarioName, setScenarioName] = useState('')
  const [scenarios, setScenarios] = useState([])
  const [selectedScenarioName, setSelectedScenarioName] = useState('')
  const [restrictToRange, setRestrictToRange] = useState(false)
  const selectedModel = activeModel || fallbackModel

  useEffect(() => {
    if (!dataset?.id || activeModel) return
    api.listModels(dataset.id)
      .then((models) => {
        setAvailableModels(models || [])
        setFallbackModel((models || []).find((m) => m.has_whatif) || null)
      })
      .catch(console.error)
  }, [dataset?.id, activeModel?.id])

  useEffect(() => {
    if (!selectedModel) return
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
    api.predict(modelFull.id, inputs).then((p) => {
      setPred(p)
      setBaseline((current) => {
        if (!current) setBaselineInputs({ ...inputs })
        return current || p
      })
    }).catch(console.error)
  }, [inputs, modelFull?.id])

  if (!dataset) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>
  if (!selectedModel) {
    return (
      <>
        <h1 className="ax-page-title">What-if analysis</h1>
        <p className="ax-page-sub">Train or choose a model on the Models page to enable what-if.</p>
        <PageGuide
          title="What-if needs a trained model first"
          meta="What-if"
          steps={['Choose model', 'Set values', 'Compare prediction']}
        >
          After a model is available, this page lets you adjust feature values and compare the prediction against a baseline.
        </PageGuide>
        {availableModels.length > 0 && (
          <div className="ax-card" style={{ padding: 14, marginTop: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 500, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              Choose a model for What-if
              <HelpButton
                title="Choose a model for What-if"
                text="This card lets you pick any trained model that supports prediction. Once selected, SimuCast prepares the model inputs so you can test scenarios."
              />
            </p>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
              All trained models can be prepared for What-if. Tree-based models may change predictions in steps when inputs cross learned thresholds.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              {availableModels.slice(0, 5).map((model) => (
                <div key={model.id} className="ax-card" style={{ padding: '8px 10px' }}>
                  <div className="ax-row">
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
  if (!modelFull) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Loading model...</p>

  const features = modelFull.whatif_features || []
  const isProb = pred?.kind === 'probability'
  const pct = isProb ? Math.round(pred.prediction * 100) : null
  const targetContext = pred?.target_context || modelFull.target_context
  const warning = pred?.warning || rangeWarning(pred, targetContext)
  const delta = pred && baseline ? pred.prediction - baseline.prediction : null
  const extrapolation = computeExtrapolation(inputs, features)
  const riskTone = riskStyle(extrapolation.overall_risk)

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
    setScenarios([...scenarios, scenario])
    setScenarioName('')
    try {
      await api.saveScenario(modelFull.id, scenario)
    } catch (err) {
      await dialog.alert({
        title: 'Scenario Saved Locally',
        message: 'The scenario was saved in this page, but documentation logging failed.',
        details: err.message,
        variant: 'danger',
      })
    }
  }

  return (
    <>
      <h1 className="ax-page-title">What-if analysis</h1>
      <p className="ax-page-sub">Using <code>{modelFull.name}</code>. Adjust feature values and see how changes affect the prediction.</p>
      <PageGuide
        title="Change one scenario at a time"
        meta="What-if"
        steps={['Adjust inputs', 'Read prediction', 'Save scenario', 'Compare']}
      >
        Start from the baseline values, change the variables you care about, then save useful scenarios for the report.
      </PageGuide>

      <div id="whatif-section-controls" className="ax-card" style={{ marginBottom: 14, padding: 16 }}>
        <div className="ax-row" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
          <div>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              Predicted {isProb ? `probability${pred?.positive_class ? ` of ${pred.positive_class}` : pred?.predicted_class ? ` of ${pred.predicted_class}` : ''}` : modelFull.target}
              <HelpButton
                title="Prediction result"
                text="This card shows the model prediction for the current scenario. The baseline compares against the original average/default inputs, while the scenario risk warns when values go outside the training data range."
              />
            </p>
            <p style={{ fontSize: 32, fontWeight: 500, margin: '2px 0 0', lineHeight: 1 }}>
              {isProb ? `${pct}%` : pred?.prediction?.toFixed(3) ?? '-'}
            </p>
            {targetContext && !isProb && (
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>
                Dataset range: {fmt(targetContext.min)}-{fmt(targetContext.max)} | mean {fmt(targetContext.mean)}
              </p>
            )}
            {baseline && pred && (
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
                Baseline {formatPrediction(baseline)} | Current {formatPrediction(pred)} | Change {formatDelta(delta, isProb)}
              </p>
            )}
          </div>
          {pred && (
            <ExplainButton
              datasetId={dataset.id}
              step="whatif-prediction"
              params={{ target: modelFull.target, inputs, baseline_inputs: undefined }}
              result={{ prediction: pred, baseline, delta, extrapolation }}
              question="Explain this scenario prediction in plain English: what changed from the baseline, why the prediction shifted in that direction, and how confident the user should be given the extrapolation risk."
              label="Explain"
            />
          )}
        </div>
        {isProb && (
          <div style={{ height: 8, background: 'var(--color-background-secondary)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: probabilityColor(pred, modelFull), transition: 'width 0.15s' }} />
          </div>
        )}
        <div style={{ marginTop: 12, padding: '10px 12px', border: `1px solid ${riskTone.border}`, background: riskTone.bg, borderRadius: 6, fontSize: 12, color: riskTone.fg }}>
          <strong>Scenario risk: {extrapolation.overall_risk.toUpperCase()}</strong>
          <br />
          {extrapolation.out_of_range_features?.length > 0
            ? 'This prediction is based on extrapolated inputs. The model has not seen similar values during training.'
            : 'All numeric inputs are inside the dataset range seen during training.'}
        </div>
        {extrapolation.out_of_range_features?.length > 0 && (
          <div style={{ marginTop: 12, padding: '10px 12px', border: `1px solid ${riskTone.border}`, background: riskTone.bg, borderRadius: 6, fontSize: 12, color: riskTone.fg }}>
            <strong>Out-of-range features:</strong> {extrapolation.out_of_range_features.join(', ')}
            <br />
            Predictions may become less reliable outside the conditions present in the dataset.
          </div>
        )}
        {warning && (
          <div style={{ marginTop: 12, padding: '10px 12px', border: '1px solid #EF9F27', background: '#FFF8EA', borderRadius: 6, fontSize: 12, color: '#7A4B00' }}>
            {warning}
          </div>
        )}
        {pred?.note && (
          <div style={{ marginTop: 12, padding: '10px 12px', border: '1px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)', borderRadius: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>
            {pred.note}
          </div>
        )}
      </div>

      <p className="ax-lbl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        Adjust feature values
        <HelpButton
          title="Adjust feature values"
          text="Use these controls to change the original model features and immediately see how the trained model prediction responds. Numeric controls show the observed range from training data."
        />
      </p>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: -6 }}>
        See how dataset-learned values affect the prediction. Numeric controls show the observed range and mean from the training data.
      </p>
      <div className="ax-card">
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
          <input type="checkbox" checked={restrictToRange} onChange={(e) => setRestrictToRange(e.target.checked)} />
          Restrict inputs to dataset range
        </label>
        <p style={{ margin: '-6px 0 12px', fontSize: 11, color: 'var(--color-text-secondary)' }}>
          Sliders stay in the safe dataset range. Manual boxes can go beyond the range unless restriction is turned on.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr 120px', gap: '12px', alignItems: 'center', fontSize: 12 }}>
          {features.map((f) => {
            const val = inputs[f.name]
            const numericVal = Number(val ?? f.mean)
            const featureRisk = extrapolation.details?.find((item) => item.feature === f.name)
            return (
              <React.Fragment key={f.name}>
                <label>
                  <span style={{ display: 'block', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {f.name}
                  </span>
                  {f.kind !== 'categorical' && (
                    <span style={{ display: 'block', color: 'var(--color-text-tertiary)', fontSize: 10, marginTop: 2 }}>
                      Range {fmt(f.min)}-{fmt(f.max)} | mean {fmt(f.mean)}
                    </span>
                  )}
                </label>
                {f.kind === 'categorical' ? (
                  <select value={val ?? ''} onChange={(e) => setInputs({ ...inputs, [f.name]: e.target.value })}>
                    {(f.values || []).map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                ) : (
                  <div>
                    <input
                      type="range"
                      min={f.min}
                      max={f.max}
                      step={Math.max((f.max - f.min) / 100, 0.01)}
                      value={clamp(numericVal, Number(f.min), Number(f.max))}
                      onChange={(e) => setInputs({ ...inputs, [f.name]: +e.target.value })}
                      style={{ width: '100%' }}
                    />
                    {featureRisk && (
                      <p style={{ margin: '4px 0 0', fontSize: 11, color: riskStyle(featureRisk.risk).fg }}>
                        Outside dataset range ({fmt(f.min)}-{fmt(f.max)}). {distanceText(featureRisk)}. Prediction reliability may decrease.
                      </p>
                    )}
                  </div>
                )}
                {f.kind === 'categorical' ? (
                  <span style={{ fontWeight: 500, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {val}
                  </span>
                ) : (
                  <input
                    type="number"
                    value={val ?? ''}
                    step={Math.max((f.max - f.min) / 100, 0.01)}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (raw === '') {
                        setInputs({ ...inputs, [f.name]: '' })
                        return
                      }
                      const next = Number(raw)
                      if (!Number.isFinite(next)) return
                      const value = restrictToRange ? clamp(next, Number(f.min), Number(f.max)) : next
                      setInputs({ ...inputs, [f.name]: value })
                    }}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      borderColor: featureRisk ? riskStyle(featureRisk.risk).border : undefined,
                    }}
                    title={restrictToRange ? 'Turn off range restriction to explore extrapolated values.' : 'Manual input can exceed the dataset range.'}
                  />
                )}
              </React.Fragment>
            )
          })}
        </div>
        <div className="ax-row" style={{ marginTop: 14 }}>
          <button className="ax-btn" onClick={resetToMean}>Reset to average values</button>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} placeholder="Scenario name" />
            <button className="ax-btn prim" onClick={saveScenario} disabled={!pred}>Save scenario</button>
          </div>
        </div>
      </div>

      {(baseline || scenarios.length > 0) && (
        <>
          <p className="ax-lbl" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            Scenario compare
            <HelpButton
              title="Scenario compare"
              text="This section compares the baseline, current inputs, and saved scenarios. Clicking a saved scenario loads its values back into the adjustment controls."
            />
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            {baseline && <ScenarioCard name="Baseline" prediction={baseline} inputs={baselineInputs} />}
            {pred && <ScenarioCard name="Current inputs" prediction={pred} baseline={baseline} extrapolation={extrapolation} inputs={inputs} active />}
            {scenarios.map((s, i) => (
              <ScenarioCard
                key={i}
                name={s.name}
                prediction={s.prediction}
                baseline={baseline}
                extrapolation={s.extrapolation}
                inputs={s.inputs}
                active={selectedScenarioName === s.name}
                onClick={() => {
                  setInputs(s.inputs || {})
                  setSelectedScenarioName(s.name)
                  setPred(null)
                }}
              />
            ))}
          </div>
        </>
      )}
    </>
  )
}

// Card displaying a saved scenario's prediction, delta from baseline and risk badge.
function ScenarioCard({ name, prediction, baseline, extrapolation, inputs, active, onClick }) {
  const isProb = prediction.kind === 'probability'
  const delta = baseline ? prediction.prediction - baseline.prediction : null
  const scenarioRisk = extrapolation?.overall_risk
  return (
    <div
      className="ax-card"
      onClick={onClick}
      style={{ padding: '10px 12px', border: active ? '2px solid var(--color-border-info)' : undefined, cursor: onClick ? 'pointer' : undefined }}
      title={onClick ? 'Load this scenario into the adjust feature values controls.' : undefined}
    >
      <p style={{ fontSize: 11, color: active ? 'var(--color-text-info)' : 'var(--color-text-secondary)', margin: 0 }}>{name}</p>
      <p style={{ fontSize: 22, fontWeight: 500, margin: '2px 0 0' }}>
        {formatPrediction(prediction)}
      </p>
      {delta !== null && (
        <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
          {formatDelta(delta, isProb)} vs baseline
        </p>
      )}
      {scenarioRisk && scenarioRisk !== 'low' && (
        <p style={{ fontSize: 11, color: riskStyle(scenarioRisk).fg, margin: '4px 0 0' }}>
          Scenario risk: {scenarioRisk.toUpperCase()}
        </p>
      )}
      {inputs && Object.keys(inputs).length > 0 && (
        <details style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
          <summary style={{ fontSize: 11, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>Values used</summary>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 8px', marginTop: 6, fontSize: 10 }}>
            {Object.entries(inputs).slice(0, 10).map(([key, value]) => (
              <React.Fragment key={key}>
                <span style={{ color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{key}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{String(value)}</span>
              </React.Fragment>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

// Picks a status color for a probability prediction based on target sentiment and value.
function probabilityColor(prediction, model) {
  const target = String(prediction?.positive_class || prediction?.predicted_class || model?.target || '').toLowerCase()
  const negativeTarget = /fail|risk|drop|churn|default|bad|loss|no|not|negative/.test(target)
  if (negativeTarget) {
    const pct = Math.round(Number(prediction?.prediction || 0) * 100)
    return pct >= 60 ? '#EF4444' : pct >= 35 ? '#F97316' : '#10B981'
  }
  return '#3B82F6'
}

async function hydrateCurrentCategoryValues(datasetId, features) {
  if (!datasetId) return features
  const hydrated = await Promise.all(
    (features || []).map(async (feature) => {
      if (feature.kind !== 'categorical') return feature
      try {
        const stats = await api.columnStats(datasetId, feature.name)
        const values = (stats.value_counts || []).map((item) => String(item.value))
        if (!values.length) return feature
        return {
          ...feature,
          values,
          default: values.includes(feature.default) ? feature.default : values[0],
        }
      } catch (err) {
        return feature
      }
    }),
  )
  return hydrated
}

// Computes per-feature extrapolation distance, direction and overall risk for inputs.
function computeExtrapolation(inputs, features) {
  const details = []
  for (const f of features || []) {
    if (f.kind === 'categorical') continue
    const value = Number(inputs[f.name])
    const lo = Number(f.min)
    const hi = Number(f.max)
    if (![value, lo, hi].every(Number.isFinite)) continue
    const span = Math.max(hi - lo, Math.abs(hi), Math.abs(lo), 1)
    let distance = 0
    let direction = ''
    let boundary = null
    if (value < lo) {
      distance = lo - value
      direction = 'below'
      boundary = lo
    } else if (value > hi) {
      distance = value - hi
      direction = 'above'
      boundary = hi
    }
    if (!distance) continue
    const deviationRatio = distance / span
    details.push({
      feature: f.name,
      value,
      min: lo,
      max: hi,
      distance,
      direction,
      boundary,
      deviation_ratio: deviationRatio,
      risk: deviationRatio <= 0.1 ? 'medium' : 'high',
    })
  }
  const overall = details.some((item) => item.risk === 'high') ? 'high' : details.length ? 'medium' : 'low'
  return {
    overall_risk: overall,
    out_of_range_features: details.map((item) => item.feature),
    details,
    message: details.length ? 'Some inputs exceed dataset boundaries. Predictions may be unreliable.' : null,
  }
}

// Returns background, foreground and border colors corresponding to a risk level.
function riskStyle(risk) {
  if (risk === 'high') return { bg: '#FFF1F1', fg: '#9E2524', border: '#E24B4A' }
  if (risk === 'medium') return { bg: '#FFF8EA', fg: '#7A4B00', border: '#EF9F27' }
  return { bg: '#F0FAF6', fg: '#18765B', border: '#1D9E75' }
}

// Formats an extrapolation entry as a short distance, direction and boundary string.
function distanceText(risk) {
  if (!risk) return ''
  return `${fmt(risk.distance)} ${risk.direction} ${fmt(risk.boundary)}`
}

// Clamps a numeric value into the inclusive min and max range.
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

// Formats a numeric value with one or two decimals depending on magnitude.
function fmt(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(2)
}

// Formats a prediction as either a percentage probability or a fixed-decimal value.
function formatPrediction(prediction) {
  if (!prediction) return '-'
  return prediction.kind === 'probability'
    ? `${Math.round(prediction.prediction * 100)}%`
    : prediction.prediction.toFixed(3)
}

// Formats the delta between two predictions, using points for probabilities.
function formatDelta(delta, isProb) {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return '-'
  const sign = delta > 0 ? '+' : ''
  return isProb ? `${sign}${Math.round(delta * 100)} pts` : `${sign}${delta.toFixed(3)}`
}

// Returns a warning message when a regression prediction lies outside the dataset range.
function rangeWarning(prediction, targetContext) {
  if (!prediction || prediction.kind === 'probability' || !targetContext) return null
  const lo = Number(targetContext.min)
  const hi = Number(targetContext.max)
  const value = Number(prediction.prediction)
  if (![lo, hi, value].every(Number.isFinite)) return null
  const span = hi - lo
  const pad = Math.max(span * 0.15, 1)
  if (value < lo - pad || value > hi + pad) {
    return 'Prediction seems outside the expected dataset range. Check preprocessing, feature values, or model fit.'
  }
  return null
}
