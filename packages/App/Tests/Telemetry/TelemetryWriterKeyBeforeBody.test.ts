/*
 * A FORWARDING POD'S ROWS, READ ONLY ONCE THE CLUSTER KEY IS CHECKED (#10222),
 * over HTTP.
 *
 * /telemetry-writer/insert takes up to 30 MB of ClickHouse rows a request,
 * millions of JSON values, and its caller proves who it is with the cluster
 * key in a header. StartServer used to parse the body before routing, so
 * before the key was looked at: anyone who could reach the route could have
 * the App parse eight million values. StartServer now leaves the body unread
 * (Common/Tests/Server/Utils/RequestBodyLimitOverHttp), and the route reads
 * it after the key check. Here the real router is mounted as the App mounts
 * it, with no body parser before it, the real ClusterKeyAuthorization
 * reading the ONEUPTIME_SECRET it is loaded with:
 *
 *   - no key, a wrong key, a shipped key or a key in the URL: refused with
 *     the body unread, and never parsed;
 *   - the right key: rows of millions of values read, parsed and handed to
 *     the writer, plain or gzip-compressed;
 *   - past 8,000,000 values, even with the right key: refused before
 *     JSON.parse.
 */
import {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  createExpressApp,
} from "Common/Server/Utils/Express";
import {
  restoreClusterKey,
  setClusterKey,
} from "Common/Tests/Server/TestingUtils/ShippedClusterKeys";
import { JSONObject } from "Common/Types/JSON";
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

// Valkey away: wrong cluster keys are compared, not counted.
jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return null;
      },
      isConnected: (): boolean => {
        return false;
      },
    },
  };
});

// The writer's tables, its fan-in and its shed counter: none is reached here.
jest.mock("Common/Server/Services/Index", () => {
  return { __esModule: true, AnalyticsServices: [] };
});

jest.mock("Common/Server/Utils/Telemetry/TelemetryFanInWriter", () => {
  return { __esModule: true, default: { submit: jest.fn() } };
});

jest.mock("Common/Server/Utils/Telemetry/TelemetryWriterShedMetrics", () => {
  return {
    __esModule: true,
    getRecentShedCount: jest.fn(),
    recordShed: jest.fn(),
  };
});

// What the writer was handed: the body, once parsed.
const mockInserted: Array<unknown> = [];

jest.mock("Common/Server/Utils/Telemetry/TelemetryWriterServer", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Telemetry/TelemetryWriterServer",
  );

  return {
    __esModule: true,
    ...actual,
    createTableTargetResolver: (): unknown => {
      return (): null => {
        return null;
      };
    },
    handleWriterInsert: async (body: unknown): Promise<unknown> => {
      mockInserted.push(body);
      return { statusCode: 200, body: { accepted: true } };
    },
  };
});

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const MIB: number = 1024 * 1024;

const CLUSTER_KEY: string = "an operator's (cluster) key: 7c1e5a2d48f6b0e9c3a7";

interface Running {
  server: http.Server;
  port: number;
  keyHeaders: Dictionary<string>;
  gzipReader: AnyModule;
  bodyReader: AnyModule;
}

let running: Running;

beforeAll(async () => {
  setClusterKey(CLUSTER_KEY);

  let writer: AnyModule;
  let keyHeaders: Dictionary<string> = {};
  let gzipReader: AnyModule;
  let bodyReader: AnyModule;

  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    keyHeaders = require("Common/Server/Middleware/ClusterKeyAuthorization")
      .default.getClusterKeyHeaders();
    gzipReader = require("Common/Server/Middleware/GzipRequestBody").default;
    bodyReader = require("Common/Server/Middleware/RequestBodyAfterAuthentication")
      .default;
    writer = require("../../FeatureSet/Telemetry/API/TelemetryWriter").default;
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  });

  const app: ExpressApplication = createExpressApp();

  // As the App mounts it, with no body parser before it.
  app.use("/", writer);

  app.use(
    (
      err: Record<string, unknown>,
      _req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ): void => {
      res.status(Number(err["status"]) || 500).json({
        type: err["type"],
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
    keyHeaders: keyHeaders,
    gzipReader: gzipReader!,
    bodyReader: bodyReader!,
  };
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    running.server.close(() => {
      resolve();
    });
  });

  restoreClusterKey();
});

let jsonParse: ReturnType<typeof jest.spyOn>;
let gzipReads: ReturnType<typeof jest.spyOn>;
let bodyReads: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  mockInserted.length = 0;
  jsonParse?.mockRestore();
  jsonParse = jest.spyOn(JSON, "parse");
  gzipReads?.mockRestore();
  gzipReads = jest.spyOn(running.gzipReader, "parseBody");
  // The reader asks this first of every request it is handed.
  bodyReads?.mockRestore();
  bodyReads = jest.spyOn(running.bodyReader, "isRead");
});

function parsesOfAtLeast(bytes: number): number {
  return jsonParse.mock.calls.filter((call: Array<unknown>): boolean => {
    return typeof call[0] === "string" && call[0].length >= bytes;
  }).length;
}

interface Answer {
  status: number;
  body: JSONObject;
}

function post(data: {
  path?: string;
  body: Buffer;
  headers?: Dictionary<string>;
}): Promise<Answer> {
  return new Promise<Answer>(
    (resolve: (answer: Answer) => void, reject: (err: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: running.port,
          path: data.path || "/telemetry-writer/insert",
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(data.headers || {}),
            "content-length": String(data.body.length),
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            const text: string = Buffer.concat(chunks).toString("utf8");

            resolve({
              status: response.statusCode || 0,
              body: text ? (JSON.parse(text) as JSONObject) : {},
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

// "[{},{},...]": `count` empty objects, three bytes each.
function emptyObjects(count: number): Buffer {
  return Buffer.from(`[${"{},".repeat(count - 1)}{}]`);
}

// A forwarding pod's rows, as TelemetryWriterClient sends them.
function rows(count: number): Buffer {
  return Buffer.from(
    JSON.stringify({
      tableName: "LogItem",
      dedupToken: "token-1",
      rows: Array.from({ length: count }, (_value: unknown, index: number) => {
        return {
          _id: `row-${index}`,
          projectId: "6c7f1e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
          body: "GET /health 200",
          severityNumber: 9,
        };
      }),
    }),
  );
}

describe("a request without the cluster key", () => {
  test.each([
    ["no key", {}, 'Cluster key not found. OneUptime\'s services send it in the "clusterkey" request header.'],
    ["a wrong key", { clusterkey: "not-the-key" }, "Invalid cluster key provided"],
    ["a wrong key, as KEDA sends one", { "x-clusterkey": "not-the-key" }, "Invalid cluster key provided"],
  ])(
    "%s: refused with 23 MiB of eight million objects unread and never parsed",
    async (_what: string, headers: Dictionary<string>, message: string) => {
      const bomb: Buffer = emptyObjects(7900000);

      for (const sent of [
        { body: bomb, headers: headers },
        {
          body: zlib.gzipSync(bomb),
          headers: { ...headers, "content-encoding": "gzip" },
        },
      ]) {
        const answer: Answer = await post(sent);

        expect(answer).toEqual({ status: 400, body: { message: message } });
      }

      expect(bodyReads).not.toHaveBeenCalled();
      expect(gzipReads).not.toHaveBeenCalled();
      expect(parsesOfAtLeast(MIB)).toBe(0);
      expect(mockInserted).toEqual([]);
    },
    120000,
  );

  test("a value this repository ships: refused with the body unread", async () => {
    const answer: Answer = await post({
      body: emptyObjects(7900000),
      headers: { clusterkey: "secret" },
    });

    expect(answer.status).toBe(400);
    expect(String(answer.body["message"])).toContain(
      "a value the OneUptime repository ships",
    );
    expect(bodyReads).not.toHaveBeenCalled();
    expect(parsesOfAtLeast(MIB)).toBe(0);
  }, 120000);

  test("the right key, in the URL: refused with the body unread", async () => {
    const answer: Answer = await post({
      path: `/telemetry-writer/insert?clusterKey=${running.keyHeaders["clusterkey"]}`,
      body: emptyObjects(7900000),
    });

    expect(answer.status).toBe(400);
    expect(String(answer.body["message"])).toContain("never in the URL");
    expect(bodyReads).not.toHaveBeenCalled();
    expect(parsesOfAtLeast(MIB)).toBe(0);
  }, 120000);
});

describe("a request with the cluster key", () => {
  test("has its rows, of millions of values, read and parsed, and handed to the writer", async () => {
    const body: Buffer = rows(220000);

    // More values than a large route reads, in fewer bytes than the client sends at most.
    expect(body.length).toBeLessThan(30000000);

    const answer: Answer = await post({
      body: body,
      headers: running.keyHeaders,
    });

    expect(answer).toEqual({ status: 200, body: { accepted: true } });
    expect(mockInserted).toHaveLength(1);
    expect((mockInserted[0] as JSONObject)["rows"]).toHaveLength(220000);
    expect(parsesOfAtLeast(MIB)).toBe(1);
  }, 120000);

  test("gzip-compressed, the same", async () => {
    const answer: Answer = await post({
      body: zlib.gzipSync(rows(1000)),
      headers: { ...running.keyHeaders, "content-encoding": "gzip" },
    });

    expect(answer).toEqual({ status: 200, body: { accepted: true } });
    expect((mockInserted[0] as JSONObject)["rows"]).toHaveLength(1000);
    expect(gzipReads).toHaveBeenCalledTimes(1);
  });

  test("is still refused past 8,000,000 values, before JSON.parse sees them", async () => {
    const answer: Answer = await post({
      body: zlib.gzipSync(emptyObjects(8100000)),
      headers: { ...running.keyHeaders, "content-encoding": "gzip" },
    });

    expect(answer).toEqual({
      status: 413,
      body: { type: "entity.too.many.values", limit: 8000000 },
    });
    expect(parsesOfAtLeast(MIB)).toBe(0);
    expect(mockInserted).toEqual([]);
  }, 120000);

  test("that is not JSON is refused as body-parser refused it", async () => {
    const answer: Answer = await post({
      body: Buffer.from("{not json"),
      headers: running.keyHeaders,
    });

    expect(answer).toEqual({
      status: 400,
      body: { type: "entity.parse.failed" },
    });
    expect(mockInserted).toEqual([]);
  });
});
