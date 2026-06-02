/* ============================================================
 * COMPONENT: GuidedTaskCompletionModal
 * Keywords: guided workflow, task complete, completion modal
 *
 * Reusable animated completion modal shown after finishing a
 * guided data-cleaning task. Manages its own animation states.
 * ============================================================ */
import React, { useEffect, useState } from 'react'
import { Check, ArrowRight, AlertTriangle, Tag, BarChart2, Sliders, FileCheck } from 'lucide-react'

/**
 * @param {object}   props
 * @param {object}   props.config          — Modal content config
 * @param {string}   props.config.title    — Heading (typed character-by-character)
 * @param {string}   props.config.sub      — Subtitle shown after heading
 * @param {Array}    props.config.stats    — [{value, label}, ...] stat tiles
 * @param {object}   props.config.next     — {icon, title, description, badge, cls}
 * @param {string}   props.config.cont     — Primary button label ("Go to Outliers", etc.)
 * @param {number}   props.config.step     — 0-indexed progress indicator active step
 * @param {boolean}  props.config.isFinalSuccess — trigger confetti if true
 * @param {boolean}  props.show            — whether modal is visible
 * @param {function} props.onContinue      — primary button callback
 * @param {function} props.onExploreFreely — secondary button callback
 * @param {Array}    props.progressSteps   — step label strings for progress track
 */
export default function GuidedTaskCompletionModal({
  config,
  show,
  onContinue,
  onExploreFreely,
  progressSteps = ['Missing', 'Outliers', 'Labels', 'Optional'],
}) {
  const [typedTitle, setTypedTitle] = useState('')
  const [cursorVisible, setCursorVisible] = useState(true)
  const [showSub, setShowSub] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showProg, setShowProg] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [checkRingPop, setCheckRingPop] = useState(false)
  const [confettiActive, setConfettiActive] = useState(false)
  const [confettiDots, setConfettiDots] = useState([])

  // Reset and re-run animation when show/config changes
  useEffect(() => {
    if (!show || !config) {
      setTypedTitle('')
      setCursorVisible(true)
      setShowSub(false)
      setShowStats(false)
      setShowProg(false)
      setShowNext(false)
      setCheckRingPop(false)
      return
    }

    const ringTimer = setTimeout(() => setCheckRingPop(true), 250)

    const typeTimer = setTimeout(() => {
      let i = 0
      const titleText = config.title || ''
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
              if (config.isFinalSuccess) triggerConfetti()
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
  }, [show, config])

  // Dismiss modal on Escape key
  useEffect(() => {
    if (!show) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onExploreFreely?.()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [show, onExploreFreely])

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

  if (!config) return null

  return (
    <>
      {confettiActive && (
        <div className="ax-completion-confetti-layer">
          {confettiDots.map((dot) => (
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

      <div
        className={`ax-completion-overlay ${show ? 'show' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ax-completion-modal">
          <div className="ax-completion-modal-accent" />

          <div className="ax-completion-modal-head">
            <div className={`ax-completion-check-ring ${checkRingPop ? 'pop' : ''}`}>
              <Check />
            </div>
            <div className="ax-completion-modal-title">
              {typedTitle}
              <span className={`ax-completion-cursor ${cursorVisible ? '' : 'gone'}`} />
            </div>
            {showSub && (
              <div className="ax-completion-modal-sub">{config.sub}</div>
            )}
          </div>

          <div className={`ax-completion-prog-track ${showProg ? 'show' : ''}`}>
            {progressSteps.map((p, i) => {
              const isCurrent = i === (config.step ?? 0) + 1 && (config.step ?? 0) < progressSteps.length - 1
              const isDone = i <= (config.step ?? 0)
              const showLine = i < progressSteps.length - 1
              return (
                <React.Fragment key={p}>
                  <div className="ax-completion-pt-step">
                    <div className={`ax-completion-pt-dot ${isDone ? 'done' : isCurrent ? 'cur' : ''}`} />
                    <div className={`ax-completion-pt-label ${isDone ? 'done' : isCurrent ? 'cur' : ''}`}>{p}</div>
                  </div>
                  {showLine && (
                    <div className={`ax-completion-pt-line ${i < (config.step ?? 0) ? 'done' : ''}`} />
                  )}
                </React.Fragment>
              )
            })}
          </div>

          <div className={`ax-completion-modal-stats ${showStats ? 'show' : ''}`}>
            {(config.stats || []).map((s, idx) => (
              <div className="ax-completion-stat" key={idx}>
                <div className="ax-completion-stat-val">{s.value}</div>
                <div className="ax-completion-stat-lbl">{s.label}</div>
              </div>
            ))}
          </div>

          {config.next && (
            <div className={`ax-completion-modal-next ${showNext ? 'show' : ''}`}>
              <div className="ax-completion-next-lbl">Up next</div>
              <div className="ax-completion-next-card">
                <div className="ax-completion-next-ico">
                  {renderNextIcon(config.next.icon)}
                </div>
                <div className="ax-completion-next-body">
                  <div className="ax-completion-next-title">{config.next.title}</div>
                  <div className="ax-completion-next-desc">{config.next.description}</div>
                </div>
                <span className={`ax-completion-next-badge ${config.next.cls}`}>
                  {config.next.badge}
                </span>
              </div>
              <div className="ax-completion-modal-btns">
                <button className="ax-completion-btn-p" onClick={onContinue}>
                  {config.cont} <ArrowRight size={16} />
                </button>
                <button className="ax-completion-btn-s" onClick={onExploreFreely}>
                  Explore freely
                </button>
              </div>
            </div>
          )}

          {/* Fallback buttons when no "next" card is configured */}
          {!config.next && showNext && (
            <div className={`ax-completion-modal-next ${showNext ? 'show' : ''}`}>
              <div className="ax-completion-modal-btns">
                {config.cont && (
                  <button className="ax-completion-btn-p" onClick={onContinue}>
                    {config.cont} <ArrowRight size={16} />
                  </button>
                )}
                <button className="ax-completion-btn-s" onClick={onExploreFreely}>
                  Explore freely
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
