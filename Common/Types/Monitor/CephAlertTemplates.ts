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
  | "PG"
  | "Capacity";

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

/*
 * Filter contract: ceph-mgr prometheus-module series are keyed by datapoint
 * labels — `ceph_daemon` (e.g. "osd.3", "mon.a") on per-daemon metrics and
 * `pool_id` on per-pool metrics. Pool DATA series carry only `pool_id`; the
 * pool name exists solely on ceph_pool_metadata. Templates group by these
 * labels so one incident fires per daemon/pool. Datapoint labels are NOT
 * `resource.`-prefixed in ClickHouse.
 */

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
  groupByAttributeKey?: string | undefined;
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

export interface CephFormulaQuery {
  alias: string;
  metricName: string;
  attributes?: Record<string, string> | undefined;
}

/**
 * Build a multi-metric formula monitor, optionally grouped by an
 * OpenTelemetry attribute so one incident fires per group (e.g. per
 * `pool_id`). The formula references the query aliases.
 *
 * Aggregation contract (see buildKubernetesRatioMonitorConfig for the full
 * derivation): the per-series worker buckets raw rows by (group, minute)
 * and applies the aggregation across both the grouped series AND the
 * scrapes in that minute. `Sum` is only correct for ratios whose numerator
 * and denominator ride the SAME receiver/scrape so the scrape multiple
 * cancels: `(Σnum × scrapes) / (Σden × scrapes)`. Every Ceph metric comes
 * from ONE receiver — the prometheus scrape of the active ceph-mgr — so
 * all Ceph ratios are same-receiver and use `Sum`/`Sum`. (`Avg`/`Avg` is
 * the cross-receiver variant; not needed here.) Difference formulas
 * compared against zero (e.g. pg_total − pg_active > 0) also use
 * `Sum`/`Sum`: the scrape multiple k scales both terms equally
 * (k·Σtotal − k·Σactive = k·Σinactive), so the sign of the difference —
 * and therefore the > 0 fire / = 0 recover thresholds — is preserved
 * exactly. `Max`/`Max` would be WRONG for ungrouped per-pool metrics:
 * each side collapses to the largest pool's value, hiding non-zero
 * differences in every other pool.
 */
export function buildCephFormulaMonitorConfig(args: {
  clusterIdentifier: string;
  queries: Array<CephFormulaQuery>;
  formula: string;
  resultAlias: string;
  resultLegend: string;
  resultLegendUnit?: string | undefined;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  groupByAttributeKey?: string | undefined;
}): MonitorStepCephMonitor {
  const buildQueryConfig: (query: CephFormulaQuery) => any = (
    query: CephFormulaQuery,
  ): any => {
    return {
      metricAliasData: {
        metricVariable: query.alias,
        title: query.alias,
        description: query.alias,
        legend: query.alias,
        legendUnit: undefined,
      },
      metricQueryData: {
        filterData: {
          metricName: query.metricName,
          attributes: query.attributes || {},
          aggegationType: args.aggregationType,
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
      queryConfigs: args.queries.map(buildQueryConfig),
      formulaConfigs: [
        {
          metricAliasData: {
            metricVariable: args.resultAlias,
            title: args.resultLegend,
            description: args.resultLegend,
            legend: args.resultLegend,
            legendUnit: args.resultLegendUnit,
          },
          metricFormulaData: {
            metricFormula: args.formula,
          },
        },
      ],
    },
    rollingTime: args.rollingTime,
  };
}

/**
 * Build a percentage-ratio monitor: `(numerator / denominator) * 100`.
 * Same-receiver Sum/Sum by default — see buildCephFormulaMonitorConfig.
 */
export function buildCephRatioMonitorConfig(args: {
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
}): MonitorStepCephMonitor {
  return buildCephFormulaMonitorConfig({
    clusterIdentifier: args.clusterIdentifier,
    queries: [
      {
        alias: args.numeratorAlias,
        metricName: args.numeratorMetricName,
        attributes: args.attributes,
      },
      {
        alias: args.denominatorAlias,
        metricName: args.denominatorMetricName,
        attributes: args.attributes,
      },
    ],
    formula: `(${args.numeratorAlias} / ${args.denominatorAlias}) * 100`,
    resultAlias: args.resultAlias,
    resultLegend: args.resultLegend,
    resultLegendUnit: "%",
    rollingTime: args.rollingTime,
    aggregationType: args.aggregationType || MetricsAggregationType.Sum,
    groupByAttributeKey: args.groupByAttributeKey,
  });
}

// --- Template Definitions ---

const healthErrorTemplate: CephAlertTemplate = {
  id: "ceph-health-error",
  name: "Cluster Health Error",
  description:
    "Alert immediately when the Ceph cluster reports HEALTH_ERR (health status >= 2) — data availability or durability is at risk.",
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
        incidentTitle: `[Ceph] CRITICAL: Cluster Health Error - ${args.monitorName}`,
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

const healthWarnTemplate: CephAlertTemplate = {
  id: "ceph-health-warn",
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

const osdDownTemplate: CephAlertTemplate = {
  id: "ceph-osd-down",
  name: "OSD Down",
  description:
    "Alert when any OSD daemon reports as down. Down OSDs reduce redundancy and trigger recovery traffic. One incident per OSD.",
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
         * Min per OSD — a single down scrape trips the threshold instead
         * of being masked by scrapes where the OSD was still up.
         */
        aggregationType: MetricsAggregationType.Min,
        groupByAttributeKey: "ceph_daemon",
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

const osdOutTemplate: CephAlertTemplate = {
  id: "ceph-osd-out",
  name: "OSD Out",
  description:
    "Alert when any OSD is marked out of the cluster. An out OSD no longer stores data and triggers rebalancing. One incident per OSD.",
  category: "OSD",
  severity: "Warning",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "osd_in";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_osd_in",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Min per OSD — a single out scrape trips the threshold instead
         * of being masked by scrapes where the OSD was still in.
         */
        aggregationType: MetricsAggregationType.Min,
        groupByAttributeKey: "ceph_daemon",
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 1,
        incidentTitle: `[Ceph] OSD Out - ${args.monitorName}`,
        incidentDescription: `One or more Ceph OSDs have been marked out of the cluster. Their data is being rebalanced onto the remaining OSDs, which consumes cluster capacity and I/O. If the OSD was marked out automatically after being down (default 10 minutes), bring it back with \`ceph osd in <id>\` once the underlying issue is fixed. Check the root cause for the affected ceph_daemon label.`,
        criteriaName: "OSD Out - ceph_osd_in < 1",
        criteriaDescription:
          "Triggers when any OSD reports ceph_osd_in below 1.",
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

const osdHighLatencyTemplate: CephAlertTemplate = {
  id: "ceph-osd-high-latency",
  name: "OSD High Latency",
  description:
    "Alert when any OSD's average apply latency exceeds 100 ms. Slow OSDs drag down client I/O across every PG they host. One incident per OSD.",
  category: "OSD",
  severity: "Warning",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "osd_apply_latency";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_osd_apply_latency_ms",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Avg per OSD — latency is a per-OSD gauge, so the per-minute
         * average is the sustained latency regardless of scrape count.
         */
        aggregationType: MetricsAggregationType.Avg,
        groupByAttributeKey: "ceph_daemon",
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 100,
        incidentTitle: `[Ceph] OSD High Latency (>100ms) - ${args.monitorName}`,
        incidentDescription: `A Ceph OSD's average apply latency has exceeded 100 ms. A slow OSD degrades client I/O for every placement group it hosts. Common causes: a failing disk, deep-scrub or backfill load, or an overloaded host. Check the affected OSD's host with \`iostat\`/SMART data and \`ceph osd perf\`, and consider reweighting or replacing the OSD. Check the root cause for the affected ceph_daemon label.`,
        criteriaName: "OSD High Latency - Apply Latency > 100ms",
        criteriaDescription:
          "Triggers when any OSD's average apply latency exceeds 100 ms over the monitoring window.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 100,
      }),
    });
  },
};

const monQuorumDegradedTemplate: CephAlertTemplate = {
  id: "ceph-mon-quorum-degraded",
  name: "Monitor Quorum Degraded",
  description:
    "Alert immediately when any Ceph monitor daemon falls out of quorum. Losing quorum entirely halts the cluster. One incident per monitor.",
  category: "Cluster Health",
  severity: "Critical",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "mon_quorum";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_mon_quorum_status",
        metricAlias,
        rollingTime: RollingTime.Past1Minute,
        /*
         * Min per monitor — a single out-of-quorum scrape trips the
         * threshold instead of being masked by in-quorum scrapes.
         */
        aggregationType: MetricsAggregationType.Min,
        groupByAttributeKey: "ceph_daemon",
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 1,
        incidentTitle: `[Ceph] CRITICAL: Monitor Quorum Degraded - ${args.monitorName}`,
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
        /*
         * Per-pool series (pool_id label); Max-across-pools still fires
         * the > 0 threshold when ANY pool has degraded PGs.
         */
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
        /*
         * Per-pool series (pool_id label); Max-across-pools still fires
         * the > 0 threshold when ANY pool has undersized PGs.
         */
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

const pgInactiveTemplate: CephAlertTemplate = {
  id: "ceph-pg-inactive",
  name: "Inactive Placement Groups",
  description:
    "Alert when any placement groups are not active (ceph_pg_total − ceph_pg_active > 0). Inactive PGs cannot serve I/O — client requests to them hang.",
  category: "PG",
  severity: "Critical",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "pg_inactive";

    return buildCephMonitorStep({
      cephMonitor: buildCephFormulaMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        queries: [
          { alias: "pg_total", metricName: "ceph_pg_total" },
          { alias: "pg_active", metricName: "ceph_pg_active" },
        ],
        formula: "pg_total - pg_active",
        resultAlias: metricAlias,
        resultLegend: "Inactive PGs",
        rollingTime: RollingTime.Past5Minutes,
        /*
         * Sum/Sum difference — ceph_pg_total and ceph_pg_active are
         * PER-POOL series (pool_id label, since Nautilus), not single
         * cluster-wide gauges. Sum folds every pool into a cluster-wide
         * count; both metrics ride the same mgr scrape, so the scrape
         * multiple k scales both terms equally (k·Σtotal − k·Σactive =
         * k·Σinactive) and the > 0 fire / = 0 recover thresholds stay
         * exact. Max would collapse each side to the largest pool's
         * value, so inactive PGs in any other pool would yield 0 and
         * this Critical alert would never fire.
         */
        aggregationType: MetricsAggregationType.Sum,
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[Ceph] CRITICAL: Inactive Placement Groups - ${args.monitorName}`,
        incidentDescription: `The Ceph cluster has placement groups that are not active. Inactive PGs cannot serve reads or writes — client I/O to them hangs until they recover. This typically follows the loss of too many OSDs in a failure domain. Run \`ceph pg dump_stuck inactive\` and \`ceph health detail\` to identify the stuck PGs and the OSDs they are waiting on, and restore those OSDs immediately.`,
        criteriaName: "PG Inactive - Count > 0",
        criteriaDescription:
          "Triggers when the number of inactive placement groups (total minus active) is above zero.",
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

const clusterNearFullTemplate: CephAlertTemplate = {
  id: "ceph-cluster-near-full",
  name: "Cluster Near Full",
  description:
    "Alert when raw cluster usage exceeds 85% of total capacity (ceph_cluster_total_used_bytes ÷ ceph_cluster_total_bytes × 100) — Ceph's default nearfull ratio.",
  category: "Capacity",
  severity: "Warning",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "cluster_used_percent";

    return buildCephMonitorStep({
      cephMonitor: buildCephRatioMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        numeratorMetricName: "ceph_cluster_total_used_bytes",
        denominatorMetricName: "ceph_cluster_total_bytes",
        numeratorAlias: "used_bytes",
        denominatorAlias: "total_bytes",
        resultAlias: metricAlias,
        resultLegend: "Cluster Capacity Used (%)",
        rollingTime: RollingTime.Past5Minutes,
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 85,
        incidentTitle: `[Ceph] Cluster Near Full (>85%) - ${args.monitorName}`,
        incidentDescription: `The Ceph cluster's raw usage has exceeded 85% of total capacity — the default nearfull threshold. Individual OSDs will start reporting nearfull (capacity is rarely perfectly balanced), and at the full ratio (95%) writes stop cluster-wide. Run \`ceph df\` and \`ceph osd df\` to check the distribution, then add OSDs, delete data, or rebalance before the cluster reaches full.`,
        criteriaName: "Cluster Near Full - Used > 85%",
        criteriaDescription:
          "Triggers when raw cluster usage exceeds 85% of total capacity over the monitoring window.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 85,
      }),
    });
  },
};

const clusterFullTemplate: CephAlertTemplate = {
  id: "ceph-cluster-full",
  name: "Cluster Full",
  description:
    "Alert when raw cluster usage exceeds 95% of total capacity — Ceph's default full ratio, at which writes stop cluster-wide.",
  category: "Capacity",
  severity: "Critical",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "cluster_used_percent";

    return buildCephMonitorStep({
      cephMonitor: buildCephRatioMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        numeratorMetricName: "ceph_cluster_total_used_bytes",
        denominatorMetricName: "ceph_cluster_total_bytes",
        numeratorAlias: "used_bytes",
        denominatorAlias: "total_bytes",
        resultAlias: metricAlias,
        resultLegend: "Cluster Capacity Used (%)",
        rollingTime: RollingTime.Past5Minutes,
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 95,
        incidentTitle: `[Ceph] CRITICAL: Cluster Full (>95%) - ${args.monitorName}`,
        incidentDescription: `The Ceph cluster's raw usage has exceeded 95% of total capacity — the default full threshold. OSDs at this ratio refuse writes, which stalls client I/O cluster-wide and can wedge recovery. Free capacity immediately: delete unneeded data or snapshots, add OSDs, or temporarily raise the full ratio (\`ceph osd set-full-ratio\`) with extreme caution to restore write availability.`,
        criteriaName: "Cluster Full - Used > 95%",
        criteriaDescription:
          "Triggers when raw cluster usage exceeds 95% of total capacity over the monitoring window.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 95,
      }),
    });
  },
};

const poolNearFullTemplate: CephAlertTemplate = {
  id: "ceph-pool-near-full",
  name: "Pool Near Full",
  description:
    "Alert when any pool's usage exceeds 85% of its writable capacity. Computed per pool as stored ÷ (stored + max_avail) × 100 from ceph_pool_stored and ceph_pool_max_avail. One incident per pool (grouped by pool_id — pool data series carry no name label).",
  category: "Capacity",
  severity: "Warning",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "pool_used_percent";

    return buildCephMonitorStep({
      cephMonitor: buildCephFormulaMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        queries: [
          { alias: "pool_stored", metricName: "ceph_pool_stored" },
          { alias: "pool_max_avail", metricName: "ceph_pool_max_avail" },
        ],
        /*
         * stored / (stored + max_avail) — the pool's share of the space
         * it can still grow into. Same-receiver Sum/Sum: the scrape
         * multiple cancels in both the numerator and the denominator sum.
         */
        formula: "(pool_stored / (pool_stored + pool_max_avail)) * 100",
        resultAlias: metricAlias,
        resultLegend: "Pool Capacity Used (%)",
        resultLegendUnit: "%",
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Sum,
        groupByAttributeKey: "pool_id",
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 85,
        incidentTitle: `[Ceph] Pool Near Full (>85%) - ${args.monitorName}`,
        incidentDescription: `A Ceph pool has used more than 85% of its writable capacity (stored ÷ (stored + max_avail)). When a pool fills up, writes to it stall — and the OSDs backing it may hit their full ratio, blocking writes cluster-wide. Run \`ceph df\` to see per-pool usage (match the pool_id from the root cause to its name), then free space, add OSDs, or adjust pool quotas.`,
        criteriaName: "Pool Near Full - Used > 85%",
        criteriaDescription:
          "Triggers when any pool's usage exceeds 85% of its writable capacity over the monitoring window.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 85,
      }),
    });
  },
};

const slowOpsTemplate: CephAlertTemplate = {
  id: "ceph-slow-ops",
  name: "Slow Operations",
  description:
    "Alert when the SLOW_OPS health check is active (ceph_healthcheck_slow_ops > 0) — OSD or monitor requests are taking too long to complete.",
  category: "Cluster Health",
  severity: "Warning",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "slow_ops";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_healthcheck_slow_ops",
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
        incidentTitle: `[Ceph] Slow Operations Detected - ${args.monitorName}`,
        incidentDescription: `The Ceph SLOW_OPS health check is active — OSD or monitor operations are taking too long to complete, which surfaces as client I/O latency or hangs. Common causes: a failing or saturated disk, network issues between OSDs, or an overloaded daemon. Run \`ceph health detail\` to see which daemons report slow ops, then inspect those hosts' disks and network.`,
        criteriaName: "Slow Ops - Healthcheck Active",
        criteriaDescription:
          "Triggers when the SLOW_OPS healthcheck reports any slow operations.",
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

export function getAllCephAlertTemplates(): Array<CephAlertTemplate> {
  return [
    healthErrorTemplate,
    healthWarnTemplate,
    osdDownTemplate,
    osdOutTemplate,
    osdHighLatencyTemplate,
    monQuorumDegradedTemplate,
    pgDegradedTemplate,
    pgUndersizedTemplate,
    pgInactiveTemplate,
    clusterNearFullTemplate,
    clusterFullTemplate,
    poolNearFullTemplate,
    slowOpsTemplate,
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
