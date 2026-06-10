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
      // Handle Bearer token format
      if (header === "authorization" && value.startsWith("Bearer ")) {
        return value.replace("Bearer ", "");
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

        // Non-SSE GET (browser / probe): return a friendly discovery payload.
        if (!acceptHeader.includes("text/event-stream")) {
          res.status(200).json({
            name: "oneuptime-mcp",
            status: "running",
            message:
              "This is a Model Context Protocol (MCP) server endpoint. Use an MCP client to connect.",
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

  const mcpServer: McpServer = createMCPServerInstance();

  /*
   * Stateless mode: omit `sessionIdGenerator` entirely. The SDK treats an absent
   * generator as undefined and disables session-id issuance and validation, so
   * no `mcp-session-id` is emitted and every request is self-contained. (We omit
   * rather than pass `undefined` explicitly because the tsconfig enables
   * exactOptionalPropertyTypes.)
   */
  const transport: StreamableHTTPServerTransport =
    new StreamableHTTPServerTransport({});

  registerToolHandlers(mcpServer, tools, apiKey);

  transport.onerror = (error: Error): void => {
    logger.error(`MCP transport error: ${error.message}`);
  };

  // Tear down the ephemeral server + transport once the response is finished.
  res.on("close", () => {
    transport.close().catch((error: Error) => {
      logger.error(`Error closing MCP transport: ${error.message}`);
    });
    mcpServer.close().catch((error: Error) => {
      logger.error(`Error closing MCP server: ${error.message}`);
    });
  });

  await mcpServer.connect(transport as Parameters<typeof mcpServer.connect>[0]);
  await transport.handleRequest(req, res, req.body);
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
    });
  });
}
