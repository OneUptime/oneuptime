import { JSONObject } from "../JSON";
import WorkspaceType from "./WorkspaceType";

/*
 * A message OneUptime posted in a Slack, Microsoft Teams or Mattermost
 * channel or chat, kept as the workspace names it, so that OneUptime can
 * delete it later (WorkspaceBase.deleteMessage): what OneUptime AI read in
 * a call's transcript, taken back with the transcript (CallSummaryPosts).
 *
 * Kept in a JSON column, so a Microsoft Teams chat's id - 130 characters
 * and more - is kept whole: an id cut to fit addresses nothing.
 */
export default interface WorkspacePostedMessage {
  workspaceType: WorkspaceType;
  // The channel, or the Microsoft Teams chat, it was posted in.
  channelId: string;
  // What the channel was called, to say where a message stays.
  channelName?: string | undefined;
  // A Microsoft Teams channel's team.
  teamId?: string | undefined;
  // A Microsoft Teams group or personal chat rather than a channel.
  isChat?: boolean | undefined;
  /*
   * The id the workspace gave the post: a Slack ts, a Microsoft Teams
   * activity id, a Mattermost post id. Empty when the workspace did not
   * say, or the message went out as several posts and only the last one's
   * id came back: OneUptime cannot delete such a message, and says so.
   */
  messageId: string;
}

const WORKSPACE_TYPES: ReadonlyArray<string> = Object.values(WorkspaceType);

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/*
 * A posted message as a column holds it, or null when it is not one: the
 * JSON is OneUptime's own, but a column is never trusted to be.
 */
export function readWorkspacePostedMessage(
  value: unknown,
): WorkspacePostedMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: JSONObject = value as JSONObject;
  const workspaceType: unknown = json["workspaceType"];
  const channelId: string | undefined = readString(json["channelId"]);

  if (
    typeof workspaceType !== "string" ||
    !WORKSPACE_TYPES.includes(workspaceType) ||
    !channelId
  ) {
    return null;
  }

  const channelName: string | undefined = readString(json["channelName"]);
  const teamId: string | undefined = readString(json["teamId"]);

  return {
    workspaceType: workspaceType as WorkspaceType,
    channelId: channelId,
    ...(channelName ? { channelName } : {}),
    ...(teamId ? { teamId } : {}),
    ...(json["isChat"] === true ? { isChat: true } : {}),
    messageId: readString(json["messageId"]) || "",
  };
}

// The message as a column keeps it: only what it has.
export function toWorkspacePostedMessageJSON(
  message: WorkspacePostedMessage,
): JSONObject {
  const json: JSONObject = {
    workspaceType: message.workspaceType,
    channelId: message.channelId,
    messageId: message.messageId || "",
  };

  if (message.channelName) {
    json["channelName"] = message.channelName;
  }

  if (message.teamId) {
    json["teamId"] = message.teamId;
  }

  if (message.isChat) {
    json["isChat"] = true;
  }

  return json;
}
