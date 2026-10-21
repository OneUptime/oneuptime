/**
 * Server Configuration
 * Centralized configuration for the MCP server
 */

import { AppApiHostname, AppVersion } from "Common/Server/EnvironmentConfig";
import Protocol from "Common/Types/API/Protocol";

// Application name used across the server
export const APP_NAME: string = "mcp";

// MCP Server information
export const MCP_SERVER_NAME: string = "oneuptime-mcp";
export const MCP_SERVER_VERSION: string =
  AppVersion && AppVersion !== "unknown" ? AppVersion : "1.0.0";

// Route prefixes for the MCP server (only /mcp since App owns root)
export const ROUTE_PREFIXES: string[] = [`/${APP_NAME}`];

/*
 * Where the tools' API calls go: the App's own API, at its internal address.
 *
 * The MCP server is part of the App, so it reaches the API the way the App's
 * other server-to-server calls do (MailService, WebhookService, ...): plain
 * HTTP to SERVER_APP_HOSTNAME:APP_PORT, the address Nginx proxies /api to.
 *
 * It used to leave through the public address - HTTP_PROTOCOL and HOST - and
 * come back in through Nginx, which only works where the App can reach the
 * address people use. With HOST=localhost, as on a local install and the e2e
 * stack, that address is the App container itself, where nothing listens on
 * port 80: every tool that read or wrote anything failed with "connect
 * ECONNREFUSED 127.0.0.1:80". Split DNS, egress rules or a self-signed
 * certificate break it the same way. HOST still decides everything a client
 * sees - the OAuth issuer, the token audience and the discovery documents
 * (see OAuth/) - just not where this server sends its own requests.
 */
export function getApiUrl(): string {
  return `${Protocol.HTTP}${AppApiHostname.toString()}`;
}

// API key header names
export const API_KEY_HEADERS: string[] = ["x-api-key", "authorization"];

// Default and maximum page sizes for list tools
export const LIST_DEFAULT_LIMIT: number = 10;
export const LIST_MAX_LIMIT: number = 100;
