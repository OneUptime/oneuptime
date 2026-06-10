/**
 * RouteHandler stateless-mode tests.
 *
 * These tests exercise the real Express handler produced by `setupMCPRoutes`
 * over HTTP. They lock in the stateless behavior that fixes GitHub issue #2459:
 * the server keeps no in-memory session state, so it issues no `mcp-session-id`
 * and every request is self-contained — which is what makes it safe behind a
 * multi-replica deployment with no session affinity.
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

import { createExpressApp } from "Common/Server/Utils/Express";
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

interface McpResult {
  status: number;
  sessionId: string | null;
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
  } else if (text.trim().startsWith("{")) {
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
      json,
      text,
    };
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
    it("tools/call without an API key returns an API-key error", async () => {
      const res: McpResult = await postMcp(portA, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "create_project", arguments: { name: "Acme" } },
      });

      expect(res.status).toBe(200);
      expect(res.json?.error?.message).toMatch(/API key is required/i);
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

    it("GET /mcp/tools lists the registered tools", async () => {
      const res: Response = await fetch(`http://127.0.0.1:${portA}/mcp/tools`);
      const json: any = await res.json();

      expect(res.status).toBe(200);
      expect(json.count).toBe(TOOLS.length);
      expect(json.tools[0].name).toBe("create_project");
    });
  });
});
