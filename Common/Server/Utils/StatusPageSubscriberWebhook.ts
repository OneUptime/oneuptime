import API from "../../Utils/API";
import URL from "../../Types/API/URL";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import { JSONObject } from "../../Types/JSON";
import logger from "./Logger";
import SSRFProtection from "./SSRFProtection";

export interface StatusPageWebhookPayload extends JSONObject {
  eventType: string;
  statusPageId: string;
  statusPageName: string;
  statusPageUrl: string;
  unsubscribeUrl: string;
  data: JSONObject;
}

export default class StatusPageSubscriberWebhookUtil {
  public static async sendWebhookNotification(data: {
    webhookUrl: URL;
    payload: StatusPageWebhookPayload;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    logger.debug("Sending status page subscriber webhook notification.");

    /*
     * The subscriber webhook target is attacker-controllable: any unauthenticated
     * visitor can register a subscriber with an arbitrary webhook URL on a public
     * status page. Validate it against the SSRF blocklist before every send (not
     * just at create time) so previously-stored URLs and DNS-rebinding cannot make
     * the server reach internal services or the cloud metadata endpoint.
     *
     * Strict policy, with no opt-in passed: the private-network exception
     * (issue #3424) is only for URLs an authenticated project member authored.
     */
    try {
      await SSRFProtection.validateWebhookTargetIsSafe(data.webhookUrl);
    } catch (err) {
      logger.warn(
        "Refusing to send status page subscriber webhook: unsafe URL.",
      );
      logger.warn(err);
      return new HTTPErrorResponse(
        400,
        {
          message:
            err instanceof Error ? err.message : "Webhook URL is not allowed.",
        },
        {},
      );
    }

    const apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url: data.webhookUrl,
        data: data.payload,
        options: {
          retries: 3,
          exponentialBackoff: true,
          /*
           * Do not follow redirects: a validated public host could otherwise
           * 3xx-redirect the server to an internal address, bypassing the check.
           */
          doNotFollowRedirects: true,
        },
      });

    logger.debug("Status page subscriber webhook response:");
    logger.debug(apiResult);

    return apiResult;
  }
}
