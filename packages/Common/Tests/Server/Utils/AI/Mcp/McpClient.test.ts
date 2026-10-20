import McpClient, {
  JSON_RPC_METHOD_NOT_FOUND,
  MCP_CLIENT_PROTOCOL_VERSION,
  McpClientOptions,
  McpServerHandshake,
  McpToolList,
  readMcpToolDescription,
} from "../../../../../Server/Utils/AI/Mcp/McpClient";
import McpClientError from "../../../../../Server/Utils/AI/Mcp/McpClientError";
import { ExternalMcpServerFailureKind } from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";
import ExternalMcpServerTransport from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpServerTransport";
import { MAX_EXTERNAL_MCP_SERVER_TOOLS } from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpServerLimits";
import { JSONObject } from "../../../../../Types/JSON";
import FakeMcpServer, {
  FakeMcpServerOptions,
  FakeMcpTool,
  LocalMcpHttpTransport,
} from "../../../../Helpers/FakeMcpServer";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The MCP client against a real HTTP server that speaks MCP (FakeMcpServer):
 * both transports and how one is found, the handshake, tools listed and
 * called, answers as JSON and as event streams, what the server asks back,
 * ended sessions, and every way an outside server can fail - refused
 * sign-in, errors, silence, answers too large, redirects, things that are
 * not MCP - each one said in a sentence with no secret in it.
 */

const SECRET_TOKEN: string = "very-secret-token-value";

const TOOLS: Array<FakeMcpTool> = [
  {
    name: "describe_instances",
    title: "Describe instances",
    description: "Lists the EC2 instances of a region.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { region: { type: "string" } },
      required: ["region"],
    },
    handler: (args: JSONObject): JSONObject => {
      return {
        content: [
          {
            type: "text",
            text: `2 instances in ${String(args["region"])}`,
          },
        ],
      };
    },
  },
  {
    name: "restart_service",
    description: "Restarts an ECS service.",
    readOnly: false,
  },
  {
    // No annotations: may change something.
    name: "unannotated_tool",
  },
];

let fake: FakeMcpServer | null = null;
let client: McpClient | null = null;

async function startFake(options: FakeMcpServerOptions): Promise<FakeMcpServer> {
  fake = await FakeMcpServer.start({ tools: TOOLS, ...options });
  return fake;
}

function createClient(
  url: string,
  overrides: Partial<McpClientOptions> = {},
): McpClient {
  client = new McpClient({
    url,
    getSignInHeaders: async (): Promise<Record<string, string>> => {
      return {};
    },
    getSecretValues: (): Array<string> => {
      return [SECRET_TOKEN];
    },
    clientInfo: { name: "oneuptime-ai", title: "OneUptime AI", version: "9.9.9" },
    userAgent: "OneUptime/9.9.9 (+https://oneuptime.com)",
    transport: new LocalMcpHttpTransport(),
    ...overrides,
  });

  return client;
}

async function expectFailure(
  work: Promise<unknown>,
  kind: ExternalMcpServerFailureKind,
): Promise<McpClientError> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(McpClientError);
    expect((error as McpClientError).kind).toBe(kind);
    return error as McpClientError;
  }

  throw new Error(`Expected a ${kind} failure, but the work succeeded.`);
}

afterEach(async () => {
  if (client) {
    await client.close();
    client = null;
  }

  if (fake) {
    await fake.stop();
    fake = null;
  }
});

describe("McpClient over Streamable HTTP", () => {
  test("connects: initialize, then the initialized notification, and says what the server is", async () => {
    const server: FakeMcpServer = await startFake({
      sse: false,
      serverName: "aws-api",
      serverTitle: "AWS API",
      serverVersion: "2.0.1",
      instructions: "Use describe_instances first.",
    });

    const handshake: McpServerHandshake = await createClient(
      server.url("/mcp"),
    ).connect();

    expect(handshake).toEqual({
      transport: ExternalMcpServerTransport.StreamableHttp,
      protocolVersion: MCP_CLIENT_PROTOCOL_VERSION,
      serverName: "aws-api",
      serverTitle: "AWS API",
      serverVersion: "2.0.1",
      instructions: "Use describe_instances first.",
      offersTools: true,
    });

    expect(server.methods()).toEqual([
      "initialize",
      "notifications/initialized",
    ]);

    const initialize: JSONObject = JSON.parse(
      server.requests[0]!.body,
    ) as JSONObject;

    expect(initialize["params"]).toEqual({
      protocolVersion: MCP_CLIENT_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "oneuptime-ai",
        title: "OneUptime AI",
        version: "9.9.9",
      },
    });

    // Both answer types are accepted, and the request names its product.
    expect(server.requests[0]!.headers["accept"]).toBe(
      "application/json, text/event-stream",
    );
    expect(server.requests[0]!.headers["user-agent"]).toBe(
      "OneUptime/9.9.9 (+https://oneuptime.com)",
    );
  });

  test("connects once, however many calls ask at the same time", async () => {
    const server: FakeMcpServer = await startFake({ sse: false });
    const mcp: McpClient = createClient(server.url("/mcp"));

    await Promise.all([mcp.connect(), mcp.connect(), mcp.listTools()]);

    expect(
      server.methods().filter((method: string): boolean => {
        return method === "initialize";
      }),
    ).toHaveLength(1);
  });

  test("sends the session id and the agreed protocol version with every later request", async () => {
    const server: FakeMcpServer = await startFake({
      sse: false,
      protocolVersion: "2025-06-18",
    });
    const mcp: McpClient = createClient(server.url("/mcp"));

    await mcp.listTools();

    const list: (typeof server.requests)[number] =
      server.requests[server.requests.length - 1]!;

    expect(list.headers["mcp-session-id"]).toBe("session-1");
    expect(list.headers["mcp-protocol-version"]).toBe("2025-06-18");
    expect(JSON.parse(list.body)["method"]).toBe("tools/list");
  });

  test("lists the tools with what each does, its schema and whether it only reads", async () => {
    const server: FakeMcpServer = await startFake({ sse: false });
    const list: McpToolList = await createClient(
      server.url("/mcp"),
    ).listTools();

    expect(list.isComplete).toBe(true);
    expect(list.leftOut).toBe(0);
    expect(list.tools).toEqual([
      {
        name: "describe_instances",
        title: "Describe instances",
        description: "Lists the EC2 instances of a region.",
        inputSchema: {
          type: "object",
          properties: { region: { type: "string" } },
          required: ["region"],
        },
        readsOnly: true,
      },
      {
        name: "restart_service",
        description: "Restarts an ECS service.",
        inputSchema: { type: "object", properties: {} },
        readsOnly: false,
      },
      {
        name: "unannotated_tool",
        inputSchema: { type: "object", properties: {} },
        readsOnly: false,
      },
    ]);
  });

  test("reads every page of a long tool list", async () => {
    const tools: Array<FakeMcpTool> = [];

    for (let index: number = 0; index < 23; index++) {
      tools.push({ name: `tool_${index}`, readOnly: index % 2 === 0 });
    }

    const server: FakeMcpServer = await startFake({
      sse: false,
      tools,
      toolsPageSize: 5,
    });
    const list: McpToolList = await createClient(
      server.url("/mcp"),
    ).listTools();

    expect(list.tools).toHaveLength(23);
    expect(list.isComplete).toBe(true);
    expect(
      server.methods().filter((method: string): boolean => {
        return method === "tools/list";
      }),
    ).toHaveLength(5);
  });

  test("reads at most MAX_EXTERNAL_MCP_SERVER_TOOLS tools and says how many were left out", async () => {
    const tools: Array<FakeMcpTool> = [];

    for (let index: number = 0; index < MAX_EXTERNAL_MCP_SERVER_TOOLS + 7; index++) {
      tools.push({ name: `tool_${index}` });
    }

    const server: FakeMcpServer = await startFake({ sse: false, tools });
    const list: McpToolList = await createClient(
      server.url("/mcp"),
    ).listTools();

    expect(list.tools).toHaveLength(MAX_EXTERNAL_MCP_SERVER_TOOLS);
    expect(list.leftOut).toBe(7);
  });

  test("a server whose capabilities leave tools out has none, and is not asked", async () => {
    const server: FakeMcpServer = await startFake({
      sse: false,
      capabilities: { resources: {} },
    });
    const list: McpToolList = await createClient(
      server.url("/mcp"),
    ).listTools();

    expect(list.tools).toEqual([]);
    expect(server.methods()).not.toContain("tools/list");
  });

  test("a server that does not know tools/list has no tools", async () => {
    const server: FakeMcpServer = await startFake({
      sse: false,
      capabilities: undefined,
    });
    // The fake answers tools/list itself; this server has no tools at all.
    server.options.tools = [];

    const list: McpToolList = await createClient(
      server.url("/mcp"),
    ).listTools();

    expect(list.tools).toEqual([]);
    expect(JSON_RPC_METHOD_NOT_FOUND).toBe(-32601);
  });

  test("calls a tool with its arguments and hands back the server's result", async () => {
    const server: FakeMcpServer = await startFake({ sse: false });
    const result: JSONObject = await createClient(
      server.url("/mcp"),
    ).callTool({
      name: "describe_instances",
      arguments: { region: "us-east-1" },
    });

    expect(result).toEqual({
      content: [{ type: "text", text: "2 instances in us-east-1" }],
    });
    expect(server.calls).toEqual([
      { name: "describe_instances", arguments: { region: "us-east-1" } },
    ]);
  });

  test("reads answers sent as an event stream, skipping comments and notifications", async () => {
    const server: FakeMcpServer = await startFake({
      sse: false,
      answerWithEventStream: true,
      notifyBeforeAnswer: true,
    });
    const mcp: McpClient = createClient(server.url("/mcp"));

    expect((await mcp.listTools()).tools).toHaveLength(3);
    expect(
      await mcp.callTool({
        name: "describe_instances",
        arguments: { region: "eu-west-1" },
      }),
    ).toEqual({
      content: [{ type: "text", text: "2 instances in eu-west-1" }],
    });
  });

  test("answers a ping the server sends before its answer, and refuses to sample a model", async () => {
    const server: FakeMcpServer = await startFake({
      sse: false,
      answerWithEventStream: true,
      pingBeforeAnswer: true,
      sampleBeforeAnswer: true,
    });

    await createClient(server.url("/mcp")).listTools();

    // The replies are sent without waiting on them: give them a moment.
    for (let attempt: number = 0; attempt < 50; attempt++) {
      if (server.clientReplies.length >= 2) {
        break;
      }
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });
    }

    expect(server.clientReplies).toEqual(
      expect.arrayContaining([
        { jsonrpc: "2.0", id: "server-ping-1", result: {} },
        {
          jsonrpc: "2.0",
          id: "server-sample-1",
          error: { code: -32601, message: "Method not found" },
        },
      ]),
    );
  });

  test("a server that ends every session at once is a ServerError, not a loop", async () => {
    const server: FakeMcpServer = await startFake({
      sse: false,
      // The initialized notification is the session's only request.
      expireSessionAfterRequests: 1,
    });

    const error: McpClientError = await expectFailure(
      createClient(server.url("/mcp")).listTools(),
      ExternalMcpServerFailureKind.ServerError,
    );

    expect(error.message).toBe(
      "The server ended the session again as soon as it was started (HTTP 404).",
    );
    expect(
      server.methods().filter((method: string): boolean => {
        return method === "initialize";
      }),
    ).toHaveLength(2);
  });

  test("starts a new session once when the server ended the old one, and sends the request again", async () => {
    const server: FakeMcpServer = await startFake({
      sse: false,
      // The initialized notification and tools/list, then the session ends.
      expireSessionAfterRequests: 2,
    });
    const mcp: McpClient = createClient(server.url("/mcp"));

    await mcp.listTools();
    const result: JSONObject = await mcp.callTool({
      name: "describe_instances",
      arguments: { region: "ap-south-1" },
    });

    expect(result["content"]).toEqual([
      { type: "text", text: "2 instances in ap-south-1" },
    ]);
    expect(
      server.methods().filter((method: string): boolean => {
        return method === "initialize";
      }),
    ).toHaveLength(2);
  });

  test("a server that hands out no session id is used without one", async () => {
    const server: FakeMcpServer = await startFake({
      sse: false,
      sessionIds: false,
    });
    const mcp: McpClient = createClient(server.url("/mcp"));

    await mcp.listTools();

    expect(
      server.requests[server.requests.length - 1]!.headers["mcp-session-id"],
    ).toBeUndefined();
  });

  test("closing ends the session with a DELETE", async () => {
    const server: FakeMcpServer = await startFake({ sse: false });
    const mcp: McpClient = createClient(server.url("/mcp"));

    await mcp.connect();
    await mcp.close();
    client = null;

    expect(server.deletedSessions).toEqual(["session-1"]);
    await expectFailure(mcp.connect(), ExternalMcpServerFailureKind.Other);
  });
});

describe("McpClient over HTTP+SSE", () => {
  test("finds the older transport when the POST is refused, and works over its event stream", async () => {
    const server: FakeMcpServer = await startFake({ streamable: false });
    const mcp: McpClient = createClient(server.url("/sse"));

    const handshake: McpServerHandshake = await mcp.connect();

    expect(handshake.transport).toBe(ExternalMcpServerTransport.Sse);
    expect(handshake.serverName).toBe("fake-mcp");

    const list: McpToolList = await mcp.listTools();
    expect(
      list.tools.map((tool: { name: string }): string => {
        return tool.name;
      }),
    ).toEqual(["describe_instances", "restart_service", "unannotated_tool"]);

    expect(
      await mcp.callTool({
        name: "describe_instances",
        arguments: { region: "us-west-2" },
      }),
    ).toEqual({ content: [{ type: "text", text: "2 instances in us-west-2" }] });

    // The POST of the InitializeRequest, refused, then the GET and its messages.
    expect(server.requests[0]!.method).toBe("POST");
    expect(server.requests[0]!.path).toBe("/sse");
    expect(server.requests[1]!.method).toBe("GET");
    expect(server.requests[1]!.headers["accept"]).toBe("text/event-stream");
    expect(server.requests[2]!.path).toBe("/messages");
  });

  test("several requests at once each get their own answer", async () => {
    const server: FakeMcpServer = await startFake({ streamable: false });
    const mcp: McpClient = createClient(server.url("/sse"));

    const results: Array<JSONObject> = await Promise.all(
      ["a", "b", "c"].map((region: string): Promise<JSONObject> => {
        return mcp.callTool({
          name: "describe_instances",
          arguments: { region },
        });
      }),
    );

    expect(
      results.map((result: JSONObject): string => {
        return JSON.stringify(result);
      }),
    ).toEqual([
      JSON.stringify({ content: [{ type: "text", text: "2 instances in a" }] }),
      JSON.stringify({ content: [{ type: "text", text: "2 instances in b" }] }),
      JSON.stringify({ content: [{ type: "text", text: "2 instances in c" }] }),
    ]);
  });

  test("answers a ping the server sends on its stream", async () => {
    const server: FakeMcpServer = await startFake({
      streamable: false,
      pingBeforeAnswer: true,
    });

    await createClient(server.url("/sse")).listTools();

    for (let attempt: number = 0; attempt < 50; attempt++) {
      if (server.clientReplies.length > 0) {
        break;
      }
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });
    }

    expect(server.clientReplies[0]).toEqual({
      jsonrpc: "2.0",
      id: "server-ping-1",
      result: {},
    });
  });

  test("refuses a message address on another origin, so no request goes elsewhere", async () => {
    const server: FakeMcpServer = await startFake({
      streamable: false,
      sseEndpointOrigin: "http://127.0.0.2:9",
    });

    const error: McpClientError = await expectFailure(
      createClient(server.url("/sse")).connect(),
      ExternalMcpServerFailureKind.NotAnMcpServer,
    );

    expect(error.message).toContain("another host");
    expect(
      server.requests.some((request: { path: string }): boolean => {
        return request.path === "/messages";
      }),
    ).toBe(false);
  });

  test("a server that speaks neither transport is not an MCP server, and says both answers", async () => {
    const server: FakeMcpServer = await startFake({
      streamable: false,
      sse: false,
    });

    const error: McpClientError = await expectFailure(
      createClient(server.url("/nothing")).connect(),
      ExternalMcpServerFailureKind.NotAnMcpServer,
    );

    expect(error.message).toBe(
      "The server did not answer as an MCP server: a POST of the InitializeRequest got HTTP 404, and a GET for an event stream got HTTP 404.",
    );
  });
});

describe("McpClient failures", () => {
  test("a refused sign-in is SignInRefused, never retried as SSE", async () => {
    const server: FakeMcpServer = await startFake({
      requiredHeaders: { authorization: `Bearer ${SECRET_TOKEN}` },
    });

    const error: McpClientError = await expectFailure(
      createClient(server.url("/mcp")).connect(),
      ExternalMcpServerFailureKind.SignInRefused,
    );

    expect(error.status).toBe(401);
    expect(error.message).toContain("The server refused the sign-in (HTTP 401)");
    expect(server.requests).toHaveLength(1);
  });

  test("a server asking for an OAuth sign-in in a browser is told how to sign in instead", async () => {
    const server: FakeMcpServer = await startFake({
      requiredHeaders: { authorization: "Bearer something" },
      authenticateChallenge:
        'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
    });

    const error: McpClientError = await expectFailure(
      createClient(server.url("/mcp")).connect(),
      ExternalMcpServerFailureKind.SignInRefused,
    );

    expect(error.message).toContain(
      "It asks for an OAuth sign-in in a browser, which OneUptime cannot do for an unattended investigation.",
    );
  });

  test("the sign-in headers are sent with every request", async () => {
    const server: FakeMcpServer = await startFake({
      sse: false,
      requiredHeaders: { "x-api-key": "key-123" },
    });
    const mcp: McpClient = createClient(server.url("/mcp"), {
      getSignInHeaders: async (): Promise<Record<string, string>> => {
        return { "X-API-Key": "key-123" };
      },
    });

    await mcp.listTools();

    for (const request of server.requests) {
      expect(request.headers["x-api-key"]).toBe("key-123");
    }
  });

  test("a server error is ServerError, with what the server said", async () => {
    const server: FakeMcpServer = await startFake({ mcpPostStatus: 502 });

    const error: McpClientError = await expectFailure(
      createClient(server.url("/mcp")).connect(),
      ExternalMcpServerFailureKind.ServerError,
    );

    expect(error.message).toBe("The server answered with HTTP 502: Not here");
  });

  test("a tool the server refuses is a ServerError with its code", async () => {
    const server: FakeMcpServer = await startFake({ sse: false });

    const error: McpClientError = await expectFailure(
      createClient(server.url("/mcp")).callTool({
        name: "no_such_tool",
        arguments: {},
      }),
      ExternalMcpServerFailureKind.ServerError,
    );

    expect(error.rpcCode).toBe(-32602);
    expect(error.message).toBe(
      "The server answered with an error (code -32602): Unknown tool: no_such_tool",
    );
  });

  test("a call that never comes back times out at its deadline", async () => {
    const server: FakeMcpServer = await startFake({
      sse: false,
      hangOnCall: true,
    });
    const startedAt: number = Date.now();

    await expectFailure(
      createClient(server.url("/mcp")).callTool({
        name: "describe_instances",
        arguments: { region: "x" },
        timeoutMs: 300,
      }),
      ExternalMcpServerFailureKind.TimedOut,
    );

    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  test("a call that never comes back over SSE times out too", async () => {
    const server: FakeMcpServer = await startFake({
      streamable: false,
      hangOnCall: true,
    });

    await expectFailure(
      createClient(server.url("/sse")).callTool({
        name: "describe_instances",
        arguments: { region: "x" },
        timeoutMs: 300,
      }),
      ExternalMcpServerFailureKind.TimedOut,
    );
  });

  test("an event stream that never says where to send messages times out at the connect deadline", async () => {
    const server: FakeMcpServer = await startFake({
      streamable: false,
      sseWithoutEndpoint: true,
    });
    const startedAt: number = Date.now();

    await expectFailure(
      createClient(server.url("/sse"), {
        connectTimeoutMs: 300,
      }).connect(),
      ExternalMcpServerFailureKind.TimedOut,
    );

    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  test("an answer larger than the limit is TooLarge", async () => {
    const server: FakeMcpServer = await startFake({
      sse: false,
      tools: [
        {
          name: "huge",
          readOnly: true,
          handler: (): JSONObject => {
            return { content: [{ type: "text", text: "z".repeat(50_000) }] };
          },
        },
      ],
    });

    const error: McpClientError = await expectFailure(
      createClient(server.url("/mcp"), {
        maxResponseBytes: 10_000,
      }).callTool({ name: "huge", arguments: {} }),
      ExternalMcpServerFailureKind.TooLarge,
    );

    expect(error.message).toContain("more than OneUptime reads");
  });

  test("an event-stream answer larger than the limit is TooLarge", async () => {
    const server: FakeMcpServer = await startFake({
      sse: false,
      answerWithEventStream: true,
      tools: [
        {
          name: "huge",
          readOnly: true,
          handler: (): JSONObject => {
            return { content: [{ type: "text", text: "z".repeat(50_000) }] };
          },
        },
      ],
    });

    await expectFailure(
      createClient(server.url("/mcp"), {
        maxResponseBytes: 10_000,
      }).callTool({ name: "huge", arguments: {} }),
      ExternalMcpServerFailureKind.TooLarge,
    );
  });

  test("a redirect is never followed", async () => {
    const server: FakeMcpServer = await startFake({
      redirectTo: "http://169.254.169.254/latest/meta-data",
    });

    const error: McpClientError = await expectFailure(
      createClient(server.url("/mcp")).connect(),
      ExternalMcpServerFailureKind.NotAnMcpServer,
    );

    expect(error.message).toContain("redirect (HTTP 307)");
    expect(server.requests).toHaveLength(1);
  });

  test("an answer that is not JSON or an event stream is not MCP", async () => {
    const server: FakeMcpServer = await startFake({
      rawAnswer: { contentType: "text/html", body: "<html>Login</html>" },
    });

    const error: McpClientError = await expectFailure(
      createClient(server.url("/mcp")).connect(),
      ExternalMcpServerFailureKind.NotAnMcpServer,
    );

    expect(error.message).toContain("text/html");
  });

  test("JSON that is not JSON-RPC is not MCP", async () => {
    const server: FakeMcpServer = await startFake({
      rawAnswer: { contentType: "application/json", body: "{not json" },
    });

    await expectFailure(
      createClient(server.url("/mcp")).connect(),
      ExternalMcpServerFailureKind.NotAnMcpServer,
    );
  });

  test("an InitializeRequest answered without a protocol version is not MCP", async () => {
    const server: FakeMcpServer = await startFake({
      rawAnswer: {
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
      },
    });

    const error: McpClientError = await expectFailure(
      createClient(server.url("/mcp")).connect(),
      ExternalMcpServerFailureKind.NotAnMcpServer,
    );

    expect(error.message).toContain("without a protocol version");
  });

  test("a server that cannot be reached is Unreachable", async () => {
    const server: FakeMcpServer = await startFake({});
    const url: string = server.url("/mcp");
    await server.stop();
    fake = null;

    await expectFailure(
      createClient(url).connect(),
      ExternalMcpServerFailureKind.Unreachable,
    );
  });

  test("a secret the server echoes back never reaches the message", async () => {
    const server: FakeMcpServer = await startFake({
      sse: false,
      tools: [
        {
          name: "echo",
          readOnly: true,
          handler: (): JSONObject => {
            throw new Error(`token ${SECRET_TOKEN} is not allowed here`);
          },
        },
      ],
    });

    const error: McpClientError = await expectFailure(
      createClient(server.url("/mcp")).callTool({
        name: "echo",
        arguments: {},
      }),
      ExternalMcpServerFailureKind.ServerError,
    );

    expect(error.message).not.toContain(SECRET_TOKEN);
    expect(error.message).toContain("[redacted]");
  });
});

describe("readMcpToolDescription", () => {
  test("reads a tool, its title from the annotations when it has none of its own", () => {
    expect(
      readMcpToolDescription({
        name: " get_logs ",
        description: "Reads logs.",
        annotations: { title: "Get logs", readOnlyHint: true },
        inputSchema: { type: "object", properties: {} },
      }),
    ).toEqual({
      name: "get_logs",
      title: "Get logs",
      description: "Reads logs.",
      inputSchema: { type: "object", properties: {} },
      readsOnly: true,
    });
  });

  test("a schema that is not an object schema becomes the empty one", () => {
    expect(
      readMcpToolDescription({ name: "x", inputSchema: { type: "string" } })
        ?.inputSchema,
    ).toEqual({ type: "object", properties: {} });
  });

  test("only readOnlyHint true marks a tool read-only", () => {
    expect(
      readMcpToolDescription({ name: "x", annotations: { readOnlyHint: "true" } })
        ?.readsOnly,
    ).toBe(false);
    expect(
      readMcpToolDescription({
        name: "x",
        annotations: { destructiveHint: false },
      })?.readsOnly,
    ).toBe(false);
  });

  test("leaves out what is not a tool", () => {
    expect(readMcpToolDescription(null)).toBeNull();
    expect(readMcpToolDescription([])).toBeNull();
    expect(readMcpToolDescription({ name: "" })).toBeNull();
    expect(readMcpToolDescription({ name: 7 })).toBeNull();
    expect(readMcpToolDescription({ name: "n".repeat(129) })).toBeNull();
  });
});
