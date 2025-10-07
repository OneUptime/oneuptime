import WhatsAppService from "../Services/WhatsAppService";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import WhatsAppMessage from "Common/Types/WhatsApp/WhatsAppMessage";
import {
  WhatsAppTemplateId,
  WhatsAppTemplateIds,
  WhatsAppTemplateLanguage,
} from "Common/Types/WhatsApp/WhatsAppTemplates";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

const router: ExpressRouter = Express.getRouter();

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
  async (req: ExpressRequest, res: ExpressResponse) => {
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
        ? new ObjectID(body["onCallDutyPolicyExecutionLogTimelineId"] as string)
        : undefined,
      onCallScheduleId: body["onCallScheduleId"]
        ? new ObjectID(body["onCallScheduleId"] as string)
        : undefined,
      teamId: body["teamId"]
        ? new ObjectID(body["teamId"] as string)
        : undefined,
    });

    return Response.sendEmptySuccessResponse(req, res);
  },
);

router.post("/test", async (req: ExpressRequest, res: ExpressResponse) => {
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

    return Response.sendErrorResponse(req, res, new BadDataException(errorMsg));
  }

  return Response.sendEmptySuccessResponse(req, res);
});

export default router;
