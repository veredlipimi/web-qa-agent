#!/usr/bin/env node
// Redirect map verification — for migrations, re-platforming and URL restructures.
// Given the redirect map the team promised (old → new), probe every old URL on the live
// origin and classify: PASS · WRONG-TARGET · WRONG-STATUS · CHAIN · MISSING · ERROR.
// Read-only: GET/HEAD with redirect: manual.
//
// Usage: node redirect-check.mjs --map redirects.csv --origin https://www.example.com --out run
//        [--expect-status 301] [--concurrency 6] [--timeout-ms 15000]
//        [--engine auto|builtin|/path/to/cutovergate] [--exceptions exceptions.json]
// Map formats: CSV "from,to" (header optional) or JSON [{ "from": "/old", "to": "/new" }].
//
// Engine: when CutoverGate (https://github.com/veredlipimi/cutovergate) is installed, it does the
// probing — same classification, exceptions with TTL, delta and its own HTML report — and its run is
// converted to this file's format. Otherwise the small built-in prober below is used.
// CutoverGate is looked up at --engine, $CUTOVERGATE, ~/cutovergate, ~/.claude/skills/cutovergate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs, need, writeJson } from './lib.mjs';

const args = parseArgs();
const mapFile = need(args, 'map', 'CSV or JSON of old → new paths');
const origin = String(need(args, 'origin')).replace(/\/$/, '');
const outDir = need(args, 'out');
const expectStatus = args['expect-status'] ? Number(args['expect-status']) : 301;
const conc = Number(args.concurrency || 6);
const timeout = Number(args['timeout-ms'] || 15000);

// ---- CutoverGate engine
function findCutoverGate() {
  if (args.engine === 'builtin') return null;
  const c = [args.engine !== 'auto' && args.engine, process.env.CUTOVERGATE, path.join(os.homedir(), 'cutovergate'), path.join(os.homedir(), '.claude', 'skills', 'cutovergate')].filter(x => typeof x === 'string');
  return c.find(p => fs.existsSync(path.join(p, 'bin', 'cutovergate.mjs')) && fs.existsSync(path.join(p, 'src', 'agent-bridge.mjs'))) || null;
}
const cg = findCutoverGate();
if (cg) {
  const cgOut = path.join(outDir, 'cutovergate');
  const cgArgs = [path.join(cg, 'bin', 'cutovergate.mjs'), 'probe', '--map', mapFile, '--origin', origin, '--out', cgOut, '--json',
    '--accept', String(expectStatus), '--concurrency', String(conc), '--timeout-ms', String(timeout), '--history', path.join(path.dirname(path.resolve(outDir)), 'history', 'redirects'),
    ...(args.exceptions ? ['--exceptions', args.exceptions] : [])];
  const out = await new Promise(resolve => {
    const child = spawn(process.execPath, cgArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let so = '', se = '';
    child.stdout.on('data', d => { so += d; }); child.stderr.on('data', d => { se += d; });
    child.on('close', code => resolve({ code, so, se }));
  });
  let run = null;
  try { run = JSON.parse(out.so); } catch {}
  if (run?.results) {
    const { toAgentFindings } = await import(pathToFileURL(path.join(cg, 'src', 'agent-bridge.mjs')).href);
    const res = toAgentFindings(run);
    writeJson(path.join(outDir, 'findings.redirects.json'), res);
    console.log(`[redirects] engine=cutovergate gate=${res.gate.status} ${res.results.length} rules`, res.tally, `report: ${res.reports.html}`);
    process.exit(res.findings.some(f => f.severity === 'High') ? 1 : 0);
  }
  console.error(`[redirects] CutoverGate at ${cg} did not produce a run (${(out.se || '').trim().split('\n').pop() || `exit ${out.code}`}) — using the built-in prober`);
}

const raw = fs.readFileSync(mapFile, 'utf8');
let rules = [];
if (mapFile.endsWith('.json')) rules = JSON.parse(raw).map(r => ({ from: r.from, to: r.to }));
else rules = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => l.split(/[,\t]/).map(x => x.trim().replace(/^"|"$/g, '')))
  .filter(([a, b]) => a && b && !/^from$/i.test(a)).map(([from, to]) => ({ from, to }));

const abs = (p) => (/^https?:/i.test(p) ? p : origin + (p.startsWith('/') ? p : `/${p}`));
const samePath = (a, b) => {
  try { const x = new URL(a, origin), y = new URL(b, origin);
    const n = (u) => (u.pathname.replace(/\/+$/, '') || '/').toLowerCase() + u.search;
    return (x.host === y.host || !/^https?:/i.test(b)) && n(x) === n(y);
  } catch { return a === b; }
};

async function probe(rule) {
  const url = abs(rule.from);
  const hops = [];
  let current = url;
  try {
    for (let i = 0; i < 5; i++) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
      let r = await fetch(current, { method: 'HEAD', redirect: 'manual', signal: ctrl.signal }).catch(() => null);
      if (!r || r.status === 405 || r.status === 501) r = await fetch(current, { method: 'GET', redirect: 'manual', signal: ctrl.signal });
      clearTimeout(t);
      const loc = r.headers.get('location');
      hops.push({ url: current, status: r.status, location: loc });
      if (r.status >= 300 && r.status < 400 && loc) { current = new URL(loc, current).toString(); continue; }
      break;
    }
  } catch (e) {
    return { ...rule, result: 'ERROR', detail: String(e.cause?.code || e.message || e).slice(0, 120), hops };
  }
  const first = hops[0];
  const isRedirect = first && first.status >= 300 && first.status < 400;
  if (!isRedirect) return { ...rule, result: 'MISSING', detail: `HTTP ${first?.status}`, hops };
  const final = hops.at(-1);
  const finalUrl = final.url;
  if (!samePath(finalUrl, abs(rule.to)) && !samePath(new URL(first.location, url).toString(), abs(rule.to)))
    return { ...rule, result: 'WRONG-TARGET', detail: `→ ${new URL(first.location, url).pathname}`, hops };
  if (hops.length > 2) return { ...rule, result: 'CHAIN', detail: `${hops.length - 1} hops`, hops };
  if (final.status >= 400) return { ...rule, result: 'WRONG-TARGET', detail: `target returns ${final.status}`, hops };
  if (expectStatus && first.status !== expectStatus) return { ...rule, result: 'WRONG-STATUS', detail: `${first.status} instead of ${expectStatus}`, hops };
  return { ...rule, result: 'PASS', detail: `${first.status}`, hops };
}

const results = [];
for (let i = 0; i < rules.length; i += conc) results.push(...await Promise.all(rules.slice(i, i + conc).map(probe)));

const SEV = { MISSING: 'High', 'WRONG-TARGET': 'High', ERROR: 'Medium', CHAIN: 'Low', 'WRONG-STATUS': 'Low' };
const findings = results.filter(r => r.result !== 'PASS').map(r => ({
  source: 'auto', ruleId: `redirect-${r.result.toLowerCase()}`, category: 'Redirects', severity: SEV[r.result],
  confidence: r.result === 'ERROR' ? 'verify' : 'confirmed', page: abs(r.from), viewport: 'desktop',
  title: `Redirect ${r.result}: ${r.from} → ${r.to}`,
  steps: [`Request ${abs(r.from)} without following redirects`, 'Check the status and Location header'],
  expected: `${expectStatus} → ${r.to}`, actual: r.detail,
  remediation: r.result === 'MISSING' ? 'Register the redirect (or restore the old URL).'
    : r.result === 'WRONG-TARGET' ? 'Point the redirect at the mapped target.'
    : r.result === 'CHAIN' ? 'Redirect straight to the final URL — chains lose link equity and add latency.'
    : r.result === 'WRONG-STATUS' ? 'Use a permanent 301 for moved content so search engines transfer ranking.' : 'Re-run; check connectivity or rate limiting.',
  evidence: { details: r.hops.map(h => `${h.status} ${h.url}${h.location ? ` → ${h.location}` : ''}`).join('\n') },
}));
const tally = results.reduce((a, r) => (a[r.result] = (a[r.result] || 0) + 1, a), {});
const coverage = [{ category: 'Redirects', page: origin, viewport: 'desktop', status: results.length ? 'tested' : 'not-tested', ...(results.length ? {} : { reason: 'Empty redirect map' }) }];
const notCovered = tally.ERROR ? [{ reason: `${tally.ERROR} redirect(s) could not be probed (network errors) — not counted as passes` }] : [];
writeJson(path.join(outDir, 'findings.redirects.json'), { engine: 'builtin', origin, map: path.basename(mapFile), tally, results: results.map(({ hops, ...r }) => r), findings, coverage, notCovered });
console.log(`[redirects] engine=builtin ${results.length} rules`, tally);
process.exit(findings.some(f => f.severity === 'High') ? 1 : 0);
