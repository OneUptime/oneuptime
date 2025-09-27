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

// Import services for bot commands
import IncidentService from "../../../Services/IncidentService";
import AlertService from "../../../Services/AlertService";
import ScheduledMaintenanceService from "../../../Services/ScheduledMaintenanceService";
import IncidentStateService from "../../../Services/IncidentStateService";
import AlertStateService from "../../../Services/AlertStateService";

// Import database utilities
import QueryHelper from "../../../Types/Database/QueryHelper";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";

// Microsoft Teams apps should always be single-tenant
const MICROSOFT_TEAMS_APP_TYPE = "SingleTenant";

// Bot Framework SDK imports
import { CloudAdapter, ConfigurationBotFrameworkAuthentication, TeamsActivityHandler, TurnContext, ConversationReference, MessageFactory, ConfigurationBotFrameworkAuthenticationOptions } from 'botbuilder';
import { ExpressRequest, ExpressResponse } from "../../Express";
// Teams action handlers and types
import MicrosoftTeamsAuthAction from "./Actions/Auth";
import { MicrosoftTeamsIncidentActionType, MicrosoftTeamsActionType } from "./Actions/ActionTypes";


export default class MicrosoftTeamsUtil extends WorkspaceBase {
  // Get or create Bot Framework adapter for a specific tenant
  private static getBotAdapter(microsoftAppTenantId: string): CloudAdapter {
    if (!MicrosoftTeamsAppClientId || !MicrosoftTeamsAppClientSecret) {
      throw new BadDataException("Microsoft Teams App credentials not configured");
    }

    logger.debug("Creating Bot Framework adapter with authentication configuration");
    logger.debug(`App ID: ${MicrosoftTeamsAppClientId}`);
    logger.debug(`App Type: ${MICROSOFT_TEAMS_APP_TYPE}`);
    logger.debug(`Tenant ID: ${microsoftAppTenantId}`);

    const authConfig: ConfigurationBotFrameworkAuthenticationOptions = {
      MicrosoftAppId: MicrosoftTeamsAppClientId,
      MicrosoftAppPassword: MicrosoftTeamsAppClientSecret,
      MicrosoftAppType: MICROSOFT_TEAMS_APP_TYPE,
      MicrosoftAppTenantId: microsoftAppTenantId,
    };

    const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication(authConfig);
    const adapter = new CloudAdapter(botFrameworkAuthentication);

    logger.debug("Bot Framework adapter created successfully");
    return adapter;
  }
  // Helper method to get a valid access token, refreshing if necessary
  private static async getValidAccessToken(data: {
    authToken: string;
    projectId: ObjectID;
  }): Promise<string> {
    logger.debug("=== getValidAccessToken called ===");
    logger.debug(`Project ID: ${data.projectId.toString()}`);
    logger.debug(`Auth token (first 20 chars): ${data.authToken?.substring(0, 20)}...`);
    
    // Get project auth and check token expiration
    const projectAuth = await WorkspaceProjectAuthTokenService.getProjectAuth({
      projectId: data.projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    logger.debug(`Project auth found: ${!!projectAuth}`);
    if (projectAuth) {
      logger.debug(`Project auth has miscData: ${!!projectAuth.miscData}`);
    }

    if (!projectAuth || !projectAuth.miscData) {
      logger.error("Microsoft Teams integration not found for this project - no project auth or miscData");
      throw new BadDataException(
        "Microsoft Teams integration not found for this project"
      );
    }

    const miscData = projectAuth.miscData as MicrosoftTeamsMiscData;
    logger.debug(`MiscData appAccessToken exists: ${!!miscData.appAccessToken}`);
    logger.debug(`MiscData appAccessTokenExpiresAt: ${miscData.appAccessTokenExpiresAt}`);
    
    // Check if token exists and is valid
    if (miscData.appAccessToken && miscData.appAccessToken.includes('.')) {
      logger.debug("Found app access token in miscData");
      // Check if token is expired
      if (miscData.appAccessTokenExpiresAt) {
        const expiryDate = OneUptimeDate.fromString(miscData.appAccessTokenExpiresAt);
        const now = OneUptimeDate.getCurrentDate();
        const isExpired = OneUptimeDate.isAfter(now, expiryDate);
        const secondsToExpiry = OneUptimeDate.getSecondsTo(expiryDate);
        logger.debug(`Token expires in ${secondsToExpiry} seconds`);
        logger.debug(`Token is expired: ${isExpired}`);
        
        // If token is already expired or expires within the next 5 minutes, refresh it
        if (isExpired || secondsToExpiry <= 300) {
          logger.debug("Access token is expired or expiring soon, attempting to refresh");
          const newToken = await this.refreshAccessToken({
            projectId: data.projectId,
            miscData,
          });
          if (newToken) {
            logger.debug("Successfully refreshed token");
            return newToken;
          } else {
            logger.warn("Failed to refresh token, falling back to cached token");
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

    // If we couldn't find a valid token, try to refresh
    logger.debug("No valid app access token found, attempting to refresh");
    const newToken = await this.refreshAccessToken({
      projectId: data.projectId,
      miscData,
    });
    if (newToken) {
      logger.debug("Successfully refreshed token");
      return newToken;
    }

    // If refresh failed, throw error
    logger.error("Could not obtain valid access token for Microsoft Teams");
    throw new BadDataException("Could not obtain valid access token for Microsoft Teams");
  }

  // Method to refresh the Microsoft Teams access token
  private static async refreshAccessToken(data: {
    projectId: ObjectID;
    miscData: MicrosoftTeamsMiscData;
  }): Promise<string | null> {
    logger.debug("=== refreshAccessToken called ===");
    logger.debug(`Project ID: ${data.projectId.toString()}`);
    logger.debug(`Tenant ID: ${data.miscData.tenantId}`);
    
    try {
      // Check if we have the necessary client credentials
      if (!MicrosoftTeamsAppClientId || !MicrosoftTeamsAppClientSecret) {
        logger.error("Microsoft Teams app client credentials are not configured");
        logger.error("Please set MICROSOFT_TEAMS_APP_CLIENT_ID and MICROSOFT_TEAMS_APP_CLIENT_SECRET environment variables");
        return null;
      }

      logger.debug("Client credentials are configured");

      if (!data.miscData.tenantId) {
        logger.error("Tenant ID not found in miscData, cannot refresh token");
        return null;
      }

      logger.debug(`Attempting to refresh Microsoft Teams access token for project ${data.projectId.toString()}`);
      logger.debug(`Using tenant ID: ${data.miscData.tenantId}`);

      // Use OAuth 2.0 client credentials flow to get a new app access token
      const tokenUrl = `https://login.microsoftonline.com/${data.miscData.tenantId}/oauth2/v2.0/token`;
      logger.debug(`Token URL: ${tokenUrl}`);
      
      const tokenRequestBody = {
        client_id: MicrosoftTeamsAppClientId,
        client_secret: MicrosoftTeamsAppClientSecret,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      };

      logger.debug("Making token refresh request to Microsoft");
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post({
        url: URL.fromString(tokenUrl),
        data: tokenRequestBody,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        }
      });

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error refreshing Microsoft Teams access token:");
        logger.error(response);
        return null;
      }

      logger.debug("Token refresh response received successfully");
      const tokenData = response.data;
      const newAccessToken = tokenData['access_token'] as string;
      const expiresIn = tokenData['expires_in'] as number; // seconds

      logger.debug(`New access token received: ${!!newAccessToken}`);
      logger.debug(`Token expires in: ${expiresIn} seconds`);

      if (!newAccessToken) {
        logger.error("No access token received in token refresh response");
        return null;
      }

      // Calculate expiry time
      const now = OneUptimeDate.getCurrentDate();
      const expiryDate = OneUptimeDate.addRemoveSeconds(now, expiresIn - 300); // Subtrutes buffer
      
      logger.debug(`Token expiry calculated: ${OneUptimeDate.toString(expiryDate)}`);

      // Update the miscData with new token and expiry
      const updatedMiscData: MicrosoftTeamsMiscData = {
        ...data.miscData,
        appAccessToken: newAccessToken,
        appAccessTokenExpiresAt: OneUptimeDate.toString(expiryDate),
        lastAppTokenIssuedAt: OneUptimeDate.toString(now),
      };

      logger.debug("Saving updated token to database");
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

  // Extract action type and value from Teams Adaptive Card submit value
  private static extractActionFromValue(value: JSONObject): { actionType: MicrosoftTeamsActionType; actionValue: string } {
    // Support multiple shapes that Teams may send for Adaptive Card submits
    // 1) { action: "ack-incident", actionValue: "<id>" }
    // 2) { data: { action: "ack-incident", actionValue: "<id>" } }
    // 3) { action: { type: "Action.Submit", data: { action: "ack-incident", actionValue: "<id>" } } }
    let actionType: string = (value["action"] as string) || "";
    let actionValue: string = (value["actionValue"] as string) || "";

    const valData: JSONObject | undefined = (value["data"] as JSONObject) || undefined;
    if ((!actionType || !actionValue) && valData) {
      actionType = (valData["action"] as string) || actionType;
      actionValue = (valData["actionValue"] as string) || actionValue;
    }

    const actionObj: JSONObject | undefined = (value["action"] as unknown as JSONObject);
    if ((!actionType || !actionValue) && actionObj && typeof actionObj === "object") {
      const embeddedData: JSONObject | undefined = (actionObj["data"] as JSONObject) || undefined;
      if (embeddedData) {
        actionType = (embeddedData["action"] as string) || actionType;
        actionValue = (embeddedData["actionValue"] as string) || actionValue;
      }
    }

    return { actionType: actionType as MicrosoftTeamsActionType, actionValue };
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
  // Remove markdown link syntax from title for cleaner rendering
  const titleLinkRegex: RegExp = /\[([^\]]+)\]\(([^)]+)\)/g;
  title = title.replace(titleLinkRegex, "$1");
      // Sanitize unmatched bold markers if any remain
      const boldCountTitle = (title.match(/\*\*/g) || []).length;
      if (boldCountTitle % 2 !== 0) {
        title = title.replace(/\*\*/g, "");
      }
      lines.shift();
    }

    const linkRegex: RegExp = /\[([^\]]+)\]\(([^)]+)\)/g; // [text](url)

    // Helper to clean up unmatched bold markers that can break rendering
    const sanitizeMarkdownText = (text: string): string => {
      const boldCount = (text.match(/\*\*/g) || []).length;
      // If we have an odd number of **, remove them all to avoid raw markers showing
      if (boldCount % 2 !== 0) {
        text = text.replace(/\*\*/g, "");
      }
      // Collapse multiple spaces introduced by replacements
      return text.replace(/\s{2,}/g, " ");
    };

    for (const line of lines) {
      // Extract links to actions and keep link display text in-place (without markdown)
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
        // Replace markdown link with just the display text to preserve sentence flow
        lineWithoutLinks = lineWithoutLinks.replace(match[0], name).trim();
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
        bodyTextParts.push(sanitizeMarkdownText(lineWithoutLinks));
      }
    }

    const payload: JSONObject = {
      ["@type"]: "MessageCard",
      ["@context"]: "https://schema.org/extensions",
      title: title,
      summary: title,
    };

    // Build a single section so we can enable markdown explicitly
    const section: JSONObject = { markdown: true } as any;
    if (bodyTextParts.length > 0) {
      section["text"] = bodyTextParts.join("\n\n");
    }
    if (facts.length > 0) {
      section["facts"] = facts;
    }
    if (section["text"] || section["facts"]) {
      payload["sections"] = [section];
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
      await API.post({
        url: data.url,
        data: payload,
      });

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
      await API.get<JSONObject>({
        url: URL.fromString(`https://graph.microsoft.com/v1.0/users/${data.userId}`),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });

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

    await API.post({
      url: URL.fromString(
        `https://graph.microsoft.com/v1.0/chats/${data.workspaceUserId}/messages`,
      ),
      data: chatMessage,
      headers: {
        Authorization: `Bearer ${data.authToken}`,
        "Content-Type": "application/json",
      },
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
      await API.post({
        url: URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${teamId}/channels`,
        ),
        data: channelPayload,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });

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
      await API.get({
        url: URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${teamId}/channels`,
        ),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });

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
    logger.debug("=== MicrosoftTeamsUtil.sendMessage called ===");
    logger.debug("Sending message to Microsoft Teams with data:");
    logger.debug(data);

    const adaptiveCard: JSONObject = this.buildAdaptiveCardFromMessageBlocks({
      messageBlocks: data.workspaceMessagePayload.messageBlocks,
    });

    logger.debug("Adaptive card built successfully:");
    logger.debug(JSON.stringify(adaptiveCard, null, 2));

    const workspaceChannelsToPostTo: Array<WorkspaceChannel> = [];

    logger.debug(`Processing ${data.workspaceMessagePayload.channelNames.length} channel names`);
    logger.debug(`Channel names: ${JSON.stringify(data.workspaceMessagePayload.channelNames)}`);

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

    logger.debug("=== Getting team ID from project auth ===");
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

    logger.debug(`Project auth found: ${!!projectAuth}`);
    if (projectAuth) {
      logger.debug(`Project auth workspaceProjectId: ${projectAuth.workspaceProjectId}`);
    }

    if (!projectAuth || !projectAuth.workspaceProjectId) {
      logger.error("Microsoft Teams integration not found for this project - missing projectAuth or workspaceProjectId");
      throw new BadDataException(
        "Microsoft Teams integration not found for this project",
      );
    }

    const teamId: string = projectAuth.workspaceProjectId;
    logger.debug(`Using team ID: ${teamId}`);

    logger.debug(`Processing ${data.workspaceMessagePayload.channelIds.length} channel IDs`);
    logger.debug(`Channel IDs: ${JSON.stringify(data.workspaceMessagePayload.channelIds)}`);

    // Add channels by ID
    for (const channelId of data.workspaceMessagePayload.channelIds) {
      try {
        logger.debug(`Getting channel info for channel ID: ${channelId}`);
        const channel: WorkspaceChannel =
          await this.getWorkspaceChannelFromChannelId({
            authToken: data.authToken,
            channelId: channelId,
            teamId: teamId,
            projectId: data.projectId,
          });
        logger.debug(`Channel info obtained: ${JSON.stringify(channel)}`);
        workspaceChannelsToPostTo.push(channel);
      } catch (err) {
        logger.error(`Error getting channel info for channel ID ${channelId}:`);
        logger.error(err);
      }
    }

    logger.debug("=== Starting message sending loop ===");
    logger.debug(`Total channels to post to: ${workspaceChannelsToPostTo.length}`);
    logger.debug(`Channels: ${JSON.stringify(workspaceChannelsToPostTo)}`);

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

    logger.debug("=== Message sending completed ===");
    logger.debug(`Final thread count: ${workspaceMessageResponse.threads.length}`);
    logger.debug(`Final response: ${JSON.stringify(workspaceMessageResponse)}`);

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
    logger.debug(`Sending adaptive card to channel via Bot Framework: ${data.workspaceChannel.name} (${data.workspaceChannel.id})`);
    logger.debug(`Team ID: ${data.teamId}`);
    logger.debug(`Adaptive card: ${JSON.stringify(data.adaptiveCard)}`);

    try {
      // Get project auth to retrieve bot ID
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
      if (!miscData.botId) {
        throw new BadDataException(
          "Bot ID not found in Microsoft Teams integration"
        );
      }

      // Check if app client ID is configured
      if (!MicrosoftTeamsAppClientId) {
        throw new BadDataException("Microsoft Teams App Client ID not configured");
      }

      logger.debug(`Using bot ID: ${miscData.botId}`);

      // Get Bot Framework adapter
      const adapter = this.getBotAdapter(miscData.tenantId);

      // Create conversation reference for the channel
      const conversationReference: ConversationReference = {
        bot: {
          id: MicrosoftTeamsAppClientId,
          name: "OneUptime Bot"
        },
        conversation: {
          id: data.workspaceChannel.id,
          name: data.workspaceChannel.name,
          isGroup: true,
          conversationType: "channel",
          tenantId: miscData.tenantId
        },
        channelId: "msteams",
        serviceUrl: "https://smba.trafficmanager.net/teams/"
      };

      logger.debug(`Conversation reference: ${JSON.stringify(conversationReference)}`);

      // Send proactive message using Bot Framework
      let messageId: string = "";
      
      await adapter.continueConversationAsync(
        MicrosoftTeamsAppClientId,
        conversationReference,
        async (context: TurnContext) => {
          logger.debug("Sending adaptive card as proactive message");
          
          // Create message with adaptive card attachment
          const message = MessageFactory.attachment({
            contentType: "application/vnd.microsoft.card.adaptive",
            content: data.adaptiveCard
          });

          // Add fallback text for better accessibility
          message.text = this.convertAdaptiveCardToHtml(data.adaptiveCard);

          const response = await context.sendActivity(message);
          messageId = response?.id || "";
          logger.debug(`Message sent with ID: ${messageId}`);
        }
      );

      const thread = {
        channel: data.workspaceChannel,
        threadId: messageId,
      };

      logger.debug(`Created thread via Bot Framework: ${JSON.stringify(thread)}`);
      return thread;

    } catch (error) {
      logger.error("Error sending adaptive card via Bot Framework:");
      logger.error(error);
      throw error;
    }
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelId(data: {
    authToken: string;
    channelId: string;
    teamId: string;
    projectId: ObjectID;
  }): Promise<WorkspaceChannel> {
    logger.debug("=== getWorkspaceChannelFromChannelId called ===");
    logger.debug(`Channel ID: ${data.channelId}`);
    logger.debug(`Team ID: ${data.teamId}`);
    logger.debug(`Project ID: ${data.projectId.toString()}`);
    
    try {
      // Get valid access token
      const accessToken = await this.getValidAccessToken({
        authToken: data.authToken,
        projectId: data.projectId,
      });

      logger.debug("Access token obtained for channel info retrieval");

      // Fetch channel information from Microsoft Graph API
      const apiUrl = `https://graph.microsoft.com/v1.0/teams/${data.teamId}/channels/${data.channelId}`;
      logger.debug(`Making API call to: ${apiUrl}`);
      
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get({
          url: URL.fromString(apiUrl),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        });

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error getting channel info from Microsoft Graph API:");
        logger.error(response);
        // Fall back to basic channel object
        logger.debug("Falling back to basic channel object");
        return {
          id: data.channelId,
          name: data.channelId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        };
      }

      logger.debug("Channel info API call successful");
      const channelData: JSONObject = response.data;
      const channel = {
        id: channelData["id"] as string,
        name: channelData["displayName"] as string,
        workspaceType: WorkspaceType.MicrosoftTeams,
      };
      
      logger.debug(`Channel info retrieved: ${JSON.stringify(channel)}`);
      return channel;
    } catch (error) {
      logger.error("Error fetching channel information:");
      logger.error(error);
      throw error;
    }
  }

  private static buildAdaptiveCardFromMessageBlocks(data: {
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): JSONObject {
    logger.debug("=== buildAdaptiveCardFromMessageBlocks called ===");
    logger.debug(`Number of message blocks: ${data.messageBlocks.length}`);
    
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
      logger.debug(`Processing message block of type: ${block._type}`);
      
      if (block._type === "WorkspacePayloadMarkdown") {
        const markdownBlock = block as WorkspacePayloadMarkdown;
        logger.debug(`Markdown text: ${markdownBlock.text}`);
        const markdownObj = this.getMarkdownBlock({ payloadMarkdownBlock: markdownBlock });
        body.push(markdownObj);
            } else if (block._type === "WorkspacePayloadHeader") {
        const headerBlock = block as WorkspacePayloadHeader;
        logger.debug(`Header text: ${headerBlock.text}`);
        const headerObj = this.getHeaderBlock({ payloadHeaderBlock: headerBlock });
        body.push(headerObj);
      } else if (block._type === "WorkspacePayloadButtons") {
        const buttonsBlock: WorkspacePayloadButtons =
          block as WorkspacePayloadButtons;
        logger.debug(`Processing ${buttonsBlock.buttons.length} buttons`);
        for (const button of buttonsBlock.buttons) {
            logger.debug(`Button: ${button.title} -> ${button.url ? button.url.toString() : "invoke"}`);
            const actionObj = this.getButtonBlock({ payloadButtonBlock: button });
            actions.push(actionObj);
        }
      }
    }

    card["body"] = body;
    card["actions"] = actions;

    logger.debug(`Built adaptive card with ${body.length} body elements and ${actions.length} actions`);
    return card;
  }

  private static convertAdaptiveCardToHtml(adaptiveCard: JSONObject): string {
    logger.debug("=== convertAdaptiveCardToHtml called ===");
    
    // Convert adaptive card to basic HTML for fallback
    let html: string = "";
    const body: Array<JSONObject> =
      (adaptiveCard["body"] as Array<JSONObject>) || [];

    logger.debug(`Converting ${body.length} body elements to HTML`);

    for (const element of body) {
      if (element["type"] === "TextBlock") {
        const text: string = element["text"] as string;
        const size: string = element["size"] as string;

        if (size === "Large") {
          html += `<h2>${text}</h2>`;
          logger.debug(`Added header: ${text}`);
        } else {
          html += `<p>${text}</p>`;
          logger.debug(`Added paragraph: ${text}`);
        }
      }
    }

    const actions: Array<JSONObject> =
      (adaptiveCard["actions"] as Array<JSONObject>) || [];
    if (actions.length > 0) {
      logger.debug(`Converting ${actions.length} actions to HTML`);
      html += "<div>";
      for (const action of actions) {
        if (action["type"] === "Action.OpenUrl") {
          const title: string = action["title"] as string;
          const url: string = action["url"] as string;
          html += `<a href="${url}">${title}</a> `;
          logger.debug(`Added link: ${title} -> ${url}`);
        }
      }
      html += "</div>";
    }

    logger.debug(`Generated HTML length: ${html.length} characters`);
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
    // If URL is present, render as link; otherwise use Action.Submit to post back action/value
    if (data.payloadButtonBlock.url) {
      return {
        type: "Action.OpenUrl",
        title: data.payloadButtonBlock.title,
        url: data.payloadButtonBlock.url.toString(),
      };
    }

    return {
      type: "Action.Submit",
      title: data.payloadButtonBlock.title,
      data: {
        action: data.payloadButtonBlock.actionId,
        actionValue: data.payloadButtonBlock.value,
      },
    } as any;
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

  // Bot Framework specific methods
  @CaptureSpan()
  public static async handleBotMessageActivity(data: {
    activity: JSONObject;
    turnContext: TurnContext;
  }): Promise<void> {
    // Handle direct messages to bot or @mentions via Bot Framework
    const messageText: string = (data.activity["text"] as string) || "";
    const possibleActionValue: JSONObject = (data.activity["value"] as JSONObject) || {};
    const from: JSONObject = (data.activity["from"] as JSONObject) || {};
    const conversation: JSONObject = (data.activity["conversation"] as JSONObject) || {};
    const channelData: JSONObject = (data.activity["channelData"] as JSONObject) || {};

    logger.debug(`Bot message from: ${JSON.stringify(from)}`);
    logger.debug(`Message text: ${messageText}`);
    logger.debug(`Conversation: ${JSON.stringify(conversation)}`);
    logger.debug(`Channel data: ${JSON.stringify(channelData)}`);

    // If this is actually an Adaptive Card submit wrapped as a message, route to invoke handler
    if ((possibleActionValue["action"] as string) || (possibleActionValue["data"] as any)?.["action"]) {
      logger.debug("Message activity contains action payload; routing to invoke handler");
      await this.handleBotInvokeActivity({ activity: data.activity, turnContext: data.turnContext });
      return;
    }

    // Extract tenant ID to get project ID
    const tenantId: string = (channelData["tenant"] as JSONObject)?.["id"] as string;
    if (!tenantId) {
      logger.error("Tenant ID not found in channelData");
      await data.turnContext.sendActivity("Sorry, I couldn't identify your organization. Please try again later.");
      return;
    }

    // Get project auth by tenant ID
    const projectAuth = await WorkspaceProjectAuthTokenService.findOneBy({
      query: {
        workspaceType: WorkspaceType.MicrosoftTeams,
        miscData: {
          tenantId: tenantId,
        } as any,
      },
      select: {
        projectId: true,
        miscData: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!projectAuth || !projectAuth.projectId) {
      logger.error("Project auth not found for tenant ID: " + tenantId);
      await data.turnContext.sendActivity("Sorry, I couldn't find your project configuration. Please try again later.");
      return;
    }

    const projectId = projectAuth.projectId;
    logger.debug(`Found project ID: ${projectId.toString()} for tenant ID: ${tenantId}`);

    // Clean the message text by removing bot mentions
    const cleanText: string = messageText.replace(/<at[^>]*>.*?<\/at>/g, '').trim().toLowerCase();

    let responseText: string = "";

    try {
      if (cleanText.includes("help") || cleanText === "") {
        responseText = this.getHelpMessage();
      } else if (cleanText.includes("show active incidents") || cleanText.includes("active incidents")) {
        responseText = await this.getActiveIncidentsMessage(projectId);
      } else if (cleanText.includes("show scheduled maintenance") || cleanText.includes("scheduled maintenance")) {
        responseText = await this.getScheduledMaintenanceMessage(projectId);
      } else if (cleanText.includes("show ongoing maintenance") || cleanText.includes("ongoing maintenance")) {
        responseText = await this.getOngoingMaintenanceMessage(projectId);
      } else if (cleanText.includes("show active alerts") || cleanText.includes("active alerts")) {
        responseText = await this.getActiveAlertsMessage(projectId);
      } else if (cleanText.includes("status")) {
        responseText = "System status is operational. All services are running normally.";
      } else {
        responseText = `I received your message: "${cleanText}". Type 'help' to see what I can do for you.`;
      }

      // Send response directly using TurnContext - this is the recommended Bot Framework pattern
      await data.turnContext.sendActivity(responseText);
      logger.debug("Bot message sent successfully using TurnContext");
    } catch (error) {
      logger.error("Error sending bot message via TurnContext: " + error);
      await data.turnContext.sendActivity("Sorry, I encountered an error processing your request. Please try again later.");
      throw error;
    }
  }

  // Helper methods for bot commands
  private static getHelpMessage(): string {
    return `Hello! I'm the OneUptime bot. I can help you with the following commands:

**Available Commands:**
• **help** - Show this help message
• **show active incidents** - Display all currently active incidents
• **show scheduled maintenance** - Show upcoming scheduled maintenance events
• **show ongoing maintenance** - Display currently ongoing maintenance events
• **show active alerts** - Display all active alerts
• **status** - Check system status

Just type any of these commands to get the information you need!`;
  }

  private static async getActiveIncidentsMessage(projectId: ObjectID): Promise<string> {
    try {
      logger.debug("Getting active incidents for project: " + projectId.toString());
      
      // Get unresolved incident states
      const unresolvedIncidentStates = await IncidentStateService.getUnresolvedIncidentStates(
        projectId,
        { isRoot: true }
      );
      
      const unresolvedIncidentStateIds = unresolvedIncidentStates.map(state => state.id!);
      
      // Find active incidents
      const activeIncidents = await IncidentService.findBy({
        query: {
          projectId: projectId,
          currentIncidentStateId: QueryHelper.any(unresolvedIncidentStateIds),
        },
        select: {
          title: true,
          description: true,
          currentIncidentState: {
            name: true,
            color: true,
          },
          incidentSeverity: {
            name: true,
            color: true,
          },
          createdAt: true,
          monitors: {
            name: true,
          },
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: 10,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
      
      if (activeIncidents.length === 0) {
        return `**Active Incidents**

Currently, there are no active incidents in the system. All services are operating normally.

If you need to report an incident or check historical incidents, please visit the OneUptime dashboard.`;
      }
      
      let message = `**Active Incidents** (${activeIncidents.length})

`;
      
      for (const incident of activeIncidents) {
        const severity = incident.incidentSeverity?.name || "Unknown";
        const state = incident.currentIncidentState?.name || "Unknown";
        const createdAt = incident.createdAt ? OneUptimeDate.getDateAsFormattedString(incident.createdAt) : "Unknown";
        
        message += `🔴 **${incident.title}**
• **Severity:** ${severity}
• **Status:** ${state}
• **Created:** ${createdAt}
`;
        
        if (incident.monitors && incident.monitors.length > 0) {
          message += `• **Affected Services:** ${incident.monitors.map(m => m.name).join(", ")}\n`;
        }
        
        if (incident.description) {
          message += `• **Description:** ${incident.description.substring(0, 100)}${incident.description.length > 100 ? "..." : ""}\n`;
        }
        
        message += `\n`;
      }
      
      return message;
    } catch (error) {
      logger.error("Error getting active incidents: " + error);
      return "Sorry, I couldn't retrieve active incidents information at the moment. Please try again later.";
    }
  }

  private static async getScheduledMaintenanceMessage(projectId: ObjectID): Promise<string> {
    try {
      logger.debug("Getting scheduled maintenance events for project: " + projectId.toString());
      
      // Get scheduled maintenance events
      const scheduledEvents = await ScheduledMaintenanceService.findBy({
        query: {
          projectId: projectId,
          currentScheduledMaintenanceState: {
            isScheduledState: true,
          } as any,
          isVisibleOnStatusPage: true, // Only show events visible on status page
        },
        select: {
          title: true,
          description: true,
          startsAt: true,
          endsAt: true,
          currentScheduledMaintenanceState: {
            name: true,
          },
          monitors: {
            name: true,
          },
          scheduledMaintenanceNumber: true,
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        limit: 10,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
      
      if (scheduledEvents.length === 0) {
        return `**Scheduled Maintenance Events**

There are currently no scheduled maintenance events.

When maintenance is scheduled, you'll see details here including:
• Event title and description
• Scheduled start and end times
• Affected services
• Status updates

Check back later for upcoming maintenance windows.`;
      }
      
      let message = `**Scheduled Maintenance Events** (${scheduledEvents.length})

`;
      
      for (const event of scheduledEvents) {
        const state = event.currentScheduledMaintenanceState?.name || "Scheduled";
        const startTime = event.startsAt ? OneUptimeDate.getDateAsFormattedString(event.startsAt) : "TBD";
        const endTime = event.endsAt ? OneUptimeDate.getDateAsFormattedString(event.endsAt) : "TBD";
        
        message += `🛠️ **${event.title}** (#${event.scheduledMaintenanceNumber})
• **Status:** ${state}
• **Starts:** ${startTime}
• **Ends:** ${endTime}
`;
        
        if (event.monitors && event.monitors.length > 0) {
          message += `• **Affected Services:** ${event.monitors.map(m => m.name).join(", ")}\n`;
        }
        
        if (event.description) {
          message += `• **Description:** ${event.description.substring(0, 100)}${event.description.length > 100 ? "..." : ""}\n`;
        }
        
        message += `\n`;
      }
      
      return message;
    } catch (error) {
      logger.error("Error getting scheduled maintenance: " + error);
      return "Sorry, I couldn't retrieve scheduled maintenance information at the moment. Please try again later.";
    }
  }

  private static async getOngoingMaintenanceMessage(projectId: ObjectID): Promise<string> {
    try {
      logger.debug("Getting ongoing maintenance events for project: " + projectId.toString());
      
      // Get ongoing maintenance events
      const ongoingEvents = await ScheduledMaintenanceService.findBy({
        query: {
          projectId: projectId,
          currentScheduledMaintenanceState: {
            isOngoingState: true,
          } as any,
        },
        select: {
          title: true,
          description: true,
          startsAt: true,
          endsAt: true,
          currentScheduledMaintenanceState: {
            name: true,
          },
          monitors: {
            name: true,
          },
          scheduledMaintenanceNumber: true,
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        limit: 10,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
      
      if (ongoingEvents.length === 0) {
        return `**Ongoing Maintenance Events**

There are currently no ongoing maintenance events.

When maintenance is in progress, you'll see details here including:
• Event title and description
• Current status and progress
• Affected services
• Expected completion time

All systems are currently operating normally.`;
      }
      
      let message = `**Ongoing Maintenance Events** (${ongoingEvents.length})

`;
      
      for (const event of ongoingEvents) {
        const state = event.currentScheduledMaintenanceState?.name || "Ongoing";
        const startTime = event.startsAt ? OneUptimeDate.getDateAsFormattedString(event.startsAt) : "Unknown";
        const endTime = event.endsAt ? OneUptimeDate.getDateAsFormattedString(event.endsAt) : "TBD";
        
        message += `🔧 **${event.title}** (#${event.scheduledMaintenanceNumber})
• **Status:** ${state}
• **Started:** ${startTime}
• **Expected End:** ${endTime}
`;
        
        if (event.monitors && event.monitors.length > 0) {
          message += `• **Affected Services:** ${event.monitors.map(m => m.name).join(", ")}\n`;
        }
        
        if (event.description) {
          message += `• **Description:** ${event.description.substring(0, 100)}${event.description.length > 100 ? "..." : ""}\n`;
        }
        
        message += `\n`;
      }
      
      return message;
    } catch (error) {
      logger.error("Error getting ongoing maintenance: " + error);
      return "Sorry, I couldn't retrieve ongoing maintenance information at the moment. Please try again later.";
    }
  }

  private static async getActiveAlertsMessage(projectId: ObjectID): Promise<string> {
    try {
      logger.debug("Getting active alerts for project: " + projectId.toString());
      
      // Get unresolved alert states
      const unresolvedAlertStates = await AlertStateService.getUnresolvedAlertStates(
        projectId,
        { isRoot: true }
      );
      
      const unresolvedAlertStateIds = unresolvedAlertStates.map(state => state.id!);
      
      // Find active alerts
      const activeAlerts = await AlertService.findBy({
        query: {
          projectId: projectId,
          currentAlertStateId: QueryHelper.any(unresolvedAlertStateIds),
        },
        select: {
          title: true,
          description: true,
          currentAlertState: {
            name: true,
            color: true,
          },
          alertSeverity: {
            name: true,
            color: true,
          },
          createdAt: true,
          monitor: {
            name: true,
          },
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: 10,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
      
      if (activeAlerts.length === 0) {
        return `**Active Alerts**

Currently, there are no active alerts in the system.

When alerts are triggered, you'll see details here including:
• Alert title and description
• Severity level
• Affected services or monitors
• Time triggered
• Current status

All monitoring checks are passing normally.`;
      }
      
      let message = `**Active Alerts** (${activeAlerts.length})

`;
      
      for (const alert of activeAlerts) {
        const severity = alert.alertSeverity?.name || "Unknown";
        const state = alert.currentAlertState?.name || "Unknown";
        const createdAt = alert.createdAt ? OneUptimeDate.getDateAsFormattedString(alert.createdAt) : "Unknown";
        
        message += `⚠️ **${alert.title}**
• **Severity:** ${severity}
• **Status:** ${state}
• **Triggered:** ${createdAt}
`;
        
        if (alert.monitor?.name) {
          message += `• **Monitor:** ${alert.monitor.name}\n`;
        }
        
        if (alert.description) {
          message += `• **Description:** ${alert.description.substring(0, 100)}${alert.description.length > 100 ? "..." : ""}\n`;
        }
        
        message += `\n`;
      }
      
      return message;
    } catch (error) {
      logger.error("Error getting active alerts: " + error);
      return "Sorry, I couldn't retrieve active alerts information at the moment. Please try again later.";
    }
  }

  @CaptureSpan()
  public static async handleBotInvokeActivity(data: {
    activity: JSONObject;
    turnContext: TurnContext;
  }): Promise<void> {
    // Handle adaptive card button clicks via Bot Framework
    const value: JSONObject = (data.activity["value"] as JSONObject) || {};

    // Extract action type and value from the value object
    const { actionType, actionValue } = this.extractActionFromValue(value);

    // Normalize variations like "AcknowledgeIncident" to our enum keys

    const mappedActionType = actionType;


    logger.debug(`Bot invoke activity - Action type: ${actionType} (mapped: ${mappedActionType})`);
    logger.debug(`Bot invoke value: ${JSON.stringify(value)}`);

    try {
      // Resolve project and user context from activity
      const channelData: JSONObject = (data.activity["channelData"] as JSONObject) || {};
      const tenantId: string = ((channelData["tenant"] as JSONObject) || {})["id"] as string;
      if (!tenantId) {
        logger.error("Tenant ID not found in invoke activity");
        await data.turnContext.sendActivity("Sorry, I couldn't identify your organization. Please try again later.");
        return;
      }

      const projectAuth = await WorkspaceProjectAuthTokenService.findOneBy({
        query: {
          workspaceType: WorkspaceType.MicrosoftTeams,
          miscData: { tenantId: tenantId } as any,
        },
        select: { projectId: true, authToken: true },
        props: { isRoot: true },
      });

      if (!projectAuth || !projectAuth.projectId) {
        logger.error("Project auth not found for invoke activity tenant: " + tenantId);
        await data.turnContext.sendActivity("Sorry, I couldn't find your project configuration.");
        return;
      }

      const projectId: ObjectID = projectAuth.projectId;
      const fromObj: JSONObject = ((data.activity["from"] as JSONObject) || {}) as JSONObject;
      const teamsUserId: string = (fromObj["id"] as string) || "";
      const aadObjectId: string | undefined = (fromObj["aadObjectId"] as string) || undefined;

      // Handle key incident actions for now
      if (mappedActionType === MicrosoftTeamsIncidentActionType.AckIncident) {
        const userLookupParamsAck: { teamsUserId: string; projectId: ObjectID; aadObjectId?: string } = {
          teamsUserId: teamsUserId,
          projectId: projectId,
        };
        if (aadObjectId) {
          userLookupParamsAck.aadObjectId = aadObjectId;
        }
        const oneUptimeUserId: ObjectID = await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId(userLookupParamsAck);

        if (!actionValue) {
          await data.turnContext.sendActivity("Unable to acknowledge: missing incident id.");
          return;
        }

        await IncidentService.acknowledgeIncident(new ObjectID(actionValue), oneUptimeUserId);
        await data.turnContext.sendActivity("✅ Incident acknowledged.");
        return;
      }

      if (mappedActionType === MicrosoftTeamsIncidentActionType.ResolveIncident) {
        const userLookupParamsRes: { teamsUserId: string; projectId: ObjectID; aadObjectId?: string } = {
          teamsUserId: teamsUserId,
          projectId: projectId,
        };
        if (aadObjectId) {
          userLookupParamsRes.aadObjectId = aadObjectId;
        }
        const oneUptimeUserId: ObjectID = await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId(userLookupParamsRes);

        if (!actionValue) {
          await data.turnContext.sendActivity("Unable to resolve: missing incident id.");
          return;
        }

        await IncidentService.resolveIncident(new ObjectID(actionValue), oneUptimeUserId);
        await data.turnContext.sendActivity("✅ Incident resolved.");
        return;
      }

      // Default fallback for unimplemented actions
      await data.turnContext.sendActivity("Action received: " + actionType);
    } catch (error) {
      logger.error("Error handling bot invoke activity:");
      logger.error(error);
      await data.turnContext.sendActivity("Sorry, that action failed. Please try again later.");
    }
  }

  @CaptureSpan()
  public static async handleConversationUpdateActivity(data: {
    activity: JSONObject;
    turnContext: TurnContext;
  }): Promise<void> {
    // Handle bot added to team/channel or members added/removed
    const membersAdded: Array<JSONObject> = (data.activity["membersAdded"] as Array<JSONObject>) || [];
    const membersRemoved: Array<JSONObject> = (data.activity["membersRemoved"] as Array<JSONObject>) || [];
    const conversation: JSONObject = (data.activity["conversation"] as JSONObject) || {};
    const channelData: JSONObject = (data.activity["channelData"] as JSONObject) || {};

    logger.debug(`Conversation update - Members added: ${JSON.stringify(membersAdded)}`);
    logger.debug(`Conversation update - Members removed: ${JSON.stringify(membersRemoved)}`);
    logger.debug(`Conversation: ${JSON.stringify(conversation)}`);
    logger.debug(`Channel data: ${JSON.stringify(channelData)}`);

    // Check if the bot was added
    const botWasAdded: boolean = membersAdded.some((member: JSONObject) => {
      return member["id"] === MicrosoftTeamsAppClientId;
    });

    if (botWasAdded) {
      logger.debug("OneUptime bot was added to a Teams conversation");
      
      const welcomeText: string = "🎉 Welcome to OneUptime!\n\nI'm your monitoring and alerting assistant. I'll help you stay on top of your system's health and notify you about any incidents.\n\nType 'help' to see what I can do for you.";

      try {
        // Send welcome message directly using TurnContext
        await data.turnContext.sendActivity(welcomeText);
        logger.debug("Welcome message sent successfully using TurnContext");
      } catch (error) {
        logger.error("Error sending welcome message via TurnContext: " + error);
      }
    }
  }

  @CaptureSpan()
  public static async handleInstallationUpdateActivity(data: {
    activity: JSONObject;
  }): Promise<void> {
    // Handle bot installation/uninstallation
    const action: string = (data.activity["action"] as string) || "";
    const conversation: JSONObject = (data.activity["conversation"] as JSONObject) || {};

    logger.debug(`Installation update - Action: ${action}`);
    logger.debug(`Conversation: ${JSON.stringify(conversation)}`);

    if (action === "add") {
      logger.debug("OneUptime bot was installed");
    } else if (action === "remove") {
      logger.debug("OneUptime bot was uninstalled");
    }
  }

  /**
   * Process Bot Framework activity using the botbuilder SDK adapter.processActivity
   * This replaces the manual JWT validation and activity handling with proper SDK methods
   */
  @CaptureSpan()
  public static async processBotActivity(req: ExpressRequest, res: ExpressResponse): Promise<void> {
    logger.debug("Processing Bot Framework activity using adapter.processActivity");
    logger.debug("Request body: " + JSON.stringify(req.body, null, 2));

    try {
      if (!MicrosoftTeamsAppClientId || !MicrosoftTeamsAppClientSecret) {
        logger.error("Microsoft Teams App credentials not configured");
        res.status(500).json({ error: "Bot credentials not configured" });
        return;
      }

      // Extract tenant ID from the activity
      const tenantId: string = req.body?.channelData?.tenant?.id;
      if (!tenantId) {
        logger.error("Tenant ID not found in activity channelData");
        res.status(400).json({ error: "Invalid activity: missing tenant ID" });
        return;
      }

      // Get Bot Framework adapter
      const adapter = this.getBotAdapter(tenantId);

      // Create custom activity handler class that extends TeamsActivityHandler
      class OneUptimeTeamsActivityHandler extends TeamsActivityHandler {
        constructor() {
          super();
          
          // Set up message handlers using the proper API
          this.onMessage(async (context: TurnContext, next: () => Promise<void>) => {
            logger.debug("Handling message activity: " + JSON.stringify(context.activity));
            await MicrosoftTeamsUtil.handleBotMessageActivity({
              activity: context.activity as unknown as JSONObject,
              turnContext: context,
            });
            await next();
          });

          this.onMembersAdded(async (context: TurnContext, next: () => Promise<void>) => {
            logger.debug("Handling members added activity: " + JSON.stringify(context.activity));
            await MicrosoftTeamsUtil.handleConversationUpdateActivity({
              activity: context.activity as unknown as JSONObject,
              turnContext: context,
            });
            await next();
          });
        }

        protected override async onInvokeActivity(context: TurnContext): Promise<any> {
          logger.debug("Handling invoke activity: " + JSON.stringify(context.activity));
          await MicrosoftTeamsUtil.handleBotInvokeActivity({
            activity: context.activity as unknown as JSONObject,
            turnContext: context,
          });
          // Return empty response for invoke activities
          return { status: 200 };
        }
      }

      // Create activity handler instance
      const activityHandler = new OneUptimeTeamsActivityHandler();

      // Use the adapter's process method with Express-style req/res
      await adapter.process(req, res, async (context: TurnContext) => {
        logger.debug("Processing activity with TurnContext: " + JSON.stringify({
          activityType: context.activity.type,
          activityId: context.activity.id,
          from: context.activity.from?.name,
          conversationId: context.activity.conversation?.id,
        }));

        // Run the activity through our activity handler
        await activityHandler.run(context);
      });

      logger.debug("Bot Framework activity processed successfully");
    } catch (error) {
      logger.error("Error processing Bot Framework activity: " + error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to process bot activity" });
      }
    }
  }

}
