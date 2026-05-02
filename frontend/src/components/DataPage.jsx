import React, { useEffect, useState } from 'react'
import { api } from '../api'
import ColumnValuesModal from './ColumnValuesModal'
import AIAssistantPanel from './AIAssistantPanel'
import ManualTransformsCard from './ManualTransformsCard'
import DataGridViewer from './DataGridViewer'
import CategoryStandardizationCard from './CategoryStandardizationCard'

export default function DataPage({ dataset, setDataset, viewStageRequest }) {
  const [viewStageId, setViewStageId] = useState('current')
  const [viewStageLabel, setViewStageLabel] = useState(null)
  const [activeVar, setActiveVar] = useState(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [suggestions, setSuggestions] = useState([])
  const [statuses, setStatuses] = useState({})
  const [selectedActions, setSelectedActions] = useState({})
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [applyingAll, setApplyingAll] = useState(false)

  useEffect(() => {
    if (!dataset) return
    loadSuggestions()
  }, [dataset?.id])

  useEffect(() => {
    if (!viewStageRequest?.stageId) return
    const stageId = viewStageRequest.stageId
    if (stageId === dataset?.current_stage_id) {
      setViewStageId('current')
      setViewStageLabel(null)
      return
    }
    setViewStageId(stageId)
    setViewStageLabel(stageId === 'original' ? 'Original upload' : `Stage ${stageId.slice(0, 8)}`)
  }, [viewStageRequest?.nonce, dataset?.current_stage_id])

  const refreshDataset = async () => {
    try {
      const fresh = await api.getDataset(dataset.id)
      setDataset?.(fresh)
      setHistoryKey((k) => k + 1)
    } catch (err) {
      console.error('Failed to refresh dataset', err)
    }
  }

  const loadSuggestions = async () => {
    setSuggestionsLoading(true)
    try {
      const r = await api.cleanSuggestions(dataset.id)
      const nextSuggestions = r.suggestions || []
      setSuggestions(nextSuggestions)
      setStatuses({})
      setSelectedActions(
        nextSuggestions.reduce((acc, suggestion) => {
          acc[suggestion.id] = suggestion.action
          return acc
        }, {}),
      )
    } catch (err) {
      console.error('Failed to load cleaning suggestions', err)
    } finally {
      setSuggestionsLoading(false)
    }
  }

  const handleApplied = async () => {
    setViewStageId('current')
    setViewStageLabel(null)
    await refreshDataset()
    await loadSuggestions()
  }

  const actOnSuggestion = async (suggestion, accept) => {
    if (!accept) {
      setStatuses((current) => ({ ...current, [suggestion.id]: 'skipped' }))
      return
    }
    try {
      const action = selectedActions[suggestion.id] || suggestion.action
      await api.cleanApply(dataset.id, { action, variable: suggestion.variable })
      setStatuses((current) => ({ ...current, [suggestion.id]: 'applied' }))
      await handleApplied()
    } catch (err) {
      alert('Apply failed: ' + err.message)
    }
  }

  const applyAllSuggestions = async () => {
    const todo = suggestions.filter((s) => !statuses[s.id])
    if (!todo.length || applyingAll) return
    if (!window.confirm(`Apply ${todo.length} suggested fix${todo.length === 1 ? '' : 'es'} using the selected methods?`)) return
    setApplyingAll(true)
    try {
      const applied = {}
      for (const suggestion of todo) {
        const action = selectedActions[suggestion.id] || suggestion.action
        await api.cleanApply(dataset.id, { action, variable: suggestion.variable })
        applied[suggestion.id] = 'applied'
      }
      setStatuses((current) => ({ ...current, ...applied }))
      await handleApplied()
    } catch (err) {
      alert('Apply all failed: ' + err.message)
      await refreshDataset()
      await loadSuggestions()
    } finally {
      setApplyingAll(false)
    }
  }

  const missing = suggestions.filter((s) => s.kind === 'missing').length
  const outliers = suggestions.filter((s) => s.kind === 'outliers').length
  const types = suggestions.filter((s) => s.kind === 'type').length

  return (
    <>
      <h1 className="ax-page-title">{dataset.name}</h1>
      <p className="ax-page-sub">
        {dataset.row_count?.toLocaleString()} rows · {dataset.col_count} variables
      </p>

      <div className="ax-card" style={{ marginBottom: 16 }}>
        <div className="ax-row">
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Raw data</p>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>
              Browse, inspect, and export the active dataset.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <a
              className="ax-btn"
              href={api.exportCsvUrl(dataset.id)}
              download
              style={{ textDecoration: 'none' }}
            >
              Download CSV
            </a>
            {viewStageId !== 'current' && (
              <button
                className="ax-btn prim"
                onClick={() => {
                  setViewStageId('current')
                  setViewStageLabel(null)
                }}
              >
                Show current stage
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <DataGridViewer
          key={`${dataset.id}:${dataset.current_stage_id}:${historyKey}`}
          datasetId={dataset.id}
          variables={dataset.variables || []}
          stageId={viewStageId === 'current' ? null : viewStageId}
          currentStageId={dataset.current_stage_id}
          stageLabel={viewStageLabel}
          refreshKey={historyKey}
          onVariableClick={setActiveVar}
          onDataChanged={handleApplied}
        />
      </div>

      <AIAssistantPanel datasetId={dataset.id} context="data" />

      <ManualTransformsCard dataset={dataset} onApplied={handleApplied} />

      <CategoryStandardizationCard dataset={dataset} onApplied={handleApplied} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
        <StatCard label="Missing" value={missing} />
        <StatCard label="Outliers" value={outliers} />
        <StatCard label="Type issues" value={types} />
      </div>

      <div className="ax-row" style={{ marginBottom: 8 }}>
        <p className="ax-lbl" style={{ margin: 0 }}>Suggested fixes</p>
        {suggestions.length > 0 && (
          <button className="ax-btn prim" onClick={applyAllSuggestions} disabled={applyingAll || suggestionsLoading}>
            {applyingAll ? 'Applying...' : 'Apply all'}
          </button>
        )}
      </div>
      {suggestionsLoading ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 0 }}>Analyzing...</p>
      ) : suggestions.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 0 }}>No issues found. Your data looks clean.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {suggestions.map((s) => {
            const st = statuses[s.id]
            return (
              <div key={s.id} className="ax-card" style={{ padding: '10px 12px', opacity: st ? 0.4 : 1 }}>
                <div className="ax-row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <KindBadge kind={s.kind} />
                      <span style={{ fontSize: 12, fontWeight: 500 }}>{s.variable}</span>
                      {st && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: '1px 6px',
                            background: st === 'applied' ? 'var(--color-background-success)' : 'var(--color-background-secondary)',
                            color: st === 'applied' ? 'var(--color-text-success)' : 'var(--color-text-secondary)',
                            borderRadius: 4,
                            marginLeft: 6,
                          }}
                        >
                          {st === 'applied' ? 'Applied' : 'Skipped'}
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
                      {s.description}
                    </p>
                    {(s.options || []).length > 0 && !st && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                        {(s.options || []).map((option) => (
                          <label
                            key={option.action}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 6,
                              fontSize: 11,
                              color: 'var(--color-text-secondary)',
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type="radio"
                              name={`clean-method-${s.id}`}
                              checked={(selectedActions[s.id] || s.action) === option.action}
                              onChange={() => {
                                setSelectedActions((current) => ({ ...current, [s.id]: option.action }))
                              }}
                              style={{ marginTop: 2 }}
                            />
                            <span>
                              <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
                                {option.label}
                              </span>
                              {option.description && (
                                <span> - {option.description}</span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  {!st && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="ax-btn" onClick={() => actOnSuggestion(s, false)}>Skip</button>
                      <button className="ax-btn prim" onClick={() => actOnSuggestion(s, true)}>Apply</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {activeVar && (
        <ColumnValuesModal
          datasetId={dataset.id}
          variable={activeVar}
          onClose={() => setActiveVar(null)}
        />
      )}
    </>
  )
}

function StatCard({ label, value }) {
  return (
    <div style={{ background: 'var(--color-background-primary)', borderRadius: 6, padding: 12, border: '0.5px solid var(--color-border-tertiary)' }}>
      <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 500, margin: '4px 0 0' }}>{value}</p>
    </div>
  )
}

function KindBadge({ kind }) {
  const map = {
    missing: { bg: '#FAEEDA', fg: '#854F0B', label: 'Missing' },
    outliers: { bg: '#FCEBEB', fg: '#A32D2D', label: 'Outliers' },
    type: { bg: '#E6F1FB', fg: '#185FA5', label: 'Type' },
    expand: { bg: '#EEEDFE', fg: '#3C3489', label: 'Expand' },
  }
  const c = map[kind] || map.missing
  return (
    <span style={{ fontSize: 10, padding: '1px 6px', background: c.bg, color: c.fg, borderRadius: 4 }}>
      {c.label}
    </span>
  )
}
