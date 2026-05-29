/* ============================================================
 * COMPONENT: GuidedFocusCard
 * Keywords: guided workflow, spotlight, contextual card
 * ============================================================ */
import React, { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { cleaningIssuesFromSuggestions, currentCoachStep, nextCoachStep } from './ProjectGuidanceSetup'
import { checkCoachCompletion, routeTarget } from './GuidedCoach'

const STEP_CONFIGS = {
  'data.suggested_fixes': {
    toolKey: 'missing',
    title: 'Missing values',
    iconName: 'circle-dotted',
    why: 'Blanks can break downstream mathematical operations and model training.',
    subSteps: {
      1: {
        title: 'Start with the Missing button',
        action: 'Click Missing in the Quality group of the toolbar above',
        spotlight: '#tb-missing'
      },
      2: {
        title: 'Review and apply the fix',
        action: 'Check the recommended methods and click Apply',
        spotlight: '.papply'
      },
      3: {
        title: 'Review your changes',
        action: 'Inspect the updated preview and recent changes below',
        spotlight: null
      }
    }
  },
  'data.outliers': {
    toolKey: 'outliers',
    title: 'Outliers',
    iconName: 'alert-triangle',
    why: 'Extreme values can distort statistical models and regression algorithms.',
    subSteps: {
      1: {
        title: 'Start with the Outliers button',
        action: 'Click Outliers in the Quality group of the toolbar above',
        spotlight: '#tb-outliers'
      },
      2: {
        title: 'Review and apply the fix',
        action: 'Check the recommended methods and click Apply',
        spotlight: '.papply'
      },
      3: {
        title: 'Review your changes',
        action: 'Inspect the updated preview and recent changes below',
        spotlight: null
      }
    }
  },
  'data.duplicates': {
    toolKey: 'duplicates',
    title: 'Duplicates',
    iconName: 'copy-off',
    why: 'Duplicate records can artificially inflate weights and skew patterns.',
    subSteps: {
      1: {
        title: 'Start with the Duplicates button',
        action: 'Click Duplicates in the Quality group of the toolbar above',
        spotlight: '#tb-duplicates'
      },
      2: {
        title: 'Review and apply the fix',
        action: 'Choose which occurrence to keep and click Remove',
        spotlight: '.papply'
      },
      3: {
        title: 'Review your changes',
        action: 'Inspect the updated preview and recent changes below',
        spotlight: null
      }
    }
  },
  'data.categories': {
    toolKey: 'labels',
    title: 'Labels',
    iconName: 'tag',
    why: 'Fuzzy labels create redundant unique values, fracturing categories.',
    subSteps: {
      1: {
        title: 'Start with the Labels button',
        action: 'Click Labels in the Transform group of the toolbar above',
        spotlight: '#tb-labels'
      },
      2: {
        title: 'Review and apply the fix',
        action: 'Standardize similar category labels and click Apply',
        spotlight: '.papply'
      },
      3: {
        title: 'Review your changes',
        action: 'Inspect the updated preview and recent changes below',
        spotlight: null
      }
    }
  }
}

export default function GuidedFocusCard({ dataset, activeTab, cleaningIssues, onGuidanceUpdated }) {
  const navigate = useNavigate()
  const guidance = dataset?.guidance || {}
  
  const [subStep, setSubStep] = useState(1)
  const [busy, setBusy] = useState(false)
  const [suggestionData, setSuggestionData] = useState(null)
  const liveCleaningIssues = suggestionData ? cleaningIssuesFromSuggestions(suggestionData) : cleaningIssues
  const current = currentCoachStep(guidance, dataset, liveCleaningIssues)

  // Retrieve current step configuration
  const config = useMemo(() => {
    if (!current?.id) return null
    return STEP_CONFIGS[current.id] || null
  }, [current?.id])

  // Load cleaning suggestions to count/describe issues
  useEffect(() => {
    if (!dataset?.id || !config) return
    api.cleanSuggestions(dataset.id)
      .then(res => setSuggestionData(res))
      .catch(err => console.error(err))
  }, [dataset?.id, dataset?.current_stage_id, config])

  // Detect popover open/close states and check if we are in sub-step 2
  useEffect(() => {
    if (!config) return
    const interval = setInterval(() => {
      const btn = document.getElementById(`tb-${config.toolKey}`)
      const isBtnActive = btn?.classList.contains('active')
      setSubStep(currentSub => {
        if (currentSub === 3) return 3
        return isBtnActive ? 2 : 1
      })
    }, 300)
    return () => clearInterval(interval)
  }, [config])

  // Listen to custom window events for manual triggers
  useEffect(() => {
    if (!config) return
    const handlePopoverOpen = (e) => {
      if (e.detail?.tool === config.toolKey) {
        setSubStep(2)
      }
    }
    const handleApplySuccess = () => {
      setSubStep(3)
    }
    window.addEventListener('simucast:popover-open', handlePopoverOpen)
    window.addEventListener('simucast:apply-success', handleApplySuccess)
    return () => {
      window.removeEventListener('simucast:popover-open', handlePopoverOpen)
      window.removeEventListener('simucast:apply-success', handleApplySuccess)
    }
  }, [config])

  // Periodic DOM scanner to add/remove .spotlight class
  useEffect(() => {
    if (!config) return

    const currentSubStepData = config.subSteps[subStep]
    const selector = currentSubStepData?.spotlight

    const clearSpotlights = () => {
      document.querySelectorAll('.spotlight').forEach(el => {
        el.classList.remove('spotlight')
      })
    }

    clearSpotlights()
    if (!selector) return

    const applySpotlight = () => {
      const el = document.querySelector(selector)
      if (el && !el.classList.contains('spotlight')) {
        clearSpotlights()
        el.classList.add('spotlight')
      }
    }

    applySpotlight()
    const interval = setInterval(applySpotlight, 300)

    return () => {
      clearInterval(interval)
      clearSpotlights()
    }
  }, [config, subStep])

  // Reset sub-step when active step changes
  useEffect(() => {
    setSubStep(1)
  }, [current?.id])

  if (!dataset?.id || !guidance.guided_mode || !current || !config || activeTab !== 'data') return null

  // Calculate descriptive what simucast sees text
  const getSeesText = () => {
    if (!suggestionData) return 'Checking columns for issues...'
    const key = config.toolKey
    if (key === 'missing') {
      const count = suggestionData.groups?.missing?.columns?.length || 0
      return count > 0 
        ? `${count} column${count === 1 ? '' : 's'} have missing values.` 
        : 'No missing values detected in the current stage.'
    }
    if (key === 'outliers') {
      const count = suggestionData.groups?.outliers?.columns?.length || 0
      return count > 0 
        ? `${count} column${count === 1 ? '' : 's'} have outliers.` 
        : 'No outliers detected in the current stage.'
    }
    if (key === 'duplicates') {
      const count = suggestionData.groups?.duplicates?.count || 0
      return count > 0 
        ? `${count} duplicate row${count === 1 ? '' : 's'} detected.` 
        : 'No duplicate rows detected in the current stage.'
    }
    if (key === 'labels') {
      return 'Inconsistent or fuzzy categories detected in categorical columns.'
    }
    return 'Analyzing active data stage...'
  }

  const persist = async (body) => {
    setBusy(true)
    try {
      const response = await api.updateGuidance(dataset.id, body)
      onGuidanceUpdated?.(response.guidance)
    } finally {
      setBusy(false)
    }
  }

  const handleDoneReviewing = () => {
    const btn = document.getElementById(`tb-${config.toolKey}`)
    if (btn) {
      btn.click()
    }
    setSubStep(2)
  }

  const handleAdvance = async () => {
    // If not completed yet, run checkCoachCompletion
    const verifiedComplete = await checkCoachCompletion(dataset, current)
    
    // In labels, standard checkCoachCompletion doesn't check label standardization
    // Since labels isn't strictly required, we can allow proceed if verified or subStep === 3
    const canGo = verifiedComplete || subStep === 3 || current.requirement !== 'required'

    if (!canGo) {
      // Prompt user to apply the fix
      return
    }

    const dismissed = guidance.dismissed_tips || []
    const completed = [...new Set([...(guidance.completed_tips || []), current.id])]
    const next = nextCoachStep(guidance.goal, dataset, current.id, dismissed, liveCleaningIssues)
    
    await persist({
      completed_tips: completed,
      walkthrough_step: next?.id || null,
      guided_mode: Boolean(next),
    })

    if (next) {
      routeTarget(dataset.id, next, activeTab, navigate)
    }
  }

  const currentSub = config.subSteps[subStep]

  return (
    <aside
      className="ax-guided-coach anchored"
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: 10000,
        width: '340px',
        maxHeight: '400px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.15)',
        border: '1px solid rgba(249, 115, 22, 0.25)',
        background: 'rgba(255, 255, 255, 0.98)',
        backdropFilter: 'blur(8px)',
        borderRadius: '12px',
        padding: '16px',
        animation: 'ax-guided-ring-in 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      <div className="ax-guided-coach-step-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
        <p className="ax-kicker" style={{ margin: 0, textTransform: 'uppercase', fontSize: '9.5px', fontWeight: 800, letterSpacing: '0.08em', color: '#f97316' }}>
          Guided Focus · {subStep} of 3
        </p>
        <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>{config.title}</span>
      </div>

      <strong style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-text-primary)', display: 'block', margin: '2px 0 6px' }}>
        {currentSub?.title}
      </strong>

      <div style={{ fontSize: '12.5px', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: '8px', lineHeight: 1.45 }}>
        {subStep === 1 && (
          <p style={{ margin: 0 }}>
            <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>What SimuCast sees:</span><br />
            {getSeesText()}
          </p>
        )}
        
        <p style={{ margin: 0 }}>
          <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>Do this now:</span><br />
          {currentSub?.action}
        </p>

        {subStep === 1 && config.why && (
          <p style={{ margin: 0, fontSize: '11.5px', opacity: 0.85, borderLeft: '2px solid #fdba74', paddingLeft: '8px' }}>
            <span style={{ fontWeight: 600 }}>Why:</span> {config.why}
          </p>
        )}
      </div>

      <div className="ax-guided-coach-actions" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '12px', paddingTop: '10px', borderTop: '0.5px solid var(--color-border-tertiary)' }}>
        {subStep === 1 && (
          <button className="ax-btn mini prim" type="button" onClick={handleDoneReviewing} style={{ background: '#f97316', borderColor: '#f97316', color: '#ffffff' }}>
            I am done reviewing
          </button>
        )}
        
        {subStep === 2 && (
          <button className="ax-btn mini ghost" type="button" onClick={() => setSubStep(1)}>
            Back
          </button>
        )}

        {subStep === 3 && (
          <button className="ax-btn mini prim" type="button" disabled={busy} onClick={handleAdvance} style={{ background: '#f97316', borderColor: '#f97316', color: '#ffffff' }}>
            Next step
          </button>
        )}

        <button className="ax-link-btn" type="button" disabled={busy} onClick={() => persist({ guided_mode: false })} style={{ marginLeft: 'auto', fontSize: '11.5px', color: 'var(--color-text-secondary)' }}>
          Explore freely
        </button>
      </div>
    </aside>
  )
}
