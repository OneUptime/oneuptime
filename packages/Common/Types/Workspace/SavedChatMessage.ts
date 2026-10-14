import { JSONObject } from "../JSON";
import WorkspaceType, { getWorkspaceTypeDisplayName } from "./WorkspaceType";

/*
 * A NOTE SAVED FROM A SLACK OR MICROSOFT TEAMS MESSAGE: WHO WROTE THE
 * MESSAGE, IN WHICH CHAT, AND WHEN.
 *
 * Somebody pins a message in an incident's channel (or reacts to it with a
 * note emoji) and OneUptime saves it as a note. The note is created by
 * whoever saved it - their permissions, their name as its creator - but its
 * words are somebody else's: "Aidil via Slack (note added by Nitin)", as
 * the timeline shows it. OneUptime records that on the note, and on the
 * timeline entry it writes for it, in one column, savedFromChatMessage:
 *
 *   - workspaceType: the chat it was posted in;
 *   - authorName: who wrote it - their OneUptime name when their chat
 *     account is connected to the project, else the name the chat shows
 *     (an app's name for an app's message);
 *   - authorUserId: their OneUptime user, when connected;
 *   - postedAt: when it was posted in the chat (ISO 8601). A private note
 *     is filed at this time; a public one at the time it was published,
 *     which is when the status page's readers saw it.
 *
 * Only OneUptime writes it: a note's column is written once every check of
 * the member who saved it has passed, and never by an API caller. The
 * dashboard reads it through read() below, which keeps only what it should
 * hold - a feed row's copy can be written by a workflow, like any other
 * column of a feed row.
 */
export default interface SavedChatMessage {
  workspaceType: WorkspaceType;
  authorName?: string | undefined;
  authorUserId?: string | undefined;
  postedAt?: string | undefined;
}

// A name longer than this is cut: a name, not a paragraph.
export const SAVED_CHAT_MESSAGE_AUTHOR_NAME_MAX_LENGTH: number = 100;

// A OneUptime user id: a UUID.
const USER_ID: RegExp =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Line breaks, tabs and other control characters in a name: one space each.
const CONTROL_CHARACTERS: RegExp = /\p{Cc}+/gu;

const WHITESPACE_RUN: RegExp = /\s+/g;

export class SavedChatMessageUtil {
  /*
   * A stored value read back, keeping only what it should hold: a known
   * chat, a name on one line of at most 100 characters, a user id that is
   * one, a time that is one. Null when it says nothing about a chat.
   */
  public static read(value: unknown): SavedChatMessage | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const json: JSONObject = value as JSONObject;
    const workspaceType: unknown = json["workspaceType"];

    if (
      workspaceType !== WorkspaceType.Slack &&
      workspaceType !== WorkspaceType.MicrosoftTeams
    ) {
      return null;
    }

    const saved: SavedChatMessage = { workspaceType: workspaceType };

    const authorName: string = SavedChatMessageUtil.getCleanName(
      json["authorName"],
    );

    if (authorName) {
      saved.authorName = authorName;
    }

    const authorUserId: unknown = json["authorUserId"];

    if (typeof authorUserId === "string" && USER_ID.test(authorUserId)) {
      saved.authorUserId = authorUserId.toLowerCase();
    }

    const postedAt: Date | null = SavedChatMessageUtil.getPostedAt({
      workspaceType: workspaceType,
      postedAt: typeof json["postedAt"] === "string" ? json["postedAt"] : "",
    });

    if (postedAt) {
      saved.postedAt = postedAt.toISOString();
    }

    return saved;
  }

  // As stored: the fields that have a value.
  public static toJSON(saved: SavedChatMessage): JSONObject {
    const json: JSONObject = { workspaceType: saved.workspaceType };

    const authorName: string = SavedChatMessageUtil.getCleanName(
      saved.authorName,
    );

    if (authorName) {
      json["authorName"] = authorName;
    }

    if (saved.authorUserId && USER_ID.test(saved.authorUserId)) {
      json["authorUserId"] = saved.authorUserId.toLowerCase();
    }

    const postedAt: Date | null = SavedChatMessageUtil.getPostedAt(saved);

    if (postedAt) {
      json["postedAt"] = postedAt.toISOString();
    }

    return json;
  }

  // When the message was posted, or null when it is not known.
  public static getPostedAt(saved: SavedChatMessage | null): Date | null {
    if (!saved || !saved.postedAt) {
      return null;
    }

    const date: Date = new Date(saved.postedAt);

    return isNaN(date.getTime()) ? null : date;
  }

  // "Slack", "Microsoft Teams".
  public static getWorkspaceName(workspaceType: WorkspaceType): string {
    return getWorkspaceTypeDisplayName(workspaceType);
  }

  /*
   * The chat a note saved before this column existed came from, read from
   * its message key (postedFromSlackMessageId, "<channel>:<message>", which
   * despite its name holds Microsoft Teams messages too): a Microsoft Teams
   * channel's id starts "19:", a Slack channel's never does. Null with no
   * key.
   */
  public static getWorkspaceTypeOfMessageKey(
    key: string | null | undefined,
  ): WorkspaceType | null {
    const value: string = (key || "").trim();

    if (!value) {
      return null;
    }

    return value.startsWith("19:")
      ? WorkspaceType.MicrosoftTeams
      : WorkspaceType.Slack;
  }

  // A name on one line, trimmed, at most 100 characters; "" for none.
  public static getCleanName(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }

    const name: string = value
      .replace(CONTROL_CHARACTERS, " ")
      .replace(WHITESPACE_RUN, " ")
      .trim();

    return Array.from(name)
      .slice(0, SAVED_CHAT_MESSAGE_AUTHOR_NAME_MAX_LENGTH)
      .join("")
      .trim();
  }
}
