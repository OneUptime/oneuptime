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
import { JSONObject } from "Common/Types/JSON";
import {
  COMPATIBLE_INGEST_URL_PREFIX,
  SENTRY_BASE_PATH,
} from "Common/Types/Telemetry/CompatibleIngest";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import SentryAPI from "../../../FeatureSet/Telemetry/API/Sentry";
import TelemetryQueueService from "../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
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
 * Sentry's ingest API end to end over HTTP: a DSN pointed at OneUptime
 * makes server SDKs (X-Sentry-Auth) and browser SDKs (?sentry_key, with a
 * Browser key and its origins) send here; envelopes and store events are
 * read, compressed as the SDKs compress them; errors and transactions are
 * queued as traces and Sentry logs as logs; and the answer is Sentry's.
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
      },
    };
  },
);

const BROWSER_KEY: string = "9c1f3a22-7d4e-4b8a-a1c2-3e4f5a6b7c8d";
const SHOP_ORIGIN: string = "https://shop.example.com";
const EVENT_ID: string = "fc6d8c0c43fc4630ad850ee518f1b9d0";

let server: RouteServer;
let jobs: Array<QueuedJob> = [];

const queue: Record<string, jest.Mock> =
  TelemetryQueueService as unknown as Record<string, jest.Mock>;

beforeAll(async () => {
  server = await startRouteServer([SentryAPI]);
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  jobs = [];

  (
    TelemetryIngestionKeyService.getPolicyFromSecretKey as jest.Mock
  ).mockImplementation(async (key: unknown) => {
    if (key === INGESTION_KEY) {
      return serverPolicy();
    }

    if (key === BROWSER_KEY) {
      return serverPolicy({
        keyType: TelemetryIngestionKeyType.Browser,
        allowedOrigins: [SHOP_ORIGIN],
      });
    }

    return null;
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
});

const envelopeUrl: (query?: string) => string = (query?: string): string => {
  return `${server.url}${COMPATIBLE_INGEST_URL_PREFIX}${SENTRY_BASE_PATH}/api/1/envelope/${query ? `?${query}` : ""}`;
};

const ERROR_EVENT: JSONObject = {
  event_id: EVENT_ID,
  timestamp: 1700000000.5,
  platform: "python",
  level: "error",
  release: "checkout@1.4.2",
  environment: "production",
  exception: {
    values: [
      {
        type: "ZeroDivisionError",
        value: "division by zero",
        module: "builtins",
        stacktrace: {
          frames: [
            {
              filename: "app.py",
              abs_path: "/srv/app.py",
              function: "pay",
              lineno: 42,
              context_line: "total = amount / count",
            },
          ],
        },
        mechanism: { type: "generic", handled: false },
      },
    ],
  },
};

const envelope: (items: Array<[JSONObject, JSONObject]>) => string = (
  items: Array<[JSONObject, JSONObject]>,
): string => {
  const lines: Array<string> = [
    JSON.stringify({ event_id: EVENT_ID, sent_at: "2023-11-14T22:13:20Z" }),
  ];

  for (const [header, payload] of items) {
    lines.push(JSON.stringify(header), JSON.stringify(payload));
  }

  return `${lines.join("\n")}\n`;
};

const spansOf: (job: QueuedJob) => Array<JSONObject> = (
  job: QueuedJob,
): Array<JSONObject> => {
  const spans: Array<JSONObject> = [];

  for (const resourceSpan of job.body["resourceSpans"] as Array<JSONObject>) {
    for (const scopeSpan of resourceSpan["scopeSpans"] as Array<JSONObject>) {
      spans.push(...(scopeSpan["spans"] as Array<JSONObject>));
    }
  }

  return spans;
};

describe("Sentry - POST /sentry/api/<n>/envelope/", () => {
  test("a server SDK's error, keyed in X-Sentry-Auth: Sentry's {id}, and the error as a span with its exception", async () => {
    const response: RouteResponse = await send(envelopeUrl(), {
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_client=sentry.python/2.18.0, sentry_key=${INGESTION_KEY.replace(/-/g, "")}`,
      },
      body: envelope([
        [{ type: "event" }, ERROR_EVENT],
        [
          { type: "client_report" },
          { timestamp: 1700000000, discarded_events: [] },
        ],
      ]),
    });

    expect(response.status).toBe(200);
    expect(response.json()).toEqual({ id: EVENT_ID });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.signal).toBe("traces");

    const span: JSONObject = spansOf(jobs[0]!)[0]!;
    const exceptionEvent: JSONObject = (
      span["events"] as Array<JSONObject>
    )[0]!;

    expect(span["status"]).toMatchObject({ code: 2 });
    expect(exceptionEvent["name"]).toBe("exception");
    expect(exceptionEvent["attributes"]).toEqual(
      expect.arrayContaining([
        {
          key: "exception.type",
          value: { stringValue: "ZeroDivisionError" },
        },
        {
          key: "exception.message",
          value: { stringValue: "division by zero" },
        },
      ]),
    );
  });

  test("a browser SDK's report: ?sentry_key with a Browser key from an allowed origin", async () => {
    const response: RouteResponse = await send(
      envelopeUrl(
        `sentry_key=${BROWSER_KEY.replace(/-/g, "")}&sentry_version=7&sentry_client=sentry.javascript.browser%2F8.40.0`,
      ),
      {
        headers: {
          "content-type": "text/plain;charset=UTF-8",
          origin: SHOP_ORIGIN,
        },
        body: envelope([
          [
            { type: "event" },
            { ...ERROR_EVENT, platform: "javascript", release: "shop@2.0.0" },
          ],
        ]),
      },
    );

    expect(response.status).toBe(200);
    expect(jobs).toHaveLength(1);
  });

  test("a Browser key from an origin it does not list is refused", async () => {
    const response: RouteResponse = await send(
      envelopeUrl(`sentry_key=${BROWSER_KEY}`),
      {
        headers: {
          "content-type": "text/plain;charset=UTF-8",
          origin: "https://evil.example.net",
        },
        body: envelope([[{ type: "event" }, ERROR_EVENT]]),
      },
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(jobs).toHaveLength(0);
  });

  test("a transaction and Sentry logs in one envelope: traces and logs, as two jobs", async () => {
    const response: RouteResponse = await send(envelopeUrl(), {
      headers: { "x-sentry-auth": `Sentry sentry_key=${INGESTION_KEY}` },
      body: envelope([
        [
          { type: "transaction" },
          {
            type: "transaction",
            event_id: EVENT_ID,
            transaction: "POST /pay",
            start_timestamp: 1700000000,
            timestamp: 1700000000.25,
            contexts: {
              trace: {
                trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
                span_id: "00f067aa0ba902b7",
                op: "http.server",
                status: "ok",
              },
            },
            spans: [
              {
                span_id: "b7ad6b7169203331",
                parent_span_id: "00f067aa0ba902b7",
                trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
                op: "db.query",
                description: "SELECT * FROM orders",
                start_timestamp: 1700000000.01,
                timestamp: 1700000000.2,
              },
            ],
          },
        ],
        [
          { type: "log", item_count: 1 },
          {
            items: [
              {
                timestamp: 1700000000.1,
                level: "warn",
                body: "card retry",
                trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
              },
            ],
          },
        ],
      ]),
    });

    expect(response.status).toBe(200);
    expect(
      jobs
        .map((job: QueuedJob) => {
          return job.signal;
        })
        .sort(),
    ).toEqual(["logs", "traces"]);

    const traces: QueuedJob = jobs.find((job: QueuedJob) => {
      return job.signal === "traces";
    })!;

    expect(
      spansOf(traces)
        .map((span: JSONObject) => {
          return span["name"];
        })
        .sort(),
    ).toEqual(["POST /pay", "SELECT * FROM orders"]);
  });

  test.each<[string, (body: Buffer) => Buffer]>([
    ["gzip", zlib.gzipSync],
    ["br", zlib.brotliCompressSync],
  ])(
    "an envelope compressed with %s, as SDKs compress them",
    async (encoding: string, compress: (body: Buffer) => Buffer) => {
      const response: RouteResponse = await send(envelopeUrl(), {
        headers: {
          "x-sentry-auth": `Sentry sentry_key=${INGESTION_KEY}`,
          "content-encoding": encoding,
        },
        body: compress(
          Buffer.from(envelope([[{ type: "event" }, ERROR_EVENT]])),
        ),
      });

      expect(response.status).toBe(200);
      expect(jobs).toHaveLength(1);
    },
  );

  test("an envelope with nothing OneUptime keeps (a session) is still Sentry's 200", async () => {
    const response: RouteResponse = await send(envelopeUrl(), {
      headers: { "x-sentry-auth": `Sentry sentry_key=${INGESTION_KEY}` },
      body: envelope([
        [{ type: "session" }, { sid: "abc", status: "ok", started: "x" }],
      ]),
    });

    expect(response.status).toBe(200);
    expect(jobs).toHaveLength(0);
  });

  test("a body that is not an envelope is a 400 with Sentry's detail", async () => {
    const response: RouteResponse = await send(envelopeUrl(), {
      headers: { "x-sentry-auth": `Sentry sentry_key=${INGESTION_KEY}` },
      body: "this is not an envelope",
    });

    expect(response.status).toBe(400);
    expect(typeof response.json()["detail"]).toBe("string");
  });

  test("no key is a 401", async () => {
    const response: RouteResponse = await send(envelopeUrl(), {
      body: envelope([[{ type: "event" }, ERROR_EVENT]]),
    });

    expect(response.status).toBe(401);
    expect(jobs).toHaveLength(0);
  });

  test("a queue that cannot take it is a 503", async () => {
    queue["addTraceIngestJob"]!.mockRejectedValue(new Error("down") as never);

    const response: RouteResponse = await send(envelopeUrl(), {
      headers: { "x-sentry-auth": `Sentry sentry_key=${INGESTION_KEY}` },
      body: envelope([[{ type: "event" }, ERROR_EVENT]]),
    });

    expect(response.status).toBe(503);
  });
});

describe("Sentry - POST /sentry/api/<n>/store/", () => {
  const storeUrl: string = `${SENTRY_BASE_PATH}/api/7/store/`;

  test("one event as JSON, as older SDKs send it, at the root path too", async () => {
    const response: RouteResponse = await send(`${server.url}${storeUrl}`, {
      headers: {
        "content-type": "application/json",
        "x-sentry-auth": `Sentry sentry_key=${INGESTION_KEY}`,
      },
      body: JSON.stringify(ERROR_EVENT),
    });

    expect(response.status).toBe(200);
    expect(response.json()).toEqual({ id: EVENT_ID });
    expect(jobs[0]!.signal).toBe("traces");
  });

  test("a body that is not a JSON event is a 400", async () => {
    const response: RouteResponse = await send(`${server.url}${storeUrl}`, {
      headers: { "x-sentry-auth": `Sentry sentry_key=${INGESTION_KEY}` },
      body: "[1, 2]",
    });

    expect(response.status).toBe(400);
  });
});
