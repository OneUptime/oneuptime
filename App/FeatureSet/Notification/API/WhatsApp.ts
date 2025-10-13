import WhatsAppService from "../Services/WhatsAppService";
import BadDataException from "Common/Types/Exception/BadDataException";
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
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import WhatsAppLogService from "Common/Server/Services/WhatsAppLogService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
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

const updateWhatsAppLogStatus = async (
  statusPayload: JSONObject,
): Promise<void> => {
  const messageId: string | undefined = statusPayload["id"]
    ? String(statusPayload["id"])
    : undefined;

  if (!messageId) {
    logger.warn(
      `[Meta WhatsApp Webhook] Received status payload without message id. Payload: ${JSON.stringify(statusPayload)}`,
    );
    return;
  }

  const rawStatus: string | undefined = statusPayload["status"]
    ? String(statusPayload["status"])
    : undefined;

  const derivedStatus: WhatsAppStatus =
    mapWebhookStatusToWhatsAppStatus(rawStatus);

  const statusMessage: string | undefined = buildStatusMessage(statusPayload);

  const updateResult: number = await WhatsAppLogService.updateOneBy({
    query: {
      whatsAppMessageId: messageId,
    },
    data: {
      status: derivedStatus,
      ...(statusMessage ? { statusMessage } : {}),
    },
    props: {
      isRoot: true,
    },
  });

  if (updateResult === 0) {
    logger.warn(
      `[Meta WhatsApp Webhook] No WhatsApp log found for message id ${messageId}. Payload: ${JSON.stringify(statusPayload)}`,
    );
  } else {
    logger.debug(
      `[Meta WhatsApp Webhook] Updated WhatsApp log for message id ${messageId} with status ${derivedStatus}.`,
    );
  }
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
    const globalConfigTokenResponse = await GlobalConfigService.findOneBy({
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
    );
    res.sendStatus(403);
    return;
  }

  res.sendStatus(400);
});

router.post(
  "/webhook",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      if (
        (body["object"] as string | undefined) !== "whatsapp_business_account"
      ) {
        logger.debug(
          `[Meta WhatsApp Webhook] Received event for unsupported object: ${JSON.stringify(body)}`,
        );
        return Response.sendEmptySuccessResponse(req, res);
      }

      const entries: JSONArray | undefined = body["entry"] as
        | JSONArray
        | undefined;

      if (!Array.isArray(entries)) {
        logger.warn(
          `[Meta WhatsApp Webhook] Payload did not include entries array. Payload: ${JSON.stringify(body)}`,
        );
        return Response.sendEmptySuccessResponse(req, res);
      }

      const statusUpdatePromises: Array<Promise<void>> = [];

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
              statusUpdatePromises.push(
                updateWhatsAppLogStatus(statusItem as JSONObject),
              );
            }
          }
        }
      }

      if (statusUpdatePromises.length > 0) {
        await Promise.allSettled(statusUpdatePromises);
      }

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/test",
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
        await WhatsAppService.sendWhatsApp(message, {
          projectId: body["projectId"]
            ? new ObjectID(body["projectId"] as string)
            : undefined,
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
