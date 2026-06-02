/* ============================================================
 * COMPONENT: FLOATING AI CHAT WIDGET
 * Keywords: ai, chat, assistant, floating, claude, conversation
 * ============================================================ */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from './AuthProvider'

const TAB_LABELS = {
  data: 'Data',
  expand: 'Expand',
  describe: 'Describe',
  tests: 'Analysis',
  models: 'Models',
  whatif: 'What-if',
  report: 'Report',
}

// Floating chat widget that lets authenticated users ask AI about the active project.
export default function FloatingAIAssistant() {
  const auth = useAuth()
  const location = useLocation()
  const projectContext = useMemo(() => getProjectContext(location.pathname), [location.pathname])
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  const datasetId = projectContext?.datasetId
  const activeTab = projectContext?.tab || 'data'
  const hasProject = Boolean(datasetId)
  const canUseAI = hasProject && auth.isAuthenticated && !auth.loading

  useEffect(() => {
    setError('')
    setMessages([])
    setInput('')
    if (!datasetId || !auth.isAuthenticated || auth.loading) return

    let cancelled = false
    setLoading(true)
    api.aiChatHistory(datasetId)
      .then((res) => {
        if (!cancelled) setMessages(Array.isArray(res.messages) ? res.messages : [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load the assistant.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [datasetId, auth.isAuthenticated, auth.loading])

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length, sending, open])

  useEffect(() => {
    if (!inputRef.current) return
    inputRef.current.style.height = 'auto'
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 132)}px`
  }, [input])

  useEffect(() => {
    const handleOpenAi = (e) => {
      if (auth.loading) return
      if (!auth.isAuthenticated) {
        auth.requireAccountForAI()
        return
      }
      setOpen(true)
      const prompt = e?.detail?.prompt
      if (prompt && typeof prompt === 'string') {
        setInput(prompt)
      }
    }
    window.addEventListener('simucast:open-ai', handleOpenAi)
    return () => window.removeEventListener('simucast:open-ai', handleOpenAi)
  }, [auth])

  const openAssistant = () => {
    if (auth.loading) return
    if (!auth.isAuthenticated) {
      auth.requireAccountForAI()
      return
    }
    setOpen(true)
  }

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || sending) return
    if (!auth.isAuthenticated) {
      auth.requireAccountForAI()
      return
    }
    if (!datasetId) {
      setError('Open a project to ask the assistant about your data.')
      return
    }

    const optimistic = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }

    setInput('')
    setError('')
    setSending(true)
    setMessages((current) => [...current, optimistic])

    try {
      const res = await api.aiChatSend(datasetId, text, activeTab)
      setMessages((current) => [
        ...current.filter((message) => message.id !== optimistic.id),
        ...(res.user ? [res.user] : [optimistic]),
        ...(res.assistant ? [res.assistant] : []),
      ])
    } catch (err) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id))
      setInput(text)
      setError(err.message || 'The assistant could not reply.')
    } finally {
      setSending(false)
    }
  }

  const clearConversation = async () => {
    if (!datasetId || !messages.length || sending) return
    if (!window.confirm('Clear this project assistant conversation?')) return
    setError('')
    try {
      await api.aiChatClear(datasetId)
      setMessages([])
    } catch (err) {
      setError(err.message || 'Could not clear the conversation.')
    }
  }

  const title = hasProject ? `Project assistant · ${TAB_LABELS[activeTab] || activeTab}` : 'Project assistant'
  const status = getStatus({ auth, hasProject, loading, sending })

  return (
    <div className={`ax-floating-ai ${open ? 'open' : ''}`}>
      {open && (
        <section className="ax-floating-ai-panel" aria-label="Floating AI assistant">
          <header className="ax-floating-ai-header">
            <div className="ax-floating-ai-title">
              <span className="ax-floating-ai-mark" aria-hidden><SparkIcon /></span>
              <div>
                <h2>{title}</h2>
                <p>{status}</p>
              </div>
            </div>
            <div className="ax-floating-ai-actions">
              {messages.length > 0 && (
                <button type="button" onClick={clearConversation} disabled={sending} title="Clear conversation">
                  <TrashIcon />
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} title="Minimize assistant" aria-label="Minimize assistant">
                <CloseIcon />
              </button>
            </div>
          </header>

          <div className="ax-floating-ai-messages" ref={scrollRef}>
            {loading && <p className="ax-floating-ai-note">Loading conversation...</p>}

            {!loading && messages.length === 0 && (
              <WelcomeMessage auth={auth} hasProject={hasProject} activeTab={activeTab} />
            )}

            {messages.map((message, index) => (
              <MessageBubble
                key={message.id || `${message.role}-${index}`}
                message={message}
                compact={messages[index - 1]?.role === message.role}
              />
            ))}

            {sending && (
              <div className="ax-floating-ai-message assistant">
                <span className="ax-floating-ai-avatar" aria-hidden><SparkIcon /></span>
                <div className="ax-floating-ai-bubble typing" aria-label="Assistant is typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          {error && <p className="ax-floating-ai-error">{error}</p>}

          <footer className="ax-floating-ai-compose">
            <div className="ax-floating-ai-input">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                placeholder={getPlaceholder({ auth, hasProject })}
                disabled={sending || !auth.isAuthenticated || auth.loading}
                onChange={(event) => setInput(event.target.value)}
                onFocus={() => {
                  if (!auth.loading && !auth.isAuthenticated) auth.requireAccountForAI()
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    sendMessage()
                  }
                }}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!input.trim() || sending || !canUseAI}
                aria-label="Send message"
                title="Send message"
              >
                <SendIcon />
              </button>
            </div>
          </footer>
        </section>
      )}

      {!open && (
        <button
          type="button"
          className="ax-floating-ai-launcher"
          onClick={openAssistant}
          aria-label="Open AI assistant"
          title={!auth.isAuthenticated ? 'AI requires an account' : 'Open AI assistant'}
        >
          <SparkIcon />
          <span>{hasProject ? 'Ask AI' : 'AI'}</span>
        </button>
      )}
    </div>
  )
}

// Renders the initial assistant welcome message tailored to auth and project state.
function WelcomeMessage({ auth, hasProject, activeTab }) {
  let copy = `Ask me about this ${TAB_LABELS[activeTab] || activeTab} step. I can help interpret results, suggest the next move, or sanity-check your workflow.`
  if (auth.loading) copy = 'Checking your account before starting AI chat.'
  else if (!auth.isAuthenticated) copy = 'AI chat requires an account. Sign up or log in to use the assistant.'
  else if (!hasProject) copy = 'Open a project and I can help with the dataset, analysis, models, and report.'

  return (
    <div className="ax-floating-ai-welcome">
      <span aria-hidden><SparkIcon /></span>
      <p>{copy}</p>
    </div>
  )
}

// Renders a single chat message bubble with optional avatar and timestamp.
function MessageBubble({ message, compact }) {
  const role = message.role === 'user' ? 'user' : 'assistant'
  return (
    <div className={`ax-floating-ai-message ${role} ${compact ? 'compact' : ''}`}>
      {!compact && (
        <span className="ax-floating-ai-avatar" aria-hidden>
          {role === 'user' ? <UserIcon /> : <SparkIcon />}
        </span>
      )}
      {compact && <span className="ax-floating-ai-avatar-spacer" aria-hidden />}
      <div className="ax-floating-ai-bubble-wrap">
        <div className="ax-floating-ai-bubble">{message.content}</div>
        {message.created_at && <time>{formatTime(message.created_at)}</time>}
      </div>
    </div>
  )
}

// Extracts the dataset id and tab from a project route pathname.
function getProjectContext(pathname) {
  const match = pathname.match(/^\/projects\/([^/]+)(?:\/([^/]+))?/)
  if (!match) return null
  const tab = match[2] === 'clean' ? 'data' : match[2] === 'advanced' ? 'tests' : match[2] || 'data'
  return { datasetId: decodeURIComponent(match[1]), tab }
}

// Returns the assistant header status string based on auth and request state.
function getStatus({ auth, hasProject, loading, sending }) {
  if (auth.loading) return 'Checking account'
  if (!auth.isAuthenticated) return 'Account required'
  if (!hasProject) return 'Open a project to start'
  if (loading) return 'Loading context'
  if (sending) return 'Thinking'
  return 'Ready with project context'
}

// Picks the chat input placeholder text based on auth and project availability.
function getPlaceholder({ auth, hasProject }) {
  if (auth.loading) return 'Checking account...'
  if (!auth.isAuthenticated) return 'AI chat requires an account...'
  if (!hasProject) return 'Open a project to ask about your data...'
  return 'Ask about this project...'
}

// Formats an ISO timestamp into a short locale time string for chat bubbles.
function formatTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Renders the small sparkle SVG icon used for the assistant avatar.
function SparkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.2l1.5 4.7 4.9 1.1-4.3 2.4L8 14.8 5.9 9.4 1.6 7l4.9-1.1L8 1.2z" />
    </svg>
  )
}

// Renders the paper-plane send button icon for the chat input.
function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 2.4l12 5.6-12 5.6 1.8-5.1 5.8-.5-5.8-.5L2 2.4z" />
    </svg>
  )
}

// Renders the X close icon used in the assistant header.
function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}

// Renders the trash can icon used to clear the chat history.
function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 6v7h6V6" />
    </svg>
  )
}

// Renders the user avatar icon shown beside user chat messages.
function UserIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="8" cy="5" r="2.6" />
      <path d="M3 14c.4-3 2.4-4.7 5-4.7s4.6 1.7 5 4.7H3z" />
    </svg>
  )
}
