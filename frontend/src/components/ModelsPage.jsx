import React, { useEffect, useMemo, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import { api } from '../api'
import AIAssistantPanel from './AIAssistantPanel'

const ALGOS = [
  { key: 'logistic', label: 'Logistic regression', task: 'classification', interpretable: true,
    desc: 'Linear, fast, interpretable. Good baseline for classification.' },
  { key: 'rf',       label: 'Random forest',       task: 'both',           interpretable: false,
    desc: 'Ensemble of trees. Handles non-linearity, less tuning needed.' },
  { key: 'gbm',      label: 'Gradient boost',      task: 'both',           interpretable: false,
    desc: 'Strong tabular performance. Slower than random forest, often wins.' },
  { key: 'linear',   label: 'Linear regression',   task: 'regression',     interpretable: true,
    desc: 'Linear baseline for regression. Coefficients directly interpretable.' },
]

export default function ModelsPage({ dataset, setActiveModel, onGo }) {
  const [target, setTarget] = useState('')
  const [targetMode, setTargetMode] = useState('auto')
  const [positiveClass, setPositiveClass] = useState('')
  const [features, setFeatures] = useState([])
  const [chosenAlgos, setChosenAlgos] = useState(['logistic', 'rf'])
  const [plan, setPlan] = useState(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState(null)
  const [training, setTraining] = useState(false)
  const [results, setResults] = useState(null)
  const [activeResultIdx, setActiveResultIdx] = useState(0)
  const [models, setModels] = useState([])

  const variables = dataset?.variables || []
  const candidateFeatures = variables.filter((v) => v.name !== target)
  const allFeatureNames = useMemo(() => candidateFeatures.map((v) => v.name), [target, variables])

  useEffect(() => {
    if (!dataset) return
    api.listModels(dataset.id).then(setModels).catch(console.error)
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
          target_options: targetOptions(targetMode, positiveClass),
        })
        if (!cancelled) {
          setPlan(r)
          if (!positiveClass && r.positive_class) setPositiveClass(r.positive_class)
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
  }, [dataset?.id, target, features.join(','), chosenAlgos.join(','), targetMode, positiveClass])

  if (!dataset) {
    return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>
  }

  const toggleFeature = (name) => {
    setFeatures(features.includes(name) ? features.filter((x) => x !== name) : [...features, name])
  }
  const selectAll = () => setFeatures(allFeatureNames)
  const selectNone = () => setFeatures([])
  const toggleAlgo = (key) => {
    setChosenAlgos(chosenAlgos.includes(key) ? chosenAlgos.filter((a) => a !== key) : [...chosenAlgos, key])
  }

  // Filter the algorithm list based on the inferred task.
  const visibleAlgos = ALGOS.filter((a) => {
    if (!plan) return true
    return a.task === 'both' || a.task === plan.task
  })

  const train = async () => {
    if (!target || features.length === 0 || chosenAlgos.length === 0) return
    setTraining(true)
    setResults(null)
    try {
      const r = await api.trainManyModels(dataset.id, {
        target,
        features,
        algorithms: chosenAlgos,
        target_options: targetOptions(targetMode, positiveClass),
      })
      setResults(r)
      setActiveResultIdx(0)
      const list = await api.listModels(dataset.id)
      setModels(list)
    } catch (err) {
      alert('Training failed: ' + err.message)
    } finally {
      setTraining(false)
    }
  }

  const useInWhatIf = (model) => {
    setActiveModel(model)
    onGo('whatif')
  }

  return (
    <>
      <h1 className="ax-page-title">Build a model</h1>
      <p className="ax-page-sub">
        Pick a target, select features, choose algorithms, and train them all in one click.
      </p>

      <AIAssistantPanel datasetId={dataset.id} context="models" />

      {/* Step 1 — target */}
      <Step n={1} title="Pick a target — what to predict">
        <select
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
      </Step>

      {/* Step 3 — preprocessing plan */}
      <Step n={3} title="What will happen — preprocessing plan" disabled={!target || features.length === 0}>
        {planLoading && (
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>Computing plan…</p>
        )}
        {planError && (
          <p style={{ fontSize: 12, color: 'var(--color-text-danger)', margin: 0 }}>{planError}</p>
        )}
        {plan && <PreprocessingPlan plan={plan} />}
      </Step>

      {/* Step 4 — algorithms */}
      <Step n={4} title="Choose algorithms" disabled={!plan}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visibleAlgos.map((a) => (
            <label
              key={a.key}
              className="ax-card"
              style={{
                padding: '10px 12px',
                cursor: 'pointer',
                background: chosenAlgos.includes(a.key) ? 'var(--color-accent-light)' : undefined,
                borderColor: chosenAlgos.includes(a.key) ? 'var(--color-accent)' : undefined,
              }}
            >
              <div className="ax-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={chosenAlgos.includes(a.key)}
                    onChange={() => toggleAlgo(a.key)}
                  />
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{a.label}</p>
                    <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>{a.desc}</p>
                  </div>
                </div>
                {a.interpretable && (
                  <span className="ax-chip" style={{ background: 'var(--color-background-secondary)' }}>
                    interpretable
                  </span>
                )}
              </div>
            </label>
          ))}
        </div>
      </Step>

      {/* Step 5 — train */}
      <div className="ax-row" style={{ margin: '8px 0 16px', justifyContent: 'flex-end' }}>
        <button
          className="ax-btn prim"
          disabled={training || !plan || chosenAlgos.length === 0}
          onClick={train}
          type="button"
        >
          {training ? `Training ${chosenAlgos.length} model${chosenAlgos.length === 1 ? '' : 's'}…` : `Train ${chosenAlgos.length} model${chosenAlgos.length === 1 ? '' : 's'}`}
        </button>
      </div>

      {/* Results */}
      {results && (
        <ResultsPanel
          results={results}
          activeIdx={activeResultIdx}
          setActiveIdx={setActiveResultIdx}
          onUseInWhatIf={useInWhatIf}
        />
      )}

      {/* Previous models */}
      {models.length > 0 && (
        <>
          <p className="ax-lbl" style={{ marginTop: 20 }}>Previous models</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {models.map((m) => (
              <div key={m.id} className="ax-card" style={{ padding: '10px 12px' }}>
                <div className="ax-row">
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 500, margin: 0 }}>
                      {m.algorithm} · {m.target}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>
                      {formatMetrics(m.metrics)}
                    </p>
                  </div>
                  {m.has_whatif && (
                    <button className="ax-btn" onClick={() => useInWhatIf(m)} type="button">
                      Use in what-if →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function Step({ n, title, disabled, children }) {
  return (
    <div
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
        <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{title}</p>
      </div>
      <div style={{ pointerEvents: disabled ? 'none' : 'auto' }}>{children}</div>
    </div>
  )
}

function PreprocessingPlan({ plan }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <PlanLine label="Task">
        <strong>{plan.task}</strong> · target: {plan.target}
      </PlanLine>
      <PlanLine label="Rows">
        Using <strong>{plan.rows_used.toLocaleString()}</strong>
        {plan.rows_dropped > 0 && (
          <> · dropping <span style={{ color: 'var(--color-text-danger)' }}>{plan.rows_dropped.toLocaleString()}</span> rows with missing values</>
        )}
      </PlanLine>
      {plan.encoding.length > 0 && (
        <PlanLine label="Encoding">
          One-hot encode {plan.encoding.length} categorical column{plan.encoding.length !== 1 ? 's' : ''}:{' '}
          {plan.encoding.map((e) => `${e.column} (${e.n_categories})`).join(', ')}
        </PlanLine>
      )}
      {plan.scaling.length > 0 && (
        <PlanLine label="Scaling">
          StandardScaler on numeric features for: {plan.scaling[0].applies_to.join(', ')}
        </PlanLine>
      )}
      {plan.missing_report.length > 0 && (
        <PlanLine label="Missing">
          {plan.missing_report.map((m) => `${m.column} (${m.missing})`).join(' · ')}
        </PlanLine>
      )}
      {plan.warnings.length > 0 && (
        <div
          style={{
            background: 'var(--color-background-danger)',
            color: 'var(--color-text-danger)',
            padding: '8px 10px',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <strong>Warnings:</strong>
          <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
            {plan.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
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

function ResultsPanel({ results, activeIdx, setActiveIdx, onUseInWhatIf }) {
  const { models, skipped } = results
  if (!models || models.length === 0) {
    return (
      <p style={{ fontSize: 12, color: 'var(--color-text-danger)' }}>
        No models trained. {skipped?.[0]?.reason}
      </p>
    )
  }
  const active = models[activeIdx] || models[0]
  return (
    <>
      <p className="ax-lbl">Comparison</p>
      <ComparisonTable models={models} activeIdx={activeIdx} onPick={setActiveIdx} />
      {skipped?.length > 0 && (
        <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '6px 0 12px' }}>
          Skipped: {skipped.map((s) => `${s.algorithm} (${s.reason})`).join(' · ')}
        </p>
      )}

      <div className="ax-card" style={{ padding: 14, marginTop: 8 }}>
        <div className="ax-row" style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{active.label} — details</p>
          {active.has_whatif && (
            <button className="ax-btn" onClick={() => onUseInWhatIf(active)} type="button">
              Use in what-if →
            </button>
          )}
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
            {task === 'classification' ? (
              <>
                <th>Accuracy</th>
                <th>F1</th>
                <th>Precision</th>
                <th>Recall</th>
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
                {task === 'classification' ? (
                  <>
                    <td>{pct(mt.accuracy)}</td>
                    <td>{num(mt.f1)}</td>
                    <td>{num(mt.precision)}</td>
                    <td>{num(mt.recall)}</td>
                    <td>{num(mt.auc)}</td>
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

function ModelDetail({ model }) {
  const importance = model.feature_importance || {}
  const impLabels = Object.keys(importance)
  const impValues = Object.values(importance)
  const cm = model.metrics?.confusion_matrix

  return (
    <>
      {impLabels.length > 0 && (
        <>
          <p className="ax-lbl" style={{ marginTop: 0 }}>Feature importance</p>
          <div style={{ height: Math.max(200, impLabels.length * 22), marginBottom: 14 }}>
            <Bar
              data={{
                labels: impLabels,
                datasets: [{ label: 'Importance', data: impValues, backgroundColor: '#7F77DD', borderRadius: 2 }],
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
function pct(v) {
  if (v == null) return '—'
  return `${(v * 100).toFixed(1)}%`
}
function num(v) {
  if (v == null) return '—'
  return Number(v).toFixed(3)
}

function targetOptions(mode, positiveClass) {
  const options = {}
  if (mode && mode !== 'auto') options.mode = mode
  if (positiveClass) options.positive_class = positiveClass
  return options
}
