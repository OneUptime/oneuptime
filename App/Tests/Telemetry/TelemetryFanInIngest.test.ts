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
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * End-to-end integration tests for the telemetry ingest paths through the
 * shared fan-in writer: OTLP JSON body -> processTracesFromQueue /
 * processLogsFromQueue -> TelemetryFanInWriter (the REAL default writer
 * instance, reconfigured for fast flushes) -> mocked ClickHouse
 * insertJsonRows on SpanService / LogService / ExceptionInstanceService.
 *
 * What this covers that the Common unit suite cannot: the wiring between
 * the ingest services and the writer — the force-submit at end of job, the
 * ack-after-flush contract (a job only resolves once its rows durably
 * "landed", and REJECTS when the batch definitively failed so BullMQ
 * retries the payload), the writer's internal retry being invisible to the
 * job, and cross-job batching into combined inserts.
 *
 * Everything that would touch Postgres (auto-discovery, service resolution,
 * pipeline/drop/scrub rule loading, exception summary upserts) is mocked,
 * mirroring OtelMetricsIngestIoTPipelineRules.test.ts. The OTLP walk, row
 * building and the fan-in writer itself run for real.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "fanin-test-service";

const TRACE_ID_HEX: string = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID_HEX: string = "b7ad6b7169203331";

/*
 * Auto-discovery methods on OtelIngestBaseService that hit Postgres. The
 * traces path calls a subset, the logs path all of them; mocking the full
 * list on both services keeps the setup uniform.
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

type InsertOptions = { dedupToken?: string } | undefined;

function setupIngestMocks(): void {
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

  // Pipeline artifacts: none configured (Postgres-backed loads are mocked out).
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

  // Postgres TelemetryException summary upsert (batched, end of job).
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);
}

function telemetryRequest(body: JSONObject): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: body,
    headers: {},
  } as unknown as TelemetryRequest;
}

function makeSpan(data: {
  name: string;
  withExceptionEvent?: boolean;
}): JSONObject {
  const nowNano: string = `${Date.now()}000000`;
  return {
    traceId: TRACE_ID_HEX,
    spanId: SPAN_ID_HEX,
    parentSpanId: "",
    name: data.name,
    kind: 2,
    startTimeUnixNano: nowNano,
    endTimeUnixNano: nowNano,
    status: { code: data.withExceptionEvent ? 2 : 1 },
    attributes: [{ key: "http.method", value: { stringValue: "GET" } }],
    events: data.withExceptionEvent
      ? [
          {
            name: "exception",
            timeUnixNano: nowNano,
            attributes: [
              {
                key: "exception.message",
                value: { stringValue: "Something broke" },
              },
              { key: "exception.type", value: { stringValue: "Error" } },
              {
                key: "exception.stacktrace",
                value: {
                  stringValue:
                    "Error: Something broke\n    at handler (app.js:10:5)",
                },
              },
            ],
          },
        ]
      : [],
    links: [],
  };
}

function tracesRequest(spans: Array<JSONObject>): TelemetryRequest {
  return telemetryRequest({
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: SERVICE_NAME } },
          ],
        },
        scopeSpans: [{ scope: {}, spans: spans }],
      },
    ],
  });
}

function logsRequest(logBodies: Array<string>): TelemetryRequest {
  return telemetryRequest({
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
  });
}

function insertedRows(spy: jest.SpyInstance): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  for (const call of spy.mock.calls) {
    for (const row of call[0] as Array<JSONObject>) {
      rows.push(row);
    }
  }
  return rows;
}

function expectEveryCallHasFanInDedupToken(spy: jest.SpyInstance): void {
  expect(spy.mock.calls.length).toBeGreaterThan(0);
  for (const call of spy.mock.calls) {
    const options: InsertOptions = call[1] as InsertOptions;
    expect(options?.dedupToken).toMatch(/^fanin:/);
  }
}

function retryableClickHouseError(): Error {
  /*
   * Duck-typed ClickHouseError: a numeric-string `code` on a plain Error is
   * classified retryable by isRetryableInsertError (202 =
   * TOO_MANY_SIMULTANEOUS_QUERIES) — same detection path a duplicated
   * @clickhouse/client package instance would take in production.
   */
  return Object.assign(new Error("Too many simultaneous queries."), {
    code: "202",
  });
}

describe("Telemetry fan-in ingest — traces + logs end to end through the writer", () => {
  let spanInsertSpy: jest.SpyInstance;
  let logInsertSpy: jest.SpyInstance;
  let exceptionInsertSpy: jest.SpyInstance;

  beforeAll(() => {
    /*
     * Reconfigure the REAL shared writer instance the ingest services use:
     * tiny time-flush window so buffered rows flush in ~10ms instead of the
     * production 1s, and near-zero retry backoff so the retry test doesn't
     * sleep. maxBatchRows stays above every payload in this file, so flushes
     * happen on the timer — exactly the production path for small jobs.
     */
    TelemetryFanInWriter.configure({
      maxWaitMs: 10,
      maxBatchRows: 50,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
    });
  });

  beforeEach(() => {
    setupIngestMocks();
    spanInsertSpy = jest
      .spyOn(SpanService, "insertJsonRows")
      .mockResolvedValue(undefined);
    logInsertSpy = jest
      .spyOn(LogService, "insertJsonRows")
      .mockResolvedValue(undefined);
    exceptionInsertSpy = jest
      .spyOn(ExceptionInstanceService, "insertJsonRows")
      .mockResolvedValue(undefined);
  });

  afterEach(async () => {
    /*
     * Every test awaits its process*FromQueue promise, which settles all
     * durability acks; flushAll() is a belt-and-braces drain so no buffered
     * rows or flush timers leak into the next test (or trip
     * --detectOpenHandles).
     */
    await TelemetryFanInWriter.flushAll();
    jest.restoreAllMocks();
  });

  test("traces happy path: all span rows land through the writer with fan-in dedup tokens", async () => {
    const spanNames: Array<string> = ["s1", "s2", "s3", "s4", "s5"];

    await expect(
      OtelTracesIngestService.processTracesFromQueue(
        tracesRequest(
          spanNames.map((name: string) => {
            return makeSpan({ name });
          }),
        ),
      ),
    ).resolves.toBeUndefined();

    // All 5 span rows arrived (possibly in one combined insert), in order.
    const rows: Array<JSONObject> = insertedRows(spanInsertSpy);
    expect(rows).toHaveLength(5);
    expect(
      rows.map((row: JSONObject) => {
        return row["name"];
      }),
    ).toEqual(spanNames);
    expect(rows[0]!["projectId"]).toBe(PROJECT_ID.toString());
    expect(rows[0]!["primaryEntityId"]).toBe(SERVICE_ID.toString());

    expectEveryCallHasFanInDedupToken(spanInsertSpy);

    // No exception events in this payload -> no ExceptionInstance inserts.
    expect(exceptionInsertSpy).not.toHaveBeenCalled();
  });

  test("ack-after-flush: a non-retryable insert failure rejects the job so BullMQ retries it", async () => {
    spanInsertSpy.mockRejectedValue(
      new Error("Code: 60. DB::Exception: Table does not exist"),
    );

    await expect(
      OtelTracesIngestService.processTracesFromQueue(
        tracesRequest([makeSpan({ name: "doomed" })]),
      ),
    ).rejects.toThrow(/Failed to flush traces to ClickHouse/);

    // Non-retryable -> the writer gave up after exactly one attempt.
    expect(spanInsertSpy).toHaveBeenCalledTimes(1);
  });

  test("retryable failure then success: the writer retries internally and the job still resolves", async () => {
    spanInsertSpy.mockRejectedValueOnce(retryableClickHouseError());
    // Falls back to the beforeEach mockResolvedValue on the second attempt.

    await expect(
      OtelTracesIngestService.processTracesFromQueue(
        tracesRequest([makeSpan({ name: "flaky" }), makeSpan({ name: "ok" })]),
      ),
    ).resolves.toBeUndefined();

    expect(spanInsertSpy).toHaveBeenCalledTimes(2);

    // Same batch re-sent: identical rows and the SAME dedup token, so
    // ClickHouse can drop the duplicate block if the first attempt landed.
    const firstCall: any = spanInsertSpy.mock.calls[0];
    const secondCall: any = spanInsertSpy.mock.calls[1];
    expect(secondCall[0]).toEqual(firstCall[0]);
    expect((firstCall[1] as InsertOptions)?.dedupToken).toMatch(/^fanin:/);
    expect((secondCall[1] as InsertOptions)?.dedupToken).toBe(
      (firstCall[1] as InsertOptions)?.dedupToken,
    );
  });

  test("cross-job batching: two concurrent trace jobs share the writer and all rows land", async () => {
    await expect(
      Promise.all([
        OtelTracesIngestService.processTracesFromQueue(
          tracesRequest([makeSpan({ name: "a1" }), makeSpan({ name: "a2" })]),
        ),
        OtelTracesIngestService.processTracesFromQueue(
          tracesRequest([
            makeSpan({ name: "b1" }),
            makeSpan({ name: "b2" }),
            makeSpan({ name: "b3" }),
          ]),
        ),
      ]),
    ).resolves.toEqual([undefined, undefined]);

    /*
     * Both jobs' rows funneled through the shared Span buffer. Depending on
     * timing they land in ONE combined insert (both submissions inside the
     * same 10ms window) or two — never more than one insert per job, and
     * never a lost or duplicated row.
     */
    const rows: Array<JSONObject> = insertedRows(spanInsertSpy);
    expect(rows).toHaveLength(5);
    expect(
      rows
        .map((row: JSONObject) => {
          return row["name"] as string;
        })
        .sort(),
    ).toEqual(["a1", "a2", "b1", "b2", "b3"]);
    expect(spanInsertSpy.mock.calls.length).toBeLessThanOrEqual(2);

    expectEveryCallHasFanInDedupToken(spanInsertSpy);
  });

  test("logs happy path: all log rows land through the writer with fan-in dedup tokens", async () => {
    const bodies: Array<string> = ["l-one", "l-two", "l-three", "l-four"];

    await expect(
      OtelLogsIngestService.processLogsFromQueue(logsRequest(bodies)),
    ).resolves.toBeUndefined();

    const rows: Array<JSONObject> = insertedRows(logInsertSpy);
    expect(rows).toHaveLength(4);
    expect(
      rows.map((row: JSONObject) => {
        return row["body"];
      }),
    ).toEqual(bodies);
    expect(rows[0]!["projectId"]).toBe(PROJECT_ID.toString());

    expectEveryCallHasFanInDedupToken(logInsertSpy);
  });

  test("logs ack-after-flush: a non-retryable insert failure rejects the job", async () => {
    logInsertSpy.mockRejectedValue(
      new Error("Code: 60. DB::Exception: Table does not exist"),
    );

    await expect(
      OtelLogsIngestService.processLogsFromQueue(logsRequest(["doomed log"])),
    ).rejects.toThrow(/Failed to flush logs to ClickHouse/);

    expect(logInsertSpy).toHaveBeenCalledTimes(1);
  });

  test("trace exception events produce ExceptionInstance rows through the writer", async () => {
    /*
     * The service truncates pendingExceptionUpserts (length = 0) during its
     * end-of-job memory cleanup, and jest's mock.calls holds the array by
     * REFERENCE — so snapshot the payload count at call time.
     */
    let upsertCallCount: number = 0;
    let upsertPayloadCount: number = -1;
    (
      ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch as unknown as jest.Mock
    ).mockImplementation(async (payloads: Array<unknown>): Promise<void> => {
      upsertCallCount++;
      upsertPayloadCount = payloads.length;
    });

    await expect(
      OtelTracesIngestService.processTracesFromQueue(
        tracesRequest([
          makeSpan({ name: "clean" }),
          makeSpan({ name: "failing", withExceptionEvent: true }),
        ]),
      ),
    ).resolves.toBeUndefined();

    // Both spans stored...
    expect(insertedRows(spanInsertSpy)).toHaveLength(2);

    // ...and the exception event became exactly one ExceptionInstance row.
    const exceptionRows: Array<JSONObject> = insertedRows(exceptionInsertSpy);
    expect(exceptionRows).toHaveLength(1);
    const exceptionRow: JSONObject = exceptionRows[0]!;
    expect(exceptionRow["message"]).toBe("Something broke");
    expect(exceptionRow["exceptionType"]).toBe("Error");
    expect(exceptionRow["traceId"]).toBe(TRACE_ID_HEX);
    expect(typeof exceptionRow["fingerprint"]).toBe("string");
    expect((exceptionRow["fingerprint"] as string).length).toBeGreaterThan(0);

    expectEveryCallHasFanInDedupToken(exceptionInsertSpy);

    // The Postgres summary upsert got the matching payload (mocked away).
    expect(upsertCallCount).toBe(1);
    expect(upsertPayloadCount).toBe(1);
  });
});
