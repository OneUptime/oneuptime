import VideoCallProvider from "./VideoCallProvider";

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
}
