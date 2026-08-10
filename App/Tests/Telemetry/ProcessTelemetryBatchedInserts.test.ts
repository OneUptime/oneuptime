import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * End-to-end proof of the batched-inserts architecture at the WORKER
 * HANDLER level: BullMQ job -> ProcessTelemetry handler -> REAL
 * OtelTracesIngestService / OtelLogsIngestService -> REAL shared
 * TelemetryFanInWriter -> mocked ClickHouse insertJsonRows.
 *
 * What this covers that the sibling suites do not:
 * - ProcessTelemetryInsertDedup.test.ts proves the handler opens no dedup
 *   scope for high-volume signals, with the services mocked out.
 * - TelemetryFanInIngest.test.ts proves the services merge submissions,
 *   calling the services directly.
 * - THIS suite proves the end-to-end claim of the change: N telemetry jobs
 *   processed by the actual worker handler produce ONE ClickHouse INSERT
 *   statement per table, all rows present, under a single minted per-batch
 *   token — plus the failure semantics jobs rely on for retry safety
 *   (merged-statement failure rejects every job in the batch and leaves
 *   every staged body in Redis for the BullMQ retry to re-read).
 *
 * Job bodies are delivered through the mocked OtelPayloadDecoder keyed by
 * bodyKey — the same seam the real worker uses to fetch the staged OTLP
 * payload from Redis.
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

const deleteBody: jest.Mock = jest.fn();
jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: { deleteBody, readBody: jest.fn(), storeBody: jest.fn() },
  };
});

/*
 * Bodies for decodeFromQueue, keyed by the job's bodyKey. Populated per
 * test; the decode spy (see setupIngestMocks) is the same seam the real
 * worker uses to pull the staged gzip/protobuf payload out of Redis and
 * decode it. NOT a module mock: the default export is a class whose OTHER
 * statics (e.g. getEntityRefsFromResource) the real trace service needs,
 * and spreading a class drops its non-enumerable static methods.
 */
const bodiesByKey: Record<string, unknown> = {};

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
import "../../FeatureSet/Telemetry/Jobs/TelemetryIngest/ProcessTelemetry";
import OtelPayloadDecoder from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import SpanService from "Common/Server/Services/SpanService";
import LogService from "Common/Server/Services/LogService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "batched-inserts-test-service";

const TRACE_ID_HEX: string = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID_HEX: string = "b7ad6b7169203331";

/*
 * Postgres-touching methods on the ingest services, mocked so the OTLP
 * walk, row building, and the shared fan-in writer run for real without a
 * database. Mirrors TelemetryFanInIngest.test.ts.
 */
const AUTO_DISCOVERY_METHODS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverCephCluster",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
];

function setupIngestMocks(): void {
  jest
    .spyOn(OtelPayloadDecoder, "decodeFromQueue")
    .mockImplementation(async (args: { bodyKey: string }): Promise<any> => {
      return (bodiesByKey[args.bodyKey] ?? {}) as any;
    });

  for (const ingestService of [
    OtelTracesIngestService,
    OtelLogsIngestService,
  ]) {
    const service: Record<string, any> = ingestService as unknown as {
      [key: string]: any;
    };

    for (const method of AUTO_DISCOVERY_METHODS_RETURNING_NULL) {
      jest.spyOn(service, method).mockResolvedValue(null);
    }

    jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
      serviceName: SERVICE_NAME,
      primaryEntityId: SERVICE_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    });
  }

  jest
    .spyOn(TraceDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as any);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as any);
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    .mockResolvedValue([] as any);
  jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([] as any);
  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as any);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as any);

  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);
}

function makeSpan(name: string): JSONObject {
  const nowNano: string = `${Date.now()}000000`;
  return {
    traceId: TRACE_ID_HEX,
    spanId: SPAN_ID_HEX,
    parentSpanId: "",
    name: name,
    kind: 2,
    startTimeUnixNano: nowNano,
    endTimeUnixNano: nowNano,
    status: { code: 1 },
    attributes: [{ key: "http.method", value: { stringValue: "GET" } }],
    events: [],
    links: [],
  };
}

function tracesBody(spanNames: Array<string>): JSONObject {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: SERVICE_NAME } },
          ],
        },
        scopeSpans: [{ scope: {}, spans: spanNames.map(makeSpan) }],
      },
    ],
  };
}

function logsBody(logBodies: Array<string>): JSONObject {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: SERVICE_NAME } },
          ],
        },
        scopeLogs: [
          {
            scope: {},
            logRecords: logBodies.map((body: string) => {
              return {
                timeUnixNano: `${Date.now()}000000`,
                severityNumber: 9,
                body: { stringValue: body },
                attributes: [],
              };
            }),
          },
        ],
      },
    ],
  };
}

let jobCounter: number = 0;

function otelJob(data: {
  type: "traces" | "logs";
  productType: "Traces" | "Logs";
  bodyKey: string;
  body: JSONObject;
}): unknown {
  jobCounter++;
  bodiesByKey[data.bodyKey] = data.body;
  return {
    id: `${data.type}-${PROJECT_ID.toString()}-${jobCounter}-x`,
    name: "ProcessTelemetry",
    data: {
      type: data.type,
      projectId: PROJECT_ID.toString(),
      bodyKey: data.bodyKey,
      bodyFormat: "json",
      bodyEncoding: "none",
      productType: data.productType,
      requestHeaders: {},
    },
  };
}

function tracesJob(bodyKey: string, spanNames: Array<string>): unknown {
  return otelJob({
    type: "traces",
    productType: "Traces",
    bodyKey,
    body: tracesBody(spanNames),
  });
}

function logsJob(bodyKey: string, logBodies: Array<string>): unknown {
  return otelJob({
    type: "logs",
    productType: "Logs",
    bodyKey,
    body: logsBody(logBodies),
  });
}

function rowsAcrossCalls(spy: jest.SpyInstance): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  for (const call of spy.mock.calls) {
    for (const row of call[0] as Array<JSONObject>) {
      rows.push(row);
    }
  }
  return rows;
}

function retryableClickHouseError(): Error {
  // Duck-typed retryable code (202 = TOO_MANY_SIMULTANEOUS_QUERIES).
  return Object.assign(new Error("Too many simultaneous queries."), {
    code: "202",
  });
}

describe("ProcessTelemetry handler — batched ClickHouse inserts end to end", () => {
  let spanInsertSpy: jest.SpyInstance;
  let logInsertSpy: jest.SpyInstance;

  beforeAll(() => {
    /*
     * Real shared writer, tiny time-flush window: all jobs submitted within
     * ~30ms share one flush, exactly the production path (where the window
     * is 5s). maxBatchRows stays far above every payload here so flushes
     * are timer-driven, never size-driven.
     */
    TelemetryFanInWriter.configure({
      maxWaitMs: 30,
      maxBatchRows: 10_000,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
    });
  });

  beforeEach(() => {
    for (const key of Object.keys(bodiesByKey)) {
      delete bodiesByKey[key];
    }
    deleteBody.mockClear();
    setupIngestMocks();
    spanInsertSpy = jest
      .spyOn(SpanService, "insertJsonRows")
      .mockResolvedValue(undefined);
    logInsertSpy = jest
      .spyOn(LogService, "insertJsonRows")
      .mockResolvedValue(undefined);
    jest
      .spyOn(ExceptionInstanceService, "insertJsonRows")
      .mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await TelemetryFanInWriter.flushAll();
    jest.restoreAllMocks();
  });

  test("the worker handler was registered/captured", () => {
    expect(typeof capturedHandler).toBe("function");
  });

  test("three concurrent trace jobs collapse into ONE INSERT statement carrying all rows under one minted token", async () => {
    const jobs: Array<unknown> = [
      tracesJob("telemetry:body:b1", ["j1s1", "j1s2", "j1s3", "j1s4", "j1s5"]),
      tracesJob("telemetry:body:b2", ["j2s1", "j2s2", "j2s3", "j2s4", "j2s5"]),
      tracesJob("telemetry:body:b3", ["j3s1", "j3s2", "j3s3", "j3s4", "j3s5"]),
    ];

    await Promise.all(
      jobs.map((job: unknown) => {
        return capturedHandler!(job);
      }),
    );

    // The whole point of the change: one statement, not one per job.
    expect(spanInsertSpy).toHaveBeenCalledTimes(1);

    const rows: Array<JSONObject> = rowsAcrossCalls(spanInsertSpy);
    expect(rows).toHaveLength(15);
    const names: Set<unknown> = new Set(
      rows.map((row: JSONObject) => {
        return row["name"];
      }),
    );
    for (const job of ["j1", "j2", "j3"]) {
      for (let i: number = 1; i <= 5; i++) {
        expect(names).toContain(`${job}s${i}`);
      }
    }

    const options: { dedupToken?: string } | undefined = spanInsertSpy.mock
      .calls[0]![1] as { dedupToken?: string } | undefined;
    expect(options?.dedupToken).toMatch(/^fanin:SpanItemV3:/);

    // Every job's staged body is reclaimed only after the shared ack.
    expect(deleteBody).toHaveBeenCalledTimes(3);
    for (const key of [
      "telemetry:body:b1",
      "telemetry:body:b2",
      "telemetry:body:b3",
    ]) {
      expect(deleteBody).toHaveBeenCalledWith(key);
    }
  });

  test("traces and logs jobs in the same window produce one statement per table", async () => {
    const jobs: Array<unknown> = [
      tracesJob("telemetry:body:t1", ["t1s1", "t1s2"]),
      tracesJob("telemetry:body:t2", ["t2s1", "t2s2"]),
      logsJob("telemetry:body:l1", ["log one", "log two"]),
      logsJob("telemetry:body:l2", ["log three"]),
    ];

    await Promise.all(
      jobs.map((job: unknown) => {
        return capturedHandler!(job);
      }),
    );

    expect(spanInsertSpy).toHaveBeenCalledTimes(1);
    expect(rowsAcrossCalls(spanInsertSpy)).toHaveLength(4);

    expect(logInsertSpy).toHaveBeenCalledTimes(1);
    expect(rowsAcrossCalls(logInsertSpy)).toHaveLength(3);

    expect(deleteBody).toHaveBeenCalledTimes(4);
  });

  test("a non-retryable merged-statement failure rejects EVERY job in the batch and leaves every staged body for the BullMQ retry", async () => {
    spanInsertSpy.mockRejectedValue(
      new Error("Code: 60. Table does not exist"),
    );

    const jobs: Array<unknown> = [
      tracesJob("telemetry:body:f1", ["f1s1"]),
      tracesJob("telemetry:body:f2", ["f2s1"]),
      tracesJob("telemetry:body:f3", ["f3s1"]),
    ];

    const outcomes: Array<PromiseSettledResult<void>> =
      await Promise.allSettled(
        jobs.map((job: unknown) => {
          return capturedHandler!(job) as Promise<void>;
        }),
      );

    for (const outcome of outcomes) {
      expect(outcome.status).toBe("rejected");
    }

    // Bodies must survive so each retry can re-read its payload.
    expect(deleteBody).not.toHaveBeenCalled();
  });

  test("a retryable failure is retried inside the writer with the SAME minted token and stays invisible to the jobs", async () => {
    spanInsertSpy
      .mockRejectedValueOnce(retryableClickHouseError())
      .mockResolvedValue(undefined);

    const jobs: Array<unknown> = [
      tracesJob("telemetry:body:r1", ["r1s1", "r1s2"]),
      tracesJob("telemetry:body:r2", ["r2s1"]),
    ];

    // Jobs resolve despite the first attempt failing.
    await Promise.all(
      jobs.map((job: unknown) => {
        return capturedHandler!(job);
      }),
    );

    // Two attempts of the same merged statement: same rows, same token.
    expect(spanInsertSpy).toHaveBeenCalledTimes(2);

    const firstRows: Array<JSONObject> = spanInsertSpy.mock
      .calls[0]![0] as Array<JSONObject>;
    const secondRows: Array<JSONObject> = spanInsertSpy.mock
      .calls[1]![0] as Array<JSONObject>;
    expect(secondRows).toEqual(firstRows);
    expect(firstRows).toHaveLength(3);

    const firstToken: string | undefined = (
      spanInsertSpy.mock.calls[0]![1] as { dedupToken?: string } | undefined
    )?.dedupToken;
    const secondToken: string | undefined = (
      spanInsertSpy.mock.calls[1]![1] as { dedupToken?: string } | undefined
    )?.dedupToken;
    expect(firstToken).toMatch(/^fanin:SpanItemV3:/);
    expect(secondToken).toBe(firstToken);

    expect(deleteBody).toHaveBeenCalledTimes(2);
  });
});
