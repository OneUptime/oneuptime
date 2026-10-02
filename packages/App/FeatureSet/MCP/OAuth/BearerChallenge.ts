/**
 * Bearer challenges
 *
 * The `WWW-Authenticate` header on a 401 or 403 from the MCP endpoint
 * (RFC 6750 section 3, extended by RFC 9728). It is the whole of how a client
 * learns that it should sign somebody in: an MCP client knows nothing about
 * this server but its URL, and the `resource_metadata` parameter here is
 * where its discovery starts. A refusal without this header - however clearly
 * worded - is just a failed request to a client.
 */

import McpOAuthError, { McpOAuthErrorCode } from "./McpOAuthError";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";
import McpOAuthScope, {
  McpOAuthScopeUtil,
} from "Common/Types/Mcp/McpOAuthScope";

export interface BearerChallenge {
  statusCode: number;
  headerValue: string;
  body: { error: string; error_description: string };
}

/*
 * The scopes a challenge asks a client to request.
 *
 * Always both, including when the call that was refused only needed to read.
 * Asking for read alone would be the textbook least-privilege answer, with
 * the client stepping up when it first tries to change something - but a
 * client that already holds a refresh token answers a step-up challenge by
 * refreshing (the MCP TypeScript SDK does), gets a token with the scope it
 * already had, and is refused again with no way forward. Starting read-only
 * would strand those clients there. So the client asks for everything it may
 * need, and narrowing is the member's decision on the consent screen, where
 * read-only is one click.
 */
const CHALLENGE_SCOPES: Array<McpOAuthScope> = [
  McpOAuthScope.Read,
  McpOAuthScope.Write,
];

export default class BearerChallengeBuilder {
  /*
   * 401: no credential, or an access token that is unknown, expired, revoked
   * or no longer usable. Either way the remedy is the same - get a token.
   */
  public static unauthorized(description: string): BearerChallenge {
    return BearerChallengeBuilder.build({
      statusCode: 401,
      error: new McpOAuthError(McpOAuthErrorCode.InvalidToken, description),
    });
  }

  /*
   * 403: a good token that was issued for less than this call needs. The
   * scope names everything the client should hold afterwards, not only what
   * is missing, so a client that replaces its scope with the challenge's
   * does not lose what it had.
   */
  public static insufficientScope(description: string): BearerChallenge {
    return BearerChallengeBuilder.build({
      statusCode: 403,
      error: new McpOAuthError(
        McpOAuthErrorCode.InsufficientScope,
        description,
      ),
    });
  }

  private static build(data: {
    statusCode: number;
    error: McpOAuthError;
  }): BearerChallenge {
    /*
     * The parameters a client acts on come first and the human-readable
     * description last. Clients find them by scanning the header for
     * `name="` (the MCP TypeScript SDK takes the first match), so prose
     * placed ahead of them could be read as one if it ever contained
     * `scope=` or `resource_metadata=`.
     */
    const parameters: Array<string> = [
      `error="${data.error.code}"`,
      `resource_metadata="${McpOAuthConfig.getProtectedResourceMetadataUrl()}"`,
      `scope="${McpOAuthScopeUtil.toString(CHALLENGE_SCOPES)}"`,
      `error_description="${BearerChallengeBuilder.quote(data.error.description)}"`,
    ];

    return {
      statusCode: data.statusCode,
      headerValue: `Bearer ${parameters.join(", ")}`,
      body: data.error.toResponseBody(),
    };
  }

  /*
   * RFC 6750 allows an error_description only printable ASCII without `"`
   * or `\`. Anything else is replaced, so the header can never be broken out
   * of by text that ended up in a description.
   */
  private static quote(value: string): string {
    return value.replace(/[^\x20-\x21\x23-\x5B\x5D-\x7E]/g, "'");
  }
}
