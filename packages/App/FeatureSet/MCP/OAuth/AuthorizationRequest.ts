/**
 * Authorization requests
 *
 * An authorization request is what a client opens the browser with:
 * "I am this client; send the code back here; I want this much access". This
 * file checks one, in the two stages the protocol requires, and then carries
 * the checked result to the consent screen and back.
 *
 * TWO STAGES, BECAUSE THE FAILURES GO TO DIFFERENT PEOPLE
 *
 * Until the client and its redirect URI have been verified there is nowhere
 * safe to send an error - redirecting to an unverified URI is how an
 * authorization server becomes an open redirector. So a problem with either
 * is shown to the PERSON, on OneUptime's own page (AuthorizationDisplayError).
 * Once both are known to be good, every other problem is the CLIENT's to
 * hear about, and is sent to its redirect URI as the RFC says
 * (McpOAuthError).
 *
 * THE TICKET
 *
 * The checked request then has to survive a trip through the browser: to the
 * consent screen, quite possibly through a sign-in, and back in the POST that
 * approves it. It travels as a signed ticket (McpOAuthSignedToken), so what
 * the approval acts on is exactly what was validated here and nothing the
 * browser could have altered along the way. The ticket is not a credential:
 * approving still takes the member's own session.
 */

import { McpOAuthClientKind, ResolvedMcpOAuthClient } from "./ClientMetadata";
import ClientResolver from "./ClientResolver";
import McpOAuthError, { McpOAuthErrorCode } from "./McpOAuthError";
import Pkce, { PKCE_CODE_CHALLENGE_METHOD } from "./Pkce";
import RedirectUri from "./RedirectUri";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";
import McpOAuthSignedToken, {
  McpOAuthSignedTokenPurpose,
} from "Common/Server/Utils/Mcp/McpOAuthSignedToken";
import { JSONObject } from "Common/Types/JSON";
import { MCP_OAUTH_TICKET_MAX_LENGTH } from "Common/Types/Mcp/McpOAuthTicket";
import McpOAuthScope, {
  McpOAuthScopeUtil,
  ParsedMcpOAuthScope,
} from "Common/Types/Mcp/McpOAuthScope";

/*
 * Why an authorization request could not even be started. These are shown to
 * a person and are passed to the consent page as CODES ONLY: the page maps
 * each to fixed wording, so nothing a link's author writes into the URL is
 * ever displayed as if OneUptime had said it.
 */
export enum AuthorizationDisplayErrorCode {
  OAuthDisabled = "oauth_disabled",
  MissingClientId = "missing_client_id",
  UnknownClient = "unknown_client",
  ClientMetadataUnavailable = "client_metadata_unavailable",
  ClientMetadataInvalid = "client_metadata_invalid",
  MissingRedirectUri = "missing_redirect_uri",
  RedirectUriMismatch = "redirect_uri_mismatch",
  RequestTooLarge = "request_too_large",
  ServerError = "server_error",
}

export class AuthorizationDisplayError extends Error {
  public readonly code: AuthorizationDisplayErrorCode;

  public constructor(code: AuthorizationDisplayErrorCode) {
    super(code);
    this.name = "AuthorizationDisplayError";
    this.code = code;
  }
}

export interface McpOAuthAuthorizationRequest {
  clientId: string;
  clientKind: McpOAuthClientKind;
  clientName: string;
  clientUri?: string | undefined;
  redirectUri: string;
  codeChallenge: string;
  state?: string | undefined;

  // What the client asked for, normalized (write spelled out as read+write).
  scopes: Array<McpOAuthScope>;

  resource: string;
}

/*
 * `state` is the client's own value, echoed back untouched, and RFC 6749 puts
 * no limit on it. One is needed here because it rides inside the ticket, and
 * the ticket has to fit in a URL (and a cookie, across a sign-in). Real
 * clients send a few dozen characters.
 */
export const MAX_STATE_LENGTH: number = 1024;

const RESPONSE_TYPE_CODE: string = "code";

/*
 * The length cap is the one the consent screen applies to what it receives
 * (McpOAuthTicket): a ticket this server would issue is always one that page
 * accepts, and a request too large to carry is refused here, as
 * `request_too_large`, rather than issued and then not recognised.
 */
const TICKET_PURPOSE: McpOAuthSignedTokenPurpose = {
  keyDerivationLabel: "oneuptime:mcp:oauth:authorization-request:v1",
  maxLength: MCP_OAUTH_TICKET_MAX_LENGTH,
};

type Parameters = Record<string, unknown>;

export default class AuthorizationRequest {
  /*
   * Stage one: who is asking, and where would a code go.
   *
   * `redirect_uri` is required even when the client registered only one.
   * RFC 6749 lets a single registered URI be implied; OAuth 2.1 and every MCP
   * client send it, and requiring it removes a guess from the one value that
   * decides where a code is delivered.
   */
  public static async resolveClientAndRedirectUri(
    parameters: Parameters,
  ): Promise<{ client: ResolvedMcpOAuthClient; redirectUri: string }> {
    const clientId: string | undefined = AuthorizationRequest.single(
      parameters,
      "client_id",
    );

    if (!clientId) {
      throw new AuthorizationDisplayError(
        AuthorizationDisplayErrorCode.MissingClientId,
      );
    }

    let client: ResolvedMcpOAuthClient | null;

    try {
      client = await ClientResolver.resolve(clientId);
    } catch (err) {
      /*
       * Only what the lookup itself said about the client is the client's
       * problem. A lookup that could not be made (the database, not the
       * client) goes up as it is: the endpoint logs it and shows "something
       * went wrong on our side", rather than telling a person their client's
       * description of itself is invalid.
       */
      if (!(err instanceof McpOAuthError)) {
        throw err;
      }

      throw new AuthorizationDisplayError(
        err.code === McpOAuthErrorCode.TemporarilyUnavailable
          ? AuthorizationDisplayErrorCode.ClientMetadataUnavailable
          : AuthorizationDisplayErrorCode.ClientMetadataInvalid,
      );
    }

    if (!client) {
      throw new AuthorizationDisplayError(
        AuthorizationDisplayErrorCode.UnknownClient,
      );
    }

    const redirectUri: string | undefined = AuthorizationRequest.single(
      parameters,
      "redirect_uri",
    );

    if (!redirectUri) {
      throw new AuthorizationDisplayError(
        AuthorizationDisplayErrorCode.MissingRedirectUri,
      );
    }

    if (!RedirectUri.matchesAny(redirectUri, client.redirectUris)) {
      throw new AuthorizationDisplayError(
        AuthorizationDisplayErrorCode.RedirectUriMismatch,
      );
    }

    return { client, redirectUri };
  }

  /*
   * Stage two: everything else. Throws McpOAuthError, which the caller sends
   * to the (now verified) redirect URI.
   */
  public static parse(data: {
    parameters: Parameters;
    client: ResolvedMcpOAuthClient;
    redirectUri: string;
  }): McpOAuthAuthorizationRequest {
    const { parameters, client, redirectUri } = data;

    const state: string | undefined =
      AuthorizationRequest.readState(parameters);

    const responseType: string | undefined = AuthorizationRequest.single(
      parameters,
      "response_type",
    );

    if (responseType !== RESPONSE_TYPE_CODE) {
      throw new McpOAuthError(
        responseType
          ? McpOAuthErrorCode.UnsupportedResponseType
          : McpOAuthErrorCode.InvalidRequest,
        'response_type must be "code".',
      );
    }

    const codeChallenge: string | undefined = AuthorizationRequest.single(
      parameters,
      "code_challenge",
    );

    if (!codeChallenge) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidRequest,
        "code_challenge is required: this server requires PKCE.",
      );
    }

    /*
     * RFC 7636 defaults a missing method to "plain". Plain is not offered
     * here, so a missing method is refused rather than defaulted.
     */
    if (
      AuthorizationRequest.single(parameters, "code_challenge_method") !==
      PKCE_CODE_CHALLENGE_METHOD
    ) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidRequest,
        'code_challenge_method must be "S256".',
      );
    }

    if (!Pkce.isValidCodeChallenge(codeChallenge)) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidRequest,
        "code_challenge is not a valid S256 challenge (43 base64url characters).",
      );
    }

    /*
     * RFC 8707. Optional, because clients written against the earliest MCP
     * revisions do not send it - there is only one resource here, so absence
     * is unambiguous. Present, it has to be this MCP server.
     */
    const resource: string | undefined = AuthorizationRequest.single(
      parameters,
      "resource",
    );

    if (resource !== undefined && !McpOAuthConfig.isThisResource(resource)) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidTarget,
        `The resource must be ${McpOAuthConfig.getResource()}.`,
      );
    }

    return {
      clientId: client.clientId,
      clientKind: client.kind,
      clientName: client.clientName,
      ...(client.clientUri ? { clientUri: client.clientUri } : {}),
      redirectUri,
      codeChallenge,
      ...(state !== undefined ? { state } : {}),
      scopes: AuthorizationRequest.readScopes(parameters),
      resource: McpOAuthConfig.getResource(),
    };
  }

  /*
   * `state` is read on its own and first, so that even a request refused for
   * some other reason can have its state echoed in the error redirect - the
   * client uses it to find which of its flows failed.
   */
  public static readState(parameters: Parameters): string | undefined {
    const state: unknown = parameters["state"];

    if (state === undefined) {
      return undefined;
    }

    if (typeof state !== "string" || state.length > MAX_STATE_LENGTH) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidRequest,
        `state must be a single value of at most ${MAX_STATE_LENGTH} characters.`,
      );
    }

    return state;
  }

  /*
   * The access being asked for.
   *
   * Scopes this server does not issue are ignored rather than refused, which
   * RFC 6749 section 3.3 allows: clients habitually append `openid`,
   * `profile` or `email`, and refusing the whole request over a scope that
   * means nothing here would break them for no gain. A request that names no
   * access scope at all gets the least there is - read-only - and the token
   * response says so.
   */
  public static readScopes(parameters: Parameters): Array<McpOAuthScope> {
    const scope: unknown = parameters["scope"];

    if (scope === undefined || scope === "") {
      return [McpOAuthScope.Read];
    }

    if (typeof scope !== "string" || !McpOAuthScopeUtil.isWellFormed(scope)) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidScope,
        "scope must be a space-delimited list of scope names.",
      );
    }

    const parsed: ParsedMcpOAuthScope = McpOAuthScopeUtil.parse(scope);

    if (
      !McpOAuthScopeUtil.canRead(parsed.scopes) &&
      !McpOAuthScopeUtil.canWrite(parsed.scopes)
    ) {
      return McpOAuthScopeUtil.sort([McpOAuthScope.Read, ...parsed.scopes]);
    }

    return McpOAuthScopeUtil.normalize(parsed.scopes);
  }

  public static toTicket(
    request: McpOAuthAuthorizationRequest,
    now?: Date | undefined,
  ): string {
    const ticket: string | null = McpOAuthSignedToken.sign({
      purpose: TICKET_PURPOSE,
      claims: {
        ci: request.clientId,
        ck: request.clientKind,
        cn: request.clientName,
        ...(request.clientUri ? { cu: request.clientUri } : {}),
        ru: request.redirectUri,
        cc: request.codeChallenge,
        ...(request.state !== undefined ? { st: request.state } : {}),
        sc: McpOAuthScopeUtil.toString(request.scopes),
        rs: request.resource,
      },
      expiresInSeconds: McpOAuthConfig.AUTHORIZATION_REQUEST_TTL_SECONDS,
      now,
    });

    if (!ticket) {
      throw new AuthorizationDisplayError(
        AuthorizationDisplayErrorCode.RequestTooLarge,
      );
    }

    return ticket;
  }

  // The request a ticket describes, or null. NEVER throws.
  public static fromTicket(
    ticket: unknown,
    now?: Date | undefined,
  ): McpOAuthAuthorizationRequest | null {
    const claims: JSONObject | null = McpOAuthSignedToken.verify({
      purpose: TICKET_PURPOSE,
      token: ticket,
      now,
    });

    if (!claims) {
      return null;
    }

    const clientId: unknown = claims["ci"];
    const clientKind: unknown = claims["ck"];
    const clientName: unknown = claims["cn"];
    const clientUri: unknown = claims["cu"];
    const redirectUri: unknown = claims["ru"];
    const codeChallenge: unknown = claims["cc"];
    const state: unknown = claims["st"];
    const scope: unknown = claims["sc"];
    const resource: unknown = claims["rs"];

    if (
      typeof clientId !== "string" ||
      typeof clientName !== "string" ||
      typeof redirectUri !== "string" ||
      typeof codeChallenge !== "string" ||
      typeof scope !== "string" ||
      typeof resource !== "string" ||
      !clientId ||
      !redirectUri
    ) {
      return null;
    }

    if (
      clientKind !== McpOAuthClientKind.Registered &&
      clientKind !== McpOAuthClientKind.MetadataDocument
    ) {
      return null;
    }

    if (state !== undefined && typeof state !== "string") {
      return null;
    }

    return {
      clientId,
      clientKind,
      clientName,
      ...(typeof clientUri === "string" && clientUri ? { clientUri } : {}),
      redirectUri,
      codeChallenge,
      ...(state !== undefined ? { state } : {}),
      scopes: McpOAuthScopeUtil.parse(scope).scopes,
      resource,
    };
  }

  /*
   * Where the browser goes when the member approves. `iss` names this
   * authorization server (RFC 9207) so a client talking to several can tell
   * which one answered.
   */
  public static buildSuccessRedirect(data: {
    request: McpOAuthAuthorizationRequest;
    code: string;
  }): string {
    return RedirectUri.withParameters(data.request.redirectUri, {
      code: data.code,
      state: data.request.state,
      iss: McpOAuthConfig.getIssuer(),
    });
  }

  // Where the browser goes when the request is refused or the member denies.
  public static buildErrorRedirect(data: {
    redirectUri: string;
    state?: string | undefined;
    error: McpOAuthError;
  }): string {
    return RedirectUri.withParameters(data.redirectUri, {
      error: data.error.code,
      error_description: data.error.description,
      state: data.state,
      iss: McpOAuthConfig.getIssuer(),
    });
  }

  // Where the browser goes when the request cannot be sent back to a client.
  public static buildDisplayErrorUrl(
    code: AuthorizationDisplayErrorCode,
  ): string {
    const url: globalThis.URL = new globalThis.URL(
      McpOAuthConfig.getConsentPageUrl(),
    );

    url.searchParams.set("error", code);

    return url.toString();
  }

  public static buildConsentPageUrl(ticket: string): string {
    const url: globalThis.URL = new globalThis.URL(
      McpOAuthConfig.getConsentPageUrl(),
    );

    url.searchParams.set("request", ticket);

    return url.toString();
  }

  /*
   * A parameter that must appear at most once (RFC 6749 section 3.1). A
   * repeated parameter reaches Express as an array; it is treated as absent,
   * so "which of the two did the server use" is never a question.
   */
  private static single(
    parameters: Parameters,
    name: string,
  ): string | undefined {
    const value: unknown = parameters[name];

    return typeof value === "string" && value !== "" ? value : undefined;
  }
}
