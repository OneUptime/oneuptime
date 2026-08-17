import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

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
 * Job bodies are delivered through a decodeFromQueue spy keyed by bodyKey —
 * the same seam the real worker uses to fetch the staged OTLP payload from
 * Redis.
 *
 * Every merge assertion here is pinned by a statement COUNT, deliberately:
 * asserting only that rows landed, or only that jobs rejected, would pass
 * just as well under the old one-INSERT-per-job behavior, i.e. it would not
 * test the change at all. Verified by mutation — reverting the policy in
 * ProcessTelemetry.ts fails every substantive test in this file.
 */

/*
 * PasswordHash has a pre-existing TS5.9 ts-jest compile error (crypto
 * BinaryLike vs Buffer) and is pulled in transitively through the service
 * layer. Nothing password-related is under test here, so the module is
 * replaced WITH A FACTORY — an automock would still require (and
 * type-check) the real file. Same workaround as the other suites in this
 * directory.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

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
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import MetricService from "Common/Server/Services/MetricService";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
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

/*
 * Metrics-path setup: the metrics service has its own auto-discovery
 * surface (IoT fleet), pipeline-rule loader and MetricType catalog
 * write-back, all Postgres-backed. submitMetricsBuffer and the fan-in
 * writer run for REAL — that is the wiring under test.
 */
function setupMetricsIngestMocks(): void {
  const service: Record<string, any> = OtelMetricsIngestService as unknown as {
    [key: string]: any;
  };

  jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);

  for (const method of [
    ...AUTO_DISCOVERY_METHODS_RETURNING_NULL,
    "autoDiscoverIoTFleet",
  ]) {
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

  const noRules: MetricRulesForProject = {
    projectRules: [],
    rulesByServiceId: new Map(),
  };
  jest.spyOn(MetricPipelineRuleService, "loadRules").mockResolvedValue(noRules);

  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined as any);
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
  type: "traces" | "logs" | "metrics";
  productType: "Traces" | "Logs" | "Metrics";
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

/*
 * No host.name in the resource attributes on purpose: it would add a
 * synthetic heartbeat row and pull the (mocked-away) host enrichment in.
 */
function metricsBody(metricNames: Array<string>): JSONObject {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: SERVICE_NAME } },
          ],
        },
        scopeMetrics: [
          {
            metrics: metricNames.map((name: string, index: number) => {
              return {
                name: name,
                description: "test sum",
                unit: "1",
                sum: {
                  aggregationTemporality: 2,
                  isMonotonic: true,
                  dataPoints: [
                    {
                      asInt: index + 1,
                      startTimeUnixNano: `${Date.now() - 60_000}000000`,
                      timeUnixNano: `${Date.now()}000000`,
                      attributes: [],
                    },
                  ],
                },
              };
            }),
          },
        ],
      },
    ],
  };
}

function metricsJob(bodyKey: string, metricNames: Array<string>): unknown {
  return otelJob({
    type: "metrics",
    productType: "Metrics",
    bodyKey,
    body: metricsBody(metricNames),
  });
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

  /*
   * Batch cuts here are SIZE-driven, never timer-driven, and that is
   * deliberate: a wall-clock window would make every "one statement"
   * assertion depend on all N job handlers reaching submit() before a timer
   * fires, while each is doing real work (decode await, full OTLP walk, row
   * building, several awaited service calls). On a loaded CI runner a later
   * job slips into a second batch and the assertion fails on correct code.
   *
   * So each test sets maxBatchRows (per table where two tables are in play)
   * to EXACTLY the row total it submits: the final submit then trips
   * cutAndDispatch deterministically, regardless of machine speed or
   * event-loop turn boundaries. maxWaitMs stays long enough to never be the
   * thing that cuts — if a regression loses rows, the test fails an
   * assertion rather than passing on a timer flush.
   */
  const NEVER_TIME_FLUSH_MS: number = 60_000;

  function configureWriter(data: {
    maxBatchRows: number;
    maxBatchRowsByTable?: Record<string, number>;
  }): void {
    TelemetryFanInWriter.configure({
      maxWaitMs: NEVER_TIME_FLUSH_MS,
      maxBatchRows: data.maxBatchRows,
      maxBatchRowsByTable: data.maxBatchRowsByTable ?? {},
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
    });
  }

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
    // 3 jobs x 5 spans: the 15th row cuts the batch.
    configureWriter({ maxBatchRows: 15 });

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
    // Per-table cuts: 2 trace jobs x 2 spans = 4 span rows; 2+1 = 3 log rows.
    configureWriter({
      maxBatchRows: 10_000,
      maxBatchRowsByTable: { SpanItemV3: 4, LogItemV3: 3 },
    });

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

    // Traces and logs must not share a statement even though they share a window.
    expect(
      (spanInsertSpy.mock.calls[0]![1] as { dedupToken?: string } | undefined)
        ?.dedupToken,
    ).toMatch(/^fanin:SpanItemV3:/);
    expect(
      (logInsertSpy.mock.calls[0]![1] as { dedupToken?: string } | undefined)
        ?.dedupToken,
    ).toMatch(/^fanin:LogItemV3:/);

    expect(deleteBody).toHaveBeenCalledTimes(4);
  });

  test("consecutive flush windows get DIFFERENT minted tokens, so ClickHouse never dedups a later batch away", async () => {
    configureWriter({ maxBatchRows: 2 });

    await capturedHandler!(tracesJob("telemetry:body:w1", ["w1s1", "w1s2"]));
    await capturedHandler!(tracesJob("telemetry:body:w2", ["w2s1", "w2s2"]));

    expect(spanInsertSpy).toHaveBeenCalledTimes(2);

    const tokenFirst: string | undefined = (
      spanInsertSpy.mock.calls[0]![1] as { dedupToken?: string } | undefined
    )?.dedupToken;
    const tokenSecond: string | undefined = (
      spanInsertSpy.mock.calls[1]![1] as { dedupToken?: string } | undefined
    )?.dedupToken;

    expect(tokenFirst).toMatch(/^fanin:SpanItemV3:/);
    expect(tokenSecond).toMatch(/^fanin:SpanItemV3:/);
    /*
     * A reused minted token would make ClickHouse's content-hash dedup drop
     * the entire second batch — silent, total loss of that window's rows.
     */
    expect(tokenSecond).not.toBe(tokenFirst);
  });

  test("a non-retryable failure of the ONE merged statement rejects EVERY job in the batch and leaves every staged body for the BullMQ retry", async () => {
    configureWriter({ maxBatchRows: 3 });

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

    /*
     * Pin the premise of the test: ONE merged statement carrying all three
     * jobs' rows is what failed. Without this the assertions below hold
     * equally for three independent per-job statements, i.e. the test would
     * pass under a full revert of the batching change.
     */
    expect(spanInsertSpy).toHaveBeenCalledTimes(1);
    expect(rowsAcrossCalls(spanInsertSpy)).toHaveLength(3);
    expect(
      (spanInsertSpy.mock.calls[0]![1] as { dedupToken?: string } | undefined)
        ?.dedupToken,
    ).toMatch(/^fanin:SpanItemV3:/);

    // That single failure fans out to every job sharing the statement.
    for (const outcome of outcomes) {
      expect(outcome.status).toBe("rejected");
    }

    // Bodies must survive so each retry can re-read its payload.
    expect(deleteBody).not.toHaveBeenCalled();
  });

  test("a retryable failure is retried inside the writer with the SAME minted token and rows, and stays invisible to the jobs", async () => {
    configureWriter({ maxBatchRows: 3 });

    /*
     * Snapshot the rows AS SEEN on each attempt. Comparing
     * mock.calls[0][0] to mock.calls[1][0] directly would be a tautology:
     * insertGroupWithRetry builds the merged array once and passes the same
     * reference to every attempt, so the two recorded arguments are the
     * same object.
     */
    const seen: Array<Array<JSONObject>> = [];
    spanInsertSpy.mockImplementation(
      async (rows: Array<JSONObject>): Promise<void> => {
        seen.push(
          rows.map((row: JSONObject) => {
            return { ...row };
          }),
        );
        if (seen.length === 1) {
          throw retryableClickHouseError();
        }
      },
    );

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
    expect(seen).toHaveLength(2);
    expect(seen[0]).toHaveLength(3);
    expect(seen[1]).toEqual(seen[0]);

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

/*
 * Metrics is the third signal the change moves out of the dedup scope, and
 * it reaches ClickHouse through its own submitMetricsBuffer path with
 * metrics-only settings — so it needs its own end-to-end case rather than
 * riding on the traces coverage above.
 */
describe("ProcessTelemetry handler — metrics jobs batch through the writer too", () => {
  let metricInsertSpy: jest.SpyInstance;

  beforeEach(() => {
    for (const key of Object.keys(bodiesByKey)) {
      delete bodiesByKey[key];
    }
    deleteBody.mockClear();
    jest
      .spyOn(OtelPayloadDecoder, "decodeFromQueue")
      .mockImplementation(async (args: { bodyKey: string }): Promise<any> => {
        return (bodiesByKey[args.bodyKey] ?? {}) as any;
      });
    setupMetricsIngestMocks();
    metricInsertSpy = jest
      .spyOn(MetricService, "insertJsonRows")
      .mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await TelemetryFanInWriter.flushAll();
    jest.restoreAllMocks();
  });

  test("three metric jobs collapse into ONE INSERT under one minted token, carrying the metrics-only ClickHouse settings", async () => {
    // 3 jobs x 2 single-datapoint metrics = 6 rows.
    TelemetryFanInWriter.configure({
      maxWaitMs: 60_000,
      maxBatchRows: 6,
      maxBatchRowsByTable: {},
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
    });

    const jobs: Array<unknown> = [
      metricsJob("telemetry:body:m1", ["m1.a", "m1.b"]),
      metricsJob("telemetry:body:m2", ["m2.a", "m2.b"]),
      metricsJob("telemetry:body:m3", ["m3.a", "m3.b"]),
    ];

    await Promise.all(
      jobs.map((job: unknown) => {
        return capturedHandler!(job);
      }),
    );

    expect(metricInsertSpy).toHaveBeenCalledTimes(1);

    const rows: Array<JSONObject> = rowsAcrossCalls(metricInsertSpy);
    expect(rows).toHaveLength(6);
    const names: Set<unknown> = new Set(
      rows.map((row: JSONObject) => {
        return row["name"];
      }),
    );
    for (const name of ["m1.a", "m1.b", "m2.a", "m2.b", "m3.a", "m3.b"]) {
      expect(names).toContain(name);
    }

    const options: { dedupToken?: string; clickhouseSettings?: JSONObject } =
      metricInsertSpy.mock.calls[0]![1] as {
        dedupToken?: string;
        clickhouseSettings?: JSONObject;
      };
    expect(options?.dedupToken).toMatch(/^fanin:/);
    /*
     * Merging must not drop the metrics-only settings that make the ack mean
     * "flushed through the Distributed table".
     */
    expect(options?.clickhouseSettings).toEqual({
      distributed_foreground_insert: 1,
    });

    expect(deleteBody).toHaveBeenCalledTimes(3);
  });
});
