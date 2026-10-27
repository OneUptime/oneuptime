# Security Events empty states fixture

An offline harness for the two Security Events pages of a project that has neither sent nor
connected anything yet:

| Page            | Route (from `RouteMap`)                                                           | Production components                                                                                                                                                                                                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security Events | `SECURITY_EVENTS` `/dashboard/:projectId/security-events`                         | `Pages/SecurityEvents/{Layout,Index}`, `SecurityEventsViewer` inside `TelemetryViewer`, `SecurityEventsEmptyState`, `SecurityEventsNoResults`                                                                                                                                                                                               |
| Connections     | `SECURITY_EVENTS_CONNECTIONS` `/dashboard/:projectId/security-events/connections` | `Pages/SecurityEvents/{Layout,Connections}`, `SecurityLogsSourceCard` (Your logs), `SecurityEventConnectionsTable` inside `ModelTable`, `SecurityEventConnectionsEmptyState`, `SecurityEventProviderTile`, `SecurityEventConnectionFormModal`, `SecurityEventDestinationsTable` and `SecurityEventDestinationFormModal` (Send to your SIEM) |

`Fixture/server.js` bundles the production layout (breadcrumbs, the Security Events side menu)
and both pages with esbuild, serves them with the same Tailwind build, `tailwind.config` and
`Theme.css` production uses, and listens on `127.0.0.1:4232`
(`SECURITY_EVENTS_EMPTY_STATES_FIXTURE_PORT`). No Docker, no database, no sign-in.

## What is real and what is stubbed

Real: the layout, both pages, the Connections table and its card, the empty states, the
provider tiles, the Add connection form (its steps, the provider picker, each provider's
Connection step and setup guide link), `PermissionGate`, `TelemetryViewer` (toolbar, facet
sidebar, histogram, pagination) and the routing between the pages.

Stubbed:

- The data boundary: `ModelAPI`, `AnalyticsModelAPI` and `API`. Every table answers empty, so
  both pages show their empty state. The search bar's attribute lookup answers with no
  attributes. Turning Your logs on is the one write modelled: it creates the project's
  `SecurityLogSource`, which the card then reads back.
- The signed-in user ("Maya Chen" of a generic "Acme Commerce" workspace) and her
  permissions. The fixture header says the data is synthetic
  ("Preview workspace · Synthetic data").
- `HOST` is the made-up `oneuptime.acme-commerce.example`, so the setup guide links read the
  way they do on a real install (`https://oneuptime.acme-commerce.example/docs/integrations/<slug>`).
  Nothing is ever fetched from it: the spec answers the one docs page a clicked link names
  with a stub and aborts everything else.
- The side menu's counts beside Open Cases, Assigned to Me and Approvals
  (`ModelAPI.count` of the open cases, the signed-in user's open cases and the runs waiting
  for approval) answer 0.
- The menu's other pages (Overview; Open Cases, Assigned to Me, Unassigned, Closed Cases, All
  Cases; Correlate, Entities; Detection Rules, Rule Library, ATT&CK Coverage, Threat Intel;
  Playbooks, Approvals, Playbook Runs; Setup Guide) render a small stub page with
  `data-testid="stub-page"` and `data-page="<PageMap key>"`, so a test can tell where a link
  went.

The clock is pinned: the spec fixes the browser clock to `2026-09-22T12:00:00Z`.

## Scenarios

Query parameters, parsed once per page load:

| Parameter  | Values                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `?role=`   | `owner` (default) or `viewer`: Security Viewer only, so it can read connections but not create them. Both Add connection buttons are disabled, the reason is written out under the hero button and the tiles become a static "Supported products" list.                                                                                                                                                                                                                                                |
| `?theme=`  | `dark` adds `html.dark` (done in `server.js`, before the bundle runs)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `?latest=` | Once its time window comes back empty, the Security Events page looks up the project's newest event (one row, no time window) to tell "nothing ever arrived" from "nothing in this window". `none` (default): there is no event at all, so the page shows its empty state. `pending`: the lookup does not answer until the spec calls `window.__securityEventsEmptyStatesFixture.resolveLatestEvent()`. `old`: the newest event arrived at `2026-09-01T09:30:00Z`, outside the default one-day window. |
| `?siem=`   | `rows`: three SIEMs in the Send to your SIEM table - sending, failing (with its last error) and not sent yet. Without it the table is empty.                                                                                                                                                                                                                                                                                                                                                           |
| `?logs=`   | `on`: the project's Your logs is on, checked two minutes before the pinned clock, nothing found yet, so the Events page's Your logs card says On and Open Your logs. `fail`: reading Your logs fails (a 500), on the Events page and on Connections. Without it, Your logs is off (no record yet).                                                                                                                                                                                                                                                                 |
| `?events=` | `one`: the window holds one event - Defender's encoded PowerShell on `web-03`, by `k.morgan@acme-commerce.example` from `203.0.113.30`, twenty minutes before the pinned clock - so its row opens the event's drawer. The drawer's Connected tab asks `POST /security-case/connections` what the event names, answered from Security Operations' records (`web-03`, its staging namesake, Kai Morgan) with the server's own matching rules (`../SecurityOperations/Fixture/ConnectionsFixture.js`).    |

## What the fixture records

`window.__securityEventsEmptyStatesFixture` holds `role`, `latest`, `siem`, `events`,
`listRequests` (analytics lists carry `analytics: true`), `countRequests`,
`aggregateRequests`, `apiRequests` (each with the body it sent), `creates` and `unhandled`.
Anything a page reads that the fixture does not
model (a model table, an analytics query or an API URL), and any create, answers empty and
is listed in `unhandled`; the spec's `afterEach` fails when that list is not empty.

## What the spec covers

`SecurityEventsEmptyStates.spec.ts` (44 tests):

- **Connections, top to bottom**: Your logs, Your security tools, Send to your SIEM; the Your
  logs switch turns the logs on in one press and says when the first check runs, and a
  viewer cannot flip it; Send to your SIEM (and the card's Add destination) opens its form on
  the SIEM step - Google SecOps, Splunk, Microsoft Sentinel and Elastic Security - and Next
  opens that SIEM's own settings alone, what most people leave at its default folded under
  More fields (none for Google SecOps), its test event waiting for the settings; with SIEMs
  (`?siem=rows`) each row says what it is
  sent under its name and how sending goes, and the table fits its card at 1280 and 1440,
  its status never under the sticky actions; dark theme and a phone.

- **Connections empty state**: rendered by the table as its no-items message, inside the
  table card above its Refresh? link and the pagination; header (badge, heading,
  description, Add connection) on one centre line; eight tiles in catalog order, each with its
  category and a Setup guide link (`href` `/docs/integrations/<slug>`, `target="_blank"`);
  every tile built the same way with an icon of its own; the old grey requirements box and
  the Setup guides list are gone.
- **Accessibility**: named regions and lists, each tile's button named "Connect <product>"
  and described by its category, the guide link named for its product; Tab visits each tile
  and then its guide in catalog order; a focused tile shows a 2px indigo ring around the whole
  tile, Enter and Space open the form with that product chosen, and Escape or Cancel hands
  focus back to the tile.
- **Actions**: a click anywhere on a tile (category, blank padding, badge, plus, name) opens
  the real Add connection dialog on the Provider step with exactly that provider
  `aria-checked`, and Next reaches that provider's Connection step and setup guide; the
  picker shows the same icons as the tiles; the hero and card-header Add connection open the
  form with nothing chosen (a tile's choice does not stick); every Setup guide opens a new tab
  on its docs URL and never the form; hovering a tile turns its border, badge and plus indigo.
- **Layout**, beside the side menu from md up, the grid's columns taken from the card's own
  width: at 1440 four tiles a row, one size, every name on one line; 1280 (four columns,
  "Splunk Enterprise Security" wraps), 1024 (two), 768 (one) and 390 (one) with nothing
  wider than the card and no horizontal scroll.
- **Viewer**: disabled hero and header buttons with the gate's sentence under the hero
  button and in its tooltip, "Supported products", static tiles with no buttons and no plus,
  guide links still working and reachable by Tab, and a click on a tile opening nothing.
- **Dark theme**: tiles on the card's dark surface, no white backgrounds on tiles, badges or
  requirements, every text AA-readable, hover still indigo; light theme text meets the same
  contrast.
- **Security Events, when the empty state shows**: with `?latest=pending` the "No security
  events in this time range" message shows first and the empty state only once the newest
  event lookup answers; with `?latest=old` the page says when the newest event arrived and
  never shows the empty state.
- **Security Events empty state**: inside the list card above its pagination, beside the
  filters from md up; header (no OCSF), then the three ways in: Your logs the whole first row
  (what it reads, Turn on Your logs), then the two from other tools as equal cards side by side
  (titles, descriptions, the product categories, `POST /security-events/v1/ingest` as code);
  each card one control named by its action, Tab visiting them in order; Your logs (description,
  formats line, Enter) opens Connections, its switch first, and back returns; with Your logs on
  (`?logs=on`) the card says On, when it last checked, and Open Your logs; a read that fails
  (`?logs=fail`) still offers Open Your logs and claims nothing; Read the setup guide (button,
  description, Enter) navigates to the Setup Guide page and back returns; the Pull card
  (description, categories line) navigates to Connections and its empty state, and back
  returns; the endpoint chip can be clicked, triple-clicked and drag-selected without leaving
  the page.
- **Security Events layout**: dark theme on the list surface; 768 without sideways scroll;
  390, where the facet sidebar folds behind a "Filters" toggle and stacks above the list, so
  the list and its empty state get the page's full width and nothing scrolls sideways.
- **An event's Connected tab** (`?events=one`): the drawer opens on Overview having looked
  nothing up; the Connected tab reads once, with the event's user, host and address and its
  time; `web-03` by the name it reports, its signals on the host and the hour around the
  event (ending by now), its open incidents and monitors; Kai Morgan by email; the staging
  host as a possible match, with why; at 1280 and 390, light and dark, every record whole
  inside the drawer, nothing cut off, every text AA-readable and no white surface in the dark.

Every test pins the clock and puts up a network fence that aborts anything leaving the
fixture server. `afterEach` fails a test on an uncaught page error, on any request the fence
had to abort, on a docs tab no test claimed and on anything in the fixture's `unhandled`.
The only navigation allowed off the fixture server is a Setup guide tab, and only to the one
docs URL its link names.

## Run it

```
cd packages/E2E
npm install
npm run test-security-events-empty-states-ui
```

Playwright reuses a server already listening on port 4232 outside CI. If one from another
checkout might be running, stop it first or run with `CI=1`.

Screenshots (2x) land in `output/playwright/security-events-empty-states-ui/`, named
`*-synthetic.png` because everything in them is fabricated:

| Screenshot                        | What it shows                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `connections-cards-desktop`       | Connections at 1440, full page: Your logs, Your security tools, Send to your SIEM |
| `connections-cards-dark`          | The same in the dark theme                                                        |
| `connections-cards-phone`         | The same at 390                                                                   |
| `connections-siem-picker-desktop` | Send to your SIEM, the form's first step: the four SIEMs                          |
| `connections-siem-form-desktop`   | Send to your SIEM, Splunk's Connection step                                       |
| `connections-siem-rows-desktop`   | Send to your SIEM with three SIEMs, at 1440                                       |
| `connections-desktop`             | Connections at 1440                                                               |
| `connections-tablet`              | Connections at 768                                                                |
| `connections-mobile`              | Connections at 390, full page                                                     |
| `connections-dark`                | Connections in the dark theme                                                     |
| `connections-viewer`              | Connections for a Security Viewer                                                 |
| `connections-preselected-modal`   | Add connection after clicking the CrowdStrike Falcon tile                         |
| `connections-tile-hover`          | The tiles with the pointer on CrowdStrike Falcon                                  |
| `connections-tile-focus`          | The tiles with keyboard focus on CrowdStrike Falcon                               |
| `events-desktop`                  | Security Events at 1440                                                           |
| `events-dark`                     | Security Events in the dark theme                                                 |
| `events-mobile`                   | Security Events at 390, full page                                                 |
| `events-connected-tab-1280`       | An event's drawer on its Connected tab, at 1280                                   |
| `events-connected-tab-1280-dark`  | The same in the dark theme                                                        |
| `events-connected-tab-390`        | The same at 390                                                                   |
| `events-connected-tab-390-dark`   | The same at 390, dark                                                             |

## Poke at it by hand

```
cd packages/E2E
node SecurityEventsEmptyStates/Fixture/server.js --watch
```

then open
`http://127.0.0.1:4232/dashboard/10000000-0000-4000-8000-000000000001/security-events` or
`.../security-events/connections`, adding the scenario parameters above
(`?role=viewer`, `?theme=dark`, `?latest=old`, `?events=one`). `--watch` rebuilds the bundle
when a source file changes; refresh the browser. A browser outside Playwright uses the real
clock, not the pinned one, and nothing stops a Setup guide link from trying to reach the
made-up docs host.

## Not modelled

- Saving a connection: the fixture records a create and lists it as unhandled, so a test that
  submitted the form would fail. The spec only opens, steps through and cancels the form.
- Security events themselves, beyond `?events=one`'s one row: no histogram or facet data,
  so the populated pages are covered elsewhere.
