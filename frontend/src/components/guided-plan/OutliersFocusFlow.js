/* ============================================================
 * MODULE: OutliersFocusFlow
 * Keywords: guided focus, outliers, step definitions
 *
 * Declarative step definitions for the Outliers Guided Focus flow.
 * Pure JS — no JSX.
 * ============================================================ */

export const OUTLIERS_FOCUS_STEPS = [
  // ── Step 1 ── Review the data table
  {
    id: 'outliers.reviewDataTable',
    targetSelector: '.ax-data-detail',
    placement: 'right',
    title: 'Review the data table',
    body: (ctx) =>
      ctx.affectedCount > 0
        ? `SimuCast detected ${ctx.affectedCount} column${ctx.affectedCount === 1 ? '' : 's'} with outliers${ctx.affectedNames ? ': ' + ctx.affectedNames : ''}. Scroll through the table to spot unusually large or small values.`
        : 'No outliers detected in the current dataset stage.',
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

  // ── Step 2 ── Open the Outliers tool
  {
    id: 'outliers.openTool',
    targetSelector: '#tb-outliers',
    placement: 'bottom',
    title: 'Open the Outliers tool',
    body: () =>
      'Click the Outliers button in the Quality group of the Dataset Tools toolbar to open the outlier cleaning card.',
    primaryLabel: null,
    secondaryLabel: 'Explore freely',
    lockInteractions: true,
    allowScrollInTarget: false,
    allowedTargetClick: true,
    waitFor: 'event:simucast:popover-open:outliers',
    skipIf: null,
    isLoading: false,
    isModal: false,
  },

  // ── Step 3 ── Introduce the Outliers card
  {
    id: 'outliers.introduceCard',
    targetSelector: '#fix-cleaning-outliers',
    placement: 'right',
    title: 'The Outliers card',
    body: (ctx) =>
      `This card shows ${ctx.affectedCount} column${ctx.affectedCount === 1 ? '' : 's'} with extreme values. SimuCast has already chosen the best handling method for each — you can review or override before applying.`,
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
    id: 'outliers.reviewAffectedColumns',
    targetSelector: '#outliers-affected-columns',
    placement: 'right',
    title: 'Affected columns',
    body: (ctx) =>
      `These are the columns with outliers. Check or uncheck to include or exclude each from the fix. Currently ${ctx.affectedCount} column${ctx.affectedCount === 1 ? ' is' : 's are'} selected.`,
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
    id: 'outliers.showRecommendations',
    targetSelector: '.ax-rec-toggle',
    placement: 'bottom',
    title: 'Enable recommendations',
    body: () =>
      'Turn on Recommendations to see why SimuCast chose each outlier handling method. This helps you decide whether to override any suggestion.',
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
    id: 'outliers.explainRecommendations',
    targetSelector: '#fix-cleaning-outliers-recommendations',
    placement: 'right',
    title: 'Review the recommendations',
    body: () =>
      'Winsorize caps extreme values at a percentile boundary — the least destructive option. Drop removes the outlier rows entirely. SimuCast picks based on the column\'s distribution and missing-value count.',
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
    id: 'outliers.perColumnOverrides',
    targetSelector: '#outliers-overrides-toggle',
    placement: 'bottom',
    title: 'Per-column overrides (optional)',
    body: () =>
      'If a specific column needs different handling — e.g., drop rows instead of capping — click "Per-column overrides" to set it individually. Otherwise the grouped recommendation applies to all selected columns.',
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
    id: 'outliers.applyFixes',
    targetSelector: '#fix-cleaning-outliers-apply',
    placement: 'right',
    title: 'Apply the fixes',
    body: () =>
      'Click Apply to handle outliers using the selected methods. SimuCast will create a new data stage so you can always undo.',
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
    id: 'outliers.applying',
    targetSelector: '#fix-cleaning-outliers',
    placement: 'right',
    title: 'Applying fixes…',
    body: () =>
      'SimuCast is capping or removing outliers and creating a new data stage. This usually takes just a moment.',
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

  // ── Step 10 ── Review after apply
  {
    id: 'outliers.reviewAfterApply',
    targetSelector: '.ax-data-detail',
    placement: 'right',
    title: 'Review the updated table',
    body: () =>
      'The extreme values have been capped or removed. Verify the results look correct — the table now reflects the outlier-cleaned stage.',
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
    id: 'outliers.complete',
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
 * Build the runtime context for step body functions and skipIf checks.
 */
export function buildOutliersFocusContext(suggestionData, dataset) {
  const cols = suggestionData?.groups?.outliers?.columns || []
  const varOutliers = (dataset?.variables || []).filter((v) => Number(v.outliers || 0) > 0)
  const affectedCount = cols.length || varOutliers.length
  const nameSrc = cols.length ? cols : varOutliers
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
    recommendationsVisible: false,
    hasIssue: affectedCount > 0,
    rowCount: dataset?.row_count || 0,
    colCount: dataset?.col_count || 0,
  }
}
