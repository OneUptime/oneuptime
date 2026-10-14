# Security operations fixture

An offline harness for the Security Events SOC pages, on a month of synthetic security work:

| Page | Route (from `RouteMap`) | Production components |
|---|---|---|
| Overview | `SECURITY_EVENTS_OVERVIEW` `/dashboard/:projectId/security-events/overview` | `Pages/SecurityEvents/{Layout,Overview}`, `SecurityOverview/*` |
| Security Cases | `SECURITY_CASES` `.../security-events/cases` | `Pages/SecurityEvents/Cases`, `SecurityCasesTable` inside `ModelTable` |
| A case | `SECURITY_CASE_VIEW` `.../security-events/cases/:id` | `Pages/SecurityEvents/CaseView`, `SecurityCase/*`, `EventNotes`, `SecurityPlaybookRunCard` |
| Entities | `SECURITY_EVENTS_ENTITIES` `.../security-events/entities` | `Pages/SecurityEvents/Entities` |
| Rule Library | `SECURITY_EVENTS_RULE_LIBRARY` `.../security-events/rule-library` | `Pages/SecurityEvents/RuleLibrary` |
| ATT&CK Coverage | `SECURITY_EVENTS_ATTACK_COVERAGE` `.../security-events/attack-coverage` | `Pages/SecurityEvents/AttackCoverage` |
| Playbooks | `SECURITY_PLAYBOOKS` `.../security-events/playbooks` | `Pages/SecurityEvents/Playbooks` |
| A playbook | `SECURITY_PLAYBOOK_VIEW` `.../security-events/playbooks/:id` | `Pages/SecurityEvents/PlaybookView`, `SecurityPlaybookStepsEditor` |
| Playbook Runs | `SECURITY_PLAYBOOK_RUNS` `.../security-events/playbook-runs` | `Pages/SecurityEvents/PlaybookRuns` |

`Fixture/server.js` bundles the production layout (breadcrumbs, the Security Events side menu) and
the pages with esbuild, serves them with the same Tailwind build, `tailwind.config`, Inter font and
`Theme.css` production uses, and listens on `127.0.0.1:4234` (`SECURITY_OPERATIONS_FIXTURE_PORT`).
No Docker, no database, no sign-in.

## What is real and what is stubbed

Real: the layout and side menu, every page above, the tables, cards, charts, the case header and
status steps, the playbook step editor and run cards, the approval dialog, `PermissionGate`, and
the overview's numbers: the fixture answers `POST /security-case/overview` with what
`computeSecurityOverviewMetrics` (the function the server calls) works out from its own rows.

Stubbed:

- The data boundary: `ModelAPI` and `API` answer from in-memory tables, filtered by the queries the
  pages send (`Includes`, `IsNull`, equality) and sorted. `POST /security-case/top-entities`,
  `/security-case/entity-activity` and `/security-playbook-run/:id/approve|reject` answer as the
  server would; approving the held step runs the rest of its playbook at once.
- The signed-in user ("Maya Chen" of a generic "Acme Commerce" workspace), her teammates and her
  permissions. Profile pictures are drawn as initials. The fixture header says the data is
  synthetic ("Preview workspace · Synthetic data"). Every name, domain and address is made up
  (`*.example` domains, documentation IP ranges).
- Realtime: nothing pushes changes.
- The side menu's other pages (Events' neighbours Correlate, Detection Rules, Threat Intel,
  Monitors, Connections, Setup Guide) render a small stub page.

The clock is pinned: the spec fixes the browser clock to `2026-10-14T12:00:00Z`, and the month of
history is laid out from it with a seeded generator, so every run draws the same pages.

## Scenarios

| Parameter | Values |
|---|---|
| `?theme=` | `dark` adds `html.dark` (done in `server.js`, before the bundle runs) |
| `?empty=` | `1`: a project that has set nothing up - no cases, detections, playbooks or rules |
| `?role=` | `owner` (default) or `viewer`: Security Viewer only, so it reads but cannot decide a held step |

## What the fixture records

`window.__securityOperationsFixture` holds `getItemRequests`, `listRequests`, `countRequests`,
`apiRequests`, `realtimeSubscriptions`, `creates`, `updates`, `deletes` and `unhandled`. Anything a
page reads that the fixture does not model lands in `unhandled`; the spec's `afterEach` fails when
that list is not empty.

## What the spec covers

`SecurityOperations.spec.ts`:

- **Overview**: what needs someone now, each count in words that agree with it ("1 playbook step");
  the KPIs and the queue's counts from the same rows; the two routes it reads; dark theme; a project
  with nothing yet sees the three steps that set it up.
- **The case queue**: the open cases, each with what raised it and what it is about; the views
  (unassigned, mine, closed); at 1440 every column fits the card beside the side menu; at 1024 and
  390 nothing runs off the page and the header's search stays inside the card.
- **A case**: header, status steps, detections, the held run with Approve and Reject, timeline,
  entities, ATT&CK and notes; approving the held step posts the decision with its comment and the
  run finishes; a Security Viewer cannot decide it; dark theme and a phone.
- **Playbooks**: the list (steps, status, trigger and minimum priority) fits its card; a playbook's
  settings read in full; its steps and latest runs; the runs page opens on the runs waiting for
  approval and lists every run under All Runs.
- **Detections**: ATT&CK coverage counts what the enabled rules cover and its matrix scrolls inside
  its card; the rule library marks the rules the project has; entities ranks what the findings name.
- **Every page at 1280, 1024, 768 and 390**: none scrolls sideways.

Every test pins the clock and puts up a network fence that aborts anything leaving the fixture
server; `afterEach` fails a test on an uncaught page error, an aborted request, or anything in the
fixture's `unhandled`.

## Run it

```
cd packages/E2E
npm install
npm run test-security-operations-ui
```

Playwright reuses a server already listening on port 4234 outside CI. If one from another checkout
might be running, stop it first or run with `CI=1`.

Screenshots (2x) land in `output/playwright/security-operations-ui/`, named `*-synthetic.png`
because everything in them is fabricated: `overview-desktop`, `overview-dark`, `overview-empty`,
`cases-desktop`, `cases-tablet`, `cases-mobile`, `case-desktop`, `case-dark`, `case-mobile`,
`playbooks-desktop`, `playbook-desktop`, `playbook-runs-desktop`, `attack-coverage-desktop`,
`rule-library-desktop` and `entities-desktop`.

## Poke at it by hand

```
cd packages/E2E
node SecurityOperations/Fixture/server.js --watch
```

then open `http://127.0.0.1:4234/dashboard/10000000-0000-4000-8000-000000000001/security-events/overview`,
adding the scenario parameters above. `--watch` rebuilds the bundle when a source file changes;
refresh the browser. A browser outside Playwright uses the real clock, so the history is laid out
from today.
