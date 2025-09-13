import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
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
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsMiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import {
  MicrosoftTeamsAppClientId,
  MicrosoftTeamsAppClientSecret,
} from "../../../EnvironmentConfig";
import { CloudAdapter, ConversationReference, TurnContext } from "botbuilder";
import MicrosoftTeamsTokenRefresher from "./MicrosoftTeamsTokenRefresher";
// Legacy Graph channel send logic removed: bot conversation references are now the sole delivery path for notifications.

export default class MicrosoftTeams extends WorkspaceBase {
  private static cloudAdapter: CloudAdapter | null = null;
  private static getOrCreateCloudAdapter(): CloudAdapter {
    if (this.cloudAdapter) {
      return this.cloudAdapter;
    }
    if (!(MicrosoftTeamsAppClientId && MicrosoftTeamsAppClientSecret)) {
      throw new BadRequestException(
        "Teams bot credentials not configured (MICROSOFT_TEAMS_APP_CLIENT_ID / MICROSOFT_TEAMS_APP_CLIENT_SECRET).",
      );
    }
    try {
      this.cloudAdapter = new CloudAdapter({
        MicrosoftAppId: MicrosoftTeamsAppClientId,
        MicrosoftAppPassword: MicrosoftTeamsAppClientSecret,
      } as any);
      return this.cloudAdapter;
    } catch (err) {
      logger.error(
        "Failed to initialize CloudAdapter for proactive Teams messaging:",
      );
      logger.error(err);
      throw new BadRequestException("Failed to initialize Teams bot adapter.");
    }
  }
  // Microsoft Teams API Permission Requirements:
  //
  // DELEGATED PERMISSIONS (for user context operations):
  // - openid: Required for user sign-in and ID token
  // - profile: Basic user profile information
  // - email: User email address access
  // - offline_access: Refresh token capability
  // - User.Read: Basic user profile read access
  // - Team.ReadBasic.All: Read team names and descriptions
  // - Channel.ReadBasic.All: Read channel names and descriptions
  // - TeamMember.ReadWrite.All: Manage team membership
  // - Teamwork.Read.All: Read organizational teamwork settings
  //
  // APPLICATION PERMISSIONS (for bot/app context operations):
  // - Channel.Create: Create new channels
  // - Channel.Delete.All: Delete channels
  // - Channel.ReadBasic.All: Read all channel information
  // - ChannelMember.Read.All: Read channel membership
  // - ChannelMember.ReadWrite.All: Manage channel membership
  // - ChannelMessage.Read.All: Read all channel messages
  // - ChatMessage.Read.All: Read all chat messages
  // - Team.ReadBasic.All: Read all team information
  // - TeamMember.Read.All: Read team membership
  // - TeamMember.ReadWrite.All: Manage team membership
  // - Teamwork.Migrate.All: Create messages with any identity/timestamp (for Import API, not currently used)
  // - Teamwork.Read.All: Read organizational teamwork settings
  //
  // IMPORTANT: This integration uses APPLICATION TOKENS (not delegated tokens)
  // for sending messages via the Microsoft Teams Graph API. This provides better
  // reliability and allows messages to be sent with the bot's identity.
  // The regular /messages endpoint is used for sending messages.  // Retrieve or mint an application (client credentials) token and persist it per project in miscData.
  private static async getOrCreateApplicationAccessToken(params: {
    projectAuth: WorkspaceProjectAuthToken | null;
  }): Promise<string | null> {
    try {
      if (!MicrosoftTeamsAppClientId || !MicrosoftTeamsAppClientSecret) {
        logger.debug(
          "Microsoft Teams App credentials not set. Cannot obtain application access token.",
        );
        return null;
      }

      const projectAuth: WorkspaceProjectAuthToken | undefined | null =
        params.projectAuth;
      let miscData: MicrosoftTeamsMiscData | undefined =
        projectAuth?.miscData as MicrosoftTeamsMiscData;

      // Check if admin consent has been granted
      if (!miscData?.adminConsentGranted) {
        logger.debug(
          "Admin consent not granted for Microsoft Teams application permissions. Cannot obtain application access token.",
        );
        return null;
      }

      // If we have a stored, not-expired app token, reuse it (2 min buffer)
      if (miscData?.appAccessToken && miscData.appAccessTokenExpiresAt) {
        const exp: number = Date.parse(miscData.appAccessTokenExpiresAt);
        if (!isNaN(exp) && Date.now() < exp - 2 * 60 * 1000) {
          return miscData.appAccessToken;
        }
      }

      // Need to mint a new token. Prefer discovered tenant id (from delegated auth) if present and not 'common'.
      const tenant: string =
        miscData?.tenantId && miscData.tenantId !== "common"
          ? miscData.tenantId
          : "organizations";
      if (miscData?.tenantId && miscData.tenantId === "common") {
        logger.debug(
          "Stored tenantId is common; using fallback authority: " + tenant,
        );
      }
      logger.debug(
        `Requesting Microsoft Teams application access token using authority tenant: ${tenant}`,
      );
      logger.debug("Application token request details:");
      logger.debug({
        url: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
        client_id: MicrosoftTeamsAppClientId,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
        client_secret_provided: Boolean(MicrosoftTeamsAppClientSecret),
      });

      const tokenResp: HTTPResponse<JSONObject> = await API.post(
        URL.fromString(
          `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
        ),
        {
          client_id: MicrosoftTeamsAppClientId,
          client_secret: MicrosoftTeamsAppClientSecret,
          grant_type: "client_credentials",
          scope: "https://graph.microsoft.com/.default",
        },
        {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      );

      if (tokenResp instanceof HTTPErrorResponse) {
        logger.error(
          "Could not obtain Microsoft Teams application access token (client credentials).",
        );
        logger.error(tokenResp);

        // Handle specific client secret error
        if (
          tokenResp.jsonData &&
          typeof tokenResp.jsonData === "object" &&
          "error" in tokenResp.jsonData
        ) {
          const errorData: JSONObject = tokenResp.jsonData as JSONObject;
          const errorType: string = errorData["error"] as string;
          const errorDescription: string = errorData[
            "error_description"
          ] as string;

          if (
            errorType === "invalid_client" &&
            errorDescription?.includes("Invalid client secret provided")
          ) {
            logger.error(
              "ERROR: Invalid Microsoft Teams client secret detected!",
            );
            logger.error(
              "Please ensure you are using the SECRET VALUE (not Secret ID) from your Azure App Registration.",
            );
            logger.error(
              "Go to Azure Portal > App Registrations > Your App > Certificates & secrets > Client secrets",
            );
            logger.error(
              "Copy the full SECRET VALUE (usually much longer than Secret ID) and update MICROSOFT_TEAMS_APP_CLIENT_SECRET",
            );
          }
        }

        return null;
      }

      const json: JSONObject = tokenResp.jsonData as JSONObject;
      const accessToken: string | undefined = json["access_token"] as string;
      const expiresIn: number | undefined = json["expires_in"] as number; // seconds

      logger.debug("Application token response received:");
      logger.debug({
        hasAccessToken: Boolean(accessToken),
        expiresIn: expiresIn,
        tokenType: json["token_type"],
        scope: json["scope"],
      });

      if (!accessToken) {
        logger.error("Application token response missing access_token.");
        return null;
      }
      const now: number = Date.now();
      const expiry: string = new Date(
        now + (expiresIn || 3600) * 1000,
      ).toISOString();

      if (projectAuth) {
        // Persist token to DB
        miscData =
          (projectAuth.miscData as MicrosoftTeamsMiscData) ||
          ({} as MicrosoftTeamsMiscData);
        miscData.appAccessToken = accessToken;
        miscData.appAccessTokenExpiresAt = expiry;
        miscData.lastAppTokenIssuedAt = new Date(now).toISOString();
        try {
          await WorkspaceProjectAuthTokenService.updateOneById({
            id: projectAuth.id!,
            data: { miscData: miscData },
            props: { isRoot: true },
          });
          logger.debug(
            "Stored Microsoft Teams application access token in DB.",
          );
        } catch (updateErr) {
          logger.error(
            "Failed to persist app access token to DB (will continue using in-memory token for this request):",
          );
          logger.error(updateErr);
        }
      } else {
        logger.warn(
          "No project auth context found to persist app access token; consider re-authenticating project installation.",
        );
      }

      return accessToken;
    } catch (err) {
      logger.error(
        "Error fetching Microsoft Teams application access token (client credentials):",
      );
      logger.error(err);
      return null;
    }
  }

  // Helper method to get and refresh project auth token if needed
  private static async getRefreshedProjectAuthToken(
    authToken: string,
  ): Promise<WorkspaceProjectAuthToken | null> {
    try {
      logger.debug(
        `Looking up project auth token for Microsoft Teams with auth token length: ${authToken?.length}`,
      );

      let projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.getByAuthToken({
          authToken: authToken,
          workspaceType: WorkspaceType.MicrosoftTeams,
        });

      if (!projectAuth) {
        logger.debug("No project auth token found for the provided auth token");
        // Fallback: try to find any Microsoft Teams project auth token for this project
        // This can happen if the token has been updated but the lookup still uses the old token
        logger.debug(
          "Attempting fallback lookup for Microsoft Teams project auth tokens",
        );

        const allProjectAuths: Array<WorkspaceProjectAuthToken> =
          await WorkspaceProjectAuthTokenService.findBy({
            query: {
              workspaceType: WorkspaceType.MicrosoftTeams,
            },
            select: {
              _id: true,
              projectId: true,
              authToken: true,
              miscData: true,
              workspaceType: true,
              workspaceProjectId: true,
            },
            limit: 10,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

        if (allProjectAuths.length > 0) {
          logger.debug(
            `Found ${allProjectAuths.length} Microsoft Teams project auth tokens, using the first one`,
          );
          projectAuth = allProjectAuths[0]!;
        }

        if (!projectAuth) {
          logger.debug(
            "No Microsoft Teams project auth tokens found in fallback lookup",
          );
          return null;
        }
      }

      logger.debug("Found project auth token details:");
      logger.debug({
        id: projectAuth.id,
        projectId: projectAuth.projectId,
        workspaceType: projectAuth.workspaceType,
        hasMiscData: Boolean(projectAuth.miscData),
        hasRefreshToken: Boolean((projectAuth.miscData as any)?.refreshToken),
        tokenExpiresAt: (projectAuth.miscData as any)?.tokenExpiresAt,
      });

      // Try to refresh the token if it's expired or about to expire
      logger.debug("Attempting to refresh Microsoft Teams token if needed...");
      const refreshedProjectAuth: WorkspaceProjectAuthToken =
        await MicrosoftTeamsTokenRefresher.refreshProjectAuthTokenIfExpired({
          projectAuthToken: projectAuth,
        });

      if (refreshedProjectAuth.authToken !== projectAuth.authToken) {
        logger.debug("Token was refreshed successfully");
      } else {
        logger.debug(
          "Token was not refreshed (either still valid or refresh failed)",
        );
      }

      return refreshedProjectAuth;
    } catch (error) {
      logger.error("Error getting or refreshing project auth token:");
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
          facts.push({
            name: this.convertMarkdownToHtml(name),
            value: this.convertMarkdownToHtml(value),
          });
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
      // Convert markdown formatting to HTML for better Teams rendering
      const htmlBodyText: string = bodyTextParts
        .map((part: string) => {
          return this.convertMarkdownToHtml(part);
        })
        .join("<br><br>");
      payload["text"] = htmlBodyText;
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
      // Get and refresh the project auth token if needed
      const projectAuth: WorkspaceProjectAuthToken | null =
        await this.getRefreshedProjectAuthToken(authToken);

      if (projectAuth && projectAuth.miscData) {
        const miscData: MicrosoftTeamsMiscData =
          projectAuth.miscData as MicrosoftTeamsMiscData;
        if (miscData.teamId) {
          logger.debug(`Using stored team ID: ${miscData.teamId}`);
          return miscData.teamId;
        }
      }

      logger.error(
        "No stored team ID found in project auth token. Team ID must be configured during initial setup.",
      );
      throw new BadRequestException(
        "Team ID not found in configuration. Please re-configure the Microsoft Teams integration to store the team information.",
      );
    } catch (error) {
      logger.error("Error getting team ID:");
      logger.error(error);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        "Unable to determine team ID. Please ensure the Microsoft Teams integration is properly configured with team information.",
      );
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

    const url: URL = URL.fromString(
      `https://graph.microsoft.com/v1.0${endpoint}`,
    );

    // Log the complete request details for debugging
    logger.debug("Microsoft Graph API call details:");
    logger.debug({
      method: method,
      url: url.toString(),
      endpoint: endpoint,
      headers: {
        ...headers,
        Authorization: `Bearer ${authToken.substring(0, 20)}...`, // Only show first 20 chars of token for security
      },
      body: body,
    });

    let response: HTTPResponse<JSONObject> | HTTPErrorResponse;

    if (method === "GET") {
      response = await API.get(url, undefined, headers, {});
    } else if (method === "POST") {
      response = await API.post(url, body || {}, headers, {});
    } else {
      throw new BadRequestException(`Unsupported HTTP method: ${method}`);
    }

    // Log response details if it's an error
    if (response instanceof HTTPErrorResponse) {
      logger.error("Microsoft Graph API call failed:");
      logger.error({
        statusCode: response.statusCode,
        message: response.message,
        data: response.data,
        jsonData: response.jsonData,
      });

      throw response;
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
      // Get project auth token for app token access
      const projectAuth: WorkspaceProjectAuthToken | null =
        await this.getRefreshedProjectAuthToken(data.authToken);
      const projectAuthForApp: WorkspaceProjectAuthToken | null =
        projectAuth ||
        (await WorkspaceProjectAuthTokenService.getByAuthToken({
          authToken: data.authToken,
          workspaceType: WorkspaceType.MicrosoftTeams,
        }));

      // Use application (bot) token
      const appToken: string | null =
        await this.getOrCreateApplicationAccessToken({
          projectAuth: projectAuthForApp,
        });

      if (!appToken) {
        throw new BadRequestException(
          "Microsoft Teams application access token unavailable. Grant admin consent for required discovery permissions or proceed with bot-only messaging (channel sends require bot conversation reference).",
        );
      }

      const teamId: string = await this.getTeamId(data.authToken);
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await this.makeGraphApiCall(
          `/teams/${teamId}/channels`,
          appToken,
          "GET",
        );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        throw response;
      }

      const channels: Dictionary<WorkspaceChannel> = {};
      const channelsData: Array<JSONObject> = (response.jsonData as JSONObject)[
        "value"
      ] as Array<JSONObject>;

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
      // Get project auth token for app token access
      const projectAuth: WorkspaceProjectAuthToken | undefined | null =
        await this.getRefreshedProjectAuthToken(data.authToken);
      const projectAuthForApp: WorkspaceProjectAuthToken | null =
        projectAuth ||
        (await WorkspaceProjectAuthTokenService.getByAuthToken({
          authToken: data.authToken,
          workspaceType: WorkspaceType.MicrosoftTeams,
        }));

      // Use application (bot) token
      const appToken: string | null =
        await this.getOrCreateApplicationAccessToken({
          projectAuth: projectAuthForApp,
        });

      if (!appToken) {
        throw new BadRequestException(
          "Microsoft Teams application access token unavailable. Grant admin consent for required discovery permissions or proceed with limited functionality.",
        );
      }

      const teamId: string = await this.getTeamId(data.authToken);
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await this.makeGraphApiCall(
          `/teams/${teamId}/channels/${data.channelId}`,
          appToken,
          "GET",
        );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        throw response;
      }

      const channelData: JSONObject = response.jsonData as JSONObject;
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
    projectId: ObjectID;
  }): Promise<WorkspaceChannel> {
    logger.debug(
      "Getting Microsoft Teams channel from channel name with data:",
    );
    logger.debug(data);

    try {
      // Normalize channel name
      let normalized: string = data.channelName;
      if (normalized.startsWith("#")) {
        normalized = normalized.substring(1);
      }
      normalized = normalized.toLowerCase();

      // Try cache first
      try {
        const cached: WorkspaceChannel | null = await this.getChannelFromCache({
          projectId: data.projectId,
          channelName: normalized,
        });
        if (cached) {
          logger.debug("Teams channel found in cache:");
          logger.debug(cached);
          return cached;
        }
      } catch (cacheErr) {
        logger.error(
          "Error reading Teams channel cache (continuing to Graph list):",
        );
        logger.error(cacheErr);
      }

      const allChannels: Dictionary<WorkspaceChannel> =
        await this.getAllWorkspaceChannels({
          authToken: data.authToken,
        });
      const channel: WorkspaceChannel | undefined = allChannels[normalized];
      if (!channel) {
        throw new BadRequestException(`Channel '${normalized}' not found`);
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
    projectId: ObjectID;
  }): Promise<WorkspaceChannel> {
    logger.debug("Creating Microsoft Teams channel with data:");
    logger.debug(data);
    logger.debug("DEBUG: Starting Microsoft Teams channel creation process");

    try {
      // Get project auth token for app token access
      logger.debug("DEBUG: Getting project auth token for app token access");
      const projectAuth: WorkspaceProjectAuthToken | null =
        await this.getRefreshedProjectAuthToken(data.authToken);
      const projectAuthForApp: WorkspaceProjectAuthToken | null =
        projectAuth ||
        (await WorkspaceProjectAuthTokenService.getByAuthToken({
          authToken: data.authToken,
          workspaceType: WorkspaceType.MicrosoftTeams,
        }));

      logger.debug("DEBUG: Project auth token obtained:");
      logger.debug(
        projectAuthForApp
          ? {
              id: projectAuthForApp.id,
              workspaceType: projectAuthForApp.workspaceType,
            }
          : null,
      );

      // Use application (bot) token
      logger.debug("DEBUG: Getting or creating application access token");
      const appToken: string | null =
        await this.getOrCreateApplicationAccessToken({
          projectAuth: projectAuthForApp,
        });

      logger.debug("DEBUG: Application token obtained: " + Boolean(appToken));

      if (!appToken) {
        logger.error(
          "ERROR: Microsoft Teams application access token unavailable. Please grant admin consent for application permissions in your Microsoft Teams integration settings.",
        );
        throw new BadRequestException(
          "Microsoft Teams application access token unavailable (team/channel enumeration). Bot-based message delivery does not use Graph channel POSTs.",
        );
      }

      let channelName: string = data.channelName;
      if (channelName.startsWith("#")) {
        channelName = channelName.substring(1);
      }

      logger.debug("DEBUG: Getting team ID");
      const teamId: string = await this.getTeamId(data.authToken);
      logger.debug("DEBUG: Team ID obtained: " + teamId);

      const channelPayload: JSONObject = {
        displayName: channelName,
        description: `Channel created by OneUptime`,
        membershipType: "standard",
      };

      logger.debug("DEBUG: Channel payload:");
      logger.debug(channelPayload);
      logger.debug("DEBUG: Making Graph API call to create channel");

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await this.makeGraphApiCall(
          `/teams/${teamId}/channels`,
          appToken,
          "POST",
          channelPayload,
        );

      logger.debug("DEBUG: Graph API response received");

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        throw response;
      }

      const channelData: JSONObject = response.jsonData as JSONObject;
      const channel: WorkspaceChannel = {
        id: channelData["id"] as string,
        name: channelData["displayName"] as string,
        workspaceType: WorkspaceType.MicrosoftTeams,
      };

      logger.debug("Microsoft Teams channel created successfully:");
      logger.debug(channel);
      logger.debug(
        "DEBUG: Microsoft Teams channel creation completed successfully",
      );
      // Cache channel (best-effort) similar to Slack implementation
      try {
        await this.updateChannelCache({
          projectId: data.projectId,
          channelName: channel.name.toLowerCase(),
          channel: channel,
        });
      } catch (cacheErr) {
        logger.error("Error caching Microsoft Teams channel (non-fatal):");
        logger.error(cacheErr);
      }
      return channel;
    } catch (error) {
      logger.error("Error creating Microsoft Teams channel:");
      logger.error(error);
      logger.error("DEBUG: Microsoft Teams channel creation failed");
      throw error;
    }
  }

  @CaptureSpan()
  public static override async createChannelsIfDoesNotExist(data: {
    authToken: string;
    channelNames: Array<string>;
  }): Promise<Array<WorkspaceChannel>> {
    logger.debug(
      "Creating Microsoft Teams channels if they do not exist with data:",
    );
    logger.debug(data);

    // Get project auth token for app token access
    const projectAuth: WorkspaceProjectAuthToken | null =
      await this.getRefreshedProjectAuthToken(data.authToken);
    const projectAuthForApp: WorkspaceProjectAuthToken | null =
      projectAuth ||
      (await WorkspaceProjectAuthTokenService.getByAuthToken({
        authToken: data.authToken,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }));

    // Use application (bot) token
    const appToken: string | null =
      await this.getOrCreateApplicationAccessToken({
        projectAuth: projectAuthForApp,
      });

    if (!appToken) {
      throw new BadRequestException(
        "Microsoft Teams application access token unavailable for channel listing. Ensure admin consent or reconnect integration. Bot delivery path unaffected if conversation references already captured.",
      );
    }

    const workspaceChannels: Array<WorkspaceChannel> = [];
    const existingWorkspaceChannels: Dictionary<WorkspaceChannel> =
      await this.getAllWorkspaceChannels({
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
        const channel: WorkspaceChannel = await this.createChannel({
          authToken: data.authToken,
          channelName: channelName,
          projectId: projectAuthForApp?.projectId as ObjectID,
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

  // ---------------- Channel Cache (Parity with Slack) ----------------
  @CaptureSpan()
  public static async getChannelFromCache(data: {
    projectId: ObjectID;
    channelName: string;
  }): Promise<WorkspaceChannel | null> {
    try {
      const projectAuth: any =
        await WorkspaceProjectAuthTokenService.getProjectAuth({
          projectId: data.projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        });
      if (!projectAuth || !projectAuth.miscData) {
        return null;
      }
      const miscData: any = projectAuth.miscData;
      const channelCache: any = miscData.channelCache;
      if (!channelCache || !channelCache[data.channelName]) {
        return null;
      }
      const cachedChannelData: WorkspaceChannel = channelCache[
        data.channelName
      ] as WorkspaceChannel;
      return {
        id: cachedChannelData.id,
        name: cachedChannelData.name,
        workspaceType: WorkspaceType.MicrosoftTeams,
      };
    } catch (err) {
      logger.error("Error retrieving Teams channel from cache:");
      logger.error(err);
      return null;
    }
  }

  @CaptureSpan()
  public static async updateChannelCache(data: {
    projectId: ObjectID;
    channelName: string;
    channel: WorkspaceChannel;
  }): Promise<void> {
    try {
      const projectAuth: any =
        await WorkspaceProjectAuthTokenService.getProjectAuth({
          projectId: data.projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        });
      if (!projectAuth) {
        return; // nothing to update
      }
      const miscData: any = projectAuth.miscData || {};
      const channelCache: any = miscData.channelCache || {};
      channelCache[data.channelName] = {
        id: data.channel.id,
        name: data.channel.name,
        lastUpdated: new Date().toISOString(),
      };
      miscData.channelCache = channelCache;
      await WorkspaceProjectAuthTokenService.refreshAuthToken({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
        authToken: projectAuth.authToken,
        workspaceProjectId: projectAuth.workspaceProjectId,
        miscData: miscData,
      });
    } catch (err) {
      logger.error("Error updating Teams channel cache (non-fatal):");
      logger.error(err);
    }
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
      // Get project auth token for app token access
      const projectAuth: WorkspaceProjectAuthToken | null =
        await this.getRefreshedProjectAuthToken(data.authToken);
      const projectAuthForApp: WorkspaceProjectAuthToken | null =
        projectAuth ||
        (await WorkspaceProjectAuthTokenService.getByAuthToken({
          authToken: data.authToken,
          workspaceType: WorkspaceType.MicrosoftTeams,
        }));

      // Use application (bot) token
      const appToken: string | null =
        await this.getOrCreateApplicationAccessToken({
          projectAuth: projectAuthForApp,
        });

      if (!appToken) {
        throw new BadRequestException(
          "Microsoft Teams application access token unavailable for membership management. Grant admin consent if membership automation is required.",
        );
      }

      const teamId: string = await this.getTeamId(data.authToken);
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await this.makeGraphApiCall(
          `/teams/${teamId}/channels/${data.channelId}/members`,
          appToken,
          "GET",
        );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Microsoft Graph API:");
        logger.error(response);
        return false;
      }

      const members: Array<JSONObject> = (response.jsonData as JSONObject)[
        "value"
      ] as Array<JSONObject>;
      const isUserInChannel: boolean = members.some((member: JSONObject) => {
        const userId: string =
          (member["userId"] as string) ||
          ((member["user"] as JSONObject)?.["id"] as string);
        return userId === data.userId;
      });

      logger.debug(
        `User ${data.userId} is ${isUserInChannel ? "in" : "not in"} channel ${data.channelId}`,
      );
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
      const isUserInChannel: boolean = await this.isUserInChannel({
        authToken: data.authToken,
        channelId: data.channelId,
        userId: data.workspaceUserId,
      });

      if (isUserInChannel) {
        logger.debug("User already in channel.");
        return;
      }

      // Get project auth token for app token access
      const projectAuth: WorkspaceProjectAuthToken | null =
        await this.getRefreshedProjectAuthToken(data.authToken);
      const projectAuthForApp: WorkspaceProjectAuthToken | null =
        projectAuth ||
        (await WorkspaceProjectAuthTokenService.getByAuthToken({
          authToken: data.authToken,
          workspaceType: WorkspaceType.MicrosoftTeams,
        }));

      // Use application (bot) token
      const appToken: string | null =
        await this.getOrCreateApplicationAccessToken({
          projectAuth: projectAuthForApp,
        });

      if (!appToken) {
        throw new BadRequestException(
          "Microsoft Teams application access token unavailable for channel membership invite. Bot messaging itself does not require ChannelMessage.Send.",
        );
      }

      const teamId: string = await this.getTeamId(data.authToken);

      // First, try adding the user to the channel directly
      const memberPayload: JSONObject = {
        "@odata.type": "#microsoft.graph.aadUserConversationMember",
        "user@odata.bind": `https://graph.microsoft.com/v1.0/users/${data.workspaceUserId}`,
        roles: ["member"],
      };

      logger.debug("Attempting to add user directly to channel...");
      const channelResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await this.makeGraphApiCall(
          `/teams/${teamId}/channels/${data.channelId}/members`,
          appToken,
          "POST",
          memberPayload,
        );

      if (channelResponse instanceof HTTPErrorResponse) {
        // Check if this is the "Operation not supported for this Channel" error
        const errorData: JSONObject = channelResponse.jsonData as JSONObject;
        const errorMessage: string = (errorData?.["error"] as JSONObject)?.[
          "message"
        ] as string;
        if (
          channelResponse.statusCode === 400 &&
          errorMessage &&
          errorMessage.includes("Operation not supported for this Channel")
        ) {
          logger.debug(
            "Channel doesn't support direct member addition. Attempting to add user to team instead...",
          );

          // Try adding the user to the team instead
          const teamMemberPayload: JSONObject = {
            "@odata.type": "#microsoft.graph.aadUserConversationMember",
            "user@odata.bind": `https://graph.microsoft.com/v1.0/users/${data.workspaceUserId}`,
            roles: ["member"],
          };

          const teamResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await this.makeGraphApiCall(
              `/teams/${teamId}/members`,
              appToken,
              "POST",
              teamMemberPayload,
            );

          if (teamResponse instanceof HTTPErrorResponse) {
            // Check if user is already a team member
            if (teamResponse.statusCode === 409) {
              logger.debug(
                "User is already a team member, which means they should have access to public channels.",
              );
              return;
            }

            logger.error("Error adding user to team:");
            logger.error(teamResponse);
            throw new BadRequestException(
              `Cannot add user to this channel. The channel doesn't support direct member addition and the user could not be added to the team. Error: ${errorMessage}`,
            );
          }

          logger.debug(
            "User successfully added to team. They should now have access to public channels including this one.",
          );
          return;
        }

        // For other errors, log and throw
        logger.error("Error response from Microsoft Graph API:");
        logger.error(channelResponse);
        throw channelResponse;
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
      // fetch project auth to determine projectId for cache / lookup parity
      const projectAuth: WorkspaceProjectAuthToken | null =
        await this.getRefreshedProjectAuthToken(data.authToken);
      const projectAuthForApp: WorkspaceProjectAuthToken | null =
        projectAuth ||
        (await WorkspaceProjectAuthTokenService.getByAuthToken({
          authToken: data.authToken,
          workspaceType: WorkspaceType.MicrosoftTeams,
        }));
      const channel: WorkspaceChannel =
        await this.getWorkspaceChannelFromChannelName({
          authToken: data.authToken,
          channelName: data.channelName,
          projectId: projectAuthForApp?.projectId
            ? ObjectID.fromString(projectAuthForApp.projectId.toString())
            : ObjectID.fromString(
                (projectAuthForApp?.workspaceProjectId || "").toString(),
              ),
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
      if (!(MicrosoftTeamsAppClientId && MicrosoftTeamsAppClientSecret)) {
        throw new BadRequestException(
          "Teams bot credentials not configured (MICROSOFT_TEAMS_APP_CLIENT_ID / MICROSOFT_TEAMS_APP_CLIENT_SECRET).",
        );
      }
      const adapter: CloudAdapter = this.getOrCreateCloudAdapter();
      const projectAuth: WorkspaceProjectAuthToken | null =
        await this.getRefreshedProjectAuthToken(data.authToken);
      let convRef: ConversationReference | undefined;
      if (projectAuth?.miscData) {
        const misc: MicrosoftTeamsMiscData =
          projectAuth.miscData as MicrosoftTeamsMiscData;
        convRef = misc.botConversationReferences?.[data.workspaceChannel.id];
      }
      if (!convRef) {
        logger.warn(
          `Attempt to send to Teams channel id=${data.workspaceChannel.id} name=${data.workspaceChannel.name} without conversation reference. Instruct user to add the OneUptime bot to that channel.`,
        );
        throw new BadRequestException(
          "Channel not initialized for bot notifications. Add the OneUptime bot to this channel to capture a conversation reference.",
        );
      }
      const html: string = this.convertBlocksToTeamsMessage(data.blocks);
      const adaptiveCard: JSONObject | null = this.convertBlocksToAdaptiveCard(
        data.blocks,
      );
      await adapter.continueConversationAsync(
        MicrosoftTeamsAppClientId,
        convRef,
        async (turnContext: TurnContext) => {
          if (adaptiveCard) {
            await turnContext.sendActivity({
              type: "message",
              attachments: [
                {
                  contentType: "application/vnd.microsoft.card.adaptive",
                  content: adaptiveCard,
                },
              ],
            });
          } else {
            await turnContext.sendActivity({
              type: "message",
              channelData: { html },
            });
          }
        },
      );
      return {
        channel: data.workspaceChannel,
        threadId: data.workspaceChannel.id,
      };
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
    // Refresh project auth ONLY to inspect conversation references (no Graph send path anymore)
    const projectAuth: WorkspaceProjectAuthToken | null =
      await this.getRefreshedProjectAuthToken(data.authToken);

    const blocks: Array<JSONObject> = this.getBlocksFromWorkspaceMessagePayload(
      {
        messageBlocks: data.workspaceMessagePayload.messageBlocks,
      },
    );

    logger.debug("Blocks generated from workspace message payload:");
    logger.debug(blocks);

    const existingWorkspaceChannels: Dictionary<WorkspaceChannel> =
      await this.getAllWorkspaceChannels({
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

      const channel: WorkspaceChannel | undefined =
        existingWorkspaceChannels[channelName];
      if (channel) {
        workspaceChannelsToPostTo.push(channel);
      } else {
        logger.debug(`Channel ${channelName} does not exist.`);
      }
    }

    // Process channel IDs
    for (const channelId of data.workspaceMessagePayload.channelIds) {
      try {
        const channel: WorkspaceChannel =
          await this.getWorkspaceChannelFromChannelId({
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

    // Pre-flight conversation reference visibility
    if (projectAuth?.miscData) {
      const misc: MicrosoftTeamsMiscData =
        projectAuth.miscData as MicrosoftTeamsMiscData;
      const refs: { [channelId: string]: any } =
        misc.botConversationReferences || {};
      for (const channel of workspaceChannelsToPostTo) {
        if (refs[channel.id]) {
          logger.debug(
            `Conversation reference present for Teams channel id=${channel.id} name=${channel.name}`,
          );
        } else {
          logger.warn(
            `No conversation reference for Teams channel id=${channel.id} name=${channel.name}. Bot must be added to the channel before sending will succeed.`,
          );
        }
      }
    } else {
      logger.warn(
        "No miscData or botConversationReferences found on project auth token; all channel sends may fail if bot not previously added.",
      );
    }

    const workspaceMessageResponse: WorkspaceSendMessageResponse = {
      threads: [],
      workspaceType: WorkspaceType.MicrosoftTeams,
    };

    // Send messages to all channels
    for (const channel of workspaceChannelsToPostTo) {
      try {
        const thread: WorkspaceThread = await this.sendPayloadBlocksToChannel({
          authToken: data.authToken,
          workspaceChannel: channel,
          blocks: blocks,
        });

        workspaceMessageResponse.threads.push(thread);
        logger.debug(
          `Message sent to channel ID ${channel.id} successfully (posted as bot).`,
        );
      } catch (e) {
        logger.error(`Error sending message to channel ID ${channel.id}:`);
        logger.error(e);
      }
    }

    logger.debug("Message sending process completed.");
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
      if (!(MicrosoftTeamsAppClientId && MicrosoftTeamsAppClientSecret)) {
        throw new BadRequestException(
          "Teams bot credentials not configured (MICROSOFT_TEAMS_APP_CLIENT_ID / MICROSOFT_TEAMS_APP_CLIENT_SECRET). Cannot send direct message.",
        );
      }

      const projectAuth: WorkspaceProjectAuthToken | null =
        await this.getRefreshedProjectAuthToken(data.authToken);
      if (!projectAuth?.miscData) {
        logger.warn(
          "No project miscData found while attempting Teams direct message.",
        );
      }
      let convRef: ConversationReference | undefined;
      if (projectAuth?.miscData) {
        const misc: MicrosoftTeamsMiscData =
          projectAuth.miscData as MicrosoftTeamsMiscData;
        convRef = misc.botUserConversationReferences?.[data.workspaceUserId];
      }
      if (!convRef) {
        logger.warn(
          `Missing personal conversation reference for userId=${data.workspaceUserId}. User must have previously interacted with the OneUptime bot.`,
        );
        throw new BadRequestException(
          "Direct message unavailable. The user has not initiated a personal chat with the OneUptime bot yet.",
        );
      }

      const adapter: CloudAdapter = this.getOrCreateCloudAdapter();

      const blocks: Array<JSONObject> =
        this.getBlocksFromWorkspaceMessagePayload({
          messageBlocks: data.messageBlocks,
        });
      const html: string = this.convertBlocksToTeamsMessage(blocks);
      const adaptiveCard: JSONObject | null =
        this.convertBlocksToAdaptiveCard(blocks);

      await adapter.continueConversationAsync(
        MicrosoftTeamsAppClientId,
        convRef,
        async (turnContext: TurnContext) => {
          if (adaptiveCard) {
            await turnContext.sendActivity({
              type: "message",
              attachments: [
                {
                  contentType: "application/vnd.microsoft.card.adaptive",
                  content: adaptiveCard,
                },
              ],
            });
          } else {
            await turnContext.sendActivity({
              type: "message",
              channelData: { html },
            });
          }
        },
      );

      logger.debug(
        "Direct message sent successfully to Microsoft Teams user via bot conversation reference.",
      );
    } catch (error) {
      logger.error("Error sending direct message to Microsoft Teams user:");
      logger.error(error);
      throw error;
    }
  }

  // Basic Adaptive Card builder from generic workspace blocks (subset)
  private static convertBlocksToAdaptiveCard(
    blocks: Array<JSONObject>,
  ): JSONObject | null {
    try {
      const body: Array<JSONObject> = [];
      const actions: Array<JSONObject> = [];
      for (const block of blocks) {
        const type: string = block["type"] as string;
        switch (type) {
          case "header":
            body.push({
              type: "TextBlock",
              text: (block["text"] as string) || "",
              weight: "Bolder",
              size: "Medium",
              wrap: true,
            });
            break;
          case "section":
            if (block["text"]) {
              body.push({
                type: "TextBlock",
                text: block["text"] as string,
                wrap: true,
              });
            }
            break;
          case "divider":
            body.push({ type: "TextBlock", text: "---", spacing: "Small" });
            break;
          case "actions": {
            const elems: Array<JSONObject> =
              (block["elements"] as Array<JSONObject>) || [];
            for (const el of elems) {
              if (el["url"]) {
                actions.push({
                  type: "Action.OpenUrl",
                  title: (
                    (el["text"] as string) ||
                    (el["name"] as string) ||
                    "Open"
                  ).substring(0, 40),
                  url: el["url"],
                });
              } else if (el["action_id"] || el["value"]) {
                // Potential future submit action (no back-end handler wired yet)
                actions.push({
                  type: "Action.Submit",
                  title: ((el["text"] as string) || "Submit").substring(0, 40),
                  data: {
                    actionId: el["action_id"] || el["value"],
                  },
                });
              }
            }
            break;
          }
          case "image": {
            const imageUrl: string | undefined =
              (block["image_url"] as string) ||
              (block["url"] as string) ||
              (block["src"] as string);
            if (imageUrl) {
              body.push({
                type: "Image",
                url: imageUrl,
                altText:
                  (block["alt_text"] as string) ||
                  (block["text"] as string) ||
                  "Image",
              });
            }
            break;
          }
          default:
            if (block["text"]) {
              body.push({
                type: "TextBlock",
                text: block["text"] as string,
                wrap: true,
              });
            }
            break;
        }
      }
      if (!body.length) {
        return null;
      }
      return {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.4",
        body: body,
        actions: actions.length ? actions : undefined,
      } as JSONObject;
    } catch (err) {
      logger.error("Error building adaptive card, falling back to HTML only:");
      logger.error(err);
      return null;
    }
  }

  // Conversation reference status for UI indicators
  public static async getConversationReferenceStatus(data: {
    authToken: string;
  }): Promise<{ channels: Dictionary<boolean>; users: Dictionary<boolean> }> {
    const status: {
      channels: Dictionary<boolean>;
      users: Dictionary<boolean>;
    } = {
      channels: {} as Dictionary<boolean>,
      users: {} as Dictionary<boolean>,
    };
    try {
      const projectAuth: WorkspaceProjectAuthToken | null =
        await this.getRefreshedProjectAuthToken(data.authToken);
      if (!projectAuth?.miscData) {
        return status;
      }
      const misc: MicrosoftTeamsMiscData =
        projectAuth.miscData as MicrosoftTeamsMiscData;
      status.channels = (misc.botConversationReferences ||
        {}) as Dictionary<boolean>;
      status.users = (misc.botUserConversationReferences ||
        {}) as Dictionary<boolean>;
    } catch (err) {
      logger.error("Error fetching conversation reference status:");
      logger.error(err);
    }
    return status;
  }

  // Helper method to convert basic markdown to HTML
  private static convertMarkdownToHtml(text: string): string {
    if (!text) {
      return "";
    }

    let html: string = text;

    // Convert bold first (**text** or __text__) - non-greedy match
    html = html.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__([^_]+?)__/g, "<strong>$1</strong>");

    // Convert italic (*text* or _text_) - simple non-greedy match
    html = html.replace(/\*([^*]+?)\*/g, "<em>$1</em>");
    html = html.replace(/_([^_]+?)_/g, "<em>$1</em>");

    // Convert inline code (`text`)
    html = html.replace(/`([^`]+?)`/g, "<code>$1</code>");

    // Convert line breaks
    html = html.replace(/\n/g, "<br>");

    // Convert links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    return html;
  }

  // Helper method to convert blocks to Teams message format
  private static convertBlocksToTeamsMessage(
    blocks: Array<JSONObject>,
  ): string {
    let html: string = "";

    for (const block of blocks) {
      const type: string = block["type"] as string;

      switch (type) {
        case "header":
          html += `<h3>${this.convertMarkdownToHtml(block["text"] as string)}</h3>`;
          break;
        case "section":
          if (block["text"]) {
            html += `<p>${this.convertMarkdownToHtml(block["text"] as string)}</p>`;
          }
          break;
        case "divider":
          html += "<hr>";
          break;
        case "actions": {
          // Handle action buttons - convert to simple links for now
          const actions: Array<JSONObject> = block[
            "elements"
          ] as Array<JSONObject>;
          if (actions) {
            for (const action of actions) {
              if (action["url"]) {
                const buttonText: string = this.convertMarkdownToHtml(
                  (action["text"] as string) || "Click here",
                );
                html += `<a href="${action["url"]}">${buttonText}</a><br>`;
              }
            }
          }
          break;
        }
        default:
          // For other block types, try to extract text content
          if (block["text"]) {
            html += `<p>${this.convertMarkdownToHtml(block["text"] as string)}</p>`;
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
    const elements: Array<JSONObject> = data.payloadButtonsBlock.buttons.map(
      (button: WorkspaceMessagePayloadButton): JSONObject => {
        return {
          type: "button",
          text: button.title,
          url: button.url?.toString(),
          actionId: button.actionId,
        };
      },
    );

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
    const options: Array<JSONObject> = data.payloadDropdownBlock.options.map(
      (option: any): JSONObject => {
        return {
          text: {
            type: "plain_text",
            text: option.label,
          },
          value: option.value,
        };
      },
    );

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
      const dateValue: Date = new Date(
        data.payloadDateTimePickerBlock.initialValue,
      );
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
    const blocks: Array<JSONObject> = data.payloadModalBlock.blocks.map(
      (block: WorkspaceMessageBlock): JSONObject => {
        return this.getBlocksFromWorkspaceMessagePayload({
          messageBlocks: [block],
        })[0] as JSONObject;
      },
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
    throw new BadRequestException(
      "Modal display not implemented for Microsoft Teams",
    );
  }

  // Additional methods to match WorkspaceBase interface
  @CaptureSpan()
  public static override async doesChannelExist(data: {
    authToken: string;
    channelName: string;
  }): Promise<boolean> {
    try {
      const channels: Dictionary<WorkspaceChannel> =
        await this.getAllWorkspaceChannels({
          authToken: data.authToken,
        });

      let channelName: string = data.channelName;
      if (channelName.startsWith("#")) {
        channelName = channelName.substring(1);
      }

      return Boolean(channels[channelName]);
    } catch (error) {
      logger.error("Error checking if channel exists:");
      logger.error(error);

      // Re-throw configuration errors (like Teams provisioning issues) instead of returning false
      if (error instanceof BadRequestException) {
        throw error;
      }

      // For other errors (like network issues), return false
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

        logger.warn(
          `Channel archiving not directly supported in Microsoft Teams API for channel ${channelId}`,
        );
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
      // Get project auth token for app token access
      const projectAuth: WorkspaceProjectAuthToken | null =
        await this.getRefreshedProjectAuthToken(data.authToken);
      const projectAuthForApp: WorkspaceProjectAuthToken | null =
        projectAuth ||
        (await WorkspaceProjectAuthTokenService.getByAuthToken({
          authToken: data.authToken,
          workspaceType: WorkspaceType.MicrosoftTeams,
        }));

      // Use application (bot) token
      const appToken: string | null =
        await this.getOrCreateApplicationAccessToken({
          projectAuth: projectAuthForApp,
        });

      if (!appToken) {
        logger.error(
          "Unable to obtain Microsoft Teams application access token for user lookup",
        );
        return null;
      }

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await this.makeGraphApiCall(`/users/${data.userId}`, appToken, "GET");

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error getting user info from Microsoft Graph:");
        logger.error(response);
        return null;
      }

      const userData: JSONObject = response.jsonData as JSONObject;
      return (
        (userData["displayName"] as string) ||
        (userData["userPrincipalName"] as string) ||
        null
      );
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
      // Get project auth token for app token access
      const projectAuth: WorkspaceProjectAuthToken | null =
        await this.getRefreshedProjectAuthToken(data.authToken);
      const projectAuthForApp: WorkspaceProjectAuthToken | null =
        projectAuth ||
        (await WorkspaceProjectAuthTokenService.getByAuthToken({
          authToken: data.authToken,
          workspaceType: WorkspaceType.MicrosoftTeams,
        }));

      // Use application (bot) token
      const appToken: string | null =
        await this.getOrCreateApplicationAccessToken({
          projectAuth: projectAuthForApp,
        });

      if (!appToken) {
        logger.error(
          "Unable to obtain Microsoft Teams application access token for chat member lookup",
        );
        return false;
      }

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await this.makeGraphApiCall(
          `/chats/${data.directMessageChannelId}/members`,
          appToken,
          "GET",
        );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error getting chat members:");
        logger.error(response);
        return false;
      }

      const membersData: JSONObject = response.jsonData as JSONObject;
      const members: Array<JSONObject> = membersData[
        "value"
      ] as Array<JSONObject>;

      return members.some((member: JSONObject): boolean => {
        return (
          (member["userId"] as string) === data.userId ||
          (member["user"] as JSONObject)?.["id"] === data.userId
        );
      });
    } catch (error) {
      logger.error("Error checking if user is in direct message channel:");
      logger.error(error);
      return false;
    }
  }
}
