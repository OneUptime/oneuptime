import HuntressConnection from "../../../Models/DatabaseModels/HuntressConnection";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { ParsedHuntressWebhook, parseHuntressWebhook } from "../../../Types/Huntress/HuntressWebhook";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import HuntressConnectionService from "../../Services/HuntressConnectionService";
import logger from "../Logger";
import StandardWebhookSignature, {
  StandardWebhookVerification,
} from "../Webhook/StandardWebhookSignature";
import HuntressIncidentReportProcessor, {
  HuntressReportBusyException,
  HuntressReportResult,
} from "./HuntressIncidentReportProcessor";

/*
 * One request to a Huntress connection's webhook URL
 * (POST /api/huntress/webhook/<connection id>), answered the way Svix reads
 * answers: a 2xx is delivered, anything else is retried - in 5 seconds,
 * 5 minutes, 30 minutes, then hours apart, for about a day.
 *
 *   404  no connection has this address (deleted, or a typo in Huntress)
 *   401  no signing secret is saved yet, or the signature does not verify;
 *        a delivery refused before the secret is saved goes through on a
 *        retry once it is
 *   400  the body is not a Huntress event
 *   413  the body is larger than any Huntress event
 *   503  another delivery of the same report is being handled
 *   500  the report could not be handled (no incident severity in the
 *        project, the database unavailable): retried
 *   200  handled, or an event that is not about an incident report
 *        (escalations, platform actions, account notices), acknowledged
 *
 * Only the bytes that were signed are acted on: the body is parsed from
 * the raw request text the signature covers, never from what the JSON
 * parser in front of the route made of it.
 *
 * Why a request was refused is kept on the connection (lastError), at most
 * once a minute for the same reason, so a stream of bad requests cannot
 * keep the row busy; the connection's page shows it.
 */

export const HUNTRESS_MAX_BODY_LENGTH: number = 5 * 1024 * 1024;
export const HUNTRESS_ERROR_RECORD_INTERVAL_MS: number = 60 * 1000;

export const HUNTRESS_NO_SIGNING_SECRET_MESSAGE: string =
  "A request arrived but was refused, because no signing secret is saved for this connection yet. In Huntress, open the endpoint's menu (⋯), choose View Signing Secret, and save it here. Huntress sends the refused request again.";

type HeaderValue = string | Array<string> | undefined;

export interface HuntressWebhookRequest {
  connectionId: string | undefined;
  headers: Record<string, HeaderValue>;
  // The request body exactly as it was sent.
  rawBody: string | undefined;
  now?: Date | undefined;
}

export interface HuntressWebhookAnswer {
  statusCode: number;
  body: JSONObject;
}

function answer(statusCode: number, body: JSONObject): HuntressWebhookAnswer {
  return { statusCode, body };
}

export default class HuntressWebhookHandler {
  public static async handle(
    request: HuntressWebhookRequest,
  ): Promise<HuntressWebhookAnswer> {
    const now: Date = request.now || OneUptimeDate.getCurrentDate();
    const connectionId: string = (request.connectionId || "").trim();

    if (!connectionId || !ObjectID.isValidUUID(connectionId)) {
      return answer(404, {
        message: "No Huntress connection has this address.",
      });
    }

    const connection: HuntressConnection | null =
      await HuntressConnectionService.findOneById({
        id: new ObjectID(connectionId),
        select: {
          ...HuntressIncidentReportProcessor.CONNECTION_SELECT,
          signingSecret: true,
          lastError: true,
          lastErrorAt: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!connection || !connection.id) {
      return answer(404, {
        message: "No Huntress connection has this address.",
      });
    }

    if (!connection.signingSecret) {
      await this.recordError(connection, HUNTRESS_NO_SIGNING_SECRET_MESSAGE, now);

      return answer(401, { message: HUNTRESS_NO_SIGNING_SECRET_MESSAGE });
    }

    const rawBody: string | undefined = request.rawBody;

    if (!rawBody) {
      const message: string =
        "The request has no JSON body. Huntress sends every event as JSON.";
      await this.recordError(connection, message, now);

      return answer(400, { message });
    }

    if (rawBody.length > HUNTRESS_MAX_BODY_LENGTH) {
      const message: string =
        "The request body is larger than any Huntress event, so it was refused.";
      await this.recordError(connection, message, now);

      return answer(413, { message });
    }

    const verification: StandardWebhookVerification =
      StandardWebhookSignature.verify({
        secret: connection.signingSecret,
        headers: StandardWebhookSignature.readHeaders(request.headers),
        body: rawBody,
        now,
      });

    if (!verification.verified) {
      await this.recordError(connection, verification.message, now);

      return answer(401, { message: verification.message });
    }

    let body: unknown;

    try {
      body = JSON.parse(rawBody);
    } catch {
      const message: string = "The request body is not valid JSON.";
      await this.recordError(connection, message, now);

      return answer(400, { message });
    }

    const parsed: ParsedHuntressWebhook = parseHuntressWebhook(body);

    if (parsed.kind === "invalid") {
      await this.recordError(connection, parsed.reason, now);

      return answer(400, { message: parsed.reason });
    }

    if (parsed.kind === "not-an-incident-report") {
      await this.recordEvent(connection, parsed.eventType, now);

      return answer(200, {
        received: true,
        eventType: parsed.eventType,
        message:
          "Received. Only incident report events open incidents, so this event changes nothing.",
      });
    }

    let result: HuntressReportResult;

    try {
      result = await HuntressIncidentReportProcessor.process({
        settings: HuntressIncidentReportProcessor.getSettings(connection),
        event: parsed.event,
        messageId: verification.messageId,
        now,
      });
    } catch (err) {
      if (err instanceof HuntressReportBusyException) {
        return answer(503, { message: err.message });
      }

      logger.error(
        `HuntressWebhookHandler: connection ${connection.id.toString()} could not handle incident report ${parsed.event.reportId}:`,
      );
      logger.error(err);

      const message: string =
        err instanceof BadDataException
          ? err.message
          : `Incident report ${parsed.event.reportId} could not be handled. Huntress will send it again.`;

      await this.recordError(connection, message, now);

      return answer(500, { message });
    }

    await this.recordEvent(connection, parsed.event.eventType, now);

    return answer(200, {
      received: true,
      eventType: parsed.event.eventType,
      reportId: parsed.event.reportId,
      action: result.action,
      outcome: result.outcome,
      incidentId: result.incidentId ? result.incidentId.toString() : null,
    });
  }

  // A request that verified: when, what, and nothing wrong any more.
  private static async recordEvent(
    connection: HuntressConnection,
    eventType: string,
    now: Date,
  ): Promise<void> {
    try {
      await HuntressConnectionService.updateOneById({
        id: connection.id!,
        data: {
          lastEventReceivedAt: now,
          lastEventType: eventType.slice(0, 100),
          lastError: null,
          lastErrorAt: null,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    } catch (err) {
      // The event was handled; failing to note when is not worth a retry.
      logger.error(
        `HuntressWebhookHandler: could not record the last event of connection ${connection.id?.toString()}: ${err}`,
      );
    }
  }

  /*
   * Why a request was refused. The same reason is written at most once a
   * minute.
   */
  private static async recordError(
    connection: HuntressConnection,
    message: string,
    now: Date,
  ): Promise<void> {
    const lastErrorAt: Date | undefined = connection.lastErrorAt
      ? new Date(connection.lastErrorAt)
      : undefined;

    if (
      connection.lastError === message &&
      lastErrorAt &&
      now.getTime() - lastErrorAt.getTime() < HUNTRESS_ERROR_RECORD_INTERVAL_MS
    ) {
      return;
    }

    try {
      await HuntressConnectionService.updateOneById({
        id: connection.id!,
        data: {
          lastError: message,
          lastErrorAt: now,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    } catch (err) {
      logger.error(
        `HuntressWebhookHandler: could not record an error on connection ${connection.id?.toString()}: ${err}`,
      );
    }
  }
}
