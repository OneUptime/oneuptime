import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { JSONObject } from "Common/Types/JSON";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  CUSTOM_CHANNEL_EVENT_HEADER,
  CUSTOM_CHANNEL_SIGNATURE_HEADER,
} from "Common/Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import CustomNotificationChannelService from "Common/Server/Services/CustomNotificationChannelService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import { CustomChannelDeliveryResult } from "Common/Server/Services/CustomNotificationChannelDeliveryService";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import API from "Common/Utils/API";
import crypto from "crypto";

/*
 * SENDING A REQUEST TO A CUSTOM CHANNEL.
 *
 * A custom channel is often how a page reaches a phone at all - the company's
 * own app in place of push - so a service that is restarting must not lose
 * it: a request the service did not answer, or answered with a server error,
 * is tried again, CUSTOM_CHANNEL_MAX_ATTEMPTS times in all. One it refused
 * (a 4xx other than a timeout or rate limit) is not: it will refuse it again.
 *
 * What is recorded where people can read it - the notification's on-call log
 * row, a test's answer - names the channel and the HTTP status, never the
 * URL: the URL is the installation admin's, and the project's members read
 * those rows. The server's log has the rest, for the admin.
 */

// How long one attempt waits for the channel's service to answer.
export const CUSTOM_CHANNEL_REQUEST_TIMEOUT_MS: number = 10_000;

// Attempts in all, the first included.
export const CUSTOM_CHANNEL_MAX_ATTEMPTS: number = 3;

// How long to wait before the second attempt, and before the third.
export const CUSTOM_CHANNEL_RETRY_DELAYS_MS: ReadonlyArray<number> = [
  1_000, 4_000,
];

/*
 * The largest body a request may have. The texts in it are held to
 * MAX_CUSTOM_CHANNEL_TEXT_LENGTH long before this, so it is a backstop.
 */
export const MAX_CUSTOM_CHANNEL_BODY_LENGTH: number = 200_000;

// The User-Agent of a custom channel's requests.
export const CUSTOM_CHANNEL_USER_AGENT: string = "OneUptime-CustomChannel/1.0";

// What a signed request came to, after every attempt (postSigned).
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
export const signCustomChannelBody: (data: {
  secret: string;
  body: string;
}) => string = (data: { secret: string; body: string }): string => {
  return `sha256=${crypto.createHmac("sha256", data.secret).update(data.body).digest("hex")}`;
};

export default class CustomChannelService {
  // Waits between attempts. A seam for tests.
  public static sleep(ms: number): Promise<void> {
    return new Promise((resolve: () => void): void => {
      setTimeout(resolve, ms);
    });
  }

  public static async send(input: {
    customNotificationChannelId: ObjectID;
    eventType: string;
    payload: JSONObject;
    isTest?: boolean | undefined;
    userOnCallLogTimelineId?: ObjectID | undefined;
  }): Promise<CustomChannelDeliveryResult> {
    const result: CustomChannelDeliveryResult = await this.deliver(input);

    if (input.userOnCallLogTimelineId) {
      await UserOnCallLogTimelineService.updateOneById({
        id: input.userOnCallLogTimelineId,
        data: {
          status: result.ok
            ? UserNotificationStatus.Sent
            : UserNotificationStatus.Error,
          statusMessage: result.message,
        },
        props: {
          isRoot: true,
        },
      });
    }

    return result;
  }

  private static async deliver(input: {
    customNotificationChannelId: ObjectID;
    eventType: string;
    payload: JSONObject;
    isTest?: boolean | undefined;
  }): Promise<CustomChannelDeliveryResult> {
    const channel: CustomNotificationChannel | null =
      await CustomNotificationChannelService.findOneById({
        id: input.customNotificationChannelId,
        select: {
          _id: true,
          name: true,
          webhookUrl: true,
          secret: true,
          isEnabled: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!channel || !channel.webhookUrl) {
      return {
        ok: false,
        message: "Not sent: this custom channel no longer exists.",
      };
    }

    const name: string = channel.name || "the custom channel";

    if (channel.isEnabled === false && !input.isTest) {
      return {
        ok: false,
        message: `Not sent: ${name} is turned off. Your administrator can turn it on in the Admin Dashboard, under Settings > Custom Channels.`,
      };
    }

    const body: string = JSON.stringify(input.payload || {});

    if (body.length > MAX_CUSTOM_CHANNEL_BODY_LENGTH) {
      return {
        ok: false,
        message: `Not sent: the request for ${name} is larger than ${MAX_CUSTOM_CHANNEL_BODY_LENGTH} bytes.`,
      };
    }

    try {
      /*
       * The admin's own service, often on the installation's private
       * network, so private targets are allowed - as they are when the
       * channel is saved (CustomNotificationChannelService).
       */
      await SSRFProtection.validateWebhookTargetIsSafe(channel.webhookUrl, {
        allowPrivateNetworkTargets: true,
      });
    } catch (err) {
      logger.error(
        `Custom channel ${channel.id?.toString()} (${name}): its URL was refused.`,
        EXTERNAL_FAULT,
      );
      logger.error(err, EXTERNAL_FAULT);

      return {
        ok: false,
        message: `Not delivered: the URL of ${name} is not allowed. Your administrator can see why in the server's log.`,
      };
    }

    const outcome: SignedPostOutcome = await this.postSigned({
      url: channel.webhookUrl,
      secret: channel.secret || "",
      eventType: input.eventType,
      payload: input.payload || {},
      userAgent: CUSTOM_CHANNEL_USER_AGENT,
    });

    const attempts: number = outcome.attempts;

    if (outcome.isDelivered) {
      return {
        ok: true,
        statusCode: outcome.statusCode,
        message: `Sent to ${name} (HTTP ${outcome.statusCode}).`,
      };
    }

    logger.error(
      `Custom channel ${channel.id?.toString()} (${name}): not delivered after ${attempts} attempt(s). ${outcome.error || ""}`,
      EXTERNAL_FAULT,
    );

    const tries: string = attempts > 1 ? ` (tried ${attempts} times)` : "";

    if (outcome.statusCode) {
      return {
        ok: false,
        statusCode: outcome.statusCode,
        message: `Not delivered: ${name} answered HTTP ${outcome.statusCode}${tries}.`,
      };
    }

    return {
      ok: false,
      message: `Not delivered: ${name} could not be reached${tries}.`,
    };
  }

  /*
   * Posts a request signed with a secret, naming its event, and tries it
   * again as a custom channel's is: CUSTOM_CHANNEL_MAX_ATTEMPTS times in all
   * while the service does not answer, answers a server error, a timeout or
   * a rate limit. The server's SMS and call gateway is posted to through it
   * too (CallAndSmsGatewayService), so both are signed and retried alike.
   * Answers how the last attempt went, and how many there were.
   */
  public static async postSigned(data: {
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
      [CUSTOM_CHANNEL_SIGNATURE_HEADER]: signCustomChannelBody({
        secret: data.secret,
        body: body,
      }),
    };

    let outcome: AttemptOutcome = {
      isWorthRetrying: true,
      isDelivered: false,
    };
    let attempts: number = 0;

    while (attempts < CUSTOM_CHANNEL_MAX_ATTEMPTS) {
      if (attempts > 0) {
        await this.sleep(CUSTOM_CHANNEL_RETRY_DELAYS_MS[attempts - 1] || 0);
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
            timeout: CUSTOM_CHANNEL_REQUEST_TIMEOUT_MS,
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
