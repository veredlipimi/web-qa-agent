# web-qa-agent

**A QA agent for Claude Code that tests a live website like a senior QA engineer — and is tested itself.**

Give it a URL. It asks its questions once, shows a test plan, then crawls, audits, explores and hands you a severity-ranked report and a runnable Playwright suite. It only reports. It never fixes the site under test.

[עברית ↓](#עברית)

## What makes it different

- **Not tested ≠ passed.** Every check ends as *tested*, *not tested* or *blocked*, with a reason (login wall, timeout, missing test data, submit not allowed). The report shows a coverage table, and the verdict says "in the tested scope" unless coverage is 100%. A clean report is never mistaken for full coverage.
- **Field integrity matrix.** Every form field is checked for type, length and format, then filled with edge values: whitespace-only, Hebrew and mixed-direction names, Israeli phone formats, malformed emails, maxlength+1. It records whether the UI rejects what it should and accepts what it should. Nothing is ever submitted: non-GET requests are blocked and native submission is prevented.
- **RTL / Hebrew first.** `dir`, alignment and input direction are checked automatically, with a full manual checklist for mirroring, bidi text, formats and microcopy.
- **API / network.** 5xx and 4xx responses, failed, slow and duplicate calls, plus fault injection in exploratory runs (500, slow network, offline, expired session).
- **Evals for the agent itself.** A Hebrew demo storefront with planted gaps, redirect rules, gate/waiver and delta scenarios, and 14 false-positive controls, including ones taken from a real site. `node evals/regression-check.mjs` must stay green after every change.
- **Plan gate.** One approval, then it runs to the end without stopping.
- **Rules are enforced, not requested.** While the skill runs, a hook blocks edits outside `qa-runs/` (it reports, never fixes), state-changing HTTP calls to real hosts, attack and load tools, and `test.only`/`test.skip`. Rules without enforcement are wishes.
- **Release gate + delta.** The report blocks on Critical/High by default, takes waivers that need a reason and an expiry (expired ones stop applying), has a strict mode, and exits 1 for CI with `--gate`. From the second run it shows **regressions**, **new** and **fixed** gaps.
- **Migration QA.** `redirect-check.mjs` verifies a redirect map (old → new) on the live origin: PASS · WRONG-TARGET · WRONG-STATUS · CHAIN · MISSING · ERROR. Linked PDFs and other files are probed too.
- **SSO-friendly login.** `save-auth.mjs` opens a browser, you log in by hand (SSO/MFA work), and the session is reused. No passwords in chat.
- **Regression-ready suite.** Every identified gap gets a `test.fail()` test with its ID, so the run stays green while the gap exists and flags it once it is fixed.

It also covers accessibility (axe-core, WCAG 2.1 AA), performance (LCP, CLS, TTFB, weight), responsive layout, soft 404s, SEO basics and passive security: headers, cookie flags, mixed content, exposed files, and one inert reflection marker.

## Install

```bash
git clone https://github.com/veredlipimi/web-qa-agent ~/.claude/skills/web-qa-agent
node ~/.claude/skills/web-qa-agent/scripts/setup.mjs
```

Requires Node 18+ and Claude Code. Python is not needed.

On a Mac? Step-by-step guide (Hebrew): [docs/INSTALL-mac.he.md](docs/INSTALL-mac.he.md)

## Use

In Claude Code:

```
QA https://staging.example.com
```

You choose a depth (Quick / Standard / Deep), the environment (production read-only, or staging) and login. It then delivers a `qa-runs/<site>-<date>/` folder:

| File | Contents |
|---|---|
| `test-plan.md`, `app-profile.json` | What it understood and what it planned |
| `report.html` | Verdict, coverage, gaps filterable by severity and category, screenshots |
| `report.md`, `findings.csv`, `findings.json` | The same results for sharing and Jira |
| `field-matrix.json` | Every field × edge case: pass / gap / not tested |
| `suite/` | Playwright + TypeScript: page objects, smoke, journeys, `test.fail()` regressions, opt-in visual |

## Rules it follows

1. It reports and never fixes.
2. It asks once, up front.
3. It only reports what a real user would see on a fully loaded page.
4. Not tested ≠ passed.
5. Every finding comes with evidence.
6. Security checks are passive.
7. On production it makes no submits.
8. Credentials never appear in its output.

## Test the agent

```bash
node evals/regression-check.mjs     # 59 deterministic checks, ~2 min
```

See [`evals/README.md`](evals/README.md) for the LLM-graded behaviour cases.

## Credits

Checklists and auth patterns adapted from my own guides (*Playwright for QA*, *Claude AI for QA Engineers*). The release gate, waiver expiry, run-to-run delta and redirect-map check come from my own site-scanner / redirect-QA tool, built for large-scale site migrations. Inspired by [Aswinellath/web_app_testing](https://github.com/Aswinellath/web_app_testing). This is an independent implementation, extended with coverage honesty, the field matrix, RTL, API/network checks and Hebrew reports. Shaped by feedback from QA practitioners on LinkedIn.

MIT © Vered Li

---

## עברית

**סוכן QA ל-Claude Code שבודק אתר חי כמו בודקת בכירה, ושגם הוא עצמו נבדק.**

נותנים לו כתובת. הוא שואל את כל השאלות פעם אחת, מציג Test Plan, ואחרי אישור אחד סורק, בודק וחוקר. בסוף הוא מגיש דוח מדורג לפי חומרה וסוויטת Playwright מוכנה להרצה. הוא רק מדווח, אף פעם לא מתקן.

**מה מייחד אותו:**
- **"לא נבדק" אינו "עבר".** לכל בדיקה יש סטטוס: נבדק, לא נבדק או חסום, עם סיבה. בדוח יש טבלת כיסוי, והשורה התחתונה נכתבת "בטווח שנבדק".
- **מטריצת שדות:** גודל, אורך ופורמט של כל שדה, עם ערכי קצה בעברית ובפורמטים ישראליים, בלי לשלוח אף טופס.
- **RTL ועברית:** בדיקות אוטומטיות של dir, יישור וכיוון שדות קלט, וצ׳קליסט ידני מלא.
- **API ורשת:** קריאות שנכשלות, איטיות או כפולות, והזרקת תקלות.
- **Evals לסוכן עצמו:** חנות דמו בעברית עם 20 פערים מתוכננים ו-13 בדיקות נגד false positives.
- **אכיפה, לא בקשה:** hook שחוסם עריכה מחוץ ל-qa-runs, בקשות POST לאתרים אמיתיים, כלי תקיפה ועומס, ו-test.skip.
- **שער שחרור ודלתא:** פטורים עם סיבה ותאריך תפוגה, מצב קפדני, ומההרצה השנייה: רגרסיות, פערים חדשים ופערים שתוקנו.
- **QA להגירות אתרים:** בדיקת מפת הפניות (301) ובדיקת קבצים מקושרים (PDF וכו').
- **דוח בעברית**, ו-`test.fail()` לכל פער שזוהה.

**התקנה:**

```bash
git clone https://github.com/veredlipimi/web-qa-agent ~/.claude/skills/web-qa-agent
node ~/.claude/skills/web-qa-agent/scripts/setup.mjs
```

**שימוש:** ב-Claude Code כותבים `QA https://האתר-שלך`.

**ב-Mac?** מדריך צעד אחר צעד, כולל בדיקה של אתר מקומי: [docs/INSTALL-mac.he.md](docs/INSTALL-mac.he.md)
