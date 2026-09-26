import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import { WorkspacePayloadMarkdown } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import API from "../../../../Utils/API";
import DiscordMessageRenderer from "./DiscordMessageRenderer";

export default class DiscordWebhook {
  public static isValidUrl(url: URL | string): boolean {
    /*
     * Validate the complete input before URL normalization, including its
     * authority and path. Tokens in webhook URLs must never reach another host.
     */
    const pattern: RegExp =
      /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/(?:v10\/)?webhooks\/[0-9]{1,20}\/[A-Za-z0-9_-]+(?:\?(?:thread_id=[0-9]{17,20}|wait=(?:true|false))(?:&(?:thread_id=[0-9]{17,20}|wait=(?:true|false)))?)?$/;
    const value: string = url.toString();
    if (!pattern.test(value)) {
      return false;
    }
    const keys: Array<string> = (value.split("?")[1] || "")
      .split("&")
      .map((item: string) => {
        return item.split("=")[0]!;
      });
    return new Set(keys).size === keys.length;
  }

  public static async send(data: {
    url: URL;
    text: string;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    if (!this.isValidUrl(data.url)) {
      throw new BadDataException(
        "Use an HTTPS Discord incoming webhook URL on discord.com.",
      );
    }
    const messages: Array<JSONObject> = DiscordMessageRenderer.render({
      messageBlocks: [
        {
          _type: "WorkspacePayloadMarkdown",
          text: data.text,
        } as WorkspacePayloadMarkdown,
      ],
    });
    let result: HTTPResponse<JSONObject> | HTTPErrorResponse | undefined;
    for (const message of messages) {
      result = await API.post({
        url: data.url,
        // Without wait=true Discord can return success for an unsaved message.
        params: { ...data.url.params, wait: "true" },
        data: {
          content: message["content"]!,
          allowed_mentions: message["allowed_mentions"]!,
        },
        options: { retries: 0, timeout: 10_000, doNotFollowRedirects: true },
      });
      if (result instanceof HTTPErrorResponse || result.statusCode >= 300) {
        return new HTTPErrorResponse(
          result.statusCode,
          { message: `Discord webhook failed (HTTP ${result.statusCode}).` },
          {},
        );
      }
    }
    return result!;
  }
}
