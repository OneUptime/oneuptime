import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceLiveMessageService from "../../../Services/WorkspaceLiveMessageService";
import logger from "../../Logger";
import { WORKSPACE_STORED_ID_MAX_LENGTH } from "../WorkspaceStoredValue";

/*
 * THE MICROSOFT TEAMS CHAT IDS ONEUPTIME KEPT CUT TO 100 CHARACTERS, PUT
 * BACK WHOLE (issues #9284 and #9330).
 *
 * Until #9284, the place of a message OneUptime keeps up to date
 * (WorkspaceLiveMessage.channelId) and the channel of every Notification
 * Log (WorkspaceNotificationLog.channelId) were cut to 100 characters when
 * they were written. A personal chat's id ("a:1...") is 130 characters and
 * more, so a page asked for in a personal chat was kept at an id of no
 * chat, and every update of it failed there with "This chat is not
 * connected to OneUptime". Ids are kept whole now (WorkspaceStoredValue);
 * this puts back the ones kept cut.
 *
 * A cut id is the first 100 characters of one of the chats the project's
 * Microsoft Teams connection lists (miscData.availableChats), so a row of
 * the project whose Microsoft Teams channel id is exactly that gets the
 * chat's whole id back. A prefix two listed chats share says neither and
 * is left as it is, as is a cut id whose chat is not listed: no chat can be
 * told for it, and none would take an update. Names are left as written;
 * they are only shown.
 *
 * It is done twice over:
 *   - at the upgrade, for every chat each connection lists, in both tables
 *     (the RestoreCutMicrosoftTeamsChatIds data migration);
 *   - when a connection newly lists a chat, in the messages kept up to date
 *     (restoreKeptMessages, from MicrosoftTeamsUtil.saveChatToProjectAuthTokens):
 *     a chat the connection did not list at the upgrade - the app removed
 *     from the chat and added again - could not be told from its cut id
 *     then, and a page asked for in it before the upgrade still had its
 *     updates to post (#9330).
 *
 * Neither puts back a place a server of the release before kept cut during
 * a rolling upgrade, after the data migration ran, in a chat the connection
 * already listed: that would take a statement on every message to the bot,
 * or a lookup by part of an id when sending. It is a page asked for in the
 * minutes of one upgrade, its run's other places still get its updates, and
 * paging again from the chat keeps a new place whole.
 *
 * Every statement is idempotent: a restored id is no chat's first 100
 * characters, so no row matches it again.
 */
export default class MicrosoftTeamsCutChatIds {
  // The width the ids were cut to.
  public static readonly CUT_LENGTH: number = 100;

  // The tables whose channel ids were cut, each with its own statement.
  public static readonly TABLES: ReadonlyArray<string> = [
    "WorkspaceLiveMessage",
    "WorkspaceNotificationLog",
  ];

  /*
   * The statement that puts back one project's cut ids in one table: $1 the
   * project, $2 the cut ids, $3 the whole id of each, $4 Microsoft Teams.
   */
  public static getRestoreStatement(table: string): string {
    return `UPDATE "${table}" AS "row" SET "channelId" = "chat"."id" FROM unnest($2::text[], $3::text[]) AS "chat"("cutId", "id") WHERE "row"."projectId" = $1 AND "row"."workspaceType" = $4 AND "row"."channelId" = "chat"."cutId"`;
  }

  /*
   * A chat's id as OneUptime kept it before #9284: its first 100
   * characters, cut as it was cut (String.prototype.substring). Only ever
   * looked for, to be given the whole id back; never written.
   */
  public static cut(chatId: string): string {
    return chatId.substring(0, MicrosoftTeamsCutChatIds.CUT_LENGTH);
  }

  /*
   * The ids of a connection's chats: each chat's key and the id it holds,
   * which are the same.
   */
  public static getChatIds(availableChats: unknown): Set<string> {
    const chatIds: Set<string> = new Set<string>();

    if (
      !availableChats ||
      typeof availableChats !== "object" ||
      Array.isArray(availableChats)
    ) {
      return chatIds;
    }

    for (const [key, chat] of Object.entries(
      availableChats as Record<string, unknown>,
    )) {
      if (key) {
        chatIds.add(key);
      }

      const id: unknown =
        chat && typeof chat === "object" && !Array.isArray(chat)
          ? (chat as Record<string, unknown>)["id"]
          : undefined;

      if (typeof id === "string" && id) {
        chatIds.add(id);
      }
    }

    return chatIds;
  }

  /*
   * The whole id each id cut to 100 characters stands for, by that cut id,
   * among one project's chats: those whose id is longer than 100
   * characters. A cut id two chats share stands for neither and is left
   * out, as is a chat longer than a column now keeps whole: it would not
   * fit.
   */
  public static getCutChatIds(chatIds: Iterable<string>): Map<string, string> {
    const wholeIdsByCutId: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const chatId of chatIds) {
      // Never cut.
      if (chatId.length <= MicrosoftTeamsCutChatIds.CUT_LENGTH) {
        continue;
      }

      const cutId: string = MicrosoftTeamsCutChatIds.cut(chatId);
      const wholeIds: Set<string> =
        wholeIdsByCutId.get(cutId) || new Set<string>();

      wholeIds.add(chatId);
      wholeIdsByCutId.set(cutId, wholeIds);
    }

    const restorable: Map<string, string> = new Map<string, string>();

    for (const [cutId, wholeIds] of wholeIdsByCutId) {
      const wholeId: string = Array.from(wholeIds)[0]!;

      if (
        wholeIds.size === 1 &&
        wholeId.length <= WORKSPACE_STORED_ID_MAX_LENGTH
      ) {
        restorable.set(cutId, wholeId);
      }
    }

    return restorable;
  }

  /*
   * Puts back one chat's whole id in the messages one project keeps up to
   * date (WorkspaceLiveMessage) that hold it cut, once the project's
   * Microsoft Teams connection newly lists the chat (#9330): a page asked
   * for in the chat before the upgrade, whose chat the connection did not
   * list when the data migration ran, then reaches the chat at its run's
   * next change.
   *
   * MicrosoftTeamsUtil.saveChatToProjectAuthTokens calls it only for a chat
   * the connection did not list before: the places of a chat it listed at
   * the upgrade were put back then. Nothing is done for a chat whose id was
   * never cut (100 characters or fewer), or when another chat the
   * connection lists has the same first 100 characters: a place kept cut
   * could be either chat's.
   *
   * It runs on the bot's activity path, so it is one statement, found
   * through the index on "WorkspaceLiveMessage"."channelId". The
   * Notification Logs are left as they were: that table has no such index,
   * so the statement would read every log of the project (and a
   * self-hosted OneUptime keeps them all), while a log kept cut only leaves
   * a message in the chat unclaimed by the project that posted it; every
   * log written since the upgrade names the chat whole.
   *
   * Never throws: the chat is listed whether or not its places could be put
   * back, and a failure is logged.
   */
  public static async restoreKeptMessages(data: {
    projectId: ObjectID;
    chatId: string;
    // The chats the project's connection lists, this one among them.
    availableChats: unknown;
  }): Promise<void> {
    if (data.chatId.length <= MicrosoftTeamsCutChatIds.CUT_LENGTH) {
      return;
    }

    const chatIds: Set<string> = MicrosoftTeamsCutChatIds.getChatIds(
      data.availableChats,
    );
    chatIds.add(data.chatId);

    const cutId: string = MicrosoftTeamsCutChatIds.cut(data.chatId);

    if (
      MicrosoftTeamsCutChatIds.getCutChatIds(chatIds).get(cutId) !== data.chatId
    ) {
      return;
    }

    try {
      const result: unknown =
        await WorkspaceLiveMessageService.getRepository().manager.query(
          MicrosoftTeamsCutChatIds.getRestoreStatement("WorkspaceLiveMessage"),
          [
            data.projectId.toString(),
            [cutId],
            [data.chatId],
            WorkspaceType.MicrosoftTeams,
          ],
        );

      // An UPDATE answers its rows and how many it changed.
      const restored: unknown = Array.isArray(result) ? result[1] : undefined;

      if (typeof restored === "number" && restored > 0) {
        logger.info(
          `Put back the whole id of a Microsoft Teams chat newly listed in project ${data.projectId.toString()} in ${restored} message(s) OneUptime keeps up to date, kept cut to ${MicrosoftTeamsCutChatIds.CUT_LENGTH} characters before the upgrade.`,
        );
      }
    } catch (err) {
      logger.error(
        `Could not put back the whole id of a Microsoft Teams chat newly listed in project ${data.projectId.toString()} in the messages OneUptime keeps up to date: ${(err as Error)?.message || String(err)}`,
      );
    }
  }
}
