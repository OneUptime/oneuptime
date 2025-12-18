/**
 * MCP Server
 * Handles MCP server initialization and configuration
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from "../Config/ServerConfig";
import logger from "Common/Server/Utils/Logger";

// Singleton MCP server instance
let mcpServerInstance: McpServer | null = null;

/**
 * Initialize and return the MCP server instance
 */
export function initializeMCPServer(): McpServer {
  if (mcpServerInstance) {
    return mcpServerInstance;
  }

  mcpServerInstance = new McpServer(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  logger.info(
    `MCP Server initialized: ${MCP_SERVER_NAME} v${MCP_SERVER_VERSION}`,
  );
  return mcpServerInstance;
}

/**
 * Get the MCP server instance
 * @throws Error if server not initialized
 */
export function getMCPServer(): McpServer {
  if (!mcpServerInstance) {
    throw new Error(
      "MCP Server not initialized. Call initializeMCPServer() first.",
    );
  }
  return mcpServerInstance;
}

/**
 * Check if MCP server is initialized
 */
export function isMCPServerInitialized(): boolean {
  return mcpServerInstance !== null;
}

/**
 * Reset MCP server (useful for testing)
 */
export function resetMCPServer(): void {
  mcpServerInstance = null;
}

export { McpServer };
