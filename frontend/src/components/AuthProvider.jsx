import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [modalMode, setModalMode] = useState(null)

  const saveSession = useCallback((payload) => {
    const next = payload?.session || payload
    setSession(next || null)
    api.setSessionToken(next?.token || '')
  }, [])

  const ensureGuest = useCallback(async () => {
    const r = await api.authGuest()
    saveSession(r)
    return r.session
  }, [saveSession])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const token = api.getSessionToken()
        const r = token ? await api.authMe() : await api.authGuest()
        if (!cancelled) saveSession(r)
      } catch {
        try {
          const r = await api.authGuest()
          if (!cancelled) saveSession(r)
        } catch {
          if (!cancelled) {
            setSession(null)
            api.setSessionToken('')
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [saveSession])

  const login = useCallback(async (email, password) => {
    const r = await api.authLogin(email, password)
    saveSession(r)
    setModalMode(null)
    return r.session
  }, [saveSession])

  const signup = useCallback(async (email, password) => {
    const r = await api.authSignup(email, password)
    saveSession(r)
    setModalMode(null)
    return r.session
  }, [saveSession])

  const logout = useCallback(async () => {
    try {
      await api.authLogout()
    } finally {
      api.setSessionToken('')
      const guest = await api.authGuest()
      saveSession(guest)
    }
  }, [saveSession])

  const value = useMemo(() => ({
    session,
    loading,
    isGuest: !!session?.is_guest,
    isAuthenticated: !!session && !session.is_guest,
    login,
    signup,
    logout,
    ensureGuest,
    updateSession: saveSession,
    showAuthModal: (mode = 'login') => setModalMode(mode),
  }), [session, loading, login, signup, logout, ensureGuest, saveSession])

  return (
    <AuthContext.Provider value={value}>
      {children}
      {modalMode && <AuthModal initialMode={modalMode} onClose={() => setModalMode(null)} />}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

function AuthModal({ initialMode, onClose }) {
  const auth = useAuth()
  const [mode, setMode] = useState(initialMode === 'signup' ? 'signup' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'signup') await auth.signup(email, password)
      else await auth.login(email, password)
    } catch (err) {
      setError(err.message || 'Could not continue')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ax-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="ax-dialog ax-auth-modal" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <div className="ax-dialog-header">
          <div className="ax-dialog-icon" aria-hidden>{mode === 'signup' ? '+' : 'i'}</div>
          <div>
            <h2 className="ax-dialog-title">{mode === 'signup' ? 'Create Account' : 'Log In'}</h2>
            <p className="ax-dialog-details">
              {mode === 'signup'
                ? 'Save projects permanently and continue beyond guest mode.'
                : 'Log in to restore saved projects and continue working.'}
            </p>
          </div>
        </div>
        <div className="ax-dialog-body">
          {auth.isGuest && (
            <div className="ax-dialog-list">
              <p>Guest mode</p>
              <ul>
                <li>{auth.session?.usage_count || 0} of {auth.session?.limit || 1} free model-training run used</li>
                <li>Sign up to keep projects and continue without the guest limit</li>
              </ul>
            </div>
          )}
          <label className="ax-field">
            <span>Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoFocus required />
          </label>
          <label className="ax-field">
            <span>Password</span>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" minLength={8} required />
          </label>
          {error && <p className="ax-dialog-details" style={{ color: 'var(--color-text-danger)' }}>{error}</p>}
        </div>
        <div className="ax-dialog-actions" style={{ justifyContent: 'space-between' }}>
          <button
            className="ax-btn"
            type="button"
            onClick={() => {
              setMode(mode === 'signup' ? 'login' : 'signup')
              setError('')
            }}
          >
            {mode === 'signup' ? 'Use login instead' : 'Create account instead'}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ax-btn" type="button" onClick={onClose}>Cancel</button>
            <button className="ax-btn prim" type="submit" disabled={busy}>
              {busy ? 'Working...' : mode === 'signup' ? 'Create Account' : 'Log In'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
