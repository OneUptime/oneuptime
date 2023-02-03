import type {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/Utils/Express';
import Express from 'CommonServer/Utils/Express';
const router: ExpressRouter = Express.getRouter();
import Response from 'CommonServer/Utils/Response';
import ClusterKeyAuthorization from 'CommonServer/Middleware/ClusterKeyAuthorization';
import MailService from '../Services/MailService';
import type EmailMessage from 'Common/Types/Email/EmailMessage';
import type EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import type { JSONObject } from 'Common/Types/JSON';
import Email from 'Common/Types/Email';
import type Dictionary from 'Common/Types/Dictionary';
import type EmailServer from 'Common/Types/Email/EmailServer';

router.post(
    '/send',
    ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const body: JSONObject = req.body;

        const mail: EmailMessage = {
            templateType: body['templateType'] as EmailTemplateType,
            toEmail: new Email(body['toEmail'] as string),
            subject: body['subject'] as string,
            vars: body['vars'] as Dictionary<string>,
            body: (body['body'] as string) || '',
        };

        let mailServer: EmailServer | undefined = undefined;

        if (hasMailServerSettingsInBody(body)) {
            mailServer = MailService.getEmailServer(req.body);
        }

        await MailService.send(mail, mailServer);

        return Response.sendEmptyResponse(req, res);
    }
);

const hasMailServerSettingsInBody: Function = (body: JSONObject): boolean => {
    return (
        body &&
        Object.keys(body).filter((key: string) => {
            return key.startsWith('SMTP_');
        }).length > 0
    );
};

export default router;
