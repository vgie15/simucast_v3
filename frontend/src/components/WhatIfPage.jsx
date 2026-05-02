import React, { useEffect, useState } from 'react'
import { api } from '../api'

export default function WhatIfPage({ dataset, activeModel }) {
  const [modelFull, setModelFull] = useState(null)
  const [inputs, setInputs] = useState({})
  const [pred, setPred] = useState(null)
  const [baseline, setBaseline] = useState(null)
  const [scenarioName, setScenarioName] = useState('')
  const [scenarios, setScenarios] = useState([])
  const [restrictToRange, setRestrictToRange] = useState(false)

  useEffect(() => {
    if (!activeModel) return
    api.getModel(activeModel.id).then((m) => {
      setModelFull(m)
      const init = {}
      for (const f of m.whatif_features || []) {
        init[f.name] = f.kind === 'categorical' ? (f.default || f.values?.[0] || '') : f.mean
      }
      setInputs(init)
      setPred(null)
      setBaseline(null)
      setScenarios([])
    })
  }, [activeModel?.id])

  useEffect(() => {
    if (!modelFull || !Object.keys(inputs).length) return
    api.predict(modelFull.id, inputs).then((p) => {
      setPred(p)
      setBaseline((current) => current || p)
    }).catch(console.error)
  }, [inputs, modelFull?.id])

  if (!dataset) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>
  if (!activeModel) {
    return (
      <>
        <h1 className="ax-page-title">What-if analysis</h1>
        <p className="ax-page-sub">Train an interpretable linear or logistic model on the Models page to enable what-if.</p>
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
      alert('Scenario saved locally, but documentation logging failed: ' + err.message)
    }
  }

  return (
    <>
      <h1 className="ax-page-title">What-if analysis</h1>
      <p className="ax-page-sub">Using <code>{modelFull.name}</code>. Adjust feature values and see how changes affect the prediction.</p>

      <div className="ax-card" style={{ marginBottom: 14, padding: 16 }}>
        <div className="ax-row" style={{ marginBottom: 12 }}>
          <div>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
              Predicted {isProb ? `probability${pred?.positive_class ? ` of ${pred.positive_class}` : ''}` : modelFull.target}
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
        </div>
        {isProb && (
          <div style={{ height: 8, background: 'var(--color-background-secondary)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: pct >= 60 ? '#E24B4A' : pct >= 35 ? '#EF9F27' : '#1D9E75', transition: 'width 0.15s' }} />
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
      </div>

      <p className="ax-lbl">Adjust feature values</p>
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
          <p className="ax-lbl" style={{ marginTop: 14 }}>Scenario compare</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            {baseline && <ScenarioCard name="Baseline" prediction={baseline} />}
            {pred && <ScenarioCard name="Current inputs" prediction={pred} baseline={baseline} extrapolation={extrapolation} active />}
            {scenarios.map((s, i) => <ScenarioCard key={i} name={s.name} prediction={s.prediction} baseline={baseline} extrapolation={s.extrapolation} />)}
          </div>
        </>
      )}
    </>
  )
}

function ScenarioCard({ name, prediction, baseline, extrapolation, active }) {
  const isProb = prediction.kind === 'probability'
  const delta = baseline ? prediction.prediction - baseline.prediction : null
  const scenarioRisk = extrapolation?.overall_risk
  return (
    <div className="ax-card" style={{ padding: '10px 12px', border: active ? '2px solid var(--color-border-info)' : undefined }}>
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
    </div>
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

function riskStyle(risk) {
  if (risk === 'high') return { bg: '#FFF1F1', fg: '#9E2524', border: '#E24B4A' }
  if (risk === 'medium') return { bg: '#FFF8EA', fg: '#7A4B00', border: '#EF9F27' }
  return { bg: '#F0FAF6', fg: '#18765B', border: '#1D9E75' }
}

function distanceText(risk) {
  if (!risk) return ''
  return `${fmt(risk.distance)} ${risk.direction} ${fmt(risk.boundary)}`
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
  return prediction.kind === 'probability'
    ? `${Math.round(prediction.prediction * 100)}%`
    : prediction.prediction.toFixed(3)
}

function formatDelta(delta, isProb) {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return '-'
  const sign = delta > 0 ? '+' : ''
  return isProb ? `${sign}${Math.round(delta * 100)} pts` : `${sign}${delta.toFixed(3)}`
}

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
