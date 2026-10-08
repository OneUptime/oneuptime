import URL from "../../../Types/API/URL";
import VideoCallProvider, {
  getVideoCallNoun,
} from "../../../Types/VideoCall/VideoCallProvider";
import {
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import { MessageBlocksByWorkspaceType } from "../../Services/WorkspaceNotificationRuleService";
import SlackActionType from "../Workspace/Slack/Actions/ActionTypes";

/*
 * What a started call says, wherever the incident's or alert's updates go:
 * its feed item - Markdown the dashboard renders and posts to the event's
 * Slack and Microsoft Teams channels and chats - and the Join call button
 * appended to that message in Slack and Teams.
 *
 * Every name or title here is text a person typed (a rule, a connection, a
 * pasted call's title), so each one is placed as text (mdText), which
 * escapes it for where it goes: prose, or a link's own words. A join link is
 * placed as a link's address, where the characters that would end it early
 * are encoded.
 */

export interface VideoCallAnnouncement {
  // "Incident" or "Alert"
  eventNoun: string;
  // "INC-42", "#42"
  eventNumberDisplay: string;
  // The event's page in the dashboard.
  eventLink: string;
  provider: VideoCallProvider;
  joinUrl: string;
  // A title a person gave the call: a pasted link's "War room".
  title?: string | undefined;
  // The connection that started it: "Incident Zoom".
  connectionName?: string | undefined;
  // The notification rule that started it.
  ruleName?: string | undefined;
  /*
   * Whether a person started it. The feed item then carries that person,
   * whom the dashboard and the Slack message name in front of the text, so
   * the text reads on from their name: "started a Zoom meeting".
   */
  startedByPerson: boolean;
}

export default class VideoCallMessages {
  public static getJoinButtonTitle(provider: VideoCallProvider): string {
    return provider === VideoCallProvider.SlackHuddle
      ? "🎧 Join huddle"
      : "📞 Join call";
  }

  /*
   * What the call is, as the noun of a sentence: "**Zoom meeting**", the
   * connection's name for a standing link ("**Incident bridge** call"), or
   * a pasted link's title.
   */
  public static describeCall(
    announcement: VideoCallAnnouncement,
  ): MarkdownText {
    if (announcement.provider === VideoCallProvider.CustomLink) {
      if (announcement.title) {
        return mdText`**${announcement.title}** video call`;
      }

      if (announcement.connectionName) {
        return mdText`**${announcement.connectionName}** video call`;
      }

      return mdText`**video call**`;
    }

    return mdText`**${getVideoCallNoun(announcement.provider)}**`;
  }

  /*
   * The feed item: one line saying which call for which event, then the
   * link itself, so the call can be joined from the dashboard's feed and
   * from any chat that does not show the button.
   */
  public static getStartedFeedMarkdown(
    announcement: VideoCallAnnouncement,
  ): MarkdownText {
    const eventReference: MarkdownText = mdText`[${announcement.eventNoun} ${announcement.eventNumberDisplay}](${announcement.eventLink})`;
    const call: MarkdownText = VideoCallMessages.describeCall(announcement);
    const joinLinkWords: string =
      announcement.provider === VideoCallProvider.SlackHuddle
        ? "Join the huddle"
        : "Join the call";

    let sentence: MarkdownText;

    if (announcement.provider === VideoCallProvider.SlackHuddle) {
      sentence = announcement.startedByPerson
        ? mdText`🎧 opened the ${call} of ${eventReference}'s Slack channel. Opening the link starts the huddle, or joins it when it is running.`
        : mdText`🎧 The ${call} of ${eventReference}'s Slack channel is ready. Opening the link starts the huddle, or joins it when it is running.`;
    } else if (announcement.startedByPerson) {
      sentence =
        announcement.provider === VideoCallProvider.CustomLink
          ? mdText`📞 added a ${call} to ${eventReference}.`
          : mdText`📞 started a ${call} for ${eventReference}.`;
    } else {
      sentence =
        announcement.provider === VideoCallProvider.CustomLink
          ? mdText`📞 A ${call} was added to ${eventReference}.`
          : mdText`📞 A ${call} was started for ${eventReference}.`;
    }

    return mdText`${sentence}

**[${joinLinkWords}](${announcement.joinUrl})**`;
  }

  /*
   * Said in the dashboard's feed only, beside the item: which rule started
   * the call. The channels the call is posted to need no account of the
   * project's rules.
   */
  public static getStartedFeedMoreInformationMarkdown(
    announcement: VideoCallAnnouncement,
  ): MarkdownText | undefined {
    const parts: Array<MarkdownText> = [];

    if (announcement.ruleName) {
      parts.push(
        mdText`Started by the **${announcement.ruleName}** workspace notification rule.`,
      );
    }

    if (
      announcement.connectionName &&
      announcement.provider !== VideoCallProvider.CustomLink
    ) {
      parts.push(
        mdText`Created with the **${announcement.connectionName}** video call connection.`,
      );
    }

    return parts.length > 0 ? FeedMarkdown.join(parts, "\n\n") : undefined;
  }

  /*
   * A rule's call that could not be started. The reason is the provider's
   * own words or OneUptime's, already redacted; it is still text, so it is
   * placed as text like any other.
   */
  public static getFailedFeedMarkdown(data: {
    eventNoun: string;
    ruleName: string;
    error: string;
  }): MarkdownText {
    const rule: MarkdownText = data.ruleName
      ? mdText`the **${data.ruleName}** workspace notification rule`
      : mdText`a workspace notification rule`;

    return mdText`⚠️ The video call ${rule} asks for could not be started. Start one from this ${data.eventNoun.toLowerCase()}'s page instead.

${data.error}`;
  }

  // The Join call button, for each workspace the message is posted to.
  public static getJoinButtonBlocks(data: {
    provider: VideoCallProvider;
    joinUrl: string;
  }): Array<MessageBlocksByWorkspaceType> {
    const button: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: VideoCallMessages.getJoinButtonTitle(data.provider),
      url: URL.fromString(data.joinUrl.trim()),
      value: "",
      actionId: SlackActionType.JoinVideoCall,
    };

    const buttons: WorkspacePayloadButtons = {
      _type: "WorkspacePayloadButtons",
      buttons: [button],
    };

    return [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams].map(
      (workspaceType: WorkspaceType): MessageBlocksByWorkspaceType => {
        return {
          workspaceType: workspaceType,
          messageBlocks: [buttons],
        };
      },
    );
  }

  /*
   * What a provider is asked to name the meeting: the event's number and
   * title, as plain text (a meeting title is not Markdown), and a pointer
   * back to the event for the meeting's description.
   */
  public static getMeetingRequestText(data: {
    eventNoun: string;
    eventNumberDisplay: string;
    eventTitle: string | undefined;
    eventLink: string;
  }): { title: string; description: string } {
    const eventTitle: string = (data.eventTitle || "")
      .replace(/\s+/g, " ")
      .trim();

    return {
      title: eventTitle
        ? `${data.eventNumberDisplay}: ${eventTitle}`
        : `${data.eventNoun} ${data.eventNumberDisplay}`,
      description: `Video call for ${data.eventNoun.toLowerCase()} ${data.eventNumberDisplay}, started by OneUptime. ${data.eventNoun} details: ${data.eventLink}`,
    };
  }
}
