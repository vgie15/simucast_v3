import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from './AuthProvider'
import NewProjectModal from './NewProjectModal'

export default function DashboardPage() {
  const [datasets, setDatasets] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const navigate = useNavigate()
  const auth = useAuth()
  const guestAtLimit = auth.isGuest && datasets.length >= 1

  useEffect(() => {
    api.listDatasets().then(setDatasets).catch(console.error)
  }, [])

  const totalRows = datasets.reduce((acc, d) => acc + (d.row_count || 0), 0)
  const latest = datasets[0]

  return (
    <>
      <div className="ax-row" style={{ marginBottom: 4 }}>
        <div>
          <h1 className="ax-page-title" style={{ marginBottom: 0 }}>Dashboard</h1>
          <p className="ax-page-sub">Quick overview of your work in SimuCast.</p>
        </div>
        {guestAtLimit ? (
          <button className="ax-btn-signup" type="button" onClick={() => auth.showAuthModal('signup')}>
            Sign up to add more
          </button>
        ) : (
          <button className="ax-btn prim" onClick={() => setModalOpen(true)}>
            + Add new project
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, margin: '12px 0 16px' }}>
        <StatCard label="Projects" value={datasets.length} />
        <StatCard label="Total rows" value={totalRows.toLocaleString()} />
        <StatCard label="Latest project" value={latest?.name || '—'} small={!!latest} />
      </div>

      <section style={{ marginBottom: 20 }}>
        <div className="ax-row" style={{ marginBottom: 8 }}>
          <p className="ax-lbl" style={{ margin: 0 }}>Recent projects</p>
          <Link to="/projects" style={{ fontSize: 11, color: 'var(--color-text-secondary)', textDecoration: 'none' }}>
            View all →
          </Link>
        </div>
        {datasets.length === 0 ? (
          <div className="ax-card">
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>
              No projects yet. Click <strong>+ Add new project</strong> to get started.
            </p>
          </div>
        ) : (
          <div className="ax-tile-grid">
            {datasets.slice(0, 6).map((d) => (
              <Link
                key={d.id}
                to={`/projects/${d.id}`}
                className="ax-card ax-tile"
              >
                <p className="ax-tile-title">{d.name}</p>
                {d.description && <p className="ax-tile-desc">{d.description}</p>}
                <p className="ax-tile-meta">
                  {d.row_count?.toLocaleString()} rows · {d.col_count} variables
                </p>
                {d.created_at && (
                  <p className="ax-tile-foot">{new Date(d.created_at).toLocaleDateString()}</p>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="ax-row" style={{ marginBottom: 8 }}>
          <p className="ax-lbl" style={{ margin: 0 }}>Recent files</p>
          <Link to="/files" style={{ fontSize: 11, color: 'var(--color-text-secondary)', textDecoration: 'none' }}>
            View all →
          </Link>
        </div>
        {datasets.length === 0 ? (
          <div className="ax-card">
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>
              No files yet. Files appear here when you create a project.
            </p>
          </div>
        ) : (
          <div className="ax-tile-grid">
            {datasets.slice(0, 6).map((d) => (
              <Link
                key={d.id}
                to={`/projects/${d.id}`}
                className="ax-card ax-tile"
              >
                <p className="ax-tile-title" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {d.filename || d.name}
                </p>
                <p className="ax-tile-meta">
                  {d.row_count?.toLocaleString()} rows · {d.col_count} columns
                </p>
                {d.created_at && (
                  <p className="ax-tile-foot">{new Date(d.created_at).toLocaleDateString()}</p>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

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

function StatCard({ label, value, small }) {
  return (
    <div className="ax-card">
      <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </p>
      <p
        style={{
          fontSize: small ? 14 : 22,
          fontWeight: 500,
          margin: '6px 0 0',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </p>
    </div>
  )
}
