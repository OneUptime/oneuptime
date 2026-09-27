import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import type { WorkspaceChannelMessage } from "../Workspace";
import Discord from "./Discord";

export default class DiscordHistory {
  public static async getChannelMessages(data: {
    projectId: ObjectID;
    authToken: string;
    channelId: string;
    limit?: number;
    oldestTimestamp?: Date;
  }): Promise<Array<WorkspaceChannelMessage>> {
    const requestedLimit: number = data.limit ?? 100;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
      throw new BadDataException(
        "Discord history limit must be a positive integer.",
      );
    }
    const cutoff: number | undefined = data.oldestTimestamp?.getTime();
    if (cutoff !== undefined && !Number.isFinite(cutoff)) {
      throw new BadDataException(
        "Discord history cutoff must be a valid date.",
      );
    }
    const limit: number = Math.min(requestedLimit, 500);
    const snowflakePattern: RegExp = /^\d{17,20}$/;
    const messages: Map<string, WorkspaceChannelMessage> = new Map();
    let before: string | undefined;

    // Bound reads even when the provider redacts every message's content.
    for (let pageIndex: number = 0; pageIndex < 20; pageIndex++) {
      /*
       * This provider call rechecks the current project binding and channel guild.
       * Do not return accumulated context if a later page fails authorization.
       */
      const page: JSONArray = await Discord.getMessageHistory({
        projectId: data.projectId,
        authToken: data.authToken,
        channelId: data.channelId,
        limit: Math.min(100, limit - messages.size),
        ...(before ? { before } : {}),
      });
      if (!Array.isArray(page)) {
        throw new BadDataException(
          "Discord returned an invalid message history.",
        );
      }
      if (page.length === 0) {
        break;
      }
      let nextBefore: string | undefined;
      let crossedCutoff: boolean = false;
      for (const raw of page) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          continue;
        }
        const id: unknown = raw["id"];
        if (
          typeof id !== "string" ||
          !snowflakePattern.test(id) ||
          raw["channel_id"] !== data.channelId ||
          (before !== undefined && BigInt(id) >= BigInt(before))
        ) {
          continue;
        }
        if (!nextBefore || BigInt(id) < BigInt(nextBefore)) {
          nextBefore = id;
        }
        const timestampText: unknown = raw["timestamp"];
        if (typeof timestampText !== "string") {
          continue;
        }
        const timestamp: Date = new Date(timestampText);
        if (!Number.isFinite(timestamp.getTime())) {
          continue;
        }
        if (cutoff !== undefined && timestamp.getTime() < cutoff) {
          crossedCutoff = true;
          continue;
        }
        const text: unknown = raw["content"];
        if (
          typeof text !== "string" ||
          !text.trim() ||
          ![0, 19, 20, 23].includes(raw["type"] as number)
        ) {
          continue;
        }
        const author: JSONObject =
          raw["author"] &&
          typeof raw["author"] === "object" &&
          !Array.isArray(raw["author"])
            ? (raw["author"] as JSONObject)
            : {};
        const userId: string | undefined =
          typeof author["id"] === "string" &&
          snowflakePattern.test(author["id"])
            ? author["id"]
            : undefined;
        const username: string | undefined = [
          author["global_name"],
          author["username"],
        ].find((value: unknown): value is string => {
          return typeof value === "string" && Boolean(value.trim());
        }) as string | undefined;
        messages.set(id, {
          messageId: id,
          text,
          ...(userId ? { userId } : {}),
          ...(username ? { username } : {}),
          timestamp,
          isBot: author["bot"] === true || Boolean(raw["webhook_id"]),
        });
      }
      if (messages.size >= limit || crossedCutoff || !nextBefore) {
        break;
      }
      before = nextBefore;
    }

    return [...messages.values()]
      .sort(
        (
          left: WorkspaceChannelMessage,
          right: WorkspaceChannelMessage,
        ): number => {
          const timeOrder: number =
            left.timestamp.getTime() - right.timestamp.getTime();
          if (timeOrder !== 0) {
            return timeOrder;
          }
          return BigInt(left.messageId) < BigInt(right.messageId) ? -1 : 1;
        },
      )
      .slice(-limit);
  }
}
