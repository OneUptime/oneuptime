import { WorkspaceChannelMessage } from "../Workspace";
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
import SSRFProtection from "../../SSRFProtection";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsChat,
  MicrosoftTeamsChatType,
  MicrosoftTeamsInstalledTeam,
  MicrosoftTeamsMiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import OneUptimeDate from "../../../../Types/Date";
import {
  MicrosoftTeamsAppClientId,
  MicrosoftTeamsAppClientSecret,
  MicrosoftTeamsAppTenantId,
} from "../../../EnvironmentConfig";

// Import services for bot commands
import IncidentService from "../../../Services/IncidentService";
import AlertService from "../../../Services/AlertService";
import ScheduledMaintenanceService from "../../../Services/ScheduledMaintenanceService";
import IncidentStateService from "../../../Services/IncidentStateService";
import AlertStateService from "../../../Services/AlertStateService";

// Import user services
import User from "../../../../Models/DatabaseModels/User";
import UserService from "../../../Services/UserService";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceUserAuthTokenService from "../../../Services/WorkspaceUserAuthTokenService";

// Import database utilities
import QueryHelper from "../../../Types/Database/QueryHelper";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";

// Bot Framework SDK imports
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TeamsActivityHandler,
  TeamsInfo,
  TeamsChannelAccount,
  TeamsPagedMembersResult,
  TurnContext,
  ConversationReference,
  MessageFactory,
  ConfigurationBotFrameworkAuthenticationOptions,
  Activity,
  ResourceResponse,
} from "botbuilder";
import { ExpressRequest, ExpressResponse } from "../../Express";
// Teams action handlers and types
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsRequest,
} from "./Actions/Auth";
import MicrosoftTeamsIncidentActions from "./Actions/Incident";
import {
  MicrosoftTeamsActionType,
  MicrosoftTeamsScheduledMaintenanceActionType,
  MicrosoftTeamsOnCallDutyActionType,
} from "./Actions/ActionTypes";
import MicrosoftTeamsAlertActions from "./Actions/Alert";
import MicrosoftTeamsAlertEpisodeActions from "./Actions/AlertEpisode";
import MicrosoftTeamsIncidentEpisodeActions from "./Actions/IncidentEpisode";
import MicrosoftTeamsMonitorActions from "./Actions/Monitor";
import MicrosoftTeamsScheduledMaintenanceActions from "./Actions/ScheduledMaintenance";
import MicrosoftTeamsOnCallDutyActions from "./Actions/OnCallDutyPolicy";

/*
 * AI Ops - observability assistant imports. These power the natural-language
 * "ask" experience where a Teams user can question the OneUptime AI about
 * their logs, traces, metrics, incidents and monitors.
 */
import type { ObservabilityAssistantResult } from "../../AI/Chat/ObservabilityAssistant";
import AccessTokenService from "../../../Services/AccessTokenService";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { AIChatCitation } from "../../../../Types/AI/AIChatTypes";

// Microsoft Teams apps should always be single-tenant
const MICROSOFT_TEAMS_APP_TYPE: string = "SingleTenant";

/*
 * Outcome of mapping a Microsoft tenant id to a OneUptime project.
 *
 * projectAuth is null both when nothing matched and when the tenant is
 * connected to several projects — isAmbiguous distinguishes the two so callers
 * can give the right remedy.
 */
export interface MicrosoftTeamsTenantResolution {
  projectAuth: WorkspaceProjectAuthToken | null;
  isAmbiguous: boolean;
  candidateProjectIds: Array<ObjectID>;
}

/*
 * Microsoft's wording when the Bot Framework refuses a proactive post because
 * the app is not a member of the target conversation. Matched case-insensitively
 * so we can replace it with something the admin can act on.
 */
const MICROSOFT_TEAMS_ROSTER_ERROR_FRAGMENTS: Array<string> = [
  "not part of the conversation roster",
  "bot is not part of the conversation",
];

// Maximum number of pages to fetch when paginating teams
const MICROSOFT_TEAMS_MAX_PAGES: number = 500;

/*
 * Hosts that may receive a Teams incoming webhook. Legacy Connector webhooks
 * use Office domains. Teams Workflows use regional logic.azure.com hosts, and
 * current Power Automate trigger URLs use environment.api.powerplatform.com.
 * Keep the Power Platform suffix narrow because this allowlist is also an SSRF
 * boundary for user-supplied workflow and subscriber URLs.
 */
export const MICROSOFT_TEAMS_WEBHOOK_DOMAINS: Array<string> = [
  "office.com",
  "office365.com",
  "logic.azure.com",
  "environment.api.powerplatform.com",
];

export default class MicrosoftTeamsUtil extends WorkspaceBase {
  private static cachedAdapter: CloudAdapter | null = null;
  private static readonly WELCOME_CARD_STATE_KEY: string =
    "oneuptime.microsoftTeams.welcomeCardSent";
  // Get or create Bot Framework adapter for a specific tenant
  private static getBotAdapter(): CloudAdapter {
    if (this.cachedAdapter) {
      return this.cachedAdapter;
    }

    if (!MicrosoftTeamsAppClientId || !MicrosoftTeamsAppClientSecret) {
      throw new BadDataException(
        "Microsoft Teams App credentials not configured",
      );
    }

    if (!MicrosoftTeamsAppTenantId) {
      throw new BadDataException(
        "Microsoft Teams app tenant ID is not configured",
      );
    }

    logger.debug(
      "Creating Bot Framework adapter with authentication configuration",
    );
    logger.debug(`App ID: ${MicrosoftTeamsAppClientId}`);
    logger.debug(`App Type: ${MICROSOFT_TEAMS_APP_TYPE}`);
    logger.debug(`Tenant ID: ${MicrosoftTeamsAppTenantId}`);

    const authConfig: ConfigurationBotFrameworkAuthenticationOptions = {
      MicrosoftAppId: MicrosoftTeamsAppClientId,
      MicrosoftAppPassword: MicrosoftTeamsAppClientSecret,
      MicrosoftAppType: MICROSOFT_TEAMS_APP_TYPE,
      MicrosoftAppTenantId: MicrosoftTeamsAppTenantId,
    };

    const botFrameworkAuthentication: ConfigurationBotFrameworkAuthentication =
      new ConfigurationBotFrameworkAuthentication(authConfig);
    const adapter: CloudAdapter = new CloudAdapter(botFrameworkAuthentication);
    this.cachedAdapter = adapter;

    logger.debug("Bot Framework adapter created successfully");
    return adapter;
  }
  // Helper method to get a valid access token, refreshing if necessary
  public static async getValidAccessToken(data: {
    authToken: string;
    projectId: ObjectID;
  }): Promise<string> {
    logger.debug("=== getValidAccessToken called ===", {
      projectId: data.projectId?.toString(),
    });

    if (!data.projectId) {
      throw new BadDataException(
        "projectId is required to get Microsoft Teams access token",
      );
    }
    logger.debug(`Project ID: ${data.projectId.toString()}`);
    logger.debug(
      `Auth token (first 20 chars): ${data.authToken?.substring(0, 20)}...`,
    );

    // Get project auth and check token expiration
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    logger.debug(`Project auth found: ${Boolean(projectAuth)}`);
    if (projectAuth) {
      logger.debug(
        `Project auth has miscData: ${Boolean(projectAuth.miscData)}`,
      );
    }

    if (!projectAuth || !projectAuth.miscData) {
      logger.error(
        "Microsoft Teams integration not found for this project - no project auth or miscData",
        {
          projectId: data.projectId.toString(),
        },
      );
      throw new BadDataException(
        "Microsoft Teams integration not found for this project",
      );
    }

    const miscData: MicrosoftTeamsMiscData =
      projectAuth.miscData as MicrosoftTeamsMiscData;
    const tenantId: string | undefined = projectAuth.workspaceProjectId;

    logger.debug(`Resolved tenant ID: ${tenantId}`);

    if (!tenantId) {
      logger.error(
        "Microsoft Teams tenant ID missing from project auth configuration",
        {
          projectId: data.projectId.toString(),
        },
      );
      throw new BadDataException(
        "Microsoft Teams tenant ID not found for this project",
      );
    }

    logger.debug(
      `MiscData appAccessToken exists: ${Boolean(miscData.appAccessToken)}`,
    );
    logger.debug(
      `MiscData appAccessTokenExpiresAt: ${miscData.appAccessTokenExpiresAt}`,
    );

    // Check if token exists and is valid
    if (miscData.appAccessToken && miscData.appAccessToken.includes(".")) {
      logger.debug("Found app access token in miscData");
      // Check if token is expired
      if (miscData.appAccessTokenExpiresAt) {
        const expiryDate: Date = OneUptimeDate.fromString(
          miscData.appAccessTokenExpiresAt,
        );
        const now: Date = OneUptimeDate.getCurrentDate();
        const isExpired: boolean = OneUptimeDate.isAfter(now, expiryDate);
        const secondsToExpiry: number = OneUptimeDate.getSecondsTo(expiryDate);
        logger.debug(`Token expires in ${secondsToExpiry} seconds`);
        logger.debug(`Token is expired: ${isExpired}`);

        // If token is already expired or expires within the next 5 minutes, refresh it
        if (isExpired || secondsToExpiry <= 300) {
          logger.debug(
            "Access token is expired or expiring soon, attempting to refresh",
          );
          const newToken: string | null = await this.refreshAccessToken({
            projectId: data.projectId,
            miscData,
            tenantId,
          });
          if (newToken) {
            logger.debug("Successfully refreshed token");
            return newToken;
          }
          logger.warn("Failed to refresh token, falling back to cached token");
        } else {
          logger.debug(
            "Using cached appAccessToken from miscData for Microsoft Graph API call",
          );
          return miscData.appAccessToken;
        }
      } else {
        // No expiry information, use the token but it might be expired
        logger.debug(
          "Using appAccessToken from miscData (no expiry info available)",
        );
        return miscData.appAccessToken;
      }
    }

    // If we couldn't find a valid token, try to refresh
    logger.debug("No valid app access token found, attempting to refresh");
    const newToken: string | null = await this.refreshAccessToken({
      projectId: data.projectId,
      miscData,
      tenantId,
    });
    if (newToken) {
      logger.debug("Successfully refreshed token");
      return newToken;
    }

    // If refresh failed, throw error
    logger.error("Could not obtain valid access token for Microsoft Teams", {
      projectId: data.projectId.toString(),
    });
    throw new BadDataException(
      "Could not obtain valid access token for Microsoft Teams",
    );
  }

  // Method to refresh the Microsoft Teams access token
  private static async refreshAccessToken(data: {
    projectId: ObjectID;
    miscData: MicrosoftTeamsMiscData;
    tenantId: string;
  }): Promise<string | null> {
    logger.debug("=== refreshAccessToken called ===", {
      projectId: data.projectId?.toString(),
    });

    if (!data.projectId) {
      throw new BadDataException(
        "projectId is required to refresh Microsoft Teams access token",
      );
    }

    if (!data.miscData) {
      throw new BadDataException(
        "miscData is required to refresh Microsoft Teams access token",
      );
    }

    logger.debug(`Project ID: ${data.projectId.toString()}`);
    logger.debug(`Tenant ID: ${data.tenantId}`);

    try {
      // Check if we have the necessary client credentials
      if (!MicrosoftTeamsAppClientId || !MicrosoftTeamsAppClientSecret) {
        logger.error(
          "Microsoft Teams app client credentials are not configured",
        );
        logger.error(
          "Please set MICROSOFT_TEAMS_APP_CLIENT_ID and MICROSOFT_TEAMS_APP_CLIENT_SECRET environment variables",
        );
        return null;
      }

      logger.debug("Client credentials are configured");

      if (!data.tenantId) {
        logger.error("Tenant ID not provided, cannot refresh token");
        return null;
      }

      logger.debug(
        `Attempting to refresh Microsoft Teams access token for project ${data.projectId.toString()}`,
      );
      logger.debug(`Using tenant ID: ${data.tenantId}`);

      // Use OAuth 2.0 client credentials flow to get a new app access token
      const tokenUrl: string = `https://login.microsoftonline.com/${data.tenantId}/oauth2/v2.0/token`;
      logger.debug(`Token URL: ${tokenUrl}`);

      const tokenRequestBody: JSONObject = {
        client_id: MicrosoftTeamsAppClientId,
        client_secret: MicrosoftTeamsAppClientSecret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      };

      logger.debug("Making token refresh request to Microsoft");
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post({
          url: URL.fromString(tokenUrl),
          data: tokenRequestBody,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
        });

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error refreshing Microsoft Teams access token:");
        logger.error(response);
        return null;
      }

      logger.debug("Token refresh response received successfully");
      const tokenData: JSONObject = response.data;
      const newAccessToken: string = tokenData["access_token"] as string;
      const expiresIn: number = tokenData["expires_in"] as number; // seconds

      logger.debug(`New access token received: ${Boolean(newAccessToken)}`);
      logger.debug(`Token expires in: ${expiresIn} seconds`);

      if (!newAccessToken) {
        logger.error("No access token received in token refresh response");
        return null;
      }

      // Calculate expiry time
      const now: Date = OneUptimeDate.getCurrentDate();
      const expiryDate: Date = OneUptimeDate.addRemoveSeconds(
        now,
        expiresIn - 300,
      ); // Subtrutes buffer

      logger.debug(
        `Token expiry calculated: ${OneUptimeDate.toString(expiryDate)}`,
      );

      /*
       * Merge the token fields into a FRESH read of miscData instead of the
       * snapshot taken before the OAuth round-trip. The snapshot can be
       * seconds old, and writing it back verbatim would erase concurrent
       * miscData updates — in particular chats captured into availableChats
       * by bot install events, which cannot be re-derived from Graph.
       */
      let latestMiscData: MicrosoftTeamsMiscData = data.miscData;
      try {
        const latestProjectAuth: WorkspaceProjectAuthToken | null =
          await WorkspaceProjectAuthTokenService.getProjectAuth({
            projectId: data.projectId,
            workspaceType: WorkspaceType.MicrosoftTeams,
          });
        if (latestProjectAuth?.miscData) {
          latestMiscData = latestProjectAuth.miscData as MicrosoftTeamsMiscData;
        }
      } catch (err) {
        logger.debug("Could not re-read miscData before token refresh write");
        logger.debug(err);
      }

      const updatedMiscData: MicrosoftTeamsMiscData = {
        ...latestMiscData,
        appAccessToken: newAccessToken,
        appAccessTokenExpiresAt: OneUptimeDate.toString(expiryDate),
        lastAppTokenIssuedAt: OneUptimeDate.toString(now),
        tenantId: data.tenantId,
      };

      logger.debug("Saving updated token to database");
      // Save the updated token to the database
      await WorkspaceProjectAuthTokenService.refreshAuthToken({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
        authToken: newAccessToken,
        workspaceProjectId: data.tenantId,
        miscData: updatedMiscData as any,
      });

      logger.debug("Microsoft Teams access token refreshed successfully");
      logger.debug(
        `New token expires at: ${updatedMiscData.appAccessTokenExpiresAt}`,
      );

      return newAccessToken;
    } catch (error) {
      logger.error("Error refreshing Microsoft Teams access token:", {
        projectId: data.projectId.toString(),
      });
      logger.error(error);
      return null;
    }
  }

  // Extract action type and value from Teams Adaptive Card submit value
  private static extractActionFromValue(value: JSONObject): {
    actionType: MicrosoftTeamsActionType;
    actionValue: string;
  } {
    /*
     * Support multiple shapes that Teams may send for Adaptive Card submits
     * 1) { action: "ack-incident", actionValue: "<id>" }
     * 2) { data: { action: "ack-incident", actionValue: "<id>" } }
     * 3) { action: { type: "Action.Submit", data: { action: "ack-incident", actionValue: "<id>" } } }
     */
    let actionType: string = (value["action"] as string) || "";
    let actionValue: string = (value["actionValue"] as string) || "";

    const valData: JSONObject | undefined =
      (value["data"] as JSONObject) || undefined;
    if ((!actionType || !actionValue) && valData) {
      actionType = (valData["action"] as string) || actionType;
      actionValue = (valData["actionValue"] as string) || actionValue;
    }

    const actionObj: JSONObject | undefined = value[
      "action"
    ] as unknown as JSONObject;
    if (
      (!actionType || !actionValue) &&
      actionObj &&
      typeof actionObj === "object"
    ) {
      const embeddedData: JSONObject | undefined =
        (actionObj["data"] as JSONObject) || undefined;
      if (embeddedData) {
        actionType = (embeddedData["action"] as string) || actionType;
        actionValue = (embeddedData["actionValue"] as string) || actionValue;
      }
    }

    return { actionType: actionType as MicrosoftTeamsActionType, actionValue };
  }

  /**
   * Converts markdown tables to HTML tables for Teams MessageCard.
   * Teams MessageCard supports HTML in the text field.
   */
  private static convertMarkdownTablesToHtml(markdown: string): string {
    // Regular expression to match markdown tables
    const tableRegex: RegExp =
      /(?:^|\n)((?:\|[^\n]+\|\n)+(?:\|[-:\s|]+\|\n)(?:\|[^\n]+\|\n?)+)/g;

    return markdown.replace(
      tableRegex,
      (_match: string, table: string): string => {
        const lines: Array<string> = table.trim().split("\n");

        if (lines.length < 2) {
          return table;
        }

        // Parse header row
        const headerLine: string = lines[0] || "";
        const headers: Array<string> = headerLine
          .split("|")
          .map((cell: string) => {
            return cell.trim();
          })
          .filter((cell: string) => {
            return cell.length > 0;
          });

        // Skip separator line (line with dashes) and get data rows
        const dataRows: Array<string> = lines.slice(2);

        // Build HTML table
        let html: string =
          '<table style="border-collapse: collapse; width: 100%;">';

        // Header row
        html += "<tr>";
        for (const header of headers) {
          html += `<th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2; text-align: left;"><strong>${header}</strong></th>`;
        }
        html += "</tr>";

        // Data rows
        for (const row of dataRows) {
          const cells: Array<string> = row
            .split("|")
            .map((cell: string) => {
              return cell.trim();
            })
            .filter((cell: string) => {
              return cell.length > 0;
            });

          if (cells.length === 0) {
            continue;
          }

          html += "<tr>";
          for (const cell of cells) {
            html += `<td style="border: 1px solid #ddd; padding: 8px;">${cell}</td>`;
          }
          html += "</tr>";
        }

        html += "</table>";

        return "\n" + html + "\n";
      },
    );
  }

  private static buildMessageCardFromMarkdown(markdown: string): JSONObject {
    /*
     * Teams MessageCard has limited markdown support. Headings like '##' are not supported
     * and single newlines can collapse. Convert common patterns to a structured card.
     */

    // First, convert markdown tables to HTML
    const markdownWithHtmlTables: string =
      this.convertMarkdownTablesToHtml(markdown);

    const lines: Array<string> = markdownWithHtmlTables
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
      const boldCountTitle: number = (title.match(/\*\*/g) || []).length;
      if (boldCountTitle % 2 !== 0) {
        title = title.replace(/\*\*/g, "");
      }
      lines.shift();
    }

    const linkRegex: RegExp = /\[([^\]]+)\]\(([^)]+)\)/g; // [text](url)

    // Helper to clean up unmatched bold markers that can break rendering
    const sanitizeMarkdownText: (text: string) => string = (
      text: string,
    ): string => {
      const boldCount: number = (text.match(/\*\*/g) || []).length;
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

    /*
     * Enforced at the sink, not only at the callers: this URL reaches here from
     * workflow arguments and from status page subscribers, and a caller that
     * forgets the pin is an SSRF from the API server.
     */
    if (!MicrosoftTeamsUtil.isValidMicrosoftTeamsIncomingWebhookUrl(data.url)) {
      throw new BadDataException(
        `Microsoft Teams Webhook URL must be an https URL on ${MICROSOFT_TEAMS_WEBHOOK_DOMAINS.join(" or ")}.`,
      );
    }

    // Build a structured MessageCard from markdown for better rendering in Teams
    const payload: JSONObject = this.buildMessageCardFromMarkdown(data.text);

    const apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse | null =
      await API.post({
        url: data.url,
        data: payload,
        options: {
          /*
           * The host is pinned to Microsoft, but do not let a redirect from it
           * bounce this request to an internal address.
           */
          doNotFollowRedirects: true,
        },
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
    /*
     * Pin on the URL's HOST, not on a substring of the whole URL. Subscribers
     * (including unauthenticated ones on a public status page) supply this
     * value and the server POSTs to it, so a substring check was satisfied by
     * an attacker-controlled path or query — `http://169.254.169.254/?x=office.com`
     * passed and turned this into an SSRF into the cloud metadata endpoint.
     */
    return SSRFProtection.isUrlOnAllowedDomain(
      incomingWebhookUrl,
      MICROSOFT_TEAMS_WEBHOOK_DOMAINS,
    );
  }

  @CaptureSpan()
  public static override async getUsernameFromUserId(data: {
    authToken: string;
    userId: string;
    projectId: ObjectID;
  }): Promise<string | null> {
    logger.debug("Getting username from user ID with data:", {
      projectId: data.projectId.toString(),
      userId: data.userId,
    });
    logger.debug(data);

    // Get valid access token
    const accessToken: string = await this.getValidAccessToken({
      authToken: data.authToken,
      projectId: data.projectId,
    });

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get<JSONObject>({
        url: URL.fromString(
          `https://graph.microsoft.com/v1.0/users/${data.userId}`,
        ),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });

    logger.debug("Response from Microsoft Graph API for getting user info:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Microsoft Graph API:", {
        projectId: data.projectId.toString(),
        userId: data.userId,
      });
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
    teamId: string; // Required team ID
  }): Promise<Array<WorkspaceChannel>> {
    logger.debug("Creating channels if they do not exist with data:");
    logger.debug(data);

    const workspaceChannels: Array<WorkspaceChannel> = [];

    for (const channelName of data.channelNames) {
      /*
       * Normalize channel name: replace spaces with hyphens, then strip
       * characters not valid in Teams channel names (e.g. #, %, &, *, etc.).
       */
      const normalizedChannelName: string = channelName
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9\-_]/g, "");

      // Check if channel exists
      const existingChannel: WorkspaceChannel | null =
        await this.getWorkspaceChannelByName({
          authToken: data.authToken,
          channelName: normalizedChannelName,
          projectId: data.projectId,
          teamId: data.teamId,
        });

      if (existingChannel) {
        logger.debug(`Channel ${channelName} already exists.`);
        workspaceChannels.push(existingChannel);
        continue;
      }

      logger.debug(`Channel ${channelName} does not exist. Creating channel.`);
      const createChannelData: {
        authToken: string;
        channelName: string;
        projectId: ObjectID;
        teamId: string;
      } = {
        authToken: data.authToken,
        channelName: normalizedChannelName,
        projectId: data.projectId,
        teamId: data.teamId,
      };

      const channel: WorkspaceChannel =
        await this.createChannel(createChannelData);

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
    teamId: string; // Required team ID
    isPrivate?: boolean;
  }): Promise<WorkspaceChannel> {
    const teamId: string = data.teamId;

    // Sanitize channel name: strip characters not valid in Teams channel names.
    data.channelName = data.channelName.replace(/[^a-zA-Z0-9\-_\s]/g, "");

    // Get valid access token
    const accessToken: string = await this.getValidAccessToken({
      authToken: data.authToken,
      projectId: data.projectId,
    });

    const channelPayload: JSONObject = {
      displayName: data.channelName,
      description: `OneUptime notifications for ${data.channelName}`,
      membershipType: data.isPrivate ? "private" : "standard",
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
      teamId: data.teamId,
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
    teamId: string;
  }): Promise<WorkspaceChannel> {
    const channel: WorkspaceChannel | null =
      await this.getWorkspaceChannelByName({
        authToken: data.authToken,
        channelName: data.channelName,
        projectId: data.projectId,
        teamId: data.teamId,
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
    teamId: string;
  }): Promise<WorkspaceChannel | null> {
    if (!data.projectId) {
      throw new BadDataException(
        "projectId is required to get Microsoft Teams channel by name",
      );
    }

    if (!data.teamId) {
      throw new BadDataException(
        "teamId is required to get Microsoft Teams channel by name",
      );
    }

    if (!data.channelName) {
      throw new BadDataException(
        "channelName is required to get Microsoft Teams channel by name",
      );
    }

    logger.debug(`Getting workspace channel by name: ${data.channelName}`);

    // Get project auth to get available teams
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    if (!projectAuth?.miscData) {
      logger.error("Microsoft Teams integration not found for this project");
      throw new BadDataException(
        "Microsoft Teams integration not found for this project",
      );
    }

    // Get valid access token
    const accessToken: string | null = await this.getValidAccessToken({
      authToken: data.authToken,
      projectId: data.projectId,
    });

    // Get channels for this team
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get({
        url: URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${data.teamId}/channels`,
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

    const channelName: string = data.channelName.toLowerCase();

    for (const channelData of channels) {
      const displayName: string | undefined = channelData[
        "displayName"
      ] as string;
      if (!displayName) {
        continue;
      }
      const apiChannelName: string = displayName.toLowerCase();
      logger.debug(
        `Comparing channel '${apiChannelName}' with requested '${channelName}'`,
      );
      if (apiChannelName === channelName) {
        const foundChannel: WorkspaceChannel = {
          id: `${channelData["id"]}`,
          name: displayName,
          workspaceType: WorkspaceType.MicrosoftTeams,
          teamId: data.teamId,
          membershipType: channelData["membershipType"] as string | undefined,
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
    logger.debug("=== MicrosoftTeamsUtil.sendMessage called ===", {
      projectId: data.projectId.toString(),
    });
    logger.debug("Sending message to Microsoft Teams with data:");
    logger.debug(data);

    /*
     * Teams adaptive cards have a ~28KB payload limit.
     * Split message blocks into chunks of 40 to avoid hitting the limit.
     */
    const maxBlocksPerCard: number = 40;
    const allMessageBlocks: Array<WorkspaceMessageBlock> =
      data.workspaceMessagePayload.messageBlocks;

    const adaptiveCards: Array<JSONObject> = [];

    if (allMessageBlocks.length <= maxBlocksPerCard) {
      adaptiveCards.push(
        this.buildAdaptiveCardFromMessageBlocks({
          messageBlocks: allMessageBlocks,
        }),
      );
    } else {
      for (
        let i: number = 0;
        i < allMessageBlocks.length;
        i += maxBlocksPerCard
      ) {
        const chunk: Array<WorkspaceMessageBlock> = allMessageBlocks.slice(
          i,
          i + maxBlocksPerCard,
        );
        adaptiveCards.push(
          this.buildAdaptiveCardFromMessageBlocks({
            messageBlocks: chunk,
          }),
        );
      }
    }

    logger.debug(
      `Built ${adaptiveCards.length} adaptive card(s) from ${allMessageBlocks.length} message blocks`,
    );

    const workspaceChannelsToPostTo: Array<WorkspaceChannel> = [];

    logger.debug(
      `Processing ${data.workspaceMessagePayload.channelNames.length} channel names`,
    );
    logger.debug(
      `Channel names: ${JSON.stringify(data.workspaceMessagePayload.channelNames)}`,
    );

    /*
     * Declared before destination resolution so that a destination we cannot
     * even resolve is reported as an error. Silently skipping it made a
     * typo'd or deleted channel look like a successful send.
     */
    const workspaceMessageResponse: WorkspaceSendMessageResponse = {
      threads: [],
      workspaceType: WorkspaceType.MicrosoftTeams,
      errors: [],
    };

    // Resolve channel names
    for (const channelName of data.workspaceMessagePayload.channelNames) {
      logger.debug(`Attempting to resolve channel name: ${channelName}`);

      if (!data.workspaceMessagePayload.teamId) {
        throw new BadDataException(
          "Team ID is required to resolve channel names.",
        );
      }

      const channel: WorkspaceChannel | null =
        await this.getWorkspaceChannelByName({
          authToken: data.authToken,
          channelName: channelName,
          projectId: data.projectId,
          teamId: data.workspaceMessagePayload.teamId,
        });

      if (channel) {
        logger.debug(
          `Channel resolved successfully: ${JSON.stringify(channel)}`,
        );
        workspaceChannelsToPostTo.push(channel);
      } else {
        logger.warn(`Channel not found: ${channelName}`);
        workspaceMessageResponse.errors!.push({
          channel: {
            id: "",
            name: channelName,
            workspaceType: WorkspaceType.MicrosoftTeams,
            teamId: data.workspaceMessagePayload.teamId,
          },
          error: `Channel "${channelName}" was not found in this Microsoft Teams team. It may have been renamed or deleted.`,
        });
      }
    }

    logger.debug("=== Starting message sending loop ===");
    logger.debug(
      `Total channels to post to: ${workspaceChannelsToPostTo.length}`,
    );
    logger.debug(`Channels: ${JSON.stringify(workspaceChannelsToPostTo)}`);

    // Add channels by ID
    for (const channelId of data.workspaceMessagePayload.channelIds) {
      if (!data.workspaceMessagePayload.teamId) {
        throw new BadDataException(
          "Team ID is required to resolve channel IDs.",
        );
      }

      try {
        logger.debug(`Getting channel info for channel ID: ${channelId}`);
        const channel: WorkspaceChannel =
          await this.getWorkspaceChannelFromChannelId({
            authToken: data.authToken,
            channelId: channelId,
            projectId: data.projectId,
            teamId: data.workspaceMessagePayload.teamId,
          });
        logger.debug(`Channel info obtained: ${JSON.stringify(channel)}`);
        workspaceChannelsToPostTo.push(channel);
      } catch (err) {
        logger.error(
          `Error getting channel info for channel ID ${channelId}:`,
          {
            projectId: data.projectId.toString(),
            channelId: channelId,
          },
        );
        logger.error(err);
        workspaceMessageResponse.errors!.push({
          channel: {
            id: channelId,
            name: channelId,
            workspaceType: WorkspaceType.MicrosoftTeams,
            teamId: data.workspaceMessagePayload.teamId,
          },
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.debug("=== Starting message sending loop ===");
    logger.debug(
      `Total channels to post to: ${workspaceChannelsToPostTo.length}`,
    );
    logger.debug(`Channels: ${JSON.stringify(workspaceChannelsToPostTo)}`);

    for (const channel of workspaceChannelsToPostTo) {
      try {
        logger.debug(
          `Attempting to send message to channel: ${JSON.stringify(channel)}`,
        );

        if (!data.workspaceMessagePayload.teamId) {
          throw new BadDataException(
            "Team ID is required to send messages to channels.",
          );
        }

        // Send each adaptive card chunk to the channel
        let lastThread: WorkspaceThread | undefined;
        for (const adaptiveCard of adaptiveCards) {
          lastThread = await this.sendAdaptiveCardToChannel({
            authToken: data.authToken,
            teamId: data.workspaceMessagePayload.teamId!,
            workspaceChannel: channel,
            adaptiveCard: adaptiveCard,
            projectId: data.projectId,
          });
        }

        if (lastThread) {
          logger.debug(
            `Message sent successfully to channel ${channel.name}, thread: ${JSON.stringify(lastThread)}`,
          );
          workspaceMessageResponse.threads.push(lastThread);
        }
      } catch (e) {
        logger.error(`Error sending message to channel ID ${channel.id}:`, {
          projectId: data.projectId.toString(),
          channelId: channel.id,
        });
        logger.error(e);
        workspaceMessageResponse.errors!.push({
          channel: channel,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Send to Teams chats (group / personal chats the OneUptime app was added to).
    const chatIdsToPostTo: Array<string> =
      data.workspaceMessagePayload.chatIds || [];

    if (chatIdsToPostTo.length > 0) {
      logger.debug(`Processing ${chatIdsToPostTo.length} chat ids`);

      const availableChats: Record<string, MicrosoftTeamsChat> =
        await this.getChatsForProject({
          projectId: data.projectId,
        });

      for (const chatId of chatIdsToPostTo) {
        const chatAsChannel: WorkspaceChannel = {
          id: chatId,
          name: availableChats[chatId]?.name || chatId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        };

        try {
          let lastThread: WorkspaceThread | undefined;
          for (const adaptiveCard of adaptiveCards) {
            lastThread = await this.sendAdaptiveCardToChat({
              chatId: chatId,
              adaptiveCard: adaptiveCard,
              projectId: data.projectId,
            });
          }

          if (lastThread) {
            logger.debug(
              `Message sent successfully to chat ${chatAsChannel.name}, thread: ${JSON.stringify(lastThread)}`,
            );
            workspaceMessageResponse.threads.push(lastThread);
          }
        } catch (e) {
          logger.error(`Error sending message to chat ID ${chatId}:`, {
            projectId: data.projectId.toString(),
            chatId: chatId,
          });
          logger.error(e);
          workspaceMessageResponse.errors!.push({
            channel: chatAsChannel,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    logger.debug("=== Message sending completed ===");
    logger.debug(
      `Final thread count: ${workspaceMessageResponse.threads.length}`,
    );
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
    if (!data.projectId) {
      throw new BadDataException(
        "projectId is required to send Microsoft Teams adaptive card",
      );
    }

    if (!data.teamId) {
      throw new BadDataException(
        "teamId is required to send Microsoft Teams adaptive card",
      );
    }

    if (!data.workspaceChannel) {
      throw new BadDataException(
        "workspaceChannel is required to send Microsoft Teams adaptive card",
      );
    }

    if (!data.workspaceChannel.id) {
      throw new BadDataException(
        "workspaceChannel.id is required to send Microsoft Teams adaptive card",
      );
    }

    if (!data.adaptiveCard) {
      throw new BadDataException(
        "adaptiveCard is required to send Microsoft Teams adaptive card",
      );
    }

    logger.debug(
      `Sending adaptive card to channel via Bot Framework: ${data.workspaceChannel.name} (${data.workspaceChannel.id})`,
      {
        projectId: data.projectId.toString(),
        channelId: data.workspaceChannel.id,
        teamId: data.teamId,
      },
    );
    logger.debug(`Team ID: ${data.teamId}`);
    logger.debug(`Adaptive card: ${JSON.stringify(data.adaptiveCard)}`);

    try {
      // Get project auth to retrieve bot ID
      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.getProjectAuth({
          projectId: data.projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        });

      if (!projectAuth || !projectAuth.miscData) {
        throw new BadDataException(
          "Microsoft Teams integration not found for this project",
        );
      }

      const miscData: MicrosoftTeamsMiscData =
        projectAuth.miscData as MicrosoftTeamsMiscData;
      if (!miscData.botId) {
        throw new BadDataException(
          "Bot ID not found in Microsoft Teams integration",
        );
      }

      const tenantId: string | undefined = projectAuth.workspaceProjectId;

      if (!tenantId) {
        throw new BadDataException(
          "Tenant ID not found in Microsoft Teams integration",
        );
      }

      // Check if app client ID is configured
      if (!MicrosoftTeamsAppClientId) {
        throw new BadDataException(
          "Microsoft Teams App Client ID not configured",
        );
      }

      logger.debug(`Using bot ID: ${miscData.botId}`);

      /*
       * Bots cannot post to shared channels at all, so fail with the reason
       * rather than letting Microsoft reject the send with a generic error.
       */
      if (data.workspaceChannel.membershipType === "shared") {
        throw new BadDataException(
          `"${data.workspaceChannel.name}" is a shared channel, and Microsoft Teams does not allow bots to post in shared channels. Please pick a standard or private channel instead.`,
        );
      }

      /*
       * Preflight: refuse before calling the Bot Framework when we know the
       * app was never installed into this team. Channels are discovered with
       * tenant-wide Graph application permissions, which see every team
       * regardless of installation — so reaching this point proves nothing
       * about whether we can actually post.
       *
       * installedTeams is only populated from install events, so an empty map
       * means "we have not observed any installs" (for example on a workspace
       * connected before this shipped), not "nothing is installed". Only
       * enforce once we have at least one record, and let the Bot Framework
       * error be translated below otherwise.
       */
      const installedTeams: Record<string, MicrosoftTeamsInstalledTeam> =
        miscData.installedTeams || {};
      const installedTeam: MicrosoftTeamsInstalledTeam | undefined =
        installedTeams[data.teamId];

      if (Object.keys(installedTeams).length > 0 && !installedTeam) {
        throw new BadDataException(
          this.getBotNotInTeamMessage({
            channelName: data.workspaceChannel.name,
            membershipType: data.workspaceChannel.membershipType,
          }),
        );
      }

      // Get Bot Framework adapter
      const adapter: CloudAdapter = this.getBotAdapter();

      // Create conversation reference for the channel
      const conversationReference: ConversationReference = {
        bot: {
          id: MicrosoftTeamsAppClientId,
          name: "OneUptime Bot",
        },
        conversation: {
          id: data.workspaceChannel.id,
          name: data.workspaceChannel.name,
          isGroup: true,
          conversationType: "channel",
          tenantId: tenantId,
        },
        channelId: "msteams",
        /*
         * Fallback is the commercial-cloud global endpoint; the serviceUrl
         * captured from the install event is preferred (required for GCC/DoD),
         * matching what sendAdaptiveCardToChat already does.
         */
        serviceUrl:
          installedTeam?.serviceUrl || "https://smba.trafficmanager.net/teams/",
      };

      logger.debug(
        `Conversation reference: ${JSON.stringify(conversationReference)}`,
      );

      // Send proactive message using Bot Framework
      let messageId: string = "";

      await adapter.continueConversationAsync(
        MicrosoftTeamsAppClientId,
        conversationReference,
        async (context: TurnContext) => {
          logger.debug("Sending adaptive card as proactive message");

          // Create message with adaptive card attachment
          const message: Partial<Activity> = MessageFactory.attachment({
            contentType: "application/vnd.microsoft.card.adaptive",
            content: data.adaptiveCard,
          });

          const response: ResourceResponse | undefined =
            await context.sendActivity(message);

          messageId = response?.id || "";

          logger.debug(`Message sent with ID: ${messageId}`);
        },
      );

      const thread: WorkspaceThread = {
        channel: data.workspaceChannel,
        threadId: messageId,
      };

      logger.debug(
        `Created thread via Bot Framework: ${JSON.stringify(thread)}`,
      );
      return thread;
    } catch (error) {
      logger.error("Error sending adaptive card via Bot Framework:", {
        projectId: data.projectId.toString(),
        channelId: data.workspaceChannel.id,
        teamId: data.teamId,
      });
      logger.error(error);

      /*
       * Microsoft's roster rejection is meaningless to an admin ("The bot is
       * not part of the conversation roster"). Replace it with the action that
       * actually fixes it.
       */
      if (this.isBotNotInConversationRosterError(error)) {
        throw new BadDataException(
          this.getBotNotInTeamMessage({
            channelName: data.workspaceChannel.name,
            membershipType: data.workspaceChannel.membershipType,
          }),
        );
      }

      throw error;
    }
  }

  /*
   * True when an error is Microsoft's "bot is not in this conversation"
   * rejection from a proactive Bot Framework send.
   */
  public static isBotNotInConversationRosterError(error: unknown): boolean {
    const message: string = (
      error instanceof Error ? error.message : String(error || "")
    ).toLowerCase();

    if (!message) {
      return false;
    }

    return MICROSOFT_TEAMS_ROSTER_ERROR_FRAGMENTS.some((fragment: string) => {
      return message.includes(fragment);
    });
  }

  /*
   * Actionable replacement for the roster error. Private channels need the app
   * installed into the channel itself; a parent-team install does not cover
   * them, so the two cases get different instructions.
   */
  public static getBotNotInTeamMessage(data: {
    channelName: string;
    membershipType?: string | undefined;
  }): string {
    if (data.membershipType === "private") {
      return `The OneUptime app is not installed in the private channel "${data.channelName}". In Microsoft Teams, open the channel, click the "..." menu, then Manage channel > Apps > Add an app, and add OneUptime. Installing OneUptime in the parent team does not cover private channels.`;
    }

    return `The OneUptime app is not installed in the Microsoft Teams team that owns "${data.channelName}". In Microsoft Teams, click the "..." next to the team name, then Manage team > Apps > More apps, and add OneUptime. Installing OneUptime for yourself or in a chat is not the same as adding it to the team.`;
  }

  /*
   * Sends an adaptive card to a Teams group chat or personal (1:1) chat via a
   * proactive Bot Framework message. The OneUptime app must have been added to
   * the chat — Graph has no app-only permission for posting to chats, so the
   * bot conversation is the only supported transport.
   */
  @CaptureSpan()
  public static async sendAdaptiveCardToChat(data: {
    chatId: string;
    projectId: ObjectID;
    adaptiveCard: JSONObject;
  }): Promise<WorkspaceThread> {
    logger.debug("sendAdaptiveCardToChat called with data:");
    logger.debug(`Chat ID: ${data.chatId}`);
    logger.debug(`Project ID: ${data.projectId.toString()}`);

    try {
      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.getProjectAuth({
          projectId: data.projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        });

      if (!projectAuth || !projectAuth.miscData) {
        throw new BadDataException(
          "Microsoft Teams integration not found for this project",
        );
      }

      const miscData: MicrosoftTeamsMiscData =
        projectAuth.miscData as MicrosoftTeamsMiscData;
      if (!miscData.botId) {
        throw new BadDataException(
          "Bot ID not found in Microsoft Teams integration",
        );
      }

      const tenantId: string | undefined = projectAuth.workspaceProjectId;

      if (!tenantId) {
        throw new BadDataException(
          "Tenant ID not found in Microsoft Teams integration",
        );
      }

      if (!MicrosoftTeamsAppClientId) {
        throw new BadDataException(
          "Microsoft Teams App Client ID not configured",
        );
      }

      const chat: MicrosoftTeamsChat | undefined =
        miscData.availableChats?.[data.chatId];

      if (!chat) {
        throw new BadDataException(
          "This chat is not connected to OneUptime. Please add the OneUptime app to the chat in Microsoft Teams and try again.",
        );
      }

      const adapter: CloudAdapter = this.getBotAdapter();

      const conversationReference: ConversationReference = {
        bot: {
          id: MicrosoftTeamsAppClientId,
          name: "OneUptime Bot",
        },
        conversation: {
          id: chat.id,
          name: chat.name,
          isGroup: chat.chatType === "groupChat",
          conversationType: chat.chatType,
          tenantId: tenantId,
        },
        channelId: "msteams",
        /*
         * Fallback is the commercial-cloud global endpoint; the serviceUrl
         * captured from bot activities is preferred (required for GCC/DoD).
         */
        serviceUrl: chat.serviceUrl || "https://smba.trafficmanager.net/teams/",
      };

      logger.debug(
        `Chat conversation reference: ${JSON.stringify(conversationReference)}`,
      );

      let messageId: string = "";

      await adapter.continueConversationAsync(
        MicrosoftTeamsAppClientId,
        conversationReference,
        async (context: TurnContext) => {
          logger.debug("Sending adaptive card to chat as proactive message");

          const message: Partial<Activity> = MessageFactory.attachment({
            contentType: "application/vnd.microsoft.card.adaptive",
            content: data.adaptiveCard,
          });

          const response: ResourceResponse | undefined =
            await context.sendActivity(message);

          messageId = response?.id || "";

          logger.debug(`Chat message sent with ID: ${messageId}`);
        },
      );

      const thread: WorkspaceThread = {
        channel: {
          id: chat.id,
          name: chat.name,
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        threadId: messageId,
      };

      logger.debug(
        `Sent message to chat via Bot Framework: ${JSON.stringify(thread)}`,
      );
      return thread;
    } catch (error) {
      logger.error("Error sending adaptive card to chat via Bot Framework:", {
        projectId: data.projectId.toString(),
        chatId: data.chatId,
      });
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
    logger.debug("=== getWorkspaceChannelFromChannelId called ===", {
      projectId: data.projectId?.toString(),
      channelId: data.channelId,
      teamId: data.teamId,
    });

    if (!data.projectId) {
      throw new BadDataException(
        "projectId is required to get Microsoft Teams channel by ID",
      );
    }

    if (!data.teamId) {
      throw new BadDataException(
        "teamId is required to get Microsoft Teams channel by ID",
      );
    }

    if (!data.channelId) {
      throw new BadDataException(
        "channelId is required to get Microsoft Teams channel by ID",
      );
    }

    logger.debug(`Channel ID: ${data.channelId}`);
    logger.debug(`Team ID: ${data.teamId}`);
    logger.debug(`Project ID: ${data.projectId.toString()}`);

    try {
      // Get valid access token
      const accessToken: string | null = await this.getValidAccessToken({
        authToken: data.authToken,
        projectId: data.projectId,
      });

      logger.debug("Access token obtained for channel info retrieval");

      // Fetch channel information from Microsoft Graph API
      const apiUrl: string = `https://graph.microsoft.com/v1.0/teams/${data.teamId}/channels/${data.channelId}`;
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
        logger.error("Error getting channel info from Microsoft Graph API:", {
          projectId: data.projectId.toString(),
          channelId: data.channelId,
          teamId: data.teamId,
        });
        logger.error(response);
        // Fall back to basic channel object
        logger.debug("Falling back to basic channel object");
        return {
          id: data.channelId,
          name: data.channelId,
          workspaceType: WorkspaceType.MicrosoftTeams,
          teamId: data.teamId,
        };
      }

      logger.debug("Channel info API call successful");
      const channelData: JSONObject = response.data;

      const channel: WorkspaceChannel = {
        id: data.channelId,
        name: channelData["displayName"] as string,
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: data.teamId,
        membershipType: channelData["membershipType"] as string | undefined,
      };

      logger.debug(`Channel info retrieved: ${JSON.stringify(channel)}`);
      return channel;
    } catch (error) {
      logger.error("Error fetching channel information:", {
        projectId: data.projectId.toString(),
        channelId: data.channelId,
        teamId: data.teamId,
      });
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
        const markdownBlock: WorkspacePayloadMarkdown =
          block as WorkspacePayloadMarkdown;
        logger.debug(`Markdown text: ${markdownBlock.text}`);
        const markdownObj: JSONObject = this.getMarkdownBlock({
          payloadMarkdownBlock: markdownBlock,
        });
        body.push(markdownObj);
      } else if (block._type === "WorkspacePayloadHeader") {
        const headerBlock: WorkspacePayloadHeader =
          block as WorkspacePayloadHeader;
        logger.debug(`Header text: ${headerBlock.text}`);
        const headerObj: JSONObject = this.getHeaderBlock({
          payloadHeaderBlock: headerBlock,
        });
        body.push(headerObj);
      } else if (block._type === "WorkspacePayloadButtons") {
        const buttonsBlock: WorkspacePayloadButtons =
          block as WorkspacePayloadButtons;
        logger.debug(`Processing ${buttonsBlock.buttons.length} buttons`);
        for (const button of buttonsBlock.buttons) {
          logger.debug(
            `Button: ${button.title} -> ${button.url ? button.url.toString() : "invoke"}`,
          );
          const actionObj: JSONObject = this.getButtonBlock({
            payloadButtonBlock: button,
          });
          actions.push(actionObj);
        }
      }
    }

    card["body"] = body;
    card["actions"] = actions;

    logger.debug(
      `Built adaptive card with ${body.length} body elements and ${actions.length} actions`,
    );
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
  public static override async getAllWorkspaceChannels(data: {
    authToken: string;
    projectId: ObjectID;
    teamId: string;
  }): Promise<Dictionary<WorkspaceChannel>> {
    logger.debug("Getting all workspace channels for team ID: " + data.teamId);

    // Get valid access token
    const accessToken: string | null = await this.getValidAccessToken({
      authToken: data.authToken,
      projectId: data.projectId,
    });

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get({
        url: URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${data.teamId}/channels`,
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
    const channelsArray: Array<JSONObject> =
      (channelsData["value"] as Array<JSONObject>) || [];

    const channelsDict: Dictionary<WorkspaceChannel> = {};

    for (const channelData of channelsArray) {
      const membershipType: string | undefined = channelData[
        "membershipType"
      ] as string | undefined;

      /*
       * Microsoft Teams does not support bots in shared channels, so offering
       * one as a notification destination can only ever produce a failed send.
       */
      if (membershipType === "shared") {
        logger.debug(
          `Skipping shared channel ${channelData["displayName"]} — Teams does not support bots in shared channels.`,
        );
        continue;
      }

      const channel: WorkspaceChannel = {
        id: channelData["id"] as string,
        name: channelData["displayName"] as string,
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: data.teamId,
        membershipType: membershipType,
      };
      channelsDict[channel.id] = channel;
    }

    logger.debug(
      `Retrieved ${Object.keys(channelsDict).length} channels from API`,
    );
    return channelsDict;
  }

  @CaptureSpan()
  public static override async doesChannelExist(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
    teamId?: string;
  }): Promise<boolean> {
    if (!data.teamId) {
      throw new BadDataException(
        "teamId is required for Microsoft Teams doesChannelExist",
      );
    }
    const channel: WorkspaceChannel | null =
      await this.getWorkspaceChannelByName({
        authToken: data.authToken,
        channelName: data.channelName,
        projectId: data.projectId,
        teamId: data.teamId,
      });
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
    const possibleActionValue: JSONObject =
      (data.activity["value"] as JSONObject) || {};
    const from: JSONObject = (data.activity["from"] as JSONObject) || {};
    const conversation: JSONObject =
      (data.activity["conversation"] as JSONObject) || {};
    const channelData: JSONObject =
      (data.activity["channelData"] as JSONObject) || {};
    const entities: Array<JSONObject> =
      (data.activity["entities"] as Array<JSONObject>) || [];

    logger.debug(`Bot message from: ${JSON.stringify(from)}`);
    logger.debug(`Message text: ${messageText}`);
    logger.debug(`Conversation: ${JSON.stringify(conversation)}`);
    logger.debug(`Channel data: ${JSON.stringify(channelData)}`);
    logger.debug(`Entities: ${JSON.stringify(entities)}`);

    /*
     * Loop-guard: never process the bot's own messages. Teams generally does not
     * echo the bot to itself, but if the sender is the bot recipient (same id) or
     * is flagged with the "bot" role, ignore the activity to avoid a self-reply
     * loop when routing free-form text to the AI assistant.
     */
    const senderId: string = (from["id"] as string) || "";
    const botRecipientId: string = (data.activity["recipient"] as JSONObject)?.[
      "id"
    ] as string;
    const senderRole: string = (from["role"] as string) || "";
    if (
      senderRole === "bot" ||
      (senderId && botRecipientId && senderId === botRecipientId)
    ) {
      logger.debug(
        "Message activity originates from the bot itself; ignoring to prevent a loop",
      );
      return;
    }

    /*
     * Backfill chat capture from inbound messages. Chats where the app was
     * installed before chat capture shipped never fire install events — per
     * Microsoft docs, app upgrades only send installationUpdate when the
     * manifest's bot is added or removed, so a version bump alone re-fires
     * nothing. Messaging the bot in a chat is the documented recovery path,
     * and this also keeps the stored serviceUrl fresh (docs: verify the
     * stored serviceUrl when a new message arrives). Cheap when the chat is
     * already captured (single read, no roster fetch, no write).
     */
    const messageConversationType: string =
      (conversation["conversationType"] as string) || "";
    if (
      messageConversationType === "personal" ||
      messageConversationType === "groupChat"
    ) {
      await this.captureChatFromBotActivity({
        activity: data.activity,
        turnContext: data.turnContext,
        onlyIfMissingOrStale: true,
      });
    }

    /*
     * Same backfill for team installs. Teams the app was added to before we
     * started recording installs fire no new install event, so an @mention in
     * any channel of that team is the recovery path that makes proactive
     * channel notifications work again.
     */
    if (messageConversationType === "channel") {
      await this.captureTeamFromBotActivity({
        activity: data.activity,
        turnContext: data.turnContext,
      });
    }

    // If this is actually an Adaptive Card submit wrapped as a message, route to invoke handler
    if (
      (possibleActionValue["action"] as string) ||
      (possibleActionValue["data"] as any)?.["action"]
    ) {
      logger.debug(
        "Message activity contains action payload; routing to invoke handler",
      );
      await this.handleBotInvokeActivity({
        activity: data.activity,
        turnContext: data.turnContext,
      });
      return;
    }

    // Check if the bot was mentioned
    const recipientId: string = (data.activity["recipient"] as JSONObject)?.[
      "id"
    ] as string;
    const conversationType: string =
      (conversation["conversationType"] as string) || "";
    const isDirectMessage: boolean = conversationType === "personal";
    const isMentioned: boolean = entities.some((entity: JSONObject) => {
      return (
        entity["type"] === "mention" &&
        (entity["mentioned"] as JSONObject)?.["id"] === recipientId
      );
    });

    // Only respond if it's a direct message or the bot was mentioned
    if (!isDirectMessage && !isMentioned) {
      logger.debug("Bot not mentioned in channel message, ignoring");
      return;
    }

    // Extract tenant ID to get project ID
    const tenantId: string = (channelData["tenant"] as JSONObject)?.[
      "id"
    ] as string;
    if (!tenantId) {
      logger.error("Tenant ID not found in channelData");
      await data.turnContext.sendActivity(
        "Sorry, I couldn't identify your organization. Please try again later.",
      );
      return;
    }

    // Get project auth by tenant ID
    const tenantResolution: MicrosoftTeamsTenantResolution =
      await this.resolveProjectByTenantId({
        tenantId: tenantId,
      });

    if (
      !tenantResolution.projectAuth ||
      !tenantResolution.projectAuth.projectId
    ) {
      await data.turnContext.sendActivity(
        this.getTenantResolutionFailureMessage(tenantResolution),
      );
      return;
    }

    const projectId: ObjectID = tenantResolution.projectAuth.projectId;
    logger.debug(
      `Found project ID: ${projectId.toString()} for tenant ID: ${tenantId}`,
    );

    // Clean the message text by removing bot mentions
    const cleanText: string = messageText
      .replace(/<at[^>]*>.*?<\/at>/g, "")
      .trim()
      .toLowerCase();

    /*
     * Preserve the original casing of the user's question. The AI assistant
     * should receive the free-form text exactly as the user typed it (case,
     * punctuation and spacing all matter), with only the bot @mention stripped.
     */
    const originalQuestionText: string = messageText
      .replace(/<at[^>]*>.*?<\/at>/g, "")
      .trim();

    let responseText: string = "";

    try {
      const isCreateIncidentCommand: boolean =
        cleanText === "create incident" ||
        cleanText.startsWith("create incident ");

      const isCreateMaintenanceCommand: boolean =
        cleanText === "create maintenance" ||
        cleanText.startsWith("create maintenance ");

      /*
       * Explicit commands are matched precisely so that natural-language
       * questions (which may incidentally contain words like "help" or
       * "alerts") fall through to the AI assistant instead of a canned command.
       */
      const isHelpCommand: boolean =
        cleanText === "help" || cleanText === "" || cleanText === "?";

      const isShowActiveIncidentsCommand: boolean =
        cleanText === "show active incidents" ||
        cleanText === "active incidents";

      const isShowScheduledMaintenanceCommand: boolean =
        cleanText === "show scheduled maintenance" ||
        cleanText === "scheduled maintenance";

      const isShowOngoingMaintenanceCommand: boolean =
        cleanText === "show ongoing maintenance" ||
        cleanText === "ongoing maintenance";

      const isShowActiveAlertsCommand: boolean =
        cleanText === "show active alerts" || cleanText === "active alerts";

      /*
       * "ask <question>" is an explicit prefix that always routes to the AI
       * assistant. When present, strip the prefix and use the remainder as the
       * question.
       */
      const isAskCommand: boolean =
        cleanText === "ask" || cleanText.startsWith("ask ");

      if (isHelpCommand) {
        responseText = this.getHelpMessage();
      } else if (isCreateIncidentCommand) {
        // Handle create incident command (legacy slash command supported)
        logger.debug("Processing create incident command");
        const card: JSONObject =
          await MicrosoftTeamsIncidentActions.buildNewIncidentCard(projectId);
        await data.turnContext.sendActivity({
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              content: card,
            },
          ],
        });
        logger.debug("New incident card sent successfully");
        return;
      } else if (isCreateMaintenanceCommand) {
        // Handle create maintenance command (legacy slash command supported)
        logger.debug("Processing create maintenance command");
        const card: JSONObject =
          await MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCard(
            projectId,
          );
        await data.turnContext.sendActivity({
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              content: card,
            },
          ],
        });
        logger.debug("New scheduled maintenance card sent successfully");
        return;
      } else if (isShowActiveIncidentsCommand) {
        responseText = await this.getActiveIncidentsMessage(projectId);
      } else if (isShowScheduledMaintenanceCommand) {
        responseText = await this.getScheduledMaintenanceMessage(projectId);
      } else if (isShowOngoingMaintenanceCommand) {
        responseText = await this.getOngoingMaintenanceMessage(projectId);
      } else if (isShowActiveAlertsCommand) {
        responseText = await this.getActiveAlertsMessage(projectId);
      } else {
        /*
         * AI Ops: any message that is not one of the explicit commands above is
         * treated as a natural-language question for the observability
         * assistant. This also handles the explicit "ask <question>" prefix.
         */
        const question: string = isAskCommand
          ? originalQuestionText.replace(/^ask\s*/i, "").trim()
          : originalQuestionText;

        if (!question) {
          // Bare "ask" with no question - point the user at help.
          responseText = this.getHelpMessage();
          await data.turnContext.sendActivity(responseText);
          return;
        }

        await this.answerObservabilityQuestion({
          activity: data.activity,
          turnContext: data.turnContext,
          projectId: projectId,
          question: question,
        });
        return;
      }

      // Send response directly using TurnContext - this is the recommended Bot Framework pattern
      await data.turnContext.sendActivity(responseText);
      logger.debug("Bot message sent successfully using TurnContext", {
        projectId: projectId.toString(),
      });
    } catch (error) {
      logger.error("Error sending bot message via TurnContext: " + error, {
        projectId: projectId.toString(),
      });
      await data.turnContext.sendActivity(
        "Sorry, I encountered an error processing your request. Please try again later.",
      );
      throw error;
    }
  }

  /*
   * AI Ops: transient acknowledgement text the bot posts before answering. We
   * must skip these when reconstructing conversation history so the assistant
   * never treats its own "please wait" filler as a real prior turn.
   */
  private static readonly AI_OPS_ACK_TEXT: string = "Looking into it…";

  /*
   * AI Ops: cap on how many prior turns we feed the assistant as history. The
   * engine also clamps history internally, but we keep the payload small.
   */
  private static readonly AI_OPS_MAX_HISTORY_TURNS: number = 12;

  /*
   * AI Ops: strip a Teams message body down to plain text - remove <at> bot
   * mentions and any remaining HTML tags, collapse whitespace, and trim. Teams
   * channel/chat message bodies are typically HTML (body.contentType "html").
   */
  private static toPlainTextFromTeamsMessageBody(rawContent: string): string {
    return rawContent
      .replace(/<at[^>]*>.*?<\/at>/g, "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /*
   * AI Ops: gather the prior turns of the current Teams conversation/thread and
   * map them to the assistant's history shape ({ role, content }, oldest-first,
   * excluding the current triggering message).
   *
   * Teams limitation: in channels a bot only receives messages that @mention it
   * (unless RSC / ChannelMessage.Read.Group is granted at install time), so
   * channel follow-ups generally require re-@mentioning the bot. 1:1 (personal)
   * chat follow-ups do not require a mention. If ids can't be parsed or the
   * Graph call fails, we degrade gracefully to no history - the caller wraps
   * this in a try/catch and never lets a history failure break the reply.
   */
  @CaptureSpan()
  private static async getConversationHistoryTurns(data: {
    activity: JSONObject;
    projectId: ObjectID;
  }): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
    const { activity, projectId } = data;

    const conversation: JSONObject =
      (activity["conversation"] as JSONObject) || {};
    const channelData: JSONObject =
      (activity["channelData"] as JSONObject) || {};
    const conversationType: string =
      (conversation["conversationType"] as string) || "";
    const conversationId: string = (conversation["id"] as string) || "";
    const currentMessageId: string = (activity["id"] as string) || "";

    /*
     * The bot's id - used to classify each message as "assistant" (from the
     * bot) vs "user". This is the same id the loop-guard compares against.
     */
    const botId: string =
      ((activity["recipient"] as JSONObject)?.["id"] as string) ||
      MicrosoftTeamsAppClientId ||
      "";

    if (!conversationId) {
      return [];
    }

    // Acquire a Graph app token using the same mechanism the rest of this file uses.
    const accessToken: string = await this.getValidAccessToken({
      authToken: "",
      projectId: projectId,
    });

    // Collect raw Graph message objects (unordered; we sort at the end).
    let rawMessages: Array<JSONObject> = [];

    if (conversationType === "personal") {
      /*
       * 1:1 chat: conversation.id is the chat id. Fetch recent chat messages.
       */
      const chatId: string = conversationId;
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get<JSONObject>({
          url: URL.fromString(
            `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(
              chatId,
            )}/messages?$top=20`,
          ),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        });

      if (response instanceof HTTPErrorResponse) {
        logger.debug("Failed to fetch 1:1 chat history for AI Ops context");
        logger.debug(response);
        return [];
      }

      rawMessages = (response.data["value"] as Array<JSONObject>) || [];
    } else {
      /*
       * Channel thread: conversation.id encodes the root message id as
       * "<channelId>;messageid=<rootId>". Team & channel ids come from
       * channelData. Fetch the root message plus its replies.
       */
      const teamId: string | undefined = (channelData["team"] as JSONObject)?.[
        "id"
      ] as string;
      const channelId: string | undefined = (
        channelData["channel"] as JSONObject
      )?.["id"] as string;

      const messageIdMatch: RegExpMatchArray | null =
        conversationId.match(/messageid=(\d+)/);
      const rootMessageId: string | undefined = messageIdMatch?.[1];

      if (!teamId || !channelId || !rootMessageId) {
        logger.debug(
          "Could not parse team/channel/root message ids for AI Ops channel history; proceeding without history",
        );
        return [];
      }

      // Fetch replies in the thread.
      const repliesResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get<JSONObject>({
          url: URL.fromString(
            `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages/${rootMessageId}/replies?$top=20`,
          ),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        });

      if (repliesResponse instanceof HTTPErrorResponse) {
        logger.debug(
          "Failed to fetch channel thread replies for AI Ops context",
        );
        logger.debug(repliesResponse);
      } else {
        rawMessages =
          (repliesResponse.data["value"] as Array<JSONObject>) || [];
      }

      // Also fetch the root message so the original question is part of context.
      const rootResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get<JSONObject>({
          url: URL.fromString(
            `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages/${rootMessageId}`,
          ),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        });

      if (!(rootResponse instanceof HTTPErrorResponse) && rootResponse.data) {
        rawMessages.push(rootResponse.data);
      }
    }

    // Map each Graph message to a { role, content, createdAt, id } tuple.
    const mappedTurns: Array<{
      role: "user" | "assistant";
      content: string;
      createdAtMs: number;
      id: string;
    }> = [];

    for (const message of rawMessages) {
      const messageId: string = (message["id"] as string) || "";

      // Exclude the current triggering message - that is the live question.
      if (messageId && currentMessageId && messageId === currentMessageId) {
        continue;
      }

      const body: JSONObject = (message["body"] as JSONObject) || {};
      const rawContent: string = (body["content"] as string) || "";
      const content: string = this.toPlainTextFromTeamsMessageBody(rawContent);

      if (!content) {
        continue;
      }

      // Skip the bot's transient "Looking into it…" acknowledgements.
      if (content === this.AI_OPS_ACK_TEXT) {
        continue;
      }

      /*
       * Classify sender. Graph marks bot/app messages via from.application; a
       * matching application/user id to the bot id also means it is the bot.
       */
      const fromObj: JSONObject = (message["from"] as JSONObject) || {};
      const fromApplication: JSONObject =
        (fromObj["application"] as JSONObject) || {};
      const fromUser: JSONObject = (fromObj["user"] as JSONObject) || {};
      const fromApplicationId: string = (fromApplication["id"] as string) || "";
      const fromUserId: string = (fromUser["id"] as string) || "";

      const isFromBot: boolean =
        Boolean(fromApplication["id"]) ||
        (botId !== "" && (fromApplicationId === botId || fromUserId === botId));

      const role: "user" | "assistant" = isFromBot ? "assistant" : "user";

      const createdAtRaw: string = (message["createdDateTime"] as string) || "";
      const createdAtMs: number = createdAtRaw
        ? new Date(createdAtRaw).getTime()
        : 0;

      mappedTurns.push({
        role: role,
        content: content,
        createdAtMs: createdAtMs,
        id: messageId,
      });
    }

    // Order oldest -> newest so the assistant reads the conversation in order.
    mappedTurns.sort(
      (a: { createdAtMs: number }, b: { createdAtMs: number }): number => {
        return a.createdAtMs - b.createdAtMs;
      },
    );

    // Cap to the most recent turns.
    const cappedTurns: Array<{
      role: "user" | "assistant";
      content: string;
    }> = mappedTurns
      .slice(-this.AI_OPS_MAX_HISTORY_TURNS)
      .map((turn: { role: "user" | "assistant"; content: string }) => {
        return { role: turn.role, content: turn.content };
      });

    return cappedTurns;
  }

  /*
   * AI Ops: resolve the OneUptime user for the Teams sender, build their real
   * permission props, ask the observability assistant, and reply in the same
   * conversation with the markdown answer plus a compact "Sources" footer.
   */
  @CaptureSpan()
  private static async answerObservabilityQuestion(data: {
    activity: JSONObject;
    turnContext: TurnContext;
    projectId: ObjectID;
    question: string;
  }): Promise<void> {
    const { activity, turnContext, projectId, question } = data;

    /*
     * Resolve the Teams user. Teams identifies the sender by their Azure AD
     * object id (aadObjectId), which is what WorkspaceUserAuthToken stores as
     * the workspaceUserId. This mirrors how handleBotInvokeActivity resolves
     * the acting user.
     */
    const fromObj: JSONObject = (activity["from"] as JSONObject) || {};
    const teamsUserId: string | undefined =
      (fromObj["aadObjectId"] as string) || undefined;

    if (!teamsUserId) {
      logger.error(
        "AAD Object ID (teamsUserId) not found in message activity from object",
        {
          projectId: projectId.toString(),
        },
      );
      await turnContext.sendActivity(
        "Sorry, I couldn't identify you. Please try again later.",
      );
      return;
    }

    // Resolve the OneUptime user linked to this Teams user.
    let oneUptimeUserId: ObjectID;
    try {
      oneUptimeUserId =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: teamsUserId,
          projectId: projectId,
        });
    } catch (error) {
      logger.debug(
        "No OneUptime user linked to Teams user; prompting to connect account",
        {
          projectId: projectId.toString(),
          workspaceUserId: teamsUserId,
        },
      );
      logger.debug(error);
      await turnContext.sendActivity(
        "I couldn't find your OneUptime account. Please connect your Microsoft Teams account in OneUptime User Settings before asking me questions.",
      );
      return;
    }

    /*
     * Let the user know we're working on it. The assistant runs a bounded,
     * tool-grounded agent loop and can take several seconds, so send a quick
     * acknowledgement first.
     */
    try {
      await turnContext.sendActivity(this.AI_OPS_ACK_TEXT);
    } catch (ackError) {
      // A failed acknowledgement should not stop us from answering.
      logger.debug("Failed to send acknowledgement activity");
      logger.debug(ackError);
    }

    /*
     * Make the assistant context-aware: gather the prior turns of this
     * conversation/thread and pass them as history (oldest-first, excluding the
     * current question). Any failure here is non-fatal - we simply proceed
     * statelessly so a history problem never breaks the reply.
     */
    let history: Array<{ role: "user" | "assistant"; content: string }> = [];
    try {
      history = await this.getConversationHistoryTurns({
        activity: activity,
        projectId: projectId,
      });
      logger.debug(
        `AI Ops gathered ${history.length} prior conversation turn(s) as history`,
        {
          projectId: projectId.toString(),
        },
      );
    } catch (historyError) {
      logger.debug(
        "Failed to gather AI Ops conversation history; proceeding statelessly",
      );
      logger.debug(historyError);
      history = [];
    }

    try {
      // Build the user's real permission props - the assistant's tools run under these.
      const props: DatabaseCommonInteractionProps =
        await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
          {
            userId: oneUptimeUserId,
            projectId: projectId,
          },
        );

      /*
       * Loaded on demand via require(): importing the AI toolbox at module top
       * pulls the entire observability tool graph — and its database
       * infrastructure — into the core API module graph at import time, which
       * trips circular-dependency init-order crashes. Teams ChatOps is the only
       * caller, so it is resolved lazily here. A value-position dynamic
       * import() is avoided because it fails TS1323 under the consuming
       * projects' module configuration.
       */
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      const ObservabilityAssistant: typeof import("../../AI/Chat/ObservabilityAssistant").default =
        require("../../AI/Chat/ObservabilityAssistant").default;
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

      const result: ObservabilityAssistantResult =
        await ObservabilityAssistant.answerQuestion({
          projectId: projectId,
          userId: oneUptimeUserId,
          props: props,
          question: question,
          ...(history.length > 0 && { history: history }),
          feature: "Microsoft Teams ChatOps",
        });

      // Build a compact "Sources" footer from the server-minted citations.
      let replyText: string = result.contentInMarkdown;

      if (result.citations && result.citations.length > 0) {
        const sourceLines: Array<string> = result.citations.map(
          (citation: AIChatCitation) => {
            return `• ${citation.label} (${citation.rowCount} rows)`;
          },
        );
        replyText += `\n\n**Sources**\n${sourceLines.join("\n")}`;
      }

      await turnContext.sendActivity(replyText);
      logger.debug("AI Ops answer sent successfully using TurnContext", {
        projectId: projectId.toString(),
      });
    } catch (error) {
      logger.error(
        "Error answering observability question via AI Ops: " + error,
        {
          projectId: projectId.toString(),
        },
      );
      await turnContext.sendActivity(
        "Sorry, I ran into a problem answering that question. Please try again later.",
      );
    }
  }

  // Helper methods for bot commands
  private static getHelpMessage(): string {
    return `Hello! I'm the OneUptime bot. I can help you with the following commands:

**Available Commands:**
- **help** - Show this help message
- **ask <question>** - Ask OneUptime AI about your logs, traces, metrics, incidents and monitors
- **create incident** - Create a new incident
- **create maintenance** - Create a new scheduled maintenance event
- **show active incidents** - Display all currently active incidents
- **show scheduled maintenance** - Show upcoming scheduled maintenance events
- **show ongoing maintenance** - Display currently ongoing maintenance events
- **show active alerts** - Display all active alerts

You can also just ask me a question in plain language - for example, "which monitors are down right now?" - and I'll look into your observability data for you.`;
  }

  private static async getActiveIncidentsMessage(
    projectId: ObjectID,
  ): Promise<string> {
    try {
      logger.debug(
        "Getting active incidents for project: " + projectId.toString(),
      );

      // Get unresolved incident states
      const unresolvedIncidentStates: Array<IncidentState> =
        await IncidentStateService.getUnresolvedIncidentStates(projectId, {
          isRoot: true,
        });

      const unresolvedIncidentStateIds: Array<ObjectID> =
        unresolvedIncidentStates.map((state: IncidentState) => {
          return state.id!;
        });

      // Find active incidents
      const activeIncidents: Array<Incident> = await IncidentService.findBy({
        query: {
          projectId: projectId,
          currentIncidentStateId: QueryHelper.any(unresolvedIncidentStateIds),
        },
        select: {
          _id: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
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
          declaredAt: true,
          monitors: {
            name: true,
          },
        },
        sort: {
          declaredAt: SortOrder.Descending,
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

      let message: string = `**Active Incidents** (${activeIncidents.length})

`;

      for (const incident of activeIncidents) {
        const severity: string = incident.incidentSeverity?.name || "Unknown";
        const state: string = incident.currentIncidentState?.name || "Unknown";
        const declaredAt: Date | undefined =
          incident.declaredAt || incident.createdAt;
        const declaredAtText: string = declaredAt
          ? OneUptimeDate.getDateAsFormattedString(declaredAt)
          : "Unknown";

        const severityIcon: string = ["Critical", "Major"].includes(severity)
          ? "🔴"
          : severity === "Minor"
            ? "🟠"
            : "🟡";

        const incidentUrl: URL =
          await IncidentService.getIncidentLinkInDashboard(
            projectId,
            incident.id!,
          );

        message += `${severityIcon} **[Incident ${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber}: ${incident.title}](${incidentUrl.toString()})**
• **Severity:** ${severity}
• **Status:** ${state}
• **Declared:** ${declaredAtText}
`;

        if (incident.monitors && incident.monitors.length > 0) {
          message += `• **Affected Services:** ${incident.monitors
            .map((m: Monitor) => {
              return m.name;
            })
            .join(", ")}\n`;
        }

        if (incident.description) {
          const desc: string = incident.description.replace(/\s+/g, " ");
          message += `• **Description:** ${desc.substring(0, 180)}${desc.length > 180 ? "..." : ""}\n`;
        }

        message += `• [Open in Dashboard](${incidentUrl.toString()})\n\n`;
      }

      return message;
    } catch (error) {
      logger.error("Error getting active incidents: " + error);
      return "Sorry, I couldn't retrieve active incidents information at the moment. Please try again later.";
    }
  }

  private static async getScheduledMaintenanceMessage(
    projectId: ObjectID,
  ): Promise<string> {
    try {
      logger.debug(
        "Getting scheduled maintenance events for project: " +
          projectId.toString(),
      );

      // Get scheduled maintenance events
      const scheduledEvents: Array<ScheduledMaintenance> =
        await ScheduledMaintenanceService.findBy({
          query: {
            projectId: projectId,
            currentScheduledMaintenanceState: {
              isScheduledState: true,
            } as any,
            isVisibleOnStatusPage: true, // Only show events visible on status page
          },
          select: {
            _id: true,
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
            scheduledMaintenanceNumberWithPrefix: true,
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

      let message: string = `**Scheduled Maintenance Events** (${scheduledEvents.length})

`;

      for (const event of scheduledEvents) {
        const state: string =
          event.currentScheduledMaintenanceState?.name || "Scheduled";
        const startTime: string = event.startsAt
          ? OneUptimeDate.getDateAsFormattedString(event.startsAt)
          : "TBD";
        const endTime: string = event.endsAt
          ? OneUptimeDate.getDateAsFormattedString(event.endsAt)
          : "TBD";

        const eventUrl: URL =
          await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
            projectId,
            event.id!,
          );

        message += `🛠️ **[Scheduled Maintenance ${event.scheduledMaintenanceNumberWithPrefix || "#" + event.scheduledMaintenanceNumber}: ${event.title}](${eventUrl.toString()})**
• **Status:** ${state}
• **Starts:** ${startTime}
• **Ends:** ${endTime}
`;

        if (event.monitors && event.monitors.length > 0) {
          message += `• **Affected Services:** ${event.monitors
            .map((m: Monitor) => {
              return m.name;
            })
            .join(", ")}\n`;
        }

        if (event.description) {
          const desc: string = event.description.replace(/\s+/g, " ");
          message += `• **Description:** ${desc.substring(0, 180)}${desc.length > 180 ? "..." : ""}\n`;
        }

        message += `• [View Event](${eventUrl.toString()})\n\n`;
      }

      return message;
    } catch (error) {
      logger.error("Error getting scheduled maintenance: " + error);
      return "Sorry, I couldn't retrieve scheduled maintenance information at the moment. Please try again later.";
    }
  }

  private static async getOngoingMaintenanceMessage(
    projectId: ObjectID,
  ): Promise<string> {
    try {
      logger.debug(
        "Getting ongoing maintenance events for project: " +
          projectId.toString(),
      );

      // Get ongoing maintenance events
      const ongoingEvents: Array<ScheduledMaintenance> =
        await ScheduledMaintenanceService.findBy({
          query: {
            projectId: projectId,
            currentScheduledMaintenanceState: {
              isOngoingState: true,
            } as any,
          },
          select: {
            _id: true,
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
            scheduledMaintenanceNumberWithPrefix: true,
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

      let message: string = `**Ongoing Maintenance Events** (${ongoingEvents.length})

`;

      for (const event of ongoingEvents) {
        const state: string =
          event.currentScheduledMaintenanceState?.name || "Ongoing";
        const startTime: string = event.startsAt
          ? OneUptimeDate.getDateAsFormattedString(event.startsAt)
          : "Unknown";
        const endTime: string = event.endsAt
          ? OneUptimeDate.getDateAsFormattedString(event.endsAt)
          : "TBD";

        const eventUrl: URL =
          await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
            projectId,
            event.id!,
          );

        message += `🔧 **[Scheduled Maintenance ${event.scheduledMaintenanceNumberWithPrefix || "#" + event.scheduledMaintenanceNumber}: ${event.title}](${eventUrl.toString()})**
• **Status:** ${state}
• **Started:** ${startTime}
• **Expected End:** ${endTime}
`;

        if (event.monitors && event.monitors.length > 0) {
          message += `• **Affected Services:** ${event.monitors
            .map((m: Monitor) => {
              return m.name;
            })
            .join(", ")}\n`;
        }

        if (event.description) {
          const desc: string = event.description.replace(/\s+/g, " ");
          message += `• **Description:** ${desc.substring(0, 180)}${desc.length > 180 ? "..." : ""}\n`;
        }

        message += `• [View Event](${eventUrl.toString()})\n\n`;
      }

      return message;
    } catch (error) {
      logger.error("Error getting ongoing maintenance: " + error);
      return "Sorry, I couldn't retrieve ongoing maintenance information at the moment. Please try again later.";
    }
  }

  private static async getActiveAlertsMessage(
    projectId: ObjectID,
  ): Promise<string> {
    try {
      logger.debug(
        "Getting active alerts for project: " + projectId.toString(),
      );

      // Get unresolved alert states
      const unresolvedAlertStates: Array<AlertState> =
        await AlertStateService.getUnresolvedAlertStates(projectId, {
          isRoot: true,
        });

      const unresolvedAlertStateIds: Array<ObjectID> =
        unresolvedAlertStates.map((state: AlertState) => {
          return state.id!;
        });

      // Find active alerts
      const activeAlerts: Array<Alert> = await AlertService.findBy({
        query: {
          projectId: projectId,
          currentAlertStateId: QueryHelper.any(unresolvedAlertStateIds),
        },
        select: {
          _id: true,
          alertNumber: true,
          alertNumberWithPrefix: true,
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

      let message: string = `**Active Alerts** (${activeAlerts.length})

`;

      for (const alert of activeAlerts) {
        const severity: string = alert.alertSeverity?.name || "Unknown";
        const state: string = alert.currentAlertState?.name || "Unknown";
        const createdAt: string = alert.createdAt
          ? OneUptimeDate.getDateAsFormattedString(alert.createdAt)
          : "Unknown";

        const alertUrl: URL = await AlertService.getAlertLinkInDashboard(
          projectId,
          alert.id!,
        );

        message += `⚠️ **[Alert ${alert.alertNumberWithPrefix || "#" + alert.alertNumber}: ${alert.title}](${alertUrl.toString()})**
• **Severity:** ${severity}
• **Status:** ${state}
• **Triggered:** ${createdAt}
`;

        if (alert.monitor?.name) {
          message += `• **Monitor:** ${alert.monitor.name}\n`;
        }

        if (alert.description) {
          const desc: string = alert.description.replace(/\s+/g, " ");
          message += `• **Description:** ${desc.substring(0, 180)}${desc.length > 180 ? "..." : ""}\n`;
        }

        message += `• [Open in Dashboard](${alertUrl.toString()})\n\n`;
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

    logger.debug(`Bot invoke activity - Action type: ${actionType}`);
    logger.debug(`Bot invoke value: ${JSON.stringify(value)}`);

    try {
      // Resolve project and user context from activity
      const channelData: JSONObject =
        (data.activity["channelData"] as JSONObject) || {};
      const tenantId: string = ((channelData["tenant"] as JSONObject) || {})[
        "id"
      ] as string;
      if (!tenantId) {
        logger.error("Tenant ID not found in invoke activity");
        await data.turnContext.sendActivity(
          "Sorry, I couldn't identify your organization. Please try again later.",
        );
        return;
      }

      const tenantResolution: MicrosoftTeamsTenantResolution =
        await this.resolveProjectByTenantId({
          tenantId: tenantId,
        });

      if (
        !tenantResolution.projectAuth ||
        !tenantResolution.projectAuth.projectId
      ) {
        await data.turnContext.sendActivity(
          this.getTenantResolutionFailureMessage(tenantResolution),
        );
        return;
      }

      const projectId: ObjectID = tenantResolution.projectAuth.projectId;
      const fromObj: JSONObject = ((data.activity["from"] as JSONObject) ||
        {}) as JSONObject;
      const teamsUserId: string | undefined =
        (fromObj["aadObjectId"] as string) || undefined;

      if (!teamsUserId) {
        logger.error(
          "AAD Object ID (teamsUserId) not found in invoke activity from object",
          {
            projectId: projectId.toString(),
          },
        );
        await data.turnContext.sendActivity(
          "Sorry, I couldn't identify you. Please try again later.",
        );
        return;
      }

      const userLookupParamsRes: {
        teamsUserId: string;
        projectId: ObjectID;
        aadObjectId?: string;
      } = {
        teamsUserId: teamsUserId,
        projectId: projectId,
      };

      const oneUptimeUserId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId(
          userLookupParamsRes,
        );

      // Handle incident actions
      if (MicrosoftTeamsIncidentActions.isIncidentAction({ actionType })) {
        await MicrosoftTeamsIncidentActions.handleBotIncidentAction({
          actionType,
          actionValue,
          value,
          projectId,
          oneUptimeUserId,
          turnContext: data.turnContext,
        });
        return;
      }

      // Handle alert actions
      if (MicrosoftTeamsAlertActions.isAlertAction({ actionType })) {
        await MicrosoftTeamsAlertActions.handleBotAlertAction({
          actionType,
          actionValue,
          value,
          projectId,
          oneUptimeUserId,
          turnContext: data.turnContext,
        });
        return;
      }

      // Handle alert episode actions
      if (
        MicrosoftTeamsAlertEpisodeActions.isAlertEpisodeAction({ actionType })
      ) {
        await MicrosoftTeamsAlertEpisodeActions.handleBotAlertEpisodeAction({
          actionType,
          actionValue,
          value,
          projectId,
          oneUptimeUserId,
          turnContext: data.turnContext,
        });
        return;
      }

      // Handle incident episode actions
      if (
        MicrosoftTeamsIncidentEpisodeActions.isIncidentEpisodeAction({
          actionType,
        })
      ) {
        await MicrosoftTeamsIncidentEpisodeActions.handleBotIncidentEpisodeAction(
          {
            actionType,
            actionValue,
            value,
            projectId,
            oneUptimeUserId,
            turnContext: data.turnContext,
          },
        );
        return;
      }

      // Handle monitor actions
      if (MicrosoftTeamsMonitorActions.isMonitorAction({ actionType })) {
        await MicrosoftTeamsMonitorActions.handleBotMonitorAction({
          actionType,
          actionValue,
          value,
          projectId,
          oneUptimeUserId,
          turnContext: data.turnContext,
        });
        return;
      }

      // Handle scheduled maintenance actions
      if (
        MicrosoftTeamsScheduledMaintenanceActions.isScheduledMaintenanceAction({
          actionType,
        })
      ) {
        await MicrosoftTeamsScheduledMaintenanceActions.handleBotScheduledMaintenanceAction(
          actionType as MicrosoftTeamsScheduledMaintenanceActionType,
          data.turnContext,
          value,
          {
            userId: oneUptimeUserId.toString(),
            projectId,
            isAuthorized: true,
            authToken: "",
            payloadType: "invoke",
          } as MicrosoftTeamsRequest,
        );
        return;
      }

      // Handle on-call duty actions
      if (MicrosoftTeamsOnCallDutyActions.isOnCallDutyAction({ actionType })) {
        await MicrosoftTeamsOnCallDutyActions.handleBotOnCallDutyAction(
          actionType as MicrosoftTeamsOnCallDutyActionType,
          data.turnContext,
          value,
        );
        return;
      }
    } catch (error) {
      logger.error("Error handling bot invoke activity:", {
        actionType: actionType,
      });
      logger.error(error);
      await data.turnContext.sendActivity(
        "Sorry, that action failed. Please try again later.",
      );
    }
  }

  @CaptureSpan()
  public static async handleConversationUpdateActivity(data: {
    activity: JSONObject;
    turnContext: TurnContext;
  }): Promise<void> {
    // Handle bot added to team/channel or members added/removed
    const membersAdded: Array<JSONObject> =
      (data.activity["membersAdded"] as Array<JSONObject>) || [];
    const membersRemoved: Array<JSONObject> =
      (data.activity["membersRemoved"] as Array<JSONObject>) || [];
    const conversation: JSONObject =
      (data.activity["conversation"] as JSONObject) || {};
    const channelData: JSONObject =
      (data.activity["channelData"] as JSONObject) || {};

    logger.debug(
      `Conversation update - Members added: ${JSON.stringify(membersAdded)}`,
    );
    logger.debug(
      `Conversation update - Members removed: ${JSON.stringify(membersRemoved)}`,
    );
    logger.debug(`Conversation: ${JSON.stringify(conversation)}`);
    logger.debug(`Channel data: ${JSON.stringify(channelData)}`);

    // Check if the bot was added
    const recipientId: string | undefined =
      data.turnContext.activity.recipient?.id;

    const botWasAdded: boolean = membersAdded.some((member: JSONObject) => {
      return member["id"] === recipientId;
    });

    const botWasRemoved: boolean = membersRemoved.some((member: JSONObject) => {
      return member["id"] === recipientId;
    });

    if (botWasAdded) {
      logger.debug("OneUptime bot was added to a Teams conversation");
      await this.captureChatFromBotActivity({
        activity: data.activity,
        turnContext: data.turnContext,
      });
      await this.captureTeamFromBotActivity({
        activity: data.activity,
        turnContext: data.turnContext,
      });
      await this.sendWelcomeAdaptiveCard(data.turnContext);
    }

    if (botWasRemoved) {
      logger.debug("OneUptime bot was removed from a Teams conversation");
      await this.removeChatFromBotActivity({
        activity: data.activity,
      });
      await this.removeTeamFromBotActivity({
        activity: data.activity,
      });
    }
  }

  @CaptureSpan()
  public static async handleInstallationUpdateActivity(data: {
    activity: JSONObject;
    turnContext: TurnContext;
  }): Promise<void> {
    // Handle bot installation/uninstallation
    const action: string = (data.activity["action"] as string) || "";
    const conversation: JSONObject =
      (data.activity["conversation"] as JSONObject) || {};

    logger.debug(`Installation update - Action: ${action}`);
    logger.debug(`Conversation: ${JSON.stringify(conversation)}`);

    /*
     * Teams sends "add-upgrade" / "remove-upgrade" when an app upgrade adds
     * or removes the bot in the manifest (per Microsoft docs, a plain
     * version bump fires no installationUpdate at all). Treat them the same
     * as add/remove. Chats installed before chat capture shipped are
     * backfilled from inbound messages in handleBotMessageActivity instead.
     */
    if (action === "add" || action === "add-upgrade") {
      logger.debug("OneUptime bot was installed");
      await this.captureChatFromBotActivity({
        activity: data.activity,
        turnContext: data.turnContext,
      });
      await this.captureTeamFromBotActivity({
        activity: data.activity,
        turnContext: data.turnContext,
      });
    } else if (action === "remove" || action === "remove-upgrade") {
      logger.debug("OneUptime bot was uninstalled");
      await this.removeChatFromBotActivity({
        activity: data.activity,
      });
      await this.removeTeamFromBotActivity({
        activity: data.activity,
      });
    }
  }

  /*
   * Resolve the OneUptime project that owns a Microsoft tenant.
   *
   * Bot activities carry a tenant id and nothing else, so the tenant is the
   * only key we can resolve a project by. A tenant may legitimately be
   * connected to more than one OneUptime project (saveChatToProjectAuthTokens
   * fans out for exactly that reason), and when that happens the tenant alone
   * does NOT identify a project.
   *
   * Previously this was a bare findOneBy, which silently returned whichever
   * row sorted first and served that project's incidents, alerts and AI
   * assistant answers to anyone in the tenant — including users with no access
   * to it. The bot's message path performs no per-user authorization, so
   * picking arbitrarily is a cross-project disclosure. Refuse instead.
   */
  @CaptureSpan()
  public static async resolveProjectByTenantId(data: {
    tenantId: string;
  }): Promise<MicrosoftTeamsTenantResolution> {
    const projectAuths: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectAuthTokenService.findBy({
        query: {
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceProjectId: data.tenantId,
        },
        select: {
          projectId: true,
          authToken: true,
          workspaceProjectId: true,
          miscData: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    /*
     * Ambiguity is about distinct PROJECTS, not rows. Two rows pointing at the
     * same project are a data-integrity wart, not a question we cannot answer,
     * so collapse them rather than refusing to serve that tenant forever.
     */
    const seenProjectIds: Set<string> = new Set<string>();
    const usableProjectAuths: Array<WorkspaceProjectAuthToken> = [];

    for (const projectAuth of projectAuths) {
      if (!projectAuth.projectId) {
        continue;
      }

      const projectIdString: string = projectAuth.projectId.toString();

      if (seenProjectIds.has(projectIdString)) {
        continue;
      }

      seenProjectIds.add(projectIdString);
      usableProjectAuths.push(projectAuth);
    }

    if (usableProjectAuths.length === 0) {
      logger.error("Project auth not found for tenant ID: " + data.tenantId, {
        tenantId: data.tenantId,
      });
      return {
        projectAuth: null,
        isAmbiguous: false,
        candidateProjectIds: [],
      };
    }

    if (usableProjectAuths.length > 1) {
      const candidateProjectIds: Array<ObjectID> = usableProjectAuths.map(
        (projectAuth: WorkspaceProjectAuthToken) => {
          return projectAuth.projectId!;
        },
      );

      logger.error(
        `Microsoft tenant ${data.tenantId} is connected to ${usableProjectAuths.length} OneUptime projects. Refusing to guess which one this bot activity belongs to.`,
        {
          tenantId: data.tenantId,
          projectIds: candidateProjectIds
            .map((projectId: ObjectID) => {
              return projectId.toString();
            })
            .join(", "),
        },
      );

      return {
        projectAuth: null,
        isAmbiguous: true,
        candidateProjectIds: candidateProjectIds,
      };
    }

    return {
      projectAuth: usableProjectAuths[0]!,
      isAmbiguous: false,
      candidateProjectIds: [usableProjectAuths[0]!.projectId!],
    };
  }

  /*
   * User-facing text for a failed tenant resolution. The two cases need
   * different remedies, so they must not share a message.
   */
  public static getTenantResolutionFailureMessage(
    resolution: MicrosoftTeamsTenantResolution,
  ): string {
    if (resolution.isAmbiguous) {
      return "This Microsoft 365 organization is connected to more than one OneUptime project, so I can't tell which one you mean. Please ask your OneUptime admin to disconnect Microsoft Teams from all but one project.";
    }

    return "Sorry, I couldn't find your project configuration. This usually means the Microsoft 365 organization you're messaging me from isn't the one connected to OneUptime. Please ask your OneUptime admin to check the Microsoft Teams integration in Project Settings.";
  }

  /*
   * Chats (group chats and personal 1:1 chats) cannot be listed with the
   * app-only Graph token, so the only way OneUptime learns about them is by
   * capturing the conversation details when the OneUptime app is added to a
   * chat. These captured chats power the "post to chat" notification rules.
   */

  private static getChatTypeFromConversation(
    conversation: JSONObject,
  ): MicrosoftTeamsChatType | null {
    const conversationType: string =
      (conversation["conversationType"] as string) || "";

    if (conversationType === "personal" || conversationType === "groupChat") {
      return conversationType;
    }

    return null; // channels and meetings are not chats.
  }

  public static getChatDisplayName(data: {
    chatType: MicrosoftTeamsChatType;
    topic?: string | undefined;
    memberNames: Array<string>;
  }): string {
    /*
     * Keep well under the 100-char ShortText columns that store the chat
     * name in notification logs — Teams chat topics can be much longer.
     */
    const maxNameLength: number = 80;

    const truncate: (name: string) => string = (name: string): string => {
      return name.length > maxNameLength
        ? `${name.substring(0, maxNameLength - 1)}…`
        : name;
    };

    if (data.topic && data.topic.trim()) {
      return truncate(data.topic.trim());
    }

    const memberNames: Array<string> = data.memberNames.filter(
      (name: string) => {
        return Boolean(name && name.trim());
      },
    );

    if (data.chatType === "personal") {
      return memberNames[0] ? truncate(`${memberNames[0]}`) : "Personal chat";
    }

    if (memberNames.length === 0) {
      return "Group chat";
    }

    const maxNamesToShow: number = 3;
    const shownNames: Array<string> = memberNames.slice(0, maxNamesToShow);
    const remainingCount: number = memberNames.length - shownNames.length;

    if (remainingCount > 0) {
      return truncate(`${shownNames.join(", ")} + ${remainingCount} more`);
    }

    return truncate(shownNames.join(", "));
  }

  /*
   * Returns true when every connected project of this tenant already has
   * this chat stored with the same service URL — i.e. there is nothing to
   * capture or refresh.
   */
  private static async isChatCapturedForTenant(data: {
    tenantId: string;
    chatId: string;
    serviceUrl?: string | undefined;
  }): Promise<boolean> {
    const projectAuths: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectAuthTokenService.findBy({
        query: {
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceProjectId: data.tenantId,
        },
        select: {
          _id: true,
          miscData: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    if (projectAuths.length === 0) {
      return true; // no connected projects — nothing to capture into.
    }

    for (const projectAuth of projectAuths) {
      const chat: MicrosoftTeamsChat | undefined = (
        projectAuth.miscData as MicrosoftTeamsMiscData
      )?.availableChats?.[data.chatId];

      if (!chat) {
        return false;
      }

      if (data.serviceUrl && chat.serviceUrl !== data.serviceUrl) {
        return false; // stored serviceUrl is stale.
      }
    }

    return true;
  }

  @CaptureSpan()
  private static async captureChatFromBotActivity(data: {
    activity: JSONObject;
    turnContext: TurnContext;
    onlyIfMissingOrStale?: boolean | undefined;
  }): Promise<void> {
    try {
      const conversation: JSONObject =
        (data.activity["conversation"] as JSONObject) || {};

      const chatType: MicrosoftTeamsChatType | null =
        this.getChatTypeFromConversation(conversation);

      if (!chatType) {
        return; // bot was added to a team channel, not a chat.
      }

      const chatId: string = (conversation["id"] as string) || "";

      if (!chatId) {
        logger.debug("No conversation id found on chat activity. Skipping.");
        return;
      }

      const channelData: JSONObject =
        (data.activity["channelData"] as JSONObject) || {};
      const tenantId: string =
        ((channelData["tenant"] as JSONObject)?.["id"] as string) ||
        (conversation["tenantId"] as string) ||
        "";

      if (!tenantId) {
        logger.debug("No tenant id found on chat activity. Skipping.");
        return;
      }

      const activityServiceUrl: string | undefined =
        (data.activity["serviceUrl"] as string) ||
        data.turnContext.activity.serviceUrl ||
        undefined;

      /*
       * On the message-backfill path, skip the roster fetch and DB writes
       * when the chat is already captured with a fresh serviceUrl.
       */
      if (data.onlyIfMissingOrStale) {
        const alreadyCaptured: boolean = await this.isChatCapturedForTenant({
          tenantId: tenantId,
          chatId: chatId,
          serviceUrl: activityServiceUrl,
        });

        if (alreadyCaptured) {
          return;
        }
      }

      // Resolve a human friendly name for the chat.
      const topic: string | undefined = conversation["name"] as
        | string
        | undefined;

      let memberNames: Array<string> = [];

      try {
        const botId: string | undefined =
          data.turnContext.activity.recipient?.id;

        /*
         * TeamsInfo.getMembers is deprecated — page through the roster
         * instead. Chats return the full roster in one page in practice.
         */
        const members: Array<TeamsChannelAccount> = [];
        let continuationToken: string | undefined = undefined;
        do {
          const page: TeamsPagedMembersResult = await TeamsInfo.getPagedMembers(
            data.turnContext,
            500,
            continuationToken,
          );
          members.push(...(page.members || []));
          continuationToken = page.continuationToken;
        } while (continuationToken);

        memberNames = members
          .filter((member: TeamsChannelAccount) => {
            return member.id !== botId;
          })
          .map((member: TeamsChannelAccount) => {
            return member.name || "";
          });
      } catch (err) {
        logger.debug("Could not fetch chat members for chat name resolution");
        logger.debug(err);
      }

      const chat: MicrosoftTeamsChat = {
        id: chatId,
        name: this.getChatDisplayName({
          chatType: chatType,
          topic: topic,
          memberNames: memberNames,
        }),
        chatType: chatType,
        serviceUrl: activityServiceUrl,
        addedAt: OneUptimeDate.getCurrentDate().toISOString(),
      };

      await this.saveChatToProjectAuthTokens({
        tenantId: tenantId,
        chat: chat,
      });

      logger.debug(
        `Captured Microsoft Teams chat ${chatId} (${chat.name}) for tenant ${tenantId}`,
      );
    } catch (err) {
      logger.error("Error capturing Microsoft Teams chat from bot activity:");
      logger.error(err);
    }
  }

  @CaptureSpan()
  private static async removeChatFromBotActivity(data: {
    activity: JSONObject;
  }): Promise<void> {
    try {
      const conversation: JSONObject =
        (data.activity["conversation"] as JSONObject) || {};

      const chatType: MicrosoftTeamsChatType | null =
        this.getChatTypeFromConversation(conversation);

      if (!chatType) {
        return;
      }

      const chatId: string = (conversation["id"] as string) || "";
      const channelData: JSONObject =
        (data.activity["channelData"] as JSONObject) || {};
      const tenantId: string =
        ((channelData["tenant"] as JSONObject)?.["id"] as string) ||
        (conversation["tenantId"] as string) ||
        "";

      if (!chatId || !tenantId) {
        return;
      }

      await this.removeChatFromProjectAuthTokens({
        tenantId: tenantId,
        chatId: chatId,
      });

      logger.debug(
        `Removed Microsoft Teams chat ${chatId} for tenant ${tenantId}`,
      );
    } catch (err) {
      logger.error("Error removing Microsoft Teams chat from bot activity:");
      logger.error(err);
    }
  }

  @CaptureSpan()
  public static async saveChatToProjectAuthTokens(data: {
    tenantId: string;
    chat: MicrosoftTeamsChat;
  }): Promise<void> {
    /*
     * A tenant can be connected to more than one OneUptime project, and the
     * install event does not say which project it belongs to — so save the
     * chat on every project connected to this tenant.
     */
    const projectAuths: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectAuthTokenService.findBy({
        query: {
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceProjectId: data.tenantId,
        },
        select: {
          _id: true,
          miscData: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const projectAuth of projectAuths) {
      const miscData: MicrosoftTeamsMiscData = {
        ...((projectAuth.miscData as MicrosoftTeamsMiscData) || {}),
      } as MicrosoftTeamsMiscData;

      miscData.availableChats = {
        ...(miscData.availableChats || {}),
        [data.chat.id]: data.chat,
      };

      await WorkspaceProjectAuthTokenService.updateOneById({
        id: projectAuth.id!,
        data: {
          miscData: miscData,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  @CaptureSpan()
  public static async removeChatFromProjectAuthTokens(data: {
    tenantId: string;
    chatId: string;
  }): Promise<void> {
    const projectAuths: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectAuthTokenService.findBy({
        query: {
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceProjectId: data.tenantId,
        },
        select: {
          _id: true,
          miscData: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const projectAuth of projectAuths) {
      const miscData: MicrosoftTeamsMiscData = {
        ...((projectAuth.miscData as MicrosoftTeamsMiscData) || {}),
      } as MicrosoftTeamsMiscData;

      if (!miscData.availableChats || !miscData.availableChats[data.chatId]) {
        continue;
      }

      const availableChats: Record<string, MicrosoftTeamsChat> = {
        ...miscData.availableChats,
      };
      delete availableChats[data.chatId];
      miscData.availableChats = availableChats;

      await WorkspaceProjectAuthTokenService.updateOneById({
        id: projectAuth.id!,
        data: {
          miscData: miscData,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  @CaptureSpan()
  public static async getChatsForProject(data: {
    projectId: ObjectID;
  }): Promise<Record<string, MicrosoftTeamsChat>> {
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    if (!projectAuth || !projectAuth.miscData) {
      return {};
    }

    return (
      (projectAuth.miscData as MicrosoftTeamsMiscData).availableChats || {}
    );
  }

  /*
   * Record that the OneUptime app was installed into a team.
   *
   * Team installs arrive as conversationUpdate / installationUpdate activities
   * whose conversation is a channel. captureChatFromBotActivity drops those
   * (channels are not chats), so before this existed we threw away the only
   * signal that tells us a proactive channel post will be accepted.
   */
  @CaptureSpan()
  public static async captureTeamFromBotActivity(data: {
    activity: JSONObject;
    turnContext: TurnContext;
  }): Promise<void> {
    try {
      const channelData: JSONObject =
        (data.activity["channelData"] as JSONObject) || {};

      const team: JSONObject | undefined = channelData["team"] as
        | JSONObject
        | undefined;

      const teamId: string = (team?.["id"] as string) || "";

      if (!teamId) {
        // Not a team-scoped activity (personal or group chat). Nothing to do.
        return;
      }

      const tenantId: string =
        ((channelData["tenant"] as JSONObject)?.["id"] as string) || "";

      if (!tenantId) {
        logger.debug("No tenant id found on team activity. Skipping.");
        return;
      }

      const installedTeam: MicrosoftTeamsInstalledTeam = {
        id: teamId,
        name: (team?.["name"] as string) || undefined,
        serviceUrl:
          (data.activity["serviceUrl"] as string) ||
          data.turnContext.activity.serviceUrl ||
          undefined,
        addedAt: OneUptimeDate.getCurrentDate().toISOString(),
      };

      await this.saveTeamToProjectAuthTokens({
        tenantId: tenantId,
        team: installedTeam,
      });

      logger.debug(
        `Captured Microsoft Teams team install ${teamId} for tenant ${tenantId}`,
      );
    } catch (err) {
      logger.error("Error capturing Microsoft Teams team from bot activity:");
      logger.error(err);
    }
  }

  @CaptureSpan()
  public static async removeTeamFromBotActivity(data: {
    activity: JSONObject;
  }): Promise<void> {
    try {
      const channelData: JSONObject =
        (data.activity["channelData"] as JSONObject) || {};

      const teamId: string =
        ((channelData["team"] as JSONObject)?.["id"] as string) || "";
      const tenantId: string =
        ((channelData["tenant"] as JSONObject)?.["id"] as string) || "";

      if (!teamId || !tenantId) {
        return;
      }

      await this.removeTeamFromProjectAuthTokens({
        tenantId: tenantId,
        teamId: teamId,
      });

      logger.debug(
        `Removed Microsoft Teams team install ${teamId} for tenant ${tenantId}`,
      );
    } catch (err) {
      logger.error("Error removing Microsoft Teams team from bot activity:");
      logger.error(err);
    }
  }

  @CaptureSpan()
  public static async saveTeamToProjectAuthTokens(data: {
    tenantId: string;
    team: MicrosoftTeamsInstalledTeam;
  }): Promise<void> {
    /*
     * Same fan-out reasoning as saveChatToProjectAuthTokens: the install event
     * does not say which project it belongs to, so record it on every project
     * connected to this tenant.
     */
    const projectAuths: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectAuthTokenService.findBy({
        query: {
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceProjectId: data.tenantId,
        },
        select: {
          _id: true,
          miscData: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const projectAuth of projectAuths) {
      const miscData: MicrosoftTeamsMiscData = {
        ...((projectAuth.miscData as MicrosoftTeamsMiscData) || {}),
      } as MicrosoftTeamsMiscData;

      miscData.installedTeams = {
        ...(miscData.installedTeams || {}),
        [data.team.id]: data.team,
      };

      await WorkspaceProjectAuthTokenService.updateOneById({
        id: projectAuth.id!,
        data: {
          miscData: miscData,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  @CaptureSpan()
  public static async removeTeamFromProjectAuthTokens(data: {
    tenantId: string;
    teamId: string;
  }): Promise<void> {
    const projectAuths: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectAuthTokenService.findBy({
        query: {
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceProjectId: data.tenantId,
        },
        select: {
          _id: true,
          miscData: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const projectAuth of projectAuths) {
      const miscData: MicrosoftTeamsMiscData = {
        ...((projectAuth.miscData as MicrosoftTeamsMiscData) || {}),
      } as MicrosoftTeamsMiscData;

      if (!miscData.installedTeams || !miscData.installedTeams[data.teamId]) {
        continue;
      }

      const installedTeams: Record<string, MicrosoftTeamsInstalledTeam> = {
        ...miscData.installedTeams,
      };
      delete installedTeams[data.teamId];
      miscData.installedTeams = installedTeams;

      await WorkspaceProjectAuthTokenService.updateOneById({
        id: projectAuth.id!,
        data: {
          miscData: miscData,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  @CaptureSpan()
  public static async getInstalledTeamsForProject(data: {
    projectId: ObjectID;
  }): Promise<Record<string, MicrosoftTeamsInstalledTeam>> {
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    if (!projectAuth || !projectAuth.miscData) {
      return {};
    }

    return (
      (projectAuth.miscData as MicrosoftTeamsMiscData).installedTeams || {}
    );
  }

  /**
   * Process Bot Framework activity using the botbuilder SDK adapter.processActivity
   * This replaces the manual JWT validation and activity handling with proper SDK methods
   */
  @CaptureSpan()
  public static async processBotActivity(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    logger.debug(
      "Processing Bot Framework activity using adapter.processActivity",
    );
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
      const adapter: CloudAdapter = this.getBotAdapter();

      // Create custom activity handler class that extends TeamsActivityHandler
      class OneUptimeTeamsActivityHandler extends TeamsActivityHandler {
        public constructor() {
          super();

          // Set up message handlers using the proper API
          this.onMessage(
            async (context: TurnContext, next: () => Promise<void>) => {
              logger.debug(
                "Handling message activity: " +
                  JSON.stringify(context.activity),
              );
              await MicrosoftTeamsUtil.handleBotMessageActivity({
                activity: context.activity as unknown as JSONObject,
                turnContext: context,
              });
              await next();
            },
          );

          this.onMembersAdded(
            async (context: TurnContext, next: () => Promise<void>) => {
              logger.debug(
                "Handling members added activity: " +
                  JSON.stringify(context.activity),
              );
              await MicrosoftTeamsUtil.handleConversationUpdateActivity({
                activity: context.activity as unknown as JSONObject,
                turnContext: context,
              });
              await next();
            },
          );

          this.onMembersRemoved(
            async (context: TurnContext, next: () => Promise<void>) => {
              logger.debug(
                "Handling members removed activity: " +
                  JSON.stringify(context.activity),
              );
              await MicrosoftTeamsUtil.handleConversationUpdateActivity({
                activity: context.activity as unknown as JSONObject,
                turnContext: context,
              });
              await next();
            },
          );

          this.onInstallationUpdateAdd(
            async (context: TurnContext, next: () => Promise<void>) => {
              logger.debug(
                "Handling installation update add activity: " +
                  JSON.stringify(context.activity),
              );
              await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
                activity: context.activity as unknown as JSONObject,
                turnContext: context,
              });
              await next();
            },
          );

          this.onInstallationUpdateRemove(
            async (context: TurnContext, next: () => Promise<void>) => {
              logger.debug(
                "Handling installation update remove activity: " +
                  JSON.stringify(context.activity),
              );
              await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
                activity: context.activity as unknown as JSONObject,
                turnContext: context,
              });
              await next();
            },
          );
        }

        protected override async onInvokeActivity(
          context: TurnContext,
        ): Promise<any> {
          logger.debug(
            "Handling invoke activity: " + JSON.stringify(context.activity),
          );
          await MicrosoftTeamsUtil.handleBotInvokeActivity({
            activity: context.activity as unknown as JSONObject,
            turnContext: context,
          });
          // Return empty response for invoke activities
          return { status: 200 };
        }
      }

      // Create activity handler instance
      const activityHandler: TeamsActivityHandler =
        new OneUptimeTeamsActivityHandler();

      // Use the adapter's process method with Express-style req/res
      await adapter.process(req, res, async (context: TurnContext) => {
        logger.debug(
          "Processing activity with TurnContext: " +
            JSON.stringify({
              activityType: context.activity.type,
              activityId: context.activity.id,
              from: context.activity.from?.name,
              conversationId: context.activity.conversation?.id,
            }),
        );

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

  private static buildWelcomeAdaptiveCard(): JSONObject {
    return {
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      type: "AdaptiveCard",
      version: "1.4",
      body: [
        {
          type: "TextBlock",
          text: "Welcome to OneUptime for Microsoft Teams",
          weight: "Bolder",
          size: "Large",
          wrap: true,
        },
        {
          type: "TextBlock",
          text: "OneUptime keeps your team ahead of incidents by streaming alerts, maintenance updates, and on-call context directly into Microsoft Teams.",
          wrap: true,
          spacing: "Small",
        },
        {
          type: "TextBlock",
          text: "Getting started",
          weight: "Bolder",
          size: "Medium",
          spacing: "Large",
          wrap: true,
        },
        {
          type: "TextBlock",
          text: "1. Connect this Teams workspace to your OneUptime project from **Settings → Integrations → Microsoft Teams**.\n2. Choose which incidents, alerts, and maintenance events should sync into Teams.\n3. Try the commands below or automate workflows from the OneUptime dashboard.",
          wrap: true,
        },
        {
          type: "TextBlock",
          text: "Bot commands",
          weight: "Bolder",
          size: "Medium",
          spacing: "Large",
          wrap: true,
        },
        {
          type: "FactSet",
          facts: [
            {
              title: "help",
              value: "Show quick help and useful links",
            },
            {
              title: "ask",
              value:
                "Ask OneUptime AI about your logs, traces, metrics, incidents and monitors",
            },
            {
              title: "create incident",
              value: "Create a new incident without leaving Teams",
            },
            {
              title: "create maintenance",
              value: "Schedule or review maintenance windows",
            },
            {
              title: "show active incidents",
              value: "List all incidents that are currently open",
            },
            {
              title: "show scheduled maintenance",
              value: "Display upcoming maintenance events",
            },
            {
              title: "show active alerts",
              value: "Summarize active alerts for your project",
            },
          ],
        },
        {
          type: "TextBlock",
          text: "To use this app, each user must have an active OneUptime account. Please contact our support team for more details.",
          wrap: true,
          spacing: "Large",
        },
        {
          type: "TextBlock",
          text: "Need more help?",
          weight: "Bolder",
          size: "Medium",
          spacing: "Large",
          wrap: true,
        },
        {
          type: "TextBlock",
          text: "Review our setup guide or reach out if you need assistance configuring notifications.",
          wrap: true,
        },
      ],
      actions: [
        {
          type: "Action.OpenUrl",
          title: "View Setup Guide",
          url: "https://oneuptime.com/docs/workspace-connections/microsoft-teams",
        },
        {
          type: "Action.OpenUrl",
          title: "Contact Support",
          url: "mailto:support@oneuptime.com?subject=OneUptime%20Microsoft%20Teams%20Bot",
        },
        {
          type: "Action.OpenUrl",
          title: "Open OneUptime Dashboard",
          url: "https://oneuptime.com/dashboard",
        },
      ],
    } as JSONObject;
  }

  private static async sendWelcomeAdaptiveCard(
    turnContext: TurnContext,
  ): Promise<void> {
    try {
      const hasAlreadySent: boolean = Boolean(
        turnContext.turnState.get(this.WELCOME_CARD_STATE_KEY),
      );

      if (hasAlreadySent) {
        logger.debug(
          "Welcome adaptive card already sent earlier in this turn, skipping duplicate send",
        );
        return;
      }

      const welcomeCard: JSONObject = this.buildWelcomeAdaptiveCard();
      const message: Partial<Activity> = MessageFactory.attachment({
        contentType: "application/vnd.microsoft.card.adaptive",
        content: welcomeCard,
      });

      await turnContext.sendActivity(message);
      turnContext.turnState.set(this.WELCOME_CARD_STATE_KEY, true);
      logger.debug("Welcome adaptive card sent successfully");
    } catch (error) {
      logger.error("Error sending welcome adaptive card: " + error);
    }
  }

  // Method to refresh teams list for a user
  @CaptureSpan()
  public static async refreshTeams(data: {
    projectId: ObjectID;
    // optional: prefer a user-scoped token when provided
    userId?: ObjectID;
    userAccessToken?: string;
  }): Promise<Record<string, { id: string; name: string }>> {
    logger.debug("=== refreshTeams called ===", {
      projectId: data.projectId?.toString(),
    });

    if (!data.projectId) {
      throw new BadDataException(
        "projectId is required to refresh Microsoft Teams teams",
      );
    }

    logger.debug(`Project ID: ${data.projectId.toString()}`);

    try {
      // Get project auth to get app access token
      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.getProjectAuth({
          projectId: data.projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        });

      if (!projectAuth || !projectAuth.miscData) {
        throw new BadDataException(
          "Microsoft Teams integration not found for this project",
        );
      }

      const tenantId: string | undefined = projectAuth.workspaceProjectId;

      if (!tenantId) {
        throw new BadDataException(
          "Microsoft Teams tenant ID not found for this project",
        );
      }

      // Use app-scoped token to fetch user's teams
      let allTeams: Array<JSONObject> = [];

      try {
        // Fetch joined teams using app-scoped token
        if (data.userId) {
          logger.debug("Using app-scoped token to fetch joined teams for user");
          allTeams = await this.getUserJoinedTeams({
            userId: data.userId,
            projectId: data.projectId,
          });
        }
      } catch (err) {
        logger.warn(
          "Failed to fetch teams using app-scoped token, falling back to paginated fetch:",
        );
        logger.warn(err);
        allTeams = [];
      }

      // If we couldn't obtain teams via user token, fall back to app-scoped token + existing behavior
      if (!allTeams || allTeams.length === 0) {
        // Get a valid app access token
        const accessToken: string | null = await this.refreshAccessToken({
          projectId: data.projectId,
          miscData: projectAuth.miscData as MicrosoftTeamsMiscData,
          tenantId,
        });

        if (!accessToken) {
          throw new BadDataException(
            "Could not obtain valid access token for Microsoft Teams",
          );
        }

        /*
         * Fetch all teams from Microsoft Graph API using app permissions
         * Handle pagination to get all teams
         */
        allTeams = [];
        let nextLink: string | null = "https://graph.microsoft.com/v1.0/teams";
        let pageCount: number = 0;
        const MAX_PAGES: number = MICROSOFT_TEAMS_MAX_PAGES; // Prevent infinite loop

        while (nextLink) {
          pageCount++;
          if (pageCount > MAX_PAGES) {
            logger.error(
              `Maximum page limit (${MAX_PAGES}) reached while paginating teams. Breaking out to prevent infinite loop.`,
            );
            break;
          }
          logger.debug(`Fetching teams page ${pageCount}: ${nextLink}`);

          const teamsResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
            await API.get<JSONObject>({
              url: URL.fromString(nextLink),
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            });

          if (teamsResponse instanceof HTTPErrorResponse) {
            logger.error("Error fetching teams from Microsoft Teams:", {
              projectId: data.projectId.toString(),
            });
            logger.error(teamsResponse);
            throw new BadDataException(
              "Failed to fetch teams from Microsoft Teams",
            );
          }

          const teams: Array<JSONObject> =
            (teamsResponse.data as any)["value"] || [];
          allTeams.push(...teams);

          // Check for next page
          nextLink = (teamsResponse.data as any)["@odata.nextLink"] || null;

          logger.debug(
            `Page ${pageCount}: Fetched ${teams.length} teams. Total so far: ${allTeams.length}`,
          );
        }
      }

      // Process teams
      const availableTeams: Record<string, { id: string; name: string }> =
        allTeams.reduce(
          (
            acc: Record<string, { id: string; name: string }>,
            t: JSONObject,
          ) => {
            const team: { id: string; name: string } = {
              id: t["id"] as string,
              name: (t["displayName"] as string) || "Unnamed Team",
            };
            /*
             * Keyed by id, not display name — Teams allows duplicate team
             * names, and keying by name silently collapsed them so only the
             * last one of each name was selectable.
             */
            acc[team.id] = team;
            return acc;
          },
          {} as Record<string, { id: string; name: string }>,
        );

      logger.debug(`Processed ${Object.keys(availableTeams).length} teams`);

      /*
       * Update project auth token with new teams. Re-read miscData first —
       * the snapshot from the start of this method is stale by the length
       * of the paginated Graph fetch, and writing it back verbatim would
       * erase concurrent updates (e.g. chats captured into availableChats
       * by bot install events, which cannot be re-derived).
       */
      let miscData: MicrosoftTeamsMiscData =
        (projectAuth.miscData as MicrosoftTeamsMiscData) || {};
      try {
        const latestProjectAuth: WorkspaceProjectAuthToken | null =
          await WorkspaceProjectAuthTokenService.getProjectAuth({
            projectId: data.projectId,
            workspaceType: WorkspaceType.MicrosoftTeams,
          });
        if (latestProjectAuth?.miscData) {
          miscData = latestProjectAuth.miscData as MicrosoftTeamsMiscData;
        }
      } catch (err) {
        logger.debug("Could not re-read miscData before teams refresh write");
        logger.debug(err);
      }
      miscData.availableTeams = availableTeams;
      miscData.tenantId = tenantId;

      await WorkspaceProjectAuthTokenService.updateOneById({
        id: projectAuth.id!,
        data: {
          miscData: miscData,
          workspaceProjectId: tenantId,
        },
        props: {
          isRoot: true,
        },
      });

      logger.debug("Updated project auth token with refreshed teams");

      return availableTeams;
    } catch (error) {
      logger.error("Error refreshing teams:", {
        projectId: data.projectId.toString(),
      });
      logger.error(error);
      throw error;
    }
  }

  // Method to get user's joined teams, preferring user-scoped delegated token
  @CaptureSpan()
  public static async getUserJoinedTeams(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<JSONObject>> {
    logger.debug("=== getUserJoinedTeams called ===", {
      projectId: data.projectId.toString(),
      userId: data.userId.toString(),
    });

    try {
      // Prefer user-scoped delegated token so we only need Team.ReadBasic.All delegated permission
      const userAuth: WorkspaceUserAuthToken | null =
        await WorkspaceUserAuthTokenService.getUserAuth({
          projectId: data.projectId,
          userId: data.userId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        });

      if (userAuth?.authToken) {
        logger.debug(
          "Using user-scoped delegated token to fetch joined teams via /me/joinedTeams",
        );
        const teamsResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get<JSONObject>({
            url: URL.fromString(
              "https://graph.microsoft.com/v1.0/me/joinedTeams",
            ),
            headers: {
              Authorization: `Bearer ${userAuth.authToken}`,
            },
          });

        if (teamsResponse instanceof HTTPErrorResponse) {
          logger.warn(
            "User-scoped token request failed, will fall back to app token:",
          );
          logger.warn(teamsResponse);
        } else {
          const teams: Array<JSONObject> =
            (teamsResponse.data["value"] as Array<JSONObject>) || [];
          logger.debug(`Fetched ${teams.length} joined teams via user scope`);
          return teams;
        }
      }

      // Fall back to app-scoped token with users/{email}/joinedTeams
      const user: User | null = await UserService.findOneById({
        id: data.userId,
        select: {
          email: true,
        },
        props: {
          isRoot: true,
        },
      });
      if (!user || !user.email) {
        throw new BadDataException(
          "User email not found for Microsoft Teams integration",
        );
      }
      const userEmail: string = user.email.toString();

      logger.debug(
        "Falling back to app-scoped token for users/{email}/joinedTeams",
      );
      const accessToken: string = await this.getValidAccessToken({
        authToken: "",
        projectId: data.projectId,
      });

      const teamsResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get<JSONObject>({
          url: URL.fromString(
            `https://graph.microsoft.com/v1.0/users/${userEmail}/joinedTeams`,
          ),
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

      if (teamsResponse instanceof HTTPErrorResponse) {
        logger.error("Error getting teams:");
        logger.error(teamsResponse);
        throw teamsResponse;
      }

      const teams: Array<JSONObject> =
        (teamsResponse.data["value"] as Array<JSONObject>) || [];
      logger.debug(
        `Fetched ${teams.length} joined teams via app-scoped fallback`,
      );
      return teams;
    } catch (error) {
      logger.error("Error getting user joined teams:", {
        projectId: data.projectId.toString(),
        userId: data.userId.toString(),
      });
      logger.error(error);
      throw error;
    }
  }

  @CaptureSpan()
  public static async getChannelMessages(params: {
    channelId: string;
    teamId: string;
    projectId: ObjectID;
    limit?: number;
    oldestTimestamp?: Date;
  }): Promise<
    Array<{
      messageId: string;
      text: string;
      userId?: string;
      username?: string;
      timestamp: Date;
      isBot: boolean;
    }>
  > {
    const messages: Array<{
      messageId: string;
      text: string;
      userId?: string;
      username?: string;
      timestamp: Date;
      isBot: boolean;
    }> = [];

    try {
      // Get valid access token
      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.getProjectAuth({
          projectId: params.projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        });

      if (!projectAuth || !projectAuth.miscData) {
        logger.error("Microsoft Teams integration not found for this project");
        return messages;
      }

      const miscData: JSONObject = projectAuth.miscData as JSONObject;
      const accessToken: string = miscData["appAccessToken"] as string;
      const tokenExpiresAt: string = miscData[
        "appAccessTokenExpiresAt"
      ] as string;

      // Check if token is expired
      if (
        !accessToken ||
        (tokenExpiresAt &&
          OneUptimeDate.isInThePast(OneUptimeDate.fromString(tokenExpiresAt)))
      ) {
        logger.debug(
          "Microsoft Teams access token expired or missing, skipping message fetch",
        );
        return messages;
      }

      // Fetch messages from Microsoft Teams channel
      let nextLink: string | undefined = undefined;
      const maxMessages: number = params.limit || 1000;
      const maxPages: number = 10;
      let pageCount: number = 0;

      do {
        let requestUrl: string;

        if (nextLink) {
          requestUrl = nextLink;
        } else {
          requestUrl = `https://graph.microsoft.com/v1.0/teams/${params.teamId}/channels/${params.channelId}/messages`;
          requestUrl += `?$top=${Math.min(50, maxMessages - messages.length)}`;
        }

        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get<JSONObject>({
            url: URL.fromString(requestUrl),
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            options: {
              retries: 2,
              exponentialBackoff: true,
            },
          });

        if (response instanceof HTTPErrorResponse) {
          logger.error(
            "Error response from Microsoft Teams API for channel messages:",
          );
          logger.error(response);
          break;
        }

        const jsonData: JSONObject = response.jsonData as JSONObject;
        const teamsMessages: Array<JSONObject> =
          (jsonData["value"] as Array<JSONObject>) || [];

        for (const msg of teamsMessages) {
          // Skip system messages
          if (msg["messageType"] !== "message") {
            continue;
          }

          const body: JSONObject = msg["body"] as JSONObject;
          let text: string = (body?.["content"] as string) || "";

          // Remove HTML tags if present (Teams uses HTML)
          text = text.replace(/<[^>]*>/g, "");
          text = text.trim();

          // Skip empty messages
          if (!text) {
            continue;
          }

          const from: JSONObject = msg["from"] as JSONObject;
          const user: JSONObject = from?.["user"] as JSONObject;
          const isBot: boolean = Boolean(from?.["application"]);

          const createdDateTime: string = msg["createdDateTime"] as string;
          const timestamp: Date = createdDateTime
            ? new Date(createdDateTime)
            : new Date();

          // Check if message is older than the oldest timestamp filter
          if (params.oldestTimestamp && timestamp < params.oldestTimestamp) {
            continue;
          }

          messages.push({
            messageId: msg["id"] as string,
            text: text,
            userId: user?.["id"] as string,
            username: user?.["displayName"] as string,
            timestamp: timestamp,
            isBot: isBot,
          });
        }

        nextLink = jsonData["@odata.nextLink"] as string;
        pageCount++;
      } while (
        nextLink &&
        messages.length < maxMessages &&
        pageCount < maxPages
      );

      logger.debug(
        `Retrieved ${messages.length} messages from Microsoft Teams channel ${params.channelId}`,
      );

      // Sort by timestamp (oldest first)
      messages.sort(
        (a: WorkspaceChannelMessage, b: WorkspaceChannelMessage) => {
          return a.timestamp.getTime() - b.timestamp.getTime();
        },
      );
    } catch (error) {
      logger.error(`Error fetching Microsoft Teams channel messages: ${error}`);
    }

    return messages;
  }
}
