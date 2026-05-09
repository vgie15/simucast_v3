/* ============================================================
 * PAGE: SETTINGS / ACCOUNT
 * Keywords: settings, account, profile, password, theme
 * ============================================================ */
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from './AuthProvider'
import { useDialog } from './DialogProvider'

export default function SettingsPage() {
  const auth = useAuth()
  const dialog = useDialog()
  const navigate = useNavigate()
  const [profile, setProfile] = useState({ full_name: '', email: '' })
  const [profileBusy, setProfileBusy] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [profileMessage, setProfileMessage] = useState({ text: '', danger: false })
  const [passwordMessage, setPasswordMessage] = useState({ text: '', danger: false })
  const [deleteMessage, setDeleteMessage] = useState('')
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' })
  const [deletePassword, setDeletePassword] = useState('')

  useEffect(() => {
    setProfile({
      full_name: auth.session?.full_name || '',
      email: auth.session?.email || '',
    })
  }, [auth.session?.full_name, auth.session?.email])

  const requireAccount = auth.loading ? false : !auth.isAuthenticated

  const saveProfile = async (event) => {
    event.preventDefault()
    setProfileBusy(true)
    setProfileMessage({ text: '', danger: false })
    try {
      const res = await api.accountUpdate({
        full_name: profile.full_name,
        email: profile.email,
      })
      auth.updateSession(res)
      setProfileMessage({ text: 'Profile updated.', danger: false })
    } catch (err) {
      setProfileMessage({ text: err.message || 'Could not update profile.', danger: true })
    } finally {
      setProfileBusy(false)
    }
  }

  const changePassword = async (event) => {
    event.preventDefault()
    setPasswordBusy(true)
    setPasswordMessage({ text: '', danger: false })
    try {
      if (passwords.next !== passwords.confirm) throw new Error('New passwords do not match.')
      await api.accountChangePassword({
        current_password: passwords.current,
        new_password: passwords.next,
      })
      setPasswords({ current: '', next: '', confirm: '' })
      setPasswordMessage({ text: 'Password changed.', danger: false })
    } catch (err) {
      setPasswordMessage({ text: err.message || 'Could not change password.', danger: true })
    } finally {
      setPasswordBusy(false)
    }
  }

  const signOut = async () => {
    await auth.logout()
    await dialog.alert({ title: 'Signed out', message: 'You are now using a fresh guest session.' })
  }

  const deleteAccount = async (event) => {
    event.preventDefault()
    setDeleteMessage('')
    const ok = await dialog.confirm({
      title: 'Delete Account',
      message: 'Delete your account and all projects?',
      details: 'This permanently removes your profile, saved projects, data stages, analysis results, models, AI history, reports, and active sessions.',
      affectedItems: ['Account profile', 'Projects and uploaded datasets', 'Analysis, models, reports, and AI history'],
      confirmLabel: 'Delete Account',
      cancelLabel: 'Cancel',
      requireText: 'DELETE',
      variant: 'danger',
    })
    if (!ok) return
    setDeleteBusy(true)
    try {
      await api.accountDelete(deletePassword)
      api.setSessionToken('')
      setDeletePassword('')
      await auth.resetGuestSession()
      navigate('/dashboard', { replace: true })
      await dialog.alert({ title: 'Account deleted', message: 'Your account and saved work were removed.' })
    } catch (err) {
      setDeleteMessage(err.message || 'Could not delete account.')
    } finally {
      setDeleteBusy(false)
    }
  }

  if (auth.loading) {
    return <p className="ax-page-sub">Loading account settings...</p>
  }

  if (requireAccount) {
    return (
      <div className="ax-settings-page">
        <h1 className="ax-page-title">Settings</h1>
        <p className="ax-page-sub">Account settings require a saved account.</p>
        <div className="ax-card ax-settings-card">
          <p className="ax-settings-copy">Create an account or log in to manage profile details, passwords, sign out, and account deletion.</p>
          <div className="ax-settings-actions">
            <button type="button" className="ax-btn prim" onClick={() => auth.showAuthModal('signup')}>Create account</button>
            <button type="button" className="ax-btn" onClick={() => auth.showAuthModal('login')}>Log in</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="ax-settings-page">
      <div className="ax-settings-head">
        <div>
          <h1 className="ax-page-title">Settings</h1>
          <p className="ax-page-sub">Manage your SimuCast account and access.</p>
        </div>
      </div>

      <div className="ax-settings-grid">
        <form className="ax-card ax-settings-card" onSubmit={saveProfile}>
          <div className="ax-settings-card-head">
            <h2>Profile</h2>
            <p>Name and email used for your saved projects.</p>
          </div>
          <label className="ax-field">
            <span>Profile name</span>
            <input
              value={profile.full_name}
              onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
              placeholder="Your name"
              disabled={profileBusy}
            />
          </label>
          <label className="ax-field">
            <span>Email</span>
            <input
              type="email"
              value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              placeholder="you@example.com"
              disabled={profileBusy}
              required
            />
          </label>
          <SettingsMessage text={profileMessage.text} danger={profileMessage.danger} />
          <div className="ax-settings-actions">
            <button type="submit" className="ax-btn prim" disabled={profileBusy}>
              {profileBusy ? 'Saving...' : 'Save profile'}
            </button>
          </div>
        </form>

        <form className="ax-card ax-settings-card" onSubmit={changePassword}>
          <div className="ax-settings-card-head">
            <h2>Change Password</h2>
            <p>Update the password for this account.</p>
          </div>
          <label className="ax-field">
            <span>Current password</span>
            <input
              type="password"
              value={passwords.current}
              onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
              disabled={passwordBusy}
              required
            />
          </label>
          <label className="ax-field">
            <span>New password</span>
            <input
              type="password"
              value={passwords.next}
              onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
              minLength={8}
              disabled={passwordBusy}
              required
            />
          </label>
          <label className="ax-field">
            <span>Confirm new password</span>
            <input
              type="password"
              value={passwords.confirm}
              onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
              minLength={8}
              disabled={passwordBusy}
              required
            />
          </label>
          <SettingsMessage text={passwordMessage.text} danger={passwordMessage.danger} />
          <div className="ax-settings-actions">
            <button type="submit" className="ax-btn prim" disabled={passwordBusy}>
              {passwordBusy ? 'Changing...' : 'Change password'}
            </button>
          </div>
        </form>

        <section className="ax-card ax-settings-card">
          <div className="ax-settings-card-head">
            <h2>Sign Out</h2>
            <p>End this device session and return to guest mode.</p>
          </div>
          <div className="ax-settings-account">
            <span className="ax-avatar">{(auth.session?.email || 'U').slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{auth.session?.full_name || auth.session?.email}</strong>
              <span>{auth.session?.email}</span>
            </div>
          </div>
          <div className="ax-settings-actions">
            <button type="button" className="ax-btn" onClick={signOut}>Sign out</button>
          </div>
        </section>

        <form className="ax-card ax-settings-card danger" onSubmit={deleteAccount}>
          <div className="ax-settings-card-head">
            <h2>Delete Account</h2>
            <p>Permanently remove your account and saved project data.</p>
          </div>
          <label className="ax-field">
            <span>Confirm password</span>
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              disabled={deleteBusy}
              required
            />
          </label>
          <SettingsMessage text={deleteMessage} danger />
          <div className="ax-settings-actions">
            <button type="submit" className="ax-btn danger-fill" disabled={deleteBusy}>
              {deleteBusy ? 'Deleting...' : 'Delete account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function SettingsMessage({ text, danger = false }) {
  if (!text) return null
  return <p className={`ax-settings-message ${danger ? 'danger' : ''}`}>{text}</p>
}
