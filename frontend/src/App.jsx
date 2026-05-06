import React, { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import LandingPage from './components/LandingPage'
import DashboardPage from './components/DashboardPage'
import ProjectsPage from './components/ProjectsPage'
import FilesPage from './components/FilesPage'
import ProjectWorkspace from './components/ProjectWorkspace'
import { DialogProvider } from './components/DialogProvider'
import { AuthProvider, useAuth } from './components/AuthProvider'
import { ThemeProvider } from './theme'

export default function App() {
  return (
    <ThemeProvider>
      <DialogProvider>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </DialogProvider>
    </ThemeProvider>
  )
}

function GuestBanner() {
  const auth = useAuth()
  const [dismissed, setDismissed] = useState(false)
  if (!auth.isGuest || dismissed) return null
  return (
    <div className="ax-guest-banner">
      <span>👤 <strong>Guest Mode</strong> — your projects are temporary. Sign up to save your work permanently.</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button type="button" className="ax-btn-signup" onClick={() => auth.showAuthModal('signup')}>
          Sign up to add more
        </button>
        <button type="button" className="ax-guest-banner-close" onClick={() => setDismissed(true)} aria-label="Dismiss">
          ×
        </button>
      </div>
    </div>
  )
}

function AppRoutes() {
  const location = useLocation()
  const isProjectWorkspace = /^\/projects\/[^/]+/.test(location.pathname)
  if (location.pathname === '/') {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    )
  }
  return (
    <div className="ax-app">
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <GuestBanner />
        <main className={`ax-main${isProjectWorkspace ? ' ax-main-project' : ''}`} style={{ flex: 1 }}>
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<Navigate to="data" replace />} />
            <Route path="/projects/:id/:tab" element={<ProjectWorkspace />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
