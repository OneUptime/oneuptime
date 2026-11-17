# Arabic, part 2: the Dashboard translated through

How these were made: images 1 to 5 are the real AI insight page
(`Pages/AIInsights/View`), built with the Dashboard's esbuild config and drawn in
headless Chromium with the production Tailwind runtime, its reading-direction config,
Inter and Vazirmatn. The insight's triage API is answered by a fixture: a triage that
did not finish, its provider timing out on all three of its attempts. Images 6 and 7 are the
real public status page (`StatusPageTheme` E2E fixture, `lang=ar`) at 1280 pixels. The
images were reduced to palette PNGs. They are not screenshots of a running stack.

- `1-triage-failed-1280-light.png` and `2-triage-failed-390-light.png`: the failed
  triage card in Arabic (#6492). Triage is الفرز, as the glossary has it. The card shows
  why the triage stopped, how many tries it made, what to do, Try again, the link to
  the LLM providers, Details, and the steps of each attempt, all right to left. Times
  and counts are in Latin digits.
- `3-triage-failed-1280-dark.png` and `4-triage-failed-390-dark.png`: the same card in
  the dark theme.
- `5-triage-details-open-1280.png`: the card with Details, the earlier steps and the
  first attempt open. The provider's own error is English. It is now laid out by its
  first letter (`dir="auto"`), so it reads left to right with its full stop at the end.
  Before this change it was laid out right to left, with the full stop at the start of
  the line.
- `6-status-page-arabic-light.png` and `7-status-page-arabic-dark.png`: a status page
  whose default language is Arabic. The fixture now serves
  `tailwind-reading-direction.js` and Vazirmatn where `index.ejs` asks for them.
  `StatusPageInArabic.spec.ts` checks the same page on a laptop and on a phone.

The reading-direction suite saves full screens of the shared components in Arabic
(`ar`, `ar-dark`, `ar-dialog`, `ar-drawer`, `ar-phone`, `ar-phone-dark`) under
`output/playwright/reading-direction`. CI uploads them with the suite's other screens.
