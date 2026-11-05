import { test as base, expect, Page } from '@playwright/test';

// Shared setup (from "Playwright for QA", Part 2): tests import from here, not from
// @playwright/test. Add app-wide fixtures once instead of repeating them per test.
type Fixtures = { appPage: Page; consoleErrors: string[] };

export const test = base.extend<Fixtures>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await use(errors);
  },
  appPage: async ({ page }, use) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    await use(page);
  },
});
export { expect };
