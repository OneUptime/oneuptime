import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SavedChatMessage from "../../../../Types/Workspace/SavedChatMessage";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { ChatMessageContent } from "../../../../Utils/Markdown/ChatMessageMarkdown";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import SavedChatMessageAuthor from "../SavedChatMessageAuthor";
import { WorkspaceChannel } from "../WorkspaceBase";
import SlackUtil from "./Slack";
import SlackMessageReader, {
  SLACK_MESSAGE_MAX_LOOKUPS,
  SlackMessageAuthor,
  SlackMessageNames,
  SlackMessageReferences,
} from "./SlackMessageReader";

/*
 * A SLACK MESSAGE TO SAVE AS A NOTE, READ FROM SLACK.
 *
 * The message a pin or a note emoji is on, as SlackMessageReader reads it,
 * with the names it needs looked up in Slack: who wrote it, the people and
 * channels it mentions. And where its words came from (SavedChatMessage):
 * its author - their OneUptime member when their Slack account is
 * connected - and when it was posted, its ts.
 */

export interface SlackMessageToSave {
  content: ChatMessageContent;
  savedFromChatMessage: SavedChatMessage;
  // The thread the message is in: its parent's ts; null for no thread.
  threadTs: string | null;
}

// At most this many channels' names are looked up for one message.
const MAX_CHANNEL_LOOKUPS: number = 10;

export default class SlackSavedMessage {
  /*
   * The message at `messageTs` in the channel, read for a note. Null when
   * Slack has no such message. Throws when Slack cannot be read.
   */
  @CaptureSpan()
  public static async read(data: {
    authToken: string;
    projectId: ObjectID;
    channelId: string;
    messageTs: string;
  }): Promise<SlackMessageToSave | null> {
    const message: JSONObject | null = await SlackUtil.getMessage({
      authToken: data.authToken,
      channelId: data.channelId,
      messageTs: data.messageTs,
    });

    if (!message) {
      return null;
    }

    const author: SlackMessageAuthor = SlackMessageReader.getAuthor(message);
    const references: SlackMessageReferences =
      SlackMessageReader.getReferences(message);

    const userIds: Array<string> = [...references.userIds];

    if (author.slackUserId && !userIds.includes(author.slackUserId)) {
      userIds.unshift(author.slackUserId);
    }

    const names: SlackMessageNames = {
      users: await SlackSavedMessage.getUserNames({
        authToken: data.authToken,
        userIds: userIds.slice(0, SLACK_MESSAGE_MAX_LOOKUPS),
      }),
      channels: await SlackSavedMessage.getChannelNames({
        authToken: data.authToken,
        channelIds: references.channelIds.slice(0, MAX_CHANNEL_LOOKUPS),
      }),
      // Reading user groups needs a scope OneUptime does not ask for.
      userGroups: new Map<string, string>(),
    };

    const savedFromChatMessage: SavedChatMessage =
      await SavedChatMessageAuthor.getSavedChatMessage({
        workspaceType: WorkspaceType.Slack,
        projectId: data.projectId,
        workspaceUserId: author.slackUserId,
        chatName:
          (author.slackUserId && names.users.get(author.slackUserId)) ||
          author.botName,
        postedAt: SlackMessageReader.getPostedAt(message),
      });

    const threadTs: string =
      typeof message["thread_ts"] === "string" ? message["thread_ts"] : "";

    return {
      content: SlackMessageReader.read(message, names),
      savedFromChatMessage: savedFromChatMessage,
      threadTs: threadTs || null,
    };
  }

  // The names Slack shows for these people; anybody not found is left out.
  private static async getUserNames(data: {
    authToken: string;
    userIds: Array<string>;
  }): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();

    for (const userId of data.userIds) {
      try {
        const user: { name: string; isBot: boolean } | null =
          await SlackUtil.getUserDisplayName({
            authToken: data.authToken,
            userId: userId,
          });

        if (user) {
          names.set(userId, user.name);
        }
      } catch (err) {
        logger.debug("Could not read a Slack user's name for a note.");
        logger.debug(err);
      }
    }

    return names;
  }

  // These channels' names; a channel OneUptime cannot see is left out.
  private static async getChannelNames(data: {
    authToken: string;
    channelIds: Array<string>;
  }): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();

    for (const channelId of data.channelIds) {
      try {
        const channel: WorkspaceChannel =
          await SlackUtil.getWorkspaceChannelFromChannelId({
            authToken: data.authToken,
            channelId: channelId,
          });

        if (channel.name) {
          names.set(channelId, channel.name);
        }
      } catch (err) {
        logger.debug("Could not read a Slack channel's name for a note.");
        logger.debug(err);
      }
    }

    return names;
  }
}
