// API inventory: every XHR/fetch endpoint the audit observed, grouped by method + normalized path.
// A starting point for API test scenarios — what the UI really calls, with status codes and timings.
// Observation only: nothing here sends a request of its own.

const ID = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[A-Za-z0-9_-]{24,})$/i;

/** GET https://api.x.com/v1/orders/123?page=2 → { method, host, path: "/v1/orders/:id", query: ["page"] } */
export function endpointKey(method, url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const path = u.pathname.split('/').map(seg => (ID.test(seg) ? ':id' : seg)).join('/') || '/';
  return { method: String(method || 'GET').toUpperCase(), host: u.host, path, query: [...new Set([...u.searchParams.keys()])].sort() };
}

export function createInventory() { return new Map(); }

/** r = { url, method, status, ms, failure }, page = the page URL it was seen on */
export function addRequest(inv, r, page) {
  const k = endpointKey(r.method, r.url);
  if (!k) return;
  const key = `${k.method} ${k.host}${k.path}`;
  if (!inv.has(key)) inv.set(key, { ...k, calls: 0, statuses: {}, failures: 0, maxMs: 0, totalMs: 0, pages: new Set(), queryKeys: new Set(), example: r.url.slice(0, 200) });
  const e = inv.get(key);
  e.calls++;
  if (r.failure) e.failures++;
  else if (r.status != null) e.statuses[r.status] = (e.statuses[r.status] || 0) + 1;
  e.maxMs = Math.max(e.maxMs, r.ms || 0);
  e.totalMs += r.ms || 0;
  e.pages.add(page);
  k.query.forEach(q => e.queryKeys.add(q));
}

/** Plain rows for JSON: problems first (5xx, 4xx, failures), then by call count. */
export function inventoryRows(inv) {
  const rows = [...inv.values()].map(e => ({
    method: e.method, host: e.host, path: e.path, query: [...e.queryKeys].sort(), calls: e.calls,
    statuses: e.statuses, failures: e.failures, maxMs: e.maxMs, avgMs: e.calls ? Math.round(e.totalMs / e.calls) : 0,
    pages: [...e.pages].slice(0, 10), pageCount: e.pages.size, example: e.example,
  }));
  const worst = r => (Object.keys(r.statuses).some(s => s >= 500) || r.failures ? 2 : Object.keys(r.statuses).some(s => s >= 400) ? 1 : 0);
  return rows.sort((a, b) => worst(b) - worst(a) || b.calls - a.calls || a.path.localeCompare(b.path));
}

export function apiCsv(rows) {
  const cols = ['Method', 'Host', 'Path', 'Query keys', 'Calls', 'Statuses', 'Failures', 'Avg ms', 'Max ms', 'Pages', 'Example'];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map(r => [r.method, r.host, r.path, r.query.join(' '), r.calls,
    Object.entries(r.statuses).map(([s, n]) => `${s}×${n}`).join(' '), r.failures, r.avgMs, r.maxMs, r.pageCount, r.example]);
  return '﻿' + [cols.join(','), ...lines.map(l => l.map(cell).join(','))].join('\n') + '\n';
}
