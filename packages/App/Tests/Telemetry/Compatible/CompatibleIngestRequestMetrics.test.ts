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
import {
  ExpressRequest,
  ExpressResponse,
  RequestHandler,
} from "Common/Server/Utils/Express";
import AppMetrics from "Common/Server/Utils/Telemetry/AppMetrics";
import TelemetryIngestionBudget from "Common/Server/Utils/Telemetry/TelemetryIngestionBudget";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import {
  COMPATIBLE_INGEST_URL_PREFIX,
  DATADOG_BASE_PATH,
  LOKI_PUSH_PATH,
  PROMETHEUS_REMOTE_WRITE_MAX_ELEMENTS,
  PROMETHEUS_REMOTE_WRITE_PATH,
  SENTRY_BASE_PATH,
  SPLUNK_HEC_BASE_PATH,
} from "Common/Types/Telemetry/CompatibleIngest";
import {
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import DatadogAPI from "../../../FeatureSet/Telemetry/API/Datadog";
import LokiAPI from "../../../FeatureSet/Telemetry/API/Loki";
import PrometheusRemoteWriteAPI from "../../../FeatureSet/Telemetry/API/PrometheusRemoteWrite";
import SentryAPI from "../../../FeatureSet/Telemetry/API/Sentry";
import SplunkHecAPI from "../../../FeatureSet/Telemetry/API/SplunkHec";
import IngestRequestMetrics, {
  ingestMetricsMiddleware,
} from "../../../FeatureSet/Telemetry/Middleware/IngestRequestMetrics";
import TelemetryQueueService from "../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import { LokiPushRequestType } from "../../../FeatureSet/Telemetry/Utils/Compatible/LokiPush";
import { WriteRequestV1 } from "../../../FeatureSet/Telemetry/Utils/Compatible/PrometheusRemoteWrite";
import { snappyCompress } from "./SnappyTestCompressor";
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
 * ONEUPTIME'S OWN INGEST METRICS FOR THE COMPATIBLE ENDPOINTS (#10149).
 *
 * telemetry.ingest.request.count and .duration were recorded only by the
 * OTLP/HTTP routes: an operator watching them saw none of Prometheus
 * remote write's traffic, nor its refusals or 503s. Over the real routers,
 * each compatible endpoint is counted with its signal and its surface - so
 * remote write is told apart from OTLP metrics - and its outcome read from
 * its answer: a 204 accepted, a partial write's 400, a 413 and a key's 401
 * or 403 rejected, a 503 an error. Its payload is recorded as received,
 * once it is read; a request refused before its body is read has none.
 * Only the key lookup, the budget gate, the queue and the instruments are
 * replaced.
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

interface Recorded {
  value: number;
  attributes: Record<string, string>;
}

let server: RouteServer;
let jobs: Array<QueuedJob> = [];
let counts: Array<Recorded> = [];
let durations: Array<Recorded> = [];
let payloads: Array<Recorded> = [];

const queue: Record<string, jest.Mock> =
  TelemetryQueueService as unknown as Record<string, jest.Mock>;

const instrument: (into: () => Array<Recorded>) => {
  add: jest.Mock;
  record: jest.Mock;
} = (into: () => Array<Recorded>): { add: jest.Mock; record: jest.Mock } => {
  const push: (value: number, attributes: Record<string, string>) => void = (
    value: number,
    attributes: Record<string, string>,
  ): void => {
    into().push({ value: value, attributes: { ...attributes } });
  };

  return { add: jest.fn(push), record: jest.fn(push) };
};

beforeAll(async () => {
  server = await startRouteServer([
    PrometheusRemoteWriteAPI,
    LokiAPI,
    SplunkHecAPI,
    DatadogAPI,
    SentryAPI,
  ]);
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  jobs = [];
  counts = [];
  durations = [];
  payloads = [];

  (
    TelemetryIngestionKeyService.getPolicyFromSecretKey as jest.Mock
  ).mockImplementation(async (key: unknown) => {
    return key === INGESTION_KEY ? serverPolicy() : null;
  });

  (TelemetryIngestionBudget.admit as jest.Mock).mockResolvedValue({
    charge: { isPending: true, isExact: false },
  } as never);

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

  jest.spyOn(AppMetrics, "getIngestCounter").mockReturnValue(
    instrument(() => {
      return counts;
    }) as unknown as ReturnType<typeof AppMetrics.getIngestCounter>,
  );
  jest.spyOn(AppMetrics, "getIngestDuration").mockReturnValue(
    instrument(() => {
      return durations;
    }) as unknown as ReturnType<typeof AppMetrics.getIngestDuration>,
  );
  jest.spyOn(AppMetrics, "getIngestPayloadBytes").mockReturnValue(
    instrument(() => {
      return payloads;
    }) as unknown as ReturnType<typeof AppMetrics.getIngestPayloadBytes>,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The instruments are recorded on "finish", which can come a moment after
 * the client has read its answer.
 */
const settled: () => Promise<void> = async (): Promise<void> => {
  for (
    let attempt: number = 0;
    attempt < 50 && counts.length === 0;
    attempt++
  ) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 5);
    });
  }
};

const outcomes: () => Array<Record<string, string>> = (): Array<
  Record<string, string>
> => {
  return counts.map((count: Recorded): Record<string, string> => {
    expect(count.value).toBe(1);
    return count.attributes;
  });
};

const remoteWrite: (
  body: Buffer,
  headers?: Record<string, string>,
) => Promise<RouteResponse> = (
  body: Buffer,
  headers?: Record<string, string>,
): Promise<RouteResponse> => {
  return send(`${server.url}${PROMETHEUS_REMOTE_WRITE_PATH}`, {
    headers: {
      authorization: `Bearer ${INGESTION_KEY}`,
      "content-type": "application/x-protobuf",
      "content-encoding": "snappy",
      ...headers,
    },
    body: body,
  });
};

const writeRequest: (request: JSONObject) => Buffer = (
  request: JSONObject,
): Buffer => {
  return snappyCompress(
    Buffer.from(
      WriteRequestV1.encode(WriteRequestV1.fromObject(request)).finish(),
    ),
  );
};

const UP: JSONObject = {
  timeseries: [
    {
      labels: [
        { name: "__name__", value: "up" },
        { name: "job", value: "node" },
      ],
      samples: [{ value: 1, timestamp: 1700000000000 }],
    },
  ],
};

const REMOTE_WRITE: Record<string, string> = {
  "telemetry.signal": "metrics",
  "telemetry.surface": "prometheus-remote-write",
};

describe("Prometheus remote write, in OneUptime's own ingest metrics", () => {
  test("a write that is stored is counted accepted, with its duration and its payload as received", async () => {
    const body: Buffer = writeRequest(UP);

    expect((await remoteWrite(body)).status).toBe(204);
    await settled();

    expect(outcomes()).toEqual([{ ...REMOTE_WRITE, outcome: "accepted" }]);
    expect(durations).toHaveLength(1);
    expect(durations[0]!.attributes).toEqual({
      ...REMOTE_WRITE,
      outcome: "accepted",
    });
    expect(durations[0]!.value).toBeGreaterThanOrEqual(0);
    expect(payloads).toEqual([
      { value: body.length, attributes: REMOTE_WRITE },
    ]);
  });

  test("a partial write's 400 is counted rejected, though its valid series was stored", async () => {
    const response: RouteResponse = await remoteWrite(
      writeRequest({
        timeseries: [
          ...(UP["timeseries"] as Array<JSONObject>),
          {
            labels: [{ name: "job", value: "node" }],
            samples: [{ value: 3, timestamp: 1700000000000 }],
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    await settled();

    expect(jobs).toHaveLength(1);
    expect(outcomes()).toEqual([{ ...REMOTE_WRITE, outcome: "rejected" }]);
  });

  test("a write over the limits' 413 is counted rejected", async () => {
    const series: number = PROMETHEUS_REMOTE_WRITE_MAX_ELEMENTS + 1;
    const protobuf: Buffer = Buffer.alloc(series * 2);

    for (let index: number = 0; index < series; index++) {
      protobuf[index * 2] = 0x0a;
      protobuf[index * 2 + 1] = 0x00;
    }

    expect((await remoteWrite(snappyCompress(protobuf))).status).toBe(413);
    await settled();

    expect(outcomes()).toEqual([{ ...REMOTE_WRITE, outcome: "rejected" }]);
  });

  test("a queue that cannot take it - a 503 the sender retries - is counted an error", async () => {
    queue["addMetricIngestJob"]!.mockRejectedValue(new Error("down") as never);

    expect((await remoteWrite(writeRequest(UP))).status).toBe(503);
    await settled();

    expect(outcomes()).toEqual([{ ...REMOTE_WRITE, outcome: "error" }]);
  });

  test("a missing key's 401 is counted rejected, and has no payload: its body is never read", async () => {
    const response: RouteResponse = await send(
      `${server.url}${PROMETHEUS_REMOTE_WRITE_PATH}`,
      {
        headers: {
          "content-type": "application/x-protobuf",
          "content-encoding": "snappy",
        },
        body: writeRequest(UP),
      },
    );

    expect(response.status).toBe(401);
    await settled();

    expect(outcomes()).toEqual([{ ...REMOTE_WRITE, outcome: "rejected" }]);
    expect(payloads).toEqual([]);
  });

  test("a used-up daily budget's 403 is counted rejected", async () => {
    (TelemetryIngestionBudget.admit as jest.Mock).mockResolvedValue({
      refusal: {
        kind: TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted,
        scope: TelemetryIngestionBudgetScope.Project,
        signal: ProductType.Metrics,
        message: "The project's daily metrics budget is used up.",
        retryAfterSeconds: null,
        resetsAt: new Date("2026-11-21T00:00:00.000Z"),
      },
      charge: null,
    } as never);

    expect((await remoteWrite(writeRequest(UP))).status).toBe(403);
    await settled();

    expect(outcomes()).toEqual([{ ...REMOTE_WRITE, outcome: "rejected" }]);
  });

  test("a proto it does not read - a 415, its body left unread - is counted rejected", async () => {
    const response: RouteResponse = await remoteWrite(writeRequest(UP), {
      "content-type":
        "application/x-protobuf;proto=io.prometheus.write.v3.Request",
    });

    expect(response.status).toBe(415);
    await settled();

    expect(outcomes()).toEqual([{ ...REMOTE_WRITE, outcome: "rejected" }]);
    expect(payloads).toEqual([]);
  });
});

describe("every compatible endpoint, with its signal and its surface", () => {
  test("a Loki push is logs, on the loki surface, its payload the snappy body as received", async () => {
    const body: Buffer = snappyCompress(
      Buffer.from(
        LokiPushRequestType.encode(
          LokiPushRequestType.fromObject({
            streams: [
              {
                labels: '{job="varlogs"}',
                entries: [{ timestamp: { seconds: 1700000000 }, line: "hi" }],
              },
            ],
          }),
        ).finish(),
      ),
    );

    const response: RouteResponse = await send(
      `${server.url}${LOKI_PUSH_PATH}`,
      {
        headers: {
          authorization: `Bearer ${INGESTION_KEY}`,
          "content-type": "application/x-protobuf",
          "content-encoding": "snappy",
        },
        body: body,
      },
    );

    expect(response.status).toBe(204);
    await settled();

    const loki: Record<string, string> = {
      "telemetry.signal": "logs",
      "telemetry.surface": "loki",
    };

    expect(outcomes()).toEqual([{ ...loki, outcome: "accepted" }]);
    expect(payloads).toEqual([{ value: body.length, attributes: loki }]);
  });

  test("a gzipped HEC batch is logs, on the splunk-hec surface, its payload as received - compressed", async () => {
    const body: Buffer = zlib.gzipSync(
      Buffer.from(JSON.stringify({ event: "card declined", time: 1700000000 })),
    );

    const response: RouteResponse = await send(
      `${server.url}${COMPATIBLE_INGEST_URL_PREFIX}${SPLUNK_HEC_BASE_PATH}/event`,
      {
        headers: {
          authorization: `Splunk ${INGESTION_KEY}`,
          "content-encoding": "gzip",
        },
        body: body,
      },
    );

    expect(response.status).toBe(200);
    await settled();

    const hec: Record<string, string> = {
      "telemetry.signal": "logs",
      "telemetry.surface": "splunk-hec",
    };

    expect(outcomes()).toEqual([{ ...hec, outcome: "accepted" }]);
    expect(payloads).toEqual([{ value: body.length, attributes: hec }]);
  });

  test("Datadog's logs are logs and its series metrics, on the datadog surface; the Agent's key check carries no telemetry and is not counted", async () => {
    const datadog: (path: string) => string = (path: string): string => {
      return `${server.url}${COMPATIBLE_INGEST_URL_PREFIX}${DATADOG_BASE_PATH}${path}`;
    };
    const headers: Record<string, string> = {
      "dd-api-key": UNDASHED_KEY,
      "content-type": "application/json",
    };

    await send(datadog("/api/v2/logs"), {
      headers: headers,
      body: JSON.stringify([{ message: "card declined", status: "error" }]),
    });
    await send(datadog("/api/v1/series"), {
      headers: headers,
      body: JSON.stringify({
        series: [{ metric: "system.load.1", points: [[1700000000, 0.4]] }],
      }),
    });
    await send(datadog("/api/v1/validate"), {
      method: "GET",
      headers: { "dd-api-key": UNDASHED_KEY },
    });

    for (
      let attempt: number = 0;
      attempt < 50 && counts.length < 2;
      attempt++
    ) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 5);
      });
    }

    expect(outcomes()).toEqual([
      {
        "telemetry.signal": "logs",
        "telemetry.surface": "datadog",
        outcome: "accepted",
      },
      {
        "telemetry.signal": "metrics",
        "telemetry.surface": "datadog",
        outcome: "accepted",
      },
    ]);
  });

  test("a Sentry envelope is traces, on the sentry surface; a bad one's 400 is rejected", async () => {
    const url: string = `${server.url}${COMPATIBLE_INGEST_URL_PREFIX}${SENTRY_BASE_PATH}/api/1/envelope/`;
    const headers: Record<string, string> = {
      "content-type": "application/x-sentry-envelope",
      "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${UNDASHED_KEY}`,
    };

    await send(url, {
      headers: headers,
      body: `{}\n{"type":"event"}\n${JSON.stringify({
        exception: { values: [{ type: "ValueError", value: "bad" }] },
      })}\n`,
    });
    await send(url, { headers: headers, body: "not an envelope" });

    for (
      let attempt: number = 0;
      attempt < 50 && counts.length < 2;
      attempt++
    ) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 5);
      });
    }

    const sentry: Record<string, string> = {
      "telemetry.signal": "traces",
      "telemetry.surface": "sentry",
    };

    expect(outcomes()).toEqual([
      { ...sentry, outcome: "accepted" },
      { ...sentry, outcome: "rejected" },
    ]);
  });
});

describe("ingestMetricsMiddleware and recordPayloadSize", () => {
  // A response that answers when told, as Express's would.
  const fakeResponse: () => {
    res: ExpressResponse;
    emit: (event: "finish" | "close") => void;
    answer: (statusCode: number) => void;
  } = () => {
    const listeners: Record<string, Array<() => void>> = {};
    const res: Record<string, unknown> = {
      headersSent: false,
      statusCode: 200,
      on: (event: string, listener: () => void): void => {
        (listeners[event] = listeners[event] || []).push(listener);
      },
    };

    return {
      res: res as unknown as ExpressResponse,
      emit: (event: "finish" | "close"): void => {
        for (const listener of listeners[event] || []) {
          listener();
        }
      },
      answer: (statusCode: number): void => {
        res["statusCode"] = statusCode;
        res["headersSent"] = true;
      },
    };
  };

  const mount: (
    handler: RequestHandler,
    req: Record<string, unknown>,
  ) => ReturnType<typeof fakeResponse> = (
    handler: RequestHandler,
    req: Record<string, unknown>,
  ): ReturnType<typeof fakeResponse> => {
    const response: ReturnType<typeof fakeResponse> = fakeResponse();
    const next: jest.Mock = jest.fn();

    handler(req as unknown as ExpressRequest, response.res, next);

    expect(next).toHaveBeenCalledTimes(1);

    return response;
  };

  test("an OTLP route's surface is its own by default, and its payload is read from the body at mount", () => {
    const response: ReturnType<typeof fakeResponse> = mount(
      ingestMetricsMiddleware("traces"),
      { body: Buffer.from("12345") },
    );

    response.answer(200);
    response.emit("finish");
    response.emit("close");

    expect(payloads).toEqual([
      {
        value: 5,
        attributes: {
          "telemetry.signal": "traces",
          "telemetry.surface": "otel-traces",
        },
      },
    ]);
    // Once, though "finish" and "close" both came.
    expect(outcomes()).toEqual([
      {
        "telemetry.signal": "traces",
        "telemetry.surface": "otel-traces",
        outcome: "accepted",
      },
    ]);
  });

  test("a client that left before any answer is counted an error, not as Node's default 200", () => {
    const response: ReturnType<typeof fakeResponse> = mount(
      ingestMetricsMiddleware("logs", TelemetryIngestSurface.Loki),
      {},
    );

    response.emit("close");

    expect(outcomes()).toEqual([
      {
        "telemetry.signal": "logs",
        "telemetry.surface": "loki",
        outcome: "error",
      },
    ]);
  });

  test("a body read later is recorded once, and only for a request the metrics are mounted on", () => {
    const req: Record<string, unknown> = {};

    mount(
      ingestMetricsMiddleware("metrics", TelemetryIngestSurface.Datadog),
      req,
    );

    IngestRequestMetrics.recordPayloadSize(
      req as unknown as ExpressRequest,
      42,
    );
    IngestRequestMetrics.recordPayloadSize(
      req as unknown as ExpressRequest,
      42,
    );
    IngestRequestMetrics.recordPayloadSize({} as unknown as ExpressRequest, 42);

    expect(payloads).toEqual([
      {
        value: 42,
        attributes: {
          "telemetry.signal": "metrics",
          "telemetry.surface": "datadog",
        },
      },
    ]);
  });

  test("a body read after the answer was sent is not recorded: the request is done", () => {
    const req: Record<string, unknown> = {};
    const response: ReturnType<typeof fakeResponse> = mount(
      ingestMetricsMiddleware("logs", TelemetryIngestSurface.SplunkHec),
      req,
    );

    response.answer(401);
    response.emit("finish");
    IngestRequestMetrics.recordPayloadSize(req as unknown as ExpressRequest, 7);

    expect(payloads).toEqual([]);
    expect(outcomes()).toEqual([
      {
        "telemetry.signal": "logs",
        "telemetry.surface": "splunk-hec",
        outcome: "rejected",
      },
    ]);
  });
});
