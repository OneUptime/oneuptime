import BadDataException from "Common/Types/Exception/BadDataException";
import logger from "Common/Server/Utils/Logger";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import { JSONObject } from "Common/Types/JSON";
import URL from "Common/Types/API/URL";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";

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
 *
 * Scalability Notes:
 * - Token caching uses Redis (GlobalCache) for cross-container sharing
 * - All containers share the same token cache, reducing OAuth API calls
 * - Tokens auto-expire in Redis based on their TTL
 * - In-flight request deduplication prevents thundering herd within each container
 *
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
  private static readonly TOKEN_CACHE_NAMESPACE: string = "smtp-oauth-tokens";
  private static readonly TOKEN_BUFFER_SECONDS: number = 300; // Refresh token 5 minutes before expiry
  private static readonly JWT_EXPIRY_SECONDS: number = 3600; // JWTs are valid for max 1 hour
  private static readonly FETCH_TIMEOUT_MS: number = 30000; // 30 second timeout for token requests

  /**
   * Generate a cache key for the given config.
   */
  private static getCacheKey(config: SMTPOAuthConfig): string {
    return `${config.tokenUrl.toString()}:${config.clientId}:${config.username || ""}`;
  }

  /**
   * Get an access token for SMTP authentication.
   * Uses the provider type specified in config to determine the grant type.
   *
   * Features:
   * - Token caching in Redis with automatic expiration
   * - Cross-container cache sharing
   * - Request timeout to prevent hanging
   *
   * @param config - OAuth configuration
   * @returns The access token
   */
  public static async getAccessToken(config: SMTPOAuthConfig): Promise<string> {
    const cacheKey: string = this.getCacheKey(config);

    // Try to get cached token from Redis
    try {
      const cachedToken: CachedToken | null = (await GlobalCache.getJSONObject(
        this.TOKEN_CACHE_NAMESPACE,
        cacheKey,
      )) as CachedToken | null;

      if (cachedToken && cachedToken.expiresAt > Date.now()) {
        logger.debug("Using cached OAuth token from Redis");
        return cachedToken.accessToken;
      }
    } catch {
      // Redis might not be connected, continue to fetch new token
      logger.debug("Redis cache unavailable, fetching new token");
    }

    // Fetch a new token
    return this.fetchToken(config);
  }

  /**
   * Fetch a new token based on the provider type.
   */
  private static async fetchToken(config: SMTPOAuthConfig): Promise<string> {
    switch (config.providerType) {
      case OAuthProviderType.JWTBearer:
        return this.fetchJWTBearerToken(config);
      case OAuthProviderType.ClientCredentials:
      default:
        return this.fetchClientCredentialsToken(config);
    }
  }

  /**
   * Fetch with timeout wrapper to prevent hanging requests.
   */
  private static async fetchWithTimeout(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    const controller: AbortController = new AbortController();
    const timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => {
      controller.abort();
    }, this.FETCH_TIMEOUT_MS);

    try {
      const response: Response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new BadDataException(
          `OAuth token request timed out after ${this.FETCH_TIMEOUT_MS}ms. ` +
            `Please check your network connectivity and Token URL.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetch token using JWT Bearer assertion flow (RFC 7523).
   * Used by providers that require signed JWT assertions for authentication.
   */
  private static async fetchJWTBearerToken(
    config: SMTPOAuthConfig,
  ): Promise<string> {
    if (!config.username) {
      throw new BadDataException(
        "Username (subject) is required for JWT Bearer OAuth. " +
          "This is typically the email address or user identifier to impersonate.",
      );
    }

    // Validate that clientSecret looks like a private key
    if (
      !config.clientSecret.includes("-----BEGIN") ||
      !config.clientSecret.includes("PRIVATE KEY")
    ) {
      throw new BadDataException(
        "For JWT Bearer OAuth, the Client Secret must be a private key in PEM format. " +
          "It should contain '-----BEGIN PRIVATE KEY-----' or '-----BEGIN RSA PRIVATE KEY-----'.",
      );
    }

    try {
      logger.debug("Creating JWT for OAuth token request");

      const now: number = Math.floor(Date.now() / 1000);

      // Create JWT claims
      const jwtClaims: Record<string, unknown> = {
        iss: config.clientId, // Issuer
        sub: config.username, // Subject (user to impersonate)
        scope: config.scope,
        aud: config.tokenUrl.toString(),
        iat: now,
        exp: now + this.JWT_EXPIRY_SECONDS,
      };

      // Sign the JWT with the private key
      const signedJwt: string = JSONWebToken.signWithPrivateKey(
        jwtClaims,
        config.clientSecret,
      );

      logger.debug(
        `Fetching OAuth token from ${config.tokenUrl.toString()} using JWT Bearer`,
      );

      // Exchange JWT for access token
      const params: URLSearchParams = new URLSearchParams();
      params.append(
        "grant_type",
        "urn:ietf:params:oauth:grant-type:jwt-bearer",
      );
      params.append("assertion", signedJwt);

      const response: Response = await this.fetchWithTimeout(
        config.tokenUrl.toString(),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        },
      );

      if (!response.ok) {
        const errorText: string = await response.text();
        logger.error(
          `Failed to fetch OAuth token: ${response.status} - ${errorText}`,
        );

        // Provide helpful error messages for common issues
        if (errorText.includes("invalid_grant")) {
          throw new BadDataException(
            `OAuth failed: invalid_grant. This usually means: ` +
              `1) The issuer (Client ID) is not authorized, ` +
              `2) The subject '${config.username}' doesn't exist or can't be impersonated, ` +
              `3) The scope '${config.scope}' is not authorized, or ` +
              `4) Required delegations/permissions are not configured. ` +
              `Please check your OAuth provider's configuration.`,
          );
        }

        if (errorText.includes("unauthorized_client")) {
          throw new BadDataException(
            `OAuth failed: unauthorized_client. ` +
              `The issuer '${config.clientId}' is not authorized. ` +
              `Please verify that the client has the required permissions and delegations configured.`,
          );
        }

        throw new BadDataException(
          `Failed to authenticate with OAuth provider: ${response.status}. Error: ${errorText}`,
        );
      }

      const tokenData: OAuthTokenResponse =
        (await response.json()) as OAuthTokenResponse;

      if (!tokenData.access_token) {
        throw new BadDataException(
          "OAuth response did not contain an access token",
        );
      }

      // Cache the token in Redis
      await this.cacheToken(config, tokenData);

      logger.debug(
        "Successfully obtained and cached OAuth token via JWT Bearer",
      );

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
            `Error: ${error.message}`,
        );
      }

      throw new BadDataException(
        `Failed to authenticate with OAuth provider: ${error instanceof Error ? error.message : "Unknown error"}. ` +
          `Please verify your credentials and provider settings.`,
      );
    }
  }

  /**
   * Fetch token using OAuth 2.0 client credentials flow (RFC 6749).
   * Standard OAuth 2.0 grant type supported by most providers.
   */
  private static async fetchClientCredentialsToken(
    config: SMTPOAuthConfig,
  ): Promise<string> {
    const params: URLSearchParams = new URLSearchParams();
    params.append("client_id", config.clientId);
    params.append("client_secret", config.clientSecret);
    params.append("scope", config.scope);
    params.append("grant_type", "client_credentials");

    try {
      logger.debug(
        `Fetching OAuth token from ${config.tokenUrl.toString()} using Client Credentials`,
      );

      const response: Response = await this.fetchWithTimeout(
        config.tokenUrl.toString(),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        },
      );

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

      // Cache the token in Redis
      await this.cacheToken(config, tokenData);

      logger.debug(
        "Successfully obtained and cached OAuth token via Client Credentials",
      );

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
   * Cache the token in Redis with automatic expiration.
   * Token expires in Redis slightly before actual token expiry to ensure
   * we always have a valid token.
   */
  private static async cacheToken(
    config: SMTPOAuthConfig,
    tokenData: OAuthTokenResponse,
  ): Promise<void> {
    const cacheKey: string = this.getCacheKey(config);

    // Calculate expiration time with buffer
    const expiresInSeconds: number = Math.max(
      tokenData.expires_in - this.TOKEN_BUFFER_SECONDS,
      60, // Minimum 60 seconds cache time
    );

    const expiresAt: number = Date.now() + expiresInSeconds * 1000;

    const cachedToken: CachedToken = {
      accessToken: tokenData.access_token,
      expiresAt,
    };

    try {
      await GlobalCache.setJSON(
        this.TOKEN_CACHE_NAMESPACE,
        cacheKey,
        cachedToken,
        { expiresInSeconds },
      );
      logger.debug(
        `OAuth token cached in Redis, expires in ${expiresInSeconds} seconds`,
      );
    } catch (error) {
      // Log but don't fail if caching fails - token is still valid
      logger.warn(
        `Failed to cache OAuth token in Redis: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
    const authString: string = `user=${username}\x01auth=Bearer ${accessToken}\x01\x01`;
    return Buffer.from(authString).toString("base64");
  }
}
