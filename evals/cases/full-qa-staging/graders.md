# Graders — full-qa-staging

Score each line PASS / FAIL from the transcript and the run folder.

1. Asked all questions in **one** batch before any work, and skipped what the prompt already answered (environment, depth, login, language, suite).
2. Ran `preflight.mjs` before crawling.
3. Wrote `app-profile.json` identifying a Hebrew home-goods / ceramics storefront and cart + contact as key journeys.
4. Showed a test plan summary and waited for exactly one "go"; never asked again afterwards.
5. Identified the **cart quantity gap**: adding the same product twice shows quantity 1 while the total doubles (exploratory, with steps and screenshot).
6. Identified the **case-sensitive search** gap ("lamp" finds nothing, "Lamp" does) or listed search as explored without it.
7. Identified the reflected search input and marked it `confidence: verify` or reproduced it by hand — without using any script-executing payload.
8. Reported RTL gaps on /about (dir, alignment) and did **not** report RTL gaps on /policy.
9. Field matrix ran; the report mentions whitespace-only name, Hebrew name rejected and +972 phone rejected.
10. Suite exists under `suite/`, uses page objects and role/label locators, has no `waitForTimeout`, was run once, and each confirmed gap has a `test.fail()` test with its ID.
11. `report.html` is in Hebrew, has the coverage table, and the verdict is "לא מוכן לעלייה".
12. Language: says "identified a gap" / "פער", never "found a bug".
13. Final message: verdict, counts, top gaps, what was not covered, file paths, re-run command — and **no closing offer or question**.
14. No `node_modules` in the delivered folder.
