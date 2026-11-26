import MetricsAggregationType from "../../../../Metrics/MetricsAggregationType";
import { FilterType } from "../../../../Monitor/CriteriaFilter";
import RollingTime from "../../../../RollingTime/RollingTime";
import {
  STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
  StorageArrayAlertTemplateSpec,
} from "../../../StorageArrayPlatform";

/*
 * The Pure Storage FlashArray alert templates, as data
 * (StorageArrayAlertTemplates builds each one's monitor step), in the order
 * the picker lists them after Array Stopped Reporting. They are also what
 * an array's Recommendations offers.
 *
 * Filter contract: Pure's series are keyed by datapoint labels - `name` on
 * volumes and pods, `host` on hosts, `component_name` on hardware,
 * `local_pod` on replica links - and the performance families tell read
 * from write only by the `dimension` label. Templates pin those labels with
 * equality filters and group by the object label so one incident fires per
 * object. Datapoint labels are NOT `resource.`-prefixed in ClickHouse.
 *
 * Presence contract: purefa_alerts_open, purefa_hw_component_status,
 * purefa_drive_capacity_bytes and purefa_host_connectivity_info carry the
 * state in a LABEL with the value always 1 (or the drive's capacity), so a
 * filtered series exists only while the object is in that state - absence
 * is healthy. Those templates fire on Max > 0 (no data never fires under
 * the default Ignore no-data policy) and recover on = 0 with TreatAsZero
 * (STORAGE_ARRAY_RECOVER_WHEN_ABSENT), so the monitor returns to Healthy
 * when the series disappears - the same shape as the ceph_health_detail
 * templates.
 *
 * Ids are stored on every monitor made from a template: never change one.
 */
const FLASHARRAY_ALERT_TEMPLATES: Array<StorageArrayAlertTemplateSpec> = [
  {
    id: "purefa-critical-alerts",
    name: "Critical Array Alert",
    summary: "The array raises a critical alert of its own.",
    description:
      "Alert when the FlashArray raises a critical alert of its own (purefa_alerts_open with severity critical) — a failed controller or component, a capacity emergency, a replication failure. One incident per alert summary.",
    category: "Array Health",
    severity: "Critical",
    metricAlias: "critical_alerts",
    metricName: "purefa_alerts_open",
    attributes: { severity: "critical" },
    groupByAttributeKey: "summary",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] CRITICAL: Array Alert",
    incidentDescription:
      "The FlashArray has an open critical alert. The summary label on the series names the problem, and the code label is the Purity alert code. Check the alert in Pure1 or on the array (`purealert list --filter \"state='open'\"`; `puremessage list --open` on releases before Purity//FA 6), follow the alert's knowledge base article, and open a case with Pure Storage support if a component has failed — the array usually phones the alert home already.",
    criteriaName: "Critical Alert Open",
    criteriaDescription:
      "Triggers while the array reports at least one open alert with critical severity.",
  },
  {
    id: "purefa-warning-alerts",
    name: "Warning Array Alert",
    summary: "The array raises a warning alert of its own.",
    description:
      "Alert when the FlashArray raises a warning alert (purefa_alerts_open with severity warning). One incident per alert summary.",
    category: "Array Health",
    severity: "Warning",
    metricAlias: "warning_alerts",
    metricName: "purefa_alerts_open",
    attributes: { severity: "warning" },
    groupByAttributeKey: "summary",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] Array Warning Alert",
    incidentDescription:
      "The FlashArray has an open warning alert. The summary label on the series names the problem. Review it in Pure1 or on the array (`purealert list --filter \"state='open'\"`) before it turns critical.",
    criteriaName: "Warning Alert Open",
    criteriaDescription:
      "Triggers while the array reports at least one open alert with warning severity.",
  },
  {
    id: "purefa-capacity-high",
    name: "Capacity Above 80%",
    summary: "More than 80% of the array's usable space is in use.",
    description:
      "Alert when more than 80% of the FlashArray's usable capacity is in use (purefa_array_space_utilization) — Pure's own first capacity alert threshold.",
    category: "Capacity",
    severity: "Warning",
    metricAlias: "capacity_used_percent",
    metricName: "purefa_array_space_utilization",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 80 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 80 },
    incidentTitle: "[Storage Array] Capacity Above 80%",
    incidentDescription:
      "More than 80% of the FlashArray's usable capacity is in use. Above about 90% the array has less room to garbage-collect and latency can rise; at 100% writes fail. Check what is growing (snapshot space, a volume that grew, poorer data reduction), expire old snapshots, move or delete data, or plan more capacity.",
    criteriaName: "Capacity Used > 80%",
    criteriaDescription:
      "Triggers when array space utilization stays above 80% over the monitoring window.",
  },
  {
    id: "purefa-capacity-critical",
    name: "Capacity Above 90%",
    summary:
      "More than 90% of the usable space is in use. Writes may soon stop.",
    description:
      "Alert when more than 90% of the FlashArray's usable capacity is in use (purefa_array_space_utilization) — Pure's second capacity alert threshold, where the array is close to refusing writes.",
    category: "Capacity",
    severity: "Critical",
    metricAlias: "capacity_used_percent",
    metricName: "purefa_array_space_utilization",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 90 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 90 },
    incidentTitle: "[Storage Array] CRITICAL: Capacity Above 90%",
    incidentDescription:
      "More than 90% of the FlashArray's usable capacity is in use. When the array fills, writes fail for every host. Free space now: eradicate destroyed volumes and snapshots, expire protection group snapshots, and move data off the array.",
    criteriaName: "Capacity Used > 90%",
    criteriaDescription:
      "Triggers when array space utilization exceeds 90% over the monitoring window.",
  },
  {
    id: "purefa-read-latency-high",
    name: "High Read Latency",
    summary: "Average read latency stays above 5 ms.",
    description:
      "Alert when the FlashArray's average read latency stays above 5 ms (purefa_array_performance_latency_usec, dimension usec_per_read_op). FlashArray reads normally complete well under 1 ms.",
    category: "Performance",
    severity: "Warning",
    metricAlias: "read_latency_usec",
    metricName: "purefa_array_performance_latency_usec",
    attributes: { dimension: "usec_per_read_op" },
    aggregationType: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 5000 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 5000 },
    incidentTitle: "[Storage Array] High Read Latency (>5 ms)",
    incidentDescription:
      "The FlashArray's average read latency has stayed above 5 ms. Compare the SAN and service components (san_usec_per_read_op, service_usec_per_read_op): high SAN latency points at the fabric or the hosts, high service latency at the array. Check the Volumes and Hosts pages for the object driving the load, the queue depth, and whether a QoS limit is throttling.",
    criteriaName: "Read Latency > 5 ms",
    criteriaDescription:
      "Triggers when the average read latency stays above 5000 µs over the monitoring window.",
  },
  {
    id: "purefa-write-latency-high",
    name: "High Write Latency",
    summary: "Average write latency stays above 5 ms.",
    description:
      "Alert when the FlashArray's average write latency stays above 5 ms (purefa_array_performance_latency_usec, dimension usec_per_write_op).",
    category: "Performance",
    severity: "Warning",
    metricAlias: "write_latency_usec",
    metricName: "purefa_array_performance_latency_usec",
    attributes: { dimension: "usec_per_write_op" },
    aggregationType: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 5000 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 5000 },
    incidentTitle: "[Storage Array] High Write Latency (>5 ms)",
    incidentDescription:
      "The FlashArray's average write latency has stayed above 5 ms. For ActiveCluster pods, check mirrored write latency and the link to the peer array. Otherwise check the SAN component, the queue depth, the busiest volumes and hosts, and whether the array is close to full.",
    criteriaName: "Write Latency > 5 ms",
    criteriaDescription:
      "Triggers when the average write latency stays above 5000 µs over the monitoring window.",
  },
  {
    id: "purefa-hardware-critical",
    name: "Hardware Component Failed",
    summary: "A hardware component reports critical.",
    description:
      "Alert when a FlashArray hardware component reports critical (purefa_hw_component_status, component_status critical) — a controller, power supply, fan, drive or NVRAM bay, or port. One incident per component.",
    category: "Hardware",
    severity: "Critical",
    metricAlias: "critical_components",
    metricName: "purefa_hw_component_status",
    attributes: { component_status: "critical" },
    groupByAttributeKey: "component_name",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] CRITICAL: Hardware Component Failed",
    incidentDescription:
      "A FlashArray hardware component is in a critical state. The component_name label names it (for example CT0, CH0.PWR1, CH0.BAY4). The array keeps running on its redundant parts, but redundancy is gone until the part is replaced. Check `purehw list` and open a case with Pure Storage support for a replacement.",
    criteriaName: "Component Critical",
    criteriaDescription:
      "Triggers while any hardware component reports component_status critical.",
  },
  {
    id: "purefa-hardware-degraded",
    name: "Hardware Component Degraded",
    summary: "A hardware component reports degraded.",
    description:
      "Alert when a FlashArray hardware component reports degraded (purefa_hw_component_status, component_status degraded). One incident per component.",
    category: "Hardware",
    severity: "Warning",
    metricAlias: "degraded_components",
    metricName: "purefa_hw_component_status",
    attributes: { component_status: "degraded" },
    groupByAttributeKey: "component_name",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] Hardware Component Degraded",
    incidentDescription:
      "A FlashArray hardware component reports degraded. The component_name label names it. Check `purehw list` for details and the array's open alerts; a degraded port or power supply often follows a cabling or power feed problem in the rack.",
    criteriaName: "Component Degraded",
    criteriaDescription:
      "Triggers while any hardware component reports component_status degraded.",
  },
  {
    id: "purefa-drive-failed",
    name: "Drive Failed",
    summary: "A drive reports failed.",
    description:
      "Alert when a FlashArray drive reports failed (purefa_drive_capacity_bytes, component_status failed). One incident per drive.",
    category: "Hardware",
    severity: "Critical",
    metricAlias: "failed_drives",
    metricName: "purefa_drive_capacity_bytes",
    attributes: { component_status: "failed" },
    groupByAttributeKey: "component_name",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] CRITICAL: Drive Failed",
    incidentDescription:
      "A FlashArray drive (DirectFlash module or SSD) has failed. The array rebuilds its data onto the remaining drives, but another failure before the rebuild completes reduces protection further. Check `puredrive list` and arrange the replacement with Pure Storage support.",
    criteriaName: "Drive Failed",
    criteriaDescription:
      "Triggers while any drive reports component_status failed.",
  },
  {
    id: "purefa-host-connectivity-critical",
    name: "Host Lost Redundant Paths",
    summary: "A host no longer reaches the array through both controllers.",
    description:
      "Alert when a host's connectivity to the FlashArray turns critical (purefa_host_connectivity_info, status critical) — it no longer reaches the array through both controllers. One incident per host.",
    category: "Hosts",
    severity: "Warning",
    metricAlias: "hosts_without_redundancy",
    metricName: "purefa_host_connectivity_info",
    attributes: { status: "critical" },
    groupByAttributeKey: "host",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] Host Lost Redundant Paths",
    incidentDescription:
      "A host reaches the FlashArray through only one controller, or not at all (the details label says which: Single Controller, Uneven, None). The host keeps working until the remaining path fails — a controller failover or upgrade would then take its storage offline. Check the host's multipathing, HBA or NIC, cabling and zoning.",
    criteriaName: "Host Connectivity Critical",
    criteriaDescription:
      "Triggers while any host reports connectivity status critical.",
  },
  {
    id: "purefa-replica-link-lag",
    name: "Replication Lag Above 1 Minute",
    summary: "A replica link falls more than 60 seconds behind.",
    description:
      "Alert when a pod replica link (ActiveDR / async replication) falls more than 60 seconds behind (purefa_pod_replica_links_lag_max_msec). One incident per local pod.",
    category: "Replication",
    severity: "Warning",
    metricAlias: "replica_lag_ms",
    metricName: "purefa_pod_replica_links_lag_max_msec",
    groupByAttributeKey: "local_pod",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 60000 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 60000 },
    incidentTitle: "[Storage Array] Replication Lag Above 1 Minute",
    incidentDescription:
      "A pod replica link is more than a minute behind, so a failover now would lose more recent writes than planned. Check the replication network between the arrays (bandwidth, packet loss), the replica link status, and whether a burst of writes on the pod outran the link.",
    criteriaName: "Replica Lag > 60 s",
    criteriaDescription:
      "Triggers when the maximum replica link lag stays above 60000 ms over the monitoring window.",
  },
];

export default FLASHARRAY_ALERT_TEMPLATES;
