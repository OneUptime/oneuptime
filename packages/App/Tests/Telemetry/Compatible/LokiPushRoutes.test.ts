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
import TelemetryIngestionBudget from "Common/Server/Utils/Telemetry/TelemetryIngestionBudget";
import { JSONObject } from "Common/Types/JSON";
import {
  COMPATIBLE_JSON_MAX_VALUES,
  LOKI_PUSH_MAX_BYTES,
  LOKI_PUSH_MAX_ELEMENTS,
  LOKI_PUSH_PATH,
} from "Common/Types/Telemetry/CompatibleIngest";
import LokiAPI from "../../../FeatureSet/Telemetry/API/Loki";
import TelemetryQueueService from "../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import { LokiPushRequestType } from "../../../FeatureSet/Telemetry/Utils/Compatible/LokiPush";
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
 * Loki's push API over HTTP, against the real router (#10148): what each
 * of Loki's clients sends - Promtail's snappy protobuf without a
 * Content-Encoding, Grafana Alloy's and Vector's with Content-Encoding:
 * snappy, Fluent Bit's JSON - the size a budget counts (the body
 * decompressed, never the OTLP JSON it became), and the limits a push is
 * held to before it is decoded: snappy bombs, half a million empty
 * streams, a stream's labels times its entries, a JSON body of empty
 * arrays. Real protobuf, real snappy, built here; only the key lookup, the
 * budget gate and the queue are mocked.
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
const MIB: number = 1024 * 1024;

let server: RouteServer;
let jobs: Array<QueuedJob> = [];

const queue: { addLogIngestJob: jest.Mock } =
  TelemetryQueueService as unknown as { addLogIngestJob: jest.Mock };

beforeAll(async () => {
  server = await startRouteServer([LokiAPI]);
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
});

afterEach(() => {
  jest.restoreAllMocks();
});

const encode: (request: JSONObject) => Buffer = (
  request: JSONObject,
): Buffer => {
  return Buffer.from(
    LokiPushRequestType.encode(
      LokiPushRequestType.fromObject(request),
    ).finish(),
  );
};

const PUSH: JSONObject = {
  streams: [
    {
      labels: '{job="varlogs", host="web-1"}',
      entries: [
        {
          timestamp: { seconds: 1700000000, nanos: 5 },
          line: 'level=error msg="payment failed"',
        },
        { timestamp: { seconds: 1700000001 }, line: "level=info msg=ok" },
      ],
    },
  ],
};

const JSON_PUSH: string = JSON.stringify({
  streams: [
    {
      stream: { app: "checkout", env: "prod" },
      values: [["1700000000000000000", 'level=error msg="payment failed"']],
    },
  ],
});

// Promtail: protobuf, snappy, and no Content-Encoding.
const promtailHeaders: (
  extra?: Record<string, string>,
) => Record<string, string> = (
  extra?: Record<string, string>,
): Record<string, string> => {
  return {
    authorization: `Bearer ${INGESTION_KEY}`,
    "content-type": "application/x-protobuf",
    "user-agent": "promtail/3.4.0",
    ...extra,
  };
};

// Grafana Alloy's loki.write and Vector's loki sink say Content-Encoding: snappy.
const alloyHeaders: (
  extra?: Record<string, string>,
) => Record<string, string> = (
  extra?: Record<string, string>,
): Record<string, string> => {
  return promtailHeaders({
    "content-encoding": "snappy",
    "user-agent": "Alloy/v1.8.0",
    ...extra,
  });
};

const jsonHeaders: (
  extra?: Record<string, string>,
) => Record<string, string> = (
  extra?: Record<string, string>,
): Record<string, string> => {
  return {
    authorization: `Bearer ${INGESTION_KEY}`,
    "content-type": "application/json",
    "user-agent": "Fluent-Bit",
    ...extra,
  };
};

const push: (
  body: Buffer | string,
  headers: Record<string, string>,
) => Promise<RouteResponse> = (
  body: Buffer | string,
  headers: Record<string, string>,
): Promise<RouteResponse> => {
  return send(`${server.url}${LOKI_PUSH_PATH}`, {
    headers: headers,
    body: body,
  });
};

const recordsOf: (job: QueuedJob) => Array<JSONObject> = (
  job: QueuedJob,
): Array<JSONObject> => {
  const records: Array<JSONObject> = [];

  for (const resource of job.body["resourceLogs"] as Array<JSONObject>) {
    for (const scope of resource["scopeLogs"] as Array<JSONObject>) {
      records.push(...(scope["logRecords"] as Array<JSONObject>));
    }
  }

  return records;
};

describe("what each of Loki's clients sends", () => {
  test("Promtail's snappy protobuf, with no Content-Encoding, is queued and answered 204", async () => {
    const response: RouteResponse = await push(
      snappyCompress(encode(PUSH)),
      promtailHeaders(),
    );

    expect(response.status).toBe(204);
    expect(recordsOf(jobs[0]!)).toHaveLength(2);
  });

  test.each<[string, string]>([
    ["Grafana Alloy", "Alloy/v1.8.0"],
    ["Vector", "Vector/0.46.1"],
  ])(
    "%s's push, which says Content-Encoding: snappy, has its snappy undone once - not twice, and refused",
    async (_client: string, userAgent: string) => {
      const response: RouteResponse = await push(
        snappyCompress(encode(PUSH)),
        alloyHeaders({ "user-agent": userAgent }),
      );

      expect(response.status).toBe(204);
      expect(recordsOf(jobs[0]!)).toHaveLength(2);
      expect(recordsOf(jobs[0]!)[0]!["timeUnixNano"]).toBe(
        "1700000000000000005",
      );
    },
  );

  test("a gzipped snappy protobuf has both undone", async () => {
    const response: RouteResponse = await push(
      zlib.gzipSync(snappyCompress(encode(PUSH))),
      promtailHeaders({ "content-encoding": "gzip" }),
    );

    expect(response.status).toBe(204);
    expect(recordsOf(jobs[0]!)).toHaveLength(2);
  });

  test("a JSON push that says Content-Encoding: snappy is read as it is, as Loki reads it", async () => {
    const response: RouteResponse = await push(
      JSON_PUSH,
      jsonHeaders({ "content-encoding": "snappy" }),
    );

    expect(response.status).toBe(204);
    expect(recordsOf(jobs[0]!)).toHaveLength(1);
  });

  test("Fluent Bit's gzipped JSON", async () => {
    const response: RouteResponse = await push(
      zlib.gzipSync(Buffer.from(JSON_PUSH)),
      jsonHeaders({ "content-encoding": "gzip" }),
    );

    expect(response.status).toBe(204);
    expect(recordsOf(jobs[0]!)[0]!["severityNumber"]).toBe(17);
  });
});

describe("the size a budget counts: the body decompressed", () => {
  test("a protobuf push is counted at its protobuf once snappy is undone, not at the OTLP JSON it became", async () => {
    const protobuf: Buffer = encode(PUSH);
    const response: RouteResponse = await push(
      snappyCompress(protobuf),
      promtailHeaders(),
    );

    expect(response.status).toBe(204);
    expect(jobs[0]!.ingestBytes).toBe(protobuf.length);
    expect(jobs[0]!.budgetCharge).toEqual(PENDING_CHARGE);
    // The JSON is many times larger: a budget would count it for more.
    expect(JSON.stringify(jobs[0]!.body).length).toBeGreaterThan(
      protobuf.length * 4,
    );
  });

  test("Alloy's push, Content-Encoding: snappy, is counted at its protobuf too", async () => {
    const protobuf: Buffer = encode(PUSH);

    await push(snappyCompress(protobuf), alloyHeaders());

    expect(jobs[0]!.ingestBytes).toBe(protobuf.length);
  });

  test("a JSON push is counted at the JSON as read, and a gzipped one at its JSON decompressed", async () => {
    await push(JSON_PUSH, jsonHeaders());
    await push(
      zlib.gzipSync(Buffer.from(JSON_PUSH)),
      jsonHeaders({ "content-encoding": "gzip" }),
    );

    expect(
      jobs.map((job: QueuedJob) => {
        return job.ingestBytes;
      }),
    ).toEqual([Buffer.byteLength(JSON_PUSH), Buffer.byteLength(JSON_PUSH)]);
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

  const anyOverAMebibyte: (sizes: Array<number>) => boolean = (
    sizes: Array<number>,
  ): boolean => {
    return sizes.some((size: number): boolean => {
      return size >= MIB;
    });
  };

  test("a snappy bomb - a few bytes that claim 4 GiB - is a 413, and nothing that size is allocated", async () => {
    const sizes: Array<number> = watchAllocations();

    const response: RouteResponse = await push(
      declaring(4294967295),
      promtailHeaders(),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(anyOverAMebibyte(sizes)).toBe(false);
    expect(jobs).toHaveLength(0);
  });

  test("a push declaring just over the 32 MiB it may decompress to is a 413, before anything is allocated - with Content-Encoding: snappy too", async () => {
    for (const headers of [promtailHeaders(), alloyHeaders()]) {
      const sizes: Array<number> = watchAllocations();

      const response: RouteResponse = await push(
        declaring(LOKI_PUSH_MAX_BYTES + 1),
        headers,
      );

      expect(response.status).toBe(413);
      expect(response.text).toContain(String(LOKI_PUSH_MAX_BYTES));
      expect(anyOverAMebibyte(sizes)).toBe(false);
      jest.restoreAllMocks();
    }
  });

  test("a few bytes that claim 30 MiB - under the limit, but more than they could ever hold - are a 400, and nothing that size is allocated", async () => {
    const sizes: Array<number> = watchAllocations();

    const response: RouteResponse = await push(
      declaring(30 * MIB),
      promtailHeaders(),
    );

    expect(response.status).toBe(400);
    expect(response.text).toContain("snappy");
    expect(anyOverAMebibyte(sizes)).toBe(false);
  });

  test("a push over 32 MiB as sent is a 413", async () => {
    const response: RouteResponse = await push(
      Buffer.alloc(LOKI_PUSH_MAX_BYTES + 1),
      promtailHeaders(),
    );

    expect(response.status).toBe(413);
    expect(jobs).toHaveLength(0);
  });

  test("gzipped JSON that decompresses past 32 MiB is a 413", async () => {
    const response: RouteResponse = await push(
      zlib.gzipSync(Buffer.alloc(LOKI_PUSH_MAX_BYTES + 1, 0x20)),
      jsonHeaders({ "content-encoding": "gzip" }),
    );

    expect(response.status).toBe(413);
    expect(response.text).toContain(String(LOKI_PUSH_MAX_BYTES));
  });

  test("a small snappy body of half a million empty streams - hundreds of megabytes once decoded - is a 413, and is never decoded", async () => {
    const decode: jest.SpyInstance = jest.spyOn(LokiPushRequestType, "decode");
    const streams: number = LOKI_PUSH_MAX_ELEMENTS + 1;
    const protobuf: Buffer = Buffer.alloc(streams * 2);

    for (let index: number = 0; index < streams; index++) {
      protobuf[index * 2] = 0x0a;
      protobuf[index * 2 + 1] = 0x00;
    }

    const compressed: Buffer = snappyCompress(protobuf);

    // Repetition compresses well: the body is a small fraction of it.
    expect(compressed.length).toBeLessThan(protobuf.length / 10);

    const response: RouteResponse = await push(compressed, alloyHeaders());

    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.text).toContain("lower the client's batch size");
    expect(decode).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  test("a stream of 50 labels and 20,000 empty entries - a million attributes once translated - is a 413, though its protobuf holds 40,000 objects", async () => {
    const labels: string = `{${Array.from(
      { length: 50 },
      (_: unknown, index: number): string => {
        return `label_${index}="value"`;
      },
    ).join(", ")}}`;
    const protobuf: Buffer = encode({
      streams: [
        {
          labels: labels,
          entries: Array.from({ length: 20000 }, (): JSONObject => {
            return { timestamp: { seconds: 1700000000 }, line: "" };
          }),
        },
      ],
    });

    const response: RouteResponse = await push(
      snappyCompress(protobuf),
      promtailHeaders(),
    );

    expect(response.status).toBe(413);
    expect(response.text).toContain(
      "a stream's labels counted once for each of its entries",
    );
    expect(jobs).toHaveLength(0);
  });

  test("a JSON body of a million empty arrays is a 413, and is never parsed", async () => {
    const body: string = `{"streams":[{"stream":{"app":"a"},"values":[${"[],".repeat(
      COMPATIBLE_JSON_MAX_VALUES,
    )}[]]}]}`;
    const parse: jest.SpyInstance = jest.spyOn(JSON, "parse");

    const response: RouteResponse = await push(body, jsonHeaders());
    const parsedTheBody: boolean = parse.mock.calls.some(
      (call: Array<unknown>): boolean => {
        return typeof call[0] === "string" && call[0].length >= body.length;
      },
    );

    expect(response.status).toBe(413);
    expect(response.text).toContain("JSON values");
    expect(parsedTheBody).toBe(false);
  });

  test("a default Promtail batch - 1 MiB of 100-byte lines - is far inside every limit", async () => {
    const line: string = "x".repeat(100);
    const entries: number = Math.floor(MIB / 120);
    const response: RouteResponse = await push(
      snappyCompress(
        encode({
          streams: [
            {
              labels:
                '{job="varlogs", host="web-1", env="prod", app="checkout", filename="/var/log/app.log"}',
              entries: Array.from({ length: entries }, (): JSONObject => {
                return { timestamp: { seconds: 1700000000 }, line: line };
              }),
            },
          ],
        }),
      ),
      alloyHeaders(),
    );

    expect(response.status).toBe(204);
    expect(recordsOf(jobs[0]!)).toHaveLength(entries);
  });
});
