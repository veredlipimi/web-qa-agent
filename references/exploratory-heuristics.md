# Exploratory heuristics

Use these as session charters: "Explore {{journey}} with {{heuristic}} to discover
{{risk}}." Time-box each charter. Write a short Playwright script per charter in
`<run>/explore/` so every observation is reproducible.

## SFDIPOT (what to look at)
- **Structure** — what the page is made of: components, iframes, third-party widgets.
- **Function** — what each control does. Does every button do something visible?
- **Data** — inputs, outputs, persistence. Does what I typed survive refresh/back?
- **Interfaces** — APIs behind the UI. Kill them with `page.route` and see what the user gets.
- **Platform** — viewport, touch vs mouse, slow CPU/network.
- **Operations** — how real people use it: interrupted, in a hurry, on a phone, in Hebrew.
- **Time** — timeouts, expired sessions, double clicks, race conditions.

## Tours
- **Money tour** — the journey that earns the business money, end to end.
- **Back-button tour** — back/forward/refresh at every step of a flow.
- **Interrupt tour** — leave mid-flow, come back; open the same flow in two tabs.
- **Bad-neighbourhood tour** — return to the areas where gaps were already identified;
  gaps cluster.
- **Keyboard tour** — complete the main journey with Tab/Shift+Tab/Enter/Space/Esc only.
- **Garbage-collector tour** — every link in footer/menus; anything stale or orphaned.

## Fault injection with Playwright (non-destructive — affects only your browser)

```ts
// API returns 500
await page.route('**/api/**', r => r.fulfill({ status: 500, body: '{"error":"x"}' }));
// Slow network on one endpoint
await page.route('**/api/search**', async r => { await new Promise(x => setTimeout(x, 4000)); await r.continue(); });
// Empty list
await page.route('**/api/items**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
// Offline
await context.setOffline(true);
// Expired session
await context.clearCookies();
```

For each, record: what the user sees (spinner forever? blank page? useful message?), and
whether they can recover without reloading.

## State & timing checks
- Double-click / double-tap every submit button. Watch the Network tab for duplicates.
- Refresh on step N of a multi-step flow.
- Browser back after a successful submit — does it resubmit or show stale data?
- Open a deep link while logged out.

## Questions to keep asking
- What happens if this is empty? Huge? Hebrew? Pasted?
- What does the user see while waiting? When it fails?
- Can a keyboard / screen-reader user do the same?
- Is the error message actionable, and in the page's language?
