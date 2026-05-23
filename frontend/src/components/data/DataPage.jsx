/* ============================================================
 * PAGE: DATA VIEW (UPLOAD, GRID, EDIT)
 * Keywords: data view, upload, grid, edit cell, variable view, columns
 * ============================================================ */
import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../../api'
import ColumnValuesModal from './ColumnValuesModal'
import ManualTransformsCard from './ManualTransformsCard'
import DataDetailView from './DataDetailView'
import CategoryStandardizationCard from './CategoryStandardizationCard'
import { useDialog } from '../common/DialogProvider'
import { BusyOverlay, InlineSpinner, SkeletonCards } from '../common/LoadingStates'
import HelpButton from '../common/HelpButton'
import PageGuide from '../common/PageGuide'
import { SparkleIcon } from '../ai/AIExplainers'
import { useAuth } from '../providers/AuthProvider'

// Page component for uploading, editing, cleaning, and exploring the active dataset.
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
  const [showChangePreview, setShowChangePreview] = useState(true)
  const [dataChangePulse, setDataChangePulse] = useState(false)
  const [tableViewMode, setTableViewMode] = useState('cleaned')

  useEffect(() => {
    if (!openSection) return
    navigate('.', { replace: true, state: {} })
    const timer = setTimeout(() => {
      const el = document.getElementById(`data-section-${openSection}`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
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
      setTableViewMode('cleaned')
      return
    }
    setViewStageId(stageId)
    setViewStageLabel(stageId === 'original' ? 'Original upload' : `Stage ${stageId}`)
    setTableViewMode(stageId === 'original' ? 'original' : 'cleaned')
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
    setShowChangePreview(true)
    setDataChangePulse(true)
    setTableViewMode('highlight')
    window.setTimeout(() => setDataChangePulse(false), 2200)
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
      setTableViewMode('cleaned')
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
      <PageGuide
        title="Start with a quick data check"
        meta="Data preparation"
        steps={['Inspect', 'Transform', 'Fix issues', 'Standardize']}
      >
        Review the table and column types first. Then use the suggested fix cards only for issues detected in the current stage.
      </PageGuide>

      {(dataset.sheets || []).length > 1 && (
        <div className="ax-card ax-module-card ax-card-data" style={{ marginBottom: 16 }}>
          <div className="ax-module-head ax-workbook-head">
            <div className="ax-module-head-main">
              <span className="ax-module-icon" aria-hidden>D</span>
              <div className="ax-module-copy">
                <p className="ax-module-title">
                Workbook sheet
                <HelpButton
                  title="Workbook sheet"
                  text="Use this card when an uploaded Excel file has multiple sheets. Switching sheets reloads the data preview, detected types, suggested fixes, and downstream project state."
                />
              </p>
                <p className="ax-module-subtitle">
                Select which Excel sheet powers the active dataset.
              </p>
              </div>
            </div>
          </div>
          <div className="ax-module-body-row">
            <select
              value={dataset.active_sheet || ''}
              onChange={(e) => handleSheetChange(e.target.value)}
              style={{ minWidth: 240, width: 'min(360px, 100%)' }}
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

      <div id="data-section-raw_data" className={dataChangePulse ? 'ax-data-stage-updated' : ''} style={{ marginBottom: 16 }}>
        <DataDetailView
          key={`${dataset.id}:${dataset.current_stage_id}:${historyKey}`}
          dataset={dataset}
          variables={dataset.variables || []}
          stageId={viewStageId === 'current' ? null : viewStageId}
          currentStageId={dataset.current_stage_id}
          stageLabel={viewStageLabel}
          refreshKey={historyKey}
          preferredViewMode={tableViewMode}
          onDataChanged={handleApplied}
        />
        {viewStageId !== 'current' && (
          <div style={{ marginTop: 8, textAlign: 'right' }}>
            <button
              className="ax-btn prim"
              onClick={() => {
                setViewStageId('current')
                setViewStageLabel(null)
                setTableViewMode('cleaned')
              }}
            >
              Show current stage
            </button>
          </div>
        )}
        {appliedFixSummary.length > 0 && viewStageId === 'current' && (
          <section className="ax-data-change-preview" aria-live="polite">
            <div>
              <strong>Current cleaned stage updated</strong>
              <span>Review the dataset preview and History before moving on.</span>
            </div>
            <button className="ax-link-btn" type="button" onClick={() => setShowChangePreview((value) => !value)}>
              {showChangePreview ? 'Hide recent changes' : 'Show recent changes'}
            </button>
            {showChangePreview && (
              <ul>
                {appliedFixSummary.slice(0, 4).map((item, idx) => (
                  <li key={`${item.variable}-${item.action}-${idx}`}>
                    <KindBadge kind={item.kind} />
                    <b>{item.variable}</b>
                    <span>{cleanActionLabel(item.action)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <div id="data-section-manual_transforms">
        <ManualTransformsCard key={historyKey} dataset={dataset} onApplied={handleApplied} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
        <StatCard label="Missing" value={missing} />
        <StatCard label="Outliers" value={outliers} />
        <StatCard label="Duplicates" value={suggestionGroups.duplicates?.count || 0} />
      </div>

      <div id="fix-cleaning-suggestions" className={`ax-section-anchor ax-busy-host ${applyingAll ? 'is-busy' : ''}`}>
        <BusyOverlay
          active={applyingAll}
          title="Applying all suggested fixes..."
          detail="Processing each issue group, creating dataset stages, and refreshing the data workspace."
          steps={['Applying grouped fixes', 'Refreshing dataset preview', 'Updating documentation']}
        />
        <div className="ax-row" style={{ marginBottom: 8 }}>
          <p className="ax-lbl" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            Suggested fixes by issue type
            <HelpButton
              title="Suggested fixes"
              text="This section groups data quality issues into missing values, outliers, duplicates, and type issues. Each card explains what columns are affected, what method is recommended, and why before applying a documented cleanup step."
            />
          </p>
          {suggestions.length > 0 && (
            <button className="ax-btn prim" onClick={applyAllSuggestions} disabled={applyingAll || suggestionsLoading}>
              {applyingAll ? <InlineSpinner label="Applying..." /> : 'Apply all'}
            </button>
          )}
        </div>
        {suggestionsLoading ? (
          <SkeletonCards count={3} />
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
              datasetId={dataset.id}
              stageId={dataset.current_stage_id}
              group={suggestionGroups.missing}
              kind="missing"
              title="Missing values"
              description="Fill or drop blank values across selected columns in one documented step."
              applying={applyingGroup === 'missing'}
              onApply={applyGroupFix}
            />
            <CleanGroupCard
              datasetId={dataset.id}
              stageId={dataset.current_stage_id}
              group={suggestionGroups.outliers}
              kind="outliers"
              title="Outliers"
              description="Cap or remove extreme numeric values across selected columns."
              applying={applyingGroup === 'outliers'}
              onApply={applyGroupFix}
            />
            <CleanGroupCard
              datasetId={dataset.id}
              stageId={dataset.current_stage_id}
              group={suggestionGroups.duplicates}
              kind="duplicates"
              title="Duplicates"
              description="Detect exact duplicate rows and remove them as one cleanup step."
              applying={applyingGroup === 'duplicates'}
              onApply={applyGroupFix}
            />
            {types > 0 && (
              <CleanGroupCard
                datasetId={dataset.id}
                stageId={dataset.current_stage_id}
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
      </div>

      <div id="data-section-category_standardization">
        <CategoryStandardizationCard key={historyKey} dataset={dataset} onApplied={handleApplied} />
      </div>

      <div id="data-section-feature_engineering">
        <FeatureEngineeringCard key={historyKey} dataset={dataset} onApplied={handleApplied} />
      </div>

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

// Card that previews and applies a grouped cleaning fix for missing/outliers/duplicates/types.
function CleanGroupCard({ datasetId, stageId, group, kind, title, description, applying, onApply }) {
  const auth = useAuth()
  const items = group?.columns || []
  const [selected, setSelected] = useState(() => items.map((item) => item.variable).filter(Boolean))
  const [action, setAction] = useState(() => recommendedGroupAction(kind, group, items).action)
  const [keep, setKeep] = useState(group?.default_keep || 'first')
  const [advanced, setAdvanced] = useState(false)
  const [overrides, setOverrides] = useState({})
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState(null)

  useEffect(() => {
    setSelected(items.map((item) => item.variable).filter(Boolean))
    setAction(recommendedGroupAction(kind, group, items).action)
    setKeep(group?.default_keep || 'first')
    setOverrides(defaultOverrides(kind, items, recommendedGroupAction(kind, group, items).action))
    setAdvanced(false)
    setAiSuggestion(null)
  }, [kind, stageId, JSON.stringify(items), group?.default_action, group?.default_keep])

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
  const recommendation = recommendedGroupAction(kind, group, items, action, keep)
  const selectedAll = kind !== 'duplicates' && items.length > 0 && selected.length === items.length
  const selectedItems = kind === 'duplicates' ? items : items.filter((item) => selected.includes(item.variable))

  const askAiForRecommendation = async () => {
    if (aiLoading || !datasetId) return
    if (auth.isGuest) {
      auth.requireAccountForAI()
      return
    }
    setAiLoading(true)
    setAiSuggestion(null)
    try {
      const payload = buildCleaningAiPayload(kind, group, items, selectedItems, recommendation, overrides, keep)
      const res = await api.aiExplain(
        datasetId,
        `data-cleaning-${kind}-recommendation:${stageId || 'current'}`,
        payload,
        'Give plain-text advice for this cleaning issue. Recommend among the available SimuCast methods only. Do not apply changes. Explain the safest option and mention any columns that need different handling.',
        payload,
      )
      setAiSuggestion({ ok: true, text: res.explanation || res.summary || 'AI suggestion unavailable.' })
    } catch {
      setAiSuggestion({ ok: false, text: 'AI suggestion unavailable.' })
    } finally {
      setAiLoading(false)
    }
  }

  const cardTargetId = `fix-cleaning-${kind}`
  const recommendationTargetId = `fix-cleaning-${kind}-recommendations`
  const applyTargetId = `fix-cleaning-${kind}-apply`

  return (
    <div id={cardTargetId} className={`ax-card ax-module-card ax-card-warning ax-busy-host ${applying ? 'is-busy' : ''}`} style={{ padding: 14 }}>
      <BusyOverlay
        active={applying}
        title={`Applying ${title.toLowerCase()} fix...`}
        detail="Updating the active dataset, creating a stage, and logging the step."
      />
      <div className="ax-module-head ax-clean-group-head" style={{ alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <KindBadge kind={kind} />
            <strong style={{ fontSize: 14 }}>{title}</strong>
            <HelpButton title={`${title}: what this card does`} text={helpTextForCleanCard(kind)} />
            <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
              {kind === 'duplicates' ? `${duplicateCount} duplicate rows` : `${items.length} affected column${items.length === 1 ? '' : 's'}`}
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '6px 0 0' }}>{description}</p>
        </div>
        <button
          id={applyTargetId}
          className="ax-btn prim"
          disabled={applying || (kind !== 'duplicates' && selected.length === 0)}
          onClick={() => onApply({ kind, action, columns, overrides, options: { keep } })}
          type="button"
        >
          {applying ? <InlineSpinner label="Applying..." /> : kind === 'duplicates' ? 'Remove duplicates' : 'Apply group'}
        </button>
      </div>

      {kind === 'duplicates' ? (
        <>
          <DuplicateRecommendation
            group={group}
            loading={aiLoading}
            suggestion={aiSuggestion}
            onAsk={askAiForRecommendation}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="ax-btn mini" type="button" disabled>
              All duplicate rows selected
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, alignItems: 'center', marginTop: 12, fontSize: 12 }}>
            <label style={{ color: 'var(--color-text-secondary)' }}>Keep occurrence</label>
            <select value={keep} onChange={(e) => setKeep(e.target.value)}>
              <option value="first">First row</option>
              <option value="last">Last row</option>
            </select>
          </div>
        </>
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
          <div id={recommendationTargetId}>
            <GroupedColumnRecommendations
              kind={kind}
              items={items}
              selected={selected}
              aiLoading={aiLoading}
              aiSuggestion={aiSuggestion}
              onAskAi={askAiForRecommendation}
            />
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <button
              className="ax-btn mini"
              type="button"
              onClick={() => setSelected(selectedAll ? [] : items.map((item) => item.variable).filter(Boolean))}
            >
              {selectedAll ? 'Clear columns' : 'Select all columns'}
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
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
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
                Override only the columns that need a different method from the grouped recommendation.
              </p>
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

// Small tile displaying a labeled statistic with a contextual help tooltip.
function StatCard({ label, value }) {
  const help = {
    Missing: 'Shows how many columns currently have blank or missing values that may need imputation, dropping, or review.',
    Outliers: 'Shows how many numeric columns currently contain extreme values that may distort summaries, tests, and models.',
    Duplicates: 'Shows the number of exact duplicate rows detected in the active dataset stage.',
  }
  return (
    <div style={{ background: 'var(--color-background-primary)', borderRadius: 6, padding: 12, border: '0.5px solid var(--color-border-tertiary)' }}>
      <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
        {label}
        <HelpButton title={`${label} count`} text={help[label]} size={16} />
      </p>
      <p style={{ fontSize: 22, fontWeight: 500, margin: '4px 0 0' }}>{value}</p>
    </div>
  )
}

// Collapsible block that triggers an AI explainer and renders the returned advice.
function AiRecommendationBlock({ loading, suggestion, onAsk }) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (suggestion) setCollapsed(false)
  }, [suggestion?.text])

  return (
    <div style={{ marginTop: suggestion ? 8 : 0 }}>
      {onAsk && (
        <button className="ax-btn ax-ai-explain-btn mini" type="button" onClick={onAsk} disabled={loading}>
          {loading ? <InlineSpinner label="Asking..." /> : <><SparkleIcon size={11} /> AI explain</>}
        </button>
      )}
      {suggestion && (
        <div style={{
          marginTop: onAsk ? 10 : 0,
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
              <span style={{ color: suggestion.ok ? 'var(--color-text-info)' : 'var(--color-text-secondary)', fontWeight: 750 }}>
                AI suggestion
              </span>
              <span style={{ color: 'var(--color-text-tertiary)' }}>
                advisory only
              </span>
            </div>
            <button className="ax-btn mini" type="button" onClick={() => setCollapsed((v) => !v)}>
              {collapsed ? 'Show' : 'Hide'}
            </button>
          </div>
          {!collapsed && (
            <div style={{
              overflowY: 'auto',
              paddingRight: 4,
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.55,
            }}>
              {suggestion.text}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Builds the AI explain payload describing the cleaning issue, options, and current selection.
function buildCleaningAiPayload(kind, group, items = [], selectedItems = [], recommendation, overrides = {}, keep = 'first') {
  const compactItem = (item) => {
    const rec = recommendedColumnAction(kind, item)
    return {
      column: item.variable,
      missing_or_issue_count: item.count || 0,
      system_recommended_action: rec.label,
      system_reason: rec.why,
      available_methods: (item.options || []).map((opt) => opt.label || cleanActionLabel(opt.action)),
      selected_override: overrides[item.variable] ? cleanActionLabel(overrides[item.variable]) : null,
      raw_recommendation: {
        action: item.recommended_action || item.action,
        reason: item.recommended_reason || item.description || '',
      },
    }
  }
  return {
    issue_type: kind,
    active_stage_id: group?.stage_id || null,
    affected_count: kind === 'duplicates' ? group?.count || 0 : items.length,
    selected_columns: selectedItems.map((item) => item.variable),
    system_group_recommendation: recommendation,
    duplicate_keep_rule: kind === 'duplicates' ? keep : undefined,
    affected_columns: items.map(compactItem),
    available_group_methods: kind === 'duplicates'
      ? ['Remove duplicates, keep first occurrence', 'Remove duplicates, keep last occurrence']
      : Array.from(new Set(items.flatMap((item) => (item.options || []).map((opt) => opt.label || cleanActionLabel(opt.action))))),
  }
}

// Returns the help-tooltip copy describing how to use a given cleaning card.
function helpTextForCleanCard(kind) {
  const help = {
    missing: 'Use this card to fill or remove blank values. SimuCast recommends safer methods per column type, then lets you apply one grouped cleanup step or override columns individually.',
    outliers: 'Use this card to review extreme numeric values. Capping keeps rows while limiting distortion; removing rows is reserved for clearly invalid cases.',
    duplicates: 'Use this card to remove exact duplicate rows. Keeping the first occurrence is usually safest because it preserves one valid copy of each repeated record.',
    type: 'Use this card to fix detected type issues, such as text-like dates or numeric-looking values. Correct types make summaries, tests, models, and reports more reliable.',
  }
  return help[kind] || 'Use this card to review and apply a recommended data preparation step.'
}

// Small colored badge labeling the cleaning issue kind (missing/outliers/type/duplicates/expand).
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

// Returns a human-readable label for a cleaning action identifier.
function cleanActionLabel(action) {
  return String(action || 'applied').replace(/_/g, ' ')
}

// Returns the default grouped cleaning action identifier for the given issue kind.
function defaultGroupAction(kind) {
  if (kind === 'outliers') return 'winsorize'
  if (kind === 'type') return 'convert_date'
  if (kind === 'duplicates') return 'drop_duplicates'
  return 'impute_mean'
}

// Returns true if any item exposes the given cleaning action as an option.
function optionExists(items, action) {
  return items.some((item) => (item.options || []).some((opt) => opt.action === action))
}

// Computes the recommended grouped action plus a label and rationale for the cleaning kind.
function recommendedGroupAction(kind, group, items = [], currentAction, keep = 'first') {
  if (kind === 'duplicates') {
    return {
      action: 'drop_duplicates',
      label: 'Remove duplicates, keep first occurrence',
      why: `${group?.count || 0} exact duplicate row${group?.count === 1 ? '' : 's'} can be removed without changing unique records.`,
    }
  }
  if (kind === 'outliers') {
    return {
      action: 'winsorize',
      label: 'Cap to IQR bounds',
      why: 'Capping keeps rows in the dataset while limiting extreme values that can distort summaries and models.',
    }
  }
  if (kind === 'type') {
    return {
      action: 'convert_date',
      label: 'Convert to date',
      why: 'These columns look date-like, so parsing them improves sorting, filtering, and reporting.',
    }
  }
  if (kind === 'missing') {
    const totalMissing = items.reduce((sum, item) => sum + Number(item.count || 0), 0)
    const hasMedian = optionExists(items, 'impute_median')
    const action = hasMedian && currentAction === 'impute_median' ? 'impute_median' : 'impute_mean'
    const label = action === 'impute_median'
        ? 'Fill with median'
        : 'Fill numeric with mean, categorical with most common'
    const why = action === 'impute_median'
        ? 'Median is robust when values may be skewed or affected by outliers.'
        : 'This grouped default uses the average for numeric columns and automatically falls back to the mode for categorical columns.'
    return { action, label, why: `${why} ${totalMissing} blank value${totalMissing === 1 ? '' : 's'} detected across the selected columns.` }
  }
  return {
    action: defaultGroupAction(kind),
    label: cleanActionLabel(defaultGroupAction(kind)),
    why: 'This is the safest available grouped action for the detected issue.',
  }
}

// Renders per-method recommendation panels listing the columns each fix applies to.
function GroupedColumnRecommendations({ kind, items = [], selected = [], aiLoading, aiSuggestion, onAskAi }) {
  if (!items.length || kind === 'duplicates') return null
  const selectedSet = new Set(selected)
  const groups = groupColumnRecommendations(kind, items)
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)', margin: 0 }}>
            Recommended actions by method
          </p>
          <span style={{ fontSize: 12, color: 'var(--color-accent)', fontWeight: 800 }}>System recommended</span>
          <InfoDot text="System recommended means SimuCast selected this method using the current dataset profile, column type, missing count, skew, and outlier checks. You can still change it manually." />
        </div>
        <button className="ax-btn ax-ai-explain-btn mini" type="button" onClick={onAskAi} disabled={aiLoading}>
          {aiLoading ? <InlineSpinner label="Asking..." /> : <><SparkleIcon size={11} /> AI explain</>}
        </button>
      </div>
      {groups.map((group) => {
        const selectedCount = group.items.filter((item) => selectedSet.has(item.variable)).length
        return (
          <div
            key={group.action}
            style={{
              padding: '10px 12px',
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 10,
              background: 'var(--color-background-primary)',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <span className="ax-chip" style={{ color: 'var(--color-accent)', background: 'var(--color-background-primary)' }}>System recommended</span>
              <strong>{group.label}</strong>
              <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>
                {selectedCount}/{group.items.length} selected
              </span>
            </div>
            <p style={{ margin: '0 0 8px', color: 'var(--color-text-secondary)' }}>{group.why}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {group.items.map((item) => (
                <span
                  key={item.variable}
                  className="ax-chip"
                  style={{
                    background: selectedSet.has(item.variable) ? '#fff' : 'var(--color-background-secondary)',
                    color: selectedSet.has(item.variable) ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                    borderColor: selectedSet.has(item.variable) ? 'rgba(249, 115, 22, 0.35)' : 'transparent',
                  }}
                  title={recommendedColumnAction(kind, item).why}
                >
                  {item.variable}
                  <span style={{ color: 'var(--color-text-tertiary)' }}>{item.count || 0}</span>
                </span>
              ))}
            </div>
          </div>
        )
      })}
      <AiRecommendationBlock loading={aiLoading} suggestion={aiSuggestion} />
    </div>
  )
}

// Groups columns by their per-column recommended action and attaches a summary rationale.
function groupColumnRecommendations(kind, items = []) {
  const grouped = new Map()
  items.forEach((item) => {
    const rec = recommendedColumnAction(kind, item)
    const key = rec.action || rec.label
    if (!grouped.has(key)) {
      grouped.set(key, {
        action: key,
        label: rec.label,
        why: summarizeRecommendationReason(kind, rec, item),
        items: [],
      })
    }
    grouped.get(key).items.push(item)
  })
  return Array.from(grouped.values()).map((group) => ({
    ...group,
    why: summarizeRecommendationGroup(kind, group),
  }))
}

// Returns a one-sentence rationale for a recommended cleaning action and kind.
function summarizeRecommendationReason(kind, rec) {
  if (kind === 'missing') {
    if (rec.action === 'impute_median') return 'Median is safer for numeric columns with skew or outliers.'
    if (rec.action === 'impute_mode') return 'Mode is appropriate for categorical columns because there is no numeric average.'
    if (rec.action === 'impute_mean') return 'Mean is appropriate for numeric columns without strong skew or outlier concerns.'
  }
  if (kind === 'outliers') return 'Capping to IQR bounds reduces extreme-value distortion while keeping rows in the dataset.'
  if (kind === 'type') return 'Converting date-like text makes the column easier to sort, filter, and report.'
  return rec.why || 'This method matches the detected issue and available SimuCast fixes.'
}

// Returns a sentence summarizing why a group of columns shares the same recommended fix.
function summarizeRecommendationGroup(kind, group) {
  const names = group.items.map((item) => item.variable)
  const count = group.items.reduce((sum, item) => sum + Number(item.count || 0), 0)
  if (kind === 'missing') {
    if (group.action === 'impute_median') {
      return `${names.join(', ')} have ${count} blank value${count === 1 ? '' : 's'} and show skew/outlier risk, so median is safer than the mean.`
    }
    if (group.action === 'impute_mode') {
      return `${names.join(', ')} are categorical columns with ${count} blank value${count === 1 ? '' : 's'}, so the most common valid label is safer than a numeric fill.`
    }
    if (group.action === 'impute_mean') {
      return `${names.join(', ')} have ${count} blank value${count === 1 ? '' : 's'} and no strong skew/outlier warning, so the mean is a reasonable numeric fill.`
    }
  }
  if (kind === 'outliers') {
    return `${names.join(', ')} contain ${count} outlier value${count === 1 ? '' : 's'}; capping limits distortion while preserving rows for later analysis.`
  }
  return group.why
}

// Panel describing the recommended duplicate-row removal action with an AI explainer.
function DuplicateRecommendation({ group, loading, suggestion, onAsk }) {
  const count = group?.count || 0
  if (!count) return null
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)', margin: 0 }}>What to do</p>
          <span style={{ fontSize: 12, color: 'var(--color-accent)', fontWeight: 800 }}>System recommended</span>
          <InfoDot text="System recommended means SimuCast selected this action from the current duplicate scan. You can still choose which duplicate occurrence to keep." />
        </div>
        <button className="ax-btn ax-ai-explain-btn mini" type="button" onClick={onAsk} disabled={loading}>
          {loading ? <InlineSpinner label="Asking..." /> : <><SparkleIcon size={11} /> AI explain</>}
        </button>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(130px, 1fr) minmax(150px, 1fr) 2fr',
          gap: 8,
          padding: '7px 8px',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: 8,
          background: 'var(--color-background-primary)',
          fontSize: 11,
          alignItems: 'start',
        }}
      >
        <strong>{count} duplicate row{count === 1 ? '' : 's'}</strong>
        <span>Remove duplicates</span>
        <span style={{ color: 'var(--color-text-secondary)' }}>
          Keep the first occurrence so repeated rows do not inflate summaries, tests, or model training.
        </span>
      </div>
      <AiRecommendationBlock loading={loading} suggestion={suggestion} />
    </div>
  )
}

// Tiny help icon that opens a tooltip explaining a recommendation.
function InfoDot({ text }) {
  return <HelpButton title="Recommendation help" text={text} />
}

// Computes a per-column recommended cleaning action with label and rationale.
function recommendedColumnAction(kind, item) {
  const options = item.options || []
  const has = (action) => options.some((opt) => opt.action === action)
  const count = Number(item.count || 0)
  if (kind === 'missing') {
    const recommended = item.recommended_action || item.action
    if (has('impute_mode')) {
      return {
        action: 'impute_mode',
        label: 'Fill with most common value',
        why: `${count} blank value${count === 1 ? '' : 's'} in a categorical column should use the dominant label, not a numeric average.`,
      }
    }
    if (recommended === 'impute_median' && has('impute_median')) {
      return {
        action: 'impute_median',
        label: 'Fill with median',
        why: `${count} blank value${count === 1 ? '' : 's'} detected. ${item.recommended_reason || 'Median is safer when a numeric column is skewed or outlier-heavy.'}`,
      }
    }
    if (has('impute_median') && count > 0) {
      return {
        action: 'impute_mean',
        label: 'Fill with mean',
        why: `${count} blank value${count === 1 ? '' : 's'} detected. ${item.recommended_reason || 'Mean is the default for numeric columns that are not visibly skewed or outlier-heavy.'}`,
      }
    }
    return { action: 'drop_rows', label: 'Review/drop rows', why: 'Use this only when missingness is too high or blanks are not safely imputable.' }
  }
  if (kind === 'outliers') {
    return {
      action: 'winsorize',
      label: 'Cap to IQR bounds',
      why: `${count} outlier value${count === 1 ? '' : 's'} detected. Capping reduces distortion while keeping the row for analysis.`,
    }
  }
  if (kind === 'type') {
    return {
      action: 'convert_date',
      label: 'Convert detected type',
      why: 'The values look parseable as dates, so type conversion makes the column more usable.',
    }
  }
  return { action: item.action, label: cleanActionLabel(item.action), why: item.description || 'Recommended by the current dataset profile.' }
}

// Returns per-column override map for items whose recommended action differs from the group default.
function defaultOverrides(kind, items = [], groupAction) {
  if (kind !== 'missing') return {}
  return Object.fromEntries(
    items
      .filter((item) => item.recommended_action && item.recommended_action !== groupAction)
      .map((item) => [item.variable, item.recommended_action]),
  )
}

// Picks a numeric variable suitable for binning and returns a recommendation object.
function recommendBinning(numericVariables = []) {
  const candidates = numericVariables.filter((v) => {
    const name = String(v.name || '').toLowerCase()
    const unique = Number(v.unique || 0)
    return unique >= 8 && !name.includes('id') && !name.endsWith('_id')
  })
  const preferred = candidates.find((v) => /age|income|score|rate|gpa|hours|attendance|subject/.test(String(v.name || '').toLowerCase())) || candidates[0]
  if (!preferred) return null
  return {
    column: preferred.name,
    label: `Create 3 bins for ${preferred.name}`,
    why: 'Grouped low/medium/high ranges can make this numeric variable easier to compare in analysis and reports.',
  }
}

// Picks a float column likely to benefit from rounding and returns a formatting recommendation.
function recommendNumericFormatting(numericVariables = []) {
  const candidate = numericVariables.find((v) => {
    const name = String(v.name || '').toLowerCase()
    return v.dtype === 'float' && !name.includes('id') && !name.endsWith('_id')
  })
  if (!candidate) return null
  return {
    column: candidate.name,
    label: `Round ${candidate.name} to 2 decimals`,
    why: 'Use numeric formatting only when values show excessive or inconsistent decimal precision.',
  }
}

// Header row for a feature engineering recommendation with an AI explain button.
function FeatureRecommendationHeader({ title, info, loading, onAsk }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)', margin: 0 }}>{title}</p>
        <span style={{ fontSize: 12, color: 'var(--color-accent)', fontWeight: 800 }}>System recommended</span>
        <InfoDot text={info} />
      </div>
      <button
        className="ax-btn ax-ai-explain-btn mini"
        type="button"
        onClick={onAsk}
        disabled={loading}
      >
        {loading ? <InlineSpinner label="Asking..." /> : <><SparkleIcon size={11} /> AI explain</>}
      </button>
    </div>
  )
}

// Card highlighting a single system-recommended feature engineering action.
function FeatureRecommendationCard({ recommendation }) {
  if (!recommendation) return null
  return (
    <div style={{
      padding: '10px 12px',
      border: '0.5px solid var(--color-border-tertiary)',
      borderRadius: 10,
      background: 'var(--color-background-primary)',
      fontSize: 12,
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span className="ax-chip" style={{ color: 'var(--color-accent)', background: 'var(--color-background-primary)' }}>System recommended</span>
        <strong>{recommendation.label}</strong>
      </div>
      <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>{recommendation.why}</p>
    </div>
  )
}

// Card offering binning and numeric formatting tools for creating new feature columns.
function FeatureEngineeringCard({ dataset, onApplied }) {
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [tool, setTool] = useState('bins') // 'bins' | 'format'
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState(null)

  const variables = dataset?.variables || []
  const numericVariables = variables.filter((v) => ['numeric','int','float'].includes(v.dtype))
  const numVars = numericVariables.map((v) => v.name)

  // Bins state
  const [binCol, setBinCol] = useState('')
  const [binCount, setBinCount] = useState(3)
  const [binLabels, setBinLabels] = useState('')
  const [binNewName, setBinNewName] = useState('')

  // Format state
  const [fmtCol, setFmtCol] = useState('')
  const [fmtOp, setFmtOp] = useState('round')
  const [fmtParam, setFmtParam] = useState('2')
  const [fmtNewName, setFmtNewName] = useState('')
  const binRecommendation = recommendBinning(numericVariables)
  const formatRecommendation = recommendNumericFormatting(numericVariables)

  useEffect(() => {
    if (!binCol && binRecommendation?.column) {
      setBinCol(binRecommendation.column)
      setBinCount(3)
      setBinLabels('low, medium, high')
    }
  }, [binRecommendation?.column, binCol])

  useEffect(() => {
    if (!fmtCol && formatRecommendation?.column) {
      setFmtCol(formatRecommendation.column)
      setFmtParam('2')
    }
  }, [formatRecommendation?.column, fmtCol])

  useEffect(() => {
    setAiSuggestion(null)
  }, [tool, dataset?.current_stage_id])

  const askAiForFeatureRecommendation = async () => {
    if (!dataset?.id || aiLoading) return
    if (auth.isGuest) {
      auth.requireAccountForAI()
      return
    }
    setAiLoading(true)
    setAiSuggestion(null)
    try {
      const activeRecommendation = tool === 'bins' ? binRecommendation : formatRecommendation
      const payload = {
        stage_id: dataset.current_stage_id,
        tool,
        system_recommendation: activeRecommendation || null,
        selected_options: tool === 'bins'
          ? { column: binCol, bins: binCount, labels: binLabels, new_name: binNewName || `${binCol || 'column'}_bin` }
          : { column: fmtCol, operation: fmtOp, decimals: fmtParam, new_name: fmtNewName || fmtCol },
        numeric_columns: numericVariables.map((v) => ({ name: v.name, type: v.dtype, unique: v.unique })),
        supported_actions: ['create bins', 'numeric formatting'],
      }
      const r = await api.aiExplain(
        dataset.id,
        `feature-tools-${tool}-recommendation:${dataset.current_stage_id || 'current'}`,
        payload,
        'Give plain-text advice for this optional feature tool. Recommend only supported SimuCast actions: create bins or numeric formatting. Explain whether it is useful and what settings to use. Do not apply changes.',
        payload,
      )
      setAiSuggestion({ ok: true, text: r.explanation || 'AI suggestion unavailable.' })
    } catch {
      setAiSuggestion({ ok: false, text: 'AI suggestion unavailable.' })
    } finally {
      setAiLoading(false)
    }
  }

  const applyFeat = async () => {
    setBusy(true)
    setMsg(null)
    try {
      let body = {}
      if (tool === 'bins') {
        if (!binCol) { setMsg('Select a column to bin.'); setBusy(false); return }
        body = { operation: 'bin', column: binCol, bins: Number(binCount), labels: binLabels ? binLabels.split(',').map((s) => s.trim()) : null, new_name: binNewName || `${binCol}_bin` }
      } else if (tool === 'format') {
        if (!fmtCol) { setMsg('Select a column.'); setBusy(false); return }
        body = { operation: 'round', column: fmtCol, param: fmtParam, new_name: fmtNewName || fmtCol }
      }
      await api.featureEngineer(dataset.id, body)
      setMsg('Applied! Dataset updated.')
      await onApplied?.()
    } catch (err) {
      setMsg(err.message || 'Failed to apply.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`ax-card ax-module-card ax-card-prep ax-busy-host ${busy ? 'is-busy' : ''}`} style={{ marginBottom: 16 }}>
      <BusyOverlay
        active={busy}
        title={tool === 'format' ? 'Formatting numeric values...' : 'Applying feature engineering...'}
        detail="Creating a new dataset stage and refreshing the data preparation workspace."
      />
      <button
        type="button"
        className="ax-module-head ax-feature-tool-head"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="ax-module-head-main">
          <span className="ax-module-icon" aria-hidden>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
              <path d="M3 1L7 5L3 9" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </span>
          <div className="ax-module-copy">
            <p className="ax-module-title">
              Optional feature tools and numeric formatting
              <HelpButton
                title="Optional feature tools: what this card does"
                text="Use this card for optional enrichment and display cleanup. Create bins when grouped ranges are easier to interpret, or apply numeric formatting when decimal precision is excessive or inconsistent."
              />
            </p>
            <p className="ax-module-subtitle">Optional: create binned features or standardize decimal places</p>
          </div>
        </div>
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {[['bins','Create bins'],['format','Numeric formatting']].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`ax-tab ${tool === key ? 'active' : ''}`}
                onClick={() => { setTool(key); setMsg(null) }}
              >
                {label}
              </button>
            ))}
          </div>

          {tool === 'bins' && (
            <div>
              <FeatureRecommendationHeader
                title="Recommended binning setup"
                info="System recommendation means SimuCast chose a simple optional binning setup from numeric columns that are easier to interpret in grouped ranges. Binning is optional and loses numeric detail."
                loading={aiLoading}
                onAsk={askAiForFeatureRecommendation}
              />
              <FeatureRecommendationCard recommendation={binRecommendation || {
                label: 'No strong binning recommendation',
                why: 'Binning is optional and works best for numeric columns where grouped interpretation is useful.',
              }} />
              <AiRecommendationBlock loading={aiLoading} suggestion={aiSuggestion} />
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '8px 0 12px' }}>
                Binning loses numeric detail. Use it only when grouped ranges help explain the data.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px 10px', alignItems: 'center', fontSize: 12 }}>
              <label style={{ color: 'var(--color-text-secondary)' }}>Column to bin</label>
              <select value={binCol} onChange={(e) => setBinCol(e.target.value)}>
                <option value="">— select —</option>
                {numVars.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <label style={{ color: 'var(--color-text-secondary)' }}>Number of bins</label>
              <input
                type="number"
                min={2}
                max={20}
                value={binCount}
                onChange={(e) => {
                  const value = e.target.value
                  setBinCount(value)
                  if (Number(value) === 3) setBinLabels('low, medium, high')
                  if (Number(value) === 5) setBinLabels('very low, low, medium, high, very high')
                }}
                style={{ width: 80 }}
              />
              <label style={{ color: 'var(--color-text-secondary)' }}>Labels (optional)</label>
              <input type="text" placeholder="low, medium, high" value={binLabels} onChange={(e) => setBinLabels(e.target.value)} />
              <label style={{ color: 'var(--color-text-secondary)' }}>New column name</label>
              <input type="text" placeholder={binCol ? `${binCol}_bin` : 'auto'} value={binNewName} onChange={(e) => setBinNewName(e.target.value)} />
              </div>
            </div>
          )}

          {false && (
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px 10px', alignItems: 'start', fontSize: 12 }}>
              <label style={{ color: 'var(--color-text-secondary)', paddingTop: 4 }}>Columns to average</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {numVars.map((n) => (
                  <label key={n} className="ax-chip" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={avgCols.includes(n)} onChange={(e) => setAvgCols(e.target.checked ? [...avgCols, n] : avgCols.filter((x) => x !== n))} />
                    <span style={{ marginLeft: 4 }}>{n}</span>
                  </label>
                ))}
              </div>
              <label style={{ color: 'var(--color-text-secondary)', paddingTop: 4 }}>New column name</label>
              <input type="text" placeholder="score_avg" value={avgNewName} onChange={(e) => setAvgNewName(e.target.value)} />
            </div>
          )}

          {false && (
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px 10px', alignItems: 'center', fontSize: 12 }}>
              <label style={{ color: 'var(--color-text-secondary)' }}>Numerator</label>
              <select value={ratioNum} onChange={(e) => setRatioNum(e.target.value)}>
                <option value="">— select —</option>
                {numVars.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <label style={{ color: 'var(--color-text-secondary)' }}>Denominator</label>
              <select value={ratioDen} onChange={(e) => setRatioDen(e.target.value)}>
                <option value="">— select —</option>
                {numVars.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <label style={{ color: 'var(--color-text-secondary)' }}>New column name</label>
              <input type="text" placeholder={ratioNum && ratioDen ? `${ratioNum}_per_${ratioDen}` : 'auto'} value={ratioNewName} onChange={(e) => setRatioNewName(e.target.value)} />
            </div>
          )}

          {tool === 'format' && (
            <div>
              <FeatureRecommendationHeader
                title="Recommended numeric formatting"
                info="System recommendation means SimuCast checks numeric columns for excessive or inconsistent decimal precision. Formatting is optional and should be used for cleaner display, exports, and reports."
                loading={aiLoading}
                onAsk={askAiForFeatureRecommendation}
              />
              <FeatureRecommendationCard recommendation={formatRecommendation || {
                label: 'No numeric formatting needed',
                why: 'Only round or format values when decimal precision is excessive or inconsistent.',
              }} />
              <AiRecommendationBlock loading={aiLoading} suggestion={aiSuggestion} />
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px 10px', alignItems: 'center', fontSize: 12, marginTop: 12 }}>
              <label style={{ color: 'var(--color-text-secondary)' }}>Column</label>
              <select value={fmtCol} onChange={(e) => setFmtCol(e.target.value)}>
                <option value="">— select —</option>
                {numVars.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <label style={{ color: 'var(--color-text-secondary)' }}>Operation</label>
              <select value={fmtOp} onChange={(e) => setFmtOp(e.target.value)}>
                <option value="round">Round decimals</option>
              </select>
              <label style={{ color: 'var(--color-text-secondary)' }}>Decimal places</label>
              <input type="number" min={0} max={8} value={fmtParam} onChange={(e) => setFmtParam(e.target.value)} style={{ width: 80 }} disabled={fmtOp !== 'round'} />
              <label style={{ color: 'var(--color-text-secondary)' }}>New column name</label>
              <input type="text" placeholder={fmtCol || 'auto'} value={fmtNewName} onChange={(e) => setFmtNewName(e.target.value)} />
              </div>
            </div>
          )}

          {msg && (
            <p style={{ fontSize: 12, margin: '10px 0 0', color: msg.startsWith('Applied') ? 'var(--color-text-success)' : 'var(--color-text-danger)' }}>{msg}</p>
          )}
          <div style={{ marginTop: 12 }}>
            <button className="ax-btn prim" onClick={applyFeat} disabled={busy} type="button">
              {busy ? <InlineSpinner label="Applying..." /> : 'Apply'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Scrolls to a section element and briefly applies a highlight class for emphasis.
function highlightSection(section) {
  const el = document.getElementById(section)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ax-fix-highlight')
  window.setTimeout(() => el.classList.remove('ax-fix-highlight'), 2600)
}
