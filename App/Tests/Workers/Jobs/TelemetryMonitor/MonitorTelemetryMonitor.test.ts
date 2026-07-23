import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Search from "Common/Types/BaseDatabase/Search";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import LogMonitorResponse from "Common/Types/Monitor/LogMonitor/LogMonitorResponse";
import TraceMonitorResponse from "Common/Types/Monitor/TraceMonitor/TraceMonitorResponse";
import ExceptionMonitorResponse from "Common/Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * Covers the worker-side half of the "log monitors do not work" fix. A
 * telemetry monitor step saved with no sub-config used to make these workers
 * throw "<type> query/config is missing" on every cycle, so the monitor never
 * evaluated. monitorLogs/monitorTrace/monitorException now fall back to the
 * default config instead; monitorMetric deliberately keeps its guard.
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

/*
 * The worker transitively imports MonitorResource -> MonitorCriteriaEvaluator
 * -> VMAPI -> VMRunner, which loads the native `isolated-vm` addon. None of
 * the functions under test evaluate JavaScript expressions, so stub the VM
 * runner out to keep the module importable in a plain jest environment.
 */
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/LogService", () => {
  return {
    __esModule: true,
    default: { countBy: jest.fn(), existsBy: jest.fn() },
  };
});
jest.mock("Common/Server/Services/SpanService", () => {
  return {
    __esModule: true,
    default: { countBy: jest.fn(), existsBy: jest.fn() },
  };
});
jest.mock("Common/Server/Services/ExceptionInstanceService", () => {
  return { __esModule: true, default: { countBy: jest.fn() } };
});
jest.mock("Common/Server/Services/TelemetryExceptionService", () => {
  return {
    __esModule: true,
    default: { getResolvedOrArchivedFingerprints: jest.fn() },
  };
});

import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import {
  monitorLogs,
  monitorTrace,
  monitorException,
  monitorMetric,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const logCountBy: jest.Mock = LogService.countBy as unknown as jest.Mock;
const logExistsBy: jest.Mock = LogService.existsBy as unknown as jest.Mock;
const spanCountBy: jest.Mock = SpanService.countBy as unknown as jest.Mock;
const spanExistsBy: jest.Mock = SpanService.existsBy as unknown as jest.Mock;
const exceptionCountBy: jest.Mock =
  ExceptionInstanceService.countBy as unknown as jest.Mock;
const resolvedFingerprints: jest.Mock =
  TelemetryExceptionService.getResolvedOrArchivedFingerprints as unknown as jest.Mock;

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

beforeEach(() => {
  logCountBy.mockReset().mockResolvedValue(new PositiveNumber(0));
  logExistsBy.mockReset().mockResolvedValue(false);
  spanCountBy.mockReset().mockResolvedValue(new PositiveNumber(0));
  spanExistsBy.mockReset().mockResolvedValue(false);
  exceptionCountBy.mockReset().mockResolvedValue(new PositiveNumber(0));
  resolvedFingerprints.mockReset().mockResolvedValue([]);
});

describe("monitorLogs", () => {
  test("falls back to the default query when logMonitor config is missing", async () => {
    logCountBy.mockResolvedValue(new PositiveNumber(4));

    // new MonitorStep() has every telemetry sub-config undefined.
    const response: LogMonitorResponse = await monitorLogs({
      monitorStep: new MonitorStep(),
      monitorId,
      projectId,
    });

    expect(response.logCount).toBe(4);
    expect(logCountBy).toHaveBeenCalledTimes(1);

    /*
     * The default query is the minimal "recent logs" query: a time window,
     * scoped to the project, with no over-scoping filters.
     */
    const passedQuery: Record<string, unknown> = logCountBy.mock.calls[0]![0]
      .query as Record<string, unknown>;
    expect(passedQuery["time"]).toBeInstanceOf(InBetween);
    expect(passedQuery["projectId"]).toBeDefined();
    expect(passedQuery["primaryEntityId"]).toBeUndefined();
    expect(passedQuery["body"]).toBeUndefined();
  });

  test("uses the saved config when present", async () => {
    logCountBy.mockResolvedValue(new PositiveNumber(1));

    const step: MonitorStep = new MonitorStep();
    step.setLogMonitor({
      ...MonitorStepLogMonitorUtil.getDefault(),
      body: "connection refused",
    });

    await monitorLogs({ monitorStep: step, monitorId, projectId });

    const passedQuery: Record<string, unknown> = logCountBy.mock.calls[0]![0]
      .query as Record<string, unknown>;
    expect(passedQuery["body"]).toBeInstanceOf(Search);
    expect((passedQuery["body"] as Search<string>).value).toBe(
      "connection refused",
    );
  });
});

describe("monitorTrace", () => {
  test("falls back to the default query when traceMonitor config is missing", async () => {
    spanCountBy.mockResolvedValue(new PositiveNumber(2));

    const response: TraceMonitorResponse = await monitorTrace({
      monitorStep: new MonitorStep(),
      monitorId,
      projectId,
    });

    expect(response.spanCount).toBe(2);
    const passedQuery: Record<string, unknown> = spanCountBy.mock.calls[0]![0]
      .query as Record<string, unknown>;
    expect(passedQuery["startTime"]).toBeInstanceOf(InBetween);
  });
});

/*
 * Guards the "unreliable count()" fix: a telemetry count() over a large
 * ClickHouse table can return 0 while rows exist (e.g. an unmaterialized
 * aggregate projection). A raw 0 would silently disable the monitor, so the
 * worker confirms a 0 with a cheap existsBy() scan and treats a present-but-
 * uncounted result as >=1 so existence criteria still fire.
 */
describe("unreliable count() guard", () => {
  test("monitorLogs: count()==0 but logs exist -> treats as 1", async () => {
    logCountBy.mockResolvedValue(new PositiveNumber(0));
    logExistsBy.mockResolvedValue(true);

    const response: LogMonitorResponse = await monitorLogs({
      monitorStep: new MonitorStep(),
      monitorId,
      projectId,
    });

    expect(response.logCount).toBe(1);
    expect(logExistsBy).toHaveBeenCalledTimes(1);
  });

  test("monitorLogs: count()==0 and no logs exist -> stays 0", async () => {
    logCountBy.mockResolvedValue(new PositiveNumber(0));
    logExistsBy.mockResolvedValue(false);

    const response: LogMonitorResponse = await monitorLogs({
      monitorStep: new MonitorStep(),
      monitorId,
      projectId,
    });

    expect(response.logCount).toBe(0);
    expect(logExistsBy).toHaveBeenCalledTimes(1);
  });

  test("monitorLogs: count()>0 -> trusts count, no existsBy fallback", async () => {
    logCountBy.mockResolvedValue(new PositiveNumber(7));

    const response: LogMonitorResponse = await monitorLogs({
      monitorStep: new MonitorStep(),
      monitorId,
      projectId,
    });

    expect(response.logCount).toBe(7);
    expect(logExistsBy).not.toHaveBeenCalled();
  });

  test("monitorTrace: count()==0 but spans exist -> treats as 1", async () => {
    spanCountBy.mockResolvedValue(new PositiveNumber(0));
    spanExistsBy.mockResolvedValue(true);

    const response: TraceMonitorResponse = await monitorTrace({
      monitorStep: new MonitorStep(),
      monitorId,
      projectId,
    });

    expect(response.spanCount).toBe(1);
    expect(spanExistsBy).toHaveBeenCalledTimes(1);
  });
});

describe("monitorException", () => {
  test("falls back to the default query when exceptionMonitor config is missing", async () => {
    exceptionCountBy.mockResolvedValue(new PositiveNumber(3));

    const response: ExceptionMonitorResponse = await monitorException({
      monitorStep: new MonitorStep(),
      monitorId,
      projectId,
    });

    expect(response.exceptionCount).toBe(3);
    expect(exceptionCountBy).toHaveBeenCalledTimes(1);
  });
});

describe("monitorMetric", () => {
  test("still throws when metricMonitor config is missing (guard preserved)", async () => {
    await expect(
      monitorMetric({
        monitorStep: new MonitorStep(),
        monitorId,
        projectId,
      }),
    ).rejects.toThrow("Metric config is missing");
  });
});
