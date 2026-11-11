<!-- Loaded on demand from SKILL.md. Rules 1–11 in SKILL.md always apply. -->
### Phase 6 — Report

```bash
node <skill>/scripts/report.mjs --run <run> --title "<site> QA report" [--lang he|en]
```

With `--lang he` the script renders automated findings in Hebrew itself — never write your
own translation or post-processing scripts. Write manual findings directly in the report
language. Merges auto + manual findings, applies `references/severity.md`, and writes
`report.html`, `report.md`, `findings.csv`, `findings.json`. Before handing over, read
`report.md` top to bottom and check: every finding has evidence; severities follow the
rubric; nothing is a duplicate; "Not covered" lists anything skipped.

**Release gate & delta.** The report evaluates a gate (default: blocks on Critical/High).
A team can put `qa-gate.json` next to the runs:

```json
{ "blockOn": ["Critical", "High"], "strict": false,
  "waivers": [{ "match": "QA-004", "reason": "Blog page ships next sprint (TICKET-12)", "expires": "2026-12-01" }] }
```

Waivers need a reason and should have an expiry; expired waivers stop applying
automatically, and waived gaps stay in the report with a badge. `strict: true` also
blocks on any not-tested / blocked check. Every run is saved to `qa-runs/history/`, and
from the second run on a host the report shows **regressions** (were fixed, failing
again), **new** gaps and **fixed** gaps. Use `--gate` to make the script exit 1 on FAIL
(for CI). Never add a waiver yourself — waivers are the team's decision; suggest one in
the final message if it fits.

Then package the deliverables (excludes `node_modules`, `test-results`, credentials):

```bash
node <skill>/scripts/package.mjs --run <run> --dest <where the user wants it>
```

When the run has requirements, the report adds the traceability matrix (requirement →
test cases → status → gaps), lists traceability warnings (a FAIL with no gap, a
requirement with no case, an unknown requirement ID), and writes `test-cases.csv` — one
row per case with numbered steps and bulleted Verify lines in single cells, ready to
import into Google Sheets. Fix every warning before handing over.

Final message to the user (short): overall verdict (ship / ship with known gaps / don't
ship), the gate result, the delta if there was a previous run, counts by severity, requirements passed (e.g. 9/12) when there were any, the top 3–5 gaps in one line each, the open questions, what was **not** covered,
where the files are, and the one-line command to re-run the suite. End with the result —
no closing offers or questions.
