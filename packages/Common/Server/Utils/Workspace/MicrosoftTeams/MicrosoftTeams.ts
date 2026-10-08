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
  WorkspacePayloadInlineImage,
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
import ScheduledMaintenanceStateService from "../../../Services/ScheduledMaintenanceStateService";
import IncidentStateService from "../../../Services/IncidentStateService";
import AlertStateService from "../../../Services/AlertStateService";

// Import user services
import User from "../../../../Models/DatabaseModels/User";
import UserService from "../../../Services/UserService";

// Import database utilities
import QueryHelper from "../../../Types/Database/QueryHelper";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import { truncateToLength } from "../../Database/TruncateColumnValue";

// Bot Framework SDK imports
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TeamsActivityHandler,
  TeamsInfo,
  TeamDetails,
  TeamsChannelAccount,
  TeamsPagedMembersResult,
  TurnContext,
  ConversationParameters,
  ConversationReference,
  MessageFactory,
  ConfigurationBotFrameworkAuthenticationOptions,
  Activity,
  ResourceResponse,
} from "botbuilder";
import { ExpressRequest, ExpressResponse } from "../../Express";
import MicrosoftTeamsServiceUrl from "./MicrosoftTeamsServiceUrl";
// Teams action handlers and types
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAccountNotLinkedException,
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
import MicrosoftTeamsActivityDeduplicator from "./MicrosoftTeamsActivityDeduplicator";
import MicrosoftTeamsCreateCommands from "./MicrosoftTeamsCreateCommands";
import MicrosoftTeamsMessageSize, {
  MICROSOFT_TEAMS_INCOMING_WEBHOOK_BUDGET_IN_BYTES,
} from "./MicrosoftTeamsMessageSize";
import MicrosoftTeamsReplies from "./MicrosoftTeamsReplies";
import MicrosoftTeamsInlineImages from "./MicrosoftTeamsInlineImages";
import WorkspaceInlineImages from "../WorkspaceInlineImages";
import ChatInlineImages from "../../../../Utils/Markdown/ChatInlineImages";
import { replacePipeTables } from "../../../../Utils/Markdown/PipeTables";

/*
 * AI Ops - observability assistant imports. These power the natural-language
 * "ask" experience where a Teams user can question the OneUptime AI about
 * their logs, traces, metrics, incidents and monitors.
 */
import type { ObservabilityAssistantResult } from "../../AI/Chat/ObservabilityAssistant";
import WorkspaceActionAuthorization from "../WorkspaceActionAuthorization";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import AIService, {
  AI_DISABLED_MESSAGE,
  getProjectDailyLimitMessage,
  ProjectAiDailyLimitStatus,
} from "../../../Services/AIService";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { AIChatCitation } from "../../../../Types/AI/AIChatTypes";
import FeedMarkdown, {
  mdText,
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * A Markdown link, [text](url), as an incoming webhook's MessageCard turns it
 * into a button. Only a link Markdown itself would read: a "[" written as
 * "\[" - a title or a name escaped where it was placed (MarkdownEscape) - opens
 * no link, and a "]" written as "\]" does not end the link's text. A "["
 * after an even run of backslashes ("\\[") is not escaped: the backslashes
 * are a literal one, and a link follows. So text that only looks like a link
 * stays text, as it does in every other place the message is shown.
 *
 * Read in one pass (findMessageCardLinks), as the regular expression
 *
 *   /(?<!(?:^|[^\\])(?:\\\\)*\\)\[((?:[^\]\\]|\\.)+)\]\(([^)]+)\)/g
 *
 * read them - which looked for the end of every "[" through the rest of the
 * line: a line of "[[[" took 16 s to read on 64 KB.
 */
interface MessageCardLink {
  // Where the link starts ("[") and ends (after ")") in its line.
  start: number;
  end: number;
  // Its text, as written: escapes and all.
  text: string;
  url: string;
}

const LEFT_BRACKET: number = 0x5b;
const RIGHT_BRACKET: number = 0x5d;
const LEFT_PARENTHESIS: number = 0x28;
const RIGHT_PARENTHESIS: number = 0x29;
const BACKSLASH_CODE: number = 0x5c;

// What "." in a regular expression does not match: a line terminator.
const isLineTerminator: (code: number) => boolean = (code: number): boolean => {
  return (
    code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029
  );
};

type FindMessageCardLinksFunction = (line: string) => Array<MessageCardLink>;

/*
 * The links of a line (see MessageCardLink), left to right. For each
 * position, where a link's text starting there ends is found once, from the
 * line's end: at the first "]" a backslash does not escape, its text read
 * as the expression reads it - a backslash and the character after it as
 * one, and a backslash with nothing it can take after it ending the text
 * where no link can follow.
 */
const findMessageCardLinks: FindMessageCardLinksFunction = (
  line: string,
): Array<MessageCardLink> => {
  const links: Array<MessageCardLink> = [];

  if (line.indexOf("[") === -1) {
    return links;
  }

  const length: number = line.length;
  // Where a text starting at each position ends ("]"), or -1.
  const textEnd: Int32Array = new Int32Array(length + 2).fill(-1);
  // The first ")" at or after each position, or -1.
  const nextRightParenthesis: Int32Array = new Int32Array(length + 2).fill(-1);

  for (let index: number = length - 1; index >= 0; index--) {
    const code: number = line.charCodeAt(index);

    nextRightParenthesis[index] =
      code === RIGHT_PARENTHESIS ? index : nextRightParenthesis[index + 1]!;

    if (code === RIGHT_BRACKET) {
      textEnd[index] = index;
    } else if (code === BACKSLASH_CODE) {
      textEnd[index] =
        index + 1 < length && !isLineTerminator(line.charCodeAt(index + 1))
          ? textEnd[index + 2]!
          : -1;
    } else {
      textEnd[index] = textEnd[index + 1]!;
    }
  }

  let backslashesBefore: number = 0;
  let index: number = 0;

  while (index < length) {
    const code: number = line.charCodeAt(index);

    if (code !== LEFT_BRACKET) {
      backslashesBefore = code === BACKSLASH_CODE ? backslashesBefore + 1 : 0;
      index++;
      continue;
    }

    // A "[" an odd run of backslashes escapes opens nothing.
    const isEscaped: boolean = backslashesBefore % 2 === 1;
    backslashesBefore = 0;

    const close: number = textEnd[index + 1]!;

    if (
      isEscaped ||
      close <= index + 1 ||
      line.charCodeAt(close + 1) !== LEFT_PARENTHESIS
    ) {
      index++;
      continue;
    }

    const urlEnd: number = nextRightParenthesis[close + 2]!;

    if (urlEnd === -1) {
      // No ")" is left in the line: no link can end in it.
      break;
    }

    if (urlEnd === close + 2) {
      index++;
      continue;
    }

    links.push({
      start: index,
      end: urlEnd + 1,
      text: line.slice(index + 1, close),
      url: line.slice(close + 2, urlEnd),
    });
    index = urlEnd + 1;
    backslashesBefore = 0;
  }

  return links;
};

type WithLinksAsTextFunction = (
  line: string,
  links: Array<MessageCardLink>,
) => string;

// The line with each of its links replaced by the link's text.
const withLinksAsText: WithLinksAsTextFunction = (
  line: string,
  links: Array<MessageCardLink>,
): string => {
  if (links.length === 0) {
    return line;
  }

  let text: string = "";
  let copiedUpTo: number = 0;

  for (const link of links) {
    text += line.slice(copiedUpTo, link.start) + link.text;
    copiedUpTo = link.end;
  }

  return text + line.slice(copiedUpTo);
};

interface MessageCardFact {
  name: string;
  value: string;
}

type FindFactFunction = (line: string) => MessageCardFact | null;

/*
 * A fact, "**Label:** value", as /\*\*(.*?):\*\*\s*(.*)/ read it - which
 * scanned the rest of the line from every "**" for a ":**": a line of
 * "*" took seconds. Read with indexOf instead, the same way: the label runs
 * from the first "**" to the first ":**" after it with no line terminator
 * between ("." takes none), and the value is the rest of that line once the
 * whitespace after the ":**" - line terminators too, as "\s" takes them -
 * is passed.
 */
const findFact: FindFactFunction = (line: string): MessageCardFact | null => {
  let segmentStart: number = 0;

  while (segmentStart <= line.length) {
    let segmentEnd: number = segmentStart;

    while (
      segmentEnd < line.length &&
      !isLineTerminator(line.charCodeAt(segmentEnd))
    ) {
      segmentEnd++;
    }

    const segment: string = line.slice(segmentStart, segmentEnd);
    const open: number = segment.indexOf("**");
    const close: number = open === -1 ? -1 : segment.indexOf(":**", open + 2);

    if (close !== -1) {
      let valueStart: number = segmentStart + close + 3;

      while (
        valueStart < line.length &&
        /\s/.test(line.charAt(valueStart))
      ) {
        valueStart++;
      }

      let valueEnd: number = valueStart;

      while (
        valueEnd < line.length &&
        !isLineTerminator(line.charCodeAt(valueEnd))
      ) {
        valueEnd++;
      }

      return {
        name: segment.slice(open + 2, close),
        value: line.slice(valueStart, valueEnd),
      };
    }

    segmentStart = segmentEnd + 1;
  }

  return null;
};

// A CommonMark backslash escape: a backslash before ASCII punctuation.
const MARKDOWN_BACKSLASH_ESCAPE_PATTERN: RegExp = /\\([!-/:-@[-`{-~])/g;

/*
 * A line (already trimmed) that opens or closes a fence: three or more
 * backticks or tildes - as leniently as FeedMarkdown.aiWritten finds
 * one, so code that keeps its characters there is shown as code here.
 */
const MESSAGE_CARD_FENCE_PATTERN: RegExp = /^(`{3,}|~{3,})/;

type GetMessageCardFenceOpeningFunction = (line: string) => string | null;

/*
 * The fence a line (already trimmed) opens - its run of backticks or tildes
 * - or null. A backtick fence's info string has no backtick in it: "```x```
 * y" is inline code, not a fence.
 */
const getMessageCardFenceOpening: GetMessageCardFenceOpeningFunction = (
  line: string,
): string | null => {
  const fence: RegExpExecArray | null = MESSAGE_CARD_FENCE_PATTERN.exec(line);

  if (!fence) {
    return null;
  }

  const run: string = fence[1]!;

  if (run.startsWith("`") && line.slice(fence[0].length).includes("`")) {
    return null;
  }

  return run;
};

type EscapeMessageCardCodeFunction = (text: string) => string;

type EscapeMessageCardCellFunction = (cell: string) => string;

// A table row's cells: split at each "|" that is not escaped.
const MESSAGE_CARD_CELL_SEPARATOR_PATTERN: RegExp = /(?<!\\)\|/;

/*
 * A line of fenced code as a MessageCard section shows it: the characters
 * HTML would read escaped, so "<img ...>" or a comment in it is text.
 */
const escapeMessageCardCode: EscapeMessageCardCodeFunction = (
  text: string,
): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

/*
 * A table cell in a MessageCard's HTML table. Teams reads no Markdown
 * inside the table, so the cell's Markdown escapes are undone - the text
 * reads as written - and what HTML would read is escaped: a "<img ...>" in a
 * name stays those characters.
 */
const escapeMessageCardCell: EscapeMessageCardCellFunction = (
  cell: string,
): string => {
  return escapeMessageCardCode(
    cell.replace(MARKDOWN_BACKSLASH_ESCAPE_PATTERN, "$1"),
  );
};

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
 * Whether the OneUptime Teams app is installed in a given team.
 *
 * Unknown is a first-class outcome, not an error: checking installation needs a
 * Graph permission that deployments connected before it was documented have not
 * consented to, and a tenant that answers "I won't tell you" must never be
 * reported to an admin as "the app is not installed".
 *
 * PermissionDenied is that same "I won't tell you", separated out because it is
 * the one flavour of Unknown the admin can fix in a minute — Microsoft is not
 * failing, it is refusing, and it names the grant that would stop it. Folding it
 * in with transport errors is what left admins reading a list of four possible
 * causes when OneUptime could have told them which one it was.
 */
export enum MicrosoftTeamsAppInstallState {
  Installed = "Installed",
  NotInstalled = "NotInstalled",
  PermissionDenied = "PermissionDenied",
  Unknown = "Unknown",
}

/*
 * The Graph application permission that lets OneUptime read a team's installed
 * apps, and so tell "the app is missing" apart from "the app is there but is a
 * different package".
 *
 * Server-side error text builds off this constant. The setup documentation and
 * the docs site still spell it out literally, because prose there explains the
 * permission rather than just naming it — if you rename it here, grep for the
 * literal too.
 */
export const MICROSOFT_TEAMS_INSTALL_READ_PERMISSION: string =
  "TeamsAppInstallation.ReadForTeam.All";

/*
 * The resource-specific (per chat) permission that lets OneUptime read a group
 * chat's name (its Graph "topic") with the app-only token. Bot Framework
 * activities from group chats do not reliably carry the name, so without this
 * a group chat can only be named after its members. It is granted per chat
 * when the app is installed or updated there with a manifest that requests it.
 * (The tenant-wide Chat.ReadBasic.WhereInstalled application permission works
 * with the same call, for admins who would rather grant it once.)
 */
export const MICROSOFT_TEAMS_CHAT_TOPIC_READ_PERMISSION: string =
  "ChatSettings.Read.Chat";

export enum MicrosoftTeamsChatTopicLookupStatus {
  Found = "Found", // the chat has a name in Teams.
  NoTopic = "NoTopic", // the chat exists but nobody has named it.
  PermissionDenied = "PermissionDenied",
  Unknown = "Unknown",
}

export interface MicrosoftTeamsChatTopicLookup {
  status: MicrosoftTeamsChatTopicLookupStatus;
  topic?: string | undefined; // set only when status is Found.
}

export interface MicrosoftTeamsChatNameRefreshResult {
  // The project's chats as stored once the refresh has been written.
  chats: Record<string, MicrosoftTeamsChat>;
  // Group chats whose name Microsoft refused to share (permission missing).
  permissionDeniedChatIds: Array<string>;
  // Group chats whose name could not be read for any other reason.
  failedChatIds: Array<string>;
}

// A chat's name and the Teams name it was built from, as Refresh Chats writes them.
export interface MicrosoftTeamsChatNameUpdate {
  name: string;
  topic?: string | undefined; // absent: the chat has no name in Teams.
}

// How many Graph chat lookups Refresh Chats runs at once.
const MICROSOFT_TEAMS_CHAT_TOPIC_LOOKUP_CONCURRENCY: number = 5;

/*
 * Per-lookup ceiling. Concurrent refreshes of a project share one run, so a
 * lookup that never answers would otherwise hold every later Refresh Chats
 * for that project.
 */
const MICROSOFT_TEAMS_CHAT_TOPIC_LOOKUP_TIMEOUT_IN_MS: number = 15000;

/*
 * Chat names are kept well under the 100-character ShortText columns that
 * store them in notification logs — Teams chat names can be much longer.
 */
const MICROSOFT_TEAMS_CHAT_NAME_MAX_LENGTH: number = 80;

// How many member names a group chat named after its members shows.
const MICROSOFT_TEAMS_CHAT_NAME_MEMBERS_SHOWN: number = 3;

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

// Bot commands that open a form; text after them becomes the form's title.
const CREATE_INCIDENT_COMMAND: string = "create incident";
const CREATE_MAINTENANCE_COMMAND: string = "create maintenance";

// How many affected monitors a "show ..." reply names for one item.
const MICROSOFT_TEAMS_MAX_AFFECTED_MONITOR_NAMES: number = 10;

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

    /*
     * The Graph app token is the row's authToken and its expiry is
     * authTokenExpiresAt, both server-only columns. It used to be cached in
     * miscData as well, which every project Viewer can read.
     */
    const cachedToken: string | undefined = projectAuth.authToken;
    const cachedTokenExpiresAt: Date | undefined =
      projectAuth.authTokenExpiresAt || undefined;
    const hasCachedToken: boolean = Boolean(
      cachedToken && cachedToken.includes("."),
    );

    logger.debug(`Cached app access token exists: ${hasCachedToken}`);
    logger.debug(
      `Cached app access token expires at: ${
        cachedTokenExpiresAt
          ? OneUptimeDate.toString(cachedTokenExpiresAt)
          : "unknown"
      }`,
    );

    let isCachedTokenExpired: boolean = false;

    if (hasCachedToken && cachedTokenExpiresAt) {
      const now: Date = OneUptimeDate.getCurrentDate();
      isCachedTokenExpired = OneUptimeDate.isAfter(now, cachedTokenExpiresAt);
      const secondsToExpiry: number =
        OneUptimeDate.getSecondsTo(cachedTokenExpiresAt);
      logger.debug(`Token expires in ${secondsToExpiry} seconds`);
      logger.debug(`Token is expired: ${isCachedTokenExpired}`);

      // Refresh when already expired or expiring within the next 5 minutes.
      if (!isCachedTokenExpired && secondsToExpiry > 300) {
        logger.debug(
          "Using cached app access token for Microsoft Graph API call",
        );
        return cachedToken!;
      }

      logger.debug(
        "Access token is expired or expiring soon, attempting to refresh",
      );
    } else if (hasCachedToken) {
      /*
       * No recorded expiry: the connection predates authTokenExpiresAt. The
       * token may be long dead, so mint a fresh one (which records its
       * expiry) instead of handing it out unchecked.
       */
      logger.debug(
        "App access token has no recorded expiry, attempting to refresh",
      );
    } else {
      logger.debug("No valid app access token found, attempting to refresh");
    }

    const newToken: string | null = await this.refreshAccessToken({
      projectId: data.projectId,
      tenantId,
    });

    if (newToken) {
      logger.debug("Successfully refreshed token");
      return newToken;
    }

    // A token we know has expired is useless; one that may still work is not.
    if (hasCachedToken && !isCachedTokenExpired) {
      logger.warn("Failed to refresh token, falling back to cached token");
      return cachedToken!;
    }

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
       * Only the token columns are written. miscData is readable by every
       * project Viewer, so the token must never go there, and rewriting
       * miscData from a copy taken before the OAuth round-trip would erase
       * chats captured into availableChats by bot install events meanwhile.
       */
      logger.debug("Saving updated token to database");
      await WorkspaceProjectAuthTokenService.saveRefreshedAuthToken({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceProjectId: data.tenantId,
        authToken: newAccessToken,
        authTokenExpiresAt: expiryDate,
      });

      logger.debug("Microsoft Teams access token refreshed successfully");
      logger.debug(
        `New token expires at: ${OneUptimeDate.toString(expiryDate)}`,
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
    // Tables are found in one pass over the lines (Utils/Markdown/PipeTables).
    return replacePipeTables(
      markdown,
      (lines: Array<string>): string => {

        // Parse header row
        const headerLine: string = lines[0] || "";
        const headers: Array<string> = headerLine
          .split(MESSAGE_CARD_CELL_SEPARATOR_PATTERN)
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
          html += `<th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2; text-align: left;"><strong>${escapeMessageCardCell(header)}</strong></th>`;
        }
        html += "</tr>";

        // Data rows
        for (const row of dataRows) {
          const cells: Array<string> = row
            .split(MESSAGE_CARD_CELL_SEPARATOR_PATTERN)
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
            html += `<td style="border: 1px solid #ddd; padding: 8px;">${escapeMessageCardCell(cell)}</td>`;
          }
          html += "</tr>";
        }

        html += "</table>";

        return html;
      },
    );
  }

  private static buildMessageCardFromMarkdown(markdown: string): JSONObject {
    /*
     * An incoming webhook's card cannot carry a screenshot's base64 (and a
     * Teams webhook refuses a message that large): an image whose address
     * is a data: URL is its alt text. The card is measured as it is sent,
     * whatever the size of its text - a table that fits as Markdown can be
     * HTML several times as big - and when it is more than an incoming
     * webhook takes (MICROSOFT_TEAMS_INCOMING_WEBHOOK_BUDGET_IN_BYTES) its
     * text is cut, in proportion and with a note, until the card fits
     * (fitMarkdownText). A card that fits is the card it always was.
     */
    let lastCard: { markdown: string; card: JSONObject } | null = null;

    // The card for a text, built once however often it is measured.
    const buildCard: (fitted: string) => JSONObject = (
      fitted: string,
    ): JSONObject => {
      if (!lastCard || lastCard.markdown !== fitted) {
        lastCard = {
          markdown: fitted,
          card: this.buildMessageCardFromFittedMarkdown(fitted),
        };
      }

      return lastCard.card;
    };

    const fittedMarkdown: string = MicrosoftTeamsMessageSize.fitMarkdownText(
      ChatInlineImages.toText(markdown),
      (fitted: string): number => {
        return MicrosoftTeamsMessageSize.getIncomingWebhookSizeInBytes(
          buildCard(fitted),
        );
      },
      MICROSOFT_TEAMS_INCOMING_WEBHOOK_BUDGET_IN_BYTES,
    );

    return buildCard(fittedMarkdown);
  }

  private static buildMessageCardFromFittedMarkdown(
    markdownWithoutInlineImages: string,
  ): JSONObject {
    /*
     * Teams MessageCard has limited markdown support. Headings like '##' are not supported
     * and single newlines can collapse. Convert common patterns to a structured card.
     */

    // First, convert markdown tables to HTML
    const markdownWithHtmlTables: string = this.convertMarkdownTablesToHtml(
      markdownWithoutInlineImages,
    );

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

    /*
     * Extract title from the first non-empty line and strip markdown heading
     * markers - unless that line opens a fence: then the card has no title
     * line, and the fence is read below like any other.
     */
    if (
      lines.length > 0 &&
      getMessageCardFenceOpening(lines[0] ?? "") === null
    ) {
      const firstLine: string = lines[0] ?? "";
      title = firstLine
        .replace(/^#+\s*/, "") // remove leading markdown headers like ##
        .replace(/^\*\*|\*\*$/g, "") // remove stray bold markers if any
        .trim();
      // Remove markdown link syntax from title for cleaner rendering
      title = withLinksAsText(title, findMessageCardLinks(title));
      // Sanitize unmatched bold markers if any remain
      const boldCountTitle: number = (title.match(/\*\*/g) || []).length;
      if (boldCountTitle % 2 !== 0) {
        title = title.replace(/\*\*/g, "");
      }
      lines.shift();
    }

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

    /*
     * Fenced code - a command, a snippet, a log line - is shown as it is. A
     * MessageCard has no code blocks, so a "[text](url)" in one would become
     * a button and an "<img>" or a comment in one HTML: its lines are
     * escaped for HTML and kept out of the buttons and the facts.
     */
    let openFenceRun: string | null = null;

    for (const line of lines) {
      const fence: RegExpExecArray | null =
        MESSAGE_CARD_FENCE_PATTERN.exec(line);
      const afterFence: string = fence ? line.slice(fence[0].length) : "";

      if (openFenceRun !== null) {
        if (
          fence &&
          fence[1]![0] === openFenceRun[0] &&
          fence[1]!.length >= openFenceRun.length &&
          afterFence.trim() === ""
        ) {
          openFenceRun = null;
        }

        bodyTextParts.push(escapeMessageCardCode(line));
        continue;
      }

      const opening: string | null = getMessageCardFenceOpening(line);

      if (opening !== null) {
        openFenceRun = opening;
        bodyTextParts.push(escapeMessageCardCode(line));
        continue;
      }

      // Extract links to actions and keep link display text in-place (without markdown)
      const links: Array<MessageCardLink> = findMessageCardLinks(line);

      for (const link of links) {
        // The button's name is plain text: an escape in the link's text is undone.
        const name: string = link.text.replace(
          MARKDOWN_BACKSLASH_ESCAPE_PATTERN,
          "$1",
        );
        actions.push({
          ["@type"]: "OpenUri",
          name: name,
          targets: [
            {
              os: "default",
              uri: link.url,
            },
          ],
        });
      }

      /*
       * Replace the markdown link with just its text to preserve sentence
       * flow. The section is read as Markdown, so the text stays as it was
       * written, escapes and all: unescaped, a title's "[x](...)" would turn
       * into a link there.
       */
      const lineWithoutLinks: string = withLinksAsText(line, links).trim();

      // Parse facts of the form **Label:** value
      const factMatch: MessageCardFact | null = findFact(lineWithoutLinks);

      if (factMatch) {
        const name: string = factMatch.name.trim();
        const value: string = factMatch.value.trim();
        if (
          name.toLowerCase() === "description" ||
          name.toLowerCase() === "note"
        ) {
          // Both parts come out of the Markdown line: they stay Markdown.
          bodyTextParts.push(
            mdText`**${FeedMarkdown.asMarkdown(name)}:** ${FeedMarkdown.asMarkdown(value)}`.toString(),
          );
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
      /*
       * The summary is plain text (Teams shows it in notifications and the
       * activity feed), so the Markdown escapes the title was written with
       * are undone there: it reads as the title was typed.
       */
      summary: title.replace(MARKDOWN_BACKSLASH_ESCAPE_PATTERN, "$1"),
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

  /*
   * Sends a 1:1 message to a Teams user as the OneUptime bot, addressed by the
   * user's Microsoft Entra object id (which is what WorkspaceUserAuthToken
   * stores as workspaceUserId).
   *
   * This cannot go through sendDirectMessageToUser above: that method posts to
   * Graph's /chats/{chatId}/messages, which needs an existing chat id and a
   * delegated token. A personal chat between the bot and the user may not
   * exist yet, so this uses the Bot Framework's createConversation, which
   * resolves (or creates) the 1:1 conversation from the member's Entra id -
   * provided the OneUptime app is installed for that user. When the personal
   * chat was already captured from a bot activity, it is reused instead, which
   * also preserves the regional serviceUrl captured with it.
   */
  @CaptureSpan()
  public static async sendDirectMessageToUserAsBot(data: {
    projectId: ObjectID;
    workspaceUserId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): Promise<void> {
    const adaptiveCard: JSONObject = this.buildAdaptiveCardFromMessageBlocks({
      messageBlocks: data.messageBlocks,
    });

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

    /*
     * Prefer a personal chat that was already captured from a bot activity:
     * it is known-deliverable and carries the regional serviceUrl.
     */
    const capturedPersonalChat: MicrosoftTeamsChat | undefined = Object.values(
      miscData.availableChats || {},
    ).find((chat: MicrosoftTeamsChat) => {
      return (
        chat.chatType === "personal" &&
        (chat.memberAadObjectIds || []).includes(data.workspaceUserId)
      );
    });

    if (capturedPersonalChat) {
      await this.sendAdaptiveCardToChat({
        chatId: capturedPersonalChat.id,
        projectId: data.projectId,
        adaptiveCard: adaptiveCard,
      });
      return;
    }

    /*
     * No captured personal chat - create (or resolve) the 1:1 conversation
     * proactively. A regional serviceUrl captured from any prior activity is
     * preferred; the commercial-cloud global endpoint is the fallback. Only
     * Microsoft hosts are considered (see MicrosoftTeamsServiceUrl).
     */
    const serviceUrl: string = MicrosoftTeamsServiceUrl.firstTrustedOrDefault([
      ...Object.values(miscData.availableChats || {}).map(
        (chat: MicrosoftTeamsChat) => {
          return chat.serviceUrl;
        },
      ),
      ...Object.values(miscData.installedTeams || {}).map(
        (team: MicrosoftTeamsInstalledTeam) => {
          return team.serviceUrl;
        },
      ),
    ]);

    const adapter: CloudAdapter = this.getBotAdapter();

    const conversationParameters: ConversationParameters = {
      isGroup: false,
      // 28:<appId> is the Teams-side bot account id.
      bot: {
        id: `28:${MicrosoftTeamsAppClientId}`,
        name: "OneUptime Bot",
      },
      // Teams accepts the member's Microsoft Entra object id here.
      members: [
        {
          id: data.workspaceUserId,
          name: "",
        },
      ],
      tenantId: tenantId,
      channelData: {
        tenant: {
          id: tenantId,
        },
      },
    };

    try {
      await adapter.createConversationAsync(
        MicrosoftTeamsAppClientId,
        "msteams",
        serviceUrl,
        undefined as unknown as string,
        conversationParameters,
        async (context: TurnContext) => {
          const message: Partial<Activity> = MessageFactory.attachment({
            contentType: "application/vnd.microsoft.card.adaptive",
            content: adaptiveCard,
          });

          await context.sendActivity(message);
        },
      );
    } catch (error) {
      logger.error(
        "Error sending Microsoft Teams direct message via Bot Framework:",
        {
          projectId: data.projectId.toString(),
        },
      );
      logger.error(error);

      /*
       * Microsoft's roster rejection is meaningless to the person being paged.
       * For a 1:1 conversation it means the OneUptime app is not installed for
       * this user, so say exactly that.
       */
      if (this.isBotNotInConversationRosterError(error)) {
        throw new BadDataException(
          "The OneUptime app is not installed for this Microsoft Teams user. Ask them to add the OneUptime app in Microsoft Teams (personal scope) so the bot can message them directly.",
        );
      }

      throw error;
    }
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
     *
     * A screenshot in the message's Markdown is shown as an image of its
     * own, where the Markdown had it (WorkspaceInlineImages). Each card that
     * shows one is built a second time with each image as its alt text, to
     * send instead if Teams refuses the first.
     */
    const maxBlocksPerCard: number = 40;
    const allMessageBlocks: Array<WorkspaceMessageBlock> =
      WorkspaceInlineImages.splitMessageBlocks(
        data.workspaceMessagePayload.messageBlocks,
      );

    const adaptiveCards: Array<JSONObject> = [];
    const adaptiveCardsWithoutImages: Array<JSONObject | null> = [];

    for (
      let i: number = 0;
      i < Math.max(allMessageBlocks.length, 1);
      i += maxBlocksPerCard
    ) {
      const chunk: Array<WorkspaceMessageBlock> = allMessageBlocks.slice(
        i,
        i + maxBlocksPerCard,
      );
      const adaptiveCard: JSONObject = this.buildAdaptiveCardFromMessageBlocks({
        messageBlocks: chunk,
        showInlineImages: true,
      });

      adaptiveCards.push(adaptiveCard);
      adaptiveCardsWithoutImages.push(
        MicrosoftTeamsInlineImages.hasImage(adaptiveCard)
          ? this.buildAdaptiveCardFromMessageBlocks({ messageBlocks: chunk })
          : null,
      );
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
          error: WorkspaceBase.getSendErrorMessage(err),
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
        for (let index: number = 0; index < adaptiveCards.length; index++) {
          lastThread = await this.sendCardShowingImagesIfTeamsTakesThem({
            adaptiveCard: adaptiveCards[index]!,
            adaptiveCardWithoutImages: adaptiveCardsWithoutImages[index]!,
            destination: channel.id,
            send: (adaptiveCard: JSONObject): Promise<WorkspaceThread> => {
              return this.sendAdaptiveCardToChannel({
                authToken: data.authToken,
                teamId: data.workspaceMessagePayload.teamId!,
                workspaceChannel: channel,
                adaptiveCard: adaptiveCard,
                projectId: data.projectId,
              });
            },
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
          error: WorkspaceBase.getSendErrorMessage(e),
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
          for (let index: number = 0; index < adaptiveCards.length; index++) {
            lastThread = await this.sendCardShowingImagesIfTeamsTakesThem({
              adaptiveCard: adaptiveCards[index]!,
              adaptiveCardWithoutImages: adaptiveCardsWithoutImages[index]!,
              destination: chatId,
              send: (adaptiveCard: JSONObject): Promise<WorkspaceThread> => {
                return this.sendAdaptiveCardToChat({
                  chatId: chatId,
                  adaptiveCard: adaptiveCard,
                  projectId: data.projectId,
                });
              },
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
            error: WorkspaceBase.getSendErrorMessage(e),
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

  /*
   * Sends a card that may show images. When Teams refuses it in a way the
   * images can have caused (MicrosoftTeamsInlineImages), the same card with
   * each image as its alt text is sent instead; a card without images, or a
   * refusal for anything else, is the caller's to handle as before.
   */
  private static async sendCardShowingImagesIfTeamsTakesThem(data: {
    adaptiveCard: JSONObject;
    adaptiveCardWithoutImages: JSONObject | null;
    destination: string;
    send: (adaptiveCard: JSONObject) => Promise<WorkspaceThread>;
  }): Promise<WorkspaceThread> {
    try {
      return await data.send(data.adaptiveCard);
    } catch (error) {
      if (
        !data.adaptiveCardWithoutImages ||
        !MicrosoftTeamsInlineImages.mayBeRefusedForImages(error)
      ) {
        throw error;
      }

      logger.warn(
        `Microsoft Teams refused a card with images for ${data.destination} (${MicrosoftTeamsReplies.describeError(error)}); sending it with each image as its alt text.`,
      );

      return await data.send(data.adaptiveCardWithoutImages);
    }
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

    /*
     * Declared out here so the catch block can tell a rejection we predicted
     * from one we could not, and word the error accordingly.
     */
    let installState: MicrosoftTeamsAppInstallState =
      MicrosoftTeamsAppInstallState.Unknown;
    let installStateCameFromGraph: boolean = false;

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
       * Preflight. Channels are discovered with tenant-wide Graph application
       * permissions, which see every team regardless of installation — so
       * reaching this point proves nothing about whether we can actually post.
       *
       * An install we recorded from a bot activity is the cheap positive
       * signal, and it also carries the serviceUrl this send needs. When we
       * have no record we ask Graph rather than assuming: absence from
       * installedTeams used to be reported to admins as "the app is not
       * installed", which is a claim install events alone cannot support (they
       * only arrive for installs that happened while OneUptime was reachable).
       * Only a verified negative refuses the send; anything we cannot verify
       * goes to Microsoft, which is the real authority.
       */
      const installedTeam: MicrosoftTeamsInstalledTeam | undefined =
        this.indexInstalledTeamsByGraphTeamId(miscData.installedTeams)[
          data.teamId
        ];

      if (installedTeam) {
        installState = MicrosoftTeamsAppInstallState.Installed;
      } else {
        installState = await this.isAppInstalledInTeam({
          authToken: data.authToken,
          projectId: data.projectId,
          teamId: data.teamId,
        });
        installStateCameFromGraph = true;

        if (installState === MicrosoftTeamsAppInstallState.NotInstalled) {
          throw new BadDataException(
            this.getBotNotInTeamMessage({
              channelName: data.workspaceChannel.name,
              membershipType: data.workspaceChannel.membershipType,
            }),
          );
        }
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
         * matching what sendAdaptiveCardToChat already does. A stored URL
         * that is not a Microsoft host is refused.
         */
        serviceUrl: MicrosoftTeamsServiceUrl.resolve(installedTeam?.serviceUrl),
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
       * not part of the conversation roster"). Replace it with something
       * actionable — but only claim the app is missing from the team when we
       * checked and it is. Otherwise the app can be installed exactly as
       * documented and still be told to install it, which is how this error
       * sent admins in circles.
       */
      if (this.isBotNotInConversationRosterError(error)) {
        /*
         * A local install record got us past the preflight without asking
         * Graph, and it can be stale — the app may have been removed from the
         * team since, and an uninstall event only reaches us if OneUptime was
         * reachable at the time. So confirm before wording the error. This is
         * the failure path, so the extra call costs nothing in normal operation.
         */
        let verifiedInstallState: MicrosoftTeamsAppInstallState = installState;

        if (!installStateCameFromGraph) {
          verifiedInstallState = await this.isAppInstalledInTeam({
            authToken: data.authToken,
            projectId: data.projectId,
            teamId: data.teamId,
          });
        }

        if (
          verifiedInstallState === MicrosoftTeamsAppInstallState.NotInstalled
        ) {
          throw new BadDataException(
            this.getBotNotInTeamMessage({
              channelName: data.workspaceChannel.name,
              membershipType: data.workspaceChannel.membershipType,
            }),
          );
        }

        throw new BadDataException(
          this.getRosterRejectionMessage({
            channelName: data.workspaceChannel.name,
            membershipType: data.workspaceChannel.membershipType,
            installState: verifiedInstallState,
            microsoftError: error,
          }),
        );
      }

      throw error;
    }
  }

  /*
   * The most recently active threads of a channel, raw Graph chatMessage
   * objects with their replies expanded, reactions included. Graph orders
   * threads by the last change anywhere in them — and adding a reaction is a
   * change — so the first page holds every thread that was just reacted to.
   *
   * Reads with the app token, which the ChannelMessage.Read.Group
   * resource-specific permission in the OneUptime Teams app lets into the
   * channels of teams the app is installed in. Throws on a Graph error.
   */
  @CaptureSpan()
  public static async getRecentChannelMessagesWithReplies(data: {
    authToken: string;
    projectId: ObjectID;
    teamId: string;
    channelId: string;
    top?: number | undefined;
  }): Promise<Array<JSONObject>> {
    if (!data.teamId || !data.channelId) {
      throw new BadDataException(
        "teamId and channelId are required to read Microsoft Teams channel messages",
      );
    }

    const accessToken: string = await this.getValidAccessToken({
      authToken: data.authToken,
      projectId: data.projectId,
    });

    const top: number = Math.min(Math.max(data.top || 50, 1), 50);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get<JSONObject>({
        url: URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(
            data.teamId,
          )}/channels/${encodeURIComponent(data.channelId)}/messages?$top=${top}&$expand=replies`,
        ),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error reading Microsoft Teams channel messages:", {
        projectId: data.projectId.toString(),
        channelId: data.channelId,
        teamId: data.teamId,
      });
      logger.error(response);
      throw response;
    }

    return (
      ((response.jsonData as JSONObject)?.["value"] as
        | Array<JSONObject>
        | undefined) || []
    );
  }

  /*
   * Posts a plain (markdown) message as a reply in a channel thread, as the
   * bot. `parentMessageId` is the id of the thread's first message.
   */
  @CaptureSpan()
  public static async sendTextReplyToChannelThread(data: {
    projectId: ObjectID;
    teamId: string;
    channelId: string;
    parentMessageId: string;
    text: string;
  }): Promise<void> {
    if (!MicrosoftTeamsAppClientId) {
      throw new BadDataException(
        "Microsoft Teams App Client ID not configured",
      );
    }

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
        "Tenant ID not found in Microsoft Teams integration",
      );
    }

    const miscData: MicrosoftTeamsMiscData =
      projectAuth.miscData as MicrosoftTeamsMiscData;

    const installedTeam: MicrosoftTeamsInstalledTeam | undefined =
      this.indexInstalledTeamsByGraphTeamId(miscData.installedTeams)[
        data.teamId
      ];

    const conversationReference: ConversationReference = {
      bot: {
        id: MicrosoftTeamsAppClientId,
        name: "OneUptime Bot",
      },
      conversation: {
        // A channel conversation id with ;messageid= addresses that thread.
        id: `${data.channelId};messageid=${data.parentMessageId}`,
        isGroup: true,
        conversationType: "channel",
        tenantId: tenantId,
      } as ConversationReference["conversation"],
      channelId: "msteams",
      serviceUrl: MicrosoftTeamsServiceUrl.resolve(installedTeam?.serviceUrl),
    };

    const adapter: CloudAdapter = this.getBotAdapter();

    await adapter.continueConversationAsync(
      MicrosoftTeamsAppClientId,
      conversationReference,
      async (context: TurnContext) => {
        await context.sendActivity({
          type: "message",
          text: data.text,
          textFormat: "markdown",
        });
      },
    );
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
    /*
     * "Not installed" here means no installed app carries THIS deployment's
     * app id — which is also what a OneUptime tile from the Teams store looks
     * like. Saying only "add OneUptime" to an admin who is looking straight at
     * a OneUptime tile reads as nonsense and sends them round the loop again,
     * so name that case explicitly.
     */
    const wrongPackageNote: string = `If a tile named OneUptime is already listed there, it is a different package — the app from the Teams store points at OneUptime Cloud's bot and will never accept posts from this deployment. Remove it, then upload the manifest from Project Settings > Workspace > Microsoft Teams, which is the only package built with this deployment's MICROSOFT_TEAMS_APP_CLIENT_ID.`;

    /*
     * No wrong-package note for private channels. The install check reads
     * /teams/{id}/installedApps — team scope — and a private channel needs its
     * own channel-scope install, so a correct channel install still reads as
     * "not installed" here. Telling that admin their package is the wrong one
     * and to remove it would destroy a working install to fix nothing.
     */
    if (data.membershipType === "private") {
      return `The OneUptime app is not installed in the private channel "${data.channelName}". In Microsoft Teams, open the channel, click the "..." menu, then Manage channel > Apps > Add an app, and add OneUptime. Installing OneUptime in the parent team does not cover private channels.`;
    }

    return `The OneUptime app is not installed in the Microsoft Teams team that owns "${data.channelName}". In Microsoft Teams, click the "..." next to the team name, then Manage team > Apps > More apps, and add OneUptime. Installing OneUptime for yourself or in a chat is not the same as adding it to the team. ${wrongPackageNote}`;
  }

  /*
   * Microsoft rejected the post and we could not confirm why. Everything here
   * is a real cause of that rejection for an app that IS present in the team's
   * app list, which is the case getBotNotInTeamMessage got wrong: the app tile
   * showing up in Manage team > Apps does not mean the bot behind it is the one
   * this deployment authenticates as. Microsoft's own wording is included so
   * the raw error is not lost in the rewrite.
   */
  public static getRosterRejectionMessage(data: {
    channelName: string;
    membershipType?: string | undefined;
    installState: MicrosoftTeamsAppInstallState;
    microsoftError?: unknown;
  }): string {
    const causes: Array<string> = [];

    if (data.membershipType === "private") {
      causes.push(
        `"${data.channelName}" is a private channel, which needs the app installed into the channel itself (channel "..." > Manage channel > Apps > Add an app) — a team-level install does not cover it`,
      );
    } else if (data.installState === MicrosoftTeamsAppInstallState.Installed) {
      /*
       * Graph confirmed a package carrying THIS deployment's app id is in the
       * team, so the usual suspect — a OneUptime package from somewhere else —
       * is largely ruled out and should not lead. "Largely", not "entirely":
       * the check matches teamsApp.externalId, which is the manifest id, and
       * only OneUptime's own generator guarantees that equals the bot id. A
       * hand-edited manifest can satisfy this and still carry a foreign bot, so
       * the wording stays probabilistic rather than promising the admin the
       * package is fine.
       */
      causes.push(
        "the app installed in this team already matches this deployment's MICROSOFT_TEAMS_APP_CLIENT_ID, so the package is probably not the problem — the most likely remaining cause is the Azure Bot resource, below",
      );
    } else {
      causes.push(
        'the OneUptime app has not been added to this team (team "..." > Manage team > Apps > More apps), or the app that was added is a different package whose bot id is not this deployment\'s MICROSOFT_TEAMS_APP_CLIENT_ID',
      );
    }

    causes.push(
      "the Azure Bot resource for this deployment does not have the Microsoft Teams channel enabled",
    );

    /*
     * The list above is a guess, and it only has to be a guess because Graph
     * would not tell us. Say so, and say what turns it into an answer — this is
     * the single cheapest step an admin reading this can take.
     *
     * The promise is hedged for private channels: the grant unlocks a
     * team-scope read, and for a private channel the deciding fact is the
     * channel-scope install, which that read cannot see. Worth granting anyway,
     * just not worth promising it settles this particular send.
     */
    const suffixHint: string =
      data.installState === MicrosoftTeamsAppInstallState.PermissionDenied
        ? data.membershipType === "private"
          ? ` OneUptime could not narrow this down because Microsoft Graph denied the installed-apps check: granting the ${MICROSOFT_TEAMS_INSTALL_READ_PERMISSION} application permission to this deployment's app registration restores that check for team-level installs, though a private channel's own install still has to be confirmed in Microsoft Teams.`
          : ` OneUptime could not narrow this down because Microsoft Graph denied the installed-apps check: grant the ${MICROSOFT_TEAMS_INSTALL_READ_PERMISSION} application permission to this deployment's app registration, re-grant admin consent, and try again to be told which cause it is.`
        : "";

    const microsoftMessage: string =
      data.microsoftError instanceof Error
        ? data.microsoftError.message
        : String(data.microsoftError || "");

    const suffix: string = microsoftMessage
      ? ` Microsoft's response was: "${microsoftMessage}"`
      : "";

    return `Microsoft Teams refused the message to "${data.channelName}" because the OneUptime bot is not a member of that conversation. Likely causes: ${causes.join("; ")}.${suffixHint}${suffix}`;
  }

  /*
   * True when Graph refused a read rather than failing it.
   *
   * 403 only, deliberately. Graph answers a missing application permission with
   * 403 and reserves 401 for a token it would not accept — an expired secret, a
   * cached app token that went stale early (see getValidAccessToken, which
   * falls back to the stored token when a refresh fails). Treating 401 as
   * a permission problem would send an admin off to grant a Graph permission
   * when their credential had simply gone stale, which is the same species of
   * wrong-but-confident answer this whole diagnostic exists to stop producing.
   *
   * The error codes are still matched at any status, so a permission refusal
   * that arrives with an unexpected status is not missed.
   */
  public static isGraphPermissionDeniedResponse(
    response: HTTPErrorResponse,
  ): boolean {
    if (response.statusCode === 403) {
      return true;
    }

    const message: string = (response.message || "").toLowerCase();

    if (!message) {
      return false;
    }

    return [
      "authorization_requestdenied",
      "accessdenied",
      "insufficient privileges",
    ].some((fragment: string) => {
      return message.includes(fragment);
    });
  }

  /*
   * Asks Graph whether this deployment's Teams app is installed in a team.
   *
   * Matching is on teamsApp.externalId, which is the manifest id — and the
   * manifest OneUptime generates sets both that and the bot id to
   * MICROSOFT_TEAMS_APP_CLIENT_ID. So this answers the question that actually
   * matters ("is the app THIS deployment authenticates as installed here?"),
   * not the weaker one an admin can answer by eye ("is something called
   * OneUptime in the app list?").
   *
   * No failure is ever reported as NotInstalled. The call needs
   * TeamsAppInstallation.ReadForTeam.All, which deployments connected before it
   * was documented have not granted, and a missing permission must not be
   * reported as a missing install. A refusal comes back as PermissionDenied so
   * the admin is told which grant to add; everything else is Unknown.
   */
  @CaptureSpan()
  public static async isAppInstalledInTeam(data: {
    authToken: string;
    projectId: ObjectID;
    teamId: string;
  }): Promise<MicrosoftTeamsAppInstallState> {
    if (!MicrosoftTeamsAppClientId) {
      return MicrosoftTeamsAppInstallState.Unknown;
    }

    try {
      const accessToken: string = await this.getValidAccessToken({
        authToken: data.authToken,
        projectId: data.projectId,
      });

      let nextLink: string | null =
        `https://graph.microsoft.com/v1.0/teams/${data.teamId}/installedApps?$expand=teamsApp`;
      let pageCount: number = 0;

      while (nextLink) {
        pageCount++;

        if (pageCount > MICROSOFT_TEAMS_MAX_PAGES) {
          logger.warn(
            `Stopped paginating installed apps for team ${data.teamId} after ${MICROSOFT_TEAMS_MAX_PAGES} pages.`,
          );
          return MicrosoftTeamsAppInstallState.Unknown;
        }

        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get({
            url: URL.fromString(nextLink),
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          });

        if (response instanceof HTTPErrorResponse) {
          /*
           * A refusal is not a failure. That distinction is the whole value of
           * this call: it is the difference between "we cannot tell you which of
           * four causes this is" and "grant this one permission and we will tell
           * you".
           */
          if (this.isGraphPermissionDeniedResponse(response)) {
            logger.warn(
              `Cannot read installed apps for team ${data.teamId}: Microsoft Graph denied the request. Grant the ${MICROSOFT_TEAMS_INSTALL_READ_PERMISSION} application permission to this app registration and re-grant admin consent so OneUptime can verify Teams app installs.`,
            );
            return MicrosoftTeamsAppInstallState.PermissionDenied;
          }

          logger.debug(
            `Could not read installed apps for team ${data.teamId}; treating installation as unknown.`,
          );
          logger.debug(response);
          return MicrosoftTeamsAppInstallState.Unknown;
        }

        const installedApps: Array<JSONObject> =
          (response.data["value"] as Array<JSONObject>) || [];

        for (const installedApp of installedApps) {
          const teamsApp: JSONObject =
            (installedApp["teamsApp"] as JSONObject) || {};

          if (teamsApp["externalId"] === MicrosoftTeamsAppClientId) {
            return MicrosoftTeamsAppInstallState.Installed;
          }
        }

        nextLink = (response.data["@odata.nextLink"] as string) || null;
      }

      return MicrosoftTeamsAppInstallState.NotInstalled;
    } catch (err) {
      logger.debug(
        `Error checking whether the OneUptime app is installed in team ${data.teamId}; treating installation as unknown.`,
      );
      logger.debug(err);
      return MicrosoftTeamsAppInstallState.Unknown;
    }
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
         * A stored URL that is not a Microsoft host is refused.
         */
        serviceUrl: MicrosoftTeamsServiceUrl.resolve(chat.serviceUrl),
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
    /*
     * Whether the card shows the message's inline images
     * (MicrosoftTeamsInlineImages). Without, or past what a card carries,
     * each is its alt text.
     */
    showInlineImages?: boolean | undefined;
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
    let imageCount: number = 0;
    let imageBytes: number = 0;

    for (const block of data.messageBlocks) {
      logger.debug(`Processing message block of type: ${block._type}`);

      if (block._type === "WorkspacePayloadInlineImage") {
        const inlineImage: WorkspacePayloadInlineImage =
          block as WorkspacePayloadInlineImage;

        if (
          data.showInlineImages &&
          MicrosoftTeamsInlineImages.isShownByTeams(inlineImage.image) &&
          imageCount < MicrosoftTeamsInlineImages.MAX_IMAGES_PER_CARD &&
          imageBytes + inlineImage.image.byteLength <=
            MicrosoftTeamsInlineImages.MAX_IMAGE_BYTES_PER_CARD
        ) {
          imageCount++;
          imageBytes += inlineImage.image.byteLength;
          body.push(MicrosoftTeamsInlineImages.getImageElement(inlineImage));
        } else if (inlineImage.fallbackMarkdown) {
          body.push(
            this.getMarkdownBlock({
              payloadMarkdownBlock: {
                _type: "WorkspacePayloadMarkdown",
                text: inlineImage.fallbackMarkdown,
              },
            }),
          );
        }

        continue;
      }

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

    /*
     * Each text block fits on its own (getMarkdownBlock), but a card
     * carries many: the card is measured as it is sent, and one over what
     * Teams takes has its longest text blocks cut to fit (fitAdaptiveCard).
     */
    return MicrosoftTeamsMessageSize.fitAdaptiveCard(card);
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

  /*
   * A text block. An image whose address is a data: URL - a screenshot in a
   * description - is its alt text here: sendMessage shows it as an image of
   * its own before a markdown block gets here (WorkspaceInlineImages). A
   * text more than a message can carry, measured as it is sent, is cut,
   * with a note (fitMarkdownText).
   */
  @CaptureSpan()
  public static override getMarkdownBlock(data: {
    payloadMarkdownBlock: WorkspacePayloadMarkdown;
  }): JSONObject {
    return {
      type: "TextBlock",
      text: MicrosoftTeamsMessageSize.fitMarkdownText(
        ChatInlineImages.toText(data.payloadMarkdownBlock.text),
      ),
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
        onlyIfMissingOrStale: true,
      });
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

    // An Adaptive Card submit arrives as a message whose value names the action.
    const isCardSubmit: boolean = Boolean(
      (possibleActionValue["action"] as string) ||
        (possibleActionValue["data"] as any)?.["action"],
    );

    // Only respond to card submits, direct messages and @mentions.
    if (!isCardSubmit && !isDirectMessage && !isMentioned) {
      logger.debug("Bot not mentioned in channel message, ignoring");
      return;
    }

    /*
     * Teams delivers an activity again when the first delivery was slow or
     * failed. Handling it twice sends every reply twice and creates a
     * submitted incident twice, so only the first delivery is handled.
     */
    if (!(await MicrosoftTeamsActivityDeduplicator.claim(data.activity))) {
      logger.debug(
        "Microsoft Teams delivered this activity before; ignoring the repeat",
        {
          activityId: (data.activity["id"] as string) || "",
        },
      );
      return;
    }

    // If this is actually an Adaptive Card submit wrapped as a message, route to invoke handler
    if (isCardSubmit) {
      logger.debug(
        "Message activity contains action payload; routing to invoke handler",
      );
      await this.handleBotInvokeActivity({
        activity: data.activity,
        turnContext: data.turnContext,
      });
      return;
    }

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

    const isCreateIncidentCommand: boolean =
      cleanText === CREATE_INCIDENT_COMMAND ||
      cleanText.startsWith(CREATE_INCIDENT_COMMAND + " ");

    const isCreateMaintenanceCommand: boolean =
      cleanText === CREATE_MAINTENANCE_COMMAND ||
      cleanText.startsWith(CREATE_MAINTENANCE_COMMAND + " ");

    /*
     * Explicit commands are matched precisely so that natural-language
     * questions (which may incidentally contain words like "help" or
     * "alerts") fall through to the AI assistant instead of a canned command.
     */
    const isHelpCommand: boolean =
      cleanText === "help" || cleanText === "" || cleanText === "?";

    const isShowActiveIncidentsCommand: boolean =
      cleanText === "show active incidents" || cleanText === "active incidents";

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

    /*
     * The command, named for log lines that must not quote the message: a
     * free-form question can carry things that do not belong in a log.
     */
    const commandName: string | undefined = [
      { matches: isHelpCommand, name: "help" },
      { matches: isCreateIncidentCommand, name: CREATE_INCIDENT_COMMAND },
      { matches: isCreateMaintenanceCommand, name: CREATE_MAINTENANCE_COMMAND },
      { matches: isShowActiveIncidentsCommand, name: "show active incidents" },
      {
        matches: isShowScheduledMaintenanceCommand,
        name: "show scheduled maintenance",
      },
      {
        matches: isShowOngoingMaintenanceCommand,
        name: "show ongoing maintenance",
      },
      { matches: isShowActiveAlertsCommand, name: "show active alerts" },
      { matches: isAskCommand, name: "ask" },
    ].find((command: { matches: boolean; name: string }) => {
      return command.matches;
    })?.name;

    let projectId: ObjectID | undefined = undefined;
    let responseText: string = "";

    try {
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

      projectId = tenantResolution.projectAuth.projectId;
      logger.debug(
        `Found project ID: ${projectId.toString()} for tenant ID: ${tenantId}`,
      );

      if (isHelpCommand) {
        responseText = this.getHelpMessage();
      } else if (isCreateIncidentCommand) {
        // "create incident <title>" opens the form with the title filled in.
        logger.debug("Processing create incident command");
        await MicrosoftTeamsCreateCommands.handleCreateIncidentCommand({
          turnContext: data.turnContext,
          activity: data.activity,
          projectId: projectId,
          initialTitle: originalQuestionText
            .substring(CREATE_INCIDENT_COMMAND.length)
            .trim(),
        });
        return;
      } else if (isCreateMaintenanceCommand) {
        // "create maintenance <title>" opens the form with the title filled in.
        logger.debug("Processing create maintenance command");
        await MicrosoftTeamsCreateCommands.handleCreateScheduledMaintenanceCommand(
          {
            turnContext: data.turnContext,
            activity: data.activity,
            projectId: projectId,
            initialTitle: originalQuestionText
              .substring(CREATE_MAINTENANCE_COMMAND.length)
              .trim(),
          },
        );
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

      /*
       * Send response directly using TurnContext - this is the recommended Bot
       * Framework pattern. Lists grow with the project, so the text is kept
       * within what Teams accepts.
       */
      await data.turnContext.sendActivity(
        MicrosoftTeamsMessageSize.fitTextToBudget({ text: responseText }),
      );
      logger.debug("Bot message sent successfully using TurnContext", {
        projectId: projectId.toString(),
      });
    } catch (error) {
      /*
       * One reply, and no rethrow. This used to reply and then rethrow: the
       * adapter answered Teams with HTTP 500, Teams delivered the message
       * again, and every failure showed up twice (issue #4111).
       */
      /*
       * The command is named, not quoted: a free-form question can carry
       * things that do not belong in an error log. The text is in the debug
       * log above.
       */
      MicrosoftTeamsReplies.logFailure(
        `Microsoft Teams message ${(data.activity["id"] as string) || ""} (${
          commandName
            ? `"${commandName}"`
            : `a ${cleanText.length}-character question`
        }) failed`,
        error,
        {
          projectId: projectId?.toString(),
        },
      );
      await MicrosoftTeamsReplies.sendBestEffort(
        data.turnContext,
        this.getUnexpectedErrorMessage(data.activity),
      );
    }
  }

  /*
   * The reply to a message whose handling failed in a way nobody planned for.
   * It names the activity id, which the server log line carries too, so an
   * administrator can find what went wrong.
   */
  public static getUnexpectedErrorMessage(activity: JSONObject): string {
    const reference: string = (activity["id"] as string | undefined) || "";

    return `Sorry, something went wrong in OneUptime while handling that message. Please try again in a minute.${
      reference
        ? ` If it keeps happening, ask your OneUptime administrator to look for reference ${reference} in the server logs.`
        : ""
    }`;
  }

  /*
   * The last line of defence for an inbound activity whose handler threw.
   *
   * The error is logged and the turn ends normally, so CloudAdapter answers
   * Teams with 200. Letting the error through made CloudAdapter answer HTTP
   * 500, Teams delivered the activity again, and every reply the turn had
   * posted appeared twice (issue #4111). A message that got no reply yet gets
   * one; an invoke gets the response it needs, or CloudAdapter answers 501.
   *
   * This is deliberately not adapter.onTurnError: the same adapter sends
   * proactive notifications, and their callers need their errors thrown.
   */
  public static async recoverFromFailedTurn(data: {
    turnContext: TurnContext;
    error: unknown;
  }): Promise<void> {
    const { turnContext, error } = data;
    const activity: Partial<Activity> = turnContext.activity || {};

    MicrosoftTeamsReplies.logFailure(
      `Microsoft Teams ${activity.type || "unknown"} activity ${activity.id || ""} failed`,
      error,
    );

    if (activity.type === "message" && !turnContext.responded) {
      await MicrosoftTeamsReplies.sendBestEffort(
        turnContext,
        this.getUnexpectedErrorMessage(activity as unknown as JSONObject),
      );
      return;
    }

    if (activity.type === "invoke") {
      await MicrosoftTeamsReplies.sendBestEffort(turnContext, {
        type: "invokeResponse",
        value: { status: 200 },
      });
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
    return this.stripHtmlTags(rawContent.replace(/<at[^>]*>.*?<\/at>/g, ""))
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /*
   * Plain text out of a Teams message body, which Graph and the Bot Framework
   * hand over as HTML. Removing complete tags is not enough on its own: an
   * unclosed one ("<script" with no ">" after it) matches no tag pattern, so
   * once no tag is left, any "<" still standing goes too, and the text holds
   * no markup at all. The tag pass repeats until nothing changes - the shape
   * code scanning recognises as complete, where a single pass is reported as
   * incomplete multi-character sanitization. Teams sends a literal "<" in a
   * message as "&lt;", which is left encoded: decoding it here would hand
   * back what this removed.
   */
  public static stripHtmlTags(html: string): string {
    let text: string = html;
    let previous: string;

    do {
      previous = text;
      text = text.replace(/<[^>]*>/g, "");
    } while (text !== previous);

    return text.replace(/</g, "");
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
      // A failed lookup is not a missing account; the caller answers it.
      if (!(error instanceof MicrosoftTeamsAccountNotLinkedException)) {
        throw error;
      }

      logger.debug(
        "No OneUptime user linked to Teams user; prompting to connect account",
        {
          projectId: projectId.toString(),
          workspaceUserId: teamsUserId,
        },
      );
      await turnContext.sendActivity(
        await MicrosoftTeamsReplies.getAccountNotLinkedMessage({
          projectId: projectId,
          purpose: "ask OneUptime questions from Microsoft Teams",
        }),
      );
      return;
    }

    // The user's real permission props - the assistant's tools run under these.
    let props: DatabaseCommonInteractionProps;
    try {
      props = await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: oneUptimeUserId,
        projectId: projectId,
      });
    } catch (error) {
      // A linked Teams account whose user has since left the project.
      if (error instanceof NotAuthorizedException) {
        await turnContext.sendActivity(error.message);
        return;
      }

      throw error;
    }

    /*
     * The project's AI kill switch, read before we acknowledge. The catch
     * around the assistant below answers every failure with the same generic
     * "I ran into a problem" — true for a provider outage, actively wrong for
     * a setting somebody chose on purpose. Reading the switch here lets us
     * say what actually happened, and where to undo it.
     */
    if (!(await AIService.isProjectAIEnabled(projectId))) {
      logger.debug("AI Ops declined: AI is disabled for this project", {
        projectId: projectId.toString(),
      });
      await turnContext.sendActivity(AI_DISABLED_MESSAGE);
      return;
    }

    /*
     * The project's own daily AI limits, read before we acknowledge for the
     * same reason: past a limit, the generic "I ran into a problem" would be
     * wrong about a setting somebody chose on purpose.
     */
    const reachedDailyLimit: ProjectAiDailyLimitStatus | null =
      await AIService.getReachedProjectDailyLimit({ projectId });

    if (reachedDailyLimit) {
      logger.debug(
        "AI Ops declined: the project has reached its own daily AI limit",
        {
          projectId: projectId.toString(),
        },
      );
      await turnContext.sendActivity(
        getProjectDailyLimitMessage(reachedDailyLimit),
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

      /*
       * The answer is written from telemetry, which can carry text meant to
       * steer the model, and it is posted to a chat: it stays the Markdown
       * the model wrote, with no image, no link whose words hide where it
       * goes, no HTML tag and no mention in it, fenced code included
       * (FeedMarkdown.aiWrittenForTeams). A citation's label is text.
       */
      let replyText: MarkdownText = FeedMarkdown.aiWrittenForTeams(
        result.contentInMarkdown,
      );

      // Build a compact "Sources" footer from the server-minted citations.
      if (result.citations && result.citations.length > 0) {
        const sourceLines: Array<MarkdownText> = result.citations.map(
          (citation: AIChatCitation): MarkdownText => {
            return mdText`• ${FeedMarkdown.textWithCode(citation.label)} (${citation.rowCount} rows)`;
          },
        );
        replyText = mdText`${replyText}\n\n**Sources**\n${FeedMarkdown.join(sourceLines, "\n")}`;
      }

      await turnContext.sendActivity(replyText.toString());
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

  /*
   * The monitors an incident or maintenance event affects, as one line: the
   * first few names, then how many more. An event can cover hundreds of
   * monitors, and listing them all made the reply too large for Teams.
   */
  public static formatAffectedMonitorNames(
    monitors: Array<Monitor>,
  ): MarkdownText {
    const names: Array<string> = monitors
      .map((monitor: Monitor) => {
        return monitor.name || "";
      })
      .filter((name: string) => {
        return Boolean(name);
      });

    // Each name is plain text, placed into the summary's Markdown as text.
    const shownNames: Array<string> = names.slice(
      0,
      MICROSOFT_TEAMS_MAX_AFFECTED_MONITOR_NAMES,
    );
    const notShownCount: number = names.length - shownNames.length;

    return notShownCount > 0
      ? mdText`${FeedMarkdown.join(shownNames)} and ${notShownCount} more`
      : FeedMarkdown.join(shownNames);
  }

  // Helper methods for bot commands
  private static getHelpMessage(): string {
    return `Hello! I'm the OneUptime bot. I can help you with the following commands:

**Available Commands:**
- **help** - Show this help message
- **ask <question>** - Ask OneUptime AI about your logs, traces, metrics, incidents and monitors
- **create incident [title]** - Create a new incident
- **create maintenance [title]** - Create a new scheduled maintenance event
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

      let message: string =
        mdText`**Active Incidents** (${activeIncidents.length})

`.toString();

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

        /*
         * The title - plain text, which anyone holding an incident form's
         * link may have typed - sits inside the link's text, so every
         * Markdown character in it is escaped: a "]" cannot end that text
         * early and point the rest somewhere else, and "![...](...)" is no
         * image. Escaping brackets alone is not enough there: marked, for
         * one, undoes "\[" and "\]" in a link's text before reading it.
         */
        message += mdText`${severityIcon} **[Incident ${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber}: ${incident.title}](${incidentUrl.toString()})**
• **Severity:** ${severity}
• **Status:** ${state}
• **Declared:** ${declaredAtText}
`;

        if (incident.monitors && incident.monitors.length > 0) {
          message += mdText`• **Affected Services:** ${this.formatAffectedMonitorNames(
            incident.monitors,
          )}\n`;
        }

        if (incident.description) {
          const desc: string = ChatInlineImages.toText(
            incident.description,
          ).replace(/\s+/g, " ");
          message += mdText`• **Description:** ${FeedMarkdown.asMarkdown(desc.substring(0, 180))}${desc.length > 180 ? "..." : ""}\n`;
        }

        message += mdText`• [Open in Dashboard](${incidentUrl.toString()})\n\n`;
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

      let message: string =
        mdText`**Scheduled Maintenance Events** (${scheduledEvents.length})

`.toString();

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

        // The title inside the link's text, escaped as an incident's is.
        message += mdText`🛠️ **[Scheduled Maintenance ${event.scheduledMaintenanceNumberWithPrefix || "#" + event.scheduledMaintenanceNumber}: ${event.title}](${eventUrl.toString()})**
• **Status:** ${state}
• **Starts:** ${startTime}
• **Ends:** ${endTime}
`;

        if (event.monitors && event.monitors.length > 0) {
          message += mdText`• **Affected Services:** ${this.formatAffectedMonitorNames(
            event.monitors,
          )}\n`;
        }

        if (event.description) {
          const desc: string = ChatInlineImages.toText(
            event.description,
          ).replace(/\s+/g, " ");
          message += mdText`• **Description:** ${FeedMarkdown.asMarkdown(desc.substring(0, 180))}${desc.length > 180 ? "..." : ""}\n`;
        }

        message += mdText`• [View Event](${eventUrl.toString()})\n\n`;
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

      /*
       * The events in progress: in the project's ongoing state, or in a
       * state of the project's own placed between Ongoing and Ended, such as
       * "Verifying" (Common/Utils/ScheduledMaintenanceStart).
       */
      const inProgressStateIds: Array<ObjectID> =
        await ScheduledMaintenanceStateService.getInProgressScheduledMaintenanceStateIds(
          projectId,
        );

      const ongoingEvents: Array<ScheduledMaintenance> =
        inProgressStateIds.length === 0
          ? []
          : await ScheduledMaintenanceService.findBy({
              query: {
                projectId: projectId,
                currentScheduledMaintenanceStateId:
                  QueryHelper.any(inProgressStateIds),
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

      let message: string =
        mdText`**Ongoing Maintenance Events** (${ongoingEvents.length})

`.toString();

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

        // The title inside the link's text, escaped as an incident's is.
        message += mdText`🔧 **[Scheduled Maintenance ${event.scheduledMaintenanceNumberWithPrefix || "#" + event.scheduledMaintenanceNumber}: ${event.title}](${eventUrl.toString()})**
• **Status:** ${state}
• **Started:** ${startTime}
• **Expected End:** ${endTime}
`;

        if (event.monitors && event.monitors.length > 0) {
          message += mdText`• **Affected Services:** ${this.formatAffectedMonitorNames(
            event.monitors,
          )}\n`;
        }

        if (event.description) {
          const desc: string = ChatInlineImages.toText(
            event.description,
          ).replace(/\s+/g, " ");
          message += mdText`• **Description:** ${FeedMarkdown.asMarkdown(desc.substring(0, 180))}${desc.length > 180 ? "..." : ""}\n`;
        }

        message += mdText`• [View Event](${eventUrl.toString()})\n\n`;
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

      let message: string = mdText`**Active Alerts** (${activeAlerts.length})

`.toString();

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

        /*
         * The title - plain text, often filled in by a monitor from an
         * incoming email or request - sits inside the link's text, so every
         * Markdown character in it is escaped, as an incident's title is
         * above. The severity, state and monitor names are plain text too.
         */
        message += mdText`⚠️ **[Alert ${alert.alertNumberWithPrefix || "#" + alert.alertNumber}: ${alert.title}](${alertUrl.toString()})**
• **Severity:** ${severity}
• **Status:** ${state}
• **Triggered:** ${createdAt}
`;

        if (alert.monitor?.name) {
          message += mdText`• **Monitor:** ${alert.monitor.name}\n`;
        }

        if (alert.description) {
          const desc: string = ChatInlineImages.toText(
            alert.description,
          ).replace(/\s+/g, " ");
          message += mdText`• **Description:** ${FeedMarkdown.asMarkdown(desc.substring(0, 180))}${desc.length > 180 ? "..." : ""}\n`;
        }

        message += mdText`• [Open in Dashboard](${alertUrl.toString()})\n\n`;
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

    let projectId: ObjectID | undefined = undefined;

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

      projectId = tenantResolution.projectAuth.projectId;
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

      /*
       * Every action runs as a current member of the project, with that
       * member's own permissions. A linked Teams account outlives the
       * membership it was linked under, so the link alone proves nothing.
       * Throws NotAuthorizedException, answered in the catch below.
       */
      const databaseProps: DatabaseCommonInteractionProps =
        await WorkspaceActionAuthorization.getProjectMemberProps({
          userId: oneUptimeUserId,
          projectId: projectId,
        });

      // Handle incident actions
      if (MicrosoftTeamsIncidentActions.isIncidentAction({ actionType })) {
        await MicrosoftTeamsIncidentActions.handleBotIncidentAction({
          actionType,
          actionValue,
          value,
          projectId,
          oneUptimeUserId,
          databaseProps,
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
          databaseProps,
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
          databaseProps,
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
            databaseProps,
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
          databaseProps,
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
          databaseProps,
        );
        return;
      }

      // Handle on-call duty actions
      if (MicrosoftTeamsOnCallDutyActions.isOnCallDutyAction({ actionType })) {
        await MicrosoftTeamsOnCallDutyActions.handleBotOnCallDutyAction({
          actionType: actionType as MicrosoftTeamsOnCallDutyActionType,
          turnContext: data.turnContext,
          actionPayload: value,
          projectId: projectId,
          databaseProps: databaseProps,
        });
        return;
      }
    } catch (error) {
      /*
       * Every reply below is sent best-effort: a reply that fails here must
       * not escape, or the adapter answers Teams with HTTP 500 and Teams
       * delivers the action again (issue #4111).
       */

      // The account is not connected: say where to connect it.
      if (
        error instanceof MicrosoftTeamsAccountNotLinkedException &&
        projectId
      ) {
        logger.debug(
          "Bot invoke activity from a Teams user with no linked account",
          {
            actionType: actionType,
          },
        );
        await MicrosoftTeamsReplies.sendBestEffort(
          data.turnContext,
          await MicrosoftTeamsReplies.getAccountNotLinkedMessage({
            projectId: projectId,
            purpose: "use OneUptime actions in Microsoft Teams",
          }),
        );
        return;
      }

      // Tell the user why they were refused; the message is written for them.
      if (error instanceof NotAuthorizedException) {
        logger.debug("Bot invoke activity refused: " + error.message, {
          actionType: actionType,
        });
        await MicrosoftTeamsReplies.sendBestEffort(
          data.turnContext,
          error.message,
        );
        return;
      }

      MicrosoftTeamsReplies.logFailure(
        "Error handling bot invoke activity",
        error,
        {
          actionType: actionType,
          projectId: projectId?.toString(),
        },
      );

      const reason: string | null =
        MicrosoftTeamsReplies.getUserFacingErrorMessage(error);

      await MicrosoftTeamsReplies.sendBestEffort(
        data.turnContext,
        reason
          ? `Sorry, that action failed: ${reason}`
          : "Sorry, that action failed. Please try again later.",
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
    /*
     * How many members have a name, when memberNames holds only the first
     * few of them (as stored chats do). Defaults to memberNames' own count.
     */
    memberCount?: number | undefined;
  }): string {
    const truncate: (name: string) => string = (name: string): string => {
      if (name.length <= MICROSOFT_TEAMS_CHAT_NAME_MAX_LENGTH) {
        return name;
      }

      /*
       * Cut by UTF-16 code units, but never between the two halves of an
       * emoji: a lone surrogate makes Postgres refuse the whole jsonb write
       * that carries the name.
       */
      return `${truncateToLength(name, MICROSOFT_TEAMS_CHAT_NAME_MAX_LENGTH - 1)}…`;
    };

    if (data.topic && data.topic.trim()) {
      return truncate(data.topic.trim());
    }

    const memberNames: Array<string> = this.getNonBlankNames(data.memberNames);

    if (data.chatType === "personal") {
      return memberNames[0] ? truncate(`${memberNames[0]}`) : "Personal chat";
    }

    if (memberNames.length === 0) {
      return "Group chat";
    }

    const shownNames: Array<string> = memberNames.slice(
      0,
      MICROSOFT_TEAMS_CHAT_NAME_MEMBERS_SHOWN,
    );
    const memberCount: number = Math.max(
      data.memberCount || 0,
      memberNames.length,
    );
    const remainingCount: number = memberCount - shownNames.length;

    if (remainingCount > 0) {
      return truncate(`${shownNames.join(", ")} + ${remainingCount} more`);
    }

    return truncate(shownNames.join(", "));
  }

  private static getNonBlankNames(names: Array<string>): Array<string> {
    return names.filter((name: string) => {
      return Boolean(name && name.trim());
    });
  }

  /*
   * Builds the record to store for a chat that was just heard from, on top of
   * what is already stored. Whatever could not be read this time — the name
   * (Graph refused, failed, or was not asked) or the roster (the Bot Framework
   * call failed) — is taken from the stored record instead of being dropped:
   * a failed lookup must never turn a chat's real name back into member
   * names, or member names into a bare "Group chat".
   */
  public static buildCapturedChat(data: {
    chatId: string;
    chatType: MicrosoftTeamsChatType;
    serviceUrl?: string | undefined;
    // conversation.name from the activity, when Teams sent one.
    activityTopic?: string | undefined;
    // The Graph answer; undefined when Graph was not asked.
    topicLookup?: MicrosoftTeamsChatTopicLookup | undefined;
    // The chat's human members; null when the roster could not be read.
    roster: {
      memberNames: Array<string>;
      memberAadObjectIds: Array<string>;
    } | null;
    storedChat?: MicrosoftTeamsChat | undefined;
    now: string;
  }): MicrosoftTeamsChat {
    const storedChat: MicrosoftTeamsChat | undefined = data.storedChat;
    const activityTopic: string = (data.activityTopic || "").trim();
    const lookupStatus: MicrosoftTeamsChatTopicLookupStatus | undefined =
      data.topicLookup?.status;
    const topicCleared: boolean =
      !activityTopic &&
      lookupStatus === MicrosoftTeamsChatTopicLookupStatus.NoTopic;

    let topic: string | undefined = undefined;

    if (activityTopic) {
      topic = activityTopic;
    } else if (lookupStatus === MicrosoftTeamsChatTopicLookupStatus.Found) {
      topic = data.topicLookup?.topic;
    } else if (!topicCleared) {
      topic = storedChat?.topic; // not read this time: keep the last known name.
    }

    let memberNames: Array<string> | undefined = storedChat?.memberNames?.slice(
      0,
      MICROSOFT_TEAMS_CHAT_NAME_MEMBERS_SHOWN,
    );
    let memberCount: number | undefined = storedChat?.memberCount;
    let memberAadObjectIds: Array<string> =
      storedChat?.memberAadObjectIds || [];

    if (data.roster) {
      const names: Array<string> = this.getNonBlankNames(
        data.roster.memberNames,
      );
      memberNames = names.slice(0, MICROSOFT_TEAMS_CHAT_NAME_MEMBERS_SHOWN);
      memberCount = names.length;
      memberAadObjectIds = data.roster.memberAadObjectIds;
    }

    let name: string;

    if (topic || (memberNames && memberNames.length > 0)) {
      name = this.getChatDisplayName({
        chatType: data.chatType,
        topic: topic,
        memberNames: memberNames || [],
        memberCount: memberCount,
      });
    } else if (storedChat?.name && !(topicCleared && storedChat.topic)) {
      /*
       * Nothing to build a name from this time. The stored name is still the
       * best there is — unless it was the Teams name, and Teams just said the
       * chat no longer has one.
       */
      name = storedChat.name;
    } else {
      name = this.getChatDisplayName({
        chatType: data.chatType,
        memberNames: [],
      });
    }

    const chat: MicrosoftTeamsChat = {
      id: data.chatId,
      name: name,
      chatType: data.chatType,
      serviceUrl: data.serviceUrl,
      // When the chat was first connected; hearing from it again is not that.
      addedAt: storedChat?.addedAt || data.now,
      memberAadObjectIds: memberAadObjectIds,
    };

    if (topic) {
      chat.topic = topic;
    }

    if (memberNames !== undefined) {
      chat.memberNames = memberNames;
    }

    if (memberCount !== undefined) {
      chat.memberCount = memberCount;
    }

    return chat;
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

      /*
       * Personal chats captured before member Entra ids were recorded cannot
       * serve as direct-message targets — treat them as stale so the next
       * activity on the chat backfills the roster.
       */
      if (
        chat.chatType === "personal" &&
        (chat.memberAadObjectIds || []).length === 0
      ) {
        return false;
      }

      /*
       * Group chats captured before member counts were stored were also
       * captured before OneUptime asked Graph for their name. Re-capture
       * them once: that stores the roster (so the name can fall back to the
       * members if the chat's name is ever removed), and reads the name if
       * the chat already lets OneUptime read it. Chats the app was added to
       * with an older manifest only allow that once the app is updated in the
       * chat, which sends no activity — Refresh Chats picks the name up then.
       * A roster that could not be read leaves the count unset, so the next
       * message tries again.
       */
      if (chat.chatType === "groupChat" && chat.memberCount === undefined) {
        return false;
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
      const activityTopic: string =
        typeof conversation["name"] === "string"
          ? (conversation["name"] as string).trim()
          : "";

      // null when the roster could not be read.
      let roster: {
        memberNames: Array<string>;
        memberAadObjectIds: Array<string>;
      } | null = null;

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

        const humanMembers: Array<TeamsChannelAccount> = members.filter(
          (member: TeamsChannelAccount) => {
            return member.id !== botId;
          },
        );

        roster = {
          memberNames: humanMembers.map((member: TeamsChannelAccount) => {
            return member.name || "";
          }),
          /*
           * The Entra object id is what maps a chat member back to the
           * OneUptime user who connected that Teams account, so personal
           * chats can serve as direct-message delivery targets.
           */
          memberAadObjectIds: humanMembers
            .map((member: TeamsChannelAccount) => {
              return member.aadObjectId || "";
            })
            .filter((aadObjectId: string) => {
              return Boolean(aadObjectId);
            }),
        };
      } catch (err) {
        logger.debug("Could not fetch chat members for chat name resolution");
        logger.debug(err);
      }

      const tenantChat: {
        projectId: ObjectID | null;
        storedChat: MicrosoftTeamsChat | undefined;
      } = await this.getTenantChatContext({
        tenantId: tenantId,
        chatId: chatId,
      });

      /*
       * Teams does not reliably put a group chat's name on its activities, so
       * a named group chat would otherwise be listed by its members. Graph has
       * the name; ask it. Personal chats have no name to find.
       */
      let topicLookup: MicrosoftTeamsChatTopicLookup | undefined = undefined;

      if (chatType === "groupChat" && !activityTopic && tenantChat.projectId) {
        topicLookup = await this.getGroupChatTopicFromGraph({
          projectId: tenantChat.projectId,
          chatId: chatId,
        });
      }

      const chat: MicrosoftTeamsChat = this.buildCapturedChat({
        chatId: chatId,
        chatType: chatType,
        serviceUrl: activityServiceUrl,
        activityTopic: activityTopic,
        topicLookup: topicLookup,
        roster: roster,
        storedChat: tenantChat.storedChat,
        now: OneUptimeDate.getCurrentDate().toISOString(),
      });

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

  /*
   * What a bot activity needs to know about its tenant before storing a chat:
   * any project connected to the tenant (bot activities identify the tenant,
   * not the project, and every project of a tenant yields the same Graph app
   * token), and the chat as it is stored now, so a re-capture builds on it.
   *
   * A failed read throws: capturing without knowing what is stored would
   * overwrite a chat's real name with whatever this activity could supply.
   */
  private static async getTenantChatContext(data: {
    tenantId: string;
    chatId: string;
  }): Promise<{
    projectId: ObjectID | null;
    storedChat: MicrosoftTeamsChat | undefined;
  }> {
    let projectId: ObjectID | null = null;
    let storedChat: MicrosoftTeamsChat | undefined = undefined;

    const projectAuths: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectAuthTokenService.findBy({
        query: {
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceProjectId: data.tenantId,
        },
        select: {
          _id: true,
          projectId: true,
          miscData: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const projectAuth of projectAuths) {
      if (!projectId && projectAuth.projectId) {
        projectId = projectAuth.projectId;
      }

      if (!storedChat) {
        storedChat = (projectAuth.miscData as MicrosoftTeamsMiscData)
          ?.availableChats?.[data.chatId];
      }
    }

    return { projectId: projectId, storedChat: storedChat };
  }

  /*
   * Reads a group chat's name from Graph (GET /chats/{id}). Only group chats
   * are looked up: their Bot Framework conversation id is also their Graph
   * chat id, and they are the only chats that can be named.
   *
   * Never throws. A refusal comes back as PermissionDenied — the app-only
   * token needs ChatSettings.Read.Chat (granted per chat, and chats the app
   * was added to before the manifest requested it do not have it) or the
   * tenant-wide Chat.ReadBasic.WhereInstalled. Pass accessToken when looking
   * up many chats, so the token is fetched once rather than once per chat.
   */
  @CaptureSpan()
  public static async getGroupChatTopicFromGraph(data: {
    projectId: ObjectID;
    chatId: string;
    accessToken?: string | undefined;
  }): Promise<MicrosoftTeamsChatTopicLookup> {
    if (!data.chatId) {
      return { status: MicrosoftTeamsChatTopicLookupStatus.Unknown };
    }

    try {
      const accessToken: string =
        data.accessToken ||
        (await this.getValidAccessToken({
          authToken: "",
          projectId: data.projectId,
        }));

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get<JSONObject>({
          url: URL.fromString(
            `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(
              data.chatId,
            )}`,
          ),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          options: {
            timeout: MICROSOFT_TEAMS_CHAT_TOPIC_LOOKUP_TIMEOUT_IN_MS,
          },
        });

      if (response instanceof HTTPErrorResponse) {
        if (this.isGraphPermissionDeniedResponse(response)) {
          logger.debug(
            `Cannot read the name of Microsoft Teams chat ${data.chatId}: Microsoft Graph denied the request. The OneUptime app in that chat needs the ${MICROSOFT_TEAMS_CHAT_TOPIC_READ_PERMISSION} permission — update the app in the chat so Teams grants it.`,
          );
          return {
            status: MicrosoftTeamsChatTopicLookupStatus.PermissionDenied,
          };
        }

        /*
         * A 404 for a chat the bot is in would mean the Bot Framework
         * conversation id is not the Graph chat id — worth seeing in
         * production logs, unlike a passing throttle or outage.
         */
        if (response.statusCode === 404) {
          logger.warn(
            `Microsoft Graph has no chat with the id of Microsoft Teams chat ${data.chatId}, so its name cannot be read.`,
          );
        } else {
          logger.debug(`Could not read Microsoft Teams chat ${data.chatId}:`);
          logger.debug(response);
        }

        return { status: MicrosoftTeamsChatTopicLookupStatus.Unknown };
      }

      const topic: unknown = response.data?.["topic"];

      if (typeof topic === "string" && topic.trim()) {
        return {
          status: MicrosoftTeamsChatTopicLookupStatus.Found,
          topic: topic.trim(),
        };
      }

      return { status: MicrosoftTeamsChatTopicLookupStatus.NoTopic };
    } catch (err) {
      logger.debug(`Error reading Microsoft Teams chat ${data.chatId}:`);
      logger.debug(err);
      return { status: MicrosoftTeamsChatTopicLookupStatus.Unknown };
    }
  }

  // Refreshes in progress, by project: a second click joins the first.
  private static chatNameRefreshesInFlight: Map<
    string,
    Promise<MicrosoftTeamsChatNameRefreshResult>
  > = new Map();

  /*
   * What "Refresh Chats" does. Microsoft does not let an app list chats, but
   * it does let it read one it is in — so every stored group chat is re-read,
   * which fixes chats captured under their member names and picks up renames.
   *
   * A chat whose name was removed in Teams goes back to its member names when
   * they were stored with it; otherwise it keeps its current name, unless
   * that was the removed Teams name. A chat whose name could not be read is
   * left as it is and reported, so the page can say why.
   *
   * Concurrent refreshes of one project (within this App process) share a
   * single run, so a held-down button costs one pass over the chats, not one
   * per click.
   */
  public static async refreshChatNamesForProject(data: {
    projectId: ObjectID;
  }): Promise<MicrosoftTeamsChatNameRefreshResult> {
    const key: string = data.projectId.toString();

    const inFlight: Promise<MicrosoftTeamsChatNameRefreshResult> | undefined =
      this.chatNameRefreshesInFlight.get(key);

    if (inFlight) {
      return inFlight;
    }

    const refresh: Promise<MicrosoftTeamsChatNameRefreshResult> =
      this.runChatNameRefresh(data).finally(() => {
        this.chatNameRefreshesInFlight.delete(key);
      });

    this.chatNameRefreshesInFlight.set(key, refresh);

    return refresh;
  }

  @CaptureSpan()
  private static async runChatNameRefresh(data: {
    projectId: ObjectID;
  }): Promise<MicrosoftTeamsChatNameRefreshResult> {
    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    const storedChats: Record<string, MicrosoftTeamsChat> =
      (projectAuth?.miscData as MicrosoftTeamsMiscData | undefined)
        ?.availableChats || {};

    const result: MicrosoftTeamsChatNameRefreshResult = {
      chats: { ...storedChats },
      permissionDeniedChatIds: [],
      failedChatIds: [],
    };

    const tenantId: string | undefined = projectAuth?.workspaceProjectId;

    const groupChats: Array<MicrosoftTeamsChat> = Object.values(
      storedChats,
    ).filter((chat: MicrosoftTeamsChat) => {
      return Boolean(chat && chat.id && chat.chatType === "groupChat");
    });

    if (!tenantId || groupChats.length === 0) {
      return result;
    }

    /*
     * One token for every lookup. Without one nothing can be read, and that
     * is a failure the caller must see — not a refresh that silently changed
     * nothing.
     */
    const accessToken: string = await this.getValidAccessToken({
      authToken: "",
      projectId: data.projectId,
    });

    const updates: Record<string, MicrosoftTeamsChatNameUpdate> = {};

    for (
      let index: number = 0;
      index < groupChats.length;
      index += MICROSOFT_TEAMS_CHAT_TOPIC_LOOKUP_CONCURRENCY
    ) {
      const batch: Array<MicrosoftTeamsChat> = groupChats.slice(
        index,
        index + MICROSOFT_TEAMS_CHAT_TOPIC_LOOKUP_CONCURRENCY,
      );

      const lookups: Array<MicrosoftTeamsChatTopicLookup> = await Promise.all(
        batch.map((chat: MicrosoftTeamsChat) => {
          return this.getGroupChatTopicFromGraph({
            projectId: data.projectId,
            chatId: chat.id,
            accessToken: accessToken,
          });
        }),
      );

      batch.forEach((chat: MicrosoftTeamsChat, batchIndex: number) => {
        const lookup: MicrosoftTeamsChatTopicLookup = lookups[batchIndex]!;

        if (
          lookup.status === MicrosoftTeamsChatTopicLookupStatus.PermissionDenied
        ) {
          result.permissionDeniedChatIds.push(chat.id);
          return;
        }

        if (lookup.status === MicrosoftTeamsChatTopicLookupStatus.Unknown) {
          result.failedChatIds.push(chat.id);
          return;
        }

        const update: MicrosoftTeamsChatNameUpdate = this.getChatNameUpdate({
          chat: chat,
          lookup: lookup,
        });

        if (update.name !== chat.name || update.topic !== chat.topic) {
          updates[chat.id] = update;
        }
      });
    }

    if (Object.keys(updates).length > 0) {
      await this.renameChatsInProjectAuthTokens({
        tenantId: tenantId,
        chatNames: updates,
      });
    }

    /*
     * What is stored now, whether or not anything was renamed: a chat
     * removed while names were being read is gone, and is not reported.
     */
    result.chats = await this.getChatsForProject({
      projectId: data.projectId,
    });

    return result;
  }

  // The name a stored group chat gets from a lookup that Graph answered.
  private static getChatNameUpdate(data: {
    chat: MicrosoftTeamsChat;
    lookup: MicrosoftTeamsChatTopicLookup;
  }): MicrosoftTeamsChatNameUpdate {
    const chat: MicrosoftTeamsChat = data.chat;

    if (
      data.lookup.status === MicrosoftTeamsChatTopicLookupStatus.Found &&
      data.lookup.topic
    ) {
      return {
        name: this.getChatDisplayName({
          chatType: chat.chatType,
          topic: data.lookup.topic,
          memberNames: [],
        }),
        topic: data.lookup.topic,
      };
    }

    // The chat has no name in Teams.
    if (chat.memberNames && chat.memberNames.length > 0) {
      return {
        name: this.getChatDisplayName({
          chatType: chat.chatType,
          memberNames: chat.memberNames,
          memberCount: chat.memberCount,
        }),
      };
    }

    /*
     * No members to name it after. Keep the current name — unless it was the
     * Teams name that has just been removed.
     */
    return {
      name: chat.topic
        ? this.getChatDisplayName({ chatType: chat.chatType, memberNames: [] })
        : chat.name,
    };
  }

  /*
   * Sets the name (and the Teams name it came from) of chats already stored
   * for a tenant, on every connected project. Only those fields are written,
   * onto each record as it is now — a chat removed or re-captured while names
   * were being looked up is neither resurrected nor rolled back.
   */
  @CaptureSpan()
  public static async renameChatsInProjectAuthTokens(data: {
    tenantId: string;
    chatNames: Record<string, MicrosoftTeamsChatNameUpdate>;
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

      const availableChats: Record<string, MicrosoftTeamsChat> = {
        ...(miscData.availableChats || {}),
      };

      let changed: boolean = false;

      for (const [chatId, update] of Object.entries(data.chatNames)) {
        const existingChat: MicrosoftTeamsChat | undefined =
          availableChats[chatId];

        if (
          !existingChat ||
          (existingChat.name === update.name &&
            existingChat.topic === update.topic)
        ) {
          continue;
        }

        const renamedChat: MicrosoftTeamsChat = {
          ...existingChat,
          name: update.name,
        };

        if (update.topic) {
          renamedChat.topic = update.topic;
        } else {
          delete renamedChat.topic;
        }

        availableChats[chatId] = renamedChat;
        changed = true;
      }

      if (!changed) {
        continue;
      }

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
  /*
   * The AAD group id for a team, which is what Graph calls the team id and what
   * every notification rule stores. Teams normally puts it on the activity as
   * channelData.team.aadGroupId; when it does not, TeamsInfo.getTeamDetails
   * fetches it. Returns undefined rather than throwing — a missing group id
   * degrades the record, it does not invalidate the install.
   */
  public static async resolveGraphTeamIdFromBotActivity(data: {
    team: JSONObject | undefined;
    turnContext: TurnContext;
  }): Promise<string | undefined> {
    const aadGroupIdOnActivity: string =
      (data.team?.["aadGroupId"] as string) || "";

    if (aadGroupIdOnActivity) {
      return aadGroupIdOnActivity;
    }

    try {
      const teamDetails: TeamDetails = await TeamsInfo.getTeamDetails(
        data.turnContext,
      );

      return teamDetails?.aadGroupId || undefined;
    } catch (err) {
      /*
       * Uninstall activities are the common case here: the bot is already out
       * of the team by the time we ask, so the call fails. Uninstall matches on
       * the thread id anyway, so this is not worth an error-level log.
       */
      logger.debug(
        "Could not resolve the Graph team id for a Microsoft Teams install:",
      );
      logger.debug(err);
      return undefined;
    }
  }

  /*
   * installedTeams re-keyed by Graph team id, which is the id every caller
   * outside the bot handlers actually holds. Records that could not be resolved
   * to a group id are dropped: they cannot answer "is this team installed?" for
   * a notification rule, and including them under their thread id would only
   * invite the same confusion this replaced.
   */
  public static indexInstalledTeamsByGraphTeamId(
    installedTeams: Record<string, MicrosoftTeamsInstalledTeam> | undefined,
  ): Record<string, MicrosoftTeamsInstalledTeam> {
    const index: Record<string, MicrosoftTeamsInstalledTeam> = {};

    for (const installedTeam of Object.values(installedTeams || {})) {
      const graphTeamId: string | undefined =
        installedTeam?.graphTeamId || undefined;

      if (!graphTeamId) {
        continue;
      }

      index[graphTeamId] = installedTeam;
    }

    return index;
  }

  /*
   * The stored record for a team in a tenant, if any, matched on either id.
   * Used to keep the message-driven backfill cheap.
   */
  public static async getInstalledTeamForTenant(data: {
    tenantId: string;
    teamsThreadId?: string | undefined;
    graphTeamId?: string | undefined;
  }): Promise<MicrosoftTeamsInstalledTeam | null> {
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
      const miscData: MicrosoftTeamsMiscData =
        (projectAuth.miscData as MicrosoftTeamsMiscData) || {};

      for (const existingTeam of Object.values(miscData.installedTeams || {})) {
        if (
          this.isSameInstalledTeam({
            team: existingTeam,
            graphTeamId: data.graphTeamId,
            teamsThreadId: data.teamsThreadId,
          })
        ) {
          return existingTeam;
        }
      }
    }

    return null;
  }

  @CaptureSpan()
  public static async captureTeamFromBotActivity(data: {
    activity: JSONObject;
    turnContext: TurnContext;
    onlyIfMissingOrStale?: boolean | undefined;
  }): Promise<void> {
    try {
      const channelData: JSONObject =
        (data.activity["channelData"] as JSONObject) || {};

      const team: JSONObject | undefined = channelData["team"] as
        | JSONObject
        | undefined;

      const teamsThreadId: string = (team?.["id"] as string) || "";

      if (!teamsThreadId) {
        // Not a team-scoped activity (personal or group chat). Nothing to do.
        return;
      }

      const tenantId: string =
        ((channelData["tenant"] as JSONObject)?.["id"] as string) || "";

      if (!tenantId) {
        logger.debug("No tenant id found on team activity. Skipping.");
        return;
      }

      const activityServiceUrl: string | undefined =
        (data.activity["serviceUrl"] as string) ||
        data.turnContext.activity.serviceUrl ||
        undefined;

      /*
       * The backfill runs on every inbound channel message, so it must be cheap
       * once the team is already on record: one read, then nothing. Without this
       * every message meant a write, and now potentially a Bot Framework call to
       * resolve the group id as well. A record that is missing the group id, or
       * whose serviceUrl has moved, is still worth redoing.
       */
      if (data.onlyIfMissingOrStale) {
        const existingTeam: MicrosoftTeamsInstalledTeam | null =
          await this.getInstalledTeamForTenant({
            tenantId: tenantId,
            teamsThreadId: teamsThreadId,
            graphTeamId: (team?.["aadGroupId"] as string) || undefined,
          });

        if (
          existingTeam &&
          existingTeam.graphTeamId &&
          existingTeam.serviceUrl === activityServiceUrl
        ) {
          return;
        }
      }

      /*
       * The send path looks installs up by Graph team id, so resolving it here
       * is what makes the record usable at all. Teams puts it on the activity
       * as aadGroupId most of the time; when it does not, one Bot Framework
       * call gets it. A record without it is still worth keeping for the
       * serviceUrl and for uninstall matching, it just cannot be matched to a
       * notification rule.
       */
      const graphTeamId: string | undefined =
        await this.resolveGraphTeamIdFromBotActivity({
          team: team,
          turnContext: data.turnContext,
        });

      const installedTeam: MicrosoftTeamsInstalledTeam = {
        id: graphTeamId || teamsThreadId,
        graphTeamId: graphTeamId,
        teamsThreadId: teamsThreadId,
        name: (team?.["name"] as string) || undefined,
        serviceUrl: activityServiceUrl,
        addedAt: OneUptimeDate.getCurrentDate().toISOString(),
      };

      await this.saveTeamToProjectAuthTokens({
        tenantId: tenantId,
        team: installedTeam,
      });

      logger.debug(
        `Captured Microsoft Teams team install ${installedTeam.id} (thread ${teamsThreadId}, graph ${graphTeamId || "unresolved"}) for tenant ${tenantId}`,
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

      const team: JSONObject | undefined = channelData["team"] as
        | JSONObject
        | undefined;

      const teamsThreadId: string = (team?.["id"] as string) || "";
      const tenantId: string =
        ((channelData["tenant"] as JSONObject)?.["id"] as string) || "";

      if (!teamsThreadId || !tenantId) {
        return;
      }

      /*
       * Uninstall matches on both ids because we cannot know which one the
       * record was keyed by: the bot is already out of the team, so
       * getTeamDetails will not answer, and records written before this shipped
       * only have a thread id. aadGroupId is still on the activity often enough
       * to be worth passing through.
       */
      await this.removeTeamFromProjectAuthTokens({
        tenantId: tenantId,
        teamsThreadId: teamsThreadId,
        graphTeamId: (team?.["aadGroupId"] as string) || undefined,
      });

      logger.debug(
        `Removed Microsoft Teams team install ${teamsThreadId} for tenant ${tenantId}`,
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

      /*
       * Drop any other record describing the same team before inserting. A
       * team captured before the group id was resolvable sits under its thread
       * id, and re-capturing it under the group id would otherwise leave two
       * records for one team — one of which can never be matched or removed.
       */
      const installedTeams: Record<string, MicrosoftTeamsInstalledTeam> = {};

      for (const [key, existingTeam] of Object.entries(
        miscData.installedTeams || {},
      )) {
        if (
          this.isSameInstalledTeam({
            team: existingTeam,
            graphTeamId: data.team.graphTeamId,
            teamsThreadId: data.team.teamsThreadId,
          })
        ) {
          continue;
        }

        installedTeams[key] = existingTeam;
      }

      installedTeams[data.team.id] = data.team;
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

  /*
   * Whether a stored record describes the team identified by either id. Matches
   * on the record's explicit ids and on its key, so records written before
   * teamsThreadId existed — where the thread id is only in `id` — still match.
   * Ids are compared case-sensitively, as Microsoft returns them.
   */
  public static isSameInstalledTeam(data: {
    team: MicrosoftTeamsInstalledTeam | undefined;
    graphTeamId?: string | undefined;
    teamsThreadId?: string | undefined;
  }): boolean {
    if (!data.team) {
      return false;
    }

    if (
      data.graphTeamId &&
      (data.team.graphTeamId === data.graphTeamId ||
        data.team.id === data.graphTeamId)
    ) {
      return true;
    }

    if (
      data.teamsThreadId &&
      (data.team.teamsThreadId === data.teamsThreadId ||
        data.team.id === data.teamsThreadId)
    ) {
      return true;
    }

    return false;
  }

  @CaptureSpan()
  public static async removeTeamFromProjectAuthTokens(data: {
    tenantId: string;
    teamsThreadId?: string | undefined;
    graphTeamId?: string | undefined;
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

      if (!miscData.installedTeams) {
        continue;
      }

      const installedTeams: Record<string, MicrosoftTeamsInstalledTeam> = {};
      let removedAny: boolean = false;

      for (const [key, existingTeam] of Object.entries(
        miscData.installedTeams,
      )) {
        if (
          this.isSameInstalledTeam({
            team: existingTeam,
            graphTeamId: data.graphTeamId,
            teamsThreadId: data.teamsThreadId,
          })
        ) {
          removedAny = true;
          continue;
        }

        installedTeams[key] = existingTeam;
      }

      if (!removedAny) {
        continue;
      }

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

        try {
          // Run the activity through our activity handler
          await activityHandler.run(context);
        } catch (error) {
          // Never answer Teams with a 500; see recoverFromFailedTurn.
          await MicrosoftTeamsUtil.recoverFromFailedTurn({
            turnContext: context,
            error: error,
          });
        }
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

  // Method to get user's joined teams using app-scoped token
  @CaptureSpan()
  public static async getUserJoinedTeams(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<JSONObject>> {
    logger.debug("=== getUserJoinedTeams called ===", {
      projectId: data.projectId.toString(),
      userId: data.userId.toString(),
    });
    logger.debug(`User ID: ${data.userId.toString()}`);
    logger.debug(`Project ID: ${data.projectId.toString()}`);

    try {
      // Fetch user email from UserService
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
        logger.error("User or user email not found");
        throw new BadDataException(
          "User email not found for Microsoft Teams integration",
        );
      }
      const userEmail: string = user.email.toString();
      logger.debug(`Retrieved user email: ${userEmail}`);

      // Get a valid app access token (refreshed if needed)
      logger.debug("Refreshing app access token before fetching teams");
      const accessToken: string = await this.getValidAccessToken({
        authToken: "", // Not needed for app token refresh
        projectId: data.projectId,
      });
      logger.debug("App access token refreshed successfully");

      // Get user's teams using app-scoped token
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

      const teamsData: JSONObject = teamsResponse.data;
      const teams: Array<JSONObject> =
        (teamsData["value"] as Array<JSONObject>) || [];

      logger.debug(`Fetched ${teams.length} joined teams`);

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

      const accessToken: string = await this.getValidAccessToken({
        authToken: projectAuth.authToken || "",
        projectId: params.projectId,
      });

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

          // Teams message bodies are HTML.
          text = this.stripHtmlTags(text).trim();

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
