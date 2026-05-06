import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useDialog } from './DialogProvider'

export default function CategoryStandardizationCard({ dataset, onApplied }) {
  const dialog = useDialog()
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedColumn, setSelectedColumn] = useState('')
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState(false)
  const [appliedSummary, setAppliedSummary] = useState(null)
  const [skippedColumns, setSkippedColumns] = useState([])

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
    load()
  }, [dataset?.id, dataset?.current_stage_id])

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
            <div key={index} className="ax-card" style={{ padding: 10, background: 'var(--color-background-secondary)' }}>
              <div className="ax-row" style={{ marginBottom: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 700, margin: 0 }}>Group {index + 1}</p>
                <button className="ax-btn danger" onClick={() => deleteGroup(index)} disabled={busy} type="button">
                  Delete group
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '8px 10px', alignItems: 'center' }}>
                <label style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Final label</label>
                <input
                  value={group.suggested_label || ''}
                  onChange={(e) => setGroup(index, { suggested_label: e.target.value })}
                />
              </div>
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '8px 0 4px' }}>
                {group.reason}
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
