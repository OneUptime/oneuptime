import type {
  NotificationFor,
  WorkspaceMarkdownNotification,
} from "../../Services/WorkspaceNotificationRuleService";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";

/*
 * A MESSAGE ABOUT A RECORD, AS ANOTHER APP SERVER POSTS IT (#11235).
 *
 * While a record is being created, a message about it waits for its Created
 * message in a line in Valkey (WorkspaceCreatedMessageFirst), stored there
 * with what it says, so that another App server posts it should the one
 * that made it be killed before its turn. This is what is stored: the
 * message as sendWorkspaceMarkdownNotification posts it - the record it is
 * about, its words, who it is from, which updates it is, and where it is
 * and is not posted - and nothing more. The workspace's tokens are read by
 * the server that posts it, from the database, as they always are.
 *
 * Every field of WorkspaceMarkdownNotification is listed below, stored or
 * not, so a field added to it does not compile until it is decided on. A
 * stored message is read back through the same list, so nothing it does
 * not name reaches the post.
 */

type MessageField = keyof WorkspaceMarkdownNotification;

type WorkspaceNotificationField =
  keyof WorkspaceMarkdownNotification["workspaceNotification"];

// Whether each field of a message is stored with it.
export const STORED_MESSAGE_FIELDS: Readonly<Record<MessageField, boolean>> = {
  projectId: true,
  notificationFor: true,
  feedInfoInMarkdown: true,
  notificationText: true,
  markdownByWorkspaceType: true,
  mentionsByWorkspaceType: true,
  workspaceNotification: true,
};

// Whether each field of a message's workspaceNotification is stored with it.
export const STORED_WORKSPACE_NOTIFICATION_FIELDS: Readonly<
  Record<WorkspaceNotificationField, boolean>
> = {
  authorUserId: true,
  authorApiKeyName: true,
  sendWorkspaceNotification: true,
  appendMessageBlocks: true,
  keepPostsAs: true,
  exceptChannel: true,
  updateKinds: true,
  alsoWantedUpdateKinds: true,
  notWantedUpdateKinds: true,
  mentioning: true,
  /*
   * Tells the code that sent the message where it was posted: a function
   * of the server that made it, which stops with it.
   */
  onPosted: false,
  // A message that announces its record - its Created message - is never kept.
  announcesRecord: false,
};

// What the stored message is kept under: anything else is not one.
const STORED_AS: string = "workspaceMarkdownNotification";

// The fields of a message's workspaceNotification, by the type each holds.
const STRING_FIELDS: ReadonlyArray<WorkspaceNotificationField> = [
  "authorApiKeyName",
  "keepPostsAs",
];
const BOOLEAN_FIELDS: ReadonlyArray<WorkspaceNotificationField> = [
  "sendWorkspaceNotification",
  "mentioning",
];
const LIST_FIELDS: ReadonlyArray<WorkspaceNotificationField> = [
  "appendMessageBlocks",
  "updateKinds",
  "alsoWantedUpdateKinds",
  "notWantedUpdateKinds",
];

export default class WorkspaceMarkdownNotificationJSON {
  // The message as it is stored: its stored fields, as JSON.
  public static toJSON(message: WorkspaceMarkdownNotification): JSONObject {
    const kept: JSONObject = {};

    for (const field of Object.keys(
      STORED_MESSAGE_FIELDS,
    ) as Array<MessageField>) {
      if (!STORED_MESSAGE_FIELDS[field] || message[field] === undefined) {
        continue;
      }

      kept[field] =
        field === "workspaceNotification"
          ? this.keptWorkspaceNotification(message.workspaceNotification)
          : (message[field] as unknown as JSONValue);
    }

    return { [STORED_AS]: JSONFunctions.serialize(kept) };
  }

  /*
   * The message a stored one is, read back through the same fields. Throws
   * BadDataException when it is not one, or a field holds what that field
   * never does: such a message is not posted, rather than posted somewhere
   * it should not be.
   */
  public static fromJSON(stored: JSONObject): WorkspaceMarkdownNotification {
    const serialized: JSONValue | undefined = stored?.[STORED_AS];

    if (!this.isObject(serialized)) {
      throw new BadDataException("This is not a stored workspace message.");
    }

    const read: JSONObject = JSONFunctions.deserialize(serialized);

    if (!(read["projectId"] instanceof ObjectID)) {
      throw new BadDataException("A stored workspace message has no project.");
    }

    if (typeof read["feedInfoInMarkdown"] !== "string") {
      throw new BadDataException("A stored workspace message has no text.");
    }

    const message: WorkspaceMarkdownNotification = {
      projectId: read["projectId"],
      notificationFor: this.notificationFor(read["notificationFor"]),
      feedInfoInMarkdown: read["feedInfoInMarkdown"],
      workspaceNotification: this.workspaceNotification(
        read["workspaceNotification"],
      ),
    };

    if (read["notificationText"] !== undefined) {
      if (typeof read["notificationText"] !== "string") {
        throw new BadDataException(
          "A stored workspace message's notification text is not text.",
        );
      }

      message.notificationText = read["notificationText"];
    }

    if (read["markdownByWorkspaceType"] !== undefined) {
      if (!this.isObject(read["markdownByWorkspaceType"])) {
        throw new BadDataException(
          "A stored workspace message's text by workspace is not a list.",
        );
      }

      message.markdownByWorkspaceType = read[
        "markdownByWorkspaceType"
      ] as unknown as WorkspaceMarkdownNotification["markdownByWorkspaceType"];
    }

    if (read["mentionsByWorkspaceType"] !== undefined) {
      if (!this.isObject(read["mentionsByWorkspaceType"])) {
        throw new BadDataException(
          "A stored workspace message's mentions by workspace are not a list.",
        );
      }

      message.mentionsByWorkspaceType = read[
        "mentionsByWorkspaceType"
      ] as unknown as WorkspaceMarkdownNotification["mentionsByWorkspaceType"];
    }

    return message;
  }

  // The stored fields of a message's workspaceNotification.
  private static keptWorkspaceNotification(
    workspaceNotification: WorkspaceMarkdownNotification["workspaceNotification"],
  ): JSONObject {
    const kept: JSONObject = {};

    for (const field of Object.keys(
      STORED_WORKSPACE_NOTIFICATION_FIELDS,
    ) as Array<WorkspaceNotificationField>) {
      if (
        STORED_WORKSPACE_NOTIFICATION_FIELDS[field] &&
        workspaceNotification[field] !== undefined
      ) {
        kept[field] = workspaceNotification[field] as unknown as JSONValue;
      }
    }

    return kept;
  }

  // The record a stored message is about: every id in it an id.
  private static notificationFor(
    value: JSONValue | undefined,
  ): NotificationFor {
    if (!this.isObject(value)) {
      throw new BadDataException(
        "A stored workspace message is about no record.",
      );
    }

    for (const [field, id] of Object.entries(value)) {
      if (
        field.endsWith("Id") &&
        id !== undefined &&
        !(id instanceof ObjectID)
      ) {
        throw new BadDataException(
          `A stored workspace message's ${field} is not an id.`,
        );
      }
    }

    return value as unknown as NotificationFor;
  }

  // A stored message's workspaceNotification, through its stored fields.
  private static workspaceNotification(
    value: JSONValue | undefined,
  ): WorkspaceMarkdownNotification["workspaceNotification"] {
    if (!this.isObject(value)) {
      throw new BadDataException(
        "A stored workspace message does not say how it is posted.",
      );
    }

    if (typeof value["sendWorkspaceNotification"] !== "boolean") {
      throw new BadDataException(
        "A stored workspace message does not say whether it is posted.",
      );
    }

    const read: JSONObject = {};

    for (const field of Object.keys(
      STORED_WORKSPACE_NOTIFICATION_FIELDS,
    ) as Array<WorkspaceNotificationField>) {
      const fieldValue: JSONValue | undefined = value[field];

      if (
        !STORED_WORKSPACE_NOTIFICATION_FIELDS[field] ||
        fieldValue === undefined
      ) {
        continue;
      }

      const isRightType: boolean =
        field === "authorUserId"
          ? fieldValue instanceof ObjectID
          : field === "exceptChannel"
            ? this.isObject(fieldValue)
            : STRING_FIELDS.includes(field)
              ? typeof fieldValue === "string"
              : BOOLEAN_FIELDS.includes(field)
                ? typeof fieldValue === "boolean"
                : LIST_FIELDS.includes(field)
                  ? Array.isArray(fieldValue)
                  : false;

      if (!isRightType) {
        throw new BadDataException(
          `A stored workspace message's ${field} is not what it holds.`,
        );
      }

      read[field] = fieldValue;
    }

    return read as unknown as WorkspaceMarkdownNotification["workspaceNotification"];
  }

  private static isObject(value: unknown): value is JSONObject {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      !(value instanceof ObjectID)
    );
  }
}
