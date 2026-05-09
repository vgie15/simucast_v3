/* ============================================================
 * CONTEXT: AUTHENTICATION STATE
 * Keywords: auth, login, logout, signup, guest, session, account
 * ============================================================ */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

const AuthContext = createContext(null)

// Browser/device-level flag that a guest project slot was already consumed.
// Never cleared by delete, signup, login, migration, or logout.
const GUEST_SLOT_KEY = 'simucast.guestSlot.used'

function isGuestSlotUsed() {
  return localStorage.getItem(GUEST_SLOT_KEY) === '1'
}

export function markGuestSlotUsed() {
  localStorage.setItem(GUEST_SLOT_KEY, '1')
}

export function AuthProvider({ children }) {
  const navigate = useNavigate()
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [modalMode, setModalMode] = useState(null)

  const clearProjectState = useCallback(() => {
    window.sessionStorage.removeItem('simucast.fixTarget')
    for (const store of [window.localStorage, window.sessionStorage]) {
      const keys = []
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i)
        if (
          key?.startsWith('simucast.aiPlan.') ||
          key?.startsWith('simucast.aiPlan.done.') ||
          key?.startsWith('simucast.aiPlan.collapsed.') ||
          key?.startsWith('simucast.aiPlan.mode.') ||
          key?.startsWith('simucast.aiPlan.skipped.') ||
          key?.startsWith('simucast.activeProject') ||
          key?.startsWith('simucast.selectedProject') ||
          key?.startsWith('simucast.currentDataset')
        ) {
          keys.push(key)
        }
      }
      keys.forEach((key) => store.removeItem(key))
    }
  }, [])

  const saveSession = useCallback((payload) => {
    const next = payload?.session || payload
    setSession((current) => {
      if (!next) {
        api.setSessionToken('')
        return null
      }
      const sameSession = !!current && (!next.token || current.token === next.token)
      const merged = sameSession
        ? {
            ...current,
            ...next,
            token: next.token || current.token,
            user_id: next.user_id ?? current.user_id,
            email: next.email ?? current.email,
            full_name: next.full_name ?? current.full_name,
          }
        : next
      api.setSessionToken(merged?.token || '')
      // Sync localStorage slot flag from backend usage_count
      if (merged?.is_guest && (merged?.usage_count ?? 0) >= 1) {
        markGuestSlotUsed()
      }
      return merged || null
    })
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
    clearProjectState()
    saveSession(r)
    try {
      const me = await api.authMe()
      saveSession(me)
    } catch { /* returned login session is enough */ }
    window.dispatchEvent(new CustomEvent('simucast-auth-changed'))
    setModalMode(null)
    return r.session
  }, [clearProjectState, saveSession])

  const signup = useCallback(async (email, password, fullName = '') => {
    const r = await api.authSignup(email, password, fullName)
    clearProjectState()
    saveSession(r)
    try {
      const me = await api.authMe()
      saveSession(me)
    } catch { /* returned signup session is enough */ }
    window.dispatchEvent(new CustomEvent('simucast-auth-changed'))
    setModalMode(null)
    return r.session
  }, [clearProjectState, saveSession])

  const logout = useCallback(async () => {
    try {
      await api.authLogout()
    } finally {
      api.setSessionToken('')
      setSession(null)
      clearProjectState()
      const guest = await api.authGuest()
      saveSession(guest)
      window.dispatchEvent(new CustomEvent('simucast-auth-changed'))
      navigate('/dashboard', { replace: true })
    }
  }, [clearProjectState, navigate, saveSession])

  const resetGuestSession = useCallback(async () => {
    api.setSessionToken('')
    clearProjectState()
    const r = await api.authGuest()
    saveSession(r)
    return r.session
  }, [clearProjectState, saveSession])

  const refreshSession = useCallback(async () => {
    try {
      const r = await api.authMe()
      if (r?.session) saveSession(r)
    } catch { /* ignore — stale session stays */ }
  }, [saveSession])

  const value = useMemo(() => ({
    session,
    loading,
    isGuest: !!session?.is_guest,
    isAuthenticated: !!session && !session.is_guest,
    // true when guest has EVER created a project — based on backend count OR persistent localStorage flag.
    // Deleting the project does NOT reset this — the slot is consumed permanently.
    guestAtLimit: !!session?.is_guest && (
      (session?.usage_count ?? 0) >= (session?.limit ?? 1) ||
      isGuestSlotUsed()
    ),
    login,
    signup,
    logout,
    ensureGuest,
    resetGuestSession,
    refreshSession,
    updateSession: saveSession,
    showAuthModal: (mode = 'login') => setModalMode(mode),
    requireAccountForAI: () => setModalMode('ai'),
    requireAccountForReports: () => setModalMode('report'),
  }), [session, loading, login, signup, logout, ensureGuest, resetGuestSession, refreshSession, saveSession])

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
  const isAIPrompt = initialMode === 'ai'
  const isReportPrompt = initialMode === 'report'

  const wasGuest = auth.isGuest
  const hasGuestData = auth.guestAtLimit

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'signup') {
        if (password !== confirmPassword) throw new Error('passwords do not match')
        await auth.signup(email, password, fullName)
      } else {
        await auth.login(email, password)
      }
      onClose()
      navigate('/dashboard', { replace: true })
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
            {isAIPrompt
              ? 'Create an account or log in to use AI recommendations, explanations, and guided insights.'
              : isReportPrompt
                ? 'Create an account to generate and save reports.'
              : mode === 'signup'
                ? 'Sign up to create saved projects. Guest demo projects stay temporary and are not transferred.'
                : 'Sign in to access your saved scenarios and analysis.'}
          </p>
          {isReportPrompt && (
            <div className="ax-auth-guest-notice">
              <span>!</span>
              <span>Report generation and export require an account. Guest projects remain temporary.</span>
            </div>
          )}
          {isAIPrompt && (
            <div className="ax-auth-guest-notice">
              <span>!</span>
              <span>AI features require an account.</span>
            </div>
          )}
          {mode === 'signup' && wasGuest && hasGuestData && (
            <div className="ax-auth-guest-notice">
              <span>!</span>
              <span>Guest demo projects are temporary and will not be moved into your account.</span>
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
            {isAIPrompt ? 'Continue without AI' : isReportPrompt ? 'Continue without report' : 'Continue as Guest'}
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
