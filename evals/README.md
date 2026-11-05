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
| `coverage` (C01–C03) | Checks are marked *tested* where they ran |
| `R01–R06` | Verdict, coverage %, deliverables, evidence on every gap, no `node_modules` |
| `D-*` | Redirect map: PASS, WRONG-STATUS, WRONG-TARGET, MISSING, CHAIN each classified correctly |
| `D-CG*` | Same map through the CutoverGate engine gives the same classification (runs when CutoverGate is found as a sibling folder or in `$CUTOVERGATE`) |
| `G01–G05` | Gate: valid waiver applied, expired waiver ignored, waiver without reason rejected, FAIL with Critical, `--gate` exit code |
| `H01–H03` | Delta across three runs: fixed, new, regression |
| `K01` | Enforcement guard unit tests (`guard-check.mjs`, 12 cases) |

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
