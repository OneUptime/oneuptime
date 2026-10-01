import crypto from "crypto";
import McpOAuthTokenType from "../../../Types/Mcp/McpOAuthTokenType";

/*
 * The secrets the MCP authorization server issues, and how they are kept.
 *
 * SHAPE
 *
 * 256 bits from the CSPRNG as base64url (43 characters) behind a short prefix
 * that says what the secret is:
 *
 *   oumcp_ac_…  authorization code
 *   oumcp_at_…  access token
 *   oumcp_rt_…  refresh token
 *   oumcp_cs_…  client secret (confidential registered clients)
 *
 * The prefix earns its place twice. The MCP endpoint accepts an API key and
 * an OAuth access token in the same `Authorization: Bearer` header, and the
 * prefix is how it tells them apart without a database lookup - an API key is
 * a UUID and can never start with `oumcp_`. And a secret that says what it is
 * can be recognised by a scanner when it turns up in a log or a repository.
 *
 * STORAGE
 *
 * Only the unkeyed SHA-256 hex of the whole secret (prefix included) is ever
 * stored. See McpOAuthToken for why the hash is unkeyed.
 */

// crypto.randomBytes(32) -> 32 bytes -> ceil(32 * 8 / 6) = 43 base64url chars.
const SECRET_BYTE_LENGTH: number = 32;
const SECRET_BODY_PATTERN: string = "[A-Za-z0-9_-]{43}";

const SECRET_NAMESPACE: string = "oumcp_";

export const MCP_OAUTH_AUTHORIZATION_CODE_PREFIX: string = `${SECRET_NAMESPACE}ac_`;
export const MCP_OAUTH_ACCESS_TOKEN_PREFIX: string = `${SECRET_NAMESPACE}at_`;
export const MCP_OAUTH_REFRESH_TOKEN_PREFIX: string = `${SECRET_NAMESPACE}rt_`;
export const MCP_OAUTH_CLIENT_SECRET_PREFIX: string = `${SECRET_NAMESPACE}cs_`;

const PREFIX_BY_TOKEN_TYPE: Record<McpOAuthTokenType, string> = {
  [McpOAuthTokenType.AuthorizationCode]: MCP_OAUTH_AUTHORIZATION_CODE_PREFIX,
  [McpOAuthTokenType.AccessToken]: MCP_OAUTH_ACCESS_TOKEN_PREFIX,
  [McpOAuthTokenType.RefreshToken]: MCP_OAUTH_REFRESH_TOKEN_PREFIX,
};

const buildPattern: (prefix: string) => RegExp = (prefix: string): RegExp => {
  return new RegExp(`^${prefix}${SECRET_BODY_PATTERN}$`);
};

const PATTERN_BY_TOKEN_TYPE: Record<McpOAuthTokenType, RegExp> = {
  [McpOAuthTokenType.AuthorizationCode]: buildPattern(
    MCP_OAUTH_AUTHORIZATION_CODE_PREFIX,
  ),
  [McpOAuthTokenType.AccessToken]: buildPattern(MCP_OAUTH_ACCESS_TOKEN_PREFIX),
  [McpOAuthTokenType.RefreshToken]: buildPattern(
    MCP_OAUTH_REFRESH_TOKEN_PREFIX,
  ),
};

const CLIENT_SECRET_PATTERN: RegExp = buildPattern(
  MCP_OAUTH_CLIENT_SECRET_PREFIX,
);

export default class McpOAuthSecret {
  public static mint(tokenType: McpOAuthTokenType): string {
    return `${PREFIX_BY_TOKEN_TYPE[tokenType]}${McpOAuthSecret.randomBody()}`;
  }

  public static mintClientSecret(): string {
    return `${MCP_OAUTH_CLIENT_SECRET_PREFIX}${McpOAuthSecret.randomBody()}`;
  }

  /*
   * Unkeyed SHA-256 of the secret, lowercase hex (64 characters): the value
   * stored and the value looked up by. Deterministic by construction.
   */
  public static hash(secret: string): string {
    return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
  }

  /*
   * True when the value has exactly the shape a minted secret of that type
   * has. The shape guard in front of every lookup: anything else cannot be a
   * credential this server issued, so it is refused before it costs a query.
   */
  public static isValidShape(
    secret: unknown,
    tokenType: McpOAuthTokenType,
  ): secret is string {
    return (
      typeof secret === "string" &&
      PATTERN_BY_TOKEN_TYPE[tokenType].test(secret)
    );
  }

  public static isValidClientSecretShape(secret: unknown): secret is string {
    return typeof secret === "string" && CLIENT_SECRET_PATTERN.test(secret);
  }

  /*
   * Whether a bearer value CLAIMS to be an OAuth access token. Looser than
   * isValidShape on purpose: it decides which kind of credential the caller
   * is attempting, so a mangled access token is answered as a bad OAuth token
   * (401 with a challenge, which makes the client refresh) instead of being
   * passed along as an API key that will never match.
   */
  public static looksLikeAccessToken(value: unknown): value is string {
    return (
      typeof value === "string" &&
      value.startsWith(MCP_OAUTH_ACCESS_TOKEN_PREFIX)
    );
  }

  /*
   * Whether a value is one of this server's own secrets of ANY kind - an
   * authorization code, a refresh token, a client secret - going by its
   * namespace alone. The MCP endpoint asks so that such a value, put where a
   * credential goes, is refused there rather than passed along as an API key:
   * it is not one, and a long-lived secret has no business being forwarded.
   */
  public static looksLikeIssuedSecret(value: unknown): value is string {
    return typeof value === "string" && value.startsWith(SECRET_NAMESPACE);
  }

  /*
   * Constant-time comparison of two digests held in memory. A length mismatch
   * is answered false without comparing content.
   */
  public static isHashEqual(a: string, b: string): boolean {
    /*
     * Plain Uint8Arrays rather than Buffers: the App build's @types/node
     * rejects Buffer where an ArrayBufferView is expected (the mismatch
     * CalendarFeedToken documents), and TextEncoder is global on every
     * supported Node.
     */
    const bytesA: Uint8Array = new TextEncoder().encode(a);
    const bytesB: Uint8Array = new TextEncoder().encode(b);

    if (bytesA.length !== bytesB.length) {
      return false;
    }

    return crypto.timingSafeEqual(bytesA, bytesB);
  }

  private static randomBody(): string {
    return crypto.randomBytes(SECRET_BYTE_LENGTH).toString("base64url");
  }
}
