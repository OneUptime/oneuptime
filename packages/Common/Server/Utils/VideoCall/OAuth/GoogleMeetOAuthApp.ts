import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import { GOOGLE_MEET_SCOPE } from "../../../../Types/VideoCall/VideoCallProviderCatalog";
import { GOOGLE_DEFAULT_TOKEN_URI } from "../Providers/GoogleMeetClient";
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
 * The one-click Connect of Google Meet: this server's Google OAuth client,
 * authorized by the Google account that owns the meetings.
 * https://developers.google.com/identity/protocols/oauth2/web-server
 *
 * Offline access, so Google issues a refresh token; and the consent screen
 * every time, so it issues one even to an account that connected before.
 * The account is picked on Google's own screen (select_account): a browser
 * signed in to a person's account can still connect the shared one.
 *
 * Google's consent screen lets the person untick a permission. A sign-in
 * that came back without the Meet scope is refused rather than saved, since
 * every call would fail. A refresh token is good until the person removes
 * the app or it goes unused for six months, which the daily keep-alive
 * never lets happen.
 */

export const GOOGLE_AUTHORIZE_URL: string =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL: string = GOOGLE_DEFAULT_TOKEN_URI;
export const GOOGLE_REVOKE_URL: string = "https://oauth2.googleapis.com/revoke";

export const GOOGLE_MEET_OAUTH_SCOPES: Array<string> = [
  "openid",
  "email",
  GOOGLE_MEET_SCOPE,
];

export default class GoogleMeetOAuthApp implements VideoCallOAuthApp {
  public readonly provider: VideoCallProvider = VideoCallProvider.GoogleMeet;

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
      client_id: this.credentials.clientId,
      redirect_uri: data.redirectUri,
      response_type: "code",
      scope: GOOGLE_MEET_OAUTH_SCOPES.join(" "),
      access_type: "offline",
      prompt: "select_account consent",
      include_granted_scopes: "false",
      state: data.state,
    });

    return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
  }

  public async exchangeCode(data: {
    code: string;
    redirectUri: string;
  }): Promise<VideoCallOAuthGrant> {
    const response: VideoCallHttpResponse = await this.http.request({
      url: GOOGLE_TOKEN_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: data.code,
        redirect_uri: data.redirectUri,
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
      }).toString(),
      stepLabel: "Google sign-in code exchange",
    });

    if (!response.ok) {
      throw VideoCallOAuthUtil.getExchangeError({
        response,
        providerTitle: "Google",
      });
    }

    const tokens: VideoCallOAuthTokens = VideoCallOAuthUtil.readTokenResponse({
      response,
      providerTitle: "Google",
    });

    if (
      !VideoCallOAuthUtil.hasScope(tokens.scope, (scope: string): boolean => {
        return scope === GOOGLE_MEET_SCOPE;
      })
    ) {
      throw new VideoCallOAuthGrantRefusal(
        VideoCallOAuthGrantProblem.PermissionNotGranted,
        `Google granted "${tokens.scope || ""}", without ${GOOGLE_MEET_SCOPE}.`,
      );
    }

    const claims: JSONObject = VideoCallOAuthUtil.readIdTokenClaims({
      idToken: response.json?.["id_token"],
      clientId: this.credentials.clientId,
      providerTitle: "Google",
    });

    const subject: JSONValue | undefined = claims["sub"];
    const email: JSONValue | undefined = claims["email"];
    const hostedDomain: JSONValue | undefined = claims["hd"];

    if (typeof subject !== "string" || !subject) {
      throw new APIException("Google did not say who signed in.");
    }

    return {
      tokens,
      account: {
        label: typeof email === "string" && email ? email : subject,
        externalUserId: subject,
        externalAccountId:
          typeof hostedDomain === "string" && hostedDomain
            ? hostedDomain
            : undefined,
      },
    };
  }

  public async refresh(data: {
    secrets: VideoCallOAuthSecrets;
    accountLabel: string;
  }): Promise<VideoCallOAuthTokens> {
    const response: VideoCallHttpResponse = await this.http.request({
      url: GOOGLE_TOKEN_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: data.secrets.refreshToken,
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
      }).toString(),
      stepLabel: "Google token refresh",
    });

    if (!response.ok) {
      throw VideoCallOAuthUtil.getRefreshError({
        response,
        provider: VideoCallProvider.GoogleMeet,
        accountLabel: data.accountLabel,
      });
    }

    // Google answers a refresh without a new refresh token: the first stays good.
    return VideoCallOAuthUtil.readTokenResponse({
      response,
      providerTitle: "Google",
      previousRefreshToken: data.secrets.refreshToken,
    });
  }

  // Revoking the refresh token withdraws the whole grant.
  public async revoke(secrets: VideoCallOAuthSecrets): Promise<void> {
    await this.http.request({
      url: GOOGLE_REVOKE_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ token: secrets.refreshToken }).toString(),
      stepLabel: "Google token revocation",
    });
  }
}
