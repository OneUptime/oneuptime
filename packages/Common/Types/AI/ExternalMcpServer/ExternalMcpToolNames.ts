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
