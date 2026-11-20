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
import TelemetryIngestionBudget from "Common/Server/Utils/Telemetry/TelemetryIngestionBudget";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import {
  PROMETHEUS_REMOTE_WRITE_MAX_BYTES,
  PROMETHEUS_REMOTE_WRITE_MAX_ELEMENTS,
  PROMETHEUS_REMOTE_WRITE_PATH,
} from "Common/Types/Telemetry/CompatibleIngest";
import {
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import PrometheusRemoteWriteAPI from "../../../FeatureSet/Telemetry/API/PrometheusRemoteWrite";
import TelemetryQueueService from "../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import {
  WriteRequestV1,
  WriteRequestV2,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/PrometheusRemoteWrite";
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
 * Prometheus remote write over HTTP, against the real router: every answer
 * the remote write specifications define, so a sender retries only what it
 * should (2xx done, 4xx dropped, 429 and 5xx retried); the 2.0 written
 * counts, exemplars included; partial writes; the size limits, a snappy
 * bomb among them; and the size the budget counts. Real protobuf, real
 * snappy, built here; only the key lookup, the budget gate and the queue
 * are mocked.
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
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const MIB: number = 1024 * 1024;

let server: RouteServer;
let jobs: Array<QueuedJob> = [];

const queue: { addMetricIngestJob: jest.Mock } =
  TelemetryQueueService as unknown as { addMetricIngestJob: jest.Mock };

const markUsed: jest.Mock =
  TelemetryIngestionKeyService.markUsed as unknown as jest.Mock;

beforeAll(async () => {
  server = await startRouteServer([PrometheusRemoteWriteAPI]);
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  jobs = [];
  markUsed.mockClear();

  (
    TelemetryIngestionKeyService.getPolicyFromSecretKey as jest.Mock
  ).mockImplementation(async (key: unknown) => {
    return key === INGESTION_KEY ? serverPolicy() : null;
  });

  (TelemetryIngestionBudget.admit as jest.Mock).mockResolvedValue({
    charge: PENDING_CHARGE,
  } as never);

  queue.addMetricIngestJob
    .mockReset()
    .mockImplementation(async (req: unknown) => {
      recordJob(jobs, "metrics", req as TelemetryRequest);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const v1: (request: JSONObject) => Buffer = (request: JSONObject): Buffer => {
  return Buffer.from(
    WriteRequestV1.encode(WriteRequestV1.fromObject(request)).finish(),
  );
};

const v2: (request: JSONObject) => Buffer = (request: JSONObject): Buffer => {
  return Buffer.from(
    WriteRequestV2.encode(WriteRequestV2.fromObject(request)).finish(),
  );
};

const headersV1: (extra?: Record<string, string>) => Record<string, string> = (
  extra?: Record<string, string>,
): Record<string, string> => {
  return {
    authorization: `Bearer ${INGESTION_KEY}`,
    "content-type": "application/x-protobuf",
    "content-encoding": "snappy",
    "user-agent": "Prometheus/3.1.0",
    "x-prometheus-remote-write-version": "0.1.0",
    ...extra,
  };
};

const headersV2: (extra?: Record<string, string>) => Record<string, string> = (
  extra?: Record<string, string>,
): Record<string, string> => {
  return headersV1({
    "content-type": "application/x-protobuf;proto=io.prometheus.write.v2.Request",
    "x-prometheus-remote-write-version": "2.0.0",
    ...extra,
  });
};

const write: (
  body: Buffer,
  headers: Record<string, string>,
) => Promise<RouteResponse> = (
  body: Buffer,
  headers: Record<string, string>,
): Promise<RouteResponse> => {
  return send(`${server.url}${PROMETHEUS_REMOTE_WRITE_PATH}`, {
    headers: headers,
    body: body,
  });
};

const UP: JSONObject = {
  timeseries: [
    {
      labels: [
        { name: "__name__", value: "up" },
        { name: "instance", value: "a:9100" },
        { name: "job", value: "node" },
      ],
      samples: [{ value: 1, timestamp: 1700000000000 }],
    },
  ],
};

// The datapoints the queued job carries, of every metric.
const queuedPoints: (job: QueuedJob) => Array<JSONObject> = (
  job: QueuedJob,
): Array<JSONObject> => {
  const points: Array<JSONObject> = [];

  for (const resource of job.body["resourceMetrics"] as Array<JSONObject>) {
    for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        const shape: JSONObject = (metric["sum"] ||
          metric["gauge"] ||
          metric["histogram"] ||
          metric["exponentialHistogram"]) as JSONObject;
        points.push(...(shape["dataPoints"] as Array<JSONObject>));
      }
    }
  }

  return points;
};

describe("remote write 2.0: what was written, exemplars included", () => {
  test("a 2.0 write is told its samples, histograms and exemplars written, and its exemplar links the datapoint to the trace", async () => {
    const response: RouteResponse = await write(
      snappyCompress(
        v2({
          symbols: [
            "",
            "__name__",
            "http_requests_total",
            "job",
            "checkout",
            "trace_id",
            TRACE_ID,
          ],
          timeseries: [
            {
              labelsRefs: [1, 2, 3, 4],
              samples: [
                { value: 1, timestamp: 1700000000000 },
                { value: Number.NaN, timestamp: 1700000015000 },
              ],
              metadata: { type: 1 },
            },
            {
              labelsRefs: [1, 2, 3, 4],
              exemplars: [
                { labelsRefs: [5, 6], value: 1, timestamp: 1700000000000 },
              ],
              metadata: { type: 1 },
            },
          ],
        }),
      ),
      headersV2(),
    );

    expect(response.status).toBe(204);
    // The staleness marker is written too: it is no failure.
    expect(
      response.headers.get("x-prometheus-remote-write-samples-written"),
    ).toBe("2");
    expect(
      response.headers.get("x-prometheus-remote-write-histograms-written"),
    ).toBe("0");
    expect(
      response.headers.get("x-prometheus-remote-write-exemplars-written"),
    ).toBe("1");

    expect(queuedPoints(jobs[0]!)[0]!["exemplars"]).toEqual([
      expect.objectContaining({ traceId: TRACE_ID }),
    ]);
  });

  test("a 2.0 write of nothing but staleness markers is not told it wrote nothing (which a sender takes for a 1.0 receiver)", async () => {
    const response: RouteResponse = await write(
      snappyCompress(
        v2({
          symbols: ["", "__name__", "up"],
          timeseries: [
            {
              labelsRefs: [1, 2],
              samples: [{ value: Number.NaN, timestamp: 1700000000000 }],
            },
          ],
        }),
      ),
      headersV2(),
    );

    expect(response.status).toBe(204);
    expect(
      response.headers.get("x-prometheus-remote-write-samples-written"),
    ).toBe("1");
    expect(jobs).toHaveLength(0);
  });

  test("a 1.0 write is answered without the 2.0 headers", async () => {
    const response: RouteResponse = await write(
      snappyCompress(v1(UP)),
      headersV1(),
    );

    expect(response.status).toBe(204);
    expect(
      response.headers.get("x-prometheus-remote-write-samples-written"),
    ).toBeNull();
  });
});

describe("partial writes: 400, with the rest queued", () => {
  const partial: JSONObject = {
    timeseries: [
      ...(UP["timeseries"] as Array<JSONObject>),
      {
        labels: [{ name: "job", value: "node" }],
        samples: [{ value: 3, timestamp: 1700000000000 }],
      },
    ],
  };

  test("1.0: a series with no name is refused with a 400 that says so, and the valid series is queued", async () => {
    const response: RouteResponse = await write(
      snappyCompress(v1(partial)),
      headersV1(),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.text).toBe(
      "Refused 1 sample of series with no metric name (__name__). The rest of the request (1 samples and 0 native histograms) was accepted.",
    );
    expect(jobs).toHaveLength(1);
    expect(queuedPoints(jobs[0]!)).toHaveLength(1);
    // What was accepted used the key.
    expect(markUsed).toHaveBeenCalledTimes(1);
  });

  test("2.0: the 400 carries the written counts, so the sender counts only the refused sample as failed", async () => {
    const response: RouteResponse = await write(
      snappyCompress(
        v2({
          symbols: ["", "__name__", "up", "job", "node"],
          timeseries: [
            {
              labelsRefs: [1, 2, 3, 4],
              samples: [{ value: 1, timestamp: 1700000000000 }],
            },
            {
              labelsRefs: [3, 4],
              samples: [{ value: 1, timestamp: 1700000000000 }],
            },
          ],
        }),
      ),
      headersV2(),
    );

    expect(response.status).toBe(400);
    expect(
      response.headers.get("x-prometheus-remote-write-samples-written"),
    ).toBe("1");
    expect(jobs).toHaveLength(1);
  });

  test("a request with nothing valid at all is a 400 and queues nothing", async () => {
    const response: RouteResponse = await write(
      snappyCompress(
        v1({
          timeseries: [
            {
              labels: [{ name: "job", value: "node" }],
              samples: [{ value: 3, timestamp: 1700000000000 }],
            },
          ],
        }),
      ),
      headersV1(),
    );

    expect(response.status).toBe(400);
    expect(jobs).toHaveLength(0);
    expect(markUsed).not.toHaveBeenCalled();
  });
});

describe("the answers a sender retries, and the ones it drops", () => {
  test("a proto it does not read is a 415 that says what it reads (2.0's Accept and Accept-Encoding)", async () => {
    const response: RouteResponse = await write(
      snappyCompress(v1(UP)),
      headersV1({
        "content-type": "application/x-protobuf;proto=io.prometheus.write.v3.Request",
      }),
    );

    expect(response.status).toBe(415);
    expect(response.headers.get("accept")).toBe(
      "application/x-protobuf;proto=prometheus.WriteRequest, application/x-protobuf;proto=io.prometheus.write.v2.Request",
    );
    expect(response.headers.get("accept-encoding")).toBe("snappy");
  });

  test("a coding it cannot undo is a 415 that says snappy", async () => {
    const response: RouteResponse = await write(
      v1(UP),
      headersV1({ "content-encoding": "lz4" }),
    );

    expect(response.status).toBe(415);
    expect(response.headers.get("accept-encoding")).toBe("snappy");
  });

  test("a used-up daily budget is a 403 (dropped, not retried for hours), before the body is read", async () => {
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

    const response: RouteResponse = await write(
      snappyCompress(v1(UP)),
      headersV1(),
    );

    expect(response.status).toBe(403);
    expect(response.json()["message"]).toBe(
      "The project's daily metrics budget is used up.",
    );
    expect(jobs).toHaveLength(0);
  });

  test("a rate refusal is a 429 with Retry-After, which a sender may retry", async () => {
    (TelemetryIngestionBudget.admit as jest.Mock).mockResolvedValue({
      refusal: {
        kind: TelemetryIngestionBudgetRefusalKind.RateLimited,
        scope: TelemetryIngestionBudgetScope.Project,
        signal: ProductType.Metrics,
        message: "Over the project's metrics rate.",
        retryAfterSeconds: 2,
        resetsAt: new Date("2026-11-21T00:00:00.000Z"),
      },
      charge: null,
    } as never);

    const response: RouteResponse = await write(
      snappyCompress(v1(UP)),
      headersV1(),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
  });

  test("the queue failing is a 503, which a sender retries", async () => {
    queue.addMetricIngestJob.mockRejectedValue(new Error("down") as never);

    const response: RouteResponse = await write(
      snappyCompress(v1(UP)),
      headersV1(),
    );

    expect(response.status).toBe(503);
  });

  test("basic_auth's password and the x-oneuptime-token header carry the key too", async () => {
    const basic: RouteResponse = await write(
      snappyCompress(v1(UP)),
      headersV1({
        authorization: `Basic ${Buffer.from(`prometheus:${INGESTION_KEY}`).toString("base64")}`,
      }),
    );
    const tokenHeaders: Record<string, string> = headersV1({
      "x-oneuptime-token": INGESTION_KEY,
    });
    delete tokenHeaders["authorization"];
    const header: RouteResponse = await write(
      snappyCompress(v1(UP)),
      tokenHeaders,
    );

    expect([basic.status, header.status]).toEqual([204, 204]);
  });
});

describe("the size a budget counts: the body decompressed", () => {
  test("the job is counted at the protobuf's size once snappy is undone, not at the OTLP JSON it became", async () => {
    const protobuf: Buffer = v1(UP);
    const response: RouteResponse = await write(
      snappyCompress(protobuf),
      headersV1(),
    );

    expect(response.status).toBe(204);
    expect(jobs[0]!.ingestBytes).toBe(protobuf.length);
    expect(jobs[0]!.budgetCharge).toEqual(PENDING_CHARGE);
    // The JSON is several times larger: a budget would count it for more.
    expect(JSON.stringify(jobs[0]!.body).length).toBeGreaterThan(
      protobuf.length * 2,
    );
  });

  test("a protobuf sent without snappy (and without a Content-Encoding) is read, and counted, as it is", async () => {
    const protobuf: Buffer = v1(UP);
    const headers: Record<string, string> = headersV1();
    delete headers["content-encoding"];

    const response: RouteResponse = await write(protobuf, headers);

    expect(response.status).toBe(204);
    expect(jobs[0]!.ingestBytes).toBe(protobuf.length);
  });
});

describe("the size limits: as sent, decompressed, and in objects", () => {
  // A snappy block that declares `length` bytes and holds one literal.
  const declaring: (length: number) => Buffer = (length: number): Buffer => {
    const preamble: Array<number> = [];
    let remaining: number = length;

    while (remaining >= 0x80) {
      preamble.push((remaining & 0x7f) | 0x80);
      remaining = Math.floor(remaining / 128);
    }

    preamble.push(remaining);

    return Buffer.from([...preamble, 0x00, 0x61]);
  };

  // Every Buffer.allocUnsafe a request makes, by size.
  const watchAllocations: () => Array<number> = (): Array<number> => {
    const sizes: Array<number> = [];
    const original: typeof Buffer.allocUnsafe = Buffer.allocUnsafe;

    jest.spyOn(Buffer, "allocUnsafe").mockImplementation((size: number) => {
      sizes.push(size);
      return original.call(Buffer, size);
    });

    return sizes;
  };

  test("a snappy bomb - a few bytes that claim 4 GiB - is a 413, and nothing that size is allocated", async () => {
    const sizes: Array<number> = watchAllocations();

    const response: RouteResponse = await write(
      declaring(4294967295),
      headersV1(),
    );

    expect(response.status).toBe(413);
    expect(
      sizes.some((size: number): boolean => {
        return size >= MIB;
      }),
    ).toBe(false);
    expect(jobs).toHaveLength(0);
  });

  test("a body declaring just over the 32 MiB it may decompress to is a 413, before anything is allocated", async () => {
    const sizes: Array<number> = watchAllocations();

    const response: RouteResponse = await write(
      declaring(PROMETHEUS_REMOTE_WRITE_MAX_BYTES + 1),
      headersV1(),
    );

    expect(response.status).toBe(413);
    expect(response.text).toContain(String(PROMETHEUS_REMOTE_WRITE_MAX_BYTES));
    expect(
      sizes.some((size: number): boolean => {
        return size >= MIB;
      }),
    ).toBe(false);
  });

  test("a few bytes that claim 30 MiB - under the limit, but more than they could ever hold - are a 400, and nothing that size is allocated", async () => {
    const sizes: Array<number> = watchAllocations();

    const response: RouteResponse = await write(
      declaring(30 * MIB),
      headersV1(),
    );

    expect(response.status).toBe(400);
    expect(
      sizes.some((size: number): boolean => {
        return size >= MIB;
      }),
    ).toBe(false);
  });

  test("without a Content-Encoding a snappy bomb is still a 413, never read as protobuf", async () => {
    const headers: Record<string, string> = headersV1();
    delete headers["content-encoding"];

    const response: RouteResponse = await write(
      declaring(PROMETHEUS_REMOTE_WRITE_MAX_BYTES + 1),
      headers,
    );

    expect(response.status).toBe(413);
  });

  test("a body over 32 MiB as sent is a 413", async () => {
    const response: RouteResponse = await write(
      Buffer.alloc(PROMETHEUS_REMOTE_WRITE_MAX_BYTES + 1),
      headersV1(),
    );

    expect(response.status).toBe(413);
    expect(jobs).toHaveLength(0);
  });

  test("a small snappy body of half a million empty series - tens of megabytes of objects once decoded - is a 413, and is never decoded", async () => {
    const decode: jest.SpyInstance = jest.spyOn(WriteRequestV1, "decode");
    const series: number = PROMETHEUS_REMOTE_WRITE_MAX_ELEMENTS + 1;
    const protobuf: Buffer = Buffer.alloc(series * 2);

    for (let index: number = 0; index < series; index++) {
      protobuf[index * 2] = 0x0a;
      protobuf[index * 2 + 1] = 0x00;
    }

    const compressed: Buffer = snappyCompress(protobuf);

    // Repetition compresses well: the body is a small fraction of it.
    expect(compressed.length).toBeLessThan(protobuf.length / 10);

    const response: RouteResponse = await write(compressed, headersV1());

    expect(response.status).toBe(413);
    expect(response.text).toContain("max_samples_per_send");
    expect(decode).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  test("a request of 2,000 samples, as Prometheus sends by default, is far inside every limit", async () => {
    const timeseries: Array<JSONObject> = [];

    for (let index: number = 0; index < 2000; index++) {
      timeseries.push({
        labels: [
          { name: "__name__", value: "node_cpu_seconds_total" },
          { name: "cpu", value: String(index % 64) },
          { name: "instance", value: `host-${index % 30}:9100` },
          { name: "job", value: "node" },
          { name: "mode", value: index % 2 === 0 ? "user" : "system" },
        ],
        samples: [{ value: index, timestamp: 1700000000000 }],
      });
    }

    const response: RouteResponse = await write(
      snappyCompress(v1({ timeseries: timeseries })),
      headersV1(),
    );

    expect(response.status).toBe(204);
    expect(queuedPoints(jobs[0]!)).toHaveLength(2000);
  });
});
