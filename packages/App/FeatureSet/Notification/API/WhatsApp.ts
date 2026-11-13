import WhatsAppService from "../Services/WhatsAppService";
import BadDataException from "Common/Types/Exception/BadDataException";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import WhatsAppMessage from "Common/Types/WhatsApp/WhatsAppMessage";
import {
  WhatsAppTemplateId,
  WhatsAppTemplateIds,
  WhatsAppTemplateLanguage,
} from "Common/Types/WhatsApp/WhatsAppTemplates";
import WhatsAppStatus from "Common/Types/WhatsAppStatus";
import WhatsAppLog from "Common/Models/DatabaseModels/WhatsAppLog";
import Select from "Common/Server/Types/Database/Select";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import OneUptimeDate from "Common/Types/Date";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { recordProviderReport } from "Common/Server/Utils/OnCall/OnCallNotificationStatus";
import NotificationDeliveryMetrics, {
  NotificationDeliveryChannel,
  NotificationDeliveryProvider,
  NotificationDeliveryStatus,
  NotificationProviderConfig,
} from "Common/Server/Utils/Telemetry/NotificationDeliveryMetrics";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import WhatsAppAuthorization from "Common/Server/Middleware/WhatsAppAuthorization";
import WhatsAppLogService from "Common/Server/Services/WhatsAppLogService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";

const router: ExpressRouter = Express.getRouter();

const MAX_STATUS_MESSAGE_LENGTH: number = 500;

export const mapWebhookStatusToWhatsAppStatus: (
  status?: string,
) => WhatsAppStatus = (status?: string): WhatsAppStatus => {
  switch ((status || "").toLowerCase()) {
    case "sent":
      return WhatsAppStatus.Sent;
    case "delivered":
      return WhatsAppStatus.Delivered;
    case "read":
      return WhatsAppStatus.Read;
    case "failed":
      return WhatsAppStatus.Failed;
    case "deleted":
    case "removed":
      return WhatsAppStatus.Deleted;
    case "warning":
      return WhatsAppStatus.Warning;
    case "queued":
    case "pending":
      return WhatsAppStatus.Queued;
    case "error":
      return WhatsAppStatus.Error;
    case "success":
      return WhatsAppStatus.Success;
    default:
      return WhatsAppStatus.Unknown;
  }
};

export const buildStatusMessage: (payload: JSONObject) => string | undefined = (
  payload: JSONObject,
): string | undefined => {
  const messageParts: Array<string> = [];
  const rawStatus: string | undefined = payload["status"]
    ? String(payload["status"])
    : undefined;

  if (rawStatus) {
    messageParts.push(`Status: ${rawStatus}`);
  }

  const timestamp: string | undefined = payload["timestamp"]
    ? String(payload["timestamp"])
    : undefined;

  if (timestamp) {
    const numericTimestamp: number = Number(timestamp);
    if (!isNaN(numericTimestamp)) {
      messageParts.push(
        `Timestamp: ${new Date(numericTimestamp * 1000).toISOString()}`,
      );
    } else {
      messageParts.push(`Timestamp: ${timestamp}`);
    }
  }

  const conversation: JSONObject | undefined =
    (payload["conversation"] as JSONObject | undefined) || undefined;

  if (conversation) {
    if (conversation["id"]) {
      messageParts.push(`Conversation: ${conversation["id"]}`);
    }

    const origin: JSONObject | undefined =
      (conversation["origin"] as JSONObject | undefined) || undefined;

    if (origin?.["type"]) {
      messageParts.push(`Origin: ${origin["type"]}`);
    }

    if (conversation["expiration_timestamp"]) {
      const expirationTimestamp: number = Number(
        conversation["expiration_timestamp"],
      );

      if (!isNaN(expirationTimestamp)) {
        messageParts.push(
          `Conversation expires: ${new Date(expirationTimestamp * 1000).toISOString()}`,
        );
      }
    }
  }

  const pricing: JSONObject | undefined =
    (payload["pricing"] as JSONObject | undefined) || undefined;

  if (pricing) {
    const pricingParts: Array<string> = [];

    if (pricing["billable"] !== undefined) {
      pricingParts.push(`billable=${pricing["billable"]}`);
    }

    if (pricing["category"]) {
      pricingParts.push(`category=${pricing["category"]}`);
    }

    if (pricing["pricing_model"]) {
      pricingParts.push(`model=${pricing["pricing_model"]}`);
    }

    if (pricingParts.length > 0) {
      messageParts.push(`Pricing: ${pricingParts.join(", ")}`);
    }
  }

  const errors: JSONArray | undefined =
    (payload["errors"] as JSONArray | undefined) || undefined;

  if (Array.isArray(errors) && errors.length > 0) {
    const firstError: JSONObject = errors[0] as JSONObject;
    const errorParts: Array<string> = [];

    if (firstError["title"]) {
      errorParts.push(String(firstError["title"]));
    }

    if (firstError["code"]) {
      errorParts.push(`code=${firstError["code"]}`);
    }

    if (firstError["detail"]) {
      errorParts.push(String(firstError["detail"]));
    }

    if (errorParts.length > 0) {
      messageParts.push(`Error: ${errorParts.join(" - ")}`);
    }
  }

  if (messageParts.length === 0) {
    return undefined;
  }

  const statusMessage: string = messageParts.join(" | ");

  if (statusMessage.length <= MAX_STATUS_MESSAGE_LENGTH) {
    return statusMessage;
  }

  return `${statusMessage.substring(0, MAX_STATUS_MESSAGE_LENGTH - 3)}...`;
};

// What Meta's status webhook reads of a WhatsApp log.
export const WHATSAPP_LOG_STATUS_WEBHOOK_SELECT: Select<WhatsAppLog> = {
  _id: true,
  status: true,
  userOnCallLogTimelineId: true,
  createdAt: true,
};

/*
 * How many times a webhook writes its status when the log keeps changing
 * under it: each try reads the log again.
 */
export const MAX_STATUS_WRITE_ATTEMPTS: number = 3;

/*
 * Whether a status Meta reports is older than the log's. Meta's webhooks
 * arrive out of order: once a message reached a final status - delivered,
 * read, failed (NotificationDeliveryMetrics.getDeliveryStatusOfWhatsApp) -
 * only "read" moves a delivered message on, and any other status is stale.
 */
export function isStaleWhatsAppStatus(data: {
  current: WhatsAppStatus | null | undefined;
  next: WhatsAppStatus;
}): boolean {
  if (!NotificationDeliveryMetrics.getDeliveryStatusOfWhatsApp(data.current)) {
    return false;
  }

  return !(
    data.current === WhatsAppStatus.Delivered &&
    data.next === WhatsAppStatus.Read
  );
}

/*
 * What became of one status of Meta's webhook: handled - written, or
 * nothing to write - or to be sent again by Meta, as it names a message
 * whose log does not have the message's id yet while a send is on its way.
 */
export enum WhatsAppStatusOutcome {
  Handled = "Handled",
  SendAgain = "SendAgain",
}

/*
 * How long a send counts as on its way once its log is written: the log is
 * written Queued, with no message id, just before the message is handed to
 * Meta, and gets the id with Meta's answer (WhatsAppService) - a moment
 * later. A log left so for longer is a send that never finished.
 */
export const SEND_ON_ITS_WAY_FOR_MS: number = 5 * 60 * 1000;

/*
 * How recent a status - by the time Meta says it happened - must be for
 * Meta to be asked to send it again. Meta retries a webhook it was not
 * answered 200 for, for days: a status of a message no log will ever have -
 * one sent by another app on the business account, or a test from the
 * Admin Dashboard, which is not logged - is never asked for again once it
 * is older than this.
 */
export const STATUS_SENT_AGAIN_WITHIN_MS: number = 10 * 60 * 1000;

/*
 * Whether Meta says the status happened within STATUS_SENT_AGAIN_WITHIN_MS
 * of now. A timestamp a little ahead of the server's clock is recent; one
 * that cannot be read is not.
 */
export function isRecentStatus(statusPayload: JSONObject): boolean {
  const timestamp: unknown = statusPayload["timestamp"];

  if (
    timestamp === undefined ||
    timestamp === null ||
    String(timestamp).trim() === ""
  ) {
    return false;
  }

  const timestampInSeconds: number = Number(timestamp);

  if (!Number.isFinite(timestampInSeconds)) {
    return false;
  }

  return (
    timestampInSeconds * 1000 >=
    OneUptimeDate.getCurrentDate().getTime() - STATUS_SENT_AGAIN_WITHIN_MS
  );
}

/*
 * What a failed WhatsApp page's on-call timeline entry says: that Meta
 * could not deliver it, and why, in Meta's words - as a failed SMS page's
 * says Twilio's (API/SMS.ts).
 */
export function buildFailedDeliveryMessage(data: {
  messageId: string;
  statusPayload: JSONObject;
}): string {
  let message: string = `Delivery status: ${WhatsAppStatus.Failed}. Message ID: ${data.messageId}.`;

  const errors: JSONArray | undefined =
    (data.statusPayload["errors"] as JSONArray | undefined) || undefined;

  if (!Array.isArray(errors) || errors.length === 0) {
    return message;
  }

  const firstError: JSONObject = (errors[0] || {}) as JSONObject;
  const errorData: JSONObject | undefined =
    (firstError["error_data"] as JSONObject | undefined) || undefined;

  // Meta's words, without the dot they may end with.
  const wordsOf: (value: unknown) => string = (value: unknown): string => {
    const text: string =
      value === undefined || value === null ? "" : String(value).trim();

    return text.endsWith(".") ? text.slice(0, -1).trim() : text;
  };

  const title: string = wordsOf(firstError["title"] || firstError["message"]);
  const details: string = wordsOf(
    errorData?.["details"] || firstError["detail"],
  );
  const code: string = wordsOf(firstError["code"]);

  const parts: Array<string> = [];

  if (title) {
    parts.push(code ? `${title} (code ${code})` : title);
  } else if (code) {
    parts.push(`code ${code}`);
  }

  // Meta's details often say again what its title says.
  if (details && details.toLowerCase() !== title.toLowerCase()) {
    parts.push(details);
  }

  if (parts.length > 0) {
    message += ` Provider error: ${parts.join(": ")}.`;
  }

  return message;
}

/*
 * The log of the message Meta's id names. The log gets the id with the
 * send's result, once Meta answered the send (WhatsAppService).
 */
const findLogOfMessage: (
  messageId: string,
) => Promise<WhatsAppLog | null> = async (
  messageId: string,
): Promise<WhatsAppLog | null> => {
  return await WhatsAppLogService.findOneBy({
    query: {
      whatsAppMessageId: messageId,
    },
    select: WHATSAPP_LOG_STATUS_WEBHOOK_SELECT,
    props: {
      isRoot: true,
    },
  });
};

/*
 * Whether a message is being handed to Meta right now: a log written
 * Queued, with no message id yet, in the last SEND_ON_ITS_WAY_FOR_MS. Its
 * id - which a status names - is written once Meta answers.
 */
export const isSendOnItsWay: () => Promise<boolean> =
  async (): Promise<boolean> => {
    const sendOnItsWay: WhatsAppLog | null = await WhatsAppLogService.findOneBy(
      {
        query: {
          status: WhatsAppStatus.Queued,
          whatsAppMessageId: QueryHelper.isNull(),
          createdAt: QueryHelper.greaterThan(
            new Date(
              OneUptimeDate.getCurrentDate().getTime() - SEND_ON_ITS_WAY_FOR_MS,
            ),
          ),
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      },
    );

    return Boolean(sendOnItsWay);
  };

export const updateWhatsAppLogStatus: (
  statusPayload: JSONObject,
) => Promise<WhatsAppStatusOutcome> = async (
  statusPayload: JSONObject,
): Promise<WhatsAppStatusOutcome> => {
  const messageId: string | undefined = statusPayload["id"]
    ? String(statusPayload["id"])
    : undefined;

  const rawStatus: string | undefined = statusPayload["status"]
    ? String(statusPayload["status"])
    : undefined;

  /*
   * What a log line says of a status: its message's id and its status,
   * never the payload - which holds the recipient's phone number.
   */
  const statusInLogs: string = rawStatus || "none";

  if (!messageId) {
    logger.warn(
      `[Meta WhatsApp Webhook] Received a status without a message id (status: ${statusInLogs}).`,
      {} as any,
    );
    return WhatsAppStatusOutcome.Handled;
  }

  const derivedStatus: WhatsAppStatus =
    mapWebhookStatusToWhatsAppStatus(rawStatus);

  const statusMessage: string | undefined = buildStatusMessage(statusPayload);

  let whatsAppLog: WhatsAppLog | null = await findLogOfMessage(messageId);

  if (!whatsAppLog) {
    /*
     * No log has the id yet. Meta can report a status before the send's
     * result - and the id with it - is written (WhatsAppService): then
     * Meta is asked to send the status again, and it lands on the log once
     * the id is there - once, as every write is a compare-and-set below. A
     * status of a message no log will have is answered 200: an old one, or
     * one that comes while nothing is being sent.
     */
    if (isRecentStatus(statusPayload) && (await isSendOnItsWay())) {
      logger.debug(
        `[Meta WhatsApp Webhook] No WhatsApp log has message id ${messageId} yet (status: ${statusInLogs}) while a message is being sent: Meta is asked to send the status again.`,
        {} as any,
      );
      return WhatsAppStatusOutcome.SendAgain;
    }

    // The send's result, with the id, may have been written since it was looked for.
    whatsAppLog = await findLogOfMessage(messageId);

    if (!whatsAppLog) {
      logger.warn(
        `[Meta WhatsApp Webhook] No WhatsApp log found for message id ${messageId} (status: ${statusInLogs}).`,
        {} as any,
      );
      return WhatsAppStatusOutcome.Handled;
    }
  }

  /*
   * A bookkeeping stamp on the message's own log - WhatsAppLog has update
   * workflows disabled and no service update hooks for a server's write -
   * written only while the log still says what was read, in one statement.
   * Meta's webhooks arrive out of order, and several in one request are
   * handled at once: the one that finds the log changed reads it again and
   * decides again, so a stale status never overwrites a final one, and a
   * final status is moved into once.
   */
  const logId: ObjectID = whatsAppLog.id!;
  let isWritten: boolean = false;

  for (
    let attempt: number = 0;
    attempt < MAX_STATUS_WRITE_ATTEMPTS && !isWritten;
    attempt++
  ) {
    if (attempt > 0) {
      whatsAppLog = await WhatsAppLogService.findOneById({
        id: logId,
        select: WHATSAPP_LOG_STATUS_WEBHOOK_SELECT,
        props: {
          isRoot: true,
        },
      });

      if (!whatsAppLog) {
        return WhatsAppStatusOutcome.Handled;
      }
    }

    if (
      isStaleWhatsAppStatus({
        current: whatsAppLog.status,
        next: derivedStatus,
      })
    ) {
      logger.debug(
        `[Meta WhatsApp Webhook] Kept the status of the WhatsApp log for message id ${messageId}: ${derivedStatus} came after ${whatsAppLog.status}.`,
        {} as any,
      );
      return WhatsAppStatusOutcome.Handled;
    }

    isWritten = await WhatsAppLogService.compareAndSetColumnsByIdWithoutHooks({
      id: logId,
      data: {
        status: derivedStatus,
        ...(statusMessage ? { statusMessage } : {}),
      },
      expectedData: {
        // A log with no status yet is expected to have none still.
        status: (whatsAppLog.status ?? null) as WhatsAppStatus,
      },
    });
  }

  if (!isWritten) {
    logger.warn(
      `[Meta WhatsApp Webhook] Could not write the status of the WhatsApp log for message id ${messageId}: it kept changing.`,
      {} as any,
    );
    return WhatsAppStatusOutcome.Handled;
  }

  /*
   * The message reached its final status now: how it ended, for the
   * platform's operator - once, as only the webhook that moved the log
   * into it gets here (notification.delivery.count).
   */
  const deliveryStatus: NotificationDeliveryStatus | null =
    NotificationDeliveryMetrics.getDeliveryStatusOfWhatsApp(derivedStatus);

  const hasEndedNow: boolean =
    Boolean(deliveryStatus) &&
    !NotificationDeliveryMetrics.getDeliveryStatusOfWhatsApp(
      whatsAppLog.status,
    );

  if (deliveryStatus && hasEndedNow) {
    NotificationDeliveryMetrics.recordDelivery({
      channel: NotificationDeliveryChannel.WhatsApp,
      provider: NotificationDeliveryProvider.MetaWhatsApp,
      // Sent with the installation's own WhatsApp Business account.
      providerConfig: NotificationProviderConfig.Global,
      isOnCallPage: Boolean(whatsAppLog.userOnCallLogTimelineId),
      status: deliveryStatus,
      // The log is written just before the message is handed to Meta.
      timeToStatusInMs: NotificationDeliveryMetrics.getMillisecondsSince(
        whatsAppLog.createdAt,
      ),
    });
  }

  /*
   * A page Meta could not deliver says so on the person's on-call timeline,
   * with Meta's words, as an SMS page Twilio could not deliver does
   * (API/SMS.ts): once, by the webhook that moved the log into Failed - a
   * repeated one finds the log failed already, and stops above - and only
   * while the page still says Sent or Sending (OnCallNotificationStatus).
   * An acknowledgement or a skip is never written over.
   */
  if (
    hasEndedNow &&
    derivedStatus === WhatsAppStatus.Failed &&
    whatsAppLog.userOnCallLogTimelineId
  ) {
    await recordProviderReport({
      userOnCallLogTimelineId: whatsAppLog.userOnCallLogTimelineId,
      status: UserNotificationStatus.Error,
      statusMessage: buildFailedDeliveryMessage({
        messageId: messageId,
        statusPayload: statusPayload,
      }),
    });
  }

  logger.debug(
    `[Meta WhatsApp Webhook] Updated WhatsApp log for message id ${messageId} with status ${derivedStatus}.`,
    {} as any,
  );

  return WhatsAppStatusOutcome.Handled;
};

const toTemplateVariables: (
  rawVariables: JSONObject | undefined,
) => Record<string, string> | undefined = (
  rawVariables: JSONObject | undefined,
): Record<string, string> | undefined => {
  if (!rawVariables) {
    return undefined;
  }

  const result: Record<string, string> = {};

  for (const key of Object.keys(rawVariables)) {
    const value: unknown = rawVariables[key];
    if (value !== null && value !== undefined) {
      result[key] = String(value);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

router.post(
  "/send",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    const body: JSONObject = req.body as JSONObject;

    if (!body["to"]) {
      throw new BadDataException("`to` phone number is required");
    }

    const toPhone: Phone = new Phone(body["to"] as string);

    const message: WhatsAppMessage = {
      to: toPhone,
      body: (body["body"] as string) || "",
      templateKey: (body["templateKey"] as string) || undefined,
      templateVariables: toTemplateVariables(
        body["templateVariables"] as JSONObject | undefined,
      ),
      templateLanguageCode:
        (body["templateLanguageCode"] as string) || undefined,
    };

    try {
      await WhatsAppService.sendWhatsApp(message, {
        projectId: body["projectId"]
          ? new ObjectID(body["projectId"] as string)
          : undefined,
        isSensitive: (body["isSensitive"] as boolean) || false,
        userOnCallLogTimelineId: body["userOnCallLogTimelineId"]
          ? new ObjectID(body["userOnCallLogTimelineId"] as string)
          : undefined,
        incidentId: body["incidentId"]
          ? new ObjectID(body["incidentId"] as string)
          : undefined,
        alertId: body["alertId"]
          ? new ObjectID(body["alertId"] as string)
          : undefined,
        scheduledMaintenanceId: body["scheduledMaintenanceId"]
          ? new ObjectID(body["scheduledMaintenanceId"] as string)
          : undefined,
        statusPageId: body["statusPageId"]
          ? new ObjectID(body["statusPageId"] as string)
          : undefined,
        statusPageAnnouncementId: body["statusPageAnnouncementId"]
          ? new ObjectID(body["statusPageAnnouncementId"] as string)
          : undefined,
        userId: body["userId"]
          ? new ObjectID(body["userId"] as string)
          : undefined,
        onCallPolicyId: body["onCallPolicyId"]
          ? new ObjectID(body["onCallPolicyId"] as string)
          : undefined,
        onCallPolicyEscalationRuleId: body["onCallPolicyEscalationRuleId"]
          ? new ObjectID(body["onCallPolicyEscalationRuleId"] as string)
          : undefined,
        onCallDutyPolicyExecutionLogTimelineId: body[
          "onCallDutyPolicyExecutionLogTimelineId"
        ]
          ? new ObjectID(
              body["onCallDutyPolicyExecutionLogTimelineId"] as string,
            )
          : undefined,
        onCallScheduleId: body["onCallScheduleId"]
          ? new ObjectID(body["onCallScheduleId"] as string)
          : undefined,
        teamId: body["teamId"]
          ? new ObjectID(body["teamId"] as string)
          : undefined,
      });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.get("/webhook", async (req: ExpressRequest, res: ExpressResponse) => {
  const mode: string | undefined = req.query["hub.mode"]
    ? String(req.query["hub.mode"])
    : undefined;
  const verifyToken: string | undefined = req.query["hub.verify_token"]
    ? String(req.query["hub.verify_token"])
    : undefined;
  const challenge: string | undefined = req.query["hub.challenge"]
    ? String(req.query["hub.challenge"])
    : undefined;

  if (mode === "subscribe" && challenge) {
    const globalConfigTokenResponse: GlobalConfig | null =
      await GlobalConfigService.findOneBy({
        query: {
          _id: ObjectID.getZeroObjectID().toString(),
        },
        props: {
          isRoot: true,
        },
        select: {
          metaWhatsAppWebhookVerifyToken: true,
        },
      });

    const configuredVerifyToken: string | undefined =
      globalConfigTokenResponse?.metaWhatsAppWebhookVerifyToken?.trim() ||
      undefined;

    if (!configuredVerifyToken) {
      logger.error(
        "Meta WhatsApp webhook verify token is not configured. Rejecting verification request.",
        getLogAttributesFromRequest(req as RequestLike),
      );
      res.sendStatus(403);
      return;
    }

    if (verifyToken === configuredVerifyToken) {
      res.status(200).send(challenge);
      return;
    }

    logger.warn(
      "Meta WhatsApp webhook verification failed due to token mismatch.",
      getLogAttributesFromRequest(req as any),
    );
    res.sendStatus(403);
    return;
  }

  res.sendStatus(400);
});

router.post(
  "/webhook",
  WhatsAppAuthorization.isAuthorizedWhatsAppRequest,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      if (
        (body["object"] as string | undefined) !== "whatsapp_business_account"
      ) {
        // Its kind only: the event itself may name people.
        logger.debug(
          `[Meta WhatsApp Webhook] Received event for unsupported object: ${String(body["object"])}`,
          getLogAttributesFromRequest(req as any),
        );
        return Response.sendEmptySuccessResponse(req, res);
      }

      const entries: JSONArray | undefined = body["entry"] as
        | JSONArray
        | undefined;

      if (!Array.isArray(entries)) {
        logger.warn(
          "[Meta WhatsApp Webhook] Payload did not include entries array.",
          getLogAttributesFromRequest(req as any),
        );
        return Response.sendEmptySuccessResponse(req, res);
      }

      const statusItems: Array<JSONObject> = [];

      for (const entry of entries) {
        const entryObject: JSONObject = entry as JSONObject;
        const changes: JSONArray | undefined =
          (entryObject["changes"] as JSONArray | undefined) || undefined;

        if (!Array.isArray(changes)) {
          continue;
        }

        for (const change of changes) {
          const changeObject: JSONObject = change as JSONObject;
          const value: JSONObject | undefined =
            (changeObject["value"] as JSONObject | undefined) || undefined;

          if (!value) {
            continue;
          }

          const statuses: JSONArray | undefined =
            (value["statuses"] as JSONArray | undefined) || undefined;

          if (Array.isArray(statuses)) {
            for (const statusItem of statuses) {
              statusItems.push(statusItem as JSONObject);
            }
          }
        }
      }

      // Handled at once: each is written on its own log, by compare-and-set.
      const results: Array<PromiseSettledResult<WhatsAppStatusOutcome>> =
        await Promise.allSettled(
          statusItems.map(
            (statusItem: JSONObject): Promise<WhatsAppStatusOutcome> => {
              return updateWhatsAppLogStatus(statusItem);
            },
          ),
        );

      let isSentAgain: boolean = false;

      results.forEach(
        (
          result: PromiseSettledResult<WhatsAppStatusOutcome>,
          index: number,
        ): void => {
          if (result.status === "rejected") {
            /*
             * A status that could not be handled - the database failed -
             * leaves the others handled. Its message's id only: the
             * payload holds the recipient's phone number.
             */
            logger.error(
              `[Meta WhatsApp Webhook] Could not handle the status of message id ${String(statusItems[index]?.["id"] || "none")}: ${result.reason}`,
              getLogAttributesFromRequest(req as any),
            );
            return;
          }

          if (result.value === WhatsAppStatusOutcome.SendAgain) {
            isSentAgain = true;
          }
        },
      );

      /*
       * A status that came before its message's log had the message's id,
       * while the message was being sent: Meta sends a webhook it was not
       * answered 200 for again later, all of it. The statuses handled now
       * change nothing then - each write is a compare-and-set, and a
       * message is counted once.
       */
      if (isSentAgain) {
        res.sendStatus(503);
        return;
      }

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * "Send Test WhatsApp Message" in the Admin Dashboard: tests the instance's
 * own WhatsApp setup, so it is a master administrator's, like the Telegram
 * bot's test. It is never billed to, charged against, recharged for or
 * logged in a project: the message is the instance's, whoever asks.
 */
router.post(
  "/test",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      if (!body["toPhone"]) {
        throw new BadDataException("toPhone is required");
      }

      const toPhone: Phone = new Phone(body["toPhone"] as string);

      const templateKey: WhatsAppTemplateId =
        WhatsAppTemplateIds.TestNotification;

      const templateLanguageCode: string =
        WhatsAppTemplateLanguage[templateKey] || "en";

      const message: WhatsAppMessage = {
        to: toPhone,
        body: "",
        templateKey,
        templateVariables: undefined,
        templateLanguageCode,
      };

      try {
        // No project: nothing in the body chooses one to bill or log in.
        await WhatsAppService.sendWhatsApp(message, {
          isSensitive: false,
        });
      } catch (err) {
        const errorMsg: string =
          err instanceof Error && err.message
            ? err.message
            : "Failed to send test WhatsApp message.";

        throw new BadDataException(errorMsg);
      }

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
