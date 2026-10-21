import { realSleep } from "./Helpers/TestSupport";
import assert from "assert";
import { getEventListeners } from "events";
import http from "http";
import { AddressInfo } from "net";
import { after, afterEach, before, describe, test } from "node:test";
import IngestClient, {
  INGEST_PATH,
  IngestResponse,
  classifyResponse,
  describeNetworkError,
  parseRetryAfterSeconds,
} from "../IngestClient";
import { AgentPosture } from "../Posture";
import FakeOneUptime, { RecordedRequest } from "./Helpers/FakeOneUptime";

/*
 * Every classification the agent acts on (Appendix W): ok, transient,
 * api_missing, auth, other — first as a pure function, then end to end
 * against a local server.
 */

const POSTURE: AgentPosture = {
  clusterIdentifier: "prod-us",
  inCluster: true,
  allowWrites: false,
  allowNodeOperations: false,
  writeNamespaces: [],
  podNamespace: "oneuptime-agent",
  kubectlVersion: "v1.36.4",
  agentChartVersion: "14.0.8",
  aiSettings: { investigation: true, fixes: "Disabled", isConfigured: false },
};

const CREDENTIALS: { agentId: string; agentKey: string } = {
  agentId: "agent-1",
  agentKey: "key-1",
};

function classify(data: {
  status: number;
  contentType?: string | null;
  body?: string;
  retryAfter?: string | null;
  location?: string | null;
}): IngestResponse {
  return classifyResponse({
    status: data.status,
    contentType:
      data.contentType === undefined
        ? "application/json; charset=utf-8"
        : data.contentType,
    bodyText: data.body ?? "{}",
    retryAfterHeader: data.retryAfter ?? null,
    location: data.location ?? null,
  });
}

const HTML_404: string =
  "<!DOCTYPE html><html><head><title>404 - Page not found</title></head><body>Not Found</body></html>";

describe("classifyResponse", () => {
  test("2xx with a JSON body is ok", () => {
    const response: IngestResponse = classify({
      status: 200,
      body: '{"agentId":"a","agentKey":"k"}',
    });

    assert.strictEqual(response.kind, "ok");
    assert.deepStrictEqual(response.body, { agentId: "a", agentKey: "k" });
  });

  test("404 with a JSON body is api_missing", () => {
    const response: IngestResponse = classify({
      status: 404,
      body: '{"message":"Page not found"}',
    });

    assert.strictEqual(response.kind, "api_missing");
    assert.strictEqual(response.status, 404);
    assert.match(response.message, /Page not found/);
  });

  test("404 with an HTML page is api_missing", () => {
    const response: IngestResponse = classify({
      status: 404,
      contentType: "text/html; charset=utf-8",
      body: HTML_404,
    });

    assert.strictEqual(response.kind, "api_missing");
    assert.strictEqual(response.body, null);
  });

  test("405 is api_missing", () => {
    assert.strictEqual(
      classify({
        status: 405,
        contentType: "text/plain",
        body: "Method Not Allowed",
      }).kind,
      "api_missing",
    );
  });

  test("200 with an HTML page is api_missing (a marketing site or login page answered)", () => {
    const response: IngestResponse = classify({
      status: 200,
      contentType: "text/html",
      body: "<html><body>Welcome to OneUptime</body></html>",
    });

    assert.strictEqual(response.kind, "api_missing");
    assert.match(response.message, /text\/html instead of JSON/);
  });

  test("200 labelled JSON whose body is not JSON, or not an object, is api_missing", () => {
    assert.strictEqual(
      classify({ status: 200, body: "not json" }).kind,
      "api_missing",
    );
    assert.strictEqual(
      classify({ status: 200, body: "[1,2]" }).kind,
      "api_missing",
    );
    assert.strictEqual(classify({ status: 200, body: "" }).kind, "api_missing");
  });

  test("HTML is never JSON, even if it parses", () => {
    assert.strictEqual(
      classify({
        status: 200,
        contentType: "text/html",
        body: '{"agentId":"a"}',
      }).kind,
      "api_missing",
    );
  });

  test("401 with JSON is auth, with the server's message", () => {
    const response: IngestResponse = classify({
      status: 401,
      body: '{"message":"Invalid agent id or key."}',
    });

    assert.strictEqual(response.kind, "auth");
    assert.strictEqual(response.message, "Invalid agent id or key.");
  });

  test("403 with a transient reason carries the Retry-After header", () => {
    const response: IngestResponse = classify({
      status: 403,
      body: '{"message":"Another agent is online.","reason":"previous_instance_online"}',
      retryAfter: "20",
    });

    assert.strictEqual(response.kind, "auth");
    assert.strictEqual(response.retryAfterSeconds, 20);
    assert.strictEqual(response.body!["reason"], "previous_instance_online");
  });

  test("the body's retryAfterSeconds wins over the header", () => {
    assert.strictEqual(
      classify({
        status: 403,
        body: '{"reason":"legacy_runner_online","retryAfterSeconds":15}',
        retryAfter: "90",
      }).retryAfterSeconds,
      15,
    );
  });

  test("403 with a permanent reason is auth, without a wait", () => {
    const response: IngestResponse = classify({
      status: 403,
      body: '{"message":"This cluster name is not valid.","reason":"cluster_name_invalid"}',
    });

    assert.strictEqual(response.kind, "auth");
    assert.strictEqual(response.retryAfterSeconds, null);
  });

  test("403 from a proxy's HTML page is api_missing, not an auth refusal", () => {
    assert.strictEqual(
      classify({
        status: 403,
        contentType: "text/html",
        body: "<h1>Forbidden</h1>",
      }).kind,
      "api_missing",
    );
  });

  test("5xx is transient, whatever the body", () => {
    for (const [status, contentType, body] of [
      [500, "application/json", '{"message":"boom"}'],
      [502, "text/html", "<h1>502 Bad Gateway</h1>"],
      [503, null, ""],
      [504, "text/plain", "Gateway Timeout"],
    ] as Array<[number, string | null, string]>) {
      assert.strictEqual(
        classify({ status, contentType, body }).kind,
        "transient",
        String(status),
      );
    }

    assert.match(
      classify({ status: 500, body: '{"message":"boom"}' }).message,
      /HTTP 500: boom/,
    );
  });

  test("408 and 429 are transient; 429 keeps its Retry-After", () => {
    assert.strictEqual(classify({ status: 408 }).kind, "transient");

    const limited: IngestResponse = classify({
      status: 429,
      body: '{"message":"Too many requests"}',
      retryAfter: "45",
    });
    assert.strictEqual(limited.kind, "transient");
    assert.strictEqual(limited.retryAfterSeconds, 45);
  });

  test("other 4xx is other", () => {
    const response: IngestResponse = classify({
      status: 400,
      body: '{"error":"clusterName is required"}',
    });

    assert.strictEqual(response.kind, "other");
    assert.match(response.message, /HTTP 400: clusterName is required/);
  });

  test("a redirect is other, and names where it points (even with an HTML body)", () => {
    const response: IngestResponse = classify({
      status: 301,
      contentType: "text/html",
      body: "<html><body>301 Moved Permanently</body></html>",
      location:
        "https://oneuptime.example.com/kubernetes-ai-agent-ingest/register",
    });

    // Not "an older server": a redirect means the URL is wrong.
    assert.strictEqual(response.kind, "other");
    assert.match(
      response.message,
      /HTTP 301 to https:\/\/oneuptime\.example\.com/,
    );
    assert.match(response.message, /Set ONEUPTIME_URL/);

    const withJson: IngestResponse = classify({
      status: 302,
      body: "{}",
      location: "https://elsewhere.example.com/",
    });
    assert.strictEqual(withJson.kind, "other");
    assert.match(
      withJson.message,
      /redirect \(HTTP 302 to https:\/\/elsewhere\.example\.com\/\)/,
    );
  });

  test("a long server message is capped", () => {
    assert.ok(
      classify({
        status: 401,
        body: JSON.stringify({ message: "x".repeat(2_000) }),
      }).message.length <= 503,
    );
  });
});

describe("Retry-After parsing", () => {
  test("delta-seconds, an HTTP date, nonsense and nothing", () => {
    assert.strictEqual(
      parseRetryAfterSeconds({ header: "30", body: null }),
      30,
    );
    assert.strictEqual(
      parseRetryAfterSeconds({
        header: new Date(1_000_000 + 12_000).toUTCString(),
        body: null,
        nowMs: 1_000_000,
      }),
      12,
    );
    assert.strictEqual(
      parseRetryAfterSeconds({ header: "soon", body: null }),
      null,
    );
    assert.strictEqual(
      parseRetryAfterSeconds({ header: null, body: null }),
      null,
    );
    assert.strictEqual(
      parseRetryAfterSeconds({ header: null, body: { retryAfterSeconds: -5 } }),
      0,
    );
  });
});

describe("describeNetworkError", () => {
  test("uses the cause's code and message", () => {
    const err: Error = new TypeError("fetch failed");
    (err as Error & { cause?: unknown }).cause = {
      code: "ECONNREFUSED",
      message: "connect ECONNREFUSED 127.0.0.1:1",
    };
    assert.strictEqual(
      describeNetworkError(err),
      "connect ECONNREFUSED 127.0.0.1:1",
    );

    const onlyCode: Error = new TypeError("fetch failed");
    (onlyCode as Error & { cause?: unknown }).cause = { code: "ENOTFOUND" };
    assert.strictEqual(describeNetworkError(onlyCode), "ENOTFOUND");

    assert.strictEqual(describeNetworkError(new Error("plain")), "plain");
    assert.strictEqual(describeNetworkError("text"), "text");
  });
});

describe("against a local server", () => {
  let server: FakeOneUptime;
  let client: IngestClient;

  before(async (): Promise<void> => {
    server = new FakeOneUptime();
    await server.start();
    client = new IngestClient({
      oneuptimeUrl: `${server.url}/`,
      apiKey: "ingestion-key-1",
      agentVersion: "14.0.8",
    });
  });

  after(async (): Promise<void> => {
    await server.stop();
  });

  afterEach((): void => {
    server.reset();
  });

  test("register: POST to the ingest API with the ingestion key header", async () => {
    const response: IngestResponse = await client.register({
      clusterName: "prod-us",
      agentVersion: "14.0.8",
      previousAgentKey: "old-key",
      posture: POSTURE,
    });

    assert.strictEqual(response.kind, "ok");
    assert.strictEqual(client.getBaseUrl(), `${server.url}${INGEST_PATH}`);

    const [request] = server.requestsTo("/register") as Array<RecordedRequest>;
    assert.ok(request);
    assert.strictEqual(request.method, "POST");
    assert.strictEqual(request.path, "/kubernetes-ai-agent-ingest/register");
    assert.strictEqual(request.headers["x-oneuptime-token"], "ingestion-key-1");
    assert.match(String(request.headers["content-type"]), /application\/json/);
    assert.strictEqual(
      request.headers["user-agent"],
      "oneuptime-kubernetes-ai-agent/14.0.8",
    );
    assert.deepStrictEqual(request.body, {
      clusterName: "prod-us",
      agentVersion: "14.0.8",
      previousAgentKey: "old-key",
      posture: POSTURE,
    });
  });

  test("register leaves out what it does not have", async () => {
    await client.register({ clusterName: "prod-us", posture: POSTURE });

    const [request] = server.requestsTo("/register");
    assert.deepStrictEqual(Object.keys(request!.body).sort(), [
      "clusterName",
      "posture",
    ]);
  });

  test("every other call authenticates with the agent id and key in the body, never the ingestion key", async () => {
    await client.heartbeat(CREDENTIALS, {
      agentVersion: "14.0.8",
      posture: POSTURE,
    });
    await client.claimNextJob(CREDENTIALS);
    await client.jobHeartbeat(CREDENTIALS, "job/with space");
    await client.submitJobResult(CREDENTIALS, "job-1", {
      success: false,
      output: "",
      exitCode: 1,
      errorMessage: "Exit code 1: boom",
    });
    await client.disconnect(CREDENTIALS);

    assert.deepStrictEqual(
      server.requests.map((request: RecordedRequest): string => {
        return request.path;
      }),
      [
        "/kubernetes-ai-agent-ingest/heartbeat",
        "/kubernetes-ai-agent-ingest/claim-next-job",
        "/kubernetes-ai-agent-ingest/job/job%2Fwith%20space/heartbeat",
        "/kubernetes-ai-agent-ingest/job/job-1/result",
        "/kubernetes-ai-agent-ingest/disconnect",
      ],
    );

    for (const request of server.requests) {
      assert.strictEqual(request.headers["x-oneuptime-token"], undefined);
      assert.strictEqual(request.body["agentId"], "agent-1");
      assert.strictEqual(request.body["agentKey"], "key-1");
    }

    assert.deepStrictEqual(server.requests[0]!.body, {
      agentId: "agent-1",
      agentKey: "key-1",
      agentVersion: "14.0.8",
      posture: POSTURE,
    });
    assert.deepStrictEqual(server.requests[3]!.body, {
      agentId: "agent-1",
      agentKey: "key-1",
      success: false,
      output: "",
      exitCode: 1,
      errorMessage: "Exit code 1: boom",
    });
  });

  test("a result without an exit code or message leaves them out", async () => {
    await client.submitJobResult(CREDENTIALS, "job-1", {
      success: true,
      output: "ok",
    });

    assert.deepStrictEqual(server.requests[0]!.body, {
      agentId: "agent-1",
      agentKey: "key-1",
      success: true,
      output: "ok",
    });
  });

  test("an HTML 404 page from the server is api_missing", async () => {
    server.script("/register", { status: 404, raw: HTML_404 });

    const response: IngestResponse = await client.register({
      clusterName: "prod-us",
      posture: POSTURE,
    });

    assert.strictEqual(response.kind, "api_missing");
  });

  test("a 200 HTML page from the server is api_missing", async () => {
    server.script("/claim-next-job", {
      status: 200,
      raw: "<html>login</html>",
    });

    assert.strictEqual(
      (await client.claimNextJob(CREDENTIALS)).kind,
      "api_missing",
    );
  });

  test("a redirect is reported, not followed", async () => {
    server.script("/register", {
      status: 302,
      json: {},
      headers: { Location: `${server.url}/elsewhere` },
    });

    const response: IngestResponse = await client.register({
      clusterName: "prod-us",
      posture: POSTURE,
    });

    assert.strictEqual(response.kind, "other");
    assert.match(response.message, /redirect/);
    assert.strictEqual(server.requests.length, 1, "not followed");
  });

  test("a 403 with Retry-After end to end", async () => {
    server.script("/register", {
      status: 403,
      json: {
        message: "This cluster's previous AI agent is still online.",
        reason: "previous_instance_online",
      },
      headers: { "Retry-After": "20" },
    });

    const response: IngestResponse = await client.register({
      clusterName: "prod-us",
      posture: POSTURE,
    });

    assert.strictEqual(response.kind, "auth");
    assert.strictEqual(response.status, 403);
    assert.strictEqual(response.retryAfterSeconds, 20);
  });

  test("a dropped connection is transient", async () => {
    server.script("/heartbeat", { destroy: true });

    const response: IngestResponse = await client.heartbeat(CREDENTIALS, {
      posture: POSTURE,
    });

    assert.strictEqual(response.kind, "transient");
    assert.strictEqual(response.status, null);
    assert.match(response.message, /Could not reach OneUptime/);
  });

  test("no answer within the timeout is transient", async () => {
    server.script("/claim-next-job", { hang: true });
    const quick: IngestClient = new IngestClient({
      oneuptimeUrl: server.url,
      apiKey: "k",
      timeoutMs: 200,
    });

    const started: number = Date.now();
    const response: IngestResponse = await quick.claimNextJob(CREDENTIALS);

    assert.ok(Date.now() - started < 3_000);
    assert.strictEqual(response.kind, "transient");
    assert.match(response.message, /No answer from OneUptime .* within 200ms/);
  });

  test("a per-call timeout overrides the client's", async () => {
    server.script("/job/:id/heartbeat", { delayMs: 1_000 });

    const response: IngestResponse = await client.jobHeartbeat(
      CREDENTIALS,
      "job-1",
      100,
    );

    assert.strictEqual(response.kind, "transient");
  });

  /*
   * Shutdown cancels a heartbeat or registration OneUptime has not
   * answered by the time the agent must sign off.
   */
  test("a caller's signal cancels a heartbeat on the wire: transient, and says so", async () => {
    server.script("/heartbeat", { hang: true });
    const controller: AbortController = new AbortController();

    const pending: Promise<IngestResponse> = client.heartbeat(
      CREDENTIALS,
      { posture: POSTURE },
      { signal: controller.signal },
    );
    await server.waitFor("/heartbeat");
    const started: number = Date.now();
    controller.abort();
    const response: IngestResponse = await pending;

    assert.ok(Date.now() - started < 3_000);
    assert.strictEqual(response.kind, "transient");
    assert.strictEqual(response.status, null);
    assert.match(
      response.message,
      /^Cancelled before OneUptime at .* answered$/,
    );
  });

  test("register takes the same signal", async () => {
    server.script("/register", { hang: true });
    const controller: AbortController = new AbortController();

    const pending: Promise<IngestResponse> = client.register(
      { clusterName: "prod-us", posture: POSTURE },
      { signal: controller.signal },
    );
    await server.waitFor("/register");
    controller.abort();
    const response: IngestResponse = await pending;

    assert.strictEqual(response.kind, "transient");
    assert.match(response.message, /^Cancelled before OneUptime/);
    // The ingestion key header is still sent alongside the signal.
    assert.strictEqual(
      server.requestsTo("/register")[0]!.headers["x-oneuptime-token"],
      "ingestion-key-1",
    );
  });

  test("an already-cancelled signal sends nothing", async () => {
    const controller: AbortController = new AbortController();
    controller.abort();

    const response: IngestResponse = await client.heartbeat(
      CREDENTIALS,
      { posture: POSTURE },
      { signal: controller.signal },
    );

    assert.strictEqual(response.kind, "transient");
    assert.match(response.message, /^Cancelled before OneUptime/);
    await realSleep(50);
    assert.strictEqual(server.requests.length, 0);
  });

  test("a signal that never fires changes nothing, and is let go of afterwards", async () => {
    const controller: AbortController = new AbortController();

    const response: IngestResponse = await client.heartbeat(
      CREDENTIALS,
      { posture: POSTURE },
      { signal: controller.signal },
    );

    assert.strictEqual(response.kind, "ok");
    assert.strictEqual(getEventListeners(controller.signal, "abort").length, 0);
  });

  test("a timeout is still reported as a timeout when a signal was given", async () => {
    server.script("/heartbeat", { hang: true });
    const quick: IngestClient = new IngestClient({
      oneuptimeUrl: server.url,
      apiKey: "k",
      timeoutMs: 150,
    });

    const response: IngestResponse = await quick.heartbeat(
      CREDENTIALS,
      { posture: POSTURE },
      { signal: new AbortController().signal },
    );

    assert.strictEqual(response.kind, "transient");
    assert.match(response.message, /No answer from OneUptime .* within 150ms/);
  });
});

describe("unreachable servers", () => {
  test("a closed port is transient with the connection error", async () => {
    // Bind and release a port so nothing is listening on it.
    const probe: http.Server = http.createServer();
    await new Promise<void>((resolve: () => void): void => {
      probe.listen(0, "127.0.0.1", resolve);
    });
    const port: number = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve: () => void): void => {
      probe.close((): void => {
        resolve();
      });
    });

    const response: IngestResponse = await new IngestClient({
      oneuptimeUrl: `http://127.0.0.1:${port}`,
      apiKey: "k",
    }).claimNextJob(CREDENTIALS);

    assert.strictEqual(response.kind, "transient");
    assert.match(response.message, /ECONNREFUSED/);
  });
});
