import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import { MICROSOFT_TEAMS_OAUTH_MEETING_PERMISSION } from "../../../../Types/VideoCall/VideoCallProviderCatalog";
import MicrosoftTeamsMeetingClient, {
  MICROSOFT_LOGIN_HOST,
} from "../Providers/MicrosoftTeamsMeetingClient";
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
 * The one-click Connect of Microsoft Teams: this server's multi-tenant
 * Microsoft Entra app, signed in to by the work or school account that
 * organizes the meetings, with the delegated OnlineMeetings.ReadWrite
 * permission. https://learn.microsoft.com/graph/api/application-post-onlinemeetings
 *
 * A delegated permission needs no application access policy: the meeting
 * is the signed-in account's own (/me/onlineMeetings). Personal Microsoft
 * accounts cannot create Teams meetings through Graph, so only work and
 * school accounts can sign in (the "organizations" authority).
 *
 * Every refresh answers with a new refresh token, which is stored. One left
 * unused for 90 days expires, which the daily keep-alive never lets happen;
 * a tenant's sign-in frequency policy can still ask the account to sign in
 * again, and connecting again is the answer then.
 */

export const MICROSOFT_ORGANIZATIONS_AUTHORITY: string = `${MICROSOFT_LOGIN_HOST}/organizations`;

// The tenant every personal Microsoft account signs in to.
export const MICROSOFT_CONSUMER_TENANT_ID: string =
  "9188040d-6c67-4c5b-b112-36a304b66dad";

export const MICROSOFT_TEAMS_MEETINGS_SCOPE: string = `https://graph.microsoft.com/${MICROSOFT_TEAMS_OAUTH_MEETING_PERMISSION}`;

// Asked for when signing in; a refresh asks for what it needs to keep.
export const MICROSOFT_TEAMS_MEETINGS_SIGN_IN_SCOPES: Array<string> = [
  "openid",
  "profile",
  "email",
  "offline_access",
  MICROSOFT_TEAMS_MEETINGS_SCOPE,
];

export const MICROSOFT_TEAMS_MEETINGS_REFRESH_SCOPES: Array<string> = [
  "offline_access",
  MICROSOFT_TEAMS_MEETINGS_SCOPE,
];

export default class MicrosoftTeamsMeetingsOAuthApp
  implements VideoCallOAuthApp
{
  public readonly provider: VideoCallProvider =
    VideoCallProvider.MicrosoftTeams;

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
      response_type: "code",
      redirect_uri: data.redirectUri,
      response_mode: "query",
      scope: MICROSOFT_TEAMS_MEETINGS_SIGN_IN_SCOPES.join(" "),
      prompt: "select_account",
      state: data.state,
    });

    return `${MICROSOFT_ORGANIZATIONS_AUTHORITY}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  public async exchangeCode(data: {
    code: string;
    redirectUri: string;
  }): Promise<VideoCallOAuthGrant> {
    const response: VideoCallHttpResponse = await this.http.request({
      url: `${MICROSOFT_ORGANIZATIONS_AUTHORITY}/oauth2/v2.0/token`,
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
        scope: MICROSOFT_TEAMS_MEETINGS_SIGN_IN_SCOPES.join(" "),
      }).toString(),
      stepLabel: "Microsoft sign-in code exchange",
    });

    if (!response.ok) {
      throw VideoCallOAuthUtil.getExchangeError({
        response,
        providerTitle: "Microsoft",
      });
    }

    const tokens: VideoCallOAuthTokens = VideoCallOAuthUtil.readTokenResponse({
      response,
      providerTitle: "Microsoft",
    });

    const claims: JSONObject = VideoCallOAuthUtil.readIdTokenClaims({
      idToken: response.json?.["id_token"],
      clientId: this.credentials.clientId,
      providerTitle: "Microsoft",
    });

    const tenantId: JSONValue | undefined = claims["tid"];
    const objectId: JSONValue | undefined = claims["oid"];

    if (
      typeof tenantId !== "string" ||
      !MicrosoftTeamsMeetingClient.isGuid(tenantId) ||
      typeof objectId !== "string" ||
      !objectId
    ) {
      throw new APIException(
        "Microsoft did not say which work or school account signed in.",
      );
    }

    if (tenantId.toLowerCase() === MICROSOFT_CONSUMER_TENANT_ID) {
      throw new VideoCallOAuthGrantRefusal(
        VideoCallOAuthGrantProblem.WorkAccountRequired,
        "A personal Microsoft account signed in.",
      );
    }

    if (
      !VideoCallOAuthUtil.hasScope(tokens.scope, (scope: string): boolean => {
        const lower: string = scope.toLowerCase();
        const permission: string =
          MICROSOFT_TEAMS_OAUTH_MEETING_PERMISSION.toLowerCase();

        return lower === permission || lower.endsWith(`/${permission}`);
      })
    ) {
      throw new VideoCallOAuthGrantRefusal(
        VideoCallOAuthGrantProblem.PermissionNotGranted,
        `Microsoft granted "${tokens.scope || ""}", without ${MICROSOFT_TEAMS_OAUTH_MEETING_PERMISSION}.`,
      );
    }

    const label: JSONValue | undefined =
      claims["preferred_username"] || claims["email"] || claims["upn"];

    return {
      tokens,
      account: {
        label: typeof label === "string" && label ? label : objectId,
        externalUserId: objectId,
        externalAccountId: tenantId.toLowerCase(),
      },
    };
  }

  public async refresh(data: {
    secrets: VideoCallOAuthSecrets;
    accountLabel: string;
  }): Promise<VideoCallOAuthTokens> {
    // The account's own tenant; "organizations" for a sign-in stored without one.
    const authority: string =
      data.secrets.externalAccountId &&
      MicrosoftTeamsMeetingClient.isGuid(data.secrets.externalAccountId)
        ? `${MICROSOFT_LOGIN_HOST}/${data.secrets.externalAccountId}`
        : MICROSOFT_ORGANIZATIONS_AUTHORITY;

    const response: VideoCallHttpResponse = await this.http.request({
      url: `${authority}/oauth2/v2.0/token`,
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
        scope: MICROSOFT_TEAMS_MEETINGS_REFRESH_SCOPES.join(" "),
      }).toString(),
      stepLabel: "Microsoft token refresh",
    });

    if (!response.ok) {
      throw VideoCallOAuthUtil.getRefreshError({
        response,
        provider: VideoCallProvider.MicrosoftTeams,
        accountLabel: data.accountLabel,
      });
    }

    return VideoCallOAuthUtil.readTokenResponse({
      response,
      providerTitle: "Microsoft",
      previousRefreshToken: data.secrets.refreshToken,
    });
  }

  /*
   * Microsoft has no endpoint that withdraws one app's refresh token. The
   * grant stays until the account removes OneUptime under My Apps, or the
   * token goes unused for 90 days.
   */
  public async revoke(_secrets: VideoCallOAuthSecrets): Promise<void> {
    return;
  }
}
