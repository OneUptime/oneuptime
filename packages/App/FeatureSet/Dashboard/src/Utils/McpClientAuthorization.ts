import McpOAuthScope, {
  McpOAuthScopeUtil,
} from "Common/Types/Mcp/McpOAuthScope";

/*
 * How a connected MCP client is described on Settings -> MCP Server. The
 * table rows are McpOAuthGrant; these turn their stored columns into the two
 * things a person wants to read off a row: what the client may do, and how
 * sure OneUptime is of who it is.
 */

export const MCP_ACCESS_READ_AND_WRITE: string = "Read and write";
export const MCP_ACCESS_READ_ONLY: string = "Read only";

/*
 * The access a grant carries, from its stored scope string. Anything that
 * does not include write reads as read-only - including a value this version
 * does not understand, because overstating what a client can do is the less
 * harmful mistake.
 */
export const getMcpAccessLabel: (scope: string | undefined) => string = (
  scope: string | undefined,
): string => {
  const scopes: Array<McpOAuthScope> = McpOAuthScopeUtil.parse(scope).scopes;

  return McpOAuthScopeUtil.canWrite(scopes)
    ? MCP_ACCESS_READ_AND_WRITE
    : MCP_ACCESS_READ_ONLY;
};

/*
 * The host a client is published at, when its client id is the URL of a
 * Client ID Metadata Document. A client that registered itself has an opaque
 * id and no such host, and gets null: its name is all that is known, and the
 * name is the client's own word.
 */
export const getMcpClientHost: (
  clientId: string | undefined,
) => string | null = (clientId: string | undefined): string | null => {
  if (!clientId || !clientId.startsWith("https://")) {
    return null;
  }

  try {
    return new URL(clientId).host || null;
  } catch {
    return null;
  }
};
