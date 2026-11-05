import { test, expect } from '../fixtures/base';
import { ContactPage } from '../pages/ContactPage.example';
import { notTested, linkFinding } from '../helpers/coverage';

// Template for one key journey. Copy per journey, rename, delete before delivering.
// Rules: page objects, role/label locators, web-first assertions, no fixed sleeps,
// credentials only from process.env. If a check cannot run, call notTested(reason) —
// never let it silently pass or skip.

const SUBMIT_ALLOWED = process.env.QA_SUBMIT_ALLOWED === 'true';

test.describe('Journey: contact form', () => {
  let contact: ContactPage;
  test.beforeEach(async ({ page }) => {
    contact = new ContactPage(page);
    await contact.goto();
  });

  test('happy path — valid details are accepted', async ({ page }) => {
    // Arrange / Act / Assert as steps, so a failure names the step in the report.
    await test.step('Arrange: fill valid details', async () => {
      await contact.name().fill('QA Tester');
      await contact.email().fill('qa+probe@example.com');
      await expect(contact.submit()).toBeEnabled();
    });
    if (!SUBMIT_ALLOWED) notTested('Final submit not allowed in this environment (production / read-only)');
    await test.step('Act: submit', async () => { await contact.submit().click(); });
    await test.step('Assert: confirmation shown', async () => {
      await expect(page.getByText(/thank|תודה/i)).toBeVisible();
    });
  });

  test('validation — empty required email is rejected', async () => {
    await contact.submit().click();
    await expect(contact.email()).toHaveJSProperty('validity.valid', false);
  });

  // Regression test for a confirmed gap: test.fail() keeps the run green while the gap
  // exists, and flags it ("expected to fail but passed") once it is fixed.
  test('EXP-001: whitespace-only name is rejected', async () => {
    linkFinding('EXP-001');
    test.fail(true, 'Known gap EXP-001 — remove this line once fixed');
    await contact.name().fill('   ');
    await contact.email().fill('qa+probe@example.com');
    await contact.submit().click();
    await expect(await contact.fieldError(/name|שם/i)).toBeVisible();
  });
});
