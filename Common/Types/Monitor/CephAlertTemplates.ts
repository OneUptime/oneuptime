import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import FilterCondition from "../Filter/FilterCondition";
import { CheckOn, FilterType, EvaluateOverTimeType } from "./CriteriaFilter";
import MonitorStepCephMonitor from "./MonitorStepCephMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type CephAlertTemplateCategory =
  | "Cluster Health"
  | "OSD"
  | "Pool"
  | "PG";

export type CephAlertTemplateSeverity = "Critical" | "Warning";

export interface CephAlertTemplateArgs {
  clusterIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface CephAlertTemplate {
  id: string;
  name: string;
  description: string;
  category: CephAlertTemplateCategory;
  severity: CephAlertTemplateSeverity;
  getMonitorStep: (args: CephAlertTemplateArgs) => MonitorStep;
}

export function buildCephMonitorStep(args: {
  cephMonitor: MonitorStepCephMonitor;
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
    cephMonitor: args.cephMonitor,
  };

  return monitorStep;
}

export function buildCephOfflineCriteriaInstance(args: {
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
    `${args.monitorName} has triggered an alert condition. See root cause for detailed Ceph cluster information.`;

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

export function buildCephOnlineCriteriaInstance(args: {
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

export function buildCephMonitorConfig(args: {
  clusterIdentifier: string;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string>;
}): MonitorStepCephMonitor {
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
          },
        },
      ],
      formulaConfigs: [],
    },
    rollingTime: args.rollingTime,
  };
}

// --- Template Definitions ---

const healthWarningTemplate: CephAlertTemplate = {
  id: "ceph-health-warning",
  name: "Cluster Health Warning",
  description:
    "Alert when the Ceph cluster reports HEALTH_WARN or worse (health status >= 1).",
  category: "Cluster Health",
  severity: "Warning",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "ceph_health";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_health_status",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
        incidentTitle: `[Ceph] Cluster Health Warning - ${args.monitorName}`,
        incidentDescription: `The Ceph cluster is reporting HEALTH_WARN or worse. Run \`ceph health detail\` on the cluster to see the active health checks (common causes: OSDs down, PGs degraded, clock skew, nearfull OSDs). The cluster is still serving I/O but needs attention before the condition worsens.`,
        criteriaName: "Health Warning - Status >= 1",
        criteriaDescription:
          "Triggers when the cluster health status is HEALTH_WARN (1) or HEALTH_ERR (2).",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 1,
      }),
    });
  },
};

const healthErrorTemplate: CephAlertTemplate = {
  id: "ceph-health-error",
  name: "Cluster Health Error",
  description:
    "Alert when the Ceph cluster reports HEALTH_ERR (health status >= 2) — data availability or durability is at risk.",
  category: "Cluster Health",
  severity: "Critical",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "ceph_health_error";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_health_status",
        metricAlias,
        rollingTime: RollingTime.Past1Minute,
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 2,
        incidentTitle: `[Ceph] Cluster Health Error - ${args.monitorName}`,
        incidentDescription: `The Ceph cluster is reporting HEALTH_ERR. Data availability or durability is at immediate risk — common causes include PGs inactive/incomplete, full OSDs blocking writes, or inconsistent objects failing scrub. Run \`ceph health detail\` and \`ceph -s\` on the cluster and address the failing checks immediately.`,
        criteriaName: "Health Error - Status >= 2",
        criteriaDescription:
          "Triggers when the cluster health status is HEALTH_ERR (2).",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 2,
      }),
    });
  },
};

const osdDownTemplate: CephAlertTemplate = {
  id: "ceph-osd-down",
  name: "OSD Down",
  description:
    "Alert when any OSD daemon reports as down. Down OSDs reduce redundancy and trigger recovery traffic.",
  category: "OSD",
  severity: "Critical",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "osd_up";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_osd_up",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Use Min so a single down OSD trips the threshold instead of
         * being masked by the OSDs that are still up.
         */
        aggregationType: MetricsAggregationType.Min,
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 1,
        incidentTitle: `[Ceph] OSD Down - ${args.monitorName}`,
        incidentDescription: `One or more Ceph OSD daemons are down. Redundancy is reduced and the cluster will start recovery/backfill once the OSD is marked out. Run \`ceph osd tree | grep down\` to identify the affected OSDs, check the OSD host and daemon logs, and restart or replace the OSD. Check the root cause for the affected ceph_daemon label.`,
        criteriaName: "OSD Down - ceph_osd_up < 1",
        criteriaDescription:
          "Triggers when any OSD reports ceph_osd_up below 1.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
      }),
    });
  },
};

const monQuorumDegradedTemplate: CephAlertTemplate = {
  id: "ceph-mon-quorum-degraded",
  name: "Monitor Quorum Degraded",
  description:
    "Alert when any Ceph monitor daemon falls out of quorum. Losing quorum entirely halts the cluster.",
  category: "Cluster Health",
  severity: "Critical",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "mon_quorum";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_mon_quorum_status",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Use Min so a single monitor out of quorum trips the threshold
         * instead of being masked by monitors that are still in quorum.
         */
        aggregationType: MetricsAggregationType.Min,
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 1,
        incidentTitle: `[Ceph] Monitor Quorum Degraded - ${args.monitorName}`,
        incidentDescription: `A Ceph monitor daemon has fallen out of quorum. The cluster can tolerate losing a minority of monitors, but if quorum is lost entirely all I/O stops. Run \`ceph quorum_status\` to see which monitors are in quorum, then check the affected monitor host for daemon crashes, disk-full conditions, network partitions, or clock skew. Check the root cause for the affected ceph_daemon label.`,
        criteriaName: "Quorum Degraded - Member Out of Quorum",
        criteriaDescription:
          "Triggers when any monitor reports ceph_mon_quorum_status below 1.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
      }),
    });
  },
};

const pgDegradedTemplate: CephAlertTemplate = {
  id: "ceph-pg-degraded",
  name: "Degraded Placement Groups",
  description:
    "Alert when any placement groups are degraded — objects have fewer replicas than configured.",
  category: "PG",
  severity: "Warning",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "pg_degraded";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_pg_degraded",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[Ceph] Degraded Placement Groups - ${args.monitorName}`,
        incidentDescription: `The Ceph cluster has degraded placement groups — some objects currently have fewer replicas than the configured replication factor. This usually follows an OSD failure or restart and should clear as recovery completes. If the count does not trend down, run \`ceph pg dump_stuck degraded\` and \`ceph osd tree\` to find the OSDs blocking recovery.`,
        criteriaName: "PG Degraded - Count > 0",
        criteriaDescription:
          "Triggers when the number of degraded placement groups is above zero.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    });
  },
};

const pgUndersizedTemplate: CephAlertTemplate = {
  id: "ceph-pg-undersized",
  name: "Undersized Placement Groups",
  description:
    "Alert when any placement groups are undersized — mapped to fewer OSDs than their replica count.",
  category: "PG",
  severity: "Warning",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "pg_undersized";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_pg_undersized",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[Ceph] Undersized Placement Groups - ${args.monitorName}`,
        incidentDescription: `The Ceph cluster has undersized placement groups — they are mapped to fewer OSDs than their configured replica count, so full redundancy cannot be restored. Sustained undersized PGs usually mean the cluster lacks enough OSDs (or failure domains) to satisfy the CRUSH rule. Check for down/out OSDs with \`ceph osd tree\` and verify the pool's replication settings against available capacity.`,
        criteriaName: "PG Undersized - Count > 0",
        criteriaDescription:
          "Triggers when the number of undersized placement groups is above zero.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    });
  },
};

const poolLowCapacityTemplate: CephAlertTemplate = {
  id: "ceph-pool-low-capacity",
  name: "Pool Low Capacity",
  description:
    "Alert when the writable space remaining in any pool drops below a byte threshold. Tune the threshold to your environment.",
  category: "Pool",
  severity: "Warning",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "pool_max_avail";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_pool_max_avail",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Use Min so the pool with the least remaining headroom trips
         * the threshold instead of being masked by emptier pools.
         */
        aggregationType: MetricsAggregationType.Min,
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        // 100 GB default — adjust to a comfortable headroom for your pools.
        value: 100000000000,
        incidentTitle: `[Ceph] Pool Low Capacity - ${args.monitorName}`,
        incidentDescription: `A Ceph pool is running low on writable space. When a pool fills up, writes to it stall — and a full OSD can block writes cluster-wide. Run \`ceph df\` to see per-pool usage, then free space, add OSDs, or rebalance. Adjust this monitor's threshold to the headroom appropriate for your pools (default 100 GB).`,
        criteriaName: "Pool Low Capacity - Max Avail < Threshold",
        criteriaDescription:
          "Triggers when any pool's remaining writable space drops below the configured byte threshold.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 100000000000,
      }),
    });
  },
};

export function getAllCephAlertTemplates(): Array<CephAlertTemplate> {
  return [
    healthWarningTemplate,
    healthErrorTemplate,
    osdDownTemplate,
    monQuorumDegradedTemplate,
    pgDegradedTemplate,
    pgUndersizedTemplate,
    poolLowCapacityTemplate,
  ];
}

export function getCephAlertTemplatesByCategory(
  category: CephAlertTemplateCategory,
): Array<CephAlertTemplate> {
  return getAllCephAlertTemplates().filter((template: CephAlertTemplate) => {
    return template.category === category;
  });
}

export function getCephAlertTemplateById(
  id: string,
): CephAlertTemplate | undefined {
  return getAllCephAlertTemplates().find((template: CephAlertTemplate) => {
    return template.id === id;
  });
}
