/**
 * Route Handler
 * Sets up Express routes for the MCP server.
 *
 * The Streamable HTTP transport runs in STATELESS mode: every POST creates a
 * fresh McpServer + StreamableHTTPServerTransport, handles that single request,
 * and tears it down. No session state is kept in process memory, so the server
 * works correctly behind a horizontally-scaled / multi-replica deployment where
 * consecutive requests from the same client land on different workers.
 *
 * The previous implementation kept sessions in a per-process in-memory Map. With
 * more than one replica running (as on oneuptime.com), `initialize` created the
 * session on one worker and every subsequent request was load-balanced to another
 * worker that had no record of it, so the whole MCP handshake failed with
 * "404 MCP session not found" — see GitHub issue #2459.
 *
 * Stateless mode is safe here because the OneUptime tools carry no per-session
 * state: `tools/list` is derived from the tool list bound at route setup and
 * every `tools/call` authenticates with the API key supplied on that same
 * request (x-api-key / Authorization header).
 *
 * Before a request reaches the SDK transport it goes through the compatibility
 * negotiation in Utils/TransportNegotiation: the protocol version is negotiated
 * down to the best mutually supported one and the response format is chosen
 * from the client's Accept header. Without that, clients newer than the bundled
 * SDK — or clients that send a wildcard Accept — were turned away at the
 * transport layer with an error the user could only see in container logs
 * (GitHub issue #3695).
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  ExpressJson,
} from "Common/Server/Utils/Express";
import { createMCPServerInstance, McpServer } from "../Server/MCPServer";
import { registerToolHandlers } from "./ToolHandler";
import { McpToolInfo } from "../Types/McpTypes";
import { ROUTE_PREFIXES, API_KEY_HEADERS } from "../Config/ServerConfig";
import {
  ACCEPT_HEADER,
  AcceptNegotiationResult,
  KNOWN_PROTOCOL_VERSIONS,
  MCP_PROTOCOL_VERSION_HEADER,
  NORMALIZED_ACCEPT_HEADER,
  ProtocolNegotiationOutcome,
  ProtocolNegotiationResult,
  ResponseFormat,
  HeaderMutableRequest,
  getLatestSupportedProtocolVersion,
  isInitializeRequestBody,
  negotiateProtocolVersion,
  negotiateResponseFormat,
  readHeaderValue,
  removeRequestHeader,
  sanitizeForLog,
  setRequestHeader,
} from "../Utils/TransportNegotiation";
import logger from "Common/Server/Utils/Logger";

// Type for MCP handler function
type McpHandlerFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

/**
 * Extract API key from request headers
 */
export function extractApiKey(req: ExpressRequest): string | undefined {
  for (const header of API_KEY_HEADERS) {
    const value: string | undefined = req.headers[header] as string | undefined;
    if (value) {
      // Handle Bearer token format (scheme is case-insensitive per RFC 7235)
      if (header === "authorization") {
        const match: RegExpMatchArray | null = value.match(/^Bearer\s+(.+)$/i);
        return match?.[1] ? match[1].trim() : value;
      }
      return value;
    }
  }
  return undefined;
}

/**
 * Setup all MCP-specific routes on the Express app
 */
export function setupMCPRoutes(
  app: ExpressApplication,
  tools: McpToolInfo[],
): void {
  ROUTE_PREFIXES.forEach((prefix: string) => {
    setupRoutesForPrefix(app, prefix, tools);
  });

  logger.info(
    `MCP routes setup complete (stateless mode) for prefixes: ${ROUTE_PREFIXES.join(", ")}`,
  );
}

/**
 * Middleware to add MCP-specific CORS headers so browser-based MCP clients can
 * send the auth and protocol headers. The stateless server never issues an
 * `mcp-session-id`, so that header is neither allowed nor exposed.
 */
function mcpCorsMiddleware(
  _req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void {
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, mcp-protocol-version, x-api-key",
  );
  next();
}

/**
 * Setup routes for a specific prefix
 */
function setupRoutesForPrefix(
  app: ExpressApplication,
  prefix: string,
  tools: McpToolInfo[],
): void {
  const mcpEndpoint: string = prefix;
  const mcpHandler: McpHandlerFunction = createMCPHandler(tools);

  // MCP endpoint for all methods (GET for SSE, POST for requests, DELETE for cleanup)
  app.get(mcpEndpoint, mcpCorsMiddleware, mcpHandler);
  app.post(mcpEndpoint, mcpCorsMiddleware, ExpressJson(), mcpHandler);
  app.delete(mcpEndpoint, mcpCorsMiddleware, mcpHandler);

  // OPTIONS handler for CORS preflight requests
  app.options(
    mcpEndpoint,
    mcpCorsMiddleware,
    (_req: ExpressRequest, res: ExpressResponse) => {
      res.status(200).end();
    },
  );

  // List tools endpoint (REST API)
  setupToolsEndpoint(app, prefix, tools);

  // Health check endpoint
  setupHealthEndpoint(app, prefix, tools);
}

/**
 * Create the main MCP request handler bound to the given tool list
 */
function createMCPHandler(tools: McpToolInfo[]): McpHandlerFunction {
  return async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (req.method === "POST") {
        await handleStatelessRequest(req, res, tools);
        return;
      }

      if (req.method === "GET") {
        const acceptHeader: string = (req.headers["accept"] as string) || "";

        /*
         * Non-SSE GET (browser / probe): return a friendly discovery payload.
         * It advertises the protocol versions this build speaks so a failing
         * handshake can be diagnosed from outside the container logs.
         */
        if (!acceptHeader.includes("text/event-stream")) {
          res.status(200).json({
            name: "oneuptime-mcp",
            status: "running",
            message:
              "This is a Model Context Protocol (MCP) server endpoint. Use an MCP client to connect.",
            protocolVersions: KNOWN_PROTOCOL_VERSIONS,
            latestProtocolVersion: getLatestSupportedProtocolVersion(),
          });
          return;
        }

        /*
         * SSE GET (server -> client stream). In stateless mode the server does
         * not offer a standalone notification stream. Per the MCP spec the
         * server returns 405 here; compliant clients simply proceed without the
         * optional stream rather than tearing the connection down.
         */
        res.status(405).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message:
              "Method Not Allowed: this server does not offer a standalone SSE stream (stateless mode).",
          },
          id: null,
        });
        return;
      }

      if (req.method === "DELETE") {
        // No server-side session to terminate in stateless mode.
        res.status(200).end();
        return;
      }

      res.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method Not Allowed." },
        id: null,
      });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Handle a single MCP POST request in stateless mode.
 *
 * A new McpServer and transport are created per request to guarantee isolation
 * (a shared transport would let concurrent clients collide on JSON-RPC request
 * IDs). The transport is created with `sessionIdGenerator: undefined`, which
 * disables session-id issuance and session validation entirely, so no
 * `mcp-session-id` is emitted and every request is self-contained.
 */
async function handleStatelessRequest(
  req: ExpressRequest,
  res: ExpressResponse,
  tools: McpToolInfo[],
): Promise<void> {
  // API key is read fresh from this request's headers (optional for public tools).
  const apiKey: string = extractApiKey(req) || "";

  /*
   * Record what the client sent before either negotiation overwrites it — the
   * diagnostics below are only useful if they describe the caller rather than
   * this server's own normalized headers.
   */
  const snapshot: McpRequestSnapshot = snapshotMcpRequest(req);

  /*
   * Settle the protocol version and the response format BEFORE the SDK sees the
   * request. Both negotiations rewrite the corresponding request header so the
   * SDK's own (stricter) validation passes on values we have already accepted.
   */
  if (!negotiateProtocolVersionForRequest(req, res, snapshot)) {
    return;
  }

  const acceptNegotiation: AcceptNegotiationResult | null =
    negotiateResponseFormatForRequest(req, res, snapshot);

  if (!acceptNegotiation) {
    return;
  }

  const mcpServer: McpServer = createMCPServerInstance();

  /*
   * Stateless mode: omit `sessionIdGenerator` entirely. The SDK treats an absent
   * generator as undefined and disables session-id issuance and validation, so
   * no `mcp-session-id` is emitted and every request is self-contained. (We omit
   * rather than pass `undefined` explicitly because the tsconfig enables
   * exactOptionalPropertyTypes.)
   *
   * `enableJsonResponse` makes the transport answer with a single
   * `application/json` body instead of an SSE stream. Both are valid replies to
   * a POST per the spec, so we use whichever one the client said it accepts.
   */
  const transport: StreamableHTTPServerTransport =
    new StreamableHTTPServerTransport(
      acceptNegotiation.format === ResponseFormat.Json
        ? { enableJsonResponse: true }
        : {},
    );

  registerToolHandlers(mcpServer, tools, apiKey);

  transport.onerror = (error: Error): void => {
    /*
     * Transport-level failures never reach the tool layer, so without this
     * context the only symptom a user sees is an unrelated-looking tool error.
     * Log enough to identify the offending client and header.
     */
    logger.error(
      `MCP transport error: ${error.message} ${describeMcpRequest(snapshot)}`,
    );
  };

  /*
   * Tear down the ephemeral server + transport once the response is finished,
   * and settle `responseClosed` so the await below can never outlive the
   * request (see the Promise.race).
   */
  let releaseOnClose: () => void = (): void => {
    // Replaced synchronously below; a no-op only if `close` somehow beats it.
  };
  const responseClosed: Promise<void> = new Promise<void>(
    (resolve: () => void) => {
      releaseOnClose = resolve;
    },
  );

  res.on("close", () => {
    transport.close().catch((error: Error) => {
      logger.error(`Error closing MCP transport: ${error.message}`);
    });
    mcpServer.close().catch((error: Error) => {
      logger.error(`Error closing MCP server: ${error.message}`);
    });
    releaseOnClose();
  });

  await mcpServer.connect(transport as Parameters<typeof mcpServer.connect>[0]);

  /*
   * In JSON-response mode the SDK answers with a promise that only settles once
   * every response is ready, and its own `close()` deletes the pending entry
   * WITHOUT resolving it. So a client that disconnects mid-request would leave
   * this await pending forever, pinning the request, response, server and
   * transport for the life of the process. Racing the close event lets this
   * frame unwind; teardown has already run in the handler above.
   */
  await Promise.race([
    transport.handleRequest(req, res, req.body),
    responseClosed,
  ]);
}

/**
 * What the client actually sent, captured BEFORE negotiation rewrites anything.
 *
 * The negotiation deliberately overwrites the protocol-version and Accept
 * headers in place, so reading them back later would report this server's own
 * values. A diagnostic that echoes what we wrote is worse than none at all —
 * the whole point of these logs is to identify the offending client.
 */
interface McpRequestSnapshot {
  jsonrpcMethod: string;
  protocolVersion: string;
  accept: string;
  userAgent: string;
}

function snapshotMcpRequest(req: ExpressRequest): McpRequestSnapshot {
  const body: { method?: unknown } | undefined = req.body as
    | { method?: unknown }
    | undefined;

  return {
    jsonrpcMethod:
      typeof body?.method === "string"
        ? sanitizeForLog(body.method)
        : "unknown",
    protocolVersion:
      sanitizeForLog(
        readHeaderValue(req.headers[MCP_PROTOCOL_VERSION_HEADER]),
      ) || "none",
    accept:
      sanitizeForLog(readHeaderValue(req.headers[ACCEPT_HEADER])) || "none",
    userAgent:
      sanitizeForLog(readHeaderValue(req.headers["user-agent"])) || "unknown",
  };
}

/**
 * Short, log-safe description of an MCP request. Never includes the API key:
 * only the JSON-RPC method, the negotiated headers and the user agent are
 * reported, and every one of them is sanitized and length-capped first.
 */
function describeMcpRequest(snapshot: McpRequestSnapshot): string {
  const parts: string[] = [
    `jsonrpcMethod=${snapshot.jsonrpcMethod}`,
    `protocolVersion=${snapshot.protocolVersion}`,
    `accept=${snapshot.accept}`,
    `userAgent=${snapshot.userAgent}`,
  ];

  return `(${parts.join(", ")})`;
}

/**
 * Negotiate the MCP protocol version for this request.
 *
 * Returns true when the request may continue. When it returns false a response
 * has already been written.
 *
 * The SDK rejects any `MCP-Protocol-Version` header it does not recognize, so a
 * client on a newer revision of the spec than the bundled SDK could never get
 * past the transport. We negotiate down to the best mutually supported version
 * and rewrite the header, which is what the MCP lifecycle calls for.
 */
function negotiateProtocolVersionForRequest(
  req: ExpressRequest,
  res: ExpressResponse,
  snapshot: McpRequestSnapshot,
): boolean {
  const negotiation: ProtocolNegotiationResult = negotiateProtocolVersion(
    req.headers[MCP_PROTOCOL_VERSION_HEADER],
  );

  if (negotiation.outcome === ProtocolNegotiationOutcome.NotRequested) {
    /*
     * "Not requested" covers a header that is absent AND one that is present
     * but blank. Those are not the same thing to the SDK: an empty string is
     * not null, so it fails the SDK's membership check and produces the very
     * 400 this negotiation exists to prevent. Drop the header so the request
     * really does look header-less by the time the SDK sees it.
     */
    removeRequestHeader(asHeaderMutable(req), MCP_PROTOCOL_VERSION_HEADER);
    return true;
  }

  if (negotiation.outcome === ProtocolNegotiationOutcome.Supported) {
    return true;
  }

  if (negotiation.outcome === ProtocolNegotiationOutcome.Unsupported) {
    /*
     * `initialize` negotiates the version in the JSON-RPC body, where the SDK
     * already answers an unknown version with the newest one it supports. Drop
     * the unusable header and let the handshake do its job rather than failing
     * the very request whose purpose is to agree on a version.
     */
    if (isInitializeRequestBody(req.body)) {
      logger.warn(
        `MCP: dropping unsupported MCP-Protocol-Version header "${negotiation.requestedVersion}" on an initialize request; negotiating in the handshake instead ${describeMcpRequest(snapshot)}`,
      );
      removeRequestHeader(asHeaderMutable(req), MCP_PROTOCOL_VERSION_HEADER);
      return true;
    }

    const message: string = `Unsupported MCP protocol version: ${negotiation.requestedVersion}. This server supports ${KNOWN_PROTOCOL_VERSIONS.join(", ")}. Send an MCP-Protocol-Version header with one of those versions, or omit the header to use the version agreed during initialize.`;

    logger.warn(`MCP: ${message} ${describeMcpRequest(snapshot)}`);

    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: `Bad Request: ${message}`,
        data: {
          requestedProtocolVersion: negotiation.requestedVersion,
          supportedProtocolVersions: KNOWN_PROTOCOL_VERSIONS,
        },
      },
      id: null,
    });
    return false;
  }

  // Downgraded: the client is newer than us, so answer on the newest shared version.
  logger.info(
    `MCP: client requested protocol version ${negotiation.requestedVersion}; negotiated down to ${negotiation.negotiatedVersion} ${describeMcpRequest(snapshot)}`,
  );
  setRequestHeader(
    asHeaderMutable(req),
    MCP_PROTOCOL_VERSION_HEADER,
    negotiation.negotiatedVersion as string,
  );
  return true;
}

/**
 * Decide whether to answer with SSE or a plain JSON body.
 *
 * Returns the negotiation result when the request may continue, or null when a
 * 406 response has already been written.
 *
 * The SDK insists a POST list BOTH `application/json` and `text/event-stream`,
 * matched by substring — so a wildcard Accept or a missing Accept header was a 406
 * even though the spec lets the server answer with either media type.
 */
function negotiateResponseFormatForRequest(
  req: ExpressRequest,
  res: ExpressResponse,
  snapshot: McpRequestSnapshot,
): AcceptNegotiationResult | null {
  const negotiation: AcceptNegotiationResult = negotiateResponseFormat(
    req.headers[ACCEPT_HEADER],
  );

  if (negotiation.format === ResponseFormat.Unacceptable) {
    const message: string = `This endpoint responds with application/json or text/event-stream, but the request's Accept header ("${negotiation.requestedAccept}") allows neither.`;

    logger.warn(`MCP: ${message} ${describeMcpRequest(snapshot)}`);

    res.status(406).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: `Not Acceptable: ${message}`,
        data: {
          requestedAccept: negotiation.requestedAccept,
          supportedContentTypes: ["application/json", "text/event-stream"],
        },
      },
      id: null,
    });
    return null;
  }

  /*
   * The SDK re-checks the Accept header itself with a naive substring match.
   * We have already decided what to send, so normalize the header to the value
   * that check expects.
   */
  setRequestHeader(
    asHeaderMutable(req),
    ACCEPT_HEADER,
    NORMALIZED_ACCEPT_HEADER,
  );

  return negotiation;
}

/**
 * Narrow an Express request to the header views the negotiation helpers rewrite.
 *
 * The MCP SDK rebuilds the request it validates from Node's `rawHeaders` array
 * rather than from Express's parsed `headers` map, so a negotiated value has to
 * land in both.
 */
function asHeaderMutable(req: ExpressRequest): HeaderMutableRequest {
  return req as unknown as HeaderMutableRequest;
}

/**
 * Setup the tools listing endpoint
 */
function setupToolsEndpoint(
  app: ExpressApplication,
  prefix: string,
  tools: McpToolInfo[],
): void {
  const endpoint: string = `${prefix}/tools`;

  app.get(endpoint, (_req: ExpressRequest, res: ExpressResponse) => {
    const toolsList: Array<{ name: string; description: string }> = tools.map(
      (tool: McpToolInfo) => {
        return {
          name: tool.name,
          description: tool.description,
        };
      },
    );
    res.json({ tools: toolsList, count: toolsList.length });
  });
}

/**
 * Setup the health check endpoint
 */
function setupHealthEndpoint(
  app: ExpressApplication,
  prefix: string,
  tools: McpToolInfo[],
): void {
  const endpoint: string = `${prefix}/health`;

  app.get(endpoint, (_req: ExpressRequest, res: ExpressResponse) => {
    res.json({
      status: "healthy",
      service: "oneuptime-mcp",
      mode: "stateless",
      tools: tools.length,
      // Stateless mode keeps no sessions in memory; retained for response-shape compatibility.
      activeSessions: 0,
      /*
       * Advertised so an operator debugging a failed handshake can see which
       * protocol versions this build speaks without reading container logs.
       */
      protocolVersions: KNOWN_PROTOCOL_VERSIONS,
      latestProtocolVersion: getLatestSupportedProtocolVersion(),
    });
  });
}
