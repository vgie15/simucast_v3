import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useAuth, markGuestSlotUsed } from './AuthProvider'

export default function NewProjectModal({ open, onClose, onCreated }) {
  const auth = useAuth()
  const [mode, setMode] = useState('upload') // 'upload' | 'existing'
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState(null)
  const [existing, setExisting] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loadingExisting, setLoadingExisting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    if (!open || mode !== 'existing') return
    setLoadingExisting(true)
    api
      .listDatasets()
      .then(setExisting)
      .catch(() => setExisting([]))
      .finally(() => setLoadingExisting(false))
  }, [open, mode])

  if (!open) return null

  const reset = () => {
    setMode('upload')
    setName('')
    setDescription('')
    setFile(null)
    setSelectedId(null)
    setError(null)
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const onPick = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    if (!name) {
      const dot = f.name.lastIndexOf('.')
      setName(dot > 0 ? f.name.slice(0, dot) : f.name)
    }
  }

  const onPickExisting = (d) => {
    setSelectedId(d.id)
    if (!name) setName(d.name)
  }

  const submit = async () => {
    if (!name.trim()) {
      setError('Give the project a name.')
      return
    }
    if (mode === 'upload' && !file) {
      setError('Choose a .csv, .xlsx, or .xls file.')
      return
    }
    if (mode === 'existing' && !selectedId) {
      setError('Pick a file from the list.')
      return
    }
    if (auth.guestAtLimit) {
      setError('Guest mode is limited to 1 temporary project. Sign up or log in to create saved projects.')
      auth.showAuthModal('signup')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result =
        mode === 'upload'
          ? await api.uploadDataset(file, name.trim(), description.trim())
          : await api.createFromDataset(selectedId, name.trim(), description.trim())
      // Mark the guest slot used immediately — persists even if project is later deleted
      if (auth.isGuest) markGuestSlotUsed(auth.session?.token)
      reset()
      onCreated(result)
      auth.refreshSession?.().catch(() => {})
    } catch (err) {
      if (err.guest_limit || err.auth_required) {
        auth.showAuthModal('signup')
      }
      setError(err.message || 'Failed to create project')
      setBusy(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="ax-card"
        style={{
          width: '100%',
          maxWidth: 520,
          padding: 20,
          background: 'var(--color-background-primary)',
        }}
      >
        <div className="ax-row" style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>New project</p>
          <button
            className="ax-btn"
            onClick={close}
            disabled={busy}
            aria-label="Close"
            style={{ padding: '2px 8px' }}
          >
            ×
          </button>
        </div>

        <div className="ax-tabs" style={{ padding: 0, marginBottom: 12 }}>
          <button
            type="button"
            className={`ax-tab ${mode === 'upload' ? 'active' : ''}`}
            onClick={() => { setMode('upload'); setError(null) }}
            disabled={busy}
          >
            Upload from computer
          </button>
          <button
            type="button"
            className={`ax-tab ${mode === 'existing' ? 'active' : ''}`}
            onClick={() => { setMode('existing'); setError(null) }}
            disabled={busy}
          >
            Choose uploaded file
          </button>
        </div>

        <label style={{ display: 'block', marginBottom: 10 }}>
          <span className="ax-lbl" style={{ display: 'block', marginBottom: 4 }}>Project name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Customer churn 2026"
            disabled={busy}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 10 }}>
          <span className="ax-lbl" style={{ display: 'block', marginBottom: 4 }}>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional — what this dataset is for, where it came from, etc."
            disabled={busy}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </label>

        {mode === 'upload' ? (
          <div style={{ marginBottom: 12 }}>
            <span className="ax-lbl" style={{ display: 'block', marginBottom: 4 }}>Data file</span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={onPick}
              disabled={busy}
              style={{ display: 'none' }}
            />
            <div className="ax-row" style={{ gap: 8 }}>
              <button
                className="ax-btn"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                type="button"
              >
                {file ? 'Choose different file' : 'Upload file'}
              </button>
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file ? file.name : 'No file selected · .csv, .xlsx, .xls (max 50 MB)'}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <span className="ax-lbl" style={{ display: 'block', marginBottom: 4 }}>Pick a previously uploaded file</span>
            <div
              style={{
                maxHeight: 220,
                overflow: 'auto',
                border: '0.5px solid var(--color-border-tertiary)',
                borderRadius: 6,
              }}
            >
              {loadingExisting ? (
                <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', padding: 12, margin: 0 }}>
                  Loading files…
                </p>
              ) : existing.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', padding: 12, margin: 0 }}>
                  No files yet. Upload one in the other tab.
                </p>
              ) : (
                existing.map((d) => {
                  const active = d.id === selectedId
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => onPickExisting(d)}
                      disabled={busy}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 12px',
                        border: 0,
                        borderBottom: '0.5px solid var(--color-border-tertiary)',
                        background: active ? 'var(--color-accent-light)' : 'transparent',
                        cursor: 'pointer',
                        font: 'inherit',
                        color: 'inherit',
                      }}
                    >
                      <p style={{ fontSize: 12, fontWeight: 500, margin: 0, fontFamily: 'var(--font-mono)' }}>
                        {d.filename || d.name}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>
                        {d.row_count?.toLocaleString()} rows · {d.col_count} columns
                        {d.created_at && ` · ${new Date(d.created_at).toLocaleDateString()}`}
                      </p>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}

        {error && (
          <p style={{ fontSize: 12, color: 'var(--color-text-danger)', margin: '0 0 10px' }}>
            {error}
          </p>
        )}

        <div className="ax-row" style={{ justifyContent: 'flex-end', gap: 6 }}>
          <button className="ax-btn" onClick={close} disabled={busy} type="button">Cancel</button>
          <button className="ax-btn prim" onClick={submit} disabled={busy} type="button">
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  border: '1px solid var(--color-border-primary)',
  borderRadius: 6,
  background: 'var(--color-background-primary)',
  color: 'var(--color-text-primary)',
  boxSizing: 'border-box',
}
