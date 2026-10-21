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
import FakeCeph, {
  HEALTH_WARN_JSON,
  STDERR_ACCESS_DENIED,
  STDERR_AUTH_REJECTED,
  VERSIONS_JSON,
} from "./Helpers/FakeCeph";
import { makeTempDir } from "./Helpers/FakeBinary";
import FakeOneUptime, {
  RecordedRequest,
  TEST_RESOURCE_ID,
  jobReply,
} from "./Helpers/FakeOneUptime";

/*
 * The Ceph AI agent end to end, as Index.ts runs it: the REAL executor
 * factory builds the CephExecutor, which tiers every command with the REAL
 * ceph policy and starts a fake ceph (Helpers/FakeCeph) in place of
 * /usr/bin/ceph. OneUptime is a local fake of the ingest API.
 */

const CLUSTER_NAME: string = "ceph-prod";

/*
 * Registration carries the posture probe's answer, and the probe runs the
 * fake CLI (a Node process), which a loaded machine can be slow to start:
 * wait for it as long as for a job's result.
 */
const REGISTER_WAIT_MS: number = 20_000;
const KEY: string = "AQAwjrtqK5MvFxAA37KrFISvJt/1Kqk3QP9GSA==";

let server: FakeOneUptime;
let ceph: FakeCeph;
let tmpDir: string;
let cephDir: string;
let logs: CapturedLogs;
const agents: Array<ResourceAiAgent> = [];

before(async (): Promise<void> => {
  server = new FakeOneUptime();
  await server.start();
  ceph = new FakeCeph();
  cephDir = makeTempDir("agent-ceph-e2e-etc-");
  fs.writeFileSync(
    path.join(cephDir, "ceph.conf"),
    "[global]\n\tmon_host = [v2:10.0.0.11:3300/0,v1:10.0.0.11:6789/0]\n",
  );
  fs.writeFileSync(
    path.join(cephDir, "ceph.client.oneuptime-ai.keyring"),
    `[client.oneuptime-ai]\n\tkey = ${KEY}\n`,
    { mode: 0o600 },
  );
});

after(async (): Promise<void> => {
  await server.stop();
  ceph.cleanup();
  fs.rmSync(cephDir, { recursive: true, force: true });
});

beforeEach((): void => {
  server.reset();
  ceph.reset();
  ceph.setScript({
    "versions --format json": { stdout: VERSIONS_JSON },
    "health --format json": { stdout: HEALTH_WARN_JSON },
    "osd tree": {
      stdout:
        "ID  CLASS  WEIGHT   TYPE NAME       STATUS  REWEIGHT  PRI-AFF\n-1         0.29306  root default\n 3    hdd  0.09769      osd.3       down         0  1.00000\n",
    },
    "osd in 3": { stderr: "marked in osd.3. \n" },
  });
  tmpDir = makeTempDir("agent-ceph-e2e-");
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
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "ceph",
    ONEUPTIME_AI_AGENT_POLL_INTERVAL_MS: "1000",
    CEPH_CLUSTER_NAME: CLUSTER_NAME,
    CEPH_CONF: path.join(cephDir, "ceph.conf"),
    CEPH_KEYRING: path.join(cephDir, "ceph.client.oneuptime-ai.keyring"),
    APP_VERSION: "14.0.8",
    ...overrides,
  };
}

function createAgent(env: NodeJS.ProcessEnv = agentEnv()): ResourceAiAgent {
  const options: AgentOptions = {
    env,
    tmpDir,
    healthPort: 0,
    healthHost: "127.0.0.1",
    sleep: recordingSleep().sleep,
    enableProxy: false,
    spawnImpl: ceph.spawnImpl(),
  };
  const agent: ResourceAiAgent = new ResourceAiAgent(options);
  agents.push(agent);
  return agent;
}

// A job for this cluster, as the server would send it.
function cephJob(data: {
  args: Array<string>;
  tier: string;
  origin?: string;
}): ReturnType<typeof jobReply> {
  return jobReply({
    origin: data.origin || "AiInvestigation",
    payload: {
      resourceType: "CephCluster",
      resourceId: TEST_RESOURCE_ID,
      resourceIdentifier: CLUSTER_NAME,
      program: "ceph",
      args: data.args,
      displayCommand: ["ceph", ...data.args].join(" "),
      tier: data.tier,
    },
  });
}

test("registers with the cluster's release and health, runs an investigation's read, and reports it", async () => {
  server.script(
    "/claim-next-job",
    cephJob({ args: ["osd", "tree"], tier: "Read" }),
  );
  const agent: ResourceAiAgent = createAgent();

  await agent.start();

  const [registration] = await server.waitFor("/register", 1, REGISTER_WAIT_MS);
  const body: Record<string, unknown> = registration!.body;
  const posture: Record<string, unknown> = body["posture"] as Record<
    string,
    unknown
  >;

  assert.strictEqual(body["resourceType"], "CephCluster");
  assert.strictEqual(body["resourceIdentifier"], CLUSTER_NAME);
  assert.strictEqual(posture["toolVersion"], "ceph 19.2.3 squid (stable)");
  assert.strictEqual(posture["reachable"], true);
  assert.strictEqual(posture["allowWrites"], false);
  assert.deepStrictEqual(posture["protectedTargets"], []);
  assert.deepStrictEqual(posture["details"], {
    clientId: "oneuptime-ai",
    confPath: path.join(cephDir, "ceph.conf"),
    keyringPath: path.join(cephDir, "ceph.client.oneuptime-ai.keyring"),
    health: "HEALTH_WARN",
    healthChecks: "OSD_DOWN, PG_DEGRADED",
    mixedVersions: false,
  });
  // The agent's key never leaves it.
  assert.doesNotMatch(registration!.rawBody, /AQAwjrtqK5MvFxAA/);

  const [result] = await server.waitFor("/job/:id/result", 1, 20_000);

  assert.strictEqual(result!.body["success"], true, result!.rawBody);
  assert.strictEqual(result!.body["exitCode"], 0);
  assert.match(String(result!.body["output"]), /^\[stdout\]\nID {2}CLASS/);

  const [run] = ceph.invocationsOf("osd", "tree");
  assert.deepStrictEqual(run!.argv, [
    "--conf",
    path.join(cephDir, "ceph.conf"),
    "--keyring",
    path.join(cephDir, "ceph.client.oneuptime-ai.keyring"),
    "--id",
    "oneuptime-ai",
    "--connect-timeout",
    "10",
    "osd",
    "tree",
  ]);
  assert.deepStrictEqual(Object.keys(run!.env).sort(), ["HOME", "PATH"]);
  assert.ok(ceph.invocationsOf("versions").length >= 1);
  assert.ok(ceph.invocationsOf("health").length >= 1);
});

test("a fix on a read-only agent is refused before ceph starts, and reported as never run", async () => {
  server.script(
    "/claim-next-job",
    cephJob({
      args: ["osd", "in", "3"],
      tier: "SafeWrite",
      origin: "AiRemediation",
    }),
  );
  const agent: ResourceAiAgent = createAgent();

  await agent.start();
  const [result] = await server.waitFor("/job/:id/result", 1, 20_000);

  assert.strictEqual(result!.body["success"], false);
  assert.strictEqual(result!.body["exitCode"], undefined);
  assert.match(
    String(result!.body["errorMessage"]),
    /^Refused by the Ceph AI agent: "ceph osd in 3" changes the Ceph cluster, and this agent is read-only/,
  );
  assert.strictEqual(ceph.invocationsOf("osd", "in").length, 0);
});

test("with writes allowed, a SafeWrite fix runs and is reported", async () => {
  server.script(
    "/claim-next-job",
    cephJob({
      args: ["osd", "in", "3"],
      tier: "SafeWrite",
      origin: "AiRemediation",
    }),
  );
  const agent: ResourceAiAgent = createAgent(
    agentEnv({ ONEUPTIME_AI_ALLOW_WRITES: "true" }),
  );

  await agent.start();

  const [registration] = await server.waitFor("/register", 1, REGISTER_WAIT_MS);
  const posture: Record<string, unknown> = registration!.body[
    "posture"
  ] as Record<string, unknown>;
  assert.strictEqual(posture["allowWrites"], true);

  const [result] = await server.waitFor("/job/:id/result", 1, 20_000);

  assert.strictEqual(result!.body["success"], true, result!.rawBody);
  assert.strictEqual(result!.body["output"], "[stderr]\nmarked in osd.3. \n");

  const [run] = ceph.invocationsOf("osd", "in");
  assert.deepStrictEqual(run!.command, ["osd", "in", "3"]);
});

test("a fix on a protected OSD is refused, however the command names it", async () => {
  server.script(
    "/claim-next-job",
    cephJob({
      args: ["osd", "out", "osd.3"],
      tier: "RiskyWrite",
      origin: "AiRemediation",
    }),
  );
  const agent: ResourceAiAgent = createAgent(
    agentEnv({
      ONEUPTIME_AI_ALLOW_WRITES: "true",
      ONEUPTIME_AI_PROTECTED_TARGETS: "osd.3",
    }),
  );

  await agent.start();

  const [registration] = await server.waitFor("/register", 1, REGISTER_WAIT_MS);
  assert.deepStrictEqual(
    (registration!.body["posture"] as Record<string, unknown>)[
      "protectedTargets"
    ],
    ["osd.3"],
  );

  const [result] = await server.waitFor("/job/:id/result", 1, 20_000);

  assert.strictEqual(result!.body["success"], false);
  assert.strictEqual(result!.body["exitCode"], undefined);
  assert.match(
    String(result!.body["errorMessage"]),
    /would change osd\.3, which the Ceph AI agent protects \(osd\.3\)/,
  );
  assert.strictEqual(ceph.invocationsOf("osd", "out").length, 0);
});

test("a key the monitors reject: the posture says so, and a command's failure says what to fix", async () => {
  ceph.setScript({ "*": { stderr: STDERR_AUTH_REJECTED, exitCode: 13 } });
  server.script("/claim-next-job", cephJob({ args: ["health"], tier: "Read" }));
  const agent: ResourceAiAgent = createAgent();

  await agent.start();

  const [registration] = await server.waitFor("/register", 1, REGISTER_WAIT_MS);
  const posture: Record<string, unknown> = registration!.body[
    "posture"
  ] as Record<string, unknown>;

  assert.strictEqual(posture["reachable"], false);
  assert.match(
    String(posture["reachError"]),
    /^The monitors rejected client\.oneuptime-ai's key/,
  );

  const [result] = await server.waitFor("/job/:id/result", 1, 20_000);

  assert.strictEqual(result!.body["success"], false);
  assert.strictEqual(result!.body["exitCode"], 13);
  assert.match(
    String(result!.body["errorMessage"]),
    /^Exit code 13: \[errno 13\] RADOS permission denied \(error connecting to the cluster\)\. The monitors rejected client\.oneuptime-ai's key/,
  );

  const requests: Array<RecordedRequest> = server.requestsTo("/job/:id/result");
  assert.strictEqual(requests.length, 1);
});

test("a client without read caps: reported with the caps to grant", async () => {
  ceph.setScript({ "*": { stderr: STDERR_ACCESS_DENIED, exitCode: 13 } });
  server.script("/claim-next-job", cephJob({ args: ["health"], tier: "Read" }));
  const agent: ResourceAiAgent = createAgent();

  await agent.start();
  const [result] = await server.waitFor("/job/:id/result", 1, 20_000);

  assert.match(
    String(result!.body["errorMessage"]),
    /give it the read caps with ceph auth caps client\.oneuptime-ai mon 'allow r' mgr 'allow r' osd 'allow r'\.$/,
  );
});

test("no keyring mounted: the agent stays up, says what to create, and runs nothing", async () => {
  server.script("/claim-next-job", cephJob({ args: ["health"], tier: "Read" }));
  const agent: ResourceAiAgent = createAgent(
    agentEnv({ CEPH_KEYRING: path.join(cephDir, "missing.keyring") }),
  );

  await agent.start();

  const [registration] = await server.waitFor("/register", 1, REGISTER_WAIT_MS);
  const posture: Record<string, unknown> = registration!.body[
    "posture"
  ] as Record<string, unknown>;

  assert.strictEqual(posture["reachable"], false);
  assert.match(
    String(posture["reachError"]),
    /^The keyring .*missing\.keyring is not in the agent's container\. Create it \(ceph auth get-or-create client\.oneuptime-ai/,
  );

  const [result] = await server.waitFor("/job/:id/result", 1, 20_000);

  assert.strictEqual(result!.body["success"], false);
  assert.strictEqual(result!.body["exitCode"], undefined);
  assert.match(
    String(result!.body["errorMessage"]),
    /^Refused by the Ceph AI agent: it cannot connect to the Ceph cluster as configured\. The keyring /,
  );
  assert.strictEqual(ceph.getInvocations().length, 0);
});
