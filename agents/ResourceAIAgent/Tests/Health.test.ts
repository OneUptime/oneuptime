import "./Helpers/TestSupport";
import assert from "assert";
import http from "http";
import { AddressInfo } from "net";
import { after, before, test } from "node:test";
import AgentStatus, { AgentStatusSnapshot } from "../AgentStatus";
import { startHealthServer } from "../Health";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";

let status: AgentStatus;
let server: http.Server;
let base: string;

before(async (): Promise<void> => {
  status = new AgentStatus(new Date(Date.now() - 65_000));
  server = await startHealthServer({ status, port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async (): Promise<void> => {
  server.closeAllConnections();
  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => {
      resolve();
    });
  });
});

interface HealthResponse {
  status: number;
  body: string;
  contentType: string | null;
}

const SECRET_WORDS: RegExp = /agentKey|apiKey|token/i;

async function get(
  path: string,
  method: string = "GET",
): Promise<HealthResponse> {
  const response: Response = await fetch(`${base}${path}`, { method });
  return {
    status: response.status,
    body: await response.text(),
    contentType: response.headers.get("content-type"),
  };
}

test("/status/live answers 200 while the process is up", async () => {
  const response: HealthResponse = await get("/status/live");

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(JSON.parse(response.body), { status: "alive" });
});

test("/status/ready: 503 while starting, 200 once started — never waiting for registration", async () => {
  status.ready = false;
  assert.strictEqual((await get("/status/ready")).status, 503);

  status.ready = true;
  status.phase = "registering";
  const ready: HealthResponse = await get("/status/ready");
  assert.strictEqual(ready.status, 200);
  assert.deepStrictEqual(JSON.parse(ready.body), { status: "ready" });

  status.phase = "misconfigured";
  assert.strictEqual((await get("/status/ready")).status, 200);
});

test("/status reports registration, heartbeat, the last error and a missing API", async () => {
  status.phase = "registering";
  status.apiMissing = true;
  status.recordError(
    "This OneUptime server does not have the resource AI agent API.",
  );

  let snapshot: AgentStatusSnapshot = JSON.parse((await get("/status")).body);
  assert.strictEqual(snapshot.registered, false);
  assert.strictEqual(snapshot.agentId, null);
  assert.strictEqual(snapshot.apiMissing, true);
  assert.match(snapshot.lastError!, /does not have the resource AI agent API/);
  assert.ok(snapshot.lastErrorAt);

  status.resourceType = AiResourceType.DockerHost;
  status.resourceIdentifier = "web-host-1";
  status.recordRegistered({
    agentId: "agent-1",
    resourceId: "resource-1",
    resourceName: "Web host 1",
  });
  status.lastHeartbeatAt = new Date("2026-09-28T12:00:00.000Z");
  status.posture = {
    resourceType: AiResourceType.DockerHost,
    resourceIdentifier: "web-host-1",
    allowWrites: true,
    writeTargets: ["web-*"],
    protectedTargets: ["oneuptime-docker-ai-agent"],
    toolVersion: "29.4.3",
    reachable: false,
    reachError: "Cannot connect to the Docker daemon",
  };

  const response: HealthResponse = await get("/status");
  assert.strictEqual(response.status, 200);
  assert.match(response.contentType || "", /application\/json/);
  snapshot = JSON.parse(response.body);

  assert.strictEqual(snapshot.phase, "connected");
  assert.strictEqual(snapshot.registered, true);
  assert.strictEqual(snapshot.agentId, "agent-1");
  assert.strictEqual(snapshot.lastHeartbeatAt, "2026-09-28T12:00:00.000Z");
  assert.strictEqual(snapshot.lastError, null);
  assert.strictEqual(snapshot.apiMissing, false);
  assert.strictEqual(snapshot.resourceType, "DockerHost");
  assert.strictEqual(snapshot.resourceIdentifier, "web-host-1");
  assert.strictEqual(snapshot.resourceId, "resource-1");
  assert.strictEqual(snapshot.resourceName, "Web host 1");
  assert.strictEqual(snapshot.allowWrites, true);
  assert.deepStrictEqual(snapshot.writeTargets, ["web-*"]);
  assert.deepStrictEqual(snapshot.protectedTargets, [
    "oneuptime-docker-ai-agent",
  ]);
  assert.strictEqual(snapshot.toolVersion, "29.4.3");
  assert.strictEqual(snapshot.reachable, false);
  assert.strictEqual(
    snapshot.reachError,
    "Cannot connect to the Docker daemon",
  );
  assert.ok(snapshot.uptimeSeconds >= 65);
});

test("/status never carries a key", async () => {
  const body: string = (await get("/status")).body;

  assert.ok(!SECRET_WORDS.test(body), body);
});

test("HEAD works, other methods and paths do not", async () => {
  const head: HealthResponse = await get("/status/live", "HEAD");
  assert.strictEqual(head.status, 200);
  assert.strictEqual(head.body, "");

  assert.strictEqual((await get("/status/live", "POST")).status, 405);
  assert.strictEqual((await get("/")).status, 404);
  assert.strictEqual((await get("/metrics")).status, 404);
  // A query string does not change the route.
  assert.strictEqual((await get("/status/live?probe=1")).status, 200);
});

test("a fresh status knows nothing about posture yet", () => {
  const fresh: AgentStatusSnapshot = new AgentStatus().snapshot();

  assert.strictEqual(fresh.phase, "starting");
  assert.strictEqual(fresh.registered, false);
  assert.strictEqual(fresh.allowWrites, null);
  assert.strictEqual(fresh.writeTargets, null);
  assert.strictEqual(fresh.protectedTargets, null);
  assert.strictEqual(fresh.reachable, null);
  assert.strictEqual(fresh.toolVersion, null);
  assert.strictEqual(fresh.jobsRun, 0);
});

test("a port already in use fails start-up loudly", async () => {
  const port: number = (server.address() as AddressInfo).port;

  await assert.rejects(
    startHealthServer({ status, port, host: "127.0.0.1" }),
    /EADDRINUSE/,
  );
});
