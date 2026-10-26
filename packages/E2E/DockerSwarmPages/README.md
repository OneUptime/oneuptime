# Docker Swarm pages fixture

An offline harness for a Docker Swarm cluster's pages on a phone (follow-up of
#5076): the cluster's **Overview** (its hero, and the agent version chip with
the sign beside an agent whose files are behind), a task's page (its
64-character **Container ID** in a summary card) and the **Metrics** tab (the
metrics list's rows) - each inside the production cluster layout and side menu
(`packages/App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/{Layout,Index,TaskDetail,Metrics}.tsx`).
It bundles the production pages with esbuild, replaces only the `ModelAPI` /
`AnalyticsModelAPI` / `API` / `Realtime` data boundary, and serves them on
`127.0.0.1:4637` (`DOCKER_SWARM_PAGES_FIXTURE_PORT`). No Docker, no database,
no sign-in.

```sh
cd packages/E2E
npm run test-docker-swarm-pages-ui
```

## Dataset

An "Acme Swarm" workspace with one cluster, `swarm-prod`: two nodes (a manager
and a worker), two services in the `shop` stack, three running tasks - one of
them, `shop_checkout.1`, with a 64-character Container ID - a stack and an
overlay network. Its agent sends five container metrics, named as the metric
catalog names them, the longest `container.blockio.io_service_bytes_recursive`;
each one's sparkline swings around a level of its own (CPU about 3.4%, memory
about 175 MiB).

Lists are filtered on the query's plain values and `Includes`, and sorted the
way the server sorts them. Any route not listed above renders a "Not modelled"
stub (`data-testid="stub-page"`).

## Scenarios

Query parameters on any page:

| Parameter | Values                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `agent`   | `old` (default: `0.161.0`, the files before #5076's CPU fix), `current` (`0.161.1`, the files this release ships), `none` |
| `lang`    | `de` reads the German locale file                                                                                         |
| `theme`   | `dark` adds `html.dark` (server.js)                                                                                       |

## What the fixture records

`window.__dockerSwarmPagesFixture` holds every read: `listRequests`,
`itemRequests`, `aggregateRequests`, `apiRequests` and `unhandled` - anything
the fixture does not model. Every test fails on a page error, on a request that
leaves `127.0.0.1`, and on anything in `unhandled`.

Screenshots land in `output/playwright/docker-swarm-pages-ui/*-synthetic.png`.

To look at a page by hand, start the server and open a URL:

```sh
node DockerSwarmPages/Fixture/server.js
# http://127.0.0.1:4637/dashboard/10000000-0000-4000-8000-000000000001/docker-swarm/62000000-0000-4000-8000-000000000001/metrics
```
