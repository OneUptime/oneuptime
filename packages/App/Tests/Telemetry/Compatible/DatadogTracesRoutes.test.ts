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
import AppMetrics from "Common/Server/Utils/Telemetry/AppMetrics";
import TelemetryIngestionBudget from "Common/Server/Utils/Telemetry/TelemetryIngestionBudget";
import { JSONObject } from "Common/Types/JSON";
import {
  COMPATIBLE_INGEST_URL_PREFIX,
  COMPATIBLE_JSON_MAX_VALUES,
  DATADOG_BASE_PATH,
  DATADOG_PROTOBUF_MAX_ELEMENTS,
} from "Common/Types/Telemetry/CompatibleIngest";
import DatadogAPI from "../../../FeatureSet/Telemetry/API/Datadog";
import TelemetryQueueService from "../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import { DatadogAgentPayloadAsRead } from "../../../FeatureSet/Telemetry/Utils/Compatible/DatadogTraces";
import Msgpack from "../../../FeatureSet/Telemetry/Utils/Compatible/Msgpack";
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
import {
  encodeAgentPayload,
  lengthDelimited,
  pythonAgentPayloadObject,
} from "./DatadogTraceFixtures";
import { Encodable, encodeMsgpack } from "./MsgpackTestEncoder";

/*
 * Datadog APM over HTTP, against the real router: the Agent's trace intake
 * (/api/v0.2/traces, gzip or zstd protobuf, as pkg/trace/writer sends it)
 * and its stats, and a tracer's own /v0.3, /v0.4 and /v0.5 endpoints (PUT
 * or POST, MessagePack or JSON). Each takes the key its sender sends, is
 * answered as the Agent and the intake answer, queues one traces job
 * counted against the traces budget at the body's decompressed size,
 * refuses oversized bodies before decoding them, and shows in OneUptime's
 * own ingest metrics. Only the key lookup, the budget gate, the queue and
 * the instruments are replaced.
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
  server = await startRouteServer([DatadogAPI]);
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  jobs = [];
  counts = [];
  payloads = [];

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

  jest.spyOn(AppMetrics, "getIngestCounter").mockReturnValue(
    instrument(() => {
      return counts;
    }) as unknown as ReturnType<typeof AppMetrics.getIngestCounter>,
  );
  jest.spyOn(AppMetrics, "getIngestDuration").mockReturnValue(
    instrument(() => {
      return [];
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

const datadog: (path: string) => string = (path: string): string => {
  return `${server.url}${COMPATIBLE_INGEST_URL_PREFIX}${DATADOG_BASE_PATH}${path}`;
};

// The instruments are recorded on "finish", a moment after the answer is read.
const settled: (expected: number) => Promise<void> = async (
  expected: number,
): Promise<void> => {
  for (
    let attempt: number = 0;
    attempt < 50 && counts.length < expected;
    attempt++
  ) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 5);
    });
  }
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

// What the trace-agent sends (pkg/trace/writer/trace.go, sender.go).
const agentHeaders: (encoding: string) => Record<string, string> = (
  encoding: string,
): Record<string, string> => {
  return {
    "content-type": "application/x-protobuf",
    "content-encoding": encoding,
    "x-datadog-reported-languages": "python",
    "dd-api-key": UNDASHED_KEY,
    "user-agent": "Datadog Trace Agent/7.60.0/abc",
  };
};

const agentPayload: Buffer = encodeAgentPayload(pythonAgentPayloadObject());

const goTrace: Encodable = [
  [
    {
      service: "orders",
      name: "http.request",
      resource: "GET /orders",
      trace_id: BigInt("4611686018427387904"),
      span_id: 1,
      parent_id: 0,
      start: BigInt("1700000000123456789"),
      duration: 4000000,
      error: 0,
      meta: { "span.kind": "server" },
      metrics: {},
      type: "web",
    },
  ],
];

// What dd-trace-go sends with no Agent (ddtrace/tracer/transport.go).
const tracerHeaders: Record<string, string> = {
  "content-type": "application/msgpack",
  "datadog-meta-lang": "go",
  "datadog-meta-lang-version": "1.22.5",
  "datadog-meta-tracer-version": "v1.70.1",
  "x-datadog-trace-count": "1",
  authorization: basicAuth("oneuptime", UNDASHED_KEY),
};

describe("the Agent's APM intake: /api/v0.2/traces", () => {
  test("a gzip AgentPayload: 202 {}, one traces job, counted at its decompressed size, with no door charge", async () => {
    const response: RouteResponse = await send(datadog("/api/v0.2/traces"), {
      headers: agentHeaders("gzip"),
      body: zlib.gzipSync(agentPayload),
    });

    expect(response.status).toBe(202);
    expect(response.json()).toEqual({});
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.signal).toBe("traces");
    expect(jobs[0]!.productType).toBe("Traces");
    expect(jobs[0]!.ingestBytes).toBe(agentPayload.length);
    expect(jobs[0]!.budgetCharge).toBe("absent");
    expect(jobs[0]!.contentType).toBe("application/json");
    expect(jobs[0]!.contentEncoding).toBeUndefined();
    expect(TelemetryIngestionBudget.admit as jest.Mock).not.toHaveBeenCalled();
    expect(spansOf(jobs[0]!)).toHaveLength(3);
  });

  test("a zstd AgentPayload, as newer Agents compress it, is read the same", async () => {
    const zstd: ((input: Buffer) => Buffer) | undefined = (
      zlib as unknown as { zstdCompressSync?: (input: Buffer) => Buffer }
    ).zstdCompressSync;

    if (!zstd) {
      return;
    }

    const response: RouteResponse = await send(datadog("/api/v0.2/traces"), {
      headers: agentHeaders("zstd"),
      body: zstd(agentPayload),
    });

    expect(response.status).toBe(202);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.ingestBytes).toBe(agentPayload.length);
  });

  test("the key: DD-API-KEY or x-oneuptime-token; without one, or an unknown one, 401 and nothing read", async () => {
    const withToken: RouteResponse = await send(datadog("/api/v0.2/traces"), {
      headers: {
        "content-type": "application/x-protobuf",
        "x-oneuptime-token": INGESTION_KEY,
      },
      body: agentPayload,
    });

    expect(withToken.status).toBe(202);

    for (const headers of [
      { "content-type": "application/x-protobuf" },
      {
        "content-type": "application/x-protobuf",
        "dd-api-key": "0".repeat(32),
      },
    ]) {
      const response: RouteResponse = await send(datadog("/api/v0.2/traces"), {
        headers: headers,
        body: agentPayload,
      });

      expect(response.status).toBe(401);
    }

    expect(jobs).toHaveLength(1);
  });

  test("a body that is no AgentPayload is a 400 in Datadog's words, which the Agent drops", async () => {
    const response: RouteResponse = await send(datadog("/api/v0.2/traces"), {
      headers: agentHeaders("gzip"),
      body: zlib.gzipSync(Buffer.from("not a payload")),
    });

    expect(response.status).toBe(400);
    expect(response.json()).toEqual({
      errors: ["The body is not a Datadog AgentPayload protobuf."],
    });
    expect(jobs).toHaveLength(0);
  });

  test("an AgentPayload past the element limit is a 413, never decoded", async () => {
    const span: Buffer = Buffer.alloc((DATADOG_PROTOBUF_MAX_ELEMENTS + 1) * 2);

    for (let index: number = 0; index < span.length; index += 2) {
      span[index] = 0x52;
    }

    const bomb: Buffer = lengthDelimited(
      5,
      lengthDelimited(6, lengthDelimited(3, span)),
    );
    const decode: jest.SpyInstance = jest.spyOn(
      DatadogAgentPayloadAsRead,
      "decode",
    );

    const response: RouteResponse = await send(datadog("/api/v0.2/traces"), {
      headers: agentHeaders("gzip"),
      body: zlib.gzipSync(bomb),
    });

    expect(response.status).toBe(413);
    expect((response.json()["errors"] as Array<string>)[0]).toContain(
      "AgentPayload holds more than",
    );
    expect(decode).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  test("a Content-Encoding it cannot undo is a 415", async () => {
    const response: RouteResponse = await send(datadog("/api/v0.2/traces"), {
      headers: agentHeaders("lz4"),
      body: agentPayload,
    });

    expect(response.status).toBe(415);
    expect(jobs).toHaveLength(0);
  });

  test("a queue that cannot take it is a 503, which the Agent retries", async () => {
    queue["addTraceIngestJob"]!.mockRejectedValue(new Error("redis down"));

    const response: RouteResponse = await send(datadog("/api/v0.2/traces"), {
      headers: agentHeaders("gzip"),
      body: zlib.gzipSync(agentPayload),
    });

    expect(response.status).toBe(503);
  });

  test("shows in OneUptime's ingest metrics as traces on the datadog surface, its payload as received", async () => {
    const body: Buffer = zlib.gzipSync(agentPayload);

    await send(datadog("/api/v0.2/traces"), {
      headers: agentHeaders("gzip"),
      body: body,
    });
    await send(datadog("/api/v0.2/traces"), {
      headers: agentHeaders("gzip"),
      body: zlib.gzipSync(Buffer.from("junk")),
    });
    await settled(2);

    const traces: Record<string, string> = {
      "telemetry.signal": "traces",
      "telemetry.surface": "datadog",
    };

    expect(
      counts.map((count: Recorded) => {
        return count.attributes;
      }),
    ).toEqual([
      { ...traces, outcome: "accepted" },
      { ...traces, outcome: "rejected" },
    ]);
    expect(payloads[0]).toEqual({ value: body.length, attributes: traces });
  });
});

describe("the Agent's APM stats: /api/v0.2/stats", () => {
  test("accepted with 202 {}, not kept, and not counted as telemetry", async () => {
    const response: RouteResponse = await send(datadog("/api/v0.2/stats"), {
      headers: {
        "content-type": "application/msgpack",
        "content-encoding": "gzip",
        "dd-api-key": UNDASHED_KEY,
      },
      body: zlib.gzipSync(encodeMsgpack({ AgentHostname: "web-1", Stats: [] })),
    });

    expect(response.status).toBe(202);
    expect(response.json()).toEqual({});
    expect(jobs).toHaveLength(0);

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });
    expect(counts).toHaveLength(0);
  });

  test("still needs the key", async () => {
    const response: RouteResponse = await send(datadog("/api/v0.2/stats"), {
      headers: { "content-type": "application/msgpack" },
      body: encodeMsgpack({}),
    });

    expect(response.status).toBe(401);
  });
});

describe("a tracer's own endpoints: /v0.3, /v0.4 and /v0.5 traces", () => {
  test("dd-trace-go's POST /v0.4/traces, its key as its agent URL's password: 200 with no sampling rates", async () => {
    const body: Buffer = encodeMsgpack(goTrace);
    const response: RouteResponse = await send(datadog("/v0.4/traces"), {
      headers: tracerHeaders,
      body: body,
    });

    expect(response.status).toBe(200);
    expect(response.json()).toEqual({ rate_by_service: {} });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.ingestBytes).toBe(body.length);

    const resource: Array<JSONObject> = (
      (jobs[0]!.body["resourceSpans"] as Array<JSONObject>)[0]![
        "resource"
      ] as JSONObject
    )["attributes"] as Array<JSONObject>;

    expect(resource).toEqual(
      expect.arrayContaining([
        { key: "service.name", value: { stringValue: "orders" } },
        { key: "telemetry.sdk.language", value: { stringValue: "go" } },
        { key: "telemetry.sdk.version", value: { stringValue: "v1.70.1" } },
      ]),
    );
  });

  test("PUT, as the Python, Node.js, Java and Ruby tracers send, and the key in DD-API-KEY or a bearer token", async () => {
    for (const authorization of [
      { "dd-api-key": UNDASHED_KEY },
      { authorization: `Bearer ${INGESTION_KEY}` },
    ]) {
      const response: RouteResponse = await send(datadog("/v0.4/traces"), {
        method: "PUT",
        headers: { "content-type": "application/msgpack", ...authorization },
        body: encodeMsgpack(goTrace),
      });

      expect(response.status).toBe(200);
    }

    expect(jobs).toHaveLength(2);
  });

  test("v0.5's dictionary payload, and v0.3, which is answered OK", async () => {
    const v05: Buffer = encodeMsgpack([
      ["", "checkout", "flask.request", "GET /", "web"],
      [[[1, 2, 3, 99, 5, 0, 1700000000000000000, 1000, 0, {}, {}, 4]]],
    ]);

    const v05Response: RouteResponse = await send(datadog("/v0.5/traces"), {
      method: "PUT",
      headers: tracerHeaders,
      body: v05,
    });

    expect(v05Response.status).toBe(200);
    expect(v05Response.json()).toEqual({ rate_by_service: {} });

    const v03Response: RouteResponse = await send(datadog("/v0.3/traces"), {
      method: "PUT",
      headers: { ...tracerHeaders, "content-type": "application/json" },
      body: '[[{"trace_id": 1, "span_id": 2, "name": "op", "resource": "/", "service": "svc", "start": 1700000000000000000, "duration": 5}]]',
    });

    expect(v03Response.status).toBe(200);
    expect(v03Response.text).toBe("OK\n");
    expect(jobs).toHaveLength(2);
  });

  test("an empty array - a tracer checking the endpoint - is 200 and queues nothing", async () => {
    const response: RouteResponse = await send(datadog("/v0.4/traces"), {
      method: "PUT",
      headers: tracerHeaders,
      body: encodeMsgpack([]),
    });

    expect(response.status).toBe(200);
    expect(jobs).toHaveLength(0);
  });

  test("without a key, 401", async () => {
    const response: RouteResponse = await send(datadog("/v0.4/traces"), {
      method: "PUT",
      headers: { "content-type": "application/msgpack" },
      body: encodeMsgpack(goTrace),
    });

    expect(response.status).toBe(401);
    expect(jobs).toHaveLength(0);
  });

  test("a MessagePack body past the value limit is a 413, never decoded", async () => {
    const header: Buffer = Buffer.from([0xdd, 0, 0, 0, 0]);
    header.writeUInt32BE(COMPATIBLE_JSON_MAX_VALUES + 1, 1);
    const decode: jest.SpyInstance = jest.spyOn(Msgpack, "decode");

    const response: RouteResponse = await send(datadog("/v0.4/traces"), {
      method: "PUT",
      headers: { ...tracerHeaders, "content-encoding": "gzip" },
      body: zlib.gzipSync(
        Buffer.concat([
          header,
          Buffer.alloc(COMPATIBLE_JSON_MAX_VALUES + 1, 0x90),
        ]),
      ),
    });

    expect(response.status).toBe(413);
    expect(decode).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  test("the root's /v0.4/traces is not Datadog's: a tracer is pointed at /telemetry/datadog", async () => {
    const response: RouteResponse = await send(`${server.url}/v0.4/traces`, {
      method: "PUT",
      headers: tracerHeaders,
      body: encodeMsgpack(goTrace),
    });

    expect(response.status).toBe(404);
    expect(jobs).toHaveLength(0);
  });

  test("shows in OneUptime's ingest metrics as traces on the datadog surface", async () => {
    await send(datadog("/v0.5/traces"), {
      method: "PUT",
      headers: tracerHeaders,
      body: Buffer.from([0xc1]),
    });
    await settled(1);

    expect(counts[0]!.attributes).toEqual({
      "telemetry.signal": "traces",
      "telemetry.surface": "datadog",
      outcome: "rejected",
    });
  });
});
