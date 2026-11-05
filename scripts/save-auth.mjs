#!/usr/bin/env node
// Opens a real (headed) browser on the login page. The user logs in by hand — works for
// SSO, MFA and Google login. When they press Enter in the terminal, the session is saved
// as a Playwright storage state for --storage-state. Credentials never touch the agent.
// Usage: node save-auth.mjs --url https://app.example.com/login [--out qa-runs/auth/state.json]
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseArgs, need, ensureDir } from './lib.mjs';

const args = parseArgs();
const url = need(args, 'url');
const out = args.out || path.join('qa-runs', 'auth', 'state.json');
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: false, executablePath: process.env.QA_CHROME_PATH || undefined });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(url);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question('Log in in the browser window, then press Enter here to save the session… ');
rl.close();
ensureDir(path.dirname(out));
await ctx.storageState({ path: out });
await browser.close();
console.log(`[auth] saved ${out} — keep it out of git (qa-runs/ and auth/ are ignored). Use: --storage-state ${out}`);
