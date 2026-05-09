/* ============================================================
 * CONTEXT: MODAL / DIALOG STATE
 * Keywords: dialog, modal, confirm, alert
 * ============================================================ */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

const DialogContext = createContext(null)

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null)

  const close = useCallback((value) => {
    setDialog((current) => {
      current?.resolve?.(value)
      return null
    })
  }, [])

  const alert = useCallback((options) => new Promise((resolve) => {
    setDialog({
      type: 'alert',
      title: typeof options === 'string' ? 'Notice' : options.title || 'Notice',
      message: typeof options === 'string' ? options : options.message,
      details: typeof options === 'string' ? null : options.details,
      confirmLabel: typeof options === 'string' ? 'Close' : options.confirmLabel || 'Close',
      variant: typeof options === 'string' ? 'default' : options.variant || 'default',
      resolve,
    })
  }), [])

  const confirm = useCallback((options) => new Promise((resolve) => {
    setDialog({
      type: 'confirm',
      title: options.title || 'Confirm action',
      message: options.message,
      details: options.details,
      affectedItems: options.affectedItems,
      confirmLabel: options.confirmLabel || 'Confirm',
      cancelLabel: options.cancelLabel || 'Cancel',
      variant: options.variant || 'default',
      requireText: options.requireText || '',
      resolve,
    })
  }), [])

  const value = useMemo(() => ({ alert, confirm }), [alert, confirm])

  return (
    <DialogContext.Provider value={value}>
      {children}
      {dialog && <AppDialog dialog={dialog} onClose={close} />}
    </DialogContext.Provider>
  )
}

export function useDialog() {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog must be used inside DialogProvider')
  return ctx
}

function AppDialog({ dialog, onClose }) {
  const [typed, setTyped] = useState('')
  const isDanger = dialog.variant === 'danger'
  const requiresText = !!dialog.requireText
  const canConfirm = !requiresText || typed.trim() === dialog.requireText

  return (
    <div className="ax-dialog-backdrop" role="presentation" onMouseDown={() => onClose(false)}>
      <div
        className="ax-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ax-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ax-dialog-header">
          <div className={`ax-dialog-icon ${isDanger ? 'danger' : ''}`} aria-hidden>
            {isDanger ? '!' : 'i'}
          </div>
          <h2 id="ax-dialog-title" className="ax-dialog-title">{dialog.title}</h2>
        </div>
        <div className="ax-dialog-body">
          {dialog.message && <p className="ax-dialog-message">{dialog.message}</p>}
          {dialog.details && <p className="ax-dialog-details">{dialog.details}</p>}
          {dialog.affectedItems?.length > 0 && (
            <div className="ax-dialog-list">
              <p>Affected items</p>
              <ul>
                {dialog.affectedItems.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
          {requiresText && (
            <label className="ax-dialog-confirm-field">
              <span>Type <strong>{dialog.requireText}</strong> to confirm.</span>
              <input value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus />
            </label>
          )}
        </div>
        <div className="ax-dialog-actions">
          {dialog.type === 'confirm' && (
            <button className="ax-btn" onClick={() => onClose(false)} type="button">
              {dialog.cancelLabel}
            </button>
          )}
          <button
            className={`ax-btn ${isDanger ? 'danger-fill' : 'prim'}`}
            onClick={() => onClose(true)}
            disabled={dialog.type === 'confirm' && !canConfirm}
            type="button"
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
