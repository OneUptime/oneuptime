# AI root cause summary in the event header

These images show the incident header (`Components/EventView/EventStatusPanel.tsx`) with the
completed-investigation notice from `Components/AI/AIInvestigationHeaderStatus.tsx`, on the
production incident page `Pages/Incidents/View/Index.tsx`. They were rendered by the offline
Playwright fixture in `E2E/EventOverview/Fixture` at device scale factor 2, with the browser
clock pinned to 2026-09-14 18:20 UTC. Every incident, report and TL;DR in them is fabricated
for the fixture's "Acme Commerce" workspace; no customer data appears, and they do not
demonstrate a real AI run.

Most images use `?tldr=long`, which gives incident #1042 a TL;DR of exactly 320 characters,
the server's cap (`InvestigationTldr.MAX_TLDR_CHARS`). The "before" images are the same
fixture and scenario with the previous `AIInvestigationHeaderStatus.tsx` and
`InvestigationReportData.ts`.

- `before-wide.png` / `after-wide.png`: a 2000px window. The fixture centres its pages in a
  1440px column, but production's `Page` is full width, so for these two the fixture's
  `max-w-[1440px]` wrapper was removed in the browser before the capture. Before: the TL;DR
  is cut at 280 characters ("Rolling back to…") and runs in lines of about 200
  characters, with "Read report" and a chevron at the far end. After: the whole TL;DR in three
  lines at a readable measure, with "View full report" and an arrow in the heading row.
- `before-desktop.png` / `after-desktop.png`: the same at 1440px.
- `after-desktop-short.png`: the default fixture TL;DR (196 characters) at 1440px; it fits,
  so there is no Show more.
- `after-tablet-expanded.png`: 1024px, where the long TL;DR needs more than three lines,
  after Show more.
- `before-phone.png` / `after-phone.png` / `after-phone-expanded.png`: 390px. Before: two
  lines, about 45 characters of the TL;DR, and no way to read the rest in place. After:
  three lines with Show more and View full report in the bottom row, then the whole TL;DR
  with Show less.
- `before-desktop-dark.png` / `after-desktop-dark.png`: 1440px with `?theme=dark`.
- `after-running.png`: `?ai=running`. The live notice is unchanged apart from the arrow on
  View live progress.

The E2E spec regenerates `incident-header-ai-summary` (`?tldr=long` at 1440px) with
`cd E2E && npm run test-event-overview-ui`; the other images were captured from the same
fixture by hand (`node EventOverview/Fixture/server.js --watch`, see
`E2E/EventOverview/README.md`).
