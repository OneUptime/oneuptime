/**
 * RouteHandler stateless-mode tests.
 *
 * These tests exercise the real Express handler produced by `setupMCPRoutes`
 * over HTTP. They lock in the stateless behavior that fixes GitHub issue #2459:
 * the server keeps no in-memory session state, so it issues no `mcp-session-id`
 * and every request is self-contained — which is what makes it safe behind a
 * multi-replica deployment with no session affinity.
 *
 * They also lock in the transport compatibility fixes for GitHub issue #3695:
 * protocol versions newer than the bundled SDK are negotiated down instead of
 * rejected, the response format follows the client's Accept header, and any
 * negotiation that genuinely cannot succeed answers with a precise error
 * instead of a silent transport-level rejection.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  jest,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";

// Avoid real network calls from tool execution and keep logs quiet.
jest.mock("../Services/OneUptimeApiService");
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import { createExpressApp } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { setupMCPRoutes } from "../Handlers/RouteHandler";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import { McpToolInfo } from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";

const TOOLS: McpToolInfo[] = [
  {
    name: "create_project",
    description: "Create a new project",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
    },
    modelName: "Project",
    operation: OneUptimeOperation.Create,
    modelType: ModelType.Database,
    singularName: "Project",
    pluralName: "Projects",
    tableName: "Project",
    apiPath: "/project",
  },
];

const A_RANDOM_SESSION_ID: string = "11111111-2222-3333-4444-555555555555";

/*
 * The protocol version Claude's MCP client declared in issue #3695. It is newer
 * than anything the bundled SDK knows about, which is the whole point: the
 * server has to negotiate down to a shared version rather than reject it.
 */
const CLIENT_VERSION_FROM_ISSUE: string = "2026-07-28";

interface McpResult {
  status: number;
  sessionId: string | null;
  contentType: string;
  json: any;
  text: string;
}

/**
 * Start an Express app (with the MCP routes attached) on an ephemeral port.
 * Each server stands in for a separate replica/worker process.
 */
function startReplica(): Promise<{ server: http.Server; port: number }> {
  const app: ReturnType<typeof createExpressApp> = createExpressApp();
  setupMCPRoutes(app, TOOLS);
  return new Promise(
    (resolve: (value: { server: http.Server; port: number }) => void) => {
      const server: http.Server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        resolve({ server, port: (server.address() as AddressInfo).port });
      });
    },
  );
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise<void>((resolve: (value: void) => void) => {
    server.close(() => {
      return resolve();
    });
  });
}

/** Parse a fetch Response that may be JSON or an SSE (`data: {...}`) stream. */
async function readBody(res: Response): Promise<{ json: any; text: string }> {
  const text: string = await res.text();
  const dataLine: string | undefined = text
    .split(/\r?\n/)
    .find((line: string) => {
      return line.startsWith("data:");
    });
  let json: any = null;
  if (dataLine) {
    try {
      json = JSON.parse(dataLine.slice("data:".length).trim());
    } catch {
      json = null;
    }
  } else if (
    text.trim().startsWith("{") ||
    // A JSON-RPC batch response is an array, not an object.
    text.trim().startsWith("[")
  ) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { json, text };
}

function postMcp(
  port: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<McpResult> {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  }).then(async (res: Response) => {
    const { json, text } = await readBody(res);
    return {
      status: res.status,
      sessionId: res.headers.get("mcp-session-id"),
      contentType: res.headers.get("content-type") || "",
      json,
      text,
    };
  });
}

/**
 * POST with full control over the request headers — including sending none at
 * all. `fetch` always fills in an `Accept` header, so the "client sent no
 * Accept header" case has to go through the raw http client.
 */
function postMcpRaw(
  port: number,
  body: unknown,
  headers: Record<string, string>,
  repeatedHeaders: Array<[string, string]> = [],
): Promise<McpResult> {
  const payload: string = JSON.stringify(body);
  const merged: Record<string, string | string[] | number> = {
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  };

  /*
   * Node sends an array header value as repeated header lines, which is the
   * only way to reproduce a client that sends the same header twice.
   */
  for (const [name, value] of repeatedHeaders) {
    const existing: string | string[] | number | undefined = merged[name];
    if (Array.isArray(existing)) {
      existing.push(value);
    } else if (typeof existing === "string") {
      merged[name] = [existing, value];
    } else {
      merged[name] = [value];
    }
  }

  return new Promise((resolve: (value: McpResult) => void, reject: any) => {
    const request: http.ClientRequest = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: merged,
      },
      (res: http.IncomingMessage) => {
        let text: string = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
        });
        res.on("end", () => {
          const dataLine: string | undefined = text
            .split(/\r?\n/)
            .find((line: string) => {
              return line.startsWith("data:");
            });
          let json: any = null;
          const candidate: string = dataLine
            ? dataLine.slice("data:".length).trim()
            : text.trim();
          if (candidate.startsWith("{") || candidate.startsWith("[")) {
            try {
              json = JSON.parse(candidate);
            } catch {
              json = null;
            }
          }
          resolve({
            status: res.statusCode || 0,
            sessionId: (res.headers["mcp-session-id"] as string) || null,
            contentType: (res.headers["content-type"] as string) || "",
            json,
            text,
          });
        });
      },
    );
    request.on("error", reject);
    request.end(payload);
  });
}

function initializeBody(id: number = 1): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.1" },
    },
  };
}

describe("MCP RouteHandler (stateless mode)", () => {
  // Two replicas that share NO in-memory state, behind no session affinity.
  let replicaA: http.Server;
  let replicaB: http.Server;
  let portA: number;
  let portB: number;

  beforeAll(async () => {
    const a: { server: http.Server; port: number } = await startReplica();
    const b: { server: http.Server; port: number } = await startReplica();
    replicaA = a.server;
    portA = a.port;
    replicaB = b.server;
    portB = b.port;
  });

  afterAll(async () => {
    await closeServer(replicaA);
    await closeServer(replicaB);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("no sessions are created", () => {
    it("initialize succeeds and returns NO mcp-session-id header", async () => {
      const res: McpResult = await postMcp(portA, initializeBody());

      expect(res.status).toBe(200);
      // The whole bug class disappears because there is no session id to lose.
      expect(res.sessionId).toBeNull();
      expect(res.json?.result?.serverInfo?.name).toBe("oneuptime-mcp");
    });

    it("tools/list works with no session id and no prior initialize", async () => {
      // Before the fix this returned 400 "Missing Mcp-Session-Id header".
      const res: McpResult = await postMcp(portA, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });

      expect(res.status).toBe(200);
      expect(res.sessionId).toBeNull();
      const names: string[] = (res.json?.result?.tools || []).map(
        (t: { name: string }) => {
          return t.name;
        },
      );
      expect(names).toContain("create_project");
    });

    it("notifications/initialized without a session id is accepted (202)", async () => {
      const res: McpResult = await postMcp(portA, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      expect(res.status).toBe(202);
    });
  });

  describe("cross-replica safety (issue #2459)", () => {
    it("tools/list with an UNKNOWN session id returns 200, not 404", async () => {
      /*
       * This is the exact failure from the issue: a session id created on one
       * replica is unknown to the replica that receives the next request. Before
       * the fix this returned 404 "MCP session not found".
       */
      const res: McpResult = await postMcp(
        portB,
        { jsonrpc: "2.0", id: 3, method: "tools/list" },
        { "mcp-session-id": A_RANDOM_SESSION_ID },
      );

      expect(res.status).toBe(200);
      expect((res.json?.result?.tools || []).length).toBeGreaterThan(0);
    });

    it("initialize on replica A, then tools/list on replica B, both succeed", async () => {
      const init: McpResult = await postMcp(portA, initializeBody(10));
      expect(init.status).toBe(200);
      expect(init.sessionId).toBeNull();

      /*
       * A client would forward any returned session id; there is none, so the
       * follow-up to a different replica simply carries on.
       */
      const list: McpResult = await postMcp(portB, {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/list",
      });
      expect(list.status).toBe(200);
      expect((list.json?.result?.tools || []).length).toBeGreaterThan(0);
    });
  });

  describe("protocol version negotiation (issue #3695)", () => {
    it("negotiates a client newer than the SDK down instead of returning 400", async () => {
      /*
       * This is the exact header from the issue. Before the fix the SDK
       * transport answered 400 "Unsupported protocol version: 2026-07-28" and
       * the rejection was only visible in the container logs.
       */
      const res: McpResult = await postMcp(
        portA,
        { jsonrpc: "2.0", id: 20, method: "tools/list" },
        { "mcp-protocol-version": CLIENT_VERSION_FROM_ISSUE },
      );

      expect(res.status).toBe(200);
      expect(res.text).not.toContain("Unsupported protocol version");
      const names: string[] = (res.json?.result?.tools || []).map(
        (t: { name: string }) => {
          return t.name;
        },
      );
      expect(names).toContain("create_project");
    });

    it("runs a tools/call from a newer client end to end", async () => {
      /*
       * The user-visible symptom in the issue was that every tool call looked
       * like an API-key permissions problem. Prove the call now reaches the
       * tool layer with the request's API key.
       */
      (OneUptimeApiService.executeOperation as jest.Mock).mockResolvedValue({
        _id: "proj_3",
        name: "Gamma",
      } as never);

      const res: McpResult = await postMcp(
        portA,
        {
          jsonrpc: "2.0",
          id: 21,
          method: "tools/call",
          params: { name: "create_project", arguments: { name: "Gamma" } },
        },
        {
          "mcp-protocol-version": CLIENT_VERSION_FROM_ISSUE,
          "x-api-key": "key-from-newer-client",
        },
      );

      expect(res.status).toBe(200);
      expect(JSON.parse(res.json.result.content[0].text).success).toBe(true);
      expect(
        OneUptimeApiService.executeOperation as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        "key-from-newer-client",
      );
    });

    it("still accepts every protocol version the SDK supports", async () => {
      for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
        const res: McpResult = await postMcp(
          portA,
          { jsonrpc: "2.0", id: 22, method: "tools/list" },
          { "mcp-protocol-version": version },
        );

        expect(res.status).toBe(200);
        expect((res.json?.result?.tools || []).length).toBeGreaterThan(0);
      }
    });

    it("initialize with a future protocol version answers with a version we support", async () => {
      const res: McpResult = await postMcp(portA, {
        jsonrpc: "2.0",
        id: 23,
        method: "initialize",
        params: {
          protocolVersion: CLIENT_VERSION_FROM_ISSUE,
          capabilities: {},
          clientInfo: { name: "claude", version: "1.0" },
        },
      });

      expect(res.status).toBe(200);
      expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(
        res.json?.result?.protocolVersion,
      );
    });

    it("initialize survives an unusable protocol version header", async () => {
      /*
       * `initialize` is where the two sides are supposed to agree on a version,
       * so an unusable header is dropped rather than failing the handshake.
       */
      const res: McpResult = await postMcp(
        portA,
        {
          jsonrpc: "2.0",
          id: 24,
          method: "initialize",
          params: {
            protocolVersion: "2026-07-28",
            capabilities: {},
            clientInfo: { name: "claude", version: "1.0" },
          },
        },
        { "mcp-protocol-version": "not-a-version" },
      );

      expect(res.status).toBe(200);
      expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(
        res.json?.result?.protocolVersion,
      );
    });

    it("returns an explicit, actionable 400 when no version can be agreed on", async () => {
      const res: McpResult = await postMcp(
        portA,
        { jsonrpc: "2.0", id: 25, method: "tools/list" },
        { "mcp-protocol-version": "2000-01-01" },
      );

      expect(res.status).toBe(400);
      // The client gets the real reason in-band, not just in the server logs.
      expect(res.json?.error?.message).toMatch(
        /Unsupported MCP protocol version: 2000-01-01/,
      );
      expect(res.json?.error?.data?.requestedProtocolVersion).toBe(
        "2000-01-01",
      );
      expect(res.json?.error?.data?.supportedProtocolVersions).toEqual(
        expect.arrayContaining([...SUPPORTED_PROTOCOL_VERSIONS]),
      );
    });

    it("returns the same explicit 400 for a malformed version", async () => {
      const res: McpResult = await postMcp(
        portA,
        { jsonrpc: "2.0", id: 26, method: "tools/list" },
        { "mcp-protocol-version": "banana" },
      );

      expect(res.status).toBe(400);
      expect(res.json?.error?.message).toMatch(/banana/);
      expect(res.json?.error?.code).toBe(-32000);
    });

    it("works with no protocol version header at all", async () => {
      const res: McpResult = await postMcp(portA, {
        jsonrpc: "2.0",
        id: 27,
        method: "tools/list",
      });

      expect(res.status).toBe(200);
      expect((res.json?.result?.tools || []).length).toBeGreaterThan(0);
    });
  });

  describe("Accept header negotiation (issue #3695)", () => {
    it("answers a JSON-only client with JSON instead of 406", async () => {
      // Before the fix: 406 "Client must accept both application/json and text/event-stream".
      const res: McpResult = await postMcp(
        portA,
        { jsonrpc: "2.0", id: 30, method: "tools/list" },
        { Accept: "application/json" },
      );

      expect(res.status).toBe(200);
      expect(res.contentType).toContain("application/json");
      expect((res.json?.result?.tools || []).length).toBeGreaterThan(0);
    });

    it("answers a wildcard Accept with JSON instead of 406", async () => {
      const res: McpResult = await postMcp(
        portA,
        { jsonrpc: "2.0", id: 31, method: "tools/list" },
        { Accept: "*/*" },
      );

      expect(res.status).toBe(200);
      expect(res.contentType).toContain("application/json");
      expect((res.json?.result?.tools || []).length).toBeGreaterThan(0);
    });

    it("answers a request with no Accept header at all", async () => {
      const res: McpResult = await postMcpRaw(
        portA,
        { jsonrpc: "2.0", id: 32, method: "tools/list" },
        { "Content-Type": "application/json" },
      );

      expect(res.status).toBe(200);
      expect(res.contentType).toContain("application/json");
      expect((res.json?.result?.tools || []).length).toBeGreaterThan(0);
    });

    it("keeps streaming SSE for clients that ask for text/event-stream", async () => {
      const res: McpResult = await postMcp(portA, {
        jsonrpc: "2.0",
        id: 33,
        method: "tools/list",
      });

      expect(res.status).toBe(200);
      // Unchanged behavior for spec-compliant clients.
      expect(res.contentType).toContain("text/event-stream");
      expect(res.text).toContain("data:");
    });

    it("runs a tools/call for a JSON-only client", async () => {
      (OneUptimeApiService.executeOperation as jest.Mock).mockResolvedValue({
        _id: "proj_4",
        name: "Delta",
      } as never);

      const res: McpResult = await postMcp(
        portA,
        {
          jsonrpc: "2.0",
          id: 34,
          method: "tools/call",
          params: { name: "create_project", arguments: { name: "Delta" } },
        },
        { Accept: "application/json", "x-api-key": "json-client-key" },
      );

      expect(res.status).toBe(200);
      expect(res.contentType).toContain("application/json");
      expect(JSON.parse(res.json.result.content[0].text).success).toBe(true);
    });

    it("accepts notifications from a JSON-only client (202)", async () => {
      const res: McpResult = await postMcp(
        portA,
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { Accept: "application/json" },
      );

      expect(res.status).toBe(202);
    });

    it("returns an explicit 406 when the client accepts neither media type", async () => {
      const res: McpResult = await postMcp(
        portA,
        { jsonrpc: "2.0", id: 35, method: "tools/list" },
        { Accept: "text/html" },
      );

      expect(res.status).toBe(406);
      expect(res.json?.error?.message).toMatch(/Not Acceptable/);
      expect(res.json?.error?.data?.requestedAccept).toBe("text/html");
      expect(res.json?.error?.data?.supportedContentTypes).toEqual([
        "application/json",
        "text/event-stream",
      ]);
    });
  });

  describe("full handshake from a client newer than the SDK (issue #3695)", () => {
    it("initialize, initialized, tools/list and tools/call all succeed", async () => {
      (OneUptimeApiService.executeOperation as jest.Mock).mockResolvedValue({
        _id: "proj_5",
      } as never);

      // 1. initialize — the client announces a version the SDK has never heard of.
      const init: McpResult = await postMcp(portA, {
        jsonrpc: "2.0",
        id: 40,
        method: "initialize",
        params: {
          protocolVersion: CLIENT_VERSION_FROM_ISSUE,
          capabilities: {},
          clientInfo: { name: "claude", version: "1.0" },
        },
      });
      expect(init.status).toBe(200);

      /*
       * 2. Every following request carries the client's own version in the
       * header. That is what used to break the connection at the transport
       * layer, one request after a successful handshake.
       */
      const versionHeader: Record<string, string> = {
        "mcp-protocol-version": CLIENT_VERSION_FROM_ISSUE,
      };

      const initialized: McpResult = await postMcp(
        portA,
        { jsonrpc: "2.0", method: "notifications/initialized" },
        versionHeader,
      );
      expect(initialized.status).toBe(202);

      const list: McpResult = await postMcp(
        portA,
        { jsonrpc: "2.0", id: 41, method: "tools/list" },
        versionHeader,
      );
      expect(list.status).toBe(200);
      expect((list.json?.result?.tools || []).length).toBeGreaterThan(0);

      const call: McpResult = await postMcp(
        portA,
        {
          jsonrpc: "2.0",
          id: 42,
          method: "tools/call",
          params: { name: "create_project", arguments: { name: "Epsilon" } },
        },
        { ...versionHeader, "x-api-key": "handshake-key" },
      );
      expect(call.status).toBe(200);
      /*
       * Assert the result EXISTS before asserting it is not an error: on a
       * JSON-RPC error response `result` is undefined, and `undefined?.isError`
       * is falsy — so checking isError alone would pass on the very failure
       * this test exists to catch.
       */
      expect(call.json?.error).toBeUndefined();
      expect(call.json?.result).toBeDefined();
      expect(call.json?.result?.isError).toBeFalsy();
      expect(JSON.parse(call.json.result.content[0].text).success).toBe(true);
    });

    it("works the same on a different replica (no session affinity)", async () => {
      const res: McpResult = await postMcp(
        portB,
        { jsonrpc: "2.0", id: 43, method: "tools/list" },
        {
          "mcp-protocol-version": CLIENT_VERSION_FROM_ISSUE,
          Accept: "application/json",
        },
      );

      expect(res.status).toBe(200);
      expect((res.json?.result?.tools || []).length).toBeGreaterThan(0);
    });
  });

  describe("negotiation hardening (issue #3695 audit)", () => {
    it("an empty MCP-Protocol-Version header is dropped, not rejected", async () => {
      /*
       * Confirmed defect from the audit. A blank header classifies as "not
       * requested", but an empty string is not null to the SDK, so leaving it
       * in place reproduced the exact 400 this fix exists to eliminate. The
       * header has to actually be removed before the SDK sees the request.
       */
      const res: McpResult = await postMcpRaw(
        portA,
        { jsonrpc: "2.0", id: 50, method: "tools/list" },
        {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "",
        },
      );

      expect(res.status).toBe(200);
      expect(res.text).not.toContain("Unsupported protocol version");
      expect((res.json?.result?.tools || []).length).toBeGreaterThan(0);
    });

    it("a whitespace-only MCP-Protocol-Version header is dropped too", async () => {
      const res: McpResult = await postMcpRaw(
        portA,
        { jsonrpc: "2.0", id: 51, method: "tools/list" },
        {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "   ",
        },
      );

      expect(res.status).toBe(200);
      expect((res.json?.result?.tools || []).length).toBeGreaterThan(0);
    });

    it("serves a text/* client the event stream rather than a 406", async () => {
      // Confirmed defect: text/* is a range covering text/event-stream.
      const res: McpResult = await postMcp(
        portA,
        { jsonrpc: "2.0", id: 52, method: "tools/list" },
        { Accept: "text/*" },
      );

      expect(res.status).toBe(200);
      expect(res.contentType).toContain("text/event-stream");
      expect((res.json?.result?.tools || []).length).toBeGreaterThan(0);
    });

    it("a downgraded client still receives a real SSE data frame", async () => {
      /*
       * Distinguishes "negotiated down and streamed a response" from "the
       * header was dropped and the stream came back empty".
       */
      const res: McpResult = await postMcp(
        portA,
        { jsonrpc: "2.0", id: 53, method: "tools/list" },
        { "mcp-protocol-version": CLIENT_VERSION_FROM_ISSUE },
      );

      expect(res.status).toBe(200);
      expect(res.contentType).toContain("text/event-stream");
      expect(res.text).toContain("data:");
      expect(res.json?.id).toBe(53);
    });

    it("negotiates an intermediate version down to the next one below it", async () => {
      /*
       * 2025-08-01 sits between two supported versions, so this proves the
       * downgrade picks the highest version at-or-below the request rather
       * than always falling back to the newest one.
       */
      const res: McpResult = await postMcp(
        portA,
        { jsonrpc: "2.0", id: 54, method: "tools/list" },
        { "mcp-protocol-version": "2025-08-01" },
      );

      expect(res.status).toBe(200);
      expect((res.json?.result?.tools || []).length).toBeGreaterThan(0);
    });

    it("answers a JSON-RPC batch from a future client", async () => {
      const res: McpResult = await postMcp(
        portA,
        [
          { jsonrpc: "2.0", id: 55, method: "tools/list" },
          { jsonrpc: "2.0", id: 56, method: "tools/list" },
        ],
        { "mcp-protocol-version": CLIENT_VERSION_FROM_ISSUE },
      );

      expect(res.status).toBe(200);
      expect(res.text).not.toContain("Unsupported protocol version");
    });

    it("does not reject GET, DELETE or OPTIONS carrying a bad version header", async () => {
      /*
       * Those methods never reach the SDK transport, so the version check must
       * not fire for them — a browser probe with a stale header should not 400.
       */
      const headers: Record<string, string> = {
        "mcp-protocol-version": "not-a-version",
      };

      const get: Response = await fetch(`http://127.0.0.1:${portA}/mcp`, {
        headers,
      });
      expect(get.status).toBe(200);

      const del: Response = await fetch(`http://127.0.0.1:${portA}/mcp`, {
        method: "DELETE",
        headers,
      });
      expect(del.status).toBe(200);

      const options: Response = await fetch(`http://127.0.0.1:${portA}/mcp`, {
        method: "OPTIONS",
        headers,
      });
      expect(options.status).toBe(200);
    });

    it("the 400 rejection is a structurally valid JSON-RPC error envelope", async () => {
      const res: McpResult = await postMcp(
        portA,
        { jsonrpc: "2.0", id: 57, method: "tools/list" },
        { "mcp-protocol-version": "1999-01-01" },
      );

      expect(res.status).toBe(400);
      expect(res.json?.jsonrpc).toBe("2.0");
      expect(typeof res.json?.error?.code).toBe("number");
      expect(typeof res.json?.error?.message).toBe("string");
      expect("id" in (res.json || {})).toBe(true);
    });

    it("the 406 rejection is a structurally valid JSON-RPC error envelope", async () => {
      const res: McpResult = await postMcp(
        portA,
        { jsonrpc: "2.0", id: 58, method: "tools/list" },
        { Accept: "image/png" },
      );

      expect(res.status).toBe(406);
      expect(res.json?.jsonrpc).toBe("2.0");
      expect(typeof res.json?.error?.code).toBe("number");
      expect(typeof res.json?.error?.message).toBe("string");
      expect("id" in (res.json || {})).toBe(true);
    });

    it("the rejections still carry the MCP CORS headers", async () => {
      /*
       * A browser-based client has to be able to READ the rejection, otherwise
       * the error is invisible again — which is the whole complaint in #3695.
       */
      const res: Response = await fetch(`http://127.0.0.1:${portA}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "mcp-protocol-version": "1999-01-01",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 59, method: "tools/list" }),
      });

      expect(res.status).toBe(400);
      expect(
        (res.headers.get("access-control-allow-headers") || "").toLowerCase(),
      ).toContain("mcp-protocol-version");
    });

    it("a repeated mcp-protocol-version header over the wire is negotiated", async () => {
      const res: McpResult = await postMcpRaw(
        portA,
        { jsonrpc: "2.0", id: 60, method: "tools/list" },
        {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        [
          ["MCP-Protocol-Version", CLIENT_VERSION_FROM_ISSUE],
          ["MCP-Protocol-Version", "2025-06-18"],
        ],
      );

      expect(res.status).toBe(200);
      expect(res.text).not.toContain("Unsupported protocol version");
    });
  });

  describe("JSON response mode (issue #3695)", () => {
    it("initialize works over the JSON path", async () => {
      const res: McpResult = await postMcp(
        portA,
        {
          jsonrpc: "2.0",
          id: 61,
          method: "initialize",
          params: {
            protocolVersion: CLIENT_VERSION_FROM_ISSUE,
            capabilities: {},
            clientInfo: { name: "json-only-client", version: "1.0" },
          },
        },
        { Accept: "application/json" },
      );

      expect(res.status).toBe(200);
      expect(res.contentType).toContain("application/json");
      expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(
        res.json?.result?.protocolVersion,
      );
    });

    it("surfaces a failing tool as an in-band isError result, not a transport error", async () => {
      (OneUptimeApiService.executeOperation as jest.Mock).mockRejectedValue(
        new Error("upstream exploded") as never,
      );

      const res: McpResult = await postMcp(
        portA,
        {
          jsonrpc: "2.0",
          id: 62,
          method: "tools/call",
          params: { name: "create_project", arguments: { name: "Boom" } },
        },
        { Accept: "application/json", "x-api-key": "some-key" },
      );

      expect(res.status).toBe(200);
      expect(res.contentType).toContain("application/json");
      expect(res.json?.result?.isError).toBe(true);
      expect(res.json?.result?.content?.[0]?.text).toMatch(
        /upstream exploded/i,
      );
    });

    it("answers a JSON-RPC batch in JSON mode", async () => {
      const res: McpResult = await postMcp(
        portA,
        [
          { jsonrpc: "2.0", id: 63, method: "tools/list" },
          { jsonrpc: "2.0", id: 64, method: "tools/list" },
        ],
        { Accept: "application/json" },
      );

      expect(res.status).toBe(200);
      expect(res.contentType).toContain("application/json");
      expect(Array.isArray(res.json)).toBe(true);
      expect(res.json).toHaveLength(2);
    });

    it("concurrent requests with different Accept headers each get their own format", async () => {
      /*
       * A fresh transport is built per request, so two in-flight callers must
       * not be able to see each other's response format. A shared transport
       * would make one of these come back in the wrong content type.
       */
      const both: [McpResult, McpResult] = await Promise.all([
        postMcp(
          portA,
          { jsonrpc: "2.0", id: 65, method: "tools/list" },
          { Accept: "application/json" },
        ),
        postMcp(portA, { jsonrpc: "2.0", id: 66, method: "tools/list" }),
      ]);
      const json: McpResult = both[0];
      const sse: McpResult = both[1];

      expect(json.status).toBe(200);
      expect(json.contentType).toContain("application/json");
      expect(json.json?.id).toBe(65);

      expect(sse.status).toBe(200);
      expect(sse.contentType).toContain("text/event-stream");
      expect(sse.json?.id).toBe(66);
    });

    it("a wrong Content-Type is still rejected with a readable message", async () => {
      const res: McpResult = await postMcpRaw(
        portA,
        { jsonrpc: "2.0", id: 67, method: "tools/list" },
        { "Content-Type": "text/plain", Accept: "application/json" },
      );

      expect(res.status).toBe(415);
      expect(res.text).toMatch(/content-type/i);
    });
  });

  describe("diagnostics never leak the API key (issue #3695)", () => {
    it("no log line contains the API key, on the happy path or a rejection", async () => {
      const secret: string = "super-secret-key-do-not-log";

      await postMcp(
        portA,
        {
          jsonrpc: "2.0",
          id: 68,
          method: "tools/call",
          params: { name: "create_project", arguments: { name: "Acme" } },
        },
        {
          "x-api-key": secret,
          "mcp-protocol-version": CLIENT_VERSION_FROM_ISSUE,
        },
      );

      await postMcp(
        portA,
        { jsonrpc: "2.0", id: 69, method: "tools/list" },
        {
          Authorization: `Bearer ${secret}`,
          "mcp-protocol-version": "1999-01-01",
        },
      );

      const everythingLogged: string = (
        ["info", "warn", "error", "debug"] as const
      )
        .flatMap((level: "info" | "warn" | "error" | "debug") => {
          return ((logger[level] as jest.Mock).mock.calls || []).flat();
        })
        .map((entry: unknown) => {
          return typeof entry === "string" ? entry : JSON.stringify(entry);
        })
        .join("\n");

      expect(everythingLogged.length).toBeGreaterThan(0);
      expect(everythingLogged).not.toContain(secret);
    });

    it("reports the client's own headers, not the values negotiation rewrote", async () => {
      /*
       * The diagnostic exists to identify the offending client. Reading the
       * headers back after the rewrite would echo this server's normalized
       * values and describe nothing.
       */
      await postMcp(
        portA,
        { jsonrpc: "2.0", id: 70, method: "tools/list" },
        {
          "mcp-protocol-version": CLIENT_VERSION_FROM_ISSUE,
          Accept: "application/json",
          "User-Agent": "claude-mcp-test/9.9",
        },
      );

      const negotiationLogs: string = (
        (logger.info as jest.Mock).mock.calls || []
      )
        .flat()
        .map((entry: unknown) => {
          return typeof entry === "string" ? entry : JSON.stringify(entry);
        })
        .filter((line: string) => {
          return line.includes("negotiated down");
        })
        .join("\n");

      expect(negotiationLogs).toContain(CLIENT_VERSION_FROM_ISSUE);
      // The client asked for JSON only; the log must not claim it sent both.
      expect(negotiationLogs).toContain("accept=application/json");
      expect(negotiationLogs).toContain("claude-mcp-test/9.9");
    });

    it("the JSON-RPC method cannot forge extra log lines or flood the log", async () => {
      /*
       * Node refuses to put a newline in a header value, so the body is the
       * real injection surface: `method` is attacker-controlled, unbounded,
       * and lands in the negotiation diagnostics. The version header here is
       * what makes those diagnostics fire at all.
       */
      const forgedMethod: string = `tools/list\nFAKE-LOG-LINE${"z".repeat(4000)}`;

      await postMcp(
        portA,
        { jsonrpc: "2.0", id: 71, method: forgedMethod },
        { "mcp-protocol-version": CLIENT_VERSION_FROM_ISSUE },
      );

      const lines: string[] = (["info", "warn", "error"] as const)
        .flatMap((level: "info" | "warn" | "error") => {
          return ((logger[level] as jest.Mock).mock.calls || []).flat();
        })
        .map((entry: unknown) => {
          return typeof entry === "string" ? entry : JSON.stringify(entry);
        });

      const negotiationLines: string[] = lines.filter((line: string) => {
        return line.includes("jsonrpcMethod=");
      });

      expect(negotiationLines.length).toBeGreaterThan(0);
      for (const line of negotiationLines) {
        expect(line).not.toContain("\nFAKE-LOG-LINE");
        expect(line).toContain("truncated");
        expect(line.length).toBeLessThan(1500);
      }
    });
  });

  describe("HTTP method handling", () => {
    it("GET requesting an SSE stream returns 405 (no stream in stateless mode)", async () => {
      const res: Response = await fetch(`http://127.0.0.1:${portA}/mcp`, {
        headers: { Accept: "text/event-stream" },
      });

      expect(res.status).toBe(405);
    });

    it("GET without an SSE Accept header returns a discovery payload", async () => {
      const res: Response = await fetch(`http://127.0.0.1:${portA}/mcp`);
      const json: any = await res.json();

      expect(res.status).toBe(200);
      expect(json.name).toBe("oneuptime-mcp");
      expect(json.status).toBe("running");
    });

    it("DELETE is a no-op success (no session to terminate)", async () => {
      const res: Response = await fetch(`http://127.0.0.1:${portA}/mcp`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
    });
  });

  describe("CORS headers", () => {
    it("allows the MCP auth/protocol headers and never references mcp-session-id", async () => {
      const res: Response = await fetch(`http://127.0.0.1:${portA}/mcp`);
      const allowHeaders: string = (
        res.headers.get("access-control-allow-headers") || ""
      ).toLowerCase();

      expect(allowHeaders).toContain("x-api-key");
      expect(allowHeaders).toContain("mcp-protocol-version");
      // Stateless mode: no session id is ever issued, so none is allowed/exposed.
      expect(allowHeaders).not.toContain("mcp-session-id");
      expect(res.headers.get("access-control-expose-headers")).toBeNull();
    });
  });

  describe("tool execution uses the per-request API key", () => {
    it("tools/call without an API key returns an in-band isError tool result", async () => {
      const res: McpResult = await postMcp(portA, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "create_project", arguments: { name: "Acme" } },
      });

      expect(res.status).toBe(200);
      /*
       * Per the MCP spec, execution failures (like a missing API key) are
       * reported inside the CallToolResult with isError: true — not as
       * JSON-RPC protocol errors — so the calling agent sees the message
       * and can self-correct.
       */
      const result: {
        isError?: boolean;
        content?: Array<{ type: string; text: string }>;
      } = (res.json as { result?: never })?.["result"] || {};
      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toMatch(/API key is required/i);
      expect(
        OneUptimeApiService.executeOperation as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("tools/call passes the request's API key to executeOperation", async () => {
      (OneUptimeApiService.executeOperation as jest.Mock).mockResolvedValue({
        _id: "proj_1",
        name: "Acme",
      } as never);

      const res: McpResult = await postMcp(
        portA,
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "create_project", arguments: { name: "Acme" } },
        },
        { "x-api-key": "secret-key-123" },
      );

      expect(res.status).toBe(200);
      const payload: any = JSON.parse(res.json.result.content[0].text);
      expect(payload.success).toBe(true);

      // Signature: (tableName, operation, modelType, apiPath, args, apiKey)
      expect(
        OneUptimeApiService.executeOperation as jest.Mock,
      ).toHaveBeenCalledTimes(1);
      expect(
        OneUptimeApiService.executeOperation as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        "secret-key-123",
      );
    });

    it("reads the API key from a Bearer Authorization header too", async () => {
      (OneUptimeApiService.executeOperation as jest.Mock).mockResolvedValue({
        _id: "proj_2",
      } as never);

      await postMcp(
        portA,
        {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: { name: "create_project", arguments: { name: "Beta" } },
        },
        { Authorization: "Bearer bearer-key-456" },
      );

      expect(
        OneUptimeApiService.executeOperation as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        "bearer-key-456",
      );
    });
  });

  describe("REST endpoints", () => {
    it("GET /mcp/health reports stateless mode and zero sessions", async () => {
      const res: Response = await fetch(`http://127.0.0.1:${portA}/mcp/health`);
      const json: any = await res.json();

      expect(res.status).toBe(200);
      expect(json.mode).toBe("stateless");
      expect(json.activeSessions).toBe(0);
      expect(json.tools).toBe(TOOLS.length);
    });

    it("GET /mcp/health advertises the supported protocol versions", () => {
      /*
       * Issue #3695: the only place the supported versions used to appear was
       * an error in the container logs. Publishing them makes a failing
       * handshake diagnosable from outside the container.
       */
      return fetch(`http://127.0.0.1:${portA}/mcp/health`)
        .then((res: Response) => {
          return res.json();
        })
        .then((json: any) => {
          expect(json.protocolVersions).toEqual(
            expect.arrayContaining([...SUPPORTED_PROTOCOL_VERSIONS]),
          );
          expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(
            json.latestProtocolVersion,
          );
        });
    });

    it("GET /mcp discovery payload advertises the supported protocol versions", async () => {
      const res: Response = await fetch(`http://127.0.0.1:${portA}/mcp`);
      const json: any = await res.json();

      expect(json.protocolVersions).toEqual(
        expect.arrayContaining([...SUPPORTED_PROTOCOL_VERSIONS]),
      );
      expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(json.latestProtocolVersion);
    });

    it("GET /mcp/tools lists the registered tools", async () => {
      const res: Response = await fetch(`http://127.0.0.1:${portA}/mcp/tools`);
      const json: any = await res.json();

      expect(res.status).toBe(200);
      expect(json.count).toBe(TOOLS.length);
      expect(json.tools[0].name).toBe("create_project");
    });
  });
});
