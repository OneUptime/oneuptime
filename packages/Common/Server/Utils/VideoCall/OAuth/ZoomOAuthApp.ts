import APIException from "../../../../Types/Exception/ApiException";
import { JSONValue } from "../../../../Types/JSON";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import { ZOOM_OAUTH_MEETING_SCOPE } from "../../../../Types/VideoCall/VideoCallProviderCatalog";
import ZoomMeetingClient, {
  ZOOM_TOKEN_URL,
} from "../Providers/ZoomMeetingClient";
import VideoCallHttpClient, {
  VideoCallHttpResponse,
} from "../VideoCallHttpClient";
import VideoCallOAuthUtil, {
  VideoCallOAuthApp,
  VideoCallOAuthAppCredentials,
  VideoCallOAuthGrant,
  VideoCallOAuthGrantProblem,
  VideoCallOAuthGrantRefusal,
  VideoCallOAuthSecrets,
  VideoCallOAuthTokens,
} from "./VideoCallOAuth";

/*
 * The one-click Connect of Zoom: this server's Zoom General app (user
 * managed), authorized by the Zoom user who hosts the meetings.
 * https://developers.zoom.us/docs/integrations/oauth/
 *
 * The app's scopes are set on the app in the Zoom App Marketplace rather
 * than asked for here: meeting:write:meeting to create the user's meetings,
 * user:read:user to learn who signed in. Every refresh answers with a new
 * refresh token and the old one stops working, so the token store saves
 * each one before anything else (VideoCallOAuthTokenStore). A refresh token
 * not used for 90 days expires, which the daily keep-alive never lets
 * happen.
 *
 * Someone who removes the app from their Zoom account is reported by Zoom's
 * app_deauthorized event (ZoomOAuthEvents).
 */

export const ZOOM_AUTHORIZE_URL: string = "https://zoom.us/oauth/authorize";
export const ZOOM_REVOKE_URL: string = "https://zoom.us/oauth/revoke";

export default class ZoomOAuthApp implements VideoCallOAuthApp {
  public readonly provider: VideoCallProvider = VideoCallProvider.Zoom;

  private credentials: VideoCallOAuthAppCredentials;
  private http: VideoCallHttpClient;

  public constructor(
    credentials: VideoCallOAuthAppCredentials,
    http?: VideoCallHttpClient | undefined,
  ) {
    this.credentials = credentials;
    this.http = http || new VideoCallHttpClient();
  }

  public getAuthorizationUrl(data: {
    state: string;
    redirectUri: string;
  }): string {
    const params: URLSearchParams = new URLSearchParams({
      response_type: "code",
      client_id: this.credentials.clientId,
      redirect_uri: data.redirectUri,
      state: data.state,
    });

    return `${ZOOM_AUTHORIZE_URL}?${params.toString()}`;
  }

  public async exchangeCode(data: {
    code: string;
    redirectUri: string;
  }): Promise<VideoCallOAuthGrant> {
    const response: VideoCallHttpResponse = await this.http.request({
      url: ZOOM_TOKEN_URL,
      method: "POST",
      headers: this.getTokenHeaders(),
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: data.code,
        redirect_uri: data.redirectUri,
      }).toString(),
      stepLabel: "Zoom sign-in code exchange",
    });

    if (!response.ok) {
      throw VideoCallOAuthUtil.getExchangeError({
        response,
        providerTitle: "Zoom",
      });
    }

    const tokens: VideoCallOAuthTokens = this.readTokens(response);

    /*
     * An app whose Scopes page lost the meeting scope would connect and then
     * fail the first incident's call.
     */
    if (
      tokens.scope &&
      !VideoCallOAuthUtil.hasScope(tokens.scope, (scope: string): boolean => {
        return scope.startsWith("meeting:write");
      })
    ) {
      throw new VideoCallOAuthGrantRefusal(
        VideoCallOAuthGrantProblem.PermissionNotGranted,
        `Zoom granted "${tokens.scope}", without ${ZOOM_OAUTH_MEETING_SCOPE}.`,
      );
    }

    const userResponse: VideoCallHttpResponse = await this.http.request({
      url: `${tokens.apiBaseUrl}/users/me`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        Accept: "application/json",
      },
      stepLabel: "Zoom user request",
    });

    if (!userResponse.ok) {
      throw new APIException(
        `Zoom did not say who signed in (HTTP ${userResponse.status}): ${VideoCallHttpClient.summarizeErrorBody(userResponse)}`,
      );
    }

    const userId: JSONValue | undefined = userResponse.json?.["id"];
    const email: JSONValue | undefined = userResponse.json?.["email"];
    const accountId: JSONValue | undefined = userResponse.json?.["account_id"];

    if (typeof userId !== "string" || !userId) {
      throw new APIException("Zoom did not say who signed in.");
    }

    return {
      tokens,
      account: {
        label: typeof email === "string" && email ? email : userId,
        externalUserId: userId,
        externalAccountId:
          typeof accountId === "string" && accountId ? accountId : undefined,
      },
    };
  }

  public async refresh(data: {
    secrets: VideoCallOAuthSecrets;
    accountLabel: string;
  }): Promise<VideoCallOAuthTokens> {
    const response: VideoCallHttpResponse = await this.http.request({
      url: ZOOM_TOKEN_URL,
      method: "POST",
      headers: this.getTokenHeaders(),
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: data.secrets.refreshToken,
      }).toString(),
      stepLabel: "Zoom token refresh",
    });

    if (!response.ok) {
      throw VideoCallOAuthUtil.getRefreshError({
        response,
        provider: VideoCallProvider.Zoom,
        accountLabel: data.accountLabel,
      });
    }

    return this.readTokens(response);
  }

  public async revoke(secrets: VideoCallOAuthSecrets): Promise<void> {
    const token: string = secrets.accessToken || secrets.refreshToken;

    await this.http.request({
      url: ZOOM_REVOKE_URL,
      method: "POST",
      headers: this.getTokenHeaders(),
      body: new URLSearchParams({ token }).toString(),
      stepLabel: "Zoom token revocation",
    });
  }

  private readTokens(response: VideoCallHttpResponse): VideoCallOAuthTokens {
    const tokens: VideoCallOAuthTokens = VideoCallOAuthUtil.readTokenResponse({
      response,
      providerTitle: "Zoom",
    });

    return {
      ...tokens,
      // Only a Zoom host is ever used: an access token goes nowhere else.
      apiBaseUrl: ZoomMeetingClient.getApiBaseUrl(response.json?.["api_url"]),
    };
  }

  private getTokenHeaders(): Record<string, string> {
    const basic: string = Buffer.from(
      `${this.credentials.clientId}:${this.credentials.clientSecret}`,
      "utf8",
    ).toString("base64");

    return {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };
  }
}
