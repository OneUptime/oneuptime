import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "../../../Models/DatabaseModels/User";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserService from "../../Services/UserService";
import logger from "../Logger";
import SavedChatMessage, {
  SavedChatMessageUtil,
} from "../../../Types/Workspace/SavedChatMessage";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import CreateBy from "../../Types/Database/CreateBy";
import type { WorkspaceChannelToSkip } from "../../Services/WorkspaceNotificationRuleService";

/*
 * A NOTE SAVED FROM A SLACK OR MICROSOFT TEAMS MESSAGE, IN EVERY KIND OF NOTE.
 *
 * Incidents, alerts, both kinds of episode and scheduled maintenance events
 * each have their own note services; a message pinned in any of their
 * channels is saved through them the same way (WorkspaceReactionNote), and
 * this is that way:
 *
 *   - the note is created as the member who saved it, and records the
 *     message's author, chat and time (savedFromChatMessage, a column no
 *     caller may write) only once every check of that member has passed:
 *     handed over with the create (create), written by the service's
 *     onCreatePermitted (writeHandedOver);
 *   - its timeline entry names the message's author, the chat and who saved
 *     it, in a sentence that reads on its own wherever the entry is shown -
 *     the mobile app, the record's other channels - and the dashboard draws
 *     its author line from the column instead (getFeedMarkdown);
 *   - the entry is not posted back into the channel the message is in,
 *     where it would only repeat it (getSourceChannel).
 */

export enum SavedChatMessageNoteKind {
  Private = "private",
  Public = "public",
}

export default class SavedChatMessageNote {
  /*
   * What each create of a note from a chat message carries, by the create
   * itself: read back by the service's onCreatePermitted.
   */
  private static readonly handedOver: WeakMap<
    CreateBy<BaseModel>,
    SavedChatMessage
  > = new WeakMap<CreateBy<BaseModel>, SavedChatMessage>();

  /*
   * Creates a note with `create`, handing over where its words came from:
   * written on it once the member's checks have passed (writeHandedOver).
   */
  public static async create<TModel extends BaseModel>(data: {
    createBy: CreateBy<TModel>;
    savedFromChatMessage?: SavedChatMessage | undefined;
    create: (createBy: CreateBy<TModel>) => Promise<TModel>;
  }): Promise<TModel> {
    if (!data.savedFromChatMessage) {
      return await data.create(data.createBy);
    }

    SavedChatMessageNote.handedOver.set(
      data.createBy as unknown as CreateBy<BaseModel>,
      data.savedFromChatMessage,
    );

    try {
      return await data.create(data.createBy);
    } finally {
      SavedChatMessageNote.handedOver.delete(
        data.createBy as unknown as CreateBy<BaseModel>,
      );
    }
  }

  /*
   * For a note service's onCreatePermitted: the chat message a create was
   * handed over with (create), written on the note. Nothing for any other
   * create - an API call, a dashboard note - whatever it sent.
   */
  public static writeHandedOver<TModel extends BaseModel>(
    createBy: CreateBy<TModel>,
  ): void {
    const saved: SavedChatMessage | undefined =
      SavedChatMessageNote.handedOver.get(
        createBy as unknown as CreateBy<BaseModel>,
      );

    if (!saved) {
      return;
    }

    (createBy.data as unknown as { savedFromChatMessage?: JSONObject })[
      "savedFromChatMessage"
    ] = SavedChatMessageUtil.toJSON(saved);
  }

  // The chat message a note was saved from, as stored on it; null for none.
  public static read(
    note: BaseModel | null | undefined,
  ): SavedChatMessage | null {
    if (!note) {
      return null;
    }

    return SavedChatMessageUtil.read(
      (note as unknown as { savedFromChatMessage?: unknown })[
        "savedFromChatMessage"
      ],
    );
  }

  /*
   * The channel a note's message is in, from its message key
   * ("<channel>:<message>", postedFromSlackMessageId): the one its timeline
   * entry is not posted to. A Teams channel id has colons of its own, so
   * the message's id is what follows the last one.
   */
  public static getSourceChannel(data: {
    saved: SavedChatMessage | null;
    messageKey: string | null | undefined;
  }): WorkspaceChannelToSkip | undefined {
    const key: string = (data.messageKey || "").trim();
    const separator: number = key.lastIndexOf(":");

    if (!data.saved || separator <= 0) {
      return undefined;
    }

    return {
      workspaceType: data.saved.workspaceType,
      channelId: key.slice(0, separator),
    };
  }

  /*
   * A saved note's timeline entry: who wrote the message, in which chat,
   * and who saved it, then the note.
   *
   *   📄 **Aidil Rahman** posted **private note** for this [Incident INC-8](…)
   *   via Slack (note added by Nitin Kumar):
   *
   *   Not sure what's happening here, is this triggered by something?
   *
   * "(note added by ...)" is left out when the author saved it themselves.
   * A public note says it is on the status page, as every public note's
   * entry does.
   */
  public static getFeedMarkdown(data: {
    saved: SavedChatMessage;
    noteKind: SavedChatMessageNoteKind;
    // The record as a link: "[Incident INC-8](link)".
    record: MarkdownText;
    // Who saved it, when it is somebody else than its author.
    savedByName?: string | null | undefined;
    // The note, and what is attached to it.
    note: MarkdownText;
  }): MarkdownText {
    const author: string = SavedChatMessageNote.getAuthorName(data.saved);
    const workspaceName: string = SavedChatMessageUtil.getWorkspaceName(
      data.saved.workspaceType,
    );
    const savedByName: string = SavedChatMessageUtil.getCleanName(
      data.savedByName,
    );

    const where: MarkdownText =
      data.noteKind === SavedChatMessageNoteKind.Public
        ? mdText`posted **public note** for this ${data.record} on status page via ${workspaceName}`
        : mdText`posted **private note** for this ${data.record} via ${workspaceName}`;

    const lead: MarkdownText =
      savedByName && savedByName !== author
        ? mdText`📄 **${author}** ${where} (note added by ${savedByName}):`
        : mdText`📄 **${author}** ${where}:`;

    return mdText`${lead}

${data.note}`;
  }

  /*
   * Who saved a note, as its entry names them: their name, else their
   * email. Null when they wrote the message themselves, or cannot be read.
   */
  public static async getSavedByName(data: {
    saved: SavedChatMessage;
    userId: ObjectID | null | undefined;
  }): Promise<string | null> {
    if (!data.userId) {
      return null;
    }

    if (
      data.saved.authorUserId &&
      data.saved.authorUserId === data.userId.toString().toLowerCase()
    ) {
      return null;
    }

    try {
      const user: User | null = await UserService.findOneById({
        id: data.userId,
        select: {
          name: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
      });

      return (
        user?.name?.toString().trim() || user?.email?.toString().trim() || null
      );
    } catch (err) {
      logger.debug("Could not read who saved a note from a chat message.");
      logger.debug(err);
      return null;
    }
  }

  /*
   * Who wrote a note, as a prompt to OneUptime AI names them: its creator -
   * or, for a message saved from a chat, its author and the chat, "Aidil
   * Rahman (via Slack, saved by Nitin Kumar)" - so the model reads whose
   * words they are, not the words of whoever pinned them.
   */
  public static getPromptAuthor(data: {
    note: BaseModel;
    // The note's creator, by name.
    createdBy: string;
  }): string {
    const saved: SavedChatMessage | null = SavedChatMessageNote.read(data.note);

    if (!saved) {
      return data.createdBy;
    }

    const author: string = SavedChatMessageNote.getAuthorName(saved);
    const workspaceName: string = SavedChatMessageUtil.getWorkspaceName(
      saved.workspaceType,
    );

    return author === data.createdBy
      ? `${author} (via ${workspaceName})`
      : `${author} (via ${workspaceName}, saved by ${data.createdBy})`;
  }

  /*
   * Who wrote the message, as a note names them: the name recorded, or
   * "Someone" when the chat did not say.
   */
  public static getAuthorName(saved: SavedChatMessage): string {
    return SavedChatMessageUtil.getCleanName(saved.authorName) || "Someone";
  }

  /*
   * The note's own text, with what is attached to it, for its entry: the
   * note as it was written (it is Markdown), then the attachments' links.
   */
  public static getNoteMarkdown(data: {
    note: string | null | undefined;
    attachments: MarkdownText;
  }): MarkdownText {
    return mdText`${FeedMarkdown.asMarkdown(data.note)}${data.attachments}`;
  }
}
