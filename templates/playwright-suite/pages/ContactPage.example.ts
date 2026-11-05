import { BasePage } from './BasePage';

// Example page object — copy per key page, rename, delete this file before delivering.
export class ContactPage extends BasePage {
  readonly path = '/contact';
  name() { return this.field(/name|שם/i); }
  email() { return this.field(/email|דוא"ל|אימייל|מייל/i); }
  submit() { return this.button(/send|submit|שלח/i); }
}
