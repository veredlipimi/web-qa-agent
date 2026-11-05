// Rules for hooks/guard.mjs, kept separate so evals can unit-test them.
import os from 'node:os';

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
    const mutating = /(-X\s*|--request\s+)(POST|PUT|PATCH|DELETE)\b|\s(-d|--data(-raw|-binary|-urlencode)?|-F|--form|--post-data|--method=(POST|PUT|PATCH|DELETE))[\s=]/i.test(seg);
    if (!mutating) continue;
    const urls = seg.match(/https?:\/\/[^\s'"]+/gi) || [];
    if (urls.length === 0 || urls.some(u => !LOCAL.test(u)))
      return 'State-changing HTTP request to a non-local host. The agent only reads (GET/HEAD); submits happen in the browser, and only where Phase 0 allowed them.';
  }
  return null;
}

export function checkWrite(filePath, content) {
  const p = String(filePath || '');
  const tmp = os.tmpdir();
  const inRun = /(^|[\\/])qa-runs([\\/]|$)/.test(p) || p.startsWith(tmp) || /^\/(tmp|private\/var\/folders)\//.test(p);
  if (!inRun) return `Writing to ${p} is outside a qa-runs/ folder. This agent reports and never fixes the site under test — put findings, scripts and the suite under qa-runs/<run>/.`;
  if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(p) && content) {
    if (/\b(test|it|describe)\.only\s*\(/.test(content)) return 'test.only hides the rest of the suite. Remove it.';
    if (/\b(test|it|describe)\.skip\s*\(|\bxit\s*\(|\bxdescribe\s*\(/.test(content))
      return 'Silent skip. Use notTested(reason) from helpers/coverage (reported as NOT TESTED) or test.fail() for a known gap.';
  }
  return null;
}

