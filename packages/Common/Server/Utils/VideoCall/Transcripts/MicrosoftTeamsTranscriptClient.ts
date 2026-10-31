import APIException from "../../../../Types/Exception/ApiException";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject, JSONValue } from "../../../../Types/JSON";
import { MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION } from "../../../../Types/VideoCall/VideoCallProviderCatalog";
import {
  MAX_VIDEO_CALL_TRANSCRIPT_INPUT_CHARACTERS,
  VideoCallTranscriptUnavailableReason,
} from "../../../../Types/VideoCall/VideoCallTranscript";
import TranscriptText, {
  TranscriptLine,
  TranscriptSourceFormat,
} from "../../../../Utils/VideoCall/TranscriptText";
import MicrosoftTeamsMeetingsOAuthApp from "../OAuth/MicrosoftTeamsMeetingsOAuthApp";
import {
  getMicrosoftGraphBaseUrl,
  MicrosoftTeamsMeetingOrganizer,
} from "../Providers/MicrosoftTeamsMeetingClient";
import VideoCallHttpClient, {
  VideoCallHttpResponse,
} from "../VideoCallHttpClient";
import {
  VideoCallTranscriptRead,
  transcriptFound,
  transcriptUnavailable,
} from "./VideoCallTranscriptRead";

/*
 * Reads the transcript of a Microsoft Teams meeting OneUptime put on its
 * organizer's calendar (MicrosoftTeamsMeetingClient), through Microsoft
 * Graph. Graph has no transcripts for an online meeting with no calendar
 * event, which is why only those meetings are asked about
 * (canReadVideoCallTranscriptFromProvider).
 *
 * Every time the meeting is transcribed is a transcript, a WebVTT file
 * whose voice spans name the speakers: the call's transcript is all of
 * them, in order.
 * https://learn.microsoft.com/graph/api/onlinemeeting-list-transcripts
 * https://learn.microsoft.com/graph/api/calltranscript-get
 *
 * Reading needs OnlineMeetingTranscript.Read.All: an application permission
 * of the app registration, which the application access policy that lets
 * it create the organizer's meetings covers too, or a delegated one a
 * Microsoft 365 administrator approves for a sign-in. Two tenant settings
 * can still refuse: apps' access to transcripts turned off altogether
 * (GraphAccessToTranscriptsDisabled), or only to who said what
 * (SpeakerAttributionNotAllowed) - then the words are read without their
 * speakers.
 *
 * Graph keeps a meeting for 60 days after it ends.
 */

export interface MicrosoftTeamsTranscriptRequest {
  http: VideoCallHttpClient;
  accessToken: string;
  // Who organized the meeting: its transcripts are read as them.
  organizer: MicrosoftTeamsMeetingOrganizer;
  // The online meeting's id, as OneUptime stored it when it created the meeting.
  meetingId: string;
  // The scopes a sign-in was granted, when Microsoft said.
  grantedScope?: string | undefined;
  // When the call started: a meeting Graph no longer has may have expired.
  callStartedAt?: Date | undefined;
  now?: Date | undefined;
}

// How long Graph keeps an online meeting after it ends.
export const MICROSOFT_TEAMS_MEETING_RETENTION_IN_DAYS: number = 60;

// The content types a transcript is read as: with speakers, and without.
export const MICROSOFT_TEAMS_TRANSCRIPT_CONTENT_TYPE: string = "text/vtt";
export const MICROSOFT_TEAMS_UNATTRIBUTED_TRANSCRIPT_CONTENT_TYPE: string =
  "application/vnd.microsoft.graph.transcript+text";

// Graph's inner error codes for the two tenant settings.
export const GRAPH_TRANSCRIPTS_DISABLED_CODE: string =
  "GraphAccessToTranscriptsDisabled";
export const GRAPH_SPEAKER_ATTRIBUTION_NOT_ALLOWED_CODE: string =
  "SpeakerAttributionNotAllowed";

// Pages of transcripts read at most, and transcripts: far past any one call.
const MAX_PAGES: number = 20;
const MAX_TRANSCRIPTS: number = 50;

const MISSING_ACCESS_POLICY_PATTERN: RegExp = /application access policy/i;

const CUE_ARROW: string = "-->";
const START_OF_CALL: string = "00:00:00.000";

interface TranscriptRecord {
  id: string;
  // When the transcription began, in milliseconds.
  createdAt?: number | undefined;
}

export default class MicrosoftTeamsTranscriptClient {
  public static async readTranscript(
    request: MicrosoftTeamsTranscriptRequest,
  ): Promise<VideoCallTranscriptRead> {
    const meetingId: string = request.meetingId.trim();

    if (!meetingId) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.NotSupported,
        "OneUptime has no Microsoft Teams meeting for this call, so it cannot ask Microsoft for its transcript. Add the transcript yourself.",
      );
    }

    /*
     * A sign-in made while the project did not record its calls was never
     * asked for transcripts, and asking Graph would only say so.
     */
    if (
      request.organizer.isSignIn &&
      request.grantedScope &&
      !MicrosoftTeamsMeetingsOAuthApp.grants(
        request.grantedScope,
        MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION,
      )
    ) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.PermissionMissing,
        MicrosoftTeamsTranscriptClient.getMissingPermissionMessage(
          request.organizer,
        ),
      );
    }

    const meetingUrl: string = `${getMicrosoftGraphBaseUrl()}${request.organizer.path}/onlineMeetings/${encodeURIComponent(meetingId)}`;

    const transcriptsOrRefusal:
      | Array<TranscriptRecord>
      | VideoCallTranscriptRead =
      await MicrosoftTeamsTranscriptClient.listTranscripts(
        request,
        `${meetingUrl}/transcripts`,
      );

    if (!Array.isArray(transcriptsOrRefusal)) {
      return transcriptsOrRefusal;
    }

    const transcripts: Array<TranscriptRecord> = transcriptsOrRefusal
      .sort((left: TranscriptRecord, right: TranscriptRecord): number => {
        return (left.createdAt ?? 0) - (right.createdAt ?? 0);
      })
      .slice(0, MAX_TRANSCRIPTS);

    if (transcripts.length === 0) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.NotTranscribed,
        "Microsoft Teams has no transcript of this meeting yet. Teams has one ready a few minutes after a transcribed meeting ends. Try again later, or add the transcript yourself.",
      );
    }

    const lines: Array<TranscriptLine> = [];
    const firstStart: number | undefined = transcripts[0]!.createdAt;
    let characterCount: number = 0;

    for (const transcript of transcripts) {
      const contentOrRefusal: string | VideoCallTranscriptRead =
        await MicrosoftTeamsTranscriptClient.readContent(
          request,
          `${meetingUrl}/transcripts/${encodeURIComponent(transcript.id)}/content`,
        );

      if (typeof contentOrRefusal !== "string") {
        return contentOrRefusal;
      }

      characterCount += contentOrRefusal.length;

      if (characterCount > MAX_VIDEO_CALL_TRANSCRIPT_INPUT_CHARACTERS) {
        throw new BadDataException(
          "This meeting's transcript is too long to add: more than about eight hours of talk. Download it from Teams and add the part of the call about the incident.",
        );
      }

      // A transcription that began later in the call starts its cues at 0 too.
      const shiftInSeconds: number =
        firstStart !== undefined && transcript.createdAt !== undefined
          ? Math.max(0, (transcript.createdAt - firstStart) / 1000)
          : 0;

      for (const line of TranscriptText.parse(
        MicrosoftTeamsTranscriptClient.clampNegativeCueTimes(contentOrRefusal),
      )) {
        lines.push(
          line.offsetInSeconds !== undefined && shiftInSeconds > 0
            ? {
                ...line,
                offsetInSeconds: line.offsetInSeconds + shiftInSeconds,
              }
            : line,
        );
      }
    }

    if (lines.length === 0) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.NotTranscribed,
        "This meeting's transcript in Microsoft Teams has no words in it. Add the transcript yourself.",
      );
    }

    return transcriptFound({ lines, format: TranscriptSourceFormat.WebVTT });
  }

  public static getMissingPermissionMessage(
    organizer: MicrosoftTeamsMeetingOrganizer,
  ): string {
    if (organizer.isSignIn) {
      return "OneUptime's sign-in to Microsoft Teams cannot read meeting transcripts yet. Reconnect Microsoft Teams in Project Settings > Workspace > Video Calls while Record and transcribe incident calls is on, and have a Microsoft 365 administrator approve reading meeting transcripts.";
    }

    return `This connection's app registration cannot read meeting transcripts. In the Microsoft Entra admin center, add the ${MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION} application permission to it and grant admin consent.`;
  }

  /*
   * Graph writes a negative time for words said before the transcription
   * began: they are from the start of the call.
   */
  public static clampNegativeCueTimes(content: string): string {
    return content
      .split("\n")
      .map((line: string): string => {
        const arrowAt: number = line.indexOf(CUE_ARROW);

        if (arrowAt === -1) {
          return line;
        }

        const start: string = line.slice(0, arrowAt).trim();
        // The end time, then any cue settings ("align:start").
        const afterArrow: Array<string> = line
          .slice(arrowAt + CUE_ARROW.length)
          .trim()
          .split(" ");
        const end: string = afterArrow[0] || "";

        if (!start.startsWith("-") && !end.startsWith("-")) {
          return line;
        }

        const clamp: (time: string) => string = (time: string): string => {
          return time.startsWith("-") ? START_OF_CALL : time;
        };

        return [
          `${clamp(start)} ${CUE_ARROW} ${clamp(end)}`,
          ...afterArrow.slice(1),
        ]
          .join(" ")
          .trimEnd();
      })
      .join("\n");
  }

  // Every transcript of the meeting, or why they could not be listed.
  private static async listTranscripts(
    request: MicrosoftTeamsTranscriptRequest,
    firstUrl: string,
  ): Promise<Array<TranscriptRecord> | VideoCallTranscriptRead> {
    const transcripts: Array<TranscriptRecord> = [];
    let url: string = firstUrl;

    for (let page: number = 0; page < MAX_PAGES; page++) {
      const response: VideoCallHttpResponse = await request.http.request({
        url,
        method: "GET",
        headers: {
          Authorization: `Bearer ${request.accessToken}`,
          Accept: "application/json",
        },
        stepLabel: "Microsoft Teams transcripts request",
      });

      if (!response.ok) {
        return MicrosoftTeamsTranscriptClient.readRefusal(response, request);
      }

      const list: JSONValue | undefined = response.json?.["value"];

      for (const item of Array.isArray(list) ? (list as JSONArray) : []) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          continue;
        }

        const id: JSONValue | undefined = (item as JSONObject)["id"];

        if (typeof id !== "string" || !id) {
          continue;
        }

        const createdAt: JSONValue | undefined = (item as JSONObject)[
          "createdDateTime"
        ];
        const createdAtTime: number =
          typeof createdAt === "string" ? Date.parse(createdAt) : NaN;

        transcripts.push({
          id,
          createdAt: Number.isFinite(createdAtTime) ? createdAtTime : undefined,
        });
      }

      // The next page, only ever from Graph: the token goes nowhere else.
      const next: JSONValue | undefined = response.json?.["@odata.nextLink"];

      if (
        typeof next !== "string" ||
        !next.startsWith(`${getMicrosoftGraphBaseUrl()}/`)
      ) {
        break;
      }

      url = next;
    }

    return transcripts;
  }

  /*
   * One transcript's words: with their speakers, or without them where the
   * organization does not let apps read who said what.
   */
  private static async readContent(
    request: MicrosoftTeamsTranscriptRequest,
    url: string,
  ): Promise<string | VideoCallTranscriptRead> {
    let response: VideoCallHttpResponse =
      await MicrosoftTeamsTranscriptClient.requestContent(
        request,
        url,
        MICROSOFT_TEAMS_TRANSCRIPT_CONTENT_TYPE,
      );

    if (
      response.status === 403 &&
      MicrosoftTeamsTranscriptClient.readInnerErrorCode(response.json) ===
        GRAPH_SPEAKER_ATTRIBUTION_NOT_ALLOWED_CODE
    ) {
      response = await MicrosoftTeamsTranscriptClient.requestContent(
        request,
        url,
        MICROSOFT_TEAMS_UNATTRIBUTED_TRANSCRIPT_CONTENT_TYPE,
      );
    }

    if (response.status === 404) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.NotReady,
        "Microsoft Teams is still preparing this meeting's transcript. Try again in a few minutes.",
      );
    }

    if (!response.ok) {
      return MicrosoftTeamsTranscriptClient.readRefusal(response, request);
    }

    return response.bodyText;
  }

  private static async requestContent(
    request: MicrosoftTeamsTranscriptRequest,
    url: string,
    contentType: string,
  ): Promise<VideoCallHttpResponse> {
    return await request.http.request({
      url,
      method: "GET",
      headers: {
        Authorization: `Bearer ${request.accessToken}`,
        Accept: contentType,
      },
      stepLabel: "Microsoft Teams transcript download",
    });
  }

  /*
   * What a refused request means for the transcript, or a throw when Graph
   * did not answer: a rate limit or an outage.
   */
  private static readRefusal(
    response: VideoCallHttpResponse,
    request: MicrosoftTeamsTranscriptRequest,
  ): VideoCallTranscriptRead {
    const summary: string = VideoCallHttpClient.summarizeErrorBody(response);
    const organizer: MicrosoftTeamsMeetingOrganizer = request.organizer;

    if (
      MicrosoftTeamsTranscriptClient.readInnerErrorCode(response.json) ===
      GRAPH_TRANSCRIPTS_DISABLED_CODE
    ) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.PermissionMissing,
        `A Microsoft 365 administrator turned off apps' access to meeting transcripts for your organization, so OneUptime cannot read this meeting's transcript. In Teams, open the meeting's recap, download the transcript as a .vtt file, and add it here. (${summary})`,
      );
    }

    if (response.status === 401) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.ConnectionProblem,
        organizer.isSignIn
          ? `Microsoft no longer accepts OneUptime's sign-in for ${organizer.label}. Reconnect Microsoft Teams in Project Settings > Workspace > Video Calls. (${summary})`
          : `Microsoft Graph did not accept the app registration's token. Check the connection in Project Settings > Workspace > Video Calls. (${summary})`,
      );
    }

    if (response.status === 403) {
      if (!organizer.isSignIn && MISSING_ACCESS_POLICY_PATTERN.test(summary)) {
        return transcriptUnavailable(
          VideoCallTranscriptUnavailableReason.PermissionMissing,
          `Microsoft Teams has no application access policy that lets this app read the organizer's meetings. In Teams PowerShell run: Grant-CsApplicationAccessPolicy -PolicyName OneUptime-Meetings -Identity "${organizer.label}". It can take up to 30 minutes to apply. (${summary})`,
        );
      }

      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.PermissionMissing,
        `${MicrosoftTeamsTranscriptClient.getMissingPermissionMessage(organizer)} (${summary})`,
      );
    }

    if (response.status === 404) {
      const startedAt: number | undefined = request.callStartedAt?.getTime();
      const now: number = (request.now || new Date()).getTime();

      if (
        startedAt !== undefined &&
        now - startedAt >
          MICROSOFT_TEAMS_MEETING_RETENTION_IN_DAYS * 24 * 60 * 60 * 1000
      ) {
        return transcriptUnavailable(
          VideoCallTranscriptUnavailableReason.Expired,
          `Microsoft Teams keeps a meeting for apps to read for ${MICROSOFT_TEAMS_MEETING_RETENTION_IN_DAYS} days after it ends, and this call is older. The transcript is still in the meeting's recap in Teams: you can add it yourself. (${summary})`,
        );
      }

      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.NoMeeting,
        `Microsoft Teams has no record of this meeting. (${summary})`,
      );
    }

    if (response.status === 429) {
      throw new APIException(
        `Microsoft Graph is limiting requests from this app right now. Try again in a minute. (${summary})`,
      );
    }

    if (response.status >= 400 && response.status < 500) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.NotSupported,
        `Microsoft Teams could not answer for this meeting's transcript (HTTP ${response.status}): ${summary}`,
      );
    }

    throw new APIException(
      `Microsoft Teams could not answer for this meeting's transcript (HTTP ${response.status}): ${summary}`,
    );
  }

  // Graph's code for why it refused, under error.innerError (or innererror).
  private static readInnerErrorCode(json: JSONObject | null): string {
    const error: JSONValue | undefined = json?.["error"];

    if (!error || typeof error !== "object" || Array.isArray(error)) {
      return "";
    }

    for (const key of ["innerError", "innererror"]) {
      const inner: JSONValue | undefined = (error as JSONObject)[key];

      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        const code: JSONValue | undefined = (inner as JSONObject)["code"];

        if (typeof code === "string" && code) {
          return code;
        }
      }
    }

    return "";
  }
}
