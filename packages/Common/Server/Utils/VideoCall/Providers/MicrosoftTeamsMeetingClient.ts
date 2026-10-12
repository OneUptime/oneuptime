import BadDataException from "../../../../Types/Exception/BadDataException";
import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import VideoCallMeeting from "../../../../Types/VideoCall/VideoCallMeeting";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import { MICROSOFT_TEAMS_MEETING_PERMISSION } from "../../../../Types/VideoCall/VideoCallProviderCatalog";
import VideoCallHttpClient, {
  VideoCallHttpResponse,
} from "../VideoCallHttpClient";
import { VideoCallMeetingRequest } from "../VideoCallMeetingRequest";

/*
 * Creates incident meetings as Microsoft Teams online meetings through
 * Microsoft Graph, organized by a Microsoft 365 service account.
 *
 * Auth is the client-credentials grant of the project's own Entra app
 * registration, so no person signs in and no refresh token can lapse.
 * Creating a meeting for a user with an application token needs the
 * OnlineMeetings.ReadWrite.All application permission AND an application
 * access policy granted to that user - Teams' way of limiting which users
 * an app may act for. Without the policy Graph answers 403 "No application
 * access policy found for this app", which the error below turns into the
 * two PowerShell commands that fix it.
 * https://learn.microsoft.com/graph/api/application-post-onlinemeetings
 * https://learn.microsoft.com/graph/cloud-communication-online-meeting-application-access-policy
 *
 * People in the organization skip the lobby by default and everyone may
 * present: the organizer is a service account that never joins, so nobody
 * would be there to admit them or hand over the screen.
 *
 * A connection made by signing in (VideoCallAuthMethod.OAuth) creates the
 * same meeting with the signed-in account's own delegated token, as /me
 * (createMeetingWithToken), which needs no application access policy.
 */

export interface MicrosoftTeamsMeetingClientSettings {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  organizerUserId: string;
  // "organization" or "everyone" (lobbyBypassSettings.scope).
  lobbyBypass: string;
}

// Who organizes a meeting, and how an error names them.
export interface MicrosoftTeamsMeetingOrganizer {
  // The organizer's Graph path: "/me" for the signed-in account, or "/users/<object id>".
  path: string;
  label: string;
  /*
   * Whether the token is a person's sign-in to this server's Microsoft app
   * rather than the project's own app registration: what fixes a refusal
   * differs.
   */
  isSignIn: boolean;
  // An app registration's client id, for the access policy it needs.
  clientId?: string | undefined;
}

export const MICROSOFT_GRAPH_BASE_URL: string =
  "https://graph.microsoft.com/v1.0";
export const MICROSOFT_LOGIN_HOST: string = "https://login.microsoftonline.com";

const ALLOWED_LOBBY_BYPASS_SCOPES: Array<string> = ["organization", "everyone"];

// Graph accepts long subjects; a channel tab and a calendar show far less.
const SUBJECT_MAX_LENGTH: number = 255;

const MEETING_LENGTH_IN_MILLISECONDS: number = 60 * 60 * 1000;

/*
 * Entra prefixes every error description with its AADSTS code, and Graph
 * names the missing policy in its message: the failures a person can fix.
 */
const INVALID_CLIENT_SECRET_PATTERN: RegExp =
  /AADSTS7000215|AADSTS7000222|invalid_client/i;
const UNKNOWN_APPLICATION_PATTERN: RegExp = /AADSTS700016/i;
const UNKNOWN_TENANT_PATTERN: RegExp = /AADSTS90002|AADSTS900023/i;
const MISSING_ACCESS_POLICY_PATTERN: RegExp = /application access policy/i;

const GUID_REGEX: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default class MicrosoftTeamsMeetingClient {
  private settings: MicrosoftTeamsMeetingClientSettings;
  private http: VideoCallHttpClient;

  public constructor(
    settings: MicrosoftTeamsMeetingClientSettings,
    http?: VideoCallHttpClient | undefined,
  ) {
    this.settings = settings;
    this.http = http || new VideoCallHttpClient();
  }

  public static isGuid(value: string | undefined): boolean {
    return GUID_REGEX.test((value || "").trim());
  }

  public static getTokenUrl(tenantId: string): string {
    return `${MICROSOFT_LOGIN_HOST}/${encodeURIComponent(tenantId.trim())}/oauth2/v2.0/token`;
  }

  public async createMeeting(
    request: VideoCallMeetingRequest,
  ): Promise<VideoCallMeeting> {
    const accessToken: string = await this.getAccessToken();
    const organizerUserId: string = this.settings.organizerUserId.trim();

    return await MicrosoftTeamsMeetingClient.createMeetingWithToken({
      http: this.http,
      accessToken,
      organizer: {
        path: `/users/${encodeURIComponent(organizerUserId)}`,
        label: organizerUserId,
        isSignIn: false,
        clientId: this.settings.clientId.trim(),
      },
      lobbyBypass: this.settings.lobbyBypass,
      request,
    });
  }

  public static async createMeetingWithToken(data: {
    http: VideoCallHttpClient;
    accessToken: string;
    organizer: MicrosoftTeamsMeetingOrganizer;
    // "organization" or "everyone"; anything else is organization.
    lobbyBypass: string;
    request: VideoCallMeetingRequest;
  }): Promise<VideoCallMeeting> {
    const request: VideoCallMeetingRequest = data.request;
    const accessToken: string = data.accessToken;

    const startTime: Date = request.startTime || new Date();
    const endTime: Date = new Date(
      startTime.getTime() + MEETING_LENGTH_IN_MILLISECONDS,
    );

    const lobbyBypass: string = ALLOWED_LOBBY_BYPASS_SCOPES.includes(
      data.lobbyBypass,
    )
      ? data.lobbyBypass
      : "organization";

    const subject: string = (request.title || "Incident call").trim();

    const body: JSONObject = {
      subject:
        subject.length > SUBJECT_MAX_LENGTH
          ? `${subject.substring(0, SUBJECT_MAX_LENGTH - 1)}…`
          : subject,
      startDateTime: startTime.toISOString(),
      endDateTime: endTime.toISOString(),
      allowedPresenters: "everyone",
      lobbyBypassSettings: {
        scope: lobbyBypass,
        isDialInBypassEnabled: true,
      },
      joinMeetingIdSettings: {
        isPasscodeRequired: false,
      },
    };

    const response: VideoCallHttpResponse = await data.http.request({
      url: `${MICROSOFT_GRAPH_BASE_URL}${data.organizer.path}/onlineMeetings`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      stepLabel: "Microsoft Teams meeting request",
    });

    if (!response.ok) {
      throw MicrosoftTeamsMeetingClient.getMeetingError(
        response,
        data.organizer,
      );
    }

    const joinWebUrl: JSONValue | undefined = response.json?.["joinWebUrl"];
    const meetingId: JSONValue | undefined = response.json?.["id"];

    if (
      typeof joinWebUrl !== "string" ||
      !MicrosoftTeamsMeetingClient.isTeamsJoinUrl(joinWebUrl)
    ) {
      throw new APIException(
        "Microsoft Graph created the meeting but returned no join link for it.",
      );
    }

    return {
      provider: VideoCallProvider.MicrosoftTeams,
      joinUrl: joinWebUrl,
      externalMeetingId: typeof meetingId === "string" ? meetingId : undefined,
    };
  }

  public async getAccessToken(): Promise<string> {
    const response: VideoCallHttpResponse = await this.http.request({
      url: MicrosoftTeamsMeetingClient.getTokenUrl(this.settings.tenantId),
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: this.settings.clientId.trim(),
        client_secret: this.settings.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }).toString(),
      stepLabel: "Microsoft Entra token request",
    });

    if (!response.ok) {
      throw this.getTokenError(response);
    }

    const accessToken: JSONValue | undefined = response.json?.["access_token"];

    if (typeof accessToken !== "string" || !accessToken) {
      throw new APIException("Microsoft Entra returned no access token.");
    }

    return accessToken;
  }

  public static isTeamsJoinUrl(url: string): boolean {
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    const hostname: string = parsed.hostname.toLowerCase();

    return (
      parsed.protocol === "https:" &&
      (hostname === "teams.microsoft.com" ||
        hostname === "teams.microsoft.us" ||
        hostname === "teams.live.com" ||
        hostname === "teams.cloud.microsoft" ||
        hostname.endsWith(".teams.microsoft.com"))
    );
  }

  private getTokenError(response: VideoCallHttpResponse): Error {
    const summary: string = VideoCallHttpClient.summarizeErrorBody(response);

    if (INVALID_CLIENT_SECRET_PATTERN.test(summary)) {
      return new BadDataException(
        `Microsoft Entra rejected the client secret. Use the secret's Value, not its Secret ID, and check that it has not expired. (${summary})`,
      );
    }

    if (UNKNOWN_APPLICATION_PATTERN.test(summary)) {
      return new BadDataException(
        `Microsoft Entra has no application with this Application (client) ID in the tenant. Check the client ID and the Directory (tenant) ID. (${summary})`,
      );
    }

    if (UNKNOWN_TENANT_PATTERN.test(summary)) {
      return new BadDataException(
        `Microsoft Entra has no tenant with this Directory (tenant) ID. Copy it again from the app registration's Overview page. (${summary})`,
      );
    }

    if (response.status >= 400 && response.status < 500) {
      return new BadDataException(
        `Microsoft Entra could not issue a token for the app registration (HTTP ${response.status}): ${summary}`,
      );
    }

    return new APIException(
      `Microsoft Entra could not issue a token for the app registration (HTTP ${response.status}): ${summary}`,
    );
  }

  private static getMeetingError(
    response: VideoCallHttpResponse,
    organizer: MicrosoftTeamsMeetingOrganizer,
  ): Error {
    const summary: string = VideoCallHttpClient.summarizeErrorBody(response);

    if (organizer.isSignIn) {
      if (response.status === 401) {
        return new BadDataException(
          `Microsoft no longer accepts OneUptime's sign-in for ${organizer.label}. Reconnect Microsoft Teams in Project Settings > Video Calls. (${summary})`,
        );
      }

      if (response.status === 403 || response.status === 404) {
        return new BadDataException(
          `Microsoft Graph did not let ${organizer.label} create a Teams meeting. Check that the account has a Microsoft Teams license and may schedule meetings, then reconnect Microsoft Teams in Project Settings > Video Calls. (${summary})`,
        );
      }
    }

    if (MISSING_ACCESS_POLICY_PATTERN.test(summary)) {
      return new BadDataException(
        `Microsoft Teams has no application access policy that lets this app create meetings for the organizer. In Teams PowerShell run: New-CsApplicationAccessPolicy -Identity OneUptime-Meetings -AppIds "${organizer.clientId || ""}" and then Grant-CsApplicationAccessPolicy -PolicyName OneUptime-Meetings -Identity "${organizer.label}". It can take up to 30 minutes to apply. (${summary})`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      return new BadDataException(
        `Microsoft Graph did not allow the app to create the meeting. Check that the app registration has the ${MICROSOFT_TEAMS_MEETING_PERMISSION} application permission with admin consent granted. (${summary})`,
      );
    }

    if (response.status === 404) {
      return new BadDataException(
        `Microsoft Graph found no user with the organizer object ID ${organizer.label}. Copy the Object ID of a licensed Teams user from the Entra admin center. (${summary})`,
      );
    }

    if (response.status === 429) {
      return new APIException(
        `Microsoft Graph is limiting requests from this app right now. Try again in a minute. (${summary})`,
      );
    }

    if (response.status >= 400 && response.status < 500) {
      return new BadDataException(
        `Microsoft Teams could not create the meeting (HTTP ${response.status}): ${summary}`,
      );
    }

    return new APIException(
      `Microsoft Teams could not create the meeting (HTTP ${response.status}): ${summary}`,
    );
  }
}
