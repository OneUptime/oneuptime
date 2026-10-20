/*
 * The names of the two tools OneUptime AI uses the project's external MCP
 * servers through (Server/Utils/AI/Mcp/McpRunToolkit), in a module of their
 * own so the Dashboard can name the steps of a run that used them without
 * reaching into server code.
 *
 * call_mcp_tool's arguments say which server and which tool were called:
 * { server, tool, arguments } - the run's activity shows them as
 * "<server> · <tool>".
 */
export const LIST_MCP_TOOLS_TOOL_NAME: string = "list_mcp_tools";
export const CALL_MCP_TOOL_TOOL_NAME: string = "call_mcp_tool";

export const EXTERNAL_MCP_TOOL_NAMES: ReadonlyArray<string> = [
  LIST_MCP_TOOLS_TOOL_NAME,
  CALL_MCP_TOOL_TOOL_NAME,
];

export function isExternalMcpToolName(
  toolName: string | null | undefined,
): boolean {
  return EXTERNAL_MCP_TOOL_NAMES.includes(toolName || "");
}

// "<server> · <tool>" for a call_mcp_tool step, from its arguments.
export function describeExternalMcpToolCall(
  toolArguments: unknown,
): string | null {
  if (
    !toolArguments ||
    typeof toolArguments !== "object" ||
    Array.isArray(toolArguments)
  ) {
    return null;
  }

  const args: Record<string, unknown> = toolArguments as Record<
    string,
    unknown
  >;
  const server: unknown = args["server"];
  const tool: unknown = args["tool"];

  if (typeof server !== "string" || typeof tool !== "string") {
    return null;
  }

  const serverName: string = server.trim().slice(0, 60);
  const toolName: string = tool.trim().slice(0, 128);

  if (!serverName || !toolName) {
    return null;
  }

  return `${serverName} · ${toolName}`;
}
