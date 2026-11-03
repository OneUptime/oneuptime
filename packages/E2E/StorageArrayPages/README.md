# Storage array pages fixture

An offline harness for a storage array's pages: the **Overview** (the
array's health beside its connection, and **Needs attention** by the array's
rules - `Pages/StorageArray/Utils/StorageArrayHealth`: the array's own row
with its open alerts, how full and how slow it is, then each hardware part,
host, pod and file system with why), the **Hosts**, **Replication**,
**Hardware** and **File Systems** lists (each part's state with why, its
cells coloured at its alerts' lines) and a volume's, a host's and a file
system's own page (its state, where it sits, what about it needs attention,
what is open on it, the alerts that watch it with Turn on N and its details)
- each inside the production array layout and side menu
(`packages/App/FeatureSet/Dashboard/src/Pages/StorageArray/View/{Layout,Index,Volumes,VolumeDetail,Hosts,HostDetail,Replication,Hardware,FileSystems,FileSystemDetail}.tsx`).
It bundles the production pages with esbuild, replaces only the `ModelAPI` /
`AnalyticsModelAPI` / `API` / `Realtime` data boundary, and serves them on
`127.0.0.1:4693` (`STORAGE_ARRAY_PAGES_FIXTURE_PORT`). No array, no
database, no sign-in.

```sh
cd packages/E2E
npm run test-storage-array-pages-ui
```

## Dataset

An "Acme Storage" workspace with two arrays:

- `fa-prod-01`, a Pure Storage FlashArray: six volumes (one with a long
  name), six hosts in `vsphere-prod` (`esx-06` unused), two pods replicating
  to remote arrays, two controllers, chassis parts, three drives and two
  network interfaces.
- `fb-prod-01`, a Pure Storage FlashBlade: three file systems (`scratch`,
  `home`, `projects`), a bucket and four blades and modules.

Any route not listed above renders a "Not modelled" stub
(`data-testid="stub-page"`).

## Scenarios

Query parameters on any page:

| Parameter   | Values                                                                                                                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `array`     | `trouble` (default): the FlashArray has a critical and a warning alert open, is 92% full and reads at 6.1 ms; the drive in bay 3 failed (its bay critical too), a fan is degraded, `esx-04` reaches it through one controller, `dr-pod` is 95 seconds behind; the FlashBlade's `scratch` has 5% left. `calm`: every part fine |
| `collector` | `disconnected`: the arrays' agents stopped reporting three days ago                                                                                                                                                                                                         |
| `fail`      | `inventory`: every inventory read fails                                                                                                                                                                                                                                      |
| `lang`      | `de` reads the German locale file, `fa` the Persian one (right to left)                                                                                                                                                                                                      |
| `theme`     | `dark` adds `html.dark` (server.js)                                                                                                                                                                                                                                          |

## What the fixture records

`window.__storageArrayPagesFixture` holds every read: `listRequests`,
`itemRequests`, `aggregateRequests`, `apiRequests` and `unhandled` - anything
the fixture does not model. Every test fails on a page error, on a request
that leaves `127.0.0.1`, and on anything in `unhandled`.

Screenshots land in `output/playwright/storage-array-pages-ui/*-synthetic.png`.

To look at a page by hand, start the server and open a URL:

```sh
node StorageArrayPages/Fixture/server.js
# http://127.0.0.1:4693/dashboard/10000000-0000-4000-8000-000000000001/storage-arrays/58000000-0000-4000-8000-000000000001
```
