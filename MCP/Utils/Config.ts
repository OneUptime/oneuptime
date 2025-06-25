export const ServerConfig = {
  name: "oneuptime-mcp",
  version: "1.0.0",
  description: "OneUptime Model Context Protocol (MCP) Server - Provides access to OneUptime APIs for LLMs",
} as const;

export const EnvironmentVariables = {
  ONEUPTIME_URL: "ONEUPTIME_URL",
  ONEUPTIME_API_URL: "ONEUPTIME_API_URL",
  ONEUPTIME_API_KEY: "ONEUPTIME_API_KEY",
  API_KEY: "API_KEY",
} as const;

export function validateEnvironment(): void {
  const apiKey = process.env.ONEUPTIME_API_KEY || process.env.API_KEY;
  
  if (!apiKey) {
    throw new Error(
      "OneUptime API key is required. Please set one of the following environment variables:\n" +
      "- ONEUPTIME_API_KEY\n" +
      "- API_KEY"
    );
  }
}

export function getEnvironmentInfo(): Record<string, string | undefined> {
  return {
    ONEUPTIME_URL: process.env.ONEUPTIME_URL,
    ONEUPTIME_API_URL: process.env.ONEUPTIME_API_URL,
    ONEUPTIME_API_KEY: process.env.ONEUPTIME_API_KEY ? "[REDACTED]" : undefined,
    API_KEY: process.env.API_KEY ? "[REDACTED]" : undefined,
    NODE_ENV: process.env.NODE_ENV,
  };
}