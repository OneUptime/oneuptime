import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import logger from "Common/Server/Utils/Logger";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const APP_NAME: string = "mcp-hello-world";

logger.info("OneUptime Hello World MCP Server is starting...");

class HelloWorldMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "oneuptime-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "hello",
            description: "Say hello with a personalized greeting",
            inputSchema: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Name of the person to greet",
                },
              },
              required: ["name"],
            },
          },
          {
            name: "get_time",
            description: "Get the current server time",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "echo",
            description: "Echo back any message",
            inputSchema: {
              type: "object",
              properties: {
                message: {
                  type: "string",
                  description: "Message to echo back",
                },
              },
              required: ["message"],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "hello": {
            const personName = args?.name as string;
            if (!personName) {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Name parameter is required"
              );
            }

            logger.info(`Saying hello to: ${personName}`);
            return {
              content: [
                {
                  type: "text",
                  text: `Hello, ${personName}! Welcome to OneUptime's Hello World MCP Server! 🚀`,
                },
              ],
            };
          }

          case "get_time": {
            const currentTime = new Date().toISOString();
            logger.info(`Returning current time: ${currentTime}`);
            return {
              content: [
                {
                  type: "text",
                  text: `Current server time: ${currentTime}`,
                },
              ],
            };
          }

          case "echo": {
            const message = args?.message as string;
            if (!message) {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Message parameter is required"
              );
            }

            logger.info(`Echoing message: ${message}`);
            return {
              content: [
                {
                  type: "text",
                  text: `Echo: ${message}`,
                },
              ],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        logger.error(`Error executing tool ${name}:`, error);
        throw error;
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    logger.info("OneUptime Hello World MCP Server is running!");
    logger.info("Available tools: hello, get_time, echo");
  }
}

// Start the server
async function main(): Promise<void> {
  try {
    const mcpServer = new HelloWorldMCPServer();
    await mcpServer.run();
  } catch (error) {
    logger.error("Failed to start MCP server:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

// Start the server
main().catch((error) => {
  logger.error("Unhandled error:", error);
  process.exit(1);
});
