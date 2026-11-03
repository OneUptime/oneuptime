# Container host pages fixture

An offline harness for a Docker and a Podman host's pages: the **Overview**
(the host's health beside its connection, and **Needs attention** by the
containers' rules - `Components/ContainerHost/ContainerHostHealth`), the
**Containers** list (each container's state with why, its restarts and when
it last started) and a container's own page (its state, where it runs, what
on it needs attention, what it uses, what is open on it, the container alerts
with Turn on N and its details) - each inside the production host layout and
side menu
(`packages/App/FeatureSet/Dashboard/src/Pages/{Docker,Podman}/View/{Layout,Overview,Containers,ContainerDetail}.tsx`).
It bundles the production pages with esbuild, replaces only the `ModelAPI` /
`AnalyticsModelAPI` / `API` / `Realtime` data boundary, and serves them on
`127.0.0.1:4691` (`CONTAINER_HOST_PAGES_FIXTURE_PORT`). No Docker, no
database, no sign-in.

```sh
cd packages/E2E
npm run test-container-host-pages-ui
```

## Dataset

An "Acme Containers" workspace with a Docker host, `web-01`, and a Podman
host, `web-02`, running the same seven containers: the shop's checkout API, a
worker its restart policy restarted six times in 15 minutes (an alert is open
on it), a search node using 91% of its memory, a cache that restarted once, a
billing exporter that ran for six hours and stopped reporting seven minutes
ago, a `docker compose run` migration that finished, and the agent itself.

Any route not listed above renders a "Not modelled" stub
(`data-testid="stub-page"`).

## Scenarios

Query parameters on any page:

| Parameter   | Values                                                                                  |
| ----------- | --------------------------------------------------------------------------------------- |
| `host`      | `trouble` (default: the seven above), `calm` (every container fine), `empty` (none yet) |
| `collector` | `disconnected`: the host's agent stopped reporting three days ago                       |
| `fail`      | `readings`: every latest-readings read fails                                            |
| `lang`      | `de` reads the German locale file, `fa` the Persian one (right to left)                 |
| `theme`     | `dark` adds `html.dark` (server.js)                                                     |

## What the fixture records

`window.__containerHostPagesFixture` holds every read: `listRequests`,
`itemRequests`, `aggregateRequests`, `apiRequests` and `unhandled` - anything
the fixture does not model. Every test fails on a page error, on a request
that leaves `127.0.0.1`, and on anything in `unhandled`.

Screenshots land in `output/playwright/container-host-pages-ui/*-synthetic.png`.

To look at a page by hand, start the server and open a URL:

```sh
node ContainerHostPages/Fixture/server.js
# http://127.0.0.1:4691/dashboard/10000000-0000-4000-8000-000000000001/docker/72000000-0000-4000-8000-000000000001
```
