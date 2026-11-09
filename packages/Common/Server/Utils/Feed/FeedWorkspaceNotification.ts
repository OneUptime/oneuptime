import ObjectID from "../../../Types/ObjectID";
import SavedChatMessage from "../../../Types/Workspace/SavedChatMessage";
import {
  MessageBlocksByWorkspaceType,
  WorkspaceChannelToSkip,
} from "../../Services/WorkspaceNotificationRuleService";
import { FeedApiKeyActor, UNNAMED_API_KEY_NAME } from "./FeedApiKeyActor";

/*
 * HOW A FEED ENTRY IS POSTED TO SLACK AND MICROSOFT TEAMS: the
 * `workspaceNotification` every feed service's create...FeedItem takes
 * (incidents, alerts, their episodes, scheduled maintenance, monitors and
 * on-call policies).
 *
 * WHO THE MESSAGE OPENS WITH IS THE ENTRY'S OWN AUTHOR, OR NOBODY.
 *
 * The Dashboard's feed puts the entry's author - the person who made the
 * change (its userId), or the project API key that did when no person did
 * - in front of a sentence written to follow a name: "Valeria added Deane
 * Looi as Responder to Incident INC-18". The message in Slack and Teams
 * opens with the same author: their name in that workspace when they
 * connected their account there, their OneUptime name otherwise
 * (WorkspaceUtil.getMessageBlocksByMarkdown).
 *
 * There is no way to name anybody else there. The message used to take a
 * person of its own (notifyUserId), and the role and owner entries handed
 * it the person they were about rather than the one who acted: a channel
 * read "Deane Looi Added Deane Looi as Responder to Incident INC-18" after
 * somebody else added Deane in the Dashboard, while the feed named the
 * right person.
 */
export interface FeedWorkspaceNotification {
  sendWorkspaceNotification: boolean;
  /*
   * Whether the message opens with the entry's author: for an entry
   * written to follow a name ("Added ...", "posted private note ...").
   * Without it the message is posted as the entry reads - a record's
   * created message opens with a heading, which a name in front of it
   * would break. A note saved from a chat message never opens with a name:
   * it names its people itself (savedFromChatMessage).
   */
  leadWithAuthor?: boolean | undefined;
  appendMessageBlocks?: Array<MessageBlocksByWorkspaceType> | undefined;
  // Not posted in this channel: the note came from a message there.
  exceptChannel?: WorkspaceChannelToSkip | undefined;
  /*
   * What the post's phone or desktop notification says, when the start of
   * the post does not say enough (WorkspacePayload text).
   */
  notificationText?: string | undefined;
  /*
   * Where a rule keeps the record's messages in one thread
   * (WorkspaceRecordThreads): the record's created message, which starts
   * the thread. Set by the feed service from the entry's event type.
   */
  startsRecordThread?: boolean | undefined;
  // ... and one shown in the channel too: a state change.
  alsoSendToChannel?: boolean | undefined;
}

/*
 * Who a message opens with, as WorkspaceNotificationRuleService's
 * sendWorkspaceMarkdownNotification takes it: a person, or the API key
 * that made the change. Empty for a message that opens with no name.
 */
export interface FeedWorkspaceAuthor {
  authorUserId?: ObjectID | undefined;
  authorApiKeyName?: string | undefined;
}

export default class FeedWorkspaceNotificationUtil {
  /*
   * Whether an entry names who made its change - a person (its userId), or
   * the project API key (incident entries keep one) - as the Dashboard's
   * feed shows it and its message opens with. Such an entry is written to
   * follow their name: "✏️ Updated Incident INC-18." reads "Valeria
   * Mustafaeva updated Incident INC-18." in the feed and "✏️ Valeria
   * Mustafaeva updated Incident INC-18." in the channel.
   */
  public static hasAuthor(data: {
    userId?: ObjectID | null | undefined;
    apiKeyActor?: FeedApiKeyActor | undefined;
  }): boolean {
    return Boolean(data.userId) || Boolean(data.apiKeyActor?.apiKeyId);
  }

  /*
   * The author a feed entry's message opens with: the entry's own userId,
   * else the API key that made the change (incident entries keep one), else
   * nobody - and nobody at all unless the entry asks for it, or when it is
   * a note saved from a chat message.
   */
  public static getAuthor(data: {
    workspaceNotification: FeedWorkspaceNotification;
    // The entry's author: the person who made the change.
    userId?: ObjectID | undefined;
    // The project API key that made it, when no person did.
    apiKeyActor?: FeedApiKeyActor | undefined;
    savedFromChatMessage?: SavedChatMessage | undefined;
  }): FeedWorkspaceAuthor {
    if (
      !data.workspaceNotification.leadWithAuthor ||
      data.savedFromChatMessage
    ) {
      return {};
    }

    if (data.userId) {
      return { authorUserId: data.userId };
    }

    if (data.apiKeyActor?.apiKeyId) {
      return {
        authorApiKeyName:
          (data.apiKeyActor.apiKeyName || "").trim() || UNNAMED_API_KEY_NAME,
      };
    }

    return {};
  }

  /*
   * The workspace half of sendWorkspaceMarkdownNotification's input: the
   * entry's options, with the author it opens with.
   */
  public static toWorkspaceNotification(data: {
    workspaceNotification: FeedWorkspaceNotification;
    author?: FeedWorkspaceAuthor | undefined;
  }): {
    sendWorkspaceNotification: boolean;
    appendMessageBlocks?: Array<MessageBlocksByWorkspaceType> | undefined;
    exceptChannel?: WorkspaceChannelToSkip | undefined;
    authorUserId?: ObjectID | undefined;
    authorApiKeyName?: string | undefined;
    startsRecordThread?: boolean | undefined;
    alsoSendToChannel?: boolean | undefined;
  } {
    return {
      sendWorkspaceNotification:
        data.workspaceNotification.sendWorkspaceNotification,
      appendMessageBlocks: data.workspaceNotification.appendMessageBlocks,
      exceptChannel: data.workspaceNotification.exceptChannel,
      authorUserId: data.author?.authorUserId,
      authorApiKeyName: data.author?.authorApiKeyName,
      startsRecordThread: data.workspaceNotification.startsRecordThread,
      alsoSendToChannel: data.workspaceNotification.alsoSendToChannel,
    };
  }
}
