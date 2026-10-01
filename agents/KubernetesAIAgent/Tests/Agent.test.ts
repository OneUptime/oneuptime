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
import KubernetesAiAgent, {
  AgentOptions,
  DEFAULT_SHUTDOWN_GRACE_MS,
  DISCONNECT_TIMEOUT_MS,
  FORCE_EXIT_AFTER_MS,
} from "../Agent";
import { AgentStatusSnapshot } from "../AgentStatus";
import { CANCELLED_REQUEST_SETTLE_MS } from "../IngestClient";
import { API_MISSING_MESSAGE } from "../Registration";
import FakeKubectl, {
  FakeKubectlInvocation,
  FakeServiceAccount,
  makeTempDir,
} from "./Helpers/FakeKubectl";
import FakeOneUptime, {
  RecordedRequest,
  jobReply,
} from "./Helpers/FakeOneUptime";

/*
 * The whole agent, as Index.ts runs it: health server, sweep, registration,
 * heartbeat, a kubectl job from claim to result, and the shutdown order.
 */

let server: FakeOneUptime;
let kubectl: FakeKubectl;
let serviceAccount: FakeServiceAccount;
let tmpDir: string;
let logs: CapturedLogs;
const agents: Array<KubernetesAiAgent> = [];

before(async (): Promise<void> => {
  server = new FakeOneUptime();
  await server.start();
  kubectl = new FakeKubectl();
  serviceAccount = new FakeServiceAccount({ namespace: "oneuptime-agent" });
});

after(async (): Promise<void> => {
  await server.stop();
  kubectl.cleanup();
  serviceAccount.cleanup();
});

beforeEach((): void => {
  server.reset();
  kubectl.clearInvocations();
  kubectl.setBehaviour({ stdout: "pods\n", clientVersion: "v1.36.4" });
  tmpDir = makeTempDir("agent-e2e-");
  logs = captureLogs();
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
    PATH: kubectl.getPath(),
    ONEUPTIME_URL: server.url,
    ONEUPTIME_API_KEY: "ingestion-key-1",
    ONEUPTIME_KUBERNETES_CLUSTER_NAME: "prod-us",
    ONEUPTIME_KUBERNETES_AGENT_CHART_VERSION: "14.0.8",
    ONEUPTIME_AI_AGENT_POD_NAMESPACE: "oneuptime-agent",
    ONEUPTIME_AI_AGENT_POLL_INTERVAL_MS: "1000",
    APP_VERSION: "14.0.8",
    KUBERNETES_SERVICE_HOST: "10.96.0.1",
    KUBERNETES_SERVICE_PORT: "443",
    ...overrides,
  };
}

function createAgent(options: Partial<AgentOptions> = {}): KubernetesAiAgent {
  const agent: KubernetesAiAgent = new KubernetesAiAgent({
    env: agentEnv(),
    serviceAccount: serviceAccount.paths(),
    tmpDir,
    healthPort: 0,
    healthHost: "127.0.0.1",
    sleep: recordingSleep().sleep,
    enableProxy: false,
    ...options,
  });
  agents.push(agent);
  return agent;
}

async function statusOf(
  agent: KubernetesAiAgent,
): Promise<AgentStatusSnapshot> {
  const port: number = (agent.getHealthServer()!.address() as AddressInfo).port;
  const response: Response = await fetch(`http://127.0.0.1:${port}/status`);
  return (await response.json()) as AgentStatusSnapshot;
}

async function readyStatus(agent: KubernetesAiAgent): Promise<number> {
  const port: number = (agent.getHealthServer()!.address() as AddressInfo).port;
  return (await fetch(`http://127.0.0.1:${port}/status/ready`)).status;
}

test("missing settings: the pod stays up and ready, says what is missing, and sends nothing", async () => {
  const agent: KubernetesAiAgent = createAgent({
    env: { PATH: kubectl.getPath() },
  });

  await agent.start();

  assert.strictEqual(await readyStatus(agent), 200);
  const snapshot: AgentStatusSnapshot = await statusOf(agent);
  assert.strictEqual(snapshot.phase, "misconfigured");
  assert.strictEqual(snapshot.registered, false);
  assert.strictEqual(snapshot.configProblems.length, 3);
  assert.strictEqual(logs.messages("error").length, 4);

  await realSleep(100);
  assert.strictEqual(server.requests.length, 0);

  await agent.shutdown("test");
  assert.strictEqual(agent.getHealthServer(), null);
});

test("start to finish: register, heartbeat, run a job, sign off last", async () => {
  server.script("/claim-next-job", jobReply({}));
  const agent: KubernetesAiAgent = createAgent();

  await agent.start();

  // Registration: the ingestion key, the cluster name and the pod's posture.
  const [registration] = await server.waitFor("/register");
  assert.strictEqual(
    registration!.headers["x-oneuptime-token"],
    "ingestion-key-1",
  );
  assert.deepStrictEqual(registration!.body, {
    clusterName: "prod-us",
    agentVersion: "14.0.8",
    posture: {
      clusterIdentifier: "prod-us",
      inCluster: true,
      allowWrites: false,
      allowNodeOperations: false,
      writeNamespaces: [],
      podNamespace: "oneuptime-agent",
      kubectlVersion: "v1.36.4",
      agentChartVersion: "14.0.8",
    },
  });

  // The job runs with the pod's ServiceAccount and its result comes back.
  const [result] = await server.waitFor("/job/:id/result");
  assert.strictEqual(result!.body["success"], true);
  assert.strictEqual(result!.body["exitCode"], 0);
  assert.strictEqual(result!.body["output"], "[stdout]\npods\n");

  const [invocation] =
    kubectl.getCommandInvocations() as Array<FakeKubectlInvocation>;
  assert.strictEqual(invocation!.argv[0], "--kubeconfig");
  assert.ok(
    invocation!.kubeconfig!.includes(
      `tokenFile: ${JSON.stringify(serviceAccount.token)}`,
    ),
  );

  const snapshot: AgentStatusSnapshot = await statusOf(agent);
  assert.strictEqual(snapshot.registered, true);
  assert.strictEqual(snapshot.agentId, "agent-1");
  assert.strictEqual(snapshot.jobsRun, 1);
  assert.strictEqual(snapshot.inCluster, true);

  await agent.shutdown("SIGTERM");

  const last: RecordedRequest = server.requests[server.requests.length - 1]!;
  assert.strictEqual(last.route, "/disconnect");
  assert.deepStrictEqual(last.body, { agentId: "agent-1", agentKey: "key-1" });
  assert.strictEqual(server.requestsTo("/disconnect").length, 1);

  // Nothing is sent after the sign-off.
  const count: number = server.requests.length;
  await realSleep(200);
  assert.strictEqual(server.requests.length, count);
  assert.strictEqual(
    fs.readdirSync(path.join(tmpDir, "oneuptime-kubectl")).length,
    0,
  );
});

test("heartbeats carry the identity and the same posture as the registration", async () => {
  const agent: KubernetesAiAgent = createAgent();

  await agent.start();
  const [registration] = await server.waitFor("/register");
  await eventually((): boolean => {
    return Boolean(agent.getSession()?.getIdentity());
  });

  await agent.getHeartbeat()!.tick();

  const [heartbeat] = server.requestsTo("/heartbeat");
  assert.deepStrictEqual(heartbeat!.body, {
    agentId: "agent-1",
    agentKey: "key-1",
    agentVersion: "14.0.8",
    posture: registration!.body["posture"],
  });
  assert.ok((await statusOf(agent)).lastHeartbeatAt);
});

test("shutdown lets the job in progress finish and report before signing off", async () => {
  kubectl.setBehaviour({
    stdout: "done\n",
    sleepMs: 600,
    clientVersion: "v1.36.4",
  });
  server.script("/claim-next-job", jobReply({}));
  const agent: KubernetesAiAgent = createAgent();

  await agent.start();
  await server.waitFor("/job/:id/heartbeat");
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
  const agent: KubernetesAiAgent = createAgent();

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

test("start-up removes kubectl directories a previous run left behind", async () => {
  const leftover: string = path.join(tmpDir, "oneuptime-kubectl", "job-old");
  fs.mkdirSync(path.join(leftover, "home"), { recursive: true });
  fs.writeFileSync(path.join(leftover, "config"), "stale kubeconfig");

  const agent: KubernetesAiAgent = createAgent();
  await agent.start();

  assert.strictEqual(fs.existsSync(leftover), false);
});

test("outside a pod the agent still registers (inCluster false) and says why commands will fail", async () => {
  const agent: KubernetesAiAgent = createAgent({
    env: agentEnv({ KUBERNETES_SERVICE_HOST: "", KUBERNETES_SERVICE_PORT: "" }),
  });

  await agent.start();
  const [registration] = await server.waitFor("/register");

  assert.strictEqual(
    (registration!.body["posture"] as Record<string, unknown>)["inCluster"],
    false,
  );
  assert.ok(
    logs.messages("warn").some((message: string): boolean => {
      return message.includes("not running as a pod");
    }),
  );
});

test("writes allowed by the chart are reported and logged", async () => {
  const agent: KubernetesAiAgent = createAgent({
    env: agentEnv({
      ONEUPTIME_KUBECTL_ALLOW_WRITES: "true",
      ONEUPTIME_KUBECTL_WRITE_NAMESPACES: "web,api",
    }),
  });

  await agent.start();
  const [registration] = await server.waitFor("/register");
  const posture: Record<string, unknown> = registration!.body[
    "posture"
  ] as Record<string, unknown>;

  assert.strictEqual(posture["allowWrites"], true);
  assert.deepStrictEqual(posture["writeNamespaces"], ["web", "api"]);
  assert.ok(
    logs.records.some((record: Record<string, unknown>): boolean => {
      return (
        record["message"] === "Cluster access" && record["writes"] === "web,api"
      );
    }),
  );
});

test("shutdown is idempotent", async () => {
  const agent: KubernetesAiAgent = createAgent();
  await agent.start();
  await server.waitFor("/register");

  await Promise.all([agent.shutdown("a"), agent.shutdown("b")]);
  await agent.shutdown("c");

  assert.strictEqual(server.requestsTo("/disconnect").length, 1);
});

/*
 * Shutdown order (finding: a heartbeat still on the wire could land after
 * the sign-off, flip the agent back to connected and lock the replacement
 * pod out for minutes; an unbounded wait could run past the force exit).
 */
test("shutdown stops heartbeating and registering at once, while the job in progress still finishes", async () => {
  kubectl.setBehaviour({
    stdout: "done\n",
    sleepMs: 1_500,
    clientVersion: "v1.36.4",
  });
  server.script("/claim-next-job", jobReply({}));
  const agent: KubernetesAiAgent = createAgent();

  await agent.start();
  await server.waitFor("/job/:id/heartbeat");
  const heartbeatsBefore: number = server.requestsTo("/heartbeat").length;

  const stopping: Promise<void> = agent.shutdown("SIGTERM");

  // The job is still running, and yet nothing else will be sent.
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
  const agent: KubernetesAiAgent = createAgent();

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
  const agent: KubernetesAiAgent = createAgent({ shutdownGraceMs: 200 });

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
    json: { agentId: "agent-7", agentKey: "key-7", clusterId: "cluster-1" },
  });
  const agent: KubernetesAiAgent = createAgent();

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
  const agent: KubernetesAiAgent = createAgent({ shutdownGraceMs: 200 });

  await agent.start();
  await server.waitFor("/register");
  const started: number = Date.now();
  await agent.shutdown("SIGTERM");

  assert.ok(Date.now() - started < 5_000, "not the 30s request timeout");
  // No identity was ever issued, so there is nothing to sign off.
  assert.strictEqual(server.requestsTo("/disconnect").length, 0);
  assert.strictEqual(server.requestsTo("/register").length, 1);
});

test("the shutdown budget: grace, a cancelled call and the sign-off all fit before the force exit, inside the pod's 30s", () => {
  assert.ok(
    DEFAULT_SHUTDOWN_GRACE_MS +
      CANCELLED_REQUEST_SETTLE_MS +
      DISCONNECT_TIMEOUT_MS <
      FORCE_EXIT_AFTER_MS,
  );
  assert.ok(FORCE_EXIT_AFTER_MS < 30_000);
});
