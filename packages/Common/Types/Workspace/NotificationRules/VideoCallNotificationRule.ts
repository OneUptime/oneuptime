/*
 * The rule's video call: when an incident or alert rule fires, start one
 * call for the event and post its link wherever the event's updates go -
 * the channel the rule creates, the existing channels and the Microsoft
 * Teams chats it posts to.
 *
 * videoCallSource is either SLACK_HUDDLE_VIDEO_CALL_SOURCE - the huddle of
 * the Slack channel the rule creates or posts to - or the id of one of the
 * project's VideoCallConnections (Zoom, Google Meet, Microsoft Teams or a
 * standing meeting link).
 */
export const SLACK_HUDDLE_VIDEO_CALL_SOURCE: string = "SlackHuddle";

export default interface VideoCallNotificationRule {
  shouldStartVideoCall?: boolean | undefined;
  videoCallSource?: string | undefined;
}

export function isSlackHuddleVideoCallSource(
  videoCallSource: string | undefined,
): boolean {
  return videoCallSource === SLACK_HUDDLE_VIDEO_CALL_SOURCE;
}

/*
 * The source a rule asks for, or null when the rule starts no call: the
 * switch is off, or no source was picked.
 */
export function getRequestedVideoCallSource(
  rule: VideoCallNotificationRule | undefined,
): string | null {
  if (!rule || rule.shouldStartVideoCall !== true) {
    return null;
  }

  const source: string = (rule.videoCallSource || "").trim();

  return source || null;
}
