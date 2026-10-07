import WorkspaceType from "../WorkspaceType";

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
 * Why a rule's video call settings cannot be saved, or null when they can.
 * A switched-on call needs a source, and a Slack huddle is held in a Slack
 * channel, so only a Slack rule can ask for one. Whether a connection still
 * exists is the server's to say when the rule fires.
 */
export function getVideoCallValidationError(data: {
  rule: VideoCallNotificationRule | undefined;
  workspaceType: WorkspaceType;
}): string | null {
  if (!data.rule || data.rule.shouldStartVideoCall !== true) {
    return null;
  }

  const source: string = (data.rule.videoCallSource || "").trim();

  if (!source) {
    return "Pick where this rule's video call is held, or turn the video call off.";
  }

  if (
    isSlackHuddleVideoCallSource(source) &&
    data.workspaceType !== WorkspaceType.Slack
  ) {
    return "A Slack huddle can only be started by a Slack notification rule. Pick a Zoom, Google Meet or Microsoft Teams connection instead.";
  }

  return null;
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
