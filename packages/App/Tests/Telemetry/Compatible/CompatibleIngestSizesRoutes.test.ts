import zlib from "zlib";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import { JSONObject } from "Common/Types/JSON";
import {
  COMPATIBLE_INGEST_URL_PREFIX,
  COMPATIBLE_JSON_MAX_VALUES,
  DATADOG_BASE_PATH,
  DATADOG_PROTOBUF_MAX_ELEMENTS,
  SENTRY_BASE_PATH,
  SPLUNK_HEC_BASE_PATH,
} from "Common/Types/Telemetry/CompatibleIngest";
import DatadogAPI from "../../../FeatureSet/Telemetry/API/Datadog";
import SentryAPI from "../../../FeatureSet/Telemetry/API/Sentry";
import SplunkHecAPI from "../../../FeatureSet/Telemetry/API/SplunkHec";
import TelemetryQueueService from "../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import {
  DatadogMetricPayload,
  DatadogMetricPayloadAsRead,
  DatadogSketchPayload,
  DatadogSketchPayloadAsRead,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/DatadogIntake";
import {
  INGESTION_KEY,
  QueuedJob,
  RouteResponse,
  RouteServer,
  recordJob,
  send,
  serverPolicy,
  startRouteServer,
} from "./CompatibleIngestRouteHarness";

/*
 * Splunk HEC, Datadog and Sentry had Loki's two problems (#10148): each of
 * their jobs was counted against its budget at the OTLP JSON it became,
 * and their bodies were parsed or decoded with nothing but a 64 MiB
 * ceiling between a small body and millions of objects. Over the real
 * routers and real HTTP:
 *
 *   - a request is counted at its body decompressed - a HEC batch's logs
 *     and metric events sharing it, a Datadog payload whole, a Sentry
 *     envelope at the items it was translated from (its attachments are
 *     not kept, so not counted);
 *   - a JSON body over COMPATIBLE_JSON_MAX_VALUES values, and a Datadog
 *     protobuf payload over DATADOG_PROTOBUF_MAX_ELEMENTS, is a 413 in each
 *     protocol's own words, before it is parsed or decoded.
 */

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getPolicyFromSecretKey: jest.fn(),
      markUsed: jest.fn(async () => {
        return undefined;
      }),
    },
  };
});

jest.mock(
  "../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addLogIngestJob: jest.fn(),
        addMetricIngestJob: jest.fn(),
        addTraceIngestJob: jest.fn(),
        addProfileIngestJob: jest.fn(),
      },
    };
  },
);

const UNDASHED_KEY: string = INGESTION_KEY.replace(/-/g, "");

let server: RouteServer;
let jobs: Array<QueuedJob> = [];

const queue: Record<string, jest.Mock> =
  TelemetryQueueService as unknown as Record<string, jest.Mock>;

beforeAll(async () => {
  server = await startRouteServer([SplunkHecAPI, DatadogAPI, SentryAPI]);
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  jobs = [];

  (
    TelemetryIngestionKeyService.getPolicyFromSecretKey as jest.Mock
  ).mockImplementation(async (key: unknown) => {
    return key === INGESTION_KEY ? serverPolicy() : null;
  });

  queue["addLogIngestJob"]!.mockReset().mockImplementation(
    async (req: unknown) => {
      recordJob(jobs, "logs", req as TelemetryRequest);
    },
  );
  queue["addMetricIngestJob"]!.mockReset().mockImplementation(
    async (req: unknown) => {
      recordJob(jobs, "metrics", req as TelemetryRequest);
    },
  );
  queue["addTraceIngestJob"]!.mockReset().mockImplementation(
    async (req: unknown) => {
      recordJob(jobs, "traces", req as TelemetryRequest);
    },
  );
  queue["addProfileIngestJob"]!.mockReset().mockImplementation(
    async (req: unknown) => {
      recordJob(jobs, "profiles", req as TelemetryRequest);
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

const sizesOf: (
  queued: Array<QueuedJob>,
) => Array<[string, number | undefined]> = (
  queued: Array<QueuedJob>,
): Array<[string, number | undefined]> => {
  return queued.map((job: QueuedJob): [string, number | undefined] => {
    return [job.signal, job.ingestBytes];
  });
};

// Whether JSON.parse was ever handed a text at least this long.
const watchParses: () => (length: number) => boolean = (): ((
  length: number,
) => boolean) => {
  const parse: jest.SpyInstance = jest.spyOn(JSON, "parse");

  return (length: number): boolean => {
    return parse.mock.calls.some((call: Array<unknown>): boolean => {
      return typeof call[0] === "string" && call[0].length >= length;
    });
  };
};

// A million and one empty JSON arrays, in an array.
const EMPTY_ARRAYS: string = `[${"[],".repeat(COMPATIBLE_JSON_MAX_VALUES)}[]]`;

describe("Splunk HEC", () => {
  const hec: (path: string) => string = (path: string): string => {
    return `${server.url}${COMPATIBLE_INGEST_URL_PREFIX}${SPLUNK_HEC_BASE_PATH}${path}`;
  };

  const headers: Record<string, string> = {
    authorization: `Splunk ${INGESTION_KEY}`,
  };

  const LOG_EVENT: string = JSON.stringify({
    time: 1700000000.5,
    host: "web-1",
    sourcetype: "app",
    event: { message: "card declined", level: "error", order: 42 },
    fields: { service: "checkout", region: "eu-west-1" },
  });

  const METRIC_EVENT: string = JSON.stringify({
    time: 1700000000,
    event: "metric",
    host: "web-1",
    fields: { "metric_name:cpu.idle": 99.5, region: "eu-west-1" },
  });

  test("a gzipped batch of log events is counted at its body decompressed, not at the OTLP JSON it became", async () => {
    const body: string = `${LOG_EVENT}\n${LOG_EVENT}\n${LOG_EVENT}`;

    const response: RouteResponse = await send(hec("/event"), {
      headers: { ...headers, "content-encoding": "gzip" },
      body: zlib.gzipSync(Buffer.from(body)),
    });

    expect(response.status).toBe(200);
    expect(sizesOf(jobs)).toEqual([["logs", Buffer.byteLength(body)]]);
    expect(JSON.stringify(jobs[0]!.body).length).toBeGreaterThan(
      Buffer.byteLength(body),
    );
  });

  test("a batch of logs and metric events is counted once in all: its two jobs share its size by the records each became", async () => {
    const body: string = `${LOG_EVENT}${LOG_EVENT}${LOG_EVENT}${METRIC_EVENT}`;

    const response: RouteResponse = await send(hec("/event"), {
      headers: headers,
      body: body,
    });

    expect(response.status).toBe(200);

    const size: number = Buffer.byteLength(body);
    const logs: number = jobs.find((job: QueuedJob) => {
      return job.signal === "logs";
    })!.ingestBytes!;
    const metrics: number = jobs.find((job: QueuedJob) => {
      return job.signal === "metrics";
    })!.ingestBytes!;

    // Three log records to one datapoint.
    expect(logs + metrics).toBe(size);
    expect(logs).toBe(Math.round((size * 3) / 4));
  });

  test("a raw batch is counted at its body", async () => {
    const body: string = "one line\nanother line\n";

    await send(hec("/raw"), { headers: headers, body: body });

    expect(sizesOf(jobs)).toEqual([["logs", Buffer.byteLength(body)]]);
  });

  test("an event of a million empty arrays is a 413, in HEC's words, and is never parsed", async () => {
    const body: string = `{"event": ${EMPTY_ARRAYS}}`;
    const parsed: (length: number) => boolean = watchParses();

    const response: RouteResponse = await send(hec("/event"), {
      headers: headers,
      body: body,
    });

    expect(response.status).toBe(413);
    expect(response.json()).toEqual({
      text: `The request holds more than ${COMPATIBLE_JSON_MAX_VALUES} JSON values (objects, arrays, strings and numbers). Send fewer events a request.`,
      code: 6,
    });
    expect(parsed(EMPTY_ARRAYS.length)).toBe(false);
    expect(jobs).toHaveLength(0);
  });

  test("a JSON array of a million empty events is a 413 too", async () => {
    const response: RouteResponse = await send(hec("/event"), {
      headers: headers,
      body: `[${"{},".repeat(COMPATIBLE_JSON_MAX_VALUES)}{}]`,
    });

    expect(response.status).toBe(413);
  });
});

describe("Datadog", () => {
  const datadog: (path: string) => string = (path: string): string => {
    return `${server.url}${COMPATIBLE_INGEST_URL_PREFIX}${DATADOG_BASE_PATH}${path}`;
  };

  const headers: (extra?: Record<string, string>) => Record<string, string> = (
    extra?: Record<string, string>,
  ): Record<string, string> => {
    return {
      "dd-api-key": UNDASHED_KEY,
      "content-type": "application/json",
      ...extra,
    };
  };

  const protobufHeaders: Record<string, string> = headers({
    "content-type": "application/x-protobuf",
    "content-encoding": "deflate",
  });

  const LOGS: string = JSON.stringify([
    {
      message: "card declined",
      status: "error",
      service: "checkout",
      hostname: "web-1",
      ddtags: "env:prod",
    },
    { message: "paid", status: "info", service: "checkout" },
  ]);

  test("logs, gzipped, are counted at their body decompressed", async () => {
    const response: RouteResponse = await send(datadog("/api/v2/logs"), {
      headers: headers({ "content-encoding": "gzip" }),
      body: zlib.gzipSync(Buffer.from(LOGS)),
    });

    expect(response.status).toBe(202);
    expect(sizesOf(jobs)).toEqual([["logs", Buffer.byteLength(LOGS)]]);
  });

  test("v1 series and check runs, deflated, are counted at their body decompressed", async () => {
    const series: string = JSON.stringify({
      series: [
        {
          metric: "system.load.1",
          points: [[1700000000, 0.42]],
          type: "gauge",
          host: "web-1",
        },
      ],
    });
    const checks: string = JSON.stringify([
      { check: "app.ok", host_name: "web-1", status: 0, timestamp: 1700000000 },
    ]);

    await send(datadog("/api/v1/series"), {
      headers: headers({ "content-encoding": "deflate" }),
      body: zlib.deflateSync(Buffer.from(series)),
    });
    await send(datadog("/api/v1/check_run"), {
      headers: headers({ "content-encoding": "deflate" }),
      body: zlib.deflateSync(Buffer.from(checks)),
    });

    expect(sizesOf(jobs)).toEqual([
      ["metrics", Buffer.byteLength(series)],
      ["metrics", Buffer.byteLength(checks)],
    ]);
  });

  test("the Agent's protobuf series and sketches are counted at their protobuf decompressed", async () => {
    const series: Buffer = Buffer.from(
      DatadogMetricPayload.encode(
        DatadogMetricPayload.fromObject({
          series: [
            {
              metric: "system.cpu.user",
              resources: [{ type: "host", name: "web-1" }],
              tags: ["env:prod"],
              points: [{ value: 3, timestamp: 1700000000 }],
              type: 3,
            },
          ],
        }),
      ).finish(),
    );
    const sketches: Buffer = Buffer.from(
      DatadogSketchPayload.encode(
        DatadogSketchPayload.fromObject({
          sketches: [
            {
              metric: "http.latency",
              host: "web-1",
              dogsketches: [
                {
                  ts: 1700000000,
                  cnt: 3,
                  min: 1,
                  max: 9,
                  sum: 12,
                  k: [1, 2],
                  n: [2, 1],
                },
              ],
            },
          ],
        }),
      ).finish(),
    );

    await send(datadog("/api/v2/series"), {
      headers: protobufHeaders,
      body: zlib.deflateSync(series),
    });
    await send(datadog("/api/beta/sketches"), {
      headers: protobufHeaders,
      body: zlib.deflateSync(sketches),
    });

    expect(sizesOf(jobs)).toEqual([
      ["metrics", series.length],
      ["metrics", sketches.length],
    ]);
  });

  test("a small deflated payload of half a million empty series is a 413 in Datadog's words, and is never decoded", async () => {
    const decode: jest.SpyInstance = jest.spyOn(
      DatadogMetricPayloadAsRead,
      "decode",
    );
    const series: number = DATADOG_PROTOBUF_MAX_ELEMENTS + 1;
    const protobuf: Buffer = Buffer.alloc(series * 2);

    for (let index: number = 0; index < series; index++) {
      protobuf[index * 2] = 0x0a;
      protobuf[index * 2 + 1] = 0x00;
    }

    const response: RouteResponse = await send(datadog("/api/v2/series"), {
      headers: protobufHeaders,
      body: zlib.deflateSync(protobuf),
    });

    expect(response.status).toBe(413);
    expect(response.json()).toEqual({
      errors: [
        `The MetricPayload holds more than ${DATADOG_PROTOBUF_MAX_ELEMENTS} series, points, resources, tags and sketches. Send smaller payloads.`,
      ],
    });
    expect(decode).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  test("so is a payload of half a million empty sketches", async () => {
    const decode: jest.SpyInstance = jest.spyOn(
      DatadogSketchPayloadAsRead,
      "decode",
    );
    const protobuf: Buffer = Buffer.alloc(
      (DATADOG_PROTOBUF_MAX_ELEMENTS + 1) * 2,
    );

    for (let index: number = 0; index < protobuf.length; index += 2) {
      protobuf[index] = 0x0a;
      protobuf[index + 1] = 0x00;
    }

    const response: RouteResponse = await send(datadog("/api/beta/sketches"), {
      headers: protobufHeaders,
      body: zlib.deflateSync(protobuf),
    });

    expect(response.status).toBe(413);
    expect(decode).not.toHaveBeenCalled();
  });

  test("a sketch's thousands of bins are not decoded, and its summary is the same", async () => {
    const decode: jest.SpyInstance = jest.spyOn(
      DatadogSketchPayloadAsRead,
      "decode",
    );
    const bins: number = 4000;
    const payload: Buffer = Buffer.from(
      DatadogSketchPayload.encode(
        DatadogSketchPayload.fromObject({
          sketches: [
            {
              metric: "http.latency",
              host: "web-1",
              dogsketches: [
                {
                  ts: 1700000000,
                  cnt: bins,
                  min: 0.5,
                  max: 900,
                  sum: 12345,
                  k: Array.from({ length: bins }, (_: unknown, i: number) => {
                    return i;
                  }),
                  n: Array.from({ length: bins }, () => {
                    return 1;
                  }),
                },
              ],
            },
          ],
        }),
      ).finish(),
    );

    const response: RouteResponse = await send(datadog("/api/beta/sketches"), {
      headers: protobufHeaders,
      body: zlib.deflateSync(payload),
    });

    expect(response.status).toBe(202);

    const decoded: JSONObject = decode.mock.results[0]!.value as JSONObject;
    const dogsketch: JSONObject = (
      (decoded["sketches"] as Array<JSONObject>)[0]![
        "dogsketches"
      ] as Array<JSONObject>
    )[0]!;

    // The bins were stepped over: not read, and no array made for them.
    expect(dogsketch["k"]).toBeUndefined();
    expect(dogsketch["n"]).toBeUndefined();

    const point: JSONObject = (
      (
        (
          (jobs[0]!.body["resourceMetrics"] as Array<JSONObject>)[0]![
            "scopeMetrics"
          ] as Array<JSONObject>
        )[0]!["metrics"] as Array<JSONObject>
      )[0]!["summary"] as JSONObject
    )["dataPoints"] as unknown as JSONObject;

    expect((point as unknown as Array<JSONObject>)[0]).toMatchObject({
      count: String(bins),
      sum: 12345,
      quantileValues: [
        { quantile: 0, value: 0.5 },
        { quantile: 1, value: 900 },
      ],
    });
  });

  test("JSON of a million empty arrays is a 413 on every JSON route, and is never parsed", async () => {
    for (const path of [
      "/api/v2/logs",
      "/api/v1/series",
      "/api/v2/series",
      "/api/v1/check_run",
    ]) {
      const parsed: (length: number) => boolean = watchParses();

      const response: RouteResponse = await send(datadog(path), {
        headers: headers(),
        body: EMPTY_ARRAYS,
      });

      expect({ path, status: response.status }).toEqual({ path, status: 413 });
      expect(response.json()["errors"]).toEqual([
        `The request holds more than ${COMPATIBLE_JSON_MAX_VALUES} JSON values (objects, arrays, strings and numbers). Send smaller payloads.`,
      ]);
      expect(parsed(EMPTY_ARRAYS.length)).toBe(false);
      jest.restoreAllMocks();
    }

    expect(jobs).toHaveLength(0);
  });
});

describe("Sentry", () => {
  const EVENT_ID: string = "fc6d8c0c43fc4630ad850ee518f1b9d0";

  const sentry: (endpoint: "envelope" | "store") => string = (
    endpoint: "envelope" | "store",
  ): string => {
    return `${server.url}${COMPATIBLE_INGEST_URL_PREFIX}${SENTRY_BASE_PATH}/api/1/${endpoint}/`;
  };

  const headers: Record<string, string> = {
    "content-type": "application/x-sentry-envelope",
    "x-sentry-auth": `Sentry sentry_version=7, sentry_client=sentry.python/2.18.0, sentry_key=${UNDASHED_KEY}`,
  };

  const TRANSACTION: string = JSON.stringify({
    type: "transaction",
    event_id: EVENT_ID,
    transaction: "POST /checkout",
    start_timestamp: 1700000000,
    timestamp: 1700000000.25,
    release: "checkout@1.4.2",
    contexts: {
      trace: {
        trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
        span_id: "00f067aa0ba902b7",
        op: "http.server",
      },
    },
    spans: [
      {
        span_id: "00f067aa0ba902b8",
        parent_span_id: "00f067aa0ba902b7",
        op: "db.query",
        description: "SELECT 1",
        start_timestamp: 1700000000.01,
        timestamp: 1700000000.02,
      },
    ],
  });

  const LOG_ITEM: string = JSON.stringify({
    items: [
      { timestamp: 1700000000.3, level: "info", body: "paid" },
      { timestamp: 1700000000.4, level: "warn", body: "slow" },
    ],
  });

  const ERROR: string = JSON.stringify({
    event_id: EVENT_ID,
    timestamp: 1700000000.5,
    platform: "python",
    exception: {
      values: [{ type: "ValueError", value: "bad amount" }],
    },
  });

  const envelopeOf: (items: Array<[JSONObject, string]>) => string = (
    items: Array<[JSONObject, string]>,
  ): string => {
    const lines: Array<string> = [JSON.stringify({ event_id: EVENT_ID })];

    for (const [header, payload] of items) {
      lines.push(JSON.stringify(header), payload);
    }

    return `${lines.join("\n")}\n`;
  };

  test("an envelope's traces and logs are each counted at the bytes of the items they came from", async () => {
    const response: RouteResponse = await send(sentry("envelope"), {
      headers: { ...headers, "content-encoding": "gzip" },
      body: zlib.gzipSync(
        Buffer.from(
          envelopeOf([
            [{ type: "transaction" }, TRANSACTION],
            [{ type: "log", item_count: 2 }, LOG_ITEM],
          ]),
        ),
      ),
    });

    expect(response.status).toBe(200);
    expect(sizesOf(jobs)).toEqual([
      ["logs", Buffer.byteLength(LOG_ITEM)],
      ["traces", Buffer.byteLength(TRANSACTION)],
    ]);
  });

  test("an envelope's attachment and replay - not kept - are not counted, nor a profile with no samples to read", async () => {
    const attachment: string = "x".repeat(200000);

    const response: RouteResponse = await send(sentry("envelope"), {
      headers: headers,
      body: envelopeOf([
        [{ type: "event" }, ERROR],
        [{ type: "attachment", length: attachment.length }, attachment],
        [{ type: "replay_recording", length: 5 }, "abcde"],
        [{ type: "profile" }, '{"frames":[]}'],
      ]),
    });

    expect(response.status).toBe(200);
    expect(sizesOf(jobs)).toEqual([["traces", Buffer.byteLength(ERROR)]]);
  });

  test("an envelope's profile is a profiles job, counted at its bytes; its check-ins and feedback count as logs", async () => {
    const profile: string = JSON.stringify({
      event_id: "3b2f5dd2f3374e2f8e0e0f2d6c8b1a77",
      platform: "python",
      release: "checkout@1.4.2",
      timestamp: 1700000000,
      version: "1",
      transactions: [],
      profile: {
        frames: [{ function: "main", filename: "main.py", lineno: 1 }],
        stacks: [[0]],
        samples: [
          { elapsed_since_start_ns: "0", thread_id: "1", stack_id: 0 },
          { elapsed_since_start_ns: "10000000", thread_id: "1", stack_id: 0 },
        ],
        thread_metadata: {},
      },
    });
    const checkIn: string = JSON.stringify({
      check_in_id: "6e1d8c2a4f5b4f7f9a3c2b1d0e9f8a7b",
      monitor_slug: "nightly-backup",
      status: "ok",
    });
    const feedback: string = JSON.stringify({
      event_id: "1f2e3d4c5b6a49788796a5b4c3d2e1f0",
      contexts: { feedback: { message: "The button does nothing." } },
    });

    const response: RouteResponse = await send(sentry("envelope"), {
      headers: headers,
      body: envelopeOf([
        [{ type: "event" }, ERROR],
        [{ type: "profile" }, profile],
        [{ type: "check_in" }, checkIn],
        [{ type: "feedback" }, feedback],
      ]),
    });

    expect(response.status).toBe(200);
    expect(sizesOf(jobs)).toEqual([
      ["logs", Buffer.byteLength(checkIn) + Buffer.byteLength(feedback)],
      ["traces", Buffer.byteLength(ERROR)],
      ["profiles", Buffer.byteLength(profile)],
    ]);
    expect(jobs[2]!.productType).toBe("Profiles");
    expect(jobs[2]!.budgetCharge).toBe("absent");
  });

  test("a store event is counted at its body", async () => {
    const response: RouteResponse = await send(sentry("store"), {
      headers: { ...headers, "content-type": "application/json" },
      body: ERROR,
    });

    expect(response.status).toBe(200);
    expect(sizesOf(jobs)).toEqual([["traces", Buffer.byteLength(ERROR)]]);
  });

  test("an event of a million empty arrays is a 413 in Sentry's words, and is never parsed", async () => {
    const event: string = `{"extra": ${EMPTY_ARRAYS}}`;
    const parsed: (length: number) => boolean = watchParses();

    const response: RouteResponse = await send(sentry("envelope"), {
      headers: headers,
      body: envelopeOf([[{ type: "event" }, event]]),
    });

    expect(response.status).toBe(413);
    expect(response.json()).toEqual({
      detail: `The request holds more than ${COMPATIBLE_JSON_MAX_VALUES} JSON values (objects, arrays, strings and numbers). Send fewer items an envelope.`,
    });
    expect(parsed(event.length)).toBe(false);
    expect(jobs).toHaveLength(0);
  });

  test("the envelope's items share one limit: items each under it are refused together", async () => {
    const half: string = `{"extra": [${"[],".repeat(COMPATIBLE_JSON_MAX_VALUES / 2)}[]]}`;

    const response: RouteResponse = await send(sentry("envelope"), {
      headers: headers,
      body: envelopeOf([
        [{ type: "event" }, half],
        [{ type: "event" }, half],
      ]),
    });

    expect(response.status).toBe(413);
  });

  test("a header line of a million empty arrays is a 413", async () => {
    const response: RouteResponse = await send(sentry("envelope"), {
      headers: headers,
      body: `${JSON.stringify({ event_id: EVENT_ID })}\n{"type":"event","x":${EMPTY_ARRAYS}}\n${ERROR}\n`,
    });

    expect(response.status).toBe(413);
  });

  test("an attachment of a million empty arrays is never parsed, so never refused", async () => {
    const response: RouteResponse = await send(sentry("envelope"), {
      headers: headers,
      body: envelopeOf([
        [{ type: "event" }, ERROR],
        [{ type: "attachment", length: EMPTY_ARRAYS.length }, EMPTY_ARRAYS],
      ]),
    });

    expect(response.status).toBe(200);
    expect(jobs).toHaveLength(1);
  });

  test("a store event of a million empty arrays is a 413, and is never parsed", async () => {
    const event: string = `{"extra": ${EMPTY_ARRAYS}}`;
    const parsed: (length: number) => boolean = watchParses();

    const response: RouteResponse = await send(sentry("store"), {
      headers: { ...headers, "content-type": "application/json" },
      body: event,
    });

    expect(response.status).toBe(413);
    expect(parsed(event.length)).toBe(false);
  });
});
