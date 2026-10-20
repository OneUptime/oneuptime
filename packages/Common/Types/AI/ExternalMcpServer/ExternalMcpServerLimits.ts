/*
 * HOW MUCH OneUptime ASKS OF AN EXTERNAL MCP SERVER, AND HOW LONG IT WAITS.
 *
 * An external MCP server is outside OneUptime: somebody else's code, on
 * somebody else's machine. Every call to it is held to a time limit and a
 * size limit, and every run to a number of calls, so a slow, broken or
 * hostile server can neither hold an investigation forever, nor fill a
 * worker's memory, nor be called in a loop.
 *
 * Shared by the server and the Dashboard, so it imports nothing.
 */

// How many external MCP servers one project may add.
export const MAX_EXTERNAL_MCP_SERVERS_PER_PROJECT: number = 20;

/*
 * How many tools of one server are read. A server offering more is read up
 * to here; the rest are not offered to OneUptime AI (the server's page says
 * so).
 */
export const MAX_EXTERNAL_MCP_SERVER_TOOLS: number = 200;

// How many pages of a tools/list answer are read before the rest is left.
export const MAX_EXTERNAL_MCP_SERVER_TOOL_PAGES: number = 20;

// A tool name longer than this is not offered: no real server needs one.
export const MAX_EXTERNAL_MCP_TOOL_NAME_CHARS: number = 128;

/*
 * How much of a tool's description the server's page keeps, and how much
 * OneUptime AI reads when it lists the tools.
 */
export const MAX_EXTERNAL_MCP_TOOL_DESCRIPTION_CHARS: number = 1000;

/*
 * How much of a tool's input schema OneUptime AI reads when it lists the
 * tools: enough for any real tool, and a schema written to fill the
 * model's context is cut.
 */
export const MAX_EXTERNAL_MCP_TOOL_SCHEMA_CHARS: number = 4000;

// Connecting: the InitializeRequest, and the event stream of an SSE server.
export const EXTERNAL_MCP_CONNECT_TIMEOUT_MS: number = 20 * 1000;

// Listing the tools.
export const EXTERNAL_MCP_LIST_TIMEOUT_MS: number = 30 * 1000;

// One tool call.
export const EXTERNAL_MCP_TOOL_CALL_TIMEOUT_MS: number = 60 * 1000;

/*
 * The most one answer may hold, in bytes: a bigger one is cut off and the
 * call fails, saying so. Long text below it is paged for OneUptime AI, never
 * cut.
 */
export const MAX_EXTERNAL_MCP_RESPONSE_BYTES: number = 2 * 1024 * 1024;

// The arguments OneUptime AI may send in one call, as JSON.
export const MAX_EXTERNAL_MCP_ARGUMENTS_CHARS: number = 64 * 1000;

/*
 * Tool calls one run (an investigation or a fix) may make to the project's
 * external MCP servers, all of them together.
 */
export const MAX_EXTERNAL_MCP_CALLS_PER_RUN: number = 40;

/*
 * Changes one fix may make through the external MCP servers without asking
 * - for a rule that fixes without asking. A fix that needs more is
 * proposed instead.
 */
export const MAX_EXTERNAL_MCP_CHANGES_PER_FIX: number = 5;

// Headers of one server (sign-in by headers).
export const MAX_EXTERNAL_MCP_SERVER_HEADERS: number = 10;
export const MAX_EXTERNAL_MCP_HEADER_NAME_CHARS: number = 100;
export const MAX_EXTERNAL_MCP_HEADER_VALUE_CHARS: number = 4096;

// The longest address, bearer token or OAuth setting kept.
export const MAX_EXTERNAL_MCP_URL_CHARS: number = 2048;
export const MAX_EXTERNAL_MCP_SECRET_CHARS: number = 8192;
