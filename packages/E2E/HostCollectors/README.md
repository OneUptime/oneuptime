# Host collectors fixture

An offline harness for adding hosts the way OneUptime does it by default (one command on the
host) and for the collectors OneUptime manages on them.

| Page                    | Route (from `RouteMap`)                                                  | Production components                                    |
| ----------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| Hosts, Add Host         | `HOSTS` `/dashboard/:projectId/host`                                     | `Pages/Host/Layout` and `Pages/Host/Hosts`               |
| Collector Configs       | `HOST_COLLECTOR_CONFIGS` `/dashboard/:projectId/host/collector-configs`  | `Pages/Host/CollectorConfigs`                            |
| A Collector Config      | `HOST_COLLECTOR_CONFIG_VIEW` `.../collector-configs/:id`                 | `Pages/Host/CollectorConfigView`                         |
| Hosts > Documentation   | `HOST_DOCUMENTATION` `/dashboard/:projectId/host/documentation`          | `Pages/Host/Documentation`                               |
| A host's Collector page | `HOST_VIEW_DOCUMENTATION` `/dashboard/:projectId/host/:id/documentation` | `Pages/Host/View/Layout` and `Pages/Host/View/Collector` |

Run from `packages/E2E`:

```sh
npm run test-host-collectors-ui
```

`Fixture/server.js` bundles the production layouts and pages with esbuild, serves them with the
same Tailwind build, `tailwind.config`, `Theme.css` and Inter production uses, and listens on
`127.0.0.1:4371` (`HOST_COLLECTORS_FIXTURE_PORT`). No Docker, no database, no sign-in. Only the
`ModelAPI` / `API` data boundary and the signed-in user are replaced, and a save of a config's
YAML is checked by the real `HostCollectorConfigPolicy`, as the server checks it, so a refused
save shows the server's own words. The locale files are the real `en.json` and `de.json`.
Every record is fabricated for an "Acme Infrastructure" workspace.

## Scenarios

Picked with query parameters:

- `hosts=none`: the project has no host (four by default: web-01 runs the "Web servers" config,
  db-01's config failed, win-01 reports a collector error on OneUptime's Windows default,
  legacy-01 was set up by hand).
- `configs=none`: no Collector Config (two by default: "Web servers" for Linux hosts with
  env:production, at version 2, and "Windows servers").
- `keys=none`: no ingestion key (one by default).
- `role=member`: a Project Member, who may read configs but not change them.
- `lang=de`, `theme=dark`.

`window.__hostCollectorsFixture.register(name, osType)` is the one command running on a host:
its collector registers, as a new host or, for a host of that name, handing that host over.
The spec installs Playwright's clock before the page loads and moves it on by the last step's
5 seconds to see the page look again.

What the pages send is recorded on `window.__hostCollectorsFixture` (`creates`, `updates`,
`deletes`) with every read and `unhandled` for anything the fixture does not model; the spec
fails on an unhandled request, on an uncaught page error and on any request that leaves the
fixture server. Screenshots are written to `output/playwright/host-collectors-ui/`.
