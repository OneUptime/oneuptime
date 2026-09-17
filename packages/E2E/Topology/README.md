# Topology UI regression tests

Run from `E2E`:

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
navigation, filtering, graph layout, React Flow nodes, network drawing, and
details panels are the production implementations. The fixture includes sixty
Kubernetes pods, multiple clusters, isolated resources, an unresolved relationship
endpoint, eight services (including two without dependencies), three sites, and
network devices with different health states. The data is entirely synthetic.

The tests cover infrastructure drilldown, search/reset, filtered unresolved map
nodes, service directory/focus, network map options/reset, keyboard tabs, and
phone-width overflow. They complement the authenticated tests in
`Tests/Dashboard/Topology.spec.ts`; they do not test API authorization or ingestion.

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
server, or starts one itself when the port is free.
