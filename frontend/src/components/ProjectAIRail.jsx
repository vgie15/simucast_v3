import React, { useEffect, useState } from 'react'
import AIAssistantPanel from './AIAssistantPanel'
import AIChatPanel from './AIChatPanel'

export default function ProjectAIRail({ dataset, activeTab, collapsed, onStartResize }) {
  const datasetId = dataset?.id
  const tabKey = datasetId ? `simucast.aiRail.tab.${datasetId}` : ''
  const [innerTab, setInnerTab] = useState('guide')

  useEffect(() => {
    if (!tabKey) return
    const saved = window.localStorage.getItem(tabKey)
    if (saved === 'guide' || saved === 'chat') setInnerTab(saved)
  }, [tabKey])

  const switchTab = (next) => {
    setInnerTab(next)
    if (tabKey) window.localStorage.setItem(tabKey, next)
  }

  if (!dataset || collapsed) return null

  return (
    <aside className="ax-ai-rail">
      <div className="ax-rail-header">
        <span className="ax-rail-title">Assistant</span>
      </div>

      <div className="ax-rail-tabs">
        <button
          type="button"
          className={innerTab === 'guide' ? 'active' : ''}
          onClick={() => switchTab('guide')}
        >
          Guide
        </button>
        <button
          type="button"
          className={innerTab === 'chat' ? 'active' : ''}
          onClick={() => switchTab('chat')}
        >
          AI assistant
        </button>
      </div>

      {innerTab === 'guide' ? (
        <div className="ax-rail-body">
          <AIAssistantPanel datasetId={dataset.id} context={activeTab} />
        </div>
      ) : (
        <AIChatPanel datasetId={dataset.id} activeTab={activeTab} />
      )}
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
