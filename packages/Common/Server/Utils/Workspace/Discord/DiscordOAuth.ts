import HTTPMethod from "../../../../Types/API/HTTPMethod";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject, JSONArray } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import {
  DiscordAppClientId,
  DiscordAppClientSecret,
  DiscordBotToken,
} from "../../../EnvironmentConfig";
import DiscordClient from "./DiscordClient";

export interface DiscordGuildContext {
  guild: JSONObject;
  bot: JSONObject;
  member: JSONObject;
  roles: Array<JSONObject>;
}

export default class DiscordOAuth {
  public static readonly REQUIRED_PERMISSIONS: bigint = [
    10, 11, 16, 34, 35, 36, 38,
  ].reduce((value: bigint, bit: number): bigint => {
    return value | (BigInt(1) << BigInt(bit));
  }, BigInt(0));

  private static async request(data: {
    path: string;
    accessToken?: string;
    body?: JSONObject;
    params?: Record<string, string>;
  }): Promise<JSONObject | JSONArray> {
    try {
      const result: HTTPResponse<JSONObject | JSONArray> | HTTPErrorResponse =
        await API.fetch({
          method: data.body ? HTTPMethod.POST : HTTPMethod.GET,
          url: URL.fromString(DiscordClient.BASE_URL + data.path),
          headers: data.body
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : { Authorization: `Bearer ${data.accessToken}` },
          ...(data.body ? { data: data.body } : {}),
          ...(data.params ? { params: data.params } : {}),
          options: { retries: 0, timeout: 10_000, doNotFollowRedirects: true },
        });
      if (result instanceof HTTPErrorResponse || result.statusCode >= 300) {
        throw new Error("Provider rejected request");
      }
      return result.data;
    } catch {
      // Never forward provider exceptions, which may contain OAuth credentials.
      throw new BadDataException(
        "Discord authorization could not be verified. Please reconnect and try again.",
      );
    }
  }

  public static async exchange(
    code: string,
    redirectUri: string,
  ): Promise<JSONObject> {
    if (
      !code ||
      code.length > 4096 ||
      !DiscordAppClientId ||
      !DiscordAppClientSecret
    ) {
      throw new BadDataException(
        "Discord authorization is not configured or the authorization code is missing.",
      );
    }
    const token: JSONObject = (await this.request({
      path: "/oauth2/token",
      body: {
        client_id: DiscordAppClientId,
        client_secret: DiscordAppClientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      },
    })) as JSONObject;
    if (
      token["token_type"] !== "Bearer" ||
      typeof token["access_token"] !== "string" ||
      !token["access_token"]
    ) {
      throw new BadDataException(
        "Discord returned an invalid authorization response.",
      );
    }
    return token;
  }

  public static async identify(accessToken: string): Promise<JSONObject> {
    const user: JSONObject = (await this.request({
      path: "/users/@me",
      accessToken,
    })) as JSONObject;
    DiscordClient.snowflake(String(user["id"] || ""));
    if (user["bot"] === true) {
      throw new BadDataException("Connect a human Discord account.");
    }
    return user;
  }

  public static async assertInstaller(
    accessToken: string,
    guildId: string,
  ): Promise<void> {
    let after: string | undefined;
    for (let page: number = 0; page < 100; page++) {
      const guilds: JSONArray = (await this.request({
        path: "/users/@me/guilds",
        accessToken,
        params: { limit: "200", ...(after ? { after } : {}) },
      })) as JSONArray;
      if (!Array.isArray(guilds)) {
        break;
      }
      const guild: JSONObject | undefined = (guilds as Array<JSONObject>).find(
        (item: JSONObject): boolean => {
          return item["id"] === guildId;
        },
      );
      if (guild) {
        const permissions: bigint = this.permissions(guild["permissions"]);
        if (
          guild["owner"] === true ||
          (permissions & BigInt(40)) !== BigInt(0)
        ) {
          return;
        }
        break;
      }
      if (guilds.length < 200) {
        break;
      }
      const next: string = DiscordClient.snowflake(
        String((guilds[guilds.length - 1] as JSONObject)["id"] || ""),
      );
      if (next === after) {
        break;
      }
      after = next;
    }
    throw new BadDataException(
      "You must manage the Discord server being connected.",
    );
  }

  public static async assertUserMembership(
    accessToken: string,
    guildId: string,
    userId: string,
  ): Promise<void> {
    const member: JSONObject = (await this.request({
      path: `/users/@me/guilds/${DiscordClient.snowflake(guildId)}/member`,
      accessToken,
    })) as JSONObject;
    if (
      (member["user"] as JSONObject | undefined)?.["id"] !== userId ||
      member["pending"] === true
    ) {
      throw new BadDataException(
        "Your Discord account must be a member of the connected server.",
      );
    }
  }

  public static async bot(path: string): Promise<JSONObject | JSONArray> {
    if (!DiscordBotToken) {
      throw new BadDataException("Discord bot is not configured.");
    }
    return await DiscordClient.request({
      authToken: DiscordBotToken,
      method: HTTPMethod.GET,
      path,
    });
  }

  public static async guildContext(
    guildId: string,
  ): Promise<DiscordGuildContext> {
    DiscordClient.snowflake(guildId);
    const application: JSONObject = (await this.bot(
      "/oauth2/applications/@me",
    )) as JSONObject;
    const bot: JSONObject = (await this.bot("/users/@me")) as JSONObject;
    if (application["id"] !== DiscordAppClientId || bot["bot"] !== true) {
      throw new BadDataException(
        "Discord bot does not belong to the configured application.",
      );
    }
    const botId: string = DiscordClient.snowflake(String(bot["id"] || ""));
    if (
      application["bot"] &&
      (application["bot"] as JSONObject)["id"] !== botId
    ) {
      throw new BadDataException(
        "Discord bot identity does not match its application.",
      );
    }
    const guild: JSONObject = (await this.bot(
      `/guilds/${guildId}`,
    )) as JSONObject;
    const member: JSONObject = (await this.bot(
      `/guilds/${guildId}/members/${botId}`,
    )) as JSONObject;
    const roles: Array<JSONObject> = (await this.bot(
      `/guilds/${guildId}/roles`,
    )) as Array<JSONObject>;
    if (
      guild["id"] !== guildId ||
      (member["user"] as JSONObject | undefined)?.["id"] !== botId ||
      !Array.isArray(roles) ||
      !Array.isArray(member["roles"])
    ) {
      throw new BadDataException(
        "The configured Discord bot must belong to this server.",
      );
    }
    return { guild, bot, member, roles };
  }

  private static permissions(value: unknown): bigint {
    const pattern: RegExp = /^\d{1,30}$/;
    if (typeof value !== "string" || !pattern.test(value)) {
      throw new BadDataException("Discord returned invalid permissions.");
    }
    return BigInt(value);
  }

  public static isEligibleParent(
    channel: JSONObject,
    context: DiscordGuildContext,
  ): boolean {
    if (channel["type"] !== 0 || channel["guild_id"] !== context.guild["id"]) {
      return false;
    }
    const roleIds: Set<string> = new Set([
      String(context.guild["id"]),
      ...(context.member["roles"] as Array<string>),
    ]);
    let permissions: bigint = BigInt(0);
    for (const role of context.roles) {
      if (roleIds.has(String(role["id"]))) {
        permissions |= this.permissions(role["permissions"]);
      }
    }
    if (
      context.guild["owner_id"] === context.bot["id"] ||
      (permissions & BigInt(8)) !== BigInt(0)
    ) {
      return true;
    }
    const overwrites: Array<JSONObject> = channel[
      "permission_overwrites"
    ] as Array<JSONObject>;
    if (!Array.isArray(overwrites)) {
      return false;
    }
    const apply: (items: Array<JSONObject>) => void = (
      items: Array<JSONObject>,
    ): void => {
      let allow: bigint = BigInt(0);
      let deny: bigint = BigInt(0);
      for (const item of items) {
        allow |= this.permissions(item["allow"]);
        deny |= this.permissions(item["deny"]);
      }
      permissions = (permissions & ~deny) | allow;
    };
    apply(
      overwrites.filter((item: JSONObject): boolean => {
        return item["type"] === 0 && item["id"] === context.guild["id"];
      }),
    );
    apply(
      overwrites.filter((item: JSONObject): boolean => {
        return (
          item["type"] === 0 &&
          item["id"] !== context.guild["id"] &&
          roleIds.has(String(item["id"]))
        );
      }),
    );
    apply(
      overwrites.filter((item: JSONObject): boolean => {
        return item["type"] === 1 && item["id"] === context.bot["id"];
      }),
    );
    return (
      (permissions & this.REQUIRED_PERMISSIONS) === this.REQUIRED_PERMISSIONS
    );
  }
}
