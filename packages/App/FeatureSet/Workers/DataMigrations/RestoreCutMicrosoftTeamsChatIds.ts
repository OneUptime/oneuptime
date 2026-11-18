import DataMigrationBase from "./DataMigrationBase";
import WorkspaceLiveMessageService from "Common/Server/Services/WorkspaceLiveMessageService";
import { WORKSPACE_STORED_ID_MAX_LENGTH } from "Common/Server/Utils/Workspace/WorkspaceStoredValue";
import logger from "Common/Server/Utils/Logger";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";

// A Microsoft Teams connection's chats, as one row of the read gives them.
export interface ProjectChatsRow {
  projectId: unknown;
  availableChats: unknown;
}

/*
 * Puts back the Microsoft Teams chat ids OneUptime kept cut to 100
 * characters (issue #9284).
 *
 * Before WidenWorkspaceMessageIdColumns1809182970000, the place of a message
 * OneUptime keeps up to date (WorkspaceLiveMessage.channelId) and the
 * channel of every Notification Log (WorkspaceNotificationLog.channelId)
 * were cut to 100 characters when they were written. A personal chat's id
 * ("a:1...") is 130 characters and more, so a page asked for in a personal
 * chat was kept at an id of no chat, and every update of it failed there
 * with "This chat is not connected to OneUptime"; its logs matched nothing
 * that reads them back (a reaction's note, the project of a message to the
 * bot). An alert paged from a chat before the upgrade may still be open,
 * with its updates still to post.
 *
 * Each project's Microsoft Teams connection lists its chats whole
 * (miscData.availableChats): a cut id is the first 100 characters of one of
 * them, in the same project. So, project by project, every row of the two
 * tables whose Microsoft Teams channel id is exactly the first 100
 * characters of one of the project's chats gets that chat's id back. A
 * prefix two of its chats share says neither, and is left as it is, as is
 * a cut id whose chat the connection no longer lists: no chat can be told
 * for it, and none would take the update. Names are left as written; they
 * are only shown.
 *
 * One statement per project and table, each finding the project's rows by
 * its index. Idempotent, and safe to run twice at once: a restored id is no
 * chat's first 100 characters, so no row matches it again. A project that
 * cannot be restored is logged and costs the others nothing.
 */
export default class RestoreCutMicrosoftTeamsChatIds extends DataMigrationBase {
  // The width the ids were cut to.
  public static readonly CUT_LENGTH: number = 100;

  // The tables whose channel ids were cut, each with its own statement.
  public static readonly TABLES: ReadonlyArray<string> = [
    "WorkspaceLiveMessage",
    "WorkspaceNotificationLog",
  ];

  // Every Microsoft Teams connection that lists chats, with its project.
  public static readonly READ_CHATS: string = `SELECT "projectId", "miscData"->'availableChats' AS "availableChats" FROM "WorkspaceProjectAuthToken" WHERE "workspaceType" = $1 AND jsonb_typeof("miscData"->'availableChats') = 'object'`;

  public constructor() {
    super("RestoreCutMicrosoftTeamsChatIds");
  }

  /*
   * The statement that puts back one project's cut ids in one table: $1 the
   * project, $2 the cut ids, $3 the whole id of each, $4 Microsoft Teams.
   */
  public static getRestoreStatement(table: string): string {
    return `UPDATE "${table}" AS "row" SET "channelId" = "chat"."id" FROM unnest($2::text[], $3::text[]) AS "chat"("cutId", "id") WHERE "row"."projectId" = $1 AND "row"."workspaceType" = $4 AND "row"."channelId" = "chat"."cutId"`;
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
   * characters, and no longer than a column now keeps whole. A cut id two
   * chats share is left out.
   */
  public static getCutChatIds(chatIds: Iterable<string>): Map<string, string> {
    const wholeIdsByCutId: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const chatId of chatIds) {
      if (
        chatId.length <= RestoreCutMicrosoftTeamsChatIds.CUT_LENGTH ||
        chatId.length > WORKSPACE_STORED_ID_MAX_LENGTH
      ) {
        continue;
      }

      // Cut as it was cut: String.prototype.substring.
      const cutId: string = chatId.substring(
        0,
        RestoreCutMicrosoftTeamsChatIds.CUT_LENGTH,
      );
      const wholeIds: Set<string> =
        wholeIdsByCutId.get(cutId) || new Set<string>();

      wholeIds.add(chatId);
      wholeIdsByCutId.set(cutId, wholeIds);
    }

    const restorable: Map<string, string> = new Map<string, string>();

    for (const [cutId, wholeIds] of wholeIdsByCutId) {
      if (wholeIds.size === 1) {
        restorable.set(cutId, Array.from(wholeIds)[0]!);
      }
    }

    return restorable;
  }

  /*
   * The cut ids of each project, by project, from every connection of it:
   * a cut id two chats of the project share is left out, whichever
   * connections list them.
   */
  public static getCutChatIdsByProject(
    rows: Array<ProjectChatsRow>,
  ): Map<string, Map<string, string>> {
    const chatIdsByProject: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const row of rows) {
      if (typeof row.projectId !== "string" || !row.projectId) {
        continue;
      }

      const chatIds: Set<string> =
        chatIdsByProject.get(row.projectId) || new Set<string>();

      for (const chatId of RestoreCutMicrosoftTeamsChatIds.getChatIds(
        row.availableChats,
      )) {
        chatIds.add(chatId);
      }

      chatIdsByProject.set(row.projectId, chatIds);
    }

    const cutChatIdsByProject: Map<string, Map<string, string>> = new Map<
      string,
      Map<string, string>
    >();

    for (const [projectId, chatIds] of chatIdsByProject) {
      const cutChatIds: Map<string, string> =
        RestoreCutMicrosoftTeamsChatIds.getCutChatIds(chatIds);

      if (cutChatIds.size > 0) {
        cutChatIdsByProject.set(projectId, cutChatIds);
      }
    }

    return cutChatIdsByProject;
  }

  public override async migrate(): Promise<void> {
    const manager: ReturnType<
      typeof WorkspaceLiveMessageService.getRepository
    >["manager"] = WorkspaceLiveMessageService.getRepository().manager;

    // A read that fails restores nothing, and the migration is tried again.
    const rows: Array<ProjectChatsRow> = (await manager.query(
      RestoreCutMicrosoftTeamsChatIds.READ_CHATS,
      [WorkspaceType.MicrosoftTeams],
    )) as Array<ProjectChatsRow>;

    const cutChatIdsByProject: Map<
      string,
      Map<string, string>
    > = RestoreCutMicrosoftTeamsChatIds.getCutChatIdsByProject(rows);

    for (const [projectId, cutChatIds] of cutChatIdsByProject) {
      const cutIds: Array<string> = Array.from(cutChatIds.keys());
      const wholeIds: Array<string> = cutIds.map((cutId: string): string => {
        return cutChatIds.get(cutId)!;
      });

      for (const table of RestoreCutMicrosoftTeamsChatIds.TABLES) {
        try {
          await manager.query(
            RestoreCutMicrosoftTeamsChatIds.getRestoreStatement(table),
            [projectId, cutIds, wholeIds, WorkspaceType.MicrosoftTeams],
          );
        } catch (err) {
          logger.error(
            `${this.name}: could not put back the Microsoft Teams chat ids of project ${projectId} in ${table}: ${(err as Error)?.message || String(err)}`,
          );
        }
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
