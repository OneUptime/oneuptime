/**
 * MCP Server
 * Handles MCP server initialization and configuration.
 * Creates a new McpServer instance per session to support concurrent connections.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from "../Config/ServerConfig";
import logger from "Common/Server/Utils/Logger";

let initialized: boolean = false;

/**
 * Mark the MCP subsystem as initialized (called once at startup)
 */
export function initializeMCPServer(): void {
  initialized = true;
  logger.info(
    `MCP Server initialized: ${MCP_SERVER_NAME} v${MCP_SERVER_VERSION}`,
  );
}

/**
 * Create a new McpServer instance for a session.
 * Each session needs its own McpServer because a McpServer can only connect to one transport.
 */
export function createMCPServerInstance(): McpServer {
  if (!initialized) {
    throw new Error(
      "MCP Server not initialized. Call initializeMCPServer() first.",
    );
  }

  return new McpServer(
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
}

/**
 * Check if MCP server is initialized
 */
export function isMCPServerInitialized(): boolean {
  return initialized;
}

export { McpServer };
