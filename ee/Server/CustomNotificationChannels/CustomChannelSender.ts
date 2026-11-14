import SignedWebhookPost, {
  MAX_SIGNED_WEBHOOK_BODY_LENGTH,
  SignedPostOutcome,
} from "App/FeatureSet/Notification/Utils/SignedWebhookPost";
import CustomNotificationChannelService from "Common/Server/Services/CustomNotificationChannelService";
import { CustomChannelDeliveryResult } from "Common/Server/Services/CustomNotificationChannelDeliveryService";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import { recordSendResult } from "Common/Server/Utils/OnCall/OnCallNotificationStatus";
import CustomChannelEdition, {
  CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE,
} from "Common/Server/Utils/Notification/CustomChannelEdition";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import NotificationDeliveryMetrics, {
  NotificationDeliveryChannel,
  NotificationDeliveryOutcome,
  NotificationDeliveryProvider,
  NotificationDispatch,
} from "Common/Server/Utils/Telemetry/NotificationDeliveryMetrics";
import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * SENDING A REQUEST TO A CUSTOM CHANNEL (Enterprise Edition).
 *
 * Core hands a request for a channel here by the channel's id
 * (CustomNotificationChannelDeliveryService, through CustomChannelSendAPI):
 * the URL and the secret are read here, and the request is posted signed and
 * tried again (SignedWebhookPost, which the Community Edition's SMS and call
 * gateway shares). A custom channel is often how a page reaches a phone at
 * all - the company's own app in place of push - so a service that is
 * restarting must not lose it.
 *
 * What is recorded where people can read it - the notification's on-call log
 * row, a test's answer - names the channel and the HTTP status, never the
 * URL: the URL is the installation admin's, and the project's members read
 * those rows. The server's log has the rest, for the admin.
 */

// The User-Agent of a custom channel's requests.
export const CUSTOM_CHANNEL_USER_AGENT: string = "OneUptime-CustomChannel/1.0";

export default class CustomChannelSender {
  public static async send(input: {
    customNotificationChannelId: ObjectID;
    eventType: string;
    payload: JSONObject;
    isTest?: boolean | undefined;
    userOnCallLogTimelineId?: ObjectID | undefined;
  }): Promise<CustomChannelDeliveryResult> {
    /*
     * How it went, for the platform's operator (NotificationDeliveryMetrics):
     * by the channel's id and name, as an installation's custom channels
     * are told apart. A test - its admin trying it - is not counted, and a
     * request that throws is left to core, which records it as failed when
     * it gets no answer (CustomNotificationChannelDeliveryService).
     */
    const dispatch: NotificationDispatch =
      NotificationDeliveryMetrics.startDispatch({
        channel: NotificationDeliveryChannel.CustomChannel,
        provider: NotificationDeliveryProvider.CustomChannel,
        isOnCallPage: Boolean(input.userOnCallLogTimelineId),
        customChannel: {
          id: input.customNotificationChannelId.toString(),
        },
      });

    const result: CustomChannelDeliveryResult = await this.deliver(
      input,
      dispatch,
    );

    if (!input.isTest) {
      dispatch.end(
        result.ok
          ? NotificationDeliveryOutcome.Success
          : NotificationDeliveryOutcome.Failure,
      );
    }

    /*
     * Written only while the page's timeline entry still says Sending
     * (OnCallNotificationStatus): the person may have acknowledged the page,
     * or escalated it, meanwhile - from another of its messages, or from
     * this one, as soon as the company's app showed it.
     */
    if (input.userOnCallLogTimelineId) {
      await recordSendResult({
        userOnCallLogTimelineId: input.userOnCallLogTimelineId,
        isSent: result.ok,
        statusMessage: result.message,
      });
    }

    return result;
  }

  private static async deliver(
    input: {
      customNotificationChannelId: ObjectID;
      eventType: string;
      payload: JSONObject;
      isTest?: boolean | undefined;
    },
    dispatch: NotificationDispatch,
  ): Promise<CustomChannelDeliveryResult> {
    /*
     * Asked again here, as well as by core before it hands a request over:
     * the license can lapse between the two.
     */
    if (!CustomChannelEdition.isActive()) {
      dispatch.markNotSent();

      return {
        ok: false,
        message: CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE,
      };
    }

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
      // Its admin deleted it: the rules that point at it send nothing.
      dispatch.markNotSent();

      return {
        ok: false,
        message: "Not sent: this custom channel no longer exists.",
      };
    }

    dispatch.setCustomChannel({
      id: input.customNotificationChannelId.toString(),
      name: channel.name,
    });

    const name: string = channel.name || "the custom channel";

    if (channel.isEnabled === false && !input.isTest) {
      dispatch.markNotSent();

      return {
        ok: false,
        message: `Not sent: ${name} is turned off. Your administrator can turn it on in the Admin Dashboard, under Settings > Notifications > Custom Channels.`,
      };
    }

    const body: string = JSON.stringify(input.payload || {});

    if (body.length > MAX_SIGNED_WEBHOOK_BODY_LENGTH) {
      return {
        ok: false,
        message: `Not sent: the request for ${name} is longer than ${MAX_SIGNED_WEBHOOK_BODY_LENGTH} characters.`,
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

    const outcome: SignedPostOutcome = await SignedWebhookPost.post({
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
}
