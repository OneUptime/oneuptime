import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import WorkspaceMessagePayload, {
  WorkspaceDropdownBlock,
  WorkspaceMessagePayloadButton,
  WorkspaceModalBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadHeader,
  WorkspacePayloadImage,
  WorkspacePayloadMarkdown,
  WorkspaceTextAreaBlock,
  WorkspaceTextBoxBlock,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import logger from "../../Logger";
import Dictionary from "../../../../Types/Dictionary";
import BadRequestException from "../../../../Types/Exception/BadRequestException";
import WorkspaceBase, {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../WorkspaceBase";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import SlackifyMarkdown from "slackify-markdown";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";

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

  public static override getDividerBlock(): JSONObject {
    return {
      type: "divider",
    };
  }

  public static override async sendMessage(data: {
    workspaceMessagePayload: WorkspaceMessagePayload;
    authToken: string; // which auth token should we use to send.
    userId: string;
  }): Promise<WorkspaceSendMessageResponse> {
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

    const workspaceChannelsToPostTo: Array<WorkspaceChannel> = [];

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
        workspaceChannelsToPostTo.push(channel);
      } else {
        logger.debug(`Channel ${channelName} does not exist.`);
      }
    }

    logger.debug("Channel IDs to post to:");
    logger.debug(workspaceChannelsToPostTo);

    const workspaspaceMessageResponse: WorkspaceSendMessageResponse = {
      threads: [],
    };

    for (const channel of workspaceChannelsToPostTo) {
      try {
        // check if the user is in the channel.
        const isUserInChannel: boolean = await this.isUserInChannel({
          authToken: data.authToken,
          channelId: channel.id,
          userId: data.userId,
        });

        if (!isUserInChannel) {
          // add user to the channel
          await this.joinChannel({
            authToken: data.authToken,
            channelId: channel.id,
          });
        }

        const thread: WorkspaceThread = await this.sendPayloadBlocksToChannel({
          authToken: data.authToken,
          workspaceChannel: channel,
          blocks: blocks,
        });

        workspaspaceMessageResponse.threads.push(thread);

        logger.debug(`Message sent to channel ID ${channel.id} successfully.`);
      } catch (e) {
        logger.error(`Error sending message to channel ID ${channel.id}:`);
        logger.error(e);
      }
    }

    logger.debug("Message sent successfully.");
    logger.debug(workspaspaceMessageResponse);

    return workspaspaceMessageResponse;
  }

  public static override async sendPayloadBlocksToChannel(data: {
    authToken: string;
    workspaceChannel: WorkspaceChannel;
    blocks: Array<JSONObject>;
  }): Promise<WorkspaceThread> {
    logger.debug("Sending payload blocks to channel with data:");
    logger.debug(JSON.stringify(data, null, 2));

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post(
        URL.fromString("https://slack.com/api/chat.postMessage"),
        {
          channel: data.workspaceChannel.id,
          blocks: data.blocks,
          unfurl_links: false,
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

    return {
      channel: data.workspaceChannel,
      threadId: (response.jsonData as JSONObject)["ts"] as string,
    };
  }

  public static override getButtonsBlock(data: {
    payloadButtonsBlock: WorkspacePayloadButtons;
  }): JSONObject {
    logger.debug("Getting buttons block with data:");
    logger.debug(data);

    const buttonsBlock: JSONObject = {
      type: "actions",
      elements: data.payloadButtonsBlock.buttons.map(
        (button: WorkspaceMessagePayloadButton) => {
          return this.getButtonBlock({ payloadButtonBlock: button });
        },
      ),
    };

    logger.debug("Buttons block generated:");
    logger.debug(buttonsBlock);
    return buttonsBlock;
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

  public static override getTextAreaBlock(data: {
    payloadTextAreaBlock: WorkspaceTextAreaBlock;
  }): JSONObject {
    logger.debug("Getting text area block with data:");
    logger.debug(data);

    const textAreaBlock: JSONObject = {
      type: "input",
      element: {
        type: "plain_text_input",
        action_id: data.payloadTextAreaBlock.blockId,
        placeholder: {
          type: "plain_text",
          text: data.payloadTextAreaBlock.placeholder,
        },
        initial_value: data.payloadTextAreaBlock.initialValue,
      },
      label: {
        type: "plain_text",
        text: data.payloadTextAreaBlock.label,
      },
    };

    logger.debug("Text area block generated:");
    logger.debug(textAreaBlock);
    return textAreaBlock;
  }

  public static override getTextBoxBlock(data: {
    payloadTextBoxBlock: WorkspaceTextBoxBlock;
  }): JSONObject {
    logger.debug("Getting text box block with data:");
    logger.debug(data);

    const textBoxBlock: JSONObject = {
      type: "input",
      element: {
        type: "plain_text_input",
        action_id: data.payloadTextBoxBlock.blockId,
        placeholder: {
          type: "plain_text",
          text: data.payloadTextBoxBlock.placeholder,
        },
        initial_value: data.payloadTextBoxBlock.initialValue,
      },
      label: {
        type: "plain_text",
        text: data.payloadTextBoxBlock.label,
      },
    };

    logger.debug("Text box block generated:");
    logger.debug(textBoxBlock);
    return textBoxBlock;
  }

  public static override getImageBlock(data: {
    payloadImageBlock: WorkspacePayloadImage;
  }): JSONObject {
    logger.debug("Getting image block with data:");
    logger.debug(data);

    const imageBlock: JSONObject = {
      type: "image",
      image_url: data.payloadImageBlock.imageUrl.toString(),
      alt_text: data.payloadImageBlock.altText,
    };

    logger.debug("Image block generated:");
    logger.debug(imageBlock);
    return imageBlock;
  }

  public static override getDropdownBlock(data: {
    payloadDropdownBlock: WorkspaceDropdownBlock;
  }): JSONObject {
    logger.debug("Getting dropdown block with data:");
    logger.debug(data);

    const dropdownBlock: JSONObject = {
      type: "input",
      element: {
        type: "static_select",
        action_id: data.payloadDropdownBlock.blockId,
        placeholder: {
          type: "plain_text",
          text: data.payloadDropdownBlock.placeholder,
        },
        options: data.payloadDropdownBlock.options.map(
          (option: DropdownOption) => {
            return {
              text: {
                type: "plain_text",
                text: option.label,
              },
              value: option.value,
            };
          },
        ),
        initial_option: data.payloadDropdownBlock.initialValue
          ? {
              text: {
                type: "plain_text",
                text: data.payloadDropdownBlock.initialValue,
              },
              value: data.payloadDropdownBlock.initialValue,
            }
          : undefined,
      },
      label: {
        type: "plain_text",
        text: data.payloadDropdownBlock.label,
      },
    };

    logger.debug("Dropdown block generated:");
    logger.debug(dropdownBlock);
    return dropdownBlock;
  }

  public static override getModalBlock(data: {
    payloadModalBlock: WorkspaceModalBlock;
  }): JSONObject {
    logger.debug("Getting modal block with data:");
    logger.debug(data);

    const modalBlock: JSONObject = {
      type: "modal",
      title: {
        type: "plain_text",
        text: data.payloadModalBlock.title,
      },
      submit: {
        type: "plain_text",
        text: data.payloadModalBlock.submitButtonTitle,
        action_id: data.payloadModalBlock.submitButtonActionId,
        value: data.payloadModalBlock.submitButtonActionId,
      },
      close: {
        type: "plain_text",
        text: data.payloadModalBlock.cancelButtonTitle,
      },
      blocks: this.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: data.payloadModalBlock.blocks,
      }),
    };

    logger.debug("Modal block generated:");
    logger.debug(modalBlock);
    return modalBlock;
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
        text: data.payloadMarkdownBlock.text
          ? SlackifyMarkdown(data.payloadMarkdownBlock.text)
          : "",
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
        emoji: true,
      },
      value: data.payloadButtonBlock.value,
      action_id: data.payloadButtonBlock.actionId,
      url: data.payloadButtonBlock.url
        ? data.payloadButtonBlock.url.toString()
        : undefined,
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
