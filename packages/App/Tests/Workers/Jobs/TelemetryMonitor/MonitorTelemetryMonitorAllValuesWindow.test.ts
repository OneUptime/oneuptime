import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregateModel from "Common/Types/BaseDatabase/AggregatedModel";
import { JSONObject } from "Common/Types/JSON";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import { MonitorStepMetricMonitorUtil } from "Common/Types/Monitor/MonitorStepMetricMonitor";
import { MonitorStepKubernetesMonitorUtil } from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import { MonitorStepDockerMonitorUtil } from "Common/Types/Monitor/MonitorStepDockerMonitor";
import { MonitorStepHostMonitorUtil } from "Common/Types/Monitor/MonitorStepHostMonitor";
import { MonitorStepPodmanMonitorUtil } from "Common/Types/Monitor/MonitorStepPodmanMonitor";
import { MonitorStepDockerSwarmMonitorUtil } from "Common/Types/Monitor/MonitorStepDockerSwarmMonitor";
import { MonitorStepProxmoxMonitorUtil } from "Common/Types/Monitor/MonitorStepProxmoxMonitor";
import { MonitorStepVMwareMonitorUtil } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import { MonitorStepCephMonitorUtil } from "Common/Types/Monitor/MonitorStepCephMonitor";
import { MonitorStepStorageArrayMonitorUtil } from "Common/Types/Monitor/MonitorStepStorageArrayMonitor";
import { MonitorStepIoTMonitorUtil } from "Common/Types/Monitor/MonitorStepIoTMonitor";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #4793 for every monitor type evaluated as metric series - from
 * MonitorTypeHelper's one list, so a new one is covered the day it joins.
 *
 * Driven through the queue entry point the worker runs,
 * processTelemetryMonitorEvaluationFromQueue, with the datastores replaced:
 * the worker reads one grouped query over a 15-minute window, and its
 * response then goes through the real MetricMonitorCriteria with an "All
 * Values > 0" criteria. Two series meet the condition: "steady", reporting
 * every minute of the window, and "fresh", whose first data point is a
 * minute old. Only "steady" covers the window.
 *
 * The data is generated over the very window each read asks for, so
 * nothing here depends on what time it is.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn(), getQueue: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), findAllBy: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return { __esModule: true, default: { monitorResource: jest.fn() } };
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

jest.mock("Common/Server/Services/IoTFleetService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IoTDeviceCredentialService", () => {
  return {
    __esModule: true,
    default: { getExpectedDeviceExternalIds: jest.fn() },
  };
});

jest.mock("Common/Server/Services/InstanceReceivingPeriodService", () => {
  return { __esModule: true, default: { readLedger: jest.fn() } };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import HostService from "Common/Server/Services/HostService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import InstanceReceivingPeriodService from "Common/Server/Services/InstanceReceivingPeriodService";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import TelemetryIngestBacklog from "Common/Server/Utils/Telemetry/TelemetryIngestBacklog";
import ReceivingCoverage from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import DataToProcess from "Common/Server/Utils/Monitor/DataToProcess";
import MetricMonitorCriteria, {
  MetricSeriesEvaluationResult,
} from "Common/Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import {
  GROUPED_READ_ROW_LIMIT,
  getCutReadCompleteFrom,
  processTelemetryMonitorEvaluationFromQueue,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const SECOND: number = 1_000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;

const SERIES_KEY: string = "series.key";

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

const findOneById: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;
const expectedHosts: jest.Mock =
  HostService.getExpectedHostIdentifiers as unknown as jest.Mock;
const iotFleetFindOneBy: jest.Mock =
  IoTFleetService.findOneBy as unknown as jest.Mock;
const readLedger: jest.Mock =
  InstanceReceivingPeriodService.readLedger as unknown as jest.Mock;

// One grouped query, "a", over the window under test.
const VIEW: MetricsViewConfig = {
  queryConfigs: [
    {
      metricAliasData: {
        metricVariable: "a",
        title: "Queue Depth",
        description: undefined,
        legend: undefined,
        legendUnit: undefined,
      },
      metricQueryData: {
        filterData: {
          metricName: "test.queue.depth",
          attributes: {},
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
        groupByAttributeKeys: [SERIES_KEY],
      },
    },
  ],
  formulaConfigs: [],
};

const ROLLING_TIME: RollingTime = RollingTime.Past15Minutes;

// "All Values of Queue Depth > 0".
const ALL_VALUES_ABOVE_ZERO: CriteriaFilter = {
  checkOn: CheckOn.MetricValue,
  filterType: FilterType.GreaterThan,
  value: 0,
  metricMonitorOptions: {
    metricAlias: "a",
    metricAggregationType: EvaluateOverTimeType.AllValues,
  },
};

/*
 * The step of one metric-backed monitor type, reading VIEW over the window.
 * Each type keeps its config under a key of its own; a type this does not
 * know fails, so a new metric-backed type cannot slip past this suite.
 */
function stepFor(monitorType: MonitorType): MonitorStep {
  const step: MonitorStep = new MonitorStep();

  switch (monitorType) {
    case MonitorType.Metrics:
      return step.setMetricMonitor({
        ...MonitorStepMetricMonitorUtil.getDefault(),
        metricViewConfig: VIEW,
        rollingTime: ROLLING_TIME,
      });
    case MonitorType.Kubernetes:
      return step.setKubernetesMonitor({
        ...MonitorStepKubernetesMonitorUtil.getDefault(),
        clusterIdentifier: "prod",
        metricViewConfig: VIEW,
        rollingTime: ROLLING_TIME,
      });
    case MonitorType.Docker:
      return step.setDockerMonitor({
        ...MonitorStepDockerMonitorUtil.getDefault(),
        metricViewConfig: VIEW,
        rollingTime: ROLLING_TIME,
      });
    case MonitorType.Host:
      return step.setHostMonitor({
        ...MonitorStepHostMonitorUtil.getDefault(),
        metricViewConfig: VIEW,
        rollingTime: ROLLING_TIME,
      });
    case MonitorType.Podman:
      return step.setPodmanMonitor({
        ...MonitorStepPodmanMonitorUtil.getDefault(),
        metricViewConfig: VIEW,
        rollingTime: ROLLING_TIME,
      });
    case MonitorType.DockerSwarm:
      return step.setDockerSwarmMonitor({
        ...MonitorStepDockerSwarmMonitorUtil.getDefault(),
        metricViewConfig: VIEW,
        rollingTime: ROLLING_TIME,
      });
    case MonitorType.Proxmox:
      return step.setProxmoxMonitor({
        ...MonitorStepProxmoxMonitorUtil.getDefault(),
        metricViewConfig: VIEW,
        rollingTime: ROLLING_TIME,
      });
    case MonitorType.VMware:
      return step.setVMwareMonitor({
        ...MonitorStepVMwareMonitorUtil.getDefault(),
        metricViewConfig: VIEW,
        rollingTime: ROLLING_TIME,
      });
    case MonitorType.Ceph:
      return step.setCephMonitor({
        ...MonitorStepCephMonitorUtil.getDefault(),
        metricViewConfig: VIEW,
        rollingTime: ROLLING_TIME,
      });
    case MonitorType.StorageArray:
      return step.setStorageArrayMonitor({
        ...MonitorStepStorageArrayMonitorUtil.getDefault(),
        arrayIdentifier: "pure-prod-01",
        metricViewConfig: VIEW,
        rollingTime: ROLLING_TIME,
      });
    case MonitorType.IoTDevice:
      return step.setIoTMonitor({
        ...MonitorStepIoTMonitorUtil.getDefault(),
        fleetIdentifier: "fleet-1",
        metricViewConfig: VIEW,
        rollingTime: ROLLING_TIME,
      });
    default:
      throw new Error(
        `${monitorType} is metric-backed but this suite builds no step for it`,
      );
  }
}

function windowOf(range: { startValue: unknown; endValue: unknown }): {
  startMs: number;
  endMs: number;
} {
  return {
    startMs: new Date(range.startValue as Date).getTime(),
    endMs: new Date(range.endValue as Date).getTime(),
  };
}

/*
 * The rows a series holds over a window: one a minute, the newest first,
 * from `minutesBack` minutes before the end of the window (or its start).
 */
function seriesRows(input: {
  name: string;
  window: { startMs: number; endMs: number };
  minutesBack: number | null;
}): Array<{ timeMs: number; name: string }> {
  const fromMs: number =
    input.minutesBack === null
      ? input.window.startMs
      : input.window.endMs - input.minutesBack * MINUTE;
  const rows: Array<{ timeMs: number; name: string }> = [];

  for (let timeMs: number = input.window.endMs; timeMs >= fromMs; ) {
    rows.push({ timeMs, name: input.name });
    timeMs -= MINUTE;
  }

  return rows;
}

/*
 * What the store holds over a window:
 *   - "steady-and-fresh": "steady" all of it, "fresh" its last minute;
 *   - "cut": those, plus enough filler series over the last five
 *     minutes - a minute each of them - that the grouped read, a row per
 *     series and minute, stops at its limit;
 *   - "slow-fleet": series that report less often than the window is
 *     long, one row each - "slow-inside" seven minutes before its end,
 *     "slow-new" at its very end, "slow-leaving" ten seconds after its
 *     start. "slow-new" sits at the end, not a few seconds before it, so
 *     it shares the end's minute whatever second the check runs at: a
 *     row from the previous minute would make it "1 of 15 minutes so far"
 *     in a check run in a minute's first seconds;
 *   - "late": series whose data all arrives late, one row a minute from
 *     the window's start - "late-steady" to five minutes before its end,
 *     "late-stopped" to nine minutes before it.
 */
type StoreShape = "steady-and-fresh" | "cut" | "slow-fleet" | "late";

/*
 * One row a minute, the newest first, from `lagMinutes` before the end of
 * the window back to its start.
 */
function lateRows(input: {
  name: string;
  window: { startMs: number; endMs: number };
  lagMinutes: number;
}): Array<{ timeMs: number; name: string }> {
  const rows: Array<{ timeMs: number; name: string }> = [];

  for (
    let timeMs: number = input.window.endMs - input.lagMinutes * MINUTE;
    timeMs >= input.window.startMs;
    timeMs -= MINUTE
  ) {
    rows.push({ timeMs, name: input.name });
  }

  return rows;
}

function storedRows(input: {
  window: { startMs: number; endMs: number };
  shape: StoreShape;
}): Array<{ timeMs: number; name: string }> {
  if (input.shape === "late") {
    return [
      ...lateRows({ name: "late-steady", window: input.window, lagMinutes: 5 }),
      ...lateRows({
        name: "late-stopped",
        window: input.window,
        lagMinutes: 9,
      }),
    ].sort((a: { timeMs: number }, b: { timeMs: number }) => {
      return b.timeMs - a.timeMs;
    });
  }

  if (input.shape === "slow-fleet") {
    return [
      { timeMs: input.window.endMs, name: "slow-new" },
      { timeMs: input.window.endMs - 7 * MINUTE, name: "slow-inside" },
      { timeMs: input.window.startMs + 10 * SECOND, name: "slow-leaving" },
    ];
  }

  const rows: Array<{ timeMs: number; name: string }> = [
    ...seriesRows({ name: "steady", window: input.window, minutesBack: null }),
    ...seriesRows({ name: "fresh", window: input.window, minutesBack: 1 }),
  ];

  if (input.shape === "cut") {
    /*
     * A grouped read's row limit of series-minutes, over the newest five
     * minutes: FILLER_SERIES series, each in one of those minutes. With
     * steady's and fresh's minutes there too, a read stops a few minutes
     * back.
     */
    for (let index: number = 0; index < GROUPED_READ_ROW_LIMIT; index++) {
      rows.push({
        timeMs: input.window.endMs - Math.floor(index / FILLER_SERIES) * MINUTE,
        name: `filler-${index % FILLER_SERIES}`,
      });
    }
  }

  return rows.sort((a: { timeMs: number }, b: { timeMs: number }) => {
    return b.timeMs - a.timeMs;
  });
}

// Filler series of the "cut" shape: each holds one minute of the five.
const FILLER_SERIES: number = GROUPED_READ_ROW_LIMIT / 5;

let storeShape: StoreShape = "steady-and-fresh";
// The time of the oldest row a cut read returned.
let oldestReturnedMs: number | null = null;

function givenStore(shape: StoreShape): void {
  storeShape = shape;
  oldestReturnedMs = null;

  /*
   * The affected resources' scan (limit 100): raw rows. No grouped read
   * reads raw rows any more.
   */
  metricFindBy.mockImplementation(async (args: unknown) => {
    const findBy: {
      query: { time: { startValue: unknown; endValue: unknown } };
      limit: number;
    } = args as {
      query: { time: { startValue: unknown; endValue: unknown } };
      limit: number;
    };
    const rows: Array<{ timeMs: number; name: string }> = storedRows({
      window: windowOf(findBy.query.time),
      shape: storeShape,
    }).slice(0, findBy.limit);

    return rows.map((row: { timeMs: number; name: string }) => {
      return {
        time: new Date(row.timeMs),
        value: 5,
        attributes: { [SERIES_KEY]: row.name },
      };
    });
  });

  /*
   * Every monitor type's grouped SQL read: one row per minute and series,
   * newest first, up to the read's limit.
   */
  metricAggregateBy.mockImplementation(
    async (args: unknown): Promise<AggregatedResult> => {
      const aggregate: {
        startTimestamp: Date;
        endTimestamp: Date;
        limit: number;
      } = args as { startTimestamp: Date; endTimestamp: Date; limit: number };
      const buckets: Map<string, AggregateModel> = new Map();

      for (const row of storedRows({
        window: {
          startMs: aggregate.startTimestamp.getTime(),
          endMs: aggregate.endTimestamp.getTime(),
        },
        shape: storeShape,
      })) {
        const bucketMs: number = Math.floor(row.timeMs / MINUTE) * MINUTE;
        const key: string = `${row.name}|${bucketMs}`;
        if (!buckets.has(key)) {
          buckets.set(key, {
            timestamp: new Date(bucketMs),
            value: 5,
            attributes: { [SERIES_KEY]: row.name } as JSONObject,
          });
        }
      }

      const data: Array<AggregateModel> = Array.from(buckets.values())
        .sort((a: AggregateModel, b: AggregateModel) => {
          return b.timestamp.getTime() - a.timestamp.getTime();
        })
        .slice(0, aggregate.limit);

      if (data.length === aggregate.limit) {
        oldestReturnedMs = data[data.length - 1]!.timestamp.getTime();
      }

      return { data };
    },
  );
}

// Runs one check of the monitor and hands back the worker's response.
async function checkOnce(
  monitorType: MonitorType,
): Promise<MetricMonitorResponse> {
  findOneById.mockResolvedValue({
    id: monitorId,
    _id: monitorId.toString(),
    projectId,
    monitorType,
    monitorSteps: {
      data: { monitorStepsInstanceArray: [stepFor(monitorType)] },
    },
  });

  await processTelemetryMonitorEvaluationFromQueue({
    monitorId: monitorId.toString(),
    projectId: projectId.toString(),
    queuedAt: new Date(),
  });

  expect(monitorResource).toHaveBeenCalledTimes(1);
  return monitorResource.mock.calls[0]![0] as MetricMonitorResponse;
}

async function verdicts(
  monitorType: MonitorType,
  response: MetricMonitorResponse,
  names: Array<string> = ["steady", "fresh"],
): Promise<Record<string, string>> {
  const evaluations: Array<MetricSeriesEvaluationResult> =
    await MetricMonitorCriteria.evaluateAllSeries({
      dataToProcess: response as DataToProcess,
      criteriaFilter: JSON.parse(JSON.stringify(ALL_VALUES_ABOVE_ZERO)),
      monitorStep: stepFor(monitorType),
    });

  const byName: Record<string, string> = {};
  for (const evaluation of evaluations) {
    const name: string = String(evaluation.labels[SERIES_KEY]);
    if (names.includes(name)) {
      byName[name] = evaluation.rootCause
        ? "fires"
        : evaluation.context.windowWait?.message || "not met";
    }
  }
  return byName;
}

beforeEach(() => {
  ReceivingCoverage.clearCache();
  findOneById.mockReset();
  monitorResource.mockReset().mockResolvedValue({});
  metricAggregateBy.mockReset();
  metricFindBy.mockReset();
  metricTypeFindBy.mockReset().mockResolvedValue([]);
  expectedHosts.mockReset().mockResolvedValue([]);
  iotFleetFindOneBy.mockReset().mockResolvedValue(null);
  // OneUptime receiving throughout: every check runs.
  readLedger.mockReset().mockImplementation(async () => {
    const now: number = Date.now();
    return {
      periods: [
        {
          startedAt: new Date(now - 30 * 24 * HOUR),
          lastReceivingAt: new Date(now - 10 * SECOND),
        },
      ],
      latestReceivingAt: new Date(now - 10 * SECOND),
      now: new Date(now),
    };
  });
  jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
  jest
    .spyOn(TelemetryIngestBacklog, "getOldestWaitingSince")
    .mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getCutReadCompleteFrom: where a read cut at its row limit becomes complete", () => {
  const at: (minutesAgo: number) => Date = (minutesAgo: number): Date => {
    return new Date(Date.UTC(2026, 9, 16, 12, 15) - minutesAgo * MINUTE);
  };

  test("a read that returned fewer rows than its limit was whole", () => {
    expect(
      getCutReadCompleteFrom({ times: [at(0), at(5)], limit: 3 }),
    ).toBeNull();
    expect(getCutReadCompleteFrom({ times: [], limit: 3 })).toBeNull();
  });

  test("a read that returned its limit is complete from its oldest row, in any order", () => {
    expect(
      getCutReadCompleteFrom({ times: [at(1), at(4), at(2)], limit: 3 }),
    ).toEqual(at(4));
  });

  test("reads the times rows arrive with, and skips those it cannot", () => {
    // moment warns about the string it cannot read.
    jest.spyOn(console, "warn").mockImplementation(() => {
      return undefined;
    });

    expect(
      getCutReadCompleteFrom({
        times: [at(1).toISOString(), undefined, "not a time", at(3)],
        limit: 4,
      }),
    ).toEqual(at(3));
    expect(
      getCutReadCompleteFrom({ times: [undefined, undefined], limit: 2 }),
    ).toBeNull();
  });
});

describe("every metric-backed monitor type: All Values waits for a series to cover the window (#4793)", () => {
  const types: Array<MonitorType> =
    MonitorTypeHelper.getMetricBackedMonitorTypes();

  test("the list is the one MonitorTypeHelper keeps, and this suite builds a step for each", () => {
    expect(types.length).toBeGreaterThan(0);
    for (const monitorType of types) {
      expect(MonitorStep.getMetricsViewConfig(stepFor(monitorType))).toEqual(
        VIEW,
      );
    }
  });

  test.each(types)(
    "%s: the worker hands over the window it read, and a whole read says nothing more",
    async (monitorType: MonitorType) => {
      givenStore("steady-and-fresh");
      const before: number = Date.now();

      const response: MetricMonitorResponse = await checkOnce(monitorType);
      const window: { startMs: number; endMs: number } = windowOf(
        response.startAndEndDate as unknown as {
          startValue: unknown;
          endValue: unknown;
        },
      );

      expect(window.endMs).toBeGreaterThanOrEqual(before);
      expect(window.endMs).toBeLessThanOrEqual(Date.now());
      expect(window.endMs - window.startMs).toBe(15 * MINUTE);
      expect(response.dataCompleteFrom).toBeUndefined();
    },
  );

  test.each(types)(
    "%s: the series reporting all along fires; the one a minute old waits",
    async (monitorType: MonitorType) => {
      givenStore("steady-and-fresh");

      const response: MetricMonitorResponse = await checkOnce(monitorType);

      expect(await verdicts(monitorType, response)).toEqual({
        steady: "fires",
        fresh: expect.stringContaining(
          "Waiting for 15 minutes of data: 1 of 15 minutes so far.",
        ),
      });
    },
  );

  test.each(types)(
    "%s: a read cut at its row limit reports where it is complete, and the window is judged from there",
    async (monitorType: MonitorType) => {
      givenStore("cut");

      const response: MetricMonitorResponse = await checkOnce(monitorType);

      expect(oldestReturnedMs).not.toBeNull();
      expect(response.dataCompleteFrom?.getTime()).toBe(oldestReturnedMs);

      /*
       * "steady" seems to begin where the read stops - within the last
       * five minutes - and still covers the window from there; "fresh"
       * still waits, and says what could be read.
       */
      const byName: Record<string, string> = await verdicts(
        monitorType,
        response,
      );
      expect(byName["steady"]).toBe("fires");
      expect(byName["fresh"]).toContain("Only the newest");
      expect(byName["fresh"]).toContain(
        "of the 15-minute time range could be read",
      );
    },
  );

  /*
   * A collector or device that reports less often than the window is
   * long has one data point in it at most, and none of its series shows
   * how often they report: a lone data point inside the window is taken
   * for it, as before #4793, so such a monitor still fires. One only just
   * in still waits - its series may be new - and so does one about to
   * leave the window, the last of a series that stopped.
   */
  test.each(types)(
    "%s: series reporting less often than the window - a lone data point inside it fires; one just in, or about to leave, waits",
    async (monitorType: MonitorType) => {
      givenStore("slow-fleet");

      const response: MetricMonitorResponse = await checkOnce(monitorType);

      expect(
        await verdicts(monitorType, response, [
          "slow-inside",
          "slow-new",
          "slow-leaving",
        ]),
      ).toEqual({
        "slow-inside": "fires",
        "slow-new": expect.stringContaining(
          "Waiting for 15 minutes of data: less than a minute of 15 minutes so far.",
        ),
        "slow-leaving": expect.stringContaining(
          "Waiting for 15 minutes of data: no new data point for the last",
        ),
      });
    },
  );

  /*
   * A source whose data all arrives late - CloudWatch's newest point is 11
   * to 16 minutes old - reaches only part of the way to the end of the
   * window. A Metrics monitor reads any source, so it judges its series
   * fresh against its own newest data point: "late-steady" fires, and only
   * "late-stopped", whose data stopped four minutes before the other's,
   * waits. The infrastructure monitors read OneUptime's own collectors,
   * which send what they read as they read it, so there both wait.
   */
  test.each(types)(
    "%s: data that all arrives late - a Metrics monitor judges it as far as it reaches, an infrastructure monitor waits",
    async (monitorType: MonitorType) => {
      givenStore("late");

      const response: MetricMonitorResponse = await checkOnce(monitorType);
      const byName: Record<string, string> = await verdicts(
        monitorType,
        response,
        ["late-steady", "late-stopped"],
      );

      expect(byName["late-stopped"]).toContain(
        "Waiting for 15 minutes of data: no new data point for the last 8 minutes.",
      );

      if (monitorType === MonitorType.Metrics) {
        expect(byName["late-steady"]).toBe("fires");
      } else {
        expect(byName["late-steady"]).toContain(
          "Waiting for 15 minutes of data: no new data point for the last 4 minutes.",
        );
      }
    },
  );
});
