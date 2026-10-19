/*
 * ---------------------------------------------------------------------------
 * A probe's keys, over real HTTP, with the real request client and the real
 * logger.
 *
 * A probe proves itself to OneUptime with its key (probeKey, from PROBE_KEY)
 * in the body of every request it sends to ONEUPTIME_URL, and a global probe
 * registers with the installation's registration key (registerProbeKey,
 * from REGISTER_PROBE_KEY). So:
 *
 *   - a request that carries them follows a redirect only while it stays on
 *     the server it was sent to - an HTTP client hands a 307 or 308's body,
 *     and every redirect's headers, to wherever it points;
 *   - a request that gets no answer is logged without them: probes print
 *     their logs for whoever is helping, and a probe that cannot reach
 *     OneUptime is exactly when that happens.
 * ---------------------------------------------------------------------------
 */

import { JSONObject } from "Common/Types/JSON";
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
import {
  ClientRequest,
  createServer,
  IncomingMessage,
  request,
  Server,
  ServerResponse,
} from "http";
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

interface CapturedCronJob {
  jobName: string;
  runFunction: () => Promise<void>;
}

/*
 * The probe's jobs as BasicCron is handed them, so a test runs the very
 * function the schedule would, with no scheduler.
 */
const mockCapturedCronJobs: Array<CapturedCronJob> = [];

jest.mock("Common/Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (job: CapturedCronJob): void => {
      mockCapturedCronJobs.push(job);
    },
  };
});

// A probe's key as the dashboard issues it, and keys an operator typed.
const PROBE_KEY: string = "0b1c2d3e-4f50-4a61-8b72-9c83d4e5f601";
const OPERATOR_PROBE_KEY: string = "pr0be-(key)!*~Zq9Lm2Xv8Nc4Bt6Hj1Kp";
const REGISTER_PROBE_KEY: string = "global-probes-(registration)!~3Xc9Vb2Nm8";
const PROBE_ID: string = "11111111-2222-4333-8444-555555555555";

// Where a server that redirects to itself sends every request.
const MOVED_PATH: string = "/moved";

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Received {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

interface TestServer {
  http: Server;
  origin: string;
  received: Array<Received>;
}

/*
 * A server that keeps what it is sent. It answers with a 307 to
 * `redirectTo(itself)` + MOVED_PATH + the path when it is given one, and
 * otherwise - and for MOVED_PATH - as OneUptime's probe ingest does.
 */
async function startServer(
  redirectTo?: (self: string) => string,
): Promise<TestServer> {
  const received: Array<Received> = [];
  let origin: string = "";

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

        if (redirectTo && !(req.url || "").startsWith(MOVED_PATH)) {
          res.writeHead(307, {
            location: `${redirectTo(origin)}${MOVED_PATH}${req.url || ""}`,
          });
          res.end();
          return;
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ _id: PROBE_ID, message: "ok" }));
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    http.listen(0, "127.0.0.1", resolve);
  });

  origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  return { http: http, origin: origin, received: received };
}

async function stopServer(server: TestServer): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    server.http.close(() => {
      resolve();
    });
  });
}

// An address nothing listens on: every request gets no answer at all.
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

interface Probe {
  Register: AnyModule;
  checkAliveAndReport: () => Promise<void>;
  // One monitoring worker: fetches the monitors to check, then checks them.
  FetchListAndProbe: AnyModule;
  // Schedules the job that fetches and runs the monitor tests people start.
  initMonitorTestJob: () => void;
  LocalCache: AnyModule;
  logger: AnyModule;
}

/*
 * A probe started with this ONEUPTIME_URL and key: a global probe when it
 * is given the registration key, otherwise one the dashboard created.
 */
function startProbe(data: {
  oneuptimeUrl: string;
  probeKey: string;
  registerProbeKey?: string;
  // The proxy the probe sends its requests through (HTTP_PROXY_URL).
  httpProxyUrl?: string;
}): Probe {
  const saved: Record<string, string | undefined> = {
    ONEUPTIME_URL: process.env["ONEUPTIME_URL"],
    PROBE_KEY: process.env["PROBE_KEY"],
    PROBE_ID: process.env["PROBE_ID"],
    REGISTER_PROBE_KEY: process.env["REGISTER_PROBE_KEY"],
    LOG_LEVEL: process.env["LOG_LEVEL"],
    HTTP_PROXY_URL: process.env["HTTP_PROXY_URL"],
  };

  process.env["ONEUPTIME_URL"] = data.oneuptimeUrl;
  process.env["PROBE_KEY"] = data.probeKey;
  process.env["LOG_LEVEL"] = "DEBUG";

  if (data.httpProxyUrl) {
    process.env["HTTP_PROXY_URL"] = data.httpProxyUrl;
  } else {
    delete process.env["HTTP_PROXY_URL"];
  }

  if (data.registerProbeKey) {
    process.env["REGISTER_PROBE_KEY"] = data.registerProbeKey;
    delete process.env["PROBE_ID"];
  } else {
    delete process.env["REGISTER_PROBE_KEY"];
    process.env["PROBE_ID"] = PROBE_ID;
  }

  let started: Probe | null = null;

  try {
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      started = {
        Register: require("../../Services/Register").default,
        checkAliveAndReport: require("../../Jobs/Alive").checkAliveAndReport,
        FetchListAndProbe: require("../../Jobs/Monitor/FetchList")
          .FetchListAndProbe,
        initMonitorTestJob: require("../../Jobs/Monitor/FetchMonitorTest")
          .default,
        LocalCache: require("Common/Server/Infrastructure/LocalCache").default,
        logger: require("Common/Server/Utils/Logger").default,
      };

      // As the probe sets its proxy up when it starts.
      require("../../Utils/ProxyConfig").default.configure();
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

  return started!;
}

// Runs a call and keeps what it threw.
async function settled(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
    return null;
  } catch (error) {
    return error;
  }
}

function pathsOf(server: TestServer): Array<string> {
  return server.received.map((request: Received): string => {
    return request.url;
  });
}

let otherServer: TestServer;
// Answers every request with a redirect to the other server.
let redirectingAway: TestServer;
// Answers every request with a redirect to another path of its own.
let redirectingToItself: TestServer;

beforeAll(async () => {
  otherServer = await startServer();
  redirectingAway = await startServer(() => {
    return otherServer.origin;
  });
  redirectingToItself = await startServer((self: string) => {
    return self;
  });
});

afterAll(async () => {
  await stopServer(otherServer);
  await stopServer(redirectingAway);
  await stopServer(redirectingToItself);
});

// Everything the console printed, as deep as a console or log shipper would.
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
                : util.inspect(arg, { depth: null });
            })
            .join(" "),
        );
      });
  }
});

afterEach(() => {
  otherServer.received.length = 0;
  redirectingAway.received.length = 0;
  redirectingToItself.received.length = 0;
  jest.restoreAllMocks();
});

describe("a request that carries a probe's keys, redirected to another server", () => {
  test("a global probe's registration is not sent on: its keys reach their own server and no other", async () => {
    const probe: Probe = startProbe({
      oneuptimeUrl: redirectingAway.origin,
      probeKey: PROBE_KEY,
      registerProbeKey: REGISTER_PROBE_KEY,
    });

    const failure: unknown = await settled(async () => {
      await probe.Register._registerProbe();
    });

    expect(failure).not.toBeNull();
    expect(pathsOf(redirectingAway)).toEqual(["/probe-ingest/register"]);

    const sent: JSONObject = JSON.parse(redirectingAway.received[0]!.body);
    expect(sent["probeKey"]).toBe(PROBE_KEY);
    expect(sent["registerProbeKey"]).toBe(REGISTER_PROBE_KEY);

    expect(otherServer.received).toEqual([]);
  });

  test("a probe's check that its key is valid is not sent on", async () => {
    const probe: Probe = startProbe({
      oneuptimeUrl: redirectingAway.origin,
      probeKey: PROBE_KEY,
    });

    await settled(async () => {
      await probe.Register._registerProbe();
    });

    expect(pathsOf(redirectingAway)).toEqual(["/probe-ingest/alive"]);
    expect(otherServer.received).toEqual([]);
  });

  test("a registered probe's heartbeat is not sent on", async () => {
    const probe: Probe = startProbe({
      oneuptimeUrl: redirectingAway.origin,
      probeKey: PROBE_KEY,
    });

    probe.LocalCache.setString("PROBE", "PROBE_ID", PROBE_ID);

    const failure: unknown = await settled(async () => {
      await probe.checkAliveAndReport();
    });

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(otherServer.origin);
    expect(pathsOf(redirectingAway)).toEqual(["/probe-ingest/alive"]);
    expect(otherServer.received).toEqual([]);
  });
});

/*
 * A forward proxy, as a probe may be told to send its requests through
 * (HTTP_PROXY_URL): it is asked for an address, forwards the request there
 * and hands back the answer, a redirect included. It forwards only to the
 * servers it is given, and keeps every address it is asked for.
 */
interface ForwardProxy {
  http: Server;
  origin: string;
  askedFor: Array<string>;
}

async function startForwardProxy(
  servers: Array<TestServer>,
): Promise<ForwardProxy> {
  const askedFor: Array<string> = [];

  const http: Server = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      askedFor.push(req.url || "");

      const target: TestServer | undefined = servers.find(
        (candidate: TestServer): boolean => {
          return (req.url || "").startsWith(`${candidate.origin}/`);
        },
      );

      if (!target) {
        res.writeHead(502);
        res.end();
        return;
      }

      const forwarded: ClientRequest = request(
        {
          hostname: "127.0.0.1",
          port: (target.http.address() as AddressInfo).port,
          path: (req.url || "").slice(target.origin.length),
          method: req.method,
          headers: req.headers,
        },
        (answer: IncomingMessage) => {
          res.writeHead(answer.statusCode || 502, answer.headers);
          answer.pipe(res);
        },
      );

      forwarded.on("error", () => {
        res.writeHead(502);
        res.end();
      });

      req.pipe(forwarded);
    },
  );

  await new Promise<void>((resolve: () => void) => {
    http.listen(0, "127.0.0.1", resolve);
  });

  return {
    http: http,
    origin: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
    askedFor: askedFor,
  };
}

describe("a request that carries a probe's keys, through the probe's proxy", () => {
  let proxy: ForwardProxy;

  beforeAll(async () => {
    proxy = await startForwardProxy([
      otherServer,
      redirectingAway,
      redirectingToItself,
    ]);
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      proxy.http.close(() => {
        resolve();
      });
    });
  });

  afterEach(() => {
    proxy.askedFor.length = 0;
  });

  test("a global probe's registration redirected to another server is not sent on, and the proxy is never asked for it", async () => {
    const probe: Probe = startProbe({
      oneuptimeUrl: redirectingAway.origin,
      probeKey: PROBE_KEY,
      registerProbeKey: REGISTER_PROBE_KEY,
      httpProxyUrl: proxy.origin,
    });

    const failure: unknown = await settled(async () => {
      await probe.Register._registerProbe();
    });

    expect(failure).not.toBeNull();
    expect(proxy.askedFor).toEqual([
      `${redirectingAway.origin}/probe-ingest/register`,
    ]);
    expect(pathsOf(redirectingAway)).toEqual(["/probe-ingest/register"]);
    expect(otherServer.received).toEqual([]);
  });
});

describe("a request that carries a probe's keys, redirected on its own server", () => {
  test("a global probe's registration gets there, keys and all", async () => {
    const probe: Probe = startProbe({
      oneuptimeUrl: redirectingToItself.origin,
      probeKey: PROBE_KEY,
      registerProbeKey: REGISTER_PROBE_KEY,
    });

    await probe.Register._registerProbe();

    expect(pathsOf(redirectingToItself)).toEqual([
      "/probe-ingest/register",
      `${MOVED_PATH}/probe-ingest/register`,
    ]);
    expect(JSON.parse(redirectingToItself.received[1]!.body)["probeKey"]).toBe(
      PROBE_KEY,
    );
    expect(probe.LocalCache.getString("PROBE", "PROBE_ID")).toBe(PROBE_ID);
  });

  test("a registered probe's heartbeat gets there", async () => {
    const probe: Probe = startProbe({
      oneuptimeUrl: redirectingToItself.origin,
      probeKey: PROBE_KEY,
    });

    probe.LocalCache.setString("PROBE", "PROBE_ID", PROBE_ID);

    await probe.checkAliveAndReport();

    expect(pathsOf(redirectingToItself)).toEqual([
      "/probe-ingest/alive",
      `${MOVED_PATH}/probe-ingest/alive`,
    ]);
    expect(otherServer.received).toEqual([]);
  });
});

/*
 * Every run of 12 characters of a key that a text holds. Redaction that
 * stopped at a character it took for the end of the value would leave the
 * rest in the clear, and the whole key would no longer be found.
 */
function keptRunsOf(text: string, key: string): Array<string> {
  const kept: Set<string> = new Set<string>();

  for (let start: number = 0; start + 12 <= key.length; start++) {
    if (text.includes(key.slice(start, start + 12))) {
      kept.add(key.slice(start, start + 12));
    }
  }

  return Array.from(kept);
}

describe.each([
  ["the key the dashboard issued", PROBE_KEY],
  ["a key an operator typed", OPERATOR_PROBE_KEY],
])(
  "a probe whose key is %s, whose requests get no answer",
  (_label: string, probeKey: string) => {
    function expectNoKeyIn(probe: Probe): void {
      const sinks: Record<string, string> = {
        console: printed.join("\n"),
        "recent logs": probe.logger
          .getRecentLogs()
          .map((entry: { message: string }): string => {
            return entry.message;
          })
          .join("\n"),
      };

      for (const [sink, text] of Object.entries(sinks)) {
        for (const key of [probeKey, REGISTER_PROBE_KEY]) {
          expect({ sink, kept: keptRunsOf(text, key) }).toEqual({
            sink,
            kept: [],
          });
        }
      }
    }

    test("logs a global probe's failed registration without its keys", async () => {
      const probe: Probe = startProbe({
        oneuptimeUrl: await closedPortOrigin(),
        probeKey: probeKey,
        registerProbeKey: REGISTER_PROBE_KEY,
      });

      await expect(probe.Register.registerProbe()).rejects.toThrow(
        "Unable to register probe",
      );

      // The failure is logged, with where the request went.
      expect(printed.join("\n")).toContain("Failed to register probe");
      expect(printed.join("\n")).toContain("/probe-ingest/register");
      expectNoKeyIn(probe);
    });

    test("logs a failed heartbeat without its key, as the probe's job runner logs it", async () => {
      const probe: Probe = startProbe({
        oneuptimeUrl: await closedPortOrigin(),
        probeKey: probeKey,
      });

      probe.LocalCache.setString("PROBE", "PROBE_ID", PROBE_ID);

      const failure: unknown = await settled(async () => {
        await probe.checkAliveAndReport();
      });

      expect(failure).not.toBeNull();

      // As BasicCron logs a job that threw.
      probe.logger.error(failure);

      expect(printed.join("\n")).toContain("/probe-ingest/alive");
      expectNoKeyIn(probe);
    });

    /*
     * The monitoring workers and the monitor-test job log a failed fetch
     * twice: the error, and the request it was making as JSON text - in
     * which the body the client sent is a JSON string of its own, its
     * quotes escaped.
     */
    test("logs a failed fetch of the monitors to check without its key, as a monitoring worker logs it", async () => {
      const probe: Probe = startProbe({
        oneuptimeUrl: await closedPortOrigin(),
        probeKey: probeKey,
      });

      probe.LocalCache.setString("PROBE", "PROBE_ID", PROBE_ID);

      await new probe.FetchListAndProbe("Worker 1").run();

      expect(printed.join("\n")).toContain("Error in fetching monitor list");
      expect(printed.join("\n")).toContain("/probe-ingest/monitor/list");
      // The request as JSON text, its body escaped inside it.
      expect(printed.join("\n")).toContain('\\"probeKey\\":\\"');
      expectNoKeyIn(probe);
    });

    test("logs a failed fetch of the monitor tests to run without its key, as the monitor-test job logs it", async () => {
      const probe: Probe = startProbe({
        oneuptimeUrl: await closedPortOrigin(),
        probeKey: probeKey,
      });

      probe.LocalCache.setString("PROBE", "PROBE_ID", PROBE_ID);

      mockCapturedCronJobs.length = 0;
      probe.initMonitorTestJob();

      const job: CapturedCronJob | undefined = mockCapturedCronJobs.find(
        (captured: CapturedCronJob): boolean => {
          return captured.jobName === "Probe:MonitorTest";
        },
      );

      expect(job).toBeDefined();

      await job!.runFunction();

      expect(printed.join("\n")).toContain("API Exception Error");
      expect(printed.join("\n")).toContain("/probe-ingest/monitor-test/list");
      expect(printed.join("\n")).toContain('\\"probeKey\\":\\"');
      expectNoKeyIn(probe);
    });
  },
);
