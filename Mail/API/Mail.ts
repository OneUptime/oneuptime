import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
const router: $TSFixMe = express.getRouter();
import {
    sendErrorResponse,
    sendEmptyResponse,
} from 'CommonServer/Utils/Response';
import Exception from 'Common/Types/Exception/Exception';
import ClusterKeyAuthorization from 'CommonServer/Middleware/ClusterKeyAuthorization';
import MailService from '../Services/MailService';
import Mail from '../Types/Mail';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';

router.post(
    '/:template-name',
    ClusterKeyAuthorization.isAuthorizedService,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const body: $TSFixMe = req.body;

            const mail: Mail = {
                templateType: req.params['template-name'] as EmailTemplateType,
                toEmail: body['toEmail'],
                subject: body['subject'],
                vars: body['vars'],
                body: '',
            };

            await MailService.send(
                mail,
                body['projectId'],
                body['forceSendFromGlobalMailServer']
            );

            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
