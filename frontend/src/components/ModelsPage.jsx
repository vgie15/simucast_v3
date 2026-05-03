import React, { useEffect, useMemo, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import { api } from '../api'
import AIAssistantPanel from './AIAssistantPanel'

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
  const [target, setTarget] = useState('')
  const [targetMode, setTargetMode] = useState('auto')
  const [positiveClass, setPositiveClass] = useState('')
  const [testSize, setTestSize] = useState(0.2)
  const [stratify, setStratify] = useState(true)
  const [classWeight, setClassWeight] = useState(false)
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

  const variables = dataset?.variables || []
  const candidateFeatures = variables.filter((v) => v.name !== target)
  const allFeatureNames = useMemo(() => candidateFeatures.map((v) => v.name), [target, variables])

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
      setStratify(saved.stratify ?? true)
      setClassWeight(saved.classWeight ?? false)
      setFeatures(saved.features || [])
      setChosenAlgos(saved.chosenAlgos || ['logistic', 'rf'])
      setModelParams(saved.modelParams || defaultModelParams())
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
      stratify,
      classWeight,
      features,
      chosenAlgos,
      modelParams,
    }))
  }, [dataset?.id, draftReady, target, targetMode, positiveClass, testSize, stratify, classWeight, features.join(','), chosenAlgos.join(','), JSON.stringify(modelParams)])

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
          target_options: targetOptions(targetMode, positiveClass, testSize, stratify, classWeight),
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
  }, [dataset?.id, target, features.join(','), chosenAlgos.join(','), targetMode, positiveClass, testSize, stratify, classWeight])

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
  const visibleAlgoKeys = visibleAlgos.map((a) => a.key)
  const selectedAlgos = chosenAlgos.filter((a) => visibleAlgoKeys.includes(a))

  const train = async () => {
    if (!target || features.length === 0 || selectedAlgos.length === 0) return
    setTraining(true)
    setResults(null)
    try {
      const r = await api.trainManyModels(dataset.id, {
        target,
        features,
        algorithms: selectedAlgos,
        target_options: targetOptions(targetMode, positiveClass, testSize, stratify, classWeight),
        model_params: modelParams,
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
      alert('Could not prepare model for What-if: ' + err.message)
    }
  }

  const deleteSavedModel = async (model) => {
    const label = `${algoLabelForTask(model.algorithm, model.metrics?.task)} - ${model.target}`
    if (!window.confirm(`Delete saved model "${label}"? This removes it from Previous models and documentation logs.`)) return
    try {
      await api.deleteModel(model.id)
      const list = await api.listModels(dataset.id)
      setModels(list)
    } catch (err) {
      alert('Could not delete model: ' + err.message)
    }
  }

  const restoreModelSettings = (model) => {
    const metrics = model.metrics || {}
    setTarget(model.target || '')
    setFeatures(model.features || [])
    setChosenAlgos([model.algorithm].filter(Boolean))
    setTestSize(metrics.split?.test_size ?? 0.2)
    setStratify(metrics.split?.stratified ?? true)
    setClassWeight(metrics.class_weight === 'balanced')
    setModelParams({
      ...defaultModelParams(),
      [model.algorithm]: metrics.model_params || defaultModelParams()[model.algorithm] || {},
    })
    setResults(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
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
      <Step n={4} title="Configure validation split" disabled={!plan}>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '10px 12px', alignItems: 'center', fontSize: 12 }}>
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

      <Step n={5} title="Choose algorithms" disabled={!plan || (plan.hard_blocks || []).length > 0}>
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
                    <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{algoLabelForTask(a.key, plan?.task)}</p>
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
          disabled={training || !plan || selectedAlgos.length === 0 || (plan.hard_blocks || []).length > 0}
          onClick={train}
          type="button"
        >
          {training ? `Training ${selectedAlgos.length} model${selectedAlgos.length === 1 ? '' : 's'}...` : `Train ${selectedAlgos.length} model${selectedAlgos.length === 1 ? '' : 's'}`}
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
          />
          {(results.models || []).length > 0 && (
            <div className="ax-card" style={{ padding: 14, marginTop: 12 }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Tune parameters</p>
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 10px' }}>
                Defaults were used for the first training run. Adjust settings here, then train again to compare a tuned run.
              </p>
              <ParameterSettings
                selectedAlgos={selectedAlgos}
                modelParams={modelParams}
                setModelParams={setModelParams}
              />
              <div style={{ textAlign: 'right', marginTop: 10 }}>
                <button className="ax-btn prim" disabled={training || selectedAlgos.length === 0} onClick={train}>
                  Train again with tuned settings
                </button>
              </div>
            </div>
          )}
        </>
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
      {plan.split && (
        <PlanLine label="Split">
          Train {Math.round((plan.split.train_size || 0.8) * 100)}% / test {Math.round((plan.split.test_size || 0.2) * 100)}%
          {plan.split.stratified ? ' with stratification' : ''}
        </PlanLine>
      )}
      {plan.class_weight && (
        <PlanLine label="Weights">
          Balanced class weights for supported classifiers.
        </PlanLine>
      )}
      {(plan.validation_checks || []).length > 0 && (
        <div style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: 6, padding: 10 }}>
          <p style={{ fontSize: 12, fontWeight: 500, margin: '0 0 6px' }}>Model readiness checklist</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {plan.validation_checks.map((check, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '18px 180px 1fr', gap: 8, fontSize: 11, alignItems: 'start' }}>
                <span style={{ color: check.status === 'block' ? 'var(--color-text-danger)' : check.status === 'warning' ? 'var(--color-text-warning)' : 'var(--color-text-success)' }}>
                  {check.status === 'block' ? '!' : check.status === 'warning' ? '-' : '✓'}
                </span>
                <strong>{check.label}</strong>
                <span style={{ color: 'var(--color-text-secondary)' }}>{check.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {(plan.hard_blocks || []).length > 0 && (
        <div style={{ background: 'var(--color-background-danger)', color: 'var(--color-text-danger)', padding: '8px 10px', borderRadius: 6, fontSize: 12 }}>
          <strong>Fix before training:</strong>
          <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
            {plan.hard_blocks.map((b, i) => <li key={i}>{b.message}</li>)}
          </ul>
        </div>
      )}
      {(plan.multicollinearity || []).length > 0 && (
        <PlanLine label="Collinearity">
          {plan.multicollinearity.slice(0, 4).map((p) => `${p.feature_a} + ${p.feature_b} (${Number(p.correlation).toFixed(2)})`).join(' | ')}
          {plan.multicollinearity.length > 4 ? ` | +${plan.multicollinearity.length - 4} more` : ''}
        </PlanLine>
      )}
      {(plan.excluded_features || []).length > 0 && (
        <PlanLine label="Excluded">
          Identifier/constant columns removed: {plan.excluded_features.map((x) => x.feature).join(', ')}
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
          <button className="ax-btn" onClick={() => active.has_whatif ? onUseInWhatIf(active) : api.prepareModelForWhatIf(active.id).then(() => onUseInWhatIf({ ...active, has_whatif: true })).catch((err) => alert('Could not prepare model for What-if: ' + err.message))} type="button">
            Use in What-if
          </button>
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

function ModelDetail({ model }) {
  const influence = normalizeInfluence(model.feature_influence || model.feature_importance)
  const impLabels = influence.map((item) => item.feature)
  const impValues = influence.map((item) => item.relative_strength ?? item.strength)
  const cm = model.metrics?.confusion_matrix

  return (
    <>
      {impLabels.length > 0 && (
        <>
          <p className="ax-lbl" style={{ marginTop: 0 }}>Feature influence</p>
          <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '-4px 0 8px' }}>
            Influence is aggregated to original dataset columns. It may be affected by correlated features.
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

function targetOptions(mode, positiveClass, testSize, stratify, classWeight) {
  const options = {}
  if (mode && mode !== 'auto') options.mode = mode
  if (positiveClass) options.positive_class = positiveClass
  options.test_size = testSize
  options.stratify = stratify
  if (classWeight) options.class_weight = 'balanced'
  return options
}

