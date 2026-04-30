import React, { createContext, useContext, useEffect, useState } from 'react'

// Theme: 'light' | 'dark' | 'system'. 'system' defers to prefers-color-scheme.
const ThemeCtx = createContext(null)
const STORAGE_KEY = 'ax-theme'

function apply(theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE_KEY) || 'system')

  useEffect(() => {
    apply(theme)
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const toggle = () => setTheme(isDark ? 'light' : 'dark')

  return <ThemeCtx.Provider value={{ theme, isDark, toggle }}>{children}</ThemeCtx.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeCtx)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
