# An Incoming Request monitor's latest request, shown as its logs keep it (#6402)

How these were made: the offline monitor overview fixture (`packages/E2E/MonitorOverview`,
`?type=incoming-request`), which renders the production overview page with the API replaced,
served by its own `Fixture/server.js` and shot in headless Chromium with Inter loaded. Only the
monitor summary card is captured. The fixture hands the page the latest request the way the
server now does: masked as the monitor's logs are, and with no headers or body when the monitor
keeps no request content (`?content=off`).

File names: `overview-<language>-<theme>-<width>-content-<on|off>.png`.

- `content-on`: Keep request content on. Show More Details is opened: the headers and body as
  kept (the `authorization` header masked), and under them the line saying secrets and personal
  data in the request are masked.
- `content-off`: Keep request content off. No headers, no body and no Show More Details: one
  line says the monitor keeps no request content, so its headers and body are not shown.
- Widths 1280 and 390, and 1024 and 768 beside the side menu; light and dark; German (`de`) and
  Persian (`fa`, right to left). None of the 32 pages scrolls sideways.

`before-overview-<language>-<theme>-<width>.png`: the same card before this change, for
comparison - main's overview component, and the fixture handing out the latest request raw, as
main's server did (the same request, its `authorization` header in clear), Show More Details
opened. Main drew this card the same with Keep request content on or off (the shots were
identical pixel for pixel), so there is one per language, theme and width: German light 1280
and dark 768, Persian light 1024 and dark 390.

## The two docs callouts this change rewrites

How these were made: the docs feature set's own routes and templates (`DocsFeatureSet.init()`),
served without the rest of the app as the docs suites do, and shot in headless Chromium. Each
shot is the one callout that changed, on its real page:

- `docs-incoming-request-monitor-*`: the warning under the request URL on
  `/docs/<language>/monitor/incoming-request-monitor`. It no longer says every header is visible
  to anyone who can read the monitor: the overview shows the latest request as its logs keep it.
- `docs-criteria-and-statuses-*`: the Keep request content tip on
  `/docs/<language>/monitor/criteria-and-statuses`, which now ends saying the latest request on
  the overview follows the switch at once.

File names: `docs-<page>-<language>-<theme>-<width>.png`, German (`de`) and Persian (`fa`, right to
left), light and dark, at 1280, 1024, 768 and 390. None of the 32 pages scrolls sideways. `before-docs-*.png` are the same callouts with main's text, at the same four
variants the overview's before shots use.
