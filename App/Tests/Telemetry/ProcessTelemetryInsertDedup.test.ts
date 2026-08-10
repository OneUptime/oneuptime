import { afterEach, describe, expect, test, beforeEach } from "@jest/globals";

/*
 * Coverage for the per-job insert-dedup policy on the telemetry worker:
 *
 * 1. The shouldUseInsertDedup matrix — high-volume OTLP signals (traces /
 *    logs / metrics) never open a runWithInsertDedup scope, low-volume
 *    fan-in types keep per-job tokens, and the buffer-sharing /
 *    session-replay types never get them.
 *
 * 2. The handler wiring: a traces job must run OUTSIDE any dedup scope —
 *    nextInsertDedupToken() returns undefined inside the ingest service,
 *    which is what lets TelemetryFanInWriter merge submissions from many
 *    jobs into one ClickHouse INSERT per table per flush window — while a
 *    syslog job still observes deterministic "<jobId>:<table>:<chunk>"
 *    tokens.
 *
 * Same harness as ProcessTelemetryBodyLifecycle.test.ts: capture the worker
 * handler by mocking QueueWorker.getWorker and stub the ingest services; the
 * insert-dedup AsyncLocalStorage context runs for real.
 */

let capturedHandler: ((job: unknown) => Promise<void>) | null = null;

jest.mock("Common/Server/Infrastructure/QueueWorker", () => {
  return {
    __esModule: true,
    default: {
      getWorker: (
        _name: unknown,
        handler: (job: unknown) => Promise<void>,
      ): void => {
        capturedHandler = handler;
      },
    },
  };
});

const processTracesFromQueue: jest.Mock = jest.fn();
jest.mock("../../FeatureSet/Telemetry/Services/OtelTracesIngestService", () => {
  return {
    __esModule: true,
    default: { processTracesFromQueue },
  };
});

const processSyslogFromQueue: jest.Mock = jest.fn();
jest.mock("../../FeatureSet/Telemetry/Services/SyslogIngestService", () => {
  return {
    __esModule: true,
    default: { processSyslogFromQueue },
  };
});

const deleteBody: jest.Mock = jest.fn();
jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: { deleteBody, readBody: jest.fn(), storeBody: jest.fn() },
  };
});

jest.mock(
  "isolated-vm",
  () => {
    const Isolate: jest.Mock = jest.fn();
    const Reference: jest.Mock = jest.fn();
    const Callback: jest.Mock = jest.fn();
    const ExternalCopy: jest.Mock = jest
      .fn()
      .mockImplementation((value: unknown) => {
        return {
          copyInto: jest.fn(() => {
            return value;
          }),
        };
      });

    return {
      __esModule: true,
      default: {
        Isolate,
        Reference,
        Callback,
        ExternalCopy,
      },
      Isolate,
      Reference,
      Callback,
      ExternalCopy,
    };
  },
  { virtual: true },
);

// Importing the module registers the worker via the mocked QueueWorker.
import { shouldUseInsertDedup } from "../../FeatureSet/Telemetry/Jobs/TelemetryIngest/ProcessTelemetry";
import { TelemetryType } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import OtelPayloadDecoder from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import { nextInsertDedupToken } from "Common/Server/Services/AnalyticsDatabaseService";

const PROJECT_ID: string = "11111111-1111-1111-1111-111111111111";
const TRACES_JOB_ID: string = `traces-${PROJECT_ID}-1-abc`;
const SYSLOG_JOB_ID: string = `syslog-${PROJECT_ID}-2-def`;

function tracesJob(): unknown {
  return {
    id: TRACES_JOB_ID,
    name: "ProcessTelemetry",
    data: {
      type: "traces",
      projectId: PROJECT_ID,
      bodyKey: "telemetry:body:k1",
      bodyFormat: "json",
      bodyEncoding: "none",
      productType: "Traces",
      requestHeaders: {},
    },
  };
}

function syslogJob(): unknown {
  return {
    id: SYSLOG_JOB_ID,
    name: "ProcessTelemetry",
    data: {
      type: "syslog",
      projectId: PROJECT_ID,
      requestBody: { message: "hello" },
      requestHeaders: {},
    },
  };
}

describe("shouldUseInsertDedup — per-type policy matrix", () => {
  const HIGH_VOLUME: Array<TelemetryType> = [
    TelemetryType.Traces,
    TelemetryType.Logs,
    TelemetryType.Metrics,
  ];

  const ALWAYS_ON: Array<TelemetryType> = [
    TelemetryType.Profiles,
    TelemetryType.Syslog,
    TelemetryType.FluentLogs,
    TelemetryType.KubernetesCostIngest,
  ];

  const NEVER_ON: Array<TelemetryType> = [
    TelemetryType.ProbeIngest,
    TelemetryType.ServerMonitorIngest,
    TelemetryType.IncomingRequestIngest,
    TelemetryType.TelemetryMonitorEvaluation,
    TelemetryType.SessionReplay,
  ];

  test("high-volume traces/logs/metrics never get per-job tokens, so their inserts merge across jobs", () => {
    for (const type of HIGH_VOLUME) {
      expect(shouldUseInsertDedup(type)).toBe(false);
    }
  });

  test("low-volume fan-in types keep per-job tokens", () => {
    for (const type of ALWAYS_ON) {
      expect(shouldUseInsertDedup(type)).toBe(true);
    }
  });

  test("buffer-sharing and session-replay types never get per-job tokens", () => {
    for (const type of NEVER_ON) {
      expect(shouldUseInsertDedup(type)).toBe(false);
    }
  });

  /*
   * Guards the matrix itself: a telemetry type added later must be placed
   * in one of the three lists above deliberately, rather than silently
   * inheriting the untokened default because nobody thought about whether
   * its inserts can be merged.
   */
  test("the matrix is exhaustive over TelemetryType — a newly added type must be classified explicitly", () => {
    const classified: Array<TelemetryType> = [
      ...HIGH_VOLUME,
      ...ALWAYS_ON,
      ...NEVER_ON,
    ];
    const allTypes: Array<TelemetryType> = Object.values(TelemetryType);

    expect([...classified].sort()).toEqual([...allTypes].sort());
  });
});

describe("ProcessTelemetry handler — dedup scope wiring", () => {
  beforeEach(() => {
    processTracesFromQueue.mockReset();
    processSyslogFromQueue.mockReset();
    deleteBody.mockClear();
    jest
      .spyOn(OtelPayloadDecoder, "decodeFromQueue")
      .mockResolvedValue({ resourceSpans: [] } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the worker handler was registered/captured", () => {
    expect(typeof capturedHandler).toBe("function");
  });

  test("a traces job runs OUTSIDE any insert-dedup scope, so fan-in submissions stay untokened and merge across jobs", async () => {
    let observedToken: string | undefined = "sentinel-not-called";

    processTracesFromQueue.mockImplementationOnce(async (): Promise<void> => {
      observedToken = nextInsertDedupToken("SpanItemV3");
    });

    await capturedHandler!(tracesJob());

    expect(processTracesFromQueue).toHaveBeenCalledTimes(1);
    expect(observedToken).toBeUndefined();
  });

  test("a syslog job still runs INSIDE a dedup scope with deterministic per-job tokens", async () => {
    let observedToken: string | undefined = undefined;

    processSyslogFromQueue.mockImplementationOnce(async (): Promise<void> => {
      observedToken = nextInsertDedupToken("LogItemV3");
    });

    await capturedHandler!(syslogJob());

    expect(processSyslogFromQueue).toHaveBeenCalledTimes(1);
    expect(observedToken).toBe(`${SYSLOG_JOB_ID}:LogItemV3:0`);
  });
});
