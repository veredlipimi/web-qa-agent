#!/usr/bin/env node
// Compact digest of sitemap.json for the agent to read (instead of the raw, token-heavy JSON).
// Usage: node overview.mjs --sitemap run/sitemap.json
import { parseArgs, need, readJson } from './lib.mjs';

const s = readJson(need(parseArgs(), 'sitemap'), null);
if (!s) { console.error('Cannot read sitemap'); process.exit(2); }
const L = [];
L.push(`Start: ${s.startUrl} · pages crawled: ${s.pages.length} · over budget: ${s.notCrawled?.length || 0} · RTL detected: ${s.rtlDetected}`);
L.push('');
L.push('PAGES (status · path · title · lang/dir · forms · first headings)');
for (const p of s.pages) {
  let path = p.url; try { const u = new URL(p.url); path = u.pathname + u.search; } catch {}
  const forms = (p.forms || []).map(f => `${f.method.toUpperCase()}[${f.fields.map(x => `${x.name || x.label || x.type}${x.required ? '*' : ''}`).join(',')}]`).join(' ');
  L.push(`${p.status ?? 'ERR'} ${path} · "${(p.title || '').slice(0, 50)}" · ${p.lang || '-'}/${p.dir || '-'}${forms ? ` · ${forms}` : ''}${p.headings?.length ? ` · ${p.headings.slice(0, 2).join(' | ')}` : ''}${p.error ? ` · ERROR ${p.error}` : ''}`);
}
const btns = [...new Set(s.pages.flatMap(p => p.buttons || []))].slice(0, 30);
if (btns.length) { L.push('', `BUTTONS (unique): ${btns.join(' · ')}`); }
if (s.notCrawled?.length) { L.push('', `NOT CRAWLED (budget): ${s.notCrawled.slice(0, 15).join(' ')}`); }
console.log(L.join('\n'));
