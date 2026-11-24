# Evals — testing the QA agent itself

A QA agent that is not itself tested is just a demo. Two layers:

## 1. Deterministic regression (scripts) — run after every change

```bash
node evals/regression-check.mjs          # ~2 min, exit code 0 = all pass
node evals/regression-check.mjs --keep   # keep the run folder to inspect the report
```

Starts `demo-app/` — *Studio Bareket*, a small Hebrew/RTL storefront with planted gaps —
runs preflight → crawl → audit → field-matrix → report, and checks `expectations.json`:

| Group | What it proves |
|---|---|
| `find` (E01–E16, F01–F04) | Every planted gap is identified: API 500, duplicate calls, reflected search, soft 404, missing `dir=rtl`, left-aligned Hebrew, mobile overflow, placeholder-only field, whitespace-only and Hebrew-name validation, `type=text` phone, `+972` rejected, exposed `.env`, cookie flags, headers |
| `notFind` (N01–N09) | **False-positive guards.** Control pages that are correct (`/policy`, `/search-safe`, the labelled email field, valid `qa+probe@` email) must stay clean |
| `E17–E18`, `N15–N17` | Action probes: double submit and false success on `/newsletter`; the guarded `/newsletter-safe` control must stay clean |
| `E21`, `N21` | Native (server-rendered) forms: an unguarded `/contact` form that fires twice on a double click is flagged as `verify` (Likely); `/signup-native-safe`, which disables its button on submit, stays clean. Failure handling on native forms stays *not tested* (needs staging) |
| `coverage` (C01–C05) | Checks are marked *tested* where they ran |
| `R01–R09` | Verdict, coverage %, deliverables, evidence on every gap, no `node_modules`; a Chromium-only run lists Firefox/Safari as not covered; the API inventory groups repeated calls and lists failing endpoints first |
| `D-*` | Redirect map: PASS, WRONG-STATUS, WRONG-TARGET, MISSING, CHAIN each classified correctly |
| `D-CG*` | Same map through the CutoverGate engine gives the same classification (runs when CutoverGate is found as a sibling folder or in `$CUTOVERGATE`) |
| `G01–G05` | Gate: valid waiver applied, expired waiver ignored, waiver without reason rejected, FAIL with Critical, `--gate` exit code |
| `H01–H03` | Delta across three runs: fixed, new, regression |
| `E19–E20`, `N18–N20` | Secrets in `/assets/app.js` (built at runtime): Stripe secret and service_role JWT found; publishable key and anon JWT ignored; values redacted |
| `V01–V02` | Visual sheets are produced for each page (mobile + desktop); a `visual-review` finding is always forced to `verify` |
| `V03–V05` | Independent verification: the packet holds only Critical/High gaps with evidence; not-reproduced → dismissed; insufficient-evidence → `verify`; confirmed → noted |
| `K01` | Enforcement guard unit tests (`guard-check.mjs`, 55 checks: destructive local commands (rm -r outside qa-runs/temp, `..` escapes, push --force, reset --hard, clean -f); local secrets via Read/Grep/Glob/Write and shell reads (.env, keys, ~/.ssh, ~/.aws, saved sessions; .env.example allowed); Notification hook exits 0; shell incl. curl --json/-T, httpie, inline Python/Node writes; normalised paths; MCP browser and fetch tools; unguarded scripts incl. Python/puppeteer and comment-only guardedContext; fail-closed on malformed input) |
| `K03` | Finish gate (`finish-check.mjs`, 23 checks): the Stop hook never blocks Phase 0–2; blocks when the report is missing or stale, a gap has no evidence, a not-tested check has no reason, a FAIL case has no gap, or a Critical/High gap skipped Phase 5b without a reason; stops blocking after 3 rounds and records the run as incomplete |
| `K02` | Bounded explorer (`explore-check.mjs`, 16 checks): untrusted-content label, prompt-injection warning, action allowlist, ambiguous names rejected, off-origin navigation blocked, production POST blocked, step budget, history + trace, guardedContext(), kill switch, plus a safety lab that counts what actually reached the server: destructive names refused, destructive GETs and WebSocket handshakes = 0, control-server token, WebSocket-based submit in action-probes = 0 |
| `T00` | Requirements traceability (`requirements-check.mjs`, 22 cases, no browser): roll-up rules, the honesty warnings (FAIL without a gap, NOT_TESTED without a reason, unknown requirement, uncovered requirement, a literal password in test data), the Sheets CSV, and the report sections |

When you add a check: plant a gap in `demo-app/server.mjs`, add a `find` line, **and**
a correct control with a `notFind` line. A check without a control will drift into noise.

## 2. Agent behaviour (LLM-graded) — run before publishing a new version

`cases/*/prompt.md` is what you type into Claude Code against the running demo app;
`cases/*/graders.md` is the checklist a reviewer (you, or a separate Claude session that
did not run the QA) scores pass/fail from the transcript and run folder.

```bash
node evals/demo-app/server.mjs --port 4321   # in one terminal
# then in Claude Code: paste cases/<case>/prompt.md
```

| Case | Focus |
|---|---|
| `full-qa-staging` | End-to-end: questions once, plan gate, exploratory finds the cart bug, suite with `test.fail()`, report |
| `production-read-only` | Nothing state-changing is sent; findings still appear; limits stated |
| `coverage-honesty` | Login-walled and capped areas are reported as not tested, never as passes |
