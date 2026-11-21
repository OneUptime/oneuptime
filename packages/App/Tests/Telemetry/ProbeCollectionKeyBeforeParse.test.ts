/*
 * A PROBE'S COLLECTION, AUTHENTICATED BEFORE IT IS READ (#10222, #10260),
 * over HTTP.
 *
 * A vCenter's or an OpenStack cloud's collection is up to 48 MiB of JSON,
 * millions of values: 8,000,000 cost JSON.parse 1.4 s and 490 MiB. The
 * probe's key used to be read from the parsed report, so anyone who could
 * reach the probe ingest could have the App parse that much. Here the real
 * collection routers are mounted where the App mounts them, with no body
 * parser before them, as StartServer leaves these routes
 * (Common/Tests/Server/Utils/RequestBodyLimitOverHttp holds it to that).
 * The probe's key is checked by the real ProbeService against a stand-in for
 * the probe table, wrong keys are counted by the real WrongComponentKeyLimit
 * against a stand-in for Valkey, and what each request cost is watched: the
 * bytes the server read off its connection, the bytes zlib inflated, the
 * bytes whose JSON values were counted, and JSON.parse:
 *
 *   - a wrong key in the headers is refused before a byte of the body is
 *     read, and counted as a wrong key is from a body;
 *   - a probe that sends its key in the headers has a 40 MiB report read and
 *     parsed whole;
 *   - an older probe, whose key is in its report alone, has it checked from
 *     the start of the report, before the rest is read, and a large report
 *     still read whole;
 *   - a client without the right key is refused after the first few
 *     kilobytes of its body, however it is compressed or shaped (#10260): a
 *     decompression bomb, a body nested millions deep, a report that opens
 *     with a probe's id and a wrong key. It used to have 50 MiB inflated and
 *     8,000,000 values counted first.
 */
import FakeCounterRedis from "Common/Tests/Server/TestingUtils/Redis/FakeCounterRedis";
import {
  WRONG_COMPONENT_KEYS_PER_ADDRESS,
  WRONG_PROBE_KEYS_MESSAGE,
} from "Common/Server/Utils/RateLimit/WrongComponentKeyLimit";
import {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  createExpressApp,
} from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import ProbeKeyHeaders, {
  PROBE_ID_HEADER,
  PROBE_KEY_HEADER,
} from "Common/Types/Probe/ProbeKeyHeaders";
import Dictionary from "Common/Types/Dictionary";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";
import { Readable } from "stream";
import zlib from "zlib";

const mockRedisState: { client: FakeCounterRedis | null; connected: boolean } =
  { client: null, connected: false };

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return mockRedisState.client;
      },
      isConnected: (): boolean => {
        return mockRedisState.connected;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

// What each route recorded a collection as: the probe it took it to be from.
const mockRecorded: Array<{ probeId: string; resources: number }> = [];

const mockRecordCollectionReport: (data: {
  probeId: { toString: () => string };
  report: { resourceMetrics?: unknown };
}) => Promise<unknown> = async (data: {
  probeId: { toString: () => string };
  report: { resourceMetrics?: unknown };
}): Promise<unknown> => {
  mockRecorded.push({
    probeId: data.probeId.toString(),
    resources: Array.isArray(data.report.resourceMetrics)
      ? data.report.resourceMetrics.length
      : 0,
  });

  return {
    accepted: true,
    projectId: {
      toString: (): string => {
        return "project";
      },
    },
    vcenterName: "Production",
    cloudName: "Production",
    isCurrent: true,
  };
};

jest.mock("Common/Server/Services/VMwareVCenterService", () => {
  return {
    __esModule: true,
    default: { recordCollectionReport: mockRecordCollectionReport },
  };
});

jest.mock("Common/Server/Services/VMwareVCenterConnectionTestService", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/OpenStackCloudService", () => {
  return {
    __esModule: true,
    default: { recordCollectionReport: mockRecordCollectionReport },
  };
});

jest.mock("Common/Server/Services/OpenStackCloudConnectionTestService", () => {
  return { __esModule: true, default: {} };
});

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return { __esModule: true, default: {} };
  },
);

// Nothing is ingested: what is read and who it is from is all that is asked.
jest.mock("Common/Server/Middleware/TelemetryIngestionDisabled", () => {
  return {
    __esModule: true,
    default: {
      isDisabled: (): boolean => {
        return true;
      },
    },
  };
});

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const KIB: number = 1024;
const MIB: number = 1024 * 1024;

// The probes the probe table holds: id -> key.
const PROBES: Record<string, string> = {
  "6c7f1e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b": "probe-one-key-3b9f1c7e5a2d48f6b0e9",
  "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f": "pr0be-(two) key!*~ clé 東京",
};

const PROBE_ONE: string = Object.keys(PROBES)[0]!;
const PROBE_TWO: string = Object.keys(PROBES)[1]!;

const CLIENT: string = "203.0.113.40";
const OTHER_CLIENT: string = "198.51.100.41";

const VMWARE: string = "/probe-ingest/probe/vmware/collection";
const OPENSTACK: string = "/probe-ingest/probe/openstack/collection";

/*
 * What a client without the right key may cost before it is refused
 * (#10260), as RequestBodyOpening reads an opening: a socket read or two
 * off the connection, of whatever was sent; as inflated, the 4 KiB opening,
 * the zlib output chunk that holds it and one more the inflate holds; and
 * not a value counted or parsed.
 */
const MOST_READ_BEFORE_THE_KEY: number = 512 * KIB;
const MOST_INFLATED_BEFORE_THE_KEY: number = 4 * KIB + 48 * KIB;

// The probe table as Postgres answers the service's lookups.
function probeTable(query: JSONObject): JSONObject | null {
  const id: string | undefined = Object.keys(PROBES).find(
    (candidate: string): boolean => {
      return candidate === String(query["_id"]).toLowerCase();
    },
  );

  return id ? { _id: id, key: PROBES[id]! } : null;
}

interface RunningApp {
  server: http.Server;
  port: number;
  probeService: AnyModule;
  gzipReader: AnyModule;
  jsonTally: AnyModule;
}

let running: RunningApp;
let redis: FakeCounterRedis;

// What the server read off each request's connection by the time it answered.
const bytesReadByRequest: Map<string, number> = new Map();

/*
 * What zlib inflated, counted where its streams hand their output on: what
 * the readers took and what an inflate holds for them alike; and the bytes
 * whose JSON values were counted.
 */
const watched: { inflated: number; counted: number } = {
  inflated: 0,
  counted: 0,
};

// When each key check ran: what had been inflated by then.
const inflatedAtKeyCheck: Array<number> = [];

beforeAll(async () => {
  let vmware: AnyModule;
  let openStack: AnyModule;
  let probeService: AnyModule;
  let gzipReader: AnyModule;
  let jsonTally: AnyModule;

  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const ObjectIDModule: AnyModule = require("Common/Types/ObjectID");
    probeService = require("Common/Server/Services/ProbeService").default;

    probeService.findOneBy = jest.fn(async (findBy: unknown) => {
      const row: JSONObject | null = probeTable(
        (findBy as { query: JSONObject }).query,
      );

      if (!row) {
        return null;
      }

      const probe: AnyModule = { _id: row["_id"], key: row["key"] };
      probe.id = new ObjectIDModule.default(row["_id"] as string);
      return probe;
    });
    probeService.updateLastAlive = jest.fn(async () => {});

    /*
     * The real check, watched: when it ran, against JSON.parse, and how much
     * of the body had been inflated by then.
     */
    const verifyProbeKey: (data: unknown) => Promise<boolean> =
      probeService.verifyProbeKey.bind(probeService);
    probeService.verifyProbeKey = jest.fn(
      async (data: unknown): Promise<boolean> => {
        inflatedAtKeyCheck.push(watched.inflated);
        return await verifyProbeKey(data);
      },
    );

    gzipReader = require("Common/Server/Middleware/GzipRequestBody").default;
    jsonTally = require("Common/Utils/JsonElementCount").JsonElementTally;

    vmware =
      require("../../FeatureSet/Telemetry/API/ProbeIngest/VMwareCollection").default;
    openStack =
      require("../../FeatureSet/Telemetry/API/ProbeIngest/OpenStackCollection").default;
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  });

  const app: ExpressApplication = createExpressApp();

  app.use((req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    const tag: string = String(req.headers["x-test"] || "");

    res.on("finish", () => {
      bytesReadByRequest.set(tag, req.socket.bytesRead);
    });

    next();
  });

  // As the App mounts them, with no body parser before them.
  app.use(["/probe-ingest", "/ingestor", "/"], vmware);
  app.use(["/probe-ingest", "/ingestor", "/"], openStack);

  // As expressErrorHandler answers a parser's refusal: its status and type.
  app.use(
    (
      err: Record<string, unknown>,
      _req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ): void => {
      res.status(Number(err["status"]) || 500).json({
        type: err["type"],
        message: err["message"],
        limit: err["limit"],
      });
    },
  );

  const server: http.Server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  running = {
    server: server,
    port: (server.address() as AddressInfo).port,
    probeService: probeService!,
    gzipReader: gzipReader!,
    jsonTally: jsonTally!,
  };
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    running.server.close(() => {
      resolve();
    });
  });
});

let jsonParse: ReturnType<typeof jest.spyOn>;
let gzipReads: ReturnType<typeof jest.spyOn>;
let watchers: Array<ReturnType<typeof jest.spyOn>> = [];

const readablePush: Readable["push"] = Readable.prototype.push;

// zlib's own functions are read-only: its output is counted on its streams.
const ZLIB_STREAMS: Array<{ push: Readable["push"] }> = [
  (zlib as unknown as { Gunzip: { prototype: { push: Readable["push"] } } })
    .Gunzip.prototype,
  (zlib as unknown as { Inflate: { prototype: { push: Readable["push"] } } })
    .Inflate.prototype,
];

beforeEach(() => {
  redis = new FakeCounterRedis();
  mockRedisState.client = redis;
  mockRedisState.connected = true;
  mockRecorded.length = 0;
  inflatedAtKeyCheck.length = 0;
  watched.inflated = 0;
  watched.counted = 0;
  running.probeService.verifyProbeKey.mockClear();
  running.probeService.findOneBy.mockClear();

  jsonParse?.mockRestore();
  jsonParse = jest.spyOn(JSON, "parse");
  gzipReads?.mockRestore();
  gzipReads = jest.spyOn(running.gzipReader, "parseBody");

  watchers = ZLIB_STREAMS.map(
    (prototype: { push: Readable["push"] }): ReturnType<typeof jest.spyOn> => {
      return jest.spyOn(prototype, "push").mockImplementation(function (
        this: Readable,
        chunk: unknown,
        encoding?: Parameters<Readable["push"]>[1],
      ): boolean {
        if (Buffer.isBuffer(chunk)) {
          watched.inflated += chunk.length;
        }

        return readablePush.call(this, chunk, encoding);
      });
    },
  );

  const tallyAdd: (bytes: Uint8Array, start?: number, end?: number) => boolean =
    running.jsonTally.prototype.add;

  watchers.push(
    jest.spyOn(running.jsonTally.prototype, "add").mockImplementation(function (
      this: unknown,
      bytes: unknown,
      start?: unknown,
      end?: unknown,
    ): boolean {
      const counted: Uint8Array = bytes as Uint8Array;
      const from: number = (start as number | undefined) ?? 0;
      const to: number = Math.min(
        (end as number | undefined) ?? counted.length,
        counted.length,
      );

      watched.counted += Math.max(0, to - from);

      return tallyAdd.call(
        this,
        counted,
        start as number | undefined,
        end as number | undefined,
      );
    }),
  );
});

afterEach(() => {
  for (const watcher of watchers) {
    watcher.mockRestore();
  }

  watchers = [];
});

// The JSON.parse calls that read a text of at least `bytes`, in call order.
function parsesOfAtLeast(bytes: number): Array<number> {
  return jsonParse.mock.calls
    .map((call: Array<unknown>, index: number): number => {
      return typeof call[0] === "string" && call[0].length >= bytes
        ? jsonParse.mock.invocationCallOrder[index]!
        : -1;
    })
    .filter((order: number): boolean => {
      return order >= 0;
    });
}

// When the probe's key was checked, in call order.
function keyChecks(): Array<number> {
  return running.probeService.verifyProbeKey.mock.invocationCallOrder;
}

interface Answer {
  status: number;
  body: JSONObject;
  retryAfter: string | undefined;
  connection: string | undefined;
  // What the server read off the request's connection by its answer.
  bytesRead: number;
}

let requestCount: number = 0;

/*
 * Each request on a connection of its own, which asks to be kept alive:
 * what the server read off it is this request's alone, and whether it is
 * closed is the server's choice.
 */
function post(data: {
  path: string;
  body: Buffer;
  from?: string;
  headers?: Dictionary<string>;
  gzip?: boolean;
}): Promise<Answer> {
  const agent: http.Agent = new http.Agent({ keepAlive: true });
  const tag: string = `request-${++requestCount}`;

  return new Promise<Answer>(
    (resolve: (answer: Answer) => void, reject: (err: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: running.port,
          path: data.path,
          method: "POST",
          agent: agent,
          headers: {
            "content-type": "application/json",
            ...(data.gzip === false ? {} : { "content-encoding": "gzip" }),
            ...(data.headers || {}),
            "content-length": String(data.body.length),
            // As the bundled Nginx forwards it: the client's address last.
            "x-forwarded-for": data.from || CLIENT,
            "x-test": tag,
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            const text: string = Buffer.concat(chunks).toString("utf8");
            const retryAfter: string | string[] | undefined =
              response.headers["retry-after"];

            agent.destroy();
            resolve({
              status: response.statusCode || 0,
              body: text ? (JSON.parse(text) as JSONObject) : {},
              retryAfter: Array.isArray(retryAfter)
                ? retryAfter[0]
                : retryAfter,
              connection: response.headers["connection"],
              bytesRead: bytesReadByRequest.get(tag) || 0,
            });
          });
        },
      );

      // A server that answered before reading the body closes under it.
      request.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "EPIPE" && err.code !== "ECONNRESET") {
          agent.destroy();
          reject(err);
        }
      });
      request.end(data.body);
    },
  );
}

// The headers a probe sends with a collection, for a probe and a key.
function keyHeaders(probeId: string, probeKey: string): Dictionary<string> {
  return ProbeKeyHeaders.build({ probeId: probeId, probeKey: probeKey });
}

/*
 * A collection report as every probe release writes it: its key and id first
 * (ProbeAPIRequest.getDefaultRequestBody), then the report, with `points`
 * data points of about ten JSON values each.
 */
function report(data: {
  probeId: string;
  probeKey: string;
  points: number;
  kind?: "vmware" | "openstack";
}): Buffer {
  const head: JSONObject = {
    probeKey: data.probeKey,
    probeId: data.probeId,
    probeCapabilities: ["networkDevicePing", "retryAllWorkWhenBusy"],
    probeVersion: "17.0.1",
    ...(data.kind === "openstack"
      ? { openStackCloudId: "55555555-5555-4555-8555-555555555555" }
      : { vmwareVCenterId: "44444444-4444-4444-8444-444444444444" }),
    settingsVersion: 3,
    collectedAt: "2026-11-20T12:00:00.000Z",
    status: "Succeeded",
    durationInMs: 900,
  };

  const point: string = JSON.stringify({
    resource: {
      attributes: [{ key: "vcenter.vm.name", value: { stringValue: "vm-1" } }],
    },
    scopeMetrics: [{ metrics: [{ name: "cpu", gauge: { dataPoints: [] } }] }],
  });

  return Buffer.from(
    `${JSON.stringify(head).slice(0, -1)},"resourceMetrics":[${Array.from(
      { length: data.points },
      (): string => {
        return point;
      },
    ).join(",")}]}`,
  );
}

// "[{},{},...]": `count` empty objects, three bytes each.
function emptyObjects(count: number): Buffer {
  return Buffer.from(`[${"{},".repeat(count - 1)}{}]`);
}

// 40 MiB of report, built once: millions of values, more than a large route reads.
let largeReportOfProbeOne: Buffer;

beforeAll(() => {
  largeReportOfProbeOne = zlib.gzipSync(
    report({
      probeId: PROBE_ONE,
      probeKey: PROBES[PROBE_ONE]!,
      points: 310000,
    }),
  );
});

describe("a probe that sends its key in the headers", () => {
  test("has a 40 MiB report, of millions of values, read and parsed whole, after its key is checked", async () => {
    const inflatedBytes: number = zlib.gunzipSync(largeReportOfProbeOne).length;

    expect(inflatedBytes).toBeGreaterThan(40 * MIB);
    expect(inflatedBytes).toBeLessThan(48 * MIB);

    watched.inflated = 0;

    const answer: Answer = await post({
      path: VMWARE,
      body: largeReportOfProbeOne,
      headers: keyHeaders(PROBE_ONE, PROBES[PROBE_ONE]!),
    });

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ accepted: true });
    expect(answer.connection).toBe("keep-alive");
    expect(mockRecorded).toEqual([{ probeId: PROBE_ONE, resources: 310000 }]);

    // The key was checked once, from the headers, before a byte was inflated.
    expect(keyChecks()).toHaveLength(1);
    expect(inflatedAtKeyCheck).toEqual([0]);
    expect(parsesOfAtLeast(MIB)).toHaveLength(1);
    expect(keyChecks()[0]!).toBeLessThan(parsesOfAtLeast(MIB)[0]!);

    // Read as it always was: by the gzip reader, whole.
    expect(gzipReads).toHaveBeenCalledTimes(1);
    expect(watched.inflated).toBe(inflatedBytes);
  }, 120000);

  test("is refused with not a byte of the body read when the key is wrong, and the body is never parsed", async () => {
    const answer: Answer = await post({
      path: VMWARE,
      body: largeReportOfProbeOne,
      headers: keyHeaders(PROBE_ONE, "a-wrong-key"),
    });

    // The same refusal a wrong key in a body gets.
    expect(answer.status).toBe(400);
    expect(answer.body["message"]).toBe("Invalid Probe ID or Probe Key");

    expect(gzipReads).not.toHaveBeenCalled();
    expect(watched.inflated).toBe(0);
    expect(parsesOfAtLeast(MIB)).toEqual([]);
    expect(mockRecorded).toEqual([]);
  }, 120000);

  test("is refused on its headers even when its body carries the right key: the headers are checked first", async () => {
    const answer: Answer = await post({
      path: OPENSTACK,
      body: zlib.gzipSync(
        report({
          probeId: PROBE_ONE,
          probeKey: PROBES[PROBE_ONE]!,
          points: 10,
          kind: "openstack",
        }),
      ),
      headers: keyHeaders(PROBE_ONE, "a-wrong-key"),
    });

    expect(answer.status).toBe(400);
    expect(answer.body["message"]).toBe("Invalid Probe ID or Probe Key");
    expect(gzipReads).not.toHaveBeenCalled();
    expect(mockRecorded).toEqual([]);
  });

  test("ten different wrong keys from a client, then it is refused for that probe, the right key too, as a body's wrong keys are", async () => {
    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      const answer: Answer = await post({
        path: VMWARE,
        body: zlib.gzipSync(emptyObjects(10)),
        headers: keyHeaders(PROBE_ONE, `guess-${index}`),
      });

      expect(answer.status).toBe(400);
    }

    for (const key of ["guess-eleven", PROBES[PROBE_ONE]!]) {
      const answer: Answer = await post({
        path: VMWARE,
        body: zlib.gzipSync(emptyObjects(10)),
        headers: keyHeaders(PROBE_ONE, key),
      });

      expect(answer.status).toBe(429);
      expect(answer.body["message"]).toBe(WRONG_PROBE_KEYS_MESSAGE);
      expect(Number(answer.retryAfter)).toBeGreaterThanOrEqual(1);
    }

    // A wrong key in a report's opening, from that client: refused the same.
    const opening: Answer = await post({
      path: VMWARE,
      body: zlib.gzipSync(
        report({
          probeId: PROBE_ONE,
          probeKey: "guess-in-the-body",
          points: 1,
        }),
      ),
    });

    expect(opening.status).toBe(429);

    // The probe itself, from its own address: answered.
    expect(
      (
        await post({
          path: VMWARE,
          from: OTHER_CLIENT,
          body: zlib.gzipSync(
            report({
              probeId: PROBE_ONE,
              probeKey: PROBES[PROBE_ONE]!,
              points: 1,
            }),
          ),
          headers: keyHeaders(PROBE_ONE, PROBES[PROBE_ONE]!),
        })
      ).status,
    ).toBe(200);

    /*
     * Only the probe's own report went through the gzip reader: the others
     * were refused on their headers, and the opening's report was read no
     * further than its opening (RequestBodyOpening).
     */
    expect(gzipReads).toHaveBeenCalledTimes(1);
  });

  test("with only one of the two headers, is refused as a body without both is", async () => {
    for (const headers of [
      { [PROBE_ID_HEADER]: PROBE_ONE },
      { [PROBE_KEY_HEADER]: encodeURIComponent(PROBES[PROBE_ONE]!) },
    ]) {
      const answer: Answer = await post({
        path: VMWARE,
        body: zlib.gzipSync(
          report({
            probeId: PROBE_ONE,
            probeKey: PROBES[PROBE_ONE]!,
            points: 1,
          }),
        ),
        headers: headers,
      });

      expect(answer.status).toBe(400);
      expect(answer.body["message"]).toBe("ProbeId or ProbeKey is missing");
    }

    expect(gzipReads).not.toHaveBeenCalled();
  });

  test("is the headers' probe, whatever probe the report names", async () => {
    const answer: Answer = await post({
      path: OPENSTACK,
      body: zlib.gzipSync(
        report({
          probeId: PROBE_TWO,
          probeKey: PROBES[PROBE_TWO]!,
          points: 3,
          kind: "openstack",
        }),
      ),
      headers: keyHeaders(PROBE_ONE, PROBES[PROBE_ONE]!),
    });

    expect(answer.status).toBe(200);
    expect(mockRecorded).toEqual([{ probeId: PROBE_ONE, resources: 3 }]);
    expect(keyChecks()).toHaveLength(1);
  });

  test("with a key an operator typed, beyond Latin-1, carried as the probe sends it", async () => {
    const answer: Answer = await post({
      path: OPENSTACK,
      body: zlib.gzipSync(
        report({
          probeId: PROBE_TWO,
          probeKey: PROBES[PROBE_TWO]!,
          points: 2,
          kind: "openstack",
        }),
      ),
      headers: keyHeaders(PROBE_TWO, PROBES[PROBE_TWO]!),
    });

    expect(answer.status).toBe(200);
    expect(mockRecorded).toEqual([{ probeId: PROBE_TWO, resources: 2 }]);
  });

  test("sent uncompressed, is read the same way", async () => {
    const answer: Answer = await post({
      path: VMWARE,
      gzip: false,
      body: report({
        probeId: PROBE_ONE,
        probeKey: PROBES[PROBE_ONE]!,
        points: 120000,
      }),
      headers: keyHeaders(PROBE_ONE, PROBES[PROBE_ONE]!),
    });

    expect(answer.status).toBe(200);
    expect(mockRecorded).toEqual([{ probeId: PROBE_ONE, resources: 120000 }]);
  }, 60000);
});

describe("an older probe, whose key is in its report alone", () => {
  test("has its key checked from the start of its report, before the rest is read, and a 40 MiB report read whole", async () => {
    const inflatedBytes: number = zlib.gunzipSync(largeReportOfProbeOne).length;

    watched.inflated = 0;

    const answer: Answer = await post({
      path: VMWARE,
      body: largeReportOfProbeOne,
    });

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ accepted: true });
    expect(answer.connection).toBe("keep-alive");
    expect(mockRecorded).toEqual([{ probeId: PROBE_ONE, resources: 310000 }]);

    // Checked once, with no more than its opening inflated, then read whole.
    expect(keyChecks()).toHaveLength(1);
    expect(inflatedAtKeyCheck).toHaveLength(1);
    expect(inflatedAtKeyCheck[0]!).toBeLessThanOrEqual(
      MOST_INFLATED_BEFORE_THE_KEY,
    );
    expect(watched.inflated).toBe(inflatedBytes);

    // Its values counted as it inflated, the opening's among them, then parsed.
    expect(watched.counted).toBeGreaterThanOrEqual(inflatedBytes);
    expect(parsesOfAtLeast(MIB)).toHaveLength(1);
    expect(keyChecks()[0]!).toBeLessThan(parsesOfAtLeast(MIB)[0]!);
  }, 120000);

  test("an OpenStack cloud's report of more than a large route's million values, the same", async () => {
    const answer: Answer = await post({
      path: OPENSTACK,
      body: zlib.gzipSync(
        report({
          probeId: PROBE_TWO,
          probeKey: PROBES[PROBE_TWO]!,
          points: 120000,
          kind: "openstack",
        }),
      ),
    });

    expect(answer.status).toBe(200);
    expect(mockRecorded).toEqual([{ probeId: PROBE_TWO, resources: 120000 }]);
    expect(keyChecks()[0]!).toBeLessThan(parsesOfAtLeast(MIB)[0]!);
  }, 60000);

  test("sent uncompressed or deflated, the same", async () => {
    const json: Buffer = report({
      probeId: PROBE_ONE,
      probeKey: PROBES[PROBE_ONE]!,
      points: 120000,
    });

    for (const sent of [
      { body: json, headers: {} },
      {
        body: zlib.deflateSync(json),
        headers: { "content-encoding": "deflate" },
      },
    ]) {
      mockRecorded.length = 0;

      const answer: Answer = await post({
        path: VMWARE,
        gzip: false,
        body: sent.body,
        headers: sent.headers,
      });

      expect(answer.status).toBe(200);
      expect(mockRecorded).toEqual([{ probeId: PROBE_ONE, resources: 120000 }]);
    }
  }, 60000);

  test("is refused when that key is wrong, its report never read past its opening, the wrong key counted", async () => {
    const answer: Answer = await post({
      path: VMWARE,
      body: zlib.gzipSync(
        report({ probeId: PROBE_ONE, probeKey: "an-old-key", points: 120000 }),
      ),
    });

    expect(answer.status).toBe(400);
    expect(answer.body["message"]).toBe("Invalid Probe ID or Probe Key");
    expect(answer.connection).toBe("close");
    expect(watched.inflated).toBeLessThanOrEqual(MOST_INFLATED_BEFORE_THE_KEY);
    expect(watched.counted).toBe(0);
    expect(parsesOfAtLeast(KIB)).toEqual([]);
    expect(mockRecorded).toEqual([]);
    expect(redis.sets.size).toBe(1);
  }, 60000);

  test("still works with a small report, as it always has", async () => {
    for (const path of [
      VMWARE,
      "/ingestor/probe/vmware/collection",
      "/probe/vmware/collection",
    ]) {
      const answer: Answer = await post({
        path: path,
        body: zlib.gzipSync(
          report({
            probeId: PROBE_ONE,
            probeKey: PROBES[PROBE_ONE]!,
            points: 5,
          }),
        ),
      });

      expect({ path, status: answer.status }).toEqual({ path, status: 200 });
    }

    expect(mockRecorded).toHaveLength(3);
  });

  test("a report of a failed collection, shorter than an opening, is its own opening", async () => {
    const body: string = JSON.stringify({
      probeKey: PROBES[PROBE_TWO],
      probeId: PROBE_TWO,
      openStackCloudId: "55555555-5555-4555-8555-555555555555",
      status: "Failed",
      errorMessage: "Keystone answered 401.",
    });

    expect(body.length).toBeLessThan(4 * KIB);

    const answer: Answer = await post({
      path: OPENSTACK,
      body: zlib.gzipSync(Buffer.from(body)),
    });

    expect(answer.status).toBe(200);
    expect(mockRecorded).toEqual([{ probeId: PROBE_TWO, resources: 0 }]);
  });
});

/*
 * A client without the right key (#10260). It sends no key headers, so its
 * body is read as an older probe's: no further than the key and id every
 * probe release opens its report with. Whatever the body is - and however
 * it is compressed - it is refused there, having cost the App a socket read
 * or two and a few dozen kilobytes inflated, with not a value counted or
 * parsed and its connection closed. Before, a body like each of these was
 * read whole first: up to 50 MiB inflated and 8,000,000 values counted.
 */
describe("a client without the right key", () => {
  interface Shape {
    name: string;
    body: () => Buffer;
    encoding: "gzip" | "deflate" | "identity";
    // The answer it is refused with.
    message: string;
  }

  const random: SeededRandom = seededRandom(10260);

  const SHAPES: Array<Shape> = [
    {
      name: "8 million empty objects, gzip: a few hundred KB inflating to 24 MiB",
      body: (): Buffer => {
        return zlib.gzipSync(emptyObjects(7900000));
      },
      encoding: "gzip",
      message: "ProbeId or ProbeKey is missing",
    },
    {
      name: "a decompression bomb: 50 MiB of zeros in 50 KB of gzip",
      body: (): Buffer => {
        return zlib.gzipSync(Buffer.alloc(50 * MIB));
      },
      encoding: "gzip",
      message: "ProbeId or ProbeKey is missing",
    },
    {
      name: "50 MiB of white space, which holds no JSON value to count",
      body: (): Buffer => {
        return zlib.gzipSync(Buffer.alloc(50 * MIB - KIB, " "));
      },
      encoding: "gzip",
      message: "ProbeId or ProbeKey is missing",
    },
    {
      name: "one string of 50 MiB: a single value",
      body: (): Buffer => {
        return zlib.gzipSync(
          Buffer.concat([
            Buffer.from('"'),
            Buffer.alloc(50 * MIB - KIB, "a"),
            Buffer.from('"'),
          ]),
        );
      },
      encoding: "gzip",
      message: "ProbeId or ProbeKey is missing",
    },
    {
      name: "a body nested ten million deep",
      body: (): Buffer => {
        return zlib.gzipSync(
          Buffer.concat([
            Buffer.alloc(10000000, "["),
            Buffer.alloc(10000000, "]"),
          ]),
        );
      },
      encoding: "gzip",
      message: "ProbeId or ProbeKey is missing",
    },
    {
      name: "a probe's key and id at its start, deep nesting after them",
      body: (): Buffer => {
        return zlib.gzipSync(
          Buffer.concat([
            Buffer.from(
              `{"probeKey":"a-wrong-key","probeId":"${PROBE_ONE}","x":`,
            ),
            Buffer.alloc(10000000, "["),
          ]),
        );
      },
      encoding: "gzip",
      message: "Invalid Probe ID or Probe Key",
    },
    {
      name: "a report that opens as a probe's, valid JSON, with a wrong key: 40 MiB",
      body: (): Buffer => {
        return zlib.gzipSync(
          report({
            probeId: PROBE_ONE,
            probeKey: "a-wrong-key",
            points: 310000,
          }),
        );
      },
      encoding: "gzip",
      message: "Invalid Probe ID or Probe Key",
    },
    {
      name: "a report with the key further in than its start",
      body: (): Buffer => {
        return zlib.gzipSync(
          Buffer.from(
            `{"status":"Succeeded","resourceMetrics":${emptyObjects(
              1100000,
            ).toString()},"probeKey":"${PROBES[PROBE_ONE]}","probeId":"${PROBE_ONE}"}`,
          ),
        );
      },
      encoding: "gzip",
      message: "ProbeId or ProbeKey is missing",
    },
    {
      name: "16 million empty objects, deflate",
      body: (): Buffer => {
        return zlib.deflateSync(emptyObjects(16000000));
      },
      encoding: "deflate",
      message: "ProbeId or ProbeKey is missing",
    },
    {
      name: "a deflate bomb: 50 MiB of zeros",
      body: (): Buffer => {
        return zlib.deflateSync(Buffer.alloc(50 * MIB));
      },
      encoding: "deflate",
      message: "ProbeId or ProbeKey is missing",
    },
    {
      name: "24 MiB of empty objects, uncompressed",
      body: (): Buffer => {
        return emptyObjects(7900000);
      },
      encoding: "identity",
      message: "ProbeId or ProbeKey is missing",
    },
    {
      name: "4 MiB of seeded noise, gzip: what compresses poorly arrives in full",
      body: (): Buffer => {
        const noise: Buffer = Buffer.alloc(4 * MIB);

        for (let index: number = 0; index < noise.length; index++) {
          noise[index] = random(256);
        }

        return zlib.gzipSync(noise);
      },
      encoding: "gzip",
      message: "ProbeId or ProbeKey is missing",
    },
  ];

  test.each(
    SHAPES.map((shape: Shape) => {
      return [shape.name, shape];
    }),
  )(
    "%s: refused after its first kilobytes, never counted or parsed, its connection closed",
    async (_name: unknown, shape: unknown) => {
      const { body: build, encoding, message } = shape as Shape;
      const body: Buffer = build();

      for (const path of [VMWARE, OPENSTACK]) {
        watched.inflated = 0;
        watched.counted = 0;

        const answer: Answer = await post({
          path: path,
          body: body,
          gzip: false,
          headers:
            encoding === "identity" ? {} : { "content-encoding": encoding },
        });

        expect({
          path,
          status: answer.status,
          message: answer.body["message"],
        }).toEqual({
          path,
          status: 400,
          message: message,
        });

        // Read a socket read or two of it, inflated a few dozen KB of it.
        expect(answer.bytesRead).toBeLessThanOrEqual(MOST_READ_BEFORE_THE_KEY);
        expect(watched.inflated).toBeLessThanOrEqual(
          MOST_INFLATED_BEFORE_THE_KEY,
        );

        // Not a value counted, nothing parsed, nothing recorded.
        expect(watched.counted).toBe(0);
        expect(parsesOfAtLeast(KIB)).toEqual([]);
        expect(mockRecorded).toEqual([]);

        // Closed, though the client asked to keep it: the rest goes unread.
        expect(answer.connection).toBe("close");
      }

      // Only an opening that names a probe has its key looked up.
      expect(keyChecks()).toHaveLength(
        message === "Invalid Probe ID or Probe Key" ? 2 : 0,
      );
      expect(gzipReads).not.toHaveBeenCalled();
    },
    120000,
  );

  test("with no key at all, is refused as it always was", async () => {
    const answer: Answer = await post({
      path: VMWARE,
      body: zlib.gzipSync(Buffer.from('{"status":"Succeeded"}')),
    });

    expect(answer.status).toBe(400);
    expect(answer.body["message"]).toBe("ProbeId or ProbeKey is missing");
  });

  test("an empty body, gzip announced, is refused as a body without a key is", async () => {
    const answer: Answer = await post({
      path: VMWARE,
      body: Buffer.alloc(0),
    });

    expect(answer.status).toBe(400);
    expect(answer.body["message"]).toBe("ProbeId or ProbeKey is missing");
  });

  test("a Content-Length past 50 MiB is refused before a byte is read", async () => {
    const answer: Answer = await new Promise<Answer>(
      (resolve: (answer: Answer) => void, reject: (err: Error) => void) => {
        const agent: http.Agent = new http.Agent({ keepAlive: true });
        const request: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: running.port,
            path: VMWARE,
            method: "POST",
            agent: agent,
            headers: {
              "content-type": "application/json",
              "content-encoding": "gzip",
              "content-length": String(50 * MIB + 1),
            },
          },
          (response: http.IncomingMessage) => {
            const chunks: Array<Buffer> = [];

            response.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });
            response.on("end", () => {
              agent.destroy();
              resolve({
                status: response.statusCode || 0,
                body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
                retryAfter: undefined,
                connection: response.headers["connection"],
                bytesRead: 0,
              });
            });
          },
        );

        request.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code !== "EPIPE" && err.code !== "ECONNRESET") {
            agent.destroy();
            reject(err);
          }
        });
        request.write(zlib.gzipSync(emptyObjects(1000)));
      },
    );

    expect(answer.status).toBe(413);
    expect(answer.body["type"]).toBe("entity.too.large");
    expect(answer.connection).toBe("close");
    expect(keyChecks()).toEqual([]);
  });
});
