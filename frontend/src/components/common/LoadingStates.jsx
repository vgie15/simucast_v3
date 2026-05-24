/* ============================================================
 * COMPONENT: LOADING STATES
 * Keywords: loading, spinner, skeleton, busy
 * ============================================================ */
import React from 'react'

// Full workspace loader for project-level transitions.
export function SimuCastLoader({ label = 'Loading project...' }) {
  return (
    <div className="ax-simucast-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="ax-simucast-loader-dots" aria-hidden="true" />
      <div className="ax-simucast-loader-brand">
        <span className="ax-simucast-loader-mark">
          <img src="/simucast-logo.png" alt="" />
        </span>
        <span className="ax-simucast-loader-name">SimuCast</span>
      </div>
      <div className="ax-simucast-loader-bar" aria-hidden="true">
        <span />
      </div>
      <div className="ax-simucast-loader-status">
        <div>
          <span>Reading dataset...</span>
          <span>Detecting issues...</span>
          <span>Running recommendations...</span>
          <span>{label}</span>
        </div>
      </div>
    </div>
  )
}

// Full-screen busy overlay showing spinner, title, optional detail and step list.
export function BusyOverlay({ active, title = 'Working...', detail, steps = [] }) {
  if (!active) return null
  return (
    <div className="ax-busy-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="ax-busy-card">
        <span className="ax-busy-spinner" aria-hidden="true" />
        <div>
          <p>{title}</p>
          {detail && <span>{detail}</span>}
          {steps.length > 0 && (
            <ol>
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}

// Renders a placeholder skeleton table with configurable row and column counts.
export function SkeletonTable({ rows = 8, columns = 6 }) {
  return (
    <div className="ax-skeleton-table" style={{ '--skel-cols': columns }} aria-hidden="true">
      <div className="ax-skeleton-row head">
        {Array.from({ length: columns }).map((_, idx) => (
          <span key={idx} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div className="ax-skeleton-row" key={row}>
          {Array.from({ length: columns }).map((_, col) => (
            <span key={col} style={{ width: `${64 + ((row + col) % 4) * 8}%` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

// Renders a row of placeholder skeleton cards while content is loading.
export function SkeletonCards({ count = 3 }) {
  return (
    <div className="ax-skeleton-cards" aria-hidden="true">
      {Array.from({ length: count }).map((_, idx) => (
        <div className="ax-skeleton-card" key={idx}>
          <span className="title" />
          <span />
          <span className="short" />
        </div>
      ))}
    </div>
  )
}

// Small inline spinner with label, used beside text to indicate activity.
export function InlineSpinner({ label = 'Loading...' }) {
  return (
    <span className="ax-inline-spinner" role="status" aria-live="polite">
      <span aria-hidden="true" />
      {label}
    </span>
  )
}
