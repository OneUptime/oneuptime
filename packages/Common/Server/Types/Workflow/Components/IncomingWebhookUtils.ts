import { RunOptions } from "../ComponentCode";
import URL from "../../../../Types/API/URL";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import SSRFProtection from "../../../Utils/SSRFProtection";

/*
 * The Slack / Discord / Microsoft Teams workflow components each take a
 * free-text "webhook-url" argument off the workflow graph, which any project
 * member can author and which can additionally be templated from trigger data.
 * They then POST to it from the API server - the same SSRF primitive that
 * GHSA-v5xh-rw9h-77fv reported against the API components.
 *
 * These are chat webhooks, so unlike the generic API components there is a
 * vendor host to pin to, and a pin is strictly better than a blocklist: it
 * cannot be walked around with DNS rebinding, an alternate IP notation, or a
 * redirect. Nothing legitimate is lost - a self-hosted OneUptime still posts to
 * hooks.slack.com like everyone else.
 */

export const DISCORD_WEBHOOK_DOMAINS: Array<string> = [
  "discord.com",
  "discordapp.com",
];

export class IncomingWebhookUtils {
  /*
   * Reads the component's "webhook-url" argument, requires it to be on one of
   * `allowedDomains`, and returns it parsed. Throws through options.onError so
   * the workflow stops with a message the author can act on.
   *
   * Validates the RAW string: URL.fromString defaults an unrecognized scheme to
   * https, so converting first would let "gopher://..." arrive looking clean.
   */
  public static getPinnedWebhookUrl(data: {
    args: JSONObject;
    options: RunOptions;
    allowedDomains: Array<string>;
    vendorName: string;
  }): URL {
    const rawUrl: unknown = data.args["webhook-url"];

    if (!rawUrl) {
      throw data.options.onError(
        new BadDataException(`${data.vendorName} Webhook URL not found`),
      );
    }

    if (
      !SSRFProtection.isUrlOnAllowedDomain(
        rawUrl.toString(),
        data.allowedDomains,
      )
    ) {
      throw data.options.onError(
        new BadDataException(
          `${data.vendorName} Webhook URL must be an https URL on ${data.allowedDomains.join(" or ")}.`,
        ),
      );
    }

    return URL.fromString(rawUrl.toString());
  }
}

export default IncomingWebhookUtils;
