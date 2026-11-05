# Edge-case test data

Use these as **display and validation** tests: does the UI validate, store and render them
correctly as text? They are not attack payloads — do not use them to probe the server
beyond what a normal form submit does, and only submit where Phase 0 allows it.

## Text fields
| Case | Value |
|---|---|
| Empty | `""` |
| Whitespace only | `"   "` |
| Leading/trailing spaces | `"  Dana  "` |
| Max length +1 | `"a".repeat(maxLength + 1)` |
| Very long | `"א".repeat(5000)` |
| Hebrew | `"ורד לי"` |
| Mixed direction | `"QA בדיקה 2026 test"` |
| Hebrew with punctuation | `"שלום, מה נשמע?"` |
| Final letters / niqqud | `"ךםןףץ שָׁלוֹם"` |
| Emoji / ZWJ | `"👩‍💻🇮🇱"` |
| Apostrophe | `"O'Brien"` / `"צ'יפס"` |
| HTML-looking (render test) | `"<b>bold</b>"` — must appear literally, not bold |
| Quote characters | `"״גרשיים״ “smart” 'single'"` |
| Newlines in single-line field | `"line1\nline2"` (paste) |

## Email
`a@b.co` (valid, short) · `name+tag@example.com` · `name@sub.example.co.il` ·
`name@example` · `name@@example.com` · `" name@example.com"` · `NAME@EXAMPLE.COM`

## Israeli phone
Use fake numbers only:
`050-0000000` · `0500000000` · `+972500000000` · `+972-50-000-0000` · `050 000 0000` · `05000` (too short)

## Numbers & money
`0` · `-1` · `0.1` · `1,000` · `1.000` · `1e5` · `999999999999` · `₪100` · `"abc"`

## Dates
`29/02/2024` (leap) · `29/02/2025` (invalid) · `31/04/2026` · today · far past (`01/01/1900`) ·
far future · DD/MM vs MM/DD ambiguity (`03/04/2026`)

## Files (upload fields)
0-byte file · file at the size limit · limit +1 byte · wrong extension · right extension with
wrong content · Hebrew file name (`קובץ בדיקה.pdf`) · very long file name

## Israeli ID (ת.ז.)
Use only check-digit-valid **fake** numbers generated for testing; never real ones.
