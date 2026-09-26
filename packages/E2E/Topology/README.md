# Topology UI regression tests

Run from `packages/E2E`:

```sh
npm run test-topology-ui
```

The dedicated Playwright configuration builds the real `TopologyPage` and its
production components with the shared frontend esbuild configuration. The page is
mounted inside the Inventory layout (`Pages/Inventory/Layout.tsx`), exactly as
`App.tsx` mounts it, because that layout owns the "Topology" title and side menu. A small
server listens on `127.0.0.1:4199`; Docker, sign-in, ingestion, and external
services are not required. Install the repository dependencies and Playwright's
Chromium browser before running.

`Fixture.js` replaces only the `ModelAPI` and `API` data boundary. All page
navigation, the Topology API client and its decoders, filtering, graph layout,
React Flow nodes, network drawing, and details panels are the production
implementations. The fixture includes sixty Kubernetes pods, multiple clusters,
isolated resources, an unresolved relationship endpoint, eight services
(including two without dependencies), a fleet of 1,250 IoT devices, three sites,
and network devices with different health states. The data is entirely
synthetic. `Datasets.js` adds two self-hosted estates, selected with
`?dataset=selfHostedLegacy` or `?dataset=selfHostedDiscovered`.

## The Topology API in the fixture

The maps and the details panel read the Topology API
(`POST /api/telemetry/topology/...`, see `Common/Types/Topology/TopologyApi.ts`).
The fixture keeps its data as inventory rows and answers those routes in the
browser with `TopologyApiFixture.js`:

- every request body is parsed with the server's own
  `Common/Server/Utils/Topology/TopologyRequest.ts`, so a request the real
  router would refuse gets the same 400 here;
- the Service Map, Infrastructure and details payloads come from the reference
  implementation the server's SQL is differential-tested against
  (`Common/Tests/Server/Utils/Topology/TopologyReference.ts`), so containers,
  placements, runs-on counts and drawer sections follow the documented
  semantics rather than a fixture-only copy of them;
- the IoT fleet is larger than `TopologyApiLimits.InlineFlatItemsPerType`, so
  it arrives as a collection: exact counts in the Infrastructure payload, items
  paged from `/infrastructure/collection`, and search counts from
  `/infrastructure/collection-search`.

A Topology route the fixture does not know is answered with a 404 (which the
page reports as "Topology was updated") and recorded, never with an empty
default. After every test the spec checks that no request was refused or
unhandled, that no "Topology was updated" message is on screen, and that the
browser never listed `InventoryItem` or `InventoryItemRelationship` rows.
`window.__topologyFixtureRequests` holds every stubbed call for the specs to
inspect. A spec can make a route fail before the page loads by setting
`window.__topologyFixtureFailures = [{ path, status, times }]` from an init
script (see the busy-server test).

## Coverage

The tests cover infrastructure drilldown, search/reset, the IoT collection
(paging, server-side search, details), details panel paging ("Show more") and
undiscovered endpoints, service directory/focus, refresh (`fresh` requests), a
busy server (429) with retry, network map options/reset, keyboard tabs, and
phone-width overflow. They complement the authenticated tests in
`Tests/Dashboard/Topology.spec.ts`; they do not test API authorization,
ingestion or the SQL itself (the Postgres suites under
`Common/Tests/Server/Utils/Topology` do).

## Screenshots

Screenshots are saved to `output/playwright/topology/` at the repository root.
Names end in `-synthetic.png`, and the preview includes a synthetic-data banner,
so these images can be attached to a public PR without exposing a real project.
Failed-test screenshots and traces are in the adjacent `test-results` folder.
Generated bundles also stay under this output directory.

To inspect the actual UI manually:

```sh
node Topology/server.js
```

Then open
`http://127.0.0.1:4199/dashboard/10000000-0000-4000-8000-000000000001/topology/overview?tab=Infrastructure`.
The server builds once on startup. Restart it after changing production components
before capturing final screenshots. Playwright reuses an existing local fixture
server, or starts one itself when the port is free. The synthetic records were
last seen on 7 September 2026 (the tests pin the browser clock to that day), so
in a manual session with a real clock most discovered resources are inactive;
tick "Show inactive" or pick a longer time range.
