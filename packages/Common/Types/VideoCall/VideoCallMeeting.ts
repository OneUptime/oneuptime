import VideoCallProvider from "./VideoCallProvider";
import { VideoCallTranscriptUnavailableReason } from "./VideoCallTranscript";

/*
 * Why a meeting the provider was asked to record and transcribe
 * (VideoCallMeetingRequest.recordAndTranscribe) is not: the meeting was
 * started all the same, without it.
 */
export interface VideoCallMeetingNotRecorded {
  // What the call's transcript stops at: the Video Call card says it.
  reason: VideoCallTranscriptUnavailableReason;
  // What the provider answered, for the log.
  message: string;
}

/*
 * A meeting a provider created, or a link that stands for one: what a
 * responder opens to join the call, and the provider's own id for it where
 * there is one (a Zoom meeting id, a Google Meet space name, a Microsoft
 * Teams online meeting id) so the meeting can be found again on the
 * provider's side.
 */
export default interface VideoCallMeeting {
  provider: VideoCallProvider;
  joinUrl: string;
  externalMeetingId?: string | undefined;
  /*
   * The calendar event the meeting belongs to: a Microsoft Teams meeting
   * OneUptime put on its organizer's calendar, as it does to record and
   * transcribe it - Microsoft Graph lets apps read the transcripts only of
   * meetings on a calendar.
   */
  externalCalendarEventId?: string | undefined;
  // Set when the meeting was asked to be recorded and transcribed, and is not.
  notRecorded?: VideoCallMeetingNotRecorded | undefined;
}
