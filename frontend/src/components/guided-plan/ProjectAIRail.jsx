/* ============================================================
 * COMPONENT: AI RAIL (PROJECT-LEVEL)
 * Keywords: ai rail, suggestions, project ai sidebar
 * ============================================================ */
import React from 'react'
import AIProjectPlanPanel from './AIProjectPlanPanel'

// Right-rail aside that hosts the AI project plan panel with an optional resize handle.
export default function ProjectAIRail({
  dataset,
  activeTab,
  collapsed,
  onStartResize,
  onOpenGuidanceSetup,
  onGuidanceUpdated,
  cleaningIssues,
}) {
  if (!dataset || collapsed) return null

  return (
    <aside className="ax-ai-rail">
      <div className="ax-rail-body ax-rail-body-plan">
        <AIProjectPlanPanel
          dataset={dataset}
          activeTab={activeTab}
          onOpenGuidanceSetup={onOpenGuidanceSetup}
          onGuidanceUpdated={onGuidanceUpdated}
          cleaningIssues={cleaningIssues}
        />
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
