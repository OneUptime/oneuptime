import EmptyResponseData from 'Common/Types/API/EmptyResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import API from 'Common/Utils/API';
import { ClusterKey, HttpProtocol, MailHostname } from '../Config';
import Mail from 'Common/Types/Mail/Mail';
import MailServer from 'Common/Types/Mail/MailServer';

export default class MailService {
    public static async sendMail(
        mail: Mail,
        mailServer?: MailServer
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
