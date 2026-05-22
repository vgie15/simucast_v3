/* ============================================================
 * COMPONENT: PROJECT GUIDANCE SETUP
 * Keywords: onboarding, goal, guided workflow, coach
 * ============================================================ */
import React, { useEffect, useState } from 'react'
import { api } from '../../api'

export const GOALS = [
  {
    id: 'prepare_data',
    title: 'Clean and prepare data',
    description: 'Fix missing values, outliers, duplicates, labels, and formatting.',
    path: ['Prepare data', 'Review fixes', 'Continue when ready'],
  },
  {
    id: 'train_model',
    title: 'Build a prediction model',
    description: 'Prepare the data, choose a target, train and compare models.',
    path: ['Prepare data', 'Understand variables', 'Train models'],
  },
  {
    id: 'compare_models',
    title: 'Compare models',
    description: 'Train several models and understand which one performs best.',
    path: ['Prepare data', 'Choose target', 'Compare metrics'],
  },
  {
    id: 'what_if',
    title: 'Run what-if analysis',
    description: 'Build or use a model, then test how changed inputs affect predictions.',
    path: ['Prepare data', 'Train a model', 'Test scenarios'],
  },
  {
    id: 'report',
    title: 'Create a report',
    description: 'Collect saved outputs, explanations, visuals, and documentation.',
    path: ['Save outputs', 'Review findings', 'Generate report'],
  },
  {
    id: 'full_workflow',
    title: 'Guide me through the full workflow',
    description: 'Follow SimuCast from preparation to report.',
    path: ['Prepare data', 'Analyze and model', 'Report'],
  },
]

const GUIDANCE_CHOICES = [
  {
    id: true,
    title: 'Guide me step by step',
    description: 'SimuCast will highlight the next section to use and explain why.',
  },
  {
    id: false,
    title: "Let me explore",
    description: 'Keep the workflow plan visible without pop-up guidance.',
  },
]

// Short post-create setup that personalizes the project workflow without blocking exploration.
export default function ProjectGuidanceSetup({
  dataset,
  open,
  onClose,
  onSaved,
  allowDismiss = true,
}) {
  const current = dataset?.guidance || {}
  const [step, setStep] = useState('goal')
  const [goal, setGoal] = useState(current.goal || '')
  const [guidedMode, setGuidedMode] = useState(Boolean(current.guided_mode))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setStep('goal')
    setGoal(current.goal || '')
    setGuidedMode(Boolean(current.guided_mode))
    setError('')
  }, [open, current.goal, current.guided_mode])

  const selectedGoal = GOALS.find((item) => item.id === goal)

  const save = async (body, startTarget = null) => {
    if (!dataset?.id) return
    setBusy(true)
    setError('')
    try {
      const response = await api.updateGuidance(dataset.id, body)
      onSaved?.(response.guidance, startTarget)
    } catch (err) {
      setError(err.message || 'Could not save project guidance.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="ax-guidance-backdrop" role="presentation">
      <section className="ax-guidance-modal" role="dialog" aria-modal="true" aria-label="Choose project guidance">
        <div className="ax-guidance-head">
          <div>
            <p className="ax-kicker">Project start</p>
            <h2>{step === 'goal' ? 'What would you like to do with this dataset?' : 'How much guidance do you want?'}</h2>
            <p>
              {step === 'goal'
                ? 'Choose a goal and SimuCast will shape the workflow around it. You can change this later.'
                : 'The workflow plan stays available either way. Step-by-step guidance only appears when it helps you act.'}
            </p>
          </div>
          {allowDismiss && (
            <button className="ax-btn ghost" type="button" onClick={() => save({ setup_status: 'dismissed', guided_mode: false })} disabled={busy}>
              Decide later
            </button>
          )}
        </div>

        {step === 'goal' ? (
          <div className="ax-goal-grid">
            {GOALS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ax-goal-card ${goal === item.id ? 'selected' : ''}`}
                onClick={() => setGoal(item.id)}
              >
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            {selectedGoal && <GoalPathPreview goal={selectedGoal} />}
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
            <button className="ax-btn" type="button" onClick={() => setStep('goal')} disabled={busy}>
              Back
            </button>
          )}
          {step === 'goal' ? (
            <button className="ax-btn prim" type="button" onClick={() => setStep('guidance')} disabled={!goal || busy}>
              Continue
            </button>
          ) : (
            <button
              className="ax-btn prim"
              type="button"
              disabled={busy}
              onClick={() => save({
                goal,
                setup_status: 'completed',
                guided_mode: guidedMode,
                walkthrough_step: guidedMode ? firstCoachStep(goal, dataset)?.id : null,
                dismissed_tips: [],
                completed_tips: [],
              }, firstCoachStep(goal, dataset))}
            >
              {busy ? 'Starting...' : 'Start'}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}

function GoalPathPreview({ goal }) {
  return (
    <div className="ax-goal-path">
      <span>To reach {goal.title.toLowerCase()}:</span>
      <div>
        {goal.path.map((item, index) => (
          <React.Fragment key={item}>
            <strong>{item}</strong>
            {index < goal.path.length - 1 && <em>{'>'}</em>}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

export function goalLabel(goal) {
  return GOALS.find((item) => item.id === goal)?.title || 'Choose a project goal'
}

export function coachStepsForGoal(goal, dataset) {
  const needsFixes = (dataset?.variables || []).some((variable) => Number(variable.missing || 0) > 0)
  const prepStart = needsFixes ? coachStep(
    'data.suggested_fixes',
    'data',
    'fix-cleaning-suggestions',
    'Start with the detected issues',
    'Review Suggested Fixes before summaries or models depend on this data.',
  ) : coachStep(
    'data.inspect',
    'data',
    'data-section-raw_data',
    'Check the dataset structure',
    'Confirm the sheet, columns, and values look right before moving forward.',
  )
  const common = {
    describe: coachStep(
      'describe.summaries',
      'describe',
      'describe-section-variables',
      'Summarize the prepared variables',
      'Descriptive outputs help you see distributions before deeper analysis.',
    ),
    analysis: coachStep(
      'tests.setup',
      'tests',
      'fix-correlation-test',
      'Choose a supported analysis',
      'Use a recommended test pair when you want evidence about relationships or group differences.',
    ),
    models: coachStep(
      'models.target',
      'models',
      'fix-target-handling',
      'Choose the model target',
      'Prediction starts by choosing the outcome SimuCast should learn.',
    ),
    whatif: coachStep(
      'whatif.controls',
      'whatif',
      'whatif-section-controls',
      'Test a scenario',
      'Use a trained model to compare baseline values with changed inputs.',
    ),
    report: coachStep(
      'report.preview',
      'report',
      'ax-report-preview',
      'Build the report',
      'Compile the saved work into a report when the useful outputs are ready.',
    ),
  }

  const preparePath = [
    prepStart,
    coachStep(
      'data.categories',
      'data',
      'data-section-category_standardization',
      'Review labels when categories look split',
      'Standardized labels keep groups readable in analysis and modeling.',
    ),
  ]
  const paths = {
    prepare_data: preparePath,
    train_model: needsFixes ? [prepStart, common.describe, common.models] : [common.models, common.describe],
    compare_models: needsFixes ? [prepStart, common.models] : [common.models],
    what_if: needsFixes ? [prepStart, common.models, common.whatif] : [common.models, common.whatif],
    report: needsFixes ? [prepStart, common.describe, common.report] : [common.describe, common.report],
    full_workflow: [prepStart, common.describe, common.analysis, common.models, common.whatif, common.report],
  }
  return paths[goal] || [prepStart]
}

export function firstCoachStep(goal, dataset) {
  return coachStepsForGoal(goal, dataset)[0]
}

export function nextCoachStep(goal, dataset, currentId, dismissedTips = []) {
  const hidden = new Set(dismissedTips || [])
  const steps = coachStepsForGoal(goal, dataset)
  const currentIndex = steps.findIndex((step) => step.id === currentId)
  return steps.slice(Math.max(currentIndex + 1, 0)).find((step) => !hidden.has(step.id)) || null
}

function coachStep(id, page, section, title, message) {
  return { id, page, section, title, message }
}
