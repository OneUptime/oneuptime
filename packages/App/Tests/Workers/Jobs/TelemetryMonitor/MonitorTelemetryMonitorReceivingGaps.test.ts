import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepHostMonitorUtil } from "Common/Types/Monitor/MonitorStepHostMonitor";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import {
  ReceivingGapReason,
  ReceivingPeriod,
} from "Common/Utils/Telemetry/ReceivingGaps";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #2825: a telemetry check never judges a window that holds time
 * OneUptime itself was not receiving. While its window holds a restart, an
 * upgrade or the reconnect grace after one, the check waits - nothing is
 * read, no status changes, nothing opens or resolves. While the ingest queue
 * is behind, the check judges the newest window OneUptime has finished
 * reading instead of one whose data is still in the queue.
 *
 * Driven through the queue entry point the worker runs,
 * processTelemetryMonitorEvaluationFromQueue, with the datastores replaced.
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

jest.mock("Common/Server/Services/LogService", () => {
  return { __esModule: true, default: { countBy: jest.fn() } };
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
import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import HostService from "Common/Server/Services/HostService";
import InstanceReceivingPeriodService from "Common/Server/Services/InstanceReceivingPeriodService";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import TelemetryIngestBacklog from "Common/Server/Utils/Telemetry/TelemetryIngestBacklog";
import ReceivingCoverage, {
  TELEMETRY_EVALUATION_MAX_DEFERRAL_MS,
} from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import { processTelemetryMonitorEvaluationFromQueue } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const SECOND: number = 1_000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

const findOneById: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const logCountBy: jest.Mock = LogService.countBy as unknown as jest.Mock;
const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;
const expectedHosts: jest.Mock =
  HostService.getExpectedHostIdentifiers as unknown as jest.Mock;
const readLedger: jest.Mock =
  InstanceReceivingPeriodService.readLedger as unknown as jest.Mock;

function hostStep(rollingTime: RollingTime): MonitorStep {
  const queryConfig: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cpu",
      title: "cpu",
      description: "cpu",
      legend: "cpu",
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: "system.cpu.utilization",
        attributes: {},
        aggegationType: MetricsAggregationType.Avg,
        aggregateBy: {},
      },
    },
  };

  const step: MonitorStep = new MonitorStep();
  step.setHostMonitor({
    ...MonitorStepHostMonitorUtil.getDefault(),
    hostIdentifier: "web-01",
    rollingTime,
    metricViewConfig: { queryConfigs: [queryConfig], formulaConfigs: [] },
  });
  return step;
}

function logStep(lastXSecondsOfLogs: number): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.setLogMonitor({
    ...MonitorStepLogMonitorUtil.getDefault(),
    lastXSecondsOfLogs,
  });
  return step;
}

function givenMonitor(monitorType: MonitorType, step: MonitorStep): void {
  findOneById.mockResolvedValue({
    id: monitorId,
    _id: monitorId.toString(),
    projectId,
    monitorType,
    monitorSteps: { data: { monitorStepsInstanceArray: [step] } },
  });
}

async function runOnce(): Promise<void> {
  await processTelemetryMonitorEvaluationFromQueue({
    monitorId: monitorId.toString(),
    projectId: projectId.toString(),
    queuedAt: new Date(),
  });
}

// The window the host check read: the query's own InBetween.
function hostWindow(): { start: Date; end: Date } {
  const time: InBetween<Date> = (
    metricAggregateBy.mock.calls[0]![0] as { query: { time: InBetween<Date> } }
  ).query.time;
  return { start: time.startValue as Date, end: time.endValue as Date };
}

function logWindow(): { start: Date; end: Date } {
  const time: InBetween<Date> = (
    logCountBy.mock.calls[0]![0] as { query: { time: InBetween<Date> } }
  ).query.time;
  return { start: time.startValue as Date, end: time.endValue as Date };
}

/*
 * The ledger as the server would read it, relative to now: stretches of
 * receiving [startedAgo, lastReceivingAgo] in milliseconds.
 */
function givenLedger(
  stretches: Array<[startedAgoMs: number, lastReceivingAgoMs: number]>,
): void {
  readLedger.mockImplementation(async () => {
    const now: number = Date.now();
    const periods: Array<ReceivingPeriod> = stretches.map(
      ([startedAgo, lastAgo]: [number, number]) => {
        return {
          startedAt: new Date(now - startedAgo),
          lastReceivingAt: new Date(now - lastAgo),
        };
      },
    );
    const latest: number = Math.max(
      ...periods.map((period: ReceivingPeriod) => {
        return period.lastReceivingAt.getTime();
      }),
    );
    return {
      periods,
      latestReceivingAt: periods.length > 0 ? new Date(latest) : null,
      now: new Date(now),
    };
  });
}

function givenBacklogSince(agoMs: number | null): void {
  jest
    .spyOn(TelemetryIngestBacklog, "getOldestWaitingSince")
    .mockResolvedValue(agoMs === null ? null : new Date(Date.now() - agoMs));
}

beforeEach(() => {
  ReceivingCoverage.clearCache();
  findOneById.mockReset();
  monitorResource.mockReset().mockResolvedValue({});
  logCountBy.mockReset().mockResolvedValue(new PositiveNumber(3));
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricFindBy.mockReset().mockResolvedValue([]);
  metricTypeFindBy.mockReset().mockResolvedValue([]);
  expectedHosts.mockReset().mockResolvedValue([]);
  readLedger.mockReset();
  jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
  givenLedger([[30 * 24 * HOUR, 10 * SECOND]]);
  givenBacklogSince(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A telemetry check and OneUptime's own receiving gaps", () => {
  test("with OneUptime receiving throughout, the check runs on a window that ends now", async () => {
    givenMonitor(MonitorType.Host, hostStep(RollingTime.Past5Minutes));
    const before: number = Date.now();

    await runOnce();

    expect(monitorResource).toHaveBeenCalledTimes(1);
    const window: { start: Date; end: Date } = hostWindow();
    expect(window.end.getTime()).toBeGreaterThanOrEqual(before);
    expect(window.end.getTime() - window.start.getTime()).toBe(5 * MINUTE);
  });

  test("right after a restart the check waits: nothing is read, judged, opened or resolved", async () => {
    // Down from 12 to 3 minutes ago; agents reconnecting until 1 minute ago.
    givenLedger([
      [10 * HOUR, 12 * MINUTE],
      [3 * MINUTE, 10 * SECOND],
    ]);
    givenMonitor(MonitorType.Host, hostStep(RollingTime.Past5Minutes));

    await runOnce();

    expect(metricAggregateBy).not.toHaveBeenCalled();
    expect(metricFindBy).not.toHaveBeenCalled();
    expect(monitorResource).not.toHaveBeenCalled();
  });

  test("once the outage and its grace are behind the window, the check runs again", async () => {
    // Back 10 minutes ago: a 5-minute window is clean.
    givenLedger([
      [10 * HOUR, 25 * MINUTE],
      [10 * MINUTE, 10 * SECOND],
    ]);
    givenMonitor(MonitorType.Host, hostStep(RollingTime.Past5Minutes));

    await runOnce();

    expect(monitorResource).toHaveBeenCalledTimes(1);
  });

  test("a 1-minute check is back sooner than a 5-minute one", async () => {
    // Back 4 minutes ago: the grace ended 2 minutes ago.
    givenLedger([
      [10 * HOUR, 20 * MINUTE],
      [4 * MINUTE, 10 * SECOND],
    ]);

    givenMonitor(MonitorType.Logs, logStep(60));
    await runOnce();
    expect(logCountBy).toHaveBeenCalledTimes(1);
    expect(monitorResource).toHaveBeenCalledTimes(1);

    logCountBy.mockClear();
    monitorResource.mockClear();
    givenMonitor(MonitorType.Logs, logStep(300));
    await runOnce();
    expect(logCountBy).not.toHaveBeenCalled();
    expect(monitorResource).not.toHaveBeenCalled();
  });

  test("while no process records that OneUptime is receiving, every check waits", async () => {
    // The last receiving heartbeat was 6 minutes ago: the gap is still open.
    givenLedger([[10 * HOUR, 6 * MINUTE]]);
    givenMonitor(MonitorType.Logs, logStep(60));

    await runOnce();

    expect(monitorResource).not.toHaveBeenCalled();
  });

  test("a long window waits at most the deferral cap after the outage, then runs with the outage inside it", async () => {
    // A day-long window; OneUptime was down for 10 minutes, back 20 minutes ago.
    givenLedger([
      [10 * 24 * HOUR, 30 * MINUTE],
      [20 * MINUTE, 10 * SECOND],
    ]);
    givenMonitor(MonitorType.Host, hostStep(RollingTime.Past1Hours));

    await runOnce();
    expect(monitorResource).toHaveBeenCalledTimes(1);

    // The same outage, back only 5 minutes ago: still waiting.
    ReceivingCoverage.clearCache();
    monitorResource.mockClear();
    givenLedger([
      [10 * 24 * HOUR, 15 * MINUTE],
      [5 * MINUTE, 10 * SECOND],
    ]);
    await runOnce();
    expect(monitorResource).not.toHaveBeenCalled();
    expect(TELEMETRY_EVALUATION_MAX_DEFERRAL_MS).toBe(15 * MINUTE);
  });

  test("while the ingest queue is behind, the check judges the newest window OneUptime has read", async () => {
    givenBacklogSince(5 * MINUTE);
    givenMonitor(MonitorType.Host, hostStep(RollingTime.Past5Minutes));
    const before: number = Date.now();

    await runOnce();

    expect(monitorResource).toHaveBeenCalledTimes(1);
    const window: { start: Date; end: Date } = hostWindow();
    expect(before - window.end.getTime()).toBeGreaterThanOrEqual(
      5 * MINUTE - SECOND,
    );
    expect(before - window.end.getTime()).toBeLessThan(5 * MINUTE + 5 * SECOND);
    expect(window.end.getTime() - window.start.getTime()).toBe(5 * MINUTE);
  });

  test("the log check's lookback ends where the queue is too", async () => {
    givenBacklogSince(3 * MINUTE);
    givenMonitor(MonitorType.Logs, logStep(120));
    const before: number = Date.now();

    await runOnce();

    const window: { start: Date; end: Date } = logWindow();
    expect(before - window.end.getTime()).toBeGreaterThanOrEqual(
      3 * MINUTE - SECOND,
    );
    expect(window.end.getTime() - window.start.getTime()).toBe(2 * MINUTE);
  });

  test("a queue within the normal ingest lag does not move the window", async () => {
    givenBacklogSince(30 * SECOND);
    givenMonitor(MonitorType.Logs, logStep(60));
    const before: number = Date.now();

    await runOnce();

    expect(logWindow().end.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("a ledger that cannot be read never stops a check (fails open)", async () => {
    readLedger.mockRejectedValue(new Error("connection refused"));
    givenMonitor(MonitorType.Host, hostStep(RollingTime.Past5Minutes));

    await runOnce();

    expect(monitorResource).toHaveBeenCalledTimes(1);
  });

  test("a queue that cannot be read never stops a check either", async () => {
    jest
      .spyOn(TelemetryIngestBacklog, "getOldestWaitingSince")
      .mockRejectedValue(new Error("valkey down"));
    givenMonitor(MonitorType.Logs, logStep(60));

    await runOnce();

    expect(monitorResource).toHaveBeenCalledTimes(1);
  });
});

describe("The plan the job asks for", () => {
  test("asks with the window the monitor's step judges", async () => {
    const plan: jest.SpyInstance = jest.spyOn(
      ReceivingCoverage,
      "planTelemetryEvaluation",
    );

    givenMonitor(MonitorType.Host, hostStep(RollingTime.Past15Minutes));
    await runOnce();
    expect(plan.mock.calls[0]![0]).toEqual({ windowInMs: 15 * MINUTE });

    givenMonitor(MonitorType.Logs, logStep(90));
    await runOnce();
    expect(plan.mock.calls[1]![0]).toEqual({ windowInMs: 90 * SECOND });
  });

  test("a check told to wait for a reconnecting OneUptime reads nothing", async () => {
    jest.spyOn(ReceivingCoverage, "planTelemetryEvaluation").mockResolvedValue({
      evaluate: false,
      evaluateUntil: new Date(),
      isIngestBehind: false,
      deferredBecause: ReceivingGapReason.Reconnecting,
    });
    givenMonitor(MonitorType.Logs, logStep(60));

    await runOnce();

    expect(logCountBy).not.toHaveBeenCalled();
    expect(monitorResource).not.toHaveBeenCalled();
  });
});
