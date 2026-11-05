#!/usr/bin/env node
// One-time setup: checks Node, installs dependencies and Chromium. Safe to re-run.
// Usage: node setup.mjs
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const major = Number(process.versions.node.split('.')[0]);
const step = (msg) => console.log(`\n▸ ${msg}`);

if (major < 18) { console.error(`Node ${process.versions.node} found — Node 18 or newer is required. Install from https://nodejs.org`); process.exit(1); }
console.log(`✓ Node ${process.versions.node}`);

step('Installing script dependencies (playwright, axe-core)…');
execSync('npm install --no-fund --no-audit', { cwd: here, stdio: 'inherit' });

if (process.env.QA_CHROME_PATH) {
  console.log(`✓ Using existing browser at QA_CHROME_PATH=${process.env.QA_CHROME_PATH}`);
} else {
  step('Installing Chromium for Playwright…');
  try { execSync('npx playwright install chromium', { cwd: here, stdio: 'inherit' }); }
  catch { console.error('\nChromium download failed. If your network blocks it, set QA_CHROME_PATH to an installed Chrome and re-run.'); process.exit(1); }
}

step('Smoke test…');
const { launchBrowser } = await import('./lib.mjs');
const b = await launchBrowser(); const p = await b.newPage(); await p.setContent('<h1>ok</h1>');
console.log(`✓ Browser works (${b.version()})`); await b.close();
console.log('\nReady. In Claude Code, ask: "QA https://your-site"');
