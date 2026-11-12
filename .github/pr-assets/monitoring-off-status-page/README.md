# Monitoring off on a public status page

Screenshots for #6478: a monitor whose monitoring is turned off no longer
decides any status on a public status page. The page keeps it listed and
draws it as **Not monitored**, in gray, in place of the status its last check
left it at.

Rendered from the real status page app (`App/FeatureSet/StatusPage`) in
headless Chromium at a 2x device pixel ratio, with the page's own
`index.ejs`, the production Tailwind and Inter, through the offline fixture
in `packages/E2E/StatusPageTheme` (a copy in a scratch folder whose overview
answer adds `notMonitoredResourceIds`, as the server now sends it). Every
record in them is made up. Each frame runs from the overall status banner to
the end of the Regions grid.

The page: Core services lists API, Dashboard, Webhooks (Degraded) and Email
delivery, which was Offline when its monitoring was turned off. Regions is a
grid of API in US, API in EU (Degraded) and Dashboard in US.

| File | Shows |
| --- | --- |
| `status-page-1280-before.png` | Before: Email delivery's monitoring is off, but its frozen Offline still reads as live. The banner says Some Resources are Offline and Core services shows Offline. |
| `status-page-1280-after.png` | After: Email delivery and API in EU have monitoring off. Each reads Not monitored, in gray. The banner shows the worst status among the resources that are checked (Webhooks, Degraded). Core services shows its uptime because nothing checked in it is down. The grid's tally reads 2 Operational and 1 Not monitored. The EU cell has no uptime percentage. |
| `status-page-390-after.png` | The same page on a phone. |
| `status-page-dark-1280-after.png` | The same page in the dark theme. |
| `nothing-monitored-1280-after.png` | Every resource has monitoring off. The banner says No Resources are monitored right now, in gray. Core services, each row and each grid cell read Not monitored. |
| `nothing-monitored-de-1280-after.png` | The same page in German (Nicht überwacht). All 18 status page languages have the words. |

The history bars and uptime percentages of a monitor whose monitoring is off
are unchanged. How those count the time with monitoring off is #6480.
