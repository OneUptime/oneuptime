import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/Utils/Express';
const router: ExpressRouter = Express.getRouter();
import Response from 'CommonServer/Utils/Response';
import ClusterKeyAuthorization from 'CommonServer/Middleware/ClusterKeyAuthorization';
import MailService from '../Services/MailService';
import EmailMessage from 'Common/Types/Email/EmailMessage';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import { JSONObject } from 'Common/Types/JSON';
import Email from 'Common/Types/Email';
import Dictionary from 'Common/Types/Dictionary';
import EmailServer from 'Common/Types/Email/EmailServer';
import ObjectID from 'Common/Types/ObjectID';

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

        await MailService.send(mail, {
            projectId: body['projectId'] ?  new ObjectID(body['projectId'] as string) : undefined,
            emailServer: mailServer,
            userOnCallLogTimelineId:
                (body['userOnCallLogTimelineId'] as ObjectID) || undefined,
        });

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
