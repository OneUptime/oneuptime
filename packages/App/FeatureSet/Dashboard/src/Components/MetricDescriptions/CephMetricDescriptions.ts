/*
 * What each number on the Ceph cluster pages means, in plain words. Shown in
 * the (i) tooltip beside a tile, card, chart, summary field or column title.
 *
 * Each text describes what the page actually computes, not what the title
 * might suggest:
 *
 *   - Counts (OSDs, monitors, pools), health and the Clusters list capacity
 *     come from the latest data the cluster sent, not from a time range.
 *   - The Capacity Used tile uses the latest readings and ignores the chart
 *     time range; its projection fits the last 24 hours.
 *   - Problem PGs and the placement-group bar use the last 10 minutes, and a
 *     group that is both degraded and undersized is counted in both.
 *   - Pool STORED is the data clients wrote, before replication copies.
 *   - The Pools list IOPS columns always average the last 15 minutes.
 *   - List and detail values older than 15 minutes show as a dash.
 *   - The OSD list's Age is how long OneUptime has had the OSD in its
 *     inventory (the row's createdAt), not anything Ceph reports. While the
 *     cluster stays connected, a row missing from the data for 15 minutes is
 *     pruned (Workers/Jobs/Ceph/CleanupStaleResources) and re-created when
 *     the OSD returns, which restarts the clock.
 *
 * Change the fetch, change the words.
 */

export type CephMetric =
  // Cluster overview (Pages/Ceph/View/Index.tsx), also the Clusters list
  | "inventoryCounts"
  | "health"
  | "activeHealthChecks"
  | "capacityUsed"
  | "osdsUp"
  | "monsInQuorum"
  | "pools"
  | "problemPgs"
  | "osdStates"
  | "osdUpIn"
  | "osdUpOut"
  | "osdDownIn"
  | "osdDownOut"
  | "pgStates"
  | "clientIops"
  | "clientThroughput"
  | "largestPools"
  | "fullestPools"
  // OSD list (Pages/Ceph/View/Osds.tsx)
  | "osdStatusColumn"
  | "osdInOutColumn"
  | "osdUsedColumn"
  | "osdPgsColumn"
  | "osdLatencyColumn"
  | "osdAgeColumn"
  // OSD detail (Pages/Ceph/View/OsdDetail.tsx)
  | "osdStatus"
  | "osdPlacement"
  | "osdUsed"
  | "osdPlacementGroups"
  | "osdLatency"
  // Pool list (Pages/Ceph/View/Pools.tsx)
  | "poolStoredColumn"
  | "poolMaxAvailColumn"
  | "poolUsedColumn"
  | "poolObjectsColumn"
  | "poolReadIopsColumn"
  | "poolWriteIopsColumn"
  // Pool detail (Pages/Ceph/View/PoolDetail.tsx)
  | "poolStored"
  | "poolMaxAvail"
  | "poolUsed"
  | "poolGrowth"
  | "poolObjects"
  | "poolClientIops"
  | "poolClientThroughput"
  // Daemons (Pages/Ceph/View/Daemons.tsx)
  | "daemonStatus"
  // Clusters list (Pages/Ceph/Clusters.tsx)
  | "clusterOsds"
  | "clusterMons"
  | "clusterCapacity";

export const CEPH_METRIC_DESCRIPTIONS: Record<CephMetric, string> = {
  inventoryCounts:
    "Counts from the cluster's latest data, not a time range: OSDs (the daemons that store data) that are up out of all OSDs, monitors in quorum out of all known monitors (only the monitor count when quorum is not reported), and pools.",
  health:
    "Ceph's own health verdict from the cluster's latest data: OK, Warning (WARN) when something needs attention, or Error (ERR) when data availability or safety is at risk. Unknown means no health data has arrived yet.",
  activeHealthChecks:
    "The named problems, such as OSD_DOWN or PG_DEGRADED, that were still raised in the latest data Ceph sent in the last 10 minutes, with how serious each one is. They explain why the cluster's health is not OK.",
  capacityUsed:
    "Share of the cluster's raw disk space in use, counting every copy of your data, from the latest readings rather than the chart time range. The subtitle projects the last 24 hours' growth to 85%, Ceph's default nearfull warning level.",
  osdsUp:
    "OSDs are the daemons that store your data, usually one per disk. This shows how many are running (up) out of all OSDs, and below it how many Ceph is placing data on (in), from the cluster's latest data.",
  monsInQuorum:
    "Monitors keep the cluster map and must agree as a majority (a quorum) for the cluster to work. This shows monitors in quorum out of all known monitors, or only the monitor count when quorum is not reported.",
  pools:
    "Storage pools the cluster reported in its latest data. A pool holds data under its own replication and placement rules; block devices, file systems and object storage each keep their data in pools.",
  problemPgs:
    "Placement groups, the chunks Ceph splits each pool into, that are degraded (missing copies) or undersized (on fewer OSDs than the pool's copy count), from the last 10 minutes of data. A group in both states is counted twice.",
  osdStates:
    "Every OSD (a daemon that stores data, usually one per disk) grouped by two flags: up means its daemon is running, and in means Ceph places data on it. Down + In is the risky case, because Ceph still expects data there but the OSD is not running.",
  osdUpIn:
    "OSDs that are running and holding data. This is the normal, healthy state.",
  osdUpOut:
    "OSDs that are running but excluded from data placement, for example while being drained or removed. Ceph moves their data to other OSDs.",
  osdDownIn:
    "OSDs that have stopped but are still expected to hold data, so that data has fewer copies until they come back or Ceph marks them out and copies it elsewhere.",
  osdDownOut:
    "OSDs that are stopped and excluded from data placement. Ceph has copied, or is still copying, their data to other OSDs.",
  pgStates:
    "Placement groups (the chunks Ceph splits each pool into) by state from the last 10 minutes: clean groups have every copy in place, degraded and undersized ones are missing copies, and Other is the rest, such as peering. A group can be in several states at once, so the segments are approximate.",
  clientIops:
    "Read and write operations per second (IOPS) from clients, added up across all pools. Worked out for each interval of the selected time range from Ceph's running per-pool operation counters.",
  clientThroughput:
    "Bytes per second clients read from and wrote to the cluster, added up across all pools. Worked out for each interval of the selected time range from Ceph's running per-pool byte counters.",
  largestPools:
    "The five pools holding the most data, by Ceph's STORED figure: what clients wrote, before replication copies. Pools that have not reported in the last 15 minutes are left out.",
  fullestPools:
    "The five pools closest to full: data stored divided by data stored plus the space still writable (Max Avail). Max Avail allows for replication and the fullest OSDs, so a pool can fill before the cluster's raw space does.",
  osdStatusColumn:
    "Up means the OSD's daemon is running and answering the cluster; Down means it is not. Taken from the latest data Ceph reported for the OSD.",
  osdInOutColumn:
    "In means Ceph places data on this OSD. Out means it was taken out of data placement, by an admin or automatically after being down for a while, and its data lives on other OSDs.",
  osdUsedColumn:
    "Disk space used on the OSD compared with its total size, with the share used in brackets. Shows a dash if the OSD has not reported in the last 15 minutes.",
  osdPgsColumn:
    "How many placement groups, the chunks Ceph splits pools into, the OSD holds; one with far more than its peers carries more data and load. Shows a dash if the OSD has not reported in the last 15 minutes.",
  osdLatencyColumn:
    "The OSD's latest apply and commit latency in milliseconds, as reported by Ceph: how long writes take to reach its disk, where values that stay high point to a slow or failing disk. Shows a dash if it has not reported in the last 15 minutes.",
  osdAgeColumn:
    "How long ago OneUptime first saw this OSD in the data the Ceph agent sends, not how old the OSD or its disk is. It starts again from zero if the OSD was missing from that data for more than about 15 minutes.",
  osdStatus:
    "Up means this OSD's daemon is running and responding to the cluster; Down means it has stopped or cannot be reached. From the most recent data the cluster sent.",
  osdPlacement:
    "In means Ceph is placing data on this OSD. Out means it has been removed from data placement, by an admin or automatically after being down, and its data is served from other OSDs.",
  osdUsed:
    "Disk space used on this OSD's device compared with its total size, from its latest report. Shows a dash if the OSD has not reported in the last 15 minutes.",
  osdPlacementGroups:
    "How many placement groups, the chunks Ceph splits pools into, this OSD holds according to its latest report; more groups usually means more data and more load. Shows a dash if the OSD has not reported in the last 15 minutes.",
  osdLatency:
    "Latest apply and commit latency in milliseconds: how long this OSD takes to apply a write and to make it durable on disk, so high values mean slow writes for clients. Shows a dash if it has not reported in the last 15 minutes.",
  poolStoredColumn:
    "Data stored in the pool, by Ceph's STORED figure: what clients wrote, before replication copies. Shows a dash if the pool has not reported in the last 15 minutes.",
  poolMaxAvailColumn:
    "How much more data Ceph estimates can be written to the pool, allowing for its replication and for the fullest OSDs it uses.",
  poolUsedColumn:
    "How full the pool is: Stored divided by Stored plus Max Avail. It can reach 100% before the cluster's raw disks are full, because Max Avail is limited by the fullest OSD.",
  poolObjectsColumn:
    "Number of RADOS objects in the pool, the units Ceph stores data in. Large files and disk images are split into many objects, so this is not a count of your files.",
  poolReadIopsColumn:
    "Average read operations per second (IOPS) on the pool over the last 15 minutes, worked out from Ceph's running per-pool counters.",
  poolWriteIopsColumn:
    "Average write operations per second (IOPS) on the pool over the last 15 minutes, worked out from Ceph's running per-pool counters.",
  poolStored:
    "Data stored in this pool, by Ceph's STORED figure: what clients wrote, before replication copies. From the pool's latest report; a dash if that is older than 15 minutes.",
  poolMaxAvail:
    "How much more data Ceph estimates can still be written to this pool, allowing for replication and the fullest OSDs, from its latest report.",
  poolUsed:
    "How full this pool is: Stored divided by Stored plus Max Available. Because Max Available is limited by the fullest OSD, a pool can reach 100% while the cluster still has raw space.",
  poolGrowth:
    "A rough estimate of when this pool fills up, from a straight-line trend of its stored data over the last 24 hours. Shown only while the pool is growing or full, and marked low confidence with under 2 hours of history.",
  poolObjects:
    "Number of RADOS objects in this pool from its latest report. Ceph splits files and disk images into many objects, so this is not the number of your files.",
  poolClientIops:
    "Read and write operations per second (IOPS) on this pool, worked out for each interval of the selected time range from Ceph's running operation counters.",
  poolClientThroughput:
    "Bytes per second read from and written to this pool, worked out for each interval of the selected time range from Ceph's running byte counters.",
  daemonStatus:
    "Monitors show In Quorum when they agree with the majority on the cluster map, and Out of Quorum when they do not. Other daemons show Reporting if seen in the last 15 minutes; any daemon silent for longer shows Stale.",
  clusterOsds:
    "OSDs are the daemons that store data, usually one per disk. Shows how many are running (up), how many Ceph places data on (in) and the total, from the cluster's latest data; amber when any are down or out.",
  clusterMons:
    "Number of monitor daemons, which keep the master copy of the cluster map, from the cluster's latest data. This is a count only; open the cluster to see how many are in quorum.",
  clusterCapacity:
    "Share of the cluster's raw disk space in use, counting every copy of your data, from its latest data. The bar turns amber at 75% and red at 90%.",
};
