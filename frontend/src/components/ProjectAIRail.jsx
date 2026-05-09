/* ============================================================
 * COMPONENT: AI RAIL (PROJECT-LEVEL)
 * Keywords: ai rail, suggestions, project ai sidebar
 * ============================================================ */
import React from 'react'
import AIProjectPlanPanel from './AIProjectPlanPanel'

export default function ProjectAIRail({ dataset, activeTab, collapsed, onStartResize }) {
  if (!dataset || collapsed) return null

  return (
    <aside className="ax-ai-rail">
      <div className="ax-rail-body ax-rail-body-plan">
        <AIProjectPlanPanel dataset={dataset} activeTab={activeTab} />
      </div>
      {onStartResize && (
        <div
          className="ax-rail-resize-handle left"
          onMouseDown={(e) => {
            e.preventDefault()
            onStartResize()
          }}
          aria-hidden
        />
      )}
    </aside>
  )
}
