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

export default class DiscordClient {
  public static readonly BASE_URL: string = "https://discord.com/api/v10";

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
  }): Promise<JSONObject | JSONArray> {
    const pathPattern: RegExp = /^\/[a-z0-9_/@-]+(?:\?[a-z0-9_=&.-]+)?$/i;
    if (!data.authToken || !pathPattern.test(data.path)) {
      throw new BadDataException("Invalid Discord API request.");
    }

    for (let attempt: number = 0; attempt < 3; attempt++) {
      let response: HTTPResponse<JSONObject | JSONArray> | HTTPErrorResponse;
      try {
        response = await API.fetch({
          method: data.method,
          url: URL.fromString(this.BASE_URL + data.path),
          ...(data.body ? { data: data.body } : {}),
          headers: { Authorization: `Bot ${data.authToken}` },
          ...(data.params ? { params: data.params } : {}),
          /*
           * Retrying an ambiguous network failure could duplicate a message or
           * channel. Only a definite rate-limit rejection is safe to retry here.
           */
          options: { retries: 0, timeout: 10_000, doNotFollowRedirects: true },
        });
      } catch {
        throw new BadDataException(
          "Discord API transport failed; delivery is unknown.",
        );
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
}
