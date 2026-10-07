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
}
