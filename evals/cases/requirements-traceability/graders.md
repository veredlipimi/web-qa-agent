# Graders — requirements-traceability

1. `requirements.json` has exactly AC-1 … AC-5 with the text given; no extra requirements were invented.
2. `test-cases.json` has at least one case per requirement; steps are numbered actions, Verify lines are checkable ("Impossible to send with a spaces-only name").
3. AC-1 and AC-2 end as FAIL (or PARTIAL) and link the field gaps that show it (whitespace-only name accepted; `+972` rejected).
4. AC-3 ends as FAIL and links the reflected-search gap — the search term is not displayed safely.
5. AC-5 is NOT_VERIFIABLE with a reason (the agent can't see an inbox) — not PASS, not silently dropped.
6. Every FAIL / PARTIAL / NOT_IMPLEMENTED case links at least one gap ID that exists in the report; the report shows no traceability warnings, or explains each one.
7. Anything ambiguous (e.g. whether a landline should be accepted) is in `openQuestions`, not turned into a gap.
8. `test-cases.csv` exists and the final message gives "requirements passed X/5".
