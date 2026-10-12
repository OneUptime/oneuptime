import APIException from "../../../../Types/Exception/ApiException";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import VideoCallProvider, {
  getVideoCallProviderDisplayName,
} from "../../../../Types/VideoCall/VideoCallProvider";
import VideoCallHttpClient, {
  VideoCallHttpResponse,
} from "../VideoCallHttpClient";

/*
 * THE ONE-CLICK CONNECT OF A VIDEO CALL PROVIDER.
 *
 * Someone signs in to Zoom, Google or Microsoft and allows this server's own
 * app to create meetings as that account (VideoCallAuthMethod.OAuth). The
 * provider answers with a refresh token, which OneUptime keeps encrypted in
 * the connection's secrets and exchanges for a short-lived access token
 * whenever a call starts (VideoCallOAuthTokenStore).
 *
 * Each provider's app (ZoomOAuthApp, GoogleMeetOAuthApp,
 * MicrosoftTeamsMeetingsOAuthApp) knows its own three requests: the sign-in
 * URL, the code exchange (which also says who signed in) and the refresh.
 * Everything they return is a credential: never log it or send it to a
 * browser.
 */

export interface VideoCallOAuthTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  /*
   * The refresh token to use next. Zoom and Microsoft answer every refresh
   * with a new one, and Zoom's are good for one use only, so the newest
   * must be stored before anything else happens. Google keeps the first.
   */
  refreshToken: string;
  // The scopes granted, as the provider listed them.
  scope?: string | undefined;
  // Zoom: the API host the account's calls go to, checked to be Zoom's.
  apiBaseUrl?: string | undefined;
}

// Who signed in, as the provider says.
export interface VideoCallOAuthAccount {
  // Shown on the connection: an email address or a sign-in name.
  label: string;
  // The provider's id of the person: a Zoom user id, a Google subject, a Microsoft object id.
  externalUserId: string;
  /*
   * The provider's id of their organization, where it has one: a Zoom
   * account id, a Microsoft Entra tenant id.
   */
  externalAccountId?: string | undefined;
}

export interface VideoCallOAuthGrant {
  tokens: VideoCallOAuthTokens;
  account: VideoCallOAuthAccount;
}

/*
 * What an OAuth connection keeps in its encrypted `secrets`. Written only
 * by the server: a connection made by signing in has no credential a person
 * types.
 */
export interface VideoCallOAuthSecrets {
  refreshToken: string;
  accessToken?: string | undefined;
  // ISO 8601.
  accessTokenExpiresAt?: string | undefined;
  // When the tokens were last issued or refreshed, ISO 8601.
  tokensRefreshedAt?: string | undefined;
  scope?: string | undefined;
  apiBaseUrl?: string | undefined;
  externalUserId?: string | undefined;
  externalAccountId?: string | undefined;
}

// The access token a meeting request is sent with.
export interface VideoCallOAuthAccessToken {
  accessToken: string;
  // Zoom: the API host of the signed-in account.
  apiBaseUrl?: string | undefined;
}

/*
 * How a meeting client reaches a connection's sign-in: a current access
 * token, refreshed when it has run out, and the account it is for, which
 * the messages a person reads name.
 */
export interface VideoCallOAuthAccess {
  getAccessToken: () => Promise<VideoCallOAuthAccessToken>;
  accountLabel: string;
}

/*
 * Why a sign-in that came back cannot become a connection, for the page the
 * connection started from (ConnectCallbackError).
 */
export enum VideoCallOAuthGrantProblem {
  // The person unticked the meeting permission on the consent screen.
  PermissionNotGranted = "PermissionNotGranted",
  // Microsoft Teams meetings need a work or school account.
  WorkAccountRequired = "WorkAccountRequired",
}

export class VideoCallOAuthGrantRefusal extends Error {
  public readonly problem: VideoCallOAuthGrantProblem;

  public constructor(problem: VideoCallOAuthGrantProblem, reason: string) {
    super(reason);
    this.name = "VideoCallOAuthGrantRefusal";
    this.problem = problem;
  }
}

// One provider's app, as the connect routes and the token store use it.
export interface VideoCallOAuthApp {
  provider: VideoCallProvider;
  getAuthorizationUrl: (data: { state: string; redirectUri: string }) => string;
  // Exchanges the code a sign-in came back with, and reads who signed in.
  exchangeCode: (data: {
    code: string;
    redirectUri: string;
  }) => Promise<VideoCallOAuthGrant>;
  // Refreshes the access token. accountLabel names the account in a refusal.
  refresh: (data: {
    secrets: VideoCallOAuthSecrets;
    accountLabel: string;
  }) => Promise<VideoCallOAuthTokens>;
  /*
   * Withdraws the sign-in at the provider, when the connection is deleted.
   * Best effort: a provider without a way to, or one that refuses, leaves
   * the grant for the person to remove.
   */
  revoke: (secrets: VideoCallOAuthSecrets) => Promise<void>;
}

export interface VideoCallOAuthAppCredentials {
  clientId: string;
  clientSecret: string;
}

// Used when a token response does not say how long its access token lasts.
const DEFAULT_ACCESS_TOKEN_LIFETIME_IN_SECONDS: number = 3600;

/*
 * Never trust a lifetime longer than a day: it only decides when OneUptime
 * refreshes, and refreshing early costs nothing.
 */
const MAX_ACCESS_TOKEN_LIFETIME_IN_SECONDS: number = 24 * 3600;

export default class VideoCallOAuthUtil {
  /*
   * The tokens of a token response. `previousRefreshToken` stands in when
   * a refresh answers without a new one (Google), and is required on a
   * code exchange, which must always issue one.
   */
  public static readTokenResponse(data: {
    response: VideoCallHttpResponse;
    providerTitle: string;
    previousRefreshToken?: string | undefined;
    now?: Date | undefined;
  }): VideoCallOAuthTokens {
    const json: JSONObject = data.response.json || {};
    const accessToken: JSONValue | undefined = json["access_token"];

    if (typeof accessToken !== "string" || !accessToken) {
      throw new APIException(`${data.providerTitle} returned no access token.`);
    }

    const refreshTokenValue: JSONValue | undefined = json["refresh_token"];
    const refreshToken: string =
      typeof refreshTokenValue === "string" && refreshTokenValue
        ? refreshTokenValue
        : data.previousRefreshToken || "";

    if (!refreshToken) {
      throw new APIException(
        `${data.providerTitle} returned no refresh token, so OneUptime could not stay signed in. Connect again.`,
      );
    }

    const expiresIn: JSONValue | undefined = json["expires_in"];
    const lifetimeInSeconds: number =
      typeof expiresIn === "number" &&
      Number.isFinite(expiresIn) &&
      expiresIn > 0
        ? Math.min(expiresIn, MAX_ACCESS_TOKEN_LIFETIME_IN_SECONDS)
        : typeof expiresIn === "string" && Number(expiresIn) > 0
          ? Math.min(Number(expiresIn), MAX_ACCESS_TOKEN_LIFETIME_IN_SECONDS)
          : DEFAULT_ACCESS_TOKEN_LIFETIME_IN_SECONDS;

    const now: Date = data.now || new Date();
    const scope: JSONValue | undefined = json["scope"];

    return {
      accessToken: accessToken,
      accessTokenExpiresAt: new Date(now.getTime() + lifetimeInSeconds * 1000),
      refreshToken: refreshToken,
      scope: typeof scope === "string" ? scope : undefined,
    };
  }

  /*
   * The claims of an OpenID Connect ID token from a token response. Its
   * signature is not checked, and need not be: it came straight from the
   * provider over TLS, in exchange for a code and this app's client secret
   * (OpenID Connect Core 3.1.3.7). Its audience must still be this app.
   */
  public static readIdTokenClaims(data: {
    idToken: JSONValue | undefined;
    clientId: string;
    providerTitle: string;
  }): JSONObject {
    const payload: string | undefined =
      typeof data.idToken === "string" ? data.idToken.split(".")[1] : undefined;

    let claims: unknown = null;

    if (payload) {
      try {
        claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      } catch {
        claims = null;
      }
    }

    if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
      throw new APIException(
        `${data.providerTitle} did not say who signed in: its ID token could not be read.`,
      );
    }

    const audience: JSONValue | undefined = (claims as JSONObject)["aud"];
    const audiences: Array<JSONValue> = Array.isArray(audience)
      ? audience
      : [audience as JSONValue];

    if (!audiences.includes(data.clientId)) {
      throw new APIException(
        `${data.providerTitle} returned an ID token issued to another app.`,
      );
    }

    return claims as JSONObject;
  }

  // Whether a space-separated scope list holds a scope matching `matches`.
  public static hasScope(
    scope: string | undefined,
    matches: (grantedScope: string) => boolean,
  ): boolean {
    return (scope || "")
      .split(/[\s,]+/)
      .filter((grantedScope: string): boolean => {
        return grantedScope.length > 0;
      })
      .some(matches);
  }

  public static toSecrets(data: {
    tokens: VideoCallOAuthTokens;
    account?: VideoCallOAuthAccount | undefined;
    previous?: VideoCallOAuthSecrets | undefined;
    now?: Date | undefined;
  }): VideoCallOAuthSecrets {
    const now: Date = data.now || new Date();
    const secrets: VideoCallOAuthSecrets = {
      refreshToken: data.tokens.refreshToken,
      accessToken: data.tokens.accessToken,
      accessTokenExpiresAt: data.tokens.accessTokenExpiresAt.toISOString(),
      tokensRefreshedAt: now.toISOString(),
      scope: data.tokens.scope || data.previous?.scope,
      apiBaseUrl: data.tokens.apiBaseUrl || data.previous?.apiBaseUrl,
      externalUserId:
        data.account?.externalUserId || data.previous?.externalUserId,
      externalAccountId:
        data.account?.externalAccountId || data.previous?.externalAccountId,
    };

    // Stored without the keys a provider has no value for.
    for (const key of Object.keys(secrets) as Array<
      keyof VideoCallOAuthSecrets
    >) {
      if (secrets[key] === undefined) {
        delete secrets[key];
      }
    }

    return secrets;
  }

  /*
   * An OAuth connection's secrets as stored, or null when they hold no
   * refresh token - a sign-in that was removed, or never finished.
   */
  public static readSecrets(
    values: JSONObject | null | undefined,
  ): VideoCallOAuthSecrets | null {
    if (!values) {
      return null;
    }

    const read: (key: string) => string | undefined = (
      key: string,
    ): string | undefined => {
      const value: JSONValue | undefined = values[key];
      return typeof value === "string" && value ? value : undefined;
    };

    const refreshToken: string | undefined = read("refreshToken");

    if (!refreshToken) {
      return null;
    }

    return {
      refreshToken,
      accessToken: read("accessToken"),
      accessTokenExpiresAt: read("accessTokenExpiresAt"),
      tokensRefreshedAt: read("tokensRefreshedAt"),
      scope: read("scope"),
      apiBaseUrl: read("apiBaseUrl"),
      externalUserId: read("externalUserId"),
      externalAccountId: read("externalAccountId"),
    };
  }

  // Whether the stored access token lasts at least `marginInMs` more.
  public static hasFreshAccessToken(
    secrets: VideoCallOAuthSecrets,
    marginInMs: number,
    now?: Date | undefined,
  ): boolean {
    if (!secrets.accessToken || !secrets.accessTokenExpiresAt) {
      return false;
    }

    const expiresAt: number = Date.parse(secrets.accessTokenExpiresAt);

    return (
      Number.isFinite(expiresAt) &&
      expiresAt - (now || new Date()).getTime() > marginInMs
    );
  }

  /*
   * What a refused refresh means. invalid_grant (and Microsoft's
   * interaction_required) is the sign-in itself being gone - removed from
   * the account, revoked, expired, or a password or policy change - which
   * only connecting again fixes. invalid_client is this server's app being
   * refused, which only its administrator can fix.
   */
  public static getRefreshError(data: {
    response: VideoCallHttpResponse;
    provider: VideoCallProvider;
    accountLabel: string;
  }): Error {
    const title: string = getVideoCallProviderDisplayName(data.provider);
    const errorCode: string = VideoCallHttpClient.readErrorCode(
      data.response.json,
    ).toLowerCase();
    const summary: string = VideoCallHttpClient.summarizeErrorBody(
      data.response,
    );
    const account: string = data.accountLabel || "the account";

    if (
      errorCode === "invalid_grant" ||
      errorCode === "interaction_required" ||
      errorCode === "consent_required"
    ) {
      return new BadDataException(
        `${title} no longer accepts OneUptime's sign-in for ${account}: it was removed from the account, revoked or has expired. Reconnect ${title} in Project Settings > Video Calls. (${summary})`,
      );
    }

    if (errorCode === "invalid_client" || errorCode === "unauthorized_client") {
      return new BadDataException(
        `${title} refused this OneUptime server's ${title} app. Ask your server administrator to check its client ID and client secret. (${summary})`,
      );
    }

    if (data.response.status >= 400 && data.response.status < 500) {
      return new BadDataException(
        `${title} could not refresh OneUptime's sign-in for ${account} (HTTP ${data.response.status}): ${summary}`,
      );
    }

    return new APIException(
      `${title} could not refresh OneUptime's sign-in for ${account} (HTTP ${data.response.status}): ${summary}`,
    );
  }

  // What a refused code exchange means, for the log.
  public static getExchangeError(data: {
    response: VideoCallHttpResponse;
    providerTitle: string;
  }): Error {
    return new APIException(
      `${data.providerTitle} refused the sign-in code (HTTP ${data.response.status}): ${VideoCallHttpClient.summarizeErrorBody(data.response)}`,
    );
  }
}
