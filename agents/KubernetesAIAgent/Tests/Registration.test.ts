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
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  test,
} from "node:test";
import AgentStatus from "../AgentStatus";
import { SleepFunction } from "../Sleep";
import IngestClient, { IngestResponse } from "../IngestClient";
import { AgentPosture } from "../Posture";
import {
  API_MISSING_MESSAGE,
  API_MISSING_RETRY_MS,
  AgentIdentity,
  AgentSession,
  OPERATOR_ACTION_RETRY_MS,
  REREGISTER_AFTER_REJECTIONS,
  RegistrationAttempt,
  RegistrationRetryPlan,
  TRANSIENT_REFUSAL_RETRY_MS,
  parseRegistration,
  planRegistrationRetry,
} from "../Registration";
import FakeOneUptime, {
  FakeReply,
  RecordedRequest,
} from "./Helpers/FakeOneUptime";

const POSTURE: AgentPosture = {
  clusterIdentifier: "prod-us",
  inCluster: true,
  allowWrites: false,
  allowNodeOperations: false,
  writeNamespaces: [],
  aiSettings: { investigation: true, fixes: "Disabled", isConfigured: false },
};

function response(overrides: Partial<IngestResponse>): IngestResponse {
  return {
    kind: "ok",
    status: 200,
    body: null,
    message: "",
    retryAfterSeconds: null,
    ...overrides,
  };
}

function plan(
  overrides: Partial<IngestResponse>,
  consecutiveFailures: number = 1,
): RegistrationRetryPlan {
  return planRegistrationRetry({
    response: response(overrides),
    consecutiveFailures,
  });
}

describe("the retry schedule", () => {
  test("transient failures: 30s, then 60s, capped at 60s", () => {
    const delays: Array<number> = [1, 2, 3, 4, 10].map((n: number): number => {
      return plan({ kind: "transient", status: 503, message: "HTTP 503" }, n)
        .delayMs;
    });

    assert.deepStrictEqual(delays, [30_000, 60_000, 60_000, 60_000, 60_000]);
    assert.strictEqual(
      plan({ kind: "transient", status: null }).category,
      "transient",
    );
  });

  test("a 429's Retry-After is honoured when longer, up to 5 minutes", () => {
    assert.strictEqual(
      plan({ kind: "transient", status: 429, retryAfterSeconds: 120 }).delayMs,
      120_000,
    );
    assert.strictEqual(
      plan({ kind: "transient", status: 429, retryAfterSeconds: 5 }).delayMs,
      30_000,
    );
    assert.strictEqual(
      plan({ kind: "transient", status: 429, retryAfterSeconds: 100_000 })
        .delayMs,
      5 * 60_000,
    );
  });

  for (const reason of ["previous_instance_online", "legacy_runner_online"]) {
    test(`403 ${reason}: Retry-After, else 20s — never a growing backoff`, () => {
      const refusal: Partial<IngestResponse> = {
        kind: "auth",
        status: 403,
        body: { reason, message: "wait" },
        message: "wait",
      };

      assert.strictEqual(TRANSIENT_REFUSAL_RETRY_MS, 20_000);
      assert.strictEqual(plan(refusal, 1).delayMs, 20_000);
      assert.strictEqual(plan(refusal, 9).delayMs, 20_000);
      assert.strictEqual(
        plan({ ...refusal, retryAfterSeconds: 7 }).delayMs,
        7_000,
      );
      assert.strictEqual(
        plan({ ...refusal, retryAfterSeconds: 0 }).delayMs,
        1_000,
      );
      assert.strictEqual(
        plan({ ...refusal, retryAfterSeconds: 2.2 }).delayMs,
        3_000,
      );
      assert.strictEqual(
        plan({ ...refusal, retryAfterSeconds: 3_600 }).delayMs,
        60_000,
      );
      assert.strictEqual(plan(refusal).category, "waiting");
      assert.strictEqual(plan(refusal).reason, reason);
    });
  }

  test("the legacy Runner wait says what it is waiting for", () => {
    assert.match(
      plan({
        kind: "auth",
        status: 403,
        body: { reason: "legacy_runner_online" },
        message: "The in-cluster Runner is online.",
      }).message,
      /previous in-cluster Runner to stop/,
    );
  });

  test("refusals an operator must fix: every 5 minutes, with the fix", () => {
    const nameInvalid: RegistrationRetryPlan = plan({
      kind: "auth",
      status: 403,
      body: { reason: "cluster_name_invalid" },
      message: "The cluster name is empty or too long.",
    });
    assert.strictEqual(nameInvalid.category, "refused");
    assert.strictEqual(nameInvalid.delayMs, OPERATOR_ACTION_RETRY_MS);
    assert.strictEqual(OPERATOR_ACTION_RETRY_MS, 5 * 60_000);
    assert.match(
      nameInvalid.message,
      /Fix clusterName on the Kubernetes agent chart/,
    );

    const cap: RegistrationRetryPlan = plan({
      kind: "auth",
      status: 403,
      body: { reason: "agent_cap_reached" },
      message: "This project has too many AI agents.",
    });
    assert.strictEqual(cap.delayMs, OPERATOR_ACTION_RETRY_MS);
    assert.match(cap.message, /too many AI agents/);

    // The ingest middleware's own refusals (pinned, revoked or bad key).
    for (const status of [401, 403]) {
      const keyRefused: RegistrationRetryPlan = plan({
        kind: "auth",
        status,
        body: { message: "This key is pinned to a service." },
        message: "This key is pinned to a service.",
      });
      assert.strictEqual(keyRefused.delayMs, OPERATOR_ACTION_RETRY_MS);
      assert.match(keyRefused.message, /oneuptime\.apiKey/);
    }

    assert.strictEqual(
      plan({ kind: "other", status: 400, message: "HTTP 400" }).delayMs,
      OPERATOR_ACTION_RETRY_MS,
    );
  });

  test("a server without the API: the exact message, every 5 minutes", () => {
    const missing: RegistrationRetryPlan = plan({
      kind: "api_missing",
      status: 404,
      message: "OneUptime answered HTTP 404",
    });

    assert.strictEqual(missing.category, "api_missing");
    assert.strictEqual(missing.delayMs, API_MISSING_RETRY_MS);
    assert.strictEqual(API_MISSING_RETRY_MS, 5 * 60_000);
    assert.strictEqual(
      missing.message,
      "This OneUptime server does not have the Kubernetes AI agent API (it needs the same OneUptime version as this chart, or newer). Upgrade OneUptime, or install the chart version that matches your server.",
    );
    assert.strictEqual(missing.detail, "OneUptime answered HTTP 404");
  });

  test("a 200 without an id and key is not a registration", () => {
    const empty: RegistrationRetryPlan = plan({ kind: "ok", body: {} });

    assert.strictEqual(empty.category, "refused");
    assert.strictEqual(empty.delayMs, OPERATOR_ACTION_RETRY_MS);
  });

  test("parseRegistration", () => {
    assert.deepStrictEqual(
      parseRegistration({ agentId: "a", agentKey: "k", clusterId: "c" }),
      { agentId: "a", agentKey: "k", clusterId: "c" },
    );
    assert.deepStrictEqual(parseRegistration({ agentId: "a", agentKey: "k" }), {
      agentId: "a",
      agentKey: "k",
      clusterId: null,
    });
    assert.strictEqual(parseRegistration({ agentId: "a" }), null);
    assert.strictEqual(parseRegistration({ agentId: "a", agentKey: 5 }), null);
    assert.strictEqual(parseRegistration(null), null);
  });
});

describe("the session", () => {
  let server: FakeOneUptime;
  let status: AgentStatus;
  let sleeper: RecordingSleep;
  let logs: CapturedLogs;

  before(async (): Promise<void> => {
    server = new FakeOneUptime();
    await server.start();
  });

  after(async (): Promise<void> => {
    await server.stop();
  });

  beforeEach((): void => {
    server.reset();
    status = new AgentStatus();
    sleeper = recordingSleep();
    logs = captureLogs();
  });

  afterEach((): void => {
    logs.restore();
  });

  function session(sleep?: SleepFunction): AgentSession {
    return new AgentSession({
      client: new IngestClient({
        oneuptimeUrl: server.url,
        apiKey: "ingestion-key-1",
      }),
      config: testConfig(server.url),
      status,
      getPosture: (): Promise<AgentPosture> => {
        return Promise.resolve(POSTURE);
      },
      sleep: sleep || sleeper.sleep,
    });
  }

  test("registers with the cluster name, version and posture — no previous key the first time", async () => {
    const agentSession: AgentSession = session();
    const identity: AgentIdentity | null =
      await agentSession.ensureRegistered();

    assert.deepStrictEqual(identity, {
      agentId: "agent-1",
      agentKey: "key-1",
      clusterId: "cluster-1",
    });
    assert.strictEqual(agentSession.getIdentity(), identity);

    const [request] = server.requestsTo("/register") as Array<RecordedRequest>;
    assert.deepStrictEqual(request!.body, {
      clusterName: "prod-us",
      agentVersion: "14.0.8",
      posture: POSTURE,
    });
    assert.strictEqual(
      request!.headers["x-oneuptime-token"],
      "ingestion-key-1",
    );

    assert.strictEqual(status.phase, "connected");
    assert.strictEqual(status.agentId, "agent-1");
    assert.ok(status.lastRegisteredAt);
    assert.deepStrictEqual(status.posture, POSTURE);
  });

  test("retries transient failures on the schedule, forever, until it gets in", async () => {
    server.script(
      "/register",
      { status: 503, raw: "<h1>503</h1>" },
      { destroy: true },
      { status: 500, json: { message: "boom" } },
      {
        status: 429,
        json: { message: "slow down" },
        headers: { "Retry-After": "90" },
      },
    );

    const identity: AgentIdentity | null = await session().ensureRegistered();

    assert.ok(identity);
    assert.deepStrictEqual(sleeper.delays, [30_000, 60_000, 60_000, 90_000]);
    assert.strictEqual(server.requestsTo("/register").length, 5);
    // Every transient failure is logged: at most once a minute.
    assert.strictEqual(
      logs.messages("warn").filter((message: string): boolean => {
        return message.startsWith("Could not register with OneUptime");
      }).length,
      4,
    );
  });

  test("a server without the API: logged once, retried every 5 minutes, shown in /status", async () => {
    server.script(
      "/register",
      { status: 404, raw: "<html>Not Found</html>" },
      { status: 404, json: { message: "Not found" } },
      { status: 200, raw: "<html>Welcome</html>" },
    );

    // What /status showed during each wait.
    const duringWaits: Array<string> = [];
    const agentSession: AgentSession = session(
      (ms: number, signal?: AbortSignal): Promise<void> => {
        duringWaits.push(
          `${status.phase}:${status.apiMissing}:${status.lastError === API_MISSING_MESSAGE}`,
        );
        return sleeper.sleep(ms, signal);
      },
    );

    await agentSession.ensureRegistered();

    assert.deepStrictEqual(duringWaits, [
      "registering:true:true",
      "registering:true:true",
      "registering:true:true",
    ]);

    assert.deepStrictEqual(sleeper.delays, [
      API_MISSING_RETRY_MS,
      API_MISSING_RETRY_MS,
      API_MISSING_RETRY_MS,
    ]);
    assert.strictEqual(
      logs.messages("error").filter((message: string): boolean => {
        return message === API_MISSING_MESSAGE;
      }).length,
      1,
      "logged once",
    );
    assert.strictEqual(status.apiMissing, false, "cleared once registered");
    assert.strictEqual(status.lastError, null);
  });

  test("an operator refusal is logged once per distinct message", async () => {
    const refusal: (message: string) => FakeReply = (
      message: string,
    ): FakeReply => {
      return { status: 403, json: { message, reason: "agent_cap_reached" } };
    };
    server.script(
      "/register",
      refusal("Too many agents."),
      refusal("Too many agents."),
      refusal("Too many new agents this hour."),
      refusal("Too many new agents this hour."),
    );

    await session().ensureRegistered();

    assert.deepStrictEqual(sleeper.delays, [
      OPERATOR_ACTION_RETRY_MS,
      OPERATOR_ACTION_RETRY_MS,
      OPERATOR_ACTION_RETRY_MS,
      OPERATOR_ACTION_RETRY_MS,
    ]);
    const errors: Array<string> = logs.messages("error");
    assert.strictEqual(
      errors.filter((message: string): boolean => {
        return message.includes("Too many agents.");
      }).length,
      1,
    );
    assert.strictEqual(
      errors.filter((message: string): boolean => {
        return message.includes("Too many new agents this hour.");
      }).length,
      1,
    );
  });

  test("waiting for the previous instance: the server's Retry-After, logged once at info", async () => {
    const waiting: Record<string, unknown> = {
      status: 403,
      json: {
        message: "This cluster's AI agent is still online.",
        reason: "previous_instance_online",
        retryAfterSeconds: 20,
      },
      headers: { "Retry-After": "20" },
    };
    server.script("/register", waiting, waiting, waiting);

    await session().ensureRegistered();

    assert.deepStrictEqual(sleeper.delays, [20_000, 20_000, 20_000]);
    assert.strictEqual(
      logs.messages("info").filter((message: string): boolean => {
        return message.startsWith(
          "Waiting for this cluster's previous AI agent",
        );
      }).length,
      1,
    );
    assert.deepStrictEqual(logs.messages("error"), []);
  });

  test("single flight: concurrent callers share one registration", async () => {
    server.script("/register", {
      delayMs: 100,
      json: { agentId: "a", agentKey: "k" },
    });
    const agentSession: AgentSession = session();

    const [first, second] = await Promise.all([
      agentSession.ensureRegistered(),
      agentSession.ensureRegistered(),
    ]);

    assert.strictEqual(first, second);
    assert.strictEqual(server.requestsTo("/register").length, 1);
    // Already registered: no new request.
    await agentSession.ensureRegistered();
    assert.strictEqual(server.requestsTo("/register").length, 1);
  });

  test("three rejections in a row: drop the identity and register again, proving continuity with the old key", async () => {
    server.script(
      "/register",
      { json: { agentId: "agent-1", agentKey: "key-1" } },
      { json: { agentId: "agent-1", agentKey: "key-2" } },
    );
    const agentSession: AgentSession = session();
    const first: AgentIdentity = (await agentSession.ensureRegistered())!;
    const rejected: IngestResponse = response({
      kind: "auth",
      status: 401,
      message: "Invalid agent id or key.",
    });

    for (let i: number = 1; i < REREGISTER_AFTER_REJECTIONS; i++) {
      agentSession.recordRejected(first, rejected);
    }
    assert.strictEqual(agentSession.getIdentity(), first, "not yet");

    agentSession.recordRejected(first, rejected);
    assert.strictEqual(
      agentSession.getIdentity(),
      null,
      "nothing is sent with it again",
    );

    await eventually((): boolean => {
      return agentSession.getIdentity() !== null;
    });

    const registrations: Array<RecordedRequest> =
      server.requestsTo("/register");
    assert.strictEqual(registrations.length, 2);
    assert.strictEqual(registrations[1]!.body["previousAgentKey"], "key-1");
    assert.strictEqual(agentSession.getIdentity()!.agentKey, "key-2");
    assert.ok(
      logs.messages("warn").some((message: string): boolean => {
        return message.includes("rejected this agent's identity 3 times");
      }),
    );
  });

  test("an accepted call resets the count; a stale identity's rejection is ignored", async () => {
    const agentSession: AgentSession = session();
    const identity: AgentIdentity = (await agentSession.ensureRegistered())!;
    const rejected: IngestResponse = response({ kind: "auth", status: 401 });

    agentSession.recordRejected(identity, rejected);
    agentSession.recordRejected(identity, rejected);
    agentSession.recordAccepted(identity);
    agentSession.recordRejected(identity, rejected);
    agentSession.recordRejected(identity, rejected);

    assert.strictEqual(agentSession.getIdentity(), identity);

    const stale: AgentIdentity = { ...identity };
    for (let i: number = 0; i < 5; i++) {
      agentSession.recordRejected(stale, rejected);
    }
    assert.strictEqual(agentSession.getIdentity(), identity);
    assert.strictEqual(server.requestsTo("/register").length, 1);
  });

  test("answers like a server without the API also lead to re-registration", async () => {
    server.setDefault("/register", {
      status: 404,
      raw: "<html>Not Found</html>",
    });
    server.script("/register", { json: { agentId: "a", agentKey: "k" } });
    const agentSession: AgentSession = session();
    const identity: AgentIdentity = (await agentSession.ensureRegistered())!;
    const missing: IngestResponse = response({
      kind: "api_missing",
      status: 404,
      message: "HTTP 404",
    });

    for (let i: number = 0; i < REREGISTER_AFTER_REJECTIONS; i++) {
      agentSession.recordRejected(identity, missing);
    }

    assert.strictEqual(status.apiMissing, true);
    await eventually((): boolean => {
      return server.requestsTo("/register").length >= 2;
    });
    assert.strictEqual(agentSession.getIdentity(), null);
    await agentSession.stop();
  });

  test("stop() ends a wait at once and nothing more is sent", async () => {
    server.setDefault("/register", { status: 503, json: {} });
    const agentSession: AgentSession = new AgentSession({
      client: new IngestClient({ oneuptimeUrl: server.url, apiKey: "k" }),
      config: testConfig(server.url),
      status,
      getPosture: (): Promise<AgentPosture> => {
        return Promise.resolve(POSTURE);
      },
      // The real sleep: a 30s wait that stop() must cut short.
    });

    const registering: Promise<AgentIdentity | null> =
      agentSession.ensureRegistered();
    await server.waitFor("/register");

    const started: number = Date.now();
    await agentSession.stop();
    assert.strictEqual(await registering, null);
    assert.ok(Date.now() - started < 2_000);

    await realSleep(100);
    assert.strictEqual(server.requestsTo("/register").length, 1);
    assert.strictEqual(agentSession.isStopped(), true);
  });

  test("stop() waits for an attempt on the wire, and keeps the key it returned for the sign-off", async () => {
    server.script("/register", {
      delayMs: 300,
      json: { agentId: "agent-9", agentKey: "key-9" },
    });
    const agentSession: AgentSession = session();

    const registering: Promise<AgentIdentity | null> =
      agentSession.ensureRegistered();
    await server.waitFor("/register");
    assert.strictEqual(await agentSession.stop(), true);

    assert.strictEqual(await registering, null);
    assert.deepStrictEqual(agentSession.getIdentity(), {
      agentId: "agent-9",
      agentKey: "key-9",
      clusterId: null,
    });
  });

  test("stop() with nothing on the wire resolves true at once", async () => {
    const agentSession: AgentSession = session();
    await agentSession.ensureRegistered();

    const started: number = Date.now();
    assert.strictEqual(await agentSession.stop(60_000), true);
    assert.ok(Date.now() - started < 1_000);
  });

  /*
   * Shutdown cannot wait out the 30s request timeout: the pod has 30s
   * between SIGTERM and SIGKILL, and the sign-off still has to go out.
   */
  test("stop() waits at most maxWaitMs, then cancels the attempt on the wire — quietly", async () => {
    server.setDefault("/register", { hang: true });
    const agentSession: AgentSession = session();

    const registering: Promise<AgentIdentity | null> =
      agentSession.ensureRegistered();
    await server.waitFor("/register");
    const started: number = Date.now();
    const answered: boolean = await agentSession.stop(150);

    assert.strictEqual(answered, false);
    assert.ok(Date.now() - started < 3_000, "not the 30s request timeout");
    assert.strictEqual(await registering, null);
    assert.strictEqual(agentSession.getIdentity(), null);
    // Nothing to report about a registration cancelled at shutdown.
    assert.deepStrictEqual(logs.messages("warn"), []);
    assert.deepStrictEqual(logs.messages("error"), []);
    assert.strictEqual(sleeper.delays.length, 0, "no retry was scheduled");
    await realSleep(50);
    assert.strictEqual(server.requestsTo("/register").length, 1);
  });

  test("a refusal that arrives after stop() is not reported (the agent is going away)", async () => {
    server.script("/register", {
      delayMs: 200,
      status: 403,
      json: { message: "Refused.", reason: "agent_cap_reached" },
    });
    const agentSession: AgentSession = session();

    const registering: Promise<AgentIdentity | null> =
      agentSession.ensureRegistered();
    await server.waitFor("/register");
    assert.strictEqual(await agentSession.stop(5_000), true);

    assert.strictEqual(await registering, null);
    assert.deepStrictEqual(logs.messages("error"), []);
    assert.strictEqual(sleeper.delays.length, 0);
  });

  test("attemptRegistration counts failures for the backoff and resets on success", async () => {
    server.script(
      "/register",
      { status: 503, json: {} },
      { status: 503, json: {} },
    );
    const agentSession: AgentSession = session();

    const first: RegistrationAttempt | null =
      await agentSession.attemptRegistration();
    const second: RegistrationAttempt | null =
      await agentSession.attemptRegistration();
    const third: RegistrationAttempt | null =
      await agentSession.attemptRegistration();

    assert.ok(first && first.identity === null);
    assert.ok(second && second.identity === null);
    if (first.identity === null && second.identity === null) {
      assert.strictEqual(first.plan.delayMs, 30_000);
      assert.strictEqual(second.plan.delayMs, 60_000);
    }
    assert.ok(third?.identity);
  });

  test("nothing is sent once stopped, even when stop() lands while the posture is being read", async () => {
    let releasePosture: () => void = (): void => {};
    const postureGate: Promise<void> = new Promise<void>(
      (resolve: () => void): void => {
        releasePosture = resolve;
      },
    );
    const agentSession: AgentSession = new AgentSession({
      client: new IngestClient({ oneuptimeUrl: server.url, apiKey: "k" }),
      config: testConfig(server.url),
      status,
      getPosture: async (): Promise<AgentPosture> => {
        await postureGate;
        return POSTURE;
      },
      sleep: sleeper.sleep,
    });

    const registering: Promise<AgentIdentity | null> =
      agentSession.ensureRegistered();
    await agentSession.stop();
    releasePosture();

    assert.strictEqual(await registering, null);
    assert.strictEqual(await agentSession.attemptRegistration(), null);
    await realSleep(50);
    assert.strictEqual(server.requestsTo("/register").length, 0);
  });
});
