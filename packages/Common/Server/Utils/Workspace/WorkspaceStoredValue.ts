import ColumnLength from "../../../Types/Database/ColumnLength";
import { truncateToLength } from "../Database/TruncateColumnValue";

/*
 * The most of a workspace id a column keeps: WorkspaceLiveMessage's and
 * WorkspaceNotificationLog's id columns are LongText, as
 * WorkspacePublicNoteApprovalMessage's are.
 */
export const WORKSPACE_STORED_ID_MAX_LENGTH: number = ColumnLength.LongText;

// The most of a channel's or chat's name those tables' name columns keep.
export const WORKSPACE_STORED_NAME_MAX_LENGTH: number = ColumnLength.LongText;

/*
 * WHAT ONEUPTIME STORES OF A WORKSPACE'S IDS AND NAMES.
 *
 * Slack, Microsoft Teams and Mattermost give their channels, chats, teams,
 * messages and threads ids OneUptime does not choose, and OneUptime stores
 * them to reach those places again: to edit a message it keeps up to date
 * (WorkspaceLiveMessage), or to find what a message in a channel is about
 * (WorkspaceNotificationLog). An id cut to fit a column is another id, which
 * reaches nothing: a Microsoft Teams personal chat's id ("a:1...", 130
 * characters and more) cut to 100 was no chat, and every update OneUptime
 * posted to it failed with "This chat is not connected to OneUptime"
 * (issue #9284).
 *
 * So an id is stored whole or not at all, in a column wider than any id the
 * workspaces give. A name is only shown: one longer than its column is cut
 * to fit, rather than failing the write it comes with.
 */
export default class WorkspaceStoredValue {
  /*
   * The id as a column keeps it: whole, or undefined when there is none or
   * it is longer than a column holds. Never a part of it.
   */
  public static id(id: string | null | undefined): string | undefined {
    if (typeof id !== "string") {
      return undefined;
    }

    return id.length <= WORKSPACE_STORED_ID_MAX_LENGTH ? id : undefined;
  }

  // Whether this is an id a column can keep whole: there is one, and it fits.
  public static isStorableId(id: string | null | undefined): boolean {
    return typeof id === "string" && id.length > 0 && Boolean(this.id(id));
  }

  /*
   * A channel's or chat's name as a column keeps it: cut to fit; undefined
   * when there is none.
   */
  public static channelName(name: string): string;
  public static channelName(
    name: string | null | undefined,
  ): string | undefined;
  public static channelName(
    name: string | null | undefined,
  ): string | undefined {
    if (typeof name !== "string") {
      return undefined;
    }

    return truncateToLength(name, WORKSPACE_STORED_NAME_MAX_LENGTH);
  }
}
