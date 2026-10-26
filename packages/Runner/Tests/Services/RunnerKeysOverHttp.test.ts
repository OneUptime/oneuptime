/*
 * ---------------------------------------------------------------------------
 * A Runner's keys, over real HTTP, with the real request clients and the
 * real logger.
 *
 * A Runner proves itself to OneUptime on every request it sends to
 * ONEUPTIME_URL: with its key in the body (agentKey on the runbook mount,
 * aiAgentKey on the code-fix protocol), with the project's ingestion key in
 * x-oneuptime-token when it is the Kubernetes agent's. No Runner presents
 * the cluster key: the shared Runner that did is gone. So:
 *
 *   - a request that carries one follows a redirect only while it stays on
 *     the server it was sent to - an HTTP client hands every redirect's
 *     headers, and a 307 or 308's body, to wherever it points;
 *   - a request that gets no answer is logged without it.
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

// A Runner's key as the dashboard issues it, and one an operator typed.
const RUNNER_KEY: string = "5f2c1e9a-7b3d-4c8e-9f1a-2b3c4d5e6f70";
const OPERATOR_RUNNER_KEY: string =
  "it's-(runner)-key!*~R7dVk2LmX9pR4tWz8NcB1sHf";
const RUNNER_ID: string = "2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182";
const INGESTION_KEY: string = "8f7e6d5c-4b3a-4291-8a7b-6c5d4e3f2a10";

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
 * otherwise - and for MOVED_PATH - as OneUptime would accept the Runner.
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
        res.end(
          JSON.stringify({
            _id: RUNNER_ID,
            runnerId: RUNNER_ID,
            runnerKey: RUNNER_KEY,
            job: null,
            capabilities: { canRunRunbooks: true },
          }),
        );
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

interface Runner {
  Register: AnyModule;
  AgentClient: AnyModule;
  BackendAPI: AnyModule;
  KubernetesPosture: AnyModule;
  logger: AnyModule;
}

/*
 * "project": a Runner started with its id and key - a project's own, or a
 * global one, which the server alone calls global; "kubernetes-agent": the
 * Kubernetes agent chart's Runner, with the project's ingestion key.
 */
type RunnerMode = "project" | "kubernetes-agent";

// The environment a Runner reads, at start-up and (its key) on every request.
const RUNNER_ENVIRONMENT: Array<string> = [
  "ONEUPTIME_URL",
  "ONEUPTIME_RUNNER_ID",
  "ONEUPTIME_RUNNER_KEY",
  "ONEUPTIME_INGESTION_KEY",
  "ONEUPTIME_KUBERNETES_CLUSTER_NAME",
  "LOG_LEVEL",
];

const savedEnvironment: Record<string, string | undefined> = {};

for (const name of RUNNER_ENVIRONMENT) {
  savedEnvironment[name] = process.env[name];
}

// Puts back the environment this file started with.
function restoreEnvironment(): void {
  for (const name of RUNNER_ENVIRONMENT) {
    if (savedEnvironment[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = savedEnvironment[name];
    }
  }
}

/*
 * A Runner started with this ONEUPTIME_URL, in one of its two modes. Its
 * environment stays set until the test ends: a Runner reads its key on
 * every request it sends.
 */
function startRunner(data: {
  oneuptimeUrl: string;
  mode: RunnerMode;
  runnerKey?: string;
}): Runner {
  for (const name of RUNNER_ENVIRONMENT) {
    delete process.env[name];
  }

  process.env["ONEUPTIME_URL"] = data.oneuptimeUrl;
  process.env["LOG_LEVEL"] = "DEBUG";

  if (data.mode === "project") {
    process.env["ONEUPTIME_RUNNER_ID"] = RUNNER_ID;
    process.env["ONEUPTIME_RUNNER_KEY"] = data.runnerKey || RUNNER_KEY;
  } else {
    process.env["ONEUPTIME_INGESTION_KEY"] = INGESTION_KEY;
    process.env["ONEUPTIME_KUBERNETES_CLUSTER_NAME"] = "prod";
  }

  let started: Runner | null = null;

  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    started = {
      Register: require("../../Services/RegisterRunner").default,
      AgentClient: require("../../Services/RunnerClient").default,
      BackendAPI: require("../../Utils/BackendAPI").default,
      KubernetesPosture: require("../../Utils/KubernetesPosture").default,
      logger: require("Common/Server/Utils/Logger").default,
    };
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  });

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
  restoreEnvironment();
  jest.restoreAllMocks();
});

describe("a request that carries a Runner's key, redirected to another server", () => {
  test("a Runner's registration is not sent on, and neither is the older Runner's check it falls back to", async () => {
    const runner: Runner = startRunner({
      oneuptimeUrl: redirectingAway.origin,
      mode: "project",
    });

    await expect(
      runner.Register.tryRegisterRunner({ maxAttempts: 1 }),
    ).resolves.toBe(false);

    expect(pathsOf(redirectingAway)).toEqual(["/runner-ingest/heartbeat"]);
    expect(
      (JSON.parse(redirectingAway.received[0]!.body) as JSONObject)["agentKey"],
    ).toBe(RUNNER_KEY);
    expect(otherServer.received).toEqual([]);
  });

  test("the Kubernetes agent's Runner's registration is not sent on, with its ingestion key", async () => {
    const runner: Runner = startRunner({
      oneuptimeUrl: redirectingAway.origin,
      mode: "kubernetes-agent",
    });

    /*
     * Its posture asks this host's kubectl for its version first, which can
     * take seconds on a busy machine (KubernetesPosture allows ten) and is
     * not what this suite is about: the registration is.
     */
    jest
      .spyOn(runner.KubernetesPosture, "detectKubectlVersion")
      .mockResolvedValue("v1.36.4");

    await expect(
      runner.Register.tryRegisterRunner({ maxAttempts: 1 }),
    ).resolves.toBe(false);

    expect(pathsOf(redirectingAway)).toEqual([
      "/runner-ingest/register-kubernetes-agent",
    ]);
    expect(redirectingAway.received[0]!.headers["x-oneuptime-token"]).toBe(
      INGESTION_KEY,
    );
    expect(otherServer.received).toEqual([]);
  });

  test.each([
    [
      "a heartbeat",
      "/runner-ingest/heartbeat",
      (runner: Runner): Promise<unknown> => {
        return runner.AgentClient.heartbeat({ agentVersion: "14.0.72" });
      },
    ],
    [
      "a claim for the next runbook step",
      "/runner-ingest/claim-next-job",
      (runner: Runner): Promise<unknown> => {
        return runner.AgentClient.claimNextJob();
      },
    ],
    [
      "a step's result",
      "/runner-ingest/job/7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f/result",
      (runner: Runner): Promise<unknown> => {
        return runner.AgentClient.submitJobResult({
          jobId: "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
          success: true,
          output: "done",
          exitCode: 0,
        });
      },
    ],
    [
      "a sign-off",
      "/runner-ingest/disconnect",
      (runner: Runner): Promise<unknown> => {
        return runner.AgentClient.disconnect();
      },
    ],
    [
      "a code fix's request for an exception",
      "/api/ai-agent-data/get-exception-details",
      (runner: Runner): Promise<unknown> => {
        return new runner.BackendAPI().getExceptionDetails("exception-1");
      },
    ],
    [
      "a code fix's request for a repository token",
      "/api/ai-agent-data/get-repository-token",
      (runner: Runner): Promise<unknown> => {
        return new runner.BackendAPI().getRepositoryToken(
          "repository-1",
          "task-1",
        );
      },
    ],
  ])(
    "%s is not sent on",
    async (
      _label: string,
      path: string,
      call: (runner: Runner) => Promise<unknown>,
    ) => {
      const runner: Runner = startRunner({
        oneuptimeUrl: redirectingAway.origin,
        mode: "project",
      });

      await settled(async () => {
        await call(runner);
      });

      expect(pathsOf(redirectingAway)).toEqual([path]);
      expect(otherServer.received).toEqual([]);
    },
  );
});

describe("a request that carries a Runner's key, redirected on its own server", () => {
  test("a Runner's registration gets there", async () => {
    const runner: Runner = startRunner({
      oneuptimeUrl: redirectingToItself.origin,
      mode: "project",
    });

    await expect(
      runner.Register.tryRegisterRunner({ maxAttempts: 1 }),
    ).resolves.toBe(true);

    expect(pathsOf(redirectingToItself)).toEqual([
      "/runner-ingest/heartbeat",
      `${MOVED_PATH}/runner-ingest/heartbeat`,
    ]);
  });

  test("a heartbeat gets there, key and all", async () => {
    const runner: Runner = startRunner({
      oneuptimeUrl: redirectingToItself.origin,
      mode: "project",
    });

    await expect(
      runner.AgentClient.heartbeat({ agentVersion: "14.0.72" }),
    ).resolves.toMatchObject({ ok: true });

    expect(pathsOf(redirectingToItself)).toEqual([
      "/runner-ingest/heartbeat",
      `${MOVED_PATH}/runner-ingest/heartbeat`,
    ]);
    expect(
      (JSON.parse(redirectingToItself.received[1]!.body) as JSONObject)[
        "agentKey"
      ],
    ).toBe(RUNNER_KEY);
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
  ["the key the dashboard issued", RUNNER_KEY],
  ["a key an operator typed", OPERATOR_RUNNER_KEY],
])(
  "a Runner whose key is %s, whose requests get no answer",
  (_label: string, runnerKey: string) => {
    function expectNoKeyIn(runner: Runner): void {
      const sinks: Record<string, string> = {
        console: printed.join("\n"),
        "recent logs": runner.logger
          .getRecentLogs()
          .map((entry: { message: string }): string => {
            return entry.message;
          })
          .join("\n"),
      };

      for (const [sink, text] of Object.entries(sinks)) {
        expect({ sink, kept: keptRunsOf(text, runnerKey) }).toEqual({
          sink,
          kept: [],
        });
      }
    }

    test("logs its failed registration without its key", async () => {
      const runner: Runner = startRunner({
        oneuptimeUrl: await closedPortOrigin(),
        mode: "project",
        runnerKey: runnerKey,
      });

      await expect(
        runner.Register.tryRegisterRunner({ maxAttempts: 2 }),
      ).resolves.toBe(false);

      expect(printed.join("\n")).toContain("/runner-ingest/heartbeat");
      expectNoKeyIn(runner);
    });

    test("logs a failed claim for the next runbook step without its key, as the poll loop logs it", async () => {
      const runner: Runner = startRunner({
        oneuptimeUrl: await closedPortOrigin(),
        mode: "project",
        runnerKey: runnerKey,
      });

      const failure: unknown = await settled(async () => {
        await runner.AgentClient.claimNextJob();
      });

      expect(failure).not.toBeNull();

      // As PollRunbookWork logs a tick that threw.
      runner.logger.error("Poll tick failed");
      runner.logger.error(failure);

      expect(printed.join("\n")).toContain("claim-next-job");
      expectNoKeyIn(runner);
    });

    test("logs a failed code-fix request without its key", async () => {
      const runner: Runner = startRunner({
        oneuptimeUrl: await closedPortOrigin(),
        mode: "project",
        runnerKey: runnerKey,
      });

      const failure: unknown = await settled(async () => {
        await new runner.BackendAPI().getExceptionDetails("exception-1");
      });

      expect(failure).not.toBeNull();

      // As the code-fix loop logs a task that threw.
      runner.logger.error(failure);

      expect(printed.join("\n")).toContain("get-exception-details");
      expectNoKeyIn(runner);
    });
  },
);
