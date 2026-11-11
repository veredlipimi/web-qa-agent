#!/usr/bin/env node
// PreToolUse guard for the web-qa-agent skill — "rules without enforcement are wishes".
// A guardrail against mistakes, not a security boundary (see guard-rules.mjs).
// Active only while the skill is in use (declared in SKILL.md frontmatter).
// Reads the hook JSON from stdin; exit 2 + stderr = block (stderr is shown to Claude).
//
// Enforces:
//  1. Report only: no Edit/Write outside a qa-runs/ folder (or the OS temp dir).
//  2. Passive security: no state-changing HTTP calls (POST/PUT/PATCH/DELETE, --data) to
//     non-local hosts from the shell, and no attack / load-testing tools.
//  3. No silent failures: no test.only / test.skip / describe.skip in specs —
//     use notTested(reason) or test.fail() so coverage stays honest.
//  4. Bounded browser: no MCP browser tools; exploration scripts must use guardedContext().

import { checkBash, checkWrite, checkTool } from './guard-rules.mjs';


const chunks = [];
for await (const c of process.stdin) chunks.push(c);
let input = {};
// Fail closed: input we cannot read is blocked, not waved through.
try { input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { process.stderr.write('[web-qa-agent guard] Unreadable hook input — blocked (fail-closed).\n'); process.exit(2); }

const tool = input.tool_name || '';
const ti = input.tool_input || {};
const block = (msg) => { process.stderr.write(`[web-qa-agent guard] ${msg}\n`); process.exit(2); };

let reason = null;
if (tool === 'Bash') reason = checkBash(ti.command || '');
else if (tool === 'Write') reason = checkWrite(ti.file_path, ti.content);
else if (tool === 'Edit' || tool === 'MultiEdit') reason = checkWrite(ti.file_path, ti.new_string || (ti.edits || []).map(e => e.new_string).join('\n'));
else if (tool === 'NotebookEdit') reason = checkWrite(ti.notebook_path, ti.new_source);
else if (tool.startsWith('mcp__')) reason = checkTool(tool, ti);
if (reason) block(reason);
process.exit(0);
