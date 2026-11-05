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
      "steps": ["Open /contact", "Type 3 spaces in Name", "Enter a valid email", "Tap Send"],
      "expected": "Inline error under Name",
      "actual": "Form passes validation and the Send button becomes active",
      "evidence": {
        "screenshot": "screenshots/explore/EXP-001.png",
        "details": "Optional: console line, request/response excerpt, HAR path"
      }
    }
  ],
  "notCovered": [
    { "page": "https://example.com/checkout", "reason": "Final submit skipped — production" }
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

## Writing a good title

- ✅ "Checkout button stays disabled after a valid coupon is applied (mobile)"
- ❌ "Checkout bug"
- ❌ "Possibly the coupon API is slow" — speculation; only report what you observed
