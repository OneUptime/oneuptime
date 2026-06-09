/**
 * MCP Server
 * Handles MCP server initialization and configuration.
 *
 * The HTTP transport runs in stateless mode (see Handlers/RouteHandler.ts): a
 * fresh McpServer is created per request, so there is no shared singleton and no
 * process-global request state to collide on under concurrency.
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
 * Create a new McpServer instance for a single request.
 * Each request needs its own McpServer because a McpServer can only connect to
 * one transport, and stateless mode uses a fresh transport per request.
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

/**
 * Reset MCP server (useful for testing)
 */
export function resetMCPServer(): void {
  initialized = false;
}

export { McpServer };
