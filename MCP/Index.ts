import MCP from "./Service/MCPServer";

async function main(): Promise<void> {
  const mcpServer = new MCP();
  await mcpServer.run();
}

main().catch((error: Error) => {
  console.error("Fatal error in main():");
  console.error(error);
  process.exit(1);
});
