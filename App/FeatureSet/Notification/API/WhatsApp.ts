import WhatsAppService from "../Services/WhatsAppService";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";

const router: ExpressRouter = Express.getRouter();

router.post(
  "/send",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (req: ExpressRequest, res: ExpressResponse) => {
    const body: JSONObject = JSONFunctions.deserialize(req.body);

    await WhatsAppService.sendWhatsApp(
      body["to"] as Phone,
      body["message"] as string,
      {
        projectId: body["projectId"] as ObjectID,
        isSensitive: (body["isSensitive"] as boolean) || false,
        userOnCallLogTimelineId:
          (body["userOnCallLogTimelineId"] as ObjectID) || undefined,
        customMetaWhatsAppConfig: body["customMetaWhatsAppConfig"] as any,
        incidentId: (body["incidentId"] as ObjectID) || undefined,
        alertId: (body["alertId"] as ObjectID) || undefined,
        scheduledMaintenanceId:
          (body["scheduledMaintenanceId"] as ObjectID) || undefined,
        statusPageId: (body["statusPageId"] as ObjectID) || undefined,
        statusPageAnnouncementId:
          (body["statusPageAnnouncementId"] as ObjectID) || undefined,
        userId: (body["userId"] as ObjectID) || undefined,
        onCallPolicyId: (body["onCallPolicyId"] as ObjectID) || undefined,
        onCallPolicyEscalationRuleId:
          (body["onCallPolicyEscalationRuleId"] as ObjectID) || undefined,
        onCallDutyPolicyExecutionLogTimelineId:
          (body["onCallDutyPolicyExecutionLogTimelineId"] as ObjectID) ||
          undefined,
        onCallScheduleId: (body["onCallScheduleId"] as ObjectID) || undefined,
        teamId: (body["teamId"] as ObjectID) || undefined,
      },
    );

    return Response.sendEmptySuccessResponse(req, res);
  },
);

router.post("/test", async (req: ExpressRequest, res: ExpressResponse) => {
  const body: JSONObject = req.body;

  const toPhone: Phone = new Phone(body["toPhone"] as string);

  if (!toPhone) {
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("toPhone is required"),
    );
  }

  // For testing, we'll use the global Meta WhatsApp configuration
  try {
    await WhatsAppService.sendWhatsApp(
      toPhone,
      "This is a test WhatsApp message from OneUptime using Meta WhatsApp Business API.",
      {
        projectId: body["projectId"] as ObjectID,
      },
    );
  } catch (err) {
    logger.error(err);
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException(
        "Failed to send test WhatsApp message. Please check the Meta WhatsApp configuration and logs for more details.",
      ),
    );
  }

  return Response.sendEmptySuccessResponse(req, res);
});

export default router;