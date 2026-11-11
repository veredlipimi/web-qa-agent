<!-- Loaded on demand from SKILL.md. Rules 1–11 in SKILL.md always apply. -->
### Phase 5 — Generate the automation suite

```bash
node <skill>/scripts/scaffold-suite.mjs --run <run>
```

Copies `templates/playwright-suite/` into `<run>/suite/` and fills `tests/pages.json`
from the crawl. Write one page object per key page in `pages/` (extend `BasePage`), and
one spec per journey (start from `tests/journey.example.spec.ts`, delete the example
before delivering). Rules:

- TypeScript, `@playwright/test`, page objects, role/label/test-id locators (no brittle
  CSS/XPath).
- Visual regression is opt-in (`--project=visual`, Deep only). A first run only creates a
  baseline — say so; it detects nothing yet.
- Web-first assertions (`expect(locator).toBeVisible()`), no fixed sleeps.
- Credentials from `process.env`, base URL from `BASE_URL`.
- Each confirmed gap gets a regression test marked `test.fail()` with the finding ID in
  the title, so it turns green when fixed.
- Browsers: the audit runs on Chromium only. On Deep, also run the suite on
  `QA_BROWSERS=firefox,webkit,mobile-safari` (`npx playwright install firefox webkit` first);
  if those browsers can't be installed, say so. The report lists every browser that did
  not run under "Not covered" — never imply Safari works because Chrome did.
- Run it once: `cd <run>/suite && npm install && BASE_URL=<origin> npx playwright test`,
  then `node <skill>/scripts/suite-summary.mjs --run <run>` (feeds the counts into the
  report). A smoke failure that matches a known gap is expected — mark it `test.fail()`
  with the gap ID. Any other failure is a suite issue: fix the test, not the site.
