import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AppVersion, ServerName } from "./Utils/Config";


// Create server instance
const server = new McpServer({
  name: ServerName,
  version: AppVersion.toString(),
  capabilities: {
    resources: {},
    tools: {},
  },
});