import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const launchOptions = process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : {};

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
  ],
});
