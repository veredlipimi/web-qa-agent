# Finding schema

Exploratory findings go in `<run>/findings.manual.json`. The report script merges them with
`findings.auto.json`. Write manual findings in the report language.

```json
{
  "findings": [
    {
      "id": "EXP-001",
      "ruleId": "explore-validation",
      "category": "Functional",
      "severity": "High",
      "title": "Contact form accepts a whitespace-only name",
      "page": "https://example.com/contact",
      "viewport": "mobile",
      "type": "Missing validation",
      "requirement": "AC-3",
      "preconditions": "Logged out; cookie banner dismissed",
      "steps": ["Open /contact", "Type 3 spaces in Name", "Enter a valid email", "Tap Send"],
      "expected": "Inline error under Name",
      "actual": "Form passes validation and the Send button becomes active",
      "impact": "Likely: empty leads reach the sales inbox; affects every visitor who mistypes",
      "evidence": {
        "screenshot": "screenshots/explore/EXP-001.png",
        "details": "Optional: console line, request/response excerpt, HAR path"
      }
    }
  ],
  "notCovered": [
    { "page": "https://example.com/checkout", "reason": "Final submit skipped — production" }
  ],
  "openQuestions": [
    { "question": "Should the 20-seat limit include the account owner?", "for": "product", "related": "AC-2" }
  ]
}
```

## Fields

| Field | Required | Notes |
|---|---|---|
| `id` | yes | `EXP-###`. Automated ones get `QA-###` at report time. |
| `category` | yes | Functional, UI/UX, API/Network, Accessibility, Performance, Responsive, RTL/i18n, SEO, Security |
| `severity` | yes | Critical / High / Medium / Low / Info — see `severity.md` |
| `title` | yes | What is wrong, from the user's point of view. One line. No "bug". |
| `page`, `viewport` | yes | Exact URL and `mobile` / `tablet` / `desktop` |
| `steps` | yes | Reproducible by someone who has never seen the site |
| `expected`, `actual` | yes | Concrete and observable |
| `evidence.screenshot` | yes* | Path relative to the run folder. *Or `evidence.details` with a captured log/request. |
| `ruleId` | no | Free-form tag (e.g. `explore-state`, `explore-keyboard`) for grouping |
| `type` | no | What kind of gap: `Incorrect behavior`, `Missing validation`, `Missing feature`, `Missing state` (empty/loading/error), `Content`, `Inconsistency` (UI vs requirement or vs design notes) |
| `requirement` | no | Requirement ID(s) from `requirements.json`, e.g. `"AC-2"` or `["AC-2","AC-4"]` |
| `preconditions` | no | Setup the steps assume: account state, data, flags, viewport |
| `impact` | no | Who is hurt and how much. When the cause or reach is inferred, start with **Likely** or **Possible** — the observation itself must still be certain |

## Open questions

`openQuestions` collects what only product or dev can answer: a requirement that is
ambiguous, two sources that disagree, a behaviour that might be by design. Write the
question so it can be answered in one line; `for` is `product`, `dev`, `design` or
`content`; `related` points at requirement or gap IDs. Questions are not gaps — they
don't affect severity counts or the gate, and they appear in the report in their own
section.

## Writing a good title

- ✅ "Checkout button stays disabled after a valid coupon is applied (mobile)"
- ❌ "Checkout bug"
- ❌ "Possibly the coupon API is slow" — speculation; only report what you observed
