import {
  CapturedLogs,
  captureLogs,
  recordingSleep,
} from "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import path from "path";
import { after, afterEach, before, beforeEach, test } from "node:test";
import ResourceAiAgent, { AgentOptions } from "../Agent";
import { AgentStatusSnapshot } from "../AgentStatus";
import HostExecutor, {
  HostExecutorSettings,
  buildHostEnvironment,
} from "../Executors/HostExecutor";
import {
  ExecutorOptions,
  ResourceExecutor,
} from "../Executors/ResourceExecutor";
import { makeTempDir } from "./Helpers/FakeBinary";
import FakeNsenter, {
  AGENT_PID,
  HOST_NAMESPACE,
  HostProcLayout,
  HostSpawnRecord,
  healthyHost,
  makeHostProc,
} from "./Helpers/FakeNsenter";
import FakeOneUptime, {
  FakeReply,
  RecordedRequest,
  TEST_RESOURCE_ID,
  jobReply,
} from "./Helpers/FakeOneUptime";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import ResourceCommandPolicy from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { ResourceCommandPolicyResult } from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * The Host AI agent end to end, as Index.ts runs it with
 * ONEUPTIME_AI_AGENT_RESOURCE_TYPE=host: the agent builds a HostExecutor,
 * which tiers every command with the REAL host policy and starts a fake
 * nsenter (Helpers/FakeNsenter) in place of /usr/bin/nsenter. /proc, the
 * uid and the container marker files are the test's, so the agent believes
 * it runs privileged with pid: host (or, in one test, without it).
 * OneUptime is a local fake of the ingest API.
 */

const HOSTNAME: string = "node-17";

let server: FakeOneUptime;
let tmpDir: string;
let markersDir: string;
let logs: CapturedLogs;
let nsenter: FakeNsenter;
const agents: Array<ResourceAiAgent> = [];
const procDirs: Array<string> = [];

before(async (): Promise<void> => {
  server = new FakeOneUptime();
  await server.start();
  markersDir = makeTempDir("agent-host-e2e-markers-");
  fs.writeFileSync(path.join(markersDir, "dockerenv"), "");
});

after(async (): Promise<void> => {
  await server.stop();
  fs.rmSync(markersDir, { recursive: true, force: true });

  for (const dir of procDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach((): void => {
  server.reset();
  nsenter = new FakeNsenter(healthyHost(HOSTNAME));
  tmpDir = makeTempDir("agent-host-e2e-");
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
    PATH: "/usr/bin:/bin",
    ONEUPTIME_URL: server.url,
    ONEUPTIME_TELEMETRY_INGESTION_KEY: "ingestion-key-1",
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "host",
    ONEUPTIME_AI_AGENT_POLL_INTERVAL_MS: "1000",
    APP_VERSION: "14.0.8",
    ...overrides,
  };
}

function createAgent(
  data: { env?: NodeJS.ProcessEnv; proc?: HostProcLayout } = {},
): ResourceAiAgent {
  const procRoot: string = makeHostProc(data.proc || {});
  procDirs.push(procRoot);

  const settings: HostExecutorSettings = {
    procRoot,
    // The agent runs in a Docker container, as its docker-compose.yml starts it.
    dockerMarkerFile: path.join(markersDir, "dockerenv"),
    podmanMarkerFile: path.join(markersDir, "absent"),
    getuid: (): number => {
      return 0;
    },
    selfPid: AGENT_PID,
    probeTimeoutMs: 2_000,
  };
  const options: AgentOptions = {
    env: data.env || agentEnv(),
    tmpDir,
    healthPort: 0,
    healthHost: "127.0.0.1",
    sleep: recordingSleep().sleep,
    enableProxy: false,
    spawnImpl: nsenter.spawnImpl,
    createExecutor: (executorOptions: ExecutorOptions): ResourceExecutor => {
      return new HostExecutor(executorOptions, settings);
    },
  };
  const agent: ResourceAiAgent = new ResourceAiAgent(options);
  agents.push(agent);
  return agent;
}

// A job for this host, as the server would send it: tiered by the same policy.
function hostJob(data: {
  command: string;
  origin?: string;
  jobId?: string;
  identifier?: string;
}): FakeReply {
  const policy: ResourceCommandPolicyResult =
    ResourceCommandPolicy.evaluateCommand({
      resourceType: AiResourceType.Host,
      command: data.command,
    });

  return jobReply({
    jobId: data.jobId || "job-1",
    origin: data.origin || "AiInvestigation",
    payload: {
      resourceType: "Host",
      resourceId: TEST_RESOURCE_ID,
      resourceIdentifier: data.identifier || HOSTNAME,
      program: policy.program,
      args: policy.args,
      displayCommand: policy.displayCommand,
      tier: policy.tier,
    },
  });
}

function callsOf(program: string): Array<HostSpawnRecord> {
  return nsenter.calls.filter((call: HostSpawnRecord): boolean => {
    return call.hostArgv[0] === program;
  });
}

function postureOf(request: RecordedRequest): Record<string, unknown> {
  return request.body["posture"] as Record<string, unknown>;
}

test("without HOST_NAME it registers under the host's own hostname, reports the host, and runs an investigation's read", async () => {
  server.script(
    "/claim-next-job",
    hostJob({ command: "systemctl status nginx -n 50" }),
  );
  const agent: ResourceAiAgent = createAgent();

  await agent.start();

  const [registration] = await server.waitFor("/register");
  const body: Record<string, unknown> = registration!.body;
  const posture: Record<string, unknown> = postureOf(registration!);

  assert.strictEqual(body["resourceType"], "Host");
  assert.strictEqual(body["resourceIdentifier"], HOSTNAME);
  assert.strictEqual(agent.config.identitySource, "executor");
  assert.strictEqual(
    posture["toolVersion"],
    "Linux 6.8.0-45-generic / systemd 255",
  );
  assert.strictEqual(posture["reachable"], true);
  assert.strictEqual(posture["allowWrites"], false);
  assert.deepStrictEqual(posture["protectedTargets"], [
    "oneuptime-*",
    "otelcol-contrib.service",
    "otelcol.service",
    "docker.service",
    "docker.socket",
    "containerd.service",
    "pid:4242",
    "pid:4200",
    "pid:4100",
  ]);
  assert.deepStrictEqual(posture["details"], {
    containerRuntime: "docker",
    kernel: "Linux 6.8.0-45-generic",
    systemd: true,
    systemdVersion: "255.4-1ubuntu8.4",
    hostname: HOSTNAME,
    hostnameMatchesIdentity: true,
    os: "Ubuntu 24.04.1 LTS",
  });
  // The ingestion key never leaves the agent except as its credential header.
  assert.doesNotMatch(JSON.stringify(posture), /ingestion-key-1/);

  const [result] = await server.waitFor("/job/:id/result", 1, 20_000);

  assert.deepStrictEqual(
    {
      success: result!.body["success"],
      exitCode: result!.body["exitCode"],
      output: result!.body["output"],
    },
    {
      success: true,
      exitCode: 0,
      output: "[stdout]\nran systemctl --no-pager status nginx -n 50\n",
    },
  );

  const [run] = callsOf("systemctl").filter((call: HostSpawnRecord) => {
    return call.hostArgv.includes("status");
  });
  assert.deepStrictEqual(run!.args, [
    "--target",
    "1",
    "--mount",
    "--uts",
    "--ipc",
    "--net",
    "--pid",
    "--",
    "systemctl",
    "--no-pager",
    "status",
    "nginx",
    "-n",
    "50",
  ]);
  assert.deepStrictEqual(run!.env, buildHostEnvironment());
});

test("a fix on a read-only agent is refused before nsenter starts, and reported as never run", async () => {
  server.script(
    "/claim-next-job",
    hostJob({ command: "systemctl restart nginx", origin: "AiRemediation" }),
  );
  const agent: ResourceAiAgent = createAgent({
    env: agentEnv({ HOST_NAME: HOSTNAME }),
  });

  await agent.start();
  const [result] = await server.waitFor("/job/:id/result", 1, 20_000);

  assert.strictEqual(result!.body["success"], false);
  assert.strictEqual(result!.body["exitCode"], undefined);
  assert.match(
    String(result!.body["errorMessage"]),
    /^Refused by the Host AI agent: "systemctl restart nginx" changes the Host, and this agent is read-only/,
  );
  assert.strictEqual(
    callsOf("systemctl").filter((call: HostSpawnRecord) => {
      return call.hostArgv.includes("restart");
    }).length,
    0,
  );
});

test("with writes allowed, a restart runs, and a restart of the agent itself is refused", async () => {
  server.script(
    "/claim-next-job",
    hostJob({
      command: "systemctl restart nginx",
      origin: "AiRemediation",
      jobId: "job-1",
    }),
    hostJob({
      command: "systemctl restart oneuptime-host-ai-agent",
      origin: "AiRemediation",
      jobId: "job-2",
    }),
  );
  const agent: ResourceAiAgent = createAgent({
    env: agentEnv({
      HOST_NAME: HOSTNAME,
      ONEUPTIME_AI_ALLOW_WRITES: "true",
    }),
  });

  await agent.start();

  const [registration] = await server.waitFor("/register");
  assert.strictEqual(postureOf(registration!)["allowWrites"], true);

  const results: Array<RecordedRequest> = await server.waitFor(
    "/job/:id/result",
    2,
    20_000,
  );
  const byJob: Record<string, Record<string, unknown>> = {};
  for (const request of results) {
    byJob[request.route.split("/")[2] || ""] = request.body;
  }

  assert.strictEqual(byJob["job-1"]!["success"], true, JSON.stringify(byJob));
  assert.strictEqual(
    byJob["job-1"]!["output"],
    "[stdout]\nran systemctl --no-pager restart nginx\n",
  );

  assert.strictEqual(byJob["job-2"]!["success"], false);
  assert.strictEqual(byJob["job-2"]!["exitCode"], undefined);
  assert.match(
    String(byJob["job-2"]!["errorMessage"]),
    /would change oneuptime-host-ai-agent\.service, which the Host AI agent protects \(oneuptime-\*\)/,
  );

  const restarts: Array<Array<string>> = callsOf("systemctl")
    .filter((call: HostSpawnRecord): boolean => {
      return call.hostArgv.includes("restart");
    })
    .map((call: HostSpawnRecord): Array<string> => {
      return call.hostArgv;
    });
  assert.deepStrictEqual(restarts, [
    ["systemctl", "--no-pager", "restart", "nginx"],
  ]);
});

test("without pid: host the posture says what to change, and nothing runs inside the container", async () => {
  server.script("/claim-next-job", hostJob({ command: "ps aux" }));
  const agent: ResourceAiAgent = createAgent({
    env: agentEnv({ HOST_NAME: HOSTNAME }),
    proc: { ownMountNamespace: HOST_NAMESPACE, initName: "tini" },
  });

  await agent.start();

  const [registration] = await server.waitFor("/register");
  const posture: Record<string, unknown> = postureOf(registration!);

  assert.strictEqual(posture["reachable"], false);
  assert.match(
    String(posture["reachError"]),
    /^Pid 1 is this container's own init \(tini\), not the host's: the container was started without pid: host/,
  );

  const [result] = await server.waitFor("/job/:id/result", 1, 20_000);

  assert.strictEqual(result!.body["success"], false);
  assert.strictEqual(result!.body["exitCode"], undefined);
  assert.match(
    String(result!.body["errorMessage"]),
    /^Refused by the Host AI agent: pid 1 is this container's own init \(tini\)/,
  );
  assert.deepStrictEqual(nsenter.calls, []);
});

test("without HOST_NAME, and unable to read the hostname, the agent stays misconfigured and says why", async () => {
  const agent: ResourceAiAgent = createAgent({
    proc: { hostMountNamespace: null },
  });

  await agent.start();

  const snapshot: AgentStatusSnapshot = agent.status.snapshot();
  assert.strictEqual(snapshot.phase, "misconfigured");
  assert.match(
    String(snapshot.configProblems[0]),
    /^HOST_NAME is not set, and the agent could not read this Host's name itself/,
  );
  assert.ok(
    logs.messages("warn").some((message: string): boolean => {
      return message.startsWith(
        "Could not read the host's hostname: this agent cannot see /proc/1/ns/mnt (ENOENT)",
      );
    }),
    JSON.stringify(logs.messages("warn")),
  );
  assert.strictEqual(server.requests.length, 0);
});
