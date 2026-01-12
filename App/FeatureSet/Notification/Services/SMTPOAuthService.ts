import BadDataException from "Common/Types/Exception/BadDataException";
import logger from "Common/Server/Utils/Logger";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import { JSONObject } from "Common/Types/JSON";
import URL from "Common/Types/API/URL";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import jwt from "jsonwebtoken";

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface CachedToken extends JSONObject {
  accessToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
}

export interface SMTPOAuthConfig {
  clientId: string;
  clientSecret: string;
  tokenUrl: URL;
  scope: string;
  username?: string; // Email address to send as (required for JWT Bearer to impersonate user)
  providerType: OAuthProviderType; // The OAuth grant type to use
}

/**
 * Generic service for fetching OAuth2 access tokens for SMTP authentication.
 * Supports multiple OAuth 2.0 grant types:
 *
 * - Client Credentials (OAuthProviderType.ClientCredentials)
 *   Standard OAuth 2.0 client credentials flow (RFC 6749)
 *   Required fields: Client ID, Client Secret, Token URL, Scope
 *
 * - JWT Bearer Assertion (OAuthProviderType.JWTBearer)
 *   JWT Bearer token grant flow (RFC 7523)
 *   Required fields:
 *   - Client ID: Issuer identifier (e.g., service account email)
 *   - Client Secret: Private key for signing the JWT
 *   - Token URL: OAuth token endpoint
 *   - Scope: Required scopes
 *   - Username: Subject/user to impersonate
 */
export default class SMTPOAuthService {
  private static readonly TOKEN_CACHE_NAMESPACE = "smtp-oauth-tokens";
  private static readonly TOKEN_BUFFER_SECONDS = 300; // Refresh token 5 minutes before expiry
  private static readonly JWT_EXPIRY_SECONDS = 3600; // JWTs are valid for max 1 hour

  /**
   * Get an access token for SMTP authentication.
   * Uses the provider type specified in config to determine the grant type.
   *
   * @param config - OAuth configuration
   * @returns The access token
   */
  public static async getAccessToken(config: SMTPOAuthConfig): Promise<string> {
    const cacheKey = `${config.tokenUrl.toString()}:${config.clientId}:${config.username || ""}`;

    // Check if we have a cached token that's still valid
    if (LocalCache.hasValue(this.TOKEN_CACHE_NAMESPACE, cacheKey)) {
      const cachedToken: CachedToken = LocalCache.getJSON(
        this.TOKEN_CACHE_NAMESPACE,
        cacheKey,
      ) as CachedToken;

      const now: number = Date.now();
      if (cachedToken.expiresAt > now) {
        logger.debug("Using cached OAuth token for SMTP");
        return cachedToken.accessToken;
      }
    }

    // Fetch a new token using the appropriate method based on provider type
    let token: string;

    switch (config.providerType) {
      case OAuthProviderType.JWTBearer:
        token = await this.fetchJWTBearerToken(config);
        break;
      case OAuthProviderType.ClientCredentials:
      default:
        token = await this.fetchClientCredentialsToken(config);
        break;
    }

    return token;
  }

  /**
   * Fetch token using JWT Bearer assertion flow (RFC 7523).
   * Used by providers that require signed JWT assertions for authentication.
   */
  private static async fetchJWTBearerToken(config: SMTPOAuthConfig): Promise<string> {
    if (!config.username) {
      throw new BadDataException(
        "Username (subject) is required for JWT Bearer OAuth. " +
        "This is typically the email address or user identifier to impersonate."
      );
    }

    // Validate that clientSecret looks like a private key
    if (!config.clientSecret.includes("-----BEGIN") || !config.clientSecret.includes("PRIVATE KEY")) {
      throw new BadDataException(
        "For JWT Bearer OAuth, the Client Secret must be a private key in PEM format. " +
        "It should contain '-----BEGIN PRIVATE KEY-----' or '-----BEGIN RSA PRIVATE KEY-----'."
      );
    }

    try {
      logger.debug("Creating JWT for OAuth token request");

      const now = Math.floor(Date.now() / 1000);

      // Create JWT claims
      const jwtClaims = {
        iss: config.clientId, // Issuer (service account email for Google)
        sub: config.username, // Subject (user to impersonate)
        scope: config.scope,
        aud: config.tokenUrl.toString(),
        iat: now,
        exp: now + this.JWT_EXPIRY_SECONDS,
      };

      // Sign the JWT with the private key
      const signedJwt = jwt.sign(jwtClaims, config.clientSecret, {
        algorithm: "RS256",
      });

      logger.debug(`Fetching OAuth token from ${config.tokenUrl.toString()} using JWT Bearer`);

      // Exchange JWT for access token
      const params = new URLSearchParams();
      params.append("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
      params.append("assertion", signedJwt);

      const response: Response = await fetch(config.tokenUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText: string = await response.text();
        logger.error(`Failed to fetch OAuth token: ${response.status} - ${errorText}`);

        // Provide helpful error messages for common issues
        if (errorText.includes("invalid_grant")) {
          throw new BadDataException(
            `OAuth failed: invalid_grant. This usually means: ` +
            `1) The issuer (Client ID) is not authorized, ` +
            `2) The subject '${config.username}' doesn't exist or can't be impersonated, ` +
            `3) The scope '${config.scope}' is not authorized, or ` +
            `4) Required delegations/permissions are not configured. ` +
            `Please check your OAuth provider's configuration.`
          );
        }

        if (errorText.includes("unauthorized_client")) {
          throw new BadDataException(
            `OAuth failed: unauthorized_client. ` +
            `The issuer '${config.clientId}' is not authorized. ` +
            `Please verify that the client has the required permissions and delegations configured.`
          );
        }

        throw new BadDataException(
          `Failed to authenticate with OAuth provider: ${response.status}. Error: ${errorText}`
        );
      }

      const tokenData: OAuthTokenResponse = (await response.json()) as OAuthTokenResponse;

      if (!tokenData.access_token) {
        throw new BadDataException("OAuth response did not contain an access token");
      }

      // Cache the token
      this.cacheToken(config, tokenData);

      logger.debug("Successfully obtained and cached OAuth token via JWT Bearer");

      return tokenData.access_token;
    } catch (error) {
      if (error instanceof BadDataException) {
        throw error;
      }

      logger.error("Error fetching OAuth token via JWT Bearer:");
      logger.error(error);

      // Handle JWT signing errors
      if (error instanceof Error && error.message.includes("PEM")) {
        throw new BadDataException(
          `Invalid private key format. Make sure you copied the entire private key, ` +
          `including the '-----BEGIN PRIVATE KEY-----' and '-----END PRIVATE KEY-----' markers. ` +
          `Error: ${error.message}`
        );
      }

      throw new BadDataException(
        `Failed to authenticate with OAuth provider: ${error instanceof Error ? error.message : "Unknown error"}. ` +
        `Please verify your credentials and provider settings.`
      );
    }
  }

  /**
   * Fetch token using OAuth 2.0 client credentials flow (RFC 6749).
   * Standard OAuth 2.0 grant type supported by most providers.
   */
  private static async fetchClientCredentialsToken(config: SMTPOAuthConfig): Promise<string> {
    const params = new URLSearchParams();
    params.append("client_id", config.clientId);
    params.append("client_secret", config.clientSecret);
    params.append("scope", config.scope);
    params.append("grant_type", "client_credentials");

    try {
      logger.debug(`Fetching OAuth token from ${config.tokenUrl.toString()} using Client Credentials`);

      const response: Response = await fetch(config.tokenUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText: string = await response.text();
        logger.error(
          `Failed to fetch OAuth token: ${response.status} - ${errorText}`,
        );
        throw new BadDataException(
          `Failed to authenticate with OAuth provider: ${response.status}. ` +
          `Please check your OAuth credentials (Client ID, Client Secret, Token URL, and Scope). ` +
          `Error: ${errorText}`,
        );
      }

      const tokenData: OAuthTokenResponse =
        (await response.json()) as OAuthTokenResponse;

      if (!tokenData.access_token) {
        throw new BadDataException(
          "OAuth response did not contain an access token",
        );
      }

      // Cache the token
      this.cacheToken(config, tokenData);

      logger.debug("Successfully obtained and cached OAuth token via Client Credentials");

      return tokenData.access_token;
    } catch (error) {
      if (error instanceof BadDataException) {
        throw error;
      }

      logger.error("Error fetching OAuth token via Client Credentials:");
      logger.error(error);

      throw new BadDataException(
        `Failed to authenticate with OAuth provider: ${error instanceof Error ? error.message : "Unknown error"}. ` +
        `Please check your OAuth credentials and network connectivity.`,
      );
    }
  }

  /**
   * Cache the token for future use.
   */
  private static cacheToken(config: SMTPOAuthConfig, tokenData: OAuthTokenResponse): void {
    const cacheKey = `${config.tokenUrl.toString()}:${config.clientId}:${config.username || ""}`;
    const expiresAt: number =
      Date.now() + (tokenData.expires_in - this.TOKEN_BUFFER_SECONDS) * 1000;

    const cachedToken: CachedToken = {
      accessToken: tokenData.access_token,
      expiresAt,
    };

    LocalCache.setJSON(this.TOKEN_CACHE_NAMESPACE, cacheKey, cachedToken);
  }

  /**
   * Create the XOAUTH2 token string for SMTP authentication.
   * Format: base64("user=" + userName + "^Aauth=Bearer " + accessToken + "^A^A")
   *
   * This format is used by most OAuth-enabled SMTP servers.
   *
   * @param username - The email address to authenticate as
   * @param accessToken - The OAuth access token
   * @returns The base64-encoded XOAUTH2 token
   */
  public static createXOAuth2Token(
    username: string,
    accessToken: string,
  ): string {
    // ^A is Control+A which is ASCII code 1 (0x01)
    const authString = `user=${username}\x01auth=Bearer ${accessToken}\x01\x01`;
    return Buffer.from(authString).toString("base64");
  }
}
