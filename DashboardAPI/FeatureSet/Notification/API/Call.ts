import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/Utils/Express';
const router: ExpressRouter = Express.getRouter();
import Response from 'CommonServer/Utils/Response';
import ClusterKeyAuthorization from 'CommonServer/Middleware/ClusterKeyAuthorization';
import { JSONObject } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Phone from 'Common/Types/Phone';
import ObjectID from 'Common/Types/ObjectID';
import CallService from '../Services/CallService';
import CallRequest from 'Common/Types/Call/CallRequest';

router.post(
    '/make-call',
    ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const body: JSONObject = JSONFunctions.deserialize(req.body);

        await CallService.makeCall(body['callRequest'] as CallRequest, {
            projectId: body['projectId'] as ObjectID,
            from: body['from'] as Phone,
            isSensitive: (body['isSensitive'] as boolean) || false,
            userOnCallLogTimelineId:
                (body['userOnCallLogTimelineId'] as ObjectID) || undefined,
        });

        return Response.sendEmptyResponse(req, res);
    }
);



router.post('/test', async (req: ExpressRequest, res: ExpressResponse) => {
    const body: JSONObject = req.body;

    const smtpConfigId: ObjectID = new ObjectID(body['smtpConfigId'] as string);

    const config: ProjectSmtpConfig | null =
        await ProjectSMTPConfigService.findOneById({
            id: smtpConfigId,
            props: {
                isRoot: true,
            },
            select: {
                _id: true,
                hostname: true,
                port: true,
                username: true,
                password: true,
                fromEmail: true,
                fromName: true,
                secure: true,
                projectId: true,
            },
        });

    if (!config) {
        return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(
                'smtp-config not found for id' + smtpConfigId.toString()
            )
        );
    }

    const toEmail: Email = new Email(body['toEmail'] as string);

    if (!toEmail) {
        return Response.sendErrorResponse(
            req,
            res,
            new BadDataException('toEmail is required')
        );
    }

    const mail: EmailMessage = {
        templateType: EmailTemplateType.SMTPTest,
        toEmail: new Email(body['toEmail'] as string),
        subject: 'Test Email from OneUptime',
        vars: {},
        body: '',
    };

    const mailServer: EmailServer = {
        id: config.id!,
        host: config.hostname!,
        port: config.port!,
        username: config.username!,
        password: config.password!,
        fromEmail: config.fromEmail!,
        fromName: config.fromName!,
        secure: Boolean(config.secure),
    };

    try {
        await MailService.send(mail, {
            emailServer: mailServer,
            projectId: config.projectId!,
            timeout: 4000,
        });
    } catch (err) {
        logger.error(err);
        return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(
                'Cannot send email. Please check your SMTP config. If you are using Google or Gmail, please dont since it does not support machine access to their mail servers. If you are still having issues, please uncheck SSL/TLS toggle and try again. We recommend using SendGrid or Mailgun or any large volume mail provider for SMTP.'
            )
        );
    }

    return Response.sendEmptyResponse(req, res);
});


export default router;
