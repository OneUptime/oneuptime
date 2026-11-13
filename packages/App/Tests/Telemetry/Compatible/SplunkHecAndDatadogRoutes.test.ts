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
  DATADOG_BASE_PATH,
  SPLUNK_HEC_BASE_PATH,
} from "Common/Types/Telemetry/CompatibleIngest";
import SplunkHecAPI from "../../../FeatureSet/Telemetry/API/SplunkHec";
import DatadogAPI from "../../../FeatureSet/Telemetry/API/Datadog";
import TelemetryQueueService from "../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import {
  DatadogMetricPayload,
  DatadogSketchPayload,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/DatadogIntake";
import {
  INGESTION_KEY,
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
 * Splunk's HTTP Event Collector and Datadog's intake, end to end over
 * HTTP: each accepts the credential its clients send, answers in its own
 * protocol's words (HEC's {"text", "code"}, Datadog's 202s and
 * {"errors"}), queues logs and metrics as separate jobs counted against
 * their own budgets, and - Datadog at the root - steps aside for a request
 * that is not Datadog's.
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

const UNDASHED_KEY: string = INGESTION_KEY.replace(/-/g, "");

let server: RouteServer;
let jobs: Array<QueuedJob> = [];

const queue: Record<string, jest.Mock> =
  TelemetryQueueService as unknown as Record<string, jest.Mock>;

beforeAll(async () => {
  server = await startRouteServer([SplunkHecAPI, DatadogAPI]);
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

  (TelemetryIngestionBudget.admit as jest.Mock).mockReset();

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
});

const logRecordsOf: (job: QueuedJob) => Array<JSONObject> = (
  job: QueuedJob,
): Array<JSONObject> => {
  const records: Array<JSONObject> = [];

  for (const resourceLog of job.body["resourceLogs"] as Array<JSONObject>) {
    for (const scopeLog of resourceLog["scopeLogs"] as Array<JSONObject>) {
      records.push(...(scopeLog["logRecords"] as Array<JSONObject>));
    }
  }

  return records;
};

const metricNamesOf: (job: QueuedJob) => Array<string> = (
  job: QueuedJob,
): Array<string> => {
  const names: Array<string> = [];

  for (const resourceMetric of job.body[
    "resourceMetrics"
  ] as Array<JSONObject>) {
    for (const scopeMetric of resourceMetric[
      "scopeMetrics"
    ] as Array<JSONObject>) {
      for (const metric of scopeMetric["metrics"] as Array<JSONObject>) {
        names.push(metric["name"] as string);
      }
    }
  }

  return names;
};

const HEC_BATCH: string =
  '{"time": 1700000000.123, "host": "web-1", "sourcetype": "app", "event": {"message": "payment failed", "level": "error"}, "fields": {"service": "checkout"}}' +
  "\n" +
  '{"time": 1700000001, "event": "metric", "host": "web-1", "fields": {"metric_name:cpu.usage": 42.5, "region": "eu"}}';

describe("Splunk HTTP Event Collector", () => {
  const hec: (path: string) => string = (path: string): string => {
    return `${server.url}${path}`;
  };

  test("a batch of a log and a metric event: HEC's Success, and a job for each signal", async () => {
    const response: RouteResponse = await send(
      hec(`${SPLUNK_HEC_BASE_PATH}/event`),
      {
        headers: { authorization: `Splunk ${INGESTION_KEY}` },
        body: HEC_BATCH,
      },
    );

    expect(response.status).toBe(200);
    expect(response.json()).toEqual({ text: "Success", code: 0 });
    expect(
      jobs.map((job: QueuedJob) => {
        return job.signal;
      }),
    ).toEqual(["logs", "metrics"]);

    // No door charge: each signal is counted against its own budget as queued.
    expect(TelemetryIngestionBudget.admit as jest.Mock).not.toHaveBeenCalled();
    expect(jobs[0]!.budgetCharge).toBe("absent");
    expect(jobs[1]!.budgetCharge).toBe("absent");

    const record: JSONObject = logRecordsOf(jobs[0]!)[0]!;

    expect(record["body"]).toEqual({ stringValue: "payment failed" });
    expect(record["severityNumber"]).toBe(17);
    expect(metricNamesOf(jobs[1]!)).toEqual(["cpu.usage"]);
  });

  test.each<[string]>([
    [SPLUNK_HEC_BASE_PATH],
    [`${SPLUNK_HEC_BASE_PATH}/event/1.0`],
    [`${COMPATIBLE_INGEST_URL_PREFIX}${SPLUNK_HEC_BASE_PATH}/event`],
  ])("%s takes events too, with basic auth", async (path: string) => {
    const response: RouteResponse = await send(hec(path), {
      headers: { authorization: basicAuth("x", INGESTION_KEY) },
      body: '{"event": "hello"}',
    });

    expect(response.status).toBe(200);
    expect(jobs).toHaveLength(1);
  });

  test("a gzipped batch, as Fluent Bit's splunk output sends it with Compress gzip", async () => {
    const response: RouteResponse = await send(
      hec(`${SPLUNK_HEC_BASE_PATH}/event`),
      {
        headers: {
          authorization: `Splunk ${INGESTION_KEY}`,
          "content-encoding": "gzip",
        },
        body: zlib.gzipSync(Buffer.from(HEC_BATCH)),
      },
    );

    expect(response.status).toBe(200);
    expect(jobs).toHaveLength(2);
  });

  test("an event that is not JSON is HEC's Invalid data format, with its number", async () => {
    const response: RouteResponse = await send(
      hec(`${SPLUNK_HEC_BASE_PATH}/event`),
      {
        headers: { authorization: `Splunk ${INGESTION_KEY}` },
        body: '{"event": "one"}{"event": "two"}{"event": ',
      },
    );

    expect(response.status).toBe(400);
    expect(response.json()).toEqual({
      text: "Invalid data format",
      code: 6,
      "invalid-event-number": 2,
    });
    expect(jobs).toHaveLength(0);
  });

  test("an event with no event field is HEC's code 12", async () => {
    const response: RouteResponse = await send(
      hec(`${SPLUNK_HEC_BASE_PATH}/event`),
      {
        headers: { authorization: `Splunk ${INGESTION_KEY}` },
        body: '{"event": "fine"}{"time": 1}',
      },
    );

    expect(response.status).toBe(400);
    expect(response.json()).toMatchObject({
      code: 12,
      "invalid-event-number": 1,
    });
  });

  test("an empty body is HEC's No data", async () => {
    const response: RouteResponse = await send(
      hec(`${SPLUNK_HEC_BASE_PATH}/event`),
      {
        headers: { authorization: `Splunk ${INGESTION_KEY}` },
        body: "   ",
      },
    );

    expect(response.status).toBe(400);
    expect(response.json()).toEqual({ text: "No data", code: 5 });
  });

  test("the raw endpoint takes lines, with metadata from the query string", async () => {
    const response: RouteResponse = await send(
      hec(`${SPLUNK_HEC_BASE_PATH}/raw?sourcetype=nginx&host=edge-1&index=web`),
      {
        headers: { authorization: `Splunk ${INGESTION_KEY}` },
        body: "GET / 200\nGET /pay 500\n",
      },
    );

    expect(response.status).toBe(200);

    const resource: JSONObject = (
      jobs[0]!.body["resourceLogs"] as Array<JSONObject>
    )[0]!["resource"] as JSONObject;

    expect(resource["attributes"]).toEqual(
      expect.arrayContaining([
        { key: "host.name", value: { stringValue: "edge-1" } },
        { key: "com.splunk.sourcetype", value: { stringValue: "nginx" } },
        { key: "com.splunk.index", value: { stringValue: "web" } },
      ]),
    );
    expect(logRecordsOf(jobs[0]!)).toHaveLength(2);
  });

  test("an empty raw body is HEC's No data", async () => {
    const response: RouteResponse = await send(
      hec(`${COMPATIBLE_INGEST_URL_PREFIX}${SPLUNK_HEC_BASE_PATH}/raw`),
      {
        headers: { authorization: `Splunk ${INGESTION_KEY}` },
        body: "\n\n",
      },
    );

    expect(response.status).toBe(400);
    expect(response.json()).toEqual({ text: "No data", code: 5 });
  });

  test.each<[string]>([
    [`${SPLUNK_HEC_BASE_PATH}/health`],
    [`${COMPATIBLE_INGEST_URL_PREFIX}${SPLUNK_HEC_BASE_PATH}/health`],
  ])("%s answers HEC is healthy without a token", async (path: string) => {
    const response: RouteResponse = await send(hec(path), { method: "GET" });

    expect(response.status).toBe(200);
    expect(response.json()).toEqual({ text: "HEC is healthy", code: 17 });
  });

  test("no token is a 401", async () => {
    const response: RouteResponse = await send(
      hec(`${SPLUNK_HEC_BASE_PATH}/event`),
      { body: '{"event": "x"}' },
    );

    expect(response.status).toBe(401);
    expect(jobs).toHaveLength(0);
  });

  test("a queue that cannot take it is HEC's Server is busy, a 503 clients retry", async () => {
    queue["addLogIngestJob"]!.mockRejectedValue(new Error("down") as never);

    const response: RouteResponse = await send(
      hec(`${SPLUNK_HEC_BASE_PATH}/event`),
      {
        headers: { authorization: `Splunk ${INGESTION_KEY}` },
        body: '{"event": "x"}',
      },
    );

    expect(response.status).toBe(503);
    expect(response.json()).toEqual({ text: "Server is busy", code: 9 });
  });
});

describe("Datadog intake", () => {
  const datadog: (path: string) => string = (path: string): string => {
    return `${server.url}${COMPATIBLE_INGEST_URL_PREFIX}${DATADOG_BASE_PATH}${path}`;
  };

  const LOGS: string = JSON.stringify([
    {
      message: "card declined",
      status: "error",
      service: "checkout",
      hostname: "web-1",
      ddtags: "env:prod,version:1.4.2",
      timestamp: 1700000000000,
    },
  ]);

  test("logs, gzipped, with the key as DD-API-KEY in Datadog's 32-hex form", async () => {
    const response: RouteResponse = await send(datadog("/api/v2/logs"), {
      headers: {
        "dd-api-key": UNDASHED_KEY,
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      body: zlib.gzipSync(Buffer.from(LOGS)),
    });

    expect(response.status).toBe(202);
    expect(response.json()).toEqual({});
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.signal).toBe("logs");
    expect(logRecordsOf(jobs[0]!)[0]!["severityNumber"]).toBe(17);
  });

  test("the Agent's logs at the root /api/v2/logs, as logs_dd_url sends them", async () => {
    const response: RouteResponse = await send(`${server.url}/api/v2/logs`, {
      headers: {
        "dd-api-key": INGESTION_KEY,
        "content-type": "application/json",
      },
      body: LOGS,
    });

    expect(response.status).toBe(202);
    expect(jobs).toHaveLength(1);
  });

  test("only logs are served at the root: dd_url takes a path, so nothing else needs to be", async () => {
    const response: RouteResponse = await send(`${server.url}/api/v1/series`, {
      headers: {
        "dd-api-key": INGESTION_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ series: [] }),
    });

    expect(response.status).toBe(404);
    expect(jobs).toHaveLength(0);
  });

  test("the root logs route steps aside for a request without a DD-API-KEY, to OneUptime's own API", async () => {
    const response: RouteResponse = await send(`${server.url}/api/v2/logs`, {
      headers: { "x-oneuptime-token": INGESTION_KEY },
      body: LOGS,
    });

    // Nothing else is mounted in this suite, so the request ends unmatched.
    expect(response.status).toBe(404);
    expect(jobs).toHaveLength(0);
  });

  test("v1 series, deflated as the Agent sends them", async () => {
    const series: string = JSON.stringify({
      series: [
        {
          metric: "system.load.1",
          points: [[1700000000, 0.42]],
          type: "gauge",
          host: "web-1",
          tags: ["env:prod"],
        },
      ],
    });

    const response: RouteResponse = await send(datadog("/api/v1/series"), {
      headers: {
        "dd-api-key": INGESTION_KEY,
        "content-type": "application/json",
        "content-encoding": "deflate",
      },
      body: zlib.deflateSync(Buffer.from(series)),
    });

    expect(response.status).toBe(202);
    expect(response.json()).toEqual({ status: "ok" });
    expect(metricNamesOf(jobs[0]!)).toEqual(["system.load.1"]);
  });

  test("v2 series as the Agent's protobuf MetricPayload", async () => {
    const payload: Buffer = Buffer.from(
      DatadogMetricPayload.encode(
        DatadogMetricPayload.fromObject({
          series: [
            {
              resources: [{ type: "host", name: "web-1" }],
              metric: "datadog.agent.running",
              tags: ["version:7.60.0"],
              points: [{ value: 1, timestamp: 1700000000 }],
              type: 3,
            },
          ],
        }),
      ).finish(),
    );

    const response: RouteResponse = await send(datadog("/api/v2/series"), {
      headers: {
        "dd-api-key": INGESTION_KEY,
        "content-type": "application/x-protobuf",
        "content-encoding": "deflate",
      },
      body: zlib.deflateSync(payload),
    });

    expect(response.status).toBe(202);
    expect(response.json()).toEqual({ errors: [] });
    expect(metricNamesOf(jobs[0]!)).toEqual(["datadog.agent.running"]);
  });

  test("v2 series as Datadog's JSON API takes them", async () => {
    const response: RouteResponse = await send(datadog("/api/v2/series"), {
      headers: {
        "dd-api-key": INGESTION_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        series: [
          {
            metric: "orders.placed",
            type: 1,
            points: [{ timestamp: 1700000000, value: 3 }],
            interval: 10,
          },
        ],
      }),
    });

    expect(response.status).toBe(202);
    expect(metricNamesOf(jobs[0]!)).toEqual(["orders.placed"]);
  });

  test("sketches, as the Agent sends distributions", async () => {
    const payload: Buffer = Buffer.from(
      DatadogSketchPayload.encode(
        DatadogSketchPayload.fromObject({
          sketches: [
            {
              metric: "request.latency",
              host: "web-1",
              tags: ["env:prod"],
              dogsketches: [
                { ts: 1700000000, cnt: 4, min: 1, max: 9, avg: 4, sum: 16 },
              ],
            },
          ],
        }),
      ).finish(),
    );

    const response: RouteResponse = await send(datadog("/api/beta/sketches"), {
      headers: {
        "dd-api-key": INGESTION_KEY,
        "content-type": "application/x-protobuf",
      },
      body: payload,
    });

    expect(response.status).toBe(202);
    expect(metricNamesOf(jobs[0]!)).toEqual(["request.latency"]);
  });

  test("service checks", async () => {
    const response: RouteResponse = await send(datadog("/api/v1/check_run"), {
      headers: {
        "dd-api-key": INGESTION_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        {
          check: "datadog.agent.up",
          host_name: "web-1",
          timestamp: 1700000000,
          status: 0,
          tags: [],
        },
      ]),
    });

    expect(response.status).toBe(202);
    expect(response.json()).toEqual({ status: "ok" });
    expect(metricNamesOf(jobs[0]!)).toEqual(["datadog.agent.up"]);
  });

  test("the Agent's API key check: valid for a known key, refused for another", async () => {
    const valid: RouteResponse = await send(datadog("/api/v1/validate"), {
      method: "GET",
      headers: { "dd-api-key": UNDASHED_KEY },
    });

    expect(valid.status).toBe(200);
    expect(valid.json()).toEqual({ valid: true });

    const invalid: RouteResponse = await send(datadog("/api/v1/validate"), {
      method: "GET",
      headers: { "dd-api-key": "00000000000040008000000000000000" },
    });

    expect(invalid.status).toBe(401);
  });

  test("the Agent's host metadata is accepted, and not kept", async () => {
    const response: RouteResponse = await send(datadog("/intake/"), {
      headers: {
        "dd-api-key": INGESTION_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ internalHostname: "web-1", meta: {} }),
    });

    expect(response.status).toBe(202);
    expect(jobs).toHaveLength(0);
  });

  test("a body it cannot read is a 400 with Datadog's errors list", async () => {
    const response: RouteResponse = await send(datadog("/api/v1/series"), {
      headers: {
        "dd-api-key": INGESTION_KEY,
        "content-type": "application/json",
      },
      body: "{not json",
    });

    expect(response.status).toBe(400);
    expect(Array.isArray(response.json()["errors"])).toBe(true);
    expect(jobs).toHaveLength(0);
  });

  test("a queue that cannot take it is a 503 the Agent retries", async () => {
    queue["addLogIngestJob"]!.mockRejectedValue(new Error("down") as never);

    const response: RouteResponse = await send(datadog("/api/v2/logs"), {
      headers: {
        "dd-api-key": INGESTION_KEY,
        "content-type": "application/json",
      },
      body: LOGS,
    });

    expect(response.status).toBe(503);
  });

  test("no key is a 401", async () => {
    const response: RouteResponse = await send(datadog("/api/v2/logs"), {
      headers: { "content-type": "application/json" },
      body: LOGS,
    });

    expect(response.status).toBe(401);
  });
});
