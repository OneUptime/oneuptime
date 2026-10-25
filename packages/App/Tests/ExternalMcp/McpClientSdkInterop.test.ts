import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequest,
  CallToolRequestSchema,
  ErrorCode,
  LATEST_PROTOCOL_VERSION,
  ListToolsRequest,
  ListToolsRequestSchema,
  McpError,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import McpClient, {
  MCP_CLIENT_PROTOCOL_VERSION,
  MCP_KNOWN_PROTOCOL_VERSIONS,
  McpServerHandshake,
  McpToolCallResultJson,
  McpToolList,
} from "Common/Server/Utils/AI/Mcp/McpClient";
import McpClientError from "Common/Server/Utils/AI/Mcp/McpClientError";
import ExternalMcpServerTransport from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerTransport";
import { LocalMcpHttpTransport } from "Common/Tests/Helpers/FakeMcpServer";
import { afterEach, describe, expect, test } from "@jest/globals";
import { randomUUID } from "crypto";
import http from "http";
import { AddressInfo } from "net";

/*
 * ONEUPTIME'S MCP CLIENT AGAINST THE OFFICIAL MCP SDK'S SERVER.
 *
 * Common's McpClient has its own suite against a hand-written server
 * (Common/Tests/Helpers/FakeMcpServer), which can say anything a test needs
 * it to - including what no real server says. This suite holds the client
 * to what real servers DO say: an MCP server built with the official
 * TypeScript SDK (@modelcontextprotocol/sdk, the one App's own MCP server is
 * built with), over both of the specification's HTTP transports:
 *
 *   - Streamable HTTP, answering with an event stream (the SDK's default)
 *     and with JSON (enableJsonResponse), a session per client;
 *   - the older HTTP+SSE transport (protocol 2024-11-05), which the client
 *     finds when the server refuses its POST.
 *
 * Each connects, lists the tools with their read-only marks and calls one,
 * a tool that fails, an unknown tool and a page of tools behind a cursor -
 * and closes the session. The server runs on the loopback address, which
 * the production transport's egress guard refuses, so the client is handed
 * the tests' own loopback transport (LocalMcpHttpTransport).
 */

interface SdkTool {
  name: string;
  title?: string;
  description: string;
  readOnly: boolean;
}

const TOOLS: Array<SdkTool> = [
  {
    name: "describe_instances",
    title: "Describe instances",
    description: "Lists the EC2 instances of a region.",
    readOnly: true,
  },
  {
    name: "restart_service",
    description: "Restarts an ECS service.",
    readOnly: false,
  },
  {
    name: "fail_always",
    description: "Fails, as a tool can.",
    readOnly: true,
  },
];

// The tools after the first page, behind a cursor.
const SECOND_PAGE: Array<SdkTool> = [
  {
    name: "list_buckets",
    description: "Lists the S3 buckets.",
    readOnly: true,
  },
];

function toolJson(tool: SdkTool): Record<string, unknown> {
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    description: tool.description,
    inputSchema: {
      type: "object",
      properties: { region: { type: "string" } },
    },
    annotations: { readOnlyHint: tool.readOnly },
  };
}

// An MCP server as the official SDK builds one, with the tools above.
function buildSdkServer(): Server {
  const server: Server = new Server(
    { name: "aws-api", title: "AWS API", version: "2.0.1" },
    {
      capabilities: { tools: {} },
      instructions: "Use describe_instances first.",
    },
  );

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (request: ListToolsRequest) => {
      if (request.params?.cursor === "page-2") {
        return { tools: SECOND_PAGE.map(toolJson) };
      }

      return { tools: TOOLS.map(toolJson), nextCursor: "page-2" };
    },
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      const region: string = String(request.params.arguments?.["region"] || "");

      switch (request.params.name) {
        case "describe_instances":
          return {
            content: [{ type: "text", text: `2 instances in ${region}` }],
          };
        case "fail_always":
          return {
            isError: true,
            content: [{ type: "text", text: "The region is not enabled." }],
          };
        default:
          throw new McpError(
            ErrorCode.InvalidParams,
            `Tool ${request.params.name} not found`,
          );
      }
    },
  );

  return server;
}

async function readBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Array<Buffer> = [];

  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }

  const text: string = Buffer.concat(chunks).toString("utf8");

  return text ? JSON.parse(text) : undefined;
}

interface RunningServer {
  url: string;
  // The sessions the SDK opened, and the ones it was told to end.
  openedSessions: Array<string>;
  closedSessions: Array<string>;
  stop: () => Promise<void>;
}

async function listen(
  handler: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => Promise<void>,
): Promise<{ httpServer: http.Server; base: string }> {
  const httpServer: http.Server = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse): void => {
      handler(request, response).catch((error: unknown) => {
        if (!response.headersSent) {
          response.writeHead(500).end(String(error));
        }
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });

  const port: number = (httpServer.address() as AddressInfo).port;

  return { httpServer, base: `http://127.0.0.1:${port}` };
}

// The SDK's Streamable HTTP transport, a session per client, at /mcp.
async function startStreamableHttp(options: {
  enableJsonResponse: boolean;
}): Promise<RunningServer> {
  const transports: Map<string, StreamableHTTPServerTransport> = new Map();
  const openedSessions: Array<string> = [];
  const closedSessions: Array<string> = [];

  const { httpServer, base } = await listen(
    async (request: http.IncomingMessage, response: http.ServerResponse) => {
      const sessionId: string | undefined = request.headers[
        "mcp-session-id"
      ] as string | undefined;
      const body: unknown =
        request.method === "POST" ? await readBody(request) : undefined;

      let transport: StreamableHTTPServerTransport | undefined = sessionId
        ? transports.get(sessionId)
        : undefined;

      if (!transport) {
        if (sessionId) {
          response.writeHead(404).end();
          return;
        }

        const created: StreamableHTTPServerTransport =
          new StreamableHTTPServerTransport({
            sessionIdGenerator: (): string => {
              return randomUUID();
            },
            enableJsonResponse: options.enableJsonResponse,
            onsessioninitialized: (id: string): void => {
              openedSessions.push(id);
              transports.set(id, created);
            },
            onsessionclosed: (id: string): void => {
              closedSessions.push(id);
              transports.delete(id);
            },
          });

        const server: Server = buildSdkServer();
        // As App's own MCP server connects it (exactOptionalPropertyTypes).
        await server.connect(created as Parameters<typeof server.connect>[0]);
        transport = created;
      }

      await transport.handleRequest(request, response, body);
    },
  );

  return {
    url: `${base}/mcp`,
    openedSessions,
    closedSessions,
    stop: async (): Promise<void> => {
      for (const transport of transports.values()) {
        await transport.close();
      }

      httpServer.closeAllConnections();
      await new Promise<void>((resolve: () => void) => {
        httpServer.close(() => {
          resolve();
        });
      });
    },
  };
}

/*
 * The SDK's older HTTP+SSE transport: GET /sse opens the stream and names
 * the address to POST to; a POST to /sse itself is refused, as a server of
 * that transport refuses it.
 */
async function startHttpSse(): Promise<RunningServer> {
  const transports: Map<string, SSEServerTransport> = new Map();
  const openedSessions: Array<string> = [];
  const closedSessions: Array<string> = [];

  const { httpServer, base } = await listen(
    async (request: http.IncomingMessage, response: http.ServerResponse) => {
      const url: URL = new URL(request.url || "/", "http://127.0.0.1");

      if (url.pathname === "/sse" && request.method === "GET") {
        const transport: SSEServerTransport = new SSEServerTransport(
          "/messages",
          response,
        );
        transports.set(transport.sessionId, transport);
        openedSessions.push(transport.sessionId);
        transport.onclose = (): void => {
          closedSessions.push(transport.sessionId);
          transports.delete(transport.sessionId);
        };
        await buildSdkServer().connect(transport);
        return;
      }

      if (url.pathname === "/messages" && request.method === "POST") {
        const transport: SSEServerTransport | undefined = transports.get(
          url.searchParams.get("sessionId") || "",
        );

        if (!transport) {
          response.writeHead(404).end();
          return;
        }

        await transport.handlePostMessage(
          request,
          response,
          await readBody(request),
        );
        return;
      }

      response.writeHead(405).end();
    },
  );

  return {
    url: `${base}/sse`,
    openedSessions,
    closedSessions,
    stop: async (): Promise<void> => {
      for (const transport of transports.values()) {
        await transport.close();
      }

      httpServer.closeAllConnections();
      await new Promise<void>((resolve: () => void) => {
        httpServer.close(() => {
          resolve();
        });
      });
    },
  };
}

let running: RunningServer | null = null;
let client: McpClient | null = null;

function createClient(url: string): McpClient {
  client = new McpClient({
    url,
    getSignInHeaders: async (): Promise<Record<string, string>> => {
      return {};
    },
    getSecretValues: (): Array<string> => {
      return [];
    },
    clientInfo: {
      name: "oneuptime-ai",
      title: "OneUptime AI",
      version: "9.9.9",
    },
    userAgent: "OneUptime/9.9.9 (+https://oneuptime.com)",
    transport: new LocalMcpHttpTransport(),
  });

  return client;
}

afterEach(async () => {
  if (client) {
    await client.close();
    client = null;
  }

  if (running) {
    await running.stop();
    running = null;
  }
});

describe("the protocol versions", () => {
  test("the version OneUptime asks for is the SDK's latest, and every one it knows the SDK speaks", () => {
    expect(MCP_CLIENT_PROTOCOL_VERSION).toBe(LATEST_PROTOCOL_VERSION);

    for (const version of MCP_KNOWN_PROTOCOL_VERSIONS) {
      expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(version);
    }
  });
});

/*
 * The same conversation over every way the SDK's server can answer: what
 * the client must get right against any server built with the SDK.
 */
describe.each([
  [
    "Streamable HTTP, answering with event streams",
    async (): Promise<RunningServer> => {
      return startStreamableHttp({ enableJsonResponse: false });
    },
    ExternalMcpServerTransport.StreamableHttp,
  ],
  [
    "Streamable HTTP, answering with JSON",
    async (): Promise<RunningServer> => {
      return startStreamableHttp({ enableJsonResponse: true });
    },
    ExternalMcpServerTransport.StreamableHttp,
  ],
  [
    "the older HTTP+SSE transport",
    startHttpSse,
    ExternalMcpServerTransport.Sse,
  ],
])(
  "McpClient against the official SDK's server: %s",
  (
    _label: string,
    start: () => Promise<RunningServer>,
    transport: ExternalMcpServerTransport,
  ) => {
    test("connects, and says what the server is, as the SDK says it", async () => {
      running = await start();

      const handshake: McpServerHandshake = await createClient(
        running.url,
      ).connect();

      expect(handshake.transport).toBe(transport);
      expect(handshake.serverName).toBe("aws-api");
      expect(handshake.serverTitle).toBe("AWS API");
      expect(handshake.serverVersion).toBe("2.0.1");
      expect(handshake.instructions).toBe("Use describe_instances first.");
      expect(handshake.offersTools).toBe(true);
      // The SDK speaks the version the client asks for.
      expect(handshake.protocolVersion).toBe(MCP_CLIENT_PROTOCOL_VERSION);
      expect(running.openedSessions).toHaveLength(1);
    });

    test("lists every tool across the SDK's pages, with what each is and whether it only reads", async () => {
      running = await start();

      const list: McpToolList = await createClient(running.url).listTools();

      expect(list.isComplete).toBe(true);
      expect(list.leftOut).toBe(0);
      expect(
        list.tools.map((tool: { name: string }) => {
          return tool.name;
        }),
      ).toEqual([
        "describe_instances",
        "restart_service",
        "fail_always",
        "list_buckets",
      ]);
      expect(list.tools[0]).toEqual({
        name: "describe_instances",
        title: "Describe instances",
        description: "Lists the EC2 instances of a region.",
        inputSchema: {
          type: "object",
          properties: { region: { type: "string" } },
        },
        readsOnly: true,
      });
      expect(list.tools[1]!.readsOnly).toBe(false);
    });

    test("calls a tool and hands its result on as the SDK sent it", async () => {
      running = await start();

      const result: McpToolCallResultJson = await createClient(
        running.url,
      ).callTool({
        name: "describe_instances",
        arguments: { region: "eu-west-1" },
      });

      expect(result).toEqual({
        content: [{ type: "text", text: "2 instances in eu-west-1" }],
      });
    });

    test("a tool that failed is a result too, marked as an error", async () => {
      running = await start();

      const result: McpToolCallResultJson = await createClient(
        running.url,
      ).callTool({ name: "fail_always", arguments: {} });

      expect(result["isError"]).toBe(true);
      expect(result["content"]).toEqual([
        { type: "text", text: "The region is not enabled." },
      ]);
    });

    test("a request the SDK refuses throws, with the server's own code and words", async () => {
      running = await start();
      const mcp: McpClient = createClient(running.url);

      let thrown: unknown = null;
      try {
        await mcp.callTool({ name: "no_such_tool", arguments: {} });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(McpClientError);
      expect((thrown as McpClientError).rpcCode).toBe(ErrorCode.InvalidParams);
      expect((thrown as McpClientError).message).toContain(
        "Tool no_such_tool not found",
      );

      // The session is still good for the next call.
      expect(
        await mcp.callTool({
          name: "describe_instances",
          arguments: { region: "us-east-1" },
        }),
      ).toEqual({
        content: [{ type: "text", text: "2 instances in us-east-1" }],
      });
    });

    test("one session for the whole conversation, and the session is ended on close", async () => {
      running = await start();
      const mcp: McpClient = createClient(running.url);

      await mcp.listTools();
      await mcp.callTool({
        name: "describe_instances",
        arguments: { region: "eu-west-1" },
      });

      expect(running.openedSessions).toHaveLength(1);

      await mcp.close();
      client = null;

      // The server hears of the end on its own time: wait for it, briefly.
      const deadline: number = Date.now() + 5000;
      while (
        running.closedSessions.length < running.openedSessions.length &&
        Date.now() < deadline
      ) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 20);
        });
      }

      expect(running.closedSessions).toEqual(running.openedSessions);
    });
  },
);
