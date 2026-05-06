import React from 'react'

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

export function InlineSpinner({ label = 'Loading...' }) {
  return (
    <span className="ax-inline-spinner" role="status" aria-live="polite">
      <span aria-hidden="true" />
      {label}
    </span>
  )
}
