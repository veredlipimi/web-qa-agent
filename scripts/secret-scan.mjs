#!/usr/bin/env node
// Secrets in what the browser downloads: the JavaScript (and inline scripts) every visitor receives.
// Passive: GET only, the same files a browser loads. Values are never written out in full —
// findings show the first 4 and last 4 characters (rule 8: credentials never appear in output).
//
//   node secret-scan.mjs --sitemap <run>/sitemap.json --out <run> [--max-files 60]
// Output: <run>/findings.secrets.json (merged by report.mjs)
import crypto from 'node:crypto';
import path from 'node:path';
import { parseArgs, need, readJson, writeJson } from './lib.mjs';

const args = parseArgs();
const sitemap = readJson(need(args, 'sitemap'), null);
const outDir = need(args, 'out');
const maxFiles = Number(args['max-files'] || 60);
const UA = 'web-qa-agent (passive secret scan)';

// [id, label, regex, severity, note]. Publishable / public-by-design keys are reported as Info or ignored.
export const PATTERNS = [
  ['stripe-secret', 'Stripe secret key', /\b(sk|rk)_live_[0-9a-zA-Z]{20,}\b/g, 'Critical', 'A live Stripe secret key lets anyone charge, refund and read customers.'],
  ['aws-access-key', 'AWS access key ID', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, 'Critical', 'An AWS access key in client code — check for the matching secret and rotate both.'],
  ['private-key', 'Private key block', /-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/g, 'Critical', 'A private key shipped to every visitor.'],
  ['openai-key', 'OpenAI API key', /\bsk-(?!ant-)(proj-)?[A-Za-z0-9_-]{32,}\b/g, 'Critical', 'Anyone can spend on this account.'],
  ['anthropic-key', 'Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g, 'Critical', 'Anyone can spend on this account.'],
  ['github-token', 'GitHub token', /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{30,}\b/g, 'Critical', 'Repository access for anyone who reads the bundle.'],
  ['slack-token', 'Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, 'High', 'Workspace access or posting rights.'],
  ['sendgrid-key', 'SendGrid API key', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, 'High', 'Anyone can send email as this domain.'],
  ['twilio-key', 'Twilio API key', /\bSK[0-9a-fA-F]{32}\b/g, 'High', 'Anyone can send SMS or calls on this account.'],
  ['google-api-key', 'Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g, 'Info', 'Often public by design (Maps, Firebase web). Verify it is restricted by HTTP referrer and API.'],
];
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}\b/g;

// The identifier just before the value (e.g. STRIPE_SECRET=), so a reader can find it without the secret.
const contextOf = (text, i) => (text.slice(Math.max(0, i - 60), i).match(/([A-Za-z_$][\w$.]{2,40})\s*[:=]\s*["'`]?$/) || [])[1] || null;
export const redact = v => (v.length <= 12 ? v.slice(0, 2) + '…' : `${v.slice(0, 4)}…${v.slice(-4)}`);

export function scanText(text) {
  const hits = [];
  for (const [id, label, re, severity, note] of PATTERNS) {
    for (const m of text.matchAll(re)) hits.push({ id, label, severity, note, value: redact(m[0]), key: crypto.createHash('sha256').update(m[0]).digest('hex').slice(0, 16), context: contextOf(text, m.index), index: m.index });
  }
  // JWTs: only a service-role / admin token is a secret; an anon key is meant to be public.
  for (const m of text.matchAll(JWT)) {
    let payload = null;
    try { payload = JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { continue; }
    const role = String(payload.role || payload.scope || '').toLowerCase();
    if (/service_role|admin|superuser/.test(role)) hits.push({ id: 'jwt-privileged', label: `Privileged token (role: ${role})`, severity: 'Critical', note: 'A service-role token bypasses row-level security: full read/write to the database for anyone.', value: redact(m[0]), key: crypto.createHash('sha256').update(m[0]).digest('hex').slice(0, 16), context: contextOf(text, m.index), index: m.index });
  }
  return hits;
}

const files = new Map(); // url → pages that load it
const inline = [];
for (const p of sitemap.pages.filter(p => p.status === 200)) {
  const page = p.finalUrl || p.url;
  let html = '';
  try { html = await (await fetch(page, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) })).text(); } catch { continue; }
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"' >]+)[^>]*>/gi)) {
    let u; try { u = new URL(m[1], page).href; } catch { continue; }
    if (!files.has(u)) files.set(u, []);
    files.get(u).push(page);
  }
  for (const m of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) if (m[1].trim()) inline.push({ page, text: m[1] });
}

const findings = [];
const notCovered = [];
const seen = new Set();
const add = (hit, where, pages) => {
  const key = `${hit.id}|${hit.key || hit.value}`; // full-value hash: two keys sharing first/last 4 chars stay separate
  if (seen.has(key)) return;
  seen.add(key);
  findings.push({ source: 'auto', ruleId: `secret-${hit.id}`, category: 'Security', severity: hit.severity, confidence: hit.severity === 'Info' ? 'verify' : 'confirmed',
    page: pages[0], viewport: 'desktop', title: `${hit.label} exposed in client-side code (${hit.value})`,
    steps: [`Open ${pages[0]}`, `View the source of ${where}`, hit.context ? `Search for "${hit.context}"` : `Search for the value starting "${hit.value.split('…')[0]}" and ending "${hit.value.split('…')[1] || ''}"`],
    expected: 'No secret credentials in code sent to the browser', actual: `${hit.label} found in ${where}. ${hit.note}`,
    remediation: hit.severity === 'Info' ? 'Restrict the key (HTTP referrer, allowed APIs) in the provider console.' : 'Rotate the credential now, then move the call behind a server endpoint so the secret never reaches the browser.',
    evidence: { details: `${where} — value redacted: ${hit.value}${pages.length > 1 ? ` · loaded by ${pages.length} pages` : ''}` } });
};

let scanned = 0;
for (const [url, pages] of [...files].slice(0, maxFiles)) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) }); // third-party CDN files are read too (GET, like any visitor)
    if (!res.ok) continue;
    const text = await res.text();
    scanned++;
    for (const h of scanText(text)) add(h, url, pages);
    // A public source map hands out the original source, comments and all.
    const sm = text.match(/\/\/# sourceMappingURL=([^\s]+)\s*$/m);
    if (sm && !sm[1].startsWith('data:')) {
      const mapUrl = new URL(sm[1], url).href;
      const r = await fetch(mapUrl, { method: 'HEAD', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (r?.ok) add({ id: 'source-map', label: 'Public source map', severity: 'Low', note: 'The original source code, including comments, is downloadable.', value: path.basename(new URL(mapUrl).pathname) }, mapUrl, pages);
    }
  } catch { notCovered.push({ page: url, reason: 'script could not be downloaded' }); }
}
for (const { page, text } of inline) for (const h of scanText(text)) add(h, `an inline <script> on ${page}`, [page]);
if (files.size > maxFiles) notCovered.push({ page: sitemap.startUrl, reason: `${files.size - maxFiles} script files over the --max-files ${maxFiles} cap were not scanned` });

const coverage = [{ category: 'Security', page: sitemap.startUrl, viewport: 'desktop', status: scanned + inline.length ? 'tested' : 'not-tested', ...(scanned + inline.length ? {} : { reason: 'no scripts found to scan' }) }];
writeJson(path.join(outDir, 'findings.secrets.json'), { findings, coverage, notCovered, scanned: { files: scanned, inline: inline.length } });
console.log(`[secrets] ${scanned} script files + ${inline.length} inline scripts · ${findings.length} findings`);
