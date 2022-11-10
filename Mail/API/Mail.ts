import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/Utils/Express';
const router: ExpressRouter = Express.getRouter();
import Response from 'CommonServer/Utils/Response';
import ClusterKeyAuthorization from 'CommonServer/Middleware/ClusterKeyAuthorization';
import MailService from '../Services/MailService';
import Mail from 'Common/Types/Mail/Mail';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import { JSONObject } from 'Common/Types/JSON';
import Email from 'Common/Types/Email';
import Dictionary from 'Common/Types/Dictionary';
import MailServer from 'Common/Types/Mail/MailServer';

router.post(
    '/send',
    ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const body: JSONObject = req.body;

        const mail: Mail = {
            templateType: body['template-name'] as EmailTemplateType,
            toEmail: new Email(body['to-email'] as string),
            subject: body['subject'] as string,
            vars: body['vars'] as Dictionary<string>,
            body: body['body'] as string || '',
        };

        let mailServer: MailServer | undefined = undefined;

        if (hasMailServerSettingsInBody(body)) {
            mailServer = MailService.getMailServer(req.body);
        }

        await MailService.send(
            mail, mailServer
        );

        return Response.sendEmptyResponse(req, res);
    }
);

const hasMailServerSettingsInBody = (body: JSONObject): boolean => {
    return body && Object.keys(body).filter((key) => key.startsWith("SMTP_")).length > 0;
}

export default router;
