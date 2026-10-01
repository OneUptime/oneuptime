/**
 * Token revocation (POST /mcp/oauth/revoke, RFC 7009)
 *
 * How a client says "I am done": the user disconnected the server, or signed
 * out. Revoking either token ends the whole authorization - the grant is
 * deleted, and every code and token issued under it goes with it - because
 * the two are one connection, and a client that hands back its refresh token
 * while its access token keeps working for an hour has not been disconnected.
 *
 * The answer is 200 whether or not the token meant anything, as the RFC
 * requires: the client's goal (the token no longer works) is met either way,
 * and anything else would turn the endpoint into a way to test tokens.
 */

import ClientAuthentication from "./ClientAuthentication";
import { ResolvedMcpOAuthClient } from "./ClientMetadata";
import McpOAuthError, { McpOAuthErrorCode } from "./McpOAuthError";
import OAuthHttp, { OAuthParameters } from "./OAuthHttp";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import McpOAuthToken from "Common/Models/DatabaseModels/McpOAuthToken";
import McpOAuthGrantService from "Common/Server/Services/McpOAuthGrantService";
import McpOAuthTokenService from "Common/Server/Services/McpOAuthTokenService";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import McpOAuthTokenType from "Common/Types/Mcp/McpOAuthTokenType";
import UserType from "Common/Types/UserType";

export default class RevocationEndpoint {
  public static async handle(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const parameters: OAuthParameters = OAuthHttp.getParameters(req);

    const client: ResolvedMcpOAuthClient =
      await ClientAuthentication.authenticate(req, parameters);

    const secret: string | undefined = OAuthHttp.getString(parameters, "token");

    if (!secret) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidRequest,
        "token is required.",
      );
    }

    /*
     * `token_type_hint` is only a hint (RFC 7009 section 2.1), and the two
     * kinds of token have different prefixes, so each lookup already refuses
     * the other kind before it reaches the database. Both are simply tried.
     */
    const token: McpOAuthToken | null =
      (await McpOAuthTokenService.findBySecret({
        secret,
        tokenType: McpOAuthTokenType.RefreshToken,
      })) ||
      (await McpOAuthTokenService.findBySecret({
        secret,
        tokenType: McpOAuthTokenType.AccessToken,
      }));

    if (token?.mcpOAuthGrantId) {
      const grant: McpOAuthGrant | null = await McpOAuthGrantService.findGrant(
        token.mcpOAuthGrantId,
      );

      /*
       * Only the client a token was issued to may revoke it. A token
       * presented by some other client is left alone, and the answer is
       * still 200.
       */
      if (grant?.id && grant.clientId === client.clientId) {
        await McpOAuthGrantService.revoke({
          grantId: grant.id,
          /*
           * The client is acting for the member who connected it, so that is
           * who the audit trail names - through this client.
           */
          props: {
            isRoot: true,
            ...(grant.userId
              ? { userId: grant.userId, userType: UserType.User }
              : {}),
            ...(grant.projectId ? { tenantId: grant.projectId } : {}),
            mcpOAuthGrantId: grant.id,
            ...(grant.name ? { mcpClientName: grant.name } : {}),
          },
        });
      }
    }

    OAuthHttp.sendJson(res, 200, {});
  }
}
