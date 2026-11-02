import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import { CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import { getDockerAlertTemplateById } from "Common/Types/Monitor/DockerAlertTemplates";
import { getPodmanAlertTemplateById } from "Common/Types/Monitor/PodmanAlertTemplates";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * Container Restart Loop on Docker and Podman, from the samples the agent
 * sends to the verdict the worker reaches.
 *
 * The bug: the template read the restart count's growth BETWEEN TWO SAMPLES
 * OF THE SAME MINUTE (a Maximum and a Minimum query per minute, subtracted
 * by a formula and summed over 15 minutes). Growth between two samples in
 * different minutes was never counted: at the agent's 30-second scrape that
 * is about half of every crash loop, and all of it for a container sampled
 * less than twice a minute. And a manual restart, which starts Docker's
 * count again at 0, read as the whole count in one minute.
 *
 * The agent now sends container.restarts.increase with every sample: the
 * restarts since its previous sample of the container, whatever the gap
 * (agents/DockerAgent and agents/PodmanAgent otel-collector-config.yaml,
 * cumulative_to_delta/restarts-increase). The template sums those over the
 * window.
 *
 * Driven through the worker's real Docker and Podman reads and the real
 * criteria evaluator, over rows folded per minute as ClickHouse folds them
 * (SqlGroupedFold). What the agent sends is modelled here exactly as
 * Tests/Ops/container-agent-restarts-behaviour.sh checks the collector does
 * it: a container's first sample sends no increase, nor does a sample whose
 * count went down, and every other one sends its count minus the previous
 * sample's. The cumulative container.restarts is stored too, as the agent
 * still sends it, so a template that still read it would be judged here on
 * the same samples.
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
jest.mock("Common/Server/Services/HostService", () => {
  return {
    __esModule: true,
    default: { getExpectedHostIdentifiers: jest.fn() },
  };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import HostService from "Common/Server/Services/HostService";
import DataToProcess from "Common/Server/Utils/Monitor/DataToProcess";
import MetricMonitorCriteria, {
  MetricSeriesEvaluationResult,
} from "Common/Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import {
  monitorDocker,
  monitorPodman,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
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
const expectedHostIdentifiers: jest.Mock =
  HostService.getExpectedHostIdentifiers as unknown as jest.Mock;

const SECOND: number = 1_000;
const MINUTE: number = 60 * SECOND;

// The end of every evaluated window: the template reads the 15 minutes before.
const WINDOW_END_MS: number = Date.UTC(2026, 9, 31, 12, 0, 0);
const WINDOW_MINUTES: number = 15;
const WINDOW_START_MS: number = WINDOW_END_MS - WINDOW_MINUTES * MINUTE;

const RESTARTS: string = "container.restarts";
const RESTARTS_INCREASE: string = "container.restarts.increase";
const CONTAINER_KEY: string = "resource.container.name";
const HOST: string = "host-01";

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

const templateArgs: {
  hostIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} = {
  hostIdentifier: HOST,
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: HOST,
};

// One reading of a container's restart count, as docker_stats takes it.
interface Scrape {
  atMs: number;
  restartCount: number;
}

interface Point {
  atMs: number;
  value: number;
}

/*
 * What the agent sends for one container: container.restarts as read, and
 * container.restarts.increase - nothing for the first sample, nothing for
 * a sample whose count went down (a manual restart or a recreated
 * container starts Docker's and Podman's count again at 0), else the
 * restarts since the previous sample, however long ago it was.
 */
function agentPoints(scrapes: Array<Scrape>): {
  cumulative: Array<Point>;
  increase: Array<Point>;
} {
  const ordered: Array<Scrape> = [...scrapes].sort(
    (a: Scrape, b: Scrape): number => {
      return a.atMs - b.atMs;
    },
  );
  const increase: Array<Point> = [];
  let previous: Scrape | null = null;

  for (const scrape of ordered) {
    if (previous && scrape.restartCount >= previous.restartCount) {
      increase.push({
        atMs: scrape.atMs,
        value: scrape.restartCount - previous.restartCount,
      });
    }

    previous = scrape;
  }

  return {
    cumulative: ordered.map((scrape: Scrape): Point => {
      return { atMs: scrape.atMs, value: scrape.restartCount };
    }),
    increase: increase,
  };
}

type Agent = "current" | "older";

/*
 * The rows ingest stores for each container's samples, by metric name. An
 * agent from before this change sends container.restarts only.
 */
function storedRows(input: {
  runtime: string;
  containers: Dictionary<Array<Scrape>>;
  agent?: Agent | undefined;
}): Dictionary<Array<StoredMetricRow>> {
  const rows: Dictionary<Array<StoredMetricRow>> = {
    [RESTARTS]: [],
    [RESTARTS_INCREASE]: [],
  };

  for (const name of Object.keys(input.containers)) {
    const attributes: JSONObject = {
      [CONTAINER_KEY]: name,
      "resource.container.runtime": input.runtime,
      "resource.host.name": HOST,
    };
    const points: { cumulative: Array<Point>; increase: Array<Point> } =
      agentPoints(input.containers[name] as Array<Scrape>);

    for (const point of points.cumulative) {
      rows[RESTARTS]!.push({
        time: new Date(point.atMs),
        value: point.value,
        attributes: attributes,
      });
    }

    if (input.agent === "older") {
      continue;
    }

    for (const point of points.increase) {
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
 * Every read of the worker: the rows of the metric it asks for, inside the
 * window it asks for, folded per minute (and per container) by the read's
 * own aggregation.
 */
function givenStored(
  rowsByMetricName: Dictionary<Array<StoredMetricRow>>,
): void {
  metricAggregateBy.mockImplementation(async (args: unknown) => {
    const read: AggregateArgs = args as AggregateArgs;
    reads.push(read);

    const inWindow: Array<StoredMetricRow> = (
      rowsByMetricName[read.query.name] || []
    ).filter((row: StoredMetricRow): boolean => {
      return (
        row.time.getTime() >= read.startTimestamp.getTime() &&
        row.time.getTime() <= read.endTimestamp.getTime()
      );
    });

    return foldRowsAsSqlRead(inWindow, read);
  });
}

type Runtime = "docker" | "podman";

function restartLoopStep(runtime: Runtime): MonitorStep {
  return runtime === "docker"
    ? getDockerAlertTemplateById("docker-restart-loop")!.getMonitorStep(
        templateArgs,
      )
    : getPodmanAlertTemplateById("podman-restart-loop")!.getMonitorStep(
        templateArgs,
      );
}

async function check(
  runtime: Runtime,
  step: MonitorStep,
): Promise<MetricMonitorResponse> {
  const read: (data: {
    monitorStep: MonitorStep;
    monitorId: ObjectID;
    projectId: ObjectID;
    evaluateUntil?: Date | undefined;
  }) => Promise<MetricMonitorResponse> =
    runtime === "docker" ? monitorDocker : monitorPodman;

  return await read({
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

function filterOf(step: MonitorStep, index: number): CriteriaFilter {
  const instances: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
  const instance: MonitorCriteriaInstance = instances[
    index < 0 ? instances.length + index : index
  ] as MonitorCriteriaInstance;

  // A copy: the evaluator writes its context back onto the filter.
  return JSON.parse(
    JSON.stringify(instance.data!.filters[0]),
  ) as CriteriaFilter;
}

/*
 * Each container's verdict: whether the firing criteria (the first) and the
 * recovering one (the last) are met by its series.
 */
async function verdicts(
  step: MonitorStep,
  response: MetricMonitorResponse,
): Promise<Dictionary<Verdict>> {
  const byContainer: Dictionary<Verdict> = {};

  for (const [index, key] of [
    [0, "fires"],
    [-1, "recovers"],
  ] as Array<[number, keyof Verdict]>) {
    const evaluations: Array<MetricSeriesEvaluationResult> =
      await MetricMonitorCriteria.evaluateAllSeries({
        dataToProcess: response as DataToProcess,
        criteriaFilter: filterOf(step, index),
        monitorStep: step,
      });

    for (const evaluation of evaluations) {
      const name: string = String(evaluation.labels[CONTAINER_KEY] ?? "");
      const verdict: Verdict = byContainer[name] || {
        fires: false,
        recovers: false,
      };
      verdict[key] = evaluation.rootCause !== null;
      byContainer[name] = verdict;
    }
  }

  return byContainer;
}

async function judge(input: {
  runtime: Runtime;
  containers: Dictionary<Array<Scrape>>;
  agent?: Agent | undefined;
  step?: MonitorStep | undefined;
}): Promise<Dictionary<Verdict>> {
  givenStored(
    storedRows({
      runtime: input.runtime,
      containers: input.containers,
      agent: input.agent,
    }),
  );

  const step: MonitorStep = input.step || restartLoopStep(input.runtime);

  return await verdicts(step, await check(input.runtime, step));
}

/*
 * Samples every `everySeconds` from `fromMs` up to the window's end, at
 * `phaseSeconds` past each step, with the count each sample reads.
 */
function scrapes(input: {
  fromMs: number;
  everySeconds: number;
  phaseSeconds?: number | undefined;
  countAt: (atMs: number) => number;
  untilMs?: number | undefined;
}): Array<Scrape> {
  const out: Array<Scrape> = [];
  const untilMs: number = input.untilMs ?? WINDOW_END_MS;

  for (
    let atMs: number = input.fromMs + (input.phaseSeconds || 0) * SECOND;
    atMs <= untilMs;
    atMs += input.everySeconds * SECOND
  ) {
    out.push({ atMs: atMs, restartCount: input.countAt(atMs) });
  }

  return out;
}

// How many of the restart times are at or before a moment.
function restartsBy(restartTimesMs: Array<number>): (atMs: number) => number {
  return (atMs: number): number => {
    return restartTimesMs.filter((restartMs: number): boolean => {
      return restartMs <= atMs;
    }).length;
  };
}

// The minute `minute` of the window, plus `seconds`.
function at(minute: number, seconds: number = 0): number {
  return WINDOW_START_MS + minute * MINUTE + seconds * SECOND;
}

// Restarts at 55 seconds past six minutes of the window, one each.
const BETWEEN_MINUTES: Array<number> = [1, 3, 5, 7, 9, 11].map(
  (minute: number): number => {
    return at(minute, 55);
  },
);

beforeEach(() => {
  reads = [];
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricFindBy.mockReset().mockResolvedValue([]);
  // The unit docker_stats declares for both.
  metricTypeFindBy.mockReset().mockResolvedValue([
    { name: RESTARTS, unit: "{restarts}" },
    { name: RESTARTS_INCREASE, unit: "{restarts}" },
  ]);
  expectedHostIdentifiers.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(["docker", "podman"] as Array<Runtime>)(
  "%s: Container Restart Loop",
  (runtime: Runtime) => {
    test("reads the restarts the agent sends with each sample, summed per minute and per container, on this host's runtime", async () => {
      givenStored({});
      const step: MonitorStep = restartLoopStep(runtime);
      const queries: Array<MetricQueryConfigData> =
        MonitorStep.getMetricsViewConfig(step)!.queryConfigs;

      expect(
        queries.map((query: MetricQueryConfigData): string => {
          return query.metricQueryData.filterData.metricName as string;
        }),
      ).toEqual([RESTARTS_INCREASE]);

      await check(runtime, step);

      expect(reads).toHaveLength(1);
      expect(reads[0]!.query.name).toBe(RESTARTS_INCREASE);
      expect(reads[0]!.aggregationType).toBe("Sum");
      expect(reads[0]!.groupByAttributeKeys).toEqual([CONTAINER_KEY]);
      expect(reads[0]!.query.attributes).toEqual(
        expect.objectContaining({
          "resource.host.name": HOST,
          "resource.container.runtime": runtime,
        }),
      );
      expect(reads[0]!.endTimestamp.getTime()).toBe(WINDOW_END_MS);
      expect(
        reads[0]!.endTimestamp.getTime() - reads[0]!.startTimestamp.getTime(),
      ).toBe(WINDOW_MINUTES * MINUTE);
    });

    test("fires on a crash loop whose restarts all fall between two minutes' samples", async () => {
      /*
       * Sampled at :15 and :45 of every minute, restarting at :55: each
       * restart lies between the last sample of one minute and the first
       * of the next. Within any minute the count never moves, so the old
       * per-minute Maximum minus Minimum read 0 restarts all along.
       */
      const looping: Array<Scrape> = scrapes({
        fromMs: WINDOW_START_MS - 5 * MINUTE,
        everySeconds: 30,
        phaseSeconds: 15,
        countAt: restartsBy(BETWEEN_MINUTES),
      });

      expect(await judge({ runtime, containers: { web: looping } })).toEqual({
        web: { fires: true, recovers: false },
      });
    });

    test("fires on a container sampled minutes apart: each sample brings every restart since the last one", async () => {
      /*
       * A container the agent saw four times in the window, the first one
       * four minutes before it: 2, 2 and 3 restarts between samples, none
       * of them two in one minute.
       */
      const rarelySeen: Array<Scrape> = [
        { atMs: at(-4, 10), restartCount: 10 },
        { atMs: at(2, 40), restartCount: 12 },
        { atMs: at(7, 20), restartCount: 14 },
        { atMs: at(13, 50), restartCount: 17 },
      ];

      expect(
        await judge({ runtime, containers: { worker: rarelySeen } }),
      ).toEqual({ worker: { fires: true, recovers: false } });
    });

    test("counts only the restarts sent in the window: three is not a loop, four is", async () => {
      const three: Array<number> = [at(2, 50), at(6, 50), at(10, 50)];
      const four: Array<number> = [...three, at(12, 50)];

      for (const [restarts, expected] of [
        [three, { fires: false, recovers: false }],
        [four, { fires: true, recovers: false }],
      ] as Array<[Array<number>, Verdict]>) {
        const sampled: Array<Scrape> = scrapes({
          fromMs: WINDOW_START_MS - 2 * MINUTE,
          everySeconds: 30,
          phaseSeconds: 5,
          countAt: restartsBy(restarts),
        });

        /*
         * Three restarts sit between the fire threshold (more than 3) and
         * the recovery one (2.7 or fewer, 10% past it): the monitor keeps
         * the status it had.
         */
        expect(await judge({ runtime, containers: { api: sampled } })).toEqual({
          api: expected,
        });
      }
    });

    test("a manual restart, which starts the count again at 0, is no restart at all", async () => {
      /*
       * Restarted by hand at 6:30: Docker and Podman start the count
       * again at 0, between two samples of the same minute. The old
       * per-minute Maximum minus Minimum read that as 5 restarts in one
       * minute, and fired; the agent sends no increase for that sample.
       */
      const restartedByHand: Array<Scrape> = scrapes({
        fromMs: WINDOW_START_MS - 2 * MINUTE,
        everySeconds: 30,
        phaseSeconds: 15,
        countAt: (atMs: number): number => {
          return atMs < at(6, 30) ? 5 : 0;
        },
      });

      expect(
        await judge({ runtime, containers: { cache: restartedByHand } }),
      ).toEqual({ cache: { fires: false, recovers: true } });
    });

    test("a container with a long history that is quiet now recovers", async () => {
      const quiet: Array<Scrape> = scrapes({
        fromMs: WINDOW_START_MS - 2 * MINUTE,
        everySeconds: 30,
        countAt: (): number => {
          return 40;
        },
      });

      expect(await judge({ runtime, containers: { db: quiet } })).toEqual({
        db: { fires: false, recovers: true },
      });
    });

    test("judges every container on its own", async () => {
      expect(
        await judge({
          runtime,
          containers: {
            web: scrapes({
              fromMs: WINDOW_START_MS - 5 * MINUTE,
              everySeconds: 30,
              phaseSeconds: 15,
              countAt: restartsBy(BETWEEN_MINUTES),
            }),
            db: scrapes({
              fromMs: WINDOW_START_MS - 5 * MINUTE,
              everySeconds: 30,
              countAt: (): number => {
                return 2;
              },
            }),
          },
        }),
      ).toEqual({
        web: { fires: true, recovers: false },
        db: { fires: false, recovers: true },
      });
    });

    test("a host whose agent predates container.restarts.increase sends nothing it reads: no verdict either way", async () => {
      /*
       * The reason monitors made from the old template are not rewritten
       * to this query: against an older agent it has no data, and with no
       * data neither criteria matches - the read's one series is the
       * monitor-level one a read with no rows has, with no container - so
       * the monitor keeps its status. The docs tell such a host to update
       * its agent.
       */
      expect(
        await judge({
          runtime,
          agent: "older",
          containers: {
            web: scrapes({
              fromMs: WINDOW_START_MS - 5 * MINUTE,
              everySeconds: 30,
              phaseSeconds: 15,
              countAt: restartsBy(BETWEEN_MINUTES),
            }),
          },
        }),
      ).toEqual({ "": { fires: false, recovers: false } });
    });
  },
);

describe("Container Restart Loop: what the old per-minute delta missed, and the increases count", () => {
  /*
   * The query the template used to build, kept here only to show, on the
   * same samples, what it saw: container.restarts' Maximum minus its
   * Minimum per minute, summed over the window.
   */
  function oldDeltaStep(runtime: Runtime): MonitorStep {
    const step: MonitorStep = restartLoopStep(runtime);
    const config: JSONObject = (runtime === "docker"
      ? step.data!.dockerMonitor
      : step.data!.podmanMonitor) as unknown as JSONObject;
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
            metricName: RESTARTS,
            attributes: {},
            aggegationType: aggregation,
            aggregateBy: {},
          },
          groupByAttributeKeys: [CONTAINER_KEY],
        },
      } as JSONObject;
    };

    config["metricViewConfig"] = {
      queryConfigs: [
        query("container_restarts_max", "Max"),
        query("container_restarts_min", "Min"),
      ],
      formulaConfigs: [
        {
          metricAliasData: {
            metricVariable: "container_restarts",
            title: "Container Restarts (in window)",
            description: "Container Restarts (in window)",
            legend: "Container Restarts (in window)",
            legendUnit: undefined,
          },
          metricFormulaData: {
            metricFormula: "container_restarts_max - container_restarts_min",
          },
        },
      ],
    } as unknown as JSONObject;

    return step;
  }

  test.each(["docker", "podman"] as Array<Runtime>)(
    "%s: the same crash loop that the old delta read as no restarts at all",
    async (runtime: Runtime) => {
      const looping: Array<Scrape> = scrapes({
        fromMs: WINDOW_START_MS - 5 * MINUTE,
        everySeconds: 30,
        phaseSeconds: 15,
        countAt: restartsBy(BETWEEN_MINUTES),
      });

      expect(
        await judge({
          runtime,
          containers: { web: looping },
          step: oldDeltaStep(runtime),
        }),
      ).toEqual({ web: { fires: false, recovers: true } });
      expect(await judge({ runtime, containers: { web: looping } })).toEqual({
        web: { fires: true, recovers: false },
      });
    },
  );

  /*
   * Crash loops of 4 to 12 restarts in the window, at times and scrape
   * phases drawn from a seeded stream, sampled every 30 seconds. The
   * template counts every one of them, so it fires on each; the old delta
   * counted only those that happened to fall between two samples of the
   * same minute.
   */
  test("whenever the restarts happen and whatever the scrape phase, every one of them is counted", async () => {
    const random: SeededRandom = seededRandom(5_450);
    let missedByTheOldDelta: number = 0;

    for (let trial: number = 0; trial < 40; trial++) {
      const restartCount: number = 4 + random(9);
      const restartTimes: Array<number> = [];

      for (let index: number = 0; index < restartCount; index++) {
        // Anywhere from the window's start to two minutes before its end.
        restartTimes.push(
          WINDOW_START_MS + random((WINDOW_MINUTES - 2) * 60) * SECOND,
        );
      }

      const sampled: Array<Scrape> = scrapes({
        fromMs: WINDOW_START_MS - 5 * MINUTE,
        everySeconds: 30,
        phaseSeconds: random(30),
        countAt: restartsBy(restartTimes),
      });
      const label: string = `trial ${trial}: ${restartCount} restarts`;

      expect({
        label,
        verdict: await judge({
          runtime: "docker",
          containers: { web: sampled },
        }),
      }).toEqual({ label, verdict: { web: { fires: true, recovers: false } } });

      const old: Dictionary<Verdict> = await judge({
        runtime: "docker",
        containers: { web: sampled },
        step: oldDeltaStep("docker"),
      });

      if (!old["web"]?.fires) {
        missedByTheOldDelta++;
      }
    }

    // The loops the old template let through, which the sweep exists for.
    expect(missedByTheOldDelta).toBeGreaterThan(0);
  });
});
