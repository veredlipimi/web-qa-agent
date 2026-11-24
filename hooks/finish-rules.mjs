// Finish-gate rules for the Stop hook (finish-check.mjs). Pure functions over a run folder, so
// they can be unit-tested (evals/finish-check.mjs).
//
// Why a hook and not an instruction: SKILL.md says "finish with the report", "every gap has
// evidence", "not tested is not passed". Instructions are followed most of the time; a rule that
// must hold every time is checked by code when the agent tries to stop.
//
// The gate only applies once execution has started (Phase 3 output exists), so Phase 0 questions
// and the Phase 2 plan approval are never blocked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };
const mtime = p => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

const PHASE3 = ['findings.auto.json'];
const INPUTS = ['findings.auto.json', 'findings.fields.json', 'findings.manual.json', 'findings.redirects.json',
  'findings.actions.json', 'findings.secrets.json', 'verification.json', 'triage.json', 'suite-result.json'];

/** The active run: cwd itself if it is a run, else the newest fresh run under cwd's qa-runs/ or runs/,
 * else under $QA_RUNS_DIR, ~/qa/qa-runs or ~/qa-runs. Closer locations win over newer distant ones. */
export function findActiveRun(cwd, { maxAgeHours = 12, now = Date.now(), env = process.env } = {}) {
  const isRun = d => exists(path.join(d, 'sitemap.json'));
  const fresh = d => { try { return now - Math.max(...fs.readdirSync(d).map(f => mtime(path.join(d, f)))) < maxAgeHours * 3600e3; } catch { return false; } };
  if (isRun(cwd)) return fresh(cwd) ? path.resolve(cwd) : null;
  const tiers = [[path.join(cwd, 'qa-runs'), path.join(cwd, 'runs')],
    [env.QA_RUNS_DIR, path.join(os.homedir(), 'qa', 'qa-runs'), path.join(os.homedir(), 'qa-runs')].filter(Boolean)];
  for (const roots of tiers) {
    const runs = [];
    for (const r of roots) {
      let entries = [];
      try { entries = fs.readdirSync(r, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) { const d = path.resolve(r, e.name); if (e.isDirectory() && isRun(d) && fresh(d)) runs.push(d); }
    }
    const newest = d => Math.max(...fs.readdirSync(d).map(f => mtime(path.join(d, f))));
    if (runs.length) return runs.sort((a, b) => newest(b) - newest(a))[0];
  }
  return null;
}

/** What still has to happen before this run may end. [] = finished. */
export function finishProblems(run) {
  const p = f => path.join(run, f);
  if (!PHASE3.some(f => exists(p(f)))) return []; // still in intake / recon / plan: stopping is expected

  const problems = [];
  const findings = readJson(p('findings.json'));
  if (!findings) {
    problems.push('Execution started (Phase 3 output exists) but report.mjs has not run: finish Phases 4–6 and build the report. After plan approval the run does not stop midway.');
    return problems;
  }
  if (!exists(p('report.html'))) problems.push('findings.json exists but report.html is missing: rerun report.mjs.');
  const stale = INPUTS.filter(f => mtime(p(f)) > mtime(p('findings.json')) + 1000);
  if (stale.length) problems.push(`The report is older than ${stale.join(', ')}: rerun report.mjs so the report reflects them.`);

  // Evidence: every gap has steps, expected, actual and something checkable.
  for (const g of findings.gaps || []) {
    const missing = [];
    if (!(g.steps || []).length) missing.push('steps');
    if (!g.expected) missing.push('expected');
    if (!g.actual && !(g.occurrences || []).some(o => o.actual)) missing.push('actual');
    const hasEvidence = g.evidence?.screenshot || g.evidence?.details || g.evidence?.request || g.evidence?.log
      || (g.occurrences || []).some(o => o.screenshot || o.details);
    if (!hasEvidence) missing.push('evidence (screenshot, log or request)');
    if (missing.length) problems.push(`Gap ${g.id || g.title}: missing ${missing.join(', ')}.`);
  }

  // Not tested ≠ passed: every check that did not run says why.
  for (const r of findings.coverage?.byCategory || []) {
    if ((r.notTested || r.blocked) && !(r.reasons || []).length) problems.push(`Coverage "${r.category}": ${r.notTested + r.blocked} not tested/blocked with no reason.`);
  }
  for (const n of findings.notCovered || []) if (!n.reason) problems.push(`Not-covered entry${n.page ? ` for ${n.page}` : ''} has no reason.`);

  // Test cases: a FAIL links its gap; NOT_VERIFIABLE / NOT_TESTED give a reason.
  for (const t of findings.traceability?.cases || []) {
    if (t.status === 'FAIL' && !(t.gaps || []).length) problems.push(`Test case ${t.id}: FAIL without a linked gap.`);
    if (['NOT_VERIFIABLE', 'NOT_TESTED'].includes(t.status) && !t.notes) problems.push(`Test case ${t.id}: ${t.status} without a reason.`);
  }

  // Phase 5b: release-blocking gaps are checked by someone who did not find them, or the skip is explained.
  const blocking = (findings.gaps || []).filter(g => ['Critical', 'High'].includes(g.severity));
  if (blocking.length && !exists(p('verification.json')) && !readJson(p('verify/skipped.json'))?.reason) {
    problems.push(`${blocking.length} Critical/High gap(s) and no independent verification: run verify-pack.mjs and hand brief.md to a separate agent, or write verify/skipped.json {"reason": "..."} and say so in the report.`);
  }
  return problems;
}
