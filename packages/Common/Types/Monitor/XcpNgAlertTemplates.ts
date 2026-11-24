import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import {
  AdditionalCriteriaFilterSpec,
  STOPPED_REPORTING_METRIC_ALIAS,
  buildHealthyCriteriaInstance,
  buildStoppedReportingCriteriaInstances,
  buildUnhealthyCriteriaInstance,
} from "./Recommendation/RecommendationCriteriaBuilder";
import FilterCondition from "../Filter/FilterCondition";
import { FilterType, EvaluateOverTimeType } from "./CriteriaFilter";
import MonitorStepXcpNgMonitor from "./MonitorStepXcpNgMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import {
  XCP_NG_ID_ATTRIBUTE,
  XCP_NG_SCOPE_ATTRIBUTE,
  XcpNgDerivedSeries,
  XcpNgScope,
  XcpNgSeries,
} from "../XcpNg/XcpNgTelemetry";

export type XcpNgAlertTemplateCategory =
  | "Availability"
  | "Host"
  | "VM"
  | "Storage";

export type XcpNgAlertTemplateSeverity = "Critical" | "Warning";

export interface XcpNgAlertTemplateArgs {
  // The pool's XAPI UUID (XcpNgPool.poolIdentifier).
  poolIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface XcpNgAlertTemplate {
  id: string;
  name: string;
  /*
   * One plain sentence: when the template fires, with its threshold and
   * window, without metric names. The picker and a pool's Recommendations
   * list show it on the card; `description` (how it is computed, and its
   * caveats) is shown once a template is picked.
   */
  summary: string;
  description: string;
  category: XcpNgAlertTemplateCategory;
  severity: XcpNgAlertTemplateSeverity;
  getMonitorStep: (args: XcpNgAlertTemplateArgs) => MonitorStep;
}

/*
 * Filter contract. Every XCP-ng datapoint carries `xcp_ng.scope` (pool |
 * host | vm | sr | vdi | xostor) and `xcp_ng.id` (the object's XAPI UUID),
 * stamped at ingest by XcpNgSeriesNormalizer, so a template filters on the
 * scope and groups by `xcp_ng.id` - one incident per host, VM or storage
 * repository, whichever of Xen Orchestra's labels (uuid, sr_uuid) named it.
 * Both are datapoint attributes, so they are not `resource.`-prefixed.
 *
 * The state of a host or a VM is a label in Xen Orchestra's series
 * (power_state), which a threshold cannot read; the templates read the 0/1
 * series OneUptime derives from it at ingest (XcpNgDerivedSeries) instead.
 */

const GROUP_BY_OBJECT: string = XCP_NG_ID_ATTRIBUTE;

function scope(value: XcpNgScope): Record<string, string> {
  return { [XCP_NG_SCOPE_ATTRIBUTE]: value };
}

export function buildXcpNgMonitorStep(args: {
  xcpNgMonitor: MonitorStepXcpNgMonitor;
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
    xcpNgMonitor: args.xcpNgMonitor,
  };

  return monitorStep;
}

export function buildXcpNgOfflineCriteriaInstance(args: {
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
  metricAggregationType?: EvaluateOverTimeType | undefined;
  /*
   * Extra comparisons combined with the primary one per `filterCondition`,
   * WITHIN a series on a grouped monitor (the queries share the
   * `xcp_ng.id` group-by, so `All` means "this host is up AND this same
   * host has a short uptime").
   */
  additionalFilters?: Array<AdditionalCriteriaFilterSpec> | undefined;
  filterCondition?: FilterCondition | undefined;
}): MonitorCriteriaInstance {
  return buildUnhealthyCriteriaInstance({
    ...args,
    resourceNoun: "XCP-ng resource",
  });
}

export function buildXcpNgOnlineCriteriaInstance(args: {
  onlineMonitorStatusId: ObjectID;
  metricAlias: string;
  filterType: FilterType;
  value: number;
  recoveryValue?: number | undefined;
  marginFraction?: number | undefined;
  isBinaryMetric?: boolean | undefined;
  metricAggregationType?: EvaluateOverTimeType | undefined;
  additionalFilters?: Array<AdditionalCriteriaFilterSpec> | undefined;
  filterCondition?: FilterCondition | undefined;
}): MonitorCriteriaInstance {
  return buildHealthyCriteriaInstance(args);
}

export interface XcpNgQuery {
  alias: string;
  metricName: string;
  attributes?: Record<string, string> | undefined;
  legendUnit?: string | undefined;
}

/*
 * A monitor watching one or more metrics with no formula. Several queries
 * share the group-by key, which is what lets the per-series evaluator line
 * them up: series fingerprints are computed from the grouped labels alone,
 * so two queries grouped by `xcp_ng.id` land on one fingerprint per object.
 */
export function buildXcpNgMonitorConfig(args: {
  poolIdentifier: string;
  queries: Array<XcpNgQuery>;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  groupByAttributeKey?: string | undefined;
}): MonitorStepXcpNgMonitor {
  return {
    poolIdentifier: args.poolIdentifier,
    resourceFilters: {},
    metricViewConfig: {
      queryConfigs: args.queries.map((query: XcpNgQuery) => {
        return {
          metricAliasData: {
            metricVariable: query.alias,
            title: query.alias,
            description: query.alias,
            legend: query.alias,
            legendUnit: query.legendUnit,
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

/*
 * A monitor whose criteria read a formula over two or more queries
 * (`(used / size) * 100`), grouped so one incident fires per object. Every
 * XCP-ng metric of a pool comes from one scrape, so the queries are
 * same-receiver and Sum/Sum cancels the scrape multiple.
 */
export function buildXcpNgFormulaMonitorConfig(args: {
  poolIdentifier: string;
  queries: Array<XcpNgQuery>;
  formula: string;
  resultAlias: string;
  resultLegend: string;
  resultUnit: string;
  rollingTime: RollingTime;
  aggregationType?: MetricsAggregationType | undefined;
  groupByAttributeKey?: string | undefined;
}): MonitorStepXcpNgMonitor {
  const base: MonitorStepXcpNgMonitor = buildXcpNgMonitorConfig({
    poolIdentifier: args.poolIdentifier,
    queries: args.queries,
    rollingTime: args.rollingTime,
    aggregationType: args.aggregationType || MetricsAggregationType.Sum,
    groupByAttributeKey: args.groupByAttributeKey,
  });

  return {
    ...base,
    metricViewConfig: {
      queryConfigs: base.metricViewConfig.queryConfigs,
      formulaConfigs: [
        {
          metricAliasData: {
            metricVariable: args.resultAlias,
            title: args.resultLegend,
            description: args.resultLegend,
            legend: args.resultLegend,
            legendUnit: args.resultUnit,
          },
          metricFormulaData: {
            metricFormula: args.formula,
          },
        },
      ],
    },
  };
}

// --- Template definitions ---

const poolDisconnectedTemplate: XcpNgAlertTemplate = {
  id: "xcp-ng-pool-disconnected",
  name: "Pool Disconnected",
  summary: "Xen Orchestra stops reporting the pool for 5 minutes.",
  description:
    "Alert when the pool's connection heartbeat (xcp_pool_connected) stops arriving for five minutes. Xen Orchestra sends it every scrape while it is connected to the pool, and stops - rather than sending 0 - when it loses the pool's master. It also stops when Xen Orchestra itself or the XCP-ng Agent stops, so the incident names all three. One incident for the pool; it resolves when the heartbeat comes back.",
  category: "Availability",
  severity: "Critical",
  getMonitorStep: (args: XcpNgAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = STOPPED_REPORTING_METRIC_ALIAS;

    return buildXcpNgMonitorStep({
      xcpNgMonitor: buildXcpNgMonitorConfig({
        poolIdentifier: args.poolIdentifier,
        queries: [
          {
            alias: metricAlias,
            metricName: XcpNgSeries.PoolConnected,
          },
        ],
        rollingTime: RollingTime.Past5Minutes,
        // Ungrouped and counted: only a window with no row at all breaches.
        aggregationType: MetricsAggregationType.Count,
      }),
      ...buildStoppedReportingCriteriaInstances({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        resourceNoun: "XCP-ng pool",
        incidentTitle: `[XCP-ng] Pool Disconnected - ${args.monitorName}`,
        incidentDescription: `OneUptime has had no word from this XCP-ng pool through Xen Orchestra for five minutes, so its other monitors have nothing to evaluate either. Check, in order: whether Xen Orchestra still shows the pool connected (Settings, Servers) - it loses a pool when the pool master goes down or its address or password changes; whether Xen Orchestra itself is up and its OpenMetrics plugin loaded; and whether the XCP-ng Agent is running and can reach Xen Orchestra and OneUptime (its troubleshoot.sh names the failing step). The incident resolves on its own once the pool is reported again.`,
        criteriaName: "Pool Disconnected - no heartbeat for 5 minutes",
        criteriaDescription:
          "Triggers when the pool sends no xcp_pool_connected data for the whole five-minute window.",
      }),
    });
  },
};

const hostOfflineTemplate: XcpNgAlertTemplate = {
  id: "xcp-ng-host-offline",
  name: "Host Offline",
  summary: "A host stops running for 5 minutes.",
  description:
    "Alert when Xen Orchestra reports a host of the pool Halted or in an Unknown state for five minutes (xcp_ng.host.running < 1, derived from xcp_host_status). One incident per host. The VMs that ran on it are down too unless HA restarted them elsewhere.",
  category: "Availability",
  severity: "Critical",
  getMonitorStep: (args: XcpNgAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "host_running";

    return buildXcpNgMonitorStep({
      xcpNgMonitor: buildXcpNgMonitorConfig({
        poolIdentifier: args.poolIdentifier,
        queries: [
          {
            alias: metricAlias,
            metricName: XcpNgDerivedSeries.HostRunning,
            attributes: scope(XcpNgScope.Host),
          },
        ],
        rollingTime: RollingTime.Past5Minutes,
        // Min per host: one scrape that saw it down is a down minute.
        aggregationType: MetricsAggregationType.Min,
        groupByAttributeKey: GROUP_BY_OBJECT,
      }),
      offlineCriteriaInstance: buildXcpNgOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 1,
        incidentTitle: `[XCP-ng] Host Offline - ${args.monitorName}`,
        incidentDescription: `Xen Orchestra reports an XCP-ng host of this pool as not running (Halted, or Unknown when the pool master lost contact with it) for five minutes. Every VM that ran on it is down unless HA restarted it on another host. See the affected host on this alert, check its power and management network (XCP-ng's console, its BMC), and whether the pool master still reaches it. If you removed the host from the pool on purpose, the incident resolves once Xen Orchestra stops reporting it.`,
        criteriaName: "Host Offline - xcp_ng.host.running < 1",
        criteriaDescription:
          "Triggers when a host reads as not running in every minute of the five-minute window.",
      }),
      onlineCriteriaInstance: buildXcpNgOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
        // 0 or 1: the shared 10% recovery dead band would be unreachable.
        isBinaryMetric: true,
      }),
    });
  },
};

const hostDisabledTemplate: XcpNgAlertTemplate = {
  id: "xcp-ng-host-disabled",
  name: "Host Disabled",
  summary: "A host stays disabled (maintenance mode) for 30 minutes.",
  description:
    "Alert when a host of the pool stays disabled for 30 minutes (xcp_ng.host.enabled < 1, derived from xcp_host_status): it is in maintenance mode or being evacuated, so XAPI starts no VM on it and the pool has one host less to fail over to. Thirty minutes lets a planned reboot or update pass without a page. One incident per host.",
  category: "Host",
  severity: "Warning",
  getMonitorStep: (args: XcpNgAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "host_enabled";

    return buildXcpNgMonitorStep({
      xcpNgMonitor: buildXcpNgMonitorConfig({
        poolIdentifier: args.poolIdentifier,
        queries: [
          {
            alias: metricAlias,
            metricName: XcpNgDerivedSeries.HostEnabled,
            attributes: scope(XcpNgScope.Host),
          },
        ],
        rollingTime: RollingTime.Past30Minutes,
        aggregationType: MetricsAggregationType.Max,
        groupByAttributeKey: GROUP_BY_OBJECT,
      }),
      offlineCriteriaInstance: buildXcpNgOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: 1,
        incidentTitle: `[XCP-ng] Host Disabled - ${args.monitorName}`,
        incidentDescription: `An XCP-ng host of this pool has been disabled for 30 minutes: it is in maintenance mode, or an evacuation left it disabled. XAPI starts no VM on it and HA cannot fail over to it, so the pool runs with less capacity than it looks. If the maintenance is over, enable the host again (Xen Orchestra: the host's page, Enable; or xe host-enable). The incident resolves once the host is enabled.`,
        criteriaName: "Host Disabled - xcp_ng.host.enabled < 1 for 30 minutes",
        criteriaDescription:
          "Triggers when a host reads as disabled in every minute of the 30-minute window.",
      }),
      onlineCriteriaInstance: buildXcpNgOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
        isBinaryMetric: true,
      }),
    });
  },
};

const vmStoppedTemplate: XcpNgAlertTemplate = {
  id: "xcp-ng-vm-stopped",
  name: "VM Stopped",
  summary: "A VM that was running stays halted for 5 minutes.",
  description:
    "Alert when a VM that ran in the last 24 hours has been Halted or Paused for five minutes (xcp_ng.vm.stopped_after_running, derived by OneUptime from xcp_vm_status and the VM's last run). A VM switched off for more than a day counts as off on purpose and stops alerting; a suspended VM never alerts; control domains and templates are left out. One incident per VM; it resolves when the VM runs again.",
  category: "VM",
  severity: "Warning",
  getMonitorStep: (args: XcpNgAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "vm_stopped";

    return buildXcpNgMonitorStep({
      xcpNgMonitor: buildXcpNgMonitorConfig({
        poolIdentifier: args.poolIdentifier,
        queries: [
          {
            alias: metricAlias,
            metricName: XcpNgDerivedSeries.VmStoppedAfterRunning,
            attributes: scope(XcpNgScope.VM),
          },
        ],
        rollingTime: RollingTime.Past5Minutes,
        // Min per VM: stopped in every scrape of the minute.
        aggregationType: MetricsAggregationType.Min,
        groupByAttributeKey: GROUP_BY_OBJECT,
      }),
      offlineCriteriaInstance: buildXcpNgOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0,
        incidentTitle: `[XCP-ng] VM Stopped - ${args.monitorName}`,
        incidentDescription: `A VM of this XCP-ng pool that was running has been halted or paused for five minutes. It may have crashed, been shut down from inside the guest, or been stopped by someone in Xen Orchestra. See the affected VM on this alert, then check Xen Orchestra's logs and the pool's tasks for who or what stopped it, and the VM's console for a crash. If it was stopped on purpose, the incident resolves once it runs again, and the alert stops on its own after the VM has been off for a day.`,
        criteriaName: "VM Stopped - halted for 5 minutes after running",
        criteriaDescription:
          "Triggers when a VM that ran in the last 24 hours reads as halted or paused in every minute of the five-minute window.",
      }),
      onlineCriteriaInstance: buildXcpNgOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    });
  },
};

/*
 * A VM waits for a physical CPU this share of the time before it counts as
 * starved: 10%. Below it, contention is the normal cost of sharing a host;
 * XenServer's own performance guidance treats sustained runqueue time above
 * a few percent as worth looking at.
 */
export const XCP_NG_VM_CPU_CONTENTION_THRESHOLD: number = 0.1;

const vmCpuStarvedTemplate: XcpNgAlertTemplate = {
  id: "xcp-ng-vm-cpu-starved",
  name: "VM Starved of CPU",
  summary:
    "A VM waits for a physical CPU more than 10% of the time for 15 minutes.",
  description:
    "Alert when a VM's vCPUs are all ready to run but wait for a physical CPU more than 10% of the time, for 15 minutes (xcp_vm_runstate_full_contention > 0.1). Its host is overcommitted: the VM runs slower than its own CPU use suggests, whatever it does inside. One incident per VM.",
  category: "VM",
  severity: "Warning",
  getMonitorStep: (args: XcpNgAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "vm_cpu_contention";

    return buildXcpNgMonitorStep({
      xcpNgMonitor: buildXcpNgMonitorConfig({
        poolIdentifier: args.poolIdentifier,
        queries: [
          {
            alias: metricAlias,
            metricName: XcpNgSeries.VmRunstateFullContention,
            attributes: scope(XcpNgScope.VM),
            // A 0..1 ratio, compared as one.
            legendUnit: "1",
          },
        ],
        rollingTime: RollingTime.Past15Minutes,
        aggregationType: MetricsAggregationType.Avg,
        groupByAttributeKey: GROUP_BY_OBJECT,
      }),
      offlineCriteriaInstance: buildXcpNgOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: XCP_NG_VM_CPU_CONTENTION_THRESHOLD,
        incidentTitle: `[XCP-ng] VM Starved of CPU - ${args.monitorName}`,
        incidentDescription: `A VM of this XCP-ng pool has spent more than 10% of the last 15 minutes waiting for a physical CPU while all its vCPUs were ready to run. Its host has more runnable vCPUs than CPU threads: the VM is slowed by its neighbours, not by its own load. See the affected VM on this alert, then compare its host's load (above 1 means VMs wait) and running vCPUs with its CPU threads; migrate the VM or a busy neighbour to a quieter host, or give the VM fewer vCPUs.`,
        criteriaName: "VM Starved of CPU - full contention > 10%",
        criteriaDescription:
          "Triggers when a VM's full contention averages above 0.1 in every minute of the 15-minute window.",
      }),
      onlineCriteriaInstance: buildXcpNgOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: XCP_NG_VM_CPU_CONTENTION_THRESHOLD,
      }),
    });
  },
};

// A storage repository this full alerts: the issue's bar.
export const XCP_NG_SR_NEAR_FULL_PERCENT: number = 90;

const storageRepositoryNearFullTemplate: XcpNgAlertTemplate = {
  id: "xcp-ng-sr-near-full",
  name: "Storage Repository Near Full",
  summary: "A storage repository is more than 90% full.",
  description:
    "Alert when a storage repository's used space passes 90% of its size (xcp_sr_physical_usage_bytes ÷ xcp_sr_physical_size_bytes × 100), one incident per storage repository. A full repository stops VMs writing, pauses or fails them, and blocks snapshots, so backups fail too. Repositories that report a size of 0 (some ISO libraries and removable media) never alert.",
  category: "Storage",
  severity: "Critical",
  getMonitorStep: (args: XcpNgAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "sr_used_percent";

    return buildXcpNgMonitorStep({
      xcpNgMonitor: buildXcpNgFormulaMonitorConfig({
        poolIdentifier: args.poolIdentifier,
        queries: [
          {
            alias: "sr_used",
            metricName: XcpNgSeries.SrPhysicalUsageBytes,
            attributes: scope(XcpNgScope.StorageRepository),
          },
          {
            alias: "sr_size",
            metricName: XcpNgSeries.SrPhysicalSizeBytes,
            attributes: scope(XcpNgScope.StorageRepository),
          },
        ],
        formula: "(sr_used / sr_size) * 100",
        resultAlias: metricAlias,
        resultLegend: "Storage Repository Used (%)",
        resultUnit: "%",
        rollingTime: RollingTime.Past5Minutes,
        groupByAttributeKey: GROUP_BY_OBJECT,
      }),
      offlineCriteriaInstance: buildXcpNgOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: XCP_NG_SR_NEAR_FULL_PERCENT,
        incidentTitle: `[XCP-ng] Storage Repository Near Full (>90%) - ${args.monitorName}`,
        incidentDescription: `A storage repository of this XCP-ng pool is more than 90% full. When it fills, VMs with disks on it stop writing (they pause or fail), and snapshots and the backups that take them fail. See the affected storage repository on this alert, then free space: delete old snapshots (snapshot chains of thin-provisioned VHDs grow until coalesced), move disks to another repository, or grow it. Check whether its allocated size is far above its size: thin provisioning can fill it fast.`,
        criteriaName: "Storage Repository Near Full - used > 90%",
        criteriaDescription:
          "Triggers when a storage repository's used space is above 90% of its size in every minute of the five-minute window.",
      }),
      onlineCriteriaInstance: buildXcpNgOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: XCP_NG_SR_NEAR_FULL_PERCENT,
      }),
    });
  },
};

// A storage repository answering slower than this, on average, alerts.
export const XCP_NG_SR_SLOW_LATENCY_SECONDS: number = 0.05;

const storageRepositorySlowTemplate: XcpNgAlertTemplate = {
  id: "xcp-ng-sr-slow",
  name: "Storage Repository Slow",
  summary:
    "A host's reads and writes to a storage repository take more than 50 ms for 15 minutes.",
  description:
    "Alert when a host's I/O to a storage repository takes more than 50 ms on average for 15 minutes (xcp_host_disk_latency_seconds > 0.05). Every VM with a disk on it feels it. One incident per host and storage repository.",
  category: "Storage",
  severity: "Warning",
  getMonitorStep: (args: XcpNgAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "sr_latency";

    return buildXcpNgMonitorStep({
      xcpNgMonitor: buildXcpNgMonitorConfig({
        poolIdentifier: args.poolIdentifier,
        queries: [
          {
            alias: metricAlias,
            metricName: XcpNgSeries.HostDiskLatencySeconds,
            attributes: scope(XcpNgScope.Host),
            legendUnit: "s",
          },
        ],
        rollingTime: RollingTime.Past15Minutes,
        aggregationType: MetricsAggregationType.Avg,
        /*
         * Per host and storage repository: the `sr` label (Xen Orchestra's
         * short id of the repository) rides every host disk series, where
         * sr_uuid only does when Xen Orchestra could resolve it.
         */
        groupByAttributeKey: "sr",
      }),
      offlineCriteriaInstance: buildXcpNgOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: XCP_NG_SR_SLOW_LATENCY_SECONDS,
        incidentTitle: `[XCP-ng] Storage Repository Slow (>50 ms) - ${args.monitorName}`,
        incidentDescription: `A storage repository of this XCP-ng pool has answered its hosts' reads and writes in more than 50 ms on average for 15 minutes. Every VM with a disk on it is slowed. See the affected storage repository on this alert, then check the storage behind it (the array or NAS, its network, a rebuild or a scrub) and which VMs drive the most I/O on it.`,
        criteriaName: "Storage Repository Slow - latency > 50 ms",
        criteriaDescription:
          "Triggers when a host's average latency to a storage repository is above 50 ms in every minute of the 15-minute window.",
      }),
      onlineCriteriaInstance: buildXcpNgOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: XCP_NG_SR_SLOW_LATENCY_SECONDS,
      }),
    });
  },
};

const hostHighCpuTemplate: XcpNgAlertTemplate = {
  id: "xcp-ng-host-high-cpu",
  name: "High Host CPU Usage",
  summary: "A host uses more than 90% of its CPU for 10 minutes.",
  description:
    "Alert when a host's CPU use, averaged over its cores, stays above 90% for 10 minutes (xcp_host_cpu_average > 0.9). Its VMs start waiting for CPU. One incident per host.",
  category: "Host",
  severity: "Warning",
  getMonitorStep: (args: XcpNgAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "host_cpu";

    return buildXcpNgMonitorStep({
      xcpNgMonitor: buildXcpNgMonitorConfig({
        poolIdentifier: args.poolIdentifier,
        queries: [
          {
            alias: metricAlias,
            metricName: XcpNgSeries.HostCpuAverage,
            attributes: scope(XcpNgScope.Host),
            legendUnit: "1",
          },
        ],
        rollingTime: RollingTime.Past10Minutes,
        aggregationType: MetricsAggregationType.Avg,
        groupByAttributeKey: GROUP_BY_OBJECT,
      }),
      offlineCriteriaInstance: buildXcpNgOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 0.9,
        incidentTitle: `[XCP-ng] High Host CPU Usage (>90%) - ${args.monitorName}`,
        incidentDescription: `An XCP-ng host of this pool has used more than 90% of its CPU for 10 minutes. Its VMs start waiting for a physical CPU and slow down. See the affected host on this alert and its busiest VMs, then migrate some of them to a quieter host of the pool.`,
        criteriaName: "High Host CPU - average > 0.9",
        criteriaDescription:
          "Triggers when a host's average CPU use is above 0.9 in every minute of the 10-minute window.",
      }),
      onlineCriteriaInstance: buildXcpNgOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 0.9,
      }),
    });
  },
};

const hostHighMemoryTemplate: XcpNgAlertTemplate = {
  id: "xcp-ng-host-high-memory",
  name: "High Host Memory Usage",
  summary: "A host has given more than 95% of its memory to VMs.",
  description:
    "Alert when less than 5% of a host's memory is free for 10 minutes ((total - free) ÷ total × 100 > 95). XAPI then cannot start or migrate a VM onto it, and HA may not be able to restart VMs there. One incident per host.",
  category: "Host",
  severity: "Warning",
  getMonitorStep: (args: XcpNgAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "host_memory_used_percent";

    return buildXcpNgMonitorStep({
      xcpNgMonitor: buildXcpNgFormulaMonitorConfig({
        poolIdentifier: args.poolIdentifier,
        queries: [
          {
            alias: "mem_total",
            metricName: XcpNgSeries.HostMemoryTotalBytes,
            attributes: scope(XcpNgScope.Host),
          },
          {
            alias: "mem_free",
            metricName: XcpNgSeries.HostMemoryFreeBytes,
            attributes: scope(XcpNgScope.Host),
          },
        ],
        formula: "((mem_total - mem_free) / mem_total) * 100",
        resultAlias: metricAlias,
        resultLegend: "Host Memory Used (%)",
        resultUnit: "%",
        rollingTime: RollingTime.Past10Minutes,
        groupByAttributeKey: GROUP_BY_OBJECT,
      }),
      offlineCriteriaInstance: buildXcpNgOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.GreaterThan,
        value: 95,
        incidentTitle: `[XCP-ng] High Host Memory Usage (>95%) - ${args.monitorName}`,
        incidentDescription: `An XCP-ng host of this pool has had less than 5% of its memory free for 10 minutes. XAPI cannot start or migrate a VM onto it, and HA may be unable to restart VMs on it after another host fails. See the affected host on this alert, then migrate VMs off it or lower their memory.`,
        criteriaName: "High Host Memory - used > 95%",
        criteriaDescription:
          "Triggers when a host's used memory is above 95% of its total in every minute of the 10-minute window.",
      }),
      onlineCriteriaInstance: buildXcpNgOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.LessThanOrEqualTo,
        value: 95,
      }),
    });
  },
};

/*
 * How long a host counts as just restarted: long enough for every scrape of
 * a 5-minute window after the boot to see it, short enough that the alert
 * ends on its own (Proxmox's Node Restarted uses the same 15 minutes).
 */
export const XCP_NG_HOST_RESTARTED_UPTIME_SECONDS: number = 900;

const hostRestartedTemplate: XcpNgAlertTemplate = {
  id: "xcp-ng-host-restarted",
  name: "Host Restarted",
  summary: "A host started less than 15 minutes ago.",
  description:
    "Alert when a running host has been up for less than 15 minutes (xcp_host_uptime_seconds below 900 while xcp_ng.host.running is 1): it rebooted, or crashed and came back. One incident per host, which resolves once it has been up for 16.5 minutes. A host that is down raises Host Offline instead.",
  category: "Host",
  severity: "Warning",
  getMonitorStep: (args: XcpNgAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "host_uptime";
    const runningAlias: string = "host_is_running";

    return buildXcpNgMonitorStep({
      xcpNgMonitor: buildXcpNgMonitorConfig({
        poolIdentifier: args.poolIdentifier,
        queries: [
          {
            alias: metricAlias,
            metricName: XcpNgSeries.HostUptimeSeconds,
            attributes: scope(XcpNgScope.Host),
          },
          {
            alias: runningAlias,
            metricName: XcpNgDerivedSeries.HostRunning,
            attributes: scope(XcpNgScope.Host),
          },
        ],
        rollingTime: RollingTime.Past5Minutes,
        // Min: the shortest uptime, and running in every scrape.
        aggregationType: MetricsAggregationType.Min,
        groupByAttributeKey: GROUP_BY_OBJECT,
      }),
      offlineCriteriaInstance: buildXcpNgOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        filterType: FilterType.LessThan,
        value: XCP_NG_HOST_RESTARTED_UPTIME_SECONDS,
        filterCondition: FilterCondition.All,
        additionalFilters: [
          {
            metricAlias: runningAlias,
            filterType: FilterType.GreaterThan,
            value: 0,
          },
        ],
        incidentTitle: `[XCP-ng] Host Restarted - ${args.monitorName}`,
        incidentDescription: `An XCP-ng host of this pool has been up for less than 15 minutes: it rebooted, or crashed and came back. If nobody restarted it, check its previous boot's logs (the xensource.log and kern.log kept in /var/log on the host, and the host's BMC event log) for a crash, a watchdog, an HA fence or a power event, and whether HA moved its VMs while it was down. The incident resolves once the host has been up for 16.5 minutes.`,
        criteriaName: "Host Restarted - uptime < 15 minutes while running",
        criteriaDescription:
          "Triggers when a running host has been up for less than 15 minutes.",
      }),
      onlineCriteriaInstance: buildXcpNgOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: XCP_NG_HOST_RESTARTED_UPTIME_SECONDS,
        /*
         * Either clears it: the host has been up for 15 minutes, or it went
         * down again (Host Offline takes over). The running half is also the
         * suite invariant's recovering filter for that alias.
         */
        additionalFilters: [
          {
            metricAlias: runningAlias,
            filterType: FilterType.EqualTo,
            value: 0,
          },
        ],
      }),
    });
  },
};

export function getAllXcpNgAlertTemplates(): Array<XcpNgAlertTemplate> {
  return [
    poolDisconnectedTemplate,
    hostOfflineTemplate,
    vmStoppedTemplate,
    storageRepositoryNearFullTemplate,
    hostDisabledTemplate,
    hostRestartedTemplate,
    hostHighCpuTemplate,
    hostHighMemoryTemplate,
    vmCpuStarvedTemplate,
    storageRepositorySlowTemplate,
  ];
}

export function getXcpNgAlertTemplatesByCategory(
  category: XcpNgAlertTemplateCategory,
): Array<XcpNgAlertTemplate> {
  return getAllXcpNgAlertTemplates().filter((template: XcpNgAlertTemplate) => {
    return template.category === category;
  });
}

export function getXcpNgAlertTemplateById(
  id: string,
): XcpNgAlertTemplate | undefined {
  return getAllXcpNgAlertTemplates().find((template: XcpNgAlertTemplate) => {
    return template.id === id;
  });
}

/*
 * The template a NEW XCP-ng monitor starts on: the pool going silent. It is
 * the one template that still speaks when every other one has stopped being
 * evaluated, and it has no threshold to tune.
 */
export function getXcpNgDefaultAlertTemplateId(): string {
  return poolDisconnectedTemplate.id;
}
