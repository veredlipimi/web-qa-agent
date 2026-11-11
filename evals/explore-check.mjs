#!/usr/bin/env node
// Guardrail tests for scripts/explore.mjs (bounded exploratory browser) against the demo app.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const explore = path.join(here, '..', 'scripts', 'explore.mjs');
const port = 4396;
const base = `http://localhost:${port}`;
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-explore-'));
const server = spawn(process.execPath, [path.join(here, 'demo-app', 'server.mjs'), '--port', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));

const run = (...a) => new Promise(res => execFile(process.execPath, [explore, ...a], { encoding: 'utf8', timeout: 60000 }, (e, so) => {
  let j = null; try { j = JSON.parse(so); } catch {} res({ code: e ? e.code : 0, j, raw: so });
}));
const dbg = [];
const act = obj => run('act', '--out', out, JSON.stringify(obj));
const results = [];
const check = (id, what, ok) => results.push({ id, what, ok: !!ok });

try {
  const s = await run('start', '--url', base + '/guestbook', '--out', out, '--prod', '--max-steps', '8');
  check('X01', 'snapshot is wrapped and labelled as untrusted page content', s.j?.snapshot?.startsWith('<<untrusted page content'));
  check('X02', 'prompt-injection text on the page raises a warning', /instruction-like/.test(s.j?.warning || ''));
  const bad = await act({ action: 'evaluate', script: 'document.cookie' });
  check('X03', 'a disallowed action is rejected (exit 3)', bad.code === 3 && /not allowed/.test(bad.j?.rejected || ''));
  const amb = await act({ action: 'click', role: 'button', name: 'הוסף' });
  check('X04', 'two look-alike buttons → rejected as ambiguous', amb.code === 3 && /ambiguous/.test(amb.j?.rejected || ''));
  const off = await act({ action: 'click', role: 'link', name: 'אתר חיצוני' }); dbg.push(off.j);
  check('X05', 'off-origin main-frame navigation is blocked', (off.j?.blocked || []).some(b => b.kind === 'off-origin navigation') && (off.j?.url || '').startsWith(base));
  const nav = await act({ action: 'click', role: 'link', name: 'קראו עלינו' }); dbg.push(nav.j);
  check('X06', 'an exact, unique same-origin link click works', nav.j?.ok && /\/about$/.test(nav.j?.url || ''));
  await act({ action: 'goto', path: '/contact' });
  await act({ action: 'fill', role: 'textbox', name: 'שם מלא', value: 'QA Tester' });
  await act({ action: 'fill', role: 'textbox', name: 'אימייל', value: 'qa@example.com' });
  const sub = await act({ action: 'click', role: 'button', name: 'שלח' });
  check('X07', '--prod: the form POST is blocked, nothing is submitted', (sub.j?.blocked || []).some(b => b.kind === 'non-GET on production'));
  const over = await act({ action: 'reload' }); dbg.push(over.j);
  check('X08', 'step budget is enforced (rejected actions count too)', over.code === 3 && /budget/i.test(over.j?.rejected || ''));
  const fin = await run('finish', '--out', out, '--reason', 'eval');
  const hist = JSON.parse(fs.readFileSync(path.join(out, 'explore', 'history.json'), 'utf8'));
  check('X09', 'finish writes history.json and trace.zip', fin.j?.finished && fs.existsSync(path.join(out, 'explore', 'trace.zip')) && hist.history.length >= 8 && hist.rejected >= 2);
  // Kill switch: a second session, stopped by <run>/explore/STOP.
  const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-explore-kill-'));
  await run('start', '--url', base + '/about', '--out', out2, '--prod');
  fs.writeFileSync(path.join(out2, 'explore', 'STOP'), '');
  const k = await run('act', '--out', out2, JSON.stringify({ action: 'reload' }));
  await new Promise(r => setTimeout(r, 500));
  check('X11', 'kill switch: STOP file refuses the next action and closes the session (history + trace saved)',
    k.j?.stopped && /kill switch/.test(k.j?.rejected || '') && fs.existsSync(path.join(out2, 'explore', 'trace.zip')) && !fs.existsSync(path.join(out2, 'explore', 'session.json')));
  fs.rmSync(out2, { recursive: true, force: true });

  // ---- Safety lab: what actually reached the server (counts kept by the demo server)
  const stats = async () => (await fetch(base + '/lab-stats')).json();
  const out3 = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-explore-lab-'));
  await run('start', '--url', base + '/lab', '--out', out3);   // no flag: read-only is the default
  const s0 = await stats();
  const lo = await run('act', '--out', out3, JSON.stringify({ action: 'click', role: 'link', name: 'Logout' }));
  const rm = await run('act', '--out', out3, JSON.stringify({ action: 'click', role: 'link', name: 'Remove listing' }));
  await run('act', '--out', out3, JSON.stringify({ action: 'goto', path: '/api/delete?id=2' }));
  await run('act', '--out', out3, JSON.stringify({ action: 'goto', path: '/lab' }));
  await run('act', '--out', out3, JSON.stringify({ action: 'click', role: 'button', name: 'Open live chat' }));
  await new Promise(r => setTimeout(r, 800));
  const s1 = await stats();
  check('X12', 'read-only is the default: destructive link names refused (Logout, Remove…)', lo.code === 3 && /destructive/.test(lo.j?.rejected || '') && rm.code === 3);
  check('X13', 'destructive-looking GET URLs never reach the server (goto /api/delete)', s1.deleteGet === s0.deleteGet && s1.logout === s0.logout);
  check('X14', 'WebSocket handshakes never reach the server', s1.upgrades === s0.upgrades);
  const sess = JSON.parse(fs.readFileSync(path.join(out3, 'explore', 'session.json'), 'utf8'));
  const noTok = await fetch(`http://127.0.0.1:${sess.port}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"look"}' });
  const foreign = await fetch(`http://127.0.0.1:${sess.port}/`, { method: 'POST', headers: { 'content-type': 'text/plain', 'x-qa-token': sess.token, origin: 'https://evil.example' }, body: '{"action":"look"}' });
  check('X15', 'control server refuses requests without the session token or from a browser origin', noTok.status === 403 && foreign.status === 403);
  await run('finish', '--out', out3);
  fs.rmSync(out3, { recursive: true, force: true });

  // action-probes on a form that submits over a WebSocket: nothing may reach the server.
  const out4 = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-probes-lab-'));
  fs.writeFileSync(path.join(out4, 'urls.txt'), base + '/lab\n');
  const node = (script, a) => new Promise(res => execFile(process.execPath, [path.join(here, '..', 'scripts', script), ...a], { timeout: 180000 }, () => res()));
  await node('crawl.mjs', ['--url', base + '/lab', '--urls', path.join(out4, 'urls.txt'), '--no-follow', '--max-pages', '1', '--out', out4]);
  const p0 = await stats();
  await node('action-probes.mjs', ['--sitemap', path.join(out4, 'sitemap.json'), '--out', out4]);
  const p1 = await stats();
  const ap = JSON.parse(fs.readFileSync(path.join(out4, 'findings.actions.json'), 'utf8'));
  check('X16', 'action-probes: a WebSocket-based submit reaches the server 0 times (blocked and recorded)', p1.upgrades === p0.upgrades && p1.posts === p0.posts && ap.websocketsBlocked > 0);
  fs.rmSync(out4, { recursive: true, force: true });

  // guardedContext(): the helper ad-hoc exploration scripts must use.
  const { launchBrowser, guardedContext } = await import(path.join(here, '..', 'scripts', 'lib.mjs'));
  const b = await launchBrowser();
  const ctx = await guardedContext(b, { origin: base, prod: true });
  await ctx.route('**/api/stock', r => r.fulfill({ status: 500, body: 'x' })); // fault injection still works
  const p = await ctx.newPage();
  await p.goto(base + '/guestbook');
  await p.getByRole('link', { name: 'אתר חיצוני' }).click().catch(() => {});
  const posted = await p.evaluate(b => fetch(b + '/contact', { method: 'POST', body: 'x' }).then(() => 'sent', () => 'blocked'), base);
  const fault = await p.evaluate(b => fetch(b + '/api/stock').then(r => r.status), base);
  check('X10', 'guardedContext: off-origin blocked, POST blocked on prod, fault routes still apply',
    ctx.__blocked.some(x => x.kind === 'off-origin navigation') && posted === 'blocked' && fault === 500);
  await b.close();
} finally {
  await run('finish', '--out', out).catch(() => {});
  server.kill();
}
if (process.env.DEBUG) console.log(JSON.stringify(dbg, null, 1));
for (const r of results) console.log(`${r.ok ? '✓' : '✘'} ${r.id}  ${r.what}`);
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(failed || results.length < 16 ? 1 : 0);
