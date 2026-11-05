import { test, expect } from '@playwright/test';
import pages from './pages.json';

// Visual regression — opt-in, Deep only. Runs only with: npx playwright test --project=visual
// First run creates the baseline (npx playwright test --project=visual --update-snapshots)
// and detects nothing. Later runs flag unintended UI changes. Mask dynamic regions below.
const MASK = ['[data-testid=clock]', '.ad', '.carousel', 'iframe'];

for (const path of pages as string[]) {
  test(`@visual ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    const name = `${path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}.png`;
    await expect(page).toHaveScreenshot(name, {
      fullPage: true, animations: 'disabled', maxDiffPixelRatio: 0.01,
      mask: MASK.map(m => page.locator(m)),
    });
  });
}
