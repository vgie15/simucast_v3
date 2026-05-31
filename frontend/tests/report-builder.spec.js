import { test, expect } from '@playwright/test'

const dataset = {
  id: 101,
  name: 'Student Retention Study',
  filename: 'student_retention.csv',
  row_count: 428,
  current_stage_id: 'original',
  variables: [
    { name: 'GPA', dtype: 'float' },
    { name: 'Absences', dtype: 'int' },
    { name: 'Graduated', dtype: 'bool' },
  ],
  guidance: { setup_status: 'complete', guided_mode: false },
}

const activity = [
  {
    id: 11,
    kind: 'stage',
    category: 'clean',
    summary: 'Capped GPA outliers',
    created_at: '2026-05-29T12:00:00Z',
    detail: { column: 'GPA', method: 'IQR cap' },
  },
  {
    id: 12,
    kind: 'whatif',
    summary: 'Attendance recovery',
    created_at: '2026-05-29T12:05:00Z',
    detail: {
      action_type: 'save_whatif_scenario',
      scenario_name: 'Attendance recovery',
      inputs: { GPA: 3.2, Absences: 2 },
      prediction: { kind: 'probability', predicted_class: 'Graduated', prediction: 0.82 },
      risk_level: 'low',
    },
  },
]

const models = [
  {
    id: 21,
    algorithm: 'Random Forest',
    target: 'Graduated',
    metrics: { accuracy: 0.873 },
  },
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('simucast.sessionToken', 'test-token')
    window.localStorage.setItem(
      'simucast.savedCharts.101',
      JSON.stringify([
        {
          id: 31,
          title: 'GPA by graduation outcome',
          type: 'bar',
          xAxis: 'Graduated',
          yAxis: 'GPA',
        },
      ]),
    )
  })

  await page.route('**/api/**', async (route) => {
    await route.fulfill({ json: {} })
  })
  await page.route(/\/api\/auth\/me$/, async (route) => {
    await route.fulfill({
      json: {
        session: {
          token: 'test-token',
          is_guest: false,
          email: 'analyst@example.com',
          user_id: 1,
        },
      },
    })
  })
  await page.route(/\/api\/datasets\/101$/, async (route) => {
    await route.fulfill({ json: dataset })
  })
  await page.route(/\/api\/datasets\/101\/ai\/project_plan$/, async (route) => {
    await route.fulfill({ json: { steps: [] } })
  })
  await page.route(/\/api\/datasets\/101\/activity(\?.*)?$/, async (route) => {
    await route.fulfill({ json: { activity } })
  })
  await page.route(/\/api\/datasets\/101\/models$/, async (route) => {
    await route.fulfill({ json: models })
  })
  await page.route(/\/api\/datasets\/101\/analyses(\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        analyses: [
          {
            id: 41,
            kind: 'test_corr',
            result: {
              pairs: [
                { var_a: 'GPA', var_b: 'Absences', r: -0.63 },
                { var_a: 'GPA', var_b: 'StudyHours', r: 0.71 },
              ],
            },
          },
        ],
      },
    })
  })
  await page.route(/\/api\/datasets\/101\/report$/, async (route) => {
    await route.fulfill({ json: { report: { id: 51 } } })
  })
})

test('report builder selects content, reorders outline, and generates report', async ({ page }) => {
  await page.goto('http://127.0.0.1:5174/projects/101/report')

  await expect(page.locator('.lh-title')).toHaveText('Build your report')
  await expect(page.locator('#picker-item-viz-31')).toContainText('GPA by graduation outcome')
  await expect(page.locator('#section-count')).toContainText('sections included')

  await page.getByRole('button', { name: 'Deselect all' }).click()
  await expect(page.locator('#section-count')).toContainText('0 sections included')

  await page.locator('#picker-item-viz-31').click()
  await page.locator('#picker-item-model-21').click()
  await page.getByText('Model interpretation').click()
  await expect(page.locator('#section-count')).toContainText('3 sections included')

  const outlineItems = page.locator('.oi')
  await expect(outlineItems).toHaveCount(3)
  await outlineItems.nth(2).dragTo(outlineItems.nth(0))
  await expect(outlineItems.first()).toContainText('AI Interpretation')

  await page.getByRole('button', { name: /Generate report/i }).click()
  await expect(page.getByText('Building your report...')).toBeVisible()
  await expect(page.getByRole('button', { name: /Print/i })).toBeEnabled({ timeout: 3000 })
  await expect(page.getByRole('button', { name: /HTML/i })).toBeEnabled()
  await expect(page.getByRole('button', { name: /Share/i })).toBeEnabled()
})
