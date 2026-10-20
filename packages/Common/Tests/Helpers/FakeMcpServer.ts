import http from "http";
import https from "https";
import { AddressInfo } from "net";
import { JSONObject } from "../../Types/JSON";
import {
  McpHttpRequest,
  McpHttpResponse,
  McpHttpTransport,
  sendNodeHttpRequest,
} from "../../Server/Utils/AI/Mcp/McpHttpTransport";

/*
 * A FAKE MCP SERVER for the client's tests: a real HTTP server on the
 * loopback address that speaks both of the specification's HTTP transports
 * (Streamable HTTP at /mcp, the older HTTP+SSE at /sse and /messages), an
 * OAuth token endpoint (/oauth/token), and whatever a test needs to break -
 * sign-in, slow or huge answers, ended sessions, a server that asks things
 * back, an endpoint on another origin.
 *
 * It records every request (`requests`) and every tool call (`calls`), so
 * a test checks what the client sent, not only what it got back.
 *
 * The production transport refuses the loopback address (the egress
 * guard), so the client reaches this server through LocalMcpHttpTransport
 * below - the same Node HTTP code path, with the guard left out.
 */

export interface FakeMcpTool {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  readOnly?: boolean | undefined;
  inputSchema?: JSONObject | undefined;
  // The tools/call result; a throw answers with a JSON-RPC error.
  handler?:
    | ((args: JSONObject) => Promise<JSONObject> | JSONObject)
    | undefined;
}

export interface FakeMcpOAuth {
  clientId: string;
  clientSecret: string;
  // How the token endpoint takes the client's credentials.
  accepts: "basic" | "post" | "both";
  expiresIn?: number | undefined;
  // Prefix of the tokens it hands out (token-1, token-2, ...).
  tokenPrefix?: string | undefined;
}

export interface FakeMcpServerOptions {
  // Serve Streamable HTTP at /mcp (default true).
  streamable?: boolean | undefined;
  // Serve HTTP+SSE at /sse and /messages (default true).
  sse?: boolean | undefined;
  // Answer Streamable HTTP requests with an event stream instead of JSON.
  answerWithEventStream?: boolean | undefined;
  // Hand out a session id (default true).
  sessionIds?: boolean | undefined;
  // Headers every MCP request must carry (names in lower case).
  requiredHeaders?: Record<string, string> | undefined;
  // A WWW-Authenticate header on a refused sign-in.
  authenticateChallenge?: string | undefined;
  serverName?: string | undefined;
  serverTitle?: string | undefined;
  serverVersion?: string | undefined;
  // The protocol version it answers with (default: the one asked for).
  protocolVersion?: string | undefined;
  instructions?: string | undefined;
  capabilities?: JSONObject | undefined;
  tools?: Array<FakeMcpTool> | undefined;
  // Tools per tools/list page (default: all on one page).
  toolsPageSize?: number | undefined;
  // In an event-stream answer, ask the client for a ping first.
  pingBeforeAnswer?: boolean | undefined;
  // In an event-stream answer, send a progress notification first.
  notifyBeforeAnswer?: boolean | undefined;
  // In an event-stream answer, ask the client to sample a model first.
  sampleBeforeAnswer?: boolean | undefined;
  // How long a tools/call takes.
  callDelayMs?: number | undefined;
  // The status a POST to /mcp answers with, instead of serving it.
  mcpPostStatus?: number | undefined;
  // The origin the SSE endpoint event names (default: this server's).
  sseEndpointOrigin?: string | undefined;
  // Open the SSE stream but never say where to send messages.
  sseWithoutEndpoint?: boolean | undefined;
  // End every session after this many requests in it (answering 404).
  expireSessionAfterRequests?: number | undefined;
  // Answer a POST to /mcp with a redirect to this address.
  redirectTo?: string | undefined;
  // Answer every MCP response with this content type and body instead.
  rawAnswer?: { contentType: string; body: string } | undefined;
  // Never answer a tools/call (the client must give up).
  hangOnCall?: boolean | undefined;
  oauth?: FakeMcpOAuth | undefined;
}

export interface FakeMcpRequestRecord {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface SseSession {
  response: http.ServerResponse;
  requestCount: number;
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise<string>(
    (resolve: (body: string) => void, reject: (error: Error) => void) => {
      let body: string = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        resolve(body);
      });
      request.on("error", reject);
    },
  );
}

function sseEvent(data: unknown, event?: string): string {
  return `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`;
}

export default class FakeMcpServer {
  public readonly options: FakeMcpServerOptions;
  public readonly requests: Array<FakeMcpRequestRecord> = [];
  public readonly calls: Array<{ name: string; arguments: JSONObject }> = [];
  // What the client answered to the server's own requests.
  public readonly clientReplies: Array<JSONObject> = [];
  public readonly issuedTokens: Array<string> = [];
  public deletedSessions: Array<string> = [];

  private server: http.Server;
  private port: number = 0;
  private sessionCounter: number = 0;
  private tokenCounter: number = 0;
  private streamableSessions: Map<string, number> = new Map<string, number>();
  private sseSessions: Map<string, SseSession> = new Map<string, SseSession>();
  private openResponses: Set<http.ServerResponse> =
    new Set<http.ServerResponse>();

  private constructor(options: FakeMcpServerOptions) {
    this.options = options;
    this.server = http.createServer(
      (request: http.IncomingMessage, response: http.ServerResponse) => {
        void this.handle(request, response).catch(() => {
          if (!response.headersSent) {
            response.writeHead(500);
          }
          response.end();
        });
      },
    );
  }

  public static async start(
    options: FakeMcpServerOptions = {},
  ): Promise<FakeMcpServer> {
    const fake: FakeMcpServer = new FakeMcpServer(options);

    await new Promise<void>((resolve: () => void) => {
      fake.server.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });

    fake.port = (fake.server.address() as AddressInfo).port;

    return fake;
  }

  public get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  public url(path: string = "/mcp"): string {
    return `${this.origin}${path}`;
  }

  // The MCP requests (JSON-RPC) the server received, by method.
  public methods(): Array<string> {
    const methods: Array<string> = [];

    for (const record of this.requests) {
      if (!record.body) {
        continue;
      }

      try {
        const message: JSONObject = JSON.parse(record.body) as JSONObject;

        if (typeof message["method"] === "string") {
          methods.push(message["method"]);
        }
      } catch {
        // Not JSON-RPC.
      }
    }

    return methods;
  }

  // Every token handed out so far stops working (revoked, or expired early).
  public revokeIssuedTokens(): void {
    this.issuedTokens.splice(0, this.issuedTokens.length);
  }

  public async stop(): Promise<void> {
    for (const response of this.openResponses) {
      response.end();
    }

    this.openResponses.clear();

    await new Promise<void>((resolve: () => void) => {
      this.server.closeAllConnections?.();
      this.server.close(() => {
        resolve();
      });
    });
  }

  // ---- routing --------------------------------------------------------------

  private async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    const body: string = await readBody(request);
    const url: URL = new URL(request.url || "/", this.origin);

    this.requests.push({
      method: request.method || "",
      path: url.pathname,
      headers: request.headers,
      body,
    });

    if (url.pathname === "/oauth/token") {
      this.handleToken(request, body, response);
      return;
    }

    if (!this.isSignedIn(request)) {
      response.writeHead(401, {
        "Content-Type": "application/json",
        ...(this.options.authenticateChallenge
          ? { "WWW-Authenticate": this.options.authenticateChallenge }
          : {}),
      });
      response.end(JSON.stringify({ error: "invalid_token" }));
      return;
    }

    if (url.pathname === "/mcp" && this.options.streamable !== false) {
      await this.handleStreamable(request, body, response);
      return;
    }

    if (url.pathname === "/sse" && this.options.sse !== false) {
      if (request.method === "GET") {
        this.openSseStream(response);
        return;
      }

      response.writeHead(405);
      response.end("Method Not Allowed");
      return;
    }

    if (url.pathname === "/messages" && this.options.sse !== false) {
      await this.handleSseMessage(url, body, response);
      return;
    }

    response.writeHead(404);
    response.end("Not Found");
  }

  private isSignedIn(request: http.IncomingMessage): boolean {
    const required: Record<string, string> = this.options.requiredHeaders || {};

    for (const [name, value] of Object.entries(required)) {
      if (request.headers[name.toLowerCase()] !== value) {
        return false;
      }
    }

    if (this.options.oauth) {
      const authorization: string = String(
        request.headers["authorization"] || "",
      );
      const token: string = authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : "";

      if (!this.issuedTokens.includes(token)) {
        return false;
      }
    }

    return true;
  }

  // ---- OAuth ----------------------------------------------------------------

  private handleToken(
    request: http.IncomingMessage,
    body: string,
    response: http.ServerResponse,
  ): void {
    const oauth: FakeMcpOAuth | undefined = this.options.oauth;
    const form: URLSearchParams = new URLSearchParams(body);
    const authorization: string = String(
      request.headers["authorization"] || "",
    );

    let clientId: string = "";
    let clientSecret: string = "";
    let method: "basic" | "post" | "" = "";

    if (authorization.startsWith("Basic ")) {
      const decoded: string = Buffer.from(
        authorization.slice("Basic ".length),
        "base64",
      ).toString("utf8");
      const colon: number = decoded.indexOf(":");
      clientId = decodeURIComponent(decoded.slice(0, colon));
      clientSecret = decodeURIComponent(decoded.slice(colon + 1));
      method = "basic";
    } else if (form.get("client_id")) {
      clientId = form.get("client_id") || "";
      clientSecret = form.get("client_secret") || "";
      method = "post";
    }

    const accepted: boolean =
      Boolean(oauth) &&
      form.get("grant_type") === "client_credentials" &&
      (oauth!.accepts === "both" || oauth!.accepts === method) &&
      clientId === oauth!.clientId &&
      clientSecret === oauth!.clientSecret;

    if (!accepted) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_client" }));
      return;
    }

    this.tokenCounter++;
    const token: string = `${oauth!.tokenPrefix || "token"}-${this.tokenCounter}`;
    this.issuedTokens.push(token);

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        access_token: token,
        token_type: "Bearer",
        ...(oauth!.expiresIn !== undefined
          ? { expires_in: oauth!.expiresIn }
          : {}),
      }),
    );
  }

  // ---- Streamable HTTP ------------------------------------------------------

  private async handleStreamable(
    request: http.IncomingMessage,
    body: string,
    response: http.ServerResponse,
  ): Promise<void> {
    if (request.method === "DELETE") {
      const sessionId: string = String(request.headers["mcp-session-id"]);
      this.deletedSessions.push(sessionId);
      this.streamableSessions.delete(sessionId);
      response.writeHead(200);
      response.end();
      return;
    }

    if (request.method !== "POST") {
      response.writeHead(405);
      response.end();
      return;
    }

    if (this.options.redirectTo) {
      response.writeHead(307, { Location: this.options.redirectTo });
      response.end();
      return;
    }

    if (this.options.mcpPostStatus) {
      response.writeHead(this.options.mcpPostStatus);
      response.end("Not here");
      return;
    }

    const message: JSONObject = JSON.parse(body) as JSONObject;
    const isInitialize: boolean = message["method"] === "initialize";

    // A reply to a request the server sent (a ping): recorded.
    if (message["method"] === undefined) {
      this.clientReplies.push(message);
      response.writeHead(202);
      response.end();
      return;
    }

    let sessionId: string | undefined = undefined;

    if (this.options.sessionIds !== false) {
      if (isInitialize) {
        this.sessionCounter++;
        sessionId = `session-${this.sessionCounter}`;
        this.streamableSessions.set(sessionId, 0);
      } else {
        sessionId = String(request.headers["mcp-session-id"] || "");
        const count: number | undefined =
          this.streamableSessions.get(sessionId);

        if (count === undefined) {
          response.writeHead(404, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32001, message: "Session not found" },
            }),
          );
          return;
        }

        if (
          this.options.expireSessionAfterRequests !== undefined &&
          count >= this.options.expireSessionAfterRequests
        ) {
          this.streamableSessions.delete(sessionId);
          response.writeHead(404);
          response.end();
          return;
        }

        this.streamableSessions.set(sessionId, count + 1);
      }
    }

    // A notification: accepted, nothing to answer.
    if (message["id"] === undefined) {
      response.writeHead(202);
      response.end();
      return;
    }

    if (this.options.rawAnswer) {
      response.writeHead(200, {
        "Content-Type": this.options.rawAnswer.contentType,
      });
      response.end(this.options.rawAnswer.body);
      return;
    }

    const answer: JSONObject | null = await this.answer(message);

    if (answer === null) {
      // Never answered: the client's deadline ends it.
      this.openResponses.add(response);
      return;
    }

    const headers: http.OutgoingHttpHeaders = sessionId
      ? { "Mcp-Session-Id": sessionId }
      : {};

    if (!this.options.answerWithEventStream) {
      response.writeHead(200, {
        ...headers,
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify(answer));
      return;
    }

    response.writeHead(200, {
      ...headers,
      "Content-Type": "text/event-stream",
    });

    response.write(": keep-alive comment\n\n");

    if (this.options.notifyBeforeAnswer) {
      response.write(
        sseEvent({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken: 1, progress: 1 },
        }),
      );
    }

    if (this.options.pingBeforeAnswer) {
      response.write(
        sseEvent({ jsonrpc: "2.0", id: "server-ping-1", method: "ping" }),
      );
    }

    if (this.options.sampleBeforeAnswer) {
      response.write(
        sseEvent({
          jsonrpc: "2.0",
          id: "server-sample-1",
          method: "sampling/createMessage",
          params: {},
        }),
      );
    }

    response.write(sseEvent(answer, "message"));
    response.end();
  }

  // ---- HTTP+SSE -------------------------------------------------------------

  private openSseStream(response: http.ServerResponse): void {
    this.sessionCounter++;
    const sessionId: string = `sse-${this.sessionCounter}`;

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    // The stream is open at once, as a real server's is.
    response.flushHeaders();

    this.openResponses.add(response);
    this.sseSessions.set(sessionId, { response, requestCount: 0 });

    const endpoint: string = this.options.sseEndpointOrigin
      ? `${this.options.sseEndpointOrigin}/messages?sessionId=${sessionId}`
      : `/messages?sessionId=${sessionId}`;

    if (!this.options.sseWithoutEndpoint) {
      response.write(`event: endpoint\ndata: ${endpoint}\n\n`);
    }

    response.on("close", () => {
      this.openResponses.delete(response);
      this.sseSessions.delete(sessionId);
    });
  }

  private async handleSseMessage(
    url: URL,
    body: string,
    response: http.ServerResponse,
  ): Promise<void> {
    const sessionId: string = url.searchParams.get("sessionId") || "";
    const session: SseSession | undefined = this.sseSessions.get(sessionId);

    if (!session) {
      response.writeHead(404);
      response.end("Unknown session");
      return;
    }

    const message: JSONObject = JSON.parse(body) as JSONObject;

    response.writeHead(202);
    response.end("Accepted");

    if (message["method"] === undefined) {
      this.clientReplies.push(message);
      return;
    }

    if (message["id"] === undefined) {
      return;
    }

    if (this.options.pingBeforeAnswer) {
      session.response.write(
        sseEvent(
          { jsonrpc: "2.0", id: "server-ping-1", method: "ping" },
          "message",
        ),
      );
    }

    const answer: JSONObject | null = await this.answer(message);

    if (answer !== null) {
      session.response.write(sseEvent(answer, "message"));
    }
  }

  // ---- JSON-RPC -------------------------------------------------------------

  private async answer(message: JSONObject): Promise<JSONObject | null> {
    const id: unknown = message["id"];
    const params: JSONObject = (message["params"] as JSONObject) || {};

    switch (message["method"]) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion:
              this.options.protocolVersion ||
              (params["protocolVersion"] as string),
            capabilities: this.options.capabilities ?? { tools: {} },
            serverInfo: {
              name: this.options.serverName || "fake-mcp",
              ...(this.options.serverTitle
                ? { title: this.options.serverTitle }
                : {}),
              version: this.options.serverVersion || "1.2.3",
            },
            ...(this.options.instructions
              ? { instructions: this.options.instructions }
              : {}),
          },
        } as JSONObject;
      case "tools/list":
        return this.listTools(id, params);
      case "tools/call":
        return await this.callTool(id, params);
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Method not found" },
        } as JSONObject;
    }
  }

  private listTools(id: unknown, params: JSONObject): JSONObject {
    const tools: Array<FakeMcpTool> = this.options.tools || [];
    const pageSize: number = this.options.toolsPageSize || tools.length || 1;
    const start: number = Number(params["cursor"] || 0);
    const page: Array<FakeMcpTool> = tools.slice(start, start + pageSize);
    const next: number = start + pageSize;

    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: page.map((tool: FakeMcpTool) => {
          return {
            name: tool.name,
            ...(tool.title ? { title: tool.title } : {}),
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: tool.inputSchema || {
              type: "object",
              properties: {},
            },
            ...(tool.readOnly !== undefined
              ? { annotations: { readOnlyHint: tool.readOnly } }
              : {}),
          };
        }),
        ...(next < tools.length ? { nextCursor: String(next) } : {}),
      },
    } as JSONObject;
  }

  private async callTool(
    id: unknown,
    params: JSONObject,
  ): Promise<JSONObject | null> {
    const name: string = String(params["name"]);
    const args: JSONObject = (params["arguments"] as JSONObject) || {};

    this.calls.push({ name, arguments: args });

    if (this.options.hangOnCall) {
      return null;
    }

    if (this.options.callDelayMs) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, this.options.callDelayMs);
      });
    }

    const tool: FakeMcpTool | undefined = (this.options.tools || []).find(
      (candidate: FakeMcpTool): boolean => {
        return candidate.name === name;
      },
    );

    if (!tool) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `Unknown tool: ${name}` },
      } as JSONObject;
    }

    try {
      const result: JSONObject = tool.handler
        ? await tool.handler(args)
        : { content: [{ type: "text", text: `${name} ran` }] };

      return { jsonrpc: "2.0", id, result } as JSONObject;
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      } as JSONObject;
    }
  }
}

/*
 * The client's way to the fake server: the production transport's own Node
 * HTTP request (redirects refused, the body held to its size), without the
 * egress guard, which refuses the loopback address on purpose.
 */
export class LocalMcpHttpTransport implements McpHttpTransport {
  public readonly sent: Array<McpHttpRequest> = [];

  public async send(request: McpHttpRequest): Promise<McpHttpResponse> {
    this.sent.push(request);

    return await sendNodeHttpRequest({
      url: new URL(request.url),
      request,
      agents: {
        httpAgent: new http.Agent({ keepAlive: false }),
        httpsAgent: new https.Agent({ keepAlive: false }),
      },
    });
  }
}
