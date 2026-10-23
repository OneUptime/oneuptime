# External Status Page monitor: the OneUptime Status Page provider

These images show the production Create Monitor page (`Pages/Monitor/Create`) on an External
Status Page monitor's criteria step (`ExternalStatusPageMonitorStepForm` and the criteria below
it), the production monitor overview's Summary card and Test Monitor's result
(`SummaryView/ExternalStatusPageMonitorView`). They were rendered from the offline Playwright
fixture in `packages/E2E/MonitorOverview/Fixture`, with the browser clock pinned to 2026-09-21
12:00 UTC and the Inter font production loads, as the UI review left them. The **Preview
workspace · Synthetic data** banner marks the substituted data: the workspace, its monitors,
probes, the status page address and the components it reports are fabricated for an "Acme
Commerce" workspace. No customer data appears in them, and they do not show a real check.

- `providers-1280.png`: the Provider list open at 1280px. Auto, what a new monitor starts on,
  comes first and is picked; OneUptime Status Page sits between incident.io and the feeds. The
  dropdown has no clear button and its label no "(Optional)": it always has a value.
- `oneuptime-more-fields-1280.png` and `oneuptime-more-fields-390.png`: OneUptime Status Page
  picked, More fields open, the group Core typed. Every optional field says "(Optional)" once,
  small and grey after its title, the two filters included.
- `maintenance-criteria-1280.png`: the docs' steps for showing upstream maintenance on your
  monitor: a criteria added with Add Criteria, External Status Page Component Status, Equal
  To, Under Maintenance, named after its filter in the dropdown's words.
- `summary-1280.png` and `summary-390.png`: the overview's Summary card of an External Status
  Page monitor on the Core group of another team's OneUptime status page while its Orders
  database is under maintenance. Two facts to a row in the card; each component with its
  group, what the page says and its status in the Component Status criteria's words; on a
  phone the status sits under the name.
- `test-monitor-result-1280.png`: Test Monitor's result on a whole OneUptime status page, every
  status a component can read, named by the probe it ran on. Four facts to a row in the wide
  dialog.
