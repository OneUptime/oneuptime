import MetricsAggregationType from "../../../../Metrics/MetricsAggregationType";
import { FilterType } from "../../../../Monitor/CriteriaFilter";
import RollingTime from "../../../../RollingTime/RollingTime";
import {
  STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
  StorageArrayAlertTemplateSpec,
} from "../../../StorageArrayPlatform";
import {
  POWERMAX_LABELS,
  POWERMAX_METRICS,
  POWERMAX_OPERATIONS,
} from "./PowerMaxSeries";

/*
 * The Dell PowerMax alert templates, as data (StorageArrayAlertTemplates
 * builds each one's monitor step), in the order the picker lists them after
 * Array Stopped Reporting. They are also what an array's Recommendations
 * offers: the failures PowerMax owners fear most - a Unisphere alert, a
 * director or port down, a storage resource pool filling, SRDF suspended or
 * falling behind, storage groups slowing down.
 *
 * Presence contract, as Pure's: powermax_alert_open, powermax_director_offline,
 * powermax_port_offline and powermax_srdf_group_not_healthy exist only while
 * the object is in that state (value 1), so those templates fire on Max > 0
 * and recover once the series is gone (STORAGE_ARRAY_RECOVER_WHEN_ABSENT).
 *
 * Unisphere computes performance every 5 minutes, so a window holds one
 * sample per 5 minutes: a 15-minute average is three of them, which keeps
 * one busy interval from paging anyone.
 *
 * Ids are stored on every monitor made from a template: never change one.
 */

const M: typeof POWERMAX_METRICS = POWERMAX_METRICS;
const L: typeof POWERMAX_LABELS = POWERMAX_LABELS;

// The array's read and write response time alerts' line (3 ms).
export const POWERMAX_RESPONSE_TIME_WARNING_USEC: number = 3000;

// A storage group's response time alert's line (5 ms).
export const POWERMAX_STORAGE_GROUP_RESPONSE_TIME_WARNING_USEC: number = 5000;

const POWERMAX_ALERT_TEMPLATES: Array<StorageArrayAlertTemplateSpec> = [
  {
    id: "powermax-critical-alerts",
    name: "Critical Unisphere Alert",
    summary: "Unisphere raises a critical or fatal alert for the array.",
    description:
      "Alert when Unisphere for PowerMax has an open alert of severity Critical or Fatal for the array (powermax_alert_open with severity critical) — a director, drive, power supply or link failure, a pool out of space, a replication failure. One incident per alert. Acknowledging the alert in Unisphere recovers it here.",
    category: "Array Health",
    severity: "Critical",
    metricAlias: "critical_alerts",
    metricName: M.alertOpen,
    attributes: { [L.severity]: "critical" },
    groupByAttributeKey: L.description,
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] CRITICAL: Unisphere Alert",
    incidentDescription:
      "Unisphere for PowerMax has an open Critical or Fatal alert for the array. The description label on the series says what failed, and the object and object_type labels name the part. Open the alert in Unisphere (System > Alerts), follow its recommended action, and open a case with Dell support if a part has failed — the array usually dials home already. Acknowledge the alert in Unisphere once handled.",
    criteriaName: "Critical Unisphere Alert Open",
    criteriaDescription:
      "Triggers while Unisphere reports at least one unacknowledged Critical or Fatal alert for the array.",
  },
  {
    id: "powermax-warning-alerts",
    name: "Warning Unisphere Alert",
    summary: "Unisphere raises a warning or minor alert for the array.",
    description:
      "Alert when Unisphere for PowerMax has an open alert of severity Warning or Minor for the array (powermax_alert_open with severity warning). One incident per alert.",
    category: "Array Health",
    severity: "Warning",
    metricAlias: "warning_alerts",
    metricName: M.alertOpen,
    attributes: { [L.severity]: "warning" },
    groupByAttributeKey: L.description,
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] Unisphere Warning Alert",
    incidentDescription:
      "Unisphere for PowerMax has an open Warning or Minor alert for the array. The description label says what it is about. Review it in Unisphere (System > Alerts) before it turns critical, and acknowledge it there once handled.",
    criteriaName: "Warning Unisphere Alert Open",
    criteriaDescription:
      "Triggers while Unisphere reports at least one unacknowledged Warning or Minor alert for the array.",
  },
  {
    id: "powermax-director-offline",
    name: "Director Not Online",
    summary: "A director of the array is not online.",
    description:
      "Alert when a director (front end, back end, SRDF or infrastructure) is not online (powermax_director_offline). One incident per director. Hosts keep their paths through the other directors until another one fails.",
    category: "Hardware",
    severity: "Critical",
    metricAlias: "director_offline",
    metricName: M.directorOffline,
    groupByAttributeKey: L.director,
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] CRITICAL: Director Not Online",
    incidentDescription:
      "A director of the PowerMax is not online: the director label names it and the status label says what Unisphere reports. Its ports serve nothing until it is back, so the hosts and replicas it carried run on fewer paths. Check Unisphere's alerts for the director and open a case with Dell support.",
    criteriaName: "Director Not Online",
    criteriaDescription:
      "Triggers while any director of the array is not online.",
  },
  {
    id: "powermax-port-offline",
    name: "Port Down",
    summary: "A port that serves hosts or SRDF is not up.",
    description:
      "Alert when a front end or SRDF port in use — in a port group, a masking view or an SRDF group — is not up (powermax_port_offline). Ports nobody uses are left out, since they may be off on purpose. One incident per port.",
    category: "Hardware",
    severity: "Warning",
    metricAlias: "port_offline",
    metricName: M.portOffline,
    groupByAttributeKey: L.portId,
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] Port Down",
    incidentDescription:
      "A PowerMax port in use is not up: the port_id label names it (director:port) and the status label says what Unisphere reports. Hosts zoned to it lose that path. Check the cable, the optic and the switch port it connects to, and the port's state in Unisphere.",
    criteriaName: "Port In Use Down",
    criteriaDescription:
      "Triggers while any port in a port group, masking view or SRDF group is not up.",
  },
  {
    id: "powermax-srp-capacity-high",
    name: "Storage Resource Pool Above 80%",
    summary: "A storage resource pool is more than 80% full.",
    description:
      "Alert when a storage resource pool's used capacity is above 80% of its usable capacity (powermax_srp_capacity_used_percent), and recover below 75%. One incident per pool.",
    category: "Capacity",
    severity: "Warning",
    metricAlias: "srp_used_percent",
    metricName: M.srpUsedPercent,
    groupByAttributeKey: L.srp,
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 80 },
    recover: { filterType: FilterType.LessThan, value: 75 },
    incidentTitle: "[Storage Array] Storage Resource Pool Above 80%",
    incidentDescription:
      "A storage resource pool of the PowerMax is more than 80% full (the srp label names it). Every storage group in it stops taking new writes when it fills. Free space (unused snapshots, unmapped volumes), move storage groups to another pool, or add capacity.",
    criteriaName: "Pool Used > 80%",
    criteriaDescription:
      "Triggers when a storage resource pool's used capacity is above 80%.",
  },
  {
    id: "powermax-srp-capacity-critical",
    name: "Storage Resource Pool Above 90%",
    summary: "A storage resource pool is more than 90% full.",
    description:
      "Alert when a storage resource pool's used capacity is above 90% of its usable capacity, and recover below 85%. One incident per pool.",
    category: "Capacity",
    severity: "Critical",
    metricAlias: "srp_used_percent",
    metricName: M.srpUsedPercent,
    groupByAttributeKey: L.srp,
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 90 },
    recover: { filterType: FilterType.LessThan, value: 85 },
    incidentTitle: "[Storage Array] CRITICAL: Storage Resource Pool Above 90%",
    incidentDescription:
      "A storage resource pool of the PowerMax is more than 90% full (the srp label names it). Writes to its storage groups fail once it is full. Free space now, or move storage groups off it.",
    criteriaName: "Pool Used > 90%",
    criteriaDescription:
      "Triggers when a storage resource pool's used capacity is above 90%.",
  },
  {
    id: "powermax-srdf-group-not-healthy",
    name: "SRDF Group Suspended or Offline",
    summary:
      "An SRDF group stops replicating: suspended, partitioned, split, failed over or offline.",
    description:
      "Alert when an SRDF group's link is offline or its pairs are suspended, partitioned, split, failed over or invalid (powermax_srdf_group_not_healthy). One incident per SRDF group. While it lasts, the remote copy falls further behind with every write.",
    category: "Replication",
    severity: "Critical",
    metricAlias: "srdf_not_healthy",
    metricName: M.srdfGroupNotHealthy,
    groupByAttributeKey: L.srdfGroup,
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] CRITICAL: SRDF Group Not Replicating",
    incidentDescription:
      "An SRDF group of the PowerMax is not replicating (the srdf_group label names it, the state label says how and remote_symmetrix_id names the other array). Its remote copy is not being kept current, so a failover now would lose every write since. Check the SRDF links and the remote array, then resume the group in Unisphere (Data Protection > SRDF).",
    criteriaName: "SRDF Group Not Healthy",
    criteriaDescription:
      "Triggers while any SRDF group is offline, or any of its pairs is suspended, partitioned, split, failed over or invalid.",
  },
  {
    id: "powermax-srdf-lag-high",
    name: "SRDF/A Lag Above 2 Minutes",
    summary:
      "An asynchronous SRDF group's remote copy is more than 2 minutes behind.",
    description:
      "Alert when an asynchronous SRDF group's remote copy averages more than 120 seconds behind over 15 minutes (powermax_srdf_group_lag_seconds), and recover at 60 seconds or less. SRDF/A normally runs about two cycles (around 30 seconds) behind. One incident per SRDF group.",
    category: "Replication",
    severity: "Warning",
    metricAlias: "srdf_lag_seconds",
    metricName: M.srdfGroupLagSeconds,
    groupByAttributeKey: L.srdfGroup,
    aggregationType: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 120 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 60 },
    incidentTitle: "[Storage Array] SRDF/A Lag Above 2 Minutes",
    incidentDescription:
      "An asynchronous SRDF group's remote copy is more than two minutes behind (the srdf_group label names it), so a failover now would lose more recent writes than planned. Check the SRDF link bandwidth and errors, the SRDF directors' busy, and whether a burst of writes outran the link. Delta Set Extension filling up means the group may soon drop.",
    criteriaName: "SRDF/A Lag > 120 s",
    criteriaDescription:
      "Triggers when an SRDF/A group's lag averages more than 120 seconds over 15 minutes.",
  },
  {
    id: "powermax-storage-group-response-time-high",
    name: "Storage Group Response Time Above 5 ms",
    summary: "A storage group's I/O takes longer than 5 ms on average.",
    description:
      "Alert when a storage group's response time averages more than 5 ms over 15 minutes (powermax_storage_group_response_time_usec above 5000), and recover below 3 ms. One incident per storage group. A PowerMax normally answers in well under a millisecond.",
    category: "Performance",
    severity: "Warning",
    metricAlias: "storage_group_response_time_usec",
    metricName: M.storageGroupResponseTime,
    groupByAttributeKey: L.storageGroup,
    aggregationType: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past15Minutes,
    fire: {
      filterType: FilterType.GreaterThan,
      value: POWERMAX_STORAGE_GROUP_RESPONSE_TIME_WARNING_USEC,
    },
    recover: { filterType: FilterType.LessThan, value: 3000 },
    incidentTitle: "[Storage Array] Storage Group Response Time Above 5 ms",
    incidentDescription:
      "A PowerMax storage group's I/O takes more than 5 ms on average (the storage_group label names it). The applications on it slow down. Check whether it hit its host I/O limit or service level, whether its front end directors or ports are busy, and whether a few volumes carry most of its load.",
    criteriaName: "Storage Group Response Time > 5 ms",
    criteriaDescription:
      "Triggers when a storage group's response time averages more than 5000 µs over 15 minutes.",
  },
  {
    id: "powermax-read-response-time-high",
    name: "High Read Response Time",
    summary: "Host reads on the array take longer than 3 ms on average.",
    description:
      "Alert when the array's read response time averages more than 3 ms over 15 minutes (powermax_array_response_time_usec, operation read), and recover below 2 ms.",
    category: "Performance",
    severity: "Warning",
    metricAlias: "read_response_time_usec",
    metricName: M.arrayResponseTime,
    attributes: { [L.operation]: POWERMAX_OPERATIONS.read },
    aggregationType: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past15Minutes,
    fire: {
      filterType: FilterType.GreaterThan,
      value: POWERMAX_RESPONSE_TIME_WARNING_USEC,
    },
    recover: { filterType: FilterType.LessThan, value: 2000 },
    incidentTitle: "[Storage Array] High Read Response Time",
    incidentDescription:
      "Host reads on the PowerMax average more than 3 ms. Look at the storage groups with the highest response time, the cache hit share, and the back end directors' busy.",
    criteriaName: "Read Response Time > 3 ms",
    criteriaDescription:
      "Triggers when the array's read response time averages more than 3000 µs over 15 minutes.",
  },
  {
    id: "powermax-write-response-time-high",
    name: "High Write Response Time",
    summary: "Host writes on the array take longer than 3 ms on average.",
    description:
      "Alert when the array's write response time averages more than 3 ms over 15 minutes (powermax_array_response_time_usec, operation write), and recover below 2 ms. Synchronous SRDF adds the round trip to the remote array to every write.",
    category: "Performance",
    severity: "Warning",
    metricAlias: "write_response_time_usec",
    metricName: M.arrayResponseTime,
    attributes: { [L.operation]: POWERMAX_OPERATIONS.write },
    aggregationType: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past15Minutes,
    fire: {
      filterType: FilterType.GreaterThan,
      value: POWERMAX_RESPONSE_TIME_WARNING_USEC,
    },
    recover: { filterType: FilterType.LessThan, value: 2000 },
    incidentTitle: "[Storage Array] High Write Response Time",
    incidentDescription:
      "Host writes on the PowerMax average more than 3 ms. Check the write pending share of the cache, synchronous SRDF response time, and the storage groups with the highest write response time.",
    criteriaName: "Write Response Time > 3 ms",
    criteriaDescription:
      "Triggers when the array's write response time averages more than 3000 µs over 15 minutes.",
  },
  {
    id: "powermax-performance-collection-off",
    name: "Performance Collection Off",
    summary: "Unisphere stops collecting performance data for the array.",
    description:
      "Alert when Unisphere is not collecting 5-minute performance data for the array (powermax_array_performance_collection is 0), and recover once it is. Without it, no response time, IOPS or throughput is charted or alerted on.",
    category: "Array Health",
    severity: "Warning",
    metricAlias: "performance_collection",
    metricName: M.arrayPerformanceCollection,
    aggregationType: MetricsAggregationType.Min,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.LessThan, value: 1 },
    recover: { filterType: FilterType.GreaterThanOrEqualTo, value: 1 },
    incidentTitle: "[Storage Array] Performance Collection Off",
    incidentDescription:
      "Unisphere for PowerMax is not collecting performance data for the array, so OneUptime charts and alerts on none. Turn it on in Unisphere at Settings > Performance > System Registrations (Diagnostic), with an account that may change settings.",
    criteriaName: "Performance Collection Off",
    criteriaDescription:
      "Triggers while Unisphere reports diagnostic performance collection off for the array.",
  },
];

export default POWERMAX_ALERT_TEMPLATES;
