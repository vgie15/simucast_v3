import React from 'react'
import { useDialog } from './DialogProvider'

export default function HelpButton({ title = 'What this does', text, details, size = 18 }) {
  const dialog = useDialog()
  if (!text && !details) return null

  const open = async (event) => {
    event.stopPropagation()
    await dialog.alert({
      title,
      message: text,
      details,
      confirmLabel: 'Got it',
    })
  }

  return (
    <button
      type="button"
      className="ax-help-button"
      style={{ width: size, height: size, minWidth: size }}
      onClick={open}
      aria-label={title}
    >
      ?
    </button>
  )
}
