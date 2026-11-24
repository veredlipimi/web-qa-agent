#!/usr/bin/env node
// Notification hook: a macOS notification when Claude Code is waiting for you (a permission prompt,
// or the Phase 0 / Phase 2 questions). Silent on other systems. Never blocks and never fails the session.
import { spawn } from 'node:child_process';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
let input = {};
try { input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch {}

if (process.platform === 'darwin' && !process.env.QA_NO_NOTIFY) {
  // AppleScript string literal: escape backslashes and quotes, keep it short.
  const esc = s => String(s).replace(/[\\"]/g, m => '\\' + m).replace(/\s+/g, ' ').slice(0, 180);
  const msg = esc(input.message || 'Claude is waiting for you');
  const child = spawn('osascript', ['-e', `display notification "${msg}" with title "web-qa-agent" sound name "Glass"`], { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}
process.exit(0);
