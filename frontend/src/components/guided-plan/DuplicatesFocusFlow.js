/* ============================================================
 * MODULE: DuplicatesFocusFlow
 * Keywords: guided focus, duplicates, step definitions
 *
 * Declarative step definitions for the Duplicates Guided Focus flow.
 * Pure JS — no JSX.
 * ============================================================ */

export const DUPLICATES_FOCUS_STEPS = [
  // ── Step 1 ── Review the data table
  {
    id: 'duplicates.reviewDataTable',
    targetSelector: '.ax-data-detail',
    placement: 'right',
    title: 'Review the data table',
    body: (ctx) =>
      ctx.duplicateCount > 0
        ? `SimuCast detected ${ctx.duplicateCount} duplicate row${ctx.duplicateCount === 1 ? '' : 's'} in this dataset. Scroll through the table to see the repeated entries.`
        : 'No duplicate rows detected in the current dataset stage.',
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

  // ── Step 2 ── Open the Duplicates tool
  {
    id: 'duplicates.openTool',
    targetSelector: '#tb-duplicates',
    placement: 'bottom',
    title: 'Open the Duplicates tool',
    body: () =>
      'Click the Duplicates button in the Quality group of the Dataset Tools toolbar to open the duplicates card.',
    primaryLabel: null,
    secondaryLabel: 'Explore freely',
    lockInteractions: true,
    allowScrollInTarget: false,
    allowedTargetClick: true,
    waitFor: 'event:simucast:popover-open:duplicates',
    skipIf: null,
    isLoading: false,
    isModal: false,
  },

  // ── Step 3 ── Introduce the Duplicates card
  {
    id: 'duplicates.introduceCard',
    targetSelector: '#fix-cleaning-duplicates',
    placement: 'right',
    title: 'The Duplicates card',
    body: (ctx) =>
      `This card found ${ctx.duplicateCount} duplicate row${ctx.duplicateCount === 1 ? '' : 's'}. Review the settings below and choose which occurrence to keep before removing.`,
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

  // ── Step 4 ── Keep occurrence dropdown
  {
    id: 'duplicates.keepOccurrence',
    targetSelector: '#duplicates-keep-occurrence',
    placement: 'right',
    title: 'Choose which occurrence to keep',
    body: () =>
      '"First" keeps the earliest copy of each duplicate row — the safest default. "Last" keeps the most recent one. Pick based on how your data is ordered.',
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

  // ── Step 5 ── Remove duplicates (waits for success)
  {
    id: 'duplicates.removeDuplicates',
    targetSelector: '#fix-cleaning-duplicates-apply',
    placement: 'right',
    title: 'Remove duplicates',
    body: () =>
      'Click Remove to delete the duplicate rows. SimuCast will create a new data stage so you can always undo.',
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

  // ── Step 6 ── Removing state
  {
    id: 'duplicates.removing',
    targetSelector: '#fix-cleaning-duplicates',
    placement: 'right',
    title: 'Removing duplicates…',
    body: () =>
      'SimuCast is removing the duplicate rows and creating a new data stage. This usually takes just a moment.',
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

  // ── Step 7 ── Review after remove
  {
    id: 'duplicates.reviewAfterRemove',
    targetSelector: '.ax-data-detail',
    placement: 'right',
    title: 'Review the updated table',
    body: () =>
      'The duplicate rows have been removed. Check the row count in the header to confirm the expected number of rows were deleted.',
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

  // ── Step 8 ── Completion modal (sentinel)
  {
    id: 'duplicates.complete',
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
export function buildDuplicatesFocusContext(suggestionData, dataset) {
  const duplicateCount = Number(suggestionData?.groups?.duplicates?.count || 0)
  return {
    duplicateCount,
    hasIssue: duplicateCount > 0,
    rowCount: dataset?.row_count || 0,
    colCount: dataset?.col_count || 0,
  }
}
