import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
const router: ExpressRouter = Express.getRouter();
import {
    sendErrorResponse,
    sendEmptyResponse,
} from 'CommonServer/Utils/Response';
import Exception from 'Common/Types/Exception/Exception';
import ClusterKeyAuthorization from 'CommonServer/Middleware/ClusterKeyAuthorization';
import MailService from '../Services/MailService';
import Mail from '../Types/Mail';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import { JSONObject } from 'Common/Types/JSON';
import Email from 'Common/Types/Email';
import Dictionary from 'Common/Types/Dictionary';
import ObjectID from 'Common/Types/ObjectID';

router.post(
    '/:template-name',
    ClusterKeyAuthorization.isAuthorizedService,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const body: JSONObject = req.body;

            const mail: Mail = {
                templateType: req.params['template-name'] as EmailTemplateType,
                toEmail: new Email(body.toEmail as string),
                subject: body.subject as string,
                vars: body.vars as Dictionary<string>,
                body: '',
            };

            await MailService.send(
                mail,
                new ObjectID(body.projectId as string),
                body.forceSendFromGlobalMailServer as boolean
            );

            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
