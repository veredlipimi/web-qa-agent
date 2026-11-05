#!/usr/bin/env node
// Phase 3 — Automated audit. For every crawled page × viewport, observe what a real user gets.
// Usage: node audit.mjs --sitemap run/sitemap.json --out run [--viewports mobile,tablet,desktop]
//        [--storage-state auth.json] [--skip-exposed-files]
import path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import {
  parseArgs, need, readJson, writeJson, launchBrowser, ensureDir, slug, settle, VIEWPORTS,
  makeFinding, HEBREW_OR_ARABIC, scrollThrough, LOGIN_PATH, CATEGORIES, REFLECTION_MARKER, SOFT_404_TEXT,
} from './lib.mjs';

const args = parseArgs();
const sitemap = readJson(need(args, 'sitemap'), null);
if (!sitemap) { console.error('Cannot read sitemap'); process.exit(2); }
const outDir = need(args, 'out');
const shotsDir = ensureDir(path.join(outDir, 'screenshots'));
const vpNames = String(args.viewports || 'mobile,tablet,desktop').split(',').filter(v => VIEWPORTS[v]);

const THRESH = { lcpMs: 2500, cls: 0.1, ttfbMs: 800, slowApiMs: 2000, weightBytes: 3 * 1024 * 1024, tapPx: 24 };

const findings = [];
const notCovered = [];
const add = (ruleId, f) => findings.push(makeFinding(ruleId, f));
const coverage = [];
const cover = (category, page, viewport, status, reason) => coverage.push({ category, page, viewport, status, ...(reason ? { reason } : {}) });
const coverAll = (page, viewport, status, reason, except = []) => CATEGORIES.filter(c => !except.includes(c)).forEach(c => cover(c, page, viewport, status, reason));

// Collect LCP / CLS from inside the page.
const PERF_INIT = `
  window.__qa = { lcp: 0, cls: 0 };
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__qa.lcp = e.startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__qa.cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
`;

const browser = await launchBrowser();
const pagesToAudit = sitemap.pages.filter(p => !p.error && p.status && p.status < 400);

// Pages that failed during crawl are findings in their own right.
for (const p of sitemap.pages) {
  if (p.error) { notCovered.push({ page: p.url, reason: `Could not load: ${p.error}` });
    for (const v of vpNames) coverAll(p.url, v, 'blocked', `Could not load: ${p.error}`); continue; }
  if (!(p.status >= 400)) continue;
  for (const v of vpNames) { cover('Functional', p.url, v, 'tested'); coverAll(p.url, v, 'blocked', `Page returned HTTP ${p.status}`, ['Functional']); }
  add(p.url === sitemap.startUrl ? 'page-http-error' : 'broken-link', {
    ...(p.url === sitemap.startUrl ? {} : { severity: 'High' }),
    title: p.url === sitemap.startUrl ? `Start page returns HTTP ${p.status}` : `Linked page returns HTTP ${p.status}: ${shortPath(p.url)}`,
    page: p.url, viewport: 'desktop',
    steps: [`Open ${p.url}`], expected: 'Page loads (2xx)', actual: `HTTP ${p.status}`,
    evidence: { details: `Linked from: ${linkedFrom(p.url).slice(0, 5).join(', ') || 'start URL'}` },
  });
}

function linkedFrom(url) {
  return Object.entries(sitemap.linkGraph || {}).filter(([, ls]) => ls.some(l => l.href === url)).map(([from]) => from);
}

for (const vpName of vpNames) {
  const vp = VIEWPORTS[vpName];
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch,
    deviceScaleFactor: vp.deviceScaleFactor,
    ...(args['storage-state'] ? { storageState: args['storage-state'] } : {}),
  });
  await context.addInitScript(PERF_INIT);

  for (const p of pagesToAudit) {
    // A page the crawl reached only via a redirect to login is blocked, not "the login page".
    if (p.finalUrl && LOGIN_PATH.test(new URL(p.finalUrl).pathname) && !LOGIN_PATH.test(new URL(p.url).pathname)) {
      const reason = `Redirected to login (${new URL(p.finalUrl).pathname}) — no test account for this page`;
      notCovered.push({ page: p.url, viewport: vpName, reason });
      coverAll(p.url, vpName, 'blocked', reason);
      continue;
    }
    const url = p.finalUrl || p.url;
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const requests = []; // {url, method, type, status, ms, failure, bytes}
    const startTimes = new Map();

    // "Failed to load resource" duplicates the network findings below, so skip it here.
    page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 300)));
    page.on('request', r => startTimes.set(r, Date.now()));
    page.on('requestfinished', async r => {
      const resp = await r.response().catch(() => null);
      let bytes = 0;
      try { const s = await r.sizes(); bytes = s.responseBodySize + s.responseHeadersSize; } catch {}
      requests.push({ url: r.url(), method: r.method(), type: r.resourceType(), status: resp?.status() ?? null,
        ms: Date.now() - (startTimes.get(r) || Date.now()), bytes });
    });
    page.on('requestfailed', r => {
      const failure = r.failure()?.errorText || 'failed';
      if (/ERR_ABORTED/.test(failure)) return; // navigations/cancels, not user-visible
      requests.push({ url: r.url(), method: r.method(), type: r.resourceType(), status: null, failure, ms: 0, bytes: 0 });
    });

    const shot = path.join(shotsDir, `${slug(url)}__${vpName}.png`);
    const shotRel = path.relative(outDir, shot);
    const base = { page: url, viewport: vpName, evidence: { screenshot: shotRel } };
    let mainResp;
    try {
      mainResp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      page.__settle = await settle(page);
      // Measure LCP/CLS before scrolling (scrolling would add lazy-load shifts), then scroll so
      // lazy content renders like it would for a real user, then screenshot.
      page.__perf = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        return { lcp: window.__qa?.lcp || 0, cls: window.__qa?.cls || 0, ttfb: nav ? nav.responseStart - nav.requestStart : 0 };
      });
      await scrollThrough(page);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => page.screenshot({ path: shot }));
    } catch (e) {
      const reason = `Navigation failed: ${String(e.message).split('\n')[0]}`;
      notCovered.push({ page: url, viewport: vpName, reason });
      coverAll(url, vpName, 'blocked', reason);
      await page.close();
      continue;
    }

    // ---- Coverage gates: login wall, slow load
    const landed = page.url();
    if (LOGIN_PATH.test(new URL(landed).pathname) && !LOGIN_PATH.test(new URL(url).pathname)) {
      const reason = `Redirected to login (${new URL(landed).pathname}) — no test account for this page`;
      notCovered.push({ page: url, viewport: vpName, reason });
      coverAll(url, vpName, 'blocked', reason);
      await page.close();
      continue;
    }
    const partial = page.__settle.loadTimedOut ? 'Page did not finish loading within 30s — results may be partial' : null;
    if (partial) notCovered.push({ page: url, viewport: vpName, reason: partial });
    const st = partial ? 'not-tested' : 'tested';
    cover('Functional', url, vpName, 'tested');
    cover('API/Network', url, vpName, page.__settle.idleTimedOut ? 'not-tested' : 'tested', page.__settle.idleTimedOut ? 'Network never went idle (long-polling or slow requests) — late requests not observed' : undefined);
    cover('Performance', url, vpName, st, partial || undefined);
    cover('Responsive', url, vpName, st, partial || undefined);
    cover('SEO', url, vpName, vpName === 'desktop' ? st : 'n/a', vpName === 'desktop' ? (partial || undefined) : 'Checked on desktop only');
    cover('Security', url, vpName, vpName === 'desktop' ? 'tested' : 'n/a', vpName === 'desktop' ? undefined : 'Checked on desktop only');

    // ---- Functional: console + uncaught exceptions
    for (const msg of new Set(consoleErrors)) add('console-error', { ...base,
      title: `Console error: ${msg.slice(0, 90)}`, steps: [`Open ${url}`, 'Open DevTools console'],
      expected: 'No console errors', actual: msg, evidence: { ...base.evidence, details: msg } });
    for (const msg of new Set(pageErrors)) add('page-exception', { ...base,
      title: `Uncaught exception: ${msg.slice(0, 90)}`, steps: [`Open ${url}`],
      expected: 'No uncaught JavaScript exceptions', actual: msg, evidence: { ...base.evidence, details: msg } });

    // ---- API / Network
    const api = requests.filter(r => ['xhr', 'fetch'].includes(r.type));
    for (const r of requests) {
      const short = `${r.method} ${r.url.slice(0, 120)}`;
      if (r.failure) add('request-failed', { ...base, title: `Request failed (${r.failure}): ${shortPath(r.url)}`,
        steps: [`Open ${url}`, 'Watch the Network tab'], expected: 'Request completes', actual: r.failure,
        evidence: { ...base.evidence, details: short } });
      else if (r.status >= 500) add('api-5xx', { ...base, title: `Server error ${r.status}: ${shortPath(r.url)}`,
        steps: [`Open ${url}`, 'Watch the Network tab'], expected: '2xx/3xx', actual: `HTTP ${r.status}`,
        evidence: { ...base.evidence, details: short } });
      else if (r.status >= 400 && !/favicon/.test(r.url)) add(r.type === 'image' ? 'broken-image' : 'api-4xx', { ...base,
        title: `${r.type === 'image' ? 'Image' : 'Request'} returns ${r.status}: ${shortPath(r.url)}`,
        steps: [`Open ${url}`, 'Watch the Network tab'], expected: '2xx/3xx', actual: `HTTP ${r.status}`,
        evidence: { ...base.evidence, details: short } });
    }
    for (const r of api.filter(r => r.ms > THRESH.slowApiMs)) add('api-slow', { ...base,
      title: `Slow API call (${r.ms} ms): ${shortPath(r.url)}`, steps: [`Open ${url}`],
      expected: `< ${THRESH.slowApiMs} ms`, actual: `${r.ms} ms`, evidence: { ...base.evidence, details: `${r.method} ${r.url}` } });
    const dupCount = {};
    for (const r of api) { const k = `${r.method} ${r.url}`; dupCount[k] = (dupCount[k] || 0) + 1; }
    for (const [k, n] of Object.entries(dupCount)) if (n >= 3) add('api-duplicate', { ...base,
      title: `Same API call fired ${n}× on load: ${shortPath(k.split(' ')[1])}`, steps: [`Open ${url}`],
      expected: 'Each resource requested once per load', actual: `${n} identical requests`, evidence: { ...base.evidence, details: k } });

    // ---- Performance
    const perf = page.__perf;
    const weight = requests.reduce((s, r) => s + (r.bytes || 0), 0);
    if (perf.lcp > THRESH.lcpMs) add('perf-lcp', { ...base, title: `Slow Largest Contentful Paint (${Math.round(perf.lcp)} ms)`,
      steps: [`Open ${url} (${vpName})`], expected: `LCP ≤ ${THRESH.lcpMs} ms`, actual: `${Math.round(perf.lcp)} ms` });
    if (perf.cls > THRESH.cls) add('perf-cls', { ...base, title: `Layout shifts while loading (CLS ${perf.cls.toFixed(2)})`,
      steps: [`Open ${url} (${vpName})`, 'Watch content jump while loading'], expected: `CLS ≤ ${THRESH.cls}`, actual: perf.cls.toFixed(3) });
    if (vpName === 'desktop' && perf.ttfb > THRESH.ttfbMs) add('perf-ttfb', { ...base, title: `Slow server response (TTFB ${Math.round(perf.ttfb)} ms)`,
      steps: [`Open ${url}`], expected: `TTFB ≤ ${THRESH.ttfbMs} ms`, actual: `${Math.round(perf.ttfb)} ms` });
    if (vpName === 'mobile' && weight > THRESH.weightBytes) add('perf-weight', { ...base, title: `Heavy page on mobile (${(weight / 1048576).toFixed(1)} MB)`,
      steps: [`Open ${url} on mobile`], expected: '≤ 3 MB transferred', actual: `${(weight / 1048576).toFixed(1)} MB` });

    // ---- Accessibility (axe-core, WCAG 2.1 A/AA)
    try {
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      for (const v of axe.violations) {
        const targets = v.nodes.slice(0, 5).map(n => n.target.join(' ')).join(' | ');
        add(`a11y-${v.impact || 'moderate'}`, { ...base, title: `${v.help} (${v.id})`,
          steps: [`Open ${url}`, `Inspect: ${targets}`], expected: v.description, actual: `${v.nodes.length} element(s) fail`,
          evidence: { ...base.evidence, details: `${v.helpUrl}\n${targets}` }, wcag: v.tags.filter(t => /^wcag\d/.test(t)) });
      }
      cover('Accessibility', url, vpName, 'tested');
    } catch (e) {
      const reason = `axe failed: ${String(e.message).split('\n')[0]}`;
      notCovered.push({ page: url, viewport: vpName, reason });
      cover('Accessibility', url, vpName, 'not-tested', reason);
    }

    // ---- Layout, images, tap targets, SEO, RTL — one in-page pass
    const dom = await page.evaluate(({ tapPx, rtlRe }) => {
      const RTL = new RegExp(rtlRe);
      const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
      const desc = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') +
        (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '');
      const W = document.documentElement.clientWidth;
      const overflowing = document.documentElement.scrollWidth > W + 1
        ? [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect();
            return vis(el) && (r.right > W + 1 || r.left < -1) && getComputedStyle(el).position !== 'fixed'; })
            .filter((el, _, arr) => !arr.some(o => o !== el && o.contains(el))).slice(0, 5).map(desc)
        : [];
      const brokenImgs = [...document.images].filter(i => i.complete && i.naturalWidth === 0 && vis(i)).map(i => i.currentSrc || i.src).slice(0, 10);
      const small = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button]')]
        .filter(vis).filter(el => { const r = el.getBoundingClientRect(); return r.width < tapPx || r.height < tapPx; })
        .filter(el => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline')) // inline text links are exempt
        .slice(0, 8).map(el => { const r = el.getBoundingClientRect(); return `${desc(el)} ${Math.round(r.width)}×${Math.round(r.height)}`; });
      const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.getAttribute('content') || null;
      const bodyText = document.body?.innerText || '';
      const rtlText = RTL.test(bodyText);
      const rootDir = getComputedStyle(document.documentElement).direction;
      // Share of Hebrew/Arabic text blocks that actually render RTL (dir may sit on a container).
      const rtlBlocks = rtlText ? [...document.querySelectorAll('p, li, h1, h2, h3, label, td')].filter(el => vis(el) && RTL.test(el.innerText)) : [];
      const rtlShare = rtlBlocks.length ? rtlBlocks.filter(el => getComputedStyle(el).direction === 'rtl').length / rtlBlocks.length : 0;
      // Hebrew/Arabic text blocks that render LTR or left-aligned.
      const misaligned = rtlText ? [...document.querySelectorAll('p, li, h1, h2, h3, h4, label, td, th, span, div')]
        .filter(el => el.children.length === 0 && vis(el)).filter(el => {
          const t = el.innerText.trim(); if (t.length < 8) return false;
          const rtlChars = (t.match(new RegExp(rtlRe, 'g')) || []).length;
          if (rtlChars / t.replace(/\s/g, '').length < 0.5) return false;
          const s = getComputedStyle(el);
          return s.direction === 'ltr' || s.textAlign === 'left';
        }).slice(0, 6).map(el => `${desc(el)}: "${el.innerText.trim().slice(0, 40)}"`) : [];
      const ltrInputs = rtlText ? [...document.querySelectorAll('input[type=text], input:not([type]), textarea, input[type=search]')]
        .filter(vis).filter(el => getComputedStyle(el).direction === 'ltr' && !el.getAttribute('dir'))
        .slice(0, 6).map(desc) : [];
      return {
        overflowing, scrollWidth: document.documentElement.scrollWidth, clientWidth: W, brokenImgs, small,
        title: document.title, description: meta('description'), robots: meta('robots'),
        viewportMeta: meta('viewport'), lang: document.documentElement.lang,
        h1: document.querySelectorAll('h1').length,
        canonical: document.querySelector('link[rel=canonical]')?.href || null,
        rtlText, rootDir, rtlShare, misaligned, ltrInputs,
      };
    }, { tapPx: THRESH.tapPx, rtlRe: HEBREW_OR_ARABIC.source });

    if (dom.overflowing.length || dom.scrollWidth > dom.clientWidth + 1) add('layout-overflow', { ...base,
      title: `Horizontal scroll on ${vpName} (${dom.scrollWidth}px content in ${dom.clientWidth}px viewport)`,
      steps: [`Open ${url} at ${vp.width}px wide`, 'Swipe/scroll horizontally'], expected: 'No horizontal scrolling',
      actual: `Content overflows by ${dom.scrollWidth - dom.clientWidth}px`, evidence: { ...base.evidence, details: `Overflowing: ${dom.overflowing.join(', ')}` } });
    const reported404 = new Set(requests.filter(r => r.status >= 400).map(r => r.url));
    for (const src of dom.brokenImgs.filter(s => !reported404.has(s))) add('broken-image', { ...base, title: `Broken image: ${shortPath(src)}`,
      steps: [`Open ${url}`], expected: 'Image renders', actual: 'Image failed to render', evidence: { ...base.evidence, details: src } });
    if (vpName === 'mobile' && dom.small.length) add('tap-target-small', { ...base,
      title: `Tap targets smaller than ${THRESH.tapPx}×${THRESH.tapPx}px on mobile`, steps: [`Open ${url} on a phone`, 'Try tapping the listed controls'],
      expected: `Interactive controls ≥ ${THRESH.tapPx}×${THRESH.tapPx}px (WCAG 2.5.8)`, actual: `${dom.small.length}+ small controls`,
      evidence: { ...base.evidence, details: dom.small.join('\n') } });

    if (vpName === 'desktop') {
      const seo = (id, title, expected, actual) => add(id, { ...base, title, steps: [`Open ${url}`, 'View page source'], expected, actual });
      if (!dom.title || dom.title.length < 10 || dom.title.length > 65) seo('seo-title', `Page title missing or poor length (${dom.title?.length || 0} chars)`, 'Unique title, 10–65 chars', dom.title || '(empty)');
      if (!dom.description) seo('seo-description', 'Missing meta description', '<meta name="description"> present', '(missing)');
      if (dom.h1 !== 1) seo('seo-h1', `Page has ${dom.h1} <h1> elements`, 'Exactly one <h1>', String(dom.h1));
      if (!dom.lang) seo('seo-lang', 'Missing <html lang>', 'lang attribute set (e.g. he, en)', '(missing)');
      if (!dom.canonical) seo('seo-canonical', 'No canonical URL', '<link rel="canonical">', '(missing)');
      if (dom.robots && /noindex/i.test(dom.robots)) seo('seo-noindex', 'Page is set to noindex', 'Indexable (unless intentional)', dom.robots);
    }
    if (vpName === 'mobile' && !dom.viewportMeta) add('seo-viewport', { ...base, title: 'Missing viewport meta tag',
      steps: [`Open ${url} on a phone`], expected: '<meta name="viewport" content="width=device-width, initial-scale=1">', actual: '(missing) — page renders zoomed-out' });

    cover('RTL/i18n', url, vpName, dom.rtlText ? st : 'n/a', dom.rtlText ? (partial || undefined) : 'No Hebrew/Arabic text on page');
    if (dom.rtlText) {
      if (dom.rootDir !== 'rtl' && dom.rtlShare >= 0.8) add('seo-lang', { ...base, severity: 'Low', category: 'RTL/i18n',
        title: 'RTL is set on a content container, not on <html>', steps: [`Open ${url}`, 'Inspect <html>'],
        expected: '<html lang="he" dir="rtl"> so browser UI, scrollbars and form controls follow RTL', actual: `html direction: ${dom.rootDir}; ${Math.round(dom.rtlShare * 100)}% of Hebrew blocks render RTL via a container` });
      else if (dom.rootDir !== 'rtl') add('rtl-dir-missing', { ...base, title: 'Hebrew/Arabic content but page direction is LTR',
        steps: [`Open ${url}`], expected: '<html dir="rtl"> (or dir on the content container)', actual: `direction: ${dom.rootDir}` });
      if (dom.misaligned.length) add('rtl-text-align', { ...base, title: 'Right-to-left text rendered left-aligned / LTR',
        steps: [`Open ${url}`, 'Look at the listed text blocks'], expected: 'RTL text aligned right with direction: rtl',
        actual: `${dom.misaligned.length}+ blocks`, evidence: { ...base.evidence, details: dom.misaligned.join('\n') } });
      if (dom.ltrInputs.length) add('rtl-input-dir', { ...base, title: 'Text inputs are LTR on an RTL page',
        steps: [`Open ${url}`, 'Type Hebrew into the listed inputs'], expected: 'dir="auto" or rtl so typed text aligns correctly',
        actual: dom.ltrInputs.join(', ') });
    }

    // ---- Passive security (once per page, desktop only)
    if (vpName === 'desktop' && mainResp) {
      const h = await mainResp.allHeaders();
      const isHttps = url.startsWith('https:');
      const sec = (id, title, expected, actual) => add(id, { ...base, title, steps: [`curl -sI ${url}`], expected, actual,
        evidence: { ...base.evidence, details: 'Response headers of the HTML document' } });
      if (!isHttps && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) sec('sec-no-https', 'Page served over plain HTTP', 'HTTPS only', url);
      if (isHttps && !h['strict-transport-security']) sec('sec-hsts', 'Missing Strict-Transport-Security header', 'HSTS set (max-age ≥ 15552000)', '(missing)');
      if (!h['content-security-policy']) sec('sec-header', 'Missing Content-Security-Policy header', 'CSP defined', '(missing)');
      if (!h['x-content-type-options']) sec('sec-header', 'Missing X-Content-Type-Options header', 'nosniff', '(missing)');
      if (!h['x-frame-options'] && !/frame-ancestors/.test(h['content-security-policy'] || '')) sec('sec-header', 'Page can be framed (clickjacking)', 'X-Frame-Options or CSP frame-ancestors', '(missing)');
      if (!h['referrer-policy']) sec('sec-header', 'Missing Referrer-Policy header', 'e.g. strict-origin-when-cross-origin', '(missing)');
      for (const k of ['server', 'x-powered-by', 'x-aspnet-version']) if (h[k] && /\d/.test(h[k]))
        sec('sec-version-leak', `Server version disclosed in ${k} header`, 'No version numbers in headers', `${k}: ${h[k]}`);
      if (isHttps) for (const r of requests.filter(r => r.url.startsWith('http:'))) add('sec-mixed-content', { ...base,
        title: `Mixed content: ${shortPath(r.url)}`, steps: [`Open ${url}`], expected: 'All subresources over HTTPS', actual: r.url });
    }
    await page.close();
  }

  // Cookie flags (after visiting all pages in this context)
  if (vpName === vpNames[vpNames.length - 1]) {
    const cookies = await context.cookies();
    const isHttps = sitemap.startUrl.startsWith('https:');
    for (const c of cookies) {
      const sessionLike = /sess|auth|token|sid|jwt|login/i.test(c.name);
      const gaps = [];
      if (isHttps && !c.secure) gaps.push('Secure');
      if (sessionLike && !c.httpOnly) gaps.push('HttpOnly');
      if (sessionLike && c.sameSite === 'None' && !c.secure) gaps.push('SameSite=None without Secure');
      if (gaps.length) add('sec-cookie', { page: sitemap.startUrl, viewport: 'desktop',
        severity: sessionLike ? 'Medium' : 'Low',
        title: `Cookie "${c.name}" missing ${gaps.join(', ')}`, steps: ['Open DevTools → Application → Cookies'],
        expected: 'Session cookies: Secure, HttpOnly, SameSite', actual: `secure=${c.secure} httpOnly=${c.httpOnly} sameSite=${c.sameSite}`,
        evidence: { details: `domain=${c.domain} path=${c.path}` } });
    }
  }
  await context.close();
}

// ---- Broken internal links (GET, budgeted)
const req = await (await browser.newContext()).request;
const known = new Set(sitemap.pages.map(p => p.url));
const toCheck = (sitemap.internalLinks || []).filter(u => !known.has(u)).slice(0, 60);
for (const u of toCheck) {
  try {
    const r = await req.get(u, { maxRedirects: 5, timeout: 15000 });
    if (r.status() >= 400) add('broken-link', { page: linkedFrom(u)[0] || sitemap.startUrl, viewport: 'desktop',
      title: `Broken internal link → ${r.status()}: ${shortPath(u)}`, steps: [`Open ${linkedFrom(u)[0]}`, `Click the link to ${u}`],
      expected: 'Link target loads', actual: `HTTP ${r.status()}`, evidence: { details: `Linked from: ${linkedFrom(u).slice(0, 5).join(', ')}` } });
  } catch (e) { /* network errors here are not user-visible enough to report */ }
}
if ((sitemap.internalLinks || []).length - known.size > 60) notCovered.push({ reason: 'Link check capped at 60 uncrawled internal links' });

// ---- Exposed files (passive GETs of well-known paths, once per origin)
if (!args['skip-exposed-files']) {
  const origin = new URL(sitemap.startUrl).origin;
  const probes = [
    ['/.git/HEAD', b => /^ref: refs\//.test(b)],
    ['/.env', b => /^[A-Z_]+=.+/m.test(b) && !/<html/i.test(b)],
    ['/.DS_Store', b => b.includes('Bud1')],
    ['/server-status', b => /Apache Server Status/i.test(b)],
    ['/phpinfo.php', b => /phpinfo\(\)|PHP Version/i.test(b)],
  ];
  for (const [p, looksReal] of probes) {
    try {
      const r = await req.get(origin + p, { maxRedirects: 0, timeout: 10000 });
      const body = r.status() === 200 ? (await r.text()).slice(0, 2000) : '';
      if (r.status() === 200 && looksReal(body)) add('sec-exposed-file', { page: origin + p, viewport: 'desktop',
        title: `Sensitive file publicly accessible: ${p}`, steps: [`Open ${origin + p}`], expected: '403/404',
        actual: 'HTTP 200 with real content', evidence: { details: 'Content not stored in the report on purpose.' } });
    } catch {}
  }
}

// ---- Soft 404: unknown URLs and crawled pages that say "not found" but return 200
{
  const origin = new URL(sitemap.startUrl).origin;
  const probeUrl = `${origin}/qa-nonexistent-${Date.now().toString(36)}`;
  try {
    const r = await req.get(probeUrl, { maxRedirects: 5, timeout: 15000 });
    if (r.status() === 200) add('soft-404', { page: probeUrl, viewport: 'desktop',
      title: 'Unknown URLs return HTTP 200 instead of 404 (soft 404)', steps: [`Open ${probeUrl}`],
      expected: 'HTTP 404 with a helpful not-found page', actual: 'HTTP 200',
      remediation: 'Return a real 404 status for unknown routes so search engines and monitoring see broken links.',
      evidence: { details: `Final URL: ${r.url()}` } });
  } catch {}
  for (const p of sitemap.pages.filter(p => p.status === 200 && p.url !== sitemap.startUrl)) {
    const text = `${p.title || ''} ${(p.headings || []).join(' ')} ${(p.textSample || '').slice(0, 200)}`;
    if (SOFT_404_TEXT.test(text)) add('soft-404', { page: p.url, viewport: 'desktop', confidence: 'verify',
      title: `Page says "not found" but returns HTTP 200: ${shortPath(p.url)}`,
      steps: [`Open ${linkedFrom(p.url)[0] || sitemap.startUrl}`, `Follow the link to ${p.url}`],
      expected: 'Linked page has real content, or the link is removed and the URL returns 404',
      actual: `HTTP 200 with text: "${(p.headings?.[0] || p.title || '').slice(0, 60)}"`,
      remediation: 'Fix or remove the link; return 404 for missing content.',
      evidence: { details: `Linked from: ${linkedFrom(p.url).slice(0, 5).join(', ') || '(none)'}` } });
  }
}

// ---- Reflected input (passive): GET forms and existing query params only. One inert marker,
// no script, no event handlers. Judged by whether the marker is parsed as markup.
if (!args['skip-reflection']) {
  const ctx = await browser.newContext(args['storage-state'] ? { storageState: args['storage-state'] } : {});
  const targets = [];
  for (const p of sitemap.pages.filter(p => p.status === 200)) {
    for (const f of p.forms || []) {
      if (f.method !== 'get') continue;
      const field = f.fields.find(x => x.name && /^(text|search|null)$/.test(String(x.type)) && x.tag !== 'select');
      if (!field) continue;
      const action = new URL(f.action || p.finalUrl || p.url, p.finalUrl || p.url);
      action.searchParams.set(field.name, REFLECTION_MARKER);
      targets.push({ from: p.url, url: action.toString(), param: field.name });
    }
    const u = new URL(p.finalUrl || p.url);
    for (const k of u.searchParams.keys()) { const t = new URL(u); t.searchParams.set(k, REFLECTION_MARKER); targets.push({ from: p.url, url: t.toString(), param: k }); }
  }
  const seenT = new Set();
  for (const t of targets.filter(t => !seenT.has(t.url) && seenT.add(t.url)).slice(0, 15)) {
    const pg = await ctx.newPage();
    try {
      await pg.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await settle(pg, { settleMs: 300 });
      const reflected = await pg.evaluate(() => {
        const html = document.documentElement.innerHTML;
        return html.includes('qa9probe') && [...document.querySelectorAll('i')].some(i => i.textContent === 'z' && !i.children.length);
      });
      if (reflected) {
        const shot = path.join(shotsDir, `reflect-${slug(t.param)}-${slug(t.from, 30)}.png`);
        await pg.screenshot({ path: shot }).catch(() => {});
        add('sec-reflected-input', { page: t.from, viewport: 'desktop', confidence: 'verify',
          title: `Input in "${t.param}" is rendered as HTML without escaping`,
          steps: [`Open ${t.url}`, 'Inspect where the search term is shown'],
          expected: 'The term appears as plain text (escaped)', actual: 'The marker <i>z</i> was parsed as markup — likely reflected XSS',
          remediation: 'HTML-encode user input on output; add a Content-Security-Policy.',
          evidence: { screenshot: path.relative(outDir, shot), details: `Inert marker used: ${REFLECTION_MARKER}` } });
      }
    } catch {} finally { await pg.close(); }
  }
  await ctx.close();
}

await browser.close();
if (args['skip-reflection']) notCovered.push({ reason: 'Reflected-input check skipped (--skip-reflection)' });
if (args['skip-exposed-files']) notCovered.push({ reason: 'Exposed-files check skipped (--skip-exposed-files)' });
writeJson(path.join(outDir, 'findings.auto.json'), { generatedAt: new Date().toISOString(), viewports: vpNames, findings, notCovered, coverage });
const bySev = findings.reduce((a, f) => (a[f.severity] = (a[f.severity] || 0) + 1, a), {});
const cov = coverage.filter(c => c.status !== 'n/a');
console.log(`[audit] ${findings.length} raw findings`, bySev, `| coverage ${cov.filter(c => c.status === 'tested').length}/${cov.length} checks | not covered: ${notCovered.length}`);

function shortPath(u) { try { const x = new URL(u); return (x.pathname + x.search).slice(0, 70) || '/'; } catch { return String(u).slice(0, 70); } }
