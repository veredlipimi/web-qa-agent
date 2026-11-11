// Rules for hooks/guard.mjs, kept separate so evals can unit-test them.
// A guardrail against the agent's own mistakes, not a security boundary: it sees only the tool calls
// Claude Code makes, and a determined author can always find a way around pattern matching.
import os from 'node:os';
import path from 'node:path';

const LOCAL = /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i;

export function checkBash(cmd) {
  const c = ` ${cmd} `;
  if (/\b(sqlmap|nikto|hydra|medusa|wpscan|nmap|masscan|ffuf|gobuster|dirb|dirbuster|feroxbuster|nuclei|zap-cli|burpsuite|commix|xsstrike)\b/i.test(c))
    return 'Active security / attack tools are out of scope. Security checks are passive only.';
  if (/\b(ab\s+-n|wrk\s|siege\s|k6\s+run|artillery\s+run|locust\b|hey\s+-n|vegeta\s+attack)/i.test(c))
    return 'Load testing is out of scope for this agent.';
  // State-changing HTTP from the shell to non-local hosts
  const http = c.match(/\b(curl|wget|http|https|xh)\b[^|;&]*/gi) || [];
  for (const seg of http) {
    const mutating = /(-X\s*|--request\s+|--method[=\s])['"]?(POST|PUT|PATCH|DELETE)\b|\s(-d|--data(-raw|-binary|-urlencode|-ascii)?|-F|--form(-string)?|--json|-T|--upload-file|--post-data|--post-file|--body-data|--body-file)[\s=]|\b(http|https|xh)\s+(POST|PUT|PATCH|DELETE)\b/i.test(seg);
    if (!mutating) continue;
    const urls = seg.match(/https?:\/\/[^\s'"]+/gi) || [];
    if (urls.length === 0 || urls.some(u => !LOCAL.test(u)))
      return 'State-changing HTTP request to a non-local host. The agent only reads (GET/HEAD); submits happen in the browser, and only where Phase 0 allowed them.';
  }
  // Inline code that writes over HTTP to a non-local host (python requests/httpx/urllib, node fetch/axios).
  const inline = /\b(python3?|node|deno|bun|ruby|perl)\b[^|;&]*\s-(c|e|-eval)\b|<<\s*['"]?\w+/i.test(c);
  const writes = /\b(requests|httpx|session)\.(post|put|patch|delete)\s*\(|urlopen\s*\([^)]*data\s*=|method\s*[:=]\s*['"](POST|PUT|PATCH|DELETE)['"]|axios\.(post|put|patch|delete)\s*\(/i.test(c);
  if (inline && writes) {
    const urls = c.match(/https?:\/\/[^\s'"`)]+/gi) || [];
    if (urls.length === 0 || urls.some(u => !LOCAL.test(u)))
      return 'Inline code that sends a state-changing HTTP request to a non-local host. The agent only reads; submits happen in the browser, only where Phase 0 allowed them.';
  }
  // Browser automation outside the agent's guarded scripts
  if (inline && /\b(chromium|firefox|webkit)\.launch|puppeteer\.launch|sync_playwright|async_playwright/i.test(c) && !/guardedContext\s*\(/.test(stripComments(c)))
    return 'Inline browser automation bypasses the guardrails. Use scripts/explore.mjs, or a script under qa-runs/ that opens its context with guardedContext().';
  return null;
}

const stripComments = t => String(t).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/^\s*#.*$/gm, '');

// Browser tools outside the agent's scripts bypass the origin lock and the production write block.
export function checkTool(name, input = {}) {
  if (/^mcp__.*(playwright|puppeteer|browser|chrome|computer)/i.test(name || ''))
    return `${name} bypasses the agent's browser guardrails. Explore with scripts/explore.mjs (bounded actions, origin lock, step budget, trace), or write a script under qa-runs/ that uses guardedContext() from scripts/lib.mjs.`;
  // Generic HTTP/fetch tools: reading is fine, writing is not.
  if (/^mcp__.*(fetch|http|request|curl|api)/i.test(name || '')) {
    const m = String(input.method || input.http_method || input.verb || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(m)) return `${name} with method ${m}: the agent only reads. Submits happen in the browser, only where Phase 0 allowed them.`;
  }
  return null;
}

export function checkWrite(filePath, content) {
  // Normalise first: "qa-runs/../Projects/app.js" must not count as inside qa-runs.
  const p = path.resolve(String(filePath || ''));
  const tmp = path.resolve(os.tmpdir());
  const inRun = /(^|[\\/])qa-runs([\\/]|$)/.test(p) || p.startsWith(tmp + path.sep) || /^\/(tmp|private\/var\/folders)\//.test(p);
  if (!inRun) return `Writing to ${p} is outside a qa-runs/ folder. This agent reports and never fixes the site under test — put findings, scripts and the suite under qa-runs/<run>/.`;
  const code = content ? stripComments(content) : '';
  if (/\.([cm]?[jt]s|py)$/.test(p) && !/\.(spec|test)\.[cm]?[jt]sx?$/.test(p) && !/playwright\.config/.test(p) && content
      && /\b(chromium|firefox|webkit)\.launch|\.newContext\s*\(|new_context\s*\(|launchPersistentContext|puppeteer\.launch|sync_playwright|async_playwright/.test(code) && !/guardedContext\s*\(/.test(code))
    return 'Exploration scripts must open the browser with guardedContext(browser, { origin, prod }) from scripts/lib.mjs (origin lock + no writes on production). Add fault-injection routes after it.';
  if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(p) && content) {
    if (/\b(test|it|describe)\.only\s*\(/.test(content)) return 'test.only hides the rest of the suite. Remove it.';
    if (/\b(test|it|describe)\.skip\s*\(|\bxit\s*\(|\bxdescribe\s*\(/.test(content))
      return 'Silent skip. Use notTested(reason) from helpers/coverage (reported as NOT TESTED) or test.fail() for a known gap.';
  }
  return null;
}

