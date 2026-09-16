# Responder verdict on the AI root cause header

These images show the incident header (`Components/EventView/EventStatusPanel.tsx`) with the
completed-investigation notice from `Components/AI/AIInvestigationHeaderStatus.tsx`, on the
production incident page `Pages/Incidents/View/Index.tsx`, and the rating row of
`Components/AI/InvestigationPanel.tsx`. They were rendered by the offline Playwright fixture in
`E2E/EventOverview/Fixture` at device scale factor 2, with the browser clock pinned to
2026-09-14 18:20 UTC. Every incident, report and verdict in them is fabricated for the
fixture's "Acme Commerce" workspace; no customer data appears, and they do not demonstrate a
real AI run.

The pages were opened with `?verdict=rejected` (or `?verdict=confirmed`), which saves a
responder's verdict on the investigation run before the page loads, the way a teammate's
earlier rating would arrive. The "before" images are the same fixture and scenario with the
previous versions of the seven changed dashboard files (the notice, its status helpers, the
panel, both `ChangeState` components and both pages).

- `before-rejected.png`: 1440px. The report has been rejected (`panel-rating-rejected.png`
  is the panel's rating row on the same page, "You rejected this analysis"), yet the header
  still presents it at full strength as the AI root cause analysis.
- `after-rejected.png`: the same page now. "Rejected by a responder" sits beside the heading
  and the summary drops to secondary text.
- `after-confirmed.png`: `?verdict=confirmed`. "Confirmed by a responder", summary unchanged.
- `before-tablet.png` / `after-tablet.png`: 768px, where the side menu leaves the header card
  at its narrowest. Before, View full report shared the heading row and cut the heading to
  "AI ROOT CAUSE ANALYS…". After, the heading has the row, the badge wraps under it, and View
  full report sits in the bottom row beside Show more.
- `before-phone.png` / `after-phone.png` / `after-phone-expanded.png`: 390px. The badge wraps
  under the heading; the last image is after Show more (with `?tldr=long`, a 320-character
  TL;DR).
- `after-rejected-dark.png` / `after-confirmed-dark.png`: 1440px with `?theme=dark`.

The E2E spec regenerates `incident-header-ai-verdict` (`?verdict=rejected` at 1440px) with
`cd E2E && npm run test-event-overview-ui`; the other images were captured from the same
fixture by hand (`node EventOverview/Fixture/server.js --watch`, see
`E2E/EventOverview/README.md`).
