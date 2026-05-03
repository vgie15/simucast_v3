import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import ColumnValuesModal from './ColumnValuesModal'
import AIAssistantPanel from './AIAssistantPanel'
import ManualTransformsCard from './ManualTransformsCard'
import DataGridViewer from './DataGridViewer'
import CategoryStandardizationCard from './CategoryStandardizationCard'
import { useDialog } from './DialogProvider'

export default function DataPage({ dataset, setDataset, viewStageRequest }) {
  const dialog = useDialog()
  const location = useLocation()
  const navigate = useNavigate()
  const openSection = location.state?.openSection
  const [viewStageId, setViewStageId] = useState('current')
  const [viewStageLabel, setViewStageLabel] = useState(null)
  const [activeVar, setActiveVar] = useState(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [suggestions, setSuggestions] = useState([])
  const [suggestionGroups, setSuggestionGroups] = useState({})
  const [statuses, setStatuses] = useState({})
  const [selectedActions, setSelectedActions] = useState({})
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [applyingAll, setApplyingAll] = useState(false)
  const [applyingGroup, setApplyingGroup] = useState(null)
  const [appliedFixSummary, setAppliedFixSummary] = useState([])

  useEffect(() => {
    if (!openSection) return
    navigate('.', { replace: true, state: {} })
    const timer = setTimeout(() => {
      const el = document.getElementById(`data-section-${openSection}`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.style.outline = '2px solid var(--color-accent)'
      el.style.outlineOffset = '3px'
      el.style.borderRadius = '8px'
      setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; el.style.borderRadius = '' }, 2000)
    }, 120)
    return () => clearTimeout(timer)
  }, [openSection])

  useEffect(() => {
    if (!dataset) return
    loadSuggestions()
  }, [dataset?.id])

  useEffect(() => {
    const raw = window.sessionStorage.getItem('simucast.fixTarget')
    if (!raw) return
    let target = null
    try {
      target = JSON.parse(raw)
    } catch {
      return
    }
    if (target?.page !== 'data') return
    window.sessionStorage.removeItem('simucast.fixTarget')
    setTimeout(() => highlightSection(target.section), 150)
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
      setSuggestionGroups(r.groups || {})
      setStatuses({})
      setSelectedActions(
        nextSuggestions.reduce((acc, suggestion) => {
          acc[suggestion.id] = suggestion.action
          return acc
        }, {}),
      )
    } catch (err) {
      console.error('Failed to load cleaning suggestions', err)
      setSuggestionGroups({})
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
      setAppliedFixSummary((current) => [
        { variable: suggestion.variable, kind: suggestion.kind, action, description: suggestion.description },
        ...current,
      ].slice(0, 8))
      setStatuses((current) => ({ ...current, [suggestion.id]: 'applied' }))
      await handleApplied()
    } catch (err) {
      await dialog.alert({ title: 'Apply Failed', message: err.message, variant: 'danger' })
    }
  }

  const applyAllSuggestions = async () => {
    const todo = suggestions.filter((s) => !statuses[s.id])
    if (!todo.length || applyingAll) return
    const ok = await dialog.confirm({
      title: 'Apply Suggested Fixes',
      message: `Apply ${todo.length} suggested fix${todo.length === 1 ? '' : 'es'} using the selected methods?`,
      details: 'Each applied fix creates a documented data stage so it can be reviewed in the documentation panel.',
      affectedItems: todo.map((s) => `${s.variable}: ${cleanActionLabel(selectedActions[s.id] || s.action)}`).slice(0, 8),
      cancelLabel: 'Cancel',
      confirmLabel: 'Apply Fixes',
    })
    if (!ok) return
    setApplyingAll(true)
    try {
      const applied = {}
      const appliedList = []
      for (const suggestion of todo) {
        const action = selectedActions[suggestion.id] || suggestion.action
        await api.cleanApply(dataset.id, { action, variable: suggestion.variable })
        appliedList.push({ variable: suggestion.variable, kind: suggestion.kind, action, description: suggestion.description })
        applied[suggestion.id] = 'applied'
      }
      setAppliedFixSummary((current) => [...appliedList.reverse(), ...current].slice(0, 8))
      setStatuses((current) => ({ ...current, ...applied }))
      await handleApplied()
    } catch (err) {
      await dialog.alert({ title: 'Apply All Failed', message: err.message, variant: 'danger' })
      await refreshDataset()
      await loadSuggestions()
    } finally {
      setApplyingAll(false)
    }
  }

  const handleSheetChange = async (sheetName) => {
    if (!sheetName || sheetName === dataset.active_sheet) return
    const ok = await dialog.confirm({
      title: 'Switch Sheet',
      message: `Use "${sheetName}" as the active sheet?`,
      details: 'The data preview and derived metadata will reload. Current stages, models, scenarios, and documentation may no longer match the newly selected sheet.',
      affectedItems: ['Data preview', 'Column types', 'Suggested fixes', 'Current stage selection'],
      confirmLabel: 'Switch Sheet',
      cancelLabel: 'Cancel',
    })
    if (!ok) return
    try {
      const fresh = await api.selectSheet(dataset.id, sheetName)
      setViewStageId('current')
      setViewStageLabel(null)
      setDataset?.(fresh)
      setHistoryKey((k) => k + 1)
      await loadSuggestions()
    } catch (err) {
      await dialog.alert({ title: 'Could Not Switch Sheet', message: err.message, variant: 'danger' })
    }
  }

  const applyGroupFix = async ({ kind, action, columns, overrides, options }) => {
    if (applyingGroup) return
    setApplyingGroup(kind)
    try {
      const r = await api.cleanApplyGroup(dataset.id, { kind, action, columns, overrides, options })
      setAppliedFixSummary((current) => [
        { variable: columns.join(', '), kind, action, description: r.summary },
        ...current,
      ].slice(0, 8))
      await handleApplied()
    } catch (err) {
      await dialog.alert({ title: 'Apply Group Failed', message: err.message, variant: 'danger' })
    } finally {
      setApplyingGroup(null)
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

      {(dataset.sheets || []).length > 1 && (
        <div className="ax-card" style={{ marginBottom: 16 }}>
          <div className="ax-row" style={{ alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Workbook sheet</p>
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>
                Select which Excel sheet powers the active dataset.
              </p>
            </div>
            <select
              value={dataset.active_sheet || ''}
              onChange={(e) => handleSheetChange(e.target.value)}
              style={{ minWidth: 240 }}
            >
              {(dataset.sheets || []).map((sheet) => (
                <option key={sheet.name} value={sheet.name}>
                  {sheet.name} ({sheet.row_count} rows, {sheet.col_count} cols{sheet.empty ? ', empty' : ''})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

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
              Export cleaned CSV
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

      <AIAssistantPanel key={historyKey} datasetId={dataset.id} context="data" />

      <div id="data-section-manual_transforms">
        <ManualTransformsCard key={historyKey} dataset={dataset} onApplied={handleApplied} />
      </div>

      <div id="data-section-category_standardization">
        <CategoryStandardizationCard key={historyKey} dataset={dataset} onApplied={handleApplied} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
        <StatCard label="Missing" value={missing} />
        <StatCard label="Outliers" value={outliers} />
        <StatCard label="Duplicates" value={suggestionGroups.duplicates?.count || 0} />
      </div>

      <div id="fix-cleaning-suggestions" className="ax-row" style={{ marginBottom: 8 }}>
        <p className="ax-lbl" style={{ margin: 0 }}>Suggested fixes by issue type</p>
        {suggestions.length > 0 && (
          <button className="ax-btn prim" onClick={applyAllSuggestions} disabled={applyingAll || suggestionsLoading}>
            {applyingAll ? 'Applying...' : 'Apply all'}
          </button>
        )}
      </div>
      {suggestionsLoading ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 0 }}>Analyzing...</p>
      ) : suggestions.length === 0 && !(suggestionGroups.duplicates?.count > 0) ? (
        <div className="ax-card" style={{ padding: '10px 12px', marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>No suggested fixes are pending. Your data looks clean.</p>
          {appliedFixSummary.length > 0 && (
            <div style={{ borderTop: '0.5px solid var(--color-border-tertiary)', marginTop: 10, paddingTop: 10 }}>
              <p style={{ fontSize: 12, fontWeight: 500, margin: '0 0 6px' }}>Recently applied fixes</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {appliedFixSummary.map((item, idx) => (
                  <div key={`${item.variable}-${item.action}-${idx}`} style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                    <KindBadge kind={item.kind} /> <strong style={{ color: 'var(--color-text-primary)', marginLeft: 4 }}>{item.variable}</strong>
                    <span> - {cleanActionLabel(item.action)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          <CleanGroupCard
            group={suggestionGroups.missing}
            kind="missing"
            title="Missing values"
            description="Fill or drop blank values across selected columns in one documented step."
            applying={applyingGroup === 'missing'}
            onApply={applyGroupFix}
          />
          <CleanGroupCard
            group={suggestionGroups.outliers}
            kind="outliers"
            title="Outliers"
            description="Cap or remove extreme numeric values across selected columns."
            applying={applyingGroup === 'outliers'}
            onApply={applyGroupFix}
          />
          <CleanGroupCard
            group={suggestionGroups.duplicates}
            kind="duplicates"
            title="Duplicates"
            description="Detect exact duplicate rows and remove them as one cleanup step."
            applying={applyingGroup === 'duplicates'}
            onApply={applyGroupFix}
          />
          {types > 0 && (
            <CleanGroupCard
              group={suggestionGroups.type}
              kind="type"
              title="Type issues"
              description="Convert text-like dates together when the detected fix is safe."
              applying={applyingGroup === 'type'}
              onApply={applyGroupFix}
            />
          )}
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

function CleanGroupCard({ group, kind, title, description, applying, onApply }) {
  const items = group?.columns || []
  const [selected, setSelected] = useState(() => items.map((item) => item.variable).filter(Boolean))
  const [action, setAction] = useState(group?.default_action || defaultGroupAction(kind))
  const [keep, setKeep] = useState(group?.default_keep || 'first')
  const [advanced, setAdvanced] = useState(false)
  const [overrides, setOverrides] = useState({})

  useEffect(() => {
    setSelected(items.map((item) => item.variable).filter(Boolean))
    setAction(group?.default_action || defaultGroupAction(kind))
    setKeep(group?.default_keep || 'first')
    setOverrides({})
    setAdvanced(false)
  }, [kind, JSON.stringify(items), group?.default_action, group?.default_keep])

  const duplicateCount = group?.count || 0
  const hasWork = kind === 'duplicates' ? duplicateCount > 0 : items.length > 0
  if (!hasWork) {
    return (
      <div className="ax-card" style={{ padding: '12px 14px', opacity: 0.72 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <KindBadge kind={kind} />
          <strong style={{ fontSize: 13 }}>{title}</strong>
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '6px 0 0' }}>
          No {title.toLowerCase()} detected.
        </p>
      </div>
    )
  }

  const options = kind === 'duplicates'
    ? []
    : Array.from(new Map(items.flatMap((item) => item.options || []).map((opt) => [opt.action, opt])).values())
  const columns = kind === 'duplicates' ? (group?.columns || []) : selected

  return (
    <div className="ax-card" style={{ padding: 14 }}>
      <div className="ax-row" style={{ alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <KindBadge kind={kind} />
            <strong style={{ fontSize: 14 }}>{title}</strong>
            <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
              {kind === 'duplicates' ? `${duplicateCount} duplicate rows` : `${items.length} affected column${items.length === 1 ? '' : 's'}`}
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '6px 0 0' }}>{description}</p>
        </div>
        <button
          className="ax-btn prim"
          disabled={applying || (kind !== 'duplicates' && selected.length === 0)}
          onClick={() => onApply({ kind, action, columns, overrides, options: { keep } })}
          type="button"
        >
          {applying ? 'Applying...' : kind === 'duplicates' ? 'Remove duplicates' : 'Apply group'}
        </button>
      </div>

      {kind === 'duplicates' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, alignItems: 'center', marginTop: 12, fontSize: 12 }}>
          <label style={{ color: 'var(--color-text-secondary)' }}>Keep occurrence</label>
          <select value={keep} onChange={(e) => setKeep(e.target.value)}>
            <option value="first">First row</option>
            <option value="last">Last row</option>
          </select>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, alignItems: 'center', marginTop: 12, fontSize: 12 }}>
            <label style={{ color: 'var(--color-text-secondary)' }}>Group method</label>
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              {options.map((opt) => (
                <option key={opt.action} value={opt.action}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {items.map((item) => (
              <label key={item.variable} className="ax-chip" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.variable)}
                  onChange={(e) => {
                    setSelected((current) => e.target.checked
                      ? [...current, item.variable]
                      : current.filter((name) => name !== item.variable))
                  }}
                />
                <span>{item.variable}</span>
                <span style={{ color: 'var(--color-text-tertiary)' }}>{item.count || 0}</span>
              </label>
            ))}
          </div>

          <button className="ax-btn" style={{ marginTop: 10 }} onClick={() => setAdvanced(!advanced)} type="button">
            {advanced ? 'Hide advanced overrides' : 'Advanced per-column overrides'}
          </button>
          {advanced && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {items.filter((item) => selected.includes(item.variable)).map((item) => (
                <div key={item.variable} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) minmax(180px, 260px)', gap: 10, alignItems: 'center', fontSize: 12 }}>
                  <span>{item.variable}</span>
                  <select
                    value={overrides[item.variable] || action}
                    onChange={(e) => setOverrides((current) => ({ ...current, [item.variable]: e.target.value }))}
                  >
                    {(item.options || options).map((opt) => (
                      <option key={opt.action} value={opt.action}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
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
    duplicates: { bg: '#FFF7ED', fg: '#C2410C', label: 'Duplicates' },
    expand: { bg: '#EEEDFE', fg: '#3C3489', label: 'Expand' },
  }
  const c = map[kind] || map.missing
  return (
    <span style={{ fontSize: 10, padding: '1px 6px', background: c.bg, color: c.fg, borderRadius: 4 }}>
      {c.label}
    </span>
  )
}

function cleanActionLabel(action) {
  return String(action || 'applied').replace(/_/g, ' ')
}

function defaultGroupAction(kind) {
  if (kind === 'outliers') return 'winsorize'
  if (kind === 'type') return 'convert_date'
  if (kind === 'duplicates') return 'drop_duplicates'
  return 'impute_mean'
}

function highlightSection(section) {
  const el = document.getElementById(section)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ax-fix-highlight')
  window.setTimeout(() => el.classList.remove('ax-fix-highlight'), 2600)
}
