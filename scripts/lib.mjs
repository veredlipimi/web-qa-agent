// Shared helpers for crawl / audit / report.
import fs from 'node:fs';
import path from 'node:path';

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

export function need(args, key, hint) {
  if (!args[key]) {
    console.error(`Missing --${key}${hint ? ` (${hint})` : ''}`);
    process.exit(2);
  }
  return args[key];
}

export const VIEWPORTS = {
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  tablet: { width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
};

// Launch Chromium. Set QA_CHROME_PATH to use an existing Chrome/Chromium instead of
// Playwright's downloaded build (e.g. on locked-down machines).
export async function launchBrowser() {
  const { chromium } = await import('playwright');
  const executablePath = process.env.QA_CHROME_PATH || undefined;
  return chromium.launch({ executablePath, headless: process.env.QA_HEADED ? false : true });
}

export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }
export function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
export function writeJson(p, data) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

export function slug(s, max = 60) {
  return String(s).replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, max) || 'root';
}

export function normalizeUrl(href, base) {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    // Drop common tracking params so we don't crawl duplicates.
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch { return null; }
}

export function inScope(url, rootUrl, extraHosts = []) {
  try {
    const u = new URL(url); const r = new URL(rootUrl);
    return u.host === r.host || extraHosts.includes(u.host);
  } catch { return false; }
}

// Waits for what a real user would see: load + network idle + settle.
// Returns which waits timed out, so callers can mark results as partial instead of passing.
export async function settle(page, { timeout = 30000, settleMs = 1000 } = {}) {
  const r = { loadTimedOut: false, idleTimedOut: false };
  try { await page.waitForLoadState('load', { timeout }); } catch { r.loadTimedOut = true; }
  try { await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 15000) }); } catch { r.idleTimedOut = true; }
  try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch {}
  await page.waitForTimeout(settleMs);
  return r;
}

export const LOGIN_PATH = /\/(login|log-in|signin|sign-in|auth|account\/login|התחברות)(\/|$|\?)/i;

// Coverage: every check gets an explicit outcome so a clean report is never read as full coverage.
// status: tested | not-tested | blocked | n/a
export const CATEGORIES = ['Functional', 'API/Network', 'Accessibility', 'Performance', 'Responsive', 'RTL/i18n', 'SEO', 'Security'];

// Scroll through the page so lazy-loaded images/sections render, then return to top.
export async function scrollThrough(page) {
  try {
    await page.evaluate(async () => {
      const step = Math.max(400, window.innerHeight * 0.8);
      for (let y = 0; y < document.documentElement.scrollHeight && y < 30000; y += step) {
        window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
    await page.waitForTimeout(300);
  } catch {}
}

// Inert marker for passive reflection checks: harmless markup, no script, no event handlers.
export const REFLECTION_MARKER = 'qa9probe"><i>z</i>';

export const SOFT_404_TEXT = /\b(404|not found|page not found|doesn'?t exist|no longer available)\b|לא נמצא|העמוד (?:לא קיים|שחיפשת)|דף לא נמצא|שגיאה 404/i;

export const HEBREW_OR_ARABIC = /[֐-׿؀-ۿ]/;

// Default severities per rule. The agent may adjust during triage (see references/severity.md).
export const RULES = {
  'console-error':        { category: 'Functional',    severity: 'Medium' },
  'page-exception':       { category: 'Functional',    severity: 'High' },
  'page-http-error':      { category: 'Functional',    severity: 'Critical' },
  'broken-link':          { category: 'Functional',    severity: 'Medium' },
  'broken-image':         { category: 'UI/UX',         severity: 'Medium' },
  'api-5xx':              { category: 'API/Network',   severity: 'High' },
  'api-4xx':              { category: 'API/Network',   severity: 'Medium' },
  'request-failed':       { category: 'API/Network',   severity: 'Medium' },
  'api-slow':             { category: 'API/Network',   severity: 'Low' },
  'api-duplicate':        { category: 'API/Network',   severity: 'Low' },
  'a11y-critical':        { category: 'Accessibility', severity: 'High' },
  'a11y-serious':         { category: 'Accessibility', severity: 'Medium' },
  'a11y-moderate':        { category: 'Accessibility', severity: 'Low' },
  'a11y-minor':           { category: 'Accessibility', severity: 'Info' },
  'tap-target-small':     { category: 'Accessibility', severity: 'Low' },
  'perf-lcp':             { category: 'Performance',   severity: 'Medium' },
  'perf-cls':             { category: 'Performance',   severity: 'Medium' },
  'perf-ttfb':            { category: 'Performance',   severity: 'Low' },
  'perf-weight':          { category: 'Performance',   severity: 'Low' },
  'layout-overflow':      { category: 'Responsive',    severity: 'Medium' },
  'seo-title':            { category: 'SEO',           severity: 'Low' },
  'seo-description':      { category: 'SEO',           severity: 'Low' },
  'seo-h1':               { category: 'SEO',           severity: 'Low' },
  'seo-lang':             { category: 'SEO',           severity: 'Low' },
  'seo-viewport':         { category: 'Responsive',    severity: 'High' },
  'seo-canonical':        { category: 'SEO',           severity: 'Info' },
  'seo-noindex':          { category: 'SEO',           severity: 'Info' },
  'sec-header':           { category: 'Security',      severity: 'Low' },
  'sec-hsts':             { category: 'Security',      severity: 'Medium' },
  'sec-cookie':           { category: 'Security',      severity: 'Medium' },
  'sec-mixed-content':    { category: 'Security',      severity: 'High' },
  'sec-exposed-file':     { category: 'Security',      severity: 'Critical' },
  'sec-version-leak':     { category: 'Security',      severity: 'Low' },
  'sec-no-https':         { category: 'Security',      severity: 'High' },
  'soft-404':             { category: 'Functional',    severity: 'Medium' },
  'sec-reflected-input':  { category: 'Security',      severity: 'High' },
  'rtl-container-only':   { category: 'RTL/i18n',      severity: 'Low' },
  'rtl-dir-missing':      { category: 'RTL/i18n',      severity: 'Medium' },
  'rtl-text-align':       { category: 'RTL/i18n',      severity: 'Low' },
  'rtl-input-dir':        { category: 'RTL/i18n',      severity: 'Low' },
};

export const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low', 'Info'];

export function makeFinding(ruleId, fields) {
  const rule = RULES[ruleId] || { category: 'Other', severity: 'Low' };
  return {
    ruleId,
    category: rule.category,
    severity: rule.severity,
    source: 'auto',
    ...fields,
  };
}
