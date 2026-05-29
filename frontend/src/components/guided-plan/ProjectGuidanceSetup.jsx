/* ============================================================
 * COMPONENT: PROJECT GUIDANCE SETUP
 * Keywords: onboarding, question, guided workflow, coach
 * ============================================================ */
import React, { useEffect, useMemo, useState } from 'react'
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
    if (suggestionsAI) {
      setSuggestions(systemQuestionSuggestions(dataset))
      setSuggestionsAI(false)
    } else {
      loadAISuggestions()
    }
  }

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

  if (!open) return null

  return (
    <div className="ax-guidance-backdrop" role="presentation">
      <section className="ax-guidance-modal" role="dialog" aria-modal="true" aria-label="Choose project guidance">
        <div className="ax-guidance-head">
          <div>
            <p className="ax-kicker">Project start</p>
            <h2>{step === 'question' ? 'What would you like to find out from this dataset?' : 'Would you like SimuCast to guide you step by step?'}</h2>
            <p>
              {step === 'question'
                ? 'Choose a question or write your own. SimuCast will map it to a workflow it can actually support.'
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
          <>
            <div className="ax-question-suggestions-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{suggestionsAI ? 'AI suggested questions' : 'Questions SimuCast can guide'}</strong>
                <span>{suggestionsLoading ? 'Thinking with the current dataset...' : 'Pick one or ask your own below.'}</span>
              </div>
              {!auth.isGuest && (
                <button
                  type="button"
                  className="ax-btn mini"
                  disabled={suggestionsLoading}
                  onClick={toggleSuggestions}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid var(--color-border-secondary)', padding: '4px 8px', borderRadius: '6px', background: 'var(--color-background-primary)', cursor: 'pointer' }}
                >
                  {suggestionsAI ? (
                    <>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ display: 'block' }}>
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                      </svg>
                      <span style={{ fontSize: '11px', fontWeight: '750', color: 'var(--color-text-secondary)' }}>Show standard</span>
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{ display: 'block' }}>
                        <path d="M7 1L8.3 5.1L12.5 6L8.3 8.2L7 13L5.7 8.2L1.5 6L5.7 5.1L7 1Z" fill="var(--color-accent)" />
                      </svg>
                      <span style={{ fontSize: '11px', fontWeight: '750', color: 'var(--color-text-secondary)' }}>Suggest with AI</span>
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
                  <strong>{item.question}</strong>
                  <span>{item.why || goalLabel(item.intent)}</span>
                </button>
              ))}
            </div>
            <div className="ax-guidance-question-entry">
              <label htmlFor="simucast-project-question">Ask your own question</label>
              <textarea
                id="simucast-project-question"
                rows={2}
                value={question}
                placeholder="For example: Can I predict whether a student will pass math from reading score and attendance?"
                onChange={(event) => {
                  setQuestion(event.target.value)
                  setSelected(null)
                  setMappedIntent('')
                  setClosestIntents([])
                  setIntentChoiceOpen(false)
                }}
              />
              {derivedIntent && question.trim() && (
                <p>SimuCast will start with: <strong>{goalLabel(derivedIntent)}</strong>.</p>
              )}
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
          </>
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
      intent: 'full_workflow',
      source: 'system',
      why: 'Start with summaries and evidence before deciding on modeling.',
    },
    {
      question: `How does ${measure} compare with ${compare} and the category groups here?`,
      intent: 'full_workflow',
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
  if (/(factor|affect|relationship|related|difference|compare|trend|pattern|explain|explore)/.test(text)) return 'full_workflow'
  return ''
}

function closestIntentChoices(question) {
  const inferred = inferIntent(question)
  return [...new Set([inferred, 'full_workflow', 'train_model', 'prepare_data'].filter(Boolean))].slice(0, 3)
}

export function cleaningIssuesFromSuggestions(response) {
  if (!response?.groups) return null
  return {
    missing: Boolean((response.groups.missing?.columns || []).length),
    outliers: Boolean((response.groups.outliers?.columns || []).length),
    duplicates: Number(response.groups.duplicates?.count || 0) > 0,
  }
}

export function coachStepsForGoal(goal, dataset, cleaningIssues = null) {
  const needsMissingFix = cleaningIssues
    ? cleaningIssues.missing
    : (dataset?.variables || []).some((variable) => Number(variable.missing || 0) > 0)
  const needsOutlierFix = cleaningIssues ? cleaningIssues.outliers : true
  const needsDuplicateFix = cleaningIssues ? cleaningIssues.duplicates : true
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
    ...(needsOutlierFix ? [coachStep(
      'data.outliers',
      'data',
      'fix-cleaning-outliers',
      'Review outliers before downstream work',
      'Extreme numeric values can distort summaries, analysis, and model fit.',
      'Review the Outliers card and apply the recommended handling when the current stage still has outliers.',
      'The guide keeps Data preparation active until detected outliers are handled.',
      'required',
      'outliers',
    )] : []),
    ...(needsDuplicateFix ? [coachStep(
      'data.duplicates',
      'data',
      'fix-cleaning-duplicates',
      'Remove duplicate rows before downstream work',
      'Repeated rows can overcount the same record in summaries and training.',
      'Review the Duplicates card and remove exact duplicate rows when SimuCast detects them.',
      'The guide moves on once exact duplicate rows are no longer pending.',
      'required',
      'duplicates',
    )] : []),
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
      'fix-target-handling',
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
    ),
  ]
  const paths = {
    prepare_data: preparePath,
    train_model: [...preparePath, common.describe, common.models, common.whatif],
    compare_models: [...preparePath, common.models],
    what_if: [...preparePath, common.models, common.whatif],
    report: [...preparePath, common.describe, common.report],
    full_workflow: [...preparePath, common.describe, common.analysis, common.models, common.whatif, common.report],
  }
  return paths[goal] || dataPreparationPath
}

export function firstCoachStep(goal, dataset, cleaningIssues = null) {
  return coachStepsForGoal(goal, dataset, cleaningIssues)[0]
}

export function currentCoachStep(guidance, dataset, cleaningIssues = null) {
  const steps = coachStepsForGoal(guidance?.goal || guidance?.intent, dataset, cleaningIssues)
  return steps.find((step) => step.id === guidance?.walkthrough_step) || steps[0] || null
}

export function nextCoachStep(goal, dataset, currentId, dismissedTips = [], cleaningIssues = null) {
  const hidden = new Set(dismissedTips || [])
  const steps = coachStepsForGoal(goal, dataset, cleaningIssues)
  const currentIndex = steps.findIndex((step) => step.id === currentId)
  return steps.slice(Math.max(currentIndex + 1, 0)).find((step) => !hidden.has(step.id)) || null
}

function coachStep(id, page, section, title, detected, action, unlocks, requirement = 'recommended', completion = '') {
  return { id, page, section, title, detected, action, unlocks, requirement, completion }
}
