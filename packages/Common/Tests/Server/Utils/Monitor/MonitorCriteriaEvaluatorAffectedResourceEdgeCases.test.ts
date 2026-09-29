/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox and the
 * prebuilt binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import Dictionary from "../../../../Types/Dictionary";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import MetricFormulaConfigData from "../../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import {
  CephAlertTemplate,
  getCephAlertTemplateById,
} from "../../../../Types/Monitor/CephAlertTemplates";
import { getCephMetricByMetricName } from "../../../../Types/Monitor/CephMetricCatalog";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import {
  DockerSwarmAlertTemplate,
  getDockerSwarmAlertTemplateById,
} from "../../../../Types/Monitor/DockerSwarmAlertTemplates";
import { getDockerSwarmMetricByMetricName } from "../../../../Types/Monitor/DockerSwarmMetricCatalog";
import {
  buildKubernetesMonitorConfig,
  buildKubernetesMonitorStep,
  buildOfflineCriteriaInstance,
  buildOnlineCriteriaInstance,
  getKubernetesAlertTemplateById,
  KubernetesAlertTemplate,
} from "../../../../Types/Monitor/KubernetesAlertTemplates";
import { getKubernetesMetricByMetricName } from "../../../../Types/Monitor/KubernetesMetricCatalog";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { KubernetesResourceScope } from "../../../../Types/Monitor/MonitorStepKubernetesMonitor";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  getProxmoxAlertTemplateById,
  ProxmoxAlertTemplate,
} from "../../../../Types/Monitor/ProxmoxAlertTemplates";
import { getProxmoxMetricByMetricName } from "../../../../Types/Monitor/ProxmoxMetricCatalog";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import MetricFormulaEvaluator from "../../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import PlatformMetricUnitUtil, {
  MetricCatalogPlatform,
} from "../../../../Utils/Monitor/PlatformMetricUnitUtil";
import PlatformResourceIdentity, {
  CephResourceIdentity,
  DockerSwarmResourceIdentity,
  KubernetesResourceIdentity,
  ProxmoxResourceIdentity,
} from "../../../../Utils/Monitor/PlatformResourceIdentity";
import { describe, expect, test } from "@jest/globals";

/*
 * Why this suite exists.
 *
 * An adversarial review of the "Affected Resources" list found five inputs
 * the per-platform suites did not cover, each of which produced a wrong or
 * missing list in the incident email:
 *
 *  1. An "Any" criteria (ceph-pg-damaged: PG_DAMAGED > 0 OR
 *     OSD_SCRUB_ERRORS > 0) was always described by its FIRST filter. With
 *     only the scrub-error check active there is no PG_DAMAGED scan, so the
 *     list the scrub errors had was dropped.
 *  2. A grouped "Any" criteria over two aliases ranked a node that matched
 *     on "used bytes > 200 GB" against nodes valued in "% utilization" —
 *     one list, two units — and the analysis could say "memory usage is at
 *     **210 GB**" under a percentage threshold.
 *  3. The dashboard's criteria form saves a threshold as a STRING ("60").
 *     The list's breach predicate only read numeric thresholds, so every
 *     edited criteria fell back to "> 0, highest first": pod-pending named
 *     the Unknown pod, task-down ranked the healthiest task first, and
 *     node-offline listed the nodes that were up.
 *  4. The raw scan is in the metric's native unit, the threshold in the
 *     filter's thresholdUnit: "uptime < 1 min" tested 30 seconds against 1
 *     and listed nothing.
 *  5. A monitor grouped by a key that names no platform object (a PVC
 *     name) rendered every series as the same anonymous "**Cluster**" row,
 *     and Proxmox dropped the list outright.
 *
 * Each case below drives the REAL template (or the form-built monitor the
 * review reproduced) through MonitorCriteriaEvaluator.processMonitorStep
 * with a worker-shaped response, so the evaluator sets each filter's
 * context itself, and pins the rendered markdown.
 */

const MINUTES: Array<Date> = [0, 1, 2, 3, 4].map((minute: number): Date => {
  return new Date(Date.UTC(2026, 8, 25, 10, minute, 0));
});

const K8S_CLUSTER: string = "prod-east";
const PVE_CLUSTER: string = "pve-lab";
const CEPH_CLUSTER: string = "ceph-prod";
const SWARM_CLUSTER: string = "swarm-prod";

const K8S_CLUSTER_KEY: string = "resource.k8s.cluster.name";
const NODE_KEY: string = "resource.k8s.node.name";
const NAMESPACE_KEY: string = "resource.k8s.namespace.name";
const POD_KEY: string = "resource.k8s.pod.name";
const PVC_KEY: string = "resource.k8s.persistentvolumeclaim.name";

const GB: number = 1_000_000_000;

// No rendered value may be a raw, unscaled 10+ digit number (bytes, epochs).
const RAW_NUMBER: RegExp = /\b\d{10,}\b/;

/*
 * ---------------------------------------------------------------------------
 * Platform fixtures
 * ---------------------------------------------------------------------------
 */

type ScannedResource<I> = I & {
  metricValue: number;
  lowestMetricValue?: number | undefined;
};

// A platform raw-scan breakdown without its cluster name.
interface ScannedBreakdown<I> {
  metricName: string;
  metricFriendlyName: string;
  metricAlias: string | undefined;
  metricUnit: string | undefined;
  attributes: Dictionary<string>;
  affectedResources: Array<ScannedResource<I>>;
}

interface PlatformFixture<I> {
  monitorType: MonitorType;
  platform: MetricCatalogPlatform;
  friendlyName: (metricName: string) => string | undefined;
  toIdentity: (attributes: JSONObject) => I;
  identityKey: (identity: I) => string;
  attach: (
    response: MetricMonitorResponse,
    breakdowns: Array<ScannedBreakdown<I>>,
  ) => void;
}

const KUBERNETES: PlatformFixture<KubernetesResourceIdentity> = {
  monitorType: MonitorType.Kubernetes,
  platform: "kubernetes",
  friendlyName: (metricName: string): string | undefined => {
    return getKubernetesMetricByMetricName(metricName)?.friendlyName;
  },
  toIdentity: PlatformResourceIdentity.kubernetes,
  identityKey: PlatformResourceIdentity.kubernetesKey,
  attach: (
    response: MetricMonitorResponse,
    breakdowns: Array<ScannedBreakdown<KubernetesResourceIdentity>>,
  ): void => {
    response.kubernetesResourceBreakdowns = breakdowns.map(
      (breakdown: ScannedBreakdown<KubernetesResourceIdentity>) => {
        return { ...breakdown, clusterName: K8S_CLUSTER };
      },
    );
  },
};

const PROXMOX: PlatformFixture<ProxmoxResourceIdentity> = {
  monitorType: MonitorType.Proxmox,
  platform: "proxmox",
  friendlyName: (metricName: string): string | undefined => {
    return getProxmoxMetricByMetricName(metricName)?.friendlyName;
  },
  toIdentity: PlatformResourceIdentity.proxmox,
  identityKey: PlatformResourceIdentity.proxmoxKey,
  attach: (
    response: MetricMonitorResponse,
    breakdowns: Array<ScannedBreakdown<ProxmoxResourceIdentity>>,
  ): void => {
    response.proxmoxResourceBreakdowns = breakdowns.map(
      (breakdown: ScannedBreakdown<ProxmoxResourceIdentity>) => {
        return { ...breakdown, clusterName: PVE_CLUSTER };
      },
    );
  },
};

const CEPH: PlatformFixture<CephResourceIdentity> = {
  monitorType: MonitorType.Ceph,
  platform: "ceph",
  friendlyName: (metricName: string): string | undefined => {
    return getCephMetricByMetricName(metricName)?.friendlyName;
  },
  toIdentity: PlatformResourceIdentity.ceph,
  identityKey: PlatformResourceIdentity.cephKey,
  attach: (
    response: MetricMonitorResponse,
    breakdowns: Array<ScannedBreakdown<CephResourceIdentity>>,
  ): void => {
    response.cephResourceBreakdowns = breakdowns.map(
      (breakdown: ScannedBreakdown<CephResourceIdentity>) => {
        return { ...breakdown, clusterName: CEPH_CLUSTER };
      },
    );
  },
};

const DOCKER_SWARM: PlatformFixture<DockerSwarmResourceIdentity> = {
  monitorType: MonitorType.DockerSwarm,
  platform: "dockerSwarm",
  friendlyName: (metricName: string): string | undefined => {
    return getDockerSwarmMetricByMetricName(metricName)?.friendlyName;
  },
  toIdentity: PlatformResourceIdentity.dockerSwarm,
  identityKey: PlatformResourceIdentity.dockerSwarmKey,
  attach: (
    response: MetricMonitorResponse,
    breakdowns: Array<ScannedBreakdown<DockerSwarmResourceIdentity>>,
  ): void => {
    response.dockerSwarmResourceBreakdowns = breakdowns.map(
      (breakdown: ScannedBreakdown<DockerSwarmResourceIdentity>) => {
        return { ...breakdown, clusterName: SWARM_CLUSTER };
      },
    );
  },
};

/*
 * ---------------------------------------------------------------------------
 * Monitor step helpers
 * ---------------------------------------------------------------------------
 */

interface CommonTemplateArgs {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

function commonArgs(monitorName: string): CommonTemplateArgs {
  return {
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: monitorName,
  };
}

function requireTemplate<T>(template: T | undefined, id: string): T {
  if (!template) {
    throw new Error(`${id} template missing`);
  }

  return template;
}

function kubernetesStep(templateId: string): MonitorStep {
  const template: KubernetesAlertTemplate = requireTemplate(
    getKubernetesAlertTemplateById(templateId),
    templateId,
  );

  return template.getMonitorStep({
    clusterIdentifier: K8S_CLUSTER,
    ...commonArgs(`${K8S_CLUSTER} - ${template.name}`),
  });
}

function proxmoxStep(templateId: string): MonitorStep {
  const template: ProxmoxAlertTemplate = requireTemplate(
    getProxmoxAlertTemplateById(templateId),
    templateId,
  );

  return template.getMonitorStep({
    clusterIdentifier: PVE_CLUSTER,
    ...commonArgs(`${PVE_CLUSTER} - ${template.name}`),
  });
}

function cephStep(templateId: string): MonitorStep {
  const template: CephAlertTemplate = requireTemplate(
    getCephAlertTemplateById(templateId),
    templateId,
  );

  return template.getMonitorStep({
    clusterIdentifier: CEPH_CLUSTER,
    ...commonArgs(`${CEPH_CLUSTER} - ${template.name}`),
  });
}

function dockerSwarmStep(templateId: string): MonitorStep {
  const template: DockerSwarmAlertTemplate = requireTemplate(
    getDockerSwarmAlertTemplateById(templateId),
    templateId,
  );

  return template.getMonitorStep({
    clusterIdentifier: SWARM_CLUSTER,
    ...commonArgs(`${SWARM_CLUSTER} - ${template.name}`),
  });
}

function viewConfigOf(monitorStep: MonitorStep): MetricsViewConfig {
  const config: MetricsViewConfig | undefined =
    MonitorStep.getMetricsViewConfig(monitorStep);

  if (!config) {
    throw new Error("monitor step has no metric view config");
  }

  return config;
}

function aliasOf(config: {
  metricAliasData?: { metricVariable?: string | undefined } | undefined;
}): string {
  return config.metricAliasData?.metricVariable || "";
}

function metricNameOf(queryConfig: MetricQueryConfigData): string {
  return (queryConfig.metricQueryData.filterData.metricName as string) || "";
}

function queryOf(
  monitorStep: MonitorStep,
  alias: string,
): MetricQueryConfigData {
  const query: MetricQueryConfigData | undefined = viewConfigOf(
    monitorStep,
  ).queryConfigs.find((queryConfig: MetricQueryConfigData): boolean => {
    return aliasOf(queryConfig) === alias;
  });

  if (!query) {
    throw new Error(`no query aliased ${alias}`);
  }

  return query;
}

// The template's FIRING criteria — every template builds it first.
function firingOf(monitorStep: MonitorStep): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance | undefined =
    monitorStep.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray[0];

  if (!instance) {
    throw new Error("firing criteria instance missing");
  }

  return instance;
}

function metricFiltersOf(
  criteria: MonitorCriteriaInstance,
): Array<CriteriaFilter> {
  return (criteria.data?.filters || []).filter(
    (filter: CriteriaFilter): boolean => {
      return filter.checkOn === CheckOn.MetricValue;
    },
  );
}

// Drop every query's group-by: the monitor as a user saves it ungrouped.
function ungroup(monitorStep: MonitorStep): MonitorStep {
  for (const queryConfig of viewConfigOf(monitorStep).queryConfigs) {
    delete queryConfig.metricQueryData.groupByAttributeKeys;
  }

  if (MonitorStep.getGroupByAttributeKeys(monitorStep).length > 0) {
    throw new Error("monitor step is still grouped");
  }

  return monitorStep;
}

/*
 * Every metric threshold of every criteria as the dashboard's criteria
 * form saves it: a string ("60", not 60).
 */
function stringifyThresholds(monitorStep: MonitorStep): MonitorStep {
  for (const instance of monitorStep.data?.monitorCriteria?.data
    ?.monitorCriteriaInstanceArray || []) {
    for (const filter of instance.data?.filters || []) {
      if (typeof filter.value === "number") {
        filter.value = String(filter.value);
      }
    }
  }

  return monitorStep;
}

/*
 * ---------------------------------------------------------------------------
 * Worker responses
 * ---------------------------------------------------------------------------
 */

function unitsByMetricNameOf<I>(input: {
  monitorStep: MonitorStep;
  fixture: PlatformFixture<I>;
  declaredUnits?: Dictionary<string> | undefined;
}): Dictionary<string> {
  return PlatformMetricUnitUtil.buildUnitsByMetricName({
    platform: input.fixture.platform,
    metricNames: viewConfigOf(input.monitorStep).queryConfigs.map(metricNameOf),
    declaredUnitsByMetricName: new Map<string, string>(
      Object.entries(input.declaredUnits || {}).map(
        ([metricName, unit]: [string, string]): [string, string] => {
          return [metricName.toLowerCase(), unit];
        },
      ),
    ),
  });
}

function rowsOf(input: {
  values: Array<number>;
  attributes: JSONObject;
}): Array<AggregateModel> {
  return input.values.map((value: number, minute: number): AggregateModel => {
    return {
      timestamp: MINUTES[minute]!,
      value: value,
      attributes: input.attributes,
    } as unknown as AggregateModel;
  });
}

/*
 * One resource as the worker's raw rows see it: the datapoint attributes
 * every row of it carries, and one value per minute for each query alias.
 */
interface RawSeries {
  attributes: JSONObject;
  valuesByAlias: Dictionary<Array<number>>;
}

/*
 * What the telemetry worker hands the evaluator for a GROUPED monitor:
 * per-series rows aligned [queries..., formulas...] (query rows carry the
 * raw datapoint's attributes, formula slots are evaluated by the worker's
 * own MetricFormulaEvaluator), labels / fingerprints from the step's
 * group-by keys, one alias-tagged raw scan per query, and the
 * catalog-overlaid unit map.
 */
function groupedResponse<I>(input: {
  monitorStep: MonitorStep;
  fixture: PlatformFixture<I>;
  series: Array<RawSeries>;
  declaredUnits?: Dictionary<string> | undefined;
}): MetricMonitorResponse {
  const viewConfig: MetricsViewConfig = viewConfigOf(input.monitorStep);
  const queryConfigs: Array<MetricQueryConfigData> = viewConfig.queryConfigs;
  const formulaConfigs: Array<MetricFormulaConfigData> =
    viewConfig.formulaConfigs || [];
  const groupByKeys: Array<string> = MonitorStep.getGroupByAttributeKeys(
    input.monitorStep,
  );

  if (groupByKeys.length === 0) {
    throw new Error("groupedResponse is for GROUPED monitors");
  }

  const unitsByMetricName: Dictionary<string> = unitsByMetricNameOf(input);

  const seriesBreakdown: Array<MetricSeriesResult> = input.series.map(
    (series: RawSeries): MetricSeriesResult => {
      const results: Array<AggregatedResult> = queryConfigs.map(
        (queryConfig: MetricQueryConfigData): AggregatedResult => {
          return {
            data: rowsOf({
              values: series.valuesByAlias[aliasOf(queryConfig)] || [],
              attributes: series.attributes,
            }),
          };
        },
      );

      formulaConfigs.forEach(
        (formulaConfig: MetricFormulaConfigData, index: number): void => {
          results.push(
            MetricFormulaEvaluator.evaluateFormula({
              formula: formulaConfig.metricFormulaData.metricFormula,
              queryConfigs: queryConfigs,
              formulaConfigs: formulaConfigs.slice(0, index),
              results: [...results],
            }),
          );
        },
      );

      const labels: JSONObject = MetricSeriesFingerprint.extractSeriesLabels({
        sample: { attributes: series.attributes } as unknown as AggregateModel,
        attributeKeys: groupByKeys,
      });

      return {
        fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
        labels: labels,
        aggregatedResults: results,
      };
    },
  );

  const breakdowns: Array<ScannedBreakdown<I>> = queryConfigs.map(
    (queryConfig: MetricQueryConfigData): ScannedBreakdown<I> => {
      const alias: string = aliasOf(queryConfig);
      const metricName: string = metricNameOf(queryConfig);
      const byKey: Map<string, ScannedResource<I>> = new Map<
        string,
        ScannedResource<I>
      >();

      for (const series of input.series) {
        for (const value of series.valuesByAlias[alias] || []) {
          const identity: I = input.fixture.toIdentity(series.attributes);
          const key: string = input.fixture.identityKey(identity);
          const existing: ScannedResource<I> | undefined = byKey.get(key);

          if (!existing) {
            byKey.set(key, {
              ...identity,
              metricValue: value,
              lowestMetricValue: value,
            });
            continue;
          }

          existing.metricValue = Math.max(existing.metricValue, value);
          existing.lowestMetricValue = Math.min(
            existing.lowestMetricValue ?? value,
            value,
          );
        }
      }

      return {
        metricName: metricName,
        metricFriendlyName:
          input.fixture.friendlyName(metricName) || metricName,
        metricAlias: alias,
        metricUnit: unitsByMetricName[metricName.toLowerCase()],
        attributes: {},
        affectedResources: Array.from(byKey.values()),
      };
    },
  );

  const response: MetricMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricResult: [],
    metricViewConfig: viewConfig,
    seriesBreakdown: seriesBreakdown,
    nativeUnitsByMetricName: unitsByMetricName,
  };

  input.fixture.attach(
    response,
    breakdowns.filter((breakdown: ScannedBreakdown<I>): boolean => {
      return breakdown.affectedResources.length > 0;
    }),
  );

  return response;
}

// One query's raw scan, as the worker tags it.
interface ScanSpec<I> {
  alias: string;
  metricUnit?: string | undefined;
  resources: Array<ScannedResource<I>>;
}

/*
 * What the worker hands the evaluator for an UNGROUPED monitor: one
 * AggregatedResult per query (aligned with the step's queries — the
 * criteria read their own alias's slot), and a raw scan for each query
 * that returned datapoints, tagged with that query's alias.
 */
function ungroupedResponse<I>(input: {
  monitorStep: MonitorStep;
  fixture: PlatformFixture<I>;
  valuesByAlias: Dictionary<Array<number>>;
  scans: Array<ScanSpec<I>>;
  declaredUnits?: Dictionary<string> | undefined;
}): MetricMonitorResponse {
  const viewConfig: MetricsViewConfig = viewConfigOf(input.monitorStep);

  if (MonitorStep.getGroupByAttributeKeys(input.monitorStep).length > 0) {
    throw new Error("ungroupedResponse is for UNGROUPED monitors");
  }

  const unitsByMetricName: Dictionary<string> = unitsByMetricNameOf(input);

  const response: MetricMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricResult: viewConfig.queryConfigs.map(
      (queryConfig: MetricQueryConfigData): AggregatedResult => {
        return {
          data: rowsOf({
            values: input.valuesByAlias[aliasOf(queryConfig)] || [],
            attributes: {},
          }),
        };
      },
    ),
    metricViewConfig: viewConfig,
    nativeUnitsByMetricName: unitsByMetricName,
  };

  input.fixture.attach(
    response,
    input.scans.map((scan: ScanSpec<I>): ScannedBreakdown<I> => {
      const metricName: string = metricNameOf(
        queryOf(input.monitorStep, scan.alias),
      );

      return {
        metricName: metricName,
        metricFriendlyName:
          input.fixture.friendlyName(metricName) || metricName,
        metricAlias: scan.alias,
        metricUnit: scan.metricUnit,
        attributes: {},
        affectedResources: scan.resources,
      };
    }),
  );

  return response;
}

/*
 * ---------------------------------------------------------------------------
 * Evaluation + rendered-markdown helpers
 * ---------------------------------------------------------------------------
 */

async function evaluate<I>(input: {
  monitorStep: MonitorStep;
  fixture: PlatformFixture<I>;
  response: MetricMonitorResponse;
}): Promise<ProbeApiIngestResponse> {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.monitorType = input.fixture.monitorType;
  monitor.name = "edge-case monitor";

  return MonitorCriteriaEvaluator.processMonitorStep({
    dataToProcess: input.response,
    monitorStep: input.monitorStep,
    monitor: monitor,
    probeApiIngestResponse: {
      monitorId: monitor.id!,
      rootCause: null,
    },
    evaluationSummary: {
      criteriaResults: [],
      events: [],
    } as unknown as MonitorEvaluationSummary,
  });
}

/*
 * The rendered root cause of one criteria, or "" when it did not match: a
 * grouped monitor reports every matched criteria, an ungrouped one only
 * its first.
 */
function rootCauseFor(
  response: ProbeApiIngestResponse,
  criteria: MonitorCriteriaInstance,
): string {
  const criteriaId: string = criteria.data?.id?.toString() || "";

  const matched: MatchedCriteriaResult | undefined = (
    response.matchedCriteria || []
  ).find((result: MatchedCriteriaResult): boolean => {
    return result.criteriaId === criteriaId;
  });

  if (matched) {
    return matched.rootCause;
  }

  return response.criteriaMetId?.toString() === criteriaId
    ? response.rootCause || ""
    : "";
}

async function firingRootCause<I>(input: {
  monitorStep: MonitorStep;
  fixture: PlatformFixture<I>;
  response: MetricMonitorResponse;
}): Promise<string> {
  return rootCauseFor(await evaluate(input), firingOf(input.monitorStep));
}

// From a list heading up to the analysis that follows it, trimmed.
function listSection(rootCause: string, heading: string): string {
  const start: number = rootCause.indexOf(`**${heading}**`);

  if (start < 0) {
    return "";
  }

  const end: number = rootCause.indexOf("**Root Cause Analysis**", start);

  return (
    end < 0 ? rootCause.substring(start) : rootCause.substring(start, end)
  ).trim();
}

const ENTRY_HEAD: RegExp = /^\d+\. /;

// The first line of every numbered entry in a list.
function entryHeads(section: string): Array<string> {
  return section.split("\n").filter((line: string): boolean => {
    return ENTRY_HEAD.test(line);
  });
}

function linesOf(rootCause: string): Array<string> {
  return rootCause.split("\n");
}

/*
 * The "- Metric:" line for one query, with the catalog's name looked up
 * rather than hard-coded (catalogs change).
 */
function metricLine<I>(
  fixture: PlatformFixture<I>,
  metricName: string,
): string {
  const friendlyName: string | undefined = fixture.friendlyName(metricName);

  return friendlyName && friendlyName !== metricName
    ? `- Metric: ${friendlyName} (\`${metricName}\`)`
    : `- Metric: \`${metricName}\``;
}

function metricLinesOf(rootCause: string): Array<string> {
  return linesOf(rootCause).filter((line: string): boolean => {
    return line.startsWith("- Metric:");
  });
}

/*
 * ---------------------------------------------------------------------------
 * 1. An "Any" criteria is described by the filter that fired
 * ---------------------------------------------------------------------------
 */

interface CephAnyCase {
  templateId: string;
  // The one health check that is active, and the query that watches it.
  activeAlias: string;
  activeCheck: string;
  // The check that is NOT active.
  inactiveCheck: string;
}

const CEPH_ANY_CASES: Array<CephAnyCase> = [
  {
    templateId: "ceph-pg-damaged",
    activeAlias: "scrub_errors",
    activeCheck: "OSD_SCRUB_ERRORS",
    inactiveCheck: "PG_DAMAGED",
  },
  {
    templateId: "ceph-pg-damaged",
    activeAlias: "pg_damaged",
    activeCheck: "PG_DAMAGED",
    inactiveCheck: "OSD_SCRUB_ERRORS",
  },
  {
    templateId: "ceph-osd-slow-heartbeats",
    activeAlias: "slow_ping_back",
    activeCheck: "OSD_SLOW_PING_TIME_BACK",
    inactiveCheck: "OSD_SLOW_PING_TIME_FRONT",
  },
];

describe("An Any criteria follows the filter that fired", () => {
  /*
   * ceph_health_detail reports a check only while it is active (an absent
   * series is healthy), so the inactive query returns no datapoints and
   * the worker has no scan for it: metricResult is [[], [rows]] and the
   * one breakdown is the active query's.
   */
  function cephAnyResponse(input: {
    monitorStep: MonitorStep;
    testCase: CephAnyCase;
  }): MetricMonitorResponse {
    return ungroupedResponse({
      monitorStep: input.monitorStep,
      fixture: CEPH,
      valuesByAlias: { [input.testCase.activeAlias]: [1, 1, 1, 1, 1] },
      scans: [
        {
          alias: input.testCase.activeAlias,
          resources: [{ poolName: input.testCase.activeCheck, metricValue: 1 }],
        },
      ],
    });
  }

  for (const testCase of CEPH_ANY_CASES) {
    test(`${testCase.templateId}: only ${testCase.activeCheck} active — it is listed and its query named`, async () => {
      const monitorStep: MonitorStep = cephStep(testCase.templateId);
      const firing: MonitorCriteriaInstance = firingOf(monitorStep);

      // Fixture guard: an ungrouped "Any" over two ceph_health_detail queries.
      expect(firing.data?.filterCondition).toBe(FilterCondition.Any);
      expect(
        metricFiltersOf(firing).map((filter: CriteriaFilter): string => {
          return filter.metricMonitorOptions?.metricAlias || "";
        }),
      ).toContain(testCase.activeAlias);
      expect(metricFiltersOf(firing)).toHaveLength(2);
      expect(MonitorStep.getGroupByAttributeKeys(monitorStep)).toEqual([]);

      const rootCause: string = await firingRootCause({
        monitorStep: monitorStep,
        fixture: CEPH,
        response: cephAnyResponse({
          monitorStep: monitorStep,
          testCase: testCase,
        }),
      });

      // The evaluator marked exactly the active query's filter as breaching.
      const breached: Array<string> = metricFiltersOf(firing)
        .filter((filter: CriteriaFilter): boolean => {
          return (
            (filter.metricCriteriaContext?.breachingSamples || []).length > 0
          );
        })
        .map((filter: CriteriaFilter): string => {
          return filter.metricMonitorOptions?.metricAlias || "";
        });
      expect(breached).toEqual([testCase.activeAlias]);

      expect(listSection(rootCause, "Affected Resources")).toBe(
        [
          "**Affected Resources** (1 total)",
          "",
          `1. **Health Check** \`${testCase.activeCheck}\` — **1**`,
        ].join("\n"),
      );

      /*
       * Both queries read ceph_health_detail, so the fired query's metric
       * line is the only one — never a second, and never the metric-count
       * fallback that stood in for the dropped list.
       */
      expect(metricLinesOf(rootCause)).toEqual([
        metricLine(
          CEPH,
          metricNameOf(queryOf(monitorStep, testCase.activeAlias)),
        ),
      ]);
      expect(rootCause).toContain(`- Cluster: ${CEPH_CLUSTER}`);
      expect(rootCause).not.toContain("**Metric Summary**");
      expect(rootCause).not.toContain(testCase.inactiveCheck);
    });
  }
});

/*
 * ---------------------------------------------------------------------------
 * 2. A grouped Any criteria over two aliases
 * ---------------------------------------------------------------------------
 */

/*
 * k8s-high-memory with its firing criteria widened, as a user would in the
 * form, to "utilization > 85% OR used memory > 200 GB": node_memory_
 * utilization is the formula (%), used_mem its numerator (bytes).
 */
function highMemoryAnyStep(): MonitorStep {
  const monitorStep: MonitorStep = kubernetesStep("k8s-high-memory");
  const firing: MonitorCriteriaInstance = firingOf(monitorStep);
  const utilizationFilter: CriteriaFilter = metricFiltersOf(firing)[0]!;

  expect(utilizationFilter.metricMonitorOptions?.metricAlias).toBe(
    "node_memory_utilization",
  );

  firing.data!.filterCondition = FilterCondition.Any;
  firing.data!.filters.push({
    ...utilizationFilter,
    metricMonitorOptions: {
      ...utilizationFilter.metricMonitorOptions!,
      metricAlias: "used_mem",
    },
    value: 200 * GB,
  });

  return monitorStep;
}

function k8sNode(input: {
  name: string;
  used: number | Array<number>;
  allocatable: number;
}): RawSeries {
  return {
    attributes: { [K8S_CLUSTER_KEY]: K8S_CLUSTER, [NODE_KEY]: input.name },
    valuesByAlias: {
      used_mem: Array.isArray(input.used)
        ? input.used
        : MINUTES.map((): number => {
            return input.used as number;
          }),
      alloc_mem: MINUTES.map((): number => {
        return input.allocatable;
      }),
    },
  };
}

const K8S_DECLARED_UNITS: Dictionary<string> = {
  "k8s.node.memory.usage": "By",
  "k8s.node.allocatable_memory": "By",
  "k8s.volume.available": "By",
  "k8s.pod.phase": "1",
};

// 86.26% .. 88.82% of 257.76 GB, and over 200 GB: matches BOTH filters.
const HOT_NODE: RawSeries = k8sNode({
  name: "node-hot",
  used: [222344608010, 224 * GB, 226 * GB, 228 * GB, 228943289000],
  allocatable: 257760964608,
});

// 210 GB of 400 GB = 52.5%: matches only "used memory > 200 GB".
const BIG_NODE: RawSeries = k8sNode({
  name: "node-big",
  used: 210 * GB,
  allocatable: 400 * GB,
});

// 100 GB of 400 GB: matches neither.
const CALM_NODE: RawSeries = k8sNode({
  name: "node-calm",
  used: 100 * GB,
  allocatable: 400 * GB,
});

describe("A grouped Any criteria over two aliases keeps one unit per rank", () => {
  async function run(series: Array<RawSeries>): Promise<string> {
    const monitorStep: MonitorStep = highMemoryAnyStep();

    return firingRootCause({
      monitorStep: monitorStep,
      fixture: KUBERNETES,
      response: groupedResponse({
        monitorStep: monitorStep,
        fixture: KUBERNETES,
        series: series,
        declaredUnits: K8S_DECLARED_UNITS,
      }),
    });
  }

  test("the node over 85% leads in %; the node that matched only on bytes follows, its metric named", async () => {
    // The off-filter node arrives FIRST: its position is the sort's doing.
    const rootCause: string = await run([BIG_NODE, HOT_NODE, CALM_NODE]);

    expect(listSection(rootCause, "Affected Resources")).toBe(
      [
        "**Affected Resources** (2 total)",
        "",
        "1. **Node** `node-hot` — **88.82%**",
        "2. **Node** `node-big` — **210 GB** (`used_mem`)",
      ].join("\n"),
    );

    expect(rootCause).not.toContain("node-calm");
    expect(rootCause).not.toMatch(RAW_NUMBER);
    // Never the bytes node ranked as if 210 were a percentage.
    expect(rootCause).not.toContain("**210.00%**");
  });

  test("the list and the analysis are about the filter that fired — the % one", async () => {
    const rootCause: string = await run([BIG_NODE, HOT_NODE, CALM_NODE]);

    expect(rootCause).toContain("- Metric: Node Memory Utilization (%)");
    expect(rootCause).toContain("**Root Cause Analysis**");
    expect(rootCause).toContain(
      "Node `node-hot` memory usage is at **88.82%**.",
    );
    expect(rootCause).not.toContain("memory usage is at **210 GB**");
    expect(rootCause).not.toMatch(/memory usage is at \*\*[\d.]+ GB/);
  });

  test("off-filter rows never interleave with on-filter rows, and are never ranked", async () => {
    /*
     * Input interleaves the two kinds. The % rows are ranked worst first;
     * the bytes rows follow in the order they came — 230 GB after 210 GB,
     * because their numbers are not comparable with the % rows and are
     * not re-ranked among themselves either.
     */
    const rootCause: string = await run([
      BIG_NODE,
      HOT_NODE,
      k8sNode({ name: "node-big-2", used: 230 * GB, allocatable: 512 * GB }),
      CALM_NODE,
      k8sNode({ name: "node-hot-2", used: 58.88 * GB, allocatable: 64 * GB }),
    ]);

    expect(entryHeads(listSection(rootCause, "Affected Resources"))).toEqual([
      "1. **Node** `node-hot-2` — **92.00%**",
      "2. **Node** `node-hot` — **88.82%**",
      "3. **Node** `node-big` — **210 GB** (`used_mem`)",
      "4. **Node** `node-big-2` — **230 GB** (`used_mem`)",
    ]);
    expect(listSection(rootCause, "Affected Resources")).toContain(
      "**Affected Resources** (4 total)",
    );
    expect(rootCause).toContain(
      "Node `node-hot-2` memory usage is at **92.00%**.",
    );
  });
});

/*
 * The ordering and value-cell rules on their own, through the typed shim:
 * a fall criteria ranks lowest first, rows valued by another filter follow
 * in arrival order, a no-data row comes last, and only an off-filter
 * value carries a note.
 */
interface ShimRow {
  identity: { name: string };
  value: number | null;
  formattedValue: string;
  valueNote?: string | undefined;
}

type EvaluatorPrivate = {
  sortAffectedRows: (input: {
    rows: Array<ShimRow>;
    worstIsLowest: boolean;
  }) => Array<ShimRow>;
  renderAffectedRowValue: (row: ShimRow) => string;
};

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

describe("Affected-row ordering and value cells", () => {
  function shimRow(
    name: string,
    value: number | null,
    valueNote?: string | undefined,
  ): ShimRow {
    return {
      identity: { name: name },
      value: value,
      formattedValue: value === null ? "no data" : `${value}`,
      ...(valueNote ? { valueNote: valueNote } : {}),
    };
  }

  function rendered(rows: Array<ShimRow>): Array<string> {
    return rows.map((row: ShimRow): string => {
      return `${row.identity.name} ${Evaluator.renderAffectedRowValue(row)}`;
    });
  }

  const ROWS: Array<ShimRow> = [
    shimRow("off-a", 5, "`other_alias`"),
    shimRow("silent", null),
    shimRow("on-40", 40),
    shimRow("off-b", 1, "Other Metric"),
    shimRow("on-10", 10),
    shimRow("on-25", 25),
  ];

  test("a rise criteria: on-filter highest first, then off-filter as they came, then no data", () => {
    expect(
      rendered(
        Evaluator.sortAffectedRows({ rows: ROWS, worstIsLowest: false }),
      ),
    ).toEqual([
      "on-40 **40**",
      "on-25 **25**",
      "on-10 **10**",
      "off-a **5** (`other_alias`)",
      "off-b **1** (Other Metric)",
      "silent **no data**",
    ]);
  });

  test("a fall criteria: on-filter lowest first, then off-filter as they came, then no data", () => {
    expect(
      rendered(Evaluator.sortAffectedRows({ rows: ROWS, worstIsLowest: true })),
    ).toEqual([
      "on-10 **10**",
      "on-25 **25**",
      "on-40 **40**",
      "off-a **5** (`other_alias`)",
      "off-b **1** (Other Metric)",
      "silent **no data**",
    ]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * 3. Thresholds saved as strings
 * ---------------------------------------------------------------------------
 */

describe("A threshold saved as a string reads like the number", () => {
  test('k8s-pod-pending with "1": only the Pending pod is listed, and the analysis sends the reader to it', async () => {
    const monitorStep: MonitorStep = stringifyThresholds(
      kubernetesStep("k8s-pod-pending"),
    );
    const firing: MonitorCriteriaInstance = firingOf(monitorStep);

    // Fixture guard: an ungrouped, incident-opening `= "1"`.
    expect(metricFiltersOf(firing)[0]?.filterType).toBe(FilterType.EqualTo);
    expect(metricFiltersOf(firing)[0]?.value).toBe("1");
    expect(MonitorStep.getGroupByAttributeKeys(monitorStep)).toEqual([]);

    const alias: string = aliasOf(viewConfigOf(monitorStep).queryConfigs[0]!);

    const rootCause: string = await firingRootCause({
      monitorStep: monitorStep,
      fixture: KUBERNETES,
      response: ungroupedResponse({
        monitorStep: monitorStep,
        fixture: KUBERNETES,
        declaredUnits: K8S_DECLARED_UNITS,
        // The cluster-wide Min phase: a pod has been Pending all window.
        valuesByAlias: { [alias]: [1, 1, 1, 1, 1] },
        scans: [
          {
            alias: alias,
            metricUnit: "1",
            resources: [
              {
                podName: "checkout-7d9f-running",
                namespace: "shop",
                metricValue: 2,
                lowestMetricValue: 2,
              },
              {
                podName: "checkout-7d9f-pending",
                namespace: "shop",
                metricValue: 1,
                lowestMetricValue: 1,
              },
              {
                podName: "report-job-failed",
                namespace: "batch",
                metricValue: 4,
                lowestMetricValue: 4,
              },
              {
                podName: "lost-pod",
                namespace: "shop",
                metricValue: 5,
                lowestMetricValue: 5,
              },
            ],
          },
        ],
      }),
    });

    expect(listSection(rootCause, "Affected Resources")).toBe(
      [
        "**Affected Resources** (1 total)",
        "",
        "1. **Pod** `checkout-7d9f-pending` — **1**",
        "   - Namespace: `shop`",
      ].join("\n"),
    );
    expect(rootCause).toContain("kubectl describe pod checkout-7d9f-pending");
    expect(rootCause).not.toContain("checkout-7d9f-running");
    expect(rootCause).not.toContain("report-job-failed");
    expect(rootCause).not.toContain("lost-pod");
  });

  describe('grouped docker-swarm-task-down with "60"', () => {
    function swarmTask(input: {
      container: string;
      service: string;
      node: string;
      uptimes: Array<number>;
    }): RawSeries {
      return {
        attributes: {
          "resource.container.name": input.container,
          "resource.docker.swarm.cluster.name": SWARM_CLUSTER,
          "docker.swarm.service.name": input.service,
          "docker.swarm.node.name": input.node,
        },
        valuesByAlias: { container_uptime: input.uptimes },
      };
    }

    const TASKS: Array<RawSeries> = [
      swarmTask({
        container: "web.2.bbb",
        service: "web",
        node: "n2",
        uptimes: [40, 55, 59],
      }),
      swarmTask({
        container: "db.1.ccc",
        service: "db",
        node: "n3",
        uptimes: [3000, 3060, 3120],
      }),
      swarmTask({
        container: "web.1.aaa",
        service: "web",
        node: "n1",
        uptimes: [5, 35, 58],
      }),
    ];

    function run(monitorStep: MonitorStep): Promise<string> {
      return firingRootCause({
        monitorStep: monitorStep,
        fixture: DOCKER_SWARM,
        response: groupedResponse({
          monitorStep: monitorStep,
          fixture: DOCKER_SWARM,
          series: TASKS,
          declaredUnits: { "container.uptime": "s" },
        }),
      });
    }

    test("ranks the lowest-uptime task first, each at its LOWEST breaching sample", async () => {
      const monitorStep: MonitorStep = stringifyThresholds(
        dockerSwarmStep("docker-swarm-task-down"),
      );

      expect(metricFiltersOf(firingOf(monitorStep))[0]?.value).toBe("60");
      expect(metricFiltersOf(firingOf(monitorStep))[0]?.filterType).toBe(
        FilterType.LessThan,
      );

      const rootCause: string = await run(monitorStep);

      expect(listSection(rootCause, "Affected Tasks")).toBe(
        [
          "**Affected Tasks** (2 total)",
          "",
          "1. **Task** `web.1.aaa` — **5 sec**",
          "   - Service: `web`",
          "   - Node: `n1`",
          "2. **Task** `web.2.bbb` — **40 sec**",
          "   - Service: `web`",
          "   - Node: `n2`",
        ].join("\n"),
      );
      expect(rootCause).not.toContain("db.1.ccc");
    });

    test("renders exactly what the numeric threshold 60 renders", async () => {
      const numeric: string = await run(
        dockerSwarmStep("docker-swarm-task-down"),
      );
      const text: string = await run(
        stringifyThresholds(dockerSwarmStep("docker-swarm-task-down")),
      );

      expect(listSection(numeric, "Affected Tasks")).not.toBe("");
      expect(text).toBe(numeric);
    });
  });

  test('pve-node-offline ungrouped with pve_up < "1": the raw scan lists the down node, not the up ones', async () => {
    const monitorStep: MonitorStep = stringifyThresholds(
      ungroup(proxmoxStep("pve-node-offline")),
    );

    expect(metricFiltersOf(firingOf(monitorStep))[0]?.filterType).toBe(
      FilterType.LessThan,
    );
    expect(metricFiltersOf(firingOf(monitorStep))[0]?.value).toBe("1");

    const rootCause: string = await firingRootCause({
      monitorStep: monitorStep,
      fixture: PROXMOX,
      response: ungroupedResponse({
        monitorStep: monitorStep,
        fixture: PROXMOX,
        valuesByAlias: { node_up: [0, 0, 0, 0, 0] },
        scans: [
          {
            alias: "node_up",
            resources: [
              {
                resourceId: "node/pve1",
                resourceType: "node",
                scope: "node",
                metricValue: 1,
                lowestMetricValue: 1,
              },
              {
                resourceId: "node/pve2",
                resourceType: "node",
                scope: "node",
                metricValue: 0,
                lowestMetricValue: 0,
              },
              {
                resourceId: "node/pve3",
                resourceType: "node",
                scope: "node",
                metricValue: 1,
                lowestMetricValue: 1,
              },
            ],
          },
        ],
      }),
    });

    expect(listSection(rootCause, "Affected Resources")).toBe(
      [
        "**Affected Resources** (1 total)",
        "",
        "1. **Node** `node/pve2` — **0**",
      ].join("\n"),
    );
    expect(rootCause).not.toContain("node/pve1");
    expect(rootCause).not.toContain("node/pve3");
  });

  describe('pve-node-high-cpu with its decimal threshold as "0.9"', () => {
    /*
     * The template fires on `> 0.9` and recovers on `<= 0.9` over a 0–1
     * ratio. Read with parseInt, "0.9" was 0: the monitor went offline on
     * any CPU at all, and could only recover at exactly 0.
     */
    function highCpuStep(): MonitorStep {
      const monitorStep: MonitorStep = stringifyThresholds(
        ungroup(proxmoxStep("pve-node-high-cpu")),
      );

      // Fixture guard: an ungrouped `> "0.9"`.
      const filter: CriteriaFilter = metricFiltersOf(firingOf(monitorStep))[0]!;
      expect(filter.filterType).toBe(FilterType.GreaterThan);
      expect(filter.value).toBe("0.9");
      expect(filter.metricMonitorOptions?.thresholdUnit).toBeFalsy();

      return monitorStep;
    }

    function nodeCpuResponse(input: {
      monitorStep: MonitorStep;
      windowValue: number;
      nodes: Dictionary<number>;
    }): MetricMonitorResponse {
      return ungroupedResponse({
        monitorStep: input.monitorStep,
        fixture: PROXMOX,
        declaredUnits: { pve_cpu_usage_ratio: "1" },
        valuesByAlias: { node_cpu: [input.windowValue] },
        scans: [
          {
            alias: "node_cpu",
            metricUnit: "1",
            resources: Object.entries(input.nodes).map(
              ([resourceId, value]: [string, number]) => {
                return {
                  resourceId: resourceId,
                  resourceType: "node",
                  scope: "node",
                  metricValue: value,
                  lowestMetricValue: value,
                };
              },
            ),
          },
        ],
      });
    }

    test("a cluster at 50% CPU does not fire, and the recovery criteria holds", async () => {
      const monitorStep: MonitorStep = highCpuStep();
      const recovery: MonitorCriteriaInstance =
        monitorStep.data!.monitorCriteria!.data!
          .monitorCriteriaInstanceArray[1]!;

      const response: ProbeApiIngestResponse = await evaluate({
        monitorStep: monitorStep,
        fixture: PROXMOX,
        response: nodeCpuResponse({
          monitorStep: monitorStep,
          windowValue: 0.5,
          nodes: { "node/pve1": 0.5 },
        }),
      });

      expect(rootCauseFor(response, firingOf(monitorStep))).toBe("");
      expect(response.criteriaMetId?.toString()).toBe(
        recovery.data!.id!.toString(),
      );
    });

    test("only the node past 0.9 is listed", async () => {
      const monitorStep: MonitorStep = highCpuStep();

      const rootCause: string = await firingRootCause({
        monitorStep: monitorStep,
        fixture: PROXMOX,
        response: nodeCpuResponse({
          monitorStep: monitorStep,
          windowValue: 0.95,
          nodes: { "node/pve2": 0.5, "node/pve1": 0.95 },
        }),
      });

      const heads: Array<string> = entryHeads(
        listSection(rootCause, "Affected Resources"),
      );

      expect(heads).toHaveLength(1);
      expect(heads[0]).toContain("`node/pve1`");
      // The node at 50% is healthy under a "> 0.9" criteria.
      expect(rootCause).not.toContain("node/pve2");
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * 4. The raw scan is judged in the threshold's unit
 * ---------------------------------------------------------------------------
 */

describe("The raw scan is judged in the unit the threshold was written in", () => {
  test('ungrouped docker-swarm-task-down, "uptime < 1 min": the 30 s task is listed in seconds, the 50000 s one is not', async () => {
    const monitorStep: MonitorStep = ungroup(
      dockerSwarmStep("docker-swarm-task-down"),
    );
    const filter: CriteriaFilter = metricFiltersOf(firingOf(monitorStep))[0]!;

    expect(filter.filterType).toBe(FilterType.LessThan);
    filter.value = 1;
    filter.metricMonitorOptions = {
      ...filter.metricMonitorOptions!,
      thresholdUnit: "min",
    };

    const rootCause: string = await firingRootCause({
      monitorStep: monitorStep,
      fixture: DOCKER_SWARM,
      response: ungroupedResponse({
        monitorStep: monitorStep,
        fixture: DOCKER_SWARM,
        declaredUnits: { "container.uptime": "s" },
        // The youngest scrape in the window: 30 s, under a minute.
        valuesByAlias: { container_uptime: [30] },
        scans: [
          {
            alias: "container_uptime",
            metricUnit: "s",
            resources: [
              {
                containerName: "web.2.old",
                serviceName: "web",
                nodeName: "n1",
                metricValue: 50000,
                lowestMetricValue: 50000,
              },
              {
                containerName: "web.1.restarted",
                serviceName: "web",
                nodeName: "n1",
                metricValue: 30,
                lowestMetricValue: 30,
              },
            ],
          },
        ],
      }),
    });

    expect(listSection(rootCause, "Affected Tasks")).toBe(
      [
        "**Affected Tasks** (1 total)",
        "",
        "1. **Task** `web.1.restarted` — **30 sec**",
        "   - Service: `web`",
        "   - Node: `n1`",
      ].join("\n"),
    );
    expect(rootCause).not.toContain("web.2.old");
    expect(rootCause).toContain(metricLine(DOCKER_SWARM, "container.uptime"));
  });

  test('ungrouped pve-node-high-cpu, "> 90 %" over a 0–1 ratio: only the node at 0.95 is listed, as 95.00%', async () => {
    const monitorStep: MonitorStep = ungroup(proxmoxStep("pve-node-high-cpu"));
    const filter: CriteriaFilter = metricFiltersOf(firingOf(monitorStep))[0]!;

    expect(filter.filterType).toBe(FilterType.GreaterThan);
    filter.value = 90;
    filter.metricMonitorOptions = {
      ...filter.metricMonitorOptions!,
      thresholdUnit: "%",
    };

    const rootCause: string = await firingRootCause({
      monitorStep: monitorStep,
      fixture: PROXMOX,
      response: ungroupedResponse({
        monitorStep: monitorStep,
        fixture: PROXMOX,
        declaredUnits: { pve_cpu_usage_ratio: "1" },
        valuesByAlias: { node_cpu: [0.95, 0.95, 0.95, 0.95, 0.95] },
        scans: [
          {
            alias: "node_cpu",
            metricUnit: "1",
            resources: [
              {
                resourceId: "node/pve2",
                resourceType: "node",
                scope: "node",
                metricValue: 0.5,
                lowestMetricValue: 0.5,
              },
              {
                resourceId: "node/pve1",
                resourceType: "node",
                scope: "node",
                metricValue: 0.95,
                lowestMetricValue: 0.95,
              },
            ],
          },
        ],
      }),
    });

    expect(listSection(rootCause, "Affected Resources")).toBe(
      [
        "**Affected Resources** (1 total)",
        "",
        "1. **Node** `node/pve1` — **95.00%**",
      ].join("\n"),
    );
    // The node at 50% is healthy under a "> 90%" criteria.
    expect(rootCause).not.toContain("node/pve2");
    expect(rootCause).not.toContain("**0.95**");
  });
});

/*
 * ---------------------------------------------------------------------------
 * 5. Grouped by a key that names no platform object
 * ---------------------------------------------------------------------------
 */

describe("A monitor grouped by a key that names no platform object titles each series by its labels", () => {
  test("Kubernetes k8s.volume.available grouped by PVC name: one distinct **Series** row per claim", async () => {
    const args: CommonTemplateArgs = commonArgs(`${K8S_CLUSTER} - PVC space`);

    // What the monitor form builds: one query, grouped by the claim name.
    const monitorStep: MonitorStep = buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: K8S_CLUSTER,
        metricName: "k8s.volume.available",
        metricAlias: "vol_avail",
        resourceScope: KubernetesResourceScope.Cluster,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Min,
        groupByAttributeKeys: [PVC_KEY],
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias: "vol_avail",
        filterType: FilterType.LessThan,
        value: GB,
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias: "vol_avail",
        filterType: FilterType.GreaterThanOrEqualTo,
        value: GB,
      }),
    });

    /*
     * Each claim's datapoints also carry the pod that mounts it — which a
     * claim-level series must not be titled by.
     */
    const claim: (input: {
      name: string;
      namespace: string;
      pod: string;
      node: string;
      available: number;
    }) => RawSeries = (input: {
      name: string;
      namespace: string;
      pod: string;
      node: string;
      available: number;
    }): RawSeries => {
      return {
        attributes: {
          [K8S_CLUSTER_KEY]: K8S_CLUSTER,
          [PVC_KEY]: input.name,
          [NAMESPACE_KEY]: input.namespace,
          [POD_KEY]: input.pod,
          [NODE_KEY]: input.node,
        },
        valuesByAlias: {
          vol_avail: MINUTES.map((): number => {
            return input.available;
          }),
        },
      };
    };

    const rootCause: string = await firingRootCause({
      monitorStep: monitorStep,
      fixture: KUBERNETES,
      response: groupedResponse({
        monitorStep: monitorStep,
        fixture: KUBERNETES,
        declaredUnits: K8S_DECLARED_UNITS,
        series: [
          claim({
            name: "data-postgres-0",
            namespace: "db",
            pod: "postgres-0",
            node: "node-a",
            available: 0.5 * GB,
          }),
          claim({
            name: "data-redis-0",
            namespace: "cache",
            pod: "redis-0",
            node: "node-b",
            available: 0.3 * GB,
          }),
          claim({
            name: "data-kafka-0",
            namespace: "stream",
            pod: "kafka-0",
            node: "node-c",
            available: 40 * GB,
          }),
        ],
      }),
    });

    expect(listSection(rootCause, "Affected Resources")).toBe(
      [
        "**Affected Resources** (2 total)",
        "",
        "1. **Series** `k8s.persistentvolumeclaim.name=data-redis-0` — **300 MB**",
        "2. **Series** `k8s.persistentvolumeclaim.name=data-postgres-0` — **500 MB**",
      ].join("\n"),
    );

    expect(rootCause).not.toContain("**Cluster**");
    expect(rootCause).not.toContain("resource.k8s.persistentvolumeclaim.name=");
    expect(rootCause).not.toContain("data-kafka-0");
    // Never titled by the pod that happens to mount the claim.
    expect(rootCause).not.toContain("**Pod**");
    expect(rootCause).not.toMatch(RAW_NUMBER);
  });

  test("Proxmox pve-node-high-cpu grouped by the exporter instance: the list renders, one **Series** row per instance", async () => {
    const monitorStep: MonitorStep = proxmoxStep("pve-node-high-cpu");

    for (const queryConfig of viewConfigOf(monitorStep).queryConfigs) {
      queryConfig.metricQueryData.groupByAttributeKeys = ["instance"];
    }

    const exporter: (instance: string, ratio: number) => RawSeries = (
      instance: string,
      ratio: number,
    ): RawSeries => {
      return {
        /*
         * pve-exporter's datapoint names the node by `id`, but the series
         * is keyed by the scrape target only — so its labels name no
         * Proxmox object.
         */
        attributes: {
          instance: instance,
          "resource.proxmox.cluster.name": PVE_CLUSTER,
        },
        valuesByAlias: {
          node_cpu: MINUTES.map((): number => {
            return ratio;
          }),
        },
      };
    };

    const rootCause: string = await firingRootCause({
      monitorStep: monitorStep,
      fixture: PROXMOX,
      response: groupedResponse({
        monitorStep: monitorStep,
        fixture: PROXMOX,
        declaredUnits: { pve_cpu_usage_ratio: "1" },
        series: [
          exporter("10.0.0.11:9221", 0.93),
          exporter("10.0.0.12:9221", 0.2),
          exporter("10.0.0.13:9221", 0.97),
        ],
      }),
    });

    expect(listSection(rootCause, "Affected Resources")).toBe(
      [
        "**Affected Resources** (2 total)",
        "",
        "1. **Series** `instance=10.0.0.13:9221` — **97.00%**",
        "2. **Series** `instance=10.0.0.11:9221` — **93.00%**",
      ].join("\n"),
    );
    expect(rootCause).not.toContain("10.0.0.12");
    expect(rootCause).not.toContain("**Cluster**");
    expect(rootCause).not.toContain("**Metric Summary**");
  });

  test("Proxmox pve-guest-high-cpu grouped by guest type (pve.type): the list renders, one **Series** row per type", async () => {
    /*
     * "One alert per guest type": each series aggregates every VM (or
     * every container), so its only label is the type — a kind, not an
     * object. No row can be titled by a guest id, so each is titled by
     * its labels rather than the list being dropped.
     */
    const monitorStep: MonitorStep = proxmoxStep("pve-guest-high-cpu");

    for (const queryConfig of viewConfigOf(monitorStep).queryConfigs) {
      queryConfig.metricQueryData.groupByAttributeKeys = ["pve.type"];
    }

    const guest: (id: string, ratio: number) => RawSeries = (
      id: string,
      ratio: number,
    ): RawSeries => {
      return {
        attributes: {
          id: id,
          "pve.type": id.split("/")[0]!,
          "pve.scope": "guest",
          "pve.id": id.split("/")[1]!,
          "resource.proxmox.cluster.name": PVE_CLUSTER,
        },
        valuesByAlias: {
          guest_cpu: MINUTES.map((): number => {
            return ratio;
          }),
        },
      };
    };

    const rootCause: string = await firingRootCause({
      monitorStep: monitorStep,
      fixture: PROXMOX,
      response: groupedResponse({
        monitorStep: monitorStep,
        fixture: PROXMOX,
        declaredUnits: { pve_cpu_usage_ratio: "1" },
        series: [guest("qemu/100", 0.97), guest("lxc/101", 0.98)],
      }),
    });

    // Fixture guard: the criteria fired on both types.
    expect(rootCause).toContain("**Proxmox Cluster Details**");

    expect(listSection(rootCause, "Affected Resources")).toBe(
      [
        "**Affected Resources** (2 total)",
        "",
        "1. **Series** `pve.type=lxc` — **98.00%**",
        "2. **Series** `pve.type=qemu` — **97.00%**",
      ].join("\n"),
    );
    expect(rootCause).not.toContain("**Cluster**");
  });
});
