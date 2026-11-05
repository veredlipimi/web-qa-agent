import { Page, Locator, expect } from '@playwright/test';
import { gotoOrNotTested } from '../helpers/coverage';

/**
 * Base class for page objects. Prefer role/label locators — they double as accessibility
 * checks: if a field can only be found by placeholder or CSS, that is an accessibility gap.
 */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}
  abstract readonly path: string;

  async goto() {
    await gotoOrNotTested(this.page, this.path);
    await expect(this.page.locator('body')).toBeVisible();
  }

  heading(name: string | RegExp): Locator { return this.page.getByRole('heading', { name }); }
  link(name: string | RegExp): Locator { return this.page.getByRole('link', { name }); }
  button(name: string | RegExp): Locator { return this.page.getByRole('button', { name }); }
  field(label: string | RegExp): Locator { return this.page.getByLabel(label); }
  nav(name: string | RegExp): Locator { return this.page.getByRole('navigation').getByRole('link', { name }); }

  /** Visible inline error for a field (aria-describedby, aria-invalid or nearby error text). */
  async fieldError(label: string | RegExp): Promise<Locator> {
    const f = this.field(label);
    const describedBy = await f.getAttribute('aria-describedby');
    if (describedBy) return this.page.locator(describedBy.split(' ').map(id => `#${id}`).join(', '));
    return f.locator('xpath=ancestor::*[self::div or self::label or self::fieldset][1]')
      .getByText(/required|invalid|error|שדה חובה|לא תקין|שגיאה|נא /i);
  }
}
