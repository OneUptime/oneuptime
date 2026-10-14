import crypto from "crypto";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import { JSONObject } from "../../../../Types/JSON";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { WorkspaceConversationPerson } from "../WorkspaceConnectPromptOnce";
import { SlackAnswerPlace } from "./Actions/Answer";

/*
 * WHAT OF SLACK'S MESSAGES IS ADDRESSED TO ONEUPTIME.
 *
 * The app hears every message of every channel it is in (message.channels,
 * message.groups, message.mpim), so that somebody talking with OneUptime AI
 * in a thread can reply there without mentioning it each time. It used to
 * answer every reply in any thread that had a bot's message in it - and
 * every notification it posts is such a thread. So people talking to each
 * other under an incident's message were answered by OneUptime, every one
 * of them, every time: "Connect your Slack account" for somebody whose
 * account was not connected, an answer from AI for somebody whose was
 * (#4768).
 *
 * OneUptime answers only what is addressed to it:
 *
 *   - an @mention (app_mention), wherever it is: at the top of a channel,
 *     or in any thread, the one under an incident's message included;
 *   - a direct message to the app (message.im);
 *   - a plain reply in a conversation with OneUptime AI, by somebody in
 *     it. A conversation is the thread under a question somebody asked
 *     OneUptime at the top of a channel. Who asked it is in it, and so is
 *     whoever mentions OneUptime in that thread since, for a week after
 *     their last message there (OPEN_FOR_SECONDS). The thread of one of
 *     OneUptime's own messages - a notification's - never is one: there,
 *     OneUptime is mentioned each time.
 *
 * Anything else is not answered - channel chatter, a reply in the thread of
 * one of OneUptime's own messages, a reply in a conversation somebody else
 * is having with it, a reply that mentions people, a bot's message, an edit
 * - and is dropped before anything is read: read() decides from the event
 * alone, and a reply in a thread costs one read of the cache (isIn), never
 * a read of the database or a request to Slack.
 *
 * Buttons, forms, shortcuts and /oneuptime come to other routes, and are
 * answered every time (SlackActionAnswer).
 */

export enum SlackMessageKind {
  // "@OneUptime ..." in a channel, a private channel or a group DM.
  Mention = "Mention",
  // A message in the app's direct messages.
  DirectMessage = "DirectMessage",
  /*
   * A plain reply in a thread of a channel: a follow-up in a conversation
   * with OneUptime AI only if its author is in one there (isIn).
   */
  ThreadReply = "ThreadReply",
  // Not for OneUptime: never answered.
  NotAddressed = "NotAddressed",
}

// A message event, as OneUptime reads it.
export interface SlackMessage {
  kind: SlackMessageKind;
  teamId: string;
  channelId: string;
  // Who wrote it: a Slack user id.
  userId: string;
  text: string;
  ts: string;
  /*
   * The thread it is a reply in: the ts of the thread's first message. Not
   * set for a message at the top of a channel, or of a direct message.
   */
  threadTs?: string | undefined;
  // Why a message is not addressed to OneUptime, for the debug log.
  reason?: string | undefined;
}

// A message of a thread, as conversations.replies returns it.
export interface SlackThreadMessage {
  user?: string | undefined;
  bot_id?: string | undefined;
  text?: string | undefined;
  ts?: string | undefined;
  subtype?: string | undefined;
}

// A thread of a channel: the ts of its first message.
export interface SlackThread {
  teamId: string;
  channelId: string;
  threadTs: string;
}

// A thread of a channel, and somebody writing in it.
export interface SlackThreadPerson extends SlackThread {
  userId: string;
}

/*
 * Somebody mentioned: a person (<@U0123>, <@U0123|name>), a user group
 * (<!subteam^S0123>) or everybody (<!here>, <!channel>, <!everyone>).
 *
 * A label ends at the next "<" or ">": Slack writes those characters of a
 * message's own text as &lt; and &gt;, so a label never holds one. A label
 * that ran on to the next ">" was tried from every unclosed "<@U0|" to the
 * end of the message, in time that grows with the square of its length.
 */
const MENTION_PATTERN: RegExp =
  /<@[A-Z0-9]+(?:\|[^<>]*)?>|<!(?:here|channel|everyone|subteam\^[A-Z0-9]+)(?:\|[^<>]*)?>/;

const CHANNEL_TYPES: Array<string> = ["channel", "group", "mpim"];

// Who is in which conversation.
const NAMESPACE: string = "slack-ai-conversation";
// Which threads are conversations.
const THREAD_NAMESPACE: string = "slack-ai-conversation-thread";

export default class SlackAiConversations {
  // A week after somebody's last message in it, a conversation is closed to them.
  public static readonly OPEN_FOR_SECONDS: number = 7 * 24 * 60 * 60;

  /*
   * What a Slack event is to OneUptime, from the event alone: null for an
   * event that is not a message or an @mention.
   */
  public static read(payload: JSONObject): SlackMessage | null {
    const event: unknown = payload["event"];

    if (!event || typeof event !== "object" || Array.isArray(event)) {
      return null;
    }

    const fields: JSONObject = event as JSONObject;
    const type: unknown = fields["type"];
    const channelType: unknown = fields["channel_type"];

    let kind: SlackMessageKind;

    if (type === "app_mention") {
      kind = SlackMessageKind.Mention;
    } else if (type === "message" && channelType === "im") {
      kind = SlackMessageKind.DirectMessage;
    } else if (
      type === "message" &&
      typeof channelType === "string" &&
      CHANNEL_TYPES.includes(channelType)
    ) {
      kind = SlackMessageKind.ThreadReply;
    } else {
      return null;
    }

    const message: SlackMessage = {
      kind: kind,
      teamId: SlackAiConversations.textOf(payload["team_id"]),
      channelId: SlackAiConversations.textOf(fields["channel"]),
      userId: SlackAiConversations.textOf(fields["user"]),
      text: SlackAiConversations.textOf(fields["text"]),
      ts: SlackAiConversations.textOf(fields["ts"]),
    };

    const threadTs: string = SlackAiConversations.textOf(fields["thread_ts"]);

    // A thread's first message carries its own ts as the thread's.
    if (threadTs && threadTs !== message.ts) {
      message.threadTs = threadTs;
    }

    /*
     * Never a bot's - OneUptime's own included, or it would answer itself
     * forever - and never an edit, a deletion, a join or another subtype.
     */
    if (fields["bot_id"] || fields["subtype"]) {
      return SlackAiConversations.notAddressed(
        message,
        "a bot's message, or a change to a channel or a message",
      );
    }

    if (!message.teamId || !message.channelId || !message.userId) {
      return SlackAiConversations.notAddressed(
        message,
        "no workspace, channel or author",
      );
    }

    if (kind !== SlackMessageKind.ThreadReply) {
      return message;
    }

    /*
     * A mention of OneUptime comes as an @mention too (app_mention), which
     * is answered; a mention of people is addressed to them.
     */
    if (MENTION_PATTERN.test(message.text)) {
      return SlackAiConversations.notAddressed(
        message,
        "a message that mentions somebody",
      );
    }

    if (!message.threadTs) {
      return SlackAiConversations.notAddressed(
        message,
        "a message at the top of a channel that mentions nobody",
      );
    }

    return message;
  }

  /*
   * The thread an answer to a message goes in: the one it is a reply in, or
   * the one it starts.
   */
  public static getThreadTs(message: SlackMessage): string {
    return message.threadTs || message.ts;
  }

  /*
   * The conversation a message is part of, for its one Connect prompt
   * (WorkspaceConnectPromptOnce): a thread of a channel, or the whole of a
   * direct message.
   */
  public static getConversation(
    message: SlackMessage,
  ): WorkspaceConversationPerson {
    return {
      workspaceType: WorkspaceType.Slack,
      workspaceId: message.teamId,
      conversationId:
        message.kind === SlackMessageKind.DirectMessage
          ? message.channelId
          : `${message.channelId}:${SlackAiConversations.getThreadTs(message)}`,
      workspaceUserId: message.userId,
    };
  }

  /*
   * Where somebody not connected yet is asked to connect, so they see it:
   *
   *   - in a thread: in the thread, a message only they see;
   *   - at the top of a channel: under their question in the channel, a
   *     message only they see - Slack shows such a message in a thread
   *     only once the thread has replies, and their question has none;
   *   - in a direct message: as a message of the app's own there, which
   *     stays, where a message only they see would be gone once Slack
   *     reloads. The place names no channel to answer in, only the direct
   *     messages to come back to once connected.
   */
  public static getConnectPromptPlace(data: {
    message: SlackMessage;
    projectAuthToken: string;
  }): SlackAnswerPlace {
    const place: SlackAnswerPlace = {
      projectAuthToken: data.projectAuthToken,
      slackUserId: data.message.userId,
    };

    if (data.message.kind === SlackMessageKind.DirectMessage) {
      place.slackDirectMessageChannelId = data.message.channelId;

      return place;
    }

    place.slackChannelId = data.message.channelId;

    if (data.message.threadTs) {
      place.slackThreadTs = data.message.threadTs;
    }

    return place;
  }

  /*
   * Whether somebody is in a conversation with OneUptime AI in a thread: a
   * plain reply of theirs there is for OneUptime. Never throws: a cache
   * that cannot be read answers no, and the reply is not answered.
   */
  @CaptureSpan()
  public static async isIn(person: SlackThreadPerson): Promise<boolean> {
    return await SlackAiConversations.isKept(
      NAMESPACE,
      SlackAiConversations.getKey(person),
    );
  }

  /*
   * Whether a thread is a conversation with OneUptime AI, as remembered: an
   * @mention there puts its author in it. Never throws: a cache that cannot
   * be read answers no.
   */
  @CaptureSpan()
  public static async isConversation(thread: SlackThread): Promise<boolean> {
    return await SlackAiConversations.isKept(
      THREAD_NAMESPACE,
      SlackAiConversations.getThreadKey(thread),
    );
  }

  /*
   * Remembers a thread as a conversation with OneUptime AI, and somebody as
   * in it, for a week from now: who asks a question at the top of a
   * channel, who mentions OneUptime in that thread since, and again with
   * each follow-up. Never throws: without it, they mention OneUptime to ask
   * again.
   */
  @CaptureSpan()
  public static async remember(person: SlackThreadPerson): Promise<void> {
    try {
      await GlobalCache.setString(
        THREAD_NAMESPACE,
        SlackAiConversations.getThreadKey(person),
        "1",
        { expiresInSeconds: SlackAiConversations.OPEN_FOR_SECONDS },
      );
      await GlobalCache.setString(
        NAMESPACE,
        SlackAiConversations.getKey(person),
        "1",
        { expiresInSeconds: SlackAiConversations.OPEN_FOR_SECONDS },
      );
    } catch (err) {
      logger.debug(
        "Could not remember a conversation with OneUptime AI in a Slack thread.",
      );
      logger.debug(err);
    }
  }

  /*
   * Whether a thread is a conversation with OneUptime AI: its first message
   * is a person's, and mentions OneUptime - a question somebody asked it at
   * the top of a channel. The thread of one of OneUptime's own messages, a
   * notification's, never is. `messages` are the thread's, as
   * conversations.replies returns them, its first message first.
   */
  public static isStartedByAQuestion(data: {
    threadTs: string;
    messages: Array<SlackThreadMessage>;
    botUserId: string | undefined;
  }): boolean {
    if (!data.botUserId) {
      return false;
    }

    const first: SlackThreadMessage | undefined = data.messages.find(
      (message: SlackThreadMessage): boolean => {
        return message.ts === data.threadTs;
      },
    );

    if (
      !first ||
      first.bot_id ||
      first.subtype ||
      !first.user ||
      first.user === data.botUserId
    ) {
      return false;
    }

    const text: string = first.text || "";

    return (
      text.indexOf(`<@${data.botUserId}>`) !== -1 ||
      text.indexOf(`<@${data.botUserId}|`) !== -1
    );
  }

  private static async isKept(
    namespace: string,
    key: string,
  ): Promise<boolean> {
    try {
      return Boolean(await GlobalCache.getString(namespace, key));
    } catch (err) {
      logger.debug(
        "Could not read whether a Slack thread is a conversation with OneUptime AI; its reply is not answered.",
      );
      logger.debug(err);
      return false;
    }
  }

  // Who, in which thread: a digest, so a read of the cache names nobody.
  private static getKey(person: SlackThreadPerson): string {
    return SlackAiConversations.digest([
      person.teamId,
      person.channelId,
      person.threadTs,
      person.userId,
    ]);
  }

  private static getThreadKey(thread: SlackThread): string {
    return SlackAiConversations.digest([
      thread.teamId,
      thread.channelId,
      thread.threadTs,
    ]);
  }

  private static digest(parts: Array<string>): string {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(parts))
      .digest("hex");
  }

  private static notAddressed(
    message: SlackMessage,
    reason: string,
  ): SlackMessage {
    return { ...message, kind: SlackMessageKind.NotAddressed, reason: reason };
  }

  private static textOf(value: unknown): string {
    return typeof value === "string" ? value : "";
  }
}
