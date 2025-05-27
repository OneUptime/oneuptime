import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AppVersion, ServerName } from "./Utils/Config";
import logger from "@oneuptime/common/Server/Utils/Logger";
import { PromiseVoidFunction } from "@oneuptime/common/Types/FunctionTypes";

// Create server instance
const server: McpServer = new McpServer({
  name: ServerName,
  version: AppVersion.toString(),
  capabilities: {
    resources: {},
    tools: {},
  },
});

async function main(): PromiseVoidFunction {
  const transport: StdioServerTransport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("OneUptime MCP Server running on stdio");
}

main().catch((error: Error) => {
  logger.error("Fatal error in main():");
  logger.error(error);
  process.exit(1);
});
