import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import WorkspaceMessagePayload, {
  WorkspaceMessageBlock,
  WorkspaceModalBlock,
  WorkspacePayloadMarkdown,
  WorkspacePayloadHeader,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspaceTextAreaBlock,
  WorkspaceTextBoxBlock,
  WorkspacePayloadImage,
  WorkspaceDropdownBlock,
  WorkspaceCheckboxBlock,
  WorkspaceDateTimePickerBlock,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import logger from "../../Logger";
import Dictionary from "../../../../Types/Dictionary";
import WorkspaceBase, {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../WorkspaceBase";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import OneUptimeDate from "../../../../Types/Date";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import BadDataException from "../../../../Types/Exception/BadDataException";

export default class MicrosoftTeams extends WorkspaceBase {
  @CaptureSpan()
  public static override async getAllWorkspaceChannels(data: {
    authToken: string;
  }): Promise<Dictionary<WorkspaceChannel>> {
    logger.debug("Getting all workspace channels with data:");
    logger.debug(data);

    const channels: Dictionary<WorkspaceChannel> = {};
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get<JSONObject>(
        URL.fromString("https://graph.microsoft.com/v1.0/me/joinedTeams"),
        {
          Authorization: `Bearer ${data.authToken}`,
        },
      );

    logger.debug("Response from Microsoft Graph API for getting all channels:");
    logger.debug(JSON.stringify(response, null, 2));

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Microsoft Graph API:");
      logger.error(response);
      throw response;
    }

    for (const team of (response.jsonData as JSONObject)?.[
      "value"
    ] as Array<JSONObject>) {
      if (!team["id"] || !team["displayName"]) {
        continue;
      }

      channels[team["displayName"].toString()] = {
        id: team["id"] as string,
        name: team["displayName"] as string,
        workspaceType: WorkspaceType.MicrosoftTeams,
      };
    }

    logger.debug("All workspace channels obtained:");
    logger.debug(channels);
    return channels;
  }

  @CaptureSpan()
  public static override getDividerBlock(): JSONObject {
    return {
      type: "divider",
    };
  }

  @CaptureSpan()
  public static getValuesFromView(data: {
    view: JSONObject;
  }): Dictionary<string | number | Array<string | number> | Date> {
    logger.debug("Getting values from view with data:");
    logger.debug(JSON.stringify(data, null, 2));

    const teamsView: JSONObject = data.view;
    const values: Dictionary<string | number | Array<string | number> | Date> =
      {};

    if (!teamsView["state"] || !(teamsView["state"] as JSONObject)["values"]) {
      return {};
    }

    for (const valueId in (teamsView["state"] as JSONObject)[
      "values"
    ] as JSONObject) {
      for (const blockId in (
        (teamsView["state"] as JSONObject)["values"] as JSONObject
      )[valueId] as JSONObject) {
        const valueObject: JSONObject = (
          (teamsView["state"] as JSONObject)["values"] as JSONObject
        )[valueId] as JSONObject;
        const value: JSONObject = valueObject[blockId] as JSONObject;
        values[blockId] = value["value"] as string | number;

        if ((value["selected_option"] as JSONObject)?.["value"]) {
          values[blockId] = (value["selected_option"] as JSONObject)?.[
            "value"
          ] as string;
        }

        if (Array.isArray(value["selected_options"])) {
          values[blockId] = (
            value["selected_options"] as Array<JSONObject>
          ).map((option: JSONObject) => {
            return option["value"] as string | number;
          });
        }

        // if date picker
        if (value["selected_date_time"]) {
          values[blockId] = OneUptimeDate.fromUnixTimestamp(
            value["selected_date_time"] as number,
          );
        }
      }
    }

    logger.debug("Values obtained from view:");
    logger.debug(values);

    return values;
  }

  @CaptureSpan()
  public static override async inviteUserToChannelByChannelName(data: {
    authToken: string;
    channelName: string;
    workspaceUserId: string;
  }): Promise<void> {
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

  @CaptureSpan()
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

      // convert channel name to lowercase
      channelName = channelName.toLowerCase();

      // replace spaces with hyphens
      channelName = channelName.replace(/\s+/g, "-");

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

  @CaptureSpan()
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
      throw new BadDataException("Channel not found.");
    }

    logger.debug("Workspace channel ID obtained:");
    logger.debug(channels[data.channelName]!.id);

    return channels[data.channelName]!;
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelId(data: {
    authToken: string;
    channelId: string;
  }): Promise<WorkspaceChannel> {
    logger.debug("Getting workspace channel from channel ID with data:");
    logger.debug(data);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get<JSONObject>(
        URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${data.channelId}`,
        ),
        {
          Authorization: `Bearer ${data.authToken}`,
        },
      );

    logger.debug("Response from Microsoft Graph API for getting channel info:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Microsoft Graph API:");
      logger.error(response);
      throw response;
    }

    if (!(response.jsonData as JSONObject)?.["displayName"]) {
      logger.error("Invalid response from Microsoft Graph API:");
      logger.error(response.jsonData);
      throw new Error("Invalid response");
    }

    const channel: WorkspaceChannel = {
      name: (response.jsonData as JSONObject)["displayName"] as string,
      id: data.channelId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    };

    logger.debug("Workspace channel obtained:");
    logger.debug(channel);
    return channel;
  }

  @CaptureSpan()
  public static override async doesChannelExist(data: {
    authToken: string;
    channelName: string;
  }): Promise<boolean> {
    // if channel name starts with #, remove it
    if (data.channelName && data.channelName.startsWith("#")) {
      data.channelName = data.channelName.substring(1);
    }

    // convert channel name to lowercase
    data.channelName = data.channelName.toLowerCase();

    // get channel id from channel name
    const channels: Dictionary<WorkspaceChannel> =
      await this.getAllWorkspaceChannels({
        authToken: data.authToken,
      });

    // if this channel exists
    if (channels[data.channelName]) {
      return true;
    }

    return false;
  }

  @CaptureSpan()
  public static override async sendMessage(data: {
    workspaceMessagePayload: WorkspaceMessagePayload;
    authToken: string; // which auth token should we use to send.
    userId: string;
  }): Promise<WorkspaceSendMessageResponse> {
    logger.debug("Sending message to Microsoft Teams with data:");
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

    // add channel ids.
    for (const channelId of data.workspaceMessagePayload.channelIds) {
      const channel: WorkspaceChannel = {
        id: channelId,
        name: "",
        workspaceType: WorkspaceType.MicrosoftTeams,
      };

      workspaceChannelsToPostTo.push(channel);
    }

    logger.debug("Channel IDs to post to:");
    logger.debug(workspaceChannelsToPostTo);

    const workspaceMessageResponse: WorkspaceSendMessageResponse = {
      threads: [],
      workspaceType: WorkspaceType.MicrosoftTeams,
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

        workspaceMessageResponse.threads.push(thread);

        logger.debug(`Message sent to channel ID ${channel.id} successfully.`);
      } catch (e) {
        logger.error(`Error sending message to channel ID ${channel.id}:`);
        logger.error(e);
      }
    }

    logger.debug("Message sent successfully.");
    logger.debug(workspaceMessageResponse);

    return workspaceMessageResponse;
  }

  @CaptureSpan()
  public static override async isUserInDirectMessageChannel(data: {
    authToken: string;
    userId: string;
    directMessageChannelId: string;
  }): Promise<boolean> {
    logger.debug("Checking if user is in direct message channel with data:");
    logger.debug(data);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get<JSONObject>(
        URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${data.directMessageChannelId}/members/${data.userId}`,
        ),
        {
          Authorization: `Bearer ${data.authToken}`,
        },
      );

    logger.debug("Response from Microsoft Graph API for checking user in DM:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      // If user not found in channel, return false
      if (response.statusCode === 404) {
        return false;
      }
      logger.error("Error response from Microsoft Graph API:");
      logger.error(response);
      throw response;
    }

    return true;
  }

  @CaptureSpan()
  public static override async archiveChannels(data: {
    channelIds: Array<string>;
    authToken: string;
    userId: string;
    sendMessageBeforeArchiving: WorkspacePayloadMarkdown;
  }): Promise<void> {
    logger.debug("Archiving channels with data:");
    logger.debug(data);

    if (data.sendMessageBeforeArchiving) {
      await this.sendMessage({
        workspaceMessagePayload: {
          _type: "WorkspaceMessagePayload",
          channelNames: [],
          channelIds: data.channelIds,
          messageBlocks: [data.sendMessageBeforeArchiving],
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        authToken: data.authToken,
        userId: data.userId,
      });
    }

    for (const channelId of data.channelIds) {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.patch<JSONObject>(
          URL.fromString(`https://graph.microsoft.com/v1.0/teams/${channelId}`),
          {
            isArchived: true,
          },
          {
            Authorization: `Bearer ${data.authToken}`,
            ["Content-Type"]: "application/json",
          },
        );

      logger.debug("Response from Microsoft Graph API for archiving team:");
      logger.debug(response);

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        throw response;
      }
    }

    logger.debug("Channels archived successfully.");
  }

  @CaptureSpan()
  public static override async getUsernameFromUserId(data: {
    authToken: string;
    userId: string;
  }): Promise<string | null> {
    logger.debug("Getting username from user ID with data:");
    logger.debug(data);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get<JSONObject>(
        URL.fromString(`https://graph.microsoft.com/v1.0/users/${data.userId}`),
        {
          Authorization: `Bearer ${data.authToken}`,
        },
      );

    logger.debug("Response from Microsoft Graph API for getting user info:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Microsoft Graph API:");
      logger.error(response);
      return null;
    }

    if (!(response.jsonData as JSONObject)?.["displayName"]) {
      logger.error("Invalid response from Microsoft Graph API:");
      logger.error(response.jsonData);
      return null;
    }

    const username: string = (response.jsonData as JSONObject)[
      "displayName"
    ] as string;

    logger.debug("Username obtained:");
    logger.debug(username);
    return username;
  }

  @CaptureSpan()
  public static override async showModalToUser(data: {
    authToken: string;
    triggerId: string;
    modalBlock: WorkspaceModalBlock;
  }): Promise<void> {
    logger.debug("Showing modal to user with data:");
    logger.debug(data);

    // Microsoft Teams doesn't have the same modal concept as Slack
    // We'll convert the modal to an Adaptive Card and send it as a message
    const adaptiveCard = this.getModalBlock({
      payloadModalBlock: data.modalBlock,
    });

    logger.debug("Adaptive card generated:");
    logger.debug(JSON.stringify(adaptiveCard, null, 2));

    // Send the adaptive card as a message to the user
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>(
        URL.fromString(
          `https://graph.microsoft.com/v1.0/chats/${data.triggerId}/messages`,
        ),
        {
          body: {
            content: JSON.stringify(adaptiveCard),
            contentType: "html",
          },
        },
        {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
      );

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Microsoft Graph API:");
      logger.error(response);
      throw response;
    }

    logger.debug("Modal shown to user successfully.");
  }

  @CaptureSpan()
  public static override async sendDirectMessageToUser(data: {
    authToken: string;
    workspaceUserId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): Promise<void> {
    logger.debug("Sending direct message to user with data:");
    logger.debug(data);

    const blocks: Array<JSONObject> = this.getBlocksFromWorkspaceMessagePayload(
      {
        messageBlocks: data.messageBlocks,
      },
    );

    // First, create a chat with the user
    const chatResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>(
        URL.fromString("https://graph.microsoft.com/v1.0/chats"),
        {
          chatType: "oneOnOne",
          members: [
            {
              "@odata.type": "#microsoft.graph.aadUserConversationMember",
              "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${data.workspaceUserId}')`,
            },
          ],
        },
        {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
      );

    if (chatResponse instanceof HTTPErrorResponse) {
      logger.error("Error creating chat:");
      logger.error(chatResponse);
      throw chatResponse;
    }

    const chatId = (chatResponse.jsonData as JSONObject)["id"] as string;

    // Send the message to the chat
    await this.sendPayloadBlocksToChannel({
      authToken: data.authToken,
      workspaceChannel: {
        id: chatId,
        name: "",
        workspaceType: WorkspaceType.MicrosoftTeams,
      },
      blocks: blocks,
    });
  }

  @CaptureSpan()
  public static override async joinChannel(data: {
    authToken: string;
    channelId: string;
  }): Promise<void> {
    logger.debug("Joining channel with data:");
    logger.debug(data);

    // Get current user info
    const userResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get<JSONObject>(
        URL.fromString("https://graph.microsoft.com/v1.0/me"),
        {
          Authorization: `Bearer ${data.authToken}`,
        },
      );

    if (userResponse instanceof HTTPErrorResponse) {
      logger.error("Error getting current user:");
      logger.error(userResponse);
      throw userResponse;
    }

    const userId = (userResponse.jsonData as JSONObject)["id"] as string;

    // Add the current user to the team
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>(
        URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${data.channelId}/members`,
        ),
        {
          "@odata.type": "#microsoft.graph.aadUserConversationMember",
          "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${userId}')`,
        },
        {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
      );

    logger.debug("Response from Microsoft Graph API for joining team:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Microsoft Graph API:");
      logger.error(response);
      throw response;
    }

    logger.debug("Channel joined successfully with data:");
    logger.debug(data);
  }

  @CaptureSpan()
  public static override async sendPayloadBlocksToChannel(data: {
    authToken: string;
    workspaceChannel: WorkspaceChannel;
    blocks: Array<JSONObject>;
  }): Promise<WorkspaceThread> {
    logger.debug("Sending payload blocks to channel with data:");
    logger.debug(JSON.stringify(data, null, 2));

    // Convert blocks to Teams message format
    const messageBody = this.convertBlocksToTeamsMessage(data.blocks);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>(
        URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${data.workspaceChannel.id}/channels/general/messages`,
        ),
        {
          body: messageBody,
        },
        {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
      );

    logger.debug("Response from Microsoft Graph API for sending message:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Microsoft Graph API:");
      logger.error(response);
      throw response;
    }

    logger.debug("Payload blocks sent to channel successfully.");

    return {
      channel: data.workspaceChannel,
      threadId: (response.jsonData as JSONObject)["id"] as string,
    };
  }

  @CaptureSpan()
  public static override async inviteUserToChannelByChannelId(data: {
    authToken: string;
    channelId: string;
    workspaceUserId: string;
  }): Promise<void> {
    logger.debug("Inviting user to channel by channel ID with data:");
    logger.debug(data);

    // Check if user is already in the team
    const isUserInChannel: boolean = await this.isUserInChannel({
      authToken: data.authToken,
      channelId: data.channelId,
      userId: data.workspaceUserId,
    });

    if (isUserInChannel) {
      logger.debug("User already in channel.");
      return;
    }

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>(
        URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${data.channelId}/members`,
        ),
        {
          "@odata.type": "#microsoft.graph.aadUserConversationMember",
          "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${data.workspaceUserId}')`,
        },
        {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
      );

    logger.debug("Response from Microsoft Graph API for inviting user:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Microsoft Graph API:");
      logger.error(response);
      throw response;
    }

    logger.debug("User invited to channel successfully.");
  }

  @CaptureSpan()
  public static override async createChannel(data: {
    authToken: string;
    channelName: string;
  }): Promise<WorkspaceChannel> {
    if (data.channelName && data.channelName.startsWith("#")) {
      data.channelName = data.channelName.substring(1);
    }

    // Convert to lowercase and replace spaces with hyphens
    data.channelName = data.channelName.toLowerCase().replace(/\s+/g, "-");

    logger.debug("Creating team with data:");
    logger.debug(data);

    // Create a new team in Microsoft Teams
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>(
        URL.fromString("https://graph.microsoft.com/v1.0/teams"),
        {
          "template@odata.bind":
            "https://graph.microsoft.com/v1.0/teamsTemplates('standard')",
          displayName: data.channelName,
          description: `Team created by OneUptime for ${data.channelName}`,
        },
        {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
      );

    logger.debug("Response from Microsoft Graph API for creating team:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Microsoft Graph API:");
      logger.error(response);
      throw response;
    }

    // Get the created team's ID from the Location header or response
    const teamId = (response.jsonData as JSONObject)["id"] as string;

    const channel: WorkspaceChannel = {
      id: teamId,
      name: data.channelName,
      workspaceType: WorkspaceType.MicrosoftTeams,
    };

    logger.debug("Team created successfully:");
    logger.debug(channel);
    return channel;
  }

  @CaptureSpan()
  public static override async isUserInChannel(data: {
    authToken: string;
    channelId: string;
    userId: string;
  }): Promise<boolean> {
    logger.debug("Checking if user is in channel with data:");
    logger.debug(data);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get<JSONObject>(
        URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${data.channelId}/members/${data.userId}`,
        ),
        {
          Authorization: `Bearer ${data.authToken}`,
        },
      );

    logger.debug("Response from Microsoft Graph API for checking user in team:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      // If user not found in team, return false
      if (response.statusCode === 404) {
        return false;
      }
      logger.error("Error response from Microsoft Graph API:");
      logger.error(response);
      throw response;
    }

    return true;
  }

  @CaptureSpan()
  public static override async sendMessageToChannelViaIncomingWebhook(data: {
    url: URL;
    text: string;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    logger.debug("Sending message to channel via incoming webhook with data:");
    logger.debug(data);

    const apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post(data.url, {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        text: data.text,
      });

    logger.debug("Response from Teams webhook for sending message:");
    logger.debug(apiResult);
    return apiResult;
  }

  // Helper method to convert blocks to Teams message format
  private static convertBlocksToTeamsMessage(
    blocks: Array<JSONObject>,
  ): JSONObject {
    let content = "";
    
    for (const block of blocks) {
      if (block["type"] === "section" && block["text"]) {
        const textObj = block["text"] as JSONObject;
        content += `${textObj["text"] || ""}\n`;
      } else if (block["type"] === "divider") {
        content += "---\n";
      } else if (block["type"] === "actions" && block["elements"]) {
        // Convert buttons to markdown links
        for (const element of block["elements"] as Array<JSONObject>) {
          if (element["type"] === "button") {
            const textObj = element["text"] as JSONObject;
            const buttonText = textObj ? (textObj["text"] as string) || "Button" : "Button";
            const buttonUrl = element["url"] as string || "#";
            content += `[${buttonText}](${buttonUrl})\n`;
          }
        }
      }
    }

    return {
      content: content,
      contentType: "text",
    };
  }

  // UI Block Generation Methods

  @CaptureSpan()
  public static override getHeaderBlock(data: {
    payloadHeaderBlock: WorkspacePayloadHeader;
  }): JSONObject {
    return {
      type: "TextBlock",
      text: data.payloadHeaderBlock.text,
      weight: "Bolder",
      size: "Large",
      wrap: true,
    };
  }

  @CaptureSpan()
  public static override getMarkdownBlock(data: {
    payloadMarkdownBlock: WorkspacePayloadMarkdown;
  }): JSONObject {
    return {
      type: "TextBlock",
      text: data.payloadMarkdownBlock.text,
      wrap: true,
      markdown: true,
    };
  }

  @CaptureSpan()
  public static override getButtonBlock(data: {
    payloadButtonBlock: WorkspaceMessagePayloadButton;
  }): JSONObject {
    const button: JSONObject = {
      type: "Action.OpenUrl",
      title: data.payloadButtonBlock.title,
    };

    if (data.payloadButtonBlock.url) {
      button["url"] = data.payloadButtonBlock.url.toString();
    }

    // Teams doesn't have style properties like Slack, so we'll use default styling
    return button;
  }

  @CaptureSpan()
  public static override getButtonsBlock(data: {
    payloadButtonsBlock: WorkspacePayloadButtons;
  }): JSONObject {
    const actions: Array<JSONObject> = [];

    for (const button of data.payloadButtonsBlock.buttons) {
      actions.push(this.getButtonBlock({ payloadButtonBlock: button }));
    }

    return {
      type: "ActionSet",
      actions: actions,
    };
  }

  @CaptureSpan()
  public static override getTextAreaBlock(data: {
    payloadTextAreaBlock: WorkspaceTextAreaBlock;
  }): JSONObject {
    return {
      type: "Input.Text",
      id: data.payloadTextAreaBlock.blockId,
      placeholder: data.payloadTextAreaBlock.placeholder || "",
      isMultiline: true,
      label: data.payloadTextAreaBlock.label || "",
      isRequired: !data.payloadTextAreaBlock.optional,
      value: data.payloadTextAreaBlock.initialValue || "",
    };
  }

  @CaptureSpan()
  public static override getTextBoxBlock(data: {
    payloadTextBoxBlock: WorkspaceTextBoxBlock;
  }): JSONObject {
    return {
      type: "Input.Text",
      id: data.payloadTextBoxBlock.blockId,
      placeholder: data.payloadTextBoxBlock.placeholder || "",
      isMultiline: false,
      label: data.payloadTextBoxBlock.label || "",
      isRequired: !data.payloadTextBoxBlock.optional,
      value: data.payloadTextBoxBlock.initialValue || "",
    };
  }

  @CaptureSpan()
  public static override getImageBlock(data: {
    payloadImageBlock: WorkspacePayloadImage;
  }): JSONObject {
    return {
      type: "Image",
      url: data.payloadImageBlock.imageUrl.toString(),
      altText: data.payloadImageBlock.altText || "",
      size: "Medium",
    };
  }

  @CaptureSpan()
  public static override getDropdownBlock(data: {
    payloadDropdownBlock: WorkspaceDropdownBlock;
  }): JSONObject {
    const choices: Array<JSONObject> = [];

    for (const option of data.payloadDropdownBlock.options) {
      choices.push({
        title: option.label,
        value: option.value,
      });
    }

    return {
      type: "Input.ChoiceSet",
      id: data.payloadDropdownBlock.blockId,
      label: data.payloadDropdownBlock.placeholder || "",
      isRequired: !data.payloadDropdownBlock.optional,
      choices: choices,
      style: "compact",
    };
  }

  @CaptureSpan()
  public static override getModalBlock(data: {
    payloadModalBlock: WorkspaceModalBlock;
  }): JSONObject {
    const body: Array<JSONObject> = [];

    // Add title as header
    if (data.payloadModalBlock.title) {
      body.push({
        type: "TextBlock",
        text: data.payloadModalBlock.title,
        weight: "Bolder",
        size: "Large",
      });
    }

    // Convert blocks to Teams format
    for (const block of data.payloadModalBlock.blocks) {
      const convertedBlock = this.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [block],
      });
      body.push(...convertedBlock);
    }

    // Add submit action if specified
    const actions: Array<JSONObject> = [];
    if (data.payloadModalBlock.submitButtonTitle) {
      actions.push({
        type: "Action.Submit",
        title: data.payloadModalBlock.submitButtonTitle,
        data: { actionId: data.payloadModalBlock.actionId, actionValue: data.payloadModalBlock.actionValue },
      });
    }

    return {
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      type: "AdaptiveCard",
      version: "1.3",
      body: body,
      actions: actions.length > 0 ? actions : undefined,
    };
  }

  @CaptureSpan()
  public static override getCheckboxBlock(data: {
    payloadCheckboxBlock: WorkspaceCheckboxBlock;
  }): JSONObject {
    return {
      type: "Input.Toggle",
      id: data.payloadCheckboxBlock.blockId,
      title: data.payloadCheckboxBlock.label || "",
      value: data.payloadCheckboxBlock.initialValue ? "true" : "false",
      valueOn: "true",
      valueOff: "false",
    };
  }

  @CaptureSpan()
  public static override getDateTimePickerBlock(data: {
    payloadDateTimePickerBlock: WorkspaceDateTimePickerBlock;
  }): JSONObject {
    return {
      type: "Input.Date",
      id: data.payloadDateTimePickerBlock.blockId,
      label: data.payloadDateTimePickerBlock.label || "",
      isRequired: !data.payloadDateTimePickerBlock.optional,
      value: data.payloadDateTimePickerBlock.initialValue || undefined,
    };
  }
}
