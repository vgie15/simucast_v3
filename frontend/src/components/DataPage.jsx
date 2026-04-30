import React, { useState } from 'react'
import { api } from '../api'
import DataGridModal from './DataGridModal'
import ColumnValuesModal from './ColumnValuesModal'
import StageTimeline from './StageTimeline'
import AIAssistantPanel from './AIAssistantPanel'

export default function DataPage({ dataset, setDataset }) {
  const [viewStageId, setViewStageId] = useState(null)
  const [viewStageLabel, setViewStageLabel] = useState(null)
  const [activeVar, setActiveVar] = useState(null)
  const [historyKey, setHistoryKey] = useState(0)

  const refreshDataset = async () => {
    try {
      const fresh = await api.getDataset(dataset.id)
      setDataset?.(fresh)
      setHistoryKey((k) => k + 1)
    } catch (err) {
      console.error('Failed to refresh dataset', err)
    }
  }

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
          onRestored={refreshDataset}
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
              <tr
                key={v.name}
                style={{ cursor: 'pointer' }}
                onClick={() => setActiveVar(v)}
              >
                <td style={{ fontFamily: 'var(--font-mono)' }}>{v.name}</td>
                <td>
                  <span style={{ color: 'var(--color-text-info)' }}>{v.dtype}</span>
                </td>
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
