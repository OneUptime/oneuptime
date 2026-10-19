/*
 * ---------------------------------------------------------------------------
 * The in-cluster Runner's registration, over real HTTP, with the real
 * request client and the real logger.
 *
 * The shared Runner of this release registers (POST /api/ai-agent/register)
 * with its own key, ONEUPTIME_RUNNER_KEY, which the app holds too: it holds
 * no cluster key, and no request it sends carries one.
 *
 * A Runner whose deployment still gives it ONEUPTIME_SECRET (the
 * docker-compose.yml or Helm chart of an earlier release) sends that key as
 * well, so an app that does not hold its key yet still lets it register.
 * The key travels in the clusterkey request header - never in the URL, which
 * proxies, ingresses and access logs keep, and never in the request body -
 * and never reaches the Runner's log, whatever happens to the request: the
 * log is the one place an operator, a support bundle and a log exporter all
 * read. Every OneUptime server reads that header: the routes that take the
 * key have read it since long before the in-cluster Runner existed, so such
 * a Runner registers with a server that is a release behind, as during a
 * rolling upgrade.
 * ---------------------------------------------------------------------------
 */

import { JSONObject } from "Common/Types/JSON";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { AddressInfo } from "net";
import util from "util";

jest.mock("Common/Types/Sleep", () => {
  return {
    __esModule: true,
    default: {
      sleep: async (): Promise<void> => {},
    },
  };
});

type RegisterModule = typeof import("../../Services/RegisterRunner");
type LoggerModule = typeof import("Common/Server/Utils/Logger");

const OPERATOR_KEY: string = "Q7dVk2LmX9pR4tWz8NcB1sHf6JyG3uAe";
const OPERATOR_KEY_WITH_SPECIAL_CHARACTERS: string = "p@ss/w0rd?&=+%#";
// encodeURIComponent leaves ' ( ) ! * ~ as they are.
const OPERATOR_KEY_WITH_UNENCODED_CHARACTERS: string =
  "it's-(my)-key!*~Q7dVk2LmX9pR4tWz8NcB1sHf";

/*
 * Every run of 12 characters of a key (the whole key when it is shorter). A
 * log that holds any of them holds part of the key: redaction that stopped
 * at a character it took for the end of the value would leave the rest of
 * the key in the clear, and the whole key would no longer be found.
 */
function partsOf(key: string): Array<string> {
  const length: number = 12;

  if (key.length <= length) {
    return [key];
  }

  const parts: Set<string> = new Set<string>();

  for (let start: number = 0; start + length <= key.length; start++) {
    parts.add(key.slice(start, start + length));
  }

  return Array.from(parts);
}

interface ReceivedRequest {
  method: string;
  url: string;
  headers: Record<string, string | Array<string> | undefined>;
  body: string;
}

interface FakeServer {
  http: Server;
  origin: string;
  received: Array<ReceivedRequest>;
}

// A OneUptime server that answers every registration with a Runner id.
async function startServer(): Promise<FakeServer> {
  const received: Array<ReceivedRequest> = [];
  const http: Server = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      let body: string = "";

      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });

      req.on("end", () => {
        received.push({
          method: req.method || "",
          url: req.url || "",
          headers: req.headers,
          body: body,
        });

        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            _id: "2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182",
            message: "AI Agent registered successfully",
          }),
        );
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    http.listen(0, "127.0.0.1", resolve);
  });

  return {
    http: http,
    origin: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
    received: received,
  };
}

async function stopServer(server: FakeServer): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    server.http.close(() => {
      resolve();
    });
  });
}

// A port nothing listens on: the registration gets no answer at all.
async function closedPortOrigin(): Promise<string> {
  const http: Server = createServer();

  await new Promise<void>((resolve: () => void) => {
    http.listen(0, "127.0.0.1", resolve);
  });

  const port: number = (http.address() as AddressInfo).port;

  await new Promise<void>((resolve: () => void) => {
    http.close(() => {
      resolve();
    });
  });

  return `http://127.0.0.1:${port}`;
}

interface Runner {
  Register: RegisterModule;
  logger: LoggerModule["default"];
}

// The key the shared Runner registers with, as npm start or the chart makes it.
const RUNNER_KEY: string = "r7Kq2Vx9Lm4Np8Wt3Zc6Hs1Bf5Jd0GyA";

/*
 * A Runner started with this URL and, from a deployment of an earlier
 * release, this ONEUPTIME_SECRET - or, given null, as this release's
 * deployment starts the shared Runner: ONEUPTIME_RUNNER_SHARED=true, and no
 * cluster key.
 */
function loadRunner(clusterKey: string | null, oneuptimeUrl: string): Runner {
  const saved: Record<string, string | undefined> = {
    ONEUPTIME_SECRET: process.env["ONEUPTIME_SECRET"],
    ONEUPTIME_RUNNER_SHARED: process.env["ONEUPTIME_RUNNER_SHARED"],
    ONEUPTIME_RUNNER_KEY: process.env["ONEUPTIME_RUNNER_KEY"],
    ONEUPTIME_URL: process.env["ONEUPTIME_URL"],
    LOG_LEVEL: process.env["LOG_LEVEL"],
  };

  if (clusterKey === null) {
    delete process.env["ONEUPTIME_SECRET"];
    process.env["ONEUPTIME_RUNNER_SHARED"] = "true";
  } else {
    process.env["ONEUPTIME_SECRET"] = clusterKey;
    delete process.env["ONEUPTIME_RUNNER_SHARED"];
  }

  process.env["ONEUPTIME_RUNNER_KEY"] = RUNNER_KEY;
  process.env["ONEUPTIME_URL"] = oneuptimeUrl;
  process.env["LOG_LEVEL"] = "DEBUG";

  let loaded: Runner | null = null;

  try {
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      loaded = {
        Register: require("../../Services/RegisterRunner"),
        logger: require("Common/Server/Utils/Logger").default,
      };
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  return loaded!;
}

// Everything the console printed, as the console would print it.
const printed: Array<string> = [];

beforeEach(() => {
  printed.length = 0;

  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    jest
      .spyOn(console, method)
      .mockImplementation((...args: Array<unknown>): void => {
        printed.push(
          args
            .map((arg: unknown): string => {
              return typeof arg === "string"
                ? arg
                : // The deepest print a console or log shipper could make.
                  util.inspect(arg, { depth: null });
            })
            .join(" "),
        );
      });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the shared Runner of this release", () => {
  test("registers with its own key in the body, and no request header or URL carries a cluster key", async () => {
    const server: FakeServer = await startServer();

    try {
      const runner: Runner = loadRunner(null, server.origin);

      await expect(
        runner.Register.default.tryRegisterRunner({ maxAttempts: 1 }),
      ).resolves.toBe(true);

      expect(server.received).toHaveLength(1);

      const request: ReceivedRequest = server.received[0]!;
      const body: JSONObject = JSON.parse(request.body) as JSONObject;

      expect(request.method).toBe("POST");
      expect(request.url).toBe("/api/ai-agent/register");
      expect(request.headers["clusterkey"]).toBeUndefined();
      expect(request.headers["x-clusterkey"]).toBeUndefined();
      expect(Object.keys(body).sort()).toStrictEqual([
        "aiAgentDescription",
        "aiAgentKey",
        "runnerName",
      ]);
      expect(body["aiAgentKey"]).toBe(RUNNER_KEY);
      expect(request.url).not.toContain(RUNNER_KEY);
    } finally {
      await stopServer(server);
    }
  });

  test("a registration that gets no answer logs no Runner key, however deep the log is read", async () => {
    const runner: Runner = loadRunner(null, await closedPortOrigin());

    await expect(
      runner.Register.default.tryRegisterRunner({ maxAttempts: 2 }),
    ).resolves.toBe(false);

    const recent: string = runner.logger
      .getRecentLogs()
      .map((entry: { message: string }): string => {
        return entry.message;
      })
      .join("\n");

    expect(recent).toContain("Failed to register Runner");

    for (const sink of [recent, printed.join("\n")]) {
      expect(
        partsOf(RUNNER_KEY).filter((part: string): boolean => {
          return sink.includes(part);
        }),
      ).toStrictEqual([]);
    }
  });
});

describe.each([
  ["letters and digits", OPERATOR_KEY],
  ["characters that travel URI-encoded", OPERATOR_KEY_WITH_SPECIAL_CHARACTERS],
  [
    "characters that travel as they are",
    OPERATOR_KEY_WITH_UNENCODED_CHARACTERS,
  ],
])(
  "a Runner whose deployment still gives it an ONEUPTIME_SECRET with %s",
  (_label: string, clusterKey: string) => {
    test("registers with its own key, and that cluster key in the clusterkey header and nowhere else", async () => {
      const server: FakeServer = await startServer();

      try {
        const runner: Runner = loadRunner(clusterKey, server.origin);

        await expect(
          runner.Register.default.tryRegisterRunner({ maxAttempts: 1 }),
        ).resolves.toBe(true);

        expect(server.received).toHaveLength(1);

        const request: ReceivedRequest = server.received[0]!;
        const body: JSONObject = JSON.parse(request.body) as JSONObject;

        expect(request.method).toBe("POST");
        expect(request.url).toBe("/api/ai-agent/register");
        expect(request.headers["clusterkey"]).toBe(
          encodeURIComponent(clusterKey),
        );
        expect(Object.keys(body).sort()).toStrictEqual([
          "aiAgentDescription",
          "aiAgentKey",
          "runnerName",
        ]);
        expect(body["aiAgentKey"]).toBe(RUNNER_KEY);
        expect(request.body).not.toContain(encodeURIComponent(clusterKey));
        expect(request.url).not.toContain(encodeURIComponent(clusterKey));
      } finally {
        await stopServer(server);
      }
    });

    test("a registration that gets no answer logs no cluster key, however deep the log is read", async () => {
      const runner: Runner = loadRunner(clusterKey, await closedPortOrigin());

      await expect(
        runner.Register.default.tryRegisterRunner({ maxAttempts: 2 }),
      ).resolves.toBe(false);

      const recent: string = runner.logger
        .getRecentLogs()
        .map((entry: { message: string }): string => {
          return entry.message;
        })
        .join("\n");

      // The failure itself is logged, with what it was about.
      expect(recent).toContain("Failed to register Runner");
      expect(recent).toContain("/api/ai-agent/register");

      for (const sink of [recent, printed.join("\n")]) {
        for (const form of [encodeURIComponent(clusterKey), clusterKey]) {
          expect(
            partsOf(form).filter((part: string): boolean => {
              return sink.includes(part);
            }),
          ).toStrictEqual([]);
        }
      }
    });
  },
);
