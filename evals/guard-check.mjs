#!/usr/bin/env node
// Unit tests for hooks/guard-rules.mjs — the enforcement layer must block what it promises
// and must not block normal QA work.
import { checkBash, checkWrite } from '../hooks/guard-rules.mjs';
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
];
let fail = 0;
for (const [want, kind, a, b] of cases) {
  const r = kind === 'bash' ? checkBash(a) : checkWrite(a, b);
  const got = r ? 'block' : 'allow';
  const ok = got === want; if (!ok) fail++;
  console.log(`${ok ? '✓' : '✘'} ${want.padEnd(5)} ${kind}: ${a}${b ? ` (${b.slice(0, 30)})` : ''}`);
}
console.log(`\n${cases.length - fail}/${cases.length} guard checks passed`);
process.exit(fail ? 1 : 0);
