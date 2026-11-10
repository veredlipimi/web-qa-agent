#!/usr/bin/env node
// Field integrity matrix: size, length and format of every form field — without ever submitting.
// 1) Static: input type / inputmode / maxlength / autocomplete fit the field's purpose.
// 2) Dynamic: fill each field with edge values, try submit with ALL non-GET requests blocked
//    and native submission prevented, then observe whether the UI rejects what it should
//    (and accepts what it should, e.g. Hebrew names).
// Usage: node field-matrix.mjs --sitemap run/sitemap.json --out run [--max-forms 5] [--max-fields 8]
import path from 'node:path';
import { parseArgs, need, readJson, writeJson, launchBrowser, settle, ensureDir, slug } from './lib.mjs';

const args = parseArgs();
const sitemap = readJson(need(args, 'sitemap'), null);
const outDir = need(args, 'out');
const maxForms = Number(args['max-forms'] || 5);
const maxFields = Number(args['max-fields'] || 8);
const shots = ensureDir(path.join(outDir, 'screenshots', 'fields'));

const PURPOSE = [
  ['email', /e-?mail|מייל|דוא"?ל|אימייל/i],
  ['phone', /phone|mobile|tel|טלפון|נייד|פלאפון/i],
  ['name', /(^|\b|_)(full.?)?name|first|last|שם/i],
  ['zip', /zip|postal|מיקוד/i],
  ['id', /\bid\b|ת\.?ז|תעודת זהות/i],
  ['url', /url|website|אתר/i],
  ['message', /message|comment|הודעה|תוכן|פירוט/i],
];
const purposeOf = f => {
  const s = `${f.name || ''} ${f.id || ''} ${f.label || ''} ${f.autocomplete || ''}`;
  if (f.type === 'email') return 'email';
  if (f.type === 'tel') return 'phone';
  return (PURPOSE.find(([, re]) => re.test(s)) || ['text'])[0];
};
const EXPECT_TYPE = { email: ['email'], phone: ['tel'], url: ['url'] };
const EXPECT_AC = { email: 'email', phone: 'tel', name: 'name' };

// [caseId, value, expectation] — expectation: 'reject' | 'accept' | 'max'
const CASES = {
  common: [['whitespace-only', '   ', 'reject-if-required'], ['empty', '', 'reject-if-required']],
  name: [['hebrew', 'ורד לי', 'accept'], ['apostrophe', "O'Brien", 'accept'], ['mixed-direction', 'Vered ורד', 'accept']],
  email: [['double-at', 'name@@example.com', 'reject'], ['no-at', 'plainaddress', 'reject'], ['plus-tag', 'qa+probe@example.com', 'accept'], ['il-domain', 'qa@example.co.il', 'accept']],
  phone: [['letters', 'abcdefghij', 'reject']  /* ≥9 chars so only the character class is under test */, ['too-short', '05000', 'reject'], ['il-intl', '+972500000000', 'accept'], ['il-dash', '050-0000000', 'accept']],
  text: [['hebrew', 'בדיקה', 'accept']],
  message: [['hebrew', 'שלום, זו הודעת בדיקה.', 'accept']],
};

const findings = [];
const matrix = [];
const coverage = [];
const notCovered = [];
const add = (f) => findings.push({ source: 'auto', category: 'Forms', confidence: 'verify', viewport: 'desktop', ...f });

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 },
  ...(args['storage-state'] ? { storageState: args['storage-state'] } : {}) });
// Safety: no form ever reaches the server.
await ctx.addInitScript(() => {
  window.addEventListener('submit', e => { window.__qaSubmitted = (window.__qaSubmitted || 0) + 1; e.preventDefault(); }, true);
  const orig = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () { window.__qaSubmitted = (window.__qaSubmitted || 0) + 1; };
  HTMLFormElement.prototype.requestSubmit = function () { this.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); };
  void orig;
});
let actionRequests = 0; // a submit that reaches the network means the client accepted the input
await ctx.route('**/*', r => {
  if (r.request().method() === 'GET' || r.request().method() === 'HEAD') return r.continue();
  actionRequests++;
  return r.abort('blockedbyclient');
});

const forms = [];
for (const p of sitemap.pages.filter(p => p.status === 200)) for (const f of p.forms || []) {
  const fields = f.fields.filter(x => x.visible && !['checkbox', 'radio', 'file', 'submit', 'button', 'hidden', 'range', 'color'].includes(x.type) && x.tag !== 'select');
  if (fields.length && !/search/i.test(fields.map(x => `${x.type} ${x.name}`).join(' ')) ) forms.push({ page: p.finalUrl || p.url, form: f, fields: fields.slice(0, maxFields) });
}

for (const { page: url, form, fields } of forms.slice(0, maxForms)) {
  const formLabel = `form #${form.index} on ${new URL(url).pathname}`;
  // ---- static checks
  const noMax = [];
  for (const f of fields) {
    const purpose = purposeOf(f);
    const label = f.label || f.name || f.id || f.type;
    const attrs = { evidence: { details: `<${f.tag} ${Object.entries({ type: f.type, name: f.name, id: f.id, placeholder: f.placeholder, inputmode: f.inputmode, autocomplete: f.autocomplete, maxlength: f.maxLength, required: f.required || null }).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}="${v}"`).join(' ')}>` } };
    if (f.hasLabel === false) add({ ruleId: 'field-no-label', severity: 'Medium', category: 'Accessibility', ...attrs,
      title: `"${label}" has no label — only a placeholder (WCAG 1.3.1 / 3.3.2)`, page: url,
      steps: [`Open ${url}`, `Click into "${label}" and start typing`, 'The placeholder disappears; screen readers may not announce a name'],
      expected: 'A visible <label> (or aria-label) that stays while typing', actual: f.placeholder ? `Placeholder only: "${f.placeholder}"` : 'No accessible name',
      remediation: 'Add a <label for> element; keep the placeholder only as an example.', confidence: 'confirmed' });
    if (EXPECT_TYPE[purpose] && f.inputmode !== 'tel' && !EXPECT_TYPE[purpose].includes(f.type)) add({ ruleId: 'field-type', severity: 'Low',
      title: `"${label}" looks like a ${purpose} field but uses type="${f.type}"`, page: url,
      steps: [`Open ${url}`, `Inspect the "${label}" field`], expected: `type="${EXPECT_TYPE[purpose][0]}" — gives the right mobile keyboard and built-in validation`,
      actual: `type="${f.type}"`, ...attrs, remediation: `Use type="${EXPECT_TYPE[purpose][0]}"${purpose === 'phone' ? ' (or inputmode="tel")' : ''}.`, confidence: 'confirmed' });
    if (EXPECT_AC[purpose] && !f.autocomplete) add({ ruleId: 'field-autocomplete', severity: 'Low', category: 'Accessibility',
      title: `"${label}" has no autocomplete attribute (WCAG 1.3.5)`, page: url, steps: [`Open ${url}`, `Inspect "${label}"`],
      expected: `autocomplete="${EXPECT_AC[purpose]}"`, actual: '(missing)', ...attrs, remediation: `Add autocomplete="${EXPECT_AC[purpose]}".`, confidence: 'confirmed' });
    if (['text', 'email', 'tel', 'url', 'search', null].includes(f.type) || f.tag === 'textarea') if (!f.maxLength) noMax.push(label);
  }
  if (noMax.length) add({ ruleId: 'field-maxlength', severity: 'Info', title: `${noMax.length} field(s) in ${formLabel} have no maxlength`,
    page: url, steps: [`Open ${url}`], expected: 'A sensible maxlength matching what the backend stores', actual: noMax.join(', '), evidence: { details: `Fields without maxlength: ${noMax.join(', ')}` },
    remediation: 'Set maxlength to the backend column size so users get feedback before the server rejects or truncates.', confidence: 'confirmed' });

  // ---- dynamic matrix
  for (const f of fields) {
    const purpose = purposeOf(f);
    const label = f.label || f.name || f.id || f.type;
    const cases = [...CASES.common, ...(CASES[purpose] || CASES.text)];
    if (f.maxLength) cases.push(['max-plus-one', 'a'.repeat(f.maxLength + 1), 'max']);
    for (const [caseId, value, expectation] of cases) {
      if (expectation === 'reject-if-required' && !f.required) continue;
      const cell = { page: url, form: form.index, field: label, purpose, case: caseId, value: value.length > 40 ? `${value.slice(0, 20)}…(${value.length})` : value, expectation };
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await settle(page, { settleMs: 300 });
        const formLoc = page.locator('form').nth(form.index);
        const sel = f.id ? `#${CSSesc(f.id)}` : f.name ? `[name="${f.name}"]` : null;
        if (!sel) { cell.result = 'not-tested'; cell.reason = 'Field has no id or name to target'; continue; }
        const el = formLoc.locator(sel).first();
        // Fill the other required fields with valid values so only this field is under test.
        for (const o of fields.filter(o => o !== f && o.required)) {
          const os = o.id ? `#${CSSesc(o.id)}` : o.name ? `[name="${o.name}"]` : null; if (!os) continue;
          const op = purposeOf(o);
          await formLoc.locator(os).first().fill(op === 'email' ? 'qa+probe@example.com' : op === 'phone' ? '0500000000' : 'QA Tester').catch(() => {});
        }
        await el.fill(value);
        await el.blur();
        const errorsBefore = await visibleErrors(page, sel, form.index);
        // Noise baseline: text that changes on its own (carousels, tickers, live counters) is not a validation error.
        await page.waitForTimeout(700);
        const errorsIdle = await visibleErrors(page, sel, form.index);
        const submit = formLoc.locator('button:not([type=button]):not([type=reset]), input[type=submit]').first();
        actionRequests = 0;
        if (await submit.count()) await submit.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);
        const obs = await el.evaluate((node) => ({
          valid: node.checkValidity(), valueLength: node.value.length,
          ariaInvalid: node.getAttribute('aria-invalid') === 'true', message: node.validationMessage,
        }));
        const errorsAfter = await visibleErrors(page, sel, form.index);
        const submitted = await page.evaluate(() => window.__qaSubmitted || 0);
        const items = t => String(t || '').split(' | ').map(x => x.trim()).filter(Boolean);
        const SLIDE = /\b\d+\s*(of|מתוך|\/)\s*\d+\b/i;
        const seen = new Set([...items(errorsBefore.global), ...items(errorsIdle.global)]);
        const nearNoisy = errorsBefore.near !== errorsIdle.near;
        const freshGlobal = items(errorsAfter.global).filter(x => !seen.has(x) && !SLIDE.test(x));
        const nearNew = !nearNoisy && errorsAfter.near && errorsAfter.near !== errorsBefore.near && !SLIDE.test(errorsAfter.near);
        const fieldKey = [f.name, f.id].filter(Boolean);
        const freshText = freshGlobal.join(' | ');
        const globalNew = errorsBefore.global === errorsIdle.global && freshGlobal.length > 0
          && (fieldKey.some(k => freshText.includes(k)) || !fields.some(o => o !== f && [o.name, o.id].filter(Boolean).some(k => freshText.includes(k))));
        obs.uiError = !!(nearNew || globalNew || obs.ariaInvalid);
        if (obs.uiError) obs.errorText = (nearNew ? errorsAfter.near : freshText || errorsAfter.global).slice(0, 120);
        obs.requestSent = actionRequests > 0;
        // If the form sent its request, the client accepted the value; text that appears afterwards
        // ("thanks!" or "network error" from the blocked request) is not a validation message.
        obs.rejected = !obs.valid || (obs.uiError && !obs.requestSent);
        obs.submitAttempted = submitted > 0 && obs.valid;
        Object.assign(cell, { observed: obs });

        let gap = null;
        if (expectation === 'reject-if-required' || expectation === 'reject') {
          if (!obs.rejected) gap = { severity: expectation === 'reject' && purpose === 'email' ? 'Medium' : 'Medium',
            title: `"${label}" accepts ${caseId.replace(/-/g, ' ')} input ("${cell.value}")`,
            expected: 'Inline validation error; form does not submit', actual: 'No validation error; the form tried to submit (blocked by the QA agent)' };
        } else if (expectation === 'accept') {
          // Non-Latin rejection is High for a Hebrew/RTL audience; for other sites it is an i18n gap (Medium).
          if (obs.rejected) gap = { severity: (caseId === 'hebrew' || caseId === 'mixed-direction') && sitemap.rtlDetected ? 'High' : 'Medium',
            title: `"${label}" rejects valid ${caseId.replace(/-/g, ' ')} input ("${cell.value}")`,
            expected: 'Accepted', actual: `Rejected${obs.message ? `: "${obs.message}"` : ''}` };
        } else if (expectation === 'max') {
          if (obs.valueLength > f.maxLength) gap = { severity: 'Low', title: `"${label}" holds more than its maxlength (${obs.valueLength} > ${f.maxLength})`,
            expected: `At most ${f.maxLength} characters`, actual: `${obs.valueLength} characters` };
        }
        cell.result = gap ? 'gap' : 'pass';
        if (gap) {
          const shot = path.join(shots, `${slug(label, 30)}-${caseId}.png`);
          await page.screenshot({ path: shot }).catch(() => {});
          add({ ruleId: `field-${caseId}`, page: url, ...gap,
            steps: [`Open ${url}`, `Fill other required fields with valid values`, `Enter ${JSON.stringify(cell.value)} in "${label}"`, 'Click the submit button'],
            remediation: expectation === 'accept' ? 'Relax the validation pattern (Unicode letters, apostrophes, spaces) and validate on the server too.'
              : 'Validate on the client (trim, pattern/type) and on the server.',
            evidence: { screenshot: path.relative(outDir, shot), details: JSON.stringify(obs) } });
        }
      } catch (e) {
        cell.result = 'not-tested'; cell.reason = String(e.message || e).split('\n')[0].slice(0, 160);
      } finally {
        matrix.push(cell);
        await page.close();
      }
    }
  }
  const cells = matrix.filter(c => c.page === url && c.form === form.index);
  coverage.push({ category: 'Forms', page: url, viewport: 'desktop',
    status: cells.length && cells.every(c => c.result !== 'not-tested') ? 'tested' : cells.some(c => c.result !== 'not-tested') ? 'tested' : 'not-tested',
    reason: cells.filter(c => c.result === 'not-tested').map(c => `${c.field}/${c.case}: ${c.reason}`).slice(0, 2).join('; ') || undefined });
  for (const c of cells.filter(c => c.result === 'not-tested')) notCovered.push({ page: url, reason: `Field "${c.field}" case ${c.case} not tested: ${c.reason}` });
}
if (forms.length > maxForms) notCovered.push({ reason: `Field matrix capped at ${maxForms} of ${forms.length} forms` });
if (!forms.length) notCovered.push({ reason: 'No non-search forms found for the field matrix' });

await browser.close();
writeJson(path.join(outDir, 'field-matrix.json'), { generatedAt: new Date().toISOString(), cells: matrix });
writeJson(path.join(outDir, 'findings.fields.json'), { findings, coverage, notCovered });
const tally = matrix.reduce((a, c) => (a[c.result] = (a[c.result] || 0) + 1, a), {});
console.log(`[fields] ${forms.slice(0, maxForms).length} form(s), ${matrix.length} cells`, tally, `→ ${findings.length} findings`);

// Error signal for one field: text of known error containers anywhere + text near the field
// (its wrapper, aria-describedby targets, following siblings). Compared before/after submit,
// so site-specific error markup (e.g. <span class="err">) is detected without knowing it.
async function visibleErrors(page, sel, formIndex) {
  return page.evaluate(({ sel, formIndex }) => {
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const text = e => (e && vis(e) ? e.innerText.trim() : '');
    const global = [...document.querySelectorAll('[role=alert], [aria-live], .invalid-feedback, [class*=error i], [class*=err i], [id*=error i], [id*=err i]')]
      .map(text).filter(Boolean).join(' | ');
    const form = document.querySelectorAll('form')[formIndex];
    const el = form && sel ? form.querySelector(sel) : null;
    let near = '';
    if (el) {
      const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      near += ids.map(id => text(document.getElementById(id))).join(' ');
      for (let n = el.nextElementSibling, i = 0; n && i < 3; n = n.nextElementSibling, i++) if (n.tagName !== 'INPUT' && n.tagName !== 'LABEL') near += ' ' + text(n);
      const wrap = el.closest('div, fieldset, p, li');
      if (wrap && wrap !== form) near += ' ' + [...wrap.children].filter(c => c !== el && c.tagName !== 'LABEL' && !c.contains(el)).map(text).join(' ');
    }
    return { global, near: near.trim() };
  }, { sel, formIndex });
}
function CSSesc(s) { return String(s).replace(/([^a-zA-Z0-9_-])/g, '\\$1'); }
