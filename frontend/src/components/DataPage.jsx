import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import DataGridModal from './DataGridModal'
import ColumnValuesModal from './ColumnValuesModal'
import StageTimeline from './StageTimeline'
import AIAssistantPanel from './AIAssistantPanel'
import ManualTransformsCard from './ManualTransformsCard'

export default function DataPage({ dataset, setDataset }) {
  const [viewStageId, setViewStageId] = useState(null)
  const [viewStageLabel, setViewStageLabel] = useState(null)
  const [activeVar, setActiveVar] = useState(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [suggestions, setSuggestions] = useState([])
  const [statuses, setStatuses] = useState({})
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)

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
    setLoadingSuggestions(true)
    try {
      const r = await api.cleanSuggestions(dataset.id)
      setSuggestions(r.suggestions || [])
      setStatuses({})
    } finally {
      setLoadingSuggestions(false)
    }
  }

  useEffect(() => {
    if (!dataset?.id) return
    loadSuggestions()
  }, [dataset?.id])

  const applySuggestion = async (s, accept) => {
    if (!accept) {
      setStatuses((prev) => ({ ...prev, [s.id]: 'skipped' }))
      return
    }
    try {
      await api.cleanApply(dataset.id, { action: s.action, variable: s.variable })
      setStatuses((prev) => ({ ...prev, [s.id]: 'applied' }))
      await refreshDataset()
      await loadSuggestions()
    } catch (err) {
      alert('Apply failed: ' + err.message)
    }
  }

  const counts = useMemo(() => ({
    missing: suggestions.filter((s) => s.kind === 'missing').length,
    outliers: suggestions.filter((s) => s.kind === 'outliers').length,
    types: suggestions.filter((s) => s.kind === 'type').length,
  }), [suggestions])

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
              Browse the full dataset in an Excel-style grid.
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
            <button
              className="ax-btn prim"
              onClick={() => {
                setViewStageId('current')
                setViewStageLabel(null)
              }}
            >
              View data grid
            </button>
          </div>
        </div>
      </div>

      <ManualTransformsCard
        dataset={dataset}
        onApplied={async () => {
          await refreshDataset()
          await loadSuggestions()
        }}
      />

      <p className="ax-lbl">Cleaning insights</p>
      <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 6px' }}>
        Suggested fixes based on the current stage.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
        <StatCard label="Missing" value={counts.missing} />
        <StatCard label="Outliers" value={counts.outliers} />
        <StatCard label="Type issues" value={counts.types} />
      </div>
      {loadingSuggestions ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Analyzing…</p>
      ) : suggestions.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
          No issues found. Your data looks clean.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {suggestions.map((s) => {
            const st = statuses[s.id]
            return (
              <div key={s.id} className="ax-card" style={{ padding: '10px 12px', opacity: st ? 0.45 : 1 }}>
                <div className="ax-row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <KindBadge kind={s.kind} />
                      <span style={{ fontSize: 12, fontWeight: 500 }}>{s.variable}</span>
                      {st && (
                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: st === 'applied' ? 'var(--color-background-success)' : 'var(--color-background-secondary)', color: st === 'applied' ? 'var(--color-text-success)' : 'var(--color-text-secondary)' }}>
                          {st === 'applied' ? 'Applied' : 'Skipped'}
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>{s.description}</p>
                  </div>
                  {!st && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="ax-btn" onClick={() => applySuggestion(s, false)}>Skip</button>
                      <button className="ax-btn prim" onClick={() => applySuggestion(s, true)}>Apply</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <AIAssistantPanel datasetId={dataset.id} context="data" />

      <p className="ax-lbl">Data history</p>
      <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 6px' }}>
        Every cleaning, merge, or expansion creates a new stage. Original data is always preserved
        and can be viewed or exported at any time.
      </p>
      <div style={{ marginBottom: 16 }}>
        <StageTimeline
          datasetId={dataset.id}
          refreshKey={historyKey}
          onView={(stageId) => {
            setViewStageId(stageId)
            setViewStageLabel(stageId === 'original' ? 'Original upload' : `Stage ${stageId.slice(0, 8)}`)
          }}
          onRestored={async () => {
            await refreshDataset()
            await loadSuggestions()
          }}
        />
      </div>

      <p className="ax-lbl">Variables</p>
      <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 6px' }}>
        Click a row to view all entries for that variable.
      </p>
      <div className="ax-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="ax-tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Missing</th>
              <th>Unique</th>
            </tr>
          </thead>
          <tbody>
            {(dataset.variables || []).map((v) => (
              <tr key={v.name} style={{ cursor: 'pointer' }} onClick={() => setActiveVar(v)}>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{v.name}</td>
                <td><span style={{ color: 'var(--color-text-info)' }}>{v.dtype}</span></td>
                <td>{v.missing}</td>
                <td>{v.unique}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {viewStageId && (
        <DataGridModal
          datasetId={dataset.id}
          variables={dataset.variables || []}
          stageId={viewStageId === 'current' ? null : viewStageId}
          stageLabel={viewStageLabel}
          onClose={() => {
            setViewStageId(null)
            setViewStageLabel(null)
          }}
        />
      )}
      {activeVar && <ColumnValuesModal datasetId={dataset.id} variable={activeVar} onClose={() => setActiveVar(null)} />}
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
  return <span style={{ fontSize: 10, padding: '1px 6px', background: c.bg, color: c.fg, borderRadius: 4 }}>{c.label}</span>
}
