/*
 * What each number on the Proxmox pages means, in plain words. Shown in the
 * (i) tooltip beside a tile, chart, summary field or column title.
 *
 * Each text describes what the page actually computes, not what the title
 * might suggest:
 *   - the CPU and Memory tiles average the time buckets that start in the
 *     last 5 minutes of the selected range and fall back to the whole range
 *     when none does - rare up to 12 hours (1- and 5-minute buckets), common
 *     beyond (15-minute buckets and wider) - while the charts below them
 *     cover the whole range;
 *   - node/guest counts, the Storage tile, the list columns and the detail
 *     fields come from the latest inventory snapshot and ignore the time
 *     picker;
 *   - list columns hide CPU and memory older than 15 minutes, detail fields
 *     do not;
 *   - the Memory chart is summed bytes although the Memory tile is a
 *     percentage, and the Storage chart counts shared storage once per node.
 * Change the fetch, change the words.
 */

export type ProxmoxMetric =
  // Cluster overview - golden tiles.
  | "nodeAvailability"
  | "clusterCpu"
  | "clusterMemory"
  | "fullestStorage"
  | "guestsRunning"
  | "backupCoverage"
  // Cluster overview - charts under the tiles.
  | "cpuChart"
  | "memoryChart"
  | "storageChart"
  | "networkChart"
  // Cluster overview - hero, summary strip and cards.
  | "clusterInventoryCounts"
  | "haStates"
  | "clusterHealth"
  | "quorum"
  | "nodeCount"
  | "guestCount"
  | "storageCount"
  | "agentStatus"
  | "replicationLastSync"
  | "replicationDuration"
  | "replicationFailedSyncs"
  | "cephCapacityUsed"
  | "topGuestsByCpu"
  | "topGuestsByMemory"
  // Node detail.
  | "nodeStatus"
  | "nodeUptime"
  | "nodeCpu"
  | "nodeMemory"
  | "nodeHaState"
  | "nodeNetworkThroughput"
  | "nodeDiskThroughput"
  // Guest detail.
  | "guestStatus"
  | "guestHaState"
  | "guestStartOnBoot"
  | "guestBackupCoverage"
  | "guestUptime"
  | "guestCpu"
  | "guestMemory"
  | "guestDisk"
  | "guestNetworkThroughput"
  | "guestDiskThroughput"
  // Storage detail.
  | "storageStatus"
  | "storageUsed"
  | "storageTotal"
  | "storageUsedPercent"
  | "storageGrowthForecast"
  // Nodes list.
  | "nodesTableStatus"
  | "nodesTableCpu"
  | "nodesTableMemory"
  | "nodesTableUptime"
  // Guests list.
  | "guestsTableStatus"
  | "guestsTableCpu"
  | "guestsTableMemory"
  | "guestsTableUptime"
  | "guestsTableHaState"
  | "guestsTableBackup"
  // Storage list.
  | "storageTableStatus"
  | "storageTableUsage"
  | "storageTableAge"
  // Insights.
  | "insightsDiskThroughput";

export const PROXMOX_METRIC_DESCRIPTIONS: Record<ProxmoxMetric, string> = {
  // Cluster overview - golden tiles.
  nodeAvailability:
    "Nodes (physical servers) that Proxmox reports as online, out of all nodes in the cluster, from the latest report rather than the selected time range. The bar turns amber when a node is offline and red when half or more are offline.",
  clusterCpu:
    "How busy the cluster's processors are, as a share of all CPU cores on all nodes, so a big node counts more than a small one. It averages the last 5 minutes of the selected range, but often the whole range on ranges over 12 hours, and always when those 5 minutes have no data.",
  clusterMemory:
    "Memory in use on all nodes together, as a share of their combined memory, averaged over the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data). The line below shows used and total memory at the latest data point.",
  fullestStorage:
    "How full your fullest storage volume is (used space divided by its size), from the latest report rather than the selected time range. It is the single fullest volume, not an average, and above 85% it marks the cluster Degraded.",
  guestsRunning:
    "Running guests (virtual machines and containers) out of all guests, from the latest report. The net figure is their combined traffic in and out per second over the last 5 minutes of the selected range, often the whole range on ranges over 12 hours or without recent data.",
  backupCoverage:
    "Guests that at least one Proxmox backup job includes, out of all guests; it checks job coverage, not whether recent backups succeeded. The bar is red while any guest is left out, and a dash means Proxmox has not reported backup information yet.",

  // Cluster overview - charts under the tiles.
  cpuChart:
    "Cluster CPU use across the whole selected range, as a share of all CPU cores on all nodes, with bigger nodes weighted more. 100% would mean every core on every node is busy.",
  memoryChart:
    "Total memory in use on all nodes over the selected range, in bytes. The Memory tile above shows the same usage as a percentage of the nodes' combined memory.",
  storageChart:
    "Used space added up across all storage volumes over the selected range. Storage that several nodes share, such as NFS or Ceph, is counted once for each node that reports it, so this total can be higher than the space really used.",
  networkChart:
    "Data received (In) and sent (Out) per second by all virtual machines and containers together over the selected range, worked out from the running byte counters Proxmox keeps for each guest.",

  // Cluster overview - hero, summary strip and cards.
  clusterInventoryCounts:
    "Nodes online out of all nodes, guests running out of all guests, and storage volumes (shared storage once per node), from the latest report rather than the selected time range.",
  haStates:
    "How many nodes and guests are in each Proxmox high-availability (HA) state; HA restarts guests on another node when one fails. 'started' is normal, 'error' or 'fence' is a problem that marks the cluster Unhealthy, and 'migrate' or 'recovery' is temporary.",
  clusterHealth:
    "Unhealthy if a node is offline or a high-availability (HA) resource is in error or fence; Degraded if a storage volume is over 85% full, a start-on-boot guest is stopped, a guest is in no backup job or replication fails. Unknown if the agent is disconnected.",
  quorum:
    "Online nodes out of all nodes; Proxmox needs more than half of its nodes online (quorum) to start guests, change settings or run high availability, so this turns red at half or fewer. It is worked out from which nodes report as online, not read from Proxmox's own quorum service.",
  nodeCount:
    "How many Proxmox nodes (physical servers) this cluster has, with any that are offline called out in red. Select the card to open the node list.",
  guestCount:
    "How many guests this cluster has - QEMU virtual machines and LXC containers - whether they are running or stopped. Select the card to open the guest list.",
  storageCount:
    "How many storage volumes Proxmox reports, such as local disks, ZFS, NFS or Ceph, with storage shared by several nodes listed once per node. Select the card to open the storage list.",
  agentStatus:
    "Whether the OneUptime Proxmox agent is sending data for this cluster. It switches to Disconnected 15 to 20 minutes after data stops arriving, and the numbers on this page may then be out of date.",
  replicationLastSync:
    "How long ago this storage replication job last copied the guest's disks to the target node successfully. It turns amber after 1 hour and red after 6 hours without a successful sync.",
  replicationDuration:
    "How long the most recent run of this replication job took to copy the changes to the target node.",
  replicationFailedSyncs:
    "Sync attempts of this replication job that have failed in a row since its last successful sync, as Proxmox currently reports them. Anything above zero means the copy on the target node may be out of date, and it marks the cluster at least Degraded.",
  cephCapacityUsed:
    "How much of the linked Ceph cluster's raw disk capacity, across all of its OSDs (storage disks), is used, from its latest snapshot rather than the selected range. The bar turns amber from 75% and red from 90%.",
  topGuestsByCpu:
    "The 5 guests using the most CPU at their latest report, each as a share of the CPU cores assigned to that guest. Guests that have sent no update in the last 15 minutes are left out.",
  topGuestsByMemory:
    "The 5 guests using the most memory at their latest report, in bytes, with a bar for each guest's usage as a share of its assigned memory. Guests that have sent no update in the last 15 minutes are left out.",

  // Node detail.
  nodeStatus:
    "Online or Offline, as Proxmox last reported for this node. If the agent stops sending data, this keeps showing the last known state.",
  nodeUptime:
    "How long this node had been running since it last booted, as of its latest report.",
  nodeCpu:
    "How busy this node's processors were at its latest report, as a share of all its CPU cores. It is the last value the agent sent, so it can be out of date if the agent has stopped reporting.",
  nodeMemory:
    "Memory in use on this node compared with its total memory, at its latest report.",
  nodeHaState:
    "This node's state in Proxmox high availability (HA), the feature that restarts guests on another node when one fails. 'online' is normal and 'maintenance' is planned; 'fence' means HA is cutting the node off after a failure and marks the cluster Unhealthy.",
  nodeNetworkThroughput:
    "Data this node received and sent per second over the selected range. Often empty, because Proxmox reports network counters for virtual machines and containers rather than for nodes.",
  nodeDiskThroughput:
    "Data this node read from and wrote to disk per second over the selected range. Often empty, because Proxmox reports disk counters for virtual machines and containers rather than for nodes.",

  // Guest detail.
  guestStatus:
    "Running or Stopped, as Proxmox last reported for this guest. A stopped guest only counts against cluster health when it is set to start on boot.",
  guestHaState:
    "This guest's state in Proxmox high availability (HA), which restarts it on another node if its node fails. 'started' is normal; 'error' or 'fence' means HA hit a problem and marks the cluster Unhealthy.",
  guestStartOnBoot:
    "Whether Proxmox starts this guest automatically when its node boots. If this is Yes and the guest is stopped, the cluster is marked Degraded.",
  guestBackupCoverage:
    "Whether at least one Proxmox backup job includes this guest; it does not check that recent backups ran or succeeded. A guest that is in no backup job marks the cluster Degraded.",
  guestUptime:
    "How long this guest had been running since it last started, as of its latest report.",
  guestCpu:
    "How busy this guest was at its latest report, as a share of the CPU cores assigned to it. It is the last value the agent sent, so it can be out of date if the agent has stopped reporting.",
  guestMemory:
    "Memory this guest is using compared with the most memory assigned to it, at its latest report.",
  guestDisk:
    "Disk space this guest uses compared with its disk size, at its latest report. For QEMU virtual machines Proxmox only sees the used space when the QEMU guest agent runs inside the VM; without it this shows 0 or N/A.",
  guestNetworkThroughput:
    "Data this guest received and sent per second over the selected range, worked out from the running byte counters Proxmox keeps for it.",
  guestDiskThroughput:
    "Data this guest read from and wrote to its disks per second over the selected range, worked out from the running byte counters Proxmox keeps for it.",

  // Storage detail.
  storageStatus:
    "Available or Unavailable, as Proxmox last reported for this storage. Unavailable means Proxmox could not use it, for example because it is disabled, not mounted or unreachable from its node.",
  storageUsed: "Space used on this storage volume at its latest report.",
  storageTotal: "The total size of this storage volume at its latest report.",
  storageUsedPercent:
    "Used space as a share of this volume's total size, at its latest report. Above 85% the cluster is marked Degraded.",
  storageGrowthForecast:
    "A straight-line estimate of when this volume fills up, based on how its used space changed over the last 24 hours. Shown only while usage is growing and would fill it within a year; 'Full now' means it is already full.",

  // Nodes list.
  nodesTableStatus:
    "Online or Offline, as Proxmox last reported for each node.",
  nodesTableCpu:
    "How busy each node's processors are, as a share of all its CPU cores, at its latest report. Shows N/A when the node has sent no update in the last 15 minutes.",
  nodesTableMemory:
    "Memory in use on each node compared with its total memory, at its latest report. Shows N/A when the node has sent no update in the last 15 minutes.",
  nodesTableUptime:
    "How long each node has been running since it last booted (its uptime), not how long it has been part of the cluster.",

  // Guests list.
  guestsTableStatus:
    "Running or Stopped, as Proxmox last reported for each guest. A stopped guest is not an error unless it is set to start on boot.",
  guestsTableCpu:
    "How busy each guest is, as a share of the CPU cores assigned to it, at its latest report. Shows N/A when the guest has sent no update in the last 15 minutes.",
  guestsTableMemory:
    "Memory each guest uses compared with the memory assigned to it, at its latest report. Shows N/A when the guest has sent no update in the last 15 minutes.",
  guestsTableUptime:
    "How long each guest has been running since it last started (its uptime). A stopped guest shows a dash.",
  guestsTableHaState:
    "The guest's Proxmox high-availability (HA) state. 'started' is normal, 'error' or 'fence' means a problem, and a dash means HA does not manage the guest.",
  guestsTableBackup:
    "In job means at least one Proxmox backup job includes the guest, Not backed up means no job does, and a dash means no backup information has been reported yet. Whether recent backups succeeded is not checked.",

  // Storage list.
  storageTableStatus:
    "Available or Unavailable, as Proxmox last reported for each storage volume.",
  storageTableUsage:
    "Space used compared with the volume's total size, with the percentage used, at its latest report. Shows N/A when Proxmox has not reported both numbers.",
  storageTableAge:
    "Proxmox does not report an uptime for storage volumes, so this column normally shows a dash.",

  // Insights.
  insightsDiskThroughput:
    "Data read from and written to disk per second over the selected range, added up across every virtual machine and container in the cluster that reports disk counters.",
};
