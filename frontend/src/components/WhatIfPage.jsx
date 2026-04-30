import React, { useEffect, useState } from 'react'
import { api } from '../api'

export default function WhatIfPage({ dataset, activeModel, setActiveModel }) {
  const [modelFull, setModelFull] = useState(null)
  const [inputs, setInputs] = useState({})
  const [pred, setPred] = useState(null)
  const [baseline, setBaseline] = useState(null)

  useEffect(() => {
    if (!activeModel) return
    api.getModel(activeModel.id).then((m) => {
      setModelFull(m)
      // initialize inputs to the means
      const init = {}
      for (const f of m.whatif_features || []) {
        init[f.name] = f.mean
      }
      setInputs(init)
    })
  }, [activeModel?.id])

  useEffect(() => {
    if (!modelFull || !Object.keys(inputs).length) return
    api.predict(modelFull.id, inputs).then((p) => {
      setPred(p)
      if (!baseline) setBaseline(p)
    }).catch(console.error)
  }, [inputs, modelFull?.id])

  if (!dataset) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>
  if (!activeModel) {
    return (
      <>
        <h1 className="ax-page-title">What-if analysis</h1>
        <p className="ax-page-sub">Train a linear or logistic model on the Models page to enable what-if.</p>
      </>
    )
  }
  if (!modelFull) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Loading model…</p>

  const features = modelFull.whatif_features || []
  const isProb = pred?.kind === 'probability'
  const pct = isProb ? Math.round(pred.prediction * 100) : null
  const riskStyle = pct == null ? {} :
    pct >= 60 ? { bg: 'var(--color-background-danger)', fg: 'var(--color-text-danger)', bar: '#E24B4A', label: 'High' } :
    pct >= 35 ? { bg: 'var(--color-background-warning)', fg: 'var(--color-text-warning)', bar: '#EF9F27', label: 'Medium' } :
                { bg: 'var(--color-background-success)', fg: 'var(--color-text-success)', bar: '#1D9E75', label: 'Low' }

  const reset = () => {
    const init = {}
    for (const f of features) init[f.name] = f.mean
    setInputs(init)
    setBaseline(null)
  }

  return (
    <>
      <h1 className="ax-page-title">What-if analysis</h1>
      <p className="ax-page-sub">Using <code>{modelFull.name}</code> · drag sliders to see prediction change live.</p>

      {/* prediction display */}
      <div className="ax-card" style={{ marginBottom: 14, padding: 16 }}>
        <div className="ax-row" style={{ marginBottom: 12 }}>
          <div>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
              Predicted {isProb ? 'probability' : 'value'}
            </p>
            <p style={{ fontSize: 32, fontWeight: 500, margin: '2px 0 0', lineHeight: 1 }}>
              {isProb ? `${pct}%` : pred?.prediction?.toFixed(3) ?? '—'}
            </p>
          </div>
          {isProb && (
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>Risk level</p>
              <span style={{
                fontSize: 12, padding: '3px 12px',
                background: riskStyle.bg, color: riskStyle.fg,
                borderRadius: 4, marginTop: 4, display: 'inline-block',
              }}>
                {riskStyle.label}
              </span>
            </div>
          )}
        </div>
        {isProb && (
          <div style={{ height: 8, background: 'var(--color-background-secondary)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: riskStyle.bar, transition: 'width 0.15s' }} />
          </div>
        )}
      </div>

      <p className="ax-lbl">Inputs</p>
      <div className="ax-card">
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 60px', gap: '10px 12px', alignItems: 'center', fontSize: 12 }}>
          {features.map((f) => {
            const val = inputs[f.name] ?? f.mean
            return (
              <React.Fragment key={f.name}>
                <label style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  {f.name}
                </label>
                <input
                  type="range"
                  min={f.min}
                  max={f.max}
                  step={(f.max - f.min) / 100}
                  value={val}
                  onChange={(e) => setInputs({ ...inputs, [f.name]: +e.target.value })}
                />
                <span style={{ fontWeight: 500, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  {val.toFixed(2)}
                </span>
              </React.Fragment>
            )
          })}
        </div>
        <div style={{ textAlign: 'right', marginTop: 14 }}>
          <button className="ax-btn" onClick={reset}>Reset to baseline</button>
        </div>
      </div>

      {baseline && pred && (
        <>
          <p className="ax-lbl" style={{ marginTop: 14 }}>Scenario compare</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div className="ax-card" style={{ padding: '10px 12px' }}>
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>A · baseline</p>
              <p style={{ fontSize: 22, fontWeight: 500, margin: '2px 0 0' }}>
                {baseline.kind === 'probability' ? `${Math.round(baseline.prediction * 100)}%` : baseline.prediction.toFixed(3)}
              </p>
            </div>
            <div className="ax-card" style={{ padding: '10px 12px', border: '2px solid var(--color-border-info)' }}>
              <p style={{ fontSize: 11, color: 'var(--color-text-info)', margin: 0 }}>B · current inputs</p>
              <p style={{ fontSize: 22, fontWeight: 500, margin: '2px 0 0' }}>
                {pred.kind === 'probability' ? `${Math.round(pred.prediction * 100)}%` : pred.prediction.toFixed(3)}
              </p>
            </div>
          </div>
        </>
      )}
    </>
  )
}
