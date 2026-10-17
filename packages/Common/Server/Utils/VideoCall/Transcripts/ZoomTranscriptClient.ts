import APIException from "../../../../Types/Exception/ApiException";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject, JSONValue } from "../../../../Types/JSON";
import {
  ZOOM_CLASSIC_RECORDING_SCOPE,
  ZOOM_MEETING_TRANSCRIPT_SCOPE,
  ZOOM_OAUTH_MEETING_TRANSCRIPT_SCOPE,
  ZOOM_OAUTH_RECORDING_FILES_SCOPE,
  ZOOM_RECORDING_FILES_SCOPE,
} from "../../../../Types/VideoCall/VideoCallProviderCatalog";
import {
  MAX_VIDEO_CALL_TRANSCRIPT_INPUT_CHARACTERS,
  VideoCallTranscriptUnavailableReason,
} from "../../../../Types/VideoCall/VideoCallTranscript";
import TranscriptText, {
  TranscriptLine,
  TranscriptSourceFormat,
} from "../../../../Utils/VideoCall/TranscriptText";
import VideoCallOAuthUtil from "../OAuth/VideoCallOAuth";
import ZoomMeetingClient, {
  ZoomAccessToken,
} from "../Providers/ZoomMeetingClient";
import VideoCallHttpClient, {
  VideoCallHttpResponse,
} from "../VideoCallHttpClient";
import {
  VideoCallTranscriptRead,
  transcriptFound,
  transcriptUnavailable,
} from "./VideoCallTranscriptRead";

/*
 * Reads the transcript of a Zoom meeting OneUptime created.
 *
 * Zoom keeps a meeting's words in two places, and either may be the one a
 * team has:
 *
 *   - the audio transcript of its cloud recording, a WebVTT file among the
 *     recording's files (file_type TRANSCRIPT) when the meeting was recorded
 *     to the cloud with Audio transcript on;
 *     https://developers.zoom.us/docs/api/meetings/#tag/cloud-recording/GET/meetings/{meetingId}/recordings
 *   - the transcript AI Companion's meeting summary keeps, when hosts may
 *     keep their transcripts.
 *     https://developers.zoom.us/docs/api/meetings/#tag/cloud-recording/GET/meetings/{meetingId}/transcript
 *
 * Both take the meeting's number and answer for its latest session. Each
 * has a scope of its own (cloud_recording:read:list_recording_files and
 * cloud_recording:read:meeting_transcript, :admin for a Server-to-Server
 * OAuth app; recording:read covers both), so a connection that has only
 * one still finds a transcript where that one looks, and one with neither
 * is told exactly which to add.
 *
 * A recording's files and a transcript are downloaded with the same token,
 * as a Bearer header, and only from a Zoom host: the link comes back in a
 * response, and the token goes nowhere else.
 */

export interface ZoomTranscriptRequest {
  http: VideoCallHttpClient;
  token: ZoomAccessToken;
  // The meeting's number, as OneUptime stored it when it created the meeting.
  meetingId: string;
  // A person's sign-in to this server's Zoom app, rather than the project's own app.
  isSignIn: boolean;
  // The scopes the sign-in was granted, when Zoom said.
  grantedScope?: string | undefined;
}

// Zoom's codes for "nothing here" and "not allowed", from its error definitions.
const ZOOM_NO_RECORDING_CODES: ReadonlyArray<string> = ["3301", "3001", "3322"];
const ZOOM_MISSING_SCOPES_CODE: string = "4711";
const ZOOM_INVALID_ACCESS_TOKEN_CODE: string = "124";
const ZOOM_MISSING_SCOPES_PATTERN: RegExp = /does not contain scopes/i;

// The recording files a transcript can come from, the better first.
const TRANSCRIPT_FILE_TYPES: ReadonlyArray<string> = ["TRANSCRIPT", "CC"];

// What one of the two places said.
enum LookOutcome {
  Found = "Found",
  NotReady = "NotReady",
  None = "None",
  Deleted = "Deleted",
  MissingScope = "MissingScope",
  // The sign-in or the app's token no longer works: no request can succeed.
  ConnectionProblem = "ConnectionProblem",
}

interface Look {
  outcome: LookOutcome;
  lines?: Array<TranscriptLine> | undefined;
  message?: string | undefined;
}

export default class ZoomTranscriptClient {
  public static async readTranscript(
    request: ZoomTranscriptRequest,
  ): Promise<VideoCallTranscriptRead> {
    const meetingId: string = request.meetingId.trim();

    if (!meetingId) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.NotSupported,
        "OneUptime has no Zoom meeting number for this call, so it cannot ask Zoom for its transcript. Add the transcript yourself.",
      );
    }

    /*
     * A sign-in made before OneUptime could read transcripts was granted
     * neither scope, and asking Zoom would only say so.
     */
    if (
      request.isSignIn &&
      request.grantedScope &&
      !ZoomTranscriptClient.grantsTranscripts(request.grantedScope)
    ) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.PermissionMissing,
        ZoomTranscriptClient.getMissingScopeMessage(request.isSignIn),
      );
    }

    const fromRecording: Look = await ZoomTranscriptClient.lookInRecording({
      ...request,
      meetingId,
    });

    const settled: VideoCallTranscriptRead | null =
      ZoomTranscriptClient.settle(fromRecording);

    if (settled) {
      return settled;
    }

    const fromSummary: Look = await ZoomTranscriptClient.lookInMeetingTranscript(
      { ...request, meetingId },
    );

    const settledBySummary: VideoCallTranscriptRead | null =
      ZoomTranscriptClient.settle(fromSummary);

    if (settledBySummary) {
      return settledBySummary;
    }

    const outcomes: Array<LookOutcome> = [
      fromRecording.outcome,
      fromSummary.outcome,
    ];

    if (outcomes.includes(LookOutcome.NotReady)) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.NotReady,
        "Zoom is still preparing this meeting's transcript. It is usually ready within twice the length of the call. Try again later.",
      );
    }

    if (outcomes.includes(LookOutcome.MissingScope)) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.PermissionMissing,
        ZoomTranscriptClient.getMissingScopeMessage(request.isSignIn),
      );
    }

    if (outcomes.includes(LookOutcome.Deleted)) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.Expired,
        "Zoom deleted this meeting's transcript or moved it to the trash. Restore it in Zoom, or add the transcript yourself.",
      );
    }

    return transcriptUnavailable(
      VideoCallTranscriptUnavailableReason.NotTranscribed,
      "Zoom has no transcript of this meeting. Zoom keeps one when the meeting is recorded to the cloud with Audio transcript on, or when AI Companion's meeting summary is on. You can add the transcript yourself.",
    );
  }

  // Whether a granted scope list can read a transcript in either place.
  public static grantsTranscripts(grantedScope: string): boolean {
    return VideoCallOAuthUtil.hasScope(
      grantedScope,
      (scope: string): boolean => {
        return (
          scope.startsWith("cloud_recording:read") ||
          scope === "recording:read" ||
          scope === ZOOM_CLASSIC_RECORDING_SCOPE
        );
      },
    );
  }

  // A look that answers on its own: the transcript, or a connection that does not work.
  private static settle(look: Look): VideoCallTranscriptRead | null {
    if (look.outcome === LookOutcome.Found && look.lines) {
      return transcriptFound({
        lines: look.lines,
        format: TranscriptSourceFormat.WebVTT,
      });
    }

    if (look.outcome === LookOutcome.ConnectionProblem) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.ConnectionProblem,
        look.message || "Zoom no longer accepts this connection.",
      );
    }

    return null;
  }

  public static getMissingScopeMessage(isSignIn: boolean): string {
    if (isSignIn) {
      return `OneUptime's sign-in to Zoom cannot read transcripts yet. Reconnect Zoom in Project Settings > Workspace > Video Calls and allow it to read recordings and transcripts. If Zoom does not ask, your OneUptime server's Zoom app needs the ${ZOOM_OAUTH_RECORDING_FILES_SCOPE} and ${ZOOM_OAUTH_MEETING_TRANSCRIPT_SCOPE} scopes first.`;
    }

    return `This connection's Zoom app cannot read transcripts. On the app's Scopes page in the Zoom App Marketplace, add ${ZOOM_RECORDING_FILES_SCOPE} and ${ZOOM_MEETING_TRANSCRIPT_SCOPE} (or ${ZOOM_CLASSIC_RECORDING_SCOPE} on an older app).`;
  }

  // The audio transcript among the cloud recording's files.
  private static async lookInRecording(
    request: ZoomTranscriptRequest,
  ): Promise<Look> {
    const response: VideoCallHttpResponse = await request.http.request({
      url: `${request.token.apiBaseUrl}/meetings/${encodeURIComponent(request.meetingId)}/recordings`,
      method: "GET",
      headers: ZoomTranscriptClient.getHeaders(request.token),
      stepLabel: "Zoom recording request",
    });

    if (!response.ok) {
      return ZoomTranscriptClient.readRefusal(response, request);
    }

    const files: JSONArray = Array.isArray(response.json?.["recording_files"])
      ? (response.json!["recording_files"] as JSONArray)
      : [];

    for (const fileType of TRANSCRIPT_FILE_TYPES) {
      const file: JSONObject | undefined = files.find(
        (candidate: JSONValue): boolean => {
          return (
            Boolean(candidate) &&
            typeof candidate === "object" &&
            !Array.isArray(candidate) &&
            (candidate as JSONObject)["file_type"] === fileType
          );
        },
      ) as JSONObject | undefined;

      if (!file) {
        continue;
      }

      if (file["status"] && file["status"] !== "completed") {
        return { outcome: LookOutcome.NotReady };
      }

      const downloadUrl: JSONValue | undefined = file["download_url"];

      if (typeof downloadUrl === "string" && downloadUrl) {
        return await ZoomTranscriptClient.download({
          request,
          downloadUrl,
        });
      }
    }

    /*
     * Recorded, but with no transcript yet: the files are still being
     * processed, and the transcript comes after them.
     */
    const isProcessing: boolean = files.some((candidate: JSONValue): boolean => {
      return (
        Boolean(candidate) &&
        typeof candidate === "object" &&
        !Array.isArray(candidate) &&
        (candidate as JSONObject)["status"] === "processing"
      );
    });

    return { outcome: isProcessing ? LookOutcome.NotReady : LookOutcome.None };
  }

  // The transcript AI Companion's meeting summary keeps.
  private static async lookInMeetingTranscript(
    request: ZoomTranscriptRequest,
  ): Promise<Look> {
    const response: VideoCallHttpResponse = await request.http.request({
      url: `${request.token.apiBaseUrl}/meetings/${encodeURIComponent(request.meetingId)}/transcript`,
      method: "GET",
      headers: ZoomTranscriptClient.getHeaders(request.token),
      stepLabel: "Zoom transcript request",
    });

    if (!response.ok) {
      return ZoomTranscriptClient.readRefusal(response, request);
    }

    const canDownload: JSONValue | undefined = response.json?.["can_download"];
    const downloadUrl: JSONValue | undefined = response.json?.["download_url"];

    if (canDownload === true && typeof downloadUrl === "string" && downloadUrl) {
      return await ZoomTranscriptClient.download({ request, downloadUrl });
    }

    switch (response.json?.["download_restriction_reason"]) {
      case "NOT_READY":
        return { outcome: LookOutcome.NotReady };
      case "DELETED_OR_TRASHED":
        return { outcome: LookOutcome.Deleted };
      default:
        return { outcome: LookOutcome.None };
    }
  }

  private static async download(data: {
    request: ZoomTranscriptRequest;
    downloadUrl: string;
  }): Promise<Look> {
    if (!ZoomMeetingClient.isZoomJoinUrl(data.downloadUrl)) {
      throw new APIException(
        "Zoom answered with a transcript link that is not on a Zoom host, so OneUptime did not download it.",
      );
    }

    const response: VideoCallHttpResponse = await data.request.http.request({
      url: data.downloadUrl,
      method: "GET",
      headers: {
        Authorization: `Bearer ${data.request.token.accessToken}`,
        Accept: "text/vtt, text/plain, */*",
      },
      stepLabel: "Zoom transcript download",
    });

    if (!response.ok) {
      return ZoomTranscriptClient.readRefusal(response, data.request);
    }

    if (response.bodyText.length > MAX_VIDEO_CALL_TRANSCRIPT_INPUT_CHARACTERS) {
      throw new BadDataException(
        "This meeting's transcript is too long to add: more than about eight hours of talk. Download it from Zoom and add the part of the call about the incident.",
      );
    }

    const lines: Array<TranscriptLine> = TranscriptText.parse(
      response.bodyText,
    );

    return lines.length > 0
      ? { outcome: LookOutcome.Found, lines }
      : { outcome: LookOutcome.None };
  }

  /*
   * What a refusal means for the transcript: nothing there, not allowed, or
   * a sign-in or app that no longer works. Zoom limiting requests, or not
   * answering, is no answer at all: that throws.
   */
  private static readRefusal(
    response: VideoCallHttpResponse,
    request: ZoomTranscriptRequest,
  ): Look {
    const errorCode: string = VideoCallHttpClient.readErrorCode(response.json);
    const summary: string = VideoCallHttpClient.summarizeErrorBody(response);

    if (
      errorCode === ZOOM_MISSING_SCOPES_CODE ||
      ZOOM_MISSING_SCOPES_PATTERN.test(summary)
    ) {
      return { outcome: LookOutcome.MissingScope };
    }

    if (
      errorCode === ZOOM_INVALID_ACCESS_TOKEN_CODE ||
      response.status === 401
    ) {
      return {
        outcome: LookOutcome.ConnectionProblem,
        message: request.isSignIn
          ? `Zoom no longer accepts OneUptime's sign-in. Reconnect Zoom in Project Settings > Workspace > Video Calls. (${summary})`
          : `Zoom rejected the access token of this connection's app. Check that the Server-to-Server OAuth app is still activated. (${summary})`,
      };
    }

    if (response.status === 429) {
      throw new APIException(
        `Zoom is limiting requests from this account right now. Try again in a minute. (${summary})`,
      );
    }

    if (response.status === 403) {
      return { outcome: LookOutcome.MissingScope };
    }

    if (
      response.status === 404 ||
      ZOOM_NO_RECORDING_CODES.includes(errorCode)
    ) {
      return { outcome: LookOutcome.None };
    }

    if (response.status >= 400 && response.status < 500) {
      return { outcome: LookOutcome.None };
    }

    throw new APIException(
      `Zoom could not answer for the meeting's transcript (HTTP ${response.status}): ${summary}`,
    );
  }

  private static getHeaders(token: ZoomAccessToken): Record<string, string> {
    return {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: "application/json",
    };
  }
}
