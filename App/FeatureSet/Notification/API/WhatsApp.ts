import WhatsAppService from "../Services/WhatsAppService";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";

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
        customTwilioConfig: body["customTwilioConfig"] as any,
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

  const callSMSConfigId: ObjectID = new ObjectID(
    body["callSMSConfigId"] as string,
  );

  const config: ProjectCallSMSConfig | null =
    await ProjectCallSMSConfigService.findOneById({
      id: callSMSConfigId,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        twilioAccountSID: true,
        twilioAuthToken: true,
        twilioPrimaryPhoneNumber: true,
        twilioSecondaryPhoneNumbers: true,
        projectId: true,
      },
    });

  if (!config) {
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException(
        "call and sms config not found for id" + callSMSConfigId.toString(),
      ),
    );
  }

  const toPhone: Phone = new Phone(body["toPhone"] as string);

  if (!toPhone) {
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("toPhone is required"),
    );
  }

  // if any of the twilio config is missing, we will not send the WhatsApp message

  if (!config.twilioAccountSID) {
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("twilioAccountSID is required"),
    );
  }

  if (!config.twilioAuthToken) {
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("twilioAuthToken is required"),
    );
  }

  if (!config.twilioPrimaryPhoneNumber) {
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("twilioPrimaryPhoneNumber is required"),
    );
  }

  const twilioConfig: TwilioConfig | undefined =
    ProjectCallSMSConfigService.toTwilioConfig(config);

  try {
    if (!twilioConfig) {
      throw new BadDataException("twilioConfig is undefined");
    }

    await WhatsAppService.sendWhatsApp(
      toPhone,
      "This is a test WhatsApp message from OneUptime.",
      {
        projectId: config.projectId,
        customTwilioConfig: twilioConfig,
      },
    );
  } catch (err) {
    logger.error(err);
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException(
        "Failed to send test WhatsApp message. Please check the twilio logs for more details.",
      ),
    );
  }

  return Response.sendEmptySuccessResponse(req, res);
});

export default router;