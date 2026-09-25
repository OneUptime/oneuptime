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
import { JSONObject } from "../../../../Types/JSON";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import { FilterType } from "../../../../Types/Monitor/CriteriaFilter";
import {
  buildKubernetesMonitorConfig,
  buildKubernetesMonitorStep,
  buildOfflineCriteriaInstance,
  buildOnlineCriteriaInstance,
  getKubernetesAlertTemplateById,
  KubernetesAlertTemplate,
  KubernetesAlertTemplateArgs,
} from "../../../../Types/Monitor/KubernetesAlertTemplates";
import { getKubernetesMetricByMetricName } from "../../../../Types/Monitor/KubernetesMetricCatalog";
import MetricCriteriaContext from "../../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import MetricMonitorResponse, {
  KubernetesAffectedResource,
  KubernetesResourceBreakdown,
} from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { KubernetesResourceScope } from "../../../../Types/Monitor/MonitorStepKubernetesMonitor";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import { buildUnhealthyCriteriaInstance } from "../../../../Types/Monitor/Recommendation/RecommendationCriteriaBuilder";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import PlatformMetricUnitUtil from "../../../../Utils/Monitor/PlatformMetricUnitUtil";
import PlatformResourceIdentity from "../../../../Utils/Monitor/PlatformResourceIdentity";
import { describe, expect, test } from "@jest/globals";

/*
 * The "Affected Resources" list of a GROUPED Kubernetes monitor is built
 * from the series the matched criteria actually breached, not from the
 * worker's raw datapoint scan. Before that, every ratio template listed
 * the scan of whichever query ran last — the DENOMINATOR, in raw bytes or
 * cores — and every resource in the cluster, breaching or not:
 *
 *   Affected Resources (4 total)
 *   1. Node `gke-...-1nd7` — 257760964608
 *
 * These tests drive every shipped grouped Kubernetes template through the
 * public evaluator entry point with the response shape the worker builds
 * (per-series query rows carrying the raw datapoint's attributes, formula
 * rows carrying only the group labels, one tagged raw scan per query, and
 * catalog-overlaid native units) and pin what the email says: which
 * resources are listed, how each is titled, what value — in which unit —
 * it carries, in which order, and what the analysis says about the worst
 * one.
 */

const CLUSTER: string = "prod-east";

const CLUSTER_KEY: string = "resource.k8s.cluster.name";
const NODE_KEY: string = "resource.k8s.node.name";
const NAMESPACE_KEY: string = "resource.k8s.namespace.name";
const POD_KEY: string = "resource.k8s.pod.name";
const CONTAINER_KEY: string = "resource.k8s.container.name";
const DEPLOYMENT_KEY: string = "resource.k8s.deployment.name";
const HPA_KEY: string = "resource.k8s.hpa.name";

const MINUTES: Array<Date> = [0, 1, 2, 3, 4].map((minute: number): Date => {
  return new Date(Date.UTC(2026, 8, 25, 10, minute, 0));
});

/*
 * The units the OpenTelemetry exporters declare for these metrics
 * (MetricType.unit). The worker overlays the Kubernetes catalog on top of
 * them — see PlatformMetricUnitUtil — and so do these tests, by calling
 * the same helper.
 */
const DECLARED_UNITS: Map<string, string> = new Map<string, string>([
  ["k8s.node.cpu.usage", "{cpu}"],
  ["k8s.node.allocatable_cpu", "{cpu}"],
  ["k8s.node.memory.usage", "By"],
  ["k8s.node.allocatable_memory", "By"],
  ["k8s.node.filesystem.usage", "By"],
  ["k8s.node.filesystem.available", "By"],
  ["k8s.container.cpu_request", "{cpu}"],
  ["k8s.container.memory_request", "By"],
  ["k8s.hpa.current_replicas", "{pod}"],
  ["k8s.hpa.max_replicas", "{pod}"],
  ["k8s.container.restarts", "{restart}"],
  ["k8s.pod.memory_limit_utilization", "1"],
  ["k8s.node.condition_ready", "1"],
]);

/*
 * ---------------------------------------------------------------------------
 * Monitor step helpers
 * ---------------------------------------------------------------------------
 */

function templateArgs(): KubernetesAlertTemplateArgs {
  return {
    clusterIdentifier: CLUSTER,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "prod-east - Kubernetes",
  };
}

function templateStep(templateId: string): MonitorStep {
  const template: KubernetesAlertTemplate | undefined =
    getKubernetesAlertTemplateById(templateId);

  if (!template) {
    throw new Error(`${templateId} template missing`);
  }

  return template.getMonitorStep(templateArgs());
}

function viewConfigOf(step: MonitorStep): MetricsViewConfig {
  const config: MetricsViewConfig | undefined =
    MonitorStep.getMetricsViewConfig(step);

  if (!config) {
    throw new Error("monitor step has no metric view config");
  }

  return config;
}

function metricNameOf(query: MetricQueryConfigData): string {
  return (query.metricQueryData?.filterData?.metricName as string) || "";
}

// [firing, recovery] — the order every Kubernetes template builds them in.
function criteriaOf(step: MonitorStep): {
  firing: MonitorCriteriaInstance;
  recovery: MonitorCriteriaInstance;
} {
  const instances: Array<MonitorCriteriaInstance> =
    step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];

  return { firing: instances[0]!, recovery: instances[1]! };
}

/*
 * A hand-built grouped Kubernetes monitor over one query: what a user gets
 * from the monitor form, rather than from a template card.
 */
function customGroupedStep(input: {
  metricName: string;
  metricAlias: string;
  aggregationType: MetricsAggregationType;
  groupByAttributeKeys: Array<string>;
  firing: MonitorCriteriaInstance;
}): MonitorStep {
  const args: KubernetesAlertTemplateArgs = templateArgs();

  return buildKubernetesMonitorStep({
    kubernetesMonitor: buildKubernetesMonitorConfig({
      clusterIdentifier: CLUSTER,
      metricName: input.metricName,
      metricAlias: input.metricAlias,
      resourceScope: KubernetesResourceScope.Node,
      rollingTime: RollingTime.Past5Minutes,
      aggregationType: input.aggregationType,
      groupByAttributeKeys: input.groupByAttributeKeys,
    }),
    offlineCriteriaInstance: input.firing,
    onlineCriteriaInstance: buildOnlineCriteriaInstance({
      onlineMonitorStatusId: args.onlineMonitorStatusId,
      metricAlias: input.metricAlias,
      filterType: FilterType.LessThanOrEqualTo,
      value: 1,
    }),
  });
}

/*
 * ---------------------------------------------------------------------------
 * Worker response helpers
 * ---------------------------------------------------------------------------
 */

/*
 * One series as the worker hands it over: its group-by labels, the
 * attributes every raw datapoint behind it carries on top of those, and a
 * value per minute for each query (and the formula, when there is one) —
 * already in each query's display unit.
 */
interface SeriesSpec {
  labels: JSONObject;
  datapointAttributes?: JSONObject | undefined;
  queryValues: Array<Array<number>>;
  formulaValues?: Array<number> | undefined;
}

function row(input: {
  timestamp: Date;
  value: number;
  attributes: JSONObject;
}): AggregateModel {
  return {
    timestamp: input.timestamp,
    value: input.value,
    attributes: input.attributes,
  } as unknown as AggregateModel;
}

function rawAttributesOf(spec: SeriesSpec): JSONObject {
  return {
    [CLUSTER_KEY]: CLUSTER,
    ...(spec.datapointAttributes || {}),
    ...spec.labels,
  };
}

function unitsByMetricNameOf(
  queries: Array<MetricQueryConfigData>,
): Dictionary<string> {
  return PlatformMetricUnitUtil.buildUnitsByMetricName({
    platform: "kubernetes",
    metricNames: queries.map(metricNameOf),
    declaredUnitsByMetricName: DECLARED_UNITS,
  });
}

function workerResponse(input: {
  step: MonitorStep;
  series: Array<SeriesSpec>;
}): MetricMonitorResponse {
  const config: MetricsViewConfig = viewConfigOf(input.step);
  const queries: Array<MetricQueryConfigData> = config.queryConfigs;
  const hasFormula: boolean = config.formulaConfigs.length > 0;

  /*
   * Aligned [queries..., formulas...]: query rows keep the raw datapoint's
   * full attribute map, formula rows only the group labels.
   */
  const seriesBreakdown: Array<MetricSeriesResult> = input.series.map(
    (spec: SeriesSpec, index: number): MetricSeriesResult => {
      const queryResults: Array<AggregatedResult> = queries.map(
        (_query: MetricQueryConfigData, queryIndex: number) => {
          return {
            data: (spec.queryValues[queryIndex] || []).map(
              (value: number, minute: number): AggregateModel => {
                return row({
                  timestamp: MINUTES[minute]!,
                  value: value,
                  attributes: rawAttributesOf(spec),
                });
              },
            ),
          };
        },
      );

      const formulaResults: Array<AggregatedResult> = hasFormula
        ? [
            {
              data: (spec.formulaValues || []).map(
                (value: number, minute: number): AggregateModel => {
                  return row({
                    timestamp: MINUTES[minute]!,
                    value: value,
                    attributes: { ...spec.labels },
                  });
                },
              ),
            },
          ]
        : [];

      return {
        fingerprint: `fp-${index}`,
        labels: spec.labels,
        aggregatedResults: [...queryResults, ...formulaResults],
      };
    },
  );

  const unitsByMetricName: Dictionary<string> = unitsByMetricNameOf(queries);

  /*
   * One raw scan per query, tagged with its alias, in the metric's NATIVE
   * unit (the scan never goes through the display-unit converter) — so a
   * list built from it would show bytes / cores / fractions.
   */
  const breakdowns: Array<KubernetesResourceBreakdown> = queries.map(
    (
      query: MetricQueryConfigData,
      queryIndex: number,
    ): KubernetesResourceBreakdown => {
      const metricName: string = metricNameOf(query);
      const toNative: (value: number) => number =
        query.metricAliasData?.legendUnit === "%"
          ? (value: number): number => {
              return value / 100;
            }
          : (value: number): number => {
              return value;
            };

      return {
        clusterName: CLUSTER,
        metricName: metricName,
        metricFriendlyName:
          getKubernetesMetricByMetricName(metricName)?.friendlyName ||
          metricName,
        metricAlias: query.metricAliasData?.metricVariable,
        metricUnit: unitsByMetricName[metricName.toLowerCase()],
        attributes: { [CLUSTER_KEY]: CLUSTER },
        affectedResources: input.series
          .filter((spec: SeriesSpec): boolean => {
            return (spec.queryValues[queryIndex] || []).length > 0;
          })
          .map((spec: SeriesSpec): KubernetesAffectedResource => {
            const values: Array<number> =
              spec.queryValues[queryIndex]!.map(toNative);

            return {
              ...PlatformResourceIdentity.kubernetes(rawAttributesOf(spec)),
              metricValue: Math.max(...values),
              lowestMetricValue: Math.min(...values),
            };
          }),
      };
    },
  );

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricResult: [],
    metricViewConfig: config,
    seriesBreakdown: seriesBreakdown,
    kubernetesResourceBreakdowns: breakdowns,
    nativeUnitsByMetricName: unitsByMetricName,
  };
}

type PercentOf = (numerator: number, denominator: number) => number;

const plainRatio: PercentOf = (numerator: number, denominator: number) => {
  return (numerator / denominator) * 100;
};

// k8s-high-disk-usage: used / (used + available) * 100, as `df` reports it.
const diskUsage: PercentOf = (used: number, available: number) => {
  return (used / (used + available)) * 100;
};

function perMinute(value: number | Array<number>): Array<number> {
  return Array.isArray(value)
    ? value
    : MINUTES.map((): number => {
        return value;
      });
}

/*
 * One series of a two-query ratio template, with the formula row the
 * worker computes from the two query rows.
 */
function ratioSeries(input: {
  labels: JSONObject;
  numerator: number | Array<number>;
  denominator: number | Array<number>;
  percentOf: PercentOf;
}): SeriesSpec {
  const numerator: Array<number> = perMinute(input.numerator);
  const denominator: Array<number> = perMinute(input.denominator);

  return {
    labels: input.labels,
    queryValues: [numerator, denominator],
    formulaValues: numerator.map((value: number, minute: number): number => {
      return input.percentOf(value, denominator[minute]!);
    }),
  };
}

function node(name: string): JSONObject {
  return { [NODE_KEY]: name };
}

/*
 * ---------------------------------------------------------------------------
 * Evaluation + rendered-markdown helpers
 * ---------------------------------------------------------------------------
 */

async function evaluate(input: {
  step: MonitorStep;
  response: MetricMonitorResponse;
}): Promise<ProbeApiIngestResponse> {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.monitorType = MonitorType.Kubernetes;
  monitor.name = "prod-east - Kubernetes";

  return MonitorCriteriaEvaluator.processMonitorStep({
    dataToProcess: input.response,
    monitorStep: input.step,
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

// The rendered root cause of one matched criteria, or "" when it did not match.
function rootCauseOf(
  response: ProbeApiIngestResponse,
  criteria: MonitorCriteriaInstance,
): string {
  const matched: MatchedCriteriaResult | undefined = (
    response.matchedCriteria || []
  ).find((result: MatchedCriteriaResult): boolean => {
    return result.criteriaId === criteria.data?.id?.toString();
  });

  return matched?.rootCause || "";
}

async function evaluateFiring(input: {
  step: MonitorStep;
  series: Array<SeriesSpec>;
}): Promise<string> {
  const response: ProbeApiIngestResponse = await evaluate({
    step: input.step,
    response: workerResponse(input),
  });

  return rootCauseOf(response, criteriaOf(input.step).firing);
}

// From the "Affected Resources" heading up to the analysis that follows it.
function affectedResourcesSection(rootCause: string): string {
  const start: number = rootCause.indexOf("**Affected Resources**");

  if (start < 0) {
    return "";
  }

  const end: number = rootCause.indexOf("**Root Cause Analysis**", start);

  return (
    end < 0 ? rootCause.substring(start) : rootCause.substring(start, end)
  ).trim();
}

const ENTRY_HEAD: RegExp = /^\d+\. /;

// The first line of every numbered entry in the list.
function entryHeads(section: string): Array<string> {
  return section.split("\n").filter((line: string): boolean => {
    return ENTRY_HEAD.test(line);
  });
}

/*
 * "Friendly (`metric`)", or just "`metric`" when the catalog has no
 * friendlier name — looked up rather than hard-coded, since the catalog
 * is still growing.
 */
function describedMetric(metricName: string): string {
  const friendlyName: string = (
    getKubernetesMetricByMetricName(metricName)?.friendlyName || ""
  ).trim();

  if (!friendlyName || friendlyName === metricName) {
    return `\`${metricName}\``;
  }

  return `${friendlyName} (\`${metricName}\`)`;
}

const PERCENT_ENTRY: RegExp = / — \*\*\d+\.\d{2}%\*\*$/;
const LONG_RAW_NUMBER: RegExp = /\b\d{10,}\b/;
const BOLD_BYTES: RegExp = /\*\*[\d.]+ (B|KB|MB|GB|TB|PB)\*\*/;

/*
 * ---------------------------------------------------------------------------
 * 1. Every ratio template
 * ---------------------------------------------------------------------------
 */

interface RatioTemplateCase {
  templateId: string;
  resourceNoun: string;
  legend: string;
  expression: string;
  series: Array<SeriesSpec>;
  // Each entry exactly as rendered: its head line, then its detail bullets.
  expectedEntries: Array<string>;
  notListed: Array<string>;
  analysis: Array<string>;
}

const RATIO_TEMPLATE_CASES: Array<RatioTemplateCase> = [
  {
    templateId: "k8s-high-cpu",
    resourceNoun: "nodes",
    legend: "Node CPU Utilization (%)",
    expression: "(used_cpu / alloc_cpu) * 100",
    series: [
      ratioSeries({
        labels: node("node-cpu-a"),
        numerator: [3.64, 3.68, 3.72, 3.76, 3.8],
        denominator: 4,
        percentOf: plainRatio,
      }),
      // One sample at 97.5%, the rest at 50%: not sustained, not affected.
      ratioSeries({
        labels: node("node-cpu-spiky"),
        numerator: [2, 2, 3.9, 2, 2],
        denominator: 4,
        percentOf: plainRatio,
      }),
      ratioSeries({
        labels: node("node-cpu-c"),
        numerator: 1.84,
        denominator: 2,
        percentOf: plainRatio,
      }),
      ratioSeries({
        labels: node("node-cpu-b"),
        numerator: [7.6, 7.68, 7.76, 7.84, 7.92],
        denominator: 8,
        percentOf: plainRatio,
      }),
      ratioSeries({
        labels: node("node-cpu-idle"),
        numerator: 1,
        denominator: 4,
        percentOf: plainRatio,
      }),
    ],
    expectedEntries: [
      "1. **Node** `node-cpu-b` — **99.00%**",
      "2. **Node** `node-cpu-a` — **95.00%**",
      "3. **Node** `node-cpu-c` — **92.00%**",
    ],
    notListed: ["node-cpu-spiky", "node-cpu-idle"],
    analysis: [
      "Node CPU utilization has exceeded the configured threshold.",
      "Node `node-cpu-b` is at **99.00%** CPU utilization.",
    ],
  },
  {
    templateId: "k8s-high-memory",
    resourceNoun: "nodes",
    legend: "Node Memory Utilization (%)",
    expression: "(used_mem / alloc_mem) * 100",
    series: [
      ratioSeries({
        labels: node("node-mem-a"),
        numerator: [
          13760000000, 14000000000, 14400000000, 14560000000, 14720000000,
        ],
        denominator: 16000000000,
        percentOf: plainRatio,
      }),
      ratioSeries({
        labels: node("node-mem-ok"),
        numerator: 16000000000,
        denominator: 32000000000,
        percentOf: plainRatio,
      }),
      ratioSeries({
        labels: node("node-mem-b"),
        numerator: 56000000000,
        denominator: 64000000000,
        percentOf: plainRatio,
      }),
    ],
    expectedEntries: [
      "1. **Node** `node-mem-a` — **92.00%**",
      "2. **Node** `node-mem-b` — **87.50%**",
    ],
    notListed: ["node-mem-ok"],
    analysis: [
      "Node memory utilization has exceeded the configured threshold.",
      "Node `node-mem-a` memory usage is at **92.00%**.",
    ],
  },
  {
    templateId: "k8s-high-disk-usage",
    resourceNoun: "nodes",
    legend: "Node Disk Usage (%)",
    expression: "(used_disk / (used_disk + avail_disk)) * 100",
    series: [
      ratioSeries({
        labels: node("node-disk-a"),
        numerator: [
          92000000000, 93000000000, 94000000000, 95000000000, 96000000000,
        ],
        denominator: [
          8000000000, 7000000000, 6000000000, 5000000000, 4000000000,
        ],
        percentOf: diskUsage,
      }),
      ratioSeries({
        labels: node("node-disk-ok"),
        numerator: 50000000000,
        denominator: 150000000000,
        percentOf: diskUsage,
      }),
      ratioSeries({
        labels: node("node-disk-b"),
        numerator: 182000000000,
        denominator: 18000000000,
        percentOf: diskUsage,
      }),
    ],
    expectedEntries: [
      "1. **Node** `node-disk-a` — **96.00%**",
      "2. **Node** `node-disk-b` — **91.00%**",
    ],
    notListed: ["node-disk-ok"],
    analysis: [
      "Node disk/filesystem usage has exceeded the configured threshold.",
      "Node `node-disk-a` filesystem usage is at **96.00%**.",
    ],
  },
  {
    templateId: "k8s-node-cpu-request-utilization",
    resourceNoun: "nodes",
    legend: "Node CPU Request Utilization (%)",
    expression: "(req_cpu / alloc_cpu) * 100",
    series: [
      ratioSeries({
        labels: node("node-req-a"),
        numerator: 7.44,
        denominator: 8,
        percentOf: plainRatio,
      }),
      ratioSeries({
        labels: node("node-req-ok"),
        numerator: 4,
        denominator: 8,
        percentOf: plainRatio,
      }),
      ratioSeries({
        labels: node("node-req-b"),
        numerator: [15.2, 15.36, 15.52, 15.68, 15.84],
        denominator: 16,
        percentOf: plainRatio,
      }),
    ],
    expectedEntries: [
      "1. **Node** `node-req-b` — **99.00%**",
      "2. **Node** `node-req-a` — **93.00%**",
    ],
    notListed: ["node-req-ok"],
    analysis: [
      "Node CPU Request Utilization (%) (`(req_cpu / alloc_cpu) * 100`) has breached the configured threshold.",
      "Most affected node: `node-req-b` (**99.00%**)",
    ],
  },
  {
    templateId: "k8s-node-memory-request-utilization",
    resourceNoun: "nodes",
    legend: "Node Memory Request Utilization (%)",
    expression: "(req_mem / alloc_mem) * 100",
    series: [
      ratioSeries({
        labels: node("node-mreq-b"),
        numerator: 58240000000,
        denominator: 64000000000,
        percentOf: plainRatio,
      }),
      ratioSeries({
        labels: node("node-mreq-ok"),
        numerator: 16000000000,
        denominator: 32000000000,
        percentOf: plainRatio,
      }),
      ratioSeries({
        labels: node("node-mreq-a"),
        numerator: 30400000000,
        denominator: 32000000000,
        percentOf: plainRatio,
      }),
    ],
    expectedEntries: [
      "1. **Node** `node-mreq-a` — **95.00%**",
      "2. **Node** `node-mreq-b` — **91.00%**",
    ],
    notListed: ["node-mreq-ok"],
    analysis: [
      "Node Memory Request Utilization (%) (`(req_mem / alloc_mem) * 100`) has breached the configured threshold.",
      "Most affected node: `node-mreq-a` (**95.00%**)",
    ],
  },
  {
    templateId: "k8s-hpa-at-max-replicas",
    resourceNoun: "HPAs",
    legend: "HPA Replica Saturation (%)",
    expression: "(current_replicas / max_replicas) * 100",
    series: [
      ratioSeries({
        labels: { [NAMESPACE_KEY]: "search", [HPA_KEY]: "search-api" },
        numerator: 9,
        denominator: 10,
        percentOf: plainRatio,
      }),
      ratioSeries({
        labels: { [NAMESPACE_KEY]: "batch", [HPA_KEY]: "worker" },
        numerator: 5,
        denominator: 20,
        percentOf: plainRatio,
      }),
      ratioSeries({
        labels: { [NAMESPACE_KEY]: "checkout", [HPA_KEY]: "checkout-api" },
        numerator: 10,
        denominator: 10,
        percentOf: plainRatio,
      }),
      // At the ceiling for one sample only.
      ratioSeries({
        labels: { [NAMESPACE_KEY]: "reports", [HPA_KEY]: "reports-api" },
        numerator: [5, 5, 20, 5, 5],
        denominator: 20,
        percentOf: plainRatio,
      }),
      ratioSeries({
        labels: { [NAMESPACE_KEY]: "orders", [HPA_KEY]: "orders-api" },
        numerator: 19,
        denominator: 20,
        percentOf: plainRatio,
      }),
    ],
    expectedEntries: [
      "1. **HorizontalPodAutoscaler** `checkout-api` — **100.00%**\n   - Namespace: `checkout`",
      "2. **HorizontalPodAutoscaler** `orders-api` — **95.00%**\n   - Namespace: `orders`",
      "3. **HorizontalPodAutoscaler** `search-api` — **90.00%**\n   - Namespace: `search`",
    ],
    notListed: ["`worker`", "reports-api"],
    analysis: [
      "HPA Replica Saturation (%) (`(current_replicas / max_replicas) * 100`) has breached the configured threshold.",
      "Most affected HorizontalPodAutoscaler: `checkout-api` (**100.00%**)",
    ],
  },
];

for (const testCase of RATIO_TEMPLATE_CASES) {
  describe(`Kubernetes grouped ratio template ${testCase.templateId}`, () => {
    const run: () => Promise<{
      step: MonitorStep;
      rootCause: string;
    }> = async (): Promise<{ step: MonitorStep; rootCause: string }> => {
      const step: MonitorStep = templateStep(testCase.templateId);

      return {
        step: step,
        rootCause: await evaluateFiring({
          step: step,
          series: testCase.series,
        }),
      };
    };

    test(`lists only the breaching ${testCase.resourceNoun}, worst first, valued in %`, async () => {
      const { rootCause } = await run();
      const section: string = affectedResourcesSection(rootCause);

      expect(section).toContain(
        `**Affected Resources** (${testCase.expectedEntries.length} total)`,
      );

      expect(entryHeads(section)).toEqual(
        testCase.expectedEntries.map((entry: string): string => {
          return entry.split("\n")[0]!;
        }),
      );

      for (const entry of testCase.expectedEntries) {
        expect(section).toContain(entry);
      }

      for (const head of entryHeads(section)) {
        expect(head).toMatch(PERCENT_ENTRY);
      }

      for (const name of testCase.notListed) {
        expect(section).not.toContain(name);
      }

      // No raw operand anywhere — bytes, cores, replica counts.
      expect(rootCause).not.toMatch(LONG_RAW_NUMBER);
      expect(rootCause).not.toMatch(BOLD_BYTES);
      expect(rootCause).not.toContain(" cores**");
      expect(section).not.toContain("overflow");
      expect(section).not.toContain("more affected resources");
    });

    test("names the formula, its expression and the metric behind each operand", async () => {
      const { step, rootCause } = await run();
      const queries: Array<MetricQueryConfigData> =
        viewConfigOf(step).queryConfigs;

      const componentLines: Array<string> = queries.map(
        (query: MetricQueryConfigData): string => {
          return `  - \`${query.metricAliasData?.metricVariable}\` = ${describedMetric(metricNameOf(query))}`;
        },
      );

      expect(rootCause).toContain(
        [
          "**Kubernetes Cluster Details**",
          `- Cluster: ${CLUSTER}`,
          `- Metric: ${testCase.legend}`,
          `- Formula: \`${testCase.expression}\``,
          ...componentLines,
        ].join("\n"),
      );

      // The numerator or denominator is never presented as THE metric.
      for (const query of queries) {
        expect(rootCause).not.toContain(
          `- Metric: ${describedMetric(metricNameOf(query))}`,
        );
      }
    });

    test("the analysis names the worst resource at its percentage", async () => {
      const { rootCause } = await run();

      expect(rootCause).toContain("**Root Cause Analysis**");

      for (const line of testCase.analysis) {
        expect(rootCause).toContain(line);
      }

      // Never the generic "Kubernetes metric `k8s....`" line for a formula.
      expect(rootCause).not.toContain("Kubernetes metric `");
    });
  });
}

/*
 * ---------------------------------------------------------------------------
 * 2. Grouped single-query templates
 * ---------------------------------------------------------------------------
 */

describe("Kubernetes grouped template k8s-crashloopbackoff", () => {
  const series: Array<SeriesSpec> = [
    {
      labels: {
        [NAMESPACE_KEY]: "search",
        [POD_KEY]: "search-5c4b-abc",
        [CONTAINER_KEY]: "indexer",
      },
      datapointAttributes: {
        [DEPLOYMENT_KEY]: "search",
        [NODE_KEY]: "gke-node-2",
      },
      queryValues: [[6, 6, 6, 6, 6]],
    },
    {
      labels: {
        [NAMESPACE_KEY]: "payments",
        [POD_KEY]: "checkout-7d9f-2xk",
        [CONTAINER_KEY]: "api",
      },
      datapointAttributes: {
        [DEPLOYMENT_KEY]: "checkout",
        [NODE_KEY]: "gke-node-1",
      },
      queryValues: [[6, 6, 7, 7, 7]],
    },
    {
      labels: {
        [NAMESPACE_KEY]: "payments",
        [POD_KEY]: "ledger-66f8-q9z",
        [CONTAINER_KEY]: "ledger",
      },
      datapointAttributes: {
        [DEPLOYMENT_KEY]: "ledger",
        [NODE_KEY]: "gke-node-3",
      },
      queryValues: [[0, 0, 0, 0, 0]],
    },
  ];

  test("titles each container with its pod and borrows namespace, deployment and node from the datapoint", async () => {
    const rootCause: string = await evaluateFiring({
      step: templateStep("k8s-crashloopbackoff"),
      series: series,
    });
    const section: string = affectedResourcesSection(rootCause);

    expect(section).toContain("**Affected Resources** (2 total)");
    expect(entryHeads(section)).toEqual([
      "1. **Container** `api` in pod `checkout-7d9f-2xk` — **7**",
      "2. **Container** `indexer` in pod `search-5c4b-abc` — **6**",
    ]);
    expect(section).toContain(
      [
        "1. **Container** `api` in pod `checkout-7d9f-2xk` — **7**",
        "   - Namespace: `payments`",
        "   - Deployment: `checkout`",
        "   - Node: `gke-node-1`",
      ].join("\n"),
    );
    expect(section).toContain(
      [
        "2. **Container** `indexer` in pod `search-5c4b-abc` — **6**",
        "   - Namespace: `search`",
        "   - Deployment: `search`",
        "   - Node: `gke-node-2`",
      ].join("\n"),
    );

    // The healthy container is not "affected".
    expect(section).not.toContain("ledger");
  });

  test("names the metric and says how many times the worst container restarted", async () => {
    const rootCause: string = await evaluateFiring({
      step: templateStep("k8s-crashloopbackoff"),
      series: series,
    });

    expect(rootCause).toContain(
      `- Metric: ${describedMetric("k8s.container.restarts")}`,
    );
    expect(rootCause).not.toContain("- Formula:");
    expect(rootCause).toContain(
      "The container `api` in pod `checkout-7d9f-2xk` has restarted **7** times.",
    );
    expect(rootCause).not.toMatch(LONG_RAW_NUMBER);
  });
});

describe("Kubernetes grouped template k8s-pod-memory-limit-saturation", () => {
  /*
   * The query declares legendUnit "%", so the worker has already converted
   * kubeletstats' 0–1 fraction to 0–100 before the evaluator sees it.
   */
  const series: Array<SeriesSpec> = [
    {
      labels: { [NAMESPACE_KEY]: "payments", [POD_KEY]: "checkout-7d9f-2xk" },
      datapointAttributes: {
        [DEPLOYMENT_KEY]: "checkout",
        [NODE_KEY]: "gke-node-1",
      },
      queryValues: [[91, 92, 93, 92.5, 91.5]],
    },
    {
      labels: { [NAMESPACE_KEY]: "batch", [POD_KEY]: "worker-0" },
      datapointAttributes: { [NODE_KEY]: "gke-node-3" },
      queryValues: [[40, 41, 42, 43, 44]],
    },
    {
      labels: { [NAMESPACE_KEY]: "search", [POD_KEY]: "search-5c4b-abc" },
      datapointAttributes: {
        [DEPLOYMENT_KEY]: "search",
        [NODE_KEY]: "gke-node-2",
      },
      queryValues: [[95.5, 95.5, 95.5, 95.5, 95.5]],
    },
  ];

  test("lists the saturated pods in % with their namespace, workload and node", async () => {
    const rootCause: string = await evaluateFiring({
      step: templateStep("k8s-pod-memory-limit-saturation"),
      series: series,
    });
    const section: string = affectedResourcesSection(rootCause);

    expect(section).toContain("**Affected Resources** (2 total)");
    expect(entryHeads(section)).toEqual([
      "1. **Pod** `search-5c4b-abc` — **95.50%**",
      "2. **Pod** `checkout-7d9f-2xk` — **93.00%**",
    ]);
    expect(section).toContain(
      [
        "2. **Pod** `checkout-7d9f-2xk` — **93.00%**",
        "   - Namespace: `payments`",
        "   - Deployment: `checkout`",
        "   - Node: `gke-node-1`",
      ].join("\n"),
    );
    expect(section).not.toContain("worker-0");

    // Never re-scaled as a fraction ("9300.00%") nor shown as one ("0.93").
    expect(rootCause).not.toMatch(/\d{4,}\.\d{2}%/);
    expect(section).not.toContain("**0.9");
  });

  test("the analysis names the worst pod at its saturation", async () => {
    const rootCause: string = await evaluateFiring({
      step: templateStep("k8s-pod-memory-limit-saturation"),
      series: series,
    });

    expect(rootCause).toContain(
      `- Metric: ${describedMetric("k8s.pod.memory_limit_utilization")}`,
    );
    expect(rootCause).toContain(
      "Most affected pod: `search-5c4b-abc` (**95.50%**)",
    );
    // Pod-scoped: never answered with the node CPU / memory sentences.
    expect(rootCause).not.toContain("Node memory utilization");
    expect(rootCause).not.toContain("CPU utilization.");
  });
});

describe("Kubernetes grouped template k8s-node-not-ready", () => {
  const series: Array<SeriesSpec> = [
    { labels: node("node-up"), queryValues: [[1, 1, 1, 1, 1]] },
    { labels: node("node-down"), queryValues: [[0, 0, 0, 0, 0]] },
  ];

  test("lists only the NotReady node, at 0", async () => {
    const rootCause: string = await evaluateFiring({
      step: templateStep("k8s-node-not-ready"),
      series: series,
    });
    const section: string = affectedResourcesSection(rootCause);

    expect(section).toBe(
      "**Affected Resources** (1 total)\n\n1. **Node** `node-down` — **0**",
    );
    expect(rootCause).not.toContain("node-up");
  });

  test("the analysis names the NotReady node, not its Ready peer", async () => {
    const rootCause: string = await evaluateFiring({
      step: templateStep("k8s-node-not-ready"),
      series: series,
    });

    expect(rootCause).toContain(
      `- Metric: ${describedMetric("k8s.node.condition_ready")}`,
    );
    expect(rootCause).toContain(
      "Node `node-down` is reporting NotReady (value: 0).",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * 3. Enrichment safety
 * ---------------------------------------------------------------------------
 */

describe("Kubernetes grouped monitor: a node-level sum of container rows", () => {
  /*
   * Container CPU requests summed per NODE. Each raw datapoint behind the
   * sum belongs to some tenant's container, so the breaching sample's
   * attributes name a pod, container, namespace and deployment that are
   * not the node's — borrowing them would title the node with an
   * arbitrary tenant.
   */
  function step(): MonitorStep {
    const args: KubernetesAlertTemplateArgs = templateArgs();

    return customGroupedStep({
      metricName: "k8s.container.cpu_request",
      metricAlias: "node_cpu_requests",
      aggregationType: MetricsAggregationType.Sum,
      groupByAttributeKeys: [NODE_KEY],
      firing: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias: "node_cpu_requests",
        filterType: FilterType.GreaterThan,
        value: 3,
      }),
    });
  }

  const series: Array<SeriesSpec> = [
    {
      labels: node("gke-node-7"),
      datapointAttributes: {
        [NAMESPACE_KEY]: "tenant-a",
        [POD_KEY]: "tenant-a-api-0",
        [CONTAINER_KEY]: "api",
        [DEPLOYMENT_KEY]: "tenant-a-api",
      },
      queryValues: [[3.5, 3.6, 3.7, 3.8, 3.9]],
    },
    {
      labels: node("gke-node-8"),
      datapointAttributes: {
        [NAMESPACE_KEY]: "tenant-b",
        [POD_KEY]: "tenant-b-web-0",
        [CONTAINER_KEY]: "web",
      },
      queryValues: [[1, 1, 1, 1, 1]],
    },
  ];

  test("titles the entry as the node and borrows nothing from the tenant datapoint", async () => {
    const rootCause: string = await evaluateFiring({
      step: step(),
      series: series,
    });
    const section: string = affectedResourcesSection(rootCause);

    expect(section).toBe(
      "**Affected Resources** (1 total)\n\n1. **Node** `gke-node-7` — **3.9 cores**",
    );

    expect(rootCause).not.toContain("Namespace:");
    expect(rootCause).not.toContain("Deployment:");
    expect(rootCause).not.toContain("tenant-a");
    expect(rootCause).not.toContain("**Container**");
    expect(rootCause).not.toContain("**Pod**");
  });

  test("the analysis names the node, not a tenant pod", async () => {
    const rootCause: string = await evaluateFiring({
      step: step(),
      series: series,
    });

    expect(rootCause).toContain(
      `- Metric: ${describedMetric("k8s.container.cpu_request")}`,
    );
    expect(rootCause).toContain(
      "Most affected node: `gke-node-7` (**3.9 cores**)",
    );
    expect(rootCause).not.toContain("Most affected pod");
  });
});

/*
 * ---------------------------------------------------------------------------
 * 4. More breaching series than the list shows
 * ---------------------------------------------------------------------------
 */

describe("Kubernetes grouped monitor: more than ten breaching series", () => {
  // 86% .. 97%, in scrambled order, plus one healthy node.
  const percents: Array<number> = [
    90, 86, 97, 88, 93, 91, 87, 95, 89, 96, 92, 94,
  ];
  const allocatable: number = 16000000000;

  const series: Array<SeriesSpec> = [
    ...percents.map((percent: number): SeriesSpec => {
      return ratioSeries({
        labels: node(`node-${percent}`),
        numerator: (allocatable * percent) / 100,
        denominator: allocatable,
        percentOf: plainRatio,
      });
    }),
    ratioSeries({
      labels: node("node-healthy"),
      numerator: allocatable / 2,
      denominator: allocatable,
      percentOf: plainRatio,
    }),
  ];

  test("shows the ten worst, counts all twelve, and summarises the rest", async () => {
    const rootCause: string = await evaluateFiring({
      step: templateStep("k8s-high-memory"),
      series: series,
    });
    const section: string = affectedResourcesSection(rootCause);

    expect(section).toContain("**Affected Resources** (12 total)");

    const expectedHeads: Array<string> = [
      97, 96, 95, 94, 93, 92, 91, 90, 89, 88,
    ].map((percent: number, index: number): string => {
      return `${index + 1}. **Node** \`node-${percent}\` — **${percent}.00%**`;
    });

    expect(entryHeads(section)).toEqual(expectedHeads);
    expect(section).toContain("*... and 2 more affected resources*");

    // The two least-bad breaching nodes are counted but not shown.
    expect(section).not.toContain("`node-87`");
    expect(section).not.toContain("`node-86`");
    expect(section).not.toContain("node-healthy");
    expect(rootCause).not.toMatch(LONG_RAW_NUMBER);

    // The analysis still names the worst node.
    expect(rootCause).toContain(
      "Node `node-97` memory usage is at **97.00%**.",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * 5. A series that matched with no data
 * ---------------------------------------------------------------------------
 */

type EvaluatorPrivate = {
  buildKubernetesRootCauseContext: (input: {
    dataToProcess: unknown;
    monitorStep: MonitorStep;
    monitor: Monitor;
    criteriaInstance?: MonitorCriteriaInstance | undefined;
    perSeriesMatches?: Array<PerSeriesCriteriaMatch> | undefined;
  }) => Promise<string | null>;
};

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

describe("Kubernetes grouped monitor: a series that matched with no data", () => {
  function kubernetesMonitor(): Monitor {
    const monitor: Monitor = new Monitor();
    monitor._id = ObjectID.generate().toString();
    monitor.monitorType = MonitorType.Kubernetes;
    monitor.name = "prod-east - Kubernetes";
    return monitor;
  }

  function formulaContext(
    breachingValues: Array<number>,
  ): MetricCriteriaContext {
    return {
      metricName: "(used_mem / alloc_mem) * 100",
      alias: "node_memory_utilization",
      displayName: "Node Memory Utilization (%)",
      unit: "%",
      aggregationType: null,
      isFormula: true,
      formulaExpression: "(used_mem / alloc_mem) * 100",
      filterAttributes: {},
      groupBy: [],
      ...(breachingValues.length > 0
        ? {
            breachingSamples: breachingValues.map(
              (value: number, minute: number) => {
                return {
                  value: value,
                  timestamp: MINUTES[minute]!,
                  attributes: { attributes: {} },
                };
              },
            ),
            sampleValueRange: {
              min: Math.min(...breachingValues),
              max: Math.max(...breachingValues),
            },
          }
        : {}),
    };
  }

  function match(input: {
    nodeName: string;
    criteriaId: string;
    breachingValues: Array<number>;
  }): PerSeriesCriteriaMatch {
    return {
      criteriaMetId: input.criteriaId,
      fingerprint: `fp-${input.nodeName}`,
      labels: node(input.nodeName),
      rootCause: "- matched",
      metricContext: formulaContext(input.breachingValues),
    };
  }

  test("renders **no data** for the silent series and sorts it last", async () => {
    const step: MonitorStep = templateStep("k8s-high-memory");
    const firing: MonitorCriteriaInstance = criteriaOf(step).firing;
    const criteriaId: string = firing.data!.id!.toString();

    const context: string | null =
      await Evaluator.buildKubernetesRootCauseContext({
        dataToProcess: workerResponse({ step: step, series: [] }),
        monitorStep: step,
        monitor: kubernetesMonitor(),
        criteriaInstance: firing,
        perSeriesMatches: [
          match({ nodeName: "node-silent", criteriaId, breachingValues: [] }),
          match({
            nodeName: "node-warm",
            criteriaId,
            breachingValues: [86.1, 85.5],
          }),
          match({
            nodeName: "node-hot",
            criteriaId,
            breachingValues: [88.5, 91.25, 90],
          }),
        ],
      });

    const section: string = affectedResourcesSection(context || "");

    expect(section).toContain("**Affected Resources** (3 total)");
    expect(entryHeads(section)).toEqual([
      "1. **Node** `node-hot` — **91.25%**",
      "2. **Node** `node-warm` — **86.10%**",
      "3. **Node** `node-silent` — **no data**",
    ]);
  });

  test("end to end: a NoDataPolicy-trigger criteria lists the silent node after the breaching one", async () => {
    const args: KubernetesAlertTemplateArgs = templateArgs();

    const firing: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance({
      offlineMonitorStatusId: args.offlineMonitorStatusId,
      incidentSeverityId: args.defaultIncidentSeverityId,
      alertSeverityId: args.defaultAlertSeverityId,
      monitorName: args.monitorName,
      metricAlias: "node_memory",
      filterType: FilterType.GreaterThan,
      value: 12000000000,
      triggerOnNoData: true,
    });

    const step: MonitorStep = customGroupedStep({
      metricName: "k8s.node.memory.usage",
      metricAlias: "node_memory",
      aggregationType: MetricsAggregationType.Avg,
      groupByAttributeKeys: [NODE_KEY],
      firing: firing,
    });

    const rootCause: string = await evaluateFiring({
      step: step,
      series: [
        { labels: node("node-silent"), queryValues: [[]] },
        {
          labels: node("node-full"),
          queryValues: [
            [12500000000, 12600000000, 12800000000, 12900000000, 13000000000],
          ],
        },
        {
          labels: node("node-fine"),
          queryValues: [
            [4000000000, 4000000000, 4000000000, 4000000000, 4000000000],
          ],
        },
      ],
    });
    const section: string = affectedResourcesSection(rootCause);

    expect(section).toBe(
      [
        "**Affected Resources** (2 total)",
        "",
        "1. **Node** `node-full` — **13 GB**",
        "2. **Node** `node-silent` — **no data**",
      ].join("\n"),
    );
    expect(rootCause).not.toMatch(LONG_RAW_NUMBER);
  });
});

/*
 * ---------------------------------------------------------------------------
 * 6. The recovery criteria, evaluated on the same data
 * ---------------------------------------------------------------------------
 */

describe("Kubernetes grouped ratio template k8s-high-memory: recovery criteria", () => {
  const series: Array<SeriesSpec> = [
    ratioSeries({
      labels: node("node-mem-hot"),
      numerator: 14720000000,
      denominator: 16000000000,
      percentOf: plainRatio,
    }),
    ratioSeries({
      labels: node("node-mem-ok"),
      numerator: 16000000000,
      denominator: 32000000000,
      percentOf: plainRatio,
    }),
    ratioSeries({
      labels: node("node-mem-low"),
      numerator: 16000000000,
      denominator: 64000000000,
      percentOf: plainRatio,
    }),
  ];

  test("whatever the recovery list shows is valued in % — never bytes", async () => {
    const step: MonitorStep = templateStep("k8s-high-memory");
    const { firing, recovery } = criteriaOf(step);

    const response: ProbeApiIngestResponse = await evaluate({
      step: step,
      response: workerResponse({ step: step, series: series }),
    });

    // Both bands fire on a grouped monitor: the hot node, and the two healthy ones.
    expect(rootCauseOf(response, firing)).toContain(
      "1. **Node** `node-mem-hot` — **92.00%**",
    );

    const recoveryRootCause: string = rootCauseOf(response, recovery);
    const section: string = affectedResourcesSection(recoveryRootCause);

    expect(recoveryRootCause).not.toBe("");
    expect(section).toContain("**Affected Resources** (2 total)");
    expect(section).toContain("**Node** `node-mem-ok` — **50.00%**");
    expect(section).toContain("**Node** `node-mem-low` — **25.00%**");
    expect(section).not.toContain("node-mem-hot");

    expect(entryHeads(section)).toHaveLength(2);
    for (const head of entryHeads(section)) {
      expect(head).toMatch(PERCENT_ENTRY);
    }

    expect(recoveryRootCause).not.toMatch(LONG_RAW_NUMBER);
    expect(recoveryRootCause).not.toMatch(BOLD_BYTES);
    expect(recoveryRootCause).not.toMatch(/memory usage is at \*\*[\d.]+ GB/);
    expect(recoveryRootCause).toContain(
      "- Metric: Node Memory Utilization (%)",
    );
  });
});
