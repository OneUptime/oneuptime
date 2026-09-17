/**
 * Server Configuration
 * Centralized configuration for the MCP server
 */

import {
  AppVersion,
  Host,
  HttpProtocol,
} from "Common/Server/EnvironmentConfig";

// Application name used across the server
export const APP_NAME: string = "mcp";

// MCP Server information
export const MCP_SERVER_NAME: string = "oneuptime-mcp";
export const MCP_SERVER_VERSION: string =
  AppVersion && AppVersion !== "unknown" ? AppVersion : "1.0.0";

// Route prefixes for the MCP server (only /mcp since App owns root)
export const ROUTE_PREFIXES: string[] = [`/${APP_NAME}`];

// API URL configuration
export function getApiUrl(): string {
  return Host ? `${HttpProtocol}${Host}` : "https://oneuptime.com";
}

// API key header names
export const API_KEY_HEADERS: string[] = ["x-api-key", "authorization"];

// Default and maximum page sizes for list tools
export const LIST_DEFAULT_LIMIT: number = 10;
export const LIST_MAX_LIMIT: number = 100;
