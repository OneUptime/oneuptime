import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
} from "Common/Types/Probe/ProbeApiIngestResponse";
import { getKubernetesAlertTemplateById } from "Common/Types/Monitor/KubernetesAlertTemplates";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * Job Failures (k8s-job-failures), from the samples the Kubernetes agent
 * sends to the verdict the worker reaches.
 *
 * The bug: the template read the Job's failed-pod count's growth BETWEEN
 * TWO SAMPLES OF THE SAME MINUTE (a Maximum and a Minimum query of
 * k8s.job.failed_pods per minute, subtracted by a formula and summed over
 * 15 minutes). Growth between two samples in different minutes was never
 * counted: at the agent's 30-second interval that is about half of a Job's
 * failures, and a single failure had even odds. And a Job recreated under
 * the same name - a Helm hook's, a migration Job a deploy replaces - read
 * the old Job's count against the new one's 0 as that many failures in one
 * minute.
 *
 * The agent now sends k8s.job.failed_pods.increase with every sample: the
 * Job's pods that failed since its previous sample of the same Job (by
 * UID), whatever the gap (HelmChart/Public/kubernetes-agent/templates/
 * configmap-deployment.yaml, transform/job-failures-increase and
 * cumulative_to_delta/job-failures-increase). The template sums those over
 * the window.
 *
 * What the k8s_cluster receiver sends, and so what these samples model
 * (receiver internal/jobs/jobs.go at 0.161.0 and 0.96.0): every Job in the
 * cluster at each interval until it is deleted, with its status.failed as
 * an int gauge on the Job's own resource - its UID, name and namespace. The
 * count only grows for the Job's life; a Job recreated under the same name
 * has a new UID and starts at 0.
 *
 * What the agent makes of them is modelled here exactly as
 * Tests/Ops/agent-job-failures-increase-behaviour.sh checks the collector
 * does it: a series is the Job's UID; a series' first sample sends no
 * increase, nor does a sample whose count went down, and every other one
 * sends its count minus the previous sample's. The running count
 * k8s.job.failed_pods is stored too, as the agent still sends it, so the
 * old query is judged here on the same samples.
 *
 * Driven through the worker's real Kubernetes read and the real criteria
 * evaluator, over rows folded per minute as ClickHouse folds them
 * (SqlGroupedFold).
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

// The end of every evaluated window: the template reads the 15 minutes before.
const WINDOW_END_MS: number = Date.UTC(2026, 9, 31, 12, 0, 0);
const WINDOW_MINUTES: number = 15;
const WINDOW_START_MS: number = WINDOW_END_MS - WINDOW_MINUTES * MINUTE;

const FAILED_PODS: string = "k8s.job.failed_pods";
const FAILED_PODS_INCREASE: string = "k8s.job.failed_pods.increase";

const CLUSTER: string = "prod-east";
const CLUSTER_KEY: string = "resource.k8s.cluster.name";
const NAMESPACE_KEY: string = "resource.k8s.namespace.name";
const JOB_KEY: string = "resource.k8s.job.name";
const JOB_UID_KEY: string = "resource.k8s.job.uid";

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
 * One reading of a Job, as k8s_cluster takes it: the Job object's UID (a
 * Job recreated under the same name has a new one) and its status.failed.
 */
interface Scrape {
  atMs: number;
  jobUid: string;
  failedCount: number;
}

// One Job name, as the template groups it.
interface JobSeries {
  namespace: string;
  job: string;
  scrapes: Array<Scrape>;
}

interface Point {
  atMs: number;
  value: number;
}

// An agent from before this change sends k8s.job.failed_pods only.
type Agent = "current" | "older";

/*
 * What the agent sends for a Job as k8s.job.failed_pods.increase: nothing
 * for a series' first sample, nothing for a sample whose count went down
 * (the next is measured from it), else the failures since the series'
 * previous sample, however long ago it was. A series is the Job's UID.
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
    const previous: number | undefined = previousBySeries.get(scrape.jobUid);

    if (previous !== undefined && scrape.failedCount >= previous) {
      increases.push({
        atMs: scrape.atMs,
        value: scrape.failedCount - previous,
      });
    }

    previousBySeries.set(scrape.jobUid, scrape.failedCount);
  }

  return increases;
}

// The rows ingest stores, by metric name.
function storedRows(input: {
  jobs: Array<JobSeries>;
  agent?: Agent | undefined;
}): Dictionary<Array<StoredMetricRow>> {
  const agent: Agent = input.agent || "current";
  const rows: Dictionary<Array<StoredMetricRow>> = {
    [FAILED_PODS]: [],
    [FAILED_PODS_INCREASE]: [],
  };

  for (const series of input.jobs) {
    const attributesOf: (scrape: Scrape) => JSONObject = (
      scrape: Scrape,
    ): JSONObject => {
      return {
        [CLUSTER_KEY]: CLUSTER,
        [NAMESPACE_KEY]: series.namespace,
        [JOB_KEY]: series.job,
        [JOB_UID_KEY]: scrape.jobUid,
      };
    };

    for (const scrape of series.scrapes) {
      rows[FAILED_PODS]!.push({
        time: new Date(scrape.atMs),
        value: scrape.failedCount,
        attributes: attributesOf(scrape),
      });
    }

    if (agent === "older") {
      continue;
    }

    const byTime: Map<number, Scrape> = new Map(
      series.scrapes.map((scrape: Scrape): [number, Scrape] => {
        return [scrape.atMs, scrape];
      }),
    );

    for (const point of agentIncreases(series.scrapes)) {
      rows[FAILED_PODS_INCREASE]!.push({
        time: new Date(point.atMs),
        value: point.value,
        // The copy keeps the count's resource: the Job's UID, name, namespace.
        attributes: attributesOf(byTime.get(point.atMs)!),
      });
    }
  }

  return rows;
}

interface AggregateArgs extends FoldedReadArgs {
  query: { name: string; attributes?: Dictionary<string> };
  startTimestamp: Date;
  endTimestamp: Date;
}

// The reads the worker made, so a test can say what it asked for.
let reads: Array<AggregateArgs> = [];

/*
 * Every read of the worker: the rows of the metric it asks for that its
 * attribute filters select, inside the window it asks for, folded per
 * minute (and per Job) by the read's own aggregation.
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
        Object.entries(read.query.attributes || {}).every(
          ([key, value]: [string, unknown]): boolean => {
            return row.attributes[key] === value;
          },
        )
      );
    });

    return foldRowsAsSqlRead(selected, read);
  });
}

function jobFailuresStep(): MonitorStep {
  return getKubernetesAlertTemplateById("k8s-job-failures")!.getMonitorStep(
    templateArgs,
  );
}

/*
 * The query the template used to build, kept here only to show, on the
 * same samples, what it saw: k8s.job.failed_pods' Maximum minus its
 * Minimum per minute, with the same criteria.
 */
function oldDeltaStep(): MonitorStep {
  const step: MonitorStep = jobFailuresStep();
  const config: JSONObject = step.data!
    .kubernetesMonitor as unknown as JSONObject;
  const query: (alias: string, aggregation: string) => JSONObject = (
    alias: string,
    aggregation: string,
  ): JSONObject => {
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
          metricName: FAILED_PODS,
          attributes: {},
          aggegationType: aggregation,
          aggregateBy: {},
        },
        groupByAttributeKeys: [NAMESPACE_KEY, JOB_KEY],
      },
    } as JSONObject;
  };

  config["metricViewConfig"] = {
    queryConfigs: [
      query("failed_pods_max", "Max"),
      query("failed_pods_min", "Min"),
    ],
    formulaConfigs: [
      {
        metricAliasData: {
          metricVariable: "failed_pods",
          title: "Failed Job Pods (in window)",
          description: "Failed Job Pods (in window)",
          legend: "Failed Job Pods (in window)",
          legendUnit: "",
        },
        metricFormulaData: {
          metricFormula: "failed_pods_max - failed_pods_min",
        },
      },
    ],
  } as unknown as JSONObject;

  return step;
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
  verdicts: Dictionary<Verdict>;
  rootCause: string | null;
}

/*
 * Each Job's verdict: whether the firing criteria (the first) and the
 * recovering one (the last) matched its series, as the monitor's
 * evaluation combines them, and the root cause the monitor was given.
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

  const byJob: Dictionary<Verdict> = {};

  for (const series of response.seriesBreakdown || []) {
    const name: string = `${series.labels[NAMESPACE_KEY] ?? ""}/${series.labels[JOB_KEY] ?? ""}`;
    byJob[name] = { fires: false, recovers: false };
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
      const labels: JSONObject = match.labels || {};
      const name: string = `${labels[NAMESPACE_KEY] ?? ""}/${labels[JOB_KEY] ?? ""}`;
      const verdict: Verdict = byJob[name] || {
        fires: false,
        recovers: false,
      };
      verdict[key] = true;
      byJob[name] = verdict;
    }
  }

  return { verdicts: byJob, rootCause: result.rootCause || null };
}

async function judgeWithRootCause(input: {
  jobs: Array<JobSeries>;
  agent?: Agent | undefined;
  step?: MonitorStep | undefined;
}): Promise<Judged> {
  givenStored(storedRows({ jobs: input.jobs, agent: input.agent }));

  const step: MonitorStep = input.step || jobFailuresStep();

  return await evaluate(step, await check(step));
}

async function judge(input: {
  jobs: Array<JobSeries>;
  agent?: Agent | undefined;
  step?: MonitorStep | undefined;
}): Promise<Dictionary<Verdict>> {
  return (await judgeWithRootCause(input)).verdicts;
}

// The minute `minute` of the window, plus `seconds`.
function at(minute: number, seconds: number = 0): number {
  return WINDOW_START_MS + minute * MINUTE + seconds * SECOND;
}

/*
 * A Job's status every `everySeconds`, from `fromMs` to `untilMs` (the
 * window's end by default), at `phaseSeconds` past each step: its failed
 * count is `startingCount` plus the failures (times in `failureTimesMs`)
 * up to that moment.
 */
function jobScrapes(input: {
  jobUid: string;
  fromMs: number;
  everySeconds: number;
  phaseSeconds?: number | undefined;
  untilMs?: number | undefined;
  startingCount?: number | undefined;
  failureTimesMs?: Array<number> | undefined;
}): Array<Scrape> {
  const out: Array<Scrape> = [];
  const failureTimes: Array<number> = input.failureTimesMs || [];
  const untilMs: number = input.untilMs ?? WINDOW_END_MS;

  for (
    let atMs: number = input.fromMs + (input.phaseSeconds || 0) * SECOND;
    atMs <= untilMs;
    atMs += input.everySeconds * SECOND
  ) {
    out.push({
      atMs: atMs,
      jobUid: input.jobUid,
      failedCount:
        (input.startingCount || 0) +
        failureTimes.filter((failureMs: number): boolean => {
          return failureMs <= atMs;
        }).length,
    });
  }

  return out;
}

// Failures at 55 seconds past five minutes of the window, one each.
const BETWEEN_MINUTES: Array<number> = [1, 4, 7, 10, 13].map(
  (minute: number): number => {
    return at(minute, 55);
  },
);

/*
 * A Job that keeps failing its pods, sampled at :15 and :45 of every
 * minute from five minutes before the window, with failures before it.
 */
function failing(input: {
  job: string;
  failureTimesMs: Array<number>;
  phaseSeconds?: number | undefined;
  everySeconds?: number | undefined;
}): JobSeries {
  return {
    namespace: "batch",
    job: input.job,
    scrapes: jobScrapes({
      jobUid: `${input.job}-uid`,
      fromMs: WINDOW_START_MS - 5 * MINUTE,
      everySeconds: input.everySeconds ?? 30,
      phaseSeconds: input.phaseSeconds ?? 15,
      startingCount: 2,
      failureTimesMs: input.failureTimesMs,
    }),
  };
}

beforeEach(() => {
  reads = [];
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricFindBy.mockReset().mockResolvedValue([]);
  // The unit k8s_cluster declares; the agent's copy keeps it.
  metricTypeFindBy.mockReset().mockResolvedValue([
    { name: FAILED_PODS, unit: "{pod}" },
    { name: FAILED_PODS_INCREASE, unit: "{pod}" },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Kubernetes Job Failures", () => {
  test("reads the failed pods the agent sends with each sample, summed per minute and per Job, on this cluster", async () => {
    givenStored({});
    const step: MonitorStep = jobFailuresStep();
    const queries: Array<MetricQueryConfigData> =
      MonitorStep.getMetricsViewConfig(step)!.queryConfigs;

    expect(
      queries.map((query: MetricQueryConfigData): string => {
        return query.metricQueryData.filterData.metricName as string;
      }),
    ).toEqual([FAILED_PODS_INCREASE]);

    await check(step);

    expect(
      reads.map((read: AggregateArgs): [string, string] => {
        return [read.query.name, read.aggregationType];
      }),
    ).toEqual([[FAILED_PODS_INCREASE, "Sum"]]);

    for (const read of reads) {
      expect(read.groupByAttributeKeys).toEqual([NAMESPACE_KEY, JOB_KEY]);
      expect(read.query.attributes).toEqual(
        expect.objectContaining({ [CLUSTER_KEY]: CLUSTER }),
      );
      expect(read.endTimestamp.getTime()).toBe(WINDOW_END_MS);
      expect(read.endTimestamp.getTime() - read.startTimestamp.getTime()).toBe(
        WINDOW_MINUTES * MINUTE,
      );
    }
  });

  test("fires on failures that all fall between two minutes' samples", async () => {
    /*
     * Sampled at :15 and :45 of every minute, failing at :55: each failure
     * lies between the last sample of one minute and the first of the
     * next. Within any minute the count never moves, so the old per-minute
     * Maximum minus Minimum read no failure at all.
     */
    const job: JobSeries = failing({
      job: "nightly-export",
      failureTimesMs: BETWEEN_MINUTES,
    });

    expect(await judge({ jobs: [job] })).toEqual({
      "batch/nightly-export": { fires: true, recovers: false },
    });
    expect(await judge({ jobs: [job], step: oldDeltaStep() })).toEqual({
      "batch/nightly-export": { fires: false, recovers: true },
    });
  });

  test("fires on a single failure between two minutes' samples", async () => {
    expect(
      await judge({
        jobs: [failing({ job: "nightly-export", failureTimesMs: [at(6, 55)] })],
      }),
    ).toEqual({ "batch/nightly-export": { fires: true, recovers: false } });
  });

  test("fires on a Job sampled minutes apart: each sample brings every failure since the last one", async () => {
    // Four samples in or just before the window, none two in one minute.
    const job: JobSeries = {
      namespace: "batch",
      job: "reindex",
      scrapes: [
        { atMs: at(-4, 10), jobUid: "reindex-uid", failedCount: 1 },
        { atMs: at(2, 40), jobUid: "reindex-uid", failedCount: 3 },
        { atMs: at(7, 20), jobUid: "reindex-uid", failedCount: 3 },
        { atMs: at(13, 50), jobUid: "reindex-uid", failedCount: 4 },
      ],
    };

    expect(await judge({ jobs: [job] })).toEqual({
      "batch/reindex": { fires: true, recovers: false },
    });
    // No two samples of one minute: the old delta never saw the count move.
    expect(await judge({ jobs: [job], step: oldDeltaStep() })).toEqual({
      "batch/reindex": { fires: false, recovers: true },
    });
  });

  test("a Job recreated under the same name is no failure at all", async () => {
    /*
     * The migration Job had failed 3 pods (and then succeeded on its retry).
     * A deploy deletes it at 6:20 and creates it again - the same name, a
     * new UID - at 6:40, starting at 0, and the new one succeeds. In minute
     * 6 the old per-minute Maximum minus Minimum read 3 - 0 as 3 failures:
     * it fired, on a Job none of whose pods failed. The agent sends nothing
     * for the new Job's first sample.
     */
    const job: JobSeries = {
      namespace: "payments",
      job: "db-migrate",
      scrapes: [
        ...jobScrapes({
          jobUid: "db-migrate-old-uid",
          fromMs: WINDOW_START_MS - 5 * MINUTE,
          untilMs: at(6, 15),
          everySeconds: 30,
          phaseSeconds: 15,
          startingCount: 3,
        }),
        ...jobScrapes({
          jobUid: "db-migrate-new-uid",
          fromMs: at(6, 40),
          everySeconds: 30,
        }),
      ],
    };

    expect(await judge({ jobs: [job], step: oldDeltaStep() })).toEqual({
      "payments/db-migrate": { fires: true, recovers: false },
    });
    expect(await judge({ jobs: [job] })).toEqual({
      "payments/db-migrate": { fires: false, recovers: true },
    });
  });

  test("a recreated Job's own failures are counted from its first sample", async () => {
    // The new Job fails twice after its first sample: both count.
    const job: JobSeries = {
      namespace: "payments",
      job: "db-migrate",
      scrapes: [
        ...jobScrapes({
          jobUid: "db-migrate-old-uid",
          fromMs: WINDOW_START_MS - 5 * MINUTE,
          untilMs: at(6, 15),
          everySeconds: 30,
          phaseSeconds: 15,
          startingCount: 3,
        }),
        ...jobScrapes({
          jobUid: "db-migrate-new-uid",
          fromMs: at(6, 40),
          everySeconds: 30,
          failureTimesMs: [at(8, 5), at(11, 55)],
        }),
      ],
    };

    expect(await judge({ jobs: [job] })).toEqual({
      "payments/db-migrate": { fires: true, recovers: false },
    });
  });

  test("a Job that failed long ago and succeeded on its retry recovers", async () => {
    // status.failed stays at 1 for the life of the Job object.
    const done: JobSeries = {
      namespace: "batch",
      job: "report-28851120",
      scrapes: jobScrapes({
        jobUid: "report-uid",
        fromMs: WINDOW_START_MS - 2 * MINUTE,
        everySeconds: 30,
        startingCount: 1,
      }),
    };

    expect(await judge({ jobs: [done] })).toEqual({
      "batch/report-28851120": { fires: false, recovers: true },
    });
  });

  test("a failure before the agent's first sample of a Job is that Job's starting point, not a failure", async () => {
    /*
     * The agent cannot tell a new Job's first failures from an old Job's
     * history: a series' first sample sends nothing. A Job whose only pod
     * failed before it was first sampled, and never retried, goes unseen -
     * as it did under the old delta.
     */
    const failedAtStart: JobSeries = {
      namespace: "batch",
      job: "once-28851125",
      scrapes: jobScrapes({
        jobUid: "once-uid",
        fromMs: at(5, 10),
        everySeconds: 30,
        startingCount: 1,
      }),
    };

    expect(await judge({ jobs: [failedAtStart] })).toEqual({
      "batch/once-28851125": { fires: false, recovers: true },
    });
    expect(
      await judge({ jobs: [failedAtStart], step: oldDeltaStep() }),
    ).toEqual({ "batch/once-28851125": { fires: false, recovers: true } });
  });

  test("judges every Job on its own", async () => {
    expect(
      await judge({
        jobs: [
          failing({ job: "nightly-export", failureTimesMs: BETWEEN_MINUTES }),
          {
            namespace: "batch",
            job: "report-28851120",
            scrapes: jobScrapes({
              jobUid: "report-uid",
              fromMs: WINDOW_START_MS - 5 * MINUTE,
              everySeconds: 30,
              startingCount: 4,
            }),
          },
        ],
      }),
    ).toEqual({
      "batch/nightly-export": { fires: true, recovers: false },
      "batch/report-28851120": { fires: false, recovers: true },
    });
  });

  test("a cluster whose agent predates k8s.job.failed_pods.increase never fires", async () => {
    /*
     * The reason monitors made from the old template are not rewritten to
     * this query: against an older agent it has no data, so neither
     * criteria matches and the monitor keeps its status. The docs tell
     * such a cluster to upgrade its agent.
     */
    expect(
      await judge({
        agent: "older",
        jobs: [
          failing({ job: "nightly-export", failureTimesMs: BETWEEN_MINUTES }),
        ],
      }),
    ).toEqual({});
  });
});

describe("Kubernetes Job Failures: what the old per-minute delta missed, and the increases count", () => {
  /*
   * Jobs failing 1 to 7 pods in the window, at times and scrape phases
   * drawn from a seeded stream, sampled every 30 seconds. The template
   * counts every failure, so it fires on each; the old delta counted only
   * those that happened to fall between two samples of the same minute.
   */
  test("whenever the pods fail and whatever the scrape phase, every failing Job fires", async () => {
    const random: SeededRandom = seededRandom(5_461);
    let missedByTheOldDelta: number = 0;

    for (let trial: number = 0; trial < 40; trial++) {
      const failureCount: number = 1 + random(7);
      const failureTimes: Array<number> = [];

      for (let index: number = 0; index < failureCount; index++) {
        // Anywhere from the window's start to a minute before its end.
        failureTimes.push(
          WINDOW_START_MS + random((WINDOW_MINUTES - 1) * 60) * SECOND,
        );
      }

      const job: JobSeries = failing({
        job: "nightly-export",
        failureTimesMs: failureTimes,
        phaseSeconds: random(30),
      });
      const label: string = `trial ${trial}: ${failureCount} failures`;

      expect({ label, verdict: await judge({ jobs: [job] }) }).toEqual({
        label,
        verdict: { "batch/nightly-export": { fires: true, recovers: false } },
      });

      const old: Dictionary<Verdict> = await judge({
        jobs: [job],
        step: oldDeltaStep(),
      });

      if (!old["batch/nightly-export"]?.fires) {
        missedByTheOldDelta++;
      }
    }

    // The failures the old template let through, which the sweep exists for.
    expect(missedByTheOldDelta).toBeGreaterThan(0);
  });

  /*
   * And a Job sampled every two minutes or so - a busy collector, a slow
   * API server - fires all the same: each sample brings every failure
   * since the last one, and the old delta, which needs two samples in one
   * minute, saw none of them.
   */
  test("sampled less than once a minute, every failing Job still fires", async () => {
    const random: SeededRandom = seededRandom(5_462);

    for (let trial: number = 0; trial < 20; trial++) {
      const failureTimes: Array<number> = [
        WINDOW_START_MS + random((WINDOW_MINUTES - 3) * 60) * SECOND,
      ];
      const job: JobSeries = failing({
        job: "nightly-export",
        failureTimesMs: failureTimes,
        everySeconds: 90 + random(60),
        phaseSeconds: random(60),
      });
      const label: string = `trial ${trial}`;

      expect({ label, verdict: await judge({ jobs: [job] }) }).toEqual({
        label,
        verdict: { "batch/nightly-export": { fires: true, recovers: false } },
      });
      expect({
        label,
        verdict: await judge({ jobs: [job], step: oldDeltaStep() }),
      }).toEqual({
        label,
        verdict: { "batch/nightly-export": { fires: false, recovers: true } },
      });
    }
  });

  /*
   * Jobs whose pods never fail in the window, with failed counts from
   * their past and recreations under the same name drawn from a seeded
   * stream. The template never fires on any of them; the old delta fired
   * on some of the recreated ones.
   */
  test("whatever a Job's history and however it is recreated, no failure never fires", async () => {
    const random: SeededRandom = seededRandom(5_463);
    let firedByTheOldDelta: number = 0;

    for (let trial: number = 0; trial < 30; trial++) {
      const startingCount: number = random(7);
      const recreatedAt: number = at(1 + random(12), random(60));
      const phaseSeconds: number = random(30);
      const recreated: boolean = trial % 2 === 0;

      const scrapes: Array<Scrape> = recreated
        ? [
            ...jobScrapes({
              jobUid: `old-${trial}`,
              fromMs: WINDOW_START_MS - 5 * MINUTE,
              untilMs: recreatedAt - 10 * SECOND,
              everySeconds: 30,
              phaseSeconds: phaseSeconds,
              startingCount: startingCount,
            }),
            ...jobScrapes({
              jobUid: `new-${trial}`,
              fromMs: recreatedAt + 10 * SECOND,
              everySeconds: 30,
            }),
          ]
        : jobScrapes({
            jobUid: `only-${trial}`,
            fromMs: WINDOW_START_MS - 5 * MINUTE,
            everySeconds: 30,
            phaseSeconds: phaseSeconds,
            startingCount: startingCount,
          });
      const job: JobSeries = {
        namespace: "payments",
        job: "db-migrate",
        scrapes: scrapes,
      };
      const label: string = `trial ${trial}: ${recreated ? "recreated" : "steady"} at ${startingCount}`;

      expect({ label, verdict: await judge({ jobs: [job] }) }).toEqual({
        label,
        verdict: { "payments/db-migrate": { fires: false, recovers: true } },
      });

      const old: Dictionary<Verdict> = await judge({
        jobs: [job],
        step: oldDeltaStep(),
      });

      if (old["payments/db-migrate"]?.fires) {
        firedByTheOldDelta++;
      }
    }

    // The recreated Jobs the old template paged on, which the sweep exists for.
    expect(firedByTheOldDelta).toBeGreaterThan(0);
  });
});

describe("Kubernetes Job Failures: what the alert says", () => {
  test("names the failures it compared, summed over the window", async () => {
    // Three failures, in minutes 1, 4 and 7, each between two samples.
    const judged: Judged = await judgeWithRootCause({
      jobs: [
        failing({
          job: "nightly-export",
          failureTimesMs: BETWEEN_MINUTES.slice(0, 3),
        }),
      ],
    });

    expect(judged.verdicts).toEqual({
      "batch/nightly-export": { fires: true, recovers: false },
    });
    expect(judged.rootCause).toContain(
      "The sum of Failed Job Pods was 3, above the 0 threshold.",
    );
    expect(judged.rootCause).toContain("k8s.job.failed_pods.increase");
  });
});
