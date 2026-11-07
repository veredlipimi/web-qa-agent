#!/usr/bin/env node
// Reads <run>/suite/results.json (Playwright JSON reporter) and writes <run>/suite-result.json
// for report.mjs. Separates NOT TESTED (helpers/coverage.ts notTested) from passes and plain skips.
// Usage: node suite-summary.mjs --run qa-runs/x
import path from 'node:path';
import { parseArgs, need, readJson, writeJson } from './lib.mjs';

const run = need(parseArgs(), 'run');
const res = readJson(path.join(run, 'suite', 'results.json'), null);
if (!res) { console.error('No suite/results.json — run the suite first'); process.exit(1); }

const out = { passed: 0, failed: 0, skipped: 0, notTested: 0, expectedFail: 0, fixedGaps: 0, flaky: 0,
  notTestedList: [], failedList: [], fixedGapList: [], projects: [] };
const projects = new Set();
const walk = (suite, trail = []) => {
  for (const s of suite.suites || []) walk(s, [...trail, s.title].filter(Boolean));
  for (const spec of suite.specs || []) for (const t of spec.tests || []) {
    const name = `[${t.projectName}] ${[...trail, spec.title].join(' › ')}`;
    if (t.projectName) projects.add(t.projectName);
    const last = t.results?.[t.results.length - 1];
    const ann = [...(t.annotations || []), ...(last?.annotations || [])];
    const nt = ann.find(a => a.type === 'not-tested');
    if (nt) { out.notTested++; out.notTestedList.push({ test: name, reason: nt.description }); continue; }
    if (t.status === 'skipped') { out.skipped++; continue; }
    if (t.status === 'flaky') { out.flaky++; out.passed++; continue; }
    if (t.expectedStatus === 'failed') {
      if (last?.status === 'failed' || last?.status === 'timedOut') out.expectedFail++;
      else { out.fixedGaps++; out.fixedGapList.push(name); } // test.fail() but it passed → gap looks fixed
      continue;
    }
    if (t.status === 'expected') out.passed++;
    else { out.failed++; out.failedList.push({ test: name, error: (last?.error?.message || '').split('\n')[0].slice(0, 200) }); }
  }
};
for (const s of res.suites || []) walk(s);
out.projects = [...projects].sort();
writeJson(path.join(run, 'suite-result.json'), out);
console.log(`[suite] passed ${out.passed} · failed ${out.failed} · known gaps ${out.expectedFail} · gaps now passing ${out.fixedGaps} · NOT TESTED ${out.notTested} · skipped ${out.skipped}`);
for (const n of out.notTestedList) console.log(`  not tested: ${n.test} — ${n.reason}`);
