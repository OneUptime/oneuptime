import BadDataException from "../../../../Types/Exception/BadDataException";
import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import VideoCallMeeting from "../../../../Types/VideoCall/VideoCallMeeting";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import {
  ZOOM_CLASSIC_MEETING_SCOPE,
  ZOOM_MEETING_SCOPE,
  ZOOM_OAUTH_MEETING_SCOPE,
} from "../../../../Types/VideoCall/VideoCallProviderCatalog";
import VideoCallHttpClient, {
  VideoCallHttpResponse,
} from "../VideoCallHttpClient";
import { VideoCallMeetingRequest } from "../VideoCallMeetingRequest";

/*
 * Creates incident meetings through a Zoom Server-to-Server OAuth app.
 *
 * Auth is Zoom's account_credentials grant: the app's client id and secret,
 * Basic-encoded, for an hour-long account token. There is no refresh token
 * and no person behind it, so it keeps working however long the project
 * goes without an incident.
 * https://developers.zoom.us/docs/internal-apps/s2s-oauth/
 *
 * Every meeting is a scheduled meeting (type 2) starting now, not an
 * instant one (type 1): an instant meeting's link dies when the meeting
 * ends, and an incident bridge is left and re-joined for hours. A scheduled
 * meeting's link stays valid for 30 days after it was last used.
 * The host is a service account that never joins, so people join before
 * the host and no waiting room holds them for a host who is not coming.
 * https://developers.zoom.us/docs/api/meetings/#tag/meetings/POST/users/{userId}/meetings
 *
 * A connection made by signing in (VideoCallAuthMethod.OAuth) creates the
 * same meeting with the signed-in user's own token, as "me"
 * (createMeetingWithToken). Only the token and the advice in an error
 * differ.
 */

export interface ZoomMeetingClientSettings {
  accountId: string;
  clientId: string;
  clientSecret: string;
  hostEmail: string;
}

// Who a meeting is created for, and how an error names them.
export interface ZoomMeetingHost {
  // The user in the request path: an email or a user id, or "me" for the signed-in user.
  userId: string;
  label: string;
  /*
   * Whether the token is a person's sign-in to this server's Zoom app
   * rather than the project's own Server-to-Server OAuth app: what fixes a
   * refusal differs.
   */
  isSignIn: boolean;
}

export interface ZoomAccessToken {
  accessToken: string;
  apiBaseUrl: string;
}

export const ZOOM_TOKEN_URL: string = "https://zoom.us/oauth/token";
export const ZOOM_API_BASE_URL: string = "https://api.zoom.us/v2";

// Zoom's own limits for a meeting's topic and agenda.
const ZOOM_TOPIC_MAX_LENGTH: number = 200;
const ZOOM_AGENDA_MAX_LENGTH: number = 2000;

/*
 * Zoom's error codes for the failures a person configuring the connection
 * can fix, and the words that tell them how.
 * https://developers.zoom.us/docs/api/rest/other-references/error-definitions/
 */
const ZOOM_USER_DOES_NOT_EXIST_CODE: string = "1001";
const ZOOM_MISSING_SCOPES_CODE: string = "4711";
const ZOOM_INVALID_ACCESS_TOKEN_CODE: string = "124";
const ZOOM_MISSING_SCOPES_PATTERN: RegExp = /does not contain scopes/i;

export default class ZoomMeetingClient {
  private settings: ZoomMeetingClientSettings;
  private http: VideoCallHttpClient;

  public constructor(
    settings: ZoomMeetingClientSettings,
    http?: VideoCallHttpClient | undefined,
  ) {
    this.settings = settings;
    this.http = http || new VideoCallHttpClient();
  }

  public async createMeeting(
    request: VideoCallMeetingRequest,
  ): Promise<VideoCallMeeting> {
    const token: ZoomAccessToken = await this.getAccessToken();
    const hostEmail: string = this.settings.hostEmail.trim();

    return await ZoomMeetingClient.createMeetingWithToken({
      http: this.http,
      token,
      host: { userId: hostEmail, label: hostEmail, isSignIn: false },
      request,
    });
  }

  public static async createMeetingWithToken(data: {
    http: VideoCallHttpClient;
    token: ZoomAccessToken;
    host: ZoomMeetingHost;
    request: VideoCallMeetingRequest;
  }): Promise<VideoCallMeeting> {
    const request: VideoCallMeetingRequest = data.request;
    const token: ZoomAccessToken = data.token;
    const startTime: Date = request.startTime || new Date();

    const body: JSONObject = {
      topic: ZoomMeetingClient.truncate(
        request.title || "Incident call",
        ZOOM_TOPIC_MAX_LENGTH,
      ),
      type: 2,
      start_time: ZoomMeetingClient.formatStartTime(startTime),
      duration: 60,
      timezone: "UTC",
      settings: {
        join_before_host: true,
        // 0: participants may join at any time before the host.
        jbh_time: 0,
        waiting_room: false,
      },
    };

    if (request.description) {
      body["agenda"] = ZoomMeetingClient.truncate(
        request.description,
        ZOOM_AGENDA_MAX_LENGTH,
      );
    }

    const response: VideoCallHttpResponse = await data.http.request({
      url: `${token.apiBaseUrl}/users/${encodeURIComponent(data.host.userId)}/meetings`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      stepLabel: "Zoom meeting request",
    });

    if (!response.ok) {
      throw ZoomMeetingClient.getMeetingError(response, data.host);
    }

    const joinUrl: JSONValue | undefined = response.json?.["join_url"];
    const meetingId: JSONValue | undefined = response.json?.["id"];

    if (
      typeof joinUrl !== "string" ||
      !ZoomMeetingClient.isZoomJoinUrl(joinUrl)
    ) {
      throw new APIException(
        "Zoom created the meeting but returned no join link for it.",
      );
    }

    return {
      provider: VideoCallProvider.Zoom,
      joinUrl: joinUrl,
      externalMeetingId:
        typeof meetingId === "number" || typeof meetingId === "string"
          ? String(meetingId)
          : undefined,
    };
  }

  public async getAccessToken(): Promise<ZoomAccessToken> {
    const basic: string = Buffer.from(
      `${this.settings.clientId.trim()}:${this.settings.clientSecret}`,
      "utf8",
    ).toString("base64");

    const response: VideoCallHttpResponse = await this.http.request({
      url: ZOOM_TOKEN_URL,
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "account_credentials",
        account_id: this.settings.accountId.trim(),
      }).toString(),
      stepLabel: "Zoom token request",
    });

    if (!response.ok) {
      throw this.getTokenError(response);
    }

    const accessToken: JSONValue | undefined = response.json?.["access_token"];

    if (typeof accessToken !== "string" || !accessToken) {
      throw new APIException("Zoom returned no access token.");
    }

    return {
      accessToken: accessToken,
      apiBaseUrl: ZoomMeetingClient.getApiBaseUrl(response.json?.["api_url"]),
    };
  }

  /*
   * The token response names the cluster this account's API calls go to.
   * Only a Zoom host is ever used: the value comes back from a response,
   * and an access token must not be sent anywhere else.
   */
  public static getApiBaseUrl(apiUrl: JSONValue | undefined): string {
    if (typeof apiUrl !== "string" || !apiUrl) {
      return ZOOM_API_BASE_URL;
    }

    let parsed: URL;

    try {
      parsed = new URL(apiUrl);
    } catch {
      return ZOOM_API_BASE_URL;
    }

    const hostname: string = parsed.hostname.toLowerCase();

    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      !(hostname === "zoom.us" || hostname.endsWith(".zoom.us"))
    ) {
      return ZOOM_API_BASE_URL;
    }

    return `https://${parsed.host}/v2`;
  }

  public static isZoomJoinUrl(url: string): boolean {
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    const hostname: string = parsed.hostname.toLowerCase();

    return (
      parsed.protocol === "https:" &&
      (hostname === "zoom.us" ||
        hostname.endsWith(".zoom.us") ||
        hostname === "zoomgov.com" ||
        hostname.endsWith(".zoomgov.com"))
    );
  }

  // Zoom reads a UTC start time as yyyy-MM-ddTHH:mm:ssZ, without milliseconds.
  public static formatStartTime(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  public static truncate(value: string, maxLength: number): string {
    const trimmed: string = value.trim();

    if (trimmed.length <= maxLength) {
      return trimmed;
    }

    return `${trimmed.substring(0, maxLength - 1)}…`;
  }

  private getTokenError(response: VideoCallHttpResponse): Error {
    const errorCode: string = VideoCallHttpClient.readErrorCode(
      response.json,
    ).toLowerCase();
    const summary: string = VideoCallHttpClient.summarizeErrorBody(response);

    if (errorCode === "invalid_client" || response.status === 401) {
      return new BadDataException(
        `Zoom rejected the Client ID or Client secret. Copy both again from the App Credentials page of your Server-to-Server OAuth app. (${summary})`,
      );
    }

    if (response.status === 400) {
      return new BadDataException(
        `Zoom could not issue a token for this app. Check the Account ID, and that the Server-to-Server OAuth app is activated. (${summary})`,
      );
    }

    return new APIException(
      `Zoom could not issue a token (HTTP ${response.status}): ${summary}`,
    );
  }

  private static getMeetingError(
    response: VideoCallHttpResponse,
    host: ZoomMeetingHost,
  ): Error {
    const errorCode: string = VideoCallHttpClient.readErrorCode(response.json);
    const summary: string = VideoCallHttpClient.summarizeErrorBody(response);

    if (
      errorCode === ZOOM_MISSING_SCOPES_CODE ||
      ZOOM_MISSING_SCOPES_PATTERN.test(summary)
    ) {
      if (host.isSignIn) {
        return new BadDataException(
          `This OneUptime server's Zoom app is missing the ${ZOOM_OAUTH_MEETING_SCOPE} scope. Ask your server administrator to add it on the app's Scopes page, then reconnect Zoom. (${summary})`,
        );
      }

      return new BadDataException(
        `The Zoom app is missing the ${ZOOM_MEETING_SCOPE} scope (or ${ZOOM_CLASSIC_MEETING_SCOPE} on an older app). Add it on the app's Scopes page and activate the app again. (${summary})`,
      );
    }

    if (
      errorCode === ZOOM_USER_DOES_NOT_EXIST_CODE ||
      response.status === 404
    ) {
      if (host.isSignIn) {
        return new BadDataException(
          `Zoom no longer has the user ${host.label} that OneUptime signed in as. Reconnect Zoom in Project Settings > Video Calls. (${summary})`,
        );
      }

      return new BadDataException(
        `Zoom has no user ${host.label} in the account this app belongs to. Set the meeting host to a licensed user of that account. (${summary})`,
      );
    }

    if (
      errorCode === ZOOM_INVALID_ACCESS_TOKEN_CODE ||
      response.status === 401
    ) {
      if (host.isSignIn) {
        return new BadDataException(
          `Zoom no longer accepts OneUptime's sign-in for ${host.label}. Reconnect Zoom in Project Settings > Video Calls. (${summary})`,
        );
      }

      return new BadDataException(
        `Zoom rejected the access token for this app. Check that the Server-to-Server OAuth app is still activated. (${summary})`,
      );
    }

    if (response.status === 429) {
      return new APIException(
        `Zoom is limiting how many meetings this account can create right now. Try again in a minute. (${summary})`,
      );
    }

    if (response.status >= 400 && response.status < 500) {
      return new BadDataException(
        `Zoom could not create the meeting (HTTP ${response.status}): ${summary}`,
      );
    }

    return new APIException(
      `Zoom could not create the meeting (HTTP ${response.status}): ${summary}`,
    );
  }
}
