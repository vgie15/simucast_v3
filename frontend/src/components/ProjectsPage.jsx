import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useDialog } from './DialogProvider'
import { useAuth } from './AuthProvider'
import NewProjectModal from './NewProjectModal'

export default function ProjectsPage() {
  const [datasets, setDatasets] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const navigate = useNavigate()
  const dialog = useDialog()
  const auth = useAuth()

  const guestAtLimit = auth.guestAtLimit

  useEffect(() => {
    api.listDatasets().then(setDatasets).catch(console.error)
  }, [])

  const deleteProject = async (project, event) => {
    event.stopPropagation()
    const ok = await dialog.confirm({
      title: 'Delete Project',
      message: `Delete "${project.name}"? This action is irreversible.`,
      details: 'The project and all of its generated work will be permanently removed from SimuCast.',
      affectedItems: ['Dataset rows and source file reference', 'Data stages and cleaning history', 'Analysis results', 'Trained models', 'What-if scenarios', 'Documentation log and notes'],
      cancelLabel: 'Cancel',
      confirmLabel: 'Delete Project',
      variant: 'danger',
      requireText: 'DELETE',
    })
    if (!ok) return
    try {
      await api.deleteDataset(project.id)
      setDatasets((current) => current.filter((d) => d.id !== project.id))
    } catch (err) {
      await dialog.alert({ title: 'Delete Failed', message: err.message, variant: 'danger' })
    }
  }

  return (
    <>
      <div className="ax-row" style={{ marginBottom: 4 }}>
        <div>
          <h1 className="ax-page-title" style={{ marginBottom: 0 }}>Projects</h1>
          <p className="ax-page-sub">Each project is a dataset you can clean, describe, test, and model.</p>
        </div>
        {guestAtLimit ? (
          <button className="ax-btn-signup" onClick={() => auth.showAuthModal('signup')} type="button">
            Sign up to add more
          </button>
        ) : (
          <button className="ax-btn prim" onClick={() => setModalOpen(true)} type="button">
            + New project
          </button>
        )}
      </div>
      {guestAtLimit && (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>
          Guest accounts are limited to 1 project. Sign up to keep your work and create more.
        </p>
      )}

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
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button
                    className="ax-btn"
                    onClick={(event) => {
                      event.stopPropagation()
                      navigate(`/projects/${d.id}`)
                    }}
                  >
                    Open -&gt;
                  </button>
                  <button className="ax-btn danger" onClick={(event) => deleteProject(d, event)}>
                    Delete
                  </button>
                </div>
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
