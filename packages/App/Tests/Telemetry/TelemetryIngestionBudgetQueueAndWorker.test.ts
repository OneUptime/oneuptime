import { beforeEach, describe, expect, test } from "@jest/globals";
import zlib from "zlib";

/*
 * Telemetry ingestion budgets at the two ends of the telemetry queue (issue
 * #5917):
 *
 *   - the enqueue (TelemetryQueueService.addTelemetryIngestJob) counts a
 *     batch exactly once: not again when a gate already admitted it, at the
 *     stored size when a gate only checked it (Pyroscope), and in Drop mode
 *     when no gate ran (MQTT, the cloud streams, OneUptime's own collectors) -
 *     a batch dropped over a used-up budget stores no body and queues no job;
 *   - the worker (ProcessTelemetry) settles a compressed body counted on
 *     arrival at an estimate, once it has inflated it, on the job's first
 *     attempt only.
 *
 * The budget decisions are mocked (TelemetryIngestionBudget is tested on its
 * own, and against a real Valkey); the queue, the body store and the ingest
 * services are mocked so nothing touches Redis, Postgres or ClickHouse.
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

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn().mockResolvedValue(undefined),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
      MarketingEvent: "MarketingEvent",
    },
  };
});

const processLogsFromQueue: jest.Mock = jest.fn();
jest.mock("../../FeatureSet/Telemetry/Services/OtelLogsIngestService", () => {
  return { __esModule: true, default: { processLogsFromQueue } };
});
jest.mock("../../FeatureSet/Telemetry/Services/OtelTracesIngestService", () => {
  return {
    __esModule: true,
    default: { processTracesFromQueue: jest.fn() },
  };
});
jest.mock(
  "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService",
  () => {
    return {
      __esModule: true,
      default: { processMetricsFromQueue: jest.fn() },
    };
  },
);
jest.mock(
  "../../FeatureSet/Telemetry/Services/OtelProfilesIngestService",
  () => {
    return {
      __esModule: true,
      default: { processProfilesFromQueue: jest.fn() },
    };
  },
);
jest.mock("../../FeatureSet/Telemetry/Services/SyslogIngestService", () => {
  return { __esModule: true, default: { processSyslogFromQueue: jest.fn() } };
});
jest.mock("../../FeatureSet/Telemetry/Services/FluentLogsIngestService", () => {
  return {
    __esModule: true,
    default: { processFluentLogsFromQueue: jest.fn() },
  };
});

const storeBody: jest.Mock = jest.fn().mockResolvedValue("telemetry:body:k");
const readBody: jest.Mock = jest.fn();
const deleteBody: jest.Mock = jest.fn();
jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: { storeBody, readBody, deleteBody },
  };
});

const admit: jest.Mock = jest.fn();
const chargePending: jest.Mock = jest.fn();
const reconcile: jest.Mock = jest.fn();
jest.mock("Common/Server/Utils/Telemetry/TelemetryIngestionBudget", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Telemetry/TelemetryIngestionBudget",
  ) as Record<string, unknown>;
  const actualDefault: Record<string, unknown> = actual["default"] as Record<
    string,
    unknown
  >;

  return {
    __esModule: true,
    ...actual,
    default: {
      admit,
      chargePending,
      reconcile,
      toJobCharge: actualDefault["toJobCharge"],
    },
  };
});

jest.mock(
  "isolated-vm",
  () => {
    return {
      __esModule: true,
      default: {},
      Isolate: jest.fn(),
      Reference: jest.fn(),
      Callback: jest.fn(),
      ExternalCopy: jest.fn(),
    };
  },
  { virtual: true },
);

import "../../FeatureSet/Telemetry/Jobs/TelemetryIngest/ProcessTelemetry";
import TelemetryQueueService, {
  getTelemetryIngestionBudgetSignalForTelemetryType,
  TelemetryIngestJobData,
  TelemetryType,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import OtelPayloadDecoder, {
  MAX_DECOMPRESSED_OTLP_BODY_BYTES,
  OtelDecodedPayload,
  OtelPayloadFormat,
} from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import Queue from "Common/Server/Infrastructure/Queue";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  TelemetryIngestionBudgetAdmissionMode,
  TelemetryIngestionBudgetCharge,
  TelemetryIngestionBudgetJobCharge,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionBudget";
import {
  MAX_COUNTED_INGEST_BODY_BYTES,
  TelemetryIngestBodySize,
} from "Common/Server/Utils/Telemetry/TelemetryIngestBodySize";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import { TelemetryIngestionBudgetScope } from "Common/Types/Telemetry/TelemetryIngestionBudget";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111151";

const charge: (
  overrides?: Partial<TelemetryIngestionBudgetCharge>,
) => TelemetryIngestionBudgetCharge = (
  overrides?: Partial<TelemetryIngestionBudgetCharge>,
): TelemetryIngestionBudgetCharge => {
  return {
    projectId: PROJECT_ID,
    signal: ProductType.Logs,
    dayId: "20261109T0000Z",
    dayTtlSeconds: 1000,
    countedBytes: 120,
    isExact: true,
    isPending: false,
    scopes: [
      {
        scope: TelemetryIngestionBudgetScope.Project,
        scopeId: PROJECT_ID,
        dailyBudgetBytes: 1000,
        warningBytes: 800,
        rateLimitBytesPerSecond: null,
      },
    ],
    ...(overrides || {}),
  };
};

const request: (data: {
  body: unknown;
  headers?: Record<string, string>;
  charge?: TelemetryIngestionBudgetCharge | null;
  rawBody?: string;
}) => TelemetryRequest = (data: {
  body: unknown;
  headers?: Record<string, string>;
  charge?: TelemetryIngestionBudgetCharge | null;
  rawBody?: string;
}): TelemetryRequest => {
  const req: Record<string, unknown> = {
    projectId: new ObjectID(PROJECT_ID),
    body: data.body,
    headers: data.headers || {},
    productType: ProductType.Logs,
  };

  if (data.charge !== undefined) {
    req["telemetryIngestionBudgetCharge"] = data.charge;
  }

  if (data.rawBody !== undefined) {
    req["rawBody"] = data.rawBody;
  }

  return req as unknown as TelemetryRequest;
};

const enqueuedJob: () => TelemetryIngestJobData | undefined = ():
  | TelemetryIngestJobData
  | undefined => {
  const calls: Array<Array<unknown>> = (Queue.addJob as unknown as jest.Mock)
    .mock.calls;
  return calls.length > 0
    ? (calls[calls.length - 1]![3] as TelemetryIngestJobData)
    : undefined;
};

const lastMeasure: () => TelemetryIngestBodySize =
  (): TelemetryIngestBodySize => {
    const call: Record<string, unknown> = admit.mock.calls[
      admit.mock.calls.length - 1
    ]![0] as Record<string, unknown>;

    return (call["measure"] as () => TelemetryIngestBodySize)();
  };

beforeEach(() => {
  jest.clearAllMocks();
  storeBody.mockResolvedValue("telemetry:body:k");
  admit.mockResolvedValue({ refusal: null, charge: null });
  chargePending.mockImplementation(
    async (data: {
      charge: TelemetryIngestionBudgetCharge;
      size: TelemetryIngestBodySize;
    }) => {
      return {
        ...data.charge,
        countedBytes: data.size.bytes,
        isExact: data.size.isExact,
        isPending: false,
      };
    },
  );
  reconcile.mockResolvedValue(undefined);
});

describe("which queued telemetry is budgeted", () => {
  test("logs, syslog and Fluent count as logs; each OTel signal and security events as themselves", () => {
    expect(
      getTelemetryIngestionBudgetSignalForTelemetryType(TelemetryType.Logs),
    ).toBe(ProductType.Logs);
    expect(
      getTelemetryIngestionBudgetSignalForTelemetryType(TelemetryType.Syslog),
    ).toBe(ProductType.Logs);
    expect(
      getTelemetryIngestionBudgetSignalForTelemetryType(
        TelemetryType.FluentLogs,
      ),
    ).toBe(ProductType.Logs);
    expect(
      getTelemetryIngestionBudgetSignalForTelemetryType(TelemetryType.Traces),
    ).toBe(ProductType.Traces);
    expect(
      getTelemetryIngestionBudgetSignalForTelemetryType(TelemetryType.Metrics),
    ).toBe(ProductType.Metrics);
    expect(
      getTelemetryIngestionBudgetSignalForTelemetryType(TelemetryType.Profiles),
    ).toBe(ProductType.Profiles);
    expect(
      getTelemetryIngestionBudgetSignalForTelemetryType(
        TelemetryType.SecurityEvents,
      ),
    ).toBe(ProductType.SecurityEvents);
  });

  test("probe results, monitor evaluations, Kubernetes cost and session replay are not", () => {
    for (const type of [
      TelemetryType.ProbeIngest,
      TelemetryType.ServerMonitorIngest,
      TelemetryType.IncomingRequestIngest,
      TelemetryType.TelemetryMonitorEvaluation,
      TelemetryType.KubernetesCostIngest,
      TelemetryType.SessionReplay,
    ]) {
      expect(getTelemetryIngestionBudgetSignalForTelemetryType(type)).toBe(
        null,
      );
    }
  });
});

describe("the enqueue counts a batch once", () => {
  test("a batch no gate saw (MQTT, a cloud stream) is decided here, in Drop mode, at its stored size", async () => {
    const body: Record<string, unknown> = { resourceMetrics: [{ a: 1 }] };

    await TelemetryQueueService.addMetricIngestJob(request({ body: body }));

    expect(admit).toHaveBeenCalledTimes(1);
    const call: Record<string, unknown> = admit.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(call["mode"]).toBe(TelemetryIngestionBudgetAdmissionMode.Drop);
    expect(call["signal"]).toBe(ProductType.Metrics);
    expect(lastMeasure()).toEqual({
      bytes: Buffer.byteLength(JSON.stringify(body)),
      isExact: true,
    });
    expect(Queue.addJob).toHaveBeenCalledTimes(1);
  });

  test("a batch over a used-up budget is dropped: no body is stored and no job is queued", async () => {
    admit.mockResolvedValue({
      refusal: { kind: "daily-budget-exhausted" },
      charge: null,
    });

    await TelemetryQueueService.addMetricIngestJob(
      request({ body: { resourceMetrics: [] } }),
    );

    expect(storeBody).not.toHaveBeenCalled();
    expect(Queue.addJob).not.toHaveBeenCalled();
  });

  test("a batch a gate already counted is not counted again", async () => {
    await TelemetryQueueService.addLogIngestJob(
      request({ body: Buffer.from("raw"), charge: charge() }),
    );

    expect(admit).not.toHaveBeenCalled();
    expect(chargePending).not.toHaveBeenCalled();
    expect(Queue.addJob).toHaveBeenCalledTimes(1);
    expect(enqueuedJob()?.ingestionBudgetCharge).toBeUndefined();
  });

  test("a batch a gate decided without counting (no budget) is queued as it is", async () => {
    await TelemetryQueueService.addLogIngestJob(
      request({ body: Buffer.from("raw"), charge: null }),
    );

    expect(admit).not.toHaveBeenCalled();
    expect(enqueuedJob()?.ingestionBudgetCharge).toBeUndefined();
  });

  test("a compressed body counted at an estimate carries its charge to the worker", async () => {
    await TelemetryQueueService.addLogIngestJob(
      request({
        body: zlib.gzipSync(Buffer.from("y".repeat(3000))),
        headers: { "content-encoding": "gzip" },
        charge: charge({ isExact: false, countedBytes: 3000 }),
      }),
    );

    const jobCharge: TelemetryIngestionBudgetJobCharge | undefined =
      enqueuedJob()?.ingestionBudgetCharge;

    expect(jobCharge).toEqual({
      dayId: "20261109T0000Z",
      signalSlug: "logs",
      countedBytes: 3000,
      scopes: [
        {
          scope: TelemetryIngestionBudgetScope.Project,
          scopeId: PROJECT_ID,
          warningBytes: 800,
        },
      ],
    });
  });

  test("a batch only checked at the gate (Pyroscope) is counted now, at the size it is stored with", async () => {
    const body: Record<string, unknown> = { resourceProfiles: [{ p: 1 }] };

    await TelemetryQueueService.addProfileIngestJob(
      request({ body: body, charge: charge({ isPending: true }) }),
    );

    expect(admit).not.toHaveBeenCalled();
    expect(chargePending).toHaveBeenCalledTimes(1);
    expect(chargePending.mock.calls[0]![0].size).toEqual({
      bytes: Buffer.byteLength(JSON.stringify(body)),
      isExact: true,
    });
    // Counted exactly: nothing for the worker to settle.
    expect(enqueuedJob()?.ingestionBudgetCharge).toBeUndefined();
  });

  test("a raw gzip body no gate saw is sized from its trailer and settled by the worker", async () => {
    admit.mockImplementation(
      async (data: { measure: () => TelemetryIngestBodySize }) => {
        return {
          refusal: null,
          charge: charge({
            ...data.measure(),
            countedBytes: data.measure().bytes,
          }),
        };
      },
    );

    await TelemetryQueueService.addLogIngestJob(
      request({
        body: zlib.gzipSync(Buffer.from("z".repeat(9000))),
        headers: { "content-encoding": "gzip" },
      }),
    );

    expect(lastMeasure()).toEqual({ bytes: 9000, isExact: false });
    expect(enqueuedJob()?.ingestionBudgetCharge?.countedBytes).toBe(9000);
  });

  test("a parsed syslog batch no gate saw is sized from the text the parser kept", async () => {
    const rawBody: string = "<14>hello world";

    await TelemetryQueueService.addTelemetryIngestJob(
      request({ body: { messages: ["x"] }, rawBody: rawBody }),
      TelemetryType.Syslog,
    );

    expect(lastMeasure()).toEqual({
      bytes: Buffer.byteLength(rawBody),
      isExact: true,
    });
    expect(enqueuedJob()?.requestBody).toEqual({ messages: ["x"] });
  });
});

describe("the worker settles a compressed body's real size", () => {
  const plain: Buffer = Buffer.from(
    JSON.stringify({
      resourceLogs: [
        { scopeLogs: [{ logRecords: [{ body: "x".repeat(4000) }] }] },
      ],
    }),
  );

  const jobCharge: TelemetryIngestionBudgetJobCharge = {
    dayId: "20261109T0000Z",
    signalSlug: "logs",
    countedBytes: 100,
    scopes: [
      {
        scope: TelemetryIngestionBudgetScope.Project,
        scopeId: PROJECT_ID,
        warningBytes: null,
      },
    ],
  };

  const runJob: (data: {
    attemptsMade: number;
    withCharge: boolean;
    bodyGone?: boolean;
  }) => Promise<void> = async (data: {
    attemptsMade: number;
    withCharge: boolean;
    bodyGone?: boolean;
  }): Promise<void> => {
    readBody.mockResolvedValue(data.bodyGone ? null : zlib.deflateSync(plain));

    const jobData: TelemetryIngestJobData = {
      type: TelemetryType.Logs,
      projectId: PROJECT_ID,
      bodyKey: "telemetry:body:k",
      bodyFormat: OtelPayloadFormat.Json,
      bodyEncoding: "deflate",
      productType: ProductType.Logs,
      requestHeaders: {},
      ingestionTimestamp: new Date(),
      ...(data.withCharge ? { ingestionBudgetCharge: jobCharge } : {}),
    };

    await capturedHandler!({
      id: "job-1",
      name: "ProcessTelemetry",
      data: jobData,
      attemptsMade: data.attemptsMade,
    });
  };

  test("adds what the deflate body really was to the day it was counted on", async () => {
    await runJob({ attemptsMade: 0, withCharge: true });

    expect(processLogsFromQueue).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith({
      charge: jobCharge,
      decodedBytes: plain.length,
    });
  });

  test("settles nothing on a retry, which would add the same difference again", async () => {
    await runJob({ attemptsMade: 1, withCharge: true });

    expect(processLogsFromQueue).toHaveBeenCalledTimes(1);
    expect(reconcile).not.toHaveBeenCalled();
  });

  test("settles nothing for a job counted exactly, or whose body is gone", async () => {
    await runJob({ attemptsMade: 0, withCharge: false });
    await runJob({ attemptsMade: 0, withCharge: true, bodyGone: true });

    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe("OtelPayloadDecoder.decodeFromQueueMeasured", () => {
  test("answers the size of the body once inflated, for every coding", async () => {
    const plain: Buffer = Buffer.from(JSON.stringify({ resourceSpans: [] }));

    for (const [encoding, stored] of [
      ["none", plain],
      ["gzip", zlib.gzipSync(plain)],
      ["deflate", zlib.deflateSync(plain)],
      ["zstd", zlib.zstdCompressSync(plain)],
    ] as Array<["none" | "gzip" | "deflate" | "zstd", Buffer]>) {
      readBody.mockResolvedValue(stored);

      const decoded: OtelDecodedPayload =
        await OtelPayloadDecoder.decodeFromQueueMeasured({
          productType: ProductType.Traces,
          format: OtelPayloadFormat.Json,
          encoding: encoding,
          bodyKey: "telemetry:body:k",
        });

      expect(decoded.decodedBytes).toBe(plain.length);
      expect(decoded.body).toEqual({ resourceSpans: [] });
    }
  });

  test("answers no size when the body is gone", async () => {
    readBody.mockResolvedValue(null);

    expect(
      await OtelPayloadDecoder.decodeFromQueueMeasured({
        productType: ProductType.Traces,
        format: OtelPayloadFormat.Json,
        encoding: "none",
        bodyKey: "telemetry:body:k",
      }),
    ).toEqual({ body: {}, decodedBytes: null });
  });

  test("never counts a body past what the worker would inflate", () => {
    expect(MAX_COUNTED_INGEST_BODY_BYTES).toBe(
      MAX_DECOMPRESSED_OTLP_BODY_BYTES,
    );
  });
});
