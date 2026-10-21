import BadDataException from "../../../../Types/Exception/BadDataException";
import VideoCallMeeting from "../../../../Types/VideoCall/VideoCallMeeting";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";

/*
 * The call of a Slack channel: its huddle.
 *
 * Slack has no API that starts, joins or schedules a huddle. What it does
 * have is a link for every conversation's huddle - Copy huddle link in the
 * channel header gives https://app.slack.com/huddle/<team id>/<channel id> -
 * and opening that link starts the channel's huddle, or joins it when it
 * is already running. So the incident's huddle is the huddle of the channel
 * the workspace rule created for the incident: everyone the rule invited is
 * already a member, and the call sits beside the incident's thread.
 * https://slack.com/help/articles/4402059015315-Use-huddles-in-Slack
 */

export const SLACK_HUDDLE_BASE_URL: string = "https://app.slack.com/huddle";

/*
 * Slack ids are short upper-case alphanumerics: T0123ABCD for a workspace
 * (E... for an Enterprise Grid org), C... / G... for a channel. Anything
 * else would change the link's path.
 */
const SLACK_ID_REGEX: RegExp = /^[A-Z0-9]{2,64}$/;

export default class SlackHuddleLink {
  public static isSlackId(value: string | undefined): boolean {
    return SLACK_ID_REGEX.test((value || "").trim());
  }

  public static getHuddleUrl(data: {
    teamId: string;
    channelId: string;
  }): string {
    const teamId: string = (data.teamId || "").trim();
    const channelId: string = (data.channelId || "").trim();

    if (!SlackHuddleLink.isSlackId(teamId)) {
      throw new BadDataException(
        "The Slack workspace id is missing or malformed, so the huddle link cannot be built. Reconnect Slack in Project Settings.",
      );
    }

    if (!SlackHuddleLink.isSlackId(channelId)) {
      throw new BadDataException(
        "The Slack channel id is missing or malformed, so the huddle link cannot be built.",
      );
    }

    return `${SLACK_HUDDLE_BASE_URL}/${teamId}/${channelId}`;
  }

  public static getHuddle(data: {
    teamId: string;
    channelId: string;
  }): VideoCallMeeting {
    return {
      provider: VideoCallProvider.SlackHuddle,
      joinUrl: SlackHuddleLink.getHuddleUrl(data),
      externalMeetingId: data.channelId.trim(),
    };
  }
}
