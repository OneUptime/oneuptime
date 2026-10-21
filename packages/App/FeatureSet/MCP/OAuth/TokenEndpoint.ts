/**
 * Token endpoint (POST /mcp/oauth/token)
 *
 * Where a client turns an authorization code into tokens, and a refresh token
 * into the next pair. Both are single-use exchanges, and nearly everything
 * here is about making "single" true: a code or a refresh token is claimed
 * with a compare-and-set before anything is issued, so of two requests racing
 * with the same secret exactly one is answered - and a secret that turns up a
 * second time, later, is treated as stolen and takes its whole grant with it.
 */

import ClientAuthentication from "./ClientAuthentication";
import { McpOAuthClientKind, ResolvedMcpOAuthClient } from "./ClientMetadata";
import ClientResolver from "./ClientResolver";
import McpOAuthError, { McpOAuthErrorCode } from "./McpOAuthError";
import OAuthHttp, { OAuthParameters } from "./OAuthHttp";
import Pkce from "./Pkce";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import McpOAuthToken from "Common/Models/DatabaseModels/McpOAuthToken";
import McpOAuthGrantService from "Common/Server/Services/McpOAuthGrantService";
import McpOAuthTokenService, {
  IssuedMcpOAuthTokenPair,
  Service as McpOAuthTokenServiceClass,
} from "Common/Server/Services/McpOAuthTokenService";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";
import McpOAuthGrantAccess, {
  McpOAuthGrantAccessResult,
} from "Common/Server/Utils/Mcp/McpOAuthGrantAccess";
import OneUptimeDate from "Common/Types/Date";
import {
  McpOAuthScopeUtil,
  ParsedMcpOAuthScope,
} from "Common/Types/Mcp/McpOAuthScope";
import McpOAuthTokenType from "Common/Types/Mcp/McpOAuthTokenType";
import ObjectID from "Common/Types/ObjectID";

export interface McpOAuthTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

const GRANT_TYPE_AUTHORIZATION_CODE: string = "authorization_code";
const GRANT_TYPE_REFRESH_TOKEN: string = "refresh_token";

/*
 * One description for every way a code or refresh token can be no good. The
 * client's remedy is identical in each case - start authorization again - and
 * saying which check failed would tell someone probing with a stolen secret
 * how far it got.
 */
const INVALID_CODE_DESCRIPTION: string =
  "The authorization code is invalid, expired or has already been used.";
const INVALID_REFRESH_TOKEN_DESCRIPTION: string =
  "The refresh token is invalid, expired or has been revoked.";

export default class TokenEndpoint {
  public static async handle(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const parameters: OAuthParameters = OAuthHttp.getParameters(req);

    const grantType: string | undefined = OAuthHttp.getString(
      parameters,
      "grant_type",
    );

    if (!grantType) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidRequest,
        "grant_type is required.",
      );
    }

    if (
      grantType !== GRANT_TYPE_AUTHORIZATION_CODE &&
      grantType !== GRANT_TYPE_REFRESH_TOKEN
    ) {
      throw new McpOAuthError(
        McpOAuthErrorCode.UnsupportedGrantType,
        'grant_type must be "authorization_code" or "refresh_token".',
      );
    }

    /*
     * RFC 8707: a token request may repeat the resource it wants the token
     * for. There is one resource here, so the only thing to check is that a
     * client is not asking this server for a token meant for another.
     */
    const resource: string | undefined = OAuthHttp.getString(
      parameters,
      "resource",
    );

    if (resource !== undefined && !McpOAuthConfig.isThisResource(resource)) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidTarget,
        `The resource must be ${McpOAuthConfig.getResource()}.`,
      );
    }

    const client: ResolvedMcpOAuthClient =
      await ClientAuthentication.authenticate(req, parameters);

    const response: McpOAuthTokenResponse =
      grantType === GRANT_TYPE_AUTHORIZATION_CODE
        ? await TokenEndpoint.exchangeAuthorizationCode(client, parameters)
        : await TokenEndpoint.exchangeRefreshToken(client, parameters);

    // Best effort: keeps a registered client from being swept as unused.
    try {
      await ClientResolver.touch(client);
    } catch (err) {
      logger.warn("MCP OAuth: could not record that a client was used.");
      logger.warn(err);
    }

    OAuthHttp.sendJson(res, 200, response);
  }

  private static async exchangeAuthorizationCode(
    client: ResolvedMcpOAuthClient,
    parameters: OAuthParameters,
  ): Promise<McpOAuthTokenResponse> {
    const code: string | undefined = OAuthHttp.getString(parameters, "code");

    if (!code) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidRequest,
        "code is required.",
      );
    }

    const codeVerifier: string | undefined = OAuthHttp.getString(
      parameters,
      "code_verifier",
    );

    if (!codeVerifier) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidRequest,
        "code_verifier is required: this server requires PKCE.",
      );
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    const token: McpOAuthToken | null = await McpOAuthTokenService.findBySecret(
      {
        secret: code,
        tokenType: McpOAuthTokenType.AuthorizationCode,
      },
    );

    if (!token || !token.id || !token.mcpOAuthGrantId) {
      throw TokenEndpoint.invalidGrant(INVALID_CODE_DESCRIPTION);
    }

    const grant: McpOAuthGrant | null = await McpOAuthGrantService.findGrant(
      token.mcpOAuthGrantId,
    );

    if (!grant || !grant.id) {
      throw TokenEndpoint.invalidGrant(INVALID_CODE_DESCRIPTION);
    }

    /*
     * A code is good only for the client it was issued to. Checked BEFORE the
     * code is claimed, so a different client presenting somebody else's code
     * cannot burn it.
     */
    if (grant.clientId !== client.clientId) {
      throw TokenEndpoint.invalidGrant(INVALID_CODE_DESCRIPTION);
    }

    /*
     * Already exchanged: either the client is repeating itself or the code
     * was intercepted and this is its second holder. The two cannot be told
     * apart, so whatever the first exchange issued is revoked
     * (OAuth 2.1 section 4.1.3).
     */
    if (token.consumedAt) {
      await McpOAuthGrantService.revokeBecauseCredentialWasReplayed({
        grantId: grant.id,
        credential: "authorization code",
      });

      throw TokenEndpoint.invalidGrant(INVALID_CODE_DESCRIPTION);
    }

    if (McpOAuthTokenServiceClass.isExpired(token, now)) {
      throw TokenEndpoint.invalidGrant(INVALID_CODE_DESCRIPTION);
    }

    // Lost the race for it: the same thing as arriving second.
    if (!(await McpOAuthTokenService.claim({ tokenId: token.id, now }))) {
      await McpOAuthGrantService.revokeBecauseCredentialWasReplayed({
        grantId: grant.id,
        credential: "authorization code",
      });

      throw TokenEndpoint.invalidGrant(INVALID_CODE_DESCRIPTION);
    }

    /*
     * From here on the code is spent whatever happens: a code gets one
     * attempt. If that attempt fails, the grant it would have activated is
     * removed, so nothing half-made is left behind.
     */
    try {
      /*
       * OAuth 2.1 no longer requires the redirect URI to be repeated here
       * (PKCE does the job it did), so its absence is accepted. A value that
       * IS sent has to be the one the code was delivered to.
       */
      const redirectUri: string | undefined = OAuthHttp.getString(
        parameters,
        "redirect_uri",
      );

      if (redirectUri !== undefined && redirectUri !== token.redirectUri) {
        throw TokenEndpoint.invalidGrant(INVALID_CODE_DESCRIPTION);
      }

      if (
        !Pkce.verify({
          codeVerifier,
          codeChallenge: token.codeChallenge,
        })
      ) {
        throw TokenEndpoint.invalidGrant(INVALID_CODE_DESCRIPTION);
      }

      /*
       * The member approved a moment ago, but "a moment" is long enough to
       * be blocked or removed in. Asked again, the same way every later use
       * of the grant will be.
       */
      const access: McpOAuthGrantAccessResult =
        await McpOAuthGrantAccess.evaluate({
          grant,
          requireActivated: false,
          now,
        });

      if (!access.isAllowed) {
        logger.debug(
          `MCP OAuth: authorization code refused (${access.refusal}).`,
        );
        throw TokenEndpoint.invalidGrant(INVALID_CODE_DESCRIPTION);
      }
    } catch (err) {
      await TokenEndpoint.discardGrant(grant);
      throw err;
    }

    const grantId: ObjectID = grant.id;

    const tokens: IssuedMcpOAuthTokenPair = await TokenEndpoint.issueTokens({
      grantId,
      now,
      invalidDescription: INVALID_CODE_DESCRIPTION,
      settle: async (issued: IssuedMcpOAuthTokenPair): Promise<void> => {
        await McpOAuthGrantService.activate({
          grantId,
          expiresAt: issued.refreshTokenExpiresAt,
          now,
        });
      },
    });

    /*
     * A registered client reconnecting replaces what it held before (see
     * McpOAuthGrantService.revokeEarlierGrantsOfClient for why this is not
     * done for a metadata document client).
     *
     * This is housekeeping, and it must not cost the client the tokens it has
     * just been issued: the code is spent and the grant is live, so failing
     * here would leave the member with a connection nobody holds the tokens
     * for. An earlier grant that could not be removed stays what it was - a
     * grant the member approved - until it is disconnected or lapses.
     */
    if (
      client.kind === McpOAuthClientKind.Registered &&
      grant.userId &&
      grant.projectId
    ) {
      try {
        await McpOAuthGrantService.revokeEarlierGrantsOfClient({
          userId: grant.userId,
          projectId: grant.projectId,
          clientId: client.clientId,
          exceptGrantId: grant.id,
        });
      } catch (err) {
        logger.warn("MCP OAuth: could not remove a client's earlier grants.");
        logger.warn(err);
      }
    }

    return TokenEndpoint.toResponse(tokens, grant, now);
  }

  private static async exchangeRefreshToken(
    client: ResolvedMcpOAuthClient,
    parameters: OAuthParameters,
  ): Promise<McpOAuthTokenResponse> {
    const refreshToken: string | undefined = OAuthHttp.getString(
      parameters,
      "refresh_token",
    );

    if (!refreshToken) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidRequest,
        "refresh_token is required.",
      );
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    const token: McpOAuthToken | null = await McpOAuthTokenService.findBySecret(
      {
        secret: refreshToken,
        tokenType: McpOAuthTokenType.RefreshToken,
      },
    );

    if (!token || !token.id || !token.mcpOAuthGrantId) {
      throw TokenEndpoint.invalidGrant(INVALID_REFRESH_TOKEN_DESCRIPTION);
    }

    const grant: McpOAuthGrant | null = await McpOAuthGrantService.findGrant(
      token.mcpOAuthGrantId,
    );

    if (!grant || !grant.id) {
      throw TokenEndpoint.invalidGrant(INVALID_REFRESH_TOKEN_DESCRIPTION);
    }

    if (grant.clientId !== client.clientId) {
      throw TokenEndpoint.invalidGrant(INVALID_REFRESH_TOKEN_DESCRIPTION);
    }

    if (McpOAuthTokenServiceClass.isExpired(token, now)) {
      throw TokenEndpoint.invalidGrant(INVALID_REFRESH_TOKEN_DESCRIPTION);
    }

    /*
     * A refresh token narrows or keeps the access it was issued with; it can
     * never widen it (RFC 6749 section 6). Asking for more is how a client
     * steps up, and that goes through the consent screen.
     */
    TokenEndpoint.assertScopeNotWidened(parameters, grant);

    /*
     * Rotated out a while ago and presented again: somebody is holding a
     * copy. The grant goes, and both holders are signed out. Inside the grace
     * period it is a retry of a refresh whose answer was lost, or a second
     * worker of the same client, and it gets a pair of its own below.
     */
    if (token.consumedAt) {
      const consumedForMs: number =
        now.getTime() - new Date(token.consumedAt).getTime();

      if (
        consumedForMs >
        McpOAuthConfig.REFRESH_TOKEN_REUSE_GRACE_SECONDS * 1000
      ) {
        await McpOAuthGrantService.revokeBecauseCredentialWasReplayed({
          grantId: grant.id,
          credential: "refresh token",
        });

        throw TokenEndpoint.invalidGrant(INVALID_REFRESH_TOKEN_DESCRIPTION);
      }
    }

    /*
     * Asked BEFORE the token is spent. Everything in here only reads, so a
     * refusal - or a database that could not answer - leaves the client
     * holding a refresh token that is still good, rather than one that was
     * consumed for nothing and would look like a replay the next time it is
     * presented.
     */
    const access: McpOAuthGrantAccessResult =
      await McpOAuthGrantAccess.evaluate({ grant, now });

    if (!access.isAllowed) {
      logger.debug(`MCP OAuth: refresh token refused (${access.refusal}).`);
      throw TokenEndpoint.invalidGrant(INVALID_REFRESH_TOKEN_DESCRIPTION);
    }

    if (!token.consumedAt) {
      /*
       * False here means another request claimed it between the read above
       * and this write - which is, by definition, inside the grace period.
       */
      await McpOAuthTokenService.claim({ tokenId: token.id, now });
    }

    const grantId: ObjectID = grant.id;

    const tokens: IssuedMcpOAuthTokenPair = await TokenEndpoint.issueTokens({
      grantId,
      now,
      invalidDescription: INVALID_REFRESH_TOKEN_DESCRIPTION,
      settle: async (issued: IssuedMcpOAuthTokenPair): Promise<void> => {
        await McpOAuthGrantService.extend({
          grantId,
          expiresAt: issued.refreshTokenExpiresAt,
        });
      },
    });

    return TokenEndpoint.toResponse(tokens, grant, now);
  }

  /*
   * Issue a pair for a grant this request has just been allowed to use, and
   * record it on the grant (`settle`).
   *
   * The grant can be revoked UNDER the request. A second request presenting
   * the same code, or a refresh token replayed past its grace period, revokes
   * the grant - and can do so while this one is between its checks and its
   * writes. The pair then has nothing to belong to: its insert fails, or it
   * lands a moment before the delete that takes it away again. Neither is a
   * server fault, and a pair that is already dead is not an answer either.
   * Both are the replay answer, `invalid_grant`: the credential was presented
   * twice, and nothing issued from it survives.
   */
  private static async issueTokens(data: {
    grantId: ObjectID;
    now: Date;
    invalidDescription: string;
    settle: (issued: IssuedMcpOAuthTokenPair) => Promise<void>;
  }): Promise<IssuedMcpOAuthTokenPair> {
    let tokens: IssuedMcpOAuthTokenPair;

    try {
      tokens = await McpOAuthTokenService.issueTokenPair({
        grantId: data.grantId,
        now: data.now,
      });

      await data.settle(tokens);
    } catch (err) {
      if (await TokenEndpoint.isGrantGone(data.grantId)) {
        throw TokenEndpoint.invalidGrant(data.invalidDescription);
      }

      throw err;
    }

    if (await TokenEndpoint.isGrantGone(data.grantId)) {
      throw TokenEndpoint.invalidGrant(data.invalidDescription);
    }

    return tokens;
  }

  private static async isGrantGone(grantId: ObjectID): Promise<boolean> {
    return (await McpOAuthGrantService.findGrant(grantId)) === null;
  }

  private static assertScopeNotWidened(
    parameters: OAuthParameters,
    grant: McpOAuthGrant,
  ): void {
    const scope: unknown = parameters["scope"];

    if (scope === undefined || scope === "") {
      return;
    }

    if (typeof scope !== "string" || !McpOAuthScopeUtil.isWellFormed(scope)) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidScope,
        "scope must be a space-delimited list of scope names.",
      );
    }

    const requested: ParsedMcpOAuthScope = McpOAuthScopeUtil.parse(scope);

    if (
      !McpOAuthScopeUtil.isSubset(
        requested.scopes,
        McpOAuthScopeUtil.parse(grant.scope).scopes,
      )
    ) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidScope,
        "A refresh token cannot be exchanged for more access than it was issued with. Start authorization again to request more.",
      );
    }
  }

  private static toResponse(
    tokens: IssuedMcpOAuthTokenPair,
    grant: McpOAuthGrant,
    now: Date,
  ): McpOAuthTokenResponse {
    return {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: Math.max(
        1,
        Math.floor(
          (tokens.accessTokenExpiresAt.getTime() - now.getTime()) / 1000,
        ),
      ),
      refresh_token: tokens.refreshToken,
      /*
       * Always stated, so a client knows what it was actually given - which
       * is the member's choice on the consent screen, and can be less than
       * the client asked for.
       */
      scope: grant.scope || "",
    };
  }

  private static invalidGrant(description: string): McpOAuthError {
    return new McpOAuthError(McpOAuthErrorCode.InvalidGrant, description);
  }

  // Best effort: a grant that could not be removed here is swept when it expires.
  private static async discardGrant(grant: McpOAuthGrant): Promise<void> {
    if (!grant.id) {
      return;
    }

    try {
      await McpOAuthGrantService.revoke({
        grantId: grant.id,
        props: { isRoot: true },
      });
    } catch (err) {
      logger.warn(
        "MCP OAuth: could not discard a grant that was not activated.",
      );
      logger.warn(err);
    }
  }
}
