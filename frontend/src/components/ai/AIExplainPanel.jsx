import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, X } from 'lucide-react'
import { api } from '../../api'
import { InlineSpinner } from '../common/LoadingStates'
import { useAuth } from '../providers/AuthProvider'

export const explainConfig = {
  r2: {
    whatItMeans: "R² measures how much of the variation in the target variable the model explains. 1.0 = perfect prediction, 0 = no better than guessing the average. Higher is better."
  },
  rmse: {
    whatItMeans: "RMSE is the typical size of prediction errors in the same units as the target variable. Lower is better. Whether it's good or bad depends on the target variable's scale."
  },
  gap: {
    whatItMeans: "The train-test gap shows if the model memorized training data instead of learning general patterns. A large gap means overfitting: the model performs well on training data but poorly on new, unseen data."
  },
  risk: {
    whatItMeans: "This indicates potential issues with the model that require attention. High overfitting risk means the model may not generalize well to new data."
  },
  modelHealth: {
    whatItMeans: "Model health summarizes how well the model generalizes from training to test data. A healthy model has similar performance on both sets, indicating it learned real patterns rather than memorizing noise."
  },
  comparisonRow: {
    whatItMeans: "This row compares how each algorithm performed. Higher values are better for R², Accuracy, Precision, Recall, and F1. Lower values are better for RMSE and MAE."
  },
  featureInfluence: {
    whatItMeans: (element) => {
      const pct = element?.value ?? 0
      if (pct > 50) return `This is the strongest predictor because it explains the most variation in the target variable. With ${pct}% importance, it dominates the model's decisions.`
      if (pct >= 15) return `This feature has meaningful influence on predictions. At ${pct}% importance, it contributes to the model's decision-making but is not the primary driver.`
      if (pct > 0) return `This feature adds some predictive value. At ${pct}% importance, it has a minor role compared to stronger features.`
      return `This feature adds no predictive value once the other features are already known. It could potentially be removed from the model.`
    }
  },
  parameter: {
    whatItMeans: "This parameter controls how the model learns from data. Adjusting it can improve accuracy, reduce overfitting, or speed up training."
  }
}

const verdictLabels = {
  good: { label: 'Good — reliable for this use case', color: '#15803D', bg: '#DCFCE7' },
  warning: { label: 'Acceptable — consider improving', color: '#A16207', bg: '#FEF3C7' },
  risk: { label: 'Risky — interpret results carefully', color: '#B91C1C', bg: '#FEE2E2' }
}

export function r2FallbackLabel(val) {
  if (val == null) return null
  if (val >= 0.7) return 'Strong fit'
  if (val >= 0.5) return 'Moderate fit'
  return 'Weak fit'
}

export function rmseFallbackLabel(val, targetMean) {
  if (val == null || !targetMean) return null
  const pct = (val / targetMean * 100).toFixed(1)
  return `≈ ${pct}% typical error`
}

export function gapFallbackLabel(val) {
  if (val == null) return null
  const absVal = Math.abs(val)
  if (absVal < 0.05) return 'Low overfitting risk'
  if (absVal < 0.2) return 'Moderate overfitting risk'
  return 'High overfitting risk'
}

const fallbackLabelStyle = { fontSize: '10px', color: 'var(--color-text-tertiary)', fontStyle: 'italic', margin: '4px 0 0', lineHeight: 1.3 }

export function FallbackLabel({ text }) {
  if (!text) return null
  return <p style={fallbackLabelStyle}>{text}</p>
}

export function AIExplainToggle({ active, onToggle, disabled }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 11, fontWeight: 650,
        padding: '6px 12px', borderRadius: 8,
        border: active ? '1.5px solid #f97316' : '1.5px solid var(--color-border-secondary)',
        background: active ? '#FFF7ED' : 'transparent',
        color: active ? '#C2410C' : 'var(--color-text-tertiary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all .15s ease'
      }}
      title={active ? 'Turn off Explain Mode' : 'Turn on Explain Mode'}
    >
      <Sparkles size={14} />
      Explain Mode
      <span style={{
        display: 'inline-block',
        width: 10, height: 10, borderRadius: '50%',
        background: active ? '#f97316' : 'var(--color-border-secondary)',
        transition: 'all .15s ease'
      }} />
    </button>
  )
}

export function ResultsSummary({ models, activeIdx, isClassification }) {
  if (!models || models.length === 0) return null
  const active = models[activeIdx] || models[0]
  const r2 = active.metrics?.r2
  const gap = active.metrics?.generalization_gap
  const modelName = active.label || algoLabelForTask(active.algorithm, active.metrics?.task)
  const gapDesc = gapFallbackLabel(gap)
  if (isClassification) {
    const acc = active.metrics?.accuracy
    return (
      <div style={{
        padding: '14px 18px',
        background: '#FFF7ED',
        borderLeft: '4px solid #f97316',
        borderRadius: 12,
        marginBottom: 20,
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--color-text-primary)'
      }}>
        <strong>{modelName}</strong> is the best performing model with{' '}
        <strong>{(acc * 100).toFixed(1)}% accuracy</strong>
        {gap != null && (
          <> and <span style={{ color: gapDesc === 'Low overfitting risk' ? '#15803D' : '#C2410C' }}>{gapDesc.toLowerCase()}</span>.</>
        )}
      </div>
    )
  }
  return (
    <div style={{
      padding: '14px 18px',
      background: '#FFF7ED',
      borderLeft: '4px solid #f97316',
      borderRadius: 12,
      marginBottom: 20,
      fontSize: 13,
      lineHeight: 1.5,
      color: 'var(--color-text-primary)'
    }}>
      <strong>{modelName}</strong> is the best performing model with{' '}
      <strong>R² = {r2 != null ? r2.toFixed(3) : 'n/a'}</strong>
      {gap != null && (
        <> and <span style={{ color: gapDesc === 'Low overfitting risk' ? '#15803D' : '#C2410C' }}>{gapDesc.toLowerCase()}</span> ({'gap = '}{Math.abs(gap).toFixed(3)}).</>
      )}
    </div>
  )
}

function algoLabelForTask(algo, task) {
  if (!algo) return 'Model'
  const labels = { logistic: 'Logistic Regression', rf: 'Random Forest', tree: 'Decision Tree (CART)', linear: 'Linear Regression' }
  return labels[algo] || algo
}

function VerdictBadge({ verdictKey, customLabel }) {
  const v = verdictLabels[verdictKey]
  if (!v) return null
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 999,
      fontSize: 11, fontWeight: 600,
      background: v.bg, color: v.color
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: v.color, flexShrink: 0 }} />
      {customLabel || v.label}
    </span>
  )
}

function getVerdict(metricKey, value) {
  if (metricKey === 'r2') {
    return value > 0.7 ? 'good' : value > 0.4 ? 'warning' : 'risk'
  }
  if (metricKey === 'gap') {
    return Math.abs(value) < 0.05 ? 'good' : Math.abs(value) < 0.2 ? 'warning' : 'risk'
  }
  if (metricKey === 'featureInfluence') {
    return value >= 15 ? 'good' : value >= 5 ? 'warning' : 'risk'
  }
  return 'good'
}

function buildContextFromElement(element) {
  if (!element) return ''
  const ctx = { clickedMetric: element.metricKey || element.type }
  if (element.model) {
    const m = element.model
    ctx.targetVariable = m.target || 'target'
    ctx.targetMean = m.metrics?.target_mean || null
    ctx.targetRange = m.metrics?.target_range || null
    ctx.targetUnit = m.metrics?.target_unit || ''
    ctx.modelType = algoLabelForTask(m.algorithm, m.metrics?.task)
    ctx.r2 = m.metrics?.r2 || null
    ctx.rmse = m.metrics?.rmse || null
    ctx.trainTestGap = m.metrics?.generalization_gap || null
    ctx.accuracy = m.metrics?.accuracy || null
    ctx.task = m.metrics?.task || 'regression'
  }
  if (element.value != null) ctx.metricValue = element.value
  if (element.featureName) {
    ctx.featureName = element.featureName
    ctx.importancePercent = element.value
    ctx.rank = element.rank
    ctx.totalFeatures = element.totalFeatures
  }
  if (element.paramKey) {
    ctx.parameter = element.paramKey
    ctx.parameterValue = element.paramValue
    ctx.parameterLabel = element.paramLabel
    ctx.algoName = element.algoName
  }
  return ctx
}

export function ExplainPopup({ element, onClose, datasetId }) {
  const auth = useAuth()
  const popupRef = useRef(null)
  const [position, setPosition] = useState({ top: 80, left: 16 })
  const [aiText, setAiText] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [mode, setMode] = useState('normal')
  const [followUpInput, setFollowUpInput] = useState('')
  const [followUpLoading, setFollowUpLoading] = useState(false)
  const [aiError, setAiError] = useState(null)

  const configKey = element?.metricKey || element?.type || 'r2'
  const config = explainConfig[configKey] || explainConfig.r2
  const value = element?.value
  const verdictKey = getVerdict(configKey, value)
  const sectionName = element?.section || 'Model Results'
  const context = buildContextFromElement(element)

  const generateAIExplanation = useCallback(async () => {
    if (!datasetId) return
    if (auth.isGuest) {
      auth.requireAccountForAI()
      return
    }
    setAiLoading(true)
    setAiError(null)
    try {
      const ctxJson = JSON.stringify(context)
      const question = `Explain the ${element?.metricKey || element?.type} value of ${element?.value} for a model predicting ${context.targetVariable} with these stats: ${ctxJson}`
      const r = await api.aiExplain(datasetId, `models-${configKey}`, context, question, { element, context })
      const explanation = r?.explanation || 'No explanation returned.'
      setAiText(explanation)
    } catch (err) {
      setAiError('Could not generate AI explanation right now.')
    } finally {
      setAiLoading(false)
    }
  }, [datasetId, configKey, context, element, auth])

  const handleFollowUp = async () => {
    if (!followUpInput.trim() || !datasetId) return
    if (auth.isGuest) {
      auth.requireAccountForAI()
      return
    }
    setFollowUpLoading(true)
    try {
      const ctxJson = JSON.stringify(context)
      const r = await api.aiExplain(datasetId, `models-${configKey}-followup`, context, followUpInput, { element, context, previous: aiText })
      setAiText(r?.explanation || 'No response.')
      setFollowUpInput('')
    } catch {
      setAiError('Could not get response.')
    } finally {
      setFollowUpLoading(false)
    }
  }

  useEffect(() => {
    if (element?.sourceRect && popupRef.current) {
      const popupW = 300
      const popupH = 460
      const { innerWidth, innerHeight } = window
      let top = element.sourceRect.bottom + 8
      let left = Math.max(8, Math.min(element.sourceRect.left, innerWidth - popupW - 8))
      if (top + popupH > innerHeight - 16) {
        top = Math.max(8, element.sourceRect.top - popupH - 8)
      }
      setPosition({ top, left })
    }
  }, [element?.sourceRect])

  useEffect(() => {
    if (mode === 'normal' && !aiText && !aiLoading && !aiError) {
      generateAIExplanation()
    }
  }, [mode, aiText, aiLoading, aiError, generateAIExplanation])

  const handleSimplify = () => {
    setMode('simple')
    setAiLoading(true)
    setAiError(null)
    setTimeout(async () => {
      try {
        const ctxJson = JSON.stringify(context)
        const question = `Explain this in very simple terms (one sentence): the ${element?.metricKey} is ${element?.value} for ${context.targetVariable}`
        const r = await api.aiExplain(datasetId, `models-${configKey}-simple`, context, question, { element, context })
        setAiText(r?.explanation || 'Could not simplify.')
      } catch {
        setAiText('Could not generate simplified explanation right now.')
      } finally {
        setAiLoading(false)
      }
    }, 100)
  }

  const handleTechnical = () => {
    setMode('technical')
    setAiLoading(true)
    setAiError(null)
    setTimeout(async () => {
      try {
        const ctxJson = JSON.stringify(context)
        const question = `Provide the technical formula and full statistical details for ${element?.metricKey} (value: ${element?.value}) in context of ${context.targetVariable}. Keep it concise, 2-3 sentences.`
        const r = await api.aiExplain(datasetId, `models-${configKey}-tech`, context, question, { element, context })
        setAiText(r?.explanation || 'No technical details available.')
      } catch {
        setAiText('Could not generate technical details right now.')
      } finally {
        setAiLoading(false)
      }
    }, 100)
  }

  return createPortal(
    <div
      ref={popupRef}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: 300,
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 4px 20px rgba(0,0,0,.12)',
        zIndex: 9999,
        fontSize: 12,
        color: '#1e293b',
        overflow: 'hidden'
      }}
    >
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          AI EXPLAIN · {sectionName}
        </span>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#94a3b8' }}>
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: '12px 16px', maxHeight: 360, overflowY: 'auto' }}>
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>What this means</p>
          <p style={{ margin: 0, lineHeight: 1.5, color: '#475569' }}>
            {typeof config.whatItMeans === 'function' ? config.whatItMeans(element) : (config.whatItMeans || 'No explanation available.')}
          </p>
        </div>

        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>In your dataset</p>
          {aiLoading ? (
            <div style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
              <div style={{ width: '100%' }}>
                <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4, marginBottom: 6, animation: 'ax-pulse 1.5s ease-in-out infinite' }} />
                <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4, width: '80%', animation: 'ax-pulse 1.5s ease-in-out infinite 0.2s' }} />
                <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4, width: '60%', animation: 'ax-pulse 1.5s ease-in-out infinite 0.4s' }} />
              </div>
            </div>
          ) : aiError ? (
            <p style={{ margin: 0, color: '#b91c1c', fontSize: 11 }}>{aiError}</p>
          ) : (
            <p style={{ margin: 0, lineHeight: 1.5, color: '#475569' }}>{aiText}</p>
          )}
        </div>

        {value != null && (
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>Verdict</p>
            <VerdictBadge
              verdictKey={verdictKey}
              customLabel={configKey === 'featureInfluence' ? (
                value >= 15 ? 'Key predictor' : value >= 5 ? 'Supporting predictor' : 'Consider removing'
              ) : undefined}
            />
          </div>
        )}
      </div>

      {mode === 'followup' && (
        <div style={{ padding: '8px 16px 12px', borderTop: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={followUpInput}
              onChange={(e) => setFollowUpInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleFollowUp() }}
              placeholder="Ask a follow-up..."
              style={{
                flex: 1, fontSize: 11, padding: '6px 8px', borderRadius: 6,
                border: '1px solid #e2e8f0', outline: 'none'
              }}
            />
            <button
              type="button"
              onClick={handleFollowUp}
              disabled={followUpLoading || !followUpInput.trim()}
              style={{
                padding: '6px 10px', borderRadius: 6, border: '1px solid #f97316',
                background: followUpLoading ? '#FFF7ED' : '#fff',
                color: '#C2410C', fontSize: 11, fontWeight: 600, cursor: 'pointer'
              }}
            >
              {followUpLoading ? '...' : 'Ask'}
            </button>
          </div>
        </div>
      )}

      <div style={{ padding: '8px 16px 12px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" onClick={handleSimplify} disabled={aiLoading} style={{ ...btnStyle }}>Explain simpler</button>
        <button type="button" onClick={handleTechnical} disabled={aiLoading} style={{ ...btnStyle }}>Technical details</button>
        <button type="button" onClick={() => setMode(mode === 'followup' ? 'normal' : 'followup')} style={{ ...btnStyle }}>
          {mode === 'followup' ? 'Close chat' : 'Ask follow-up'}
        </button>
      </div>
    </div>,
    document.body
  )
}

const btnStyle = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid #e2e8f0',
  background: '#fff',
  color: '#475569',
  fontSize: 10,
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
}
