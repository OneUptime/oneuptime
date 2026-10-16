import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * WHO IS IN A SLACK CHANNEL, AND INVITING SOMEBODY INTO ONE.
 *
 * What OneUptime asks of Slack's Web API to show a record's channel with the
 * people in it, and to add people to it (WorkspaceChannelMembers decides
 * which channel and who):
 *
 * - conversations.info         is the channel private, archived, is the app
 *                              in it (channels:read, groups:read)
 * - conversations.members      who is in it (channels:read, groups:read)
 * - users.info                 a name for somebody OneUptime does not know,
 *                              and whether they are a bot (users:read; their
 *                              email with users:read.email)
 * - users.lookupByEmail        the Slack account of a OneUptime member who has
 *                              not connected theirs (users:read.email)
 * - conversations.invite       one person a request, so each gets an answer
 *                              of their own (channels:write.invites for a
 *                              public channel, groups:write for a private one)
 * - conversations.join         a public channel the app was taken out of: it
 *                              joins before it invites, as it does before it
 *                              posts (channels:join)
 *
 * Every one of them is a scope the app asks for already, so nothing here
 * asks a workspace to install the app again. A private channel can only be
 * read and invited into while the app is in it - Slack answers
 * channel_not_found for one it was removed from, as for one deleted.
 *
 * One try each, no retries: a person is waiting on the page for the answer,
 * and a refusal is told to them as it is.
 */

// A channel, as conversations.info tells it.
export interface SlackChannelFacts {
  id: string;
  name: string;
  isPrivate: boolean;
  isArchived: boolean;
  // Whether the app is in it; null when Slack does not say.
  isAppMember: boolean | null;
}

// A Slack account, as users.info and users.lookupByEmail tell it.
export interface SlackPersonFacts {
  id: string;
  name: string;
  email: string;
  isBot: boolean;
  isDeactivated: boolean;
  isGuest: boolean;
}

// Slackbot is in no channel's list as a bot: it is left out by its id.
export const SLACKBOT_USER_ID: string = "USLACKBOT";

/*
 * Slack's answers that mean the channel is out of OneUptime's sight: deleted,
 * or private with the app no longer in it.
 */
export const SLACK_CHANNEL_GONE_ERRORS: ReadonlyArray<string> = [
  "channel_not_found",
];

// Answers that mean the project's connection to Slack no longer works.
export const SLACK_NOT_CONNECTED_ERRORS: ReadonlyArray<string> = [
  "invalid_auth",
  "not_authed",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "team_access_not_granted",
  "missing_scope",
  "not_allowed_token_type",
];

// Answers that mean Slack could not answer now: ask again in a minute.
export const SLACK_UNAVAILABLE_ERRORS: ReadonlyArray<string> = [
  "ratelimited",
  "rate_limited",
  "service_unavailable",
  "internal_error",
  "fatal_error",
  "request_timeout",
  "team_added_to_org",
  "org_login_required",
  "no_answer",
];

// How many member ids are read a page, as Slack recommends.
const MEMBERS_PAGE_SIZE: number = 200;

// An error Slack answered, with its code ("is_archived"), or how it failed.
export class SlackChannelMembersError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(`Slack answered ${code}`);
    this.name = "SlackChannelMembersError";
    this.code = code;
  }

  // Duck-typed: an error from another realm is read by its fields too.
  public static getCode(error: unknown): string | null {
    if (error instanceof SlackChannelMembersError) {
      return error.code;
    }

    const candidate: { name?: unknown; code?: unknown } | null =
      error && typeof error === "object"
        ? (error as { name?: unknown; code?: unknown })
        : null;

    if (
      candidate &&
      candidate.name === "SlackChannelMembersError" &&
      typeof candidate.code === "string"
    ) {
      return candidate.code;
    }

    return null;
  }

  public static isChannelGone(error: unknown): boolean {
    const code: string | null = SlackChannelMembersError.getCode(error);
    return code !== null && SLACK_CHANNEL_GONE_ERRORS.includes(code);
  }

  public static isNotConnected(error: unknown): boolean {
    const code: string | null = SlackChannelMembersError.getCode(error);
    return code !== null && SLACK_NOT_CONNECTED_ERRORS.includes(code);
  }

  public static isUnavailable(error: unknown): boolean {
    const code: string | null = SlackChannelMembersError.getCode(error);

    return (
      code === null ||
      SLACK_UNAVAILABLE_ERRORS.includes(code) ||
      code.startsWith("http_5") ||
      code === "http_429"
    );
  }
}

export default class SlackChannelMembers {
  // A channel's name, kind and state, and whether the app is in it.
  @CaptureSpan()
  public static async getChannel(data: {
    authToken: string;
    channelId: string;
  }): Promise<SlackChannelFacts> {
    const body: JSONObject = await SlackChannelMembers.call({
      authToken: data.authToken,
      method: "conversations.info",
      body: { channel: data.channelId },
    });

    const channel: JSONObject =
      body["channel"] && typeof body["channel"] === "object"
        ? (body["channel"] as JSONObject)
        : {};

    return {
      id: typeof channel["id"] === "string" ? channel["id"] : data.channelId,
      name: typeof channel["name"] === "string" ? channel["name"] : "",
      isPrivate:
        channel["is_private"] === true ||
        (channel["is_group"] === true && channel["is_mpim"] !== true),
      isArchived: channel["is_archived"] === true,
      isAppMember:
        typeof channel["is_member"] === "boolean"
          ? (channel["is_member"] as boolean)
          : null,
    };
  }

  /*
   * The ids of the people and apps in a channel, page by page, up to `max`;
   * isComplete says whether that was all of them.
   */
  @CaptureSpan()
  public static async getMemberIds(data: {
    authToken: string;
    channelId: string;
    max: number;
  }): Promise<{ memberIds: Array<string>; isComplete: boolean }> {
    const memberIds: Array<string> = [];
    let cursor: string = "";

    do {
      const body: JSONObject = await SlackChannelMembers.call({
        authToken: data.authToken,
        method: "conversations.members",
        body: {
          channel: data.channelId,
          limit: MEMBERS_PAGE_SIZE,
          ...(cursor ? { cursor: cursor } : {}),
        },
      });

      const members: Array<unknown> = Array.isArray(body["members"])
        ? (body["members"] as Array<unknown>)
        : [];

      for (const member of members) {
        if (
          typeof member === "string" &&
          member &&
          !memberIds.includes(member)
        ) {
          memberIds.push(member);
        }
      }

      const metadata: JSONObject =
        body["response_metadata"] &&
        typeof body["response_metadata"] === "object"
          ? (body["response_metadata"] as JSONObject)
          : {};

      cursor =
        typeof metadata["next_cursor"] === "string"
          ? (metadata["next_cursor"] as string)
          : "";
    } while (cursor && memberIds.length < data.max);

    return {
      memberIds: memberIds.slice(0, data.max),
      isComplete: !cursor && memberIds.length <= data.max,
    };
  }

  // Who a Slack account is; null when Slack knows no such account.
  @CaptureSpan()
  public static async getPerson(data: {
    authToken: string;
    slackUserId: string;
  }): Promise<SlackPersonFacts | null> {
    return await SlackChannelMembers.readPerson({
      authToken: data.authToken,
      method: "users.info",
      body: { user: data.slackUserId },
      notFoundErrors: ["user_not_found", "users_not_found"],
    });
  }

  /*
   * The Slack account with this email address; null when there is none. An
   * app installed before it asked for users:read.email cannot look people
   * up by email, and finds nobody this way.
   */
  @CaptureSpan()
  public static async findPersonByEmail(data: {
    authToken: string;
    email: string;
  }): Promise<SlackPersonFacts | null> {
    return await SlackChannelMembers.readPerson({
      authToken: data.authToken,
      method: "users.lookupByEmail",
      body: { email: data.email },
      notFoundErrors: ["users_not_found", "user_not_found", "missing_scope"],
    });
  }

  // Invites one person; throws what Slack answered when it refuses.
  @CaptureSpan()
  public static async invite(data: {
    authToken: string;
    channelId: string;
    slackUserId: string;
  }): Promise<void> {
    await SlackChannelMembers.call({
      authToken: data.authToken,
      method: "conversations.invite",
      body: {
        channel: data.channelId,
        users: data.slackUserId,
      },
    });
  }

  // The app joins a public channel.
  @CaptureSpan()
  public static async join(data: {
    authToken: string;
    channelId: string;
  }): Promise<void> {
    await SlackChannelMembers.call({
      authToken: data.authToken,
      method: "conversations.join",
      body: { channel: data.channelId },
    });
  }

  // A Slack user's name, as Slack shows it in a channel.
  public static readName(user: JSONObject): string {
    const profile: JSONObject =
      user["profile"] && typeof user["profile"] === "object"
        ? (user["profile"] as JSONObject)
        : {};

    return (
      [
        profile["display_name"],
        profile["real_name"],
        user["real_name"],
        user["name"],
      ]
        .map((value: unknown): string => {
          return typeof value === "string" ? value.trim() : "";
        })
        .find((value: string): boolean => {
          return value.length > 0;
        }) || ""
    );
  }

  private static async readPerson(data: {
    authToken: string;
    method: string;
    body: JSONObject;
    notFoundErrors: Array<string>;
  }): Promise<SlackPersonFacts | null> {
    let body: JSONObject;

    try {
      body = await SlackChannelMembers.call({
        authToken: data.authToken,
        method: data.method,
        body: data.body,
      });
    } catch (err) {
      const code: string | null = SlackChannelMembersError.getCode(err);

      if (code && data.notFoundErrors.includes(code)) {
        return null;
      }

      throw err;
    }

    const user: JSONObject | null =
      body["user"] && typeof body["user"] === "object"
        ? (body["user"] as JSONObject)
        : null;

    if (!user || typeof user["id"] !== "string" || !user["id"]) {
      return null;
    }

    const profile: JSONObject =
      user["profile"] && typeof user["profile"] === "object"
        ? (user["profile"] as JSONObject)
        : {};

    return {
      id: user["id"] as string,
      name: SlackChannelMembers.readName(user),
      email:
        typeof profile["email"] === "string"
          ? (profile["email"] as string).trim()
          : "",
      isBot:
        user["is_bot"] === true ||
        user["is_app_user"] === true ||
        user["id"] === SLACKBOT_USER_ID,
      isDeactivated: user["deleted"] === true,
      isGuest:
        user["is_restricted"] === true || user["is_ultra_restricted"] === true,
    };
  }

  /*
   * One Web API call: its answer when Slack says ok, a
   * SlackChannelMembersError with Slack's code otherwise.
   */
  private static async call(data: {
    authToken: string;
    method: string;
    body: JSONObject;
  }): Promise<JSONObject> {
    let response: HTTPErrorResponse | HTTPResponse<JSONObject>;

    try {
      response = await API.post<JSONObject>({
        url: URL.fromString(`https://slack.com/api/${data.method}`),
        data: data.body,
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
      });
    } catch (err) {
      logger.debug(`Slack did not answer ${data.method}.`);
      logger.debug(err);
      throw new SlackChannelMembersError("no_answer");
    }

    if (response instanceof HTTPErrorResponse) {
      const errorCode: string = SlackChannelMembers.readErrorCode(
        (response.jsonData || {}) as JSONObject,
      );

      throw new SlackChannelMembersError(
        errorCode || `http_${response.statusCode}`,
      );
    }

    const body: JSONObject = (response.jsonData || {}) as JSONObject;

    if (body["ok"] !== true) {
      throw new SlackChannelMembersError(
        SlackChannelMembers.readErrorCode(body) || "unknown_error",
      );
    }

    return body;
  }

  private static readErrorCode(body: JSONObject): string {
    const error: unknown = body["error"];
    return typeof error === "string" ? error : "";
  }
}
