import { test, expect } from '@playwright/test';

test('guided focus flow and explore freely', async ({ page }) => {
  // 1. Navigate to the dashboard (which shows the sidebar and profile button)
  await page.goto('http://localhost:5173/dashboard');

  // 2. Open profile menu and click Log in
  await page.locator('.ax-profile-btn').click();
  await page.locator('button.ax-popover-item:has-text("Log in")').click();

  // 3. Fill in credentials and submit
  await page.locator('input[type="email"]').fill('vgie0015@gmail.com');
  await page.locator('input[type="password"]').fill('12345678');
  await page.locator('button.ax-auth-submit').click();

  // 4. Wait for dashboard page and click Projects navigation
  await page.waitForURL('**/dashboard');
  await page.locator('.ax-nav:has-text("Projects")').click();
  await page.waitForURL('**/projects');

  // 5. Click the first project card
  const firstProject = page.locator('.ax-project-card').first();
  await expect(firstProject).toBeVisible();
  await firstProject.click();

  // 6. Wait for project workspace page
  await page.waitForURL('**/projects/**');
  
  // Wait for the plan panel to load
  const aiRail = page.locator('.ax-ai-rail');
  await expect(aiRail).toBeVisible();

  // Find step 1 or any step in the plan list
  // Let's click the first step card header to expand it (if not already expanded)
  const firstStepHeader = page.locator('.ax-plan-step-header').first();
  await firstStepHeader.click();

  // Click "Open ↑" button inside the expanded step card
  const openButton = page.locator('.ax-plan-pointer-open-btn').first();
  await expect(openButton).toBeVisible();
  await openButton.click();

  // 7. Verify Guided Focus Card is opened
  const coachCard = page.locator('.guided-focus-card');
  await expect(coachCard).toBeVisible();

  // Check positioning to ensure no overlap with the AI rail
  const cardBox = await coachCard.boundingBox();
  const railBox = await aiRail.boundingBox();
  
  if (cardBox && railBox) {
    console.log(`Card position: left=${cardBox.x}, width=${cardBox.width}`);
    console.log(`AI Rail position: left=${railBox.x}, width=${railBox.width}`);
    // Card should be positioned to the left of the AI rail, meaning its right edge (x + width) is <= rail's left edge (railBox.x)
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(railBox.x + 5); 
  }

  // 8. Click "Explore freely" inside the Guided Focus card
  const exploreFreelyBtn = coachCard.locator('button:has-text("Explore freely")');
  await expect(exploreFreelyBtn).toBeVisible();
  
  const startTime = Date.now();
  await exploreFreelyBtn.click();
  
  // Verify it disappears instantly
  await expect(coachCard).toBeHidden();
  const duration = Date.now() - startTime;
  console.log(`Dismiss duration: ${duration}ms`);
  expect(duration).toBeLessThan(150); // should be almost instant (optimistic update)
});
