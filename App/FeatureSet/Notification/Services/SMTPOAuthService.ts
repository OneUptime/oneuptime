import BadDataException from "Common/Types/Exception/BadDataException";
import logger from "Common/Server/Utils/Logger";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import { JSONObject } from "Common/Types/JSON";
import URL from "Common/Types/API/URL";

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
  tokenUrl: URL; // Full OAuth token endpoint URL
  scope: string; // OAuth scope(s), space-separated if multiple
}

/**
 * Generic service for fetching OAuth2 access tokens for SMTP authentication.
 * Supports any OAuth 2.0 provider that implements the client credentials grant flow.
 *
 * Common configurations:
 *
 * Microsoft 365:
 *   - tokenUrl: https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token
 *   - scope: https://outlook.office365.com/.default
 *
 * Google Workspace (requires service account):
 *   - tokenUrl: https://oauth2.googleapis.com/token
 *   - scope: https://mail.google.com/
 *
 * Custom OAuth Provider:
 *   - tokenUrl: Your provider's token endpoint
 *   - scope: Required scope(s) for SMTP access
 */
export default class SMTPOAuthService {
  private static readonly TOKEN_CACHE_NAMESPACE = "smtp-oauth-tokens";
  private static readonly TOKEN_BUFFER_SECONDS = 300; // Refresh token 5 minutes before expiry

  /**
   * Get an access token for SMTP authentication using OAuth 2.0 client credentials flow.
   *
   * @param config - OAuth configuration including clientId, clientSecret, tokenUrl, and scope
   * @returns The access token
   */
  public static async getAccessToken(config: SMTPOAuthConfig): Promise<string> {
    const cacheKey = `${config.tokenUrl.toString()}:${config.clientId}`;

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

    // Fetch a new token
    const token: string = await this.fetchNewToken(config);
    return token;
  }

  private static async fetchNewToken(config: SMTPOAuthConfig): Promise<string> {
    const params = new URLSearchParams();
    params.append("client_id", config.clientId);
    params.append("client_secret", config.clientSecret);
    params.append("scope", config.scope);
    params.append("grant_type", "client_credentials");

    try {
      logger.debug(`Fetching new OAuth token from ${config.tokenUrl.toString()}`);

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
          `Failed to authenticate with OAuth provider: ${response.status}. Please check your OAuth credentials (Client ID, Client Secret, Token URL, and Scope). Error: ${errorText}`,
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
      const cacheKey = `${config.tokenUrl.toString()}:${config.clientId}`;
      const expiresAt: number =
        Date.now() + (tokenData.expires_in - this.TOKEN_BUFFER_SECONDS) * 1000;

      const cachedToken: CachedToken = {
        accessToken: tokenData.access_token,
        expiresAt,
      };

      LocalCache.setJSON(this.TOKEN_CACHE_NAMESPACE, cacheKey, cachedToken);

      logger.debug("Successfully obtained and cached OAuth token");

      return tokenData.access_token;
    } catch (error) {
      if (error instanceof BadDataException) {
        throw error;
      }

      logger.error("Error fetching OAuth token:");
      logger.error(error);

      throw new BadDataException(
        `Failed to authenticate with OAuth provider: ${error instanceof Error ? error.message : "Unknown error"}. Please check your OAuth credentials and network connectivity.`,
      );
    }
  }

  /**
   * Create the XOAUTH2 token string for SMTP authentication.
   * Format: base64("user=" + userName + "^Aauth=Bearer " + accessToken + "^A^A")
   *
   * This format is used by most OAuth-enabled SMTP servers including Microsoft 365 and Google.
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

  /**
   * Helper to build Microsoft 365 token URL from tenant ID.
   * @param tenantId - The Azure AD tenant ID
   * @returns The full token URL
   */
  public static buildMicrosoft365TokenUrl(tenantId: string): URL {
    return URL.fromString(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    );
  }

  /**
   * Default scope for Microsoft 365 SMTP.
   */
  public static readonly MICROSOFT_365_SMTP_SCOPE =
    "https://outlook.office365.com/.default";

  /**
   * Default scope for Google Workspace SMTP.
   */
  public static readonly GOOGLE_SMTP_SCOPE = "https://mail.google.com/";
}
