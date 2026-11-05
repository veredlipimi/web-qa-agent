// Release gate, waivers and run-to-run delta for report.mjs.
// Ideas: a gate that blocks release until effective failures = 0, waivers that need a
// reason and an expiry, strict mode, and a delta panel (regressions / new / fixed).
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './lib.mjs';

const pathOf = (u) => { try { return new URL(u).pathname; } catch { return String(u || ''); } };
const norm = (s) => String(s || '').toLowerCase().replace(/\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').trim();

// Stable across runs: rule + normalized original title (+ page for single-page gaps).
export function fingerprint(g) {
  const pages = [...new Set((g.occurrences || []).map(o => pathOf(o.page)))].sort();
  const where = pages.length === 1 ? pages[0] : '*';
  return `${g.ruleId || 'manual'}|${where}|${norm(g.originalTitle || g.title)}`;
}

export function loadGateConfig(run) {
  const candidates = [path.join(run, 'qa-gate.json'), path.join(path.dirname(run), 'qa-gate.json'), path.join(process.cwd(), 'qa-gate.json')];
  for (const c of candidates) if (fs.existsSync(c)) return { ...defaults(), ...readJson(c, {}), source: c };
  return { ...defaults(), source: null };
}
const defaults = () => ({ blockOn: ['Critical', 'High'], strict: false, waivers: [] });

const matches = (g, m) => {
  const t = `${g.title} ${g.originalTitle || ''}`.toLowerCase();
  return g.id === m || g.ruleId === m || t.includes(String(m).toLowerCase());
};

export function evaluateGate(gaps, coverageRows, cfg, today = new Date()) {
  const waived = [], expired = [], invalid = [];
  const active = (cfg.waivers || []).filter(w => {
    if (!w.reason || !String(w.reason).trim()) { invalid.push({ ...w, problem: 'missing reason' }); return false; }
    if (w.expires && new Date(w.expires) < today) { expired.push(w); return false; }
    return true;
  });
  const blocking = [];
  for (const g of gaps) {
    if (!cfg.blockOn.includes(g.severity)) continue;
    const w = active.find(w => matches(g, w.match));
    if (w) { g.waiver = w; waived.push({ id: g.id, title: g.title, reason: w.reason, expires: w.expires || null }); continue; }
    blocking.push({ id: g.id, severity: g.severity, title: g.title });
  }
  const strictBlocks = cfg.strict
    ? coverageRows.filter(r => r.notTested + r.blocked > 0).map(r => ({ category: r.category, notTested: r.notTested, blocked: r.blocked, reasons: r.reasons }))
    : [];
  const status = blocking.length || strictBlocks.length ? 'FAIL' : 'PASS';
  return { status, blockOn: cfg.blockOn, strict: !!cfg.strict, blocking, strictBlocks, waived, expiredWaivers: expired, invalidWaivers: invalid, config: cfg.source };
}

// History lives next to the runs: qa-runs/history/<host>.json (last 20 runs).
export function computeDelta(run, host, gaps) {
  const histDir = path.join(path.dirname(path.resolve(run)), 'history');
  const file = path.join(histDir, `${host.replace(/[^a-z0-9.-]/gi, '_')}.json`);
  const hist = readJson(file, { runs: [] });
  const now = Object.fromEntries(gaps.map(g => [fingerprint(g), { id: g.id, severity: g.severity, title: g.title }]));
  const prev = hist.runs.filter(r => r.run !== path.resolve(run)).at(-1);
  const older = hist.runs.filter(r => r.run !== path.resolve(run)).slice(0, -1);
  let delta = null;
  if (prev) {
    const regressions = [], added = [], fixed = [];
    for (const [fp, g] of Object.entries(now)) {
      if (prev.fingerprints[fp]) continue;
      (older.some(r => r.fingerprints[fp]) ? regressions : added).push(g);
    }
    for (const [fp, g] of Object.entries(prev.fingerprints)) if (!now[fp]) fixed.push(g);
    delta = { previousRun: prev.run, previousAt: prev.at, regressions, added, fixed };
  }
  hist.runs = [...hist.runs.filter(r => r.run !== path.resolve(run)), { run: path.resolve(run), at: new Date().toISOString(), fingerprints: now }].slice(-20);
  writeJson(file, hist);
  return delta;
}
