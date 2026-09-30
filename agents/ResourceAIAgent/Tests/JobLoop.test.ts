import {
  CapturedLogs,
  RecordingSleep,
  captureLogs,
  eventually,
  realSleep,
  recordingLogger,
  recordingSleep,
  testConfig,
  testEnv,
} from "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  test,
} from "node:test";
import AgentStatus from "../AgentStatus";
import { AgentConfig } from "../Config";
import IngestClient from "../IngestClient";
import JobLoop, {
  ClaimedJob,
  DEFAULT_JOB_TIMINGS,
  JOB_CREDENTIAL_FIELDS,
  JobTimings,
  NOT_RUN_LEASE_LOST_MESSAGE,
  NOT_RUN_SHUTTING_DOWN_MESSAGE,
  PAYLOAD_CREDENTIAL_FIELDS,
  RESOURCE_COMMAND_STEP_TYPE,
  getJobRefusal,
  getResultRetryDelayMs,
  normalizeJobTimeout,
  parseClaimedJob,
} from "../JobLoop";
import { AgentPosture } from "../Posture";
import { AgentIdentity, AgentSession } from "../Registration";
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
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";

/*
 * The claim loop end to end: a local OneUptime hands out jobs, the real
 * PrepareGuard checks them (with a fake policy table), a fake docker binary
 * runs them in the real sandbox, and the tests read what came back to the
 * server.
 */

const POSTURE: AgentPosture = {
  resourceType: AiResourceType.DockerHost,
  resourceIdentifier: "web-host-1",
  allowWrites: false,
  writeTargets: [],
  protectedTargets: [],
  reachable: true,
};

// What the fake policy knows; anything else is Denied.
const POLICY_TABLE: Record<string, ResourceCommandTier> = {
  "docker ps": ResourceCommandTier.Read,
  "docker logs web-1": ResourceCommandTier.Read,
  "docker restart web-1": ResourceCommandTier.SafeWrite,
  "docker restart api-1": ResourceCommandTier.SafeWrite,
  "docker restart oneuptime-docker-ai-agent": ResourceCommandTier.SafeWrite,
  "docker stop web-1": ResourceCommandTier.RiskyWrite,
};

function job(overrides: Record<string, unknown> = {}): ClaimedJob {
  return parseClaimedJob({
    jobId: "job-1",
    origin: "AiInvestigation",
    stepId: "step-1",
    stepType: "ResourceCommand",
    timeoutInMs: 30_000,
    payload: testPayload(),
    ...overrides,
  })!;
}

describe("claimed jobs, before anything runs", () => {
  test("parseClaimedJob reads the wire shape", () => {
    const parsed: ClaimedJob | null = parseClaimedJob({
      jobId: "job-7",
      origin: "AiRemediation",
      stepId: "step-7",
      stepType: "ResourceCommand",
      timeoutInMs: 45_000,
      leaseExpiresAt: "2026-09-28T12:00:30.000Z",
      payload: { program: "docker", args: ["ps"] },
    });

    assert.ok(parsed);
    assert.strictEqual(parsed.jobId, "job-7");
    assert.strictEqual(parsed.origin, "AiRemediation");
    assert.strictEqual(parsed.stepId, "step-7");
    assert.strictEqual(parsed.stepType, RESOURCE_COMMAND_STEP_TYPE);
    assert.strictEqual(parsed.timeoutInMs, 45_000);
    assert.strictEqual(parsed.leaseExpiresAt, "2026-09-28T12:00:30.000Z");
    assert.deepStrictEqual(parsed.payload, { program: "docker", args: ["ps"] });
  });

  test("a job without a job id cannot be run or reported", () => {
    assert.strictEqual(parseClaimedJob(null), null);
    assert.strictEqual(parseClaimedJob("job"), null);
    assert.strictEqual(parseClaimedJob({ origin: "AiInvestigation" }), null);
    assert.strictEqual(parseClaimedJob({ jobId: "  " }), null);
  });

  test("a missing payload is an empty one (refused later for having no command)", () => {
    assert.deepStrictEqual(
      parseClaimedJob({ jobId: "j", payload: [1] })!.payload,
      {},
    );
  });

  test("the time budget: the server's, at most 2 minutes, 30s when it makes no sense", () => {
    assert.strictEqual(normalizeJobTimeout(45_000), 45_000);
    assert.strictEqual(normalizeJobTimeout(10 * 60_000), 120_000);
    assert.strictEqual(normalizeJobTimeout(0.5), 1);
    assert.strictEqual(normalizeJobTimeout(undefined), 30_000);
    assert.strictEqual(normalizeJobTimeout(-1), 30_000);
    assert.strictEqual(normalizeJobTimeout("60000"), 30_000);
    assert.strictEqual(normalizeJobTimeout(Number.NaN), 30_000);
  });

  test("only resource commands, only for OneUptime AI, only for this resource type, never with a credential", () => {
    const type: AiResourceType = AiResourceType.DockerHost;

    assert.strictEqual(getJobRefusal(job(), type), null);
    assert.strictEqual(
      getJobRefusal(job({ origin: "AiRemediation" }), type),
      null,
    );

    assert.match(
      getJobRefusal(job({ stepType: "Kubectl" }), type)!,
      /^Refused by the Docker AI agent: it only runs resource commands, and this job is a "Kubectl" step\.$/,
    );
    assert.match(
      getJobRefusal(job({ stepType: undefined }), type)!,
      /"\(unknown\)" step/,
    );
    assert.match(
      getJobRefusal(job({ origin: "Runbook" }), type)!,
      /only runs commands for OneUptime AI investigations and fixes, and this job came from "Runbook"/,
    );

    for (const field of JOB_CREDENTIAL_FIELDS) {
      assert.match(
        getJobRefusal(job({ [field]: "cred-1" }), type)!,
        /carries a credential, but this agent only uses the credentials of its own environment/,
        field,
      );
    }

    for (const field of PAYLOAD_CREDENTIAL_FIELDS) {
      assert.match(
        getJobRefusal(job({ payload: testPayload({ [field]: "x" }) }), type)!,
        /carries a credential/,
        field,
      );
    }

    // Null or empty credential fields are the server saying "none".
    assert.strictEqual(
      getJobRefusal(job({ credentialId: null, credential: "" }), type),
      null,
    );

    assert.match(
      getJobRefusal(
        job({ payload: testPayload({ resourceType: "CephCluster" }) }),
        type,
      )!,
      /this command is for a Ceph cluster resource, and this agent serves a Docker host/,
    );
    assert.match(
      getJobRefusal(
        job({ payload: testPayload({ resourceType: "Nope" }) }),
        type,
      )!,
      /this command is for a "Nope" resource/,
    );
    assert.match(
      getJobRefusal(job({ payload: {} }), type)!,
      /"\(not specified\)" resource/,
    );
    // The same job, for an agent of another type, is refused in its words.
    assert.match(
      getJobRefusal(job(), AiResourceType.PodmanHost)!,
      /^Refused by the Podman AI agent: this command is for a Docker host resource, and this agent serves a Podman host\.$/,
    );
  });

  test("result retries back off 0.5s, 1s, 2s, 4s, 8s, 8s", () => {
    assert.deepStrictEqual(
      [1, 2, 3, 4, 5, 6].map((n: number): number => {
        return getResultRetryDelayMs(n);
      }),
      [500, 1_000, 2_000, 4_000, 8_000, 8_000],
    );
    assert.strictEqual(DEFAULT_JOB_TIMINGS.resultMaxAttempts, 6);
    assert.strictEqual(DEFAULT_JOB_TIMINGS.leaseMs, 30_000);
    assert.strictEqual(DEFAULT_JOB_TIMINGS.jobHeartbeatIntervalMs, 10_000);
    assert.strictEqual(DEFAULT_JOB_TIMINGS.preSpawnHeartbeatTimeoutMs, 5_000);
  });
});

interface RefusalCase {
  name: string;
  job: Record<string, unknown>;
  env?: Record<string, string>;
  message: RegExp;
}

describe("the job loop", () => {
  let server: FakeOneUptime;
  let docker: FakeBinary;
  let tmpDir: string;
  let status: AgentStatus;
  let session: AgentSession;
  let identity: AgentIdentity;
  let sleeper: RecordingSleep;
  let logs: CapturedLogs;
  const loops: Array<JobLoop> = [];

  before(async (): Promise<void> => {
    server = new FakeOneUptime();
    await server.start();
    docker = new FakeBinary("docker");
    tmpDir = makeTempDir("agent-jobloop-");
  });

  after(async (): Promise<void> => {
    await server.stop();
    docker.cleanup();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async (): Promise<void> => {
    server.reset();
    docker.clearInvocations();
    docker.setBehaviour({ stdout: "CONTAINER ID   NAMES\n3f2a   web-1\n" });
    status = new AgentStatus();
    sleeper = recordingSleep();
    logs = captureLogs();
    session = new AgentSession({
      client: new IngestClient({ oneuptimeUrl: server.url, apiKey: "k" }),
      config: testConfig(server.url),
      status,
      getPosture: (): Promise<AgentPosture> => {
        return Promise.resolve(POSTURE);
      },
      sleep: sleeper.sleep,
    });
    identity = (await session.ensureRegistered())!;
    server.reset();
  });

  afterEach(async (): Promise<void> => {
    logs.restore();
    for (const loop of loops.splice(0)) {
      await loop.stop(5_000);
    }
    await session.stop();
  });

  function executor(
    env: Record<string, string> = {},
    behaviour: FakeExecutorBehaviour = {},
  ): FakeExecutor {
    const config: AgentConfig = testConfig(server.url, env);

    return new FakeExecutor(
      {
        config,
        env: { ...testEnv(server.url, env), PATH: docker.getPath() },
        tmpDir,
        logger: recordingLogger(),
      },
      {
        guardPolicy: fakePolicy(POLICY_TABLE),
        spawnBinary: "docker",
        ...behaviour,
      },
    );
  }

  function loop(
    options: {
      executor?: FakeExecutor;
      timings?: Partial<JobTimings>;
      pollIntervalMs?: number;
    } = {},
  ): JobLoop {
    const created: JobLoop = new JobLoop({
      client: new IngestClient({ oneuptimeUrl: server.url, apiKey: "k" }),
      session,
      executor: options.executor || executor(),
      resourceType: AiResourceType.DockerHost,
      status,
      pollIntervalMs: options.pollIntervalMs ?? 60_000,
      timings: options.timings,
      sleep: sleeper.sleep,
    });
    loops.push(created);
    return created;
  }

  function routes(): Array<string> {
    return server.requests.map((request: RecordedRequest): string => {
      return request.route;
    });
  }

  function resultBodies(): Array<Record<string, unknown>> {
    return server
      .requestsTo("/job/:id/result")
      .map((request: RecordedRequest): Record<string, unknown> => {
        const { agentId, agentKey, ...rest } = request.body;
        assert.strictEqual(agentId, identity.agentId);
        assert.strictEqual(agentKey, identity.agentKey);
        return rest;
      });
  }

  test("no identity, no claim", async () => {
    await session.stop();
    const fresh: AgentSession = new AgentSession({
      client: new IngestClient({ oneuptimeUrl: server.url, apiKey: "k" }),
      config: testConfig(server.url),
      status,
      getPosture: (): Promise<AgentPosture> => {
        return Promise.resolve(POSTURE);
      },
    });
    const idle: JobLoop = new JobLoop({
      client: new IngestClient({ oneuptimeUrl: server.url, apiKey: "k" }),
      session: fresh,
      executor: executor(),
      resourceType: AiResourceType.DockerHost,
      status,
      pollIntervalMs: 60_000,
    });

    assert.strictEqual(await idle.tick(), false);
    assert.deepStrictEqual(server.requests, []);
  });

  test("an empty queue: one claim, nothing else", async () => {
    assert.strictEqual(await loop().tick(), false);

    assert.deepStrictEqual(routes(), ["/claim-next-job"]);
    assert.deepStrictEqual(server.requests[0]!.body, {
      agentId: "agent-1",
      agentKey: "key-1",
    });
  });

  test("success: claim, pre-spawn heartbeat, the program, result with exit code and output", async () => {
    server.script("/claim-next-job", jobReply({}));
    const fake: FakeExecutor = executor();

    assert.strictEqual(await loop({ executor: fake }).tick(), true);

    assert.deepStrictEqual(routes(), [
      "/claim-next-job",
      "/job/job-1/heartbeat",
      "/job/job-1/result",
    ]);
    assert.deepStrictEqual(resultBodies(), [
      {
        success: true,
        output: "[stdout]\nCONTAINER ID   NAMES\n3f2a   web-1\n",
        exitCode: 0,
      },
    ]);

    const [invocation] = docker.getInvocations();
    assert.deepStrictEqual(invocation!.argv, ["ps"]);
    // The executor was told which resource id the agent registered for.
    assert.strictEqual(fake.prepared[0]!.agentResourceId, TEST_RESOURCE_ID);
    assert.strictEqual(fake.prepared[0]!.timeoutInMs, 30_000);
    assert.strictEqual(fake.prepared[0]!.origin, "AiInvestigation");
    assert.strictEqual(status.jobsRun, 1);
    assert.strictEqual(status.runningJobId, null);
    assert.ok(status.lastJobAt);
  });

  test("a failure is reported with its exit code and reason", async () => {
    docker.setBehaviour({
      stderr: "Error response from daemon: No such container: web-9\n",
      exitCode: 1,
    });
    server.script("/claim-next-job", jobReply({}));

    await loop().tick();

    assert.deepStrictEqual(resultBodies(), [
      {
        success: false,
        output:
          "[stderr]\nError response from daemon: No such container: web-9\n",
        exitCode: 1,
        errorMessage:
          "Exit code 1: Error response from daemon: No such container: web-9",
      },
    ]);
  });

  test("secrets in the output are redacted before they leave the agent", async () => {
    docker.setBehaviour({
      stdout: '"Env": [\n  "DB_PASSWORD=hunter2hunter2",\n  "MODE=prod"\n]\n',
    });
    server.script("/claim-next-job", jobReply({}));

    await loop().tick();

    const output: string = String(resultBodies()[0]!["output"]);
    assert.ok(!output.includes("hunter2"), output);
    assert.match(output, /DB_PASSWORD=\[redacted\]/);
  });

  test("lease lost before running: nothing runs, and the result says it did not run", async () => {
    server.script("/claim-next-job", jobReply({}));
    server.script("/job/:id/heartbeat", {
      status: 404,
      json: { message: "This job is not yours." },
    });

    await loop().tick();

    assert.strictEqual(docker.getInvocations().length, 0);
    assert.deepStrictEqual(resultBodies(), [
      { success: false, output: "", errorMessage: NOT_RUN_LEASE_LOST_MESSAGE },
    ]);
  });

  test("a pre-spawn heartbeat with no usable answer does not stop the command", async () => {
    for (const reply of [
      { status: 503, raw: "<h1>503</h1>" },
      { hang: true },
    ]) {
      server.reset();
      docker.clearInvocations();
      server.script("/claim-next-job", jobReply({}));
      server.script("/job/:id/heartbeat", reply);

      await loop({ timings: { preSpawnHeartbeatTimeoutMs: 200 } }).tick();

      assert.strictEqual(
        docker.getInvocations().length,
        1,
        JSON.stringify(reply),
      );
      assert.strictEqual(resultBodies()[0]!["success"], true);
    }
  });

  test("a write from a remediation on a writable agent runs", async () => {
    server.script(
      "/claim-next-job",
      jobReply({
        origin: "AiRemediation",
        payload: testPayload({
          args: ["restart", "web-1"],
          displayCommand: "docker restart web-1",
          tier: "SafeWrite",
        }),
      }),
    );

    await loop({
      executor: executor({ ONEUPTIME_AI_ALLOW_WRITES: "true" }),
    }).tick();

    assert.deepStrictEqual(docker.getInvocations()[0]!.argv, [
      "restart",
      "web-1",
    ]);
    assert.strictEqual(resultBodies()[0]!["success"], true);
  });

  describe("every local refusal: reported, and nothing runs", () => {
    const cases: Array<RefusalCase> = [
      {
        name: "a Kubernetes step",
        job: { stepType: "Kubectl" },
        message: /only runs resource commands/,
      },
      {
        name: "a runbook job",
        job: { origin: "Runbook" },
        message: /only runs commands for OneUptime AI/,
      },
      {
        name: "a job carrying a credential",
        job: { credentialId: "cred-1" },
        message: /carries a credential/,
      },
      {
        name: "a job for another resource type",
        job: { payload: testPayload({ resourceType: "PodmanHost" }) },
        message: /this command is for a Podman host resource/,
      },
      {
        name: "no command",
        job: { payload: testPayload({ program: undefined, args: undefined }) },
        message: /without a command to run/,
      },
      {
        name: "another host's command",
        job: { payload: testPayload({ resourceIdentifier: "web-host-2" }) },
        message:
          /this command is for Docker host "web-host-2", but this agent serves "web-host-1"/,
      },
      {
        name: "another resource id",
        job: { payload: testPayload({ resourceId: "someone-else" }) },
        message: /this agent is registered for "8d6f1c9e/,
      },
      {
        name: "a program this resource type does not run",
        job: {
          payload: testPayload({ program: "ceph", args: ["health"] }),
        },
        message: /"ceph" is not a program the Docker AI agent runs/,
      },
      {
        name: "a command the policy denies",
        job: {
          origin: "AiRemediation",
          payload: testPayload({ args: ["exec", "web-1", "sh"] }),
        },
        env: { ONEUPTIME_AI_ALLOW_WRITES: "true" },
        message: /not in the fake policy's table/,
      },
      {
        name: "a write from an investigation",
        job: {
          payload: testPayload({
            args: ["restart", "web-1"],
            tier: "SafeWrite",
          }),
        },
        env: { ONEUPTIME_AI_ALLOW_WRITES: "true" },
        message: /an investigation may only run read-only commands/,
      },
      {
        name: "a write the server sent as a read",
        job: {
          origin: "AiRemediation",
          payload: testPayload({ args: ["restart", "web-1"], tier: "Read" }),
        },
        env: { ONEUPTIME_AI_ALLOW_WRITES: "true" },
        message:
          /OneUptime sent "docker restart web-1" as Read, but this agent's policy reads it as SafeWrite/,
      },
      {
        name: "a write on a read-only agent",
        job: {
          origin: "AiRemediation",
          payload: testPayload({
            args: ["restart", "web-1"],
            tier: "SafeWrite",
          }),
        },
        message:
          /read-only \(ONEUPTIME_AI_ALLOW_WRITES is not set\).*ONEUPTIME_AI_ALLOW_WRITES=true/,
      },
      {
        name: "a write outside the allowed targets",
        job: {
          origin: "AiRemediation",
          payload: testPayload({
            args: ["restart", "api-1"],
            tier: "SafeWrite",
          }),
        },
        env: {
          ONEUPTIME_AI_ALLOW_WRITES: "true",
          ONEUPTIME_AI_WRITE_TARGETS: "web-*",
        },
        message:
          /outside the targets the Docker AI agent may change \(ONEUPTIME_AI_WRITE_TARGETS=web-\*\)/,
      },
      {
        name: "a write to a protected target",
        job: {
          origin: "AiRemediation",
          payload: testPayload({
            args: ["restart", "oneuptime-docker-ai-agent"],
            tier: "SafeWrite",
          }),
        },
        env: {
          ONEUPTIME_AI_ALLOW_WRITES: "true",
          ONEUPTIME_AI_PROTECTED_TARGETS: "oneuptime-docker-*",
        },
        message: /which the Docker AI agent protects/,
      },
    ];

    cases.forEach((refusal: RefusalCase): void => {
      test(refusal.name, async () => {
        server.script("/claim-next-job", jobReply(refusal.job));

        await loop({ executor: executor(refusal.env) }).tick();

        assert.strictEqual(docker.getInvocations().length, 0);
        // A refusal needs no lease check: nothing is about to run.
        assert.deepStrictEqual(routes(), [
          "/claim-next-job",
          "/job/job-1/result",
        ]);
        const [result] = resultBodies();
        assert.strictEqual(result!["success"], false);
        assert.strictEqual(result!["output"], "");
        assert.strictEqual(result!["exitCode"], undefined);
        assert.match(String(result!["errorMessage"]), refusal.message);
        assert.match(String(result!["errorMessage"]), /^Refused by the /);
      });
    });
  });

  test("an executor that throws is reported, not fatal", async () => {
    server.script("/claim-next-job", jobReply({}));
    const broken: FakeExecutor = executor();
    broken.prepare = (): never => {
      throw new Error("executor exploded");
    };

    assert.strictEqual(await loop({ executor: broken }).tick(), true);
    assert.deepStrictEqual(resultBodies(), [
      { success: false, output: "", errorMessage: "executor exploded" },
    ]);
  });

  test("a result without an exit code (the program was killed) carries none", async () => {
    server.script("/claim-next-job", jobReply({}));

    await loop({
      executor: executor(
        {},
        {
          guardPolicy: undefined,
          spawnBinary: undefined,
          result: {
            success: false,
            output: "partial",
            exitCode: null,
            errorMessage: "Killed (timeout 30000ms)",
          },
        },
      ),
    }).tick();

    assert.deepStrictEqual(resultBodies(), [
      {
        success: false,
        output: "partial",
        errorMessage: "Killed (timeout 30000ms)",
      },
    ]);
  });

  test("result delivery is retried with backoff, and the same result is resent", async () => {
    server.script("/claim-next-job", jobReply({}));
    server.script(
      "/job/:id/result",
      { status: 503, raw: "<h1>503</h1>" },
      { destroy: true },
    );

    await loop().tick();

    const bodies: Array<Record<string, unknown>> = resultBodies();
    assert.strictEqual(bodies.length, 3);
    assert.deepStrictEqual(bodies[0], bodies[2]);
    assert.strictEqual(bodies[2]!["exitCode"], 0);
    assert.deepStrictEqual(sleeper.delays, [500, 1_000]);
  });

  test("delivery gives up after 6 attempts", async () => {
    server.script("/claim-next-job", jobReply({}));
    server.setDefault("/job/:id/result", { status: 502, raw: "bad gateway" });

    await loop({ timings: { leaseMs: 10 * 60_000 } }).tick();

    assert.strictEqual(resultBodies().length, 6);
    assert.deepStrictEqual(sleeper.delays, [500, 1_000, 2_000, 4_000, 8_000]);
    assert.ok(
      logs.messages("error").some((message: string): boolean => {
        return message.includes("after 6 attempts");
      }),
    );
  });

  test("delivery is bounded by the lease the agent last had confirmed", async () => {
    /*
     * A refused job, so the result is delivered at once: with 1.8s of lease
     * the retries after 0.5s and 1s fit, the 2s one does not.
     */
    server.script("/claim-next-job", jobReply({ stepType: "Bash" }));
    server.setDefault("/job/:id/result", { status: 503, json: {} });

    await loop({ timings: { leaseMs: 1_800 } }).tick();

    assert.strictEqual(resultBodies().length, 3);
    assert.deepStrictEqual(sleeper.delays, [500, 1_000]);
    assert.ok(
      logs.messages("error").some((message: string): boolean => {
        return message.includes("ends before another attempt");
      }),
    );
  });

  test("a refused result is not retried", async () => {
    server.script("/claim-next-job", jobReply({}));
    server.script("/job/:id/result", {
      status: 400,
      json: { message: "Bad result" },
    });

    await loop().tick();

    assert.strictEqual(resultBodies().length, 1);
    assert.deepStrictEqual(sleeper.delays, []);
  });

  test("accepted:false is logged, not retried", async () => {
    server.script("/claim-next-job", jobReply({}));
    server.script("/job/:id/result", { json: { accepted: false } });

    await loop().tick();

    assert.strictEqual(resultBodies().length, 1);
    assert.ok(
      logs.messages("error").some((message: string): boolean => {
        return message.includes("did not store this job's result");
      }),
    );
  });

  test("job heartbeats keep the lease alive while a command runs", async () => {
    docker.setBehaviour({ stdout: "slow\n", sleepMs: 700 });
    server.script("/claim-next-job", jobReply({}));

    await loop({ timings: { jobHeartbeatIntervalMs: 100 } }).tick();

    // The pre-spawn heartbeat plus several in the background.
    assert.ok(server.requestsTo("/job/:id/heartbeat").length >= 3);
    assert.strictEqual(resultBodies()[0]!["success"], true);
  });

  test("a lease lost while running stops result retries", async () => {
    docker.setBehaviour({ stdout: "slow\n", sleepMs: 600 });
    server.script("/claim-next-job", jobReply({}));
    // The pre-spawn heartbeat is fine; every later one says "not yours".
    server.script("/job/:id/heartbeat", { json: { status: "ok" } });
    server.setDefault("/job/:id/heartbeat", {
      status: 404,
      json: { message: "Lease expired." },
    });
    server.setDefault("/job/:id/result", { status: 503, json: {} });

    await loop({
      timings: { jobHeartbeatIntervalMs: 100, leaseMs: 10 * 60_000 },
    }).tick();

    assert.strictEqual(resultBodies().length, 1);
    assert.ok(
      logs.messages("error").some((message: string): boolean => {
        return message.includes("is gone");
      }),
    );
  });

  test("rejected claims hand the identity back for re-registration after three", async () => {
    server.setDefault("/claim-next-job", {
      status: 401,
      json: { message: "Invalid agent id or key." },
    });
    server.script("/register", {
      json: { agentId: "agent-1", agentKey: "key-2" },
    });
    const jobs: JobLoop = loop();

    await jobs.tick();
    await jobs.tick();
    assert.strictEqual(server.requestsTo("/register").length, 0);
    await jobs.tick();

    await eventually((): boolean => {
      return session.getIdentity()?.agentKey === "key-2";
    });
    assert.strictEqual(
      server.requestsTo("/register")[0]!.body["previousAgentKey"],
      "key-1",
    );
  });

  test("a transient claim failure is logged once and does not touch the identity", async () => {
    server.setDefault("/claim-next-job", { status: 503, raw: "<h1>503</h1>" });
    const jobs: JobLoop = loop();

    for (let i: number = 0; i < 4; i++) {
      assert.strictEqual(await jobs.tick(), false);
    }

    assert.strictEqual(session.getIdentity(), identity);
    assert.match(status.lastError!, /HTTP 503/);
    assert.strictEqual(
      logs.messages("warn").filter((message: string): boolean => {
        return message.startsWith("Could not ask OneUptime for work");
      }).length,
      1,
    );
  });

  test("a claim answer without a job id is skipped", async () => {
    server.script("/claim-next-job", {
      json: { job: { origin: "AiInvestigation" } },
    });

    assert.strictEqual(await loop().tick(), false);
    assert.deepStrictEqual(routes(), ["/claim-next-job"]);
  });

  test("one job at a time: no claim while a job runs, and the next claim comes straight after", async () => {
    docker.setBehaviour({ stdout: "ok\n", sleepMs: 400 });
    server.script(
      "/claim-next-job",
      jobReply({ jobId: "job-a" }),
      jobReply({ jobId: "job-b" }),
    );
    const jobs: JobLoop = loop({ pollIntervalMs: 60_000 });

    jobs.start();

    await server.waitFor("/job/:id/result", 2, 10_000);
    const order: Array<string> = routes().filter((route: string): boolean => {
      return route === "/claim-next-job" || route.endsWith("/result");
    });
    assert.deepStrictEqual(order.slice(0, 4), [
      "/claim-next-job",
      "/job/job-a/result",
      "/claim-next-job",
      "/job/job-b/result",
    ]);
    // After job-b, one more (empty) claim, then the poll interval.
    await eventually((): boolean => {
      return server.requestsTo("/claim-next-job").length === 3;
    });
    await realSleep(200);
    assert.strictEqual(server.requestsTo("/claim-next-job").length, 3);
  });

  test("stop() waits for the job in progress and its result", async () => {
    docker.setBehaviour({ stdout: "ok\n", sleepMs: 400 });
    server.script("/claim-next-job", jobReply({}));
    const jobs: JobLoop = loop();

    const ticking: Promise<boolean> = jobs.tick();
    await server.waitFor("/job/:id/heartbeat");

    assert.strictEqual(await jobs.stop(10_000), true);
    assert.strictEqual(resultBodies().length, 1);
    assert.strictEqual(resultBodies()[0]!["success"], true);
    assert.strictEqual(await ticking, true);
  });

  test("stop() gives up waiting after the grace period", async () => {
    docker.setBehaviour({ stdout: "ok\n", sleepMs: 2_000 });
    server.script("/claim-next-job", jobReply({}));
    const jobs: JobLoop = loop();

    void jobs.tick();
    await server.waitFor("/job/:id/heartbeat");

    const started: number = Date.now();
    assert.strictEqual(await jobs.stop(100), false);
    assert.ok(Date.now() - started < 1_000);
  });

  test("a job claimed while shutting down is reported as not run", async () => {
    server.script("/claim-next-job", { ...jobReply({}), delayMs: 300 });
    const jobs: JobLoop = loop();

    const ticking: Promise<boolean> = jobs.tick();
    await server.waitFor("/claim-next-job");
    await jobs.stop(5_000);
    await ticking;

    assert.strictEqual(docker.getInvocations().length, 0);
    assert.deepStrictEqual(resultBodies(), [
      {
        success: false,
        output: "",
        errorMessage: NOT_RUN_SHUTTING_DOWN_MESSAGE,
      },
    ]);
  });

  test("nothing is claimed after stop()", async () => {
    const jobs: JobLoop = loop({ pollIntervalMs: 20 });
    jobs.start();
    await server.waitFor("/claim-next-job", 2);

    await jobs.stop(1_000);
    const claims: number = server.requestsTo("/claim-next-job").length;
    await realSleep(150);

    assert.strictEqual(server.requestsTo("/claim-next-job").length, claims);
    assert.strictEqual(await jobs.tick(), false);
  });
});
