import MailService from "../Services/MailService";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ClusterKeyAuthorization from "CommonServer/Middleware/ClusterKeyAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "CommonServer/Utils/Express";
import Response from "CommonServer/Utils/Response";

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
