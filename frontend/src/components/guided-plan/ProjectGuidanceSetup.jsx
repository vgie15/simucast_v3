/* ============================================================
 * COMPONENT: PROJECT GUIDANCE SETUP
 * Keywords: onboarding, question, guided workflow, coach
 * ============================================================ */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BarChart3, ChevronDown, GitBranch, Lightbulb, LineChart, Send, SlidersHorizontal, Sparkles } from 'lucide-react'
import { api } from '../../api'
import { useAuth } from '../providers/AuthProvider'

export const INTENTS = [
  {
    id: 'prepare_data',
    title: 'Clean and prepare data',
    path: ['Inspect data', 'Fix detected issues', 'Keep prepared data'],
  },
  {
    id: 'train_model',
    title: 'Predict an outcome',
    path: ['Prepare data', 'Choose a target', 'Train models'],
  },
  {
    id: 'analyze_relationships',
    title: 'Analyze relationships',
    path: ['Prepare data', 'Summarize variables', 'Check relationships'],
  },
  {
    id: 'compare_models',
    title: 'Compare prediction models',
    path: ['Prepare data', 'Train candidates', 'Compare health and metrics'],
  },
  {
    id: 'what_if',
    title: 'Test a what-if question',
    path: ['Prepare data', 'Train a model', 'Test changed inputs'],
  },
  {
    id: 'report',
    title: 'Create a report',
    path: ['Save useful outputs', 'Review findings', 'Generate report'],
  },
  {
    id: 'full_workflow',
    title: 'Explore patterns and next steps',
    path: ['Prepare data', 'Describe and analyze', 'Model or report'],
  },
]

const GUIDANCE_CHOICES = [
  {
    id: true,
    title: 'Guide me step by step',
    description: 'SimuCast focuses the next required task and explains what unlocks after it.',
  },
  {
    id: false,
    title: 'Let me explore',
    description: 'Keep the Guided Workflow visible while you move through the workspace freely.',
  },
]

const CLEAN_QUESTION = {
  question: 'I just want to clean and prepare this data.',
  intent: 'prepare_data',
  source: 'system',
  why: 'Start with dataset quality before deciding on analysis or modeling.',
}

const AI_QUICK_REPLIES = [
  'I want to predict something',
  'I want to compare groups',
  'I want to find patterns',
  "I'm not sure — help me decide",
]

// Short post-create setup that turns a user question into a supported workflow.
export default function ProjectGuidanceSetup({
  dataset,
  open,
  onClose,
  onSaved,
  allowDismiss = true,
}) {
  const auth = useAuth()
  const current = dataset?.guidance || {}
  const [step, setStep] = useState('question')
  const [guidedMode, setGuidedMode] = useState(Boolean(current.guided_mode))
  const [question, setQuestion] = useState(current.question_text || '')
  const [selected, setSelected] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [suggestionsAI, setSuggestionsAI] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [mappingLoading, setMappingLoading] = useState(false)
  const [mappedIntent, setMappedIntent] = useState('')
  const [closestIntents, setClosestIntents] = useState([])
  const [intentChoiceOpen, setIntentChoiceOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantMessages, setAssistantMessages] = useState([])
  const [assistantInput, setAssistantInput] = useState('')
  const [assistantLoading, setAssistantLoading] = useState(false)
  const feedRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const restored = current.question_text && current.goal
      ? {
          question: current.question_text,
          intent: current.intent || current.goal,
          source: current.question_source || 'user',
        }
      : null
    setStep('question')
    setGuidedMode(Boolean(current.guided_mode))
    setQuestion(current.question_text || '')
    setSelected(restored)
    setMappedIntent(restored?.intent || '')
    setClosestIntents([])
    setIntentChoiceOpen(false)
    setError('')
    setAssistantOpen(false)
    setAssistantMessages([])
    setAssistantInput('')
    setAssistantLoading(false)
  }, [open, current.goal, current.guided_mode, current.intent, current.question_source, current.question_text])

  useEffect(() => {
    if (!open || !dataset?.id) return
    setSuggestions(systemQuestionSuggestions(dataset))
    setSuggestionsAI(false)
    setAiSuggestions([])
  }, [dataset, open])

  const loadAISuggestions = () => {
    if (!dataset?.id || suggestionsLoading) return
    if (aiSuggestions.length > 0) {
      setSuggestions(aiSuggestions)
      setSuggestionsAI(true)
      return
    }
    setSuggestionsLoading(true)
    api.aiGuidanceQuestions(dataset.id)
      .then((response) => {
        if (!response?.suggestions?.length) return
        const aiList = response.suggestions.map((item) => ({ ...item, source: response.ai ? 'ai' : 'system' }))
        setAiSuggestions(aiList)
        setSuggestions(aiList)
        setSuggestionsAI(Boolean(response.ai))
      })
      .catch(() => {
        setSuggestions(systemQuestionSuggestions(dataset))
        setSuggestionsAI(false)
      })
      .finally(() => {
        setSuggestionsLoading(false)
      })
  }

  const toggleSuggestions = () => {
    if (!assistantOpen) {
      openAssistant()
      loadAISuggestions()
      return
    }
    closeAssistant()
  }

  const closeAssistant = () => {
    setAssistantOpen(false)
    setAssistantMessages([])
    setAssistantInput('')
    setAssistantLoading(false)
    setSuggestions(systemQuestionSuggestions(dataset))
    setSuggestionsAI(false)
  }

  const openAssistant = () => {
    if (assistantOpen) return
    const first = aiSuggestions[0] || suggestions[0] || systemQuestionSuggestions(dataset)[0]
    setAssistantOpen(true)
    setAssistantMessages([
      {
        id: `ai-open-${Date.now()}`,
        role: 'assistant',
        content: "Hi! I looked at your dataset. Here's a goal that fits well based on your columns:",
        suggestions: first ? [goalChatSuggestionFromQuestion(first)] : [],
      },
    ])
  }

  useEffect(() => {
    if (!assistantOpen || !feedRef.current) return
    feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [assistantMessages, assistantLoading, assistantOpen])

  const derivedIntent = useMemo(() => inferIntent(question), [question])
  const supportedIntent = mappedIntent || derivedIntent
  const picked = selected || (supportedIntent ? {
    question: question.trim(),
    intent: supportedIntent,
    source: 'user',
  } : null)
  const selectedIntent = INTENTS.find((item) => item.id === picked?.intent)

  const save = async (body, startTarget = null) => {
    if (!dataset?.id) return
    setBusy(true)
    setError('')
    try {
      const response = await api.updateGuidance(dataset.id, body)
      onSaved?.(response.guidance, startTarget)
      onClose?.()
    } catch (err) {
      setError(err.message || 'Could not save project guidance.')
    } finally {
      setBusy(false)
    }
  }

  const continueWithQuestion = async () => {
    if (selected?.intent || mappedIntent || derivedIntent || !dataset?.id) {
      if (!picked?.intent) {
        setIntentChoiceOpen(true)
        return
      }
      setSelected(picked)
      setIntentChoiceOpen(false)
      setStep('guidance')
      return
    }
    setMappingLoading(true)
    setError('')
    try {
      const response = await api.mapGuidanceQuestion(dataset.id, question.trim())
      if (response?.supported && response.intent) {
        const next = { question: question.trim(), intent: response.intent, source: 'user' }
        setMappedIntent(response.intent)
        setSelected(next)
        setIntentChoiceOpen(false)
        setStep('guidance')
        return
      }
      setClosestIntents(response?.closest_intents || closestIntentChoices(question))
      setIntentChoiceOpen(true)
    } catch {
      setClosestIntents(closestIntentChoices(question))
      setIntentChoiceOpen(true)
    } finally {
      setMappingLoading(false)
    }
  }

  const selectQuestion = (item) => {
    setQuestion(item.question)
    setSelected({
      question: item.question,
      intent: item.intent,
      source: item.source || 'system',
    })
    setMappedIntent(item.intent)
    setClosestIntents([])
    setIntentChoiceOpen(false)
  }

  const useAssistantSuggestion = (item) => {
    selectQuestion({
      question: item.question,
      intent: item.intent || intentFromGoalWorkflow(item.workflow, item.question),
      source: 'ai',
      why: item.why,
    })
  }

  const sendAssistantMessage = async (text = '') => {
    const content = String(text || assistantInput || '').trim()
    if (!content || assistantLoading) return
    const userMessage = { id: `user-${Date.now()}`, role: 'user', content }
    const history = [...assistantMessages, userMessage]
      .filter((message) => ['assistant', 'user'].includes(message.role))
      .map((message) => ({ role: message.role, content: message.content }))
    setAssistantMessages((prev) => [...prev, userMessage])
    setAssistantInput('')
    setAssistantLoading(true)
    try {
      const response = await api.aiGoalSuggest({
        user_message: content,
        columns: (dataset?.variables || []).map((variable) => variable.name).filter(Boolean),
        conversation_history: history,
      })
      setAssistantMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: response?.message || 'Here is a goal SimuCast can help with.',
          suggestions: (response?.suggestions || []).map(normalizeGoalChatSuggestion),
        },
      ])
    } catch {
      const fallback = goalChatFallback(dataset, content)
      setAssistantMessages((prev) => [
        ...prev,
        {
          id: `ai-fallback-${Date.now()}`,
          role: 'assistant',
          content: fallback.message,
          suggestions: fallback.suggestions,
        },
      ])
    } finally {
      setAssistantLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="ax-guidance-backdrop" role="presentation">
      <section className={`ax-guidance-modal ${assistantOpen && step === 'question' ? 'with-assistant' : ''}`} role="dialog" aria-modal="true" aria-label="Choose project guidance">
        <div className="ax-guidance-head">
          <div>
            <p className="ax-kicker">Project start</p>
            <h2>{step === 'question' ? 'What would you like to find out from this dataset?' : 'Would you like SimuCast to guide you step by step?'}</h2>
            <p>
              {step === 'question'
                ? 'Choose a goal below or let the AI suggest one based on your dataset.'
                : 'The Guided Workflow stays visible either way. Guided Mode focuses the next required task when you want supervision.'}
            </p>
          </div>
          {allowDismiss && step === 'question' && (
            <button
              className="ax-btn ghost"
              type="button"
              onClick={() => save({ setup_status: 'dismissed', guided_mode: false })}
              disabled={busy}
            >
              Decide later
            </button>
          )}
        </div>

        {step === 'question' ? (
          <div className="ax-guidance-question-layout">
          <div className="ax-guidance-question-main">
            <div className="ax-question-suggestions-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{suggestionsAI ? 'AI suggested questions' : 'Questions SimuCast can guide'}</strong>
                <span>
                  {suggestionsLoading
                    ? 'Thinking with the current dataset...'
                    : assistantOpen
                      ? 'Pick one below or keep chatting with the assistant.'
                      : 'Pick one below or ask the assistant.'}
                </span>
              </div>
              {!auth.isGuest && (
                <button
                  type="button"
                  className={`ax-btn mini ax-ai-suggest-toggle ${assistantOpen ? 'active' : ''}`}
                  disabled={suggestionsLoading}
                  onClick={toggleSuggestions}
                >
                  {assistantOpen ? (
                    <>
                      <ArrowLeft size={13} />
                      <span>Back to standard</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={12} />
                      <span>Suggest with AI</span>
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="ax-goal-grid">
              {suggestions.slice(0, 4).map((item) => (
                <button
                  key={`${item.intent}:${item.question}`}
                  type="button"
                  className={`ax-goal-card ${picked?.question === item.question ? 'selected' : ''}`}
                  onClick={() => selectQuestion(item)}
                >
                  <GoalCardIcon item={item} />
                  <div>
                    <strong>{item.question}</strong>
                    <span>{item.why || goalLabel(item.intent)}</span>
                  </div>
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`ax-guidance-clean-path ${picked?.question === CLEAN_QUESTION.question ? 'selected' : ''}`}
              onClick={() => selectQuestion(CLEAN_QUESTION)}
            >
              <strong>{CLEAN_QUESTION.question}</strong>
              <span>{CLEAN_QUESTION.why}</span>
            </button>
            {intentChoiceOpen && (
              <div className="ax-guidance-intent-choices">
                <p>That question needs a clearer supported path. Choose the closest one and SimuCast will guide from there.</p>
                <div>
                  {(closestIntents.length ? closestIntents : closestIntentChoices(question)).map((intent) => (
                    <button
                      className="ax-btn mini"
                      key={intent}
                      type="button"
                      onClick={() => {
                        setSelected({ question: question.trim(), intent, source: 'user' })
                        setIntentChoiceOpen(false)
                        setStep('guidance')
                      }}
                    >
                      {goalLabel(intent)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {assistantOpen && (
            <GoalAssistantPanel
              messages={assistantMessages}
              loading={assistantLoading}
              input={assistantInput}
              setInput={setAssistantInput}
              onSend={sendAssistantMessage}
              onUseSuggestion={useAssistantSuggestion}
              feedRef={feedRef}
            />
          )}
          </div>
        ) : (
          <>
            {selectedIntent && <QuestionPathPreview question={picked.question} intent={selectedIntent} />}
            <div className="ax-guidance-choice-grid">
              {GUIDANCE_CHOICES.map((item) => (
                <button
                  key={String(item.id)}
                  type="button"
                  className={`ax-guidance-choice ${guidedMode === item.id ? 'selected' : ''}`}
                  onClick={() => setGuidedMode(item.id)}
                >
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {error && <p className="ax-guidance-error">{error}</p>}

        <footer className="ax-guidance-actions">
          {step === 'guidance' && (
            <button className="ax-btn" type="button" onClick={() => setStep('question')} disabled={busy}>
              Back
            </button>
          )}
          {step === 'question' ? (
            <button className="ax-btn prim" type="button" onClick={continueWithQuestion} disabled={!question.trim() || busy || mappingLoading}>
              {mappingLoading ? 'Checking path...' : 'Continue'}
            </button>
          ) : (
            <button
              className="ax-btn prim"
              type="button"
              disabled={busy || !picked?.intent}
              onClick={() => save({
                goal: picked.intent,
                intent: picked.intent,
                question_text: picked.question,
                question_source: picked.source,
                setup_status: 'completed',
                guided_mode: guidedMode,
                walkthrough_step: guidedMode ? firstCoachStep(picked.intent, dataset)?.id : null,
                dismissed_tips: [],
                completed_tips: [],
              }, firstCoachStep(picked.intent, dataset))}
            >
              {busy ? 'Starting...' : 'Start'}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}

function GoalAssistantPanel({ messages, loading, input, setInput, onSend, onUseSuggestion, feedRef }) {
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(true)
  return (
    <aside className="ax-goal-assistant-panel" aria-label="AI goal assistant">
      <header className="ax-goal-assistant-head">
        <span className="ax-goal-assistant-icon"><Sparkles size={14} /></span>
        <div>
          <strong>AI goal assistant</strong>
          <small>Ask me anything about your goal</small>
        </div>
      </header>
      <div className="ax-goal-assistant-feed" ref={feedRef}>
        {messages.map((message) => (
          <GoalAssistantMessage key={message.id} message={message} onUseSuggestion={onUseSuggestion} />
        ))}
        {loading && (
          <div className="ax-goal-chat-row ai">
            <span className="ax-goal-chat-avatar"><Sparkles size={12} /></span>
            <div className="ax-goal-chat-bubble ai typing" aria-label="AI is typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>
      <div className={`ax-goal-quick-replies ${quickRepliesOpen ? 'open' : 'collapsed'}`}>
        <button
          className="ax-goal-quick-replies-toggle"
          type="button"
          onClick={() => setQuickRepliesOpen((open) => !open)}
          aria-expanded={quickRepliesOpen}
        >
          <span>Quick replies</span>
          <ChevronDown size={14} />
        </button>
        {quickRepliesOpen && (
          <div>
            {AI_QUICK_REPLIES.map((reply) => (
              <button key={reply} type="button" onClick={() => onSend(reply)} disabled={loading}>
                {reply}
              </button>
            ))}
          </div>
        )}
      </div>
      <form
        className="ax-goal-chat-input"
        onSubmit={(event) => {
          event.preventDefault()
          onSend()
        }}
      >
        <textarea
          rows={2}
          value={input}
          placeholder="Ask me anything..."
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onSend()
            }
          }}
        />
        <button type="submit" disabled={!input.trim() || loading} aria-label="Send goal assistant message">
          <Send size={15} />
        </button>
      </form>
    </aside>
  )
}

function GoalAssistantMessage({ message, onUseSuggestion }) {
  const isUser = message.role === 'user'
  return (
    <div className={`ax-goal-chat-row ${isUser ? 'user' : 'ai'}`}>
      {!isUser && <span className="ax-goal-chat-avatar"><Sparkles size={12} /></span>}
      <div className={`ax-goal-chat-bubble ${isUser ? 'user' : 'ai'}`}>
        <p>{message.content}</p>
        {(message.suggestions || []).map((suggestion) => (
          <div className="ax-goal-suggestion-card" key={suggestion.question}>
            <div className="ax-goal-suggestion-top">
              <Lightbulb size={14} />
              <strong>{suggestion.question}</strong>
            </div>
            <div className="ax-goal-suggestion-body">
              <div>
                <span>Why this helps:</span>
                <p>{suggestion.why}</p>
              </div>
              <div>
                <span>Recommended path:</span>
                <div className="ax-goal-workflow-pills">
                  {(suggestion.workflow || []).map((step, index) => (
                    <React.Fragment key={`${suggestion.question}:${step}:${index}`}>
                      <span className={['Describe', 'Analysis', 'Models', 'What-if', 'Report'].includes(step) ? 'active' : ''}>{step}</span>
                      {index < suggestion.workflow.length - 1 && <em>{'>'}</em>}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
            <button type="button" onClick={() => onUseSuggestion(suggestion)}>
              Use this goal
            </button>
          </div>
        ))}
      </div>
      {isUser && <span className="ax-goal-chat-avatar user">U</span>}
    </div>
  )
}

function GoalCardIcon({ item }) {
  const text = `${item?.intent || ''} ${item?.question || ''}`.toLowerCase()
  const Icon = text.includes('what') || text.includes('scenario')
    ? SlidersHorizontal
    : text.includes('compare') || text.includes('group')
      ? BarChart3
      : text.includes('related') || text.includes('relationship')
        ? GitBranch
        : LineChart
  return (
    <span className="ax-goal-card-icon" aria-hidden="true">
      <Icon size={15} strokeWidth={2.1} />
    </span>
  )
}

function QuestionPathPreview({ question, intent }) {
  return (
    <div className="ax-goal-path">
      <span>{question}</span>
      <div>
        {intent.path.map((item, index) => (
          <React.Fragment key={item}>
            <strong>{item}</strong>
            {index < intent.path.length - 1 && <em>{'>'}</em>}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

export function goalLabel(goal) {
  return INTENTS.find((item) => item.id === goal)?.title || 'Choose a project question'
}

function workflowForIntent(intent) {
  if (intent === 'prepare_data') return ['Describe', 'Report']
  if (intent === 'train_model' || intent === 'compare_models') return ['Describe', 'Models', 'Report']
  if (intent === 'what_if') return ['Describe', 'Models', 'What-if', 'Report']
  if (intent === 'report') return ['Describe', 'Analysis', 'Report']
  if (intent === 'full_workflow') return ['Describe', 'Analysis', 'Models', 'What-if', 'Report']
  return ['Describe', 'Analysis', 'Report']
}

function intentFromGoalWorkflow(workflow = [], question = '') {
  const text = `${workflow.join(' ')} ${question}`.toLowerCase()
  if (text.includes('what-if') || text.includes('what if')) return 'what_if'
  if (text.includes('models') || text.includes('predict')) return 'train_model'
  if (text.includes('report')) return 'report'
  return inferIntent(question) || 'analyze_relationships'
}

function normalizeGoalChatSuggestion(item = {}) {
  const question = String(item.question || '').trim()
  const intent = item.intent || intentFromGoalWorkflow(item.workflow, question)
  return {
    question,
    intent,
    why: String(item.why || 'This gives SimuCast a clear path to guide your next steps.').trim(),
    workflow: Array.isArray(item.workflow) && item.workflow.length ? item.workflow : workflowForIntent(intent),
  }
}

function goalChatSuggestionFromQuestion(item = {}) {
  return normalizeGoalChatSuggestion({
    question: item.question,
    intent: item.intent,
    why: item.why,
    workflow: workflowForIntent(item.intent),
  })
}

function goalChatFallback(dataset, message = '') {
  const first = systemQuestionSuggestions(dataset).find((item) => {
    const intent = inferIntent(message)
    return intent ? item.intent === intent : true
  }) || systemQuestionSuggestions(dataset)[0]
  return {
    message: 'A good next step is to turn your question into one clear goal SimuCast can guide.',
    suggestions: [goalChatSuggestionFromQuestion(first)],
  }
}

export function systemQuestionSuggestions(dataset) {
  const variables = dataset?.variables || []
  const target = variables
    .filter((item) => item?.name && Number(item.unique || 0) > 1)
    .at(-1)?.name || variables.at(-1)?.name || 'an outcome'
  const numeric = variables.filter((item) => ['numeric', 'int', 'float'].includes(item?.dtype)).map((item) => item.name)
  const measure = numeric[0] || target
  const compare = numeric[1] || measure
  return [
    {
      question: `Can I predict ${target} from the other variables in this dataset?`,
      intent: 'train_model',
      source: 'system',
      why: 'Build a prediction path around a supported target.',
    },
    {
      question: `Which variables seem most related to ${measure}?`,
      intent: 'analyze_relationships',
      source: 'system',
      why: 'Start with summaries and evidence before deciding on modeling.',
    },
    {
      question: `How does ${measure} compare with ${compare} and the category groups here?`,
      intent: 'analyze_relationships',
      source: 'system',
      why: 'Check relationships and group differences that the dataset can support.',
    },
    {
      question: `What could change a prediction for ${target} in a what-if scenario?`,
      intent: 'what_if',
      source: 'system',
      why: 'Prepare a model first, then test changed feature values.',
    },
  ]
}

export function inferIntent(question) {
  const text = String(question || '').trim().toLowerCase()
  if (!text) return ''
  if (/(clean|prepare|missing|outlier|duplicate|standardi[sz]e|format)/.test(text)) return 'prepare_data'
  if (/(what[- ]?if|scenario|change .*prediction|if .* change|simulate)/.test(text)) return 'what_if'
  if (/(compare .*model|best model|which model|model performance)/.test(text)) return 'compare_models'
  if (/(report|summary for|export findings|document)/.test(text)) return 'report'
  if (/(predict|prediction|will .* pass|can .* pass|forecast|likely to|probability)/.test(text)) return 'train_model'
  if (/(factor|affect|relationship|related|correlat|association|associated|difference|compare|trend|pattern|explain|explore)/.test(text)) return 'analyze_relationships'
  return ''
}

function closestIntentChoices(question) {
  const inferred = inferIntent(question)
  return [...new Set([inferred, 'analyze_relationships', 'full_workflow', 'train_model', 'prepare_data'].filter(Boolean))].slice(0, 3)
}

export function coachStepsForGoal(goal, dataset) {
  const needsMissingFix =
    (dataset?.variables || []).some((variable) => Number(variable.missing || 0) > 0)
  const missingStep = needsMissingFix ? coachStep(
    'data.suggested_fixes',
    'data',
    'fix-cleaning-missing',
    'Resolve missing values before downstream work',
    'SimuCast found missing values in the current dataset stage.',
    'Apply or review the recommended missing-value fixes so summaries and models use complete inputs.',
    'The next analysis step unlocks when those required blanks are handled.',
    'required',
    'missing',
  ) : null
  const inspectStep = coachStep(
    'data.inspect',
    'data',
    'data-section-raw_data',
    'Check the dataset structure',
    'The dataset is ready for a quick inspection.',
    'Confirm the sheet, columns, and values look right before moving forward.',
    'You can continue when the structure looks right.',
    'recommended',
  )
  const dataIssueSteps = [
    ...(missingStep ? [missingStep] : []),
    coachStep(
      'data.outliers',
      'data',
      'fix-cleaning-outliers',
      'Review outliers before downstream work',
      'Extreme numeric values can distort summaries, analysis, and model fit.',
      'Review the Outliers card and apply the recommended handling when the current stage still has outliers.',
      'The guide keeps Data preparation active until detected outliers are handled.',
      'required',
      'outliers',
    ),
    coachStep(
      'data.duplicates',
      'data',
      'fix-cleaning-duplicates',
      'Remove duplicate rows before downstream work',
      'Repeated rows can overcount the same record in summaries and training.',
      'Review the Duplicates card and remove exact duplicate rows when SimuCast detects them.',
      'The guide moves on once exact duplicate rows are no longer pending.',
      'required',
      'duplicates',
    ),
  ]
  const dataPreparationPath = dataIssueSteps.length ? dataIssueSteps : [inspectStep]
  const common = {
    describe: coachStep(
      'describe.summaries',
      'describe',
      'describe-section-variables',
      'Summarize the prepared variables',
      'Descriptive summaries show what the variables look like now.',
      'Run the variables you need so distributions are visible before deeper analysis.',
      'Analysis becomes easier once the key variables are summarized.',
      'recommended',
      'describe',
    ),
    analysis: coachStep(
      'tests.setup',
      'tests',
      'fix-correlation-test',
      'Choose a supported analysis',
      'SimuCast can recommend valid test pairs from the variables you have.',
      'Open the analysis setup and pick the test that answers your question.',
      'Modeling can follow once the relationship or group result is clear.',
      'recommended',
      'tests',
    ),
    models: coachStep(
      'models.target',
      'models',
      'models-setup-target',
      'Train the model path for your question',
      'Prediction and what-if work need a saved trained model.',
      'Choose the target, review model setup, and train at least one model.',
      'What-if analysis unlocks after a model is saved.',
      'required',
      'models',
    ),
    whatif: coachStep(
      'whatif.controls',
      'whatif',
      'whatif-section-controls',
      'Test a what-if scenario',
      'A trained model can compare baseline values with changed inputs.',
      'Adjust supported feature values and review how the prediction changes.',
      'Save the scenario when it answers the question you are exploring.',
      'recommended',
      'whatif',
    ),
    report: coachStep(
      'report.preview',
      'report',
      'ax-report-preview',
      'Build the report',
      'Reports compile the outputs already saved in this project.',
      'Select the findings, explanations, and scenarios worth including.',
      'The workflow is complete once the report is generated.',
      'recommended',
      'report',
    ),
  }

  const preparePath = [
    ...dataPreparationPath,
    coachStep(
      'data.categories',
      'data',
      'data-section-category_standardization',
      'Review labels when categories look split',
      'Similar category labels can split groups across analysis and models.',
      'Review the label groups only when SimuCast detects values that should be merged.',
      'You can skip this recommendation when labels are already consistent.',
      'recommended',
      'categories',
    ),
  ]
  const paths = {
    prepare_data: [...preparePath, common.describe],
    analyze_relationships: [...preparePath, common.describe, common.analysis, common.report],
    train_model: [...preparePath, common.describe, common.models],
    compare_models: [...preparePath, common.describe, common.models],
    what_if: [...preparePath, common.models, common.whatif],
    report: [...preparePath, common.describe, common.report],
    full_workflow: [...preparePath, common.describe, common.analysis, common.models, common.whatif, common.report],
  }
  return paths[goal] || dataPreparationPath
}

export function firstCoachStep(goal, dataset) {
  return coachStepsForGoal(goal, dataset)[0]
}

export function currentCoachStep(guidance, dataset) {
  const steps = coachStepsForGoal(guidance?.goal || guidance?.intent, dataset)
  return steps.find((step) => step.id === guidance?.walkthrough_step) || steps[0] || null
}

export function nextCoachStep(goal, dataset, currentId, dismissedTips = []) {
  const hidden = new Set(dismissedTips || [])
  const steps = coachStepsForGoal(goal, dataset)
  const currentIndex = steps.findIndex((step) => step.id === currentId)
  return steps.slice(Math.max(currentIndex + 1, 0)).find((step) => !hidden.has(step.id)) || null
}

function coachStep(id, page, section, title, detected, action, unlocks, requirement = 'recommended', completion = '') {
  return { id, page, section, title, detected, action, unlocks, requirement, completion }
}
