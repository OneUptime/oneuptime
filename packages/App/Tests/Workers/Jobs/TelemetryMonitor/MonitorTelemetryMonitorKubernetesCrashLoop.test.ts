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
 * CrashLoopBackOff Detection (k8s-crashloopbackoff), from the samples the
 * Kubernetes agent sends to the verdict the worker reaches.
 *
 * The bug: the template read the restart count's growth BETWEEN TWO SAMPLES
 * OF THE SAME MINUTE (a Maximum and a Minimum query of
 * k8s.container.restarts per minute, subtracted by a formula and summed
 * over 15 minutes, while the container was ready less than half of it).
 * Growth between two samples in different minutes was never counted: at
 * the agent's 30-second interval that is about half of every crash loop,
 * and a single restart had even odds. And a pod recreated under the same
 * name - a StatefulSet's - read its old count against the new pod's 0 as
 * that many restarts in one minute.
 *
 * The agent now sends k8s.container.restarts.increase with every sample:
 * the restarts since its previous sample of the same pod (by UID) and
 * container, whatever the gap (HelmChart/Public/kubernetes-agent/templates/
 * configmap-deployment.yaml, the metrics/restarts-increase pipeline). The
 * template sums those over the window.
 *
 * What the k8s_cluster receiver sends, and so what these samples model
 * (receiver internal/container/containers.go and the kubelet's
 * kuberuntime_container.go and kubelet_pods.go): every container of every
 * pod at each interval, running or waiting in CrashLoopBackOff, with the
 * container status' restartCount and ready flag, on a resource keyed by
 * container.id. The kubelet runs every restart as a NEW container, with a
 * new ID and the count one higher, and while a container waits in its
 * back-off its status keeps the exited container's ID and count. A
 * recreated pod has a new UID and starts at 0.
 *
 * What the agent's pipeline makes of them is modelled here exactly as
 * Tests/Ops/agent-restarts-increase-behaviour.sh checks the collector does
 * it: container.id comes off, so a container's series is its pod's UID and
 * its name; a series' first sample sends no increase, nor does a sample
 * whose count went down, and every other one sends its count minus the
 * previous sample's. The running count k8s.container.restarts is stored
 * too, as the agent still sends it, so the old query is judged here on the
 * same samples.
 *
 * Driven through the worker's real Kubernetes read and the real criteria
 * evaluator (both filters of each criteria, combined per container), over
 * rows folded per minute as ClickHouse folds them (SqlGroupedFold).
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

const RESTARTS: string = "k8s.container.restarts";
const RESTARTS_INCREASE: string = "k8s.container.restarts.increase";
const READY: string = "k8s.container.ready";

const CLUSTER: string = "prod-east";
const CLUSTER_KEY: string = "resource.k8s.cluster.name";
const NAMESPACE_KEY: string = "resource.k8s.namespace.name";
const POD_KEY: string = "resource.k8s.pod.name";
const CONTAINER_KEY: string = "resource.k8s.container.name";
const POD_UID_KEY: string = "resource.k8s.pod.uid";
const CONTAINER_ID_KEY: string = "resource.container.id";
const NODE_KEY: string = "resource.k8s.node.name";

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
 * One reading of a container's status, as k8s_cluster takes it: the pod it
 * belongs to (its UID - a recreated pod has a new one, whatever its name),
 * the ID of the container the status names, its restartCount, and whether
 * it is ready.
 */
interface Scrape {
  atMs: number;
  podUid: string;
  containerId: string;
  restartCount: number;
  ready: number;
}

// One container of one pod name, as the template groups it.
interface ContainerSeries {
  namespace: string;
  pod: string;
  container: string;
  scrapes: Array<Scrape>;
}

interface Point {
  atMs: number;
  value: number;
}

/*
 * The series cumulative_to_delta tells apart: what is left of the
 * resource. The chart's pipeline takes container.id off, so a container's
 * series is its pod and its name. A copy of the Docker agent's processors,
 * which keep the resource as it is, would key it by container.id too.
 */
type Agent = "current" | "older" | "keyed-by-container-id";

/*
 * What the agent sends for a container as container.restarts.increase:
 * nothing for a series' first sample, nothing for a sample whose count
 * went down (the next is measured from it), else the restarts since the
 * series' previous sample, however long ago it was.
 */
function agentIncreases(scrapes: Array<Scrape>, agent: Agent): Array<Point> {
  const ordered: Array<Scrape> = [...scrapes].sort(
    (a: Scrape, b: Scrape): number => {
      return a.atMs - b.atMs;
    },
  );
  const previousBySeries: Map<string, number> = new Map();
  const increases: Array<Point> = [];

  for (const scrape of ordered) {
    const series: string =
      agent === "keyed-by-container-id"
        ? `${scrape.podUid}|${scrape.containerId}`
        : scrape.podUid;
    const previous: number | undefined = previousBySeries.get(series);

    if (previous !== undefined && scrape.restartCount >= previous) {
      increases.push({
        atMs: scrape.atMs,
        value: scrape.restartCount - previous,
      });
    }

    previousBySeries.set(series, scrape.restartCount);
  }

  return increases;
}

/*
 * The rows ingest stores, by metric name. An agent from before this change
 * sends k8s.container.restarts and k8s.container.ready only.
 */
function storedRows(input: {
  containers: Array<ContainerSeries>;
  agent?: Agent | undefined;
}): Dictionary<Array<StoredMetricRow>> {
  const agent: Agent = input.agent || "current";
  const rows: Dictionary<Array<StoredMetricRow>> = {
    [RESTARTS]: [],
    [RESTARTS_INCREASE]: [],
    [READY]: [],
  };

  for (const series of input.containers) {
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

    if (agent === "older") {
      continue;
    }

    const byTime: Map<number, Scrape> = new Map(
      series.scrapes.map((scrape: Scrape): [number, Scrape] => {
        return [scrape.atMs, scrape];
      }),
    );

    for (const point of agentIncreases(series.scrapes, agent)) {
      const attributes: JSONObject = attributesOf(byTime.get(point.atMs)!);

      if (agent === "current") {
        // transform/restarts-increase takes it off the copy.
        delete attributes[CONTAINER_ID_KEY];
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
 * minute (and per container) by the read's own aggregation.
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

function crashLoopStep(): MonitorStep {
  return getKubernetesAlertTemplateById("k8s-crashloopbackoff")!.getMonitorStep(
    templateArgs,
  );
}

/*
 * The query the template used to build, kept here only to show, on the
 * same samples, what it saw: k8s.container.restarts' Maximum minus its
 * Minimum per minute, next to the readiness, with the same criteria.
 */
function oldDeltaStep(): MonitorStep {
  const step: MonitorStep = crashLoopStep();
  const config: JSONObject = step.data!
    .kubernetesMonitor as unknown as JSONObject;
  const query: (
    alias: string,
    metricName: string,
    aggregation: string,
  ) => JSONObject = (
    alias: string,
    metricName: string,
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
          metricName: metricName,
          attributes: {},
          aggegationType: aggregation,
          aggregateBy: {},
        },
        groupByAttributeKeys: [NAMESPACE_KEY, POD_KEY, CONTAINER_KEY],
      },
    } as JSONObject;
  };

  config["metricViewConfig"] = {
    queryConfigs: [
      query("container_restarts_max", RESTARTS, "Max"),
      query("container_restarts_min", RESTARTS, "Min"),
      query("container_ready", READY, "Avg"),
    ],
    formulaConfigs: [
      {
        metricAliasData: {
          metricVariable: "container_restarts",
          title: "Container Restarts (in window)",
          description: "Container Restarts (in window)",
          legend: "Container Restarts (in window)",
          legendUnit: "",
        },
        metricFormulaData: {
          metricFormula: "container_restarts_max - container_restarts_min",
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

/*
 * Each container's verdict: whether the firing criteria (the first) and the
 * recovering one (the last) matched its series, each with all of its
 * filters, as the monitor's evaluation combines them.
 */
async function verdicts(
  step: MonitorStep,
  response: MetricMonitorResponse,
): Promise<Dictionary<Verdict>> {
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

  const byContainer: Dictionary<Verdict> = {};

  for (const series of response.seriesBreakdown || []) {
    const name: string = `${series.labels[POD_KEY] ?? ""}/${series.labels[CONTAINER_KEY] ?? ""}`;
    byContainer[name] = { fires: false, recovers: false };
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
      const name: string = `${labels[POD_KEY] ?? ""}/${labels[CONTAINER_KEY] ?? ""}`;
      const verdict: Verdict = byContainer[name] || {
        fires: false,
        recovers: false,
      };
      verdict[key] = true;
      byContainer[name] = verdict;
    }
  }

  return byContainer;
}

async function judge(input: {
  containers: Array<ContainerSeries>;
  agent?: Agent | undefined;
  step?: MonitorStep | undefined;
}): Promise<Dictionary<Verdict>> {
  givenStored(storedRows({ containers: input.containers, agent: input.agent }));

  const step: MonitorStep = input.step || crashLoopStep();

  return await verdicts(step, await check(step));
}

// The minute `minute` of the window, plus `seconds`.
function at(minute: number, seconds: number = 0): number {
  return WINDOW_START_MS + minute * MINUTE + seconds * SECOND;
}

/*
 * A container's status every `everySeconds`, from `fromMs` to the window's
 * end, at `phaseSeconds` past each step. Each restart (a time in
 * `restartTimesMs`) starts a new container: a new ID, the count one higher.
 * `readyAt` says whether the status reads ready at a moment.
 */
function containerScrapes(input: {
  podUid: string;
  fromMs: number;
  everySeconds: number;
  phaseSeconds?: number | undefined;
  untilMs?: number | undefined;
  startingCount?: number | undefined;
  restartTimesMs?: Array<number> | undefined;
  readyAt: (atMs: number) => number;
}): Array<Scrape> {
  const out: Array<Scrape> = [];
  const restartTimes: Array<number> = input.restartTimesMs || [];
  const untilMs: number = input.untilMs ?? WINDOW_END_MS;

  for (
    let atMs: number = input.fromMs + (input.phaseSeconds || 0) * SECOND;
    atMs <= untilMs;
    atMs += input.everySeconds * SECOND
  ) {
    const restartsSoFar: number = restartTimes.filter(
      (restartMs: number): boolean => {
        return restartMs <= atMs;
      },
    ).length;

    out.push({
      atMs: atMs,
      podUid: input.podUid,
      containerId: `${input.podUid}-run-${restartsSoFar}`,
      restartCount: (input.startingCount || 0) + restartsSoFar,
      ready: input.readyAt(atMs),
    });
  }

  return out;
}

const NEVER_READY: (atMs: number) => number = (): number => {
  return 0;
};
const ALWAYS_READY: (atMs: number) => number = (): number => {
  return 1;
};

// Restarts at 55 seconds past five minutes of the window, one each.
const BETWEEN_MINUTES: Array<number> = [1, 4, 7, 10, 13].map(
  (minute: number): number => {
    return at(minute, 55);
  },
);

// Sampled at :15 and :45 of every minute, from five minutes before the window.
function crashLooping(input: {
  pod: string;
  restartTimesMs: Array<number>;
  phaseSeconds?: number | undefined;
}): ContainerSeries {
  return {
    namespace: "payments",
    pod: input.pod,
    container: "api",
    scrapes: containerScrapes({
      podUid: `${input.pod}-uid`,
      fromMs: WINDOW_START_MS - 5 * MINUTE,
      everySeconds: 30,
      phaseSeconds: input.phaseSeconds ?? 15,
      startingCount: 7,
      restartTimesMs: input.restartTimesMs,
      // A crash-looping container waits in its back-off, not ready.
      readyAt: NEVER_READY,
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
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Kubernetes CrashLoopBackOff Detection", () => {
  test("reads the restarts the agent sends with each sample, summed per minute and per container, and the readiness, on this cluster", async () => {
    givenStored({});
    const step: MonitorStep = crashLoopStep();
    const queries: Array<MetricQueryConfigData> =
      MonitorStep.getMetricsViewConfig(step)!.queryConfigs;

    expect(
      queries.map((query: MetricQueryConfigData): string => {
        return query.metricQueryData.filterData.metricName as string;
      }),
    ).toEqual([RESTARTS_INCREASE, READY]);

    await check(step);

    expect(
      reads.map((read: AggregateArgs): [string, string] => {
        return [read.query.name, read.aggregationType];
      }),
    ).toEqual([
      [RESTARTS_INCREASE, "Sum"],
      [READY, "Avg"],
    ]);

    for (const read of reads) {
      expect(read.groupByAttributeKeys).toEqual([
        NAMESPACE_KEY,
        POD_KEY,
        CONTAINER_KEY,
      ]);
      expect(read.query.attributes).toEqual(
        expect.objectContaining({ [CLUSTER_KEY]: CLUSTER }),
      );
      expect(read.endTimestamp.getTime()).toBe(WINDOW_END_MS);
      expect(read.endTimestamp.getTime() - read.startTimestamp.getTime()).toBe(
        WINDOW_MINUTES * MINUTE,
      );
    }
  });

  test("fires on a crash loop whose restarts all fall between two minutes' samples", async () => {
    /*
     * Sampled at :15 and :45 of every minute, restarting at :55: each
     * restart lies between the last sample of one minute and the first of
     * the next. Within any minute the count never moves, so the old
     * per-minute Maximum minus Minimum read no restart at all.
     */
    expect(
      await judge({
        containers: [
          crashLooping({
            pod: "checkout-7d9f-2xk",
            restartTimesMs: BETWEEN_MINUTES,
          }),
        ],
      }),
    ).toEqual({ "checkout-7d9f-2xk/api": { fires: true, recovers: false } });
  });

  test("fires on a single restart between two minutes' samples, of a container that stays not ready", async () => {
    expect(
      await judge({
        containers: [
          crashLooping({
            pod: "checkout-7d9f-2xk",
            restartTimesMs: [at(6, 55)],
          }),
        ],
      }),
    ).toEqual({ "checkout-7d9f-2xk/api": { fires: true, recovers: false } });
  });

  test("fires on a container sampled minutes apart: each sample brings every restart since the last one", async () => {
    // Four samples in or just before the window, none two in one minute.
    const series: ContainerSeries = {
      namespace: "payments",
      pod: "worker-5c4b-abc",
      container: "worker",
      scrapes: [
        {
          atMs: at(-4, 10),
          podUid: "worker-uid",
          containerId: "c-10",
          restartCount: 10,
          ready: 0,
        },
        {
          atMs: at(2, 40),
          podUid: "worker-uid",
          containerId: "c-12",
          restartCount: 12,
          ready: 0,
        },
        {
          atMs: at(7, 20),
          podUid: "worker-uid",
          containerId: "c-13",
          restartCount: 13,
          ready: 0,
        },
        {
          atMs: at(13, 50),
          podUid: "worker-uid",
          containerId: "c-16",
          restartCount: 16,
          ready: 0,
        },
      ],
    };

    expect(await judge({ containers: [series] })).toEqual({
      "worker-5c4b-abc/worker": { fires: true, recovers: false },
    });
  });

  test("a pod recreated under the same name, a StatefulSet's, is no restart at all", async () => {
    /*
     * db-0 had restarted 7 times. It is deleted at 6:20 and its controller
     * recreates it - the same name, a new UID - at 6:40, starting at 0, and
     * it is still not ready at the window's end (a database replaying its
     * log). In minute 6 the old per-minute Maximum minus Minimum read 7 - 0
     * as 7 restarts, and the container was ready for less than half the
     * window: it fired, on a pod that never restarted. The agent sends
     * nothing for the new pod's first sample.
     */
    const series: ContainerSeries = {
      namespace: "data",
      pod: "db-0",
      container: "postgres",
      scrapes: [
        ...containerScrapes({
          podUid: "db-0-old-uid",
          fromMs: WINDOW_START_MS - 5 * MINUTE,
          untilMs: at(6, 15),
          everySeconds: 30,
          phaseSeconds: 15,
          startingCount: 7,
          readyAt: ALWAYS_READY,
        }),
        ...containerScrapes({
          podUid: "db-0-new-uid",
          fromMs: at(6, 40),
          everySeconds: 30,
          readyAt: NEVER_READY,
        }),
      ],
    };

    expect(await judge({ containers: [series], step: oldDeltaStep() })).toEqual(
      { "db-0/postgres": { fires: true, recovers: false } },
    );
    expect(await judge({ containers: [series] })).toEqual({
      "db-0/postgres": { fires: false, recovers: true },
    });
  });

  test("a count that goes down in the same pod is no restart, and the next is counted from it", async () => {
    /*
     * The node rebooted and its runtime lost the containers: the pod
     * keeps its UID, its container starts again at 0 (6:30). The agent
     * sends nothing for that sample; the restart at 10:55 is one.
     */
    const restartedAfterReboot: Array<Scrape> = containerScrapes({
      podUid: "cache-uid",
      fromMs: WINDOW_START_MS - 2 * MINUTE,
      everySeconds: 30,
      phaseSeconds: 15,
      readyAt: NEVER_READY,
    }).map((scrape: Scrape): Scrape => {
      const afterReboot: boolean = scrape.atMs >= at(6, 30);
      const afterRestart: boolean = scrape.atMs >= at(10, 55);

      return {
        ...scrape,
        containerId: afterRestart ? "c-b" : afterReboot ? "c-a" : "c-old",
        restartCount: afterRestart ? 1 : afterReboot ? 0 : 5,
      };
    });

    const quietAfterReboot: Array<Scrape> = restartedAfterReboot.map(
      (scrape: Scrape): Scrape => {
        return scrape.atMs >= at(10, 55)
          ? { ...scrape, containerId: "c-a", restartCount: 0 }
          : scrape;
      },
    );

    for (const [scrapes, expected] of [
      [quietAfterReboot, { fires: false, recovers: true }],
      [restartedAfterReboot, { fires: true, recovers: false }],
    ] as Array<[Array<Scrape>, Verdict]>) {
      expect(
        await judge({
          containers: [
            {
              namespace: "payments",
              pod: "cache-6b7f-k2m",
              container: "redis",
              scrapes: scrapes,
            },
          ],
        }),
      ).toEqual({ "cache-6b7f-k2m/redis": expected });
    }
  });

  test("a container with a long history that is quiet now recovers", async () => {
    const quiet: ContainerSeries = {
      namespace: "payments",
      pod: "ledger-66f8-q9z",
      container: "ledger",
      scrapes: containerScrapes({
        podUid: "ledger-uid",
        fromMs: WINDOW_START_MS - 2 * MINUTE,
        everySeconds: 30,
        startingCount: 40,
        readyAt: ALWAYS_READY,
      }),
    };

    expect(await judge({ containers: [quiet] })).toEqual({
      "ledger-66f8-q9z/ledger": { fires: false, recovers: true },
    });
  });

  test("a one-off restart of a container that came straight back and stayed ready does not page", async () => {
    const restartAt: number = at(5, 50);
    const oneOff: ContainerSeries = {
      namespace: "payments",
      pod: "web-12ab-c3d",
      container: "web",
      scrapes: containerScrapes({
        podUid: "web-uid",
        fromMs: WINDOW_START_MS - 2 * MINUTE,
        everySeconds: 30,
        phaseSeconds: 5,
        startingCount: 3,
        restartTimesMs: [restartAt],
        readyAt: (atMs: number): number => {
          return atMs > restartAt && atMs < restartAt + 30 * SECOND ? 0 : 1;
        },
      }),
    };

    expect(await judge({ containers: [oneOff] })).toEqual({
      "web-12ab-c3d/web": { fires: false, recovers: true },
    });
  });

  test("judges every container on its own", async () => {
    expect(
      await judge({
        containers: [
          crashLooping({
            pod: "checkout-7d9f-2xk",
            restartTimesMs: BETWEEN_MINUTES,
          }),
          {
            namespace: "payments",
            pod: "ledger-66f8-q9z",
            container: "ledger",
            scrapes: containerScrapes({
              podUid: "ledger-uid",
              fromMs: WINDOW_START_MS - 5 * MINUTE,
              everySeconds: 30,
              startingCount: 2,
              readyAt: ALWAYS_READY,
            }),
          },
        ],
      }),
    ).toEqual({
      "checkout-7d9f-2xk/api": { fires: true, recovers: false },
      "ledger-66f8-q9z/ledger": { fires: false, recovers: true },
    });
  });

  test("a cluster whose agent predates k8s.container.restarts.increase never fires; readiness alone can clear it", async () => {
    /*
     * The reason monitors made from the old template are not rewritten to
     * this query: against an older agent its restart query has no data, so
     * the firing criteria never match. The recovering one still can, on
     * readiness (any one of its filters clears it), so a ready container
     * recovers and a crash-looping one keeps the monitor's status. The
     * docs tell such a cluster to upgrade its agent.
     */
    expect(
      await judge({
        agent: "older",
        containers: [
          crashLooping({
            pod: "checkout-7d9f-2xk",
            restartTimesMs: BETWEEN_MINUTES,
          }),
          {
            namespace: "payments",
            pod: "ledger-66f8-q9z",
            container: "ledger",
            scrapes: containerScrapes({
              podUid: "ledger-uid",
              fromMs: WINDOW_START_MS - 5 * MINUTE,
              everySeconds: 30,
              readyAt: ALWAYS_READY,
            }),
          },
        ],
      }),
    ).toEqual({
      "checkout-7d9f-2xk/api": { fires: false, recovers: false },
      "ledger-66f8-q9z/ledger": { fires: false, recovers: true },
    });
  });

  test("a copy of the Docker agent's processors, keyed by container.id, would count no restart at all", async () => {
    /*
     * Why the chart takes container.id off: every restart is a new
     * container with a new ID, so each ID's series sees one count, its
     * first sample sends nothing, and every later one sends 0.
     */
    const looping: ContainerSeries = crashLooping({
      pod: "checkout-7d9f-2xk",
      restartTimesMs: BETWEEN_MINUTES,
    });
    const keyedById: Array<Point> = agentIncreases(
      looping.scrapes,
      "keyed-by-container-id",
    );

    expect(keyedById.length).toBeGreaterThan(0);
    expect(
      keyedById.every((point: Point): boolean => {
        return point.value === 0;
      }),
    ).toBe(true);
    expect(
      await judge({ agent: "keyed-by-container-id", containers: [looping] }),
    ).toEqual({ "checkout-7d9f-2xk/api": { fires: false, recovers: true } });
  });
});

describe("Kubernetes CrashLoopBackOff Detection: what the old per-minute delta missed, and the increases count", () => {
  test("the same crash loop that the old delta read as no restarts at all", async () => {
    const looping: ContainerSeries = crashLooping({
      pod: "checkout-7d9f-2xk",
      restartTimesMs: BETWEEN_MINUTES,
    });

    expect(
      await judge({ containers: [looping], step: oldDeltaStep() }),
    ).toEqual({ "checkout-7d9f-2xk/api": { fires: false, recovers: true } });
    expect(await judge({ containers: [looping] })).toEqual({
      "checkout-7d9f-2xk/api": { fires: true, recovers: false },
    });
  });

  /*
   * Crash loops of 1 to 8 restarts in the window, at times and scrape
   * phases drawn from a seeded stream, sampled every 30 seconds. The
   * template counts every one of them, so it fires on each; the old delta
   * counted only those that happened to fall between two samples of the
   * same minute.
   */
  test("whenever the restarts happen and whatever the scrape phase, every crash loop fires", async () => {
    const random: SeededRandom = seededRandom(5_453);
    let missedByTheOldDelta: number = 0;

    for (let trial: number = 0; trial < 40; trial++) {
      const restartCount: number = 1 + random(8);
      const restartTimes: Array<number> = [];

      for (let index: number = 0; index < restartCount; index++) {
        // Anywhere from the window's start to a minute before its end.
        restartTimes.push(
          WINDOW_START_MS + random((WINDOW_MINUTES - 1) * 60) * SECOND,
        );
      }

      const looping: ContainerSeries = crashLooping({
        pod: "checkout-7d9f-2xk",
        restartTimesMs: restartTimes,
        phaseSeconds: random(30),
      });
      const label: string = `trial ${trial}: ${restartCount} restarts`;

      expect({
        label,
        verdict: await judge({ containers: [looping] }),
      }).toEqual({
        label,
        verdict: { "checkout-7d9f-2xk/api": { fires: true, recovers: false } },
      });

      const old: Dictionary<Verdict> = await judge({
        containers: [looping],
        step: oldDeltaStep(),
      });

      if (!old["checkout-7d9f-2xk/api"]?.fires) {
        missedByTheOldDelta++;
      }
    }

    // The loops the old template let through, which the sweep exists for.
    expect(missedByTheOldDelta).toBeGreaterThan(0);
  });

  /*
   * Containers that never restart, with lifetime counts, readiness and pod
   * recreations under the same name drawn from a seeded stream. The
   * template never fires on any of them; the old delta fired on some of
   * the recreated pods.
   */
  test("whatever a container's history and however its pod is recreated, no restart never fires", async () => {
    const random: SeededRandom = seededRandom(5_454);
    let firedByTheOldDelta: number = 0;

    for (let trial: number = 0; trial < 30; trial++) {
      const startingCount: number = random(50);
      const recreatedAt: number = at(1 + random(12), random(60));
      const readyFrom: number = at(random(15), 0);
      const readyAt: (atMs: number) => number = (atMs: number): number => {
        return atMs >= readyFrom ? 1 : 0;
      };
      const phaseSeconds: number = random(30);
      const recreated: boolean = trial % 2 === 0;

      const scrapes: Array<Scrape> = recreated
        ? [
            ...containerScrapes({
              podUid: `old-${trial}`,
              fromMs: WINDOW_START_MS - 5 * MINUTE,
              untilMs: recreatedAt - 10 * SECOND,
              everySeconds: 30,
              phaseSeconds: phaseSeconds,
              startingCount: startingCount,
              readyAt: readyAt,
            }),
            ...containerScrapes({
              podUid: `new-${trial}`,
              fromMs: recreatedAt + 10 * SECOND,
              everySeconds: 30,
              readyAt: readyAt,
            }),
          ]
        : containerScrapes({
            podUid: `only-${trial}`,
            fromMs: WINDOW_START_MS - 5 * MINUTE,
            everySeconds: 30,
            phaseSeconds: phaseSeconds,
            startingCount: startingCount,
            readyAt: readyAt,
          });
      const series: ContainerSeries = {
        namespace: "data",
        pod: "db-0",
        container: "postgres",
        scrapes: scrapes,
      };
      const label: string = `trial ${trial}: ${recreated ? "recreated" : "steady"} at ${startingCount}`;

      expect({
        label,
        verdict: await judge({ containers: [series] }),
      }).toEqual({
        label,
        verdict: { "db-0/postgres": { fires: false, recovers: true } },
      });

      const old: Dictionary<Verdict> = await judge({
        containers: [series],
        step: oldDeltaStep(),
      });

      if (old["db-0/postgres"]?.fires) {
        firedByTheOldDelta++;
      }
    }

    // The recreated pods the old template paged on, which the sweep exists for.
    expect(firedByTheOldDelta).toBeGreaterThan(0);
  });
});
