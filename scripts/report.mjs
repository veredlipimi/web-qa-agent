#!/usr/bin/env node
// Phase 6 — Report. Merges auto + manual findings, applies triage, groups duplicates,
// ranks by severity, writes report.html / report.md / findings.csv / findings.json.
// Usage: node report.mjs --run qa-runs/x [--title "Site QA report"] [--lang he|en]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, need, readJson, writeJson, SEVERITY_ORDER } from './lib.mjs';
import { localizeFinding, heString } from './i18n-he.mjs';
import { loadGateConfig, evaluateGate, computeDelta } from './gate.mjs';
import { loadTraceability, testCasesCsv } from './requirements.mjs';
import { apiCsv } from './api-inventory.mjs';

const args = parseArgs();
const run = need(args, 'run', 'run folder');
const lang = args.lang === 'he' ? 'he' : 'en';
const sitemap = readJson(path.join(run, 'sitemap.json'), { pages: [], startUrl: '' });
const auto = readJson(path.join(run, 'findings.auto.json'), { findings: [], notCovered: [], viewports: [] });
const manual = readJson(path.join(run, 'findings.manual.json'), { findings: [] });
const fields = readJson(path.join(run, 'findings.fields.json'), { findings: [], coverage: [], notCovered: [] });
const redirects = readJson(path.join(run, 'findings.redirects.json'), { findings: [], coverage: [], notCovered: [] });
const actions = readJson(path.join(run, 'findings.actions.json'), { findings: [], coverage: [], notCovered: [] });
for (const k of ['findings', 'coverage', 'notCovered']) fields[k] = [...(fields[k] || []), ...(redirects[k] || []), ...(actions[k] || [])];
const triage = readJson(path.join(run, 'triage.json'), { dismiss: [], severity: [] });
const assumptions = readJson(path.join(run, 'assumptions.json'), []);
const suiteResult = readJson(path.join(run, 'suite-result.json'), null);
const profile = readJson(path.join(run, 'app-profile.json'), null);
const title = args.title || `QA report — ${safeHost(sitemap.startUrl)}`;

const T = {
  en: { summary: 'Summary', verdict: 'Verdict', findings: 'Gaps identified', sev: 'Severity', cat: 'Category',
    where: 'Where', steps: 'Steps to reproduce', expected: 'Expected', actual: 'Actual', evidence: 'Evidence',
    notCovered: 'Not covered', dismissed: 'Dismissed during triage', assumptions: 'Assumptions', scope: 'Scope',
    pages: 'pages', viewports: 'viewports', manual: 'exploratory', auto: 'automated', suite: 'Automation suite',
    v: { stop: 'Not ready to ship — critical gaps identified', risk: 'Ship only with the High gaps accepted or fixed', ok: 'No blocking gaps identified' },
    affected: 'Affected', none: 'None', byCat: 'By category', reason: 'Reason', fix: 'Suggested remediation (for the dev team)', verify: 'needs verification',
    coverage: 'Coverage', tested: 'Tested', notTested: 'Not tested', blocked: 'Blocked', scoped: 'in the tested scope only', covNote: 'A clean result covers only what was tested. Not-tested and blocked checks are not passes.',
    gate: 'Release gate', waived: 'waived', delta: 'Since the previous run', regressions: 'Regressions (were fixed, failing again)', added: 'New gaps', fixed: 'Fixed', expiredW: 'Expired waivers (no longer applied)', strictB: 'Strict mode: categories with untested checks',
    pre: 'Preconditions', req: 'Requirement', type: 'Type', impact: 'Impact / risk', questions: 'Open questions for product / dev', trace: 'Requirements traceability',
    traceNote: 'Each requirement → the test cases that cover it → the result. Judged from what a user can see and do, not from source code.', cases: 'Test cases', status: 'Status', reqWarn: 'Traceability warnings', reqPassed: 'requirements pass', api: 'API endpoints observed', apiNote: 'Every XHR/fetch call the pages made while loading, grouped by endpoint. A starting point for API test scenarios — observed, never called by the agent.', method: 'Method', endpoint: 'Endpoint', calls: 'Calls', statuses: 'Statuses', slowest: 'Slowest', onlyChromium: 'Firefox and Safari (WebKit) not tested — the audit and suite ran on Chromium only', missingB: (b) => `Not tested on ${b} — the suite ran without it` },
  he: { summary: 'תקציר', verdict: 'שורה תחתונה', findings: 'פערים שזוהו', sev: 'חומרה', cat: 'קטגוריה',
    where: 'איפה', steps: 'צעדים לשחזור', expected: 'צפוי', actual: 'בפועל', evidence: 'ראיות',
    notCovered: 'לא נבדק', dismissed: 'נפסל בטריאז׳', assumptions: 'הנחות', scope: 'היקף',
    pages: 'עמודים', viewports: 'רזולוציות', manual: 'חקירתי', auto: 'אוטומטי', suite: 'סוויטת אוטומציה',
    v: { stop: 'לא מוכן לעלייה — זוהו פערים קריטיים', risk: 'לעלות רק אם פערי ה-High תוקנו או התקבלו', ok: 'לא זוהו פערים חוסמים' },
    affected: 'מופעים', none: 'אין', byCat: 'לפי קטגוריה', reason: 'סיבה', fix: 'המלצה לתיקון (לצוות הפיתוח)', verify: 'דורש אימות',
    coverage: 'כיסוי', tested: 'נבדק', notTested: 'לא נבדק', blocked: 'חסום', scoped: 'בטווח שנבדק בלבד', covNote: 'תוצאה נקייה מתייחסת רק למה שנבדק. בדיקות שלא רצו או נחסמו אינן הצלחה.',
    gate: 'שער שחרור', waived: 'פטור', delta: 'מאז ההרצה הקודמת', regressions: 'רגרסיות (תוקנו וחזרו)', added: 'פערים חדשים', fixed: 'תוקנו', expiredW: 'פטורים שפג תוקפם (לא חלים)', strictB: 'מצב קפדני: קטגוריות עם בדיקות שלא רצו',
    pre: 'תנאים מקדימים', req: 'דרישה', type: 'סוג', impact: 'השפעה / סיכון', questions: 'שאלות פתוחות למוצר / לפיתוח', trace: 'מעקב דרישות',
    traceNote: 'כל דרישה ← מקרי הבדיקה שמכסים אותה ← התוצאה. נבחן לפי מה שמשתמש רואה ועושה, לא לפי קוד המקור.', cases: 'מקרי בדיקה', status: 'סטטוס', reqWarn: 'אזהרות מעקב', reqPassed: 'דרישות עברו', api: 'נקודות API שנצפו', apiNote: 'כל קריאות XHR/fetch שהעמודים ביצעו בזמן הטעינה, מקובצות לפי endpoint. בסיס לתרחישי בדיקת API — נצפו בלבד, הסוכן לא קרא להן בעצמו.', method: 'שיטה', endpoint: 'נקודת קצה', calls: 'קריאות', statuses: 'סטטוסים', slowest: 'האיטית ביותר', onlyChromium: 'Firefox ו-Safari (WebKit) לא נבדקו — הבדיקה והסוויטה רצו על Chromium בלבד', missingB: (b) => `לא נבדק ב-${b} — הסוויטה רצה בלעדיו` },
}[lang];
const SEV_HE = { Critical: 'קריטי', High: 'גבוה', Medium: 'בינוני', Low: 'נמוך', Info: 'מידע' };
const sevLabel = s => (lang === 'he' ? `${SEV_HE[s]} · ${s}` : s);

// ---- merge
const raw = [
  ...auto.findings.map(f => ({ ...f, source: 'auto', originalTitle: f.title })),
  ...(fields.findings || []).map(f => ({ ...f, source: 'auto', originalTitle: f.title })),
  ...(manual.findings || []).map(f => ({ ...f, source: 'manual' })),
];
const L = f => (lang === 'he' ? localizeFinding(f) : f);
for (let i = 0; i < raw.length; i++) raw[i] = L(raw[i]);
const matches = (f, m) => f.ruleId === m || (f.title || '').toLowerCase().includes(String(m).toLowerCase()) || (f.originalTitle || '').toLowerCase().includes(String(m).toLowerCase());
const dismissed = [];
const superseded = (manual.findings || []).map(m => m.supersedes).filter(Boolean);
const kept = [];
for (const f of raw) {
  if (f.source === 'auto' && superseded.some(m => matches(f, m))) { dismissed.push({ ...f, reason: 'Superseded by an exploratory finding' }); continue; }
  const d = (triage.dismiss || []).find(x => matches(f, x.match));
  if (d) { dismissed.push({ ...f, reason: d.reason }); continue; }
  const s = (triage.severity || []).find(x => matches(f, x.match));
  if (s && SEVERITY_ORDER.includes(s.severity)) { f.triageNote = s.reason; f.severity = s.severity; }
  kept.push(f);
}

// ---- group duplicates (same rule + same title shape → one gap with many locations)
const groups = new Map();
for (const f of kept) {
  const key = f.source === 'manual' ? `manual:${f.id || f.title}` : `${f.ruleId}:${(f.title || '').replace(/\d+(\.\d+)?/g, '#')}`;
  if (!groups.has(key)) groups.set(key, { ...f, occurrences: [] });
  const g = groups.get(key);
  if (SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(g.severity)) g.severity = f.severity;
  g.occurrences.push({ page: f.page, viewport: f.viewport, actual: f.actual, screenshot: f.evidence?.screenshot, details: f.evidence?.details });
}
const gaps = [...groups.values()].sort((a, b) =>
  SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
  (b.source === 'manual') - (a.source === 'manual') || b.occurrences.length - a.occurrences.length);
let autoN = 0;
gaps.forEach(g => { if (!(g.source === 'manual' && g.id)) g.id = `QA-${String(++autoN).padStart(3, '0')}`; });

const trace = loadTraceability(run, gaps.map(g => g.id));
if (trace) fs.writeFileSync(path.join(run, 'test-cases.csv'), testCasesCsv(trace));
const apiRows = auto.apiInventory || [];
if (apiRows.length) fs.writeFileSync(path.join(run, 'api-endpoints.csv'), apiCsv(apiRows));
// Browsers: the audit is Chromium; the suite may add firefox / webkit / mobile-safari (QA_BROWSERS).
const browsersRun = new Set([...(auto.findings.length || auto.coverage?.length ? ['chromium'] : []),
  ...((suiteResult?.projects) || []).map(p => (['desktop', 'mobile', 'visual'].includes(p) ? 'chromium' : p))]);
const browserGaps = !browsersRun.size ? [] : !browsersRun.has('firefox') && !browsersRun.has('webkit') && !browsersRun.has('mobile-safari')
  ? [{ reason: T.onlyChromium }]
  : [['firefox', 'Firefox'], ['webkit', 'Safari (WebKit)']].filter(([k]) => !browsersRun.has(k) && !(k === 'webkit' && browsersRun.has('mobile-safari'))).map(([, n]) => ({ reason: T.missingB(n) }));
const questions = (manual.openQuestions || []).map(q => (typeof q === 'string' ? { question: q } : q)).filter(q => q.question);
const counts = Object.fromEntries(SEVERITY_ORDER.map(s => [s, gaps.filter(g => g.severity === s).length]));
const byCat = gaps.reduce((a, g) => (a[g.category] = (a[g.category] || 0) + 1, a), {});
const coverage = [...(auto.coverage || []), ...(fields.coverage || []), ...(manual.coverage || [])];
const CATS = ['Functional', 'Forms', 'Redirects', 'API/Network', 'Accessibility', 'Performance', 'Responsive', 'RTL/i18n', 'SEO', 'Security', 'Exploratory'];
const covRows = CATS.map(c => {
  const rows = coverage.filter(x => x.category === c && x.status !== 'n/a');
  return { category: c, tested: rows.filter(x => x.status === 'tested').length,
    notTested: rows.filter(x => x.status === 'not-tested').length, blocked: rows.filter(x => x.status === 'blocked').length,
    reasons: [...new Set(rows.filter(x => x.status !== 'tested').map(x => lang === 'he' ? heString(x.reason) : x.reason).filter(Boolean))] };
}).filter(r => r.tested + r.notTested + r.blocked > 0);
const covTotal = covRows.reduce((a, r) => a + r.tested + r.notTested + r.blocked, 0);
const covTested = covRows.reduce((a, r) => a + r.tested, 0);
const covPct = covTotal ? Math.round((covTested / covTotal) * 100) : 0;
const fullCoverage = covTotal > 0 && covTested === covTotal;
const baseVerdict = counts.Critical ? T.v.stop : counts.High ? T.v.risk : T.v.ok;
const gateCfg = loadGateConfig(run);
const gate = evaluateGate(gaps, covRows, gateCfg);
const delta = computeDelta(run, safeHost(sitemap.startUrl), gaps);
const verdict = fullCoverage || counts.Critical ? baseVerdict : `${baseVerdict} (${T.scoped} — ${T.coverage} ${covPct}%)`;
const notCovered = [...browserGaps, ...(auto.notCovered || []), ...(fields.notCovered || []), ...(manual.notCovered || []),
  ...((suiteResult?.notTestedList) || []).map(n => ({ page: n.test, reason: `Suite: ${n.reason}` }))]
  .map(n => (lang === 'he' ? { ...n, reason: heString(n.reason) } : n));
// One line per dismissed root cause, not per occurrence.
const dismissedGrouped = Object.values(dismissed.reduce((a, d) => { const k = `${d.title}|${d.reason}`; (a[k] ||= { ...d, n: 0 }).n++; return a; }, {}));

// ---- JSON + CSV
const flat = gaps.map(g => ({
  id: g.id, severity: g.severity, category: g.category, title: g.title, source: g.source, ruleId: g.ruleId || '',
  occurrences: g.occurrences.length, pages: [...new Set(g.occurrences.map(o => o.page))].join(' | '),
  viewports: [...new Set(g.occurrences.map(o => o.viewport))].join(' | '),
  steps: (g.steps || []).join(' → '), expected: g.expected || '', actual: g.actual || '',
  screenshot: g.occurrences.find(o => o.screenshot)?.screenshot || '', details: g.evidence?.details || '',
  confidence: g.confidence || 'confirmed', remediation: g.remediation || '',
  preconditions: g.preconditions || '', requirement: [].concat(g.requirement || []).join(' | '), type: g.type || '', impact: g.impact || '',
}));
writeJson(path.join(run, 'findings.json'), { title, generatedAt: new Date().toISOString(), verdict, counts, coverage: { percent: covPct, tested: covTested, total: covTotal, byCategory: covRows }, gate, delta, gaps, dismissed, notCovered, assumptions, traceability: trace, openQuestions: questions, browsers: [...browsersRun], apiInventory: apiRows });
const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const cols = Object.keys(flat[0] || { id: '', severity: '', category: '', title: '' });
fs.writeFileSync(path.join(run, 'findings.csv'), '﻿' + [cols.join(','), ...flat.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n'));

// ---- Markdown
const md = [];
md.push(`# ${title}`, '', `**${T.verdict}:** ${verdict}`, '');
md.push(`**${T.gate}:** ${gate.status === 'PASS' ? '✅ PASS' : '⛔ FAIL'} — blocks on ${gate.blockOn.join('/')}${gate.strict ? ' + strict' : ''}${gate.blocking.length ? ` · ${gate.blocking.map(b => b.id).join(', ')}` : ''}${gate.waived.length ? ` · ${T.waived}: ${gate.waived.map(w => w.id).join(', ')}` : ''}`, '');
if (gate.strictBlocks.length) md.push(`${T.strictB}: ${gate.strictBlocks.map(b => b.category).join(', ')}`, '');
if (gate.expiredWaivers.length) md.push(`${T.expiredW}: ${gate.expiredWaivers.map(w => `${w.match} (${w.expires})`).join(', ')}`, '');
if (delta) {
  md.push(`## ${T.delta}`, '');
  const L = (arr) => arr.length ? arr.map(g => `${g.id} ${g.title}`).join('; ') : T.none;
  md.push(`- 🔴 ${T.regressions}: ${L(delta.regressions)}`, `- 🆕 ${T.added}: ${L(delta.added)}`, `- ✅ ${T.fixed}: ${L(delta.fixed)}`, '');
}
md.push(`## ${T.summary}`, '');
if (profile?.purpose) md.push(`- ${profile.purpose}`);
md.push(`- ${T.scope}: ${sitemap.startUrl} — ${sitemap.pages.length} ${T.pages}, ${T.viewports}: ${(auto.viewports || []).join(', ')}`);
md.push(`- ${SEVERITY_ORDER.map(s => `${sevLabel(s)}: ${counts[s]}`).join(' · ')}`);
md.push(`- ${T.byCat}: ${Object.entries(byCat).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
if (suiteResult) md.push(`- ${T.suite}: ${suiteResult.passed ?? '?'} passed, ${suiteResult.failed ?? '?'} failed, ${suiteResult.expectedFail ?? 0} known gaps (test.fail), ${suiteResult.notTested ?? 0} NOT TESTED${suiteResult.fixedGaps ? `, ${suiteResult.fixedGaps} known gaps now pass` : ''}`);
md.push('', `## ${T.coverage} — ${covPct}% (${covTested}/${covTotal})`, '', `_${T.covNote}_`, '');
md.push(`| ${T.cat} | ${T.tested} | ${T.notTested} | ${T.blocked} | ${T.reason} |`, '|---|---|---|---|---|');
for (const r of covRows) md.push(`| ${r.category} | ${r.tested} | ${r.notTested} | ${r.blocked} | ${r.reasons.slice(0, 3).join('; ').replace(/\|/g, '/')} |`);
if (trace) {
  md.push('', `## ${T.trace} — ${trace.passedRequirements}/${trace.requirements.length} ${T.reqPassed}`, '', `_${T.traceNote}_`, '');
  md.push(`| ${T.req} | ${T.status} | ${T.cases} | ${T.findings} |`, '|---|---|---|---|');
  for (const r of trace.requirements) md.push(`| ${r.id}: ${String(r.text).replace(/\|/g, '/')} | ${r.status} | ${r.cases.join(', ') || '—'} | ${r.gaps.join(', ') || '—'} |`);
  md.push('', `${T.cases}: ${Object.entries(trace.counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ')} — \`test-cases.csv\``);
  if (trace.warnings.length) { md.push('', `**${T.reqWarn}:**`); trace.warnings.forEach(w => md.push(`- ${w.case || w.requirement}: ${w.problem}`)); }
}
md.push('', `## ${T.findings}`, '');
for (const g of gaps) {
  md.push(`### ${g.id} · ${g.severity}${g.confidence === 'verify' ? ` · ${T.verify}` : ''} · ${g.title}`, '');
  md.push(`*${g.category} · ${g.source === 'manual' ? T.manual : T.auto}${g.ruleId ? ` · ${g.ruleId}` : ''}${g.type ? ` · ${g.type}` : ''}${g.requirement ? ` · ${T.req}: ${[].concat(g.requirement).join(', ')}` : ''}*`, '');
  if (g.preconditions) md.push(`**${T.pre}:** ${g.preconditions}`, '');
  if (g.steps?.length) { md.push(`**${T.steps}:**`); g.steps.forEach((s, i) => md.push(`${i + 1}. ${s}`)); md.push(''); }
  if (g.expected) md.push(`**${T.expected}:** ${g.expected}  `);
  if (g.actual) md.push(`**${T.actual}:** ${g.actual}`);
  if (g.impact) md.push('', `**${T.impact}:** ${g.impact}`);
  md.push('', `**${T.affected} (${g.occurrences.length}):**`);
  for (const o of g.occurrences.slice(0, 10)) md.push(`- ${o.page} — ${o.viewport}${o.screenshot ? ` — ![](${o.screenshot})` : ''}`);
  if (g.occurrences.length > 10) md.push(`- … +${g.occurrences.length - 10}`);
  if (g.evidence?.details) md.push('', '```', g.evidence.details, '```');
  if (g.remediation) md.push('', `**${T.fix}:** ${g.remediation}`);
  if (g.triageNote) md.push('', `> ${g.triageNote}`);
  md.push('');
}
const statusStr = r => [...Object.entries(r.statuses).map(([k, n]) => `${k}×${n}`), ...(r.failures ? [`failed×${r.failures}`] : [])].join(' ');
if (apiRows.length) {
  md.push(`## ${T.api} (${apiRows.length})`, '', `_${T.apiNote}_ — \`api-endpoints.csv\``, '', `| ${T.method} | ${T.endpoint} | ${T.calls} | ${T.statuses} | ${T.slowest} |`, '|---|---|---|---|---|');
  for (const r of apiRows.slice(0, 25)) md.push(`| ${r.method} | \`${r.host}${r.path}\`${r.query.length ? ` ?${r.query.join('&')}` : ''} | ${r.calls} | ${statusStr(r)} | ${r.maxMs} ms |`);
  if (apiRows.length > 25) md.push('', `… +${apiRows.length - 25}`);
  md.push('');
}
if (questions.length) { md.push(`## ${T.questions}`, ''); questions.forEach(q => md.push(`- ${q.question}${q.for ? ` _(${q.for})_` : ''}${q.related ? ` — ${[].concat(q.related).join(', ')}` : ''}`)); md.push(''); }
if (assumptions.length) { md.push(`## ${T.assumptions}`, ''); assumptions.forEach(a => md.push(`- ${a}`)); md.push(''); }
md.push(`## ${T.notCovered}`, ''); if (!notCovered.length) md.push(`- ${T.none}`);
notCovered.forEach(n => md.push(`- ${[n.page, n.viewport, n.reason].filter(Boolean).join(' — ')}`));
if (dismissed.length) { md.push('', `## ${T.dismissed}`, ''); dismissedGrouped.forEach(d => md.push(`- ${d.title}${d.n > 1 ? ` (×${d.n})` : ''} — ${d.reason}`)); }
fs.writeFileSync(path.join(run, 'report.md'), md.join('\n') + '\n');

// ---- HTML (self-contained, light/dark, RTL when lang=he)
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sevClass = s => `sev-${s.toLowerCase()}`;
const gapHtml = g => `
<article class="gap" data-sev="${g.severity}" data-cat="${esc(g.category)}">
  <header>
    <span class="pill ${sevClass(g.severity)}">${esc(sevLabel(g.severity))}</span>
    <span class="id">${g.id}</span>${g.waiver ? `<span class="pill sev-info">${T.waived}</span>` : ''}${g.confidence === 'verify' ? `<span class="pill sev-info">${T.verify}</span>` : ''}
    <h3>${esc(g.title)}</h3>
  </header>
  <p class="meta">${esc(g.category)} · ${g.source === 'manual' ? T.manual : T.auto}${g.ruleId ? ` · <code>${esc(g.ruleId)}</code>` : ''}${g.type ? ` · ${esc(g.type)}` : ''}${g.requirement ? ` · ${T.req}: ${esc([].concat(g.requirement).join(', '))}` : ''}</p>
  ${g.preconditions ? `<p><strong>${T.pre}:</strong> ${esc(g.preconditions)}</p>` : ''}
  ${g.steps?.length ? `<h4>${T.steps}</h4><ol>${g.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
  <dl>${g.expected ? `<dt>${T.expected}</dt><dd>${esc(g.expected)}</dd>` : ''}${g.actual ? `<dt>${T.actual}</dt><dd>${esc(g.actual)}</dd>` : ''}${g.impact ? `<dt>${T.impact}</dt><dd>${esc(g.impact)}</dd>` : ''}</dl>
  ${g.evidence?.details ? `<pre>${esc(g.evidence.details)}</pre>` : ''}
  ${g.remediation ? `<p><strong>${T.fix}:</strong> ${esc(g.remediation)}</p>` : ''}
  ${g.triageNote ? `<p class="note">${esc(g.triageNote)}</p>` : ''}
  <details><summary>${T.affected}: ${g.occurrences.length}</summary><ul>
    ${g.occurrences.map(o => `<li><a href="${esc(o.page)}" target="_blank" rel="noopener">${esc(o.page)}</a> — ${esc(o.viewport)}${o.actual && o.actual !== g.actual ? ` — ${esc(o.actual)}` : ''}${o.screenshot ? ` — <a href="${esc(o.screenshot)}" target="_blank">screenshot</a>` : ''}</li>`).join('')}
  </ul></details>
  ${g.occurrences.find(o => o.screenshot) ? `<a href="${esc(g.occurrences.find(o => o.screenshot).screenshot)}" target="_blank"><img loading="lazy" src="${esc(g.occurrences.find(o => o.screenshot).screenshot)}" alt="${T.evidence}: ${esc(g.title)}"></a>` : ''}
</article>`;

const html = `<!doctype html>
<html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#6b6a65;--line:#e4e1d9;--card:#fff;
--crit:#b3261e;--high:#c2410c;--med:#a16207;--low:#2563eb;--info:#6b7280;--ok:#15803d}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecebe6;--muted:#a3a29b;--line:#2e2d2a;--card:#1f1e1b;
--crit:#f2867f;--high:#fb923c;--med:#facc15;--low:#7aa7ff;--info:#a1a1aa;--ok:#4ade80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Rubik,Arial,sans-serif}
main{max-width:860px;margin:0 auto;padding:56px 20px 96px}
h1{font-size:2.1rem;line-height:1.2;margin:0 0 8px;letter-spacing:-.01em}
.sub{color:var(--muted);margin:0 0 40px}
.verdict{font-size:1.25rem;font-weight:600;padding:18px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-bottom:40px}
.counts{display:flex;flex-wrap:wrap;gap:28px;margin:0 0 48px}.counts div{min-width:72px}
.counts b{display:block;font-size:2rem;line-height:1}.counts span{color:var(--muted);font-size:.85rem}
h2{font-size:1.5rem;margin:64px 0 20px}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:28px}
.filters button{font:inherit;font-size:.85rem;border:1px solid var(--line);background:transparent;color:var(--fg);padding:6px 12px;border-radius:999px;cursor:pointer}
.filters button[aria-pressed=true]{background:var(--fg);color:var(--bg)}
.gap{padding:32px 0;border-top:1px solid var(--line)}
.gap header{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px}
.gap h3{flex-basis:100%;font-size:1.2rem;margin:6px 0 0;line-height:1.35}
.id{color:var(--muted);font-variant-numeric:tabular-nums;font-size:.85rem}
.pill{font-size:.75rem;font-weight:600;letter-spacing:.02em;padding:2px 10px;border-radius:999px;border:1px solid currentColor}
.sev-critical{color:var(--crit)}.sev-high{color:var(--high)}.sev-medium{color:var(--med)}.sev-low{color:var(--low)}.sev-info{color:var(--info)}
.meta{color:var(--muted);font-size:.9rem;margin:4px 0 16px}
h4{font-size:.95rem;margin:16px 0 4px}dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:12px 0}dt{color:var(--muted)}dd{margin:0}
pre{white-space:pre-wrap;word-break:break-word;background:var(--card);border:1px solid var(--line);padding:12px;border-radius:8px;font-size:.82rem}
details{margin:12px 0}summary{cursor:pointer;color:var(--muted)}details li{word-break:break-all;font-size:.9rem}
img{display:block;max-width:100%;max-height:360px;object-fit:cover;object-position:top;border:1px solid var(--line);border-radius:8px;margin-top:12px}
.note{border-inline-start:3px solid var(--line);padding-inline-start:12px;color:var(--muted)}
.gap h3,.gap li,.gap dd,.gap pre,.plain li{unicode-bidi:plaintext;text-align:start}
.tablewrap{overflow-x:auto}table.cov{border-collapse:collapse;width:100%;font-size:.9rem}
table.cov th,table.cov td{text-align:start;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
table.cov th{color:var(--muted);font-weight:500}td.warn{color:var(--high);font-weight:600}
.gate{padding:10px 14px;border-radius:8px;border:1px solid var(--line)}.gate.fail{color:var(--crit);border-color:currentColor}.gate.pass{color:var(--ok);border-color:currentColor}
a{color:inherit}ul.plain{padding-inline-start:20px}code{font-size:.85em}
</style></head>
<body><main>
<h1>${esc(title)}</h1>
<p class="sub">${esc(sitemap.startUrl)} · ${sitemap.pages.length} ${T.pages} · ${T.viewports}: ${esc((auto.viewports || []).join(', '))} · ${new Date().toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB')}</p>
${profile?.purpose ? `<p>${esc(profile.purpose)}</p>` : ''}
<div class="verdict">${T.verdict}: ${esc(verdict)}</div>
<p class="gate ${gate.status === 'PASS' ? 'pass' : 'fail'}"><strong>${T.gate}: ${gate.status}</strong> · ${esc(gate.blockOn.join('/'))}${gate.strict ? ' + strict' : ''}${gate.blocking.length ? ` · ${esc(gate.blocking.map(b => b.id).join(', '))}` : ''}${gate.waived.length ? ` · ${T.waived}: ${esc(gate.waived.map(w => `${w.id} (${w.reason}${w.expires ? `, ${w.expires}` : ''})`).join(', '))}` : ''}</p>
${delta ? `<h2>${T.delta}</h2><ul class="plain">
  <li>🔴 ${T.regressions}: ${delta.regressions.length ? esc(delta.regressions.map(g => `${g.id} ${g.title}`).join(' · ')) : T.none}</li>
  <li>🆕 ${T.added}: ${delta.added.length ? esc(delta.added.map(g => `${g.id} ${g.title}`).join(' · ')) : T.none}</li>
  <li>✅ ${T.fixed}: ${delta.fixed.length ? esc(delta.fixed.map(g => `${g.id} ${g.title}`).join(' · ')) : T.none}</li></ul>` : ''}
<div class="counts">${SEVERITY_ORDER.map(s => `<div class="${sevClass(s)}"><b>${counts[s]}</b><span>${esc(sevLabel(s))}</span></div>`).join('')}</div>
${suiteResult ? `<p style="unicode-bidi:plaintext">${T.suite}: ${suiteResult.passed ?? '?'} passed · ${suiteResult.failed ?? '?'} failed · ${suiteResult.expectedFail ?? 0} known gaps (test.fail) · ${suiteResult.notTested ?? 0} NOT TESTED</p>` : ''}
<h2>${T.coverage} · ${covPct}%</h2>
<p class="meta">${esc(T.covNote)}</p>
<div class="tablewrap"><table class="cov"><thead><tr><th>${T.cat}</th><th>${T.tested}</th><th>${T.notTested}</th><th>${T.blocked}</th><th>${T.reason}</th></tr></thead><tbody>
${covRows.map(r => `<tr><td>${esc(r.category)}</td><td>${r.tested}</td><td class="${r.notTested ? 'warn' : ''}">${r.notTested}</td><td class="${r.blocked ? 'warn' : ''}">${r.blocked}</td><td>${esc(r.reasons.slice(0, 3).join('; '))}</td></tr>`).join('')}
</tbody></table></div>
${trace ? `<h2>${T.trace} · ${trace.passedRequirements}/${trace.requirements.length}</h2>
<p class="meta">${esc(T.traceNote)}</p>
<div class="tablewrap"><table class="cov"><thead><tr><th>${T.req}</th><th>${T.status}</th><th>${T.cases}</th><th>${T.findings}</th></tr></thead><tbody>
${trace.requirements.map(r => `<tr><td><strong>${esc(r.id)}</strong> ${esc(r.text)}</td><td class="${r.status === 'PASS' ? '' : 'warn'}">${esc(r.status)}</td><td>${esc(r.cases.join(', ') || '—')}</td><td>${esc(r.gaps.join(', ') || '—')}</td></tr>`).join('')}
</tbody></table></div>
<p class="meta">${T.cases}: ${esc(Object.entries(trace.counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · '))} · <a href="test-cases.csv">test-cases.csv</a></p>
${trace.warnings.length ? `<p class="note"><strong>${T.reqWarn}</strong><br>${trace.warnings.map(w => esc(`${w.case || w.requirement}: ${w.problem}`)).join('<br>')}</p>` : ''}` : ''}
<h2>${T.findings}</h2>
<div class="filters" role="group">
  <button aria-pressed="true" data-f="all">All · ${gaps.length}</button>
  ${SEVERITY_ORDER.filter(s => counts[s]).map(s => `<button aria-pressed="false" data-f="sev:${s}">${esc(sevLabel(s))} · ${counts[s]}</button>`).join('')}
  ${Object.entries(byCat).map(([c, n]) => `<button aria-pressed="false" data-f="cat:${esc(c)}">${esc(c)} · ${n}</button>`).join('')}
</div>
<section id="gaps">${gaps.map(gapHtml).join('') || `<p>${T.none}</p>`}</section>
${apiRows.length ? `<h2>${T.api} · ${apiRows.length}</h2><p class="meta">${esc(T.apiNote)} · <a href="api-endpoints.csv">api-endpoints.csv</a></p>
<div class="tablewrap"><table class="cov"><thead><tr><th>${T.method}</th><th>${T.endpoint}</th><th>${T.calls}</th><th>${T.statuses}</th><th>${T.slowest}</th></tr></thead><tbody>
${apiRows.slice(0, 25).map(r => `<tr><td>${esc(r.method)}</td><td><code>${esc(r.host + r.path)}</code>${r.query.length ? ` <span class="meta">?${esc(r.query.join('&'))}</span>` : ''}</td><td>${r.calls}</td><td class="${Object.keys(r.statuses).some(k => k >= 400) || r.failures ? 'warn' : ''}">${esc(statusStr(r))}</td><td>${r.maxMs} ms</td></tr>`).join('')}
</tbody></table></div>` : ''}
${questions.length ? `<h2>${T.questions}</h2><ul class="plain">${questions.map(q => `<li>${esc(q.question)}${q.for ? ` <span class="meta">(${esc(q.for)})</span>` : ''}${q.related ? ` — ${esc([].concat(q.related).join(', '))}` : ''}</li>`).join('')}</ul>` : ''}
${assumptions.length ? `<h2>${T.assumptions}</h2><ul class="plain">${assumptions.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
<h2>${T.notCovered}</h2><ul class="plain">${notCovered.map(n => `<li>${esc([n.page, n.viewport, n.reason].filter(Boolean).join(' — '))}</li>`).join('') || `<li>${T.none}</li>`}</ul>
${dismissed.length ? `<h2>${T.dismissed}</h2><ul class="plain">${dismissedGrouped.map(d => `<li>${esc(d.title)}${d.n > 1 ? ` (×${d.n})` : ''} — ${esc(d.reason)}</li>`).join('')}</ul>` : ''}
</main>
<script>
document.querySelectorAll('.filters button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.filters button').forEach(x => x.setAttribute('aria-pressed', x === b));
  const f = b.dataset.f;
  document.querySelectorAll('.gap').forEach(g => {
    const show = f === 'all' || (f.startsWith('sev:') && g.dataset.sev === f.slice(4)) || (f.startsWith('cat:') && g.dataset.cat === f.slice(4));
    g.hidden = !show;
  });
}));
</script>
</body></html>`;
fs.writeFileSync(path.join(run, 'report.html'), html);

console.log(`[report] ${gaps.length} gaps (${SEVERITY_ORDER.map(s => `${s} ${counts[s]}`).join(', ')}), ${dismissed.length} dismissed`);
console.log(`[report] ${verdict}`);
if (trace) console.log(`[report] requirements: ${trace.passedRequirements}/${trace.requirements.length} pass · ${trace.cases.length} test cases${trace.warnings.length ? ` · ${trace.warnings.length} traceability warnings` : ''} → test-cases.csv`);
console.log(`[report] gate ${gate.status}${gate.blocking.length ? `: ${gate.blocking.map(b => b.id).join(', ')}` : ''}${delta ? ` | delta: ${delta.regressions.length} regressions, ${delta.added.length} new, ${delta.fixed.length} fixed` : ''}`);
console.log(`[report] ${path.join(run, 'report.html')}`);

function safeHost(u) { try { return new URL(u).host; } catch { return 'site'; } }

if (args.gate && gate.status === 'FAIL') process.exit(1);
