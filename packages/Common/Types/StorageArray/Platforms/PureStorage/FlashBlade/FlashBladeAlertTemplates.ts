import MetricsAggregationType from "../../../../Metrics/MetricsAggregationType";
import { FilterType } from "../../../../Monitor/CriteriaFilter";
import RollingTime from "../../../../RollingTime/RollingTime";
import {
  STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
  StorageArrayAlertTemplateSpec,
} from "../../../StorageArrayPlatform";

/*
 * The Pure Storage FlashBlade alert templates, as data
 * (StorageArrayAlertTemplates builds each one's monitor step), in the order
 * the picker lists them after Array Stopped Reporting. They are also what
 * an array's Recommendations offers.
 *
 * purefb_alerts_open carries the alert's state in labels with the value 1,
 * so its templates fire on Max > 0 and recover once the series is gone
 * (STORAGE_ARRAY_RECOVER_WHEN_ABSENT). purefb_hardware_health is 1 healthy,
 * 2 unused and 0 anything else, so its template takes the minimum per
 * component.
 *
 * Ids are stored on every monitor made from a template: never change one.
 */
const FLASHBLADE_ALERT_TEMPLATES: Array<StorageArrayAlertTemplateSpec> = [
  {
    id: "purefb-critical-alerts",
    name: "Critical Array Alert",
    summary: "The array raises a critical alert of its own.",
    description:
      "Alert when the FlashBlade raises a critical alert of its own (purefb_alerts_open with severity critical). One incident per alert summary.",
    category: "Array Health",
    severity: "Critical",
    metricAlias: "critical_alerts",
    metricName: "purefb_alerts_open",
    attributes: { severity: "critical" },
    groupByAttributeKey: "summary",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] CRITICAL: Array Alert",
    incidentDescription:
      "The FlashBlade has an open critical alert. The summary label names the problem and the kburl label links Pure's knowledge base article for it. Check the alert in Pure1 or on the array and open a case with Pure Storage support if a component has failed.",
    criteriaName: "Critical Alert Open",
    criteriaDescription:
      "Triggers while the array reports at least one open alert with critical severity.",
  },
  {
    id: "purefb-warning-alerts",
    name: "Warning Array Alert",
    summary: "The array raises a warning alert of its own.",
    description:
      "Alert when the FlashBlade raises a warning alert (purefb_alerts_open with severity warning). One incident per alert summary.",
    category: "Array Health",
    severity: "Warning",
    metricAlias: "warning_alerts",
    metricName: "purefb_alerts_open",
    attributes: { severity: "warning" },
    groupByAttributeKey: "summary",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] Array Warning Alert",
    incidentDescription:
      "The FlashBlade has an open warning alert. The summary label names the problem and the kburl label links the knowledge base article.",
    criteriaName: "Warning Alert Open",
    criteriaDescription:
      "Triggers while the array reports at least one open alert with warning severity.",
  },
  {
    id: "purefb-capacity-high",
    name: "Capacity Above 80%",
    summary: "More than 80% of the array's usable space is in use.",
    description:
      "Alert when more than 80% of the FlashBlade's usable capacity is in use (purefb_array_space_utilization, type array).",
    category: "Capacity",
    severity: "Warning",
    metricAlias: "capacity_used_percent",
    metricName: "purefb_array_space_utilization",
    attributes: { type: "array" },
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 80 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 80 },
    incidentTitle: "[Storage Array] Capacity Above 80%",
    incidentDescription:
      "More than 80% of the FlashBlade's usable capacity is in use. Check which file systems and buckets are growing, expire snapshots and old object versions, or plan more blades.",
    criteriaName: "Capacity Used > 80%",
    criteriaDescription:
      "Triggers when array space utilization stays above 80% over the monitoring window.",
  },
  {
    id: "purefb-capacity-critical",
    name: "Capacity Above 90%",
    summary: "More than 90% of the array's usable space is in use.",
    description:
      "Alert when more than 90% of the FlashBlade's usable capacity is in use (purefb_array_space_utilization, type array).",
    category: "Capacity",
    severity: "Critical",
    metricAlias: "capacity_used_percent",
    metricName: "purefb_array_space_utilization",
    attributes: { type: "array" },
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 90 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 90 },
    incidentTitle: "[Storage Array] CRITICAL: Capacity Above 90%",
    incidentDescription:
      "More than 90% of the FlashBlade's usable capacity is in use. When it fills, writes fail for every client. Free space now: delete or move data, eradicate destroyed file systems and buckets, and expire snapshots.",
    criteriaName: "Capacity Used > 90%",
    criteriaDescription:
      "Triggers when array space utilization exceeds 90% over the monitoring window.",
  },
  {
    id: "purefb-hardware-unhealthy",
    name: "Hardware Component Unhealthy",
    summary: "A blade, fabric module, power supply or fan is unhealthy.",
    description:
      "Alert when a FlashBlade hardware component stops reporting healthy (purefb_hardware_health below 1) — a blade, fabric module, power supply or fan. One incident per component.",
    category: "Hardware",
    severity: "Critical",
    metricAlias: "hardware_health",
    metricName: "purefb_hardware_health",
    groupByAttributeKey: "name",
    /*
     * Min per component: 1 = healthy, 2 = unused (an empty slot), anything
     * else is exported as 0, so a single unhealthy scrape trips the
     * threshold instead of being averaged away.
     */
    aggregationType: MetricsAggregationType.Min,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.LessThan, value: 1 },
    recover: {
      filterType: FilterType.GreaterThanOrEqualTo,
      value: 1,
      /*
       * 0 / 1 / 2 only, so the shared 10% recovery dead band would put this
       * at `>= 1.1` — reachable only by an unused slot, never by a repaired
       * component.
       */
      isBinaryMetric: true,
    },
    incidentTitle: "[Storage Array] CRITICAL: Hardware Component Unhealthy",
    incidentDescription:
      "A FlashBlade hardware component is not healthy. The name label names it. Check the array's hardware status and open alerts, and open a case with Pure Storage support for a replacement.",
    criteriaName: "Component Unhealthy",
    criteriaDescription:
      "Triggers when any hardware component reports a health below 1.",
  },
  {
    id: "purefb-read-latency-high",
    name: "High Read Latency",
    summary: "Average read latency stays above 10 ms.",
    description:
      "Alert when the FlashBlade's average read latency across all protocols stays above 10 ms (purefb_array_performance_latency_usec, dimension usec_per_read_op, protocol all).",
    category: "Performance",
    severity: "Warning",
    metricAlias: "read_latency_usec",
    metricName: "purefb_array_performance_latency_usec",
    attributes: { dimension: "usec_per_read_op", protocol: "all" },
    aggregationType: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past10Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 10000 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 10000 },
    incidentTitle: "[Storage Array] High Read Latency (>10 ms)",
    incidentDescription:
      "The FlashBlade's average read latency has stayed above 10 ms. Check the per-protocol latency (NFS, SMB, S3), the busiest file systems and buckets, and the clients driving the load.",
    criteriaName: "Read Latency > 10 ms",
    criteriaDescription:
      "Triggers when the average read latency stays above 10000 µs over the monitoring window.",
  },
  {
    id: "purefb-file-system-near-full",
    name: "File System Near Full",
    summary: "A file system has less than 10% of its space left.",
    description:
      "Alert when less than 10% of a FlashBlade file system's provisioned size is still available (purefb_file_systems_space_bytes, space available_ratio). One incident per file system.",
    category: "File Systems",
    severity: "Warning",
    metricAlias: "available_ratio",
    metricName: "purefb_file_systems_space_bytes",
    attributes: { space: "available_ratio" },
    groupByAttributeKey: "name",
    aggregationType: MetricsAggregationType.Min,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.LessThan, value: 0.1 },
    recover: { filterType: FilterType.GreaterThanOrEqualTo, value: 0.1 },
    incidentTitle: "[Storage Array] File System Near Full",
    incidentDescription:
      "A FlashBlade file system has less than 10% of its provisioned size left. With a hard limit, writes to it fail once it is full. Grow the file system, delete data, or expire its snapshots.",
    criteriaName: "Available < 10%",
    criteriaDescription:
      "Triggers when any file system has less than 10% of its provisioned size available.",
  },
];

export default FLASHBLADE_ALERT_TEMPLATES;
