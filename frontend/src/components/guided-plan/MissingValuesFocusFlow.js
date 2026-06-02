/* ============================================================
 * MODULE: MissingValuesFocusFlow
 * Keywords: guided focus, missing values, step definitions
 *
 * Declarative step definitions for the 11-step Missing Values
 * Guided Focus flow. Pure JS — no JSX.
 * ============================================================ */

/**
 * 11-step declarative flow for the Missing Values guided focus.
 *
 * Step shape:
 *   id               — unique string
 *   targetSelector   — CSS selector for the spotlight target (null = no spotlight)
 *   placement        — hint for card positioning ('bottom' | 'right' | 'left' | null)
 *   title            — card heading string
 *   body             — string OR function(context) => string
 *   primaryLabel     — primary button label (null = no button; step advances on event)
 *   secondaryLabel   — secondary button label (null = hide)
 *   lockInteractions — if true, render InteractionBlocker overlay
 *   allowScrollInTarget — if true, give target scroll-through z-index
 *   allowedTargetClick  — if lockInteractions, can the target itself be clicked?
 *   waitFor          — event name that auto-advances the step (null = button only)
 *   skipIf           — function(context) => bool — skip this step if true
 *   isLoading        — show spinner instead of text while waiting
 *   isModal          — this step triggers the completion modal (no card rendered)
 */
export const MISSING_FOCUS_STEPS = [
  // ── Step 1 ── Review the data table
  {
    id: 'missing.reviewDataTable',
    targetSelector: '.ax-data-detail',
    placement: 'right',
    title: 'Review the data table',
    body: (ctx) =>
      ctx.affectedCount > 0
        ? `SimuCast detected ${ctx.affectedCount} column${ctx.affectedCount === 1 ? '' : 's'} with missing values${ctx.affectedNames ? ': ' + ctx.affectedNames : ''}. Scroll through the table to see where blanks appear — they show as empty cells.`
        : 'No missing values detected in the current dataset stage.',
    primaryLabel: 'Done reviewing',
    secondaryLabel: 'Explore freely',
    lockInteractions: true,
    allowScrollInTarget: true,
    allowedTargetClick: false,
    waitFor: null,
    skipIf: null,
    isLoading: false,
    isModal: false,
  },

  // ── Step 2 ── Open the Missing tool
  {
    id: 'missing.openTool',
    targetSelector: '#tb-missing',
    placement: 'bottom',
    title: 'Open the Missing tool',
    body: () =>
      'Click the Missing button in the Quality group of the Dataset Tools toolbar above to open the cleaning card.',
    primaryLabel: null,
    secondaryLabel: 'Explore freely',
    lockInteractions: true,
    allowScrollInTarget: false,
    allowedTargetClick: true,
    waitFor: 'event:simucast:popover-open:missing',
    skipIf: null,
    isLoading: false,
    isModal: false,
  },

  // ── Step 3 ── Introduce the Missing Values card
  {
    id: 'missing.introduceCard',
    targetSelector: '#fix-cleaning-missing',
    placement: 'right',
    title: 'The Missing Values card',
    body: (ctx) =>
      `This card shows ${ctx.affectedCount} affected column${ctx.affectedCount === 1 ? '' : 's'}. SimuCast has already picked the best fix method for each — you can review or override them before applying.`,
    primaryLabel: 'Next',
    secondaryLabel: 'Explore freely',
    lockInteractions: true,
    allowScrollInTarget: true,
    allowedTargetClick: false,
    waitFor: null,
    skipIf: null,
    isLoading: false,
    isModal: false,
  },

  // ── Step 4 ── Review affected columns
  {
    id: 'missing.reviewAffectedColumns',
    targetSelector: '#missing-affected-columns',
    placement: 'right',
    title: 'Affected columns',
    body: (ctx) =>
      `These are the columns with missing values. Check or uncheck to include or exclude each from the fix. Currently ${ctx.affectedCount} column${ctx.affectedCount === 1 ? ' is' : 's are'} selected. You can also click "Show affected rows" to filter the table.`,
    primaryLabel: 'Next',
    secondaryLabel: 'Explore freely',
    lockInteractions: true,
    allowScrollInTarget: false,
    allowedTargetClick: true,
    waitFor: null,
    skipIf: null,
    isLoading: false,
    isModal: false,
  },

  // ── Step 5 ── Enable recommendations (skipped if already visible)
  {
    id: 'missing.showRecommendations',
    targetSelector: '.ax-rec-toggle',
    placement: 'bottom',
    title: 'Enable recommendations',
    body: () =>
      'Turn on Recommendations to see why SimuCast chose each fix method for each column. This helps you decide whether to override any suggestion.',
    primaryLabel: null,
    secondaryLabel: 'Explore freely',
    lockInteractions: true,
    allowScrollInTarget: false,
    allowedTargetClick: true,
    waitFor: 'event:simucast:recommendations-changed:true',
    skipIf: (ctx) => ctx.recommendationsVisible,
    isLoading: false,
    isModal: false,
  },

  // ── Step 6 ── Explain recommendations
  {
    id: 'missing.explainRecommendations',
    targetSelector: '#fix-cleaning-missing-recommendations',
    placement: 'right',
    title: 'Review the recommendations',
    body: () =>
      'SimuCast explains why each method was chosen. Median is recommended for skewed numeric columns (resistant to outliers). Mode fills categorical columns with the most common value. "Ask AI" gives you a deeper explanation.',
    primaryLabel: 'Next',
    secondaryLabel: 'Explore freely',
    lockInteractions: true,
    allowScrollInTarget: true,
    allowedTargetClick: false,
    waitFor: null,
    skipIf: null,
    isLoading: false,
    isModal: false,
  },

  // ── Step 7 ── Per-column overrides (optional)
  {
    id: 'missing.perColumnOverrides',
    targetSelector: '#missing-overrides-toggle',
    placement: 'bottom',
    title: 'Per-column overrides (optional)',
    body: () =>
      'If any column needs a different strategy — for example, dropping instead of filling — click "Per-column overrides" to set it individually. Otherwise, the grouped recommendation applies to all selected columns.',
    primaryLabel: 'Next',
    secondaryLabel: 'Explore freely',
    lockInteractions: true,
    allowScrollInTarget: false,
    allowedTargetClick: true,
    waitFor: null,
    skipIf: null,
    isLoading: false,
    isModal: false,
  },

  // ── Step 8 ── Apply fixes (waits for Apply button click + success)
  {
    id: 'missing.applyFixes',
    targetSelector: '#fix-cleaning-missing-apply',
    placement: 'right',
    title: 'Apply the fixes',
    body: () =>
      'Click Apply to fill missing values using the selected methods. SimuCast will create a new data stage so you can always undo.',
    primaryLabel: null,
    secondaryLabel: 'Explore freely',
    lockInteractions: true,
    allowScrollInTarget: false,
    allowedTargetClick: true,
    waitFor: 'event:simucast:apply-success',
    skipIf: null,
    isLoading: false,
    isModal: false,
  },

  // ── Step 9 ── Applying state (spinner, auto-advances on success)
  {
    id: 'missing.applying',
    targetSelector: '#fix-cleaning-missing',
    placement: 'right',
    title: 'Applying fixes…',
    body: () =>
      'SimuCast is filling missing values and creating a new data stage. This usually takes just a moment.',
    primaryLabel: null,
    secondaryLabel: null,
    lockInteractions: true,
    allowScrollInTarget: false,
    allowedTargetClick: false,
    waitFor: 'event:simucast:apply-success',
    skipIf: null,
    isLoading: true,
    isModal: false,
  },

  // ── Step 10 ── Review after apply (table filtered to previously missing rows)
  {
    id: 'missing.reviewAfterApply',
    targetSelector: '.ax-data-detail',
    placement: 'right',
    title: 'Review the updated table',
    body: () =>
      'The columns have been filled. Verify the results look correct — the table is showing the previously missing rows so you can confirm the imputed values.',
    primaryLabel: 'Done reviewing',
    secondaryLabel: 'Explore freely',
    lockInteractions: true,
    allowScrollInTarget: true,
    allowedTargetClick: false,
    waitFor: null,
    skipIf: null,
    isLoading: false,
    isModal: false,
  },

  // ── Step 11 ── Completion modal (sentinel)
  {
    id: 'missing.complete',
    targetSelector: null,
    placement: null,
    title: null,
    body: null,
    primaryLabel: null,
    secondaryLabel: null,
    lockInteractions: false,
    allowScrollInTarget: false,
    allowedTargetClick: false,
    waitFor: null,
    skipIf: null,
    isLoading: false,
    isModal: true,
  },
]

/**
 * Build the runtime context object for step body functions and skipIf checks.
 * @param {object|null} suggestionData  — from api.cleanSuggestions()
 * @param {object|null} dataset         — dataset object
 * @returns {object} context
 */
export function buildMissingFocusContext(suggestionData, dataset) {
  const cols = suggestionData?.groups?.missing?.columns || []

  // Fall back to variables scan when suggestions aren't loaded yet
  const varMissing = (dataset?.variables || []).filter((v) => Number(v.missing || 0) > 0)
  const affectedCount = cols.length || varMissing.length

  const nameSrc = cols.length ? cols : varMissing
  const topNames = nameSrc
    .slice(0, 3)
    .map((c) => c.variable || c.name)
    .filter(Boolean)
  const affectedNames =
    topNames.join(', ') +
    (nameSrc.length > 3 ? ` and ${nameSrc.length - 3} more` : '')

  return {
    affectedCount,
    affectedNames: affectedNames || '',
    affectedColumns: cols,
    recommendationsVisible: false, // updated at runtime by MissingValuesFocusFlow
    hasIssue: affectedCount > 0,
    rowCount: dataset?.row_count || 0,
    colCount: dataset?.col_count || 0,
  }
}
