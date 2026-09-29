# Monitor overview redesign

These images show the production dashboard page
`packages/App/FeatureSet/Dashboard/src/Pages/Monitor/View/Index.tsx` inside its real
`Pages/Monitor/View/Layout.tsx` (ModelPage header and side menu), with every card it mounts:
`Components/Monitor/Overview/*` (hero, stat bar, uptime history, response time, open work,
status changes, probes, setup, connection and details cards), `SummaryView/Summary.tsx`,
`MonitorFeed.tsx` and `Components/Metrics/EmbeddedMetricCard.tsx`, with the 90-day bars
drawn by `Common/UI/Components/Graphs/DayUptimeGraph.tsx` from the new
`GET /api/monitor/uptime-summary/:monitorId` aggregate.

They were rendered by the offline Playwright fixture in `packages/E2E/MonitorOverview/Fixture`,
with the browser clock pinned to 2026-09-21 12:00 UTC and the browser time zone set to UTC.
The **Preview workspace · Synthetic data** banner identifies the substituted ModelAPI /
AnalyticsModelAPI / API data: every monitor, probe, status change, incident, alert, metric
point, owner and heartbeat URL in the images is fabricated for an "Acme Commerce" workspace.
No customer data appears in them, and they do not demonstrate a real check, probe or
database.

- `before-desktop.png`: the previous overview, for comparison: the same fixture and scenario
  rendered against a scratch export of master at `6a08bef63d` (`git archive`), with this
  branch's fixture copied in. The fixture's two pure imports that master does not have
  (`Types/Monitor/MonitorUptimeSummary.ts`, `Utils/Monitor/MonitorUptimeSummaryUtil.ts`) were
  added so it could build; the page, its layout and every card are master's.
- `desktop.png`: the API monitor at 1440px, healthy. The hero leads with the status and how
  long it has held ("Operational for 3 days, 4 hours, 12 minutes"), the target
  (`GET https://api.acme-commerce.example/v1/checkout/health`), when it was last checked and
  when it checks next, and the Latest result, Probes and Owners facts. Under it, uptime over
  24 hours, 7 days and 30 days with the downtime behind each figure, and "Nothing open". The
  main column has the 90 day bars (with the 90-day figure summed from them), response time
  per probe, the Monitor Summary with its probe picker and Test Monitor on a row of their own,
  and the activity feed. The side column has open incidents and alerts, the last five status
  changes, the probes with their health and next check (and how many connected probes must
  agree before the status changes), and the editable details.
- `offline.png`: the same monitor Offline for 12 minutes: the red hero, the failure cause
  under "Down · 94 ms · HTTP 503", "1 incident · 1 alert" in the stat bar linking to the
  monitor's incidents and alerts, the open incident and alert in the side card with their
  severity, every probe Down with its cause, and the Offline row heading the status changes.
- `new-monitor.png`: a monitor created 12 days ago. Bars before it existed are grey "No data",
  never green; the 90-day figure and the 30-day tile both say they were "measured over
  12d 3h", and the footnote says when the monitor was created and that earlier days have no
  data.
- `heartbeat-setup.png`: an incoming-request monitor that has not received its first
  heartbeat. The hero says so and why; the uptime bars and stat bar are left out (they would
  only say "No data"); the setup card shows the heartbeat URL with a copy button, a
  `curl -X POST` example and a link to the full instructions. The URL carries the monitor's
  secret key, so a Viewer sees a "Setup details are hidden" card instead (covered by the
  spec, not pictured).
- `mobile.png`: the first screen at 390px: the badge, headline, target, Refresh with when it
  was last checked, and the facts in one column. The page never scrolls sideways; the uptime
  strip scrolls inside its card and starts at today.
- `tablet.png`: the whole page at 768px: the stat bar as 2 x 2, one column with the side
  cards after the feed, the response-time and summary controls under their titles, and the
  response-time chart at a readable height.
- `paused.png`: the API monitor paused for scheduled maintenance. The hero is neutral, says
  checks resume when the maintenance event ends and gives the last recorded status; the
  Probes fact reads "3 enabled" over "Checks paused", every probe keeps the verdict of its
  last check instead of turning Late, and the uptime tiles say they include paused time.
- `manual.png`: a manual monitor, whose status people set. The hero has the Manual badge,
  "No automated checks" and Change status; there is no response time, Monitor Summary or
  Probes card, and a Manual monitor card says how the status changes.
- `one-disconnected.png`: the API monitor with one of its three probes disconnected for three
  days. The monitor is still checked on time by the other two, so the hero stays
  Operational with its next check; the Probes fact reads "2 of 3 reporting" over
  "1 disconnected" in amber, and the Probes card lists the disconnected probe first. A
  single dead probe no longer marks the whole monitor "Checks overdue".
- `dark.png`: `desktop.png` in the dark theme.

Regenerate with: `cd packages/E2E && CI=1 npm run test-monitor-overview-ui` (outputs go to
`output/playwright/monitor-overview-ui/`; `mobile.png` is
`monitor-overview-mobile-top-synthetic.png`, the others keep their names without the
`monitor-overview-` prefix and `-synthetic` suffix).
