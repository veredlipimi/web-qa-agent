<!-- Loaded on demand from SKILL.md. Rules 1–11 in SKILL.md always apply. -->
### Phase 3 — Automated audit

```bash
node <skill>/scripts/audit.mjs --sitemap <run>/sitemap.json --out <run> [--viewports mobile,tablet,desktop]
```

Per page × viewport it collects: console errors and uncaught exceptions; failed, 4xx/5xx,
slow (>2s) and duplicate API requests; axe-core WCAG 2.1 A/AA violations; LCP, CLS, TTFB,
page weight; horizontal overflow, overlapping/clipped elements, tiny tap targets; broken
images and links; soft 404s (unknown URL → 200, or "not found" pages linked from the
site); SEO basics; passive security headers, cookie flags, mixed content, exposed files,
and one inert reflection marker in GET search/query params; RTL issues. Pages are judged
settled: load + network idle + fonts ready + scrolled through for lazy content. Output:
`<run>/findings.auto.json` + `<run>/screenshots/`. It also keeps an **API inventory**: every
XHR/fetch endpoint the pages called (method, normalized path, query keys, statuses,
timings, pages) — observed only, never called by you. Use it to spot API risks for the
plan and as the base for API test scenarios; the report lists it and writes
`api-endpoints.csv`. Use `--viewports mobile,desktop` for
Quick; `--skip-reflection` if the user asked for no security checks at all.

Then **triage** in `<run>/triage.json` (format in `references/severity.md`): open the
screenshots for every High/Critical one, re-check every visual/layout finding after a
fresh reload (drop it if it does not reproduce), reproduce anything marked
`confidence: "verify"` by hand and either confirm it (set severity) or dismiss it with a
reason, and raise severity for gaps on key journeys.

**Migration?** If the user gave a redirect map, verify it against the live origin:

```bash
node <skill>/scripts/redirect-check.mjs --map <map.csv> --origin <origin> --out <run>
```

Every old URL is classified PASS · WRONG-TARGET · WRONG-STATUS (302 where 301 was
expected) · CHAIN · MISSING · ERROR (plus LOOP and TARGET-BROKEN with CutoverGate).
ERRORs are not-tested, never passes.

If [CutoverGate](https://github.com/veredlipimi/cutovergate) is installed (`$CUTOVERGATE`,
`~/cutovergate`), the script uses it as the engine automatically. The classification is the
same, and the run also gets CutoverGate's exceptions (`--exceptions <file>`), its delta and
its own redirect report (path in `findings.redirects.json` → `reports.html`). Mention that
report in the final message. Excepted redirects are documented decisions: don't report
them as gaps.

If the user starts from CutoverGate (`cutovergate qa …`), the automated pass has already
run on the destination pages. Its run folder has `targets.txt` and `claude-prompt.md`.
Continue from Phase 4 in that folder, scoped to `targets.txt`, and don't re-crawl the whole site.
