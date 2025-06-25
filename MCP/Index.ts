#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ServerConfig } from "./Utils/Config.js";
import { MCPService } from "./Service/MCP.js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

async function main(): Promise<void> {
  try {
    // Create server instance
    const server: McpServer = new McpServer({
      name: ServerConfig.name,
      version: ServerConfig.version,
      capabilities: {
        tools: {},
        resources: {},
      },
    });

    // Add tools to server
    const mcpService = new MCPService();
    await mcpService.addToolsToServer(server);

    const transport: StdioServerTransport = new StdioServerTransport();
    await server.connect(transport);
    console.error("OneUptime MCP Server running on stdio");
  } catch (error) {
    console.error("Fatal error in main():");
    console.error(error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.error("Received SIGINT, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.error("Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

main().catch((error: Error) => {
  console.error("Fatal error in main():");
  console.error(error);
  process.exit(1);
});