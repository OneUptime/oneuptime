import {
  CapturedLogs,
  captureLogs,
  eventually,
  realSleep,
  recordingSleep,
} from "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import path from "path";
import { AddressInfo } from "net";
import { after, afterEach, before, beforeEach, test } from "node:test";
import ResourceAiAgent, {
  AgentOptions,
  DEFAULT_SHUTDOWN_GRACE_MS,
  DISCONNECT_TIMEOUT_MS,
  DOCKER_DEFAULT_STOP_TIMEOUT_MS,
  FORCE_EXIT_AFTER_MS,
  IDENTITY_RETRY_INITIAL_MS,
  IDENTITY_RETRY_MAX_MS,
} from "../Agent";
import { AgentStatusSnapshot } from "../AgentStatus";
import {
  ExecutorOptions,
  ResourceExecutor,
} from "../Executors/ResourceExecutor";
import { JOB_DIR_PARENT_NAME } from "../Executors/SpawnSandbox";
import UnavailableExecutor from "../Executors/UnavailableExecutor";
import { CANCELLED_REQUEST_SETTLE_MS } from "../IngestClient";
import { API_MISSING_MESSAGE } from "../Registration";
import FakeBinary, { makeTempDir } from "./Helpers/FakeBinary";
import FakeExecutor, {
  FakeExecutorBehaviour,
  fakePolicy,
} from "./Helpers/FakeExecutor";
import FakeOneUptime, {
  RecordedRequest,
  TEST_RESOURCE_ID,
  jobReply,
  testPayload,
} from "./Helpers/FakeOneUptime";
import { ResourceCommandTier } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";

/*
 * The whole agent, as Index.ts runs it: health server, sweep, registration,
 * heartbeat, a command from claim to result (through the real PrepareGuard,
 * with a table policy, and the real sandbox, with a fake docker), and the
 * shutdown order.
 */

let server: FakeOneUptime;
let docker: FakeBinary;
let tmpDir: string;
let logs: CapturedLogs;
const agents: Array<ResourceAiAgent> = [];
let executors: Array<FakeExecutor> = [];

before(async (): Promise<void> => {
  server = new FakeOneUptime();
  await server.start();
  docker = new FakeBinary("docker");
});

after(async (): Promise<void> => {
  await server.stop();
  docker.cleanup();
});

beforeEach((): void => {
  server.reset();
  docker.clearInvocations();
  docker.setBehaviour({ stdout: "web-1\n" });
  tmpDir = makeTempDir("agent-e2e-");
  logs = captureLogs();
  executors = [];
});

afterEach(async (): Promise<void> => {
  for (const agent of agents.splice(0)) {
    await agent.shutdown("test");
  }
  logs.restore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function agentEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: docker.getPath(),
    ONEUPTIME_URL: server.url,
    ONEUPTIME_SERVICE_TOKEN: "ingestion-key-1",
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "docker",
    DOCKER_HOST_NAME: "web-host-1",
    ONEUPTIME_AI_AGENT_POLL_INTERVAL_MS: "1000",
    APP_VERSION: "14.0.8",
    ...overrides,
  };
}

function fakeExecutorFactory(
  behaviour: FakeExecutorBehaviour = {},
): (options: ExecutorOptions) => ResourceExecutor {
  return (options: ExecutorOptions): ResourceExecutor => {
    const executor: FakeExecutor = new FakeExecutor(options, {
      guardPolicy: fakePolicy({
        "docker ps": ResourceCommandTier.Read,
        "docker restart web-1": ResourceCommandTier.SafeWrite,
      }),
      spawnBinary: "docker",
      ...behaviour,
    });
    executors.push(executor);
    return executor;
  };
}

function createAgent(options: Partial<AgentOptions> = {}): ResourceAiAgent {
  const agent: ResourceAiAgent = new ResourceAiAgent({
    env: agentEnv(),
    tmpDir,
    healthPort: 0,
    healthHost: "127.0.0.1",
    sleep: recordingSleep().sleep,
    enableProxy: false,
    createExecutor: fakeExecutorFactory(),
    ...options,
  });
  agents.push(agent);
  return agent;
}

async function statusOf(agent: ResourceAiAgent): Promise<AgentStatusSnapshot> {
  const port: number = (agent.getHealthServer()!.address() as AddressInfo).port;
  const response: Response = await fetch(`http://127.0.0.1:${port}/status`);
  return (await response.json()) as AgentStatusSnapshot;
}

async function readyStatus(agent: ResourceAiAgent): Promise<number> {
  const port: number = (agent.getHealthServer()!.address() as AddressInfo).port;
  return (await fetch(`http://127.0.0.1:${port}/status/ready`)).status;
}

function withoutReportedAt(
  posture: Record<string, unknown>,
): Record<string, unknown> {
  const { reportedAt, ...rest } = posture;
  assert.ok(!Number.isNaN(Date.parse(String(reportedAt))), "reportedAt");
  return rest;
}

test("missing settings: the container stays up and ready, says what is missing, and sends nothing", async () => {
  const agent: ResourceAiAgent = createAgent({
    env: { PATH: docker.getPath() },
  });

  await agent.start();

  assert.strictEqual(await readyStatus(agent), 200);
  const snapshot: AgentStatusSnapshot = await statusOf(agent);
  assert.strictEqual(snapshot.phase, "misconfigured");
  assert.strictEqual(snapshot.registered, false);
  assert.strictEqual(snapshot.configProblems.length, 3);
  assert.strictEqual(logs.messages("error").length, 4);
  assert.match(
    logs.messages("error")[3]!,
    /^The resource AI agent cannot start until the settings above are fixed/,
  );
  // Still cleaned up after a previous life.
  assert.strictEqual(executors[0]!.sweeps, 1);

  await realSleep(100);
  assert.strictEqual(server.requests.length, 0);

  await agent.shutdown("test");
  assert.strictEqual(agent.getHealthServer(), null);
  assert.strictEqual(executors[0]!.removals, 1);
});

test("start to finish: register, heartbeat, run a command, sign off last", async () => {
  server.script("/claim-next-job", jobReply({}));
  const agent: ResourceAiAgent = createAgent();

  await agent.start();

  // Registration: the ingestion key, the resource and the agent's posture.
  const [registration] = await server.waitFor("/register");
  assert.strictEqual(
    registration!.headers["x-oneuptime-token"],
    "ingestion-key-1",
  );
  assert.match(
    String(registration!.headers["user-agent"]),
    /^oneuptime-resource-ai-agent\/14\.0\.8$/,
  );
  const { posture, ...rest } = registration!.body;
  assert.deepStrictEqual(rest, {
    resourceType: "DockerHost",
    resourceIdentifier: "web-host-1",
    agentVersion: "14.0.8",
  });
  assert.deepStrictEqual(
    withoutReportedAt(posture as Record<string, unknown>),
    {
      resourceType: "DockerHost",
      resourceIdentifier: "web-host-1",
      agentVersion: "14.0.8",
      allowWrites: false,
      writeTargets: [],
      protectedTargets: ["oneuptime-docker-ai-agent"],
      toolVersion: "29.4.3",
      reachable: true,
      details: { engine: "docker" },
    },
  );

  // The command runs, and its result comes back.
  const [result] = await server.waitFor("/job/:id/result", 1, 20_000);
  assert.deepStrictEqual(
    {
      success: result!.body["success"],
      exitCode: result!.body["exitCode"],
      output: result!.body["output"],
    },
    { success: true, exitCode: 0, output: "[stdout]\nweb-1\n" },
  );
  assert.deepStrictEqual(docker.getInvocations()[0]!.argv, ["ps"]);
  // The job loop told the executor which resource id the agent registered for.
  assert.strictEqual(
    executors[0]!.prepared[0]!.agentResourceId,
    TEST_RESOURCE_ID,
  );

  const snapshot: AgentStatusSnapshot = await statusOf(agent);
  assert.strictEqual(snapshot.registered, true);
  assert.strictEqual(snapshot.agentId, "agent-1");
  assert.strictEqual(snapshot.resourceType, "DockerHost");
  assert.strictEqual(snapshot.resourceIdentifier, "web-host-1");
  assert.strictEqual(snapshot.resourceId, TEST_RESOURCE_ID);
  assert.strictEqual(snapshot.jobsRun, 1);
  assert.strictEqual(snapshot.reachable, true);

  await agent.shutdown("SIGTERM");

  const last: RecordedRequest = server.requests[server.requests.length - 1]!;
  assert.strictEqual(last.route, "/disconnect");
  assert.deepStrictEqual(last.body, { agentId: "agent-1", agentKey: "key-1" });
  assert.strictEqual(server.requestsTo("/disconnect").length, 1);

  // Nothing is sent after the sign-off.
  const count: number = server.requests.length;
  await realSleep(200);
  assert.strictEqual(server.requests.length, count);
  assert.strictEqual(executors[0]!.removals, 1);
  assert.deepStrictEqual(
    fs.readdirSync(path.join(tmpDir, JOB_DIR_PARENT_NAME)),
    [],
  );
});

test("a command for another host is refused, not run", async () => {
  server.script(
    "/claim-next-job",
    jobReply({ payload: testPayload({ resourceIdentifier: "web-host-2" }) }),
  );
  const agent: ResourceAiAgent = createAgent();

  await agent.start();
  const [result] = await server.waitFor("/job/:id/result", 1, 20_000);

  assert.strictEqual(result!.body["success"], false);
  assert.strictEqual(result!.body["exitCode"], undefined);
  assert.match(
    String(result!.body["errorMessage"]),
    /^Refused by the Docker AI agent: this command is for Docker host "web-host-2"/,
  );
  assert.strictEqual(docker.getInvocations().length, 0);
});

test("heartbeats carry the identity and the same posture as the registration", async () => {
  const agent: ResourceAiAgent = createAgent();

  await agent.start();
  const [registration] = await server.waitFor("/register");
  await eventually((): boolean => {
    return Boolean(agent.getSession()?.getIdentity());
  });

  await agent.getHeartbeat()!.tick();

  const [heartbeat] = server.requestsTo("/heartbeat");
  assert.strictEqual(heartbeat!.body["agentId"], "agent-1");
  assert.strictEqual(heartbeat!.body["agentKey"], "key-1");
  assert.strictEqual(heartbeat!.body["agentVersion"], "14.0.8");
  assert.deepStrictEqual(
    withoutReportedAt(heartbeat!.body["posture"] as Record<string, unknown>),
    withoutReportedAt(registration!.body["posture"] as Record<string, unknown>),
  );
  assert.ok((await statusOf(agent)).lastHeartbeatAt);
  // The probe's answer was reused, not asked for again every time.
  assert.strictEqual(executors[0]!.probes, 1);
});

test("shutdown lets the command in progress finish and report before signing off", async () => {
  docker.setBehaviour({ stdout: "done\n", sleepMs: 600 });
  server.script("/claim-next-job", jobReply({}));
  const agent: ResourceAiAgent = createAgent();

  await agent.start();
  await server.waitFor("/job/:id/heartbeat", 1, 20_000);
  await agent.shutdown("SIGTERM");

  const routes: Array<string> = server.requests.map(
    (request: RecordedRequest): string => {
      return request.route;
    },
  );
  const resultAt: number = routes.indexOf("/job/job-1/result");
  assert.ok(resultAt >= 0, routes.join(","));
  assert.ok(resultAt < routes.indexOf("/disconnect"));
  assert.strictEqual(
    server.requestsTo("/job/:id/result")[0]!.body["success"],
    true,
  );
});

test("an older OneUptime without the API: /status says so and the log says it once", async () => {
  server.setDefault("/register", {
    status: 404,
    raw: "<html>Not Found</html>",
  });
  const agent: ResourceAiAgent = createAgent();

  await agent.start();
  await server.waitFor("/register", 3);

  const snapshot: AgentStatusSnapshot = await statusOf(agent);
  assert.strictEqual(snapshot.apiMissing, true);
  assert.strictEqual(snapshot.registered, false);
  assert.strictEqual(snapshot.phase, "registering");
  assert.strictEqual(snapshot.lastError, API_MISSING_MESSAGE);
  assert.strictEqual(await readyStatus(agent), 200);
  assert.strictEqual(
    logs.messages("error").filter((message: string): boolean => {
      return message === API_MISSING_MESSAGE;
    }).length,
    1,
  );

  await agent.shutdown("test");
  // Never registered: no sign-off to send.
  assert.strictEqual(server.requestsTo("/disconnect").length, 0);
});

test("start-up removes job directories a previous run left behind", async () => {
  const leftover: string = path.join(tmpDir, JOB_DIR_PARENT_NAME, "job-old");
  fs.mkdirSync(path.join(leftover, "home"), { recursive: true });
  fs.writeFileSync(path.join(leftover, "config.json"), "stale");

  const agent: ResourceAiAgent = createAgent();
  await agent.start();

  assert.strictEqual(fs.existsSync(leftover), false);
  assert.strictEqual(executors[0]!.sweeps, 1);
});

test("a resource the agent cannot reach: it still registers (reachable false) and says why", async () => {
  const agent: ResourceAiAgent = createAgent({
    createExecutor: fakeExecutorFactory({
      probe: {
        toolVersion: null,
        reachable: false,
        reachError:
          "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
        details: {},
        protectedTargets: [],
      },
    }),
  });

  await agent.start();
  const [registration] = await server.waitFor("/register");
  const posture: Record<string, unknown> = registration!.body[
    "posture"
  ] as Record<string, unknown>;

  assert.strictEqual(posture["reachable"], false);
  assert.strictEqual(
    posture["reachError"],
    "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
  );
  assert.ok(
    logs.messages("warn").some((message: string): boolean => {
      return message.startsWith(
        "The agent cannot reach this Docker host right now",
      );
    }),
  );
  assert.strictEqual((await statusOf(agent)).reachable, false);
});

test("writes allowed on the agent are reported and logged", async () => {
  const agent: ResourceAiAgent = createAgent({
    env: agentEnv({
      ONEUPTIME_AI_ALLOW_WRITES: "true",
      ONEUPTIME_AI_WRITE_TARGETS: "web-*,api",
      ONEUPTIME_AI_PROTECTED_TARGETS: "traefik",
    }),
  });

  await agent.start();
  const [registration] = await server.waitFor("/register");
  const posture: Record<string, unknown> = registration!.body[
    "posture"
  ] as Record<string, unknown>;

  assert.strictEqual(posture["allowWrites"], true);
  assert.strictEqual(posture["allowWritesSetting"], "true");
  assert.deepStrictEqual(posture["writeTargets"], ["web-*", "api"]);
  assert.deepStrictEqual(posture["protectedTargets"], [
    "traefik",
    "oneuptime-docker-ai-agent",
  ]);
  assert.ok(
    logs.records.some((record: Record<string, unknown>): boolean => {
      return (
        record["message"] === "Docker host access" &&
        record["writes"] === "web-*,api"
      );
    }),
  );
});

test("the collector's default name is warned about at start-up", async () => {
  const agent: ResourceAiAgent = createAgent({
    env: agentEnv({ DOCKER_HOST_NAME: "docker-host" }),
  });

  await agent.start();

  assert.ok(
    logs.messages("warn").some((message: string): boolean => {
      return message.includes('named "docker-host", the collector\'s default');
    }),
  );
  await server.waitFor("/register");
});

test("a Host without HOST_NAME registers under the name its executor reads", async () => {
  const agent: ResourceAiAgent = createAgent({
    env: agentEnv({
      ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "host",
      DOCKER_HOST_NAME: "",
    }),
    createExecutor: fakeExecutorFactory({ resolvedIdentifier: "  node-17  " }),
  });

  await agent.start();
  const [registration] = await server.waitFor("/register");

  assert.strictEqual(registration!.body["resourceType"], "Host");
  assert.strictEqual(registration!.body["resourceIdentifier"], "node-17");
  assert.strictEqual(agent.config.resourceIdentifier, "node-17");
  assert.strictEqual(agent.config.identitySource, "executor");
  // The executor holds the same config object, so it sees the name too.
  assert.strictEqual(
    executors[0]!.options.config.resourceIdentifier,
    "node-17",
  );
  assert.strictEqual((await statusOf(agent)).resourceIdentifier, "node-17");
});

const UNNAMED_HOST_CASES: Array<
  [string, FakeExecutorBehaviour["resolvedIdentifier"]]
> = [
  ["answers with nothing", "   "],
  ["answers null", null],
  [
    "throws",
    (): Promise<string | null> => {
      return Promise.reject(new Error("nsenter: permission denied"));
    },
  ],
  ["answers a name that is too long", "h".repeat(300)],
];

UNNAMED_HOST_CASES.forEach(
  ([name, resolvedIdentifier]: [
    string,
    FakeExecutorBehaviour["resolvedIdentifier"],
  ]): void => {
    test(`a Host without HOST_NAME whose executor ${name} stays misconfigured`, async () => {
      const agent: ResourceAiAgent = createAgent({
        env: agentEnv({
          ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "host",
          DOCKER_HOST_NAME: "",
        }),
        createExecutor: fakeExecutorFactory({ resolvedIdentifier }),
      });

      await agent.start();

      const snapshot: AgentStatusSnapshot = await statusOf(agent);
      assert.strictEqual(snapshot.phase, "misconfigured");
      assert.strictEqual(snapshot.configProblems.length, 1);
      assert.match(snapshot.configProblems[0]!, /HOST_NAME/);
      await realSleep(50);
      assert.strictEqual(server.requests.length, 0);
    });
  },
);

test("a Host whose executor cannot read its name at boot asks again, backing off, and starts once it can", async () => {
  const waits: ReturnType<typeof recordingSleep> = recordingSleep();
  let asked: number = 0;
  const agent: ResourceAiAgent = createAgent({
    env: agentEnv({
      ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "host",
      DOCKER_HOST_NAME: "",
    }),
    sleep: waits.sleep,
    createExecutor: fakeExecutorFactory({
      resolvedIdentifier: (): Promise<string | null> => {
        asked++;

        if (asked === 1) {
          return Promise.resolve(null);
        }

        if (asked === 2) {
          return Promise.reject(new Error("nsenter: timed out"));
        }

        return Promise.resolve("node-17");
      },
    }),
  });

  await agent.start();

  // The first answer failed: misconfigured, saying it will ask again.
  const before: AgentStatusSnapshot = await statusOf(agent);
  assert.strictEqual(before.phase, "misconfigured");
  assert.match(before.configProblems[0]!, /It asks again/);

  const [registration] = await server.waitFor("/register");

  assert.strictEqual(asked, 3);
  assert.strictEqual(registration!.body["resourceIdentifier"], "node-17");
  assert.strictEqual(agent.config.resourceIdentifier, "node-17");
  assert.deepStrictEqual(waits.delays.slice(0, 2), [
    IDENTITY_RETRY_INITIAL_MS,
    IDENTITY_RETRY_INITIAL_MS * 2,
  ]);
  const after: AgentStatusSnapshot = await statusOf(agent);
  assert.notStrictEqual(after.phase, "misconfigured");
  assert.deepStrictEqual(after.configProblems, []);
});

test("the waits between asks double up to a ceiling, and shutdown stops the asking", async () => {
  const waits: ReturnType<typeof recordingSleep> = recordingSleep();
  let asked: number = 0;
  const agent: ResourceAiAgent = createAgent({
    env: agentEnv({
      ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "host",
      DOCKER_HOST_NAME: "",
    }),
    sleep: waits.sleep,
    createExecutor: fakeExecutorFactory({
      resolvedIdentifier: (): Promise<string | null> => {
        asked++;
        return Promise.resolve(null);
      },
    }),
  });

  await agent.start();
  await eventually(
    (): boolean => {
      return asked >= 12;
    },
    5_000,
    "twelve asks",
  );

  assert.strictEqual(waits.delays[0], IDENTITY_RETRY_INITIAL_MS);
  assert.ok(
    waits.delays.every((ms: number): boolean => {
      return ms <= IDENTITY_RETRY_MAX_MS;
    }),
  );
  assert.ok(waits.delays.includes(IDENTITY_RETRY_MAX_MS));

  await agent.shutdown("test");
  const stoppedAt: number = asked;
  await realSleep(30);

  assert.strictEqual(asked, stoppedAt);
  assert.strictEqual(server.requests.length, 0);
});

test("a name that is too long is not asked for again: it will not change", async () => {
  let asked: number = 0;
  const agent: ResourceAiAgent = createAgent({
    env: agentEnv({
      ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "host",
      DOCKER_HOST_NAME: "",
    }),
    createExecutor: fakeExecutorFactory({
      resolvedIdentifier: (): Promise<string | null> => {
        asked++;
        return Promise.resolve("h".repeat(300));
      },
    }),
  });

  await agent.start();
  await realSleep(30);

  assert.strictEqual(asked, 1);
  assert.strictEqual((await statusOf(agent)).phase, "misconfigured");
});

test("a Host without HOST_NAME and an executor that cannot name it stays misconfigured", async () => {
  const agent: ResourceAiAgent = createAgent({
    env: agentEnv({
      ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "host",
      DOCKER_HOST_NAME: "",
    }),
    /*
     * An executor without resolveResourceIdentifier, never the real
     * HostExecutor: that one's answer depends on the machine running the
     * test (as root on Linux it can read a hostname).
     */
    createExecutor: fakeExecutorFactory(),
  });

  await agent.start();

  assert.strictEqual(executors.length, 1);
  assert.strictEqual(executors[0]!.resolveResourceIdentifier, undefined);
  const snapshot: AgentStatusSnapshot = await statusOf(agent);
  assert.strictEqual(snapshot.phase, "misconfigured");
  assert.match(
    snapshot.configProblems[0]!,
    /^HOST_NAME is not set, and the agent could not read this Host's name itself/,
  );
});

test("an executor that runs nothing: the agent still registers, reporting the resource unreachable and why", async () => {
  const agent: ResourceAiAgent = new ResourceAiAgent({
    env: agentEnv(),
    tmpDir,
    healthPort: 0,
    healthHost: "127.0.0.1",
    sleep: recordingSleep().sleep,
    enableProxy: false,
    // Never touch a real Docker socket from a test.
    createExecutor: (options: ExecutorOptions): ResourceExecutor => {
      return new UnavailableExecutor(options);
    },
  });
  agents.push(agent);

  await agent.start();
  const [registration] = await server.waitFor("/register");
  const posture: Record<string, unknown> = registration!.body[
    "posture"
  ] as Record<string, unknown>;

  assert.strictEqual(posture["reachable"], false);
  assert.strictEqual(
    posture["reachError"],
    "The Docker AI agent executor is not available in this build.",
  );
  assert.strictEqual(agent.getDisplayName(), "Docker AI agent");
});

test("shutdown is idempotent", async () => {
  const agent: ResourceAiAgent = createAgent();
  await agent.start();
  await server.waitFor("/register");

  await Promise.all([agent.shutdown("a"), agent.shutdown("b")]);
  await agent.shutdown("c");

  assert.strictEqual(server.requestsTo("/disconnect").length, 1);
});

test("shutdown before start does nothing but succeed", async () => {
  const agent: ResourceAiAgent = createAgent();

  await agent.shutdown("early");

  assert.strictEqual(server.requests.length, 0);
});

/*
 * Shutdown order: a heartbeat still on the wire could land after the
 * sign-off, flip the agent back to connected and lock the replacement
 * container out for minutes; an unbounded wait could run past the forced
 * exit.
 */
test("shutdown stops heartbeating and registering at once, while the command in progress still finishes", async () => {
  docker.setBehaviour({ stdout: "done\n", sleepMs: 1_500 });
  server.script("/claim-next-job", jobReply({}));
  const agent: ResourceAiAgent = createAgent();

  await agent.start();
  await server.waitFor("/job/:id/heartbeat", 1, 20_000);
  const heartbeatsBefore: number = server.requestsTo("/heartbeat").length;

  const stopping: Promise<void> = agent.shutdown("SIGTERM");

  // The command is still running, and yet nothing else will be sent.
  assert.strictEqual(server.requestsTo("/job/:id/result").length, 0);
  assert.strictEqual(agent.getSession()!.isStopped(), true);
  await agent.getHeartbeat()!.tick();
  assert.strictEqual(server.requestsTo("/heartbeat").length, heartbeatsBefore);

  await stopping;
  const routes: Array<string> = server.requests.map(
    (request: RecordedRequest): string => {
      return request.route;
    },
  );
  assert.ok(
    routes.indexOf("/job/job-1/result") < routes.indexOf("/disconnect"),
    routes.join(","),
  );
  assert.strictEqual(server.requestsTo("/heartbeat").length, heartbeatsBefore);
});

test("a heartbeat on the wire at shutdown is answered before the sign-off", async () => {
  server.setDefault("/heartbeat", { delayMs: 400, json: { status: "ok" } });
  const agent: ResourceAiAgent = createAgent();

  await agent.start();
  await eventually((): boolean => {
    return Boolean(agent.getSession()?.getIdentity());
  });
  void agent.getHeartbeat()!.tick();
  const [heartbeat] = await server.waitFor("/heartbeat");

  await agent.shutdown("SIGTERM");

  const [disconnect] = server.requestsTo("/disconnect");
  assert.ok(disconnect, "signed off");
  assert.ok(agent.status.lastHeartbeatAt, "the heartbeat was answered first");
  assert.ok(
    disconnect.receivedAt - heartbeat!.receivedAt >= 350,
    `the sign-off came ${disconnect.receivedAt - heartbeat!.receivedAt}ms after the heartbeat`,
  );
  assert.ok(
    !logs.messages("warn").some((message: string): boolean => {
      return message.startsWith("OneUptime had not answered");
    }),
  );
});

test("a heartbeat OneUptime never answers is cancelled after the grace, and the sign-off still goes out", async () => {
  server.setDefault("/heartbeat", { hang: true });
  const agent: ResourceAiAgent = createAgent({ shutdownGraceMs: 200 });

  await agent.start();
  await eventually((): boolean => {
    return Boolean(agent.getSession()?.getIdentity());
  });
  void agent.getHeartbeat()!.tick();
  await server.waitFor("/heartbeat");

  const started: number = Date.now();
  await agent.shutdown("SIGTERM");

  assert.ok(Date.now() - started < 5_000, "not the 30s request timeout");
  assert.strictEqual(server.requestsTo("/disconnect").length, 1);
  assert.ok(
    logs.messages("warn").some((message: string): boolean => {
      return message.startsWith(
        "OneUptime had not answered the agent's last call at shutdown",
      );
    }),
    logs.messages("warn").join("\n"),
  );
});

test("a registration on the wire at shutdown is answered first, and the key it returns signs off", async () => {
  server.script("/register", {
    delayMs: 400,
    json: { agentId: "agent-7", agentKey: "key-7", resourceId: "r-7" },
  });
  const agent: ResourceAiAgent = createAgent();

  await agent.start();
  const [registration] = await server.waitFor("/register");
  await agent.shutdown("SIGTERM");

  const [disconnect] = server.requestsTo("/disconnect");
  assert.ok(disconnect, "signed off");
  assert.deepStrictEqual(disconnect.body, {
    agentId: "agent-7",
    agentKey: "key-7",
  });
  assert.ok(disconnect.receivedAt - registration!.receivedAt >= 350);
});

test("a registration OneUptime never answers is cancelled after the grace; nothing to sign off", async () => {
  server.setDefault("/register", { hang: true });
  const agent: ResourceAiAgent = createAgent({ shutdownGraceMs: 200 });

  await agent.start();
  await server.waitFor("/register");
  const started: number = Date.now();
  await agent.shutdown("SIGTERM");

  assert.ok(Date.now() - started < 5_000, "not the 30s request timeout");
  // No identity was ever issued, so there is nothing to sign off.
  assert.strictEqual(server.requestsTo("/disconnect").length, 0);
  assert.strictEqual(server.requestsTo("/register").length, 1);
});

test("the shutdown budget: grace, a cancelled call and the sign-off all fit before the forced exit, inside Docker's default stop timeout", () => {
  assert.ok(
    DEFAULT_SHUTDOWN_GRACE_MS +
      CANCELLED_REQUEST_SETTLE_MS +
      DISCONNECT_TIMEOUT_MS <
      FORCE_EXIT_AFTER_MS,
  );
  assert.strictEqual(DOCKER_DEFAULT_STOP_TIMEOUT_MS, 10_000);
  assert.ok(FORCE_EXIT_AFTER_MS < DOCKER_DEFAULT_STOP_TIMEOUT_MS);
});
