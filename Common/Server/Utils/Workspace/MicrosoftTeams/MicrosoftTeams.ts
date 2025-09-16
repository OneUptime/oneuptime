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
import CaptureSpan from "../../Telemetry/CaptureSpan";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import { MicrosoftTeamsMiscData } from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import OneUptimeDate from "../../../../Types/Date";
import { MicrosoftTeamsAppClientId, MicrosoftTeamsAppClientSecret } from "../../../EnvironmentConfig";

export default class MicrosoftTeamsUtil extends WorkspaceBase {
  // Helper method to get a valid access token, refreshing if necessary
  private static async getValidAccessToken(data: {
    authToken: string;
    projectId: ObjectID;
  }): Promise<string> {
    // Check if the authToken is a valid JWT (contains dots)
    if (data.authToken && data.authToken.includes('.')) {
      // It's a JWT token, use it directly
      return data.authToken;
    }

    // Get project auth and check token expiration
    const projectAuth = await WorkspaceProjectAuthTokenService.getProjectAuth({
      projectId: data.projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    if (!projectAuth || !projectAuth.miscData) {
      throw new BadDataException(
        "Microsoft Teams integration not found for this project"
      );
    }

    const miscData = projectAuth.miscData as MicrosoftTeamsMiscData;
    
    // Check if token exists and is valid
    if (miscData.appAccessToken && miscData.appAccessToken.includes('.')) {
      // Check if token is expired
      if (miscData.appAccessTokenExpiresAt) {
        const expiryDate = OneUptimeDate.fromString(miscData.appAccessTokenExpiresAt);
        
        // If token expires within the next 5 minutes, refresh it
        if (OneUptimeDate.getSecondsTo(expiryDate) <= 300) {
          logger.debug("Access token is expired or expiring soon, attempting to refresh");
          const newToken = await this.refreshAccessToken({
            projectId: data.projectId,
            miscData,
          });
          if (newToken) {
            return newToken;
          }
        } else {
          logger.debug("Using cached appAccessToken from miscData for Microsoft Graph API call");
          return miscData.appAccessToken;
        }
      } else {
        // No expiry information, use the token but it might be expired
        logger.debug("Using appAccessToken from miscData (no expiry info available)");
        return miscData.appAccessToken;
      }
    }

    // If we couldn't find a valid token, return the original (this will likely fail)
    logger.warn("Could not find valid JWT token, using original authToken (may fail)");
    return data.authToken;
  }

  // Method to refresh the Microsoft Teams access token
  private static async refreshAccessToken(data: {
    projectId: ObjectID;
    miscData: MicrosoftTeamsMiscData;
  }): Promise<string | null> {
    try {
      // Check if we have the necessary client credentials
      if (!MicrosoftTeamsAppClientId || !MicrosoftTeamsAppClientSecret) {
        logger.error("Microsoft Teams app client credentials are not configured");
        logger.error("Please set MICROSOFT_TEAMS_APP_CLIENT_ID and MICROSOFT_TEAMS_APP_CLIENT_SECRET environment variables");
        return null;
      }

      if (!data.miscData.tenantId) {
        logger.error("Tenant ID not found in miscData, cannot refresh token");
        return null;
      }

      logger.debug(`Attempting to refresh Microsoft Teams access token for project ${data.projectId.toString()}`);
      logger.debug(`Using tenant ID: ${data.miscData.tenantId}`);

      // Use OAuth 2.0 client credentials flow to get a new app access token
      const tokenUrl = `https://login.microsoftonline.com/${data.miscData.tenantId}/oauth2/v2.0/token`;
      
      const tokenRequestBody = {
        client_id: MicrosoftTeamsAppClientId,
        client_secret: MicrosoftTeamsAppClientSecret,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      };

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post(
        URL.fromString(tokenUrl),
        tokenRequestBody,
        {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        }
      );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error refreshing Microsoft Teams access token:");
        logger.error(response);
        return null;
      }

      const tokenData = response.data;
      const newAccessToken = tokenData['access_token'] as string;
      const expiresIn = tokenData['expires_in'] as number; // seconds

      if (!newAccessToken) {
        logger.error("No access token received in token refresh response");
        return null;
      }

      // Calculate expiry time
      const now = OneUptimeDate.getCurrentDate();
      const expiryDate = OneUptimeDate.addRemoveSeconds(now, expiresIn - 300); // Subtract 5 minutes buffer
      
      // Update the miscData with new token and expiry
      const updatedMiscData: MicrosoftTeamsMiscData = {
        ...data.miscData,
        appAccessToken: newAccessToken,
        appAccessTokenExpiresAt: OneUptimeDate.toString(expiryDate),
        lastAppTokenIssuedAt: OneUptimeDate.toString(now),
      };

      // Save the updated token to the database
      await WorkspaceProjectAuthTokenService.refreshAuthToken({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
        authToken: newAccessToken,
        workspaceProjectId: data.miscData.teamId,
        miscData: updatedMiscData as any,
      });

      logger.debug("Microsoft Teams access token refreshed successfully");
      logger.debug(`New token expires at: ${updatedMiscData.appAccessTokenExpiresAt}`);

      return newAccessToken;
    } catch (error) {
      logger.error("Error refreshing Microsoft Teams access token:");
      logger.error(error);
      return null;
    }
  }

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

  @CaptureSpan()
  public static override async getUsernameFromUserId(data: {
    authToken: string;
    userId: string;
    projectId: ObjectID;
  }): Promise<string | null> {
    logger.debug("Getting username from user ID with data:");
    logger.debug(data);

    // Get valid access token
    const accessToken = await this.getValidAccessToken({
      authToken: data.authToken,
      projectId: data.projectId,
    });

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get<JSONObject>(
        URL.fromString(`https://graph.microsoft.com/v1.0/users/${data.userId}`),
        undefined, 
        {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      );

    logger.debug("Response from Microsoft Graph API for getting user info:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Microsoft Graph API:");
      logger.error(response);
      throw response;
    }

    const userData: JSONObject = response.data;
    const username: string =
      (userData["displayName"] as string) ||
      (userData["userPrincipalName"] as string);

    logger.debug("Username obtained:");
    logger.debug(username);
    return username;
  }

  @CaptureSpan()
  public static override async sendDirectMessageToUser(data: {
    authToken: string;
    workspaceUserId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): Promise<void> {
    // Send direct message to user via Microsoft Graph API
    const adaptiveCard: JSONObject = this.buildAdaptiveCardFromMessageBlocks({
      messageBlocks: data.messageBlocks,
    });

    const chatMessage: JSONObject = {
      body: {
        contentType: "html",
        content: this.convertAdaptiveCardToHtml(adaptiveCard),
      },
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: adaptiveCard,
        },
      ],
    };

    await API.post(
      URL.fromString(
        `https://graph.microsoft.com/v1.0/chats/${data.workspaceUserId}/messages`,
      ),
      chatMessage,
      {
        Authorization: `Bearer ${data.authToken}`,
        "Content-Type": "application/json",
      },
    );
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

    // Get team ID from project auth
    const projectAuth: any =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    if (!projectAuth || !projectAuth.workspaceProjectId) {
      throw new BadDataException(
        "Microsoft Teams integration not found for this project",
      );
    }

    for (let channelName of data.channelNames) {
      // Normalize channel name - Teams has different naming requirements
      if (channelName && channelName.startsWith("#")) {
        channelName = channelName.substring(1);
      }
      // Teams channels cannot have spaces in the name for some operations
      const normalizedChannelName: string = channelName.replace(/\s+/g, "-");

      // Check if channel exists
      const existingChannel: WorkspaceChannel | null =
        await this.getWorkspaceChannelByName({
          authToken: data.authToken,
          channelName: normalizedChannelName,
          projectId: data.projectId,
        });

      if (existingChannel) {
        logger.debug(`Channel ${channelName} already exists.`);
        workspaceChannels.push(existingChannel);
        continue;
      }

      logger.debug(`Channel ${channelName} does not exist. Creating channel.`);
      const channel: WorkspaceChannel = await this.createChannel({
        authToken: data.authToken,
        channelName: normalizedChannelName,
        projectId: data.projectId,
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
  public static override async createChannel(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
  }): Promise<WorkspaceChannel> {
    // Get team ID from project auth
    const projectAuth: any =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    if (!projectAuth || !projectAuth.workspaceProjectId) {
      throw new BadDataException(
        "Microsoft Teams integration not found for this project",
      );
    }

    const teamId: string = projectAuth.workspaceProjectId;

    // Get valid access token
    const accessToken = await this.getValidAccessToken({
      authToken: data.authToken,
      projectId: data.projectId,
    });

    const channelPayload: JSONObject = {
      displayName: data.channelName,
      description: `OneUptime notifications for ${data.channelName}`,
      membershipType: "standard",
    };

    logger.debug("Creating Teams channel with payload:");
    logger.debug(channelPayload);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post(
        URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${teamId}/channels`,
        ),
        channelPayload,
        {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      );

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Microsoft Graph API:");
      logger.error(response);
      throw response;
    }

    const channelData: JSONObject = response.data;
    const channel: WorkspaceChannel = {
      id: channelData["id"] as string,
      name: channelData["displayName"] as string,
      workspaceType: WorkspaceType.MicrosoftTeams,
    };

    logger.debug("Channel created successfully:");
    logger.debug(channel);

    return channel;
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelName(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
  }): Promise<WorkspaceChannel> {
    const channel: WorkspaceChannel | null =
      await this.getWorkspaceChannelByName({
        authToken: data.authToken,
        channelName: data.channelName,
        projectId: data.projectId,
      });

    if (!channel) {
      throw new BadDataException("Channel not found.");
    }

    return channel;
  }

  @CaptureSpan()
  public static async getWorkspaceChannelByName(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
  }): Promise<WorkspaceChannel | null> {
    logger.debug(`Getting workspace channel by name: ${data.channelName}`);
    
    // Get team ID from project auth
    const projectAuth: any =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    if (!projectAuth || !projectAuth.workspaceProjectId) {
      logger.error("Microsoft Teams integration not found for this project");
      throw new BadDataException(
        "Microsoft Teams integration not found for this project",
      );
    }

    const teamId: string = projectAuth.workspaceProjectId;
    logger.debug(`Using team ID: ${teamId}`);

    // Get valid access token
    const accessToken = await this.getValidAccessToken({
      authToken: data.authToken,
      projectId: data.projectId,
    });

    logger.debug("Making API call to get channels");
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get(
        URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${teamId}/channels`,
        ),
        undefined, 
        {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      );

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Microsoft Graph API:");
      logger.error(response);
      throw response;
    }

    const channelsData: JSONObject = response.data;
    const channels: Array<JSONObject> =
      (channelsData["value"] as Array<JSONObject>) || [];

    logger.debug(`Found ${channels.length} channels from API`);
    logger.debug(`Channels: ${JSON.stringify(channels.map(c => ({ id: c["id"], displayName: c["displayName"] })))}`);

    for (const channelData of channels) {
      const channelName: string = (
        channelData["displayName"] as string
      ).toLowerCase();
      logger.debug(`Comparing channel '${channelName}' with requested '${data.channelName.toLowerCase()}'`);
      if (channelName === data.channelName.toLowerCase()) {
        const foundChannel = {
          id: channelData["id"] as string,
          name: channelData["displayName"] as string,
          workspaceType: WorkspaceType.MicrosoftTeams,
        };
        logger.debug(`Channel match found: ${JSON.stringify(foundChannel)}`);
        return foundChannel;
      }
    }

    logger.debug(`No channel found with name: ${data.channelName}`);
    return null;
  }

  @CaptureSpan()
  public static override async sendMessage(data: {
    workspaceMessagePayload: WorkspaceMessagePayload;
    authToken: string;
    userId: string;
    projectId: ObjectID;
  }): Promise<WorkspaceSendMessageResponse> {
    logger.debug("Sending message to Microsoft Teams with data:");
    logger.debug(data);

    const adaptiveCard: JSONObject = this.buildAdaptiveCardFromMessageBlocks({
      messageBlocks: data.workspaceMessagePayload.messageBlocks,
    });

    const workspaceChannelsToPostTo: Array<WorkspaceChannel> = [];

    // Resolve channel names
    for (const channelName of data.workspaceMessagePayload.channelNames) {
      logger.debug(`Attempting to resolve channel name: ${channelName}`);
      const channel: WorkspaceChannel | null =
        await this.getWorkspaceChannelByName({
          authToken: data.authToken,
          channelName: channelName,
          projectId: data.projectId,
        });

      if (channel) {
        logger.debug(`Channel resolved successfully: ${JSON.stringify(channel)}`);
        workspaceChannelsToPostTo.push(channel);
      } else {
        logger.warn(`Channel not found: ${channelName}`);
      }
    }

    const workspaceMessageResponse: WorkspaceSendMessageResponse = {
      threads: [],
      workspaceType: WorkspaceType.MicrosoftTeams,
    };

    // Get team ID from project auth
    const projectAuth: any =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    if (!projectAuth || !projectAuth.workspaceProjectId) {
      throw new BadDataException(
        "Microsoft Teams integration not found for this project",
      );
    }

    const teamId: string = projectAuth.workspaceProjectId;

    // Add channels by ID
    for (const channelId of data.workspaceMessagePayload.channelIds) {
      try {
        const channel: WorkspaceChannel =
          await this.getWorkspaceChannelFromChannelId({
            authToken: data.authToken,
            channelId: channelId,
            teamId: teamId,
            projectId: data.projectId,
          });
        workspaceChannelsToPostTo.push(channel);
      } catch (err) {
        logger.error(`Error getting channel info for channel ID ${channelId}:`);
        logger.error(err);
      }
    }

    for (const channel of workspaceChannelsToPostTo) {
      try {
        logger.debug(`Attempting to send message to channel: ${JSON.stringify(channel)}`);
        const thread: WorkspaceThread = await this.sendAdaptiveCardToChannel({
          authToken: data.authToken,
          teamId: teamId,
          workspaceChannel: channel,
          adaptiveCard: adaptiveCard,
          projectId: data.projectId,
        });

        logger.debug(`Message sent successfully to channel ${channel.name}, thread: ${JSON.stringify(thread)}`);
        workspaceMessageResponse.threads.push(thread);
      } catch (e) {
        logger.error(`Error sending message to channel ID ${channel.id}:`);
        logger.error(e);
      }
    }

    logger.debug(`Total channels to post to: ${workspaceChannelsToPostTo.length}`);
    logger.debug(`Channels: ${JSON.stringify(workspaceChannelsToPostTo)}`);

    return workspaceMessageResponse;
  }

  @CaptureSpan()
  public static async sendAdaptiveCardToChannel(data: {
    authToken: string;
    teamId: string;
    workspaceChannel: WorkspaceChannel;
    adaptiveCard: JSONObject;
    projectId: ObjectID;
  }): Promise<WorkspaceThread> {
    logger.debug(`Sending adaptive card to channel: ${data.workspaceChannel.name} (${data.workspaceChannel.id})`);
    logger.debug(`Team ID: ${data.teamId}`);
    logger.debug(`Adaptive card: ${JSON.stringify(data.adaptiveCard)}`);

    // Get valid access token
    const accessToken = await this.getValidAccessToken({
      authToken: data.authToken,
      projectId: data.projectId,
    });

    logger.debug("Access token obtained, preparing message");

    const chatMessage: JSONObject = {
      body: {
        contentType: "html",
        content: this.convertAdaptiveCardToHtml(data.adaptiveCard),
      },
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: data.adaptiveCard,
        },
      ],
    };

    logger.debug(`Chat message payload: ${JSON.stringify(chatMessage)}`);

    const apiUrl = `https://graph.microsoft.com/v1.0/teams/${data.teamId}/channels/${data.workspaceChannel.id}/messages`;
    logger.debug(`Posting to URL: ${apiUrl}`);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post(
        URL.fromString(apiUrl),
        chatMessage,
        {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      );

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Microsoft Graph API when sending message:");
      logger.error(response);
      throw response;
    }

    logger.debug("Message sent successfully, response:");
    logger.debug(response);

    const messageData: JSONObject = response.data;
    const thread = {
      channel: data.workspaceChannel,
      threadId: messageData["id"] as string,
    };

    logger.debug(`Created thread: ${JSON.stringify(thread)}`);
    return thread;
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelId(data: {
    authToken: string;
    channelId: string;
    teamId: string;
    projectId: ObjectID;
  }): Promise<WorkspaceChannel> {
    try {
      // Get valid access token
      const accessToken = await this.getValidAccessToken({
        authToken: data.authToken,
        projectId: data.projectId,
      });

      // Fetch channel information from Microsoft Graph API
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get(
          URL.fromString(
            `https://graph.microsoft.com/v1.0/teams/${data.teamId}/channels/${data.channelId}`,
          ),
          undefined, 
          {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error getting channel info from Microsoft Graph API:");
        logger.error(response);
        // Fall back to basic channel object
        return {
          id: data.channelId,
          name: data.channelId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        };
      }

      const channelData: JSONObject = response.data;
      return {
        id: channelData["id"] as string,
        name: channelData["displayName"] as string,
        workspaceType: WorkspaceType.MicrosoftTeams,
      };
    } catch (error) {
      logger.error("Error fetching channel information:");
      logger.error(error);
      throw error;
    }
  }

  private static buildAdaptiveCardFromMessageBlocks(data: {
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): JSONObject {
    const card: JSONObject = {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [],
      actions: [],
    };

    const body: Array<JSONObject> = [];
    const actions: Array<JSONObject> = [];

    for (const block of data.messageBlocks) {
      if (block._type === "WorkspacePayloadMarkdown") {
        body.push({
          type: "TextBlock",
          text: (block as WorkspacePayloadMarkdown).text,
          wrap: true,
          markdown: true,
        });
      } else if (block._type === "WorkspacePayloadHeader") {
        body.push({
          type: "TextBlock",
          text: (block as WorkspacePayloadHeader).text,
          size: "Large",
          weight: "Bolder",
          wrap: true,
        });
      } else if (block._type === "WorkspacePayloadButtons") {
        const buttonsBlock: WorkspacePayloadButtons =
          block as WorkspacePayloadButtons;
        for (const button of buttonsBlock.buttons) {
          actions.push({
            type: "Action.OpenUrl",
            title: button.title,
            url: button.url?.toString(),
          });
        }
      }
    }

    card["body"] = body;
    card["actions"] = actions;

    return card;
  }

  private static convertAdaptiveCardToHtml(adaptiveCard: JSONObject): string {
    // Convert adaptive card to basic HTML for fallback
    let html: string = "";
    const body: Array<JSONObject> =
      (adaptiveCard["body"] as Array<JSONObject>) || [];

    for (const element of body) {
      if (element["type"] === "TextBlock") {
        const text: string = element["text"] as string;
        const size: string = element["size"] as string;

        if (size === "Large") {
          html += `<h2>${text}</h2>`;
        } else {
          html += `<p>${text}</p>`;
        }
      }
    }

    const actions: Array<JSONObject> =
      (adaptiveCard["actions"] as Array<JSONObject>) || [];
    if (actions.length > 0) {
      html += "<div>";
      for (const action of actions) {
        if (action["type"] === "Action.OpenUrl") {
          const title: string = action["title"] as string;
          const url: string = action["url"] as string;
          html += `<a href="${url}">${title}</a> `;
        }
      }
      html += "</div>";
    }

    return html;
  }

  // Placeholder implementations for abstract methods
  @CaptureSpan()
  public static override async showModalToUser(_data: {
    authToken: string;
    triggerId: string;
    modalBlock: WorkspaceModalBlock;
  }): Promise<void> {
    // Microsoft Teams doesn't support modals in the same way as Slack
    throw new Error("Modals are not supported in Microsoft Teams integration");
  }

  @CaptureSpan()
  public static override async archiveChannels(_data: {
    userId: string;
    channelIds: Array<string>;
    authToken: string;
    sendMessageBeforeArchiving: WorkspacePayloadMarkdown;
    projectId: ObjectID;
  }): Promise<void> {
    // Microsoft Teams doesn't support archiving channels via API
    throw new Error(
      "Channel archiving is not supported in Microsoft Teams integration",
    );
  }

  @CaptureSpan()
  public static override async joinChannel(_data: {
    authToken: string;
    channelId: string;
  }): Promise<void> {
    // Bot automatically has access to channels in Teams
    logger.debug("Bot automatically has access to Teams channels");
  }

  @CaptureSpan()
  public static override async inviteUserToChannelByChannelId(_data: {
    authToken: string;
    channelId: string;
    workspaceUserId: string;
  }): Promise<void> {
    // Teams channel membership is managed differently
    logger.debug("Teams channel membership is managed at the team level");
  }

  @CaptureSpan()
  public static override async inviteUserToChannelByChannelName(_data: {
    authToken: string;
    channelName: string;
    workspaceUserId: string;
    projectId: ObjectID;
  }): Promise<void> {
    // Teams channel membership is managed differently
    logger.debug("Teams channel membership is managed at the team level");
  }

  @CaptureSpan()
  public static override async getAllWorkspaceChannels(_data: {
    authToken: string;
  }): Promise<Dictionary<WorkspaceChannel>> {
    // This would require team ID - placeholder implementation
    return {};
  }

  @CaptureSpan()
  public static override async doesChannelExist(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
  }): Promise<boolean> {
    const channel: WorkspaceChannel | null =
      await this.getWorkspaceChannelByName(data);
    return channel !== null;
  }

  @CaptureSpan()
  public static override async isUserInDirectMessageChannel(_data: {
    authToken: string;
    userId: string;
    directMessageChannelId: string;
  }): Promise<boolean> {
    return false; // Placeholder
  }

  @CaptureSpan()
  public static override async isUserInChannel(_data: {
    authToken: string;
    channelId: string;
    userId: string;
  }): Promise<boolean> {
    return false; // Placeholder
  }

  // Block generation methods - these create adaptive card elements
  @CaptureSpan()
  public static override getDividerBlock(): JSONObject {
    return {
      type: "Container",
      separator: true,
      items: [],
    };
  }

  @CaptureSpan()
  public static override getButtonsBlock(_data: {
    payloadButtonsBlock: WorkspacePayloadButtons;
  }): JSONObject {
    // Return adaptive card actions
    return {
      type: "ActionSet",
      actions: [],
    };
  }

  @CaptureSpan()
  public static override getHeaderBlock(data: {
    payloadHeaderBlock: WorkspacePayloadHeader;
  }): JSONObject {
    return {
      type: "TextBlock",
      text: data.payloadHeaderBlock.text,
      size: "Large",
      weight: "Bolder",
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
    return {
      type: "Action.OpenUrl",
      title: data.payloadButtonBlock.title,
      url: data.payloadButtonBlock.url?.toString(),
    };
  }

  // Other block methods - placeholders for now
  @CaptureSpan()
  public static override getCheckboxBlock(_data: {
    payloadCheckboxBlock: WorkspaceCheckboxBlock;
  }): JSONObject {
    return { type: "Input.Toggle" };
  }

  @CaptureSpan()
  public static override getDateTimePickerBlock(_data: {
    payloadDateTimePickerBlock: WorkspaceDateTimePickerBlock;
  }): JSONObject {
    return { type: "Input.Date" };
  }

  @CaptureSpan()
  public static override getTextAreaBlock(_data: {
    payloadTextAreaBlock: WorkspaceTextAreaBlock;
  }): JSONObject {
    return { type: "Input.Text", isMultiline: true };
  }

  @CaptureSpan()
  public static override getTextBoxBlock(_data: {
    payloadTextBoxBlock: WorkspaceTextBoxBlock;
  }): JSONObject {
    return { type: "Input.Text" };
  }

  @CaptureSpan()
  public static override getImageBlock(_data: {
    payloadImageBlock: WorkspacePayloadImage;
  }): JSONObject {
    return { type: "Image" };
  }

  @CaptureSpan()
  public static override getDropdownBlock(_data: {
    payloadDropdownBlock: WorkspaceDropdownBlock;
  }): JSONObject {
    return { type: "Input.ChoiceSet" };
  }

  @CaptureSpan()
  public static override getModalBlock(_data: {
    payloadModalBlock: WorkspaceModalBlock;
  }): JSONObject {
    // Teams doesn't support modals like Slack
    return {};
  }

  @CaptureSpan()
  public static override async sendPayloadBlocksToChannel(_data: {
    authToken: string;
    workspaceChannel: WorkspaceChannel;
    blocks: Array<JSONObject>;
  }): Promise<WorkspaceThread> {
    // This is handled by sendAdaptiveCardToChannel
    throw new Error("Use sendAdaptiveCardToChannel instead");
  }

  @CaptureSpan()
  public static convertMarkdownToTeamsRichText(markdown: string): string {
    // Basic markdown to Teams format conversion
    return markdown
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/`(.*?)`/g, "<code>$1</code>");
  }
}
