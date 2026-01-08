import BadDataException from "Common/Types/Exception/BadDataException";
import logger from "Common/Server/Utils/Logger";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import { JSONObject } from "Common/Types/JSON";

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface CachedToken extends JSONObject {
  accessToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
}

/**
 * Service for fetching OAuth2 access tokens for Microsoft 365 SMTP authentication.
 * Uses the client credentials grant flow as described in:
 * https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth
 */
export default class Microsoft365OAuthService {
  private static readonly TOKEN_CACHE_NAMESPACE = "microsoft365-oauth-tokens";
  private static readonly TOKEN_BUFFER_SECONDS = 300; // Refresh token 5 minutes before expiry

  /**
   * Get an access token for Microsoft 365 SMTP authentication.
   * Uses client credentials grant flow.
   *
   * @param clientId - Microsoft Entra (Azure AD) Application Client ID
   * @param clientSecret - Microsoft Entra (Azure AD) Application Client Secret
   * @param tenantId - Microsoft Entra (Azure AD) Tenant ID
   * @returns The access token
   */
  public static async getAccessToken(data: {
    clientId: string;
    clientSecret: string;
    tenantId: string;
  }): Promise<string> {
    const cacheKey = `${data.tenantId}:${data.clientId}`;

    // Check if we have a cached token that's still valid
    if (LocalCache.hasValue(this.TOKEN_CACHE_NAMESPACE, cacheKey)) {
      const cachedToken: CachedToken = LocalCache.getJSON(
        this.TOKEN_CACHE_NAMESPACE,
        cacheKey,
      ) as CachedToken;

      const now: number = Date.now();
      if (cachedToken.expiresAt > now) {
        logger.debug("Using cached OAuth token for Microsoft 365");
        return cachedToken.accessToken;
      }
    }

    // Fetch a new token
    const token: string = await this.fetchNewToken(data);
    return token;
  }

  private static async fetchNewToken(data: {
    clientId: string;
    clientSecret: string;
    tenantId: string;
  }): Promise<string> {
    const tokenUrl = `https://login.microsoftonline.com/${data.tenantId}/oauth2/v2.0/token`;

    // For SMTP, we use the Office 365 Exchange Online scope
    const scope = "https://outlook.office365.com/.default";

    const params = new URLSearchParams();
    params.append("client_id", data.clientId);
    params.append("client_secret", data.clientSecret);
    params.append("scope", scope);
    params.append("grant_type", "client_credentials");

    try {
      logger.debug("Fetching new OAuth token from Microsoft 365");

      const response: Response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText: string = await response.text();
        logger.error(
          `Failed to fetch OAuth token from Microsoft: ${response.status} - ${errorText}`,
        );
        throw new BadDataException(
          `Failed to authenticate with Microsoft 365: ${response.status}. Please check your OAuth credentials (Client ID, Client Secret, and Tenant ID). Make sure the application has the SMTP.SendAsApp permission and admin consent has been granted.`,
        );
      }

      const tokenData: OAuthTokenResponse =
        (await response.json()) as OAuthTokenResponse;

      if (!tokenData.access_token) {
        throw new BadDataException(
          "Microsoft OAuth response did not contain an access token",
        );
      }

      // Cache the token
      const cacheKey = `${data.tenantId}:${data.clientId}`;
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

      logger.error("Error fetching OAuth token from Microsoft:");
      logger.error(error);

      throw new BadDataException(
        `Failed to authenticate with Microsoft 365: ${error instanceof Error ? error.message : "Unknown error"}. Please check your OAuth credentials and network connectivity.`,
      );
    }
  }

  /**
   * Create the XOAUTH2 token string for SMTP authentication.
   * Format: base64("user=" + userName + "^Aauth=Bearer " + accessToken + "^A^A")
   *
   * @param username - The email address (user principal name) to authenticate as
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
