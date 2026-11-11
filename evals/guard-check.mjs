#!/usr/bin/env node
// Unit tests for hooks/guard-rules.mjs — the enforcement layer must block what it promises
// and must not block normal QA work.
import { checkBash, checkWrite, checkTool } from '../hooks/guard-rules.mjs';
const cases = [
  ['block', 'bash', 'curl -X POST https://shop.example.com/api/orders -d x=1'],
  ['block', 'bash', 'curl --data "a=1" https://example.com/contact'],
  ['block', 'bash', 'sqlmap -u https://example.com/?id=1'],
  ['block', 'bash', 'ab -n 10000 https://example.com/'],
  ['allow', 'bash', 'curl -sI https://example.com/'],
  ['allow', 'bash', 'curl -X POST http://localhost:4321/contact -d name=x'],
  ['allow', 'bash', 'node ~/.claude/skills/web-qa-agent/scripts/audit.mjs --sitemap qa-runs/x/sitemap.json --out qa-runs/x'],
  ['block', 'write', '/Users/v/projects/shop/src/checkout.ts', 'fix()'],
  ['allow', 'write', '/Users/v/qa-runs/shop-20261105/explore/cart.cjs', 'x'],
  ['block', 'write', '/Users/v/qa-runs/r/suite/tests/cart.spec.ts', "test.skip('flaky', async () => {})"],
  ['block', 'write', '/Users/v/qa-runs/r/suite/tests/cart.spec.ts', "test.only('x', async () => {})"],
  ['allow', 'write', '/Users/v/qa-runs/r/suite/tests/cart.spec.ts', "test('x', async () => { notTested('no account') })"],
  ['block', 'write', '/Users/v/qa-runs/r/explore/fault.mjs', "const b = await chromium.launch(); const ctx = await b.newContext();"],
  ['allow', 'write', '/Users/v/qa-runs/r/explore/fault.mjs', "const ctx = await guardedContext(b, { origin, prod: true }); await ctx.route('**/api/**', r => r.fulfill({ status: 500 }));"],
  ['block', 'tool', 'mcp__playwright__browser_navigate'],
  ['block', 'tool', 'mcp__claude-in-chrome__computer'],
  ['allow', 'tool', 'mcp__memory__memory_read'],
  // Found by the independent safeguards review (2026-11-11):
  ['block', 'bash', 'curl --json \'{"a":1}\' https://shop.example.com/api'],
  ['block', 'bash', 'curl -T payload.json https://shop.example.com/upload'],
  ['block', 'bash', 'python3 -c "import requests; requests.post(\'https://shop.example.com/api\', data={})"'],
  ['block', 'bash', 'node -e "fetch(\'https://shop.example.com/api\', { method: \'POST\' })"'],
  ['allow', 'bash', 'node -e "fetch(\'http://localhost:4321/api\', { method: \'POST\' })"'],
  ['block', 'bash', 'http POST https://shop.example.com/api a=1'],
  ['block', 'write', '/Users/v/qa-runs/../Projects/app.js', 'x'],
  ['block', 'write', '/Users/v/qa-runs/r/explore/probe.py', 'from playwright.sync_api import sync_playwright\nwith sync_playwright() as p: p.chromium.launch()'],
  ['block', 'write', '/Users/v/qa-runs/r/explore/p.mjs', "// uses guardedContext() later\nconst b = await chromium.launch(); await b.newContext();"],
  ['block', 'write', '/Users/v/qa-runs/r/explore/pp.mjs', "const b = await puppeteer.launch();"],
  ['block', 'tool', 'mcp__fetch__fetch', { url: 'https://shop.example.com/api', method: 'POST' }],
  ['allow', 'tool', 'mcp__fetch__fetch', { url: 'https://shop.example.com/' }],
];
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// The hook itself must fail closed on input it cannot parse.
const hook = new URL('../hooks/guard.mjs', import.meta.url);
const bad = spawnSync(process.execPath, [fileURLToPath(hook)], { input: 'not json' });
let fail = bad.status === 2 ? 0 : 1;
console.log(`${bad.status === 2 ? '✓' : '✘'} block hook: malformed input → exit 2 (fail-closed)`);
for (const [want, kind, a, b] of cases) {
  const r = kind === 'bash' ? checkBash(a) : kind === 'tool' ? checkTool(a, b || {}) : checkWrite(a, b);
  const got = r ? 'block' : 'allow';
  const ok = got === want; if (!ok) fail++;
  console.log(`${ok ? '✓' : '✘'} ${want.padEnd(5)} ${kind}: ${a}${b ? ` (${String(typeof b === "string" ? b : JSON.stringify(b)).slice(0, 30)})` : ''}`);
}
console.log(`\n${cases.length - fail}/${cases.length} guard checks passed`);
process.exit(fail ? 1 : 0);
