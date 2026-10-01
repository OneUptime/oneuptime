import {
  DisableMcpOAuth,
  DisableMcpOAuthClientIdMetadataDocuments,
  Host,
  HttpProtocol,
} from "../../EnvironmentConfig";

/*
 * The fixed points of the MCP authorization server: where it lives, and how
 * long the things it hands out last.
 *
 * ONE ISSUER, UNDER /mcp
 *
 * The authorization server and the MCP endpoint it protects share a URL:
 * `https://<host>/mcp` is both the issuer and the resource. Every OAuth
 * endpoint sits beneath it, so the whole feature is reachable through the one
 * path that already routes to the App on every deployment, and it claims
 * nothing about the rest of the origin.
 *
 * ALWAYS FROM CONFIGURATION, NEVER FROM THE REQUEST
 *
 * Every URL here is built from HOST / HTTP_PROTOCOL. A token is bound to the
 * resource it was issued for, and an issuer that followed the Host header
 * would let whoever controls a hostname pointed at this instance mint
 * metadata naming their own endpoints.
 */

const MCP_PATH: string = "/mcp";
const OAUTH_PATH: string = `${MCP_PATH}/oauth`;

export default class McpOAuthConfig {
  /*
   * An authorization code is collected by the client within seconds of the
   * member pressing Authorize. Five minutes is generous for a slow network
   * and short enough that a code which leaks afterwards is already dead.
   */
  public static readonly AUTHORIZATION_CODE_TTL_SECONDS: number = 5 * 60;

  /*
   * The credential that rides on every MCP request, so the one most likely to
   * end up in a log or a crash dump. An hour bounds what a leaked one is
   * worth; the client refreshes without anybody noticing.
   */
  public static readonly ACCESS_TOKEN_TTL_SECONDS: number = 60 * 60;

  /*
   * Sliding: each refresh issues a new token good for another thirty days,
   * so a client in regular use never has to ask its user to sign in again,
   * and one left unused for a month quietly stops working. The same window
   * a dashboard session's refresh token gets.
   */
  public static readonly REFRESH_TOKEN_TTL_SECONDS: number = 30 * 24 * 60 * 60;

  /*
   * How long a refresh token that has just been exchanged may be presented
   * again without that being treated as theft.
   *
   * Rotation invalidates a refresh token the moment it is used, and using a
   * spent one revokes the whole grant - that is what makes a stolen token
   * detectable. But clients do send the same token twice in good faith: a
   * response lost on the way back and retried, two workers of one hosted
   * client refreshing at the same moment. Without a grace period each of
   * those would sign the user out. Inside it, the retry simply gets its own
   * fresh pair.
   */
  public static readonly REFRESH_TOKEN_REUSE_GRACE_SECONDS: number = 60;

  /*
   * How long the signed description of an authorization request stays valid:
   * the time a person has to sign in and decide on the consent screen.
   */
  public static readonly AUTHORIZATION_REQUEST_TTL_SECONDS: number = 10 * 60;

  /*
   * How long the internal credential the MCP server presents to the API on a
   * member's behalf is good for. It is minted per tool call and used at once.
   */
  public static readonly DELEGATION_TOKEN_TTL_SECONDS: number = 60;

  public static isEnabled(): boolean {
    return !DisableMcpOAuth;
  }

  public static isClientIdMetadataDocumentEnabled(): boolean {
    return !DisableMcpOAuthClientIdMetadataDocuments;
  }

  /*
   * The origin this instance is served from. The fallback matches the MCP
   * server's own (Config/ServerConfig.getApiUrl), so the two can never
   * disagree about where the API is.
   */
  public static getOrigin(): string {
    return Host ? `${HttpProtocol}${Host}` : "https://oneuptime.com";
  }

  // The MCP endpoint: the protected resource (RFC 9728) and token audience.
  public static getResource(): string {
    return `${McpOAuthConfig.getOrigin()}${MCP_PATH}`;
  }

  // The authorization server's issuer identifier (RFC 8414).
  public static getIssuer(): string {
    return `${McpOAuthConfig.getOrigin()}${MCP_PATH}`;
  }

  public static getAuthorizationEndpoint(): string {
    return `${McpOAuthConfig.getOrigin()}${OAUTH_PATH}/authorize`;
  }

  public static getTokenEndpoint(): string {
    return `${McpOAuthConfig.getOrigin()}${OAUTH_PATH}/token`;
  }

  public static getRegistrationEndpoint(): string {
    return `${McpOAuthConfig.getOrigin()}${OAUTH_PATH}/register`;
  }

  public static getRevocationEndpoint(): string {
    return `${McpOAuthConfig.getOrigin()}${OAUTH_PATH}/revoke`;
  }

  /*
   * The protected resource metadata URL a challenge points at. The copy under
   * /mcp rather than the one under /.well-known: it is served by the same
   * route that just answered 401, so it is reachable wherever the challenge
   * is, including behind a proxy that forwards only /mcp.
   */
  public static getProtectedResourceMetadataUrl(): string {
    return `${McpOAuthConfig.getResource()}/.well-known/oauth-protected-resource`;
  }

  // Where a person is sent to sign in and decide.
  public static getConsentPageUrl(): string {
    return `${McpOAuthConfig.getOrigin()}/accounts/mcp-authorize`;
  }

  public static getDocumentationUrl(): string {
    return `${McpOAuthConfig.getOrigin()}/docs/ai/mcp-server`;
  }

  /*
   * Whether a `resource` value names this MCP server.
   *
   * Compared as URLs rather than as strings, so the differences that do not
   * change what a URL points at are tolerated: letter case in the scheme and
   * host, a default port spelled out, a trailing slash (clients derive the
   * value from whatever their user typed). Anything that does change it is
   * refused - another host, scheme, port or path is a token meant for
   * somewhere else - and so is a query, a fragment or embedded credentials,
   * none of which a resource identifier may carry (RFC 8707 section 2).
   */
  public static isThisResource(value: unknown): boolean {
    if (typeof value !== "string" || !value) {
      return false;
    }

    let candidate: globalThis.URL;
    let expected: globalThis.URL;

    try {
      candidate = new globalThis.URL(value);
      expected = new globalThis.URL(McpOAuthConfig.getResource());
    } catch {
      return false;
    }

    /*
     * The raw string is checked as well: the parser reports an empty query
     * or fragment ("…/mcp?", "…/mcp#") as no query or fragment at all.
     */
    if (
      value.includes("?") ||
      value.includes("#") ||
      candidate.username ||
      candidate.password
    ) {
      return false;
    }

    return (
      candidate.origin === expected.origin &&
      McpOAuthConfig.stripTrailingSlash(candidate.pathname) ===
        McpOAuthConfig.stripTrailingSlash(expected.pathname)
    );
  }

  private static stripTrailingSlash(pathname: string): string {
    return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  }
}
