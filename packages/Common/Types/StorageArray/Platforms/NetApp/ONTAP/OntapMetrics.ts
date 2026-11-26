import { StorageArrayResourceScope } from "../../../../Monitor/MonitorStepStorageArrayMonitor";
import MetricsAggregationType from "../../../../Metrics/MetricsAggregationType";
import { translationKey } from "../../../../Translator";
import StorageSystem from "../../../StorageSystem";
import {
  StorageArrayMetricCategory,
  StorageArrayMetricDefinition,
} from "../../../StorageArrayPlatform";

/*
 * The NetApp ONTAP metric catalog (#11001): what an ONTAP cluster's metric
 * picker offers, the unit each is read in, and the charts' labels.
 *
 * Every series is NetApp Harvest's (26.11), as the OneUptime Storage Array
 * Agent runs it: named netapp_<object>_<counter> (its `global_prefix`),
 * with the cluster's name in `cluster` and the agent's array name in
 * `datacenter` on every one. Harvest computes every rate and average
 * itself (KeyPerf and RestPerf take two polls of ONTAP's raw counters), so
 * no rate math is needed here: latencies are microseconds per operation,
 * *_ops operations per second, *_data bytes per second, and the Rest
 * collector's sizes are bytes. Harvest declares no units; OntapUnits.ts
 * says the same units for every netapp_* series the catalog does not
 * list.
 *
 * Objects are named by labels: an aggregate by `aggr`, an SVM by `svm`, a
 * volume by `volume` (in `svm`: two SVMs can each have a vol1), a LUN by
 * `lun` (in `volume` and `svm`), a node by `node`, a disk by `disk`, a
 * shelf by `shelf`, an Ethernet port by `port` (NetPort) or `nic`
 * (RestPerf), an FC port by `port`, a SnapMirror relationship by its
 * `destination_location` (svm:volume) and `relationship_id`. Group by those
 * to fire one incident per object.
 *
 * Ids are stored on dashboards and monitors: never change one.
 */
const ONTAP: Array<StorageSystem> = [StorageSystem.NetAppOntap];

function metric(data: {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  attributes?: Record<string, string> | undefined;
  category: StorageArrayMetricCategory;
  aggregation: MetricsAggregationType;
  scope?: StorageArrayResourceScope | undefined;
  objectLabel?: string | undefined;
  unit: string;
}): StorageArrayMetricDefinition {
  return {
    id: data.id,
    friendlyName: data.friendlyName,
    description: data.description,
    metricName: data.metricName,
    ...(data.attributes ? { attributes: data.attributes } : {}),
    category: data.category,
    storageSystems: ONTAP,
    defaultAggregation: data.aggregation,
    defaultResourceScope: data.scope || StorageArrayResourceScope.Array,
    ...(data.objectLabel ? { objectLabel: data.objectLabel } : {}),
    unit: data.unit,
  };
}

const ONTAP_METRICS: Array<StorageArrayMetricDefinition> = [
  // ---------------- Cluster health ----------------
  metric({
    id: "netapp-cluster-health",
    friendlyName: translationKey("Cluster Healthy"),
    description: translationKey(
      "1 while ONTAP reports the cluster healthy and 0 while it reports anything else (its health in the status label). Read every 3 minutes; it is also the series that says the agent still reads the cluster.",
    ),
    metricName: "netapp_cluster_new_status",
    category: "Array Health",
    aggregation: MetricsAggregationType.Min,
    unit: "",
  }),
  metric({
    id: "netapp-subsystem-alerts",
    friendlyName: translationKey("Health Subsystem Alerts"),
    description: translationKey(
      "Outstanding alerts of each of ONTAP's health subsystems (the subsystem label: SAS connect, environment, switch health, ...), as system health subsystem show counts them.",
    ),
    metricName: "netapp_cluster_subsystem_outstanding_alerts",
    category: "Array Health",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "subsystem",
    unit: "count",
  }),
  metric({
    id: "netapp-system-health-alerts",
    friendlyName: translationKey("System Health Alerts"),
    description: translationKey(
      "One series per alert ONTAP's system health monitor has open (system health alert show), value 1 while it is open, with node, monitor, name, resource, reason and correctiveAction labels. Group by name to fire one incident per alert.",
    ),
    metricName: "netapp_health_support_alerts",
    category: "Array Health",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "name",
    unit: "count",
  }),
  metric({
    id: "netapp-ems-events",
    friendlyName: translationKey("EMS Events"),
    description: translationKey(
      "One series per EMS event Harvest collected in its last poll (every 3 minutes), value 1, with message, node and severity labels and the event's own parameters. A paired event's clearing exports it once more with value 0. Filter severity = emergency or alert, or message, to watch one kind.",
    ),
    metricName: "netapp_ems_events",
    category: "Array Health",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "message",
    unit: "count",
  }),

  // ---------------- Capacity: aggregates ----------------
  metric({
    id: "netapp-aggr-used-percent",
    friendlyName: translationKey("Aggregate Used (%)"),
    description: translationKey(
      "Share of each aggregate's usable space in use, in percent (its used space over its size, the aggr label). ONTAP calls an aggregate nearly full at 95% and full at 98% by default; volumes on a full aggregate stop taking writes.",
    ),
    metricName: "netapp_aggr_space_used_percent",
    category: "Capacity",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "aggr",
    unit: "%",
  }),
  metric({
    id: "netapp-aggr-size",
    friendlyName: translationKey("Aggregate Size"),
    description: translationKey(
      "Usable space of each aggregate in bytes, not counting the WAFL reserve and the aggregate snapshot reserve. The cluster's capacity is the sum over its data aggregates (root aggregates are left out).",
    ),
    metricName: "netapp_aggr_space_total",
    category: "Capacity",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "aggr",
    unit: "bytes",
  }),
  metric({
    id: "netapp-aggr-used",
    friendlyName: translationKey("Aggregate Used"),
    description: translationKey(
      "Space each aggregate has in use or reserved, in bytes: what its volumes hold and guarantee, and its metadata.",
    ),
    metricName: "netapp_aggr_space_used",
    category: "Capacity",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "aggr",
    unit: "bytes",
  }),
  metric({
    id: "netapp-aggr-free",
    friendlyName: translationKey("Aggregate Free"),
    description: translationKey(
      "Space still free on each aggregate, in bytes. Trend it to forecast when an aggregate fills up.",
    ),
    metricName: "netapp_aggr_space_available",
    category: "Capacity",
    aggregation: MetricsAggregationType.Min,
    objectLabel: "aggr",
    unit: "bytes",
  }),
  metric({
    id: "netapp-aggr-inode-used-percent",
    friendlyName: translationKey("Aggregate Inodes Used (%)"),
    description: translationKey(
      "Share of each aggregate's files (inodes) in use, in percent. An aggregate out of inodes takes no new files even with space free.",
    ),
    metricName: "netapp_aggr_inode_used_percent",
    category: "Capacity",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "aggr",
    unit: "%",
  }),
  metric({
    id: "netapp-aggr-online",
    friendlyName: translationKey("Aggregate Online"),
    description: translationKey(
      "1 while an aggregate is online and 0 while it is offline, restricted or in any other state (the state label of netapp_aggr_labels says which). Its volumes are unavailable while it is offline.",
    ),
    metricName: "netapp_aggr_new_status",
    category: "Capacity",
    aggregation: MetricsAggregationType.Min,
    objectLabel: "aggr",
    unit: "",
  }),
  metric({
    id: "netapp-aggr-logical-used",
    friendlyName: translationKey("Aggregate Logical Used"),
    description: translationKey(
      "What the data on each aggregate would take without deduplication, compression and compaction, in bytes, not counting snapshots and FlexClones. Over the physical used, it is the aggregate's data reduction.",
    ),
    metricName: "netapp_aggr_logical_used_wo_snapshots_flexclones",
    category: "Capacity",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "aggr",
    unit: "bytes",
  }),
  metric({
    id: "netapp-aggr-physical-used",
    friendlyName: translationKey("Aggregate Physical Used"),
    description: translationKey(
      "What the data on each aggregate takes on disk after storage efficiency, in bytes, not counting snapshots and FlexClones.",
    ),
    metricName: "netapp_aggr_physical_used_wo_snapshots_flexclones",
    category: "Capacity",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "aggr",
    unit: "bytes",
  }),

  // ---------------- Performance: the cluster ----------------
  metric({
    id: "netapp-cluster-read-latency",
    friendlyName: translationKey("Read Latency"),
    description: translationKey(
      "Average time a read takes across the cluster, in microseconds per operation, as ONTAP measures it (KeyPerf, every minute). All-flash clusters usually read well under 1 ms; disk-based ones in a few milliseconds.",
    ),
    metricName: "netapp_cluster_read_latency",
    category: "Performance",
    aggregation: MetricsAggregationType.Max,
    unit: "µs",
  }),
  metric({
    id: "netapp-cluster-write-latency",
    friendlyName: translationKey("Write Latency"),
    description: translationKey(
      "Average time a write takes across the cluster, in microseconds per operation, including the copy to NVRAM before the client is answered.",
    ),
    metricName: "netapp_cluster_write_latency",
    category: "Performance",
    aggregation: MetricsAggregationType.Max,
    unit: "µs",
  }),
  metric({
    id: "netapp-cluster-read-iops",
    friendlyName: translationKey("Read IOPS"),
    description: translationKey(
      "Read operations per second across the cluster.",
    ),
    metricName: "netapp_cluster_read_ops",
    category: "Performance",
    aggregation: MetricsAggregationType.Avg,
    unit: "ops/s",
  }),
  metric({
    id: "netapp-cluster-write-iops",
    friendlyName: translationKey("Write IOPS"),
    description: translationKey(
      "Write operations per second across the cluster.",
    ),
    metricName: "netapp_cluster_write_ops",
    category: "Performance",
    aggregation: MetricsAggregationType.Avg,
    unit: "ops/s",
  }),
  metric({
    id: "netapp-cluster-total-iops",
    friendlyName: translationKey("Total IOPS"),
    description: translationKey(
      "Every operation per second across the cluster: reads, writes and metadata operations.",
    ),
    metricName: "netapp_cluster_total_ops",
    category: "Performance",
    aggregation: MetricsAggregationType.Avg,
    unit: "ops/s",
  }),
  metric({
    id: "netapp-cluster-read-bandwidth",
    friendlyName: translationKey("Read Bandwidth"),
    description: translationKey("Bytes read per second across the cluster."),
    metricName: "netapp_cluster_read_data",
    category: "Performance",
    aggregation: MetricsAggregationType.Avg,
    unit: "bytes/s",
  }),
  metric({
    id: "netapp-cluster-write-bandwidth",
    friendlyName: translationKey("Write Bandwidth"),
    description: translationKey("Bytes written per second across the cluster."),
    metricName: "netapp_cluster_write_data",
    category: "Performance",
    aggregation: MetricsAggregationType.Avg,
    unit: "bytes/s",
  }),
  metric({
    id: "netapp-aggr-read-latency",
    friendlyName: translationKey("Aggregate Read Latency"),
    description: translationKey(
      "Average time a read on each aggregate takes, in microseconds per operation.",
    ),
    metricName: "netapp_aggr_read_latency",
    category: "Performance",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "aggr",
    unit: "µs",
  }),
  metric({
    id: "netapp-aggr-write-latency",
    friendlyName: translationKey("Aggregate Write Latency"),
    description: translationKey(
      "Average time a write on each aggregate takes, in microseconds per operation.",
    ),
    metricName: "netapp_aggr_write_latency",
    category: "Performance",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "aggr",
    unit: "µs",
  }),
  metric({
    id: "netapp-aggr-read-iops",
    friendlyName: translationKey("Aggregate Read IOPS"),
    description: translationKey(
      "Read operations per second on each aggregate.",
    ),
    metricName: "netapp_aggr_read_ops",
    category: "Performance",
    aggregation: MetricsAggregationType.Avg,
    objectLabel: "aggr",
    unit: "ops/s",
  }),
  metric({
    id: "netapp-aggr-write-iops",
    friendlyName: translationKey("Aggregate Write IOPS"),
    description: translationKey(
      "Write operations per second on each aggregate.",
    ),
    metricName: "netapp_aggr_write_ops",
    category: "Performance",
    aggregation: MetricsAggregationType.Avg,
    objectLabel: "aggr",
    unit: "ops/s",
  }),

  // ---------------- Nodes ----------------
  metric({
    id: "netapp-node-healthy",
    friendlyName: translationKey("Node Healthy"),
    description: translationKey(
      "1 while ONTAP reports a node healthy and 0 while it does not: down, taken over by its partner, or reporting a problem (the node label).",
    ),
    metricName: "netapp_node_new_status",
    category: "Hardware",
    aggregation: MetricsAggregationType.Min,
    scope: StorageArrayResourceScope.Hardware,
    unit: "",
  }),
  metric({
    id: "netapp-node-cpu-busy",
    friendlyName: translationKey("Node CPU Busy (%)"),
    description: translationKey(
      "Average share of each node's processors in use, in percent (KeyPerf). A node that stays above about 80% has little headroom left for a takeover of its partner's work.",
    ),
    metricName: "netapp_node_avg_processor_busy",
    category: "Hardware",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Hardware,
    unit: "%",
  }),
  metric({
    id: "netapp-node-failed-fans",
    friendlyName: translationKey("Failed Fans"),
    description: translationKey(
      "Chassis fans of each node that are not running within their recommended speed. Above 0, the controller can overheat.",
    ),
    metricName: "netapp_node_failed_fan",
    category: "Hardware",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Hardware,
    unit: "count",
  }),
  metric({
    id: "netapp-node-failed-power-supplies",
    friendlyName: translationKey("Failed Power Supplies"),
    description: translationKey(
      "Power supplies of each node that have failed. Above 0, the node runs on its last supply.",
    ),
    metricName: "netapp_node_failed_power",
    category: "Hardware",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Hardware,
    unit: "count",
  }),
  metric({
    id: "netapp-node-uptime",
    friendlyName: translationKey("Node Uptime"),
    description: translationKey(
      "How long each node has been up, in seconds. A drop to near zero is a reboot or a giveback after a takeover.",
    ),
    metricName: "netapp_node_uptime",
    category: "Hardware",
    aggregation: MetricsAggregationType.Min,
    scope: StorageArrayResourceScope.Hardware,
    unit: "s",
  }),

  // ---------------- SVMs ----------------
  metric({
    id: "netapp-svm-running",
    friendlyName: translationKey("SVM Running"),
    description: translationKey(
      "1 while an SVM is running and 0 while it is stopped or starting (the svm label). A stopped SVM serves none of its volumes.",
    ),
    metricName: "netapp_svm_new_status",
    category: "Volumes",
    aggregation: MetricsAggregationType.Min,
    objectLabel: "svm",
    unit: "",
  }),
  metric({
    id: "netapp-svm-stopped",
    friendlyName: translationKey("Stopped SVMs"),
    description: translationKey(
      "One series per data SVM ONTAP reports stopped (state = stopped, type = data), value 1, while it is stopped. The SVMs ONTAP keeps for itself report no state, so they are never in it.",
    ),
    metricName: "netapp_svm_labels",
    attributes: { state: "stopped", type: "data" },
    category: "Volumes",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "svm",
    unit: "",
  }),
  metric({
    id: "netapp-svm-read-latency",
    friendlyName: translationKey("SVM Read Latency"),
    description: translationKey(
      "Average time a read on each SVM's volumes takes, in microseconds per operation.",
    ),
    metricName: "netapp_svm_vol_read_latency",
    category: "Performance",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "svm",
    unit: "µs",
  }),
  metric({
    id: "netapp-svm-write-latency",
    friendlyName: translationKey("SVM Write Latency"),
    description: translationKey(
      "Average time a write on each SVM's volumes takes, in microseconds per operation.",
    ),
    metricName: "netapp_svm_vol_write_latency",
    category: "Performance",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "svm",
    unit: "µs",
  }),
  metric({
    id: "netapp-svm-read-iops",
    friendlyName: translationKey("SVM Read IOPS"),
    description: translationKey(
      "Read operations per second on each SVM's volumes.",
    ),
    metricName: "netapp_svm_vol_read_ops",
    category: "Performance",
    aggregation: MetricsAggregationType.Avg,
    objectLabel: "svm",
    unit: "ops/s",
  }),
  metric({
    id: "netapp-svm-write-iops",
    friendlyName: translationKey("SVM Write IOPS"),
    description: translationKey(
      "Write operations per second on each SVM's volumes.",
    ),
    metricName: "netapp_svm_vol_write_ops",
    category: "Performance",
    aggregation: MetricsAggregationType.Avg,
    objectLabel: "svm",
    unit: "ops/s",
  }),
  metric({
    id: "netapp-svm-read-bandwidth",
    friendlyName: translationKey("SVM Read Bandwidth"),
    description: translationKey(
      "Bytes read per second from each SVM's volumes.",
    ),
    metricName: "netapp_svm_vol_read_data",
    category: "Performance",
    aggregation: MetricsAggregationType.Avg,
    objectLabel: "svm",
    unit: "bytes/s",
  }),
  metric({
    id: "netapp-svm-write-bandwidth",
    friendlyName: translationKey("SVM Write Bandwidth"),
    description: translationKey(
      "Bytes written per second to each SVM's volumes.",
    ),
    metricName: "netapp_svm_vol_write_data",
    category: "Performance",
    aggregation: MetricsAggregationType.Avg,
    objectLabel: "svm",
    unit: "bytes/s",
  }),

  // ---------------- Volumes ----------------
  metric({
    id: "netapp-volume-used-percent",
    friendlyName: translationKey("Volume Used (%)"),
    description: translationKey(
      "Share of each volume's space in use, in percent, as volume show reports it (the volume label, in svm). ONTAP calls a volume nearly full at 95% and full at 98% by default; a full volume refuses writes unless autosize grows it.",
    ),
    metricName: "netapp_volume_size_used_percent",
    category: "Volumes",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Volume,
    unit: "%",
  }),
  metric({
    id: "netapp-volume-size",
    friendlyName: translationKey("Volume Size"),
    description: translationKey(
      "Each volume's usable size in bytes, not counting its snapshot reserve.",
    ),
    metricName: "netapp_volume_size_total",
    category: "Volumes",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Volume,
    unit: "bytes",
  }),
  metric({
    id: "netapp-volume-used",
    friendlyName: translationKey("Volume Used"),
    description: translationKey("Space each volume has in use, in bytes."),
    metricName: "netapp_volume_size_used",
    category: "Volumes",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Volume,
    unit: "bytes",
  }),
  metric({
    id: "netapp-volume-free",
    friendlyName: translationKey("Volume Free"),
    description: translationKey("Space still free in each volume, in bytes."),
    metricName: "netapp_volume_size_available",
    category: "Volumes",
    aggregation: MetricsAggregationType.Min,
    scope: StorageArrayResourceScope.Volume,
    unit: "bytes",
  }),
  metric({
    id: "netapp-volume-snapshot-used",
    friendlyName: translationKey("Volume Snapshot Space"),
    description: translationKey(
      "Space each volume's snapshots use, in bytes. Past the snapshot reserve, snapshots take space from the volume's data.",
    ),
    metricName: "netapp_volume_snapshots_size_used",
    category: "Volumes",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Volume,
    unit: "bytes",
  }),
  metric({
    id: "netapp-volume-inode-used-percent",
    friendlyName: translationKey("Volume Inodes Used (%)"),
    description: translationKey(
      "Share of each volume's files (inodes) in use, in percent. A volume out of inodes takes no new files even with space free.",
    ),
    metricName: "netapp_volume_inode_used_percent",
    category: "Volumes",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Volume,
    unit: "%",
  }),
  metric({
    id: "netapp-volume-efficiency-saved-percent",
    friendlyName: translationKey("Volume Efficiency Savings (%)"),
    description: translationKey(
      "Share of each volume's logical data that deduplication and compression save, in percent: 60% saved is a data reduction of 2.5:1.",
    ),
    metricName: "netapp_volume_sis_total_saved_percent",
    category: "Volumes",
    aggregation: MetricsAggregationType.Avg,
    scope: StorageArrayResourceScope.Volume,
    unit: "%",
  }),
  metric({
    id: "netapp-volume-online",
    friendlyName: translationKey("Volume Online"),
    description: translationKey(
      "1 while a volume is online and 0 while it is offline or restricted (the state label of netapp_volume_labels says which). Clients cannot reach an offline volume.",
    ),
    metricName: "netapp_volume_new_status",
    category: "Volumes",
    aggregation: MetricsAggregationType.Min,
    scope: StorageArrayResourceScope.Volume,
    unit: "",
  }),
  metric({
    id: "netapp-volume-read-latency",
    friendlyName: translationKey("Volume Read Latency"),
    description: translationKey(
      "Average time a read on each volume takes, in microseconds per operation, as ONTAP measures it (KeyPerf, every minute).",
    ),
    metricName: "netapp_volume_read_latency",
    category: "Volumes",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Volume,
    unit: "µs",
  }),
  metric({
    id: "netapp-volume-write-latency",
    friendlyName: translationKey("Volume Write Latency"),
    description: translationKey(
      "Average time a write on each volume takes, in microseconds per operation.",
    ),
    metricName: "netapp_volume_write_latency",
    category: "Volumes",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Volume,
    unit: "µs",
  }),
  metric({
    id: "netapp-volume-read-iops",
    friendlyName: translationKey("Volume Read IOPS"),
    description: translationKey("Read operations per second on each volume."),
    metricName: "netapp_volume_read_ops",
    category: "Volumes",
    aggregation: MetricsAggregationType.Avg,
    scope: StorageArrayResourceScope.Volume,
    unit: "ops/s",
  }),
  metric({
    id: "netapp-volume-write-iops",
    friendlyName: translationKey("Volume Write IOPS"),
    description: translationKey("Write operations per second on each volume."),
    metricName: "netapp_volume_write_ops",
    category: "Volumes",
    aggregation: MetricsAggregationType.Avg,
    scope: StorageArrayResourceScope.Volume,
    unit: "ops/s",
  }),
  metric({
    id: "netapp-volume-read-bandwidth",
    friendlyName: translationKey("Volume Read Bandwidth"),
    description: translationKey("Bytes read per second from each volume."),
    metricName: "netapp_volume_read_data",
    category: "Volumes",
    aggregation: MetricsAggregationType.Avg,
    scope: StorageArrayResourceScope.Volume,
    unit: "bytes/s",
  }),
  metric({
    id: "netapp-volume-write-bandwidth",
    friendlyName: translationKey("Volume Write Bandwidth"),
    description: translationKey("Bytes written per second to each volume."),
    metricName: "netapp_volume_write_data",
    category: "Volumes",
    aggregation: MetricsAggregationType.Avg,
    scope: StorageArrayResourceScope.Volume,
    unit: "bytes/s",
  }),

  // ---------------- LUNs ----------------
  metric({
    id: "netapp-lun-used-percent",
    friendlyName: translationKey("LUN Used (%)"),
    description: translationKey(
      "Share of each LUN's size its host has written, in percent (the lun label, in volume and svm). A thin LUN near full on a full volume goes offline on the next write.",
    ),
    metricName: "netapp_lun_size_used_percent",
    category: "Volumes",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "lun",
    unit: "%",
  }),
  metric({
    id: "netapp-lun-size",
    friendlyName: translationKey("LUN Size"),
    description: translationKey(
      "The size each LUN presents to its hosts, in bytes.",
    ),
    metricName: "netapp_lun_size",
    category: "Volumes",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "lun",
    unit: "bytes",
  }),
  metric({
    id: "netapp-lun-used",
    friendlyName: translationKey("LUN Used"),
    description: translationKey("Space each LUN uses in its volume, in bytes."),
    metricName: "netapp_lun_size_used",
    category: "Volumes",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "lun",
    unit: "bytes",
  }),
  metric({
    id: "netapp-lun-online",
    friendlyName: translationKey("LUN Online"),
    description: translationKey(
      "1 while a LUN is online and 0 while it is offline (the state label of netapp_lun_labels). Its hosts lose the disk while it is offline.",
    ),
    metricName: "netapp_lun_new_status",
    category: "Volumes",
    aggregation: MetricsAggregationType.Min,
    objectLabel: "lun",
    unit: "",
  }),
  metric({
    id: "netapp-lun-read-latency",
    friendlyName: translationKey("LUN Read Latency"),
    description: translationKey(
      "Average time a read on each LUN takes, in microseconds per operation, as its hosts wait for it.",
    ),
    metricName: "netapp_lun_avg_read_latency",
    category: "Volumes",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "lun",
    unit: "µs",
  }),
  metric({
    id: "netapp-lun-write-latency",
    friendlyName: translationKey("LUN Write Latency"),
    description: translationKey(
      "Average time a write on each LUN takes, in microseconds per operation.",
    ),
    metricName: "netapp_lun_avg_write_latency",
    category: "Volumes",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "lun",
    unit: "µs",
  }),
  metric({
    id: "netapp-lun-read-iops",
    friendlyName: translationKey("LUN Read IOPS"),
    description: translationKey("Read operations per second on each LUN."),
    metricName: "netapp_lun_read_ops",
    category: "Volumes",
    aggregation: MetricsAggregationType.Avg,
    objectLabel: "lun",
    unit: "ops/s",
  }),
  metric({
    id: "netapp-lun-write-iops",
    friendlyName: translationKey("LUN Write IOPS"),
    description: translationKey("Write operations per second on each LUN."),
    metricName: "netapp_lun_write_ops",
    category: "Volumes",
    aggregation: MetricsAggregationType.Avg,
    objectLabel: "lun",
    unit: "ops/s",
  }),
  metric({
    id: "netapp-lun-read-bandwidth",
    friendlyName: translationKey("LUN Read Bandwidth"),
    description: translationKey("Bytes read per second from each LUN."),
    metricName: "netapp_lun_read_data",
    category: "Volumes",
    aggregation: MetricsAggregationType.Avg,
    objectLabel: "lun",
    unit: "bytes/s",
  }),
  metric({
    id: "netapp-lun-write-bandwidth",
    friendlyName: translationKey("LUN Write Bandwidth"),
    description: translationKey("Bytes written per second to each LUN."),
    metricName: "netapp_lun_write_data",
    category: "Volumes",
    aggregation: MetricsAggregationType.Avg,
    objectLabel: "lun",
    unit: "bytes/s",
  }),

  // ---------------- Hardware: disks, shelves, sensors ----------------
  metric({
    id: "netapp-disk-healthy",
    friendlyName: translationKey("Disk Healthy"),
    description: translationKey(
      "1 while a disk reports no outage and 0 while it is out of service (the disk label; netapp_disk_labels' outage label says why). A RAID group with a failed disk runs degraded until a spare takes its place.",
    ),
    metricName: "netapp_disk_new_status",
    category: "Hardware",
    aggregation: MetricsAggregationType.Min,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "disk",
    unit: "",
  }),
  metric({
    id: "netapp-broken-disks",
    friendlyName: translationKey("Broken Disks"),
    description: translationKey(
      "One series per disk ONTAP reports broken (container_type broken, severity error) or unassigned (severity warning), value 1 while it is, from Harvest's health checks. Group by disk to fire one incident per disk.",
    ),
    metricName: "netapp_health_disk_alerts",
    category: "Hardware",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "disk",
    unit: "count",
  }),
  metric({
    id: "netapp-shelf-online",
    friendlyName: translationKey("Shelf Online"),
    description: translationKey(
      "1 while a disk shelf is online and 0 while it is not (the shelf label).",
    ),
    metricName: "netapp_shelf_new_status",
    category: "Hardware",
    aggregation: MetricsAggregationType.Min,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "shelf",
    unit: "",
  }),
  metric({
    id: "netapp-shelf-faults",
    friendlyName: translationKey("Shelf Faults"),
    description: translationKey(
      "One series per disk shelf with a fault ONTAP reports (storage shelf show: its error_type and error_text labels), value 1 while it lasts, severity error or warning.",
    ),
    metricName: "netapp_health_shelf_alerts",
    category: "Hardware",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "shelf",
    unit: "count",
  }),
  metric({
    id: "netapp-shelf-power-supply-normal",
    friendlyName: translationKey("Shelf Power Supply Normal"),
    description: translationKey(
      "1 while a shelf's power supply reports normal and 0 while it reports anything else (its psu_id, in shelf).",
    ),
    metricName: "netapp_shelf_psu_status",
    category: "Hardware",
    aggregation: MetricsAggregationType.Min,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "shelf",
    unit: "",
  }),
  metric({
    id: "netapp-shelf-fan-normal",
    friendlyName: translationKey("Shelf Fan Normal"),
    description: translationKey(
      "1 while a shelf's fan reports normal and 0 while it reports anything else (its fan_id, in shelf).",
    ),
    metricName: "netapp_shelf_fan_status",
    category: "Hardware",
    aggregation: MetricsAggregationType.Min,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "shelf",
    unit: "",
  }),
  metric({
    id: "netapp-shelf-temperature-normal",
    friendlyName: translationKey("Shelf Temperature Normal"),
    description: translationKey(
      "1 while a shelf's temperature sensor reports normal and 0 while it is past one of its thresholds (its sensor_id, in shelf).",
    ),
    metricName: "netapp_shelf_temperature_status",
    category: "Hardware",
    aggregation: MetricsAggregationType.Min,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "shelf",
    unit: "",
  }),
  metric({
    id: "netapp-shelf-temperature",
    friendlyName: translationKey("Shelf Temperature"),
    description: translationKey(
      "Each shelf temperature sensor's reading, in degrees Celsius.",
    ),
    metricName: "netapp_shelf_temperature_reading",
    category: "Hardware",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "shelf",
    unit: "°C",
  }),
  metric({
    id: "netapp-sensor-normal",
    friendlyName: translationKey("Environment Sensor Normal"),
    description: translationKey(
      "1 while a node's environment sensor reads within its thresholds and 0 while it is past one of them (its threshold_state label: warning-high, critical-low, ...). The sensor label names it, the node label its node.",
    ),
    metricName: "netapp_environment_sensor_status",
    category: "Hardware",
    aggregation: MetricsAggregationType.Min,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "sensor",
    unit: "",
  }),
  metric({
    id: "netapp-unhealthy-nodes",
    friendlyName: translationKey("Unhealthy Nodes"),
    description: translationKey(
      "One series per node ONTAP reports unhealthy, value 1 while it is, from Harvest's health checks.",
    ),
    metricName: "netapp_health_node_alerts",
    category: "Hardware",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Hardware,
    unit: "count",
  }),
  metric({
    id: "netapp-takeover-impossible",
    friendlyName: translationKey("Takeover Not Possible"),
    description: translationKey(
      "One series per node that could not take over its HA partner now (storage failover show: takeover_possible false), value 1 while it lasts, with its state_description: it is down, has taken over its partner, or its partner has taken it over.",
    ),
    metricName: "netapp_health_ha_alerts",
    category: "Hardware",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Hardware,
    unit: "count",
  }),

  // ---------------- Network ----------------
  metric({
    id: "netapp-port-up",
    friendlyName: translationKey("Ethernet Port Up"),
    description: translationKey(
      "1 while an Ethernet port's link is up and 0 while it is down (the port label, in node).",
    ),
    metricName: "netapp_net_port_status",
    category: "Hardware",
    aggregation: MetricsAggregationType.Min,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "port",
    unit: "",
  }),
  metric({
    id: "netapp-ports-down",
    friendlyName: translationKey("Ports Down"),
    description: translationKey(
      "One series per enabled Ethernet port whose link is down, value 1 while it is, from Harvest's health checks.",
    ),
    metricName: "netapp_health_network_ethernet_port_alerts",
    category: "Hardware",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "port",
    unit: "count",
  }),
  metric({
    id: "netapp-port-received",
    friendlyName: translationKey("Port Received"),
    description: translationKey(
      "Bytes each Ethernet port receives per second (the nic label, in node).",
    ),
    metricName: "netapp_nic_rx_bytes",
    category: "Hardware",
    aggregation: MetricsAggregationType.Avg,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "nic",
    unit: "bytes/s",
  }),
  metric({
    id: "netapp-port-transmitted",
    friendlyName: translationKey("Port Transmitted"),
    description: translationKey("Bytes each Ethernet port sends per second."),
    metricName: "netapp_nic_tx_bytes",
    category: "Hardware",
    aggregation: MetricsAggregationType.Avg,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "nic",
    unit: "bytes/s",
  }),
  metric({
    id: "netapp-port-utilization",
    friendlyName: translationKey("Port Utilization (%)"),
    description: translationKey(
      "Share of each Ethernet port's speed in use, in percent, in its busier direction.",
    ),
    metricName: "netapp_nic_util_percent",
    category: "Hardware",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "nic",
    unit: "%",
  }),
  metric({
    id: "netapp-port-receive-errors",
    friendlyName: translationKey("Port Receive Errors"),
    description: translationKey(
      "Receive errors each Ethernet port counted since Harvest's previous poll (every minute): CRC, length and alignment errors. Any above zero points at a cable, an optic or the switch port.",
    ),
    metricName: "netapp_nic_rx_total_errors",
    category: "Hardware",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "nic",
    unit: "count",
  }),
  metric({
    id: "netapp-fc-port-read",
    friendlyName: translationKey("FC Port Read"),
    description: translationKey(
      "Bytes read per second through each Fibre Channel port (the port label, in node).",
    ),
    metricName: "netapp_fcp_read_data",
    category: "Hardware",
    aggregation: MetricsAggregationType.Avg,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "port",
    unit: "bytes/s",
  }),
  metric({
    id: "netapp-fc-port-write",
    friendlyName: translationKey("FC Port Write"),
    description: translationKey(
      "Bytes written per second through each Fibre Channel port.",
    ),
    metricName: "netapp_fcp_write_data",
    category: "Hardware",
    aggregation: MetricsAggregationType.Avg,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "port",
    unit: "bytes/s",
  }),
  metric({
    id: "netapp-fc-port-utilization",
    friendlyName: translationKey("FC Port Utilization (%)"),
    description: translationKey(
      "Share of each Fibre Channel port's speed in use, in percent.",
    ),
    metricName: "netapp_fcp_util_percent",
    category: "Hardware",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "port",
    unit: "%",
  }),
  metric({
    id: "netapp-fc-port-link-failures",
    friendlyName: translationKey("FC Port Link Failures"),
    description: translationKey(
      "Link failures each Fibre Channel port counted since Harvest's previous poll (every minute). Any above zero is a flapping link: a failing optic, cable or switch port, and paths to the hosts going up and down.",
    ),
    metricName: "netapp_fcp_link_failure",
    category: "Hardware",
    aggregation: MetricsAggregationType.Max,
    scope: StorageArrayResourceScope.Hardware,
    objectLabel: "port",
    unit: "count",
  }),

  // ---------------- Replication: SnapMirror ----------------
  metric({
    id: "netapp-snapmirror-lag",
    friendlyName: translationKey("SnapMirror Lag"),
    description: translationKey(
      "How far each SnapMirror relationship's destination is behind its source, in seconds: the age of the newest snapshot it has (the destination_location label, svm:volume). A relationship's lag grows between transfers and drops after each one.",
    ),
    metricName: "netapp_snapmirror_lag_time",
    category: "Replication",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "destination_location",
    unit: "s",
  }),
  metric({
    id: "netapp-snapmirror-schedule",
    friendlyName: translationKey("SnapMirror Schedule"),
    description: translationKey(
      "How often each SnapMirror relationship's schedule transfers, in seconds, from its schedule label (hourly is 3600). The Storage Array Agent writes it for ONTAP's own schedules and the usual custom names; a relationship on another schedule, or none, has no such series.",
    ),
    metricName: "netapp_snapmirror_schedule_seconds",
    category: "Replication",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "destination_location",
    unit: "s",
  }),
  metric({
    id: "netapp-snapmirror-last-transfer-duration",
    friendlyName: translationKey("SnapMirror Last Transfer Duration"),
    description: translationKey(
      "How long each relationship's last transfer took, in seconds. Transfers that take longer than the schedule's interval fall further behind with every one.",
    ),
    metricName: "netapp_snapmirror_last_transfer_duration",
    category: "Replication",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "destination_location",
    unit: "s",
  }),
  metric({
    id: "netapp-snapmirror-last-transfer-size",
    friendlyName: translationKey("SnapMirror Last Transfer Size"),
    description: translationKey(
      "How much each relationship's last transfer sent, in bytes.",
    ),
    metricName: "netapp_snapmirror_last_transfer_size",
    category: "Replication",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "destination_location",
    unit: "bytes",
  }),
  metric({
    id: "netapp-snapmirror-update-failures",
    friendlyName: translationKey("SnapMirror Failed Updates"),
    description: translationKey(
      "How many of each relationship's updates have failed since it was created (ONTAP's counter: it only grows). A rise is a transfer that failed.",
    ),
    metricName: "netapp_snapmirror_update_failed_count",
    category: "Replication",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "destination_location",
    unit: "count",
  }),
  metric({
    id: "netapp-snapmirror-unhealthy",
    friendlyName: translationKey("Unhealthy SnapMirror Relationships"),
    description: translationKey(
      "One series per SnapMirror relationship ONTAP reports unhealthy (healthy = false), value 1, with its unhealthy_reason, schedule and relationship_state labels.",
    ),
    metricName: "netapp_snapmirror_labels",
    attributes: { healthy: "false" },
    category: "Replication",
    aggregation: MetricsAggregationType.Max,
    objectLabel: "destination_location",
    unit: "",
  }),
];

export default ONTAP_METRICS;
