#!/usr/bin/env node
// Stop hook for the web-qa-agent skill: the run may not end until the finish rules hold
// (report built and current, evidence on every gap, reasons on everything not tested,
// independent verification of Critical/High gaps or an explained skip). See finish-rules.mjs.
//
// Loop safety: Claude Code sets stop_hook_active once a Stop hook has already sent the agent back.
// That flag alone is not a bound, so this hook carries its own: at most MAX_BLOCKS blocks per run.
// After that it lets the agent stop, writes <run>/finish-check.json (status "incomplete") and
// tells the user, so an unfinished run is never presented as finished.
import fs from 'node:fs';
import path from 'node:path';
import { findActiveRun, finishProblems } from './finish-rules.mjs';

const MAX_BLOCKS = 3;
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
let input = {};
try { input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { process.exit(0); } // never trap the user in a loop on bad input

const run = findActiveRun(input.cwd || process.cwd());
if (!run) process.exit(0);
const problems = finishProblems(run);
const stateFile = path.join(run, 'finish-check.json');
let state = {};
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}

if (!problems.length) {
  fs.writeFileSync(stateFile, JSON.stringify({ status: 'complete', checkedAt: new Date().toISOString(), blocks: 0 }, null, 2)); // reset: a later phase starts a fresh bound
  process.exit(0);
}
const blocks = (state.blocks || 0) + 1;
if (blocks > MAX_BLOCKS) {
  fs.writeFileSync(stateFile, JSON.stringify({ status: 'incomplete', checkedAt: new Date().toISOString(), blocks: state.blocks, problems }, null, 2));
  process.stdout.write(JSON.stringify({ systemMessage: `web-qa-agent: run ended with ${problems.length} open finish item(s) — see ${stateFile}. Treat this run as incomplete.` }));
  process.exit(0);
}
fs.writeFileSync(stateFile, JSON.stringify({ status: 'blocked', checkedAt: new Date().toISOString(), blocks, problems }, null, 2));
process.stdout.write(JSON.stringify({ decision: 'block', reason: `[web-qa-agent finish check ${blocks}/${MAX_BLOCKS}] The run is not finished:\n- ${problems.join('\n- ')}\nFix these, then finish. Do not mark anything as passed to get past this check.` }));
process.exit(0);
