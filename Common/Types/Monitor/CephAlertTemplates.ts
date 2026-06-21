import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import FilterCondition from "../Filter/FilterCondition";
import {
  CheckOn,
  FilterType,
  EvaluateOverTimeType,
  NoDataPolicy,
} from "./CriteriaFilter";
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
 *
 * Health-check contract: `ceph_health_detail{name,severity}` (Quincy and
 * later) exports one series per ACTIVE health check — equality-filter on
 * the `name` datapoint label, exactly like the `pve_ha_state` state filter.
 * A series exists only while its check fires, so absence = healthy: the
 * fire criteria use Max > 0 (no data never fires under the default Ignore
 * no-data policy) and the recover criteria use = 0 with TreatAsZero so the
 * monitor returns to Healthy when the series disappears.
 * `ceph_daemon_health_metrics{type,ceph_daemon}` follows the same pattern
 * per daemon.
 */

export function buildCephMonitorStep(args: {
  cephMonitor: MonitorStepCephMonitor;
  offlineCriteriaInstance: MonitorCriteriaInstance;
  onlineCriteriaInstance: MonitorCriteriaInstance;
  /*
   * Optional extra unhealthy tiers, evaluated AFTER the primary offline
   * instance and before the online instance. Criteria are first-match-
   * wins, so pass tiers worst-first (e.g. ceph-mon-disk-space pairs a
   * Critical MON_DISK_CRIT tier with a Warning MON_DISK_LOW tier in one
   * template).
   */
  additionalOfflineCriteriaInstances?: Array<MonitorCriteriaInstance>;
}): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();

  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [
      args.offlineCriteriaInstance,
      ...(args.additionalOfflineCriteriaInstances || []),
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

/**
 * One extra threshold filter inside a criteria instance — references
 * another query alias of the same monitor step. Used by health-check
 * templates that watch two `ceph_health_detail` names at once.
 */
export interface CephCriteriaFilterSpec {
  metricAlias: string;
  filterType: FilterType;
  value: number;
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
  /*
   * Extra OR'd filters (the instance is FilterCondition.Any) — fires when
   * EITHER the primary alias or any additional alias breaches, e.g.
   * PG_DAMAGED OR OSD_SCRUB_ERRORS.
   */
  additionalFilters?: Array<CephCriteriaFilterSpec> | undefined;
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
      ...(args.additionalFilters || []).map(
        (filter: CephCriteriaFilterSpec) => {
          return {
            checkOn: CheckOn.MetricValue,
            filterType: filter.filterType,
            metricMonitorOptions: {
              metricAggregationType: EvaluateOverTimeType.AnyValue,
              metricAlias: filter.metricAlias,
            },
            value: filter.value,
          };
        },
      ),
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
  /*
   * Extra filters for multi-alias recovery. Pass FilterCondition.All with
   * them so the monitor only recovers when EVERY watched health check has
   * cleared (the complement of the offline instance's Any).
   */
  additionalFilters?: Array<CephCriteriaFilterSpec> | undefined;
  filterCondition?: FilterCondition | undefined;
  /*
   * Health-detail series exist only while the check is active, so the
   * recover comparison (= 0) would otherwise see no data and never match.
   * TreatAsZero makes series absence count as 0 — the spec'd
   * "Max > 0 fire / = 0 recover" semantics.
   */
  treatNoDataAsZero?: boolean | undefined;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  const onNoDataPolicy: NoDataPolicy | undefined = args.treatNoDataAsZero
    ? NoDataPolicy.TreatAsZero
    : undefined;

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: args.onlineMonitorStatusId,
    filterCondition: args.filterCondition || FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.MetricValue,
        filterType: args.filterType,
        metricMonitorOptions: {
          metricAggregationType: EvaluateOverTimeType.AnyValue,
          metricAlias: args.metricAlias,
          onNoDataPolicy: onNoDataPolicy,
        },
        value: args.value,
      },
      ...(args.additionalFilters || []).map(
        (filter: CephCriteriaFilterSpec) => {
          return {
            checkOn: CheckOn.MetricValue,
            filterType: filter.filterType,
            metricMonitorOptions: {
              metricAggregationType: EvaluateOverTimeType.AnyValue,
              metricAlias: filter.metricAlias,
              onNoDataPolicy: onNoDataPolicy,
            },
            value: filter.value,
          };
        },
      ),
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

/**
 * Build a multi-query monitor with NO formula — each query keeps its own
 * alias and the criteria filters reference the aliases independently
 * (combined with FilterCondition.Any/All). Used by health-check templates
 * that watch two `ceph_health_detail` names at once: a formula like
 * `a + b` would yield no result whenever one check is inactive (health-
 * detail series exist only while a check fires), while independent
 * filters evaluate each alias on its own.
 */
export function buildCephMultiQueryMonitorConfig(args: {
  clusterIdentifier: string;
  queries: Array<CephFormulaQuery>;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  groupByAttributeKey?: string | undefined;
}): MonitorStepCephMonitor {
  return {
    clusterIdentifier: args.clusterIdentifier,
    resourceFilters: {},
    metricViewConfig: {
      queryConfigs: args.queries.map((query: CephFormulaQuery) => {
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
      }),
      formulaConfigs: [],
    },
    rollingTime: args.rollingTime,
  };
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

/*
 * --- Health-check-driven templates (V3 WI-26) ---
 *
 * All of the following watch `ceph_health_detail{name=...}` (or
 * `ceph_daemon_health_metrics{type=...}`) — see the health-check contract
 * comment at the top of this file. Series exist only while a check is
 * active (Quincy+), so every template fires on Max > 0 and recovers on
 * = 0 with TreatAsZero, staying quiet by default.
 */

const pgDamagedTemplate: CephAlertTemplate = {
  id: "ceph-pg-damaged",
  name: "Damaged Placement Groups",
  description:
    "Alert when scrubbing finds data damage — the PG_DAMAGED or OSD_SCRUB_ERRORS health check is active (ceph_health_detail; Quincy and later, absent series = healthy).",
  category: "PG",
  severity: "Critical",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const pgDamagedAlias: string = "pg_damaged";
    const scrubErrorsAlias: string = "scrub_errors";

    return buildCephMonitorStep({
      cephMonitor: buildCephMultiQueryMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        queries: [
          {
            alias: pgDamagedAlias,
            metricName: "ceph_health_detail",
            attributes: { name: "PG_DAMAGED" },
          },
          {
            alias: scrubErrorsAlias,
            metricName: "ceph_health_detail",
            attributes: { name: "OSD_SCRUB_ERRORS" },
          },
        ],
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias: pgDamagedAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        additionalFilters: [
          {
            metricAlias: scrubErrorsAlias,
            filterType: FilterType.GreaterThan,
            value: 0,
          },
        ],
        incidentTitle: `[Ceph] CRITICAL: Damaged Placement Groups - ${args.monitorName}`,
        incidentDescription: `Ceph scrubbing has found damaged placement groups or OSD read errors (PG_DAMAGED / OSD_SCRUB_ERRORS health checks). Data integrity is at risk on at least one replica. Run \`ceph health detail\` to see the affected PGs, \`rados list-inconsistent-pg <pool>\` to locate the inconsistencies, and repair with \`ceph pg repair <pg.id>\`. Scrub errors usually indicate failing media — check the backing disks' SMART data before repairing.`,
        criteriaName: "PG Damaged - Scrub Found Errors",
        criteriaDescription:
          "Triggers when the PG_DAMAGED or OSD_SCRUB_ERRORS health check is active.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias: pgDamagedAlias,
        filterType: FilterType.EqualTo,
        value: 0,
        additionalFilters: [
          {
            metricAlias: scrubErrorsAlias,
            filterType: FilterType.EqualTo,
            value: 0,
          },
        ],
        filterCondition: FilterCondition.All,
        treatNoDataAsZero: true,
      }),
    });
  },
};

const daemonCrashTemplate: CephAlertTemplate = {
  id: "ceph-daemon-crash",
  name: "Daemon Crash",
  description:
    "Alert when one or more Ceph daemons have recently crashed (RECENT_CRASH health check). This is the only crash signal the mgr exports — there is no ceph_crash_* metric.",
  category: "Cluster Health",
  severity: "Critical",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "recent_crash";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_health_detail",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
        attributes: { name: "RECENT_CRASH" },
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[Ceph] CRITICAL: Daemon Crash Detected - ${args.monitorName}`,
        incidentDescription: `One or more Ceph daemons have crashed recently and the crashes have not been acknowledged (RECENT_CRASH health check). Run \`ceph crash ls-new\` to list the new crashes and \`ceph crash info <crash-id>\` to inspect the backtrace. Once investigated, archive them with \`ceph crash archive <crash-id>\` (or \`ceph crash archive-all\`) — the health check clears when all crashes are archived.`,
        criteriaName: "Daemon Crash - RECENT_CRASH Active",
        criteriaDescription:
          "Triggers when the RECENT_CRASH health check reports unacknowledged daemon crashes.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
        treatNoDataAsZero: true,
      }),
    });
  },
};

const osdSlowHeartbeatsTemplate: CephAlertTemplate = {
  id: "ceph-osd-slow-heartbeats",
  name: "OSD Slow Heartbeats",
  description:
    "Alert when OSD heartbeat pings on the front (public) or back (cluster) network exceed Ceph's grace threshold (OSD_SLOW_PING_TIME_FRONT/BACK health checks — the mgr exports no ping-time gauge, so these are the only signal).",
  category: "OSD",
  severity: "Warning",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const frontAlias: string = "slow_ping_front";
    const backAlias: string = "slow_ping_back";

    return buildCephMonitorStep({
      cephMonitor: buildCephMultiQueryMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        queries: [
          {
            alias: frontAlias,
            metricName: "ceph_health_detail",
            attributes: { name: "OSD_SLOW_PING_TIME_FRONT" },
          },
          {
            alias: backAlias,
            metricName: "ceph_health_detail",
            attributes: { name: "OSD_SLOW_PING_TIME_BACK" },
          },
        ],
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias: frontAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        additionalFilters: [
          {
            metricAlias: backAlias,
            filterType: FilterType.GreaterThan,
            value: 0,
          },
        ],
        incidentTitle: `[Ceph] OSD Slow Heartbeats - ${args.monitorName}`,
        incidentDescription: `OSD heartbeat pings on the front (client/public) or back (cluster/replication) network are exceeding Ceph's grace threshold (OSD_SLOW_PING_TIME_FRONT / OSD_SLOW_PING_TIME_BACK health checks). Slow heartbeats usually mean network congestion, packet loss, or a saturated NIC — and can escalate to OSDs being wrongly marked down. Run \`ceph health detail\` to see the affected OSD pairs, then inspect the network path between their hosts.`,
        criteriaName: "Slow Heartbeats - Front or Back Network",
        criteriaDescription:
          "Triggers when the OSD_SLOW_PING_TIME_FRONT or OSD_SLOW_PING_TIME_BACK health check is active.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias: frontAlias,
        filterType: FilterType.EqualTo,
        value: 0,
        additionalFilters: [
          {
            metricAlias: backAlias,
            filterType: FilterType.EqualTo,
            value: 0,
          },
        ],
        filterCondition: FilterCondition.All,
        treatNoDataAsZero: true,
      }),
    });
  },
};

const monClockSkewTemplate: CephAlertTemplate = {
  id: "ceph-mon-clock-skew",
  name: "Monitor Clock Skew",
  description:
    "Alert when clock skew between Ceph monitors exceeds the allowed threshold (MON_CLOCK_SKEW health check). Skewed clocks can drop monitors from quorum.",
  category: "Cluster Health",
  severity: "Warning",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "mon_clock_skew";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_health_detail",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
        attributes: { name: "MON_CLOCK_SKEW" },
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[Ceph] Monitor Clock Skew - ${args.monitorName}`,
        incidentDescription: `Clock skew between Ceph monitor daemons has exceeded the allowed threshold (MON_CLOCK_SKEW health check; default 0.05 s). Monitors need closely synchronized clocks to maintain quorum — sustained skew can drop monitors out and stall the cluster. Run \`ceph time-sync-status\` to see per-monitor offsets and fix time synchronization (chrony/ntpd) on the affected monitor hosts.`,
        criteriaName: "Clock Skew - MON_CLOCK_SKEW Active",
        criteriaDescription:
          "Triggers when the MON_CLOCK_SKEW health check is active.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
        treatNoDataAsZero: true,
      }),
    });
  },
};

const osdNearfullTemplate: CephAlertTemplate = {
  id: "ceph-osd-nearfull",
  name: "OSD Nearfull",
  description:
    "Alert when any individual OSD crosses the nearfull threshold (OSD_NEARFULL health check; default 85%). Single OSDs fill up long before the cluster average does.",
  category: "Capacity",
  severity: "Warning",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "osd_nearfull";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_health_detail",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
        attributes: { name: "OSD_NEARFULL" },
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[Ceph] OSD Nearfull - ${args.monitorName}`,
        incidentDescription: `One or more OSDs have crossed the nearfull threshold (OSD_NEARFULL health check; default 85%). Capacity is rarely perfectly balanced — individual OSDs fill up before the cluster does, and any single OSD reaching the full ratio blocks writes cluster-wide. Run \`ceph osd df\` to find the affected OSDs, rebalance with the balancer module or \`ceph osd reweight-by-utilization\`, and plan capacity now.`,
        criteriaName: "OSD Nearfull - Health Check Active",
        criteriaDescription:
          "Triggers when the OSD_NEARFULL health check is active.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
        treatNoDataAsZero: true,
      }),
    });
  },
};

const osdBackfillfullTemplate: CephAlertTemplate = {
  id: "ceph-osd-backfillfull",
  name: "OSD Backfillfull",
  description:
    "Alert when any OSD crosses the backfillfull threshold (OSD_BACKFILLFULL health check; default 90%). Backfill to these OSDs is blocked, stalling recovery and rebalancing.",
  category: "Capacity",
  severity: "Warning",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "osd_backfillfull";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_health_detail",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
        attributes: { name: "OSD_BACKFILLFULL" },
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[Ceph] OSD Backfillfull - ${args.monitorName}`,
        incidentDescription: `One or more OSDs have crossed the backfillfull threshold (OSD_BACKFILLFULL health check; default 90%). Backfill and rebalance operations onto these OSDs are now refused, which stalls recovery after failures and can leave the cluster degraded. Run \`ceph osd df\` to find the affected OSDs, then free space or add capacity so recovery can proceed before the OSDs reach the full ratio.`,
        criteriaName: "OSD Backfillfull - Health Check Active",
        criteriaDescription:
          "Triggers when the OSD_BACKFILLFULL health check is active.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
        treatNoDataAsZero: true,
      }),
    });
  },
};

const osdFullTemplate: CephAlertTemplate = {
  id: "ceph-osd-full",
  name: "OSD Full",
  description:
    "Alert immediately when any OSD reaches the full threshold (OSD_FULL health check; default 95%) — writes to the cluster are refused until space is freed.",
  category: "Capacity",
  severity: "Critical",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "osd_full";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_health_detail",
        metricAlias,
        /*
         * Past1Minute — writes are already blocked when this check fires,
         * so alert on the very first scrape that reports it.
         */
        rollingTime: RollingTime.Past1Minute,
        aggregationType: MetricsAggregationType.Max,
        attributes: { name: "OSD_FULL" },
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[Ceph] CRITICAL: OSD Full - ${args.monitorName}`,
        incidentDescription: `One or more OSDs have reached the full threshold (OSD_FULL health check; default 95%) and Ceph is refusing writes to protect data integrity — client I/O is stalling now. Free capacity immediately: delete unneeded data or snapshots, add OSDs, or as a last resort temporarily raise the ratio with \`ceph osd set-full-ratio\` (extreme caution) to restore write availability. Run \`ceph osd df\` to identify the full OSDs.`,
        criteriaName: "OSD Full - Health Check Active",
        criteriaDescription:
          "Triggers when the OSD_FULL health check is active.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
        treatNoDataAsZero: true,
      }),
    });
  },
};

const monDiskSpaceTemplate: CephAlertTemplate = {
  id: "ceph-mon-disk-space",
  name: "Monitor Disk Space",
  description:
    "Alert when a Ceph monitor's database disk runs low — Critical at the MON_DISK_CRIT threshold (default 5% free), Warning at MON_DISK_LOW (default 30% free), both tiers in one template. A full monitor disk crashes the monitor and risks quorum.",
  category: "Cluster Health",
  severity: "Critical",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const critAlias: string = "mon_disk_crit";
    const lowAlias: string = "mon_disk_low";

    return buildCephMonitorStep({
      cephMonitor: buildCephMultiQueryMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        queries: [
          {
            alias: critAlias,
            metricName: "ceph_health_detail",
            attributes: { name: "MON_DISK_CRIT" },
          },
          {
            alias: lowAlias,
            metricName: "ceph_health_detail",
            attributes: { name: "MON_DISK_LOW" },
          },
        ],
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
      }),
      // Critical tier first — criteria are evaluated first-match-wins.
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias: critAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[Ceph] CRITICAL: Monitor Disk Critically Low - ${args.monitorName}`,
        incidentDescription: `A Ceph monitor's database disk has crossed the critical threshold (MON_DISK_CRIT health check; default 5% free). If the disk fills completely the monitor crashes — and losing too many monitors loses quorum and halts the cluster. Free space on the affected monitor host immediately: compact the mon store (\`ceph tell mon.<id> compact\`), remove old logs, or grow the volume. Run \`ceph health detail\` to see which monitor is affected.`,
        criteriaName: "Mon Disk Critical - MON_DISK_CRIT Active",
        criteriaDescription:
          "Triggers when the MON_DISK_CRIT health check is active.",
      }),
      additionalOfflineCriteriaInstances: [
        buildCephOfflineCriteriaInstance({
          offlineMonitorStatusId: args.offlineMonitorStatusId,
          incidentSeverityId: args.defaultIncidentSeverityId,
          alertSeverityId: args.defaultAlertSeverityId,
          monitorName: args.monitorName,
          metricAlias: lowAlias,
          filterType: FilterType.GreaterThan,
          value: 0,
          incidentTitle: `[Ceph] Monitor Disk Space Low - ${args.monitorName}`,
          incidentDescription: `A Ceph monitor's database disk is running low on space (MON_DISK_LOW health check; default 30% free). The monitor keeps working, but if the disk keeps filling it will cross the critical threshold and eventually crash, putting quorum at risk. Free space on the affected monitor host: compact the mon store (\`ceph tell mon.<id> compact\`), clean up logs, or grow the volume. Run \`ceph health detail\` to see which monitor is affected.`,
          criteriaName: "Mon Disk Low - MON_DISK_LOW Active",
          criteriaDescription:
            "Triggers when the MON_DISK_LOW health check is active.",
        }),
      ],
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias: critAlias,
        filterType: FilterType.EqualTo,
        value: 0,
        additionalFilters: [
          {
            metricAlias: lowAlias,
            filterType: FilterType.EqualTo,
            value: 0,
          },
        ],
        filterCondition: FilterCondition.All,
        treatNoDataAsZero: true,
      }),
    });
  },
};

const daemonSlowOpsTemplate: CephAlertTemplate = {
  id: "ceph-daemon-slow-ops",
  name: "Daemon Slow Operations",
  description:
    "Alert when a specific OSD or monitor daemon reports slow operations (ceph_daemon_health_metrics, type SLOW_OPS) — the per-daemon complement to the cluster-level Slow Operations template. One incident per daemon.",
  category: "Cluster Health",
  severity: "Warning",
  getMonitorStep: (args: CephAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "daemon_slow_ops";

    return buildCephMonitorStep({
      cephMonitor: buildCephMonitorConfig({
        clusterIdentifier: args.clusterIdentifier,
        metricName: "ceph_daemon_health_metrics",
        metricAlias,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
        attributes: { type: "SLOW_OPS" },
        groupByAttributeKey: "ceph_daemon",
      }),
      offlineCriteriaInstance: buildCephOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[Ceph] Daemon Slow Operations - ${args.monitorName}`,
        incidentDescription: `A Ceph daemon is reporting operations that exceed the configured complaint time (ceph_daemon_health_metrics with type SLOW_OPS). Unlike the cluster-level Slow Operations alert, this pinpoints the exact OSD or monitor. Inspect the daemon with \`ceph daemon <ceph_daemon> dump_ops_in_flight\` and check its host for a failing or saturated disk and network problems. Check the root cause for the affected ceph_daemon label.`,
        criteriaName: "Daemon Slow Ops - Count > 0",
        criteriaDescription:
          "Triggers when any daemon reports slow operations via ceph_daemon_health_metrics.",
      }),
      onlineCriteriaInstance: buildCephOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
        treatNoDataAsZero: true,
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
    // Health-check-driven templates (V3 WI-26):
    pgDamagedTemplate,
    daemonCrashTemplate,
    osdSlowHeartbeatsTemplate,
    monClockSkewTemplate,
    osdNearfullTemplate,
    osdBackfillfullTemplate,
    osdFullTemplate,
    monDiskSpaceTemplate,
    daemonSlowOpsTemplate,
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
