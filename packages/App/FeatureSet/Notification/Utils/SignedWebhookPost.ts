import { JSONObject } from "Common/Types/JSON";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  CUSTOM_CHANNEL_EVENT_HEADER,
  CUSTOM_CHANNEL_SIGNATURE_HEADER,
} from "Common/Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import API from "Common/Utils/API";
import crypto from "crypto";

/*
 * A SIGNED REQUEST TO A SERVICE THE INSTALLATION RUNS, TRIED AGAIN.
 *
 * The server's SMS and call gateway (CallAndSmsGatewayService) and the
 * Enterprise Edition's custom channels (ee/Server/CustomNotificationChannels)
 * post to a service the installation's admin runs, and both are often how a
 * page reaches a phone at all - so a service that is restarting must not
 * lose one. A request the service did not answer, or answered with a server
 * error, a timeout or a rate limit, is tried again, SIGNED_WEBHOOK_MAX_ATTEMPTS
 * times in all. One it refused (any other 4xx) is not: it will refuse it
 * again.
 *
 * Each request names its event (X-OneUptime-Event) and carries the HMAC of
 * its exact body, keyed with the service's secret (X-OneUptime-Signature:
 * sha256=<hex>), so one verifier serves both. What is sent is the caller's
 * business; what the outcome is called, and where it is recorded, is too.
 */

// How long one attempt waits for the service to answer.
export const SIGNED_WEBHOOK_REQUEST_TIMEOUT_MS: number = 10_000;

// Attempts in all, the first included.
export const SIGNED_WEBHOOK_MAX_ATTEMPTS: number = 3;

// How long to wait before the second attempt, and before the third.
export const SIGNED_WEBHOOK_RETRY_DELAYS_MS: ReadonlyArray<number> = [
  1_000, 4_000,
];

/*
 * The largest body a request may have. The texts in it are held to a budget
 * long before this (MAX_CUSTOM_CHANNEL_TEXT_LENGTH,
 * MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH), so it is a backstop.
 */
export const MAX_SIGNED_WEBHOOK_BODY_LENGTH: number = 200_000;

// What a signed request came to, after every attempt (SignedWebhookPost.post).
export interface SignedPostOutcome {
  isDelivered: boolean;
  // The HTTP status of the last answer, when there was one.
  statusCode?: number | undefined;
  // Why the last attempt failed, for the server's log only.
  error?: string | undefined;
  attempts: number;
}

// What one attempt came to.
interface AttemptOutcome {
  statusCode?: number | undefined;
  // Whether trying again could go differently.
  isWorthRetrying: boolean;
  isDelivered: boolean;
  // Why it failed, for the server's log only.
  error?: string | undefined;
}

// A status worth trying again: the service is down, overloaded or slow.
export const isRetryableStatus: (statusCode: number) => boolean = (
  statusCode: number,
): boolean => {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
};

// The signature a request carries: the HMAC of its exact body.
export const signWebhookBody: (data: {
  secret: string;
  body: string;
}) => string = (data: { secret: string; body: string }): string => {
  return `sha256=${crypto.createHmac("sha256", data.secret).update(data.body).digest("hex")}`;
};

export default class SignedWebhookPost {
  // Waits between attempts. A seam for tests.
  public static sleep(ms: number): Promise<void> {
    return new Promise((resolve: () => void): void => {
      setTimeout(resolve, ms);
    });
  }

  /*
   * Posts the payload signed with the secret, naming its event, and tries it
   * again while trying again could go differently. Answers how the last
   * attempt went, and how many there were.
   */
  public static async post(data: {
    url: string;
    secret: string;
    eventType: string;
    payload: JSONObject;
    userAgent: string;
  }): Promise<SignedPostOutcome> {
    const body: string = JSON.stringify(data.payload);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": data.userAgent,
      [CUSTOM_CHANNEL_EVENT_HEADER]: data.eventType,
      [CUSTOM_CHANNEL_SIGNATURE_HEADER]: signWebhookBody({
        secret: data.secret,
        body: body,
      }),
    };

    let outcome: AttemptOutcome = {
      isWorthRetrying: true,
      isDelivered: false,
    };
    let attempts: number = 0;

    while (attempts < SIGNED_WEBHOOK_MAX_ATTEMPTS) {
      if (attempts > 0) {
        await this.sleep(SIGNED_WEBHOOK_RETRY_DELAYS_MS[attempts - 1] || 0);
      }

      attempts++;

      outcome = await this.attempt({
        url: data.url,
        payload: data.payload,
        headers: headers,
      });

      if (outcome.isDelivered || !outcome.isWorthRetrying) {
        break;
      }
    }

    return {
      isDelivered: outcome.isDelivered,
      statusCode: outcome.statusCode,
      error: outcome.error,
      attempts: attempts,
    };
  }

  private static async attempt(data: {
    url: string;
    payload: JSONObject;
    headers: Record<string, string>;
  }): Promise<AttemptOutcome> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(data.url),
          data: data.payload,
          headers: data.headers,
          options: {
            timeout: SIGNED_WEBHOOK_REQUEST_TIMEOUT_MS,
            doNotFollowRedirects: true,
          },
        });

      const statusCode: number = response.statusCode || 0;

      if (
        !(response instanceof HTTPErrorResponse) &&
        statusCode >= 200 &&
        statusCode < 300
      ) {
        return {
          statusCode: statusCode,
          isDelivered: true,
          isWorthRetrying: false,
        };
      }

      return {
        statusCode: statusCode || undefined,
        isDelivered: false,
        isWorthRetrying: !statusCode || isRetryableStatus(statusCode),
        error: `HTTP ${statusCode}`,
      };
    } catch (err) {
      // No answer at all: a timeout, a refused connection, a name that does not resolve.
      return {
        isDelivered: false,
        isWorthRetrying: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
