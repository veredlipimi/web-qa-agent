import { test, expect } from '@playwright/test';
import pages from './pages.json';

// Smoke: every crawled page loads for a real user — 2xx, no uncaught errors, no 5xx calls.
// The agent fills pages.json from sitemap.json (paths relative to BASE_URL).

for (const path of pages as string[]) {
  test(`smoke: ${path} loads cleanly`, async ({ page }) => {
    const errors: string[] = [];
    const serverErrors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`); });

    const resp = await page.goto(path);
    expect(resp?.status(), 'document status').toBeLessThan(400);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();
    expect(errors, 'uncaught exceptions').toEqual([]);
    expect(serverErrors, '5xx responses').toEqual([]);
  });
}
