import EmptyResponseData from 'Common/Types/API/EmptyResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import API from 'Common/Utils/API';
import { ClusterKey, HttpProtocol, MailHostname } from '../Config';
import Email from 'Common/Types/Email/EmailMessage';
import EmailServer from 'Common/Types/Email/EmailServer';
import Protocol from 'Common/Types/API/Protocol';

export default class MailService {
    public static async sendMail(
        mail: Email,
        mailServer?: EmailServer
    ): Promise<HTTPResponse<EmptyResponseData>> {
        const body: JSONObject = {
            ...mail,
            clusterKey: ClusterKey.toString(),
            toEmail: mail.toEmail.toString(),
        };

        if (mailServer) {
            body['SMTP_USERNAME'] = mailServer.username;
            body['SMTP_EMAIL'] = mailServer.fromEmail;
            body['SMTP_FROM_NAME'] = mailServer.fromName;
            body['SMTP_IS_SECURE'] = mailServer.secure;
            body['SMTP_PORT'] = mailServer.port.toNumber();
            body['SMTP_HOST'] = mailServer.host.toString();
            body['SMTP_PASSWORD'] = mailServer.password;
        }

        return await API.post<EmptyResponseData>(
            new URL(Protocol.HTTP, MailHostname, new Route('/email/send')),
            body
        );
    }
}
