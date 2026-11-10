#!/usr/bin/env node
// Action probes: does a form behave safely when the user double-clicks, and does it tell the truth when
// the server fails? Safe on production: after the form is filled, every request the submit triggers is
// answered by the agent inside the browser — nothing reaches the server.
//
//   double   → two quick clicks on submit; the response is a delayed 200. ≥2 identical requests = gap.
//   ok-200   → baseline: one click, response 200 {ok:true}. Is a success message detectable at all?
//   fail-500 → one click, response 500. A success message = false success (gap).
//   offline  → one click, the request fails at the network. A success message = false success (gap).
//
// Usage: node action-probes.mjs --sitemap run/sitemap.json --out run [--max-forms 5] [--storage-state auth.json]
// Output: run/findings.actions.json  (merged by report.mjs)
import path from 'node:path';
import { parseArgs, need, readJson, writeJson, launchBrowser, settle, ensureDir, slug } from './lib.mjs';

const args = parseArgs();
const sitemap = readJson(need(args, 'sitemap'), null);
const outDir = need(args, 'out');
const maxForms = Number(args['max-forms'] || 5);
const shots = ensureDir(path.join(outDir, 'screenshots', 'actions'));

const SUCCESS = /(thank|success|sent\b|received|submitted|subscribed|confirmed|saved|we'?ll be in touch|תודה|נשלח|נשמר|התקבל|בהצלחה|נרשמת|נרשמתם|אושר)/i;
const ERROR = /(error|fail|try again|went wrong|unable|could ?n[o']t|problem|שגיאה|נכשל|נסו שוב|נסה שוב|לא הצלחנו|תקלה|בעיה)/i;
const ANALYTICS = /(google-analytics|googletagmanager|doubleclick|facebook\.(com|net)|hotjar|segment\.(io|com)|mixpanel|clarity\.ms|sentry|datadog|plausible|vercel-insights|_vercel\/insights|posthog|amplitude)/i;
const MONEY = /(pay|checkout|order|purchase|cart|book|reserve|donat|תשלום|הזמנ|רכיש|קופה|תרומ)/i;

const VALUE = {
  email: 'qa+probe@example.com', phone: '0500000000', name: 'QA Tester', zip: '4250000',
  url: 'https://example.com', id: '000000018', message: 'QA probe — please ignore.', text: 'QA probe',
};
const purposeOf = f => {
  const s = `${f.name || ''} ${f.id || ''} ${f.label || ''} ${f.autocomplete || ''}`;
  if (f.type === 'email') return 'email';
  if (f.type === 'tel') return 'phone';
  if (f.type === 'url') return 'url';
  if (/e-?mail|מייל|אימייל/i.test(s)) return 'email';
  if (/phone|mobile|tel|טלפון|נייד/i.test(s)) return 'phone';
  if (/zip|postal|מיקוד/i.test(s)) return 'zip';
  if (/message|comment|הודעה|תוכן/i.test(s) || f.tag === 'textarea') return 'message';
  if (/name|שם/i.test(s)) return 'name';
  return 'text';
};

const findings = [], coverage = [], notCovered = [], probes = [];
const add = f => findings.push({ source: 'auto', category: 'Functional', viewport: 'desktop', ...f });

const forms = [];
for (const p of sitemap.pages.filter(p => p.status === 200)) for (const f of p.forms || []) {
  if (f.method === 'get' && !f.fields.some(x => x.tag === 'textarea')) continue; // search / filter forms are not actions
  const fields = f.fields.filter(x => x.visible && !['submit', 'button', 'hidden', 'file', 'range', 'color', 'password'].includes(x.type));
  if (f.fields.some(x => x.type === 'password')) { notCovered.push({ page: p.finalUrl || p.url, reason: `form #${f.index} is a login/password form — not probed` }); continue; }
  forms.push({ page: p.finalUrl || p.url, form: f, fields });
}

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(args['storage-state'] ? { storageState: args['storage-state'] } : {}) });
// Native submissions never leave the page.
await ctx.addInitScript(() => {
  window.addEventListener('submit', e => { window.__qaSubmitted = (window.__qaSubmitted || 0) + 1; e.preventDefault(); }, true);
  HTMLFormElement.prototype.submit = function () { window.__qaSubmitted = (window.__qaSubmitted || 0) + 1; };
});

async function probe(url, form, fields, mode) {
  const page = await ctx.newPage();
  let armed = false;
  const reqs = [];
  await page.route('**/*', async route => {
    const r = route.request();
    const type = r.resourceType();
    const isAction = r.method() !== 'GET' && r.method() !== 'HEAD';
    // Before arming, only reads pass. After arming, every fetch/xhr/non-GET is answered locally.
    if (!armed) return isAction ? route.abort('blockedbyclient') : route.continue();
    if (!isAction && !['fetch', 'xhr'].includes(type)) return route.continue();
    if (ANALYTICS.test(r.url()) || type === 'ping') return route.fulfill({ status: 204, body: '' });
    reqs.push({ method: r.method(), url: r.url(), at: Date.now() });
    if (mode === 'offline') return route.abort('internetdisconnected');
    if (mode === 'fail-500') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal Server Error' }) });
    if (mode === 'double') await new Promise(r => setTimeout(r, 700));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, success: true }) });
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settle(page);
    const formLoc = page.locator('form').nth(form.index);
    for (const f of fields) {
      const sel = f.id ? `[id="${f.id}"]` : f.name ? `[name="${f.name}"]` : null;
      if (!sel) continue;
      const el = formLoc.locator(sel).first();
      if (f.tag === 'select') { await el.selectOption({ index: 1 }).catch(() => {}); continue; }
      if (f.type === 'checkbox' || f.type === 'radio') { if (f.required) await el.check().catch(() => {}); continue; }
      await el.fill(VALUE[purposeOf(f)] || VALUE.text, { timeout: 3000 }).catch(() => {});
    }
    const before = await page.evaluate(() => document.body.innerText);
    const submit = formLoc.locator('button[type=submit], button:not([type]), input[type=submit]').first();
    if (!(await submit.count())) return { mode, error: 'no submit button' };
    armed = true;
    await submit.click({ timeout: 3000 });
    if (mode === 'double') await submit.click({ timeout: 400, noWaitAfter: true }).catch(() => {}); // disabled/hidden after the first click = guarded
    await page.waitForTimeout(mode === 'double' ? 1800 : 1500);
    const after = await page.evaluate(() => document.body.innerText);
    const seen = new Set(before.split('\n').map(s => s.trim()));
    const fresh = after.split('\n').map(s => s.trim()).filter(s => s && !seen.has(s)).join(' | ').slice(0, 300);
    const native = await page.evaluate(() => window.__qaSubmitted || 0);
    const shot = path.join(shots, `${slug(new URL(url).pathname)}-f${form.index}-${mode}.png`);
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    return { mode, requests: reqs, native, fresh, success: SUCCESS.test(fresh), failText: ERROR.test(fresh), screenshot: shot };
  } catch (e) { return { mode, error: e.message.split('\n')[0] }; }
  finally { await page.close(); }
}

const groupMax = rs => Math.max(0, ...Object.values(rs.reduce((a, r) => { const k = `${r.method} ${r.url}`; a[k] = (a[k] || 0) + 1; return a; }, {})));

for (const { page: url, form, fields } of forms.slice(0, maxForms)) {
  const where = `form #${form.index} on ${new URL(url).pathname}`;
  const res = {};
  for (const mode of ['ok-200', 'double', 'fail-500', 'offline']) res[mode] = await probe(url, form, fields, mode);
  probes.push({ page: url, form: form.index, results: res });
  const base = res['ok-200'];
  if (base.error) { coverage.push({ category: 'Functional', page: url, viewport: 'desktop', status: 'blocked', reason: `${where}: ${base.error}` }); continue; }
  if (!base.requests.length) {
    const reason = base.native ? `${where} posts natively (server-rendered result) — failure handling needs staging` : `${where}: submit triggered no request (client validation or custom control)`;
    coverage.push({ category: 'Functional', page: url, viewport: 'desktop', status: 'not-tested', reason });
    continue;
  }
  coverage.push({ category: 'Functional', page: url, viewport: 'desktop', status: 'tested' });
  const money = MONEY.test(`${url} ${form.action} ${base.requests[0].url}`);
  const evidence = r => ({ screenshot: r.screenshot, details: `requests: ${r.requests.map(q => `${q.method} ${new URL(q.url).pathname}`).join(', ') || 'none'}\nnew text: ${r.fresh || '(none)'}` });

  // ---- double click
  const d = res.double;
  if (!d.error && groupMax(d.requests) >= 2) add({ ruleId: 'action-double-submit', severity: money ? 'High' : 'Medium', confidence: 'confirmed', page: url,
    title: `Double-click on submit sends the request ${groupMax(d.requests)} times (${where})`,
    steps: [`Open ${url}`, 'Fill the form with valid data', 'Click submit twice quickly'],
    expected: 'One request — the button is disabled or the action is idempotent', actual: `${groupMax(d.requests)} identical requests were sent (answered locally by the agent)`,
    remediation: 'Disable the submit button while the request is in flight, and make the endpoint idempotent (idempotency key).', evidence: evidence(d) });

  // ---- false success / no feedback
  const detectable = base.success;
  for (const mode of ['fail-500', 'offline']) {
    const r = res[mode];
    if (r.error) continue;
    const label = mode === 'fail-500' ? 'the server answered 500' : 'the network request failed';
    if (r.success && !r.failText) add({ ruleId: 'action-false-success', severity: 'High', confidence: detectable ? 'confirmed' : 'verify', page: url,
      title: `Shows a success message when ${label} (${where})`,
      steps: [`Open ${url}`, 'Fill the form with valid data', `Submit while ${label} (simulated by the agent)`],
      expected: 'An error message and a way to retry — no success message', actual: `Success text appeared: "${r.fresh.slice(0, 120)}"`,
      remediation: 'Show success only after the response is confirmed (status and body). Handle non-2xx and network errors with a clear message.', evidence: evidence(r) });
    else if (!r.success && !r.failText && mode === 'fail-500') {
      if (detectable) add({ ruleId: 'action-no-failure-feedback', severity: 'Medium', confidence: 'verify', page: url,
        title: `No feedback when the submission fails (${where})`,
        steps: [`Open ${url}`, 'Fill the form with valid data', 'Submit while the server answers 500 (simulated by the agent)'],
        expected: 'A visible error message', actual: r.fresh ? `New text, but no error wording: "${r.fresh.slice(0, 120)}"` : 'Nothing changed on the page',
        remediation: 'Show an error message with a retry option when the request fails.', evidence: evidence(r) });
      else notCovered.push({ page: url, reason: `${where}: no success message detectable even on a 200 — failure feedback not judged` });
    }
  }
}

await browser.close();
writeJson(path.join(outDir, 'findings.actions.json'), { findings, coverage, notCovered, probes });
console.log(`[actions] ${forms.length} forms, ${findings.length} gaps, ${coverage.filter(c => c.status === 'tested').length} tested`);
