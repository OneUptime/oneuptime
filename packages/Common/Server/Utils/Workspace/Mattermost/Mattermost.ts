import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import BadRequestException from "../../../../Types/Exception/BadRequestException";
import { JSONArray, JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceMessagePayload, {
  WorkspaceCheckboxBlock,
  WorkspaceDatePickerBlock,
  WorkspaceDateTimePickerBlock,
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspaceModalBlock,
  WorkspaceNumberInputBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadContext,
  WorkspacePayloadHeader,
  WorkspacePayloadImage,
  WorkspacePayloadInlineImage,
  WorkspacePayloadMarkdown,
  WorkspaceTextAreaBlock,
  WorkspaceTextBoxBlock,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceChannelInvitationPayload from "../../../../Types/Workspace/WorkspaceChannelInvitationPayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import API from "../../../../Utils/API";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import { fitTextToLength } from "../../../../Utils/MessageFit";
import WorkspaceChannelName from "../../../../Utils/Workspace/WorkspaceChannelName";
import { AppApiClientUrl } from "../../../EnvironmentConfig";
import logger, { LogAttributes } from "../../Logger";
import SSRFProtection from "../../SSRFProtection";
import WorkspaceMessageTime from "../WorkspaceMessageTime";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { NotificationProviderConfig } from "../../Telemetry/NotificationDeliveryMetrics";
import WorkspaceBase, {
  WorkspaceChannel,
  WorkspaceChannelToCreate,
  WorkspaceDirectMessageLocation,
  WorkspaceMessageLocation,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../WorkspaceBase";
import WorkspaceDeliveryMetrics, {
  WorkspaceChannelPost,
  WorkspaceChannelPosts,
} from "../WorkspaceDeliveryMetrics";
import WorkspaceInlineImages from "../WorkspaceInlineImages";
import WorkspaceChannelNotFound from "../WorkspaceChannelNotFound";
import MattermostActionContext, {
  MAX_ACTIONS_PER_CONTEXT,
  MattermostAction,
} from "./MattermostActionContext";
import MattermostConnection, {
  MattermostConnectionData,
} from "./MattermostConnection";
import { isMattermostAction } from "./MattermostActionTypes";

// Where Mattermost POSTs a press of a button or a menu on OneUptime's messages.
export const MATTERMOST_INTERACTIVE_PATH: string = "/mattermost/interactive";

// Where Mattermost POSTs the submission of a form (an interactive dialog).
export const MATTERMOST_DIALOG_PATH: string = "/mattermost/dialog";

/*
 * What Mattermost answers, as the error's id, when a channel of the name
 * exists in the team already - in use or archived: Mattermost keeps an
 * archived channel's name.
 */
export const MATTERMOST_CHANNEL_EXISTS_ERROR_ID: string =
  "store.sql_channel.save_channel.exists.app_error";

/*
 * How the error's id ends when an account is added to a channel of a team it
 * is not in: "app.team...", "store.sql_team..." on older servers. A 404, as
 * for a channel that is gone, so only the id tells the two apart. And the id
 * for an account removed from the team.
 */
const NOT_IN_TEAM_ERROR_ID_END: string = "team.get_member.missing.app_error";
const REMOVED_FROM_TEAM_ERROR_ID: string =
  "api.channel.add_user.to.channel.failed.deleted.app_error";

/*
 * How the error's id ends when the account to add does not exist:
 * "app.user...", "store.sql_user..." on older servers. And the id for an
 * account deactivated: a 403, as for a bot not allowed to add anybody.
 */
const NO_ACCOUNT_ERROR_ID_END: string = "user.missing_account.const";
const DEACTIVATED_ACCOUNT_ERROR_ID: string =
  "app.channel.add_member.deleted_user.app_error";

/*
 * What an email address may not hold to be placed in a path: white space,
 * or what ends or escapes a path segment.
 */
const EMAIL_PATH_BREAKERS: RegExp = /[\s/?#%\\]/;

/*
 * An invisible character that joins the characters on either side of it:
 * put after an "@", it keeps Mattermost from reading a mention while the
 * text still reads exactly as typed.
 */
const WORD_JOINER: string = "⁠";

/*
 * A channel as Mattermost describes one, with what OneUptime reads of it -
 * its team (WorkspaceChannel.teamId) among it: a channel of a team names
 * the team, a direct or group message none.
 */
export interface MattermostChannel extends WorkspaceChannel {
  displayName: string;
  // "O" for a public channel, "P" for a private one, "D" / "G" for direct and group messages.
  type: string;
  // Archived: Mattermost keeps the channel and everybody in it.
  isArchived?: boolean | undefined;
}

/*
 * What the buttons of a post are signed for (MattermostActionContext): the
 * team of the channel it is in, or - in a direct or group message, which
 * belongs to no team - its channel, with the connection's team beside it.
 */
export interface MattermostPostSigning {
  teamId: string;
  directMessageChannelId?: string | undefined;
}

// A Mattermost account, as OneUptime reads one.
export interface MattermostUser {
  id: string;
  username: string;
  // First and last name, or the nickname, when the account has one.
  displayName: string;
  isBot: boolean;
  // A guest account, which Mattermost lets into the channels it was let into only.
  isGuest: boolean;
  // Its email address, when the server shows people's to the bot (Show Email Address).
  email?: string | undefined;
  // Deactivated: Mattermost keeps such an account in the channels it was in.
  isDeactivated?: boolean | undefined;
}

// A team the bot account is a member of.
export interface MattermostTeam {
  id: string;
  name: string;
  displayName: string;
}

/*
 * What Mattermost answered when it refused a call: its HTTP status, and the
 * id of its error ("store.sql_channel.save_channel.exists.app_error"), which
 * says what went wrong where the message is written for people.
 */
export class MattermostRequestError extends BadRequestException {
  public readonly statusCode: number;
  public readonly errorId: string;

  public constructor(data: {
    message: string;
    statusCode: number;
    errorId: string;
  }) {
    super(data.message);
    this.statusCode = data.statusCode;
    this.errorId = data.errorId;
  }
}

/*
 * The pieces a message is made of, before they are put into one post
 * (MattermostUtil.toPost). A Mattermost post is Markdown - which Mattermost
 * reads as OneUptime writes it - with the buttons in an attachment under it.
 */
type MattermostPiece =
  | { piece: "markdown"; text: string }
  | {
      piece: "actions";
      buttons: Array<MattermostButtonPiece>;
      links: Array<{ title: string; url: string }>;
      menu: Array<MattermostButtonPiece>;
    }
  | { piece: "element"; element: JSONObject }
  | { piece: "dialog"; dialog: JSONObject };

interface MattermostButtonPiece extends MattermostAction {
  title: string;
  isPrimary: boolean;
}

export default class MattermostUtil extends WorkspaceBase {
  /*
   * The most characters a post's message may have: Mattermost refuses a
   * longer one (MaxPostSize, 16,383 characters on every server since 5.0).
   */
  public static readonly MESSAGE_MAX_LENGTH: number = 16383;

  // A channel's name (its handle) and display name: at most 64 characters each.
  public static readonly CHANNEL_NAME_MAX_LENGTH: number = 64;
  public static readonly CHANNEL_DISPLAY_NAME_MAX_LENGTH: number = 64;

  // What a button and a menu option say: short, as Mattermost draws them.
  public static readonly BUTTON_TITLE_MAX_LENGTH: number = 75;

  // What a notification shows of a post with buttons: its attachment's fallback.
  public static readonly NOTIFICATION_TEXT_MAX_LENGTH: number = 300;

  /*
   * An interactive dialog's limits: a field's label and its help text, a
   * text field's default value, and how many options a menu may hold.
   */
  public static readonly DIALOG_TITLE_MAX_LENGTH: number = 48;
  public static readonly DIALOG_LABEL_MAX_LENGTH: number = 24;
  public static readonly DIALOG_HELP_TEXT_MAX_LENGTH: number = 150;
  public static readonly DIALOG_TEXT_MAX_LENGTH: number = 150;
  public static readonly DIALOG_TEXTAREA_MAX_LENGTH: number = 3000;
  public static readonly DIALOG_MAX_OPTIONS: number = 100;

  // How long one call to a Mattermost server may take before it is given up.
  public static readonly REQUEST_TIMEOUT_IN_MS: number = 15000;

  // How many channels Mattermost lists in one page.
  private static readonly CHANNELS_PER_PAGE: number = 200;

  // The most pages of channels read, so a huge team cannot hold a request forever.
  private static readonly MAX_CHANNEL_PAGES: number = 25;

  // How many accounts Mattermost lists in one page: the most it gives (PerPageMaximum).
  private static readonly CHANNEL_MEMBERS_PER_PAGE: number = 200;

  /*
   * Calls the Mattermost server of `connection` as its bot: `path` under
   * the server's address, the bot's token as a bearer token. What the
   * server answers, or a MattermostRequestError with what it said.
   *
   * The server's address was typed by a member of the project, so it is
   * held to what outbound requests from OneUptime may reach before every
   * call (SSRFProtection) - eligible for the private-network exception a
   * self-hosted operator may turn on, since Mattermost often runs on the
   * same private network as OneUptime - and a redirect is never followed:
   * a public server could otherwise send the call, and the bot's token,
   * to an internal address.
   */
  @CaptureSpan()
  public static async callServer<T extends JSONObject | JSONArray>(data: {
    serverUrl: string;
    accessToken: string;
    method: HTTPMethod;
    // "/api/v4/users/me" - every id in it checked already.
    path: string;
    body?: JSONObject | JSONArray | undefined;
    query?: Dictionary<string> | undefined;
    // Whether a call that failed may be made again: only for calls that change nothing, or change nothing twice.
    retry?: boolean | undefined;
  }): Promise<T> {
    const url: URL = URL.fromString(`${data.serverUrl}${data.path}`);

    await MattermostUtil.assertServerIsReachable(data.serverUrl);

    const requestOptions: {
      url: URL;
      headers: Dictionary<string>;
      params?: Dictionary<string>;
      data?: JSONObject | JSONArray;
      options: {
        retries: number;
        exponentialBackoff: boolean;
        retryOnlyOnRetryableErrors: boolean;
        timeout: number;
        doNotFollowRedirects: boolean;
      };
    } = {
      url: url,
      headers: {
        Authorization: `Bearer ${data.accessToken}`,
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      options: {
        retries: data.retry ? 2 : 0,
        exponentialBackoff: true,
        retryOnlyOnRetryableErrors: true,
        timeout: MattermostUtil.REQUEST_TIMEOUT_IN_MS,
        doNotFollowRedirects: true,
      },
    };

    if (data.query) {
      requestOptions.params = data.query;
    }

    if (data.body !== undefined) {
      requestOptions.data = data.body;
    }

    let response: HTTPResponse<T> | HTTPErrorResponse;

    switch (data.method) {
      case HTTPMethod.GET:
        response = await API.get<T>(requestOptions);
        break;
      case HTTPMethod.POST:
        response = await API.post<T>(requestOptions);
        break;
      case HTTPMethod.PUT:
        response = await API.put<T>(requestOptions);
        break;
      case HTTPMethod.DELETE:
        response = await API.delete<T>(requestOptions);
        break;
      default:
        throw new BadDataException(
          `Mattermost is not called with ${data.method}.`,
        );
    }

    if (response instanceof HTTPErrorResponse) {
      throw MattermostUtil.getRequestError(response);
    }

    return response.jsonData as T;
  }

  /*
   * The server's address, refused when OneUptime may not call it: an
   * address on this machine, the cloud metadata service, or - unless the
   * operator allowed it - a private network.
   */
  public static async assertServerIsReachable(
    serverUrl: string,
  ): Promise<void> {
    try {
      await SSRFProtection.validateWebhookTargetIsSafe(serverUrl, {
        allowPrivateNetworkTargets: true,
        targetLabel: "Mattermost server address",
      });
    } catch (err) {
      throw new BadDataException(WorkspaceBase.getSendErrorMessage(err));
    }
  }

  // What a refusal from Mattermost is thrown as.
  public static getRequestError(
    response: HTTPErrorResponse,
  ): MattermostRequestError {
    const body: JSONObject =
      response.jsonData &&
      typeof response.jsonData === "object" &&
      !Array.isArray(response.jsonData)
        ? (response.jsonData as JSONObject)
        : {};

    const errorId: string =
      typeof body["id"] === "string" ? (body["id"] as string) : "";

    const message: string =
      (typeof body["message"] === "string" && (body["message"] as string)) ||
      response.message ||
      `Mattermost answered with HTTP status ${response.statusCode}.`;

    return new MattermostRequestError({
      message: `Error from Mattermost: ${message}`,
      statusCode: response.statusCode,
      errorId: errorId,
    });
  }

  public static isNotFoundError(error: unknown): boolean {
    return error instanceof MattermostRequestError && error.statusCode === 404;
  }

  public static isForbiddenError(error: unknown): boolean {
    return error instanceof MattermostRequestError && error.statusCode === 403;
  }

  // A token Mattermost no longer takes: revoked, or its bot deactivated.
  public static isUnauthorizedError(error: unknown): boolean {
    return error instanceof MattermostRequestError && error.statusCode === 401;
  }

  // The account to add is not in the channel's team.
  public static isNotInTeamError(error: unknown): boolean {
    return (
      error instanceof MattermostRequestError &&
      (error.errorId.endsWith(NOT_IN_TEAM_ERROR_ID_END) ||
        error.errorId === REMOVED_FROM_TEAM_ERROR_ID)
    );
  }

  // The account to add does not exist, or was deactivated.
  public static isAccountGoneError(error: unknown): boolean {
    return (
      error instanceof MattermostRequestError &&
      (error.errorId.endsWith(NO_ACCOUNT_ERROR_ID_END) ||
        error.errorId === DEACTIVATED_ACCOUNT_ERROR_ID)
    );
  }

  // Mattermost could not answer now: down, or its rate limit.
  public static isUnavailableError(error: unknown): boolean {
    return (
      !(error instanceof MattermostRequestError) ||
      error.statusCode === 429 ||
      error.statusCode >= 500
    );
  }

  /*
   * The bot account a token belongs to, and the teams it is in: what
   * connecting a project checks before anything is kept.
   */
  @CaptureSpan()
  public static async getBotAccount(data: {
    serverUrl: string;
    accessToken: string;
  }): Promise<MattermostUser> {
    const user: JSONObject = await MattermostUtil.callServer<JSONObject>({
      serverUrl: data.serverUrl,
      accessToken: data.accessToken,
      method: HTTPMethod.GET,
      path: "/api/v4/users/me",
      retry: true,
    });

    return MattermostUtil.readUser(user);
  }

  /*
   * The teams the bot account is a member of, each once: those OneUptime
   * can post in (MattermostTeams). An archived team, which Mattermost may
   * still list, and an entry OneUptime cannot read are left out.
   */
  @CaptureSpan()
  public static async getTeamsOfBot(data: {
    serverUrl: string;
    accessToken: string;
  }): Promise<Array<MattermostTeam>> {
    const teams: JSONArray = await MattermostUtil.callServer<JSONArray>({
      serverUrl: data.serverUrl,
      accessToken: data.accessToken,
      method: HTTPMethod.GET,
      path: "/api/v4/users/me/teams",
      retry: true,
    });

    if (!Array.isArray(teams)) {
      throw new BadDataException(
        "Mattermost answered with a list of teams OneUptime could not read.",
      );
    }

    const seen: Set<string> = new Set<string>();

    return teams
      .map((team: JSONValue): MattermostTeam | null => {
        const json: JSONObject = (team || {}) as JSONObject;
        const id: unknown = json["id"];
        const deletedAt: unknown = json["delete_at"];

        if (
          !MattermostConnection.isMattermostId(id) ||
          seen.has(id) ||
          (typeof deletedAt === "number" && deletedAt > 0)
        ) {
          return null;
        }

        seen.add(id);

        return {
          id: id,
          name:
            typeof json["name"] === "string" ? (json["name"] as string) : "",
          displayName:
            typeof json["display_name"] === "string"
              ? (json["display_name"] as string)
              : "",
        };
      })
      .filter((team: MattermostTeam | null): team is MattermostTeam => {
        return team !== null;
      });
  }

  // A Mattermost account by its id.
  @CaptureSpan()
  public static async getUser(data: {
    authToken: string;
    userId: string;
  }): Promise<MattermostUser> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    const userId: string = MattermostConnection.assertMattermostId(
      data.userId,
      "user",
    );

    const user: JSONObject = await MattermostUtil.callServer<JSONObject>({
      ...connection,
      method: HTTPMethod.GET,
      path: `/api/v4/users/${userId}`,
      retry: true,
    });

    return MattermostUtil.readUser(user);
  }

  /*
   * A Mattermost account by its username ("@alice" or "alice"), or null
   * when there is none of that name.
   */
  @CaptureSpan()
  public static async findUserByUsername(data: {
    authToken: string;
    username: string;
  }): Promise<MattermostUser | null> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    const username: string = data.username
      .trim()
      .replace(/^@/, "")
      .toLowerCase();

    if (!MattermostConnection.isUsername(username)) {
      return null;
    }

    try {
      const user: JSONObject = await MattermostUtil.callServer<JSONObject>({
        ...connection,
        method: HTTPMethod.GET,
        path: `/api/v4/users/username/${encodeURIComponent(username)}`,
        retry: true,
      });

      return MattermostUtil.readUser(user);
    } catch (err) {
      if (MattermostUtil.isNotFoundError(err)) {
        return null;
      }

      throw err;
    }
  }

  /*
   * A Mattermost account by its email address, or null when there is none
   * the bot may see. Mattermost shows a bot someone's email address only
   * when the server lets everybody see them (Show Email Address), so a
   * refusal is "none found" too.
   */
  @CaptureSpan()
  public static async findUserByEmail(data: {
    authToken: string;
    email: string;
  }): Promise<MattermostUser | null> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    const email: string = data.email.trim();

    if (!email || email.length > 254 || EMAIL_PATH_BREAKERS.test(email)) {
      return null;
    }

    try {
      const user: JSONObject = await MattermostUtil.callServer<JSONObject>({
        ...connection,
        method: HTTPMethod.GET,
        path: `/api/v4/users/email/${encodeURIComponent(email)}`,
        retry: true,
      });

      return MattermostUtil.readUser(user);
    } catch (err) {
      if (
        err instanceof MattermostRequestError &&
        (err.statusCode === 404 ||
          err.statusCode === 403 ||
          err.statusCode === 400)
      ) {
        return null;
      }

      throw err;
    }
  }

  private static readUser(user: JSONObject): MattermostUser {
    const id: unknown = user["id"];

    if (!MattermostConnection.isMattermostId(id)) {
      throw new BadDataException(
        "Mattermost answered with an account OneUptime could not read.",
      );
    }

    const firstName: string =
      typeof user["first_name"] === "string"
        ? (user["first_name"] as string)
        : "";
    const lastName: string =
      typeof user["last_name"] === "string"
        ? (user["last_name"] as string)
        : "";
    const nickname: string =
      typeof user["nickname"] === "string" ? (user["nickname"] as string) : "";
    const email: string =
      typeof user["email"] === "string" ? (user["email"] as string).trim() : "";
    const deletedAt: unknown = user["delete_at"];

    return {
      id: id,
      username:
        typeof user["username"] === "string"
          ? (user["username"] as string)
          : "",
      displayName: `${firstName} ${lastName}`.trim() || nickname.trim(),
      isBot: user["is_bot"] === true,
      isGuest:
        typeof user["roles"] === "string" &&
        (user["roles"] as string).split(" ").includes("system_guest"),
      ...(email ? { email: email } : {}),
      ...(typeof deletedAt === "number" && deletedAt > 0
        ? { isDeactivated: true }
        : {}),
    };
  }

  @CaptureSpan()
  public static override async getUsernameFromUserId(data: {
    authToken: string;
    userId: string;
    projectId: ObjectID;
  }): Promise<string | null> {
    try {
      const user: MattermostUser = await MattermostUtil.getUser({
        authToken: data.authToken,
        userId: data.userId,
      });

      return user.username || null;
    } catch (err) {
      logger.warn("Could not read the username of a Mattermost account.", {
        projectId: data.projectId?.toString(),
      });
      logger.warn(err, { projectId: data.projectId?.toString() });
      return null;
    }
  }

  // CHANNELS

  /*
   * The name Mattermost creates a channel by: its handle, in URLs. Only
   * lowercase letters, digits, "-" and "_", starting and ending with a
   * letter or digit, 2 to 64 characters (WorkspaceChannelName, which the
   * rule form's preview shows it by too). "#Incidents INC-9" is created as
   * "incidents-inc-9"; a name with nothing of that left is "oneuptime".
   */
  public static getChannelNameToCreate(channelName: string): string {
    return WorkspaceChannelName.toMattermostChannelName(channelName);
  }

  /*
   * Names Mattermost creates by the same handle, in the same team, are one
   * channel: asked to create it a second time, Mattermost answers that it
   * exists. Another team has names of its own. The teams are as the rules
   * service reads them (MattermostTeams.getTeamIdOfRuleChannel): a rule's,
   * or the default team.
   */
  public static override isSameChannelToCreate(
    channel: WorkspaceChannelToCreate,
    otherChannel: WorkspaceChannelToCreate,
  ): boolean {
    return (
      (channel.teamId || undefined) === (otherChannel.teamId || undefined) &&
      this.getChannelNameToCreate(channel.channelName) ===
        this.getChannelNameToCreate(otherChannel.channelName)
    );
  }

  public static override isChannelNameTakenError(error: unknown): boolean {
    return (
      error instanceof MattermostRequestError &&
      error.statusCode === 400 &&
      (error.errorId === MATTERMOST_CHANNEL_EXISTS_ERROR_ID ||
        error.errorId.endsWith(".exists.app_error"))
    );
  }

  /*
   * Creates a channel in the team `teamId` names - a rule's - else in the
   * connection's default team (MattermostTeams).
   */
  @CaptureSpan()
  public static override async createChannel(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
    isPrivate?: boolean;
    teamId?: string | undefined;
  }): Promise<WorkspaceChannel> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    const teamId: string = data.teamId
      ? MattermostConnection.assertMattermostId(data.teamId, "team")
      : connection.teamId;

    const name: string = MattermostUtil.getChannelNameToCreate(
      data.channelName,
    );

    logger.debug(`Creating Mattermost channel ${name}.`, {
      projectId: data.projectId?.toString(),
    });

    let channel: JSONObject;

    try {
      channel = await MattermostUtil.callServer<JSONObject>({
        ...connection,
        method: HTTPMethod.POST,
        path: "/api/v4/channels",
        body: {
          team_id: teamId,
          name: name,
          display_name: name,
          type: data.isPrivate ? "P" : "O",
        },
      });
    } catch (err) {
      if (!MattermostUtil.isForbiddenError(err)) {
        throw err;
      }

      // Another team than the default: most likely one the bot is not in (any more).
      if (teamId !== connection.teamId) {
        throw new BadDataException(
          "OneUptime's bot may not create channels in the Mattermost team this rule names. Add the bot to that team in Mattermost, or choose another team in the rule, then try again.",
        );
      }

      // The default team: said so only when the bot was taken out of it.
      if (
        await MattermostUtil.isBotOutOfTeam({
          connection: connection,
          teamId: teamId,
        })
      ) {
        throw new BadDataException(
          "OneUptime's bot is no longer a member of the project's default Mattermost team, so it may not create channels there. Add the bot back to that team in Mattermost, or make another team the default in Project Settings > Workspace > Mattermost, then try again.",
        );
      }

      throw err;
    }

    return MattermostUtil.readChannel(channel);
  }

  /*
   * Whether the server no longer lists the bot in a team: what a refusal
   * in that team most likely means. False when the server would not say -
   * the refusal is then passed on as Mattermost gave it.
   */
  private static async isBotOutOfTeam(data: {
    connection: MattermostConnectionData;
    teamId: string;
  }): Promise<boolean> {
    try {
      return !(
        await MattermostUtil.getTeamsOfBot({
          serverUrl: data.connection.serverUrl,
          accessToken: data.connection.accessToken,
        })
      ).some((team: MattermostTeam): boolean => {
        return team.id === data.teamId;
      });
    } catch (err) {
      logger.debug("The Mattermost server did not list its bot's teams.");
      logger.debug(err);
      return false;
    }
  }

  @CaptureSpan()
  public static override async createChannelsIfDoesNotExist(data: {
    authToken: string;
    channelNames: Array<string>;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceChannel>> {
    const channels: Array<WorkspaceChannel> = [];

    for (const channelName of data.channelNames) {
      const existing: MattermostChannel | null =
        await MattermostUtil.findChannelByName({
          authToken: data.authToken,
          channelName: channelName,
        });

      if (existing) {
        channels.push(existing);
        continue;
      }

      channels.push(
        await MattermostUtil.createChannel({
          authToken: data.authToken,
          channelName: channelName,
          projectId: data.projectId,
        }),
      );
    }

    return channels;
  }

  @CaptureSpan()
  public static override async doesChannelExist(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
    // A rule's team (findChannelByName).
    teamId?: string;
  }): Promise<boolean> {
    return Boolean(
      await MattermostUtil.findChannelByName({
        authToken: data.authToken,
        channelName: data.channelName,
        teamId: data.teamId,
      }),
    );
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelName(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
    teamId?: string | undefined;
  }): Promise<WorkspaceChannel> {
    const channel: MattermostChannel | null =
      await MattermostUtil.findChannelByName({
        authToken: data.authToken,
        channelName: data.channelName,
        teamId: data.teamId,
      });

    if (!channel) {
      throw new BadDataException(
        WorkspaceChannelNotFound.getReason({
          workspaceType: WorkspaceType.Mattermost,
          channelName: data.channelName,
        }),
      );
    }

    return channel;
  }

  /*
   * A channel by its name - its handle, as in ~incidents, or its display
   * name, as in "Incidents" - or null when the bot can see none of that
   * name. A "#" or "~" in front is left out.
   *
   * It is looked for in the team `teamId` names - a rule's - and only
   * there. Without one, in the connection's default team first, then in
   * the other teams the bot is a member of, asked for only then
   * (MattermostTeams): by handle in each team, then by display name in
   * each, so a handle in another team comes before a display name in the
   * default one. A team that is not a Mattermost id names none, and is
   * never sent: a rule's team written through the API before rules could
   * name one, when it was not read.
   *
   * A team the bot was taken out of refuses it its channels. The team named
   * is then an error saying so, rather than Mattermost's refusal. The
   * default team is looked past to the bot's other teams, and is that error
   * only when none of them has the channel either - it may be in the
   * default team, where the bot cannot see it.
   */
  @CaptureSpan()
  public static async findChannelByName(data: {
    authToken: string;
    channelName: string;
    teamId?: string | undefined;
  }): Promise<MattermostChannel | null> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    const namedTeamId: string | undefined = MattermostConnection.isMattermostId(
      data.teamId,
    )
      ? data.teamId
      : undefined;

    const typed: string = (data.channelName || "").trim().replace(/^[#~]/, "");

    if (!typed) {
      return null;
    }

    const handle: string = typed.toLowerCase();
    const firstTeamId: string = namedTeamId || connection.teamId;

    /*
     * The bot's teams, asked for once: when the first team holds no such
     * channel and no team is named, or the first team refused the bot.
     */
    let botTeamIds: Array<string> | null = null;

    const getBotTeamIds: () => Promise<Array<string>> = async (): Promise<
      Array<string>
    > => {
      if (botTeamIds === null) {
        botTeamIds = (
          await MattermostUtil.getTeamsOfBot({
            serverUrl: connection.serverUrl,
            accessToken: connection.accessToken,
          })
        ).map((team: MattermostTeam): string => {
          return team.id;
        });
      }

      return botTeamIds;
    };

    // The bot's other teams: looked in only when no team is named.
    const getOtherTeamIds: () => Promise<Array<string>> = async (): Promise<
      Array<string>
    > => {
      if (namedTeamId) {
        return [];
      }

      return (await getBotTeamIds()).filter((teamId: string): boolean => {
        return teamId !== firstTeamId;
      });
    };

    /*
     * Whether the server no longer lists the bot in a team. Not known -
     * false - when it would not say: the refusal is passed on as it is.
     */
    const isBotOutOf: (teamId: string) => Promise<boolean> = async (
      teamId: string,
    ): Promise<boolean> => {
      try {
        return !(await getBotTeamIds()).includes(teamId);
      } catch (err) {
        logger.debug("The Mattermost server did not list its bot's teams.");
        logger.debug(err);
        return false;
      }
    };

    // The first team refused the bot its channels: one it was taken out of.
    let isBotOutOfFirstTeam: boolean = false;

    if (MattermostConnection.isChannelName(handle)) {
      const inFirstTeam: MattermostChannel | null =
        await MattermostUtil.findChannelByHandle({
          connection: connection,
          teamId: firstTeamId,
          handle: handle,
        });

      if (inFirstTeam) {
        return inFirstTeam;
      }

      for (const teamId of await getOtherTeamIds()) {
        const inTeam: MattermostChannel | null =
          await MattermostUtil.findChannelByHandle({
            connection: connection,
            teamId: teamId,
            handle: handle,
          });

        if (inTeam) {
          return inTeam;
        }
      }
    }

    // Its display name, as people see it: among the channels the bot can post in.
    const byDisplayName: (
      teamId: string,
    ) => Promise<MattermostChannel | null> = async (
      teamId: string,
    ): Promise<MattermostChannel | null> => {
      let channels: Array<MattermostChannel>;

      try {
        channels = await MattermostUtil.listChannels(connection, teamId);
      } catch (err) {
        // A refusal the bot's membership does not explain is passed on.
        if (
          teamId !== firstTeamId ||
          !MattermostUtil.isForbiddenError(err) ||
          !(await isBotOutOf(teamId))
        ) {
          throw err;
        }

        isBotOutOfFirstTeam = true;
        return null;
      }

      return (
        channels.find((channel: MattermostChannel): boolean => {
          return (
            channel.name === handle ||
            (channel.displayName || "").toLowerCase() === handle
          );
        }) || null
      );
    };

    const shownInFirstTeam: MattermostChannel | null =
      await byDisplayName(firstTeamId);

    if (shownInFirstTeam) {
      return shownInFirstTeam;
    }

    // The other teams are asked for only when the first has no such channel.
    for (const teamId of await getOtherTeamIds()) {
      const shownInTeam: MattermostChannel | null = await byDisplayName(teamId);

      if (shownInTeam) {
        return shownInTeam;
      }
    }

    if (isBotOutOfFirstTeam) {
      throw new BadDataException(
        namedTeamId
          ? `OneUptime's bot is not a member of the Mattermost team chosen for the channel ${typed}, so it cannot look for the channel there. Add the bot to that team in Mattermost, or choose another team, then try again.`
          : `OneUptime's bot is no longer a member of the project's default Mattermost team, so it cannot look for the channel ${typed} there, and its other teams do not have it. Add the bot back to that team in Mattermost, then try again.`,
      );
    }

    return null;
  }

  /*
   * A channel of one team by its handle, or null when the bot cannot see
   * one: none of that name, or a private one it is not in.
   */
  private static async findChannelByHandle(data: {
    connection: MattermostConnectionData;
    teamId: string;
    handle: string;
  }): Promise<MattermostChannel | null> {
    try {
      const channel: JSONObject = await MattermostUtil.callServer<JSONObject>({
        ...data.connection,
        method: HTTPMethod.GET,
        path: `/api/v4/teams/${data.teamId}/channels/name/${data.handle}`,
        retry: true,
      });

      return MattermostUtil.readChannel(channel);
    } catch (err) {
      if (
        !MattermostUtil.isNotFoundError(err) &&
        !MattermostUtil.isForbiddenError(err)
      ) {
        throw err;
      }

      return null;
    }
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelId(data: {
    authToken: string;
    channelId: string;
    teamId?: string;
  }): Promise<WorkspaceChannel> {
    return await MattermostUtil.getChannel({
      authToken: data.authToken,
      channelId: data.channelId,
    });
  }

  @CaptureSpan()
  public static async getChannel(data: {
    authToken: string;
    channelId: string;
  }): Promise<MattermostChannel> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    const channelId: string = MattermostConnection.assertMattermostId(
      data.channelId,
      "channel",
    );

    const channel: JSONObject = await MattermostUtil.callServer<JSONObject>({
      ...connection,
      method: HTTPMethod.GET,
      path: `/api/v4/channels/${channelId}`,
      retry: true,
    });

    return MattermostUtil.readChannel(channel);
  }

  /*
   * Every channel of the connection's default team the bot can post in:
   * its public channels, which it joins when it first posts in one, and the
   * private channels it has been added to. Keyed by channel id.
   */
  @CaptureSpan()
  public static override async getAllWorkspaceChannels(data: {
    authToken: string;
    projectId: ObjectID;
  }): Promise<Dictionary<WorkspaceChannel>> {
    const channels: Dictionary<WorkspaceChannel> = {};

    for (const channel of await MattermostUtil.listChannels(
      MattermostConnection.fromAuthToken(data.authToken),
    )) {
      channels[channel.id] = channel;
    }

    return channels;
  }

  /*
   * The channels getAllWorkspaceChannels lists, each once, in the order
   * Mattermost gave them: of the team `teamId` names, else of the
   * connection's default team.
   */
  public static async listChannels(
    connection: MattermostConnectionData,
    teamId?: string | undefined,
  ): Promise<Array<MattermostChannel>> {
    const team: string = teamId
      ? MattermostConnection.assertMattermostId(teamId, "team")
      : connection.teamId;

    const channels: Map<string, MattermostChannel> = new Map<
      string,
      MattermostChannel
    >();

    const addChannels: (list: JSONArray) => void = (list: JSONArray): void => {
      for (const item of list) {
        try {
          const channel: MattermostChannel = MattermostUtil.readChannel(
            (item || {}) as JSONObject,
          );

          if (channel.type === "O" || channel.type === "P") {
            channels.set(channel.id, channel);
          }
        } catch {
          // An entry OneUptime cannot read is left out.
        }
      }
    };

    for (
      let page: number = 0;
      page < MattermostUtil.MAX_CHANNEL_PAGES;
      page++
    ) {
      const list: JSONArray = await MattermostUtil.callServer<JSONArray>({
        ...connection,
        method: HTTPMethod.GET,
        path: `/api/v4/teams/${team}/channels`,
        query: {
          page: page.toString(),
          per_page: MattermostUtil.CHANNELS_PER_PAGE.toString(),
        },
        retry: true,
      });

      addChannels(list);

      if (list.length < MattermostUtil.CHANNELS_PER_PAGE) {
        break;
      }
    }

    // The private channels the bot is in: a team's listing shows only public ones.
    const memberChannels: JSONArray =
      await MattermostUtil.callServer<JSONArray>({
        ...connection,
        method: HTTPMethod.GET,
        path: `/api/v4/users/${connection.botUserId}/teams/${team}/channels`,
        retry: true,
      });

    addChannels(memberChannels);

    return Array.from(channels.values());
  }

  public static readChannel(channel: JSONObject): MattermostChannel {
    const id: unknown = channel["id"];

    if (!MattermostConnection.isMattermostId(id)) {
      throw new BadDataException(
        "Mattermost answered with a channel OneUptime could not read.",
      );
    }

    const name: string =
      typeof channel["name"] === "string" ? (channel["name"] as string) : id;
    const deletedAt: unknown = channel["delete_at"];
    // A direct or group message names no team: its team_id is empty.
    const teamId: unknown = channel["team_id"];

    return {
      id: id,
      name: name,
      displayName:
        typeof channel["display_name"] === "string" && channel["display_name"]
          ? (channel["display_name"] as string)
          : name,
      type:
        typeof channel["type"] === "string" ? (channel["type"] as string) : "",
      workspaceType: WorkspaceType.Mattermost,
      ...(MattermostConnection.isMattermostId(teamId)
        ? { teamId: teamId }
        : {}),
      ...(typeof deletedAt === "number" && deletedAt > 0
        ? { isArchived: true }
        : {}),
    };
  }

  /*
   * What the buttons of a post in a channel are signed for: the channel's
   * team, or - a direct or group message - the channel itself. A channel
   * that names no team of its own is the connection's default team's.
   */
  public static getPostSigning(data: {
    connection: MattermostConnectionData;
    channel: MattermostChannel;
  }): MattermostPostSigning {
    if (data.channel.type === "D" || data.channel.type === "G") {
      return {
        teamId: data.connection.teamId,
        directMessageChannelId: data.channel.id,
      };
    }

    return {
      teamId: MattermostConnection.isMattermostId(data.channel.teamId)
        ? data.channel.teamId
        : data.connection.teamId,
    };
  }

  /*
   * The accounts in a channel, bots and deactivated accounts among them, page
   * by page in username order, up to `max`. An entry OneUptime cannot read is
   * left out.
   *
   * Mattermost lists a channel's people only for somebody in it - a public
   * channel's too, unlike Slack - so a bot that is not in it is refused (403).
   * An archived channel keeps its people, and lists them.
   */
  @CaptureSpan()
  public static async getChannelMembers(data: {
    authToken: string;
    channelId: string;
    max: number;
  }): Promise<Array<MattermostUser>> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    const channelId: string = MattermostConnection.assertMattermostId(
      data.channelId,
      "channel",
    );

    const members: Map<string, MattermostUser> = new Map<
      string,
      MattermostUser
    >();
    const perPage: number = MattermostUtil.CHANNEL_MEMBERS_PER_PAGE;
    // A server of the customer's own answers: it cannot hold a request forever.
    const maxPages: number = Math.ceil(data.max / perPage);

    for (let page: number = 0; page < maxPages; page++) {
      const list: JSONArray = await MattermostUtil.callServer<JSONArray>({
        ...connection,
        method: HTTPMethod.GET,
        path: "/api/v4/users",
        query: {
          in_channel: channelId,
          page: page.toString(),
          per_page: perPage.toString(),
        },
        retry: true,
      });

      if (!Array.isArray(list)) {
        throw new BadDataException(
          "Mattermost answered with a list of people OneUptime could not read.",
        );
      }

      for (const item of list) {
        try {
          const member: MattermostUser = MattermostUtil.readUser(
            (item || {}) as JSONObject,
          );

          members.set(member.id, member);
        } catch {
          // An entry OneUptime cannot read is left out.
        }
      }

      if (list.length < perPage) {
        break;
      }
    }

    return Array.from(members.values()).slice(0, data.max);
  }

  /*
   * A post only `userId` sees, in `channelId`: Mattermost's ephemeral post,
   * shown to them as "(Only visible to you)" and gone when they reload. It
   * answers a form somebody sent - the form closes when it is done and
   * says nothing itself - where they opened it, as a press's
   * `ephemeral_text` answers a press. Held to what a post takes, with its
   * mentions broken (getMessageText).
   */
  @CaptureSpan()
  public static async postEphemeral(data: {
    authToken: string;
    userId: string;
    channelId: string;
    markdown: string;
  }): Promise<void> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    await MattermostUtil.callServer<JSONObject>({
      ...connection,
      method: HTTPMethod.POST,
      path: "/api/v4/posts/ephemeral",
      body: {
        user_id: MattermostConnection.assertMattermostId(data.userId, "user"),
        post: {
          channel_id: MattermostConnection.assertMattermostId(
            data.channelId,
            "channel",
          ),
          message: MattermostUtil.getMessageText(data.markdown),
        },
      },
    });
  }

  // The bot joins a public channel, so it may post there.
  @CaptureSpan()
  public static override async joinChannel(data: {
    authToken: string;
    channelId: string;
  }): Promise<void> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    await MattermostUtil.inviteUserToChannelByChannelId({
      authToken: data.authToken,
      channelId: data.channelId,
      workspaceUserId: connection.botUserId,
    });
  }

  /*
   * Adds an account to a channel. Mattermost answers an account in the
   * channel already as it answers one it added, so this is safe to repeat.
   */
  @CaptureSpan()
  public static override async inviteUserToChannelByChannelId(data: {
    authToken: string;
    channelId: string;
    workspaceUserId: string;
  }): Promise<void> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    const channelId: string = MattermostConnection.assertMattermostId(
      data.channelId,
      "channel",
    );

    const userId: string = MattermostConnection.assertMattermostId(
      data.workspaceUserId,
      "user",
    );

    await MattermostUtil.callServer<JSONObject>({
      ...connection,
      method: HTTPMethod.POST,
      path: `/api/v4/channels/${channelId}/members`,
      body: { user_id: userId },
      retry: true,
    });
  }

  @CaptureSpan()
  public static override async inviteUserToChannelByChannelName(data: {
    authToken: string;
    channelName: string;
    workspaceUserId: string;
    projectId: ObjectID;
  }): Promise<void> {
    const channel: WorkspaceChannel =
      await MattermostUtil.getWorkspaceChannelFromChannelName({
        authToken: data.authToken,
        channelName: data.channelName,
        projectId: data.projectId,
      });

    await MattermostUtil.inviteUserToChannelByChannelId({
      authToken: data.authToken,
      channelId: channel.id,
      workspaceUserId: data.workspaceUserId,
    });
  }

  /*
   * Adds the accounts to each channel, the channel looked up once. One
   * account Mattermost refuses - a guest kept out of the channel, an
   * account deactivated since - does not keep the others out: every
   * account is tried in every channel, and what was refused is thrown at
   * the end, together.
   */
  @CaptureSpan()
  public static override async inviteUsersToChannels(data: {
    authToken: string;
    workspaceChannelInvitationPayload: WorkspaceChannelInvitationPayload;
    projectId: ObjectID;
  }): Promise<void> {
    const refusals: Array<string> = [];

    for (const channelName of data.workspaceChannelInvitationPayload
      .channelNames) {
      try {
        await MattermostUtil.inviteUsersToChannel({
          authToken: data.authToken,
          channelName: channelName,
          workspaceUserIds:
            data.workspaceChannelInvitationPayload.workspaceUserIds,
          projectId: data.projectId,
        });
      } catch (err) {
        refusals.push(WorkspaceBase.getSendErrorMessage(err));
      }
    }

    if (refusals.length > 0) {
      throw new BadDataException(refusals.join("; "));
    }
  }

  @CaptureSpan()
  public static override async inviteUsersToChannel(data: {
    authToken: string;
    channelName: string;
    workspaceUserIds: Array<string>;
    projectId: ObjectID;
  }): Promise<void> {
    if (data.workspaceUserIds.length === 0) {
      return;
    }

    const channel: WorkspaceChannel =
      await MattermostUtil.getWorkspaceChannelFromChannelName({
        authToken: data.authToken,
        channelName: data.channelName,
        projectId: data.projectId,
      });

    const refusals: Array<string> = [];

    for (const workspaceUserId of data.workspaceUserIds) {
      try {
        await MattermostUtil.inviteUserToChannelByChannelId({
          authToken: data.authToken,
          channelId: channel.id,
          workspaceUserId: workspaceUserId,
        });
      } catch (err) {
        refusals.push(
          `${workspaceUserId} could not be added to ${channel.name}: ${WorkspaceBase.getSendErrorMessage(err)}`,
        );
      }
    }

    if (refusals.length > 0) {
      throw new BadDataException(refusals.join("; "));
    }
  }

  @CaptureSpan()
  public static override async isUserInChannel(data: {
    authToken: string;
    channelId: string;
    userId: string;
  }): Promise<boolean> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    const channelId: string = MattermostConnection.assertMattermostId(
      data.channelId,
      "channel",
    );

    const userId: string = MattermostConnection.assertMattermostId(
      data.userId,
      "user",
    );

    try {
      await MattermostUtil.callServer<JSONObject>({
        ...connection,
        method: HTTPMethod.GET,
        path: `/api/v4/channels/${channelId}/members/${userId}`,
        retry: true,
      });

      return true;
    } catch (err) {
      if (MattermostUtil.isNotFoundError(err)) {
        return false;
      }

      throw err;
    }
  }

  /*
   * Archives each channel, with a last message in it first. A channel
   * Mattermost would not archive is logged, and the others are archived
   * all the same.
   */
  @CaptureSpan()
  public static override async archiveChannels(data: {
    channelIds: Array<string>;
    authToken: string;
    userId: string;
    sendMessageBeforeArchiving: WorkspacePayloadMarkdown;
    projectId: ObjectID;
  }): Promise<void> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    const logAttributes: LogAttributes = {
      projectId: data.projectId?.toString(),
    };

    for (const channelId of data.channelIds) {
      try {
        const id: string = MattermostConnection.assertMattermostId(
          channelId,
          "channel",
        );

        if (data.sendMessageBeforeArchiving) {
          try {
            await MattermostUtil.postToChannel({
              connection: connection,
              channelId: id,
              post: MattermostUtil.toPost({
                blocks: MattermostUtil.getBlocksFromWorkspaceMessagePayload({
                  messageBlocks: [data.sendMessageBeforeArchiving],
                }),
                teamId: connection.teamId,
              }),
            });
          } catch (err) {
            logger.warn(
              `Could not post the last message in Mattermost channel ${id} before archiving it.`,
              logAttributes,
            );
            logger.warn(err, logAttributes);
          }
        }

        await MattermostUtil.callServer<JSONObject>({
          ...connection,
          method: HTTPMethod.DELETE,
          path: `/api/v4/channels/${id}`,
        });
      } catch (err) {
        logger.error(
          `Could not archive Mattermost channel ${channelId}.`,
          logAttributes,
        );
        logger.error(err, logAttributes);
      }
    }
  }

  // MESSAGES

  /*
   * Posts a message in each channel it names, once a channel, as the
   * project's bot. Each post is recorded for the platform's operator
   * (WorkspaceChannelPosts): a success or a failure for every channel it
   * was posted in or not - one that could not be found or read among them
   * - and, when the message fails as a whole before every channel was
   * tried, a failure for each left.
   *
   * A channel named is looked for in the team the payload names - a
   * rule's - else in the default team first (findChannelByName). Each
   * post's buttons are signed for the team of the channel it is in.
   */
  @CaptureSpan()
  public static override async sendMessage(data: {
    workspaceMessagePayload: WorkspaceMessagePayload;
    authToken: string;
    userId: string;
    projectId: ObjectID;
    teamId?: string;
  }): Promise<WorkspaceSendMessageResponse> {
    const posts: WorkspaceChannelPosts = new WorkspaceChannelPosts({
      workspaceType: WorkspaceType.Mattermost,
      payload: data.workspaceMessagePayload,
    });

    try {
      return await MattermostUtil.postMessageInChannels(data, posts);
    } catch (err) {
      posts.recordRestAsFailed();
      throw err;
    }
  }

  private static async postMessageInChannels(
    data: {
      workspaceMessagePayload: WorkspaceMessagePayload;
      authToken: string;
      userId: string;
      projectId: ObjectID;
      teamId?: string;
    },
    posts: WorkspaceChannelPosts,
  ): Promise<WorkspaceSendMessageResponse> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    const logAttributes: LogAttributes = {
      projectId: data.projectId?.toString(),
    };

    /*
     * A screenshot in the message's Markdown would be megabytes of base64
     * in the post: it is its alt text instead (WorkspaceInlineImages).
     */
    const blocks: Array<JSONObject> = this.getBlocksFromWorkspaceMessagePayload(
      {
        messageBlocks: WorkspaceInlineImages.splitMessageBlocks(
          data.workspaceMessagePayload.messageBlocks,
        ),
      },
    );

    const response: WorkspaceSendMessageResponse = {
      threads: [],
      workspaceType: WorkspaceType.Mattermost,
      errors: [],
    };

    const channels: Array<MattermostChannel> = [];

    for (const channelName of data.workspaceMessagePayload.channelNames) {
      try {
        const channel: MattermostChannel | null =
          await MattermostUtil.findChannelByName({
            authToken: data.authToken,
            channelName: channelName,
            teamId: data.workspaceMessagePayload.teamId,
          });

        if (channel) {
          channels.push(channel);
        } else {
          posts.recordChannelNotFound();
          response.errors!.push({
            channel: {
              id: "",
              name: channelName,
              workspaceType: WorkspaceType.Mattermost,
            },
            error: WorkspaceChannelNotFound.getReason({
              workspaceType: WorkspaceType.Mattermost,
              channelName: channelName,
            }),
          });
        }
      } catch (err) {
        posts.recordChannelNotFound();
        response.errors!.push({
          channel: {
            id: "",
            name: channelName,
            workspaceType: WorkspaceType.Mattermost,
          },
          error: WorkspaceBase.getSendErrorMessage(err),
        });
      }
    }

    for (const channelId of data.workspaceMessagePayload.channelIds) {
      try {
        channels.push(
          await MattermostUtil.getChannel({
            authToken: data.authToken,
            channelId: channelId,
          }),
        );
      } catch (err) {
        // Not posted in - unless it is a channel the message is not for.
        posts.recordChannelNotFound(channelId);
        response.errors!.push({
          channel: {
            id: channelId,
            name: channelId,
            workspaceType: WorkspaceType.Mattermost,
          },
          error: WorkspaceBase.getSendErrorMessage(err),
        });
      }
    }

    const exceptChannelIds: Array<string> =
      data.workspaceMessagePayload.exceptChannelIds || [];

    const postedChannelIds: Set<string> = new Set<string>();

    for (const channel of channels) {
      if (
        exceptChannelIds.includes(channel.id) ||
        postedChannelIds.has(channel.id)
      ) {
        continue;
      }

      postedChannelIds.add(channel.id);

      const channelPost: WorkspaceChannelPost = posts.startPost();

      try {
        const thread: WorkspaceThread = await MattermostUtil.postInChannel({
          connection: connection,
          channel: channel,
          post: MattermostUtil.toPost({
            blocks: blocks,
            ...MattermostUtil.getPostSigning({
              connection: connection,
              channel: channel,
            }),
            text: data.workspaceMessagePayload.text,
          }),
        });

        channelPost.succeeded();
        response.threads.push(thread);
      } catch (err) {
        channelPost.failed();
        logger.error(
          `Could not post in Mattermost channel ${channel.id}.`,
          logAttributes,
        );
        logger.error(err, logAttributes);

        response.errors!.push({
          channel: {
            id: channel.id,
            name: channel.name,
            workspaceType: WorkspaceType.Mattermost,
          },
          error: WorkspaceBase.getSendErrorMessage(err),
        });
      }
    }

    return response;
  }

  /*
   * Posts in a channel. The bot posts in a public channel only as a
   * member, so a post Mattermost refuses there is made again once the bot
   * has joined: the first post in a channel, which no rule could know it
   * had not joined yet. A private channel it is not in stays refused - only
   * somebody in it can add the bot.
   */
  private static async postInChannel(data: {
    connection: MattermostConnectionData;
    channel: MattermostChannel;
    post: JSONObject;
  }): Promise<WorkspaceThread> {
    try {
      return await MattermostUtil.postToChannel({
        connection: data.connection,
        channelId: data.channel.id,
        post: data.post,
        channel: data.channel,
      });
    } catch (err) {
      if (!MattermostUtil.isForbiddenError(err)) {
        throw err;
      }

      if (data.channel.type !== "O") {
        throw new BadDataException(
          `OneUptime's bot is not a member of the private Mattermost channel ${data.channel.displayName}. Add the bot to the channel in Mattermost, then try again.`,
        );
      }

      await MattermostUtil.joinChannel({
        authToken: MattermostConnection.toAuthToken(data.connection),
        channelId: data.channel.id,
      });

      return await MattermostUtil.postToChannel({
        connection: data.connection,
        channelId: data.channel.id,
        post: data.post,
        channel: data.channel,
      });
    }
  }

  private static async postToChannel(data: {
    connection: MattermostConnectionData;
    channelId: string;
    post: JSONObject;
    channel?: MattermostChannel | undefined;
  }): Promise<WorkspaceThread> {
    const created: JSONObject = await MattermostUtil.callServer<JSONObject>({
      ...data.connection,
      method: HTTPMethod.POST,
      path: "/api/v4/posts",
      body: {
        ...data.post,
        channel_id: data.channelId,
      },
    });

    const postId: unknown = created["id"];

    if (!MattermostConnection.isMattermostId(postId)) {
      throw new BadDataException(
        "Mattermost answered with a post OneUptime could not read.",
      );
    }

    return {
      channel: data.channel
        ? {
            id: data.channel.id,
            name: data.channel.name,
            workspaceType: WorkspaceType.Mattermost,
            ...(data.channel.teamId ? { teamId: data.channel.teamId } : {}),
          }
        : {
            id: data.channelId,
            name: data.channelId,
            workspaceType: WorkspaceType.Mattermost,
          },
      threadId: postId,
    };
  }

  @CaptureSpan()
  public static override async sendPayloadBlocksToChannel(data: {
    authToken: string;
    workspaceChannel: WorkspaceChannel;
    blocks: Array<JSONObject>;
    text?: string | undefined;
  }): Promise<WorkspaceThread> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    const channel: MattermostChannel = await MattermostUtil.getChannel({
      authToken: data.authToken,
      channelId: data.workspaceChannel.id,
    });

    return await MattermostUtil.postInChannel({
      connection: connection,
      channel: channel,
      post: MattermostUtil.toPost({
        blocks: data.blocks,
        ...MattermostUtil.getPostSigning({
          connection: connection,
          channel: channel,
        }),
        text: data.text,
      }),
    });
  }

  /*
   * Edits a post the bot made, in place: it keeps its place in the
   * channel, and nobody is notified again. Its buttons are signed as a new
   * post's in its channel would be (getPostSigning): for the team the
   * location names, else as the channel says - read for it, so a direct
   * message's buttons keep working after an edit.
   */
  @CaptureSpan()
  public static override async updateMessage(data: {
    authToken: string;
    projectId: ObjectID;
    location: WorkspaceMessageLocation;
    messageId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
    text?: string | undefined;
  }): Promise<void> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    const postId: string = MattermostConnection.assertMattermostId(
      data.messageId,
      "post",
    );

    const signing: MattermostPostSigning =
      await MattermostUtil.getPostSigningOfLocation({
        connection: connection,
        authToken: data.authToken,
        location: data.location,
      });

    const post: JSONObject = MattermostUtil.toPost({
      blocks: this.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: WorkspaceInlineImages.splitMessageBlocks(
          data.messageBlocks,
        ),
      }),
      ...signing,
      text: data.text,
    });

    await MattermostUtil.callServer<JSONObject>({
      ...connection,
      method: HTTPMethod.PUT,
      path: `/api/v4/posts/${postId}/patch`,
      body: {
        message: post["message"] as string,
        props: (post["props"] as JSONObject) || {},
      },
      retry: true,
    });
  }

  /*
   * What a kept post's buttons are signed for: the team its location names,
   * else as its channel says (getPostSigning). A channel that cannot be
   * read is the connection's default team's: the edit itself then says
   * what became of the post.
   */
  private static async getPostSigningOfLocation(data: {
    connection: MattermostConnectionData;
    authToken: string;
    location: WorkspaceMessageLocation;
  }): Promise<MattermostPostSigning> {
    if (MattermostConnection.isMattermostId(data.location.teamId)) {
      return { teamId: data.location.teamId };
    }

    try {
      return MattermostUtil.getPostSigning({
        connection: data.connection,
        channel: await MattermostUtil.getChannel({
          authToken: data.authToken,
          channelId: data.location.channelId,
        }),
      });
    } catch (err) {
      logger.debug(
        "Could not read the Mattermost channel of a post being edited; its buttons are signed for the default team.",
      );
      logger.debug(err);
      return { teamId: data.connection.teamId };
    }
  }

  // A post somebody deleted is answered as not found: a new one has to be posted.
  public static override isMessageGoneError(error: unknown): boolean {
    return MattermostUtil.isNotFoundError(error);
  }

  /*
   * A direct message from the bot to an account. Its buttons are signed for
   * its own channel (MattermostActionContext): a press in a direct message
   * names no team. Says where it landed: the direct message channel and the
   * post's id, what an edit of it names.
   */
  @CaptureSpan()
  public static override async sendDirectMessageToUser(data: {
    authToken: string;
    workspaceUserId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): Promise<WorkspaceDirectMessageLocation | null> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    const channelId: string = await MattermostUtil.getDirectChannelId({
      connection: connection,
      workspaceUserId: data.workspaceUserId,
    });

    const thread: WorkspaceThread = await MattermostUtil.postToChannel({
      connection: connection,
      channelId: channelId,
      post: MattermostUtil.toPost({
        blocks: this.getBlocksFromWorkspaceMessagePayload({
          messageBlocks: WorkspaceInlineImages.splitMessageBlocks(
            data.messageBlocks,
          ),
        }),
        teamId: connection.teamId,
        directMessageChannelId: channelId,
      }),
    });

    return thread.threadId
      ? { channelId: channelId, messageId: thread.threadId }
      : null;
  }

  // The direct message channel between the bot and an account, made if it has none.
  private static async getDirectChannelId(data: {
    connection: MattermostConnectionData;
    workspaceUserId: string;
  }): Promise<string> {
    const userId: string = MattermostConnection.assertMattermostId(
      data.workspaceUserId,
      "user",
    );

    const channel: JSONObject = await MattermostUtil.callServer<JSONObject>({
      ...data.connection,
      method: HTTPMethod.POST,
      path: "/api/v4/channels/direct",
      // The two accounts, as Mattermost takes them: a list of ids.
      body: [data.connection.botUserId, userId] as unknown as JSONArray,
      retry: true,
    });

    const channelId: unknown = channel["id"];

    if (!MattermostConnection.isMattermostId(channelId)) {
      throw new BadDataException(
        "Mattermost answered with a direct message channel OneUptime could not read.",
      );
    }

    return channelId;
  }

  /*
   * Opens a form (an interactive dialog) for whoever pressed a button: the
   * trigger id of the press says whom, and is good for a few seconds only.
   * The form's submission comes back to MATTERMOST_DIALOG_PATH with its
   * action and value in its signed state.
   */
  @CaptureSpan()
  public static override async showModalToUser(data: {
    authToken: string;
    triggerId: string;
    modalBlock: WorkspaceModalBlock;
    /*
     * The direct message the press that opens it was made in: the form is
     * held to its channel, as the message's buttons are.
     */
    directMessageChannelId?: string | undefined;
    /*
     * The team the press that opens it came from: its submission names the
     * team it is sent from, which the form is signed for. The default team
     * for none.
     */
    teamId?: string | undefined;
  }): Promise<void> {
    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(data.authToken);

    if (
      typeof data.triggerId !== "string" ||
      !data.triggerId ||
      data.triggerId.length > 1000
    ) {
      throw new BadDataException("The Mattermost trigger id is not valid.");
    }

    const dialog: JSONObject = MattermostUtil.getDialog({
      modalBlock: data.modalBlock,
      teamId: data.teamId
        ? MattermostConnection.assertMattermostId(data.teamId, "team")
        : connection.teamId,
      directMessageChannelId: data.directMessageChannelId,
    });

    await MattermostUtil.callServer<JSONObject>({
      ...connection,
      method: HTTPMethod.POST,
      path: "/api/v4/actions/dialogs/open",
      body: {
        trigger_id: data.triggerId,
        url: MattermostUtil.getIntegrationUrl(MATTERMOST_DIALOG_PATH),
        dialog: dialog,
      },
    });
  }

  /*
   * Posts Markdown to an incoming webhook a Mattermost admin made: the
   * message a status page subscriber or a workflow sends. The webhook's
   * address was typed by a person, so it is held to what OneUptime may
   * reach (SSRFProtection), strictly unless the caller says it was typed by
   * a member of the project, and a redirect is never followed. Recorded for
   * the platform's operator (WorkspaceDeliveryMetrics): a success when
   * Mattermost took it, a failure when it did not, or the address was
   * refused.
   */
  @CaptureSpan()
  public static override async sendMessageToChannelViaIncomingWebhook(data: {
    url: URL;
    text: string;
    // Whose webhook it is: a project's, unless said otherwise.
    providerConfig?: NotificationProviderConfig | undefined;
    // False for a post that is no notification (a workflow's step): not counted.
    isNotification?: boolean | undefined;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    return await WorkspaceDeliveryMetrics.measureIncomingWebhookPost(
      {
        workspaceType: WorkspaceType.Mattermost,
        providerConfig: data.providerConfig,
        isNotification: data.isNotification,
      },
      async (): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        await SSRFProtection.validateWebhookTargetIsSafe(data.url.toString(), {
          targetLabel: "Mattermost webhook URL",
        });

        return await API.post<JSONObject>({
          url: data.url,
          data: {
            text: MattermostUtil.getMessageText(data.text),
          },
          options: {
            retries: 3,
            exponentialBackoff: true,
            doNotFollowRedirects: true,
          },
        });
      },
    );
  }

  // RENDERING

  // The absolute address on OneUptime's API that Mattermost POSTs to.
  public static getIntegrationUrl(path: string): string {
    return `${AppApiClientUrl.toString().replace(/\/+$/, "")}${path}`;
  }

  /*
   * Markdown as Mattermost takes it in a post: every mention broken, so a
   * name or a description that holds "@channel" or "@alice" notifies
   * nobody (neutralizeMentions), and held to what a post takes, ending
   * with a note when it was cut (MESSAGE_MAX_LENGTH).
   *
   * A moment in it is the time in UTC (WorkspaceMessageTime.toPlainText):
   * Mattermost has no way to show one in each reader's own zone, and showed
   * "{{TIME(2026-11-13T17:50:00Z)}}" as it was written - an on-call
   * handoff's "until" among them (issue #7549).
   *
   * It is cut first and its mentions broken after, in one pass each, so a
   * text of any length is handled in time linear in what is posted.
   */
  public static getMessageText(markdown: string): string {
    const cut: string = fitTextToLength(
      WorkspaceMessageTime.toPlainText(markdown || ""),
      MattermostUtil.MESSAGE_MAX_LENGTH,
    );

    return fitTextToLength(
      MattermostUtil.neutralizeMentions(cut),
      MattermostUtil.MESSAGE_MAX_LENGTH,
    );
  }

  /*
   * The text with every mention Mattermost could read broken by an
   * invisible word joiner: "@" at the start of a word, before a letter or a
   * digit. "alice@example.com" is no mention and keeps its characters, and
   * so does an "@" in a web address ("https://example.com/@alice"), which a
   * joiner would break. Scanned with a loop: the text can be long.
   */
  public static neutralizeMentions(text: string): string {
    // What a request sent may be anything: only a string's length bounds the loop.
    if (typeof text !== "string") {
      return "";
    }

    if (text.indexOf("@") === -1) {
      return text;
    }

    let result: string = "";
    let copiedUpTo: number = 0;
    // Whether the word being read is a web address: "://" came after its start.
    let isInAddress: boolean = false;

    for (let index: number = 0; index < text.length; index++) {
      const character: string = text[index]!;

      if (MattermostUtil.endsWord(character)) {
        isInAddress = false;
        continue;
      }

      if (
        character === ":" &&
        text[index + 1] === "/" &&
        text[index + 2] === "/"
      ) {
        isInAddress = true;
        continue;
      }

      if (character !== "@" || isInAddress) {
        continue;
      }

      const previous: string | undefined = index > 0 ? text[index - 1] : "";
      const next: string | undefined = text[index + 1];

      if (
        next !== undefined &&
        MattermostUtil.isLetterOrDigit(next) &&
        !MattermostUtil.isWordCharacter(previous || "")
      ) {
        result += text.slice(copiedUpTo, index + 1) + WORD_JOINER;
        copiedUpTo = index + 1;
      }
    }

    if (copiedUpTo === 0) {
      return text;
    }

    return result + text.slice(copiedUpTo);
  }

  // A character a web address cannot run past: white space, or what opens a link.
  private static endsWord(character: string): boolean {
    return (
      character === " " ||
      character === "\n" ||
      character === "\r" ||
      character === "\t" ||
      character === "(" ||
      character === "<" ||
      character === "["
    );
  }

  private static isLetterOrDigit(character: string): boolean {
    const code: number = character.charCodeAt(0);

    return (
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    );
  }

  private static isWordCharacter(character: string): boolean {
    return MattermostUtil.isLetterOrDigit(character) || character === "_";
  }

  /*
   * The post a message's pieces make: their Markdown as its message, and
   * their buttons, links and menu in an attachment under it. Each button
   * and menu carries a context signed for the team of the channel it is
   * posted in, or a direct message's channel (MattermostActionContext);
   * Mattermost POSTs it back when it is pressed.
   */
  public static toPost(data: {
    blocks: Array<JSONObject>;
    teamId: string;
    // What a notification shows when the post has no Markdown of its own.
    text?: string | undefined;
    // A direct message's channel: its buttons are signed for it.
    directMessageChannelId?: string | undefined;
  }): JSONObject {
    const texts: Array<string> = [];
    const actions: Array<JSONObject> = [];
    const links: Array<string> = [];
    const integrationUrl: string = MattermostUtil.getIntegrationUrl(
      MATTERMOST_INTERACTIVE_PATH,
    );

    for (const block of data.blocks) {
      const piece: MattermostPiece = block as unknown as MattermostPiece;

      if (piece.piece === "markdown") {
        if (piece.text) {
          texts.push(piece.text);
        }

        continue;
      }

      if (piece.piece !== "actions") {
        continue;
      }

      for (const link of piece.links) {
        links.push(mdText`[${link.title}](${link.url})`.toString());
      }

      for (const button of piece.buttons) {
        actions.push({
          // Mattermost takes letters and digits only, unique in the post.
          id: `oneuptime${actions.length}`,
          name: MattermostUtil.cutPlainText(
            button.title,
            MattermostUtil.BUTTON_TITLE_MAX_LENGTH,
          ),
          type: "button",
          style: button.isPrimary ? "primary" : "default",
          integration: {
            url: integrationUrl,
            context: MattermostActionContext.toContext({
              teamId: data.teamId,
              channelId: data.directMessageChannelId,
              actions: [{ actionId: button.actionId, value: button.value }],
            }),
          },
        });
      }

      const menu: Array<MattermostButtonPiece> = piece.menu.slice(
        0,
        MAX_ACTIONS_PER_CONTEXT,
      );

      if (menu.length > 0) {
        actions.push({
          id: `oneuptime${actions.length}`,
          name: "More actions…",
          type: "select",
          options: menu.map(
            (option: MattermostButtonPiece, index: number): JSONObject => {
              return {
                text: MattermostUtil.cutPlainText(
                  option.title,
                  MattermostUtil.BUTTON_TITLE_MAX_LENGTH,
                ),
                value: index.toString(),
              };
            },
          ),
          integration: {
            url: integrationUrl,
            context: MattermostActionContext.toContext({
              teamId: data.teamId,
              channelId: data.directMessageChannelId,
              actions: menu.map((option: MattermostButtonPiece) => {
                return { actionId: option.actionId, value: option.value };
              }),
            }),
          },
        });
      }
    }

    let message: string = MattermostUtil.getMessageText(texts.join("\n\n"));

    if (!message.trim() && data.text) {
      message = MattermostUtil.getMessageText(data.text);
    }

    const post: JSONObject = { message: message };

    if (actions.length > 0 || links.length > 0) {
      const attachment: JSONObject = {
        fallback: MattermostUtil.cutPlainText(
          data.text || "OneUptime",
          MattermostUtil.NOTIFICATION_TEXT_MAX_LENGTH,
        ),
        text: MattermostUtil.neutralizeMentions(links.join(" · ")),
      };

      if (actions.length > 0) {
        attachment["actions"] = actions;
      }

      post["props"] = { attachments: [attachment] };
    }

    return post;
  }

  // Plain text, cut to `maxLength` characters with "…" at its end when it is longer.
  public static cutPlainText(text: string, maxLength: number): string {
    return fitTextToLength((text || "").trim(), maxLength, "…");
  }

  @CaptureSpan()
  public static override getHeaderBlock(data: {
    payloadHeaderBlock: WorkspacePayloadHeader;
  }): JSONObject {
    return MattermostUtil.markdownPiece(
      mdText`#### ${data.payloadHeaderBlock.text}`.toString(),
    );
  }

  @CaptureSpan()
  public static override getMarkdownBlock(data: {
    payloadMarkdownBlock: WorkspacePayloadMarkdown;
  }): JSONObject {
    return MattermostUtil.markdownPiece(data.payloadMarkdownBlock.text || "");
  }

  @CaptureSpan()
  public static override getContextBlock(data: {
    payloadContextBlock: WorkspacePayloadContext;
  }): JSONObject {
    return MattermostUtil.markdownPiece(data.payloadContextBlock.text || "");
  }

  @CaptureSpan()
  public static override getDividerBlock(): JSONObject {
    return MattermostUtil.markdownPiece("---");
  }

  @CaptureSpan()
  public static override getImageBlock(data: {
    payloadImageBlock: WorkspacePayloadImage;
  }): JSONObject {
    return MattermostUtil.markdownPiece(
      mdText`![${data.payloadImageBlock.altText}](${data.payloadImageBlock.imageUrl.toString()})`.toString(),
    );
  }

  @CaptureSpan()
  public static override getButtonsBlock(data: {
    payloadButtonsBlock: WorkspacePayloadButtons;
  }): JSONObject {
    const buttons: Array<MattermostButtonPiece> = [];
    const links: Array<{ title: string; url: string }> = [];
    const menu: Array<MattermostButtonPiece> = [];

    for (const button of data.payloadButtonsBlock.buttons) {
      // A link button: Mattermost's buttons only POST, so it is a link beside them.
      if (button.url) {
        links.push({ title: button.title, url: button.url.toString() });
        continue;
      }

      // Only what OneUptime acts on in Mattermost (MattermostActionTypes).
      if (isMattermostAction(button.actionId)) {
        buttons.push(MattermostUtil.buttonPiece(button));
      }
    }

    for (const button of data.payloadButtonsBlock.menuButtons || []) {
      if (button.url) {
        links.push({ title: button.title, url: button.url.toString() });
        continue;
      }

      if (isMattermostAction(button.actionId)) {
        menu.push(MattermostUtil.buttonPiece(button));
      }
    }

    return {
      piece: "actions",
      buttons: buttons,
      links: links,
      menu: menu,
    } as unknown as JSONObject;
  }

  @CaptureSpan()
  public static override getButtonBlock(data: {
    payloadButtonBlock: WorkspaceMessagePayloadButton;
  }): JSONObject {
    return MattermostUtil.getButtonsBlock({
      payloadButtonsBlock: {
        _type: "WorkspacePayloadButtons",
        buttons: [data.payloadButtonBlock],
      },
    });
  }

  private static buttonPiece(
    button: WorkspaceMessagePayloadButton,
  ): MattermostButtonPiece {
    return {
      title: button.title,
      actionId: button.actionId,
      value: button.value || "",
      isPrimary: Boolean(button.isPrimary),
    };
  }

  private static markdownPiece(text: string): JSONObject {
    return { piece: "markdown", text: text } as unknown as JSONObject;
  }

  /*
   * The blocks of a message, as the pieces toPost puts together. A
   * screenshot split out of the Markdown (WorkspacePayloadInlineImage) is
   * its fallback Markdown: its alt text.
   */
  @CaptureSpan()
  public static override getBlocksFromWorkspaceMessagePayload(data: {
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): Array<JSONObject> {
    const pieces: Array<JSONObject> = [];

    for (const block of data.messageBlocks) {
      if (block._type === "WorkspacePayloadInlineImage") {
        const fallback: string = (block as WorkspacePayloadInlineImage)
          .fallbackMarkdown;

        if (fallback) {
          pieces.push(MattermostUtil.markdownPiece(fallback));
        }

        continue;
      }

      if (block._type === "WorkspaceCheckboxBlock") {
        pieces.push(
          MattermostUtil.getCheckboxBlock({
            payloadCheckboxBlock: block as WorkspaceCheckboxBlock,
          }),
        );

        continue;
      }

      pieces.push(
        ...super.getBlocksFromWorkspaceMessagePayload({
          messageBlocks: [block],
        }),
      );
    }

    return pieces;
  }

  // FORMS: a modal is a Mattermost interactive dialog, its blocks its elements.

  @CaptureSpan()
  public static override getModalBlock(data: {
    payloadModalBlock: WorkspaceModalBlock;
  }): JSONObject {
    return {
      piece: "dialog",
      dialog: MattermostUtil.getDialogWithoutState(data.payloadModalBlock),
    } as unknown as JSONObject;
  }

  /*
   * The interactive dialog a form is: its title, its fields and its submit
   * button, and as its state the action and value its submission is for,
   * signed for the team (MattermostActionContext.toDialogState).
   */
  public static getDialog(data: {
    modalBlock: WorkspaceModalBlock;
    teamId: string;
    // Opened from a direct message: held to its channel.
    directMessageChannelId?: string | undefined;
  }): JSONObject {
    return {
      ...MattermostUtil.getDialogWithoutState(data.modalBlock),
      state: MattermostActionContext.toDialogState({
        teamId: data.teamId,
        ...(data.directMessageChannelId
          ? { channelId: data.directMessageChannelId }
          : {}),
        actionId: data.modalBlock.actionId,
        value: data.modalBlock.actionValue || "",
      }),
    };
  }

  private static getDialogWithoutState(
    modalBlock: WorkspaceModalBlock,
  ): JSONObject {
    const elements: Array<JSONObject> = [];
    const markdownLines: Array<string> = [];

    for (const piece of MattermostUtil.getBlocksFromWorkspaceMessagePayload({
      messageBlocks: modalBlock.blocks,
    })) {
      const mattermostPiece: MattermostPiece =
        piece as unknown as MattermostPiece;

      if (mattermostPiece.piece === "element") {
        elements.push(mattermostPiece.element);
      } else if (mattermostPiece.piece === "markdown" && mattermostPiece.text) {
        markdownLines.push(mattermostPiece.text);
      }
    }

    const dialog: JSONObject = {
      callback_id: modalBlock.actionId,
      title: MattermostUtil.cutPlainText(
        modalBlock.title,
        MattermostUtil.DIALOG_TITLE_MAX_LENGTH,
      ),
      submit_label: MattermostUtil.cutPlainText(
        modalBlock.submitButtonTitle || "Submit",
        MattermostUtil.BUTTON_TITLE_MAX_LENGTH,
      ),
      notify_on_cancel: false,
      elements: elements,
    };

    // Text a form shows above its fields: its introduction.
    if (markdownLines.length > 0) {
      dialog["introduction_text"] = MattermostUtil.getMessageText(
        markdownLines.join("\n\n"),
      );
    }

    return dialog;
  }

  private static elementPiece(element: JSONObject): JSONObject {
    return { piece: "element", element: element } as unknown as JSONObject;
  }

  // What every field of a dialog has: its name, its label, its help text, whether it may be left empty.
  private static getElementBase(data: {
    blockId: string;
    label: string;
    description?: string | undefined;
    optional?: boolean | undefined;
  }): JSONObject {
    const element: JSONObject = {
      name: data.blockId,
      display_name: MattermostUtil.cutPlainText(
        data.label,
        MattermostUtil.DIALOG_LABEL_MAX_LENGTH,
      ),
      optional: Boolean(data.optional),
    };

    // A label cut short is shown whole as the help text, unless the field has its own.
    const helpText: string =
      data.description ||
      (data.label.trim().length > MattermostUtil.DIALOG_LABEL_MAX_LENGTH
        ? data.label
        : "");

    if (helpText) {
      element["help_text"] = MattermostUtil.cutPlainText(
        helpText,
        MattermostUtil.DIALOG_HELP_TEXT_MAX_LENGTH,
      );
    }

    return element;
  }

  @CaptureSpan()
  public static override getTextAreaBlock(data: {
    payloadTextAreaBlock: WorkspaceTextAreaBlock;
  }): JSONObject {
    const block: WorkspaceTextAreaBlock = data.payloadTextAreaBlock;

    const element: JSONObject = {
      ...MattermostUtil.getElementBase(block),
      type: "textarea",
      placeholder: MattermostUtil.cutPlainText(
        block.placeholder || "",
        MattermostUtil.DIALOG_TEXT_MAX_LENGTH,
      ),
      max_length: Math.min(
        block.maxLength || MattermostUtil.DIALOG_TEXTAREA_MAX_LENGTH,
        MattermostUtil.DIALOG_TEXTAREA_MAX_LENGTH,
      ),
    };

    if (block.initialValue) {
      element["default"] = MattermostUtil.cutPlainText(
        block.initialValue,
        MattermostUtil.DIALOG_TEXTAREA_MAX_LENGTH,
      );
    }

    return MattermostUtil.elementPiece(element);
  }

  @CaptureSpan()
  public static override getTextBoxBlock(data: {
    payloadTextBoxBlock: WorkspaceTextBoxBlock;
  }): JSONObject {
    const block: WorkspaceTextBoxBlock = data.payloadTextBoxBlock;

    const element: JSONObject = {
      ...MattermostUtil.getElementBase(block),
      type: "text",
      placeholder: MattermostUtil.cutPlainText(
        block.placeholder || "",
        MattermostUtil.DIALOG_TEXT_MAX_LENGTH,
      ),
      max_length: MattermostUtil.DIALOG_TEXT_MAX_LENGTH,
    };

    if (block.initialValue) {
      element["default"] = MattermostUtil.cutPlainText(
        block.initialValue,
        MattermostUtil.DIALOG_TEXT_MAX_LENGTH,
      );
    }

    return MattermostUtil.elementPiece(element);
  }

  @CaptureSpan()
  public static override getNumberInputBlock(data: {
    payloadNumberInputBlock: WorkspaceNumberInputBlock;
  }): JSONObject {
    const block: WorkspaceNumberInputBlock = data.payloadNumberInputBlock;

    const element: JSONObject = {
      ...MattermostUtil.getElementBase(block),
      type: "text",
      subtype: "number",
      placeholder: MattermostUtil.cutPlainText(
        block.placeholder || "",
        MattermostUtil.DIALOG_TEXT_MAX_LENGTH,
      ),
    };

    if (block.initialValue) {
      element["default"] = block.initialValue;
    }

    return MattermostUtil.elementPiece(element);
  }

  // A day: a text field that takes it as 2026-10-15.
  @CaptureSpan()
  public static override getDatePickerBlock(data: {
    payloadDatePickerBlock: WorkspaceDatePickerBlock;
  }): JSONObject {
    const block: WorkspaceDatePickerBlock = data.payloadDatePickerBlock;

    const element: JSONObject = {
      ...MattermostUtil.getElementBase({
        ...block,
        description:
          block.description || "As YYYY-MM-DD, for example 2026-10-15.",
      }),
      type: "text",
      placeholder: block.placeholder || "YYYY-MM-DD",
    };

    if (block.initialDate) {
      element["default"] = block.initialDate;
    }

    return MattermostUtil.elementPiece(element);
  }

  // A moment: a text field that takes it as 2026-10-15 14:30 UTC.
  @CaptureSpan()
  public static override getDateTimePickerBlock(data: {
    payloadDateTimePickerBlock: WorkspaceDateTimePickerBlock;
  }): JSONObject {
    const block: WorkspaceDateTimePickerBlock = data.payloadDateTimePickerBlock;

    const element: JSONObject = {
      ...MattermostUtil.getElementBase({
        ...block,
        description:
          block.description ||
          "As YYYY-MM-DD HH:mm in UTC, for example 2026-10-15 14:30.",
      }),
      type: "text",
      placeholder: "YYYY-MM-DD HH:mm",
    };

    const initial: Date | undefined = block.initialDateTime;

    if (initial && !isNaN(initial.getTime())) {
      element["default"] = initial
        .toISOString()
        .substring(0, 16)
        .replace("T", " ");
    } else if (block.initialValue) {
      element["default"] = block.initialValue;
    }

    return MattermostUtil.elementPiece(element);
  }

  @CaptureSpan()
  public static override getCheckboxBlock(data: {
    payloadCheckboxBlock: WorkspaceCheckboxBlock;
  }): JSONObject {
    const block: WorkspaceCheckboxBlock = data.payloadCheckboxBlock;

    return MattermostUtil.elementPiece({
      ...MattermostUtil.getElementBase(block),
      type: "bool",
      placeholder: MattermostUtil.cutPlainText(
        block.label,
        MattermostUtil.DIALOG_TEXT_MAX_LENGTH,
      ),
      default: block.initialValue ? "true" : "false",
    });
  }

  /*
   * A menu: its options, those of each group one after another with the
   * group's name in front ("People: Alice"). A dialog's menu picks one
   * option, so a multi-select picks one too, and opens on the first of its
   * picks.
   */
  @CaptureSpan()
  public static override getDropdownBlock(data: {
    payloadDropdownBlock: WorkspaceDropdownBlock;
  }): JSONObject {
    const block: WorkspaceDropdownBlock = data.payloadDropdownBlock;

    const options: Array<JSONObject> = [];

    const addOption: (option: DropdownOption, group?: string) => void = (
      option: DropdownOption,
      group?: string,
    ): void => {
      if (options.length >= MattermostUtil.DIALOG_MAX_OPTIONS) {
        return;
      }

      const label: string = String(option.label ?? option.value ?? "");

      options.push({
        text: MattermostUtil.cutPlainText(
          group ? `${group}: ${label}` : label,
          MattermostUtil.BUTTON_TITLE_MAX_LENGTH,
        ),
        value: String(option.value ?? ""),
      });
    };

    if (block.optionGroups && block.optionGroups.length > 0) {
      for (const group of block.optionGroups) {
        for (const option of group.options) {
          addOption(option, group.label);
        }
      }
    } else {
      for (const option of block.options || []) {
        addOption(option);
      }
    }

    const element: JSONObject = {
      ...MattermostUtil.getElementBase(block),
      type: "select",
      placeholder: MattermostUtil.cutPlainText(
        block.placeholder || "",
        MattermostUtil.DIALOG_TEXT_MAX_LENGTH,
      ),
      options: options,
    };

    const initialValue: string | undefined =
      block.initialValue || block.initialValues?.[0];

    if (initialValue) {
      element["default"] = initialValue;
    }

    return MattermostUtil.elementPiece(element);
  }
}
