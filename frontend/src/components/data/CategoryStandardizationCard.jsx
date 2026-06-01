/* ============================================================
 * COMPONENT: CATEGORY STANDARDIZATION CARD
 * Keywords: category, standardize, fuzzy, suggestions, manual edit
 * ============================================================ */
import React, { useEffect, useState, useMemo } from 'react'
import { api } from '../../api'
import { useDialog } from '../common/DialogProvider'
import { InlineSpinner } from '../common/LoadingStates'
import HelpButton from '../common/HelpButton'
import { SparkleIcon } from '../ai/AIExplainers'
import { useAuth } from '../providers/AuthProvider'

const ORANGE = '#f97316'

// Card that suggests fuzzy category groupings per column and lets users review and apply standardizations.
export default function CategoryStandardizationCard({ dataset, onApplied, compact = false, showRecommendations = false }) {
  const dialog = useDialog()
  const auth = useAuth()
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedColumn, setSelectedColumn] = useState('')
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState(false)
  const [appliedSummary, setAppliedSummary] = useState(null)
  const [skippedColumns, setSkippedColumns] = useState([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState(null)
  const [editingGroups, setEditingGroups] = useState({})
  // Mode: 'detected' shows auto-groups, 'manual' shows editable rows
  const [editMode, setEditMode] = useState('detected')
  // Manual edit state: { value: newLabel }
  const [manualEdits, setManualEdits] = useState({})
  // Column stats for manual mode
  const [columnStats, setColumnStats] = useState([])

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
    setEditingGroups({})
    setManualEdits({})
    setEditMode('detected')
    load()
  }, [dataset?.id, dataset?.current_stage_id])

  useEffect(() => {
    setAiSuggestion(null)
  }, [selectedColumn])

  // When column changes, reset manual edits for that column
  useEffect(() => {
    if (selectedColumn && !manualEdits[selectedColumn]) {
      setManualEdits((prev) => ({ ...prev, [selectedColumn]: {} }))
    }
    // Fetch column stats for manual mode
    if (dataset?.id && selectedColumn) {
      api.columnStats(dataset.id, selectedColumn).then((stats) => {
        setColumnStats((stats.value_counts || []).map((item) => ({ value: String(item.value), count: item.count })))
      }).catch(() => setColumnStats([]))
    }
  }, [selectedColumn, dataset?.id])

  // Auto-select first categorical column when no suggestions exist
  useEffect(() => {
    if (!dataset?.id || suggestions.length > 0 || selectedColumn) return
    const vars = dataset.variables || []
    const catVars = vars.filter((v) => ['category', 'text', 'binary', 'boolean'].includes(v.dtype))
    if (catVars.length > 0) {
      setSelectedColumn(catVars[0].name)
    }
  }, [dataset?.id, suggestions.length, selectedColumn])

  const current = suggestions.find((s) => s.column === selectedColumn)
  const visibleSuggestions = suggestions.filter((s) => !skippedColumns.includes(s.column))
  const selectedIndex = Math.max(0, visibleSuggestions.findIndex((s) => s.column === selectedColumn))
  const upcomingColumns = visibleSuggestions
    .filter((s) => s.column !== selectedColumn)
    .slice(0, 3)
    .map((s) => s.column)
  const groups = drafts[selectedColumn] || []
  const uniqueValues = current?.unique_values || []
  const hasDetectedGroups = groups.length > 0

  // Manual edit data for current column
  const currentManualEdits = manualEdits[selectedColumn] || {}

  // Check if any manual edits were made (new label differs from current value)
  const hasManualChanges = useMemo(() => {
    if (!selectedColumn || !columnStats.length) return false
    return columnStats.some((item) => {
      const newLabel = currentManualEdits[item.value]
      return newLabel && newLabel.trim() && newLabel.trim() !== item.value
    })
  }, [currentManualEdits, columnStats, selectedColumn])

  // Detect merge conflicts in manual edits
  const mergeWarnings = useMemo(() => {
    const labelToValues = {}
    for (const item of columnStats) {
      const newLabel = currentManualEdits[item.value]
      if (newLabel && newLabel.trim() && newLabel.trim() !== item.value) {
        const label = newLabel.trim()
        if (!labelToValues[label]) labelToValues[label] = []
        labelToValues[label].push(item.value)
      }
    }
    const warnings = {}
    for (const [label, values] of Object.entries(labelToValues)) {
      if (values.length > 1) {
        for (const v of values) {
          warnings[v] = `Will merge with ${values.filter((x) => x !== v).join(', ')}`
        }
      }
    }
    return warnings
  }, [currentManualEdits, columnStats])

  const goToIndex = (nextIndex) => {
    if (!visibleSuggestions.length) return
    const bounded = Math.min(Math.max(nextIndex, 0), visibleSuggestions.length - 1)
    setSelectedColumn(visibleSuggestions[bounded].column)
  }

  const skipCurrent = () => {
    if (!selectedColumn) return
    setSkippedColumns((currentSkipped) => Array.from(new Set([...currentSkipped, selectedColumn])))
    const nextVisible = visibleSuggestions.filter((s) => s.column !== selectedColumn)
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
    setEditingGroups((current) => ({ ...current, [`${selectedColumn}:${index}`]: true }))
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
        { values: [], suggested_label: '', reason: 'Manual grouping created by the user.', selected: {} },
      ],
    }))
  }

  const askAiForRecommendation = async () => {
    if (!dataset?.id || !current || aiLoading) return
    if (auth.isGuest) { auth.requireAccountForAI(); return }
    setAiLoading(true)
    setAiSuggestion(null)
    try {
      const payload = {
        stage_id: dataset.current_stage_id,
        column: selectedColumn,
        unique_values: uniqueValues,
        system_groups: groups.map((g) => ({
          final_label: g.suggested_label,
          selected_values: Object.entries(g.selected || {}).filter(([, s]) => s).map(([v]) => v),
          reason: g.reason,
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
      setAiSuggestion({ ok: true, text: r.explanation || 'AI suggestion unavailable.' })
    } catch { setAiSuggestion({ ok: false, text: 'AI suggestion unavailable.' }) }
    finally { setAiLoading(false) }
  }

  // Apply from detected groups mode
  const applyDetected = async () => {
    const mapping = {}
    const assigned = {}
    for (const group of groups) {
      const label = (group.suggested_label || '').trim()
      if (!label) continue
      for (const [value, selected] of Object.entries(group.selected || {})) {
        if (selected && assigned[value] && assigned[value] !== label) {
          await dialog.alert({ title: 'Duplicate Selection', message: `"${value}" is selected in more than one final label.`, details: 'Keep each source value in only one standardized group before applying.', variant: 'danger' })
          return
        }
        if (selected) { assigned[value] = label; mapping[value] = label }
      }
    }
    if (!Object.keys(mapping).length) return
    setBusy(true)
    try {
      const result = await api.applyCategoryStandardization(dataset.id, { column: selectedColumn, mapping })
      setAppliedSummary({ column: selectedColumn, summary: result.summary || `Standardized categories in ${selectedColumn}`, mapping })
      await onApplied?.()
      const nextColumn = visibleSuggestions[selectedIndex + 1]?.column || visibleSuggestions[selectedIndex - 1]?.column
      await load(nextColumn)
    } catch (err) {
      await dialog.alert({ title: 'Category Standardization Failed', message: err.message, variant: 'danger' })
    } finally { setBusy(false) }
  }

  // Apply from manual edit mode
  const applyManual = async () => {
    if (!selectedColumn || !columnStats.length) return
    const mapping = {}
    for (const item of columnStats) {
      const newLabel = currentManualEdits[item.value]
      if (newLabel && newLabel.trim() && newLabel.trim() !== item.value) {
        mapping[item.value] = newLabel.trim()
      }
    }
    if (!Object.keys(mapping).length) return
    setBusy(true)
    try {
      const result = await api.applyCategoryStandardization(dataset.id, { column: selectedColumn, mapping })
      setAppliedSummary({ column: selectedColumn, summary: result.summary || `Standardized categories in ${selectedColumn}`, mapping })
      await onApplied?.()
      // Reset edits for this column
      setManualEdits((prev) => ({ ...prev, [selectedColumn]: {} }))
      // Reload suggestions
      await load(selectedColumn)
    } catch (err) {
      await dialog.alert({ title: 'Category Standardization Failed', message: err.message, variant: 'danger' })
    } finally { setBusy(false) }
  }

  const resetManualEdits = () => {
    setManualEdits((prev) => ({ ...prev, [selectedColumn]: {} }))
  }

  const setManualEdit = (value, newLabel) => {
    setManualEdits((prev) => ({ ...prev, [selectedColumn]: { ...(prev[selectedColumn] || {}), [value]: newLabel } }))
  }

  if (loading && suggestions.length === 0) {
    return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Checking category labels...</p>
  }

  // No suggestions at all — show manual editor directly for all categorical columns
  if (!suggestions.length) {
    return (
      <div id="data-section-category_standardization" className={`ax-card ax-module-card ax-card-prep ${compact ? 'ax-tool-embedded-card' : ''}`} style={{ marginBottom: compact ? 0 : 16 }}>
        {!compact && (
          <div className="ax-module-head" style={{ marginBottom: 10 }}>
            <div className="ax-module-head-main">
              <div className="ax-module-copy">
                <p className="ax-module-title">
                  Category standardization
                  <HelpButton title="Category standardization" text="Rename or merge categorical labels to keep your data consistent." />
                </p>
                <p className="ax-module-subtitle">No similar labels detected. Edit labels manually below.</p>
              </div>
            </div>
          </div>
        )}
        <ManualEditor
          dataset={dataset}
          columnStats={columnStats}
          selectedColumn={selectedColumn}
          setSelectedColumn={setSelectedColumn}
          manualEdits={currentManualEdits}
          setManualEdit={setManualEdit}
          mergeWarnings={mergeWarnings}
          hasChanges={hasManualChanges}
          onApply={applyManual}
          onReset={resetManualEdits}
          busy={busy}
          compact={compact}
        />
      </div>
    )
  }

  if (visibleSuggestions.length === 0) {
    return (
      <div id="data-section-category_standardization" className={`ax-card ax-module-card ax-card-prep ${compact ? 'ax-tool-embedded-card' : ''}`} style={{ marginBottom: compact ? 0 : 16 }}>
        {!compact && (
          <div className="ax-module-head" style={{ marginBottom: appliedSummary ? 10 : 0 }}>
            <div className="ax-module-head-main">
              <div className="ax-module-copy">
                <p className="ax-module-title">
                  Category standardization
                  <HelpButton title="Category standardization" text="Use this card to combine labels that mean the same thing." />
                </p>
                <p className="ax-module-subtitle">{suggestions.length} column{suggestions.length === 1 ? '' : 's'} skipped for now.</p>
              </div>
            </div>
            <button className="ax-btn" onClick={resumeSkipped} disabled={loading}>Resume review</button>
          </div>
        )}
        {compact && (
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>{suggestions.length} column{suggestions.length === 1 ? '' : 's'} skipped.</p>
        )}
      </div>
    )
  }

  return (
    <div id="data-section-category_standardization" className={`ax-card ax-module-card ax-card-prep ${compact ? 'ax-tool-embedded-card' : ''}`} style={{ marginBottom: compact ? 0 : 16 }}>
      {!compact && (
        <div className="ax-module-head" style={{ marginBottom: 10 }}>
          <div className="ax-module-head-main">
            <div className="ax-module-copy">
              <p className="ax-module-title">
                Category standardization
                <HelpButton title="Category standardization" text="Use this card to combine labels that mean the same thing, such as yes, Yes, and 1." />
              </p>
              <p className="ax-module-subtitle">
                {visibleSuggestions.length} column{visibleSuggestions.length === 1 ? '' : 's'} with categorical labels.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Column selector */}
      {compact ? (
        <div className="ax-tool-pill-tabs pop-section pop-head" role="tablist">
          {visibleSuggestions.map((s) => (
            <button key={s.column} type="button" className={`ax-tool-pill-tab ${s.column === selectedColumn ? 'active' : ''}`} onClick={() => setSelectedColumn(s.column)}>
              {s.column}
              {hasDetectedGroups && <span>{s.groups.length}</span>}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px 10px', alignItems: 'center', marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Column</label>
          <select value={selectedColumn} onChange={(e) => setSelectedColumn(e.target.value)}>
            {visibleSuggestions.map((s) => (
              <option key={s.column} value={s.column}>{s.column} {s.groups.length ? `(${s.groups.length} group${s.groups.length === 1 ? '' : 's'})` : '(manual)'}</option>
            ))}
          </select>
        </div>
      )}

      {/* Navigation (non-compact) */}
      {!compact && (
        <div className="ax-card" style={{ padding: 10, marginBottom: 10, background: 'var(--color-background-primary)' }}>
          <div className="ax-row" style={{ gap: 10 }}>
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>
                Column {selectedIndex + 1} of {visibleSuggestions.length}: {selectedColumn}
              </p>
              {upcomingColumns.length > 0 && (
                <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '3px 0 0' }}>Upcoming: {upcomingColumns.join(', ')}</p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button className="ax-btn" onClick={() => goToIndex(selectedIndex - 1)} disabled={selectedIndex <= 0 || busy}>Previous</button>
              <button className="ax-btn" onClick={() => goToIndex(selectedIndex + 1)} disabled={selectedIndex >= visibleSuggestions.length - 1 || busy}>Next</button>
              <button className="ax-btn" onClick={skipCurrent} disabled={busy}>Skip</button>
            </div>
          </div>
        </div>
      )}

      {/* Mode toggle when detected groups exist */}
      {hasDetectedGroups && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '0 2px' }}>
          <button
            type="button"
            onClick={() => setEditMode('detected')}
            style={{ fontSize: 11, fontWeight: editMode === 'detected' ? 700 : 500, color: editMode === 'detected' ? ORANGE : 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: editMode === 'detected' ? 'underline' : 'none' }}
          >
            Detected issues
          </button>
          <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
          <button
            type="button"
            onClick={() => setEditMode('manual')}
            style={{ fontSize: 11, fontWeight: editMode === 'manual' ? 700 : 500, color: editMode === 'manual' ? ORANGE : 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: editMode === 'manual' ? 'underline' : 'none' }}
          >
            Edit all labels manually →
          </button>
        </div>
      )}

      {/* MODE 1: Detected groups */}
      {editMode === 'detected' && hasDetectedGroups && current && (
        <DetectedMode
          groups={groups}
          uniqueValues={uniqueValues}
          selectedColumn={selectedColumn}
          setGroup={setGroup}
          deleteGroup={deleteGroup}
          addGroup={addGroup}
          editingGroups={editingGroups}
          setEditingGroups={setEditingGroups}
          showRecommendations={showRecommendations}
          aiLoading={aiLoading}
          aiSuggestion={aiSuggestion}
          askAiForRecommendation={askAiForRecommendation}
          apply={applyDetected}
          skipCurrent={skipCurrent}
          busy={busy}
          compact={compact}
        />
      )}

      {/* MODE 2: Manual edit (always when no detected groups, or when toggled) */}
      {(editMode === 'manual' || !hasDetectedGroups) && (
        <ManualEditor
          dataset={dataset}
          columnStats={columnStats}
          selectedColumn={selectedColumn}
          setSelectedColumn={setSelectedColumn}
          manualEdits={currentManualEdits}
          setManualEdit={setManualEdit}
          mergeWarnings={mergeWarnings}
          hasChanges={hasManualChanges}
          onApply={applyManual}
          onReset={resetManualEdits}
          busy={busy}
          compact={compact}
        />
      )}
    </div>
  )
}

// ─── MODE 1: Detected issues ───
function DetectedMode({ groups, uniqueValues, selectedColumn, setGroup, deleteGroup, addGroup, editingGroups, setEditingGroups, showRecommendations, aiLoading, aiSuggestion, askAiForRecommendation, apply, skipCurrent, busy, compact }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {showRecommendations && (
        <div className="pop-section rec-banner" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="ax-tool-section-head">
            <div className="ax-tool-section-title-row">
              <p className="ax-tool-section-title">Recommended label groups</p>
              <HelpButton title="Recommendation help" text="SimuCast grouped labels using exact values, case/spacing similarities, and common binary/value patterns. You can still edit labels or uncheck values before applying." />
            </div>
            <button className="ax-btn ax-ai-explain-btn mini" type="button" onClick={askAiForRecommendation} disabled={aiLoading}>
              {aiLoading ? <InlineSpinner label="Asking..." /> : <><SparkleIcon size={11} /> AI explain</>}
            </button>
          </div>
          {aiSuggestion && (
            <div style={{ padding: '8px 10px', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 8, background: aiSuggestion.ok ? 'var(--color-background-info)' : 'var(--color-background-secondary)', fontSize: 11, color: 'var(--color-text-secondary)' }}>
              {aiSuggestion.text}
            </div>
          )}
          <div className="ax-card ax-tool-values-card" style={{ padding: 10, background: 'var(--color-background-primary)' }}>
            <p style={{ fontSize: 11, fontWeight: 500, margin: '0 0 6px' }}>Unique values detected</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {uniqueValues.map((item) => (
                <span key={item.value} className="ax-chip">{item.value} <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 3 }}>({item.count})</span></span>
              ))}
            </div>
          </div>
        </div>
      )}

      {groups.map((group, index) => (
        <div key={index} className="ax-card ax-label-map-row pop-section pop-controls" style={{ padding: 12, background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)' }}>
          {compact && !editingGroups[`${selectedColumn}:${index}`] ? (
            <>
              <div className="ax-label-map-summary">
                <strong>{group.suggested_label || `Group ${index + 1}`}</strong>
                <span aria-hidden="true">←</span>
                <span>{Object.entries(group.selected || {}).filter(([, s]) => s).map(([v]) => v).join(', ') || 'No values selected'}</span>
                <button className="ax-text-action" type="button" onClick={() => setEditingGroups((c) => ({ ...c, [`${selectedColumn}:${index}`]: true }))}>edit</button>
              </div>
              {showRecommendations && <p className="ax-label-map-reason">{group.reason}</p>}
            </>
          ) : (
            <>
              <div className="ax-row" style={{ marginBottom: 8 }}>
                <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{compact ? 'Edit group' : `Group ${index + 1}`}</p>
                <button className="ax-text-action danger" onClick={() => deleteGroup(index)} disabled={busy} type="button">Delete group</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '8px 10px', alignItems: 'center' }}>
                <label style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Final label</label>
                <input value={group.suggested_label || ''} onChange={(e) => setGroup(index, { suggested_label: e.target.value })} />
              </div>
              {showRecommendations && <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '8px 0 4px' }}>{group.reason}</p>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {uniqueValues.map((item) => (
                  <label key={item.value} className="ax-chip" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!group.selected?.[item.value]} onChange={(e) => setGroup(index, { selected: { ...(group.selected || {}), [item.value]: e.target.checked } })} />
                    <span style={{ marginLeft: 4 }}>{item.value}</span>
                    <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 3 }}>({item.count})</span>
                  </label>
                ))}
              </div>
              {compact && (
                <button className="ax-text-action" type="button" onClick={() => setEditingGroups((c) => ({ ...c, [`${selectedColumn}:${index}`]: false }))}>Done editing</button>
              )}
            </>
          )}
        </div>
      ))}

      <div className="ax-row pop-section pop-apply">
        <button className={compact ? 'ax-text-action' : 'ax-btn'} onClick={addGroup} disabled={busy}>Add group</button>
        {compact && <button className="ax-text-action" onClick={skipCurrent} disabled={busy} type="button">Skip this column</button>}
        <button className="ax-btn prim papply" onClick={apply} disabled={busy || !groups.length}>{busy ? 'Applying...' : 'Apply and go next'}</button>
      </div>
    </div>
  )
}

// ─── MODE 2: Manual edit ───
function ManualEditor({ dataset, columnStats, selectedColumn, setSelectedColumn, manualEdits, setManualEdit, mergeWarnings, hasChanges, onApply, onReset, busy, compact }) {
  const [allColumns, setAllColumns] = useState([])

  useEffect(() => {
    if (!dataset?.id) return
    const vars = dataset.variables || []
    const catVars = vars.filter((v) => ['category', 'text', 'binary', 'boolean'].includes(v.dtype))
    setAllColumns(catVars)
    if (catVars.length > 0 && !catVars.find((v) => v.name === selectedColumn)) {
      setSelectedColumn(catVars[0].name)
    }
  }, [dataset?.id])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Column pill tabs */}
      <div className="ax-tool-pill-tabs" role="tablist" style={{ flexWrap: 'wrap' }}>
        {allColumns.map((v) => (
          <button key={v.name} type="button" className={`ax-tool-pill-tab ${v.name === selectedColumn ? 'active' : ''}`} onClick={() => setSelectedColumn(v.name)}>
            {v.name}
          </button>
        ))}
      </div>

      {/* Editable rows */}
      {columnStats.length > 0 && (
        <div className="ax-card" style={{ padding: 12, background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 24px 1fr auto', gap: '0 8px', alignItems: 'center', marginBottom: 8, padding: '0 4px' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current value</span>
            <span />
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>New label</span>
            <span />
          </div>

          {/* Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {columnStats.map((item) => {
              const newLabel = manualEdits[item.value] || ''
              const isChanged = newLabel.trim() !== '' && newLabel.trim() !== item.value
              const warning = mergeWarnings[item.value]
              return (
                <div key={item.value}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 24px 1fr auto', gap: '0 8px', alignItems: 'center', padding: '4px', borderRadius: 6, background: isChanged ? '#fff7ed' : 'transparent' }}>
                    {/* Current value */}
                    <div style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', color: 'var(--color-text-secondary)', background: 'var(--color-background-secondary)', borderRadius: 4, padding: '4px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.value}
                    </div>
                    {/* Arrow */}
                    <span style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 12 }}>→</span>
                    {/* New label input */}
                    <input
                      value={newLabel || item.value}
                      onChange={(e) => setManualEdit(item.value, e.target.value)}
                      style={{
                        fontSize: 12, fontFamily: 'var(--font-mono, monospace)', padding: '4px 8px', borderRadius: 4,
                        border: `1.5px solid ${isChanged ? ORANGE : 'var(--color-border-tertiary)'}`,
                        background: '#fff', outline: 'none', transition: 'border-color 0.15s',
                      }}
                    />
                    {/* Row count */}
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', minWidth: 50, textAlign: 'right' }}>{item.count} rows</span>
                  </div>
                  {/* Merge warning */}
                  {warning && (
                    <div style={{ fontSize: 10, color: ORANGE, paddingLeft: 36, marginTop: 1 }}>{warning}</div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--color-border-tertiary)' }}>
            <button className="ax-btn prim" onClick={onApply} disabled={busy || !hasChanges} style={{ fontSize: 12 }}>
              {busy ? 'Applying...' : 'Apply labels'}
            </button>
            <button className="ax-text-action" onClick={onReset} disabled={busy} style={{ fontSize: 11 }}>Reset</button>
          </div>
        </div>
      )}
    </div>
  )
}
