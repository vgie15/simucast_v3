import React from 'react'
import ActivityPanel from './ActivityPanel'

export default function ProjectHistoryRail({ dataset, onViewStage, onRestored, collapsed, onStartResize }) {
  if (!dataset?.id || collapsed) return null

  return (
    <aside className="ax-history-rail">
      <div className="ax-rail-body ax-rail-body-history">
        <ActivityPanel
          datasetId={dataset.id}
          onViewStage={onViewStage}
          onRestored={onRestored}
          title="History"
          subtitle="Project timeline, notes, undo steps, and report-ready documentation."
        />
      </div>
      {onStartResize && (
        <div
          className="ax-rail-resize-handle right"
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
