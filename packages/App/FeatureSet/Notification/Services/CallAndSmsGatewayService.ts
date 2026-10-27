import { getCallAndSmsGateway } from "../Config";
import CustomChannelService, {
  MAX_CUSTOM_CHANNEL_BODY_LENGTH,
  SignedPostOutcome,
} from "./CustomChannelService";
import { CallAndSmsGateway } from "Common/Types/CallAndSMS/CallAndSmsProvider";
import {
  buildCallAndSmsGatewayTestPayload,
  CallAndSmsGatewayEvent,
} from "Common/Types/CallAndSMS/CallAndSmsGatewayPayload";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";

/*
 * SENDING AN SMS OR A CALL THROUGH THE SERVER'S OWN GATEWAY.
 *
 * A server set to send its SMS and calls through its own gateway
 * (CallAndSmsProvider.Gateway) posts each one to the gateway's URL as one
 * JSON request (CallAndSmsGatewayPayload), signed with the gateway's secret
 * and tried again as a custom channel's request is
 * (CustomChannelService.postSigned): a gateway that is restarting does not
 * lose a page.
 *
 * What is recorded where people read it - the SMS or call log, the on-call
 * log row, a test's answer - names the gateway and the HTTP status, never
 * its URL: the URL is the installation admin's, and the project's members
 * read those rows. The server's log has the rest, for the admin.
 */

// The User-Agent of the gateway's requests.
export const CALL_AND_SMS_GATEWAY_USER_AGENT: string =
  "OneUptime-CallAndSmsGateway/1.0";

// How the gateway is named where people read about a delivery.
export const CALL_AND_SMS_GATEWAY_NAME: string = "the SMS and call gateway";

// What the test answers on a server that does not send through a gateway.
export const CALL_AND_SMS_GATEWAY_NOT_SET_UP_MESSAGE: string =
  "Not sent: this server sends SMS and calls through Twilio. Choose your own gateway, add its Gateway URL and save, then send a test.";

// How a request to the gateway went, in words fit for whoever reads it.
export interface CallAndSmsGatewayResult {
  ok: boolean;
  // The HTTP status the gateway answered with, when it answered.
  statusCode?: number | undefined;
  message: string;
}

export default class CallAndSmsGatewayService {
  public static async send(data: {
    gateway: CallAndSmsGateway;
    event: CallAndSmsGatewayEvent;
    payload: JSONObject;
  }): Promise<CallAndSmsGatewayResult> {
    const body: string = JSON.stringify(data.payload);

    if (body.length > MAX_CUSTOM_CHANNEL_BODY_LENGTH) {
      return {
        ok: false,
        message: `Not sent: the request for ${CALL_AND_SMS_GATEWAY_NAME} is larger than ${MAX_CUSTOM_CHANNEL_BODY_LENGTH} bytes.`,
      };
    }

    try {
      /*
       * The installation's own gateway, often on its private network, so
       * private targets are allowed - as they are when its URL is saved
       * (GlobalConfigService).
       */
      await SSRFProtection.validateWebhookTargetIsSafe(data.gateway.url, {
        allowPrivateNetworkTargets: true,
      });
    } catch (err) {
      logger.error(
        "SMS and call gateway: its URL was refused.",
        EXTERNAL_FAULT,
      );
      logger.error(err, EXTERNAL_FAULT);

      return {
        ok: false,
        message: `Not delivered: the URL of ${CALL_AND_SMS_GATEWAY_NAME} is not allowed. Your administrator can see why in the server's log.`,
      };
    }

    const outcome: SignedPostOutcome = await CustomChannelService.postSigned({
      url: data.gateway.url,
      secret: data.gateway.secret,
      eventType: data.event,
      payload: data.payload,
      userAgent: CALL_AND_SMS_GATEWAY_USER_AGENT,
    });

    if (outcome.isDelivered) {
      return {
        ok: true,
        statusCode: outcome.statusCode,
        message: `Sent to ${CALL_AND_SMS_GATEWAY_NAME} (HTTP ${outcome.statusCode}).`,
      };
    }

    logger.error(
      `SMS and call gateway: a ${data.event} request was not delivered after ${outcome.attempts} attempt(s). ${outcome.error || ""}`,
      EXTERNAL_FAULT,
    );

    const tries: string =
      outcome.attempts > 1 ? ` (tried ${outcome.attempts} times)` : "";

    if (outcome.statusCode) {
      return {
        ok: false,
        statusCode: outcome.statusCode,
        message: `Not delivered: ${CALL_AND_SMS_GATEWAY_NAME} answered HTTP ${outcome.statusCode}${tries}.`,
      };
    }

    return {
      ok: false,
      message: `Not delivered: ${CALL_AND_SMS_GATEWAY_NAME} could not be reached${tries}.`,
    };
  }

  /*
   * Send test, from Admin Dashboard > Settings > Call and SMS: a request
   * to the gateway as saved, to nobody, that it should answer with 2xx and
   * send nothing.
   */
  public static async sendTest(): Promise<CallAndSmsGatewayResult> {
    const gateway: CallAndSmsGateway | null = await getCallAndSmsGateway();

    if (!gateway) {
      return {
        ok: false,
        message: CALL_AND_SMS_GATEWAY_NOT_SET_UP_MESSAGE,
      };
    }

    return await this.send({
      gateway: gateway,
      event: CallAndSmsGatewayEvent.Test,
      payload: buildCallAndSmsGatewayTestPayload({
        id: ObjectID.generate().toString(),
        sentAt: OneUptimeDate.getCurrentDate(),
      }),
    });
  }
}
