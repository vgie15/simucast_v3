import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'

export default function AIChatPanel({ datasetId, activeTab }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    if (!datasetId) return
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
  }, [datasetId])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, sending])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
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
    if (!window.confirm('Clear the chat history for this project?')) return
    try {
      await api.aiChatClear(datasetId)
      setMessages([])
    } catch (err) {
      setError(err.message || 'Clear failed')
    }
  }

  return (
    <div className="ax-chat">
      <div className="ax-chat-scroll" ref={scrollRef}>
        {loading && <p className="ax-chat-meta">Loading conversation…</p>}
        {!loading && messages.length === 0 && (
          <p className="ax-chat-meta">
            Ask anything about your dataset — what to clean, what test to run, how to interpret a result.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`ax-chat-msg ${m.role}`}>
            <span className="ax-chat-role">{m.role === 'user' ? 'You' : 'Claude'}</span>
            <div className="ax-chat-bubble">{m.content}</div>
          </div>
        ))}
        {sending && (
          <div className="ax-chat-msg assistant">
            <span className="ax-chat-role">Claude</span>
            <div className="ax-chat-bubble ax-chat-typing">…</div>
          </div>
        )}
      </div>
      {error && <p className="ax-chat-error">{error}</p>}
      <div className="ax-chat-input">
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Message the AI assistant…"
          disabled={sending}
        />
        <div className="ax-chat-input-row">
          <button className="ax-btn mini" onClick={clear} type="button" disabled={!messages.length || sending}>
            Clear
          </button>
          <button className="ax-btn prim mini" onClick={send} type="button" disabled={!input.trim() || sending}>
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
