import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import logger from "../../Logger";
import WorkspaceBase, {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../WorkspaceBase";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import Dictionary from "../../../../Types/Dictionary";
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
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import BadRequestException from "../../../../Types/Exception/BadRequestException";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, { MicrosoftTeamsMiscData } from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";

export default class MicrosoftTeams extends WorkspaceBase {
  private static buildMessageCardFromMarkdown(markdown: string): JSONObject {
    // Teams MessageCard has limited markdown support. Headings like '##' are not supported
    // and single newlines can collapse. Convert common patterns to a structured card.
    const lines: Array<string> = markdown
      .split("\n")
      .map((l: string) => {
        return l.trim();
      })
      .filter((l: string) => {
        return l.length > 0;
      });

    let title: string = "";
    const facts: Array<JSONObject> = [];
    const actions: Array<JSONObject> = [];
    const bodyTextParts: Array<string> = [];

    // Extract title from the first non-empty line and strip markdown heading markers
    if (lines.length > 0) {
      const firstLine: string = lines[0] ?? "";
      title = firstLine
        .replace(/^#+\s*/, "") // remove leading markdown headers like ##
        .replace(/^\*\*|\*\*$/g, "") // remove stray bold markers if any
        .trim();
      lines.shift();
    }

    const linkRegex: RegExp = /\[([^\]]+)\]\(([^)]+)\)/g; // [text](url)

    for (const line of lines) {
      // Extract links to actions and strip them from text
      let lineWithoutLinks: string = line;
      let match: RegExpExecArray | null = null;
      while ((match = linkRegex.exec(line))) {
        const name: string = match[1] ?? "";
        const url: string = match[2] ?? "";
        actions.push({
          ["@type"]: "OpenUri",
          name: name,
          targets: [
            {
              os: "default",
              uri: url,
            },
          ],
        });
        lineWithoutLinks = lineWithoutLinks.replace(match[0], "").trim();
      }

      // Parse facts of the form **Label:** value
      const factMatch: RegExpExecArray | null = new RegExp(
        "\\*\\*(.*?):\\*\\*\\s*(.*)",
      ).exec(lineWithoutLinks);

      if (factMatch) {
        const name: string = (factMatch[1] ?? "").trim();
        const value: string = (factMatch[2] ?? "").trim();
        if (
          name.toLowerCase() === "description" ||
          name.toLowerCase() === "note"
        ) {
          bodyTextParts.push(`**${name}:** ${value}`);
        } else {
          facts.push({ name: name, value: value });
        }
      } else if (lineWithoutLinks) {
        bodyTextParts.push(lineWithoutLinks);
      }
    }

    const payload: JSONObject = {
      ["@type"]: "MessageCard",
      ["@context"]: "https://schema.org/extensions",
      title: title,
      summary: title,
    };

    if (bodyTextParts.length > 0) {
      payload["text"] = bodyTextParts.join("\n\n");
    }

    if (facts.length > 0) {
      payload["sections"] = [
        {
          facts: facts,
        },
      ];
    }

    if (actions.length > 0) {
      payload["potentialAction"] = actions;
    }

    return payload;
  }

  // Helper method to get team ID from auth token data
  private static async getTeamId(authToken: string): Promise<string> {
    try {
      // First, try to get the team ID from stored project auth token configuration
      const projectAuth: WorkspaceProjectAuthToken | null = 
        await WorkspaceProjectAuthTokenService.getByAuthToken({
          authToken: authToken,
          workspaceType: WorkspaceType.MicrosoftTeams,
        });

      if (projectAuth && projectAuth.miscData) {
        const miscData = projectAuth.miscData as MicrosoftTeamsMiscData;
        if (miscData.teamId) {
          logger.debug(`Using stored team ID: ${miscData.teamId}`);
          return miscData.teamId;
        }
      }

      logger.debug("No stored team ID found, fetching from Microsoft Graph API");

      // Fallback: Get team ID from the user's joined teams
      const response = await this.makeGraphApiCall(
        "/me/joinedTeams",
        authToken,
        "GET",
      );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error getting joined teams from Microsoft Graph:");
        logger.error(response);
        throw new BadRequestException("Unable to retrieve team information");
      }

      const teamsData = response.jsonData as JSONObject;
      const teams = teamsData["value"] as Array<JSONObject>;

      if (!teams || teams.length === 0) {
        throw new BadRequestException("No teams found for this user/app");
      }

      // If there's only one team, use it
      if (teams.length === 1) {
        const teamId = teams[0]!["id"] as string;
        const teamName = teams[0]!["displayName"] as string;
        
        logger.debug(`Found single team: ${teamName} (${teamId})`);
        
        // Optionally update the stored configuration with the discovered team info
        await this.updateStoredTeamConfiguration(projectAuth, teamId, teamName);
        
        return teamId;
      }

      // Multiple teams found - use the first one but log a warning
      const firstTeam = teams[0]!;
      const teamId = firstTeam["id"] as string;
      const teamName = firstTeam["displayName"] as string;

      logger.warn(`Multiple teams found (${teams.length}). Using first team: ${teamName} (${teamId})`);
      logger.debug("Available teams:");
      logger.debug(teams.map(t => ({
        id: t["id"],
        name: t["displayName"]
      })));

      // Optionally update the stored configuration
      await this.updateStoredTeamConfiguration(projectAuth, teamId, teamName);

      if (!teamId) {
        throw new BadRequestException("Invalid team data received from Microsoft Graph");
      }

      return teamId;
    } catch (error) {
      logger.error("Error getting team ID:");
      logger.error(error);
      
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      throw new BadRequestException(
        "Unable to determine team ID. Please ensure the app is properly installed in a Microsoft Teams team."
      );
    }
  }

  // Helper method to update stored team configuration  
  private static async updateStoredTeamConfiguration(
    projectAuth: WorkspaceProjectAuthToken | null,
    teamId: string,
    teamName: string
  ): Promise<void> {
    if (!projectAuth) {
      logger.debug("No project auth token found, cannot update team configuration");
      return;
    }

    try {
      const currentMiscData = (projectAuth.miscData as MicrosoftTeamsMiscData) || {};
      
      // Only update if team ID is different or missing
      if (currentMiscData.teamId !== teamId) {
        const updatedMiscData: MicrosoftTeamsMiscData = {
          ...currentMiscData,
          teamId: teamId,
          teamName: teamName,
        };

        await WorkspaceProjectAuthTokenService.updateOneById({
          id: projectAuth.id!,
          data: {
            miscData: updatedMiscData,
          },
          props: {
            isRoot: true,
          },
        });

        logger.debug(`Updated stored team configuration: ${teamName} (${teamId})`);
      }
    } catch (error) {
      logger.error("Error updating stored team configuration:");
      logger.error(error);
      // Don't throw here - this is a nice-to-have feature
    }
  }

  // Helper method to make Microsoft Graph API calls
  private static async makeGraphApiCall(
    endpoint: string,
    authToken: string,
    method: string = "GET",
    body?: JSONObject,
  ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    const headers: Dictionary<string> = {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    };

    const url: URL = URL.fromString(`https://graph.microsoft.com/v1.0${endpoint}`);

    let response: HTTPResponse<JSONObject> | HTTPErrorResponse;

    if (method === "GET") {
      response = await API.get(url, undefined, headers, {});
    } else if (method === "POST") {
      response = await API.post(url, body || {}, headers, {});
    } else {
      throw new BadRequestException(`Unsupported HTTP method: ${method}`);
    }

    return response;
  }

  @CaptureSpan()
  public static override async getAllWorkspaceChannels(data: {
    authToken: string;
  }): Promise<Dictionary<WorkspaceChannel>> {
    logger.debug("Getting all Microsoft Teams channels with data:");
    logger.debug(data);

    try {
      const teamId: string = await this.getTeamId(data.authToken);
      const response = await this.makeGraphApiCall(
        `/teams/${teamId}/channels`,
        data.authToken,
      );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        throw response;
      }

      const channels: Dictionary<WorkspaceChannel> = {};
      const channelsData = (response.jsonData as JSONObject)["value"] as Array<JSONObject>;

      for (const channelData of channelsData) {
        const channel: WorkspaceChannel = {
          id: channelData["id"] as string,
          name: channelData["displayName"] as string,
          workspaceType: WorkspaceType.MicrosoftTeams,
        };
        channels[channel.name] = channel;
      }

      logger.debug("Microsoft Teams channels retrieved:");
      logger.debug(channels);
      return channels;
    } catch (error) {
      logger.error("Error getting Microsoft Teams channels:");
      logger.error(error);
      throw error;
    }
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelId(data: {
    authToken: string;
    channelId: string;
  }): Promise<WorkspaceChannel> {
    logger.debug("Getting Microsoft Teams channel from channel ID with data:");
    logger.debug(data);

    try {
      const teamId: string = await this.getTeamId(data.authToken);
      const response = await this.makeGraphApiCall(
        `/teams/${teamId}/channels/${data.channelId}`,
        data.authToken,
      );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        throw response;
      }

      const channelData = response.jsonData as JSONObject;
      const channel: WorkspaceChannel = {
        id: channelData["id"] as string,
        name: channelData["displayName"] as string,
        workspaceType: WorkspaceType.MicrosoftTeams,
      };

      logger.debug("Microsoft Teams channel obtained:");
      logger.debug(channel);
      return channel;
    } catch (error) {
      logger.error("Error getting Microsoft Teams channel by ID:");
      logger.error(error);
      throw error;
    }
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelName(data: {
    authToken: string;
    channelName: string;
  }): Promise<WorkspaceChannel> {
    logger.debug("Getting Microsoft Teams channel from channel name with data:");
    logger.debug(data);

    try {
      const allChannels = await this.getAllWorkspaceChannels({
        authToken: data.authToken,
      });

      let channelName = data.channelName;
      if (channelName.startsWith("#")) {
        channelName = channelName.substring(1);
      }

      const channel = allChannels[channelName];
      if (!channel) {
        throw new BadRequestException(`Channel '${channelName}' not found`);
      }

      return channel;
    } catch (error) {
      logger.error("Error getting Microsoft Teams channel by name:");
      logger.error(error);
      throw error;
    }
  }

  @CaptureSpan()
  public static override async createChannel(data: {
    authToken: string;
    channelName: string;
  }): Promise<WorkspaceChannel> {
    logger.debug("Creating Microsoft Teams channel with data:");
    logger.debug(data);

    try {
      let channelName = data.channelName;
      if (channelName.startsWith("#")) {
        channelName = channelName.substring(1);
      }

      const teamId: string = await this.getTeamId(data.authToken);
      const channelPayload = {
        displayName: channelName,
        description: `Channel created by OneUptime`,
        membershipType: "standard",
      };

      const response = await this.makeGraphApiCall(
        `/teams/${teamId}/channels`,
        data.authToken,
        "POST",
        channelPayload,
      );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        throw response;
      }

      const channelData = response.jsonData as JSONObject;
      const channel: WorkspaceChannel = {
        id: channelData["id"] as string,
        name: channelData["displayName"] as string,
        workspaceType: WorkspaceType.MicrosoftTeams,
      };

      logger.debug("Microsoft Teams channel created successfully:");
      logger.debug(channel);
      return channel;
    } catch (error) {
      logger.error("Error creating Microsoft Teams channel:");
      logger.error(error);
      throw error;
    }
  }

  @CaptureSpan()
  public static override async createChannelsIfDoesNotExist(data: {
    authToken: string;
    channelNames: Array<string>;
  }): Promise<Array<WorkspaceChannel>> {
    logger.debug("Creating Microsoft Teams channels if they do not exist with data:");
    logger.debug(data);

    const workspaceChannels: Array<WorkspaceChannel> = [];
    const existingWorkspaceChannels = await this.getAllWorkspaceChannels({
      authToken: data.authToken,
    });

    logger.debug("Existing Microsoft Teams channels:");
    logger.debug(existingWorkspaceChannels);

    for (let channelName of data.channelNames) {
      // if channel name starts with #, remove it
      if (channelName.startsWith("#")) {
        channelName = channelName.substring(1);
      }

      if (existingWorkspaceChannels[channelName]) {
        logger.debug(`Channel ${channelName} already exists.`);
        workspaceChannels.push(existingWorkspaceChannels[channelName]!);
        continue;
      }

      logger.debug(`Channel ${channelName} does not exist. Creating channel.`);
      try {
        const channel = await this.createChannel({
          authToken: data.authToken,
          channelName: channelName,
        });

        if (channel) {
          logger.debug(`Channel ${channelName} created successfully.`);
          workspaceChannels.push(channel);
        }
      } catch (error) {
        logger.error(`Error creating channel ${channelName}:`);
        logger.error(error);
        // Continue with other channels even if one fails
      }
    }

    logger.debug("Channels created or found:");
    logger.debug(workspaceChannels);
    return workspaceChannels;
  }

  @CaptureSpan()
  public static override async isUserInChannel(data: {
    authToken: string;
    channelId: string;
    userId: string;
  }): Promise<boolean> {
    logger.debug("Checking if user is in Microsoft Teams channel with data:");
    logger.debug(data);

    try {
      const teamId: string = await this.getTeamId(data.authToken);
      const response = await this.makeGraphApiCall(
        `/teams/${teamId}/channels/${data.channelId}/members`,
        data.authToken,
      );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        return false;
      }

      const members = (response.jsonData as JSONObject)["value"] as Array<JSONObject>;
      const isUserInChannel = members.some((member) => {
        const userId = (member["userId"] as string) || 
                      ((member["user"] as JSONObject)?.["id"] as string);
        return userId === data.userId;
      });

      logger.debug(`User ${data.userId} is ${isUserInChannel ? 'in' : 'not in'} channel ${data.channelId}`);
      return isUserInChannel;
    } catch (error) {
      logger.error("Error checking if user is in Microsoft Teams channel:");
      logger.error(error);
      return false;
    }
  }

  @CaptureSpan()
  public static override async inviteUserToChannelByChannelId(data: {
    authToken: string;
    channelId: string;
    workspaceUserId: string;
  }): Promise<void> {
    logger.debug("Inviting user to Microsoft Teams channel by ID with data:");
    logger.debug(data);

    try {
      // Check if user is already in channel
      const isUserInChannel = await this.isUserInChannel({
        authToken: data.authToken,
        channelId: data.channelId,
        userId: data.workspaceUserId,
      });

      if (isUserInChannel) {
        logger.debug("User already in channel.");
        return;
      }

      const teamId: string = await this.getTeamId(data.authToken);
      const memberPayload = {
        "@odata.type": "#microsoft.graph.aadUserConversationMember",
        "user@odata.bind": `https://graph.microsoft.com/v1.0/users/${data.workspaceUserId}`,
        roles: ["member"],
      };

      const response = await this.makeGraphApiCall(
        `/teams/${teamId}/channels/${data.channelId}/members`,
        data.authToken,
        "POST",
        memberPayload,
      );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        throw response;
      }

      logger.debug("User invited to Microsoft Teams channel successfully.");
    } catch (error) {
      logger.error("Error inviting user to Microsoft Teams channel:");
      logger.error(error);
      throw error;
    }
  }

  @CaptureSpan()
  public static override async inviteUserToChannelByChannelName(data: {
    authToken: string;
    channelName: string;
    workspaceUserId: string;
  }): Promise<void> {
    logger.debug("Inviting user to Microsoft Teams channel by name with data:");
    logger.debug(data);

    try {
      const channel = await this.getWorkspaceChannelFromChannelName({
        authToken: data.authToken,
        channelName: data.channelName,
      });

      await this.inviteUserToChannelByChannelId({
        authToken: data.authToken,
        channelId: channel.id,
        workspaceUserId: data.workspaceUserId,
      });
    } catch (error) {
      logger.error("Error inviting user to Microsoft Teams channel by name:");
      logger.error(error);
      throw error;
    }
  }

  @CaptureSpan()
  public static override async sendPayloadBlocksToChannel(data: {
    authToken: string;
    workspaceChannel: WorkspaceChannel;
    blocks: Array<JSONObject>;
  }): Promise<WorkspaceThread> {
    logger.debug("Sending payload blocks to Microsoft Teams channel:");
    logger.debug(data);

    try {
      const teamId: string = await this.getTeamId(data.authToken);
      
      // Convert blocks to Teams message format
      const messageBody = {
        body: {
          contentType: "html",
          content: this.convertBlocksToTeamsMessage(data.blocks),
        },
      };

      const response = await this.makeGraphApiCall(
        `/teams/${teamId}/channels/${data.workspaceChannel.id}/messages`,
        data.authToken,
        "POST",
        messageBody,
      );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        throw response;
      }

      const messageData = response.jsonData as JSONObject;
      const thread: WorkspaceThread = {
        channel: data.workspaceChannel,
        threadId: messageData["id"] as string,
      };

      logger.debug("Message sent to Microsoft Teams channel successfully:");
      logger.debug(thread);
      return thread;
    } catch (error) {
      logger.error("Error sending message to Microsoft Teams channel:");
      logger.error(error);
      throw error;
    }
  }

  @CaptureSpan()
  public static override async sendMessage(data: {
    workspaceMessagePayload: WorkspaceMessagePayload;
    authToken: string;
    userId: string;
  }): Promise<WorkspaceSendMessageResponse> {
    logger.debug("Sending message to Microsoft Teams with data:");
    logger.debug(data);

    const blocks: Array<JSONObject> = this.getBlocksFromWorkspaceMessagePayload(
      data.workspaceMessagePayload,
    );

    logger.debug("Blocks generated from workspace message payload:");
    logger.debug(blocks);

    const existingWorkspaceChannels = await this.getAllWorkspaceChannels({
      authToken: data.authToken,
    });

    logger.debug("Existing Microsoft Teams channels:");
    logger.debug(existingWorkspaceChannels);

    const workspaceChannelsToPostTo: Array<WorkspaceChannel> = [];

    // Process channel names
    for (let channelName of data.workspaceMessagePayload.channelNames) {
      if (channelName.startsWith("#")) {
        channelName = channelName.substring(1);
      }

      const channel = existingWorkspaceChannels[channelName];
      if (channel) {
        workspaceChannelsToPostTo.push(channel);
      } else {
        logger.debug(`Channel ${channelName} does not exist.`);
      }
    }

    // Process channel IDs
    for (const channelId of data.workspaceMessagePayload.channelIds) {
      try {
        const channel = await this.getWorkspaceChannelFromChannelId({
          authToken: data.authToken,
          channelId: channelId,
        });
        workspaceChannelsToPostTo.push(channel);
      } catch (err) {
        logger.error(`Error getting channel info for channel ID ${channelId}:`);
        logger.error(err);

        // Fallback: create channel object with empty name if API call fails
        const channel: WorkspaceChannel = {
          id: channelId,
          name: channelId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        };
        workspaceChannelsToPostTo.push(channel);
      }
    }

    logger.debug("Channels to post to:");
    logger.debug(workspaceChannelsToPostTo);

    const workspaceMessageResponse: WorkspaceSendMessageResponse = {
      threads: [],
      workspaceType: WorkspaceType.MicrosoftTeams,
    };

    // Send messages to all channels
    for (const channel of workspaceChannelsToPostTo) {
      try {
        const thread = await this.sendPayloadBlocksToChannel({
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
  public static override async sendDirectMessageToUser(data: {
    authToken: string;
    workspaceUserId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): Promise<void> {
    logger.debug("Sending direct message to Microsoft Teams user:");
    logger.debug(data);

    try {
      // First, create a chat with the user
      const chatPayload = {
        chatType: "oneOnOne",
        members: [
          {
            "@odata.type": "#microsoft.graph.aadUserConversationMember",
            "user@odata.bind": `https://graph.microsoft.com/v1.0/users/${data.workspaceUserId}`,
            roles: ["member"],
          },
        ],
      };

      const chatResponse = await this.makeGraphApiCall(
        "/chats",
        data.authToken,
        "POST",
        chatPayload,
      );

      if (chatResponse instanceof HTTPErrorResponse) {
        logger.error("Error creating chat with user:");
        logger.error(chatResponse);
        throw chatResponse;
      }

      const chatData = chatResponse.jsonData as JSONObject;
      const chatId = chatData["id"] as string;

      // Convert message blocks to Teams format
      const blocks = this.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: data.messageBlocks,
      });

      const messageBody = {
        body: {
          contentType: "html",
          content: this.convertBlocksToTeamsMessage(blocks),
        },
      };

      const messageResponse = await this.makeGraphApiCall(
        `/chats/${chatId}/messages`,
        data.authToken,
        "POST",
        messageBody,
      );

      if (messageResponse instanceof HTTPErrorResponse) {
        logger.error("Error sending direct message:");
        logger.error(messageResponse);
        throw messageResponse;
      }

      logger.debug("Direct message sent successfully to Microsoft Teams user.");
    } catch (error) {
      logger.error("Error sending direct message to Microsoft Teams user:");
      logger.error(error);
      throw error;
    }
  }

  // Helper method to convert blocks to Teams message format
  private static convertBlocksToTeamsMessage(blocks: Array<JSONObject>): string {
    let html = "";
    
    for (const block of blocks) {
      const type = block["type"] as string;
      
      switch (type) {
        case "header":
          html += `<h3>${block["text"]}</h3>`;
          break;
        case "section":
          if (block["text"]) {
            html += `<p>${block["text"]}</p>`;
          }
          break;
        case "divider":
          html += "<hr>";
          break;
        case "actions":
          // Handle action buttons - convert to simple links for now
          const actions = block["elements"] as Array<JSONObject>;
          if (actions) {
            for (const action of actions) {
              if (action["url"]) {
                html += `<a href="${action["url"]}">${action["text"] || "Click here"}</a><br>`;
              }
            }
          }
          break;
        default:
          // For other block types, try to extract text content
          if (block["text"]) {
            html += `<p>${block["text"]}</p>`;
          }
          break;
      }
    }

    return html || "<p>Message from OneUptime</p>";
  }

  @CaptureSpan()
  public static override async sendMessageToChannelViaIncomingWebhook(data: {
    url: URL;
    text: string;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    logger.debug("Sending message to Teams channel via incoming webhook:");
    logger.debug(data);

    // Build a structured MessageCard from markdown for better rendering in Teams
    const payload: JSONObject = this.buildMessageCardFromMarkdown(data.text);

    const apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse | null =
      await API.post(data.url, payload);

    if (!apiResult) {
      logger.error(
        "Could not send message to Teams channel via incoming webhook.",
      );
      throw new Error(
        "Could not send message to Teams channel via incoming webhook.",
      );
    }

    if (apiResult instanceof HTTPErrorResponse) {
      logger.error(
        "Error sending message to Teams channel via incoming webhook:",
      );
      logger.error(apiResult);
      throw apiResult;
    }

    logger.debug(
      "Message sent to Teams channel via incoming webhook successfully:",
    );
    logger.debug(apiResult);

    return apiResult;
  }

  public static isValidMicrosoftTeamsIncomingWebhookUrl(
    incomingWebhookUrl: URL,
  ): boolean {
    // Check if the URL contains outlook.office.com or office.com webhook pattern
    const urlString: string = incomingWebhookUrl.toString();
    return (
      urlString.includes("outlook.office.com") ||
      urlString.includes("office.com")
    );
  }

  // Block formatting methods for Teams
  @CaptureSpan()
  public static override getHeaderBlock(data: {
    payloadHeaderBlock: WorkspacePayloadHeader;
  }): JSONObject {
    return {
      type: "header",
      text: data.payloadHeaderBlock.text,
    };
  }

  @CaptureSpan()
  public static override getMarkdownBlock(data: {
    payloadMarkdownBlock: WorkspacePayloadMarkdown;
  }): JSONObject {
    return {
      type: "section",
      text: data.payloadMarkdownBlock.text,
    };
  }

  @CaptureSpan()
  public static override getDividerBlock(): JSONObject {
    return {
      type: "divider",
    };
  }

  @CaptureSpan()
  public static override getButtonsBlock(data: {
    payloadButtonsBlock: WorkspacePayloadButtons;
  }): JSONObject {
    const elements = data.payloadButtonsBlock.buttons.map((button) => ({
      type: "button",
      text: button.title,
      url: button.url?.toString(),
      actionId: button.actionId,
    }));

    return {
      type: "actions",
      elements: elements,
    };
  }

  @CaptureSpan()
  public static override getButtonBlock(data: {
    payloadButtonBlock: WorkspaceMessagePayloadButton;
  }): JSONObject {
    return {
      type: "button",
      text: data.payloadButtonBlock.title,
      url: data.payloadButtonBlock.url?.toString(),
      actionId: data.payloadButtonBlock.actionId,
    };
  }

  @CaptureSpan()
  public static override getTextAreaBlock(data: {
    payloadTextAreaBlock: WorkspaceTextAreaBlock;
  }): JSONObject {
    return {
      type: "input",
      element: {
        type: "plain_text_input",
        multiline: true,
        action_id: data.payloadTextAreaBlock.blockId,
        placeholder: {
          type: "plain_text",
          text: data.payloadTextAreaBlock.placeholder || "",
        },
        initial_value: data.payloadTextAreaBlock.initialValue || "",
      },
      label: {
        type: "plain_text",
        text: data.payloadTextAreaBlock.label || "",
      },
    };
  }

  @CaptureSpan()
  public static override getTextBoxBlock(data: {
    payloadTextBoxBlock: WorkspaceTextBoxBlock;
  }): JSONObject {
    return {
      type: "input",
      element: {
        type: "plain_text_input",
        action_id: data.payloadTextBoxBlock.blockId,
        placeholder: {
          type: "plain_text",
          text: data.payloadTextBoxBlock.placeholder || "",
        },
        initial_value: data.payloadTextBoxBlock.initialValue || "",
      },
      label: {
        type: "plain_text",
        text: data.payloadTextBoxBlock.label || "",
      },
    };
  }

  @CaptureSpan()
  public static override getImageBlock(data: {
    payloadImageBlock: WorkspacePayloadImage;
  }): JSONObject {
    return {
      type: "image",
      image_url: data.payloadImageBlock.imageUrl.toString(),
      alt_text: data.payloadImageBlock.altText || "",
    };
  }

  @CaptureSpan()
  public static override getDropdownBlock(data: {
    payloadDropdownBlock: WorkspaceDropdownBlock;
  }): JSONObject {
    const options = data.payloadDropdownBlock.options.map((option) => ({
      text: {
        type: "plain_text",
        text: option.label,
      },
      value: option.value,
    }));

    return {
      type: "input",
      element: {
        type: "static_select",
        action_id: data.payloadDropdownBlock.blockId,
        placeholder: {
          type: "plain_text",
          text: data.payloadDropdownBlock.placeholder || "Select an option",
        },
        options: options,
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
        text: data.payloadDropdownBlock.label || "",
      },
    };
  }

  @CaptureSpan()
  public static override getCheckboxBlock(data: {
    payloadCheckboxBlock: WorkspaceCheckboxBlock;
  }): JSONObject {
    // For Teams, we'll create a simple checkbox input (since the interface only has one checkbox)
    return {
      type: "input",
      element: {
        type: "checkboxes",
        action_id: data.payloadCheckboxBlock.blockId,
        options: [
          {
            text: {
              type: "plain_text",
              text: data.payloadCheckboxBlock.label,
            },
            value: "checkbox-value",
          },
        ],
        initial_options: data.payloadCheckboxBlock.initialValue
          ? [
              {
                text: {
                  type: "plain_text",
                  text: data.payloadCheckboxBlock.label,
                },
                value: "checkbox-value",
              },
            ]
          : [],
      },
      label: {
        type: "plain_text",
        text: data.payloadCheckboxBlock.label || "",
      },
    };
  }

  @CaptureSpan()
  public static override getDateTimePickerBlock(data: {
    payloadDateTimePickerBlock: WorkspaceDateTimePickerBlock;
  }): JSONObject {
    let initialDateTime: number | undefined = undefined;
    
    if (data.payloadDateTimePickerBlock.initialValue) {
      // If initialValue is a string, try to parse it as a date
      const dateValue = new Date(data.payloadDateTimePickerBlock.initialValue);
      if (!isNaN(dateValue.getTime())) {
        initialDateTime = Math.floor(dateValue.getTime() / 1000);
      }
    }

    return {
      type: "input",
      element: {
        type: "datetimepicker",
        action_id: data.payloadDateTimePickerBlock.blockId,
        initial_date_time: initialDateTime,
      },
      label: {
        type: "plain_text",
        text: data.payloadDateTimePickerBlock.label || "",
      },
    };
  }

  @CaptureSpan()
  public static override getModalBlock(data: {
    payloadModalBlock: WorkspaceModalBlock;
  }): JSONObject {
    const blocks = data.payloadModalBlock.blocks.map((block) =>
      this.getBlocksFromWorkspaceMessagePayload({ messageBlocks: [block] })[0],
    );

    return {
      type: "modal",
      title: {
        type: "plain_text",
        text: data.payloadModalBlock.title,
      },
      blocks: blocks,
      submit: data.payloadModalBlock.submitButtonTitle
        ? {
            type: "plain_text",
            text: data.payloadModalBlock.submitButtonTitle,
          }
        : undefined,
      close: {
        type: "plain_text",
        text: data.payloadModalBlock.cancelButtonTitle || "Cancel",
      },
    };
  }

  // Methods that are not directly applicable to Teams but need to be implemented
  @CaptureSpan()
  public static override async joinChannel(data: {
    authToken: string;
    channelId: string;
  }): Promise<void> {
    // In Microsoft Teams, the bot automatically has access to channels it's added to
    // This method is implemented for compatibility but may not need specific action
    logger.debug("Join channel called for Microsoft Teams - no action needed");
    logger.debug(data);
  }

  @CaptureSpan()
  public static override async showModalToUser(data: {
    authToken: string;
    triggerId: string;
    modalBlock: WorkspaceModalBlock;
  }): Promise<void> {
    // Microsoft Teams doesn't have the same modal system as Slack
    // This could be implemented using Task Modules or Adaptive Cards
    logger.debug("Show modal called for Microsoft Teams - not implemented");
    logger.debug(data);
    throw new BadRequestException("Modal display not implemented for Microsoft Teams");
  }

  // Additional methods to match WorkspaceBase interface
  @CaptureSpan()
  public static override async doesChannelExist(data: {
    authToken: string;
    channelName: string;
  }): Promise<boolean> {
    try {
      const channels = await this.getAllWorkspaceChannels({
        authToken: data.authToken,
      });
      
      let channelName = data.channelName;
      if (channelName.startsWith("#")) {
        channelName = channelName.substring(1);
      }
      
      return Boolean(channels[channelName]);
    } catch (error) {
      logger.error("Error checking if channel exists:");
      logger.error(error);
      return false;
    }
  }

  @CaptureSpan()
  public static override async archiveChannels(data: {
    channelIds: Array<string>;
    authToken: string;
    userId: string;
    sendMessageBeforeArchiving: WorkspacePayloadMarkdown;
  }): Promise<void> {
    // Send message before archiving if provided
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

    logger.debug("Archiving Microsoft Teams channels with data:");
    logger.debug(data);

    try {
      await this.getTeamId(data.authToken); // Validate auth token

      for (const channelId of data.channelIds) {
        // Microsoft Teams doesn't directly support archiving channels via API
        // This is a placeholder implementation - you may need to use different approach
        logger.debug(`Attempting to archive channel ${channelId}`);
        
        // You could implement alternative behavior like:
        // - Removing the bot from the channel
        // - Renaming the channel to indicate it's archived
        // - Or handle archiving through Teams admin center
        
        logger.warn(`Channel archiving not directly supported in Microsoft Teams API for channel ${channelId}`);
      }
    } catch (error) {
      logger.error("Error archiving Microsoft Teams channels:");
      logger.error(error);
      throw error;
    }
  }

  @CaptureSpan()
  public static override async getUsernameFromUserId(data: {
    authToken: string;
    userId: string;
  }): Promise<string | null> {
    try {
      const response = await this.makeGraphApiCall(
        `/users/${data.userId}`,
        data.authToken,
        "GET",
      );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error getting user info from Microsoft Graph:");
        logger.error(response);
        return null;
      }

      const userData = response.jsonData as JSONObject;
      return (userData["displayName"] as string) || (userData["userPrincipalName"] as string) || null;
    } catch (error) {
      logger.error("Error getting username from user ID:");
      logger.error(error);
      return null;
    }
  }

  @CaptureSpan()
  public static override async isUserInDirectMessageChannel(data: {
    authToken: string;
    userId: string;
    directMessageChannelId: string;
  }): Promise<boolean> {
    // In Microsoft Teams, check if user is in a chat/direct message
    try {
      const response = await this.makeGraphApiCall(
        `/chats/${data.directMessageChannelId}/members`,
        data.authToken,
        "GET",
      );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error getting chat members:");
        logger.error(response);
        return false;
      }

      const membersData = response.jsonData as JSONObject;
      const members = membersData["value"] as Array<JSONObject>;
      
      return members.some(member => 
        (member["userId"] as string) === data.userId ||
        (member["user"] as JSONObject)?.["id"] === data.userId
      );
    } catch (error) {
      logger.error("Error checking if user is in direct message channel:");
      logger.error(error);
      return false;
    }
  }
}