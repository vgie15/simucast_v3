import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useDialog } from './DialogProvider'
import { InlineSpinner } from './LoadingStates'

export default function CategoryStandardizationCard({ dataset, onApplied }) {
  const dialog = useDialog()
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedColumn, setSelectedColumn] = useState('')
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState(false)
  const [appliedSummary, setAppliedSummary] = useState(null)
  const [skippedColumns, setSkippedColumns] = useState([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState(null)
  const [expandedGroups, setExpandedGroups] = useState({})

  const load = async (preferredColumn) => {
    if (!dataset?.id) return
    setLoading(true)
    try {
      const r = await api.categorySuggestions(dataset.id)
      setSuggestions(r.suggestions || [])
      const nextDrafts = {}
      for (const suggestion of r.suggestions || []) {
        nextDrafts[suggestion.column] = (suggestion.groups || []).map((group) => ({
          ...group,
          selected: Object.fromEntries((group.values || []).map((value) => [String(value), true])),
        }))
      }
      setDrafts(nextDrafts)
      setSelectedColumn((current) => {
        const columns = (r.suggestions || []).map((s) => s.column)
        if (preferredColumn && columns.includes(preferredColumn)) return preferredColumn
        return columns.includes(current) ? current : columns[0] || ''
      })
    } catch (err) {
      console.error('Failed to load category suggestions', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setSkippedColumns([])
    setAiSuggestion(null)
    load()
  }, [dataset?.id, dataset?.current_stage_id])

  useEffect(() => {
    setAiSuggestion(null)
    setExpandedGroups({})
  }, [selectedColumn])

  const current = suggestions.find((s) => s.column === selectedColumn)
  const visibleSuggestions = suggestions.filter((s) => !skippedColumns.includes(s.column))
  const selectedIndex = Math.max(0, visibleSuggestions.findIndex((s) => s.column === selectedColumn))
  const upcomingColumns = visibleSuggestions
    .filter((s) => s.column !== selectedColumn)
    .slice(0, 3)
    .map((s) => s.column)
  const groups = drafts[selectedColumn] || []
  const uniqueValues = current?.unique_values || []

  const goToIndex = (nextIndex) => {
    if (!visibleSuggestions.length) return
    const bounded = Math.min(Math.max(nextIndex, 0), visibleSuggestions.length - 1)
    setSelectedColumn(visibleSuggestions[bounded].column)
  }

  const skipCurrent = () => {
    if (!selectedColumn) return
    const nextVisible = visibleSuggestions.filter((s) => s.column !== selectedColumn)
    setSkippedColumns((currentSkipped) => Array.from(new Set([...currentSkipped, selectedColumn])))
    setSelectedColumn(nextVisible[0]?.column || '')
  }

  const resumeSkipped = () => {
    setSkippedColumns([])
    setSelectedColumn(suggestions[0]?.column || '')
  }

  const setGroup = (index, patch) => {
    setDrafts((currentDrafts) => {
      const nextGroups = [...(currentDrafts[selectedColumn] || [])]
      nextGroups[index] = { ...nextGroups[index], ...patch }
      return { ...currentDrafts, [selectedColumn]: nextGroups }
    })
  }

  const deleteGroup = (index) => {
    setDrafts((currentDrafts) => {
      const nextGroups = [...(currentDrafts[selectedColumn] || [])]
      nextGroups.splice(index, 1)
      return { ...currentDrafts, [selectedColumn]: nextGroups }
    })
  }

  const addGroup = () => {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [selectedColumn]: [
        ...(currentDrafts[selectedColumn] || []),
        {
          values: [],
          suggested_label: '',
          reason: 'Manual grouping created by the user.',
          selected: {},
        },
      ],
    }))
  }

  const askAiForRecommendation = async () => {
    if (!dataset?.id || !current || aiLoading) return
    setAiLoading(true)
    setAiSuggestion(null)
    try {
      const payload = {
        stage_id: dataset.current_stage_id,
        column: selectedColumn,
        unique_values: uniqueValues,
        system_groups: groups.map((group) => ({
          final_label: group.suggested_label,
          selected_values: Object.entries(group.selected || {})
            .filter(([, selected]) => selected)
            .map(([value]) => value),
          reason: group.reason,
        })),
        available_action: 'standardize categorical labels',
      }
      const r = await api.aiExplain(
        dataset.id,
        `category-standardization-recommendation:${dataset.current_stage_id || 'current'}:${selectedColumn}`,
        payload,
        'Give plain-text advice for this category standardization card. Recommend which source values should belong under each final label. Use only the current values and do not apply changes.',
        payload,
      )
      setAiSuggestion({ ok: true, text: r.explanation || 'AI advisory unavailable.' })
    } catch {
      setAiSuggestion({ ok: false, text: 'AI advisory unavailable.' })
    } finally {
      setAiLoading(false)
    }
  }

  const apply = async () => {
    const mapping = {}
    const assigned = {}
    for (const group of groups) {
      const label = (group.suggested_label || '').trim()
      if (!label) continue
      for (const [value, selected] of Object.entries(group.selected || {})) {
        if (selected && assigned[value] && assigned[value] !== label) {
          await dialog.alert({
            title: 'Duplicate Selection',
            message: `"${value}" is selected in more than one final label.`,
            details: 'Keep each source value in only one standardized group before applying.',
            variant: 'danger',
          })
          return
        }
        if (selected) assigned[value] = label
        if (selected) mapping[value] = label
      }
    }
    if (!Object.keys(mapping).length) return
    setBusy(true)
    try {
      const result = await api.applyCategoryStandardization(dataset.id, { column: selectedColumn, mapping })
      const currentPosition = selectedIndex
      setAppliedSummary({
        column: selectedColumn,
        summary: result.summary || `Standardized categories in ${selectedColumn}`,
        mapping,
      })
      await onApplied?.()
      const nextColumn = visibleSuggestions[currentPosition + 1]?.column || visibleSuggestions[currentPosition - 1]?.column
      await load(nextColumn)
    } catch (err) {
      await dialog.alert({ title: 'Category Standardization Failed', message: err.message, variant: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  if (loading && suggestions.length === 0) {
    return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Checking category labels...</p>
  }
  if (!suggestions.length || visibleSuggestions.length === 0) {
    return (
      <div className="ax-card" style={{ marginBottom: 16 }}>
        <div className="ax-row" style={{ marginBottom: appliedSummary ? 10 : 0 }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Category standardization</p>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>
              {suggestions.length && visibleSuggestions.length === 0
                ? `${suggestions.length} column${suggestions.length === 1 ? '' : 's'} skipped for now.`
                : 'No category standardization suggestions are pending.'}
            </p>
          </div>
          {suggestions.length && visibleSuggestions.length === 0 ? (
            <button className="ax-btn" onClick={resumeSkipped} disabled={loading}>Resume review</button>
          ) : null}
        </div>
        {appliedSummary && (
          <div style={{ borderTop: '0.5px solid var(--color-border-tertiary)', paddingTop: 10 }}>
            <p style={{ fontSize: 12, fontWeight: 500, margin: '0 0 4px' }}>Last applied</p>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>{appliedSummary.summary}</p>
            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '6px 0 0' }}>
              {Object.entries(appliedSummary.mapping).map(([from, to]) => `${from} -> ${to}`).join(' · ')}
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="ax-card" style={{ marginBottom: 16 }}>
      <div className="ax-row" style={{ marginBottom: 10 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Category standardization</p>
          <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>
            {visibleSuggestions.length} column{visibleSuggestions.length === 1 ? '' : 's'} need review. Review, skip, or apply when useful.
          </p>
          <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
            Optional but recommended when similar labels are detected. Check the source values that belong under each final label, then apply the mapping.
          </p>
        </div>
        {/* buttons removed — use per-column Skip / Previous / Next controls below */}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px 10px', alignItems: 'center', marginBottom: 10 }}>
        <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Column</label>
        <select value={selectedColumn} onChange={(e) => setSelectedColumn(e.target.value)}>
          {visibleSuggestions.map((s) => (
            <option key={s.column} value={s.column}>{s.column} ({s.groups.length} group{s.groups.length === 1 ? '' : 's'})</option>
          ))}
        </select>
      </div>

      <div className="ax-card" style={{ padding: 10, marginBottom: 10, background: 'var(--color-background-primary)' }}>
        <div className="ax-row" style={{ gap: 10 }}>
          <div>
            <p style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>
              Reviewing column {selectedIndex + 1} of {visibleSuggestions.length}: {selectedColumn}
            </p>
            {upcomingColumns.length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '3px 0 0' }}>
                Upcoming: {upcomingColumns.join(', ')}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="ax-btn" onClick={() => goToIndex(selectedIndex - 1)} disabled={selectedIndex <= 0 || busy}>Previous</button>
            <button className="ax-btn" onClick={() => goToIndex(selectedIndex + 1)} disabled={selectedIndex >= visibleSuggestions.length - 1 || busy}>Next</button>
            <button className="ax-btn" onClick={skipCurrent} disabled={busy}>Skip this column</button>
          </div>
        </div>
      </div>

      {current && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)', margin: 0 }}>
                Recommended label groups
              </p>
              <SystemSourceLabel />
              <InfoDot text="System recommendation means SimuCast grouped labels using exact values, case/spacing similarities, and common binary/value patterns. You can still edit labels or uncheck values before applying." />
            </div>
            <button
              className="ax-btn mini"
              type="button"
              onClick={askAiForRecommendation}
              disabled={aiLoading}
              style={{ background: 'transparent', borderColor: 'transparent', color: 'var(--color-text-secondary)' }}
            >
              {aiLoading ? <InlineSpinner label="Asking..." /> : 'Need AI advice?'}
            </button>
          </div>
          <AiSuggestionBox loading={aiLoading} suggestion={aiSuggestion} />
          <div className="ax-card" style={{ padding: 10, background: 'var(--color-background-primary)' }}>
            <p style={{ fontSize: 11, fontWeight: 500, margin: '0 0 6px' }}>Unique values detected</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {uniqueValues.map((item) => (
                <span key={item.value} className="ax-chip">
                  {item.value} <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 3 }}>({item.count})</span>
                </span>
              ))}
            </div>
          </div>
          {groups.map((group, index) => (
            <div key={index} style={{ padding: '10px 0', borderTop: '0.5px solid var(--color-border-tertiary)' }}>
              <div className="ax-row" style={{ marginBottom: 6, alignItems: 'flex-start' }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 800, margin: 0 }}>
                    {group.suggested_label || `Group ${index + 1}`}
                    <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500, marginLeft: 6 }}>
                      ← {selectedValues(group).length} selected label{selectedValues(group).length === 1 ? '' : 's'}
                    </span>
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                    {selectedValues(group).slice(0, 5).map((value) => (
                      <span key={value} className="ax-chip">{value}</span>
                    ))}
                    {selectedValues(group).length > 5 && (
                      <span className="ax-chip">+{selectedValues(group).length - 5} more</span>
                    )}
                  </div>
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--color-text-tertiary)', fontSize: 11 }}>Why this mapping?</summary>
                    <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>{group.reason}</p>
                  </details>
                </div>
                <button className="ax-btn danger" onClick={() => deleteGroup(index)} disabled={busy} type="button">
                  Delete group
                </button>
              </div>
              <button
                className="ax-btn mini"
                type="button"
                onClick={() => setExpandedGroups((current) => ({ ...current, [index]: !current[index] }))}
              >
                {expandedGroups[index] ? 'Hide selection' : 'Review selection'}
              </button>
              {expandedGroups[index] && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '8px 10px', alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Final label</label>
                    <input
                      value={group.suggested_label || ''}
                      onChange={(e) => setGroup(index, { suggested_label: e.target.value })}
                    />
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 6px' }}>
                    Check only the detected labels that should become <strong>{group.suggested_label || 'this final label'}</strong>.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {uniqueValues.map((item) => (
                      <label key={item.value} className="ax-chip" style={{ cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={!!group.selected?.[item.value]}
                          onChange={(e) => {
                            setGroup(index, { selected: { ...(group.selected || {}), [item.value]: e.target.checked } })
                          }}
                        />
                        <span style={{ marginLeft: 4 }}>{item.value}</span>
                        <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 3 }}>({item.count})</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className="ax-row">
            <button className="ax-btn" onClick={addGroup} disabled={busy}>
              Add group
            </button>
            <button className="ax-btn prim" onClick={apply} disabled={busy || !groups.length}>
              {busy ? 'Applying...' : 'Apply and go next'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function selectedValues(group) {
  return Object.entries(group.selected || {})
    .filter(([, selected]) => selected)
    .map(([value]) => value)
}

function SystemSourceLabel() {
  return (
    <span style={{ fontSize: 12, color: 'var(--color-accent)', fontWeight: 800 }}>System recommendation</span>
  )
}

function InfoDot({ text }) {
  return (
    <span
      title={text}
      aria-label={text}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        borderRadius: '999px',
        border: '1px solid var(--color-border-secondary)',
        background: 'var(--color-background-primary)',
        color: 'var(--color-text-secondary)',
        fontSize: 11,
        fontWeight: 800,
        lineHeight: 1,
        cursor: 'help',
      }}
    >
      i
    </span>
  )
}

function AiSuggestionBox({ suggestion }) {
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    if (suggestion) setCollapsed(false)
  }, [suggestion?.text])
  if (!suggestion) return null
  return (
    <div style={{
      padding: '10px 12px',
      border: '0.5px solid var(--color-border-tertiary)',
      borderRadius: 10,
      background: suggestion.ok ? 'var(--color-background-info)' : 'var(--color-background-secondary)',
      fontSize: 12,
      maxHeight: 260,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: collapsed ? 0 : 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: suggestion.ok ? 'var(--color-text-info)' : 'var(--color-text-secondary)', fontWeight: 750 }}>AI advisory</span>
          <span style={{ color: 'var(--color-text-tertiary)' }}>advisory only</span>
        </div>
        <button className="ax-btn mini" type="button" onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>
      {!collapsed && (
        <div style={{ overflowY: 'auto', paddingRight: 4, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
          {suggestion.text}
        </div>
      )}
    </div>
  )
}
