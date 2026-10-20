import { JSONObject } from "../../../../Types/JSON";
import ExternalMcpServerTransport from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerTransport";
import { ExternalMcpServerFailureKind } from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";
import {
  EXTERNAL_MCP_CONNECT_TIMEOUT_MS,
  EXTERNAL_MCP_LIST_TIMEOUT_MS,
  EXTERNAL_MCP_TOOL_CALL_TIMEOUT_MS,
  MAX_EXTERNAL_MCP_RESPONSE_BYTES,
  MAX_EXTERNAL_MCP_SERVER_TOOL_PAGES,
  MAX_EXTERNAL_MCP_SERVER_TOOLS,
  MAX_EXTERNAL_MCP_TOOL_NAME_CHARS,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerLimits";
import McpSseParser, {
  McpSseEvent,
  McpSseEventTooLargeError,
} from "./McpSseParser";
import GuardedMcpHttpTransport, {
  McpHttpResponse,
  McpHttpTransport,
  describeConnectionError,
} from "./McpHttpTransport";
import McpClientError from "./McpClientError";

/*
 * AN MCP CLIENT FOR ONE EXTERNAL MCP SERVER - what OneUptime AI uses to
 * list a server's tools and call them.
 *
 * It speaks both of the specification's HTTP transports and works out which
 * one a server speaks the way the specification tells a client to: it POSTs
 * its InitializeRequest to the address (Streamable HTTP, protocol
 * 2025-03-26 and later) and, when the server refuses that with a 4xx, opens
 * an event stream with a GET and waits for its `endpoint` event (the older
 * HTTP+SSE transport, protocol 2024-11-05). A Streamable HTTP answer may be
 * JSON or an event stream; both are read. A session the server ends
 * (HTTP 404 with a session id) is started again once.
 *
 * Only what OneUptime AI needs is spoken: initialize, tools/list and
 * tools/call. OneUptime declares no client capabilities, so a server does
 * not ask it to sample a model, list roots or ask a person something; a
 * `ping` from the server is answered, anything else it asks is answered
 * "method not found", and its notifications (progress, logs) are skipped.
 *
 * The server is outside OneUptime, so the client trusts nothing it says:
 *   - every request has a deadline, and every answer a size limit
 *     (McpHttpTransport cuts the body off; an event is cut off by the SSE
 *     parser);
 *   - the address an HTTP+SSE server gives for its messages must be on the
 *     same origin as the address it was reached on;
 *   - what the server answers is parsed defensively and handed on as data
 *     (see McpToolResult) - never run, never followed;
 *   - a message the client writes for people never holds a sign-in value
 *     (redact): a server can echo a token back in an error.
 */

// The version OneUptime asks for. A server may answer with another it speaks.
export const MCP_CLIENT_PROTOCOL_VERSION: string = "2025-11-25";

export const MCP_KNOWN_PROTOCOL_VERSIONS: ReadonlyArray<string> = [
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
];

/*
 * The most an HTTP+SSE server's event stream may carry over the whole
 * session: every answer of the session arrives on it, each one held to the
 * per-answer limit by the parser.
 */
const MAX_SSE_STREAM_BYTES: number = 64 * 1024 * 1024;

// How long closing a session may take before it is left to the server.
const CLOSE_TIMEOUT_MS: number = 5 * 1000;

// How much of an error answer is read to say what the server said.
const MAX_ERROR_EXCERPT_CHARS: number = 300;

const REDACTED: string = "[redacted]";

export const JSON_RPC_METHOD_NOT_FOUND: number = -32601;

export interface McpClientInfo {
  name: string;
  title?: string | undefined;
  version: string;
}

export interface McpClientOptions {
  url: string;
  /*
   * The sign-in headers, asked for before every request: an OAuth token is
   * fetched again when it is about to expire.
   */
  getSignInHeaders: () => Promise<Record<string, string>>;
  // The sign-in values to keep out of every message (tokens, header values).
  getSecretValues: () => Array<string>;
  clientInfo: McpClientInfo;
  userAgent: string;
  transport?: McpHttpTransport | undefined;
  connectTimeoutMs?: number | undefined;
  listTimeoutMs?: number | undefined;
  callTimeoutMs?: number | undefined;
  maxResponseBytes?: number | undefined;
}

export interface McpServerHandshake {
  transport: ExternalMcpServerTransport;
  protocolVersion: string;
  serverName?: string | undefined;
  serverTitle?: string | undefined;
  serverVersion?: string | undefined;
  // What the server tells its clients about itself, if anything.
  instructions?: string | undefined;
  /*
   * The server offers tools: its capabilities name them (or it sent no
   * capabilities at all, and is asked anyway).
   */
  offersTools: boolean;
}

export interface McpToolDescription {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  inputSchema: JSONObject;
  // The server marks it read-only (annotations.readOnlyHint).
  readsOnly: boolean;
}

export interface McpToolList {
  tools: Array<McpToolDescription>;
  // Tools past MAX_EXTERNAL_MCP_SERVER_TOOLS (or on pages not read).
  leftOut: number;
  // False when the server had more pages than were read.
  isComplete: boolean;
}

// A tools/call result, as the server sent it (McpToolResult reads it).
export type McpToolCallResultJson = JSONObject;

interface JsonRpcError {
  code?: unknown;
  message?: unknown;
}

interface JsonRpcMessage {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcError | undefined;
}

interface PendingRequest {
  resolve: (message: JsonRpcMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// The server ended the session: start a new one and send the request again.
class SessionEndedError extends Error {}

// The server does not speak Streamable HTTP here: try HTTP+SSE.
class StreamableHttpRefusedError extends Error {
  public readonly status: number;

  public constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// The key a JSON-RPC id is filed under: a number and its text are the same id.
function idKey(id: unknown): string {
  return typeof id === "number" || typeof id === "string" ? String(id) : "";
}

/*
 * One tool of a tools/list answer, or null when it is not one: a name of at
 * most MAX_EXTERNAL_MCP_TOOL_NAME_CHARS, an object input schema (one that is
 * not becomes the empty object schema), and whether the server marks it
 * read-only.
 */
export function readMcpToolDescription(
  value: unknown,
): McpToolDescription | null {
  if (!isObject(value)) {
    return null;
  }

  const name: unknown = value["name"];

  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > MAX_EXTERNAL_MCP_TOOL_NAME_CHARS
  ) {
    return null;
  }

  const annotations: Record<string, unknown> = isObject(value["annotations"])
    ? value["annotations"]
    : {};
  const schema: unknown = value["inputSchema"];

  const tool: McpToolDescription = {
    name: name.trim(),
    inputSchema:
      isObject(schema) && schema["type"] === "object"
        ? (schema as JSONObject)
        : { type: "object", properties: {} },
    readsOnly: annotations["readOnlyHint"] === true,
  };

  const title: string | undefined =
    readText(value["title"]) || readText(annotations["title"]);
  const description: string | undefined = readText(value["description"]);

  if (title) {
    tool.title = title;
  }

  if (description) {
    tool.description = description;
  }

  return tool;
}

export default class McpClient {
  private readonly options: McpClientOptions;
  private readonly transport: McpHttpTransport;
  private readonly connectTimeoutMs: number;
  private readonly listTimeoutMs: number;
  private readonly callTimeoutMs: number;
  private readonly maxResponseBytes: number;

  private handshake: McpServerHandshake | null = null;
  private connecting: Promise<McpServerHandshake> | null = null;
  private sessionId: string | undefined = undefined;
  private nextRequestId: number = 1;
  private isClosed: boolean = false;

  // HTTP+SSE: where messages are POSTed, the open stream, what waits on it.
  private sseEndpoint: string | undefined = undefined;
  private sseStream: McpHttpResponse | undefined = undefined;
  private sseAbort: AbortController | undefined = undefined;
  private ssePending: Map<string, PendingRequest> = new Map<
    string,
    PendingRequest
  >();

  public constructor(options: McpClientOptions) {
    this.options = options;
    this.transport = options.transport || new GuardedMcpHttpTransport();
    this.connectTimeoutMs =
      options.connectTimeoutMs ?? EXTERNAL_MCP_CONNECT_TIMEOUT_MS;
    this.listTimeoutMs = options.listTimeoutMs ?? EXTERNAL_MCP_LIST_TIMEOUT_MS;
    this.callTimeoutMs =
      options.callTimeoutMs ?? EXTERNAL_MCP_TOOL_CALL_TIMEOUT_MS;
    this.maxResponseBytes =
      options.maxResponseBytes ?? MAX_EXTERNAL_MCP_RESPONSE_BYTES;
  }

  /*
   * Text with every sign-in value taken out, at most `maxChars` long:
   * anything a server or a socket said, before it goes in a message.
   */
  public redact(text: string, maxChars: number = 1000): string {
    let redacted: string = text || "";

    for (const secret of this.options.getSecretValues()) {
      if (typeof secret === "string" && secret.length >= 4) {
        // split/join: an exact, linear replacement of every occurrence.
        redacted = redacted.split(secret).join(REDACTED);
      }
    }

    return redacted.length > maxChars
      ? `${redacted.slice(0, maxChars - 1)}…`
      : redacted;
  }

  // Connects (once) and says what the server is.
  public async connect(): Promise<McpServerHandshake> {
    if (this.isClosed) {
      throw new McpClientError({
        kind: ExternalMcpServerFailureKind.Other,
        message: "The connection to the MCP server was closed.",
      });
    }

    if (this.handshake) {
      return this.handshake;
    }

    if (!this.connecting) {
      this.connecting = this.startSession().finally(() => {
        this.connecting = null;
      });
    }

    return await this.connecting;
  }

  /*
   * Every tool the server offers, up to MAX_EXTERNAL_MCP_SERVER_TOOLS. A
   * server that offers none (its capabilities leave tools out, or it does
   * not know tools/list) has an empty list.
   */
  public async listTools(): Promise<McpToolList> {
    const handshake: McpServerHandshake = await this.connect();

    if (!handshake.offersTools) {
      return { tools: [], leftOut: 0, isComplete: true };
    }

    try {
      return await this.readToolPages();
    } catch (error) {
      if (
        error instanceof McpClientError &&
        error.rpcCode === JSON_RPC_METHOD_NOT_FOUND
      ) {
        return { tools: [], leftOut: 0, isComplete: true };
      }

      throw error;
    }
  }

  private async readToolPages(): Promise<McpToolList> {
    const tools: Array<McpToolDescription> = [];
    const names: Set<string> = new Set<string>();
    let leftOut: number = 0;
    let cursor: string | undefined = undefined;
    let pages: number = 0;

    do {
      const result: unknown = await this.request(
        "tools/list",
        cursor ? { cursor } : {},
        this.listTimeoutMs,
      );

      pages++;

      const resultObject: Record<string, unknown> = isObject(result)
        ? result
        : {};
      const rawTools: Array<unknown> = Array.isArray(resultObject["tools"])
        ? (resultObject["tools"] as Array<unknown>)
        : [];

      for (const rawTool of rawTools) {
        const tool: McpToolDescription | null =
          readMcpToolDescription(rawTool);

        if (!tool || names.has(tool.name)) {
          continue;
        }

        names.add(tool.name);

        if (tools.length >= MAX_EXTERNAL_MCP_SERVER_TOOLS) {
          leftOut++;
          continue;
        }

        tools.push(tool);
      }

      cursor = readText(resultObject["nextCursor"]);

      if (cursor && tools.length >= MAX_EXTERNAL_MCP_SERVER_TOOLS) {
        break;
      }
    } while (cursor && pages < MAX_EXTERNAL_MCP_SERVER_TOOL_PAGES);

    return { tools, leftOut, isComplete: !cursor };
  }

  /*
   * Calls one tool and returns the server's result as it sent it. A tool
   * that failed is a result too (isError); a request the server refused
   * (an unknown tool, wrong arguments) throws McpClientError.
   */
  public async callTool(data: {
    name: string;
    arguments: JSONObject;
    timeoutMs?: number | undefined;
  }): Promise<McpToolCallResultJson> {
    const result: unknown = await this.request(
      "tools/call",
      { name: data.name, arguments: data.arguments },
      data.timeoutMs ?? this.callTimeoutMs,
    );

    return isObject(result) ? (result as JSONObject) : {};
  }

  // Ends the session. Never throws.
  public async close(): Promise<void> {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;

    const handshake: McpServerHandshake | null = this.handshake;
    this.handshake = null;

    this.failSsePending(
      new McpClientError({
        kind: ExternalMcpServerFailureKind.Other,
        message: "The connection to the MCP server was closed.",
      }),
    );
    this.closeSseStream();

    if (
      handshake?.transport === ExternalMcpServerTransport.StreamableHttp &&
      this.sessionId
    ) {
      const abort: AbortController = new AbortController();
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        abort.abort();
      }, CLOSE_TIMEOUT_MS);

      try {
        const response: McpHttpResponse = await this.transport.send({
          method: "DELETE",
          url: this.options.url,
          headers: await this.buildHeaders({
            "Mcp-Session-Id": this.sessionId,
            "MCP-Protocol-Version": handshake.protocolVersion,
          }),
          signal: abort.signal,
          maxResponseBytes: 1024,
        });
        response.close();
      } catch {
        // The server ends a session it no longer hears from on its own.
      } finally {
        clearTimeout(timer);
      }
    }

    this.sessionId = undefined;
  }

  // ---- the session ----------------------------------------------------------

  private async startSession(): Promise<McpServerHandshake> {
    const deadlineAt: number = Date.now() + this.connectTimeoutMs;

    try {
      this.handshake = await this.startStreamableHttpSession(deadlineAt);
    } catch (error) {
      if (!(error instanceof StreamableHttpRefusedError)) {
        throw error;
      }

      this.handshake = await this.startSseSession({
        deadlineAt,
        postStatus: error.status,
      });
    }

    return this.handshake;
  }

  private buildInitializeParams(): JSONObject {
    const clientInfo: JSONObject = {
      name: this.options.clientInfo.name,
      version: this.options.clientInfo.version,
    };

    if (this.options.clientInfo.title) {
      clientInfo["title"] = this.options.clientInfo.title;
    }

    return {
      protocolVersion: MCP_CLIENT_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo,
    };
  }

  private readHandshake(
    result: unknown,
    transport: ExternalMcpServerTransport,
  ): McpServerHandshake {
    if (!isObject(result) || typeof result["protocolVersion"] !== "string") {
      throw new McpClientError({
        kind: ExternalMcpServerFailureKind.NotAnMcpServer,
        message:
          "The server answered the InitializeRequest without a protocol version, so it is not an MCP server OneUptime can use.",
      });
    }

    const serverInfo: Record<string, unknown> = isObject(result["serverInfo"])
      ? result["serverInfo"]
      : {};
    const capabilities: unknown = result["capabilities"];

    const handshake: McpServerHandshake = {
      transport,
      protocolVersion: String(result["protocolVersion"]).slice(0, 40),
      offersTools: !isObject(capabilities) || isObject(capabilities["tools"]),
    };

    const serverName: string | undefined = readText(serverInfo["name"]);
    const serverTitle: string | undefined = readText(serverInfo["title"]);
    const serverVersion: string | undefined = readText(serverInfo["version"]);
    const instructions: string | undefined = readText(result["instructions"]);

    if (serverName) {
      handshake.serverName = serverName.slice(0, 200);
    }

    if (serverTitle) {
      handshake.serverTitle = serverTitle.slice(0, 200);
    }

    if (serverVersion) {
      handshake.serverVersion = serverVersion.slice(0, 60);
    }

    if (instructions) {
      handshake.instructions = instructions.slice(0, 4000);
    }

    return handshake;
  }

  private async startStreamableHttpSession(
    deadlineAt: number,
  ): Promise<McpServerHandshake> {
    this.sessionId = undefined;

    const id: number = this.nextRequestId++;
    const abort: AbortController = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => {
        abort.abort();
      },
      Math.max(1, deadlineAt - Date.now()),
    );

    try {
      const response: McpHttpResponse = await this.sendOrDescribe({
        method: "POST",
        url: this.options.url,
        headers: await this.buildHeaders({
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        }),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "initialize",
          params: this.buildInitializeParams(),
        }),
        signal: abort.signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw await this.describeSignInRefusal(response);
      }

      if (response.status >= 400 && response.status < 500) {
        response.close();
        throw new StreamableHttpRefusedError(response.status);
      }

      if (response.status < 200 || response.status >= 300) {
        throw await this.describeHttpFailure(response);
      }

      const sessionId: string | undefined = readText(
        response.headers["mcp-session-id"],
      );

      const message: JsonRpcMessage = await this.readStreamableAnswer({
        response,
        id,
        isInitialize: true,
      });

      const handshake: McpServerHandshake = this.readHandshake(
        this.readResult(message),
        ExternalMcpServerTransport.StreamableHttp,
      );

      this.sessionId = sessionId;

      await this.notifyStreamable(
        "notifications/initialized",
        handshake.protocolVersion,
        abort.signal,
      );

      return handshake;
    } catch (error) {
      if (error instanceof StreamableHttpRefusedError) {
        throw error;
      }

      throw this.describeFailure(error, abort.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private async startSseSession(data: {
    deadlineAt: number;
    postStatus: number;
  }): Promise<McpServerHandshake> {
    this.closeSseStream();

    const abort: AbortController = new AbortController();
    this.sseAbort = abort;

    const connectTimer: ReturnType<typeof setTimeout> = setTimeout(
      () => {
        if (!this.sseEndpoint) {
          abort.abort();
        }
      },
      Math.max(1, data.deadlineAt - Date.now()),
    );

    try {
      const response: McpHttpResponse = await this.sendOrDescribe({
        method: "GET",
        url: this.options.url,
        headers: await this.buildHeaders({ Accept: "text/event-stream" }),
        signal: abort.signal,
        maxResponseBytes: MAX_SSE_STREAM_BYTES,
      });

      if (response.status === 401 || response.status === 403) {
        throw await this.describeSignInRefusal(response);
      }

      const contentType: string = response.headers["content-type"] || "";

      if (
        response.status !== 200 ||
        !contentType.toLowerCase().includes("text/event-stream")
      ) {
        response.close();
        throw new McpClientError({
          kind: ExternalMcpServerFailureKind.NotAnMcpServer,
          message: `The server did not answer as an MCP server: a POST of the InitializeRequest got HTTP ${data.postStatus}, and a GET for an event stream got HTTP ${response.status}${contentType ? ` (${this.redact(contentType, 80)})` : ""}.`,
          status: response.status,
        });
      }

      this.sseStream = response;

      const endpoint: string = await this.readSseEndpoint(response);

      clearTimeout(connectTimer);

      this.sseEndpoint = endpoint;

      const message: JsonRpcMessage = await this.requestOverSse({
        method: "initialize",
        params: this.buildInitializeParams(),
        timeoutMs: Math.max(1, data.deadlineAt - Date.now()),
      });

      const handshake: McpServerHandshake = this.readHandshake(
        this.readResult(message),
        ExternalMcpServerTransport.Sse,
      );

      await this.postSseMessage({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      return handshake;
    } catch (error) {
      this.closeSseStream();
      throw this.describeFailure(error, abort.signal);
    } finally {
      clearTimeout(connectTimer);
    }
  }

  /*
   * Reads the stream until the server says where to send messages (its
   * `endpoint` event), then keeps reading it in the background: every
   * answer of the session arrives on it.
   */
  private async readSseEndpoint(response: McpHttpResponse): Promise<string> {
    return await new Promise<string>(
      (resolve: (endpoint: string) => void, reject: (error: Error) => void) => {
        let isEndpointKnown: boolean = false;

        const onEndpoint: (data: string) => void = (data: string): void => {
          if (isEndpointKnown) {
            return;
          }

          isEndpointKnown = true;

          try {
            resolve(this.resolveSseEndpoint(data));
          } catch (error) {
            reject(error as Error);
          }
        };

        const onEnd: (error: Error) => void = (error: Error): void => {
          if (!isEndpointKnown) {
            isEndpointKnown = true;
            reject(error);
          }
        };

        void this.pumpSseStream({ response, onEndpoint, onEnd });
      },
    );
  }

  /*
   * The address an HTTP+SSE server gave for its messages, read against the
   * address it was reached on. It must be on the same origin: a server may
   * not send OneUptime's requests - with their sign-in headers - anywhere
   * else.
   */
  private resolveSseEndpoint(data: string): string {
    let endpoint: URL;
    const base: URL = new URL(this.options.url);

    try {
      endpoint = new URL(data.trim(), base);
    } catch {
      throw new McpClientError({
        kind: ExternalMcpServerFailureKind.NotAnMcpServer,
        message:
          "The server's event stream gave an address for its messages that is not a URL.",
      });
    }

    if (endpoint.origin !== base.origin) {
      throw new McpClientError({
        kind: ExternalMcpServerFailureKind.NotAnMcpServer,
        message:
          "The server asked OneUptime to send its messages to another host. OneUptime only sends them to the host of the URL you gave.",
      });
    }

    return endpoint.toString();
  }

  private async pumpSseStream(data: {
    response: McpHttpResponse;
    onEndpoint: (data: string) => void;
    onEnd: (error: Error) => void;
  }): Promise<void> {
    const parser: McpSseParser = new McpSseParser({
      maxEventChars: this.maxResponseBytes,
    });

    let endError: Error = new McpClientError({
      kind: ExternalMcpServerFailureKind.Unreachable,
      message: "The server closed its event stream.",
    });

    try {
      for await (const chunk of data.response.readChunks()) {
        for (const event of parser.push(chunk)) {
          if (event.event === "endpoint") {
            data.onEndpoint(event.data);
            continue;
          }

          if (event.event !== "message") {
            continue;
          }

          for (const message of this.readMessages(event.data)) {
            this.handleSseMessage(message);
          }
        }
      }
    } catch (error) {
      endError = this.describeFailure(error, this.sseAbort?.signal);
    }

    data.onEnd(endError);

    // The session is over: the next request starts a new one.
    if (this.sseStream === data.response) {
      this.sseStream = undefined;
      this.sseEndpoint = undefined;
      this.handshake = null;
      this.failSsePending(endError);
    }
  }

  private handleSseMessage(message: JsonRpcMessage): void {
    if (typeof message.method === "string") {
      if (message.id !== undefined && message.id !== null) {
        void this.postSseMessage(this.buildReply(message)).catch(() => {
          // The server asks again or goes on without the answer.
        });
      }
      return;
    }

    const pending: PendingRequest | undefined = this.ssePending.get(
      idKey(message.id),
    );

    if (!pending) {
      return;
    }

    this.ssePending.delete(idKey(message.id));
    clearTimeout(pending.timer);
    pending.resolve(message);
  }

  private failSsePending(error: Error): void {
    for (const pending of this.ssePending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }

    this.ssePending.clear();
  }

  private closeSseStream(): void {
    const stream: McpHttpResponse | undefined = this.sseStream;
    const abort: AbortController | undefined = this.sseAbort;

    this.sseStream = undefined;
    this.sseEndpoint = undefined;
    this.sseAbort = undefined;

    stream?.close();
    abort?.abort();
  }

  // ---- requests -------------------------------------------------------------

  private async request(
    method: string,
    params: JSONObject,
    timeoutMs: number,
  ): Promise<unknown> {
    const handshake: McpServerHandshake = await this.connect();

    try {
      return await this.requestOnce(handshake, method, params, timeoutMs);
    } catch (error) {
      if (!(error instanceof SessionEndedError)) {
        throw error;
      }

      // The server ended the session: start a new one, and ask once more.
      this.handshake = null;
      this.sessionId = undefined;

      const newHandshake: McpServerHandshake = await this.connect();

      return await this.requestOnce(newHandshake, method, params, timeoutMs);
    }
  }

  private async requestOnce(
    handshake: McpServerHandshake,
    method: string,
    params: JSONObject,
    timeoutMs: number,
  ): Promise<unknown> {
    if (handshake.transport === ExternalMcpServerTransport.Sse) {
      return this.readResult(
        await this.requestOverSse({ method, params, timeoutMs }),
      );
    }

    const id: number = this.nextRequestId++;
    const abort: AbortController = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => {
        abort.abort();
      },
      Math.max(1, timeoutMs),
    );

    try {
      const response: McpHttpResponse = await this.sendOrDescribe({
        method: "POST",
        url: this.options.url,
        headers: await this.buildHeaders({
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...this.getSessionHeaders(handshake),
        }),
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: abort.signal,
      });

      if (response.status === 404 && this.sessionId) {
        response.close();
        throw new SessionEndedError("The server ended the session.");
      }

      if (response.status === 401 || response.status === 403) {
        throw await this.describeSignInRefusal(response);
      }

      if (response.status < 200 || response.status >= 300) {
        throw await this.describeHttpFailure(response);
      }

      return this.readResult(
        await this.readStreamableAnswer({
          response,
          id,
          isInitialize: false,
        }),
      );
    } catch (error) {
      if (error instanceof SessionEndedError) {
        throw error;
      }

      throw this.describeFailure(error, abort.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private getSessionHeaders(
    handshake: McpServerHandshake,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "MCP-Protocol-Version": handshake.protocolVersion,
    };

    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    return headers;
  }

  private async notifyStreamable(
    method: string,
    protocolVersion: string,
    signal: AbortSignal,
  ): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": protocolVersion,
    };

    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const response: McpHttpResponse = await this.sendOrDescribe({
      method: "POST",
      url: this.options.url,
      headers: await this.buildHeaders(headers),
      body: JSON.stringify({ jsonrpc: "2.0", method }),
      signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw await this.describeSignInRefusal(response);
    }

    if (response.status < 200 || response.status >= 300) {
      throw await this.describeHttpFailure(response);
    }

    response.close();
  }

  /*
   * The answer to request `id` in a Streamable HTTP response: the JSON body
   * (one message or a batch), or the event stream, read until the answer
   * arrives. Requests the server sends on the stream are answered.
   */
  private async readStreamableAnswer(data: {
    response: McpHttpResponse;
    id: number;
    isInitialize: boolean;
  }): Promise<JsonRpcMessage> {
    const contentType: string = (
      data.response.headers["content-type"] || ""
    ).toLowerCase();

    if (contentType.includes("text/event-stream")) {
      const parser: McpSseParser = new McpSseParser({
        maxEventChars: this.maxResponseBytes,
      });

      try {
        for await (const chunk of data.response.readChunks()) {
          for (const event of parser.push(chunk)) {
            if (event.event !== "message") {
              continue;
            }

            for (const message of this.readMessages(event.data)) {
              if (typeof message.method === "string") {
                if (message.id !== undefined && message.id !== null) {
                  void this.replyStreamable(message).catch(() => {
                    // The server asks again or goes on without the answer.
                  });
                }
                continue;
              }

              if (idKey(message.id) === String(data.id)) {
                return message;
              }
            }
          }
        }
      } finally {
        data.response.close();
      }

      throw new McpClientError({
        kind: ExternalMcpServerFailureKind.NotAnMcpServer,
        message: "The server closed its event stream before it answered.",
      });
    }

    if (contentType.includes("json")) {
      const body: string = await this.readBody(data.response);

      for (const message of this.readMessages(body)) {
        if (
          typeof message.method !== "string" &&
          idKey(message.id) === String(data.id)
        ) {
          return message;
        }
      }

      throw new McpClientError({
        kind: ExternalMcpServerFailureKind.NotAnMcpServer,
        message: "The server's answer did not answer the request.",
      });
    }

    data.response.close();

    throw new McpClientError({
      kind: ExternalMcpServerFailureKind.NotAnMcpServer,
      message: data.isInitialize
        ? `The server answered the InitializeRequest with ${contentType ? this.redact(contentType, 80) : "no content type"}, not JSON or an event stream, so it is not an MCP server.`
        : `The server answered with ${contentType ? this.redact(contentType, 80) : "no content type"}, not JSON or an event stream.`,
    });
  }

  // A request of the session's own on an HTTP+SSE server.
  private async requestOverSse(data: {
    method: string;
    params: JSONObject;
    timeoutMs: number;
  }): Promise<JsonRpcMessage> {
    const id: number = this.nextRequestId++;

    const answer: Promise<JsonRpcMessage> = new Promise<JsonRpcMessage>(
      (
        resolve: (message: JsonRpcMessage) => void,
        reject: (error: Error) => void,
      ) => {
        const timer: ReturnType<typeof setTimeout> = setTimeout(
          () => {
            this.ssePending.delete(String(id));
            reject(
              new McpClientError({
                kind: ExternalMcpServerFailureKind.TimedOut,
                message: "The server did not answer in time.",
              }),
            );
          },
          Math.max(1, data.timeoutMs),
        );

        this.ssePending.set(String(id), { resolve, reject, timer });
      },
    );

    try {
      await this.postSseMessage({
        jsonrpc: "2.0",
        id,
        method: data.method,
        params: data.params,
      });
    } catch (error) {
      const pending: PendingRequest | undefined = this.ssePending.get(
        String(id),
      );

      if (pending) {
        this.ssePending.delete(String(id));
        clearTimeout(pending.timer);
      }

      // The answer will never come: nothing waits for it.
      answer.catch(() => {});
      throw error;
    }

    return await answer;
  }

  private async postSseMessage(message: JsonRpcMessage): Promise<void> {
    const endpoint: string | undefined = this.sseEndpoint;

    if (!endpoint) {
      throw new McpClientError({
        kind: ExternalMcpServerFailureKind.Unreachable,
        message: "The server's event stream is closed.",
      });
    }

    const abort: AbortController = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      abort.abort();
    }, this.callTimeoutMs);

    try {
      const response: McpHttpResponse = await this.sendOrDescribe({
        method: "POST",
        url: endpoint,
        headers: await this.buildHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(message),
        signal: abort.signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw await this.describeSignInRefusal(response);
      }

      if (response.status < 200 || response.status >= 300) {
        throw await this.describeHttpFailure(response);
      }

      response.close();
    } catch (error) {
      throw this.describeFailure(error, abort.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private async replyStreamable(message: JsonRpcMessage): Promise<void> {
    const handshake: McpServerHandshake | null = this.handshake;
    const abort: AbortController = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      abort.abort();
    }, CLOSE_TIMEOUT_MS);

    try {
      const response: McpHttpResponse = await this.transport.send({
        method: "POST",
        url: this.options.url,
        headers: await this.buildHeaders({
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(handshake ? this.getSessionHeaders(handshake) : {}),
        }),
        body: JSON.stringify(this.buildReply(message)),
        signal: abort.signal,
        maxResponseBytes: 1024,
      });
      response.close();
    } finally {
      clearTimeout(timer);
    }
  }

  // The answer to a request the server sent: ping is answered, nothing else.
  private buildReply(message: JsonRpcMessage): JsonRpcMessage {
    if (message.method === "ping") {
      return { jsonrpc: "2.0", id: message.id, result: {} };
    }

    return {
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: JSON_RPC_METHOD_NOT_FOUND,
        message: "Method not found",
      },
    };
  }

  // ---- reading answers ------------------------------------------------------

  // The JSON-RPC messages in a body or an event: one message, or a batch.
  private readMessages(text: string): Array<JsonRpcMessage> {
    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw new McpClientError({
        kind: ExternalMcpServerFailureKind.NotAnMcpServer,
        message: "The server sent a message that is not JSON.",
      });
    }

    const messages: Array<unknown> = Array.isArray(parsed) ? parsed : [parsed];

    return messages.filter((message: unknown): boolean => {
      return isObject(message);
    }) as Array<JsonRpcMessage>;
  }

  // The result of an answer, or its error as an McpClientError.
  private readResult(message: JsonRpcMessage): unknown {
    if (isObject(message.error)) {
      const error: JsonRpcError = message.error as JsonRpcError;
      const errorMessage: string = readText(error.message) || "Unknown error";
      const rpcCode: number | undefined =
        typeof error.code === "number" ? error.code : undefined;
      const code: string = rpcCode !== undefined ? ` (code ${rpcCode})` : "";

      throw new McpClientError({
        kind: ExternalMcpServerFailureKind.ServerError,
        message: `The server answered with an error${code}: ${this.redact(errorMessage, 500)}`,
        rpcCode,
      });
    }

    return message.result;
  }

  private async readBody(response: McpHttpResponse): Promise<string> {
    let body: string = "";

    for await (const chunk of response.readChunks()) {
      body += chunk;
    }

    return body;
  }

  // At most MAX_ERROR_EXCERPT_CHARS of an error answer, then the connection is closed.
  private async readErrorExcerpt(response: McpHttpResponse): Promise<string> {
    let excerpt: string = "";

    try {
      for await (const chunk of response.readChunks()) {
        excerpt += chunk;

        if (excerpt.length >= MAX_ERROR_EXCERPT_CHARS) {
          break;
        }
      }
    } catch {
      // What was read is enough.
    } finally {
      response.close();
    }

    const trimmed: string = excerpt.trim();

    // A JSON-RPC error says it best.
    try {
      const parsed: unknown = JSON.parse(trimmed);

      if (isObject(parsed) && isObject(parsed["error"])) {
        const message: string | undefined = readText(
          (parsed["error"] as Record<string, unknown>)["message"],
        );

        if (message) {
          return this.redact(message, MAX_ERROR_EXCERPT_CHARS);
        }
      }
    } catch {
      // Not JSON: the text itself.
    }

    return this.redact(trimmed, MAX_ERROR_EXCERPT_CHARS);
  }

  private async describeSignInRefusal(
    response: McpHttpResponse,
  ): Promise<McpClientError> {
    const challenge: string = (
      response.headers["www-authenticate"] || ""
    ).toLowerCase();
    const excerpt: string = await this.readErrorExcerpt(response);
    const asksForOAuth: boolean = challenge.includes("resource_metadata");

    return new McpClientError({
      kind: ExternalMcpServerFailureKind.SignInRefused,
      status: response.status,
      message: `The server refused the sign-in (HTTP ${response.status})${
        excerpt ? `: ${excerpt}` : "."
      }${
        asksForOAuth
          ? " It asks for an OAuth sign-in in a browser, which OneUptime cannot do for an unattended investigation. Use an API token or headers it accepts, or OAuth client credentials."
          : ""
      }`,
    });
  }

  private async describeHttpFailure(
    response: McpHttpResponse,
  ): Promise<McpClientError> {
    const excerpt: string = await this.readErrorExcerpt(response);

    return new McpClientError({
      kind:
        response.status >= 500
          ? ExternalMcpServerFailureKind.ServerError
          : ExternalMcpServerFailureKind.NotAnMcpServer,
      status: response.status,
      message: `The server answered with HTTP ${response.status}${
        excerpt ? `: ${excerpt}` : "."
      }`,
    });
  }

  /*
   * Any failure as an McpClientError: one that already is (with its message
   * redacted again), a request aborted by its deadline, an event too large,
   * or a socket error.
   */
  private describeFailure(
    error: unknown,
    signal?: AbortSignal | undefined,
  ): McpClientError {
    if (error instanceof McpClientError) {
      return new McpClientError({
        kind: error.kind,
        message: this.redact(error.message),
        status: error.status,
        rpcCode: error.rpcCode,
      });
    }

    if (error instanceof McpSseEventTooLargeError) {
      return new McpClientError({
        kind: ExternalMcpServerFailureKind.TooLarge,
        message: error.message,
      });
    }

    if (signal?.aborted) {
      return new McpClientError({
        kind: ExternalMcpServerFailureKind.TimedOut,
        message: "The server did not answer in time.",
      });
    }

    const described: McpClientError = describeConnectionError(error);

    return new McpClientError({
      kind: described.kind,
      message: this.redact(described.message),
      status: described.status,
    });
  }

  private async sendOrDescribe(data: {
    method: "GET" | "POST" | "DELETE";
    url: string;
    headers: Record<string, string>;
    body?: string | undefined;
    signal: AbortSignal;
    maxResponseBytes?: number | undefined;
  }): Promise<McpHttpResponse> {
    try {
      return await this.transport.send({
        method: data.method,
        url: data.url,
        headers: data.headers,
        body: data.body,
        signal: data.signal,
        maxResponseBytes: data.maxResponseBytes ?? this.maxResponseBytes,
      });
    } catch (error) {
      throw this.describeFailure(error, data.signal);
    }
  }

  // The sign-in headers, then OneUptime's own (which a sign-in may not replace).
  private async buildHeaders(
    own: Record<string, string>,
  ): Promise<Record<string, string>> {
    const signIn: Record<string, string> =
      await this.options.getSignInHeaders();

    return {
      ...signIn,
      "User-Agent": this.options.userAgent,
      ...own,
    };
  }
}

export type { McpSseEvent };
