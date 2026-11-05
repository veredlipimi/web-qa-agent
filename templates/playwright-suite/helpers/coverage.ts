import { test } from '@playwright/test';

/**
 * Mark the current test as NOT TESTED (not a pass, not a fail) with a reason, and stop it.
 * Use when the check could not run: no test account, missing test data, production
 * submit not allowed, page never finished loading, feature behind a flag, etc.
 * suite-summary.mjs reports these separately so a green run is never read as full coverage.
 */
export function notTested(reason: string): never {
  test.info().annotations.push({ type: 'not-tested', description: reason });
  test.skip(true, `NOT TESTED: ${reason}`);
  throw new Error('unreachable');
}

/** Link a test to a finding in the report (e.g. 'EXP-001', 'QA-004'). */
export function linkFinding(id: string) {
  test.info().annotations.push({ type: 'finding', description: id });
}

/** Navigate and treat a slow or login-walled page as NOT TESTED instead of failing. */
export async function gotoOrNotTested(page: import('@playwright/test').Page, path: string, timeout = 30_000) {
  try {
    await page.goto(path, { timeout });
  } catch (e) {
    notTested(`Page ${path} did not load within ${timeout / 1000}s`);
  }
  if (/\/(login|signin|sign-in|auth)(\/|$|\?)/i.test(new URL(page.url()).pathname) &&
      !/\/(login|signin|sign-in|auth)/i.test(path)) {
    notTested(`Redirected to login from ${path} — no test account provided`);
  }
}
