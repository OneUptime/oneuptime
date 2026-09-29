import {
  CapturedLogs,
  captureLogs,
  recordingSleep,
} from "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import { after, afterEach, before, beforeEach, test } from "node:test";
import ResourceAiAgent, { AgentOptions } from "../Agent";
import FakeGovc, {
  ABOUT_JSON_CAMEL,
  FakeGovcInvocation,
} from "./Helpers/FakeGovc";
import { makeTempDir } from "./Helpers/FakeBinary";
import FakeOneUptime, {
  RecordedRequest,
  TEST_RESOURCE_ID,
  jobReply,
} from "./Helpers/FakeOneUptime";

/*
 * The VMware AI agent end to end, as Index.ts runs it: the REAL executor
 * factory builds the GovcExecutor, which tiers every command with the REAL
 * govc policy and starts a fake govc (Helpers/FakeGovc) in place of
 * /usr/bin/govc. OneUptime is a local fake of the ingest API.
 */

const VCENTER_NAME: string = "vc-prod";

/*
 * Registration carries the posture probe's answer, and the probe runs the
 * fake CLI (a Node process), which a loaded machine can be slow to start:
 * wait for it as long as for a job's result.
 */
const REGISTER_WAIT_MS: number = 20_000;

let server: FakeOneUptime;
let govc: FakeGovc;
let tmpDir: string;
let logs: CapturedLogs;
const agents: Array<ResourceAiAgent> = [];

before(async (): Promise<void> => {
  server = new FakeOneUptime();
  await server.start();
  govc = new FakeGovc();
});

after(async (): Promise<void> => {
  await server.stop();
  govc.cleanup();
});

beforeEach((): void => {
  server.reset();
  govc.reset();
  govc.setScript({
    "about -json": { stdout: ABOUT_JSON_CAMEL },
    "vm.info": {
      stdout: "Name:           web-01\n  Power state:  poweredOff\n",
    },
    "vm.power -on web-01": {
      stdout: "Powering on VirtualMachine:vm-42... OK\n",
    },
  });
  tmpDir = makeTempDir("agent-govc-e2e-");
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
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "vmware",
    ONEUPTIME_AI_AGENT_POLL_INTERVAL_MS: "1000",
    VMWARE_VCENTER_NAME: VCENTER_NAME,
    VCENTER_ENDPOINT: "https://vcsa.example.com",
    VCENTER_USERNAME: "monitor@vsphere.local",
    VCENTER_PASSWORD: "read-only-password",
    VCENTER_INSECURE_SKIP_VERIFY: "true",
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
    spawnImpl: govc.spawnImpl(),
  };
  const agent: ResourceAiAgent = new ResourceAiAgent(options);
  agents.push(agent);
  return agent;
}

// A job for this vCenter, as the server would send it.
function govcJob(data: {
  args: Array<string>;
  tier: string;
  origin?: string;
}): ReturnType<typeof jobReply> {
  return jobReply({
    origin: data.origin || "AiInvestigation",
    payload: {
      resourceType: "VMwareVCenter",
      resourceId: TEST_RESOURCE_ID,
      resourceIdentifier: VCENTER_NAME,
      program: "govc",
      args: data.args,
      displayCommand: ["govc", ...data.args].join(" "),
      tier: data.tier,
    },
  });
}

function invocationsOf(command: string): Array<FakeGovcInvocation> {
  return govc.getInvocations().filter((invocation: FakeGovcInvocation) => {
    return invocation.argv[0] === command;
  });
}

test("registers with the vCenter's version, runs an investigation's read, and reports it", async () => {
  server.script(
    "/claim-next-job",
    govcJob({ args: ["vm.info", "web-01"], tier: "Read" }),
  );
  const agent: ResourceAiAgent = createAgent();

  await agent.start();

  const [registration] = await server.waitFor("/register", 1, REGISTER_WAIT_MS);
  const body: Record<string, unknown> = registration!.body;
  const posture: Record<string, unknown> = body["posture"] as Record<
    string,
    unknown
  >;

  assert.strictEqual(body["resourceType"], "VMwareVCenter");
  assert.strictEqual(body["resourceIdentifier"], VCENTER_NAME);
  assert.strictEqual(
    posture["toolVersion"],
    "VMware vCenter Server 8.0.2 build-22385739",
  );
  assert.strictEqual(posture["reachable"], true);
  assert.strictEqual(posture["allowWrites"], false);
  assert.deepStrictEqual(posture["protectedTargets"], [
    "vcsa.example.com",
    "vcsa",
  ]);
  assert.deepStrictEqual(posture["details"], {
    vcenterHost: "vcsa.example.com",
    credentialSource: "VCENTER_USERNAME",
    tlsVerification: "skipped",
    datacenter: null,
    vcenterProduct: "VMware vCenter Server",
    vcenterVersion: "8.0.2",
    vcenterBuild: "22385739",
    vcenterApiType: "VirtualCenter",
    vcenterApiVersion: "8.0.2.0",
  });
  // The agent's credentials never leave it.
  assert.doesNotMatch(registration!.rawBody, /read-only-password|monitor@/);

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
      output: "[stdout]\nName:           web-01\n  Power state:  poweredOff\n",
    },
  );

  const [run] = invocationsOf("vm.info");
  assert.deepStrictEqual(run!.argv, ["vm.info", "web-01"]);
  assert.strictEqual(run!.env["GOVC_URL"], "https://vcsa.example.com/sdk");
  assert.strictEqual(run!.env["GOVC_INSECURE"], "true");
  assert.strictEqual(run!.env["ONEUPTIME_TELEMETRY_INGESTION_KEY"], undefined);
  assert.strictEqual(invocationsOf("about").length >= 1, true);
});

test("a fix on a read-only agent is refused before govc starts, and reported as never run", async () => {
  server.script(
    "/claim-next-job",
    govcJob({
      args: ["vm.power", "-on", "web-01"],
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
    /^Refused by the VMware AI agent: "govc vm\.power -on web-01" changes the VMware vCenter, and this agent is read-only/,
  );
  assert.strictEqual(invocationsOf("vm.power").length, 0);
});

test("with writes allowed, a SafeWrite fix runs with the AI user's credentials", async () => {
  server.script(
    "/claim-next-job",
    govcJob({
      args: ["vm.power", "-on", "web-01"],
      tier: "SafeWrite",
      origin: "AiRemediation",
    }),
  );
  const agent: ResourceAiAgent = createAgent(
    agentEnv({
      ONEUPTIME_AI_ALLOW_WRITES: "true",
      ONEUPTIME_AI_VCENTER_USERNAME: "oneuptime-ai@vsphere.local",
      ONEUPTIME_AI_VCENTER_PASSWORD: "fix-it-password",
    }),
  );

  await agent.start();

  const [registration] = await server.waitFor("/register", 1, REGISTER_WAIT_MS);
  const posture: Record<string, unknown> = registration!.body[
    "posture"
  ] as Record<string, unknown>;
  assert.strictEqual(posture["allowWrites"], true);
  assert.strictEqual(
    (posture["details"] as Record<string, unknown>)["credentialSource"],
    "ONEUPTIME_AI_VCENTER_USERNAME",
  );

  const [result] = await server.waitFor("/job/:id/result", 1, 20_000);

  assert.strictEqual(result!.body["success"], true, result!.rawBody);
  assert.strictEqual(
    result!.body["output"],
    "[stdout]\nPowering on VirtualMachine:vm-42... OK\n",
  );

  const [run] = invocationsOf("vm.power");
  assert.deepStrictEqual(run!.argv, ["vm.power", "-on", "web-01"]);
  assert.strictEqual(run!.env["GOVC_USERNAME"], "oneuptime-ai@vsphere.local");
  assert.strictEqual(run!.env["GOVC_PASSWORD"], "fix-it-password");
});

test("a fix on the vCenter appliance itself is refused, whatever path names it", async () => {
  server.script(
    "/claim-next-job",
    govcJob({
      args: ["vm.power", "-off", "/DC/vm/infra/vcsa"],
      tier: "RiskyWrite",
      origin: "AiRemediation",
    }),
  );
  const agent: ResourceAiAgent = createAgent(
    agentEnv({ ONEUPTIME_AI_ALLOW_WRITES: "true" }),
  );

  await agent.start();
  const [result] = await server.waitFor("/job/:id/result", 1, 20_000);

  assert.strictEqual(result!.body["success"], false);
  assert.strictEqual(result!.body["exitCode"], undefined);
  assert.match(
    String(result!.body["errorMessage"]),
    /would change \/DC\/vm\/infra\/vcsa, which the VMware AI agent protects \(vcsa\)/,
  );
  assert.strictEqual(invocationsOf("vm.power").length, 0);
});

test("a vCenter that rejects the login: the posture says so, and a command's failure says what to fix", async () => {
  govc.setScript({
    "*": {
      stderr:
        "govc: ServerFaultCode: Cannot complete login due to an incorrect user name or password.\n",
      exitCode: 1,
    },
  });
  server.script("/claim-next-job", govcJob({ args: ["about"], tier: "Read" }));
  const agent: ResourceAiAgent = createAgent();

  await agent.start();

  const [registration] = await server.waitFor("/register", 1, REGISTER_WAIT_MS);
  const posture: Record<string, unknown> = registration!.body[
    "posture"
  ] as Record<string, unknown>;

  assert.strictEqual(posture["reachable"], false);
  assert.match(
    String(posture["reachError"]),
    /^vCenter rejected the agent's login: check VCENTER_USERNAME/,
  );

  const [result] = await server.waitFor("/job/:id/result", 1, 20_000);

  assert.strictEqual(result!.body["success"], false);
  assert.strictEqual(result!.body["exitCode"], 1);
  assert.match(
    String(result!.body["errorMessage"]),
    /^Exit code 1: govc: ServerFaultCode: Cannot complete login .* vCenter rejected the agent's login/,
  );

  const requests: Array<RecordedRequest> = server.requestsTo("/job/:id/result");
  assert.strictEqual(requests.length, 1);
});
