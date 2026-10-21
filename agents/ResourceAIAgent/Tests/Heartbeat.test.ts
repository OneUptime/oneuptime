import {
  CapturedLogs,
  captureLogs,
  eventually,
  realSleep,
  recordingSleep,
  testConfig,
} from "./Helpers/TestSupport";
import assert from "assert";
import { after, afterEach, before, beforeEach, test } from "node:test";
import AgentStatus from "../AgentStatus";
import HeartbeatLoop from "../Heartbeat";
import IngestClient from "../IngestClient";
import { AgentPosture } from "../Posture";
import { AgentSession } from "../Registration";
import FakeOneUptime, { RecordedRequest } from "./Helpers/FakeOneUptime";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";

const POSTURE: AgentPosture = {
  resourceType: AiResourceType.DockerHost,
  resourceIdentifier: "web-host-1",
  agentVersion: "14.0.8",
  allowWrites: true,
  allowWritesSetting: "true",
  writeTargets: ["web-*"],
  protectedTargets: ["oneuptime-docker-ai-agent"],
  toolVersion: "29.4.3",
  reachable: true,
  details: { engine: "docker" },
};

let server: FakeOneUptime;
let status: AgentStatus;
let session: AgentSession;
let logs: CapturedLogs;
const loops: Array<HeartbeatLoop> = [];

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
  logs = captureLogs();
  session = new AgentSession({
    client: new IngestClient({ oneuptimeUrl: server.url, apiKey: "k" }),
    config: testConfig(server.url),
    status,
    getPosture: (): Promise<AgentPosture> => {
      return Promise.resolve(POSTURE);
    },
    sleep: recordingSleep().sleep,
  });
});

afterEach(async (): Promise<void> => {
  logs.restore();
  for (const loop of loops.splice(0)) {
    await loop.stop();
  }
  await session.stop();
});

function heartbeat(intervalMs: number = 60_000): HeartbeatLoop {
  const loop: HeartbeatLoop = new HeartbeatLoop({
    client: new IngestClient({ oneuptimeUrl: server.url, apiKey: "k" }),
    session,
    status,
    getPosture: (): Promise<AgentPosture> => {
      return Promise.resolve(POSTURE);
    },
    agentVersion: "14.0.8",
    intervalMs,
  });
  loops.push(loop);
  return loop;
}

test("nothing is sent before the agent has an identity", async () => {
  await heartbeat().tick();

  assert.strictEqual(server.requests.length, 0);
});

test("a heartbeat carries the identity, the version and the current posture", async () => {
  await session.ensureRegistered();
  const loop: HeartbeatLoop = heartbeat();

  await loop.tick();

  const [request] = server.requestsTo("/heartbeat") as Array<RecordedRequest>;
  assert.deepStrictEqual(request!.body, {
    agentId: "agent-1",
    agentKey: "key-1",
    agentVersion: "14.0.8",
    posture: POSTURE,
  });
  assert.strictEqual(request!.headers["x-oneuptime-token"], undefined);
  assert.ok(status.lastHeartbeatAt);
  assert.deepStrictEqual(status.posture, POSTURE);
});

test("at most one heartbeat in flight", async () => {
  await session.ensureRegistered();
  server.setDefault("/heartbeat", { delayMs: 200, json: { status: "ok" } });
  const loop: HeartbeatLoop = heartbeat();

  await Promise.all([loop.tick(), loop.tick(), loop.tick()]);

  assert.strictEqual(server.requestsTo("/heartbeat").length, 1);
});

test("start() heartbeats on the interval", async () => {
  await session.ensureRegistered();
  heartbeat(30).start();

  await server.waitFor("/heartbeat", 3);
});

test("three rejected heartbeats re-register with the previous key", async () => {
  await session.ensureRegistered();
  server.setDefault("/heartbeat", {
    status: 401,
    json: { message: "Invalid agent id or key." },
  });
  server.script("/register", {
    json: { agentId: "agent-1", agentKey: "key-2" },
  });
  const loop: HeartbeatLoop = heartbeat();

  await loop.tick();
  await loop.tick();
  assert.strictEqual(server.requestsTo("/register").length, 1);
  await loop.tick();

  await eventually((): boolean => {
    return session.getIdentity()?.agentKey === "key-2";
  });
  const registrations: Array<RecordedRequest> = server.requestsTo("/register");
  assert.strictEqual(registrations.length, 2);
  assert.strictEqual(registrations[1]!.body["previousAgentKey"], "key-1");
});

test("a transient failure is not the identity's fault: no re-registration, logged once", async () => {
  await session.ensureRegistered();
  server.setDefault("/heartbeat", { status: 503, raw: "<h1>503</h1>" });
  const loop: HeartbeatLoop = heartbeat();

  for (let i: number = 0; i < 5; i++) {
    await loop.tick();
  }

  assert.strictEqual(server.requestsTo("/register").length, 1);
  assert.ok(session.getIdentity());
  assert.match(status.lastError!, /HTTP 503/);
  assert.strictEqual(
    logs.messages("warn").filter((message: string): boolean => {
      return message.startsWith("Heartbeat failed");
    }).length,
    1,
  );

  server.setDefault("/heartbeat", { json: { status: "ok" } });
  await loop.tick();
  assert.ok(
    logs.messages("info").includes("Heartbeats are reaching OneUptime again."),
  );
});

test("stop() waits for the heartbeat on the wire, and nothing is sent afterwards", async () => {
  await session.ensureRegistered();
  server.setDefault("/heartbeat", { delayMs: 300, json: { status: "ok" } });
  const loop: HeartbeatLoop = heartbeat(20);
  loop.start();

  await server.waitFor("/heartbeat");
  assert.strictEqual(await loop.stop(), true);
  const answered: number = server.requestsTo("/heartbeat").length;
  assert.ok(status.lastHeartbeatAt, "the one in flight was answered first");

  await realSleep(150);
  assert.strictEqual(server.requestsTo("/heartbeat").length, answered);
  await loop.tick();
  assert.strictEqual(server.requestsTo("/heartbeat").length, answered);
});

test("stop() with nothing on the wire resolves true at once", async () => {
  await session.ensureRegistered();
  const loop: HeartbeatLoop = heartbeat();

  const started: number = Date.now();
  assert.strictEqual(await loop.stop(60_000), true);
  assert.ok(Date.now() - started < 1_000);
});

/*
 * Shutdown cannot wait forever for OneUptime: the pod has 30s between
 * SIGTERM and SIGKILL, and the sign-off still has to go out.
 */
test("stop() waits at most maxWaitMs, then cancels the heartbeat on the wire — quietly", async () => {
  await session.ensureRegistered();
  server.setDefault("/heartbeat", { hang: true });
  const loop: HeartbeatLoop = heartbeat();

  const ticking: Promise<void> = loop.tick();
  await server.waitFor("/heartbeat");
  const started: number = Date.now();
  const answered: boolean = await loop.stop(150);

  assert.strictEqual(answered, false);
  assert.ok(Date.now() - started < 3_000, "not the 30s request timeout");
  await ticking;
  assert.strictEqual(status.lastHeartbeatAt, null);
  assert.strictEqual(status.lastError, null);
  // A cancelled heartbeat at shutdown is not a failure worth a warning.
  assert.deepStrictEqual(logs.messages("warn"), []);
  assert.strictEqual(server.requestsTo("/heartbeat").length, 1);
});

test("stop() while the posture is being read: that heartbeat is never sent", async () => {
  await session.ensureRegistered();
  let releasePosture: () => void = (): void => {};
  const postureGate: Promise<void> = new Promise<void>(
    (resolve: () => void): void => {
      releasePosture = resolve;
    },
  );
  const loop: HeartbeatLoop = new HeartbeatLoop({
    client: new IngestClient({ oneuptimeUrl: server.url, apiKey: "k" }),
    session,
    status,
    getPosture: async (): Promise<AgentPosture> => {
      await postureGate;
      return POSTURE;
    },
    agentVersion: "14.0.8",
    intervalMs: 60_000,
  });
  loops.push(loop);

  const ticking: Promise<void> = loop.tick();
  const stopping: Promise<boolean> = loop.stop(5_000);
  releasePosture();

  assert.strictEqual(await stopping, true);
  await ticking;
  await realSleep(50);
  assert.strictEqual(server.requestsTo("/heartbeat").length, 0);
});

test("the posture is read afresh for every heartbeat", async () => {
  await session.ensureRegistered();
  let reads: number = 0;
  const loop: HeartbeatLoop = new HeartbeatLoop({
    client: new IngestClient({ oneuptimeUrl: server.url, apiKey: "k" }),
    session,
    status,
    getPosture: (): Promise<AgentPosture> => {
      reads++;
      return Promise.resolve({
        ...POSTURE,
        reachable: reads === 1,
        ...(reads === 1 ? {} : { reachError: "socket gone" }),
      });
    },
    agentVersion: null,
    intervalMs: 60_000,
  });
  loops.push(loop);

  await loop.tick();
  await loop.tick();

  const bodies: Array<Record<string, unknown>> = server
    .requestsTo("/heartbeat")
    .map((request: RecordedRequest): Record<string, unknown> => {
      return request.body;
    });
  assert.strictEqual(bodies.length, 2);
  // No version configured: the field is left out.
  assert.strictEqual("agentVersion" in bodies[0]!, false);
  assert.strictEqual(
    (bodies[0]!["posture"] as Record<string, unknown>)["reachable"],
    true,
  );
  assert.strictEqual(
    (bodies[1]!["posture"] as Record<string, unknown>)["reachError"],
    "socket gone",
  );
  assert.strictEqual(status.posture?.reachable, false);
});
