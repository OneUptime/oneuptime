/*
 * What a provider is asked to create: a meeting named for the incident or
 * alert it is for. Providers use what they can - Zoom takes a topic and an
 * agenda, Microsoft Teams a subject, a Google Meet space has no name at all.
 */
export interface VideoCallMeetingRequest {
  // "INC-42: Checkout API is down"
  title: string;
  // Plain text: what the meeting is for and where to read about it.
  description?: string | undefined;
  // Defaults to now.
  startTime?: Date | undefined;
  /*
   * Record and transcribe the meeting from its start, where the provider
   * lets an app ask for it: Zoom records it to the cloud (whose audio
   * transcript the Zoom account's own recording settings decide), Google
   * Meet transcribes it. Microsoft Teams and meeting links are created as
   * they always are. Asked for an incident's call while the project's
   * Record and transcribe incident calls is on.
   */
  recordAndTranscribe?: boolean | undefined;
}
