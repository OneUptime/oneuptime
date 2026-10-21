/**
 * Authorization endpoint (GET /mcp/oauth/authorize)
 *
 * The URL a client opens in the member's browser to start signing in. It
 * decides nothing about the member - it has no idea who they are yet, and
 * does not ask. Its whole job is to check what the CLIENT sent, and then pass
 * the browser on to the consent screen with the checked request, where
 * signing in and deciding happen.
 *
 * Every outcome is a redirect, to one of three places:
 *
 *   the consent screen, with the request   - the request is good
 *   the consent screen, with an error code - the client or its redirect URI
 *                                            could not be verified, so there
 *                                            is nowhere else safe to go
 *   the client's redirect URI, with an     - the client is verified, and
 *   OAuth error                              something else is wrong
 */

import AuthorizationRequest, {
  AuthorizationDisplayError,
  AuthorizationDisplayErrorCode,
  McpOAuthAuthorizationRequest,
} from "./AuthorizationRequest";
import { ResolvedMcpOAuthClient } from "./ClientMetadata";
import McpOAuthError, { McpOAuthErrorCode } from "./McpOAuthError";
import OAuthHttp, { OAuthParameters } from "./OAuthHttp";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";

export default class AuthorizationEndpoint {
  public static async handle(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const parameters: OAuthParameters = OAuthHttp.getParameters(req);

    let client: ResolvedMcpOAuthClient;
    let redirectUri: string;

    try {
      ({ client, redirectUri } =
        await AuthorizationRequest.resolveClientAndRedirectUri(parameters));
    } catch (err) {
      if (err instanceof AuthorizationDisplayError) {
        return AuthorizationEndpoint.redirect(
          res,
          AuthorizationRequest.buildDisplayErrorUrl(err.code),
        );
      }

      logger.error("MCP OAuth: authorization request could not be checked.");
      logger.error(err);

      return AuthorizationEndpoint.redirect(
        res,
        AuthorizationRequest.buildDisplayErrorUrl(
          AuthorizationDisplayErrorCode.ServerError,
        ),
      );
    }

    /*
     * The client and where to send it are now known to be good, so from here
     * a problem is reported to the client. `state` is read first and on its
     * own so that it can be echoed even when the rest of the request is
     * refused; a state that is itself unusable simply is not echoed.
     */
    let state: string | undefined = undefined;

    try {
      state = AuthorizationRequest.readState(parameters);

      const request: McpOAuthAuthorizationRequest = AuthorizationRequest.parse({
        parameters,
        client,
        redirectUri,
      });

      return AuthorizationEndpoint.redirect(
        res,
        AuthorizationRequest.buildConsentPageUrl(
          AuthorizationRequest.toTicket(request),
        ),
      );
    } catch (err) {
      if (err instanceof AuthorizationDisplayError) {
        return AuthorizationEndpoint.redirect(
          res,
          AuthorizationRequest.buildDisplayErrorUrl(err.code),
        );
      }

      let error: McpOAuthError;

      if (err instanceof McpOAuthError) {
        error = err;
      } else {
        logger.error("MCP OAuth: authorization request failed.");
        logger.error(err);

        error = new McpOAuthError(
          McpOAuthErrorCode.ServerError,
          "The authorization server encountered an unexpected error.",
        );
      }

      return AuthorizationEndpoint.redirect(
        res,
        AuthorizationRequest.buildErrorRedirect({
          redirectUri,
          state,
          error,
        }),
      );
    }
  }

  /*
   * 302, uncacheable, and with no Referer on the way out: the URL being left
   * carries the client's `state` and challenge, which are nobody else's
   * business.
   */
  private static redirect(res: ExpressResponse, location: string): void {
    OAuthHttp.setNoStore(res);
    res.setHeader("Referrer-Policy", "no-referrer");
    res.redirect(302, location);
  }
}
