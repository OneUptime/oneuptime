# Home overview

These images show the production dashboard page `packages/App/FeatureSet/Dashboard/src/Pages/Home/Home.tsx`
inside its real `Pages/Home/Layout.tsx` (the Page header; the overview has no side menu), with every card it mounts:
`Components/Home/HomeCommandBar`, `ProjectHealthCard` (with `OverviewStats`), `GettingStarted` (with
`HowOneUptimeWorks`), `NeedsAttention`, `ProjectResources`, `UpcomingMaintenance` and `ExploreProducts`.

They were rendered by the offline Playwright fixture in `packages/E2E/HomeOverview/Fixture`, with the
browser clock pinned to 2026-10-13 12:00 UTC and the browser time zone set to UTC. The
**Preview workspace · Synthetic data** banner identifies the substituted ModelAPI / API data: every
monitor, incident, alert, SLO, maintenance window and count in the images is fabricated for an
"Acme Commerce" workspace. No customer data appears in them.

- `before-busy.png` / `after-busy.png`: the same busy project (2 open incidents, 3 open alerts, 2 monitors
  not operational, 2 SLOs burning, maintenance in progress and 3 windows coming up) at 1440px. Before:
  five count tiles over the Active Incidents table; alerts, monitors and SLOs are numbers only, and the
  side menu's Not Operational badge counts an archived monitor the tile leaves out (3 against 2). After:
  the red "2 active incidents" headline over the five numbers, the open work by name in urgency order,
  Your project, Upcoming maintenance and Explore OneUptime, at the page's full width: the side menu
  (whose badge now agrees with the number) is on the lists Home opens, not on the overview.
  `before-busy.png` is master at `e0d768f0706` (`git archive`) rendered in this branch's fixture.
- `before-new-project.png` / `after-new-project.png`: a project made a minute ago. After: "Nothing is being
  monitored yet", the welcome checklist under the headline, "Problems will show up here", and every
  resource to set up; nothing is scheduled, so there is no maintenance card.
- `after-healthy.png`: monitors up and nothing open: "All systems operational", "11 monitors are
  operational, and there are no open incidents or alerts.", and the compact all-clear.
- `after-mobile.png`: the busy project at 390px, one column, nothing wider than the screen.
- `after-tablet.png`: the busy project at 768px, the numbers two to a row.
- `after-dark.png`: `after-busy.png` in the dark theme.
- `after-busy-de.png`: `after-busy.png` in German, relative times included ("vor 12 Minuten").

Regenerate with: `cd packages/E2E && CI=1 npm run test-home-overview-ui` (outputs go to
`output/playwright/home-overview-ui/`, named `home-*-synthetic.png`).
