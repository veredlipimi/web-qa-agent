import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const launchOptions = process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : {};
// Opt-in cross-browser: QA_BROWSERS=firefox,webkit (needs `npx playwright install firefox webkit`).
// WebKit is the engine behind Safari, including every browser on iPhone.
const extraBrowsers = String(process.env.QA_BROWSERS || '').split(',').map(s => s.trim()).filter(Boolean);
const EXTRA: Record<string, any> = {
  firefox: { name: 'firefox', grepInvert: /@visual/, use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
  webkit: { name: 'webkit', grepInvert: /@visual/, use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  'mobile-safari': { name: 'mobile-safari', grepInvert: /@visual/, use: { ...devices['iPhone 14'] } },
};

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'results.json' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.QA_VIDEO === 'off' ? 'off' : 'retain-on-failure',
    launchOptions,
    // Saved login from scripts/save-auth.mjs (never commit it)
    ...(process.env.QA_STORAGE_STATE ? { storageState: process.env.QA_STORAGE_STATE } : {}),
  },
  projects: [
    { name: 'desktop', grepInvert: /@visual/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions } },
    { name: 'mobile', grepInvert: /@visual/, use: { ...devices['Pixel 7'], launchOptions } },
    // Opt-in: npx playwright test --project=visual
    { name: 'visual', grep: /@visual/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions } },
    ...extraBrowsers.filter(b => EXTRA[b]).map(b => EXTRA[b]),
  ],
});
