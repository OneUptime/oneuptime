/**
 * Route Handler
 * Sets up Express routes for the MCP server
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  ExpressJson,
} from "Common/Server/Utils/Express";
import { getMCPServer, McpServer } from "../Server/MCPServer";
import SessionManager, { SessionData } from "../Server/SessionManager";
import { McpToolInfo } from "../Types/McpTypes";
import {
  ROUTE_PREFIXES,
  SESSION_HEADER,
  API_KEY_HEADERS,
} from "../Config/ServerConfig";
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
    `MCP routes setup complete for prefixes: ${ROUTE_PREFIXES.join(", ")}`,
  );
}

/**
 * Setup routes for a specific prefix
 */
function setupRoutesForPrefix(
  app: ExpressApplication,
  prefix: string,
  tools: McpToolInfo[],
): void {
  const mcpEndpoint: string = prefix === "/" ? "/mcp" : `${prefix}/mcp`;
  const mcpHandler: McpHandlerFunction = createMCPHandler();

  // MCP endpoint for all methods (GET for SSE, POST for requests, DELETE for cleanup)
  app.get(mcpEndpoint, mcpHandler);
  app.post(mcpEndpoint, ExpressJson(), mcpHandler);
  app.delete(mcpEndpoint, mcpHandler);

  // OPTIONS handler for CORS preflight requests
  app.options(mcpEndpoint, (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(200).end();
  });

  // Handle root "/" when nginx strips the /mcp/ prefix (for "/" prefix only)
  if (prefix === "/") {
    app.get("/", mcpHandler);
    app.post("/", ExpressJson(), mcpHandler);
    app.delete("/", mcpHandler);
    app.options("/", (_req: ExpressRequest, res: ExpressResponse) => {
      res.status(200).end();
    });
  }

  // List tools endpoint (REST API)
  setupToolsEndpoint(app, prefix, tools);

  // Health check endpoint
  setupHealthEndpoint(app, prefix, tools);
}

/**
 * Returns true if the JSON-RPC body (single message or batch) contains a
 * message with method === "initialize".
 */
function containsInitializeMessage(body: unknown): boolean {
  if (!body) {
    return false;
  }
  const messages: Array<unknown> = Array.isArray(body) ? body : [body];
  return messages.some((msg: unknown) => {
    return (
      typeof msg === "object" &&
      msg !== null &&
      (msg as Record<string, unknown>)["method"] === "initialize"
    );
  });
}

/**
 * Returns true if every message in the JSON-RPC body is a notification.
 * Notifications expect no response and can be safely accepted with HTTP 202
 * even without a session ID — several MCP clients send
 * `notifications/initialized` without the session header.
 */
function isNotificationOnly(body: unknown): boolean {
  if (!body) {
    return false;
  }
  const messages: Array<unknown> = Array.isArray(body) ? body : [body];
  if (messages.length === 0) {
    return false;
  }
  return messages.every((msg: unknown) => {
    if (typeof msg !== "object" || msg === null) {
      return false;
    }
    const method: unknown = (msg as Record<string, unknown>)["method"];
    return typeof method === "string" && method.startsWith("notifications/");
  });
}

/**
 * Create the main MCP request handler
 */
function createMCPHandler(): McpHandlerFunction {
  return async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // Extract API key (optional - public tools work without it)
      const apiKey: string | undefined = extractApiKey(req);

      // Set the current API key for tool calls (may be undefined for public tools)
      SessionManager.setCurrentApiKey(apiKey || "");

      // Check for existing session
      const sessionId: string | undefined = req.headers[
        SESSION_HEADER
      ] as string;

      if (sessionId && SessionManager.hasSession(sessionId)) {
        await handleExistingSession(req, res, sessionId, apiKey || "");
        return;
      }

      // Session ID provided but unknown - tell client to re-initialize.
      if (sessionId) {
        if (req.method === "DELETE") {
          res.status(200).end();
          return;
        }
        res.status(404).json({
          error: "Not Found",
          message:
            "MCP session not found. Please re-initialize the connection.",
        });
        return;
      }

      // No session ID. Only accept POSTs that initialize or are notifications.
      if (req.method === "POST") {
        if (containsInitializeMessage(req.body)) {
          await handleNewSession(req, res, apiKey || "");
          return;
        }
        if (isNotificationOnly(req.body)) {
          res.status(202).end();
          return;
        }
      }

      // For GET (SSE) and DELETE without session: nothing meaningful to do.
      if (req.method === "GET" || req.method === "DELETE") {
        await handleNewSession(req, res, apiKey || "");
        return;
      }

      res.status(400).json({
        error: "Bad Request",
        message:
          "Missing Mcp-Session-Id header. Initialize the connection before sending requests.",
      });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Handle request for an existing session
 */
async function handleExistingSession(
  req: ExpressRequest,
  res: ExpressResponse,
  sessionId: string,
  apiKey: string,
): Promise<void> {
  const sessionData: SessionData | undefined =
    SessionManager.getSession(sessionId);

  if (!sessionData) {
    return;
  }

  // Update API key in case it changed
  sessionData.apiKey = apiKey;
  await sessionData.transport.handleRequest(req, res, req.body);
}

/**
 * Handle request for a new session (initialization)
 */
async function handleNewSession(
  req: ExpressRequest,
  res: ExpressResponse,
  apiKey: string,
): Promise<void> {
  const mcpServer: McpServer = getMCPServer();

  const transport: StreamableHTTPServerTransport =
    new StreamableHTTPServerTransport({
      sessionIdGenerator: (): string => {
        return randomUUID();
      },
      onsessioninitialized: (newSessionId: string): void => {
        // Store the transport with the new session ID and API key
        SessionManager.setSession(newSessionId, { transport, apiKey });
        logger.info(`New MCP session initialized: ${newSessionId}`);
      },
    });

  // Handle transport close
  transport.onclose = (): void => {
    const transportSessionId: string | undefined = transport.sessionId;
    if (transportSessionId) {
      logger.info(`MCP session closed: ${transportSessionId}`);
      SessionManager.removeSession(transportSessionId);
    }
  };

  // Handle transport errors
  transport.onerror = (error: Error): void => {
    logger.error(`MCP transport error: ${error.message}`);
  };

  // Connect the MCP server to this transport
  await mcpServer.connect(transport as Parameters<typeof mcpServer.connect>[0]);

  // Handle the request
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
  const endpoint: string = `${prefix === "/" ? "" : prefix}/tools`;

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
  const endpoint: string = `${prefix === "/" ? "" : prefix}/health`;

  app.get(endpoint, (_req: ExpressRequest, res: ExpressResponse) => {
    res.json({
      status: "healthy",
      service: "oneuptime-mcp",
      tools: tools.length,
      activeSessions: SessionManager.getSessionCount(),
    });
  });
}
