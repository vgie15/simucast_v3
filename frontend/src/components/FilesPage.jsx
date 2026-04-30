import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

export default function FilesPage() {
  const [datasets, setDatasets] = useState([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.listDatasets().then(setDatasets).catch(console.error)
  }, [])

  const handleUpload = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setUploading(true)
    try {
      const result = await api.uploadDataset(f)
      navigate(`/projects/${result.id}`)
    } catch (err) {
      alert('Upload failed: ' + err.message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <div className="ax-row" style={{ marginBottom: 4 }}>
        <div>
          <h1 className="ax-page-title" style={{ marginBottom: 0 }}>Files</h1>
          <p className="ax-page-sub">Source files uploaded into SimuCast. Each file powers one project.</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleUpload}
          style={{ display: 'none' }}
        />
        <button
          className="ax-btn prim"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Upload new file'}
        </button>
      </div>

      {datasets.length === 0 ? (
        <div className="ax-card" style={{ marginTop: 12 }}>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>
            No files yet. Click <strong>Upload new file</strong> to add a .csv, .xlsx, or .xls file (max 50 MB).
          </p>
        </div>
      ) : (
        <div className="ax-card" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
          <table className="ax-tbl">
            <thead>
              <tr>
                <th>File</th>
                <th>Project</th>
                <th>Rows</th>
                <th>Columns</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => (
                <tr
                  key={d.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/projects/${d.id}`)}
                >
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{d.filename || '—'}</td>
                  <td>{d.name}</td>
                  <td>{d.row_count?.toLocaleString()}</td>
                  <td>{d.col_count}</td>
                  <td>{d.created_at ? new Date(d.created_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
