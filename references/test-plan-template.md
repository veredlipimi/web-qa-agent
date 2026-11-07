# Test plan — {{site}}

**Date:** {{date}} · **Environment:** {{production | staging | local}} · **Tester:** QA agent

## 1. Objective
One or two sentences: what decision this run supports (e.g. "release readiness of the new
sign-up flow").

## 2. Scope
- **In scope:** {{URL / page budget / flows}}
- **Out of scope:** {{third-party domains, admin area, load testing, active security testing}}
- **Viewports:** mobile 390×844 · tablet 768×1024 · desktop 1440×900
- **Browser:** Chromium (latest via Playwright)

## 3. Key user journeys (ranked by business risk)
| # | Journey | Why it matters | Submit allowed? |
|---|---|---|---|
| 1 | {{e.g. Sign-up}} | {{revenue / first impression}} | {{yes/no}} |

## 4. Risk areas
Ranked list. For each: the risk, why you think so (from recon), and which checks cover it.

## 5. Check matrix
| Category | mobile | tablet | desktop | How |
|---|---|---|---|---|
| Functional (journeys) | ✓ | | ✓ | Exploratory scripts + suite |
| Edge cases & validation | ✓ | | ✓ | `edge-case-data.md` |
| API / Network | ✓ | ✓ | ✓ | audit.mjs + page.route faults |
| Accessibility (WCAG 2.1 AA) | ✓ | ✓ | ✓ | axe-core + keyboard pass |
| Performance (LCP, CLS, TTFB) | ✓ | ✓ | ✓ | audit.mjs |
| Responsive layout | ✓ | ✓ | ✓ | audit.mjs + screenshots |
| RTL / Hebrew | ✓ | | ✓ | audit.mjs + `rtl-checklist.md` |
| SEO basics | | | ✓ | audit.mjs |
| Passive security | | | ✓ | audit.mjs |

## 6. Test data
Where it comes from (generated / provided), how it is cleaned up, credentials via env vars.

## 7. Constraints & safety
- Production: no final submits, no account creation, no payments (unless approved above).
- Passive security only.

## 8. Entry / exit criteria
- **Entry:** site reachable, user approved this plan.
- **Exit:** every check in the matrix ran or is listed under "Not covered"; every
  High/Critical gap has a screenshot and was re-verified once.

## 9. Assumptions
Anything you decided without asking.

## 10. Requirements & test cases (only when requirements were given)

Source: {{ticket / story / design notes / existing plan}}. Test only what these say; open
questions go to `openQuestions`, not into invented cases.

`requirements.json`
```json
{ "source": "Story PROJ-12 + design notes v3",
  "items": [ { "id": "AC-1", "text": "User can switch between monthly and yearly", "source": "PROJ-12" } ] }
```

`test-cases.json` (statuses start as `NOT_TESTED`; Phase 4 fills them in)
```json
{ "cases": [ {
    "id": "TC-001", "requirement": "AC-1", "area": "Plan picker",
    "title": "Yearly cycle updates every price on the page",
    "preconditions": "Logged-out visitor, desktop",
    "steps": ["Open /plans", "Click Yearly", "Refresh the page", "Navigate back > forth"],
    "verify": ["Yearly price and savings are shown for every plan", "Selection survives refresh and back/forth"],
    "viewport": "desktop", "status": "NOT_TESTED", "gaps": [], "notes": "" } ] }
```

**Test case style**

- **Title**: what is being proven, one line.
- **Steps**: numbered, one action each, starting with a verb — Click, Type, Select,
  Toggle, Change, Enter, Navigate, Refresh. Name the control by its visible label.
- **Verify**: one checkable assertion per line. Use "Possible to …" / "Impossible to …"
  for validation ("Impossible to add more than 20 seats"); "is shown", "is correct",
  "works", "doesn't break" for function; name the number when there is one (subtotal,
  tax, savings, total).
- **Group** cases by area or user flow, in the order a user meets them.
- **Cover**, for each requirement where it applies: the happy path; validation
  (possible/impossible values, boundaries); navigation (back/forth, refresh mid-flow);
  skip / optional paths and manual input; prices and totals; texts the requirement names
  (disclaimers, labels, comparisons); empty and error states.
- **Keep it high-level**: what to prove, not every click — the exploratory scripts in
  `explore/` hold the exact clicks.
