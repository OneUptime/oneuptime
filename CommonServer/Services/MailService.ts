import EmptyResponseData from 'Common/Types/API/EmptyResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import API from 'Common/Utils/API';
import { NotificationHostname } from '../Config';
import Email from 'Common/Types/Email/EmailMessage';
import EmailServer from 'Common/Types/Email/EmailServer';
import Protocol from 'Common/Types/API/Protocol';
import ClusterKeyAuthorization from '../Middleware/ClusterKeyAuthorization';
import ObjectID from 'Common/Types/ObjectID';

export default class MailService {
    public static async sendMail(
        mail: Email,
        mailServer?: EmailServer,
        options?: {
            userOnCallLogTimelineId?: ObjectID;
            projectId?: ObjectID | undefined;
        }
    ): Promise<HTTPResponse<EmptyResponseData>> {
        const body: JSONObject = {
            ...mail,
            toEmail: mail.toEmail.toString(),
        };

        if (mailServer) {
            body['SMTP_USERNAME'] = mailServer.username;
            body['SMTP_EMAIL'] = mailServer.fromEmail.toString();
            body['SMTP_FROM_NAME'] = mailServer.fromName;
            body['SMTP_IS_SECURE'] = mailServer.secure;
            body['SMTP_PORT'] = mailServer.port.toNumber();
            body['SMTP_HOST'] = mailServer.host.toString();
            body['SMTP_PASSWORD'] = mailServer.password;
        }

        if (options?.userOnCallLogTimelineId) {
            body['userOnCallLogTimelineId'] =
                options.userOnCallLogTimelineId.toString();
        }

        if (options?.projectId) {
            body['projectId'] =
                options.projectId.toString();
        }

        return await API.post<EmptyResponseData>(
            new URL(
                Protocol.HTTP,
                NotificationHostname,
                new Route('/email/send')
            ),
            body,
            {
                ...ClusterKeyAuthorization.getClusterKeyHeaders(),
            }
        );
    }
}
