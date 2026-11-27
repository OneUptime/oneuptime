import MetricsAggregationType from "../../../../Metrics/MetricsAggregationType";
import { FilterType } from "../../../../Monitor/CriteriaFilter";
import RollingTime from "../../../../RollingTime/RollingTime";
import {
  STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
  StorageArrayAlertTemplateSpec,
} from "../../../StorageArrayPlatform";

/*
 * The NetApp ONTAP alert templates (#11001), as data
 * (StorageArrayAlertTemplates builds each one's monitor step), in the order
 * the picker lists them after Array Stopped Reporting. They are also what a
 * cluster's Recommendations offers.
 *
 * How Harvest's series carry state, which decides how each one recovers:
 *
 *   - State as a number (netapp_*_new_status: 1 healthy, up, online or
 *     running, 0 not), on every scrape while the object exists: these fire
 *     on Max < 1 (every reading of the window bad) and recover on >= 1.
 *   - One series per open problem (netapp_health_*_alerts, from Harvest's
 *     Health plugin: a broken disk, a shelf fault, a node that cannot take
 *     over its partner, a port down, a system health alert), value 1 while
 *     ONTAP reports it and gone the poll after it clears: these fire on
 *     Max > 0 and recover once the series is gone
 *     (STORAGE_ARRAY_RECOVER_WHEN_ABSENT). This is how an alert resolves
 *     when ONTAP clears what raised it.
 *   - EMS events (netapp_ems_events): Harvest exports an event for the one
 *     poll (3 minutes) that collected it, and a paired event's clearing
 *     once as 0. An EMS template fires while one is in its window and
 *     closes once the window passes without another; a fault that lasts is
 *     watched by the persistent series above as well.
 *
 * Capacity lines follow Active IQ Unified Manager's defaults for
 * aggregates (nearly full at 80%, full at 90%, as Pure's array lines) and
 * ONTAP's own for volumes (full at 98%); SnapMirror's schedule line is
 * Unified Manager's lag warning (150% of the schedule).
 *
 * Ids are stored on every monitor made from a template: never change one.
 */

// The SnapMirror Behind Schedule line: lag over the schedule's interval.
export const ONTAP_SNAPMIRROR_SCHEDULE_LAG_RATIO: number = 1.5;

// The High Read and Write Latency alerts' line (10 ms).
export const ONTAP_LATENCY_WARNING_USEC: number = 10000;

function stateTemplate(
  spec: Omit<
    StorageArrayAlertTemplateSpec,
    "aggregationType" | "fire" | "recover" | "rollingTime"
  > & { rollingTime?: RollingTime | undefined },
): StorageArrayAlertTemplateSpec {
  return {
    ...spec,
    aggregationType: MetricsAggregationType.Max,
    rollingTime: spec.rollingTime || RollingTime.Past10Minutes,
    fire: { filterType: FilterType.LessThan, value: 1 },
    /*
     * A 0/1 status recovers at exactly 1: the shared 10% dead band would
     * put recovery at >= 1.1, which it never reaches.
     */
    recover: {
      filterType: FilterType.GreaterThanOrEqualTo,
      value: 1,
      isBinaryMetric: true,
    },
  };
}

function openProblemTemplate(
  spec: Omit<
    StorageArrayAlertTemplateSpec,
    "aggregationType" | "fire" | "recover" | "rollingTime"
  > & { rollingTime?: RollingTime | undefined },
): StorageArrayAlertTemplateSpec {
  return {
    ...spec,
    aggregationType: MetricsAggregationType.Max,
    rollingTime: spec.rollingTime || RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
  };
}

const ONTAP_ALERT_TEMPLATES: Array<StorageArrayAlertTemplateSpec> = [
  // ---------------- Cluster health ----------------
  stateTemplate({
    id: "netapp-cluster-not-healthy",
    name: "Cluster Not Healthy",
    summary: "ONTAP reports the cluster not healthy for 10 minutes.",
    description:
      "Alert when ONTAP reports the cluster's health as anything but ok for ten minutes (netapp_cluster_new_status, 0 while it is not). The cluster's health rolls up its health subsystems: the System Health Alert template says which alert is behind it.",
    category: "Array Health",
    severity: "Warning",
    metricAlias: "cluster_healthy",
    metricName: "netapp_cluster_new_status",
    incidentTitle: "[Storage Array] Cluster Not Healthy",
    incidentDescription:
      "ONTAP reports the cluster as not healthy. Run `system health status show` and `system health alert show` on the cluster to see which subsystem degraded and why, then follow each alert's corrective action.",
    criteriaName: "Cluster Health Not OK",
    criteriaDescription:
      "Triggers when every reading of the cluster's health in the window is not ok.",
  }),
  openProblemTemplate({
    id: "netapp-system-health-alert",
    name: "System Health Alert",
    summary: "ONTAP's system health monitor raises an alert.",
    description:
      "Alert while ONTAP's system health monitor has an alert open (netapp_health_support_alerts: system health alert show), one incident per alert, which resolves when ONTAP clears the alert: a disk shelf with a single path, a cluster switch fault, a missing cluster network link.",
    category: "Array Health",
    severity: "Warning",
    metricAlias: "system_health_alerts",
    metricName: "netapp_health_support_alerts",
    groupByAttributeKey: "name",
    incidentTitle: "[Storage Array] System Health Alert",
    incidentDescription:
      "ONTAP's system health monitor has an open alert. The series' name, resource and reason labels say what, and correctiveAction what to do; `system health alert show -instance` on the cluster has the full text. The incident resolves when ONTAP clears the alert.",
    criteriaName: "System Health Alert Open",
    criteriaDescription:
      "Triggers while ONTAP reports at least one open system health alert.",
  }),
  {
    id: "netapp-emergency-ems-event",
    name: "Emergency EMS Event",
    summary: "ONTAP logs an event of emergency severity.",
    description:
      "Alert when ONTAP logs an EMS event of emergency severity, the level at which the system is unusable (netapp_ems_events, severity emergency), one incident per message. It closes an hour after the last such event, or once ONTAP logs the event that clears it.",
    category: "Array Health",
    severity: "Critical",
    metricAlias: "emergency_events",
    metricName: "netapp_ems_events",
    attributes: { severity: "emergency" },
    groupByAttributeKey: "message",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past1Hour,
    // Harvest exports an event for one poll: any reading in the window.
    fire: { filterType: FilterType.GreaterThan, value: 0, onAnyReading: true },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] CRITICAL: Emergency EMS Event",
    incidentDescription:
      "The cluster logged an EMS event of emergency severity. The message label names it, node the node that logged it. Run `event log show -severity EMERGENCY` on the cluster for the full text, and see Harvest's EMS alert runbook (netapp.github.io/harvest/latest/resources/ems-alert-runbook) for the event's remediation.",
    criteriaName: "Emergency Event Logged",
    criteriaDescription:
      "Triggers while an EMS event of emergency severity was logged in the past hour.",
  },
  {
    id: "netapp-alert-ems-event",
    name: "Alert EMS Event",
    summary: "ONTAP logs an event of alert severity.",
    description:
      "Alert when ONTAP logs an EMS event of alert severity, the level at which something needs action now (netapp_ems_events, severity alert), one incident per message. It closes an hour after the last such event, or once ONTAP logs the event that clears it.",
    category: "Array Health",
    severity: "Critical",
    metricAlias: "alert_events",
    metricName: "netapp_ems_events",
    attributes: { severity: "alert" },
    groupByAttributeKey: "message",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past1Hour,
    // Harvest exports an event for one poll: any reading in the window.
    fire: { filterType: FilterType.GreaterThan, value: 0, onAnyReading: true },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] CRITICAL: Alert EMS Event",
    incidentDescription:
      "The cluster logged an EMS event of alert severity. The message label names it, node the node that logged it. Run `event log show -severity ALERT` on the cluster for the full text, and see Harvest's EMS alert runbook (netapp.github.io/harvest/latest/resources/ems-alert-runbook) for the event's remediation.",
    criteriaName: "Alert Event Logged",
    criteriaDescription:
      "Triggers while an EMS event of alert severity was logged in the past hour.",
  },
  {
    id: "netapp-disk-out-of-service",
    name: "Disk Out of Service",
    summary: "ONTAP takes a disk out of service.",
    description:
      "Alert when ONTAP logs that it took a disk out of service, because it failed, is being sanitized or entered the Maintenance Center (netapp_ems_events, message disk.outOfService), one incident per disk. Disk Failed watches the disk until it is replaced.",
    category: "Hardware",
    severity: "Warning",
    metricAlias: "disk_out_of_service_events",
    metricName: "netapp_ems_events",
    attributes: { message: "disk.outOfService" },
    groupByAttributeKey: "disk",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past1Hour,
    // Harvest exports an event for one poll: any reading in the window.
    fire: { filterType: FilterType.GreaterThan, value: 0, onAnyReading: true },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] Disk Out of Service",
    incidentDescription:
      "ONTAP took a disk out of service. The disk label names it and reason says why. Check `storage disk show -broken` and `storage aggregate show-status` on the cluster: a RAID group with a failed disk reconstructs onto a spare, and runs degraded until it has. Replace a failed disk; NetApp support usually knows already through AutoSupport.",
    criteriaName: "Disk Taken Out of Service",
    criteriaDescription:
      "Triggers while a disk.outOfService event was logged in the past hour.",
  },
  {
    id: "netapp-node-panic",
    name: "Node Panic",
    summary: "A node panics and reboots.",
    description:
      "Alert when a node logs a panic (netapp_ems_events, message sk.panic), one incident per node. Its partner takes over its storage while it reboots; Takeover Not Possible watches the pair until the node gives back.",
    category: "Hardware",
    severity: "Critical",
    metricAlias: "node_panic_events",
    metricName: "netapp_ems_events",
    attributes: { message: "sk.panic" },
    groupByAttributeKey: "node",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past1Hour,
    // Harvest exports an event for one poll: any reading in the window.
    fire: { filterType: FilterType.GreaterThan, value: 0, onAnyReading: true },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] CRITICAL: Node Panic",
    incidentDescription:
      "A node panicked. The node label names it. Check `storage failover show` for the takeover and giveback, and `system node coredump show` for the core NetApp support asks for; open a case with it.",
    criteriaName: "Node Panicked",
    criteriaDescription:
      "Triggers while an sk.panic event was logged in the past hour.",
  },

  // ---------------- Capacity ----------------
  {
    id: "netapp-aggregate-nearly-full",
    name: "Aggregate Above 80%",
    summary: "An aggregate has more than 80% of its space in use.",
    description:
      "Alert when an aggregate has more than 80% of its usable space in use (netapp_aggr_space_used_percent), Active IQ Unified Manager's nearly-full line, one incident per aggregate.",
    category: "Capacity",
    severity: "Warning",
    metricAlias: "aggregate_used_percent",
    metricName: "netapp_aggr_space_used_percent",
    groupByAttributeKey: "aggr",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 80 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 80 },
    incidentTitle: "[Storage Array] Aggregate Above 80%",
    incidentDescription:
      "An aggregate has more than 80% of its space in use (the aggr label names it). Check `storage aggregate show-space` for what is growing: volume guarantees, snapshots, a volume that grew. Move a volume to an emptier aggregate (`volume move start`), delete old snapshots, or add disks.",
    criteriaName: "Aggregate Used > 80%",
    criteriaDescription:
      "Triggers when an aggregate's used share stays above 80% over the monitoring window.",
  },
  {
    id: "netapp-aggregate-full",
    name: "Aggregate Above 90%",
    summary:
      "An aggregate is over 90% full. Its volumes may soon stop taking writes.",
    description:
      "Alert when an aggregate has more than 90% of its usable space in use (netapp_aggr_space_used_percent), Active IQ Unified Manager's full line, one incident per aggregate. When an aggregate fills, its thin-provisioned volumes stop taking writes.",
    category: "Capacity",
    severity: "Critical",
    metricAlias: "aggregate_used_percent",
    metricName: "netapp_aggr_space_used_percent",
    groupByAttributeKey: "aggr",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 90 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 90 },
    incidentTitle: "[Storage Array] CRITICAL: Aggregate Above 90%",
    incidentDescription:
      "An aggregate has more than 90% of its space in use (the aggr label names it). Free space now: delete snapshots no one needs, move volumes off it (`volume move start`), or add disks (`storage aggregate add-disks`). Above 98% ONTAP itself calls it full.",
    criteriaName: "Aggregate Used > 90%",
    criteriaDescription:
      "Triggers when an aggregate's used share exceeds 90% over the monitoring window.",
  },
  {
    id: "netapp-volume-nearly-full",
    name: "Volume Above 90%",
    summary: "A volume has more than 90% of its space in use.",
    description:
      "Alert when a volume has more than 90% of its space in use (netapp_volume_size_used_percent), one incident per volume. A volume with autosize on grows before it fills, as long as its aggregate has room.",
    category: "Capacity",
    severity: "Warning",
    metricAlias: "volume_used_percent",
    metricName: "netapp_volume_size_used_percent",
    groupByAttributeKey: "volume",
    scopeAttributeKeys: ["svm"],
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 90 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 90 },
    incidentTitle: "[Storage Array] Volume Above 90%",
    incidentDescription:
      "A volume has more than 90% of its space in use (the volume label names it, svm its SVM). Grow it (`volume size`), turn on autosize, or free space in it: delete old snapshots (`volume snapshot show`), or move data off it.",
    criteriaName: "Volume Used > 90%",
    criteriaDescription:
      "Triggers when a volume's used share stays above 90% over the monitoring window.",
  },
  {
    id: "netapp-volume-full",
    name: "Volume Above 98%",
    summary:
      "A volume has more than 98% of its space in use. Writes to it are about to fail.",
    description:
      "Alert when a volume has more than 98% of its space in use (netapp_volume_size_used_percent), ONTAP's own full line, one incident per volume.",
    category: "Capacity",
    severity: "Critical",
    metricAlias: "volume_used_percent",
    metricName: "netapp_volume_size_used_percent",
    groupByAttributeKey: "volume",
    scopeAttributeKeys: ["svm"],
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 98 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 98 },
    incidentTitle: "[Storage Array] CRITICAL: Volume Above 98%",
    incidentDescription:
      "A volume is full (the volume label names it, svm its SVM): clients get out-of-space errors, and a LUN in it can go offline. Grow it now (`volume size`) or delete snapshots in it, then turn on autosize so it grows on its own.",
    criteriaName: "Volume Used > 98%",
    criteriaDescription:
      "Triggers when a volume's used share exceeds 98% over the monitoring window.",
  },

  // ---------------- Performance ----------------
  {
    id: "netapp-read-latency-high",
    name: "High Read Latency",
    summary: "The cluster's average read latency stays above 10 ms.",
    description:
      "Alert when the cluster's average read latency stays above 10 ms (netapp_cluster_read_latency). All-flash clusters read well under 1 ms; disk-based ones in a few milliseconds.",
    category: "Performance",
    severity: "Warning",
    metricAlias: "read_latency_usec",
    metricName: "netapp_cluster_read_latency",
    aggregationType: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past15Minutes,
    fire: {
      filterType: FilterType.GreaterThan,
      value: ONTAP_LATENCY_WARNING_USEC,
    },
    recover: {
      filterType: FilterType.LessThanOrEqualTo,
      value: ONTAP_LATENCY_WARNING_USEC,
    },
    incidentTitle: "[Storage Array] High Read Latency (>10 ms)",
    incidentDescription:
      "The cluster's average read latency has stayed above 10 ms. Check the Volumes page for the volume driving it, the nodes' CPU and the aggregates' latency on the Resource Usage page, and `qos statistics volume latency show` on the cluster for where the time goes (network, data, disk, QoS).",
    criteriaName: "Read Latency > 10 ms",
    criteriaDescription:
      "Triggers when the average read latency stays above 10000 µs over the monitoring window.",
  },
  {
    id: "netapp-write-latency-high",
    name: "High Write Latency",
    summary: "The cluster's average write latency stays above 10 ms.",
    description:
      "Alert when the cluster's average write latency stays above 10 ms (netapp_cluster_write_latency).",
    category: "Performance",
    severity: "Warning",
    metricAlias: "write_latency_usec",
    metricName: "netapp_cluster_write_latency",
    aggregationType: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past15Minutes,
    fire: {
      filterType: FilterType.GreaterThan,
      value: ONTAP_LATENCY_WARNING_USEC,
    },
    recover: {
      filterType: FilterType.LessThanOrEqualTo,
      value: ONTAP_LATENCY_WARNING_USEC,
    },
    incidentTitle: "[Storage Array] High Write Latency (>10 ms)",
    incidentDescription:
      "The cluster's average write latency has stayed above 10 ms. Check whether an aggregate is close to full, the busiest volumes on the Volumes page, the nodes' CPU, and `qos statistics volume latency show` on the cluster for where the time goes.",
    criteriaName: "Write Latency > 10 ms",
    criteriaDescription:
      "Triggers when the average write latency stays above 10000 µs over the monitoring window.",
  },
  {
    id: "netapp-volume-latency-high",
    name: "Volume Latency Above 20 ms",
    summary: "A volume's average read latency stays above 20 ms.",
    description:
      "Alert when a volume's average read latency stays above 20 ms (netapp_volume_read_latency), one incident per volume: the latency its clients wait for.",
    category: "Performance",
    severity: "Warning",
    metricAlias: "volume_read_latency_usec",
    metricName: "netapp_volume_read_latency",
    groupByAttributeKey: "volume",
    scopeAttributeKeys: ["svm"],
    aggregationType: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 20000 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 20000 },
    incidentTitle: "[Storage Array] Volume Latency Above 20 ms",
    incidentDescription:
      "A volume's average read latency has stayed above 20 ms (the volume label names it). Check its IOPS on its page, whether a QoS policy limits it, how busy its aggregate and node are, and `qos statistics volume latency show -volume <volume>` on the cluster.",
    criteriaName: "Volume Read Latency > 20 ms",
    criteriaDescription:
      "Triggers when a volume's average read latency stays above 20000 µs over the monitoring window.",
  },

  // ---------------- Hardware ----------------
  stateTemplate({
    id: "netapp-node-not-healthy",
    name: "Node Not Healthy",
    summary: "ONTAP reports a node not healthy for 10 minutes.",
    description:
      "Alert when ONTAP reports a node not healthy for ten minutes (netapp_node_new_status): down, taken over by its partner, or reporting a problem. One incident per node.",
    category: "Hardware",
    severity: "Critical",
    metricAlias: "node_healthy",
    metricName: "netapp_node_new_status",
    groupByAttributeKey: "node",
    incidentTitle: "[Storage Array] CRITICAL: Node Not Healthy",
    incidentDescription:
      "ONTAP reports a node not healthy (the node label names it). Run `system node show` and `storage failover show` on the cluster: if its partner took over, its storage is served from the partner with no redundancy left. Check the node's console or service processor (`system service-processor show`).",
    criteriaName: "Node Not Healthy",
    criteriaDescription:
      "Triggers when every reading of a node's health in the window is not healthy.",
  }),
  openProblemTemplate({
    id: "netapp-takeover-not-possible",
    name: "Takeover Not Possible",
    summary: "A node could not take over its HA partner.",
    description:
      "Alert while a node of an HA pair could not take over its partner (netapp_health_ha_alerts: storage failover show reports takeover not possible), one incident per node: it has taken over its partner, its partner has taken it over, or the HA interconnect is down. The pair has lost its redundancy until it is resolved; the incident resolves when ONTAP reports takeover possible again.",
    category: "Hardware",
    severity: "Critical",
    metricAlias: "takeover_not_possible",
    metricName: "netapp_health_ha_alerts",
    groupByAttributeKey: "node",
    incidentTitle: "[Storage Array] CRITICAL: Takeover Not Possible",
    incidentDescription:
      "A node can no longer take over its HA partner (the node label names it, partner its partner, state_description why). Run `storage failover show` on the cluster. After a takeover, fix the down node and give its storage back (`storage failover giveback`); otherwise check the HA interconnect.",
    criteriaName: "HA Takeover Not Possible",
    criteriaDescription:
      "Triggers while ONTAP reports that a node could not take over its partner.",
  }),
  openProblemTemplate({
    id: "netapp-disk-failed",
    name: "Disk Failed",
    summary: "A disk is broken.",
    description:
      "Alert while ONTAP reports a disk broken (netapp_health_disk_alerts, container_type broken), one incident per disk, which resolves once the disk is replaced or no longer broken.",
    category: "Hardware",
    severity: "Critical",
    metricAlias: "broken_disks",
    metricName: "netapp_health_disk_alerts",
    attributes: { container_type: "broken" },
    groupByAttributeKey: "disk",
    incidentTitle: "[Storage Array] CRITICAL: Disk Failed",
    incidentDescription:
      "A disk is broken (the disk label names it). Its RAID group reconstructs onto a spare and runs degraded until it has; with no spare left it stays degraded. Check `storage disk show -broken` and `storage aggregate show-spare-disks`, and replace the disk.",
    criteriaName: "Disk Broken",
    criteriaDescription: "Triggers while ONTAP reports any disk broken.",
  }),
  openProblemTemplate({
    id: "netapp-shelf-fault",
    name: "Shelf Fault",
    summary: "ONTAP reports an error on a disk shelf.",
    description:
      "Alert while ONTAP reports an error on a disk shelf (netapp_health_shelf_alerts, severity error: storage shelf show's error_type and error_text), one incident per shelf, which resolves when ONTAP clears it.",
    category: "Hardware",
    severity: "Critical",
    metricAlias: "shelf_faults",
    metricName: "netapp_health_shelf_alerts",
    attributes: { severity: "error" },
    groupByAttributeKey: "shelf",
    incidentTitle: "[Storage Array] CRITICAL: Shelf Fault",
    incidentDescription:
      "A disk shelf reports an error (the shelf label names it, error_type and error_text what). Run `storage shelf show -errors` on the cluster: a failed power supply or fan leaves the shelf without redundancy, and a lost path or module can take its disks away from a node.",
    criteriaName: "Shelf Error",
    criteriaDescription:
      "Triggers while ONTAP reports an error on any disk shelf.",
  }),
  {
    id: "netapp-node-fan-failed",
    name: "Node Fan Failed",
    summary: "A node's chassis fan stops running at its speed.",
    description:
      "Alert when a node reports a chassis fan not running within its recommended speed (netapp_node_failed_fan), one incident per node.",
    category: "Hardware",
    severity: "Warning",
    metricAlias: "failed_fans",
    metricName: "netapp_node_failed_fan",
    groupByAttributeKey: "node",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 0 },
    incidentTitle: "[Storage Array] Node Fan Failed",
    incidentDescription:
      "A node reports a failed chassis fan (the node label names it). Run `system node environment sensors show -node <node>` and `system chassis fru show` on the cluster, and replace the fan before the controller overheats.",
    criteriaName: "Failed Fans > 0",
    criteriaDescription:
      "Triggers while a node reports at least one failed fan.",
  },
  {
    id: "netapp-node-power-supply-failed",
    name: "Node Power Supply Failed",
    summary: "A node's power supply fails.",
    description:
      "Alert when a node reports a failed power supply (netapp_node_failed_power), one incident per node: it runs on its remaining supply.",
    category: "Hardware",
    severity: "Critical",
    metricAlias: "failed_power_supplies",
    metricName: "netapp_node_failed_power",
    groupByAttributeKey: "node",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 0 },
    incidentTitle: "[Storage Array] CRITICAL: Node Power Supply Failed",
    incidentDescription:
      "A node reports a failed power supply (the node label names it) and runs on its last one. Check `system chassis fru show` on the cluster and the supply's power feed, and replace it.",
    criteriaName: "Failed Power Supplies > 0",
    criteriaDescription:
      "Triggers while a node reports at least one failed power supply.",
  },
  stateTemplate({
    id: "netapp-shelf-power-supply-failed",
    name: "Shelf Power Supply Failed",
    summary: "A disk shelf's power supply reports a problem.",
    description:
      "Alert when a disk shelf's power supply reports anything but normal (netapp_shelf_psu_status, 0 while it does), one incident per shelf.",
    category: "Hardware",
    severity: "Critical",
    metricAlias: "shelf_power_supply_normal",
    metricName: "netapp_shelf_psu_status",
    groupByAttributeKey: "shelf",
    incidentTitle: "[Storage Array] CRITICAL: Shelf Power Supply Failed",
    incidentDescription:
      "A disk shelf's power supply is not normal (the shelf label names the shelf, psu_id the supply). Run `storage shelf show -shelf <shelf> -power` on the cluster, check its power feed, and replace it: the shelf has no redundant power left.",
    criteriaName: "Shelf Power Supply Not Normal",
    criteriaDescription:
      "Triggers while every reading of a shelf power supply in the window is not normal.",
  }),
  stateTemplate({
    id: "netapp-shelf-fan-failed",
    name: "Shelf Fan Failed",
    summary: "A disk shelf's fan reports a problem.",
    description:
      "Alert when a disk shelf's fan reports anything but normal (netapp_shelf_fan_status, 0 while it does), one incident per shelf.",
    category: "Hardware",
    severity: "Warning",
    metricAlias: "shelf_fan_normal",
    metricName: "netapp_shelf_fan_status",
    groupByAttributeKey: "shelf",
    incidentTitle: "[Storage Array] Shelf Fan Failed",
    incidentDescription:
      "A disk shelf's fan is not normal (the shelf label names the shelf, fan_id the fan). Run `storage shelf show -shelf <shelf> -cooling` on the cluster and replace the fan module: the shelf's disks may run hot.",
    criteriaName: "Shelf Fan Not Normal",
    criteriaDescription:
      "Triggers while every reading of a shelf fan in the window is not normal.",
  }),
  openProblemTemplate({
    id: "netapp-ethernet-port-down",
    name: "Ethernet Port Down",
    summary: "An enabled Ethernet port's link goes down.",
    description:
      "Alert while an enabled Ethernet port's link is down (netapp_health_network_ethernet_port_alerts), one incident per port, which resolves when the link comes back.",
    category: "Hardware",
    severity: "Warning",
    metricAlias: "ethernet_ports_down",
    metricName: "netapp_health_network_ethernet_port_alerts",
    groupByAttributeKey: "port",
    scopeAttributeKeys: ["node"],
    incidentTitle: "[Storage Array] Ethernet Port Down",
    incidentDescription:
      "An enabled Ethernet port's link is down (the port label names it, node its node). Its LIFs fail over to another port of their failover group if there is one. Check `network port show` on the cluster, the cable, the optic and the switch port, or disable the port if it is unused.",
    criteriaName: "Ethernet Port Down",
    criteriaDescription:
      "Triggers while ONTAP reports an enabled Ethernet port down.",
  }),
  {
    id: "netapp-fc-port-link-failures",
    name: "FC Port Link Failures",
    summary: "A Fibre Channel port's link fails, in the last 15 minutes.",
    description:
      "Alert when a Fibre Channel port counts link failures in the last 15 minutes (netapp_fcp_link_failure), one incident per port. A link that keeps failing takes its hosts' paths through the port up and down.",
    category: "Hardware",
    severity: "Warning",
    metricAlias: "fc_link_failures",
    metricName: "netapp_fcp_link_failure",
    groupByAttributeKey: "port",
    scopeAttributeKeys: ["node"],
    /*
     * Each reading is the failures of one Harvest poll: any above 0 in the
     * window is a failure in it. A sum would count a poll the collector
     * scraped twice twice.
     */
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 0 },
    incidentTitle: "[Storage Array] FC Port Link Failures",
    incidentDescription:
      "A Fibre Channel port's link failed in the last 15 minutes (the port label names it, node its node). Check `network fcp adapter show -instance` on the cluster, then the optic, the cable and the switch port's error counters: a failing optic usually shows rising loss of signal and invalid CRCs too.",
    criteriaName: "FC Link Failures > 0",
    criteriaDescription:
      "Triggers when a Fibre Channel port counts any link failure over the monitoring window.",
  },

  // ---------------- Replication ----------------
  {
    id: "netapp-snapmirror-behind-schedule",
    name: "SnapMirror Behind Schedule",
    summary:
      "A SnapMirror relationship falls one and a half schedule intervals behind.",
    description:
      "Alert when a SnapMirror relationship's lag (netapp_snapmirror_lag_time) is more than 150% of its schedule's interval (netapp_snapmirror_schedule_seconds, which the Storage Array Agent writes from the relationship's schedule), Active IQ Unified Manager's lag warning, one incident per relationship: an hourly relationship more than 90 minutes behind. A relationship on a schedule the agent does not know, or none, is watched by SnapMirror Lag Above 1 Day instead.",
    category: "Replication",
    severity: "Warning",
    metricAlias: "lag_seconds",
    metricName: "netapp_snapmirror_lag_time",
    groupByAttributeKey: "destination_location",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past15Minutes,
    fire: {
      filterType: FilterType.GreaterThan,
      value: ONTAP_SNAPMIRROR_SCHEDULE_LAG_RATIO,
    },
    recover: {
      filterType: FilterType.LessThanOrEqualTo,
      value: ONTAP_SNAPMIRROR_SCHEDULE_LAG_RATIO,
    },
    ratioTo: {
      metricAlias: "schedule_seconds",
      metricName: "netapp_snapmirror_schedule_seconds",
      aggregationType: MetricsAggregationType.Max,
      formulaAlias: "lag_over_schedule",
      unit: "",
    },
    incidentTitle: "[Storage Array] SnapMirror Behind Schedule",
    incidentDescription:
      "A SnapMirror relationship is more than one and a half schedule intervals behind its source (the destination_location label names it), so a failover now would lose more than its schedule promises. Run `snapmirror show -destination-path <destination> -fields lag-time,healthy,unhealthy-reason,last-transfer-error` on the destination cluster: a transfer that failed, one still running, a quiesced relationship, or an intercluster network that cannot keep up.",
    criteriaName: "Lag > 150% of Schedule",
    criteriaDescription:
      "Triggers when a relationship's lag is more than 1.5 times its schedule's interval over the monitoring window.",
  },
  openProblemTemplate({
    id: "netapp-snapmirror-unhealthy",
    name: "SnapMirror Relationship Unhealthy",
    summary: "ONTAP reports a SnapMirror relationship unhealthy.",
    description:
      "Alert while ONTAP reports a SnapMirror relationship unhealthy (netapp_snapmirror_labels, healthy false: a transfer failed, the relationship is broken off or quiesced, its source is unreachable), one incident per relationship, which resolves when ONTAP reports it healthy again.",
    category: "Replication",
    severity: "Critical",
    metricAlias: "unhealthy_relationships",
    metricName: "netapp_snapmirror_labels",
    attributes: { healthy: "false" },
    groupByAttributeKey: "destination_location",
    incidentTitle:
      "[Storage Array] CRITICAL: SnapMirror Relationship Unhealthy",
    incidentDescription:
      "ONTAP reports a SnapMirror relationship unhealthy (the destination_location label names it, unhealthy_reason why). Run `snapmirror show -destination-path <destination> -instance` on the destination cluster, fix what the reason says (`snapmirror resume`, `snapmirror resync`, the cluster peer), and watch the next transfer succeed.",
    criteriaName: "SnapMirror Unhealthy",
    criteriaDescription:
      "Triggers while ONTAP reports any SnapMirror relationship unhealthy.",
  }),
  {
    id: "netapp-snapmirror-lag-day",
    name: "SnapMirror Lag Above 1 Day",
    summary: "A SnapMirror relationship falls more than a day behind.",
    description:
      "Alert when a SnapMirror relationship is more than a day behind its source (netapp_snapmirror_lag_time), whatever its schedule, one incident per relationship.",
    category: "Replication",
    severity: "Warning",
    metricAlias: "lag_seconds",
    metricName: "netapp_snapmirror_lag_time",
    groupByAttributeKey: "destination_location",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 86400 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 86400 },
    incidentTitle: "[Storage Array] SnapMirror Lag Above 1 Day",
    incidentDescription:
      "A SnapMirror relationship is more than a day behind its source (the destination_location label names it). Run `snapmirror show -destination-path <destination> -fields lag-time,schedule,healthy,last-transfer-error` on the destination cluster.",
    criteriaName: "Lag > 1 Day",
    criteriaDescription:
      "Triggers when a relationship's lag stays above 86400 seconds over the monitoring window.",
  },

  // ---------------- Availability ----------------
  stateTemplate({
    id: "netapp-aggregate-offline",
    name: "Aggregate Offline",
    summary: "An aggregate is not online for 10 minutes.",
    description:
      "Alert when an aggregate is not online for ten minutes (netapp_aggr_new_status): offline, restricted or failed. Every volume on it is unavailable. One incident per aggregate.",
    category: "Availability",
    severity: "Critical",
    metricAlias: "aggregate_online",
    metricName: "netapp_aggr_new_status",
    groupByAttributeKey: "aggr",
    incidentTitle: "[Storage Array] CRITICAL: Aggregate Offline",
    incidentDescription:
      "An aggregate is not online (the aggr label names it), so none of its volumes can be reached. Run `storage aggregate show -aggregate <aggr> -fields state,raidstatus` and `storage aggregate show-status` on the cluster.",
    criteriaName: "Aggregate Not Online",
    criteriaDescription:
      "Triggers when every reading of an aggregate's state in the window is not online.",
  }),
  stateTemplate({
    id: "netapp-volume-offline",
    name: "Volume Offline",
    summary: "A volume is not online for 10 minutes.",
    description:
      "Alert when a volume is not online for ten minutes (netapp_volume_new_status): offline or restricted. Clients cannot reach it. One incident per volume; a volume taken offline on purpose fires it too.",
    category: "Availability",
    severity: "Warning",
    metricAlias: "volume_online",
    metricName: "netapp_volume_new_status",
    groupByAttributeKey: "volume",
    scopeAttributeKeys: ["svm"],
    incidentTitle: "[Storage Array] Volume Offline",
    incidentDescription:
      "A volume is not online (the volume label names it, svm its SVM). Run `volume show -volume <volume> -fields state` on the cluster; bring it back with `volume online` if it was not taken offline on purpose.",
    criteriaName: "Volume Not Online",
    criteriaDescription:
      "Triggers when every reading of a volume's state in the window is not online.",
  }),
  stateTemplate({
    id: "netapp-lun-offline",
    name: "LUN Offline",
    summary: "A LUN is not online for 10 minutes.",
    description:
      "Alert when a LUN is not online for ten minutes (netapp_lun_new_status): its hosts have lost the disk. One incident per LUN.",
    category: "Availability",
    severity: "Critical",
    metricAlias: "lun_online",
    metricName: "netapp_lun_new_status",
    groupByAttributeKey: "lun",
    scopeAttributeKeys: ["volume", "svm"],
    incidentTitle: "[Storage Array] CRITICAL: LUN Offline",
    incidentDescription:
      "A LUN is not online (the lun label names it, volume its volume). A LUN goes offline on its own when its volume runs out of space. Run `lun show -fields state` and `volume show -volume <volume> -fields percent-used` on the cluster, free space if it is full, then `lun online`.",
    criteriaName: "LUN Not Online",
    criteriaDescription:
      "Triggers when every reading of a LUN's state in the window is not online.",
  }),
  /*
   * An SVM's state is a label of its labels series: netapp_svm_new_status
   * is 0 for the admin and node SVMs ONTAP keeps for itself, which have
   * no state, and would fire for them on every cluster.
   */
  openProblemTemplate({
    id: "netapp-svm-stopped",
    name: "SVM Stopped",
    summary: "A data SVM is stopped.",
    description:
      "Alert while a data SVM is stopped (netapp_svm_labels, state stopped and type data): it serves none of its volumes or LUNs. One incident per SVM, which resolves once it runs again; an SVM stopped on purpose (a disaster recovery one) fires it too. The SVMs ONTAP keeps for itself are never watched.",
    category: "Availability",
    severity: "Warning",
    metricAlias: "stopped_svms",
    metricName: "netapp_svm_labels",
    attributes: { state: "stopped", type: "data" },
    groupByAttributeKey: "svm",
    rollingTime: RollingTime.Past10Minutes,
    incidentTitle: "[Storage Array] SVM Stopped",
    incidentDescription:
      "A data SVM is stopped (the svm label names it). Run `vserver show -vserver <svm> -fields state,operational-state` on the cluster; start it with `vserver start` if it was not stopped on purpose.",
    criteriaName: "SVM Stopped",
    criteriaDescription:
      "Triggers while any data SVM is reported stopped in the window.",
  }),
];

export default ONTAP_ALERT_TEMPLATES;
