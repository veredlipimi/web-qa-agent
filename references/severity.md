# Severity rubric

Severity = user impact × reach. Decide from what a real user experiences, not from how
hard the fix is. When torn between two levels, pick the higher one and say why in
`triage.json`.

| Severity | Definition | Examples |
|---|---|---|
| **Critical** | A core journey is blocked for many users, data is lost/exposed, or money/legal risk. No workaround. | Start page down; checkout/sign-up cannot complete; `.env` or `.git` publicly readable; payment page over HTTP |
| **High** | A core journey is broken or seriously degraded for a segment (a browser, a viewport, keyboard/screen-reader users), or a workaround exists but most users won't find it. | API 5xx behind a visible feature; form fields without labels; missing viewport meta; mixed content; linked page 404 from main navigation; uncaught JS exception breaking a component |
| **Medium** | Noticeable gap that hurts trust, conversion or accessibility, but the user can still complete the task. | Horizontal scroll on mobile; LCP > 2.5s; CLS > 0.1; contrast failures; session cookie without HttpOnly; RTL page rendered LTR; console errors |
| **Low** | Polish, best practice or hardening. Few users notice. | Missing meta description; small tap targets on secondary links; missing CSP/Referrer-Policy; slow non-critical API call; version in `X-Powered-By` |
| **Info** | Worth knowing; not a gap by itself. | No canonical URL; `noindex` on a staging site |

## Missing features vs. broken features

A feature that is absent (no checkout, no password reset, no search) is a gap only when
something says it should exist: the app profile's journeys, a link or button that leads to
it, the user's Phase 0 answers, or copy on the site promising it. If its absence might be
by design (e.g. a catalogue site that sells by phone), do not rate it Critical — list it
under "Assumptions" as an open question for the product owner, and rate it only once the
answer is known.

## Adjusting automated defaults

The scripts assign a default per rule (`scripts/lib.mjs` → `RULES`). During triage:

- **Raise** when the gap sits on a key journey from Phase 0, or on the home page,
  or affects every page (site-wide template issue).
- **Lower** when the gap is on a page users rarely reach, or is clearly intentional
  (e.g. `noindex` on staging).
- **Dismiss** false positives (third-party widget errors the site owner cannot control are
  *not* false positives — keep them, note the owner).

Record every change in `<run>/triage.json`:

```json
{
  "dismiss":  [{ "match": "seo-canonical", "reason": "Single-page app, canonical not used" }],
  "severity": [{ "match": "Horizontal scroll", "severity": "High", "reason": "Affects checkout on mobile" }]
}
```

`match` is a `ruleId` or a case-insensitive substring of the finding title.

## Verdict

- Any Critical → **Not ready to ship.**
- Any High, no Critical → **Ship only with the High gaps accepted or fixed.**
- Otherwise → **No blocking gaps identified.**
