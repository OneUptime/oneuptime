#!/usr/bin/env node
/*
 * AN MCP SERVER THAT ANSWERS tools/list AS A RECORDED ONE DID, in a process
 * of its own, for the tests of #11081 (a Project Admin marks a tool its
 * server says nothing about as read-only) and #11082 (OneUptime AI reads
 * with the servers in Slack and Microsoft Teams):
 * ../ExternalMcpReadOnlyMarks.test.ts starts it with node.
 *
 * It serves the tools of a recording in Common/Tests/Fixtures/KAgentTools -
 * kAgent's tool server as it answers, annotations, schemas and all - with
 * the official MCP TypeScript SDK, over Streamable HTTP at /mcp on the
 * loopback address, as LocalMcpServer.js does. So OneUptime reads exactly
 * what kAgent sends.
 *
 * It prints `MCP_FIXTURE_READY <url>` once it listens, and
 * `MCP_FIXTURE_CALL <json>` for every tool call it receives (the tool's
 * name and the arguments as they arrived), as LocalMcpServer.js does.
 *
 * Environment:
 *   - MCP_FIXTURE_RECORDING: the recording's path (required);
 *   - MCP_FIXTURE_OVERRIDES: a JSON object of tool name to fields that
 *     replace the recorded ones - a server that has changed a tool since
 *     it was marked;
 *   - MCP_FIXTURE_TOKEN: the bearer token every request must carry.
 */
const fs = require("node:fs");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} = require("@modelcontextprotocol/sdk/types.js");

const TOKEN = process.env["MCP_FIXTURE_TOKEN"] || "";
const RECORDING = JSON.parse(
  fs.readFileSync(process.env["MCP_FIXTURE_RECORDING"], "utf8"),
);
const OVERRIDES = JSON.parse(process.env["MCP_FIXTURE_OVERRIDES"] || "{}");

const TOOLS = RECORDING.tools.map((tool) => {
  return { ...tool, ...(OVERRIDES[tool.name] || {}) };
});

// What a few of kAgent's reads answer, as a cluster with a failing pod would.
const ANSWERS = {
  k8s_get_resources: (args) => {
    return `NAME           READY   STATUS             RESTARTS   AGE\ncheckout-7f9   0/1     CrashLoopBackOff   7          1h\n(${String(args["resource_type"])} in ${String(args["namespace"] || "default")})`;
  },
  k8s_get_pod_logs: (args) => {
    return `${String(args["pod_name"])}: java.lang.OutOfMemoryError: Java heap space`;
  },
  k8s_get_events: () => {
    return "Warning  BackOff  pod/checkout-7f9  Back-off restarting failed container";
  },
};

function buildServer() {
  const server = new Server(RECORDING.serverInfo, {
    capabilities: { tools: {} },
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments || {};

    process.stdout.write(
      `MCP_FIXTURE_CALL ${JSON.stringify({ name, arguments: args })}\n`,
    );

    if (
      !TOOLS.some((tool) => {
        return tool.name === name;
      })
    ) {
      throw new McpError(ErrorCode.InvalidParams, `Tool ${name} not found`);
    }

    const text = ANSWERS[name]
      ? ANSWERS[name](args)
      : `${name} ran with ${JSON.stringify(args)}`;

    return { content: [{ type: "text", text }] };
  });

  return server;
}

async function readBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");

  return body ? JSON.parse(body) : undefined;
}

const transports = new Map();

async function handle(request, response) {
  if (TOKEN && request.headers["authorization"] !== `Bearer ${TOKEN}`) {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "invalid_token" }));
    return;
  }

  const url = new URL(request.url || "/", "http://127.0.0.1");

  if (url.pathname !== "/mcp") {
    response.writeHead(404).end();
    return;
  }

  const sessionId = request.headers["mcp-session-id"];
  const body = request.method === "POST" ? await readBody(request) : undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    if (sessionId) {
      response.writeHead(404).end();
      return;
    }

    const created = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => {
        return randomUUID();
      },
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        transports.set(id, created);
      },
      onsessionclosed: (id) => {
        transports.delete(id);
      },
    });

    await buildServer().connect(created);
    transport = created;
  }

  await transport.handleRequest(request, response, body);
}

const httpServer = http.createServer((request, response) => {
  handle(request, response).catch((error) => {
    if (!response.headersSent) {
      response.writeHead(500).end(String(error));
    }
  });
});

httpServer.listen(0, "127.0.0.1", () => {
  const port = httpServer.address().port;
  process.stdout.write(`MCP_FIXTURE_READY http://127.0.0.1:${port}/mcp\n`);
});

process.on("SIGTERM", () => {
  httpServer.closeAllConnections();
  httpServer.close(() => {
    process.exit(0);
  });
});
