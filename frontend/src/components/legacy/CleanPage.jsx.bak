import React, { useEffect, useState } from 'react'
import { api } from '../api'
import ManualTransformsCard from './ManualTransformsCard'
import { useDialog } from './DialogProvider'

export default function CleanPage({ dataset, setDataset }) {
  const dialog = useDialog()
  const [suggestions, setSuggestions] = useState([])
  const [statuses, setStatuses] = useState({}) // id -> 'applied' | 'skipped'
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!dataset) return
    load()
  }, [dataset?.id])

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.cleanSuggestions(dataset.id)
      setSuggestions(r.suggestions || [])
      setStatuses({})
    } finally {
      setLoading(false)
    }
  }

  const act = async (s, accept) => {
    if (!accept) {
      setStatuses({ ...statuses, [s.id]: 'skipped' })
      return
    }
    try {
      await api.cleanApply(dataset.id, { action: s.action, variable: s.variable })
      setStatuses({ ...statuses, [s.id]: 'applied' })
      // refresh dataset meta after apply
      const full = await api.getDataset(dataset.id)
      setDataset(full)
    } catch (err) {
      await dialog.alert({ title: 'Apply Failed', message: err.message, variant: 'danger' })
    }
  }

  if (!dataset) return <EmptyState />

  const missing = suggestions.filter((s) => s.kind === 'missing').length
  const outliers = suggestions.filter((s) => s.kind === 'outliers').length
  const types = suggestions.filter((s) => s.kind === 'type').length

  return (
    <>
      <h1 className="ax-page-title">Data cleaning</h1>
      <p className="ax-page-sub">AI-suggested fixes based on the current dataset.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
        <StatCard label="Missing" value={missing} />
        <StatCard label="Outliers" value={outliers} />
        <StatCard label="Type issues" value={types} />
      </div>

      <ManualTransformsCard
        dataset={dataset}
        onApplied={async () => {
          const fresh = await api.getDataset(dataset.id)
          setDataset(fresh)
          load()
        }}
      />

      <p className="ax-lbl">Suggested fixes</p>
      {loading ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Analyzing…</p>
      ) : suggestions.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>No issues found. Your data looks clean.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                  </div>
                  {!st && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="ax-btn" onClick={() => act(s, false)}>Skip</button>
                      <button className="ax-btn prim" onClick={() => act(s, true)}>Apply</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
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

function EmptyState() {
  return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first from the Data page.</p>
}
