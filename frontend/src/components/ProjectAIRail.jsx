import React, { useEffect, useState } from 'react'
import AIAssistantPanel from './AIAssistantPanel'
import AIChatPanel from './AIChatPanel'

export default function ProjectAIRail({ dataset, activeTab }) {
  const datasetId = dataset?.id
  const collapseKey = datasetId ? `simucast.aiRail.collapsed.${datasetId}` : ''
  const tabKey = datasetId ? `simucast.aiRail.tab.${datasetId}` : ''
  const [collapsed, setCollapsed] = useState(false)
  const [innerTab, setInnerTab] = useState('guide')

  useEffect(() => {
    if (!collapseKey) return
    setCollapsed(window.localStorage.getItem(collapseKey) === '1')
  }, [collapseKey])

  useEffect(() => {
    if (!tabKey) return
    const saved = window.localStorage.getItem(tabKey)
    if (saved === 'guide' || saved === 'chat') setInnerTab(saved)
  }, [tabKey])

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c
      if (collapseKey) window.localStorage.setItem(collapseKey, next ? '1' : '0')
      return next
    })
  }

  const switchTab = (next) => {
    setInnerTab(next)
    if (tabKey) window.localStorage.setItem(tabKey, next)
  }

  if (!dataset) return null

  return (
    <aside className={`ax-ai-rail ${collapsed ? 'collapsed' : ''}`}>
      <div className="ax-rail-header">
        <button
          type="button"
          className="ax-rail-collapse"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand AI panel' : 'Collapse AI panel'}
          title={collapsed ? 'Expand AI panel' : 'Collapse AI panel'}
        >
          <RailChevron open={!collapsed} side="right" />
        </button>
        {!collapsed && <span className="ax-rail-title">AI</span>}
      </div>

      {!collapsed && (
        <>
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

          <div className="ax-rail-body">
            {innerTab === 'guide' ? (
              <AIAssistantPanel datasetId={dataset.id} context={activeTab} />
            ) : (
              <AIChatPanel datasetId={dataset.id} activeTab={activeTab} />
            )}
          </div>
        </>
      )}
    </aside>
  )
}

function RailChevron({ open, side }) {
  const rotate = open ? (side === 'right' ? 0 : 180) : (side === 'right' ? 180 : 0)
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 12 12"
      fill="none"
      style={{ transform: `rotate(${rotate}deg)`, transition: 'transform 0.15s' }}
    >
      <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  )
}
