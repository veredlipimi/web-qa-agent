#!/usr/bin/env node
// Visual review sheets: one image per page with the desktop and mobile views side by side, so the
// agent can look at every page (it can read images) and spot what the DOM does not show — a wrong or
// broken image, text cut off, overlapping elements, an empty area, a layout that falls apart on mobile.
//
//   node visual-sheets.mjs --sitemap <run>/sitemap.json --out <run> [--max-pages 20] [--viewports mobile,desktop] [--storage-state auth.json]
//
// Output: <run>/visual/<page>.png and <run>/visual/index.json (page → sheet, captured viewports).
// Findings from this review are the model's judgement: report them with ruleId "visual-review"
// and confidence "verify" (report.mjs enforces this) — never as a pass, never as confirmed.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, need, readJson, writeJson, launchBrowser, settle, scrollThrough, ensureDir, slug, VIEWPORTS, SAFE_CONTEXT, blockWebSockets, isDestructiveGet } from './lib.mjs';

const args = parseArgs();
const sitemap = readJson(need(args, 'sitemap'), null);
const outDir = need(args, 'out');
const maxPages = Number(args['max-pages'] || 20);
const viewports = String(args.viewports || 'mobile,desktop').split(',').map(s => s.trim()).filter(v => VIEWPORTS[v]);
const dir = ensureDir(path.join(outDir, 'visual'));
const MAX_HEIGHT = 2400; // CSS px per view: long pages are cut, and the cut is recorded

const pages = sitemap.pages.filter(p => p.status === 200).slice(0, maxPages);
const browser = await launchBrowser();
const index = [];
const notCovered = [];

for (const p of pages) {
  const url = p.finalUrl || p.url;
  const shots = [];
  for (const vp of viewports) {
    const ctx = await browser.newContext({ ...VIEWPORTS[vp], ...SAFE_CONTEXT, ...(args['storage-state'] ? { storageState: args['storage-state'] } : {}) });
    await blockWebSockets(ctx);
    // Read-only: no form or API write leaves the browser while capturing.
    await ctx.route('**/*', r => (['GET', 'HEAD'].includes(r.request().method()) && !isDestructiveGet(r.request().url()) ? r.continue() : r.abort('blockedbyclient')));
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await settle(page);
      await scrollThrough(page).catch(() => {});
      const full = await page.evaluate(() => document.documentElement.scrollHeight);
      // No clip: an RTL page with horizontal overflow paints outside x=0..width, and the overflow itself is worth seeing.
      const buf = await page.screenshot({ fullPage: true });
      shots.push({ vp, width: VIEWPORTS[vp].width, b64: buf.toString('base64'), cut: full > MAX_HEIGHT ? full : null });
    } catch (e) {
      notCovered.push({ page: url, reason: `visual sheet ${vp}: ${e.message.split('\n')[0]}` });
    } finally { await ctx.close(); }
  }
  if (!shots.length) continue;
  // Compose the sheet: views side by side, scaled to a common height budget, labelled.
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#e9e9e6;font:14px system-ui}
    .row{display:flex;gap:16px;padding:16px;align-items:flex-start}.v{background:#fff;padding:8px;border:1px solid #ccc}
    .v h2{margin:0 0 6px;font-size:13px;color:#333}.v img{display:block}</style>
    <div style="padding:10px 16px;font-weight:600">${url.replace(/[<&]/g, '')}</div><div class="row">${shots.map(s => {
      const w = s.vp === 'desktop' ? 900 : s.vp === 'tablet' ? 500 : 340;
      return `<div class="v"><h2>${s.vp} · ${s.width}px${s.cut ? ` · showing the top ${MAX_HEIGHT}px of ${s.cut}px` : ''}</h2><div style="width:${w}px;max-height:${Math.round(MAX_HEIGHT * w / s.width)}px;overflow:hidden"><img style="width:${w}px" src="data:image/png;base64,${s.b64}"></div></div>`;
    }).join('')}</div>`;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  const file = path.join(dir, `${slug(new URL(url).pathname || 'home') || 'home'}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await ctx.close();
  index.push({ page: url, sheet: file, viewports: shots.map(s => s.vp), cut: shots.filter(s => s.cut).map(s => s.vp) });
}

await browser.close();
writeJson(path.join(dir, 'index.json'), { generated: new Date().toISOString(), pages: index, notCovered,
  howTo: 'Read each sheet. Report what a user would see as broken: wrong/broken images, text cut off or overlapping, unreadable contrast, empty areas, mobile layout collapse. ruleId "visual-review", confidence "verify". Add a coverage entry (category Visual) per reviewed sheet.' });
console.log(`[visual] ${index.length} sheets → ${dir}${notCovered.length ? ` · ${notCovered.length} not captured` : ''}`);
