#!/usr/bin/env npx ts-node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  CallToolRequest,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
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
import "ejs";

const APP_NAME: string = "mcp";

const app: ExpressApplication = Express.getExpressApp();

// Store active SSE transports
const transports: Map<string, SSEServerTransport> = new Map();

// MCP Server instance
let mcpServer: Server;
let tools: McpToolInfo[] = [];

function initializeMCPServer(): void {
  mcpServer = new Server(
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
  // Initialize OneUptime API Service
  const apiKey: string | undefined = process.env["ONEUPTIME_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "OneUptime API key is required. Please set ONEUPTIME_API_KEY environment variable.",
    );
  }

  const config: OneUptimeApiConfig = {
    url: process.env["ONEUPTIME_URL"] || "https://oneuptime.com",
    apiKey: apiKey,
  };

  OneUptimeApiService.initialize(config);
  logger.info("OneUptime API Service initialized");
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
  // List available tools
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
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
  mcpServer.setRequestHandler(
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

        // Execute the OneUptime operation
        const result: unknown = await OneUptimeApiService.executeOperation(
          tool.tableName,
          tool.operation,
          tool.modelType,
          tool.apiPath || "",
          args as OneUptimeToolCallArgs,
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

// Setup MCP-specific routes
function setupMCPRoutes(): void {
  const ROUTE_PREFIXES: Array<string> = [`/${APP_NAME}`, "/"];

  // Use forEach to create proper closures for each route prefix
  ROUTE_PREFIXES.forEach((prefix: string) => {
    // SSE endpoint for MCP connections
    app.get(
      `${prefix === "/" ? "" : prefix}/sse`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        logger.info("New SSE connection established");

        // Set SSE headers
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Access-Control-Allow-Origin", "*");

        // Create SSE transport
        const messageEndpoint: string =
          prefix === "/" ? "/message" : `${prefix}/message`;
        const transport: SSEServerTransport = new SSEServerTransport(
          messageEndpoint,
          res,
        );

        // Store transport with session ID
        const sessionId: string = `session-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        transports.set(sessionId, transport);

        // Handle connection close
        req.on("close", () => {
          logger.info(`SSE connection closed: ${sessionId}`);
          transports.delete(sessionId);
        });

        // Connect server to transport
        await mcpServer.connect(transport);
      },
    );

    // Message endpoint for client-to-server messages
    app.post(
      `${prefix === "/" ? "" : prefix}/message`,
      ExpressJson(),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          /*
           * Find the transport for this session
           * In a real implementation, you'd use session management
           */
          const transport: SSEServerTransport | undefined = Array.from(
            transports.values(),
          )[0];
          if (transport) {
            await transport.handlePostMessage(req, res);
          } else {
            res.status(400).json({ error: "No active SSE connection" });
          }
        } catch (error) {
          next(error);
        }
      },
    );

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
