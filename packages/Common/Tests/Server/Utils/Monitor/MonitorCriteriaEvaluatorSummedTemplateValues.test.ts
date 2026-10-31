/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox and the
 * prebuilt binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MetricMonitorCriteria from "../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import CompareCriteria from "../../../../Server/Utils/Monitor/Criteria/CompareCriteria";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import { JSONObject } from "../../../../Types/JSON";
import MetricFormulaConfigData from "../../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import { getDockerAlertTemplateById } from "../../../../Types/Monitor/DockerAlertTemplates";
import {
  buildKubernetesMonitorConfig,
  buildKubernetesMonitorStep,
  buildOfflineCriteriaInstance,
  buildOnlineCriteriaInstance,
  getKubernetesAlertTemplateById,
} from "../../../../Types/Monitor/KubernetesAlertTemplates";
import { getKubernetesMetricByMetricName } from "../../../../Types/Monitor/KubernetesMetricCatalog";
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
import { getPodmanAlertTemplateById } from "../../../../Types/Monitor/PodmanAlertTemplates";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import MetricFormulaEvaluator from "../../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import PlatformResourceIdentity from "../../../../Utils/Monitor/PlatformResourceIdentity";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * A summed template judges a series on its window's TOTAL: Container
 * Restart Loop (Docker, Podman) fires on more than 3 restarts in 15
 * minutes, CrashLoopBackOff Detection on any restart in them, Job Failures
 * on any failed pod, CPU Throttling on more than a second throttled. Each
 * is a Sum over the window of one value a minute (the restarts or failures
 * the agent sent in that minute, the throttled time's growth within it).
 *
 * What an alert SHOWED for the series was something else: its worst single
 * minute. A Kubernetes alert's Affected Resources row and the analysis
 * under it ("has restarted **1** times") took the series' highest
 * breaching sample - a crash loop with a restart in each of four minutes
 * read 1 - and a Docker or Podman alert's Breaching Samples said "1 of 15
 * samples breached the threshold" and listed the one minute with 5 of the
 * window's 8 restarts, or said nothing at all when no minute alone passed
 * 3. The criteria line above both said the sum was 8.
 *
 * Now the criteria keeps the value it judged (MetricCriteriaContext
 * .windowAggregate, reduced exactly as the comparison reduces it), and
 * what the alert shows for the series is that value: the row, the analysis
 * and the Breaching Samples summary, whose list is then the samples that
 * added to the total. What fires does not change: every case below also
 * holds the matched series to the comparison on the window's total.
 *
 * Driven through the public evaluator entry point with the response shape
 * the worker builds: per-series query rows (and formula rows) per minute,
 * and, for Kubernetes, one raw scan per query.
 */

const T0: number = Date.UTC(2026, 9, 31, 11, 45, 0, 0);
const MINUTES_IN_WINDOW: number = 15;

const CLUSTER: string = "prod-east";
const CLUSTER_KEY: string = "resource.k8s.cluster.name";
const NAMESPACE_KEY: string = "resource.k8s.namespace.name";
const POD_KEY: string = "resource.k8s.pod.name";
const CONTAINER_KEY: string = "resource.k8s.container.name";
const JOB_KEY: string = "resource.k8s.job.name";
const DOCKER_CONTAINER_KEY: string = "resource.container.name";

function templateArgs(): {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} {
  return {
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Summed template",
  };
}

function kubernetesStep(templateId: string): MonitorStep {
  return getKubernetesAlertTemplateById(templateId)!.getMonitorStep({
    ...templateArgs(),
    clusterIdentifier: CLUSTER,
  });
}

function dockerStep(templateId: string): MonitorStep {
  return getDockerAlertTemplateById(templateId)!.getMonitorStep({
    ...templateArgs(),
    hostIdentifier: "docker-01",
  });
}

function podmanStep(templateId: string): MonitorStep {
  return getPodmanAlertTemplateById(templateId)!.getMonitorStep({
    ...templateArgs(),
    hostIdentifier: "podman-01",
  });
}

function viewConfigOf(step: MonitorStep): MetricsViewConfig {
  return MonitorStep.getMetricsViewConfig(step)!;
}

function metricNameOf(query: MetricQueryConfigData): string {
  return (query.metricQueryData?.filterData?.metricName as string) || "";
}

// [firing, recovery] - the order every template here builds them in.
function firingCriteriaOf(step: MonitorStep): MonitorCriteriaInstance {
  return step.data!.monitorCriteria!.data!.monitorCriteriaInstanceArray[0]!;
}

/*
 * One series as the worker hands it over: its group-by labels, the
 * attributes every raw datapoint behind it carries on top of those, and a
 * value per minute for each query, in the step's query order.
 */
interface SeriesSpec {
  labels: JSONObject;
  datapointAttributes?: JSONObject | undefined;
  queryValues: Array<Array<number>>;
}

function rows(values: Array<number>, attributes: JSONObject): AggregatedResult {
  return {
    data: values.map((value: number, minute: number): AggregateModel => {
      return {
        timestamp: new Date(T0 + minute * 60_000),
        value: value,
        attributes: attributes,
      } as unknown as AggregateModel;
    }),
  };
}

function rawAttributesOf(spec: SeriesSpec, cluster: boolean): JSONObject {
  return {
    ...(cluster ? { [CLUSTER_KEY]: CLUSTER } : {}),
    ...(spec.datapointAttributes || {}),
    ...spec.labels,
  };
}

/*
 * The query rows, then each formula's rows, as the worker appends them:
 * query rows carry the raw datapoint's attributes, formula rows the
 * formula evaluator's.
 */
function seriesResults(input: {
  config: MetricsViewConfig;
  spec: SeriesSpec;
  cluster: boolean;
}): Array<AggregatedResult> {
  const queryResults: Array<AggregatedResult> = input.config.queryConfigs.map(
    (_query: MetricQueryConfigData, index: number): AggregatedResult => {
      return rows(
        input.spec.queryValues[index] || [],
        rawAttributesOf(input.spec, input.cluster),
      );
    },
  );
  const formulaResults: Array<AggregatedResult> = (
    input.config.formulaConfigs || []
  ).map((formula: MetricFormulaConfigData): AggregatedResult => {
    return MetricFormulaEvaluator.evaluateFormula({
      formula: formula.metricFormulaData.metricFormula,
      queryConfigs: input.config.queryConfigs,
      formulaConfigs: [],
      results: queryResults,
    });
  });

  return [...queryResults, ...formulaResults];
}

function workerResponse(input: {
  step: MonitorStep;
  series: Array<SeriesSpec>;
  monitorType: MonitorType;
}): MetricMonitorResponse {
  const config: MetricsViewConfig = viewConfigOf(input.step);
  const isKubernetes: boolean = input.monitorType === MonitorType.Kubernetes;

  const seriesBreakdown: Array<MetricSeriesResult> = input.series.map(
    (spec: SeriesSpec): MetricSeriesResult => {
      return {
        fingerprint: MetricSeriesFingerprint.computeFingerprint(spec.labels),
        labels: spec.labels,
        aggregatedResults: seriesResults({
          config: config,
          spec: spec,
          cluster: isKubernetes,
        }),
      };
    },
  );

  const response: MetricMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricViewConfig: config,
    metricResult: seriesBreakdown[0]?.aggregatedResults || [],
    seriesBreakdown: seriesBreakdown,
  };

  if (isKubernetes) {
    /*
     * One raw scan per query, as the worker tags it: each resource at its
     * highest and lowest datapoint in the window.
     */
    response.kubernetesResourceBreakdowns = config.queryConfigs.map(
      (
        query: MetricQueryConfigData,
        index: number,
      ): KubernetesResourceBreakdown => {
        const metricName: string = metricNameOf(query);

        return {
          clusterName: CLUSTER,
          metricName: metricName,
          metricFriendlyName:
            getKubernetesMetricByMetricName(metricName)?.friendlyName ||
            metricName,
          metricAlias: query.metricAliasData?.metricVariable,
          metricUnit: "count",
          attributes: { [CLUSTER_KEY]: CLUSTER },
          affectedResources: input.series.map(
            (spec: SeriesSpec): KubernetesAffectedResource => {
              const values: Array<number> = spec.queryValues[index] || [0];

              return {
                ...PlatformResourceIdentity.kubernetes(
                  rawAttributesOf(spec, true),
                ),
                metricValue: Math.max(...values),
                lowestMetricValue: Math.min(...values),
              };
            },
          ),
        };
      },
    );
  }

  return response;
}

async function evaluate(input: {
  step: MonitorStep;
  series: Array<SeriesSpec>;
  monitorType: MonitorType;
}): Promise<ProbeApiIngestResponse> {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = input.monitorType;
  monitor.name = "Summed template";

  return MonitorCriteriaEvaluator.processMonitorStep({
    dataToProcess: workerResponse(input),
    monitorStep: input.step,
    monitor: monitor,
    probeApiIngestResponse: { monitorId: monitor.id!, rootCause: null },
    evaluationSummary: {
      criteriaResults: [],
      events: [],
    } as unknown as MonitorEvaluationSummary,
  });
}

interface Firing {
  // The rendered root cause of the firing criteria; "" when it did not fire.
  rootCause: string;
  // The series it matched, by their labels' values joined with "/".
  matched: Array<string>;
}

function seriesName(labels: JSONObject | undefined): string {
  return Object.values(labels || {})
    .map((value: unknown): string => {
      return String(value);
    })
    .join("/");
}

async function firing(input: {
  step: MonitorStep;
  series: Array<SeriesSpec>;
  monitorType: MonitorType;
}): Promise<Firing> {
  const response: ProbeApiIngestResponse = await evaluate(input);
  const firingId: string | undefined = firingCriteriaOf(
    input.step,
  ).data?.id?.toString();
  const matched: MatchedCriteriaResult | undefined = (
    response.matchedCriteria || []
  ).find((result: MatchedCriteriaResult): boolean => {
    return result.criteriaId === firingId;
  });

  return {
    rootCause: matched?.rootCause || "",
    matched: (matched?.perSeriesMatches || [])
      .map((match: PerSeriesCriteriaMatch): string => {
        return seriesName(match.labels);
      })
      .sort(),
  };
}

function sum(values: Array<number>): number {
  return values.reduce((total: number, value: number): number => {
    return total + value;
  }, 0);
}

// From the "Affected Resources" heading up to the analysis that follows it.
function affectedResourcesSection(rootCause: string): string {
  const start: number = rootCause.indexOf("**Affected Resources**");

  if (start < 0) {
    return "";
  }

  const end: number = rootCause.indexOf("**Root Cause Analysis**", start);

  return end < 0 ? rootCause.substring(start) : rootCause.substring(start, end);
}

const LIST_ENTRY: RegExp = /^\d+\. /;
const SAMPLE_ENTRY: RegExp = /^\d+\. `/;

// The bold value of each numbered entry of the Affected Resources list.
function listedValues(rootCause: string): Array<string> {
  return affectedResourcesSection(rootCause)
    .split("\n")
    .filter((line: string): boolean => {
      return LIST_ENTRY.test(line);
    })
    .map((line: string): string => {
      const match: RegExpMatchArray | null = line.match(/ — \*\*([^*]+)\*\*/);
      return match ? (match[1] as string) : "";
    });
}

function analysisOf(rootCause: string): string {
  const start: number = rootCause.indexOf("**Root Cause Analysis**");
  return start < 0 ? "" : rootCause.substring(start);
}

function breachingSamplesSection(rootCause: string): string {
  const start: number = rootCause.indexOf("**Breaching Samples**");

  if (start < 0) {
    return "";
  }

  const end: number = rootCause.indexOf("[Open metric in dashboard]", start);

  return end < 0 ? rootCause.substring(start) : rootCause.substring(start, end);
}

// The bold value of each numbered sample of the Breaching Samples list.
function sampleValues(rootCause: string): Array<string> {
  return breachingSamplesSection(rootCause)
    .split("\n")
    .filter((line: string): boolean => {
      return SAMPLE_ENTRY.test(line);
    })
    .map((line: string): string => {
      const match: RegExpMatchArray | null = line.match(/ — \*\*([^*]+)\*\*$/);
      return match ? (match[1] as string) : "";
    });
}

function perMinute(entries: Record<number, number>): Array<number> {
  return Array.from(
    { length: MINUTES_IN_WINDOW },
    (_: unknown, minute: number) => {
      return entries[minute] || 0;
    },
  );
}

const NEVER_READY: Array<number> = perMinute({});

/*
 * ---------------------------------------------------------------------------
 * Kubernetes: CrashLoopBackOff Detection and Job Failures
 * ---------------------------------------------------------------------------
 */

function container(input: {
  pod: string;
  name: string;
  restarts: Array<number>;
  ready?: Array<number> | undefined;
}): SeriesSpec {
  return {
    labels: {
      [NAMESPACE_KEY]: "payments",
      [POD_KEY]: input.pod,
      [CONTAINER_KEY]: input.name,
    },
    datapointAttributes: { "resource.k8s.node.name": "node-1" },
    queryValues: [input.restarts, input.ready || NEVER_READY],
  };
}

function job(input: { name: string; failures: Array<number> }): SeriesSpec {
  return {
    labels: { [NAMESPACE_KEY]: "batch", [JOB_KEY]: input.name },
    queryValues: [input.failures],
  };
}

describe("Kubernetes summed templates show the total they judged", () => {
  test("CrashLoopBackOff Detection lists each container at its restarts in the window, not its worst minute", async () => {
    // A restart in each of four minutes: no minute above 1, 4 in all.
    const steady: SeriesSpec = container({
      pod: "checkout-7d9f-2xk",
      name: "api",
      restarts: perMinute({ 1: 1, 4: 1, 7: 1, 10: 1 }),
    });
    // 3 in one minute, then 2 more: 5 in all.
    const burst: SeriesSpec = container({
      pod: "search-5c4b-abc",
      name: "indexer",
      restarts: perMinute({ 2: 3, 9: 1, 12: 1 }),
    });

    const result: Firing = await firing({
      step: kubernetesStep("k8s-crashloopbackoff"),
      series: [steady, burst],
      monitorType: MonitorType.Kubernetes,
    });

    expect(result.matched).toEqual([
      "payments/checkout-7d9f-2xk/api",
      "payments/search-5c4b-abc/indexer",
    ]);
    // Worst first, each at its window's total.
    expect(listedValues(result.rootCause)).toEqual(["5", "4"]);
    // The analysis names the worst container at the same value.
    expect(analysisOf(result.rootCause)).toContain(
      "The container `indexer` in pod `search-5c4b-abc` has restarted **5** times.",
    );
    // The criteria line says the same of the series it describes.
    expect(result.rootCause).toMatch(
      /The sum of Container Restarts was [45], above the 0 threshold\./,
    );
    // Never the worst single minute.
    expect(affectedResourcesSection(result.rootCause)).not.toContain("**3**");
    expect(affectedResourcesSection(result.rootCause)).not.toContain("**1**");
  });

  test("Job Failures lists each Job at its failures in the window, not its worst minute", async () => {
    const nightly: SeriesSpec = job({
      name: "nightly-export",
      failures: perMinute({ 0: 1, 3: 1, 8: 1 }),
    });
    const migrate: SeriesSpec = job({
      name: "db-migrate",
      failures: perMinute({ 5: 2, 6: 2 }),
    });
    const done: SeriesSpec = job({
      name: "report-28851120",
      failures: perMinute({}),
    });

    const result: Firing = await firing({
      step: kubernetesStep("k8s-job-failures"),
      series: [nightly, migrate, done],
      monitorType: MonitorType.Kubernetes,
    });

    expect(result.matched).toEqual([
      "batch/db-migrate",
      "batch/nightly-export",
    ]);
    expect(listedValues(result.rootCause)).toEqual(["4", "3"]);
    expect(analysisOf(result.rootCause)).toContain(
      "Job `db-migrate` has **4** failed pod(s).",
    );
    expect(result.rootCause).not.toContain("report-28851120");
  });

  test("a series that did not fire is not listed, whatever its worst minute", async () => {
    // Ready for most of the window: one restart does not page.
    const recovered: SeriesSpec = container({
      pod: "web-12ab-c3d",
      name: "web",
      restarts: perMinute({ 3: 2 }),
      ready: perMinute(
        Object.fromEntries(
          Array.from(
            { length: MINUTES_IN_WINDOW },
            (_: unknown, minute: number) => {
              return [minute, minute === 3 ? 0 : 1];
            },
          ),
        ),
      ),
    });
    const looping: SeriesSpec = container({
      pod: "checkout-7d9f-2xk",
      name: "api",
      restarts: perMinute({ 1: 1, 6: 1 }),
    });

    const result: Firing = await firing({
      step: kubernetesStep("k8s-crashloopbackoff"),
      series: [recovered, looping],
      monitorType: MonitorType.Kubernetes,
    });

    expect(result.matched).toEqual(["payments/checkout-7d9f-2xk/api"]);
    expect(listedValues(result.rootCause)).toEqual(["2"]);
    expect(result.rootCause).not.toContain("web-12ab-c3d");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Docker and Podman: Container Restart Loop, CPU Throttling
 * ---------------------------------------------------------------------------
 */

function dockerContainer(
  name: string,
  values: Array<Array<number>>,
): SeriesSpec {
  return {
    labels: { [DOCKER_CONTAINER_KEY]: name },
    datapointAttributes: { "resource.host.name": "docker-01" },
    queryValues: values,
  };
}

const CONTAINER_TEMPLATES: Array<{
  name: string;
  monitorType: MonitorType;
  step: () => MonitorStep;
}> = [
  {
    name: "Docker",
    monitorType: MonitorType.Docker,
    step: (): MonitorStep => {
      return dockerStep("docker-restart-loop");
    },
  },
  {
    name: "Podman",
    monitorType: MonitorType.Podman,
    step: (): MonitorStep => {
      return podmanStep("podman-restart-loop");
    },
  },
];

describe.each(CONTAINER_TEMPLATES)(
  "$name Container Restart Loop shows the total it judged",
  (template: { monitorType: MonitorType; step: () => MonitorStep }) => {
    test("the Breaching Samples lead with the restarts in the window, and list the minutes that added to them", async () => {
      // 5, 1 and 2 restarts: 8 in all, more than 3; one minute alone is above 3.
      const restarts: Array<number> = perMinute({ 1: 5, 2: 1, 4: 2 });

      const result: Firing = await firing({
        step: template.step(),
        series: [dockerContainer("checkout", [restarts])],
        monitorType: template.monitorType,
      });

      expect(result.matched).toEqual(["checkout"]);
      expect(result.rootCause).toContain(
        "The sum of Container Restarts was 8, above the 3 threshold.",
      );
      expect(breachingSamplesSection(result.rootCause)).toContain(
        "The sum of the 15 samples in the window was **8**. The samples that added to it:",
      );
      expect(sampleValues(result.rootCause)).toEqual(["5", "1", "2"]);
      // Never "1 of 15 samples breached" for the minute with 5.
      expect(result.rootCause).not.toContain("samples breached the threshold");
    });

    test("a loop whose minutes are all below the threshold is shown too, at its total", async () => {
      // One restart in each of four minutes: none above 3, 4 in all.
      const restarts: Array<number> = perMinute({ 0: 1, 3: 1, 6: 1, 9: 1 });

      const result: Firing = await firing({
        step: template.step(),
        series: [dockerContainer("billing", [restarts])],
        monitorType: template.monitorType,
      });

      expect(result.matched).toEqual(["billing"]);
      expect(breachingSamplesSection(result.rootCause)).toContain(
        "The sum of the 15 samples in the window was **4**.",
      );
      expect(sampleValues(result.rootCause)).toEqual(["1", "1", "1", "1"]);
    });

    test("3 restarts in the window is not a loop, however they fell", async () => {
      const result: Firing = await firing({
        step: template.step(),
        series: [dockerContainer("checkout", [perMinute({ 4: 3 })])],
        monitorType: template.monitorType,
      });

      expect(result).toEqual({ rootCause: "", matched: [] });
    });
  },
);

describe("Docker CPU Throttling shows the throttled time it judged", () => {
  test("the Breaching Samples lead with the window's total, not the worst minute", async () => {
    /*
     * The throttled time's Max and Min within each minute, in
     * nanoseconds: 0.6 s, 0.3 s and 0.4 s of growth - 1.3 s in all, above
     * the 1-second threshold, while no minute alone is.
     */
    const max: Array<number> = perMinute({ 2: 1.6e9, 5: 2.3e9, 9: 3.4e9 });
    const min: Array<number> = perMinute({ 2: 1.0e9, 5: 2.0e9, 9: 3.0e9 });

    const result: Firing = await firing({
      step: dockerStep("docker-cpu-throttling"),
      series: [dockerContainer("checkout", [max, min])],
      monitorType: MonitorType.Docker,
    });

    expect(result.matched).toEqual(["checkout"]);
    const lead: RegExpMatchArray | null = breachingSamplesSection(
      result.rootCause,
    ).match(/The sum of the 15 samples in the window was \*\*([^*]+)\*\*\./);
    expect(lead).not.toBeNull();
    // The same number, in the same format, as the criteria line.
    expect(result.rootCause).toContain(
      `The sum of CPU Throttled Time was ${lead![1]}`,
    );
    expect(sampleValues(result.rootCause)).toHaveLength(3);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Any criteria judged on one value of the window
 * ---------------------------------------------------------------------------
 */

describe("a grouped criteria judged on the window's average shows its average", () => {
  test("each node is listed at its average, the value the criteria compared", async () => {
    const step: MonitorStep = buildKubernetesMonitorStep({
      kubernetesMonitor: buildKubernetesMonitorConfig({
        clusterIdentifier: CLUSTER,
        metricName: "k8s.node.cpu.usage",
        metricAlias: "node_cpu",
        resourceScope: KubernetesResourceScope.Node,
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Avg,
        groupByAttributeKeys: ["resource.k8s.node.name"],
      }),
      offlineCriteriaInstance: buildOfflineCriteriaInstance({
        offlineMonitorStatusId: ObjectID.generate(),
        incidentSeverityId: ObjectID.generate(),
        alertSeverityId: ObjectID.generate(),
        monitorName: "Nodes",
        metricAlias: "node_cpu",
        filterType: FilterType.GreaterThan,
        value: 2,
        metricAggregationType: EvaluateOverTimeType.Average,
        incidentTitle: "Busy node",
        incidentDescription: "A node is busy.",
        criteriaName: "Busy node - CPU average > 2",
        criteriaDescription:
          "Triggers when a node's average CPU exceeds 2 cores.",
      }),
      onlineCriteriaInstance: buildOnlineCriteriaInstance({
        onlineMonitorStatusId: ObjectID.generate(),
        metricAlias: "node_cpu",
        filterType: FilterType.LessThanOrEqualTo,
        value: 2,
        metricAggregationType: EvaluateOverTimeType.Average,
      }),
    });

    const result: Firing = await firing({
      step: step,
      series: [
        // Averages 2.5 with a 4-core peak.
        {
          labels: { "resource.k8s.node.name": "node-1" },
          queryValues: [[1, 4, 3, 2, 2.5]],
        },
        // Averages 1.5: not busy, though one minute was.
        {
          labels: { "resource.k8s.node.name": "node-2" },
          queryValues: [[0.5, 3, 1, 1.5, 1.5]],
        },
      ],
      monitorType: MonitorType.Kubernetes,
    });

    expect(result.matched).toEqual(["node-1"]);
    expect(result.rootCause).toContain("The average of");
    expect(listedValues(result.rootCause)).toHaveLength(1);
    expect(listedValues(result.rootCause)[0]).toMatch(/^2\.5\b/);
    expect(affectedResourcesSection(result.rootCause)).not.toMatch(
      /\*\*4(\.0+)?\b/,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * The value kept is the one compared
 * ---------------------------------------------------------------------------
 */

function metricFilter(evaluationType: EvaluateOverTimeType): CriteriaFilter {
  return {
    checkOn: CheckOn.MetricValue,
    filterType: FilterType.GreaterThan,
    value: 0,
    metricMonitorOptions: {
      metricAlias: "a",
      metricAggregationType: evaluationType,
    },
  } as unknown as CriteriaFilter;
}

describe("MetricMonitorCriteria.getWindowAggregate", () => {
  test("takes each window aggregate as the comparison does", () => {
    const random: SeededRandom = seededRandom(5_470);

    for (let draw: number = 0; draw < 40; draw++) {
      const values: Array<number> = Array.from(
        { length: 1 + random(30) },
        (): number => {
          return random(1000) / 10 - 20;
        },
      );

      for (const [evaluationType, aggregation] of [
        [EvaluateOverTimeType.Sum, "sum"],
        [EvaluateOverTimeType.Average, "average"],
        [EvaluateOverTimeType.MaximumValue, "maximum"],
        [EvaluateOverTimeType.MunimumValue, "minimum"],
      ] as Array<[EvaluateOverTimeType, string]>) {
        expect(
          MetricMonitorCriteria.getWindowAggregate({
            values: values,
            criteriaFilter: metricFilter(evaluationType),
          }),
        ).toEqual({
          aggregation: aggregation,
          value: CompareCriteria.reduceWindow({
            values: values,
            evaluationType: evaluationType,
          })[0],
          sampleCount: values.length,
        });
      }
    }
  });

  test("keeps none for a criteria that judges every sample", () => {
    for (const evaluationType of [
      EvaluateOverTimeType.AnyValue,
      EvaluateOverTimeType.AllValues,
    ]) {
      expect(
        MetricMonitorCriteria.getWindowAggregate({
          values: [1, 2, 3],
          criteriaFilter: metricFilter(evaluationType),
        }),
      ).toBeUndefined();
    }
  });

  test("an empty window is the 0 a Treat as Zero criteria compares", () => {
    expect(
      MetricMonitorCriteria.getWindowAggregate({
        values: [],
        criteriaFilter: metricFilter(EvaluateOverTimeType.Sum),
      }),
    ).toEqual({ aggregation: "sum", value: 0, sampleCount: 0 });
  });

  test("the evaluate-over-time type wins over the metric aggregation, as in the comparison", () => {
    const filter: CriteriaFilter = {
      ...metricFilter(EvaluateOverTimeType.Sum),
      evaluateOverTimeOptions: {
        evaluateOverTimeType: EvaluateOverTimeType.MaximumValue,
      },
    } as unknown as CriteriaFilter;

    expect(
      MetricMonitorCriteria.getWindowAggregate({
        values: [1, 5, 2],
        criteriaFilter: filter,
      }),
    ).toEqual({ aggregation: "maximum", value: 5, sampleCount: 3 });
  });
});

/*
 * ---------------------------------------------------------------------------
 * Seeded sweep: what fires is the total's comparison, and what shows is the
 * total
 * ---------------------------------------------------------------------------
 */

describe("summed templates, swept over seeded windows", () => {
  /*
   * One to four series a window, each minute's value drawn from a seeded
   * stream - mostly quiet minutes, sometimes a burst. A series fires
   * exactly when its window's total passes the template's threshold, and
   * whatever its worst minute, the value the alert shows for it is that
   * total.
   */
  test("Kubernetes: every fired container and Job is listed at its total, and only those fire", async () => {
    const random: SeededRandom = seededRandom(5_471);
    let worstMinuteDiffered: number = 0;

    for (let trial: number = 0; trial < 30; trial++) {
      const crashLoop: boolean = trial % 2 === 0;
      const seriesCount: number = 1 + random(4);
      const totals: Map<string, number> = new Map();
      const series: Array<SeriesSpec> = [];

      for (let index: number = 0; index < seriesCount; index++) {
        const values: Array<number> = Array.from(
          { length: MINUTES_IN_WINDOW },
          (): number => {
            const roll: number = random(10);
            return roll < 6 ? 0 : roll < 9 ? 1 : 2 + random(4);
          },
        );
        const name: string = `w${trial}-${index}`;

        if (crashLoop) {
          series.push(
            container({ pod: `${name}-pod`, name: name, restarts: values }),
          );
          totals.set(`payments/${name}-pod/${name}`, sum(values));
        } else {
          series.push(job({ name: name, failures: values }));
          totals.set(`batch/${name}`, sum(values));
        }

        if (Math.max(...values) !== sum(values) && sum(values) > 0) {
          worstMinuteDiffered++;
        }
      }

      const result: Firing = await firing({
        step: kubernetesStep(
          crashLoop ? "k8s-crashloopbackoff" : "k8s-job-failures",
        ),
        series: series,
        monitorType: MonitorType.Kubernetes,
      });
      const shouldFire: Array<string> = Array.from(totals.entries())
        .filter(([, total]: [string, number]): boolean => {
          return total > 0;
        })
        .map(([name]: [string, number]): string => {
          return name;
        })
        .sort();
      const label: string = `trial ${trial}`;

      expect({ label, matched: result.matched }).toEqual({
        label,
        matched: shouldFire,
      });
      expect({ label, listed: listedValues(result.rootCause) }).toEqual({
        label,
        listed: shouldFire
          .map((name: string): number => {
            return totals.get(name)!;
          })
          .sort((a: number, b: number): number => {
            return b - a;
          })
          .map((total: number): string => {
            return String(total);
          }),
      });
    }

    // Windows whose worst minute was not their total, which the sweep is for.
    expect(worstMinuteDiffered).toBeGreaterThan(10);
  });

  test("Docker and Podman: the fired container's Breaching Samples lead with its total and list every minute that added to it", async () => {
    const random: SeededRandom = seededRandom(5_472);

    for (let trial: number = 0; trial < 30; trial++) {
      const template: (typeof CONTAINER_TEMPLATES)[number] =
        CONTAINER_TEMPLATES[trial % CONTAINER_TEMPLATES.length]!;
      const values: Array<number> = Array.from(
        { length: MINUTES_IN_WINDOW },
        (): number => {
          const roll: number = random(10);
          return roll < 7 ? 0 : roll < 9 ? 1 : 2 + random(5);
        },
      );
      const total: number = sum(values);

      const result: Firing = await firing({
        step: template.step(),
        series: [dockerContainer("checkout", [values])],
        monitorType: template.monitorType,
      });
      const label: string = `trial ${trial}: ${values.join(",")}`;

      if (total <= 3) {
        expect({ label, result }).toEqual({
          label,
          result: { rootCause: "", matched: [] },
        });
        continue;
      }

      expect({ label, matched: result.matched }).toEqual({
        label,
        matched: ["checkout"],
      });
      expect({
        label,
        lead: breachingSamplesSection(result.rootCause).includes(
          `The sum of the 15 samples in the window was **${total}**.`,
        ),
        line: result.rootCause.includes(
          `The sum of Container Restarts was ${total}, above the 3 threshold.`,
        ),
      }).toEqual({ label, lead: true, line: true });
      expect({ label, samples: sampleValues(result.rootCause) }).toEqual({
        label,
        samples: values
          .filter((value: number): boolean => {
            return value !== 0;
          })
          .map((value: number): string => {
            return String(value);
          }),
      });
    }
  });
});
