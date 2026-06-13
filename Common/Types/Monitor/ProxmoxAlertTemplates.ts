import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import FilterCondition from "../Filter/FilterCondition";
import { CheckOn, FilterType, EvaluateOverTimeType } from "./CriteriaFilter";
import MonitorStepProxmoxMonitor from "./MonitorStepProxmoxMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type ProxmoxAlertTemplateCategory =
  | "Availability"
  | "Node"
  | "Guest"
  | "Storage"
  | "HA"
  | "Backup"
  | "Replication";

export type ProxmoxAlertTemplateSeverity = "Critical" | "Warning";

export interface ProxmoxAlertTemplateArgs {
  clusterIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface ProxmoxAlertTemplate {
  id: string;
  name: string;
  description: string;
  category: ProxmoxAlertTemplateCategory;
  severity: ProxmoxAlertTemplateSeverity;
  getMonitorStep: (args: ProxmoxAlertTemplateArgs) => MonitorStep;
}

/*
 * Filter contract: pve-exporter data metrics carry only the `id` datapoint
 * label (`node/pve1`, `qemu/100`, `lxc/101`, `storage/local`). The agent's
 * OTTL transform processor splits it into the datapoint attributes
 * `pve.scope` (node | guest | storage | cluster), `pve.type` (node | qemu |
 * lxc | storage) and `pve.id` (the part after the slash). Templates filter
 * on `pve.scope` / `pve.type` and group by the untouched `id` label so one
 * incident fires per resource. All of these are datapoint attributes, so
 * they are NOT `resource.`-prefixed in ClickHouse.
 */

export function buildProxmoxMonitorStep(args: {
  proxmoxMonitor: MonitorStepProxmoxMonitor;
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
    proxmoxMonitor: args.proxmoxMonitor,
  };

  return monitorStep;
}

export function buildProxmoxOfflineCriteriaInstance(args: {
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
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  const incidentTitle: string =
    args.incidentTitle || `${args.monitorName} - Alert Triggered`;
  const incidentDescription: string =
    args.incidentDescription ||
    `${args.monitorName} has triggered an alert condition. See root cause for detailed Proxmox cluster information.`;

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: args.offlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.MetricValue,
        filterType: args.filterType,
        metricMonitorOptions: {
          metricAggregationType: EvaluateOverTimeType.AnyValue,
          metricAlias: args.metricAlias,
        },
        value: args.value,
      },
    ],
    incidents: [
      {
        title: incidentTitle,
        description: incidentDescription,
        incidentSeverityId: args.incidentSeverityId,
        autoResolveIncident: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    alerts: [
      {
        title: incidentTitle,
        description: incidentDescription,
        alertSeverityId: args.alertSeverityId,
        autoResolveAlert: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    changeMonitorStatus: true,
    createIncidents: true,
    createAlerts: true,
    name: args.criteriaName || `${args.monitorName} - Unhealthy`,
    description:
      args.criteriaDescription || `Criteria for detecting unhealthy state.`,
  };

  return instance;
}

export function buildProxmoxOnlineCriteriaInstance(args: {
  onlineMonitorStatusId: ObjectID;
  metricAlias: string;
  filterType: FilterType;
  value: number;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: args.onlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.MetricValue,
        filterType: args.filterType,
        metricMonitorOptions: {
          metricAggregationType: EvaluateOverTimeType.AnyValue,
          metricAlias: args.metricAlias,
        },
        value: args.value,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    name: "Healthy",
    description: "Criteria for healthy state.",
  };

  return instance;
}

export function buildProxmoxMonitorConfig(args: {
  clusterIdentifier: string;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string>;
  groupByAttributeKey?: string | undefined;
}): MonitorStepProxmoxMonitor {
  return {
    clusterIdentifier: args.clusterIdentifier,
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

/**
 * Build a ratio monitor: `(numerator / denominator) * 100`, optionally
 * grouped by an OpenTelemetry attribute so one incident fires per group
 * (e.g. per `id` = per node/guest/storage volume).
 *
 * Aggregation contract (see buildKubernetesRatioMonitorConfig for the full
 * derivation): the per-series worker buckets raw rows by (group, minute)
 * and applies the aggregation across both the grouped series AND the
 * scrapes in that minute. `Sum` is only correct when numerator and
 * denominator ride the SAME receiver/scrape so the scrape multiple
 * cancels: `(Σnum × scrapes) / (Σden × scrapes)`. Every Proxmox metric
 * comes from ONE receiver — the prometheus scrape of pve-exporter — so
 * all Proxmox ratios are same-receiver and default to `Sum`/`Sum`.
 * (`Avg`/`Avg` is the cross-receiver variant; not needed here.)
 *
 * `attributes` is applied to BOTH queries — the agent stamps `pve.scope` /
 * `pve.type` on every series of a scrape (including the *_info metadata
 * series, which also carry `id`), so a shared equality filter is safe.
 */
export function buildProxmoxRatioMonitorConfig(args: {
  clusterIdentifier: string;
  numeratorMetricName: string;
  denominatorMetricName: string;
  numeratorAlias: string;
  denominatorAlias: string;
  resultAlias: string;
  resultLegend: string;
  rollingTime: RollingTime;
  attributes?: Record<string, string> | undefined;
  groupByAttributeKey?: string | undefined;
  aggregationType?: MetricsAggregationType | undefined;
}): MonitorStepProxmoxMonitor {
  const aggregationType: MetricsAggregationType =
    args.aggregationType || MetricsAggregationType.Sum;

  const buildQueryConfig: (alias: string, metricName: string) => any = (
    alias: string,
    metricName: string,
  ): any => {
    return {
      metricAliasData: {
        metricVariable: alias,
        title: alias,
        description: alias,
        legend: alias,
        legendUnit: undefined,
      },
      metricQueryData: {
        filterData: {
          metricName: metricName,
          attributes: args.attributes || {},
          aggegationType: aggregationType,
          aggregateBy: {},
        },
        ...(args.groupByAttributeKey
          ? { groupByAttributeKeys: [args.groupByAttributeKey] }
          : {}),
      },
    };
  };

  return {
    clusterIdentifier: args.clusterIdentifier,
    resourceFilters: {},
    metricViewConfig: {
      queryConfigs: [
        buildQueryConfig(args.numeratorAlias, args.numeratorMetricName),
        buildQueryConfig(args.denominatorAlias, args.denominatorMetricName),
      ],
      formulaConfigs: [
        {
          metricAliasData: {
            metricVariable: args.resultAlias,
            title: args.resultLegend,
            description: args.resultLegend,
            legend: args.resultLegend,
            legendUnit: "%",
          },
          metricFormulaData: {
            metricFormula: `(${args.numeratorAlias} / ${args.denominatorAlias}) * 100`,
          },
        },
      ],
    },
    rollingTime: args.rollingTime,
  };
}

// --- Template Definitions ---

const nodeOfflineTemplate: ProxmoxAlertTemplate = {
  id: "pve-node-offline",
  name: "Node Offline",
  description:
    "Alert when any Proxmox node reports as down (pve_up = 0, scoped to nodes via pve.scope). One incident per node.",
  category: "Availability",
  severity: "Critical",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "node_up";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "pve_up",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Min per node — a single down scrape trips the threshold instead
         * of being masked by scrapes where the node was still up.
         */
        aggregationType: MetricsAggregationType.Min,
        attributes: { "pve.scope": "node" },
        groupByAttributeKey: "id",
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 1,
        incidentTitle: `[Proxmox] Node Offline - ${args.monitorName}`,
        incidentDescription: `A Proxmox node is reporting as down (pve_up = 0). The node is unreachable or has crashed and every guest running on it may be offline. Check the root cause for the affected node id, verify the node's power/network state, and check whether HA has relocated its guests.`,
        criteriaName: "Node Offline - pve_up < 1",
        criteriaDescription:
          "Triggers when any node reports pve_up below 1 over the monitoring window.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
      }),
    });
  },
};

const guestDownTemplate: ProxmoxAlertTemplate = {
  id: "pve-guest-down",
  name: "Guest Down",
  description:
    "Alert when any VM or container reports as down (pve_up = 0, scoped to guests via pve.scope). One incident per guest. Intentionally stopped guests also report 0 — add a pve.id filter to scope to guests that should always run.",
  category: "Availability",
  severity: "Warning",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "guest_up";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "pve_up",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Min per guest — a single down scrape trips the threshold instead
         * of being masked by scrapes where the guest was still up.
         */
        aggregationType: MetricsAggregationType.Min,
        attributes: { "pve.scope": "guest" },
        groupByAttributeKey: "id",
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 1,
        incidentTitle: `[Proxmox] Guest Down - ${args.monitorName}`,
        incidentDescription: `A Proxmox guest (VM or container) is reporting as down (pve_up = 0). It has stopped or crashed. Check the root cause for the affected guest id. Note: intentionally stopped guests also report pve_up = 0 — add a pve.id attribute filter to scope this monitor to guests that should always be running.`,
        criteriaName: "Guest Down - pve_up < 1",
        criteriaDescription:
          "Triggers when any guest reports pve_up below 1 over the monitoring window.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
      }),
    });
  },
};

const quorumRiskTemplate: ProxmoxAlertTemplate = {
  id: "pve-quorum-risk",
  name: "Cluster Quorum at Risk",
  description:
    "Alert when 50% or fewer of the cluster's nodes are online. Derived from node visibility (online pve_up nodes ÷ pve_node_info node count) — pve-exporter exposes no corosync metric, so this is the honest quorum proxy: at ≤50% node availability the cluster has lost (or is about to lose) quorum and HA recovery stops.",
  category: "Availability",
  severity: "Critical",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "node_availability";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxRatioMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        /*
         * Numerator Σpve_up over node series = nodes online; denominator
         * Σpve_node_info (a constant-1 metadata series per node) = nodes
         * total. Same receiver ⇒ the scrape multiple cancels (Sum/Sum).
         */
        numeratorMetricName: "pve_up",
        denominatorMetricName: "pve_node_info",
        numeratorAlias: "nodes_online",
        denominatorAlias: "nodes_total",
        resultAlias: metricAlias,
        resultLegend: "Node Availability (%)",
        rollingTime: RollingTime.Past5Minutes,
        attributes: { "pve.scope": "node" },
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 50,
        incidentTitle: `[Proxmox] CRITICAL: Cluster Quorum at Risk - ${args.monitorName}`,
        incidentDescription: `Half or more of the Proxmox cluster's nodes are offline. With ≤50% of nodes online the cluster has lost (or is about to lose) corosync quorum — pmxcfs goes read-only, guests cannot be started or migrated, and HA recovery stops. Identify and recover the offline nodes immediately. (This is derived from node visibility: online nodes ÷ total nodes; pve-exporter exposes no direct corosync metric.)`,
        criteriaName: "Quorum Risk - Node Availability <= 50%",
        criteriaDescription:
          "Triggers when 50% or fewer of the cluster's nodes report as online.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 50,
      }),
    });
  },
};

const nodeHighCpuTemplate: ProxmoxAlertTemplate = {
  id: "pve-node-high-cpu",
  name: "High Node CPU Usage",
  description:
    "Alert when any node's average CPU usage exceeds 90% of its cores (pve_cpu_usage_ratio > 0.9, scoped to nodes). One incident per node.",
  category: "Node",
  severity: "Warning",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "node_cpu";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "pve_cpu_usage_ratio",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Avg per node — pve_cpu_usage_ratio is already a true 0-1 ratio
         * (one series per node), so the per-minute average is the
         * sustained utilization regardless of scrape count.
         */
        aggregationType: MetricsAggregationType.Avg,
        attributes: { "pve.scope": "node" },
        groupByAttributeKey: "id",
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0.9,
        incidentTitle: `[Proxmox] High Node CPU Usage (>90%) - ${args.monitorName}`,
        incidentDescription: `A Proxmox node's CPU usage has exceeded 90% of its available cores. Sustained high CPU on a node degrades performance of every guest running on it. Check the root cause for the affected node id, then consider migrating guests to another node or adding capacity.`,
        criteriaName: "High Node CPU - Usage Ratio > 0.9",
        criteriaDescription:
          "Triggers when any node's average CPU usage ratio exceeds 0.9 over the monitoring window.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 0.9,
      }),
    });
  },
};

const nodeHighMemoryTemplate: ProxmoxAlertTemplate = {
  id: "pve-node-high-memory",
  name: "High Node Memory Usage",
  description:
    "Alert when any node's memory usage exceeds 85% of its RAM. Computed per node as pve_memory_usage_bytes ÷ pve_memory_size_bytes × 100 — both are bytes from the same scrape, so this is a true percentage with no per-node threshold tuning.",
  category: "Node",
  severity: "Warning",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "node_memory_utilization";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxRatioMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        numeratorMetricName: "pve_memory_usage_bytes",
        denominatorMetricName: "pve_memory_size_bytes",
        numeratorAlias: "used_mem",
        denominatorAlias: "total_mem",
        resultAlias: metricAlias,
        resultLegend: "Node Memory Utilization (%)",
        rollingTime: RollingTime.Past5Minutes,
        attributes: { "pve.scope": "node" },
        groupByAttributeKey: "id",
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 85,
        incidentTitle: `[Proxmox] High Node Memory Usage (>85%) - ${args.monitorName}`,
        incidentDescription: `A Proxmox node's memory usage has exceeded 85% of its physical RAM. Memory pressure on a node can trigger the kernel OOM killer, which terminates guests. Check the root cause for the affected node id, then consider migrating guests, reducing guest memory allocations, or adding RAM.`,
        criteriaName: "High Node Memory - Utilization > 85%",
        criteriaDescription:
          "Triggers when any node's memory usage exceeds 85% of its total memory over the monitoring window.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 85,
      }),
    });
  },
};

const guestHighCpuTemplate: ProxmoxAlertTemplate = {
  id: "pve-guest-high-cpu",
  name: "High Guest CPU Usage",
  description:
    "Alert when any VM or container uses more than 90% of its allocated vCPUs (pve_cpu_usage_ratio > 0.9, scoped to guests). One incident per guest.",
  category: "Guest",
  severity: "Warning",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "guest_cpu";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "pve_cpu_usage_ratio",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Avg per guest — pve_cpu_usage_ratio is already a true 0-1 ratio
         * (one series per guest), so the per-minute average is the
         * sustained utilization regardless of scrape count.
         */
        aggregationType: MetricsAggregationType.Avg,
        attributes: { "pve.scope": "guest" },
        groupByAttributeKey: "id",
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0.9,
        incidentTitle: `[Proxmox] High Guest CPU Usage (>90%) - ${args.monitorName}`,
        incidentDescription: `A guest (VM or container) is using more than 90% of its allocated vCPUs. The workload inside the guest may be CPU-starved. Check the root cause for the affected guest id, then consider allocating more vCPUs or investigating the workload inside the guest.`,
        criteriaName: "High Guest CPU - Usage Ratio > 0.9",
        criteriaDescription:
          "Triggers when any guest's average CPU usage ratio exceeds 0.9 over the monitoring window.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 0.9,
      }),
    });
  },
};

const storageNearFullTemplate: ProxmoxAlertTemplate = {
  id: "pve-storage-near-full",
  name: "Storage Near Full",
  description:
    "Alert when any storage volume's disk usage exceeds 85% of its capacity. Computed per volume as pve_disk_usage_bytes ÷ pve_disk_size_bytes × 100 — a true percentage with no per-volume threshold tuning.",
  category: "Storage",
  severity: "Warning",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "storage_utilization";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxRatioMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        numeratorMetricName: "pve_disk_usage_bytes",
        denominatorMetricName: "pve_disk_size_bytes",
        numeratorAlias: "used_disk",
        denominatorAlias: "total_disk",
        resultAlias: metricAlias,
        resultLegend: "Storage Utilization (%)",
        rollingTime: RollingTime.Past5Minutes,
        attributes: { "pve.scope": "storage" },
        groupByAttributeKey: "id",
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 85,
        incidentTitle: `[Proxmox] Storage Near Full (>85%) - ${args.monitorName}`,
        incidentDescription: `A Proxmox storage volume is more than 85% full. A full storage volume prevents guests from writing, can pause VMs, and blocks backups and snapshots. Check the root cause for the affected storage id, then free space, prune old backups/snapshots, or extend the volume.`,
        criteriaName: "Storage Near Full - Utilization > 85%",
        criteriaDescription:
          "Triggers when any storage volume's disk usage exceeds 85% of its capacity over the monitoring window.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 85,
      }),
    });
  },
};

const lxcDiskNearFullTemplate: ProxmoxAlertTemplate = {
  id: "pve-lxc-disk-near-full",
  name: "Container Root Disk Near Full",
  description:
    "Alert when any LXC container's root disk usage exceeds 90% of its size (pve_disk_usage_bytes ÷ pve_disk_size_bytes × 100, scoped to pve.type=lxc). QEMU VMs are excluded — their in-guest disk usage is only reported when the QEMU guest agent is installed, so it reads 0 otherwise.",
  category: "Storage",
  severity: "Warning",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "lxc_disk_utilization";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxRatioMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        numeratorMetricName: "pve_disk_usage_bytes",
        denominatorMetricName: "pve_disk_size_bytes",
        numeratorAlias: "used_disk",
        denominatorAlias: "total_disk",
        resultAlias: metricAlias,
        resultLegend: "Container Root Disk Utilization (%)",
        rollingTime: RollingTime.Past5Minutes,
        attributes: { "pve.type": "lxc" },
        groupByAttributeKey: "id",
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 90,
        incidentTitle: `[Proxmox] Container Root Disk Near Full (>90%) - ${args.monitorName}`,
        incidentDescription: `An LXC container's root disk is more than 90% full. When the root filesystem fills up, services inside the container start failing and the container may become unresponsive. Check the root cause for the affected container id, then free space inside the container or grow its root disk.`,
        criteriaName: "LXC Disk Near Full - Utilization > 90%",
        criteriaDescription:
          "Triggers when any LXC container's root disk usage exceeds 90% of its size over the monitoring window.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 90,
      }),
    });
  },
};

const haStateErrorTemplate: ProxmoxAlertTemplate = {
  id: "pve-ha-state-error",
  name: "HA Resource in Error State",
  description:
    "Alert when any HA-managed resource enters the error state, meaning high availability could not recover it. One incident per HA resource.",
  category: "HA",
  severity: "Critical",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "ha_error_state";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "pve_ha_state",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * pve_ha_state is an enum-style metric: one series per possible
         * state with value 1 for the current state. Filtering on
         * state="error" makes the series go to 1 only when an HA-managed
         * resource is in the error state; Max per resource catches it.
         */
        aggregationType: MetricsAggregationType.Max,
        attributes: { state: "error" },
        groupByAttributeKey: "id",
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[Proxmox] HA Resource in Error State - ${args.monitorName}`,
        incidentDescription: `A high-availability managed resource in the Proxmox cluster has entered the error state. The HA manager could not start or recover the resource automatically — manual intervention is required (typically \`ha-manager set <sid> --state disabled\` followed by re-enabling after fixing the underlying issue). Check the root cause for the affected resource id.`,
        criteriaName: "HA Error - Error State Present",
        criteriaDescription:
          "Triggers when any HA-managed resource reports the error state.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    });
  },
};

const guestNotBackedUpTemplate: ProxmoxAlertTemplate = {
  id: "pve-guest-not-backed-up",
  name: "Guest Not Backed Up",
  description:
    "Alert when one or more guests are not covered by ANY backup job (pve_not_backed_up_total > 0, cluster scope). Identify the uncovered guests via pve_not_backed_up_info grouped by id. Honest boundary: this checks backup-JOB coverage only — whether backups ran recently or succeeded is not exposed by pve-exporter.",
  category: "Backup",
  severity: "Warning",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "guests_without_backup";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        /*
         * Cluster-level gauge from the backup-info collector — one
         * series, no `id` label, so no groupBy: one incident per
         * cluster. Per-guest naming belongs to the breakdown table
         * (pve_not_backed_up_info grouped by `id`), not the alert.
         */
        metricName: "pve_not_backed_up_total",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        // Max — a single scrape reporting uncovered guests trips it.
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[Proxmox] Guest Not Backed Up - ${args.monitorName}`,
        incidentDescription: `One or more guests (VMs or containers) in the Proxmox cluster are not covered by any backup job. A guest outside every backup job has NO recovery path if its node or storage fails. Query pve_not_backed_up_info grouped by id to list the uncovered guests, then add them to a vzdump backup job (Datacenter → Backup). Note: this alert covers backup-job membership only — pve-exporter does not expose whether backups ran recently or succeeded.`,
        criteriaName: "Guests Without Backup - Total > 0",
        criteriaDescription:
          "Triggers when any guest is not covered by a backup job over the monitoring window.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    });
  },
};

const replicationFailingTemplate: ProxmoxAlertTemplate = {
  id: "pve-replication-failing",
  name: "Replication Failing",
  description:
    "Alert when any storage replication job reports failed syncs (pve_replication_failed_syncs > 0). One incident per replication job (grouped by the job id). A failing job means the guest's replica on the target node is going stale — manual failover would lose the data written since the last successful sync.",
  category: "Replication",
  severity: "Critical",
  getMonitorStep: (args: ProxmoxAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "replication_failed_syncs";

    return buildProxmoxMonitorStep({
      proxmoxMonitor: buildProxmoxMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        /*
         * Node-level replication collector (default-on). Series are
         * labeled `id` with the replication JOB id (e.g. 100-0), not a
         * node/qemu/lxc-prefixed resource id — so no pve.scope filter,
         * and groupBy `id` fires one incident per job.
         */
        metricName: "pve_replication_failed_syncs",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        // Max per job — any scrape reporting a failed sync trips it.
        aggregationType: MetricsAggregationType.Max,
        groupByAttributeKey: "id",
      }),
      offlineCriteriaInstance: buildProxmoxOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[Proxmox] CRITICAL: Replication Failing - ${args.monitorName}`,
        incidentDescription: `A Proxmox storage replication job is reporting failed syncs (pve_replication_failed_syncs > 0). The guest's replica on the target node is going stale — a failover now would lose every write since the last successful sync. Check the root cause for the affected replication job id, then inspect the job's log on the source node (Datacenter → Replication) for the failure reason — common causes are a full target storage, an offline target node, or a broken SSH trust between nodes.`,
        criteriaName: "Replication Failing - Failed Syncs > 0",
        criteriaDescription:
          "Triggers when any replication job reports one or more failed syncs over the monitoring window.",
      }),
      onlineCriteriaInstance: buildProxmoxOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    });
  },
};

export function getAllProxmoxAlertTemplates(): Array<ProxmoxAlertTemplate> {
  return [
    nodeOfflineTemplate,
    guestDownTemplate,
    quorumRiskTemplate,
    nodeHighCpuTemplate,
    nodeHighMemoryTemplate,
    guestHighCpuTemplate,
    storageNearFullTemplate,
    lxcDiskNearFullTemplate,
    haStateErrorTemplate,
    guestNotBackedUpTemplate,
    replicationFailingTemplate,
  ];
}

export function getProxmoxAlertTemplatesByCategory(
  category: ProxmoxAlertTemplateCategory,
): Array<ProxmoxAlertTemplate> {
  return getAllProxmoxAlertTemplates().filter(
    (template: ProxmoxAlertTemplate) => {
      return template.category === category;
    },
  );
}

export function getProxmoxAlertTemplateById(
  id: string,
): ProxmoxAlertTemplate | undefined {
  return getAllProxmoxAlertTemplates().find(
    (template: ProxmoxAlertTemplate) => {
      return template.id === id;
    },
  );
}
