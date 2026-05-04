import React from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import LandingPage from './components/LandingPage'
import DashboardPage from './components/DashboardPage'
import ProjectsPage from './components/ProjectsPage'
import FilesPage from './components/FilesPage'
import ProjectWorkspace from './components/ProjectWorkspace'
import { DialogProvider } from './components/DialogProvider'
import { AuthProvider } from './components/AuthProvider'
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

function AppRoutes() {
  const location = useLocation()
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
      <main className="ax-main">
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
  )
}
