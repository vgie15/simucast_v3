import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api'

const TABS = [
  { key: 'merge', label: 'Merge columns' },
  { key: 'rename', label: 'Rename' },
  { key: 'drop_cols', label: 'Drop columns' },
  { key: 'drop_rows', label: 'Drop rows' },
  { key: 'cast', label: 'Change type' },
  { key: 'split', label: 'Split column' },
]

/**
 * ManualTransformsCard
 * A multi-mode form for manual schema transforms. Each mode debounces a
 * /transform?preview=true call so the user sees the result on a 20-row
 * sample before applying. Apply commits a new versioned stage.
 */
export default function ManualTransformsCard({ dataset, onApplied }) {
  const [tab, setTab] = useState('merge')
  const [params, setParams] = useState({})
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // reset params when switching modes
  useEffect(() => {
    setParams(defaultParams(tab, dataset))
    setPreview(null)
    setError(null)
  }, [tab, dataset?.id])

  const op = opForTab(tab)
  const variables = dataset.variables || []
  const colNames = useMemo(() => variables.map((v) => v.name), [variables])

  // debounced preview as the form changes
  useEffect(() => {
    if (!op) return
    const valid = isValid(op, params, colNames)
    if (!valid) {
      setPreview(null)
      setError(null)
      return
    }
    let cancelled = false
    setPreviewing(true)
    setError(null)
    const t = setTimeout(async () => {
      try {
        const r = await api.transform(dataset.id, op, params, true)
        if (!cancelled) setPreview(r)
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Preview failed')
          setPreview(null)
        }
      } finally {
        if (!cancelled) setPreviewing(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [dataset.id, op, JSON.stringify(params), colNames.join(',')])

  const apply = async () => {
    if (!op) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.transform(dataset.id, op, params, false)
      onApplied?.(r)
      setParams(defaultParams(tab, dataset))
      setPreview(null)
    } catch (err) {
      setError(err.message || 'Apply failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ax-card" style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Manual transforms</p>
        <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>
          Restructure your data — merge, rename, drop, change types. Each apply creates a new
          stage so the original is preserved.
        </p>
      </div>

      <div className="ax-tabs" style={{ padding: 0, marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`ax-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Form tab={tab} params={params} setParams={setParams} variables={variables} />

      {error && (
        <p style={{ fontSize: 12, color: 'var(--color-text-danger)', margin: '8px 0 0' }}>{error}</p>
      )}

      {preview && (
        <div style={{ marginTop: 12 }}>
          <div className="ax-row" style={{ marginBottom: 6 }}>
            <p className="ax-lbl" style={{ margin: 0 }}>
              Preview {previewing && <span style={{ color: 'var(--color-text-tertiary)' }}>· refreshing…</span>}
            </p>
            <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
              → {preview.row_count?.toLocaleString()} rows · {preview.col_count} cols
            </span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>
            {preview.summary}
          </p>
          <div
            style={{
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 6,
              overflow: 'auto',
              maxHeight: 220,
            }}
          >
            <table className="ax-grid" style={{ minWidth: '100%' }}>
              <thead>
                <tr>
                  <th className="ax-grid-row-num-head">#</th>
                  {preview.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((row, i) => (
                  <tr key={i}>
                    <td className="ax-grid-row-num">{i + 1}</td>
                    {preview.columns.map((c) => {
                      const v = row[c]
                      const missing = v === null || v === undefined || v === ''
                      return (
                        <td key={c} className={missing ? 'missing' : ''}>
                          {missing ? '—' : String(v)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="ax-row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
        <button
          className="ax-btn prim"
          disabled={busy || previewing || !preview}
          onClick={apply}
          type="button"
        >
          {busy ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </div>
  )
}

function Form({ tab, params, setParams, variables }) {
  const set = (patch) => setParams({ ...params, ...patch })
  const colNames = variables.map((v) => v.name)

  if (tab === 'merge') {
    return (
      <>
        <ColumnMultiSelect
          label="Columns to merge (in order)"
          variables={variables}
          value={params.columns || []}
          onChange={(columns) => set({ columns })}
        />
        <Row>
          <TextField label="Separator" value={params.separator ?? ' '} onChange={(separator) => set({ separator })} />
          <TextField label="New column name" value={params.new_name || ''} onChange={(new_name) => set({ new_name })} />
        </Row>
        <Checkbox
          label="Drop the original columns"
          value={params.drop_originals !== false}
          onChange={(drop_originals) => set({ drop_originals })}
        />
      </>
    )
  }
  if (tab === 'rename') {
    return (
      <Row>
        <ColumnSelect label="Column" colNames={colNames} value={params.column || ''} onChange={(column) => set({ column })} />
        <TextField label="New name" value={params.new_name || ''} onChange={(new_name) => set({ new_name })} />
      </Row>
    )
  }
  if (tab === 'drop_cols') {
    return (
      <ColumnMultiSelect
        label="Columns to drop"
        variables={variables}
        value={params.columns || []}
        onChange={(columns) => set({ columns })}
      />
    )
  }
  if (tab === 'drop_rows') {
    return (
      <>
        <Row>
          <ColumnSelect label="Column" colNames={colNames} value={params.column || ''} onChange={(column) => set({ column })} />
          <SelectField
            label="Predicate"
            value={params.predicate || 'missing'}
            onChange={(predicate) => set({ predicate })}
            options={[
              { value: 'missing', label: 'is missing' },
              { value: 'equals', label: 'equals' },
              { value: 'gt', label: '>' },
              { value: 'lt', label: '<' },
              { value: 'in', label: 'is one of (comma list)' },
            ]}
          />
        </Row>
        {params.predicate && params.predicate !== 'missing' && (
          <TextField
            label="Value"
            value={params.value ?? ''}
            onChange={(value) => {
              if (params.predicate === 'in') {
                set({ value: String(value).split(',').map((s) => s.trim()).filter(Boolean) })
              } else {
                set({ value })
              }
            }}
          />
        )}
      </>
    )
  }
  if (tab === 'cast') {
    return (
      <Row>
        <ColumnSelect label="Column" colNames={colNames} value={params.column || ''} onChange={(column) => set({ column })} />
        <SelectField
          label="Cast to"
          value={params.to || 'numeric'}
          onChange={(to) => set({ to })}
          options={[
            { value: 'numeric', label: 'numeric' },
            { value: 'datetime', label: 'datetime' },
            { value: 'category', label: 'category' },
            { value: 'text', label: 'text' },
          ]}
        />
      </Row>
    )
  }
  if (tab === 'split') {
    return (
      <>
        <Row>
          <ColumnSelect label="Column" colNames={colNames} value={params.column || ''} onChange={(column) => set({ column })} />
          <TextField label="Separator" value={params.separator ?? ' '} onChange={(separator) => set({ separator })} />
        </Row>
        <TextField
          label="New column names (comma separated, in order)"
          value={(params.into || []).join(', ')}
          onChange={(s) => set({ into: String(s).split(',').map((x) => x.trim()).filter(Boolean) })}
        />
      </>
    )
  }
  return null
}

function defaultParams(tab, dataset) {
  if (tab === 'merge') return { columns: [], separator: ' ', new_name: '', drop_originals: true }
  if (tab === 'rename') return { column: '', new_name: '' }
  if (tab === 'drop_cols') return { columns: [] }
  if (tab === 'drop_rows') return { column: '', predicate: 'missing' }
  if (tab === 'cast') return { column: '', to: 'numeric' }
  if (tab === 'split') return { column: '', separator: ' ', into: [] }
  return {}
}

function opForTab(tab) {
  return {
    merge: 'merge_columns',
    rename: 'rename_column',
    drop_cols: 'drop_columns',
    drop_rows: 'drop_rows',
    cast: 'cast_column',
    split: 'split_column',
  }[tab]
}

function isValid(op, p, cols) {
  if (op === 'merge_columns') return (p.columns || []).length >= 2 && !!(p.new_name || '').trim()
  if (op === 'rename_column') return !!p.column && !!(p.new_name || '').trim()
  if (op === 'drop_columns') return (p.columns || []).length >= 1
  if (op === 'drop_rows') {
    if (!p.column) return false
    if (p.predicate === 'missing') return true
    return p.value !== '' && p.value !== undefined && p.value !== null
  }
  if (op === 'cast_column') return !!p.column && !!p.to
  if (op === 'split_column') return !!p.column && (p.into || []).length >= 1
  return false
}

function Row({ children }) {
  return <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>{children}</div>
}
function TextField({ label, value, onChange }) {
  return (
    <label style={{ flex: 1, display: 'block' }}>
      <span className="ax-lbl" style={{ display: 'block', marginBottom: 4 }}>{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%' }} />
    </label>
  )
}
function SelectField({ label, value, onChange, options }) {
  return (
    <label style={{ flex: 1, display: 'block' }}>
      <span className="ax-lbl" style={{ display: 'block', marginBottom: 4 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%' }}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}
function ColumnSelect({ label, colNames, value, onChange }) {
  return (
    <label style={{ flex: 1, display: 'block' }}>
      <span className="ax-lbl" style={{ display: 'block', marginBottom: 4 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%' }}>
        <option value="">— pick a column —</option>
        {colNames.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  )
}
function ColumnMultiSelect({ label, variables, value, onChange }) {
  const toggle = (name) => {
    if (value.includes(name)) onChange(value.filter((v) => v !== name))
    else onChange([...value, name])
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <span className="ax-lbl" style={{ display: 'block', marginBottom: 4 }}>{label}</span>
      <div
        style={{
          maxHeight: 140,
          overflow: 'auto',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: 6,
          padding: 4,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
        }}
      >
        {variables.map((v) => {
          const idx = value.indexOf(v.name)
          const active = idx >= 0
          return (
            <button
              key={v.name}
              type="button"
              onClick={() => toggle(v.name)}
              className="ax-chip"
              style={{
                background: active ? 'var(--color-accent-light)' : 'var(--color-background-secondary)',
                color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                border: 0,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                padding: '4px 8px',
              }}
            >
              {active ? `${idx + 1}. ` : ''}{v.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
function Checkbox({ label, value, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 4 }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
