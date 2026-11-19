/*
 * The names of the two tools OneUptime AI uses the project's external MCP
 * servers through (Server/Utils/AI/Mcp/McpRunToolkit), in a module of their
 * own so the Dashboard can name the steps of a run that used them - in the
 * run's activity and its evidence - without reaching into server code.
 *
 * call_mcp_tool's arguments say which server and which tool were called:
 * { server, tool, arguments }.
 */
export const LIST_MCP_TOOLS_TOOL_NAME: string = "list_mcp_tools";
export const CALL_MCP_TOOL_TOOL_NAME: string = "call_mcp_tool";

/*
 * How call_mcp_tool says a call it made failed - it called the server,
 * which did not answer it (a lost connection, its time limit, an error of
 * the protocol) - as opposed to a call it refused before calling any server
 * (a server or tool it does not know, arguments that are no JSON object).
 * The round of a fix through MCP servers lists the first under What it
 * checked, with the server's own words, and leaves the second out: it read
 * nothing (RemediationRound, issue #6526).
 */
export function describeMcpToolCallFailure(data: {
  tool: string;
  server: string;
  message: string;
}): string {
  return `Error calling ${data.tool} on ${data.server}: ${data.message}`;
}

/*
 * The server's words in a failure describeMcpToolCallFailure wrote for this
 * tool, or null when the message is not one: the call never reached a
 * server. The run names a server by its label, which the name the model
 * called it by matches whatever its case.
 */
export function readMcpToolCallFailure(data: {
  errorMessage: string;
  tool: string;
  server: string;
}): string | null {
  const prefix: string = `Error calling ${data.tool} on `;

  if (!data.tool || !data.errorMessage.startsWith(prefix)) {
    return null;
  }

  const rest: string = data.errorMessage.slice(prefix.length);
  const server: string = data.server.trim();

  if (server && rest.toLowerCase().startsWith(`${server.toLowerCase()}: `)) {
    return rest.slice(server.length + 2);
  }

  const separator: number = rest.indexOf(": ");

  return separator >= 0 ? rest.slice(separator + 2) : rest;
}
