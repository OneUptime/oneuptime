/**
 * Server Configuration
 * Centralized configuration for the MCP server
 */

import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";

// Application name used across the server
export const APP_NAME: string = "mcp";

// MCP Server information
export const MCP_SERVER_NAME: string = "oneuptime-mcp";
export const MCP_SERVER_VERSION: string = "1.0.0";

// Route prefixes for the MCP server
export const ROUTE_PREFIXES: string[] = [`/${APP_NAME}`, "/"];

// API URL configuration
export function getApiUrl(): string {
    return Host ? `${HttpProtocol}${Host}` : "https://oneuptime.com";
}

// Session header name
export const SESSION_HEADER: string = "mcp-session-id";

// API key header names
export const API_KEY_HEADERS: string[] = ["x-api-key", "authorization"];

// Response formatting limits
export const LIST_PREVIEW_LIMIT: number = 5;
