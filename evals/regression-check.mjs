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
const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-eval-'));
const run = path.join(baseDir, 'run-a'); fs.mkdirSync(run);
const exp = JSON.parse(fs.readFileSync(path.join(here, 'expectations.json'), 'utf8'));

const server = spawn(process.execPath, [path.join(here, 'demo-app', 'server.mjs'), '--port', String(port)], { stdio: 'ignore' });
const cleanup = () => { try { server.kill(); } catch {} if (!keep) fs.rmSync(baseDir, { recursive: true, force: true }); };
process.on('exit', cleanup);
await new Promise(r => setTimeout(r, 600));

const step = (name, file, args) => {
  const t = Date.now();
  try { execFileSync(process.execPath, [path.join(scripts, file), ...args], { stdio: 'pipe', timeout: 600000 }); }
  catch (e) { if (!['preflight', 'redirects'].includes(name)) { console.error(`✘ ${name} crashed:\n${e.stderr || e.message}`); process.exit(1); } }
  console.log(`  · ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
};
console.log(`Running pipeline against demo-app → ${run}`);
step('preflight', 'preflight.mjs', ['--url', base + '/', '--out', run]);
step('crawl', 'crawl.mjs', ['--url', base + '/', '--out', run, '--max-pages', '15']);
step('audit', 'audit.mjs', ['--sitemap', path.join(run, 'sitemap.json'), '--out', run, '--viewports', 'mobile,desktop']);
step('field-matrix', 'field-matrix.mjs', ['--sitemap', path.join(run, 'sitemap.json'), '--out', run]);
step('redirects', 'redirect-check.mjs', ['--map', path.join(here, 'demo-app', 'redirects.csv'), '--origin', base_url(), '--out', run, '--engine', 'builtin']);
// Same map through CutoverGate when it is available (sibling checkout or $CUTOVERGATE): both engines must agree.
const cgPath = [process.env.CUTOVERGATE, path.join(here, '..', '..', 'cutovergate'), path.join(os.homedir(), 'cutovergate')].find(p => p && fs.existsSync(path.join(p, 'src', 'agent-bridge.mjs')));
const runCg = path.join(baseDir, 'run-cg'); fs.mkdirSync(runCg);
if (cgPath) step('redirects', 'redirect-check.mjs', ['--map', path.join(here, 'demo-app', 'redirects.csv'), '--origin', base_url(), '--out', runCg, '--engine', cgPath]);
// Gate config with one valid waiver, one expired and one without a reason.
fs.writeFileSync(path.join(run, 'qa-gate.json'), JSON.stringify({ blockOn: ['Critical', 'High'], waivers: [
  { match: 'broken-link', reason: 'Blog ships next sprint', expires: '2099-01-01' },
  { match: 'soft-404', reason: 'Old waiver', expires: '2000-01-01' },
  { match: 'api-5xx' } ] }));
step('report', 'report.mjs', ['--run', run, '--lang', 'en', '--title', 'Eval']);
function base_url() { return `http://localhost:${port}`; }

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

// ---- Redirect map classification
const red = JSON.parse(fs.readFileSync(path.join(run, 'findings.redirects.json'), 'utf8'));
const byFrom = Object.fromEntries(red.results.map(r => [r.from, r.result]));
for (const [from, want] of Object.entries(exp.redirects)) results.push({ id: `D-${from}`, what: `redirect ${from} = ${want} (got ${byFrom[from]})`, ok: byFrom[from] === want });
if (cgPath) {
  const cg = JSON.parse(fs.readFileSync(path.join(runCg, 'findings.redirects.json'), 'utf8'));
  const cgBy = Object.fromEntries(cg.results.map(r => [r.from, r.result]));
  results.push({ id: 'D-CG0', what: `CutoverGate engine used (${cgPath})`, ok: cg.engine === 'cutovergate' && fs.existsSync(cg.reports.html) });
  for (const [from, want] of Object.entries(exp.redirects)) results.push({ id: `D-CG${from}`, what: `CutoverGate: ${from} = ${want} (got ${cgBy[from]})`, ok: cgBy[from] === want });
} else console.log('  · CutoverGate not found — engine parity checks skipped (set $CUTOVERGATE to run them)');

// ---- Gate & waivers
results.push({ id: 'G01', what: 'valid waiver applied (broken-link)', ok: out.gate.waived.some(w => /blog/i.test(w.title)) });
results.push({ id: 'G02', what: 'expired waiver not applied', ok: out.gate.expiredWaivers.length === 1 && !out.gate.waived.some(w => /not found/i.test(w.title)) });
results.push({ id: 'G03', what: 'waiver without reason rejected', ok: out.gate.invalidWaivers.length === 1 && out.gate.blocking.some(b => /500/.test(b.title)) });
results.push({ id: 'G04', what: 'gate FAILs with Critical present', ok: out.gate.status === 'FAIL' });
let gateExit = 0; try { execFileSync(process.execPath, [path.join(scripts, 'report.mjs'), '--run', run, '--gate'], { stdio: 'pipe' }); } catch (e) { gateExit = e.status; }
results.push({ id: 'G05', what: `--gate exits 1 on FAIL (got ${gateExit})`, ok: gateExit === 1 });

// ---- Delta across runs (history in the parent folder)
const runB = path.join(baseDir, 'run-b'); fs.cpSync(run, runB, { recursive: true });
const autoB = JSON.parse(fs.readFileSync(path.join(runB, 'findings.auto.json'), 'utf8'));
autoB.findings = autoB.findings.filter(f => f.ruleId !== 'api-5xx'); fs.writeFileSync(path.join(runB, 'findings.auto.json'), JSON.stringify(autoB));
fs.writeFileSync(path.join(runB, 'findings.manual.json'), JSON.stringify({ findings: [{ id: 'EXP-001', ruleId: 'explore-cart', category: 'Functional', severity: 'High', title: 'Cart shows quantity 1 after adding twice', page: base_url() + '/cart', viewport: 'desktop', steps: ['Add twice'], expected: 'qty 2', actual: 'qty 1', evidence: { details: 'x' } }] }));
execFileSync(process.execPath, [path.join(scripts, 'report.mjs'), '--run', runB], { stdio: 'pipe' });
const dB = JSON.parse(fs.readFileSync(path.join(runB, 'findings.json'), 'utf8')).delta;
results.push({ id: 'H01', what: 'delta: removed gap reported as fixed', ok: !!dB && dB.fixed.some(g => /500/.test(g.title)) });
results.push({ id: 'H02', what: 'delta: new manual gap reported as new', ok: !!dB && dB.added.some(g => /quantity/i.test(g.title)) });
const runC = path.join(baseDir, 'run-c'); fs.cpSync(run, runC, { recursive: true });
execFileSync(process.execPath, [path.join(scripts, 'report.mjs'), '--run', runC], { stdio: 'pipe' });
const dC = JSON.parse(fs.readFileSync(path.join(runC, 'findings.json'), 'utf8')).delta;
results.push({ id: 'H03', what: 'delta: gap that came back is a regression', ok: !!dC && dC.regressions.some(g => /500/.test(g.title)) });

// ---- Guard unit tests
let guardOk = true; try { execFileSync(process.execPath, [path.join(here, 'guard-check.mjs')], { stdio: 'pipe' }); } catch { guardOk = false; }
results.push({ id: 'K01', what: 'enforcement guard: all unit checks pass', ok: guardOk });
let reqOk = true; try { execFileSync(process.execPath, [path.join(here, 'requirements-check.mjs')], { stdio: 'pipe' }); } catch { reqOk = false; }
results.push({ id: 'T00', what: 'requirements traceability: all unit checks pass (requirements-check.mjs)', ok: reqOk });

const failed = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✘'} ${r.id}  ${r.what}`);
console.log(`\n${results.length - failed.length}/${results.length} passed${keep ? ` · run kept at ${baseDir}` : ''}`);
process.exit(failed.length ? 1 : 0);
