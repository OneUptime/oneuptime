/*
 * A PROBE'S COLLECTION, AUTHENTICATED BEFORE IT IS PARSED (#10222), over HTTP.
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
 * against a stand-in for Valkey, and JSON.parse is watched:
 *
 *   - a wrong key in the headers is refused before a byte of the body is
 *     read, and counted as a wrong key is from a body;
 *   - a probe that sends its key in the headers has a 40 MiB report read and
 *     parsed whole;
 *   - an older probe, whose key is in its report alone, has it checked from
 *     the start of the report, before the report is parsed, and a large
 *     report still read whole;
 *   - a body whose probe is not known before it is parsed is held to a large
 *     route's 1,000,000 values: 8 million empty objects are refused without
 *     being parsed.
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
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";
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
}

let running: RunningApp;
let redis: FakeCounterRedis;

beforeAll(async () => {
  let vmware: AnyModule;
  let openStack: AnyModule;
  let probeService: AnyModule;
  let gzipReader: AnyModule;

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

    // The real check, watched: when it ran, against JSON.parse.
    const verifyProbeKey: AnyModule =
      probeService.verifyProbeKey.bind(probeService);
    probeService.verifyProbeKey = jest.fn(verifyProbeKey);

    gzipReader = require("Common/Server/Middleware/GzipRequestBody").default;

    vmware =
      require("../../FeatureSet/Telemetry/API/ProbeIngest/VMwareCollection").default;
    openStack =
      require("../../FeatureSet/Telemetry/API/ProbeIngest/OpenStackCollection").default;
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  });

  const app: ExpressApplication = createExpressApp();

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

beforeEach(() => {
  redis = new FakeCounterRedis();
  mockRedisState.client = redis;
  mockRedisState.connected = true;
  mockRecorded.length = 0;
  running.probeService.verifyProbeKey.mockClear();
  running.probeService.findOneBy.mockClear();

  jsonParse?.mockRestore();
  jsonParse = jest.spyOn(JSON, "parse");
  gzipReads?.mockRestore();
  gzipReads = jest.spyOn(running.gzipReader, "parseBody");
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
}

function post(data: {
  path: string;
  body: Buffer;
  from?: string;
  headers?: Dictionary<string>;
  gzip?: boolean;
}): Promise<Answer> {
  return new Promise<Answer>(
    (resolve: (answer: Answer) => void, reject: (err: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: running.port,
          path: data.path,
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(data.gzip === false ? {} : { "content-encoding": "gzip" }),
            ...(data.headers || {}),
            "content-length": String(data.body.length),
            // As the bundled Nginx forwards it: the client's address last.
            "x-forwarded-for": data.from || CLIENT,
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

            resolve({
              status: response.statusCode || 0,
              body: text ? (JSON.parse(text) as JSONObject) : {},
              retryAfter: Array.isArray(retryAfter)
                ? retryAfter[0]
                : retryAfter,
            });
          });
        },
      );

      // A server that answered before reading the body may close under it.
      request.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "EPIPE" && err.code !== "ECONNRESET") {
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

    const answer: Answer = await post({
      path: VMWARE,
      body: largeReportOfProbeOne,
      headers: keyHeaders(PROBE_ONE, PROBES[PROBE_ONE]!),
    });

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ accepted: true });
    expect(mockRecorded).toEqual([{ probeId: PROBE_ONE, resources: 310000 }]);

    // The key was checked once, from the headers, before the report was parsed.
    expect(keyChecks()).toHaveLength(1);
    expect(parsesOfAtLeast(MIB)).toHaveLength(1);
    expect(keyChecks()[0]!).toBeLessThan(parsesOfAtLeast(MIB)[0]!);
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

    expect(gzipReads).toHaveBeenCalledTimes(2);
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
  test("has its key checked from the start of its report, before the report is parsed, and a 40 MiB report read whole", async () => {
    const answer: Answer = await post({
      path: VMWARE,
      body: largeReportOfProbeOne,
    });

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ accepted: true });
    expect(mockRecorded).toEqual([{ probeId: PROBE_ONE, resources: 310000 }]);

    expect(keyChecks()).toHaveLength(1);
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

  test("is refused when that key is wrong, its report never parsed, the wrong key counted", async () => {
    const answer: Answer = await post({
      path: VMWARE,
      body: zlib.gzipSync(
        report({ probeId: PROBE_ONE, probeKey: "an-old-key", points: 120000 }),
      ),
    });

    expect(answer.status).toBe(400);
    expect(answer.body["message"]).toBe("Invalid Probe ID or Probe Key");
    expect(parsesOfAtLeast(MIB)).toEqual([]);
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
});

describe("a body whose probe is not known before it is parsed", () => {
  test("is held to a large route's 1,000,000 values: 8 million empty objects are refused, never parsed", async () => {
    const bomb: Buffer = zlib.gzipSync(emptyObjects(7900000));

    // A few hundred KB on the wire.
    expect(bomb.length).toBeLessThan(MIB);

    for (const path of [VMWARE, OPENSTACK]) {
      const started: number = Date.now();
      const answer: Answer = await post({ path: path, body: bomb });

      expect({
        path,
        status: answer.status,
        limit: answer.body["limit"],
      }).toEqual({ path, status: 413, limit: 1000000 });
      expect(answer.body["type"]).toBe("entity.too.many.values");
      // JSON.parse took 1.4 s and 490 MiB of heap for it.
      expect(Date.now() - started).toBeLessThan(5000);
    }

    expect(parsesOfAtLeast(MIB)).toEqual([]);
    expect(keyChecks()).toEqual([]);
    expect(mockRecorded).toEqual([]);
  }, 120000);

  test("with a probe's key somewhere other than its start, and fewer values than that, is parsed and authenticated from its body, as before", async () => {
    const body: string = JSON.stringify({
      vmwareVCenterId: "44444444-4444-4444-8444-444444444444",
      status: "Failed",
      errorMessage: "Refused.",
      probeKey: PROBES[PROBE_ONE],
      probeId: PROBE_ONE,
    });

    const answer: Answer = await post({
      path: VMWARE,
      body: zlib.gzipSync(Buffer.from(body)),
    });

    expect(answer.status).toBe(200);
    expect(mockRecorded).toEqual([{ probeId: PROBE_ONE, resources: 0 }]);
  });

  test("with more values than that, is refused whatever key it carries further in", async () => {
    const body: string = `{"status":"Succeeded","resourceMetrics":${emptyObjects(
      1100000,
    ).toString()},"probeKey":"${PROBES[PROBE_ONE]}","probeId":"${PROBE_ONE}"}`;

    const answer: Answer = await post({
      path: VMWARE,
      body: zlib.gzipSync(Buffer.from(body)),
    });

    expect(answer.status).toBe(413);
    expect(answer.body["limit"]).toBe(1000000);
    expect(parsesOfAtLeast(MIB)).toEqual([]);
    expect(mockRecorded).toEqual([]);
  }, 60000);

  test("with no key at all, is refused as it always was", async () => {
    const answer: Answer = await post({
      path: VMWARE,
      body: zlib.gzipSync(Buffer.from('{"status":"Succeeded"}')),
    });

    expect(answer.status).toBe(400);
    expect(answer.body["message"]).toBe("ProbeId or ProbeKey is missing");
  });
});
