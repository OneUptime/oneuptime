# Resource overviews fixture

An offline harness for the Overviews drawn with `ResourceOverview` (#5298's UI
review): a service's, a database's and a queue's, each inside its production
layout - the page's header with its labels, the side menu
(`packages/App/FeatureSet/Dashboard/src/Pages/{Service,Database,MessageQueue}/View/`).
It bundles the production pages with esbuild, replaces only the `ModelAPI` /
`AnalyticsModelAPI` / `API` / `Realtime` data boundary, and serves them on
`127.0.0.1:4643` (`RESOURCE_OVERVIEWS_FIXTURE_PORT`). No Docker, no database, no
sign-in.

```sh
cd packages/E2E
npm run test-resource-overviews-ui
```

## What it checks

- The Details card ends with the record's ID line (no "Service ID",
  "Database ID" or "Queue ID" row), and links to the resource's Settings page.
- The labels are a phone's card only: from 640px the page's header lists them.
- A long value wraps inside its row, a name after its own dots and slashes;
  words are set in words, reported values in monospace.
- The description is the hero's line, under the name, two lines at most.
- The hero's controls wrap under the title to the row's end from 768px (to its
  other end right to left), and sit beside the title at 1280.
- Dark, German, and nothing read that the fixture does not model.

## Dataset

An "Acme Commerce" workspace with one service (`checkout-api`), one PostgreSQL
database (`orders-db`, found in its applications' traces, one endpoint) and one
Kafka queue (`orders.checkout-completed`). Telemetry is a smooth series over the
last half hour, the same for every aggregate; the logs and exceptions charts
are empty, Security Events is not in use, and the database has no AI agent.

## Scenarios

Query parameters on any page:

| Parameter  | Values                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resource` | `busy` (default: a description, three labels, every fact reported), `new` (a name and nothing else), `long` (a long description, long values, five labels) |
| `lang`     | `de` or `fa` reads the German or Persian locale file                                                                                                       |
| `theme`    | `dark` adds `html.dark` (server.js)                                                                                                                        |
| `dir`      | `rtl` lays the page out right to left                                                                                                                      |

## What the fixture records

`window.__resourceOverviewsFixture` holds every read: `listRequests`,
`itemRequests`, `countRequests`, `aggregateRequests`, `apiRequests` and
`unhandled` - anything the fixture does not model. Every test fails on a page
error, on a request that leaves `127.0.0.1`, and on anything in `unhandled`.

Screenshots land in `output/playwright/resource-overviews-ui/*-synthetic.png`.

To look at a page by hand, start the server and open a URL:

```sh
node ResourceOverviews/Fixture/server.js
# http://127.0.0.1:4643/dashboard/10000000-0000-4000-8000-000000000001/service/71000000-0000-4000-8000-000000000001
# http://127.0.0.1:4643/dashboard/10000000-0000-4000-8000-000000000001/databases/73000000-0000-4000-8000-000000000001
# http://127.0.0.1:4643/dashboard/10000000-0000-4000-8000-000000000001/queues/74000000-0000-4000-8000-000000000001
```
