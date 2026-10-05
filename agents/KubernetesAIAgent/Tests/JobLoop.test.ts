import {
  CapturedLogs,
  RecordingSleep,
  captureLogs,
  eventually,
  realSleep,
  recordingSleep,
  testConfig,
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
import IngestClient from "../IngestClient";
import JobLoop, {
  ClaimedJob,
  DEFAULT_JOB_TIMINGS,
  JobTimings,
  NOT_RUN_LEASE_LOST_MESSAGE,
  NOT_RUN_SHUTTING_DOWN_MESSAGE,
  getJobRefusal,
  getResultRetryDelayMs,
  normalizeJobTimeout,
  parseClaimedJob,
} from "../JobLoop";
import KubectlExecutor, { KubectlExecutorSettings } from "../KubectlExecutor";
import { AgentPosture } from "../Posture";
import { AgentIdentity, AgentSession } from "../Registration";
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
 * The claim loop end to end: a local OneUptime hands out jobs, a fake
 * kubectl runs them, and the tests read what came back to the server.
 */

const POSTURE: AgentPosture = {
  clusterIdentifier: "prod-us",
  inCluster: true,
  allowWrites: false,
  allowNodeOperations: false,
  writeNamespaces: [],
  aiSettings: { investigation: true, fixes: "Disabled", isConfigured: false },
};

interface RefusalCase {
  name: string;
  job: Record<string, unknown>;
  settings?: Partial<KubectlExecutorSettings>;
  message: RegExp;
}

function job(overrides: Record<string, unknown> = {}): ClaimedJob {
  return parseClaimedJob({
    jobId: "job-1",
    origin: "AiInvestigation",
    stepId: "step-1",
    stepType: "Kubectl",
    timeoutInMs: 30_000,
    payload: {
      args: ["get", "pods", "-n", "web"],
      clusterIdentifier: "prod-us",
    },
    ...overrides,
  })!;
}

describe("claimed jobs, before anything runs", () => {
  test("parseClaimedJob reads the wire shape", () => {
    const parsed: ClaimedJob | null = parseClaimedJob({
      jobId: "job-7",
      origin: "AiRemediation",
      stepId: "step-7",
      stepType: "Kubectl",
      timeoutInMs: 45_000,
      leaseExpiresAt: "2026-09-28T12:00:30.000Z",
      payload: { args: ["get", "pods"] },
    });

    assert.ok(parsed);
    assert.strictEqual(parsed.jobId, "job-7");
    assert.strictEqual(parsed.origin, "AiRemediation");
    assert.strictEqual(parsed.stepId, "step-7");
    assert.strictEqual(parsed.timeoutInMs, 45_000);
    assert.strictEqual(parsed.leaseExpiresAt, "2026-09-28T12:00:30.000Z");
    assert.deepStrictEqual(parsed.payload, { args: ["get", "pods"] });
  });

  test("a job without a job id cannot be run or reported", () => {
    assert.strictEqual(parseClaimedJob(null), null);
    assert.strictEqual(parseClaimedJob("job"), null);
    assert.strictEqual(parseClaimedJob({ origin: "AiInvestigation" }), null);
    assert.strictEqual(parseClaimedJob({ jobId: "  " }), null);
  });

  test("a missing payload is an empty one (refused later for having no argv)", () => {
    assert.deepStrictEqual(
      parseClaimedJob({ jobId: "j", payload: [1] })!.payload,
      {},
    );
  });

  test("the time budget: the server's, at most 2 minutes, 30s when it makes no sense", () => {
    assert.strictEqual(normalizeJobTimeout(45_000), 45_000);
    assert.strictEqual(normalizeJobTimeout(10 * 60_000), 120_000);
    assert.strictEqual(normalizeJobTimeout(undefined), 30_000);
    assert.strictEqual(normalizeJobTimeout(-1), 30_000);
    assert.strictEqual(normalizeJobTimeout("60000"), 30_000);
    assert.strictEqual(normalizeJobTimeout(Number.NaN), 30_000);
  });

  test("only kubectl, only for OneUptime AI, never with a credential", () => {
    assert.strictEqual(getJobRefusal(job()), null);
    assert.strictEqual(getJobRefusal(job({ origin: "AiRemediation" })), null);

    assert.match(
      getJobRefusal(job({ stepType: "Bash" }))!,
      /only runs kubectl commands, and this job is a "Bash" step/,
    );
    assert.match(
      getJobRefusal(job({ stepType: undefined }))!,
      /"\(unknown\)" step/,
    );
    assert.match(
      getJobRefusal(job({ origin: "Runbook" }))!,
      /only runs commands for OneUptime AI investigations and fixes, and this job came from "Runbook"/,
    );

    for (const credential of [
      { credential: { apiServerUrl: "https://x", token: "t" } },
      { credentialId: "cred-1" },
      { kubernetesCredentialId: "cred-1" },
    ]) {
      assert.match(
        getJobRefusal(job(credential))!,
        /carries a Kubernetes credential, but this agent only uses its own ServiceAccount/,
        JSON.stringify(credential),
      );
    }

    for (const field of [
      "credentialId",
      "apiServerUrl",
      "token",
      "kubeconfig",
    ]) {
      assert.match(
        getJobRefusal(
          job({
            payload: {
              args: ["get", "pods"],
              clusterIdentifier: "prod-us",
              [field]: "x",
            },
          }),
        )!,
        /carries a Kubernetes credential/,
        field,
      );
    }

    // Null or empty credential fields are the server saying "none".
    assert.strictEqual(
      getJobRefusal(job({ credentialId: null, credential: "" })),
      null,
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

describe("the job loop", () => {
  let server: FakeOneUptime;
  let kubectl: FakeKubectl;
  let serviceAccount: FakeServiceAccount;
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
    kubectl = new FakeKubectl();
    serviceAccount = new FakeServiceAccount({ namespace: "oneuptime-agent" });
    tmpDir = makeTempDir("agent-jobloop-");
  });

  after(async (): Promise<void> => {
    await server.stop();
    kubectl.cleanup();
    serviceAccount.cleanup();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async (): Promise<void> => {
    server.reset();
    kubectl.clearInvocations();
    kubectl.setBehaviour({ stdout: "NAME READY\nweb-1 1/1\n" });
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
    overrides: Partial<KubectlExecutorSettings> = {},
  ): KubectlExecutor {
    return new KubectlExecutor({
      clusterName: "prod-us",
      allowWrites: false,
      allowWritesSetting: null,
      allowNodeOperations: false,
      allowNodeOperationsSetting: null,
      writeNamespaces: [],
      podNamespace: "oneuptime-agent",
      env: {
        PATH: kubectl.getPath(),
        KUBERNETES_SERVICE_HOST: "10.96.0.1",
        KUBERNETES_SERVICE_PORT: "443",
      },
      serviceAccount: serviceAccount.paths(),
      tmpDir,
      ...overrides,
    });
  }

  function loop(
    options: {
      executor?: KubectlExecutor;
      timings?: Partial<JobTimings>;
      pollIntervalMs?: number;
    } = {},
  ): JobLoop {
    const created: JobLoop = new JobLoop({
      client: new IngestClient({ oneuptimeUrl: server.url, apiKey: "k" }),
      session,
      executor: options.executor || executor(),
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

  test("success: claim, pre-spawn heartbeat, kubectl, result with exit code and output", async () => {
    server.script("/claim-next-job", jobReply({}));

    assert.strictEqual(await loop().tick(), true);

    assert.deepStrictEqual(routes(), [
      "/claim-next-job",
      "/job/job-1/heartbeat",
      "/job/job-1/result",
    ]);
    assert.deepStrictEqual(resultBodies(), [
      {
        success: true,
        output: "[stdout]\nNAME READY\nweb-1 1/1\n",
        exitCode: 0,
      },
    ]);

    const invocations: Array<FakeKubectlInvocation> =
      kubectl.getCommandInvocations();
    assert.strictEqual(invocations.length, 1);
    assert.deepStrictEqual(invocations[0]!.argv.slice(2), [
      "--request-timeout=24s",
      "get",
      "pods",
      "-n",
      "web",
    ]);
    assert.strictEqual(status.jobsRun, 1);
    assert.strictEqual(status.runningJobId, null);
    assert.ok(status.lastJobAt);
  });

  test("a kubectl failure is reported with its exit code and reason", async () => {
    kubectl.setBehaviour({
      stderr: 'Error from server (NotFound): pods "x" not found\n',
      exitCode: 1,
    });
    server.script("/claim-next-job", jobReply({}));

    await loop().tick();

    assert.deepStrictEqual(resultBodies(), [
      {
        success: false,
        output: '[stderr]\nError from server (NotFound): pods "x" not found\n',
        exitCode: 1,
        errorMessage:
          'Exit code 1: Error from server (NotFound): pods "x" not found',
      },
    ]);
  });

  test("lease lost before spawning: kubectl never runs, and the result says it did not run", async () => {
    server.script("/claim-next-job", jobReply({}));
    server.script("/job/:id/heartbeat", {
      status: 404,
      json: { message: "This job is not yours." },
    });

    await loop().tick();

    assert.strictEqual(kubectl.getCommandInvocations().length, 0);
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
      kubectl.clearInvocations();
      server.script("/claim-next-job", jobReply({}));
      server.script("/job/:id/heartbeat", reply);

      await loop({ timings: { preSpawnHeartbeatTimeoutMs: 200 } }).tick();

      assert.strictEqual(
        kubectl.getCommandInvocations().length,
        1,
        JSON.stringify(reply),
      );
      assert.strictEqual(resultBodies()[0]!["success"], true);
    }
  });

  describe("every local refusal: reported, and nothing spawns", () => {
    const cases: Array<RefusalCase> = [
      {
        name: "a non-kubectl step",
        job: { stepType: "Bash" },
        message: /only runs kubectl commands/,
      },
      {
        name: "a runbook job",
        job: { origin: "Runbook" },
        message: /only runs commands for OneUptime AI/,
      },
      {
        name: "a job carrying a credential",
        job: { credentialId: "cred-1" },
        message: /carries a Kubernetes credential/,
      },
      {
        name: "no argv",
        job: { payload: { clusterIdentifier: "prod-us" } },
        message: /without a kubectl command/,
      },
      {
        name: "the argv guard",
        job: {
          payload: {
            args: ["get", "pods", "--kubeconfig=/tmp/other"],
            clusterIdentifier: "prod-us",
          },
        },
        message: /kubeconfig/,
      },
      {
        name: "a denied command",
        job: {
          origin: "AiRemediation",
          payload: {
            args: ["exec", "web-1", "--", "sh"],
            clusterIdentifier: "prod-us",
          },
        },
        settings: { allowWrites: true },
        message: /kubectl exec is not allowed/,
      },
      {
        name: "a write from an investigation",
        job: {
          payload: {
            args: ["delete", "pod", "web-1", "-n", "web"],
            clusterIdentifier: "prod-us",
          },
        },
        settings: { allowWrites: true },
        message: /an investigation may only run read-only kubectl/,
      },
      {
        name: "a write on a read-only agent",
        job: {
          origin: "AiRemediation",
          payload: {
            args: ["delete", "pod", "web-1", "-n", "web"],
            clusterIdentifier: "prod-us",
          },
        },
        message: /installed read-only.*aiAgent\.fixes=ask-for-approval/,
      },
      {
        name: "a write outside the allowed namespaces",
        job: {
          origin: "AiRemediation",
          payload: {
            args: ["delete", "pod", "api-1", "-n", "api"],
            clusterIdentifier: "prod-us",
          },
        },
        settings: { allowWrites: true, writeNamespaces: ["web"] },
        message: /outside the namespaces this agent lets OneUptime AI change/,
      },
      {
        name: "a node operation with node operations off",
        job: {
          origin: "AiRemediation",
          payload: { args: ["cordon", "node-1"], clusterIdentifier: "prod-us" },
        },
        settings: { allowWrites: true },
        message: /aiAgent\.remediation\.nodeOperations=true/,
      },
      {
        name: "another cluster's job",
        job: {
          payload: { args: ["get", "pods"], clusterIdentifier: "staging-eu" },
        },
        message: /this command is for cluster "staging-eu"/,
      },
      {
        name: "not running in a pod",
        job: {},
        settings: { env: { PATH: "/usr/bin" } },
        message: /KUBERNETES_SERVICE_HOST/,
      },
    ];

    cases.forEach((refusal: RefusalCase): void => {
      test(refusal.name, async () => {
        server.script("/claim-next-job", jobReply(refusal.job));

        await loop({ executor: executor(refusal.settings) }).tick();

        assert.strictEqual(kubectl.getCommandInvocations().length, 0);
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
      });
    });
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
     * A refused job, so the result is delivered at once (no kubectl start-up
     * time eats into the lease): with 1.8s of lease the retries after 0.5s
     * and 1s fit, the 2s one does not.
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
    kubectl.setBehaviour({ stdout: "slow\n", sleepMs: 700 });
    server.script("/claim-next-job", jobReply({}));

    await loop({ timings: { jobHeartbeatIntervalMs: 100 } }).tick();

    // The pre-spawn heartbeat plus several in the background.
    assert.ok(server.requestsTo("/job/:id/heartbeat").length >= 3);
    assert.strictEqual(resultBodies()[0]!["success"], true);
  });

  test("a lease lost while running stops result retries", async () => {
    kubectl.setBehaviour({ stdout: "slow\n", sleepMs: 600 });
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
    kubectl.setBehaviour({ stdout: "ok\n", sleepMs: 400 });
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
    kubectl.setBehaviour({ stdout: "ok\n", sleepMs: 400 });
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
    kubectl.setBehaviour({ stdout: "ok\n", sleepMs: 2_000 });
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

    assert.strictEqual(kubectl.getCommandInvocations().length, 0);
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
