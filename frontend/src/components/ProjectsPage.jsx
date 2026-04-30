import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import NewProjectModal from './NewProjectModal'

export default function ProjectsPage() {
  const [datasets, setDatasets] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    api.listDatasets().then(setDatasets).catch(console.error)
  }, [])

  return (
    <>
      <div className="ax-row" style={{ marginBottom: 4 }}>
        <div>
          <h1 className="ax-page-title" style={{ marginBottom: 0 }}>Projects</h1>
          <p className="ax-page-sub">Each project is a dataset you can clean, describe, test, and model.</p>
        </div>
        <button className="ax-btn prim" onClick={() => setModalOpen(true)}>
          + New project
        </button>
      </div>

      <p className="ax-lbl" style={{ marginTop: 16 }}>All projects</p>
      {datasets.length === 0 ? (
        <div className="ax-card">
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>
            No projects yet. Click <strong>+ New project</strong> to upload a dataset and get started.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {datasets.map((d) => (
            <div
              key={d.id}
              className="ax-card"
              style={{ padding: '10px 12px', cursor: 'pointer' }}
              onClick={() => navigate(`/projects/${d.id}`)}
            >
              <div className="ax-row">
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{d.name}</p>
                  {d.description && (
                    <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.description}
                    </p>
                  )}
                  <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>
                    {d.row_count?.toLocaleString()} rows · {d.col_count} variables
                    {d.created_at && ` · ${new Date(d.created_at).toLocaleDateString()}`}
                  </p>
                </div>
                <button className="ax-btn">Open →</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <NewProjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(result) => {
          setModalOpen(false)
          navigate(`/projects/${result.id}`)
        }}
      />
    </>
  )
}
