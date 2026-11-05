# E-commerce, pricing & billing checklist

Use when the app profile type is e-commerce or SaaS with plans. Adapted from
*Playwright for QA*, parts 8, 10 and 11 (Vered Li). Money flows come first in the risk
ranking. On production, stop before the final payment step unless the user explicitly
allowed a test card on a test-mode gateway.

## Cart & order maths
- [ ] Line total = unit price × quantity, for quantity 1, 2 and 10
- [ ] Adding the same item twice increments quantity (no duplicate line, no lost line)
- [ ] Remove / change quantity updates totals immediately, and after refresh
- [ ] Subtotal, discount, shipping, tax and total add up exactly (no rounding drift)
- [ ] Prices are identical on listing, product page, cart and checkout
- [ ] Empty cart has a clear state and a way back to shopping

## Currency & locale (Israel first)
- [ ] ₪ symbol and position are consistent (`₪120` or `120 ₪`, but always the same one)
- [ ] Thousands separator and decimals: `₪1,299.90`
- [ ] VAT: prices labelled "כולל מע״מ" when tax-inclusive; the total shows the VAT line
- [ ] Geo-based currency for new users; **sticky currency** for existing subscriptions
- [ ] Unmapped country falls back to a defined default currency

## Coupons & promotions
- [ ] Valid coupon reduces the price and the code is shown
- [ ] Invalid / expired coupon shows a clear error; the price is unchanged
- [ ] Coupon + sale price: which wins? (ask if it is not documented)
- [ ] Tax computed on the pre- or post-coupon price, as specified
- [ ] One-time coupon used twice → the second use is rejected
- [ ] Coupon codes are case-insensitive and trimmed (` SAVE10 `)

## Checkout & payment
- [ ] Double-click on "Pay" / "Place order" → exactly one order (watch the network)
- [ ] Refresh or browser back on the confirmation page → no second charge or order
- [ ] Declined card: a clear, actionable error, and the user can retry
- [ ] 3-D Secure: redirect out and back, and state is preserved
- [ ] Payment timeout: graceful handling, no duplicate charge
- [ ] Confirmation shows the correct items, total, currency and order number
- [ ] Confirmation email / receipt matches the order (if observable)

## Plans & subscriptions (SaaS)
- [ ] Upgrade shows only higher plans; downgrade shows "Change plan" and only lower plans
- [ ] Proration on a mid-cycle upgrade (check day 1, day 15 of 30, and the last day)
- [ ] Downgrade takes effect at the end of the period; access continues until then
- [ ] Cancel: access until period end; renewal date shown correctly
- [ ] Free trial → conversion charge happens after the trial, not before

## User state × flow matrix
| User state | Purchase | Upgrade | Downgrade |
|---|---|---|---|
| Anonymous | select → sign-in → selection preserved | n/a | n/a |
| Logged in, no subscription | full flow | n/a | n/a |
| Logged in, has subscription | n/a | higher plans only | lower plans only |
| No billing permission | blocked with a clear message | blocked | blocked |

Every cell you cannot reach (no account for that role, no test card) is a **not-tested**
coverage entry with the reason — never a pass.
