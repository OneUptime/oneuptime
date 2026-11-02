import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import MetricMonitorResponse, {
  KubernetesAffectedResource,
  KubernetesResourceBreakdown,
} from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
} from "Common/Types/Probe/ProbeApiIngestResponse";
import {
  buildKubernetesMonitorConfig,
  buildKubernetesMonitorStep,
  buildOfflineCriteriaInstance,
  buildOnlineCriteriaInstance,
  getKubernetesAlertTemplateById,
} from "Common/Types/Monitor/KubernetesAlertTemplates";
import {
  KUBERNETES_WORKLOAD_KINDS,
  KubernetesResourceFilters,
  KubernetesResourceScope,
} from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import {
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import { getRecoveryThreshold } from "Common/Types/Monitor/Recommendation/RecommendationCriteriaBuilder";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * The restarts and Job failures the Kubernetes agent sends with each
 * sample, scoped to and grouped by a workload, from the rows ingest stores
 * to the verdict the worker reaches.
 *
 * The bug: the agent's k8s.container.restarts.increase left its pipeline
 * straight for the exporter, with the k8s_cluster receiver's attributes
 * alone - namespace, pod, container, node - and none of the workload names
 * k8sattributes gives the cluster's other container metrics. A Workload
 * scope puts the workload's name on EVERY query of a Kubernetes monitor
 * (monitorKubernetes), so CrashLoopBackOff Detection scoped to a
 * Deployment read no restart at all, while its readiness query read the
 * Deployment's containers: it never fired. A monitor grouped by a
 * Deployment's name put every restart in one unnamed group.
 *
 * The chart now hands the increase to its metrics pipeline once it is made
 * (HelmChart/Public/kubernetes-agent/templates/configmap-deployment.yaml,
 * the forward/restarts-increase connector), where the same k8sattributes
 * gives it the names it gives k8s.container.restarts, by the pod's UID -
 * after the conversion, so a container's series is still its pod's UID and
 * its name, whatever container.id each restart runs under. The Job
 * failures copy shares the Job's own resource, so it carries the Job's
 * name a Workload scope of kind Job filters on.
 *
 * What the rows model is what Tests/Ops/agent-restarts-increase-behaviour.sh
 * and agent-job-failures-increase-behaviour.sh check the collector sends:
 * the increase carries what the count carries but container.id. An agent
 * from before sends it without the workload names. Driven through the
 * worker's real Kubernetes read and the real criteria evaluator, over rows
 * folded per minute as ClickHouse folds them (SqlGroupedFold).
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { aggregateBy: jest.fn(), findBy: jest.fn() },
  };
});
jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import MonitorCriteriaEvaluator from "Common/Server/Utils/Monitor/MonitorCriteriaEvaluator";
import { monitorKubernetes } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import {
  FoldedReadArgs,
  StoredMetricRow,
  foldRowsAsSqlRead,
} from "./SqlGroupedFold";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

const SECOND: number = 1_000;
const MINUTE: number = 60 * SECOND;

// The end of every evaluated window: the templates read the 15 minutes before.
const WINDOW_END_MS: number = Date.UTC(2026, 9, 31, 12, 0, 0);
const WINDOW_MINUTES: number = 15;
const WINDOW_START_MS: number = WINDOW_END_MS - WINDOW_MINUTES * MINUTE;

const RESTARTS: string = "k8s.container.restarts";
const RESTARTS_INCREASE: string = "k8s.container.restarts.increase";
const READY: string = "k8s.container.ready";
const FAILED_PODS: string = "k8s.job.failed_pods";
const FAILED_PODS_INCREASE: string = "k8s.job.failed_pods.increase";

const CLUSTER: string = "prod-east";
const CLUSTER_KEY: string = "resource.k8s.cluster.name";
const NAMESPACE_KEY: string = "resource.k8s.namespace.name";
const POD_KEY: string = "resource.k8s.pod.name";
const CONTAINER_KEY: string = "resource.k8s.container.name";
const POD_UID_KEY: string = "resource.k8s.pod.uid";
const CONTAINER_ID_KEY: string = "resource.container.id";
const NODE_KEY: string = "resource.k8s.node.name";
const DEPLOYMENT_KEY: string = "resource.k8s.deployment.name";
const REPLICASET_KEY: string = "resource.k8s.replicaset.name";
const JOB_KEY: string = "resource.k8s.job.name";
const JOB_UID_KEY: string = "resource.k8s.job.uid";
const CRONJOB_KEY: string = "resource.k8s.cronjob.name";

// The names k8sattributes can give a pod, stored with the resource. prefix.
const WORKLOAD_KEYS: Array<string> = KUBERNETES_WORKLOAD_KINDS.map(
  (kind: { value: string }): string => {
    return `resource.k8s.${kind.value}.name`;
  },
);

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

const templateArgs: {
  clusterIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} = {
  clusterIdentifier: CLUSTER,
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: CLUSTER,
};

/*
 * One reading of a container's status, as k8s_cluster takes it: its pod's
 * UID, the ID of the container the status names (a new one with every
 * restart), its restartCount and whether it is ready.
 */
interface Scrape {
  atMs: number;
  podUid: string;
  containerId: string;
  restartCount: number;
  ready: number;
}

/*
 * One container of one pod, with what k8sattributes finds for the pod by
 * its UID: the names of the workloads it belongs to, as stored.
 */
interface WorkloadContainer {
  namespace: string;
  pod: string;
  container: string;
  workload: Dictionary<string>;
  scrapes: Array<Scrape>;
}

/*
 * "current": the chart hands the increase to its metrics pipeline, which
 * gives it the count's workload names. "without-workload-names": the
 * increase as charts sent it before, with the receiver's attributes alone.
 */
type Agent = "current" | "without-workload-names";

interface Point {
  atMs: number;
  value: number;
}

/*
 * What the agent sends as k8s.container.restarts.increase for a container:
 * keyed by the pod's UID (container.id is off), nothing for a series' first
 * sample or for a sample whose count went down, else the restarts since the
 * series' previous sample.
 */
function agentIncreases(scrapes: Array<Scrape>): Array<Point> {
  const ordered: Array<Scrape> = [...scrapes].sort(
    (a: Scrape, b: Scrape): number => {
      return a.atMs - b.atMs;
    },
  );
  const previousBySeries: Map<string, number> = new Map();
  const increases: Array<Point> = [];

  for (const scrape of ordered) {
    const previous: number | undefined = previousBySeries.get(scrape.podUid);

    if (previous !== undefined && scrape.restartCount >= previous) {
      increases.push({
        atMs: scrape.atMs,
        value: scrape.restartCount - previous,
      });
    }

    previousBySeries.set(scrape.podUid, scrape.restartCount);
  }

  return increases;
}

// The rows ingest stores for containers, by metric name.
function containerRows(input: {
  containers: Array<WorkloadContainer>;
  agent: Agent;
}): Dictionary<Array<StoredMetricRow>> {
  const rows: Dictionary<Array<StoredMetricRow>> = {
    [RESTARTS]: [],
    [RESTARTS_INCREASE]: [],
    [READY]: [],
  };

  for (const series of input.containers) {
    // What k8s.container.restarts and k8s.container.ready carry.
    const attributesOf: (scrape: Scrape) => JSONObject = (
      scrape: Scrape,
    ): JSONObject => {
      return {
        [CLUSTER_KEY]: CLUSTER,
        [NAMESPACE_KEY]: series.namespace,
        [POD_KEY]: series.pod,
        [CONTAINER_KEY]: series.container,
        [POD_UID_KEY]: scrape.podUid,
        [NODE_KEY]: "node-1",
        [CONTAINER_ID_KEY]: scrape.containerId,
        ...series.workload,
      };
    };

    for (const scrape of series.scrapes) {
      rows[RESTARTS]!.push({
        time: new Date(scrape.atMs),
        value: scrape.restartCount,
        attributes: attributesOf(scrape),
      });
      rows[READY]!.push({
        time: new Date(scrape.atMs),
        value: scrape.ready,
        attributes: attributesOf(scrape),
      });
    }

    const byTime: Map<number, Scrape> = new Map(
      series.scrapes.map((scrape: Scrape): [number, Scrape] => {
        return [scrape.atMs, scrape];
      }),
    );

    for (const point of agentIncreases(series.scrapes)) {
      // What the count carries but container.id...
      const attributes: JSONObject = attributesOf(byTime.get(point.atMs)!);
      delete attributes[CONTAINER_ID_KEY];

      // ...and, from an agent from before, but the workload names too.
      if (input.agent === "without-workload-names") {
        for (const key of Object.keys(series.workload)) {
          delete attributes[key];
        }
      }

      rows[RESTARTS_INCREASE]!.push({
        time: new Date(point.atMs),
        value: point.value,
        attributes: attributes,
      });
    }
  }

  return rows;
}

/*
 * One reading of a Job's status: its UID and its status.failed. The pods
 * it retries with never reach the Job's own resource.
 */
interface JobSample {
  atMs: number;
  jobUid: string;
  failed: number;
}

interface JobSeries {
  namespace: string;
  job: string;
  samples: Array<JobSample>;
}

// The rows ingest stores for Jobs: the count and its copy, on one resource.
function jobRows(jobs: Array<JobSeries>): Dictionary<Array<StoredMetricRow>> {
  const rows: Dictionary<Array<StoredMetricRow>> = {
    [FAILED_PODS]: [],
    [FAILED_PODS_INCREASE]: [],
  };

  for (const series of jobs) {
    const attributesOf: (sample: JobSample) => JSONObject = (
      sample: JobSample,
    ): JSONObject => {
      return {
        [CLUSTER_KEY]: CLUSTER,
        [NAMESPACE_KEY]: series.namespace,
        [JOB_KEY]: series.job,
        [JOB_UID_KEY]: sample.jobUid,
      };
    };
    const previousByUid: Map<string, number> = new Map();

    for (const sample of series.samples) {
      rows[FAILED_PODS]!.push({
        time: new Date(sample.atMs),
        value: sample.failed,
        attributes: attributesOf(sample),
      });

      const previous: number | undefined = previousByUid.get(sample.jobUid);
      if (previous !== undefined && sample.failed >= previous) {
        rows[FAILED_PODS_INCREASE]!.push({
          time: new Date(sample.atMs),
          value: sample.failed - previous,
          attributes: attributesOf(sample),
        });
      }
      previousByUid.set(sample.jobUid, sample.failed);
    }
  }

  return rows;
}

interface AggregateArgs extends FoldedReadArgs {
  query: { name: string; attributes?: Dictionary<string> };
  startTimestamp: Date;
  endTimestamp: Date;
}

interface FindArgs {
  query: { name: string; attributes?: Dictionary<string> };
  limit: number;
}

// The aggregated reads the worker made, so a test can say what it asked for.
let reads: Array<AggregateArgs> = [];

function selects(
  row: StoredMetricRow,
  attributes: Dictionary<string> | undefined,
): boolean {
  return Object.entries(attributes || {}).every(
    ([key, value]: [string, unknown]): boolean => {
      return row.attributes[key] === value;
    },
  );
}

/*
 * Every read of the worker: the rows of the metric it asks for that its
 * attribute filters select, inside its window, folded per minute (and per
 * series) by the read's own aggregation; and the raw scan of the newest
 * rows the Affected Resources are named from.
 */
function givenStored(
  rowsByMetricName: Dictionary<Array<StoredMetricRow>>,
): void {
  metricAggregateBy.mockImplementation(async (args: unknown) => {
    const read: AggregateArgs = args as AggregateArgs;
    reads.push(read);

    const selected: Array<StoredMetricRow> = (
      rowsByMetricName[read.query.name] || []
    ).filter((row: StoredMetricRow): boolean => {
      return (
        row.time.getTime() >= read.startTimestamp.getTime() &&
        row.time.getTime() <= read.endTimestamp.getTime() &&
        selects(row, read.query.attributes)
      );
    });

    return foldRowsAsSqlRead(selected, read);
  });

  metricFindBy.mockImplementation(async (args: unknown) => {
    const find: FindArgs = args as FindArgs;

    return (rowsByMetricName[find.query.name] || [])
      .filter((row: StoredMetricRow): boolean => {
        return (
          row.time.getTime() <= WINDOW_END_MS &&
          selects(row, find.query.attributes)
        );
      })
      .sort((a: StoredMetricRow, b: StoredMetricRow): number => {
        return b.time.getTime() - a.time.getTime();
      })
      .slice(0, find.limit)
      .map((row: StoredMetricRow): JSONObject => {
        return {
          attributes: row.attributes,
          value: row.value,
          time: row.time,
        } as JSONObject;
      });
  });
}

function templateStep(templateId: string): MonitorStep {
  return getKubernetesAlertTemplateById(templateId)!.getMonitorStep(
    templateArgs,
  );
}

// A template's step, scoped as the monitor form's Workload scope scopes it.
function scoped(
  templateId: string,
  resourceFilters: KubernetesResourceFilters,
): MonitorStep {
  const step: MonitorStep = templateStep(templateId);

  step.setKubernetesMonitor({
    ...step.data!.kubernetesMonitor!,
    resourceScope: KubernetesResourceScope.Workload,
    resourceFilters: resourceFilters,
  });

  return step;
}

/*
 * A Custom Metric monitor on Container Restarts (Increase), Sum per
 * namespace and the workload's name over 15 minutes, firing above
 * `threshold` restarts.
 */
function restartsPerWorkloadStep(input: {
  workloadKey: string;
  threshold: number;
}): MonitorStep {
  const metricAlias: string = "container_restarts";

  return buildKubernetesMonitorStep({
    kubernetesMonitor: buildKubernetesMonitorConfig({
      clusterIdentifier: CLUSTER,
      metricName: RESTARTS_INCREASE,
      metricAlias: metricAlias,
      resourceScope: KubernetesResourceScope.Workload,
      rollingTime: RollingTime.Past15Minutes,
      aggregationType: MetricsAggregationType.Sum,
      groupByAttributeKeys: [NAMESPACE_KEY, input.workloadKey],
    }),
    offlineCriteriaInstance: buildOfflineCriteriaInstance({
      offlineMonitorStatusId: templateArgs.offlineMonitorStatusId,
      incidentSeverityId: templateArgs.defaultIncidentSeverityId,
      alertSeverityId: templateArgs.defaultAlertSeverityId,
      monitorName: CLUSTER,
      metricAlias: metricAlias,
      filterType: FilterType.GreaterThan,
      value: input.threshold,
      metricAggregationType: EvaluateOverTimeType.Sum,
    }),
    onlineCriteriaInstance: buildOnlineCriteriaInstance({
      onlineMonitorStatusId: templateArgs.onlineMonitorStatusId,
      metricAlias: metricAlias,
      filterType: FilterType.LessThanOrEqualTo,
      value: input.threshold,
      metricAggregationType: EvaluateOverTimeType.Sum,
    }),
  });
}

async function check(step: MonitorStep): Promise<MetricMonitorResponse> {
  return await monitorKubernetes({
    monitorStep: step,
    monitorId: monitorId,
    projectId: projectId,
    evaluateUntil: new Date(WINDOW_END_MS),
  });
}

interface Verdict {
  fires: boolean;
  recovers: boolean;
}

interface Judged {
  // By the series' group-by values, joined with "/".
  verdicts: Dictionary<Verdict>;
  rootCause: string;
  response: MetricMonitorResponse;
}

function seriesName(labels: JSONObject, keys: Array<string>): string {
  return keys
    .map((key: string): string => {
      return String(labels[key] ?? "");
    })
    .join("/");
}

/*
 * Each series' verdict: whether the firing criteria (the first) and the
 * recovering one (the last) matched it, each with all of its filters, as
 * the monitor's evaluation combines them; and the root cause it was given.
 */
async function evaluate(
  step: MonitorStep,
  response: MetricMonitorResponse,
): Promise<Judged> {
  const instances: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
  const firingId: string = instances[0]!.data!.id!.toString();
  const recoveringId: string =
    instances[instances.length - 1]!.data!.id!.toString();
  const keys: Array<string> = MonitorStep.getGroupByAttributeKeys(step);

  const monitor: Monitor = new Monitor();
  monitor._id = monitorId.toString();
  monitor.monitorType = MonitorType.Kubernetes;
  monitor.name = CLUSTER;

  const result: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: response,
      monitorStep: step,
      monitor: monitor,
      probeApiIngestResponse: { monitorId: monitorId, rootCause: null },
      evaluationSummary: {
        criteriaResults: [],
        events: [],
      } as unknown as MonitorEvaluationSummary,
    });

  const verdicts: Dictionary<Verdict> = {};

  for (const series of response.seriesBreakdown || []) {
    verdicts[seriesName(series.labels, keys)] = {
      fires: false,
      recovers: false,
    };
  }

  for (const matched of (result.matchedCriteria ||
    []) as Array<MatchedCriteriaResult>) {
    const key: keyof Verdict | null =
      matched.criteriaId === firingId
        ? "fires"
        : matched.criteriaId === recoveringId
          ? "recovers"
          : null;

    if (!key) {
      continue;
    }

    for (const match of matched.perSeriesMatches) {
      const name: string = seriesName(match.labels || {}, keys);
      const verdict: Verdict = verdicts[name] || {
        fires: false,
        recovers: false,
      };
      verdict[key] = true;
      verdicts[name] = verdict;
    }
  }

  return {
    verdicts: verdicts,
    rootCause: result.rootCause || "",
    response: response,
  };
}

async function judgeContainers(input: {
  containers: Array<WorkloadContainer>;
  step: MonitorStep;
  agent?: Agent | undefined;
}): Promise<Judged> {
  givenStored(
    containerRows({
      containers: input.containers,
      agent: input.agent || "current",
    }),
  );

  return await evaluate(input.step, await check(input.step));
}

async function judgeJobs(input: {
  jobs: Array<JobSeries>;
  step: MonitorStep;
}): Promise<Judged> {
  givenStored(jobRows(input.jobs));

  return await evaluate(input.step, await check(input.step));
}

// The minute `minute` of the window, plus `seconds`.
function at(minute: number, seconds: number = 0): number {
  return WINDOW_START_MS + minute * MINUTE + seconds * SECOND;
}

/*
 * A container's status every 30 seconds, from five minutes before the
 * window to its end, at `phaseSeconds` past each step. Each restart (a time
 * in `restartTimesMs`) starts a new container: a new ID, the count one
 * higher. A crash-looping container waits in its back-off, not ready.
 */
function containerScrapes(input: {
  podUid: string;
  restartTimesMs: Array<number>;
  phaseSeconds?: number | undefined;
  startingCount?: number | undefined;
  ready?: number | undefined;
}): Array<Scrape> {
  const out: Array<Scrape> = [];

  for (
    let atMs: number =
      WINDOW_START_MS - 5 * MINUTE + (input.phaseSeconds ?? 15) * SECOND;
    atMs <= WINDOW_END_MS;
    atMs += 30 * SECOND
  ) {
    const restartsSoFar: number = input.restartTimesMs.filter(
      (restartMs: number): boolean => {
        return restartMs <= atMs;
      },
    ).length;

    out.push({
      atMs: atMs,
      podUid: input.podUid,
      containerId: `${input.podUid}-run-${restartsSoFar}`,
      restartCount: (input.startingCount ?? 2) + restartsSoFar,
      ready: input.ready ?? 0,
    });
  }

  return out;
}

// Restarts at 55 seconds past five minutes of the window, one each.
const BETWEEN_MINUTES: Array<number> = [1, 4, 7, 10, 13].map(
  (minute: number): number => {
    return at(minute, 55);
  },
);

/*
 * What k8sattributes finds for a pod of a workload of `kind` named `name`:
 * a Deployment's pod belongs to its ReplicaSet too, a CronJob's to the Job
 * it ran.
 */
function workloadOf(kind: string, name: string): Dictionary<string> {
  switch (kind) {
    case "deployment":
      return { [DEPLOYMENT_KEY]: name, [REPLICASET_KEY]: `${name}-7d9f` };
    case "cronjob":
      return { [CRONJOB_KEY]: name, [JOB_KEY]: `${name}-28851120` };
    default:
      return { [`resource.k8s.${kind}.name`]: name };
  }
}

// A crash-looping container of a pod of `workload`.
function crashLooping(input: {
  namespace?: string | undefined;
  pod: string;
  workload: Dictionary<string>;
  restartTimesMs?: Array<number> | undefined;
  phaseSeconds?: number | undefined;
}): WorkloadContainer {
  return {
    namespace: input.namespace || "payments",
    pod: input.pod,
    container: "app",
    workload: input.workload,
    scrapes: containerScrapes({
      podUid: `${input.namespace || "payments"}-${input.pod}-uid`,
      restartTimesMs: input.restartTimesMs || BETWEEN_MINUTES,
      phaseSeconds: input.phaseSeconds,
    }),
  };
}

beforeEach(() => {
  reads = [];
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricFindBy.mockReset().mockResolvedValue([]);
  // The units k8s_cluster declares; the agent's rename keeps restarts'.
  metricTypeFindBy.mockReset().mockResolvedValue([
    { name: RESTARTS, unit: "{restart}" },
    { name: RESTARTS_INCREASE, unit: "{restart}" },
    { name: READY, unit: "" },
    { name: FAILED_PODS, unit: "{pod}" },
    { name: FAILED_PODS_INCREASE, unit: "{pod}" },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CrashLoopBackOff Detection scoped to a workload", () => {
  test.each(
    KUBERNETES_WORKLOAD_KINDS.map(
      (kind: { label: string; value: string }): [string, string] => {
        return [kind.label, kind.value];
      },
    ),
  )(
    "scoped to a %s, reads that workload's containers alone and fires on their crash loop",
    async (_label: string, kind: string) => {
      const judged: Judged = await judgeContainers({
        containers: [
          crashLooping({
            pod: "target-pod",
            workload: workloadOf(kind, "target"),
          }),
          crashLooping({
            pod: "other-pod",
            workload: workloadOf(kind, "other"),
          }),
        ],
        step: scoped("k8s-crashloopbackoff", {
          workloadType: kind,
          workloadName: "target",
        }),
      });

      expect(judged.verdicts).toEqual({
        "payments/target-pod/app": { fires: true, recovers: false },
      });

      // Both queries, the restarts and the readiness, read that workload.
      expect(
        reads.map((read: AggregateArgs): string => {
          return read.query.name;
        }),
      ).toEqual([RESTARTS_INCREASE, READY]);
      for (const read of reads) {
        expect(read.query.attributes).toEqual(
          expect.objectContaining({
            [CLUSTER_KEY]: CLUSTER,
            [`resource.k8s.${kind}.name`]: "target",
          }),
        );
      }
      expect(judged.rootCause).toContain(
        "The sum of Container Restarts was 5, above the 0 threshold.",
      );
    },
  );

  test("from an agent that sends the increase without the workload names, a scoped monitor reads no restart, though the cluster-wide one fires", async () => {
    /*
     * The reason the chart now enriches the increase: the scope's
     * Deployment filter matched the readiness rows, which carry the
     * names, and none of the increase's.
     */
    const containers: Array<WorkloadContainer> = [
      crashLooping({
        pod: "checkout-7d9f-2xk",
        workload: workloadOf("deployment", "checkout"),
      }),
    ];
    const scopedStep: MonitorStep = scoped("k8s-crashloopbackoff", {
      workloadType: "deployment",
      workloadName: "checkout",
    });

    expect(
      (
        await judgeContainers({
          containers: containers,
          step: scopedStep,
          agent: "without-workload-names",
        })
      ).verdicts,
    ).toEqual({
      "payments/checkout-7d9f-2xk/app": { fires: false, recovers: false },
    });
    expect(
      (
        await judgeContainers({
          containers: containers,
          step: templateStep("k8s-crashloopbackoff"),
          agent: "without-workload-names",
        })
      ).verdicts,
    ).toEqual({
      "payments/checkout-7d9f-2xk/app": { fires: true, recovers: false },
    });
    expect(
      (await judgeContainers({ containers: containers, step: scopedStep }))
        .verdicts,
    ).toEqual({
      "payments/checkout-7d9f-2xk/app": { fires: true, recovers: false },
    });
  });

  test("a restart is no new series: every restart of a container, each run under a new container ID, counts in its one series", async () => {
    const looping: WorkloadContainer = crashLooping({
      pod: "checkout-7d9f-2xk",
      workload: workloadOf("deployment", "checkout"),
    });

    // Six container IDs in the window: the first run's and five restarts'.
    expect(
      new Set(
        looping.scrapes
          .filter((scrape: Scrape): boolean => {
            return scrape.atMs >= WINDOW_START_MS;
          })
          .map((scrape: Scrape): string => {
            return scrape.containerId;
          }),
      ).size,
    ).toBe(6);

    const judged: Judged = await judgeContainers({
      containers: [looping],
      step: scoped("k8s-crashloopbackoff", {
        workloadType: "deployment",
        workloadName: "checkout",
      }),
    });

    expect(judged.response.seriesBreakdown).toHaveLength(1);
    expect(judged.rootCause).toContain(
      "The sum of Container Restarts was 5, above the 0 threshold.",
    );
  });

  test("names the workload the crash-looping container belongs to, from the restarts it compared", async () => {
    const judged: Judged = await judgeContainers({
      containers: [
        crashLooping({
          pod: "checkout-7d9f-2xk",
          workload: workloadOf("deployment", "checkout"),
        }),
      ],
      step: scoped("k8s-crashloopbackoff", {
        workloadType: "deployment",
        workloadName: "checkout",
      }),
    });

    // The restarts query's own scan names the Deployment.
    const restarts: KubernetesResourceBreakdown | undefined = (
      judged.response.kubernetesResourceBreakdowns || []
    ).find((breakdown: KubernetesResourceBreakdown): boolean => {
      return breakdown.metricName === RESTARTS_INCREASE;
    });
    expect(restarts).toBeDefined();
    expect(
      restarts!.affectedResources.map(
        (resource: KubernetesAffectedResource): JSONObject => {
          return {
            podName: resource.podName,
            containerName: resource.containerName,
            workloadType: resource.workloadType,
            workloadName: resource.workloadName,
          };
        },
      ),
    ).toEqual([
      {
        podName: "checkout-7d9f-2xk",
        containerName: "app",
        workloadType: "Deployment",
        workloadName: "checkout",
      },
    ]);
    expect(judged.rootCause).toContain("Deployment: `checkout`");
  });

  test("scoped to a namespace and a workload, a same-named workload in another namespace stays out", async () => {
    const judged: Judged = await judgeContainers({
      containers: [
        crashLooping({
          namespace: "payments",
          pod: "checkout-7d9f-2xk",
          workload: workloadOf("deployment", "checkout"),
        }),
        crashLooping({
          namespace: "staging",
          pod: "checkout-5c4b-abc",
          workload: workloadOf("deployment", "checkout"),
        }),
      ],
      step: scoped("k8s-crashloopbackoff", {
        namespace: "payments",
        workloadType: "deployment",
        workloadName: "checkout",
      }),
    });

    expect(judged.verdicts).toEqual({
      "payments/checkout-7d9f-2xk/app": { fires: true, recovers: false },
    });
  });

  test("a workload kind names only its own pods: a Deployment's name is not a StatefulSet's", async () => {
    const judged: Judged = await judgeContainers({
      containers: [
        crashLooping({
          pod: "db-0",
          workload: workloadOf("statefulset", "db"),
        }),
        crashLooping({
          pod: "db-6b7f-k2m",
          workload: workloadOf("deployment", "db"),
        }),
      ],
      step: scoped("k8s-crashloopbackoff", {
        workloadType: "statefulset",
        workloadName: "db",
      }),
    });

    expect(judged.verdicts).toEqual({
      "payments/db-0/app": { fires: true, recovers: false },
    });
  });
});

describe("Container Restarts (Increase) grouped by workload", () => {
  test("Sum per namespace and Deployment: replicas that each restart a little page once for their Deployment, with all of their restarts", async () => {
    const checkoutReplicas: Array<WorkloadContainer> = [
      "checkout-7d9f-aaa",
      "checkout-7d9f-bbb",
      "checkout-7d9f-ccc",
    ].map((pod: string, index: number): WorkloadContainer => {
      return crashLooping({
        pod: pod,
        workload: workloadOf("deployment", "checkout"),
        restartTimesMs: [at(2 + index, 10), at(8 + index, 40)],
      });
    });
    const search: WorkloadContainer = crashLooping({
      pod: "search-5c4b-abc",
      workload: workloadOf("deployment", "search"),
      restartTimesMs: [at(1, 5), at(9, 5)],
    });

    const step: MonitorStep = restartsPerWorkloadStep({
      workloadKey: DEPLOYMENT_KEY,
      threshold: 3,
    });
    const judged: Judged = await judgeContainers({
      containers: [...checkoutReplicas, search],
      step: step,
    });

    // Six restarts of checkout's three pods, two of search's one.
    expect(judged.verdicts).toEqual({
      "payments/checkout": { fires: true, recovers: false },
      "payments/search": { fires: false, recovers: true },
    });
    expect(judged.rootCause).toContain(
      "The sum of container_restarts was 6, above the 3 threshold.",
    );

    // Per pod, none of checkout's would have crossed it.
    for (const replica of checkoutReplicas) {
      expect(
        agentIncreases(replica.scrapes)
          .filter((point: Point): boolean => {
            return point.atMs >= WINDOW_START_MS;
          })
          .reduce((total: number, point: Point): number => {
            return total + point.value;
          }, 0),
      ).toBe(2);
    }
  });

  test("grouped by any workload kind's name, each workload is its own series", async () => {
    for (const kind of KUBERNETES_WORKLOAD_KINDS) {
      const workloadKey: string = `resource.k8s.${kind.value}.name`;
      const judged: Judged = await judgeContainers({
        containers: [
          crashLooping({
            pod: `${kind.value}-a`,
            workload: workloadOf(kind.value, "alpha"),
            restartTimesMs: [at(3, 0), at(6, 0)],
          }),
          crashLooping({
            pod: `${kind.value}-b`,
            workload: workloadOf(kind.value, "beta"),
            restartTimesMs: [],
          }),
        ],
        step: restartsPerWorkloadStep({ workloadKey, threshold: 0 }),
      });

      expect({ kind: kind.value, verdicts: judged.verdicts }).toEqual({
        kind: kind.value,
        verdicts: {
          "payments/alpha": { fires: true, recovers: false },
          "payments/beta": { fires: false, recovers: true },
        },
      });
    }
  });

  test("from an agent that sends the increase without the workload names, every restart falls into one unnamed group", async () => {
    const judged: Judged = await judgeContainers({
      containers: [
        crashLooping({
          pod: "checkout-7d9f-aaa",
          workload: workloadOf("deployment", "checkout"),
          restartTimesMs: [at(2, 10)],
        }),
        crashLooping({
          pod: "search-5c4b-abc",
          workload: workloadOf("deployment", "search"),
          restartTimesMs: [at(5, 10)],
        }),
      ],
      step: restartsPerWorkloadStep({
        workloadKey: DEPLOYMENT_KEY,
        threshold: 0,
      }),
      agent: "without-workload-names",
    });

    expect(judged.verdicts).toEqual({
      "payments/": { fires: true, recovers: false },
    });
  });

  /*
   * Workloads of every kind, of one to three pods, whose containers restart
   * at times, phases and counts drawn from a seeded stream: grouped by the
   * workload's name, a workload fires exactly when the restarts of all of
   * its containers in the window add up past the threshold - every restart
   * of every pod, whatever container ID it ran under, in one series - and
   * recovers once they are back below the shared dead band.
   */
  test("whatever the restarts, a workload fires exactly when all of its containers' restarts add up past the threshold", async () => {
    const random: SeededRandom = seededRandom(5_470);
    let fired: number = 0;
    let recovered: number = 0;
    let multiPodFired: number = 0;

    for (let trial: number = 0; trial < 24; trial++) {
      const kind: { label: string; value: string } =
        KUBERNETES_WORKLOAD_KINDS[random(KUBERNETES_WORKLOAD_KINDS.length)]!;
      const workloadKey: string = `resource.k8s.${kind.value}.name`;
      const threshold: number = random(5);
      // The online criteria's threshold: 10% below the firing one.
      const recoversAtOrBelow: number =
        getRecoveryThreshold({
          filterType: FilterType.GreaterThan,
          value: threshold,
        }) ?? threshold;
      const containers: Array<WorkloadContainer> = [];
      const expected: Dictionary<Verdict> = {};

      for (const name of ["alpha", "beta", "gamma"]) {
        let total: number = 0;
        const pods: number = 1 + random(3);

        for (let pod: number = 0; pod < pods; pod++) {
          const restartTimesMs: Array<number> = [];
          const restarts: number = random(4);
          for (let index: number = 0; index < restarts; index++) {
            restartTimesMs.push(
              WINDOW_START_MS + random((WINDOW_MINUTES - 1) * 60) * SECOND,
            );
          }
          total += restarts;
          containers.push(
            crashLooping({
              pod: `${name}-${pod}`,
              workload: workloadOf(kind.value, name),
              restartTimesMs: restartTimesMs,
              phaseSeconds: random(30),
            }),
          );
        }

        expected[`payments/${name}`] = {
          fires: total > threshold,
          recovers: total <= recoversAtOrBelow,
        };
        fired += total > threshold ? 1 : 0;
        recovered += total <= recoversAtOrBelow ? 1 : 0;
        multiPodFired += total > threshold && pods > 1 ? 1 : 0;
      }

      const label: string = `trial ${trial}: ${kind.value}, more than ${threshold}`;

      expect({
        label,
        verdicts: (
          await judgeContainers({
            containers: containers,
            step: restartsPerWorkloadStep({ workloadKey, threshold }),
          })
        ).verdicts,
      }).toEqual({ label, verdicts: expected });
    }

    // The sweep held both verdicts, and workloads of several pods paging.
    expect(fired).toBeGreaterThan(5);
    expect(recovered).toBeGreaterThan(5);
    expect(multiPodFired).toBeGreaterThan(2);
  });
});

describe("Job Failures scoped to a Job", () => {
  // A Job's status every 30 seconds, failing a pod at each of `failureTimesMs`.
  function failingJob(input: {
    namespace?: string | undefined;
    job: string;
    failureTimesMs: Array<number>;
  }): JobSeries {
    const samples: Array<JobSample> = [];
    for (
      let atMs: number = WINDOW_START_MS - 5 * MINUTE + 15 * SECOND;
      atMs <= WINDOW_END_MS;
      atMs += 30 * SECOND
    ) {
      samples.push({
        atMs: atMs,
        jobUid: `${input.job}-uid`,
        failed: input.failureTimesMs.filter((failureMs: number): boolean => {
          return failureMs <= atMs;
        }).length,
      });
    }
    return {
      namespace: input.namespace || "batch",
      job: input.job,
      samples: samples,
    };
  }

  test("scoped to a Job, reads that Job's failures alone, from the copy that carries its name", async () => {
    const judged: Judged = await judgeJobs({
      jobs: [
        failingJob({
          job: "nightly-export",
          failureTimesMs: BETWEEN_MINUTES.slice(0, 3),
        }),
        failingJob({
          job: "report-28851120",
          failureTimesMs: BETWEEN_MINUTES.slice(1, 2),
        }),
      ],
      step: scoped("k8s-job-failures", {
        workloadType: "job",
        workloadName: "nightly-export",
      }),
    });

    expect(judged.verdicts).toEqual({
      "batch/nightly-export": { fires: true, recovers: false },
    });
    expect(
      reads.map((read: AggregateArgs): string | undefined => {
        return read.query.attributes?.[JOB_KEY];
      }),
    ).toEqual(["nightly-export"]);
    expect(judged.rootCause).toContain(
      "The sum of Failed Job Pods was 3, above the 0 threshold.",
    );
  });

  test("the copy carries what the count carries, so a Job's scope selects the same rows of both", async () => {
    const jobs: Array<JobSeries> = [
      failingJob({ job: "nightly-export", failureTimesMs: [at(4, 55)] }),
      failingJob({
        namespace: "payments",
        job: "db-migrate",
        failureTimesMs: [at(9, 55)],
      }),
    ];
    const rows: Dictionary<Array<StoredMetricRow>> = jobRows(jobs);

    for (const copy of rows[FAILED_PODS_INCREASE]!) {
      const count: StoredMetricRow | undefined = rows[FAILED_PODS]!.find(
        (row: StoredMetricRow): boolean => {
          return (
            row.time.getTime() === copy.time.getTime() &&
            row.attributes[JOB_UID_KEY] === copy.attributes[JOB_UID_KEY]
          );
        },
      );
      expect(count!.attributes).toEqual(copy.attributes);
    }

    const judged: Judged = await judgeJobs({
      jobs: jobs,
      step: scoped("k8s-job-failures", {
        namespace: "payments",
        workloadType: "job",
        workloadName: "db-migrate",
      }),
    });
    expect(judged.verdicts).toEqual({
      "payments/db-migrate": { fires: true, recovers: false },
    });
  });

  test("scoped to a CronJob, it reads none of its runs' failures: the receiver puts no CronJob on a Job's own metrics", async () => {
    /*
     * The Job's own resource names no pod, Deployment or CronJob: a
     * Workload scope of another kind reads nothing of it, as it reads
     * nothing of the other workload templates' own metrics. A CronJob's
     * runs are Jobs named after it, scoped one Job at a time.
     */
    const judged: Judged = await judgeJobs({
      jobs: [
        failingJob({
          job: "report-28851120",
          failureTimesMs: BETWEEN_MINUTES.slice(0, 2),
        }),
      ],
      step: scoped("k8s-job-failures", {
        workloadType: "cronjob",
        workloadName: "report",
      }),
    });

    expect(judged.verdicts).toEqual({});
    for (const read of reads) {
      expect(read.query.attributes?.[CRONJOB_KEY]).toBe("report");
    }
  });
});

describe("the rows this suite stores are the agent's", () => {
  test("the increase carries what the count carries but container.id, and every workload name of its pod", () => {
    const containers: Array<WorkloadContainer> = KUBERNETES_WORKLOAD_KINDS.map(
      (kind: { value: string }): WorkloadContainer => {
        return crashLooping({
          pod: `${kind.value}-pod`,
          workload: workloadOf(kind.value, "target"),
        });
      },
    );
    const rows: Dictionary<Array<StoredMetricRow>> = containerRows({
      containers: containers,
      agent: "current",
    });

    expect(rows[RESTARTS_INCREASE]!.length).toBeGreaterThan(0);
    for (const increase of rows[RESTARTS_INCREASE]!) {
      const count: StoredMetricRow = rows[RESTARTS]!.find(
        (row: StoredMetricRow): boolean => {
          return (
            row.time.getTime() === increase.time.getTime() &&
            row.attributes[POD_UID_KEY] === increase.attributes[POD_UID_KEY]
          );
        },
      )!;
      const withoutId: JSONObject = { ...count.attributes };
      delete withoutId[CONTAINER_ID_KEY];

      expect(increase.attributes).toEqual(withoutId);
      expect(increase.attributes[CONTAINER_ID_KEY]).toBeUndefined();
      expect(
        WORKLOAD_KEYS.some((key: string): boolean => {
          return Boolean(increase.attributes[key]);
        }),
      ).toBe(true);
    }

    // Every workload kind a pod belongs to is a name some pod carries.
    for (const key of WORKLOAD_KEYS) {
      expect(
        rows[RESTARTS_INCREASE]!.some((row: StoredMetricRow): boolean => {
          return row.attributes[key] !== undefined;
        }),
      ).toBe(true);
    }
  });
});
