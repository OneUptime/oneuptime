import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import WorkspaceMessagePayload, {
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadHeader,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import logger from "../../Logger";
import Dictionary from "../../../../Types/Dictionary";
import BadRequestException from "../../../../Types/Exception/BadRequestException";
import WorkspaceChannelInvitationPayload from "../../../../Types/Workspace/WorkspaceChannelInvitationPayload";
import WorkspaceBase, { WorkspaceChannel } from "../WorkspaceBase";


export default class SlackUtil extends WorkspaceBase {
  public static async inviteUsersToChannels(data: {
    authToken: string;
    workspaceChannelInvitationPayload: WorkspaceChannelInvitationPayload;
  }): Promise<void> {
    const channelIds: Array<string> = [];

    for (const channelName of data.workspaceChannelInvitationPayload
      .workspaceChannelNames) {
      const channel: WorkspaceChannel = await this.createChannel({
        authToken: data.authToken,
        channelName: channelName,
      });

      channelIds.push(channel.id);
    }

    for (const channelId of channelIds) {
      await this.inviteUsersToChannel({
        authToken: data.authToken,
        channelId: channelId,
        userIds: data.workspaceChannelInvitationPayload.workspaceUserIds,
      });
    }
  }

  private static async inviteUsersToChannel(data: {
    authToken: string;
    channelId: string;
    userIds: Array<string>;
  }): Promise<void> {
    for (const userId of data.userIds) {
      await this.inviteUserToChannel({
        authToken: data.authToken,
        channelId: data.channelId,
        userId: userId,
      });
    }
  }

  private static async inviteUserToChannel(data: {
    authToken: string;
    channelId: string;
    userId: string;
  }): Promise<void> {
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post(
        URL.fromString("https://slack.com/api/conversations.invite"),
        {
          channel: data.channelId,
          users: data.userId,
        },
        {
          Authorization: `Bearer ${data.authToken}`,
        },
      );

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      throw new BadRequestException("Invalid response");
    }
  }

  public static async createChannelsIfDoesNotExist(data: {
    authToken: string;
    channelNames: Array<string>;
  }): Promise<Array<WorkspaceChannel>> {
    // check existing channels and only create if they dont exist.
    const workspaceChannels: Array<WorkspaceChannel> = [];
    const existingWorkspaceChannels: Dictionary<WorkspaceChannel> =
      await this.getChannels({
        authToken: data.authToken,
      });

    for (const channelName of data.channelNames) {
      if (existingWorkspaceChannels[channelName]) {
        logger.debug(`Channel ${channelName} already exists.`);

        workspaceChannels.push(existingWorkspaceChannels[channelName]!);

        continue;
      }

      const channel: WorkspaceChannel = await this.createChannel({
        authToken: data.authToken,
        channelName: channelName,
      });

      if (channel) {
        workspaceChannels.push(channel);
      }
    }

    return workspaceChannels;
  }

  public static async getWorkspaceChannelFromChannelId(data: {
    authToken: string;
    channelId: string;
  }): Promise<WorkspaceChannel> {
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get<JSONObject>(
        URL.fromString("https://slack.com/api/conversations.info"),
        {
          headers: {
            Authorization: `Bearer ${data.authToken}`,
          },
          params: {
            channel: data.channelId,
          },
        },
      );

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    if (
      !((response.jsonData as JSONObject)?.["channel"] as JSONObject)?.["name"]
    ) {
      throw new Error("Invalid response");
    }

    return {
      name: ((response.jsonData as JSONObject)["channel"] as JSONObject)[
        "name"
      ] as string,
      id: data.channelId,
    }
  }

  public static async getAllWorkspaceChannels(data: {
    authToken: string;
  }): Promise<Dictionary<WorkspaceChannel>> {
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get<JSONObject>(
        URL.fromString("https://slack.com/api/conversations.list"),
        {
          headers: {
            Authorization: `Bearer ${data.authToken}`,
          },
        },
      );

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    const channels: Dictionary<WorkspaceChannel> = {};

    for (const channel of (response.jsonData as JSONObject)[
      "channels"
    ] as Array<JSONObject>) {
      if (!channel["id"] || !channel["name"]) {
        continue;
      }

      channels[channel["name"].toString()] = {
        id: channel["id"] as string,
        name: channel["name"] as string,
      };
    }

    return channels;
  }


  public static async sendMessage(data: {
    workspaceMessagePayload: WorkspaceMessagePayload;
    authToken: string; // which auth token should we use to send.
  }): Promise<void> {
    logger.debug("Notify Slack");
    logger.debug(data);

    const blocks: Array<JSONObject> =
      this.getWorkspacelocksFromWorkspaceMessagePayload(
        data.workspaceMessagePayload,
      );

    const existingWorkspaceChannels: Dictionary<WorkspaceChannel> =
      await this.getAllWorkspaceChannels({
        authToken: data.authToken,
      });

    const channelIdsToPostTo: Array<string> = [];

    for (const channelName of data.workspaceMessagePayload.channelNames) {
      // get channel ids from existingWorkspaceChannels. IF channel doesn't exist, create it if createChannelsIfItDoesNotExist is true.
      let channel: WorkspaceChannel | null = null;

      if (existingWorkspaceChannels[channelName]) {
        channel = existingWorkspaceChannels[channelName]!;
      }

      if (channel) {
        channelIdsToPostTo.push(channel.id);
      } else {
        logger.debug(`Channel ${channelName} does not exist.`);
      }
    }

    for (const channelId of channelIdsToPostTo) {
      try {
        // try catch here to prevent failure of one channel to prevent posting to other channels.
        await this.sendPayloadBlocksToChannel({
          authToken: data.authToken,
          channelId: channelId,
          blocks: blocks,
        });
      } catch (e) {
        logger.error(e);
      }
    }
  }

  private static async sendPayloadBlocksToChannel(data: {
    authToken: string;
    channelId: string;
    blocks: Array<JSONObject>;
  }): Promise<void> {
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post(
        URL.fromString("https://slack.com/api/chat.postMessage"),
        {
          channel: data.channelId,
          blocks: data.blocks,
        },
        {
          Authorization: `Bearer ${data.authToken}`,
        },
      );

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      throw new BadRequestException("Invalid response");
    }
  }

  public static async createChannel(data: {
    authToken: string;
    channelName: string;
  }): Promise<WorkspaceChannel> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post(
        URL.fromString("https://slack.com/api/conversations.create"),
        {
          name: data.channelName,
        },
        {
          Authorization: `Bearer ${data.authToken}`,
        },
      );

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    if (
      !((response.jsonData as JSONObject)?.["channel"] as JSONObject)?.["id"] ||
      !((response.jsonData as JSONObject)?.["channel"] as JSONObject)?.["name"]
    ) {
      throw new Error("Invalid response");
    }

    return {
      id: ((response.jsonData as JSONObject)["channel"] as JSONObject)[
        "id"
      ] as string,
      name: ((response.jsonData as JSONObject)["channel"] as JSONObject)[
        "name"
      ] as string,
    };
  }

  public static getHeaderBlock(data: {
    payloadHeaderBlock: WorkspacePayloadHeader;
  }): JSONObject {
    return {
      type: "header",
      text: {
        type: "plain_text",
        text: data.payloadHeaderBlock.text,
      },
    };
  }

  public static getMarkdownBlock(data: {
    payloadMarkdownBlock: WorkspacePayloadMarkdown;
  }): JSONObject {
    return {
      type: "section",
      text: {
        type: "mrkdwn",
        text: data.payloadMarkdownBlock.text,
      },
    };
  }

  public static getButtonBlock(data: {
    payloadButtonBlock: WorkspaceMessagePayloadButton;
  }): JSONObject {
    return {
      type: "button",
      text: {
        type: "plain_text",
        text: data.payloadButtonBlock.title,
      },
      value: data.payloadButtonBlock.title,
      action_id: data.payloadButtonBlock.title,
    };
  }

  public static async sendMessageToChannelViaIncomingWebhook(data: {
    url: URL;
    text: string;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    let apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse | null = null;

    // https://api.slack.com/messaging/webhooks#advanced_message_formatting
    apiResult = await API.post(data.url, {
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${data.text}`,
          },
        },
      ],
    });

    return apiResult;
  }


}
