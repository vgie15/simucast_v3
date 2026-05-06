import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

  const signup = useCallback(async (email, password, fullName = '') => {
    const r = await api.authSignup(email, password, fullName)
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

  const resetGuestSession = useCallback(async () => {
    api.setSessionToken('')
    const r = await api.authGuest()
    saveSession(r)
    return r.session
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
    resetGuestSession,
    updateSession: saveSession,
    showAuthModal: (mode = 'login') => setModalMode(mode),
  }), [session, loading, login, signup, logout, ensureGuest, resetGuestSession, saveSession])

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
  const navigate = useNavigate()
  const [mode, setMode] = useState(initialMode === 'signup' ? 'signup' : 'login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [transferred, setTransferred] = useState(false)

  const wasGuest = auth.isGuest

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'signup') {
        if (password !== confirmPassword) throw new Error('passwords do not match')
        await auth.signup(email, password, fullName)
        if (wasGuest) {
          setTransferred(true)
          setTimeout(() => { onClose(); navigate('/dashboard') }, 2000)
          return
        }
      } else {
        await auth.login(email, password)
      }
    } catch (err) {
      setError(err.message || 'Could not continue')
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (nextMode) => {
    setMode(nextMode)
    setError('')
  }

  const continueGuest = async () => {
    setBusy(true)
    setError('')
    try {
      if (!auth.isGuest) await auth.ensureGuest()
      onClose()
      navigate('/dashboard')
    } catch (err) {
      setError(err.message || 'Could not continue as guest')
    } finally {
      setBusy(false)
    }
  }

  if (transferred) {
    return (
      <div className="ax-dialog-backdrop" role="presentation">
        <div className="ax-auth-modal" style={{ textAlign: 'center', padding: '40px 32px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 8px' }}>Account created!</h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0 }}>
            Your guest session and projects have been saved to your new account.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="ax-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="ax-auth-modal" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <div className="ax-auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} type="button" onClick={() => switchMode('login')}>
            Login
          </button>
          <button className={mode === 'signup' ? 'active' : ''} type="button" onClick={() => switchMode('signup')}>
            Sign Up
          </button>
          <button className="ax-auth-close" type="button" onClick={onClose} aria-label="Close login modal">
            <span />
            <span />
          </button>
        </div>
        <div className="ax-dialog-body">
          <h2 className="ax-auth-title">{mode === 'signup' ? 'Create Account' : 'Welcome Back'}</h2>
          <p className="ax-auth-subtitle">
            {mode === 'signup'
              ? 'Sign up to save your projects, scenarios, and documentation.'
              : 'Sign in to access your saved scenarios and analysis.'}
          </p>
          {mode === 'signup' && wasGuest && (
            <div className="ax-auth-guest-notice">
              <span>✓</span>
              <span>Your guest session and any projects you&apos;ve created will be saved to your new account.</span>
            </div>
          )}
          {mode === 'signup' && (
            <label className="ax-field ax-auth-field">
              <span>Full Name</span>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe"
                autoFocus
                required
              />
            </label>
          )}
          <label className="ax-field ax-auth-field">
            <span>Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@example.com"
              autoFocus={mode === 'login'}
              required
            />
          </label>
          <label className="ax-field ax-auth-field">
            <span>Password</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="At least 8 characters"
              minLength={8}
              required
            />
          </label>
          {mode === 'signup' && (
            <label className="ax-field ax-auth-field">
              <span>Confirm Password</span>
              <input
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                type="password"
                placeholder="Re-enter password"
                minLength={8}
                required
              />
            </label>
          )}
          {mode === 'login' && (
            <label className="ax-auth-remember">
              <input type="checkbox" />
              <span>Remember me</span>
            </label>
          )}
          {error && <p className="ax-auth-error">{error}</p>}
        </div>
        <div className="ax-auth-actions">
          <button className="ax-btn prim ax-auth-submit" type="submit" disabled={busy}>
            {busy ? 'Working...' : mode === 'signup' ? 'Create Account' : 'Sign In'}
          </button>
          <div className="ax-auth-divider"><span>OR</span></div>
          <button className="ax-btn ax-auth-guest" type="button" onClick={continueGuest} disabled={busy}>
            Continue as Guest
          </button>
          <p>
            {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button type="button" onClick={() => switchMode(mode === 'signup' ? 'login' : 'signup')}>
              {mode === 'signup' ? 'Login' : 'Sign up'}
            </button>
          </p>
        </div>
      </form>
    </div>
  )
}
