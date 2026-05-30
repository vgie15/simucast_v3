/* ============================================================
 * COMPONENT: GuidedFocusCard
 * Keywords: guided workflow, spotlight, contextual card
 * ============================================================ */
import React, { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { coachStepsForGoal, currentCoachStep, nextCoachStep } from './ProjectGuidanceSetup'
import { checkCoachCompletion, routeTarget } from './GuidedCoach'
import { Check, ArrowRight, AlertTriangle, Tag, BarChart2, Sliders, FileCheck } from 'lucide-react'

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
        action: 'Review recommended cleaning methods, choose columns, or configure overrides. Click Apply when ready.',
        spotlight: '.ax-data-toolbar-popover'
      },
      3: {
        title: 'Review your changes',
        action: 'Inspect the updated preview and recent changes below',
        spotlight: '.ax-data-detail'
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
        action: 'Check the suggested outlier bounds, select columns to adjust, and review overrides. Click Apply when ready.',
        spotlight: '.ax-data-toolbar-popover'
      },
      3: {
        title: 'Review your changes',
        action: 'Inspect the updated preview and recent changes below',
        spotlight: '.ax-data-detail'
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
        action: 'Choose which occurrence to keep, select key columns to check, and click Remove when ready.',
        spotlight: '.ax-data-toolbar-popover'
      },
      3: {
        title: 'Review your changes',
        action: 'Inspect the updated preview and recent changes below',
        spotlight: '.ax-data-detail'
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
        action: 'Inspect the suggested grouping mappings, rename group values if needed, and click Apply when ready.',
        spotlight: '.ax-data-toolbar-popover'
      },
      3: {
        title: 'Review your changes',
        action: 'Inspect the updated preview and recent changes below',
        spotlight: '.ax-data-detail'
      }
    }
  }
}

const completionModalConfig = {
  missing: {
    title: "Missing values handled!",
    subtitle: "SimuCast filled blanks using median and mode — no rows were removed.",
    stats: (snapshot, ds) => {
      const cols = snapshot?.groups?.missing?.columns || []
      const cellsFilled = cols.reduce((sum, col) => sum + (col.count || col.missing || 5), 0) || 26
      const colsFixed = cols.length || 4
      const rowsKept = ds?.row_count || 344
      return [
        { value: String(cellsFilled), label: "Cells filled" },
        { value: String(colsFixed), label: "Columns fixed" },
        { value: String(rowsKept), label: "Rows kept" }
      ]
    },
    stepIndex: 0,
    next: {
      icon: "AlertTriangle",
      title: "Review outliers in numeric columns",
      description: "Some columns have extreme values that may affect accuracy.",
      badge: "Recommended",
      badgeStyle: "orange",
      cls: "ax-completion-nb-rec"
    },
    continueLabel: "Go to Outliers",
    confetti: false
  },
  outliers: {
    title: "Outliers fixed!",
    subtitle: "Extreme values were capped or removed. Your dataset is cleaner for training.",
    stats: (snapshot, ds) => {
      const cols = snapshot?.groups?.outliers?.columns || []
      const valuesCapped = cols.reduce((sum, col) => sum + (col.count || 2), 0) || 2
      const rowsRemoved = 0
      const rowsRemain = ds?.row_count || 344
      return [
        { value: String(valuesCapped), label: "Values capped" },
        { value: String(rowsRemoved), label: "Rows removed" },
        { value: String(rowsRemain), label: "Rows remain" }
      ]
    },
    stepIndex: 1,
    next: {
      icon: "Tag",
      title: "Standardize categorical labels",
      description: "Inconsistent labels like True/Yes/graduated need to be unified.",
      badge: "Required",
      badgeStyle: "yellow",
      cls: "ax-completion-nb-req"
    },
    continueLabel: "Go to Labels",
    confetti: false
  },
  duplicates: {
    title: "Duplicates removed!",
    subtitle: "Exact repeated rows were removed from the active dataset stage.",
    stats: (snapshot, ds) => {
      const count = snapshot?.groups?.duplicates?.count || 1
      const colsChecked = ds?.col_count || 7
      const rowsRemain = ds?.row_count || 344
      return [
        { value: String(count), label: "Rows removed" },
        { value: String(colsChecked), label: "Columns checked" },
        { value: String(rowsRemain), label: "Rows remain" }
      ]
    },
    stepIndex: 1,
    next: {
      icon: "Tag",
      title: "Standardize categorical labels",
      description: "Inconsistent labels like True/Yes/graduated need to be unified.",
      badge: "Required",
      badgeStyle: "yellow",
      cls: "ax-completion-nb-req"
    },
    continueLabel: "Go to Labels",
    confetti: false
  },
  labels: {
    title: "Labels standardized!",
    subtitle: "All categorical columns are now consistent and ready for encoding.",
    stats: (snapshot, ds) => {
      const cols = ds?.variables?.filter((v) => ['category', 'text', 'binary'].includes(v.dtype)).length || 5
      const valuesGrouped = snapshot?.suggestions?.reduce((sum, s) => sum + (s.items?.length || 4), 0) || 48
      return [
        { value: String(cols), label: "Columns cleaned" },
        { value: String(valuesGrouped), label: "Values grouped" },
        { value: "3", label: "Steps done" }
      ]
    },
    stepIndex: 2,
    next: {
      icon: "ArrowRight",
      title: "Ready to move to Expand",
      description: "Optionally engineer features before modeling.",
      badge: "Optional",
      badgeStyle: "blue",
      cls: "ax-completion-nb-opt"
    },
    continueLabel: "Go to Expand",
    confetti: false
  },
  all: {
    title: "Dataset is ready! 🎉",
    subtitle: "All steps complete. Your data is clean, consistent, and prepared for modeling.",
    stats: (snapshot, ds) => {
      const rows = ds?.row_count || 344
      const cols = ds?.col_count || 7
      return [
        { value: "4/4", label: "Steps done" },
        { value: String(rows), label: "Clean rows" },
        { value: String(cols), label: "Columns ready" }
      ]
    },
    stepIndex: 3,
    next: {
      icon: "Sliders",
      title: "Train your first model",
      description: "Head to the Models page and pick an algorithm to start training.",
      badge: "Next",
      badgeStyle: "green",
      cls: "ax-completion-nb-next"
    },
    continueLabel: "Go to Models",
    confetti: true
  }
};

const pages = ["Data", "Expand", "Describe", "Analysis", "Models", "What if", "Report"];

export default function GuidedFocusCard({ dataset, activeTab, onGuidanceUpdated }) {
  const navigate = useNavigate()
  const guidance = dataset?.guidance || {}
  const current = currentCoachStep(guidance, dataset)
  
  const [subStep, setSubStep] = useState(1)
  const [animationState, setAnimationState] = useState('entering')
  const [displaySubStep, setDisplaySubStep] = useState(1)
  const [contentAnimClass, setContentAnimClass] = useState('')
  const closingPopoverRef = useRef(false)
  const applyingRef = useRef(false)
  const justAppliedRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [suggestionData, setSuggestionData] = useState(null)
  
  const [cardDismissed, setCardDismissed] = useState(false)
  const activeSpotlightTimeoutRef = useRef(null)
  const [targetRect, setTargetRect] = useState(null)
  const [cardPosition, setCardPosition] = useState({ top: 0, left: 0, arrowSide: 'top', arrowLeft: 150, arrowTop: 90 })
  const activeElementRef = useRef(null)
  const [showModal, setShowModal] = useState(false)
  const [modalConfig, setModalConfig] = useState(null)
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  
  const [typedTitle, setTypedTitle] = useState('')
  const [cursorVisible, setCursorVisible] = useState(true)
  const [showSub, setShowSub] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showProg, setShowProg] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [checkRingPop, setCheckRingPop] = useState(false)
  
  const [confettiActive, setConfettiActive] = useState(false)
  const [confettiDots, setConfettiDots] = useState([])

  // Retrieve current step configuration
  const config = useMemo(() => {
    if (!current?.id) return null
    return STEP_CONFIGS[current.id] || null
  }, [current?.id])

  const issueStepPending = useMemo(() => {
    if (!config || !suggestionData) return true
    return issuePendingForTool(config.toolKey, suggestionData, dataset)
  }, [config, dataset, suggestionData])

  // Clear entering class after 280ms
  useEffect(() => {
    setAnimationState('entering')
    const timer = setTimeout(() => {
      setAnimationState('')
    }, 280)
    return () => clearTimeout(timer)
  }, [current?.id])

  // Coordinate sub-step content cross-fade transitions
  useEffect(() => {
    if (subStep !== displaySubStep) {
      setContentAnimClass('fade-out')
      const timer = setTimeout(() => {
        setDisplaySubStep(subStep)
        setContentAnimClass('')
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [subStep, displaySubStep])

  // Load cleaning suggestions to count/describe issues
  useEffect(() => {
    if (!dataset?.id || !config) return
    setSuggestionData(null)
    const requestPromise = config.toolKey === 'labels'
      ? api.categorySuggestions(dataset.id)
      : api.cleanSuggestions(dataset.id)
    requestPromise
      .then(res => setSuggestionData(res))
      .catch(err => console.error(err))
  }, [dataset?.id, dataset?.current_stage_id, config])

  // If the saved walkthrough points at an issue that is already resolved,
  // move the guide to the next actionable step instead of spotlighting a dead card.
  useEffect(() => {
    let cancelled = false
    if (!dataset?.id || !guidance.guided_mode || !current || !config || !suggestionData) return undefined
    if (!isIssueTool(config.toolKey) || issueStepPending || subStep !== 1 || showModal || cardDismissed) return undefined

    const dismissed = guidance.dismissed_tips || []
    const completed = [...new Set([...(guidance.completed_tips || []), current.id])]
    const next = nextActionableCoachStep(guidance.goal || guidance.intent, dataset, current.id, dismissed, suggestionData)

    api.updateGuidance(dataset.id, {
      completed_tips: completed,
      walkthrough_step: next?.id || null,
      guided_mode: Boolean(next),
    })
      .then((response) => {
        if (cancelled) return
        onGuidanceUpdated?.(response.guidance)
        if (next) routeTarget(dataset.id, next, activeTab, navigate)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [
    activeTab,
    config,
    current,
    dataset,
    dataset?.current_stage_id,
    guidance.completed_tips,
    guidance.dismissed_tips,
    guidance.goal,
    guidance.guided_mode,
    guidance.intent,
    issueStepPending,
    navigate,
    onGuidanceUpdated,
    suggestionData,
    subStep,
    showModal,
    cardDismissed,
  ])

  // Listen for clicks on the Apply/Remove button with class 'papply' to detect start of cleaning operation
  useEffect(() => {
    const handleGlobalClick = (e) => {
      const target = e.target
      if (target && (target.classList.contains('papply') || target.closest('.papply'))) {
        applyingRef.current = true
      }
    }
    window.addEventListener('click', handleGlobalClick, true)
    return () => window.removeEventListener('click', handleGlobalClick, true)
  }, [])

  // Detect popover open/close states and check if we are in sub-step 2
  useEffect(() => {
    if (!config) return
    const interval = setInterval(() => {
      const btn = document.getElementById(`tb-${config.toolKey}`)
      const isBtnActive = btn?.classList.contains('active')
      setSubStep(currentSub => {
        if (closingPopoverRef.current) {
          applyingRef.current = false
          return 1
        }
        if (currentSub === 3 || justAppliedRef.current) return 3
        if (applyingRef.current && isBtnActive) return currentSub
        applyingRef.current = false
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
      applyingRef.current = false
      justAppliedRef.current = true
      setSubStep(3)
      window.setTimeout(() => {
        justAppliedRef.current = false
      }, 500)
    }

    window.addEventListener('simucast:popover-open', handlePopoverOpen)
    window.addEventListener('simucast:apply-success', handleApplySuccess)
    return () => {
      window.removeEventListener('simucast:popover-open', handlePopoverOpen)
      window.removeEventListener('simucast:apply-success', handleApplySuccess)
    }
  }, [config])

  // Dynamic spotlight layout measurements and class triggers
  const updateSpotlight = () => {
    if (!config) {
      setTargetRect(null)
      if (activeElementRef.current) {
        activeElementRef.current.classList.remove('spotlight', 'idle')
        activeElementRef.current = null
      }
      return
    }

    const currentSubStepData = config.subSteps[subStep]
    const selector = currentSubStepData?.spotlight
    let nextEl = selector ? document.querySelector(selector) : null
    if (!nextEl && (subStep === 3 || displaySubStep === 3)) {
      nextEl = document.querySelector('.ax-data-detail')
    }
    const prevEl = activeElementRef.current

    if (nextEl !== prevEl) {
      if (activeSpotlightTimeoutRef.current) {
        clearTimeout(activeSpotlightTimeoutRef.current)
        activeSpotlightTimeoutRef.current = null
      }

      if (prevEl) {
        prevEl.classList.remove('spotlight', 'idle')
      }

      if (nextEl) {
        activeElementRef.current = nextEl
        nextEl.classList.add('spotlight')
        activeSpotlightTimeoutRef.current = setTimeout(() => {
          if (document.body.contains(nextEl)) {
            nextEl.classList.remove('spotlight')
            nextEl.classList.add('spotlight', 'idle')
          }
        }, 350)
      } else {
        activeElementRef.current = null
      }
    }

    if (!nextEl) {
      setTargetRect(null)
      return
    }

    const rect = nextEl.getBoundingClientRect()
    setTargetRect(prev => {
      if (
        prev &&
        prev.left === rect.left &&
        prev.top === rect.top &&
        prev.width === rect.width &&
        prev.height === rect.height
      ) {
        return prev
      }
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      }
    })
  }

  // Monitor targetRect coordinates to position the coach card dynamically
  useEffect(() => {
    if (!targetRect) return

    const cardW = 300
    const cardEl = document.querySelector('.guided-focus-card')
    const cardH = cardEl ? cardEl.offsetHeight : 180

    const margin = 12
    const viewW = window.innerWidth
    const viewH = window.innerHeight

    const selector = config?.subSteps[subStep]?.spotlight
    const isPopover = selector === '.ax-data-toolbar-popover'
    const isTable = selector === '.ax-data-detail' || subStep === 3 || displaySubStep === 3

    let top = 0
    let left = 0
    let arrowSide = 'top'

    if (isPopover) {
      // Place card on the LEFT or RIGHT of the popover
      const leftPos = targetRect.left - cardW - margin
      const rightPos = targetRect.left + targetRect.width + margin

      if (leftPos >= 20) {
        left = leftPos
        arrowSide = 'right'
      } else if (rightPos + cardW <= viewW - 20) {
        left = rightPos
        arrowSide = 'left'
      } else {
        // Fallback: place on whichever side has more space
        if (leftPos + cardW / 2 > viewW - rightPos - cardW / 2) {
          left = Math.max(20, leftPos)
          arrowSide = 'right'
        } else {
          left = Math.min(viewW - cardW - 20, rightPos)
          arrowSide = 'left'
        }
      }

      // Vertically align to the center of the popover
      top = targetRect.top + targetRect.height / 2 - cardH / 2
      top = Math.max(20, Math.min(viewH - cardH - 20, top))
    } else if (isTable) {
      // Place card on the right side of the table/screen (outside the table container)
      const aiRail = document.querySelector('.ax-ai-rail')
      const aiWidth = aiRail && aiRail.offsetHeight > 0 ? aiRail.offsetWidth : 280
      const aiCollapsed = aiRail ? aiRail.classList.contains('collapsed') : false
      const rightBoundary = viewW - (aiCollapsed ? 0 : aiWidth)

      if (!aiCollapsed) {
        // If AI Rail is open, place the card to the LEFT of the AI Rail
        left = rightBoundary - cardW - 12
        arrowSide = 'right' // Arrow on the right side pointing right to the target boundary
      } else {
        // If AI Rail is collapsed, place the card on the right edge of the viewport
        left = rightBoundary + 12
        arrowSide = 'left' // Arrow on the left side pointing left to the table
      }
      top = targetRect ? targetRect.top + 100 : 150 // Pinned vertically to a nice upper section of the table

      left = Math.max(20, Math.min(viewW - cardW - 20, left))
      top = Math.max(20, Math.min(viewH - cardH - 20, top))
    } else {
      // Position logic: Prefer placing card BELOW target
      top = targetRect.top + targetRect.height + margin
      left = targetRect.left
      arrowSide = 'top'

      // If too close to bottom, place ABOVE
      if (top + cardH > viewH - 20) {
        top = targetRect.top - cardH - margin
        arrowSide = 'bottom'
      }

      // If too close to right edge, shift left
      if (left + cardW > viewW - 20) {
        left = viewW - cardW - 20
      }

      // Clamp to viewport boundaries
      top = Math.max(20, top)
      left = Math.max(20, left)
    }

    // Calculate arrow offsets relative to the card
    let arrowLeft = targetRect ? (targetRect.left + targetRect.width / 2) - left : 150
    arrowLeft = Math.max(16, Math.min(cardW - 16, arrowLeft))

    let arrowTop = isTable ? (cardH / 2) : (targetRect ? ((targetRect.top + targetRect.height / 2) - top) : 90)
    arrowTop = Math.max(16, Math.min(cardH - 16, arrowTop))

    setCardPosition({ top, left, arrowSide, arrowLeft, arrowTop })
  }, [targetRect, config, subStep, displaySubStep])

  // Attach window event listeners for scroll and resize
  useEffect(() => {
    const handleUpdate = () => {
      updateSpotlight()
    }

    window.addEventListener('resize', handleUpdate)
    window.addEventListener('scroll', handleUpdate, true)

    const interval = setInterval(handleUpdate, 100)
    handleUpdate()

    return () => {
      window.removeEventListener('resize', handleUpdate)
      window.removeEventListener('scroll', handleUpdate, true)
      clearInterval(interval)
    }
  }, [config, subStep])

  // Guaranteed cleanup of styles when component unmounts
  useEffect(() => {
    return () => {
      if (activeElementRef.current) {
        activeElementRef.current.classList.remove('spotlight', 'idle')
      }
    }
  }, [])


  // Reset sub-step when active step changes
  useEffect(() => {
    setSubStep(1)
    setDisplaySubStep(1)
    setContentAnimClass('')
  }, [current?.id])

  // Typing animation and phase transitions for Task Completion Modal
  useEffect(() => {
    if (!showModal || !modalConfig) {
      setTypedTitle('')
      setCursorVisible(true)
      setShowSub(false)
      setShowStats(false)
      setShowProg(false)
      setShowNext(false)
      setCheckRingPop(false)
      return
    }

    const ringTimer = setTimeout(() => {
      setCheckRingPop(true)
    }, 250)

    const typeTimer = setTimeout(() => {
      let i = 0
      const titleText = modalConfig.title
      const interval = setInterval(() => {
        if (i < titleText.length) {
          setTypedTitle(titleText.slice(0, i + 1))
          i++
        } else {
          clearInterval(interval)
          setCursorVisible(false)
          setShowSub(true)
          
          setTimeout(() => {
            setShowStats(true)
            setShowProg(true)
            
            setTimeout(() => {
              setShowNext(true)
              if (modalConfig.isFinalSuccess) {
                triggerConfetti()
              }
            }, 320)
          }, 220)
        }
      }, 32)

      return () => clearInterval(interval)
    }, 650)

    return () => {
      clearTimeout(ringTimer)
      clearTimeout(typeTimer)
    }
  }, [showModal, modalConfig])

  // Escape key listener to dismiss modal (behaves as "Explore freely")
  useEffect(() => {
    if (!showModal) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleExploreFreely()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showModal, modalConfig])

  const triggerConfetti = () => {
    const cols = ['#f97316', '#fb923c', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6', '#fff']
    const dots = []
    for (let i = 0; i < 80; i++) {
      const sz = 6 + Math.random() * 8
      dots.push({
        id: i,
        left: `${Math.random() * 100}%`,
        width: `${sz}px`,
        height: `${sz}px`,
        background: cols[Math.floor(Math.random() * cols.length)],
        borderRadius: Math.random() > 0.5 ? '50%' : '3px',
        animationDuration: `${1.8 + Math.random() * 2.2}s`,
        animationDelay: `${Math.random() * 0.6}s`,
      })
    }
    setConfettiDots(dots)
    setConfettiActive(true)
    setTimeout(() => {
      setConfettiActive(false)
      setConfettiDots([])
    }, 5000)
  }

  const handleOverlayClick = (e) => {
    // Disable clicking outside to close
  }

  const handleContinue = async () => {
    const dismissed = guidance.dismissed_tips || []
    const completed = [...new Set([...(guidance.completed_tips || []), current.id])]
    const next = modalConfig?.nextStepObj

    setShowModal(false)
    setCardDismissed(false)

    await persist({
      completed_tips: completed,
      walkthrough_step: next?.id || null,
      guided_mode: Boolean(next),
    })

    if (next) {
      routeTarget(dataset.id, next, activeTab, navigate)
    } else {
      const label = modalConfig?.cont || ''
      if (label.startsWith('Go to ')) {
        const pageName = label.slice(6).toLowerCase()
        const pagesMapped = {
          'data': 'data',
          'expand': 'expand',
          'describe': 'describe',
          'analysis': 'tests',
          'models': 'models',
          'what if': 'whatif',
          'what-if': 'whatif',
          'report': 'report'
        }
        const targetPage = pagesMapped[pageName]
        if (targetPage) {
          navigate(`/projects/${dataset.id}/${targetPage}`)
        }
      }
    }
  }

  const handleExploreFreely = () => {
    const completed = [...new Set([...(guidance.completed_tips || []), current.id])]

    setShowModal(false)
    setCardDismissed(true)

    // Call API in the background to avoid blocking the UI transition
    persist({
      completed_tips: completed,
      walkthrough_step: null,
      guided_mode: false,
    })
  }

  const renderNextIcon = (icoName) => {
    switch (icoName) {
      case 'AlertTriangle': return <AlertTriangle />
      case 'Tag': return <Tag />
      case 'BarChart2': return <BarChart2 />
      case 'Sliders': return <Sliders />
      case 'FileCheck': return <FileCheck />
      default: return <ArrowRight />
    }
  }

  const renderModal = () => {
    if (!modalConfig) return null

    const steps = ["Missing", "Outliers", "Labels", "Optional"]

    return (
      <>
        {confettiActive && (
          <div className="ax-completion-confetti-layer">
            {confettiDots.map(dot => (
              <div
                key={dot.id}
                className="ax-completion-conf"
                style={{
                  left: dot.left,
                  width: dot.width,
                  height: dot.height,
                  background: dot.background,
                  borderRadius: dot.borderRadius,
                  animationDuration: dot.animationDuration,
                  animationDelay: dot.animationDelay,
                }}
              />
            ))}
          </div>
        )}
        <div className={`ax-completion-overlay ${showModal ? 'show' : ''}`} onClick={handleOverlayClick}>
          <div className="ax-completion-modal">
            <div className="ax-completion-modal-accent"></div>
            <div className="ax-completion-modal-head">
              <div className={`ax-completion-check-ring ${checkRingPop ? 'pop' : ''}`}>
                <Check />
              </div>
              <div className="ax-completion-modal-title">
                {typedTitle}
                <span className={`ax-completion-cursor ${cursorVisible ? '' : 'gone'}`}></span>
              </div>
              {showSub && (
                <div className="ax-completion-modal-sub">
                  {modalConfig.sub}
                </div>
              )}
            </div>

            <div className={`ax-completion-prog-track ${showProg ? 'show' : ''}`}>
              {steps.map((p, i) => {
                const isCurrent = i === modalConfig.step + 1 && modalConfig.step < 3
                const isDone = i <= modalConfig.step
                const showLine = i < steps.length - 1
                return (
                  <React.Fragment key={p}>
                    <div className="ax-completion-pt-step">
                      <div className={`ax-completion-pt-dot ${isDone ? 'done' : isCurrent ? 'cur' : ''}`}></div>
                      <div className={`ax-completion-pt-label ${isDone ? 'done' : isCurrent ? 'cur' : ''}`}>{p}</div>
                    </div>
                    {showLine && (
                      <div className={`ax-completion-pt-line ${i < modalConfig.step ? 'done' : ''}`}></div>
                    )}
                  </React.Fragment>
                )
              })}
            </div>

            <div className={`ax-completion-modal-stats ${showStats ? 'show' : ''}`}>
              {modalConfig.stats.map((s, idx) => (
                <div className="ax-completion-stat" key={idx}>
                  <div className="ax-completion-stat-val">{s.value}</div>
                  <div className="ax-completion-stat-lbl">{s.label}</div>
                </div>
              ))}
            </div>

            <div className={`ax-completion-modal-next ${showNext ? 'show' : ''}`}>
              <div className="ax-completion-next-lbl">Up next</div>
              <div className="ax-completion-next-card">
                <div className="ax-completion-next-ico">
                  {renderNextIcon(modalConfig.next.icon)}
                </div>
                <div className="ax-completion-next-body">
                  <div className="ax-completion-next-title">{modalConfig.next.title}</div>
                  <div className="ax-completion-next-desc">{modalConfig.next.description}</div>
                </div>
                <span className={`ax-completion-next-badge ${modalConfig.next.cls}`}>
                  {modalConfig.next.badge}
                </span>
              </div>
              <div className="ax-completion-modal-btns">
                <button className="ax-completion-btn-p" onClick={handleContinue}>
                  {modalConfig.cont} <ArrowRight size={16} />
                </button>
                <button className="ax-completion-btn-s" onClick={handleExploreFreely}>
                  Explore freely
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }

  if (cardDismissed) {
    if (!showModal) return null
    return renderModal()
  }

  if (!dataset?.id || !guidance.guided_mode || !current || !config || activeTab !== 'data') return null
  if (isIssueTool(config.toolKey) && suggestionData && !issueStepPending && subStep === 1 && !showModal && !cardDismissed) return null

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
    // Optimistically update parent state so guidance modes/overlays close instantly
    onGuidanceUpdated?.({ ...guidance, ...body })
    if (isMountedRef.current) setBusy(true)
    try {
      const response = await api.updateGuidance(dataset.id, body)
      onGuidanceUpdated?.(response.guidance)
    } catch (err) {
      console.error(err)
      onGuidanceUpdated?.(guidance)
    } finally {
      if (isMountedRef.current) setBusy(false)
    }
  }

  const handleDoneReviewing = () => {
    const btn = document.getElementById(`tb-${config.toolKey}`)
    if (btn) {
      btn.click()
    }
    setSubStep(2)
  }

  const handleDoneReviewingChanges = () => {
    if (config) {
      const toolKey = config.toolKey
      const dismissed = guidance.dismissed_tips || []
      const nextStepObj = nextActionableCoachStep(guidance.goal || guidance.intent, dataset, current.id, dismissed, suggestionData)
      const isAllComplete = !nextStepObj || nextStepObj.page !== 'data'
      let type = toolKey
      if (isAllComplete) {
        type = 'all'
      }
      const activeContent = completionModalConfig[type]
      if (activeContent) {
        const stats = typeof activeContent.stats === 'function'
          ? activeContent.stats(suggestionData, dataset)
          : activeContent.stats
        let finalTitle = activeContent.title
        let finalSub = activeContent.subtitle || activeContent.sub
        let finalStats = stats
        let finalNext = activeContent.next
        let finalCont = activeContent.continueLabel || activeContent.cont
        let finalStep = activeContent.stepIndex
        let isFinalSuccess = isAllComplete

        if (nextStepObj) {
          if (nextStepObj.id === 'data.outliers') {
            finalNext = {
              icon: "AlertTriangle",
              title: "Review outliers in numeric columns",
              description: "Some columns have extreme values that may affect accuracy.",
              badge: "Recommended",
              cls: "ax-completion-nb-rec"
            }
            finalCont = "Go to Outliers"
          } else if (nextStepObj.id === 'data.duplicates') {
            finalNext = {
              icon: "FileCheck",
              title: "Remove duplicate rows",
              description: "Repeated rows can overcount records and skew statistical patterns.",
              badge: "Required",
              cls: "ax-completion-nb-req"
            }
            finalCont = "Go to Duplicates"
          } else if (nextStepObj.id === 'data.categories') {
            finalNext = {
              icon: "Tag",
              title: "Standardize categorical labels",
              description: "Inconsistent labels like True/Yes/graduated need to be unified.",
              badge: "Required",
              cls: "ax-completion-nb-req"
            }
            finalCont = "Go to Labels"
          } else {
            const pageTitle = nextStepObj.page.charAt(0).toUpperCase() + nextStepObj.page.slice(1)
            const icoName = nextStepObj.page === 'describe' ? 'BarChart2' : nextStepObj.page === 'models' ? 'Sliders' : 'ArrowRight'
            finalNext = {
              icon: icoName,
              title: nextStepObj.title,
              description: nextStepObj.unlocks || nextStepObj.action,
              badge: "Next",
              cls: "ax-completion-nb-next"
            }
            finalCont = `Go to ${pageTitle}`
          }
        }

        setModalConfig({
          type,
          title: finalTitle,
          sub: finalSub,
          stats: finalStats,
          next: finalNext,
          cont: finalCont,
          step: finalStep,
          nextStepObj,
          isFinalSuccess
        })
      }
    }

    setAnimationState('closing')
    setTimeout(() => {
      setCardDismissed(true)
      setAnimationState('')
      setTimeout(() => {
        setShowModal(true)
      }, 220)
    }, 180)
  }

  const currentSub = config.subSteps[displaySubStep]

  const closeCardAndPersist = (body) => {
    setAnimationState('closing')
    setTimeout(() => {
      persist(body)
    }, 180)
  }

  return (
    <>
      <aside
        className={`guided-focus-card guided-focus ${animationState}`}
        data-arrow-side={cardPosition.arrowSide}
        style={{
          top: `${cardPosition.top}px`,
          left: `${cardPosition.left}px`,
          '--arrow-left': `${cardPosition.arrowLeft}px`,
          '--arrow-top': `${cardPosition.arrowTop}px`,
          zIndex: 2010
        }}
      >
        <div className={`gf-content ${contentAnimClass}`} style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
          <div className="ax-guided-coach-step-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
            <p className="ax-kicker" style={{ margin: 0, textTransform: 'uppercase', fontSize: '9.5px', fontWeight: 800, letterSpacing: '0.08em', color: '#f97316' }}>
              Guided Focus · {displaySubStep} of 3
            </p>
            <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>{config.title}</span>
          </div>

          <strong style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-text-primary)', display: 'block', margin: '2px 0 2px' }}>
            {currentSub?.title}
          </strong>

          <div style={{ fontSize: '12.5px', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: '8px', lineHeight: 1.45 }}>
            {displaySubStep === 1 && (
              <p style={{ margin: 0 }}>
                <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>What SimuCast sees:</span><br />
                {getSeesText()}
              </p>
            )}
            
            <p className="do-this-now" style={{ margin: 0 }}>
              <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>Do this now:</span><br />
              {currentSub?.action}
            </p>

            {displaySubStep === 1 && config.why && (
              <p style={{ margin: 0, fontSize: '11.5px', opacity: 0.85, borderLeft: '2px solid #fdba74', paddingLeft: '8px' }}>
                <span style={{ fontWeight: 600 }}>Why:</span> {config.why}
              </p>
            )}
          </div>
        </div>

        <div className="ax-guided-coach-actions" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '12px', paddingTop: '10px', borderTop: '0.5px solid var(--color-border-tertiary)' }}>
          {displaySubStep === 1 && (
            <button className="ax-btn mini prim" type="button" onClick={handleDoneReviewing} style={{ background: '#f97316', borderColor: '#f97316', color: '#ffffff' }}>
              I am done reviewing
            </button>
          )}
          
          {displaySubStep === 2 && (
            <button
              className="ax-btn mini ghost"
              type="button"
              onClick={() => {
                closingPopoverRef.current = true
                setTimeout(() => {
                  closingPopoverRef.current = false
                }, 400)
                const closeBtn = document.querySelector('.ax-popover-close')
                if (closeBtn) {
                  closeBtn.click()
                } else {
                  const activeBtn = document.getElementById(`tb-${config.toolKey}`)
                  if (activeBtn?.classList.contains('active')) {
                    activeBtn.click()
                  }
                }
                setSubStep(1)
              }}
            >
              Back
            </button>
          )}

          {displaySubStep === 3 && (
            <button className="ax-btn mini prim" type="button" disabled={busy || !suggestionData} onClick={handleDoneReviewingChanges} style={{ background: '#f97316', borderColor: '#f97316', color: '#ffffff' }}>
              {!suggestionData ? 'Loading...' : 'Done reviewing'}
            </button>
          )}

          <button className="ax-link-btn" type="button" disabled={busy} onClick={() => closeCardAndPersist({ guided_mode: false })} style={{ marginLeft: 'auto', fontSize: '11.5px', color: 'var(--color-text-secondary)' }}>
            Explore freely
          </button>
        </div>
      </aside>
      {targetRect && !showModal && !cardDismissed && (
        <SpotlightMask rect={targetRect} />
      )}
      {renderModal()}
    </>
  )
}

function SpotlightMask({ rect }) {
  if (!rect) return null
  return (
    <svg
      className="spotlight-overlay show"
      width="100%"
      height="100%"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        pointerEvents: 'none'
      }}
    >
      <defs>
        <mask id="spotlight-mask-focus">
          <rect width="100%" height="100%" fill="white" />
          <rect
            id="spotlight-hole-focus"
            style={{
              transition: 'x 150ms ease, y 150ms ease, width 150ms ease, height 150ms ease'
            }}
            x={rect.left - 8}
            y={rect.top - 8}
            width={rect.width + 16}
            height={rect.height + 16}
            rx="8"
            fill="black"
          />
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill="rgba(0,0,0,0.6)"
        mask="url(#spotlight-mask-focus)"
      />
    </svg>
  )
}

function isIssueTool(toolKey) {
  return ['missing', 'outliers', 'duplicates', 'labels'].includes(toolKey)
}

function issuePendingForTool(toolKey, suggestionData, dataset) {
  if (toolKey === 'missing') {
    const suggested = suggestionData?.groups?.missing?.columns || []
    if (suggested.length) return true
    return (dataset?.variables || []).some((variable) => Number(variable.missing || 0) > 0)
  }
  if (toolKey === 'outliers') return Boolean((suggestionData?.groups?.outliers?.columns || []).length)
  if (toolKey === 'duplicates') return Number(suggestionData?.groups?.duplicates?.count || 0) > 0
  if (toolKey === 'labels') return Boolean((suggestionData?.suggestions || []).length)
  return true
}

function stepStillActionable(step, suggestionData, dataset) {
  if (!step?.completion) return true
  if (step.completion === 'missing') return issuePendingForTool('missing', suggestionData, dataset)
  if (step.completion === 'outliers') return issuePendingForTool('outliers', suggestionData, dataset)
  if (step.completion === 'duplicates') return issuePendingForTool('duplicates', suggestionData, dataset)
  if (step.completion === 'categories') {
    if (suggestionData && 'suggestions' in suggestionData) {
      return (suggestionData.suggestions || []).length > 0
    }
    return true
  }
  return true
}

function nextActionableCoachStep(goal, dataset, currentId, dismissedTips, suggestionData) {
  const hidden = new Set(dismissedTips || [])
  const steps = coachStepsForGoal(goal, dataset)
  const currentIndex = steps.findIndex((step) => step.id === currentId)
  return steps
    .slice(Math.max(currentIndex + 1, 0))
    .find((step) => !hidden.has(step.id) && stepStillActionable(step, suggestionData, dataset)) || null
}
