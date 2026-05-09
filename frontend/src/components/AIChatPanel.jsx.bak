import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useAuth } from './AuthProvider'

export default function AIChatPanel({ datasetId, activeTab }) {
  const auth = useAuth()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    if (!datasetId) return
    if (auth.isGuest) {
      setMessages([])
      setError('AI features require an account.')
      setLoading(false)
      return
    }
    setLoading(true)
    api
      .aiChatHistory(datasetId)
      .then((r) => {
        if (cancelled) return
        setMessages(r.messages || [])
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message || 'Could not load chat history')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [datasetId, auth.isGuest])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, sending])

  const autoResize = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }

  useEffect(() => {
    autoResize()
  }, [input])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    if (auth.isGuest) {
      auth.requireAccountForAI()
      return
    }
    setInput('')
    setError('')
    setSending(true)
    const optimistic = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }
    setMessages((m) => [...m, optimistic])
    try {
      const r = await api.aiChatSend(datasetId, text, activeTab)
      setMessages((m) => {
        const without = m.filter((x) => x.id !== optimistic.id)
        return [...without, r.user, r.assistant]
      })
    } catch (err) {
      setError(err.message || 'Send failed')
      setMessages((m) => m.filter((x) => x.id !== optimistic.id))
      setInput(text)
    } finally {
      setSending(false)
    }
  }

  const clear = async () => {
    if (!messages.length) return
    if (auth.isGuest) {
      auth.requireAccountForAI()
      return
    }
    if (!window.confirm('Clear the chat history for this project?')) return
    try {
      await api.aiChatClear(datasetId)
      setMessages([])
    } catch (err) {
      setError(err.message || 'Clear failed')
    }
  }

  const showWelcome = !loading && messages.length === 0

  return (
    <div className="ax-chat">
      <div className="ax-chat-scroll" ref={scrollRef}>
        {loading && (
          <p className="ax-chat-meta">Loading conversation…</p>
        )}

        {showWelcome && (
          <div className="ax-chat-msg assistant">
            <Avatar role="assistant" />
            <div className="ax-chat-bubble-wrap">
              <div className="ax-chat-bubble">
                Hi! I'm Claude. Ask me anything about your dataset — what to clean, what test to run, how to interpret a result. I have full context of your current data.
              </div>
            </div>
          </div>
        )}

        {messages.map((m, idx) => {
          const prev = messages[idx - 1]
          const showAvatar = !prev || prev.role !== m.role
          return (
            <div key={m.id} className={`ax-chat-msg ${m.role} ${showAvatar ? 'with-avatar' : 'continued'}`}>
              {showAvatar ? <Avatar role={m.role} /> : <span className="ax-chat-avatar-spacer" />}
              <div className="ax-chat-bubble-wrap">
                <div className="ax-chat-bubble">{m.content}</div>
                {m.created_at && <span className="ax-chat-time">{formatTime(m.created_at)}</span>}
              </div>
            </div>
          )
        })}

        {sending && (
          <div className="ax-chat-msg assistant with-avatar">
            <Avatar role="assistant" />
            <div className="ax-chat-bubble-wrap">
              <div className="ax-chat-bubble ax-chat-typing">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>
          </div>
        )}
      </div>

      {error && <p className="ax-chat-error">{error}</p>}

      <div className="ax-chat-input">
        <div className="ax-chat-input-box">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => {
              if (auth.isGuest) auth.requireAccountForAI()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={auth.isGuest ? 'AI chat requires an account…' : 'Message Claude…'}
            disabled={sending}
          />
          <button
            className="ax-chat-send"
            onClick={send}
            type="button"
            disabled={!input.trim() || sending}
            aria-label="Send message"
            title={auth.isGuest ? 'AI features require an account.' : 'Send (Enter)'}
          >
            <SendIcon />
          </button>
        </div>
        {messages.length > 0 && (
          <button
            className="ax-chat-clear"
            onClick={clear}
            type="button"
            disabled={sending}
          >
            Clear conversation
          </button>
        )}
      </div>
    </div>
  )
}

function Avatar({ role }) {
  if (role === 'user') {
    return (
      <span className="ax-chat-avatar user" aria-hidden>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <circle cx="7" cy="4.5" r="2.4" />
          <path d="M2 12c0-2.5 2.2-4 5-4s5 1.5 5 4v1H2v-1z" />
        </svg>
      </span>
    )
  }
  return (
    <span className="ax-chat-avatar assistant" aria-hidden>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
        <path d="M7 1L8.3 5.1L12.5 6L8.3 8.2L7 13L5.7 8.2L1.5 6L5.7 5.1L7 1Z" />
      </svg>
    </span>
  )
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 2L14 8L2 14L4 8L2 2Z" />
    </svg>
  )
}

function formatTime(iso) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const now = new Date()
    const sameDay = d.toDateString() === now.toDateString()
    const hh = d.getHours().toString().padStart(2, '0')
    const mm = d.getMinutes().toString().padStart(2, '0')
    if (sameDay) return `${hh}:${mm}`
    const month = d.toLocaleString(undefined, { month: 'short' })
    return `${month} ${d.getDate()}, ${hh}:${mm}`
  } catch {
    return ''
  }
}
