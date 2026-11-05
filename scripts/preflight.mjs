#!/usr/bin/env node
// Reachability pre-flight. Run before anything else. Exit 0 = go, 1 = blocked (reason printed).
// Usage: node preflight.mjs --url https://example.com [--out run]
import path from 'node:path';
import { parseArgs, need, writeJson } from './lib.mjs';

const args = parseArgs();
const url = need(args, 'url');
const result = { url, checkedAt: new Date().toISOString(), ok: false, status: null, verdict: '', advice: '' };

const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 15000);
try {
  const r = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': 'web-qa-agent preflight' } });
  result.status = r.status;
  result.finalUrl = r.url;
  const body = (await r.text()).slice(0, 20000);
  const challenge = /cf-chl|challenge-platform|captcha|g-recaptcha|hcaptcha|Attention Required|Just a moment\.\.\./i.test(body);
  if (challenge) {
    result.verdict = 'bot-challenge';
    result.advice = 'The site serves a bot/CAPTCHA challenge. Do not try to evade it: ask for an allow-listed test environment or test account.';
  } else if (r.status === 401 || r.status === 403) {
    result.verdict = 'auth-required';
    result.advice = `HTTP ${r.status}. Ask the user for a test account (storage state) or a public URL.`;
  } else if (r.status >= 500) {
    result.verdict = 'server-error';
    result.advice = `Start page returns HTTP ${r.status}. Report it as a Critical gap; the rest of the run is not meaningful until it loads.`;
  } else {
    result.ok = true;
    result.verdict = r.status >= 400 ? 'start-page-error' : 'reachable';
    result.advice = r.status >= 400 ? `Start page returns ${r.status}; continue but report it.` : 'Go.';
  }
} catch (e) {
  const msg = String(e.cause?.code || e.cause?.message || e.message || e);
  result.error = msg;
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) { result.verdict = 'dns'; result.advice = 'Host not found — check the URL.'; }
  else if (/ECONNREFUSED/.test(msg)) { result.verdict = 'refused'; result.advice = 'Connection refused — is the local/staging server running on that port?'; }
  else if (/abort|timeout|ETIMEDOUT/i.test(msg)) { result.verdict = 'timeout'; result.advice = 'No response in 15s — site down or network blocked.'; }
  else if (/403|CONNECT|proxy|tunnel/i.test(msg)) { result.verdict = 'network-blocked'; result.advice = 'The network/proxy blocks this host. Do not work around it: ask the user to allow the domain or run on their own machine.'; }
  else if (/CERT|SSL|TLS/i.test(msg)) { result.verdict = 'tls'; result.ok = false; result.advice = 'TLS/certificate failure. Report as a Critical gap if this is production.'; }
  else { result.verdict = 'unreachable'; result.advice = msg; }
} finally { clearTimeout(timer); }

if (args.out) writeJson(path.join(args.out, 'preflight.json'), result);
console.log(`[preflight] ${result.ok ? 'OK' : 'BLOCKED'} — ${result.verdict}${result.status ? ` (HTTP ${result.status})` : ''}: ${result.advice}`);
process.exit(result.ok ? 0 : 1);
