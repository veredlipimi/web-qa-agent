#!/usr/bin/env node
// Unit checks for requirements traceability and the report fields it adds. No browser needed.
// Usage: node evals/requirements-check.mjs   (exit 0 = all pass; also run by regression-check.mjs)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { traceability, rollUp, testCasesCsv } from '../scripts/requirements.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const results = [];
const check = (id, what, ok) => results.push({ id, what, ok: !!ok });

// ---- roll-up rules
check('T01', 'all PASS → PASS', rollUp(['PASS', 'PASS']) === 'PASS');
check('T02', 'any FAIL → FAIL', rollUp(['PASS', 'FAIL']) === 'FAIL');
check('T03', 'NOT_IMPLEMENTED wins over FAIL', rollUp(['FAIL', 'NOT_IMPLEMENTED']) === 'NOT_IMPLEMENTED');
check('T04', 'PASS + NOT_TESTED → PARTIAL, never PASS', rollUp(['PASS', 'NOT_TESTED']) === 'PARTIAL');
check('T05', 'no cases → NO_TESTS', rollUp([]) === 'NO_TESTS');

// ---- traceability warnings (the honesty rules)
const reqs = { items: [{ id: 'AC-1', text: 'a' }, { id: 'AC-2', text: 'b' }, { id: 'AC-3', text: 'c' }] };
const tcs = { cases: [
  { id: 'TC-1', requirement: 'AC-1', steps: ['x'], verify: ['y'], status: 'pass' },
  { id: 'TC-2', requirement: 'AC-2', steps: ['x'], verify: ['y'], status: 'FAIL' },
  { id: 'TC-3', requirement: 'AC-9', steps: ['x'], verify: ['y'], status: 'NOT_TESTED' },
  { id: 'TC-4', requirement: 'AC-1', steps: ['x'], verify: ['y'], status: 'FAIL', gaps: ['EXP-404'] },
] };
const t = traceability(reqs, tcs, ['EXP-001']);
const warn = re => t.warnings.some(w => re.test(`${w.case || w.requirement} ${w.problem}`));
check('T06', 'status is case-insensitive ("pass" → PASS)', t.cases[0].status === 'PASS');
check('T07', 'FAIL without a linked gap is flagged', warn(/TC-2 FAIL without a linked gap/));
check('T08', 'unknown requirement is flagged', warn(/TC-3 links to unknown requirement AC-9/));
check('T09', 'NOT_TESTED without a reason is flagged', warn(/TC-3 NOT_TESTED without a reason/));
check('T10', 'link to a gap that is not in the report is flagged', warn(/TC-4 links to gap EXP-404/));
check('T11', 'requirement with no test case is a traceability gap', warn(/AC-3 traceability gap/));
check('T12', 'requirement roll-up uses every case (AC-1 = FAIL)', t.requirements.find(r => r.id === 'AC-1').status === 'FAIL');

// ---- CSV for Google Sheets
const csv = testCasesCsv(traceability(reqs, { cases: [{ id: 'TC-1', requirement: ['AC-1', 'AC-2'], title: 'Say "hi"', steps: ['Open', 'Click'], verify: ['Possible to save', 'Total is correct'], status: 'PASS' }] }));
check('T13', 'CSV: numbered steps and bulleted verify in one cell each', csv.includes('"1. Open\n2. Click"') && csv.includes('"- Possible to save\n- Total is correct"'));
check('T14', 'CSV: quotes escaped, BOM for Excel/Sheets', csv.includes('"Say ""hi"""') && csv.startsWith('﻿'));
const td = traceability(reqs, { cases: [
  { id: 'TC-A', requirement: 'AC-1', steps: ['x'], verify: ['y'], status: 'PASS', testData: 'User: QA_USER / password: QA_PASS (env)' },
  { id: 'TC-B', requirement: 'AC-1', steps: ['x'], verify: ['y'], status: 'PASS', testData: 'password: hunter2' },
] });
check('T21', 'test data naming an env var is fine; a literal password is flagged', !td.warnings.some(w => w.case === 'TC-A') && td.warnings.some(w => w.case === 'TC-B' && /credential/.test(w.problem)));
check('T22', 'CSV has a Test data column', testCasesCsv(td).split('\n')[0].includes('Test data'));

// ---- report integration
const run = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-req-'));
try {
  fs.writeFileSync(path.join(run, 'findings.manual.json'), JSON.stringify({
    findings: [{ id: 'EXP-001', category: 'Functional', severity: 'High', title: 'Seat field accepts 25 (limit 20)', page: 'https://x.test/seats', viewport: 'desktop',
      preconditions: 'Signed in as a test owner', requirement: 'AC-2', type: 'Missing validation', steps: ['Open /seats', 'Type 25'],
      expected: 'Impossible to add more than 20 seats', actual: '25 accepted', impact: 'Likely: orders the backend rejects', evidence: { details: 'value=25' } }],
    openQuestions: [{ question: 'Does the limit include the owner?', for: 'product', related: 'AC-2' }],
  }));
  fs.writeFileSync(path.join(run, 'requirements.json'), JSON.stringify(reqs));
  fs.writeFileSync(path.join(run, 'test-cases.json'), JSON.stringify({ cases: [
    { id: 'TC-1', requirement: 'AC-1', steps: ['x'], verify: ['y'], status: 'PASS' },
    { id: 'TC-2', requirement: 'AC-2', steps: ['x'], verify: ['y'], status: 'FAIL', gaps: ['EXP-001'] },
  ] }));
  execFileSync(process.execPath, [path.join(here, '..', 'scripts', 'report.mjs'), '--run', run], { stdio: 'pipe' });
  const out = JSON.parse(fs.readFileSync(path.join(run, 'findings.json'), 'utf8'));
  const md = fs.readFileSync(path.join(run, 'report.md'), 'utf8');
  const html = fs.readFileSync(path.join(run, 'report.html'), 'utf8');
  check('T15', 'report: traceability in findings.json (1/3 pass)', out.traceability?.passedRequirements === 1 && out.traceability.requirements.length === 3);
  check('T16', 'report: test-cases.csv written', fs.existsSync(path.join(run, 'test-cases.csv')));
  check('T17', 'report: preconditions, type, requirement and impact shown', /Preconditions:\*\* Signed in/.test(md) && /Missing validation/.test(md) && /Requirement: AC-2/.test(md) && /Impact \/ risk/.test(html));
  check('T18', 'report: open questions section', /Open questions[\s\S]*limit include the owner/.test(md));
  check('T19', 'report: uncovered requirement listed as a warning', /AC-3: traceability gap/.test(md));
  check('T20', 'report: no traceability section when there are no requirements', (() => {
    const r2 = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-req-'));
    execFileSync(process.execPath, [path.join(here, '..', 'scripts', 'report.mjs'), '--run', r2], { stdio: 'pipe' });
    const ok = !/traceability/i.test(fs.readFileSync(path.join(r2, 'report.md'), 'utf8')) && !fs.existsSync(path.join(r2, 'test-cases.csv'));
    fs.rmSync(r2, { recursive: true, force: true });
    return ok;
  })());
} finally { fs.rmSync(run, { recursive: true, force: true }); }

const failed = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✘'} ${r.id}  ${r.what}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
