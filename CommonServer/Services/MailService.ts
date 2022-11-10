import EmptyResponseData from 'Common/Types/API/EmptyResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import API from 'Common/Utils/API';
import { ClusterKey, HttpProtocol, MailHostname } from '../Config';
import Email from 'Common/Types/Email/EmailMessage';
import EmailServer from 'Common/Types/Email/EmailServer';

export default class MailService {
    public static async sendMail(
        mail: Email,
        mailServer?: EmailServer
    ): Promise<HTTPResponse<EmptyResponseData>> {
        const body: JSONObject = {
            ...mail,
            ...mailServer
        };

        return await API.post<EmptyResponseData>(
            new URL(
                HttpProtocol,
                MailHostname,
                new Route('/email/send')
            ),
            body,
            {
                clusterkey: ClusterKey.toString(),
            }
        );
    }
}
