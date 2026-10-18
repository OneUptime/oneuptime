import VideoCallProvider from "./VideoCallProvider";

/*
 * THE TRANSCRIPT OF AN INCIDENT CALL (issue #4875).
 *
 * What responders say on an incident's call - what they checked, what they
 * suspect, what they decided - is the best record of how the incident was
 * worked, and it is gone when the call ends. A call can keep its
 * transcript: read from the provider where the provider lets an app read
 * it, or added by a person, as a file their meeting tool saved or as text.
 * OneUptime AI then reads it and suggests what the call says about the
 * cause, for a person to accept or dismiss (CallSummary).
 *
 * Shared by the server (the transcript routes, the provider clients, the
 * AI's reading) and the dashboard (the Video Call card, the transcript
 * dialogs), so both say the same about which calls can be read and what a
 * transcript may hold.
 */

// Where a call's transcript came from.
export enum VideoCallTranscriptSource {
  // Read from Zoom or Google Meet with the call's own connection.
  Provider = "Provider",
  // A file or text a person (or an API key) added.
  Upload = "Upload",
}

export function isVideoCallTranscriptSource(
  value: unknown,
): value is VideoCallTranscriptSource {
  return (
    value === VideoCallTranscriptSource.Provider ||
    value === VideoCallTranscriptSource.Upload
  );
}

/*
 * How much a stored transcript may hold, written as OneUptime stores it
 * (one remark a line): about eight hours of talk. A longer call is not an
 * incident call anyone reads back; a person can add the part that matters.
 */
export const MAX_VIDEO_CALL_TRANSCRIPT_CHARACTERS: number = 400_000;

/*
 * How much text may be sent to be read: a WebVTT or SRT file carries its
 * timings and cue numbers too, about twice the words.
 */
export const MAX_VIDEO_CALL_TRANSCRIPT_INPUT_CHARACTERS: number = 2_000_000;

// The most remarks a transcript keeps.
export const MAX_VIDEO_CALL_TRANSCRIPT_LINES: number = 20_000;

// The file types the Add transcript dialog takes.
export const VIDEO_CALL_TRANSCRIPT_FILE_EXTENSIONS: ReadonlyArray<string> = [
  ".vtt",
  ".srt",
  ".txt",
];

/*
 * What the dashboard shows about a transcript without reading it all: kept
 * beside it, so the list of a page's calls never carries the text itself.
 */
export interface VideoCallTranscriptInfo {
  lineCount: number;
  speakerCount: number;
  characterCount: number;
  // From the first remark to the last, when the transcript has times.
  durationInSeconds?: number | undefined;
  // The name of the file a person added it from.
  fileName?: string | undefined;
}

/*
 * Why a call's transcript could not be read from its provider. None of
 * these is a failure of OneUptime's: each says what the person can do.
 */
export enum VideoCallTranscriptUnavailableReason {
  // The provider is still writing it: try again in a few minutes.
  NotReady = "NotReady",
  // Nobody turned on transcription (or recording) in the call.
  NotTranscribed = "NotTranscribed",
  // Nobody has joined the meeting yet, or it never started.
  NoMeeting = "NoMeeting",
  // The provider deleted it, or no longer keeps it.
  Expired = "Expired",
  // The connection is not allowed to read transcripts yet.
  PermissionMissing = "PermissionMissing",
  // The connection's sign-in or credentials stopped working.
  ConnectionProblem = "ConnectionProblem",
  // The provider has no way for an app to read this call's transcript.
  NotSupported = "NotSupported",
}

export interface VideoCallTranscriptUnavailable {
  reason: VideoCallTranscriptUnavailableReason;
  // What happened and what to do, in English, for the person who asked.
  message: string;
}

/*
 * Whether the call's transcript can be read from its provider: a Zoom or
 * Google Meet meeting OneUptime created with one of the project's
 * connections. Microsoft Graph has no transcripts for meetings created the
 * way OneUptime creates them (an online meeting with no calendar event), a
 * Slack huddle has no API at all, and a link of one's own is a meeting
 * OneUptime knows nothing about: their transcripts are added by a person.
 */
export function canReadVideoCallTranscriptFromProvider(call: {
  provider?: VideoCallProvider | string | undefined | null;
  videoCallConnectionId?: unknown;
  externalMeetingId?: string | undefined | null;
}): boolean {
  return (
    (call.provider === VideoCallProvider.Zoom ||
      call.provider === VideoCallProvider.GoogleMeet) &&
    Boolean(call.videoCallConnectionId) &&
    Boolean(call.externalMeetingId)
  );
}
