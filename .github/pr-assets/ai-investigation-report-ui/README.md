# AI investigation report and event overview pages

These images show the production dashboard pages
`packages/App/FeatureSet/Dashboard/src/Pages/Incidents/View/Index.tsx`,
`Pages/Alerts/View/Index.tsx`, `Pages/ScheduledMaintenanceEvents/View/Index.tsx`,
`Pages/Incidents/EpisodeView/Index.tsx` and `Pages/Alerts/EpisodeView/Index.tsx` (each inside
its real `Layout` and side menu), and the AI report rendered by
`Components/AI/InvestigationPanel.tsx` with `Components/AI/InvestigationReport/*`. They were
rendered by the offline Playwright fixture in `packages/E2E/EventOverview/Fixture`, with the browser
clock pinned to 2026-09-14 18:20 UTC. The **Preview workspace · Synthetic data** banner
identifies the substituted ModelAPI / API data: every incident, alert, report, query and
person in the images is fabricated for an "Acme Commerce" workspace. No customer data
appears in them, and they do not demonstrate a real AI run or database persistence.

- `before-incident-ai-report.png` / `before-incident-overview.png`: the same fixture on the
  previous UI, for comparison. The report repeats its brand heading, buries the Summary
  inside the prose, prints raw `[C2][C3]` markers and plain `#1017` numbers, and ends with a
  flat "Evidence checked" list of ISO timestamps and "row(s)" counts.
- `ai-report-summary.png`: the AI Investigation card. The Summary is its own section (TL;DR
  plus the report's summary), then the report: a one-row header with the "AI-generated first
  pass — verify before acting." note and Copy report, and the report section by section: the
  amber "Most likely root cause" callout, Evidence and Suggested next steps, with citation
  chips and incident links inline and no brand heading.
- `ai-report-references.png`: the summary close up. `#1017`, `#1029` and `#1036` link to
  those incidents (the pointer is over `#1017`; its `title` reads "#1017 · Checkout API p95
  latency above 2s · Resolved" but the browser tooltip itself is not captured in a
  screenshot), and `C2`, `C3`, `C6` and `C1` are chips that open the matching evidence row.
- `ai-report-details.png`: "Evidence and activity", the one section under the report that
  holds the queries, the steps and what the run cost, as the card first shows it: collapsed,
  with the query and step counts and the read-only guarantee in its header.
- `ai-report-evidence.png`: the same section opened on its "Evidence checked" tab with C1
  expanded: what the query asked (search, time window, limit, when it ran, how long it took,
  the tool), an Open in Incidents link, the notice that the rows are current data under the
  viewer's permissions, and the three incidents it returned. The other nine queries show
  their plain-language description, local run time and row count; C8 returned no rows. The
  run's tokens and model close the section.
- `ai-report-activity.png`: the "Activity" tab: every step the run took, with the rows and
  time of each query.
- `incident-overview.png`: the incident page at 1440px. Hero with number, title, state,
  severity, duration, Declared / Declared by / Monitors facts and the report's TL;DR with
  Read report; one stat bar for time to acknowledge, time to resolve and duration; the AI
  report leading the left column above the feed, its evidence and activity collapsed under
  it; Incident Details, Incident Roles and
  Affected Resources stacked in the right column.
- `alert-overview.png`: the alert page with the same layout: Created / Monitor / Episode
  facts, the TL;DR in the hero, the AI report (with the `#298` alert link) above the Alert
  Feed, and Alert Details and Affected Resources on the right.
- `scheduled-maintenance-overview.png`: a scheduled event that starts in 2 hours: Mark as
  Ongoing / Mark as Ended in the hero, Status pages and Created by facts, a Starts / Ends /
  Duration bar with the "times in GMT" note, the feed, and Maintenance Details and Affected
  Resources on the right.
- `incident-episode-overview.png`: incident episode #12: hero with grouping rule and last
  incident added, a four-cell bar ending in the member count, "Incidents in this episode"
  (number chip, linked title, state and severity pills, View all incidents), the feed,
  Episode Details and Episode Roles.
- `alert-episode-overview.png`: alert episode #7 with its five member alerts and Episode
  Details.
- `incident-overview-mobile.png`: the top of the incident page at 390px (one viewport, not
  the full page): the hero, its facts and the TL;DR stack without horizontal scrolling.

Regenerate with `cd packages/E2E && npm run test-event-overview-ui` (use `CI=1` if another fixture
server may already be listening on port 4222); the images land in
`output/playwright/event-overview-ui/` under their `-synthetic` names (the `ai-report-*`
close-ups at device scale factor 2). The "before"
images were captured from the same fixture on the previous UI. See
`packages/E2E/EventOverview/README.md` for the scenarios and for running the fixture by hand.
