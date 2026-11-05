#!/usr/bin/env node
// Phase 2 — Reconnaissance. Breadth-first crawl of same-origin pages as a real browser.
// Usage: node crawl.mjs --url https://example.com --out qa-runs/x [--max-pages 25]
//        [--include-subdomains a.example.com,b.example.com] [--storage-state auth.json]
import path from 'node:path';
import { parseArgs, need, writeJson, launchBrowser, normalizeUrl, inScope, settle, HEBREW_OR_ARABIC } from './lib.mjs';

const args = parseArgs();
const startUrl = normalizeUrl(need(args, 'url', 'target URL'));
const outDir = need(args, 'out', 'run folder');
const maxPages = Number(args['max-pages'] || 25);
const extraHosts = args['include-subdomains'] ? String(args['include-subdomains']).split(',') : [];

// Skip links that would change state or download binaries.
const SKIP = /\/(logout|log-out|signout|sign-out|delete|remove|unsubscribe)(\/|$|\?)|\.(pdf|zip|exe|dmg|png|jpe?g|gif|svg|webp|mp4|mp3|docx?|xlsx?)(\?|$)/i;

const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ignoreHTTPSErrors: false,
  ...(args['storage-state'] ? { storageState: args['storage-state'] } : {}),
});
const page = await context.newPage();

const queue = [startUrl];
const seen = new Set(queue);
const pages = [];
const linkGraph = {}; // url -> [{href, text, from}]

while (queue.length && pages.length < maxPages) {
  const url = queue.shift();
  const record = { url, status: null, finalUrl: null, title: null, error: null };
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settle(page);
    record.status = resp ? resp.status() : null;
    record.finalUrl = page.url();
    const info = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const labelFor = (el) => {
        if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return l.innerText.trim(); }
        const wrap = el.closest('label'); if (wrap) return wrap.innerText.trim();
        return el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
      };
      return {
        title: document.title,
        lang: document.documentElement.lang || null,
        dir: document.documentElement.dir || getComputedStyle(document.documentElement).direction,
        bodySample: (document.body?.innerText || '').slice(0, 3000),
        links: [...document.querySelectorAll('a[href]')].map(a => ({ href: a.href, text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 80) })),
        forms: [...document.querySelectorAll('form')].map((f, i) => ({
          index: i,
          action: f.getAttribute('action') || '',
          method: (f.getAttribute('method') || 'get').toLowerCase(),
          fields: [...f.querySelectorAll('input, select, textarea')]
            .filter(el => el.type !== 'hidden')
            .map(el => ({
              tag: el.tagName.toLowerCase(), type: el.type || null, name: el.name || null, id: el.id || null,
              label: labelFor(el).slice(0, 80), required: el.required,
              hasLabel: !!((el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label') || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')),
              placeholder: el.getAttribute('placeholder'), inputmode: el.getAttribute('inputmode'), pattern: el.getAttribute('pattern'),
              minLength: el.minLength > 0 ? el.minLength : null, maxLength: el.maxLength > 0 ? el.maxLength : null,
              autocomplete: el.getAttribute('autocomplete'), visible: vis(el),
            })),
          submit: [...f.querySelectorAll('button, input[type=submit]')].map(b => (b.innerText || b.value || '').trim()).filter(Boolean),
        })),
        buttons: [...document.querySelectorAll('button, [role=button]')].filter(vis)
          .map(b => (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 60)).filter(Boolean).slice(0, 40),
        headings: [...document.querySelectorAll('h1, h2')].map(h => `${h.tagName}: ${h.innerText.trim().slice(0, 80)}`).slice(0, 20),
      };
    });
    record.title = info.title;
    record.lang = info.lang;
    record.dir = info.dir;
    record.hasRtlText = HEBREW_OR_ARABIC.test(info.bodySample);
    record.textSample = info.bodySample.replace(/\s+/g, ' ').trim().slice(0, 400);
    record.forms = info.forms;
    record.buttons = info.buttons;
    record.headings = info.headings;
    linkGraph[url] = [];
    for (const l of info.links) {
      const n = normalizeUrl(l.href, record.finalUrl);
      if (!n) continue;
      linkGraph[url].push({ href: n, text: l.text });
      if (inScope(n, startUrl, extraHosts) && !seen.has(n) && !SKIP.test(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  } catch (e) {
    record.error = String(e.message || e).split('\n')[0];
  }
  pages.push(record);
  console.log(`[crawl] ${pages.length}/${maxPages} ${record.status ?? 'ERR'} ${url}`);
}

const internalLinks = [...new Set(Object.values(linkGraph).flat().map(l => l.href)
  .filter(h => inScope(h, startUrl, extraHosts) && !SKIP.test(h)))];

const sitemap = {
  startUrl,
  crawledAt: new Date().toISOString(),
  maxPages,
  extraHosts,
  rtlDetected: pages.some(p => p.hasRtlText || p.dir === 'rtl'),
  pages,
  notCrawled: queue.slice(0, 200),
  internalLinks,
  linkGraph,
};
writeJson(path.join(outDir, 'sitemap.json'), sitemap);
console.log(`[crawl] done: ${pages.length} pages, ${queue.length} queued but over budget, RTL=${sitemap.rtlDetected}`);
await browser.close();
