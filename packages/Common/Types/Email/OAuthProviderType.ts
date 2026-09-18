/**
 * OAuth Provider Types for SMTP authentication.
 * Different providers use different OAuth 2.0 grant types.
 */
enum OAuthProviderType {
  /**
   * Client Credentials Grant (RFC 6749)
   * Used by: Microsoft 365, Azure AD, and most OAuth 2.0 providers
   *
   * Required fields: Client ID, Client Secret, Token URL, Scope
   */
  ClientCredentials = "Client Credentials",

  /**
   * JWT Bearer Assertion Grant (RFC 7523)
   * Used by: Google Workspace service accounts
   *
   * Required fields:
   * - Client ID: Service account email (client_email from JSON key)
   * - Client Secret: Private key (private_key from JSON key)
   * - Token URL: OAuth token endpoint
   * - Scope: Required scopes
   * - Username: Email address to impersonate
   */
  JWTBearer = "JWT Bearer",
}

export default OAuthProviderType;
