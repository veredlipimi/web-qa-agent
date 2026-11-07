// Requirements traceability: requirement → test cases → result → gaps.
// Used by report.mjs when the run folder has requirements.json and test-cases.json (Phase 2/4).
//
// requirements.json  { "source": "where they came from", "items": [{ "id": "AC-1", "text": "…", "source": "TICKET-12" }] }
// test-cases.json    { "cases": [{ "id": "TC-001", "requirement": "AC-1" | ["AC-1","AC-2"], "area": "Checkout",
//                       "title": "…", "preconditions": "…", "steps": ["…"], "verify": ["…"], "viewport": "mobile",
//                       "status": "PASS|FAIL|PARTIAL|NOT_IMPLEMENTED|NOT_VERIFIABLE|NOT_TESTED",
//                       "gaps": ["EXP-001"], "notes": "…" }] }
//
// Black-box meaning of the statuses (judged from what a user can do, never from source code):
//   PASS             every Verify line was observed
//   FAIL             a Verify line was contradicted — must link the gap that shows it
//   PARTIAL          some Verify lines observed, some contradicted or missing — link the gap
//   NOT_IMPLEMENTED  the behaviour the requirement describes is not reachable in the UI at all
//   NOT_VERIFIABLE   can't be judged from outside (back-office effect, email, payment, missing data) — say why
//   NOT_TESTED       planned but not run (time, budget, blocked) — say why
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './lib.mjs';

export const CASE_STATUSES = ['PASS', 'FAIL', 'PARTIAL', 'NOT_IMPLEMENTED', 'NOT_VERIFIABLE', 'NOT_TESTED'];
const BAD = new Set(['FAIL', 'PARTIAL', 'NOT_IMPLEMENTED']);
const OPEN = new Set(['NOT_VERIFIABLE', 'NOT_TESTED']);

const list = v => (Array.isArray(v) ? v : v ? [v] : []).map(String);
const norm = s => String(s || 'NOT_TESTED').trim().toUpperCase().replace(/[\s-]+/g, '_');

/** Roll the cases of one requirement into one status. */
export function rollUp(statuses) {
  if (!statuses.length) return 'NO_TESTS';
  if (statuses.includes('NOT_IMPLEMENTED')) return 'NOT_IMPLEMENTED';
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.every(s => s === 'PASS')) return 'PASS';
  if (statuses.includes('PARTIAL') || statuses.includes('PASS')) return 'PARTIAL';
  if (statuses.every(s => s === 'NOT_VERIFIABLE')) return 'NOT_VERIFIABLE';
  return 'NOT_TESTED';
}

/**
 * @param reqs   requirements.json content
 * @param tcs    test-cases.json content
 * @param gapIds ids of the gaps in the final report (EXP-…, QA-…)
 */
export function traceability(reqs, tcs, gapIds = []) {
  const items = (reqs?.items || []).map(r => ({ id: String(r.id), text: r.text || '', source: r.source || '' }));
  const known = new Set(items.map(r => r.id));
  const ids = new Set(gapIds.map(String));
  const warnings = [];
  const cases = (tcs?.cases || []).map((c, i) => {
    const status = CASE_STATUSES.includes(norm(c.status)) ? norm(c.status) : 'NOT_TESTED';
    const out = {
      id: String(c.id || `TC-${String(i + 1).padStart(3, '0')}`), requirement: list(c.requirement), area: c.area || '',
      title: c.title || '', preconditions: c.preconditions || '', steps: list(c.steps), verify: list(c.verify),
      viewport: c.viewport || '', status, gaps: list(c.gaps), notes: c.notes || '',
    };
    if (!CASE_STATUSES.includes(norm(c.status))) warnings.push({ case: out.id, problem: `unknown status "${c.status}" — counted as NOT_TESTED` });
    if (!out.requirement.length && items.length) warnings.push({ case: out.id, problem: 'not linked to any requirement' });
    for (const r of out.requirement) if (items.length && !known.has(r)) warnings.push({ case: out.id, problem: `links to unknown requirement ${r}` });
    if (BAD.has(status) && !out.gaps.length) warnings.push({ case: out.id, problem: `${status} without a linked gap — no evidence` });
    for (const g of out.gaps) if (!ids.has(g)) warnings.push({ case: out.id, problem: `links to gap ${g}, which is not in the report` });
    if (OPEN.has(status) && !out.notes) warnings.push({ case: out.id, problem: `${status} without a reason in notes` });
    if (!out.steps.length || !out.verify.length) warnings.push({ case: out.id, problem: 'needs both steps and verify lines' });
    return out;
  });
  const rows = items.map(r => {
    const mine = cases.filter(c => c.requirement.includes(r.id));
    const status = rollUp(mine.map(c => c.status));
    if (status === 'NO_TESTS') warnings.push({ requirement: r.id, problem: 'traceability gap — no test case covers this requirement' });
    return { ...r, cases: mine.map(c => c.id), status, gaps: [...new Set(mine.flatMap(c => c.gaps))] };
  });
  const byStatus = s => cases.filter(c => c.status === s).length;
  const counts = Object.fromEntries(CASE_STATUSES.map(s => [s, byStatus(s)]));
  const reqCounts = rows.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
  return { source: reqs?.source || '', requirements: rows, cases, counts, reqCounts, warnings,
    passedRequirements: rows.filter(r => r.status === 'PASS').length };
}

export function loadTraceability(run, gapIds) {
  const rf = path.join(run, 'requirements.json'), tf = path.join(run, 'test-cases.json');
  if (!fs.existsSync(rf) && !fs.existsSync(tf)) return null;
  return traceability(readJson(rf, { items: [] }), readJson(tf, { cases: [] }), gapIds);
}

/** Google Sheets-ready CSV: one row per test case, multi-line cells for steps and verify. */
export function testCasesCsv(t) {
  const cols = ['ID', 'Area', 'Requirement', 'Title', 'Preconditions', 'Steps', 'Verify', 'Viewport', 'Status', 'Notes', 'Gaps'];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = t.cases.map(c => [c.id, c.area, c.requirement.join(', '), c.title, c.preconditions,
    c.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'), c.verify.map(v => `- ${v}`).join('\n'),
    c.viewport, c.status, c.notes, c.gaps.join(', ')]);
  return '﻿' + [cols.join(','), ...rows.map(r => r.map(cell).join(','))].join('\n') + '\n';
}
