import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
} from "./Recommendation/RecommendationCriteriaBuilder";
import { FilterType } from "./CriteriaFilter";
import MonitorStepStorageArrayMonitor from "./MonitorStepStorageArrayMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import StorageSystem, { StorageSystemUtil } from "../StorageArray/StorageSystem";

export type StorageArrayAlertTemplateCategory =
  | "Array Health"
  | "Capacity"
  | "Performance"
  | "Hardware"
  | "Hosts"
  | "Replication"
  | "File Systems";

export type StorageArrayAlertTemplateSeverity = "Critical" | "Warning";

export interface StorageArrayAlertTemplateArgs {
  // StorageArray.name — the `storage.array.name` resource attribute.
  arrayIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface StorageArrayAlertTemplate {
  id: string;
  name: string;
  description: string;
  category: StorageArrayAlertTemplateCategory;
  severity: StorageArrayAlertTemplateSeverity;
  // The platforms whose metrics the template reads.
  storageSystems: Array<StorageSystem>;
  getMonitorStep: (args: StorageArrayAlertTemplateArgs) => MonitorStep;
}

/*
 * Filter contract: Pure's series are keyed by datapoint labels — `name` on
 * volumes, pods, directories and FlashBlade objects, `host` on hosts,
 * `component_name` on FlashArray hardware, `local_pod` on replica links —
 * and the performance families tell read from write only by the
 * `dimension` label. Templates pin those labels with equality filters and
 * group by the object label so one incident fires per object. Datapoint
 * labels are NOT `resource.`-prefixed in ClickHouse.
 *
 * Presence contract: purefa_alerts_open, purefa_hw_component_status,
 * purefa_drive_capacity_bytes and purefa_host_connectivity_info carry the
 * state in a LABEL with the value always 1 (or the drive's capacity), so a
 * filtered series exists only while the object is in that state — absence
 * is healthy. Those templates fire on Max > 0 (no data never fires under
 * the default Ignore no-data policy) and recover on = 0 with TreatAsZero,
 * so the monitor returns to Healthy when the series disappears — the same
 * shape as the ceph_health_detail templates.
 */

export function buildStorageArrayMonitorStep(args: {
  storageArrayMonitor: MonitorStepStorageArrayMonitor;
  offlineCriteriaInstance: MonitorCriteriaInstance;
  onlineCriteriaInstance: MonitorCriteriaInstance;
}): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();

  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [
      args.offlineCriteriaInstance,
      args.onlineCriteriaInstance,
    ],
  };

  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorDestination: undefined,
    doNotFollowRedirects: undefined,
    monitorDestinationPort: undefined,
    monitorCriteria: monitorCriteria,
    requestType: "GET" as any,
    requestHeaders: undefined,
    requestBody: undefined,
    customCode: undefined,
    screenSizeTypes: undefined,
    browserTypes: undefined,
    retryCountOnError: undefined,
    logMonitor: undefined,
    traceMonitor: undefined,
    metricMonitor: undefined,
    exceptionMonitor: undefined,
    snmpMonitor: undefined,
    dnsMonitor: undefined,
    domainMonitor: undefined,
    externalStatusPageMonitor: undefined,
    kubernetesMonitor: undefined,
    profileMonitor: undefined,
    dockerMonitor: undefined,
    storageArrayMonitor: args.storageArrayMonitor,
  };

  return monitorStep;
}

export function buildStorageArrayOfflineCriteriaInstance(args: {
  offlineMonitorStatusId: ObjectID;
  incidentSeverityId: ObjectID;
  alertSeverityId: ObjectID;
  monitorName: string;
  metricAlias: string;
  filterType: FilterType;
  value: number;
  incidentTitle?: string;
  incidentDescription?: string;
  criteriaName?: string;
  criteriaDescription?: string;
}): MonitorCriteriaInstance {
  return buildUnhealthyCriteriaInstance({
    ...args,
    resourceNoun: "storage array",
  });
}

export function buildStorageArrayOnlineCriteriaInstance(args: {
  onlineMonitorStatusId: ObjectID;
  metricAlias: string;
  filterType: FilterType;
  value: number;
  isBinaryMetric?: boolean | undefined;
  /*
   * State-in-a-label series exist only while the object is in that state,
   * so the recover comparison (= 0) would otherwise see no data and never
   * match. TreatAsZero makes series absence count as 0.
   */
  treatNoDataAsZero?: boolean | undefined;
}): MonitorCriteriaInstance {
  return buildHealthyCriteriaInstance(args);
}

export function buildStorageArrayMonitorConfig(args: {
  arrayIdentifier: string;
  storageSystem?: StorageSystem | undefined;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string>;
  groupByAttributeKey?: string | undefined;
}): MonitorStepStorageArrayMonitor {
  return {
    arrayIdentifier: args.arrayIdentifier,
    storageSystem: args.storageSystem,
    resourceFilters: {},
    metricViewConfig: {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: args.metricAlias,
            title: args.metricAlias,
            description: args.metricAlias,
            legend: args.metricAlias,
            legendUnit: undefined,
          },
          metricQueryData: {
            filterData: {
              metricName: args.metricName,
              attributes: args.attributes || {},
              aggegationType: args.aggregationType,
              aggregateBy: {},
            },
            ...(args.groupByAttributeKey
              ? { groupByAttributeKeys: [args.groupByAttributeKey] }
              : {}),
          },
        },
      ],
      formulaConfigs: [],
    },
    rollingTime: args.rollingTime,
  };
}

/*
 * The shape every shipped template shares: one query, one fire threshold,
 * one recover threshold. Kept as data so each template below reads as a
 * specification rather than as forty lines of builder calls.
 */
interface SingleQueryTemplateSpec {
  id: string;
  name: string;
  description: string;
  category: StorageArrayAlertTemplateCategory;
  severity: StorageArrayAlertTemplateSeverity;
  storageSystem: StorageSystem;
  metricAlias: string;
  metricName: string;
  attributes?: Record<string, string>;
  groupByAttributeKey?: string;
  aggregationType: MetricsAggregationType;
  rollingTime: RollingTime;
  fire: { filterType: FilterType; value: number };
  recover: {
    filterType: FilterType;
    value: number;
    isBinaryMetric?: boolean;
    treatNoDataAsZero?: boolean;
  };
  incidentTitle: string;
  incidentDescription: string;
  criteriaName: string;
  criteriaDescription: string;
}

function singleQueryTemplate(
  spec: SingleQueryTemplateSpec,
): StorageArrayAlertTemplate {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    category: spec.category,
    severity: spec.severity,
    storageSystems: [spec.storageSystem],
    getMonitorStep: (args: StorageArrayAlertTemplateArgs): MonitorStep => {
      return buildStorageArrayMonitorStep({
        storageArrayMonitor: buildStorageArrayMonitorConfig({
          arrayIdentifier: args.arrayIdentifier,
          storageSystem: spec.storageSystem,
          metricName: spec.metricName,
          metricAlias: spec.metricAlias,
          rollingTime: spec.rollingTime,
          aggregationType: spec.aggregationType,
          ...(spec.attributes ? { attributes: spec.attributes } : {}),
          groupByAttributeKey: spec.groupByAttributeKey,
        }),
        offlineCriteriaInstance: buildStorageArrayOfflineCriteriaInstance({
          offlineMonitorStatusId: args.offlineMonitorStatusId,
          incidentSeverityId: args.defaultIncidentSeverityId,
          alertSeverityId: args.defaultAlertSeverityId,
          monitorName: args.monitorName,
          metricAlias: spec.metricAlias,
          filterType: spec.fire.filterType,
          value: spec.fire.value,
          incidentTitle: `${spec.incidentTitle} - ${args.monitorName}`,
          incidentDescription: spec.incidentDescription,
          criteriaName: spec.criteriaName,
          criteriaDescription: spec.criteriaDescription,
        }),
        onlineCriteriaInstance: buildStorageArrayOnlineCriteriaInstance({
          onlineMonitorStatusId: args.onlineMonitorStatusId,
          metricAlias: spec.metricAlias,
          filterType: spec.recover.filterType,
          value: spec.recover.value,
          isBinaryMetric: spec.recover.isBinaryMetric,
          treatNoDataAsZero: spec.recover.treatNoDataAsZero,
        }),
      });
    },
  };
}

const FA: StorageSystem = StorageSystem.PureStorageFlashArray;
const FB: StorageSystem = StorageSystem.PureStorageFlashBlade;

// Recovery for a state-in-a-label series: the series is gone.
const RECOVER_WHEN_ABSENT: SingleQueryTemplateSpec["recover"] = {
  filterType: FilterType.EqualTo,
  value: 0,
  treatNoDataAsZero: true,
};

// --- FlashArray ---

const faCriticalAlertsTemplate: StorageArrayAlertTemplate = singleQueryTemplate(
  {
    id: "purefa-critical-alerts",
    name: "Critical Array Alert",
    description:
      "Alert when the FlashArray raises a critical alert of its own (purefa_alerts_open with severity critical) — a failed controller or component, a capacity emergency, a replication failure. One incident per alert summary.",
    category: "Array Health",
    severity: "Critical",
    storageSystem: FA,
    metricAlias: "critical_alerts",
    metricName: "purefa_alerts_open",
    attributes: { severity: "critical" },
    groupByAttributeKey: "summary",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] CRITICAL: Array Alert",
    incidentDescription:
      "The FlashArray has an open critical alert. The summary label on the series names the problem, and the code label is the Purity alert code. Check the alert in Pure1 or on the array (`purealert list --filter \"state='open'\"`), follow the alert's knowledge base article, and open a case with Pure Storage support if a component has failed — the array usually phones the alert home already.",
    criteriaName: "Critical Alert Open",
    criteriaDescription:
      "Triggers while the array reports at least one open alert with critical severity.",
  },
);

const faWarningAlertsTemplate: StorageArrayAlertTemplate = singleQueryTemplate({
  id: "purefa-warning-alerts",
  name: "Warning Array Alert",
  description:
    "Alert when the FlashArray raises a warning alert (purefa_alerts_open with severity warning). One incident per alert summary.",
  category: "Array Health",
  severity: "Warning",
  storageSystem: FA,
  metricAlias: "warning_alerts",
  metricName: "purefa_alerts_open",
  attributes: { severity: "warning" },
  groupByAttributeKey: "summary",
  aggregationType: MetricsAggregationType.Max,
  rollingTime: RollingTime.Past5Minutes,
  fire: { filterType: FilterType.GreaterThan, value: 0 },
  recover: RECOVER_WHEN_ABSENT,
  incidentTitle: "[Storage Array] Array Warning Alert",
  incidentDescription:
    "The FlashArray has an open warning alert. The summary label on the series names the problem. Review it in Pure1 or on the array (`purealert list`) before it turns critical.",
  criteriaName: "Warning Alert Open",
  criteriaDescription:
    "Triggers while the array reports at least one open alert with warning severity.",
});

const faCapacityHighTemplate: StorageArrayAlertTemplate = singleQueryTemplate({
  id: "purefa-capacity-high",
  name: "Capacity Above 80%",
  description:
    "Alert when more than 80% of the FlashArray's usable capacity is in use (purefa_array_space_utilization) — Pure's own first capacity alert threshold.",
  category: "Capacity",
  severity: "Warning",
  storageSystem: FA,
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
});

const faCapacityCriticalTemplate: StorageArrayAlertTemplate =
  singleQueryTemplate({
    id: "purefa-capacity-critical",
    name: "Capacity Above 90%",
    description:
      "Alert when more than 90% of the FlashArray's usable capacity is in use (purefa_array_space_utilization) — Pure's second capacity alert threshold, where the array is close to refusing writes.",
    category: "Capacity",
    severity: "Critical",
    storageSystem: FA,
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
  });

const faReadLatencyTemplate: StorageArrayAlertTemplate = singleQueryTemplate({
  id: "purefa-read-latency-high",
  name: "High Read Latency",
  description:
    "Alert when the FlashArray's average read latency stays above 5 ms (purefa_array_performance_latency_usec, dimension usec_per_read_op). FlashArray reads normally complete well under 1 ms.",
  category: "Performance",
  severity: "Warning",
  storageSystem: FA,
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
});

const faWriteLatencyTemplate: StorageArrayAlertTemplate = singleQueryTemplate({
  id: "purefa-write-latency-high",
  name: "High Write Latency",
  description:
    "Alert when the FlashArray's average write latency stays above 5 ms (purefa_array_performance_latency_usec, dimension usec_per_write_op).",
  category: "Performance",
  severity: "Warning",
  storageSystem: FA,
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
});

const faHardwareCriticalTemplate: StorageArrayAlertTemplate =
  singleQueryTemplate({
    id: "purefa-hardware-critical",
    name: "Hardware Component Failed",
    description:
      "Alert when a FlashArray hardware component reports critical (purefa_hw_component_status, component_status critical) — a controller, power supply, fan, drive or NVRAM bay, or port. One incident per component.",
    category: "Hardware",
    severity: "Critical",
    storageSystem: FA,
    metricAlias: "critical_components",
    metricName: "purefa_hw_component_status",
    attributes: { component_status: "critical" },
    groupByAttributeKey: "component_name",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] CRITICAL: Hardware Component Failed",
    incidentDescription:
      "A FlashArray hardware component is in a critical state. The component_name label names it (for example CT0, CH0.PWR1, CH0.BAY4). The array keeps running on its redundant parts, but redundancy is gone until the part is replaced. Check `purehw list` and open a case with Pure Storage support for a replacement.",
    criteriaName: "Component Critical",
    criteriaDescription:
      "Triggers while any hardware component reports component_status critical.",
  });

const faHardwareDegradedTemplate: StorageArrayAlertTemplate =
  singleQueryTemplate({
    id: "purefa-hardware-degraded",
    name: "Hardware Component Degraded",
    description:
      "Alert when a FlashArray hardware component reports degraded (purefa_hw_component_status, component_status degraded). One incident per component.",
    category: "Hardware",
    severity: "Warning",
    storageSystem: FA,
    metricAlias: "degraded_components",
    metricName: "purefa_hw_component_status",
    attributes: { component_status: "degraded" },
    groupByAttributeKey: "component_name",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] Hardware Component Degraded",
    incidentDescription:
      "A FlashArray hardware component reports degraded. The component_name label names it. Check `purehw list` for details and the array's open alerts; a degraded port or power supply often follows a cabling or power feed problem in the rack.",
    criteriaName: "Component Degraded",
    criteriaDescription:
      "Triggers while any hardware component reports component_status degraded.",
  });

const faDriveFailedTemplate: StorageArrayAlertTemplate = singleQueryTemplate({
  id: "purefa-drive-failed",
  name: "Drive Failed",
  description:
    "Alert when a FlashArray drive reports failed (purefa_drive_capacity_bytes, component_status failed). One incident per drive.",
  category: "Hardware",
  severity: "Critical",
  storageSystem: FA,
  metricAlias: "failed_drives",
  metricName: "purefa_drive_capacity_bytes",
  attributes: { component_status: "failed" },
  groupByAttributeKey: "component_name",
  aggregationType: MetricsAggregationType.Max,
  rollingTime: RollingTime.Past5Minutes,
  fire: { filterType: FilterType.GreaterThan, value: 0 },
  recover: RECOVER_WHEN_ABSENT,
  incidentTitle: "[Storage Array] CRITICAL: Drive Failed",
  incidentDescription:
    "A FlashArray drive (DirectFlash module or SSD) has failed. The array rebuilds its data onto the remaining drives, but another failure before the rebuild completes reduces protection further. Check `puredrive list` and arrange the replacement with Pure Storage support.",
  criteriaName: "Drive Failed",
  criteriaDescription:
    "Triggers while any drive reports component_status failed.",
});

const faHostConnectivityTemplate: StorageArrayAlertTemplate =
  singleQueryTemplate({
    id: "purefa-host-connectivity-critical",
    name: "Host Lost Redundant Paths",
    description:
      "Alert when a host's connectivity to the FlashArray turns critical (purefa_host_connectivity_info, status critical) — it no longer reaches the array through both controllers. One incident per host.",
    category: "Hosts",
    severity: "Warning",
    storageSystem: FA,
    metricAlias: "hosts_without_redundancy",
    metricName: "purefa_host_connectivity_info",
    attributes: { status: "critical" },
    groupByAttributeKey: "host",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] Host Lost Redundant Paths",
    incidentDescription:
      "A host reaches the FlashArray through only one controller, or not at all (the details label says which: Single Controller, Uneven, None). The host keeps working until the remaining path fails — a controller failover or upgrade would then take its storage offline. Check the host's multipathing, HBA or NIC, cabling and zoning.",
    criteriaName: "Host Connectivity Critical",
    criteriaDescription:
      "Triggers while any host reports connectivity status critical.",
  });

const faReplicaLagTemplate: StorageArrayAlertTemplate = singleQueryTemplate({
  id: "purefa-replica-link-lag",
  name: "Replication Lag Above 1 Minute",
  description:
    "Alert when a pod replica link (ActiveDR / async replication) falls more than 60 seconds behind (purefa_pod_replica_links_lag_max_msec). One incident per local pod.",
  category: "Replication",
  severity: "Warning",
  storageSystem: FA,
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
});

// --- FlashBlade ---

const fbCriticalAlertsTemplate: StorageArrayAlertTemplate = singleQueryTemplate(
  {
    id: "purefb-critical-alerts",
    name: "Critical Array Alert",
    description:
      "Alert when the FlashBlade raises a critical alert of its own (purefb_alerts_open with severity critical). One incident per alert summary.",
    category: "Array Health",
    severity: "Critical",
    storageSystem: FB,
    metricAlias: "critical_alerts",
    metricName: "purefb_alerts_open",
    attributes: { severity: "critical" },
    groupByAttributeKey: "summary",
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recover: RECOVER_WHEN_ABSENT,
    incidentTitle: "[Storage Array] CRITICAL: Array Alert",
    incidentDescription:
      "The FlashBlade has an open critical alert. The summary label names the problem and the kburl label links Pure's knowledge base article for it. Check the alert in Pure1 or on the array and open a case with Pure Storage support if a component has failed.",
    criteriaName: "Critical Alert Open",
    criteriaDescription:
      "Triggers while the array reports at least one open alert with critical severity.",
  },
);

const fbWarningAlertsTemplate: StorageArrayAlertTemplate = singleQueryTemplate({
  id: "purefb-warning-alerts",
  name: "Warning Array Alert",
  description:
    "Alert when the FlashBlade raises a warning alert (purefb_alerts_open with severity warning). One incident per alert summary.",
  category: "Array Health",
  severity: "Warning",
  storageSystem: FB,
  metricAlias: "warning_alerts",
  metricName: "purefb_alerts_open",
  attributes: { severity: "warning" },
  groupByAttributeKey: "summary",
  aggregationType: MetricsAggregationType.Max,
  rollingTime: RollingTime.Past5Minutes,
  fire: { filterType: FilterType.GreaterThan, value: 0 },
  recover: RECOVER_WHEN_ABSENT,
  incidentTitle: "[Storage Array] Array Warning Alert",
  incidentDescription:
    "The FlashBlade has an open warning alert. The summary label names the problem and the kburl label links the knowledge base article.",
  criteriaName: "Warning Alert Open",
  criteriaDescription:
    "Triggers while the array reports at least one open alert with warning severity.",
});

const fbCapacityHighTemplate: StorageArrayAlertTemplate = singleQueryTemplate({
  id: "purefb-capacity-high",
  name: "Capacity Above 80%",
  description:
    "Alert when more than 80% of the FlashBlade's usable capacity is in use (purefb_array_space_utilization, type array).",
  category: "Capacity",
  severity: "Warning",
  storageSystem: FB,
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
});

const fbCapacityCriticalTemplate: StorageArrayAlertTemplate =
  singleQueryTemplate({
    id: "purefb-capacity-critical",
    name: "Capacity Above 90%",
    description:
      "Alert when more than 90% of the FlashBlade's usable capacity is in use (purefb_array_space_utilization, type array).",
    category: "Capacity",
    severity: "Critical",
    storageSystem: FB,
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
  });

const fbHardwareUnhealthyTemplate: StorageArrayAlertTemplate =
  singleQueryTemplate({
    id: "purefb-hardware-unhealthy",
    name: "Hardware Component Unhealthy",
    description:
      "Alert when a FlashBlade hardware component stops reporting healthy (purefb_hardware_health below 1) — a blade, fabric module, power supply or fan. One incident per component.",
    category: "Hardware",
    severity: "Critical",
    storageSystem: FB,
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
  });

const fbReadLatencyTemplate: StorageArrayAlertTemplate = singleQueryTemplate({
  id: "purefb-read-latency-high",
  name: "High Read Latency",
  description:
    "Alert when the FlashBlade's average read latency across all protocols stays above 10 ms (purefb_array_performance_latency_usec, dimension usec_per_read_op, protocol all).",
  category: "Performance",
  severity: "Warning",
  storageSystem: FB,
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
});

const fbFileSystemNearFullTemplate: StorageArrayAlertTemplate =
  singleQueryTemplate({
    id: "purefb-file-system-near-full",
    name: "File System Near Full",
    description:
      "Alert when less than 10% of a FlashBlade file system's provisioned size is still available (purefb_file_systems_space_bytes, space available_ratio). One incident per file system.",
    category: "File Systems",
    severity: "Warning",
    storageSystem: FB,
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
  });

export function getAllStorageArrayAlertTemplates(): Array<StorageArrayAlertTemplate> {
  return [
    faCriticalAlertsTemplate,
    faWarningAlertsTemplate,
    faCapacityHighTemplate,
    faCapacityCriticalTemplate,
    faReadLatencyTemplate,
    faWriteLatencyTemplate,
    faHardwareCriticalTemplate,
    faHardwareDegradedTemplate,
    faDriveFailedTemplate,
    faHostConnectivityTemplate,
    faReplicaLagTemplate,
    fbCriticalAlertsTemplate,
    fbWarningAlertsTemplate,
    fbCapacityHighTemplate,
    fbCapacityCriticalTemplate,
    fbHardwareUnhealthyTemplate,
    fbReadLatencyTemplate,
    fbFileSystemNearFullTemplate,
  ];
}

/*
 * The templates for one platform. An array whose platform is not known yet
 * (no batch has reported it) gets every template, each named with its
 * platform — FlashArray and FlashBlade both have a "Capacity Above 80%", and
 * the two must be told apart in one list.
 */
export function getStorageArrayAlertTemplatesForSystem(
  system: string | null | undefined,
): Array<StorageArrayAlertTemplate> {
  const forSystem: Array<StorageArrayAlertTemplate> =
    getAllStorageArrayAlertTemplates().filter(
      (template: StorageArrayAlertTemplate) => {
        return template.storageSystems.includes(system as StorageSystem);
      },
    );

  if (forSystem.length > 0) {
    return forSystem;
  }

  return getAllStorageArrayAlertTemplates().map(
    (template: StorageArrayAlertTemplate) => {
      const platforms: string = template.storageSystems
        .map((templateSystem: StorageSystem) => {
          return StorageSystemUtil.getShortName(templateSystem);
        })
        .join(", ");
      return { ...template, name: `${template.name} (${platforms})` };
    },
  );
}

export function getStorageArrayAlertTemplatesByCategory(
  category: StorageArrayAlertTemplateCategory,
): Array<StorageArrayAlertTemplate> {
  return getAllStorageArrayAlertTemplates().filter(
    (template: StorageArrayAlertTemplate) => {
      return template.category === category;
    },
  );
}

export function getStorageArrayAlertTemplateById(
  id: string,
): StorageArrayAlertTemplate | undefined {
  return getAllStorageArrayAlertTemplates().find(
    (template: StorageArrayAlertTemplate) => {
      return template.id === id;
    },
  );
}
