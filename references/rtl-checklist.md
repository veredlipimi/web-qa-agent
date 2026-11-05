# RTL / Hebrew checklist

Walk this on the home page and every key-journey page, at mobile and desktop. Each failed
item is a finding with a screenshot (category `RTL/i18n`).

## Document
- [ ] `<html lang="he" dir="rtl">` (or `dir` on the main container for mixed sites)
- [ ] Page `<title>` and meta description in Hebrew where the content is Hebrew

## Layout & mirroring
- [ ] Reading order flows right → left: logo on the right, menu/hamburger placement matches
- [ ] Directional icons are mirrored: back/next arrows, chevrons in breadcrumbs, carousels,
      "read more →" (should be ←)
- [ ] Non-directional icons are **not** mirrored: play, checkmark, clock, logos, phone
- [ ] Progress bars and step indicators advance right → left
- [ ] Carousel swipe direction matches arrows
- [ ] Drawers/side menus open from the correct side
- [ ] Margins/paddings are logical (no element glued to the wrong edge)

## Text
- [ ] Hebrew paragraphs aligned right
- [ ] Mixed Hebrew + English/numbers render in the right order
      (e.g. `מחיר: ₪120`, `גרסה 2.4`, `Wix Studio עם`)
- [ ] Phone numbers, emails, URLs, order numbers stay LTR inside Hebrew text
- [ ] Punctuation sits at the correct end of the sentence (no `.שלום`)
- [ ] Hebrew font loads (no fallback to a font without Hebrew glyphs; no tofu boxes)
- [ ] Truncation/ellipsis appears on the left end

## Forms
- [ ] Text inputs accept Hebrew and align right (`dir="auto"` or `rtl`)
- [ ] Email/phone/URL/number inputs stay LTR
- [ ] Labels, placeholders and validation messages are in Hebrew
- [ ] Error messages appear next to the right field, on the correct side
- [ ] Checkbox/radio sits to the right of its label
- [ ] Select dropdown arrow on the left

## Data & formats
- [ ] Dates as DD/MM/YYYY; Hebrew month names if spelled out
- [ ] Currency `₪` placement consistent; thousands separators
- [ ] Sorting of Hebrew lists is alphabetical (א→ת)
- [ ] Search works with Hebrew input, final letters, and with/without niqqud

## Gender & language
- [ ] Microcopy is consistent in addressing (masculine / feminine / plural / neutral)
- [ ] No untranslated English strings in buttons, toasts, empty states, emails
