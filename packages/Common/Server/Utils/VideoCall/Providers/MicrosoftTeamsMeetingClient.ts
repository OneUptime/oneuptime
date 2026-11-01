import BadDataException from "../../../../Types/Exception/BadDataException";
import APIException from "../../../../Types/Exception/ApiException";
import { JSONArray, JSONObject, JSONValue } from "../../../../Types/JSON";
import VideoCallMeeting, {
  VideoCallMeetingNotRecorded,
} from "../../../../Types/VideoCall/VideoCallMeeting";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import {
  MICROSOFT_TEAMS_CALENDAR_PERMISSION,
  MICROSOFT_TEAMS_MEETING_PERMISSION,
  MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION,
} from "../../../../Types/VideoCall/VideoCallProviderCatalog";
import { VideoCallTranscriptUnavailableReason } from "../../../../Types/VideoCall/VideoCallTranscript";
import VideoCallHttpClient, {
  VideoCallHttpResponse,
} from "../VideoCallHttpClient";
import { VideoCallMeetingRequest } from "../VideoCallMeetingRequest";
import MicrosoftTeamsHosts from "../../Workspace/MicrosoftTeams/MicrosoftTeamsHosts";
import MicrosoftTeamsCloudUtil from "../../../../Types/Workspace/MicrosoftTeamsCloud";

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
 *
 * A meeting to be recorded and transcribed (Record and transcribe incident
 * calls) is made another way, because Graph lets apps read the transcripts
 * only of meetings on a calendar: as an event on the organizer's calendar
 * that is a Teams meeting (Calendars.ReadWrite), whose online meeting is
 * then found by its join link and set up as above, with Record and
 * transcribe automatically on. Should any of that fail - a permission the
 * app or the sign-in does not have, an organizer without a mailbox, Graph
 * not answering - the event is deleted and the meeting is created the
 * usual way, unrecorded, saying why (notRecorded): an incident call always
 * starts.
 * https://learn.microsoft.com/graph/api/user-post-events
 * https://learn.microsoft.com/graph/api/onlinemeeting-get
 * https://learn.microsoft.com/graph/api/onlinemeeting-update
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

// One meeting to create, with the token and the organizer it is created as.
export interface MicrosoftTeamsMeetingCreation {
  http: VideoCallHttpClient;
  accessToken: string;
  organizer: MicrosoftTeamsMeetingOrganizer;
  // "organization" or "everyone"; anything else is organization.
  lobbyBypass: string;
  request: VideoCallMeetingRequest;
}

/*
 * Microsoft Graph, at the version every request names, and Microsoft Entra
 * ID's sign-in: on the hosts of the Microsoft cloud this server's Teams
 * runs in (MicrosoftTeamsHosts, MICROSOFT_TEAMS_CLOUD) - graph.microsoft.us
 * and login.microsoftonline.us for GCC High, dod-graph.microsoft.us for
 * DoD, the commercial cloud's otherwise.
 */
export const getMicrosoftGraphBaseUrl: () => string = (): string => {
  return MicrosoftTeamsHosts.getGraphUrl("");
};

/*
 * How many times the online meeting of a new calendar event is looked for,
 * and how long the first wait between looks is (the next waits longer).
 */
export const MICROSOFT_TEAMS_MEETING_LOOKUP_ATTEMPTS: number = 3;
export const MICROSOFT_TEAMS_MEETING_LOOKUP_DELAY_IN_MS: number = 1000;

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

/*
 * Why a recorded meeting could not be made on the organizer's calendar:
 * the meeting is then made the usual way, and the call says why it is not
 * recorded.
 */
export class MicrosoftTeamsRecordingRefusal extends Error {
  public readonly reason: VideoCallTranscriptUnavailableReason;

  public constructor(
    reason: VideoCallTranscriptUnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = "MicrosoftTeamsRecordingRefusal";
    this.reason = reason;
  }
}

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
    return `${MicrosoftTeamsHosts.getSignInOrigin()}/${encodeURIComponent(tenantId.trim())}/oauth2/v2.0/token`;
  }

  // The organizer an app registration creates meetings for.
  public static getAppOrganizer(data: {
    organizerUserId: string;
    clientId: string;
  }): MicrosoftTeamsMeetingOrganizer {
    const organizerUserId: string = data.organizerUserId.trim();

    return {
      path: `/users/${encodeURIComponent(organizerUserId)}`,
      label: organizerUserId,
      isSignIn: false,
      clientId: data.clientId.trim(),
    };
  }

  public async createMeeting(
    request: VideoCallMeetingRequest,
  ): Promise<VideoCallMeeting> {
    const accessToken: string = await this.getAccessToken();

    return await MicrosoftTeamsMeetingClient.createMeetingWithToken({
      http: this.http,
      accessToken,
      organizer: MicrosoftTeamsMeetingClient.getAppOrganizer({
        organizerUserId: this.settings.organizerUserId,
        clientId: this.settings.clientId,
      }),
      lobbyBypass: this.settings.lobbyBypass,
      request,
    });
  }

  public static async createMeetingWithToken(
    data: MicrosoftTeamsMeetingCreation,
  ): Promise<VideoCallMeeting> {
    if (!data.request.recordAndTranscribe) {
      return await MicrosoftTeamsMeetingClient.createOnlineMeeting(data);
    }

    try {
      return await MicrosoftTeamsMeetingClient.createCalendarMeeting(data);
    } catch (error) {
      // The call starts all the same: the usual meeting, saying why it is not recorded.
      return {
        ...(await MicrosoftTeamsMeetingClient.createOnlineMeeting(data)),
        notRecorded: MicrosoftTeamsMeetingClient.readNotRecorded(error),
      };
    }
  }

  /*
   * The usual meeting: an online meeting with no calendar event, which
   * nobody can read the transcript of but the people in it.
   */
  private static async createOnlineMeeting(
    data: MicrosoftTeamsMeetingCreation,
  ): Promise<VideoCallMeeting> {
    const times: { startTime: Date; endTime: Date } =
      MicrosoftTeamsMeetingClient.getMeetingTimes(data.request);

    const body: JSONObject = {
      subject: MicrosoftTeamsMeetingClient.getSubject(data.request),
      startDateTime: times.startTime.toISOString(),
      endDateTime: times.endTime.toISOString(),
      allowedPresenters: "everyone",
      lobbyBypassSettings: MicrosoftTeamsMeetingClient.getLobbyBypassSettings(
        data.lobbyBypass,
      ),
      joinMeetingIdSettings: {
        isPasscodeRequired: false,
      },
    };

    const response: VideoCallHttpResponse = await data.http.request({
      url: `${getMicrosoftGraphBaseUrl()}${data.organizer.path}/onlineMeetings`,
      method: "POST",
      headers: MicrosoftTeamsMeetingClient.getJsonHeaders(data.accessToken),
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

  /*
   * A meeting that records and transcribes itself, on the organizer's
   * calendar: the event, its online meeting found by the join link, and the
   * meeting's options. Throws a MicrosoftTeamsRecordingRefusal (or a
   * request that never completed) when it cannot be made, having deleted
   * any event it created.
   */
  private static async createCalendarMeeting(
    data: MicrosoftTeamsMeetingCreation,
  ): Promise<VideoCallMeeting> {
    const times: { startTime: Date; endTime: Date } =
      MicrosoftTeamsMeetingClient.getMeetingTimes(data.request);
    const description: string = (data.request.description || "").trim();

    const event: JSONObject = {
      subject: MicrosoftTeamsMeetingClient.getSubject(data.request),
      start: {
        dateTime: MicrosoftTeamsMeetingClient.toGraphDateTime(times.startTime),
        timeZone: "UTC",
      },
      end: {
        dateTime: MicrosoftTeamsMeetingClient.toGraphDateTime(times.endTime),
        timeZone: "UTC",
      },
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
      allowNewTimeProposals: false,
      isReminderOn: false,
    };

    if (description) {
      event["body"] = { contentType: "text", content: description };
    }

    const response: VideoCallHttpResponse = await data.http.request({
      url: `${getMicrosoftGraphBaseUrl()}${data.organizer.path}/events`,
      method: "POST",
      headers: MicrosoftTeamsMeetingClient.getJsonHeaders(data.accessToken),
      body: JSON.stringify(event),
      stepLabel: "Microsoft Teams calendar event request",
    });

    if (!response.ok) {
      throw MicrosoftTeamsMeetingClient.getRecordingRefusal({
        response,
        organizer: data.organizer,
        step: "put the meeting on the organizer's calendar",
      });
    }

    const eventId: JSONValue | undefined = response.json?.["id"];

    if (typeof eventId !== "string" || !eventId) {
      throw new MicrosoftTeamsRecordingRefusal(
        VideoCallTranscriptUnavailableReason.NotSupported,
        "Microsoft Graph put the meeting on the organizer's calendar but returned no event for it.",
      );
    }

    try {
      const joinUrl: string | null =
        MicrosoftTeamsMeetingClient.readEventJoinUrl(response.json);

      if (!joinUrl) {
        throw new MicrosoftTeamsRecordingRefusal(
          VideoCallTranscriptUnavailableReason.NotSupported,
          `The organizer's calendar did not make the event a Microsoft Teams meeting. Check that ${data.organizer.label} has a Microsoft Teams license and may schedule Teams meetings.`,
        );
      }

      const meetingId: string = await MicrosoftTeamsMeetingClient.findMeetingId(
        { ...data, joinUrl },
      );

      await MicrosoftTeamsMeetingClient.setRecordedMeetingOptions({
        ...data,
        meetingId,
      });

      return {
        provider: VideoCallProvider.MicrosoftTeams,
        joinUrl,
        externalMeetingId: meetingId,
        externalCalendarEventId: eventId,
      };
    } catch (error) {
      await MicrosoftTeamsMeetingClient.deleteEvent({ ...data, eventId });
      throw error;
    }
  }

  // The online meeting a calendar event made, by its join link.
  private static async findMeetingId(
    data: MicrosoftTeamsMeetingCreation & { joinUrl: string },
  ): Promise<string> {
    // OData quotes a string in ', and doubles a ' inside it.
    const filter: string = `JoinWebUrl eq '${data.joinUrl.replace(/'/g, "''")}'`;

    for (
      let attempt: number = 1;
      attempt <= MICROSOFT_TEAMS_MEETING_LOOKUP_ATTEMPTS;
      attempt++
    ) {
      if (attempt > 1) {
        await MicrosoftTeamsMeetingClient.waitBeforeLookingAgain(
          MICROSOFT_TEAMS_MEETING_LOOKUP_DELAY_IN_MS * (attempt - 1),
        );
      }

      const response: VideoCallHttpResponse = await data.http.request({
        url: `${getMicrosoftGraphBaseUrl()}${data.organizer.path}/onlineMeetings?$filter=${encodeURIComponent(filter)}`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${data.accessToken}`,
          Accept: "application/json",
        },
        stepLabel: "Microsoft Teams meeting lookup",
      });

      if (!response.ok) {
        throw MicrosoftTeamsMeetingClient.getRecordingRefusal({
          response,
          organizer: data.organizer,
          step: "find the Teams meeting of the calendar event",
        });
      }

      const meetings: JSONValue | undefined = response.json?.["value"];

      for (const meeting of Array.isArray(meetings)
        ? (meetings as JSONArray)
        : []) {
        if (meeting && typeof meeting === "object" && !Array.isArray(meeting)) {
          const id: JSONValue | undefined = (meeting as JSONObject)["id"];

          if (typeof id === "string" && id) {
            return id;
          }
        }
      }
    }

    throw new MicrosoftTeamsRecordingRefusal(
      VideoCallTranscriptUnavailableReason.NotSupported,
      "Microsoft Graph did not find the Teams meeting of the calendar event it had just created.",
    );
  }

  /*
   * The options every incident meeting has (see the top of the file), and
   * Record and transcribe automatically.
   */
  private static async setRecordedMeetingOptions(
    data: MicrosoftTeamsMeetingCreation & { meetingId: string },
  ): Promise<void> {
    const options: JSONObject = {
      allowedPresenters: "everyone",
      lobbyBypassSettings: MicrosoftTeamsMeetingClient.getLobbyBypassSettings(
        data.lobbyBypass,
      ),
      allowRecording: true,
      allowTranscription: true,
      recordAutomatically: true,
    };

    const response: VideoCallHttpResponse = await data.http.request({
      url: `${getMicrosoftGraphBaseUrl()}${data.organizer.path}/onlineMeetings/${encodeURIComponent(data.meetingId)}`,
      method: "PATCH",
      headers: MicrosoftTeamsMeetingClient.getJsonHeaders(data.accessToken),
      body: JSON.stringify(options),
      stepLabel: "Microsoft Teams meeting options request",
    });

    if (!response.ok) {
      throw MicrosoftTeamsMeetingClient.getRecordingRefusal({
        response,
        organizer: data.organizer,
        step: "turn on recording and transcription for the meeting",
      });
    }
  }

  /*
   * Takes back a calendar event whose meeting could not be set up. Best
   * effort: an event left on the organizer's calendar harms nothing.
   */
  private static async deleteEvent(
    data: MicrosoftTeamsMeetingCreation & { eventId: string },
  ): Promise<void> {
    try {
      await data.http.request({
        url: `${getMicrosoftGraphBaseUrl()}${data.organizer.path}/events/${encodeURIComponent(data.eventId)}`,
        method: "DELETE",
        headers: { Authorization: `Bearer ${data.accessToken}` },
        stepLabel: "Microsoft Teams calendar event removal",
      });
    } catch {
      return;
    }
  }

  // Between two looks for a new calendar event's meeting.
  public static async waitBeforeLookingAgain(delayInMs: number): Promise<void> {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, delayInMs);
    });
  }

  // The Teams join link of an event Graph just created, or null.
  private static readEventJoinUrl(json: JSONObject | null): string | null {
    const onlineMeeting: JSONValue | undefined = json?.["onlineMeeting"];

    if (
      !onlineMeeting ||
      typeof onlineMeeting !== "object" ||
      Array.isArray(onlineMeeting)
    ) {
      return null;
    }

    const joinUrl: JSONValue | undefined = (onlineMeeting as JSONObject)[
      "joinUrl"
    ];

    return typeof joinUrl === "string" &&
      MicrosoftTeamsMeetingClient.isTeamsJoinUrl(joinUrl)
      ? joinUrl
      : null;
  }

  // Why the recorded meeting could not be made, for the call and the log.
  private static readNotRecorded(error: unknown): VideoCallMeetingNotRecorded {
    if (error instanceof MicrosoftTeamsRecordingRefusal) {
      return { reason: error.reason, message: error.message };
    }

    return {
      reason: VideoCallTranscriptUnavailableReason.NotSupported,
      message: `Microsoft Graph did not answer while OneUptime put the meeting on the organizer's calendar: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  private static getRecordingRefusal(data: {
    response: VideoCallHttpResponse;
    organizer: MicrosoftTeamsMeetingOrganizer;
    // What OneUptime asked Graph to do: "put the meeting on the organizer's calendar".
    step: string;
  }): MicrosoftTeamsRecordingRefusal {
    const summary: string = VideoCallHttpClient.summarizeErrorBody(
      data.response,
    );

    if (data.response.status === 401 || data.response.status === 403) {
      return new MicrosoftTeamsRecordingRefusal(
        VideoCallTranscriptUnavailableReason.PermissionMissing,
        data.organizer.isSignIn
          ? `Microsoft did not let OneUptime's sign-in for ${data.organizer.label} ${data.step}. Reconnect Microsoft Teams in Project Settings > Workspace > Video Calls while Record and transcribe incident calls is on, and allow OneUptime to use the account's calendar and read meeting transcripts. (${summary})`
          : `Microsoft Graph did not let the app ${data.step}. Check that the app registration has the ${MICROSOFT_TEAMS_CALENDAR_PERMISSION} and ${MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION} application permissions with admin consent granted. (${summary})`,
      );
    }

    return new MicrosoftTeamsRecordingRefusal(
      VideoCallTranscriptUnavailableReason.NotSupported,
      `Microsoft Graph could not ${data.step} (HTTP ${data.response.status}): ${summary}`,
    );
  }

  private static getMeetingTimes(request: VideoCallMeetingRequest): {
    startTime: Date;
    endTime: Date;
  } {
    const startTime: Date = request.startTime || new Date();

    return {
      startTime,
      endTime: new Date(startTime.getTime() + MEETING_LENGTH_IN_MILLISECONDS),
    };
  }

  private static getSubject(request: VideoCallMeetingRequest): string {
    const subject: string = (request.title || "").trim() || "Incident call";

    return subject.length > SUBJECT_MAX_LENGTH
      ? `${subject.substring(0, SUBJECT_MAX_LENGTH - 1)}…`
      : subject;
  }

  private static getLobbyBypassSettings(lobbyBypass: string): JSONObject {
    return {
      scope: ALLOWED_LOBBY_BYPASS_SCOPES.includes(lobbyBypass)
        ? lobbyBypass
        : "organization",
      isDialInBypassEnabled: true,
    };
  }

  // A time as a calendar event takes it beside timeZone "UTC": "2026-10-07T08:30:00".
  private static toGraphDateTime(date: Date): string {
    return date.toISOString().substring(0, 19);
  }

  private static getJsonHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
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
        scope: MicrosoftTeamsHosts.getGraphDefaultScope(),
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

    // Teams' meeting hosts, in every Microsoft cloud.
    return (
      parsed.protocol === "https:" &&
      MicrosoftTeamsCloudUtil.isTeamsMeetingHost(hostname)
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
          `Microsoft no longer accepts OneUptime's sign-in for ${organizer.label}. Reconnect Microsoft Teams in Project Settings > Workspace > Video Calls. (${summary})`,
        );
      }

      if (response.status === 403 || response.status === 404) {
        return new BadDataException(
          `Microsoft Graph did not let ${organizer.label} create a Teams meeting. Check that the account has a Microsoft Teams license and may schedule meetings, then reconnect Microsoft Teams in Project Settings > Workspace > Video Calls. (${summary})`,
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
