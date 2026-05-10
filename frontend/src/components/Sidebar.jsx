/* ============================================================
 * COMPONENT: SIDEBAR NAVIGATION
 * Keywords: sidebar, navigation, menu, links
 * ============================================================ */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useTheme } from '../theme'
import { useDialog } from './DialogProvider'
import { useAuth } from './AuthProvider'

const NAV = [
  {
    to: '/dashboard',
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

// Resizable left navigation sidebar showing primary nav links, theme toggle, and the user profile menu.
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
  const dialog = useDialog()
  const auth = useAuth()
  const navigate = useNavigate()

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
    navigate('/settings')
  }, [navigate])

  const handleLogout = useCallback(async () => {
    setMenuOpen(false)
    await auth.logout()
    await dialog.alert({ title: 'Logged Out', message: 'You are now using a fresh guest session.' })
  }, [auth, dialog])

  const handleLogin = useCallback(() => {
    setMenuOpen(false)
    auth.showAuthModal('login')
  }, [auth])

  const handleSignup = useCallback(() => {
    setMenuOpen(false)
    auth.showAuthModal('signup')
  }, [auth])

  const profileName = auth.isAuthenticated ? auth.session?.email : 'Guest Session'
  const avatarText = auth.isAuthenticated
    ? (auth.session?.email || 'U').slice(0, 2).toUpperCase()
    : 'G'

  return (
    <aside ref={asideRef} className="ax-sidebar" style={{ width }}>
      <div className="ax-sidebar-body">
        <Link className="ax-brand ax-brand-link" to="/">
          <div className="ax-brand-mark">
            <img src="/simucast-logo.png" alt="SimuCast logo" />
          </div>
          <div>
            <p style={{ fontWeight: 800, fontSize: 20, margin: 0, lineHeight: 1.1 }}>SimuCast</p>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '3px 0 0' }}>Predictive Analytics</p>
          </div>
        </Link>

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
            {auth.isGuest ? (
              <>
                <button className="ax-popover-item" onClick={handleLogin} role="menuitem">Log in</button>
                <button className="ax-popover-item" onClick={handleSignup} role="menuitem">Create account</button>
              </>
            ) : (
              <button
                className="ax-popover-item"
                onClick={handleLogout}
                role="menuitem"
                style={{ color: 'var(--color-text-danger)' }}
              >
                Log out
              </button>
            )}
          </div>
        )}
        <button className="ax-profile-btn" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
          <span className="ax-avatar">{avatarText}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {profileName}
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
