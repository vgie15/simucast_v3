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
  panelOpen,
  showOnboarding,
  onOpenGuidanceSetup,
  onGuidanceUpdated,
  onStartGuideFocus,
  onDismissOnboarding,
}) {
  if (!dataset) return null

  return (
    <div className="ax-rail-body ax-rail-body-plan" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AIProjectPlanPanel
        dataset={dataset}
        activeTab={activeTab}
        panelOpen={panelOpen}
        showOnboarding={showOnboarding}
        onOpenGuidanceSetup={onOpenGuidanceSetup}
        onGuidanceUpdated={onGuidanceUpdated}
        onStartGuideFocus={onStartGuideFocus}
        onDismissOnboarding={onDismissOnboarding}
      />
    </div>
  )
}
