/*
 * The three credentials the MCP authorization server hands out. They live in
 * one table because they share everything that matters about a secret - it is
 * stored only as a digest, it expires, and it belongs to exactly one grant -
 * and differ only in how long they last and whether they can be used twice.
 */
enum McpOAuthTokenType {
  // Exchanged once, within minutes, for the first access and refresh token.
  AuthorizationCode = "authorization_code",

  // What an MCP request carries. Short-lived and usable until it expires.
  AccessToken = "access_token",

  // Exchanged once for a new access token and a new refresh token.
  RefreshToken = "refresh_token",
}

export default McpOAuthTokenType;
