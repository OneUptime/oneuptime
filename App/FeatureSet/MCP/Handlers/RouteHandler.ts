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
import { createMCPServerInstance, McpServer } from "../Server/MCPServer";
import { registerToolHandlers } from "./ToolHandler";
import SessionManager, { SessionData } from "../Server/SessionManager";
import { McpToolInfo } from "../Types/McpTypes";
import {
  ROUTE_PREFIXES,
  SESSION_HEADER,
  API_KEY_HEADERS,
} from "../Config/ServerConfig";
import logger from "Common/Server/Utils/Logger";

// Tools list stored at setup time for per-session server initialization
let registeredTools: McpToolInfo[] = [];

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
  registeredTools = tools;
  ROUTE_PREFIXES.forEach((prefix: string) => {
    setupRoutesForPrefix(app, prefix, tools);
  });

  logger.info(
    `MCP routes setup complete for prefixes: ${ROUTE_PREFIXES.join(", ")}`,
  );
}

/**
 * Middleware to add MCP-specific CORS headers (mcp-session-id must be allowed and exposed)
 */
function mcpCorsMiddleware(
  _req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void {
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, mcp-session-id, x-api-key",
  );
  res.header("Access-Control-Expose-Headers", "mcp-session-id");
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
  const mcpHandler: McpHandlerFunction = createMCPHandler();

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
 * Create the main MCP request handler
 */
function createMCPHandler(): McpHandlerFunction {
  return async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // For GET requests, require Accept: text/event-stream (SSE) header
      if (req.method === "GET") {
        const acceptHeader: string | undefined = req.headers["accept"] as
          | string
          | undefined;
        if (!acceptHeader || !acceptHeader.includes("text/event-stream")) {
          res.status(200).json({
            name: "oneuptime-mcp",
            status: "running",
            message:
              "This is a Model Context Protocol (MCP) server endpoint. Use an MCP client to connect.",
          });
          return;
        }
      }

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

      // For POST without session ID, validate it's a proper MCP initialization request
      if (req.method === "POST") {
        const body: Record<string, unknown> | undefined = req.body as
          | Record<string, unknown>
          | undefined;
        if (!body || body["method"] !== "initialize") {
          res.status(400).json({
            error: "Bad Request",
            message:
              "Invalid MCP request. POST without session ID must be an 'initialize' request.",
          });
          return;
        }
      }

      // Create new session for new connections
      await handleNewSession(req, res, apiKey || "");
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
 * Creates a new McpServer instance per session to support concurrent connections.
 */
async function handleNewSession(
  req: ExpressRequest,
  res: ExpressResponse,
  apiKey: string,
): Promise<void> {
  // Create a new McpServer for this session (each can only connect to one transport)
  const mcpServer: McpServer = createMCPServerInstance();
  registerToolHandlers(mcpServer, registeredTools);

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

  // Connect the per-session MCP server to this transport
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
      tools: tools.length,
      activeSessions: SessionManager.getSessionCount(),
    });
  });
}
