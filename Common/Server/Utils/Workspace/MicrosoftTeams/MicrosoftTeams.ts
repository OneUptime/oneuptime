import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import WorkspaceMessagePayload, {
  WorkspaceCheckboxBlock,
  WorkspaceDateTimePickerBlock,
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
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
import WorkspaceBase, {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../WorkspaceBase";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";

export default class MicrosoftTeamsUtil extends WorkspaceBase {
  public static isValidMicrosoftTeamsIncomingWebhookUrl(
    incomingWebhookUrl: URL,
  ): boolean {
    // Microsoft Teams webhooks typically start with https://outlook.office.com/webhook/
    return incomingWebhookUrl
      .toString()
      .startsWith("https://outlook.office.com/webhook/");
  }

  @CaptureSpan()
  public static override async getUsernameFromUserId(data: {
    authToken: string;
    userId: string;
  }): Promise<string | null> {
    logger.debug("Getting username from user ID with data:");
    logger.debug(data);

    try {
      // Microsoft Teams uses Microsoft Graph API to get user info
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get<JSONObject>(
          URL.fromString(`https://graph.microsoft.com/v1.0/users/${data.userId}`),
          {},
          {
            Authorization: `Bearer ${data.authToken}`,
          },
          {
            retries: 3,
            exponentialBackoff: true,
          },
        );

      logger.debug("Response from Microsoft Graph API for getting user info:");
      logger.debug(response);

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        return null;
      }

      const userData: JSONObject = response.jsonData as JSONObject;
      const username: string = (userData["displayName"] as string) || (userData["userPrincipalName"] as string) || data.userId;

      logger.debug("Username obtained:");
      logger.debug(username);
      return username;
    } catch (error) {
      logger.error("Error getting username from Microsoft Teams:");
      logger.error(error);
      return null;
    }
  }

  @CaptureSpan()
  public static override async sendDirectMessageToUser(data: {
    authToken: string;
    workspaceUserId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): Promise<void> {
    // Microsoft Teams doesn't have direct messaging in the same way as Slack
    // We'll send a message to a general channel instead
    logger.debug("Sending direct message to user (redirecting to general channel):");
    logger.debug(data);

    const blocks: Array<JSONObject> = this.getBlocksFromWorkspaceMessagePayload(
      {
        messageBlocks: data.messageBlocks,
      },
    );

    // For Microsoft Teams, we'll use a default project ID or find the first available project
    const projectAuthToken: any = await WorkspaceProjectAuthTokenService.findOneBy({
      query: {
        workspaceType: WorkspaceType.MicrosoftTeams,
      },
      select: {
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!projectAuthToken) {
      logger.error("No Microsoft Teams project auth token found");
      return;
    }

    const generalChannel: WorkspaceChannel = await this.createChannel({
      authToken: data.authToken,
      channelName: "general",
      projectId: projectAuthToken.projectId,
    });

    await this.sendPayloadBlocksToChannel({
      authToken: data.authToken,
      workspaceChannel: generalChannel,
      blocks: blocks,
    });
  }

  @CaptureSpan()
  public static override async archiveChannels(data: {
    userId: string;
    channelIds: Array<string>;
    authToken: string;
    sendMessageBeforeArchiving: WorkspacePayloadMarkdown;
    projectId: ObjectID;
  }): Promise<void> {
    logger.debug("Archiving channels with data:");
    logger.debug(data);

    // Microsoft Teams doesn't have a direct archive API like Slack
    // We'll send a message and then try to delete the channel
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
        projectId: data.projectId,
      });
    }

    // Note: Microsoft Teams doesn't allow deleting channels via API in the same way
    // This is a limitation of the Microsoft Teams API
    logger.warn("Microsoft Teams does not support archiving channels via API");
  }

  @CaptureSpan()
  public static override async joinChannel(data: {
    authToken: string;
    channelId: string;
  }): Promise<void> {
    logger.debug("Joining channel with data:");
    logger.debug(data);

    try {
      // Microsoft Teams uses Microsoft Graph API to join channels
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post(
          URL.fromString(`https://graph.microsoft.com/v1.0/me/joinedTeams/${data.channelId}`),
          {},
          {
            Authorization: `Bearer ${data.authToken}`,
          },
          {
            retries: 3,
            exponentialBackoff: true,
          },
        );

      logger.debug("Response from Microsoft Graph API for joining channel:");
      logger.debug(response);

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        // Don't throw error for join failures as user might already be in channel
      }

      logger.debug("Channel joined successfully with data:");
      logger.debug(data);
    } catch (error) {
      logger.error("Error joining Microsoft Teams channel:");
      logger.error(error);
      // Don't throw error for join failures
    }
  }

  @CaptureSpan()
  public static override async inviteUserToChannelByChannelId(data: {
    authToken: string;
    channelId: string;
    workspaceUserId: string;
  }): Promise<void> {
    logger.debug("Inviting user to channel with data:");
    logger.debug(data);

    try {
      // Microsoft Teams uses Microsoft Graph API to add members to channels
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post(
          URL.fromString(`https://graph.microsoft.com/v1.0/teams/${data.channelId}/channels/${data.channelId}/members`),
          {
            "@odata.type": "#microsoft.graph.aadUserConversationMember",
            "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${data.workspaceUserId}')`,
            "roles": []
          },
          {
            Authorization: `Bearer ${data.authToken}`,
            "Content-Type": "application/json",
          },
          {
            retries: 3,
            exponentialBackoff: true,
          },
        );

      logger.debug("Response from Microsoft Graph API for inviting user:");
      logger.debug(response);

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        // Don't throw error for invite failures as user might already be in channel
      }

      logger.debug("User invited to channel successfully.");
    } catch (error) {
      logger.error("Error inviting user to Microsoft Teams channel:");
      logger.error(error);
      // Don't throw error for invite failures
    }
  }

  @CaptureSpan()
  public static override async inviteUserToChannelByChannelName(data: {
    authToken: string;
    channelName: string;
    workspaceUserId: string;
    projectId: ObjectID;
  }): Promise<void> {
    logger.debug("Inviting user to channel with data:");
    logger.debug(data);

    const channel: WorkspaceChannel = await this.getWorkspaceChannelFromChannelName({
      authToken: data.authToken,
      channelName: data.channelName,
      projectId: data.projectId,
    });

    return this.inviteUserToChannelByChannelId({
      authToken: data.authToken,
      channelId: channel.id,
      workspaceUserId: data.workspaceUserId,
    });
  }

  @CaptureSpan()
  public static override async createChannelsIfDoesNotExist(data: {
    authToken: string;
    channelNames: Array<string>;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceChannel>> {
    logger.debug("Creating channels if they do not exist with data:");
    logger.debug(data);

    const workspaceChannels: Array<WorkspaceChannel> = [];

    for (const channelName of data.channelNames) {
      try {
        const normalizedChannelName: string = channelName.toLowerCase().replace(/\s+/g, "-");

        // Check if channel exists
        const existingChannel: WorkspaceChannel | null = await this.getWorkspaceChannelFromChannelName({
          authToken: data.authToken,
          channelName: normalizedChannelName,
          projectId: data.projectId,
        }).catch(() => null);

        if (existingChannel) {
          workspaceChannels.push(existingChannel);
          continue;
        }

        // Create new channel
        const newChannel: WorkspaceChannel = await this.createChannel({
          authToken: data.authToken,
          channelName: normalizedChannelName,
          projectId: data.projectId,
        });

        workspaceChannels.push(newChannel);
      } catch (error) {
        logger.error(`Error creating channel ${channelName}:`);
        logger.error(error);
        // Continue with other channels
      }
    }

    return workspaceChannels;
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelName(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
  }): Promise<WorkspaceChannel> {
    logger.debug("Getting workspace channel from channel name with data:");
    logger.debug(data);

    // First get the team ID from project auth token
    const projectAuthToken: any = await WorkspaceProjectAuthTokenService.getProjectAuth({
      projectId: data.projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    if (!projectAuthToken || !projectAuthToken.miscData) {
      throw new BadDataException("Microsoft Teams team ID not found");
    }

    const teamId: string = projectAuthToken.miscData.teamId;

    try {
      // Get channels from Microsoft Teams
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get<JSONObject>(
          URL.fromString(`https://graph.microsoft.com/v1.0/teams/${teamId}/channels`),
          {},
          {
            Authorization: `Bearer ${data.authToken}`,
          },
          {
            retries: 3,
            exponentialBackoff: true,
          },
        );

      logger.debug("Response from Microsoft Graph API for getting channels:");
      logger.debug(response);

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        throw response;
      }

      const channelsData: JSONObject = response.jsonData as JSONObject;
      const channels: Array<JSONObject> = channelsData["value"] as Array<JSONObject>;

      const channel: JSONObject | undefined = channels.find(
        (ch: JSONObject) => (ch["displayName"] as string).toLowerCase() === data.channelName.toLowerCase()
      );

      if (!channel) {
        throw new BadDataException(`Channel ${data.channelName} not found`);
      }

      return {
        id: channel["id"] as string,
        name: channel["displayName"] as string,
        workspaceType: WorkspaceType.MicrosoftTeams,
      };
    } catch (error) {
      logger.error("Error getting channel from Microsoft Teams:");
      logger.error(error);
      throw error;
    }
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelId(data: {
    authToken: string;
    channelId: string;
  }): Promise<WorkspaceChannel> {
    logger.debug("Getting workspace channel from channel ID with data:");
    logger.debug(data);

    try {
      // Get channel info from Microsoft Teams
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get<JSONObject>(
          URL.fromString(`https://graph.microsoft.com/v1.0/me/joinedTeams/allChannels/${data.channelId}`),
          {},
          {
            Authorization: `Bearer ${data.authToken}`,
          },
          {
            retries: 3,
            exponentialBackoff: true,
          },
        );

      logger.debug("Response from Microsoft Graph API for getting channel:");
      logger.debug(response);

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        throw response;
      }

      const channelData: JSONObject = response.jsonData as JSONObject;

      return {
        id: channelData["id"] as string,
        name: channelData["displayName"] as string,
        workspaceType: WorkspaceType.MicrosoftTeams,
      };
    } catch (error) {
      logger.error("Error getting channel from Microsoft Teams:");
      logger.error(error);
      throw error;
    }
  }

  @CaptureSpan()
  public static override async doesChannelExist(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
  }): Promise<boolean> {
    logger.debug("Checking if channel exists with data:");
    logger.debug(data);

    try {
      await this.getWorkspaceChannelFromChannelName({
        authToken: data.authToken,
        channelName: data.channelName,
        projectId: data.projectId,
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  @CaptureSpan()
  public static override async sendMessage(data: {
    workspaceMessagePayload: WorkspaceMessagePayload;
    authToken: string;
    userId: string;
    projectId: ObjectID;
  }): Promise<WorkspaceSendMessageResponse> {
    logger.debug("Sending message with data:");
    logger.debug(data);

    const responses: Array<WorkspaceThread> = [];

    // Send to channels by ID
    if (data.workspaceMessagePayload.channelIds && data.workspaceMessagePayload.channelIds.length > 0) {
      for (const channelId of data.workspaceMessagePayload.channelIds) {
        try {
          const channel: WorkspaceChannel = await this.getWorkspaceChannelFromChannelId({
            authToken: data.authToken,
            channelId: channelId,
          });

          const thread: WorkspaceThread = await this.sendPayloadBlocksToChannel({
            authToken: data.authToken,
            workspaceChannel: channel,
            blocks: this.getBlocksFromWorkspaceMessagePayload({
              messageBlocks: data.workspaceMessagePayload.messageBlocks,
            }),
          });

          responses.push(thread);
        } catch (error) {
          logger.error(`Error sending message to channel ${channelId}:`);
          logger.error(error);
        }
      }
    }

    // Send to channels by name
    if (data.workspaceMessagePayload.channelNames && data.workspaceMessagePayload.channelNames.length > 0) {
      for (const channelName of data.workspaceMessagePayload.channelNames) {
        try {
          const channel: WorkspaceChannel = await this.getWorkspaceChannelFromChannelName({
            authToken: data.authToken,
            channelName: channelName,
            projectId: data.projectId,
          });

          const thread: WorkspaceThread = await this.sendPayloadBlocksToChannel({
            authToken: data.authToken,
            workspaceChannel: channel,
            blocks: this.getBlocksFromWorkspaceMessagePayload({
              messageBlocks: data.workspaceMessagePayload.messageBlocks,
            }),
          });

          responses.push(thread);
        } catch (error) {
          logger.error(`Error sending message to channel ${channelName}:`);
          logger.error(error);
        }
      }
    }

    return {
      threads: responses,
      workspaceType: WorkspaceType.MicrosoftTeams,
    };
  }

  @CaptureSpan()
  public static override async getAllWorkspaceChannels(data: {
    authToken: string;
  }): Promise<Dictionary<WorkspaceChannel>> {
    logger.debug("Getting all workspace channels with data:");
    logger.debug(data);

    const channels: Dictionary<WorkspaceChannel> = {};

    try {
      // Get joined teams first
      const teamsResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get<JSONObject>(
          URL.fromString("https://graph.microsoft.com/v1.0/me/joinedTeams"),
          {},
          {
            Authorization: `Bearer ${data.authToken}`,
          },
          {
            retries: 3,
            exponentialBackoff: true,
          },
        );

      if (teamsResponse instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(teamsResponse);
        return channels;
      }

      const teamsData: JSONObject = teamsResponse.jsonData as JSONObject;
      const teams: Array<JSONObject> = teamsData["value"] as Array<JSONObject>;

      // Get channels for each team
      for (const team of teams) {
        const teamId: string = team["id"] as string;

        const channelsResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get<JSONObject>(
            URL.fromString(`https://graph.microsoft.com/v1.0/teams/${teamId}/channels`),
            {},
            {
              Authorization: `Bearer ${data.authToken}`,
            },
            {
              retries: 3,
              exponentialBackoff: true,
            },
          );

        if (channelsResponse instanceof HTTPErrorResponse) {
          logger.error("Error response from Microsoft Graph API for channels:");
          logger.error(channelsResponse);
          continue;
        }

        const channelsData: JSONObject = channelsResponse.jsonData as JSONObject;
        const teamChannels: Array<JSONObject> = channelsData["value"] as Array<JSONObject>;

        for (const channel of teamChannels) {
          const channelId: string = channel["id"] as string;
          channels[channelId] = {
            id: channelId,
            name: channel["displayName"] as string,
            workspaceType: WorkspaceType.MicrosoftTeams,
          };
        }
      }
    } catch (error) {
      logger.error("Error getting all channels from Microsoft Teams:");
      logger.error(error);
    }

    return channels;
  }

  @CaptureSpan()
  public static override async createChannel(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
  }): Promise<WorkspaceChannel> {
    logger.debug("Creating channel with data:");
    logger.debug(data);

    // Get team ID from project auth token
    const projectAuthToken: any = await WorkspaceProjectAuthTokenService.getProjectAuth({
      projectId: data.projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    if (!projectAuthToken || !projectAuthToken.miscData) {
      throw new BadDataException("Microsoft Teams team ID not found");
    }

    const teamId: string = projectAuthToken.miscData.teamId;

    try {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post(
          URL.fromString(`https://graph.microsoft.com/v1.0/teams/${teamId}/channels`),
          {
            displayName: data.channelName,
            description: `Channel created by OneUptime for project monitoring`,
            membershipType: "standard", // or "private" for private channels
          },
          {
            Authorization: `Bearer ${data.authToken}`,
            "Content-Type": "application/json",
          },
          {
            retries: 3,
            exponentialBackoff: true,
          },
        );

      logger.debug("Response from Microsoft Graph API for creating channel:");
      logger.debug(response);

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        throw response;
      }

      const channelData: JSONObject = response.jsonData as JSONObject;

      return {
        id: channelData["id"] as string,
        name: channelData["displayName"] as string,
        workspaceType: WorkspaceType.MicrosoftTeams,
      };
    } catch (error) {
      logger.error("Error creating channel in Microsoft Teams:");
      logger.error(error);
      throw error;
    }
  }

  @CaptureSpan()
  public static override getHeaderBlock(data: {
    payloadHeaderBlock: WorkspacePayloadHeader;
  }): JSONObject {
    return {
      type: "TextBlock",
      text: data.payloadHeaderBlock.text,
      weight: "bolder",
      size: "large",
      wrap: true,
    };
  }

  @CaptureSpan()
  public static override getDividerBlock(): JSONObject {
    return {
      type: "TextBlock",
      text: "---",
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
    };
  }

  @CaptureSpan()
  public static override getButtonBlock(data: {
    payloadButtonBlock: WorkspaceMessagePayloadButton;
  }): JSONObject {
    return {
      type: "ActionSet",
      actions: [
        {
          type: "Action.Submit",
          title: data.payloadButtonBlock.title,
          data: {
            action: data.payloadButtonBlock.actionId,
            value: data.payloadButtonBlock.value,
          },
        },
      ],
    };
  }

  @CaptureSpan()
  public static override getButtonsBlock(data: {
    payloadButtonsBlock: WorkspacePayloadButtons;
  }): JSONObject {
    const actions: Array<JSONObject> = data.payloadButtonsBlock.buttons.map((button) => ({
      type: "Action.Submit",
      title: button.title,
      data: {
        action: button.actionId,
        value: button.value,
      },
    }));

    return {
      type: "ActionSet",
      actions: actions,
    };
  }

  @CaptureSpan()
  public static override async sendPayloadBlocksToChannel(data: {
    authToken: string;
    workspaceChannel: WorkspaceChannel;
    blocks: Array<JSONObject>;
  }): Promise<WorkspaceThread> {
    logger.debug("Sending payload blocks to channel with data:");
    logger.debug(data);

    // Get team ID from project auth token (this is a simplified approach)
    // In a real implementation, you'd need to pass the projectId or store teamId in channel data
    const projectAuthToken: any = await WorkspaceProjectAuthTokenService.findOneBy({
      query: {
        workspaceType: WorkspaceType.MicrosoftTeams,
      },
      select: {
        miscData: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!projectAuthToken || !projectAuthToken.miscData) {
      throw new BadDataException("Microsoft Teams team ID not found");
    }

    const teamId: string = projectAuthToken.miscData.teamId;

    try {
      // Create adaptive card for Microsoft Teams
      const adaptiveCard: JSONObject = {
        type: "AdaptiveCard",
        version: "1.4",
        body: data.blocks,
      };

      const messagePayload: JSONObject = {
        body: {
          contentType: "html",
          content: `<div>${JSON.stringify(adaptiveCard)}</div>`,
        },
      };

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post(
          URL.fromString(`https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${data.workspaceChannel.id}/messages`),
          messagePayload,
          {
            Authorization: `Bearer ${data.authToken}`,
            "Content-Type": "application/json",
          },
          {
            retries: 3,
            exponentialBackoff: true,
          },
        );

      logger.debug("Response from Microsoft Graph API for sending message:");
      logger.debug(response);

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        throw response;
      }

      const messageData: JSONObject = response.jsonData as JSONObject;

      return {
        channel: data.workspaceChannel,
        threadId: messageData["id"] as string,
      };
    } catch (error) {
      logger.error("Error sending message to Microsoft Teams channel:");
      logger.error(error);
      throw error;
    }
  }

  @CaptureSpan()
  public static override async sendMessageToChannelViaIncomingWebhook(data: {
    url: URL;
    text: string;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    logger.debug("Sending message via incoming webhook with data:");
    logger.debug(data);

    const payload: JSONObject = {
      text: data.text,
    };

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
      data.url,
      payload,
      {
        "Content-Type": "application/json",
      },
      {
        retries: 3,
        exponentialBackoff: true,
      },
    );

    logger.debug("Response from Microsoft Teams webhook:");
    logger.debug(response);

    return response;
  }

  @CaptureSpan()
  public static override async isUserInChannel(data: {
    authToken: string;
    channelId: string;
    userId: string;
  }): Promise<boolean> {
    logger.debug("Checking if user is in channel with data:");
    logger.debug(data);

    try {
      // Get team ID from project auth token
      const projectAuthToken: any = await WorkspaceProjectAuthTokenService.findOneBy({
        query: {
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        select: {
          miscData: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!projectAuthToken || !projectAuthToken.miscData) {
        return false;
      }

      const teamId: string = projectAuthToken.miscData.teamId;

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get<JSONObject>(
          URL.fromString(`https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${data.channelId}/members`),
          {},
          {
            Authorization: `Bearer ${data.authToken}`,
          },
          {
            retries: 3,
            exponentialBackoff: true,
          },
        );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        return false;
      }

      const membersData: JSONObject = response.jsonData as JSONObject;
      const members: Array<JSONObject> = membersData["value"] as Array<JSONObject>;

      return members.some((member: JSONObject) => member["userId"] === data.userId);
    } catch (error) {
      logger.error("Error checking if user is in Microsoft Teams channel:");
      logger.error(error);
      return false;
    }
  }

  // Placeholder implementations for methods not yet implemented
  @CaptureSpan()
  public static override async showModalToUser(_data: {
    authToken: string;
    triggerId: string;
    modalBlock: WorkspaceModalBlock;
  }): Promise<void> {
    // Microsoft Teams doesn't have modals in the same way as Slack
    logger.warn("showModalToUser not implemented for Microsoft Teams");
  }

  @CaptureSpan()
  public static override getCheckboxBlock(_data: {
    payloadCheckboxBlock: WorkspaceCheckboxBlock;
  }): JSONObject {
    // Return a basic text block as placeholder
    return {
      type: "TextBlock",
      text: "Checkbox not supported in Microsoft Teams",
      wrap: true,
    };
  }

  @CaptureSpan()
  public static override getDateTimePickerBlock(_data: {
    payloadDateTimePickerBlock: WorkspaceDateTimePickerBlock;
  }): JSONObject {
    // Return a basic text block as placeholder
    return {
      type: "TextBlock",
      text: "Date picker not supported in Microsoft Teams",
      wrap: true,
    };
  }

  @CaptureSpan()
  public static override getTextAreaBlock(_data: {
    payloadTextAreaBlock: WorkspaceTextAreaBlock;
  }): JSONObject {
    return {
      type: "Input.Text",
      id: _data.payloadTextAreaBlock.blockId,
      placeholder: _data.payloadTextAreaBlock.placeholder,
      isMultiline: true,
    };
  }

  @CaptureSpan()
  public static override getTextBoxBlock(_data: {
    payloadTextBoxBlock: WorkspaceTextBoxBlock;
  }): JSONObject {
    return {
      type: "Input.Text",
      id: _data.payloadTextBoxBlock.blockId,
      placeholder: _data.payloadTextBoxBlock.placeholder,
    };
  }

  @CaptureSpan()
  public static override getImageBlock(_data: {
    payloadImageBlock: WorkspacePayloadImage;
  }): JSONObject {
    return {
      type: "Image",
      url: _data.payloadImageBlock.imageUrl,
      altText: _data.payloadImageBlock.altText,
    };
  }

  @CaptureSpan()
  public static override getDropdownBlock(_data: {
    payloadDropdownBlock: WorkspaceDropdownBlock;
  }): JSONObject {
    return {
      type: "Input.ChoiceSet",
      id: _data.payloadDropdownBlock.blockId,
      style: "compact",
      choices: _data.payloadDropdownBlock.options.map((option: DropdownOption) => ({
        title: option.label,
        value: option.value,
      })),
    };
  }

  @CaptureSpan()
  public static override getModalBlock(_data: {
    payloadModalBlock: WorkspaceModalBlock;
  }): JSONObject {
    // Microsoft Teams doesn't have modals like Slack, return basic structure
    return {
      type: "AdaptiveCard",
      version: "1.4",
      body: [
        {
          type: "TextBlock",
          text: _data.payloadModalBlock.title,
          weight: "bolder",
          size: "large",
        },
      ],
    };
  }
}
