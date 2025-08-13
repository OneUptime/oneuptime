import PushService from "../Services/PushNotificationService";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import ObjectID from "Common/Types/ObjectID";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";

const router: ExpressRouter = Express.getRouter();

router.post(
  "/send",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (req: ExpressRequest, res: ExpressResponse) => {
    const body: JSONObject = JSONFunctions.deserialize(req.body);

    await PushService.send(
      {
        deviceTokens: (body["deviceTokens"] as string[]) || [],
        deviceType: (body["deviceType"] as any) || "web",
        message: body["message"] as any,
      },
      {
        projectId: (body["projectId"] as ObjectID) || undefined,
        isSensitive: (body["isSensitive"] as boolean) || false,
        userOnCallLogTimelineId:
          (body["userOnCallLogTimelineId"] as ObjectID) || undefined,
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
        userBelongsToTeamId:
          (body["userBelongsToTeamId"] as ObjectID) || undefined,
        onCallDutyPolicyExecutionLogTimelineId:
          (body["onCallDutyPolicyExecutionLogTimelineId"] as ObjectID) ||
          undefined,
        onCallScheduleId: (body["onCallScheduleId"] as ObjectID) || undefined,
        overridedByUserId: (body["overridedByUserId"] as ObjectID) || undefined,
      },
    );

    return Response.sendEmptySuccessResponse(req, res);
  },
);

export default router;
