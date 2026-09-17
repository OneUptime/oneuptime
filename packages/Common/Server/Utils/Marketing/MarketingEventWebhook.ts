import axios, { AxiosError, AxiosResponse } from "axios";
import crypto from "crypto";
import {
  MarketingWebhookSecret,
  MarketingWebhookUrl,
} from "../../EnvironmentConfig";
import { MarketingEvent } from "../../../Types/Marketing/MarketingEvent";
import logger from "../Logger";

const REQUEST_TIMEOUT_MS: number = 15000;

/*
 * Delivers marketing conversion events to one operator-configured endpoint.
 *
 * OneUptime keeps no conversion ledger, so this is the only exit for a signup
 * or a plan change. That has one consequence worth stating
 * plainly: a delivery this class gives up on is gone, because there is no row
 * anywhere to reconcile against later. deliver() therefore THROWS on anything
 * that might succeed on a retry, and the queue is what retries it.
 *
 * SIGNING
 *
 * The signature is HMAC-SHA256 over the exact request body bytes, hex encoded,
 * in `x-oneuptime-signature-256`. The receiver must compute its digest over
 * the raw bytes it received —
 * JSON parsed and re-serialised is NOT equivalent, because whitespace, key
 * order and escaping all change the digest.
 *
 * The body is serialised once, here, and that exact string is both signed and
 * sent, so nothing between the signature and the socket can reformat it.
 *
 * Both the URL and the secret are required. An endpoint configured without a
 * secret is not sent to at all rather than sent to unsigned: the payload
 * carries email addresses and campaign data, and a receiver with no way to
 * tell OneUptime's POST from anyone else's is not a receiver worth having.
 */
export default class MarketingEventWebhook {
  public static isConfigured(): boolean {
    return Boolean(MarketingWebhookUrl && MarketingWebhookSecret);
  }

  /*
   * True when an endpoint is set but unusable, so callers can say so once at
   * emit time rather than letting events vanish into a silent no-op.
   */
  public static isMisconfigured(): boolean {
    return Boolean(MarketingWebhookUrl) && !MarketingWebhookSecret;
  }

  public static sign(body: string): string {
    return crypto
      .createHmac("sha256", MarketingWebhookSecret)
      .update(body, "utf8")
      .digest("hex");
  }

  /*
   * One delivery attempt.
   *
   * Throws on a transport error or any non-2xx, which is what makes the queue
   * retry. A 4xx is retried too: the receiver rejecting a payload it should
   * have taken is far more often a deploy in progress or a bad rule than a
   * payload that will never be acceptable, and the alternative — dropping it
   * silently — has no backstop now that nothing is stored.
   */
  public static async deliver(event: MarketingEvent): Promise<void> {
    if (!this.isConfigured()) {
      return;
    }

    // Serialise once. This exact string is signed and sent.
    const body: string = JSON.stringify(event);

    try {
      const response: AxiosResponse = await axios.post(
        MarketingWebhookUrl,
        body,
        {
          headers: {
            "content-type": "application/json",
            "x-oneuptime-signature-256": this.sign(body),
            "x-oneuptime-event-id": event.eventId,
            "x-oneuptime-event-type": event.eventType,
          },
          timeout: REQUEST_TIMEOUT_MS,
          // Non-2xx must reach the catch below rather than resolving.
          validateStatus: (status: number): boolean => {
            return status >= 200 && status < 300;
          },
        },
      );

      logger.debug(
        `MarketingEvent: delivered ${event.eventType} (${event.eventId}) — HTTP ${response.status}`,
      );
    } catch (err) {
      const message: string =
        err instanceof AxiosError
          ? `HTTP ${err.response?.status || "?"}: ${JSON.stringify(
              err.response?.data || err.message,
            ).slice(0, 500)}`
          : (err as Error)?.message || "Unknown error";

      /*
       * Rethrown, not swallowed. The queue's retry is the only thing standing
       * between a receiver hiccup and a permanently lost conversion.
       */
      throw new Error(
        `Marketing webhook delivery failed for ${event.eventType} (${event.eventId}): ${message}`,
      );
    }
  }
}
