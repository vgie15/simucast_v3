/* ============================================================
 * COMPONENT: PAGE GUIDE
 * Keywords: guidance, beginner, workflow, steps
 * ============================================================ */
import React from 'react'

// Compact guidance strip used at the top of workflow pages.
export default function PageGuide({ title, children, steps = [], meta }) {
  return (
    <section className="ax-page-guide" aria-label={title}>
      <div className="ax-page-guide-copy">
        {meta && <span className="ax-page-guide-meta">{meta}</span>}
        <p className="ax-page-guide-title">{title}</p>
        {children && <p className="ax-page-guide-text">{children}</p>}
      </div>
      {steps.length > 0 && (
        <ol className="ax-page-guide-steps">
          {steps.map((step, index) => (
            <li key={`${step}-${index}`}>
              <span>{index + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
