import MetricsAggregationType from "../../../../Metrics/MetricsAggregationType";
import { FilterType } from "../../../../Monitor/CriteriaFilter";
import RollingTime from "../../../../RollingTime/RollingTime";
import {
  STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
  StorageArrayAlertTemplateSpec,
} from "../../../StorageArrayPlatform";

// The High Protocol Latency alert's line (20 ms).
export const POWERSCALE_PROTOCOL_LATENCY_WARNING_USEC: number = 20000;

/*
 * The Dell PowerScale alert templates, as data (StorageArrayAlertTemplates
 * builds each one's monitor step), in the order the picker lists them after
 * Array Stopped Reporting. They are also what an array's Recommendations
 * offers.
 *
 * Health is OneFS's own: 0 ok, 1 attention, 2 down, 3 invalid, for the
 * cluster and for each node. A drive's status rides on its series as a
 * label, so a drive template counts the series in that status and recovers
 * once none is left (STORAGE_ARRAY_RECOVER_WHEN_ABSENT). A quota's fullness
 * is its usage as a share of its hard limit, or its soft limit when it has
 * no hard one: the collector works it out
 * (agents/StorageArrayAgent/otel-collector-config.powerscale.yaml).
 *
 * Ids are stored on every monitor made from a template: never change one.
 */
const POWERSCALE_ALERT_TEMPLATES: Array<StorageArrayAlertTemplateSpec> = [
  {
    id: "powerscale-cluster-needs-attention",
    name: "Cluster Needs Attention",
    summary: "OneFS reports the cluster is not healthy.",
    description:
      "Alert when OneFS reports the cluster's health as anything but OK (powerscale_cluster_health above 0): attention, down or invalid. OneFS's own events say why.",
    category: "Array Health",
    severity: "Warning",
    metricAlias: "cluster_health",
    metricName: "powerscale_cluster_health",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: {
      filterType: FilterType.LessThanOrEqualTo,
      value: 0,
      isBinaryMetric: true,
    },
    incidentTitle: "[Storage Array] PowerScale Cluster Needs Attention",
    incidentDescription:
      "OneFS reports the PowerScale cluster is not healthy. Run `isi status` and `isi event groups list` on the cluster, or open the OneFS web administration interface, to see which node, drive or service raised it.",
    criteriaName: "Cluster Not Healthy",
    criteriaDescription:
      "Triggers while the cluster's health is attention, down or invalid.",
  },
  {
    id: "powerscale-cluster-down",
    name: "Cluster Down",
    summary: "OneFS reports the cluster down.",
    description:
      "Alert when OneFS reports the cluster's health as down or invalid (powerscale_cluster_health 2 or more).",
    category: "Array Health",
    severity: "Critical",
    metricAlias: "cluster_health",
    metricName: "powerscale_cluster_health",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThanOrEqualTo, value: 2 },
    recover: {
      filterType: FilterType.LessThan,
      value: 2,
      isBinaryMetric: true,
    },
    incidentTitle: "[Storage Array] CRITICAL: PowerScale Cluster Down",
    incidentDescription:
      "OneFS reports the PowerScale cluster down. Clients may have lost access to /ifs. Check `isi status` on a node that answers, and open a case with Dell support.",
    criteriaName: "Cluster Down",
    criteriaDescription:
      "Triggers while the cluster's health is down or invalid.",
  },
  {
    id: "powerscale-node-offline",
    name: "Node Offline",
    summary: "One of the cluster's nodes is offline.",
    description:
      "Alert when one of the cluster's configured nodes is offline (powerscale_cluster_offline_nodes above 0). The offline_nodes label lists their logical node numbers.",
    category: "Hardware",
    severity: "Critical",
    metricAlias: "offline_nodes",
    metricName: "powerscale_cluster_offline_nodes",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: {
      filterType: FilterType.LessThanOrEqualTo,
      value: 0,
      isBinaryMetric: true,
    },
    incidentTitle: "[Storage Array] CRITICAL: PowerScale Node Offline",
    incidentDescription:
      "A node of the PowerScale cluster is offline. The cluster keeps serving data at reduced protection, and another failure may take data offline. The offline_nodes label lists the logical node numbers; check the node's power and back-end network, and `isi status` on the cluster.",
    criteriaName: "Node Offline",
    criteriaDescription: "Triggers while any configured node is offline.",
  },
  {
    id: "powerscale-node-needs-attention",
    name: "Node Needs Attention",
    summary: "OneFS reports a node is not healthy.",
    description:
      "Alert when OneFS reports a node's health as anything but OK (powerscale_node_health above 0). One incident per node.",
    category: "Hardware",
    severity: "Warning",
    metricAlias: "node_health",
    metricName: "powerscale_node_health",
    groupByAttributeKey: "node",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: {
      filterType: FilterType.LessThanOrEqualTo,
      value: 0,
      isBinaryMetric: true,
    },
    incidentTitle: "[Storage Array] PowerScale Node Needs Attention",
    incidentDescription:
      "OneFS reports a node of the PowerScale cluster is not healthy. The node label names it. A failed or smartfailing drive, a fan, a power supply or a boot drive are the usual causes: check the node's drives and sensors on the Hardware tab and `isi event groups list` on the cluster.",
    criteriaName: "Node Not Healthy",
    criteriaDescription:
      "Triggers while any node's health is attention, down or invalid.",
  },
  {
    id: "powerscale-node-read-only",
    name: "Node Read-Only",
    summary: "A node has gone read-only.",
    description:
      "Alert when a node is in read-only mode (powerscale_node_read_only 1). Clients connected to it cannot write. One incident per node.",
    category: "Hardware",
    severity: "Warning",
    metricAlias: "node_read_only",
    metricName: "powerscale_node_read_only",
    groupByAttributeKey: "node",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: {
      filterType: FilterType.LessThanOrEqualTo,
      value: 0,
      isBinaryMetric: true,
    },
    incidentTitle: "[Storage Array] PowerScale Node Read-Only",
    incidentDescription:
      "A node of the PowerScale cluster is in read-only mode, so clients connected to it cannot write. OneFS sets it when a node's journal or NVRAM is at fault, or an administrator sets it. Check `isi readonly list` on the cluster.",
    criteriaName: "Node Read-Only",
    criteriaDescription: "Triggers while any node is read-only.",
  },
  {
    id: "powerscale-drive-dead",
    name: "Drive Failed",
    summary: "A drive reports DEAD.",
    description:
      "Alert when a drive reports the status DEAD (powerscale_drive_size_bytes with status DEAD). One incident per drive.",
    category: "Hardware",
    severity: "Critical",
    metricAlias: "dead_drives",
    metricName: "powerscale_drive_size_bytes",
    attributes: { status: "DEAD" },
    groupByAttributeKey: "drive",
    // The series' value is the drive's size, which a dead drive may report as 0.
    aggregationType: MetricsAggregationType.Count,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] CRITICAL: PowerScale Drive Failed",
    incidentDescription:
      "A drive of the PowerScale cluster has failed. OneFS rebuilds its data onto the other drives (FlexProtect), but protection is reduced until it finishes. The drive label names the node and bay: check `isi devices drive list` on that node and arrange the replacement with Dell support.",
    criteriaName: "Drive Dead",
    criteriaDescription: "Triggers while any drive reports DEAD.",
  },
  {
    id: "powerscale-drive-smartfailed",
    name: "Drive Smartfailed",
    summary: "A drive is being smartfailed.",
    description:
      "Alert when a drive reports the status SMARTFAIL (powerscale_drive_size_bytes with status SMARTFAIL): OneFS is moving its data off before it is replaced. One incident per drive.",
    category: "Hardware",
    severity: "Warning",
    metricAlias: "smartfailed_drives",
    metricName: "powerscale_drive_size_bytes",
    attributes: { status: "SMARTFAIL" },
    groupByAttributeKey: "drive",
    aggregationType: MetricsAggregationType.Count,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: STORAGE_ARRAY_RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] PowerScale Drive Smartfailed",
    incidentDescription:
      "A drive of the PowerScale cluster is being smartfailed: OneFS is moving its data to the other drives, and the drive is to be replaced once that finishes. The drive label names the node and bay. Keep an eye on `isi devices drive list` and arrange the replacement with Dell support.",
    criteriaName: "Drive Smartfailed",
    criteriaDescription: "Triggers while any drive reports SMARTFAIL.",
  },
  {
    id: "powerscale-capacity-high",
    name: "Capacity Above 80%",
    summary: "More than 80% of the cluster's capacity is in use.",
    description:
      "Alert when more than 80% of the cluster's capacity is no longer available for writes (powerscale_ifs_used_percent).",
    category: "Capacity",
    severity: "Warning",
    metricAlias: "capacity_used_percent",
    metricName: "powerscale_ifs_used_percent",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 80 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 80 },
    incidentTitle: "[Storage Array] PowerScale Capacity Above 80%",
    incidentDescription:
      "More than 80% of the PowerScale cluster's capacity is in use. A OneFS cluster needs free space to rebuild after a drive or node fails. Check which quotas and directories are growing, expire snapshots, or plan more nodes.",
    criteriaName: "Capacity Used > 80%",
    criteriaDescription:
      "Triggers when the cluster's capacity used stays above 80% over the monitoring window.",
  },
  {
    id: "powerscale-capacity-critical",
    name: "Capacity Above 90%",
    summary: "More than 90% of the cluster's capacity is in use.",
    description:
      "Alert when more than 90% of the cluster's capacity is no longer available for writes (powerscale_ifs_used_percent).",
    category: "Capacity",
    severity: "Critical",
    metricAlias: "capacity_used_percent",
    metricName: "powerscale_ifs_used_percent",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 90 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 90 },
    incidentTitle: "[Storage Array] CRITICAL: PowerScale Capacity Above 90%",
    incidentDescription:
      "More than 90% of the PowerScale cluster's capacity is in use. A full cluster refuses writes for every client, and a drive or node failure needs free space to rebuild. Free space now: delete or move data, expire snapshots, and add nodes.",
    criteriaName: "Capacity Used > 90%",
    criteriaDescription:
      "Triggers when the cluster's capacity used exceeds 90% over the monitoring window.",
  },
  {
    id: "powerscale-quota-near-limit",
    name: "Quota Near Its Limit",
    summary: "A quota has used more than 90% of its limit.",
    description:
      "Alert when a quota's usage passes 90% of its hard limit, or of its soft limit when it has no hard one (powerscale_quota_used_percent). One incident per quota.",
    category: "Capacity",
    severity: "Warning",
    metricAlias: "quota_used_percent",
    metricName: "powerscale_quota_used_percent",
    groupByAttributeKey: "quota",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past15Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 90 },
    recover: { filterType: FilterType.LessThanOrEqualTo, value: 90 },
    incidentTitle: "[Storage Array] PowerScale Quota Near Its Limit",
    incidentDescription:
      "A quota on the PowerScale cluster has used more than 90% of its limit. The quota label names it and the limit label says whether that is its hard or its soft limit. Raise the limit or ask its owners to clean up before writes to it are refused.",
    criteriaName: "Quota Used > 90%",
    criteriaDescription:
      "Triggers when any quota has used more than 90% of its limit.",
  },
  {
    id: "powerscale-quota-full",
    name: "Quota Full",
    summary: "A quota has reached its limit.",
    description:
      "Alert when a quota's usage reaches its hard limit, or passes its soft limit when it has no hard one (powerscale_quota_used_percent 100 or more). One incident per quota.",
    category: "Capacity",
    severity: "Critical",
    metricAlias: "quota_used_percent",
    metricName: "powerscale_quota_used_percent",
    groupByAttributeKey: "quota",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThanOrEqualTo, value: 100 },
    recover: { filterType: FilterType.LessThan, value: 100 },
    incidentTitle: "[Storage Array] CRITICAL: PowerScale Quota Full",
    incidentDescription:
      "A quota on the PowerScale cluster has reached its limit. At its hard limit writes to it are refused now; past its soft limit they are refused once the grace period ends. The quota label names it: raise the limit or free space in it.",
    criteriaName: "Quota Used >= 100%",
    criteriaDescription: "Triggers when any quota has reached its limit.",
  },
  {
    id: "powerscale-protocol-latency-high",
    name: "High Protocol Latency",
    summary: "A protocol's average latency stays above 20 ms on a node.",
    description:
      "Alert when a protocol's average operation latency on any node stays above 20 ms (powerscale_protocol_latency_microseconds). One incident per protocol. Tune the line to what is normal for your clients: an archive tier is slower than all-flash.",
    category: "Performance",
    severity: "Warning",
    metricAlias: "protocol_latency_usec",
    metricName: "powerscale_protocol_latency_microseconds",
    groupByAttributeKey: "protocol",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past10Minutes,
    fire: {
      filterType: FilterType.GreaterThan,
      value: POWERSCALE_PROTOCOL_LATENCY_WARNING_USEC,
    },
    recover: {
      filterType: FilterType.LessThanOrEqualTo,
      value: POWERSCALE_PROTOCOL_LATENCY_WARNING_USEC,
    },
    incidentTitle: "[Storage Array] PowerScale High Protocol Latency (>20 ms)",
    incidentDescription:
      "A protocol's average latency on the PowerScale cluster has stayed above 20 ms on at least one node. The protocol label names it. Check which node is slow on the Resource Usage tab, its CPU and drives, and the clients driving the load (`isi statistics client`).",
    criteriaName: "Protocol Latency > 20 ms",
    criteriaDescription:
      "Triggers when a protocol's average latency stays above 20000 µs on any node over the monitoring window.",
  },
];

export default POWERSCALE_ALERT_TEMPLATES;
