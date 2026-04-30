import React from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import DashboardPage from './components/DashboardPage'
import ProjectsPage from './components/ProjectsPage'
import FilesPage from './components/FilesPage'
import ProjectWorkspace from './components/ProjectWorkspace'
import { ThemeProvider } from './theme'

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <div className="ax-app">
          <Sidebar />
          <main className="ax-main">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:id" element={<Navigate to="data" replace />} />
              <Route path="/projects/:id/:tab" element={<ProjectWorkspace />} />
              <Route path="/files" element={<FilesPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </ThemeProvider>
  )
}
