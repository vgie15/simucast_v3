import React, { useEffect, useState } from 'react'
import { api } from '../api'

export default function CategoryStandardizationCard({ dataset, onApplied }) {
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedColumn, setSelectedColumn] = useState('')
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (!dataset?.id) return
    setLoading(true)
    try {
      const r = await api.categorySuggestions(dataset.id)
      setSuggestions(r.suggestions || [])
      const nextDrafts = {}
      for (const suggestion of r.suggestions || []) {
        nextDrafts[suggestion.column] = (suggestion.groups || []).map((group) => ({
          ...group,
          selected: Object.fromEntries((group.values || []).map((value) => [value, true])),
        }))
      }
      setDrafts(nextDrafts)
      setSelectedColumn((current) => current || r.suggestions?.[0]?.column || '')
    } catch (err) {
      console.error('Failed to load category suggestions', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [dataset?.id, dataset?.current_stage_id])

  const current = suggestions.find((s) => s.column === selectedColumn)
  const groups = drafts[selectedColumn] || []

  const setGroup = (index, patch) => {
    setDrafts((currentDrafts) => {
      const nextGroups = [...(currentDrafts[selectedColumn] || [])]
      nextGroups[index] = { ...nextGroups[index], ...patch }
      return { ...currentDrafts, [selectedColumn]: nextGroups }
    })
  }

  const apply = async () => {
    const mapping = {}
    for (const group of groups) {
      const label = (group.suggested_label || '').trim()
      if (!label) continue
      for (const value of group.values || []) {
        if (group.selected?.[value]) mapping[value] = label
      }
    }
    if (!Object.keys(mapping).length) return
    setBusy(true)
    try {
      await api.applyCategoryStandardization(dataset.id, { column: selectedColumn, mapping })
      await onApplied?.()
      await load()
    } catch (err) {
      alert('Category standardization failed: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading && suggestions.length === 0) {
    return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Checking category labels...</p>
  }
  if (!suggestions.length) return null

  return (
    <div className="ax-card" style={{ marginBottom: 16 }}>
      <div className="ax-row" style={{ marginBottom: 10 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Category standardization</p>
          <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>
            Review similar labels, rename the final label, then apply one documented cleanup step.
          </p>
        </div>
        <button className="ax-btn" onClick={load} disabled={loading}>Refresh</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px 10px', alignItems: 'center', marginBottom: 10 }}>
        <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Column</label>
        <select value={selectedColumn} onChange={(e) => setSelectedColumn(e.target.value)}>
          {suggestions.map((s) => (
            <option key={s.column} value={s.column}>{s.column} ({s.groups.length} group{s.groups.length === 1 ? '' : 's'})</option>
          ))}
        </select>
      </div>

      {current && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groups.map((group, index) => (
            <div key={index} className="ax-card" style={{ padding: 10, background: 'var(--color-background-secondary)' }}>
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
                {(group.values || []).map((value) => (
                  <label key={value} className="ax-chip" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!group.selected?.[value]}
                      onChange={(e) => {
                        setGroup(index, { selected: { ...(group.selected || {}), [value]: e.target.checked } })
                      }}
                    />
                    <span style={{ marginLeft: 4 }}>{value}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div style={{ textAlign: 'right' }}>
            <button className="ax-btn prim" onClick={apply} disabled={busy || !groups.length}>
              {busy ? 'Applying...' : 'Apply standardization'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
