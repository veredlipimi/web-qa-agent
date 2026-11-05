#!/usr/bin/env node
// Copies the deliverables of a run to --dest, excluding node_modules, test-results,
// playwright-report caches, .env files and storage-state/auth files.
// Usage: node package.mjs --run qa-runs/x --dest ~/Desktop/qa-example
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, need } from './lib.mjs';

const args = parseArgs();
const run = need(args, 'run');
const dest = need(args, 'dest');
const SKIP = /(^|\/)(node_modules|test-results|\.cache|auth)(\/|$)|(^|\/)\.env$|storage-?state.*\.json$|\.har$/i;
let n = 0;
fs.cpSync(run, dest, {
  recursive: true,
  filter: (src) => { const rel = path.relative(run, src); const ok = !rel || !SKIP.test(rel); if (ok && fs.statSync(src).isFile()) n++; return ok; },
});
// Leak check: credentials from env must not appear in delivered text files.
const secrets = [process.env.QA_PASS, process.env.QA_USER].filter(s => s && s.length >= 4);
const leaks = [];
const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const st = fs.statSync(p);
  if (st.isDirectory()) walk(p); else if (st.size < 5e6 && /\.(md|html|json|csv|ts|txt)$/.test(f)) {
    const t = fs.readFileSync(p, 'utf8'); if (secrets.some(s => t.includes(s))) leaks.push(p); } } };
walk(dest);
if (leaks.length) { console.error(`[package] CREDENTIAL LEAK in: ${leaks.join(', ')} — fix before delivering`); process.exit(1); }
console.log(`[package] ${n} files → ${dest} (node_modules, test-results, .env and auth files excluded)`);
