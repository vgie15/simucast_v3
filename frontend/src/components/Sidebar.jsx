import React, { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useTheme } from '../theme'

const NAV = [
  {
    to: '/',
    label: 'Dashboard',
    icon: (
      <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" stroke="currentColor" strokeWidth="1.5" fill="none" />
    ),
  },
  {
    to: '/projects',
    label: 'Projects',
    icon: (
      <path d="M3 6l2-2h5l2 2h8a1 1 0 011 1v12a1 1 0 01-1 1H3a1 1 0 01-1-1V7a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" fill="none" />
    ),
  },
  {
    to: '/files',
    label: 'Files',
    icon: (
      <path d="M6 2h8l5 5v13a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z M14 2v5h5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    ),
  },
]

const MIN_W = 180
const MAX_W = 420
const DEFAULT_W = 220
const STORAGE_KEY = 'ax-sidebar-w'

export default function Sidebar() {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(STORAGE_KEY))
    return Number.isFinite(stored) && stored >= MIN_W && stored <= MAX_W ? stored : DEFAULT_W
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const asideRef = useRef(null)
  const profileRef = useRef(null)
  const { isDark, toggle } = useTheme()

  useEffect(() => {
    if (!dragging) return
    const onMove = (e) => {
      const next = Math.min(MAX_W, Math.max(MIN_W, e.clientX))
      setWidth(next)
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [dragging])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(width))
  }, [width])

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  const handleSettings = useCallback(() => {
    setMenuOpen(false)
    alert('Settings — coming soon')
  }, [])

  const handleLogout = useCallback(() => {
    setMenuOpen(false)
    alert('Log out — not implemented yet')
  }, [])

  return (
    <aside ref={asideRef} className="ax-sidebar" style={{ width }}>
      <div className="ax-sidebar-body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 16px' }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              background: 'var(--color-text-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 9.5L6 2.5L10 9.5M3.8 7H8.2"
                stroke="var(--color-background-primary)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span style={{ fontWeight: 500, fontSize: 15 }}>SimuCast</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `ax-nav ${isActive ? 'active' : ''}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                {item.icon}
              </svg>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </div>

      <div className="ax-profile" ref={profileRef}>
        {menuOpen && (
          <div className="ax-popover" role="menu">
            <button className="ax-popover-item" onClick={toggle} role="menuitem">
              <span>Dark mode</span>
              <span className={`ax-switch ${isDark ? 'on' : ''}`} aria-hidden />
            </button>
            <button className="ax-popover-item" onClick={handleSettings} role="menuitem">
              Settings
            </button>
            <button
              className="ax-popover-item"
              onClick={handleLogout}
              role="menuitem"
              style={{ color: 'var(--color-text-danger)' }}
            >
              Log out
            </button>
          </div>
        )}
        <button className="ax-profile-btn" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
          <span className="ax-avatar">JM</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Jerome
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--color-text-tertiary)' }}>
            <path d="M8 10l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div
        className={`ax-sidebar-resize ${dragging ? 'dragging' : ''}`}
        onMouseDown={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        role="separator"
        aria-label="Resize sidebar"
      />
    </aside>
  )
}
