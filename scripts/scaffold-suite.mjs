#!/usr/bin/env node
// Copies the Playwright suite template into <run>/suite and fills tests/pages.json from the crawl.
// Usage: node scaffold-suite.mjs --run qa-runs/x
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, need, readJson } from './lib.mjs';

const run = need(parseArgs(), 'run');
const here = path.dirname(fileURLToPath(import.meta.url));
const tpl = path.join(here, '..', 'templates', 'playwright-suite');
const dest = path.join(run, 'suite');
if (fs.existsSync(dest)) { console.error(`${dest} already exists — not overwriting`); process.exit(1); }
fs.cpSync(tpl, dest, { recursive: true });

const sm = readJson(path.join(run, 'sitemap.json'), { pages: [], startUrl: '' });
const origin = sm.startUrl ? new URL(sm.startUrl).origin : '';
const paths = [...new Set(sm.pages.filter(p => p.status && p.status < 400 && !p.error)
  .map(p => { const u = new URL(p.finalUrl || p.url); return u.origin === origin ? u.pathname + u.search : null; })
  .filter(Boolean))];
fs.writeFileSync(path.join(dest, 'tests', 'pages.json'), JSON.stringify(paths.length ? paths : ['/'], null, 2) + '\n');
fs.writeFileSync(path.join(dest, '.env'), `BASE_URL=${origin}\nQA_SUBMIT_ALLOWED=false\n`);
console.log(`[scaffold] ${dest} — ${paths.length} smoke pages, BASE_URL=${origin}`);
console.log(`[scaffold] next: write pages/*.ts + tests/<journey>.spec.ts, delete *.example.*, then:`);
console.log(`  cd ${dest} && npm install && BASE_URL=${origin} npx playwright test`);
