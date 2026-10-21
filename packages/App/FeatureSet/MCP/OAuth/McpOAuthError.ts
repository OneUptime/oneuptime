/**
 * OAuth errors
 *
 * The error codes the MCP authorization server answers with, and one error
 * type that carries a code, a description a client developer can act on, and
 * the HTTP status the code is answered with at a back-channel endpoint.
 *
 * Codes come from RFC 6749 (authorization and token endpoints), RFC 6750
 * (resource requests), RFC 7591 (client registration), RFC 7009 (revocation)
 * and RFC 8707 (resource indicators). They are a wire contract: clients switch
 * on these strings - the MCP SDK signs a user out on `invalid_client` and
 * discards its tokens on `invalid_grant` - so each is used for exactly the
 * situation its RFC names.
 */

export enum McpOAuthErrorCode {
  // Malformed request: a missing, repeated or unusable parameter.
  InvalidRequest = "invalid_request",

  // The client is unknown, or failed to authenticate.
  InvalidClient = "invalid_client",

  /*
   * The code or refresh token is no good: unknown, expired, already used,
   * issued to another client, or its grant is no longer usable. A client
   * answers this by starting authorization again.
   */
  InvalidGrant = "invalid_grant",

  UnauthorizedClient = "unauthorized_client",
  UnsupportedGrantType = "unsupported_grant_type",
  UnsupportedResponseType = "unsupported_response_type",
  InvalidScope = "invalid_scope",

  // The person pressed Deny.
  AccessDenied = "access_denied",

  ServerError = "server_error",
  TemporarilyUnavailable = "temporarily_unavailable",

  // RFC 8707: the `resource` is not this MCP server.
  InvalidTarget = "invalid_target",

  // RFC 7591.
  InvalidRedirectUri = "invalid_redirect_uri",
  InvalidClientMetadata = "invalid_client_metadata",

  // RFC 6750.
  InvalidToken = "invalid_token",
  InsufficientScope = "insufficient_scope",

  // RFC 7009.
  UnsupportedTokenType = "unsupported_token_type",

  // Not from an RFC; the reference MCP server uses the same string.
  TooManyRequests = "too_many_requests",
}

export interface McpOAuthErrorBody {
  error: string;
  error_description: string;
}

export default class McpOAuthError extends Error {
  public readonly code: McpOAuthErrorCode;
  public readonly description: string;

  /*
   * A `WWW-Authenticate` value to answer with, when the error is a failed
   * attempt to authenticate in the Authorization header: RFC 6749 section 5.2
   * requires the 401 to name the scheme the client used.
   */
  public readonly challenge: string | undefined;

  public constructor(
    code: McpOAuthErrorCode,
    description: string,
    options?: { challenge?: string | undefined } | undefined,
  ) {
    super(`${code}: ${description}`);
    this.name = "McpOAuthError";
    this.code = code;
    this.description = description;
    this.challenge = options?.challenge;
  }

  /*
   * The status a back-channel endpoint (token, registration, revocation)
   * answers this code with. 400 for everything a client got wrong, per
   * RFC 6749 section 5.2, with the two exceptions that section names: a
   * client that failed to authenticate is 401, and a fault of ours is 5xx.
   */
  public getStatusCode(): number {
    switch (this.code) {
      case McpOAuthErrorCode.InvalidClient:
        return 401;
      case McpOAuthErrorCode.ServerError:
        return 500;
      case McpOAuthErrorCode.TemporarilyUnavailable:
        return 503;
      case McpOAuthErrorCode.TooManyRequests:
        return 429;
      default:
        return 400;
    }
  }

  public toResponseBody(): McpOAuthErrorBody {
    return {
      error: this.code,
      error_description: this.description,
    };
  }
}
