<!-- Loaded on demand from SKILL.md. Rules 1–11 in SKILL.md always apply. -->
### Phase 4 — Field matrix, exploratory & edge cases

First the automated field-integrity matrix (Standard/Deep). It never submits: every
non-GET request is blocked and native submission is prevented.

```bash
node <skill>/scripts/field-matrix.mjs --sitemap <run>/sitemap.json --out <run>
node <skill>/scripts/action-probes.mjs --sitemap <run>/sitemap.json --out <run>
```

**Secrets in client code** (`secret-scan.mjs`). This reads the JavaScript that every visitor
downloads (script files and inline scripts) and looks for live credentials:
- Stripe secret keys, AWS keys, private keys;
- OpenAI, Anthropic and GitHub tokens, Slack, SendGrid and Twilio keys;
- service-role JWTs, such as a Supabase `service_role` token.

Keys that are public by design are left alone: Stripe `pk_`, anon JWTs, and Google keys
(reported as Info, to verify restrictions). A public source map is reported as Low. Values are
redacted to the first and last 4 characters, and never appear in full (rule 8). This matters
most for apps built with AI app builders, where a secret key in the frontend is a common gap.

```bash
node <skill>/scripts/secret-scan.mjs --sitemap <run>/sitemap.json --out <run>
```

**Visual review** (`visual-sheets.mjs`). This produces one image per page, with the desktop
and mobile views side by side:

```bash
node <skill>/scripts/visual-sheets.mjs --sitemap <run>/sitemap.json --out <run> --max-pages 20
```

Read every sheet in `<run>/visual/`. Report only what a user would see as broken and that
the DOM checks can't catch: a wrong or broken image, text that is cut off or overlapping,
an empty area, content hidden behind a fixed header, or a mobile layout that falls apart.

Record each gap in `findings.manual.json` with `ruleId: "visual-review"` and the sheet as the
screenshot. This is your judgement of an image, so `report.mjs` forces `confidence:
"verify"`. Never mark a page as passing because it "looks fine". Instead, add a `coverage`
entry (category `Visual`, tested) for each sheet you reviewed.

The model can point at a problem, but whether something passes or fails rests on conditions that
can be checked separately. So a Critical or High visual gap is listed in the gate as **suspected**,
and it does not block the release until independent verification (Phase 5b) confirms it.

**Action probes** (`action-probes.mjs`) fill each form with valid data and answer every
request the submit triggers inside the browser. Nothing reaches the server, so this is safe on
production too. Each form gets four runs:
- a 200 baseline, which checks whether success is detectable at all;
- a double click, where two identical requests are a gap (High when the flow is order or payment);
- a 500 response;
- a network failure.

A success message after a 500 or a network failure is a **false success** (High). No feedback at
all is Medium, and is only reported when the baseline proved success is detectable. Forms that
post natively (server-rendered) are recorded as not tested, with that reason: their failure
handling needs staging.

Per field it checks type / inputmode / maxlength / autocomplete / real label, then fills
edge values (whitespace-only, Hebrew and mixed-direction names, bad and valid Israeli
phone formats, malformed and valid emails, maxlength+1) and records whether the UI rejects
what it should and accepts what it should. Output: `field-matrix.json` (every cell:
pass / gap / not-tested) and `findings.fields.json`. Dynamic gaps are
`confidence: "verify"` — server-side validation may still catch them; say so.

Then hands-on. Use `references/exploratory-heuristics.md` and `references/edge-case-data.md`.

**Interactive steps: `explore.mjs`.** You choose one action at a time, and the script
decides whether it is allowed:

```bash
node <skill>/scripts/explore.mjs start --url <page> --out <run> [--prod] --max-steps 40
node <skill>/scripts/explore.mjs act --out <run> '{"action":"click","role":"button","name":"Add to cart"}'
node <skill>/scripts/explore.mjs look --out <run>
node <skill>/scripts/explore.mjs finish --out <run> --reason "cart journey done"
```

- **Actions:** `click`, `fill`, `select`, `press`, `goto` (same-origin path), `back`, `reload`
  and `finish`. Targets are given by role plus the exact accessible name, and only a single
  match is accepted.
- **Rejections** (exit 3): the action is not allowed, the name is ambiguous, or the step
  budget is spent. Rejected actions count against the budget. If a name is ambiguous, refine
  it; never guess between look-alike elements.
- **Use `--prod` on production.** It blocks every non-GET request.
- **Evidence:** `<run>/explore/history.json` and `trace.zip`. Cite them in findings.

**Scripted checks** (fault injection, timing, assertions): write a short script in
`<run>/explore/` that opens its context with `guardedContext()`. Fault routes added after it
must `fulfill`/`abort` (or `fallback()`), never `continue()` a write. Assert the expected
result **in code**, and compute expected values yourself (totals, counts) rather than
copying them from the page. For each key journey and each form, cover at least:

- Happy path end to end (stop before final submit on production — rule 7).
- Validation: empty, too long, wrong format, whitespace-only, emoji, Hebrew/mixed
  direction text, leading/trailing spaces, pasted values, SQL/HTML-looking strings
  (as *display* tests only: does the UI render them safely as text?).
- State: back/forward, refresh mid-flow, double-click submit, slow network
  (`page.route` with delay), offline (`context.setOffline(true)`), expired session.
- Empty, loading and error states; what happens on a 500 (`page.route` → 500).
- Keyboard-only path through the journey (Tab order, visible focus, Esc closes dialogs).

Record each gap in `<run>/findings.manual.json` using the schema in
`references/finding-schema.md`, with a screenshot, user impact in `actual`, and a
`remediation` line written as advice for the dev team (never applied by you). If a manual
finding is the same root cause as an auto one, add `"supersedes": "<ruleId or title>"`.
Use `getByLabel` to find form fields: if a field can only be reached by placeholder or
CSS, that is itself an accessibility gap.

Add a `coverage` entry per journey to `findings.manual.json` (category `Exploratory`,
status tested / not-tested / blocked with reason), so hands-on work shows in the coverage
table too.

**Test cases from requirements.** Run every case in `test-cases.json` and set its status:
PASS · FAIL · PARTIAL · NOT_IMPLEMENTED (the behaviour is not reachable in the UI at all) ·
NOT_VERIFIABLE · NOT_TESTED. FAIL, PARTIAL and NOT_IMPLEMENTED must list the gap IDs that
show it (`"gaps": ["EXP-003"]`) — no linked gap, no evidence. NOT_VERIFIABLE and
NOT_TESTED need the reason in `notes`. Give each related finding `"requirement": "AC-2"`.
When the observation is certain but its cause or reach is not, say so in the finding's
`impact` with **Likely** / **Possible** — never as fact.

**Reconcile contradictions.** If the field matrix says a case passed and your hands-on run
says it failed (or the reverse), do not report both: vary one thing at a time (value
length, character class, submit vs blur) until you know the cause, then report the cause
once and note which tool was wrong. A tool that was wrong is itself worth a line in
"Assumptions".

If `references/rtl-checklist.md` applies (RTL detected or requested), walk it on at least
the home page and every key journey page at mobile and desktop.
