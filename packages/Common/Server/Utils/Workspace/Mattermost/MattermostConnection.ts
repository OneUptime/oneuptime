import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import { MATTERMOST_NAME_PATTERN } from "../../../../Types/Workspace/WorkspaceChannelLink";

/*
 * WHAT A PROJECT'S MATTERMOST CONNECTION IS.
 *
 * Slack and Microsoft Teams are one service each, so a token is all their
 * API needs. Mattermost is a server of the customer's own - chat.acme.com,
 * often on their own network - and every call goes to that server, in the
 * one team of it the project was connected to, as the bot account the
 * project was connected with.
 *
 * The workspace interface (WorkspaceBase) hands a provider only the
 * project's `authToken`: joinChannel, isUserInChannel,
 * getWorkspaceChannelFromChannelId and sendDirectMessageToUser are not even
 * told the project. So the token OneUptime keeps for a Mattermost
 * connection is the whole connection - the server, the team, the bot and
 * the bot's access token - written as JSON into the server-only `authToken`
 * column (WorkspaceProjectAuthToken). Every call reads it back with
 * `fromAuthToken`, and talks to that server, in that team, as that bot.
 *
 * The project's miscData repeats the server, team and bot (never the access
 * token) for the Dashboard to show: miscData is readable by every project
 * Viewer.
 */
export interface MattermostConnectionData {
  // https://chat.example.com, with no trailing slash (normalizeServerUrl).
  serverUrl: string;
  // The bot's personal access token.
  accessToken: string;
  teamId: string;
  botUserId: string;
}

// What every refusal to read a stored connection says.
const NOT_A_CONNECTION_MESSAGE: string =
  "This project's Mattermost connection could not be read. Please disconnect Mattermost in Project Settings and connect it again.";

/*
 * Mattermost ids - of users, teams, channels and posts - are 26 lowercase
 * letters and digits. One is placed in the path of every call OneUptime
 * makes as the bot, so nothing else is ever placed there: a "/", "..", "?"
 * or "%" would point the call, with the bot's token, at another resource.
 */
const MATTERMOST_ID_PATTERN: RegExp = /^[a-z0-9]{26}$/;

/*
 * A username, as Mattermost lets one be chosen: lowercase letters, digits,
 * ".", "-" and "_", at most 64 characters. Read before it is placed in a
 * path, as ids and channel names are.
 */
const MATTERMOST_USERNAME_PATTERN: RegExp = /^[a-z0-9._-]{1,64}$/;

// An address that names its scheme ("https://"): one without it is https.
const HAS_SCHEME_PATTERN: RegExp = /^[a-z][a-z0-9+.-]*:\/\//i;

// The most characters an address OneUptime keeps for a server may have.
const MAX_SERVER_URL_LENGTH: number = 2048;

// A personal access token, as Mattermost makes one: 26 letters and digits.
const MAX_ACCESS_TOKEN_LENGTH: number = 256;
const ACCESS_TOKEN_PATTERN: RegExp = /^[A-Za-z0-9_-]+$/;

export default class MattermostConnection {
  public static isMattermostId(value: unknown): value is string {
    return typeof value === "string" && MATTERMOST_ID_PATTERN.test(value);
  }

  /*
   * A channel's name - its handle in URLs:
   * chat.example.com/team/channels/<name>.
   */
  public static isChannelName(value: unknown): value is string {
    return typeof value === "string" && MATTERMOST_NAME_PATTERN.test(value);
  }

  public static isUsername(value: unknown): value is string {
    return typeof value === "string" && MATTERMOST_USERNAME_PATTERN.test(value);
  }

  // `value` when it is a Mattermost id, or a refusal naming what it was for.
  public static assertMattermostId(value: unknown, what: string): string {
    if (!MattermostConnection.isMattermostId(value)) {
      throw new BadDataException(`The Mattermost ${what} id is not valid.`);
    }

    return value;
  }

  /*
   * A server's address as typed - "chat.example.com", "https://chat.example.com/",
   * "https://example.com/mattermost" - as OneUptime calls it: https unless it
   * says http, with no trailing slash, query or fragment. A server on a path
   * keeps its path. Anything that is not a web address is refused.
   */
  public static normalizeServerUrl(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new BadDataException(
        "Please enter the address of your Mattermost server, for example https://chat.example.com.",
      );
    }

    let text: string = value.trim();

    if (text.length > MAX_SERVER_URL_LENGTH) {
      throw new BadDataException("The Mattermost server address is too long.");
    }

    if (!HAS_SCHEME_PATTERN.test(text)) {
      text = `https://${text}`;
    }

    let parsed: globalThis.URL;

    try {
      parsed = new globalThis.URL(text);
    } catch {
      throw new BadDataException(
        "The Mattermost server address is not a valid web address. Please enter it as https://chat.example.com.",
      );
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new BadDataException(
        "The Mattermost server address must start with https:// or http://.",
      );
    }

    if (parsed.username || parsed.password) {
      throw new BadDataException(
        "Please enter the Mattermost server address without a user name or password in it.",
      );
    }

    if (!parsed.hostname) {
      throw new BadDataException(
        "The Mattermost server address is not a valid web address. Please enter it as https://chat.example.com.",
      );
    }

    // Only the server: no query or fragment, no trailing slash.
    const path: string = parsed.pathname.replace(/\/+$/, "");

    return `${parsed.protocol}//${parsed.host}${path}`;
  }

  /*
   * An access token as typed, or a refusal. It is never echoed back: a
   * refusal says what is wrong with it, not what it was.
   */
  public static normalizeAccessToken(value: unknown): string {
    const token: string = typeof value === "string" ? value.trim() : "";

    if (!token) {
      throw new BadDataException(
        "Please enter the access token of the Mattermost bot account.",
      );
    }

    if (
      token.length > MAX_ACCESS_TOKEN_LENGTH ||
      !ACCESS_TOKEN_PATTERN.test(token)
    ) {
      throw new BadDataException(
        "The Mattermost access token is not valid. Copy the token Mattermost showed when you created it for the bot account.",
      );
    }

    return token;
  }

  // The connection, as it is kept in the server-only `authToken` column.
  public static toAuthToken(connection: MattermostConnectionData): string {
    const json: JSONObject = {
      serverUrl: MattermostConnection.normalizeServerUrl(connection.serverUrl),
      accessToken: MattermostConnection.normalizeAccessToken(
        connection.accessToken,
      ),
      teamId: MattermostConnection.assertMattermostId(
        connection.teamId,
        "team",
      ),
      botUserId: MattermostConnection.assertMattermostId(
        connection.botUserId,
        "bot user",
      ),
    };

    return JSON.stringify(json);
  }

  /*
   * The connection a stored `authToken` holds. Read as strictly as it was
   * written: a token that is not one (a Slack token handed to the wrong
   * provider, a damaged row) is refused, and nothing is called with it.
   */
  public static fromAuthToken(authToken: string): MattermostConnectionData {
    let parsed: unknown;

    try {
      parsed = JSON.parse(authToken);
    } catch {
      throw new BadDataException(NOT_A_CONNECTION_MESSAGE);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BadDataException(NOT_A_CONNECTION_MESSAGE);
    }

    const json: JSONObject = parsed as JSONObject;

    try {
      return {
        serverUrl: MattermostConnection.normalizeServerUrl(json["serverUrl"]),
        accessToken: MattermostConnection.normalizeAccessToken(
          json["accessToken"],
        ),
        teamId: MattermostConnection.assertMattermostId(json["teamId"], "team"),
        botUserId: MattermostConnection.assertMattermostId(
          json["botUserId"],
          "bot user",
        ),
      };
    } catch {
      throw new BadDataException(NOT_A_CONNECTION_MESSAGE);
    }
  }
}
