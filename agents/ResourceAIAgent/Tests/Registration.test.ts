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
  DUPLICATE_AGENT_AFTER_MS,
  OPERATOR_ACTION_RETRY_MS,
  REREGISTER_AFTER_REJECTIONS,
  RegistrationAttempt,
  RegistrationContext,
  RegistrationRetryPlan,
  TRANSIENT_REFUSAL_RETRY_MS,
  parseRegistration,
  planRegistrationRetry,
} from "../Registration";
import FakeOneUptime, {
  FakeReply,
  RecordedRequest,
  TEST_RESOURCE_ID,
} from "./Helpers/FakeOneUptime";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";

const POSTURE: AgentPosture = {
  resourceType: AiResourceType.DockerHost,
  resourceIdentifier: "web-host-1",
  allowWrites: false,
  writeTargets: [],
  protectedTargets: [],
  reachable: true,
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

  for (const reason of ["previous_instance_online"]) {
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

  test("the wait names the resource it is waiting on", () => {
    assert.match(
      planRegistrationRetry({
        response: response({
          kind: "auth",
          status: 403,
          body: { reason: "previous_instance_online" },
          message: "Another agent is online.",
        }),
        consecutiveFailures: 1,
        context: { resourceType: AiResourceType.CephCluster },
      }).message,
      /^Waiting for this Ceph cluster's previous AI agent to go offline: Another agent is online.$/,
    );
    assert.match(
      plan({
        kind: "auth",
        status: 403,
        body: { reason: "previous_instance_online" },
        message: "x",
      }).message,
      /this resource's previous AI agent/,
    );
  });

  test("previous_instance_online that outlasts twice the alive window is a duplicate agent: an error, every 5 minutes", () => {
    const refusal: IngestResponse = response({
      kind: "auth",
      status: 403,
      body: { reason: "previous_instance_online" },
      message: "This Docker host's AI agent is still online.",
      retryAfterSeconds: 20,
    });
    const context: RegistrationContext = {
      resourceType: AiResourceType.DockerHost,
      identitySource: "DOCKER_HOST_NAME",
      resourceIdentifier: "docker-host",
    };

    assert.strictEqual(DUPLICATE_AGENT_AFTER_MS, 10 * 60_000);

    const stillWaiting: RegistrationRetryPlan = planRegistrationRetry({
      response: refusal,
      consecutiveFailures: 29,
      context,
      waitingForMs: DUPLICATE_AGENT_AFTER_MS - 1,
    });
    assert.strictEqual(stillWaiting.category, "waiting");
    assert.strictEqual(stillWaiting.delayMs, 20_000);

    const duplicate: RegistrationRetryPlan = planRegistrationRetry({
      response: refusal,
      consecutiveFailures: 30,
      context,
      waitingForMs: DUPLICATE_AGENT_AFTER_MS,
    });
    assert.strictEqual(duplicate.category, "refused");
    assert.strictEqual(duplicate.delayMs, OPERATOR_ACTION_RETRY_MS);
    assert.strictEqual(duplicate.reason, "previous_instance_online");
    assert.strictEqual(duplicate.detail, refusal.message);
    assert.match(
      duplicate.message,
      /^Another AI agent has been online as this Docker host \("docker-host"\) for over 10 minutes/,
    );
    assert.match(duplicate.message, /its own DOCKER_HOST_NAME/);
  });

  test("legacy_runner_online is not a resource agent refusal: it waits for an operator", () => {
    assert.strictEqual(
      plan({
        kind: "auth",
        status: 403,
        body: { reason: "legacy_runner_online" },
        message: "x",
      }).category,
      "refused",
    );
  });

  test("refusals an operator must fix: every 5 minutes, with the fix", () => {
    const context: RegistrationContext = {
      resourceType: AiResourceType.DockerHost,
      identitySource: "DOCKER_HOST_NAME",
      apiKeySource: "ONEUPTIME_SERVICE_TOKEN",
    };
    const refusal: (
      reason: string,
      message: string,
      withContext?: RegistrationContext,
    ) => RegistrationRetryPlan = (
      reason: string,
      message: string,
      withContext?: RegistrationContext,
    ): RegistrationRetryPlan => {
      return planRegistrationRetry({
        response: response({
          kind: "auth",
          status: 403,
          body: { reason, message },
          message,
        }),
        consecutiveFailures: 1,
        context: withContext,
      });
    };

    const nameInvalid: RegistrationRetryPlan = refusal(
      "resource_identifier_invalid",
      "The resource name is empty or too long.",
      context,
    );
    assert.strictEqual(nameInvalid.category, "refused");
    assert.strictEqual(nameInvalid.delayMs, OPERATOR_ACTION_RETRY_MS);
    assert.strictEqual(OPERATOR_ACTION_RETRY_MS, 5 * 60_000);
    assert.match(nameInvalid.message, /Fix DOCKER_HOST_NAME on the agent/);
    // Without a known source, every candidate variable is named.
    assert.match(
      refusal("resource_identifier_invalid", "x", {
        resourceType: AiResourceType.CephCluster,
      }).message,
      /Fix CEPH_CLUSTER_NAME \/ ONEUPTIME_AI_AGENT_RESOURCE_NAME on the agent/,
    );

    const typeInvalid: RegistrationRetryPlan = refusal(
      "resource_type_invalid",
      "Unknown type.",
    );
    assert.strictEqual(typeInvalid.delayMs, OPERATOR_ACTION_RETRY_MS);
    assert.match(
      typeInvalid.message,
      /Set ONEUPTIME_AI_AGENT_RESOURCE_TYPE to one of: docker, podman, docker-swarm, proxmox, vmware, ceph, database, host/,
    );

    const notFound: RegistrationRetryPlan = refusal(
      "resource_not_found",
      "No such database.",
      {
        resourceType: AiResourceType.DatabaseServer,
        identitySource: "DATABASE_SERVER_ID",
      },
    );
    assert.strictEqual(notFound.delayMs, OPERATOR_ACTION_RETRY_MS);
    assert.match(
      notFound.message,
      /Check DATABASE_SERVER_ID: it must name a Database server of the project this key belongs to/,
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
      assert.match(
        keyRefused.message,
        /Check ONEUPTIME_API_KEY \/ ONEUPTIME_TELEMETRY_INGESTION_KEY \/ ONEUPTIME_SERVICE_TOKEN/,
      );
    }

    assert.match(
      planRegistrationRetry({
        response: response({
          kind: "auth",
          status: 401,
          body: { message: "Bad key." },
          message: "Bad key.",
        }),
        consecutiveFailures: 1,
        context,
      }).message,
      /Check ONEUPTIME_SERVICE_TOKEN — it must be an unpinned telemetry ingestion key/,
    );

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
      "This OneUptime server does not have the resource AI agent API (it needs the same OneUptime version as this agent, or newer). Upgrade OneUptime, or run the oneuptime/resource-ai-agent image version that matches your server.",
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
      parseRegistration({
        agentId: "a",
        agentKey: "k",
        resourceId: "r",
        resourceName: "Web host",
      }),
      {
        agentId: "a",
        agentKey: "k",
        resourceId: "r",
        resourceName: "Web host",
      },
    );
    assert.deepStrictEqual(parseRegistration({ agentId: "a", agentKey: "k" }), {
      agentId: "a",
      agentKey: "k",
      resourceId: null,
      resourceName: null,
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

  test("registers with the resource type, identity, version and posture — no previous key the first time", async () => {
    const agentSession: AgentSession = session();
    const identity: AgentIdentity | null =
      await agentSession.ensureRegistered();

    assert.deepStrictEqual(identity, {
      agentId: "agent-1",
      agentKey: "key-1",
      resourceId: TEST_RESOURCE_ID,
      resourceName: "web-host-1",
    });
    assert.strictEqual(agentSession.getIdentity(), identity);

    const [request] = server.requestsTo("/register") as Array<RecordedRequest>;
    assert.deepStrictEqual(request!.body, {
      resourceType: "DockerHost",
      resourceIdentifier: "web-host-1",
      agentVersion: "14.0.8",
      posture: POSTURE,
    });
    assert.strictEqual(
      request!.headers["x-oneuptime-token"],
      "ingestion-key-1",
    );

    assert.strictEqual(status.phase, "connected");
    assert.strictEqual(status.agentId, "agent-1");
    assert.strictEqual(status.resourceId, TEST_RESOURCE_ID);
    assert.strictEqual(status.resourceName, "web-host-1");
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
        message: "This Docker host's AI agent is still online.",
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
          "Waiting for this Docker host's previous AI agent",
        );
      }).length,
      1,
    );
    assert.deepStrictEqual(logs.messages("error"), []);
  });

  test("a previous agent that stays online past twice the alive window is a duplicate: one error, then every 5 minutes; a 429 does not restart the count", async () => {
    const waiting: FakeReply = {
      status: 403,
      json: {
        message: "This Docker host's AI agent is still online.",
        reason: "previous_instance_online",
        retryAfterSeconds: 20,
      },
      headers: { "Retry-After": "20" },
    };
    const rateLimited: FakeReply = {
      status: 429,
      json: { message: "slow down" },
      headers: { "Retry-After": "20" },
    };
    // A virtual clock: the time the agent has slept so far.
    let clockMs: number = 0;
    const sleep: SleepFunction = (
      ms: number,
      signal?: AbortSignal,
    ): Promise<void> => {
      clockMs += ms;
      return sleeper.sleep(ms, signal);
    };
    const agentSession: AgentSession = new AgentSession({
      client: new IngestClient({
        oneuptimeUrl: server.url,
        apiKey: "ingestion-key-1",
      }),
      config: testConfig(server.url),
      status,
      getPosture: (): Promise<AgentPosture> => {
        return Promise.resolve(POSTURE);
      },
      sleep,
      now: (): number => {
        return clockMs;
      },
    });

    // 10 refusals, a 429, 19 refusals, then the registration gets in.
    server.script(
      "/register",
      ...Array.from({ length: 10 }, (): FakeReply => {
        return waiting;
      }),
      rateLimited,
      ...Array.from({ length: 19 }, (): FakeReply => {
        return waiting;
      }),
    );

    const identity: AgentIdentity | null =
      await agentSession.ensureRegistered();

    assert.ok(identity);
    /*
     * Refused at 0..180s; the 429 at 200s waits the transient backoff
     * (60s); refused at 260..580s; at 600s the run has lasted 10 minutes
     * (counted from 0s, not from the 429): 5 minutes from then on.
     */
    assert.deepStrictEqual(sleeper.delays, [
      ...Array.from({ length: 10 }, (): number => {
        return 20_000;
      }),
      60_000,
      ...Array.from({ length: 17 }, (): number => {
        return 20_000;
      }),
      OPERATOR_ACTION_RETRY_MS,
      OPERATOR_ACTION_RETRY_MS,
    ]);

    const errors: Array<string> = logs.messages("error");
    assert.strictEqual(errors.length, 1);
    assert.match(
      errors[0]!,
      /^Another AI agent has been online as this Docker host \("web-host-1"\) for over 10 minutes/,
    );
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
      resourceId: null,
      resourceName: null,
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

  test("a pinned resource id (DATABASE_SERVER_ID) is sent with the endpoint identity's posture", async () => {
    const databasePosture: AgentPosture = {
      resourceType: AiResourceType.DatabaseServer,
      resourceIdentifier: "0e5f7a1c-1111-4222-8333-944455556666",
      allowWrites: false,
      writeTargets: [],
      protectedTargets: [],
      reachable: true,
      details: {
        databaseSystem: "postgresql",
        serverAddress: "orders-db.internal",
        serverPort: 5432,
      },
    };
    const agentSession: AgentSession = new AgentSession({
      client: new IngestClient({ oneuptimeUrl: server.url, apiKey: "k" }),
      config: testConfig(server.url, {
        ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "database",
        DATABASE_SERVER_ID: "0E5F7A1C-1111-4222-8333-944455556666",
      }),
      status,
      getPosture: (): Promise<AgentPosture> => {
        return Promise.resolve(databasePosture);
      },
      sleep: sleeper.sleep,
    });

    await agentSession.ensureRegistered();

    const [request] = server.requestsTo("/register");
    assert.deepStrictEqual(request!.body, {
      resourceType: "DatabaseServer",
      resourceIdentifier: "0e5f7a1c-1111-4222-8333-944455556666",
      resourceId: "0e5f7a1c-1111-4222-8333-944455556666",
      agentVersion: "14.0.8",
      posture: databasePosture,
    });
  });

  test("a refusal names the variables this agent actually uses", async () => {
    server.script("/register", {
      status: 403,
      json: {
        message: "The name is too long.",
        reason: "resource_identifier_invalid",
      },
    });
    const agentSession: AgentSession = session();

    const attempt: RegistrationAttempt | null =
      await agentSession.attemptRegistration();

    assert.ok(attempt && attempt.identity === null);
    if (attempt.identity === null) {
      assert.match(attempt.plan.message, /Fix DOCKER_HOST_NAME on the agent/);
    }
  });
});
