import MailService from "../Services/MailService";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

const router: ExpressRouter = Express.getRouter();

router.post(
  "/send",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (req: ExpressRequest, res: ExpressResponse) => {
    const body: JSONObject = req.body;

    const mail: EmailMessage = {
      templateType: body["templateType"] as EmailTemplateType,
      toEmail: new Email(body["toEmail"] as string),
      subject: body["subject"] as string,
      vars: body["vars"] as Dictionary<string>,
      body: (body["body"] as string) || "",
    };

    let mailServer: EmailServer | undefined = undefined;

    if (hasMailServerSettingsInBody(body)) {
      mailServer = MailService.getEmailServer(req.body);
    }

    await MailService.send(mail, {
      projectId: body["projectId"]
        ? new ObjectID(body["projectId"] as string)
        : undefined,
      emailServer: mailServer,
      userOnCallLogTimelineId:
        (body["userOnCallLogTimelineId"] as ObjectID) || undefined,
      incidentId: body["incidentId"]
        ? new ObjectID(body["incidentId"].toString())
        : undefined,
      alertId: body["alertId"]
        ? new ObjectID(body["alertId"].toString())
        : undefined,
      scheduledMaintenanceId: body["scheduledMaintenanceId"]
        ? new ObjectID(body["scheduledMaintenanceId"].toString())
        : undefined,
      statusPageId: body["statusPageId"]
        ? new ObjectID(body["statusPageId"].toString())
        : undefined,
      statusPageAnnouncementId: body["statusPageAnnouncementId"]
        ? new ObjectID(body["statusPageAnnouncementId"].toString())
        : undefined,
      userId: body["userId"]
        ? new ObjectID(body["userId"].toString())
        : undefined,
      onCallPolicyId: body["onCallPolicyId"]
        ? new ObjectID(body["onCallPolicyId"].toString())
        : undefined,
      onCallPolicyEscalationRuleId: body["onCallPolicyEscalationRuleId"]
        ? new ObjectID(body["onCallPolicyEscalationRuleId"].toString())
        : undefined,
      onCallDutyPolicyExecutionLogTimelineId: body[
        "onCallDutyPolicyExecutionLogTimelineId"
      ]
        ? new ObjectID(
            body["onCallDutyPolicyExecutionLogTimelineId"].toString(),
          )
        : undefined,
      onCallScheduleId: body["onCallScheduleId"]
        ? new ObjectID(body["onCallScheduleId"].toString())
        : undefined,
      teamId: body["teamId"]
        ? new ObjectID(body["teamId"].toString())
        : undefined,
    });

    return Response.sendEmptySuccessResponse(req, res);
  },
);

type HasMailServerSettingsInBody = (body: JSONObject) => boolean;

const hasMailServerSettingsInBody: HasMailServerSettingsInBody = (
  body: JSONObject,
): boolean => {
  return (
    body &&
    Object.keys(body).filter((key: string) => {
      return key.startsWith("SMTP_");
    }).length > 0
  );
};

export default router;
