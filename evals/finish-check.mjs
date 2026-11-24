#!/usr/bin/env node
// Unit tests for the Stop hook (hooks/finish-rules.mjs + finish-check.mjs): a run may not end
// before the report is built and current, every gap has evidence, everything not tested says why,
// and Critical/High gaps were independently verified (or the skip is explained). Phase 0–2 never block.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findActiveRun, finishProblems } from '../hooks/finish-rules.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const hook = path.join(here, '..', 'hooks', 'finish-check.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-finish-'));
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));

const gap = (over = {}) => ({ id: 'G1', title: 'Checkout total ignores coupon', severity: 'Medium', steps: ['Navigate to /cart', 'Type coupon'],
  expected: 'Total drops 10%', actual: 'Total unchanged', occurrences: [{ page: '/cart', screenshot: 'shots/g1.png' }], ...over });
const good = (over = {}) => ({ gaps: [gap()], coverage: { byCategory: [{ category: 'Forms', tested: 3, notTested: 1, blocked: 0, reasons: ['No test account'] }] },
  notCovered: [{ reason: 'Safari not run' }], traceability: { cases: [{ id: 'TC-1', status: 'FAIL', gaps: ['G1'] }, { id: 'TC-2', status: 'NOT_TESTED', notes: 'Needs login' }] }, ...over });
let n = 0;
function mkRun(files, { old = false } = {}) {
  const d = path.join(root, 'qa-runs', `run-${++n}`); fs.mkdirSync(d, { recursive: true });
  const all = Object.fromEntries(Object.entries({ 'sitemap.json': {}, ...files }).filter(([, v]) => v !== undefined));
  for (const [f, v] of Object.entries(all)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), typeof v === 'string' ? v : JSON.stringify(v)); }
  // findings.json / report.html must not look older than their inputs
  const t = Date.now() / 1000 - (old ? 86400 * 3 : 60);
  for (const f of Object.keys(all)) fs.utimesSync(path.join(d, f), t, t);
  for (const f of ['findings.json', 'report.html']) if (all[f]) fs.utimesSync(path.join(d, f), t + 30, t + 30);
  return d;
}
const has = (ps, re) => ps.some(p => re.test(p));
const results = [];
const check = (id, what, ok) => results.push({ id, what, ok: !!ok });

const done = { 'findings.auto.json': {}, 'findings.json': good(), 'report.html': '<html>' };
check('F01', 'Phase 0–2 (no Phase 3 output) never blocks', finishProblems(mkRun({ 'test-plan.md': '# plan' })).length === 0);
check('F02', 'Phase 3 output without report.mjs blocks', has(finishProblems(mkRun({ 'findings.auto.json': {} })), /report\.mjs has not run/));
check('F03', 'complete run passes', finishProblems(mkRun(done)).length === 0);
check('F04', 'report.html missing blocks', has(finishProblems(mkRun({ ...done, 'report.html': undefined })), /report\.html is missing/));
{ const d = mkRun(done); const t = Date.now() / 1000 + 120; fs.writeFileSync(path.join(d, 'findings.manual.json'), '{}'); fs.utimesSync(path.join(d, 'findings.manual.json'), t, t);
  check('F05', 'input newer than the report blocks (stale report)', has(finishProblems(d), /older than findings\.manual\.json/)); }
check('F06', 'gap without evidence blocks', has(finishProblems(mkRun({ ...done, 'findings.json': good({ gaps: [gap({ occurrences: [{ page: '/cart' }] })] }) })), /missing evidence/));
check('F07', 'gap without steps/expected blocks', has(finishProblems(mkRun({ ...done, 'findings.json': good({ gaps: [gap({ steps: [], expected: '' })] }) })), /missing steps, expected/));
check('F08', 'not tested without a reason blocks', has(finishProblems(mkRun({ ...done, 'findings.json': good({ coverage: { byCategory: [{ category: 'RTL', tested: 0, notTested: 2, blocked: 0, reasons: [] }] } }) })), /RTL.*no reason/));
check('F09', 'not-covered entry without a reason blocks', has(finishProblems(mkRun({ ...done, 'findings.json': good({ notCovered: [{ page: '/admin' }] }) })), /\/admin has no reason/));
check('F10', 'FAIL test case without a linked gap blocks', has(finishProblems(mkRun({ ...done, 'findings.json': good({ traceability: { cases: [{ id: 'TC-9', status: 'FAIL', gaps: [] }] } }) })), /TC-9: FAIL without a linked gap/));
check('F11', 'NOT_VERIFIABLE without a reason blocks', has(finishProblems(mkRun({ ...done, 'findings.json': good({ traceability: { cases: [{ id: 'TC-8', status: 'NOT_VERIFIABLE' }] } }) })), /TC-8: NOT_VERIFIABLE without a reason/));
const high = good({ gaps: [gap({ severity: 'High' })] });
check('F12', 'High gap without independent verification blocks', has(finishProblems(mkRun({ ...done, 'findings.json': high })), /no independent verification/));
check('F13', 'High gap with verification.json passes', finishProblems(mkRun({ ...done, 'findings.json': high, 'verification.json': { results: [] } })).length === 0);
check('F14', 'High gap with an explained skip passes', finishProblems(mkRun({ ...done, 'findings.json': high, 'verify/skipped.json': { reason: 'No subagent available' } })).length === 0);
check('F15', 'skip without a reason still blocks', has(finishProblems(mkRun({ ...done, 'findings.json': high, 'verify/skipped.json': {} })), /no independent verification/));

// findActiveRun
{ const base = fs.mkdtempSync(path.join(root, 'ws-')); fs.mkdirSync(path.join(base, 'qa-runs', 'a'), { recursive: true });
  fs.writeFileSync(path.join(base, 'qa-runs', 'a', 'sitemap.json'), '{}'); const t = Date.now() / 1000 - 86400 * 3; fs.utimesSync(path.join(base, 'qa-runs', 'a', 'sitemap.json'), t, t);
  check('F16', 'a run older than 12h is not treated as active', findActiveRun(base, { env: {} }) === null);
  fs.mkdirSync(path.join(base, 'qa-runs', 'b')); fs.writeFileSync(path.join(base, 'qa-runs', 'b', 'sitemap.json'), '{}');
  check('F17', 'the newest fresh run under qa-runs/ is the active one', findActiveRun(base, { env: {} }) === path.join(base, 'qa-runs', 'b')); }

// Runner: decision JSON, own loop bound, state file
const runHook = (cwd, extra = {}) => execFileSync(process.execPath, [hook], { input: JSON.stringify({ hook_event_name: 'Stop', cwd, ...extra }), encoding: 'utf8', env: { ...process.env, HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'qa-home-')), QA_RUNS_DIR: '' } });
{ const d = mkRun({ 'findings.auto.json': {} });
  const outs = [1, 2, 3, 4].map(i => runHook(d, { stop_hook_active: i > 1 }));
  const parsed = outs.map(o => (o ? JSON.parse(o) : {}));
  check('F18', 'runner blocks with decision "block" and the reason', parsed[0].decision === 'block' && /report\.mjs has not run/.test(parsed[0].reason));
  check('F19', 'runner stops blocking after 3 rounds and tells the user (no infinite loop)', parsed[1].decision === 'block' && parsed[2].decision === 'block' && !parsed[3].decision && /incomplete/.test(parsed[3].systemMessage || ''));
  check('F20', 'an unfinished run is recorded as incomplete in finish-check.json', JSON.parse(fs.readFileSync(path.join(d, 'finish-check.json'), 'utf8')).status === 'incomplete'); }
check('F21', 'runner is silent outside a QA run', runHook(fs.mkdtempSync(path.join(root, 'empty-'))) === '');
{ const d = mkRun(done); check('F22', 'runner lets a complete run stop and records it', runHook(d) === '' && JSON.parse(fs.readFileSync(path.join(d, 'finish-check.json'), 'utf8')).status === 'complete'); }
check('F23', 'bad hook input never traps the session', (() => { try { execFileSync(process.execPath, [hook], { input: '{not json', encoding: 'utf8' }); return true; } catch { return false; } })());

const failed = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? '✔' : '✘'} ${r.id} ${r.what}`);
console.log(`\n${results.length - failed.length}/${results.length} finish checks passed`);
process.exit(failed.length ? 1 : 0);
