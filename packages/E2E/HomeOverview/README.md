# Home overview fixture

An offline harness for the real dashboard Home page:

| Page | Route (from `RouteMap`)          | Production components                                                                                                                                                                                                                                                              |
| ---- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home | `HOME` `/dashboard/:projectId/home/` | `Pages/Home/{Layout,Home}` and every card they mount: `Components/Home/HomeCommandBar`, `ProjectHealthCard` (with `OverviewStats`), `GettingStarted` (with `HowOneUptimeWorks`), `NeedsAttention`, `ProjectResources`, `UpcomingMaintenance` and `ExploreProducts` |

`Fixture/server.js` bundles the production layout and page with esbuild, serves them with the
same Tailwind build, `tailwind.config` and `Theme.css` production uses, and listens on
`127.0.0.1:4224` (`HOME_OVERVIEW_FIXTURE_PORT`). No Docker, no database, no sign-in. Only the
`ModelAPI` / `API` data boundary and the signed-in user are replaced. The locale files are the
real `en.json` and `de.json`.

Every record is fabricated for a generic "Acme Commerce" workspace, and the fixture header says
so ("Preview workspace · Synthetic data"). The clock is pinned: all dates are relative to
`2026-10-13T12:00:00Z`, and the spec fixes the browser clock to the same instant.

## What is modelled

- **States and severities**: incident states Investigating, Identified and Resolved (SEV-1 to
  SEV-3); alert states Identified, Acknowledged and Resolved (Critical, High, Low); monitor
  statuses Operational, Degraded and Offline; maintenance states Scheduled, Ongoing, Ended and
  Completed.
- **Monitors**: eleven, plus an archived one frozen Offline that is never counted or listed.
- **Incidents and alerts**: the open ones of each scenario, and a resolved one of each that
  Home never shows.
- **SLOs**: Checkout availability and Search latency, burning in the busy scenario; API
  availability, always healthy; a disabled and an archived one, never counted as burning.
- **Maintenance**: a window in progress, three coming up (none in `quiet`), and a completed one.
- **Resources**: 2 status pages, 3 on-call policies, 8 services and 4 dashboards (each with an
  archived one that is not counted), no workflows, and 6 team members (1 in a new project).

Every count and list is answered by an in-memory evaluator of the very query the page builds
(`Includes`, nested relation filters, `isArchived`, sorts and limits), so the numbers are what
the queries mean.

Pages Home links to are not modelled: Home's own lists render a stub inside the Home layout
(`data-testid="stub-page"`, `data-page="<PageMap key>"`), and every other page a stub of its own
with its path. The Search box's event is counted (`paletteToggles`) instead of opening the
command palette.

## Scenarios

| Parameter    | Values                                                                                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?scenario=` | `busy` (default: 2 open incidents, 3 open alerts, 2 monitors not operational, 2 SLOs burning, 1 maintenance window in progress and 3 coming up), `healthy` (nothing open, 1 window coming up), `quiet` (healthy with nothing scheduled: the all-clear beside Your project alone), `attention` (alerts, a degraded monitor and an SLO at risk, no incident), `maintenance` (only a window in progress), `new` (a project made a minute ago), `many` (busy with 9 open incidents) |
| `?role=`     | `owner` (default, ProjectOwner), `viewer` (may read, may create nothing)                                                                                                                                                                                                                    |
| `?fail=`     | comma separated: `overview` (every Incident list fails, so Home's batch does), `overview-once` (only the first one does), `resources` (every Status Page count fails), `upcoming` (the upcoming maintenance list fails)                                                                    |
| `?lang=`     | `de` reads the German locale file                                                                                                                                                                                                                                                           |
| `?theme=`    | `dark` adds `html.dark`                                                                                                                                                                                                                                                                     |

## What the spec covers

`HomeOverview.spec.ts`:

- **A busy project**: the red headline and its sentence, "Updated just now", the five numbers
  (archived monitors and disabled or archived SLOs left out) and their status lines; the open
  work in urgency order with its "9 open" total, an incident row's number, severity, state and
  age, a monitor row, an SLO with no budget left, a window that ends in 40 minutes, and a row
  opening its incident; a number opening Home's own Active Incidents, which has the side menu the
  overview leaves out, and its Overview leading back; Your
  project's counts with Set up for workflows; the three windows coming up, soonest first; two
  columns at 1440px; Explore opening on Essentials, a tab click and the arrow keys.
- **Search and create**: the search box opens the palette by mouse and by keyboard; Declare
  Incident and the Create menu's three items, one opening Create Monitor; a viewer gets no
  create actions.
- **The verdicts**: healthy ("All systems operational", "11 monitors are operational..."),
  needs attention ("4 issues need attention"), maintenance in progress, a new project (the
  checklist under the headline, every resource to set up, no maintenance card) and more open
  incidents than a group shows ("View all 9").
- **Failures and Refresh**: the batch failing shows the card's error and never a strip of zeros,
  and the list says it could not be loaded and points at Try again; Try again recovering; a resource count the role may not read losing only its row; the upcoming
  list failing leaving out its card; Refresh reading again without blanking the page.
- **The requests**: one list per open kind, five rows each, the upcoming card's three, soonest
  first, and the two set-up totals.
- **Screens and themes**: 390px (one column, nothing wider than the screen), 768px (the numbers
  two to a row) and the dark theme (every card on a dark surface).
- **The row under the health card**: at 1440px and 1280px, in every scenario (quiet, healthy,
  maintenance, attention, busy, many, many with nothing coming up, new, the batch failing, German
  and dark), Needs attention and the side column's last card end on one line, with Explore 20px
  under it; all clear, a new project's "Problems will show up here" and a failed list sit in the
  middle of their card; a short list keeps its rows at the top; at 1440px and 1920px the dividers
  under Needs attention's and Your project's headers run on one line; with the open work the taller side,
  Upcoming maintenance runs down to its end while Your project keeps its rows' height; below xl
  (1024px, 768px, 390px) the cards stack, each as tall as what it holds.

`afterEach` fails a test on an uncaught page error, on any request the fixture does not model,
and on any request the network fence had to abort.

## Run it

```
cd packages/E2E
npm install
npm run test-home-overview-ui
```

Playwright reuses a server already listening on port 4224 outside CI. If one from another
checkout might be running, give this run a port of its own (the config, `server.js` and the
spec's network fence all read it):
`HOME_OVERVIEW_FIXTURE_PORT=4724 CI=1 npm run test-home-overview-ui`.

Screenshots land in `output/playwright/home-overview-ui/`, named `*-synthetic.png` because every
record in them is fabricated.

## Poke at it by hand

```
cd packages/E2E
node HomeOverview/Fixture/server.js --watch
```

then open `http://127.0.0.1:4224/dashboard/10000000-0000-4000-8000-000000000001/home/` and add
the query parameters above. `--watch` rebuilds the bundle when a source file changes; refresh
the browser. A browser outside Playwright shows relative times against the real clock, not the
pinned one, and remembers a finished or dismissed checklist in its local storage.
