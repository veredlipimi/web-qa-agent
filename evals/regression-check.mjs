#!/usr/bin/env node
// Deterministic regression test for the web-qa-agent scripts.
// Starts demo-app, runs preflight → crawl → audit → field-matrix → report, then checks
// every expectation in expectations.json. Run after ANY change to scripts/ or rules.
// Usage: node evals/regression-check.mjs [--keep] [--port 4321]
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', 'scripts');
const argv = process.argv.slice(2);
const port = Number(argv[argv.indexOf('--port') + 1]) || 4321;
const keep = argv.includes('--keep');
const base = `http://localhost:${port}`;
const run = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-eval-'));
const exp = JSON.parse(fs.readFileSync(path.join(here, 'expectations.json'), 'utf8'));

const server = spawn(process.execPath, [path.join(here, 'demo-app', 'server.mjs'), '--port', String(port)], { stdio: 'ignore' });
const cleanup = () => { try { server.kill(); } catch {} if (!keep) fs.rmSync(run, { recursive: true, force: true }); };
process.on('exit', cleanup);
await new Promise(r => setTimeout(r, 600));

const step = (name, file, args) => {
  const t = Date.now();
  try { execFileSync(process.execPath, [path.join(scripts, file), ...args], { stdio: 'pipe', timeout: 600000 }); }
  catch (e) { if (name !== 'preflight') { console.error(`✘ ${name} crashed:\n${e.stderr || e.message}`); process.exit(1); } }
  console.log(`  · ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
};
console.log(`Running pipeline against demo-app → ${run}`);
step('preflight', 'preflight.mjs', ['--url', base + '/', '--out', run]);
step('crawl', 'crawl.mjs', ['--url', base + '/', '--out', run, '--max-pages', '15']);
step('audit', 'audit.mjs', ['--sitemap', path.join(run, 'sitemap.json'), '--out', run, '--viewports', 'mobile,desktop']);
step('field-matrix', 'field-matrix.mjs', ['--sitemap', path.join(run, 'sitemap.json'), '--out', run]);
step('report', 'report.mjs', ['--run', run, '--lang', 'en', '--title', 'Eval']);

const out = JSON.parse(fs.readFileSync(path.join(run, 'findings.json'), 'utf8'));
// Flatten grouped gaps back to (rule, page, title) occurrences.
const occ = out.gaps.flatMap(g => g.occurrences.map(o => ({ rule: g.ruleId, page: o.page, title: g.title })));
const pathOf = u => { try { return new URL(u).pathname; } catch { return u; } };
const hit = (e) => occ.filter(o => o.rule === e.rule
  && (!e.page || (e.page === '/' ? pathOf(o.page) === '/' : pathOf(o.page).includes(e.page)))
  && (!e.title || o.title.toLowerCase().includes(e.title.toLowerCase())));

const results = [];
for (const e of exp.find) results.push({ id: e.id, ok: hit(e).length > 0, what: e.what });
for (const e of exp.notFind) results.push({ id: e.id, ok: hit(e).length === 0, what: `NOT: ${e.why}` });
const cov = [...(JSON.parse(fs.readFileSync(path.join(run, 'findings.auto.json'), 'utf8')).coverage || []),
  ...(JSON.parse(fs.readFileSync(path.join(run, 'findings.fields.json'), 'utf8')).coverage || [])];
for (const c of exp.coverage) results.push({ id: c.id, what: `coverage ${c.category}=${c.status} on ${c.page}`,
  ok: cov.some(x => x.category === c.category && x.status === c.status && pathOf(x.page).includes(c.page)) });
results.push({ id: 'R01', what: `verdict contains "${exp.report.verdictContains}"`, ok: out.verdict.includes(exp.report.verdictContains) });
results.push({ id: 'R02', what: `coverage ≥ ${exp.report.minCoveragePercent}% (got ${out.coverage.percent}%)`, ok: out.coverage.percent >= exp.report.minCoveragePercent });
results.push({ id: 'R03', what: 'report.html, report.md, findings.csv exist', ok: ['report.html', 'report.md', 'findings.csv'].every(f => fs.existsSync(path.join(run, f))) });
results.push({ id: 'R04', what: 'no node_modules in run folder', ok: !fs.existsSync(path.join(run, 'node_modules')) });
results.push({ id: 'R05', what: 'every gap has steps + expected + actual', ok: out.gaps.every(g => g.steps?.length && g.expected && g.actual) });
results.push({ id: 'R06', what: 'every gap has a screenshot or details', ok: out.gaps.every(g => g.occurrences.some(o => o.screenshot) || g.evidence?.details) });

const failed = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✘'} ${r.id}  ${r.what}`);
console.log(`\n${results.length - failed.length}/${results.length} passed${keep ? ` · run kept at ${run}` : ''}`);
process.exit(failed.length ? 1 : 0);
