# Ceph pages fixture

An offline harness for a Ceph cluster's pages: the **Overview** (the
cluster's health beside its connection, and **Needs attention** by the
cluster's rules - `Pages/Ceph/Utils/CephHealth`: Ceph's own checks on the
cluster's row, as Ceph names them, then each OSD, monitor and pool with why),
the **OSDs**, **Pools** and **Daemons** lists (each part's status with why,
its cells coloured at its alerts' lines) and an OSD's and a pool's own page
(its state, where it sits, what about it needs attention, its tiles, what is
open on it, the alerts that watch it with Turn on N and its details) - each
inside the production cluster layout and side menu
(`packages/App/FeatureSet/Dashboard/src/Pages/Ceph/View/{Layout,Index,Osds,Pools,Daemons,OsdDetail,PoolDetail}.tsx`).
It bundles the production pages with esbuild, replaces only the `ModelAPI` /
`AnalyticsModelAPI` / `API` / `Realtime` data boundary, and serves them on
`127.0.0.1:4692` (`CEPH_PAGES_FIXTURE_PORT`). No Ceph, no database, no
sign-in.

```sh
cd packages/E2E
npm run test-ceph-pages-ui
```

## Dataset

An "Acme Storage" workspace with one cluster, `ceph-prod`: three hosts
(`ceph-a`, `ceph-b`, `ceph-c`), twelve OSDs, three monitors, two managers,
two metadata servers and an object gateway, and five pools - `.mgr`, `rbd`,
`cephfs_data`, `cephfs_metadata` and a long-named
`default.rgw.buckets.data.archive-eu-central`. The daemons report the
version string Ceph's metadata writes, build hash and all.

Any route not listed above renders a "Not modelled" stub
(`data-testid="stub-page"`).

## Scenarios

Query parameters on any page:

| Parameter   | Values                                                                                                                                                                                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cluster`   | `trouble` (default): Ceph says HEALTH_ERR; an OSD is down but still in, one is past the full ratio, one past nearfull, one writes slowly, one is drained out; a monitor is out of quorum; a pool is nearly full and another has degraded placement groups; a metadata server stopped reporting. `calm`: HEALTH_OK, every part fine |
| `collector` | `disconnected`: the cluster's agent stopped reporting three days ago                                                                                                                                                                                                                                                               |
| `fail`      | `inventory`: every inventory read fails                                                                                                                                                                                                                                                                                            |
| `lang`      | `de` reads the German locale file, `fa` the Persian one (right to left)                                                                                                                                                                                                                                                            |
| `theme`     | `dark` adds `html.dark` (server.js)                                                                                                                                                                                                                                                                                                |

## What the fixture records

`window.__cephPagesFixture` holds every read: `listRequests`, `itemRequests`,
`aggregateRequests`, `apiRequests` and `unhandled` - anything the fixture does
not model. Every test fails on a page error, on a request that leaves
`127.0.0.1`, and on anything in `unhandled`.

Screenshots land in `output/playwright/ceph-pages-ui/*-synthetic.png`.

To look at a page by hand, start the server and open a URL:

```sh
node CephPages/Fixture/server.js
# http://127.0.0.1:4692/dashboard/10000000-0000-4000-8000-000000000001/ceph/38000000-0000-4000-8000-000000000001
```
