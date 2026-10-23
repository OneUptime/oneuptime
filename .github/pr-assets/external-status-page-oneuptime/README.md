# External Status Page monitor: the OneUptime Status Page provider

These images show the production Create Monitor page (`Pages/Monitor/Create`) on an External
Status Page monitor's criteria step: `ExternalStatusPageMonitorStepForm` and the criteria
below it (`Components/Form/Monitor/MonitorCriteria`). They were rendered by the offline
Playwright fixture in `packages/E2E/MonitorOverview/Fixture`, with the browser clock pinned to
2026-09-21 12:00 UTC, by `packages/E2E/MonitorOverview/ExternalStatusPageMonitor.spec.ts`.
The **Preview workspace · Synthetic data** banner marks the substituted data: the workspace,
its monitors, probes and the status page address in them are fabricated for an "Acme
Commerce" workspace. No customer data appears in them, and they do not show a real check.

- `providers-1280.png`: the Provider list open at 1280px. OneUptime Status Page sits between
  incident.io and the feeds; Auto, the default, is picked (the enum's order puts it last).
  The Provider's line says what Auto does.
- `oneuptime-more-fields-1280.png`: OneUptime Status Page picked, More fields open. The group
  filter's line says which providers have groups, and the two filters' titles say
  "(Optional)" once (they said it twice before).
- `maintenance-criteria-1280.png`: the docs' steps for showing upstream maintenance on your
  monitor: a criteria added with Add Criteria, External Status Page Component Status, Equal
  To, Under Maintenance. The page's address and the group Core are filled in.
- `providers-390.png`: the Provider list on a phone. It opens upward, over the address field,
  inside the screen.
- `oneuptime-more-fields-390.png`: More fields on a phone, every line wrapped inside the
  screen.
