import HTTPMethod from "../../../../Types/API/HTTPMethod";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";

export class DiscordAPIError extends BadDataException {
  public readonly statusCode: number;
  public constructor(statusCode: number) {
    super(`Discord API request failed (HTTP ${statusCode}).`);
    this.statusCode = statusCode;
  }
}

/*
 * Thrown when the request left the process but no answer came back (socket
 * error, timeout). The remote side may have completed the operation, so a
 * caller that created something must treat the outcome as unknown rather
 * than retry. Distinguished by type because the generic BadDataException is
 * also what validation failures throw.
 */
export class DiscordAmbiguousOutcomeError extends BadDataException {
  public constructor() {
    super("Discord API transport failed; delivery is unknown.");
  }
}

export default class DiscordClient {
  public static readonly BASE_URL: string = "https://discord.com/api/v10";

  public static encodePathSegment(value: string): string {
    if (!value || value.length > 1024) {
      throw new BadDataException("Invalid Discord path segment.");
    }
    return encodeURIComponent(value);
  }

  public static snowflake(value: string): string {
    const pattern: RegExp = /^[0-9]{17,20}$/;
    if (!pattern.test(value)) {
      throw new BadDataException("Invalid Discord identifier.");
    }
    return value;
  }

  public static async request(data: {
    authToken: string;
    method: HTTPMethod;
    path: string;
    body?: JSONObject | JSONArray;
    params?: { before?: string; limit?: string };
    /*
     * Opaque operation id recorded in the guild audit log as
     * "oneuptime:<uuid>". Only that shape is accepted so no title, user or
     * secret can leak into a log guild admins read.
     */
    auditLogReason?: string;
  }): Promise<JSONObject | JSONArray> {
    if (!data.authToken) {
      throw new BadDataException("Invalid Discord API request.");
    }
    const reasonPattern: RegExp =
      /^oneuptime:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (data.auditLogReason && !reasonPattern.test(data.auditLogReason)) {
      throw new BadDataException("Invalid Discord audit log reason.");
    }

    return await this.requestWithHeaders({
      method: data.method,
      path: data.path,
      body: data.body,
      params: data.params,
      headers: {
        Authorization: `Bot ${data.authToken}`,
        ...(data.auditLogReason
          ? { "X-Audit-Log-Reason": data.auditLogReason }
          : {}),
      },
    });
  }

  private static async requestWithHeaders(data: {
    method: HTTPMethod;
    path: string;
    body?: JSONObject | JSONArray | undefined;
    params?: { before?: string; limit?: string } | undefined;
    headers?: Record<string, string> | undefined;
  }): Promise<JSONObject | JSONArray> {
    const pathPattern: RegExp =
      /^\/(?:[a-z0-9_@.-]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9_@.-]|%[0-9a-f]{2})+)*(?:\?[a-z0-9_=&.-]+)?$/i;
    const pathSegments: Array<string> = data.path
      .split("?", 1)[0]!
      .split("/")
      .slice(1);
    if (
      data.path.length > 4096 ||
      !pathPattern.test(data.path) ||
      pathSegments.some((segment: string): boolean => {
        const decoded: string = decodeURIComponent(segment);
        return decoded === "." || decoded === "..";
      })
    ) {
      throw new BadDataException("Invalid Discord API request.");
    }

    for (let attempt: number = 0; attempt < 3; attempt++) {
      let response: HTTPResponse<JSONObject | JSONArray> | HTTPErrorResponse;
      try {
        response = await API.fetch({
          method: data.method,
          url: URL.fromString(this.BASE_URL + data.path),
          ...(data.body ? { data: data.body } : {}),
          ...(data.headers ? { headers: data.headers } : {}),
          ...(data.params ? { params: data.params } : {}),
          /*
           * Retrying an ambiguous network failure could duplicate a message or
           * channel. Only a definite rate-limit rejection is safe to retry here.
           */
          options: { retries: 0, timeout: 10_000, doNotFollowRedirects: true },
        });
      } catch {
        throw new DiscordAmbiguousOutcomeError();
      }

      if (response.statusCode === 429 && attempt < 2) {
        const retryAfter: unknown = (response.data as JSONObject)[
          "retry_after"
        ];
        if (
          typeof retryAfter === "number" &&
          Number.isFinite(retryAfter) &&
          retryAfter >= 0 &&
          retryAfter <= 10
        ) {
          await new Promise<void>((resolve: () => void): void => {
            setTimeout(resolve, Math.ceil(retryAfter * 1000));
          });
          continue;
        }
      }
      if (response instanceof HTTPErrorResponse || response.statusCode >= 300) {
        // Do not propagate request headers, tokens or message bodies into logs.
        throw new DiscordAPIError(response.statusCode);
      }
      return response.data;
    }
    throw new BadDataException("Discord rate limit exceeded.");
  }

  public static async sendMessage(data: {
    authToken: string;
    channelId: string;
    message: JSONObject;
  }): Promise<string> {
    const response: JSONObject = (await this.request({
      authToken: data.authToken,
      method: HTTPMethod.POST,
      path: `/channels/${this.snowflake(data.channelId)}/messages`,
      body: data.message,
    })) as JSONObject;
    return this.snowflake(String(response["id"] || ""));
  }

  public static async openDirectMessage(data: {
    authToken: string;
    userId: string;
  }): Promise<string> {
    const response: JSONObject = (await this.request({
      authToken: data.authToken,
      method: HTTPMethod.POST,
      path: "/users/@me/channels",
      body: { recipient_id: this.snowflake(data.userId) },
    })) as JSONObject;
    return this.snowflake(String(response["id"] || ""));
  }

  public static async editOriginalInteractionResponse(data: {
    applicationId: string;
    interactionToken: string;
    message: JSONObject;
  }): Promise<void> {
    await this.requestWithHeaders({
      method: HTTPMethod.PATCH,
      path:
        `/webhooks/${this.snowflake(data.applicationId)}/` +
        `${this.encodePathSegment(data.interactionToken)}/messages/@original`,
      body: data.message,
    });
  }

  public static async sendInteractionFollowup(data: {
    applicationId: string;
    interactionToken: string;
    message: JSONObject;
  }): Promise<void> {
    await this.requestWithHeaders({
      method: HTTPMethod.POST,
      path:
        `/webhooks/${this.snowflake(data.applicationId)}/` +
        this.encodePathSegment(data.interactionToken),
      body: data.message,
    });
  }

  public static async upsertGuildCommands(data: {
    authToken: string;
    applicationId: string;
    guildId: string;
    commands: JSONArray;
  }): Promise<void> {
    if (
      !Array.isArray(data.commands) ||
      data.commands.length > 100 ||
      JSON.stringify(data.commands).length > 1_000_000
    ) {
      throw new BadDataException("Invalid Discord command registration.");
    }

    const names: Set<string> = new Set<string>();
    const commandNamePattern: RegExp = /^[a-z0-9_-]{1,32}$/;
    for (const value of data.commands) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new BadDataException("Invalid Discord command registration.");
      }
      const command: JSONObject = value as JSONObject;
      const name: unknown = command["name"];
      const description: unknown = command["description"];
      if (
        command["type"] !== 1 ||
        typeof name !== "string" ||
        !commandNamePattern.test(name) ||
        typeof description !== "string" ||
        description.length < 1 ||
        description.length > 100 ||
        names.has(name)
      ) {
        throw new BadDataException("Invalid Discord command registration.");
      }
      names.add(name);
    }

    const path: string =
      `/applications/${this.snowflake(data.applicationId)}/guilds/` +
      `${this.snowflake(data.guildId)}/commands`;
    const existingResponse: JSONObject | JSONArray = await this.request({
      authToken: data.authToken,
      method: HTTPMethod.GET,
      path,
    });
    if (!Array.isArray(existingResponse)) {
      throw new BadDataException("Discord returned invalid command data.");
    }

    for (const value of data.commands) {
      const command: JSONObject = value as JSONObject;
      const matches: Array<JSONObject> = existingResponse.filter(
        (existingValue: unknown): boolean => {
          return Boolean(
            existingValue &&
              typeof existingValue === "object" &&
              !Array.isArray(existingValue) &&
              (existingValue as JSONObject)["type"] === 1 &&
              (existingValue as JSONObject)["name"] === command["name"],
          );
        },
      ) as Array<JSONObject>;
      if (matches.length > 1) {
        throw new BadDataException("Discord returned ambiguous command data.");
      }
      const existingId: string | undefined = matches[0]
        ? this.snowflake(String(matches[0]["id"] || ""))
        : undefined;
      await this.request({
        authToken: data.authToken,
        method: existingId ? HTTPMethod.PATCH : HTTPMethod.POST,
        path: existingId ? `${path}/${existingId}` : path,
        body: command,
      });
    }
  }
}
