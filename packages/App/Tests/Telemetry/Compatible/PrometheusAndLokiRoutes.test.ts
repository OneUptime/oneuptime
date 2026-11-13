import zlib from "zlib";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionBudget from "Common/Server/Utils/Telemetry/TelemetryIngestionBudget";
import { JSONObject } from "Common/Types/JSON";
import {
  COMPATIBLE_INGEST_URL_PREFIX,
  LOKI_PUSH_PATH,
  PROMETHEUS_REMOTE_WRITE_PATH,
} from "Common/Types/Telemetry/CompatibleIngest";
import PrometheusRemoteWriteAPI from "../../../FeatureSet/Telemetry/API/PrometheusRemoteWrite";
import LokiAPI from "../../../FeatureSet/Telemetry/API/Loki";
import TelemetryQueueService from "../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import { WriteRequestV1 } from "../../../FeatureSet/Telemetry/Utils/Compatible/PrometheusRemoteWrite";
import { LokiPushRequestType } from "../../../FeatureSet/Telemetry/Utils/Compatible/LokiPush";
import { snappyCompress } from "./SnappyTestCompressor";
import {
  INGESTION_KEY,
  PROJECT_ID,
  QueuedJob,
  RouteResponse,
  RouteServer,
  basicAuth,
  recordJob,
  send,
  serverPolicy,
  startRouteServer,
} from "./CompatibleIngestRouteHarness";

/*
 * Prometheus remote write and Loki's push API, end to end over HTTP: the
 * credentials their clients send are accepted, an unknown or missing key
 * is refused before the body is read, each body is decoded however its
 * client encodes it, the translated OTLP is queued as its signal with the
 * door's budget charge, and every answer is the one the protocol defines.
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

jest.mock("Common/Server/Utils/Telemetry/TelemetryIngestionBudget", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Telemetry/TelemetryIngestionBudget",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: { admit: jest.fn() },
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
      },
    };
  },
);

const PENDING_CHARGE: JSONObject = { isPending: true, isExact: false };

let server: RouteServer;
let jobs: Array<QueuedJob> = [];

const queue: {
  addLogIngestJob: jest.Mock;
  addMetricIngestJob: jest.Mock;
  addTraceIngestJob: jest.Mock;
} = TelemetryQueueService as unknown as {
  addLogIngestJob: jest.Mock;
  addMetricIngestJob: jest.Mock;
  addTraceIngestJob: jest.Mock;
};

beforeAll(async () => {
  server = await startRouteServer([PrometheusRemoteWriteAPI, LokiAPI]);
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

  (TelemetryIngestionBudget.admit as jest.Mock).mockResolvedValue({
    charge: PENDING_CHARGE,
  } as never);

  queue.addLogIngestJob.mockReset().mockImplementation(async (req: unknown) => {
    recordJob(jobs, "logs", req as TelemetryRequest);
  });
  queue.addMetricIngestJob
    .mockReset()
    .mockImplementation(async (req: unknown) => {
      recordJob(jobs, "metrics", req as TelemetryRequest);
    });
  queue.addTraceIngestJob
    .mockReset()
    .mockImplementation(async (req: unknown) => {
      recordJob(jobs, "traces", req as TelemetryRequest);
    });
});

const writeRequest: () => Buffer = (): Buffer => {
  return Buffer.from(
    WriteRequestV1.encode(
      WriteRequestV1.fromObject({
        timeseries: [
          {
            labels: [
              { name: "__name__", value: "http_requests_total" },
              { name: "job", value: "checkout" },
              { name: "instance", value: "10.0.0.7:9090" },
            ],
            samples: [{ value: 7, timestamp: 1700000000000 }],
          },
        ],
      }),
    ).finish(),
  );
};

const remoteWriteHeaders: (
  authorization: string,
  extra?: Record<string, string>,
) => Record<string, string> = (
  authorization: string,
  extra?: Record<string, string>,
): Record<string, string> => {
  return {
    authorization: authorization,
    "content-type": "application/x-protobuf",
    "content-encoding": "snappy",
    "x-prometheus-remote-write-version": "0.1.0",
    ...extra,
  };
};

describe("Prometheus remote write - POST /prometheus/api/v1/write", () => {
  test("a Prometheus server's write with a bearer token is queued as metrics and answered 204", async () => {
    const response: RouteResponse = await send(
      `${server.url}${PROMETHEUS_REMOTE_WRITE_PATH}`,
      {
        headers: remoteWriteHeaders(`Bearer ${INGESTION_KEY}`),
        body: snappyCompress(writeRequest()),
      },
    );

    expect(response.status).toBe(204);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      signal: "metrics",
      productType: "Metrics",
      contentType: "application/json",
      contentEncoding: undefined,
      budgetCharge: PENDING_CHARGE,
      projectId: PROJECT_ID,
    });

    const metric: JSONObject = (
      (
        (jobs[0]!.body["resourceMetrics"] as Array<JSONObject>)[0]![
          "scopeMetrics"
        ] as Array<JSONObject>
      )[0]!["metrics"] as Array<JSONObject>
    )[0]!;

    expect(metric["name"]).toBe("http_requests_total");
  });

  test("basic_auth with the key as the password works under /telemetry too", async () => {
    const response: RouteResponse = await send(
      `${server.url}${COMPATIBLE_INGEST_URL_PREFIX}${PROMETHEUS_REMOTE_WRITE_PATH}`,
      {
        headers: remoteWriteHeaders(basicAuth("12345", INGESTION_KEY)),
        body: snappyCompress(writeRequest()),
      },
    );

    expect(response.status).toBe(204);
    expect(jobs).toHaveLength(1);
  });

  test("a key written as 32 hex digits without hyphens is accepted", async () => {
    const response: RouteResponse = await send(
      `${server.url}${PROMETHEUS_REMOTE_WRITE_PATH}`,
      {
        headers: remoteWriteHeaders(
          `Bearer ${INGESTION_KEY.replace(/-/g, "")}`,
        ),
        body: snappyCompress(writeRequest()),
      },
    );

    expect(response.status).toBe(204);
  });

  test("a body sent without Content-Encoding is still read as snappy", async () => {
    const headers: Record<string, string> = remoteWriteHeaders(
      `Bearer ${INGESTION_KEY}`,
    );
    delete headers["content-encoding"];

    const response: RouteResponse = await send(
      `${server.url}${PROMETHEUS_REMOTE_WRITE_PATH}`,
      { headers: headers, body: snappyCompress(writeRequest()) },
    );

    expect(response.status).toBe(204);
    expect(jobs).toHaveLength(1);
  });

  test("remote write 2.0 is told how many samples were written", async () => {
    const { WriteRequestV2 } = jest.requireActual(
      "../../../FeatureSet/Telemetry/Utils/Compatible/PrometheusRemoteWrite",
    ) as typeof import("../../../FeatureSet/Telemetry/Utils/Compatible/PrometheusRemoteWrite");

    const body: Buffer = Buffer.from(
      WriteRequestV2.encode(
        WriteRequestV2.fromObject({
          symbols: ["", "__name__", "up", "job", "node"],
          timeseries: [
            {
              labelsRefs: [1, 2, 3, 4],
              samples: [
                { value: 1, timestamp: 1700000000000 },
                { value: 1, timestamp: 1700000015000 },
              ],
              metadata: { type: 2 },
            },
          ],
        }),
      ).finish(),
    );

    const response: RouteResponse = await send(
      `${server.url}${PROMETHEUS_REMOTE_WRITE_PATH}`,
      {
        headers: remoteWriteHeaders(`Bearer ${INGESTION_KEY}`, {
          "content-type":
            "application/x-protobuf;proto=io.prometheus.write.v2.Request",
          "x-prometheus-remote-write-version": "2.0.0",
        }),
        body: snappyCompress(body),
      },
    );

    expect(response.status).toBe(204);
    expect(
      response.headers.get("x-prometheus-remote-write-samples-written"),
    ).toBe("2");
    expect(
      response.headers.get("x-prometheus-remote-write-histograms-written"),
    ).toBe("0");
  });

  test("no key is a 401, and nothing is queued", async () => {
    const response: RouteResponse = await send(
      `${server.url}${PROMETHEUS_REMOTE_WRITE_PATH}`,
      {
        headers: {
          "content-type": "application/x-protobuf",
          "content-encoding": "snappy",
        },
        body: snappyCompress(writeRequest()),
      },
    );

    expect(response.status).toBe(401);
    expect(jobs).toHaveLength(0);
  });

  test("an unknown key is a 401", async () => {
    const response: RouteResponse = await send(
      `${server.url}${PROMETHEUS_REMOTE_WRITE_PATH}`,
      {
        headers: remoteWriteHeaders(
          "Bearer 00000000-0000-4000-8000-000000000000",
        ),
        body: snappyCompress(writeRequest()),
      },
    );

    expect(response.status).toBe(401);
    expect(jobs).toHaveLength(0);
  });

  test("a proto it does not read is a 415", async () => {
    const response: RouteResponse = await send(
      `${server.url}${PROMETHEUS_REMOTE_WRITE_PATH}`,
      {
        headers: remoteWriteHeaders(`Bearer ${INGESTION_KEY}`, {
          "content-type":
            "application/x-protobuf;proto=io.prometheus.write.v3.Request",
        }),
        body: snappyCompress(writeRequest()),
      },
    );

    expect(response.status).toBe(415);
    expect(response.text).toContain("prometheus.WriteRequest");
  });

  test("a content coding it cannot undo is a 415", async () => {
    const response: RouteResponse = await send(
      `${server.url}${PROMETHEUS_REMOTE_WRITE_PATH}`,
      {
        headers: remoteWriteHeaders(`Bearer ${INGESTION_KEY}`, {
          "content-encoding": "lz4",
        }),
        body: writeRequest(),
      },
    );

    expect(response.status).toBe(415);
  });

  test("a body that is not a write request is a plain-text 400", async () => {
    const response: RouteResponse = await send(
      `${server.url}${PROMETHEUS_REMOTE_WRITE_PATH}`,
      {
        headers: remoteWriteHeaders(`Bearer ${INGESTION_KEY}`),
        body: snappyCompress(Buffer.from([0x0a, 0xff, 0xff, 0xff, 0xff, 0x0f])),
      },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(jobs).toHaveLength(0);
  });

  test("a snappy body that lies about itself is a 400", async () => {
    const response: RouteResponse = await send(
      `${server.url}${PROMETHEUS_REMOTE_WRITE_PATH}`,
      {
        headers: remoteWriteHeaders(`Bearer ${INGESTION_KEY}`),
        body: Buffer.from([0x05, 0x00, 0x61]),
      },
    );

    expect(response.status).toBe(400);
  });

  test("when the queue cannot take it, a 503 a sender retries", async () => {
    queue.addMetricIngestJob.mockRejectedValue(
      new Error("redis down") as never,
    );

    const response: RouteResponse = await send(
      `${server.url}${PROMETHEUS_REMOTE_WRITE_PATH}`,
      {
        headers: remoteWriteHeaders(`Bearer ${INGESTION_KEY}`),
        body: snappyCompress(writeRequest()),
      },
    );

    expect(response.status).toBe(503);
  });

  test("a write with nothing to keep (only staleness markers) is still a 204", async () => {
    const body: Buffer = Buffer.from(
      WriteRequestV1.encode(
        WriteRequestV1.fromObject({
          timeseries: [
            {
              labels: [{ name: "__name__", value: "up" }],
              samples: [{ value: Number.NaN, timestamp: 1700000000000 }],
            },
          ],
        }),
      ).finish(),
    );

    const response: RouteResponse = await send(
      `${server.url}${PROMETHEUS_REMOTE_WRITE_PATH}`,
      {
        headers: remoteWriteHeaders(`Bearer ${INGESTION_KEY}`),
        body: snappyCompress(body),
      },
    );

    expect(response.status).toBe(204);
    expect(jobs).toHaveLength(0);
  });

  test("an x-oneuptime-service-name header names the service", async () => {
    await send(`${server.url}${PROMETHEUS_REMOTE_WRITE_PATH}`, {
      headers: remoteWriteHeaders(`Bearer ${INGESTION_KEY}`, {
        "x-oneuptime-service-name": "payments",
      }),
      body: snappyCompress(writeRequest()),
    });

    const resource: JSONObject = (
      jobs[0]!.body["resourceMetrics"] as Array<JSONObject>
    )[0]!["resource"] as JSONObject;

    expect(resource["attributes"]).toContainEqual({
      key: "service.name",
      value: { stringValue: "payments" },
    });
  });
});

const lokiJson: string = JSON.stringify({
  streams: [
    {
      stream: { app: "checkout", env: "prod" },
      values: [["1700000000000000000", 'level=error msg="payment failed"']],
    },
  ],
});

describe("Loki - POST /loki/api/v1/push", () => {
  test("a JSON push with basic auth is queued as logs and answered 204", async () => {
    const response: RouteResponse = await send(
      `${server.url}${LOKI_PUSH_PATH}`,
      {
        headers: {
          authorization: basicAuth("oneuptime", INGESTION_KEY),
          "content-type": "application/json",
        },
        body: lokiJson,
      },
    );

    expect(response.status).toBe(204);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      signal: "logs",
      productType: "Logs",
      budgetCharge: PENDING_CHARGE,
    });

    const record: JSONObject = (
      (
        (jobs[0]!.body["resourceLogs"] as Array<JSONObject>)[0]![
          "scopeLogs"
        ] as Array<JSONObject>
      )[0]!["logRecords"] as Array<JSONObject>
    )[0]!;

    expect(record["severityNumber"]).toBe(17);
  });

  test("a gzipped JSON push under /telemetry, with a bearer token", async () => {
    const response: RouteResponse = await send(
      `${server.url}${COMPATIBLE_INGEST_URL_PREFIX}${LOKI_PUSH_PATH}`,
      {
        headers: {
          authorization: `Bearer ${INGESTION_KEY}`,
          "content-type": "application/json",
          "content-encoding": "gzip",
        },
        body: zlib.gzipSync(Buffer.from(lokiJson)),
      },
    );

    expect(response.status).toBe(204);
    expect(jobs).toHaveLength(1);
  });

  test("a snappy protobuf push, as Promtail sends it (no Content-Encoding header)", async () => {
    const body: Buffer = Buffer.from(
      LokiPushRequestType.encode(
        LokiPushRequestType.fromObject({
          streams: [
            {
              labels: '{job="varlogs"}',
              entries: [
                { timestamp: { seconds: 1700000000 }, line: "hello" },
                { timestamp: { seconds: 1700000001 }, line: "world" },
              ],
            },
          ],
        }),
      ).finish(),
    );

    const response: RouteResponse = await send(
      `${server.url}${LOKI_PUSH_PATH}`,
      {
        headers: {
          "x-oneuptime-token": INGESTION_KEY,
          "content-type": "application/x-protobuf",
        },
        body: snappyCompress(body),
      },
    );

    expect(response.status).toBe(204);

    const records: Array<JSONObject> = (
      (jobs[0]!.body["resourceLogs"] as Array<JSONObject>)[0]![
        "scopeLogs"
      ] as Array<JSONObject>
    )[0]!["logRecords"] as Array<JSONObject>;

    expect(records).toHaveLength(2);
  });

  test("a protobuf push that is not snappy is a plain-text 400", async () => {
    const response: RouteResponse = await send(
      `${server.url}${LOKI_PUSH_PATH}`,
      {
        headers: {
          "x-oneuptime-token": INGESTION_KEY,
          "content-type": "application/x-protobuf",
        },
        body: Buffer.from([0x0a, 0x02, 0x08, 0x01, 0xff]),
      },
    );

    expect(response.status).toBe(400);
    expect(response.text).toContain("snappy");
  });

  test("a body that is not JSON is a 400 that says why", async () => {
    const response: RouteResponse = await send(
      `${server.url}${LOKI_PUSH_PATH}`,
      {
        headers: {
          "x-oneuptime-token": INGESTION_KEY,
          "content-type": "application/json",
        },
        body: "{not json",
      },
    );

    expect(response.status).toBe(400);
    expect(response.text).toContain("JSON");
  });

  test("no key is a 401", async () => {
    const response: RouteResponse = await send(
      `${server.url}${LOKI_PUSH_PATH}`,
      { headers: { "content-type": "application/json" }, body: lokiJson },
    );

    expect(response.status).toBe(401);
    expect(jobs).toHaveLength(0);
  });

  test("a push with no entries is answered 204 and queues nothing", async () => {
    const response: RouteResponse = await send(
      `${server.url}${LOKI_PUSH_PATH}`,
      {
        headers: {
          "x-oneuptime-token": INGESTION_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({ streams: [] }),
      },
    );

    expect(response.status).toBe(204);
    expect(jobs).toHaveLength(0);
  });

  test("a used-up logs budget is refused at the door, before the body is read", async () => {
    (TelemetryIngestionBudget.admit as jest.Mock).mockResolvedValue({
      refusal: {
        kind: "daily-budget",
        scope: "project",
        retryAfterSeconds: 3600,
      },
    } as never);

    const response: RouteResponse = await send(
      `${server.url}${LOKI_PUSH_PATH}`,
      {
        headers: {
          "x-oneuptime-token": INGESTION_KEY,
          "content-type": "application/json",
        },
        body: lokiJson,
      },
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(jobs).toHaveLength(0);
  });
});
