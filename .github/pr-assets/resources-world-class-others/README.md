# Docker, Docker Swarm, Podman, Ceph and Storage Arrays world-class pages

Screenshots for the pull request that brings these resources to the standard of #5490, #5518, #5535 and #5575.
Each is a full page rendered by an offline fixture (`packages/E2E/DockerSwarmPages`, `ContainerHostPages`,
`CephPages`, `StorageArrayPages`: the production layouts, pages, Tailwind, Inter and locale files over made-up
records for "Acme" workspaces). Nothing here is a real customer's data.

| Shot | Page | Width |
| --- | --- | --- |
| swarm-overview-trouble-1280 | Docker Swarm Overview: a node down, a service failing, one short of replicas | 1280 |
| swarm-service-page-1280 | A Swarm service's page | 1280 |
| docker-overview-trouble-1280 | Docker host Overview: a restart loop, a container gone quiet, a restart, memory near its limit | 1280 |
| docker-container-page-1280 | A crash-looping container's page | 1280 |
| ceph-overview-trouble-1280 | Ceph cluster Overview: Ceph's checks, an OSD down but in, full and nearfull OSDs, a monitor out of quorum, pools | 1280 |
| ceph-osd-page-1280 | An OSD's page | 1280 |
| ceph-overview-trouble-german-1024 | Ceph cluster Overview in German beside the side menu | 1024 |
| storage-array-overview-trouble-1280 | FlashArray Overview: alerts, 92% full, slow reads, a failed drive, a host short of a path, a pod behind | 1280 |
| storage-array-host-page-1280 | A FlashArray host's page | 1280 |
| storage-array-overview-trouble-persian-1280 | FlashArray Overview in Persian, right to left | 1280 |

## UI review

Before and after pairs from the review, cropped from the same fixtures at 1280 (`review-*-before.png` is the
builder's page, `review-*-after.png` the reviewed one).

| Pair | What changed |
| --- | --- |
| review-ceph-osd-hero | A down OSD still in the cluster: its placement badge grey, not green beside the red Down |
| review-ceph-osd-out | An OSD up but out: "Out of cluster" once, in its pill, not again in a badge |
| review-swarm-service | A Swarm service: no tasks chip under a pill that counts its replicas, no row of one tab |
| review-swarm-tasks | The Swarm Tasks list fits its card: no Service column, the image folded whole (it breaks after its dots and slashes, never cut at "shop/check"), CPU and Memory in view, memory in MiB as the task's page writes it |
| review-ceph-osds | The Ceph OSDs list fits its card at 1280: no Age column (Ceph sends no OSD's age), so the latency is no longer cut under the View column |
| review-persian-osds | The OSDs list in Persian: each figure in its own direction ("3 / 4 ms", not "ms 4 / 3"; "1.5 TiB / 3.8 TiB", not "TiB / 3.8 TiB ... 1.5") |
| review-persian-pools | The Pools list in Persian: a name as written (".mgr", not "mgr.") |
| review-replication-lag | A FlashArray pod's lag reads the same in its column and under its state ("1 min 35 s", not "1.6 min" beside it) |
| review-ceph-pools | The Ceph Pools list: Objects folds under Stored, so a long pool name is no longer broken mid-word |
| review-docker-attention | Docker's Needs attention: no Container chip on every row, the shared description |
| review-file-system-details | A FlashBlade file system's Details: only what it reported, no rows of dashes |
| review-persian-container | A container's tiles in Persian: "96.0 MB" set apart in its sentence |
| review-persian-details | A container's Details in Persian: each value in its own direction ("8.0 MB", not "MB 8.0"); the fixture now draws dates as production does, in Persian |
