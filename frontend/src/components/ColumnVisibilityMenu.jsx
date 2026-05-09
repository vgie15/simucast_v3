/* ============================================================
 * COMPONENT: COLUMN VISIBILITY MENU
 * Keywords: columns, show, hide, visibility
 * ============================================================ */
import React, { useEffect, useMemo, useRef, useState } from 'react'

export default function ColumnVisibilityMenu({ allColumns, selected, onApply }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(selected)
  const [search, setSearch] = useState('')
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setPending(selected)
    setSearch('')
  }, [open, selected])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        setOpen(false)
      }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allColumns
    return allColumns.filter((name) => name.toLowerCase().includes(q))
  }, [allColumns, search])

  const filteredSelectedCount = filtered.filter((c) => pending.includes(c)).length
  const allFilteredSelected = filtered.length > 0 && filteredSelectedCount === filtered.length

  const toggleColumn = (name) => {
    setPending((p) => (p.includes(name) ? p.filter((n) => n !== name) : [...p, name]))
  }

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setPending((p) => p.filter((n) => !filtered.includes(n)))
    } else {
      setPending((p) => Array.from(new Set([...p, ...filtered])))
    }
  }

  const apply = () => {
    // Preserve the original column order from allColumns.
    const ordered = allColumns.filter((name) => pending.includes(name))
    onApply(ordered)
    setOpen(false)
  }

  const cancel = () => {
    setOpen(false)
  }

  return (
    <div className="ax-colvis-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="ax-colvis-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {selected.length} of {allColumns.length} columns
        <Chevron open={open} />
      </button>

      {open && (
        <div ref={menuRef} className="ax-colvis-menu" role="dialog">
          <div className="ax-colvis-search">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="6" cy="6" r="4" />
              <path d="M9 9L12 12" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search columns…"
              autoFocus
            />
          </div>
          <div className="ax-colvis-summary">
            <label className="ax-colvis-row">
              <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} />
              <span>Select all{search ? ` (${filtered.length})` : ''}</span>
            </label>
            <span className="ax-colvis-count">
              {pending.length} of {allColumns.length} selected
            </span>
          </div>
          <div className="ax-colvis-list">
            {filtered.length === 0 && (
              <p className="ax-colvis-empty">No columns match "{search}"</p>
            )}
            {filtered.map((name) => (
              <label key={name} className="ax-colvis-row">
                <input
                  type="checkbox"
                  checked={pending.includes(name)}
                  onChange={() => toggleColumn(name)}
                />
                <span title={name}>{name}</span>
              </label>
            ))}
          </div>
          <div className="ax-colvis-actions">
            <button type="button" className="ax-btn" onClick={cancel}>Cancel</button>
            <button type="button" className="ax-btn prim" onClick={apply}>Apply</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Chevron({ open }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
    >
      <path d="M2 3.5L5 6.5L8 3.5" />
    </svg>
  )
}
