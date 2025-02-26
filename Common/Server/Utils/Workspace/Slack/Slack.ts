import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import WorkspaceMessagePayload, {
  WorkspaceMessagePayloadButton,
  WorkspacePayloadHeader,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import logger from "../../Logger";
import Dictionary from "../../../../Types/Dictionary";
import BadRequestException from "../../../../Types/Exception/BadRequestException";
import WorkspaceBase, { WorkspaceChannel } from "../WorkspaceBase";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

export default class SlackUtil extends WorkspaceBase {
  public static override async joinChannel(data: {
    authToken: string;
    channelId: string;
  }): Promise<void> {
    logger.debug("Joining channel with data:");
    logger.debug(data);

    // Join channel
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post(
        URL.fromString("https://slack.com/api/conversations.join"),
        {
          channel: data.channelId,
        },
        {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
      );

    logger.debug("Response from Slack API for joining channel:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:");
      logger.error(response);
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      throw new BadRequestException("Invalid response");
    }

    logger.debug("Channel joined successfully with data:");
    logger.debug(data);
  }

  public static override async inviteUserToChannelByChannelId(data: {
    authToken: string;
    channelId: string;
    workspaceUserId: string;
  }): Promise<void> {
    logger.debug("Inviting user to channel with data:");
    logger.debug(data);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post(
        URL.fromString("https://slack.com/api/conversations.invite"),
        {
          channel: data.channelId,
          users: data.workspaceUserId,
        },
        {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
      );

    logger.debug("Response from Slack API for inviting user:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:");
      logger.error(response);
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      throw new BadRequestException("Invalid response");
    }

    logger.debug("User invited to channel successfully.");
  }

  public static override async inviteUserToChannelByChannelName(data: {
    authToken: string;
    channelName: string;
    workspaceUserId: string;
  }): Promise<void> {
    if (data.channelName && data.channelName.startsWith("#")) {
      // trim # from channel name
      data.channelName = data.channelName.substring(1);
    }

    logger.debug("Inviting user to channel with data:");
    logger.debug(data);

    const channelId: string = (
      await this.getWorkspaceChannelFromChannelName({
        authToken: data.authToken,
        channelName: data.channelName,
      })
    ).id;

    return this.inviteUserToChannelByChannelId({
      authToken: data.authToken,
      channelId: channelId,
      workspaceUserId: data.workspaceUserId,
    });
  }

  public static override async createChannelsIfDoesNotExist(data: {
    authToken: string;
    channelNames: Array<string>;
  }): Promise<Array<WorkspaceChannel>> {
    logger.debug("Creating channels if they do not exist with data:");
    logger.debug(data);

    const workspaceChannels: Array<WorkspaceChannel> = [];
    const existingWorkspaceChannels: Dictionary<WorkspaceChannel> =
      await this.getAllWorkspaceChannels({
        authToken: data.authToken,
      });

    logger.debug("Existing workspace channels:");
    logger.debug(existingWorkspaceChannels);

    for (let channelName of data.channelNames) {
      // if channel name starts with #, remove it
      if (channelName && channelName.startsWith("#")) {
        channelName = channelName.substring(1);
      }

      if (existingWorkspaceChannels[channelName]) {
        logger.debug(`Channel ${channelName} already exists.`);
        workspaceChannels.push(existingWorkspaceChannels[channelName]!);
        continue;
      }

      logger.debug(`Channel ${channelName} does not exist. Creating channel.`);
      const channel: WorkspaceChannel = await this.createChannel({
        authToken: data.authToken,
        channelName: channelName,
      });

      if (channel) {
        logger.debug(`Channel ${channelName} created successfully.`);
        workspaceChannels.push(channel);
      }
    }

    logger.debug("Channels created or found:");
    logger.debug(workspaceChannels);
    return workspaceChannels;
  }

  public static override async getWorkspaceChannelFromChannelName(data: {
    authToken: string;
    channelName: string;
  }): Promise<WorkspaceChannel> {
    logger.debug("Getting workspace channel ID from channel name with data:");
    logger.debug(data);

    const channels: Dictionary<WorkspaceChannel> =
      await this.getAllWorkspaceChannels({
        authToken: data.authToken,
      });

    logger.debug("All workspace channels:");
    logger.debug(channels);

    if (!channels[data.channelName]) {
      logger.error("Channel not found.");
      throw new Error("Channel not found.");
    }

    logger.debug("Workspace channel ID obtained:");
    logger.debug(channels[data.channelName]!.id);

    return channels[data.channelName]!;
  }

  public static override async getWorkspaceChannelFromChannelId(data: {
    authToken: string;
    channelId: string;
  }): Promise<WorkspaceChannel> {
    logger.debug("Getting workspace channel from channel ID with data:");
    logger.debug(data);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>(
        URL.fromString("https://slack.com/api/conversations.info"),
        {
          channel: data.channelId,
        },
        {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
      );

    logger.debug("Response from Slack API for getting channel info:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:");
      logger.error(response);
      throw response;
    }

    // check for ok response
    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      throw new BadRequestException("Invalid response");
    }

    if (
      !((response.jsonData as JSONObject)?.["channel"] as JSONObject)?.["name"]
    ) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      throw new Error("Invalid response");
    }

    const channel: WorkspaceChannel = {
      name: ((response.jsonData as JSONObject)["channel"] as JSONObject)[
        "name"
      ] as string,
      id: data.channelId,
      workspaceType: WorkspaceType.Slack,
    };

    logger.debug("Workspace channel obtained:");
    logger.debug(channel);
    return channel;
  }

  public static override async getAllWorkspaceChannels(data: {
    authToken: string;
  }): Promise<Dictionary<WorkspaceChannel>> {
    logger.debug("Getting all workspace channels with data:");
    logger.debug(data);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>(
        URL.fromString("https://slack.com/api/conversations.list"),
        {},
        {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
      );

    logger.debug("Response from Slack API for getting all channels:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:");
      logger.error(response);
      throw response;
    }

    // check for ok response
    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      throw new BadRequestException("Invalid response");
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
        workspaceType: WorkspaceType.Slack,
      };
    }

    logger.debug("All workspace channels obtained:");
    logger.debug(channels);
    return channels;
  }

  public static override async sendMessage(data: {
    workspaceMessagePayload: WorkspaceMessagePayload;
    authToken: string; // which auth token should we use to send.
    userId: string;
  }): Promise<void> {
    logger.debug("Sending message to Slack with data:");
    logger.debug(data);

    const blocks: Array<JSONObject> = this.getBlocksFromWorkspaceMessagePayload(
      data.workspaceMessagePayload,
    );

    logger.debug("Blocks generated from workspace message payload:");
    logger.debug(blocks);

    const existingWorkspaceChannels: Dictionary<WorkspaceChannel> =
      await this.getAllWorkspaceChannels({
        authToken: data.authToken,
      });

    logger.debug("Existing workspace channels:");
    logger.debug(existingWorkspaceChannels);

    const channelIdsToPostTo: Array<string> = [];

    for (let channelName of data.workspaceMessagePayload.channelNames) {
      if (channelName && channelName.startsWith("#")) {
        // trim # from channel name
        channelName = channelName.substring(1);
      }

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

    logger.debug("Channel IDs to post to:");
    logger.debug(channelIdsToPostTo);

    for (const channelId of channelIdsToPostTo) {
      try {
        // check if the user is in the channel.
        const isUserInChannel: boolean = await this.isUserInChannel({
          authToken: data.authToken,
          channelId: channelId,
          userId: data.userId,
        });

        if (!isUserInChannel) {
          // add user to the channel
          await this.joinChannel({
            authToken: data.authToken,
            channelId: channelId,
          });
        }

        await this.sendPayloadBlocksToChannel({
          authToken: data.authToken,
          channelId: channelId,
          blocks: blocks,
        });

        logger.debug(`Message sent to channel ID ${channelId} successfully.`);
      } catch (e) {
        logger.error(`Error sending message to channel ID ${channelId}:`);
        logger.error(e);
      }
    }
  }

  public static override async sendPayloadBlocksToChannel(data: {
    authToken: string;
    channelId: string;
    blocks: Array<JSONObject>;
  }): Promise<void> {
    logger.debug("Sending payload blocks to channel with data:");
    logger.debug(JSON.stringify(data, null, 2));

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post(
        URL.fromString("https://slack.com/api/chat.postMessage"),
        {
          channel: data.channelId,
          blocks: data.blocks,
        },
        {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
      );

    logger.debug("Response from Slack API for sending message:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:");
      logger.error(response);
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      throw new BadRequestException("Invalid response");
    }

    logger.debug("Payload blocks sent to channel successfully.");
  }

  public static override async createChannel(data: {
    authToken: string;
    channelName: string;
  }): Promise<WorkspaceChannel> {
    logger.debug("Creating channel with data:");
    logger.debug(data);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post(
        URL.fromString("https://slack.com/api/conversations.create"),
        {
          name: data.channelName,
        },
        {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
      );

    logger.debug("Response from Slack API for creating channel:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:");
      logger.error(response);
      throw response;
    }

    // check for ok response
    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      throw new BadRequestException("Invalid response");
    }

    if (
      !((response.jsonData as JSONObject)?.["channel"] as JSONObject)?.["id"] ||
      !((response.jsonData as JSONObject)?.["channel"] as JSONObject)?.["name"]
    ) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      throw new Error("Invalid response");
    }

    const channel: WorkspaceChannel = {
      id: ((response.jsonData as JSONObject)["channel"] as JSONObject)[
        "id"
      ] as string,
      name: ((response.jsonData as JSONObject)["channel"] as JSONObject)[
        "name"
      ] as string,
      workspaceType: WorkspaceType.Slack,
    };

    logger.debug("Channel created successfully:");
    logger.debug(channel);
    return channel;
  }

  public static override getHeaderBlock(data: {
    payloadHeaderBlock: WorkspacePayloadHeader;
  }): JSONObject {
    logger.debug("Getting header block with data:");
    logger.debug(data);

    const headerBlock: JSONObject = {
      type: "header",
      text: {
        type: "plain_text",
        text: data.payloadHeaderBlock.text,
      },
    };

    logger.debug("Header block generated:");
    logger.debug(headerBlock);
    return headerBlock;
  }

  public static override getMarkdownBlock(data: {
    payloadMarkdownBlock: WorkspacePayloadMarkdown;
  }): JSONObject {
    logger.debug("Getting markdown block with data:");
    logger.debug(data);

    const markdownBlock: JSONObject = {
      type: "section",
      text: {
        type: "mrkdwn",
        text: data.payloadMarkdownBlock.text,
      },
    };

    logger.debug("Markdown block generated:");
    logger.debug(markdownBlock);
    return markdownBlock;
  }

  public static override async isUserInChannel(data: {
    authToken: string;
    channelId: string;
    userId: string;
  }): Promise<boolean> {
    const members: Array<string> = [];

    logger.debug("Checking if user is in channel with data:");
    logger.debug(data);

    let cursor: string | undefined = undefined;

    do {
      // check if the user is in the channel, return true if they are, false if they are not

      const requestBody: JSONObject = {
        channel: data.channelId,
        limit: 1000,
      };

      if (cursor) {
        requestBody["cursor"] = cursor;
      }

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>(
          URL.fromString("https://slack.com/api/conversations.members"),
          requestBody,
          {
            Authorization: `Bearer ${data.authToken}`,
            ["Content-Type"]: "application/x-www-form-urlencoded",
          },
        );

      logger.debug("Response from Slack API for getting channel members:");
      logger.debug(response);

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Slack API:");
        logger.error(response);
        throw response;
      }

      // check for ok response

      if ((response.jsonData as JSONObject)?.["ok"] !== true) {
        logger.error("Invalid response from Slack API:");
        logger.error(response.jsonData);
        throw new BadRequestException("Invalid response");
      }

      // check if the user is in the channel
      const membersOnThisPage: Array<string> = (
        response.jsonData as JSONObject
      )["members"] as Array<string>;

      members.push(...membersOnThisPage);

      cursor = (
        (response.jsonData as JSONObject)["response_metadata"] as JSONObject
      )?.["next_cursor"] as string;
    } while (cursor);

    if (members.includes(data.userId)) {
      return true;
    }

    return false;
  }

  public static override getButtonBlock(data: {
    payloadButtonBlock: WorkspaceMessagePayloadButton;
  }): JSONObject {
    logger.debug("Getting button block with data:");
    logger.debug(data);

    const buttonBlock: JSONObject = {
      type: "button",
      text: {
        type: "plain_text",
        text: data.payloadButtonBlock.title,
      },
      value: data.payloadButtonBlock.title,
      action_id: data.payloadButtonBlock.title,
    };

    logger.debug("Button block generated:");
    logger.debug(buttonBlock);
    return buttonBlock;
  }

  public static override async sendMessageToChannelViaIncomingWebhook(data: {
    url: URL;
    text: string;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    logger.debug("Sending message to channel via incoming webhook with data:");
    logger.debug(data);

    const apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse | null =
      await API.post(data.url, {
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

    logger.debug("Response from Slack API for sending message via webhook:");
    logger.debug(apiResult);
    return apiResult;
  }
}
