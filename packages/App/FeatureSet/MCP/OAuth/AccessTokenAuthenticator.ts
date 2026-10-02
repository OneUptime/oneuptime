/**
 * Access token authentication
 *
 * The MCP endpoint acting as an OAuth resource server: given the bearer token
 * on a request, decide whether it is a token this server issued, for this
 * endpoint, under a grant that may still be used - and if so, for whom.
 *
 * Nothing about the answer is cached. A revoked grant, a blocked member, a
 * lapsed SSO sign-in all have to stop the very next request, and the read
 * that proves they have not happened is two indexed lookups.
 */

import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import McpOAuthToken from "Common/Models/DatabaseModels/McpOAuthToken";
import McpOAuthGrantService from "Common/Server/Services/McpOAuthGrantService";
import McpOAuthTokenService, {
  Service as McpOAuthTokenServiceClass,
} from "Common/Server/Services/McpOAuthTokenService";
import logger from "Common/Server/Utils/Logger";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";
import McpOAuthGrantAccess, {
  McpOAuthGrantAccessResult,
  McpOAuthPrincipal,
} from "Common/Server/Utils/Mcp/McpOAuthGrantAccess";
import McpOAuthTokenType from "Common/Types/Mcp/McpOAuthTokenType";

export type AccessTokenAuthentication =
  | { isAuthenticated: true; principal: McpOAuthPrincipal }
  | { isAuthenticated: false };

export default class AccessTokenAuthenticator {
  /*
   * Every refusal is the same answer to the caller - "not authenticated" -
   * because the remedy is always the same (get a new token) and the reason is
   * nobody's business who merely holds a string. The reason goes to the debug
   * log, without the token.
   */
  public static async authenticate(
    accessToken: unknown,
    now?: Date | undefined,
  ): Promise<AccessTokenAuthentication> {
    if (!McpOAuthConfig.isEnabled()) {
      return { isAuthenticated: false };
    }

    const token: McpOAuthToken | null = await McpOAuthTokenService.findBySecret(
      {
        secret: accessToken,
        tokenType: McpOAuthTokenType.AccessToken,
      },
    );

    if (!token || !token.mcpOAuthGrantId) {
      logger.debug("MCP OAuth: access token refused (unknown token).");
      return { isAuthenticated: false };
    }

    if (McpOAuthTokenServiceClass.isExpired(token, now)) {
      logger.debug("MCP OAuth: access token refused (expired).");
      return { isAuthenticated: false };
    }

    const grant: McpOAuthGrant | null = await McpOAuthGrantService.findGrant(
      token.mcpOAuthGrantId,
    );

    if (!grant) {
      logger.debug("MCP OAuth: access token refused (grant revoked).");
      return { isAuthenticated: false };
    }

    const access: McpOAuthGrantAccessResult =
      await McpOAuthGrantAccess.evaluate({ grant, now });

    if (!access.isAllowed) {
      logger.debug(`MCP OAuth: access token refused (${access.refusal}).`);
      return { isAuthenticated: false };
    }

    // Fire-and-forget and throttled; it must not hold up the request.
    void McpOAuthGrantService.touchLastUsed(grant, now);

    return { isAuthenticated: true, principal: access.principal };
  }
}
