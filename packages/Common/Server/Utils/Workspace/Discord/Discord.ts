import HTTPMethod from "../../../../Types/API/HTTPMethod";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject, JSONArray } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceChannelInvitationPayload from "../../../../Types/Workspace/WorkspaceChannelInvitationPayload";
import WorkspaceMessagePayload, {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import DiscordResourceThreadService from "../../../Services/DiscordResourceThreadService";
import WorkspaceBase, {
  WorkspaceChannel,
  WorkspaceThread,
  WorkspaceSendMessageResponse,
} from "../WorkspaceBase";
import DiscordClient, { DiscordAPIError } from "./DiscordClient";
import DiscordMessageRenderer from "./DiscordMessageRenderer";
interface Scope {
  guildId: string;
  parentId?: string;
}
type Project = { authToken: string; projectId: ObjectID };
type Destination = { authToken: string; channelId: string };
export default class Discord extends WorkspaceBase {
  private static async scope(data: Project): Promise<Scope> {
    const auth: Awaited<
      ReturnType<typeof WorkspaceProjectAuthTokenService.getProjectAuth>
    > = await WorkspaceProjectAuthTokenService.getProjectAuth({
      projectId: data.projectId,
      workspaceType: WorkspaceType.Discord,
    });
    if (!auth?.workspaceProjectId || auth.authToken !== data.authToken) {
      throw new BadDataException(
        "Discord project installation is missing or credentials do not match.",
      );
    }
    const misc: JSONObject = (auth.miscData || {}) as JSONObject;
    return {
      guildId: DiscordClient.snowflake(auth.workspaceProjectId),
      ...(typeof misc["incidentChannelId"] === "string"
        ? { parentId: DiscordClient.snowflake(misc["incidentChannelId"]) }
        : {}),
    };
  }
  private static async channel(data: Destination): Promise<JSONObject> {
    return (await DiscordClient.request({
      authToken: data.authToken,
      method: HTTPMethod.GET,
      path: "/channels/" + DiscordClient.snowflake(data.channelId),
    })) as JSONObject;
  }
  private static asChannel(raw: JSONObject): WorkspaceChannel {
    return {
      id: DiscordClient.snowflake(String(raw["id"])),
      name: String(raw["name"] || raw["id"]),
      workspaceType: WorkspaceType.Discord,
      teamId: String(raw["guild_id"] || ""),
    };
  }
  private static async scopedChannel(
    data: Project & Destination,
  ): Promise<JSONObject> {
    const scope: Scope = await this.scope(data);
    const channel: JSONObject = await this.channel(data);
    if (
      channel["guild_id"] !== scope.guildId ||
      ![0, 5, 10, 11, 12].includes(Number(channel["type"]))
    ) {
      throw new BadDataException(
        "Discord channel is outside this project guild or cannot receive messages.",
      );
    }
    return channel;
  }
  public static override async getWorkspaceChannelFromChannelId(
    data: Destination & { teamId?: string },
  ): Promise<WorkspaceChannel> {
    const channel: JSONObject = await this.channel(data);
    if (!data.teamId || channel["guild_id"] !== data.teamId) {
      throw new BadDataException(
        "Discord channel requires its verified guild ID.",
      );
    }
    return this.asChannel(channel);
  }
  public static override async getAllWorkspaceChannels(
    data: Project,
  ): Promise<Dictionary<WorkspaceChannel>> {
    const scope: Scope = await this.scope(data);
    const channels: JSONArray = (await DiscordClient.request({
      authToken: data.authToken,
      method: HTTPMethod.GET,
      path: "/guilds/" + scope.guildId + "/channels",
    })) as JSONArray;
    const active: JSONObject = (await DiscordClient.request({
      authToken: data.authToken,
      method: HTTPMethod.GET,
      path: "/guilds/" + scope.guildId + "/threads/active",
    })) as JSONObject;
    const result: Dictionary<WorkspaceChannel> = {};
    for (const raw of [
      ...channels,
      ...((active["threads"] || []) as JSONArray),
    ]) {
      const channel: JSONObject = raw as JSONObject;
      if (
        channel["guild_id"] === scope.guildId &&
        [0, 5, 10, 11, 12].includes(Number(channel["type"]))
      ) {
        const item: WorkspaceChannel = this.asChannel(channel);
        result[item.id] = item;
      }
    }
    return result;
  }
  public static override async getWorkspaceChannelFromChannelName(
    data: Project & { channelName: string },
  ): Promise<WorkspaceChannel> {
    const matches: Array<WorkspaceChannel> = Object.values(
      await this.getAllWorkspaceChannels(data),
    ).filter((channel: WorkspaceChannel) => {
      return channel.name === data.channelName;
    });
    if (matches.length !== 1) {
      throw new BadDataException(
        "Discord channel name is missing or ambiguous; use a channel ID.",
      );
    }
    return matches[0]!;
  }
  public static override async doesChannelExist(
    data: Project & { channelName: string },
  ): Promise<boolean> {
    return Object.values(await this.getAllWorkspaceChannels(data)).some(
      (channel: WorkspaceChannel) => {
        return channel.name === data.channelName;
      },
    );
  }
  public static override async createChannel(
    data: Project & { channelName: string; isPrivate?: boolean },
  ): Promise<WorkspaceChannel> {
    if (!data.channelName.trim() || data.channelName.length > 100) {
      throw new BadDataException(
        "Discord thread names require 1–100 characters.",
      );
    }
    const scope: Scope = await this.scope(data);
    if (!scope.parentId) {
      throw new BadDataException(
        "Configure a Discord incident parent channel first.",
      );
    }
    const parent: JSONObject = await this.scopedChannel({
      ...data,
      channelId: scope.parentId,
    });
    if (parent["type"] !== 0) {
      throw new BadDataException(
        "Discord incident parent must be a text channel.",
      );
    }
    return this.asChannel(
      (await DiscordClient.request({
        authToken: data.authToken,
        method: HTTPMethod.POST,
        path: "/channels/" + scope.parentId + "/threads",
        body: {
          name: data.channelName,
          type: data.isPrivate ? 12 : 11,
          auto_archive_duration: 1440,
          ...(data.isPrivate ? { invitable: false } : {}),
        },
      })) as JSONObject,
    );
  }
  public static override getBlocksFromWorkspaceMessagePayload(data: {
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): Array<JSONObject> {
    return DiscordMessageRenderer.render(data);
  }
  public static override async sendPayloadBlocksToChannel(data: {
    authToken: string;
    workspaceChannel: WorkspaceChannel;
    blocks: Array<JSONObject>;
    projectId?: ObjectID;
  }): Promise<WorkspaceThread> {
    if (!data.projectId) {
      throw new BadDataException(
        "Discord channel delivery requires project scope.",
      );
    }
    await this.scopedChannel({
      ...data,
      projectId: data.projectId,
      channelId: data.workspaceChannel.id,
    });
    return this.sendRenderedMessages(data);
  }
  private static async sendRenderedMessages(data: {
    authToken: string;
    workspaceChannel: WorkspaceChannel;
    blocks: Array<JSONObject>;
  }): Promise<WorkspaceThread> {
    let messageId: string = "";
    for (const message of data.blocks) {
      const id: string = await DiscordClient.sendMessage({
        authToken: data.authToken,
        channelId: data.workspaceChannel.id,
        message: {
          ...message,
          allowed_mentions: { parse: [], replied_user: false },
        },
      });
      if (!messageId) {
        messageId = id;
      }
    }
    if (!messageId) {
      throw new BadDataException("Cannot send an empty Discord message.");
    }
    return { channel: data.workspaceChannel, threadId: messageId };
  }
  public static override async sendMessage(
    data: Project & {
      workspaceMessagePayload: WorkspaceMessagePayload;
      userId: string;
    },
  ): Promise<WorkspaceSendMessageResponse> {
    await this.scope(data);
    const blocks: Array<JSONObject> = DiscordMessageRenderer.render({
      messageBlocks: data.workspaceMessagePayload.messageBlocks,
    });
    const result: WorkspaceSendMessageResponse = {
      workspaceType: WorkspaceType.Discord,
      threads: [],
      errors: [],
    };
    const ids: Set<string> = new Set(data.workspaceMessagePayload.channelIds);
    for (const name of new Set(data.workspaceMessagePayload.channelNames)) {
      try {
        ids.add(
          (
            await this.getWorkspaceChannelFromChannelName({
              ...data,
              channelName: name,
            })
          ).id,
        );
      } catch (error) {
        result.errors!.push({
          channel: { id: name, name, workspaceType: WorkspaceType.Discord },
          error: this.getSendErrorMessage(error),
        });
      }
    }
    for (const id of ids) {
      let channel: WorkspaceChannel = {
        id,
        name: id,
        workspaceType: WorkspaceType.Discord,
      };
      try {
        channel = this.asChannel(
          await this.scopedChannel({ ...data, channelId: id }),
        );
        result.threads.push(
          await this.sendPayloadBlocksToChannel({
            ...data,
            workspaceChannel: channel,
            blocks,
          }),
        );
      } catch (error) {
        result.errors!.push({
          channel,
          error: this.getSendErrorMessage(error),
        });
      }
    }
    return result;
  }
  public static override async sendDirectMessageToUser(data: {
    authToken: string;
    workspaceUserId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): Promise<void> {
    const blocks: Array<JSONObject> = DiscordMessageRenderer.render(data);
    const id: string = await DiscordClient.openDirectMessage({
      authToken: data.authToken,
      userId: data.workspaceUserId,
    });
    await this.sendRenderedMessages({
      ...data,
      blocks,
      workspaceChannel: { id, name: id, workspaceType: WorkspaceType.Discord },
    });
  }
  public static override async isUserInDirectMessageChannel(data: {
    authToken: string;
    userId: string;
    directMessageChannelId: string;
  }): Promise<boolean> {
    const channel: JSONObject = await this.channel({
      ...data,
      channelId: data.directMessageChannelId,
    });
    return (
      channel["type"] === 1 &&
      ((channel["recipients"] || []) as Array<JSONObject>).some(
        (user: JSONObject) => {
          return user["id"] === data.userId;
        },
      )
    );
  }
  public static override async archiveChannels(
    data: Project & {
      channelIds: Array<string>;
      userId: string;
      sendMessageBeforeArchiving: WorkspacePayloadMarkdown;
    },
  ): Promise<void> {
    const scope: Scope = await this.scope(data);
    for (const channelId of new Set(data.channelIds)) {
      const channel: JSONObject = await this.scopedChannel({
        ...data,
        channelId,
      });
      if (
        ![11, 12].includes(Number(channel["type"])) ||
        channel["parent_id"] !== scope.parentId
      ) {
        throw new BadDataException(
          "Only incident threads in the configured parent can be archived.",
        );
      }
      await this.sendPayloadBlocksToChannel({
        ...data,
        workspaceChannel: this.asChannel(channel),
        blocks: DiscordMessageRenderer.render({
          messageBlocks: [data.sendMessageBeforeArchiving],
        }),
      });
      await DiscordClient.request({
        authToken: data.authToken,
        method: HTTPMethod.PATCH,
        path: "/channels/" + channelId,
        body: { archived: true, locked: true },
      });
      // Ownership rows track the archive so a later state change can reopen.
      await DiscordResourceThreadService.markArchived({
        projectId: data.projectId,
        threadIds: [channelId],
      });
    }
  }
  public static override async joinChannel(
    data: Destination & { projectId?: ObjectID },
  ): Promise<void> {
    if (!data.projectId) {
      throw new BadDataException("Discord membership requires project scope.");
    }
    const channel: JSONObject = await this.scopedChannel({
      ...data,
      projectId: data.projectId,
    });
    if (![10, 11, 12].includes(Number(channel["type"]))) {
      throw new BadDataException(
        "Discord membership operations require a thread.",
      );
    }
    await DiscordClient.request({
      authToken: data.authToken,
      method: HTTPMethod.PUT,
      path:
        "/channels/" +
        DiscordClient.snowflake(data.channelId) +
        "/thread-members/@me",
    });
  }
  public static override async inviteUserToChannelByChannelId(
    data: Destination & { workspaceUserId: string; projectId?: ObjectID },
  ): Promise<void> {
    if (!data.projectId) {
      throw new BadDataException("Discord membership requires project scope.");
    }
    const channel: JSONObject = await this.scopedChannel({
      ...data,
      projectId: data.projectId,
    });
    if (![10, 11, 12].includes(Number(channel["type"]))) {
      throw new BadDataException(
        "Discord membership operations require a thread.",
      );
    }
    /*
     * Guild and type are not ownership: a managed thread must be active
     * under the live installation before anyone is added to it (F25).
     */
    await DiscordResourceThreadService.assertInvitable({
      projectId: data.projectId,
      threadId: DiscordClient.snowflake(data.channelId),
    });
    await DiscordClient.request({
      authToken: data.authToken,
      method: HTTPMethod.PUT,
      path:
        "/channels/" +
        DiscordClient.snowflake(data.channelId) +
        "/thread-members/" +
        DiscordClient.snowflake(data.workspaceUserId),
    });
  }
  /*
   * Thread names are not unique: a recreated thread carries the name of the
   * one it replaced, and the by-name lookup refuses an ambiguous match (F30).
   * The rule path knows the destination ids, so invites go by id.
   */
  public static override async inviteUsersToChannels(data: {
    authToken: string;
    workspaceChannelInvitationPayload: WorkspaceChannelInvitationPayload;
    projectId: ObjectID;
  }): Promise<void> {
    const channelIds: Array<string> =
      data.workspaceChannelInvitationPayload.channelIds || [];
    if (channelIds.length === 0) {
      return await super.inviteUsersToChannels(data);
    }
    for (const channelId of channelIds) {
      for (const workspaceUserId of data.workspaceChannelInvitationPayload
        .workspaceUserIds) {
        await this.inviteUserToChannelByChannelId({
          authToken: data.authToken,
          channelId,
          workspaceUserId,
          projectId: data.projectId,
        });
      }
    }
  }
  public static override async inviteUserToChannelByChannelName(
    data: Project & { channelName: string; workspaceUserId: string },
  ): Promise<void> {
    const channel: WorkspaceChannel =
      await this.getWorkspaceChannelFromChannelName(data);
    await this.inviteUserToChannelByChannelId({
      ...data,
      channelId: channel.id,
    });
  }
  public static async getMessageHistory(
    data: Project & Destination & { limit?: number; before?: string },
  ): Promise<JSONArray> {
    const limit: number = data.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadDataException("Discord history limit must be 1–100.");
    }
    const before: string = data.before
      ? "&before=" + DiscordClient.snowflake(data.before)
      : "";
    await this.scopedChannel(data);
    return (await DiscordClient.request({
      authToken: data.authToken,
      method: HTTPMethod.GET,
      path:
        "/channels/" +
        DiscordClient.snowflake(data.channelId) +
        "/messages?limit=" +
        limit +
        before,
    })) as JSONArray;
  }
  public static override async getUsernameFromUserId(
    data: Project & { userId: string },
  ): Promise<string | null> {
    const scope: Scope = await this.scope(data);
    const member: JSONObject = (await DiscordClient.request({
      authToken: data.authToken,
      method: HTTPMethod.GET,
      path:
        "/guilds/" +
        scope.guildId +
        "/members/" +
        DiscordClient.snowflake(data.userId),
    })) as JSONObject;
    const user: JSONObject = member["user"] as JSONObject;
    return (
      String(member["nick"] || user["global_name"] || user["username"] || "") ||
      null
    );
  }
  public static override async isUserInChannel(
    data: Destination & { userId: string; projectId?: ObjectID },
  ): Promise<boolean> {
    if (!data.projectId) {
      throw new BadDataException("Discord membership requires project scope.");
    }
    const channel: JSONObject = await this.scopedChannel({
      ...data,
      projectId: data.projectId,
    });
    if (![10, 11, 12].includes(Number(channel["type"]))) {
      throw new BadDataException(
        "Discord membership lookup requires a thread.",
      );
    }
    try {
      await DiscordClient.request({
        authToken: data.authToken,
        method: HTTPMethod.GET,
        path:
          "/channels/" +
          DiscordClient.snowflake(data.channelId) +
          "/thread-members/" +
          DiscordClient.snowflake(data.userId),
      });
      return true;
    } catch (error) {
      if (error instanceof DiscordAPIError && error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }
}
