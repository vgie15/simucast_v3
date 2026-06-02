import React, { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../api'
import { SparkleIcon } from '../ai/AIExplainers'
import { InlineSpinner } from '../common/LoadingStates'

const TOOL_BTN_IDS = {
  missing: '#tb-missing',
  outliers: '#tb-outliers',
  duplicates: '#tb-duplicates',
  labels: '#tb-labels',
}

function buildExplainContent(toolKey, suggestionData, dataset) {
  const fallback = {
    summary: `SimuCast detected data quality issues in ${dataset?.name || 'the dataset'}.`,
    whyMatters: 'These issues can affect model accuracy and lead to unreliable predictions.',
    options: 'Review the recommended fixes and apply them individually or all at once.',
    tradeoffs: 'Ignoring these issues may introduce bias or reduce model performance.',
  }
  if (!suggestionData) return fallback

  if (toolKey === 'missing') {
    const cols = suggestionData.groups?.missing?.columns || []
    const names = cols.slice(0, 3).map(c => c.variable || c.name).filter(Boolean).join(', ')
    const count = cols.length
    const more = count > 3 ? ` and ${count - 3} more` : ''
    return {
      summary: `${count} column${count === 1 ? '' : 's'}${names ? ` — ${names}${more}` : ''} — ${count === 1 ? 'has' : 'have'} missing values.`,
      whyMatters: 'Blanks can break mathematical operations and reduce model accuracy. Filling missing values keeps your data complete and consistent for training.',
      options: `SimuCast recommends ${count === 1 ? 'a fill method' : 'fill methods'} for each column. You can apply the suggestions as-is or override individual columns.`,
      tradeoffs: 'Leaving blanks may cause models to ignore useful patterns. Dropping rows with missing data reduces your sample size and may introduce bias.',
    }
  }

  if (toolKey === 'outliers') {
    const cols = suggestionData.groups?.outliers?.columns || []
    const names = cols.slice(0, 3).map(c => c.variable || c.name).filter(Boolean).join(', ')
    const count = cols.length
    const more = count > 3 ? ` and ${count - 3} more` : ''
    return {
      summary: `${count} numeric column${count === 1 ? '' : 's'}${names ? ` — ${names}${more}` : ''} — ${count === 1 ? 'contains' : 'contain'} extreme values (outliers).`,
      whyMatters: 'Outliers can distort statistical summaries and pull model predictions away from the true pattern, especially for linear models.',
      options: `You can cap outliers to a reasonable range or remove them entirely. Capping preserves your data while limiting extreme influence.`,
      tradeoffs: 'Removing too many values discards real variation. Capping reduces variance but keeps sample size intact.',
    }
  }

  if (toolKey === 'duplicates') {
    const count = suggestionData.groups?.duplicates?.count || 0
    return {
      summary: `${count} duplicate row${count === 1 ? '' : 's'} ${count === 1 ? 'was' : 'were'} detected.`,
      whyMatters: 'Duplicate rows overcount observations, which can skew statistical patterns and give undue weight to repeated records.',
      options: `Remove exact duplicates to keep one instance per unique record. SimuCast will show you which rows are duplicated so you can verify.`,
      tradeoffs: 'Keeping duplicates may inflate model confidence in patterns that appear only in repeated rows.',
    }
  }

  if (toolKey === 'labels') {
    const cols = suggestionData.groups?.labels?.columns || []
    const names = cols.slice(0, 3).map(c => c.variable || c.name).filter(Boolean).join(', ')
    const count = cols.length
    const more = count > 3 ? ` and ${count - 3} more` : ''
    return {
      summary: `${count} categorical column${count === 1 ? '' : 's'}${names ? ` — ${names}${more}` : ''} — ${count === 1 ? 'has' : 'have'} inconsistent or fuzzy labels.`,
      whyMatters: 'Inconsistent labels (e.g. "Yes", "Y", "1") confuse models that expect clean categories. Standardizing improves prediction accuracy.',
      options: `SimuCast can standardize these automatically. Review the suggested mappings and accept or adjust before applying.`,
      tradeoffs: 'Auto-standardization may merge categories you want to keep separate. Manual review ensures the groupings match your domain knowledge.',
    }
  }

  return fallback
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
        pointerEvents: 'none',
      }}
    >
      <defs>
        <mask id="guide-focus-mask">
          <rect width="100%" height="100%" fill="white" />
          <rect
            style={{ transition: 'x 150ms ease, y 150ms ease, width 150ms ease, height 150ms ease' }}
            x={rect.left}
            y={rect.top}
            width={rect.width}
            height={rect.height}
            rx="8"
            fill="black"
          />
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill="rgba(0,0,0,0.55)"
        mask="url(#guide-focus-mask)"
      />
    </svg>
  )
}

function GuideFocusAnchoredExplainPopup({ datasetId, element, onClose }) {
  const [aiText, setAiText] = useState(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('normal')
  const [followUpInput, setFollowUpInput] = useState('')
  const [followUpLoading, setFollowUpLoading] = useState(false)
  const [position, setPosition] = useState(() => getGuideFocusExplainPosition(getLiveGuideFocusExplainRect(element)))

  const title = element?.title || 'Guide focus'
  const fallbackDatasetExplanation = cleanGuideFocusExplainText(element?.datasetExplanation, 'This guide step explains the selected data-preparation task.')
  const simple = element?.simple || 'This guided step explains what to review in the Data page.'
  const whyItMatters = element?.whyItMatters || 'Understanding the issue helps you choose the right cleanup action before downstream analysis.'
  const verdict = element?.verdict || 'Review the recommendation, then apply the cleanup only if it matches your dataset.'
  const verdictTone = element?.verdictTone || 'good'

  useEffect(() => {
    const updatePosition = () => setPosition(getGuideFocusExplainPosition(getLiveGuideFocusExplainRect(element)))
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [element?.sourceEl, element?.sourceRect, element?.step, element?.title])

  const fetchAI = async (variant = 'normal') => {
    if (!datasetId || !element) return
    setLoading(true)
    try {
      const question = variant === 'simple'
        ? `Explain this guided data-cleaning task in very simple terms, one or two sentences: ${title}.`
        : variant === 'technical'
          ? `Give concise technical details for this guided data-cleaning task: ${title}.`
          : (element.question || `Explain this guided data-cleaning task: ${title}. Include what it means, how it applies to the dataset, why it matters, and a recommendation.`)
      const response = await api.aiExplain(
        datasetId,
        element.step || 'guide-focus',
        element.params || {},
        question,
        element.result || {},
        true,
      )
      setAiText(cleanGuideFocusExplainText(response?.explanation, fallbackDatasetExplanation))
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
      const response = await api.aiExplain(
        datasetId,
        `${element.step || 'guide-focus'}-followup`,
        {
          ...(element.params || {}),
          previousExplanation: aiText || fallbackDatasetExplanation,
        },
        followUpInput,
        element.result || {},
        true,
      )
      setAiText(cleanGuideFocusExplainText(response?.explanation, fallbackDatasetExplanation))
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
  }, [datasetId, element?.step, element?.title])

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
          <span>In your dataset</span>
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
          <span>Verdict / recommendation</span>
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

function getGuideFocusExplainPosition(sourceRect) {
  const popupW = 374
  const gap = 8
  const padding = 12
  const viewportW = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportH = typeof window === 'undefined' ? 720 : window.innerHeight
  const popupH = Math.max(280, Math.min(560, viewportH - (padding * 2)))
  const anchor = normalizeGuideFocusExplainRect(sourceRect)
  if (!anchor) return { top: 84, left: padding, placement: 'right-start', arrowTop: 24, arrowLeft: -6, maxHeight: popupH }
  const placements = anchor.bottom > viewportH * 0.68
    ? ['top-start', 'right-start', 'left-start', 'bottom-start']
    : ['right-start', 'left-start', 'bottom-start', 'top-start']
  for (const placement of placements) {
    const candidate = buildGuideFocusExplainCandidate(placement, anchor, popupW, popupH, gap, padding, viewportW, viewportH)
    if (!guideFocusRectsOverlap(candidate.rect, anchor)) return candidate
  }
  const rightSpace = viewportW - anchor.right - gap - padding
  const leftSpace = anchor.left - gap - padding
  return buildGuideFocusExplainCandidate(rightSpace >= leftSpace ? 'right-start' : 'left-start', anchor, popupW, popupH, gap, padding, viewportW, viewportH)
}

function buildGuideFocusExplainCandidate(placement, anchor, popupW, popupH, gap, padding, viewportW, viewportH) {
  let left = anchor.right + gap
  let top = anchor.top
  if (placement === 'left-start') {
    left = anchor.left - popupW - gap
  } else if (placement === 'bottom-start') {
    left = anchor.left
    top = anchor.bottom + gap
  } else if (placement === 'top-start') {
    left = anchor.left
    top = anchor.top - popupH - gap
  }
  left = guideFocusClamp(left, padding, Math.max(padding, viewportW - popupW - padding))
  top = guideFocusClamp(top, padding, Math.max(padding, viewportH - popupH - padding))
  const rect = { left, top, right: left + popupW, bottom: top + popupH }
  const arrow = getGuideFocusExplainArrowPosition(placement, anchor, rect, popupW, popupH)
  return { top, left, placement, rect, maxHeight: popupH, ...arrow }
}

function getGuideFocusExplainArrowPosition(placement, anchor, popup, popupW, popupH) {
  if (placement === 'right-start' || placement === 'left-start') {
    return {
      arrowLeft: placement === 'right-start' ? -6 : popupW - 6,
      arrowTop: guideFocusClamp(anchor.top + Math.min(anchor.height / 2, 20) - popup.top, 18, popupH - 18),
    }
  }
  return {
    arrowLeft: guideFocusClamp(anchor.left + Math.min(anchor.width / 2, 30) - popup.left, 18, popupW - 18),
    arrowTop: placement === 'bottom-start' ? -6 : popupH - 6,
  }
}

function getLiveGuideFocusExplainRect(element) {
  if (element?.sourceEl?.isConnected && typeof element.sourceEl.getBoundingClientRect === 'function') {
    return element.sourceEl.getBoundingClientRect()
  }
  return element?.sourceRect || null
}

function normalizeGuideFocusExplainRect(rect) {
  if (!rect) return null
  const left = Number(rect.left)
  const top = Number(rect.top)
  const width = Number(rect.width || rect.right - rect.left)
  const height = Number(rect.height || rect.bottom - rect.top)
  if (![left, top, width, height].every(Number.isFinite)) return null
  return { left, top, width, height, right: left + width, bottom: top + height }
}

function guideFocusRectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function guideFocusClamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function cleanGuideFocusExplainText(text, fallback) {
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
    lower.includes('params: {') ||
    lower.includes('"toolkey"')
  return looksRaw ? fallback : value
}

export default function GuideFocusExplainCard({
  dataset,
  guidance,
  suggestionData,
  onGuidanceUpdated,
  toolKey,
  taskLabel,
  onDismiss,
}) {
  const content = buildExplainContent(toolKey, suggestionData, dataset)
  const [targetRect, setTargetRect] = useState(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [applied, setApplied] = useState(false)
  const [explainPopup, setExplainPopup] = useState(null)
  const [cardSize, setCardSize] = useState({ width: 300, height: 280 })
  const activeElementRef = useRef(null)
  const popoverElRef = useRef(null)
  const guideCardRef = useRef(null)

  const persist = async (body) => {
    onGuidanceUpdated?.({ ...guidance, ...body })
    try {
      await api.updateGuidance(dataset.id, body)
    } catch (err) {
      console.error(err)
    }
  }

  const handleOpenTool = () => {
    const btn = document.querySelector(TOOL_BTN_IDS[toolKey])
    if (btn) {
      btn.click()
    }
  }

  const handleExploreFreely = () => {
    persist({ guided_mode: false, walkthrough_step: null })
    onDismiss?.()
  }

  const handleMarkDone = () => {
    persist({ guided_mode: false, walkthrough_step: null })
    onDismiss?.()
  }

  const explainStep = `guide-focus-${toolKey}`
  const explainQuestion = `Explain ${taskLabel} in this dataset: what it is, why it matters, and how to resolve it. Use the dataset context to give specific advice.`
  const explainResult = {
    summary: content.summary,
    whyMatters: content.whyMatters,
    options: content.options,
    tradeoffs: content.tradeoffs,
    suggestionData: suggestionData || null,
  }

  // Spotlight tracking: highlight the tool button when card is showing
  useEffect(() => {
    const updateSpotlight = () => {
      if (popoverOpen) {
        const popover = document.querySelector('.ax-data-toolbar-popover')
        const nextEl = popover || document.querySelector(TOOL_BTN_IDS[toolKey])
        if (!nextEl) {
          setTargetRect(null)
          if (activeElementRef.current) {
            activeElementRef.current.classList.remove('spotlight', 'idle')
            activeElementRef.current = null
          }
          return
        }
        const rect = nextEl.getBoundingClientRect()
        setTargetRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
        if (activeElementRef.current !== nextEl) {
          if (activeElementRef.current) {
            activeElementRef.current.classList.remove('spotlight', 'idle')
          }
          activeElementRef.current = nextEl
          nextEl.classList.add('spotlight')
        }
      } else {
        const nextEl = document.querySelector(TOOL_BTN_IDS[toolKey])
        if (!nextEl) {
          setTargetRect(null)
          if (activeElementRef.current) {
            activeElementRef.current.classList.remove('spotlight', 'idle')
            activeElementRef.current = null
          }
          return
        }
        const rect = nextEl.getBoundingClientRect()
        setTargetRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
        if (activeElementRef.current !== nextEl) {
          if (activeElementRef.current) {
            activeElementRef.current.classList.remove('spotlight', 'idle')
          }
          activeElementRef.current = nextEl
          nextEl.classList.add('spotlight')
        }
      }
    }

    window.addEventListener('resize', updateSpotlight)
    window.addEventListener('scroll', updateSpotlight, true)
    const interval = setInterval(updateSpotlight, 100)
    updateSpotlight()

    return () => {
      window.removeEventListener('resize', updateSpotlight)
      window.removeEventListener('scroll', updateSpotlight, true)
      clearInterval(interval)
      if (activeElementRef.current) {
        activeElementRef.current.classList.remove('spotlight', 'idle')
        activeElementRef.current = null
      }
    }
  }, [toolKey, popoverOpen])

  // Listen for popover open/close events from the data toolbar
  useEffect(() => {
    const handlePopoverOpen = (e) => {
      if (e.detail?.tool === toolKey) {
        setPopoverOpen(true)
      }
    }
    const handlePopoverClose = (e) => {
      if (!e?.detail || e.detail?.tool === toolKey) {
        setPopoverOpen(false)
      }
    }
    const handleApplySuccess = () => {
      setApplied(true)
    }

    window.addEventListener('simucast:popover-open', handlePopoverOpen)
    window.addEventListener('simucast:popover-close', handlePopoverClose)
    window.addEventListener('simucast:apply-success', handleApplySuccess)
    return () => {
      window.removeEventListener('simucast:popover-open', handlePopoverOpen)
      window.removeEventListener('simucast:popover-close', handlePopoverClose)
      window.removeEventListener('simucast:apply-success', handleApplySuccess)
    }
  }, [toolKey])

  useEffect(() => {
    const card = guideCardRef.current
    if (!card) return undefined
    const update = () => {
      const rect = card.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setCardSize({
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height),
        })
      }
    }
    update()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(card)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [applied, popoverOpen, taskLabel, content.summary, content.whyMatters, content.options, content.tradeoffs])

  // Compute card position relative to spotlight target
  const cardPlacement = (() => {
    const cardW = Math.min(300, Math.max(270, cardSize.width || 300))
    const cardH = Math.min(Math.max(cardSize.height || 280, 220), window.innerHeight - 32)
    const gap = 12
    const padding = 16
    const viewW = window.innerWidth
    const viewH = window.innerHeight

    if (!targetRect) {
      return {
        style: {
          position: 'fixed',
          top: `${padding}px`,
          left: `${padding}px`,
          width: `${cardW}px`,
          maxHeight: `${viewH - padding * 2}px`,
          boxSizing: 'border-box',
          zIndex: 2010,
        },
        arrowSide: 'none',
      }
    }
    const popover = document.querySelector('.ax-data-toolbar-popover')
    const isPopover = popoverOpen && Boolean(popover)
    const anchor = isPopover ? popover.getBoundingClientRect() : targetRect
    const anchorMidX = anchor.left + anchor.width / 2
    const anchorMidY = anchor.top + anchor.height / 2
    const placements = [
      {
        side: 'left',
        left: anchor.left - cardW - gap,
        top: anchorMidY - cardH / 2,
        fits: anchor.left >= cardW + gap + padding,
      },
      {
        side: 'right',
        left: anchor.right + gap,
        top: anchorMidY - cardH / 2,
        fits: viewW - anchor.right >= cardW + gap + padding,
      },
      {
        side: 'bottom',
        left: anchorMidX - cardW / 2,
        top: anchor.bottom + gap,
        fits: viewH - anchor.bottom >= cardH + gap + padding,
      },
      {
        side: 'top',
        left: anchorMidX - cardW / 2,
        top: anchor.top - cardH - gap,
        fits: anchor.top >= cardH + gap + padding,
      },
    ]
    const preferred = isPopover ? placements : [placements[1], placements[0], placements[2], placements[3]]
    const picked = preferred.find((placement) => placement.fits) || placements.find((placement) => placement.fits) || {
      side: anchorMidX > viewW / 2 ? 'left' : 'right',
      left: anchorMidX > viewW / 2 ? anchor.left - cardW - gap : anchor.right + gap,
      top: anchorMidY - cardH / 2,
    }

    const left = Math.max(padding, Math.min(viewW - cardW - padding, picked.left))
    const top = Math.max(padding, Math.min(viewH - cardH - padding, picked.top))
    const arrowLeft = Math.max(16, Math.min(cardW - 16, anchorMidX - left))
    const arrowTop = Math.max(16, Math.min(cardH - 16, anchorMidY - top))

    return {
      arrowSide: {
        left: 'right',
        right: 'left',
        top: 'bottom',
        bottom: 'top',
      }[picked.side] || 'none',
      style: {
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        width: `${cardW}px`,
        maxHeight: `${viewH - padding * 2}px`,
        boxSizing: 'border-box',
        overflow: 'auto',
        '--arrow-left': `${arrowLeft}px`,
        '--arrow-top': `${arrowTop}px`,
        zIndex: 2010,
      },
    }
  })()

  return (
    <>
      <SpotlightMask rect={targetRect} />
      <aside
        ref={guideCardRef}
        className="guided-focus-card guided-focus"
        data-arrow-side={cardPlacement.arrowSide}
        style={cardPlacement.style}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ textTransform: 'uppercase', fontSize: '9.5px', fontWeight: 800, letterSpacing: '0.08em', color: '#f97316' }}>
              AI Guide · {taskLabel}
            </span>
            {applied && (
              <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700 }}>✓ Applied</span>
            )}
          </div>

          <div style={{ fontSize: '12.5px', color: 'var(--color-text-secondary)', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {applied ? (
              <>
                <p style={{ margin: 0, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                  {taskLabel} applied. Inspect the preview and recent changes below, then move on to the next guided step.
                </p>
              </>
            ) : (
              <>
                <p style={{ margin: 0, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                  {content.summary}
                </p>
                <p style={{ margin: 0 }}>
                  {content.whyMatters}
                </p>
                <p style={{ margin: 0 }}>
                  {content.options}
                </p>
                <p style={{ margin: 0, fontSize: '11.5px', opacity: 0.85, borderLeft: '2px solid #fdba74', paddingLeft: '8px' }}>
                  <span style={{ fontWeight: 600 }}>Trade-off:</span> {content.tradeoffs}
                </p>
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', paddingTop: '10px', borderTop: '0.5px solid var(--color-border-tertiary)' }}>
          {!popoverOpen && !applied && (
            <button
              type="button"
              className="ax-btn mini prim"
              onClick={handleOpenTool}
              style={{ background: '#f97316', borderColor: '#f97316', color: '#ffffff' }}
            >
              Open {taskLabel}
            </button>
          )}
          {popoverOpen && !applied && (
            <span style={{ fontSize: '11.5px', color: 'var(--color-text-secondary)' }}>
              Use the popover, then close it to continue.
            </span>
          )}
          {applied && (
            <button
              type="button"
              className="ax-btn mini prim"
              onClick={handleMarkDone}
              style={{ background: '#16a34a', borderColor: '#16a34a', color: '#ffffff' }}
            >
              Continue
            </button>
          )}
          {!applied && (
            <button
              type="button"
              className="ax-btn mini ax-ai-explain-btn"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const sourceEl = guideCardRef.current || event.currentTarget
                setExplainPopup({
                  sourceEl,
                  sourceRect: sourceEl.getBoundingClientRect(),
                  title: taskLabel,
                  step: explainStep,
                  params: { toolKey, taskLabel },
                  result: explainResult,
                  question: explainQuestion,
                  simple: content.summary,
                  datasetExplanation: content.options,
                  whyItMatters: content.whyMatters,
                  verdict: content.tradeoffs,
                  verdictTone: 'good',
                })
              }}
            >
              <SparkleIcon size={11} />
              Ask AI
            </button>
          )}
          <button
            type="button"
            className="ax-link-btn"
            onClick={handleExploreFreely}
            style={{ marginLeft: 'auto', fontSize: '11.5px', color: 'var(--color-text-secondary)' }}
          >
            Explore freely
          </button>
        </div>
      </aside>
      {explainPopup && (
        <GuideFocusAnchoredExplainPopup
          datasetId={dataset?.id}
          element={explainPopup}
          onClose={() => setExplainPopup(null)}
        />
      )}
    </>
  )
}
