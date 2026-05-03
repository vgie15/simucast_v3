import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useDialog } from './DialogProvider'

/**
 * StageTimeline
 * Renders the chain of dataset transformations: original upload + each
 * cleaning / merge / expand step. Each row exposes:
 *   - View: opens the data grid scoped to that stage
 *   - Export: downloads that stage as CSV
 *   - Restore: makes that stage the active one for downstream analyses
 * The active stage is highlighted.
 */
export default function StageTimeline({ datasetId, onView, onRestored, refreshKey }) {
  const dialog = useDialog()
  const [data, setData] = useState({ stages: [], current_stage_id: 'original' })
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.listStages(datasetId)
      setData(r)
    } catch (err) {
      console.error('Failed to load stages', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [datasetId, refreshKey])

  const restore = async (stageId) => {
    if (busyId) return
    setBusyId(stageId)
    try {
      await api.restoreStage(datasetId, stageId)
      await load()
      onRestored?.(stageId)
    } catch (err) {
      await dialog.alert({ title: 'Restore Failed', message: err.message, variant: 'danger' })
    } finally {
      setBusyId(null)
    }
  }

  if (loading && data.stages.length === 0) {
    return <p style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Loading history…</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {data.stages.map((st) => {
        const isActive = (data.current_stage_id || 'original') === st.id
        return (
          <div
            key={st.id}
            className="ax-card"
            style={{
              padding: '8px 12px',
              borderColor: isActive ? 'var(--color-accent)' : undefined,
              background: isActive ? 'var(--color-accent-light)' : undefined,
            }}
          >
            <div className="ax-row" style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-text-tertiary)',
                      minWidth: 18,
                    }}
                  >
                    #{st.step_index}
                  </span>
                  <span
                    className="ax-chip"
                    style={{
                      background: 'var(--color-background-secondary)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {st.op_type}
                  </span>
                  {isActive && (
                    <span
                      className="ax-chip"
                      style={{
                        background: 'var(--color-accent)',
                        color: 'var(--color-background-primary)',
                      }}
                    >
                      active
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 12, margin: '4px 0 0' }}>{st.summary}</p>
                <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>
                  {st.row_count?.toLocaleString()} rows · {st.col_count} cols
                  {st.created_at && ` · ${new Date(st.created_at).toLocaleString()}`}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button className="ax-btn" onClick={() => onView?.(st.id)} type="button">
                  View
                </button>
                <a
                  className="ax-btn"
                  href={api.exportCsvUrl(datasetId, st.id)}
                  download
                  style={{ textDecoration: 'none' }}
                >
                  Export CSV
                </a>
                {!isActive && (
                  <button
                    className="ax-btn"
                    disabled={busyId === st.id}
                    onClick={() => restore(st.id)}
                    type="button"
                  >
                    {busyId === st.id ? '…' : 'Restore'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
