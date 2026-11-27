# Storage array pages fixture

An offline harness for a storage array's pages: the **Overview** (the
array's health beside its connection, and **Needs attention** by the array's
rules - `Pages/StorageArray/Utils/StorageArrayHealth`: the array's own row
with its open alerts, how full and how slow it is, then each hardware part,
host, pod and file system with why), the **Hosts**, **Replication**,
**Hardware**, **File Systems** and **Buckets** lists (each part's state with
why, its cells coloured at its alerts' lines) and a volume's, a host's, a
file system's and a bucket's own page (its state, where it sits, what about
it needs attention, what is open on it, the alerts that watch it with Turn on
N and its details), each inside the production array layout and side menu
(`packages/App/FeatureSet/Dashboard/src/Pages/StorageArray/View/{Layout,Index,Volumes,VolumeDetail,Hosts,HostDetail,Replication,Hardware,FileSystems,FileSystemDetail,Buckets,BucketDetail}.tsx`).
It bundles the production pages with esbuild, replaces only the `ModelAPI` /
`AnalyticsModelAPI` / `API` / `Realtime` data boundary, and serves them on
`127.0.0.1:4693` (`STORAGE_ARRAY_PAGES_FIXTURE_PORT`). No array, no
database, no sign-in.

```sh
cd packages/E2E
npm run test-storage-array-pages-ui
```

## Dataset

An "Acme Storage" workspace with three arrays:

- `fa-prod-01`, a Pure Storage FlashArray: six volumes (one with a long
  name), six hosts in `vsphere-prod` (`esx-06` unused), two pods replicating
  to remote arrays, two controllers, chassis parts, three drives and two
  network interfaces.
- `fb-prod-01`, a Pure Storage FlashBlade: three file systems (`scratch`,
  `home`, `projects`), a bucket (`logs-archive`, in the `analytics`
  account) and four blades and modules.
- `acme-prod-01`, an array of Acme, a platform that exists only in tests
  (`Common/Tests/Helpers/StorageArray/AcmePlatform.ts`, which the fixture
  registers the way a test does, #11000): two volumes and three aggregates,
  a kind of its own that the Inventory page lists
  (`View/Inventory.tsx`, at `/inventory/Aggregate`).
- `ps-prod-01`, a Dell PowerStore cluster of two appliances (`A1`, `A2`),
  as the agent reads one through Dell's exporter (#11002): six volumes, two
  volume groups, two NAS servers, three file systems, and on each appliance
  its two nodes with their fans, power supplies and batteries, five drives
  and three front-end ports, each part with its appliance. Its appliances,
  volume groups and NAS servers are kinds of its own, at
  `/inventory/Appliance`, `/inventory/VolumeGroup` and `/inventory/NasServer`.
  On the trouble day a drive and a power supply of `A1` failed, a fan and a
  Fibre Channel port of `A2` are down, `nas-files-02` is not started,
  `archive-legacy` is not ready and `fs-home` is 94.5% full; it has no open
  alerts, as a PowerStore sends its own by syslog.

Any route not listed above renders a "Not modelled" stub
(`data-testid="stub-page"`).

## Scenarios

Query parameters on any page:

| Parameter   | Values                                                                                                                                                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `array`     | `trouble` (default): the FlashArray has a critical and a warning alert open, is 92% full and reads at 6.1 ms; the drive in bay 3 failed (its bay critical too), a fan is degraded, `esx-04` reaches it through one controller, `dr-pod` is 95 seconds behind; the FlashBlade's `scratch` has 5% left. `calm`: every part fine |
| `collector` | `disconnected`: the arrays' agents stopped reporting three days ago                                                                                                                                                                                                                                                           |
| `fail`      | `inventory`: every inventory read fails                                                                                                                                                                                                                                                                                       |
| `lang`      | `de` reads the German locale file, `fa` the Persian one (right to left)                                                                                                                                                                                                                                                       |
| `theme`     | `dark` adds `html.dark` (server.js)                                                                                                                                                                                                                                                                                           |

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
