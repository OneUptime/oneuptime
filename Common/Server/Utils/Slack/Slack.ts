import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import WorkspaceNotificationPayload, {
  WorkspaceNotificationPayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadHeader,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceNotificationPayload";
import logger from "../Logger";
import Dictionary from "../../../Types/Dictionary";
import BadRequestException from "../../../Types/Exception/BadRequestException";

export interface JobResponse {
  isSuccessful: boolean;
  errorMessage?: string | undefined;
}

export interface SlackChannel {
  id: string;
  name: string;
}

export default class SlackUtil {
  public static async sendMessage(data: {
    workspaceNotificationPayload: WorkspaceNotificationPayload;
    authToken: string; // which auth token should we use to send.
  }): Promise<void> {
    logger.debug("Notify Slack");
    logger.debug(data);

    const blocks: Array<JSONObject> =
      this.getSlackBlocksFromWorkspaceNotificationPayload(
        data.workspaceNotificationPayload,
      );

    const existingSlackChannels: Dictionary<SlackChannel> =
      await this.getSlackChannels({
        authToken: data.authToken,
      });

    const channelIdsToPostTo: Array<string> = data.workspaceNotificationPayload.channelIds || [];

    for (const channelName of data.workspaceNotificationPayload.channelNames) {
      // get channel ids from existingSlackChannels. IF channel doesn't exist, create it if createChannelsIfItDoesNotExist is true.
      let channel: SlackChannel | null = null;

      if (existingSlackChannels[channelName]) {
        channel = existingSlackChannels[channelName]!;
      } else if (
        data.workspaceNotificationPayload.createChannelsIfItDoesNotExist
      ) {
        channel = await this.createChannel({
          authToken: data.authToken,
          channelName: channelName,
        });
      }

      if (channel) {
        channelIdsToPostTo.push(channel.id);
      } else {
        logger.debug(
          `Channel ${channelName} does not exist and createChannelsIfItDoesNotExist is false.`,
        );
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

  public static async sendPayloadBlocksToChannel(data: {
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
  }): Promise<SlackChannel> {
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

  public static async getSlackChannels(data: {
    authToken: string;
  }): Promise<Dictionary<SlackChannel>> {
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

    const channels: Dictionary<SlackChannel> = {};

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

  public static getButtonBlock(data: {
    payloadButtonBlock: WorkspaceNotificationPayloadButton;
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

  private static getSlackBlocksFromWorkspaceNotificationPayload(
    data: WorkspaceNotificationPayload,
  ): Array<JSONObject> {
    const blocks: Array<JSONObject> = [];
    const buttons: Array<JSONObject> = [];
    for (const block of data.blocks) {
      switch (block._type) {
        case "WorkspacePayloadHeader":
          blocks.push(
            this.getHeaderBlock({
              payloadHeaderBlock: block as WorkspacePayloadHeader,
            }),
          );
          break;
        case "WorkspacePayloadMarkdown":
          blocks.push(
            this.getMarkdownBlock({
              payloadMarkdownBlock: block as WorkspacePayloadMarkdown,
            }),
          );
          break;
        case "WorkspacePayloadButtons":
          for (const button of (block as WorkspacePayloadButtons).buttons) {
            buttons.push(
              this.getButtonBlock({
                payloadButtonBlock: button,
              }),
            );
          }
          blocks.push({
            type: "actions",
            elements: buttons,
          });
          break;
        default:
          logger.error("Unknown block type: " + block._type);
          break;
      }
    }
    return blocks;
  }
}
