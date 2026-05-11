import WebhookService, { WebhookSendInput } from "../Services/WebhookService";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

const router: ExpressRouter = Express.getRouter();

router.post(
  "/send",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      if (!body["url"]) {
        throw new BadDataException("`url` is required");
      }

      if (!body["eventType"]) {
        throw new BadDataException("`eventType` is required");
      }

      const message: WebhookSendInput = {
        url: String(body["url"]),
        eventType: String(body["eventType"]),
        payload: (body["payload"] as JSONObject) || {},
      };

      if (body["secret"]) {
        message.secret = String(body["secret"]);
      }

      await WebhookService.sendWebhook(message, {
        projectId: body["projectId"]
          ? new ObjectID(body["projectId"] as string)
          : undefined,
        userOnCallLogTimelineId: body["userOnCallLogTimelineId"]
          ? new ObjectID(body["userOnCallLogTimelineId"] as string)
          : undefined,
        incidentId: body["incidentId"]
          ? new ObjectID(body["incidentId"] as string)
          : undefined,
        alertId: body["alertId"]
          ? new ObjectID(body["alertId"] as string)
          : undefined,
        monitorId: body["monitorId"]
          ? new ObjectID(body["monitorId"] as string)
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
        teamId: body["teamId"]
          ? new ObjectID(body["teamId"] as string)
          : undefined,
        onCallPolicyId: body["onCallPolicyId"]
          ? new ObjectID(body["onCallPolicyId"] as string)
          : undefined,
        onCallPolicyEscalationRuleId: body["onCallPolicyEscalationRuleId"]
          ? new ObjectID(body["onCallPolicyEscalationRuleId"] as string)
          : undefined,
        onCallScheduleId: body["onCallScheduleId"]
          ? new ObjectID(body["onCallScheduleId"] as string)
          : undefined,
      });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
