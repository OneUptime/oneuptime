#!/usr/bin/env npx ts-node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  CallToolRequest,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  ExpressJson,
} from "Common/Server/Utils/Express";
import DynamicToolGenerator from "./Utils/DynamicToolGenerator";
import OneUptimeApiService, {
  OneUptimeApiConfig,
} from "./Services/OneUptimeApiService";
import {
  McpToolInfo,
  OneUptimeToolCallArgs,
  JSONSchema,
} from "./Types/McpTypes";
import OneUptimeOperation from "./Types/OneUptimeOperation";
import logger from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";
import "ejs";

const APP_NAME: string = "mcp";

const app: ExpressApplication = Express.getExpressApp();

// Session data including transport and API key
interface SessionData {
  transport: StreamableHTTPServerTransport;
  apiKey: string;
}

// Store active transports with their API keys (keyed by session ID)
const sessions: Map<string, SessionData> = new Map();

// MCP Server instance
let mcpServer: McpServer;
let tools: McpToolInfo[] = [];

// Current session API key (set before handling each request)
let currentSessionApiKey: string = "";

function initializeMCPServer(): void {
  mcpServer = new McpServer(
    {
      name: "oneuptime-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  initializeServices();
  generateTools();
  setupHandlers();
}

function initializeServices(): void {
  // Initialize OneUptime API Service (API keys are provided per-request via headers)
  // Use HOST and HTTP_PROTOCOL environment variables to construct the API URL
  const apiUrl: string = Host ? `${HttpProtocol}${Host}` : "https://oneuptime.com";

  const config: OneUptimeApiConfig = {
    url: apiUrl,
  };

  OneUptimeApiService.initialize(config);
  logger.info(
    `OneUptime API Service initialized with: ${apiUrl} (API keys provided per-request via x-api-key header)`,
  );
}

function generateTools(): void {
  try {
    tools = DynamicToolGenerator.generateAllTools();
    logger.info(`Generated ${tools.length} OneUptime MCP tools`);
  } catch (error) {
    logger.error(`Failed to generate tools: ${error}`);
    throw error;
  }
}

function setupHandlers(): void {
  // List available tools - use the underlying server for custom handlers
  mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
    const mcpTools: Array<{
      name: string;
      description: string;
      inputSchema: JSONSchema;
    }> = tools.map((tool: McpToolInfo) => {
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      };
    });

    logger.info(`Listing ${mcpTools.length} available tools`);
    return { tools: mcpTools };
  });

  // Handle tool calls
  mcpServer.server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params;

      try {
        // Find the tool by name
        const tool: McpToolInfo | undefined = tools.find((t: McpToolInfo) => {
          return t.name === name;
        });
        if (!tool) {
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }

        logger.info(`Executing tool: ${name} for model: ${tool.modelName}`);

        // Validate API key is available for this session
        if (!currentSessionApiKey) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            "API key is required. Please provide x-api-key header in your request.",
          );
        }

        // Execute the OneUptime operation with the session's API key
        const result: unknown = await OneUptimeApiService.executeOperation(
          tool.tableName,
          tool.operation,
          tool.modelType,
          tool.apiPath || "",
          args as OneUptimeToolCallArgs,
          currentSessionApiKey,
        );

        // Format the response
        const responseText: string = formatToolResponse(
          tool,
          result,
          args as OneUptimeToolCallArgs,
        );

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        logger.error(`Error executing tool ${name}: ${error}`);

        if (error instanceof McpError) {
          throw error;
        }

        throw new McpError(
          ErrorCode.InternalError,
          `Failed to execute ${name}: ${error}`,
        );
      }
    },
  );
}

function formatToolResponse(
  tool: McpToolInfo,
  result: unknown,
  args: OneUptimeToolCallArgs,
): string {
  const operation: OneUptimeOperation = tool.operation;
  const modelName: string = tool.singularName;
  const pluralName: string = tool.pluralName;

  switch (operation) {
    case OneUptimeOperation.Create:
      return `Successfully created ${modelName}: ${JSON.stringify(result, null, 2)}`;

    case OneUptimeOperation.Read:
      if (result) {
        return `Retrieved ${modelName} (ID: ${args.id}): ${JSON.stringify(result, null, 2)}`;
      }
      return `${modelName} not found with ID: ${args.id}`;

    case OneUptimeOperation.List: {
      const items: Array<unknown> = Array.isArray(result)
        ? result
        : (result as { data?: Array<unknown> })?.data || [];
      const count: number = items.length;
      const summary: string = `Found ${count} ${count === 1 ? modelName : pluralName}`;

      if (count === 0) {
        return `${summary}. No items match the criteria.`;
      }

      const limitedItems: Array<unknown> = items.slice(0, 5); // Show first 5 items
      const itemsText: string = limitedItems
        .map((item: unknown, index: number) => {
          return `${index + 1}. ${JSON.stringify(item, null, 2)}`;
        })
        .join("\n");

      const hasMore: string =
        count > 5 ? `\n... and ${count - 5} more items` : "";
      return `${summary}:\n${itemsText}${hasMore}`;
    }

    case OneUptimeOperation.Update:
      return `Successfully updated ${modelName} (ID: ${args.id}): ${JSON.stringify(result, null, 2)}`;

    case OneUptimeOperation.Delete:
      return `Successfully deleted ${modelName} (ID: ${args.id})`;

    case OneUptimeOperation.Count: {
      const totalCount: number =
        (result as { count?: number })?.count || (result as number) || 0;
      return `Total count of ${pluralName}: ${totalCount}`;
    }

    default:
      return `Operation ${operation} completed successfully: ${JSON.stringify(result, null, 2)}`;
  }
}

// Helper function to extract API key from request headers
function extractApiKey(req: ExpressRequest): string | undefined {
  return (
    (req.headers["x-api-key"] as string) ||
    (req.headers["authorization"]?.replace("Bearer ", "") as string)
  );
}

// Setup MCP-specific routes
function setupMCPRoutes(): void {
  const ROUTE_PREFIXES: Array<string> = [`/${APP_NAME}`, "/"];

  // Use forEach to create proper closures for each route prefix
  ROUTE_PREFIXES.forEach((prefix: string) => {
    const mcpEndpoint: string = prefix === "/" ? "/mcp" : `${prefix}/mcp`;

    // MCP endpoint handler - handles all MCP protocol requests (GET, POST, DELETE)
    const mcpHandler = async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        // Extract API key from request headers
        const apiKey: string | undefined = extractApiKey(req);

        if (!apiKey) {
          res.status(401).json({
            error:
              "API key is required. Please provide x-api-key or Authorization header.",
          });
          return;
        }

        // Set the current API key for tool calls
        currentSessionApiKey = apiKey;

        // Get session ID from request headers
        const sessionId: string | undefined = req.headers[
          "mcp-session-id"
        ] as string;

        // Check for existing session
        if (sessionId && sessions.has(sessionId)) {
          // Reuse existing transport for this session
          const sessionData: SessionData = sessions.get(sessionId)!;
          // Update API key in case it changed
          sessionData.apiKey = apiKey;
          await sessionData.transport.handleRequest(req, res, req.body);
          return;
        }

        // For new connections (initialization), create a new transport
        const transport: StreamableHTTPServerTransport =
          new StreamableHTTPServerTransport({
            sessionIdGenerator: (): string => randomUUID(),
            onsessioninitialized: (newSessionId: string): void => {
              // Store the transport with the new session ID and API key
              sessions.set(newSessionId, { transport, apiKey });
              logger.info(`New MCP session initialized: ${newSessionId}`);
            },
          });

        // Handle transport close (must be set before connecting)
        transport.onclose = (): void => {
          const transportSessionId: string | undefined = transport.sessionId;
          if (transportSessionId) {
            logger.info(`MCP session closed: ${transportSessionId}`);
            sessions.delete(transportSessionId);
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
      } catch (error) {
        next(error);
      }
    };

    // Register MCP endpoint for all methods (GET for SSE, POST for requests, DELETE for cleanup)
    app.get(mcpEndpoint, mcpHandler);
    app.post(mcpEndpoint, ExpressJson(), mcpHandler);
    app.delete(mcpEndpoint, mcpHandler);

    // List tools endpoint (REST API)
    app.get(
      `${prefix === "/" ? "" : prefix}/tools`,
      (_req: ExpressRequest, res: ExpressResponse) => {
        const toolsList: Array<{
          name: string;
          description: string;
        }> = tools.map((tool: McpToolInfo) => {
          return {
            name: tool.name,
            description: tool.description,
          };
        });
        res.json({ tools: toolsList, count: toolsList.length });
      },
    );

    // Health check endpoint (in addition to standard status endpoints)
    app.get(
      `${prefix === "/" ? "" : prefix}/health`,
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.json({
          status: "healthy",
          service: "oneuptime-mcp",
          tools: tools.length,
        });
      },
    );
  });
}

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    // Initialize telemetry
    Telemetry.init({
      serviceName: APP_NAME,
    });

    // Simple status check for MCP (no database connections)
    const statusCheck: PromiseVoidFunction = async (): Promise<void> => {
      /*
       * MCP server doesn't connect to databases directly
       * Just verify the server is running
       */
      return Promise.resolve();
    };

    // Initialize the app with service name and status checks
    await App.init({
      appName: APP_NAME,
      statusOptions: {
        liveCheck: statusCheck,
        readyCheck: statusCheck,
      },
    });

    // Initialize MCP server
    initializeMCPServer();

    // Setup MCP-specific routes
    setupMCPRoutes();

    // Add default routes to the app
    await App.addDefaultRoutes();

    logger.info(`OneUptime MCP Server started successfully`);
    logger.info(`Available tools: ${tools.length} total`);

    // Log some example tools
    const exampleTools: string[] = tools.slice(0, 5).map((t: McpToolInfo) => {
      return t.name;
    });
    logger.info(`Example tools: ${exampleTools.join(", ")}`);
  } catch (err) {
    logger.error("MCP Server Init Failed:");
    logger.error(err);
    throw err;
  }
};

// Call the initialization function and handle errors
init().catch((err: Error) => {
  logger.error(err);
  logger.error("Exiting node process");
  process.exit(1);
});
